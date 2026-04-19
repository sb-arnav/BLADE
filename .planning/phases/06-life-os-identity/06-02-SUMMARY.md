---
phase: 06-life-os-identity
plan: 02
subsystem: frontend-plumbing
tags: [tauri-wrappers, cluster-scaffold, lazy-routes, css-base]
requires:
  - Phase 1 GlassPanel primitive
  - Phase 1 _base.ts invokeTyped
  - Phase 1 tokens.css (--s-N, --r-md, --r-pill, --ease-out, --line, --line-strong, --t-1..--t-3, --font-mono, --font-display)
  - Phase 5 Plan 05-02 status tokens (--status-idle/running/success/error)
  - Phase 5 barrel convention (src/lib/tauri/index.ts namespace re-exports)
provides:
  - src/lib/tauri/life_os.ts (97 typed wrappers across 14 Rust modules)
  - src/lib/tauri/identity.ts (60 typed wrappers across 9 Rust modules)
  - src/features/life-os/types.ts (cluster-local type barrel)
  - src/features/identity/types.ts (cluster-local type barrel)
  - src/features/life-os/life-os.css (cluster-scoped base — life-surface, life-card, life-stat-grid, life-tab-pill)
  - src/features/identity/identity.css (cluster-scoped base — identity-surface, identity-card, identity-tabs, identity-tab-pill, identity-edit-textarea)
  - 9 life-os placeholder components (HealthView, FinanceView, GoalView, HabitView, MeetingsView, SocialGraphView, PredictionsView, EmotionalIntelView, AccountabilityView)
  - 7 identity placeholder components (SoulView, PersonaView, CharacterBible, NegotiationView, ReasoningView, ContextEngineView, SidecarView)
  - Rewritten life-os + identity index.tsx with lazy imports of the 16 placeholder components
  - Extended src/lib/tauri/index.ts barrel with `lifeOs` + `identity` namespace re-exports
affects:
  - Consumers of src/features/life-os/* / src/features/identity/* — ROUTE_MAP + NavRail + palette derive cluster labels from the two index.tsx files; route order preserved so nav ordering doesn't shift
tech-stack:
  added: []  # no new deps
  patterns:
    - D-139 per-cluster wrapper module (Phase 5 D-118 inherited)
    - D-140 zero-Rust invariant (Phase 5 D-119 inherited)
    - D-143 single-writer index.tsx (Phase 5 D-122 inherited)
    - D-159/D-38 camelCase → snake_case at invokeTyped boundary
    - D-160 [k: string]: unknown index signature on every interface
    - D-161 cluster-local types barrel
    - D-163 per-route file layout
    - D-164 one cluster CSS file, appended by downstream plans
key-files:
  created:
    - src/lib/tauri/life_os.ts
    - src/lib/tauri/identity.ts
    - src/features/life-os/types.ts
    - src/features/identity/types.ts
    - src/features/life-os/life-os.css
    - src/features/identity/identity.css
    - src/features/life-os/HealthView.tsx
    - src/features/life-os/FinanceView.tsx
    - src/features/life-os/GoalView.tsx
    - src/features/life-os/HabitView.tsx
    - src/features/life-os/MeetingsView.tsx
    - src/features/life-os/SocialGraphView.tsx
    - src/features/life-os/PredictionsView.tsx
    - src/features/life-os/EmotionalIntelView.tsx
    - src/features/life-os/AccountabilityView.tsx
    - src/features/identity/SoulView.tsx
    - src/features/identity/PersonaView.tsx
    - src/features/identity/CharacterBible.tsx
    - src/features/identity/NegotiationView.tsx
    - src/features/identity/ReasoningView.tsx
    - src/features/identity/ContextEngineView.tsx
    - src/features/identity/SidecarView.tsx
  modified:
    - src/features/life-os/index.tsx  (Phase 1 skeleton → lazy-import real components)
    - src/features/identity/index.tsx (Phase 1 skeleton → lazy-import real components)
    - src/lib/tauri/index.ts           (added lifeOs + identity namespace re-exports)
decisions:
  - Followed D-143 single-writer invariant exactly — Plan 06-02 is the ONLY plan that edits the two index.tsx files; downstream plans replace the BODY of the 16 per-route placeholders without touching the registries.
  - Did not redeclare status tokens — Phase 5 Plan 05-02 already introduced `--status-idle/running/success/error`; Phase 6 CSS reuses verbatim per D-132.
  - Aligned CSS token names with the actual project tokens (`--s-N` / `--r-md` / `--r-pill` / `--line-strong`) rather than the plan draft's hypothetical names (`--sp-N` / `--radius-card` / `--radius-pill` / `--line`).
metrics:
  duration-minutes: ~40
  completed-date: 2026-04-19
  tasks-completed: 3
  commits: 3
  files-created: 22
  files-modified: 3
  lines-added: ~3100
---

# Phase 6 Plan 06-02: Life OS + Identity Wrappers + Cluster Scaffolding Summary

Created the two per-cluster Tauri wrapper modules + rewrote both cluster feature `index.tsx` files with lazy imports + seeded 16 minimal per-route placeholder components + 2 cluster CSS bases + 2 type-re-export barrels + barrel update — all the plumbing Plans 06-03..06 need to fill in route bodies without stepping on each other.

## Wrapper Counts

| Cluster | File                              | Wrapper functions | `@see` JSDoc lines | `invokeTyped` call sites |
|---------|-----------------------------------|-------------------|--------------------|---------------------------|
| Life OS | `src/lib/tauri/life_os.ts`        | **97**            | 127                | 99                        |
| Identity| `src/lib/tauri/identity.ts`       | **60**            | 84                 | 62                        |
| **Total** |                                 | **157**           | 211                | 161                       |

(Plan targets: ~110 life-os + ~40 identity = ~150. Actual 157 — within tolerance; the D-140 inventory undercounted some command surfaces and overcounted `persona_engine` by one. Accuracy over draft numbers.)

## Life OS → Rust Module Mapping

| Rust module (file)                  | Commands registered | Wrappers exported | Notes |
|-------------------------------------|---------------------|-------------------|-------|
| `health_tracker.rs`                 | 9                   | 9                 | `healthLog` passes the full `HealthLog` struct (not a kwargs object) — Rust signature clarification |
| `health.rs`                         | 3                   | 3                 | Project-scan commands |
| `health_guardian.rs`                | 2                   | 2                 | Both return `serde_json::Value` — typed as `Record<string, unknown>` aliases |
| `financial_brain.rs`                | 15                  | 15                | All 15 wired including CSV import + auto-categorize |
| `goal_engine.rs`                    | 6                   | 6                 | `goal_pursue_now` has an AppHandle-managed param — frontend passes id only |
| `habit_engine.rs`                   | 10                  | 10                | `habit_get_today` returns `Vec<(Habit, bool)>` — surfaced as tuple arrays |
| `meeting_intelligence.rs`           | 10                  | 10                | `meeting_get_action_items` takes no args (global open items list) |
| `social_graph.rs`                   | 11                  | 11                | Full contact CRUD + interactions + insights |
| `prediction_engine.rs`              | 6                   | 6                 | `prediction_generate_now` has an AppHandle-managed param |
| `emotional_intelligence.rs`         | 5                   | 5                 | — |
| `accountability.rs`                 | 8                   | 8                 | OKRs + daily actions + checkin + progress report |
| `streak_stats.rs`                   | 3                   | 3                 | — |
| `people_graph.rs`                   | 7                   | 7                 | `people_get(name)` — lookup by name; `people_delete(id)` — mutation by id |
| `learning_engine.rs`                | 1 (in D-140 scope)  | 1                 | Only `learning_get_predictions` is in Phase 6 scope; the other 3 stay unwrapped |
| `temporal_intel.rs`                 | 1 (in D-140 scope)  | 1                 | Only `temporal_meeting_prep(topic)` — takes a topic string (not meeting_id) |
| **Total**                           | **97**              | **97**            | |

## Identity → Rust Module Mapping

| Rust module (file)          | Commands registered | Wrappers exported | Notes |
|-----------------------------|---------------------|-------------------|-------|
| `character.rs`              | 7                   | 7                 | `reaction_instant_rule(message_content)` — takes the triggering message content, not a rule string |
| `soul_commands.rs`          | 6                   | 6                 | `soul_delete_preference(id)` — deletion by preference id |
| `persona_engine.rs`         | 12                  | 12                | **D-140 inventory listed 13; actual registered count is 12** — `persona_analyze_now_weekly` is the 12th not a 13th. Documented in file header. |
| `negotiation_engine.rs`     | 11                  | 11                | `negotiation_get_debates(limit)` and `negotiation_get_scenarios(limit)` — `limit` is required (not optional) |
| `reasoning_engine.rs`       | 5                   | 5                 | `reasoning_socratic` returns `Vec<(String, String)>` — surfaced as tuple arrays |
| `context_engine.rs`         | 3                   | 3                 | Return type is `AssembledContextResponse` (renamed from the earlier `AssembledContext` internal struct) |
| `sidecar.rs`                | 7                   | 7                 | `sidecar_start_server` carries explicit Dialog-confirm warning in JSDoc per D-158 |
| `personality_mirror.rs`     | 3                   | 3                 | `personality_analyze` has an AppHandle-managed param — frontend passes no args |
| `kali.rs`                   | 6                   | 6                 | Exposed via SidecarView per D-158; result types `KaliScanResult` + `KaliFinding` |
| **Total**                   | **60**              | **60**            | |

## 16 Per-Route Placeholder Files

Each placeholder renders `<GlassPanel tier={1} className="life-surface">` (or `identity-surface`) with a named hint ("Ships in Plan 06-XX") and a stable `data-testid` that Plans 06-03..06 can hook Playwright specs to.

**Life OS (9):**

| File | `data-testid` | Follow-up plan |
|------|---------------|----------------|
| `HealthView.tsx` | `health-view-placeholder` | Plan 06-03 |
| `FinanceView.tsx` | `finance-view-placeholder` | Plan 06-03 |
| `GoalView.tsx` | `goal-view-placeholder` | Plan 06-03 |
| `HabitView.tsx` | `habit-view-placeholder` | Plan 06-03 |
| `MeetingsView.tsx` | `meetings-view-placeholder` | Plan 06-03 |
| `SocialGraphView.tsx` | `social-graph-view-placeholder` | Plan 06-04 |
| `PredictionsView.tsx` | `predictions-view-placeholder` | Plan 06-04 |
| `EmotionalIntelView.tsx` | `emotional-intel-view-placeholder` | Plan 06-04 |
| `AccountabilityView.tsx` | `accountability-view-placeholder` | Plan 06-04 |

**Identity (7):**

| File | `data-testid` | Follow-up plan |
|------|---------------|----------------|
| `SoulView.tsx` | `soul-view-placeholder` | Plan 06-05 |
| `PersonaView.tsx` | `persona-view-placeholder` | Plan 06-05 |
| `CharacterBible.tsx` | `character-bible-placeholder` | Plan 06-05 |
| `NegotiationView.tsx` | `negotiation-view-placeholder` | Plan 06-05 |
| `ReasoningView.tsx` | `reasoning-view-placeholder` | Plan 06-06 |
| `ContextEngineView.tsx` | `context-engine-view-placeholder` | Plan 06-06 |
| `SidecarView.tsx` | `sidecar-view-placeholder` | Plan 06-06 |

## Rust Signature Corrections (discovered while reading Rust source)

Documented in JSDoc on each affected wrapper so Plans 06-03..06 match the actual Rust surface:

1. **`health_log(log: HealthLog)`** — takes the full `HealthLog` struct as a single payload, not individual optional kwargs. Draft plan suggested kwargs; Rust wins.
2. **`meeting_get_action_items()`** — no args; returns the *global* open action-items list across all meetings (not a per-meeting query).
3. **`people_get(name: String)`** — lookup by name (not id). `people_delete(id: String)` mutation by id. Distinct from the social_graph module which uses contact ids throughout.
4. **`temporal_meeting_prep(topic: String)`** — takes a free-form topic string, not a `meeting_id`. Frontend consumers should pass a title/topic extracted from the meeting record.
5. **`negotiation_get_debates(limit)` + `negotiation_get_scenarios(limit)`** — `limit` is required `usize`, not `Option<usize>`.
6. **`persona_engine.rs` — 12 commands registered, not 13** as D-140 stated. Verified by reading the file end-to-end. Wrappers cover all 12.
7. **`reasoning_socratic` / `get_expertise_map`** — return `Vec<(String, String)>` and `Vec<(String, f32)>` respectively. Surfaced as TS tuple arrays.
8. **`sidecar_run_all(command)`** returns `Vec<serde_json::Value>` with shape `{ device, result, error }` — typed as `SidecarRunAllEntry[]`.
9. **`kali_check_tools()`** — returns `serde_json::Value` with per-tool-name booleans plus a nested `_wordlists` key. Left as `Record<string, unknown>` since shape is dynamic.
10. **AppHandle-managed args** — `goal_pursue_now`, `prediction_generate_now`, `reasoning_think`, `negotiation_round`, `personality_analyze`, `persona_analyze_now_weekly` all carry a Tauri-managed `AppHandle` Rust param that is NOT passed from the frontend. Wrapper signatures omit it and Tauri injects it server-side. Noted in JSDoc.

## CSS File Scope

Both `life-os.css` + `identity.css` ship with the shared base classes the wave-2 plans need. Downstream plans **append** new `@layer features { ... }` blocks to the same file (D-164) — they never replace it. Tokens used are all project-standard: `--s-N`, `--r-md`, `--r-pill`, `--ease-out`, `--line`, `--line-strong`, `--t-1..--t-3`, `--font-mono`, `--font-display`, and the Phase 5 `--status-*` set. No hex colors; no `backdrop-filter` at the inner-card tier (D-07 + D-70 — only the outer `GlassPanel` blurs).

## Barrel Update

`src/lib/tauri/index.ts` now namespace-re-exports the two new modules following the Phase 5 convention:

```ts
export * as lifeOs from './life_os';
export * as identity from './identity';
```

Consumers may import either via the barrel (`import { lifeOs } from '@/lib/tauri'; lifeOs.healthGetToday()`) or directly (`import { healthGetToday } from '@/lib/tauri/life_os'`). Same module either way.

## Verification

- `npx tsc --noEmit` — clean (0 errors)
- `npm run verify:all` — all 11 checks pass:
  - `verify:entries` OK (5 HTML entries present)
  - `verify:no-raw-tauri` OK (no raw `@tauri-apps/api/core|event` imports outside allowed paths)
  - `verify:migration-ledger` OK (11 ids tracked)
  - `verify:emit-policy` OK (59 broadcast emits match allowlist)
  - `verify:contrast` OK (all strict pairs ≥ 4.5:1)
  - `verify:chat-rgba` OK (D-70 preserved)
  - `verify:ghost-no-cursor` OK (D-09 preserved)
  - `verify:orb-rgba` OK (D-07/D-18 preserved)
  - `verify:hud-chip-count` OK (HUD-02 preserved)
  - `verify:phase5-rust` OK (75 Phase 5 Rust commands still registered)
  - `verify:feature-cluster-routes` OK (18 Phase 5 routes present)
- ESLint `blade/no-raw-tauri` rule passes (every Phase 6 wrapper calls `invokeTyped`).
- Zero Rust changes (`src-tauri/` untouched).

## Deviations from Plan

None requiring special attention. Small drift-corrections while implementing:

### Auto-fixed Issues

**1. [Rule 3 — Blocking] CSS tokens in plan draft didn't match project tokens**
- **Found during:** Task 3 CSS creation.
- **Issue:** The plan's draft CSS used `--sp-N`, `--radius-card`, `--radius-pill` — tokens that don't exist in this project.
- **Fix:** Used the actual project tokens `--s-N`, `--r-md`, `--r-pill` (confirmed in `src/styles/tokens.css` and mirrored from the Phase 5 `agents.css`). Same applies to `--line-strong` (used instead of the plan's implicit single `--line` border variant on hover).
- **Files modified:** `src/features/life-os/life-os.css`, `src/features/identity/identity.css`.
- **Commit:** `e45006c`.

**2. [Rule 1 — Bug/Accuracy] persona_engine registered count is 12, not 13**
- **Found during:** Task 2 reading persona_engine.rs.
- **Issue:** D-140 inventory lists 13 persona_engine commands; the file actually has 12 registered `#[tauri::command]` functions.
- **Fix:** Emitted exactly 12 wrappers, noted the discrepancy in the identity.ts section header.
- **Files modified:** `src/lib/tauri/identity.ts`.
- **Commit:** `f8e72fb`.

All other sections match the plan verbatim.

## Single-Writer Invariant Held (D-143)

Confirmed: only the two cluster `index.tsx` files in this plan touched the route registries. Every one of the 16 per-route placeholder files is a fresh create with no edits to existing code outside the two index rewrites + the barrel add. Plans 06-03..06 inherit 16 clean placeholder targets and can proceed in parallel.

## Self-Check: PASSED

Verified artifacts exist:
- `src/lib/tauri/life_os.ts` FOUND
- `src/lib/tauri/identity.ts` FOUND
- `src/features/life-os/types.ts` FOUND
- `src/features/identity/types.ts` FOUND
- `src/features/life-os/life-os.css` FOUND
- `src/features/identity/identity.css` FOUND
- All 9 life-os placeholder .tsx files FOUND
- All 7 identity placeholder .tsx files FOUND
- `src/features/life-os/index.tsx` rewritten
- `src/features/identity/index.tsx` rewritten
- `src/lib/tauri/index.ts` extended with `lifeOs` + `identity` namespace re-exports

Verified commits exist:
- `cf0a642` — Task 1 (life_os.ts + life-os types)
- `f8e72fb` — Task 2 (identity.ts + identity types)
- `e45006c` — Task 3 (indexes + 16 placeholders + CSS + barrel)
