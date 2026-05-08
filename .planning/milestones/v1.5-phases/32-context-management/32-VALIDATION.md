---
phase: 32
slug: context-management
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-03
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust)** | `cargo test` (Rust 1.x, existing in BLADE — 435+ tests already passing) |
| **Framework (TS)** | `npx tsc --noEmit` (compile-only check; BLADE has no Vitest/Jest harness, intentional) |
| **Config file** | `src-tauri/Cargo.toml` (workspace + dev-deps) |
| **Quick run command** | `cd src-tauri && cargo test --lib --quiet -- context::` (only Phase 32 modules) |
| **Full suite command** | `cd src-tauri && cargo test --lib && cd .. && npx tsc --noEmit` |
| **Smart-path UAT** | `npm run tauri dev` + manual UAT script per CLAUDE.md Verification Protocol |
| **Estimated runtime** | ~30s (quick) / ~3min (full Rust) / ~90s (tsc) |

---

## Sampling Rate

- **After every task commit:** `cd src-tauri && cargo check` (cheap; ~30s on warm cache) — catches type / import drift only
- **After every plan wave:** `cd src-tauri && cargo test --lib` — full Rust test suite must be green
- **Before `/gsd-verify-work`:** Full suite green + runtime UAT screenshots saved to `docs/testing ss/`
- **Max feedback latency:** ~30s for unit tests, ~3min for full

---

## Per-Task Verification Map

> Filled in by the planner during Phase 32 planning. Each PLAN.md task gets a row here with its automated command + status. The seven requirements (CTX-01..07) below are placeholders the planner must expand into concrete task-level checks.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 32-XX-XX | XX   | X    | CTX-01 | — | Identity / vision / hearing sections only inject when relevance > gate | unit | `cargo test --lib brain::tests::section_gating` | ❌ W0 | ⬜ pending |
| 32-XX-XX | XX   | X    | CTX-02 | — | Thalamus relevance scoring callable for sections 0–8 | unit | `cargo test --lib brain::tests::score_context_relevance_all_sections` | ❌ W0 | ⬜ pending |
| 32-XX-XX | XX   | X    | CTX-03 | — | Compaction keeps first ~8k + last ~8k, summarises middle | unit | `cargo test --lib commands::tests::compress_keeps_head_and_tail` | ❌ W0 | ⬜ pending |
| 32-XX-XX | XX   | X    | CTX-04 | — | Compaction trigger = model_context_window × 0.80 | unit | `cargo test --lib commands::tests::compaction_trigger_at_80_percent` | ❌ W0 | ⬜ pending |
| 32-XX-XX | XX   | X    | CTX-05 | — | Tool output > cap is truncated to head + tail + summary | unit | `cargo test --lib commands::tests::tool_output_cap_applied` | ❌ W0 | ⬜ pending |
| 32-XX-XX | XX   | X    | CTX-06 | — | `get_context_breakdown` returns per-section token counts | unit | `cargo test --lib brain::tests::breakdown_records_per_section` | ❌ W0 | ⬜ pending |
| 32-XX-XX | XX   | X    | CTX-07 | — | Selective injection panic / NaN does NOT crash chat — fallback returns reply | unit | `cargo test --lib brain::tests::fallback_on_panic` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

> The planner must place these in Wave 1 (or a Wave 0 prep plan) before any feature plan can verify.

- [ ] `src-tauri/src/brain.rs` — extend test module with `mod tests` block (the file currently has no inline tests; new test stubs need a harness)
- [ ] `src-tauri/src/commands.rs` — add `mod tests` block with conversation fixture helpers (build_test_conversation(n_messages) returning `Vec<ConversationMessage>`)
- [ ] `src-tauri/src/config.rs` — add `mod tests` block to lock the new `ContextConfig` defaults + serde round-trip
- [ ] `src-tauri/tests/context_management_integration.rs` (NEW) — integration harness for the 7 CTX requirements end-to-end
- [ ] `src-tauri/Cargo.toml` — verify `[dev-dependencies]` has `tokio-test` (likely already present per existing test count); add if missing

---

## Manual-Only Verifications

> Per CLAUDE.md Verification Protocol — runtime UAT is mandatory and cannot be replaced by static gates. The v1.1 retraction is the load-bearing precedent.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Selective injection on simple query renders normal reply | CTX-01, CTX-02 | UI render path, observable only at runtime | `npm run tauri dev` → ask "what time is it?" → assert reply renders, screenshot DoctorPane breakdown showing identity/vision/hearing collapsed |
| Compaction fires at ~80% with status indicator | CTX-04 | Async + UI indicator visibility | Build a 100k-token conversation via repeated tool calls → confirm `blade_status: "compacting"` event in trace, conversation continues without stall |
| Tool output cap message visible in chat | CTX-05 | UI surfacing of truncation marker | Run a `bash` tool call returning `seq 1 50000` → assert chat shows truncation marker + summary, not 50k lines |
| DoctorPane breakdown panel renders + updates per turn | CTX-06 | Frontend render + IPC wiring | Open DoctorPane → send 3 different queries → confirm panel updates each time, screenshot at 1280×800 + 1100×700 |
| Fallback path: smart_injection_enabled=false renders reply | CTX-07 | Config toggle → branch behavior | Toggle config off in DoctorPane → send query → assert reply renders identical to current naive path; restore on |
| No regression in 37 existing verify gates | All | Cross-cutting stability | Run `npm run verify:all` → all 37 gates remain green |
| Screenshot evidence saved | All | CLAUDE.md hard rule | Save under `docs/testing ss/` (literal space) per phase verification |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for `cargo check`, < 3min for full suite
- [ ] Manual UAT step list matches CLAUDE.md Verification Protocol
- [ ] `nyquist_compliant: true` set in frontmatter (after planner expands per-task rows)

**Approval:** pending — planner expands per-task verify map, then re-set `nyquist_compliant: true`.
