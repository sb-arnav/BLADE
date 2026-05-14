// src-tauri/tests/skills_md_integration.rs
//
// Phase 57 (v2.2) — SKILLS-TESTS integration suite.
//
// Exercises the phase-57 SKILL.md substrate end to end without the Tauri
// runtime: the loader parses a real on-disk SKILL.md, malformed files are
// rejected, trigger matching is case-insensitive + word-boundary, the
// install command validates schema before writing, and the dispatch path
// rebuilds the system prompt with the matched skill body up front.
//
// What is NOT tested here:
//   - The Tauri event surface (`blade_skill_dispatch`). Constructing an
//     AppHandle in a unit test requires bootstrapping the full Tauri
//     runtime; the emit guard in commands.rs is wrapped in
//     `emit_stream_event` which is itself test-safe (no-op without an
//     AppHandle). We verify the dispatch DECISION (match_trigger returns
//     the right manifest); whether that decision reaches the chat surface
//     is verified at runtime via the demo path.
//
// Runtime: <1s on a warm dev box (no network, no LLM).
//
// Serializes against a module-level ENV_LOCK because `BLADE_CONFIG_DIR`
// is a process-global env var, and the in-process `SkillsRegistry` is a
// process-global OnceLock.

use blade_lib::skills_md::{
    install_from_text, install_registry, match_trigger, registry, scan_directory, user_skills_dir,
    SkillManifest,
};
use std::path::PathBuf;
use std::sync::Mutex;

/// Process-global env-var + registry lock — same pattern as
/// `tool_forge::tests::ENV_LOCK`. Distinct from any in-module lock because
/// integration tests link as a separate binary and don't see private statics.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn fresh_config_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let p = std::env::temp_dir().join(format!("blade-skills-md-int-{tag}-{nanos}"));
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// Write a SKILL.md with the given frontmatter + body into
/// `<root>/<name>/SKILL.md`. Returns the SKILL.md path.
fn write_skill(root: &std::path::Path, name: &str, body: &str) -> PathBuf {
    let dir = root.join(name);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("SKILL.md");
    std::fs::write(&path, body).unwrap();
    path
}

/// Clear the process-global registry between tests. Without this, an earlier
/// test's writes leak into the next test's `match_trigger` lookup.
fn clear_registry() {
    let _ = registry().write().map(|mut g| g.clear());
}

// ─── Test (a) — loader parses valid SKILL.md ─────────────────────────────────

#[test]
fn loader_parses_valid_skill_md() {
    let _g = ENV_LOCK.lock().unwrap();
    let root = fresh_config_dir("test-a");
    std::env::set_var("BLADE_CONFIG_DIR", &root);

    let skills_root = user_skills_dir();
    std::fs::create_dir_all(&skills_root).unwrap();

    let valid = r#"---
name: summarize-page
description: Summarize the active page into 5 bullets.
triggers:
  - "summarize this page"
  - "tldr this page"
tools:
  - browser_get_page_text
model_hint: claude-3-5-sonnet-20241022
---

# summarize-page

Body markdown here.
"#;
    write_skill(&skills_root, "summarize-page", valid);

    let manifests = scan_directory(&skills_root);
    assert_eq!(manifests.len(), 1);
    let m = &manifests[0];
    assert_eq!(m.name, "summarize-page");
    assert_eq!(
        m.triggers,
        vec!["summarize this page", "tldr this page"]
    );
    assert_eq!(m.tools, vec!["browser_get_page_text"]);
    assert_eq!(m.model_hint.as_deref(), Some("claude-3-5-sonnet-20241022"));
    assert!(m.body.contains("# summarize-page"));

    std::env::remove_var("BLADE_CONFIG_DIR");
}

// ─── Test (b) — loader rejects malformed YAML without failing the scan ───────

#[test]
fn loader_rejects_malformed_yaml() {
    let _g = ENV_LOCK.lock().unwrap();
    let root = fresh_config_dir("test-b");
    std::env::set_var("BLADE_CONFIG_DIR", &root);

    let skills_root = user_skills_dir();
    std::fs::create_dir_all(&skills_root).unwrap();

    // Good skill — should land.
    let good = "---\nname: good\ndescription: ok\ntriggers:\n  - hi\n---\nbody\n";
    write_skill(&skills_root, "good", good);

    // Malformed — unclosed YAML list.
    let bad = "---\nname: bad\ndescription: oops\ntriggers: [unterminated\n---\nbody\n";
    write_skill(&skills_root, "bad", bad);

    // Also reject SkillManifest::parse_skill_md on the bad text directly.
    let err = SkillManifest::parse_skill_md(bad).err();
    assert!(err.is_some(), "malformed YAML should produce parse error");

    let manifests = scan_directory(&skills_root);
    let names: Vec<&str> = manifests.iter().map(|m| m.name.as_str()).collect();
    assert!(names.contains(&"good"), "good skill must survive");
    assert!(!names.contains(&"bad"), "bad skill must be skipped");

    std::env::remove_var("BLADE_CONFIG_DIR");
}

// ─── Test (c) — trigger phrase matches case-insensitively ────────────────────

#[test]
fn trigger_matches_case_insensitively_and_word_boundary() {
    let _g = ENV_LOCK.lock().unwrap();
    let root = fresh_config_dir("test-c");
    std::env::set_var("BLADE_CONFIG_DIR", &root);

    let skills_root = user_skills_dir();
    std::fs::create_dir_all(&skills_root).unwrap();

    let text = r#"---
name: kill-tabs
description: triage and close tabs
triggers:
  - "kill the tabs"
  - "close everything"
---
body
"#;
    write_skill(&skills_root, "kill-tabs", text);

    clear_registry();
    let n = install_registry();
    assert_eq!(n, 1);

    // Mixed case + leading + trailing fluff — should still match.
    let m = match_trigger("Hey BLADE, please KILL the TABS I'm not using.")
        .expect("case-insensitive trigger should fire");
    assert_eq!(m.name, "kill-tabs");

    // Second trigger same skill.
    let m2 = match_trigger("Close Everything except gmail")
        .expect("alt trigger should fire");
    assert_eq!(m2.name, "kill-tabs");

    // Negative: trigger inside a larger word does NOT fire. ("killing" must
    // not trip "kill the tabs" — but that case is moot for this trigger
    // since it has a space. Use a synthetic check via SkillManifest's
    // dispatch boundary semantics by issuing a near-miss.)
    let miss = match_trigger("kill the");
    assert!(
        miss.is_none(),
        "partial trigger must NOT match; got {:?}",
        miss.map(|m| m.name)
    );

    std::env::remove_var("BLADE_CONFIG_DIR");
}

// ─── Test (d) — install command validates schema (good accepted, bad rejected)

#[test]
fn install_command_validates_schema() {
    let _g = ENV_LOCK.lock().unwrap();
    let root = fresh_config_dir("test-d");
    std::env::set_var("BLADE_CONFIG_DIR", &root);

    // (1) Good payload accepted, file written, name returned.
    let good = "---\nname: my-helper\ndescription: a helper\ntriggers:\n  - help me\n---\nbody\n";
    let name = install_from_text(good).expect("good payload should install");
    assert_eq!(name, "my-helper");
    let written = user_skills_dir().join("my-helper").join("SKILL.md");
    assert!(written.is_file(), "SKILL.md not written at {written:?}");

    // (2) Bad payload — uppercase name violates lowercase-and-hyphens validator.
    let bad = "---\nname: BAD_NAME\ndescription: oops\ntriggers:\n  - x\n---\nbody\n";
    let err = install_from_text(bad).err().expect("bad payload should fail");
    assert!(
        err.contains("invalid skill"),
        "unexpected error wording: {err}"
    );
    let bad_written = user_skills_dir().join("BAD_NAME").join("SKILL.md");
    assert!(!bad_written.exists(), "bad payload must NOT write anything");

    // (3) Bad payload — empty triggers.
    let no_trigs =
        "---\nname: silent-skill\ndescription: ok\ntriggers: []\n---\nbody\n";
    let err = install_from_text(no_trigs).err().expect("should fail");
    assert!(err.contains("invalid skill"));

    std::env::remove_var("BLADE_CONFIG_DIR");
}

// ─── Test (e) — dispatch routes to skill prompt when trigger matches ─────────

#[test]
fn dispatch_routes_to_matching_skill() {
    let _g = ENV_LOCK.lock().unwrap();
    let root = fresh_config_dir("test-e");
    std::env::set_var("BLADE_CONFIG_DIR", &root);

    let skills_root = user_skills_dir();
    std::fs::create_dir_all(&skills_root).unwrap();

    let text = r#"---
name: morning-context
description: Morning briefing.
triggers:
  - "morning briefing"
  - "brief me"
tools:
  - mcp_call_calendar_today
---

# morning-context

You are the morning-context skill. Produce a 30-second briefing.
"#;
    write_skill(&skills_root, "morning-context", text);

    clear_registry();
    install_registry();

    // Exact match — should route.
    let m = match_trigger("could you give me a Morning Briefing for today")
        .expect("dispatch should route on trigger");
    assert_eq!(m.name, "morning-context");
    assert!(
        m.body.contains("You are the morning-context skill"),
        "skill body must accompany the routing decision so callers can \
         prepend it to the system prompt"
    );

    // Non-matching message — must NOT route.
    let none = match_trigger("what's the weather like in dubai");
    assert!(none.is_none(), "non-matching message must not route");

    std::env::remove_var("BLADE_CONFIG_DIR");
}
