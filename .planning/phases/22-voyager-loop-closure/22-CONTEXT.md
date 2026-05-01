---
phase: 22
slug: voyager-loop-closure
milestone: v1.3
status: pre-plan
created: 2026-05-01T08:50Z
created_by: autonomous-handoff (after Phase 21 ship)
---

# Phase 22 — Voyager Loop Closure — CONTEXT

## Purpose

The load-bearing v1.3 substrate phase. Close the existing Voyager-shaped
wiring (immune_system → tool_forge → brain) end-to-end with:

1. SKILL.md export so Voyager output is agentskills.io-compliant
2. ActivityStrip emission per M-07 contract (4 phases)
3. Skill-write budget cap (VOYAGER-07)
4. Loop-failure recovery (VOYAGER-08)
5. Canonical `youtube_transcript` fixture (VOYAGER-04)
6. New `verify:voyager-loop` deterministic gate (VOYAGER-05)
7. Two-installs-diverge property test (VOYAGER-09)

## Why this phase

`voyager-loop-play.md` §"smallest viable demo" — the executable skill
library is BLADE's substrate-level differentiator vs Hermes (procedural
skill memory) / OpenClaw (tools without skills) / Cluely (recorder) /
Cursor (no skill library) / Open Interpreter (tool dispatcher).

The pieces all exist in v1.2. The work is **closing the loop into a
verifiable, M-07-compliant, agentskills.io-interop pipeline.**

## Plan list (recommended decomposition)

**8 plans across 3 waves** — same shape as Phase 21.

### Wave 1 (sequential — substrate)

| # | Plan slug | Scope | REQ-IDs | Depends on |
|---|---|---|---|---|
| **22-01** | `skill-md-export` | New helper `tool_forge::export_as_skill_md(forged: &ForgedTool) -> Result<PathBuf>` writes a SKILL.md at `<blade_config_dir>/skills/<name>/SKILL.md` using Phase 21 `mod skills` substrate. Symlinks/copies the existing tool_forge script into `<skill_dir>/scripts/<name>.<ext>`. Called inside `forge_tool` after DB insert success. | VOYAGER-02 (partial; the write half) | Phase 21 shipped |
| **22-02** | `activity-strip-emission` | Wire 4 emit points: `voyager:gap_detected` (immune_system entry), `voyager:skill_written` (forge_tool post-export), `voyager:skill_registered` (forge_tool post-DB-insert), `voyager:skill_used` (commands.rs tool-loop branch when a forged tool is invoked). Pattern: `app.emit_to("main", "blade_activity_log", ...)` per doctor.rs:730 precedent. | VOYAGER-06 | 22-01 |
| **22-03** | `budget-cap` | Add `voyager_skill_write_budget_tokens: u64` to `BladeConfig` (6-place rule). Inside `generate_tool_script`, estimate prompt tokens + max response tokens; refuse if >budget (default 50K). Return typed error variant `BudgetExceeded`. | VOYAGER-07 | 22-01 |

### Wave 2 (parallelizable after Wave 1)

| # | Plan slug | Scope | REQ-IDs | Depends on |
|---|---|---|---|---|
| **22-04** | `failure-recovery` | Track UndoStep Vec inside `forge_tool`; rollback in reverse on any post-first-side-effect error. Steps: remove script file, remove SKILL.md dir, DELETE forged_tools row. Re-log capability gap with `prior_attempt_failed=true`. | VOYAGER-08 | 22-01 |
| **22-05** | `deterministic-fixture` | Add `forge_tool_deterministic(capability, fixture)` test seam (gated `#[cfg(any(test, feature = "voyager-fixture"))]`); bypasses LLM, uses hard-coded fixture. Add canonical `youtube_transcript` fixture. End-to-end test asserts: gap → forge → SKILL.md present → DB row present → 4 ActivityStrip entries → re-issue resolves to new skill. | VOYAGER-01..04 (full), VOYAGER-06 | 22-02 |
| **22-06** | `divergence-property-test` | Two-installs property test: `tempfile`-isolated test runs with different `BLADE_CONFIG_DIR`; feed different gap streams; assert skill-manifest set differences non-empty in both directions. | VOYAGER-09 | 22-05 |

### Wave 3 (gate-closer)

| # | Plan slug | Scope | REQ-IDs | Depends on |
|---|---|---|---|---|
| **22-07** | `verify-voyager-loop-gate` | `scripts/verify-voyager-loop.sh` runs `cargo test --lib voyager::end_to_end_youtube_transcript` (gated behind `voyager-fixture` feature) + asserts 4 ActivityStrip entries via probe. Wired into `package.json` `verify:all` chain at tail (after `verify:skill-format`). Chain count 32 → 33. | VOYAGER-05 | 22-05, 22-06 |
| **22-08** | `phase-summary-and-close` | 22-PHASE-SUMMARY.md + 22-VERIFICATION.md + REQUIREMENTS.md/ROADMAP.md traceability. | (closes phase) | 22-01..07 |

## Sequencing

```
Wave 1 (sequential — substrate):
  22-01 skill-md-export
       │
       ▼
  22-02 activity-strip-emission
       │
       ▼
  22-03 budget-cap (parallel-ish; only depends on 22-01)

Wave 2 (after Wave 1):
  22-04 failure-recovery (depends on 22-01)
  22-05 deterministic-fixture (depends on 22-02)
  22-06 divergence-property-test (depends on 22-05)

Wave 3:
  22-07 verify-voyager-loop-gate
       │
       ▼
  22-08 phase-summary-and-close
```

22-01, 22-03, 22-04 can technically run in any order after Phase 21
shipped. Recommended Wave-1 sequencing optimizes for verifiable
intermediate state (export shipped → emission shipped → fixture works
out of the box).

## Reference inputs

**Phase 22 RESEARCH.md** — full audit of existing wiring.

**Existing modules to read before plan-write:**
- `src-tauri/src/tool_forge.rs` (lines 283-377 forge_tool body)
- `src-tauri/src/autoskills.rs` (line 169 try_acquire)
- `src-tauri/src/immune_system.rs` (line 83 forge_if_needed call site)
- `src-tauri/src/brain.rs` (line 1043 get_tool_usage_for_prompt)
- `src-tauri/src/evolution.rs` (line 1115 evolution_log_capability_gap)
- `src-tauri/src/doctor.rs` (lines 730-756 — ActivityStrip emit pattern)
- `src-tauri/src/skills/` (Phase 21 substrate — parser, types, validator)

**Convention references:**
- CLAUDE.md `## Critical Architecture Rules` — module reg, 6-place rule
- CLAUDE.md `## Verification Protocol` — runtime UAT for chat-functionality
- M-07 contract — every cross-module action emits to ActivityStrip

## Risks specific to Phase 22

| Risk | Mitigation |
|---|---|
| `forge_tool` LLM-bound; deterministic test path not yet present | Plan 22-05 lands `forge_tool_deterministic` as a test seam |
| ActivityStrip emit needs `&AppHandle` plumbed into `forge_tool` (currently `forge_tool(capability: &str)` — no app handle) | Add `app: &AppHandle` param to forge_tool; immune_system call site already has app handle from its emit pattern |
| Symlink-vs-copy of script file across platforms (Windows symlink quirks) | Use copy on Windows, symlink on Unix; or always copy (simpler, costs disk) |
| Existing `forged_tools` SQLite table doesn't include skill_md_path; if SKILL.md write succeeds and DB write fails, files orphan | Plan 22-04 (failure-recovery) addresses this with reverse-undo |
| Voyager fixture flakiness if YouTube fixture data changes | Use a frozen fixture (`include_str!("fixtures/youtube_response.json")`) — never live network |

## Phase verification target

**Static gates (post-phase, pre-Phase 23):**
- cargo check exits 0
- npx tsc --noEmit exits 0
- npm run verify:all 32 → 33 (verify:voyager-loop added)
- bash scripts/verify-voyager-loop.sh exits 0

**Runtime checks (light — substrate work):**
- Send a chat with `--feature voyager-fixture` enabled; observe gap → forge → SKILL.md → 4 ActivityStrip entries
- Re-issue same prompt; observe resolution to forged skill

## Notes for the operator on wake-up / next push

This CONTEXT is enough for `/gsd-plan-phase 22` (or hand-write per
21-01-harness-PLAN.md template) to expand into formal PLAN.md per plan.

If you want to skip the formal plan-writing and execute directly:
- Wave 1 should be sequential — 22-01 lands the export integrating with
  Phase 21 substrate; 22-02 lights up the ActivityStrip; 22-03 caps the
  budget
- Wave 2 lights up failure recovery + the canonical fixture + property
  test
- Wave 3 closes the gate + ships the phase

Recommended next concrete step: **execute Plan 22-01 (skill-md-export).**
It's the smallest atomic piece that integrates Phase 21's substrate with
the existing Voyager wiring. Once it lands, the rest of Phase 22 has
concrete shape.

---

*Phase 21 ✅ shipped 2026-05-01. Phase 22 RESEARCH + CONTEXT written
during the same morning push as autonomous handoff. Wake-up next-step:
hand-write or `/gsd-plan-phase 22` to expand 22-01..22-08 into formal
PLAN.md files; or execute 22-01 directly.*
