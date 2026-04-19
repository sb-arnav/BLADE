# ROADMAP — BLADE Skin Rebuild (V1)

**Project:** BLADE Skin Rebuild V1
**Created:** 2026-04-17
**Granularity:** Standard (10 phases derived from requirements + build-order DAG)
**Coverage:** 156/156 requirements mapped

---

## Phase Dependency Diagram

```
Phase 0: Pre-Rebuild Audit
        |
        v
Phase 1: Foundation ──────────────────────────────────────────────────────────────────────┐
        |                                                                                  |
        v                                                                                  |
Phase 2: Onboarding + Main Shell                                                          |
        |                                                                                  |
        v                                                                                  |
Phase 3: Dashboard + Chat + Settings (parallel workstreams + Rust events)                 |
        |                                                                                  |
        v                                                                                  |
Phase 4: Overlay Windows (QuickAsk, Voice Orb, Ghost, HUD — parallel)                    |
        |                                                                                  |
        v                                                                                  |
Phase 5: Agents + Knowledge (parallel) ─────────────────────────────────────┐             |
Phase 6: Life OS + Identity (parallel) ──────────────────────────────────── ┤ (parallel)  |
Phase 7: Dev Tools + Admin (parallel) ──────────────────────────────────────┘             |
        |                                                                                  |
        v                                                                                  |
Phase 8: Body Visualization + Hive Mesh                                                   |
        |                                                                                  |
        v                                                                                  |
Phase 9: Polish Pass ◄─────────────────────────────────────────────────────────────────────
```

**Arrows:** "→" means "must complete before". Phases 5, 6, 7 are parallel to each other; all require Phase 4 to complete; all must complete before Phase 8.

---

## Phases

- [x] **Phase 0: Pre-Rebuild Audit** — No-code reading pass: QuickAsk bridge, orb patterns, event listeners, onboarding wiring. Output: RECOVERY_LOG.md. Gate: Arnav reviews before Phase 1. COMPLETE 2026-04-18 (b26a965)
- [ ] **Phase 1: Foundation** — Design tokens, 8 primitives, typed Tauri wrapper, event hook, route registry, 5 HTML entries, migration ledger, P-01..P-06 gate checks.
- [ ] **Phase 2: Onboarding + Main Shell** — 3 onboarding screens wired to backend; main shell (TitleBar, Nav, CommandPalette, ToastContext, GlobalOverlays).
- [ ] **Phase 3: Dashboard + Chat + Settings** — Three parallel workstreams; adds 6 missing Rust events.
- [ ] **Phase 4: Overlay Windows** — QuickAsk (bridge verified), Voice Orb (OpenClaw math), Ghost Mode (content-protected), HUD bar — all 4 parallel.
- [ ] **Phase 5: Agents + Knowledge** — 10+10 requirements; each cluster wires its own lib/tauri/ module.
- [ ] **Phase 6: Life OS + Identity** — 10+9 requirements; each cluster wires its own lib/tauri/ module.
- [ ] **Phase 7: Dev Tools + Admin** — 11+10 requirements; each cluster wires its own lib/tauri/ module.
- [ ] **Phase 8: Body Visualization + Hive Mesh** — 7+6 requirements; hormone bus, tentacle autonomy controls, decision approval queue.
- [ ] **Phase 9: Polish Pass** — Motion audit, a11y, empty states, error boundaries, skeletons, cross-route consistency, prod build verification, perf budget.

---

## Phase Details

### Phase 0: Pre-Rebuild Audit
**Goal**: Every implicit contract in the old frontend is documented before a line of new code is written.
**Depends on**: Nothing
**Requirements**: None (no-code audit phase; outputs unlock Phase 1)
**Success Criteria** (what must be TRUE):
  1. `RECOVERY_LOG.md` exists in `.planning/` with explicit QuickAsk → Main bridge contract (invoke name, event name, payload shape, conversation persistence path) derived from `src-tauri/src/commands.rs` + `docs/design/quickask.html`.
  2. Voice Orb state machine documented — which Rust events (`voice_conversation_*`, `wake_word_detected`, etc.) drive each of the 4 phase states — derived from `src-tauri/src/voice_global.rs`, `src-tauri/src/wake_word.rs`, and `docs/design/voice-orb-states.html` (OpenClaw math locked via D-08; see PRIOR_ART.md).
  3. All Rust event emitters catalogued — every `emit_all` / `emit_to` site in `src-tauri/src/` with event name and payload type — forming the subscription surface for Phase 1's `useTauriEvent`.
  4. Onboarding backend wiring documented — `get_onboarding_status`, `complete_onboarding`, and `deep_scan_*` call sequence and payloads — derived from `src-tauri/src/commands.rs` + the 3 onboarding prototype screens.
  5. `emit_all` audit complete — every `app.emit_all(...)` classified as cross-window (keep) or single-window (convert to `emit_to`); proposed `emit_to(label, ...)` replacement inline for every single-window row.
**Plans**: 2 plans
- [x] 00-01-PLAN.md — Wave 1: 3 parallel extractions (backend contracts, emit_all classification, prototype flow map) — COMPLETE 2026-04-18 (c6957a1)
- [x] 00-02-PLAN.md — Wave 2: synthesize `.planning/RECOVERY_LOG.md` + patch ROADMAP/STATE + commit audit bundle — COMPLETE 2026-04-18 (b26a965)
**UI hint**: no

---

### Phase 1: Foundation
**Goal**: The build compiles, the 5 HTML entries exist, the design system is locked, the typed wrapper discipline is in place, and P-01 through P-06 are explicitly verified — so every subsequent phase builds on a stable base.
**Depends on**: Phase 0
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, FOUND-06, FOUND-07, FOUND-08, FOUND-09, FOUND-10, FOUND-11, WIN-01, WIN-02, WIN-03, WIN-04, WIN-05, WIN-06, WIN-07, WIN-08, WIN-09, WIRE-08
**Success Criteria** (what must be TRUE):
  1. `npm run tauri dev` succeeds; all 5 windows launch without Rust panics; `overlay.html`, `hud.html`, and `ghost_overlay.html` exist and are served. (Addresses P-05.)
  2. `npm run tauri build` produces `dist/` with all 5 HTML files present; CI assertion passes. (Addresses P-18, P-19.)
  3. `useTauriEvent("test_event", handler)` mounts and unmounts cleanly; navigating Chat → Dashboard × 5 in dev shows exactly 1 event consumed per backend emission. (Addresses P-06.)
  4. Dashboard first paint measured ≤ 200ms on integrated GPU via `about:tracing`; max 3 active `backdrop-filter` elements confirmed by visual layer audit. (Addresses P-01.)
  5. Every wrapper in `src/lib/tauri/` has a smoke-test log confirming snake_case args reach Rust correctly; `invokeTyped` used in all stubs. (Addresses P-04.)
  6. `.planning/migration-ledger.md` lists all 59 routes from `src.bak/` with status, target component, and destination phase. (Addresses P-03.)
  7. WCAG 4.5:1 contrast verified on 5 representative macOS wallpapers using the tokens from `src/styles/tokens.css`. (Addresses P-08.)
**Notes**: Gate checks P-01..P-06 are explicit pass/fail, not best-effort. Phase does not close until all 7 criteria are verified.
**Plans**: 9 plans
Plans:
- [ ] 01-01-PLAN.md — Nuke src/ + 5 HTML entries + 5 window bootstraps (WIN-01..07, P-05 gate setup)
- [ ] 01-02-PLAN.md — Design tokens + glass/motion/layout + typography + self-hosted WOFF2 fonts (FOUND-01, P-01 cap)
- [ ] 01-03-PLAN.md — invokeTyped base + TauriError + BladeConfig/ChatMessage types (FOUND-03, P-04 prevention)
- [ ] 01-04-PLAN.md — 8 primitives + ComingSoonSkeleton + primitives.css (FOUND-02, D-07 cap enforcement)
- [ ] 01-05-PLAN.md — config.ts + chat.ts typed wrappers with Rust JSDoc cites (FOUND-04)
- [ ] 01-06-PLAN.md — BLADE_EVENTS registry + useTauriEvent hook + payload types (FOUND-05, FOUND-06, P-06 prevention)
- [ ] 01-07-PLAN.md — RouteDefinition + 13 feature index stubs (~81 routes) + router aggregator + usePrefs + ConfigContext (FOUND-07..10)
- [ ] 01-08-PLAN.md — Migration ledger seed script + WIRE-08 emit_all → emit_to refactor (FOUND-11, WIRE-08)
- [ ] 01-09-PLAN.md — 6 verify scripts + ESLint rule + 3 dev surfaces + Playwright harness + CI wiring + P-08 WCAG checkpoint (WIN-09, all gate verification)
**UI hint**: yes

---

### Phase 2: Onboarding + Main Shell
**Goal**: A first-time user can complete onboarding and land in a functional main shell; returning users skip onboarding and land on the default dashboard route.
**Depends on**: Phase 1
**Requirements**: ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-05, ONBD-06, SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06, SHELL-07
**Success Criteria** (what must be TRUE):
  1. A fresh app launch (empty config) shows the Provider Picker screen; selecting Anthropic + entering a valid API key + completing deep scan advances to the main shell without errors.
  2. A returning user (onboarding complete) boots directly to the default route; onboarding is never shown again unless re-triggered from Settings.
  3. `⌘K` / `Ctrl+K` opens the Command Palette; typing a route name fuzzy-filters entries; `Enter` navigates; `Esc` closes. No App.tsx edits required for a route to appear in the palette.
  4. A backend event arrives while the app is running and a toast notification appears and auto-dismisses without blocking interaction.
  5. `App.tsx` (or its equivalent shell component) is under 300 lines; shell responsibilities are delegated to composed hooks and components.
**Plans**: TBD
**UI hint**: yes

---

### Phase 3: Dashboard + Chat + Settings
**Goal**: The three highest-traffic user surfaces — the ambient home view, the conversational AI, and configuration — are all functional, wired end-to-end, and performant.
**Depends on**: Phase 2
**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, DASH-08, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, CHAT-08, CHAT-09, CHAT-10, SET-01, SET-02, SET-03, SET-04, SET-05, SET-06, SET-07, SET-08, SET-09, SET-10, WIRE-01, WIRE-02, WIRE-03, WIRE-04, WIRE-05, WIRE-06
**Success Criteria** (what must be TRUE):
  1. Dashboard shows a live "Right Now" hero sourced from `perception_fusion`; the ambient strip at the bottom reflects the current hormone state emitted by `homeostasis.rs` (WIRE-02 verified live).
  2. Chat streams a full response without App-level re-renders; React Profiler shows ≤ 16ms render time during 50-token/sec streaming; tool calls render inline with approval dialog (500ms button delay enforced).
  3. A reasoning-capable model produces a collapsible "thinking" section in chat; the "compacting…" indicator appears when token ratio exceeds 0.65 (WIRE-04, WIRE-06 verified).
  4. Settings saves a provider API key; the key persists after app restart; the routing grid reflects updated provider config.
  5. Dashboard first paint remains ≤ 200ms with chat panel open (chat message bubbles confirmed as rgba solid, not backdrop-filter).
**Notes**: WIRE-01 (quickask_submit) is partially scoped here as the Rust command stub; the full bridge test happens in Phase 4. WIRE-05 (blade_agent_event) is the Rust-side emit; the consuming UI is Phase 5.
**Plans**: TBD
**UI hint**: yes

---

### Phase 4: Overlay Windows
**Goal**: All four overlay/secondary windows — QuickAsk, Voice Orb, Ghost Mode, and HUD bar — are functional, performant, correctly isolated from the main window, and pass their critical behavioral tests.
**Depends on**: Phase 3
**Requirements**: QUICK-01, QUICK-02, QUICK-03, QUICK-04, QUICK-05, QUICK-06, QUICK-07, ORB-01, ORB-02, ORB-03, ORB-04, ORB-05, ORB-06, ORB-07, ORB-08, GHOST-01, GHOST-02, GHOST-03, GHOST-04, GHOST-05, GHOST-06, GHOST-07, GHOST-08, HUD-01, HUD-02, HUD-03, HUD-04, HUD-05, WIRE-07
**Success Criteria** (what must be TRUE):
  1. QuickAsk submits a message via `Alt+Space` (or configured shortcut), streams a result, and the submitted conversation appears in the main window's history drawer after `blade_quickask_bridged` fires — no manual action required. (P-02 bridge verified.)
  2. Voice Orb transitions through all 4 phase states (Idle → Listening → Thinking → Speaking) smoothly at 60fps on integrated Intel GPU; OpenClaw math constants verified in rAF loop.
  3. Ghost overlay window is NOT visible in OBS screen capture on macOS; Esc closes it; no cursor CSS present on any ghost element; Linux shows explicit content-protection warning before activation.
  4. HUD bar window appears on launch; displays live god-mode tier + hormone dominant state; click opens main window; right-click shows mini menu.
  5. QuickAsk shortcut does not conflict with CJK IME on macOS; shortcut registration failure is logged and falls back gracefully. (P-09 verified.)
**Notes**: WIRE-07 (VAD in audio_timeline.rs) is required for Ghost Mode meeting detection and Voice Orb audio sampling; it ships in this phase with the consuming surfaces.
**Plans**: TBD
**UI hint**: yes

---

### Phase 5: Agents + Knowledge
**Goal**: The Agents and Knowledge clusters are fully routable with no 404s; each surface is wired to its backend commands and receives live event updates; lower-priority sub-views ship as clearly-labeled skeleton states.
**Depends on**: Phase 4
**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, AGENT-06, AGENT-07, AGENT-08, AGENT-09, AGENT-10, KNOW-01, KNOW-02, KNOW-03, KNOW-04, KNOW-05, KNOW-06, KNOW-07, KNOW-08, KNOW-09, KNOW-10
**Success Criteria** (what must be TRUE):
  1. Navigating to any Agents route (AgentDashboard, AgentDetail, SwarmView, etc.) produces a rendered surface with no 404 fallback; SwarmView renders a DAG from `swarm_*` commands.
  2. AgentDetail timeline receives `blade_agent_event` emissions and appends steps in real time without page refresh.
  3. Navigating to any Knowledge route (KnowledgeBase, KnowledgeGraphView, ScreenTimeline, etc.) produces a rendered surface; ScreenTimeline shows at least one screenshot if Total Recall has run.
  4. KnowledgeBase search returns results from `embeddings_*` + `memory_*` commands; result groups are labelled (web / memory / tools).
  5. Both clusters are registered in `src/lib/router.ts` via their own `index.ts` feature exports; no App.tsx edit was needed to add them.
**Plans**: TBD
**UI hint**: yes

---

### Phase 6: Life OS + Identity
**Goal**: The Life OS and Identity clusters are fully routable with no 404s; each surface is wired to its backend commands; lower-priority sub-views ship as clearly-labeled skeleton states.
**Depends on**: Phase 4
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-05, LIFE-06, LIFE-07, LIFE-08, LIFE-09, LIFE-10, IDEN-01, IDEN-02, IDEN-03, IDEN-04, IDEN-05, IDEN-06, IDEN-07, IDEN-08, IDEN-09
**Success Criteria** (what must be TRUE):
  1. Navigating to any Life OS route (HealthView, FinanceView, GoalView, HabitView, etc.) produces a rendered surface with no 404 fallback; streak counters read from `streak_*` commands.
  2. FinanceView displays a spending overview loaded via `financial_*` commands; CSV import affordance is present and triggers the correct invoke.
  3. Navigating to any Identity route (SoulView, PersonaView, CharacterBible, etc.) produces a rendered surface; SoulView displays loaded identity document content.
  4. CharacterBible shows the trait evolution log from `character.rs` feedback data; thumbs-up/down from Chat round-trips to visible trait updates.
  5. Both clusters are registered via their own feature `index.ts` exports; no App.tsx edit was required.
**Plans**: TBD
**UI hint**: yes

---

### Phase 7: Dev Tools + Admin
**Goal**: The Dev Tools and Admin clusters are fully routable with no 404s; each surface is wired to its backend commands; lower-priority sub-views ship as clearly-labeled skeleton states.
**Depends on**: Phase 4
**Requirements**: DEV-01, DEV-02, DEV-03, DEV-04, DEV-05, DEV-06, DEV-07, DEV-08, DEV-09, DEV-10, DEV-11, ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-07, ADMIN-08, ADMIN-09, ADMIN-10
**Success Criteria** (what must be TRUE):
  1. Navigating to any Dev Tools route (Terminal, FileBrowser, GitPanel, WebAutomation, etc.) produces a rendered surface with no 404 fallback; Terminal routes bash through `native_tools.rs` and returns output.
  2. WebAutomation accepts a goal, calls `browser_agent_*` commands, and displays live screen feedback.
  3. Navigating to any Admin route (Analytics, SecurityDashboard, Diagnostics, etc.) produces a rendered surface; DecisionLog reads decision-gate history from `decision_gate_*` commands.
  4. SecurityDashboard surfaces active alerts from `security_monitor.rs`; the Diagnostics view shows module health for all running background tasks.
  5. Both clusters registered via their own feature `index.ts` exports; no App.tsx edit was required.
**Plans**: TBD
**UI hint**: yes

---

### Phase 8: Body Visualization + Hive Mesh
**Goal**: The Body and Hive clusters surface the backend's unique body-registry and tentacle architecture in UI for the first time; all views are routable and wired to live data; the hormone bus emits in real time to the Body hormone dashboard.
**Depends on**: Phase 5, Phase 6, Phase 7
**Requirements**: BODY-01, BODY-02, BODY-03, BODY-04, BODY-05, BODY-06, BODY-07, HIVE-01, HIVE-02, HIVE-03, HIVE-04, HIVE-05, HIVE-06
**Success Criteria** (what must be TRUE):
  1. BodyMap route renders an interactive visualization of 12 body systems loaded from `body_registry.rs`; clicking a system drills into BodySystemDetail without error.
  2. The hormone dashboard displays all 10 hormone values and updates in real time when `hormone_update` events arrive from `homeostasis.rs` (WIRE-02 flowing into this surface).
  3. Hive landing shows all 10 tentacles (github, slack, email, calendar, discord, linear, cloud, log, terminal, filesystem) with live autonomy indicators; per-tentacle autonomy slider saves via `hive_*` commands.
  4. The decision approval queue displays pending approvals from all tentacles; a user can approve or reject an individual decision; the action is confirmed by BLADE's response.
  5. Both clusters registered via their own feature `index.ts` exports; no App.tsx edit was required.
**Plans**: 5 plans
Plans:
- [ ] 08-01-PLAN.md — Wave 1: 10 hive+world event constants + 5 body/hive prefs keys (BODY-01,02,03,05,06 + HIVE-01..04)
- [ ] 08-02-PLAN.md — Wave 1: body.ts + hive.ts wrappers (~33 funcs) + 2 index.tsx rewrites + 11 placeholder files + CSS + types (BODY-01..07 + HIVE-01..06)
- [ ] 08-03-PLAN.md — Wave 2: 6 Body routes — BodyMap (SC-1), BodySystemDetail, HormoneBus (SC-2), OrganRegistry, DNA, WorldModel (BODY-01..07)
- [ ] 08-04-PLAN.md — Wave 2: 5 Hive routes — HiveMesh (SC-3), TentacleDetail, AutonomyControls, ApprovalQueue (SC-4), AiDelegate (HIVE-01..06)
- [ ] 08-05-PLAN.md — Wave 3: 4 Playwright specs + verify:phase8-rust + extended verify:feature-cluster-routes + 3 dev routes + Mac smoke M-35..M-40
**UI hint**: yes

---

### Phase 9: Polish Pass
**Goal**: Every surface the user can reach is coherent, visually consistent, accessible, resilient to errors, and verified in a prod build — realizing the core value of the entire project.
**Depends on**: Phase 8
**Requirements**: POL-01, POL-02, POL-03, POL-04, POL-05, POL-06, POL-07, POL-08, POL-09, POL-10
**Success Criteria** (what must be TRUE):
  1. Every route mounts without error in `npm run tauri build` prod output; all 5 windows open; no orphan screens or 404 fallbacks anywhere.
  2. Every surface has an empty state with a clear call to action; no data-driven view shows a blank white area when its data source returns empty.
  3. Every top-level route is wrapped in an error boundary; a simulated error shows a recovery affordance (retry / reset / report), never an unhandled crash.
  4. `⌘?` opens the shortcut help panel; every route has at least its primary shortcut documented and functional.
  5. WCAG AA 4.5:1 contrast confirmed on all 5 representative wallpapers across all 59 routes; Voice Orb sustains 60fps on integrated GPU through all 4 phase transitions.
**Plans**: 6 plans
Plans:
- [ ] 09-01-PLAN.md — Wave 1: Rust backfill (hive_reject_decision + dna_set_identity + delegate_feedback) + 3 wrappers + 3 frontend wiring edits (POL-09..10 — closes Phase 8 deferrals)
- [ ] 09-02-PLAN.md — Wave 2: ErrorBoundary + EmptyState primitives + MainShell wrap + empty-state sweep (17 files: agents + knowledge + life-os + identity) (POL-02, POL-03)
- [ ] 09-03-PLAN.md — Wave 2: A11y sweep — prefers-reduced-motion override + ARIA icon-only buttons + Dialog focus audit + keyboard nav audit (POL-06..08)
- [ ] 09-04-PLAN.md — Wave 2: Motion audit + motion-entrance.css + ListSkeleton primitive + empty-state sweep (20 files: body + hive + dev-tools + admin) + consistency audit (POL-01, POL-02, POL-05, POL-10)
- [ ] 09-05-PLAN.md — Wave 3: ⌘? shortcut help panel + 3 perf Playwright specs + verify-html-entries.mjs --prod flag + build log (POL-01, POL-04, POL-05)
- [ ] 09-06-PLAN.md — Wave 4: 2 Playwright specs (a11y + error-boundary) + 4 verify scripts + CHANGELOG.md + Mac-smoke M-41..M-46 operator checkpoint (all POL)
**UI hint**: yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 0. Pre-Rebuild Audit | 2/2 | Complete | 2026-04-18 (b26a965) |
| 1. Foundation | 0/TBD | Not started | - |
| 2. Onboarding + Main Shell | 0/TBD | Not started | - |
| 3. Dashboard + Chat + Settings | 0/TBD | Not started | - |
| 4. Overlay Windows | 0/TBD | Not started | - |
| 5. Agents + Knowledge | 0/TBD | Not started | - |
| 6. Life OS + Identity | 0/TBD | Not started | - |
| 7. Dev Tools + Admin | 0/TBD | Not started | - |
| 8. Body Visualization + Hive Mesh | 0/TBD | Not started | - |
| 9. Polish Pass | 0/TBD | Not started | - |

---

## Coverage Verification

**Total v1 requirements: 156**
**Mapped: 156/156**

| Category | Count | Phase |
|----------|-------|-------|
| FOUND-01..11 | 11 | Phase 1 |
| WIN-01..09 | 9 | Phase 1 |
| WIRE-08 | 1 | Phase 1 |
| ONBD-01..06 | 6 | Phase 2 |
| SHELL-01..07 | 7 | Phase 2 |
| DASH-01..08 | 8 | Phase 3 |
| CHAT-01..10 | 10 | Phase 3 |
| SET-01..10 | 10 | Phase 3 |
| WIRE-01..06 | 6 | Phase 3 |
| QUICK-01..07 | 7 | Phase 4 |
| ORB-01..08 | 8 | Phase 4 |
| GHOST-01..08 | 8 | Phase 4 |
| HUD-01..05 | 5 | Phase 4 |
| WIRE-07 | 1 | Phase 4 |
| AGENT-01..10 | 10 | Phase 5 |
| KNOW-01..10 | 10 | Phase 5 |
| LIFE-01..10 | 10 | Phase 6 |
| IDEN-01..09 | 9 | Phase 6 |
| DEV-01..11 | 11 | Phase 7 |
| ADMIN-01..10 | 10 | Phase 7 |
| BODY-01..07 | 7 | Phase 8 |
| HIVE-01..06 | 6 | Phase 8 |
| POL-01..10 | 10 | Phase 9 |
| **Total** | **156** | ✓ |

---

## WIRE Requirement Placement Rationale

| WIRE-ID | Backend Gap | Consuming Surface | Phase |
|---------|-------------|-------------------|-------|
| WIRE-01 | `quickask_submit` command | QuickAsk bridge | Phase 3 (Rust stub) + Phase 4 (bridge test) |
| WIRE-02 | `hormone_update` event | Dashboard ambient strip + Body hormone dashboard | Phase 3 (Dashboard) |
| WIRE-03 | `blade_message_start` event | Chat streaming state machine | Phase 3 |
| WIRE-04 | `blade_thinking_chunk` event | Chat collapsible thinking section | Phase 3 |
| WIRE-05 | `blade_agent_event` event | AgentDetail timeline | Phase 3 (Rust emit) — consumed Phase 5 |
| WIRE-06 | `blade_token_ratio` event | Chat "compacting…" indicator | Phase 3 |
| WIRE-07 | VAD in `audio_timeline.rs` | Ghost Mode + Voice Orb | Phase 4 |
| WIRE-08 | `emit_all` audit | All windows (event routing policy) | Phase 1 (Foundation) |

**Note on WIRE-01:** The `quickask_submit` Rust command is stubbed and the `blade_quickask_bridged` event is wired during Phase 3 (when the chat backend infrastructure is built). The end-to-end bridge verification test (conversation appears in main history) is the Phase 4 gate check, since the QuickAsk window does not exist until Phase 4.

---

*Roadmap created: 2026-04-17*
*Last updated: 2026-04-17 after initial creation*
