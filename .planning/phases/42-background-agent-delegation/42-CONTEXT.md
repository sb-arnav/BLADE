# Phase 42 — Background Agent Delegation

**Milestone:** v1.6 — Narrowing Pass
**Status:** Pending
**Requirements:** REDUCE-05
**Goal:** Rip BLADE's "spawn arbitrary agents" code in `background_agent.rs` (~728 LOC). Replace with detection: which agent stacks does the user have installed (Claude Code, Cursor, Goose, Aider)? Route code work to the detected agent. BLADE itself stops spawning workers.

## Background (from V2-AUTONOMOUS-HANDOFF.md §0)

> *"Background Agent Spawning → delegate to user's Claude Code / Cursor / Goose. Rip BLADE's 'spawn arbitrary agents' code. BLADE detects what the user has and routes code work there."*

This aligns with the v2.0 hunt pre-scan (Act 1 in `.planning/v2.0-onboarding-spec.md`) which already detects `which claude`, `which cursor`, `which goose`, `which ollama`, etc. The detection layer used by hunt onboarding is the same detection layer this phase wires into the chat code-task path.

## Approach

### Rip

- `background_agent.rs` (~728 LOC) — anywhere BLADE spawns a "worker agent" with its own context window, its own provider, its own tool set, etc. (subtly different from v1.5 swarm — swarm spawns sub-agents for parallel decomposition within a single conversation; background_agent was a separate construct for long-running code work)
- Tauri commands that surface arbitrary-agent spawning to the chat (`spawn_background_agent`, `kill_background_agent`, etc.)
- UI surfaces that listed running background agents (if any survive)

### Keep / Don't touch

- **v1.5 swarm (`swarm.rs` + `swarm_commands.rs` + `swarm_planner.rs`)** — DECOMP-01..05 shipped. Different construct. Don't touch.
- **Skills v2 / Voyager forge** — v1.3 shipped. Skills execute in BLADE itself, not as separate spawned agents. Untouched.

### Add — detection + routing

- New (small) module: `agent_detector.rs` or extend an existing scan module to expose `detect_installed_agents() -> Vec<DetectedAgent>` returning `{ name: "claude-code"|"cursor"|"goose"|"aider", path: PathBuf, version: Option<String> }`
- New Tauri command `route_code_task_to_user_agent(task: String) -> RouteOutcome` that picks the detected agent and shells out to it (e.g., `claude code-task "..."`) or returns `NoAgentDetected` if none present
- Brain.rs system-prompt addition: when chat detects a code task and `detect_installed_agents()` is non-empty, BLADE proposes to route ("I'll hand this to Claude Code — that's what you have installed for code work")
- Chat-line surfacing: detection result is visible in the activity strip and in the response

### Fallback

If no agent is installed, BLADE handles inline using its existing chat + tools. Per VISION + handoff: don't reintroduce the spawn-arbitrary-agents code as fallback — just stay in the BLADE conversation.

## Risks

1. **Existing call sites for spawned agents.** Grep `lib.rs`, `commands.rs`, `chat-pipeline.rs` for `background_agent::` or `spawn_agent`. Each must be replaced with the new detection-and-route path or removed.
2. **A v1.4 / v1.5 phase may have wired background_agent into an evaluation harness.** If so, the eval test fails when the module disappears. Update the harness to route through the new path (or delete the eval if it was testing the cut behavior).
3. **WSL-on-Windows agent detection.** Per `platform_paths.md` (handoff §4 v2.0 onboarding spec): a Windows user's installed Claude Code may live inside WSL. `which claude` from PowerShell returns nothing. Detection logic should match the hunt's behavior — but this phase doesn't have to fully replicate the hunt; basic `which` is sufficient as a v1.6 floor, the hunt-quality detection lands in v2.0.

## Success criteria

- [ ] `background_agent.rs` spawn-arbitrary code removed (~600 LOC reduction target)
- [ ] `agent_detector` exposes `detect_installed_agents()` returning installed Claude Code / Cursor / Goose / Aider
- [ ] Chat code-task path routes to detected agent via shell invocation
- [ ] If no agent detected, BLADE handles inline (no spawn-arbitrary fallback)
- [ ] UI surfaces which agent (or none) BLADE detected and routed to in a chat-line
- [ ] `verify:all` ≥36/38
- [ ] cargo check clean; tsc --noEmit clean
- [ ] Chat smoke test passes
