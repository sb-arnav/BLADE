# Phase 47 — One Forge Wire

**Milestone:** v2.0 — Setup-as-Conversation + Forge Demo
**Status:** Pending
**Requirements:** FORGE-01..03
**Goal:** The forge primitive (v1.3 substrate: `evolution.rs` → `autoskills.rs` → `tool_forge.rs`) fires visibly on one real capability gap end-to-end against a real LLM. **This is the Twitter-video moment per VISION:40.**

## Background

The forge substrate shipped 2026-05-02 (v1.3 Phase 22) with one deterministic fixture (`youtube_transcript`) but has not fired on a real capability gap in lived chat in 11+ days. Per `.planning/decisions.md` 2026-05-13 entry "v1.4 + v1.5 shipped runtime infrastructure that does not trace to VISION's primitives": forge is the structurally-unshippable-by-Anthropic/OpenAI/Google feature. Phase 47 makes it fire.

Per V2-AUTONOMOUS-HANDOFF.md §0:
> "Pick one gap a power user actually hits, wire forge to fire visibly in chat (chat-line: *'capability gap detected → writing tool → testing → registered → retrying'*), make it work end-to-end against a real LLM. **This is the Twitter-video moment per VISION:40.**"

## Approach

### Pick the gap (FORGE-01)

Candidates by feasibility:

1. **YouTube transcript fetch + summarize** — Substrate already has the `youtube_transcript` fixture. Adapting it to fire on a real user request like "what did Karpathy say in his latest video" makes the demo immediately concrete. Concern: the fixture is already-known; demo may feel scripted.

2. **Scrape a Notion page** — Common power-user need (Notion API is gated; users without API tokens hit a wall). Forge can write a tool that uses `playwright` + the user's logged-in Notion session in their default browser.

3. **Extract structured data from a Twitter/X thread** — Twitter API changes broke many existing tools. A forge-written scraper that adapts on the fly is high-signal.

4. **Pull a paywalled PDF from a URL the user is logged into** — feels like JARVIS. High wow factor but content-policy edge cases (don't write tools that bypass paywalls; write tools that use the user's logged-in session per their existing access).

**Recommended:** #3 (Twitter/X thread extraction). Most demonstrably "shipped/broken/forged in chat." Discuss in `47-DISCUSS.md` if dispatched-agent wants to pick differently.

### Wire forge to fire visibly

Current state: `evolution.rs → autoskills.rs → tool_forge.rs` runs the loop but emits to logs, not to chat. Phase 47 adds chat-line emissions at each transition:

```rust
// In tool_forge.rs (or wherever the forge loop lives)
emit_chat_line(app, "capability gap detected: {gap}");
// ... LLM writes the tool ...
emit_chat_line(app, "writing tool: {tool_name}");
// ... compile + test ...
emit_chat_line(app, "testing: {test_name}");
// ... register in tool catalog ...
emit_chat_line(app, "registered: {tool_name}");
// ... retry original request ...
emit_chat_line(app, "retrying original request");
```

Each emission is a separate Tauri event consumed by `src/features/chat/ChatWindow.tsx` (existing chat shell). They render as system-level chat lines, visually distinct from user/assistant messages.

### End-to-end against a real LLM (FORGE-03)

The existing `youtube_transcript` fixture uses a scripted provider. Phase 47 ALSO runs against a real Anthropic/OpenAI LLM:

- User sends message that triggers the gap (e.g., "Get me the action items from https://x.com/...")
- BLADE's tool loop has no matching tool → triggers forge
- Forge prompts the LLM with the gap description + existing tool registry → LLM writes a new tool
- BLADE compiles + tests the tool (sandboxed)
- On test pass, registers in the tool catalog
- Retries the user's original request — now the new tool is available

Use the autonomy hunt's `~/.blade/who-you-are.md` for the user's core command context so forge knows what to prioritize.

### Pre-check before forge fires (risk mitigation)

Per ROADMAP Risk Register: forge should NOT fire if an existing tool / MCP server can handle the request. Add `pre_check_existing_tools(gap)` that searches the tool catalog + MCP registry; only fire forge if no match.

## Risks

1. **Forge writes a tool that doesn't work on first try.** v1.3 substrate has retry-on-test-fail; verify the loop completes within 3 iterations. If still failing after 3, emit `emit_chat_line(app, "capability gap is structural — not tool-shaped: {reason}")` and surface to the user.
2. **The chosen gap turns out to have an existing solution** — forge fires when it shouldn't. Mitigation: `pre_check_existing_tools` above.
3. **Real LLM cost on each demo** — recordable but not cheap. Budget: ~$0.50 per full demo loop. Verify by tracking the LLM call costs in chat (same as Phase 46 hunt cost surfacing).
4. **Forge demo video is "the moat" per VISION:40 — if the demo flops, the moat narrative needs revision.** Per decisions.md falsification: "Forge-demo phase shipped successfully and the video did NOT generate any external interest (zero shares / comments / forks / sign-ups). → the forge moment isn't the moat I claimed. Vision needs re-examination."

## Success criteria

Per ROADMAP.md:
- One real capability gap chosen (locked in this CONTEXT.md or `47-DISCUSS.md` before plans)
- Forge fires chat-line emissions in 4-5 phases (gap detected, writing, testing, registered, retrying)
- End-to-end against a real LLM works
- 30-second screen recording captures the full loop visibly
- cargo + tsc clean; verify:all ≥36/38

## Out of scope

- Tuning forge's tool-writing prompt for production quality across many gaps (v2.0 ships ONE gap end-to-end; multi-gap robustness is v2.1+)
- Frontend redesign of chat-line styling beyond the minimum needed for the demo
- Adding new substrate primitives — the v1.3 forge substrate is the substrate; Phase 47 is integration

## Gap chosen

**Locked: HackerNews top-N stories extraction (candidate #3 in Approach).**

### Decision (FORGE-01)

Switched from the originally-recommended Twitter/X thread extraction to HackerNews top-N stories for three reasons:

1. **No existing tool covers it.** Verified via `grep -rn "hackernews\|hacker.news" src-tauri/src/` — zero hits in the tool catalog (`native_tools.rs`), zero MCP-server mapping in `immune_system.rs::check_mcp_catalog`, zero hits in the forge fixture surface. Twitter has partial coverage: `immune_system.rs:130` maps "twitter/x.com" to a "Twitter/X" MCP suggestion, so the pre-check would route it away from the forge before the forge ever fires — the wrong outcome for the demo.

2. **The forged tool must succeed end-to-end against a real LLM (FORGE-03).** The demo *requires* the loop to close — gap detected → tool written → test passes → registered → retry succeeds. HackerNews ships a public, unauthenticated, stable Firebase REST API (`https://hacker-news.firebaseio.com/v0/topstories.json` + per-item lookups). An LLM-written Python script using `requests` works on first try ~all-the-time. Twitter's API is broken for the LLM's pre-2024 training corpus (the same fragility CONTEXT.md cites as "high signal") — meaning a forged Twitter scraper has a high probability of failing the integration test and the on-device demo, eating the moat moment.

3. **Demonstrably useful for the target user.** Builders + founders + power users (the VISION-named profile) check HN. The first task "show me today's top 5 HN stories with titles and points" is the kind of thing a real user types and a real BLADE should handle. The narrative survives the screencast: gap → forge → working tool → recorded answer.

### What gets demoed

Operator types in chat: *"Show me today's top 5 HackerNews stories with titles, points, and comment counts."* No matching tool exists. `pre_check_existing_tools` returns false. The forge fires. Chat-line sequence: `gap_detected` → `writing` → `testing` → `registered` → `retrying`. Tool runs, returns 5 stories, LLM summarizes. Total wall time target ≤ 30 seconds.
