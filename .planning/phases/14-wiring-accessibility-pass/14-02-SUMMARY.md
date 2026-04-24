---
phase: 14-wiring-accessibility-pass
plan: "02"
subsystem: settings-wiring
tags: [wiring, settings, voice, privacy, intelligence, accessibility, config]
dependency_graph:
  requires:
    - 14-01-SUMMARY.md  # ActivityLogProvider + verify-feature-reachability baseline
    - 10-WIRING-AUDIT.md  # NOT-WIRED list driving workstreams A/B/C
  provides:
    - src/lib/tauri/voice.ts  (voiceStartRecording, voiceStopRecording, ttsSpeak, ttsStop, whisperModelAvailable, voiceIntelStartSession)
    - src/lib/tauri/privacy.ts  (captureScreen, getNotificationRecent, getClipboard, Notification type)
    - src/lib/tauri/intelligence.ts  (getProactiveTasks, proactiveGetPending, proactiveGetCards, causalGetInsights, consequencePredict, brainExtractFromExchange, dreamIsActive, ProactiveTask type)
    - src/lib/tauri/system.ts  (lockScreen, ghostStart, pulseGetDigest, rolesList, setTrayStatus, Role type)
    - VoicePane: tts_speed slider + wake_word controls + use_local_whisper + whisper_model
    - PrivacyPane: screen_timeline_enabled + capture_interval + retention_days + audio_capture_enabled
    - AppearancePane: god_mode toggle + god_mode_tier selector
    - Ghost route: paletteHidden: false + description
    - system-lock-screen palette route
  affects:
    - src/lib/tauri/index.ts
    - src-tauri/src/config.rs  (save_config_field allow-list extended)
    - src/features/settings/panes/VoicePane.tsx
    - src/features/settings/panes/PrivacyPane.tsx
    - src/features/settings/panes/AppearancePane.tsx
    - src/features/ghost/index.tsx
    - src/features/settings/index.tsx
tech_stack:
  added:
    - src/lib/tauri/voice.ts
    - src/lib/tauri/privacy.ts
    - src/lib/tauri/intelligence.ts
    - src/lib/tauri/system.ts
    - src/features/settings/LockScreenAction.tsx
  patterns:
    - invokeTyped wrappers (D-36 file-per-cluster) for 4 backend clusters
    - saveConfigField per-field save (optimistic update + reload pattern from IoTPane)
    - Controlled range inputs with onMouseUp + onKeyUp save triggers
    - Palette-only route (LockScreenAction) with useEffect on mount + navigate back
key_files:
  created:
    - src/lib/tauri/voice.ts
    - src/lib/tauri/privacy.ts
    - src/lib/tauri/intelligence.ts
    - src/lib/tauri/system.ts
    - src/features/settings/LockScreenAction.tsx
  modified:
    - src/lib/tauri/index.ts
    - src-tauri/src/config.rs
    - src/features/settings/panes/VoicePane.tsx
    - src/features/settings/panes/PrivacyPane.tsx
    - src/features/settings/panes/AppearancePane.tsx
    - src/features/ghost/index.tsx
    - src/features/settings/index.tsx
decisions:
  - "Extended save_config_field Rust allow-list rather than adding new Rust commands — 9 new field cases added to the match block; no new #[tauri::command] registrations needed (Rule 1 auto-fix: fields existed in BladeConfig struct but were unreachable from frontend)"
  - "LockScreenAction is a palette-only component that calls lockScreen() on mount then navigates back to 'settings' — never rendered as a full page view"
  - "VoicePane wake_word_enabled state is now writable via save_config_field (field added to allow-list) — removes the Phase 3 read-only placeholder"
  - "Range inputs (tts_speed, wake_word_sensitivity) save on onMouseUp + onKeyUp to avoid firing on every drag tick"
metrics:
  duration: "422s"
  completed: "2026-04-24"
  tasks_completed: 2
  tasks_total: 2
  files_created: 5
  files_modified: 7
---

# Phase 14 Plan 02: Settings Wiring — Voice + Privacy + Intelligence + System Summary

**One-liner:** 4 new invokeTyped wrapper clusters (voice/privacy/intelligence/system) + VoicePane/PrivacyPane/AppearancePane Settings sections wired via saveConfigField + ghost and lock-screen palette entries — 9 config fields added to Rust allow-list.

---

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | TypeScript wrappers — voice.ts + privacy.ts + intelligence.ts + system.ts + barrel export | 6bd5ceb | voice.ts, privacy.ts, intelligence.ts, system.ts, index.ts |
| 2 | Settings pane extensions + ghost palette + lock screen action + config.rs allow-list | 98f635b | VoicePane.tsx, PrivacyPane.tsx, AppearancePane.tsx, ghost/index.tsx, settings/index.tsx, LockScreenAction.tsx, config.rs |

---

## What Was Built

### TypeScript Wrapper Clusters (Task 1)

**voice.ts** — voice.rs + tts.rs + voice_intelligence.rs cluster:
- `voiceStartRecording()`, `voiceStopRecording()` — push-to-talk IPC
- `ttsSpeak(text, speed?)`, `ttsStop()` — TTS with speed control
- `whisperModelAvailable()` — read-only model presence check
- `voiceIntelStartSession()` — meeting transcription start

**privacy.ts** — screen.rs + notification_listener.rs + clipboard.rs cluster:
- `captureScreen()` — returns base64 PNG
- `getNotificationRecent(limit?)` — recent OS notifications with `Notification` type
- `getClipboard()` — current clipboard text (no logging per T-14-02-03)

**intelligence.ts** — godmode.rs + proactive_engine.rs + causal_graph.rs + consequence.rs + brain.rs + dream_mode.rs cluster:
- `getProactiveTasks()`, `proactiveGetPending()`, `proactiveGetCards()` — task feeds
- `causalGetInsights()` — causal graph readout
- `consequencePredict(action)`, `brainExtractFromExchange(exchange)` — LLM-backed
- `dreamIsActive()` — self-improvement loop status

**system.ts** — system_control.rs + ghost_mode.rs + pulse.rs + tray.rs cluster:
- `lockScreen()` — OS lock via system_control
- `ghostStart()` — invisible meeting overlay
- `pulseGetDigest()` — daily briefing markdown
- `rolesList()`, `setTrayStatus(status)` — roles + tray management

All 4 files barrel-exported from `src/lib/tauri/index.ts`.

### Settings Pane Extensions (Task 2)

**VoicePane** — new "Voice Output" card:
- tts_speed range slider (0.5–2.0, saves on mouseup/keyup)
- use_local_whisper checkbox with rebuild note
- whisper_model selector (tiny.en/base.en/small.en, shown only when use_local_whisper)

**VoicePane** — "Wake Word" card replaces read-only Phase 3 stub:
- wake_word_enabled checkbox
- wake_word_phrase text input (shown only when enabled, saves on blur)
- wake_word_sensitivity range slider 1–5 (shown only when enabled)

**PrivacyPane** — new "Screen Timeline" section (after DeepScanPrivacySection):
- screen_timeline_enabled checkbox with aria-describedby
- timeline_capture_interval number input (10–300s, shown only when enabled)
- timeline_retention_days number input (1–365 days, always shown)

**PrivacyPane** — new "Audio Capture" section:
- audio_capture_enabled checkbox with aria-describedby

**AppearancePane** — new "God Mode" section:
- god_mode checkbox (enable ambient intelligence)
- god_mode_tier selector (normal/intermediate/extreme, shown only when god_mode)

**Ghost route** — `paletteHidden: false` + `description: 'Ghost Mode — invisible AI overlay for meetings'` added to `meeting-ghost` RouteDefinition.

**system-lock-screen** — new palette-only route in settings/index.tsx + LockScreenAction component that calls `lockScreen()` on mount then navigates to `settings`.

### Rust config.rs allow-list extension

`save_config_field` extended with 9 new match arms:
- Boolean: `audio_capture_enabled`, `wake_word_enabled`, `use_local_whisper`, `god_mode`
- String: `wake_word_phrase`, `whisper_model`, `god_mode_tier`
- Float: `tts_speed` (f32 via parse())
- Integer: `wake_word_sensitivity` (u8 via parse())

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] save_config_field allow-list was missing 9 config fields**
- **Found during:** Task 2 (before writing Settings pane UI)
- **Issue:** The plan stated "All commands are already registered in lib.rs — no Rust changes. Frontend-only" but `save_config_field` in config.rs only accepted 3 of the required 12 fields (screen_timeline_enabled, timeline_capture_interval, timeline_retention_days). The other 9 fields (tts_speed, wake_word_enabled, wake_word_phrase, wake_word_sensitivity, use_local_whisper, whisper_model, god_mode, god_mode_tier, audio_capture_enabled) were present in BladeConfig but would throw "Unknown config field" at runtime.
- **Fix:** Added 9 new match arms to `save_config_field` in config.rs — boolean, string, float, and integer variants as appropriate for each field type.
- **Files modified:** `src-tauri/src/config.rs`
- **Commit:** 98f635b

---

## Known Stubs

None. All new controls read from `useConfig().config` (real data via IPC) and write via `saveConfigField` (real IPC call). No placeholder values flow to the UI.

---

## Threat Surface Scan

No new network endpoints or auth paths introduced. All surface additions are within the existing `save_config_field` IPC boundary already protected by the Rust allow-list.

| Flag | File | Description |
|------|------|-------------|
| T-14-02-01 satisfied | config.rs | save_config_field allow-list enforces permitted field names; frontend passes string literals from UI controls |
| T-14-02-02 satisfied | voice.ts | ttsSpeak wraps existing tts_speak; output is audio, not executed code |
| T-14-02-03 satisfied | privacy.ts | getClipboard is local-only; no data emitted to activity log by wrapper |
| T-14-02-04 satisfied | config.rs | god_mode_tier validated by allow-list; Rust BladeConfig constrains values via serde |

---

## Self-Check: PASSED

- [x] `src/lib/tauri/voice.ts` — FOUND
- [x] `src/lib/tauri/privacy.ts` — FOUND
- [x] `src/lib/tauri/intelligence.ts` — FOUND
- [x] `src/lib/tauri/system.ts` — FOUND
- [x] `src/features/settings/LockScreenAction.tsx` — FOUND
- [x] Commit 6bd5ceb — FOUND (Task 1)
- [x] Commit 98f635b — FOUND (Task 2)
- [x] `npx tsc --noEmit` — PASS (zero errors)
- [x] `grep "voiceStartRecording\|ttsSpeak" src/lib/tauri/voice.ts` — MATCH
- [x] `grep "captureScreen\|getClipboard" src/lib/tauri/privacy.ts` — MATCH
- [x] `grep "getProactiveTasks\|causalGetInsights" src/lib/tauri/intelligence.ts` — MATCH
- [x] `grep "lockScreen\|pulseGetDigest" src/lib/tauri/system.ts` — MATCH
- [x] `grep "tts_speed" src/features/settings/panes/VoicePane.tsx` — MATCH
- [x] `grep "screen_timeline_enabled" src/features/settings/panes/PrivacyPane.tsx` — MATCH
- [x] `grep "god_mode_tier" src/features/settings/panes/AppearancePane.tsx` — MATCH
- [x] `grep "paletteHidden.*false" src/features/ghost/index.tsx` — MATCH
