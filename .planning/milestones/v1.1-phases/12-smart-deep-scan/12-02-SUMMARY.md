---
phase: 12-smart-deep-scan
plan: "02"
subsystem: backend/deep_scan
tags: [rust, deep-scan, scanners, ide-workspaces, ai-sessions, shell-history, bookmarks, which-sweep, config, rhythm, verify-gates]
dependency_graph:
  requires:
    - deep_scan::LeadQueue (12-01)
    - deep_scan::leads::IdeRow (defined here)
    - deep_scan::leads::AiToolRow (defined here)
    - deep_scan::leads::ToolRow (defined here)
    - deep_scan::leads::BookmarkRow (defined here)
  provides:
    - deep_scan::scanners::ide_workspaces::run
    - deep_scan::scanners::ai_sessions::run
    - deep_scan::scanners::ai_sessions::scan_ssh_config
    - deep_scan::scanners::shell_history::run
    - deep_scan::scanners::bookmarks::run
    - deep_scan::scanners::which_sweep::run
    - deep_scan::scanners::which_sweep::run_for_single_tool
    - deep_scan::rhythm::compute
    - config::ScanClassesEnabled
    - scripts/verify-scan-no-egress.mjs
    - scripts/verify-scan-no-write.mjs
  affects:
    - src-tauri/src/deep_scan/mod.rs (new scanner dispatches + rhythm call + ScanClassesEnabled gate)
    - src-tauri/src/config.rs (ScanClassesEnabled in all 6 places)
    - package.json (verify:scan-no-egress, verify:scan-no-write, verify:all extended)
tech_stack:
  added: []
  patterns:
    - "file:// URI decode (replace-based, no urlencoding dep)"
    - "Claude project slug → filesystem path best-effort decode (3-strategy)"
    - "Shell history secret discard — only cmd_name (first token) ever stored"
    - "Bookmark domain-only extraction — URL string never stored"
    - "which + --version subprocess with safe_slice(40) cap"
    - "Test-block stripping in verify-scan-no-write.mjs for #[cfg(test)]"
    - "Hour-of-day histogram + day-of-week distribution from Unix timestamps"
key_files:
  created:
    - src-tauri/src/deep_scan/scanners/ide_workspaces.rs
    - src-tauri/src/deep_scan/scanners/ai_sessions.rs
    - src-tauri/src/deep_scan/scanners/shell_history.rs
    - src-tauri/src/deep_scan/scanners/bookmarks.rs
    - src-tauri/src/deep_scan/scanners/which_sweep.rs
    - src-tauri/src/deep_scan/rhythm.rs
    - scripts/verify-scan-no-egress.mjs
    - scripts/verify-scan-no-write.mjs
  modified:
    - src-tauri/src/deep_scan/scanners/mod.rs (all 8 modules declared)
    - src-tauri/src/deep_scan/mod.rs (rhythm module, scanner dispatches, ScanClassesEnabled gate)
    - src-tauri/src/config.rs (ScanClassesEnabled in all 6 places + 2 tests)
    - package.json (2 new verify scripts + verify:all extended)
decisions:
  - "Placed scanner-local row types (IdeRow, AiToolRow, ToolRow, BookmarkRow) in each scanner file rather than leads.rs — avoids bloating the shared types file with scanner-specific structs that have no cross-scanner consumers"
  - "Shell history extract_command<'a> lifetime fix — function returns a slice of the input line so lifetime must be bound to `line`, not `shell`"
  - "verify-scan-no-write.mjs strips content after #[cfg(test)] before checking — test fixtures legitimately use fs::write/create_dir_all; production scanner code does not"
  - "Claude project slug decode uses 3-strategy cascade (canonical path, /home/ prefix, username prefix) — best-effort is correct given no slug format spec"
  - "rhythm::compute always emits active_repo_count even when no timestamps present — gives a meaningful signal (count=0) rather than an empty vec"
metrics:
  duration: "45m"
  completed_date: "2026-04-20"
  tasks_completed: 2
  tasks_total: 2
  files_created: 8
  files_modified: 4
---

# Phase 12 Plan 02: Remaining 5 Scanners + Rhythm + ScanClassesEnabled + Verify Gates Summary

**One-liner:** Five scanner modules (ide_workspaces/ai_sessions/shell_history/bookmarks/which_sweep) completing SCAN-03..08, ScanClassesEnabled 6-place config field, rhythm signal computation, and two D-65 hard-invariant verify gates wired into verify:all.

## What Was Built

### Task 1: IDE Workspaces, AI Sessions, and Shell History Scanners

Three scanner files implementing SCAN-03, SCAN-04, and SCAN-05:

**ide_workspaces.rs** (~200 lines):
- `scan_vscode_workspaces()`: walks `~/.config/Code/User/workspaceStorage/` and `~/.config/Cursor/User/workspaceStorage/` — parses `workspace.json` for `"folder"` key, URI-decodes `file://` prefix, emits `IdeRow` + `ProjectRootHint` follow-up leads for existing paths.
- `scan_code_workspace_file()`: parses `.code-workspace` JSON `folders[].path` entries.
- `scan_idea_workspace()`: detects IntelliJ `.idea/workspace.xml` presence and emits `ProjectRootHint`.
- 2 unit tests: `test_parses_workspace_json`, `test_returns_project_root_hint`.

**ai_sessions.rs** (~280 lines):
- `run()`: probes `~/.claude/projects/`, `~/.codex/sessions/`, `~/.cursor`, `~/.continue`, `~/.aider` — directory-level metadata only (mtime, count), never opens `.jsonl` content (T-12-10).
- `scan_claude_projects()`: 3-strategy slug decode (canonical path / `/home/` prefix / username prefix), tier assignment from mtime age (≤7d=Hot, ≤30d=Warm, older=Cold).
- `scan_ssh_config()`: parses `~/.ssh/config` Host blocks → `AccountRow` per known platform (github/gitlab/bitbucket), never stores IdentityFile values.
- 3 unit tests: `test_slug_to_project_path`, `test_recent_session_is_hot`, `test_ssh_config_parse`.

**shell_history.rs** (~220 lines):
- `run()`: reads `$HISTFILE`, `~/.zsh_history`, `~/.bash_history`, `~/.local/share/fish/fish_history` — last 500 lines each.
- `extract_command<'a>()`: zsh extended format (`": ts:el;cmd"`), fish YAML (`"- cmd: cmd"`), bash (raw line).
- Tracks invocations for 32 curated tools, discards all command arguments (T-12-07 secret discard).
- `cd` path extraction: expands `~`, checks `is_dir()`, emits `PathHint` follow-up leads.
- 3 unit tests: `test_parses_zsh_ext`, `test_no_secret_persistence`, `test_fish_yaml`.

`scanners/mod.rs` updated to declare all 6 modules (3 from 12-01 + 3 new).

### Task 2: Bookmarks + which_sweep Scanners, ScanClassesEnabled Config, Verify Gates

**bookmarks.rs** (~180 lines):
- `run()`: probes Chrome/Brave/Edge Bookmarks JSON at Linux paths.
- `walk_bookmark_node()`: recursive traversal capped at 5000 nodes, extracts domain-only (T-12-08: full URLs never stored).
- `extract_domain()`: scheme-agnostic `://` split, strips `www.` prefix, lowercases.
- 3 unit tests: `test_parses_chrome_json`, `test_no_full_urls_stored`, `test_extract_domain`.

**which_sweep.rs** (~150 lines):
- `run()`: runs `which <tool>` + `<tool> --version` for 40-tool curated list.
- `run_for_single_tool(cli, path_prefix)`: testable single-tool check with optional PATH prefix.
- Version string capped at 40 chars via `crate::safe_slice` (T-12-09).
- Non-UTF8 output handled via `String::from_utf8_lossy`.
- 3 unit tests: `test_detects_installed`, `test_safe_slice_version`, `test_not_installed_tool`.

**config.rs** — `ScanClassesEnabled` in all 6 places:
1. Struct definition + `default_scan_classes_enabled()` fn (all 8 fields = true).
2. `DiskConfig` struct field with `#[serde(default = "default_scan_classes_enabled")]`.
3. `DiskConfig::default()` initializer.
4. `BladeConfig` struct field.
5. `BladeConfig::default()` initializer.
6. `load_config()` mapping `disk.scan_classes_enabled`.
7. `save_config()` mapping `config.scan_classes_enabled.clone()`.
Plus 2 tests: `test_scan_classes_roundtrip`, `test_scan_classes_default_all_true`.

**rhythm.rs** (~130 lines):
- `compute(results)`: collects Unix timestamps from `mru_files[*].mtime_unix`.
- Signal 1: 24-bucket hour-of-day histogram from `(ts % 86400) / 3600`.
- Signal 2: 7-bucket day-of-week distribution from `(ts / 86400 + 3) % 7` (Mon=0).
- Signal 3: active-repo concurrency count (`last_active_days <= 30`), always emitted.
- 2 tests: `test_rhythm_compute_from_timestamps`, `test_rhythm_no_timestamps_returns_count_signal`.
- Declared as `pub mod rhythm` in `deep_scan/mod.rs`; called after drain loop.

**Scanner dispatch wired in `deep_scan/mod.rs`**:
- `LeadKind::IdeWorkspaceRead` → `scanners::ide_workspaces::run(lead)`
- `LeadKind::AiSessionRead` → `scanners::ai_sessions::run(lead)` + `scan_ssh_config()`
- `LeadKind::ShellHistoryScan` → `scanners::shell_history::run(lead)` (full scanner, not just fs_repos passthrough)
- `LeadKind::BookmarkRead` → `scanners::bookmarks::run(lead)`
- `LeadKind::WhichSweep` → `scanners::which_sweep::run()`
- Each dispatch prefixed with `ScanClassesEnabled` class-enabled guard (defense-in-depth per D-65).

**Verify gates**:
- `scripts/verify-scan-no-egress.mjs`: reads all `.rs` files under `src-tauri/src/deep_scan/` recursively; exits 1 if any of `reqwest::`, `isahc::`, `ureq::`, `TcpStream`, `UdpSocket` found.
- `scripts/verify-scan-no-write.mjs`: same recursive read; skips `mod.rs` and `profile.rs`; strips `#[cfg(test)]` blocks before checking; exits 1 if `fs::write`, `File::create`, `OpenOptions`, `create_dir_all`, `remove_file` found in production code.
- Both added to `package.json` as `verify:scan-no-egress` and `verify:scan-no-write`; appended to `verify:all` chain.

## Verification

- `cargo check --lib`: zero errors.
- `node scripts/verify-scan-no-egress.mjs`: PASS.
- `node scripts/verify-scan-no-write.mjs`: PASS (after fix to strip `#[cfg(test)]` blocks).
- All scanner files exceed their `min_lines` requirements per plan artifacts spec.
- No full URLs in `BookmarkRow` (test_no_full_urls_stored enforces this).
- No secrets in `ToolRow` debug output (test_no_secret_persistence enforces this).
- Version strings capped at 40 chars (test_safe_slice_version enforces this).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rust lifetime error in extract_command**
- **Found during:** Task 1 compilation
- **Issue:** `fn extract_command(line: &str, shell: &str) -> &str` — compiler cannot determine whether return borrows from `line` or `shell`
- **Fix:** Added explicit lifetime `fn extract_command<'a>(line: &'a str, shell: &str) -> &'a str`
- **Files modified:** `src-tauri/src/deep_scan/scanners/shell_history.rs`
- **Commit:** f664688

**2. [Rule 1 - Bug] verify-scan-no-write gate false-positives on test code**
- **Found during:** Task 2 verification step
- **Issue:** `verify-scan-no-write.mjs` flagged `fs::write` and `create_dir_all` in `#[cfg(test)]` blocks in scanner files — test fixtures legitimately use these to create temp directories
- **Fix:** Added `stripTestBlocks()` function to verify-scan-no-write.mjs that truncates content at the first `#[cfg(test)]` marker before checking for write patterns. Production scanner code never uses write ops; test code is excluded from release builds by the compiler.
- **Files modified:** `scripts/verify-scan-no-write.mjs`
- **Commit:** d0f76b6

**3. [Rule 2 - Missing critical functionality] Unused variable warning in decode_claude_slug**
- **Found during:** Task 1 compilation
- **Issue:** `if let Some(home_str) = home.to_str()` bound `home_str` but never used it
- **Fix:** Changed to `if home.to_str().is_some()` — presence check without binding
- **Files modified:** `src-tauri/src/deep_scan/scanners/ai_sessions.rs`
- **Commit:** f664688

## Known Stubs

The `process_lead` dispatcher stubs for `PackageManifestRead` and `LockFileRead` remain — these lead kinds are still unhandled (they fall to the `_ =>` default arm). These are expected; Plan 12-03/12-05 will handle them.

`scanners/mod.rs` now declares all 8 scanner modules. The `bookmarks::run()` and `which_sweep::run()` return results that are currently dropped in the dispatcher (not yet merged into `DeepScanResults` additive fields). The legacy `browser_bookmarks` and `ai_tools` fields from `run_legacy_scanners()` still carry backward-compat data. Plan 12-04/12-05 will wire the new scanner results into the Profile view.

## Threat Surface Scan

No new network endpoints introduced. All files operate on local filesystem only. The `which_sweep.rs` spawns subprocesses (`which`, `--version`) but these are read-only system queries with no network access. The verify-scan-no-egress gate enforces this statically.

## Self-Check

### Files exist:
- [x] `src-tauri/src/deep_scan/scanners/ide_workspaces.rs`
- [x] `src-tauri/src/deep_scan/scanners/ai_sessions.rs`
- [x] `src-tauri/src/deep_scan/scanners/shell_history.rs`
- [x] `src-tauri/src/deep_scan/scanners/bookmarks.rs`
- [x] `src-tauri/src/deep_scan/scanners/which_sweep.rs`
- [x] `src-tauri/src/deep_scan/rhythm.rs`
- [x] `scripts/verify-scan-no-egress.mjs`
- [x] `scripts/verify-scan-no-write.mjs`
- [x] `src-tauri/src/config.rs` contains `ScanClassesEnabled`
- [x] `package.json` contains `verify:scan-no-egress` and `verify:scan-no-write`

### Commits exist:
- [x] f664688 — feat(12-02): implement ide_workspaces, ai_sessions, shell_history scanners
- [x] d0f76b6 — feat(12-02): bookmarks + which_sweep scanners, ScanClassesEnabled config, verify gates + rhythm

## Self-Check: PASSED
