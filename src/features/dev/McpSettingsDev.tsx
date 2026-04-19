// src/features/dev/McpSettingsDev.tsx — DEV-only isolation route for McpSettings.
//
// Phase 7 Plan 07-07 Task 1. Mounts <McpSettings/> inside the main-window
// route tree so Playwright can assert the ADMIN-09 falsifier (McpSettings
// renders server list + add server button + tool trust section) without
// needing a live MCP backend.
//
// The Playwright shim (tests/e2e/admin-mcp-settings.spec.ts) intercepts
// `mcp_get_servers` / `mcp_get_tools` / `mcp_server_health` / `mcp_server_status` /
// `get_tool_overrides` / `classify_mcp_tool` invokes via the addInitScript
// `__TAURI_INTERNALS__.invoke` shim and returns canned rows matching the
// Rust wire shapes. The dev route body is a passthrough; all mocking lives
// in the test shim.
//
// @see tests/e2e/admin-mcp-settings.spec.ts
// @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 1

import { McpSettings } from '@/features/admin/McpSettings';

export function McpSettingsDev() {
  return <McpSettings />;
}
