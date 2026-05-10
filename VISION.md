# BLADE — Vision

> **Locked: 2026-05-10.** This document is the single source of truth for what BLADE is and is not. Every roadmap, plan, and feature decision must trace back to it. If a proposal contradicts this document, the proposal is wrong — not the document. Updates require an explicit decision recorded here.

---

## What BLADE is

**BLADE is the AI accomplice that's actually yours.**

Local-first. Open-source. Fork-able. Runs on your machine with the model of your choice (Anthropic, OpenAI, Groq, Gemini, Ollama, or a local model). No corporate safety review between you and your AI. No telemetry. No cloud trust tax.

It is **not** a personal AI app. It is **not** a JARVIS clone. It is **not** another agent runtime competing with Goose for Linux Foundation legitimacy. It is the **consumer-facing layer** that turns the agent runtime ecosystem (MCP, AGENTS.md, Goose patterns) into a daily life infrastructure that the user owns.

---

## Who BLADE is for

The user who installed Claude Code and got pissed when it refused. The user who hit a ChatGPT safety rail and bounced. The solo founder who wants AI that drafts genuinely-aggressive sales copy without four prompt-engineering attempts. The 17-year-old building a side project who wants an AI that does what they ask. The power user who would build their own AI infrastructure if they knew how — and now can, because BLADE gives them the foundation.

Not the masses. Not the "polite assistant" market. The **builders, founders, power users, and kids** who want **agency**, not gentle guidance.

The B2B angle (companies that need self-hosted AI without their data going to Anthropic) follows the personal-user traction, not preceding it.

---

## The four primitives BLADE has to nail

These are the load-bearing mechanics that define BLADE. Every roadmap item either advances one of these or doesn't matter.

### 1. **Doesn't refuse**
ChatGPT and Claude are getting more safety-railed every quarter. BLADE running on the user's machine with the user's model has zero corporate safety overhead. **Your machine. Your model. Your files. Your rules.** Not safety-free — the user defines the safety boundaries via the core command, not Anthropic's policy team.

### 2. **Finds a way (persistence)**
The opposite of the 95/5 silent-give-up problem. When BLADE is given a task, it does not bail. It iterates. It plans. It rewrites the plan when the plan fails. It keeps working. The first time on a hard task, it may take longer and need user assistance. The second time on a similar task, **it destroys the task honorably** because it has learned. JARVIS doesn't fail tasks; he iterates until they're solved.

This is the mechanic that addresses the most-documented failure mode in 2026 agents (METR, RLI, Devin postmortems). Most agents quietly give up on the hard 5%; BLADE does not.

### 3. **Forges its own tools**
The Voyager pattern, in production, in user's hands. When BLADE hits a capability gap mid-task, it silently writes a new tool, tests it, registers it, retries — visible in the chat. Goose can't ship this without months of foundation safety review. Anthropic / OpenAI / Google can't ship it because of sandbox concerns. **BLADE can ship it because it's the user's machine and the user's sandbox and the user's risk.** This is BLADE's signature move — the day a video of BLADE writing its own tool mid-task hits Twitter is the day BLADE has a story Claude Code structurally can't tell.

### 4. **Setup is a conversation**
After `curl | sh`, BLADE doesn't show a setup wizard. It starts a conversation. Voice if mic available; text otherwise. The conversation is the setup — BLADE asks for the **core command** (why you installed it, what you want it to be for you, how autonomous), discovers your tools/files via dialogue, asks privacy questions in context as it's about to do each thing, and introduces itself agent-to-agent to other agents on the user's machine (Claude Code, Cursor, MCP servers). No name/role survey. No 2019-SaaS form. The first conversation with the AI you just installed is the setup.

---

## The fifth primitive — presence

The four primitives above (doesn't refuse / finds a way / forges tools / setup as conversation) describe what BLADE *does*. The fifth one describes what BLADE *is*: **a presence with internal state, not a stateless service.**

Other AIs are functions you call. BLADE has a body. Hormones (cortisol, dopamine, serotonin, acetylcholine, norepinephrine, oxytocin, mortality-salience) modulate behavior. Vitality (0.0–1.0 with five behavioral bands) is replenished by competence, relatedness, autonomy (Self-Determination Theory). Active inference produces prediction errors that feed the hormone bus and adapt behavior. The Hive Mesh is the multi-tentacle architecture this presence runs on.

This isn't a feature on the side. It's the mechanism that makes BLADE *feel alive* the way Replika users describe their AI as having "a personality they cultivated." Memory creates *continuity* (the Replika research finding — 64% of users named memory as their #1 dissatisfaction when it broke). Internal state creates *liveliness*. Both matter; they're complementary.

**The Evolution Engine is the proactive-presence layer.** *"Sir, you have a meeting in 10 minutes."* *"Sir, there's a new MCP server that does what you tried to do yesterday."* Autonomous knowledge update + decision-gated proactive interjection. Different from forge (which is mid-task tool creation) — both load-bearing for the JARVIS feel.

**What's locked-in vs. held for v2.0 evaluation:**

| Component | Status |
|---|---|
| Hormones, vitality, active inference, character bible, Hive Mesh, tentacles architecture | Locked. Body backend is presence. |
| Evolution Engine (autonomous knowledge update + proactive surfacing, decision-gated) | Locked. JARVIS-notices-things is core. |
| Body Map / Organ Registry / Pixel World / Tentacle Detail visualization panes | **Not auto-kept.** Open question: do users actually engage with these, or are they dev-curiosity dashboards? Cut if invisible to users; rework if they could be the "BLADE has a visible body" angle. v2.0 evaluation. |
| Mortality-salience as currently implemented | **Not auto-kept.** Open question: does the implementation observably change BLADE's behavior in a way users notice? If invisible, cut. v2.0 evaluation. |

---

## What BLADE *uses*, not competes with

- **Goose / OpenHands code patterns** — Apache 2 licensed. Rip what works (agent loop architecture, MCP consumption layer, provider abstraction) and bundle into BLADE. One binary. User never sees Goose. Linux didn't credit Minix.
- **Claude Code as a code-task delegate** — when the user has Claude Code installed, BLADE delegates code tasks to it. BLADE owns the relationship + memory + UX layer; Claude Code does the heavy code work.
- **MCP / AGENTS.md** — consume the standards. Don't fight the protocol.
- **Whatever model the user picks** — Anthropic, OpenAI, Groq, Gemini, Ollama, local. BLADE doesn't care. The model is the engine; BLADE is the product.

---

## Why this survives the SaaS-eaten era

- BLADE doesn't compete with the model. It runs the model. (Linux didn't compete with x86; it ran on x86.)
- BLADE doesn't compete with Goose. It uses Goose internals. (Same pattern again.)
- BLADE owns the user's *life context*, *memory*, and *trust* — the most defensible asset in the AI economy because it can't be uploaded to a foundation model.
- Open-source means BLADE can't be bought, shut down, or have its terms changed by Anthropic / OpenAI politics.
- The "doesn't apologize" + "finds a way" + "forges tools" combination is **structurally unshippable by Anthropic/OpenAI/Google** because of liability + safety review constraints. Only an open-source self-hosted project can ship this.

---

## Strategy — copy / steal / use

| What | From whom | Why |
|---|---|---|
| One-command install (`curl \| sh`) + zero-config first-run | Ollama | They won local model serving by dropping the floor to 30 seconds. |
| Local-first + community-driven + values-as-pitch ("yours, not theirs") | Home Assistant | 50M+ installs by being values-driven, not feature-driven. |
| Foundation-eventually + dedicated hardware option later | Home Assistant | The HA Voice PE drop-shipped the setup floor. |
| Foundation governance neutrality model | Linux Foundation | When BLADE matures, foundation custody insulates from founder politics. |
| Fair-code license + self-host-first + hosted tier | n8n | $180M Series C playbook for self-hosted infra. |
| Channel integration (Telegram, iMessage, Slack, voice) early | OpenClaw | They proved channels are the killer surface; we avoid their security mistakes by staying single-user / local-only. |
| Apache 2 / MIT permissiveness for max copy-ability | Linux | Lower friction = wider adoption. |

---

## Position — the one-sentence pitch

> **The AI that's actually yours. Doesn't refuse. Finds a way. Builds its own tools. Acts on your machine. Free, open, fork-able.**

Branding tone — opinionated, direct:
- *"Built for builders. Not for HR."*
- *"Your machine. Your model. Your rules."*
- *"The AI you'd build if you could. Now you can."*
- *"Doesn't apologize. Doesn't snitch. Doesn't get neutered by a CEO's tweet."*

---

## What's in the path (competitive landscape, May 2026)

| Project | Lane | Threat |
|---|---|---|
| Goose / AAIF | Developer agent runtime; Linux Foundation backed; 44.7k stars | Doesn't compete with consumer-life lane — but defines the protocol. **BLADE consumes Goose's code, not its brand.** |
| OpenClaw | Multi-channel agent gateway; 200k stars | Closest spirit match. Founder went to OpenAI; security issues. **Lane open.** |
| Pi / Replika / Martin (YC) | Consumer AI companion (closed/cloud) | Real but data-hostage. Users will leak when alternatives exist. |
| N.E.K.O | Consumer AI companion (open, Steam) | Persona-first, narrow scope. Not a life orchestrator. |
| Home Assistant + Assist | IoT + voice (domain-locked) | Adjacent. Not coming for life-orchestration. |
| Notion AI / Mem.ai / Granola | Single-surface AI tools | Each owns one slice; nobody owns the unified presence. |
| ChatGPT app / Claude app / Gemini app | Consumer chat AI | The wedge against them is *agency* — they refuse, BLADE doesn't. |

**The lane BLADE claims — "the consumer-facing AI accomplice that's actually yours" — is structurally open.** OpenClaw proved demand. Home Assistant proved the distribution model. Goose proved the runtime layer. **Nobody has connected them.** That's BLADE.

---

## Threats to the strategy

Real risks. Listed so they're explicit, not surprises.

1. **Liability if "doesn't refuse" attracts harmful use.** The pitch needs to be **agency for builders**, not **tool for criminals**. The user defines safety via the core command; BLADE respects what the user explicitly opts into. Edge cases (CSAM, weapons of mass destruction, etc.) get hard-coded refusals — those aren't safety theater, those are baseline.
2. **Frontier model providers may revoke API access if BLADE becomes known as "the way to bypass Anthropic safety."** Mitigation: model-agnostic from day one; local model fallback (Llama 3.3, Qwen, DeepSeek) is a first-class path, not a fallback.
3. **Persistent agent burns API tokens on stuck tasks.** The "finds a way" mechanic can run up $1000s in tokens before realizing it's stuck. Mitigation: stuck detection (already shipped in v1.5), per-conversation cost guards (shipped), explicit budget caps.
4. **"Second time destroys it" requires real memory continuity.** Currently brain memory is fragile (B4 quick-fixed, deeper architectural split deferred). The promise depends on getting memory right.
5. **Forge requires sandboxing.** Tools BLADE writes itself need to be sandboxed so they can't break the user's machine. Currently no sandbox. **This is a v2.0 must.**
6. **App store rejection.** Apple, Microsoft, Google stores will not list "the AI that doesn't refuse." Distribution is direct (`curl | sh`), web (slayerblade.site), GitHub Releases. Not Mac App Store, not Microsoft Store. (Same as Ollama, Home Assistant.)
7. **Frontier models may eventually clone the wedge.** If OpenAI ships "Developer Mode" for ChatGPT or Anthropic ships "Power User" Claude, the safety-rail differentiator weakens. Mitigation: BLADE's other primitives (forges-its-own-tools + setup-as-conversation + persistence + you-own-it) are not as clonable.
8. **Open-source means anyone can fork and remove the parts they don't like.** Strength, not weakness — but means BLADE has to win on relationship + community + brand, not on locked-in features.
9. **Single-developer project risk.** If Arnav stops, BLADE stops. Mitigation: build community early; foundation custody eventually; documentation that lets a successor pick up the thread.
10. **The "persistence" mechanic is harder than it looks.** Long-horizon coherence is the unsolved problem in 2026 (METR: 5.3 hours at 50% reliability for the best model). BLADE's promise of "second time destroys it" is partially aspirational — depends on the underlying model improving + BLADE's memory + planning architecture compounding learnings across sessions.

---

## Roadmap shape (not a Gantt chart)

**Now (v1.5.1):** ship the bug-fix patch. Functionality bucket from the audit (B1, B3, B4, B5, B7, B8, B9, B10) closed. Onboarding curl-paste bug fixed. Defensive scrub of `<system-reminder>` leaks on BLADE.md load. **Done as of this commit.**

**Next (v2.0):** the four primitives become real.
- One-command install + setup-as-conversation as the new front door
- Forge primitive actually fires from the agentic loop, visibly, in chat
- Persistence mechanic — mid-loop replanning, cross-session continuation, "second time destroys it"
- Honest identity model + opinionated character
- Site rewrite around the new positioning
- Bundle Goose internals (rip + integrate)

**Later:** community + distribution + B2B.
- Skills marketplace (forged tools shared)
- Channel integrations (Telegram, iMessage, Slack, voice)
- Hardware option (BLADE on a Pi-style device)
- Foundation custody when the project is mature
- B2B "JARVIS for your team" sales motion

**Never:** chasing parity with Claude Code on coding-agent capability. Trying to out-engineer Anthropic. Adding features for the feature-grid.

---

## What's being removed (v1.6 narrowing pass input)

This is the input list for a v1.6 narrowing-pass milestone — code deletion before v2.0 build.

### Removed (locked)

| What | Why |
|---|---|
| Financial Brain | Vertical product. Doesn't fit the consumer-AI-accomplice positioning. Becomes a user-installable skill if anyone asks. |
| Health Guardian (screen time, breaks, daily wellness stats) | Vertical. Cut. |
| Security Fortress (network/phishing/breach scanners, code scan) | Vertical. Could become a skill later. |
| Pentest Mode (Kali tools, ownership verification) | Niche, conflicts with the agency-for-builders-not-tool-for-criminals line. |
| Workflow Builder (visual graph editor) | Not in scope for the BLADE thesis. |
| deeplearn auto-write synthesizer | The fabricated-fact path. B4 already lobotomized confidence; v1.6 removes the synthesis path entirely. |
| Deep Scan (12-scanner silent filesystem walk that wrote to brain.db) | Replaced by setup-as-conversation. BLADE asks instead of guessing. |
| Current onboarding Steps (`provider → apikey → scan → persona`) | Whole flow replaced by AI conversation. Steps.tsx, ApiKeyEntry, DeepScanReview, PersonaCheck retire. |

### Significantly reduced

| What | What stays |
|---|---|
| Persona Engine / Personality Mirror auto-extraction | Replaced with "voice from user-stated core command + actual chat history." No silent personality inference from filenames or shell history. |
| Total Recall (screen timeline) | Stays as on-demand. Fires when *"what was on my screen 10 min ago"* is asked. Not 24/7 background JPEG capture. |
| Audio Timeline | Same — on-demand transcription, not always-on. |
| Tentacles passive observation (terminal_watch / filesystem_watch / etc. always-on variants) | Gated by config (B1 already shipped). Default-off going forward; opt-in if user explicitly wants ambient ingest. |
| Background Agent Spawning | Refocused. BLADE delegates code tasks to whatever the user has installed (Claude Code / Cursor / Goose). No more "BLADE spawns arbitrary agents." |
| Pulse / Morning Briefings | Underlying cron primitive stays. The daily-summary engine cuts; proactive interjection routes through the decision gate so it only fires when something genuinely matters per the core command. |

### Held for v2.0 evaluation (NOT auto-kept, NOT auto-cut)

| What | Open question |
|---|---|
| Body Map / Organ Registry / Pixel World / Tentacle Detail visualization panes | Do users actually engage with these or are they dev-curiosity dashboards? Cut if invisible; rework if "BLADE has a visible body" is a real differentiator. |
| Mortality-salience implementation | Does it observably change BLADE's behavior in a way users notice? If invisible, cut. The *concept* (BLADE accepts dormancy) is interesting research; the implementation needs to earn its weight. |
| Ghost Mode (invisible meeting overlay) | Demoted from tier-1. v2.0 question: does the meeting-overlay feature carry its weight on a narrowed BLADE, or does the channel-integration layer (Slack, iMessage, etc.) replace it? |

### Kept (locked — these are presence, not features)

Hormones · vitality · active inference · character bible (SOUL) · Hive Mesh architecture · tentacles as a pattern · Evolution Engine (reframed as the proactive-presence + autonomous-knowledge-update layer, decision-gated).

These create *liveliness* the way memory creates *continuity*. Both are load-bearing for the JARVIS feel. Not negotiable in v1.6 / v2.0.

---

## How decisions trace back to this document

When a feature, plan, or roadmap item is proposed, ask:
- Does it advance one of the four primitives (doesn't-refuse / finds-a-way / forges-tools / setup-as-conversation)?
- Does it serve the user (builders, founders, power users, kids with side projects)?
- Does it survive the SaaS-eaten era (i.e., not something a frontier-model upgrade eats)?

If yes to all three: ship.
If not: defer or kill.

---

*Last verified: 2026-05-10. Locked decisions are load-bearing — change requires explicit re-decision recorded in this file.*
