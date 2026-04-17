# cheap-cluely — Deep Read (Open Source Cluely Clone)
Source: https://github.com/nwx77/cheap-cluely (cloned /tmp/research/cheap-cluely/)
Date: 2026-04-15
Note: This is a Python clone, NOT the real Cluely. Real Cluely is closed-source.

---

## What It Is
Python + PyQt5 desktop overlay. Captures audio (Whisper) + screen (OCR) continuously.
On hotkey or detected question, sends context to Gemini and shows response in floating overlay.

---

## State Machine (Implicit — no enum)
States via component flags:
- `AudioCapture.is_recording` (bool)
- `ScreenCapture.is_capturing` (bool)
- `OverlayUI.is_visible` (bool)
- Status label: "Ready" | "Processing..." | "Error" | "Thinking..."

Transitions: Ready → Processing (on query) → Ready (on response) / Error (on fail)

---

## Window Overlay
File: `overlay_ui.py` lines 29-35

```python
self.setWindowFlags(
    Qt.WindowStaysOnTopHint |    # Always on top
    Qt.FramelessWindowHint |     # No window frame
    Qt.Tool                      # No taskbar icon, hidden from Alt+Tab
)
self.setAttribute(Qt.WA_TranslucentBackground)   # Transparent bg
self.setAttribute(Qt.WA_ShowWithoutActivating)   # Never steals focus
```

Visual: `rgba(30, 30, 30, 0.9)`, border-radius 10px, `1px solid rgba(255,255,255,0.2)`
Dimensions: 400×300px, top-right corner (screen.width - 400 - 20, 20)
Drag: standard mouse press/move delta

---

## Audio Capture
File: `audio_capture.py`

- Daemon thread, infinite loop
- Records 5-second chunks (`sd.rec(5 * 16000, samplerate=16000, channels=1, dtype=float32)`)
- Transcribes each chunk with local Whisper "small" model
- Rolling buffer: last 10 chunks (last 5 minutes)
- **No VAD** — records continuously regardless of silence
- Buffer: `[{'text': str, 'timestamp': float}]`

Config: `AUDIO_SAMPLE_RATE=16000, AUDIO_CHANNELS=1, AUDIO_RECORD_SECONDS=5`

---

## Screen Capture (OCR)
File: `screen_capture.py`

- Daemon thread, polls every 2 seconds
- Primary: `screen-ocr` library
- Fallback: `PIL.ImageGrab + pytesseract`
- Stores: `current_screen_text: str`, `last_capture_time: float`
- Cleans: strips short lines, normalizes whitespace, filters <10 chars

---

## Audio → Gemini Prompt
File: `gemini_client.py`

```python
prompt = [
    "You are Cluely, an AI assistant...",
    f"SCREEN CONTENT:\n{screen_context}\n\n",
    f"MEETING AUDIO TRANSCRIPT:\n{audio_context}\n\n",
    f"USER QUESTION: {user_query}\n\nASSISTANT:"
]
```

- Model: `gemini-2.0-flash`
- API key rotation on PermissionDenied
- No streaming — full response shown at once

---

## Threading Model
1. Main thread: Qt event loop + signal/slot
2. AudioCapture thread: daemon, infinite, 5s chunks
3. ScreenCapture thread: daemon, 2s polling
4. AssistantThread (QThread): spawned per query, dies after response
5. HotkeyManager: `keyboard` library internal thread

No explicit locks — relies on Python GIL + atomic assignments

---

## Hotkeys
- Toggle: `ctrl+alt+c`
- Voice: `ctrl+alt+v`
- `suppress=True` — invisible to other apps

---

## No Audio Level Visualization
The clone has ZERO audio waveform/level display.
Status states only: text label changes.

---

## Key Difference from Real Cluely
Real Cluely:
- Frameless transparent Electron app
- Continuous audio + screen OCR always running (no user prompt needed)
- Auto-fires when question detected at end of transcript
- Response format: ≤6-word headline + 1-2 bullets at ≤15 words each, ≤60 chars/line
- Silence is default — no response unless triggered
- CMD+R clears context, CMD+\ shows/hides
