---
phase: 15-density-polish
plan: "03"
subsystem: feature-copy
tags: [empty-state, copy-rewrite, timeline-phrasing, density-polish, verify-gate]

# Dependency graph
requires:
  - phase: 15-density-polish
    plan: "01"
    provides: scripts/verify-empty-states-copy.mjs + first-run violation backlog (9 sites)
  - phase: 09-polish
    provides: EmptyState primitive (label / description / actionLabel / onAction)
provides:
  - Every bare-negation EmptyState across 17 files rewritten with timeline or CTA phrasing
  - verify:empty-states-copy exits 0 (was 9 violations from 15-01 baseline)
  - Observer-tentacle-fed surfaces now reference 24h learning window consistently
  - AiDelegate surface carries in-file CTA wired to existing onIntroduce handler
affects: [15-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Form A (timeline): 'BLADE is still learning your X — give me 24h' for observer-tentacle-fed surfaces"
    - "Form B (CTA): actionLabel + onAction wired to existing in-file handler (AiDelegate → onIntroduce)"
    - "Filter-aware empty state for search surfaces (KnowledgeBase 'No matches for this filter')"

key-files:
  created:
    - .planning/phases/15-density-polish/15-03-SUMMARY.md
  modified:
    - src/features/life-os/HealthView.tsx
    - src/features/life-os/SocialGraphView.tsx
    - src/features/life-os/AccountabilityView.tsx
    - src/features/life-os/EmotionalIntelView.tsx
    - src/features/life-os/PredictionsView.tsx
    - src/features/admin/Analytics.tsx
    - src/features/admin/CapabilityReports.tsx
    - src/features/admin/DecisionLog.tsx
    - src/features/admin/SecurityDashboard.tsx
    - src/features/admin/ModelComparison.tsx
    - src/features/admin/Reports.tsx
    - src/features/agents/AgentDetail.tsx
    - src/features/knowledge/KnowledgeBase.tsx
    - src/features/hive/TentacleDetail.tsx
    - src/features/hive/ApprovalQueue.tsx
    - src/features/hive/AiDelegate.tsx
    - src/features/body/WorldModel.tsx
    - src/features/identity/CharacterBible.tsx

key-decisions:
  - "Form A (timeline) used for every observer-tentacle-fed surface — the 24h learning window is the canonical observer cadence; CTAs would be wrong for surfaces that auto-populate"
  - "AiDelegate uses form B because onIntroduce exists in-file — the only Task 2 scope file with a legitimate CTA target (must_haves requirement)"
  - "KnowledgeBase uses filter-aware copy ('No matches for this filter — clear the filter') rather than a blanket timeline, because the surface is a search result not an observed feed"
  - "WorldModel.tsx + CharacterBible.tsx rewrites are in-plan by Rule 3 (blocking): verify:empty-states-copy would not exit 0 without them, and must_haves truth #2 requires gate pass"
  - "No new router imports or route ids invented — fell back to form A whenever no existing in-file handler was available"

requirements-completed: [DENSITY-05]

# Metrics
duration: 12m
completed: 2026-04-24
---

# Phase 15 Plan 03: Empty-State Copy Rewrite Sweep Summary

**Rewrote every bare-negation EmptyState across 18 feature files using form A (timeline, "BLADE is still learning — give me 24h") for observer-tentacle-fed surfaces and form B (CTA wired to existing handler) for AiDelegate — closing all 9 Wave 0 baseline violations plus 2 out-of-scope sites so `verify:empty-states-copy` now exits 0.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-24T08:42:07Z
- **Completed:** 2026-04-24T08:53:54Z
- **Tasks:** 2
- **Files modified:** 18

## Accomplishments

- All 9 Wave 0 bare-negation violations closed (9 → 0)
- Every scope file carries at least one of: `actionLabel=`, `learning`, `still`, `give me`, `will appear`, `once`, `after`
- Observer-tentacle-fed surfaces (Temporal, DecisionLog, Analytics, SecurityDashboard, CapabilityReports, EmotionalIntelView, AccountabilityView, PredictionsView, Reports, TentacleDetail, HealthView, SocialGraphView) consistently reference the 24h learning cadence
- Search/filter surface (KnowledgeBase) uses filter-aware copy preserving filter-UX intent
- Agent event timeline (AgentDetail) uses "as this agent works" timeline phrasing
- ModelComparison uses per-slot "click Test" timeline phrasing wired to existing admin workflow
- AiDelegate CTA wired to existing `onIntroduce` handler — only form-B surface, per must_haves
- Two out-of-scope gate-blockers (WorldModel processes + recent changes, CharacterBible traits) rewritten so `verify:empty-states-copy` exits 0 cleanly

## Task Commits

Each task committed atomically:

1. **Task 1: Life OS + Admin clusters** — `6784ba9` (feat)
2. **Task 2: Agents / Hive / Knowledge / remaining Admin + gate-blockers** — `793e479` (feat)

## Files Modified

### Task 1 (Life OS + Admin — 9 files)

| File | Form | Rewrite summary |
|------|------|-----------------|
| `src/features/life-os/HealthView.tsx` | A | "BLADE is still learning your baseline" / "after 24h" |
| `src/features/life-os/SocialGraphView.tsx` | A | "BLADE is still learning your network" / "after 24h" |
| `src/features/life-os/AccountabilityView.tsx` | A | "BLADE is still learning your commitments" / "will appear once" |
| `src/features/life-os/EmotionalIntelView.tsx` | A | "BLADE is still learning your emotional patterns" / "after 24h" |
| `src/features/life-os/PredictionsView.tsx` | A | "BLADE is still learning your patterns" / "after 24h" |
| `src/features/admin/Analytics.tsx` | A | "BLADE is still warming up" / "give me 24h" |
| `src/features/admin/CapabilityReports.tsx` | A | "BLADE is still learning your capability needs" / "give me 24h" |
| `src/features/admin/DecisionLog.tsx` | A | "BLADE is still learning when to act" / "give me 24h" (must_haves: contains `learning`) |
| `src/features/admin/SecurityDashboard.tsx` | A | "BLADE is still scanning" / "give me 24h" |

### Task 2 (Agents / Hive / Knowledge / Admin + gate-blockers — 9 files)

| File | Form | Rewrite summary |
|------|------|-----------------|
| `src/features/agents/AgentDetail.tsx` | A | "Events will appear as this agent works" / "once the agent starts" |
| `src/features/knowledge/KnowledgeBase.tsx` | A (filter-aware) | "No matches for this filter" / "Clear the filter... give me a broader query" |
| `src/features/admin/ModelComparison.tsx` | A | "BLADE is still learning your routing preferences" / "once you test each slot" |
| `src/features/admin/Reports.tsx` | A | "BLADE is still scanning your capabilities" / "after BLADE runs scheduled scans — give me 24h" |
| `src/features/hive/TentacleDetail.tsx` | A | "This tentacle is still learning" / "after 24h" |
| `src/features/hive/ApprovalQueue.tsx` | A | "Nothing to approve right now" / "will appear as BLADE acts" |
| `src/features/hive/AiDelegate.tsx` | **B** | `actionLabel="Introduce BLADE"` + `onAction={onIntroduce}` (must_haves: contains `actionLabel`) |
| `src/features/body/WorldModel.tsx` | A | Processes + recent changes: "BLADE is still scanning — give me a moment" (gate-blocker rewrite) |
| `src/features/identity/CharacterBible.tsx` | A | "BLADE is still learning your style" / "after you give chat feedback" (gate-blocker rewrite) |

## Gate Status

| Gate | Before 15-03 | After 15-03 |
|------|--------------|-------------|
| `verify:empty-states-copy` | FAIL — 9 violations | **PASS — 0 violations** |
| `verify:empty-state-coverage` | OK — 41 files | OK — 41 files (unchanged) |
| `verify:a11y-pass-2` | PASS | PASS (no regression) |
| `verify:audit-contrast` | PASS | PASS (no regression) |
| `verify:chat-rgba` | OK | OK (no regression) |
| `verify:hud-chip-count` | OK | OK (no regression) |
| `verify:ghost-no-cursor` | OK | OK (no regression) |
| `verify:orb-rgba` | OK | OK (no regression) |
| `verify:motion-tokens` | OK | OK (no regression) |
| `npx tsc --noEmit` | clean | clean |

`verify:spacing-ladder` still fails with the 131 pre-existing violations from Plan 15-01 baseline — that is Plan 15-02's backlog, not a regression from this plan.

## Decisions Made

### Form A vs Form B choice per file

The plan called form A (timeline) for observer-tentacle-fed surfaces and form B (CTA) for user-authored surfaces, falling back to form A when no in-file handler exists. Actual execution:

- **14 of 15 scope-file rewrites are form A** — observer cadence is the correct signal for surfaces that auto-populate; CTAs would be wrong
- **1 of 15 scope-file rewrites is form B** — AiDelegate, which has `onIntroduce` in-file (only legitimate CTA target without inventing routes)
- **Pre-existing form-B scope files left untouched** — AgentDashboard, SwarmView, GoalView, HabitView, FinanceView, Diagnostics, IntegrationStatus, McpSettings, KeyVault, HiveMesh, ScreenTimeline, FallbackOrderList already passed the gate AND had the required marker words; no edits needed (preserved existing CTAs that wire to `openRoute` or local focus handlers)

### Out-of-scope gate-blockers rewritten (Rule 3 — blocking)

The plan's files_modified list covered 29 feature files, but 2 non-listed files (`WorldModel.tsx`, `CharacterBible.tsx`) carried 3 violations that would have prevented `verify:empty-states-copy` from exiting 0. must_haves truth #2 explicitly requires gate pass after this plan, so those rewrites were necessary for plan completion. Both rewrites apply the same form-A timeline pattern as scope files — no invented routes, no new imports.

### No route id invention

Several files (AgentDetail, EmotionalIntelView, CapabilityReports, DecisionLog, SecurityDashboard, Analytics, ApprovalQueue, TentacleDetail-report-list) have zero router access in scope. Per plan guidance ("NEVER invent a non-existent route id"), all used form A instead of inventing openRoute targets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Rewrote 2 out-of-scope EmptyStates**
- **Found during:** Task 2 gate verification
- **Issue:** `verify:empty-states-copy` reports 3 additional violations in files outside the plan's `files_modified` list (`body/WorldModel.tsx:301`, `body/WorldModel.tsx:353`, `identity/CharacterBible.tsx:171`). must_haves truth #2 mandates gate exit 0.
- **Fix:** Applied the same form-A timeline rewrite pattern: "BLADE is still scanning processes" / "No file changes observed yet — give me a few minutes of observed work" / "BLADE is still learning your style".
- **Files modified:** `src/features/body/WorldModel.tsx`, `src/features/identity/CharacterBible.tsx`
- **Commit:** `793e479`

### No Architectural Changes

No Rule 4 situations arose. Every rewrite was copy-level; no new imports, no new routes, no new handlers. AiDelegate's form-B wiring reuses the already-imported `onIntroduce` state + callback.

## Auth Gates

None — pure frontend copy work; no backend, no network, no auth surfaces touched.

## Known Stubs

None — every rewrite uses concrete semantic copy referencing observer cadence; no "TBD" / "coming soon" / placeholder markers left behind.

## Threat Flags

None — form A copy mentions only "BLADE is still learning" phrasing (no user PII), form B wiring reuses an existing in-file handler (no new navigation targets).

## Issues Encountered

None.

## Self-Check: PASSED

- Commit `6784ba9` (Task 1) — FOUND
- Commit `793e479` (Task 2) — FOUND
- `node scripts/verify-empty-states-copy.mjs` exits 0 — CONFIRMED (PASS — 0 bare-negation empty states)
- `npx tsc --noEmit` exits 0 — CLEAN
- `bash scripts/verify-empty-state-coverage.sh` OK — CONFIRMED (41 files)
- `node scripts/verify-a11y-pass-2.mjs` PASS — CONFIRMED
- `node scripts/audit-contrast.mjs` OK — CONFIRMED
- `bash scripts/verify-chat-rgba.sh` OK — CONFIRMED
- `bash scripts/verify-hud-chip-count.sh` OK — CONFIRMED
- `bash scripts/verify-ghost-no-cursor.sh` OK — CONFIRMED
- `bash scripts/verify-orb-rgba.sh` OK — CONFIRMED
- `bash scripts/verify-motion-tokens.sh` OK — CONFIRMED
- Every scope file carries at least one acceptance-grep marker — CONFIRMED (all counts ≥ 1)
- must_haves artifacts:
  - `src/features/life-os/GoalView.tsx` still contains `actionLabel` (pre-existing, unchanged) — FOUND
  - `src/features/admin/DecisionLog.tsx` now contains `learning` — FOUND
  - `src/features/hive/AiDelegate.tsx` now contains `actionLabel` (new CTA) — FOUND

---
*Phase: 15-density-polish*
*Completed: 2026-04-24*
