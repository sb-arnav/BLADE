---
title: "BLADE — Whole-Project Synthesis"
date: 2026-05-13
author: Claude (Opus 4.7, 1M context)
source_read: every operating file + every planning doc + every milestone audit + every layer-1 note + .planning/codebase + .planning/research + docs/architecture + docs/apple-research/README + docs/research deep-reads (Cluely real/technical, OpenClaw, Pluely, Omi, ambient-synthesis) + docs/AGI-V3-VISION + docs/HIVE_PLAN + decisions.md + surprises.md + agent-native-audit.md + v2.0-onboarding-spec.md + 50-commit git log
authority_chain: VISION.md (locked 2026-05-10) → PROJECT.md → STATE.md → git log → CHANGELOG.md → notes/
status: working memory — supersedes scattered reads; does NOT override VISION
---

# BLADE — Whole-Project Synthesis (2026-05-13)

> One file, end-to-end. Built by reading every doc top-to-bottom, then collapsing into the
> view I'd hand the next session walking in cold. Nothing here overrides VISION; if this
> doc and VISION disagree, this doc is wrong.

---

## 1. What BLADE Is — In One Paragraph

**The AI accomplice that's actually yours.** Local-first, open-source, fork-able Tauri 2
desktop app (Rust backend + React TS frontend) that runs on the model the user picks
(Anthropic / OpenAI / Groq / Gemini / Ollama / local). 204+ Rust modules, 770+ Tauri
commands, 145 React components, 5 windows, 50+ routes, SQLite-local persistence, zero
telemetry. **Not a personal AI app, not a JARVIS clone, not a Goose competitor.** The
consumer-facing layer on top of the agent-runtime ecosystem (MCP, AGENTS.md, Goose
patterns) that turns it into daily life infrastructure the user *owns*.

Locked one-line pitch (VISION:103):
> *The AI that's actually yours. Doesn't refuse. Finds a way. Builds its own tools. Acts on your machine. Free, open, fork-able.*

---

## 2. Who BLADE Is For

VISION:19 — the **builders, founders, power users, and kids with side projects** who
want **agency**, not gentle guidance. The user who installed Claude Code and got pissed
when it refused. The solo founder who wants aggressive sales copy without four prompt
attempts. The 17-year-old shipping a Discord bot. The power user who would build their
own AI infra if they knew how — and now can, because BLADE gives them the foundation.

**Not the masses. Not the polite-assistant market.** B2B ("self-hosted AI for companies
that don't want their data going to Anthropic") follows personal-user traction, doesn't
precede it.

---

## 3. The Five Primitives (Locked Architecture)

VISION:27-65. Every roadmap item either advances one of these or doesn't matter.

| # | Primitive | What it means | Status |
|---|-----------|---------------|--------|
| 1 | **Doesn't refuse** | User's machine, user's model → zero corporate safety overhead. User defines safety via the core command, not Anthropic policy. Hard-coded refusals only for baseline edges (CSAM/WMD). | Substrate present; ego layer shipped in v1.2 Phase 18. |
| 2 | **Finds a way (persistence)** | Mid-loop replanning + cross-session continuation + "second time destroys it" learning. Addresses 95/5 silent-give-up problem (METR/Devin postmortems). | Loop shipped in v1.5 (mid-loop verifier, stuck detection, plan adaptation, circuit breaker). Memory continuity gap noted in VISION:136. |
| 3 | **Forges its own tools** | Voyager pattern in production. Hits capability gap → silently writes a tool → tests → registers → retries — visibly in chat. Structurally unshippable by Anthropic/OpenAI/Google (sandbox liability). **The Twitter-video moment.** | v1.3 substrate exists (`evolution.rs → autoskills.rs → tool_forge.rs`, `verify:voyager-loop` gate). Chat-visible firing pending v2.0. |
| 4 | **Setup is a conversation** | After `curl \| sh`, no wizard. A conversation. Pre-scan + key disclosure + LLM-driven hunt (narrated live) + writes `~/.blade/who-you-are.md` + closes by acting on a real task. | Spec drafted 2026-05-13 (`v2.0-onboarding-spec.md`). Phase work pending v2.0. |
| 5 | **Presence (the body)** | What BLADE *is*, not what it *does*. 7 hormones + vitality (0.0-1.0 with 5 hysteretic bands) + active inference + safety bundle. Hormones modulate behavior; prediction errors drive adaptation; vitality replenishes via SDT (competence/relatedness/autonomy); dormancy at 0.0 = process exits. Replika research: memory creates continuity, presence creates liveliness. Both load-bearing. | v1.4 shipped backend (hormones, vitality, active inference, safety bundle, organism eval 13/13 MRR=1.000). **Surfacing in chat is unresolved** — see §11. |

**The Evolution Engine** is the proactive-presence layer ("Sir, you have a meeting in 10
minutes"). Locked-in. Different from forge — autonomous knowledge update + decision-gated
interjection.

---

## 4. Current Position — v1.5 Closed, v1.6 In Flight

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ tech_debt | 10–15 | 2026-04-27 |
| v1.2 | Acting Layer + Brain Foundation | ✅ tech_debt | 16–20 | 2026-04-30 |
| v1.3 | Self-extending Agent Substrate | ✅ complete | 21–24 | 2026-05-02 |
| v1.4 | Cognitive Architecture | ✅ complete (zero debt) | 25–31 | 2026-05-03 |
| v1.5 | Intelligence Layer | ✅ tech_debt | 32–38 | 2026-05-08 |
| **v1.6** | **Narrowing Pass** | 🔄 **in flight (7 cut commits)** | TBD | — |

**v1.5 close** (CHANGELOG + audit): selective context injection at brain.rs section
level + OpenHands v7610 condenser at 80% capacity + tool-output caps + mid-loop verifier
every 3 calls + ToolError feedback + plan adaptation + truncation retry + ego intercept
on fast-streaming path + 5-pattern stuck detection + circuit breaker + cost guard +
append-only JSONL sessions (resume + branch + list) + auto-decomposition (5+ steps → sub-
agents with isolated contexts) + tree-sitter symbol graph + personalized PageRank repo
map + canonical_models.json + @screen / @file / @memory anchors + 26 deterministic eval
fixtures (verify:intelligence = gate #38, MRR=1.000) + opt-in real-LLM benchmark.

**Static gates green; 6 of 7 phases code-complete at `checkpoint:human-verify`** —
runtime UAT operator-deferred per the `feedback_deferred_uat_pattern.md` memory. The
`tech_debt` close matches v1.1/v1.2 precedent.

**v1.6 in flight (as of 2026-05-13)** — git shows 7 commits cutting the VISION removal
list:
- `ae54a15` financial_brain
- `b775857` health_guardian
- `7083d14` security_monitor
- `c0bf13f` pentest mode (kali + pentest)
- `2686761` workflow_builder
- `568b236` deeplearn synthesizer
- `aa789f7` deep_scan + ecosystem auto-enable + scan onboarding

That's 7 of ~9 "Removed (locked)" items in VISION:173-184. Remaining: persona
auto-extraction reduction, total recall / audio timeline demotion to on-demand, pulse
demote, tentacle observation gating. **The "Reduced" list isn't yet touched in commits.**

---

## 5. The Agent-Native Reframe (2026-05-12)

The most consequential read of the past week (from `.planning/agent-native-audit.md`):
8 parallel subagents scored BLADE against the `compound-engineering:agent-native-
architecture` skill principles. **Weighted overall: ~37%.**

| Principle | Score | Headline |
|-----------|-------|----------|
| 1. Action Parity (agent can do everything user can) | 44% | Agent can drive OS but cannot log a habit, add a transaction, create a goal. 14 frontend domain wrappers have zero LLM-tool counterpart. |
| 2. Tools as Primitives (atomic, no policy) | **92%** | Strongest dimension. 70/76 native tools correctly atomic. 6 violations cluster around autonomous loops + routing-policy-in-tool-body. |
| 3. Context Injection (dynamic per turn) | 56% | Hormones + vitality + OCR injected dynamically (real). Missing: active route, last 5 UI events, last N tool calls. |
| 4. Shared Workspace (state visible to both) | 20% | Inverted anti-pattern: 17/35 stores are UI-only with no agent tooling (Health/Goals/Habits/Finance/Accountability/Reasoning). |
| 5. CRUD Completeness | **10%** | 2/20 entities have full agent CRUD. KG, people graph, goals, habits, meetings, skills — agent has zero create/update. |
| 6. UI Integration | 60% | Chat streaming + agent step lifecycle wired correctly. Silent actions: memory writes emit nothing, KG `brain_grew` event exists with no React subscriber, `tool_result` event has zero emit site. **120 emits with no consumer** (orphan addendum). |
| 7. **Capability Discovery** | **0%** | Worst dimension. No /help, /tools, /capabilities slash command. Chat empty state is a blank div. Onboarding teaches *configuration*, not *capabilities*. |
| 8. Prompt-Native Features | 18% | ~11,400 LOC of code-defined verticals (security_monitor, financial_brain, persona_engine, evolution, pulse, proactive_engine) could be ~500 LOC of prompts + tools. |

**The reframe — `decisions.md` 2026-05-12 entry:** The v1.6 cut list is **not** a
narrowing pass. It is the **first step of the agent-native correction**. Cutting
financial_brain/health_guardian/security_monitor/pentest/workflow_builder/deeplearn is
shifting ~11,400 LOC from code-encoded vertical logic to *prompts + atomic tools the
agent invokes*. Same code action, different consequences.

The audit's 10 recommendations naturally form 5 phases — same count as VISION's
"narrowing pass" framing, different content:
1. Replace top 6 verticals with primitives + prompts (1-2 weeks)
2. Chat empty-state suggested prompts + /help, /tools, /capabilities slash commands (hours)
3. `crud_tools!` macro over DB-backed structs (1-2 days)
4. Build-time codegen from `invoke()` registry → tool definitions (1 day)
5. Context injection fixes + silent-action wires + prompts/dir migration (hours-days)

**LOC reality** (`surprises.md` 2026-05-12 + `decisions.md` 2026-05-12): the cut list is
~17,500 LOC of ~165,902 Rust = **10.5%**, not 60%. VISION's "60% surface area" tracks
*feature count*, not weight. Engineering effort = 3-5 focused days, not 1-2 weeks.

---

## 6. v2.0 Onboarding — The Hunt

`.planning/v2.0-onboarding-spec.md` (drafted 2026-05-13). Builds setup-as-conversation,
primitive #4. Locked moves:

1. **Pre-scan in message #1** (≤2 sec, no DB write): `which claude/cursor/ollama/gh`,
   `ANTHROPIC_API_KEY / OPENAI_API_KEY / GROQ_API_KEY / GEMINI_API_KEY / XAI_API_KEY`,
   keychain entries, Ollama TCP :11434, OS arch, default browser, mic permission
   check. Lands in in-memory `InitialContext`. Surfaces in opening bubble: *"Found
   these on your machine: Claude Code, Cursor, Anthropic + Groq keys, Ollama running.
   47 tools loaded. I'll default to Anthropic claude-opus-4-7 + Groq llama-3.3-70b
   fast cheap stuff. Use what I found, or paste a different key?"*

2. **"Feels illegal but legal" register** — *"I don't ask for permission before
   acting — I ask for forgiveness if I get it wrong. What are we building?"* Derived
   from verbatim local-AI builder community language. Lands doesn't-refuse primitive in
   the *first interaction*, not in a settings screen.

3. **Hunt (LLM-driven, narrated live)** — after key verify, BLADE prompts the LLM with
   platform context + `platform_paths.md` (per-OS install conventions, WSL detection
   via `wsl --list --quiet`). LLM decides what to read in what order; narrates every
   probe in chat. *"Found ~/.claude/projects → reading your 3 most recent Claude Code
   conversations → you're building a B2B SaaS called Clarify, solo founder, Next.js +
   Supabase + Stripe."* Cap input at ~50K tokens; token cost surfaces live.

4. **No-data fallback** — fresh machine: one sharp question (*"What do you do? Not
   your job — the thing you'd point a friend at if they asked."*), then GitHub
   handle / project URL as the search seed.

5. **Synthesis → `~/.blade/who-you-are.md`** — first-class user-editable Markdown.
   BLADE's CLAUDE.md, but for the human, written *by* BLADE *from* signals.

6. **First task closes onboarding (NOT a separate mode)** — *"Give me one thing
   you've been putting off this week — I'll handle it now."* Onboarding ends with
   BLADE *acting*, not with a "setup complete" screen.

**Resolved decision: F4 — autonomy ceiling is inferred from core command + learns from
patterns.** Not a setting. Not a tier picker. Asks at action-class boundaries (write
disk / send message / spend money / run command). The core command *is* the
delegation. (`decisions.md` 2026-05-13)

**Anti-patterns explicitly ruled out:** wizard, conversational profile interview
(vierisid/jarvis pattern), avatar customization (Replika anti-pattern), post-setup
restart, voice-first onboarding (text wins for multi-step accuracy; voice is opt-in
day-1+1).

---

## 7. Long-Arc Destination — Tentacles, Heads, Big Agent

From `docs/HIVE_PLAN.md` + `notes/v2-vision-tentacles.md` (v2+, not current scope but
**informs every architecture decision**):

```
              BLADE Desktop App
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   COMMS Head    DEV Head     OPS Head
   (Slack/Discord (GitHub/CI  (Servers/Cloud/
    WhatsApp/Mail  IDE/Term/   K8s/SSL/DNS)
    LinkedIn/X)    Logs/DB)
                                     │
                          INTEL Head ← all reports
                          (cross-domain synthesis)
                                     │
                               Big Agent
                          (cross-domain orchestration,
                           30-second briefing on
                           what happened overnight)
```

**Per-domain tentacle list:** Slack (auto-reply), Discord (auto-moderate), WhatsApp
(personal voice per person), Email (full triage + auto-respond), LinkedIn (recruiter
filter), X/Twitter, GitHub deep (PR review + dependabot merge + release notes),
CI/CD auto-fix pipeline, IDE (VS Code extension), Terminal watch, Database (slow query
monitor), Production logs, Server monitoring (disk-full prediction), Cloud costs,
Kubernetes (crashloop prevention), SSL/DNS/CDN, Calendar (agent-to-agent meeting
negotiation), Jira/Linear (sprint reports from git activity), Notion/Confluence
(stale doc detection), Analytics (deploy-vs-metric correlation), Browser, File
System (auto-organize Downloads), Finance, Health.

**Adjacent vectors not in v1.x scope:** Multi-instance / business SDK (inter-BLADE
protocol), Linux power-user niche, Hyprland integration ("what does BLADE look like
when it IS your window manager"), Mobile companion, Cross-device encrypted vault sync.

`docs/AGI-V3-VISION.md` is the Grok-authored "atomic substrate to global super-
organism" blueprint. Long arc, not BLADE-actionable on its own — provides the body
metaphor BLADE already operates within (hormones, vitality, neuromodulator bus,
hippocampus/cerebellum/thalamus mapping in `body-mapping.md`).

---

## 8. Architecture Map (Verified Against Source)

**Frontend (`src/`):** React 19 + TS 5.9 + Vite 7 + Tailwind v4 + Lucide. 5 entry HTMLs
(index, quickask, overlay, hud, ghost_overlay) → 5 webviews. 145+ components, 90 hooks.
**No shadcn/Radix** (D-01), **no Framer Motion** (D-02), **no Zustand** (D-04), **no
React Router** (D-05) — self-built primitives, custom router, ConfigContext, CSS-only
motion.

**Backend (`src-tauri/src/`):** 204+ Rust modules, 770+ `#[tauri::command]`s, 73 event
emitters. SQLite via `rusqlite` (FTS5 + vector search). OS keyring for keys. 35
background loops spawned at `lib.rs` setup.

**Core pipeline (commands.rs):** User types → `useChat` → `invoke("send_message_stream")`
→ `commands.rs` → `brain::build_system_prompt()` (assemble identity / memory /
personality / tools / context) → `router::classify_message()` → `providers::stream_text()`
→ HTTP to LLM → SSE parse → `app.emit("chat_token")` → React listener → MessageList →
on tool_use: `permissions::classify(name)` (Auto/Ask/Blocked) → `mcp::call_tool()` or
`native_tools::*` → result back to LLM → next turn. `chat_done` → persist + extract +
learn (`memory.rs`, `typed_memory.rs`, `knowledge_graph.rs`).

**Five module clusters (from CLAUDE.md):**
- **Core pipeline:** commands, brain, providers (5 adapters), config (6-place rule),
  native_tools (37+), router, mcp.
- **Perception:** godmode (3-tier ambient), perception_fusion, screen_timeline (30s
  + OCR), clipboard, audio_timeline, notification_listener.
- **Decision & autonomy:** decision_gate (act/ask/queue/ignore + per-source learned
  thresholds), proactive_engine (5 signal detectors), ghost_mode (`.content_protected(true)`
  invisible overlay), auto_reply.
- **Memory & learning:** memory (Letta blocks), typed_memory (7 categories),
  knowledge_graph, embeddings (BM25+vector RRF), persona_engine, personality_mirror,
  people_graph, character (feedback learning).
- **Agents:** swarm (DAG planner), agents/executor (tool fallback + provider fallback),
  background_agent (Claude Code / Aider / Goose spawn).

**Five locked design decisions** (`research/SUMMARY.md`): max 3 `backdrop-filter`
per viewport (D-07), blur caps 20/12/8px (D-07), `content_protected(true)` at window
creation for Ghost Mode (D-09), `useTauriEvent` hook as only event subscription
pattern (D-13), `emit_to(window_label)` for single-window events / `emit_all` only
cross-window (D-14).

**Performance budgets** (PROJECT.md): Dashboard first paint ≤200ms, Voice Orb 60fps,
chat render ≤16ms, audio level UI throttle 12fps, content protected channels don't
leak in screen-share (macOS NSWindowSharingNone + Windows WDA_EXCLUDEFROMCAPTURE,
Zoom on macOS is the one known unresolved exception).

**Key tentacle protocol** (from `connection-map.md`): 35 background loops. Hive ticks
every 30s, polls tentacles (email/slack/github/discord/CI/cloud_costs/linear_jira/
log_monitor/calendar/etc.), routes reports to domain Heads (Communications =
sonnet, Dev = gemini-pro, Ops = haiku, Intel = synthesis), each Head returns
`Decision[]`, confidence ≥ `autonomy_level` → execute + `emit("hive_action")`, else
queue for user approval (`emit("hive_pending_decisions")`).

---

## 9. How Claude Operates Here (AGENT_OPERATING_MODE.md)

Mandatory at session start. Eight rules:

1. **Position first, options never.** One position with evidence + defense. "Option
   A/B/C" = stop, send only the one I'd bet my own time on. Exception: Arnav
   explicitly asks for options.
2. **Adversarial pass before sending.** 60-sec "what would defeat this?" on every
   load-bearing position. Counter-argument visible in response or in `decisions.md`.
3. **Authority hierarchy is fact, not vibes.** VISION (locked 2026-05-10) → PROJECT →
   STATE → `git log -15` → CHANGELOG → notes/ (inputs, not authority).
4. **Self-action when asked, not proposal.** "Make yourself smarter / fix this
   habit" → take the action, report in one sentence. Not 4 setup options.
5. **Log load-bearing positions** to `decisions.md` with date/position/rationale/
   falsification/outcome.
6. **Wandering loop** (Rule 6). Every non-trivial session: a directed pass *and* a
   ~5-min/5k-token wandering pass. End substantive responses with one "something I
   noticed but didn't pursue" line.
7. **Surprise log** (Rule 7). Append-only `.planning/surprises.md` — one prior
   contradiction per session, *Prior / Reality / Implication* format.
8. **Ambition rotation** (Rule 8). Each substantive session: (a) push current plan
   further, (b) propose abandoning it, (c) propose something orthogonal. Rotate so
   (a) — the sycophant-disguised-as-pushing default — isn't the only mode.

**Forcing functions:** `.claude/hooks/blade-preflight.sh` (SessionStart, dumps recent
commits + VISION/STATE excerpts + latest decisions to stderr) +
`.claude/hooks/blade-operating-mode.sh` (UserPromptSubmit, re-injects rules on
strategy/milestone keywords). Track-record review cadence every 30 days; next
**2026-06-12**.

---

## 10. Decisions Log — Live Positions

`.planning/decisions.md`. Eight entries, one retracted, three resolved.

| Date | Position | Falsification | Status |
|------|----------|---------------|--------|
| 2026-05-12 | v1.6 = forge-demo, not narrowing pass | 30 days: forge-video gets shipped + zero external interest → moat wasn't real | **RETRACTED** — authority-inversion. VISION locks narrowing first; decisions.md doesn't override VISION. Capability-discovery Phase 39 that was built under this got unwound 2026-05-12. |
| 2026-05-12 | VISION's "60% surface area" tracks feature count, not LOC. Cut list = 10.5% of Rust. | v1.6 narrowing alone >7 working days → 60% was tracking complexity LOC missed | open |
| 2026-05-12 | BLADE = agent-native architecture applied to consumer life | v1.6/v2.0 reintroduces a `social_brain.rs`-style bespoke vertical → reframe was descriptive not prescriptive | open |
| 2026-05-12 | vierisid/jarvis is in BLADE's exact lane, not adjacent; shipped 16 milestones ahead | First 50 sign-ups include >3 explicit jarvis comparisons → lane overlap real, BLADE needs sharper differentiation copy | open |
| 2026-05-12 | Presence (hormones/vitality/inference) is unfalsifiable without observability surface in chat | 30+ days of use without consciously noticing presence-driven behavior shift → presence is theater | open |
| 2026-05-13 | First 60 sec onboarding = pre-scan + "feels illegal" register + invite real work | UAT flags first message as surveillance-y not JARVIS-y → framing wrong | open |
| 2026-05-13 | v2.0 onboarding = agentic hunt, not wizard | UAT flags hunt narration as verbose / slows me down → density wrong (mechanism stays) | open |
| 2026-05-13 | F4 RESOLVED: autonomy ceiling inferred from core command + learns from patterns | >10% of actions trigger ask after week 1 → learning algo wrong | resolved + locked into spec |

**Workspace memory cluster** (from `~/.claude/projects/-home-arnav-blade/memory/`) the
hooks inject every session — top items relevant to BLADE work:
- Take positions, don't offer options
- Act don't propose on self-changes
- Discuss before multi-bug sweeps (audit/bug-list work needs written fix plan)
- Research prior art before building (Reddit/HN/GitHub/X in the wild first)
- Operator-deferred UAT close-out pattern (close to `checkpoint:human-verify`, never auto-start the next phase)
- Hunt over wizard for "know the user" moments
- VISION over decisions.md (mine is positions log, NOT a tiebreaker over VISION)
- No useless DECISION blocks (don't put `<<DECISION>>` in front of Arnav if my own principles answer them)

---

## 11. The Honest Gaps (What's Still Broken)

From `body-mapping.md`, `agent-native-audit.md`, `CONCERNS.md`, milestone audits:

| Gap | Source | Severity |
|---|---|---|
| **Hippocampus fragmented** — 7 memory modules (`typed_memory`/`knowledge_graph`/`memory`/`embeddings`/`episodic`/`people_graph`/`execution_memory`) store independently. No consolidation. Memories never pruned/merged/strengthened on access. Dream mode exists but doesn't run memory consolidation. | body-mapping.md | High |
| **Thalamus doesn't route selectively** — `router.rs` classifies task type for model selection. No sensory relay. Perception data goes into one big prompt instead of being routed to organs that need it. | body-mapping.md + audit principle 3 | Medium |
| **Cerebellum doesn't act** — `learning_engine.rs` detects "user always runs cargo check after editing .rs" → never auto-runs it. Pattern detection disconnected from action. | body-mapping.md | High |
| **No formal event bus** — modules use 3 communication patterns (direct calls / Tauri events / DB reads). No standard. | body-mapping.md | Medium |
| **No real-time cost monitoring** — provider traces exist (`provider_traces.jsonl`) but no aggregation. No "BLADE making 47 API calls/min, burning $0.30/hour" surface. | body-mapping.md | Medium |
| **Capability Discovery: 0%** — no /help, /tools, /capabilities slash command. Chat empty state blank. Onboarding teaches *configuration*, not *capabilities*. Single biggest unforced loss. | agent-native-audit.md §7 | High |
| **CRUD Completeness: 10%** — Agent has zero ability to Create/Update typed_memory, KG nodes/edges, people_graph, goals, habits, meetings, skills. Rust API is CRUD-complete; gap is purely missing `ToolDefinition` registrations. | agent-native-audit.md §5 | High |
| **120 orphan emits** — Rust emits events with no React subscriber. `tool_result` constant exists with zero emit site + zero listener. KG `brain_grew` event exists but no React subscriber → MemoryPalace shows stale data. | agent-native-audit.md addendum | Medium |
| **Persistence depends on memory continuity** — VISION:136. The "second time destroys it" promise rests on memory architecture that's still fragile (B4 was quick-fixed; deeper split deferred). | VISION:136 | Open |
| **Forge requires sandboxing** — tools BLADE writes itself need to be sandboxed. Currently no sandbox. **v2.0 must.** | VISION:137 | Open (locked for v2.0) |
| **OEVAL-01c v1.4 drift** — `verify:eval` + `verify:hybrid_search` failing → carry-forward to v1.6+ per Phase 32-37 SCOPE BOUNDARY. v1.5 ships 36/38 gates. | v1.5 audit | Carry-forward |
| **Phase 32-37 runtime UAT operator-deferred** — 6 phases at `checkpoint:human-verify`. Static gates green, runtime walk-through not done. | v1.5 audit + STATE.md | Operator-owned |
| **Mac smoke M-41..M-46** — Tauri macOS bundle build pending on Mac (operator-owned). v1.0 carry-forward, still outstanding. | HANDOFF-TO-MAC (deleted in v1.2 close — absorbed into v1.3 then carried to current) | Operator-owned |
| **Eval-runs baseline** — `eval-runs/v1.5-baseline.json` operator-deferred. `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` runs 10 real-LLM fixtures, populates baseline for regression-only checks. | v1.5 audit | Operator-owned |

**Tech debt monoliths** (`CONCERNS.md`): `runtimes.rs` 5,785 LOC + `native_tools.rs`
3,477 + `hive.rs` 3,351 + `agent_commands.rs` 2,884 + `commands.rs` 2,485. **`surprises.md`
2026-05-12** noted: top 5 infra modules total ~21,700 LOC and aren't on any cut list.
`runtimes.rs` alone is bigger than financial_brain + health_guardian + pentest combined.
"5-month-old 5,780-line file probably has 1,000+ lines of entropy" — audit before
v2.0 build assumes those files are clean.

---

## 12. Threats to the Strategy (VISION:130-142)

Real risks, listed so they're explicit:

1. **Liability** if "doesn't refuse" attracts harmful use. Mitigation: agency-for-
   builders framing, hard-coded baseline edges (CSAM/WMD).
2. **Frontier providers may revoke API access** if BLADE becomes "the way to bypass
   Anthropic safety." Mitigation: model-agnostic from day one; local model (Llama/
   Qwen/DeepSeek) is first-class path, not fallback.
3. **Persistent agent burns API tokens** on stuck tasks. Mitigation: stuck detection
   shipped v1.5; per-conversation cost guard shipped; explicit budget caps.
4. **Memory continuity** is fragile. "Second time destroys it" promise depends on
   getting memory right.
5. **Forge requires sandboxing** — currently none. v2.0 must.
6. **App store rejection** likely (Apple/MS/Google won't list "the AI that doesn't
   refuse"). Distribution: `curl | sh`, slayerblade.site, GitHub Releases. Same as
   Ollama, Home Assistant.
7. **Frontier models may clone the wedge** (OpenAI "Developer Mode" / Anthropic
   "Power User Claude"). Mitigation: BLADE's other primitives (forges-tools +
   setup-as-conversation + persistence + you-own-it) less clonable.
8. **Open-source = anyone can fork and remove parts they don't like.** Strength; means
   BLADE has to win on relationship + community + brand.
9. **Single-developer project risk** — if Arnav stops, BLADE stops. Mitigation:
   community early; foundation custody eventually.
10. **Long-horizon coherence unsolved (2026)** — METR: 5.3 hours at 50% reliability
    best model. "Second time destroys it" is partially aspirational.

---

## 13. Roadmap Shape (VISION:146-167)

**Now (v1.5.1 shipped 2026-05-10):** bug-fix patch — 8 audit bugs closed (B1, B3, B4,
B5, B7, B8, B9, B10) plus onboarding curl-paste bug. Defensive scrub of
`<system-reminder>` leaks. v1.5.1 release ran 2026-05-10.

**Next (v1.6 — Narrowing Pass, currently in flight):** ~10.5% Rust deletion. 7 commits
done. **Locked 2026-05-13 (Arnav): v1.6 = pure deletion, not the audit's 5-phase
reframe.** Finish the VISION cut list + "Significantly reduced" items, close the
milestone, roll audit recs #2-10 (slash-commands / `crud_tools!` macro / codegen / context
injection fixes / prompts-dir migration) into v2.0 phase shaping. Clean separation.
v2.0 builds the agent-native primitives on a deleted-but-otherwise-untouched substrate.
Held-for-v2.0-eval items (Body Map / Organ Registry / Pixel World / Tentacle Detail /
mortality-salience / Ghost Mode) stay untouched in v1.6 per Arnav 2026-05-13.

**Next-next (v2.0 — Five Primitives):**
- **One-command install** + **setup-as-conversation** as the new front door
  (`v2.0-onboarding-spec.md` locked the mechanism 2026-05-13)
- **Forge primitive fires from agentic loop** visibly in chat (substrate exists in
  v1.3; chat-surface work is the v2.0 add)
- **Persistence mechanic** — mid-loop replanning + cross-session continuation +
  "second time destroys it" (v1.5 shipped the loop; cross-session learning is the
  v2.0 step)
- **Honest identity model + opinionated character**
- **Site rewrite around the new positioning**
- **Bundle Goose internals** (rip + integrate)

**Later:** Skills marketplace (forged tools shared) · channel integrations (Telegram,
iMessage, Slack, voice) · hardware option (BLADE on a Pi-style device) · foundation
custody when mature · B2B "JARVIS for your team."

**Never:** parity with Claude Code on coding-agent capability · out-engineer Anthropic ·
feature-grid adds.

**v1.6 cut list canonical state** (VISION:171-208):

| Status | What |
|---|---|
| Removed (locked) | financial_brain ✓ · health_guardian ✓ · security_monitor ✓ · pentest/kali ✓ · workflow_builder ✓ · deeplearn ✓ · deep_scan ✓ · current onboarding Steps (provider→apikey→scan→persona) — pending |
| Significantly reduced | persona_engine + personality_mirror auto-extraction → core command + chat history only · Total Recall → on-demand · Audio Timeline → on-demand · tentacles passive observation → default-off · background agent spawning → delegate to user's Claude Code/Cursor/Goose · pulse / morning briefings → cron stays, daily-summary cuts, decision-gated only |
| Held for v2.0 evaluation | Body Map / Organ Registry / Pixel World / Tentacle Detail panes (dev curiosity vs visible body angle) · mortality-salience implementation (observable behavior shift?) · Ghost Mode (channel layer may replace) |
| Kept (locked — presence) | hormones · vitality · active inference · character bible (SOUL) · Hive Mesh architecture · tentacles as pattern · Evolution Engine (proactive presence + autonomous knowledge update, decision-gated) |

**Constraints to remember** (VISION:266):
- Arnav has **no API budget and no local-model machine.** v2.0 must work on free tiers
  (Groq, Gemini) + the existing Anthropic key.
- **Abhinav (brother) is the only other tester.** No public users. Migration concerns
  theoretical.
- **Single-developer project.** Foundation custody / community / B2B = future, not now.

---

## 14. Competitive Landscape (VISION:113-125 + surprises 2026-05-12)

| Project | Lane | Threat |
|---|---|---|
| **Goose / AAIF** | Developer agent runtime; Linux Foundation backed; 44.7k stars | Doesn't compete with consumer-life lane. **BLADE consumes Goose's code, not its brand.** |
| **OpenClaw** | Multi-channel agent gateway; 358k stars; founder went to OpenAI; security issues | Closest spirit match. **Lane open.** |
| **vierisid/jarvis** | Same-lane competitor (added 2026-05-12 from surprises log) | **Threat** — their VISION opens with *"The AI that doesn't ask permission. Dangerously powerful by design."* Same wedge. 16 milestones shipped. Topology differs (daemon+sidecar vs desktop app), positioning overlaps. Not yet in VISION's competitive table — *open item.* |
| **Pi / Replika / Martin (YC)** | Consumer AI companion (closed/cloud) | Real but data-hostage. Leak when alternatives exist. |
| **N.E.K.O** | Consumer AI companion (open, Steam) | Persona-first, narrow scope. |
| **Home Assistant + Assist** | IoT + voice (domain-locked) | Adjacent. Not coming for life-orchestration. |
| **Notion AI / Mem.ai / Granola** | Single-surface AI | Each owns one slice; nobody owns unified presence. |
| **ChatGPT / Claude / Gemini apps** | Consumer chat AI | Wedge against them: *agency*. They refuse, BLADE doesn't. |
| **Hermes Agent (Nous Research)** | Python agent runtime (~10K LoC), 47 tools, 19 toolsets, 3 deploy modes, Hermes 4 model 131K ctx | Patterns to copy (skill memory layer, profile isolation, programmatic tool calling via `execute_code`); **runtime NOT to copy wholesale** (Python+Rust binary breaks single-binary + zero-telemetry distribution). |
| **Cluely / Interview Coder / cheap-cluely / Pluely** | Meeting overlay | One trick (Ghost Mode). BLADE has the overlay + every other surface. Content-protection mechanism documented in `cluely-real-technical.md` + applied to `ghost_mode.rs`. |
| **Omi** | Wearable recorder | No desktop control, no agent swarms. |
| **Screenpipe** | Screen recorder MIT | No agents, no chat, no tools. |
| **Claude Code** | The surgeon you call in | BLADE is the GP. *Uses* Claude Code; doesn't compete. |

**Lane claim** (VISION:125): *"the consumer-facing AI accomplice that's actually yours"* —
structurally open. OpenClaw proved demand. Home Assistant proved distribution model.
Goose proved runtime layer. **Nobody has connected them.** Asterisk: vierisid/jarvis is in
the same lane and shipping ahead — table needs updating.

---

## 15. What Each Layer of Documentation Says (Quick Map)

| Layer | Files | Authority |
|---|---|---|
| **Locked vision** | `VISION.md` (locked 2026-05-10) | Tier 0. Overrides everything. |
| **Operating files** | `CLAUDE.md` · `AGENT_OPERATING_MODE.md` · `HANDOFF.md` (frontend onboarding) · `BRIDGE.md` (Claude↔Artemis split) · `BLADE_CONTEXT.md` · `CHANGELOG.md` · `DOCS.md` · `README.md` | Tier 1 (CLAUDE/AOM project authority; HANDOFF/BRIDGE/BLADE_CONTEXT are reference). |
| **Planning meta** | `PROJECT.md` · `STATE.md` · `ROADMAP.md` · `REQUIREMENTS.md` · `MILESTONES.md` · `RECOVERY_LOG.md` (V1 audit before nuke) · `migration-ledger.md` (82 routes) | Tier 1.5 — frontmatter `last_updated` matters. |
| **Live position logs** | `.planning/decisions.md` · `.planning/surprises.md` · `.planning/agent-native-audit.md` · `.planning/v2.0-onboarding-spec.md` | Tier 2 — my voice, NOT authority. |
| **Notes** (Arnav's ideation) | `v1-1-milestone-shape.md` · `v1-2-ideation-arnav.md` · `v1-2-milestone-shape.md` · `v1-2-self-improvement-maturity.md` · `v1-3-hermes-openclaw-skills-research.md` · `v2-vision-tentacles.md` · `INDEX.md` | Tier 3 — inputs, not authority. |
| **Codebase audit** | `.planning/codebase/{ARCHITECTURE, STRUCTURE, STACK, CONVENTIONS, CONCERNS, INTEGRATIONS, TESTING}.md` | Snapshot 2026-04-17 — refresh via `/gsd-map-codebase`. |
| **Research bundle (Phase-0)** | `.planning/research/{SUMMARY, ARCHITECTURE, STACK, FEATURES, PRIOR_ART, PITFALLS, questions}.md` | Fed V1 skin rebuild. PRIOR_ART = user-gathered; Q1 closed for browser-harness. |
| **Architecture docs** | `docs/architecture/{connection-map, body-mapping, 2026-04-16-blade-body-architecture-design, 2026-04-17-blade-frontend-architecture}.md` · `docs/apple-research/{README, DESIGN_TOKENS, hig/brief, pro-apps/brief}.md` · `docs/AGI-V3-VISION.md` · `docs/HIVE_PLAN.md` | Living architecture spec. |
| **Prior-art deep reads** | `docs/research/{ambient-intelligence-synthesis, cluely-real-notes, cluely-real-technical, cheap-cluely-deep-read, omi-deep-read, openclaw-deep-read, openclaw-gateway-deep-read, pluely-deep-read}.md` | Done before/during V1 rebuild. Apply when designing overlapping features. |
| **Pre-GSD specs/plans** | `docs/superpowers/specs/*` + `docs/superpowers/plans/*` | Reference only — current planning is `.planning/`. |
| **Milestone archives** | `.planning/milestones/v1.1.. v1.5-{REQUIREMENTS, ROADMAP, MILESTONE-AUDIT}.md` + `v1.1.. v1.5-phases/` | Frozen at ship time, never edited. |
| **Phase archive** | `.planning/phases/00-09-*/` (V1 substrate) + archived per-milestone above | Per-phase: CONTEXT + PATTERNS + DISCUSSION-LOG + per-plan PLAN + SUMMARY. ~16 files per phase. |
| **Operator slash commands** | `.claude/commands/blade-uat.md` (the runtime smoke checklist that was the v1.1 lesson) | Use before any "done" claim on UI/runtime changes. |

---

## 16. v1.1 Verification Lesson — Load-Bearing

`CLAUDE.md` §Verification Protocol: **static gates ≠ done.** v1.1 closed with 27 verify
gates green + `tsc --noEmit` clean, then operator opened the app and discovered chat
doesn't render replies (40 Groq API calls hit, no UI feedback), provider page button
below viewport with scroll locked, UI overlaps every route, onboarding unusable, ⌘K
off-center. **`/blade-uat`** runs the procedure: dev server up + screenshot affected
route at 1280×800 + 1100×700 + Read tool back the saved PNG + cite one-line observation.

Research/planning sessions exempt — the procedure applies to runtime/UI changes.

---

## 17. The One Sentence That Holds Everything

**BLADE is agent-native architecture applied to consumer life, running on the user's
machine with the user's model, that doesn't refuse, finds a way, forges its own tools,
sets up via conversation, and feels alive because hormones and vitality and prediction
errors actually modulate behavior — built one milestone at a time by a single developer
with no API budget, on free tiers, in WSL2.**

---

## 18. Wandering Pass — Something I Noticed Reading Everything

*Per AGENT_OPERATING_MODE Rule 6.*

**The verbs that VISION.md cares about don't match the verbs the code measures.**
VISION's locked-in pitch leads with *doesn't refuse / finds a way / forges its own tools /
acts on your machine.* Verbs of agency. The 38 v1.5 verify gates measure structural
invariants — token counts per context section, MRR on eval fixtures, stuck-detection
accuracy on synthetic scenarios, compaction fidelity on marker fixtures. **None of them
measure "did BLADE refuse less" or "did BLADE find a way more often" or "did the forge
fire on a real gap and resolve it."** v1.5 added gate #38 (`verify:intelligence`)
deterministically with no LLM calls. The opt-in real-LLM benchmark exists but is
operator-deferred. The verify chain is structurally honest but primitive-blind — none of
the four locked-in primitives have a quantitative falsifier in `verify:all`. v2.0 phase
shaping could add primitive-level metrics: refusal-rate per task class, recovery-rate
on stuck loops, forge-fire rate, setup completion latency. The framework BLADE has
(deterministic CI lane + opt-in real-LLM lane) supports this; nobody's drafted the
metric set yet. Worth one position-taking pass before v2.0 plan-phase locks.

---

*Synthesis written 2026-05-13 by Claude (Opus 4.7, 1M ctx). Position-first per
AGENT_OPERATING_MODE.md. Authority: VISION.md > this doc.*
