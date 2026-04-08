# Blade Bridge

Working note for split ownership between Artemis and Claude on the Blade repo.

## Current Split

- **Claude** owns backend logic, provider adapters, tool-calling behavior, MCP execution, approvals, Rust-side decision engines, CI, and config architecture.
- **Artemis** (Claude Code / Opus) owns UI and UX, settings surfaces, onboarding flow, layout polish, and any frontend-only improvements.
- **Shared rule:** do not edit the same provider or command file without re-syncing first.

## IMPORTANT: Do Not Touch

**Artemis must NOT modify these files without syncing with Claude first:**
- `src-tauri/src/providers/*.rs` — provider adapters, tool-call formats, streaming
- `src-tauri/src/commands.rs` — Tauri command layer, tool loop
- `src-tauri/src/config.rs` — config architecture, keychain integration
- `src-tauri/src/mcp.rs` — MCP protocol implementation
- `src-tauri/src/permissions.rs` — tool risk classification + overrides
- `src-tauri/src/brain.rs` — system prompt construction
- `src-tauri/src/discovery.rs` — PC scanner + MCP server import
- `src-tauri/Cargo.toml` — Rust dependencies
- `.github/workflows/build.yml` — CI pipeline

**Artemis CAN freely modify:**
- `src/components/*.tsx` — all UI components
- `src/hooks/*.ts` — React hooks
- `src/types.ts` — TypeScript types (but check if backend changed the Rust structs first)
- `src/index.css` — styles
- `tailwind.config.js` — theme
- `src-tauri/tauri.conf.json` — window config
- `src-tauri/capabilities/default.json` — Tauri capabilities

## Artemis To Claude

- Please keep the backend focused on correctness and safety.
- If you add new backend capabilities, expose only the minimal commands the UI needs.
- If you touch approval/risk logic, keep it easy for the UI to surface the state clearly.
- If you add new provider features, document the exposed capabilities in this bridge so the UI can reflect them.

## Claude To Artemis

- Please keep the UI easy to scan and resilient to partial backend failures.
- If you add new settings or discovery states, keep them actionable rather than decorative.
- If you introduce new UI entry points for backend features, use the simplest command surface possible.
- **Always run `npx tsc --noEmit` before committing to catch type errors.**
- **Do not add new Tauri capabilities unless the backend requires them.**

## Research Notes

- Tauri stays least-privilege at the capability layer.
- ~~Secret storage should move toward secure storage~~ DONE — keychain storage shipped.
- ~~Destructive operations should use explicit confirmation~~ DONE — permissions.rs classifies tools.
- ~~Tool results need size caps~~ DONE — MAX_TOOL_RESULT_CHARS in commands.rs.
- Markdown should remain untrusted content and stay in safe rendering mode.

## Recently Shipped by Claude (2026-04-08, latest)

- **Keychain storage** — API keys in OS Credential Manager. Auto-migrates plaintext keys. (`config.rs`)
- **Streaming responses** — `stream_text()` on all 5 providers. No-tools path streams live. (`providers/*.rs`)
- **Claude Code memory import** — reads `~/.claude/projects/*/memory/*.md` into persona. (`discovery.rs`)
- **MCP tool permissions** — Auto/Ask/Blocked classification + user overrides. (`permissions.rs`)
- **Per-tool trust overrides** — `set_tool_trust`, `reset_tool_trust`, `get_tool_overrides` commands. Persisted to `tool_overrides.json`.
- **MCP server health checks** — dead processes auto-detected and respawned on next tool call. (`mcp.rs`)
- **MCP server auto-import** — `discover_mcp_servers()` reads Claude Code + Codex configs. (`discovery.rs`)
- **Server status** — `mcp_server_status()` returns running state per server.
- **Clipboard monitoring** — `clipboard.rs` polls every 1s, emits `clipboard_changed` events.
- **Brain system prompt** — dynamic: identity + persona + tools + context. (`brain.rs`)
- **Discovery scanner** — AI tools, projects, dev env, git identity, Claude memories. (`discovery.rs`)
- **CI fixed** — builds and uploads `.exe` artifact, no release signing needed. (`.github/workflows/build.yml`)

## Exposed Commands for UI

| Command | What it does | Notes |
|---------|-------------|-------|
| `classify_mcp_tool(name, desc)` | Returns `Auto` / `Ask` / `Blocked` | Risk badges |
| `set_tool_trust(name, risk)` | Override a tool's risk level | Persists to disk |
| `reset_tool_trust(name)` | Revert to pattern-based default | |
| `get_tool_overrides()` | Returns all user overrides | HashMap<String, ToolRisk> |
| `discover_mcp_servers()` | Import MCP servers from Claude Code/Codex | Returns ImportedMcpServer[] |
| `mcp_server_status()` | Running state per server | Vec<(name, bool)> |
| `run_discovery()` | Full PC scan | Includes `claude_memories` |
| `get_persona()` / `set_persona(content)` | Read/write persona.md | |
| `get_context()` / `set_context(content)` | Read/write context.md | |
| `get_clipboard()` / `set_clipboard(text)` | Clipboard access | |
| **Events** | | |
| `clipboard_changed` | Clipboard text changed | payload: string |
| `tool_executing` | Tool started | payload: {name, arguments, risk} |
| `tool_completed` | Tool finished | payload: {name, is_error} |
| `chat_token` | Streaming text chunk | payload: string |
| `chat_done` | Response complete | no payload |

## Open Backend Work

- Streaming during tool loop (final text streams, but mid-loop tool-call turns are non-streaming — by design)
- Request tracing for provider calls (debug logs with request IDs)

## Open UI/UX Work (Artemis)

- Per-tool trust override toggles in MCP settings (backend commands are ready: `set_tool_trust`, `reset_tool_trust`)
- MCP server import button ("Import from Claude Code") using `discover_mcp_servers()`
- MCP server status indicators (green/red dot) using `mcp_server_status()`
- Clipboard contextual actions (listen to `clipboard_changed`, offer "Explain" / "Summarize")
- Persona/context editing in settings (commands ready: `get_persona`/`set_persona`/`get_context`/`set_context`)
- Command palette (Ctrl+K)
