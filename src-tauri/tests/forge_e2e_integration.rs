// src-tauri/tests/forge_e2e_integration.rs
//
// Phase 47 (FORGE-03) — end-to-end integration test for the forge wire.
//
// Per .planning/V2-AUTONOMOUS-HANDOFF.md §1, real-LLM tests are operator-
// owned and run manually via the `BLADE_FORGE_DEMO=1` path documented in
// `scripts/demo/forge-demo.md`. This test exercises the build-time path:
// the forge pipeline (`persist_forged_tool` → smoke-test → DB insert →
// SKILL.md export) using a MOCK tool spec that mirrors what an LLM would
// produce for the chosen capability gap (HackerNews top stories), plus
// covers the `pre_check_existing_tools` keyword-overlap logic so the
// integration surface is exercised without making a real Anthropic/OpenAI
// API call.
//
// What is NOT tested here (intentionally):
//   - The Tauri event surface (`blade_forge_line`). Constructing an
//     `AppHandle` in a unit test requires bootstrapping the full Tauri
//     runtime; verifying the emit_to call is more cheaply done at runtime
//     via the demo script + screen recording. The functions that fire
//     emits (`emit_forge_line`, the `Some(app)` arms of
//     `persist_forged_tool_inner` and `forge_tool_inner`) are wrapped in
//     `if let Some(a) = app` guards — passing `None` exercises every
//     other side-effect (DB, fs, SKILL.md) without needing a window.
//
// Runtime: <3s on a warm dev box (no network, no LLM).
//
// Serializes against the module-level ENV_LOCK pattern from
// `tool_forge::tests` because `BLADE_CONFIG_DIR` is a process-global
// env var.

use blade_lib::tool_forge::{
    arxiv_abstract_fixture, forge_tool_from_fixture, get_forged_tools, pre_check_existing_tools,
    rss_feed_fixture, ForgeGeneration, ToolParameter,
};
use std::path::PathBuf;
use std::sync::Mutex;

/// Process-global env-var lock — same pattern as `tool_forge::tests::ENV_LOCK`.
/// Distinct from the in-module lock because integration tests link as a
/// separate binary and don't see the module's private statics.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn fresh_config_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let p = std::env::temp_dir().join(format!("blade-forge-e2e-{tag}-{nanos}"));
    std::fs::create_dir_all(&p).unwrap();
    p
}

/// Phase 47 chosen capability gap (per 47-CONTEXT.md §"Gap chosen"):
/// "Show me today's top 5 HackerNews stories with titles, points, and
/// comment counts." This is what an LLM would produce given that prompt
/// — a self-contained Python script using only the standard library +
/// `urllib.request` (no `requests` dep) hitting the HN Firebase API.
fn hackernews_top_stories_fixture() -> ForgeGeneration {
    ForgeGeneration {
        script_code: r#"#!/usr/bin/env python3
"""Fetch the top N stories from HackerNews via the public Firebase API.

Usage:
    hackernews_top_stories.py [N]      # N defaults to 5
"""
import json
import sys
import urllib.request


HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{id}.json"


def fetch_json(url: str, timeout: int = 8):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    try:
        n = int(sys.argv[1]) if len(sys.argv) > 1 else 5
    except ValueError:
        print("usage: hackernews_top_stories.py [N]", file=sys.stderr)
        return 1
    n = max(1, min(n, 30))
    try:
        top_ids = fetch_json(HN_TOP)[:n]
        items = [fetch_json(HN_ITEM.format(id=i)) for i in top_ids]
    except Exception as e:
        print(f"network error: {e}", file=sys.stderr)
        return 1
    out = [
        {
            "title": it.get("title", ""),
            "score": it.get("score", 0),
            "comments": it.get("descendants", 0),
            "url": it.get("url", ""),
        }
        for it in items
        if it
    ]
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
"#
        .to_string(),
        description: "Fetch the top N stories from HackerNews with titles, scores, and comment counts.".to_string(),
        usage_template: "tool.py [N]".to_string(),
        parameters: vec![ToolParameter {
            name: "n".to_string(),
            param_type: "integer".to_string(),
            description: "Number of stories to fetch (1-30, default 5)".to_string(),
            required: false,
        }],
    }
}

#[tokio::test]
async fn forge_e2e_hackernews_top_stories_lands_in_catalog() {
    let _g = ENV_LOCK.lock().unwrap();
    let dir = fresh_config_dir("hn-top");
    std::env::set_var("BLADE_CONFIG_DIR", &dir);

    let forged = forge_tool_from_fixture(
        "Show me today's top 5 HackerNews stories with titles, points, and comment counts.",
        "python",
        hackernews_top_stories_fixture(),
    )
    .await
    .expect("forge_tool_from_fixture should land the HN tool");

    // 1. Script artifact on disk
    let script_path = PathBuf::from(&forged.script_path);
    assert!(
        script_path.is_file(),
        "script should exist at {}",
        script_path.display()
    );
    assert!(
        forged.script_path.ends_with(".py"),
        "language=python should write a .py file, got {}",
        forged.script_path
    );

    // 2. DB row queryable via the public catalog API
    let all = get_forged_tools();
    assert!(
        all.iter().any(|t| t.id == forged.id),
        "forged tool should be retrievable via get_forged_tools()"
    );

    // 3. Description carries the capability surface
    assert!(
        forged.description.to_lowercase().contains("hackernews")
            || forged.description.to_lowercase().contains("top"),
        "description should reference the capability; got: {}",
        forged.description
    );

    // 4. The usage string substituted the real filename for the `tool.py` placeholder
    let fname = format!("{}.py", forged.name);
    assert!(
        forged.usage.contains(&fname),
        "usage '{}' should reference the actual script filename '{}'",
        forged.usage,
        fname
    );

    std::env::remove_var("BLADE_CONFIG_DIR");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Pre-check: after a tool is forged, asking for the same capability again
/// should match it and SHORT-CIRCUIT the forge. This is the FORGE-02 risk
/// mitigation per 47-CONTEXT.md §Risks #2.
#[tokio::test]
async fn pre_check_matches_existing_forged_tool() {
    let _g = ENV_LOCK.lock().unwrap();
    let dir = fresh_config_dir("precheck-existing");
    std::env::set_var("BLADE_CONFIG_DIR", &dir);

    // Pre-state: nothing forged yet. Pre-check should miss.
    let none = pre_check_existing_tools("fetch top hackernews stories");
    assert!(
        none.is_none(),
        "pre-check should miss on an empty catalog; got {:?}",
        none
    );

    // Forge the HN tool.
    let _ = forge_tool_from_fixture(
        "fetch top hackernews stories",
        "python",
        hackernews_top_stories_fixture(),
    )
    .await
    .expect("forge should succeed");

    // Now the same gap should match.
    let hit = pre_check_existing_tools("fetch top hackernews stories with scores");
    assert!(
        hit.is_some(),
        "pre-check should match a previously-forged tool on token overlap; got None"
    );

    std::env::remove_var("BLADE_CONFIG_DIR");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Pre-check should NOT match an unrelated gap even when one forged tool
/// already exists in the catalog — token overlap is a per-gap test, not
/// a "anything forged means stop forging" gate.
#[tokio::test]
async fn pre_check_misses_unrelated_gap() {
    let _g = ENV_LOCK.lock().unwrap();
    let dir = fresh_config_dir("precheck-miss");
    std::env::set_var("BLADE_CONFIG_DIR", &dir);

    let _ = forge_tool_from_fixture(
        "fetch top hackernews stories",
        "python",
        hackernews_top_stories_fixture(),
    )
    .await
    .expect("forge should succeed");

    // Completely unrelated gap — no token overlap with HN tool.
    let miss = pre_check_existing_tools("convert an mp4 to a webm with ffmpeg");
    // NOTE: `ffmpeg` is in native_tools.rs::tool_definitions only as a
    // mention in `blade_bash` description, not as its own tool. The
    // all-tokens-match rule (every ≥4-char token must hit the haystack)
    // means "convert" + "webm" + "ffmpeg" together won't all hit any
    // single haystack we just forged.
    assert!(
        miss.is_none(),
        "pre-check should miss on an unrelated capability; got {:?}",
        miss
    );

    std::env::remove_var("BLADE_CONFIG_DIR");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Pre-check should match against the native-tool catalog so the forge
/// doesn't duplicate built-in capabilities. `blade_bash` has a rich
/// description covering shell + git + npm + cargo etc., so a gap like
/// "execute a shell command and return stdout" must short-circuit.
#[tokio::test]
async fn pre_check_matches_native_tool() {
    // No env-lock needed — this test only reads from native_tools, not
    // BLADE_CONFIG_DIR. But the lock guards against another test setting
    // BLADE_CONFIG_DIR mid-run, so we still acquire it for cleanliness.
    let _g = ENV_LOCK.lock().unwrap();

    let hit = pre_check_existing_tools("execute a shell command and return stdout");
    assert!(
        hit.is_some(),
        "pre-check should match the native blade_bash tool for shell-execute gaps; got None"
    );
    let name = hit.unwrap();
    assert!(
        name.starts_with("blade_"),
        "matched name should be a native tool; got {}",
        name
    );
}

/// Empty / whitespace gap: no tokens survive the ≥4-char filter, so the
/// pre-check must not crash AND must return None (no false positive).
#[tokio::test]
async fn pre_check_handles_empty_gap() {
    assert!(pre_check_existing_tools("").is_none());
    assert!(pre_check_existing_tools("   ").is_none());
    assert!(pre_check_existing_tools("a b c").is_none(), "no token ≥4 chars");
}

// ── Phase 51 (FORGE-GAP-*) — multi-gap robustness integration tests ──────────
//
// One test per new fixture, mirroring `forge_e2e_hackernews_top_stories_lands_
// in_catalog` shape: forge the tool, then assert script-on-disk + DB row +
// description carries the capability surface + usage substitution.

/// Phase 51 (FORGE-GAP-ARXIV) — gap detected → tool written → smoke-test runs
/// → registered. Equivalent to the HN test but for the arXiv abstract fetcher.
#[tokio::test]
async fn forge_e2e_arxiv_abstract_lands_in_catalog() {
    let _g = ENV_LOCK.lock().unwrap();
    let dir = fresh_config_dir("arxiv-abstract");
    std::env::set_var("BLADE_CONFIG_DIR", &dir);

    let forged = forge_tool_from_fixture(
        "fetch the abstract of an arXiv paper by ID or URL",
        "python",
        arxiv_abstract_fixture(),
    )
    .await
    .expect("forge_tool_from_fixture should land the arXiv tool");

    // 1. Script artifact on disk
    let script_path = PathBuf::from(&forged.script_path);
    assert!(
        script_path.is_file(),
        "script should exist at {}",
        script_path.display()
    );
    assert!(
        forged.script_path.ends_with(".py"),
        "language=python should write a .py file, got {}",
        forged.script_path
    );

    // 2. DB row queryable via the public catalog API
    let all = get_forged_tools();
    assert!(
        all.iter().any(|t| t.id == forged.id),
        "forged tool should be retrievable via get_forged_tools()"
    );

    // 3. Description carries the capability surface
    let desc_lower = forged.description.to_lowercase();
    assert!(
        desc_lower.contains("arxiv") || desc_lower.contains("abstract"),
        "description should reference the capability; got: {}",
        forged.description
    );

    // 4. Usage string substituted the real filename for the placeholder
    let fname = format!("{}.py", forged.name);
    assert!(
        forged.usage.contains(&fname),
        "usage '{}' should reference the actual script filename '{}'",
        forged.usage,
        fname
    );

    // 5. The script should actually be runnable in a sandbox — invoke it with
    //    --help and confirm it doesn't crash (stderr usage line is fine, exit
    //    code is non-zero by design; we only care that python parsed it).
    let py = std::process::Command::new("python3")
        .arg(&forged.script_path)
        .arg("--help")
        .output()
        .expect("python3 should be available on the test host");
    let stderr = String::from_utf8_lossy(&py.stderr);
    assert!(
        !stderr.contains("SyntaxError"),
        "arxiv fixture should be syntactically valid Python; got: {}",
        stderr
    );

    std::env::remove_var("BLADE_CONFIG_DIR");
    let _ = std::fs::remove_dir_all(&dir);
}

/// Phase 51 (FORGE-GAP-RSS) — gap detected → tool written → smoke-test runs
/// → registered. Equivalent to the HN/arXiv tests but for the RSS/Atom feed
/// extractor.
#[tokio::test]
async fn forge_e2e_rss_feed_lands_in_catalog() {
    let _g = ENV_LOCK.lock().unwrap();
    let dir = fresh_config_dir("rss-feed");
    std::env::set_var("BLADE_CONFIG_DIR", &dir);

    let forged = forge_tool_from_fixture(
        "extract titles and summaries from an RSS or Atom feed URL",
        "python",
        rss_feed_fixture(),
    )
    .await
    .expect("forge_tool_from_fixture should land the RSS tool");

    let script_path = PathBuf::from(&forged.script_path);
    assert!(script_path.is_file(), "script should exist");
    assert!(forged.script_path.ends_with(".py"));

    let all = get_forged_tools();
    assert!(
        all.iter().any(|t| t.id == forged.id),
        "forged tool should be retrievable via get_forged_tools()"
    );

    let desc_lower = forged.description.to_lowercase();
    assert!(
        desc_lower.contains("rss")
            || desc_lower.contains("atom")
            || desc_lower.contains("feed"),
        "description should reference the capability; got: {}",
        forged.description
    );

    let fname = format!("{}.py", forged.name);
    assert!(
        forged.usage.contains(&fname),
        "usage '{}' should reference the actual script filename '{}'",
        forged.usage,
        fname
    );

    // Script should be syntactically valid Python (smoke-test ran during forge;
    // re-invoke here to make the assertion explicit).
    let py = std::process::Command::new("python3")
        .arg(&forged.script_path)
        .arg("--help")
        .output()
        .expect("python3 should be available on the test host");
    let stderr = String::from_utf8_lossy(&py.stderr);
    assert!(
        !stderr.contains("SyntaxError"),
        "rss fixture should be syntactically valid Python; got: {}",
        stderr
    );

    std::env::remove_var("BLADE_CONFIG_DIR");
    let _ = std::fs::remove_dir_all(&dir);
}
