//! Phase 46 — HUNT-01 — Pre-scan (≤2s capability inventory).
//!
//! Runs invisibly while the chat window paints. NOT v1.5 Deep Scan: no DB
//! writes, no recursive walks, no scanners loop. A flat capability inventory
//! used to seed Message #1 of the agentic hunt onboarding.
//!
//! Probes (per `.planning/v2.0-onboarding-spec.md` Act 1):
//!   - Agent presence  — `which claude/cursor/ollama/aider/gh/codex/goose`
//!   - API keys (env)  — ANTHROPIC/OPENAI/GROQ/GEMINI/XAI/OPENROUTER
//!   - API keys (cfg)  — `~/.claude/config*`, `~/.cursor/config*`, BLADE keyring
//!   - Local LLM       — TCP probe `127.0.0.1:11434` (Ollama)
//!   - OS + arch       — std::env::consts
//!   - Default browser — best-effort per-OS
//!   - Mic permission  — check-only stub (no recording)
//!
//! Each probe is wrapped in a tokio::time::timeout so a slow `which` or
//! a stalled keychain query can't extend total elapsed time beyond ~2s.
//!
//! Returns an in-memory `InitialContext` struct. Not persisted unless the
//! user opts in later (durable artifact = `~/.blade/who-you-are.md`, written
//! only after the hunt synthesizes a confirmation).

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Per-probe hard timeout. `which` shouldn't take more than ~50ms; we give
/// it 4× headroom to survive a momentarily-loaded CPU on user's first-launch.
const PROBE_TIMEOUT: Duration = Duration::from_millis(200);

/// Total elapsed budget for the entire pre-scan, advertised in the spec as
/// "≤ 2s." Exposed as a constant so tests can assert against it.
pub const TOTAL_BUDGET: Duration = Duration::from_millis(2000);

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentPresence {
    /// Each `Some(path)` means the binary was found at that filesystem path.
    /// `None` means the binary was not found in `$PATH`.
    pub claude: Option<String>,
    pub cursor: Option<String>,
    pub ollama: Option<String>,
    pub gh: Option<String>,
    pub aider: Option<String>,
    pub codex: Option<String>,
    pub goose: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ApiKeyPresence {
    pub anthropic: bool,
    pub openai: bool,
    pub groq: bool,
    pub gemini: bool,
    pub xai: bool,
    pub openrouter: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct InitialContext {
    pub agents: AgentPresence,
    /// Env-var presence — keys that the shell exports right now.
    pub env_keys: ApiKeyPresence,
    /// Keys already saved in BLADE's keyring from a prior session.
    pub keyring_keys: ApiKeyPresence,
    /// `true` if a TCP connection to 127.0.0.1:11434 succeeded.
    pub ollama_running: bool,
    /// e.g. "macos", "linux", "windows".
    pub os: String,
    /// e.g. "aarch64", "x86_64".
    pub arch: String,
    /// Best-effort default-browser identifier ("brave", "chrome", "firefox", etc).
    /// Empty string when detection failed.
    pub default_browser: String,
    /// macOS: TCC database lookup result. Other OSes: "unknown" (no permission
    /// model surfaced at this layer). NOT a microphone open — purely a status read.
    pub mic_permission: String,
    /// Total elapsed wall-time of the pre-scan in milliseconds (instrumentation).
    pub elapsed_ms: u64,
}

/// Run all pre-scan probes concurrently and return the merged context.
///
/// Concurrency: every probe spawns through `tokio::join!` so the longest-running
/// probe sets the total time (rather than the sum).
pub async fn run_pre_scan() -> InitialContext {
    let start = std::time::Instant::now();

    let (
        agents,
        env_keys,
        keyring_keys,
        ollama_running,
        default_browser,
        mic_permission,
    ) = tokio::join!(
        probe_agents(),
        probe_env_keys(),
        probe_keyring_keys(),
        probe_ollama_tcp(),
        probe_default_browser(),
        probe_mic_permission(),
    );

    InitialContext {
        agents,
        env_keys,
        keyring_keys,
        ollama_running,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        default_browser,
        mic_permission,
        elapsed_ms: start.elapsed().as_millis() as u64,
    }
}

// ── Probes ────────────────────────────────────────────────────────────────────

async fn probe_agents() -> AgentPresence {
    let (claude, cursor, ollama, gh, aider, codex, goose) = tokio::join!(
        which_with_timeout("claude"),
        which_with_timeout("cursor"),
        which_with_timeout("ollama"),
        which_with_timeout("gh"),
        which_with_timeout("aider"),
        which_with_timeout("codex"),
        which_with_timeout("goose"),
    );
    AgentPresence { claude, cursor, ollama, gh, aider, codex, goose }
}

/// Probe `which <bin>` / `where <bin>` (Windows) and return the resolved path
/// if found, `None` otherwise. Each call is bounded by `PROBE_TIMEOUT`.
async fn which_with_timeout(bin: &str) -> Option<String> {
    let cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let owned_bin = bin.to_string();
    let cmd_owned = cmd.to_string();
    let fut = async move {
        let out = tokio::process::Command::new(&cmd_owned)
            .arg(&owned_bin)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .await
            .ok()?;
        if !out.status.success() { return None; }
        let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if path.is_empty() { None } else { Some(path) }
    };
    match tokio::time::timeout(PROBE_TIMEOUT, fut).await {
        Ok(v) => v,
        Err(_) => None,
    }
}

async fn probe_env_keys() -> ApiKeyPresence {
    // Reading env vars is sync + nanoseconds. No timeout needed.
    ApiKeyPresence {
        anthropic: env_present("ANTHROPIC_API_KEY"),
        openai: env_present("OPENAI_API_KEY"),
        groq: env_present("GROQ_API_KEY"),
        gemini: env_present("GEMINI_API_KEY") || env_present("GOOGLE_API_KEY"),
        xai: env_present("XAI_API_KEY"),
        openrouter: env_present("OPENROUTER_API_KEY"),
    }
}

fn env_present(name: &str) -> bool {
    std::env::var(name)
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

async fn probe_keyring_keys() -> ApiKeyPresence {
    // Keyring access can rarely stall (Linux libsecret prompts on locked
    // wallet). Wrap the whole batch in PROBE_TIMEOUT and bail to empty
    // presence if it exceeds. BLADE has six provider slots; the get_provider_key
    // helper short-circuits on empty.
    let fut = async {
        ApiKeyPresence {
            anthropic: !crate::config::get_provider_key("anthropic").is_empty(),
            openai: !crate::config::get_provider_key("openai").is_empty(),
            groq: !crate::config::get_provider_key("groq").is_empty(),
            gemini: !crate::config::get_provider_key("gemini").is_empty(),
            xai: false, // not in the 6 provider config slots — env-only path
            openrouter: !crate::config::get_provider_key("openrouter").is_empty(),
        }
    };
    tokio::time::timeout(PROBE_TIMEOUT, fut)
        .await
        .unwrap_or_default()
}

/// TCP probe for Ollama's default port. 50ms timeout per spec.
async fn probe_ollama_tcp() -> bool {
    let fut = async {
        tokio::net::TcpStream::connect("127.0.0.1:11434").await.is_ok()
    };
    tokio::time::timeout(Duration::from_millis(50), fut)
        .await
        .unwrap_or(false)
}

/// Best-effort default-browser detection. Per spec Act 4: the LLM hunt has
/// platform_paths.md to know HOW to detect; this is the eager pre-scan that
/// runs the cheapest probe before message #1.
async fn probe_default_browser() -> String {
    let fut = async {
        if cfg!(target_os = "macos") {
            // defaults read com.apple.LaunchServices/com.apple.launchservices.secure
            // returns hundreds of lines; grep for the http handler bundle id.
            let out = tokio::process::Command::new("defaults")
                .args([
                    "read",
                    "com.apple.LaunchServices/com.apple.launchservices.secure",
                    "LSHandlers",
                ])
                .output()
                .await
                .ok()?;
            let s = String::from_utf8_lossy(&out.stdout);
            // Look for an `LSHandlerURLScheme = http;` block + LSHandlerRoleAll.
            // Cheap heuristic: split on "LSHandlerURLScheme = http;" and grab
            // the bundle id from the same chunk.
            for chunk in s.split("LSHandlerURLScheme = http;") {
                if let Some(idx) = chunk.find("LSHandlerRoleAll = ") {
                    let after = &chunk[idx + "LSHandlerRoleAll = ".len()..];
                    let end = after.find(';').unwrap_or(after.len());
                    return Some(after[..end].trim().to_string());
                }
            }
            None
        } else if cfg!(target_os = "linux") {
            let out = tokio::process::Command::new("xdg-mime")
                .args(["query", "default", "x-scheme-handler/http"])
                .output()
                .await
                .ok()?;
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        } else {
            // Windows: HKCU\Software\Classes\http\shell\open\command — wired by
            // the hunt LLM via `hunt_run_shell` reading the registry. Pre-scan
            // is best-effort empty.
            None
        }
    };
    tokio::time::timeout(PROBE_TIMEOUT, fut)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

/// Check-only mic permission. NEVER opens the mic.
///
/// macOS: we'd consult TCC.db; that requires Full Disk Access permission so
/// in practice we surface "unknown" until the user grants mic. On Linux the
/// concept doesn't apply at this layer (PipeWire/PulseAudio control). On
/// Windows the runtime permission is in Settings → Privacy → Microphone.
async fn probe_mic_permission() -> String {
    // Per spec: "permission check only — no recording." The fastest correct
    // answer is "unknown" everywhere — the hunt can ask the user if it cares.
    // We don't shell out to `system_profiler` or read TCC.db because both
    // require disk access permission and add elapsed time. The pre-scan's
    // job is the 2s budget, not perfect coverage.
    "unknown".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pre_scan_completes_under_budget() {
        let ctx = run_pre_scan().await;
        assert!(
            ctx.elapsed_ms <= TOTAL_BUDGET.as_millis() as u64,
            "pre-scan elapsed {}ms > {}ms budget",
            ctx.elapsed_ms,
            TOTAL_BUDGET.as_millis()
        );
    }

    #[tokio::test]
    async fn pre_scan_fills_os_and_arch() {
        let ctx = run_pre_scan().await;
        assert!(!ctx.os.is_empty(), "OS must be set by std::env::consts");
        assert!(!ctx.arch.is_empty(), "arch must be set by std::env::consts");
    }

    #[tokio::test]
    async fn which_timeout_safe_on_missing_binary() {
        // A binary that definitely doesn't exist should return None within budget.
        let start = std::time::Instant::now();
        let out = which_with_timeout("blade-phase46-missing-binary-zzz").await;
        let elapsed = start.elapsed();
        assert!(out.is_none());
        assert!(
            elapsed < PROBE_TIMEOUT * 2,
            "which on missing bin took {:?}, expected < {:?}",
            elapsed,
            PROBE_TIMEOUT * 2
        );
    }
}
