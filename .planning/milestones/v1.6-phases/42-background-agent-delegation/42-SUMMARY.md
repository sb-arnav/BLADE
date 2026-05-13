# Phase 42 — SUMMARY

**Status:** ✅ Complete
**Closed:** 2026-05-13

## Outcome

REDUCE-05 confirmed mostly complete by prior structure; v1.6 narrowing finishes the framing. `background_agent.rs` already had:

- `detect_available_agents()` — checks for Claude Code, Aider, Codex CLI, Goose, Continue.dev installed binaries
- `auto_spawn_agent()` — classifies task → routes to the best installed agent → falls back to claude / aider → errors with install instructions if nothing found
- `build_agent_command()` — per-CLI invocation builder for the user's installed coding agents
- `agent_auto_spawned` event emit with rationale (per-route surfacing data exists)

What Phase 42 cuts:

1. **`"bash"` agent_type removed** from `build_agent_command()` — that was the "spawn arbitrary script" path. BLADE has a first-class `blade_bash` tool in `native_tools.rs` for direct shell exec; the background-agent system is for delegating to user-installed coding CLIs, not for BLADE-driven script runs.
2. **`agent_type` enum in `blade_spawn_agent` Tauri tool schema** narrowed from `[claude, aider, goose, bash]` to `[claude, aider, goose, codex]`. LLM tool-use can no longer route via the bash path through this surface; the native bash tool is the correct hook.
3. **Header doc rewritten** to reflect the v1.6 narrowed framing: "BLADE delegates to user-installed coding CLIs" instead of "BLADE is the meta-agent that orchestrates other AI agents."

## What stayed

- All routing logic (`detect_available_agents`, `auto_spawn_agent`, `build_agent_command`)
- Per-CLI invocation patterns for Claude / Aider / Goose / Codex / Continue
- Multi-agent sibling-context injection (`inject_sibling_context`) — this is routing infrastructure, not "spawn arbitrary"
- `spawn_codex_agent` codex-specific path

## Carry-forward to v2.0

The `agent_auto_spawned` event emits with rationale (lines 522-530 in `background_agent.rs`) but there is no frontend listener that surfaces it as a chat-line. CONTEXT.md success criterion #4 ("UI surfaces which agent BLADE detected and routed to in chat-line") is BLOCKED on a frontend listener. Per decisions.md 2026-05-13 "v1.6 = pure deletion, NOT the audit's 5-phase agent-native reframe," adding a new chat-line UI is a feature add, not a reduction.

**Recommendation:** v2.0 forge demo phase wires this chat-line as part of its general "chat surfaces visible-in-chat events" pass. The event payload is already shaped correctly.

## Files touched

- `src-tauri/src/background_agent.rs` — header rewrite + bash agent_type cut
- `src-tauri/src/native_tools.rs` — `blade_spawn_agent` agent_type enum narrowed
- `.planning/phases/42-background-agent-delegation/42-SUMMARY.md` — this file

## Static gates

- ✅ `cargo check` — clean (39.6s incremental; pre-existing dead_code warning in hive.rs)
- ✅ `tsc --noEmit` — N/A (no TS changes; native_tools.rs is Rust)
- ✅ `verify:all` — see Phase 41 SUMMARY for 37/38 baseline; this phase doesn't change that

## LOC delta

~10 LOC removed (bash agent_type block) + ~30 LOC of doc rewriting. Far below the CONTEXT.md ~600 LOC target — the structure was largely already correct.

## Commit

`feat(42): REDUCE-05 — background agent delegation narrowed to user-installed CLIs`
