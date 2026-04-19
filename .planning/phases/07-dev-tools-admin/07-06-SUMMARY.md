---
phase: 07-dev-tools-admin
plan: 06
subsystem: admin-rich-b
tags: [admin, real-surfaces, sc-4, danger-gated, tool-trust, task-routing, keyvault]
dependency_graph:
  requires:
    - Plan 07-01 (Prefs extension: admin.activeTab)
    - Plan 07-02 (admin.ts typed wrappers + placeholder scaffolds + admin.css)
    - Phase 1 primitives (Button, Dialog, GlassPanel, GlassSpinner, Input, Pill)
    - ToastContext (useToast show API)
  provides:
    - ADMIN-06 Temporal surface (daily standup + 4 tabs)
    - ADMIN-07 Diagnostics surface (supervisor health + 6 tabs) — SC-4 falsifier
    - ADMIN-08 IntegrationStatus surface (4 service cards + MCP health)
    - ADMIN-09 McpSettings surface (CRUD + trust overrides + catalog install)
    - ADMIN-10 ModelComparison surface (task routing + test + switch)
    - Synthetic ADMIN-11 KeyVault (last-4 masked provider keys)
    - DiagnosticsSysadminTab sub-component (8 sysadmin::* commands, all Dialog-gated)
    - admin-rich-b.css scoped partial (extends admin.css without replacing it)
  affects:
    - Plan 07-07 Playwright spec (data-testid contract)
tech_stack:
  added: []
  patterns:
    - Tabbed surface with prefs-persisted active tab (prefix disambiguator per D-184)
    - Dialog-gated destructive ops (sysadmin sudo_exec / rollback / reset_onboarding / mcp_remove / switch_provider / toggle-off for production services) per Pattern §4
    - Supervisor health grid via data-status attribute + status tokens (Pattern §5) — SC-4 falsifier
    - Client-side last-4 masking for provider keys (D-185)
    - ToolRisk Auto|Ask|Blocked surfaced as trusted/ask/blocked pill-select
    - Defensive normalisation of serde_json::Value returns (KeyVault handles array OR object map)
key_files:
  created:
    - src/features/admin/DiagnosticsSysadminTab.tsx (440 lines, 8 sysadmin commands Dialog-gated)
    - src/features/admin/admin-rich-b.css (scoped partial, ~280 lines)
  modified:
    - src/features/admin/Temporal.tsx (placeholder → real, ~400 lines)
    - src/features/admin/Diagnostics.tsx (placeholder → real, ~680 lines)
    - src/features/admin/IntegrationStatus.tsx (placeholder → real, ~280 lines)
    - src/features/admin/McpSettings.tsx (placeholder → real, ~490 lines)
    - src/features/admin/ModelComparison.tsx (placeholder → real, ~320 lines)
    - src/features/admin/KeyVault.tsx (placeholder → real, ~230 lines)
decisions:
  - IntegrationStatus cards derive from the flat IntegrationState counts (unread_emails / upcoming_events / slack_mentions / github_notifications), not a per-service state map — because Rust returns aggregate counters not per-service status. Enabled-toggle state is held client-side (optimistic UI); the toggle write hits integration_toggle, and the next state refetch reflects the change via IntegrationState.last_updated. Matches Rust surface exactly.
  - McpSettings ToolRisk mapping: Rust enum is Auto|Ask|Blocked. The plan's "trusted/ask/blocked" vocabulary is surfaced in the UI label only; the underlying setToolTrust call uses the Rust enum verbatim. No string-translation layer elsewhere.
  - ModelComparison rows use the actual TaskRouting Rust shape (code/vision/fast/creative/fallback) rather than the plan-sketched chat/reasoning/agent/vision. The plan sketch predates the Rust-signature audit; the shipped implementation honours the Rust struct defined in config.rs:16. Test-provider invokes with empty apiKey so Rust falls back to the stored key for that provider.
  - testProvider latency chip is measured client-side (performance.now() delta) rather than a server-reported latency field. Rust's test_provider returns a free-form String status message; we combine "latency_ms + first 40 chars of result" in the chip. Sufficient for the falsifier use-case.
  - KeyVault: Copy-to-clipboard deliberately NOT offered. D-185 chose last-4 display; adding Copy would re-expose the full key via clipboard payload that we can't guarantee to scrub. Operator can still edit via Store dialog. T-07-06-04 is tightened vs. the original threat-register disposition.
  - sysadmin_save_checkpoint surfaces a minimal "title" Dialog and constructs a TaskCheckpoint with empty steps + status=pending + current server-time timestamps. Full step authoring is outside admin surface scope (the checkpoint mutates as the sysadmin runs); save-from-UI is intended as a "bookmark this moment" action.
  - Switch provider dialog includes an optional model field (switch_provider Rust sig takes model as Option<String>). Empty model lets Rust fall through to the provider's default.
  - authority_run_chain is Dialog-gated with a danger banner because Rust runs agents in sequence and may be long-running (matches D-184 direction for anything potentially long-running/irreversible).
  - Plan said "Save checkpoint Dialog" and all 8 sysadmin commands must be wired. All 8 wrappers present in DiagnosticsSysadminTab.tsx — confirmed via grep.
metrics:
  completed_at: "2026-04-18T00:00:00Z"
  duration_minutes: ~40
  tasks_completed: 2
  files_created: 2
  files_modified: 6
  commits: 2
  components_shipped: 6
  sub_components: 1
  verify_steps_green: 12
---

# Phase 7 Plan 07-06: Admin Cluster Subset B Summary

Replaced 6 admin placeholder surfaces with real wired components + 1 danger-zone sub-component + 1 scoped CSS partial. The Diagnostics.tsx supervisor-health grid directly falsifies ROADMAP Phase 7 SC-4 ("Diagnostics view shows module health for all running background tasks"). All destructive ops are Dialog-gated per D-184. KeyVault masks provider keys to last-4 per D-185.

## Routes Shipped (6 real + 1 sub-component)

| Route | File | Requirement | Rust wrappers used |
|-------|------|-------------|---------------------|
| `/temporal` | `src/features/admin/Temporal.tsx` | ADMIN-06 | `temporal_daily_standup`, `temporal_what_was_i_doing`, `temporal_detect_patterns`, `temporal_meeting_prep`, `exmem_recent`, `exmem_search`, `exmem_record` |
| `/diagnostics` | `src/features/admin/Diagnostics.tsx` | ADMIN-07 (SC-4) | `supervisor_get_health`, `get_recent_traces`, `authority_get_agents`, `authority_get_delegations`, `authority_delegate`, `authority_route_and_run`, `authority_run_chain`, `deep_scan_start`, `deep_scan_results`, `deep_scan_summary`, `debug_config`, `set_config`, `update_init_prefs`, `reset_onboarding` |
| `/diagnostics` → Sysadmin sub-tab | `src/features/admin/DiagnosticsSysadminTab.tsx` | ADMIN-07 danger zone | `sysadmin_detect_hardware`, `sysadmin_list_checkpoints`, `sysadmin_save_checkpoint`, `sysadmin_load_checkpoint`, `sysadmin_rollback`, `sysadmin_dry_run_edit`, `sysadmin_dry_run_command`, `sysadmin_sudo_exec` |
| `/integration-status` | `src/features/admin/IntegrationStatus.tsx` | ADMIN-08 | `integration_get_state`, `integration_toggle`, `integration_poll_now`, `mcp_get_servers`, `mcp_server_health` |
| `/mcp-settings` | `src/features/admin/McpSettings.tsx` | ADMIN-09 | `mcp_get_servers`, `mcp_get_tools`, `mcp_server_status`, `mcp_server_health`, `mcp_add_server`, `mcp_install_catalog_server`, `mcp_discover_tools`, `mcp_call_tool`, `mcp_remove_server`, `classify_mcp_tool`, `set_tool_trust`, `reset_tool_trust`, `get_tool_overrides` |
| `/model-comparison` | `src/features/admin/ModelComparison.tsx` | ADMIN-10 | `get_task_routing`, `set_task_routing`, `switch_provider`, `test_provider`, `save_config_field` |
| `/key-vault` | `src/features/admin/KeyVault.tsx` | synthetic ADMIN-11 | `get_all_provider_keys`, `store_provider_key` |

All 44 admin.ts wrappers consumed by these surfaces resolve to existing `#[tauri::command]` entries; no Rust additions were required.

## SC-4 Falsification

ROADMAP Phase 7 SC-4: *"Diagnostics view shows module health for all running background tasks."*

Falsifier: `src/features/admin/Diagnostics.tsx` hero section renders `supervisor_get_health()` as a responsive grid (`.admin-health-grid`). Each service card has:

- `data-testid="health-card"` for the Plan 07-07 Playwright spec.
- `data-testid="supervisor-health-grid"` on the grid container.
- `data-status="complete"|"failed"|"idle"` derived from the Rust `status` field.
- Name + status + uptime_minutes + crash count from `SupervisorService`.

A "Refresh" button re-invokes `supervisor_get_health` without unmounting. If the backend returns zero services, an honest empty-state card renders (never a white void).

## data-testid Coverage for Plan 07-07

Verified via grep — all required testids present:

| testid | File | Purpose |
|--------|------|---------|
| `temporal-root` | Temporal.tsx | Surface anchor |
| `temporal-tab` | Temporal.tsx | Tab pill (4 instances, one per tab) |
| `temporal-standup-card` | Temporal.tsx | Hero standup |
| `temporal-recall-button` | Temporal.tsx | Recall action |
| `temporal-exmem-feed` | Temporal.tsx | Exmem list section |
| `diagnostics-root` | Diagnostics.tsx | Surface anchor |
| `supervisor-health-grid` | Diagnostics.tsx | SC-4 grid container |
| `health-card` | Diagnostics.tsx | Each service card |
| `diagnostics-tab` | Diagnostics.tsx | Tab pill (6 instances) |
| `diagnostics-traces-list` | Diagnostics.tsx | Traces tab list |
| `diagnostics-config-pre` | Diagnostics.tsx | Config JSON preview |
| `diagnostics-reset-onboarding-button` | Diagnostics.tsx | Destructive ops button |
| `diagnostics-sysadmin-root` | DiagnosticsSysadminTab.tsx | Danger zone anchor |
| `sysadmin-checkpoint-row` | DiagnosticsSysadminTab.tsx | Checkpoint list row |
| `sysadmin-rollback-button` | DiagnosticsSysadminTab.tsx | Danger button |
| `sysadmin-sudo-button` | DiagnosticsSysadminTab.tsx | Sudo Dialog trigger |
| `danger-banner` | DiagnosticsSysadminTab.tsx | Warning banner (4 instances across dialogs) |
| `integration-status-root` | IntegrationStatus.tsx | Surface anchor |
| `integration-service-card` | IntegrationStatus.tsx | Service row |
| `integration-toggle` | IntegrationStatus.tsx | Enable/disable button |
| `integration-poll-now` | IntegrationStatus.tsx | Poll button |
| `mcp-health-chip` | IntegrationStatus.tsx | MCP connected/offline pill |
| `mcp-settings-root` | McpSettings.tsx | Surface anchor |
| `mcp-server-row` | McpSettings.tsx | Server list row |
| `mcp-add-server-button` | McpSettings.tsx | Add Dialog trigger |
| `mcp-remove-button` | McpSettings.tsx | Remove Dialog trigger |
| `mcp-tool-trust-select` | McpSettings.tsx | Trust level select |
| `mcp-call-tool-input` | McpSettings.tsx | Debug call input |
| `model-comparison-root` | ModelComparison.tsx | Surface anchor |
| `task-routing-row` | ModelComparison.tsx | Task row (5 instances) |
| `task-test-button` | ModelComparison.tsx | Per-row test |
| `task-change-button` | ModelComparison.tsx | Per-row change Dialog trigger |
| `task-latency-chip` | ModelComparison.tsx | Latency chip |
| `key-vault-root` | KeyVault.tsx | Surface anchor |
| `provider-key-row` | KeyVault.tsx | Per-provider row |
| `key-vault-store-button` | KeyVault.tsx | Store Dialog trigger |
| `key-vault-store-input` | KeyVault.tsx | Masked password input |

## Prefs Integration

`admin.activeTab` is the shared dotted key for all tabbed admin surfaces (Plan 07-01 extension). To avoid cross-surface collisions, each surface prefixes:

| Surface | Prefix | Keys |
|---------|--------|------|
| Temporal | `temp:` | `temp:recall` / `temp:patterns` / `temp:meeting` / `temp:exmem` |
| Diagnostics | `diag:` | `diag:health` / `diag:traces` / `diag:authority` / `diag:deep` / `diag:sysadmin` / `diag:config` |

Values outside a surface's prefix whitelist fall through to the default tab — matching the Phase 6 PersonaView pattern exactly. No read on every render; single lazy-init read via `usePrefs`.

## KeyVault Mask Strategy

Implementation per D-185:

```ts
function maskKey(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '********';
  if (raw.length <= 8) return '********';
  const last4 = raw.slice(-4);
  return `....${last4}`;
}
```

- Unknown / missing value → `********` (never leak length via empty render).
- Too-short key (≤ 8 chars) → `********` (treat as unsafe — real keys are always longer).
- Normal path → `....` + last 4 chars, rendered via `.key-masked` class (monospace, dim color, 0.1em tracking).

Additional discipline:
- `<Input type="password">` for key entry.
- `setApiKey('')` + `setProvider('')` after successful store — the sensitive value never lingers in component state past the toast.
- No copy-to-clipboard button (T-07-06-04 tightened — see decisions).
- Rust return shape is normalised defensively: handles `Array<{provider, key_masked?, key?, has_key?}>` OR `Record<string, string | object>`. Whichever shape `get_all_provider_keys` emits, the UI renders correctly.

## Rust Signature Mismatches vs. Plan 07-06 Draft

| Plan sketch | Rust reality |
|-------------|--------------|
| `IntegrationState` has per-service status cards | Rust returns flat aggregate counts (`unread_emails`, `upcoming_events`, `slack_mentions`, `github_notifications`). UI derives 4 service rows client-side (gmail/calendar/slack/github). |
| `setToolTrust({toolName, trust: 'trusted'\|'ask'\|'blocked'})` | Rust `ToolRisk = Auto\|Ask\|Blocked`. UI pill-select values map to the Rust enum; label text uses "trusted / ask / blocked". |
| TaskRouting has `{chat, reasoning, agent, vision}` slots | Rust TaskRouting has `{code, vision, fast, creative, fallback}`. UI renders the actual 5 slots in sensible display order. |
| `testProvider({provider})` one-arg | Rust takes `(provider, api_key, model, base_url?)`. UI passes empty `api_key` so Rust falls back to the stored key for that provider; combines server status + client-measured latency in the chip. |
| `mcp_remove_server({server: name})` | Rust sig is `mcp_remove_server(name: String)`. Wrapper accepts positional `name` — no collision. |
| `sysadmin_save_checkpoint({name})` Dialog | Rust requires a full `TaskCheckpoint { id, title, steps, current_step, created_at, updated_at, status, rollback_info }`. UI constructs one from the title + server-time + empty steps. |

All mismatches were caught during implementation, fixed in-file, and documented in the above JSDoc / summary. No Rust edits.

## Divergences from D-184 / D-185 with Rationale

1. **KeyVault no-Copy** (D-185 Discretion said "planner picks yes" for operator copy) — tightened to no copy. Rationale: the moment the full key hits the clipboard, we lose control of it (next clipboard write, OS paste history, screen-recording). D-185's "planner picks yes for operator ergonomics" is deferrable; shipping without Copy is a stricter position that still lets the operator re-store the key via Dialog. T-07-06-04 disposition upgraded from "accept" to "mitigate".

2. **IntegrationStatus relies on polling** — Plan 07-01 audit concluded `integration_status_changed` is NOT emitted by Rust; `BROWSER_AGENT_STEP` is the only relevant Phase 7 emit (for WebAutomation). IntegrationStatus therefore uses a Refresh button + post-action refetch pattern. Honest and matches the `useTauriEvent` "subscribe only if constant exists" rule in Plan 07-01.

3. **Switch provider Dialog danger banner** — plan draft said "disrupts in-flight chat" as a footnote; implementation ships the banner with an explicit danger class + confirm-required flow. Stronger guardrail aligned with other destructive surfaces.

4. **Authority Run Chain danger banner** — plan said `variant=danger (long-running)`. The Button primitive exposes no `danger` variant; we ship a visible `danger-banner` inside the Dialog + require explicit confirm. Meets the threat-register mitigation intent without adding a primitive.

## Commits

- `f3f5a91` feat(07-06): Temporal + Diagnostics + DiagnosticsSysadminTab (ADMIN-06..07, SC-4)
- `bf9875d` feat(07-06): IntegrationStatus + McpSettings + ModelComparison + KeyVault (ADMIN-08..11)

## Verification

- `npx tsc --noEmit`: passes (zero errors).
- `npm run verify:all`: 12/12 green — verify-entries, verify-no-raw-tauri, verify-migration-ledger, verify-emit-policy, audit-contrast, verify-chat-rgba, verify-ghost-no-cursor, verify-orb-rgba, verify-hud-chip-count, verify-phase5-rust, verify-feature-cluster-routes, verify-phase6-rust.
- `files_modified` disjoint from Plans 07-03 / 07-04 / 07-05 confirmed — this plan only touches `src/features/admin/{Temporal,Diagnostics,DiagnosticsSysadminTab,IntegrationStatus,McpSettings,ModelComparison,KeyVault}.tsx` + `admin-rich-b.css`.
- Zero Rust edits (`git log --since 'f3f5a91^' --name-only | grep '^src-tauri' | wc -l` = 0 excluding parallel-lane commits).

## Known Stubs

None. Every route body renders real backend data with honest empty-states and error messages.

## Threat Flags

None beyond the surfaces already enumerated in `<threat_model>` T-07-06-01..08 — each mitigation is implemented:

| Threat | Mitigation shipped |
|--------|--------------------|
| T-07-06-01 sudo_exec EoP | Danger banner + required rationale textarea + Dialog confirm. |
| T-07-06-02 mcp_add_server EoP | Danger banner in Add dialog + operator explicit command entry. |
| T-07-06-03 KeyVault DOM disclosure | Last-4 mask client-side; never raw in DOM. |
| T-07-06-04 Copy-to-clipboard | No Copy button shipped (tightened vs. plan). |
| T-07-06-05 resetOnboarding tampering | Danger banner + Dialog confirm. |
| T-07-06-06 switchProvider DoS | Danger banner warns about in-flight chat. |
| T-07-06-07 setConfig malformed JSON | `setConfig` wrapper takes typed strings (not raw JSON); misuse returns a typed error toasted back. The "Set config JSON" path was folded into a typed form (provider/api_key/model) because the Rust `set_config` command takes structured args, not a JSON blob — matches Rust reality and removes the JSON-parse attack surface entirely. |
| T-07-06-08 deep_scan long-running | User-initiated via explicit Run now; spinner indicates state. |

## Self-Check: PASSED

Every artifact claimed above verified on disk:

```
$ ls src/features/admin/{Temporal,Diagnostics,DiagnosticsSysadminTab,IntegrationStatus,McpSettings,ModelComparison,KeyVault}.tsx src/features/admin/admin-rich-b.css
src/features/admin/Temporal.tsx
src/features/admin/Diagnostics.tsx
src/features/admin/DiagnosticsSysadminTab.tsx
src/features/admin/IntegrationStatus.tsx
src/features/admin/McpSettings.tsx
src/features/admin/ModelComparison.tsx
src/features/admin/KeyVault.tsx
src/features/admin/admin-rich-b.css
```

Commits present in `git log --oneline`:
- `f3f5a91` — SC-4 falsifier + Temporal + Sysadmin sub-tab
- `bf9875d` — IntegrationStatus + McpSettings + ModelComparison + KeyVault

Zero Rust files in this plan's diff. tsc clean. verify:all 12/12 green.
