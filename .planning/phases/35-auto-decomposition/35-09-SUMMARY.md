---
phase: 35-auto-decomposition
plan: 9
subsystem: frontend-types
tags: [frontend, types, decomposition, payloads, ipc, deferred-consumer, static-gates]

# Dependency graph
requires:
  - phase: 33-08
    provides: "BladeLoopEventPayload discriminated union (kind-based) at src/lib/events/payloads.ts — Plan 35-09 extends this same union with 4 Phase 35 variants (no new event name; lives on the existing blade_loop_event channel)."
  - phase: 34-11
    provides: "Plan 34-11 added 4 Phase 34 variants (stuck_detected, circuit_open, cost_warning, cost_update) + halted scope mutation + the activity-log chip switch precedent. Plan 35-09 mirrors that extension shape exactly. Also established the typed Tauri wrapper convention in src/lib/tauri/sessions.ts (invokeTyped via _base.ts; D-13 / D-34 enforcement) — Plan 35-09 appends one more wrapper to the same file."
  - phase: 35-04
    provides: "Rust emit sites for subagent_started / subagent_progress / subagent_complete (decomposition::executor) — Plan 35-09 ships the typed counterpart so Plan 35-10's UI consumers compile clean."
  - phase: 35-07
    provides: "DecompositionComplete arm in commands.rs:2118-2137 emitting blade_loop_event { kind: 'decomposition_complete', subagent_count } — Plan 35-09 adds the matching TS variant."
  - phase: 35-08
    provides: "merge_fork_back Tauri command (commits 516bb56 + ebfa6c9) returning MergeResult { fork_id, parent_id, summary_text } — Plan 35-09 adds the typed JS wrapper around this command via invokeTyped."

provides:
  - "src/lib/events/payloads.ts BladeLoopEventPayload union extended with 4 Phase 35 variants: subagent_started, subagent_progress, subagent_complete, decomposition_complete. Field shapes mirror the Rust emit sites verbatim."
  - "src/lib/tauri/sessions.ts mergeForkBack(forkId): Promise<MergeResult> typed wrapper + MergeResult interface. Routes through invokeTyped per D-13 / D-34. Mirrors Rust struct src-tauri/src/session/list.rs::MergeResult exactly."
  - "src/features/activity-log/index.tsx exhaustiveness pass-through (4 new case labels with early-return). Defers chip rendering to Plan 35-10 — same posture cost_update uses today (Phase 34-11 precedent)."

affects: []

# Tech tracking
tech-stack:
  added: []  # Pure type/wrapper additions. No new dependencies.
  patterns:
    - "Pattern 1: discriminated-union extension via `kind` discriminant. Plan 35-09 follows the Phase 33-08 / 34-11 pattern exactly — new event variants land on the existing blade_loop_event channel rather than introducing a new event name. ActivityStrip / Plan 35-10 chip switch + (optional) SubagentProgressBubble narrow on `payload.kind` and forward-compat with `[k: string]: unknown` is NOT used here because the union members are explicitly typed (matching the Phase 33-08 strict-typing posture)."
    - "Pattern 2: deferred-consumer early-return in activity-log handler. cost_update established the precedent (Phase 34-11) — high-frequency or chip-deferred LoopEvent variants early-return inside the activity-log switch so the ring buffer doesn't churn with half-rendered rows. Plan 35-09 ports this to the 4 new Phase 35 variants until Plan 35-10 wires the actual chip switch + per-step throttling. The exhaustiveness check on the discriminated union catches missing cases at tsc time — without these 4 case labels, `action`/`summary` would be flagged as 'used before assigned'."
    - "Pattern 3: Rust struct truth wins over plan-body docstring hints. The plan body recommended a try/catch posture matching CLAUDE.md's frontend invoke pattern, but the existing Phase 34-11 wrappers in sessions.ts use `invokeTyped` (no try/catch — _base.ts::TauriError surfaces classified errors). Plan 35-09 matches existing precedent (D-13 / D-34: only permitted invoke surface, eslint-enforced)."

key-files:
  created: []
  modified:
    - "src/lib/events/payloads.ts (+ 4 Phase 35 BladeLoopEventPayload variants: subagent_started / subagent_progress / subagent_complete / decomposition_complete; +60 LOC including JSDoc references to emit sites)"
    - "src/features/activity-log/index.tsx (+ 4 case labels with early-return; defers chip rendering to Plan 35-10; preserves switch exhaustiveness so tsc stays clean)"
    - "src/lib/tauri/sessions.ts (+ MergeResult interface + mergeForkBack wrapper via invokeTyped; +44 LOC including JSDoc reference to src-tauri/src/session/list.rs::merge_fork_back)"

key-decisions:
  - "Added decomposition_complete as a 4th variant beyond the plan's specced 3. The plan body lists 3 variants (subagent_started/progress/complete) but the user prompt specced 4 including decomposition_complete (Plan 35-07's chip event). Rust source (commands.rs:2118-2137) ALREADY emits blade_loop_event { kind: 'decomposition_complete', subagent_count } — frontend consumers cannot type-check against this event without the variant in the union. Treated as Rule 2 (auto-add missing critical functionality): the Rust emit site shipped in Plan 35-07; the typed counterpart is a correctness requirement. Marking only the 3 plan-specced variants would have left a typed-event hole at the frontend boundary."
  - "MergeResult shape follows Rust truth (fork_id, parent_id, summary_text) — NOT the user prompt's hint (fork_id, parent_id, summary_excerpt, merged_at_ms). Per D-38-payload, the Rust serde struct is the authoritative source of IPC shapes; the user prompt's shape would have been wrong against src-tauri/src/session/list.rs::MergeResult (line 454). The 'fork_merged' LoopEvent payload separately carries a safe_slice'd excerpt for the activity strip — that's where summary_excerpt lives in the wire surface. The IPC return surfaces the FULL summary so the UI can render it in a confirmation toast / SessionsView merge-result panel without a second fetch. Plan 35-10 consumes this in the SessionsView Merge-back button."
  - "mergeForkBack signature uses single-arg (forkId) — NOT the user prompt's two-arg (parentId, forkId). Rust source: `pub async fn merge_fork_back(fork_id: String) -> Result<MergeResult, String>` (line 486). The parent_id is RESOLVED inside the Rust handler (looks up the fork JSONL's `parent` attribute); the frontend doesn't pass it. The user prompt's two-arg signature would have caused 'unexpected argument parent_id' on the IPC call."
  - "invokeTyped (no try/catch) matches Phase 34 precedent. The plan body's docstring suggested try/catch per CLAUDE.md, but existing wrappers (listSessions / resumeSession / forkSession / getConversationCost) all route through invokeTyped from _base.ts. Per D-13 / D-34: invokeTyped is the only permitted invoke surface (eslint-enforced via no-raw-tauri.js). _base.ts::TauriError already classifies and surfaces errors with a typed kind discriminator (not_found / bad_args / rust_error / unknown) — adding a try/catch wrapper on top would shadow the structured error and break the precedent for downstream callers."
  - "ActivityStrip chip switch extension is intentional scope-creep (Rule 3 — auto-fix blocking issue). The plan body restricts Plan 35-09 to two files (payloads.ts + sessions.ts), but extending the discriminated union without the 4 corresponding case labels makes tsc fail because `action`/`summary` are declared without initializers and only assigned inside case branches. Two options: (a) add the cases as early-returns (deferring chip rendering to Plan 35-10), or (b) initialize the variables to placeholder strings up-front. Chose (a) because it preserves the established cost_update precedent: high-frequency/chip-deferred variants bypass the activity-log ring buffer cleanly. Plan 35-10 will replace these early-returns with the real chip switch (with per-step throttling for subagent_progress)."

requirements-completed: [DECOMP-04, DECOMP-05]
# DECOMP-04: typed Tauri wrapper for merge_fork_back — frontend half complete here;
# Rust runtime path shipped in Plan 35-08. SessionsView 'Merge back' button
# (the sole call site) lands in Plan 35-10.
# DECOMP-05: BladeLoopEventPayload union extension — frontend half complete here;
# Rust emit sites shipped across Plans 35-04 (subagent_*) + 35-07
# (decomposition_complete). ActivityStrip chip switch + (optional)
# SubagentProgressBubble UI consumers wired in Plan 35-10.

# Metrics
duration: ~30min wall-clock (read source files + 2 edit cycles + 2 commits + 1 SUMMARY write; tsc --noEmit ~7s warm; no Rust recompile required)
completed: 2026-05-06
---

# Phase 35 Plan 35-09: DECOMP-05 BladeLoopEventPayload Subagent Variants + mergeForkBack Typed Wrapper Summary

**Frontend type substrate for Phase 35's sub-agent + decomposition + merge-back UX surfaces.** Two files extended, one file touched for switch exhaustiveness — all on the static-gate side of the wave. Plan 35-10 wires the actual ActivityStrip chip switch + SessionsView Merge-back button on top of these typed surfaces.

## Performance

- **Duration:** ~30min wall-clock
- **Started + completed:** 2026-05-06 (this session)
- **Tasks complete:** 2/2 atomic commits
- **Files modified:** 3 (2 plan-specced + 1 exhaustiveness pass-through caused by my own change)
- **LOC delta:** +119 / -1 across 3 files

## Accomplishments

### Task 1 — BladeLoopEventPayload union extended (commit `d19e4fc`)

Added 4 discriminated-union variants to `src/lib/events/payloads.ts` (lines 925-984):

```typescript
| { kind: 'subagent_started'; step_index: number; role: string; goal_excerpt: string }
| {
    kind: 'subagent_progress';
    step_index: number;
    status: 'running' | 'tool_call' | 'compacting' | 'verifying';
    detail?: string;
  }
| {
    kind: 'subagent_complete';
    step_index: number;
    success: boolean;
    summary_excerpt: string;
    subagent_session_id: string;
  }
| { kind: 'decomposition_complete'; subagent_count: number };
```

Each variant carries a JSDoc block referencing the Rust emit site (decomposition::executor for the 3 sub-agent variants per Plan 35-04; commands.rs:2118 for decomposition_complete per Plan 35-07).

**Exhaustiveness pass-through in `src/features/activity-log/index.tsx`** (line 213-218 area): added 4 case labels with early-return so the switch stays exhaustive over the now-extended union. Without this, tsc reports `action`/`summary` as 'used before assigned' at line 206-207 (the variables are declared without initializers and only assigned inside case branches; the new variants without cases would fall through with `action`/`summary` unassigned). Mirrors the cost_update deferred-consumer precedent established in Phase 34-11. Plan 35-10 replaces these stubs with the real chip switch (with per-step throttling for subagent_progress per CONTEXT lock §DECOMP-05).

### Task 2 — mergeForkBack wrapper + MergeResult interface (commit `c60fa0c`)

Appended to `src/lib/tauri/sessions.ts` (lines 144-187):

```typescript
export interface MergeResult {
  fork_id: string;
  parent_id: string;
  summary_text: string;
}

export function mergeForkBack(forkId: string): Promise<MergeResult> {
  return invokeTyped<MergeResult, { fork_id: string }>(
    'merge_fork_back',
    { fork_id: forkId },
  );
}
```

Routes through `invokeTyped` per D-13 / D-34 (the only permitted invoke surface; matches the precedent set by listSessions / resumeSession / forkSession / getConversationCost in Phase 34-11). Arg keys go through `_base.ts::toCamelArgs` so D-38 / P-04 arg-key casing drift is impossible at the IPC boundary.

## Acceptance Grep Verification

```
$ grep -c "kind: 'subagent_started'"           src/lib/events/payloads.ts          → 1
$ grep -c "kind: 'subagent_progress'"          src/lib/events/payloads.ts          → 1 (heads the multi-line variant)
$ grep -c "kind: 'subagent_complete'"          src/lib/events/payloads.ts          → 1 (heads the multi-line variant)
$ grep -c "kind: 'decomposition_complete'"     src/lib/events/payloads.ts          → 1

$ grep -c "subagent_started"                   src/lib/events/payloads.ts          → 2 (variant + JSDoc)
$ grep -c "subagent_progress"                  src/lib/events/payloads.ts          → 2 (variant + JSDoc)
$ grep -c "subagent_complete"                  src/lib/events/payloads.ts          → 2 (variant + JSDoc)
$ grep -c "decomposition_complete"             src/lib/events/payloads.ts          → 2 (variant + JSDoc)

$ grep -c "export interface MergeResult"       src/lib/tauri/sessions.ts           → 1
$ grep -c "export function mergeForkBack"      src/lib/tauri/sessions.ts           → 1
$ grep -c "merge_fork_back"                    src/lib/tauri/sessions.ts           → 2 (invoke target + JSDoc)

$ npx tsc --noEmit                                                                  → exit 0 (no output)
```

All Plan 35-09 acceptance criteria met (plus the user-prompt-specced decomposition_complete variant that was missing from the plan body).

**Variant line numbers in payloads.ts:**
- subagent_started:         L936
- subagent_progress:         L948-953 (multi-line)
- subagent_complete:         L964-970 (multi-line)
- decomposition_complete:    L984

**mergeForkBack line numbers in sessions.ts:**
- MergeResult interface:    L159-163
- mergeForkBack function:   L180-185

## Static-Gate Evidence Package (2026-05-06)

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` (post Task 1 with activity-log fix) | exit 0 |
| `npx tsc --noEmit` (post Task 2)                       | exit 0 |
| `git diff --diff-filter=D HEAD~1 HEAD` (post Task 1)   | empty (no deletions in commit) |
| `git diff --diff-filter=D HEAD~1 HEAD` (post Task 2)   | empty (no deletions in commit) |

## Task Commits

1. **Task 1 — BladeLoopEventPayload union extended + activity-log exhaustiveness pass-through** — `d19e4fc` (feat)
2. **Task 2 — mergeForkBack typed wrapper + MergeResult interface** — `c60fa0c` (feat)

(STATE.md / ROADMAP.md updates are NOT made by this executor per the prompt's hard constraint.)

## Deviations from Plan

**Three deviations:**

**1. [Rule 2 — Auto-add missing critical functionality] decomposition_complete variant added beyond the plan's 3-variant scope.**
- **Found during:** Plan body cross-referenced against user prompt + Rust emit-site grep.
- **Issue:** The plan body specs 3 variants (subagent_started / progress / complete). The user prompt specs 4, including `decomposition_complete { subagent_count }`. Rust source (commands.rs:2118-2137) ALREADY emits this event — Plan 35-07 (commit `3b1ac6f`) shipped the emit site weeks ago. Without the typed counterpart, frontend consumers (Plan 35-10's ActivityStrip) cannot type-check against the event payload — every `payload.kind === 'decomposition_complete'` branch would be flagged as a non-existent discriminant and `payload.subagent_count` access would error.
- **Fix:** Added the 4th variant `| { kind: 'decomposition_complete'; subagent_count: number }` with a JSDoc reference to the commands.rs:2118 emit site.
- **Rationale:** Rule 2 — typed counterparts to live Rust emit sites are correctness requirements, not features. Frontend cannot safely consume `decomposition_complete` events without the variant in the discriminated union. The plan's 3-variant scope was incomplete relative to shipped Rust runtime.
- **Files modified:** `src/lib/events/payloads.ts`
- **Committed in:** `d19e4fc`

**2. [Rule 3 — Auto-fix blocking issue] Activity-log exhaustiveness pass-through.**
- **Found during:** `npx tsc --noEmit` after Task 1 edit.
- **Issue:** `src/features/activity-log/index.tsx::handleLoopEvent` declares `let summary: string;` and `let action: string;` without initializers (lines 138-139), and only assigns inside case branches before using them at line 204-207 (`{ module: 'loop', action, human_summary: summary, ... }`). Adding 4 new variants to the discriminated union without matching cases means TS error TS2454 fires: 'Variable used before being assigned'. The plan body restricted Plan 35-09 to two files but the discriminated-union extension causes a tsc regression in a third file.
- **Fix:** Added 4 case labels (`case 'subagent_started':`, `case 'subagent_progress':`, `case 'subagent_complete':`, `case 'decomposition_complete':`) all falling through to a single `return;` — same deferred-consumer pattern `cost_update` uses today. Inline comment documents that Plan 35-10 wires the real chip switch + per-step throttling.
- **Rationale:** Rule 3 — fix blocking issue caused directly by my own change. Could not commit Task 1 with tsc errors. The fix follows the Phase 34-11 cost_update precedent exactly (early-return inside switch case = bypass activity-log ring buffer; alternative consumer subscribes separately later). Defers chip-rendering work cleanly to Plan 35-10 without surfacing half-rendered rows.
- **Files modified:** `src/features/activity-log/index.tsx`
- **Committed in:** `d19e4fc` (same commit as Task 1)

**3. [Rule 1 — Auto-fix bug] MergeResult shape + mergeForkBack signature follow Rust source, not user-prompt hint.**
- **Found during:** Cross-checking Rust source (`grep -n MergeResult src-tauri/src/session/list.rs`) against user prompt's specced shape.
- **Issue:** User prompt specced `MergeResult { fork_id, parent_id, summary_excerpt, merged_at_ms }` and `mergeForkBack(parentId, forkId)`. Rust source (line 454-458 + 486) is `MergeResult { fork_id: String, parent_id: String, summary_text: String }` and `merge_fork_back(fork_id: String)`. The plan body's section §interfaces matches Rust (`{fork_id, parent_id, summary_text}`); the user prompt was incorrect.
- **Fix:** Followed Rust truth verbatim. Field name is `summary_text` (not `summary_excerpt`); no `merged_at_ms` field; single-arg `mergeForkBack(forkId)` (parent_id is resolved inside the Rust handler by reading the fork JSONL's `parent` attribute).
- **Rationale:** Rule 1 — typed wrapper that doesn't match Rust IPC shape would crash on the first call: 'unexpected argument parent_id' on a 1-arg command, or 'missing field summary_text' on the deserialise. Per D-38-payload, Rust serde struct is the authoritative IPC source of truth. The 'fork_merged' LoopEvent payload separately carries a safe_slice'd excerpt — that's where summary_excerpt lives in the wire surface; the IPC return surfaces the full summary. Plan 35-10 (Merge-back button) renders `summary_text` in a confirmation toast.
- **Files modified:** `src/lib/tauri/sessions.ts`
- **Committed in:** `c60fa0c`

**Total deviations:** 3 (Rule 1 + Rule 2 + Rule 3 — all production-line corrections; consistent with the plan's threat register T-35-33 mitigation: 'tsc --noEmit catches downstream consumer mismatches at PR time').

## Issues Encountered

- **None blocking.** tsc --noEmit clean after each task. No regressions to Phase 34 wrappers (listSessions / resumeSession / forkSession / getConversationCost untouched). No Rust recompile required (this plan is pure TS).
- **Pre-existing repo-wide staged deletions (188 entries from `.planning/phases/00-*` and `.planning/phases/01-*` etc.) were NOT swept into either commit.** Used explicit `git add <specific path>` for both commits per the executor prompt's hard constraint. Verified post-commit via `git diff --diff-filter=D --name-only HEAD~1 HEAD` (empty for both).

## User Setup Required

None. Pure frontend type additions. No runtime path changes; no Rust touched; no UI changes (Plan 35-10 wires consumers).

## Next Phase Readiness

**Plan 35-10 (UI components) is unblocked.** Its imports compile cleanly:
- `import type { BladeLoopEventPayload } from '@/lib/events/payloads'` — narrows on `payload.kind === 'subagent_started' | 'subagent_progress' | 'subagent_complete' | 'decomposition_complete'`.
- `import { mergeForkBack, type MergeResult } from '@/lib/tauri/sessions'` — drives the SessionsView Merge-back button.

Plan 35-10's scope (per the user prompt's reference): ActivityStrip chip switch wiring (replacing Plan 35-09's early-returns with real chip rendering + per-step throttling for subagent_progress), SessionsView Merge-back button, optional SubagentProgressBubble.

Plan 35-11 (close + UAT) follows after Plan 35-10. No engineering follow-ups required from Plan 35-09.

## Threat Flags

None. The two threat-register entries from 35-09-PLAN.md (T-35-33 tampering / TS shape drift, T-35-34 tampering / arbitrary fork_id, T-35-35 information disclosure / summary_excerpt) are mitigated as the plan specifies:

- T-35-33 → tsc --noEmit catches downstream consumer mismatches; verified clean post-edit.
- T-35-34 → backend (Plan 35-08, list.rs:486) calls validate_session_id at entry; rejected fork_ids surface as Err with descriptive message. Frontend wrapper passes the id verbatim with no manipulation; backend is the security boundary.
- T-35-35 → summary_excerpt on subagent_complete is safe_slice'd to 120 chars at backend emit (Plan 35-04); intentional UX. Plan 35-09 carries the type only — no encoding decision happens here.

## Self-Check: PASSED

Verified post-summary:

- File `src/lib/events/payloads.ts` contains 4 new BladeLoopEventPayload variants (FOUND, all 4 `kind: 'X'` greps = 1 each at L936, L948, L964, L984).
- File `src/features/activity-log/index.tsx` switch handles 4 new variants via fall-through to `return;` (FOUND; tsc reports no TS2454 errors).
- File `src/lib/tauri/sessions.ts` exports `MergeResult` interface and `mergeForkBack` function (FOUND, =1 each at L159 + L180).
- File `src/lib/tauri/sessions.ts` `merge_fork_back` invoke target present (FOUND, =1 at L182).
- `npx tsc --noEmit` exits 0 with empty output.
- Commits `d19e4fc` and `c60fa0c` exist in `git log --oneline -3`.
- Per-task commits include no unintended deletions (`git diff --diff-filter=D HEAD~1 HEAD` empty for both commits — explicit `git add <path>` used; the 188 pre-existing repo-wide staged deletions were NOT swept into any commit).
- STATE.md and ROADMAP.md NOT modified by this executor (orchestrator's responsibility per the executor prompt's hard constraint).

## Phase 35 Plan Artifact Links

- 35-CONTEXT.md (DECOMP-04 / DECOMP-05 canonical decisions)
- 35-RESEARCH.md
- 35-04-PLAN.md / 35-04-SUMMARY.md (decomposition::executor + 3 subagent_* emit sites)
- 35-07-PLAN.md / 35-07-SUMMARY.md (DecompositionComplete arm + decomposition_complete chip emit at commands.rs:2118)
- 35-08-PLAN.md / 35-08-SUMMARY.md (merge_fork_back command + MergeResult Rust struct + JSONL append helpers)
- 35-09-PLAN.md (this plan)
- 35-10-PLAN.md (next — UI consumers: ActivityStrip chip switch + SessionsView Merge-back button + SubagentProgressBubble)
- 35-11-PLAN.md (phase close + UAT — runs after 35-10)

---
*Phase: 35-auto-decomposition*
*Plan 35-09 completed: 2026-05-06 (commits d19e4fc, c60fa0c)*
*Frontend type substrate for DECOMP-04 + DECOMP-05; UI consumers land in Plan 35-10*
