# Cluely (Real) — Full Technical Breakdown
Source: Jack Cable reverse engineering, leaked system prompts, faithful clones
Date: 2026-04-15

---

## Screen Capture
NOT Electron's `desktopCapturer`. Custom IPC bridge:
- IPC channel: `capture-screenshot` → `captureScreen()` → returns `{ contentType, data }` as blob
- Renderer: `URL.createObjectURL(data)`
- Security hole: `data` IPC handler exposed globally via `contextBridge` with no allowlist
  → any website opened through Cluely could continuously screenshot the user's screen

---

## Audio Capture
**macOS native module** (not Web Audio API):
- IPC: `mac-set-native-recorder-enabled` + `mac-native-recorder-data`
- Audio streams as base64-encoded PCM chunks over IPC
- Reconstructed into WAV at **24000 Hz** in renderer
- Mac-first product — no Windows audio equivalent found

---

## STT Engine
**Deepgram** (confirmed via `@deepgram/sdk` in reversed source)
- Streaming WebSocket transcription (not batch Whisper)
- Speaker attribution: "me" vs "them" tags added before hitting LLM

---

## Electron Window Config
From reversed `preload/index.cjs`:
```js
{
  transparent: true,
  alwaysOnTop: true,
  frame: false,
  skipTaskbar: true,
  webPreferences: {
    preload: join(__dirname, "../preload/index.cjs"),
    // NO sandbox
  }
}
// contextBridge with NO channel allowlist — full IPC exposed
contextBridge.exposeInMainWorld("electron", { ipcRenderer: { send, invoke, on } })
```

---

## Invisible-to-Screen-Share: `setContentProtection(true)`
The entire mechanism:
- **macOS:** Sets `NSWindowSharingNone` on NSWindow → omitted by CGWindowListCreateImage AND ScreenCaptureKit (Google Meet, Teams, all browsers respect this at OS compositor level)
- **Windows:** Calls `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` via DWM → compositor-level enforcement
- **Zoom exception:** Zoom macOS uses raw display pipeline that bypasses NSWindowSharingNone → Cluely IS visible in Zoom screen share
- **Cursor trick:** No `cursor: pointer` CSS on interactive controls → viewers can't infer hover/click from cursor shape
- **Electron v34.3.1+ regression:** `setContentProtection(true)` renders window as opaque black instead of transparent during capture

---

## System Prompt (leaked — stored in plaintext .asar)
Key behaviors:
- Never say "screenshot" — say "the screen"
- Audio transcript is primary; screen is secondary/fallback
- Focus on LAST utterance (final 10-15 words), not full history
- Trigger if 50%+ confident utterance is a question
- Priority: direct question > term definition in last 10-15 words > follow-up > objection handling > screen problem
- Model: never disclosed ("powered by a collection of LLM providers")
- Code: line-by-line comments + complexity + dry run
- Response format: ≤6-word headline, 1-2 bullets ≤15 words, ≤60 chars/line

---

## Full Data Flow
```
macOS native audio
  → base64 PCM over IPC (24kHz)
  → WAV in renderer
  → Deepgram WebSocket (streaming STT)
  → transcript with "me"/"them" speaker tags

captureScreen() via IPC → base64 image

[transcript + screenshot] → system prompt → LLM (GPT-4 confirmed in clones)
  → response in overlay

All stored server-side (83k user breach: transcripts + screenshots)
```

---

## Security Holes (Jack Cable)
1. System prompt in plaintext .asar → DMCA against Cable
2. No IPC channel allowlist → any renderer calls any handler
3. `postMessage` global → any website captures screenshots continuously
4. No `will-navigate` guard on base Window class
5. Admin password in public repo → 83k user data breach

---

## Open Source Clones (ranked by relevance to BLADE)

| Repo | Stack | Audio | STT | Notes |
|------|-------|-------|-----|-------|
| `iamsrikanthnani/pluely` | **Tauri + Rust** | System audio + mic | Whisper / ElevenLabs / Groq | MOST RELEVANT — same stack as BLADE |
| `evinjohnn/natively-cluely-ai-assistant` | Electron + Rust napi | Dual-channel, WebRTC VAD, zero-copy napi::Buffer, <500ms | Deepgram / Soniox / Groq / OpenAI | Best audio impl |
| `shubhamshnd/Open-Cluely` | Electron | Dual-channel (mic + system) | AssemblyAI streaming | Simple |
| `1300Sarthak/CluelyClone` | Electron + React | Web Audio | OpenAI Whisper API | — |
| `Prat011/free-cluely` | Electron | — | — | — |

Original: Interview Coder (Roy Lee, Dec 2024, deleted from GitHub) — what all clones forked from.

---

## Priority Action for BLADE
1. Clone and read `iamsrikanthnani/pluely` — Tauri+Rust, same stack
2. Clone and read `evinjohnn/natively-cluely-ai-assistant` — best audio pipeline
3. Implement `setContentProtection` equivalent in Tauri (already possible via `window.set_content_protected(true)`)
