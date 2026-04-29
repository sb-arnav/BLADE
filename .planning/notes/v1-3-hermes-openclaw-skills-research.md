---
title: "v1.3 input — Hermes / OpenClaw / Skills integration research"
date: 2026-04-29
status: research
captured_by: claude
audience:
  - /gsd-new-milestone (v1.3 milestone shaping)
  - /gsd-plan-phase (v1.2 Phase 3 — Skills-format decision is blocking, see §3)
related:
  - .planning/notes/v1-2-milestone-shape.md  # v1.2 locked, defers tool-replacer to v1.3
  - .planning/notes/v1-2-ideation-arnav.md   # the original ask: "Hermes / OpenClaw replacer"
  - docs/research/openclaw-deep-read.md      # prior art — macOS UI/voice orb only
  - docs/research/openclaw-gateway-deep-read.md  # prior art — gateway WebSocket + streamFn only
---

# Hermes / OpenClaw / Skills — v1.3 research input

## 0. TL;DR

Three independent integration questions, three different answers:

1. **Adopt the Skills pattern (agentskills.io standard).** Highest leverage. Single biggest "make BLADE feel like Claude Code" lever. **Decide the format before v1.2 Phase 3 locks the JSON manifest** — this is a 24-hour blocking decision.
2. **Add Hermes 4 (Nous Research) as a BLADE provider via OpenRouter.** Net-new offline / privacy / zero-telemetry tier. New `providers/openrouter.rs`, model slug `nousresearch/hermes-4-405b` ($1/$3 per 1M, 131K ctx, native tool use + JSON schema). Low risk, ~1 day.
3. **Do NOT adopt OpenClaw or Hermes Agent runtimes wholesale.** BLADE's `commands.rs` (2,907 LoC) + `brain.rs` (1,858 LoC) + `swarm.rs` already encode perception_fusion + decision_gate + ghost_mode + godmode tiers. OpenClaw and Hermes Agent runtimes are generic; you'd lose the differentiated stack to gain a messaging-channel surface and a slightly nicer tool loop. **Use OpenClaw's gateway as a sidecar for messaging input only** (the `openclaw-gateway-deep-read.md` shape is the right one).

This doc supplies the missing layer that the existing OpenClaw deep-reads do not cover — the **Skills system, the Hermes Agent project (distinct from OpenClaw), and the Hermes 4 model**.

---

## 1. Why this doc exists

The v1.2 ideation dump (`v1-2-ideation-arnav.md`) listed:

> Hermes / OpenClaw / Cowork REPLACER — research or straight-up copy them, integrate into BLADE.

The v1.2 milestone shape (locked 2026-04-29) explicitly punted this to v1.3:

> **Tool-replacer** (Hermes / OpenClaw / Cowork copy-or-control) → v1.3, gated on Phase 0 evals being live so we can measure "did the replacement actually replace?"

That gate is correct — the maturity audit's argument was *"replacing tools without quality measurement repeats the memory-cluster mistake at higher stakes."* But the **research can be done now**, while v1.2 is being planned/executed, so v1.3 starts with answers, not questions.

This doc is that research. It is **not a v1.2 amendment**.

---

## 2. What I actually verified

Sources read in full (not summaries):
- `agentskills.io/specification` — canonical SKILL.md spec, frontmatter fields, progressive-disclosure model.
- `github.com/openclaw/openclaw/blob/main/skills/skill-creator/SKILL.md` — authoritative skill example.
- `hermes-agent.nousresearch.com/docs/developer-guide/architecture` — Hermes Agent runtime architecture (gateway/run.py + run_agent.py, 47 tools, 19 toolsets, ACP adapter, three deployment modes).
- `openrouter.ai/nousresearch/hermes-4-405b` — model ID, pricing, context window, supported features.
- BLADE source: `src-tauri/src/providers/{anthropic,gemini,groq,ollama,openai,mod}.rs`, sizes of `native_tools.rs` (3,477 LoC), `brain.rs` (1,858), `commands.rs` (2,907), `router.rs` (663).

Specs are pinned to **2026-04-29**. agentskills.io is the maintained open standard; OpenClaw, Hermes Agent, Claude Code (per the SKILL.md format we already use internally), and OpenAI Codex Skills all comply with it.

---

## 3. Near-term blocking decision: Skills format alignment (v1.2 Phase 3)

**v1.2 Phase 3 proposes a JSON manifest:**

```json
{
  "name": "...",
  "description": "...",
  "tools_added": [],
  "triggers": [],
  "requires_capabilities": []
}
```

**The agentskills.io open standard is YAML frontmatter + Markdown body in `SKILL.md` files:**

```markdown
---
name: skill-name           # 1-64 chars, lowercase + hyphens, must match folder name
description: One sentence ≤1024 chars — what + when to use
license: Apache-2.0        # optional
compatibility: …           # optional, environment requirements
metadata: { … }            # optional, free-form
allowed-tools: Bash(git:*) Read   # optional, experimental
---

# Body — markdown. <500 lines recommended. Keeps under 5K tokens when activated.
# Step-by-step instructions, examples, edge cases.
# Reference deeper material via `references/REFERENCE.md`, `scripts/foo.py`, etc.
```

**Directory layout (canonical):**
```
skill-name/
├── SKILL.md          # required
├── scripts/          # optional executable code
├── references/       # optional deeper docs, loaded on demand
└── assets/           # optional templates / images / data
```

**Progressive disclosure (the load-bearing pattern):**
1. **Metadata** (~100 tokens per skill): `name` + `description` always loaded at startup. Agent uses `description` to decide when to invoke.
2. **Body** (<5K tokens recommended): full SKILL.md loaded only when the skill activates.
3. **Resources** (as needed): files in `scripts/`, `references/`, `assets/` loaded only when the skill explicitly references them.

This is **the same pattern Claude Code uses** for its skill ecosystem (`superpowers:*`, `gsd-*`, `geo-*`, `compound-engineering:*`). It is also what makes Claude Code feel "natural" on complex tasks — the model sees only the metadata catalog at startup, pulls in skill bodies on intent match, pulls in references only when the skill body says to. Token cost stays bounded; capability surface stays large.

### Why this matters before v1.2 Phase 3 locks

A JSON-manifest skill format would:
- Be **incompatible with the open ecosystem**: zero existing skills from `clawhub`, `agentskills.io`, OpenAI Codex, Claude Code skills can be ingested.
- Lose **progressive disclosure**: a JSON descriptor doesn't have a Markdown body the model reads. v1.2 would re-invent disclosure or skip it (and pay the context cost on every chat turn).
- Force a **second migration in v1.3** when the tool-replacer work makes interop a hard requirement.

### Recommended Phase 3 amendment (NOT a scope expansion)

Phase 3 still ships ELIZA / Obsidian / GSD as built-ins. The amendment is **format only**:

- Replace the JSON manifest with `SKILL.md` (YAML+Markdown) at `~/.blade/skills/<name>/SKILL.md` and bundled `<repo>/skills/<name>/SKILL.md`.
- Loader: parse YAML frontmatter, lazily load body on activation, lazily load references on file-reference traversal.
- Keep all the v1.2-shape Phase 3 success criteria — they hold under either format.
- Reference: `docs/specification.mdx` from `github.com/agentskills/agentskills` is the canonical schema; mirror it.

This is a 0-day net scope change (same shipped artifacts, same falsifiable success criteria) that buys interop with the entire 2026 skill ecosystem. The decision must land before Phase 3 PLAN.md is written, not after.

---

## 4. OpenClaw — beyond the existing deep-reads

The two existing deep-reads (`openclaw-deep-read.md` + `openclaw-gateway-deep-read.md`) cover:
- **`openclaw-deep-read.md`** — macOS Swift UI: orb scaling math, ring animation, NSPanel config, audio RMS smoothing. UI-only.
- **`openclaw-gateway-deep-read.md`** — TypeScript gateway: WebSocket protocol, `runEmbeddedPiAgent` flow, streamFn middleware (11 wrappers), provider failover, auto-compaction at 0.65 token-ratio, real-time event emission.

Neither covers the **Skills system** or how OpenClaw's three-layer architecture is meant to be reused. That's what this section adds.

### 4.1 OpenClaw's three layers (channel / brain / body)

OpenClaw's actual architectural separation (per `docs.openclaw.ai/concepts/agent`):

| Layer | What it is | BLADE equivalent |
|---|---|---|
| **Channel** | Messaging adapters (WhatsApp, Telegram, Signal, Discord, …) — protocol normalization, session routing, auth | None today — BLADE is desktop-only. Sidecar candidate. |
| **Brain (Agent Runtime)** | Reasoning loop: intake → context assembly → model inference → tool execution → streaming reply → persistence | `commands.rs::send_message_stream` + `brain.rs` + `swarm.rs`. **Already mature, do not swap.** |
| **Body (Tools + Skills)** | **Tools** = dumb syscalls (read/write/exec/browser). **Skills** = SKILL.md procedures that teach the model "which tool, what args, how to parse the result." | Tools = `native_tools.rs` (37 tools, 3,477 LoC). **Skills = missing.** |

The **Tools/Skills split is the key insight**. Tools are typed function interfaces (no intelligence). Skills are markdown procedures the model loads on demand to *use* tools well. Today BLADE has tools without skills, which forces every workflow into either (a) the system prompt (bloated, always-on cost) or (b) the model figuring it out from scratch every turn.

### 4.2 OpenClaw's Skills directory (concrete)

From `github.com/openclaw/openclaw/skills/`:

- `skill-creator/SKILL.md` — meta-skill: how to author other skills.
- Per-agent skills live in `<workspace>/skills/` (workspace-local).
- Shared skills live in `~/.openclaw/skills/` (user-global).
- **Workspace wins precedence** when same name exists in both.
- Community skill registry: `github.com/openclaw/clawhub` ("Skill Directory for OpenClaw").

### 4.3 What to copy from OpenClaw

- **The Tools/Skills split** as a first-class architectural concept in BLADE.
- **The progressive-disclosure pattern** (metadata → body → references → assets) — the actual Claude-Code-feel mechanism.
- **The skill resolution order** (workspace → user → built-in) — straightforward to implement.
- **The agentskills.io schema** — interop with the broader 2026 skill ecosystem.

### 4.4 What NOT to copy from OpenClaw

- The full `runEmbeddedPiAgent` runtime (already covered in the gateway deep-read) — BLADE's `commands.rs` does the equivalent and integrates with perception_fusion, decision_gate, ghost_mode, godmode. Swapping is a downgrade.
- The TypeScript codebase as a dependency. BLADE is Tauri (Rust + React); the closest reuse is the **gateway as a Node sidecar** for messaging input, which `openclaw-gateway-deep-read.md` already proposes.

---

## 5. Hermes Agent — the Nous Research project

**Hermes Agent ≠ OpenClaw.** Same shape (gateway + agent runtime + skills + messaging adapters), different team, different design choices.

Repo: `github.com/NousResearch/hermes-agent` (released February 2026, v0.8.0 / v2026.4.8 as of April 2026). Site: `hermes-agent.nousresearch.com`.

### 5.1 Architecture (verified)

| Component | File | Role |
|---|---|---|
| **Gateway** | `gateway/run.py` | 18 platform adapters; `Adapter.on_message()` → `GatewayRunner._handle_message()` → session resolution; outbound delivery via `gateway/delivery.py`; lifecycle hooks via `gateway/hooks.py` |
| **Agent Runtime** | `run_agent.py` | `AIAgent` class, ~10,700 lines. Three API modes: `chat_completions`, `codex_responses`, **Anthropic Messages**. Synchronous loop: provider select → prompt build → tool exec → retry → compress |
| **Tool Registry** | `tools/registry.py` | **47 tools across 19 toolsets**, self-registering at import. 6 terminal backends (local, Docker, SSH, Daytona, Modal, Singularity), 5 browser backends, file ops, MCP integration |
| **Skills Layer** | `agent/skill_commands.py` + `prompt_builder.py` | Skills attached as contextual instructions. `/skills/` (always-on bundled) + `/optional-skills/` (installable). Slash-command dispatch. **Per-platform enable/disable.** |
| **Memory** | SQLite + FTS5 | Session storage with full-text search, atomic writes, parent-child lineage. Pluggable memory providers in `plugins/memory/` |
| **Deployment** | CLI + Gateway + ACP | Three entry points, **same `AIAgent` class**. ACP adapter (`acp_adapter/`) exposes Hermes as a stdio/JSON-RPC editor agent (VS Code, Zed, JetBrains) — the closest "library mode" for embedding |

### 5.2 The differentiating design choices

These are what makes Hermes Agent worth studying separately from OpenClaw:

1. **Three-layer memory** — session / persistent / **skill memory**. Skill memory = procedural patterns the agent learned (auto-generated from successful traces). This is the part BLADE's `character.rs` (feedback learning) and `evolution.rs` (capability gaps) are reaching toward but don't have.
2. **Atropos RL framework** (`github.com/NousResearch/atropos`) — async RL environment for collecting LLM trajectories. In Hermes, drives **rejection sampling across ~1,000 task-specific verifiers** during training. Surfaces in production as the loop that lets the agent "create skills from experience, improve them during use, persist them across sessions."
3. **Programmatic Tool Calling via `execute_code`** — collapses multi-step pipelines into a single inference call by letting the model write a script that calls tools internally over a Unix socket back to the parent. Tool calls inside the script have **identical rate limits and capabilities** as normal tool calls.
4. **Tool-call format** — `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` with pydantic JSON-schema validation. Hermes 2 Pro and later use ChatML special tokens for turn boundaries. Same shape OpenAI/Anthropic tool use takes, just XML-tag-wrapped for open-weights compatibility.
5. **Profile isolation** — `-p <name>` flag → separate `HERMES_HOME` directory. Concurrent profiles (work / personal) share the runtime but not the data. **Directly answers Arnav's "work agents vs personal agents" line in the v1.2 ideation dump** without needing a new architecture.

### 5.3 What to copy from Hermes Agent

- **Skill memory layer** — the auto-generated procedural skill is the actual self-improvement mechanism. BLADE's `evolution.rs` logs gaps and `character.rs` logs feedback, but neither generates a reusable skill from a successful trace. Hermes does. Worth studying for the v1.2 Phase 3 → v1.3 evolution path.
- **Profile isolation** — direct match for Arnav's work/personal split. Implementation cost: per-profile `BLADE_HOME` dir, per-profile config, per-profile sqlite. Cleaner than per-feature toggles.
- **Programmatic tool calling pattern** — `execute_code` as a single tool that internally calls many tools via IPC. v1.3 candidate; complexity is real.

### 5.4 What NOT to copy

- **The full runtime as a Python dependency** — adding a 10K-line Python agent process to a Tauri Rust binary is a category error for local-first / zero-telemetry / single-binary distribution.
- **Atropos itself** — RL training requires a GPU farm and a ~1K-verifier set. Out of scope until BLADE has a measurable agent-trace evaluation harness, which v1.2 Phase 0 is building. Atropos becomes interesting at v1.4+ when there's enough trace data to train against.

---

## 6. Hermes 4 as a BLADE provider

Distinct from "Hermes Agent" (the runtime). Hermes 4 is the **model**.

### 6.1 Model facts (verified on OpenRouter 2026-04-29)

| Field | Value |
|---|---|
| **Model slug** | `nousresearch/hermes-4-405b` (also `nousresearch/hermes-4-70b`) |
| **API endpoint** | OpenRouter (OpenAI-compatible Chat Completions) |
| **Pricing (405B)** | $1.00 / 1M input, $3.00 / 1M output |
| **Pricing (70B)** | $0.13 / 1M input, $0.40 / 1M output |
| **Context window** | 131,072 tokens (both sizes) |
| **Tool use** | Native — function calling, JSON mode, schema adherence |
| **Reasoning** | Hybrid — `<think>...</think>` traces, gated by `reasoning_enabled` boolean |
| **Released** | 2025-08-26, knowledge cutoff 2024-08-31 |
| **Base** | Meta-Llama-3.1-405B (or Llama-3.1-70B), ~60B-token agent-trace post-training |
| **License** | Llama 3.1 Community License (commercial use OK with conditions) |

The 35B A3B MoE variant exists (~22GB at Q4KM, runs on a 4090) but is not on OpenRouter as of 2026-04-29 — it's a local-deploy target via Hermes Agent's runtime, not a hosted API.

### 6.2 Why Hermes 4 specifically

- **Trained on agent traces.** Nous Research's pitch is that Hermes 4 is *the* open model that stays "in character" as an agent across multi-step tool use — trained on real correct trajectories, not synthetic instruct data. Hermes 4 70B beats Llama 3.1 70B Instruct on agentic benchmarks by a meaningful margin.
- **131K context** — same ballpark as Claude Sonnet, comfortably handles BLADE's perception + memory context loads.
- **Tool use is first-class** — JSON schema function calling works, doesn't require prompt engineering hacks.
- **Hybrid reasoning** — `<think>` traces give Sonnet-style deliberation when needed, plain output when not. Toggle per-request.
- **Zero-telemetry positioning** — local Hermes 4 35B A3B on a 4090 is the *only* path to a full BLADE stack with no cloud round-trips. The 405B on OpenRouter is the bridge tier.

### 6.3 Integration shape (concrete)

**New file: `src-tauri/src/providers/openrouter.rs`** — patterned on `openai.rs` (OpenAI-compatible API). Endpoint: `https://openrouter.ai/api/v1/chat/completions`. Auth: `Authorization: Bearer <OPENROUTER_API_KEY>`. Model passed via `model` field, e.g., `"nousresearch/hermes-4-405b"`.

**Wire into `providers/mod.rs`** — add `OpenRouter` variant to the provider enum, parse `openrouter/<slug>` in the `provider/model` parsing, register the dispatch. Existing fallback chain handles failover.

**Wire into router (`router.rs`)** — Hermes 4 sits in the "private mode" / "offline-preferred" classification. Default routing stays Claude/Groq for online; user-configurable per-task.

**Tool-call surface** — Hermes 4's OpenAI-compatible function calling Just Works through the existing `openai.rs`-style code path. No special handling needed for the basic case. **If we want `<think>` reasoning traces**, add `reasoning_enabled: true` to the body and parse `<think>...</think>` blocks (mirror the existing thinking-trace handling for Claude 3.5+).

**Config (6-place rule per CLAUDE.md):** add `openrouter_api_key: String` (keyring-backed), `default_openrouter_model: String` to `DiskConfig` / `BladeConfig` / `default()` × 2 / `load_config()` / `save_config()`.

**Cost ceiling:** ~1 day implementation + 1 day testing. Falsifiable success: Hermes 4 70B answers a simple agentic query in chat with native tool use round-trip (call `read_file`, get result, summarize). Provider failover from Anthropic to OpenRouter works under simulated 429.

### 6.4 What about the local 35B A3B variant

Out of scope for v1.3 first cut. Would require:
- llama.cpp / Ollama integration (`ollama.rs` already exists — extend it).
- Hermes 4 GGUF quantization availability (Q4KM ships from Nous on HF, ~22GB).
- BLADE detecting local GPU and routing privacy-mode tasks to it.

Folder this into v1.4 or later once the OpenRouter tier proves the pattern.

---

## 7. The integration shape that actually makes sense (recommended v1.3 phases)

Compatible with v1.2 lock; consumes Phase 0 evals as the quality gate.

### Phase 0 (v1.3) — Skills v2: agentskills.io alignment + ecosystem ingest

**Goal:** Move BLADE's skills surface from the v1.2 Phase 3 MVP to full agentskills.io compliance. Enable third-party skills.

**Ships:**
- `SKILL.md` parser (YAML frontmatter + Markdown body) replaces the v1.2 JSON manifest if Phase 3 didn't already adopt it.
- Lazy-loading: metadata at startup (~100 tokens × N skills), body on activation, references on traversal.
- Skill resolution order: workspace → user → bundled.
- Skill validator: paste a SKILL.md, get a verdict.
- Ingest 5+ third-party skills from clawhub/agentskills as smoke tests (excluding ones that need capabilities BLADE lacks — those become evolution.rs gap-log entries, naturally).

**Falsifiable success:** A skill from `github.com/openclaw/clawhub` installs and runs in BLADE without modification. Skill body loads only when the skill activates (verified by token-budget assertion).

### Phase 1 (v1.3) — Hermes 4 provider

**Goal:** New `providers/openrouter.rs` + Hermes 4 routing tier.

**Ships:** see §6.3.

**Falsifiable success:** Chat with `provider=openrouter`, `model=nousresearch/hermes-4-70b`. Tool-use round-trip with `read_file`. Failover from Claude to Hermes under simulated 429 stays within latency budget. Eval scores on the Phase-0 (v1.2) memory-recall suite are at parity ±5% vs. Claude Sonnet baseline.

### Phase 2 (v1.3) — OpenClaw gateway sidecar (messaging surface)

**Goal:** Use OpenClaw's gateway (NOT its agent runtime) as a Node sidecar that bridges WhatsApp / Telegram / Signal / Discord into BLADE's existing chat command path.

**Ships:**
- `messaging_bridge.rs` — localhost HTTP/WS endpoint on a Tauri sidecar port. Receives gateway-routed messages, dispatches to `commands::send_message_stream`, streams back.
- Tauri sidecar config — bundle `node` + the OpenClaw gateway code (or just adopt the gateway protocol and write a lean Rust replacement; the WS shape is documented in `openclaw-gateway-deep-read.md`).
- Per-channel allowlist + auth — strict.
- Loopback-only by default; user opt-in to expose channels.

**Falsifiable success:** Send a Telegram message to your bot, BLADE answers using full memory + tools, reply renders in Telegram. Ghost-mode privacy honored — content protected channels don't leak via the sidecar.

### Phase 3 (v1.3) — Profile isolation (work / personal split)

**Goal:** Ship Hermes-style profile isolation. Same runtime, separate data per profile.

**Ships:**
- `BLADE_HOME` env override (default: `~/.blade`); per-profile dirs (`~/.blade/profiles/<name>`).
- CLI flag / settings toggle for active profile.
- Per-profile sqlite (`history.db`, `memory.db`, `kg.db` etc).
- Per-profile config + keyring entries.
- UI: profile switcher in the menu bar / command palette.

**Falsifiable success:** Boot BLADE with `--profile work`, send messages, switch to `--profile personal`, send messages. No cross-talk in memory or chat history. Eval suite passes on both profiles independently.

### Skipped from v1.3 (deferred)

- **Local Hermes 4 35B A3B** — v1.4+, gated on llama.cpp integration maturity.
- **Atropos / RL training** — v1.5+, gated on agent-trace dataset volume from production usage.
- **Skill auto-generation from successful traces** — v1.4+, this is the Hermes "skill memory" mechanism. Worth its own milestone.
- **Programmatic Tool Calling (`execute_code`)** — v1.4+, real complexity, not blocking.
- **Cowork** — not researched in this doc; v1.3 milestone shaping should pull a Cowork deep-read first.

### v1.3 sequencing

```
   Phase 0 (skills v2 / agentskills.io alignment)
       │
       ├──────────────┬──────────────┐
       ▼              ▼              ▼
   Phase 1         Phase 2        Phase 3      ← all parallel after 0
   (Hermes 4)      (msg bridge)   (profiles)
```

Phase 0 is foundational because Phases 1–3 all benefit from a real skills surface but don't strictly require it. Total target: ~7 days, matching v1.2's pace.

---

## 8. Risks + open questions

- **Skills format collision with v1.2 Phase 3.** The single most time-sensitive item in this doc. If Phase 3 ships JSON, v1.3 Phase 0 is a migration phase, not a new-capability phase. Decide before Phase 3 PLAN.md is locked.
- **OpenRouter dependency for Hermes 4 405B.** OpenRouter is a single-vendor router; if it goes down, Hermes 4 is unavailable. Fallback chain in `providers/mod.rs` mitigates. Local 35B A3B is the long-term answer.
- **OpenClaw gateway as Node sidecar conflicts with single-binary distribution.** Two options: (a) bundle Node in the Tauri installer (~50MB hit), (b) reimplement the WS protocol in Rust (estimated 600 LoC based on `openclaw-gateway-deep-read.md`'s spec). Recommendation: (b), keeps single-binary discipline.
- **Profile isolation may interact with existing global state.** `commands.rs` and `brain.rs` likely use process-wide caches. Audit needed during Phase 3 PLAN.md drafting.
- **agentskills.io is an external standard; rev cadence is not under our control.** Acceptable risk — the spec is small (6 frontmatter fields + a body) and stable. Pin to a version in the parser.
- **Skill ecosystem trust model.** Installing a third-party skill that runs `scripts/foo.py` is arbitrary code execution. v1.3 Phase 0 needs an explicit "skills with scripts require user confirmation on first use" gate.

---

## 9. What NOT to do (load-bearing anti-patterns)

- **Do not swap `commands.rs::send_message_stream` for OpenClaw's `runEmbeddedPiAgent` or Hermes Agent's `AIAgent.run`.** BLADE's runtime is more differentiated than either; you'd lose perception_fusion, decision_gate, ghost_mode, godmode tiers, and the 37-tool surface. Both alternatives are *generic* runtimes — useful as references, fatal as replacements.
- **Do not adopt Hermes Agent as a Python sidecar.** 10K LoC of Python in a Tauri Rust binary breaks single-binary, breaks zero-telemetry positioning (every dep audit grows), breaks distribution simplicity. The features worth copying (skill memory, profile isolation, programmatic tool calling) port as patterns, not as code.
- **Do not invent a BLADE-specific skill format.** The agentskills.io standard is the de facto 2026 format. Forking it costs ecosystem interop forever and saves nothing.
- **Do not skip the Phase 0 (v1.2) eval gate before doing the tool-replacer work.** The maturity audit's argument holds: replacing without measuring repeats the memory-cluster mistake at higher stakes.
- **Do not promise "BLADE replaces Hermes / OpenClaw."** The honest v1.3 frame is "BLADE *interops* with the same skill ecosystem and offers a Hermes-4 tier" — replacement framing is positioning we can't back up without years of work.

---

## 10. Sources

All URLs verified accessible 2026-04-29.

**Specs & standards:**
- [agentskills.io specification](https://agentskills.io/specification) — canonical SKILL.md schema, frontmatter fields, progressive-disclosure model.
- [agentskills GitHub repo](https://github.com/agentskills/agentskills) — reference library + `skills-ref validate` tool.

**OpenClaw:**
- [OpenClaw GitHub](https://github.com/openclaw/openclaw) — main repo, MIT, ~358K stars.
- [OpenClaw skill-creator SKILL.md](https://github.com/openclaw/openclaw/blob/main/skills/skill-creator/SKILL.md) — authoritative skill example.
- [OpenClaw skills docs](https://docs.openclaw.ai/tools/skills) — skill directory structure, resolution order.
- [OpenClaw agent runtime docs](https://docs.openclaw.ai/concepts/agent) — three-layer architecture.
- [clawhub](https://github.com/openclaw/clawhub) — community skill registry.
- [OpenClaw Internals (DEV community)](https://dev.to/lcmd007/openclaw-internals-architecting-ai-agents-with-kernel-syscalls-tools-and-userland-logic-skills-5b6o) — Tools-vs-Skills explainer.

**Hermes Agent (Nous Research):**
- [Hermes Agent GitHub](https://github.com/NousResearch/hermes-agent) — main repo.
- [Hermes Agent architecture docs](https://hermes-agent.nousresearch.com/docs/developer-guide/architecture) — gateway / runtime / tools / skills / memory layers.
- [Hermes Agent providers docs](https://hermes-agent.nousresearch.com/docs/integrations/providers) — supported model providers.
- [Hermes Agent code execution / programmatic tool calling](https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution) — Unix-socket-back tool dispatch from generated scripts.
- [Hermes Function Calling spec](https://github.com/NousResearch/Hermes-Function-Calling) — `<tool_call>` XML format + pydantic schema.

**Hermes 4 model:**
- [Hermes 4 405B on OpenRouter](https://openrouter.ai/nousresearch/hermes-4-405b) — pricing, model ID, features.
- [Hermes 4 70B on OpenRouter](https://openrouter.ai/nousresearch/hermes-4-70b) — pricing, model ID.

**Atropos:**
- [Atropos GitHub](https://github.com/NousResearch/atropos) — RL environments framework.
- [Introducing Atropos (Nous Research)](https://nousresearch.com/introducing-atropos) — design rationale.

**Existing BLADE prior art (do not duplicate):**
- `docs/research/openclaw-deep-read.md` — macOS UI / orb / NSPanel / audio levels (does NOT cover skills or runtime).
- `docs/research/openclaw-gateway-deep-read.md` — TS gateway / WebSocket / streamFn middleware / providers (does NOT cover skills, Hermes Agent, or Hermes 4).
- `.planning/notes/v1-2-milestone-shape.md` — locked v1.2 shape (defers tool-replacer to v1.3).
- `.planning/notes/v1-2-ideation-arnav.md` — original Hermes/OpenClaw replacer ask.
