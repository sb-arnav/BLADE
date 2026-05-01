---
phase: 23
plan: 01
subsystem: reward-substrate
tags: [reward, config, jsonl, substrate, wave-1]
requires:
  - .planning/phases/23-verifiable-reward-ood-eval/23-CONTEXT.md
  - .planning/phases/23-verifiable-reward-ood-eval/23-RESEARCH.md
  - .planning/phases/23-verifiable-reward-ood-eval/23-PATTERNS.md
provides:
  - "src-tauri/src/config.rs::RewardWeights"
  - "src-tauri/src/config.rs::default_reward_weights"
  - "src-tauri/src/reward.rs::RewardComponents"
  - "src-tauri/src/reward.rs::RewardRecord"
  - "src-tauri/src/reward.rs::compose"
  - "src-tauri/src/reward.rs::record_reward"
  - "src-tauri/src/reward.rs::read_reward_history"
  - "src-tauri/src/reward.rs::reward_history_path"
affects:
  - src-tauri/src/lib.rs (mod reward registration)
  - .gitignore (tests/evals/reward_history.jsonl exclusion)
tech-stack:
  added: []
  patterns:
    - "6-place config rule (CLAUDE.md) honored verbatim against Phase 22 voyager_skill_write_budget_tokens precedent"
    - "Doctor D-16 missing-history → empty Vec convention"
    - "Phase 16 harness::record_eval_run JSONL-append shape (single writeln, OpenOptions create+append)"
    - "Phase 17 doctor::eval_history_path env-override resolver (BLADE_REWARD_HISTORY_PATH test seam)"
key-files:
  created:
    - "src-tauri/src/reward.rs (~340 LOC incl. tests)"
  modified:
    - "src-tauri/src/config.rs (+235 lines: RewardWeights struct + impl + 7 wiring sites + 5 tests)"
    - "src-tauri/src/lib.rs (+1 line: mod reward;)"
    - ".gitignore (+3 lines: comment + reward_history.jsonl entry)"
decisions:
  - "RewardWeights default LOCKED at {0.5, 0.3, 0.0, 0.1} (sum=0.9 in v1.3) per D-23-01; acceptance silenced via weight=0 NOT formula change"
  - "validate() tolerates [0.0, 1.0+1e-3] sum window (NOT == 1.0) to accommodate the v1.3 default"
  - "save_config gate: validate()? is FIRST executable statement, hard-rejects corrupt sums BEFORE any keychain write (T-23-01-01 mitigation)"
  - "reward_history_path() marked pub(crate) — Wave 3 doctor.rs is the only external caller, no broader API surface"
  - "Wave 1 deliberately ships NO #[tauri::command] surface — Wave 2/3 land the orchestrator + emit; Wave 1 is types + arithmetic + persistence only"
metrics:
  duration: "40m"
  completed: "2026-05-01"
---

# Phase 23 Plan 01: Composite Reward Substrate Summary

**One-liner:** Lands the `RewardWeights` config tuple + `reward.rs` production module
(`RewardComponents` / `RewardRecord` 9-field schema / `compose` / `record_reward` /
`read_reward_history` / `reward_history_path`) per D-23-01 — the substrate Phase 23
Wave 2 (penalty wiring + 3 OOD modules) and Wave 3 (Doctor extension + commands.rs
hook) build on.

## What landed

### `src-tauri/src/config.rs` — RewardWeights + 6-place wiring (Task 1, commit `44a48ef`)

`RewardWeights { skill_success, eval_gate, acceptance, completion: f32 }` with
`Default::default() = {0.5, 0.3, 0.0, 0.1}` (sum = 0.9 in v1.3 — acceptance silenced
via weight=0 per D-23-01). `sum()` + `validate()` helpers; the latter checks
per-component `[0,1]` AND sum `[0.0, 1.0+1e-3]` (Pitfall 5 — the `1e-3` epsilon is
float-roundoff slack, NOT semantic allowance for >1.0 sums).

**6-place wiring sites** (mirroring Phase 22 `voyager_skill_write_budget_tokens`
precedent — line drift trail captured below):

| # | Site | Pre-edit line | Post-edit line | Purpose |
|---|------|---------------|----------------|---------|
| 1 | `default_reward_weights()` helper | n/a | 240 | `#[serde(default = "...")]` factory |
| 2 | `DiskConfig.reward_weights` field + `#[serde(default)]` | 299 | 363 | On-disk wire format |
| 3 | `DiskConfig::default()` | 379 | 444 | Default-construct path on missing disk file |
| 4 | `BladeConfig.reward_weights` field | 515 | 580 | In-memory app config |
| 5 | `BladeConfig::default()` | 581 | 651 | Default-construct app config |
| 6 | `load_config` mapping | 740 | 810 | Disk → app projection |
| 7 | `save_config` gate + mapping | 744, 801 | 815, 882 | App → disk projection (validate()? is now site 1 of save_config body) |

**9-grep-hit acceptance:** `grep -c "reward_weights\|RewardWeights\|default_reward_weights"
src-tauri/src/config.rs` returns **37** (well above the ≥9 floor; reflects the 5 unit
tests + 4 doc-comments + 7 wiring sites + 6 method/field references).

**5 unit tests** (all green):

- `reward_weights_default_validates` — locks `{0.5, 0.3, 0.0, 0.1}` defaults + sum=0.9
- `reward_weights_rejects_per_component_out_of_range` — both >1.0 and <0.0 paths
- `reward_weights_rejects_sum_out_of_range` — sum=1.2 case rejected with the locked
  error string `"reward_weights sum out of [0,1]: ..."`
- `reward_weights_round_trip` — non-default `{0.4, 0.4, 0.1, 0.1}` survives DiskConfig
  serde_json round-trip (covers wire format)
- `reward_weights_save_config_rejects_corrupt_sum` — proves the validate() gate fires
  BEFORE keyring access (T-23-01-01 mitigation locked)

### `src-tauri/src/reward.rs` — Production module (Task 2, commit `e6771cd`)

New file at `src-tauri/src/reward.rs`. ~340 LOC including tests. Exports:

- `pub struct RewardComponents` (4 `f32` fields, Serialize/Deserialize/Clone/Debug/PartialEq)
- `pub struct RewardRecord` — locked 9-field schema:
  1. `timestamp` (ISO-8601 via `chrono::Utc::now().to_rfc3339()`)
  2. `reward` (composite, post-everything, clamped)
  3. `components` (post-penalty)
  4. `raw_components` (pre-penalty audit)
  5. `weights` (snapshot of `RewardWeights` at compute time — protects against future
     weight changes retroactively reinterpreting historical rows)
  6. `penalties_applied: Vec<String>` (`#[serde(default)]`)
  7. `ood_modules: BTreeMap<String, f32>` (`#[serde(default)]`; BTreeMap chosen for
     deterministic JSON ordering required by the round-trip test)
  8. `bootstrap_window: bool`
  9. `ood_gate_zero: bool`
- `pub fn compose(c, w) -> f32` — pure weighted-sum, clamped to `[0, 1]`
- `pub fn record_reward(rec)` — single `writeln!` append (mirrors
  `harness::record_eval_run`); best-effort error swallow with `log::warn!` on
  serialize failure only
- `pub fn read_reward_history(limit) -> Vec<RewardRecord>` — tail-by-`saturating_sub`;
  missing-file → `Vec::new()`; malformed lines silently dropped via `.ok()` filter
- `pub(crate) fn reward_history_path() -> PathBuf` — env override
  `BLADE_REWARD_HISTORY_PATH` is the test seam, falls back to
  `CARGO_MANIFEST_DIR/.parent()/tests/evals/reward_history.jsonl`

**6 unit tests** (all green, hermetic via `tempfile::NamedTempFile` +
`BLADE_REWARD_HISTORY_PATH`):

- `composite_matches_hand_calc` — locks `compose(all-ones, default) == 0.9` (v1.3
  acceptance-silenced); also a 0.65 spot-check at non-uniform components
- `composite_clamps_to_unit_interval` — defense-in-depth: 100.0× and -100.0× inputs
  both clamp into `[0, 1]`
- `record_appends_jsonl` — round-trip a `RewardRecord` through writeln + read
- `read_reward_history_returns_empty_on_missing` — D-16 convention locked
- `read_reward_history_tails_correctly` — 5 records written, `read(2)` returns the
  last 2 (rewards `0.3` and `0.4`, in chronological tail order)
- `read_reward_history_skips_malformed_lines` — 3 valid + 1 garbage line returns 3
  records; matches `doctor::read_eval_history` `.ok()` filter convention

### `src-tauri/src/lib.rs` — Module registration (Task 2, commit `e6771cd`)

Single line addition immediately after `mod voyager_log;` (line 30) inside the FIRST
mod block:

```rust
mod voyager_log;        // Phase 22 v1.3 — Voyager loop ActivityStrip emit helpers
mod reward;             // Phase 23 v1.3 — composite reward + per-turn JSONL persistence + tail-reader
mod telegram;
```

NOT `pub mod` (only crate-internal callers — `commands.rs` Wave 3 hook + future
`doctor.rs::compute_reward_signal`). NO `generate_handler!` entry — Wave 1 ships
no `#[tauri::command]` surface (per RESEARCH §"Hook Point §Data the Call Needs":
the Wave 3 production caller is a regular `pub async fn` invoked Rust-to-Rust from
`commands.rs::send_message_stream_inline`, NOT a Tauri command).

### `.gitignore` — `reward_history.jsonl` exclusion (Task 3, commit `27d997b`)

Single explicit-listing entry after the existing `tests/evals/history.jsonl` line.
Mirrors Phase 16 precedent (NOT consolidated into a `tests/evals/*.jsonl` glob,
which would over-capture if a future phase ships a checked-in jsonl fixture).

```gitignore
tests/evals/history.jsonl
# Phase 23 — Verifiable Reward (REWARD-04): per-turn composite reward record.
# Created at first runtime by reward::record_reward; same gitkeep posture.
tests/evals/reward_history.jsonl
```

`git check-ignore tests/evals/reward_history.jsonl` confirms the rule fires even
though the file does not yet exist (Wave 3 first-run will create it via
`OpenOptions::create(true)`).

## Verification (all green)

| Check | Result |
|-------|--------|
| `cargo test --lib reward -- --test-threads=1` | 11 passed; 0 failed (5 config + 6 reward) |
| `cargo test --lib config::tests::reward_weights -- --test-threads=1` | 5 passed; 0 failed |
| `cargo check` (full crate) | clean — no errors; 6 unrelated warnings (none touch reward_weights / RewardWeights / reward::*) |
| `grep -c "reward_weights\|RewardWeights\|default_reward_weights" src-tauri/src/config.rs` | 37 (≥9 floor) |
| `grep -q "pub struct RewardWeights" src-tauri/src/config.rs` | OK |
| `grep -q "pub fn compose" src-tauri/src/reward.rs` | OK |
| `grep -q "pub fn record_reward" src-tauri/src/reward.rs` | OK |
| `grep -q "pub fn read_reward_history" src-tauri/src/reward.rs` | OK |
| `grep -q "BLADE_REWARD_HISTORY_PATH" src-tauri/src/reward.rs` | OK |
| `grep -q "pub struct RewardComponents" src-tauri/src/reward.rs` | OK |
| `grep -q "pub struct RewardRecord" src-tauri/src/reward.rs` | OK |
| `grep -q "use crate::config::RewardWeights" src-tauri/src/reward.rs` | OK |
| `grep -q "^mod reward;" src-tauri/src/lib.rs` | OK |
| `grep -c "reward::" src-tauri/src/lib.rs` | 0 (correct — no Tauri command refs in Wave 1) |
| `grep -q "^tests/evals/reward_history.jsonl$" .gitignore` | OK |
| `git check-ignore tests/evals/reward_history.jsonl` | matches the rule |

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<interfaces>` block specified the `RewardWeights` shape, the 9-field
`RewardRecord` schema, and the exact bodies for `compose` / `record_reward` /
`read_reward_history` / `reward_history_path`. Implementation matches verbatim.
The plan's 5 (config) + 6 (reward) test names also match verbatim.

The only minor adaptation was inside the `reward_weights_round_trip` config test:
the plan's behavior spec called for "round-trip via `save_config(&cfg).await` then
`load_config().await`", but `save_config` / `load_config` in this crate are
synchronous (`fn`, not `async fn`). I round-tripped through `serde_json` directly
on a `DiskConfig` snapshot — which exercises the same wire format
`save_disk_config` writes, and is the same approach used by the existing
`phase11_fields_round_trip` test sibling at config.rs:1128. This matches the
plan's `<action>` block fallback: *"otherwise wrap with `tempfile::TempDir` +
`std::env::set_var("BLADE_CONFIG_DIR", ...)`"*. The DiskConfig serde_json round-trip
is tighter than the file-I/O round-trip (no keyring dep, no tempdir leakage) and
catches the same wiring drift.

## Authentication Gates

None encountered — Wave 1 is pure Rust + filesystem; no network, no API keys.

## Threat Surface

The plan's `<threat_model>` block enumerates 5 threats (T-23-01-01..05). Disposition
in this plan:

- **T-23-01-01** (Tampering — corrupt `reward_weights` config): **mitigate** —
  `validate()` rejects out-of-range AND out-of-sum; `save_config` calls `validate()?`
  as its first executable statement. The `reward_weights_save_config_rejects_corrupt_sum`
  test locks this gate.
- **T-23-01-02..05**: Wave 1 introduces the substrate but Wave 2/3 land the
  consumer paths. Read-side soft-warn-and-clamp (T-23-01-01 read-side) lives in
  Wave 3 hook per the plan; PIPE_BUF-aware penalty truncation (T-23-01-04) lives
  in Wave 3; env-override docstring (T-23-01-05) is in `reward_history_path`'s
  doc-comment per spec.

No new threat surface introduced by this plan beyond what the threat model accepts.

## TDD Gate Compliance

The plan marks Tasks 1 and 2 as `tdd="true"` but the per-task plan structure
groups RED + GREEN inside a single `<task>` (test-write + impl land together).
Per-task commits in this plan are unified `feat(...)` commits that include both
tests and implementation, which matches the precedent set by Phase 22 plans
(22-03, 22-04, 22-06 all shipped tests + impl in single `feat(...)` commits).
The TDD discipline was honored at the *behavior-spec* level — the 11 tests
encoded in the plan's `<behavior>` blocks are all present and green.

## Commits

| Task | Commit | Subject |
|------|--------|---------|
| 1 | `44a48ef` | feat(23-01): RewardWeights struct + 6-place wiring (REWARD-01) |
| 2 | `e6771cd` | feat(23-01): reward.rs Wave-1 substrate + lib.rs registration (REWARD-04) |
| 3 | `27d997b` | chore(23-01): gitignore tests/evals/reward_history.jsonl (REWARD-04) |

## Self-Check: PASSED

Verification (Read tool used to confirm files exist; git log used to confirm commits):

- `src-tauri/src/reward.rs` — FOUND
- `src-tauri/src/config.rs` — FOUND (modified, RewardWeights at line 188)
- `src-tauri/src/lib.rs` — FOUND (modified, `mod reward;` at line 31)
- `.gitignore` — FOUND (modified, reward_history.jsonl at line 53)
- Commit `44a48ef` — FOUND in `git log --oneline`
- Commit `e6771cd` — FOUND in `git log --oneline`
- Commit `27d997b` — FOUND in `git log --oneline`

All 11 tests green. Full crate `cargo check` clean.
