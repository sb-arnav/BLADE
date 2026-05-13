//! Phase 46 — HUNT-07 — Write `~/.blade/who-you-are.md`.
//!
//! User-editable Markdown artifact. First-class — the user can read or edit
//! at any time; BLADE re-reads on every session. Replaces the brittle
//! `brain_identity` table the v1.6 cuts retired.
//!
//! Per `.planning/v2.0-onboarding-spec.md` Act 6, the file structure is:
//!
//!   # Who you are (BLADE's working model)
//!   **Last updated:** YYYY-MM-DD by hunt
//!   **You can edit this file. BLADE re-reads it every session.**
//!   ## Identity / What you're building / How you work / Off-limits / Notes
//!
//! HUNT-08 (first-task close) also lives in this module: after writing the
//! synthesis, emit the closing chat-line that invites the user to name one
//! task they've been putting off.

use crate::onboarding::hunt::{HuntFindings, HuntLine, HuntOutcome, EVENT_HUNT_LINE};
use std::path::PathBuf;
use tauri::Emitter;

/// Filename under `$HOME/.blade/`.
pub const WHO_YOU_ARE_FILENAME: &str = "who-you-are.md";

/// Compose Markdown body from accumulated hunt findings. Deterministic — given
/// the same `HuntFindings` the output is stable (modulo the date stamp).
pub fn synthesize_to_markdown(findings: &HuntFindings) -> String {
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let mut out = String::new();
    out.push_str("# Who you are (BLADE's working model)\n\n");
    out.push_str(&format!("**Last updated:** {} by hunt\n", date));
    out.push_str("**You can edit this file. BLADE re-reads it every session.**\n\n");

    // ── Identity ─────────────────────────────────────────────────────────────
    out.push_str("## Identity\n");
    if findings.final_synthesis.trim().is_empty() {
        out.push_str("- (hunt produced no closing synthesis — edit this section to set who you are)\n");
    } else {
        // The closing assistant turn captured by the hunt loop. Quote verbatim
        // so the user sees what BLADE concluded and can correct it inline.
        out.push_str("> ");
        out.push_str(findings.final_synthesis.trim());
        out.push('\n');
    }
    out.push('\n');

    // ── Initial-context snapshot ─────────────────────────────────────────────
    out.push_str("## Machine snapshot (from pre-scan)\n");
    out.push_str(&format!("- OS: `{}`, arch: `{}`\n", findings.initial.os, findings.initial.arch));
    let agents = &findings.initial.agents;
    let agents_present: Vec<&str> = [
        ("claude", agents.claude.is_some()),
        ("cursor", agents.cursor.is_some()),
        ("ollama", agents.ollama.is_some()),
        ("gh", agents.gh.is_some()),
        ("aider", agents.aider.is_some()),
        ("codex", agents.codex.is_some()),
        ("goose", agents.goose.is_some()),
    ].iter().filter_map(|(n, p)| if *p { Some(*n) } else { None }).collect();
    if agents_present.is_empty() {
        out.push_str("- Agents detected: none\n");
    } else {
        out.push_str(&format!("- Agents detected: {}\n", agents_present.join(", ")));
    }
    if findings.initial.ollama_running {
        out.push_str("- Ollama: running locally\n");
    }
    if !findings.initial.default_browser.is_empty() {
        out.push_str(&format!("- Default browser: `{}`\n", findings.initial.default_browser));
    }
    out.push('\n');

    // ── Probe trail ──────────────────────────────────────────────────────────
    if !findings.probes.is_empty() {
        out.push_str("## What I probed\n");
        for p in findings.probes.iter().take(20) {
            let status = if p.ok { "ok" } else { "err" };
            out.push_str(&format!(
                "- `{}` [{}] — `{}`\n",
                p.tool,
                status,
                crate::safe_slice(&p.argument, 80)
            ));
        }
        out.push('\n');
    }

    // ── Chat-line transcript (so the user can audit the live narration) ─────
    if !findings.chat_lines.is_empty() {
        out.push_str("## Narration transcript\n");
        for line in findings.chat_lines.iter() {
            out.push_str(&format!("> {}\n", line));
        }
        out.push('\n');
    }

    out.push_str("## How you work\n");
    out.push_str("- (BLADE infers from your patterns over time — edit to lock preferences)\n\n");
    out.push_str("## What's off-limits\n");
    out.push_str("- (fill in: never touch banking, never auto-send to investors, etc.)\n\n");
    out.push_str("## Notes\n");
    out.push_str("- (free-form — anything BLADE should know that doesn't fit above)\n");

    out
}

/// Atomic write to `$HOME/.blade/who-you-are.md`. Returns the absolute path on
/// success. If the user has manually edited a prior version, we preserve it
/// by backing up to `.who-you-are.md.bak.<timestamp>` before overwriting.
pub fn write_who_you_are(content: &str) -> Result<PathBuf, String> {
    let dir = blade_home_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create_dir_all({}): {}", dir.display(), e))?;
    let target = dir.join(WHO_YOU_ARE_FILENAME);

    // Preserve prior user edits.
    if target.exists() {
        let ts = chrono::Utc::now().format("%Y%m%dT%H%M%S").to_string();
        let backup = dir.join(format!(".{}.bak.{}", WHO_YOU_ARE_FILENAME, ts));
        let _ = std::fs::copy(&target, &backup);
    }

    // Atomic write: write to a sibling tmp file then rename.
    let tmp = dir.join(format!(".{}.tmp", WHO_YOU_ARE_FILENAME));
    std::fs::write(&tmp, content)
        .map_err(|e| format!("write tmp: {}", e))?;
    std::fs::rename(&tmp, &target)
        .map_err(|e| format!("rename: {}", e))?;
    Ok(target)
}

/// `~/.blade/` — distinct from `blade_config_dir()` which is the OS-conventional
/// config location. Per spec the synthesis artifact lives in the user's home,
/// not the platform-private config dir, so they can `cat`, `vim`, or git it.
fn blade_home_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not resolve home dir".to_string())?;
    Ok(home.join(".blade"))
}

/// Called by `hunt::start_hunt_cmd` once the hunt loop returns. Writes the
/// markdown (HUNT-07), emits the first-task close chat-line (HUNT-08), and
/// marks the persona_onboarding_complete flag so the gate flips.
pub async fn on_hunt_done(
    app: &tauri::AppHandle,
    outcome: &HuntOutcome,
) -> Result<(), String> {
    let md = synthesize_to_markdown(&outcome.findings);
    let path = write_who_you_are(&md)?;
    log::info!("[hunt synthesis] wrote {} ({} bytes)", path.display(), md.len());

    // Per spec Act 7: closing chat-line. The user's next message routes into
    // the normal chat tool loop, which is wired in MainShell after the gate
    // flips below.
    let _ = app.emit(
        EVENT_HUNT_LINE,
        HuntLine::blade(
            "Right? — Give me one thing you've been putting off this week. I'll handle it now."
        ),
    );

    // Flip persona_onboarding_complete so the onboarding gate clears.
    let mut config = crate::config::load_config();
    config.persona_onboarding_complete = true;
    config.onboarded = true;
    // Best-effort populate user_name from the first chat-line that includes
    // "you're X" or "name is X". Heuristic — synthesis paragraph is the source.
    if config.user_name.is_empty() {
        if let Some(name) = guess_user_name(&outcome.findings.final_synthesis) {
            config.user_name = name;
        }
    }
    crate::config::save_config(&config)?;

    Ok(())
}

/// Best-effort name extraction from the closing synthesis. Looks for the
/// canonical "You're <Name>" pattern; falls back to None.
fn guess_user_name(synthesis: &str) -> Option<String> {
    let lower = synthesis.to_lowercase();
    let needle = "you're ";
    let pos = lower.find(needle)?;
    let after = &synthesis[pos + needle.len()..];
    let first_word: String = after.chars()
        .take_while(|c| c.is_alphabetic() || *c == '-' || *c == '\'')
        .collect();
    if first_word.is_empty() || first_word.len() > 30 {
        return None;
    }
    // Must start uppercase to look like a name.
    if !first_word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false) {
        return None;
    }
    Some(first_word)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onboarding::pre_scan::{InitialContext, AgentPresence};

    fn sample_findings() -> HuntFindings {
        HuntFindings {
            initial: InitialContext {
                agents: AgentPresence { claude: Some("/usr/local/bin/claude".into()), ..Default::default() },
                os: "linux".into(),
                arch: "x86_64".into(),
                default_browser: "brave-browser.desktop".into(),
                ollama_running: true,
                ..Default::default()
            },
            chat_lines: vec![
                "Reading ~/.claude/projects — your 3 most recent.".into(),
                "Building a B2B SaaS called Clarify. Next.js + Supabase + Stripe.".into(),
            ],
            probes: vec![],
            final_synthesis: "I think I have it. You're Arnav, solo founder building Clarify (B2B SaaS, Next.js + Supabase + Stripe). Right?".into(),
        }
    }

    #[test]
    fn markdown_includes_synthesis() {
        let md = synthesize_to_markdown(&sample_findings());
        assert!(md.contains("# Who you are"));
        assert!(md.contains("You're Arnav, solo founder building Clarify"));
        assert!(md.contains("linux"));
        assert!(md.contains("brave-browser.desktop"));
    }

    #[test]
    fn markdown_handles_empty_synthesis() {
        let mut f = sample_findings();
        f.final_synthesis = String::new();
        let md = synthesize_to_markdown(&f);
        assert!(md.contains("hunt produced no closing synthesis"));
    }

    #[test]
    fn write_who_you_are_creates_file_atomically() {
        // Sandbox HOME to a tempdir so we don't clobber real ~/.blade.
        let td = tempfile::tempdir().unwrap();
        let prior_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", td.path());

        let md = synthesize_to_markdown(&sample_findings());
        let path = write_who_you_are(&md).unwrap();
        assert!(path.exists());
        let back = std::fs::read_to_string(&path).unwrap();
        assert_eq!(back, md);

        // Second write rotates a backup.
        let _ = write_who_you_are(&md).unwrap();
        let backups: Vec<_> = std::fs::read_dir(td.path().join(".blade"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".bak."))
            .collect();
        assert!(!backups.is_empty(), "second write should produce at least one backup");

        // Restore HOME.
        if let Some(h) = prior_home { std::env::set_var("HOME", h); }
    }

    #[test]
    fn guess_user_name_extracts_proper_name() {
        let s = "I think I have it. You're Arnav, solo founder.";
        assert_eq!(guess_user_name(s).as_deref(), Some("Arnav"));
    }

    #[test]
    fn guess_user_name_rejects_lowercase() {
        let s = "you're nobody special";
        assert!(guess_user_name(s).is_none());
    }

    #[test]
    fn guess_user_name_handles_missing() {
        let s = "Hello world.";
        assert!(guess_user_name(s).is_none());
    }
}
