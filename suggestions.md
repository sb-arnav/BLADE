# Blade Suggestions

Reviewed on 2026-04-08 UTC while provider/tool-call work was in progress.

## Active Split

- Claude: provider adapters, tool-call correctness, provider-specific streaming/tool-use edge cases, request tracing inside provider clients.
- Codex: settings/productivity surface, security hardening outside provider adapters, persona/context UX, approval-model foundations, and repo-local documentation.
- Shared caution: avoid editing the same provider files in parallel unless re-synced first.

## Highest Priority

- Move provider API keys out of `config.json` into OS-backed secure storage. Current local file permissions help, but plaintext config is still the biggest avoidable secret risk.
- Add approval gates for dangerous MCP tools. Read-only tools can auto-run, but file writes, shell execution, outbound network actions, and destructive operations should require explicit confirmation.
- Add tool-call audit UI. Show tool name, argument summary, result summary, duration, and whether the action was user-approved.
- Keep tightening provider-specific tool-call adapters. Gemini needs extra care around conversation history handling, and each provider has slightly different tool-call/result formats.
- Add request tracing for provider calls. Capture provider request IDs and include them in debug logs for failed requests.

## Security

- Keep Tauri capabilities least-privilege. Remove broad permissions the webview does not need and scope future permissions to exact windows/commands.
- Prefer Tauri `stronghold` for secret storage rather than extending plaintext config. Research direction: secure storage should be the next backend security slice.
- Use Tauri dialog/confirmation flows for destructive tool approvals instead of hand-rolled prompt parsing.
- Validate MCP server registration before saving. At minimum: show exact binary path and args, warn on relative paths, and consider a trust prompt for first run.
- Add timeouts, output truncation, and size caps for MCP tool results before they hit the chat UI or get fed back to the model.
- Treat markdown as untrusted content. Keep `react-markdown` in safe mode, avoid raw HTML, and be careful with custom URL handling or future plugins.
- Consider per-tool trust levels such as `auto`, `ask`, and `blocked`.

## Reliability

- Persist tool execution events in conversation history so debugging past runs is possible.
- Add recovery around corrupted conversation files instead of failing the whole history list.
- Debounce history writes to reduce disk churn during active chat sessions.
- Add a visible state for “tool loop running” so the user can distinguish model thinking from tool execution.

## Product Ideas

- Add a provider capability matrix in settings showing chat, tools, streaming, and local-model support.
- Expose persona/context editing in the UI since the backend already has a brain module.
- Add background jobs for long-running MCP actions so the main chat loop stays responsive.
- Add a searchable command palette for conversations, settings, and tools.
- Show a small “diagnostics” block in settings with provider name, model, conversation mode, and request tracing status.
