# Phase 40 — Always-On → On-Demand

**Milestone:** v1.6 — Narrowing Pass
**Status:** Pending
**Requirements:** REDUCE-02 (Total Recall), REDUCE-03 (Audio Timeline), REDUCE-04 (Tentacle passive observation)
**Goal:** Three perception loops flip from default-on to default-off. On-demand paths preserved so LLM tool-use can still invoke them when the user asks.

## Background (from V2-AUTONOMOUS-HANDOFF.md §0)

VISION "Significantly reduced" track:
- **Total Recall (screen timeline)** — *"Stays as on-demand. Fires when 'what was on my screen 10 min ago' is asked. Not 24/7 background JPEG capture."*
- **Audio Timeline** — *"Same — on-demand transcription, not always-on."*
- **Tentacles passive observation** — *"B1 already shipped config off-switches; this finishes by making default-off the shipped state."*

## Approach

### REDUCE-02 — Total Recall on-demand

- `screen_timeline.rs` (658 LOC):
  - Identify the always-on background 30s capture loop start call (likely in `lib.rs::run()` or behind a config-gated `start_screen_timeline_loop()`)
  - Remove the unconditional loop start
  - Preserve the `capture_screen_now` Tauri command — LLM tool-use invokes it on demand via tool call when chat asks "what was on my screen?"
  - Update `DiskConfig::default()` so screen_timeline.enabled = false (6-place rule applies — config field stays, default flips)
  - Search for any UI that surfaced the live timeline and remove or gate it off (Activity Strip references to ongoing capture)

### REDUCE-03 — Audio Timeline on-demand

- `audio_timeline.rs` (1,137 LOC):
  - Identify always-on Whisper transcription loop (likely a separate background task)
  - Remove the unconditional loop start
  - Preserve any `transcribe_now(audio_clip)` or `start_recording_now()` on-demand path used by voice commands or LLM tool-use
  - Update `DiskConfig::default()` so audio_timeline.always_on = false

### REDUCE-04 — Tentacle passive observation default-off

- B1 (v1.1 phase) already shipped config off-switches per VISION wording
- This phase only flips defaults — all observer-class tentacles in `tentacles/*` start with `enabled: false` in `DiskConfig::default()` and `BladeConfig::default()`
- Per the 6-place rule (CLAUDE.md): touch `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`
- Observer-class tentacles per v1.1 manifest: repo-watcher, Slack, deploy-monitor, PR-watcher, session-bridge, calendar — confirm with `grep -rn "OBSERVE_ONLY" src-tauri/src/tentacles/`

## Risks

1. **The on-demand command path is wired through the always-on loop.** If `capture_screen_now` actually triggers a transient instance of the loop, naively removing the loop start could break the command. → Audit the command implementation before deleting; ensure it has a standalone capture call site.
2. **UI that relied on streaming timeline events.** Any component subscribing to `blade_screen_timeline_tick` events will silently stop receiving data. → grep for event subscribers; either gate them or remove if no longer load-bearing.
3. **B1 config-off-switches are wired but defaults were on.** Need to confirm B1 actually shipped per-tentacle enabled flags — if not, this phase must add them in addition to flipping defaults.

## Success criteria

- [ ] `screen_timeline.rs` background capture loop no longer starts at app launch
- [ ] `capture_screen_now` Tauri command remains callable
- [ ] `audio_timeline.rs` always-on transcription no longer starts at app launch
- [ ] Audio on-demand capture/transcription command remains callable
- [ ] All observer-class tentacles default to `enabled: false`
- [ ] `verify:all` ≥36/38
- [ ] cargo check clean
- [ ] tsc --noEmit clean
- [ ] Chat smoke test passes (send message, reply renders) per CLAUDE.md verification protocol
