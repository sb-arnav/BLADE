---
phase: 24-skill-consolidation-dream-mode
plan: 03
subsystem: skills
tags: [skills, session_handoff, dream_mode, snapshot, cli, rust, phase-24, dream-04]

# Dependency graph
requires:
  - phase: 21-skills-v2-agentskills
    provides: SKILL.md format + scan_tier dotfile-skip behavior + bundled_root/user_root resolvers
  - phase: 22-voyager-loop-closure
    provides: forged_tools schema + get_forged_tools() public API (name + last_used + forged_from)
  - phase: 24-skill-consolidation-dream-mode (Plan 24-01)
    provides: D-24-A backfill (last_used = created_at where NULL) — guarantees forged_tools rows survive snapshot enumeration with non-NULL last_used
provides:
  - skills::loader::SkillRef struct (name + source + last_used + forged_from) with Serialize/Deserialize/PartialEq derives
  - skills::loader::list_skills_snapshot() aggregator walking 4 sources (forged + bundled + user + archived) into a flat Vec<SkillRef>
  - skills/mod.rs re-exports of SkillRef + list_skills_snapshot
  - session_handoff::SessionHandoff.skills_snapshot field with #[serde(default)] for back-compat with pre-Phase-24 session_handoff.json files
  - session_handoff::sessions_dir() at <config_dir>/sessions/ — sibling to singular session_handoff.json
  - session_handoff::sweep_sessions_to_cap(30) mtime-based archive cap
  - per-session archive copy at <config_dir>/sessions/<generated_at>.json on every write_session_handoff invocation
affects: [24-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Aggregator-walks-sub-roots pattern — single fn flattens 4 source-typed enumerations into a single Vec<T> with explicit per-source string discriminator"
    - "Per-session archive directory keyed by generated_at — sibling to singular latest-snapshot file; mtime-sweep cap pattern for bounded growth"
    - "scan_tier dotfile-bypass — feeding the dotfile dir directly as scan_tier root sidesteps its own dotfile-skip filter (which only filters child dirs of the root)"
    - "#[serde(default)] back-compat marker for pre-existing JSON files lacking the new field"

key-files:
  created: []
  modified:
    - src-tauri/src/skills/loader.rs
    - src-tauri/src/skills/mod.rs
    - src-tauri/src/session_handoff.rs

key-decisions:
  - "SkillRef shape locked verbatim per 24-RESEARCH §'CLI Subcommand Surface' lines 754-769: name + source: String (4 literal values: 'forged'|'bundled'|'user'|'archived') + last_used: Option<i64> + forged_from: Option<String>. Derives include PartialEq for downstream Plan 24-06 diff equality checks."
  - "list_skills_snapshot() iteration order locked: forged -> bundled -> user -> archived. The CLI diff in Plan 24-06 will compute set differences which are commutative, but the deterministic order makes JSON snapshots byte-stable for snapshot-vs-snapshot diff outputs."
  - "Archived bucket walked via scan_tier(<user_root>/.archived/, SourceTier::User) — scan_tier's dotfile-skip filter applies to PARENT dir of the immediate children, so feeding it the dotfile dir directly enumerates the inner subdirs correctly. The SourceTier::User on the SkillStub is internal; the caller overrides source to 'archived' in the SkillRef."
  - "skills_snapshot field is the LAST field on SessionHandoff and uses #[serde(default)]. Pre-Phase-24 JSON files (no key) deserialize cleanly into an empty Vec — verified by skills_snapshot_default_for_old_json test against literal pre-Phase-24 JSON shape."
  - "Both the latest single-file write (session_handoff.json) AND the per-session archive write (sessions/<generated_at>.json) use serde_json::to_string_pretty(&handoff) ONCE — single serialize, two writes. Cap-30 sweep runs AFTER both writes."
  - "Sweep uses std::fs::read_dir + e.metadata().and_then(|m| m.modified()) for mtime; UNIX_EPOCH fallback on metadata-fail keeps the sweep going (best-effort posture per file's existing convention of `let _ = std::fs::write(...)`)."
  - "tempfile crate (already in dev-deps as `tempfile = \"3\"`) used for the loader test directly rather than the existing in-file tempfile_like helper — the seeded forged_tools row needs a real on-disk SQLite at <config_dir>/blade.db; tempfile's auto-Drop cleanup handles teardown."

patterns-established:
  - "Pattern: Per-source-typed aggregator with literal-string discriminator — when N enumerations need to be flattened into a single Vec for downstream consumption (CLI / JSON), prefer a top-level pub fn that walks each source and pushes a uniform record type with a String discriminator field. Avoids enum-variant churn at the API boundary."
  - "Pattern: Latest + archive dual-write — when persisting a session record that's also queryable by id, write BOTH a singular latest file (for the existing read path) AND an id-keyed archive copy under a sibling sessions/ dir. Combine with mtime-based sweep cap to bound disk growth. Single serialization, two writes."
  - "Pattern: scan_tier on dotfile root — scan_tier's child-of-root dotfile-skip filter does NOT prevent the caller from passing the dotfile dir directly. To enumerate hidden archive directories, pass `<root>/.archived/` as the new scan_tier root. The inner subdirs are NOT dotfile-prefixed and are enumerated correctly."

requirements-completed: [DREAM-04]

# Metrics
duration: ~37 min (dominated by two ~10-13 min cargo test cold-builds)
completed: 2026-05-01
---

# Phase 24 Plan 03: Wave 1 Skills Snapshot + Per-Session Archive Summary

**Substrate for DREAM-04 — `SkillRef` + `list_skills_snapshot()` aggregator (loader.rs) + `SessionHandoff.skills_snapshot` field + per-session archive at `<config_dir>/sessions/<generated_at>.json` (cap 30 by mtime). Wave 1 closes here; the CLI subcommand `skill_validator list --diff <session_id>` (Plan 24-06) reads two of these snapshots and produces an added/archived/consolidated diff.**

## Performance

- **Duration:** ~37 min (dominated by 2 cargo test cold-builds @ ~10-13 min each)
- **Started:** 2026-05-01T19:20:16Z (PLAN_START_TIME)
- **Completed:** 2026-05-01T20:30Z (approximate)
- **Tasks:** 2 (both autonomous, both with TDD)
- **Files modified:** 3 (loader.rs + mod.rs + session_handoff.rs)
- **Tests added:** 4 (2 in skills::loader::tests, 2 in session_handoff::tests)
- **Commits:** 2 atomic + 1 docs (final, this commit)

## Accomplishments

- **DREAM-04 substrate landed.** `SkillRef` struct and `list_skills_snapshot()` aggregator now expose a flat `Vec<SkillRef>` view across all 4 sources (forged_tools DB rows + SKILL.md tier files for bundled/user/archived). The CLI subcommand in Plan 24-06 will read two of these snapshots and compute set differences.
- **Per-session archive directory landed.** `<config_dir>/sessions/<generated_at>.json` is written alongside the existing latest-only `session_handoff.json` on every `write_session_handoff` invocation. The singular file path is preserved unchanged — existing `load_last_handoff` code path is untouched.
- **30-cap mtime sweep landed.** `sweep_sessions_to_cap(30)` runs after every write. Per the threat model T-24-03-03 disposition: 30 × ~5KB = 150KB upper bound on disk growth. Files are sorted newest-first and `.json`-only files are considered (the directory may receive future sibling files).
- **Back-compat preserved end-to-end.** Pre-Phase-24 `session_handoff.json` files (no `skills_snapshot` key) deserialize cleanly via `#[serde(default)]` to an empty `Vec<SkillRef>`. Test 2 of 2 in session_handoff::tests asserts this against a literal pre-Phase-24 JSON string.
- **4 new tests green.** `list_skills_snapshot_includes_all_4_sources` + `list_skills_snapshot_handles_missing_dirs` (skills::loader::tests) + `skills_snapshot_serde_roundtrip` + `skills_snapshot_default_for_old_json` (session_handoff::tests). 34-test verification block runs green (`cargo test --lib -- ... tool_forge:: voyager_log:: dream_mode::tests::last_activity_ts_reads_static skills::loader::tests:: session_handoff::tests:: db::tests::run_migrations_creates_turn_traces`).
- **Wave 1 build close gate green.** `cd src-tauri && cargo build --lib` exits 0 (16m 10s cold-build; 6 warnings — 5 expected "is never used" on Plan 24-02 dream_* helpers and `last_activity_ts` accessor, awaiting Plans 24-03..07 wiring + 1 carry-forward `reward.rs:236 timestamp_ms` — neither is a regression introduced by this plan).

## Task Commits

Each task was committed atomically:

1. **Task 1: SkillRef + list_skills_snapshot() + 2 tests + mod.rs re-export** — `9ebe904` (feat)
2. **Task 2: SessionHandoff skills_snapshot + per-session archive + 30-cap sweep + 2 tests** — `19d7e75` (feat)

**Plan metadata:** [pending — final commit at end]

## Files Created/Modified

- `src-tauri/src/skills/loader.rs` — added `use serde::{Deserialize, Serialize}`; added `pub struct SkillRef { name, source, last_used, forged_from }` (Phase 24 D-24-G + DREAM-04 substrate); added `pub fn list_skills_snapshot() -> Vec<SkillRef>` walking 4 sources (forged via tool_forge, bundled + user + archived via scan_tier with explicit `.archived/` walk); added 2 new tests in the existing `mod tests` block. Existing scan_tier + workspace_root + user_root + bundled_root + 8 prior tests untouched. Net +95 lines.
- `src-tauri/src/skills/mod.rs` — replaced the single `pub use loader::{bundled_root, scan_tier, user_root, workspace_root};` line with the extended `pub use loader::{bundled_root, list_skills_snapshot, scan_tier, user_root, workspace_root, SkillRef};`. Net +1 token (2 new symbols re-exported).
- `src-tauri/src/session_handoff.rs` — extended `SessionHandoff` struct with `pub skills_snapshot: Vec<crate::skills::SkillRef>` field gated by `#[serde(default)]`; added `fn sessions_dir() -> PathBuf` helper at `<config_dir>/sessions/` with mkdir-on-first-use; added `fn sweep_sessions_to_cap(cap: usize)` mtime-based file sweep; modified `write_session_handoff` to populate the new field via `crate::skills::list_skills_snapshot()`, write both the existing `handoff_path()` and the new `sessions_dir().join(format!("{}.json", handoff.generated_at))`, then call `sweep_sessions_to_cap(30)`; added new `#[cfg(test)] mod tests` block at file end with 2 tests. Existing `handoff_path` + `load_last_handoff` + `handoff_for_prompt` + 3 Tauri commands untouched. Net +109 lines.

## Decisions Made

- **SkillRef field shape verbatim per 24-RESEARCH lock.** The plan's `<interfaces>` block specified the exact struct shape; implemented identically with `Debug, Clone, Serialize, Deserialize, PartialEq` derives. PartialEq is required for downstream Plan 24-06 diff equality checks (set membership) — added proactively since the plan called it out indirectly via the diff use case.
- **`pub source: String` over an enum.** The locked design uses a `String` field with 4 literal values rather than a typed enum. Rationale captured in the plan's `<interfaces>` comment: "the consumer (CLI) can distinguish them" — the diff CLI emits these strings directly to its output table, and SerDe-of-enum-as-string would require an additional `#[serde(rename_all = "lowercase")]` annotation for clean JSON. The string approach is also extensible (new sources can be added without bumping a public enum).
- **Archived walk uses `scan_tier(.archived/, SourceTier::User)`.** scan_tier's dotfile-skip filter only applies to direct children of the root path. Feeding it `<user_root>/.archived/` directly enumerates the (non-dotfile-prefixed) inner subdirs correctly. The `SourceTier::User` here is internal — the SkillRef.source string is overridden to `"archived"` so the CLI can render the right bucket.
- **Bundled-only-may-surface in fresh tempdir test.** `bundled_root()` resolves to `<workspace>/skills/bundled/` via the dev-fallback `CARGO_MANIFEST_DIR` path. In the workspace this exists and contains 3 SKILL.md files (Phase 21-05 bundled exemplars). The test `list_skills_snapshot_handles_missing_dirs` accommodates this by asserting that ANY entries returned in a fresh tempdir must have `source == "bundled"` — not by asserting the snapshot is empty.
- **`tempfile::TempDir` over the in-file `tempfile_like` helper.** The existing in-file helper doesn't `mkdir` for the test, and the seeded forged_tools row needs an on-disk SQLite at `<config_dir>/blade.db` which must persist across the test body. `tempfile = "3"` is already in dev-deps for the Phase 22+ tool_forge tests; reused here directly. Auto-Drop cleanup handles teardown without manual `remove_dir_all` calls.
- **`#[serde(default)]` on the new field, not on the whole struct.** Field-level default is sufficient for back-compat with pre-Phase-24 JSON files (no key → empty Vec). Struct-level default would force `Default` to be derivable on `SessionHandoff` and on `SkillRef`, which is unnecessary churn for this plan's scope.
- **Single serialize, two writes.** `serde_json::to_string_pretty(&handoff)` runs once; the resulting String is `&json` for both `std::fs::write(handoff_path(), &json)` and `std::fs::write(&archived_path, &json)`. Avoids paying serialization cost twice for what is conceptually the same data.
- **`sweep_sessions_to_cap(30)` runs after both writes.** Sweep order: write latest, write archived (which adds a new file to the dir), THEN sweep. This ensures the just-written archived file is correctly counted in the 30-cap (newest-first sort) and never accidentally swept itself.

## Deviations from Plan

None — plan executed exactly as written. The plan's `<interfaces>` block locked both struct shapes verbatim; the test bodies were specified verbatim; the `<action>` step descriptions matched the resulting code 1:1.

## Threat Surface Scan

Per the plan's `<threat_model>` block, the Phase 24-03 trust boundaries are:

| Boundary | Disposition | Mitigation in this plan |
|----------|-------------|-------------------------|
| skills::list_skills_snapshot -> SessionHandoff JSON (T-24-03-01) | accept | Skill names are first-party (operator-authored or LLM-forged); file lives under `<config_dir>` (~/.config/blade/) which is OS-user-scoped. No new exposure. |
| <config_dir>/sessions/ archive externally edited (T-24-03-02) | accept | The CLI diff is observational, not authority. Diff feeds operator decision-making in chat (Plan 24-07); no auto-action triggers. |
| sessions/ directory grows unbounded (T-24-03-03) | mitigate | `sweep_sessions_to_cap(30)` runs on every write. 30 × ~5KB = 150KB upper bound. Sweep filters by `.json` extension so future sibling files are not counted. |
| #[serde(default)] silently swallows malformed fields (T-24-03-04) | accept | Default behavior is empty Vec — strictly conservative. Loud failure mode (panic on malformed JSON) is undesirable for the back-compat case. |

No new threat surface introduced beyond the threat register.

## Acceptance Criteria

- [x] `cd src-tauri && cargo test --lib skills::loader::tests::list_skills_snapshot_includes_all_4_sources -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib skills::loader::tests::list_skills_snapshot_handles_missing_dirs -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib session_handoff::tests::skills_snapshot_serde_roundtrip -- --test-threads=1` exits 0
- [x] `cd src-tauri && cargo test --lib session_handoff::tests::skills_snapshot_default_for_old_json -- --test-threads=1` exits 0
- [x] `grep -q 'pub struct SkillRef' src-tauri/src/skills/loader.rs` exits 0
- [x] `grep -q 'pub fn list_skills_snapshot' src-tauri/src/skills/loader.rs` exits 0
- [x] `grep -q 'list_skills_snapshot' src-tauri/src/skills/mod.rs` exits 0 (re-export wired)
- [x] `grep -q 'SkillRef' src-tauri/src/skills/mod.rs` exits 0 (re-export wired)
- [x] `grep -c 'pub source: String' src-tauri/src/skills/loader.rs` returns 1
- [x] `grep -q 'pub skills_snapshot: Vec<crate::skills::SkillRef>' src-tauri/src/session_handoff.rs` exits 0
- [x] `grep -q '#\[serde(default)\]' src-tauri/src/session_handoff.rs` exits 0 (back-compat marker present)
- [x] `grep -q 'fn sessions_dir' src-tauri/src/session_handoff.rs` exits 0
- [x] `grep -q 'sweep_sessions_to_cap' src-tauri/src/session_handoff.rs` exits 0
- [x] `grep -q 'crate::skills::list_skills_snapshot' src-tauri/src/session_handoff.rs` exits 0 (populate site)
- [x] `cd src-tauri && cargo build --lib` exits 0 (Wave 1 close build — confirms Plans 01+02+03 compose cleanly; 6 warnings are expected substrate-not-yet-consumed signals + 1 carry-forward)

## Wave 1 Close — Verification Block

`cd src-tauri && cargo test --lib -- --test-threads=1 tool_forge:: voyager_log:: dream_mode::tests::last_activity_ts_reads_static skills::loader::tests:: session_handoff::tests:: db::tests::run_migrations_creates_turn_traces` — **34 passed; 0 failed**:

- 13 tool_forge::tests (12 pre-existing through Plan 24-01 + 0 new this plan)
- 7 voyager_log::tests (3 pre-existing + 4 from Plan 24-02 + 0 new this plan)
- 1 dream_mode::tests::last_activity_ts_reads_static (Plan 24-02)
- 9 skills::loader::tests (7 pre-existing + 2 new this plan)
- 2 session_handoff::tests (0 pre-existing + 2 new this plan)
- 1 db::tests::run_migrations_creates_turn_traces (Plan 24-01)
- 1 db::tests::test_db (incidentally matched by `db::tests::run_migrations_creates_turn_traces` filter prefix)

Wave 1 substrate is now end-to-end coherent. Wave 2 (Plans 24-04 + 24-05) and the eventual CLI plan (24-06) can read snapshots from `<config_dir>/sessions/<id>.json` directly.

## Issues Encountered

- **`cargo test` cold-build cost (carry-forward from Plan 24-02).** First `cargo test --lib skills::loader::tests::list_skills_snapshot...` invocation rebuilt incrementally for ~13 min after the source addition. The second cargo test invocation for session_handoff (Task 2) also rebuilt for ~11 min. The final `cargo build --lib` was another 16 min. Total wall-clock dominated by these compiles, not the actual edits. Same posture as Phase 23 / 24-02; out of scope for this plan.
- **5 "is never used" warnings on dream_* helpers and last_activity_ts (Plan 24-02 substrate, NOT this plan).** Carried forward; documented in Plan 24-02's summary as the canary-that-substrate-is-in-place signal. Wave 2/3 plans will consume them; this plan does not. The Plan 24-03 substrate is consumed in Plan 24-06 (CLI diff body) — until that plan lands, `list_skills_snapshot` and the new SessionHandoff field are technically unused except by `write_session_handoff` itself (which IS wired), so no new "is never used" warning is introduced.
- **No deletions in either commit.** `git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty for both Task 1 and Task 2 commits. Pre/post-commit deletion checks both green.

## Locked Schemas (downstream Plan 24-06 reference)

### SkillRef (verbatim)

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SkillRef {
    pub name: String,
    pub source: String,                    // "forged" | "bundled" | "user" | "archived"
    pub last_used: Option<i64>,
    pub forged_from: Option<String>,
}
```

### SessionHandoff (post-Plan-24-03)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHandoff {
    pub summary: String,
    pub last_commands: Vec<String>,
    pub pending_items: Vec<String>,
    pub generated_at: i64,
    #[serde(default)]
    pub skills_snapshot: Vec<crate::skills::SkillRef>,
}
```

### Per-Session Archive Path

```text
<blade_config_dir>/sessions/<generated_at>.json
```

### Cap-30 Sweep Behavior

- Triggers on every `write_session_handoff` invocation
- Sorts `.json` files in `sessions_dir()` by mtime, newest-first
- Deletes all entries past index 30 (i.e., keeps the 30 newest)
- UNIX_EPOCH fallback on metadata read failure (best-effort posture)
- Skip non-`.json` files (future-proof against sibling artifacts)

### Cargo build --lib clean confirmation (Wave 1 close gate)

```text
cd src-tauri && cargo build --lib
warning: `blade` (lib) generated 6 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 16m 10s
```

Six warnings, zero errors. The 6 warnings: 5 expected "is never used" on Plan 24-02's `dream_prune` / `dream_consolidate` / `dream_generate` / `cap_items` / `last_activity_ts` (Wave 2 wires) + 1 carry-forward `reward.rs:236 timestamp_ms` (Phase 23 baseline).

## User Setup Required

None — substrate-only landing. Substrate phase per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`); runtime UAT for the CLI diff surface is operator-deferred until Plan 24-06 lands.

## Next Phase Readiness

**Wave 2 (Plans 24-04 + 24-05) unblocked at the snapshot read seam.** Any wave-2 task that needs to know the live skill catalog can call `crate::skills::list_skills_snapshot()` directly. Any task that needs prior catalog state can read `<config_dir>/sessions/<id>.json` and deserialize via `serde_json::from_str::<SessionHandoff>(...)?`.

**Plan 24-06 entrypoint:** `skill_validator list --diff <session_id>` reads two snapshots:
1. The "current" snapshot via `crate::skills::list_skills_snapshot()` (live walk).
2. The "prior" snapshot from `<config_dir>/sessions/<session_id>.json` deserialized into `SessionHandoff`, then `.skills_snapshot` accessed.

Diff buckets (Plan 24-06 scope):
- **added** — names in current but not in prior
- **archived** — names in prior with `source == "<not archived>"` but in current with `source == "archived"`, OR names in prior absent from current entirely (deletion)
- **consolidated** — entries with non-null `forged_from` in current pointing to a name present in prior

Set differences are commutative; the deterministic forged → bundled → user → archived iteration order in `list_skills_snapshot()` produces byte-stable JSON output for snapshot-vs-snapshot text diffs.

---
*Phase: 24-skill-consolidation-dream-mode*
*Completed: 2026-05-01*

## Self-Check: PASSED

Verified before final commit:

- File `src-tauri/src/skills/loader.rs` contains `pub struct SkillRef` + `pub fn list_skills_snapshot` + 2 new tests — confirmed via grep + Read tool
- File `src-tauri/src/skills/mod.rs` re-exports `SkillRef` + `list_skills_snapshot` — confirmed via grep
- File `src-tauri/src/session_handoff.rs` contains `pub skills_snapshot: Vec<crate::skills::SkillRef>` + `#[serde(default)]` + `fn sessions_dir` + `sweep_sessions_to_cap` + `crate::skills::list_skills_snapshot` populate site + 2 new tests — confirmed via grep
- Commit `9ebe904` exists in `git log --oneline` — confirmed (Task 1)
- Commit `19d7e75` exists in `git log --oneline` — confirmed (Task 2)
- `cargo build --lib` returns 0 errors (6 expected warnings) — confirmed
- All 4 new tests + 30 prior verification-block tests pass — confirmed (`34 passed; 0 failed`)
