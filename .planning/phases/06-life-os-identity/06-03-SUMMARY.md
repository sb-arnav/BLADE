---
phase: 06-life-os-identity
plan: 03
subsystem: life-os-frontend
tags: [life-os, health, finance, goals, habits, meetings, csv-import, intl-numberformat, streak-chip]
requires:
  - Phase 6 Plan 06-01 (usePrefs extensions — lifeOs.health.unit / lifeOs.finance.currency / lifeOs.activeTab)
  - Phase 6 Plan 06-02 (src/lib/tauri/life_os.ts wrappers — 97 functions)
  - Phase 1 primitives (GlassPanel, Button, Dialog, Input, GlassSpinner, Pill, Badge)
  - Phase 1 tokens.css (--s-N / --r-md / --r-pill / --line / --line-strong / --t-1..t-3 / --font-mono / --font-display)
  - Phase 5 Plan 05-02 status tokens (--status-idle/running/success/error)
  - Phase 2 ToastContext (useToast().show — D-59)
  - @tauri-apps/plugin-dialog (v2.7.0 — already in package.json)
provides:
  - src/features/life-os/HealthView.tsx (LIFE-01 — today snapshot + streak + insights + scan)
  - src/features/life-os/FinanceView.tsx (LIFE-02 — KPI + transactions + CSV import + goals/insights/subscriptions tabs)
  - src/features/life-os/GoalView.tsx (LIFE-03 — goals grid + priority + pursue-now)
  - src/features/life-os/HabitView.tsx (LIFE-04 — today checklist + library grid + suggest-design + insights)
  - src/features/life-os/MeetingsView.tsx (LIFE-05 — sidebar list + compare/themes + MeetingDetail)
  - src/features/life-os/MeetingDetail.tsx (LIFE-05 sub — header + summary + action items + prep banner + follow-up draft)
  - src/features/life-os/life-os-rich-a.css (scoped partial; Plan 06-04 owns life-os-rich-b.css — zero overlap)
affects:
  - Navigating to /health /finance /goals /habits /meetings no longer produces a 404-looking placeholder (SC-1)
  - FinanceView now satisfies SC-2 (financial_* commands render a spending overview + explicit CSV import affordance)
tech-stack:
  added: []  # no new deps; plugin-dialog was already installed
  patterns:
    - D-145 HealthView stat grid + streak chip + insights + correlate-with-productivity inline output
    - D-146 FinanceView KPI row + transactions split-pane + tabbed right pane + CSV button-only import
    - D-147 GoalView + HabitView shared .life-card grid motif (no shared sidebar)
    - D-148 MeetingsView two-column layout + client-side future-detection for temporal_meeting_prep
    - D-159 camelCase -> snake_case at invokeTyped boundary (all via wrappers)
    - D-161 cluster-local type re-exports via features/life-os/types.ts
    - D-164 one cluster CSS base + rich partial per plan (no per-component CSS files)
    - D-165 usePrefs dotted keys (lifeOs.health.unit / lifeOs.finance.currency / lifeOs.activeTab) persisted
    - Plan 06-02 §§ wrapper-signature corrections respected verbatim (snapshot/month, transactions/date-range, auto-categorize/description, action-item/index, temporal/topic)
key-files:
  created:
    - src/features/life-os/MeetingDetail.tsx
    - src/features/life-os/life-os-rich-a.css
  modified:
    - src/features/life-os/HealthView.tsx
    - src/features/life-os/FinanceView.tsx
    - src/features/life-os/GoalView.tsx
    - src/features/life-os/HabitView.tsx
    - src/features/life-os/MeetingsView.tsx
decisions:
  - Adapted FinanceView KPI row to the REAL FinancialSnapshot shape (income, expenses, savings_rate, top_categories, vs_last_month) instead of the plan-draft "balance / spending_this_month / subscription_burn" fields. "Net this month" is synthesised as `income - expenses`; "Subscription burn" is summed client-side from the finance_detect_subscriptions response. Rule 1 fix — plan used hypothetical field names; Rust wins.
  - finance_auto_categorize takes a single description and returns a single category, not a bulk operation. The "Auto-categorize" button iterates over transactions that have no category and invokes the wrapper per-row, surfacing the success count via toast. Rule 1.
  - finance_get_transactions takes {start_date, end_date, category?} (date range), NOT a plain `limit`. View defaults to "last 90 days" starting from today and through today.
  - meeting_complete_action takes {meeting_id, item_index: usize} — the Rust ActionItem has no id field. The detail pane uses the array index as the complete key. Documented inline.
  - temporal_meeting_prep takes a topic string (not a meeting_id). MeetingDetail feeds meeting.title as the topic.
  - Meeting.date is a "YYYY-MM-DD" string (not a unix timestamp). MeetingDetail parses it into local-midnight via a regex-guarded helper; the "future" gate uses end-of-day tolerance so prep briefings stay available for meetings scheduled today.
  - health_update_today takes a serde_json::Value updates map. The Update-today dialog only includes fields the user edits (skipping empty inputs) so blanks don't zero out previously-logged values. Guard: numeric fields that parse to NaN are rejected before invoke.
  - The plan's draft CSS used `--sp-*` / `--radius-*` token names; I used the project's actual `--s-*` / `--r-md` / `--r-pill` tokens (same correction Plan 06-02 applied in its CSS base).
metrics:
  duration-minutes: ~12
  completed-date: 2026-04-19
  tasks-completed: 3
  commits: 3
  files-created: 2
  files-modified: 5
  lines-added: ~3615 (net across 7 files)
---

# Phase 6 Plan 06-03: Life OS Subset A — 5 Real Surfaces Summary

Five Plan 06-02 placeholders (`HealthView`, `FinanceView`, `GoalView`, `HabitView`, `MeetingsView`) now render real glass-native surfaces wired to the Plan 06-02 wrappers + Plan 06-01 prefs. A new `MeetingDetail` sub-component splits the meetings route for readability, and a scoped `life-os-rich-a.css` partial carries every class added by Plans 06-03 tasks 1–3 (parallel-safe with the 06-04 `life-os-rich-b.css` partner).

## Requirement Coverage

| Requirement | Route | File | Status |
|-------------|-------|------|--------|
| LIFE-01 | `/health` | `HealthView.tsx` | Closed — 5-stat grid (sleep / activity / mood / energy / sleep-quality) + streak chip (streak_get_stats + health_streak_info) + insights + scan + correlate-with-productivity + update-today Dialog |
| LIFE-02 | `/finance` | `FinanceView.tsx` | Closed — 4 KPIs + 90-day transactions list with signed-amount coloring + CSV import via plugin-dialog + auto-categorize + tabbed right pane (goals / insights / subscriptions) |
| LIFE-03 | `/goals` | `GoalView.tsx` | Closed — inline add form + card grid with priority pill, pursue-now, inline priority change, complete / delete dialog confirms |
| LIFE-04 | `/habits` | `HabitView.tsx` | Closed — today checklist with optimistic complete / skip + library grid + suggest-design Dialog + inline create form + insights list |
| LIFE-05 | `/meetings` | `MeetingsView.tsx` + `MeetingDetail.tsx` | Closed — sidebar list + search + compare dialog + recurring-themes dialog + detail pane with header / summary / action items / prep banner / follow-up draft with copy-to-clipboard |

## SC-1 Confirmation

All 5 routes render without the 404 placeholder. The streak chip on `/health` (`data-testid="health-streak-chip"`) reads from both `streak_get_stats` (for total active days) and `health_streak_info` (for the current health-log streak), satisfying the SC-1 "streak counters read from streak_* commands" clause. Combined with Plan 06-04 (which ships the remaining 4 Life OS routes), SC-1 is fully closed.

## SC-2 Confirmation

`FinanceView` invokes `financial_*` commands on mount (snapshot, transactions, goals, subscriptions, insights) and renders a spending overview (KPI row + transactions list). The "Import CSV" button (`data-testid="finance-import-csv"`) resolves a file path via `@tauri-apps/plugin-dialog`'s `open()` → `finance_import_csv(path)` → toast with row count, satisfying the "CSV import affordance is present" clause explicitly. All amount display goes through `Intl.NumberFormat` with `prefs['lifeOs.finance.currency']` (default USD) — zero hardcoded currency symbols.

## CSS Delta — `life-os-rich-a.css`

Scoped partial (736 lines) appended to the base `life-os.css`. Classes added across all three tasks:

| Scope | Classes |
|-------|---------|
| HealthView | `.health-header`, `.health-header-title`, `.health-header-date`, `.health-unit-toggle`, `.health-unit-toggle-btn`, `.health-stat[data-range]`, `.health-stat-label`, `.health-stat-value`, `.health-stat-hint`, `.health-streak-chip`, `.health-toolbar`, `.health-insights`, `.health-insights-title`, `.health-insights-list`, `.health-insight-urgency[data-level]`, `.health-correlate-output`, `.health-scan-status` |
| Goal + Habit | `.goals-grid`, `.habits-grid`, `.goal-card-actions`, `.habit-card-actions`, `.goal-card-title`, `.habit-card-title`, `.goal-card-description`, `.habit-card-description`, `.goal-priority-pill[data-priority]`, `.goal-priority-row`, `.goal-priority-row-btn`, `.goal-add-form`, `.habit-add-form`, `.habit-suggest-form`, `.goal-add-form-field`, `.habit-add-form-field`, `.habit-rows`, `.habit-row[data-completed]`, `.habit-row-title`, `.habit-row-streak` |
| Finance | `.finance-kpi-row`, `.finance-kpi`, `.finance-kpi-label`, `.finance-kpi-value`, `.finance-kpi-hint`, `.finance-layout`, `.finance-tx-pane`, `.finance-side-pane`, `.finance-tx-list`, `.finance-tx-row[data-sign]`, `.finance-tx-date`, `.finance-tx-description`, `.finance-tx-category`, `.finance-tx-amount`, `.finance-toolbar`, `.finance-currency-select`, `.finance-goal-card`, `.finance-goal-progress`, `.finance-goal-progress-bar`, `.finance-sub-row`, `.finance-sub-merchant`, `.finance-sub-amount`, `.finance-sub-date` |
| Meetings | `.meetings-layout`, `.meetings-sidebar`, `.meetings-sidebar-search`, `.meetings-sidebar-actions`, `.meetings-sidebar-list`, `.meeting-sidebar-row[data-selected]`, `.meeting-sidebar-row-title`, `.meeting-sidebar-row-meta`, `.meeting-detail-pane`, `.meeting-detail-header`, `.meeting-detail-title`, `.meeting-detail-meta`, `.meeting-detail-banner`, `.meeting-detail-actions`, `.meeting-detail-summary`, `.meeting-action-item[data-completed]`, `.meeting-action-item-text`, `.meeting-action-item-meta`, `.meeting-compose-pre` |
| Shared rich | `.life-section-title`, `.life-section-subtitle`, `.life-empty`, `.life-dialog-body`, `.life-dialog-actions`, `.life-dialog-heading`, `.life-dialog-grid`, `.life-dialog-grid-field` |

All rules live inside a single `@layer features { ... }` block. Every token resolves against the project's canonical token set (`--s-N`, `--r-md`, `--r-pill`, `--t-*`, `--line`, `--line-strong`, `--font-mono`, `--font-display`, `--status-*`, `--a-warm`, `--a-cool`). D-07 + D-70 invariants preserved — no inner-card `backdrop-filter`.

## Wrapper Signature Surprises (cross-check with Plan 06-02 SUMMARY)

Every surprise below was already documented by Plan 06-02. Plan 06-03 respected the real signatures verbatim:

1. `finance_get_snapshot(month: "YYYY-MM")` — I pass current-month string; no "balance" field in response.
2. `finance_get_transactions({start_date, end_date, category?})` — date range, not plain limit; used "last 90 days".
3. `finance_auto_categorize(description)` returns a single category — UI iterates per uncategorized tx.
4. `finance_detect_subscriptions` returns `Array<Record<string, unknown>>`; I extract merchant / amount / last-charge with fallback keys.
5. `meeting_get_action_items()` returns the GLOBAL list; `MeetingDetail` filters client-side by `meeting_id` with fallback to `meeting.action_items`.
6. `meeting_complete_action({meeting_id, item_index})` — no action_id; UI passes array index.
7. `meeting_follow_up_email({meeting_id, recipient: String})` — recipient required; UI pre-fills from first participant and shows Input for override.
8. `meeting_compare(ids: string[])` — array of ids; UI provides a multi-pick dialog.
9. `temporal_meeting_prep(topic: String)` — topic string not id; UI feeds `meeting.title`.
10. `health_update_today(updates: serde_json::Value)` — takes a Record; UI excludes blank inputs to prevent zeroing values.

## Sibling-Plan Boundary Check

Confirmed: my 3 commits (`f056620`, `39994bc`, `d4f67ed`) touched ONLY the 7 files owned by Plan 06-03 (`HealthView.tsx`, `FinanceView.tsx`, `GoalView.tsx`, `HabitView.tsx`, `MeetingsView.tsx`, `MeetingDetail.tsx`, `life-os-rich-a.css`). Plan 06-04 files (`SocialGraphView.tsx`, `PredictionsView.tsx`, `EmotionalIntelView.tsx`, `AccountabilityView.tsx`, `life-os-rich-b.css`) were modified by the parallel Wave 2 agent and NOT touched by me. Plans 06-05 + 06-06 identity files similarly untouched. `files_modified` no-overlap invariant (D-143) held.

## Data Testids Delivered (for Plan 06-07 specs)

| Testid | Where |
|--------|-------|
| `health-view-root` | HealthView root |
| `health-stat[data-key=sleep\|activity\|mood\|energy\|focus]` | HealthView 5 stat cards |
| `health-streak-chip` | HealthView streak chip |
| `health-insights` | HealthView insights panel |
| `health-correlate-output` | HealthView correlate result |
| `finance-view-root` | FinanceView root |
| `finance-kpi[data-key=balance\|spending\|savings\|subscriptions]` | FinanceView 4 KPIs |
| `finance-kpi-row` | FinanceView KPI grid |
| `finance-import-csv` | FinanceView CSV import button (SC-2) |
| `finance-tx-row` | FinanceView transactions list |
| `finance-goal-card` | FinanceView goals tab |
| `goals-view-root` | GoalView root |
| `goal-card[data-priority]` | GoalView cards |
| `habits-view-root` | HabitView root |
| `habit-row[data-completed]` | HabitView today checklist |
| `habit-card` | HabitView library grid |
| `meetings-view-root` | MeetingsView root |
| `meeting-sidebar-row[data-selected]` | MeetingsView sidebar rows |
| `meeting-detail-root` | MeetingDetail root |
| `meeting-action-item[data-completed]` | MeetingDetail action items |
| `meeting-prep-banner` | MeetingDetail briefing banner |
| `meeting-followup-output` | MeetingDetail draft dialog output |

## Verification

- `npx tsc --noEmit` — clean (0 errors)
- `npm run verify:all` — all 11 checks pass:
  - `verify:entries` OK
  - `verify:no-raw-tauri` OK (no raw invoke / listen imports; `@tauri-apps/plugin-dialog` used directly is not banned)
  - `verify:migration-ledger` OK
  - `verify:emit-policy` OK
  - `verify:contrast` OK (t-1/t-2 ≥ 4.5:1 on dark baseline)
  - `verify:chat-rgba` OK (D-70 preserved — no blur in this plan)
  - `verify:ghost-no-cursor` OK
  - `verify:orb-rgba` OK
  - `verify:hud-chip-count` OK
  - `verify:phase5-rust` OK
  - `verify:feature-cluster-routes` OK
- ESLint `blade/no-raw-tauri` passes — zero raw `@tauri-apps/api/core` or `@tauri-apps/api/event` imports in Plan 06-03 files.
- `grep -q "healthGetToday\|healthStreakInfo"` HealthView — OK
- `grep -q "goalList\|goalPursueNow"` GoalView — OK
- `grep -q "habitGetToday\|habitComplete"` HabitView — OK
- `grep -q "financeGetSnapshot\|financeGetTransactions"` FinanceView — OK
- `grep -q "financeImportCsv\|financeAutoCategorize"` FinanceView — OK
- `grep -q "Intl.NumberFormat"` FinanceView — OK
- `grep -q "meetingList\|meetingGet"` MeetingsView — OK
- `grep -q "temporalMeetingPrep\|meetingGetActionItems"` MeetingDetail — OK
- No placeholder hints ("Ships in Plan 06-03") remain in any of the 5 route files.
- Zero Rust changes — `src-tauri/` untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] FinanceView KPI row adapted to real FinancialSnapshot shape**
- **Found during:** Task 2 reading `src/lib/tauri/life_os.ts` + the Rust `financial_brain.rs` struct.
- **Issue:** Plan draft specified KPIs for `balance / spending_this_month / savings_rate / subscription_burn`. The actual Rust `FinancialSnapshot` shape is `{month, income, expenses, savings_rate, top_categories, vs_last_month}` — no `balance`, no `spending_this_month`, no `subscription_burn` literal field.
- **Fix:** Synthesised KPIs from the real shape — Net-this-month = `income - expenses`; Spending = `expenses`; Savings rate = `savings_rate`; Subscription burn = sum of monthly costs from `finance_detect_subscriptions`.
- **Files modified:** `src/features/life-os/FinanceView.tsx`.
- **Commit:** `39994bc`.

**2. [Rule 1 — Bug] Auto-categorize semantics: per-description, not bulk**
- **Found during:** Task 2 reading wrapper signature.
- **Issue:** Plan draft assumed `finance_auto_categorize()` is a zero-arg bulk operation returning counts. Real Rust signature is `finance_auto_categorize(description: String) -> Result<String, String>` returning a single inferred category.
- **Fix:** "Auto-categorize" button iterates over transactions that lack a category and invokes the wrapper per-row, surfacing a combined success count via toast. Per-tx failures do not abort the batch.
- **Files modified:** `src/features/life-os/FinanceView.tsx`.
- **Commit:** `39994bc`.

**3. [Rule 1 — Bug] Meeting action items have no id; complete uses array index**
- **Found during:** Task 3 reading `MeetingActionItem` shape.
- **Issue:** Plan draft referenced "actionId" in "Complete" button wiring. Rust `ActionItem` struct is `{description, owner?, due_date?, completed}` — no id.
- **Fix:** MeetingDetail passes the client-side array index as `item_index` to `meeting_complete_action({meeting_id, item_index})`. Completion marked optimistically then refetched.
- **Files modified:** `src/features/life-os/MeetingDetail.tsx`.
- **Commit:** `d4f67ed`.

**4. [Rule 1 — Bug] Meeting date is a string, not a timestamp**
- **Found during:** Task 3 implementing the future-meeting gate.
- **Issue:** Plan draft said `meeting.scheduled_at > Date.now()`. Real `Meeting` shape has `date: string` in `YYYY-MM-DD`, no `scheduled_at` timestamp.
- **Fix:** Added `parseMeetingDate()` helper that regex-matches `YYYY-MM-DD` into local-midnight and falls back to `Date.parse` on non-conforming input. `isFutureMeeting()` adds end-of-day tolerance so prep briefings remain available all day for a meeting scheduled today.
- **Files modified:** `src/features/life-os/MeetingDetail.tsx`.
- **Commit:** `d4f67ed`.

**5. [Rule 1 — Bug] temporal_meeting_prep takes topic, not meeting_id**
- **Found during:** Task 3 reading wrapper JSDoc.
- **Issue:** Plan draft said `temporalMeetingPrep({ meetingId })`. Real wrapper is `temporalMeetingPrep(topic: string)`.
- **Fix:** MeetingDetail feeds `meeting.title` as the topic.
- **Files modified:** `src/features/life-os/MeetingDetail.tsx`.
- **Commit:** `d4f67ed`.

**6. [Rule 1 — Bug] meeting_follow_up_email requires a recipient**
- **Found during:** Task 3 reading wrapper signature.
- **Issue:** Plan draft said "Draft follow-up" would just pass `meetingId`. Real wrapper is `meetingFollowUpEmail({meetingId, recipient: String})`.
- **Fix:** Draft-follow-up opens a Dialog with a recipient Input pre-filled from the first participant (email heuristic); user can override before drafting.
- **Files modified:** `src/features/life-os/MeetingDetail.tsx`.
- **Commit:** `d4f67ed`.

**7. [Rule 1 — Bug] finance_get_transactions requires a date range**
- **Found during:** Task 2 reading wrapper.
- **Issue:** Plan draft said `financeGetTransactions(100)` (limit-only). Real signature is `{start_date, end_date, category?}`.
- **Fix:** View defaults to "last 90 days" starting from today. Date math uses `setDate(-90)`.
- **Files modified:** `src/features/life-os/FinanceView.tsx`.
- **Commit:** `39994bc`.

**8. [Rule 2 — Missing critical] Intl.NumberFormat guarded against invalid currency codes (T-06-03-05 mitigation)**
- **Found during:** Task 2.
- **Issue:** Constructing `Intl.NumberFormat` with an unknown currency code (e.g. from a corrupt prefs blob) throws `RangeError`. Would crash the route.
- **Fix:** Wrapped the constructor in try/catch — on throw, fallback to USD. Listed in the plan's threat register as T-06-03-05; implemented here.
- **Files modified:** `src/features/life-os/FinanceView.tsx`.
- **Commit:** `39994bc`.

**9. [Rule 2 — Missing critical] Destructive actions (goal delete, meeting delete, goal complete) confirmed via Dialog**
- **Found during:** Task 1 + Task 3 — applying threat register T-06-03-03.
- **Issue:** Plan draft said "Dialog confirm" for delete paths; implemented per spec with explicit Dialog gates for goalDelete, goalComplete, meetingDelete.
- **Fix:** Each mutation opens a Dialog → Cancel or confirm → invoke. No auto-delete.
- **Files modified:** `GoalView.tsx`, `MeetingDetail.tsx`.
- **Commit:** `f056620`, `d4f67ed`.

No architectural changes required. No checkpoints hit. No user decisions outstanding.

## Known Stubs

None in Plan 06-03's files. Every route is backed by live Rust command invocations; no hardcoded empty arrays, placeholder text, or "coming soon" stubs remain in any of the 5 surfaces or the MeetingDetail sub-component. Empty states render honest messages driven by actual query results (e.g. "No transactions in range — use Import CSV" rather than a hardcoded empty state that's hiding an unwired data path).

## Plan 06-04 / 06-05 / 06-06 Files Untouched

Verified via `git log --name-only` on my 3 commits (`f056620`, `39994bc`, `d4f67ed`):

- `src/features/life-os/SocialGraphView.tsx` — Plan 06-04. Untouched by 06-03.
- `src/features/life-os/PredictionsView.tsx` — Plan 06-04. Untouched by 06-03.
- `src/features/life-os/EmotionalIntelView.tsx` — Plan 06-04. Untouched by 06-03.
- `src/features/life-os/AccountabilityView.tsx` — Plan 06-04. Untouched by 06-03.
- `src/features/life-os/life-os-rich-b.css` — Plan 06-04. Untouched by 06-03.
- `src/features/identity/**` — Plans 06-05 + 06-06. Untouched by 06-03.
- `src/features/life-os/index.tsx` — Plan 06-02 single-writer invariant (D-143). Untouched by 06-03.

## Self-Check: PASSED

Verified artifacts exist:
- `src/features/life-os/HealthView.tsx` FOUND (510 lines, real body)
- `src/features/life-os/FinanceView.tsx` FOUND (804 lines, real body)
- `src/features/life-os/GoalView.tsx` FOUND (334 lines, real body)
- `src/features/life-os/HabitView.tsx` FOUND (439 lines, real body)
- `src/features/life-os/MeetingsView.tsx` FOUND (335 lines, real body)
- `src/features/life-os/MeetingDetail.tsx` FOUND (457 lines, new sub-component)
- `src/features/life-os/life-os-rich-a.css` FOUND (736 lines, scoped partial)

Verified commits exist:
- `f056620` — Task 1 (HealthView + GoalView + HabitView + life-os-rich-a.css)
- `39994bc` — Task 2 (FinanceView — SC-2)
- `d4f67ed` — Task 3 (MeetingsView + MeetingDetail)

All three commits on `master`. Zero destructive operations, zero sibling-plan file edits.
