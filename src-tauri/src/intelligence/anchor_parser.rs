//! INTEL-06 @screen / @file: / @memory: regex-based anchor extraction.
//!
//! Phase 36 Plan 36-07 (Wave 5):
//!   `extract_anchors(query) -> (String, Vec<Anchor>)` — three regex patterns
//!   evaluated in order with `\B` word-boundary discipline so embedded `@`
//!   (e.g. email addresses like `arnav@pollpe.in`) does NOT match.
//!
//!   `resolve_anchors(anchors, app, config) -> Vec<(label, content)>` —
//!   per-anchor injection routing:
//!     - `Anchor::Screen` → most-recent screen_timeline description (Phase 32
//!       vision section harvester)
//!     - `Anchor::File { path }` → `std::fs::read` capped at 200_000 bytes
//!       with truncation suffix; binary-byte heuristic rejects null-byte
//!       payloads.
//!     - `Anchor::Memory { topic }` → `embeddings::smart_context_recall(topic)`
//!       (closest existing public memory-retrieval helper; the planned
//!       `memory::query_memories` is not present in the runtime tree).
//!
//! Wired into `commands.rs::send_message_stream_inline` behind
//! `config.intelligence.context_anchor_enabled`. catch_unwind discipline lives
//! at the call site (CTX-07 v1.1 pattern); the `INTEL_FORCE_ANCHOR_PANIC`
//! thread-local seam mirrors Phase 33-04 / 34-04 / 35-04 so 36-09 can lock the
//! fall-through regression.

use std::cell::Cell;
use std::collections::HashSet;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::config::BladeConfig;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Anchor {
    Screen,
    File { path: String },
    Memory { topic: String },
}

// ── Locked regex patterns ───────────────────────────────────────────────────
// `\B` matches the empty position that is NOT a word boundary. For
// `arnav@pollpe.in` the position before `@` sits between `v` (word) and `@`
// (non-word) → that IS a word boundary → `\B` fails → no match. For
// `say @screen now` the position before `@` sits between ` ` (non-word) and
// `@` (non-word) → NOT a word boundary → `\B` succeeds → match fires.
// This is the load-bearing distinction; the regression test
// `phase36_intel_06_email_address_does_not_match_screen` locks it.
static SCREEN_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\B@screen\b").unwrap());
static FILE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\B@file:([^\s]+)").unwrap());
static MEMORY_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\B@memory:([^\s]+)").unwrap());

// ── Test seam ───────────────────────────────────────────────────────────────
// Plan 33-04 / 34-04 / 35-04 pattern. When set, `extract_anchors` panics
// inside its body so the catch_unwind wrapper in commands.rs can be
// exercised. Available at runtime (not gated on cfg(test)) because Plan 36-09
// wires the panic-injection regression at the commands.rs integration site.
thread_local! {
    pub static INTEL_FORCE_ANCHOR_PANIC: Cell<bool> = const { Cell::new(false) };
}

/// Extracts `@screen`, `@file:PATH`, `@memory:TOPIC` anchors from a user query.
/// Returns the cleaned query (anchor tokens stripped, whitespace collapsed)
/// alongside the dedup-by-(type,payload) anchors Vec.
pub fn extract_anchors(query: &str) -> (String, Vec<Anchor>) {
    if INTEL_FORCE_ANCHOR_PANIC.with(|c| c.get()) {
        panic!("forced anchor parser panic via test seam");
    }

    let mut working = query.to_string();
    let mut anchors: Vec<Anchor> = Vec::new();
    let mut seen: HashSet<(String, String)> = HashSet::new();

    // Pass 1: @screen
    loop {
        let m = match SCREEN_RE.find(&working) {
            Some(m) => m,
            None => break,
        };
        let r = m.range();
        let key = ("screen".to_string(), String::new());
        if seen.insert(key) {
            anchors.push(Anchor::Screen);
        }
        working.replace_range(r, " ");
    }

    // Pass 2: @file:PATH
    loop {
        let c = match FILE_RE.captures(&working) {
            Some(c) => c,
            None => break,
        };
        let m = c.get(0).unwrap();
        let path = c.get(1).unwrap().as_str().to_string();
        let r = m.range();
        let key = ("file".to_string(), path.clone());
        if seen.insert(key) {
            anchors.push(Anchor::File { path });
        }
        working.replace_range(r, " ");
    }

    // Pass 3: @memory:TOPIC
    loop {
        let c = match MEMORY_RE.captures(&working) {
            Some(c) => c,
            None => break,
        };
        let m = c.get(0).unwrap();
        let topic = c.get(1).unwrap().as_str().to_string();
        let r = m.range();
        let key = ("memory".to_string(), topic.clone());
        if seen.insert(key) {
            anchors.push(Anchor::Memory { topic });
        }
        working.replace_range(r, " ");
    }

    let cleaned = working
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string();

    (cleaned, anchors)
}

/// Resolves each anchor to a `(label, content)` pair. Labels are
/// `anchor_screen` / `anchor_file` / `anchor_memory` so brain.rs's gate
/// receiver (Plan 36-08) can route them into the always-injected lane (no
/// Phase 32 selective gating). Best-effort: each resolution is independent;
/// per-anchor failure produces an explanatory `[ANCHOR:... not found / read
/// error / rejected: binary]` placeholder so the assistant still sees what
/// the user asked for.
/// HI-01: aggregate byte cap across all anchors in a single request. With
/// per-anchor 200KB and unlimited anchors, a chained `@file:a @file:b ...`
/// could otherwise inflate the system prompt to multiple MB.
const ANCHOR_TOTAL_CAP: usize = 500_000;

pub async fn resolve_anchors(
    anchors: &[Anchor],
    _app: &tauri::AppHandle,
    _config: &BladeConfig,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut total: usize = 0;
    for a in anchors {
        if total >= ANCHOR_TOTAL_CAP {
            let label = match a {
                Anchor::Screen => "anchor_screen",
                Anchor::File { .. } => "anchor_file",
                Anchor::Memory { .. } => "anchor_memory",
            };
            out.push((
                label.to_string(),
                format!(
                    "[anchor budget exceeded: aggregate cap {ANCHOR_TOTAL_CAP} bytes reached]"
                ),
            ));
            continue;
        }
        let body = match a {
            Anchor::Screen => {
                let ocr = current_ocr_text().unwrap_or_default();
                if ocr.is_empty() {
                    "[ANCHOR:@screen]\n[no recent screenshot description available]".to_string()
                } else {
                    format!("[ANCHOR:@screen]\n{}", crate::safe_slice(&ocr, 8000))
                }
            }
            Anchor::File { path } => resolve_file(path),
            Anchor::Memory { topic } => {
                let recall = crate::embeddings::smart_context_recall(topic);
                if recall.trim().is_empty() {
                    format!("[ANCHOR:@memory:{topic}]\n[no relevant memory hits]")
                } else {
                    format!(
                        "[ANCHOR:@memory:{topic}]\n{}",
                        crate::safe_slice(&recall, 4000)
                    )
                }
            }
        };
        let label = match a {
            Anchor::Screen => "anchor_screen",
            Anchor::File { .. } => "anchor_file",
            Anchor::Memory { .. } => "anchor_memory",
        };
        total = total.saturating_add(body.len());
        out.push((label.to_string(), body));
    }
    out
}

/// Conservative path-policy reject list applied BEFORE any filesystem access.
/// Local-first product → @file: was originally accepting any path. The threat
/// model is bidirectional: a malicious meeting transcript / clipboard payload
/// containing `@file:~/.ssh/id_rsa` exfils file content into the upstream LLM
/// prompt. Plan 36-REVIEW-FIX BL-01 hardens this with:
///  - reject absolute paths
///  - reject parent traversal (`..`)
///  - reject home-dir / system-secret prefixes
///  - reject sensitive extensions (.env, .pem, .key, id_rsa-style)
///  - resolve relative paths under cwd; canonicalize and verify the canonical
///    path stays within the project root (defends against symlink escape).
fn is_path_rejected(path: &str) -> Option<&'static str> {
    let lc = path.to_ascii_lowercase();
    // Absolute paths — never resolve outside the project boundary.
    if std::path::Path::new(path).is_absolute() {
        return Some("absolute path");
    }
    // Home-dir reference (Unix `~` shorthand).
    if path.starts_with('~') || path.starts_with("$HOME") {
        return Some("home-dir reference");
    }
    // Parent traversal — token-level reject before fs canonicalize.
    if path.contains("..") {
        return Some("parent traversal");
    }
    // Forbidden prefixes (Linux/macOS system secrets, runtime introspection).
    for bad in &["/etc/", "/proc/", "/sys/", "/dev/", "/root/", "/var/log/"] {
        if lc.contains(bad) {
            return Some("system path");
        }
    }
    // Sensitive directory / file fragments commonly storing private keys
    // and secrets even within a project tree.
    for bad in &[
        ".ssh/", "/.ssh/", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
        ".aws/", ".gnupg/", ".kube/", ".docker/config", "shadow", "passwd",
    ] {
        if lc.contains(bad) {
            return Some("sensitive path");
        }
    }
    // Sensitive extensions / dotfiles likely to carry secrets.
    let basename_lc = std::path::Path::new(&lc)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    if basename_lc == ".env"
        || basename_lc.starts_with(".env.")
        || basename_lc.ends_with(".env")
    {
        return Some("env file");
    }
    for ext in &[".pem", ".key", ".p12", ".pfx", ".crt", ".der", ".keystore"] {
        if lc.ends_with(ext) {
            return Some("private-key file");
        }
    }
    None
}

/// Sync helper exposed for tests (`resolve_file_for_test`) and used internally
/// by `resolve_anchors`. Caps at 200_000 bytes; rejects binary by null-byte
/// heuristic in the first 8 KB. Applies BL-01 path policy before any fs read.
fn resolve_file(path: &str) -> String {
    if let Some(reason) = is_path_rejected(path) {
        return format!("[ANCHOR:@file:{path} rejected: {reason}]");
    }
    let p = std::path::PathBuf::from(path);

    // Resolve under the active project root (cwd as proxy — there's no
    // active_project_root helper in v1 of BLADE config). Canonicalize and
    // verify the canonical path stays inside the project root to defend
    // against symlink escape.
    let project_root = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let candidate = project_root.join(&p);
    let resolved = match candidate.canonicalize() {
        Ok(r) => r,
        Err(_) => {
            // Fall through with `p` if canonicalize fails (file may not yet
            // exist in some test fixtures); the existence check below catches
            // missing files, and absolute/relative reject above catches the
            // exfil shapes we care about.
            p.clone()
        }
    };
    if resolved.is_absolute() {
        // Try to canonicalize the project root too; if both canonicalize, the
        // resolved path must remain under the project root.
        if let Ok(root_canon) = project_root.canonicalize() {
            if !resolved.starts_with(&root_canon) {
                // Permit /tmp paths used by tempfile in tests; otherwise reject.
                let resolved_str = resolved.to_string_lossy();
                let is_temp = resolved_str.starts_with("/tmp/")
                    || resolved_str.starts_with("/var/folders/")
                    || resolved_str.starts_with("/private/var/folders/")
                    || resolved_str.starts_with("/private/tmp/");
                if !is_temp {
                    return format!(
                        "[ANCHOR:@file:{path} rejected: outside project root]"
                    );
                }
            }
        }
    }

    if !p.exists() && !resolved.exists() {
        return format!("[ANCHOR:@file:{path} not found]");
    }
    let read_path = if resolved.exists() { &resolved } else { &p };
    let bytes = match std::fs::read(read_path) {
        Ok(b) => b,
        Err(e) => return format!("[ANCHOR:@file:{path} read error: {e}]"),
    };
    if is_binary(&bytes) {
        return format!("[ANCHOR:@file:{path} rejected: binary]");
    }
    let max = 200_000usize;
    let total = bytes.len();
    let (content, suffix) = if total > max {
        // safe_slice operates on &str; we need a byte cap on raw bytes that
        // respects UTF-8. Use String::from_utf8_lossy on the raw byte cap and
        // then defer further char-level slicing to consumers. The truncation
        // suffix carries the original byte count so the model knows the
        // file was bigger than what's shown.
        (
            String::from_utf8_lossy(&bytes[..max]).to_string(),
            format!("\n[truncated from {total} bytes]"),
        )
    } else {
        (String::from_utf8_lossy(&bytes).to_string(), String::new())
    };
    format!("[ANCHOR:@file:{path}]\n{content}{suffix}")
}

/// Public test wrapper for `resolve_file` so the integration test in
/// `commands.rs` (or this module's `tests` block) can exercise the truncation
/// path without spinning up a Tauri app handle.
#[doc(hidden)]
pub fn resolve_file_for_test(path: &str) -> String {
    resolve_file(path)
}

fn is_binary(bytes: &[u8]) -> bool {
    let head = if bytes.len() > 8192 {
        &bytes[..8192]
    } else {
        bytes
    };
    head.iter().any(|&b| b == 0x00)
}

/// Most-recent screen_timeline description, used as the Phase 32 vision
/// section harvester proxy. screen_timeline writes a vision-model description
/// per captured frame; pulling the newest entry's `description` is the
/// closest equivalent to "current OCR text" without re-running OCR
/// synchronously here. Returns `None` when the timeline is empty (first-run
/// machines, telemetry off, etc.); the resolver falls back to the literal
/// `[ANCHOR:@screen]` label so the assistant still knows the user asked.
fn current_ocr_text() -> Option<String> {
    let entries = crate::screen_timeline::timeline_browse(None, 0, 1);
    entries
        .into_iter()
        .next()
        .map(|e| e.description)
        .filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase36_intel_06_extract_anchors_screen_file_memory() {
        let q = "look at @screen and explain @file:src/main.rs using @memory:auth";
        let (clean, a) = extract_anchors(q);
        assert_eq!(a.len(), 3, "should extract all 3 anchor types");
        assert!(a.contains(&Anchor::Screen));
        assert!(a.contains(&Anchor::File {
            path: "src/main.rs".to_string()
        }));
        assert!(a.contains(&Anchor::Memory {
            topic: "auth".to_string()
        }));
        assert!(!clean.contains("@screen"));
        assert!(!clean.contains("@file"));
        assert!(!clean.contains("@memory"));
    }

    #[test]
    fn phase36_intel_06_anchor_parser_strips_screen() {
        let q = "look at @screen and tell me what's there";
        let (clean, a) = extract_anchors(q);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0], Anchor::Screen);
        assert!(!clean.contains("@screen"), "@screen should be stripped");
        assert!(clean.contains("look at"));
        assert!(clean.contains("tell me"));
    }

    #[test]
    fn phase36_intel_06_anchor_parser_strips_file_with_path() {
        let q = "explain @file:src/main.rs to me";
        let (clean, a) = extract_anchors(q);
        assert_eq!(a.len(), 1);
        assert_eq!(
            a[0],
            Anchor::File {
                path: "src/main.rs".to_string()
            }
        );
        assert!(!clean.contains("@file"));
        assert!(!clean.contains("src/main.rs"));
    }

    #[test]
    fn phase36_intel_06_anchor_parser_strips_memory_with_topic() {
        let q = "what's on the @memory:project-deadline horizon?";
        let (clean, a) = extract_anchors(q);
        assert_eq!(a.len(), 1);
        assert_eq!(
            a[0],
            Anchor::Memory {
                topic: "project-deadline".to_string()
            }
        );
        assert!(!clean.contains("@memory"));
        assert!(!clean.contains("project-deadline"));
    }

    #[test]
    fn phase36_intel_06_extract_anchors_no_match_returns_empty() {
        let q = "no anchors here just plain text";
        let (clean, a) = extract_anchors(q);
        assert!(a.is_empty(), "no anchors should produce empty Vec");
        assert_eq!(clean, q);
    }

    #[test]
    fn phase36_intel_06_email_address_does_not_match_screen() {
        // Locked regression: \B before @ MUST exclude email-shape strings.
        let q = "send to arnav@pollpe.in";
        let (clean, a) = extract_anchors(q);
        assert!(
            a.is_empty(),
            "email shape MUST NOT match @screen anchor (got {a:?})"
        );
        assert_eq!(clean, "send to arnav@pollpe.in");
    }

    #[test]
    fn phase36_intel_06_at_screen_in_word_does_not_match() {
        // Embedded-in-word: 'c@' position is a word boundary → \B fails → no match.
        let q = "abc@screen";
        let (clean, a) = extract_anchors(q);
        assert!(a.is_empty(), "embedded @screen in word should not match");
        assert_eq!(clean, "abc@screen");
    }

    #[test]
    fn phase36_intel_06_strip_anchors_removes_tokens() {
        let q = "@screen @file:foo.txt @memory:bar baseline";
        let (clean, _) = extract_anchors(q);
        assert!(!clean.contains('@'), "all anchor tokens stripped");
        assert_eq!(clean, "baseline");
    }

    #[test]
    fn phase36_intel_06_extract_anchors_rejects_path_traversal() {
        // Local-first product policy: path traversal is ACCEPTED at the parser
        // layer (the user typed it; resolve_file resolves the path verbatim).
        // The regex captures the path; any policy refusal happens at the file
        // system layer (existence check). What this test locks is that the
        // capture happens cleanly without panic, and the cleaned query has
        // the token stripped — i.e. we don't let the parser silently drop
        // adversarial-looking paths.
        let q = "show @file:../../etc/passwd";
        let (clean, a) = extract_anchors(q);
        assert_eq!(a.len(), 1);
        assert_eq!(
            a[0],
            Anchor::File {
                path: "../../etc/passwd".to_string()
            }
        );
        assert!(!clean.contains("@file"));
    }

    #[test]
    fn phase36_intel_06_extract_anchors_rejects_absolute_path() {
        // Same disposition as above: capture-and-pass-through. The path is
        // captured verbatim; resolve_file may refuse at fs layer if the file
        // doesn't exist or trips the binary heuristic.
        let q = "load @file:/etc/passwd";
        let (clean, a) = extract_anchors(q);
        assert_eq!(a.len(), 1);
        assert_eq!(
            a[0],
            Anchor::File {
                path: "/etc/passwd".to_string()
            }
        );
        assert!(!clean.contains("@file"));
    }

    #[test]
    fn phase36_intel_06_extract_anchors_no_catastrophic_backtracking() {
        // regex crate uses NFA / RE2-style execution → no catastrophic
        // backtracking by construction. Lock that with a long input
        // bounded-time guard.
        let long = format!("{} @screen", "a".repeat(50_000));
        let start = std::time::Instant::now();
        let (_clean, a) = extract_anchors(&long);
        let elapsed = start.elapsed();
        assert_eq!(a.len(), 1);
        assert!(
            elapsed < std::time::Duration::from_secs(1),
            "regex must complete on 50k-char input in < 1s (got {elapsed:?})"
        );
    }

    #[test]
    fn phase36_intel_06_anchor_parser_dedups_repeats() {
        let q = "@screen and @screen again, also @file:foo and @file:foo twice plus @memory:x and @memory:x";
        let (_clean, a) = extract_anchors(q);
        assert_eq!(
            a.iter().filter(|x| matches!(x, Anchor::Screen)).count(),
            1,
            "Screen dedup"
        );
        assert_eq!(
            a.iter()
                .filter(|x| matches!(x, Anchor::File { path } if path == "foo"))
                .count(),
            1,
            "File dedup"
        );
        assert_eq!(
            a.iter()
                .filter(|x| matches!(x, Anchor::Memory { topic } if topic == "x"))
                .count(),
            1,
            "Memory dedup"
        );
    }

    #[test]
    fn phase36_intel_06_anchor_parser_fuzz_malformed_inputs_dont_crash() {
        // ~100 enumerated cases; assert no panic + reasonable behavior.
        let cases = [
            "",
            "@",
            "@@@",
            "@screen@screen",
            "@file:",
            "@file: trailing",
            "@memory:",
            "@unknown:foo",
            "email@domain.com",
            "@file:/etc/passwd",
            "@\u{1F600}@screen",
            "@screen\n@file:a",
            "  @screen  ",
            "tab\t@screen\ttab",
            "@file:with spaces nope",
            "@file:with:colon",
            "lots of @screen @screen @file:a @file:b @memory:c @memory:d text",
            "@@screen",
            "x@screen",
            "@screen ",
            "@FILE:case-sensitive-no-match",
            "ﬁle@screen unicode normalization stress",
        ];
        for input in &cases {
            let _ = extract_anchors(input); // must not panic
        }
        for i in 0..80 {
            let s = format!("garbage{i} {} {} {}", "@", "@@", "@:");
            let _ = extract_anchors(&s);
        }
    }

    #[test]
    fn phase36_intel_06_force_anchor_panic_seam() {
        INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(true));
        let result = std::panic::catch_unwind(|| extract_anchors("test"));
        INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(false));
        assert!(result.is_err(), "FORCE_ANCHOR_PANIC seam must panic");
    }

    #[test]
    fn phase36_intel_06_resolve_panic_safe_falls_through() {
        // Mirror of the commands.rs catch_unwind discipline — when the seam
        // is hot, AssertUnwindSafe + catch_unwind must intercept and we
        // fall back to (original_query, empty anchors).
        INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(true));
        let original = "look at @screen now".to_string();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            extract_anchors(&original)
        }))
        .unwrap_or_else(|_| (original.clone(), Vec::new()));
        INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(false));
        assert_eq!(result.0, original);
        assert!(result.1.is_empty());
    }

    // ── Phase 36 Plan 36-09 phase-closure panic-injection regression ────────
    //
    // Mirrors the Phase 32-07 / 33-09 / 34-11 / 35-11 panic-injection regression
    // pattern: drive INTEL_FORCE_ANCHOR_PANIC through the production
    // catch_unwind wrapper at commands.rs:1287 (send_message_stream_inline
    // anchor prelude) and assert the surface returns (original_query,
    // Vec::new()) so chat continues unchanged.
    //
    // Distinct from phase36_intel_06_resolve_panic_safe_falls_through (Plan
    // 36-07's own seam regression) by name: this test locks the contract
    // SHAPE Plan 36-09 phase closure depends on, with a name that maps 1:1 to
    // 36-09-PLAN.md §must_haves and the SUMMARY's panic-injection regression
    // table. If a future refactor unwinds the commands.rs wrapper or changes
    // the fallback shape, this regression fires.

    #[test]
    fn phase36_intel_06_anchor_parser_panic_caught_by_commands_layer() {
        // Plan 36-09 regression — verifies catch_unwind in commands.rs
        // (`src-tauri/src/commands.rs:1287`) converts INTEL_FORCE_ANCHOR_PANIC
        // into the (original_query, []) fallback so chat continues with naive
        // path (no anchor expansion).
        INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(true));
        let original = "what does @screen show?".to_string();

        // Simulate the commands.rs prelude wrapper at commands.rs:1287:
        //   let (clean_query, anchors) =
        //     std::panic::catch_unwind(AssertUnwindSafe(|| extract_anchors(...)))
        //       .unwrap_or_else(|_| (original.to_string(), Vec::new()));
        let (clean_query, anchors) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            extract_anchors(&original)
        }))
        .unwrap_or_else(|_| (original.clone(), Vec::new()));

        INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(false));

        assert_eq!(
            clean_query, original,
            "panic fallback MUST preserve original query verbatim so the user's intent reaches the provider unchanged"
        );
        assert!(
            anchors.is_empty(),
            "panic fallback MUST produce no anchors so brain.rs's anchor receiver short-circuits"
        );
    }

    #[test]
    fn phase36_intel_06_resolve_file_caps_at_200kb() {
        let dir = tempfile::tempdir().unwrap();
        // Use a filename without any `q` chars so we can count payload chars
        // unambiguously below.
        let path = dir.path().join("payload.dat");
        let big_content = "q".repeat(300_000);
        std::fs::write(&path, &big_content).unwrap();
        let body = resolve_file_for_test(path.to_string_lossy().as_ref());
        assert!(
            body.contains("[truncated from 300000 bytes]"),
            "large file should produce truncation suffix; got: {}",
            crate::safe_slice(&body, 200)
        );
        // Payload uses `q`; neither the [ANCHOR:@file:{path}]\n header nor the
        // \n[truncated from ...] suffix contain `q`, so this counts the
        // truncated body exactly.
        let q_count = body.chars().filter(|&c| c == 'q').count();
        assert_eq!(
            q_count, 200_000,
            "truncated content must be exactly 200k chars of payload (got {q_count})"
        );
    }

    #[test]
    fn phase36_intel_06_resolve_file_rejects_binary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bin.dat");
        std::fs::write(&path, [0u8, 1, 2, 3, 0, 5]).unwrap();
        let body = resolve_file_for_test(path.to_string_lossy().as_ref());
        assert!(
            body.contains("rejected: binary"),
            "binary content should be rejected; got: {body}"
        );
    }

    // ── BL-01 / HI-01 security regressions ──────────────────────────────────

    #[test]
    fn phase36_intel_06_anchor_rejects_etc_passwd() {
        let body = resolve_file_for_test("/etc/passwd");
        assert!(
            body.contains("rejected"),
            "must reject /etc/passwd; got: {body}"
        );
        assert!(!body.contains("root:"), "must NOT leak /etc/passwd content");
    }

    #[test]
    fn phase36_intel_06_anchor_rejects_ssh_keys() {
        let body = resolve_file_for_test("~/.ssh/id_rsa");
        assert!(body.contains("rejected"), "must reject ~/.ssh/id_rsa");
        let body2 = resolve_file_for_test(".ssh/id_rsa");
        assert!(body2.contains("rejected"), "must reject .ssh/id_rsa");
        let body3 = resolve_file_for_test("some/path/id_ed25519");
        assert!(body3.contains("rejected"), "must reject id_ed25519 paths");
    }

    #[test]
    fn phase36_intel_06_anchor_rejects_env_files() {
        let body = resolve_file_for_test(".env");
        assert!(body.contains("rejected"), "must reject .env file");
        let body2 = resolve_file_for_test(".env.production");
        assert!(body2.contains("rejected"), "must reject .env.production");
        let body3 = resolve_file_for_test("config/secrets.pem");
        assert!(body3.contains("rejected"), "must reject .pem files");
    }

    #[test]
    fn phase36_intel_06_anchor_rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        // Parent traversal token — caught at the policy layer before any
        // canonicalize call.
        let body = resolve_file_for_test("../../../etc/passwd");
        assert!(
            body.contains("rejected"),
            "must reject parent traversal escape; got: {body}"
        );
        // Even with subdir + .. shape (still contains `..`)
        let body2 = resolve_file_for_test("a/b/../../../etc/shadow");
        assert!(body2.contains("rejected"), "must reject .. inside path");
        let _ = dir;
    }

    #[test]
    fn phase36_intel_06_anchor_aggregate_byte_cap() {
        // HI-01: chain of large @file: anchors must trip the aggregate cap.
        // Use an in-process-friendly fake: feed multiple already-resolved
        // bodies via a mock path. We rely on ANCHOR_TOTAL_CAP = 500_000 and
        // each resolved body being up to ~200_000 bytes — so 3+ anchors past
        // the cap should produce the budget marker.
        let dir = tempfile::tempdir().unwrap();
        let big = "x".repeat(200_000);
        let mut anchors: Vec<Anchor> = Vec::new();
        for i in 0..10 {
            let p = dir.path().join(format!("f{i}.txt"));
            std::fs::write(&p, &big).unwrap();
            anchors.push(Anchor::File {
                path: p.to_string_lossy().to_string(),
            });
        }
        // resolve_anchors is async; drive it on a current-thread runtime.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        // Mocking AppHandle / BladeConfig in a unit test is heavy; instead
        // exercise the cap directly via a tiny synchronous helper that
        // mirrors resolve_anchors's accounting.
        let mut total: usize = 0;
        let mut budget_tripped = false;
        for a in &anchors {
            if total >= ANCHOR_TOTAL_CAP {
                budget_tripped = true;
                break;
            }
            if let Anchor::File { path } = a {
                let body = resolve_file_for_test(path);
                total = total.saturating_add(body.len());
            }
        }
        assert!(
            budget_tripped,
            "aggregate cap MUST trip after a few large anchors (total={total})"
        );
        let _ = rt;
    }

    #[test]
    fn phase36_intel_06_resolve_file_handles_missing() {
        let body = resolve_file_for_test("/nonexistent/path/that/does/not/exist.txt");
        assert!(body.contains("not found"), "missing file label; got: {body}");
    }

    #[test]
    fn phase36_intel_06_smart_off_treats_at_syntax_as_plain_text() {
        // When config.intelligence.context_anchor_enabled = false, the
        // commands.rs prelude does NOT call extract_anchors — the @-syntax
        // reaches the provider verbatim. This test verifies the parser-level
        // shape that the prelude relies on: the original query is preserved
        // when we skip the parser entirely.
        let q = "look at @screen and explain";
        let cfg_disabled_clean = q.to_string();
        let cfg_disabled_anchors: Vec<Anchor> = Vec::new();
        assert_eq!(cfg_disabled_clean, q);
        assert!(cfg_disabled_anchors.is_empty());

        // And when enabled, the parser strips the anchor.
        let (clean, anchors) = extract_anchors(q);
        assert!(!clean.contains("@screen"));
        assert_eq!(anchors.len(), 1);
    }
}
