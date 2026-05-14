# Show HN — BLADE launch post

## Posting window

**Mon or Tue, 10–11am ET.** (HN traffic peaks weekday mornings US Eastern; Mon/Tue avoids the Wed–Fri slot where AI-tool posts get throttled by algorithm fatigue.) Post 2 hours after the Twitter thread (see `docs/launch/launch-tweet-thread.md`) so HN clicks land on a tweet that already has engagement.

## Title (load-bearing — do not change wording)

> Show HN: BLADE – desktop AI agent that writes its own tools mid-task (open source)

The parenthetical `(open source)` is non-negotiable per the launch research. It changes comment tone from skeptical to collaborative on day 1.

## URL field

`https://github.com/sb-arnav/BLADE` — the repo, not the marketing site. HN voters are checking source before voting; sending them to a marketing site drops the upvote rate sharply.

## Post body (paste into the text field)

```
BLADE is an open-source desktop AI agent built in Tauri + Rust. The interesting bit is forge: when BLADE hits a capability gap mid-task, it writes a new tool, tests it, registers it, retries — visible in the chat, persisted to ~/.blade/skills/, available next time without forging again.

The demo at the top of the README is unedited and ~75 seconds — one prompt, one capability gap, one forged tool, second prompt that uses it without forging again. That second-time-no-forge is the whole point: VOYAGER in production, in user's hands.

Why standalone:
- Multi-provider (Anthropic / OpenAI / Groq / Gemini / Ollama / local). Switch at runtime.
- Runs on your machine. Your model. Your files. No telemetry. No corporate safety layer above what the underlying model already enforces (CSAM/WMD baseline only).
- Setup is a conversation, not a wizard — BLADE asks what you do, picks up signals from ~/code, and writes a TELOS-shaped ~/.blade/who-you-are.md it consults on every turn.
- Tauri binary, not a Claude Code config or another agent-runtime fork. ~60+ native tools + ~3,000 MCP servers via the registry adapter.

What I'd love feedback on:
1. The forge demo — is the "writes its own tool mid-task" hook clear from the recording alone, or does the chat-line stream need clearer styling?
2. The architecture choice — Rust core + React UI on Tauri (we adopted Goose's Provider trait + canonical models registry under Apache 2 for v2.2). Anyone running anything similar?
3. Memory layer — we just dropped the embedding vector store in favor of BM25 + a typed knowledge graph (matches what PAI v5 ships). Anyone tested how that holds up past ~100k facts on a single-user desktop?

Repo: https://github.com/sb-arnav/BLADE
Install (one line): curl -sSL slayerblade.site/install | sh    (or iwr for Windows)
v2.2 release notes: https://github.com/sb-arnav/BLADE/releases/latest

Happy to answer technical questions in the thread — I built this solo, in Rust, on a single laptop, in roughly seven months.
```

## Why this shape

- **Opens with the technical hook (Tauri + Rust + forge)**, not the marketing pitch. HN audience reads "what's the interesting bit" first.
- **Demo callout in paragraph 2** — points them straight at the recording.
- **Bulleted differentiation** — multi-provider / local-first / setup-as-conversation / standalone. Each bullet is a one-line technical claim, not adjectives.
- **Three explicit feedback asks at the end** — the launch research finding: posts with specific questions land 3–5× the comment count of "let me know what you think." Comments → upvotes → algo amplification.
- **Solo + 7 months** — credibility marker for the "is this a real project or YC slop" question every HN reader silently asks. Don't oversell it as a multi-year effort.

## Comment-thread prep (have these ready to paste)

The first 30 minutes are load-bearing. Expect these questions; have answers staged.

### Q: "How is this different from Claude Code / Cursor / Aider?"

> Claude Code is a coding agent — BLADE uses Claude Code when you have it installed (delegates code tasks to it). BLADE owns the relationship + memory + UX layer; Claude Code does the heavy code work. The differentiator is forge (mid-task tool creation, persistent), screen/voice/vision perception, and the conversational setup. Coding-agent parity isn't the goal.

### Q: "What stops the forge from writing malicious tools?"

> Forge runs the LLM-written tool in the same sandbox as everything else — your machine, your permissions. No additional sandbox layer beyond what the OS provides. This is the deliberate trade per VISION: "your machine, your sandbox, your risk." For users who want safety rails, set autonomy preference to "ask first" in onboarding; BLADE will surface every forged tool for approval before running it (Cline-style approval gate is on the v2.3 roadmap as a default for non-developer profiles).

### Q: "Why Tauri / why Rust / why not Electron?"

> Single binary, no Node runtime to ship, smaller footprint, native system access without Electron's IPC overhead. Goose chose Rust for similar reasons; we adopted their Provider trait under Apache 2 in v2.2. Tauri-vs-Electron is roughly: 12MB binary vs 200MB, native window decoration, no Chromium update treadmill.

### Q: "Multi-provider? Doesn't tool calling differ between Anthropic and OpenAI?"

> Yes — handled by the Provider trait (canonical_models.json from Goose's registry, 4,355 models / 117 providers). Each provider implementation translates BLADE's internal tool format to its own JSON-tool-calling spec. Tool-result handling is normalized at the gateway boundary, so the agent loop sees a uniform shape.

### Q: "How do you avoid the 'agent burns $50 in tokens on a stuck task' problem?"

> Three mechanisms: (1) per-conversation cost guard with $3 default budget, 50% soft warning + 100% hard interrupt; (2) stuck-detection on 5 semantic patterns + circuit breaker; (3) the forge subsystem has its own cost tracker that fires independently. All three are visible in chat as `[cost]` lines — you see the spend before it happens, not after.

### Q: "What's the memory architecture?"

> v2.2 just removed the vector store. Now: SQLite + BM25 + a typed knowledge graph + Letta-style virtual context blocks. PAI v5 ships zero embeddings and BM25 + KG; at single-user scale (~100k facts) it tested as competitive with hybrid. Embeddings live on as `#[ignore]`'d source for the v2.3 re-evaluation if real-user data demands them back.

### Q: "Is this just another wrapper around Claude/GPT?"

> No — the forge, the conversational setup, the typed memory, the cognitive primitives (hormones / vitality / active inference / decision gate) are BLADE-internal. The LLM is a substrate the way x86 is for Linux. We use it, we don't compete with it.

## Posting checklist

- [ ] Twitter thread posted (see `launch-tweet-thread.md`)
- [ ] DM to Daniel Miessler sent ≥ 48h ago (see `miessler-dm.md`)
- [ ] Demo GIF + MP4 + poster live in `docs/launch/assets/`
- [ ] README first line + install command currently render at top
- [ ] v2.2 release notes drafted on GitHub Releases
- [ ] Sit at the post for the first 30 min. Reply to every comment. Algorithm rewards live engagement in the first hour more than total upvotes.
- [ ] Cross-post the HN URL to r/LocalLLaMA after it survives 60 min on HN (proves it's not bait)
- [ ] Don't ask for upvotes. Don't tweet the HN link from a brand-new account. Algorithm catches both.
