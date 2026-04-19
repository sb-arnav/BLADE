---
phase: 06-life-os-identity
plan: 01
subsystem: events + prefs typed surface
tags: [phase-6, life-os, identity, events, payloads, usePrefs, types-only]
requires:
  - BLADE_EVENTS registry (Phase 1, src/lib/events/index.ts)
  - useTauriEvent sole-listener surface (D-13)
  - Prefs dotted-key discipline (Phase 1 D-12, src/hooks/usePrefs.ts)
  - Existing AgentEventPayload / AgentOutputPayload (Phase 5, src/lib/events/payloads.ts)
provides:
  - 11 new Phase 6 event constants on BLADE_EVENTS (life-os + identity lifecycle)
  - 11 new typed payload interfaces matching the Rust emit shapes
  - 5 new Phase 6 Prefs dotted keys (D-165)
affects:
  - src/lib/events/index.ts (+16 lines — 11 new constants + section banner)
  - src/lib/events/payloads.ts (+158 lines — 11 new exported interfaces + banner comment)
  - src/hooks/usePrefs.ts (+11 lines — 5 new Phase 6 dotted keys)
tech-stack:
  added: []
  patterns:
    - "index signature `[k: string]: unknown` on every Rust-emit payload interface (D-38-payload forward-compat)"
    - "dotted-key Prefs extension in the central Prefs interface (D-12)"
    - "JSDoc @see `src-tauri/src/<file>.rs:<line>` citation per interface (Pattern §1)"
    - "event constants include inline comment citing Rust emit file:line (drift audit aid)"
key-files:
  created: []
  modified:
    - src/lib/events/index.ts
    - src/lib/events/payloads.ts
    - src/hooks/usePrefs.ts
decisions:
  - D-142 (plan split) honored — 06-01 is a pure-TS wave-1 plan; zero Rust, zero wrapper, zero feature-folder overlap
  - D-162 (sparse Phase 6 event subscriptions) applied — added only emits that fire from scheduled loops or streaming commands where consumers benefit from subscription vs polling
  - D-165 (5 Phase 6 Prefs keys) applied verbatim — lifeOs + identity dotted keys
  - D-140 / D-144 (zero-Rust invariant) honored — no Rust files touched
  - D-143 (files_modified no-overlap) honored — did not touch 06-02's wrappers or feature folders
metrics:
  duration: "~15 min"
  commits: 3
  completed: 2026-04-18
---

# Phase 6 Plan 06-01: Events + Payloads + Prefs Type Surface — Summary

**One-liner:** Extended the BLADE_EVENTS registry and Prefs interface with 11 new Phase 6 life-os + identity event constants, 11 typed payload interfaces, and 5 new dotted-key Prefs — unblocking HealthView, EmotionalIntelView, AccountabilityView, PredictionsView, HabitView, GoalView, NegotiationView, ReasoningView subscription sites plus MeetingsView/FinanceView/PersonaView tab-memory — all pure TypeScript, zero Rust changes (D-140 + D-144).

## What Was Added

### Prefs dotted keys — `src/hooks/usePrefs.ts` (5 new)

Appended inside the `Prefs` interface, gated by a `// ───── Phase 6 (Plan 06-01, D-165) ─────` header, immediately before the forward-compat `[k: string]` index signature so TypeScript still widens unknown keys.

| Key                               | Type                            | Consumer (Phase 6)                      |
| --------------------------------- | ------------------------------- | --------------------------------------- |
| `lifeOs.activeTab`                | `string`                        | MeetingsView + FinanceView right-pane   |
| `lifeOs.health.unit`              | `'metric' \| 'imperial'`        | HealthView display conversion           |
| `lifeOs.finance.currency`         | `string` (ISO code)             | FinanceView Intl.NumberFormat default   |
| `identity.activeTab`              | `string`                        | PersonaView + NegotiationView tabs      |
| `identity.persona.expandedTrait`  | `string`                        | PersonaView deep-link memory            |

All five are optional — no default blob change, no migration path needed (D-12 single-blob discipline preserved).

### Event constants — `src/lib/events/index.ts` (11 new)

Appended inside a new `// ───── Phase 6 — Life OS + Identity lifecycle ─` section, before the closing `} as const;`. Values match the exact Rust emit strings verbatim.

| Constant                  | Value                    | Rust emit site                                  | Subscribe rationale                  |
| ------------------------- | ------------------------ | ----------------------------------------------- | ------------------------------------ |
| `BLADE_HEALTH_NUDGE`      | `blade_health_nudge`     | `health_tracker.rs:416,450,469`                 | Scheduled nudge loop                 |
| `HEALTH_BREAK_REMINDER`   | `health_break_reminder`  | `health_guardian.rs:150,160,180`                | Scheduled break reminder loop        |
| `BLADE_EMOTION_DETECTED`  | `blade_emotion_detected` | `emotional_intelligence.rs:753`                 | Independent valence-shift detection  |
| `ACCOUNTABILITY_NUDGE`    | `accountability_nudge`   | `accountability.rs:755,777`                     | Scheduled check-in + behind-KR       |
| `BLADE_PREDICTION`        | `blade_prediction`       | `prediction_engine.rs:589`                      | Background generation emits         |
| `BLADE_HABIT_REMINDER`    | `blade_habit_reminder`   | `habit_engine.rs:760`                           | Scheduled reminder loop              |
| `GOAL_PROGRESS`           | `goal_progress`          | `goal_engine.rs:810,975`                        | Async pursue loop streaming          |
| `GOAL_SUBTASK_UPDATE`     | `goal_subtask_update`    | `goal_engine.rs:389,403`                        | Per-subtask streaming                |
| `GOAL_COMPLETED`          | `goal_completed`         | `goal_engine.rs:623`                            | Verification-success terminal        |
| `BLADE_DEBATE_UPDATE`     | `blade_debate_update`    | `negotiation_engine.rs:519`                     | Streaming per debate round           |
| `BLADE_REASONING_STEP`    | `blade_reasoning_step`   | `reasoning_engine.rs:645,667`                   | Streaming per reasoning step         |

`BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS]` picks these up automatically — no separate union edit needed.

### Typed payload interfaces — `src/lib/events/payloads.ts` (11 new)

Appended in a new `Phase 6 Plan 06-01 additions` banner block after the Phase 5 agent/swarm section. Each interface carries `[k: string]: unknown` for forward-compat. JSDoc cites the Rust emit file:line.

| Interface                       | Key fields                                                          |
| ------------------------------- | ------------------------------------------------------------------- |
| `BladeHealthNudgePayload`       | `type`, `message`, `sleep_hours?`, `energy?`, `mood?`               |
| `HealthBreakReminderPayload`    | `urgency`, `streak_minutes`, `message`                              |
| `BladeEmotionDetectedPayload`   | `emotion`, `valence`, `arousal`, `confidence`, `signals?`           |
| `AccountabilityNudgePayload`    | `type`, `message`, `objective_id?`, `objective_title?`              |
| `BladePredictionPayload`        | Full `Prediction` mirror — `id`, `prediction_type`, `title`, `description`, `action?`, `confidence`, `time_window`, `was_helpful?`, `created_at`, `shown_at?`, `accepted` |
| `BladeHabitReminderPayload`     | `id`, `name`, `category?`, `streak?`, `target_time?`, `cue?`, `reward?` |
| `GoalProgressPayload`           | `id`, `title`, `status`, `attempts`, `subtasks_done`, `subtasks_total` |
| `GoalSubtaskUpdatePayload`      | `goal_id`, `subtask_description`, `result`                          |
| `GoalCompletedPayload`          | `id`, `title`, `result`                                             |
| `BladeDebateUpdatePayload`      | `session_id`, `round_num`, `round { user_argument?, opponent_argument?, blade_coaching? }` |
| `BladeReasoningStepPayload`     | `trace_id`, `step { step_num, thought, confidence, step_type, critiques[], revised? }` |

## Rust Emit Site Audit — Full Results

Audit scope: every Rust module cited in the plan's Task 2 `<read_first>` + a few adjacent modules. Audit method: `grep "emit_all\|emit_to\|\.emit\(" src-tauri/src/<module>.rs` and inspect context.

### Modules with NO emits (documented per plan Step 5 requirement)

| Module                          | Emits found | Phase 6 consumer strategy                                       |
| ------------------------------- | ----------- | --------------------------------------------------------------- |
| `character.rs`                  | 0           | Polling on action completion — CharacterBible refetches after `update_character_section` / `apply_reaction_to_traits` |
| `persona_engine.rs`             | 0           | Polling — PersonaView refetches after `persona_update_trait` / `persona_analyze_now` |
| `soul_commands.rs`              | 0           | Polling — SoulView refetches after `soul_refresh_bible` / `soul_take_snapshot` |
| `health.rs`                     | 0           | Polling — HealthView refetches after `health_scan_now`          |
| `financial_brain.rs`            | 0           | Polling — FinanceView refetches after `finance_import_csv` / `finance_auto_categorize` |
| `meeting_intelligence.rs`       | 0           | Polling — MeetingsView refetches after `meeting_process`        |
| `social_graph.rs`               | 0           | Polling — SocialGraphView refetches after CRUD actions          |
| `people_graph.rs`               | 0           | Polling — PersonaView "People" tab refetches after upsert       |
| `streak_stats.rs`               | 0           | Polling on route focus                                          |

### Modules with emits (all subscribed per D-162 benefit check)

| Module                          | Emits                                                                        | Consumer                      |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------- |
| `health_tracker.rs`             | `blade_health_nudge` (3 call sites)                                          | HealthView toast + nudge card |
| `health_guardian.rs`            | `health_break_reminder` (3 call sites)                                       | HealthView break banner       |
| `emotional_intelligence.rs`     | `blade_emotion_detected`                                                     | EmotionalIntelView live card  |
| `accountability.rs`             | `accountability_nudge` (2 call sites)                                        | AccountabilityView toast      |
| `prediction_engine.rs`          | `blade_prediction`                                                           | PredictionsView live insert   |
| `habit_engine.rs`               | `blade_habit_reminder`                                                       | HabitView reminder toast      |
| `goal_engine.rs`                | `goal_progress` (2), `goal_subtask_update` (2), `goal_completed` (1)         | GoalView pursue-live panel    |
| `negotiation_engine.rs`         | `blade_debate_update`                                                        | NegotiationView debate round  |
| `reasoning_engine.rs`           | `blade_reasoning_step` (2 call sites)                                        | ReasoningView step stream     |

**Benefit check rationale:** All 11 emits fire from either scheduled background loops (health nudges, break reminders, habit reminders, accountability check-ins) or streaming long-running commands (goal_pursue_now, debate rounds, reasoning steps, prediction generation, emotion detection on valence shift). In both cases, the event is NOT a direct response to a single user action — polling on action completion would miss them or require a busy-loop. Per D-162, these warrant subscription; the 9 no-emit modules stay on polling.

## Files Touched

| File                           | Status   | Net lines | Commit    |
| ------------------------------ | -------- | --------- | --------- |
| `src/hooks/usePrefs.ts`        | modified | +11       | `7f095b3` |
| `src/lib/events/index.ts`      | modified | +16       | `fdd30cd` |
| `src/lib/events/payloads.ts`   | modified | +158      | `98cc429` |

**Total:** 3 files, +185 net lines. Slightly above the plan's "~20-40 net new lines" estimate because the audit found 11 events (plan assumed 0-5) — the event registry + payload block expanded accordingly. All additions are pure type plumbing; zero runtime impact.

## Files NOT Touched (scope discipline)

- `src-tauri/**` — zero Rust edits (D-140 + D-144).
- `src/lib/tauri/life_os.ts` + `src/lib/tauri/identity.ts` — 06-02 lane; not created.
- `src/features/life-os/**`, `src/features/identity/**` — 06-03..06 lanes.
- `src/features/life-os/index.tsx` + `src/features/identity/index.tsx` — 06-02 owns the one-time rewrite (D-143 single-writer invariant).
- `.planning/STATE.md` + `.planning/ROADMAP.md` — orchestrator's job, not this plan.
- `scripts/**` — Plan 06-07 owns verify-script additions.

## Verification

| Check                                                                  | Result                    |
| ---------------------------------------------------------------------- | ------------------------- |
| `grep -c "lifeOs.\|identity." src/hooks/usePrefs.ts`                   | **5** (exact match)       |
| `grep -c "^  BLADE_HEALTH_NUDGE\|^  HEALTH_BREAK_REMINDER\|…" index.ts` | **11** (exact match)      |
| `grep -c "^export interface Blade…\|^export interface Goal…" payloads.ts` | **11** (exact match)   |
| `npx tsc --noEmit`                                                     | **clean** (zero errors)   |
| `npm run verify:all`                                                   | **10/10 GREEN**           |

### `verify:all` breakdown (all PASS)

1. `verify:no-raw-tauri` — no raw `@tauri-apps/api/core` or `/event` imports outside allowed paths.
2. `verify:migration-ledger` — 89 ledger rows loaded, 11 referenced ids tracked.
3. `verify:emit-policy` — 59 broadcast emits match cross-window allowlist.
4. `verify:contrast` — all strict glass pairs ≥ 4.5:1.
5. `verify:chat-rgba` — no `backdrop-filter` inside `src/features/chat` (D-70 preserved).
6. `verify:ghost-no-cursor` — no `cursor` in ghost surfaces (D-09 preserved).
7. `verify:orb-rgba` — no `backdrop-filter` on orb (D-07/D-18/SC-2 preserved).
8. `verify:hud-chip-count` — exactly 4 `hud-chip hud-*` classes (HUD-02 preserved).
9. `verify:phase5-rust` — all 75 Phase 5 Rust commands registered.
10. `verify:feature-cluster-routes` — all 18 Phase 5 routes present; clusters wired via lazy imports.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's Task 2 explicitly allowed for either "add N constants after audit" OR "document audit + skip additions"; the audit found 11 qualifying emits so we took the "add" path. Every field name, every payload signature, every prefs key matched what the plan specified or the Rust source. TypeScript compiled cleanly on first try; verify:all stayed 10/10 green. Zero auto-fixes (Rules 1–3) applied to production code, zero architectural decisions (Rule 4), zero authentication gates.

### Minor self-correction during execution (not a plan deviation)

During the initial edit to `src/lib/events/index.ts`, I introduced a transient placeholder constant name (`AGENT_STEP_COMPLETED_EXECUTOR`) in place of the existing Phase 5 `AGENT_STEP_COMPLETED` + `AGENT_STEP_FAILED` constants. I caught this before committing — the subsequent edit restored both Phase 5 constants exactly and only the Phase 6 additions were committed. Post-commit `grep` on the final file confirms both Phase 5 constants are present and unmodified.

## Drift Concerns Noted While Reading

- `habit_engine.rs:760` uses `app.emit(...)` (global emit) while most other life-os modules use `app.emit_to("main", ...)`. Both produce the same frontend event name; `useTauriEvent` subscribes on the main window either way. No action needed but noted for Plan 06-07's verify script in case an emit-policy rule wants to enforce `emit_to("main", ...)` for consistency.
- `health_guardian.rs` similarly uses `app.emit(...)` (not `emit_to`). Same note.
- `prediction_engine.rs:589` passes the full `Prediction` struct directly (not a `serde_json::json!` wrapper). `BladePredictionPayload` mirrors the full struct shape; if a future Rust refactor narrows the emit to a subset, the payload interface's optional fields + index signature keep consumers compiling.
- `negotiation_engine.rs`'s `DebateRound` struct is not publicly imported anywhere else in the frontend today; I kept `BladeDebateUpdatePayload.round` shape loose (`user_argument?`, `opponent_argument?`, `blade_coaching?` + `[k: string]: unknown`) so 06-06 NegotiationView can type-narrow as needed.
- `reasoning_engine.rs`'s `StepEvent` wraps `ReasoningStep`; `BladeReasoningStepPayload` mirrors `StepEvent` (not `ReasoningStep` directly) so the `trace_id` envelope is preserved. Confirmed by reading `reasoning_engine.rs:49` struct definition.

## Impact on Wave-1 + Wave-2 Plans

**Plan 06-02 (wrappers + index.tsx rewrites)** can now:
- Import any of the 11 new event constants by name without adding to BLADE_EVENTS itself.
- Re-export payload types from `src/lib/events/payloads.ts` via existing `export type * from './payloads'` in index.ts.
- Use the 5 new Prefs keys via `usePrefs().setPref('lifeOs.activeTab', ...)` without TS errors.

**Plans 06-03..06 (feature surfaces)** can reference:
- `useTauriEvent<BladeHealthNudgePayload>(BLADE_EVENTS.BLADE_HEALTH_NUDGE, …)` in HealthView (Plan 06-03).
- `useTauriEvent<GoalProgressPayload>(BLADE_EVENTS.GOAL_PROGRESS, …)` in GoalView (Plan 06-03).
- `useTauriEvent<BladeDebateUpdatePayload>(BLADE_EVENTS.BLADE_DEBATE_UPDATE, …)` in NegotiationView (Plan 06-05).
- `useTauriEvent<BladeReasoningStepPayload>(BLADE_EVENTS.BLADE_REASONING_STEP, …)` in ReasoningView (Plan 06-06).
- etc.

**Plan 06-07 (Playwright + verify)** can:
- Optionally extend `verify-phase6-rust-surface.sh` to grep both `lib.rs` registrations AND emit-string matches for the 11 new constants (belt-and-suspenders drift detection per T-06-01-03).

## TDD Gate Compliance

N/A — plan type is `execute` (not `tdd`). Tasks are type additions with no runtime behavior to test; verification is `tsc --noEmit` + `verify:all` rather than unit tests.

## Known Stubs

None. Every addition is fully wired — payload interfaces are complete shapes mirroring Rust source, Prefs keys are optional but typed, event constants are strings usable at subscription sites.

## Threat Flags

None. No new network endpoints, no new auth paths, no new file-access patterns, no schema changes. Pure TS type additions. The accepted drift risk (T-06-01-01) is unchanged from the plan's threat model.

## Self-Check: PASSED

Verified:
- `src/hooks/usePrefs.ts` — 5 new dotted keys present (grep count 5).
- `src/lib/events/index.ts` — 11 new Phase 6 constants present (grep count 11); Phase 5 `AGENT_STEP_COMPLETED` + `AGENT_STEP_FAILED` still present and unmodified.
- `src/lib/events/payloads.ts` — 11 new exported interfaces present (grep count 11).
- Commit `7f095b3` — present in `git log --oneline`.
- Commit `fdd30cd` — present in `git log --oneline`.
- Commit `98cc429` — present in `git log --oneline`.
- `npx tsc --noEmit` — exit 0.
- `npm run verify:all` — exit 0 with OK from all 10 scripts.

All claimed artifacts exist, all claimed commits exist, all claimed verifications pass.
