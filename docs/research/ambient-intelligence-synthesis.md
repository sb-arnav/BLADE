# Ambient Intelligence Synthesis — BLADE Implementation Notes
Date: 2026-04-15
Source: OpenClaw + Omi + Cluely (real) + Pluely (Tauri clone)

---

## What We Learned and Built

### From OpenClaw
**Studied:** Phase state machine (idle/listening/thinking/speaking), audio level animation math, NSPanel window config
**Applied to BLADE:**
- VoiceOrb now has OpenClaw's exact animation math:
  - 3 staggered expanding rings (0.28 cycle offset) with amplitude/opacity driven by `micVolume`
  - Orb scale: `1 + level * 0.12` when listening, `1 + 0.06 * sin(t * 6)` when speaking
  - Exponential audio smoothing: `0.45 * prev + 0.55 * new` at 12fps (83ms)
  - Ring timer at 16ms (60fps), speed: speaking=1.4x, listening=0.9x, idle=0.6x
- `micVolume` prop added to VoiceOrb, wired from `voiceConv.micVolume` in App.tsx
- BLADE already had the `idle|listening|thinking|speaking` phase model in `useVoiceConversation`

### From Cluely (Real)
**Studied:** Leaked system prompt, reverse-engineered Electron app, Jack Cable security writeup
**Applied to BLADE:**
- Ghost mode system prompt now uses Cluely's scannable response format:
  - ≤6-word headline (line 1)
  - 1-2 bullets ≤15 words each, ≤60 chars/line
  - SILENCE IS DEFAULT — only fire when confident
- Ghost overlay now uses Tauri's `.content_protected(true)` builder method:
  - macOS: `NSWindowSharingNone` (previously missing from BLADE)
  - Windows: `WDA_EXCLUDEFROMCAPTURE` (was done via FFI, now via Tauri API)
  - Removed ~20 lines of manual Windows FFI code

### From Pluely (Tauri+Rust Cluely Clone)
**Studied:** `speaker/commands.rs` (VAD system), `window.rs` (content protection), `capture.rs` (xcap)
**Key patterns documented for future implementation:**
- Full VAD system: noise gate → RMS/peak → pre-speech buffer (0.27s) → silence detection → min duration
- `xcap` crate for cross-platform monitor capture
- Dual mode: VAD (automatic) vs Continuous (manual start/stop)
- See `pluely-deep-read.md` for full code patterns

### From Omi
**Studied:** `backend/routers/pusher.py` — WebSocket audio streaming protocol
**Key patterns documented:**
- Binary frame protocol: `header(4 bytes) | payload`
- Bounded deque per consumer (backpressure without memory growth)
- Event-driven audio bytes queue + polling transcript queue
- Conversation-anchored audio with flush-on-switch
- Speaker sample extraction delayed 120s min (noise gate via time)
- See `omi-deep-read.md` for full code patterns

---

## What BLADE Already Had (No Changes Needed)
- `ConversationState = "idle" | "listening" | "thinking" | "speaking"` — exact OpenClaw model
- `micVolume` in `useVoiceConversation` (0..1 normalized)
- `ghost_mode.rs` — always-on meeting overlay with audio transcription
- `audio_timeline.rs` — continuous audio capture + Whisper + insight extraction
- `perception_fusion.rs` — unified perception state
- `screen_timeline.rs` — Total Recall screenshots

---

## What To Build Next (Not Yet Done)
1. **VAD in audio_timeline.rs** — port Pluely's Rust VAD system to replace 5s fixed chunks
2. **Deepgram streaming STT** — replace batch Whisper with streaming WebSocket (Cluely pattern)
3. **Ghost mode auto-fire on question** — Cluely detects question at end of transcript (50%+ confidence)
4. **Speaker diarization** — "me" vs "them" tags (Cluely/Deepgram speaker attribution)
5. **Omi binary frame IPC** — efficiency improvement for audio pipeline hot path

---

## Files Changed This Session
- `src/components/VoiceOrb.tsx` — OpenClaw animation math, micVolume prop
- `src/App.tsx` — wire micVolume to VoiceOrb
- `src-tauri/src/ghost_mode.rs` — content_protected(true), Cluely response format
- `docs/research/` — 5 new research files saved
