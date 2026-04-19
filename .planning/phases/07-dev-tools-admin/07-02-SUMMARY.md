---
phase: 07-dev-tools-admin
plan: 02
subsystem: cluster-plumbing
tags: [tauri-wrappers, cluster-index, placeholders, css-base]
dependency_graph:
  requires:
    - Phase 1 substrate (src/lib/tauri/_base.ts invokeTyped, @/design-system/primitives GlassPanel, src/lib/router.ts RouteDefinition, src/styles/tokens.css --s-*/--r-*/--status-* tokens)
    - Phase 5 Plan 05-02 (wrapper recipe reference — src/lib/tauri/agents.ts, src/lib/tauri/knowledge.ts)
    - Phase 6 Plan 06-02 (wrapper recipe reference — src/lib/tauri/life_os.ts, src/lib/tauri/identity.ts)
    - Rust generate_handler! (src-tauri/src/lib.rs:574-1394 — all 193 Phase 7 commands registered)
  provides:
    - 89 Dev Tools typed camelCase wrappers (src/lib/tauri/dev_tools.ts)
    - 103 Admin typed camelCase wrappers (src/lib/tauri/admin.ts)
    - 10 Dev Tools per-route placeholder components (Terminal, FileBrowser, GitPanel, Canvas, WorkflowBuilder, WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, ComputerUse)
    - 11 Admin per-route placeholder components (Analytics, CapabilityReports, Reports, DecisionLog, SecurityDashboard, Temporal, Diagnostics, IntegrationStatus, McpSettings, ModelComparison, KeyVault)
    - Two cluster CSS bases (src/features/dev-tools/dev-tools.css, src/features/admin/admin.css)
    - Two types-barrel files (src/features/dev-tools/types.ts, src/features/admin/types.ts)
    - Barrel namespace re-exports in src/lib/tauri/index.ts (export * as devTools / admin)
  affects:
    - Plans 07-03 and 07-04 (can now import typed Dev Tools wrappers + replace placeholder bodies)
    - Plans 07-05 and 07-06 (can now import typed Admin wrappers + replace placeholder bodies)
tech_stack:
  added: []
  patterns:
    - Cluster-scoped wrapper module (D-166) — one file per cluster, ~90-100 wrappers each
    - camelCase JS API → snake_case Rust arg conversion at invoke boundary (D-38 / D-186)
    - JSDoc @see citation per wrapper (file:line point to Rust source)
    - Forward-compat `[k: string]: unknown` index signature on Serialize types
    - Single-writer cluster index.tsx (D-170) — Plan 07-02 is the ONLY writer of src/features/{dev-tools,admin}/index.tsx; per-route files are owned exclusively by the plan that fills them
    - Real lazy-imported placeholder pattern — each placeholder names the Plan that ships its real body so Plans 07-03..06 can replace cleanly
    - Cluster CSS with @layer features + data-status token-derived accent colors (reuses Phase 5 status tokens)
key_files:
  created:
    - src/lib/tauri/dev_tools.ts (1522 lines, 89 wrappers)
    - src/lib/tauri/admin.ts (1812 lines, 103 wrappers)
    - src/features/dev-tools/types.ts (59 lines)
    - src/features/admin/types.ts (67 lines)
    - src/features/dev-tools/Terminal.tsx
    - src/features/dev-tools/FileBrowser.tsx
    - src/features/dev-tools/GitPanel.tsx
    - src/features/dev-tools/Canvas.tsx
    - src/features/dev-tools/WorkflowBuilder.tsx
    - src/features/dev-tools/WebAutomation.tsx
    - src/features/dev-tools/EmailAssistant.tsx
    - src/features/dev-tools/DocumentGenerator.tsx
    - src/features/dev-tools/CodeSandbox.tsx
    - src/features/dev-tools/ComputerUse.tsx
    - src/features/admin/Analytics.tsx
    - src/features/admin/CapabilityReports.tsx
    - src/features/admin/Reports.tsx
    - src/features/admin/DecisionLog.tsx
    - src/features/admin/SecurityDashboard.tsx
    - src/features/admin/Temporal.tsx
    - src/features/admin/Diagnostics.tsx
    - src/features/admin/IntegrationStatus.tsx
    - src/features/admin/McpSettings.tsx
    - src/features/admin/ModelComparison.tsx
    - src/features/admin/KeyVault.tsx
    - src/features/dev-tools/dev-tools.css (158 lines)
    - src/features/admin/admin.css (110 lines)
  modified:
    - src/features/dev-tools/index.tsx (rewritten — 10 lazy imports replace ComingSoonSkeleton stubs)
    - src/features/admin/index.tsx (rewritten — 11 lazy imports replace ComingSoonSkeleton stubs)
    - src/lib/tauri/index.ts (added `export * as devTools` and `export * as admin`)
decisions:
  - Ship Dev Tools and Admin wrapper modules as independent files (dev_tools.ts, admin.ts) even when a small handful of commands (get_task_routing, get_all_provider_keys, store_provider_key, switch_provider, save_config_field, set_config, test_provider, reset_onboarding, debug_config) already have wrappers in config.ts/chat.ts — the admin.ts copies live behind the admin namespace (`admin.getTaskRouting(...)`) so consumers can import via the cluster-scoped barrel without cross-cluster coupling. Both paths resolve to the same Rust command; no double registration.
  - `mcpAddServer` / `mcpInstallCatalogServer` rename Rust's `args: Vec<String>` to JS-side `mcpArgs` because the outer JS wrapper already has an `args` parameter object. Converted at the invoke boundary so the Rust receiver sees the original snake_case `args` key.
  - `run_shell` / `run_code_block` in Rust return `String` (combined stdout+stderr), not a structured ShellResult. Wrappers expose `Promise<string>` accordingly; Plan 07-03 Terminal will split client-side if it wants per-type coloring. Corrected against the plan's prescribed type.
  - `sysadmin_sudo_exec` returns a Rust tuple `(String, String, i32)` — wrapper returns `Promise<[string, string, number]>` (tuple). Plan 07-06 Diagnostics parses as `[stdout, stderr, exit_code]`.
  - `get_decision_log` in Rust takes no args (hardcoded 20-record ring buffer); wrapper still accepts an optional `limit` arg for API stability but ignores it. Documented in JSDoc.
  - CSS uses `--s-*` / `--r-*` / `--r-pill` token names that actually exist in tokens.css — the plan prescribed `--sp-*` / `--radius-*` / `--radius-pill` which don't exist (Rule 1 auto-fix: plan had wrong token names; corrected to match reality). Status tokens `--status-idle/running/success/error` already present from Phase 5 — reused as-is (D-132).
  - Wrapper file organization follows lib.rs registration order per module rather than a custom order, so Plan 07-07 verify-phase7-rust-surface.sh can enumerate against the same source of truth.
metrics:
  completed_at: "2026-04-18T00:00:00Z"
  duration_minutes: ~40
  tasks_completed: 3
  files_created: 25
  files_modified: 3
  wrappers_emitted:
    dev_tools: 89
    admin: 103
    total: 192
  commits: 3
  verify_steps_green: 12
  rust_files_touched: 0
---

# Phase 7 Plan 07-02: Cluster Tauri Wrappers + Feature Index Rewrite + Per-Route Placeholders Summary

Shipped two cluster-scoped typed Tauri wrapper modules (dev_tools.ts + admin.ts, 192 wrappers total) with JSDoc Rust citations, rewrote both cluster feature index files to lazy-import 21 per-route component files, and seeded each route with a minimal GlassPanel placeholder that Plans 07-03..06 will replace. Zero Rust changes (D-167); all 12 verify scripts green.

## Wrapper Counts by Rust Module

### Dev Tools (89 wrappers across 17 Rust modules)

| Rust module | Commands | Wrappers |
| --- | --- | --- |
| native_tools.rs | 3 | runShell, runCodeBlock, askAi |
| files.rs | 6 | fileRead, fileWrite, fileList, fileTree, fileExists, fileMkdir |
| file_indexer.rs | 4 | fileIndexScanNow, fileIndexSearch, fileIndexRecent, fileIndexStats |
| indexer.rs | 5 | bladeIndexProject, bladeFindSymbol, bladeListIndexedProjects, bladeReindexFile, bladeProjectSummary |
| git_style.rs | 3 | gitStyleMine, gitStyleGet, gitStyleClear |
| code_sandbox.rs | 4 | sandboxRun, sandboxRunExplain, sandboxFixAndRun, sandboxDetectLanguage |
| workflow_builder.rs | 8 | workflowList, workflowGet, workflowCreate, workflowUpdate, workflowDelete, workflowRunNow, workflowGetRuns, workflowGenerateFromDescription |
| browser_agent.rs | 2 | browserAction, browserAgentLoop |
| browser_native.rs | 4 | webAction, browserDescribePage, browserSessionStatus, connectToUserBrowser |
| auto_reply.rs | 3 | autoReplyDraft, autoReplyLearnFromEdit, autoReplyDraftBatch |
| document_intelligence.rs | 8 | docIngest, docSearch, docGet, docList, docDelete, docAnswerQuestion, docCrossSynthesis, docGenerateStudyNotes |
| computer_use.rs | 3 | computerUseTask, computerUseStop, computerUseScreenshot |
| automation.rs | 15 | autoTypeText, autoPressKey, autoKeyCombo, autoMouseMove, autoGetMousePosition, autoMouseClick, autoMouseClickRelative, autoMouseDoubleClick, autoMouseDrag, autoScroll, autoOpenUrl, autoOpenPath, autoLaunchApp, autoCopyToClipboard, autoPasteClipboard |
| ui_automation.rs | 7 | uiaGetActiveWindowSnapshot, uiaDescribeActiveWindow, uiaClickElement, uiaInvokeElement, uiaFocusElement, uiaSetElementValue, uiaWaitForElement |
| reminders.rs | 5 | reminderAdd, reminderAddNatural, reminderList, reminderDelete, reminderParseTime |
| watcher.rs | 4 | watcherAdd, watcherListAll, watcherRemove, watcherToggle |
| cron.rs | 5 | cronAdd, cronList, cronDelete, cronToggle, cronRunNow |
| **Total** | **89** | **89** |

### Admin (103 wrappers across 22 Rust modules)

| Rust module | Commands | Wrappers |
| --- | --- | --- |
| commands.rs (MCP + admin) | 14 | mcpAddServer, mcpInstallCatalogServer, mcpDiscoverTools, mcpCallTool, mcpGetTools, mcpGetServers, mcpRemoveServer, mcpServerStatus, mcpServerHealth, testProvider, debugConfig, setConfig, updateInitPrefs, resetOnboarding |
| permissions.rs | 4 | classifyMcpTool, setToolTrust, resetToolTrust, getToolOverrides |
| db_commands.rs (analytics) | 4 | dbTrackEvent, dbEventsSince, dbPruneAnalytics, dbAnalyticsSummary |
| reports.rs | 5 | reportGap, getReports, updateReportStatus, setReportWebhook, getReportWebhook |
| self_upgrade.rs | 8 | selfUpgradeInstall, selfUpgradeCatalog, selfUpgradeAudit, pentestAuthorize, pentestCheckAuth, pentestRevoke, pentestListAuth, pentestCheckModelSafety |
| evolution.rs | 6 | evolutionGetLevel, evolutionGetSuggestions, evolutionDismissSuggestion, evolutionInstallSuggestion, evolutionRunNow, evolutionLogCapabilityGap |
| immune_system.rs | 1 | immuneResolveGap |
| decision_gate.rs | 3 | getDecisionLog, decisionFeedback, decisionEvaluate |
| authority_engine.rs | 6 | authorityGetAgents, authorityGetAuditLog, authorityGetDelegations, authorityDelegate, authorityRouteAndRun, authorityRunChain |
| audit.rs | 1 | auditGetLog |
| security_monitor.rs | 9 | securityScanNetwork, securityCheckBreach, securityCheckPasswordHash, securityScanSensitiveFiles, securityCheckUrl, securityOverview, securityRunAudit, securityAuditDeps, securityScanCode |
| symbolic.rs | 4 | symbolicCheckPolicy, symbolicListPolicies, symbolicAddPolicy, symbolicVerifyPlan |
| temporal_intel.rs | 4 | temporalWhatWasIDoing, temporalDailyStandup, temporalDetectPatterns, temporalMeetingPrep |
| execution_memory.rs | 3 | exmemRecord, exmemSearch, exmemRecent |
| deep_scan.rs | 3 | deepScanStart, deepScanResults, deepScanSummary |
| supervisor.rs | 2 | supervisorGetHealth, supervisorGetService |
| trace.rs | 1 | getRecentTraces |
| sysadmin.rs | 8 | sysadminDetectHardware, sysadminDryRunEdit, sysadminDryRunCommand, sysadminListCheckpoints, sysadminSaveCheckpoint, sysadminLoadCheckpoint, sysadminRollback, sysadminSudoExec |
| integration_bridge.rs | 3 | integrationGetState, integrationToggle, integrationPollNow |
| config.rs | 6 | getAllProviderKeys, storeProviderKey, switchProvider, getTaskRouting, setTaskRouting, saveConfigField |
| self_critique.rs | 4 | selfCritiqueResponse, selfCritiqueHistory, selfCritiqueDeepRoast, selfCritiqueWeeklyMeta |
| tool_forge.rs | 4 | forgeNewTool, forgeListTools, forgeDeleteTool, forgeTestTool |
| **Total** | **103** | **103** |

## 21 Per-Route Placeholder Files Created

### Dev Tools (10 routes — 5 filled by Plan 07-03, 5 by Plan 07-04)

| File | Shipped by | Placeholder hint |
| --- | --- | --- |
| `src/features/dev-tools/Terminal.tsx` | Plan 07-03 | "Ships in Plan 07-03." |
| `src/features/dev-tools/FileBrowser.tsx` | Plan 07-03 | "Ships in Plan 07-03." |
| `src/features/dev-tools/GitPanel.tsx` | Plan 07-03 | "Ships in Plan 07-03." |
| `src/features/dev-tools/Canvas.tsx` | Plan 07-03 | "Ships in Plan 07-03." |
| `src/features/dev-tools/WorkflowBuilder.tsx` | Plan 07-03 | "Ships in Plan 07-03." |
| `src/features/dev-tools/WebAutomation.tsx` | Plan 07-04 | "Ships in Plan 07-04." |
| `src/features/dev-tools/EmailAssistant.tsx` | Plan 07-04 | "Ships in Plan 07-04." |
| `src/features/dev-tools/DocumentGenerator.tsx` | Plan 07-04 | "Ships in Plan 07-04." |
| `src/features/dev-tools/CodeSandbox.tsx` | Plan 07-04 | "Ships in Plan 07-04." |
| `src/features/dev-tools/ComputerUse.tsx` | Plan 07-04 | "Ships in Plan 07-04." |

### Admin (11 routes — 5 filled by Plan 07-05, 6 by Plan 07-06)

| File | Shipped by | Placeholder hint |
| --- | --- | --- |
| `src/features/admin/Analytics.tsx` | Plan 07-05 | "Ships in Plan 07-05." |
| `src/features/admin/CapabilityReports.tsx` | Plan 07-05 | "Ships in Plan 07-05." |
| `src/features/admin/Reports.tsx` (synthetic, P-03) | Plan 07-05 | "Ships in Plan 07-05." |
| `src/features/admin/DecisionLog.tsx` | Plan 07-05 | "Ships in Plan 07-05." |
| `src/features/admin/SecurityDashboard.tsx` | Plan 07-05 | "Ships in Plan 07-05." |
| `src/features/admin/Temporal.tsx` | Plan 07-06 | "Ships in Plan 07-06." |
| `src/features/admin/Diagnostics.tsx` | Plan 07-06 | "Ships in Plan 07-06." |
| `src/features/admin/IntegrationStatus.tsx` | Plan 07-06 | "Ships in Plan 07-06." |
| `src/features/admin/McpSettings.tsx` | Plan 07-06 | "Ships in Plan 07-06." |
| `src/features/admin/ModelComparison.tsx` | Plan 07-06 | "Ships in Plan 07-06." |
| `src/features/admin/KeyVault.tsx` | Plan 07-06 | "Ships in Plan 07-06." |

Each placeholder renders a `GlassPanel tier={1}` with a centered `<h2>` plus a hint paragraph. Data-testid coverage is in place so Plan 07-07 Playwright specs can detect placeholder vs real body transitions cleanly.

## Rust Signature Corrections Made During Wrapper Authoring

While reading the Rust source, several drafted wrapper signatures had to be corrected — the actual Rust wins:

| Wrapper | Plan draft | Rust reality (wrapper adjusted) |
| --- | --- | --- |
| `runShell` | `Promise<ShellResult>` with stdout/stderr/exit_code split | `Promise<string>` — Rust returns combined text blob (stdout+stderr) from `bash()`. Plan 07-03 Terminal can split client-side. |
| `runCodeBlock` | `(code, language)` args | Rust takes a single `command: String`. Despite the name, it's just bash. Plan 07-04 CodeSandbox uses `sandboxRun` for multi-language. |
| `fileTree` | arg `depth?` | Rust arg is `max_depth`; wrapper accepts `depth` in JS then converts at the invoke boundary. |
| `autoLaunchApp` | arg `args?` (collides with wrapper object) | Renamed JS-side to `launchArgs`; converted to Rust's `args` at the invoke boundary. |
| `mcpAddServer` / `mcpInstallCatalogServer` | arg `args` (collides with wrapper object) | Renamed JS-side to `mcpArgs`; converted to Rust's `args` at the invoke boundary. |
| `sandboxFixAndRun` | arg `app` surfaced | Tauri injects `app` automatically — JS only passes `language`, `code`, `error`. |
| `workflowRunNow` | `app` parameter | Same — Tauri-injected; JS only passes `workflow_id`. |
| `browserAction` | `action: BrowserAction` typed | Rust accepts `serde_json::Value` — wrapper takes `unknown` and returns `string` (the observation text). |
| `sysadminSudoExec` return | `Promise<string>` | Rust returns tuple `(String, String, i32)` — wrapper returns `Promise<[string, string, number]>`. |
| `getDecisionLog` arg `limit` | Surfaced to Rust | Rust takes no args (hardcoded 20-record ring buffer). JS keeps optional `limit` for API stability but ignores it (documented in JSDoc). |
| `supervisorGetHealth` return | `Promise<SupervisorHealth>` object wrapper | Rust returns `Vec<ServiceHealth>` directly. Wrapper returns `Promise<SupervisorService[]>`; Plan 07-06 Diagnostics wraps into `{ services }` client-side. |
| `auto_reply_draft` return | `Promise<AutoReplyDraft>` object | Rust returns `Result<String, String>` — wrapper returns `Promise<string>`. |

These corrections are captured in each wrapper's JSDoc "Note:" paragraph so Plans 07-03..06 don't re-derive them.

## Barrel / Tokens / CSS Verification

- `src/lib/tauri/index.ts` extended with `export * as devTools from './dev_tools'` and `export * as admin from './admin'` — mirrors the Phase 5/6 `lifeOs`/`identity` pattern.
- `grep -q "status-running" src/styles/tokens.css` passes — all status tokens (`--status-idle`, `--status-running`, `--status-success`, `--status-error`) are present from Phase 5 Plan 05-02 and reused verbatim (D-132).
- `dev-tools.css` and `admin.css` both created under `@layer features` with shared base classes. Only `GlassPanel` uses `backdrop-filter`; inner cards use `rgba(...)` bg (D-07 / D-70 preserved).
- CSS uses the actual token names `--s-*` (spacing), `--r-*` (radius), `--r-pill`. The plan's prescribed `--sp-*` / `--radius-*` tokens don't exist — corrected to match `src/styles/tokens.css` reality (Rule 1 auto-fix).

## D-170 Single-Writer Invariant Held

Only `src/features/dev-tools/index.tsx` and `src/features/admin/index.tsx` were touched among index files — confirmed via `git log --since "this plan start" --name-only | grep index.tsx`:

```
src/features/dev-tools/index.tsx
src/features/admin/index.tsx
```

No other cluster index files were edited. Plans 07-03..06 will replace per-route BODIES only; they will not touch the two index.tsx files.

## Zero Rust Changes

`git log --since "this plan start" --name-only | grep "^src-tauri"` returns empty. D-167 / D-171 preserved — every wrapper binds to a Rust command that was already registered in `src-tauri/src/lib.rs` generate_handler! before this plan started.

## Verification Results

- `npx tsc --noEmit`: passes (zero errors).
- `npm run verify:all`: 12/12 green
  - verify-entries: 5 entries present on disk
  - verify-no-raw-tauri: no raw imports outside allowed paths
  - verify-migration-ledger: 13 referenced ids all tracked
  - verify-emit-policy: 59 broadcast emits match allowlist
  - audit-contrast: all strict pairs ≥ 4.5:1
  - verify-chat-rgba: no backdrop-filter in chat
  - verify-ghost-no-cursor: no cursor property
  - verify-orb-rgba: no backdrop-filter on orb
  - verify-hud-chip-count: exactly 4 chips
  - verify-phase5-rust-surface: 75 commands registered
  - verify-feature-cluster-routes: 34 Phase 5+6 routes present
  - verify-phase6-rust-surface: 157 commands registered

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CSS token names in plan don't exist in tokens.css**
- **Found during:** Task 3 sub-task 3d/3e (CSS authoring).
- **Issue:** Plan prescribed `--sp-1..--sp-8`, `--radius-card`, `--radius-pill` but `src/styles/tokens.css` actually defines `--s-1..--s-20`, `--r-xs/sm/md/lg/xl/2xl`, `--r-pill`.
- **Fix:** Substituted the correct token names throughout dev-tools.css and admin.css. Status tokens (`--status-running/success/error/idle`) and `--font-mono`, `--font-display`, `--t-1..--t-3`, `--line`, `--ease-out` used as-is since they match the plan.
- **Files modified:** src/features/dev-tools/dev-tools.css, src/features/admin/admin.css
- **Commit:** 7328f3e

**2. [Rule 1 - Bug] Several wrapper return/arg signatures diverge from plan sketch**
- **Found during:** Tasks 1 and 2 (Rust source reading).
- **Issue:** Plan's "representative types" section described structured returns (ShellResult with stdout/stderr/exit_code, SupervisorHealth object wrapper, AutoReplyDraft object, etc.) that don't match the Rust surface.
- **Fix:** Wrapper signatures match the real Rust fn signatures (the Rust wins, per plan's own rule). Every correction documented in JSDoc "Note:" paragraphs on the affected wrappers. Full list in the "Rust Signature Corrections" section above.
- **Files modified:** src/lib/tauri/dev_tools.ts, src/lib/tauri/admin.ts
- **Commits:** 06b67e9, 9a9abc5

### Scope-Bounded Discoveries (not fixed, logged for awareness)

None. All issues encountered were in the scope of this plan's file set.

## Known Stubs

None. The 21 per-route placeholder files are intentional contracts that Plans 07-03..06 will replace — each hint names the follow-up plan so consumers (and the verifier) can distinguish "placeholder awaiting follow-up" from "empty state by design." The two index.tsx files, two wrapper files, two types files, and two CSS files are all complete for this plan's scope.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat_model already enumerated. Wrappers strictly mirror existing Rust surface; no new attack surface introduced.

## Commits

- `06b67e9` feat(07-02): dev_tools.ts typed wrappers + dev-tools/types.ts barrel
- `9a9abc5` feat(07-02): admin.ts typed wrappers + admin/types.ts barrel
- `7328f3e` feat(07-02): cluster indexes + 21 placeholders + cluster CSS + barrel

## Self-Check: PASSED

Every artifact claimed above was verified on disk:
- `src/lib/tauri/dev_tools.ts` — 89 exports, 111 @see citations, 91 invokeTyped calls, 1522 lines.
- `src/lib/tauri/admin.ts` — 103 exports, 142 @see citations, 105 invokeTyped calls, 1812 lines.
- `src/features/dev-tools/types.ts`, `src/features/admin/types.ts` — exist.
- 10 dev-tools/*.tsx + 11 admin/*.tsx placeholder files — all exist.
- `src/features/dev-tools/dev-tools.css`, `src/features/admin/admin.css` — exist.
- `src/lib/tauri/index.ts` — barrel re-exports present (`export * as devTools from './dev_tools'`, `export * as admin from './admin'`).
- `src/styles/tokens.css` still contains `--status-running` (Phase 5 token reuse confirmed).
- Three commits present in `git log --oneline -4`: 06b67e9, 9a9abc5, 7328f3e.
- Zero Rust files in the 3-commit diff (`git log --since ... --name-only | grep -c "^src-tauri"` returns 0).
- `npx tsc --noEmit` passes with no output.
- `npm run verify:all` completes 12/12 green.
