# Phase 6 — Discussion Log (AUTO MODE — no interactive session)

**Invocation:** `/gsd-plan-phase 6 --auto`
**Date:** 2026-04-19
**Mode:** Planner picks defensible defaults to maintain phase velocity. All defaults are logged here, and every new decision also lands in `06-CONTEXT.md` as `D-139..D-165`.

Prior locked decisions `D-01..D-138` (Phase 1–5 CONTEXT files) are treated as non-negotiable constraints. This log captures only the NEW choices the planner made for Phase 6.

---

## Source inputs consulted

- `.planning/ROADMAP.md` Phase 6 §Requirements (LIFE-01..10 + IDEN-01..09) + §Success Criteria 1–5
- `.planning/STATE.md` — Phase 1..5 substrate inventory
- `.planning/phases/05-agents-knowledge/05-CONTEXT.md` — **template mirrored verbatim**. D-118..D-138 locked; Phase 6 D-139..D-165 continue numbering.
- `.planning/phases/05-agents-knowledge/05-PATTERNS.md` — §1 wrapper recipe, §2 rAF flush, §5 index rewrite, §7 Playwright, §8 verify script, §10 common CSS. Phase 6 reuses all verbatim.
- `.planning/phases/05-agents-knowledge/05-0{1..7}-PLAN.md` — 7-plan template
- `.planning/phases/01..04/*-CONTEXT.md` — locked D-01..D-117
- `src/features/life-os/index.tsx` — 9 stubs (NOT 10 per ROADMAP)
- `src/features/identity/index.tsx` — 7 stubs (NOT 9 per ROADMAP)
- `src/lib/events/index.ts` + `payloads.ts` — 55+ events from Phase 5
- `src/lib/tauri/*.ts` — 11 existing wrapper files
- `src-tauri/src/lib.rs:759-1282` — 150+ life-os + identity command registrations in `generate_handler![]`
- `src-tauri/src/{character,soul_commands,persona_engine,negotiation_engine,reasoning_engine,context_engine,sidecar,personality_mirror,kali,health_tracker,health,health_guardian,financial_brain,goal_engine,habit_engine,meeting_intelligence,social_graph,prediction_engine,emotional_intelligence,accountability,streak_stats,people_graph,learning_engine,temporal_intel}.rs` — module sources for wrapper cites
- `src.bak/components/*.tsx` matching life-os + identity names — READ-ONLY per D-17

---

## Decision points + planner choices

### DP-1: How many plans + what wave structure?

**Options considered:**
- (a) 1 monolithic plan per cluster (2 plans). Rejected — exceeds 3-task per-plan discipline; 9+7 routes = >>3 tasks each.
- (b) 1 plan per route (16 plans). Rejected — over-fragmentation; wrapper + route are coupled.
- (c) 7 plans: 1 event-registry/prefs + 1 wrappers + 4 UI (life-os A/B + identity A/B) + 1 Playwright/verify (CHOSEN — mirrors Phase 5 exactly).
- (d) 6 plans (merge event-registry/prefs into wrappers). Rejected — even when event additions are small, the Prefs extension + the wrappers still benefit from separate plans (wrappers are large; Prefs is trivial; separate plans prevent Plan 06-02 bloat).

**Choice:** 7 plans across 4 waves (D-142). Same topology as Phase 5.

---

### DP-2: Rust plan — yes or no?

**Options:**
- (a) Dedicate Plan 06-00 to Rust for any missing lifecycle emits. Rejected — audit shows Life OS + Identity modules are overwhelmingly request-response; no lifecycle event gap that would block consumers.
- (b) Leave Rust alone, add a DEFENSIVE verify script (CHOSEN). Plan 06-07 ships `scripts/verify-phase6-rust-surface.sh` that greps `lib.rs` for all 150+ Phase 6 commands in the D-140 inventory and fails if any is missing. Plus `cargo check` stays as the Mac-operator check (M-27).

**Choice:** No Rust plan (D-144 / zero-Rust invariant inherits Phase 5 D-123). One verify script in Plan 06-07.

**Trade-off accepted:** If a Phase 6 UI plan discovers a genuinely-missing Rust command mid-execution, it gets `ComingSoonSkeleton phase={next}` + SUMMARY-noted gap. This mirrors Phase 5 D-119 + Phase 4 D-99.

---

### DP-3: Honour ROADMAP 10+9 vs ship 9+7?

The ROADMAP lists LIFE-01..10 + IDEN-01..09 (19 total). The current `src/features/life-os/index.tsx` has 9 stubs; `src/features/identity/index.tsx` has 7 stubs. Options:

- (a) Add a 10th life-os route + add 8th/9th identity routes to match ROADMAP (3 new routes). Rejected — the extra routes have no source justification (Phase 1 team chose 9+7 when allocating routes). Adding routes = scope expansion without source artifact backing. Per D-17, src.bak isn't canonical.
- (b) Ship 9+7 (the shipped stubs) + surface 3 orphans in Plan 06-07 SUMMARY (CHOSEN). Exact mirror of Phase 5 DP-3 — Phase 5 shipped 9+9 instead of 10+10.

**Choice:** 9+7 route coverage. Orphan requirement IDs `LIFE-10`, `IDEN-08`, `IDEN-09` flagged in Plan 06-07 SUMMARY for decision outside Phase 6.

**Trade-off accepted:** Phase 6 closes 16/19 ROADMAP Phase 6 requirements instead of 19/19. This is an honest ledger; closing with fake stubs for 3 unplanned routes would violate D-140 (no Rust) + D-141 (only ship what the source supports).

---

### DP-4: Where do `people_graph::*` commands live?

Two overlapping modules surface contact/CRM functionality: `social_graph::*` (11 commands) and `people_graph::*` (7 commands). Options:

- (a) One route per module (SocialGraphView + PeopleView). Rejected — PeopleView isn't a ROADMAP requirement; adding a route = scope expansion (DP-3 discipline).
- (b) Merge both into SocialGraphView — makes CRM feel bloated. Rejected for SC clarity.
- (c) Primary CRM = SocialGraphView (`social_*` — richer 11-command surface); `people_*` exposed as a sub-tab in PersonaView (CHOSEN per D-149 + D-154). Rationale: People graph is persona-adjacent (reply-style suggestions, context-for-prompt); SocialGraph is relationship-CRM proper.

**Choice:** D-149 + D-154.

**Trade-off accepted:** Two related surfaces live in two different cluster routes. Cross-reference noted in each card. Phase 7 retrospective may propose consolidation.

---

### DP-5: Where do `kali::*` commands live?

Kali (pentest utilities) has 6 commands. ROADMAP Phase 7 DEV-* doesn't mention kali. Options:

- (a) Ship as dedicated KaliView route. Rejected — not in ROADMAP.
- (b) Defer to Phase 7 Admin/Dev. Rejected — no natural home there either; Phase 7 doesn't mention kali.
- (c) Expose as sub-section in SidecarView (CHOSEN per D-158). Rationale: Sidecar is the closest thematic match (offsite-device + pentest utilities); both are "external surface" commands. Kali sub-section is collapsed by default.
- (d) Don't expose at all. Rejected — the commands are registered; leaving them orphan waste.

**Choice:** D-158. Documented divergence; Phase 7 retrospective may re-home.

---

### DP-6: PersonaView tab organization

persona_engine has 13 commands — too many for a flat surface. Options:

- (a) Single scrollable page with all 13 commands as sections. Rejected — poor information hierarchy.
- (b) 4 tabs: Traits / Relationship / User Model / People (CHOSEN per D-154). Tabs persisted via `identity.activeTab` pref.
- (c) Split into multiple routes (e.g. PersonaTraits + PersonaRelationship). Rejected — would require ROADMAP route additions (DP-3 discipline).

**Choice:** D-154.

---

### DP-7: CharacterBible trait evolution log — real or deferred?

ROADMAP SC-4: "CharacterBible shows the trait evolution log from character.rs feedback data; thumbs-up/down from Chat round-trips to visible trait updates."

Observations:
- `character::apply_reaction_to_traits` + `reaction_instant_rule` are MUTATORS — they update traits from chat reactions.
- No explicit reader command like `character_get_trait_history` registered.
- `persona_get_traits()` DOES return current trait scores — so the round-trip (chat thumbs → trait update → view refresh) IS observable; just not as a historical log.

**Options:**
- (a) Fake a log view with client-side buffered updates. Rejected — ships fake data.
- (b) Invent a new Rust reader. Rejected per D-140.
- (c) Pragmatic split: round-trip part OBSERVABLE via `persona_get_traits()` refresh + "Trait evolution log ships in Phase 9 polish" card for the log part (CHOSEN per D-155). Documents divergence honestly.

**Choice:** D-155. Same "pragmatic SC interpretation" pattern as Phase 5 D-138.

---

### DP-8: Event subscriptions — how many?

Unlike Phase 5 AgentDetail (10 subscriptions), Phase 6 modules are mostly request-response. Options:

- (a) Full event registry rebuild (like Phase 5 Plan 05-01 for 6 step events). Rejected — no Rust emit sites justify it.
- (b) Zero event additions; pure CRUD. Chosen as the default assumption; Plan 06-01 audits Rust emits during execution and adds constants only where needed.
- (c) Subscribe to existing Phase 3/4 events (hormone_update, godmode_update, health_nudge) from EmotionalIntelView + HealthView. Chosen as supplementary reuse (D-162).

**Choice:** D-162. Event extensions are opportunistic; the Prefs extension (5 new keys, D-165) is the main Plan 06-01 work.

---

### DP-9: FinanceView CSV import — drag-drop or button-only?

**Options:**
- (a) Drag-drop zone + button fallback. Rejected — drag-drop has browser + OS edge cases; adds scope without SC benefit.
- (b) Button + file picker Dialog only (CHOSEN per D-146 Discretion). Rationale: SC-2 only requires "CSV import affordance is present"; button is the minimal affordance.

**Choice:** Button only. Phase 9 polish may add drag-drop.

---

### DP-10: SoulView / CharacterBible / PersonaView edit flow

**Options:**
- (a) Auto-save on blur. Rejected — identity data is high-stakes; accidental overwrite is a bad UX.
- (b) Explicit Dialog-confirm edit flow (CHOSEN per D-153 / D-154 / D-155). Each section: click → Dialog with textarea → save → explicit invoke. Toast on success.

**Choice:** Explicit confirm. Consistent across all three identity surfaces.

---

### DP-11: Where do `temporal_intel::temporal_meeting_prep` + `learning_engine::learning_get_predictions` go?

These are orphan single commands in their respective modules. Options:

- (a) Own routes. Rejected — overkill for 1-command modules.
- (b) Embed in closest semantic host: `temporal_meeting_prep` in MeetingsView (as pre-meeting briefing pane), `learning_get_predictions` in PredictionsView (as a supplementary data source alongside `prediction_get_pending`). CHOSEN per D-148 + D-150.

**Choice:** Embed in nearest thematic route.

---

### DP-12: Are EmotionalIntelView + HealthView worth live event subscriptions?

Phase 3 Dashboard already subscribes to `hormone_update` + `godmode_update`. Options:

- (a) Duplicate the subscriptions in EmotionalIntelView + HealthView. Rejected — adds complexity without value; polling on focus is adequate.
- (b) Skip live events in Phase 6; refetch on route mount + after action completion. Chosen.
- (c) Extract a shared hook. Deferred to Phase 9 polish.

**Choice:** (b). Phase 6 routes refresh on mount + on user action — simpler state flow.

---

## Source audit summary

- **GOAL:** Each surface routable; live + real data flows; explicit CSV import + soul content loaded + trait round-trip observable. Addressed by D-139..D-165 + Plan 06-01..06-07.
- **REQ:** LIFE-01..09 + IDEN-01..07 mapped to plans. 3 orphans (LIFE-10 + IDEN-08 + IDEN-09) flagged (DP-3).
- **RESEARCH:** No Phase 6 research artifact. ROADMAP + prior-phase CONTEXT files are the research surface.
- **CONTEXT:** Phase 1..5 CONTEXT files' D-01..D-138 respected verbatim. No D-XX conflicts found.

Every item either mapped to a plan, explicitly deferred (see `06-CONTEXT.md <deferred>`), or flagged as orphan for phase-close retrospective. No silent omissions.

---

## Orphan Requirements flagged

- **LIFE-10** — no 10th life-os route in Phase 1 substrate; source (`src/features/life-os/index.tsx`) has 9. Decision pending outside Phase 6.
- **IDEN-08** — no 8th identity route in Phase 1 substrate; source has 7. Decision pending outside Phase 6.
- **IDEN-09** — no 9th identity route in Phase 1 substrate; source has 7. Decision pending outside Phase 6.

These are captured in Plan 06-07's SUMMARY template + must be raised at phase-close retrospective.

---

## Plan count final tally

- **Plan 06-01** — wave 1, TS pure (event registry audit + Prefs extension; 5 new dotted keys). Autonomous.
- **Plan 06-02** — wave 1, TS pure (2 wrapper files + 2 index.tsx rewrites + 16 per-route placeholders + 2 CSS files + types barrels). Autonomous.
- **Plan 06-03** — wave 2, Life OS rich subset A (5 routes: HealthView, FinanceView, GoalView, HabitView, MeetingsView). Autonomous.
- **Plan 06-04** — wave 2, Life OS rich subset B (4 routes: SocialGraphView, PredictionsView, EmotionalIntelView, AccountabilityView). Autonomous.
- **Plan 06-05** — wave 2, Identity rich subset A (4 routes: SoulView, PersonaView, CharacterBible, NegotiationView). Autonomous.
- **Plan 06-06** — wave 2, Identity rich subset B (3 routes: ReasoningView, ContextEngineView, SidecarView). Autonomous.
- **Plan 06-07** — wave 3, Playwright specs + verify scripts + Mac operator smoke (M-21..M-27). **Non-autonomous** (operator checkpoint).

**Total:** 7 plans × 4 waves. ~50% context per plan target maintained.

**Route split across 06-03/06-04:** 5 + 4 (instead of Phase 5's 4 + 5) — Life OS has 9 routes, split roughly evenly.
**Route split across 06-05/06-06:** 4 + 3 (instead of Phase 5's 4 + 5) — Identity has 7 routes, split roughly evenly.
