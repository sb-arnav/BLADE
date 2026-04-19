# Phase 7 — Discussion Log (AUTO MODE — no interactive session)

**Invocation:** `/gsd-plan-phase 7 --auto`
**Date:** 2026-04-18
**Mode:** Planner picks defensible defaults to maintain phase velocity. All defaults are logged here, and every new decision also lands in `07-CONTEXT.md` as `D-166..D-192`.

Prior locked decisions `D-01..D-165` (Phase 1–6 CONTEXT files) are treated as non-negotiable constraints. This log captures only the NEW choices the planner made for Phase 7.

---

## Source inputs consulted

- `.planning/ROADMAP.md` Phase 7 §Requirements (DEV-01..11 + ADMIN-01..10) + §Success Criteria 1–5
- `.planning/STATE.md` — Phase 1..6 substrate inventory
- `.planning/phases/06-life-os-identity/06-CONTEXT.md` — **template mirrored verbatim**. D-139..D-165 locked; Phase 7 D-166..D-192 continue numbering.
- `.planning/phases/06-life-os-identity/06-PATTERNS.md` — §1 wrapper recipe, §2 cluster index rewrite, §3 tabbed-surface, §4 edit-with-Dialog, §5 file-picker recipe, §8 Playwright, §9 verify script. Phase 7 reuses all verbatim.
- `.planning/phases/05-agents-knowledge/05-PATTERNS.md` — §1 wrapper recipe, §2 rAF flush, §5 index rewrite, §7 Playwright, §8 verify script, §10 common CSS. Phase 7 reuses all verbatim.
- `.planning/phases/05-agents-knowledge/05-0{1..7}-PLAN.md` + `.planning/phases/06-life-os-identity/06-0{1..7}-PLAN.md` — 7-plan template
- `.planning/phases/01..04/*-CONTEXT.md` — locked D-01..D-117
- `src/features/dev-tools/index.tsx` — 10 stubs (matches DEV-01..10; no 11th)
- `src/features/admin/index.tsx` — 11 stubs (10 ADMIN-01..10 + synthetic `reports` for P-03)
- `src/lib/events/index.ts` + `payloads.ts` — 55+ events from Phase 5+6
- `src/lib/tauri/*.ts` — 13 existing wrapper files
- `src-tauri/src/lib.rs:574-1394` — 200+ dev-tools + admin command registrations in `generate_handler![]`
- `src-tauri/src/{native_tools,files,file_indexer,indexer,git_style,code_sandbox,workflow_builder,browser_agent,browser_native,auto_reply,document_intelligence,computer_use,automation,ui_automation,reminders,watcher,cron,commands,permissions,db_commands,reports,self_upgrade,evolution,immune_system,decision_gate,authority_engine,audit,security_monitor,symbolic,temporal_intel,execution_memory,deep_scan,supervisor,trace,sysadmin,integration_bridge,config,self_critique,tool_forge}.rs` — module sources for wrapper cites
- `src.bak/components/*.tsx` matching dev-tools + admin names — READ-ONLY per D-17

---

## Decision points + planner choices

### DP-1: How many plans + what wave structure?

**Options considered:**
- (a) 1 monolithic plan per cluster (2 plans). Rejected — exceeds 3-task per-plan discipline; 10+11 routes = >>3 tasks each.
- (b) 1 plan per route (21 plans). Rejected — over-fragmentation; wrapper + route are coupled.
- (c) 7 plans: 1 event-registry/prefs + 1 wrappers + 4 UI (dev-tools A/B + admin A/B) + 1 Playwright/verify (CHOSEN — mirrors Phase 5 + Phase 6 exactly).
- (d) 6 plans (merge event-registry/prefs into wrappers). Rejected — even when event additions are small, the Prefs extension + the wrappers still benefit from separate plans (wrappers are large; Prefs is trivial; separate plans prevent Plan 07-02 bloat).

**Choice:** 7 plans across 4 waves (D-169). Same topology as Phase 5 + 6.

---

### DP-2: Rust plan — yes or no?

**Options:**
- (a) Dedicate Plan 07-00 to Rust for any missing lifecycle emits (workflow_run_started, browser_agent_event, integration_status_changed, security_alert, decision_gate_event). Rejected — audit shows Dev Tools + Admin modules are overwhelmingly request-response; each candidate emit has a polling fallback, so no lifecycle event gap BLOCKS a consumer.
- (b) Leave Rust alone, add a DEFENSIVE verify script (CHOSEN). Plan 07-07 ships `scripts/verify-phase7-rust-surface.sh` that greps `lib.rs` for all 200+ Phase 7 commands in the D-167 inventory and fails if any is missing. Plus `cargo check` stays as the Mac-operator check (M-34).

**Choice:** No Rust plan (D-171 / zero-Rust invariant inherits Phase 5 D-123 + Phase 6 D-144). One verify script in Plan 07-07.

**Trade-off accepted:** If a Phase 7 UI plan discovers a genuinely-missing Rust command mid-execution, it gets `ComingSoonSkeleton phase={9}` + SUMMARY-noted gap. This mirrors Phase 5 D-119 + Phase 6 D-140 + Phase 4 D-99.

---

### DP-3: Honour ROADMAP 11+10 vs ship 10+11?

The ROADMAP lists DEV-01..11 + ADMIN-01..10 (21 total). The current `src/features/dev-tools/index.tsx` has 10 stubs; `src/features/admin/index.tsx` has 11 stubs (10 ADMIN requirements + 1 synthetic `reports` route added by Phase 1 for P-03 `capability_gap_detected → openRoute('reports')` coverage). Options:

- (a) Add an 11th dev-tools route to match ROADMAP (1 new route). Rejected — the extra route has no source justification (Phase 1 team chose 10 when allocating routes). Adding routes = scope expansion without source artifact backing. Per D-17, src.bak isn't canonical.
- (b) Remove one admin route to align with ADMIN-01..10 exactly. Rejected — the synthetic `reports` route serves a real P-03 contract (backend emits capability_gap_detected → openRoute('reports') → user sees reports surface). Removing it breaks P-03.
- (c) Ship 10+11 (the shipped stubs) + surface 1 orphan in Plan 07-07 SUMMARY (CHOSEN). Exact mirror of Phase 5 DP-3 — Phase 5 shipped 9+9 instead of 10+10 — and Phase 6 DP-3 — Phase 6 shipped 9+7 instead of 10+9.

**Choice:** 10+11 route coverage. Orphan requirement ID `DEV-11` flagged in Plan 07-07 SUMMARY for decision outside Phase 7. KeyVault carries a secondary "synthetic ADMIN-11" tag (D-185) because ROADMAP has only ADMIN-01..10; this is documented as a second orphan consideration but NOT a removed route.

**Trade-off accepted:** Phase 7 closes 20/21 ROADMAP Phase 7 requirements (DEV-01..10 + ADMIN-01..10 all mapped; DEV-11 orphan). This is an honest ledger; closing with a fake 11th stub would violate D-167 (no Rust) + D-168 (only ship what the source supports).

---

### DP-4: Where do `code_sandbox::*` commands live?

Two plausible homes: DEV-04 Canvas (placeholder-to-real) and DEV-09 CodeSandbox (obvious). Options:

- (a) Dedicate CodeSandbox to the 4 code_sandbox commands + leave Canvas as pure ComingSoonSkeleton. Rejected — Canvas would 404-look (violates D-168).
- (b) Dedicate CodeSandbox to the 4 commands + use 1 shared command (`sandbox_run` + `sandbox_detect_language`) in Canvas as a "thin surface + honest deferral" (CHOSEN per D-175). Rationale: CodeSandbox remains the primary home; Canvas's "Run code" widget is a thin reuse that satisfies D-168 real-surface policy while honestly deferring the canvas-drawing intent.

**Choice:** CodeSandbox primary; Canvas thin-reuse + honest deferral.

---

### DP-5: Where do `reminders::*` commands live?

Reminders have 5 commands (add, add_natural, list, delete, parse_time). No dedicated Phase 7 route in the shipped stubs. Options:

- (a) Add a dedicated Reminders route. Rejected — scope expansion (DP-3 discipline).
- (b) Fold into EmailAssistant as "follow-up reminder" integration (CHOSEN per D-178). Rationale: natural-language reminder integration matches real email-followup workflow; reminders has no other Phase 7 home.
- (c) Defer all reminders commands to Phase 9 polish. Rejected — waste of registered commands.

**Choice:** D-178. Reminders surface as EmailAssistant sub-section.

---

### DP-6: Where do `temporal_intel::*` commands live?

temporal_intel has 4 commands. D-148 (Phase 6) already wired `temporal_meeting_prep` to MeetingsView. Options:

- (a) Keep all 4 temporal commands in MeetingsView (Phase 6). Rejected — 3 of the 4 (`temporal_what_was_i_doing`, `temporal_daily_standup`, `temporal_detect_patterns`) have no meeting semantic; they're general temporal intelligence.
- (b) Split: MeetingsView uses `temporal_meeting_prep` only; Temporal route (ADMIN-06) wires the other 3 + re-uses `temporal_meeting_prep` with a "meeting id" input for debugging (CHOSEN per D-184). Rationale: shared read is allowed (D-148 notes this explicitly); neither route mutates.

**Choice:** D-184 — shared read across two routes.

---

### DP-7: Diagnostics sysadmin tab — include or defer?

sysadmin module has 8 commands, several dangerous (sudo_exec, dry_run_command, rollback). Options:

- (a) Ship all 8 in Diagnostics. Rejected if ungated — too dangerous for admin surface defaults.
- (b) Ship with per-action Dialog confirm + ALL-CAPS warning (CHOSEN per D-184 + D-181 pattern). Rationale: commands exist in Rust; exposing them via gated UI is honest; hiding them wastes registered commands.
- (c) Defer sysadmin entirely to Phase 9. Rejected — no plan to re-home.

**Choice:** D-184 with per-action Dialog confirm.

---

### DP-8: SecurityDashboard pentest tab — include or defer?

pentest commands (5 via self_upgrade::pentest_*) are authorization-gated in Rust already. Options:

- (a) Don't expose pentest at all. Rejected — existing Rust capability.
- (b) Expose in SecurityDashboard with ALL-CAPS warning banner + Dialog confirm + current-auth-state display (CHOSEN per D-183).
- (c) Build a separate hidden pentest route. Rejected — admin_reporter-style complexity.

**Choice:** D-183. Pentest tab in SecurityDashboard with full gating.

---

### DP-9: Event subscriptions — how many?

Phase 7 audit candidates (D-189): workflow_run_*, integration_status_changed, security_alert, browser_agent_event, decision_gate_event, capability_gap_detected.

Options:
- (a) Subscribe to all 6 opportunistically. Rejected — over-subscribes for little gain.
- (b) Audit Rust emit sites in Plan 07-01; subscribe only where a consumer has a committed benefit (CHOSEN per D-189).
- (c) Zero event additions; pure polling. Rejected — browser_agent_event if it fires during the loop is genuinely useful for SC-2 "live screen feedback".

**Choice:** D-189 — audit-driven, opportunistic. Plan 07-01 decides per-emit.

---

### DP-10: Where do `authority_engine::*` commands live?

authority_engine has 6 commands (get_agents, get_audit_log, get_delegations, delegate, route_and_run, run_chain). Options:

- (a) Fold into DecisionLog as "authority audit" tab (CHOSEN for audit log reads per D-182). `authority_get_audit_log` + `authority_get_delegations` + `audit_get_log` in DecisionLog.
- (b) Fold into Diagnostics as "authority" tab for `authority_get_agents` read (CHOSEN per D-184).
- (c) Split: reads in Diagnostics, writes/executes (delegate, route_and_run, run_chain) behind Dialog confirm on the agent detail page. CHOSEN for writes — `authority_delegate` / `authority_route_and_run` / `authority_run_chain` are exposed via Diagnostics authority tab with Dialog confirm (high-stakes).

**Choice:** Split D-182 (reads in DecisionLog) + D-184 (reads + gated writes in Diagnostics). Shared reads across two routes, writes centralised in Diagnostics.

---

### DP-11: KeyVault — ADMIN-10 or orphan?

ROADMAP says ADMIN-01..10 (10 requirements). Phase 1 shipped 11 admin routes. Options:

- (a) KeyVault = ADMIN-10 "key management"; ModelComparison = orphan. Rejected — ModelComparison IS the obvious "model-comparison" requirement (ADMIN-10 natural fit).
- (b) ModelComparison = ADMIN-10; KeyVault = synthetic ADMIN-11 orphan (CHOSEN per D-185). Rationale: ModelComparison maps directly to "compare models/providers" which is an explicit observability concern; KeyVault is secrets management (tangentially admin but outside the ROADMAP SC scope).
- (c) Drop KeyVault entirely. Rejected — Phase 1 shipped the stub; dropping = scope regression.

**Choice:** KeyVault as orphan. Phase 7 retrospective may re-home or ratify.

---

### DP-12: Terminal — PTY or line-oriented?

Options:
- (a) Ship xterm.js PTY. Rejected — heavy dep + new Rust PTY backend.
- (b) Line-oriented scrollback via `native_tools::run_shell` (CHOSEN per D-172). Matches registered commands; no new deps.

**Choice:** Line-oriented. Full PTY deferred to Phase 9.

---

### DP-13: GitPanel — diff viewer or style miner?

Backend registers `git_style::*` (3 commands — style miner only). Options:
- (a) Invent a git-ops Rust module. Rejected per D-167 (no new Rust).
- (b) Ship style miner + honest "diff viewer ships in Phase 9" card (CHOSEN per D-174).

**Choice:** D-174.

---

### DP-14: WebAutomation — live trace streaming?

`browser_agent::browser_agent_loop` may OR may not emit intermediate step events. Audit in Plan 07-01.

Options:
- (a) Assume streaming; build a rAF-flush subscription (Phase 5 pattern). Risky if emits don't exist.
- (b) Assume synchronous return; render step-by-step from the response payload (CHOSEN as safe default per D-177). If audit finds streaming, add the subscription opportunistically.

**Choice:** Safe default + opportunistic streaming upgrade if emit found.

---

## Source audit summary

- **GOAL:** Each surface routable; live + real data flows; Terminal output + WebAutomation goal input + SecurityDashboard alerts + Diagnostics module health observable. Addressed by D-166..D-192 + Plan 07-01..07-07.
- **REQ:** DEV-01..10 + ADMIN-01..10 mapped to plans. 1 orphan (DEV-11) flagged + 1 synthetic route (admin/reports) retained for P-03. KeyVault labelled synthetic ADMIN-11 for retrospective (DP-11).
- **RESEARCH:** No Phase 7 research artifact. ROADMAP + prior-phase CONTEXT files are the research surface.
- **CONTEXT:** Phase 1..6 CONTEXT files' D-01..D-165 respected verbatim. No D-XX conflicts found.

Every item either mapped to a plan, explicitly deferred (see `07-CONTEXT.md <deferred>`), or flagged as orphan for phase-close retrospective. No silent omissions.

---

## Orphan Requirements flagged

- **DEV-11** — no 11th dev-tools route in Phase 1 substrate; source (`src/features/dev-tools/index.tsx`) has 10. Decision pending outside Phase 7.
- **KeyVault → ADMIN-11 (synthetic)** — ROADMAP has ADMIN-01..10 only; Phase 1 substrate shipped 11 admin routes. Phase 7 ships KeyVault real, flags it as a synthetic orphan for retrospective per D-185.

These are captured in Plan 07-07's SUMMARY template + must be raised at phase-close retrospective.

---

## Plan count final tally

- **Plan 07-01** — wave 1, TS pure (event registry audit + Prefs extension; 5 new dotted keys). Autonomous.
- **Plan 07-02** — wave 1, TS pure (2 wrapper files + 2 index.tsx rewrites + 21 per-route placeholders + 2 CSS files + types barrels). Autonomous.
- **Plan 07-03** — wave 2, Dev Tools rich subset A (5 routes: Terminal, FileBrowser, GitPanel, Canvas, WorkflowBuilder). Autonomous.
- **Plan 07-04** — wave 2, Dev Tools rich subset B (5 routes: WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, ComputerUse). Autonomous.
- **Plan 07-05** — wave 2, Admin rich subset A (5 routes: Analytics, CapabilityReports, Reports, DecisionLog, SecurityDashboard). Autonomous.
- **Plan 07-06** — wave 2, Admin rich subset B (6 routes: Temporal, Diagnostics, IntegrationStatus, McpSettings, ModelComparison, KeyVault). Autonomous.
- **Plan 07-07** — wave 3, Playwright specs + verify scripts + Mac operator smoke (M-28..M-34). **Non-autonomous** (operator checkpoint).

**Total:** 7 plans × 4 waves. ~50% context per plan target maintained.

**Route split across 07-03/07-04:** 5 + 5 (Dev Tools has 10 routes, even split).
**Route split across 07-05/07-06:** 5 + 6 (Admin has 11 routes — synthetic `reports` folded into 07-05 subset A because it's SC-3 adjacent per P-03).
