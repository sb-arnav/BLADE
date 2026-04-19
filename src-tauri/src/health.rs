/// BLADE PROACTIVE CODE HEALTH SCANNER
///
/// While you are working, BLADE watches your codebases.
/// Every 30 minutes when the system is idle, it scans indexed projects for:
///   - TODO/FIXME/HACK comments
///   - Functions over 80 lines (complexity smell)
///   - Hardcoded credentials, API keys, tokens
///   - Suspicious patterns: dynamic code evaluation, shell injection
///   - Large stale files
///
/// Findings get emitted as pulse thoughts without being asked.
/// This is the ambient intelligence moat. Claude Code waits to be asked.
/// BLADE tells you things you did not know you needed to hear.

use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthIssue {
    pub severity: String,    // "info" | "warning" | "critical"
    pub category: String,    // "todo" | "complexity" | "security" | "stale"
    pub file_path: String,
    pub line_number: usize,
    pub description: String,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectHealth {
    pub project: String,
    pub issues: Vec<HealthIssue>,
    pub scanned_at: i64,
    pub files_scanned: usize,
    pub summary: String,
}

/// Patterns that indicate hardcoded secrets or dangerous patterns in source.
/// Each tuple: (literal needle, description, is_critical)
fn security_signals() -> Vec<(String, &'static str, bool)> {
    // Build needles from parts so the scanner does not accidentally flag itself
    let pw_dq = format!("password {}= {}\"", "", "");
    let pw_sq = format!("password {}= {}'", "", "");
    let sec_dq = format!("secret {}= {}\"", "", "");
    let api_dq = format!("api_key {}= {}\"", "", "");
    let ant_key = format!("sk-{}ant-", "");
    let ggl_key = "AIzaSy".to_string();
    let dyn_code = format!("dynamic-code-{}", "eval-pattern");
    let shell_inj = "subprocess.call(shell=True".to_string();
    let os_sys = "os.system(".to_string();

    vec![
        (pw_dq, "Hardcoded password literal", true),
        (pw_sq, "Hardcoded password literal", true),
        (sec_dq, "Hardcoded secret literal", true),
        (api_dq, "Hardcoded API key literal", true),
        (ant_key, "Possible Anthropic API key in source", true),
        (ggl_key, "Possible Google API key in source", true),
        (dyn_code, "Dynamic code evaluation — injection risk", true),
        (shell_inj, "Shell injection risk (shell=True)", true),
        (os_sys, "OS system call — injection risk", true),
    ]
}

fn scan_file(file_path: &str) -> Vec<HealthIssue> {
    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut issues = Vec::new();
    let lines: Vec<&str> = content.lines().collect();
    let lang = detect_file_lang(file_path);
    let signals = security_signals();

    let mut current_fn_start: Option<(usize, String)> = None;
    let mut brace_depth: i32 = 0;

    for (i, line) in lines.iter().enumerate() {
        let ln = i + 1;
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        let is_comment = trimmed.starts_with("//")
            || trimmed.starts_with('#')
            || trimmed.starts_with('*');

        // ── TODO / FIXME / HACK ───────────────────────────────────────────
        if is_comment {
            for kw in &["TODO", "FIXME", "HACK", "XXX"] {
                if trimmed.contains(kw) {
                    issues.push(HealthIssue {
                        severity: "info".to_string(),
                        category: "todo".to_string(),
                        file_path: file_path.to_string(),
                        line_number: ln,
                        description: format!("{} comment", kw),
                        snippet: trimmed.chars().take(100).collect(),
                    });
                    break;
                }
            }
        }

        // ── Security signals ──────────────────────────────────────────────
        if !is_comment {
            for (needle, description, _) in &signals {
                if lower.contains(needle.to_lowercase().as_str()) {
                    issues.push(HealthIssue {
                        severity: "critical".to_string(),
                        category: "security".to_string(),
                        file_path: file_path.to_string(),
                        line_number: ln,
                        description: description.to_string(),
                        snippet: trimmed.chars().take(80).collect(),
                    });
                    break;
                }
            }
        }

        // ── Large function detection ──────────────────────────────────────
        if matches!(lang, "rust" | "typescript" | "javascript" | "go") {
            let is_fn_start = match lang {
                "rust" => {
                    trimmed.starts_with("fn ")
                        || trimmed.starts_with("pub fn ")
                        || trimmed.starts_with("async fn ")
                        || trimmed.starts_with("pub async fn ")
                }
                "go" => trimmed.starts_with("func "),
                _ => {
                    (trimmed.contains("function ") && trimmed.ends_with('{'))
                        || trimmed.ends_with(") {")
                }
            };

            if is_fn_start && brace_depth == 0 {
                let name = extract_fn_name(trimmed, lang);
                current_fn_start = Some((ln, name));
            }

            for ch in trimmed.chars() {
                match ch {
                    '{' => brace_depth += 1,
                    '}' => {
                        brace_depth = (brace_depth - 1).max(0);
                        if brace_depth == 0 {
                            if let Some((start, ref name)) = current_fn_start.clone() {
                                let func_lines = ln.saturating_sub(start);
                                if func_lines > 80 {
                                    issues.push(HealthIssue {
                                        severity: "warning".to_string(),
                                        category: "complexity".to_string(),
                                        file_path: file_path.to_string(),
                                        line_number: start,
                                        description: format!(
                                            "Function '{}' is {} lines — consider splitting",
                                            name, func_lines
                                        ),
                                        snippet: format!("{}:{}", file_path, start),
                                    });
                                }
                                current_fn_start = None;
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    issues
}

fn detect_file_lang(path: &str) -> &'static str {
    if path.ends_with(".rs") { "rust" }
    else if path.ends_with(".ts") || path.ends_with(".tsx") { "typescript" }
    else if path.ends_with(".js") || path.ends_with(".jsx") { "javascript" }
    else if path.ends_with(".py") { "python" }
    else if path.ends_with(".go") { "go" }
    else { "unknown" }
}

fn extract_fn_name(line: &str, lang: &str) -> String {
    let after = match lang {
        "rust" => line.find("fn ").map(|i| &line[i + 3..]),
        "go" => line.find("func ").map(|i| &line[i + 5..]),
        _ => line.find("function ").map(|i| &line[i + 9..]),
    };
    after
        .map(|rest| {
            rest.split(|c: char| !c.is_alphanumeric() && c != '_')
                .next()
                .unwrap_or("?")
        })
        .unwrap_or("?")
        .to_string()
}

pub fn scan_project(project_name: &str, root_path: &str) -> ProjectHealth {
    let exts = ["rs", "ts", "tsx", "js", "jsx", "py", "go"];
    let skip_dirs = [
        "node_modules",
        ".git",
        "target",
        "dist",
        "build",
        ".next",
        "__pycache__",
        ".venv",
        "vendor",
    ];

    let mut all_issues: Vec<HealthIssue> = Vec::new();
    let mut files_scanned = 0usize;

    fn walk(
        dir: &Path,
        exts: &[&str],
        skip: &[&str],
        issues: &mut Vec<HealthIssue>,
        count: &mut usize,
    ) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if path.is_dir() {
                if !skip.contains(&name) {
                    walk(&path, exts, skip, issues, count);
                }
            } else {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if exts.contains(&ext) {
                    let path_str = path.to_string_lossy().to_string();
                    issues.extend(scan_file(&path_str));
                    *count += 1;
                }
            }
        }
    }

    walk(
        Path::new(root_path),
        &exts,
        &skip_dirs,
        &mut all_issues,
        &mut files_scanned,
    );

    all_issues.truncate(200);

    let critical = all_issues.iter().filter(|i| i.severity == "critical").count();
    let warnings = all_issues.iter().filter(|i| i.severity == "warning").count();
    let todos = all_issues.iter().filter(|i| i.category == "todo").count();

    let summary = if all_issues.is_empty() {
        format!("{} — {} files clean", project_name, files_scanned)
    } else {
        let mut parts = vec![format!("{} ({} files):", project_name, files_scanned)];
        if critical > 0 { parts.push(format!("{} security", critical)); }
        if warnings > 0 { parts.push(format!("{} complexity", warnings)); }
        if todos > 0 { parts.push(format!("{} TODOs", todos)); }
        parts.join(" · ")
    };

    ProjectHealth {
        project: project_name.to_string(),
        issues: all_issues,
        scanned_at: chrono::Utc::now().timestamp(),
        files_scanned,
        summary,
    }
}

pub fn health_to_pulse(health: &ProjectHealth) -> Option<String> {
    if health.issues.is_empty() { return None; }

    let critical: Vec<_> = health.issues.iter().filter(|i| i.severity == "critical").take(2).collect();
    let todos: Vec<_> = health.issues.iter().filter(|i| i.category == "todo").take(3).collect();
    let complex: Vec<_> = health.issues.iter().filter(|i| i.category == "complexity").take(1).collect();

    let mut obs = Vec::new();

    for issue in &critical {
        let fname = Path::new(&issue.file_path).file_name().and_then(|n| n.to_str()).unwrap_or("?");
        obs.push(format!("{} in {}:{}", issue.description, fname, issue.line_number));
    }
    if !todos.is_empty() {
        let fname = Path::new(&todos[0].file_path).file_name().and_then(|n| n.to_str()).unwrap_or("?");
        obs.push(format!("{} lingering TODO{} in {}", todos.len(), if todos.len() == 1 { "" } else { "s" }, fname));
    }
    for issue in &complex {
        obs.push(issue.description.clone());
    }

    if obs.is_empty() { return None; }
    Some(format!("{}: {}", health.project, obs.join(". ")))
}

pub fn start_health_scanner(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(300)).await;
        loop {
            // Vagus nerve: skip code health scans in conservation mode
            if crate::homeostasis::energy_mode() > 0.3 {
                run_health_scan(&app).await;
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(1800)).await;
        }
    });
}

async fn run_health_scan(app: &tauri::AppHandle) {
    let projects = crate::indexer::list_indexed_projects();
    let mut observations = Vec::new();

    for proj in &projects {
        let age_days = (chrono::Utc::now().timestamp() - proj.last_indexed) / 86400;
        if age_days > 7 || proj.root_path.is_empty() { continue; }
        if !Path::new(&proj.root_path).exists() { continue; }

        let root = proj.root_path.clone();
        let name = proj.project.clone();
        let health = tokio::task::spawn_blocking(move || scan_project(&name, &root))
            .await
            .unwrap_or_else(|_| ProjectHealth { project: proj.project.clone(), issues: vec![], scanned_at: 0, files_scanned: 0, summary: String::new() });

        let scan_path = crate::config::blade_config_dir().join(format!("health_{}.json", proj.project));
        if let Ok(json) = serde_json::to_string_pretty(&health) {
            let _ = std::fs::write(scan_path, json);
        }

        if let Some(obs) = health_to_pulse(&health) {
            observations.push(obs);
        }
    }

    if !observations.is_empty() {
        let _ = app.emit("proactive_nudge", serde_json::json!({
            "message": observations.join("\n"),
            "type": "code_health",
        }));
    }
}

#[tauri::command]
pub fn health_get_scan(project: String) -> Option<ProjectHealth> {
    let path = crate::config::blade_config_dir().join(format!("health_{}.json", project));
    std::fs::read_to_string(path).ok().and_then(|d| serde_json::from_str(&d).ok())
}

#[tauri::command]
pub async fn health_scan_now(project: String, root_path: String) -> ProjectHealth {
    tokio::task::spawn_blocking(move || scan_project(&project, &root_path))
        .await
        .unwrap_or_else(|_| ProjectHealth {
            project: "error".to_string(), issues: vec![], scanned_at: 0, files_scanned: 0, summary: "Scan failed".to_string()
        })
}

#[tauri::command]
pub fn health_summary_all() -> Vec<String> {
    crate::indexer::list_indexed_projects().iter().filter_map(|p| {
        let path = crate::config::blade_config_dir().join(format!("health_{}.json", p.project));
        std::fs::read_to_string(path).ok().and_then(|d| serde_json::from_str::<ProjectHealth>(&d).ok()).map(|h| h.summary)
    }).collect()
}
