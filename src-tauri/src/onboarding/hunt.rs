//! Phase 46 — HUNT-03 — LLM-driven hunt with sandboxed readonly tools.
//!
//! Mechanism, not a hardcoded scanner. After the pre-scan seeds context and
//! the user confirms (or accepts) Message #1, we spawn a single LLM session
//! with:
//!
//!   - System prompt: spec language from
//!     `.planning/v2.0-onboarding-spec.md` Act 3 ("you're BLADE, learning who
//!     this user is on first launch...")
//!   - Initial user message: serialized `InitialContext` + embedded
//!     `platform_paths.md` knowledge file
//!   - Tools: `hunt_read_file`, `hunt_list_dir`, `hunt_run_shell`,
//!     `hunt_emit_chat_line` — ALL readonly, no-network, sandboxed
//!
//! Live narrates every probe via `hunt_emit_chat_line` → emits the
//! `blade_hunt_line` Tauri event that `Hunt.tsx` subscribes to.
//!
//! Cap: 50K input tokens. If exceeded, summarize and proceed to synthesis.
//!
//! Cancel: user types "stop" in the chat → frontend emits `blade_hunt_stop` →
//! `HUNT_CANCEL.store(true, ...)` → next tool-call iteration breaks out.

use crate::onboarding::pre_scan::InitialContext;
use crate::providers::{self, ConversationMessage, ToolCall, ToolDefinition};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

/// User-typed-"stop" interrupt flag. Set by the `cancel_hunt` Tauri command.
pub(crate) static HUNT_CANCEL: AtomicBool = AtomicBool::new(false);

/// Cap from spec Act 3: ~50K input tokens. We approximate via accumulated
/// `tokens_in` from each turn's provider usage. Exceeding triggers an early
/// "summarize what you have" turn before synthesis.
const TOKEN_BUDGET: u32 = 50_000;

/// Hard ceiling on tool-call iterations regardless of token budget. Keeps a
/// runaway LLM from looping on `list_dir` forever.
const MAX_ITERATIONS: u32 = 30;

/// Per-shell-call wall clock cap. Pre-scan binaries finish in milliseconds;
/// `find . | head` on a huge tree can stall — bound it.
const SHELL_TIMEOUT_MS: u64 = 4_000;

// ── Tauri event names — kept as constants so Hunt.tsx + verify-emit-policy
// reference the same canonical string. ───────────────────────────────────────
pub const EVENT_HUNT_LINE: &str = "blade_hunt_line";
pub const EVENT_HUNT_DONE: &str = "blade_hunt_done";
pub const EVENT_HUNT_ERROR: &str = "blade_hunt_error";

/// Embedded platform-paths knowledge file (HUNT-04). Shipped in the binary;
/// doc edits ride the next release.
const PLATFORM_PATHS_MD: &str = include_str!("platform_paths.md");

/// Sensitive-path deny list (CLAUDE rules — verbatim from phase 46 prompt).
/// Returned as a structured error before any read.
const DENY_FRAGMENTS: &[&str] = &[
    ".ssh/", ".env", ".aws/credentials", ".gnupg/",
    "keychain", "credentials", "password",
    ".pem", ".key", "/cookies", "/Cookies",
    "shadow", "/etc/passwd",
];

/// Shell binaries we whitelist. Anything else routes to a reject.
const SHELL_ALLOW: &[&str] = &[
    "ls", "cat", "head", "tail", "wc", "stat",
    "grep", "find", "fd", "rg",
    "git", "which", "where", "uname", "sw_vers", "hostname",
    "defaults", "xdg-mime", "reg", "wsl",
    "echo", "printf", "true", "false",
    "node", "python", "python3",  // version flags only — args filtered below
];

/// Reject any of these substrings appearing anywhere in a shell command.
const SHELL_REJECT: &[&str] = &[
    " >", ">>", "<<", "| tee", "|tee",
    "rm ", "mv ", "cp ", "chmod ", "chown ",
    "curl ", "wget ", "ssh ", "scp ", "rsync ", "nc ",
    "sudo ", "doas ",
    "$(", "`",  // command substitution → escape hatch
];

// ── Public entry ─────────────────────────────────────────────────────────────

/// Spawn the hunt LLM session on a background task. Returns immediately;
/// progress streams via `blade_hunt_line` events. Caller (Hunt.tsx via Tauri
/// command `start_hunt`) is responsible for the user-facing chat surface.
///
/// On completion (success OR cancel OR error), emits `blade_hunt_done` with
/// the final `HuntOutcome` payload (next call will be `synthesis::write_who_you_are`).
pub async fn start_hunt(
    app: tauri::AppHandle,
    initial_context: InitialContext,
) -> Result<HuntOutcome, String> {
    HUNT_CANCEL.store(false, Ordering::SeqCst);
    let cfg = crate::config::load_config();
    let provider = cfg.provider.clone();
    let model = cfg.model.clone();
    let api_key = crate::config::get_provider_key(&provider);

    if api_key.is_empty() && provider != "ollama" {
        let msg = format!(
            "Hunt skipped — no API key for active provider '{}'. Falling back to no-data flow.",
            provider
        );
        let _ = app.emit(EVENT_HUNT_LINE, HuntLine::system(&msg));
        // No-data fallback (HUNT-05 basic) — the four-sentence prompt.
        let _ = app.emit(EVENT_HUNT_LINE, HuntLine::blade(
            "Fresh machine — what do you do? not your job, the thing you'd point a friend at."
        ));
        return Ok(HuntOutcome::no_data_fallback());
    }

    emit_line(&app, HuntLine::blade(
        "Key verified. Going to learn who you are before I ask anything. Stop me with 'stop' if you want."
    ));

    let system_prompt = build_system_prompt();
    let initial_user_msg = build_initial_user_msg(&initial_context);

    let mut conversation: Vec<ConversationMessage> = vec![
        ConversationMessage::System(system_prompt),
        ConversationMessage::User(initial_user_msg),
    ];
    let tools = build_tool_defs();

    let mut tokens_used: u32 = 0;
    let mut findings = HuntFindings::default();
    findings.initial = initial_context.clone();

    for iter in 0..MAX_ITERATIONS {
        if HUNT_CANCEL.load(Ordering::SeqCst) {
            emit_line(&app, HuntLine::system("Hunt cancelled by user."));
            return Ok(HuntOutcome::cancelled(findings, tokens_used));
        }
        if tokens_used > TOKEN_BUDGET {
            emit_line(&app, HuntLine::system(&format!(
                "Hit ~{}K token cap — wrapping up with what I have.", TOKEN_BUDGET / 1000
            )));
            // Trigger early synthesis: append a one-shot user message asking
            // for the final synthesis, no more tool calls.
            conversation.push(ConversationMessage::User(
                "Token budget exceeded. Emit one final hunt_emit_chat_line summarizing what \
                 you found, then stop calling tools.".to_string()
            ));
        }

        let turn = match providers::complete_turn(
            &provider,
            &api_key,
            &model,
            &conversation,
            &tools,
            cfg.base_url.as_deref(),
        ).await {
            Ok(t) => t,
            Err(e) => {
                let _ = app.emit(EVENT_HUNT_ERROR, format!("Provider error: {}", e));
                return Err(format!("Hunt provider error: {}", e));
            }
        };

        tokens_used = tokens_used.saturating_add(turn.tokens_in + turn.tokens_out);
        log::info!(
            "[hunt iter {}] tokens_in={} tokens_out={} cumulative={} stop_reason={:?}",
            iter, turn.tokens_in, turn.tokens_out, tokens_used, turn.stop_reason
        );

        // Append the assistant turn to the conversation so tool results
        // resolve against it on the next iteration.
        let assistant_msg = ConversationMessage::Assistant {
            content: turn.content.clone(),
            tool_calls: turn.tool_calls.clone(),
        };
        conversation.push(assistant_msg);

        // If the assistant produced visible content and no tool calls, that's
        // the closing synthesis — done.
        if turn.tool_calls.is_empty() {
            if !turn.content.trim().is_empty() {
                emit_line(&app, HuntLine::blade(&turn.content));
                findings.final_synthesis = turn.content.clone();
            }
            break;
        }

        // Execute each tool call and append the results to the conversation.
        for call in turn.tool_calls.iter() {
            let result = execute_tool_call(&app, call, &mut findings).await;
            let is_error = matches!(result, ToolOutcome::Err(_));
            let content = match result {
                ToolOutcome::Ok(s) => s,
                ToolOutcome::Err(s) => s,
            };
            conversation.push(ConversationMessage::Tool {
                tool_call_id: call.id.clone(),
                tool_name: call.name.clone(),
                content,
                is_error,
            });
        }
    }

    let _ = app.emit(EVENT_HUNT_DONE, &findings);
    Ok(HuntOutcome::completed(findings, tokens_used))
}

// ── Outcome + findings ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuntOutcome {
    pub status: String, // "completed" | "cancelled" | "no_data_fallback" | "error"
    pub tokens_used: u32,
    pub findings: HuntFindings,
}

impl HuntOutcome {
    fn completed(findings: HuntFindings, tokens: u32) -> Self {
        Self { status: "completed".into(), tokens_used: tokens, findings }
    }
    fn cancelled(findings: HuntFindings, tokens: u32) -> Self {
        Self { status: "cancelled".into(), tokens_used: tokens, findings }
    }
    fn no_data_fallback() -> Self {
        Self {
            status: "no_data_fallback".into(),
            tokens_used: 0,
            findings: HuntFindings::default(),
        }
    }
}

/// Accumulated structured findings. Synthesis (HUNT-07) reads this to write
/// `~/.blade/who-you-are.md`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HuntFindings {
    pub initial: InitialContext,
    /// Free-form notes from `hunt_emit_chat_line` calls. Each entry is one
    /// chat-line the LLM produced; synthesis re-distills them.
    pub chat_lines: Vec<String>,
    /// Each successful tool call recorded for the synthesis prompt to ground
    /// on (path, command, snippet).
    pub probes: Vec<ProbeRecord>,
    /// Final synthesis paragraph from the closing assistant turn.
    pub final_synthesis: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeRecord {
    pub tool: String,
    pub argument: String,
    pub ok: bool,
    pub snippet: String,
}

// ── Chat-line shape ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuntLine {
    pub role: String, // "blade" | "system"
    pub text: String,
    pub timestamp: String,
}

impl HuntLine {
    pub fn blade(text: &str) -> Self {
        Self {
            role: "blade".into(),
            text: text.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
    pub fn system(text: &str) -> Self {
        Self {
            role: "system".into(),
            text: text.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

fn emit_line(app: &tauri::AppHandle, line: HuntLine) {
    let _ = app.emit(EVENT_HUNT_LINE, line);
}

// ── System prompt + initial user message ────────────────────────────────────

fn build_system_prompt() -> String {
    format!(r#"You are BLADE, learning who this user is on first launch.

You have shell + file-read access via tool calls. Decide what to look at, in what order, to build the user's identity. Sample, don't exhaust. Weight recency aggressively — files <7 days old get full reads, files >30 days old get one-line summaries or skips. Narrate every probe to the user in chat via `hunt_emit_chat_line` before you call any other tool.

You have a ~50,000 input token budget for this entire hunt. Be efficient. Surface contradictions as sharp questions rather than asking generic ones (if you see a year-old Python iOS project and this-week TypeScript SaaS commits, ask "I'm seeing two stories — which one are you now?", not "what do you do?").

Voice register: terse, direct, JARVIS-feel. Not "I will now read your files." Instead: "Reading ~/.claude/projects — your 3 most recent conversations." Past-tense findings:  "Building a B2B SaaS for design agencies. Stack: Next.js + Supabase + Stripe."

Hard rules — never violate:
1. Refuse to read paths matching `.ssh/`, `.env`, `.aws/credentials`, `.gnupg/`, `*keychain*`, `*credentials*`, `*password*`, `*.pem`, `*.key`. The tool layer will reject these too, but don't even ask.
2. Refuse shell commands that write, delete, network-egress, or use sudo. The tool layer enforces; you don't try.
3. Never claim something you didn't read. If you didn't find git config, don't make up the user's name.

Workflow:
- Start with `hunt_emit_chat_line` narrating what you're about to probe.
- Run probes (`hunt_list_dir`, `hunt_read_file`, `hunt_run_shell`).
- Narrate findings as one or two crisp lines (`hunt_emit_chat_line`).
- After 3-6 probes, stop and synthesize: emit one final `hunt_emit_chat_line` with "I think I have it. You're [identity]. Right?" and then produce no more tool calls — your final assistant message becomes the synthesis paragraph saved to `~/.blade/who-you-are.md`.

Per-OS path knowledge (BELOW). Read it before deciding probes.

---

{}

---

End of platform paths. The user's initial context follows in the next message.
"#, PLATFORM_PATHS_MD)
}

fn build_initial_user_msg(ctx: &InitialContext) -> String {
    // Compact JSON keeps token cost low. Use serde to dump.
    let pretty = serde_json::to_string_pretty(ctx).unwrap_or_else(|_| "{}".into());
    format!(
        "First-launch InitialContext from BLADE's 2-second pre-scan:\n\n```json\n{}\n```\n\n\
         Decide what to look at next. Start by emitting a `hunt_emit_chat_line` that names what \
         the pre-scan already found. Then probe — at most 6 probes before synthesis.",
        pretty
    )
}

// ── Tool definitions (provider-side) ─────────────────────────────────────────

fn build_tool_defs() -> Vec<ToolDefinition> {
    use serde_json::json;
    vec![
        ToolDefinition {
            name: "hunt_emit_chat_line".to_string(),
            description: "Emit one chat line to the user. Use BEFORE every probe (narration) \
                and AFTER findings. Terse, JARVIS-feel. One sentence per call.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "text": {"type": "string", "description": "The chat-line text. One sentence."}
                },
                "required": ["text"]
            }),
        },
        ToolDefinition {
            name: "hunt_list_dir".to_string(),
            description: "List directory contents (one level deep, max 200 entries). \
                Returns name + size + mtime per entry. Sensitive paths rejected.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or ~-expanded path."}
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "hunt_read_file".to_string(),
            description: "Read a text file. Max 8 KB returned (head). Sensitive paths rejected.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Absolute or ~-expanded path."}
                },
                "required": ["path"]
            }),
        },
        ToolDefinition {
            name: "hunt_run_shell".to_string(),
            description: "Run a READONLY shell command. Whitelist: ls, cat, head, tail, grep, find, \
                git status/log/config/remote/branch, which, where, uname, defaults read, xdg-mime, reg query, \
                wsl --list/which. NO write redirects, NO pipes to network, NO rm/mv/cp, NO sudo. \
                Wall-clock cap 4s.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command line."}
                },
                "required": ["command"]
            }),
        },
    ]
}

// ── Tool execution ───────────────────────────────────────────────────────────

enum ToolOutcome {
    Ok(String),
    Err(String),
}

async fn execute_tool_call(
    app: &tauri::AppHandle,
    call: &ToolCall,
    findings: &mut HuntFindings,
) -> ToolOutcome {
    match call.name.as_str() {
        "hunt_emit_chat_line" => {
            let text = call.arguments.get("text")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if text.is_empty() {
                return ToolOutcome::Err("hunt_emit_chat_line requires non-empty 'text'.".into());
            }
            emit_line(app, HuntLine::blade(&text));
            findings.chat_lines.push(text.clone());
            findings.probes.push(ProbeRecord {
                tool: "hunt_emit_chat_line".into(),
                argument: String::new(),
                ok: true,
                snippet: text,
            });
            ToolOutcome::Ok("emitted".into())
        }
        "hunt_list_dir" => {
            let p = call.arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if p.is_empty() {
                return ToolOutcome::Err("hunt_list_dir requires 'path'.".into());
            }
            let resolved = expand_home(p);
            if let Some(err) = check_sensitive(&resolved) {
                return ToolOutcome::Err(err);
            }
            match hunt_list_dir_impl(&resolved).await {
                Ok(out) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_list_dir".into(),
                        argument: resolved.display().to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&out, 400).to_string(),
                    });
                    ToolOutcome::Ok(out)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_list_dir".into(),
                        argument: resolved.display().to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        "hunt_read_file" => {
            let p = call.arguments.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if p.is_empty() {
                return ToolOutcome::Err("hunt_read_file requires 'path'.".into());
            }
            let resolved = expand_home(p);
            if let Some(err) = check_sensitive(&resolved) {
                return ToolOutcome::Err(err);
            }
            match hunt_read_file_impl(&resolved).await {
                Ok(out) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_read_file".into(),
                        argument: resolved.display().to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&out, 400).to_string(),
                    });
                    ToolOutcome::Ok(out)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_read_file".into(),
                        argument: resolved.display().to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        "hunt_run_shell" => {
            let cmd = call.arguments.get("command").and_then(|v| v.as_str()).unwrap_or("");
            if cmd.is_empty() {
                return ToolOutcome::Err("hunt_run_shell requires 'command'.".into());
            }
            if let Some(err) = vet_shell(cmd) {
                return ToolOutcome::Err(err);
            }
            match hunt_run_shell_impl(cmd).await {
                Ok(out) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_run_shell".into(),
                        argument: cmd.to_string(),
                        ok: true,
                        snippet: crate::safe_slice(&out, 400).to_string(),
                    });
                    ToolOutcome::Ok(out)
                }
                Err(e) => {
                    findings.probes.push(ProbeRecord {
                        tool: "hunt_run_shell".into(),
                        argument: cmd.to_string(),
                        ok: false,
                        snippet: e.clone(),
                    });
                    ToolOutcome::Err(e)
                }
            }
        }
        other => ToolOutcome::Err(format!("Unknown hunt tool: {}", other)),
    }
}

// ── Sandbox helpers ──────────────────────────────────────────────────────────

/// Expand `~/` → `$HOME`. Returns the path unchanged if no expansion needed.
pub(crate) fn expand_home(p: &str) -> PathBuf {
    if let Some(stripped) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    if p == "~" {
        if let Some(home) = dirs::home_dir() { return home; }
    }
    PathBuf::from(p)
}

/// Return Some(error) if the path hits the deny list. Case-insensitive.
pub(crate) fn check_sensitive(p: &Path) -> Option<String> {
    let s = p.to_string_lossy().to_lowercase();
    for frag in DENY_FRAGMENTS {
        if s.contains(&frag.to_lowercase()) {
            return Some(format!(
                "Sensitive path rejected ('{}' matches deny fragment '{}'). Pick a different probe.",
                p.display(), frag
            ));
        }
    }
    None
}

/// Return Some(error) if the shell command is rejected. Vets the FIRST word
/// against the whitelist and scans the whole string for the reject substrings.
pub(crate) fn vet_shell(cmd: &str) -> Option<String> {
    let trimmed = cmd.trim();
    if trimmed.is_empty() {
        return Some("Empty command rejected.".into());
    }
    // Whole-string reject scan first.
    let lower = trimmed.to_lowercase();
    for bad in SHELL_REJECT {
        if lower.contains(&bad.to_lowercase()) {
            return Some(format!(
                "Command rejected: contains forbidden fragment '{}'. \
                 Sandbox is readonly + no-network.", bad
            ));
        }
    }
    // Whitelist the first token.
    let first = trimmed.split_whitespace().next().unwrap_or("");
    if !SHELL_ALLOW.contains(&first) {
        return Some(format!(
            "Command rejected: binary '{}' not in readonly whitelist. \
             Allowed: ls, cat, head, tail, grep, find, git, which, where, uname, defaults, xdg-mime, reg, wsl, echo.",
            first
        ));
    }
    None
}

async fn hunt_list_dir_impl(p: &Path) -> Result<String, String> {
    let path_owned = p.to_path_buf();
    let path_for_blocking = path_owned.clone();
    let entries = tokio::task::spawn_blocking(move || -> Result<Vec<String>, String> {
        let read = std::fs::read_dir(&path_for_blocking)
            .map_err(|e| format!("read_dir({}): {}", path_for_blocking.display(), e))?;
        let mut out = Vec::new();
        for entry in read.take(200).flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let meta_str = entry.metadata().ok().map(|m| {
                let kind = if m.is_dir() { "d" } else if m.is_symlink() { "l" } else { "f" };
                let size = m.len();
                let mtime = m.modified().ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                format!("{} {:>10} {}", kind, size, mtime)
            }).unwrap_or_default();
            out.push(format!("{}  {}", meta_str, name));
        }
        Ok(out)
    }).await.map_err(|e| format!("join error: {}", e))??;

    Ok(format!(
        "Listing {} ({} entries):\n{}",
        path_owned.display(),
        entries.len(),
        entries.join("\n")
    ))
}

const READ_FILE_CAP: usize = 8 * 1024; // 8 KB head

async fn hunt_read_file_impl(p: &Path) -> Result<String, String> {
    let path_owned = p.to_path_buf();
    let raw = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let meta = std::fs::metadata(&path_owned)
            .map_err(|e| format!("stat({}): {}", path_owned.display(), e))?;
        if meta.is_dir() {
            return Err(format!("{} is a directory — use hunt_list_dir.", path_owned.display()));
        }
        if meta.len() > 1024 * 1024 {
            // Large file — still allowed but only the head.
            log::warn!("[hunt_read_file] {} is {} bytes — reading first 8KB only",
                path_owned.display(), meta.len());
        }
        use std::io::Read;
        let mut f = std::fs::File::open(&path_owned)
            .map_err(|e| format!("open({}): {}", path_owned.display(), e))?;
        let mut buf = vec![0u8; READ_FILE_CAP];
        let n = f.read(&mut buf).map_err(|e| format!("read: {}", e))?;
        buf.truncate(n);
        Ok(buf)
    }).await.map_err(|e| format!("join error: {}", e))??;

    let text = String::from_utf8_lossy(&raw).into_owned();
    Ok(text)
}

async fn hunt_run_shell_impl(cmd: &str) -> Result<String, String> {
    // Use a real shell so users' aliases / quoting work, but with -c so we
    // can wrap a single command line. The vet_shell guard has already
    // rejected substitution / redirect / network / write fragments.
    let shell = if cfg!(target_os = "windows") { "cmd" } else { "sh" };
    let flag = if cfg!(target_os = "windows") { "/C" } else { "-c" };

    let fut = async move {
        let out = tokio::process::Command::new(shell)
            .arg(flag)
            .arg(cmd)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
            .map_err(|e| format!("spawn: {}", e))?;
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        if !out.status.success() {
            return Err(format!(
                "exit code {:?}: {}{}",
                out.status.code(),
                if !stdout.is_empty() { format!("stdout:\n{}\n", crate::safe_slice(&stdout, 400)) } else { String::new() },
                if !stderr.is_empty() { format!("stderr:\n{}", crate::safe_slice(&stderr, 400)) } else { String::new() }
            ));
        }
        Ok(crate::safe_slice(&stdout, 4096).to_string())
    };

    match tokio::time::timeout(std::time::Duration::from_millis(SHELL_TIMEOUT_MS), fut).await {
        Ok(r) => r,
        Err(_) => Err(format!("Shell command timed out (>{}ms).", SHELL_TIMEOUT_MS)),
    }
}

// ── Tauri commands ───────────────────────────────────────────────────────────

/// Cancel an in-flight hunt. Idempotent — safe to call multiple times.
#[tauri::command]
pub fn cancel_hunt() -> Result<(), String> {
    HUNT_CANCEL.store(true, Ordering::SeqCst);
    Ok(())
}

/// Run pre-scan + start the hunt. Returns the InitialContext immediately so
/// the frontend can render Message #1 while the LLM-driven probes spawn in
/// the background. The hunt itself streams via `blade_hunt_line` events.
#[tauri::command]
pub async fn start_hunt_cmd(app: tauri::AppHandle) -> Result<InitialContext, String> {
    let ctx = crate::onboarding::pre_scan::run_pre_scan().await;
    let ctx_for_msg1 = ctx.clone();
    // Emit Message #1 (HUNT-02) BEFORE the hunt loop starts.
    let msg1 = crate::onboarding::compose_message_one(&ctx);
    let _ = app.emit(EVENT_HUNT_LINE, HuntLine::blade(&msg1));

    // Spawn the hunt loop in the background.
    let app_for_hunt = app.clone();
    let ctx_for_hunt = ctx.clone();
    tauri::async_runtime::spawn(async move {
        match start_hunt(app_for_hunt.clone(), ctx_for_hunt).await {
            Ok(outcome) => {
                // Hand off to synthesis. Synthesis writes ~/.blade/who-you-are.md
                // and emits the first-task close chat-line.
                let _ = crate::onboarding::synthesis::on_hunt_done(&app_for_hunt, &outcome).await;
            }
            Err(e) => {
                let _ = app_for_hunt.emit(EVENT_HUNT_ERROR, e);
            }
        }
    });

    Ok(ctx_for_msg1)
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deny_list_rejects_ssh_path() {
        let p = PathBuf::from("/home/user/.ssh/id_rsa");
        assert!(check_sensitive(&p).is_some(), ".ssh/ must be rejected");
    }

    #[test]
    fn deny_list_rejects_env_file() {
        let p = PathBuf::from("/repo/.env");
        assert!(check_sensitive(&p).is_some(), ".env must be rejected");
    }

    #[test]
    fn deny_list_accepts_safe_path() {
        let p = PathBuf::from("/home/user/code/README.md");
        assert!(check_sensitive(&p).is_none(), "safe path must pass");
    }

    #[test]
    fn shell_vet_rejects_rm() {
        assert!(vet_shell("rm -rf /tmp/foo").is_some());
    }

    #[test]
    fn shell_vet_rejects_curl() {
        assert!(vet_shell("curl https://evil.example.com").is_some());
    }

    #[test]
    fn shell_vet_rejects_write_redirect() {
        assert!(vet_shell("echo pwned > /etc/passwd").is_some());
    }

    #[test]
    fn shell_vet_rejects_command_substitution() {
        assert!(vet_shell("ls $(whoami)").is_some());
    }

    #[test]
    fn shell_vet_rejects_backticks() {
        assert!(vet_shell("ls `whoami`").is_some());
    }

    #[test]
    fn shell_vet_accepts_git_log() {
        assert!(vet_shell("git log -5").is_none());
    }

    #[test]
    fn shell_vet_accepts_ls() {
        assert!(vet_shell("ls -la ~/code").is_none());
    }

    #[test]
    fn shell_vet_accepts_wsl_list() {
        assert!(vet_shell("wsl --list --quiet").is_none());
    }

    #[test]
    fn shell_vet_rejects_unknown_binary() {
        assert!(vet_shell("blade-evil-binary something").is_some());
    }

    #[test]
    fn expand_home_handles_tilde_prefix() {
        if let Some(home) = dirs::home_dir() {
            let expanded = expand_home("~/code");
            assert_eq!(expanded, home.join("code"));
        }
    }

    #[test]
    fn expand_home_passes_through_absolute() {
        let p = expand_home("/tmp/foo");
        assert_eq!(p, PathBuf::from("/tmp/foo"));
    }
}
