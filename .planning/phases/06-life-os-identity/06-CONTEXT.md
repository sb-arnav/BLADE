# Phase 6: Life OS + Identity — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 06-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 6 --auto` (planner-picked defaults; Phase 5 template mirrored verbatim)

<domain>
## Phase Boundary

Phase 6 lights up two parallel clusters — **Life OS** (9 routes shipped as Phase 1 stubs) and **Identity** (7 routes shipped as Phase 1 stubs) — that were declared `ComingSoonSkeleton phase={6}` in Phase 1. Each cluster owns its own typed Tauri wrapper module (`src/lib/tauri/life_os.ts`, `src/lib/tauri/identity.ts`) and its own feature folder (`src/features/life-os/`, `src/features/identity/`). This phase consumes the Phase 1..5 substrate verbatim: 9 primitives, `invokeTyped`, `useTauriEvent`, `usePrefs`, `ConfigContext`, `MainShell`, `ROUTE_MAP`, `PALETTE_COMMANDS`, `ChatProvider`, design tokens, status tokens (D-132), `useRouterCtx`, `--font-mono`, and the cluster-scoped wrapper discipline Phase 5 established (D-118). It DOES NOT touch any other cluster (Agents + Knowledge = Phase 5, Dev Tools + Admin = Phase 7, Body + Hive = Phase 8).

**In scope:** 16 requirements — LIFE-01..09 (9; current `src/features/life-os/index.tsx` has 9 routes, not 10) + IDEN-01..07 (7; current `src/features/identity/index.tsx` has 7 routes, not 9). The ROADMAP §"Coverage Verification" lists LIFE-01..10 (10) + IDEN-01..09 (9) for a total of 19; however the Phase 1 substrate shipped 9+7. **Gate 1 audit (this phase):** cover the 16 that exist today and surface the 3 orphan requirement ids (LIFE-10, IDEN-08, IDEN-09) to the phase-completion retrospective. Per STATE.md / PROJECT.md discipline and the Phase 5 DP-3 precedent, the shipped stubs are canonical — re-adding routes per cluster is scope expansion without source justification.

**Out of scope for Phase 6:**
- Agents + Knowledge cluster (Phase 5)
- Dev Tools + Admin cluster (Phase 7)
- Body visualization + Hive mesh (Phase 8)
- Polish pass — error boundaries, WCAG re-sweep, empty-state illustrations (Phase 9)
- Persona + character editor that would overwrite `character.rs` baseline (Phase 7 Admin — read-only in Phase 6)
- New `#[tauri::command]` additions — every surface below maps to an EXISTING registered command (170+ life-os + identity commands in `lib.rs:759-1282`). Zero Rust surface expansion in Phase 6. If a pane would need a new command, it ships as a `ComingSoonSkeleton phase={7|9}` or documented deferral — never ships with a faked invoke name. (Same discipline as Phase 5 D-119.)

**Key Phase 1..5 substrate Phase 6 leans on (no drift permitted):**
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/chat.ts`, `config.ts`, `window.ts`, `agents.ts`, `knowledge.ts` — existing wrapper pattern (Phase 5 adds `agents.ts` + `knowledge.ts`; Phase 6 adds `life_os.ts` + `identity.ts`)
- `src/lib/events/index.ts` + `payloads.ts` — Phase 5 expanded to ~55+ events. Phase 6 does NOT add new event constants by default (most Phase 6 modules are request-response, not pub/sub); if any module emits lifecycle events (e.g. `character_trait_updated`, `goal_pursue_update`), Plan 06-01 extends the registry OR the clusters subscribe via the existing generic payload shapes.
- `src/design-system/primitives/*` — Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` blob; Phase 6 adds `lifeOs.activeTab`, `lifeOs.health.unit`, `lifeOs.finance.currency`, `identity.activeTab`, `identity.persona.expandedTrait` dotted keys (D-148)
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — error toasts
- `src/windows/main/MainShell.tsx` — gate-on-onboarding + Suspense route slot
- `src/windows/main/useRouter.ts` — `useRouterCtx`, `openRoute`
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — plus the 4 status tokens Phase 5 Plan 05-02 introduced (`--status-idle/running/success/error`)
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted in MainShell (D-116 retained; Phase 6 clusters do NOT re-hoist)
- `src/features/dashboard/hormoneChip.tsx` — reusable chip (referenced by HealthView hormone indicators + CharacterBible trait chips if needed; NOT a hard dep)
- `src/features/agents/useAgentTimeline.ts` — Phase 5 Pattern §2 reference; NOT imported by Phase 6, but the rAF-flush + ref-buffer recipe is reused for any high-frequency Phase 6 surface (e.g. character trait updates during conversation).

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering from STATE.md (D-01..D-138 locked through Phase 5). Phase 6 adds D-139..D-158.

### Scope philosophy + cluster parallelism (inherits Phase 5 discipline)

- **D-139:** **Per-cluster wrapper module discipline (inherits D-118).** Each cluster owns ONE new wrapper file — `src/lib/tauri/life_os.ts` (Life OS cluster) and `src/lib/tauri/identity.ts` (Identity cluster). Neither file is shared. This lets Life-OS-wave plans and Identity-wave plans ship in parallel with zero `files_modified` overlap, satisfying the same-wave plans have no file conflicts invariant. Rationale: the ROADMAP Phase 6 description literally says "each cluster wires its own `lib/tauri/` module." We honor that word-for-word, exactly as Phase 5 did for agents/knowledge.

- **D-140:** **No new Rust commands in Phase 6 (zero-Rust invariant; inherits D-119).** Every surface below maps to an EXISTING `#[tauri::command]` registered in `lib.rs:759-1282`. Audit inventory (170+ commands across 23 modules):
  - **Life OS side — ~110 commands:**
    - `health_tracker::*` — 9 commands (`health_log`, `health_get_today`, `health_update_today`, `health_get_logs`, `health_get_stats`, `health_get_insights`, `health_get_context`, `health_correlate_productivity`, `health_streak_info`) per lib.rs:1105-1113
    - `health::*` — 3 commands (`health_get_scan`, `health_scan_now`, `health_summary_all`) per lib.rs:860-862
    - `health_guardian::*` — 2 commands (`health_guardian_stats`, `health_take_break`) per lib.rs:1234-1235
    - `financial_brain::*` — 15 commands (`finance_add_transaction`, `finance_get_transactions`, `finance_delete_transaction`, `finance_get_snapshot`, `finance_generate_insights`, `finance_get_goals`, `finance_create_goal`, `finance_update_goal`, `finance_investment_suggestions`, `finance_budget_recommendation`, `finance_get_context`, `finance_import_csv`, `finance_auto_categorize`, `finance_spending_summary`, `finance_detect_subscriptions`) per lib.rs:1063-1073 + 1229-1232
    - `goal_engine::*` — 6 commands (`goal_add`, `goal_list`, `goal_complete`, `goal_delete`, `goal_update_priority`, `goal_pursue_now`) per lib.rs:947-952
    - `habit_engine::*` — 10 commands (`habit_create`, `habit_list`, `habit_get`, `habit_complete`, `habit_skip`, `habit_get_logs`, `habit_get_today`, `habit_insights`, `habit_suggest_design`, `habit_get_context`) per lib.rs:1124-1133
    - `meeting_intelligence::*` — 10 commands (`meeting_process`, `meeting_get`, `meeting_list`, `meeting_search`, `meeting_delete`, `meeting_get_action_items`, `meeting_complete_action`, `meeting_follow_up_email`, `meeting_compare`, `meeting_recurring_themes`) per lib.rs:1135-1144
    - `social_graph::*` — 11 commands (`social_add_contact`, `social_get_contact`, `social_search_contacts`, `social_update_contact`, `social_delete_contact`, `social_list_contacts`, `social_log_interaction`, `social_get_interactions`, `social_analyze_interaction`, `social_get_insights`, `social_how_to_approach`) per lib.rs:1093-1103
    - `prediction_engine::*` — 6 commands (`prediction_get_pending`, `prediction_accept`, `prediction_dismiss`, `prediction_generate_now`, `prediction_contextual`, `prediction_get_patterns`) per lib.rs:1155-1160
    - `emotional_intelligence::*` — 5 commands (`emotion_get_current`, `emotion_get_trend`, `emotion_get_readings`, `emotion_analyze_patterns`, `emotion_get_context`) per lib.rs:1162-1166
    - `accountability::*` — 8 commands (`accountability_get_objectives`, `accountability_create_objective`, `accountability_update_kr`, `accountability_daily_plan`, `accountability_complete_action`, `accountability_checkin`, `accountability_progress_report`, `accountability_get_daily_actions`) per lib.rs:1015-1022
    - `streak_stats::*` — 3 commands (`streak_get_stats`, `streak_record_activity`, `streak_get_display`) per lib.rs:1280-1282
    - `people_graph::*` — 7 commands (`people_list`, `people_get`, `people_upsert`, `people_delete`, `people_suggest_reply_style`, `people_learn_from_conversation`, `people_get_context_for_prompt`) per lib.rs:1265-1271
    - `learning_engine::learning_get_predictions` — 1 command per lib.rs:954
    - `temporal_intel::temporal_meeting_prep` — 1 command per lib.rs:1240 (consumed by MeetingsView pre-meeting pane)
  - **Identity side — ~40 commands:**
    - `character::*` — 7 commands (`consolidate_character`, `consolidate_reactions_to_preferences`, `reaction_instant_rule`, `blade_get_soul`, `get_character_bible`, `update_character_section`, `apply_reaction_to_traits`) per lib.rs:759-769
    - `soul_commands::*` — 6 commands (`soul_get_state`, `soul_take_snapshot`, `soul_delete_preference`, `soul_update_bible_section`, `soul_refresh_bible`, `get_user_profile`) per lib.rs:917-922
    - `persona_engine::*` — 13 commands (`persona_get_traits`, `persona_get_relationship`, `persona_update_trait`, `persona_get_context`, `persona_analyze_now`, `persona_record_outcome`, `persona_analyze_now_weekly`, `get_user_model`, `predict_next_need_cmd`, `get_expertise_map`, `update_expertise`, `persona_estimate_mood`) per lib.rs:1031-1043
    - `negotiation_engine::*` — 11 commands (`negotiation_build_argument`, `negotiation_steelman`, `negotiation_find_common_ground`, `negotiation_start_debate`, `negotiation_round`, `negotiation_conclude`, `negotiation_analyze`, `negotiation_roleplay`, `negotiation_critique_move`, `negotiation_get_debates`, `negotiation_get_scenarios`) per lib.rs:1074-1085
    - `reasoning_engine::*` — 5 commands (`reasoning_think`, `reasoning_decompose`, `reasoning_test_hypothesis`, `reasoning_socratic`, `reasoning_get_traces`) per lib.rs:1087-1091
    - `context_engine::*` — 3 commands (`context_assemble`, `context_score_chunk`, `context_clear_cache`) per lib.rs:1059-1061
    - `sidecar::*` — 7 commands (`sidecar_list_devices`, `sidecar_register_device`, `sidecar_remove_device`, `sidecar_ping_device`, `sidecar_run_command`, `sidecar_run_all`, `sidecar_start_server`) per lib.rs:1007-1013
    - `personality_mirror::*` — 3 commands (`personality_analyze`, `personality_import_chats`, `personality_get_profile`) per lib.rs:1249-1251
    - `kali::*` — 6 commands (`kali_recon`, `kali_crack_hash`, `kali_analyze_ctf`, `kali_explain_exploit`, `kali_generate_payload`, `kali_check_tools`) per lib.rs:961-966 (note: kali commands MAY appear in Sidecar route OR deferred; planner chose Sidecar per D-154)
  Rationale: D-50 + D-66 + D-119 + D-140 triad — no Rust expansion until a surface proves it needs one. If a route cannot be wired to an existing command, it ships `ComingSoonSkeleton phase={next}` and logs the gap in the plan SUMMARY. This matches the Phase 5 D-119 pattern of upgrading-in-place rather than adding commands.

- **D-141:** **ComingSoonSkeleton retained for sub-features that exceed budget OR lack backend.** Routes we SHIP REAL:
  - Life OS: HealthView, FinanceView, GoalView, HabitView, MeetingsView, SocialGraphView, PredictionsView, EmotionalIntelView, AccountabilityView — all 9 get at least a thin wired surface.
  - Identity: SoulView, PersonaView, CharacterBible, NegotiationView, ReasoningView, ContextEngineView, SidecarView — all 7 get at least a thin wired surface.
  - Every route exits the "404-looking" state by rendering a real `GlassPanel` with its route label, a brief description, and either LIVE data (where wired) or a clearly-labeled `"Ships in Phase 9 polish"` sub-skeleton with dev-mode route id visible.
  - Rationale: ROADMAP SC-1/SC-3 say "Navigating to any Life OS/Identity route produces a rendered surface with no 404 fallback." ComingSoonSkeleton meets this criterion by design (Phase 1 D-44) — but Phase 6 targets REAL surfaces for all 16 in-scope routes since every one has backend commands available.

### Plan-split strategy (7 plans across 4 waves — mirrors Phase 5 exactly)

- **D-142:** **Plan split:**
  - **Plan 06-01** (wave 1 — event registry + payloads + usePrefs): adds any missing life-os + identity event constants + payload interfaces to `src/lib/events/index.ts` + `payloads.ts` + extends `src/hooks/usePrefs.ts` with 5 new Phase 6 dotted keys. Pure TS plumbing. Isolated `files_modified`; can run parallel with any other wave-1 plan. **Most Phase 6 modules are request-response (not pub/sub) — this plan's event additions are smaller than Phase 5's; main work is the Prefs extension.** If Rust emits no lifecycle events worth subscribing from Life OS / Identity (audit during plan execution), the event-registry portion is a no-op and this plan is nearly all Prefs.
  - **Plan 06-02** (wave 1 — wrappers + index.tsx rewrites): creates `src/lib/tauri/life_os.ts` with typed wrappers for the ~110 Rust Life OS commands (see D-140 inventory). Also creates `src/lib/tauri/identity.ts` with typed wrappers for the ~40 Rust Identity commands. Rewrites both cluster `index.tsx` files — `src/features/life-os/index.tsx` to 9 lazy imports; `src/features/identity/index.tsx` to 7 lazy imports. Seeds 16 per-route placeholder files that Plans 06-03..06 will fill in. Creates 2 cluster CSS files + 2 types barrels + minor tokens.css extensions. Zero `files_modified` overlap with 06-01 or 06-03..06. Same recipe as Plan 05-02 verbatim.
  - **Plan 06-03** (wave 2 — Life OS "rich" surfaces A): HealthView, FinanceView, GoalView, HabitView, MeetingsView. Covers LIFE-01..05 (approximately — routes matched to shipped order in `src/features/life-os/index.tsx`).
  - **Plan 06-04** (wave 2 — Life OS "rich" surfaces B): SocialGraphView, PredictionsView, EmotionalIntelView, AccountabilityView. Covers LIFE-06..09 (approximately). Parallel with 06-03 (no `files_modified` overlap — each plan touches its own sub-component files under `src/features/life-os/`). **Split point between 06-03 and 06-04 is 5+4 (not 5+5) because LIFE has only 9 routes, not 10.**
  - **Plan 06-05** (wave 2 — Identity "rich" surfaces A): SoulView, PersonaView, CharacterBible, NegotiationView. Covers IDEN-01..04 (approximately).
  - **Plan 06-06** (wave 2 — Identity "rich" surfaces B): ReasoningView, ContextEngineView, SidecarView. Covers IDEN-05..07 (approximately). Parallel with 06-03, 06-04, 06-05 (zero overlap). **Split is 4+3 (not 5+4) because IDEN has only 7 routes, not 9.**
  - **Plan 06-07** (wave 3 — Playwright specs + verify scripts + Mac operator smoke checkpoint): adds 4 new Playwright specs (life-os-health-view, life-os-finance-view, identity-character-bible, identity-persona-view); extends `verify:all` with `verify-phase6-rust-surface.sh` that asserts ALL 150+ Phase 6 Rust commands (D-140 inventory) are registered + extends `verify-feature-cluster-routes.sh` to include the 9+7 new routes; registers 4 dev-only routes for each plan's isolation harness; documents Mac-session M-21..M-27 for operator.
  Rationale: 4 of the 5 wave-2 plans run in parallel because each owns its own subtree under `src/features/life-os/` or `src/features/identity/` + isolated subset of sub-component files. Wave 1 (registry/prefs + wrappers) ships first because 06-03..06 import from both. Wave 3 (Playwright + Mac smoke) ships last because it needs the prior 5 to land. That's the same dep-topology Phase 5 used.

- **D-143:** **`files_modified` no-overlap invariant (inherits D-122).** Each wave-2 plan (06-03, 06-04, 06-05, 06-06) touches a DISJOINT set of files under `src/features/life-os/*` or `src/features/identity/*`. The ONLY shared files across the cluster are `src/features/life-os/index.tsx` and `src/features/identity/index.tsx`. To prevent merge conflicts on the index files, **the wrapper plan 06-02 does the ONE rewrite of each `index.tsx`** (replacing the Phase 1 skeleton exports with direct lazy imports to per-route files). Wave-2 plans only CREATE the per-route files they own and NEVER edit either index.tsx. Same single-writer invariant as Plan 05-02.

### Rust verification + gaps (no new Rust — but verify existing)

- **D-144:** **No Plan 06-00 for Rust.** Phase 6 does NOT need a Rust plan — everything is pre-wired. Plan 06-07 adds a single verify script (`scripts/verify-phase6-rust-surface.sh`) that greps `lib.rs` for the 150+ commands in D-140 inventory and fails if any is missing. This is a DEFENSIVE check: if a future Rust refactor accidentally unregisters a command, Phase 6's verify:all catches it instantly. Mirrors Phase 5's `verify:phase5-rust` approach. Runs in CI per Phase 1 D-31.

### Per-cluster visual decisions (Phase 6 specific — D-145..D-158)

- **D-145:** **HealthView layout.** HealthView (LIFE-01) renders:
  - Top: today's snapshot (from `health_get_today`) as a 5-stat grid (sleep / activity / mood / energy / focus), each stat a `GlassPanel tier={2}` card with a progress ring or numeric readout.
  - Middle: streak chip (from `health_streak_info`) + "Update today" button that opens a Dialog with fields backed by `health_update_today({...})`.
  - Bottom: insights section (from `health_get_insights`) as a bullet list + "Correlate with productivity" button invoking `health_correlate_productivity` (results rendered as a simple scatter-plot-free bullet summary to avoid chart library deps).
  - Scan controls: `health_scan_now` button (idempotent) + last-scan timestamp from `health_get_scan`.
  - Rationale: matches the backend surface; no chart library needed; text-first readouts per D-02 CSS-only motion discipline.

- **D-146:** **FinanceView layout.** FinanceView (LIFE-02) renders:
  - Top: KPI row — snapshot (from `finance_get_snapshot`): balance / spending-this-month / savings-rate / subscription-burn as 4 `GlassPanel tier={2}` stat cards.
  - Left pane (60%): transactions list (from `finance_get_transactions({limit: 100})`) — each row: date + merchant + category + amount (signed color — green income / red spending via `--status-success`/`--status-error`).
  - Right pane (40%): tabs — "Goals" (from `finance_get_goals`) with create-goal inline form; "Insights" (from `finance_generate_insights`) as bullet list; "Subscriptions" (from `finance_detect_subscriptions`) as recurring-charge list.
  - Toolbar: "Import CSV" button → file picker Dialog → `finance_import_csv({path})`; "Auto-categorize" button → `finance_auto_categorize()` → toast with counts.
  - Rationale: ROADMAP SC-2 ("FinanceView displays a spending overview loaded via financial_* commands; CSV import affordance is present"). Import CSV affordance is EXPLICIT per SC-2. Subscriptions + insights go in the right pane as secondary content. Currency formatting uses browser Intl.NumberFormat — NO new dep.

- **D-147:** **GoalView + HabitView share a card grid.** Both surfaces render their entities as `.life-card` grid entries (shared CSS class in `life-os.css`). GoalView (LIFE-03) calls `goal_list()` + priority pills + "Pursue now" button invoking `goal_pursue_now(id)`. HabitView (LIFE-04) calls `habit_get_today()` + `habit_list()` + per-habit "Complete" / "Skip" buttons invoking `habit_complete(id)` / `habit_skip(id)`. Suggest-design button calls `habit_suggest_design({goal})` → shows LLM response in a Dialog. Rationale: D-132 per-cluster CSS discipline; GoalView + HabitView share the same visual motif (checkbox grid).

- **D-148:** **MeetingsView layout.** MeetingsView (LIFE-05) renders:
  - Left sidebar: meetings list (from `meeting_list({limit: 50})`) — each row: title + date + duration.
  - Right pane: selected meeting detail — `meeting_get(id)` → renders summary + action items (from `meeting_get_action_items(id)`) with per-item Complete button → `meeting_complete_action(action_id)`.
  - Top actions row: "Search" button → inline search via `meeting_search({query})`; "Compare" → Dialog to pick 2 meetings → `meeting_compare(a, b)`; "Recurring themes" → `meeting_recurring_themes()`.
  - Pre-meeting prep pane (if meeting is future): `temporal_meeting_prep({meeting_id})` → briefing shown inline.
  - Follow-up email: "Draft follow-up" button → `meeting_follow_up_email(id)` → rendered as copy-to-clipboard.
  - Rationale: matches backend surface; 4 of the 10 commands are action buttons, rest are data.

- **D-149:** **SocialGraphView layout.** SocialGraphView (LIFE-06) renders:
  - Top: search input (auto-debounced) → `social_search_contacts({query})` → result list.
  - Main: list of contacts (from `social_list_contacts()`) as `.contact-card` cards with name + relationship tag + recent-interaction chip.
  - Right pane on selection: `social_get_contact(id)` + `social_get_interactions(id, limit=20)` + `social_get_insights(id)` + "How to approach" button → `social_how_to_approach(id)` → Dialog with suggested opening.
  - New-contact form at top-right.
  - Log-interaction inline form per contact (quick-add).
  - `people_graph::*` (7 commands) used side-by-side — planner picks: Contacts-proper uses `social_*` (richer surface); `people_*` is exposed in PersonaView's "People" tab for cross-reference (per D-154 sub-tab decision). Rationale: two modules have overlapping concerns; SocialGraph gets the "primary CRM" role since its surface is richer (11 commands vs. 7). Documented divergence; both are valid data sources.

- **D-150:** **PredictionsView layout.** PredictionsView (LIFE-07) renders:
  - Top: "Generate now" button → `prediction_generate_now()` + loading spinner; on completion refreshes the pending list.
  - Main: pending predictions list (from `prediction_get_pending()`) — each card shows predicted action + confidence + timeframe + 2 buttons: Accept → `prediction_accept(id)`; Dismiss → `prediction_dismiss(id)`.
  - Secondary: patterns list (from `prediction_get_patterns()`) — showing learned behavior triggers.
  - Contextual prediction panel: calls `prediction_contextual({current_context})` where current_context is a small hardcoded form (active_app / time_of_day). Rationale: ROADMAP lists predictions as Life OS surface; all 6 commands map directly.

- **D-151:** **EmotionalIntelView layout.** EmotionalIntelView (LIFE-08) renders:
  - Top: current emotion state from `emotion_get_current()` as a large hormone-tinted card.
  - Trend sparkline (text-based, no chart library): `emotion_get_trend({window_hours: 24})` rendered as a series of emoji + intensity percentages.
  - History list (from `emotion_get_readings({limit: 50})`).
  - Analyze panel: "Analyze patterns" button → `emotion_analyze_patterns()` → bullet list.
  - Context assembler integration: shows `emotion_get_context()` as a "current emotional context that BLADE sees" panel.
  - Rationale: 5 commands, 5 panels; text-first rendering.

- **D-152:** **AccountabilityView layout.** AccountabilityView (LIFE-09) renders:
  - Top: today's daily plan from `accountability_daily_plan()` + `accountability_get_daily_actions()` — checklist of actions, tap to `accountability_complete_action(id)`.
  - Main: objectives list from `accountability_get_objectives()` — each objective card with key-results progress bars; tap a KR to edit via Dialog → `accountability_update_kr(objective_id, kr_id, value)`.
  - Create-objective form (inline at top of main pane).
  - Bottom: progress report button → `accountability_progress_report()` → markdown-ish text rendered inline; check-in button → `accountability_checkin(note)` → toast.
  - Rationale: matches backend surface; OKR pattern with daily actions.

- **D-153:** **SoulView layout (Identity).** SoulView (IDEN-01) renders:
  - Top: state card from `soul_get_state()` — shows the current soul snapshot (last-evolved timestamp, trait count, preference count).
  - Tabs: "Bible" (from `get_character_bible()` + `blade_get_soul()`) — rendered as markdown-ish text blocks, editable via `update_character_section(section, content)` + `soul_update_bible_section(section, content)`; "Profile" (from `get_user_profile()`) — read-only card; "Preferences" — list of preferences with delete button → `soul_delete_preference(id)`.
  - Actions: "Refresh Bible" button → `soul_refresh_bible()`; "Take snapshot" button → `soul_take_snapshot()`.
  - Edit flow: click a section → Dialog with textarea → save → invokes the update command → toast. **No auto-save; explicit confirmation only** (soul data is high-stakes; prevent accidental edits).
  - Rationale: ROADMAP SC-3 ("SoulView displays loaded identity document content"). Edit affordance added because the backend supports it; NOT auto-save.

- **D-154:** **PersonaView layout (Identity).** PersonaView (IDEN-02) renders a **tabbed surface** with 4 tabs:
  - **Traits tab** — `persona_get_traits()` + `persona_update_trait(name, score, evidence)`. Each trait card shows score bar + evidence. Click to edit → Dialog. **NOT auto-save; explicit.**
  - **Relationship tab** — `persona_get_relationship()` intimacy/trust bars + recent-moments list.
  - **User Model tab** — `get_user_model()` + `predict_next_need_cmd()` + `get_expertise_map()` + `persona_estimate_mood()` rendered as a read-only dossier. "Analyze now" button → `persona_analyze_now()`.
  - **People tab** — `people_list()` + per-person card (name + relationship + suggest-reply-style button → `people_suggest_reply_style(person, message)`). Upsert form. Cross-reference with SocialGraphView (D-149) noted in each card.
  - Rationale: persona_engine has 13 commands — too many for a single flat surface. 4-tab layout keeps each tab tight; tab selection persisted via `identity.activeTab` pref.

- **D-155:** **CharacterBible layout (Identity).** CharacterBible (IDEN-03) renders:
  - Top: consolidated bible text from `get_character_bible()` as a scrollable markdown-ish text block.
  - Secondary section: trait evolution log — planner picks rendering it as a reverse-chrono list of `apply_reaction_to_traits` / `reaction_instant_rule` historical entries. **If no log table exists in Rust (likely — these are mutators not readers), defer the log view to Phase 9 polish and show an honest `"Trait evolution log ships in Phase 9 polish"` card** instead of faking data. Rationale: ROADMAP SC-4 ("CharacterBible shows the trait evolution log from character.rs feedback data; thumbs-up/down from Chat round-trips to visible trait updates") — the round-trip side is observable (chat thumbs fires `apply_reaction_to_traits` → `persona_get_traits()` refresh shows updated score). If the "evolution log" requires a new reader command, follow D-140 and defer honestly.
  - Actions: "Consolidate" button → `consolidate_character()`; "Reactions → preferences" button → `consolidate_reactions_to_preferences()`; "Update section" edit flow as in SoulView.
  - Rationale: covers ROADMAP SC-4 pragmatically without inventing Rust; documents divergence if log data unavailable.

- **D-156:** **NegotiationView layout (Identity).** NegotiationView (IDEN-04) renders:
  - Top tabs: "Debate" / "Scenarios" / "Analyze" / "Tools".
    - **Debate tab**: start-debate form (topic + stance) → `negotiation_start_debate({topic, stance})` → begins debate session; `negotiation_round({round_arg})` submission input + current round output; `negotiation_conclude()` closes session; `negotiation_get_debates()` sidebar list.
    - **Scenarios tab**: `negotiation_get_scenarios()` list + `negotiation_roleplay({scenario})` session.
    - **Analyze tab**: `negotiation_analyze({conversation})` with a paste-area input.
    - **Tools tab**: `negotiation_build_argument`, `negotiation_steelman`, `negotiation_find_common_ground`, `negotiation_critique_move` — each as a compact tool card with input + run button.
  - Rationale: 11 commands, 4 tabs, reasonable flow; matches backend surface.

- **D-157:** **ReasoningView layout (Identity).** ReasoningView (IDEN-05) renders:
  - Top: input prompt textarea + 4 tool buttons: "Think" → `reasoning_think(prompt)`; "Decompose" → `reasoning_decompose(problem)`; "Test Hypothesis" → `reasoning_test_hypothesis(hypothesis)`; "Socratic" → `reasoning_socratic(question)`. Each renders output inline below input.
  - Bottom: recent traces from `reasoning_get_traces({limit: 20})` as collapsible list.
  - Rationale: 5 commands, 1 input surface, 1 output rendering path, 1 history. Minimal but functional.

- **D-158:** **ContextEngineView + SidecarView (dev-adjacent surfaces).**
  - **ContextEngineView (IDEN-06)**: `context_assemble({query})` input + result card; `context_score_chunk({chunk})` advanced input in a secondary section; `context_clear_cache()` action with Dialog confirm.
  - **SidecarView (IDEN-07)**: `sidecar_list_devices()` → devices table; per-device: `sidecar_ping_device(id)` chip + `sidecar_run_command(id, cmd)` inline; "Register" form → `sidecar_register_device(...)`; "Run on all" → `sidecar_run_all(cmd)` with Dialog confirm. Kali tools exposed as a "Pentest utilities" sub-section with 6 cards (one per kali command: `kali_recon`, `kali_crack_hash`, `kali_analyze_ctf`, `kali_explain_exploit`, `kali_generate_payload`, `kali_check_tools`). Rationale: Kali commands have no other home in Phase 6 routes; Sidecar is the closest thematic match (offsite device + pentest). Alternative: defer kali to Phase 7 Admin; planner chose Sidecar because the commands are already exposed in Identity's surface per module registration, and ROADMAP Phase 7 DEV-* doesn't mention kali either. Documented divergence; Phase 7 retrospective may re-home.

### Data shape + payload discipline (inherits D-126..D-128)

- **D-159:** **Typed wrapper per command (reuses D-126 recipe).** `src/lib/tauri/life_os.ts` exports one camelCase function per Rust command — each with `invokeTyped<TReturn, TArgs>(command, args)`, JSDoc `@see src-tauri/src/<file>.rs`, and camelCase → snake_case conversion at invoke boundary. Return types are hand-written interfaces in the SAME file. Same for `identity.ts`.

- **D-160:** **Payload type source = Rust struct definitions (reuses D-127).** No zod, no codegen. Drift caught in code review + Playwright spec runtime casts. Every return type has `[k: string]: unknown` index signature for forward-compat.

- **D-161:** **`src/features/life-os/types.ts` + `src/features/identity/types.ts` centralise cluster-local type exports** (inherits D-128). Re-exports + cluster-only UI types.

### Event subscription discipline (inherits D-129..D-130)

- **D-162:** **Event subscriptions for Phase 6 are sparse.** Most Phase 6 modules are request-response (CRUD + compute-now pattern). The candidate emits we may subscribe to:
  - `godmode_update` / `hormone_update` — already wired in Phase 3 Dashboard ambient strip; EmotionalIntelView may read via `useTauriEvent` to refresh current-emotion card, but can equally poll on focus.
  - Character / soul trait updates — if `apply_reaction_to_traits` or `update_character_section` emits (audit during Plan 06-01), CharacterBible + PersonaView subscribe; otherwise polling on action completion is fine.
  - `health_nudge` — emitted by `health_tracker::start_health_nudge_loop`; HealthView may subscribe for toast notifications.
  Rationale: Phase 6 doesn't have a "10-subscription surface" like AgentDetail. Event extensions are opportunistic.

### Frontend architecture (inherits D-131..D-136)

- **D-163:** **Per-route file layout** under `src/features/life-os/` and `src/features/identity/`:
  ```
  src/features/life-os/
    index.tsx                    — RouteDefinition[] (EDITED ONCE in Plan 06-02)
    types.ts                     — cluster-local types
    HealthView.tsx               — LIFE-01
    FinanceView.tsx              — LIFE-02
    GoalView.tsx                 — LIFE-03
    HabitView.tsx                — LIFE-04
    MeetingsView.tsx             — LIFE-05
    SocialGraphView.tsx          — LIFE-06
    PredictionsView.tsx          — LIFE-07
    EmotionalIntelView.tsx       — LIFE-08
    AccountabilityView.tsx       — LIFE-09
    life-os.css                  — cluster-scoped CSS via layer
    (+ sub-component files where a route has non-trivial composition — e.g. MeetingsView may split into MeetingsSidebar.tsx + MeetingDetail.tsx)
  ```
  Same layout under `src/features/identity/` with files SoulView.tsx, PersonaView.tsx, CharacterBible.tsx, NegotiationView.tsx, ReasoningView.tsx, ContextEngineView.tsx, SidecarView.tsx, identity.css (+ sub-components where needed — PersonaView's 4 tabs may split into PersonaTraitsTab.tsx etc.). Each wave-2 plan owns ~4-5 of these files; all files unique to a single plan.

- **D-164:** **CSS discipline.** Each cluster owns ONE CSS file (`life-os.css`, `identity.css`) that all sub-components share. No per-component CSS file unless a route has a genuinely orthogonal design (e.g., `MeetingDetail.css` for the two-pane layout, `PersonaView.css` for the 4-tab surface). Uses Phase 1 tokens via `var(--glass-1-bg)` etc. D-07 blur caps enforced. Uses Phase 5 Plan 05-02 status tokens (`--status-running` etc.) verbatim.

- **D-165:** **`usePrefs` extensions for Phase 6:**
  - `lifeOs.activeTab` — e.g. MeetingsView tab, FinanceView right-pane tab
  - `lifeOs.health.unit` — `'metric' | 'imperial'` for display conversion
  - `lifeOs.finance.currency` — ISO currency code default for Intl.NumberFormat
  - `identity.activeTab` — PersonaView / NegotiationView tab memory
  - `identity.persona.expandedTrait` — last-expanded trait id in PersonaView
  Five new dotted keys. Zero Rust impact (per D-12 all prefs are frontend-only localStorage). Plan 06-01 adds these.

### Claude's Discretion (planner-chosen defaults)

- Exact CSS grid template for HealthView 5-stat row — planner picks `repeat(auto-fit, minmax(160px, 1fr))`.
- Exact color palette for KPI cards in FinanceView — planner picks rgba accent per status token + neutral card bg.
- Whether GoalView + HabitView share a sidebar — planner picks "no shared sidebar; each is self-contained" (simpler).
- Whether PersonaView 4 tabs are pill-shaped or underlined — planner picks pill-shaped (matches Phase 5 AgentDashboard filter pills).
- Whether ContextEngineView shows raw assembled context in a `<pre>` block — planner picks yes (dev-adjacent surface; developer ergonomics over polish).
- Whether SidecarView exposes `sidecar_start_server` button — planner picks yes, gated behind Dialog confirmation (server lifecycle is disruptive).
- Whether NegotiationView renders debate transcripts as chat bubbles or plain text — planner picks plain text rows (chat bubbles would require Phase 3 chat infra reuse; overhead not worth it for Phase 6).
- Whether AccountabilityView shows OKRs as a tree or a flat list — planner picks flat list grouped by objective (tree is over-engineered for MVP).
- Whether MeetingsView pre-meeting prep panel is a modal or inline — planner picks inline (lighter cognitive load).
- Whether FinanceView's CSV import accepts drag-drop — planner picks "button + file picker Dialog only" (drag-drop adds edge cases; button is simpler).
- Whether Kali sub-section ships in Phase 6 at all — planner picks yes per D-158 (Sidecar home), but each Kali card is opt-in (click-to-expand; default collapsed).
- Whether EmotionalIntelView sparkline is ASCII or emoji — planner picks emoji (🟢🟡🔴 intensity bars) — no fontface dep.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 6: Life OS + Identity" — goal, 19 requirements (LIFE-01..10 + IDEN-01..09), success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-138, Phase 1..5 substrate inventory
- `.planning/RECOVERY_LOG.md` — event catalog; emit policy

### Phase 1..5 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — D-64..D-92
- `.planning/phases/04-overlay-windows/04-CONTEXT.md` — D-93..D-117
- `.planning/phases/05-agents-knowledge/05-CONTEXT.md` — D-118..D-138 (PHASE 6 MIRRORS THIS FILE'S STRUCTURE)
- `.planning/phases/05-agents-knowledge/05-PATTERNS.md` — §1 wrapper recipe, §2 rAF flush, §5 cluster index rewrite, §7 Playwright recipe, §8 verify script recipe, §10 common CSS
- `.planning/phases/05-agents-knowledge/05-0{1..7}-PLAN.md` — 7-plan template this phase copies verbatim

### Phase 0 artifacts (inputs)
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` — life-os + identity command signatures (if present)
- `.planning/phases/00-pre-rebuild-audit/00-PROTO-FLOW.md` — prototype flows for identity + life surfaces (if present)

### Code Phase 6 extends (read-only inputs)

**Frontend (substrate):**
- `src/windows/main/MainShell.tsx`, `src/windows/main/useRouter.ts`
- `src/lib/router.ts` — `RouteDefinition`
- `src/lib/tauri/*.ts` — Phase 1..5 wrappers; Phase 6 adds `life_os.ts` + `identity.ts`
- `src/lib/events/index.ts` + `payloads.ts` — 55+ events from Phase 5
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx`
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted at MainShell (D-116); Phase 6 routes may read via `useChatCtx`
- `src/features/dashboard/hormoneChip.tsx` — reusable chip primitive
- `src/design-system/primitives/*` — 9 primitives + ComingSoonSkeleton + Dialog
- `src/hooks/usePrefs.ts` — Phase 6 adds 5 new keys (D-165)
- `src/features/agents/useAgentTimeline.ts` — Pattern §2 rAF-flush reference

**Feature folders (Phase 1 stubs — Phase 6 replaces):**
- `src/features/life-os/index.tsx` (9 stubs — Phase 6 Plan 06-02 rewrites)
- `src/features/identity/index.tsx` (7 stubs — Phase 6 Plan 06-02 rewrites)

### Rust source (authoritative for wrapper cites — NO Rust modifications in Phase 6)
- `src-tauri/src/lib.rs:759-1282` — `generate_handler![]` confirming all 150+ Phase 6 commands registered (see D-140 inventory)
- `src-tauri/src/character.rs` — 7 character commands
- `src-tauri/src/soul_commands.rs` — 6 soul commands
- `src-tauri/src/persona_engine.rs` — 13 persona commands
- `src-tauri/src/negotiation_engine.rs` — 11 negotiation commands
- `src-tauri/src/reasoning_engine.rs` — 5 reasoning commands
- `src-tauri/src/context_engine.rs` — 3 context commands
- `src-tauri/src/sidecar.rs` — 7 sidecar commands
- `src-tauri/src/personality_mirror.rs` — 3 personality commands
- `src-tauri/src/kali.rs` — 6 kali commands
- `src-tauri/src/health_tracker.rs` — 9 health-tracker commands
- `src-tauri/src/health.rs` — 3 health-scan commands
- `src-tauri/src/health_guardian.rs` — 2 guardian commands
- `src-tauri/src/financial_brain.rs` — 15 finance commands
- `src-tauri/src/goal_engine.rs` — 6 goal commands
- `src-tauri/src/habit_engine.rs` — 10 habit commands
- `src-tauri/src/meeting_intelligence.rs` — 10 meeting commands
- `src-tauri/src/social_graph.rs` — 11 social commands
- `src-tauri/src/prediction_engine.rs` — 6 prediction commands
- `src-tauri/src/emotional_intelligence.rs` — 5 emotion commands
- `src-tauri/src/accountability.rs` — 8 accountability commands
- `src-tauri/src/streak_stats.rs` — 3 streak commands
- `src-tauri/src/people_graph.rs` — 7 people commands
- `src-tauri/src/learning_engine.rs` — 1 learning command
- `src-tauri/src/temporal_intel.rs` — 1 temporal command (meeting prep)

### Prototype / design authority (READ-ONLY reference per D-17)
- `src.bak/components/HealthDashboard.tsx, FinanceView.tsx, GoalsView.tsx, HabitsView.tsx, MeetingsView.tsx, CharacterBible.tsx, PersonaView.tsx, SoulView.tsx` if present — algorithmic / layout reference only (retype, never import)

### Explicitly NOT to read (D-17 applies)
- Any `src.bak/` file for import. Planner + executor MAY consult as READ-ONLY layout ground truth; every line of code is retyped in the new feature folder against the Phase 1 primitives + tokens.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1..5 substrate Phase 6 extends

- `src/features/life-os/index.tsx` currently exports 9 `ComingSoonSkeleton` routes (NOT 10 per ROADMAP). Plan 06-02 rewrites this file to import 9 lazy per-route components from `./HealthView.tsx` etc.
- `src/features/identity/index.tsx` currently exports 7 `ComingSoonSkeleton` routes (NOT 9 per ROADMAP). Plan 06-02 rewrites to 7 lazy per-route components. **3 orphan requirements (LIFE-10, IDEN-08, IDEN-09) are flagged for retrospective per DP-3.**
- `src/lib/tauri/` currently has 11 wrapper files (9 from Phase 1..4 + 2 from Phase 5). Plan 06-02 adds 2 new files (`life_os.ts`, `identity.ts`). ESLint `no-raw-tauri` rule applies to both.
- `src/lib/events/index.ts` currently declares 55+ event constants from Phase 5. Plan 06-01 adds 0-5 new constants depending on emit audit.

### Patterns already established that Phase 6 MUST follow

- **Wrapper recipe:** (inherits Phase 5 §1 verbatim).
- **Event subscription:** `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`. Handler-in-ref; subscription keyed on `[name]` only.
- **Pref writes:** `setPref('dotted.key', value)` — debounced 250ms, single localStorage blob.
- **Style:** compose `.glass .glass-1/2/3` + primitive classes; Tailwind utilities for layout only. No hardcoded hex colors.
- **Routes:** append a `RouteDefinition` to the feature index's `routes` array. Phase 6 edits `src/features/life-os/index.tsx` + `src/features/identity/index.tsx` ONCE each (in Plan 06-02) to replace skeletons with lazy imports.
- **rAF flush:** Reserved for high-frequency streaming surfaces. Phase 6 likely doesn't use it (mostly CRUD + compute-now); if a surface is identified during implementation that bursts events, use `src/features/agents/useAgentTimeline.ts` as a template.
- **D-116 ChatProvider hoisting:** `useChat`/`ChatProvider` lives in MainShell ONLY — downstream routes read via `useChatCtx`. Do NOT re-provide.

### Test harness

- `playwright.config.ts` + `tests/e2e/*.spec.ts` already shipped in Plans 01-09, 02-07, 03-07, 04-07, 05-07. Phase 6 Plan 06-07 adds 4 new specs reusing the same `@tauri-apps/test` harness. `npm run test:e2e` runs them. No new test deps.
- `verify:all` scripts live in `scripts/`. Phase 6 Plan 06-07 adds `scripts/verify-phase6-rust-surface.sh` and extends `scripts/verify-feature-cluster-routes.sh` to include the new 9+7 routes.

### Rust patterns Phase 6 does NOT extend

Phase 6 touches **zero Rust files** (D-140 / zero-Rust invariant inherited from Phase 5 D-119). The Rust surface is frozen — every command used by Phase 6 is already registered in `lib.rs:759-1282`. If a gap is discovered during planning or execution, the plan MUST document the gap in SUMMARY + defer the affected route to a ComingSoonSkeleton rather than ship a hand-rolled/mocked Rust command.

### Dev experience patterns Phase 6 leans on

- All dev-only routes stay palette-hidden + gated on `import.meta.env.DEV`. Plan 06-07 may register dev-only isolation harnesses for per-route Playwright specs (same pattern as `VoiceOrbDev.tsx`).
- All CI verification scripts live in `scripts/` as Node ESM (`.mjs`) or bash (`.sh`); runnable via `npm run verify:<check>`.
- ESLint `no-raw-tauri` rule continues to apply.
- `__TAURI_EMIT__` + `__TAURI_INVOKE_HOOK__` test-harness hooks (Phase 1..5) extended for Phase 6 Playwright specs.

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 6 success criteria (must be falsifiable):**
- SC-1: Any Life OS route renders without 404; streak counters read from `streak_*` commands (Plan 06-03 HealthView or a shared streak chip falsifies via Playwright spec; `streak_stats::streak_get_stats` wired)
- SC-2: FinanceView displays a spending overview loaded via `financial_*` commands; CSV import affordance present (Plan 06-03 FinanceView spec falsifies; `financial_brain::finance_get_snapshot` + `finance_import_csv` wired)
- SC-3: Any Identity route renders; SoulView displays loaded identity document content (Plan 06-05 SoulView spec falsifies; `soul_commands::soul_get_state` + `get_character_bible` wired)
- SC-4: CharacterBible shows the trait evolution log from `character.rs` feedback data; thumbs-up/down from Chat round-trips to visible trait updates (Plan 06-05 + 06-07 spec falsifies the round-trip; log view has honest deferral per D-155 if backend log doesn't exist)
- SC-5: Both clusters registered via feature `index.ts` exports; no App.tsx edit was required (trivially verified — App.tsx doesn't exist in V1; Phase 6 only edits feature index files — NEVER router.ts)

**From Rust reality (D-140 inventory):**
- Life OS cluster has ~110 registered commands spanning 14 modules.
- Identity cluster has ~40 registered commands spanning 9 modules.
- **NONE of them need new handlers** — all already wired.
- Return types vary widely — each wrapper hand-types its return interface mirroring Rust `#[derive(Serialize)]` shape.

**Migration ledger alignment:**
- 9 life-os routes already in ledger with `phase: 6` + `status: Pending`. Plan 06-07 verify script flips them to `Shipped`.
- 7 identity routes same. No route added or removed in Phase 6 — the stubs are canonical (per D-28 + Phase 5 DP-3 precedent).

**Palette + nav derivation (D-40 + D-55):**
- NavRail already shows "Life" + "Identity" cluster icons derived from `section`; clicking navigates to first route of each cluster (first = `health` / `soul` by index order). Plan 06-02's index.tsx rewrite preserves order so the cluster navigation doesn't shift.

</specifics>

<deferred>
## Deferred Ideas

- **10th Life OS route + 8th/9th Identity routes (LIFE-10, IDEN-08, IDEN-09).** Current Phase 1 stubs shipped 9+7 (not 10+9). Phase 6 closes 9+7 and flags 3 orphan requirement IDs in Plan 06-07 SUMMARY + Phase 6 retrospective. Closing requires a scope decision (add new routes or retire requirements) outside Phase 6's authority. This is the DIRECT analog of Phase 5 DP-3 (which shipped 9+9 instead of 10+10).
- **Chart library for FinanceView spending trends.** D-146 renders text-first KPIs. Phase 9 polish could add a lightweight SVG sparkline if needed; no new dep in Phase 6.
- **Drag-drop CSV import.** D-146 refuses drag-drop; button + file picker only. Phase 9 polish could add drag-drop if ergonomics feels thin.
- **Auto-save on SoulView / CharacterBible / PersonaView edits.** D-153 / D-155 / D-154 all use explicit-confirm Dialog flow. Auto-save deferred; edits to identity data are high-stakes.
- **Trait evolution log (literal ROADMAP SC-4).** If `character.rs` has no reader for trait-update history, defer to Phase 9 polish or propose a new reader command in a future phase. D-155 documents the honest deferral.
- **Force-directed SocialGraphView network.** D-149 renders contacts as a card list (primary surface) — not a network visualization. Phase 9 could add a network view if ergonomics demands it.
- **Inline meeting transcription in MeetingsView.** `meeting_process` accepts audio; Phase 6 exposes it via a file-picker input but NOT a recording UI. Live recording deferred to Phase 9.
- **Ghost-mode integration in MeetingsView.** Ghost is Phase 4; MeetingsView reads meeting history but doesn't drive Ghost. Integration deferred to Phase 9.
- **Emotional analytics dashboard.** EmotionalIntelView D-151 is text-first; a richer analytics view deferred.
- **Mobile-friendly responsive layouts.** Same policy as Phase 5 — desktop-first; Phase 9 polish addresses responsive edge cases.
- **Comprehensive per-route Playwright coverage.** Plan 06-07 ships 4 representative specs (1 per big surface). Exhaustive per-route coverage deferred to Phase 9 polish.

</deferred>

<mac_session_items>
## Mac-Session Verification Items (Operator Handoff — extends Phase 1..5 list)

These checks cannot be verified in the sandbox. Carry forward to the final operator checkpoint run (bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3..5 Mac-smoke per STATE.md strategy). Plan 06-07 Task 3 adds M-21..M-27.

- **M-21:** `npm run tauri dev` launches; navigate to /health — HealthView renders without 404 (SC-1). Today's snapshot card shows data (or empty-state).
- **M-22:** Navigate to /finance — KPI row renders, transactions list populated (or empty), "Import CSV" button present (SC-2).
- **M-23:** Import a sample CSV via `finance_import_csv` → transactions appear + auto-categorize button runs successfully (SC-2).
- **M-24:** Navigate to /soul — SoulView renders state card + Bible content loads from `get_character_bible` (SC-3).
- **M-25:** Navigate to /character — CharacterBible renders. Send a chat message + click thumbs-up; navigate back to /persona → refreshed trait scores visible (SC-4 round-trip).
- **M-26:** Navigate to /goals, /habits, /meetings, /predictions, /emotional-intel, /accountability, /social-graph, /persona, /negotiation, /reasoning, /context-engine, /sidecar — each renders without 404; each has either live data or an honest empty-state (SC-1 + SC-3 completeness).
- **M-27:** Run `cd src-tauri && cargo check` — still 0 errors. (D-65 inheritance — this is a regression-only check since Phase 6 touches no Rust, but we still validate nothing else broke.)

</mac_session_items>

---

*Phase: 06-life-os-identity*
*Context gathered: 2026-04-19 via /gsd-plan-phase 6 --auto (no interactive discuss; defaults logged in 06-DISCUSSION-LOG.md)*
