# Prior Art — User-Gathered Research

Distilled from 8 research files read 2026-04-15. Every claim below is actionable
for BLADE's Skin rebuild. Source citations use `[filename:line]` notation.

---

## Source files

- **ambient-intelligence-synthesis.md** — Session wrap-up: what was actually applied to BLADE vs what's still TODO; the definitive "what changed" log.
- **cheap-cluely-deep-read.md** — Python/PyQt5 open-source Cluely clone; shows the naive 5-second-chunk no-VAD baseline and what the real Cluely does that this clone does NOT.
- **cluely-real-notes.md** — Public-record behavioral spec for real Cluely: anti-UI philosophy, response format, always-on pipeline, keyboard shortcuts.
- **cluely-real-technical.md** — Jack Cable reverse engineering: Electron config, IPC architecture, Deepgram STT, content protection mechanism, full data flow, and every security hole.
- **omi-deep-read.md** — Omi wearable backend (FastAPI): binary frame WebSocket protocol, bounded deque queues, conversation lifecycle, speaker diarization delay pattern.
- **openclaw-deep-read.md** — OpenClaw macOS client (Swift): exact animation math for VoiceOrb rings, audio level normalization, window config, interaction model.
- **openclaw-gateway-deep-read.md** — OpenClaw TypeScript gateway: StreamFn middleware chain, session compaction, failover logic, real-time event emission pattern.
- **pluely-deep-read.md** — Pluely (Tauri 2 + Rust + React, same stack as BLADE): complete VAD system, content protection via `.content_protected(true)`, xcap screen capture, dual-mode audio.

---

## Ghost Mode / Meeting Whisper — from Cluely research

### Table-stakes behaviors confirmed

- Always-on simultaneous tracks: continuous audio transcription + screen OCR, no push-to-talk, no recording indicator [`cluely-real-notes.md:23-28`].
- Two trigger paths: (1) ambient auto-fire when question detected at end of transcript, (2) hotkey on-demand (CMD+Enter) for current screen/audio context [`cluely-real-notes.md:29-30`].
- CMD+R clears context; CMD+\ shows/hides the bar [`cluely-real-notes.md:30`].
- **Silence is the default.** Only fire when 50%+ confident the last utterance is a question. Never respond to the full conversation — only the last 10-15 words [`cluely-real-technical.md:67-68`].
- Priority order for triggering: direct question > term definition in last 10-15 words > follow-up > objection handling > screen problem [`cluely-real-technical.md:68`].

### Response format — copy this exactly

```
≤6-word headline (line 1)
• bullet 1, ≤15 words, ≤60 chars/line
• bullet 2, ≤15 words, ≤60 chars/line (optional)
No paragraphs. No markdown headers. No filler.
```

Source: [`cluely-real-technical.md:63-69`], confirmed in [`cluely-real-notes.md:35-42`].

This format is already partially applied to `ghost_mode.rs` system prompt
[`ambient-intelligence-synthesis.md:23-27`] but must be enforced identically
in the React card renderer — fixed max-width per line, monospace or tight
line-height so peripheral glance reads ≤60-char lines.

### Content protection — the full mechanism

- **macOS:** `.content_protected(true)` → `NSWindowSharingNone` on NSWindow →
  excluded from `CGWindowListCreateImage` AND ScreenCaptureKit. Google Meet,
  Teams, all browsers respect this at the OS compositor level
  [`cluely-real-technical.md:53-54`].
- **Windows:** `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` via DWM →
  compositor-level, not app-level [`cluely-real-technical.md:55`].
- **Zoom exception:** Zoom macOS uses raw display pipeline that bypasses
  `NSWindowSharingNone` — the window IS visible in Zoom screen share. This is
  a known, unresolved limitation for all Cluely-style overlays
  [`cluely-real-technical.md:55`].
- **Electron v34.3.1+ regression:** `setContentProtection(true)` makes the
  window opaque black during capture. Not a Tauri issue (different rendering
  path), but note it if BLADE ever targets Electron [`cluely-real-technical.md:57`].
- **Cursor trick:** No `cursor: pointer` CSS on interactive elements inside the
  ghost overlay — screen-share viewers can't infer hover/click from cursor
  changes [`cluely-real-technical.md:56`].
- **Tauri implementation:** `.content_protected(true)` in `WebviewWindowBuilder`
  or `tauri.conf.json`. Already confirmed available in Tauri 2 and already
  applied in Pluely [`pluely-deep-read.md:31`]. BLADE's `ghost_mode.rs`
  should use this; `ambient-intelligence-synthesis.md:29` confirms it was added.

### Pitfalls flagged

- Real Cluely uses a **macOS native audio module** (not Web Audio API), streaming
  base64-encoded PCM chunks at 24 kHz over IPC [`cluely-real-technical.md:17-20`].
  The cheap clone uses 5-second fixed Whisper chunks with no VAD — much worse
  latency and context [`cheap-cluely-deep-read.md:46-52`].
- Cluely stores everything server-side; this caused an 83k user breach
  (transcripts + screenshots in plaintext) [`cluely-real-technical.md:87`].
  BLADE is local-first — never route meeting audio off-device by default.
- Real Cluely has zero IPC allowlist — any renderer calls any handler
  [`cluely-real-technical.md:95`]. BLADE uses Tauri's scoped commands; preserve
  that; do not expose raw `invoke` globally.
- The "anti-UI philosophy" is non-negotiable: no waveform, no spinner, no
  "recording" indicator inside the ghost overlay [`cluely-real-notes.md:47-53`].
  Any visible affordance that a viewer can see defeats the product.

### Audio pipeline — what to build (not yet done)

1. Replace 5-second fixed chunks with VAD-gated audio (see Pluely section below)
   [`ambient-intelligence-synthesis.md:63`].
2. Replace batch Whisper with streaming Deepgram WebSocket. Speaker attribution
   ("me" vs "them") tags must be added before the LLM call
   [`cluely-real-technical.md:24-26`], [`ambient-intelligence-synthesis.md:64`].
3. Auto-fire logic: detect question at end of transcript with ≥50% confidence
   [`ambient-intelligence-synthesis.md:65`].

---

## Voice Orb / Ambient Overlay — from OpenClaw + Pluely + Omi

### Visual and motion patterns — confirmed exact values

All values sourced from OpenClaw's Swift implementation at
`TalkOverlayView.swift` [`openclaw-deep-read.md:41-66`]. Already applied to
BLADE's `VoiceOrb.tsx` [`ambient-intelligence-synthesis.md:12-17`].

**Orb scale:**
- Listening: `scale = 1 + (micVolume * 0.12)` — breathes proportionally to voice.
- Speaking: `scale = 1 + 0.06 * sin(t * 6)` — 6 Hz sine pulse (range 0.94–1.06).
- Idle / Thinking: `scale = 1.0` (no movement).

**3 staggered expanding rings** (index `idx` = 0, 1, 2):
```
speed     = speaking:1.4 | listening:0.9 | idle/thinking:0.6
progress  = (time * speed + idx * 0.28) % 1.0   // 0.28 cycle stagger
amplitude = speaking:0.95 | listening:(0.5 + level*0.7) | idle:0.35
alpha     = speaking:0.72 | listening:(0.58 + level*0.28) | idle:0.4
ringScale = 0.75 + progress*amplitude + (listening ? level*0.15 : 0)
opacity   = alpha - progress*0.6
stroke    = accent.opacity(alpha - progress*0.3), lineWidth=1.6
```

**Thinking arcs** (only during thinking phase):
```
arc1: trim(0.08, 0.26), opacity 0.88, rotation = +42°/s
arc2: trim(0.62, 0.86), opacity 0.70, rotation = -35°/s
```

**Audio level normalization** (RMS → display level):
```
rms = sqrt(sum(sample²) / frameCount + 1e-12)
db  = 20 * log10(rms)
level = clamp((db + 50) / 50, 0, 1)
smoothed = 0.45 * prev + 0.55 * current   // exponential smoothing
```
RMS sampled every 50ms (20Hz); UI updates throttled to 12fps (83ms interval)
[`openclaw-deep-read.md:86-110`].

**Adaptive noise floor** (from `TalkModeRuntime.swift`):
```
alpha = rms < noiseFloor ? 0.08 : 0.01
noiseFloor += (rms - noiseFloor) * alpha
threshold = max(1e-3, noiseFloor * 6.0)   // 6x boost above floor
clamped = clamp(rms / threshold, 0, 1)
```
[`openclaw-deep-read.md:99-105`]

**Orb gradient:** `RadialGradient(white → accent, topLeading, r=4..52)`
[`openclaw-deep-read.md:69-71`]

### State-machine pattern

Four phases, explicit enum: `idle | listening | thinking | speaking`
[`openclaw-deep-read.md:13-19`]. BLADE already has this exact model in
`useVoiceConversation` [`ambient-intelligence-synthesis.md:53`]. The Rust side
(`ghost_mode.rs`, `voice_global.rs`) emits events; the React orb consumes them.
No intermediate states needed for V1.

### Interaction model (orb)

- Single click: pause/resume.
- Double click: stop speaking.
- Drag: reposition window.
- Hover 120ms: reveal close button (easeOut fade-in).
[`openclaw-deep-read.md:173-179`]

### Window config (Tauri equivalent of NSPanel)

```json
{
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "focus": false,
  "transparent": true
}
```
OpenClaw uses `NSWindow.Level.popUpMenu.rawValue - 4` — sits above normal
windows, below system UI [`openclaw-deep-read.md:148-154`].
Present: 180ms easeOut fade-in. Dismiss: 160ms easeOut + 6px offset slide.

### Voice wake overlay additional state

OpenClaw tracks: `text` (live transcript), `isFinal`, `isVisible`,
`forwardEnabled`, `isSending`, `isEditing`, `isOverflowing`, `level`
[`openclaw-deep-read.md:114-129`].
Width=360pt, minHeight=48pt, maxHeight=400pt.
Send button fill animates: `width * level`, easeOut 0.08s.
Spring on send: `response: 0.35, dampingFraction: 0.78`.

### Gateway / routing patterns (OpenClaw Gateway)

The OpenClaw gateway implements a **StreamFn middleware chain** around every LLM
call [`openclaw-gateway-deep-read.md:36-52`]:

1. Base stream → provider stream → text transforms → sanitize malformed tool
   calls → trim tool call names → repair args (Anthropic) → XAI decode →
   logging → stop reason recovery → idle timeout → prompt cache.

BLADE's `commands.rs` `send_message_stream` should adopt the same layered
wrap pattern for resilience. Currently it does not have malformed-tool-call
recovery or idle timeout. These are stability requirements before the streaming
UI is production-hardened.

**Session compaction trigger:** token ratio > 0.65 of prompt context → compact
before retry, up to 3 attempts [`openclaw-gateway-deep-read.md:74-76`].
BLADE's `commands.rs` should expose the current token ratio as a blade_event so
the frontend can show a "compacting…" indicator in the chat UI.

**Real-time event taxonomy** (adopt this naming pattern for BLADE events):
```
onPartialReply       → blade_stream_chunk (exists)
onAssistantMessageStart → blade_message_start (add if missing)
onBlockReplyFlush    → blade_stream_done (exists)
onReasoningStream    → blade_thinking_chunk (add for Claude 3.5+)
onToolResult         → blade_tool_result (exists)
onAgentEvent         → blade_agent_event (add for swarm)
```
[`openclaw-gateway-deep-read.md:92-101`]

### What "OpenClaw math" means concretely

"OpenClaw math" = the exact animation constants above: `0.12` orb scale
multiplier, `0.06` speaking amplitude, `6 Hz` sine frequency, `0.28` ring
stagger, `0.45/0.55` exponential smoothing ratio, `12fps` UI throttle. These
are not aesthetic guesses — they are tuned values from a shipped, polished
product. Do not deviate without A/B reason. [`openclaw-deep-read.md:41-110`]

---

## Ambient Intelligence — from ambient-intelligence-synthesis.md

### Core principles BLADE should adopt

1. **Silence is default.** Both Cluely and the synthesis confirm: the ambient
   system should not fire unless it's confident. The cost of a spurious
   interruption is higher than a missed assist
   [`ambient-intelligence-synthesis.md:24`], [`cluely-real-technical.md:66`].

2. **Audio transcript is primary; screen is secondary/fallback.** The system
   prompt explicitly deprioritizes OCR results unless the question can't be
   answered from audio context [`cluely-real-technical.md:66`].

3. **Focus on the last utterance.** The question detector should look at the
   final 10-15 words of the transcript, not the full history
   [`cluely-real-technical.md:67`].

4. **Pre-speech buffering.** Include a 0.27s pre-roll before detected speech
   onset — natural word starts are lost without it [`pluely-deep-read.md:86-88`].

### Interaction patterns

- **Proactivity threshold:** 50% confidence floor for question detection before
  LLM fire. Below this, queue silently [`cluely-real-technical.md:68`].
- **Interruption rule:** BLADE's `decision_gate.rs` already has act/ask/queue/
  ignore classification — the Ghost Mode path should route through it, not
  bypass it. The synthesis confirms this is the right architecture
  [`ambient-intelligence-synthesis.md:53-58`].
- **Handoff cue:** Real-time partial transcript visible in the ghost overlay
  (like OpenClaw's `VoiceWakeOverlay`) signals to the user that audio is being
  picked up, without looking like a "recording" indicator to screen-share
  viewers. Show transcript text inside the protected window only.

### What to avoid

- **No VAD = unusable.** The cheap clone proves it: 5-second fixed chunks
  produce 4-second-stale context and always-on STT calls regardless of silence
  [`cheap-cluely-deep-read.md:47-52`]. VAD must gate the STT pipeline.
- **No unbounded queues on hot path.** Omi's pattern: only irreplaceable data
  (raw audio cloud sync) gets an unbounded queue; everything else gets a bounded
  `deque(maxlen=N)` [`omi-deep-read.md:47-49`]. BLADE's audio pipeline should
  follow this to prevent memory growth during long meetings.
- **Don't start speaker extraction immediately.** Omi delays speaker sample
  extraction by 120s minimum to avoid corrupting embeddings with early noise
  [`omi-deep-read.md:109-110`]. Apply same delay in BLADE's diarization path.
- **Don't stream audio as JSON over IPC.** Omi uses binary frames with 4-byte
  header + typed payload for efficiency [`omi-deep-read.md:26-32`]. BLADE's
  current audio pipeline likely uses JSON — this is a future optimization but
  should be the target architecture for the hot path.

---

## QuickAsk / Spotlight — cross-cutting notes

QuickAsk is not the focus of the research files, but several patterns apply:

- **Grouped results with Cluely-format cards.** The ≤6-word headline + 1-2
  bullets format is equally appropriate for QuickAsk inline results as for Ghost
  Mode cards. It keeps the overlay compact and scannable.
- **Voice mode in QuickAsk uses the same orb state machine.** OpenClaw's
  `VoiceWakeOverlay` model (live transcript text, level bar, `forwardEnabled`
  send gating) maps directly onto QuickAsk's voice mode
  [`openclaw-deep-read.md:114-130`].
- **Continuous vs VAD mode toggle.** Pluely's dual mode — VAD (automatic) vs
  Continuous (manual start/Enter/Escape/stop) — is exactly the UX QuickAsk
  voice mode needs: hold for push-to-talk (continuous) or hands-free VAD
  [`pluely-deep-read.md:178-179`].
- **Never steal focus.** All research confirms: overlay windows must use
  `WA_ShowWithoutActivating` / `focus: false` / `becomesKeyOnlyIfNeeded`
  equivalents [`cheap-cluely-deep-read.md:35`], [`openclaw-deep-read.md:147`].

---

## Cross-cutting themes

### Recurring design principles

1. **Transparent, frameless, always-on-top, no taskbar entry** — every product
   studied uses exactly this combination. Non-negotiable for BLADE's overlay
   windows (VoiceOrb, Ghost Mode, HUD bar, QuickAsk).
   Sources: [`cluely-real-notes.md:14-18`], [`pluely-deep-read.md:18-31`],
   [`openclaw-deep-read.md:136-158`].

2. **Never steal focus.** `focus: false` / `becomesKeyOnlyIfNeeded: true`.
   Every overlay studied enforces this.

3. **Content protection is a binary on/off at window creation time.** It is not
   a CSS trick. It must be set in the Tauri window builder before the window is
   shown. [`pluely-deep-read.md:23-31`], [`cluely-real-technical.md:52-57`].

4. **Anti-UI for stealth surfaces.** Ghost mode and ambient overlays deliberately
   suppress affordances visible to screen-share viewers: no cursors, no spinners,
   no waveforms in the main surface. Visual feedback lives inside the
   content-protected window only. [`cluely-real-notes.md:47-53`].

5. **Event-driven consumer intervals matched to data freshness.**
   Audio bytes: event-driven wake. Transcript: 1s polling. Speaker samples:
   15s polling, 120s min age. [`omi-deep-read.md:115-117`].

6. **Exponential smoothing on all animated values.** Raw audio levels are jittery;
   `0.45 * prev + 0.55 * current` at 12fps is the tuned baseline
   [`openclaw-deep-read.md:95-97`].

### Recurring pitfalls

- **No VAD = high STT cost + stale context** (cheap-cluely baseline).
- **Unbounded audio queues** = memory growth in long meetings (Omi warns against it).
- **JSON over IPC for audio** = avoidable serialization overhead on the hot path.
- **IPC without allowlist** = any renderer calls any backend handler (Cluely's
  critical security hole; Tauri's command scope system prevents this by default —
  do not disable it).
- **Electron content protection regression in v34.3.1+** = opaque black window.
  Not a Tauri issue, but illustrates that content protection + transparency is
  a fragile combination; test on every Tauri upgrade.
- **Speaker extraction on early audio** = noisy embeddings that never recover
  (Omi's 120s delay rule).
- **Cursor CSS on ghost overlay controls** = leaks interactivity to screen-share
  viewers. No `cursor: pointer` inside `content_protected` windows.

### Patterns the user has clearly endorsed

- OpenClaw animation math is applied verbatim to BLADE's VoiceOrb — user signed
  off on these exact constants [`ambient-intelligence-synthesis.md:12-17`].
- Cluely response format (≤6 headline, 1-2 bullets, ≤60 chars/line) is applied
  to `ghost_mode.rs` system prompt — user endorsed it
  [`ambient-intelligence-synthesis.md:23-27`].
- Pluely's `.content_protected(true)` is the implementation path — user confirmed
  the Tauri API call is sufficient, no custom FFI needed
  [`ambient-intelligence-synthesis.md:29-30`].
- VAD is the next concrete backend task (`audio_timeline.rs`) — explicit in the
  synthesis "What To Build Next" list [`ambient-intelligence-synthesis.md:63`].
- Deepgram streaming STT with speaker tags is the target STT architecture
  [`ambient-intelligence-synthesis.md:64`].
- Local-first is a hard constraint — Cluely's server-side breach is noted as a
  cautionary example; BLADE must not route meeting audio off-device by default.

---

## How this changes BLADE's rebuild plan

### Ghost Mode phase

- **Use `.content_protected(true)` in `WebviewWindowBuilder`**, not in a
  post-show setter. The ghost overlay HTML entry (currently missing — Rust
  crashes on open) must include this at creation time
  [`pluely-deep-read.md:23-31`], [`cluely-real-technical.md:52-57`].
- **Ghost Mode React shell must enforce the response card format** — fixed max
  char width per line (≤60 chars), ≤6-word headline rendered as `<h3>`, bullets
  as plain `<ul>`. No markdown renderer needed; the system prompt already
  constrains the format.
- **No cursor CSS on interactive controls inside the ghost overlay.** Drop
  all `cursor: pointer` and `cursor: text` from ghost window components.
- **Zoom caveat must be user-documented.** The ghost overlay will be visible
  in Zoom screen share on macOS due to Zoom's raw display pipeline bypass.
  Surface this in Ghost Mode settings tooltip.
- **Backend command load-bearing for Ghost Mode:** `ghost_mode.rs` already at
  line 472 has `set_content_protected`. The React shell just needs the HTML
  entry file and a `listen("ghost_suggestion", ...)` hook consuming the
  already-emitted events.

### Voice Orb phase

- **Orb is already partially wired** (`micVolume` prop, 4-phase state machine
  already exist [`ambient-intelligence-synthesis.md:17-19`]). The rebuild task
  is to rewrite the CSS to match the exact OpenClaw math precisely — ring
  `progress`, `amplitude`, `alpha` values must use the constants above.
- **Performance constraint:** orb must run at 60fps during all 4 phase transitions
  [`PROJECT.md:75`]. Ring animation must use `requestAnimationFrame` (not
  `setInterval`) with a 16ms target. The 12fps audio level throttle is separate
  from the render loop.
- **Thinking arcs** are the differentiator from simpler pulse animations — two
  counter-rotating arcs (+42°/s, -35°/s) at 0.88/0.70 opacity, trim ranges
  `(0.08, 0.26)` and `(0.62, 0.86)`. These must be implemented via SVG
  `strokeDashoffset` or CSS clip-path, not an animation library.

### Audio pipeline (backend wiring — surfaces during Skin rebuild)

These backend tasks are pre-requisites for Ghost Mode and Voice Orb to feel
polished. The Skin rebuild will expose gaps if these aren't done in parallel:

1. **VAD in `audio_timeline.rs`** — port Pluely's `run_vad_capture` Rust logic.
   Config struct: `VadConfig` with `sensitivity_rms=0.012`, `peak_threshold=0.035`,
   `silence_chunks=45`, `min_speech_chunks=7`, `pre_speech_chunks=12`
   [`pluely-deep-read.md:59-70`]. Emit `speech-detected` with base64 WAV.
2. **Deepgram streaming WebSocket** — replace batch Whisper calls. Speaker tags
   ("me"/"them") injected before LLM prompt [`cluely-real-technical.md:24-26`].
3. **Token ratio event** — emit `blade_token_ratio` from `commands.rs` so the
   Chat UI can show a compacting indicator. OpenClaw fires compaction at 0.65
   ratio [`openclaw-gateway-deep-read.md:74`].

### QuickAsk phase

- Voice mode reuses the VoiceOrb state machine and OpenClaw's
  `VoiceWakeOverlay` layout (transcript text + level fill bar + spring-animated
  send) [`openclaw-deep-read.md:114-130`].
- Implement VAD + continuous mode toggle in the same UI control — one button
  that changes label from "Hold to speak" (continuous) to "Listening…" (VAD)
  [`pluely-deep-read.md:178-179`].

### Foundation phase

- The typed Tauri wrapper must include `set_content_protected` as a typed call
  (it's already a Tauri built-in, not a custom command, but the wrapper should
  document which windows require it: ghost_overlay, potentially quickask overlay).
- The `blade_*` event taxonomy from the Gateway section above should be audited
  against what `ghost_mode.rs` and `voice_global.rs` actually emit to avoid
  naming drift during the rewrite.

---

*File generated: 2026-04-17. Consumes: 8 research files in `docs/research/`.*
*Next reads: STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md (for synthesizer).*
