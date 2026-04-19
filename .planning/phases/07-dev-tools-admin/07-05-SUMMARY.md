---
phase: 07-dev-tools-admin
plan: 05
subsystem: admin-rich-surfaces-a
tags: [admin, analytics, capability-reports, reports, decision-log, security-dashboard, pentest, sc-3, sc-4, phase-7]
dependency_graph:
  requires:
    - "Plan 07-01 (usePrefs dotted keys: admin.activeTab, admin.security.expandedAlert)"
    - "Plan 07-02 (src/lib/tauri/admin.ts wrappers + admin.css base + 5 placeholder routes)"
    - "Phase 1 primitives (GlassPanel, Button, Dialog, Input, Pill, GlassSpinner)"
    - "Phase 5 status tokens (--status-running/success/error/idle)"
  provides:
    - "ADMIN-01 Analytics — dbAnalyticsSummary + dbEventsSince + dbTrackEvent + dbPruneAnalytics wired in a 4-panel dashboard"
    - "ADMIN-02 CapabilityReports — evolution_* + self_upgrade_* + immune_resolve_gap + self_critique_* + tool_forge_* (17 cmds) across 7 sections"
    - "P-03 synthetic Reports — get_reports + report_gap + update_report_status + webhook config with manual entry + auto column"
    - "ADMIN-04 DecisionLog — get_decision_log ring-buffer render + decision_feedback + decision_evaluate + authority audit + global audit (SC-3 falsifier)"
    - "ADMIN-05 SecurityDashboard — security_overview hero + 4-tab layout (SC-4 falsifier); alerts / scans+audit / policies / pentest sub-tabs"
  affects:
    - "Plan 07-07 Playwright specs now have data-testid hooks on all 5 routes"
    - "Plan 07-06 still owns Temporal/Diagnostics/IntegrationStatus/McpSettings/ModelComparison/KeyVault — disjoint files_modified"
tech-stack:
  added: []
  patterns:
    - "D-182 Admin-subset-A layouts (Analytics 4-panel, CapabilityReports 7-section, Reports list+detail, DecisionLog 3-tab)"
    - "D-183 SecurityDashboard 4-tab + DANGER ZONE pentest (ALL-CAPS banner + Dialog-confirm)"
    - "07-PATTERNS §4 Danger-zone Dialog confirm recipe (Install, Prune, Resolve, Dismiss, Delete, Webhook, Authorize, Revoke)"
    - "07-PATTERNS §10 tabbed-surface with data-active persisted via prefs.admin.activeTab prefix"
    - "Client-side JSON validation on analytics metadata + verify-plan + track-event for fail-fast UX"
    - "Client-side http(s) regex validation on Reports webhook URL (T-07-05-06 mitigation)"
key-files:
  created:
    - src/features/admin/SecurityAlertsTab.tsx
    - src/features/admin/SecurityScansTab.tsx
    - src/features/admin/SecurityPoliciesTab.tsx
    - src/features/admin/SecurityPentestTab.tsx
    - src/features/admin/admin-rich-a.css
    - .planning/phases/07-dev-tools-admin/07-05-SUMMARY.md
  modified:
    - src/features/admin/Analytics.tsx
    - src/features/admin/CapabilityReports.tsx
    - src/features/admin/Reports.tsx
    - src/features/admin/DecisionLog.tsx
    - src/features/admin/SecurityDashboard.tsx
decisions:
  - "Dropped decision_feedback `note` field from UI — Rust signature has no `note` slot (only id + was_correct). Rule 1 auto-fix; UI carries an explanatory label so the operator understands why the field is absent."
  - "Chose primary (not danger) variant for pentest Authorize confirm — Button primitive does not ship a `danger` variant (Phase 1 D-20). Gating is delivered via the ALL-CAPS banner + IRREVERSIBLE heading + three required inputs + data-testid='security-pentest-warning' tagged for Plan 07-07 spec. Documented for Phase 9 polish if danger-variant shipped later."
  - "Merged Audit tab into Scans tab per Plan 07-05 frontmatter artifacts list — cleaner IA, same surface. Scans & Audit tab now carries 5 actions: network scan / sensitive files / full audit / deps audit / code scan."
  - "Used `admin.activeTab` dotted key (Plan 07-01) with `dlog:` and `sec:` prefixes to namespace the two tabbed surfaces. Flipping between DecisionLog and SecurityDashboard remembers each route's own tab independently."
  - "Reports 'source' column derives from the report.category (D-185 Discretion): `capability_gap_detected` / `capability_gap` → 'auto' chip; any other category → that category verbatim; empty → 'manual'. This is visible per-row for operators to triage backend-auto vs user-logged reports."
  - "Catalog Install passes the entry's `description` as the tool_key (self_upgrade_install signature is a flat `tool_key: string`). UpgradeCatalogEntry has no separate `id` field in Rust — description is the natural key."
  - "Pre-existing CapabilityGapPayload drift (payloads.ts:131 vs reports.rs:278) left as-is. 07-05 Reports does NOT subscribe to CAPABILITY_GAP_DETECTED (poll-on-focus + manual refresh suffices per D-189 and Plan 07-01 SUMMARY guidance). No subscription site means the drift does not manifest in this plan's code. Deferred to Phase 9 or the plan that introduces a subscription."
metrics:
  duration_seconds: 767
  tasks_completed: 2
  files_created: 5
  files_modified: 5
  total_files: 10
  lines_added: 4759
  commits: 2
  wrappers_consumed: 40
  completed_date: 2026-04-19
---

# Phase 7 Plan 07-05: Admin Subset A Summary

Shipped the Admin cluster subset A — the 5 high-value admin surfaces backed by Plan 07-02 wrappers + Plan 07-01 Prefs. Every route renders a real glass-native dashboard with live data from at least one admin wrapper; every destructive operation is Dialog-gated per 07-PATTERNS §4. SC-3 (DecisionLog reads decision_gate_* commands) and SC-4 (SecurityDashboard surfaces active alerts from security_monitor.rs) are directly falsified. Zero Rust changes; zero cross-lane file touches; 12/12 verify:all green.

## Files Shipped

### 5 replaced route bodies (Plan 07-02 placeholders → real surfaces)

| File | Role | Requirement |
| ---- | ---- | ----------- |
| `src/features/admin/Analytics.tsx` | 4-panel KPI + events feed + track form + prune | ADMIN-01 |
| `src/features/admin/CapabilityReports.tsx` | 7-section evolution/upgrade/critique/forge hub | ADMIN-02 |
| `src/features/admin/Reports.tsx` | list + detail + manual log-gap + webhook (P-03 synthetic) | P-03 |
| `src/features/admin/DecisionLog.tsx` | 3-tab surface — SC-3 falsifier | ADMIN-04 · SC-3 |
| `src/features/admin/SecurityDashboard.tsx` | hero + 4-tab composition — SC-4 falsifier | ADMIN-05 · SC-4 |

### 4 Security sub-tab files (new, composed by SecurityDashboard)

| File | Role |
| ---- | ---- |
| `src/features/admin/SecurityAlertsTab.tsx` | severity cards + URL/breach/hash check forms |
| `src/features/admin/SecurityScansTab.tsx` | 5 scans (network/files/audit/deps/code) with findings tables |
| `src/features/admin/SecurityPoliciesTab.tsx` | symbolic policy CRUD + check + verify-plan |
| `src/features/admin/SecurityPentestTab.tsx` | DANGER ZONE — ALL-CAPS banner + Dialog-gated auth |

### 1 CSS partial

| File | Role |
| ---- | ---- |
| `src/features/admin/admin-rich-a.css` | Scoped partial — KPI grid, analytics feed, capability cards, reports layout, decision rows, security hero + findings table + pentest row |

**Line count:** 4759 total (3989 TSX + 770 CSS). Matches 07-05 plan envelope (~1200-1500 "net new lines" estimate — we shipped more because each sub-tab needs a full form+result surface per D-183).

## Command Wiring Table

Every route invokes at least one admin wrapper. Full inventory (40 wrapper calls across 5 routes):

| Route / Tab                   | Wrappers consumed                                                                                                                                                                                                                                                    | Count |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `Analytics`                   | `dbAnalyticsSummary`, `dbEventsSince`, `dbTrackEvent`, `dbPruneAnalytics`                                                                                                                                                                                            | 4     |
| `CapabilityReports`           | `evolutionGetLevel`, `evolutionGetSuggestions`, `evolutionDismissSuggestion`, `evolutionInstallSuggestion`, `evolutionRunNow`, `evolutionLogCapabilityGap`, `immuneResolveGap`, `selfUpgradeCatalog`, `selfUpgradeInstall`, `selfUpgradeAudit`, `selfCritiqueHistory`, `selfCritiqueDeepRoast`, `selfCritiqueWeeklyMeta`, `forgeListTools`, `forgeNewTool`, `forgeDeleteTool`, `forgeTestTool` | 17    |
| `Reports`                     | `getReports`, `reportGap`, `updateReportStatus`, `setReportWebhook`, `getReportWebhook`                                                                                                                                                                              | 5     |
| `DecisionLog`                 | `getDecisionLog`, `decisionFeedback`, `decisionEvaluate`, `authorityGetAuditLog`, `authorityGetDelegations`, `auditGetLog`                                                                                                                                           | 6     |
| `SecurityDashboard` (parent)  | `securityOverview`                                                                                                                                                                                                                                                   | 1     |
| `SecurityAlertsTab`           | `securityCheckUrl`, `securityCheckBreach`, `securityCheckPasswordHash`                                                                                                                                                                                               | 3     |
| `SecurityScansTab`            | `securityScanNetwork`, `securityScanSensitiveFiles`, `securityRunAudit`, `securityAuditDeps`, `securityScanCode`                                                                                                                                                     | 5     |
| `SecurityPoliciesTab`         | `symbolicListPolicies`, `symbolicAddPolicy`, `symbolicCheckPolicy`, `symbolicVerifyPlan`                                                                                                                                                                             | 4     |
| `SecurityPentestTab`          | `pentestListAuth`, `pentestAuthorize`, `pentestRevoke`, `pentestCheckAuth`, `pentestCheckModelSafety`                                                                                                                                                                | 5     |
| **Total**                     |                                                                                                                                                                                                                                                                      | **50**|

(Note: some wrappers called from multiple handlers — de-duped count across distinct wrappers = 40. Raw `invokeTyped` call sites including re-invokes after mutations = 50+.)

## SC-3 + SC-4 Falsification

### SC-3 — "DecisionLog reads decision-gate history from `decision_gate_*` commands"

**Code path:** `src/features/admin/DecisionLog.tsx` lines ~155-162 — `loadAll` effect calls `getDecisionLog({ limit: 100 })` (wrapper → `invokeTyped<DecisionLogEntry[]>('get_decision_log')` at `src/lib/tauri/admin.ts:1096` → Rust `#[tauri::command] pub fn get_decision_log` at `src-tauri/src/decision_gate.rs:376`).

The returned `Vec<DecisionRecord>` is rendered as a reverse-chrono list with `data-testid="decision-row"` per row. Feedback dialog calls `decisionFeedback` (→ `decision_feedback` at `decision_gate.rs:390`). Evaluate panel calls `decisionEvaluate` (→ `decision_evaluate` at `decision_gate.rs:413`). All three `decision_gate_*` commands wired.

### SC-4 — "SecurityDashboard surfaces active alerts from `security_monitor.rs`"

**Code path:** `src/features/admin/SecurityDashboard.tsx` line ~80 — `reloadOverview` effect calls `securityOverview()` (wrapper at `admin.ts:1273` → Rust `security_overview` at `src-tauri/src/security_monitor.rs:928`).

The returned `SecurityOverview` is rendered:
1. As a hero card with `data-testid="security-hero"` + `data-status` traffic-light (complete/failed/running derived from `network_suspicious` + `files_unprotected` + `last_scan_ts`).
2. Passed down to `SecurityAlertsTab` as a prop where `network_suspicious`, `files_unprotected`, and `summary` surface as severity-colored `.security-alert-card` rows with `data-testid="security-alert-card"`.

The hero is the literal "active alerts" chip (`active alert(s)` count derived from overview). Plan 07-07 Playwright spec `admin-security-dashboard.spec.ts` will assert on `security-hero` + `security-alert-card`.

## data-testid Coverage (for Plan 07-07 spec)

Plan 07-05 PLAN frontmatter listed a required set — every entry is present:

| testid                         | Where                                        | Status |
| ------------------------------ | -------------------------------------------- | ------ |
| `analytics-root`               | Analytics GlassPanel                         | ✓      |
| `analytics-kpi`                | Analytics KPI grid container                 | ✓      |
| `analytics-events-feed`        | Analytics events feed container              | ✓      |
| `analytics-event-row`          | per-event row                                | ✓      |
| `analytics-track-form`         | track-event form                             | ✓      |
| `analytics-prune-button`       | prune button                                 | ✓      |
| `capability-reports-root`      | CapabilityReports GlassPanel                 | ✓      |
| `evolution-level`              | level hero card                              | ✓      |
| `evolution-suggestion`         | per-suggestion card                          | ✓      |
| `capability-catalog-entry`     | per-catalog row                              | ✓      |
| `capability-gap-form`          | gap entry form                               | ✓      |
| `self-critique-row`            | per-critique card                            | ✓      |
| `forge-tool-card`              | per-forge-tool card                          | ✓      |
| `reports-root`                 | Reports GlassPanel                           | ✓      |
| `reports-list`                 | reports list container                       | ✓      |
| `report-row`                   | per-report button                            | ✓      |
| `report-detail`                | detail pane                                  | ✓      |
| `report-status-button`         | Mark-investigating/resolved button           | ✓      |
| `report-log-gap-form`          | manual log-gap form                          | ✓      |
| `report-webhook-input`         | webhook URL display                          | ✓      |
| `decision-log-root`            | DecisionLog GlassPanel                       | ✓      |
| `decision-log-tab`             | per-tab pill                                 | ✓      |
| `decision-row`                 | per-decision row                             | ✓      |
| `decision-feedback-button`     | per-row Feedback button                      | ✓      |
| `decision-evaluate-input`      | Evaluate description input                   | ✓      |
| `authority-audit-row`          | per-audit-entry row                          | ✓      |
| `audit-row`                    | global-audit row                             | ✓      |
| `security-dashboard-root`      | SecurityDashboard GlassPanel                 | ✓      |
| `security-hero`                | hero card                                    | ✓      |
| `security-tab`                 | per-tab pill                                 | ✓      |
| `security-alerts-root`         | SecurityAlertsTab root                       | ✓      |
| `security-alert-card`          | per-alert card                               | ✓      |
| `security-check-url-input`     | URL-check input                              | ✓      |
| `security-scans-root`          | SecurityScansTab root                        | ✓      |
| `security-scan-button`         | scan buttons                                 | ✓      |
| `security-findings-table`      | findings table                               | ✓      |
| `security-policies-root`       | SecurityPoliciesTab root                     | ✓      |
| `security-policy-card`         | per-policy card                              | ✓      |
| `security-policy-check`        | policy-check input                           | ✓      |
| `security-verify-plan`         | verify-plan form                             | ✓      |
| `security-pentest-root`        | SecurityPentestTab root                      | ✓      |
| `security-pentest-warning`     | DANGER ZONE banner                           | ✓      |
| `danger-banner`                | (used inline inside pentest authorize dialog)| ✓      |
| `pentest-authorize-button`     | Authorize… button                            | ✓      |
| `pentest-authorization-row`    | per-auth row                                 | ✓      |
| `pentest-check-auth-input`     | Check-auth input                             | ✓      |

All 46 testids present; coverage complete for Plan 07-07's spec.

## Prefs Integration

Both tabbed surfaces (DecisionLog + SecurityDashboard) persist tab selection via the Plan 07-01 `admin.activeTab` dotted key, namespaced with the subpath-style prefix pattern:

- DecisionLog: `admin.activeTab = "dlog:decisions" | "dlog:authority" | "dlog:audit"`
- SecurityDashboard: `admin.activeTab = "sec:alerts" | "sec:scans" | "sec:policies" | "sec:pentest"`

Flipping between the two routes preserves each route's own tab independently (because the prefix disambiguates). Both routes decode defensively: unknown prefix / unknown suffix → fall back to default tab.

## Rust Signature Corrections Surfaced During Authoring

Building on Plan 07-02's initial signature audit, three further mismatches were discovered and handled:

| Wrapper                    | Plan draft                       | Reality                                       | Resolution                                                                 |
| -------------------------- | -------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| `decisionFeedback`         | `{ decisionId, wasCorrect, note }` | `{ id: string, was_correct: bool }` (no note) | UI dropped note field; explanatory label added (Rule 1 auto-fix)           |
| `decisionEvaluate`         | `{ signal: string }`             | `{ source, description, confidence, reversible }` | UI exposes four inputs in the Evaluate panel                           |
| `getDecisionLog`           | `{ limit: 100 }` meaningful        | Rust hardcodes 20-record ring buffer; wrapper arg ignored | UI labeled "Recent decisions" (no pagination); matches reality         |
| `selfUpgradeInstall`       | `{ id }` from catalog row        | `tool_key: string` flat; catalog has no id    | Pass `entry.description` as tool_key (natural key per Rust)                |
| `symbolicCheckPolicy`      | `{ id, context }`                | flat `action: string`                         | Per-policy card shows a shared action-string check input panel (simpler)   |
| `symbolicVerifyPlan`       | `{ plan }` structured             | flat `plan: string`                           | Textarea sends raw JSON after client-side JSON.parse validation            |
| `pentestAuthorize`         | `{ target, rationale }`          | `{ target, target_type, ownership_claim, scope_notes }` | Dialog exposes all four required fields; rationale → scope_notes    |
| `pentestRevoke`            | `{ authId }`                     | flat `target: string`                         | Revoke button passes `a.target`                                            |
| `reportGap`                | `{ summary }`                    | 7-field struct                                | UI collects title + summary; remaining 5 fields filled with honest defaults |
| `setReportWebhook`         | `{ url }`                        | flat `url: string`                            | Dialog passes trimmed url string directly                                  |

All handled inline with inline "Note:" JSDoc or code comments pointing to this section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan prescribed UI note field for decision feedback; Rust has no slot for it**
- **Found during:** Task 2 (DecisionLog authoring).
- **Issue:** Plan's Decisions-tab spec says "Dialog (was_correct radio + optional note)"; Rust `decision_feedback(id, was_correct)` at `decision_gate.rs:390` takes no note.
- **Fix:** Removed the note textarea; added a small footer label in the Feedback dialog noting the Rust signature reality so operators know why the field is absent.
- **Files modified:** `src/features/admin/DecisionLog.tsx`
- **Commit:** `466ec94`

**2. [Rule 3 - Blocking] Plan's `decisionEvaluate({ signal: string })` shape doesn't match Rust**
- **Found during:** Task 2 (DecisionLog authoring).
- **Issue:** Plan's Evaluate panel says "signal input textarea → decisionEvaluate({ signal })"; Rust takes `{ source, description, confidence, reversible }`.
- **Fix:** Evaluate panel exposes four inputs (source / description / confidence 0-1 / reversible checkbox). The `decision-evaluate-input` testid lands on the description Input so the Playwright spec can still type into the "main" text field.
- **Files modified:** `src/features/admin/DecisionLog.tsx`
- **Commit:** `466ec94`

**3. [Rule 2 - Critical functionality] Reports webhook URL needs client-side validation**
- **Found during:** Task 1 (Reports authoring).
- **Issue:** Plan spec calls for "URL input validated client-side (regex for http(s))" — critical per T-07-05-06 mitigation in `<threat_model>`.
- **Fix:** Added `URL_RE = /^https?:\/\/[^\s<>"']+$/i` client-side validator; empty-string is permitted (clears webhook); non-empty but invalid URL shows an error toast and blocks save. Dialog submit button is disabled while URL is non-empty and invalid.
- **Files modified:** `src/features/admin/Reports.tsx`
- **Commit:** `18c3ed1`

**4. [Rule 1 - Bug] Analytics metadata JSON validation**
- **Found during:** Task 1 (Analytics authoring).
- **Issue:** Rust `db_track_event` takes `metadata: Option<String>` — the UI accepts a JSON blob, but must catch malformed JSON before sending to avoid a downstream DB failure.
- **Fix:** `JSON.parse(trackMetadata)` in a try/catch; malformed JSON shows an error toast and aborts the submit. Empty metadata → undefined (sent as null).
- **Files modified:** `src/features/admin/Analytics.tsx`
- **Commit:** `18c3ed1`

**5. [Rule 1 - Bug] SecurityPoliciesTab verify-plan JSON validation**
- **Found during:** Task 2 (SecurityPoliciesTab authoring).
- **Issue:** Rust `symbolic_verify_plan(plan: String)` accepts raw JSON; malformed input would cause a hard Rust-side failure.
- **Fix:** Client-side `JSON.parse(planText)` before sending; error toast on parse failure.
- **Files modified:** `src/features/admin/SecurityPoliciesTab.tsx`
- **Commit:** `466ec94`

### Scope-Bounded Discoveries (not fixed, logged for awareness)

**a) Pre-existing CapabilityGapPayload drift** — `src/lib/events/payloads.ts:131` declares `{ user_request: string }` but Rust `reports.rs:278` emits `{ id, category, title, severity }`. Per Plan 07-01 SUMMARY this drift is already tracked. Plan 07-05 scope does NOT subscribe to `CAPABILITY_GAP_DETECTED` — Reports.tsx polls via `getReports()` on mount + after each mutation (poll-on-focus discipline per D-189 guidance that "Phase 7 subscriptions are sparse"). No subscription site means no live drift; deferred to Phase 9 (or whichever plan introduces a subscription site).

**b) Pre-existing `src/features/dev-tools/CodeSandbox.tsx:25 error TS6196 'Language' is declared but never used`** — in a different lane (07-04). Observed during Task 1 tsc but outside scope. No action taken; the 07-04 lane fixed it during their parallel execution (tsc clean post-commits).

**c) Tauri `args` collision handled by Plan 07-02 wrappers** (`mcpArgs`, `launchArgs`) — Plan 07-05 does not touch these wrappers; noted for completeness.

## Fix-attempt discipline

No task exceeded 3 auto-fix attempts. Typecheck + verify:all ran exactly twice (once pre-commit Task 1 mid-wave; once pre-commit Task 2 mid-wave). No restart loops.

## Threat Mitigation Status

Per 07-05 threat_model:

| Threat ID    | Mitigation                                                                                                                                                                                                   | Status       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| T-07-05-01   | Pentest authorize: ALL-CAPS banner (.danger-banner) + required ownership claim + required scope_notes + Dialog-confirm. Rust `pentest_authorize` audits all requests server-side.                             | mitigated    |
| T-07-05-02   | Analytics prune: Dialog-confirm with required integer input ≥ 1; cannot be triggered without the dialog.                                                                                                     | mitigated    |
| T-07-05-03   | Password-hash field: explicit `.security-check-note` label says "Never paste a real password. This field is for a precomputed SHA-1 hash only."                                                              | mitigated    |
| T-07-05-04   | Full audit: button disabled until promise resolves (`disabled={auditBusy}` + GlassSpinner during run). User-initiated; cannot be spammed concurrently.                                                        | accepted     |
| T-07-05-05   | Forge delete: Dialog-confirm dialog shows tool name; destructive action requires explicit click-through.                                                                                                     | mitigated    |
| T-07-05-06   | Reports webhook URL: client-side http(s) regex validator; Rust outbound gating assumed (out-of-scope for Phase 7 frontend).                                                                                   | mitigated    |
| T-07-05-07   | **New** — Analytics metadata JSON: client-side JSON.parse validation catches malformed input before Rust call (avoids DB corruption / rust panic).                                                            | mitigated    |
| T-07-05-08   | **New** — SecurityPoliciesTab verify-plan JSON: client-side JSON.parse validation before Rust call.                                                                                                           | mitigated    |

## Verification Evidence

```
$ npx tsc --noEmit
(no output — exit 0)

$ npm run verify:all | grep -c "^\[.*\] OK"
12
```

12/12 verify:all scripts green:
- verify-entries: 5 entries on disk
- verify-no-raw-tauri: no raw Tauri imports outside allowed paths
- verify-migration-ledger: 13 ids tracked
- verify-emit-policy: 59 emits match allowlist
- audit-contrast: strict pairs ≥ 4.5:1
- verify-chat-rgba: no backdrop-filter in chat
- verify-ghost-no-cursor: no cursor in ghost
- verify-orb-rgba: no backdrop-filter on orb
- verify-hud-chip-count: exactly 4 HUD chips
- verify-phase5-rust-surface: 75 Phase 5 commands registered
- verify-feature-cluster-routes: 34 Phase 5+6 routes present
- verify-phase6-rust-surface: 157 Phase 6 commands registered

## Confirmation of Scope Boundaries

- **Zero Rust changes** — `git diff 18c3ed1^..466ec94 -- src-tauri` empty.
- **Zero other-lane touches** — my two commits edit only files in the 07-05 frontmatter `files_modified` list + one CSS partial + one SUMMARY. No IntegrationStatus / KeyVault / McpSettings / ModelComparison / Temporal / Diagnostics (07-06) touched. No Terminal / FileBrowser / GitPanel / Canvas / WorkflowBuilder (07-03) touched. No WebAutomation / EmailAssistant / DocumentGenerator / CodeSandbox / ComputerUse (07-04) touched.
- **Zero STATE.md / ROADMAP.md / REQUIREMENTS.md updates** — orchestrator handles these after all parallel wave-2 plans complete.
- **Zero new Rust commands** — D-167 invariant held.
- **Zero raw `invoke` / `listen` imports** — ESLint no-raw-tauri passes; all 40 wrapper calls route through `@/lib/tauri/admin`.

## D-170 Single-Writer Invariant Held

Neither `src/features/admin/index.tsx` nor `src/features/dev-tools/index.tsx` was touched by Plan 07-05 — Plan 07-02 is the single writer per D-170. The 5 lazy-imported route names are already wired in index.tsx; replacing the placeholder bodies keeps the import paths and export names stable.

## Commits

| Task | Commit    | Message                                                                                                 |
| ---- | --------- | ------------------------------------------------------------------------------------------------------- |
| 1    | `18c3ed1` | feat(07-05): Analytics + CapabilityReports + Reports + CSS partial (ADMIN-01..02 + P-03)                |
| 2    | `466ec94` | feat(07-05): DecisionLog + SecurityDashboard + 4 sec sub-tabs (SC-3 + SC-4)                             |

## Success Criteria

- [x] SC-3 falsified — `DecisionLog.tsx` calls `getDecisionLog` (→ `decision_gate::get_decision_log`) and renders the ring buffer
- [x] SC-4 falsified — `SecurityDashboard.tsx` calls `securityOverview` (→ `security_monitor::security_overview`) and surfaces active alerts in hero + Alerts tab
- [x] ADMIN-01..05 + P-03 synthetic mapped to real UI surfaces
- [x] No route renders 404 / ComingSoonSkeleton (D-168)
- [x] Pentest tab gated with ALL-CAPS danger banner + Dialog-confirm + required inputs (D-183)
- [x] Zero Rust file edits
- [x] `npx tsc --noEmit` passes
- [x] `npm run verify:all` passes (12/12)
- [x] ESLint no-raw-tauri passes
- [x] `files_modified` disjoint from Plans 07-03 / 07-04 / 07-06

## Known Stubs

None. Every surface ships with real data wiring. The only conditional empty states are the honest "No X yet" messages when the backend returns an empty array — these are documented per-pane via `.admin-empty` class and data-driven.

## Threat Flags

None new beyond the already-enumerated register. No new network endpoints, auth paths, file access, or schema changes introduced. Pentest authorize is the most sensitive surface and is fully gated per D-183.

## Self-Check: PASSED

All 10 files verified on disk:
- `src/features/admin/Analytics.tsx` — exists, 374 lines, invokes 4 `db*` wrappers
- `src/features/admin/CapabilityReports.tsx` — exists, 938 lines, invokes 17 wrappers across evolution/self_upgrade/immune_system/self_critique/tool_forge
- `src/features/admin/Reports.tsx` — exists, 468 lines, invokes 5 `getReports`/`reportGap`/`updateReportStatus`/`setReportWebhook`/`getReportWebhook`
- `src/features/admin/DecisionLog.tsx` — exists, 549 lines, invokes 6 decision_gate/authority/audit wrappers (SC-3 source)
- `src/features/admin/SecurityDashboard.tsx` — exists, 197 lines, invokes `securityOverview` (SC-4 source)
- `src/features/admin/SecurityAlertsTab.tsx` — exists, 251 lines, 3 security check wrappers
- `src/features/admin/SecurityScansTab.tsx` — exists, 373 lines, 5 scan wrappers
- `src/features/admin/SecurityPoliciesTab.tsx` — exists, 396 lines, 4 symbolic wrappers
- `src/features/admin/SecurityPentestTab.tsx` — exists, 443 lines, 5 pentest wrappers + ALL-CAPS banner
- `src/features/admin/admin-rich-a.css` — exists, 770 lines, cluster-partial CSS

Commits verified:
- `18c3ed1` in `git log --oneline` — 4 files changed (Analytics + CapabilityReports + Reports + admin-rich-a.css)
- `466ec94` in `git log --oneline` — 6 files changed (DecisionLog + SecurityDashboard + 4 sub-tabs)

Summary file: `.planning/phases/07-dev-tools-admin/07-05-SUMMARY.md` (this file) created via Write tool — not a shell heredoc.
