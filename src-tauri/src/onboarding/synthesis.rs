//! Phase 46 — HUNT-07 — Write `~/.blade/who-you-are.md`.
//!
//! User-editable Markdown artifact. First-class — the user can read or edit
//! at any time; BLADE re-reads on every session. Replaces the brittle
//! `brain_identity` table the v1.6 cuts retired.
//!
//! Per `.planning/v2.0-onboarding-spec.md` Act 6, the file structure is:
//!
//!   ---
//!   telos:
//!     mission: "..."
//!     goals: [...]
//!     beliefs: [...]
//!     challenges: [...]
//!   ---
//!   # Who you are (BLADE's working model)
//!   **Last updated:** YYYY-MM-DD by hunt
//!   **You can edit this file. BLADE re-reads it every session.**
//!   ## Identity / What you're building / How you work / Off-limits / Notes
//!
//! Phase 56 (TELOS-SYNTH) adds the YAML frontmatter `telos:` block so BLADE has
//! an optimization target — Mission / Goals / Beliefs / Challenges — not just a
//! context dump. Idempotent merge: re-running synthesis preserves any user edits
//! to the telos block, only overwriting fields the hunt actually re-captured.
//!
//! HUNT-08 (first-task close) also lives in this module: after writing the
//! synthesis, emit the closing chat-line that invites the user to name one
//! task they've been putting off.

use crate::onboarding::hunt::{HuntFindings, HuntLine, HuntOutcome, EVENT_HUNT_LINE};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

/// Filename under `$HOME/.blade/`.
pub const WHO_YOU_ARE_FILENAME: &str = "who-you-are.md";

/// Phase 56 (TELOS-SYNTH) — the four optimization-target fields BLADE captures
/// during the hunt and reads on every chat turn. Daniel Miessler's PAI calls
/// this the "telos" block: Mission / Goals / Beliefs / Challenges.
///
/// All fields are optional — synthesis degrades gracefully when the hunt
/// produces only some of them. The YAML frontmatter on `who-you-are.md` uses
/// this shape verbatim.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Telos {
    /// One-line statement of what the user is building / doing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mission: Option<String>,
    /// 3-5 bullets, time-bounded where possible.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub goals: Vec<String>,
    /// 3-5 bullets — things the user holds to be true.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub beliefs: Vec<String>,
    /// 3-5 bullets — what's in the user's way right now.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub challenges: Vec<String>,
}

impl Telos {
    /// True when every field is empty / None. Used to skip frontmatter when
    /// the hunt produced nothing structured.
    pub fn is_empty(&self) -> bool {
        self.mission.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true)
            && self.goals.is_empty()
            && self.beliefs.is_empty()
            && self.challenges.is_empty()
    }

    /// Merge `other` into `self`, but only for fields where `self` is empty.
    /// This preserves user edits during re-synthesis — the existing file's
    /// telos wins; the new hunt only fills in gaps.
    pub fn merge_preserve_self(&mut self, other: &Telos) {
        if self.mission.as_deref().map(|s| s.trim().is_empty()).unwrap_or(true) {
            self.mission = other.mission.clone();
        }
        if self.goals.is_empty() {
            self.goals = other.goals.clone();
        }
        if self.beliefs.is_empty() {
            self.beliefs = other.beliefs.clone();
        }
        if self.challenges.is_empty() {
            self.challenges = other.challenges.clone();
        }
    }
}

/// Parse a fenced ```telos ...``` block out of the LLM's final-synthesis turn.
/// The hunt prompt instructs the LLM to append this block; we tolerate its
/// absence (returns `Telos::default()`).
///
/// Format accepted (per the hunt prompt example):
///
/// ```text
/// ```telos
/// mission: "Build X."
/// goals:
///   - "Ship MVP."
/// ```
/// ```
///
/// Quoted strings preferred but `serde_yaml` handles bare scalars too.
pub fn parse_telos_from_synthesis(synthesis: &str) -> Telos {
    let fence_open = "```telos";
    let Some(start) = synthesis.find(fence_open) else {
        return Telos::default();
    };
    let after_open = &synthesis[start + fence_open.len()..];
    // The body runs from the first newline after the opener to the next ``` fence.
    let body_start = after_open.find('\n').map(|i| i + 1).unwrap_or(0);
    let body = &after_open[body_start..];
    let body_end = body.find("```").unwrap_or(body.len());
    let yaml_body = &body[..body_end];
    serde_yaml::from_str::<Telos>(yaml_body).unwrap_or_default()
}

/// Strip the fenced ```telos``` block from a synthesis paragraph so the human-
/// readable text is clean when rendered into the markdown body. Returns the
/// synthesis with the fence removed (or unchanged if no fence is present).
pub fn strip_telos_fence(synthesis: &str) -> String {
    let fence_open = "```telos";
    let Some(start) = synthesis.find(fence_open) else {
        return synthesis.to_string();
    };
    let after_open = &synthesis[start + fence_open.len()..];
    let body_start = after_open.find('\n').map(|i| i + 1).unwrap_or(0);
    let body = &after_open[body_start..];
    let Some(close_rel) = body.find("```") else {
        // Malformed — strip from the opener to end-of-string.
        return synthesis[..start].trim_end().to_string();
    };
    let absolute_end = start + fence_open.len() + body_start + close_rel + 3;
    let mut out = String::with_capacity(synthesis.len());
    out.push_str(synthesis[..start].trim_end());
    out.push_str(&synthesis[absolute_end..]);
    out.trim().to_string()
}

/// Parse a YAML frontmatter `telos:` block from an existing who-you-are.md
/// (idempotent merge support). Returns `Telos::default()` if no frontmatter is
/// present or it doesn't contain a `telos:` key.
pub fn parse_telos_from_frontmatter(content: &str) -> Telos {
    let Some(stripped) = content.strip_prefix("---\n") else {
        return Telos::default();
    };
    let Some(end_rel) = stripped.find("\n---\n") else {
        return Telos::default();
    };
    let yaml = &stripped[..end_rel];

    #[derive(Deserialize, Default)]
    struct FrontMatter {
        #[serde(default)]
        telos: Option<Telos>,
    }
    let fm: FrontMatter = serde_yaml::from_str(yaml).unwrap_or_default();
    fm.telos.unwrap_or_default()
}

/// Return the body of a who-you-are.md with any leading YAML frontmatter
/// removed. Used when re-synthesizing so we replace the old frontmatter
/// without touching the user-edited markdown body.
pub fn strip_frontmatter(content: &str) -> &str {
    let Some(stripped) = content.strip_prefix("---\n") else {
        return content;
    };
    let Some(end_rel) = stripped.find("\n---\n") else {
        return content;
    };
    // +5 = "\n---\n".len()
    &stripped[end_rel + 5..]
}

/// Render a `Telos` to a YAML frontmatter block, including the leading and
/// trailing `---` delimiters and a trailing newline.
pub fn render_telos_frontmatter(telos: &Telos) -> String {
    // Use serde_yaml's serializer for safe quoting + escaping. Wrap in the
    // delimiter pair the markdown frontmatter convention requires.
    #[derive(Serialize)]
    struct FrontMatter<'a> {
        telos: &'a Telos,
    }
    let yaml = serde_yaml::to_string(&FrontMatter { telos })
        .unwrap_or_else(|_| "telos: {}\n".to_string());
    format!("---\n{}---\n", yaml)
}

/// Read `~/.blade/who-you-are.md` if present. Returns None if the file does
/// not exist or cannot be read.
pub fn read_who_you_are() -> Option<String> {
    let dir = blade_home_dir().ok()?;
    let path = dir.join(WHO_YOU_ARE_FILENAME);
    std::fs::read_to_string(&path).ok()
}

/// Read the path to `~/.blade/who-you-are.md` (creating directory if needed).
pub fn who_you_are_path() -> Result<PathBuf, String> {
    let dir = blade_home_dir()?;
    Ok(dir.join(WHO_YOU_ARE_FILENAME))
}

/// Compose Markdown body from accumulated hunt findings. Deterministic — given
/// the same `HuntFindings` the output is stable (modulo the date stamp).
///
/// Phase 56 (TELOS-SYNTH): emits a YAML `telos:` frontmatter block when the
/// hunt's final-synthesis turn contained a fenced ```telos``` block. The
/// frontmatter sits above the human-readable markdown body, allowing the
/// brain (`brain.rs::telos_section`) to read mission + goals on every chat
/// turn without re-parsing the full markdown.
pub fn synthesize_to_markdown(findings: &HuntFindings) -> String {
    synthesize_to_markdown_with_existing(findings, None)
}

/// Phase 56 (TELOS-SYNTH) — idempotent variant. When `existing_content` is
/// `Some(...)`, the existing file's telos block + body are merged into the
/// output so user edits survive a re-run of the hunt. Specifically:
///
///   - Telos fields are merged via `Telos::merge_preserve_self`: existing
///     fields win, new hunt only fills gaps. This protects manual edits like
///     "I overrode goal #2 to be more concrete" from being clobbered.
///   - The markdown BODY (everything after the frontmatter) is preserved
///     verbatim when present — only the frontmatter is regenerated.
///
/// When `existing_content` is `None`, this is the fresh-write path: build a
/// new file from the hunt findings alone.
pub fn synthesize_to_markdown_with_existing(
    findings: &HuntFindings,
    existing_content: Option<&str>,
) -> String {
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();

    // ── TELOS extraction + merge ─────────────────────────────────────────────
    // Parse the fence the LLM emitted in its closing synthesis turn.
    let mut telos = parse_telos_from_synthesis(&findings.final_synthesis);
    if let Some(existing) = existing_content {
        // Existing user edits win — only fill gaps from the new hunt.
        let prior = parse_telos_from_frontmatter(existing);
        let new_from_hunt = telos.clone();
        telos = prior;
        telos.merge_preserve_self(&new_from_hunt);
    }

    let mut out = String::new();

    // YAML frontmatter — only when telos has something to say. Skipping when
    // empty keeps the file clean on no-data hunts.
    if !telos.is_empty() {
        out.push_str(&render_telos_frontmatter(&telos));
        out.push('\n');
    }

    // ── Idempotent body preservation ─────────────────────────────────────────
    // If the existing file already had a markdown body (anything after the
    // frontmatter), keep it verbatim. The synthesis acts as a frontmatter
    // refresher, not a wholesale rewrite, after the first run.
    if let Some(existing) = existing_content {
        let body = strip_frontmatter(existing).trim_start();
        if !body.is_empty() {
            out.push_str(body);
            if !out.ends_with('\n') {
                out.push('\n');
            }
            return out;
        }
    }

    out.push_str("# Who you are (BLADE's working model)\n\n");
    out.push_str(&format!("**Last updated:** {} by hunt\n", date));
    out.push_str("**You can edit this file. BLADE re-reads it every session.**\n\n");

    // ── Identity ─────────────────────────────────────────────────────────────
    out.push_str("## Identity\n");
    // Strip the telos fence from the synthesis paragraph so the quoted
    // human-readable section doesn't render the YAML twice (once in the
    // frontmatter, once inline).
    let synthesis_clean = strip_telos_fence(&findings.final_synthesis);
    if synthesis_clean.trim().is_empty() {
        out.push_str("- (hunt produced no closing synthesis — edit this section to set who you are)\n");
    } else {
        // The closing assistant turn captured by the hunt loop. Quote verbatim
        // so the user sees what BLADE concluded and can correct it inline.
        out.push_str("> ");
        out.push_str(synthesis_clean.trim());
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
    write_who_you_are_at(content, &blade_home_dir()?)
}

/// Phase 56 helper — atomic write at an explicit directory. Lets integration
/// tests redirect to a tempdir without touching real `~/.blade/`.
pub fn write_who_you_are_at(content: &str, dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir)
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
    // Phase 56 (TELOS-SYNTH) — idempotent merge. If a prior who-you-are.md
    // exists, preserve the user's body edits AND prefer the existing telos
    // fields where present (new hunt only fills gaps). Fresh installs take
    // the no-existing-content path and write a clean file.
    let existing = read_who_you_are();
    let md = synthesize_to_markdown_with_existing(&outcome.findings, existing.as_deref());
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
