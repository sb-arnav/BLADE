---
phase: 07-dev-tools-admin
plan: 07
subsystem: phase-closure-specs-and-regression-guards
tags: [playwright, dev-isolation, regression-guards, phase-7-closure, sc-1, sc-4, partial-summary]
dependency_graph:
  requires:
    - Phase 7 Plan 07-03 (Terminal + WorkflowBuilder real surfaces + testids)
    - Phase 7 Plan 07-04 (WebAutomation + 4 more real surfaces)
    - Phase 7 Plan 07-05 (SecurityDashboard + DecisionLog + 3 more real surfaces)
    - Phase 7 Plan 07-06 (McpSettings + 5 more real admin surfaces)
    - Phase 6 Plan 06-07 (dev-route passthrough pattern + addInitScript shim recipe)
    - Phase 1 Plan 01-09 (Playwright harness + __TAURI_INTERNALS__ shim approach)
  provides:
    - "4 Playwright specs (SC-1, DEV-05, SC-4, ADMIN-09 falsifiers)"
    - "4 dev-only isolation routes (palette-hidden, DEV-gated, passthrough)"
    - "scripts/verify-phase7-rust-surface.sh — 192 Phase 7 Rust commands regression-guarded"
    - "scripts/verify-feature-cluster-routes.sh — EXTENDED to cover 10+11 Phase 7 per-route files (55 total)"
    - "package.json verify:all — composed with verify:phase7-rust; 13/13 gates green"
  affects:
    - ROADMAP Phase 7 SC-1 + SC-4 automated falsification
    - Phase 7 retrospective entries for DEV-11 + synthetic ADMIN-11 orphan requirements (DP-3, DP-11)
    - Operator Mac-session bundle — M-28..M-34 queued alongside Phase 1..6 checkpoints
tech_stack:
  added: []
  patterns:
    - "Dev route = thin passthrough (import real component, render it) — Phase 4/5/6 pattern honored exactly (Rule 1 vs plan's prescribed __TAURI_INVOKE_HOOK__ approach, which has never existed in the codebase)"
    - "Playwright shim installs __TAURI_INTERNALS__ + __BLADE_TEST_EMIT__ via addInitScript — boots app, emits blade_route_request to mount dev route"
    - "verify script enumerates commands per Rust module; fails with clear missing-list message"
    - "Feature-cluster-routes extended by appending Phase 7 block before final echo; Phase 5 + 6 blocks preserved verbatim"
key_files:
  created:
    - src/features/dev/TerminalDev.tsx (22 lines)
    - src/features/dev/WorkflowBuilderDev.tsx (23 lines)
    - src/features/dev/SecurityDashboardDev.tsx (23 lines)
    - src/features/dev/McpSettingsDev.tsx (22 lines)
    - tests/e2e/dev-tools-terminal.spec.ts (135 lines)
    - tests/e2e/dev-tools-workflow-builder.spec.ts (189 lines)
    - tests/e2e/admin-security-dashboard.spec.ts (219 lines)
    - tests/e2e/admin-mcp-settings.spec.ts (208 lines)
    - scripts/verify-phase7-rust-surface.sh (executable, 368 lines, 192 commands)
    - .planning/phases/07-dev-tools-admin/07-07-SUMMARY.md (this file — partial)
  modified:
    - src/features/dev/index.tsx (+55 lines — 4 lazy imports + 4 route entries + Phase 7 header block)
    - scripts/verify-feature-cluster-routes.sh (+75 lines — 10 dev-tools + 11 admin existence checks; Phase 5/6 blocks preserved)
    - package.json (+2 lines — verify:phase7-rust script + verify:all chain extension)
decisions:
  - "Dev route pattern follows the established Phase 4/5/6 passthrough recipe — the plan prescribed a __TAURI_INVOKE_HOOK__ pattern that does NOT exist anywhere in the codebase (grep 0 matches). Playwright shim via addInitScript + __TAURI_INTERNALS__.invoke is the working pattern inherited from Phase 1 Plan 01-09 and extended in 04-07 / 05-07 / 06-07. Rule 1 auto-fix: the shipped recipe matches reality. Spec files carry the mocks, not the dev components."
  - "Dev routes mount via __BLADE_TEST_EMIT__('blade_route_request', { route_id }) — same navigation approach used by all Phase 6 specs (life-os-health-view, life-os-finance-view, identity-persona-view, identity-character-bible). Consistency with existing harness > plan's prescribed `page.goto('/#/dev-terminal')` hash-URL navigation (which is not how the app's router works — main window uses event-driven route changes, not hash routing)."
  - "Partial summary — automated work complete, Mac-session checkpoint (Task 3) is the remaining gate. npm run test:e2e cannot run here because Phase 7 specs require a live Vite dev server on port 1420 (same constraint as Phase 1..6 Mac-smoke bundle per STATE.md). Specs are authored to pass under the standard Playwright harness; empirical pass is deferred to the Mac-session operator smoke."
  - "verify-phase7-rust-surface.sh ships with 192 commands (plan frontmatter said 200+; exact count depends on how you enumerate browser_native / integration_bridge / commands subsets). 192 matches the Plan 07-02 SUMMARY wrapper count exactly (89 dev_tools + 103 admin). Echo message reflects the real count."
  - "verify-feature-cluster-routes.sh extended (not replaced) — Phase 5 + 6 checks preserved verbatim, Phase 7 block appended before the final echo, and the ComingSoonSkeleton guard loop widened to include the 2 new cluster indexes. No Phase 5/6 check regressed."
metrics:
  completed_at: "2026-04-18T00:00:00Z"
  duration_minutes: ~25
  tasks_completed_automated: 2
  tasks_remaining: 1  # Mac-session operator checkpoint (M-28..M-34)
  files_created: 10
  files_modified: 3
  commits: 2
  lines_added: ~1380
  verify_steps_green: 13
---

# Phase 7 Plan 07-07: Phase Closure Specs + Regression Guards Summary (Partial)

Closes the automated half of Phase 7 with 4 Playwright specs (one per critical SC falsifier), 1 new verify script (Phase 7 Rust surface regression guard), 1 extended verify script (cluster-routes now covers Phase 5 + 6 + 7), and 4 dev-only isolation routes following the Phase 4/5/6 passthrough recipe. Mac-session operator smoke (Task 3 / M-28..M-34) queued into the existing Phase 1..6 handoff bundle.

## Automated Deliverables Shipped

### 4 Playwright specs (one per critical SC falsifier)

| Spec file | Falsifies | What it asserts |
| --------- | --------- | --------------- |
| `tests/e2e/dev-tools-terminal.spec.ts` | **SC-1** (Terminal routes bash through `native_tools.rs`) | terminal-root mounts → input submit pushes terminal-line-cmd + scrollback contains mocked `run_shell` stdout text ("mock-output"). |
| `tests/e2e/dev-tools-workflow-builder.spec.ts` | **DEV-05** (WorkflowBuilder list + detail + tabs) | workflow-builder-root mounts → ≥1 workflow-sidebar-row from mocked `workflow_list` → clicking opens workflow-detail-root → exactly 3 workflow-tab entries (Steps / Runs / Schedule). |
| `tests/e2e/admin-security-dashboard.spec.ts` | **SC-4** (SecurityDashboard surfaces active alerts) | security-dashboard-root mounts → security-hero visible (backed by mocked `security_overview`) → exactly 4 security-tab entries → clicking Pentest tab reveals security-pentest-warning with ILLEGAL/AUTHORIZE language. |
| `tests/e2e/admin-mcp-settings.spec.ts` | **ADMIN-09** (McpSettings CRUD + tool trust) | mcp-settings-root mounts → ≥1 mcp-server-row from mocked `mcp_get_servers` → mcp-add-server-button visible → mcp-tool-trust-select present. |

All 4 specs follow the Phase 6 shim pattern exactly (life-os-health-view.spec.ts reference): `addInitScript` installs `__TAURI_INTERNALS__.invoke` stub + `__BLADE_TEST_EMIT__` hook, route mount via `blade_route_request` event, 5000ms `waitForSelector` timeouts, `expect.poll` for async data arrivals. No new test deps.

### 4 Dev-only Isolation Routes (palette-hidden, DEV-gated)

| File | Wraps | Route id |
| ---- | ----- | -------- |
| `src/features/dev/TerminalDev.tsx` | `<Terminal/>` (Plan 07-03) | `dev-terminal` |
| `src/features/dev/WorkflowBuilderDev.tsx` | `<WorkflowBuilder/>` (Plan 07-03) | `dev-workflow-builder` |
| `src/features/dev/SecurityDashboardDev.tsx` | `<SecurityDashboard/>` (Plan 07-05) | `dev-security-dashboard` |
| `src/features/dev/McpSettingsDev.tsx` | `<McpSettings/>` (Plan 07-06) | `dev-mcp-settings` |

All 4 are thin passthrough wrappers (no component-side mocking — test shim owns all mocks). Added to `src/features/dev/index.tsx` routes array with `phase: 7`, `paletteHidden: true`, `section: 'dev'`. Aggregator at `src/windows/main/router.ts:59` already spreads `devRoutes` only when `import.meta.env.DEV` is true — prod builds tree-shake them via Vite constant folding (D-21 + D-34 preserved).

### 1 New Verify Script — `scripts/verify-phase7-rust-surface.sh`

Enumerates **192 Phase 7 Rust commands** across 32 modules (89 dev-tools + 103 admin per Plan 07-02 SUMMARY wrapper counts). Fails fast with a bullet list of missing commands if any `mod::cmd` is dropped from `generate_handler![]` in future Rust refactors (D-171 defensive guard against accidental surface regression).

Runtime: ~100ms single grep pass. Added to `package.json` as `verify:phase7-rust` + composed into `verify:all` after `verify:phase6-rust`.

### 1 Extended Verify Script — `scripts/verify-feature-cluster-routes.sh`

Extended (not replaced) to cover Phase 7 alongside the existing Phase 5 + 6 checks:

- ComingSoonSkeleton guard loop widened from 4 cluster indexes (agents / knowledge / life-os / identity) to 6 (adds dev-tools / admin).
- Per-route file existence check appended for 10 dev-tools + 11 admin files (21 new files; 55 total across all three phases).
- Header comments updated to cite Phase 7 D-168 + D-170; final echo reports `55 Phase 5+6+7 routes` (was `34 Phase 5+6 routes`).
- Phase 5 + Phase 6 blocks preserved **verbatim** — zero regression on earlier-phase surface checks.

## CI Invocations

```bash
npm run verify:phase7-rust            # new — Phase 7 Rust surface regression
npm run verify:feature-cluster-routes # extended — now covers P7 routes
npm run verify:all                    # composed: 13 gates green (was 12)
```

All three invocations green at commit `f9e5c9d`.

## Mac-session Operator Handoff — M-28..M-34 (Task 3, remaining)

Non-autonomous checkpoint bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3..6 Mac-smoke per STATE.md strategy. The operator's Mac session (brother's machine per STATE.md) must run:

**M-28 — Boot dev build**
```bash
npm install && npm run tauri dev
```
Main window opens without Rust panic; all 5 windows launch.

**M-29 — Terminal (SC-1 + DEV-01)**
Navigate to `/terminal` → Terminal renders (no 404). Run `ls ~/` → output in scrollback; `$ ls ~/` cmd row present; no panic. Try `nonexistent-command` → stderr row rendered with `--status-error` color.

**M-30 — FileBrowser (DEV-02)**
Navigate to `/file-browser` → tree renders for `$HOME`; expand folder (persisted to `prefs.devTools.fileBrowser.expandedPaths`); click file → preview in `<pre>`; "Search" returns `fileIndexSearch` results; "Re-index" triggers `fileIndexScanNow`.

**M-31 — WorkflowBuilder (DEV-05)**
Navigate to `/workflow-builder` → list renders (may be empty fresh install); "New workflow" Dialog opens; submit creates workflow via `workflowCreate`; click in sidebar → detail appears; "Run now" triggers `workflowRunNow`; new entry appears in Runs tab.

**M-32 — WebAutomation (SC-2 + DEV-06)**
Navigate to `/web-automation` → paste goal "go to example.com and describe the page"; "Run" invokes `browserAgentLoop`; live trace populates via `BROWSER_AGENT_STEP` subscription (or full trace on completion); screenshot appears if returned.

**M-33 — SecurityDashboard (SC-4 + ADMIN-05)**
Navigate to `/security-dashboard` → hero shows `securityOverview` status; "Run network scan" → `securityScanNetwork` results in table; Policies tab lists symbolic policies; Pentest tab shows ALL-CAPS banner + "Authorize" Dialog requiring target + rationale.

**M-34 — Diagnostics + round-trip (SC-4 module health + SC-5)**
Navigate to `/diagnostics` → `supervisor-health-grid` shows all running background loops (cron, health-scanner, integration-bridge, perception-loop, pulse, godmode, etc.) — SC-4 module-health falsifier. Sysadmin tab actions gated behind Dialog + ALL-CAPS warning. "Reset onboarding" Dialog warns (verify gate — do NOT confirm). Visit `/decision-log`, `/mcp-settings`, `/integration-status`, `/analytics`, `/capability-reports`, `/reports`, `/temporal`, `/model-comparison`, `/key-vault` — each renders without 404; each has live data or honest empty-state. Run `cd src-tauri && cargo check` — still 0 errors.

**Automated spec pass (as part of the same Mac session):**
```bash
npm run test:e2e            # all Phase 1..6 specs + 4 new Phase 7 specs
npm run verify:all          # 13/13 gates green (extended)
```

**Dev-route hot-path spot-check (optional):**
Visit `/dev-terminal`, `/dev-workflow-builder`, `/dev-security-dashboard`, `/dev-mcp-settings` in the dev build (palette-hidden; hash-URL access) — each mounts its isolation harness successfully.

## Phase 7 Closure Items to Surface at Retrospective

### Orphan Requirements (DP-3 + DP-11)

1. **DEV-11 orphan requirement** — flagged per the plan's `<success_criteria>` and the Phase 7 retrospective queue (DP-3). Not covered by any of the 10 dev-tools routes shipped in Plans 07-03 / 07-04. To be re-scoped or explicitly deferred in the Phase 7 retrospective. (Plan 07-02 SUMMARY's 10 dev-tools placeholder table confirms: Plans 07-03 + 07-04 ship 5+5=10 routes; no eleventh row exists.)

2. **KeyVault synthetic ADMIN-11** — flagged per the plan's `<success_criteria>` and DP-11. Phase 7 introduced a synthetic ADMIN-11 requirement for KeyVault to make the 11-route admin cluster map cleanly; the real `REQUIREMENTS.md` slate covers ADMIN-01..ADMIN-10. Retrospective should either promote ADMIN-11 into the official requirements set or explicitly document why KeyVault exists as a synthetic.

### Phase 7 Completion Commit Template

When Mac-session M-28..M-34 completes successfully, the phase-closure commit message:

```
docs(07): phase 7 substrate complete — 7 plans, ~37 commits; awaiting/passed Mac session M-28..M-34
```

(Current commit count since Phase 7 Plan 07-01 start: ~35 pre-07-07 + 2 from this plan + 1 pending summary commit = ~38. Orchestrator to finalize the count.)

### STATE.md + ROADMAP.md + REQUIREMENTS.md Updates — Next Action

Per executor instructions ("No STATE.md/ROADMAP.md"), these are left untouched by this plan. Next actions for the orchestrator:

1. `gsd-sdk query state.advance-plan` after operator approval of M-28..M-34.
2. `gsd-sdk query state.update-progress` to recalc Phase 7 progress bar.
3. `gsd-sdk query state.record-metric` to append Phase 7 metrics.
4. `gsd-sdk query state.add-decision` for the two DP entries above.
5. `gsd-sdk query roadmap.update-plan-progress 07` to refresh the Phase 7 row in ROADMAP.md.
6. `gsd-sdk query requirements.mark-complete DEV-01 DEV-05 ADMIN-04 ADMIN-05 ADMIN-07 ADMIN-09` for the 6 requirements this plan's specs / verify scripts cover.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Dev-route isolation recipe in plan doesn't match reality**
- **Found during:** Task 1 (before writing any dev route).
- **Issue:** Plan prescribed each `*Dev.tsx` component install `window.__TAURI_INVOKE_HOOK__` in a useEffect + restore previous hook in cleanup. Grep of the entire `src/` tree confirmed `__TAURI_INVOKE_HOOK__` does NOT exist anywhere in the codebase — `_base.ts` calls `invoke` directly with no hook check. The pattern has never been implemented. Meanwhile, Phase 4/5/6 dev routes (VoiceOrbDev, AgentDetailDev, HealthViewDev, CharacterBibleDev, etc.) are all thin passthroughs; the test shim lives in each `.spec.ts` via `addInitScript` installing `__TAURI_INTERNALS__.invoke`.
- **Fix:** Shipped `*Dev.tsx` as thin passthroughs mirroring the Phase 6 recipe exactly. The 4 spec files each carry their own `addInitScript` shim + mocked command returns. Follows Phase 1 Plan 01-09's working harness and Phase 4/5/6 extensions of it.
- **Files modified:** `src/features/dev/TerminalDev.tsx`, `WorkflowBuilderDev.tsx`, `SecurityDashboardDev.tsx`, `McpSettingsDev.tsx`; all 4 spec files.
- **Commit:** `c7cef75` (dev routes) + `f9e5c9d` (specs + shims).

**2. [Rule 1 - Bug] Plan's `page.goto('/#/dev-terminal')` navigation style doesn't match app router**
- **Found during:** Task 2 (writing first spec).
- **Issue:** Plan body uses `page.goto('http://localhost:1420/#/dev-terminal')` hash-URL navigation. BLADE's main-window router is event-driven: `blade_route_request` events fire route changes via `emit_route_request`. Phase 6 specs all use `__BLADE_TEST_EMIT__('blade_route_request', { route_id })` — the hash URL path doesn't exist in the router code.
- **Fix:** All 4 specs go to `/`, wait for the boot gate (`[data-gate-status="complete"]`), then emit `blade_route_request` with the dev route id. Matches Phase 4/5/6 harness exactly.
- **Files modified:** All 4 Phase 7 spec files.
- **Commit:** `f9e5c9d`.

**3. [Rule 2 - Missing critical functionality] Echo message exact command count**
- **Found during:** Verify-script self-test.
- **Issue:** Wrote `all 193 Phase 7 Rust commands` in the success echo; `grep -c` of the script showed 192 commands enumerated. Off-by-one would confuse operators reading CI output.
- **Fix:** Corrected echo to `192`. Matches Plan 07-02 SUMMARY's total wrapper count of 192 (89 dev_tools + 103 admin).
- **Files modified:** `scripts/verify-phase7-rust-surface.sh`.
- **Commit:** `f9e5c9d`.

### Scope-Bounded Discoveries (not fixed, logged for awareness)

None. All issues encountered were in the scope of this plan's file set.

## Verification Evidence

```
$ npx tsc --noEmit
(no output — exit 0)

$ npm run verify:all
[verify-entries]         OK — 5 entries present on disk
[verify-no-raw-tauri]    OK — no raw imports outside allowed paths
[verify-migration-ledger]OK — 13 referenced ids all tracked (89 rows)
[verify-emit-policy]     OK — 59 broadcast emits match allowlist
[audit-contrast]         OK — strict pairs ≥ 4.5:1
[verify-chat-rgba]       OK — no backdrop-filter in chat
[verify-ghost-no-cursor] OK — no cursor in ghost
[verify-orb-rgba]        OK — no backdrop-filter on orb
[verify-hud-chip-count]  OK — exactly 4 HUD chips
[verify-phase5-rust]     OK — 75 Phase 5 commands registered
[verify-feature-cluster-routes] OK — 55 Phase 5+6+7 routes present   <-- extended
[verify-phase6-rust]     OK — 157 Phase 6 commands registered
[verify-phase7-rust]     OK — 192 Phase 7 commands registered       <-- new
```

**13/13 verify:all scripts green.**

## Commits

| Task | Commit    | Message                                                                                   |
| ---- | --------- | ----------------------------------------------------------------------------------------- |
| 1    | `c7cef75` | feat(07-07): add 4 dev-only isolation routes for Phase 7 Playwright specs                  |
| 2    | `f9e5c9d` | feat(07-07): 4 Playwright specs + verify-phase7-rust + extend cluster-routes               |
| 3    | *pending* | Mac-session operator checkpoint (M-28..M-34) — bundled with Phase 1..6 smoke              |

## Success Criteria — Status

- [x] SC-1 observable by automated spec (`dev-tools-terminal.spec.ts`) + M-29 operator check
- [x] SC-2 observable by operator check M-32 (WebAutomation live trace — Playwright coverage deferred to Phase 9 tauri-driver since bursty BROWSER_AGENT_STEP subscription is hard to assert cheaply)
- [x] SC-3 observable by operator check M-34 (DecisionLog route) + Plan 07-05's DecisionLog implementation
- [x] SC-4 observable by automated spec (`admin-security-dashboard.spec.ts`) + M-33/M-34 operator checks
- [x] SC-5 observable by operator check M-34 (all Phase 7 routes mount + `cargo check` clean)
- [x] Regression guards in place: `verify-phase7-rust` (192 cmds) + extended `verify-feature-cluster-routes` (55 routes)
- [x] Dev isolation routes enable deterministic Playwright testing (no backend state required)
- [x] DEV-11 orphan surfaced for retrospective (DP-3)
- [x] KeyVault synthetic ADMIN-11 orphan surfaced for retrospective (DP-11)
- [ ] **PENDING:** M-28..M-34 bundled into operator Mac-session handoff (Task 3)

## Known Stubs

None in this plan's scope. The 4 dev routes and 4 spec shims carry real data wiring (mocked at the invoke boundary, but the React tree renders the same code paths the production app does). The 2 verify scripts enumerate the real Rust surface — no placeholder commands.

## Threat Flags

None beyond the already-enumerated T-07-07-01..04 register. All 4 mitigations delivered:

| Threat       | Mitigation shipped |
| ------------ | ------------------ |
| T-07-07-01 Dev route shipped to prod | paletteHidden + phase:7 + aggregator gates on `import.meta.env.DEV` (router.ts:59). Prod Vite constant-folds the empty-spread away. |
| T-07-07-02 Spec hangs on missing testid | Every `waitForSelector` has 5000ms timeout; `expect.poll` capped at 5000ms with tiered intervals. |
| T-07-07-03 verify-phase7-rust misses a command | Script explicitly enumerates 192 commands per the Plan 07-02 wrapper count; future command removals require script update. |
| T-07-07-04 extended cluster-routes breaks P5/P6 | Existing Phase 5 + 6 blocks preserved verbatim; Phase 7 block appended; final echo updated to 55 routes. All three phase counts still covered in single script. |

## Self-Check: PASSED

All 10 files verified on disk:

```
$ ls src/features/dev/{Terminal,WorkflowBuilder,SecurityDashboard,McpSettings}Dev.tsx \
     tests/e2e/{dev-tools-terminal,dev-tools-workflow-builder,admin-security-dashboard,admin-mcp-settings}.spec.ts \
     scripts/verify-phase7-rust-surface.sh
src/features/dev/TerminalDev.tsx
src/features/dev/WorkflowBuilderDev.tsx
src/features/dev/SecurityDashboardDev.tsx
src/features/dev/McpSettingsDev.tsx
tests/e2e/dev-tools-terminal.spec.ts
tests/e2e/dev-tools-workflow-builder.spec.ts
tests/e2e/admin-security-dashboard.spec.ts
tests/e2e/admin-mcp-settings.spec.ts
scripts/verify-phase7-rust-surface.sh
```

Commits present in `git log --oneline`:
- `c7cef75` — 4 dev routes + index.tsx extension (5 files changed, 145 insertions).
- `f9e5c9d` — 4 specs + 1 new verify script + extended cluster-routes + package.json (7 files changed, 1224 insertions, 16 deletions).

Extended verify-feature-cluster-routes.sh ran green (exit 0, "55 Phase 5+6+7 routes present"). New verify-phase7-rust-surface.sh ran green (exit 0, "192 Phase 7 Rust commands registered"). `npm run verify:all` 13/13 green. `npx tsc --noEmit` exit 0.

Summary file: `.planning/phases/07-dev-tools-admin/07-07-SUMMARY.md` (this file) created via Write tool — not a shell heredoc.
