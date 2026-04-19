# Phase 8: Body Visualization + Hive Mesh — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 08-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 8 --auto` (planner-picked defaults; Phase 7 template mirrored — compressed to 5 plans because scope is ~60% of Phase 7)

<domain>
## Phase Boundary

Phase 8 lights up the two LAST cluster surfaces before Phase 9 polish — **Body Visualization** (6 routes shipped as Phase 1 stubs) and **Hive Mesh** (5 routes shipped as Phase 1 stubs) — that were declared `ComingSoonSkeleton phase={8}` in Phase 1. Each cluster owns its own typed Tauri wrapper module (`src/lib/tauri/body.ts`, `src/lib/tauri/hive.ts`) and its own feature folder (`src/features/body/`, `src/features/hive/`). This phase consumes the Phase 1..7 substrate verbatim: 9 primitives, `invokeTyped`, `useTauriEvent`, `usePrefs`, `ConfigContext`, `MainShell`, `ROUTE_MAP`, `PALETTE_COMMANDS`, `ChatProvider`, design tokens, status tokens (D-132), `useRouterCtx`, `--font-mono`, and the cluster-scoped wrapper discipline Phases 5/6/7 established (D-118 / D-139 / D-166). It DOES NOT touch any other cluster (Agents + Knowledge = Phase 5, Life OS + Identity = Phase 6, Dev Tools + Admin = Phase 7, Polish = Phase 9).

**In scope:** 13 requirements — BODY-01..07 (7) + HIVE-01..06 (6). The ROADMAP §"Coverage Verification" lists BODY-01..07 + HIVE-01..06 for 13 total; Phase 1 substrate shipped 6 body routes + 5 hive routes = 11 routes. **Gate 1 audit (this phase):** cover the 6+5 routes that exist today. Because BODY has 7 reqs for 6 routes, one BODY requirement is coupled into an existing route (BODY-07 "cluster wires body/cardio/urinary/reproductive/joints/supervisor/homeostasis commands" is a wiring/coverage requirement — satisfied by the 6 routes collectively plus the wrapper file, NOT a dedicated route). Similarly, HIVE has 6 reqs for 5 routes: HIVE-05 ("hive_* commands wired via src/lib/tauri/hive.ts") is a wrapper-coverage requirement satisfied by Plan 08-02 — NOT a dedicated route. Per STATE.md / PROJECT.md discipline and Phase 5 DP-3 / Phase 6 DP-3 / Phase 7 DP-3 precedent, the shipped stubs are canonical. No new routes added.

**Out of scope for Phase 8:**
- Agents + Knowledge cluster (Phase 5)
- Life OS + Identity cluster (Phase 6)
- Dev Tools + Admin cluster (Phase 7)
- Polish pass — error boundaries, WCAG re-sweep, empty-state illustrations, Voice-Orb 60fps re-verification (Phase 9)
- New `#[tauri::command]` additions — every surface below maps to an EXISTING registered command (audit below in D-196). Zero Rust surface expansion in Phase 8. If a pane would need a new command, it ships as a `ComingSoonSkeleton phase={9}` or documented deferral — never ships with a faked invoke name. (Same discipline as Phase 5 D-119 + Phase 6 D-140 + Phase 7 D-167.)

**Key Phase 1..7 substrate Phase 8 leans on (no drift permitted):**
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/homeostasis.ts` — **already exists** (Phase 3 D-75 AmbientStrip); Plan 08-03 Hormone Bus dashboard IMPORTS from it verbatim (NO new wrapper file for homeostasis; body.ts re-exports for convenience)
- `src/lib/tauri/chat.ts`, `config.ts`, `window.ts`, `agents.ts`, `knowledge.ts`, `life_os.ts`, `identity.ts`, `dev_tools.ts`, `admin.ts` — existing wrapper pattern (Phase 8 adds `body.ts` + `hive.ts`)
- `src/lib/events/index.ts` + `payloads.ts` — Phase 7 expanded to ~63+ events. Phase 8 adds 6-10 new events (hive_tick, hive_action, hive_escalate, hive_inform, hive_pending_decisions, tentacle_error, hive_ci_failure, hive_auto_fix_started, hive_action_deferred, world_state_updated). HORMONE_UPDATE + AI_DELEGATE_APPROVED/DENIED already shipped Phase 3/5.
- `src/design-system/primitives/*` — Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` blob; Phase 8 adds 3-5 dotted keys (D-206: `body.activeSystem`, `body.dna.activeDoc`, `hive.activeTentacle`, `hive.approval.expandedId`, `hive.filterStatus`)
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — error toasts
- `src/windows/main/MainShell.tsx` — gate-on-onboarding + Suspense route slot
- `src/windows/main/useRouter.ts` — `useRouterCtx`, `openRoute`
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — plus the 4 status tokens Phase 5 Plan 05-02 introduced (`--status-idle/running/success/error`)
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted in MainShell (D-116 retained; Phase 8 clusters do NOT re-hoist)
- `src/features/dev/*` — existing dev isolation routes (17 so far through Phase 7). Plan 08-05 adds 3 more (BodyMapDev, HiveMeshDev, ApprovalQueueDev).
- `src/features/agents/useAgentTimeline.ts` — Phase 5 Pattern §2 reference for rAF-flush + ref-buffer recipe (reused if hive_tick firehose demands it — audit shows 30s tick cadence so rAF flush is NOT needed; polling/debounce suffices).

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering. Phase 7 locked D-166..D-192. Phase 8 adds D-193..D-210.

### Scope philosophy + cluster parallelism (inherits Phase 5/6/7 discipline)

- **D-193:** **Per-cluster wrapper module discipline (inherits D-118 + D-139 + D-166).** Each cluster owns ONE new wrapper file — `src/lib/tauri/body.ts` (Body cluster) and `src/lib/tauri/hive.ts` (Hive cluster). Neither file is shared. This lets Body-wave plans and Hive-wave plans ship in parallel with zero `files_modified` overlap, satisfying the same-wave plans have no file conflicts invariant. Rationale: the ROADMAP Phase 8 description implicitly states each cluster owns a `lib/tauri/` module (HIVE-05 says so explicitly: "hive_* commands wired via src/lib/tauri/hive.ts"). We honor that word-for-word, exactly as Phase 5/6/7 did.

- **D-194:** **`homeostasis.ts` is NOT duplicated into `body.ts`.** `src/lib/tauri/homeostasis.ts` already exists (Phase 3 D-75); Body cluster's HormoneBus dashboard (BODY-03) imports `homeostasisGet`, `homeostasisGetDirective`, `homeostasisGetCircadian` directly from there. `body.ts` wraps ONLY the body-registry + organ + dna + world_model + cardio/urinary/reproductive/joints/supervisor commands; a one-line re-export `export * as homeostasis from './homeostasis';` is added to `body.ts` for convenience. Rationale: no drift, no duplicate JSDoc cites, preserves Phase 3 AmbientStrip's import path.

- **D-195:** **`hive.ts` does NOT subsume per-tentacle command wrappers.** The 10 tentacles (github, slack, discord_deep, email_deep, calendar, linear_jira, cloud_costs, log_monitor, terminal_watch, filesystem_watch) are Rust-internal organs that DO NOT expose individual `#[tauri::command]` handlers directly. They are surfaced indirectly through the 8 hive-level commands (hive_start / hive_get_status / hive_spawn_tentacle / hive_get_reports / hive_approve_decision / hive_set_autonomy / hive_get_digest / hive_stop). Per-tentacle autonomy is read from `organ::organ_get_autonomy(organ, action)` and set via `organ::organ_set_autonomy(organ, action, level)`. The TentacleDetail route (HIVE-02) renders from `hive_get_status().tentacles[n]` + `organ_get_registry()` — no new Rust wrappers required. HIVE-05 "per-tentacle commands wired via corresponding module wrappers" is SATISFIED by the `hive.ts` + `body.ts` (organ) combination because per-tentacle commands ARE the 8 hive-level commands scoped by tentacle id.

- **D-196:** **No new Rust commands in Phase 8 (zero-Rust invariant; inherits D-119 + D-140 + D-167).** Every surface below maps to an EXISTING `#[tauri::command]` registered in `lib.rs`. Audit inventory (~35 commands across ~12 modules):
  - **Body side — ~22 commands:**
    - `body_registry::*` — 3 commands (`body_get_map`, `body_get_system`, `body_get_summary`) per lib.rs:1314-1316 — BodyMap + BodySystemDetail routes.
    - `homeostasis::*` — 4 commands (`homeostasis_get`, `homeostasis_get_directive`, `homeostasis_get_circadian`, `homeostasis_relearn_circadian`) per lib.rs:1327-1330 — HormoneBus route. **WRAPPERS ALREADY EXIST IN `src/lib/tauri/homeostasis.ts`** (Phase 3 D-75).
    - `organ::*` — 4 commands (`organ_get_registry`, `organ_get_roster`, `organ_set_autonomy`, `organ_get_autonomy`) per lib.rs:1298-1301 — OrganRegistry route + Hive tentacle autonomy sliders.
    - `dna::*` — 4 commands (`dna_get_identity`, `dna_get_goals`, `dna_get_patterns`, `dna_query`) per lib.rs:1289-1292 — DNA route.
    - `world_model::*` — 3 commands (`world_get_state`, `world_get_summary`, `world_refresh`) per lib.rs:967-969 — WorldModel route.
    - `cardiovascular::*` — 3 commands (`cardio_get_blood_pressure`, `cardio_get_event_registry`, `blade_vital_signs`) per cardiovascular.rs:303-316 — BodySystemDetail "cardiovascular" drill-in (vital signs + event stats).
    - `urinary::*` — 2 commands (`urinary_flush`, `immune_get_status`) per urinary.rs:203-211 — BodySystemDetail "urinary + immune" drill-in.
    - `reproductive::*` — 2 commands (`reproductive_get_dna`, `reproductive_spawn`) per reproductive.rs:216-222 — BodySystemDetail "reproductive" drill-in (dna package view; spawn Dialog-gated).
    - `joints::*` — 2 commands (`joints_list_providers`, `joints_list_stores`) per joints.rs:284-293 — BodySystemDetail "skeleton/joints" drill-in.
    - `supervisor::supervisor_get_health` + `supervisor_get_service` — ALREADY wrapped in Phase 7 `admin.ts`; BodySystemDetail "body-wide vitals" drill-in RE-USES `admin.supervisorGetHealth()` (cross-cluster read; no duplication — consistent with Phase 6 `temporal_meeting_prep` shared read pattern D-148).
  - **Hive side — ~11 commands:**
    - `hive::*` — 8 commands (`hive_start`, `hive_stop`, `hive_get_status`, `hive_get_digest`, `hive_spawn_tentacle`, `hive_get_reports`, `hive_approve_decision`, `hive_set_autonomy`) per lib.rs:1284-1288, 1336-1338 — HiveMesh + TentacleDetail + AutonomyControls + ApprovalQueue routes.
    - `organ_set_autonomy` / `organ_get_autonomy` — already in `body.ts` (D-194); Hive AutonomyControls calls these for fine-grained per-tentacle-per-action sliders.
    - `ai_delegate::*` — 2 commands (`ai_delegate_introduce`, `ai_delegate_check`) per lib.rs:656-657 — AiDelegate route.
    - `integration_bridge::integration_get_state` + `integration_toggle` + `integration_poll_now` — ALREADY wrapped in Phase 7 `admin.ts`; Hive tentacle status rows RE-USE `admin.integrationGetState()` to cross-reference MCP-bridge vs hive-tentacle liveness. Cross-cluster read consistent with D-148 precedent.
  Rationale: D-50 + D-66 + D-119 + D-140 + D-167 + D-196 — no Rust expansion until a surface proves it needs one. If a route cannot be wired to an existing command, it ships `ComingSoonSkeleton phase={9}` and logs the gap in the plan SUMMARY. This matches the Phase 5/6/7 pattern of upgrading-in-place rather than adding commands. **ZERO Rust files touched in Phase 8** — verified by Plan 08-05 regression script.

- **D-197:** **ComingSoonSkeleton retained for sub-features that exceed budget OR lack backend.** Routes we SHIP REAL:
  - Body: BodyMap, BodySystemDetail, HormoneBus, OrganRegistry, DNA, WorldModel — all 6 get at least a thin wired surface.
  - Hive: HiveMesh, TentacleDetail, AutonomyControls, ApprovalQueue, AiDelegate — all 5 get at least a thin wired surface.
  - Every route exits the "404-looking" state by rendering a real `GlassPanel` with its route label, a brief description, and LIVE data (all 11 routes have backend commands per D-196).
  - Rationale: ROADMAP SC-1/SC-3 says "BodyMap route renders an interactive visualization…" and SC-3 says "Hive landing shows all 10 tentacles…". Phase 8 targets REAL surfaces for all 11 in-scope routes since every one has backend commands available. No honest-deferral cards needed in Phase 8 (contrast Phase 7 Canvas D-175 + GitPanel D-174).

### Plan-split strategy (5 plans across 3 waves — compressed Phase 7 template because Phase 8 is ~60% the scope)

- **D-198:** **Plan split (compressed from Phase 7's 7 plans):**
  - **Plan 08-01** (wave 1 — event registry + payloads + usePrefs): audits Phase 8 Rust emit sites (hive.rs + world_model.rs: `hive_tick`, `hive_action`, `hive_escalate`, `hive_inform`, `hive_pending_decisions`, `hive_ci_failure`, `hive_auto_fix_started`, `hive_action_deferred`, `tentacle_error`, `world_state_updated`). Verified to exist in Rust (grep audit done in this CONTEXT — see §code_context below). Adds ~8-10 new constants + matching payload interfaces. Extends `src/hooks/usePrefs.ts` with 3-5 new Phase 8 dotted keys per D-206. Mid-sized plan (larger than Phase 7's 07-01 because hive emits are real + numerous).
  - **Plan 08-02** (wave 1 — wrappers + index.tsx rewrites): creates `src/lib/tauri/body.ts` with typed wrappers for the ~22 Rust Body commands (see D-196 inventory). Also creates `src/lib/tauri/hive.ts` with typed wrappers for the ~11 Rust Hive commands. Rewrites both cluster `index.tsx` files — `src/features/body/index.tsx` to 6 lazy imports; `src/features/hive/index.tsx` to 5 lazy imports. Seeds 11 per-route placeholder files that Plans 08-03/08-04 will fill in. Creates 2 cluster CSS files + 2 types barrels + tauri barrel update. Zero `files_modified` overlap with 08-01 or 08-03/08-04. Same recipe as Plan 07-02 verbatim.
  - **Plan 08-03** (wave 2 — Body cluster): BodyMap, BodySystemDetail, HormoneBus, OrganRegistry, DNA, WorldModel. Covers BODY-01..07 (BODY-07 coverage via the wrapper + organ + cardio/urinary/reproductive/joints command wiring collectively — flagged in SUMMARY for retrospective cross-check). **Single plan for all 6 body routes** because each route touches a distinct `.tsx` file under `src/features/body/` with zero file overlap — parallelism within the plan is by-task. Plan 07 used 2 parallel UI plans per cluster because cluster had 10-11 routes; Phase 8 clusters have 5-6 routes each, fitting in a single plan within the ~40% context budget.
  - **Plan 08-04** (wave 2 — Hive cluster): HiveMesh, TentacleDetail, AutonomyControls, ApprovalQueue, AiDelegate. Covers HIVE-01..06 (HIVE-05 coverage via `hive.ts` wrappers satisfying "hive_* commands wired" requirement — flagged in SUMMARY). Parallel with 08-03 (no `files_modified` overlap — each plan owns its own subtree under `src/features/body/` or `src/features/hive/`). Single plan for all 5 hive routes for same reason as 08-03.
  - **Plan 08-05** (wave 3 — Playwright specs + verify scripts + Mac operator smoke checkpoint): adds 4 new Playwright specs (body-map, hormone-bus, hive-mesh, approval-queue); extends `verify:all` with `verify-phase8-rust-surface.sh` that asserts ALL ~35 Phase 8 Rust commands (D-196 inventory) are registered + extends `scripts/verify-feature-cluster-routes.sh` to include the 6+5 new routes; registers 3 dev-only routes for plan-isolation harnesses; documents Mac-session M-35..M-40 for operator.
  Rationale: 2 of the 3 wave-2 plans run in parallel because each owns its own subtree under `src/features/body/` or `src/features/hive/`. Wave 1 (registry/prefs + wrappers) ships first because 08-03/08-04 import from both. Wave 3 (Playwright + Mac smoke) ships last because it needs the prior 4 to land. That's the same dep-topology Phase 5/6/7 used, but compressed from 4 UI plans (Phase 7) to 2 UI plans (Phase 8) because the cluster surface is smaller.

- **D-199:** **`files_modified` no-overlap invariant (inherits D-122 + D-143 + D-170).** The wave-2 plans (08-03, 08-04) touch a DISJOINT set of files under `src/features/body/*` or `src/features/hive/*`. The ONLY shared files across the cluster are `src/features/body/index.tsx` and `src/features/hive/index.tsx`. To prevent merge conflicts on the index files, **the wrapper plan 08-02 does the ONE rewrite of each `index.tsx`** (replacing the Phase 1 skeleton exports with direct lazy imports to per-route files). Wave-2 plans only CREATE/fill the per-route files they own and NEVER edit either index.tsx. Same single-writer invariant as Plans 05-02 / 06-02 / 07-02.

### Rust verification + gaps (no new Rust — but verify existing)

- **D-200:** **No Plan 08-00 for Rust.** Phase 8 does NOT need a Rust plan — everything is pre-wired. Plan 08-05 adds a single verify script (`scripts/verify-phase8-rust-surface.sh`) that greps `lib.rs` for the ~35 commands in D-196 inventory and fails if any is missing. This is a DEFENSIVE check: if a future Rust refactor accidentally unregisters a command, Phase 8's verify:all catches it instantly. Mirrors Phase 5/6/7 verify scripts. Runs in CI per Phase 1 D-31.

### Per-cluster visual decisions (Phase 8 specific — D-201..D-205)

- **D-201:** **BodyMap layout (BODY-01).** BodyMap (BODY-01) renders:
  - Hero: `body_get_summary()` → 12 body-system cards in a responsive grid (e.g., `repeat(auto-fit, minmax(220px, 1fr))`). Each card: system name (e.g., "nervous"), module count badge, one-line description (if available in any entry), click → `openRoute('body-system-detail')` + setPref('body.activeSystem', system).
  - Header: "12 body systems, 149 modules" hero line derived from summary sum.
  - Color coding: use Phase 5 status tokens (`--status-running` for healthy systems, `--status-error` for systems with missing modules — initial version: no per-system health yet, all cards neutral; Phase 9 polish can layer vital-signs color).
  - Rationale: ROADMAP SC-1 "BodyMap route renders an interactive visualization of 12 body systems loaded from body_registry.rs; clicking a system drills into BodySystemDetail without error" — directly falsified.
  - Interactivity: card hover shows module preview (first 3 modules of the system), click navigates. No SVG anatomical diagram (Phase 9 polish — deferred per D-209).

- **D-202:** **BodySystemDetail layout (BODY-02).** BodySystemDetail (BODY-02) renders:
  - Reads current system from `prefs.body.activeSystem` (defaults to 'nervous' on first mount).
  - Top: system name hero + module count + one-line description.
  - Main: module list from `body_get_system(system)` → each row: module name, organ, description.
  - Side panel: "Vital signs for this system" — if system ∈ {'cardiovascular'} → `cardio_get_blood_pressure()` + `blade_vital_signs()` + `cardio_get_event_registry()` tables; if {'urinary', 'immune'} → `urinary_flush()` + `immune_get_status()`; if {'identity'} → `reproductive_get_dna()` card; if {'skeleton'} → `joints_list_providers()` + `joints_list_stores()` chips. Generic systems fall back to "No per-system vitals available" message.
  - Actions: "Spawn child agent" button (if system == 'identity') → Dialog → `reproductive_spawn(agent_type, initial_task)` with type/task input.
  - Tabs: "Modules" / "Vitals" / "Events" (events tab shows `cardio_get_event_registry()` for cardiovascular system, otherwise empty state with "No event registry for this system").
  - Rationale: six body systems have rich backend data; others fall back gracefully. Consistent with Phase 7 D-174 GitPanel "honest surface beats faked diff viewer" principle.

- **D-203:** **HormoneBus + OrganRegistry + DNA + WorldModel layouts (BODY-03..06).**
  - **HormoneBus (BODY-03):** `homeostasisGet()` on mount + `useTauriEvent(HORMONE_UPDATE, update)` for live. Renders all 10 hormones as bar meters (0-1 scale; value in 2-dec format; color coded via status tokens — arousal > 0.7 → `--status-error` red tint; energy_mode < 0.3 → dim; etc). Dominant hormone chip (largest value) highlighted. Below: 24-bar circadian histogram from `homeostasisGetCircadian()`; "Relearn circadian" button → `homeostasis_relearn_circadian()` Dialog-confirmed. "Module directive lookup" panel — text input for module name → `homeostasisGetDirective(module)` → rendered as JSON table. Rationale: ROADMAP SC-2 "hormone dashboard displays all 10 hormone values and updates in real time when hormone_update events arrive from homeostasis.rs (WIRE-02 flowing into this surface)" — directly falsified.
  - **OrganRegistry (BODY-04):** `organ_get_registry()` → list of organs (each row: name, health chip, one-line summary, recent observations count, capabilities count). Click row → expands inline panel showing full capabilities list from `OrganStatus.capabilities` with per-capability autonomy chip (0-5 scale). Edit autonomy: inline slider → `organ_set_autonomy(organ, action, level)` with Dialog confirm for level >= 4 (higher autonomy = more dangerous). "View roster" button → Dialog displays `organ_get_roster()` raw text for Brain-style identity. Rationale: ROADMAP SC doesn't quote OrganRegistry verbatim but D-197 keeps it wired since all backend commands exist.
  - **DNA (BODY-05):** tabs: "Identity" / "Goals" / "Patterns" / "Query".
    - Identity tab: `dna_get_identity()` → rendered as markdown-ish `<pre>` (no markdown library; monospace display). Editable via "Edit" button → textarea (local state) + "Save" placeholder (NOTE: `dna_query` is the only dna command that takes input; dna_get_identity is read-only; D-203 Identity edit is CLIENT-SIDE DISPLAY ONLY — backend write-path deferred to Phase 9 per D-209 since no `dna_set_identity` exists). Honest deferral card: "Identity edits save to clipboard + propose changes via Brain query — direct write deferred to Phase 9 polish."
    - Goals tab: `dna_get_goals()` display.
    - Patterns tab: `dna_get_patterns()` display.
    - Query tab: text input → `dna_query(query)` → result card. Rationale: matches BODY-05 "structured view of identity.md, voice.md, personality.md, goals.md, preferences.md, people/teams/companies files" — the 4 dna_* commands cover identity+goals+patterns+query dimensions; people/teams/companies files are surfaced indirectly via `dna_query("people summary")` etc (natural-language query compensates for lack of per-file endpoints).
  - **WorldModel (BODY-06):** `world_get_state()` → hero section (timestamp + workspace_cwd + active_window + network_activity + system_load CPU/RAM/disk bars). Tabs: "Git" (GitRepoState[] list — path, branch, uncommitted/untracked/ahead counts), "Processes" (ProcessInfo[] top 20 by CPU), "Ports" (PortInfo[] list), "File changes" (recent_file_changes[] list), "Todos" (pending_todos[] list). "Refresh" button → `world_refresh()` → replaces snapshot. `useTauriEvent(WORLD_STATE_UPDATED, update)` for live updates from background refresh loop (world_model.rs:869 emits this periodically). "Summary" button → Dialog with `world_get_summary()` raw text (Brain-style digest). Rationale: ROADMAP BODY-06 "World-model surface — infrastructure.md, codebases/*.md, services.md, integrations.md viewer" — the world_model.rs output IS the derived form of these files (git_repos == codebases, running_processes+open_ports == services, network_activity == integrations); matches requirement semantically.

- **D-204:** **HiveMesh + TentacleDetail + AutonomyControls layouts (HIVE-01..03).**
  - **HiveMesh (HIVE-01):** `hive_get_status()` on mount + `useTauriEvent(HIVE_TICK, refresh)` for 30s-cadence updates. Renders: top hero card with running status + autonomy level (global slider → `hive_set_autonomy(level)` Dialog-confirmed for level >= 0.7) + tick stats (total_reports_processed, total_actions_taken, last_tick timestamp). Below: grid of 10 tentacle cards (from `tentacles: TentacleSummary[]`) — each card: platform name, status chip (active/dormant/error/disconnected colored via status tokens), head chip, pending report count badge, last_heartbeat relative-time. Click tentacle card → `openRoute('hive-tentacle')` + setPref('hive.activeTentacle', platform). Bottom: "Recent decisions" list from `hive_get_status().recent_decisions` (Decision enum variant chips). `useTauriEvent(HIVE_ACTION, notify)` surfaces action toasts. Rationale: ROADMAP SC-3 "Hive landing shows all 10 tentacles with live autonomy indicators" — directly falsified.
  - **TentacleDetail (HIVE-02):** reads current tentacle from `prefs.hive.activeTentacle` (defaults to 'tentacle-github'). `hive_get_status()` → find tentacle by id → render hero (platform, status, head, messages_processed, actions_taken, consecutive_failures). `hive_get_reports()` → filter by tentacle_id → rendered as reverse-chrono list (priority chip, category, summary, timestamp, requires_action badge). Per-report drill-in: click report → Dialog with `report.details` JSON formatted + `suggested_action` chip. "Spawn tentacle" button → Dialog (platform+config JSON input) → `hive_spawn_tentacle(platform, config)` → toast. Side panel: organ-scoped autonomy controls from `organ_get_registry()` filtered to this organ → per-action slider → `organ_set_autonomy(organ, action, level)`.
  - **AutonomyControls (HIVE-03):** aggregated per-tentacle autonomy view — matrix layout with tentacles as rows and common actions (send_message, post_reply, create_issue, trigger_deploy, etc.) as columns. Each cell = slider 0-5 bound to `organ_get_autonomy(organ, action)` → `organ_set_autonomy`. Global row at top: "Hive autonomy (overrides all)" → `hive_set_autonomy(level)` slider. Rationale: ROADMAP HIVE-03 "Autonomy controls — per-tentacle slider from 'ask always' through 'act on high confidence' to 'full autonomy'" — the 0-5 scale from organ.rs + the 0.0-1.0 scale from hive.rs are BOTH exposed; mapping: 0 = ask always, 1-2 = ask high-risk, 3-4 = act on high confidence, 5 = full autonomy. Label chips per level.

- **D-205:** **ApprovalQueue + AiDelegate layouts (HIVE-04, HIVE-06).**
  - **ApprovalQueue (HIVE-04):** reads pending decisions from `hive_get_status().heads[].pending_decisions[]` (flattened across all heads) + `useTauriEvent(HIVE_PENDING_DECISIONS, refresh)` + `useTauriEvent(HIVE_ESCALATE, notify)`. Rendered as reverse-chrono list of decision cards (each showing Decision variant — Reply/Escalate/Act/Inform — with platform, confidence, draft/reason/action). Per-card actions: "Approve" → `hive_approve_decision(head_id, decision_index)` + toast + removes from list. "Reject" → local dismissal (no backend reject command; logged in SUMMARY as gap; Phase 9 polish can add). Batch actions: "Approve all low-risk" (confidence > 0.8) button Dialog-confirmed. Filter chips: by head, by decision type, by platform. `prefs.hive.approval.expandedId` persists last-expanded card. Rationale: ROADMAP SC-4 "The decision approval queue displays pending approvals from all tentacles; a user can approve or reject an individual decision; the action is confirmed by BLADE's response" — directly falsified for Approve; reject deferred with SUMMARY note.
  - **AiDelegate (HIVE-06):** `ai_delegate_check()` on mount → hero card showing configured delegate (name, availability, reasoning). "Introduce BLADE to delegate" button → `ai_delegate_introduce()` → toast with delegate's response. Below: decision history from `useTauriEvent(AI_DELEGATE_APPROVED, log)` + `useTauriEvent(AI_DELEGATE_DENIED, log)` — local in-memory ring buffer (last 50 decisions) rendered as list (tool_name, args, verdict, reasoning, timestamp). "Feedback" button per entry → opens Dialog (was_correct? toggle + note) but writes to client-side prefs since no backend `delegate_feedback` command exists (flagged in SUMMARY; Phase 9 polish can wire to character.rs feedback if useful). Rationale: ROADMAP HIVE-06 "AI Delegate review surface — listens to ai_delegate_* events, shows act/ask/queue/ignore outcomes, allows feedback" — directly falsified for listen+display; feedback deferred with SUMMARY note. Event subscriptions are the core requirement; act/ask/queue/ignore terminology aligns with `DelegateDecision` enum (Approved/Denied/Unavailable).

### Data shape + payload discipline (inherits D-126..D-128 + D-159..D-161 + D-186..D-188)

- **D-206:** **Typed wrapper per command (reuses D-126 + D-159 + D-186 recipe).** `src/lib/tauri/body.ts` exports one camelCase function per Rust command — each with `invokeTyped<TReturn, TArgs>(command, args)`, JSDoc `@see src-tauri/src/<file>.rs`, and camelCase → snake_case conversion at invoke boundary. Return types are hand-written interfaces in the SAME file (mirrors `ModuleMapping`, `HormoneState` already in `src/types/hormones.ts`, `OrganStatus`, `OrganCapability`, `WorldState`, `GitRepoState`, `ProcessInfo`, `PortInfo`, `FileChange`, `SystemLoad`, `TodoItem`). Same for `hive.ts` (mirrors `HiveStatus`, `TentacleSummary`, `TentacleStatus` enum, `Priority` enum, `TentacleReport`, `Decision` enum, `HeadModel`). **Enums:** `TentacleStatus` and `Priority` are Rust-side Serialize-as-string enums; mirror as TS union types (`'Active' | 'Dormant' | 'Error' | 'Disconnected'`).

- **D-207:** **Payload type source = Rust struct definitions (reuses D-127 + D-160 + D-187).** No zod, no codegen. Drift caught in code review + Playwright spec runtime casts. Every return type has `[k: string]: unknown` index signature for forward-compat.

- **D-208:** **`src/features/body/types.ts` + `src/features/hive/types.ts` centralise cluster-local type exports** (inherits D-128 + D-161 + D-188). Re-exports + cluster-only UI types (e.g., `BodySystemName` = union of 12 known system names for type-safe routing).

### Event subscription discipline (inherits D-129..D-130 + D-162 + D-189)

- **D-209:** **Event subscriptions for Phase 8 are SUBSTANTIAL (contrast Phase 7 sparse).** Rust emits confirmed by grep audit at this CONTEXT:
  - `hive_tick` (hive.rs:2600) — fires every 30s on hive tick; HiveMesh subscribes to refresh status (D-204)
  - `hive_action` (hive.rs:2723, 2780) — fires when hive executes an action; HiveMesh + ApprovalQueue subscribe for toast (D-204, D-205)
  - `hive_escalate` (hive.rs:2813) — fires when hive needs user decision; ApprovalQueue subscribes + cross-window toast (D-205)
  - `hive_inform` (hive.rs:2686) — fires when hive surfaces info; HiveMesh subscribes for info toast (D-204)
  - `hive_pending_decisions` (hive.rs:2603) — fires when pending decisions change; ApprovalQueue subscribes to refresh queue (D-205)
  - `hive_ci_failure` (hive.rs:2509) — fires on CI failure detection; HiveMesh subscribes for alert toast (D-204)
  - `hive_auto_fix_started` (hive.rs:2530) — fires when auto-fix pipeline starts; HiveMesh subscribes for pipeline toast (D-204)
  - `hive_action_deferred` (hive.rs:2763) — fires when hive defers an action (awaiting approval); ApprovalQueue subscribes (D-205)
  - `tentacle_error` (hive.rs:2304) — fires when a tentacle enters Error status; HiveMesh + TentacleDetail subscribe for error chip update (D-204)
  - `world_state_updated` (world_model.rs:869) — fires on background world-model refresh; WorldModel subscribes for live snapshot updates (D-203)
  - `hormone_update` / `homeostasis_update` — ALREADY shipped Phase 3 (BLADE_EVENTS.HORMONE_UPDATE + HOMEOSTASIS_UPDATE); HormoneBus subscribes (D-203)
  - `ai_delegate_approved` / `ai_delegate_denied` — ALREADY shipped Phase 5 area; AiDelegate subscribes (D-205)
  - `tool_approval_needed` — ALREADY shipped; ApprovalQueue CAN cross-subscribe if user wants unified approval queue across hive + tools (deferred to Phase 9 per separation-of-concerns).
  Plan 08-01 adds ~10 new constants (BLADE_EVENTS.HIVE_TICK, HIVE_ACTION, HIVE_ESCALATE, HIVE_INFORM, HIVE_PENDING_DECISIONS, HIVE_CI_FAILURE, HIVE_AUTO_FIX_STARTED, HIVE_ACTION_DEFERRED, TENTACLE_ERROR, WORLD_STATE_UPDATED) + matching payload interfaces in payloads.ts. HORMONE_UPDATE and AI_DELEGATE_APPROVED/DENIED are NOT added (already exist).

### Frontend architecture (inherits D-131..D-136 + D-163..D-164 + D-190..D-191)

- **D-210:** **Per-route file layout + CSS + prefs** under `src/features/body/` and `src/features/hive/`:
  ```
  src/features/body/
    index.tsx                    — RouteDefinition[] (EDITED ONCE in Plan 08-02)
    types.ts                     — cluster-local types
    BodyMap.tsx                  — BODY-01
    BodySystemDetail.tsx         — BODY-02
    HormoneBus.tsx               — BODY-03
    OrganRegistry.tsx            — BODY-04
    DNA.tsx                      — BODY-05
    WorldModel.tsx               — BODY-06
    body.css                     — cluster-scoped CSS via layer
  src/features/hive/
    index.tsx                    — RouteDefinition[] (EDITED ONCE in Plan 08-02)
    types.ts                     — cluster-local types
    HiveMesh.tsx                 — HIVE-01
    TentacleDetail.tsx           — HIVE-02
    AutonomyControls.tsx         — HIVE-03
    ApprovalQueue.tsx            — HIVE-04
    AiDelegate.tsx               — HIVE-06
    hive.css                     — cluster-scoped CSS via layer
  ```
  Wave-2 plans own disjoint subsets of these files. **CSS discipline:** each cluster owns ONE CSS file (`body.css`, `hive.css`); no per-component CSS unless a genuinely orthogonal design (HormoneBus's 10-bar meter widget + hive-mesh tentacle-card grid are in cluster CSS; BodyMap's 12-card grid is generic). Uses Phase 1 tokens via `var(--glass-1-bg)` etc. D-07 blur caps enforced. Uses Phase 5 Plan 05-02 status tokens verbatim. **`usePrefs` extensions for Phase 8:**
  - `body.activeSystem` — BodyMap → BodySystemDetail handoff (D-201)
  - `body.dna.activeDoc` — DNA route tab memory (D-203)
  - `hive.activeTentacle` — HiveMesh → TentacleDetail handoff (D-204)
  - `hive.approval.expandedId` — ApprovalQueue last-expanded card (D-205)
  - `hive.filterStatus` — HiveMesh tentacle filter chips (active/dormant/error/disconnected)
  Five new dotted keys. Zero Rust impact (per D-12 all prefs are frontend-only localStorage). Plan 08-01 adds these.

### Claude's Discretion (planner-chosen defaults)

- Exact CSS grid template for BodyMap 12-card grid — planner picks `repeat(auto-fit, minmax(220px, 1fr))` (consistent with Phase 5 Plan 05-02 + Phase 7 Analytics).
- Exact hormone-bar color mapping — planner picks: arousal/urgency gradient red, energy_mode/trust gradient green, exploration/confidence gradient blue, satisfaction gradient purple, others neutral grey. 2-decimal value display.
- Circadian histogram rendering — planner picks 24 vertical bars (one per hour) with current-hour highlighted; y-axis label omitted (values 0-1 obvious from bar heights). No SVG — pure CSS flex + `height: {value*100}%`.
- OrganRegistry autonomy slider step — planner picks 1 (integer 0-5), Dialog-confirm for level >= 4 (per D-203).
- DNA identity edit semantics — planner picks clipboard-copy + brain-query propose (no direct write; backend `dna_set_*` doesn't exist; documented deferral per D-203).
- WorldModel refresh cadence — planner picks 15s auto-refresh via WORLD_STATE_UPDATED event subscription + manual "Refresh" button.
- HiveMesh tentacle card aspect — planner picks square-ish 180×160 with status chip bottom-right; platform icon top-left (text-first — emoji or initials, NO icon library).
- AutonomyControls matrix row density — planner picks table with 10 tentacles × 6 common actions = 60 cells; cells with no autonomy record rendered as "—" chip.
- ApprovalQueue batch-approve threshold — planner picks confidence > 0.8 as the "low-risk" cutoff (matches Hive Rust autonomy threshold semantics — 0.3 default, 0.8 high confidence).
- AiDelegate ring buffer size — planner picks 50 entries (enough for a session, not so many that rendering is slow).
- TentacleDetail spawn Dialog config JSON — planner picks `<textarea>` with `{}` placeholder + JSON.parse try/catch (invalid JSON → inline error chip). No schema validation V1.
- BodyMap card click destination — planner picks BodySystemDetail route with `prefs.body.activeSystem` updated (alternative: URL param; rejected — project uses prefs + route id, not URL params per Phase 2 D-52).
- Whether HiveMesh shows a DAG visualization (tentacles → Heads → Big Agent) — planner picks NO (deferred to Phase 9 polish per D-209 pattern — matches Phase 7 WorkflowBuilder "visual DAG node editor deferred" D-176 rationale).
- Whether DNA tab edits support markdown preview — planner picks NO (plain `<pre>`, no markdown library; matches Phase 7 Terminal D-172 "text-first per D-02 CSS-only motion").
- Whether ApprovalQueue supports keyboard shortcuts (j/k to navigate, a to approve) — planner picks NO for V1 (Phase 9 polish POL-04 shortcut sweep).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 8: Body Visualization + Hive Mesh" — goal, 13 requirements (BODY-01..07 + HIVE-01..06), success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-192, Phase 1..7 substrate inventory
- `.planning/RECOVERY_LOG.md` — event catalog; emit policy

### Phase 1..7 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — D-64..D-92
- `.planning/phases/04-overlay-windows/04-CONTEXT.md` — D-93..D-117
- `.planning/phases/05-agents-knowledge/05-CONTEXT.md` — D-118..D-138
- `.planning/phases/06-life-os-identity/06-CONTEXT.md` — D-139..D-165
- `.planning/phases/07-dev-tools-admin/07-CONTEXT.md` — D-166..D-192 (PHASE 8 MIRRORS THIS FILE'S STRUCTURE — compressed 7→5 plans)
- `.planning/phases/05-agents-knowledge/05-PATTERNS.md` — §1 wrapper recipe, §2 rAF flush, §5 cluster index rewrite, §7 Playwright recipe, §8 verify script recipe, §10 common CSS
- `.planning/phases/06-life-os-identity/06-PATTERNS.md` — §3 tabbed-surface recipe, §4 edit-with-Dialog, §5 CSV/file-picker recipe
- `.planning/phases/07-dev-tools-admin/07-PATTERNS.md` — §1 wrapper recipe (cluster scoped), §2 cluster-index rewrite, §3 Terminal scrollback (HormoneBus bar meters mirror), §5 SecurityDashboard danger-zone recipe (hive_set_autonomy high-level Dialog), §6 tabs for WorkflowBuilder (DNA tabs + WorldModel tabs mirror)
- `.planning/phases/07-dev-tools-admin/07-0{1..7}-PLAN.md` — 7-plan template (Phase 8 compresses to 5)
- `.planning/phases/06-life-os-identity/06-0{1..7}-PLAN.md` — 7-plan template reference for smaller clusters

### Code Phase 8 extends (read-only inputs)

**Frontend (substrate):**
- `src/windows/main/MainShell.tsx`, `src/windows/main/useRouter.ts`
- `src/lib/router.ts` — `RouteDefinition`
- `src/lib/tauri/*.ts` — Phase 1..7 wrappers; Phase 8 adds `body.ts` + `hive.ts`; **Phase 3 `homeostasis.ts` + Phase 7 `admin.ts` imported cross-cluster per D-194 + D-196**
- `src/lib/events/index.ts` + `payloads.ts` — 63+ events from Phase 5+6+7
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx`
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted at MainShell (D-116); Phase 8 routes may read via `useChatCtx`
- `src/design-system/primitives/*` — 9 primitives + ComingSoonSkeleton + Dialog
- `src/hooks/usePrefs.ts` — Phase 8 adds 5 new keys (D-210)
- `src/features/dev/*` — dev isolation harness host (Plan 08-05 adds 3 more routes)
- `src/types/hormones.ts` — HormoneState, ModuleDirective already shipped Phase 3 (D-75)

**Feature folders (Phase 1 stubs — Phase 8 replaces):**
- `src/features/body/index.tsx` (6 stubs — Phase 8 Plan 08-02 rewrites)
- `src/features/hive/index.tsx` (5 stubs — Phase 8 Plan 08-02 rewrites)

### Rust source (authoritative for wrapper cites — NO Rust modifications in Phase 8)
- `src-tauri/src/lib.rs:1284-1338` — `generate_handler![]` confirming all ~35 Phase 8 commands registered (see D-196 inventory)
- `src-tauri/src/body_registry.rs` — 3 commands (BodyMap + BodySystemDetail)
- `src-tauri/src/homeostasis.rs` — 4 commands (HormoneBus) — **wrappers already in `src/lib/tauri/homeostasis.ts`**
- `src-tauri/src/organ.rs` — 4 commands (OrganRegistry + Hive autonomy)
- `src-tauri/src/dna.rs` — 4 commands (DNA route)
- `src-tauri/src/world_model.rs` — 3 commands (WorldModel route) + 1 emit (`world_state_updated` at line 869)
- `src-tauri/src/cardiovascular.rs` — 3 commands (BodySystemDetail cardio drill-in)
- `src-tauri/src/urinary.rs` — 2 commands (BodySystemDetail urinary drill-in)
- `src-tauri/src/reproductive.rs` — 2 commands (BodySystemDetail reproductive drill-in)
- `src-tauri/src/joints.rs` — 2 commands (BodySystemDetail skeleton drill-in)
- `src-tauri/src/hive.rs` — 8 commands (all hive routes) + 9 emits (hive_tick line 2600, hive_action 2723/2780, hive_escalate 2813, hive_inform 2686, hive_pending_decisions 2603, hive_ci_failure 2509, hive_auto_fix_started 2530, hive_action_deferred 2763, tentacle_error 2304)
- `src-tauri/src/ai_delegate.rs` — 2 commands (AiDelegate route)
- `src-tauri/src/cardiovascular.rs:174-177` — event registry confirming hive events are catalogued
- `src-tauri/src/supervisor.rs` — 2 commands (already wrapped Phase 7 `admin.ts`; cross-cluster read per D-196)
- `src-tauri/src/integration_bridge.rs` — 3 commands (already wrapped Phase 7 `admin.ts`; cross-cluster read per D-196)

### Prototype / design authority (READ-ONLY reference per D-17)
- `src.bak/components/BodyMap.tsx, HormoneDashboard.tsx, OrganRegistry.tsx, HiveView.tsx, TentacleDetail.tsx, ApprovalQueue.tsx` if present — algorithmic / layout reference only (retype, never import)

### Architecture docs (READ-ONLY, informative)
- `docs/architecture/2026-04-16-blade-body-architecture-design.md` — ground-truth body architecture design (762 lines); informs D-201..D-205 visual decisions without being source-of-truth for tasks. ROADMAP is canonical.

### Explicitly NOT to read (D-17 applies)
- Any `src.bak/` file for import. Planner + executor MAY consult as READ-ONLY layout ground truth; every line of code is retyped in the new feature folder against the Phase 1 primitives + tokens.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1..7 substrate Phase 8 extends

- `src/features/body/index.tsx` currently exports 6 `ComingSoonSkeleton` routes (body-map, body-system-detail, hormone-bus, organ-registry, dna, world-model). Plan 08-02 rewrites this file to import 6 lazy per-route components.
- `src/features/hive/index.tsx` currently exports 5 `ComingSoonSkeleton` routes (hive-mesh, hive-tentacle, hive-autonomy, hive-approval-queue, hive-ai-delegate). Plan 08-02 rewrites to 5 lazy per-route components.
- `src/lib/tauri/` currently has 14 wrapper files (9 Phase 1..4 + 2 Phase 5 + 2 Phase 6 + 2 Phase 7 — NOTE: homeostasis.ts was shipped Phase 3). Plan 08-02 adds 2 new files (`body.ts`, `hive.ts`). ESLint `no-raw-tauri` rule applies to both.
- `src/lib/events/index.ts` currently declares 63+ event constants from Phase 5+6+7. Plan 08-01 adds ~10 new constants for hive + world_model emits. HORMONE_UPDATE + HOMEOSTASIS_UPDATE + AI_DELEGATE_APPROVED/DENIED + CAPABILITY_GAP_DETECTED already exist.
- `src/lib/tauri/homeostasis.ts` — 3 of 4 homeostasis commands wrapped (homeostasisGet, homeostasisGetDirective, homeostasisGetCircadian). Plan 08-02 adds the 4th (`homeostasis_relearn_circadian`) for Hormone Bus "Relearn circadian" button. Alternative: add in `body.ts` as a re-exported wrapper — planner picks ADDING TO `homeostasis.ts` for consistency with the existing file's scope.

### Rust emit sites for Phase 8 event constants (verified by grep audit at CONTEXT gathering)

```
src-tauri/src/hive.rs:2304   → "tentacle_error" (emit_to main)
src-tauri/src/hive.rs:2509   → "hive_ci_failure" (emit_to main)
src-tauri/src/hive.rs:2530   → "hive_auto_fix_started" (emit_to main)
src-tauri/src/hive.rs:2600   → "hive_tick" (emit global — cross-window)
src-tauri/src/hive.rs:2603   → "hive_pending_decisions" (emit_to main)
src-tauri/src/hive.rs:2686   → "hive_inform" (emit_to main)
src-tauri/src/hive.rs:2723   → "hive_action" (emit_to main)
src-tauri/src/hive.rs:2763   → "hive_action_deferred" (emit_to main)
src-tauri/src/hive.rs:2780   → "hive_action" (emit_to main)
src-tauri/src/hive.rs:2813   → "hive_escalate" (emit_to main)
src-tauri/src/homeostasis.rs:444 → "hormone_update" (emit global — already in BLADE_EVENTS.HORMONE_UPDATE)
src-tauri/src/homeostasis.rs:424 → "homeostasis_update" (emit global — legacy; already in BLADE_EVENTS.HOMEOSTASIS_UPDATE)
src-tauri/src/world_model.rs:869 → "world_state_updated" (emit_to main)
```

All 10 unique new event names are confirmed. Plan 08-01 adds all 10 as BLADE_EVENTS constants + payload interfaces.

### Patterns already established that Phase 8 MUST follow

- **Wrapper recipe:** inherits Phase 5 §1 + Phase 6 §1 + Phase 7 §1 verbatim.
- **Event subscription:** `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`. Handler-in-ref; subscription keyed on `[name]` only.
- **Pref writes:** `setPref('dotted.key', value)` — debounced 250ms, single localStorage blob.
- **Style:** compose `.glass .glass-1/2/3` + primitive classes; Tailwind utilities for layout only. No hardcoded hex colors.
- **Routes:** append a `RouteDefinition` to the feature index's `routes` array. Phase 8 edits `src/features/body/index.tsx` + `src/features/hive/index.tsx` ONCE each (in Plan 08-02) to replace skeletons with lazy imports.
- **rAF flush:** NOT needed Phase 8. `hive_tick` fires every 30s (not high-frequency); other emits are burst-y but infrequent.
- **D-116 ChatProvider hoisting:** `useChat`/`ChatProvider` lives in MainShell ONLY — downstream routes read via `useChatCtx`. Do NOT re-provide.
- **Tabbed-surface recipe (Phase 6 §3):** pill tabs + `usePrefs` persistence + `role="tablist"` + `aria-selected`. Phase 8 DNA / BodySystemDetail / WorldModel all use this recipe.
- **Edit-with-Dialog recipe (Phase 6 §4):** identity-data-style explicit confirmation. Phase 8 uses this for ALL destructive/high-autonomy operations (`hive_set_autonomy(level >= 0.7)`, `organ_set_autonomy(level >= 4)`, `hive_approve_decision` batch, `reproductive_spawn`, `homeostasis_relearn_circadian`).
- **Liquid-Glass discipline:** D-07 blur cap + D-70 chat-rgba (bubble/card backgrounds) apply to all Phase 8 surfaces.

### Test harness

- `playwright.config.ts` + `tests/e2e/*.spec.ts` already shipped in Plans 01-09, 02-07, 03-07, 04-07, 05-07, 06-07, 07-07. Phase 8 Plan 08-05 adds 4 new specs reusing the same harness. `npm run test:e2e` runs them. No new test deps.
- `verify:all` scripts live in `scripts/`. Phase 8 Plan 08-05 adds `scripts/verify-phase8-rust-surface.sh` and extends `scripts/verify-feature-cluster-routes.sh` to include the new 6+5 routes.

### Rust patterns Phase 8 does NOT extend

Phase 8 touches **zero Rust files** (D-196 / zero-Rust invariant inherited from Phase 5 D-119 + Phase 6 D-140 + Phase 7 D-167). The Rust surface is frozen — every command used by Phase 8 is already registered in `lib.rs`. If a gap is discovered during planning or execution, the plan MUST document the gap in SUMMARY + defer the affected route to a ComingSoonSkeleton rather than ship a hand-rolled/mocked Rust command.

### Dev experience patterns Phase 8 leans on

- All dev-only routes stay palette-hidden + gated on `import.meta.env.DEV`. Plan 08-05 adds 3 dev-only isolation harnesses (BodyMapDev, HiveMeshDev, ApprovalQueueDev).
- All CI verification scripts live in `scripts/` as Node ESM (`.mjs`) or bash (`.sh`); runnable via `npm run verify:<check>`.
- ESLint `no-raw-tauri` rule continues to apply.
- `__TAURI_EMIT__` + `__TAURI_INVOKE_HOOK__` test-harness hooks (Phase 1..7) extended for Phase 8 Playwright specs.

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 8 success criteria (must be falsifiable):**
- SC-1: BodyMap route renders an interactive visualization of 12 body systems loaded from `body_registry.rs`; clicking a system drills into BodySystemDetail without error (Plan 08-05 BodyMap spec falsifies; `body_get_summary` + `body_get_system` + `openRoute('body-system-detail')` wired)
- SC-2: The hormone dashboard displays all 10 hormone values and updates in real time when `hormone_update` events arrive from `homeostasis.rs` (WIRE-02 flowing into this surface) (Plan 08-05 HormoneBus spec falsifies; `homeostasisGet` + `HORMONE_UPDATE` subscription wired)
- SC-3: Hive landing shows all 10 tentacles with live autonomy indicators; per-tentacle autonomy slider saves via `hive_*` commands (Plan 08-05 HiveMesh spec falsifies; `hive_get_status` + `hive_set_autonomy` + `organ_set_autonomy` wired)
- SC-4: The decision approval queue displays pending approvals from all tentacles; a user can approve or reject an individual decision; the action is confirmed by BLADE's response (Plan 08-05 ApprovalQueue spec falsifies; `hive_get_status().heads[].pending_decisions` + `hive_approve_decision` wired — "reject" deferred per D-205)
- SC-5: Both clusters registered via feature `index.ts` exports; no App.tsx edit was required (trivially verified — App.tsx doesn't exist in V1; Phase 8 only edits feature index files — NEVER router.ts)

**From Rust reality (D-196 inventory):**
- Body cluster has ~22 registered commands spanning 10 modules.
- Hive cluster has ~11 registered commands spanning 3 modules (hive + organ + ai_delegate).
- **NONE of them need new handlers** — all already wired.
- Return types follow Serialize-derive patterns — each wrapper hand-types its return interface mirroring Rust `#[derive(Serialize)]` shape.

**Migration ledger alignment:**
- 6 body routes already in ledger with `phase: 8` + `status: Pending`. Plan 08-05 verify script flips them to `Shipped`.
- 5 hive routes same. No route added or removed in Phase 8 — the stubs are canonical (per D-28 + Phase 5/6/7 DP-3 precedent).

**Palette + nav derivation (D-40 + D-55):**
- NavRail already shows "Body" + "Hive" cluster icons derived from `section`. Clicking navigates to first route of each cluster (first = `body-map` / `hive-mesh` by index order). Plan 08-02's index.tsx rewrite preserves order so the cluster navigation doesn't shift.

</specifics>

<deferred>
## Deferred Ideas

- **BODY-07 as standalone route.** BODY-07 is a wiring/coverage requirement ("Body cluster wires body/cardio/urinary/reproductive/joints/supervisor/homeostasis commands"). Phase 8 satisfies this collectively via `body.ts` wrapper + 6 routes + cross-cluster imports (supervisor from admin.ts, homeostasis from homeostasis.ts). Plan 08-05 SUMMARY surfaces this as a retrospective cross-check (DP-3 analog). Closing requires a scope decision (add dedicated coverage test or retire as satisfied) outside Phase 8's authority.
- **HIVE-05 as standalone route.** HIVE-05 "hive_* commands wired via src/lib/tauri/hive.ts" is a wrapper-coverage requirement. Satisfied by Plan 08-02 verbatim. Plan 08-05 SUMMARY flags for retrospective.
- **SVG anatomical body diagram (BODY-01).** D-201 ships responsive 12-card grid (no SVG human silhouette). Phase 9 polish could add an SVG overlay for whimsy if needed.
- **DNA direct write-back (BODY-05).** D-203 ships read + clipboard-propose only. Backend `dna_set_identity` etc. don't exist; add a Phase 9 polish item OR extend dna.rs with write commands (new Rust, out of scope this phase).
- **HiveMesh DAG visualization (HIVE-01).** D-204 ships a grid of tentacle cards + list of recent decisions. Visual DAG (tentacles → Heads → Big Agent) deferred to Phase 9 polish — matches Phase 7 WorkflowBuilder D-176 rationale.
- **ApprovalQueue reject command (HIVE-04).** D-205 ships Approve via `hive_approve_decision` + client-side Dismiss for Reject. Backend `hive_reject_decision` doesn't exist; add Phase 9 polish OR extend hive.rs.
- **AiDelegate feedback (HIVE-06).** D-205 ships event subscription + local ring buffer + client-side feedback Dialog. Backend `delegate_feedback` doesn't exist; Phase 9 polish could wire to character.rs feedback trait evolution.
- **Cross-tentacle decision batching UI.** D-205 ships single-decision + batch-approve-low-risk Approve. True multi-tentacle orchestration UI (schedule, conditional approve) deferred.
- **WorldModel git operations.** D-203 ships read-only world state display. Git commit/push from WorldModel route deferred — Phase 7 GitPanel D-174 already deferred git-ops itself; WorldModel would inherit that deferral.
- **Real-time tentacle polling status graph.** D-204 ships status chips + event-driven refresh. Time-series polling-rate graph per tentacle deferred.
- **OrganRegistry roster import/export.** D-203 ships roster view via `organ_get_roster()`. Import/export JSON deferred to Phase 9 polish.
- **Keyboard shortcuts for ApprovalQueue.** D-205 NO (Phase 9 POL-04 shortcut sweep).
- **Mobile-friendly responsive layouts.** Same policy as Phase 5+6+7 — desktop-first; Phase 9 polish addresses responsive edge cases.
- **Comprehensive per-route Playwright coverage.** Plan 08-05 ships 4 representative specs (1 per big SC). Exhaustive per-route coverage deferred to Phase 9 polish.

</deferred>

<mac_session_items>
## Mac-Session Verification Items (Operator Handoff — extends Phase 1..7 list)

These checks cannot be verified in the sandbox. Carry forward to the final operator checkpoint run (bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3..7 Mac-smoke per STATE.md strategy). Plan 08-05 Task 3 adds M-35..M-40.

- **M-35:** `npm run tauri dev` launches; navigate to /body-map — BodyMap renders without 404 (SC-1). Confirm 12 body-system cards; click "nervous" card → BodySystemDetail opens with module list; click "cardiovascular" → vital-signs panel shows blade_vital_signs() output; no Rust panic.
- **M-36:** Navigate to /hormone-bus — 10 hormone bar meters render with values from homeostasis_get (SC-2). Observe values update within ≤ 60s (homeostasis.rs 60s tick emits hormone_update — WIRE-02 live). Relearn-circadian Dialog opens; "Confirm" triggers homeostasis_relearn_circadian successfully.
- **M-37:** Navigate to /organ-registry — organ list renders; click an organ → capabilities expand; adjust autonomy slider on a benign action (e.g. "get_unread") → toast confirms; move autonomy to 5 → Dialog confirm required; /dna — 4 tabs load; Query tab answers `dna_query("who am I")` with text.
- **M-38:** Navigate to /world-model — hero shows workspace_cwd + running processes ≥ 1 + git_repos list; click "Refresh" → world_refresh returns new snapshot; observe auto-update within 15s (world_state_updated event).
- **M-39:** Navigate to /hive-mesh — hero card shows hive_get_status values; 10 tentacle cards render (SC-3). Global autonomy slider moves; > 0.7 triggers Dialog; Dialog confirm → hive_set_autonomy updates value. Click a tentacle card → TentacleDetail opens; reports list renders. /hive-autonomy → matrix loads per-tentacle × per-action sliders.
- **M-40:** Navigate to /hive-approval-queue — pending decisions render if hive has generated any (SC-4); Approve button on a decision → hive_approve_decision succeeds + row removes + toast fires. /hive-ai-delegate → ai_delegate_check returns delegate config; "Introduce" button fires (may take 10-30s on Claude Code CLI). Run `cd src-tauri && cargo check` — still 0 errors. (D-65 inheritance — Phase 8 touches no Rust, but cargo check catches any transitive break.)

</mac_session_items>

---

*Phase: 08-body-hive*
*Context gathered: 2026-04-18 via /gsd-plan-phase 8 --auto (no interactive discuss; defaults logged in 08-DISCUSSION-LOG.md)*
