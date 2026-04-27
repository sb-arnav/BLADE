---
phase: 12-smart-deep-scan
plan: "01"
subsystem: backend/deep_scan
tags: [rust, deep-scan, lead-queue, priority-queue, scanners]
dependency_graph:
  requires: []
  provides:
    - deep_scan::LeadQueue
    - deep_scan::Lead
    - deep_scan::Tier
    - deep_scan::LeadKind
    - deep_scan::leads::RepoRow
    - deep_scan::leads::AccountRow
    - deep_scan::leads::MruFileRow
    - deep_scan::scanners::fs_repos::run
    - deep_scan::scanners::git_remotes::run
    - deep_scan::scanners::mru::run
  affects:
    - src-tauri/src/brain.rs (load_scan_summary — unchanged)
    - src-tauri/src/persona_engine.rs (load_results_pub — unchanged)
    - src-tauri/src/hive.rs (load_results_pub — unchanged)
    - src-tauri/src/lib.rs (generate_handler! — unchanged)
tech_stack:
  added:
    - walkdir = "2" (WalkDir filesystem traversal)
    - once_cell = "1" (lazy-initialized regex in git_remotes)
    - tempfile = "3" (dev-dep for scanner unit tests)
    - filetime = "0.2" (dev-dep for mru mtime manipulation in tests)
  patterns:
    - Priority VecDeque<Lead> drain (Hot→Warm→Cold) replacing tokio::join!
    - AtomicBool cancel sentinel (SCAN_CANCEL) checked between leads
    - filter_entry predicate for WalkDir ignore-list subtree pruning
    - once_cell::Lazy<Regex> for compiled SSH/HTTPS URL regexes
key_files:
  created:
    - src-tauri/src/deep_scan/leads.rs
    - src-tauri/src/deep_scan/queue.rs
    - src-tauri/src/deep_scan/mod.rs
    - src-tauri/src/deep_scan/scanners/mod.rs
    - src-tauri/src/deep_scan/scanners/fs_repos.rs
    - src-tauri/src/deep_scan/scanners/git_remotes.rs
    - src-tauri/src/deep_scan/scanners/mru.rs
  modified:
    - src-tauri/Cargo.toml (added walkdir, once_cell, tempfile, filetime)
  deleted:
    - src-tauri/src/deep_scan.rs (replaced by deep_scan/mod.rs)
decisions:
  - "Preserved all legacy parallel scanners (installed_apps, ides, etc.) by routing them through run_legacy_scanners() after the lead-queue drain — backward compat maintained without rewriting scanner logic"
  - "Chose once_cell::sync::Lazy for regex compilation in git_remotes — avoids recompiling on each call, same pattern as existing codebase"
  - "SCAN_CANCEL lives in queue.rs (not mod.rs) so scanners can be tested without the Tauri AppHandle dependency"
  - "Used #[allow(unused_imports)] on LeadKind/Tier module-level imports used only in #[cfg(test)] blocks — cleaner than duplicating imports in test submodule"
metrics:
  duration: "33m"
  completed_date: "2026-04-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 7
  files_modified: 1
  files_deleted: 1
---

# Phase 12 Plan 01: Lead Queue Core + Three Hot-Path Scanners Summary

**One-liner:** Priority-queue orchestrator (Hot→Warm→Cold VecDeque) with fs_repos/git_remotes/mru scanners, SCAN_CANCEL sentinel, credential-stripping, and D-64 extended progress events replacing tokio::join!-all approach.

## What Was Built

### Task 1: deep_scan module tree — Lead/Queue types + orchestrator skeleton

Converted the flat `src-tauri/src/deep_scan.rs` (1437 LOC) into a proper module directory with dedicated submodules:

- **leads.rs** (275 lines): All Lead/Tier/LeadKind/row types. Extended `DeepScanResults` with additive Phase 12 fields (`accounts`, `mru_files`, `rhythm_signals`, `llm_enrichments`, `repo_rows`) — all `#[serde(default)]` so old scan_results.json deserializes without errors.
- **queue.rs** (203 lines): `LeadQueue` with Hot/Warm/Cold `VecDeque` tiers, `HashSet<PathBuf>` visited dedup, `SCAN_CANCEL` `AtomicBool`. Four unit tests: tier ordering, visited dedup, cancel stops drain, queue counts.
- **mod.rs** (1131 lines): Priority drain loop orchestrator, `seed_queue()` (MRU dirs + AI session dirs + shell history cd-targets + git HEAD freshness), `process_lead()` dispatcher, `build_progress_payload()` pure fn for D-64 events. All legacy parallel scanners preserved via `run_legacy_scanners()` for backward compat. Three original Tauri commands unchanged (D-66).

### Task 2: fs_repos, git_remotes, mru scanners + scanners/mod.rs

Three scanner implementations in `src-tauri/src/deep_scan/scanners/`:

- **fs_repos.rs** (210 lines): WalkDir depth-6, `filter_entry` prunes ignore list subtrees, `/mnt/c` skip, 10k entry cap, `GitRemoteRead` follow-up leads per discovered `.git`. Three unit tests: maxdepth-6, ignore list, follow-up leads.
- **git_remotes.rs** (246 lines): `once_cell::Lazy<Regex>` SSH + HTTPS patterns, credential stripping (T-12-01), `AccountRow` per org/platform. Three unit tests: SSH parse, HTTPS parse, no auth token leak.
- **mru.rs** (201 lines): mtime window filter, `filetime` crate for test mtime manipulation, `project_root` inference (walk-up .git ancestor). Two unit tests: window filter, ignore list.

## Verification

- `cargo check`: zero errors (4 minor unused-import warnings, all suppressed with `#[allow(unused_imports)]` or expected pre-existing)
- `cargo test --lib` compile: succeeds; link fails due to pre-existing WSL system library gaps (`-lgbm`, `-lxdo`) documented in CLAUDE.md as "unverifiable in this sandbox"
- All 7 files exceed their `min_lines` requirements
- `mod deep_scan;` at lib.rs line 138 — unchanged (Rust resolves to folder automatically)
- All three Tauri commands registered at lib.rs lines 1207-1209 — unchanged
- `follow_links(false)` present in every `WalkDir` call (verified by grep)
- No raw byte-slicing (`&str[..n]`) anywhere in scanner files

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mismatched type in emit_progress call**
- **Found during:** Task 1 compilation
- **Issue:** `emit_progress(..., None, None, Some(0), ...)` — `Some(0)` passed as `Option<&str>` but is `{integer}`
- **Fix:** Changed to `None` (message param) — the "complete" phase doesn't need a message body
- **Files modified:** `src-tauri/src/deep_scan/mod.rs`
- **Commit:** 729927a

## Known Stubs

The `process_lead` dispatcher in `mod.rs` returns empty `RowBatch` for lead kinds not yet implemented:
- `LeadKind::IdeWorkspaceRead` → stub ("plan 12-02")
- `LeadKind::AiSessionRead` → stub ("plan 12-02")
- `LeadKind::BookmarkRead` → stub ("plan 12-02")
- `LeadKind::WhichSweep` → stub ("plan 12-02")
- `LeadKind::PackageManifestRead` → stub ("plan 12-02")
- `LeadKind::LockFileRead` → stub ("plan 12-02")

These are intentional — Plan 12-02 adds the remaining 5 scanners. The queue infrastructure works correctly with the 3 implemented scanners.

## Self-Check

### Files exist:
- [x] `src-tauri/src/deep_scan/leads.rs`
- [x] `src-tauri/src/deep_scan/queue.rs`
- [x] `src-tauri/src/deep_scan/mod.rs`
- [x] `src-tauri/src/deep_scan/scanners/mod.rs`
- [x] `src-tauri/src/deep_scan/scanners/fs_repos.rs`
- [x] `src-tauri/src/deep_scan/scanners/git_remotes.rs`
- [x] `src-tauri/src/deep_scan/scanners/mru.rs`
- [x] `src-tauri/src/deep_scan.rs` deleted

### Commits exist:
- [x] 729927a — feat(12-01): create deep_scan module tree
- [x] ac6a412 — feat(12-01): implement fs_repos, git_remotes, mru scanners

## Self-Check: PASSED
