---
phase: 12
slug: smart-deep-scan
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Domain:** Rust backend (lead queue + 8 scanner modules + profile overlay + 4 new Tauri commands + privacy config field) + React frontend (ProfileView 5 tabs + live-tail panel + Settings → Privacy deep-scan section). Unit-test-heavy for Rust scanner + queue logic; Playwright-heavy for ProfileView + privacy UI; manual cold-install trace for SCAN-13 baseline.
>
> **Source:** `12-RESEARCH.md` §"Validation Architecture" (lines 1539-1621). This file is the contract; research is the ground truth.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: built-in `#[cfg(test)] mod tests` (existing pattern — `deep_scan.rs`, `config.rs`, `crypto.rs`, `router.rs`; Phase 11 Plan 11-02 established `test_set_keyring_override` pattern). Frontend: Playwright 1.58.2 (existing). TS type check: `npx tsc --noEmit`. |
| **Config file** | `src-tauri/Cargo.toml` (no separate test crate — tests embedded under `#[cfg(test)]`); `playwright.config.ts` at repo root. |
| **Quick run command** | `cd src-tauri && cargo test --lib deep_scan::<module> -- --nocapture` (per-module, ≤15s). |
| **Full suite command** | `cd src-tauri && cargo test --lib && cd .. && npx tsc --noEmit && npm run verify:all && npm run test:e2e:phase12` (~3 min). |
| **Estimated runtime** | ~20s Rust unit tests (incremental with module filter), ~20s tsc, ~90s verify:all chain, ~90s Phase 12 e2e subset (4 new specs). |

---

## Sampling Rate

- **After every task commit:** `cd src-tauri && cargo test --lib deep_scan::<module>` for the module touched (≤15s).
- **After every plan wave:** `cd src-tauri && cargo test --lib` (all Rust tests) + `npx tsc --noEmit` + `npm run verify:all` + `npm run test:e2e:phase12` (Phase 12 e2e subset).
- **Before `/gsd-verify-work`:** Full suite green + new gates green (`verify:scan-no-egress`, `verify:scan-no-write`, `verify:scan-event-compat`) + Wave 2 manual cold-install trace documented in `12-05-TRACE.md`.
- **Max feedback latency:** 15s per-task (scoped `cargo test`); ~3 min full chain.

---

## Per-Task Verification Map

*Pre-planning skeleton — enriched by the planner with per-task rows for 12-01..12-05. Research §Validation Architecture provides the per-requirement map. Every entry below is the authoritative test contract for its requirement.*

| Req ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|--------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| SCAN-01 | 12-01 | 0 | FS repo walk finds `.git` dirs under maxdepth 6 w/ ignore list | — | Walk never follows symlinks (`follow_links(false)`) — no /proc, /dev loops | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::fs_repos::tests::walks_maxdepth_six -- --nocapture` | ❌ W0 | ⬜ pending |
| SCAN-02 | 12-01 | 0 | Git remote parses SSH + HTTPS URLs → org/repo/account | — | Remote URL regex never captures auth tokens (http://user:pass@...) | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::git_remotes::tests::parses_ssh_and_https` | ❌ W0 | ⬜ pending |
| SCAN-03 | 12-02 | 0 | IDE workspaceStorage JSON parse recovers project path | — | N/A — read-only | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::ide_workspaces::tests::parses_workspace_json` | ❌ W0 | ⬜ pending |
| SCAN-04 | 12-02 | 0 | Claude session slug → project path reversal | — | Session `.jsonl` content never logged; only path extracted | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::ai_sessions::tests::slug_to_project_path` | ❌ W0 | ⬜ pending |
| SCAN-05 | 12-02 | 0 | Shell history extracts command frequency + timestamps (zsh ext format) | — | Sensitive env vars in history (API keys, tokens) never persisted in profile rows | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::shell_history::tests::parses_zsh_ext` | ❌ W0 | ⬜ pending |
| SCAN-06 | 12-01 | 0 | MRU window filter surfaces files with mtime ≤ N days | — | Walk respects ignore list (no node_modules MRU noise) | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::mru::tests::filters_by_window` | ❌ W0 | ⬜ pending |
| SCAN-07 | 12-02 | 0 | Chrome Bookmarks JSON parse → domain count | — | Full bookmark URLs never logged; only domains counted | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::bookmarks::tests::parses_chrome_json` | ❌ W0 | ⬜ pending |
| SCAN-08 | 12-02 | 0 | `which` sweep returns installed + version | — | `--version` output truncated via `safe_slice` — no binary garbage | unit | `cd src-tauri && cargo test --lib deep_scan::scanners::which_sweep::tests::detects_installed` | ❌ W0 | ⬜ pending |
| SCAN-09 | 12-01 | 0 | LeadQueue drains Hot before Warm before Cold | — | N/A | unit | `cd src-tauri && cargo test --lib deep_scan::queue::tests::tier_ordering` | ❌ W0 | ⬜ pending |
| SCAN-09 | 12-01 | 0 | LeadQueue dedup via `HashSet<PathBuf>` | — | N/A | unit | `cd src-tauri && cargo test --lib deep_scan::queue::tests::visited_dedupes` | ❌ W0 | ⬜ pending |
| SCAN-09 | 12-01 | 0 | `SCAN_CANCEL` between leads terminates drain ≤30s | — | Cancel honored inside a lead's time budget | unit | `cd src-tauri && cargo test --lib deep_scan::tests::cancel_between_leads` | ❌ W0 | ⬜ pending |
| SCAN-10 | 12-01 | 0 | `deep_scan_progress` event fires per lead with additive payload | — | Payload never contains secrets (no env values, no file contents) | integration | `cd src-tauri && cargo test --lib deep_scan::tests::emits_additive_payload` | ❌ W0 | ⬜ pending |
| SCAN-10 | 12-04 | 1 | Live-tail component renders scrolling log lines + auto-collapse | — | Log panel clears on window close (ephemeral) | e2e | `npm run test:e2e:phase12 -- tests/e2e/profile-live-tail.spec.ts` | ❌ W1 | ⬜ pending |
| SCAN-11 | 12-03 | 1 | Profile persistence — save + load round-trip | — | Overlay file respects same umask as existing `scan_results.json` | unit | `cd src-tauri && cargo test --lib deep_scan::profile::tests::roundtrip_overlay` | ❌ W1 | ⬜ pending |
| SCAN-11 | 12-04 | 1 | ProfileView renders 5 section tabs with correct row counts | — | N/A | e2e | `npm run test:e2e:phase12 -- tests/e2e/profile-tabs.spec.ts` | ❌ W1 | ⬜ pending |
| SCAN-12 | 12-04 | 1 | Edit → restart → reload shows edited value (overlay round-trip) | — | Edit never triggers network call | e2e | `npm run test:e2e:phase12 -- tests/e2e/profile-edit-roundtrip.spec.ts` | ❌ W1 | ⬜ pending |
| SCAN-12 | 12-04 | 1 | Every row renders source-origin pill | — | N/A | e2e | part of `profile-tabs.spec.ts` (role="status" pill assertion per row) | ❌ W1 | ⬜ pending |
| SCAN-12 | 12-03 | 1 | Orphaned row (overlay entry, no matching scan row) renders `orphaned=true` pill | — | N/A | unit | `cd src-tauri && cargo test --lib deep_scan::profile::tests::orphan_preservation` | ❌ W1 | ⬜ pending |
| SCAN-13 | 12-05 | 2 | Baseline cold-install ≥10 repos / ≥5 accounts / ≥3 rhythm / ≥3 IDE-AI on Arnav's machine | — | Baseline never exfiltrates scan data | manual-trace | Wave 2 operator run: invoke `deep_scan_start` on Arnav's WSL, capture `profile_get_rendered` output to `12-05-TRACE.md`, assert threshold counts. NOT CI-automatable — depends on machine state. | ❌ W2 | ⬜ pending |
| SCAN-13 | 12-05 | 2 | Scan completes in ≤2 min on baseline hardware | — | N/A | manual-trace | Wave 2 stopwatch. NOT CI-automatable. | ❌ W2 | ⬜ pending |
| — | 12-02 | 0 | `ScanClassesEnabled` 6-place config round-trip (save → load) | — | Disabled class is skipped before scanner enqueue (defense-in-depth) | unit | `cd src-tauri && cargo test --lib config::tests::scan_classes_roundtrip` | ❌ W0 | ⬜ pending |
| — | 12-05 | 2 | `verify:scan-no-egress` gate rejects `reqwest::`, `TcpStream`, `UdpSocket` in `deep_scan/` | — | Hard invariant — no egress from scan path | script | `npm run verify:scan-no-egress` | ❌ W2 | ⬜ pending |
| — | 12-05 | 2 | `verify:scan-no-write` gate rejects writes outside `~/.blade/identity/` from `deep_scan/` | — | Hard invariant — no filesystem mutation outside identity dir | script | `npm run verify:scan-no-write` | ❌ W2 | ⬜ pending |
| — | 12-05 | 2 | `verify:scan-event-compat` gate asserts every TS `DEEP_SCAN_PHASES` entry has a Rust emit site | — | Onboarding compat invariant — additive event shape only | script | `npm run verify:scan-event-compat` | ❌ W2 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (backend scanner foundation — 12-01 + 12-02)

- [ ] `src-tauri/src/deep_scan/queue.rs` — tier ordering, dedupe, cancel tests
- [ ] `src-tauri/src/deep_scan/scanners/git_remotes.rs` — SSH + HTTPS parse tests
- [ ] `src-tauri/src/deep_scan/scanners/fs_repos.rs` — walkdir maxdepth + ignore-list tests
- [ ] `src-tauri/src/deep_scan/scanners/mru.rs` — mtime filter tests
- [ ] `src-tauri/src/deep_scan/scanners/ai_sessions.rs` — Claude slug decode tests
- [ ] `src-tauri/src/deep_scan/scanners/shell_history.rs` — zsh extended + fish YAML tests (bash no-timestamp fallback to session mtimes)
- [ ] `src-tauri/src/deep_scan/scanners/bookmarks.rs` — Chromium JSON parse tests
- [ ] `src-tauri/src/deep_scan/scanners/ide_workspaces.rs` — workspaceStorage JSON + `.idea/workspace.xml` parse tests
- [ ] `src-tauri/src/deep_scan/scanners/which_sweep.rs` — mock-command version-extract tests
- [ ] `src-tauri/src/config.rs` — `ScanClassesEnabled` 6-place round-trip

---

## Wave 1 Requirements (profile surface + overlay — 12-03 + 12-04)

- [ ] `src-tauri/src/deep_scan/profile.rs` — overlay merge + orphan preservation + row_id canonicalization + atomic-rename round-trip
- [ ] `tests/e2e/profile-tabs.spec.ts` — ProfileView 5-tab navigation + per-row source pill presence
- [ ] `tests/e2e/profile-edit-roundtrip.spec.ts` — edit row → reload window → edit persists
- [ ] `tests/e2e/profile-live-tail.spec.ts` — scan_start → tail expands → ≥10 log lines stream → auto-collapse 3s after complete
- [ ] `tests/e2e/settings-privacy-scan-classes.spec.ts` — 8 toggles save + reload + disabled class is skipped in next scan

---

## Wave 2 Requirements (gates + goal-backward trace — 12-05)

- [ ] `scripts/verify-scan-no-egress.sh` (or `.mjs`) — grep-based
- [ ] `scripts/verify-scan-no-write.sh` (or `.mjs`) — grep-based
- [ ] `scripts/verify-scan-event-compat.mjs` — TS ↔ Rust symmetry check
- [ ] `package.json` `verify:all` chain extension to call all three new scripts
- [ ] `.planning/phases/12-smart-deep-scan/12-05-TRACE.md` — manual cold-install baseline run on Arnav's WSL machine with raw counts + timing

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cold-install baseline ≥10/5/3/3 on Arnav's WSL | SCAN-13 | Depends on live machine state — not reproducible in CI | Wave 2 operator run: run `deep_scan_start`, invoke `profile_get_rendered`, count `repos.length ≥ 10`, `accounts.length ≥ 5` where accounts are unique `(platform, handle, kind)` tuples, `rhythm_signals.length ≥ 3`, IDE+AI rows ≥ 3 combined. Commit counts + raw output excerpt to `12-05-TRACE.md`. |
| Scan completes in ≤2 min on baseline hardware | SCAN-13 (implicit perf) | Depends on live FS + /mnt/c crossing cost | Wave 2 stopwatch. Record elapsed_ms from final `complete` event. Commit to `12-05-TRACE.md`. |
| Cancel button terminates drain within one lead-cycle | SCAN-09 operability | Human-observable, requires live scan | Start scan, click Cancel during Hot tier, observe stop within ≤30s (Hot per-scanner hard budget). |
| Orphan row UX — user edits row, re-scan drops row | SCAN-12 | Requires scan/edit/re-scan sequence with state inspection | Edit a repo row, rename the repo directory out of scan roots, re-scan, verify row renders with `orphaned=true` pill. |

---

## Nyquist 8-Dimension Coverage

| Dimension | Phase 12 concern | Validation approach |
|-----------|------------------|---------------------|
| **Correctness** | Lead queue tier ordering; overlay merge; slug reversal; git remote regex; ignore-list filter | Unit tests per scanner; property test for `merge_scan_with_overlay` (random scan × random overlay → render); regex golden tests for 12+ URL shapes. |
| **Performance** | Scan time on Arnav's WSL; `/mnt/c` crossings; drain loop backpressure | Wave 2 stopwatch — target ≤2 min cold scan; per-scanner 30s hard budget enforced in code; budget-warning log if any scanner hits hard limit. |
| **Security** | No egress from `deep_scan/`; no writes outside `~/.blade/identity/`; keys/tokens never log; path names never sent externally | `verify:scan-no-egress` + `verify:scan-no-write` hard gates; existing `verify:no-raw-tauri` covers frontend; `safe_slice` everywhere for non-ASCII. |
| **UX** | Live-tail readability; source pill clarity; orphan row comprehension; 5-tab navigation focus order; 8 privacy toggles labels | UI-SPEC Surfaces A-C is design contract (locked); e2e tests assert role/aria-label presence; manual UI audit in Wave 2. |
| **Data integrity** | Overlay crash-safety (atomic rename); row_id canonicalization (canonical abs paths, not hashes); re-scan orphan preservation | Atomic-rename test; canonicalize round-trip test; kill-during-write test (spawn scan, kill mid-drain, restart → load still valid). |
| **Accessibility** | `role="log" aria-live="polite"` on live tail; 7×24 heatmap reflow; reduced-motion respects cell-hover; focus-trap on lead-details drawer; 4.5:1 contrast on pills | UI-SPEC a11y section specifies; existing `verify:aria-icon-buttons` + `verify:motion-tokens` + `verify:contrast` gates cover; Phase 14 `verify:a11y-pass-2` (future) re-checks Phase 12 surfaces. |
| **Dev-experience** | Scanner split into modular `deep_scan/scanners/*.rs` (one file per scanner); each scanner has `run(lead) -> (rows, followups)` signature; mock-friendly; single-scanner test run | One-function-per-scanner simplifies mocking; Phase 11 `#[cfg(test)]` keyring-override pattern reused; dev can run `cargo test --lib deep_scan::scanners::fs_repos -- --nocapture` for a single scanner in ≤5s. |
| **Operability** | Cancel button within 1 lead-cycle (≤30s worst case); scan failure logs once (not spam); re-scan idempotent (same inputs → same row_ids) | `SCAN_CANCEL` visible-stop test; silence-discipline test asserts no log-spam on repeated LLM failures (tester-pass `4ab464c` invariant); idempotency test — re-scan same FS state produces same `profile_get_rendered` hash. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (enriched by planner)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING Rust unit-test references
- [ ] No watch-mode flags (all `cargo test` + Playwright runs are one-shot)
- [ ] Feedback latency ≤15s per-task, ≤3 min full chain
- [ ] `nyquist_compliant: true` set in frontmatter (updates when all 8 dimensions pass Wave 2 manual trace)

**Approval:** pending — status flips to `approved YYYY-MM-DD` after `/gsd-verify-work` Wave 2 green.

---

*Source: 12-RESEARCH.md §Validation Architecture (lines 1539-1621).*
*Maintained by: /gsd-plan-phase (Wave planning) → /gsd-execute-phase (status updates) → /gsd-verify-work (sign-off).*
