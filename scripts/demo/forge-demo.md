# Forge Demo — Phase 47 (v2.0)

The Twitter-video moment per `VISION.md:40`. Demonstrates BLADE's forge
primitive (the v1.3 substrate: `evolution.rs → autoskills.rs → tool_forge.rs`)
firing **visibly in chat** on a real capability gap, end-to-end against a
real LLM.

## What the demo proves

- BLADE detects it can't do something
- BLADE writes a new tool on the fly
- BLADE tests the tool
- BLADE registers the tool in its catalog
- BLADE retries the original request and succeeds

None of Anthropic, OpenAI, Google, Microsoft, or Cursor ship this as a
lived chat experience today. (Claude Code can write tools but doesn't
fire mid-chat; GPT can write code but doesn't *register* the result as
a callable tool in its own loop; Cursor edits code but isn't a chat
agent.)

## Prerequisites

1. **API key configured.** BLADE Settings → Providers → Anthropic or OpenAI
   key set. The forge uses the same provider/model the chat uses
   (`config.provider` + `config.model`). Token cost per full demo: ≤ $0.50.
2. **Internet.** The forged HackerNews tool fetches
   `https://hacker-news.firebaseio.com/v0/topstories.json`.
3. **Empty forged tool catalog** (recommended for a clean demo). Either:
   - Fresh `~/.blade/` install, OR
   - Run `rm -rf ~/.blade/tools/hackernews* ~/.blade/skills/hackernews*`
     and delete the matching row from `~/.blade/blade.db`'s
     `forged_tools` table. (If the tool's already forged, the pre-check
     short-circuits and the demo skips.)

## Running the demo

```bash
BLADE_FORGE_DEMO=1 npm run tauri dev
```

Open the app. Navigate to `/chat`. Type **exactly**:

```
Show me today's top 5 HackerNews stories with titles, points, and comment counts.
```

Press Enter.

## Expected chat-line sequence

Within ~20 seconds you should see (top to bottom):

1. Your user message bubble.
2. **(forge band — monospace, blue tint)** — `⚒ gap detected — write a
   Python script that fetches the top N HackerNews stories with titles,
   scores, and comment counts using the Firebase API`
3. **(forge band, blue tint)** — `⚒ writing — LLM drafting tool
   'show_me_todays' in python`
4. **(forge band, blue tint)** — `⚒ testing — smoke-testing
   show_me_todays.py (expect non-error exit)`
5. **(forge band, green tint)** — `⚒ registered — tool
   'show_me_todays' is now callable via bash`
6. **(forge band, blue tint)** — `⚒ retrying — retrying with
   'show_me_todays' available — 'Show me today's top 5 HackerNews
   stories with titles, points, and comment counts.'`
7. **(assistant bubble)** — markdown-formatted list of 5 HN stories
   with titles, scores, and comment counts.

The five forge lines (#2–#6) are visually distinct from the assistant
reply: monospace font, smaller text, hammer glyph prefix, and a
contiguous color band (blue for in-progress, green for `registered`,
red for `failed`).

## Recording note

Target wall time: ≤ 30 seconds from Enter press to assistant bubble
landing. The five emit points are timed to fall ~3-7s apart on average:

| Phase         | Wall-clock | Source emit                                   |
|---------------|-----------:|-----------------------------------------------|
| gap_detected  |       0–1s | `tool_forge::forge_if_needed_with_app`        |
| writing       |       1–2s | `tool_forge::forge_tool_inner`                |
| testing       |     10–14s | `tool_forge::persist_forged_tool_inner`       |
| registered    |     14–15s | `tool_forge::persist_forged_tool_inner`       |
| retrying      |     15–16s | `tool_forge::forge_if_needed_with_app`        |
| assistant     |     16–25s | tool loop re-runs with the new tool registered|

Most of the wall-clock budget is the LLM call inside
`generate_tool_script` (writing → testing gap). The other transitions
are <1s each.

For the screen recording:

- Use a 1280×800 viewport (the project's canonical capture size).
- Set the chat to a fresh session so no prior turns scroll out of view.
- Record the full window so the forge band is visible alongside the
  user input bar and the assistant reply.
- Don't trim the writing → testing gap (~10s) — it's where the LLM is
  actually thinking; trimming it makes the demo look fake.

## If the forge skips (pre-check hit)

If you see only **one** forge line:

```
⚒ gap detected — pre-check matched existing tool 'show_me_todays'; skipping forge
```

…the tool's already in your catalog from a previous run. Either ask a
different gap question or clean the catalog per Prerequisites #3.

## If the forge fails

If the sequence ends on a red `⚒ failed` line:

- `LLM tool-write failed: ...` → check API key + model are correct in
  Settings → Providers.
- `triage LLM call failed: ...` → same as above; the triage uses the
  same provider with a cheap model.
- `DB insert failed (script rolled back): ...` → check
  `~/.blade/blade.db` permissions; the forge cleans up the orphan
  script automatically.
- `capability gap is structural — not tool-shaped (triage said no)`
  → the LLM decided the request isn't tool-shaped. Reword the prompt
  or pick a different gap. (For the HN demo this shouldn't happen;
  if it does the model is misbehaving.)

## Why this gap

See `.planning/phases/47-forge-wire/47-CONTEXT.md` §"Gap chosen" for
the FORGE-01 decision rationale. tl;dr: HackerNews has a public,
unauthenticated, stable Firebase REST API → an LLM-written scraper
works on first try. Twitter/X (the original recommended candidate)
would have been more dramatic narratively but its broken API breaks
the closed-loop demo.

## Build-time test

The integration test exercises the same pipeline with a mock provider:

```bash
cd src-tauri
cargo test --features voyager-fixture --test forge_e2e_integration
```

Five tests, all green in <1s. See
`src-tauri/tests/forge_e2e_integration.rs`.
