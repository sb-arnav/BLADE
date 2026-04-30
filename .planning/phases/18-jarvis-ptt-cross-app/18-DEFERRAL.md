---
phase: 18
plan: 13
status: deferred
created: 2026-04-30
deferred_reqs:
  - JARVIS-01
  - JARVIS-02
target_milestone: v1.3
---

# Phase 18 — Deferred Requirements (JARVIS-01, JARVIS-02)

## Why deferred

Phase 18 was reinterpreted under the **chat-first pivot** (operator decision 2026-04-30). Per CONTEXT D-01:

> "Text chat is the only input surface for Phase 18. PTT (JARVIS-01) and Whisper STT (JARVIS-02) are deferred to v1.3. JARVIS-12 (cold-install demo) is rewritten as type a command in chat → BLADE prompts consent → executes real cross-app action → action visible in target service."

The high-leverage half of Phase 18 is the **action + ego loop**, not the voice input. Voice path adds STT latency + accuracy issues, and the dispatcher is voice-source-agnostic — wiring voice in v1.3 is zero rework.

## REQs deferred

| REQ ID | Original wording (REQUIREMENTS.md:48-49) | Reason for deferral | Target milestone |
|--------|------------------------------------------|---------------------|------------------|
| JARVIS-01 | "Push-to-talk global hotkey registered (configurable; default `Ctrl+Alt+Space` on Win / `Cmd+Opt+Space` on Mac)" | Chat-first pivot: voice input out of Phase 18 scope. Existing PTT primitive (`src-tauri/src/voice_global.rs`) remains in tree, available for v1.3 resurrection. | v1.3 |
| JARVIS-02 | "PTT flow captures audio → Whisper STT (existing `voice.rs` or `whisper_local` if feature flag set) → text" | Same chat-first pivot. Existing `whisper_local.rs` (gated behind `local-whisper` feature flag) remains in tree, available for v1.3. | v1.3 |

## v1.3 hand-off shape (zero-rework guarantee)

The Phase 18 dispatcher (`src-tauri/src/jarvis_dispatch.rs::jarvis_dispatch_action`) accepts an `IntentClass` parameter, which itself is derived from a `transcript: String` via `intent_router::classify_intent(transcript)`. The transcript's SOURCE is irrelevant to the dispatcher.

Pseudo-pipeline (chat-first, Phase 18):
```
chat input → useChat send → commands.rs send_message_stream
  → intent_router::classify_intent(message)  ← transcript IS the user's typed message
  → jarvis_dispatch::dispatch_action(intent)
  → outbound write
```

Pseudo-pipeline (voice-resurrected, v1.3):
```
PTT hotkey → voice_global.rs captures audio → whisper_local.rs returns transcript: String
  → intent_router::classify_intent(transcript)  ← same fn, voice transcript instead of typed
  → jarvis_dispatch::dispatch_action(intent)    ← UNCHANGED
  → outbound write                              ← UNCHANGED
```

**Wiring deltas required in v1.3 (estimated scope):**
1. Re-enable `voice_global.rs` PTT registration (already present; just toggle off the chat-first guard).
2. Wire `whisper_local.rs::transcribe(audio_bytes)` → string (already present behind `local-whisper` feature flag).
3. Hand the resulting transcript to `intent_router::classify_intent(...)` — the existing function; no changes.

**Estimated v1.3 effort:** 1 plan, 1-2 tasks. The chat-first dispatcher carries voice for free.

## Files NOT wired in Phase 18 (preserved for v1.3)

| File | State | v1.3 action |
|------|-------|-------------|
| `src-tauri/src/voice_global.rs` | In tree, not wired into JARVIS dispatcher | Wire to `intent_router::classify_intent` |
| `src-tauri/src/whisper_local.rs` | Behind `local-whisper` feature flag | Build with the flag in v1.3; pipe audio_bytes → transcribe → dispatcher |
| `src-tauri/src/voice.rs` | In tree (verified present) — fallback STT path | Keep available; v1.3 chooses whisper_local OR voice.rs based on user preference |

## JARVIS-12 reinterpretation (chat-first)

Per CONTEXT D-21, JARVIS-12 (cold-install demo) is rewritten:
- **Original:** PTT activated → user speaks command → BLADE prompts consent → executes real cross-app action
- **Phase 18 chat-first:** Operator types into chat → BLADE prompts consent → executes real cross-app action → screenshot saved at `docs/testing ss/jarvis-cold-install-demo.png`

This rewriting is operator-blessed (chat-first pivot 2026-04-30) and is the e2e SC for Phase 18. See Plan 12 for the e2e demo execution.

## Cross-reference

- See `.planning/phases/18-jarvis-ptt-cross-app/18-VERIFICATION.md` (Plan 12) for the per-REQ status table.
- See `.planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md` D-01 for the operator's chat-first lock.
- See `~/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` for the pivot memory (load-bearing).

## Status

| Plan | Status |
|------|--------|
| 18-13 | Documented (this file — JARVIS-01, JARVIS-02) |
| 18-14 | Appends D-04 Step 2 LLM-fallback deferral (path B — heuristic-only suffices for v1.2) — see end of this file post-Plan-14 |
| JARVIS-01 / JARVIS-02 | DEFERRED to v1.3 — re-enabled by a small follow-up plan (1-2 tasks) when v1.3 voice surface is on the roadmap |
| D-04 Step 2 LLM-fallback | DEFERRED to v1.3 (path B) — heuristic-only intent classification ships in v1.2; appended to this file by Plan 14 Task 4 |

---

## D-04 Step 2 LLM-fallback (path B — deferred to v1.3)

CONTEXT D-04 specified a heuristic-first / LLM-fallback two-tier intent classifier. v1.2 ships **heuristic-only** intent classification (`intent_router::classify_intent` with `match_heuristic` for verb × service token pairs).

### Rationale

- **Coverage**: heuristic covers all cold-install demo prompts (Linear "create a linear issue: ...", Slack "post 'X' to #team in slack", Calendar "summarize meeting", GitHub "create a github issue in owner/repo: ...", Gmail "send an email to alice subject: ...").
- **Latency**: LLM-fallback adds a small-model (haiku-class) call without measurable benefit for the v1.2 SC. Cold-install demo budget cannot absorb the extra round-trip.
- **Friction**: deferred to v1.3 — to be wired only if operator UAT surfaces heuristic miss-rate as a real friction. Plan 14 Task 1 + Task 4 lock the heuristic-first contract.

### v1.3 hand-off shape

- `intent_router::classify_intent_llm(message: &str) -> Option<IntentClass>` is the existing hook (currently returns None unconditionally; Plan 06 stub).
- v1.3 wires it via `crate::providers::generate_oneshot("haiku", prompt, max_tokens=8)` (or `crate::router::select_provider` for the cheap model) with a fixed-format response prompt; parses to `Option<IntentClass>`.
- Zero changes to dispatcher / consent / commands.rs surfaces — the fallback is opt-in via the existing `unwrap_or(IntentClass::ChatOnly)` return path.
- Args extraction stays heuristic in v1.3 unless operator UAT shows the args bag is the bottleneck (orthogonal decision).

### Tracking

- This deferral is recorded against D-04 in CONTEXT.md.
- 18-VERIFICATION.md (Plan 12) cross-references this section in the JARVIS-03 evidence row ("heuristic-only — LLM fallback deferred per 18-DEFERRAL.md path B").
- Plan 18-14 closes this as "DEFERRED-DOCUMENTED" (path B is recorded; v1.3 will land path A or close the deferral with operator sign-off).
