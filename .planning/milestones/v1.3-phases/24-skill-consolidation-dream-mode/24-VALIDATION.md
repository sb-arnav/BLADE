---
phase: 24
slug: skill-consolidation-dream-mode
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth Per-Requirement → Test mapping lives in `24-RESEARCH.md` §"Validation Architecture".
> The planner refines the Per-Task Verification Map below as PLAN.md files are authored.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test --lib` (per Phase 16/17/22/23 convention) + integration tests via `BLADE_CONFIG_DIR` env override + tempdir |
| **Config file** | `src-tauri/Cargo.toml` (existing; no separate test config) |
| **Quick run command** | `cd src-tauri && cargo test --lib dream_mode -- --test-threads=1` (or per-module: `skills::lifecycle::tests`) |
| **Full suite command** | `cd src-tauri && cargo test --lib -- --test-threads=1` |
| **Estimated runtime** | ~4-5 min full suite; ~30s focused module |

---

## Sampling Rate

- **After every task commit:** Run `cd src-tauri && cargo test --lib <module>::tests -- --test-threads=1`
- **After every plan wave:** Run `cd src-tauri && cargo test --lib -- --test-threads=1`
- **Before `/gsd-verify-work`:** Full suite + `cargo build --bin skill_validator` + `npx tsc --noEmit` all green
- **Max feedback latency:** 5 minutes (full suite)

---

## Per-Task Verification Map

> Authoritative test list lives in `24-RESEARCH.md` §"Phase Requirements → Test Map".
> Planner fills this table per-PLAN as plan IDs (`24-01-01`, etc.) are assigned.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD-01-01 | 01 | 1 | DREAM-01 | T-24-01 | last_used backfill — ensure_table sets created_at on NULL rows | unit | `cargo test --lib tool_forge::tests::ensure_table_backfills_null_last_used` | ❌ W0 | ⬜ pending |
| TBD-01-02 | 01 | 1 | DREAM-02 | — | trace_hash sequence equality — different orderings → different hashes | unit | `cargo test --lib tool_forge::tests::trace_hash_order_sensitive` | ❌ W0 | ⬜ pending |
| TBD-01-03 | 01 | 1 | DREAM-02 | — | record_tool_use writes invocation row + auto-prunes >100 | unit | `cargo test --lib tool_forge::tests::record_tool_use_writes_invocation_row` | ❌ W0 | ⬜ pending |
| TBD-01-04 | 01 | 1 | DREAM-04 | — | session_handoff `skills_snapshot` round-trips serde | unit | `cargo test --lib session_handoff::tests::skills_snapshot_serde_roundtrip` | ❌ W0 | ⬜ pending |
| TBD-01-05 | 01 | 1 | DREAM-06 | — | dream_prune emit caps items at 10 | unit | `cargo test --lib voyager_log::tests::dream_prune_caps_items_at_10` | ❌ W0 | ⬜ pending |
| TBD-01-06 | 01 | 1 | DREAM-06 | — | All 3 dream_* emit helpers safe without AppHandle | unit | `cargo test --lib voyager_log::tests::dream_emit_helpers_safe_without_app_handle` | ❌ W0 | ⬜ pending |
| TBD-02-01 | 02 | 2 | DREAM-01 | T-24-02 | Stale skill last_used ≥91d → moved to .archived/ + DB row removed | unit | `cargo test --lib skills::lifecycle::tests::prune_archives_stale_skill` | ❌ W0 | ⬜ pending |
| TBD-02-02 | 02 | 2 | DREAM-02 | — | deterministic_merge_body — same inputs always produce same merged ForgedTool | unit | `cargo test --lib skills::lifecycle::tests::merge_body_deterministic` | ❌ W0 | ⬜ pending |
| TBD-02-03 | 02 | 2 | DREAM-02 | — | ensure_unique_name — collision suffixed with _v2 | unit | `cargo test --lib skills::lifecycle::tests::merge_name_collision_suffixed` | ❌ W0 | ⬜ pending |
| TBD-02-04 | 02 | 2 | DREAM-02 | — | 2 forged tools w/ identical traces + cosine ≥0.85 → pair flagged + .pending/ written | integration | `cargo test --lib skills::lifecycle::tests::consolidate_flags_identical_traces` | ❌ W0 | ⬜ pending |
| TBD-02-05 | 02 | 2 | DREAM-03 | — | 4-tool successful turn w/ no forged_tool_used → proposal written | integration | `cargo test --lib skills::lifecycle::tests::skill_from_trace_proposes` | ❌ W0 | ⬜ pending |
| TBD-02-06 | 02 | 2 | DREAM-03 | — | proposed_name from trace — same input → same name | unit | `cargo test --lib skills::lifecycle::tests::proposed_name_deterministic` | ❌ W0 | ⬜ pending |
| TBD-02-07 | 02 | 2 | DREAM-05 | — | abort within 1s — drive `dream_trigger_now` + flip DREAMING mid-prune | integration | `cargo test --lib dream_mode::tests::abort_within_one_second` | ❌ W0 | ⬜ pending |
| TBD-02-08 | 02 | 2 | DREAM-05 | — | per-step checkpoint — abort after #3 → 7 untouched | integration | `cargo test --lib skills::lifecycle::tests::prune_respects_dreaming_atomic` | ❌ W0 | ⬜ pending |
| TBD-03-01 | 03 | 3 | DREAM-04 | — | `skill_validator list` text output | CLI integration | `cargo test --bin skill_validator -- list_subcommand_text_format` | ❌ W0 | ⬜ pending |
| TBD-03-02 | 03 | 3 | DREAM-04 | — | `skill_validator list --json` structured 4-bucket output | CLI integration | `cargo test --bin skill_validator -- list_subcommand_json_format` | ❌ W0 | ⬜ pending |
| TBD-03-03 | 03 | 3 | DREAM-04 | — | `skill_validator list --diff <id>` — added/archived/consolidated | CLI integration | `cargo test --bin skill_validator -- list_diff_categorizes` | ❌ W0 | ⬜ pending |
| TBD-03-04 | 03 | 3 | DREAM-02 / DREAM-03 | — | Proactive_engine route — chat-injected prompt with embedded proposal_id | integration | `cargo test --lib skills::pending::tests::injected_prompt_includes_proposal_id` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Plan IDs renumber once gsd-planner assigns them; preserve REQ → Command mapping verbatim.*

---

## Wave 0 Requirements

- [ ] `src-tauri/src/skills/lifecycle.rs` — NEW module covers DREAM-01/-02/-03 pure logic
- [ ] `src-tauri/src/skills/pending.rs` — NEW module covers .pending/ queue read/write + content_hash dedup + 7-day auto-dismiss
- [ ] `tool_forge.rs` — append tests for `ensure_table_backfills_null_last_used`, `trace_hash_order_sensitive`, `record_tool_use_writes_invocation_row`
- [ ] `dream_mode.rs` — append `abort_within_one_second` integration test using `BLADE_CONFIG_DIR` + tempdir
- [ ] `voyager_log.rs` — extend existing `mod tests` (line 118+) with 4 new tests
- [ ] `session_handoff.rs` — append `skills_snapshot_serde_roundtrip` + `skills_snapshot_default_for_old_json`
- [ ] `bin/skill_validator.rs` — refactor: extract subcommand handlers into `pub` module entries (`mod handlers; pub fn run_list(...)` etc.) so they can be unit-tested without spawning subprocesses
- [ ] No new framework install; no new test config; no new dev-deps required (`tempfile`, `serial_test` already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chat-injected proactive merge prompt renders correctly in chat surface | DREAM-02 | UI rendering — UAT-deferred per chat-first pivot anchor (memory `feedback_chat_first_pivot.md`); cargo test asserts the queue + payload, not the chat-render | (deferred per CONTEXT.md D-24-B — UAT-only-on-runtime; operator-blessed pattern) |
| Chat-injected proactive skill-from-trace prompt renders correctly | DREAM-03 | Same as above | (deferred per CONTEXT.md D-24-B — UAT-only-on-runtime) |
| ActivityStrip emits `dream_mode:prune` / `:consolidate` / `:generate` rows during a real dream cycle | DREAM-06 | Cross-module emit observable; deterministic unit test verifies emit-helper shape, but cross-process JSONL row inspection is operator-deferred | Run dream_trigger_now() in dev mode after seeding 5+ stale forged_tools; observe ActivityStrip rows + verify `count` field |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5 min full suite
- [ ] `nyquist_compliant: true` set in frontmatter (set after planner finalizes Per-Task Verification Map with real plan IDs)

**Approval:** pending
