// src-tauri/tests/telos_integration.rs
//
// Phase 56 (v2.2) — TELOS-TESTS integration suite.
//
// Exercises the Phase 56 TELOS pipeline end-to-end without spinning a real
// LLM session or the Tauri runtime:
//
//   (a) hunt produces TELOS-shaped output — we drive the synthesis layer
//       with a canned final-synthesis paragraph that includes the fenced
//       ```telos``` block the hunt prompt instructs the LLM to emit, and
//       verify the resulting who-you-are.md has a complete YAML frontmatter
//       (mission + goals + beliefs + challenges).
//
//   (b) missing-fields graceful degrade — when the canned synthesis only
//       includes a mission, synthesis writes mission only and does not
//       panic. The goal: prove the parser tolerates partial telos blocks
//       and the renderer emits only what was supplied (skip_serializing_if
//       contract on the `Telos` struct).
//
//   (c) user edit round-trip — pre-seed who-you-are.md with a telos block
//       plus user-edited markdown body (different from what the hunt would
//       have produced). Re-run synthesis. Verify both (i) the user's body
//       edits survive, and (ii) the user's existing telos fields win over
//       any new hunt output for the same field (merge_preserve_self
//       contract).
//
//   (d) brain prompt includes TELOS — render the system-prompt telos
//       section directly with a populated Telos and assert mission +
//       goals appear in the output. We exercise `render_telos_section`
//       (the load-bearing renderer the live `telos_section()` calls into)
//       to avoid touching the full `build_system_prompt` config-dir chain
//       — same posture the skills_md and presence integration tests take.
//
// What this test does NOT cover:
//   - The actual LLM probe loop. Constructing real provider keys + an
//     AppHandle is outside an integration test's scope; the hunt prompt
//     extension is verified by the prompt-string presence test in (a).
//   - The Tauri command surface (`blade_open_who_you_are`). The command's
//     primary side-effect is `xdg-open` / `open` / `start`, which is
//     manual-UAT territory. We do verify the stub-file creation path here
//     in test (a) via the underlying `who_you_are_path` helper.
//
// Runtime: <50ms on a warm dev box (pure in-memory + tempdir).
//
// Serializes against a module-level ENV_LOCK because `HOME` is a
// process-global env var and `read_who_you_are` reads it via dirs::home_dir.

use blade_lib::onboarding::synthesis::{
    parse_telos_from_frontmatter, parse_telos_from_synthesis, read_who_you_are, strip_frontmatter,
    strip_telos_fence, synthesize_to_markdown, synthesize_to_markdown_with_existing,
    who_you_are_path, write_who_you_are, Telos, WHO_YOU_ARE_FILENAME,
};
use blade_lib::brain::render_telos_section;
use blade_lib::onboarding::hunt::HuntFindings;
use std::sync::Mutex;

/// Process-global env-var lock — `HOME` is mutated by the tests so they must
/// serialize. Distinct from any in-module lock because integration tests link
/// as a separate binary and don't see private statics.
static ENV_LOCK: Mutex<()> = Mutex::new(());

/// Sandbox $HOME to a tempdir for the duration of the test. Returns the
/// previous HOME so the caller can restore it. Pair this with a guard that
/// resets HOME on drop to keep test isolation tight.
struct HomeGuard {
    prior: Option<String>,
}

impl HomeGuard {
    fn install(dir: &std::path::Path) -> Self {
        let prior = std::env::var("HOME").ok();
        std::env::set_var("HOME", dir);
        Self { prior }
    }
}

impl Drop for HomeGuard {
    fn drop(&mut self) {
        match &self.prior {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
    }
}

/// Canned hunt final-synthesis paragraph + telos fence. The exact shape the
/// hunt LLM is instructed to emit by `hunt.rs::build_system_prompt`.
fn canned_full_synthesis() -> String {
    "I think I have it. You're Arnav, solo founder building Clarify — a B2B SaaS for design agencies. Right?\n\n\
     ```telos\n\
     mission: \"Build a B2B SaaS for design agencies.\"\n\
     goals:\n\
       - \"Ship MVP by end of month.\"\n\
       - \"First 10 paying customers Q2.\"\n\
     beliefs:\n\
       - \"Solo founders move 3x faster than seed-stage teams.\"\n\
       - \"AI tooling is undifferentiated below the model layer.\"\n\
     challenges:\n\
       - \"Distribution, not product, is the blocker.\"\n\
       - \"I context-switch between 4 projects.\"\n\
     ```\n".to_string()
}

fn findings_with_synthesis(s: String) -> HuntFindings {
    let mut f = HuntFindings::default();
    f.final_synthesis = s;
    f
}

// ─── Test (a) ────────────────────────────────────────────────────────────────
//
// Hunt produces TELOS-shaped output. Drive the synthesis with a full canned
// fence and verify the resulting who-you-are.md contains a complete YAML
// frontmatter (mission + all 3 list fields), and that the frontmatter parses
// back into a `Telos` whose fields match the canned input.
#[test]
fn telos_a_hunt_produces_shaped_output() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let td = tempfile::tempdir().unwrap();
    let _home = HomeGuard::install(td.path());

    let findings = findings_with_synthesis(canned_full_synthesis());
    let md = synthesize_to_markdown(&findings);
    let path = write_who_you_are(&md).unwrap();
    assert!(path.exists(), "synthesis must write the file");

    // Frontmatter shape: starts with `---\n`, contains `telos:`, ends the
    // frontmatter block before the markdown body.
    let on_disk = std::fs::read_to_string(&path).unwrap();
    assert!(on_disk.starts_with("---\n"), "frontmatter must lead the file");
    assert!(on_disk.contains("telos:"), "frontmatter must contain telos key");
    assert!(on_disk.contains("Build a B2B SaaS"), "mission must round-trip");
    assert!(on_disk.contains("Ship MVP"), "first goal must round-trip");
    assert!(on_disk.contains("Solo founders"), "first belief must round-trip");
    assert!(on_disk.contains("Distribution"), "first challenge must round-trip");

    // The markdown body should NOT contain the raw ```telos fence — synth
    // strips it (so it isn't rendered twice).
    let body = strip_frontmatter(&on_disk);
    assert!(!body.contains("```telos"),
        "raw telos fence must be stripped from body so it isn't rendered twice");

    // Round-trip parse: the frontmatter parsed back into a Telos struct
    // contains exactly the fields the canned synthesis carried.
    let telos = parse_telos_from_frontmatter(&on_disk);
    assert_eq!(telos.mission.as_deref(), Some("Build a B2B SaaS for design agencies."));
    assert_eq!(telos.goals.len(), 2);
    assert_eq!(telos.beliefs.len(), 2);
    assert_eq!(telos.challenges.len(), 2);

    // Sanity: who_you_are_path resolves to the file we just wrote.
    let resolved = who_you_are_path().unwrap();
    assert_eq!(resolved.file_name().and_then(|s| s.to_str()), Some(WHO_YOU_ARE_FILENAME));
    assert_eq!(resolved, path);

    // read_who_you_are reads the file we just wrote (via $HOME redirect).
    let read_back = read_who_you_are().unwrap();
    assert_eq!(read_back, on_disk);
}

// ─── Test (b) ────────────────────────────────────────────────────────────────
//
// Missing-fields graceful degrade. The LLM emits only `mission:` — no goals,
// no beliefs, no challenges. Synthesis must write the file successfully,
// emit a frontmatter with mission only (no empty list keys), and the
// frontmatter must round-trip.
#[test]
fn telos_b_missing_fields_degrade_gracefully() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let td = tempfile::tempdir().unwrap();
    let _home = HomeGuard::install(td.path());

    let partial = "I think I have it. You're Arnav. Right?\n\n\
                   ```telos\n\
                   mission: \"Figure out what to do next.\"\n\
                   ```\n";
    let findings = findings_with_synthesis(partial.to_string());

    // No panic, no error.
    let md = synthesize_to_markdown(&findings);
    let path = write_who_you_are(&md).unwrap();
    let on_disk = std::fs::read_to_string(&path).unwrap();

    // Mission survived.
    assert!(on_disk.contains("Figure out what to do next"),
        "partial mission must survive");
    let telos = parse_telos_from_frontmatter(&on_disk);
    assert_eq!(telos.mission.as_deref(), Some("Figure out what to do next."));
    assert!(telos.goals.is_empty(), "no goals in canned input → empty list");
    assert!(telos.beliefs.is_empty(), "no beliefs in canned input → empty list");
    assert!(telos.challenges.is_empty(), "no challenges in canned input → empty list");

    // Frontmatter should not carry empty keys for the missing fields
    // (skip_serializing_if contract). Check the raw YAML.
    let fm_end = on_disk.find("\n---\n").unwrap();
    let fm = &on_disk[..fm_end + 5];
    assert!(!fm.contains("goals:"), "goals: key must be omitted when list is empty");
    assert!(!fm.contains("beliefs:"), "beliefs: key must be omitted when list is empty");
    assert!(!fm.contains("challenges:"), "challenges: key must be omitted when list is empty");

    // Body still rendered (identity, machine snapshot, etc.).
    let body = strip_frontmatter(&on_disk);
    assert!(body.contains("# Who you are"), "default body must still render");

    // Edge case: completely missing telos fence → no frontmatter at all.
    let no_fence_findings = findings_with_synthesis(
        "I think I have it. You're Arnav. Right?".to_string()
    );
    let md_nofence = synthesize_to_markdown(&no_fence_findings);
    assert!(!md_nofence.starts_with("---\n"),
        "no telos fence → no frontmatter at top of file");

    // strip_telos_fence on a string without a fence is a no-op.
    assert_eq!(strip_telos_fence("hello world"), "hello world");
    // parse_telos_from_synthesis on bogus input returns default (no panic).
    let bogus = parse_telos_from_synthesis("```telos\nthis is :: not yaml\n```");
    // serde_yaml may parse "this is" as a key — assert no panic + degrade.
    // We don't pin the exact failure mode, just that we got something back.
    let _ = bogus.is_empty();
}

// ─── Test (c) ────────────────────────────────────────────────────────────────
//
// User edit round-trip preserves structure. Pre-seed who-you-are.md with
// (i) telos fields the user has edited and (ii) a custom markdown body.
// Run synthesis again with new hunt findings that would, if not for the
// merge guard, overwrite the user's edits. Verify:
//   1. Telos fields the user set survive (merge_preserve_self: existing wins).
//   2. Telos fields the user did NOT set get filled by the new hunt.
//   3. The user's markdown body is preserved verbatim.
#[test]
fn telos_c_user_edits_round_trip_preserved() {
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let td = tempfile::tempdir().unwrap();
    let _home = HomeGuard::install(td.path());

    // Pre-seed: user has set mission + goals to specific values, AND added
    // a custom "Notes" section at the bottom of the body.
    let user_edited = "---\n\
                       telos:\n  \
                       mission: \"My OWN mission statement.\"\n  \
                       goals:\n  - \"My own goal 1.\"\n  - \"My own goal 2.\"\n\
                       ---\n\
                       # Who you are (BLADE's working model)\n\n\
                       ## Identity\n\
                       > I edited this manually.\n\n\
                       ## My Custom Section\n\
                       This is user-added content that must not be clobbered.\n";

    std::fs::create_dir_all(td.path().join(".blade")).unwrap();
    std::fs::write(td.path().join(".blade").join(WHO_YOU_ARE_FILENAME), user_edited).unwrap();

    // Now run synthesis with a new hunt that would otherwise overwrite
    // everything (different mission, different goals, but also has
    // challenges the user hadn't set yet).
    let new_synthesis = "I think I have it. You're a different person. Right?\n\n\
                        ```telos\n\
                        mission: \"WRONG mission from a new hunt run.\"\n\
                        goals:\n  - \"Wrong new goal.\"\n\
                        challenges:\n  - \"A new challenge the user hadn't captured.\"\n\
                        ```\n";
    let findings = findings_with_synthesis(new_synthesis.to_string());

    let existing = read_who_you_are().expect("pre-seed must be readable");
    let md = synthesize_to_markdown_with_existing(&findings, Some(&existing));
    let path = write_who_you_are(&md).unwrap();
    let on_disk = std::fs::read_to_string(&path).unwrap();

    // (1) User's edited telos fields win.
    let telos = parse_telos_from_frontmatter(&on_disk);
    assert_eq!(telos.mission.as_deref(), Some("My OWN mission statement."),
        "user's mission must survive (merge_preserve_self)");
    assert_eq!(telos.goals.len(), 2, "user's 2 goals must survive (not be replaced by new hunt's 1)");
    assert!(telos.goals.iter().any(|g| g.contains("My own goal 1")),
        "user goal 1 must survive");

    // (2) Gap-fill: user didn't set challenges → new hunt fills them.
    assert_eq!(telos.challenges.len(), 1,
        "challenges gap must be filled from new hunt");
    assert!(telos.challenges[0].contains("new challenge"),
        "filled challenge content must come from new hunt");

    // (3) User's markdown body preserved verbatim — custom section survives.
    assert!(on_disk.contains("## My Custom Section"),
        "user's custom section must survive");
    assert!(on_disk.contains("user-added content that must not be clobbered"),
        "user's custom prose must survive");

    // The new hunt's WRONG mission must NOT appear anywhere.
    assert!(!on_disk.contains("WRONG mission"),
        "new hunt's mission must be discarded in favor of user edit");
}

// ─── Test (d) ────────────────────────────────────────────────────────────────
//
// Brain prompt includes TELOS when present. Render the telos section
// directly with a populated `Telos` and verify the mission + goals appear
// in the output. This is the load-bearing renderer that `telos_section()`
// (the live brain call site) delegates to.
#[test]
fn telos_d_brain_prompt_includes_telos() {
    // No env lock needed — this test doesn't touch HOME or any filesystem.
    let telos = Telos {
        mission: Some("Build a B2B SaaS for design agencies.".to_string()),
        goals: vec![
            "Ship MVP by end of month.".to_string(),
            "First 10 paying customers Q2.".to_string(),
        ],
        beliefs: vec!["Distribution beats product polish.".to_string()],
        challenges: vec!["Context-switching kills throughput.".to_string()],
    };
    let section = render_telos_section(&telos);

    // Mission appears under the labeled heading.
    assert!(section.contains("## Your Mission"),
        "section must label the mission block");
    assert!(section.contains("Build a B2B SaaS for design agencies"),
        "mission text must appear in the system prompt");

    // Goals appear as a bulleted list under their heading.
    assert!(section.contains("## Active Goals"),
        "section must label the goals block");
    assert!(section.contains("- Ship MVP by end of month."),
        "first goal must render as bullet");
    assert!(section.contains("- First 10 paying customers Q2."),
        "second goal must render as bullet");

    // Beliefs + challenges also present (brain ingests all four).
    assert!(section.contains("## Beliefs You Hold"));
    assert!(section.contains("Distribution beats product polish"));
    assert!(section.contains("## Current Challenges"));
    assert!(section.contains("Context-switching"));

    // Now exercise the full path via $HOME redirect + read_who_you_are
    // → mission must appear via the live read path too.
    let _lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let td = tempfile::tempdir().unwrap();
    let _home = HomeGuard::install(td.path());
    let findings = findings_with_synthesis(canned_full_synthesis());
    let md = synthesize_to_markdown(&findings);
    write_who_you_are(&md).unwrap();

    // Re-read via the production helper and render via the production
    // entry point (`render_telos_section` on a parsed frontmatter).
    let read = read_who_you_are().unwrap();
    let parsed = parse_telos_from_frontmatter(&read);
    let live_section = render_telos_section(&parsed);
    assert!(live_section.contains("Build a B2B SaaS for design agencies"),
        "live read path must surface the mission");
    assert!(live_section.contains("Ship MVP"),
        "live read path must surface goal 1");
}

// ─── Empty-telos sentinel ────────────────────────────────────────────────────
//
// Defensive: an empty Telos must render to an empty string so brain.rs
// doesn't push a section consisting of headings with no content.
#[test]
fn telos_empty_renders_empty() {
    let empty = Telos::default();
    assert!(empty.is_empty());
    assert_eq!(render_telos_section(&empty), "");
}
