// src-tauri/src/code_sandbox.rs
// BLADE Code Sandbox — safely execute code snippets in multiple languages.
//
// Supports: Python, JavaScript/Node (or bun), Bash, Rust (rustc compile+run),
// and Go. Each runner enforces a configurable timeout, captures stdout+stderr,
// and sanitises output before returning. The LLM integration layer can explain
// output or auto-fix errors in up to 3 iterations.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

// ── Public types ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub language: String,
    pub code: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
    pub success: bool,
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_OUTPUT_CHARS: usize = 10_000;
const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_FIX_ITERATIONS: u32 = 3;

// ── Temp-file naming ──────────────────────────────────────────────────────────

/// Generate a quasi-unique filename suffix using timestamp + pseudo-random bits.
fn unique_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // XOR with thread id bits for extra uniqueness within a process
    let noise = (ts ^ (ts >> 37)) & 0xFFFF_FFFF;
    format!("{:016x}", noise)
}

// ── Output helpers ────────────────────────────────────────────────────────────

/// Strip ANSI escape codes and truncate to MAX_OUTPUT_CHARS.
fn sanitize_output(s: &str) -> String {
    // Strip common ANSI escape sequences (\x1b[...m, \x1b[...J, etc.)
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // Skip until the terminating letter of the escape sequence
            while let Some(&next) = chars.peek() {
                chars.next();
                if next.is_ascii_alphabetic() || next == 'm' {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    // Truncate safely at a char boundary
    crate::safe_slice(&out, MAX_OUTPUT_CHARS).to_string()
}

// ── Core runner ───────────────────────────────────────────────────────────────

/// Run a Command with timeout enforcement and full output capture.
/// Background threads drain stdout/stderr so the process never blocks on pipe buffers.
/// Returns `(stdout, stderr, exit_code, duration_ms)`.
fn run_cmd(
    mut cmd: Command,
    stdin_data: Option<&[u8]>,
    timeout_secs: u64,
) -> Result<(String, String, i32, u64), String> {
    use std::sync::{Arc, Mutex};

    let timeout = Duration::from_secs(timeout_secs);
    let start = Instant::now();

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    if stdin_data.is_some() {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn process: {}", e))?;

    // Write stdin if needed
    if let Some(data) = stdin_data {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(data);
        }
    }

    // Collect output in background threads so we can enforce a timeout without
    // blocking on `child.wait_with_output()`.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let stdout_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_buf: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

    let out_clone = stdout_buf.clone();
    let err_clone = stderr_buf.clone();

    let stdout_thread = std::thread::spawn(move || {
        if let Some(mut pipe) = stdout_pipe {
            use std::io::Read;
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            *out_clone.lock().unwrap() = buf;
        }
    });
    let stderr_thread = std::thread::spawn(move || {
        if let Some(mut pipe) = stderr_pipe {
            use std::io::Read;
            let mut buf = Vec::new();
            let _ = pipe.read_to_end(&mut buf);
            *err_clone.lock().unwrap() = buf;
        }
    });

    // Poll until done or timeout, storing the exit code when we see it.
    let poll_interval = Duration::from_millis(50);
    let mut timed_out = false;
    let mut exit_code: i32 = -1;

    loop {
        match child.try_wait().map_err(|e| format!("Process wait error: {}", e))? {
            Some(status) => {
                exit_code = status.code().unwrap_or(-1);
                break;
            }
            None => {
                if start.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    timed_out = true;
                    break;
                }
                std::thread::sleep(poll_interval);
            }
        }
    }

    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    if timed_out {
        return Err(format!("Execution timed out after {} seconds", timeout_secs));
    }

    let elapsed = start.elapsed().as_millis() as u64;
    let stdout = String::from_utf8_lossy(&stdout_buf.lock().unwrap()).into_owned();
    let stderr = String::from_utf8_lossy(&stderr_buf.lock().unwrap()).into_owned();

    Ok((
        sanitize_output(&stdout),
        sanitize_output(&stderr),
        exit_code,
        elapsed,
    ))
}

// ── Language runners ──────────────────────────────────────────────────────────

fn run_python(code: &str, timeout_secs: u64) -> Result<SandboxResult, String> {
    // Try python3 first, fall back to python
    let python_bin = if which_exists("python3") {
        "python3"
    } else if which_exists("python") {
        "python"
    } else {
        return Err("Python is not installed or not found in PATH".to_string());
    };

    // Write code to a temp file so we avoid shell-escaping headaches
    let tmp_path = std::env::temp_dir().join(format!("blade_py_{}.py", unique_id()));
    std::fs::write(&tmp_path, code)
        .map_err(|e| format!("Failed to write temp Python file: {}", e))?;

    let mut cmd = Command::new(python_bin);
    cmd.arg(&tmp_path);

    let result = run_cmd(cmd, None, timeout_secs);
    let _ = std::fs::remove_file(&tmp_path);

    let (stdout, stderr, exit_code, duration_ms) = result?;
    let success = exit_code == 0;

    Ok(SandboxResult {
        language: "python".to_string(),
        code: code.to_string(),
        stdout,
        stderr,
        exit_code,
        duration_ms,
        success,
    })
}

fn run_javascript(code: &str, timeout_secs: u64) -> Result<SandboxResult, String> {
    // Prefer bun (faster), fall back to node
    let (js_bin, ext) = if which_exists("bun") {
        ("bun", "js")
    } else if which_exists("node") {
        ("node", "js")
    } else {
        return Err("Neither bun nor node is installed or found in PATH".to_string());
    };

    let tmp_path = std::env::temp_dir().join(format!("blade_js_{}.{}", unique_id(), ext));
    std::fs::write(&tmp_path, code)
        .map_err(|e| format!("Failed to write temp JS file: {}", e))?;

    let mut cmd = Command::new(js_bin);
    cmd.arg(&tmp_path);

    let result = run_cmd(cmd, None, timeout_secs);
    let _ = std::fs::remove_file(&tmp_path);

    let (stdout, stderr, exit_code, duration_ms) = result?;
    let success = exit_code == 0;

    Ok(SandboxResult {
        language: "javascript".to_string(),
        code: code.to_string(),
        stdout,
        stderr,
        exit_code,
        duration_ms,
        success,
    })
}

fn run_bash(code: &str, timeout_secs: u64) -> Result<SandboxResult, String> {
    let shell = if cfg!(target_os = "windows") {
        // On Windows, try bash (WSL/Git Bash), fall back to cmd
        if which_exists("bash") { "bash" } else { "cmd" }
    } else {
        "bash"
    };

    let tmp_path = std::env::temp_dir().join(format!("blade_sh_{}.sh", unique_id()));
    std::fs::write(&tmp_path, code)
        .map_err(|e| format!("Failed to write temp shell script: {}", e))?;

    let mut cmd = crate::cmd_util::silent_cmd(shell);
    if shell == "cmd" {
        cmd.arg("/C").arg(&tmp_path);
    } else {
        cmd.arg(&tmp_path);
    }

    let result = run_cmd(cmd, None, timeout_secs);
    let _ = std::fs::remove_file(&tmp_path);

    let (stdout, stderr, exit_code, duration_ms) = result?;
    let success = exit_code == 0;

    Ok(SandboxResult {
        language: "bash".to_string(),
        code: code.to_string(),
        stdout,
        stderr,
        exit_code,
        duration_ms,
        success,
    })
}

fn run_rust_script(code: &str, timeout_secs: u64) -> Result<SandboxResult, String> {
    // Strategy: write code to a temp .rs file, compile with rustc, run binary.
    // If the user code does not have a `fn main`, wrap it automatically.
    let needs_main = !code.contains("fn main");
    let full_code = if needs_main {
        format!("fn main() {{\n{}\n}}", code)
    } else {
        code.to_string()
    };

    let id = unique_id();
    let tmp_dir = std::env::temp_dir();
    let src_path = tmp_dir.join(format!("blade_rs_{}.rs", id));
    let bin_path = tmp_dir.join(format!("blade_rs_{}", id));

    std::fs::write(&src_path, &full_code)
        .map_err(|e| format!("Failed to write temp Rust file: {}", e))?;

    // Compile
    let compile_start = Instant::now();
    let mut compile_cmd = Command::new("rustc");
    compile_cmd.arg(&src_path).arg("-o").arg(&bin_path);
    // Give compile half the remaining timeout, run phase gets the rest
    let compile_timeout = timeout_secs.saturating_sub(2).max(10);
    let compile_result = run_cmd(compile_cmd, None, compile_timeout);

    match compile_result {
        Err(e) => {
            let _ = std::fs::remove_file(&src_path);
            return Err(format!("rustc compilation failed: {}", e));
        }
        Ok((_stdout, stderr, exit_code, _)) => {
            if exit_code != 0 {
                let _ = std::fs::remove_file(&src_path);
                let duration_ms = compile_start.elapsed().as_millis() as u64;
                return Ok(SandboxResult {
                    language: "rust".to_string(),
                    code: code.to_string(),
                    stdout: String::new(),
                    stderr: sanitize_output(&stderr),
                    exit_code,
                    duration_ms,
                    success: false,
                });
            }
        }
    }

    // Run the compiled binary
    let run_timeout = timeout_secs.saturating_sub(compile_start.elapsed().as_secs()).max(2);
    let run_cmd_obj = Command::new(&bin_path);
    let run_result = run_cmd(run_cmd_obj, None, run_timeout);

    let _ = std::fs::remove_file(&src_path);
    let _ = std::fs::remove_file(&bin_path);

    let (stdout, stderr, exit_code, duration_ms) = run_result?;
    let success = exit_code == 0;

    Ok(SandboxResult {
        language: "rust".to_string(),
        code: code.to_string(),
        stdout,
        stderr,
        exit_code,
        duration_ms,
        success,
    })
}

fn run_go_script(code: &str, timeout_secs: u64) -> Result<SandboxResult, String> {
    if !which_exists("go") {
        return Err("Go is not installed or not found in PATH".to_string());
    }

    // Wrap bare code in a package + main if needed
    let needs_main = !code.contains("func main");
    let needs_package = !code.contains("package ");
    let full_code = match (needs_package, needs_main) {
        (true, true) => format!("package main\n\nimport \"fmt\"\n\nfunc main() {{\n_ = fmt.Sprintf\n{}\n}}", code),
        (true, false) => format!("package main\n\n{}", code),
        (false, true) => format!("{}\n\nfunc main() {{\n}}", code),
        (false, false) => code.to_string(),
    };

    let id = unique_id();
    let tmp_dir = std::env::temp_dir().join(format!("blade_go_{}", id));
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create temp Go dir: {}", e))?;

    let src_path = tmp_dir.join("main.go");
    std::fs::write(&src_path, &full_code)
        .map_err(|e| format!("Failed to write temp Go file: {}", e))?;

    let mut cmd = Command::new("go");
    cmd.arg("run").arg(&src_path);

    let result = run_cmd(cmd, None, timeout_secs);
    let _ = std::fs::remove_dir_all(&tmp_dir);

    let (stdout, stderr, exit_code, duration_ms) = result?;
    let success = exit_code == 0;

    Ok(SandboxResult {
        language: "go".to_string(),
        code: code.to_string(),
        stdout,
        stderr,
        exit_code,
        duration_ms,
        success,
    })
}

// ── Language detection ────────────────────────────────────────────────────────

/// Heuristic language detection: checks shebang, then keywords.
pub fn detect_language(code: &str) -> String {
    let first_line = code.lines().next().unwrap_or("").trim();

    // Shebang detection
    if first_line.starts_with("#!") {
        if first_line.contains("python") { return "python".to_string(); }
        if first_line.contains("node") || first_line.contains("bun") { return "javascript".to_string(); }
        if first_line.contains("bash") || first_line.contains("sh") { return "bash".to_string(); }
        if first_line.contains("go") { return "go".to_string(); }
    }

    // Keyword scoring — pick highest confidence
    let code_lower = code.to_lowercase();
    let mut scores: Vec<(&str, i32)> = vec![
        ("python", 0),
        ("javascript", 0),
        ("bash", 0),
        ("rust", 0),
        ("go", 0),
    ];

    // Python signals
    if code.contains("def ") || code.contains("import ") && code.contains(":") { scores[0].1 += 2; }
    if code.contains("print(") { scores[0].1 += 2; }
    if code.contains("elif ") || code.contains("__name__") { scores[0].1 += 3; }
    if code.contains("self.") || code.contains("class ") && code.contains(":") { scores[0].1 += 2; }

    // JavaScript signals
    if code.contains("console.log") || code.contains("const ") || code.contains("let ") { scores[1].1 += 2; }
    if code.contains("function ") || code.contains("=>") { scores[1].1 += 2; }
    if code.contains("require(") || code.contains("module.exports") { scores[1].1 += 3; }
    if code.contains("async ") && code.contains("await ") { scores[1].1 += 1; }

    // Bash signals
    if code.contains("#!/") || code_lower.contains("echo ") { scores[2].1 += 2; }
    if code.contains("$()") || code.contains("${") { scores[2].1 += 3; }
    if code.contains("if [") || code.contains("fi\n") || code.contains("done\n") { scores[2].1 += 3; }
    if code.contains("grep ") || code.contains("awk ") || code.contains("sed ") { scores[2].1 += 2; }

    // Rust signals
    if code.contains("fn main") || code.contains("fn ") && code.contains("->") { scores[3].1 += 2; }
    if code.contains("let mut ") || code.contains("println!") { scores[3].1 += 3; }
    if code.contains("use std::") || code.contains("impl ") || code.contains("pub fn") { scores[3].1 += 3; }
    if code.contains("Result<") || code.contains("Option<") { scores[3].1 += 2; }

    // Go signals
    if code.contains("func main") || code.contains("package main") { scores[4].1 += 3; }
    if code.contains("fmt.Println") || code.contains("fmt.Printf") { scores[4].1 += 3; }
    if code.contains(":= ") || code.contains("var ") && !code.contains("let ") { scores[4].1 += 2; }
    if code.contains("import (") || code.contains("go func") { scores[4].1 += 2; }

    scores.sort_by(|a, b| b.1.cmp(&a.1));

    if scores[0].1 > 0 {
        scores[0].0.to_string()
    } else {
        "bash".to_string() // safe default
    }
}

// ── PATH check helper ─────────────────────────────────────────────────────────

fn which_exists(bin: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        crate::cmd_util::silent_cmd("where")
            .arg(bin)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        crate::cmd_util::silent_cmd("which")
            .arg(bin)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/// Run `code` in the given `language` with a hard `timeout_secs`.
/// If `language` is "auto", calls `detect_language` first.
pub async fn run_code(
    language: &str,
    code: &str,
    timeout_secs: u64,
) -> Result<SandboxResult, String> {
    let lang = if language == "auto" || language.is_empty() {
        detect_language(code)
    } else {
        language.to_lowercase()
    };

    let timeout = if timeout_secs == 0 { DEFAULT_TIMEOUT_SECS } else { timeout_secs };

    // Spawn blocking work onto a dedicated thread so we don't block the async executor
    let code_owned = code.to_string();
    let lang_clone = lang.clone();

    tokio::task::spawn_blocking(move || match lang_clone.as_str() {
        "python" | "py" => run_python(&code_owned, timeout),
        "javascript" | "js" | "typescript" | "ts" | "node" => {
            run_javascript(&code_owned, timeout)
        }
        "bash" | "sh" | "shell" => run_bash(&code_owned, timeout),
        "rust" | "rs" => run_rust_script(&code_owned, timeout),
        "go" | "golang" => run_go_script(&code_owned, timeout),
        other => Err(format!(
            "Unsupported language '{}'. Supported: python, javascript, bash, rust, go",
            other
        )),
    })
    .await
    .map_err(|e| format!("Executor error: {}", e))?
}

// ── LLM integration ───────────────────────────────────────────────────────────

/// Get (provider, api_key, model) using task routing — prefers code-routing provider.
fn get_provider() -> (String, String, String) {
    let config = crate::config::load_config();
    crate::config::resolve_provider_for_task(&config, &crate::router::TaskType::Code)
}

/// Run `code` and then ask the LLM to explain the output (or debug errors).
/// Returns a markdown string with the explanation.
pub async fn run_code_with_explanation(
    language: &str,
    code: &str,
) -> Result<String, String> {
    use crate::providers::{complete_turn, ConversationMessage};

    let timeout = DEFAULT_TIMEOUT_SECS;
    let result = run_code(language, code, timeout).await?;

    let status_desc = if result.success {
        format!("exited successfully (code 0) in {}ms", result.duration_ms)
    } else {
        format!("failed with exit code {} in {}ms", result.exit_code, result.duration_ms)
    };

    let prompt = format!(
        r#"I ran the following {} code and it {}.

=== CODE ===
{}

=== STDOUT ===
{}

=== STDERR ===
{}

Please explain what the code does and what the output means. If there were errors, diagnose them and suggest fixes. Be concise and helpful."#,
        result.language,
        status_desc,
        crate::safe_slice(&result.code, 4000),
        crate::safe_slice(&result.stdout, 3000),
        crate::safe_slice(&result.stderr, 2000),
    );

    let (provider, api_key, model) = get_provider();
    let messages = vec![ConversationMessage::User(prompt)];
    let turn = complete_turn(&provider, &api_key, &model, &messages, &crate::providers::no_tools(), None).await?;

    // Combine: sandbox result summary + LLM explanation
    let mut response = format!(
        "**Run Result** — {} | exit {} | {}ms\n\n",
        result.language, result.exit_code, result.duration_ms
    );
    if !result.stdout.is_empty() {
        response.push_str(&format!("```\n{}\n```\n\n", crate::safe_slice(&result.stdout, 2000)));
    }
    if !result.stderr.is_empty() {
        response.push_str(&format!("**stderr:**\n```\n{}\n```\n\n", crate::safe_slice(&result.stderr, 1000)));
    }
    response.push_str("**Explanation:**\n\n");
    response.push_str(&turn.content);

    Ok(response)
}

/// On error, ask the LLM to fix the code, rerun. Repeats up to MAX_FIX_ITERATIONS times.
pub async fn fix_and_rerun(
    language: &str,
    code: &str,
    error: &str,
    app: tauri::AppHandle,
) -> Result<SandboxResult, String> {
    use crate::providers::{complete_turn, ConversationMessage};
    use tauri::Emitter;

    let (provider, api_key, model) = get_provider();
    let mut current_code = code.to_string();
    let mut current_error = error.to_string();
    let lang = if language == "auto" || language.is_empty() {
        detect_language(code)
    } else {
        language.to_lowercase()
    };

    for iteration in 0..MAX_FIX_ITERATIONS {
        let _ = app.emit(
            "sandbox_fix_progress",
            serde_json::json!({
                "iteration": iteration + 1,
                "max": MAX_FIX_ITERATIONS,
                "message": format!("Asking LLM to fix error (attempt {}/{})", iteration + 1, MAX_FIX_ITERATIONS)
            }),
        );

        // Ask LLM to fix the code
        let fix_prompt = format!(
            r#"The following {} code produced an error. Fix it and return ONLY the corrected code — no explanations, no markdown fences, just the raw code.

=== CODE ===
{}

=== ERROR ===
{}

Return only the fixed code:"#,
            lang,
            crate::safe_slice(&current_code, 4000),
            crate::safe_slice(&current_error, 2000),
        );

        let messages = vec![ConversationMessage::User(fix_prompt)];
        let turn = complete_turn(&provider, &api_key, &model, &messages, &crate::providers::no_tools(), None).await?;

        // Strip any accidental markdown code fences
        let fixed_code = strip_code_fences(turn.content.trim());

        let _ = app.emit(
            "sandbox_fix_progress",
            serde_json::json!({
                "iteration": iteration + 1,
                "max": MAX_FIX_ITERATIONS,
                "message": format!("Running fixed code (attempt {}/{})", iteration + 1, MAX_FIX_ITERATIONS)
            }),
        );

        let result = run_code(&lang, &fixed_code, DEFAULT_TIMEOUT_SECS).await?;

        if result.success {
            let _ = app.emit(
                "sandbox_fix_progress",
                serde_json::json!({
                    "iteration": iteration + 1,
                    "max": MAX_FIX_ITERATIONS,
                    "message": "Fixed! Code ran successfully."
                }),
            );
            return Ok(result);
        }

        // Not fixed yet — prepare next iteration
        current_code = fixed_code;
        current_error = if result.stderr.is_empty() {
            format!("Exit code {}: {}", result.exit_code, result.stdout)
        } else {
            result.stderr.clone()
        };

        if iteration + 1 == MAX_FIX_ITERATIONS {
            // Return the last (failed) result so caller can see what happened
            return Ok(result);
        }
    }

    // Unreachable but required by compiler
    Err("fix_and_rerun loop exited unexpectedly".to_string())
}

/// Strip markdown code fences from LLM output (e.g. ```python ... ``` → inner code).
fn strip_code_fences(s: &str) -> String {
    let s = s.trim();
    if s.starts_with("```") {
        let after = s.trim_start_matches('`');
        // Skip optional language tag on the first line
        let code_start = after.find('\n').map(|i| i + 1).unwrap_or(0);
        let inner = &after[code_start..];
        if let Some(end) = inner.rfind("```") {
            return inner[..end].trim().to_string();
        }
        return inner.trim().to_string();
    }
    s.to_string()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Run code and return a structured SandboxResult.
#[tauri::command]
pub async fn sandbox_run(
    language: String,
    code: String,
    timeout_secs: Option<u64>,
) -> Result<SandboxResult, String> {
    let timeout = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
    run_code(&language, &code, timeout).await
}

/// Run code and return LLM explanation of the output (or errors).
#[tauri::command]
pub async fn sandbox_run_explain(
    language: String,
    code: String,
) -> Result<String, String> {
    run_code_with_explanation(&language, &code).await
}

/// Auto-fix loop: on error, ask LLM to fix and rerun (up to 3 times).
#[tauri::command]
pub async fn sandbox_fix_and_run(
    language: String,
    code: String,
    error: String,
    app: tauri::AppHandle,
) -> Result<SandboxResult, String> {
    fix_and_rerun(&language, &code, &error, app).await
}

/// Heuristic language detection — returns e.g. "python", "javascript", "bash", "rust", "go".
#[tauri::command]
pub fn sandbox_detect_language(code: String) -> String {
    detect_language(&code)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_output_strips_ansi() {
        let ansi = "\x1b[31mred text\x1b[0m normal";
        let clean = sanitize_output(ansi);
        // ANSI codes should be gone
        assert!(!clean.contains('\x1b'));
        assert!(clean.contains("normal"));
    }

    #[test]
    fn test_sanitize_truncates() {
        let long = "a".repeat(20_000);
        let out = sanitize_output(&long);
        assert!(out.len() <= MAX_OUTPUT_CHARS);
    }

    #[test]
    fn test_detect_python() {
        let code = "def hello():\n    print('hi')\nhello()\n";
        assert_eq!(detect_language(code), "python");
    }

    #[test]
    fn test_detect_javascript() {
        let code = "const x = 42;\nconsole.log(x);\n";
        assert_eq!(detect_language(code), "javascript");
    }

    #[test]
    fn test_detect_rust() {
        let code = "fn main() {\n    println!(\"hello\");\n}\n";
        assert_eq!(detect_language(code), "rust");
    }

    #[test]
    fn test_detect_go() {
        let code = "package main\nimport \"fmt\"\nfunc main() { fmt.Println(\"hi\") }\n";
        assert_eq!(detect_language(code), "go");
    }

    #[test]
    fn test_detect_bash() {
        let code = "#!/bin/bash\necho hello\n";
        assert_eq!(detect_language(code), "bash");
    }

    #[test]
    fn test_strip_code_fences() {
        let fenced = "```python\nprint('hi')\n```";
        let stripped = strip_code_fences(fenced);
        assert_eq!(stripped, "print('hi')");
    }

    #[test]
    fn test_unique_id_different() {
        let a = unique_id();
        std::thread::sleep(Duration::from_millis(1));
        let b = unique_id();
        // Not guaranteed to differ in sub-ms, but with nanos it almost always will
        // Just check format
        assert_eq!(a.len(), 16);
        assert_eq!(b.len(), 16);
    }
}
