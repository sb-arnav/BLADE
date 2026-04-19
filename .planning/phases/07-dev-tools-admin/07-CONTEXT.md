# Phase 7: Dev Tools + Admin — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 07-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 7 --auto` (planner-picked defaults; Phase 5/6 template mirrored verbatim)

<domain>
## Phase Boundary

Phase 7 lights up two parallel clusters — **Dev Tools** (10 routes shipped as Phase 1 stubs) and **Admin** (11 routes shipped as Phase 1 stubs) — that were declared `ComingSoonSkeleton phase={7}` in Phase 1. Each cluster owns its own typed Tauri wrapper module (`src/lib/tauri/dev_tools.ts`, `src/lib/tauri/admin.ts`) and its own feature folder (`src/features/dev-tools/`, `src/features/admin/`). This phase consumes the Phase 1..6 substrate verbatim: 9 primitives, `invokeTyped`, `useTauriEvent`, `usePrefs`, `ConfigContext`, `MainShell`, `ROUTE_MAP`, `PALETTE_COMMANDS`, `ChatProvider`, design tokens, status tokens (D-132), `useRouterCtx`, `--font-mono`, and the cluster-scoped wrapper discipline Phase 5 + Phase 6 established (D-118 / D-139). It DOES NOT touch any other cluster (Agents + Knowledge = Phase 5, Life OS + Identity = Phase 6, Body + Hive = Phase 8).

**In scope:** 21 requirements — DEV-01..10 (10; current `src/features/dev-tools/index.tsx` has 10 routes, not 11) + ADMIN-01..10 (10; current `src/features/admin/index.tsx` has 11 routes because Phase 1 added a synthetic `'reports'` route for P-03 coverage of the backend `capability_gap_detected → openRoute('reports')` trigger). The ROADMAP §"Coverage Verification" lists DEV-01..11 (11) + ADMIN-01..10 (10) for a total of 21; however the Phase 1 substrate shipped 10+11. **Gate 1 audit (this phase):** cover the 10+11 routes that exist today and surface the 1 orphan requirement id (DEV-11) to the phase-completion retrospective. Per STATE.md / PROJECT.md discipline and the Phase 5 DP-3 / Phase 6 DP-3 precedent, the shipped stubs are canonical — re-adding routes per cluster is scope expansion without source justification. The synthetic `admin/reports` route is retained because it serves a real P-03 coverage purpose (backend openRoute target).

**Out of scope for Phase 7:**
- Agents + Knowledge cluster (Phase 5)
- Life OS + Identity cluster (Phase 6)
- Body visualization + Hive mesh (Phase 8)
- Polish pass — error boundaries, WCAG re-sweep, empty-state illustrations (Phase 9)
- New `#[tauri::command]` additions — every surface below maps to an EXISTING registered command (200+ dev-tools + admin commands in `lib.rs:574-1394`). Zero Rust surface expansion in Phase 7. If a pane would need a new command, it ships as a `ComingSoonSkeleton phase={9}` or documented deferral — never ships with a faked invoke name. (Same discipline as Phase 5 D-119 + Phase 6 D-140.)

**Key Phase 1..6 substrate Phase 7 leans on (no drift permitted):**
- `src/lib/tauri/_base.ts` — `invokeTyped`, `TauriError`
- `src/lib/tauri/chat.ts`, `config.ts`, `window.ts`, `agents.ts`, `knowledge.ts`, `life_os.ts`, `identity.ts` — existing wrapper pattern (Phase 7 adds `dev_tools.ts` + `admin.ts`)
- `src/lib/events/index.ts` + `payloads.ts` — Phase 6 expanded to ~55+ events. Phase 7 may add a handful (workflow_run_* lifecycle, integration_status_changed, security_alert if backend emits); audit in Plan 07-01.
- `src/design-system/primitives/*` — Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton
- `src/hooks/usePrefs.ts` — single `blade_prefs_v1` blob; Phase 7 adds `devTools.activeTab`, `devTools.terminal.cwd`, `devTools.fileBrowser.expandedPaths`, `admin.activeTab`, `admin.security.expandedAlert` dotted keys (D-186)
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx` — error toasts
- `src/windows/main/MainShell.tsx` — gate-on-onboarding + Suspense route slot
- `src/windows/main/useRouter.ts` — `useRouterCtx`, `openRoute`
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — plus the 4 status tokens Phase 5 Plan 05-02 introduced (`--status-idle/running/success/error`)
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted in MainShell (D-116 retained; Phase 7 clusters do NOT re-hoist)
- `src/features/dev/*` — existing dev isolation routes (13 so far: primitives, wrapper-smoke, diagnostics-dev + 3 Phase 4 + 3 Phase 5 + 4 Phase 6). Plan 07-07 adds 4 more.
- `src/features/agents/useAgentTimeline.ts` — Phase 5 Pattern §2 reference; NOT imported by Phase 7, but the rAF-flush + ref-buffer recipe is reused for any high-frequency Phase 7 surface (e.g. Terminal live output stream, WebAutomation agent loop events).

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering. Phase 6 locked D-139..D-165. Phase 7 adds D-166..D-189.

### Scope philosophy + cluster parallelism (inherits Phase 5/6 discipline)

- **D-166:** **Per-cluster wrapper module discipline (inherits D-118 + D-139).** Each cluster owns ONE new wrapper file — `src/lib/tauri/dev_tools.ts` (Dev Tools cluster) and `src/lib/tauri/admin.ts` (Admin cluster). Neither file is shared. This lets Dev-Tools-wave plans and Admin-wave plans ship in parallel with zero `files_modified` overlap, satisfying the same-wave plans have no file conflicts invariant. Rationale: the ROADMAP Phase 7 description literally says "each cluster wires its own `lib/tauri/` module." We honor that word-for-word, exactly as Phase 5 + 6 did.

- **D-167:** **No new Rust commands in Phase 7 (zero-Rust invariant; inherits D-119 + D-140).** Every surface below maps to an EXISTING `#[tauri::command]` registered in `lib.rs:574-1394`. Audit inventory (200+ commands across ~30 modules):
  - **Dev Tools side — ~90 commands:**
    - `native_tools::*` — 3 commands (`run_code_block`, `run_shell`, `ask_ai`) per lib.rs:653-655 — Terminal route.
    - `files::*` — 6 commands (`file_read`, `file_write`, `file_list`, `file_tree`, `file_exists`, `file_mkdir`) per lib.rs:802-807 — FileBrowser route.
    - `file_indexer::*` — 4 commands (`file_index_scan_now`, `file_index_search`, `file_index_recent`, `file_index_stats`) per lib.rs:1293-1296 — FileBrowser auxiliary surface (file search).
    - `indexer::*` — 5 commands (`blade_index_project`, `blade_find_symbol`, `blade_list_indexed_projects`, `blade_reindex_file`, `blade_project_summary`) per lib.rs:888-892 — FileBrowser "project index" tab OR FileBrowser auxiliary.
    - `git_style::*` — 3 commands (`git_style_mine`, `git_style_get`, `git_style_clear`) per lib.rs:581-583 — GitPanel route.
    - `code_sandbox::*` — 4 commands (`sandbox_run`, `sandbox_run_explain`, `sandbox_fix_and_run`, `sandbox_detect_language`) per lib.rs:1045-1048 — CodeSandbox route + Canvas read-through.
    - `workflow_builder::*` — 8 commands (`workflow_list`, `workflow_get`, `workflow_create`, `workflow_update`, `workflow_delete`, `workflow_run_now`, `workflow_get_runs`, `workflow_generate_from_description`) per lib.rs:1050-1057 — WorkflowBuilder route.
    - `browser_agent::*` — 2 commands (`browser_action`, `browser_agent_loop`) per lib.rs:1172-1173 — WebAutomation route.
    - `browser_native::*` — 4 commands (`web_action`, `browser_describe_page`, `browser_session_status`, `connect_to_user_browser`) per lib.rs:746-747 + 1168-1169 — WebAutomation auxiliary.
    - `auto_reply::*` — 3 commands (`auto_reply_draft`, `auto_reply_learn_from_edit`, `auto_reply_draft_batch`) per lib.rs:1273-1275 — EmailAssistant route.
    - `document_intelligence::*` — 8 commands (`doc_ingest`, `doc_search`, `doc_get`, `doc_list`, `doc_delete`, `doc_answer_question`, `doc_cross_synthesis`, `doc_generate_study_notes`) per lib.rs:1115-1122 — DocumentGenerator route. Cross-reference with Knowledge cluster's KnowledgeBase/DocsExplorer (Phase 5) noted; Phase 7 focus = the "generate study notes / synthesis" output side; Phase 5 consumed the "ingest / search / Q&A" read side (D-178).
    - `computer_use::*` — 3 commands (`computer_use_task`, `computer_use_stop`, `computer_use_screenshot`) per lib.rs:783-785 — ComputerUse route.
    - `automation::*` — 15 commands (auto_type_text, auto_press_key, auto_key_combo, auto_mouse_*, auto_open_url, auto_open_path, auto_launch_app, auto_copy_to_clipboard, auto_paste_clipboard, auto_scroll) per lib.rs:731-745 — ComputerUse advanced-tool panel.
    - `ui_automation::*` — 7 commands (`uia_get_active_window_snapshot`, `uia_describe_active_window`, `uia_click_element`, `uia_invoke_element`, `uia_focus_element`, `uia_set_element_value`, `uia_wait_for_element`) per lib.rs:748-754 — ComputerUse UIA sub-panel.
    - `reminders::*` — 5 commands per lib.rs:896-900 — EmailAssistant "follow-up reminder" integration (reminder_add_natural primarily).
    - `watcher::*` — 4 commands per lib.rs:851-854 — FileBrowser "watch directory" affordance.
    - `cron::*` — 5 commands per lib.rs:863-867 — WorkflowBuilder "schedule run" integration.
  - **Admin side — ~110 commands:**
    - `commands::mcp_*` — 9 commands (`mcp_add_server`, `mcp_install_catalog_server`, `mcp_discover_tools`, `mcp_call_tool`, `mcp_get_tools`, `mcp_get_servers`, `mcp_remove_server`, `mcp_server_status`, `mcp_server_health`) per lib.rs:599-607 — McpSettings route + IntegrationStatus auxiliary.
    - `permissions::*` — 4 commands (`classify_mcp_tool`, `set_tool_trust`, `reset_tool_trust`, `get_tool_overrides`) per lib.rs:660-663 — McpSettings "tool trust" panel.
    - `db_commands::db_*` analytics — 4 commands (`db_track_event`, `db_events_since`, `db_prune_analytics`, `db_analytics_summary`) per lib.rs:633-636 — Analytics route.
    - `reports::*` — 5 commands (`report_gap`, `get_reports`, `update_report_status`, `set_report_webhook`, `get_report_webhook`) per lib.rs:718-722 — Reports route (synthetic from P-03 `capability_gap_detected`).
    - `self_upgrade::*` — 8 commands (`self_upgrade_install`, `self_upgrade_catalog`, `self_upgrade_audit`, `pentest_authorize`, `pentest_check_auth`, `pentest_revoke`, `pentest_list_auth`, `pentest_check_model_safety`) per lib.rs:871-878 — CapabilityReports (self_upgrade_*) + SecurityDashboard (pentest_*).
    - `evolution::*` — 6 commands (`evolution_get_level`, `evolution_get_suggestions`, `evolution_dismiss_suggestion`, `evolution_install_suggestion`, `evolution_run_now`, `evolution_log_capability_gap`) per lib.rs:901-906 — CapabilityReports route.
    - `immune_system::immune_resolve_gap` — 1 command per lib.rs:1297 — CapabilityReports "resolve gap" action.
    - `decision_gate::*` — 3 commands (`get_decision_log`, `decision_feedback`, `decision_evaluate`) per lib.rs:1178-1180 — DecisionLog route.
    - `authority_engine::*` — 6 commands (`authority_get_agents`, `authority_get_audit_log`, `authority_get_delegations`, `authority_delegate`, `authority_route_and_run`, `authority_run_chain`) per lib.rs:1000-1005 — DecisionLog auxiliary (authority audit log) + Diagnostics.
    - `audit::audit_get_log` — 1 command per lib.rs:1313 — DecisionLog auxiliary.
    - `security_monitor::*` — 9 commands per lib.rs:1218-1227 — SecurityDashboard route.
    - `symbolic::*` — 4 commands (`symbolic_check_policy`, `symbolic_list_policies`, `symbolic_add_policy`, `symbolic_verify_plan`) per lib.rs:1323-1326 — SecurityDashboard "policy" panel.
    - `temporal_intel::*` — 4 commands (`temporal_what_was_i_doing`, `temporal_daily_standup`, `temporal_detect_patterns`, `temporal_meeting_prep`) per lib.rs:1237-1240 — Temporal route. (D-148 notes `temporal_meeting_prep` is ALSO consumed by Phase 6 MeetingsView; shared read — no conflict.)
    - `execution_memory::*` — 3 commands (`exmem_record`, `exmem_search`, `exmem_recent`) per lib.rs:893-895 — Temporal route "what did BLADE just do" panel.
    - `deep_scan::*` — 3 commands (`deep_scan_start`, `deep_scan_results`, `deep_scan_summary`) per lib.rs:1186-1188 — Diagnostics route.
    - `supervisor::*` — 2 commands (`supervisor_get_health`, `supervisor_get_service`) per lib.rs:1307-1308 — Diagnostics route.
    - `trace::get_recent_traces` — 1 command per lib.rs:664 — Diagnostics route.
    - `sysadmin::*` — 8 commands per lib.rs:1206-1213 — Diagnostics "sysadmin" advanced panel (dry-run, checkpoints, sudo) — gated behind Dialog confirm per D-181.
    - `integration_bridge::*` — 3 commands (`integration_get_state`, `integration_toggle`, `integration_poll_now`) per lib.rs:1190-1192 — IntegrationStatus route.
    - `config::*` provider/routing — 6 commands (`get_all_provider_keys`, `store_provider_key`, `switch_provider`, `get_task_routing`, `set_task_routing`, `save_config_field`) per lib.rs:586-591 — KeyVault (provider keys) + ModelComparison (task routing + switch_provider).
    - `commands::test_provider` — 1 command per lib.rs:598 — ModelComparison.
    - `commands::debug_config`, `commands::set_config`, `commands::update_init_prefs` — 3 commands per lib.rs:592, 596-597 — Diagnostics advanced pane.
    - `commands::reset_onboarding` — 1 command per lib.rs:593 — Diagnostics "reset onboarding" Dialog action.
    - `self_critique::*` — 4 commands per lib.rs:957-960 — CapabilityReports auxiliary (self-critique history).
    - `tool_forge::*` — 4 commands per lib.rs:995-998 — CapabilityReports "forge new tool" panel.
  Rationale: D-50 + D-66 + D-119 + D-140 + D-167 triad — no Rust expansion until a surface proves it needs one. If a route cannot be wired to an existing command, it ships `ComingSoonSkeleton phase={9}` and logs the gap in the plan SUMMARY. This matches the Phase 5 D-119 + Phase 6 D-140 pattern of upgrading-in-place rather than adding commands.

- **D-168:** **ComingSoonSkeleton retained for sub-features that exceed budget OR lack backend.** Routes we SHIP REAL:
  - Dev Tools: Terminal, FileBrowser, GitPanel, Canvas (thin — D-171), WorkflowBuilder, WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, ComputerUse — all 10 get at least a thin wired surface.
  - Admin: Analytics, CapabilityReports, Reports, DecisionLog, SecurityDashboard, Temporal, Diagnostics, IntegrationStatus, McpSettings, ModelComparison, KeyVault — all 11 get at least a thin wired surface.
  - Every route exits the "404-looking" state by rendering a real `GlassPanel` with its route label, a brief description, and either LIVE data (where wired) or a clearly-labeled `"Ships in Phase 9 polish"` sub-skeleton with dev-mode route id visible.
  - Rationale: ROADMAP SC-1/SC-3 say "Navigating to any Dev Tools/Admin route produces a rendered surface with no 404 fallback." ComingSoonSkeleton meets this criterion by design (Phase 1 D-44) — but Phase 7 targets REAL surfaces for all 21 in-scope routes since every one has backend commands available (except Canvas, which ships a thin wrapper around `code_sandbox::sandbox_run` + an honest "full drawing surface in Phase 9" panel per D-171).

### Plan-split strategy (7 plans across 4 waves — mirrors Phase 5/6 exactly)

- **D-169:** **Plan split:**
  - **Plan 07-01** (wave 1 — event registry + payloads + usePrefs): audits Phase 7 Rust emit sites (workflow lifecycle, integration_status_changed, security alerts, browser_agent_event, etc.) + extends `src/hooks/usePrefs.ts` with 5 new Phase 7 dotted keys. Mostly Prefs + opportunistic event additions. **Most Phase 7 modules are request-response (CRUD + compute-now) — this plan's event additions are smaller than Phase 5's; main work is the Prefs extension.** If Rust emits no lifecycle events worth subscribing from Dev Tools / Admin (audit during plan execution), the event-registry portion is a no-op and this plan is nearly all Prefs.
  - **Plan 07-02** (wave 1 — wrappers + index.tsx rewrites): creates `src/lib/tauri/dev_tools.ts` with typed wrappers for the ~90 Rust Dev Tools commands (see D-167 inventory). Also creates `src/lib/tauri/admin.ts` with typed wrappers for the ~110 Rust Admin commands. Rewrites both cluster `index.tsx` files — `src/features/dev-tools/index.tsx` to 10 lazy imports; `src/features/admin/index.tsx` to 11 lazy imports (10 ADMIN + 1 synthetic reports). Seeds 21 per-route placeholder files that Plans 07-03..06 will fill in. Creates 2 cluster CSS files + 2 types barrels + tauri barrel update. Zero `files_modified` overlap with 07-01 or 07-03..06. Same recipe as Plan 06-02 verbatim.
  - **Plan 07-03** (wave 2 — Dev Tools "rich" surfaces A): Terminal, FileBrowser, GitPanel, Canvas, WorkflowBuilder. Covers DEV-01..05.
  - **Plan 07-04** (wave 2 — Dev Tools "rich" surfaces B): WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, ComputerUse. Covers DEV-06..10. Parallel with 07-03 (no `files_modified` overlap — each plan touches its own sub-component files under `src/features/dev-tools/`). **Split point between 07-03 and 07-04 is 5+5 because Dev Tools has 10 routes, not 11.**
  - **Plan 07-05** (wave 2 — Admin "rich" surfaces A): Analytics, CapabilityReports, Reports, DecisionLog, SecurityDashboard. Covers ADMIN-01..05 (approximately; synthetic `reports` route included as part of this plan for capability_gap_detected coverage per P-03 + Phase 1 index comment).
  - **Plan 07-06** (wave 2 — Admin "rich" surfaces B): Temporal, Diagnostics, IntegrationStatus, McpSettings, ModelComparison, KeyVault. Covers ADMIN-06..10. Parallel with 07-03, 07-04, 07-05 (zero overlap). **Split is 5+6 because Admin has 11 routes.**
  - **Plan 07-07** (wave 3 — Playwright specs + verify scripts + Mac operator smoke checkpoint): adds 4 new Playwright specs (dev-tools-terminal, dev-tools-workflow-builder, admin-security-dashboard, admin-mcp-settings); extends `verify:all` with `verify-phase7-rust-surface.sh` that asserts ALL 200+ Phase 7 Rust commands (D-167 inventory) are registered + extends `scripts/verify-feature-cluster-routes.sh` to include the 10+11 new routes; registers 4 dev-only routes for each plan's isolation harness; documents Mac-session M-28..M-34 for operator.
  Rationale: 4 of the 5 wave-2 plans run in parallel because each owns its own subtree under `src/features/dev-tools/` or `src/features/admin/` + isolated subset of sub-component files. Wave 1 (registry/prefs + wrappers) ships first because 07-03..06 import from both. Wave 3 (Playwright + Mac smoke) ships last because it needs the prior 5 to land. That's the same dep-topology Phase 5 + 6 used.

- **D-170:** **`files_modified` no-overlap invariant (inherits D-122 + D-143).** Each wave-2 plan (07-03, 07-04, 07-05, 07-06) touches a DISJOINT set of files under `src/features/dev-tools/*` or `src/features/admin/*`. The ONLY shared files across the cluster are `src/features/dev-tools/index.tsx` and `src/features/admin/index.tsx`. To prevent merge conflicts on the index files, **the wrapper plan 07-02 does the ONE rewrite of each `index.tsx`** (replacing the Phase 1 skeleton exports with direct lazy imports to per-route files). Wave-2 plans only CREATE the per-route files they own and NEVER edit either index.tsx. Same single-writer invariant as Plan 05-02 / 06-02.

### Rust verification + gaps (no new Rust — but verify existing)

- **D-171:** **No Plan 07-00 for Rust.** Phase 7 does NOT need a Rust plan — everything is pre-wired. Plan 07-07 adds a single verify script (`scripts/verify-phase7-rust-surface.sh`) that greps `lib.rs` for the 200+ commands in D-167 inventory and fails if any is missing. This is a DEFENSIVE check: if a future Rust refactor accidentally unregisters a command, Phase 7's verify:all catches it instantly. Mirrors Phase 5 + 6's verify scripts. Runs in CI per Phase 1 D-31.

### Per-cluster visual decisions (Phase 7 specific — D-172..D-185)

- **D-172:** **Terminal layout (DEV-01).** Terminal (DEV-01) renders:
  - Top: current working directory chip (persisted via `prefs.devTools.terminal.cwd`) + "Clear" button.
  - Main: scrollback `<pre>` rendering each invocation as `$ cmd` + stdout + stderr blocks (monospace via `--font-mono`; stderr tinted `--status-error`). Autoscroll to bottom on new output.
  - Input row: `<input>` with Enter submit; on submit invoke `native_tools::run_shell({ command, cwd })`; append result to scrollback.
  - Secondary: "Run code block" button opens Dialog with language select + textarea; invokes `native_tools::run_code_block({ code, language })`.
  - Rationale: matches backend surface; NO PTY/terminal emulator library — text-first per D-02 CSS-only motion discipline; ROADMAP Phase 7 SC-1 says "Terminal routes bash through `native_tools.rs` and returns output" — this renders that exact path.

- **D-173:** **FileBrowser layout (DEV-02).** FileBrowser (DEV-02) renders:
  - Left pane: `files::file_tree(path, depth=2)` + expandable folders (state persisted via `prefs.devTools.fileBrowser.expandedPaths` set).
  - Right pane: selected file — `files::file_read(path)` result rendered as `<pre>` (truncated at 200KB with "Load more" button); file metadata via `files::file_exists` + size-from-tree.
  - Top actions: "Search files" triggers `file_indexer::file_index_search({ query })`; "Re-index" invokes `file_index_scan_now`; "Stats" opens Dialog showing `file_index_stats`.
  - Tabs: "Files" / "Projects" — Projects tab calls `indexer::blade_list_indexed_projects` + "Index project" button invoking `indexer::blade_index_project({ path })`; per-project: `blade_project_summary`, `blade_find_symbol`.
  - "Watch" toggle: adds the current directory via `watcher::watcher_add` with kind='directory'; toggle visibility of live `watcher::watcher_list_all`.
  - Rationale: two distinct file surfaces (raw fs + indexed search + watchers) fold cleanly into one route; 3 backend modules cited in D-167.

- **D-174:** **GitPanel layout (DEV-03).** GitPanel (DEV-03) renders:
  - Top: current git style card from `git_style::git_style_get()` — shows extracted commit-style preferences (message length, emoji use, etc.).
  - Main action: "Mine git style" button → `git_style::git_style_mine({ repo_path, limit })` → shows loading spinner → refreshes the style card. Rationale: the ROADMAP description of GitPanel doesn't bind us to "diff viewer" semantics; the actual backend-exposed capability IS the style miner. This matches what exists today.
  - "Clear style" button → `git_style::git_style_clear()` with Dialog confirm.
  - Secondary: honest deferral card — "Diff viewer / commit history / PR surface ships in Phase 9 polish" (ROADMAP SC has no "diff viewer" requirement; git_style is the only git-related backend surface available).
  - Rationale: backend surface is small (3 commands); shipping an honest surface beats a faked diff viewer.

- **D-175:** **Canvas layout (DEV-04).** Canvas (DEV-04) renders a **thin wired surface + honest deferral**:
  - Top: "Run code" panel backed by `code_sandbox::sandbox_run` + language detection via `code_sandbox::sandbox_detect_language`. This is the ONLY canvas-adjacent backend capability available.
  - Main: honest deferral card — "Interactive canvas (drawing, whiteboard, visual programming) ships in Phase 9 polish" with dev-mode route id visible.
  - Rationale: D-167 inventory shows no canvas-drawing backend; the Phase 1 stub labelled this "Canvas" which implies whiteboard-ish; without backend, a faked canvas would be data-less. D-168 policy says thin wired surface + honest deferral, not hidden ComingSoonSkeleton.

- **D-176:** **WorkflowBuilder layout (DEV-05).** WorkflowBuilder (DEV-05) renders:
  - Left sidebar: workflow list from `workflow_list()` — each row: name + last-run status chip.
  - Right pane: selected workflow detail from `workflow_get(id)` + runs history from `workflow_get_runs(id, limit=20)`. Run button invokes `workflow_run_now(id)` → refreshes runs.
  - Top actions row: "New workflow" button → Dialog with name + description → `workflow_create({ name, description })`; "Generate from description" button → Dialog with description input → `workflow_generate_from_description({ description })` → pre-populates form.
  - Inline edit affordances: "Rename" + "Delete" buttons per workflow → `workflow_update` / `workflow_delete` with Dialog confirm.
  - Tabs inside workflow detail: "Steps" (from workflow_get response) / "Runs" (history) / "Schedule" — Schedule tab shows if a `cron::*` entry exists for this workflow id; "Add schedule" button → Dialog with cron expression → `cron::cron_add({ name: workflow-id, schedule, payload })`.
  - Rationale: backend surface = 8 workflow commands + cron shared; tabs prevent flat-list bloat.

- **D-177:** **WebAutomation layout (DEV-06).** WebAutomation (DEV-06) renders:
  - Top: browser session status chip from `browser_session_status()` + "Connect" button invoking `connect_to_user_browser()`.
  - Main input: textarea for goal + "Run" button → `browser_agent::browser_agent_loop({ goal, max_steps })`. ROADMAP SC-2 says "WebAutomation accepts a goal, calls browser_agent_* commands, and displays live screen feedback" — loop runs, intermediate results stream into the result panel. If Rust emits browser_agent_event lifecycle, Plan 07-01 adds the constant and this pane subscribes; otherwise, the loop returns synchronously with the full trace and we render the steps from the response payload. D-183 covers the emit audit.
  - Tool panel (pill tabs): "Click" / "Describe page" / "Navigate" — each invokes `browser_action({ action, selector? })` or `browser_describe_page()` / `web_action({...})` with inline input.
  - Screenshot pane: latest page screenshot rendered as base64 img if `browser_action` returns one.
  - Rationale: 6 browser commands; tabbed tool bench + main agent loop surface; SC-2 falsifiable.

- **D-178:** **EmailAssistant layout (DEV-07).** EmailAssistant (DEV-07) renders:
  - Top: input — recipient name + incoming email text (paste-area) + intent (reply/followup/introduce) radio pills.
  - "Draft" button → `auto_reply::auto_reply_draft({ recipient, message, intent })` → shows generated draft in `<pre>` card.
  - Right panel: "Learn from edit" — after the user edits the draft, "Save learning" button invokes `auto_reply_learn_from_edit({ original, edited })` → toast.
  - Batch tab: "Batch draft" → `auto_reply_draft_batch({ items })` with csv-paste input.
  - Follow-up integration: "Schedule follow-up reminder" button invokes `reminders::reminder_add_natural({ text: '...' })` → toast with parsed time. Rationale: reminders::* has no other Phase 7 home; EmailAssistant is the obvious semantic host.
  - Rationale: 3 auto_reply commands + 5 reminders commands; natural-language reminder integration matches real workflow.

- **D-179:** **DocumentGenerator layout (DEV-08).** DocumentGenerator (DEV-08) renders:
  - Top: source documents list from `doc_list()` + "Ingest" button opening Dialog with file picker + `doc_ingest({ path })`.
  - Main: generation modes (pill tabs) — "Study notes" / "Cross-synthesis" / "Q&A".
    - Study notes tab: pick one doc → "Generate study notes" → `doc_generate_study_notes({ doc_id })` → rendered in glass card.
    - Cross-synthesis tab: pick 2+ docs (checkbox multi-select) → "Synthesize" → `doc_cross_synthesis({ doc_ids })`.
    - Q&A tab: pick doc → question input → `doc_answer_question({ doc_id, question })` → answer card.
  - Sidebar: "Search docs" invokes `doc_search({ query })` — dedicated to DocumentGenerator, NOT overlapping with Knowledge cluster's KnowledgeBase (which Phase 5 shipped for read/ingest). Rationale: Phase 7 DocumentGenerator is about MAKING new documents FROM ingested corpus; Phase 5 KnowledgeBase is about READING the corpus. Two surfaces, one shared backend — legitimate dual home like Phase 6 SocialGraph + PersonaView's People tab.
  - Rationale: 8 doc commands; 3-mode tabbed surface.

- **D-180:** **CodeSandbox layout (DEV-09).** CodeSandbox (DEV-09) renders:
  - Top: language select (auto-detect via `code_sandbox::sandbox_detect_language`) + monaco-free `<textarea>` (mono font).
  - Action buttons: "Run" → `sandbox_run({ language, code })`; "Run + explain" → `sandbox_run_explain({...})`; "Fix + run" → `sandbox_fix_and_run({...})` (for errors).
  - Output panel: stdout + stderr rendered with colored borders via status tokens; exit code chip.
  - History sidebar: last 10 runs from `usePrefs` local buffer (no backend reader; client-side ring buffer).
  - Rationale: 4 sandbox commands map 1:1 to 3 action buttons + detect utility.

- **D-181:** **ComputerUse layout (DEV-10).** ComputerUse (DEV-10) renders:
  - Top: "Active task" card — if `computer_use_task` is running, shows live status; "Stop" button invokes `computer_use_stop()`.
  - Screenshot pane: latest screenshot from `computer_use_screenshot()` rendered; "Refresh" button triggers a new screenshot.
  - Main action: "Start task" input — textarea for goal + "Run" → `computer_use_task({ goal })`.
  - Tabs: "Automation" (raw) / "UI Automation".
    - Automation tab: pill buttons wrapping `automation::auto_*` (15 commands) — type text / press key / mouse move / click / scroll / open URL / open path / launch app / clipboard ops. Each behind inline mini-form + Dialog confirm for destructive ones.
    - UI Automation tab: `uia_get_active_window_snapshot` button → renders JSON tree; per-element actions (`uia_click_element`, `uia_invoke_element`, `uia_focus_element`, `uia_set_element_value`, `uia_wait_for_element`) inline.
  - Rationale: 25 commands fold into main + 2 tabs; dangerous ops (sudo-like, launch_app, auto_open_path) behind Dialog confirm consistent with D-167 security posture.

- **D-182:** **Analytics + CapabilityReports + Reports + DecisionLog (Admin subset A: ADMIN-01..04).**
  - **Analytics (ADMIN-01)**: 4 db_* analytics commands → 4-panel dashboard (summary KPIs, events-since feed, track-event debug form, prune controls Dialog-gated). Rationale: matches backend surface; operator ergonomics first.
  - **CapabilityReports (ADMIN-02)**: evolution suggestions list + current level (`evolution_get_level` hero card) + self_upgrade catalog + self_critique history. Sections: "Suggestions" (accept/dismiss buttons → `evolution_install_suggestion` / `evolution_dismiss_suggestion`), "Catalog" (`self_upgrade_catalog` + "Install" → `self_upgrade_install` Dialog-confirm), "Audit" (`self_upgrade_audit` view), "Gaps" (`evolution_log_capability_gap` entry + `immune_system::immune_resolve_gap` action), "Self-critique" (`self_critique_history` + "Run deep roast" → `self_critique_deep_roast`; "Weekly meta" → `self_critique_weekly_meta`), "Forge" (`tool_forge::forge_list_tools` + "New tool" → `forge_new_tool` + delete/test).
  - **Reports (synthetic P-03)**: reports list from `get_reports()` + detail pane; "Mark resolved" button → `update_report_status`; top input → `report_gap({ summary })` to manually log; webhook config in footer (`get_report_webhook` + `set_report_webhook`). Rationale: P-03 says backend-pushed `capability_gap_detected` events call `openRoute('reports')`; Phase 1 added this route explicitly. Now we wire it.
  - **DecisionLog (ADMIN-04)**: `get_decision_log(limit=100)` as reverse-chrono list — each row: decision type + confidence + outcome + "Feedback" action → Dialog → `decision_feedback({ decision_id, was_correct, note })`. "Evaluate" panel → `decision_evaluate({ signal })` free-form input for debugging. Authority audit log sub-tab — `authority_get_audit_log` + `authority_get_delegations`. Global audit log sub-tab — `audit_get_log`. Rationale: ROADMAP SC-3 "DecisionLog reads decision-gate history from decision_gate_* commands" directly falsified.

- **D-183:** **SecurityDashboard layout (ADMIN-05).** SecurityDashboard (ADMIN-05) renders:
  - Top: hero card from `security_overview()` — status traffic-light (idle/warn/critical via status tokens).
  - Tabs: "Alerts" / "Scans" / "Audit" / "Policies" / "Pentest".
    - Alerts tab: active alerts derived from `security_overview` + `security_check_breach` + `security_check_url` form.
    - Scans tab: "Run network scan" → `security_scan_network`; "Scan sensitive files" → `security_scan_sensitive_files`; results rendered as tables.
    - Audit tab: "Run full audit" → `security_run_audit`; "Deps audit" → `security_audit_deps`; "Code scan" → `security_scan_code` (requires code path input).
    - Policies tab: `symbolic::symbolic_list_policies` + "Add policy" → `symbolic_add_policy`; "Check policy" → `symbolic_check_policy`; "Verify plan" → `symbolic_verify_plan`.
    - Pentest tab (danger zone): `pentest_list_auth` + `pentest_authorize` / `pentest_revoke` / `pentest_check_auth` behind Dialog confirm + ALL-CAPS warning banner. `pentest_check_model_safety` inline. Rationale: pentest commands exist in Rust — exposing them without a clearly-danger-gated UI is irresponsible; gating + warnings is the honest treatment.
  - Rationale: ROADMAP SC-4 "SecurityDashboard surfaces active alerts from security_monitor.rs" — directly falsified; Symbolic policies + pentest are related admin surfaces that have no other Phase 7 route home.

- **D-184:** **Temporal + Diagnostics + IntegrationStatus (Admin subset B: ADMIN-06..08).**
  - **Temporal (ADMIN-06)**: `temporal_daily_standup()` hero card (today's standup summary) + tabs: "What was I doing" (`temporal_what_was_i_doing({ window_hours: 24 })` + variable-hour input), "Patterns" (`temporal_detect_patterns()`), "Meeting prep" (`temporal_meeting_prep({ meeting_id })` deep-link, also reachable from Phase 6 MeetingsView — shared read, zero conflict), "Execution memory" (`execution_memory::exmem_recent` + `exmem_search` + `exmem_record` debug form).
  - **Diagnostics (ADMIN-07)**: ROADMAP SC-4 "Diagnostics view shows module health for all running background tasks" — directly falsified via `supervisor_get_health()` hero panel (one card per running background loop: cron, health-scanner, integration-bridge, perception-loop, etc.). Sub-tabs: "Traces" (`trace::get_recent_traces`), "Authority" (`authority_get_agents` + `authority_get_delegations`), "Deep scan" (`deep_scan_results` + "Run now" → `deep_scan_start`), "Sysadmin" (danger-gated: `sysadmin_detect_hardware`, `sysadmin_list_checkpoints`, `sysadmin_save_checkpoint`, `sysadmin_load_checkpoint`, `sysadmin_rollback`, and Dialog-gated `sysadmin_dry_run_edit` / `sysadmin_dry_run_command` / `sysadmin_sudo_exec`), "Config" (`debug_config`, `set_config` Dialog-confirm JSON patch, `update_init_prefs`, `reset_onboarding` Dialog-confirm button).
  - **IntegrationStatus (ADMIN-08)**: `integration_get_state()` → per-service card (gmail/slack/github/discord/telegram/obsidian/etc.) with status chip + toggle (`integration_toggle({ service, enabled })`) + "Poll now" button (`integration_poll_now({ service })`). MCP server status sub-section — `mcp_get_servers` + `mcp_server_health` per server. Rationale: two polling surfaces share the "is it working right now" concern.

- **D-185:** **McpSettings + ModelComparison + KeyVault (Admin subset B tail: ADMIN-09..10 + ADMIN-11 orphan).**
  - **McpSettings (ADMIN-09)**: `mcp_get_servers()` list with per-server status + tool count (from `mcp_get_tools`); "Add server" Dialog → `mcp_add_server` (name, command, args, env); "Install from catalog" → `mcp_install_catalog_server({ catalog_id })`; "Remove" → `mcp_remove_server` Dialog-confirm; "Discover tools" → `mcp_discover_tools` for a server; "Call tool" debug panel → `mcp_call_tool({ server, tool, args })`. Tool trust sub-section — `permissions::get_tool_overrides` + per-tool `classify_mcp_tool` + trust level set via `set_tool_trust` + "Reset" → `reset_tool_trust`.
  - **ModelComparison (ADMIN-10)**: current provider + task routing from `get_task_routing()` + `config::switch_provider` controls. Per task (chat/reasoning/agent/vision) row: current model chip + "Change" Dialog → `set_task_routing({ task, provider, model })`. "Test provider" button → `test_provider({ provider })` → shows latency + error if any. `save_config_field` used as the persistence primitive.
  - **KeyVault (ADMIN-11 — orphan in ROADMAP, kept per Phase 1 substrate)**: `get_all_provider_keys()` list (masked) + "Store" Dialog → `store_provider_key({ provider, api_key })`. Rationale: ROADMAP says ADMIN-01..10 (10 requirements) but Phase 1 shipped 11 routes (10 + synthetic `reports`). Because `reports` is the synthetic one serving P-03, and KeyVault maps to a genuine secrets-management concern that lacks an ADMIN-11 label, planner treats KeyVault as the orphan to surface in Plan 07-07 retrospective. **Alternative:** KeyVault maps to ADMIN-10 and ModelComparison is the orphan — planner picks KeyVault-as-orphan because ModelComparison ties directly to task routing (ADMIN-10 natural fit for "model configuration"). Documented divergence; Phase 7 retrospective may re-home.

### Data shape + payload discipline (inherits D-126..D-128 + D-159..D-161)

- **D-186:** **Typed wrapper per command (reuses D-126 + D-159 recipe).** `src/lib/tauri/dev_tools.ts` exports one camelCase function per Rust command — each with `invokeTyped<TReturn, TArgs>(command, args)`, JSDoc `@see src-tauri/src/<file>.rs`, and camelCase → snake_case conversion at invoke boundary. Return types are hand-written interfaces in the SAME file. Same for `admin.ts`.

- **D-187:** **Payload type source = Rust struct definitions (reuses D-127 + D-160).** No zod, no codegen. Drift caught in code review + Playwright spec runtime casts. Every return type has `[k: string]: unknown` index signature for forward-compat.

- **D-188:** **`src/features/dev-tools/types.ts` + `src/features/admin/types.ts` centralise cluster-local type exports** (inherits D-128 + D-161). Re-exports + cluster-only UI types.

### Event subscription discipline (inherits D-129..D-130 + D-162)

- **D-189:** **Event subscriptions for Phase 7 are sparse.** Most Phase 7 modules are request-response (CRUD + compute-now pattern). Audit candidates for Plan 07-01:
  - `workflow_run_started` / `workflow_run_completed` — if `workflow_builder.rs` emits these in the scheduler, WorkflowBuilder subscribes for live run-status updates; otherwise polling on "Run now" is fine.
  - `integration_status_changed` — if `integration_bridge.rs` emits when a service connects/disconnects, IntegrationStatus subscribes; otherwise poll on focus.
  - `security_alert` — if `security_monitor.rs` emits active alerts, SecurityDashboard subscribes; otherwise the hero card refetches on mount + after "Run scan" actions.
  - `browser_agent_event` — if `browser_agent.rs` streams intermediate steps during `browser_agent_loop`, WebAutomation subscribes to update the live trace; otherwise the loop returns the full trace synchronously.
  - `capability_gap_detected` — ALREADY wired Phase 1 (P-03 → openRoute('reports')); Reports surface may subscribe for a live counter of pending reports.
  - `decision_gate_event` — if decision_gate.rs emits on each classifier decision, DecisionLog subscribes for live feed; otherwise polling.
  Rationale: Phase 7 doesn't have a "10-subscription surface" like AgentDetail. Event extensions are opportunistic. Plan 07-01's main work remains the Prefs extension.

### Frontend architecture (inherits D-131..D-136 + D-163..D-164)

- **D-190:** **Per-route file layout** under `src/features/dev-tools/` and `src/features/admin/`:
  ```
  src/features/dev-tools/
    index.tsx                    — RouteDefinition[] (EDITED ONCE in Plan 07-02)
    types.ts                     — cluster-local types
    Terminal.tsx                 — DEV-01
    FileBrowser.tsx              — DEV-02
    GitPanel.tsx                 — DEV-03
    Canvas.tsx                   — DEV-04
    WorkflowBuilder.tsx          — DEV-05
    WebAutomation.tsx            — DEV-06
    EmailAssistant.tsx           — DEV-07
    DocumentGenerator.tsx        — DEV-08
    CodeSandbox.tsx              — DEV-09
    ComputerUse.tsx              — DEV-10
    dev-tools.css                — cluster-scoped CSS via layer
    (+ sub-component files where a route has non-trivial composition — e.g. WorkflowBuilder may split into WorkflowSidebar.tsx + WorkflowDetail.tsx; ComputerUse may split into AutomationTab.tsx + UiAutomationTab.tsx)
  ```
  Same layout under `src/features/admin/` with files Analytics.tsx, CapabilityReports.tsx, Reports.tsx, DecisionLog.tsx, SecurityDashboard.tsx, Temporal.tsx, Diagnostics.tsx, IntegrationStatus.tsx, McpSettings.tsx, ModelComparison.tsx, KeyVault.tsx, admin.css (+ sub-components where needed — SecurityDashboard's 5 tabs may split into SecurityAlertsTab.tsx etc.; Diagnostics' 5 tabs similarly). Each wave-2 plan owns ~5-6 of these files; all files unique to a single plan.

- **D-191:** **CSS discipline.** Each cluster owns ONE CSS file (`dev-tools.css`, `admin.css`) that all sub-components share. No per-component CSS file unless a route has a genuinely orthogonal design (e.g., `Terminal.css` for the scrollback `<pre>` styling, `SecurityDashboard.css` for the 5-tab danger-zone coloring). Uses Phase 1 tokens via `var(--glass-1-bg)` etc. D-07 blur caps enforced. Uses Phase 5 Plan 05-02 status tokens (`--status-running` etc.) verbatim.

- **D-192:** **`usePrefs` extensions for Phase 7:**
  - `devTools.activeTab` — WorkflowBuilder tab, ComputerUse tab, DocumentGenerator tab
  - `devTools.terminal.cwd` — Terminal current working directory memory
  - `devTools.fileBrowser.expandedPaths` — FileBrowser expanded folder set (stored as string[] joined)
  - `admin.activeTab` — SecurityDashboard / Diagnostics / CapabilityReports tab memory
  - `admin.security.expandedAlert` — last-expanded alert id in SecurityDashboard
  Five new dotted keys. Zero Rust impact (per D-12 all prefs are frontend-only localStorage). Plan 07-01 adds these.

### Claude's Discretion (planner-chosen defaults)

- Exact CSS grid template for Analytics KPI row — planner picks `repeat(auto-fit, minmax(180px, 1fr))`.
- Exact color palette for SecurityDashboard danger-zone — planner picks `rgba(ef4444, 0.08)` background accent + `var(--status-error)` border.
- Whether Terminal auto-scrolls to bottom on new output — planner picks yes (matches every native terminal emulator).
- Whether FileBrowser tree is lazy-loaded per folder click or eager to depth=2 — planner picks depth=2 eager (keeps UI snappy without N+1 invokes; depth=3+ lazy per-click).
- Whether ComputerUse automation actions are Dialog-confirmed by default — planner picks yes for destructive (`launch_app`, `auto_open_path`, `auto_open_url`, `mouse_click`), plain button for benign (`get_mouse_position`, `copy_to_clipboard`).
- Whether SecurityDashboard pentest tab needs a separate password gate — planner picks no (the Dialog confirm + ALL-CAPS warning is sufficient; auth-on-click would be over-engineered for V1).
- Whether ModelComparison shows a latency histogram per provider — planner picks no (no telemetry backend for that; "Test provider" shows single-shot latency; histograms Phase 9 polish).
- Whether WorkflowBuilder "Generate from description" auto-saves or previews — planner picks preview + explicit save (consistent with D-153 / D-154 / D-155 identity-edit discipline).
- Whether Canvas ships any SVG drawing surface — planner picks no (D-175 honest deferral); Canvas is the single honest-deferral route in Phase 7.
- Whether DocumentGenerator shares `doc_search` input with Knowledge cluster — planner picks no (separate copies; cross-reference noted in D-179).
- Whether DecisionLog feedback action requires a note or just a thumbs-up/down — planner picks optional note (richer telemetry without forcing friction).
- Whether Diagnostics sysadmin tab is gated behind a single toggle or per-action Dialogs — planner picks per-action Dialogs (surgical; consistent with D-181 computer-use dangerous-action pattern).
- Whether Reports route surfaces the `capability_gap_detected` event source explicitly — planner picks yes (show "source" column per row since P-03 is the whole reason this route exists).
- Whether KeyVault masks keys completely or shows last-4 — planner picks last-4 (enough to tell them apart without leaking the whole key to a shoulder surfer).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 7: Dev Tools + Admin" — goal, 21 requirements (DEV-01..11 + ADMIN-01..10), success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-165, Phase 1..6 substrate inventory
- `.planning/RECOVERY_LOG.md` — event catalog; emit policy

### Phase 1..6 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — D-64..D-92
- `.planning/phases/04-overlay-windows/04-CONTEXT.md` — D-93..D-117
- `.planning/phases/05-agents-knowledge/05-CONTEXT.md` — D-118..D-138
- `.planning/phases/06-life-os-identity/06-CONTEXT.md` — D-139..D-165 (PHASE 7 MIRRORS THIS FILE'S STRUCTURE)
- `.planning/phases/05-agents-knowledge/05-PATTERNS.md` — §1 wrapper recipe, §2 rAF flush, §5 cluster index rewrite, §7 Playwright recipe, §8 verify script recipe, §10 common CSS
- `.planning/phases/06-life-os-identity/06-PATTERNS.md` — §3 tabbed-surface recipe, §4 edit-with-Dialog, §5 CSV/file-picker recipe
- `.planning/phases/05-agents-knowledge/05-0{1..7}-PLAN.md` — 7-plan template
- `.planning/phases/06-life-os-identity/06-0{1..7}-PLAN.md` — 7-plan template this phase copies verbatim

### Code Phase 7 extends (read-only inputs)

**Frontend (substrate):**
- `src/windows/main/MainShell.tsx`, `src/windows/main/useRouter.ts`
- `src/lib/router.ts` — `RouteDefinition`
- `src/lib/tauri/*.ts` — Phase 1..6 wrappers; Phase 7 adds `dev_tools.ts` + `admin.ts`
- `src/lib/events/index.ts` + `payloads.ts` — 55+ events from Phase 5+6
- `src/lib/context/ConfigContext.tsx` + `ToastContext.tsx`
- `src/features/chat/useChat.tsx` — `ChatProvider` hoisted at MainShell (D-116); Phase 7 routes may read via `useChatCtx`
- `src/design-system/primitives/*` — 9 primitives + ComingSoonSkeleton + Dialog
- `src/hooks/usePrefs.ts` — Phase 7 adds 5 new keys (D-192)
- `src/features/dev/*` — dev isolation harness host (Plan 07-07 adds 4 more routes)

**Feature folders (Phase 1 stubs — Phase 7 replaces):**
- `src/features/dev-tools/index.tsx` (10 stubs — Phase 7 Plan 07-02 rewrites)
- `src/features/admin/index.tsx` (11 stubs including synthetic `reports` — Phase 7 Plan 07-02 rewrites)

### Rust source (authoritative for wrapper cites — NO Rust modifications in Phase 7)
- `src-tauri/src/lib.rs:574-1394` — `generate_handler![]` confirming all 200+ Phase 7 commands registered (see D-167 inventory)
- `src-tauri/src/native_tools.rs` — 3 commands (Terminal)
- `src-tauri/src/files.rs` — 6 commands (FileBrowser)
- `src-tauri/src/file_indexer.rs` — 4 commands (FileBrowser file search)
- `src-tauri/src/indexer.rs` — 5 commands (FileBrowser project indexing)
- `src-tauri/src/git_style.rs` — 3 commands (GitPanel)
- `src-tauri/src/code_sandbox.rs` — 4 commands (Canvas thin wrapper + CodeSandbox)
- `src-tauri/src/workflow_builder.rs` — 8 commands (WorkflowBuilder)
- `src-tauri/src/browser_agent.rs` — 2 commands (WebAutomation)
- `src-tauri/src/browser_native.rs` — 4 commands (WebAutomation auxiliary)
- `src-tauri/src/auto_reply.rs` — 3 commands (EmailAssistant)
- `src-tauri/src/document_intelligence.rs` — 8 commands (DocumentGenerator)
- `src-tauri/src/computer_use.rs` — 3 commands (ComputerUse)
- `src-tauri/src/automation.rs` — 15 commands (ComputerUse)
- `src-tauri/src/ui_automation.rs` — 7 commands (ComputerUse)
- `src-tauri/src/reminders.rs` — 5 commands (EmailAssistant follow-up)
- `src-tauri/src/watcher.rs` — 4 commands (FileBrowser watch)
- `src-tauri/src/cron.rs` — 5 commands (WorkflowBuilder schedule)
- `src-tauri/src/commands.rs` (mcp + provider test + admin helpers) — 12+ commands
- `src-tauri/src/permissions.rs` — 4 commands (McpSettings tool trust)
- `src-tauri/src/db_commands.rs` (analytics subset) — 4 commands (Analytics)
- `src-tauri/src/reports.rs` — 5 commands (Reports)
- `src-tauri/src/self_upgrade.rs` — 8 commands (CapabilityReports + SecurityDashboard pentest)
- `src-tauri/src/evolution.rs` — 6 commands (CapabilityReports)
- `src-tauri/src/immune_system.rs` — 1 command (CapabilityReports gap resolve)
- `src-tauri/src/decision_gate.rs` — 3 commands (DecisionLog)
- `src-tauri/src/authority_engine.rs` — 6 commands (DecisionLog + Diagnostics)
- `src-tauri/src/audit.rs` — 1 command (DecisionLog)
- `src-tauri/src/security_monitor.rs` — 9 commands (SecurityDashboard)
- `src-tauri/src/symbolic.rs` — 4 commands (SecurityDashboard policies)
- `src-tauri/src/temporal_intel.rs` — 4 commands (Temporal; shared with Phase 6 MeetingsView)
- `src-tauri/src/execution_memory.rs` — 3 commands (Temporal)
- `src-tauri/src/deep_scan.rs` — 3 commands (Diagnostics)
- `src-tauri/src/supervisor.rs` — 2 commands (Diagnostics)
- `src-tauri/src/trace.rs` — 1 command (Diagnostics)
- `src-tauri/src/sysadmin.rs` — 8 commands (Diagnostics advanced)
- `src-tauri/src/integration_bridge.rs` — 3 commands (IntegrationStatus)
- `src-tauri/src/config.rs` (provider/routing) — 6 commands (KeyVault + ModelComparison)
- `src-tauri/src/self_critique.rs` — 4 commands (CapabilityReports)
- `src-tauri/src/tool_forge.rs` — 4 commands (CapabilityReports)

### Prototype / design authority (READ-ONLY reference per D-17)
- `src.bak/components/Terminal.tsx, FileBrowser.tsx, GitPanel.tsx, WorkflowBuilder.tsx, CodeSandbox.tsx, ComputerUseView.tsx, Analytics.tsx, SecurityDashboard.tsx, Diagnostics.tsx, McpSettings.tsx` if present — algorithmic / layout reference only (retype, never import)

### Explicitly NOT to read (D-17 applies)
- Any `src.bak/` file for import. Planner + executor MAY consult as READ-ONLY layout ground truth; every line of code is retyped in the new feature folder against the Phase 1 primitives + tokens.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1..6 substrate Phase 7 extends

- `src/features/dev-tools/index.tsx` currently exports 10 `ComingSoonSkeleton` routes (terminal, file-browser, git-panel, canvas, workflow-builder, web-automation, email-assistant, document-generator, code-sandbox, computer-use). Plan 07-02 rewrites this file to import 10 lazy per-route components.
- `src/features/admin/index.tsx` currently exports 11 `ComingSoonSkeleton` routes (analytics, capability-reports, reports, decision-log, security-dashboard, temporal, diagnostics, integration-status, mcp-settings, model-comparison, key-vault). Plan 07-02 rewrites to 11 lazy per-route components. **1 orphan requirement (DEV-11) is flagged for retrospective per DP-3 — or KeyVault treated as synthetic ADMIN-11 orphan per D-185.**
- `src/lib/tauri/` currently has 13 wrapper files (9 Phase 1..4 + 2 Phase 5 + 2 Phase 6). Plan 07-02 adds 2 new files (`dev_tools.ts`, `admin.ts`). ESLint `no-raw-tauri` rule applies to both.
- `src/lib/events/index.ts` currently declares 55+ event constants from Phase 5+6. Plan 07-01 adds 0-6 new constants depending on emit audit (D-189 candidates).

### Patterns already established that Phase 7 MUST follow

- **Wrapper recipe:** inherits Phase 5 §1 + Phase 6 §1 verbatim.
- **Event subscription:** `useTauriEvent<PayloadType>(BLADE_EVENTS.NAME, handler)`. Handler-in-ref; subscription keyed on `[name]` only.
- **Pref writes:** `setPref('dotted.key', value)` — debounced 250ms, single localStorage blob.
- **Style:** compose `.glass .glass-1/2/3` + primitive classes; Tailwind utilities for layout only. No hardcoded hex colors.
- **Routes:** append a `RouteDefinition` to the feature index's `routes` array. Phase 7 edits `src/features/dev-tools/index.tsx` + `src/features/admin/index.tsx` ONCE each (in Plan 07-02) to replace skeletons with lazy imports.
- **rAF flush:** Reserved for high-frequency streaming surfaces. Phase 7 may use it for Terminal stdout streaming + WebAutomation live trace if `browser_agent_event` emits — otherwise polling is fine.
- **D-116 ChatProvider hoisting:** `useChat`/`ChatProvider` lives in MainShell ONLY — downstream routes read via `useChatCtx`. Do NOT re-provide.
- **Tabbed-surface recipe (Phase 6 §3):** pill tabs + `usePrefs` persistence + `role="tablist"` + `aria-selected`. Phase 7 WorkflowBuilder / SecurityDashboard / Diagnostics / ComputerUse / DocumentGenerator / Temporal all use this recipe.
- **Edit-with-Dialog recipe (Phase 6 §4):** identity-data-style explicit confirmation. Phase 7 uses this for ALL destructive operations (sysadmin, pentest, reset-onboarding, workflow-delete, integration-toggle-off, mcp-remove-server).
- **CSV / file-picker recipe (Phase 6 §5):** Tauri `@tauri-apps/plugin-dialog` for file picks (`doc_ingest`, `files::file_read` browse, `workflow_import` if exists).

### Test harness

- `playwright.config.ts` + `tests/e2e/*.spec.ts` already shipped in Plans 01-09, 02-07, 03-07, 04-07, 05-07, 06-07. Phase 7 Plan 07-07 adds 4 new specs reusing the same harness. `npm run test:e2e` runs them. No new test deps.
- `verify:all` scripts live in `scripts/`. Phase 7 Plan 07-07 adds `scripts/verify-phase7-rust-surface.sh` and extends `scripts/verify-feature-cluster-routes.sh` to include the new 10+11 routes.

### Rust patterns Phase 7 does NOT extend

Phase 7 touches **zero Rust files** (D-167 / zero-Rust invariant inherited from Phase 5 D-119 + Phase 6 D-140). The Rust surface is frozen — every command used by Phase 7 is already registered in `lib.rs:574-1394`. If a gap is discovered during planning or execution, the plan MUST document the gap in SUMMARY + defer the affected route to a ComingSoonSkeleton rather than ship a hand-rolled/mocked Rust command.

### Dev experience patterns Phase 7 leans on

- All dev-only routes stay palette-hidden + gated on `import.meta.env.DEV`. Plan 07-07 adds 4 dev-only isolation harnesses (TerminalDev, WorkflowBuilderDev, SecurityDashboardDev, McpSettingsDev).
- All CI verification scripts live in `scripts/` as Node ESM (`.mjs`) or bash (`.sh`); runnable via `npm run verify:<check>`.
- ESLint `no-raw-tauri` rule continues to apply.
- `__TAURI_EMIT__` + `__TAURI_INVOKE_HOOK__` test-harness hooks (Phase 1..6) extended for Phase 7 Playwright specs.

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 7 success criteria (must be falsifiable):**
- SC-1: Any Dev Tools route renders without 404; Terminal routes bash through `native_tools.rs` and returns output (Plan 07-03 Terminal spec falsifies; `native_tools::run_shell` wired)
- SC-2: WebAutomation accepts a goal, calls `browser_agent_*` commands, and displays live screen feedback (Plan 07-04 WebAutomation spec falsifies; `browser_agent::browser_agent_loop` wired)
- SC-3: Any Admin route renders; DecisionLog reads decision-gate history from `decision_gate_*` commands (Plan 07-05 DecisionLog spec falsifies; `decision_gate::get_decision_log` wired)
- SC-4: SecurityDashboard surfaces active alerts from `security_monitor.rs`; Diagnostics shows module health for all running background tasks (Plan 07-05 SecurityDashboard spec + Plan 07-06 Diagnostics spec falsifies; `security_monitor::security_overview` + `supervisor::supervisor_get_health` wired)
- SC-5: Both clusters registered via feature `index.ts` exports; no App.tsx edit was required (trivially verified — App.tsx doesn't exist in V1; Phase 7 only edits feature index files — NEVER router.ts)

**From Rust reality (D-167 inventory):**
- Dev Tools cluster has ~90 registered commands spanning 17 modules.
- Admin cluster has ~110 registered commands spanning 20 modules.
- **NONE of them need new handlers** — all already wired.
- Return types vary widely — each wrapper hand-types its return interface mirroring Rust `#[derive(Serialize)]` shape.

**Migration ledger alignment:**
- 10 dev-tools routes already in ledger with `phase: 7` + `status: Pending`. Plan 07-07 verify script flips them to `Shipped`.
- 11 admin routes same (includes synthetic `reports`). No route added or removed in Phase 7 — the stubs are canonical (per D-28 + Phase 5/6 DP-3 precedent).

**Palette + nav derivation (D-40 + D-55):**
- NavRail already shows "Dev" + "Admin" cluster icons derived from `section`; clicking navigates to first route of each cluster (first = `terminal` / `analytics` by index order). Plan 07-02's index.tsx rewrite preserves order so the cluster navigation doesn't shift.

</specifics>

<deferred>
## Deferred Ideas

- **11th Dev Tools route (DEV-11).** Current Phase 1 stubs shipped 10 (not 11). Phase 7 closes 10 and flags 1 orphan requirement ID in Plan 07-07 SUMMARY + Phase 7 retrospective. Closing requires a scope decision (add new route or retire requirement) outside Phase 7's authority. This is the DIRECT analog of Phase 5 DP-3 (shipped 9+9 instead of 10+10) + Phase 6 DP-3 (9+7 instead of 10+9).
- **KeyVault-as-ADMIN-11 orphan (D-185).** KeyVault ships with real wiring but is labelled orphan because ROADMAP says ADMIN-01..10 (10 reqs) while Phase 1 shipped 11 routes. Planner picks KeyVault-as-orphan over ModelComparison-as-orphan per D-185 rationale. Retrospective may re-home.
- **Canvas full drawing surface (D-175).** Canvas ships thin wrapper around `code_sandbox::sandbox_run` + honest deferral card for a real drawing/whiteboard surface. Phase 9 polish could add SVG-based drawing if needed.
- **GitPanel diff viewer / commit history / PR surface (D-174).** Backend exposes only `git_style::*` (3 commands — style miner); actual git operations are not registered `#[tauri::command]`. Phase 9 polish could add if a git-ops Rust module is authored.
- **Terminal PTY emulator.** Current Terminal is line-oriented via `run_shell`. Phase 9 polish could add a real PTY (xterm.js) if operator needs it.
- **FileBrowser file upload / drag-drop.** D-173 uses `file_read` / `file_write` via explicit buttons. Drag-drop deferred to Phase 9.
- **WorkflowBuilder node-editor visual canvas.** D-176 uses a sidebar + form. Visual DAG node editor (React Flow) deferred to Phase 9 polish.
- **WebAutomation recording/playback of user actions.** D-177 uses text goal → agent loop. Record-and-replay UI deferred.
- **EmailAssistant inline email send.** D-178 generates drafts only; no SMTP/IMAP send. Hive email tentacle (future phase) would cover sending.
- **DocumentGenerator LaTeX / Markdown export.** D-179 generates in plain text. Typed export formats deferred.
- **CodeSandbox Monaco editor.** D-180 uses plain `<textarea>` (mono font). Monaco is a heavy dep; deferred.
- **ComputerUse task recording.** D-181 spawns single tasks. Recording a sequence + replay deferred.
- **Analytics time-series chart.** D-182 uses text-first KPI cards + event feed. SVG sparkline deferred to Phase 9 polish.
- **SecurityDashboard real-time alert websocket.** D-183 polls / refetches on action. Live WS connection deferred.
- **Diagnostics log tailer.** D-184 shows recent traces via `trace::get_recent_traces`. Live tail deferred to Phase 9.
- **ModelComparison latency histogram.** D-185 shows single-shot `test_provider` latency. Aggregate histogram deferred.
- **KeyVault HSM / biometric unlock.** D-185 uses OS keyring via existing `store_provider_key`. Hardware unlock deferred.
- **McpSettings catalog UI.** D-185 uses `mcp_install_catalog_server({ catalog_id })` — catalog browsing UI deferred to Phase 9.
- **Mobile-friendly responsive layouts.** Same policy as Phase 5+6 — desktop-first; Phase 9 polish addresses responsive edge cases.
- **Comprehensive per-route Playwright coverage.** Plan 07-07 ships 4 representative specs (1 per big surface per SC). Exhaustive per-route coverage deferred to Phase 9 polish.

</deferred>

<mac_session_items>
## Mac-Session Verification Items (Operator Handoff — extends Phase 1..6 list)

These checks cannot be verified in the sandbox. Carry forward to the final operator checkpoint run (bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3..6 Mac-smoke per STATE.md strategy). Plan 07-07 Task 3 adds M-28..M-34.

- **M-28:** `npm run tauri dev` launches; navigate to /terminal — Terminal renders without 404 (SC-1). Run `ls ~/` → output appears in scrollback; `$ ls ~/` header row present; no Rust panic.
- **M-29:** Navigate to /file-browser — tree renders for $HOME; click a file, preview appears; "Search" returns results from file_indexer (if index has run); "Re-index" triggers `file_index_scan_now` successfully.
- **M-30:** Navigate to /workflow-builder — list renders (may be empty on fresh install); "Generate from description" Dialog opens; submit creates a workflow (`workflow_create`); "Run now" triggers it.
- **M-31:** Navigate to /web-automation — paste goal "go to news.ycombinator.com and describe the first story"; "Run" invokes `browser_agent_loop`; live trace populates; screenshot appears if browser session active.
- **M-32:** Navigate to /security-dashboard — hero card shows `security_overview` status; click "Run network scan" → `security_scan_network` returns results; Policies tab lists symbolic policies; Pentest tab shows ALL-CAPS warning + Dialog-gated actions (SC-4).
- **M-33:** Navigate to /diagnostics — supervisor health card shows all running background loops (cron, health-scanner, integration-bridge, etc.); trace panel shows recent traces; sysadmin tab actions gated behind Dialog confirm (SC-4 "module health for all running background tasks" verified).
- **M-34:** Navigate to /decision-log, /mcp-settings, /integration-status, /analytics, /capability-reports, /reports, /temporal, /model-comparison, /key-vault — each renders without 404; each has live data or honest empty-state. Run `cd src-tauri && cargo check` — still 0 errors. (D-65 inheritance — Phase 7 touches no Rust, but cargo check catches any transitive break.)

</mac_session_items>

---

*Phase: 07-dev-tools-admin*
*Context gathered: 2026-04-18 via /gsd-plan-phase 7 --auto (no interactive discuss; defaults logged in 07-DISCUSSION-LOG.md)*
