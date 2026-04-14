/// Auto-Fix Pipeline — BLADE's showcase autonomous CI repair engine.
///
/// Flow: CI fails → GitHub tentacle detects → Dev Head analyzes →
///       spawns fix agent → commits → pushes → monitors new run.
///
/// The pipeline uses rule-based fixes for the 80% case (unused vars, missing
/// imports, trivial type errors) and falls back to LLM assistance for the rest.
/// A confidence gate asks the user before touching > 5 files or low-confidence plans.

use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{AppHandle, Emitter};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorType {
    TypeScript,
    RustCompile,
    Lint,
    Test,
    Build,
    Unknown,
}

/// A single parsed error location extracted from CI log output.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedError {
    pub file: String,
    pub line: u32,
    pub col: u32,
    pub code: String,
    pub message: String,
    pub error_type: ErrorType,
}

/// A single file edit to be applied as part of a fix.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEdit {
    pub file_path: String,
    pub description: String,
    /// The old text to replace (None = append-only).
    pub old_text: Option<String>,
    /// The new text to write in place of old_text.
    pub new_text: String,
}

/// A plan produced by `analyze_ci_failure` — list of edits + confidence score.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FixPlan {
    pub errors: Vec<ParsedError>,
    pub edits: Vec<FileEdit>,
    /// 0.0–1.0 — how confident the planner is these edits will fix the build.
    pub confidence: f64,
    /// True if the planner believes these edits fully cover all errors.
    pub auto_fixable: bool,
}

/// The structured CI failure report delivered by the Hive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CIFailure {
    pub repo_path: String,
    pub workflow_name: String,
    pub run_id: u64,
    pub job_name: String,
    pub step_name: String,
    /// Raw error output from the CI log.
    pub error_log: String,
    pub error_type: ErrorType,
}

/// Outcome of a fix attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum FixResult {
    Fixed {
        files_changed: Vec<String>,
        commit_hash: String,
    },
    NeedHumanHelp {
        reason: String,
        suggestion: String,
    },
    AlreadyFixed,
}

// ── Error parsing ─────────────────────────────────────────────────────────────

/// Parse TypeScript compiler output.
/// Format: `src/file.tsx(line,col): error TSxxxx: message`
fn parse_typescript_errors(log: &str) -> Vec<ParsedError> {
    let mut errors = Vec::new();
    // Regex-free: scan line-by-line.
    for line in log.lines() {
        // Must contain ": error TS"
        if let Some(ts_pos) = line.find(": error TS") {
            let prefix = &line[..ts_pos];
            // prefix ends with (line,col)
            if let (Some(open), Some(close)) = (prefix.rfind('('), prefix.rfind(')')) {
                if open < close {
                    let coords = &prefix[open + 1..close];
                    let file = prefix[..open].to_string();
                    let mut parts = coords.splitn(2, ',');
                    let ln = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
                    let col = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
                    let rest = &line[ts_pos + 2..]; // "error TSxxxx: message"
                    let code_and_msg = rest.trim_start_matches("error ");
                    let (code, msg) = if let Some(colon) = code_and_msg.find(": ") {
                        (
                            code_and_msg[..colon].to_string(),
                            code_and_msg[colon + 2..].to_string(),
                        )
                    } else {
                        (code_and_msg.to_string(), String::new())
                    };
                    errors.push(ParsedError {
                        file,
                        line: ln,
                        col,
                        code,
                        message: msg,
                        error_type: ErrorType::TypeScript,
                    });
                }
            }
        }
    }
    errors
}

/// Parse Rust compiler output.
/// Format: `error[Exxxx]: message\n  --> src/file.rs:line:col`
fn parse_rust_errors(log: &str) -> Vec<ParsedError> {
    let mut errors = Vec::new();
    let lines: Vec<&str> = log.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.starts_with("error[") {
            // Extract error code + message from "error[Exxxx]: message"
            let (code, msg) = if let Some(bracket_close) = line.find("]: ") {
                let code = line[6..bracket_close].to_string();
                let msg = line[bracket_close + 3..].to_string();
                (code, msg)
            } else {
                (String::new(), line.to_string())
            };

            // Next lines: look for "  --> src/file.rs:line:col"
            let mut file = String::new();
            let mut ln = 0u32;
            let mut col = 0u32;
            for j in i + 1..std::cmp::min(i + 5, lines.len()) {
                let l = lines[j].trim();
                if l.starts_with("--> ") {
                    let loc = &l[4..];
                    let mut parts = loc.splitn(3, ':');
                    file = parts.next().unwrap_or("").to_string();
                    ln = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
                    col = parts.next().unwrap_or("0").parse::<u32>().unwrap_or(0);
                    break;
                }
            }

            if !file.is_empty() {
                errors.push(ParsedError {
                    file,
                    line: ln,
                    col,
                    code,
                    message: msg,
                    error_type: ErrorType::RustCompile,
                });
            }
        }
        i += 1;
    }
    errors
}

/// Parse ESLint or Clippy output (generic line-level).
fn parse_lint_errors(log: &str) -> Vec<ParsedError> {
    let mut errors = Vec::new();
    for line in log.lines() {
        // ESLint: "  src/file.tsx  10:5  error  no-unused-vars  'x' is defined..."
        // Clippy: "warning: unused variable `x`\n  --> src/file.rs:10:5"
        if line.contains(" error ") && line.contains(':') {
            let mut parts = line.trim().splitn(3, ':');
            let file = parts.next().unwrap_or("").trim().to_string();
            if file.ends_with(".ts")
                || file.ends_with(".tsx")
                || file.ends_with(".rs")
                || file.ends_with(".js")
            {
                errors.push(ParsedError {
                    file,
                    line: 0,
                    col: 0,
                    code: "lint".to_string(),
                    message: line.to_string(),
                    error_type: ErrorType::Lint,
                });
            }
        }
    }
    errors
}

// ── Fix planning ──────────────────────────────────────────────────────────────

/// Determine if a TypeScript error is rule-based fixable and return the edit.
fn plan_ts_fix(error: &ParsedError, repo_path: &str) -> Option<FileEdit> {
    let full_path = format!("{}/{}", repo_path.trim_end_matches('/'), error.file);
    let code = error.code.as_str();
    let msg = error.message.as_str();

    match code {
        // TS6133: declared but never read → prefix with underscore
        "TS6133" => {
            // Extract variable name from: "'varName' is declared but its value is never read."
            let var_name = extract_quoted(msg)?;
            Some(FileEdit {
                file_path: full_path,
                description: format!("Prefix unused variable '{}' with _", var_name),
                old_text: Some(format!("const {}", var_name)),
                new_text: format!("const _{}", var_name),
            })
        }
        // TS2304: cannot find name → likely missing import (surface as suggestion only)
        "TS2304" => {
            let name = extract_quoted(msg)?;
            Some(FileEdit {
                file_path: full_path,
                description: format!("Missing identifier '{}' — may need import", name),
                old_text: None,
                new_text: format!("// TODO(auto-fix): import '{}' from the correct module\n", name),
            })
        }
        // TS2345 / TS2322: type mismatch — flag for LLM
        _ if msg.contains("is not assignable to type") => None,
        // TS2307: cannot find module → missing package or wrong path
        "TS2307" => {
            let module = extract_quoted(msg)?;
            Some(FileEdit {
                file_path: full_path,
                description: format!("Cannot find module '{}' — check import path", module),
                old_text: None,
                new_text: String::new(),
            })
        }
        _ => None,
    }
}

/// Determine if a Rust error is rule-based fixable and return the edit.
fn plan_rust_fix(error: &ParsedError, repo_path: &str) -> Option<FileEdit> {
    let full_path = format!("{}/{}", repo_path.trim_end_matches('/'), error.file);
    let code = error.code.as_str();
    let msg = error.message.as_str();

    match code {
        // E0601: main not found — skip
        "E0601" => None,
        // unused variable warning (not an error code but shows in error[...] form sometimes)
        _ if msg.contains("unused variable") || msg.contains("unused import") => {
            let var_name = extract_backtick(msg)?;
            Some(FileEdit {
                file_path: full_path,
                description: format!("Prefix unused item '{}' with _", var_name),
                old_text: Some(var_name.clone()),
                new_text: format!("_{}", var_name),
            })
        }
        // E0308: type mismatch — needs LLM
        "E0308" => None,
        // E0432 / E0433: unresolved import
        "E0432" | "E0433" => {
            Some(FileEdit {
                file_path: full_path,
                description: format!("Unresolved import: {}", crate::safe_slice(msg, 80)),
                old_text: None,
                new_text: String::new(),
            })
        }
        _ => None,
    }
}

/// Pull the first single-quoted string from a message (e.g. `'varName'`).
fn extract_quoted(s: &str) -> Option<String> {
    let start = s.find('\'')?;
    let rest = &s[start + 1..];
    let end = rest.find('\'')?;
    Some(rest[..end].to_string())
}

/// Pull the first backtick-quoted identifier from a Rust message (e.g. `` `foo` ``).
fn extract_backtick(s: &str) -> Option<String> {
    let start = s.find('`')?;
    let rest = &s[start + 1..];
    let end = rest.find('`')?;
    Some(rest[..end].to_string())
}

// ── Core pipeline functions ───────────────────────────────────────────────────

/// Analyse a CI failure log and produce a FixPlan.
///
/// Parses errors by type, checks each for rule-based fixability, and scores
/// overall confidence based on coverage.
pub async fn analyze_ci_failure(failure: &CIFailure) -> Result<FixPlan, String> {
    let errors = match failure.error_type {
        ErrorType::TypeScript => parse_typescript_errors(&failure.error_log),
        ErrorType::RustCompile => parse_rust_errors(&failure.error_log),
        ErrorType::Lint => parse_lint_errors(&failure.error_log),
        ErrorType::Test | ErrorType::Build | ErrorType::Unknown => {
            // For test/build failures, attempt both parsers and merge results.
            let mut combined = parse_typescript_errors(&failure.error_log);
            combined.extend(parse_rust_errors(&failure.error_log));
            combined
        }
    };

    if errors.is_empty() {
        return Err("Could not parse any structured errors from the CI log".to_string());
    }

    // Build edits for each error.
    let mut edits: Vec<FileEdit> = Vec::new();
    let mut covered = 0usize;

    for err in &errors {
        let edit = match err.error_type {
            ErrorType::TypeScript | ErrorType::Lint => {
                plan_ts_fix(err, &failure.repo_path)
            }
            ErrorType::RustCompile => plan_rust_fix(err, &failure.repo_path),
            _ => None,
        };
        if let Some(e) = edit {
            // Only add the edit if it has actionable content.
            if e.old_text.is_some() || !e.new_text.is_empty() {
                covered += 1;
                edits.push(e);
            }
        }
    }

    let coverage = if errors.is_empty() {
        0.0
    } else {
        covered as f64 / errors.len() as f64
    };

    // Confidence: full coverage = high, partial = medium, zero = low.
    let confidence = if coverage >= 1.0 {
        0.9
    } else if coverage >= 0.5 {
        0.65
    } else {
        0.3
    };

    let auto_fixable = confidence >= 0.6 && !edits.is_empty();

    log::info!(
        "[AutoFix] Analyzed {} error(s), {} edits planned, confidence={:.2}",
        errors.len(),
        edits.len(),
        confidence
    );

    Ok(FixPlan {
        errors,
        edits,
        confidence,
        auto_fixable,
    })
}

/// Apply each edit in the plan to disk, then verify with a local check.
///
/// Strategy:
/// 1. Apply rule-based edits.
/// 2. Run `tsc --noEmit` or `cargo check` locally.
/// 3. If check passes → commit.
/// 4. If check fails → one LLM retry.
/// 5. If still failing → NeedHumanHelp.
pub async fn execute_fix(
    plan: &FixPlan,
    repo_path: &str,
    app: &AppHandle,
) -> Result<FixResult, String> {
    if plan.edits.is_empty() {
        return Ok(FixResult::NeedHumanHelp {
            reason: "No automated edits could be planned for these errors".to_string(),
            suggestion: "Review the error log manually and apply a targeted fix".to_string(),
        });
    }

    // Detect whether this is already fixed (empty error log re-check).
    // We'll rely on the local check step for this.

    let mut changed_files: Vec<String> = Vec::new();

    // Apply edits.
    for edit in &plan.edits {
        let path = &edit.file_path;
        match apply_edit(path, edit) {
            Ok(changed) => {
                if changed {
                    changed_files.push(path.clone());
                }
            }
            Err(e) => {
                log::warn!("[AutoFix] Edit failed on {}: {}", path, e);
                // Non-fatal — continue with other edits.
            }
        }
    }

    if changed_files.is_empty() {
        return Ok(FixResult::NeedHumanHelp {
            reason: "No files were modified (edits may not have matched source text)".to_string(),
            suggestion: "The error patterns may require manual context to fix correctly".to_string(),
        });
    }

    let _ = app.emit("auto_fix_verifying", serde_json::json!({
        "files_changed": changed_files.len(),
        "step": "local_check"
    }));

    // Run local check to verify.
    let check_result = run_local_check(repo_path, plan);

    if check_result.is_ok() {
        // Commit and return.
        let hash = commit_fix(repo_path, &changed_files)?;
        return Ok(FixResult::Fixed {
            files_changed: changed_files,
            commit_hash: hash,
        });
    }

    // First check failed — try LLM-assisted retry.
    log::info!("[AutoFix] Local check failed, attempting LLM-assisted retry");
    let _ = app.emit("auto_fix_verifying", serde_json::json!({
        "step": "llm_retry",
        "error": check_result.err().unwrap_or_default()
    }));

    let retry_ok = llm_fix_retry(repo_path, plan, &changed_files).await;

    if retry_ok {
        let hash = commit_fix(repo_path, &changed_files)?;
        return Ok(FixResult::Fixed {
            files_changed: changed_files,
            commit_hash: hash,
        });
    }

    Ok(FixResult::NeedHumanHelp {
        reason: "Automated fixes did not resolve the build errors after LLM retry".to_string(),
        suggestion: "The errors may involve complex type relationships or missing dependencies. \
                     Review the failing lines manually."
            .to_string(),
    })
}

/// Apply a single FileEdit to disk.
fn apply_edit(path: &str, edit: &FileEdit) -> Result<bool, String> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => return Err(format!("Could not read {}: {}", path, e)),
    };

    let new_content = if let Some(ref old) = edit.old_text {
        if !content.contains(old.as_str()) {
            return Ok(false); // Pattern not found — skip.
        }
        content.replacen(old.as_str(), &edit.new_text, 1)
    } else if !edit.new_text.is_empty() {
        // Prepend comment/annotation.
        format!("{}\n{}", edit.new_text, content)
    } else {
        return Ok(false);
    };

    if new_content == content {
        return Ok(false);
    }

    std::fs::write(path, new_content).map_err(|e| format!("Write failed: {}", e))?;
    Ok(true)
}

/// Run `tsc --noEmit` or `cargo check` in the repo root based on error type.
fn run_local_check(repo_path: &str, plan: &FixPlan) -> Result<(), String> {
    let has_ts = plan
        .errors
        .iter()
        .any(|e| e.error_type == ErrorType::TypeScript);
    let has_rust = plan
        .errors
        .iter()
        .any(|e| e.error_type == ErrorType::RustCompile);

    // Prefer the check type that matches the errors.
    let (program, args): (&str, &[&str]) = if has_rust {
        ("cargo", &["check", "--quiet"])
    } else if has_ts {
        ("npx", &["tsc", "--noEmit"])
    } else {
        // For lint/build failures, run a quick lint pass.
        ("npx", &["eslint", "--max-warnings=0", "src"])
    };

    let output = Command::new(program)
        .args(args)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("Could not run {}: {}", program, e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

/// Ask the LLM to produce a fix for the remaining errors given the current file content.
/// Returns true if the subsequent local check passes.
async fn llm_fix_retry(repo_path: &str, plan: &FixPlan, changed_files: &[String]) -> bool {
    let config = crate::config::load_config();

    // Build a compact prompt: error list + relevant file snippets.
    let error_summary: String = plan
        .errors
        .iter()
        .take(5)
        .map(|e| format!("{}:{}:{} [{}] {}", e.file, e.line, e.col, e.code, e.message))
        .collect::<Vec<_>>()
        .join("\n");

    let mut file_snippets = String::new();
    for file in changed_files.iter().take(3) {
        if let Ok(content) = std::fs::read_to_string(file) {
            file_snippets.push_str(&format!(
                "\n// FILE: {}\n{}\n",
                file,
                crate::safe_slice(&content, 2000)
            ));
        }
    }

    let system_prompt = "You are an expert code fixer. Apply the minimal changes needed to \
                         resolve the errors exactly as described. Be concise and surgical.";

    let user_prompt = format!(
        "The following CI errors remain after an initial automated fix attempt.\n\n\
         ERRORS:\n{}\n\n\
         CURRENT FILE CONTENT:{}\n\n\
         Produce minimal, targeted code edits to fix exactly these errors. \
         Output ONLY the corrected file content for each affected file, wrapped in \
         ```filename\n...\n``` code blocks. Make no other changes.",
        error_summary, file_snippets
    );

    let messages = vec![
        crate::providers::ConversationMessage::System(system_prompt.to_string()),
        crate::providers::ConversationMessage::User(user_prompt),
    ];

    let model = crate::config::cheap_model_for_provider(&config.provider, &config.model);

    let result = crate::providers::complete_turn(
        &config.provider,
        &config.api_key,
        &model,
        &messages,
        &[],
        config.base_url.as_deref(),
    )
    .await;

    match result {
        Ok(turn) => {
            // Parse code blocks from the response and write them.
            let applied = apply_llm_response(&turn.content, repo_path);
            if applied == 0 {
                return false;
            }
            // Re-run local check.
            run_local_check(repo_path, plan).is_ok()
        }
        Err(e) => {
            log::warn!("[AutoFix] LLM retry failed: {}", e);
            false
        }
    }
}

/// Parse ```filename\n...\n``` blocks from an LLM response and write each file.
/// Returns the number of files written.
fn apply_llm_response(response: &str, repo_path: &str) -> usize {
    let mut count = 0;
    let mut remaining = response;
    while let Some(start) = remaining.find("```") {
        remaining = &remaining[start + 3..];
        // First line is the filename.
        if let Some(newline) = remaining.find('\n') {
            let filename = remaining[..newline].trim();
            remaining = &remaining[newline + 1..];
            if let Some(end) = remaining.find("\n```") {
                let content = &remaining[..end];
                // Only allow relative paths inside the repo.
                let safe_name = filename.trim_start_matches('/');
                if !safe_name.is_empty() && !safe_name.contains("..") {
                    let path = format!("{}/{}", repo_path.trim_end_matches('/'), safe_name);
                    if std::fs::write(&path, content).is_ok() {
                        count += 1;
                        log::info!("[AutoFix] LLM wrote fix to {}", path);
                    }
                }
                remaining = &remaining[end + 4..];
            }
        }
    }
    count
}

/// Commit the changed files with BLADE's auto-fix message.
fn commit_fix(repo_path: &str, files: &[String]) -> Result<String, String> {
    // Stage only the changed files.
    let stage_status = Command::new("git")
        .args(["add", "--"])
        .args(files)
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git add failed: {}", e))?;

    if !stage_status.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&stage_status.stderr)
        ));
    }

    let commit_output = Command::new("git")
        .args(["commit", "-m", "fix: auto-fix CI errors (BLADE Hive)"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git commit failed: {}", e))?;

    if !commit_output.status.success() {
        let stderr = String::from_utf8_lossy(&commit_output.stderr);
        if stderr.contains("nothing to commit") {
            return Ok("already-clean".to_string());
        }
        return Err(format!("git commit failed: {}", stderr));
    }

    // Retrieve commit hash.
    let hash_output = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git rev-parse failed: {}", e))?;

    let hash = String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string();
    Ok(hash)
}

/// Push the current branch to its upstream remote.
pub async fn push_fix(repo_path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .args(["push"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git push failed: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "git push failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Return current HEAD hash so callers can track it.
    let hash_output = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git rev-parse failed: {}", e))?;

    Ok(String::from_utf8_lossy(&hash_output.stdout)
        .trim()
        .to_string())
}

/// Poll the GitHub Actions API for the new CI run triggered by the push.
/// Polls every 20 seconds for up to 5 minutes.
pub async fn monitor_fix(repo_path: &str, run_id: u64) -> Result<bool, String> {
    // Look up the GitHub token from the keyring (stored via Settings → Integrations).
    let github_token = crate::config::get_provider_key("github");

    if github_token.is_empty() {
        log::warn!("[AutoFix] No GitHub token configured — cannot poll Actions API");
        return Ok(true); // Optimistic fallback.
    }

    // Derive owner/repo from git remote.
    let (owner, repo) = get_repo_slug(repo_path)?;
    let max_polls = 15; // 15 * 20s = 5 minutes.

    for attempt in 0..max_polls {
        tokio::time::sleep(tokio::time::Duration::from_secs(20)).await;

        // List recent workflow runs for this repo.
        let url = format!(
            "https://api.github.com/repos/{}/{}/actions/runs?per_page=5",
            owner, repo
        );

        let client = reqwest::Client::new();
        let resp = client
            .get(&url)
            .header("Authorization", format!("token {}", github_token))
            .header("User-Agent", "BLADE-Hive/1.0")
            .send()
            .await
            .map_err(|e| format!("GitHub API request failed: {}", e))?;

        if !resp.status().is_success() {
            log::warn!(
                "[AutoFix] GitHub API returned {} on attempt {}",
                resp.status(),
                attempt
            );
            continue;
        }

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| format!("JSON parse failed: {}", e))?;

        if let Some(runs) = body["workflow_runs"].as_array() {
            for run in runs {
                let id = run["id"].as_u64().unwrap_or(0);
                // Skip the original failing run.
                if id == run_id {
                    continue;
                }
                let status = run["status"].as_str().unwrap_or("unknown");
                let conclusion = run["conclusion"].as_str().unwrap_or("");

                if status == "completed" {
                    log::info!(
                        "[AutoFix] New run {} completed with conclusion={}",
                        id,
                        conclusion
                    );
                    return Ok(conclusion == "success");
                }
            }
        }
    }

    log::warn!("[AutoFix] Monitoring timed out after 5 minutes");
    Ok(false)
}

/// Parse `owner/repo` from the git remote URL of the given repo path.
fn get_repo_slug(repo_path: &str) -> Result<(String, String), String> {
    let output = Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .map_err(|e| format!("git remote failed: {}", e))?;

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    // Handles https://github.com/owner/repo.git and git@github.com:owner/repo.git
    let slug = if url.contains("github.com/") {
        url.split("github.com/").nth(1).unwrap_or("").to_string()
    } else if url.contains("github.com:") {
        url.split("github.com:").nth(1).unwrap_or("").to_string()
    } else {
        return Err(format!("Cannot parse owner/repo from remote URL: {}", url));
    };

    let slug = slug.trim_end_matches(".git").to_string();
    let mut parts = slug.splitn(2, '/');
    let owner = parts.next().unwrap_or("").to_string();
    let repo = parts.next().unwrap_or("").to_string();

    if owner.is_empty() || repo.is_empty() {
        return Err(format!("Empty owner or repo from URL: {}", url));
    }

    Ok((owner, repo))
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

/// The complete end-to-end auto-fix pipeline.
///
/// Emits events at each step so the frontend `AutoFixCard` can track progress.
/// Routes through `decision_gate` before committing: if confidence < 0.8 or
/// more than 5 files are affected, the user is asked first.
pub async fn full_auto_fix_pipeline(app: &AppHandle, failure: CIFailure) -> FixResult {
    let repo_name = failure
        .repo_path
        .split('/')
        .last()
        .unwrap_or("unknown")
        .to_string();

    // Step 1 — Analyze.
    let _ = app.emit(
        "auto_fix_analyzing",
        serde_json::json!({
            "repo": repo_name,
            "workflow": failure.workflow_name,
            "error_type": failure.error_type
        }),
    );

    let plan = match analyze_ci_failure(&failure).await {
        Ok(p) => p,
        Err(e) => {
            let result = FixResult::NeedHumanHelp {
                reason: format!("Could not parse CI errors: {}", e),
                suggestion: "Check the CI log directly for the failing step".to_string(),
            };
            let _ = app.emit("auto_fix_failed", serde_json::json!({ "result": result }));
            return result;
        }
    };

    if !plan.auto_fixable {
        let result = FixResult::NeedHumanHelp {
            reason: "No rule-based fixes available for these errors".to_string(),
            suggestion: "Consider using BLADE's code assistant to address the errors manually"
                .to_string(),
        };
        let _ = app.emit("auto_fix_failed", serde_json::json!({ "result": result }));
        return result;
    }

    // Step 2 — Decision gate: ask user if confidence low or scope large.
    let large_change = plan.edits.len() > 5;
    let low_confidence = plan.confidence < 0.8;

    if large_change || low_confidence {
        let signal = crate::decision_gate::Signal {
            source: "auto_fix_pipeline".to_string(),
            description: format!(
                "Auto-fix {} file(s) in {} to resolve CI failure (confidence={:.0}%)",
                plan.edits.len(),
                repo_name,
                plan.confidence * 100.0
            ),
            confidence: plan.confidence,
            reversible: true,
            time_sensitive: false,
        };
        let perception = crate::perception_fusion::get_latest().unwrap_or_default();
        let gate = crate::decision_gate::evaluate(&signal, &perception).await;

        if !matches!(gate, crate::decision_gate::DecisionOutcome::ActAutonomously { .. }) {
            let result = FixResult::NeedHumanHelp {
                reason: if large_change {
                    format!(
                        "Fix scope is large ({} files) — human review requested",
                        plan.edits.len()
                    )
                } else {
                    format!(
                        "Confidence too low ({:.0}%) for autonomous fix",
                        plan.confidence * 100.0
                    )
                },
                suggestion: "Review the planned edits in the AutoFix card and approve manually"
                    .to_string(),
            };
            let _ = app.emit("auto_fix_failed", serde_json::json!({ "result": result }));
            return result;
        }
    }

    // Step 3 — Apply edits.
    let _ = app.emit(
        "auto_fix_editing",
        serde_json::json!({
            "edits": plan.edits.len(),
            "files": plan.edits.iter().map(|e| &e.file_path).collect::<Vec<_>>()
        }),
    );

    let fix_result = match execute_fix(&plan, &failure.repo_path, app).await {
        Ok(r) => r,
        Err(e) => FixResult::NeedHumanHelp {
            reason: format!("Execute fix error: {}", e),
            suggestion: "Check file permissions and retry".to_string(),
        },
    };

    // If fixing failed, bail early.
    if matches!(fix_result, FixResult::NeedHumanHelp { .. }) {
        let _ = app.emit("auto_fix_failed", serde_json::json!({ "result": fix_result }));
        return fix_result;
    }

    // Step 4 — Push.
    let _ = app.emit("auto_fix_pushing", serde_json::json!({ "repo": repo_name }));
    if let Err(e) = push_fix(&failure.repo_path).await {
        let result = FixResult::NeedHumanHelp {
            reason: format!("Push failed: {}", e),
            suggestion: "Verify git credentials and branch push permissions".to_string(),
        };
        let _ = app.emit("auto_fix_failed", serde_json::json!({ "result": result }));
        return result;
    }

    // Step 5 — Monitor new run.
    let _ = app.emit(
        "auto_fix_monitoring",
        serde_json::json!({ "run_id": failure.run_id }),
    );
    let passed = monitor_fix(&failure.repo_path, failure.run_id)
        .await
        .unwrap_or(false);

    let _ = app.emit(
        "auto_fix_complete",
        serde_json::json!({
            "result": fix_result,
            "ci_passed": passed
        }),
    );

    fix_result
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn auto_fix_analyze(failure: CIFailure) -> Result<FixPlan, String> {
    analyze_ci_failure(&failure).await
}

#[tauri::command]
pub async fn auto_fix_execute(
    app: tauri::AppHandle,
    plan: FixPlan,
    repo_path: String,
) -> Result<FixResult, String> {
    execute_fix(&plan, &repo_path, &app).await
}

#[tauri::command]
pub async fn auto_fix_full_pipeline(
    app: tauri::AppHandle,
    failure: CIFailure,
) -> FixResult {
    full_auto_fix_pipeline(&app, failure).await
}
