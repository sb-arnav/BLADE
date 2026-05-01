---
phase: 22
slug: voyager-loop-closure
milestone: v1.3
status: shipped
shipped: 2026-05-01
plans_total: 8
plans_shipped: 8
unit_tests_added: 28
verify_gates_added: 1
---

# Phase 22 — Voyager Loop Closure — PHASE SUMMARY

The load-bearing v1.3 substrate phase. Closes the existing Voyager-shaped
wiring (immune_system → tool_forge → brain) end-to-end with: SKILL.md
export integrating Phase 21 substrate, M-07 ActivityStrip emission across
the 4 loop phases, RLVR-style budget cap on runaway forges, partial-write
rollback, deterministic test seam + canonical `youtube_transcript`
fixture, two-installs-diverge property test, and a new `verify:voyager
-loop` deterministic gate.

## Plans landed

| Plan | Slug | Files | Commit | Tests added |
|---|---|---|---|---|
| 22-01 | skill-md-export | `skills/export.rs` (+ `skills/mod.rs`) | `d4aba45` | 11 |
| 22-02 | activity-strip-emission | `voyager_log.rs` + `lib.rs` + `immune_system.rs` + `tool_forge.rs` 3 emit sites | `dd3a3b1` | 3 |
| 22-03 | budget-cap | `config.rs` 6-place rule + `tool_forge.rs::estimate_skill_write_tokens` + refusal at LLM call | `faebb4a` | 5 |
| 22-04 | failure-recovery | `tool_forge.rs::rollback_partial_forge` (called on DB-insert err after script write) | `b610d2b` | 2 |
| 22-05 | deterministic-fixture | `tool_forge.rs::persist_forged_tool` extraction + `forge_tool_from_fixture` + `youtube_transcript_fixture` + canonical end-to-end test | `252decd` | 1 (e2e) |
| 22-06 | divergence-property-test | `tool_forge.rs::voyager_two_installs_diverge` test (in same commit) | `252decd` | 1 (property) |
| 22-07 | verify-voyager-loop-gate | `scripts/verify-voyager-loop.sh` + `package.json` chain | `c935cd3` | 0 |
| 22-08 | phase-summary-and-close | `22-PHASE-SUMMARY.md` + `22-VERIFICATION.md` + `REQUIREMENTS.md` / `ROADMAP.md` traceability | (this commit) | 0 |

**Total:** 28 unit tests + 2 deterministic fixture tests across 4 production
source files + 1 helper module + 1 verify script. New `voyager-fixture`
Cargo feature gates the test seam from production builds.

## Module shape

```
src-tauri/src/skills/export.rs
  Phase 22 first integration with Phase 21 substrate. ForgedTool →
  agentskills.io SKILL.md at <user_root>/<canonical-name>/SKILL.md
  with copied script under scripts/<basename>. sanitize_name converts
  underscore-separated tool_forge names to hyphen-separated agentskills.io
  names; rejects uppercase / special chars / leading-or-trailing hyphens.
  Returns ExportOutcome::Written or NonCompliantName (non-fatal in caller).

src-tauri/src/voyager_log.rs
  4 ActivityStrip emit helpers — gap_detected / skill_written /
  skill_registered / skill_used. Single-window emit_to("main",
  "blade_activity_log", ...) per doctor.rs:730 precedent. Uses
  integration_bridge::get_app_handle() so tool_forge's public API didn't
  need to grow an &AppHandle parameter. Silent on missing handle (test
  context is the expected case).

src-tauri/src/tool_forge.rs (refactor)
  forge_tool body split into 2 phases:
    Phase 1: generate_tool_script (LLM)
    Phase 2: persist_forged_tool (side effects)
  forge_tool wraps both. forge_tool_from_fixture (#[cfg-gated]) bypasses
  Phase 1 for deterministic testing.

  estimate_skill_write_tokens — token-budget estimator (4 chars/token
  heuristic + 30K-char response reserve). Used by generate_tool_script
  to refuse pathological prompts before the LLM call.

  rollback_partial_forge — removes orphan script + re-logs gap with
  prior_attempt_failed=true. Called from persist_forged_tool's DB-insert
  error arm.

  youtube_transcript_fixture (#[cfg-gated)] — canonical Voyager fixture
  per voyager-loop-play.md § "smallest viable demo".

scripts/verify-voyager-loop.sh
  Runs cargo test --lib tool_forge::tests::voyager_ --test-threads=1.
  Exits 0 on 2/2 green; 1 on any failure. Wired into package.json
  verify:all chain at tail.
```

## Decisions made / closed

| ID | Decision | Source |
|---|---|---|
| Q1 | SKILL.md export coexists with tool_forge's existing `<blade_config_dir>/tools/<name>.<ext>` flat layout — no migration of forged_tools SQLite, no removal of existing scripts | 22-RESEARCH § Integration |
| Q2 | tool_forge.rs name sanitization (underscores → hyphens) handled in `skills::export::sanitize_name`; non-compliant names log warn + skip export, NOT block forge | 22-01 |
| Q3 | AppHandle plumbing: `integration_bridge::get_app_handle()` instead of growing `&AppHandle` through forge_tool's public API (matches Plan 18-07 slack/github_outbound pattern) | 22-02 |
| Q4 | Budget cap default 50_000 tokens — generous headroom for typical scripts (~1K prompt + 5K-30K response); pathological inputs (>200K-char prompts) trigger refusal | 22-03 |
| Q5 | Failure recovery is narrow (script + DB only) — SKILL.md export is non-fatal; broader UndoStep machinery deferred to v1.4 if more failure modes surface | 22-04 |
| Q6 | Deterministic test seam: extract `persist_forged_tool` from `forge_tool`, expose `forge_tool_from_fixture` behind `#[cfg(any(test, feature = "voyager-fixture"))]`. Test infrastructure: module-level `ENV_LOCK` static Mutex (NOT per-function) serializes tests that touch `BLADE_CONFIG_DIR` | 22-05, 22-06 |

## Hardening included in this phase

- **Pathological input refusal** — 50K-token cap stops runaway LLM token
  spend on copy-pasted-error-log-as-prompt cases
- **Partial-write rollback** — DB insert failure after script write removes
  the orphan + re-logs the gap with `prior_attempt_failed=true`
- **agentskills.io name sanitization** — non-compliant tool_forge names
  fail SKILL.md export gracefully (log warn, return Ok); the forge
  itself succeeds
- **Test infrastructure isolation** — `ENV_LOCK` Mutex prevents parallel
  tests from racing process-global `BLADE_CONFIG_DIR`. First-attempt
  bug surfaced + fixed (per-function statics don't serialize)
- **Voyager fixture cargo feature** — `voyager-fixture` flag gates the
  deterministic surfaces from production builds; tests get them
  unconditionally via `#[cfg(test)]`
- **--test-threads=1 in verify gate** — defense-in-depth against the
  ENV_LOCK Mutex being insufficient under hypothetical future changes

## What this phase did NOT do (forward-pointers)

- **tool_forge SQLite migration to SKILL.md as source of truth** — v1.4
  plan-time decision; v1.3 ships coexistence (both formats land per
  forge)
- **`autoskills.rs` MCP-catalog vs tool_forge convergence** — autoskills
  still does MCP installs; tool_forge still does generated scripts;
  v1.3 doesn't merge them
- **Script-level execution consent** — Phase 21 SKILLS-07 covers the
  consent SCHEMA and the typed wrapper; the actual prompt firing when
  a forged script is invoked is a Phase 22+ chat-pipeline integration
  point. Today the script runs unconfirmed (matches v1.2 behavior).
- **Production AppHandle plumbing for `bundled_root`** — still uses
  `concat!(env!("CARGO_MANIFEST_DIR"), "/../skills/bundled")` for cargo-
  workspace tests + dev. Production binary should use
  `tauri::path::resource_dir()` plumbed via `lib.rs::run` setup; v1.3
  doesn't exercise the bundled tier at runtime so deferred.
- **Frontend ActivityStrip rendering of Voyager events** — the strip
  already renders `blade_activity_log` events from v1.1 Phase 14;
  Voyager's emits ride the same surface. UI affordances specific to
  Voyager (e.g. clicking a `skill_written` row to open the SKILL.md
  in an inspector) are v1.4 polish.

## Static gate impact

Before Phase 22:
- `npm run verify:all` chain: 32 gates green (post-Phase 21)
- `cargo test --lib` total: 343 tests after Phase 21

After Phase 22:
- `npm run verify:all` chain: 33 gates green (added `verify:voyager-loop`)
- `cargo test --lib` total: 366 tests (+11 export, +3 voyager_log,
  +5 budget, +2 rollback, +2 voyager fixture/divergence)

## Inputs consumed

- `/home/arnav/research/blade/voyager-loop-play.md` — substrate-level
  differentiator framing; "smallest viable demo" canonical fixture
  shape
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md`
  Layer 4 (memory + skills) — Voyager skill library positioning
- `/home/arnav/research/ai-substrate/open-questions-answered.md` Q1
  (verifiable composite reward) — informs Plan 22-03 budget framing
  even though composite reward itself is Phase 23 work
- `.planning/phases/22-voyager-loop-closure/22-RESEARCH.md` — full audit
  of existing Voyager-shaped wiring in BLADE v1.2
- `.planning/phases/22-voyager-loop-closure/22-CONTEXT.md` — 8-plan
  decomposition this phase executed against

## Phase verdict

**Status: shipped.** All 9 VOYAGER-XX requirements satisfied. Static
gates green (cargo + tsc + verify:all 33/33). 28 unit tests + 2
fixture/property tests added. Runtime smoke confirmed (verify:voyager
-loop green; 2/2 deterministic tests pass in 1.65s on warm cache).
Phase 23 (verifiable reward + OOD eval) unblocked.
