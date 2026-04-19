---
phase: 06-life-os-identity
plan: 04
subsystem: frontend-surfaces
tags: [life-os, routes, social-graph, predictions, emotions, accountability]
requires:
  - Phase 1 GlassPanel / Button / Dialog / Input / GlassSpinner primitives
  - Phase 1 useToast (ToastContext.show)
  - Phase 5 Plan 05-02 status tokens (--status-idle/running/success/error)
  - Plan 06-02 life_os.ts wrappers (social*, prediction*, emotion*, accountability*, learning*)
  - Plan 06-02 life-os.css cluster base (.life-surface, .life-placeholder)
  - Plan 06-02 life-os types barrel (Contact, Interaction, Prediction, EmotionalState, Objective, etc.)
provides:
  - src/features/life-os/SocialGraphView.tsx — LIFE-06 contacts CRM
  - src/features/life-os/PredictionsView.tsx — LIFE-07 predictions + patterns + learning engine
  - src/features/life-os/EmotionalIntelView.tsx — LIFE-08 emotion dashboard + EMOTION_STATUS_MAP
  - src/features/life-os/AccountabilityView.tsx — LIFE-09 OKRs + daily actions + checkin
  - src/features/life-os/life-os-rich-b.css — scoped partial for the 4 surfaces above
affects:
  - 4 Life OS routes render live data; SC-1 closure for life-os cluster (alongside Plan 06-03).
  - No other-lane files touched — 06-03 (Health/Finance/Goal/Habit/Meetings), 06-05 (Soul/Persona/Character/Negotiation), 06-06 (Reasoning/Context/Sidecar) all remained untouched in this plan's commits.
tech-stack:
  added: []  # no new deps
  patterns:
    - D-149 two-pane contacts CRM with debounced search (250ms) + inline log form
    - D-150 pending-list with accept/dismiss + optimistic per-card status + contextual form + learning longer-term list
    - D-151 hormone-tinted current card (EMOTION_STATUS_MAP → data-sentiment) + text-first emoji sparkline (D-02)
    - D-152 OKR card grid with KR progress bars + optimistic daily-action complete (T-06-04-05) + check-in / report Dialogs
    - D-162 EmotionalIntelView refetches on mount; no hormone/godmode event subscription
    - D-163 per-route file; no sub-component extraction required
    - D-164 single life-os-rich-b.css partial appended in order (Task 1 then Task 2), no cross-lane collision with life-os-rich-a.css (06-03)
key-files:
  created:
    - src/features/life-os/life-os-rich-b.css
  modified:
    - src/features/life-os/SocialGraphView.tsx
    - src/features/life-os/PredictionsView.tsx
    - src/features/life-os/EmotionalIntelView.tsx
    - src/features/life-os/AccountabilityView.tsx
decisions:
  - Surfaced EMOTION_STATUS_MAP as a named export from EmotionalIntelView so Plan 06-07's Playwright spec can reuse the exact keys without drift.
  - socialGetInsights() has no per-contact variant in Rust; we filter the global insight list client-side by contact_name. Alternative (expose a filter arg in Rust) was rejected per D-140 zero-Rust invariant.
  - learningGetPredictions(context) — chose 'home' as the default context string for the "longer-term predictions" section; the Rust command requires a context and 'home' is the safest baseline placeholder.
  - Optimistic daily-action complete is one-way (pending → completed only); revert on error per T-06-04-05. The Rust command does not support un-completing, so the UI disables the checkbox once completed.
  - KR progress bar width = current_value / target_value, capped at 100%. Division by zero guarded.
  - Check-in Dialog uses numeric 1-10 mood/energy inputs + three free-text fields (win / blocker / tomorrow) — matches the Rust signature exactly, not the draft plan's single-note form.
metrics:
  duration-minutes: ~10
  completed-date: 2026-04-19
  tasks-completed: 2
  commits: 2
  files-created: 1
  files-modified: 4
  lines-added: ~2550
---

# Phase 6 Plan 06-04: Life OS Rich Surfaces B Summary

Replaced the 4 remaining Life OS placeholder routes — SocialGraphView, PredictionsView, EmotionalIntelView, AccountabilityView — with real wired surfaces consuming the Plan 06-02 `life_os.ts` wrappers. Parallel to Plan 06-03 (disjoint files_modified). Together with 06-03 these two plans close the full SC-1 coverage for the 9 Life OS routes.

## 4 Routes Shipped

| Route | Requirement | File | Key Rust modules | Testid root |
|-------|-------------|------|------------------|-------------|
| social-graph | LIFE-06 | `SocialGraphView.tsx` | social_graph.rs (11 cmds) | `social-graph-root` |
| predictions | LIFE-07 | `PredictionsView.tsx` | prediction_engine.rs (6) + learning_engine.rs (1) | `predictions-view-root` |
| emotional-intel | LIFE-08 | `EmotionalIntelView.tsx` | emotional_intelligence.rs (5) | `emotional-intel-root` |
| accountability | LIFE-09 | `AccountabilityView.tsx` | accountability.rs (8) | `accountability-view-root` |

Total wrappers consumed: **30** (SocialGraph 10 + Predictions 7 + Emotion 5 + Accountability 8).

## EMOTION_STATUS_MAP (ground truth for Plan 06-07 spec)

Exported as a named const from `EmotionalIntelView.tsx`. Maps Rust `primary_emotion` string → sentiment bucket:

| Sentiment | Emotions |
|-----------|----------|
| positive | calm, focused, happy, joyful, content, excited, relaxed, energized |
| neutral | neutral, curious, contemplative, alert |
| negative | stressed, anxious, frustrated, sad, angry, tired, overwhelmed |
| unknown | (fallback when current is null) |

Unknown keys default to `neutral`. The `data-sentiment` attribute on `.emotion-current-card` is driven by this map and consumed by CSS for the left-border tint (positive → success green, neutral → running green, negative → error red, unknown → idle gray).

## Wrapper Signature Corrections (applied while implementing)

The draft plan's call signatures did not all match Rust reality. Actual signatures consumed:

| Draft | Actual | Rationale |
|-------|--------|-----------|
| `socialGetInsights(id)` | `socialGetInsights()` → global list, filter client-side by `contact_name` | No Rust per-contact variant; D-140 zero-Rust invariant. |
| `socialHowToApproach(id)` | `socialHowToApproach({contactId, goal})` | Rust requires a `goal` string; UI added a "What's your goal?" input inside the Dialog. |
| `socialLogInteraction({contact_id, type, notes})` | `socialLogInteraction({contactId, summary, sentiment, topics, actionItems})` | Rust has no `type` field; form maps to `summary` + `sentiment` (topics/actionItems deferred to a future UI iteration). |
| `socialAddContact({name, relationship, notes})` | `socialAddContact({name, relationshipType, notes, ...})` | camelCase key is `relationshipType`; wrapper converts to `relationship_type`. |
| `emotionGetTrend({window_hours: 24})` | `emotionGetTrend()` no args | Rust returns a compact EmotionalTrend with `period` / `avg_valence` / `dominant_emotion`. |
| `emotionGetReadings({limit: 50})` | `emotionGetReadings(50)` | Positional number arg. |
| `emotionAnalyzePatterns()` | `emotionAnalyzePatterns(14)` | Takes optional `daysBack` number; we pass 14 for a 2-week window. |
| `predictionContextual({current_context: {app, time}})` | `predictionContextual(currentContext: string)` | Rust accepts a single free-form context string. |
| `predictionDismiss(id)` | `predictionDismiss({id, helpful: false})` | Rust requires a `helpful` boolean so it can learn from the dismiss signal. |
| `predictionGenerateNow()` | `predictionGenerateNow()` (same) | AppHandle Tauri-managed; frontend passes no args. |
| `learningGetPredictions()` | `learningGetPredictions('home')` | Rust requires a context string; 'home' chosen as safe default. |
| `accountabilityGetObjectives()` typed as `Objective[]` | Typed as `Array<Record<string, unknown>>` — coerced via `coerceObjective()` helper | Rust emits `serde_json::Value` entries; coercion preserves unknown fields via spread. |
| `accountabilityUpdateKr({objective_id, kr_id, value})` | `accountabilityUpdateKr({krId, currentValue})` | Rust takes just `kr_id` + `current_value`. |
| `accountabilityCompleteAction({action_id})` | `accountabilityCompleteAction(actionId)` | Positional string. |
| `accountabilityCheckin({note})` | `accountabilityCheckin({mood, energy, win, blocker, tomorrow})` | Rust requires all 5 fields; Dialog surfaces numeric sliders + 3 textareas. |
| `accountabilityCreateObjective({title, description, krList})` | `accountabilityCreateObjective({title, description, timeframe, durationDays})` | Rust creates the objective without inline KRs; KRs are added via a separate flow. |
| `accountabilityProgressReport()` | `accountabilityProgressReport('week')` | Rust requires a period string; 'week' chosen to match the Dialog label. |

All corrections are documented inline in JSDoc comments at the top of each view file.

## CSS Delta (life-os-rich-b.css)

New scoped partial. Total 578 lines under `@layer features`. Disjoint from 06-03's `life-os-rich-a.css` — zero class-name overlap. Classes introduced:

**SocialGraphView:** `.social-graph-layout`, `.social-graph-header`, `.social-contacts-pane`, `.social-search-row`, `.contact-card` (+ `[data-selected]`), `.contact-card-name`, `.contact-card-meta`, `.contact-card-chip`, `.social-detail-pane`, `.social-detail-header`, `.social-detail-title`, `.social-detail-actions`, `.social-detail-empty`, `.social-section-label`, `.social-interactions-list`, `.social-interaction-row`, `.social-insights-list`, `.social-log-form`, `.social-log-textarea`.

**PredictionsView:** `.predictions-layout`, `.predictions-header`, `.predictions-list`, `.prediction-card` (+ `[data-status]` for pending/accepted/dismissed), `.prediction-title`, `.prediction-desc`, `.prediction-meta`, `.prediction-confidence-bar`, `.prediction-confidence-fill`, `.prediction-actions`, `.predictions-patterns-list`, `.predictions-pattern-row`, `.predictions-contextual-form`, `.predictions-contextual-row`.

**EmotionalIntelView:** `.emotional-intel-layout`, `.emotional-intel-header`, `.emotion-current-card` (+ `[data-sentiment]`), `.emotion-label`, `.emotion-meta`, `.emotion-sparkline`, `.emotion-sparkline-empty`, `.emotion-readings-list`, `.emotion-reading-row`, `.emotion-context-panel`.

**AccountabilityView:** `.accountability-layout`, `.accountability-header`, `.accountability-header-actions`, `.accountability-daily-banner`, `.accountability-daily-banner-title`, `.daily-action-row` (+ `[data-completed]`), `.daily-action-checkbox`, `.daily-action-energy`, `.objective-card`, `.objective-card-header`, `.objective-card-title`, `.objective-card-timeframe`, `.objective-card-desc`, `.kr-row`, `.kr-label`, `.kr-value`, `.kr-progress-bar`, `.kr-progress-fill`, `.objective-progress-summary`, `.accountability-report-result`.

All use project tokens (`--s-N`, `--r-md`, `--r-pill`, `--line`, `--line-strong`, `--t-1..--t-3`, `--status-*`, `--font-display`, `--font-mono`, `--ease-out`). No hex colors. No `backdrop-filter` on inner surfaces (D-07 + D-70 preserved — GlassPanel parent owns the single blur).

## data-testid Surface for Plan 06-07 Spec

Frozen selectors:

- `[data-testid="social-graph-root"]`, `[data-testid="contact-card"]`, `[data-testid="contact-detail-pane"]`
- `[data-testid="predictions-view-root"]`, `[data-testid="prediction-card"]` (+ `[data-status="pending|accepted|dismissed"]`)
- `[data-testid="emotional-intel-root"]`, `[data-testid="emotion-current-card"]` (+ `[data-sentiment="positive|neutral|negative|unknown"]`), `[data-testid="emotion-reading-row"]`
- `[data-testid="accountability-view-root"]`, `[data-testid="objective-card"]`, `[data-testid="daily-action-row"]` (+ `[data-completed="true|false"]`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Many draft-plan wrapper call signatures did not match Rust reality**
- **Found during:** Tasks 1 + 2 implementation; verified against the actual `src/lib/tauri/life_os.ts` which itself was calibrated from Rust source during Plan 06-02.
- **Issue:** The draft plan invoke signatures for social, prediction, emotion, and accountability surfaces used hypothetical shapes (e.g. `{window_hours: 24}`, `{action_id: ...}`, `{current_context: {app, time}}`) that the Plan 06-02 wrappers don't expose and that Rust doesn't accept.
- **Fix:** Used the actual wrapper signatures verbatim. All corrections are enumerated in the "Wrapper Signature Corrections" table above and documented in JSDoc at the top of each view.
- **Files modified:** 4 route files + 1 CSS file.
- **Commits:** 76a21d3, 2b6ef74.

**2. [Rule 3 — Blocking] Initial commit captured other-lane files due to shared-cwd parallel-executor race**
- **Found during:** Task 1 commit.
- **Issue:** The working tree contains pending changes from parallel agents working on 06-03, 06-05, and 06-06 lanes simultaneously. `git add <specific paths>` followed by `git commit` without `-o` can race with other agents' stages.
- **Fix:** Reset the bad commit via `git reset --mixed HEAD~1`, then used `git commit -o <paths>` which commits ONLY the listed pathspecs regardless of index state. This made my commits deterministic.
- **Commits affected:** Aborted `bf1daed` (undone), replaced by clean `76a21d3` (Task 1) and `2b6ef74` (Task 2).

**3. [Rule 2 — Missing functionality] accountabilityGetObjectives returns serde_json::Value, not typed Objective[]**
- **Found during:** Task 2 load path.
- **Issue:** The wrapper types this return as `Array<Record<string, unknown>>` (per Rust `Vec<serde_json::Value>`). Rendering without coercion would require `(obj as any).title` everywhere and lose type-safety on KR arrays.
- **Fix:** Added local `coerceObjective()` + `coerceKeyResult()` helpers at the top of AccountabilityView that map raw → typed with sensible defaults, and spread the raw at the end to preserve forward-compat fields.
- **Files modified:** `src/features/life-os/AccountabilityView.tsx`.
- **Commit:** 2b6ef74.

**4. [Rule 2 — Missing a11y] Contact cards initially only responded to click**
- **Found during:** Task 1 review before commit.
- **Issue:** Contact cards are selected by click but need keyboard accessibility (Enter / Space) since they act as buttons.
- **Fix:** Added `role="button"`, `tabIndex={0}`, and `onKeyDown` handler to each `.contact-card` so keyboard users can select contacts.
- **Files modified:** `src/features/life-os/SocialGraphView.tsx`.
- **Commit:** 76a21d3.

## Threat Model Compliance

| Threat | Mitigation | Status |
|--------|------------|--------|
| T-06-04-01 (Contact PII leak) | Local-first; no export/share UI in Phase 6 | Honored — no export affordance added. |
| T-06-04-02 (Search DoS on keystroke) | 250ms debounce | Implemented via `useRef<number>` + `setTimeout` in SocialGraphView. |
| T-06-04-03 (Delete without confirm) | Dialog confirm | Implemented — delete button opens a confirm Dialog before calling `socialDeleteContact`. |
| T-06-04-04 (Large readings list) | Limit=50 + defer virtualization | `emotionGetReadings(50)` with full-list render; virtualization deferred per threat model. |
| T-06-04-05 (Optimistic action toggle bug) | Revert on error + toast | Implemented in `handleToggleAction` — optimistic update, then reverted on catch with toast. |

All 5 threats are addressed per the plan's `<threat_model>` table.

## Verification

- `npx tsc --noEmit` — PASS (0 errors across both tasks)
- `npm run verify:all` — PASS (all 11 checks green):
  - `verify:entries` OK (5 HTML entries present)
  - `verify:no-raw-tauri` OK — every invoke goes through `life_os.ts` wrappers
  - `verify:migration-ledger` OK (13 ids tracked)
  - `verify:emit-policy` OK (59 broadcast emits match allowlist)
  - `verify:contrast` OK (all strict pairs ≥ 4.5:1)
  - `verify:chat-rgba` OK (D-70 preserved)
  - `verify:ghost-no-cursor` OK (D-09 preserved)
  - `verify:orb-rgba` OK (D-07/D-18 preserved)
  - `verify:hud-chip-count` OK (HUD-02 preserved)
  - `verify:phase5-rust` OK (75 Phase 5 Rust commands still registered)
  - `verify:feature-cluster-routes` OK (18 Phase 5 routes present)
- Plan-specific greps — PASS:
  - `socialListContacts / socialGetContact` present in SocialGraphView
  - `predictionGetPending / predictionAccept / learningGetPredictions` present in PredictionsView
  - `emotionGetCurrent / emotionGetTrend` present in EmotionalIntelView
  - `accountabilityGetObjectives / accountabilityDailyPlan / accountabilityCompleteAction / accountabilityUpdateKr` present in AccountabilityView
  - `contact-card / prediction-card / emotion-current-card / daily-action-row / objective-card` all present in life-os-rich-b.css
  - No "Ships in Plan 06-04" placeholder strings remain in any of the 4 view files.

## No Other-Lane Files Touched (files_modified invariant — D-143)

Confirmed via `git show` on each commit:

- 76a21d3 (Task 1) touched exactly: `SocialGraphView.tsx`, `PredictionsView.tsx`, `life-os-rich-b.css` — 3 files.
- 2b6ef74 (Task 2) touched exactly: `EmotionalIntelView.tsx`, `AccountabilityView.tsx`, `life-os-rich-b.css` — 3 files.

Zero overlap with Plan 06-03's lane (HealthView / FinanceView / GoalView / HabitView / MeetingsView / life-os-rich-a.css), Plan 06-05's lane (SoulView / PersonaView / CharacterBible / NegotiationView / EditSectionDialog / identity-rich-a.css), or Plan 06-06's lane (ReasoningView / ContextEngineView / SidecarView / identity-rich-b.css). The parallel-wave invariant holds.

## Known Stubs

None. Every stub slot in the 4 view files now has a real invoke + render path. The `topics` and `actionItems` fields on `socialLogInteraction` are intentionally omitted from the inline form (the Dialog is already dense); a future UX iteration may surface them. This is not a stub — the feature (logging interactions with a summary + sentiment) is fully wired.

## Self-Check: PASSED

Verified artifacts exist:
- `src/features/life-os/SocialGraphView.tsx` FOUND
- `src/features/life-os/PredictionsView.tsx` FOUND
- `src/features/life-os/EmotionalIntelView.tsx` FOUND
- `src/features/life-os/AccountabilityView.tsx` FOUND
- `src/features/life-os/life-os-rich-b.css` FOUND

Verified commits exist:
- `76a21d3` — Task 1 (SocialGraphView + PredictionsView + CSS create)
- `2b6ef74` — Task 2 (EmotionalIntelView + AccountabilityView + CSS extend)
