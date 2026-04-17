# Cluely (Real) — Public Research Notes
Source: Leaked system prompts, reverse engineering writeups, press, demo videos
Date: 2026-04-15
Note: Closed source. All info from public sources only.

---

## What It Is
Electron app (not open source). AI assistant for meetings/calls/interviews.
Always-on audio transcription + screen OCR. Surfaces suggestions invisibly.

---

## Window
- Frameless, transparent, borderless Electron window
- `frame: false, alwaysOnTop: true, transparent: true`
- No taskbar entry, no system tray icon  
- Draggable, multi-monitor support
- Small floating bar in corner

---

## Always-On Pipeline
Both tracks run simultaneously:
1. **Continuous audio transcription** — always on, no push-to-talk, no indicator
2. **Screen OCR** — always running
3. **Ambient auto-fire** — detects question at end of transcript, fires automatically
4. **Hotkey on-demand** — CMD+Enter asks about current screen/audio

CMD+R clears context. CMD+\ shows/hides bar.

---

## Response Format (from leaked system prompt)
```
- ≤6 word headline
- 1-2 bullets, ≤15 words each
- ≤60 characters per line (for peripheral reading during calls)
- No paragraphs, no markdown headers, no filler
- Silence is default — only respond when actionable trigger present
- Only respond to LAST question detected, not full conversation
```

---

## Visual Design
- Anti-UI philosophy — designed to NOT draw attention
- No "recording" indicator, no waveform, no spinner
- Dark, low-contrast translucent bar
- Responses appear inline in the same bar
- Keyboard shortcut hints always visible

---

## Sources
- Reverse-engineering writeup: https://prathit.vercel.app/blog/reverse-engineering-cluely
- Leaked system prompt: https://gist.github.com/cablej/ccfe7fe097d8bbb05519bacfeb910038
- Open-source clone: https://github.com/nwx77/cheap-cluely
