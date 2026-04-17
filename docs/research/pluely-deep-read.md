# Pluely — Deep Read (Tauri+Rust Cluely Clone)
Source: https://github.com/iamsrikanthnani/pluely (cloned /tmp/pluely/)
Date: 2026-04-15
Stack: Tauri 2 + Rust + React + TypeScript — **SAME STACK AS BLADE**

---

## What It Is
Open-source Cluely clone in Tauri+Rust. System audio capture, VAD, STT, AI response.
Floating overlay at top-center of screen. Content-protected (invisible to screen share).

---

## Window Config
File: `src-tauri/src/window.rs`

```rust
// Main overlay: top-center, 54px from top
const TOP_OFFSET: i32 = 54;
position_window_top_center(&window, TOP_OFFSET)?;

// Dashboard window (content-protected):
WebviewWindowBuilder::new(app, "dashboard", ...)
    .content_protected(true)  // ← This is setContentProtection(true) in Tauri!
    .decorations(true)
    .hidden_title(true)
    .title_bar_style(TitleBarStyle::Overlay)  // macOS
    // Close → hide (not destroy)
```

**Critical**: `.content_protected(true)` = `NSWindowSharingNone` on macOS + `WDA_EXCLUDEFROMCAPTURE` on Windows.
This is exactly what real Cluely uses. Already available in Tauri 2.

---

## Screen Capture
File: `src-tauri/src/capture.rs`

```rust
use xcap::Monitor;  // Cross-platform screen capture crate

// Full screen capture → base64 PNG
capture_to_base64():
    Monitor::all() → find monitor by window overlap area
    monitor.capture_image() → RgbaImage
    PngEncoder → PNG bytes → base64::STANDARD.encode()

// Region selection:
start_screen_capture() → creates transparent overlay windows per monitor
capture_selected_area(coords, monitor_index) → crops + emits "captured-selection"
```

---

## Audio Capture — VAD System
File: `src-tauri/src/speaker/commands.rs`

### VAD Config (TypeScript → Rust IPC)
```rust
pub struct VadConfig {
    pub enabled: bool,
    pub hop_size: usize,          // 1024 samples per VAD chunk
    pub sensitivity_rms: f32,     // 0.012 — real speech only
    pub peak_threshold: f32,      // 0.035 — filters clicks/noise
    pub silence_chunks: usize,    // 45 chunks (~1.0s) before stop
    pub min_speech_chunks: usize, // 7 chunks (~0.16s) minimum speech
    pub pre_speech_chunks: usize, // 12 chunks (~0.27s) pre-roll buffer
    pub noise_gate_threshold: f32, // 0.003
    pub max_recording_duration_secs: u64, // 180s
}
```

### VAD Loop Logic
```rust
run_vad_capture(app, stream, sr, config):
    buffer: VecDeque<f32>
    pre_speech: VecDeque (rolling 0.27s window)
    speech_buffer: Vec<f32>
    in_speech: bool
    silence_chunks: usize
    speech_chunks: usize

    For each hop_size chunk:
        apply_noise_gate() // threshold filtering
        (rms, peak) = calculate_audio_metrics()
        is_speech = rms > sensitivity_rms || peak > peak_threshold

        if is_speech && !in_speech:
            speech_buffer.extend(pre_speech)  // include pre-roll
            app.emit("speech-start", ())

        if in_speech && silence_chunks >= config.silence_chunks:
            if speech_chunks >= min_speech_chunks:
                trim trailing silence (keep 0.15s)
                normalize_audio_level(&buffer, 0.1)
                samples_to_wav_b64(sr) → app.emit("speech-detected", base64)
            else:
                app.emit("speech-discarded", "too short")
            reset state

        else if !in_speech:
            maintain rolling pre_speech buffer (trim to max size)
```

### Safety
- 30s hard cap per utterance (force emit)
- `audio-encoding-error` event on WAV encode failure
- `manual-stop-continuous` IPC for user-triggered stop

---

## Frontend Audio Hook
File: `src/hooks/useSystemAudio.ts`

```typescript
// listen("speech-detected", async (event) => {
//   base64Audio = event.payload
//   → atob → Uint8Array → Blob(audio/wav)
//   → fetchSTT(blob) → transcription string
//   → fetchAIResponse(transcription, systemPrompt, history) → streaming
// })

// Commands:
invoke("start_system_audio_capture", { vadConfig, deviceId })
invoke("stop_system_audio_capture")
invoke("manual_stop_continuous")
invoke("update_vad_config", { config })
invoke("check_system_audio_access")
```

---

## Speaker Module Structure
File: `src-tauri/src/speaker/mod.rs`

```
speaker/
  mod.rs         — cross-platform AudioDevice struct, list_input/output_devices()
  commands.rs    — VadConfig, start/stop_system_audio_capture, run_vad_capture
  macos.rs       — SpeakerInput / SpeakerStream for macOS (CoreAudio/BlackHole)
  windows.rs     — WASAPI loopback capture
  linux.rs       — PulseAudio/PipeWire
```

`SpeakerInput::new()` → platform-specific audio input (system output loopback)
`SpeakerStream` implements `Stream<Item = f32>` (infinite sample iterator)

---

## Key Patterns for BLADE

### 1. Content Protection (Invisible to Screen Share)
```rust
// In tauri.conf.json or WebviewWindowBuilder:
.content_protected(true)
// macOS: NSWindowSharingNone
// Windows: WDA_EXCLUDEFROMCAPTURE
```
BLADE already has `ghost_mode.rs` — check if `.set_content_protected(true)` is used there.

### 2. VAD Before STT
Don't send audio to STT on every chunk. Gate with VAD first:
- Noise gate → RMS/peak check → accumulate speech buffer
- Include pre-speech buffer (0.27s) for natural word starts
- Min speech duration (0.16s) filter for noise
- Trim trailing silence (keep 0.15s for natural ending)
- Only then: encode WAV → STT

### 3. xcap Crate for Screen Capture
```toml
xcap = "0.0.x"
```
`Monitor::all()` → `monitor.capture_image()` → `RgbaImage` → PNG → base64
Pluely uses this same crate. BLADE could use it for `screen_timeline.rs` screenshots.

### 4. Dual Mode: VAD vs Continuous
- VAD mode: automatic speech detection, no user input
- Continuous mode: manual start/stop (Enter to start, Enter to stop-and-send, Escape to discard)
- `isContinuousMode = !vadConfig.enabled` — simple toggle

### 5. Region Selection Overlay
`start_screen_capture()` creates transparent Tauri windows over each monitor.
User drags to select → `capture_selected_area(coords, monitor_index)` → emits `captured-selection` event.
Pluely's `Overlay.tsx` handles the React selection UI.

---

## What BLADE Can Lift Directly From Pluely
1. Full VAD system from `speaker/commands.rs` → integrate into `audio_timeline.rs`
2. `.content_protected(true)` on the ghost_mode overlay window
3. `xcap` crate usage pattern for `screen_timeline.rs`
4. `VadConfig` struct + IPC pattern for frontend tuning
5. Pre-speech buffer + trailing silence trim logic
