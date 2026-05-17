# VISION Amendments — v2.4+ Candidate

**Status:** Candidate. Not committed to VISION.md (which is locked 2026-05-10).
**Captured:** 2026-05-17 — operator authorized "be ambitious and think of even a better vision to aim for but for this milestone stick to fixing functionality."
**Source:** competitor scan (`.planning/research/v2.3-competitor-scan.md`) + Mac UAT report + decisions.md 2026-05-17.

This file is a parking lot for VISION extensions to evaluate at v2.4 kickoff. v2.3 stays narrowly scoped on functionality recovery.

---

## Proposed amendment 1 — Event-sourced conversation as architectural primitive

**Current VISION:** 5 primitives (doesn't refuse / finds a way / forges tools / setup-as-conversation / presence). All behavior-shaped.

**Proposal:** Add a 6th architectural primitive — **conversation as immutable event log.**

OpenHands V1 (MIT — arXiv:2511.03690) redesigned its agent around a single invariant: "an autonomous agent is a function from event history to next event, run in a loop." The event log is append-only, immutable, the sole source of truth. Tool calls = events; tool results = events; retries = new events, not mutations.

This makes a dozen features cheap that BLADE currently has to engineer separately:
- **Replay** — re-run a conversation from any point to reproduce a bug
- **Per-step approval** — pause the loop before appending the next `DispatchAction` event; Cline-style gate becomes a 3-line change
- **Forking** — branch a conversation by copying the event log up to point N
- **Debugging** — the failure trace is the event log; no separate debug mode

BLADE's current `Vec<ConversationMessage>` is mutable. Compaction mutates. Tool-use insertion mutates. This isn't an architecture flaw today, but it makes Cline-style approval, OpenHands-style replay, and any future "BLADE just paused — what's the state?" interaction require bespoke plumbing each time.

**Risk:** Architectural shift, not surgical. Migrates the most central data structure in the codebase.
**Trigger:** evaluate at v2.4 kickoff; ship in v2.4 or v2.5.

---

## Proposed amendment 2 — Goose AgentManager unification

**Current VISION (§ What BLADE uses):** "Goose / OpenHands code patterns — Apache 2 licensed. Rip what works (agent loop architecture, MCP consumption layer, provider abstraction) and bundle into BLADE."

v2.2 adopted the Provider trait + canonical_models registry + session schema. The **next layer** is `AgentManager` — Goose's effort to unify their interactive chat path, scheduler path, and sub-recipe path into one `AgentSession` per `session_id` (PRs #4389, #4684, #4828, #5082).

This is exactly the problem BLADE has: `send_message_stream_inline` branches into fast-path vs tool-loop; `cron.rs` has its own dispatch; future Recipe-style automations would add a third path. v2.3 surgically fixes the immediate bug, but the architectural debt remains.

**Proposal:** v2.4 = AgentManager unification milestone. Collapse all chat-driven execution into one `AgentSession` struct. Remove the gate at `commands.rs:1822` entirely (it disappears once there's one path).

**Risk:** Touches every chat / cron / recipe call site.
**Trigger:** v2.4 — when operator-dogfood reveals which gaps the surgical fix didn't catch.

---

## Proposed amendment 3 — Streaming-aware parser combinator gate

**Current VISION (§3 forges its own tools):** "When BLADE hits a capability gap mid-task, it silently writes a new tool, tests it, registers it, retries — visible in the chat."

This presumes the harness can DETECT the capability gap. The Mac UAT report shows it can't reliably — `forged_tools_invocations` stayed at 0 across every probe.

**Proposal:** Make the streaming parser explicit in VISION as a load-bearing pattern. Hermes Function Calling (MIT) wraps the model's output in `<tool_call>...</tool_call>` opener tokens; the parser switches handlers on the discriminating token. Add to VISION:

> **Forge requires a streaming parser combinator gate.** Tool calls are detected as tokens stream, not as a post-hoc text-grep. The harness holds in an undecided state until the first non-whitespace event resolves whether the assistant turn is text or tool-use. Without this gate, conversational-shaped prompts route to text-only rendering and `tool_use` blocks disappear silently.

This makes the bug class permanently named in VISION so any future contributor sees the trap.

**Risk:** None — adding documentation of an already-required invariant.
**Trigger:** v2.4 VISION refresh.

---

## Proposed amendment 4 — Reuse before write (forge GitHub-first)

**Current VISION (§3 forges its own tools):** primitive 3 says BLADE writes a new tool when it hits a gap. Operator surfaced 2026-05-17: "first blade goes and tools for if the tool is available on github right?- it should cause it is easier."

**Proposal:** Strengthen primitive 3 from "write a new tool" to **"find or write."**

> **Forge searches before it writes.** When BLADE hits a capability gap, it first queries GitHub for an existing MCP server / tool manifest / shell utility that solves the problem. If a credible match exists, BLADE proposes installing it (user approves the install command). Only on a miss does forge fall through to writing the tool from scratch. Reuse > rewrite. The Twitter-video moment (VISION line 40) can be either "BLADE wrote me a tool" OR "BLADE found me a tool" — both demonstrate agency, the second demonstrates restraint.

Phase 63 in v2.3 ships the implementation. VISION should reflect the strengthened primitive.

**Risk:** None — this is implementation, not architecture.
**Trigger:** Update VISION when Phase 63 ships and reuse-before-write is observable in chat.

---

## Proposed amendment 5 — Error-as-observation retry pattern

**Current VISION (§2 finds a way):** "It iterates. It plans. It rewrites the plan when the plan fails." Mechanic is described aspirationally.

Aider (Apache-2) ships the cleanest possible primitive for this: when the LLM emits malformed output, the parse error is sent back as the next user turn. No retry counter. No state machine. The loop continues with the failure in context. Error becomes feedback.

**Proposal:** Add to VISION as the canonical "finds a way" mechanism:

> **Finds-a-way is event-replay, not retry-with-counter.** When a tool call fails, the error is appended to the conversation as an observation event. When parse fails, the parse error is the next user turn. The model self-corrects in the next loop iteration. No special retry state, no exponential backoff, no fallback chain — just a continuation with more information.

This is also what OpenHands' event-sourcing pattern gives for free (amendment 1).

**Risk:** None at the VISION level — current BLADE retry logic isn't this clean yet, but VISION can lead the implementation.
**Trigger:** v2.4 — pair with AgentManager unification.

---

## Proposed amendment 6 — Local-model fine-tune as v3 destination

**Current VISION (§ What BLADE uses):** "Whatever model the user picks — Anthropic, OpenAI, Groq, Gemini, Ollama, local. BLADE doesn't care. The model is the engine; BLADE is the product."

That's a runtime stance. There's a research-trajectory stance worth adding.

DeepHermes-ToolCalling-Specialist-Atropos (Apache-2 — NousResearch) is RL-fine-tuned on tool calling and achieves 2.5–4.6× accuracy improvement on parallel + simple tool calls vs the SFT base. Atropos is the open-source RL stack.

**Proposal:** Add to VISION (long-horizon):

> **v3+ destination: BLADE ships a fine-tuned local-model default.** A user installing BLADE on a recent Mac should be able to run "all of BLADE" without paying a cent to Anthropic/OpenAI. The current local-model path (Ollama) works but doesn't tool-call reliably. v3+ commits to either: (a) shipping a BLADE-fine-tuned variant of an open-weight model (Llama / Hermes / Qwen) trained on BLADE's actual tool-call corpus; or (b) packaging DeepHermes-style Atropos-RL-trained checkpoints as the default local backend. This is the second-decade move: own the runtime stack including the model.

**Risk:** Multi-year horizon; requires ML infra BLADE doesn't have. Not a near-term commit.
**Trigger:** v3.0 — only when the local-model gap becomes operator-blocking.

---

## What's deliberately NOT proposed

- Per-step approval gate (Cline pattern) — already deferred in v2.2 STATE; waits for trust primitive + presence narrative to land.
- Privacy questions at decision points — VISION §44 already covers; waits for trust primitive.
- Held-trio ship-or-kill — waits for external engagement data from launch.
- Recipes engine (YAML + minijinja) — Goose's pattern, secondary to AgentManager.

---

## Evaluation checkpoint

Re-read this file at v2.4 kickoff. For each amendment:
1. Has v2.3 functionality recovery + launch made the problem better, worse, or unchanged?
2. Is the proposed amendment still load-bearing or has the field moved past it?
3. Is the cost-of-change tractable in one milestone, or does it need splitting?

Discard amendments that no longer earn weight. Promote the ones that do into VISION.md via the explicit-decision-recorded protocol it requires.
