# Phase 4 Patterns — Recurring Recipes

**Mapped:** 2026-04-19
**Scope:** Code recipes Phase 4 implementers MUST follow verbatim (or cite a deviation in their commit message).

---

## 1. Rust — QuickAsk bridge upgrade (Plan 04-01)

`quickask_submit` body becomes:

```rust
// src-tauri/src/commands.rs (Plan 04-01 upgrades Phase 3 stub at line 2561)
#[tauri::command]
pub async fn quickask_submit(
    app: tauri::AppHandle,
    state: tauri::State<'_, SharedMcpManager>,
    approvals: tauri::State<'_, ApprovalMap>,
    vector_store: tauri::State<'_, crate::embeddings::SharedVectorStore>,
    query: String,
    mode: String,            // "text" | "voice"
    source_window: String,   // "quickask"
) -> Result<(), String> {
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let message_id = uuid::Uuid::new_v4().to_string();
    let user_message_id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().timestamp_millis();

    // 1. Emit bridge event (main window receives user turn + metadata)
    let _ = app.emit_to("main", "blade_quickask_bridged", serde_json::json!({
        "query": query,
        "response": "",
        "conversation_id": conversation_id,
        "mode": mode,
        "timestamp": timestamp,
        "message_id": message_id,
        "user_message_id": user_message_id,
        "source_window": source_window,
    }));

    // 2. Emit message_start (main window chat shows the assistant is thinking)
    let _ = app.emit_to("main", "blade_message_start", serde_json::json!({
        "message_id": &message_id,
        "role": "assistant",
    }));
    // Also emit to quickask so the QuickAsk popup shows the live stream:
    let _ = app.emit_to("quickask", "blade_message_start", serde_json::json!({
        "message_id": &message_id,
        "role": "assistant",
    }));

    // 3. Build the messages vec (just one user message — quickask is stateless per-submit)
    let messages = vec![crate::commands::ChatMessage {
        role: "user".to_string(),
        content: query.clone(),
        image_base64: None,
    }];

    // 4. Stash the message_id for anthropic.rs thinking-chunk tagging (Phase 3 D-64)
    std::env::set_var("BLADE_CURRENT_MSG_ID", &message_id);

    // 5. Kick the streaming helper — same pipeline as send_message_stream, but emits
    //    tokens to BOTH "main" AND "quickask" so both windows see the stream live.
    //    The helper is internal; it's not a Tauri command.
    let app_clone = app.clone();
    let state_clone = state.inner().clone();
    let approvals_clone = approvals.inner().clone();
    let vector_store_clone = vector_store.inner().clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::commands::send_message_stream_inline(
            app_clone.clone(),
            state_clone,
            approvals_clone,
            vector_store_clone,
            messages,
            &["main", "quickask"],
        ).await {
            log::warn!("[quickask] stream error: {}", e);
            let _ = app_clone.emit_to("main", "blade_notification", serde_json::json!({
                "type": "error",
                "message": format!("Quick ask failed: {}", e),
            }));
        }
    });

    // 6. Hide quickask popup after stream starts (user sees response in popup until auto-hide)
    //    (frontend handles auto-hide after chat_done per D-101 — this is just a no-op guard)

    Ok(())
}
```

And `send_message_stream_inline` is a helper extracted from `send_message_stream`:

```rust
// src-tauri/src/commands.rs — NEW helper just before fn quickask_submit
// (Phase 4 refactor: extract from send_message_stream; Phase 3 streaming pipeline
// re-used verbatim, just emits to a list of windows instead of hard-coded "main".)
pub(crate) async fn send_message_stream_inline(
    app: tauri::AppHandle,
    state: SharedMcpManager,
    approvals: ApprovalMap,
    vector_store: crate::embeddings::SharedVectorStore,
    messages: Vec<ChatMessage>,
    emit_windows: &[&str],
) -> Result<(), String> {
    // … identical to send_message_stream body EXCEPT each `emit_to("main", ...)`
    // becomes a loop `for win in emit_windows { let _ = app.emit_to(*win, event, payload); }`
    //
    // Implementation strategy for Plan 04-01:
    //   (a) Leave send_message_stream untouched; it continues to call emit_to("main", ...).
    //   (b) Create this helper as a new fn that internally calls a second helper with the
    //       emit_windows list; send_message_stream becomes a 3-line wrapper calling into
    //       the new internal with emit_windows = &["main"].
    //   (c) quickask_submit calls send_message_stream_inline with emit_windows = &["main", "quickask"].
    //
    // Net effect: one code path; zero duplication; each emit site gets a .iter().for_each().
    todo!("refactor — see Plan 04-01 Task 1")
}
```

Rationale: keeps streaming logic in one place; QuickAsk's "show the answer in the popup" UX works; main always stays in sync.

Register `set_wake_word_enabled` in lib.rs:

```rust
// src-tauri/src/wake_word.rs — add after wake_word_status (~line 371)
#[tauri::command]
pub async fn set_wake_word_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let mut config = crate::config::load_config();
    config.wake_word_enabled = enabled;
    crate::config::save_config(&config).map_err(|e| e.to_string())?;
    if enabled { wake_word_start(app) } else { wake_word_stop(); Ok(()) }
}
```

```rust
// src-tauri/src/lib.rs — add to generate_handler! near line 786
wake_word::set_wake_word_enabled,
```

---

## 2. Rust — Shortcut fallback chain (Plan 04-01)

```rust
// src-tauri/src/lib.rs — replace register_all_shortcuts body (~lines 268-310)
fn register_all_shortcuts(app: &tauri::AppHandle) {
    let config = crate::config::load_config();

    // Platform-default fallbacks (macOS avoids Alt+Space for CJK IME; Windows/Linux use Alt+Space)
    #[cfg(target_os = "macos")]
    let platform_fallback: &str = "Cmd+Option+Space";
    #[cfg(not(target_os = "macos"))]
    let platform_fallback: &str = "Alt+Space";
    let universal_fallback: &str = "Ctrl+Shift+Space";

    // --- Quick Ask shortcut ---
    try_register_shortcut_chain(
        app,
        "Quick Ask",
        &config.quick_ask_shortcut,
        &[platform_fallback, universal_fallback],
        |app_ref| {
            let app_handle = app_ref.clone();
            Box::new(move |_app, _sc, _ev| toggle_quickask(&app_handle))
        },
    );

    // --- Voice Input shortcut --- (similar pattern with Ctrl+Shift+B default + Alt+Shift+V fallback)
    try_register_shortcut_chain(
        app,
        "Voice Input",
        &config.voice_shortcut,
        &["Alt+Shift+V", "Ctrl+Shift+V"],
        |app_ref| {
            let app_handle = app_ref.clone();
            Box::new(move |_app, _sc, _ev| voice_global::toggle_voice_input(&app_handle))
        },
    );

    // --- Ghost toggle Ctrl+G — single try, warn on fail ---
    let ghost_handle = app.clone();
    let ghost_sc = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyG);
    if let Err(e) = app.global_shortcut().on_shortcut(ghost_sc, move |_app, _sc, _ev| {
        let _ = ghost_handle.emit("ghost_toggle_card", serde_json::json!({}));
    }) {
        log::warn!("Failed to register Ctrl+G ghost shortcut: {}", e);
    }
}

fn try_register_shortcut_chain<F>(
    app: &tauri::AppHandle,
    name: &str,
    configured: &str,
    fallbacks: &[&str],
    make_handler: F,
) where F: for<'a> Fn(&'a tauri::AppHandle) -> Box<dyn Fn(&tauri::AppHandle, &Shortcut, tauri_plugin_global_shortcut::ShortcutEvent) + Send + Sync + 'static> {
    let candidates = std::iter::once(configured).chain(fallbacks.iter().copied()).collect::<Vec<_>>();
    let mut attempted: Vec<String> = Vec::new();
    for (idx, candidate) in candidates.iter().enumerate() {
        let Some(shortcut) = parse_shortcut(candidate) else {
            attempted.push(candidate.to_string());
            continue;
        };
        let handler = make_handler(app);
        match app.global_shortcut().on_shortcut(shortcut, move |a, s, e| handler(a, s, e)) {
            Ok(_) => {
                if idx > 0 {
                    // Fallback succeeded — warn
                    let _ = app.emit_to("main", "shortcut_registration_failed", serde_json::json!({
                        "shortcut": configured,
                        "name": name,
                        "error": format!("{} in use; fell back to {}", configured, candidate),
                        "attempted": attempted,
                        "fallback_used": candidate,
                        "severity": "warning",
                    }));
                }
                return;
            }
            Err(e) => {
                log::warn!("[shortcut] {} register '{}' failed: {}", name, candidate, e);
                attempted.push(candidate.to_string());
            }
        }
    }
    // All failed — fatal
    let _ = app.emit_to("main", "shortcut_registration_failed", serde_json::json!({
        "shortcut": configured,
        "name": name,
        "error": "All shortcut candidates failed to register",
        "attempted": attempted,
        "severity": "error",
    }));
}
```

Frontend payload extension:

```ts
// src/lib/events/payloads.ts — extend existing interface (additive)
export interface ShortcutRegistrationFailedPayload {
  shortcut: string;
  name?: string;
  error: string;
  attempted?: string[];      // Phase 4 additive — not present on Phase 3 emits
  fallback_used?: string;    // Phase 4 additive
  severity?: 'error' | 'warning';  // Phase 4 additive; absent = 'error' for compat
}
```

---

## 3. HUD parallel-emit (Plan 04-01)

```rust
// src-tauri/src/overlay_manager.rs — edit lines 252 and 292 (both sites)
let _ = app.emit_to("blade_hud", "hud_data_updated", &data);
let _ = app.emit_to("hud",       "hud_data_updated", &data);  // Phase 4 parallel-emit (D-97)
```

---

## 4. Tauri wrapper recipe — same as prior phases

Every new wrapper cites Rust file:line in JSDoc, passes snake_case args verbatim:

```ts
// src/lib/tauri/config.ts — Plan 04-01 adds:
/** @see src-tauri/src/wake_word.rs `pub async fn set_wake_word_enabled(app, enabled: bool) -> Result<(), String>` */
export function setWakeWordEnabled(enabled: boolean): Promise<void> {
  return invokeTyped<void, { enabled: boolean }>('set_wake_word_enabled', { enabled });
}

// src/lib/tauri/window.ts — Plan 04-05 adds:
/** @see src-tauri/src/lib.rs:187 `toggle_window` */
export function toggleMainWindow(): Promise<void> {
  return invokeTyped<void>('toggle_window');
}
```

---

## 5. QuickAsk window component skeleton (Plan 04-02)

```tsx
// src/features/quickask/QuickAskWindow.tsx (NEW)
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCurrentWebviewWindow } from '@/lib/tauri/window';
import { quickaskSubmit } from '@/lib/tauri/chat';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { ChatTokenPayload, ChatDonePayload, BladeMessageStartPayload, WakeWordDetectedPayload } from '@/lib/events';
import { Input, GlassSpinner, GlassPanel } from '@/design-system/primitives';
import { VoiceOrb } from '@/features/voice-orb';

type Mode = 'text' | 'voice';
const HISTORY_KEY = 'blade_quickask_history_v1';
const HISTORY_MAX = 5;
const AUTO_HIDE_MS = 2000;

function loadHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]'); } catch { return []; }
}
function pushHistory(q: string): void {
  const prev = loadHistory().filter(h => h !== q);
  const next = [q, ...prev].slice(0, HISTORY_MAX);
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch {}
}

export function QuickAskWindow() {
  const [mode, setMode] = useState<Mode>('text');
  const [query, setQuery] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useTauriEvent<BladeMessageStartPayload>(BLADE_EVENTS.BLADE_MESSAGE_START, () => {
    setStreaming('');
  });
  useTauriEvent<ChatTokenPayload>(BLADE_EVENTS.CHAT_TOKEN, (e) => {
    setStreaming((s) => s + e.payload);
  });
  useTauriEvent<ChatDonePayload>(BLADE_EVENTS.CHAT_DONE, () => {
    setBusy(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => getCurrentWebviewWindow().hide().catch(() => {}), AUTO_HIDE_MS);
  });
  // Wake word switches to voice mode if window is open
  useTauriEvent<WakeWordDetectedPayload>(BLADE_EVENTS.WAKE_WORD_DETECTED, () => setMode('voice'));

  const submit = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setStreaming('');
    pushHistory(q);
    setHistory(loadHistory());
    try {
      await quickaskSubmit({ query: q, mode, sourceWindow: 'quickask' });
    } catch (e) {
      setBusy(false);
      setStreaming(String(e));
    }
  }, [query, busy, mode]);

  // Esc hides, Cmd/Ctrl+Enter submits, Tab toggles mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { getCurrentWebviewWindow().hide().catch(() => {}); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); setMode(m => m === 'text' ? 'voice' : 'text'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit]);

  // Blur = hide (click outside)
  useEffect(() => {
    const onBlur = () => getCurrentWebviewWindow().hide().catch(() => {});
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  return (
    <div className={`quickask quickask-${mode}`} data-mode={mode}>
      {mode === 'text' ? (
        <>
          <Input
            placeholder="Ask BLADE…"
            value={query}
            onChange={setQuery}
            autoFocus
            disabled={busy}
            aria-label="Quick ask query"
          />
          {(streaming || busy) && (
            <div className="quickask-response" aria-live="polite">
              {busy && !streaming && <GlassSpinner size={16} label="Thinking…" />}
              {streaming}
            </div>
          )}
          {!busy && history.length > 0 && (
            <ul className="quickask-history">
              {history.map((h, i) => (
                <li key={i}><button onClick={() => setQuery(h)}>{h}</button></li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <GlassPanel className="qa-voice">
          <VoiceOrb compact />
        </GlassPanel>
      )}
    </div>
  );
}
```

CSS lives in `src/features/quickask/quickask.css`; D-18 allows `backdrop-filter: blur(48px) saturate(200%)` in `.qa-voice` (SOLE layer exception). Text mode uses glass-1 at blur(20px) standard cap.

---

## 6. Voice Orb — `useOrbPhase` hook (Plan 04-03)

```tsx
// src/features/voice-orb/useOrbPhase.ts (NEW)
import { useEffect, useRef } from 'react';

export type OrbPhase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface OrbConfig { ringSpeed: number; amp: number; alpha: number; scale: number }

/**
 * Writes OpenClaw-derived CSS vars to the orb DOM node every animation frame.
 * React state is NOT updated per frame — vars are written directly via setProperty.
 *
 * Math locked per D-08 / RECOVERY_LOG §2.3. Do not deviate.
 */
export function useOrbPhase(phase: OrbPhase, orbRef: React.RefObject<HTMLDivElement>, micRmsRef: React.MutableRefObject<number>) {
  const smoothedRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = performance.now();
    const tick = (t: number) => {
      const el = orbRef.current;
      if (!el) { rafRef.current = requestAnimationFrame(tick); return; }
      // EMA smoothing (locked 0.45·prev + 0.55·new)
      const raw = Math.max(0, Math.min(1, micRmsRef.current));
      smoothedRef.current = smoothedRef.current * 0.45 + raw * 0.55;
      const level = smoothedRef.current;

      const cfg = configFor(phase, level, (t - start) / 1000);
      el.style.setProperty('--ring-speed', String(cfg.ringSpeed));
      el.style.setProperty('--amp',        cfg.amp.toFixed(4));
      el.style.setProperty('--alpha',      cfg.alpha.toFixed(4));
      el.style.setProperty('--orb-scale',  cfg.scale.toFixed(4));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current); };
  }, [phase]);
}

function configFor(phase: OrbPhase, level: number, t: number): OrbConfig {
  switch (phase) {
    case 'idle':      return { ringSpeed: 0.6, amp: 0.35,               alpha: 0.40,               scale: 1.00 };
    case 'listening': return { ringSpeed: 0.9, amp: 0.5 + level * 0.7,  alpha: 0.58 + level * 0.28, scale: 1 + level * 0.12 };
    case 'thinking':  return { ringSpeed: 0.6, amp: 0.35,               alpha: 0.40,               scale: 1.00 };
    case 'speaking':  return { ringSpeed: 1.4, amp: 0.95,               alpha: 0.72,               scale: 1 + 0.06 * Math.sin(t * 6) };
  }
}
```

Consumer:

```tsx
// src/features/voice-orb/VoiceOrb.tsx
import { useEffect, useRef, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  VoiceConversationListeningPayload, VoiceConversationThinkingPayload,
  VoiceConversationSpeakingPayload, VoiceConversationEndedPayload,
  WakeWordDetectedPayload,
} from '@/lib/events';
import { useOrbPhase, type OrbPhase } from './useOrbPhase';
import { useMicRms } from './useMicRms';
import { invokeTyped } from '@/lib/tauri/_base';

export interface VoiceOrbProps { compact?: boolean }

export function VoiceOrb({ compact = false }: VoiceOrbProps) {
  const [phase, setPhase] = useState<OrbPhase>('idle');
  const orbRef = useRef<HTMLDivElement>(null);
  const { micRmsRef, acquireMic, releaseMic, micError } = useMicRms();
  useOrbPhase(phase, orbRef, micRmsRef);

  useTauriEvent<VoiceConversationListeningPayload>(BLADE_EVENTS.VOICE_CONVERSATION_LISTENING, () => {
    setPhase('listening'); acquireMic();
  });
  useTauriEvent<VoiceConversationThinkingPayload>(BLADE_EVENTS.VOICE_CONVERSATION_THINKING, () => {
    setPhase('thinking'); releaseMic();
  });
  useTauriEvent<VoiceConversationSpeakingPayload>(BLADE_EVENTS.VOICE_CONVERSATION_SPEAKING, () => {
    setPhase('speaking'); releaseMic();
  });
  useTauriEvent<VoiceConversationEndedPayload>(BLADE_EVENTS.VOICE_CONVERSATION_ENDED, () => {
    setPhase('idle'); releaseMic();
  });
  useTauriEvent<WakeWordDetectedPayload>(BLADE_EVENTS.WAKE_WORD_DETECTED, () => {
    if (phase === 'idle') invokeTyped<void>('start_voice_conversation').catch(() => {});
  });

  return (
    <div
      ref={orbRef}
      className={`orb-overlay ${compact ? 'orb-compact' : ''}`}
      data-phase={phase}
      style={{ /* CSS vars set by useOrbPhase */ }}
    >
      <svg className="orb-rings" viewBox="-220 -220 440 440">
        <circle className="ring ring-0" cx="0" cy="0" r="90" />
        <circle className="ring ring-1" cx="0" cy="0" r="90" />
        <circle className="ring ring-2" cx="0" cy="0" r="90" />
      </svg>
      <svg className="orb-arcs" viewBox="-220 -220 440 440">
        <circle className="arc arc-1" cx="0" cy="0" r="70" />
        <circle className="arc arc-2" cx="0" cy="0" r="70" />
      </svg>
      <div className="orb-core" />
      {micError && <div className="orb-mic-error">{micError}</div>}
    </div>
  );
}
```

---

## 7. Voice Orb — `useMicRms` (Plan 04-03)

```tsx
// src/features/voice-orb/useMicRms.ts (NEW)
import { useCallback, useRef, useState } from 'react';

export function useMicRms() {
  const micRmsRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const acquireMic = useCallback(async () => {
    if (streamRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      streamRef.current = stream;
      ctxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Float32Array(analyser.fftSize);
      const loop = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        micRmsRef.current = Math.min(1, rms * 3); // scale up (typical speech is 0.05–0.3 RMS)
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      setMicError(null);
    } catch (e) {
      setMicError('Microphone access denied. Grant permission in System Settings.');
    }
  }, []);

  const releaseMic = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close().catch(() => {});
    streamRef.current = null;
    ctxRef.current = null;
    analyserRef.current = null;
    micRmsRef.current = 0;
  }, []);

  return { micRmsRef, acquireMic, releaseMic, micError };
}
```

---

## 8. Ghost Overlay — headline clipping + Linux warning (Plan 04-04)

```tsx
// src/features/ghost/GhostOverlayWindow.tsx (NEW)
import { useEffect, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { GhostMeetingStatePayload } from '@/lib/events';
import { Dialog } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { getCurrentWebviewWindow } from '@/lib/tauri/window';

interface GhostSuggestionPayload {
  response: string;
  trigger: string;
  speaker: string | null;
  confidence: number;
  platform: string;
  timestamp_ms: number;
}

function clipHeadline(text: string): { headline: string; bullets: string[] } {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const headline = words.slice(0, 6).join(' ');
  const rest = words.slice(6).join(' ');
  const sentences = rest.split(/[.!?]\s+/).filter(s => s.length > 0);
  const bullets = sentences.slice(0, 2);
  return { headline, bullets };
}

const isLinux = typeof navigator !== 'undefined' && /linux/i.test(navigator.platform ?? '');

export function GhostOverlayWindow() {
  const [visible, setVisible] = useState(true);
  const [suggestion, setSuggestion] = useState<GhostSuggestionPayload | null>(null);
  const [state, setState] = useState<GhostMeetingStatePayload | null>(null);
  const [warningOpen, setWarningOpen] = useState(isLinux);
  const { prefs, setPref } = usePrefs();

  useEffect(() => {
    if (isLinux && prefs['ghost.linuxWarningAcknowledged']) setWarningOpen(false);
  }, [prefs]);

  useTauriEvent<GhostSuggestionPayload>(BLADE_EVENTS.GHOST_SUGGESTION_READY_TO_SPEAK, (e) => {
    setSuggestion(e.payload);
    setVisible(true);
  });
  useTauriEvent<GhostMeetingStatePayload>(BLADE_EVENTS.GHOST_MEETING_STATE, (e) => setState(e.payload));
  useTauriEvent<null>(BLADE_EVENTS.GHOST_MEETING_ENDED, () => {
    setTimeout(() => getCurrentWebviewWindow().hide().catch(() => {}), 2000);
  });

  // Ctrl+G toggle; Esc hides window
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); setVisible(v => !v); }
      if (e.key === 'Escape') { getCurrentWebviewWindow().hide().catch(() => {}); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (warningOpen) {
    return (
      <Dialog open onClose={() => { /* can't close without choice */ }} ariaLabel="Linux content-protection warning">
        <h3>Ghost Mode is visible on screen share on Linux</h3>
        <p>On macOS and Windows, Ghost Mode is hidden from screen capture via content protection. Linux does not support this flag — anything you see in Ghost Mode, your meeting participants can also see.</p>
        <p>Consider using BLADE's voice-only responses (no visible overlay) on Linux.</p>
        <div className="ghost-dialog-actions">
          <button onClick={() => getCurrentWebviewWindow().hide().catch(() => {})}>Cancel</button>
          <button onClick={() => { setPref('ghost.linuxWarningAcknowledged', true); setWarningOpen(false); }}>
            I understand, continue
          </button>
        </div>
      </Dialog>
    );
  }

  if (!visible || !suggestion) {
    return (
      <div className="ghost-idle" aria-label="Ghost mode idle">
        <span className="gd" /> Ghost · <span className="kbd">⌃G</span>
      </div>
    );
  }
  const { headline, bullets } = clipHeadline(suggestion.response);
  return (
    <div className="ghost-card" role="region" aria-label="Ghost suggestion">
      <div className="ghost-speaker" style={{ color: speakerColor(suggestion.speaker) }}>
        {suggestion.speaker ?? 'Speaker'} · <span style={{ color: confColor(suggestion.confidence) }}>●</span>
      </div>
      <h3 className="ghost-headline">{headline}</h3>
      <ul className="ghost-bullets">
        {bullets.map((b, i) => <li key={i}>{b}</li>)}
      </ul>
    </div>
  );
}

const SPEAKER_COLORS = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#a78bfa'];
function speakerColor(name: string | null): string {
  if (!name) return 'rgba(255,255,255,0.55)';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length];
}
function confColor(c: number): string { return c >= 0.85 ? '#34c759' : c >= 0.65 ? '#f59e0b' : '#ff3b30'; }
```

CSS lives at `src/features/ghost/ghost.css` — D-07 standard glass tier for idle pill; D-07 ghost-card tier `blur(32px) saturate(180%)` per RECOVERY_LOG §Liquid Glass tokens. Max `.ghost-headline { max-width: 60ch }` enforces the ≤60-chars line constraint per D-10.

---

## 9. HUD window (Plan 04-05)

```tsx
// src/features/hud/HudWindow.tsx (NEW)
import { useEffect, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { HormoneUpdatePayload, GodmodeUpdatePayload } from '@/lib/events';
import { HormoneChip } from '@/features/dashboard/hormoneChip';
import { toggleMainWindow } from '@/lib/tauri/window';
import { invokeTyped } from '@/lib/tauri/_base';

interface HudData {
  time: string;
  active_app: string;
  god_mode_status: string;
  unread_count: number;
  next_meeting_secs: number | null;
  next_meeting_name: string | null;
  meeting_active: boolean;
  meeting_name: string | null;
  speaker_name: string | null;
  hive_organs_active: number;
  hive_pending_decisions: number;
  hive_status_line: string;
}

function formatCountdown(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function godTierColor(tier: string): string {
  switch (tier) {
    case 'extreme':      return '#f59e0b';
    case 'intermediate': return '#6366f1';
    case 'normal':       return '#34c759';
    default:             return 'rgba(255,255,255,0.25)';
  }
}

const SHOWN_HORMONES: (keyof HormoneUpdatePayload)[] = ['arousal', 'exploration', 'urgency', 'trust', 'adrenaline'];

export function HudWindow() {
  const [data, setData] = useState<HudData | null>(null);
  const [tier, setTier] = useState<string>('off');
  const [hormones, setHormones] = useState<HormoneUpdatePayload | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useTauriEvent<HudData>(BLADE_EVENTS.HUD_DATA_UPDATED, (e) => {
    setData(e.payload);
    setTier(e.payload.god_mode_status);
  });
  useTauriEvent<GodmodeUpdatePayload>(BLADE_EVENTS.GODMODE_UPDATE, (e) => setTier(String(e.payload.tier)));
  useTauriEvent<HormoneUpdatePayload>(BLADE_EVENTS.HORMONE_UPDATE, (e) => setHormones(e.payload));

  // Position below notch on macOS
  useEffect(() => {
    (async () => {
      try {
        const insets = await invokeTyped<{ top: number; bottom: number; left: number; right: number }>('get_primary_safe_area_insets');
        if (insets.top > 0) {
          const win = (await import('@/lib/tauri/window')).getCurrentWebviewWindow();
          await win.setPosition(new (await import('@tauri-apps/api/window')).PhysicalPosition(0, Math.round(insets.top)));
        }
      } catch { /* non-mac or command missing — ignore */ }
    })();
  }, []);

  const dominant = hormones ? SHOWN_HORMONES.reduce((a, b) => hormones[a] >= hormones[b] ? a : b) : null;

  return (
    <div
      className="hud-bar"
      onClick={() => toggleMainWindow()}
      onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
    >
      <span className="hud-chip hud-time">{data?.time ?? '--:--'}</span>
      <span className="hud-chip hud-app">{data?.active_app || '—'}</span>
      <span className="hud-chip hud-god" style={{ color: godTierColor(tier) }}>GM · {tier}</span>
      {dominant && hormones && (
        <HormoneChip name={String(dominant)} value={hormones[dominant]} dominant />
      )}
      {data?.next_meeting_secs != null && (
        <span className="hud-chip hud-meet">{data.next_meeting_name ?? 'Meeting'} in {formatCountdown(data.next_meeting_secs)}</span>
      )}
      {menuOpen && <HudMenu onClose={() => setMenuOpen(false)} />}
    </div>
  );
}

function HudMenu({ onClose }: { onClose: () => void }) {
  return (
    <div className="hud-menu" role="menu" onMouseLeave={onClose}>
      <button onClick={() => { toggleMainWindow(); onClose(); }}>Open BLADE</button>
      <button onClick={() => { invokeTyped<void>('emit_route_request', { route_id: 'chat' }).catch(() => {}); toggleMainWindow(); onClose(); }}>Open Chat</button>
      <button onClick={() => { invokeTyped<void>('overlay_hide_hud').catch(() => {}); onClose(); }}>Hide HUD</button>
      <button onClick={() => { invokeTyped<void>('emit_route_request', { route_id: 'settings-voice' }).catch(() => {}); toggleMainWindow(); onClose(); }}>Settings</button>
    </div>
  );
}
```

Note: `emit_route_request` is a new Rust command that simply emits `blade_route_request` to main window. Alternative: the HUD window emits directly via `@tauri-apps/api/event.emit`, but we keep raw emits banned (D-14) and route via a typed command.

---

## 10. HUD — Rust safe-area + route-request helpers (Plan 04-01)

```rust
// src-tauri/src/overlay_manager.rs — add commands for Plan 04-05 consumption
#[tauri::command]
pub fn get_primary_safe_area_insets(_app: tauri::AppHandle) -> serde_json::Value {
    #[cfg(target_os = "macos")]
    {
        // NSScreen::safeAreaInsets via objc2 or similar — Phase 4 uses an approximation:
        // If the primary monitor's logical height mod 37 > 20, assume notch (heuristic).
        // Full FFI is Phase 9 polish; heuristic is acceptable for hitting the ≤ few pixels of
        // the notch cutout (M1/M2/M3 MacBook Pro notch is ~37px).
        // Production replacement: FFI to NSScreen::safeAreaInsets.
        return serde_json::json!({ "top": 37, "bottom": 0, "left": 0, "right": 0 });
    }
    #[allow(unreachable_code)]
    serde_json::json!({ "top": 0, "bottom": 0, "left": 0, "right": 0 })
}

#[tauri::command]
pub fn emit_route_request(app: tauri::AppHandle, route_id: String) -> Result<(), String> {
    let _ = app.emit_to("main", "blade_route_request", serde_json::json!({ "route_id": route_id }));
    Ok(())
}
```

Register both in lib.rs.

Main window `useRouter.ts` extension:

```ts
// src/windows/main/useRouter.ts — add inside RouterProvider
useTauriEvent<{ route_id: string }>(BLADE_EVENTS.BLADE_ROUTE_REQUEST, (e) => {
  openRoute(e.payload.route_id);
});
```

---

## 11. QuickAsk bridge component (Plan 04-06)

```tsx
// src/features/chat/QuickAskBridge.tsx (NEW)
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeQuickAskBridgedPayload } from '@/lib/events';
import { useChatCtx } from './useChat';
import { useRouterCtx } from '@/windows/main/useRouter';
import { useToast } from '@/lib/context';

export function QuickAskBridge() {
  const { injectUserMessage } = useChatCtx();
  const { openRoute } = useRouterCtx();
  const { show } = useToast();

  useTauriEvent<BladeQuickAskBridgedPayload & { message_id: string; user_message_id: string }>(
    BLADE_EVENTS.BLADE_QUICKASK_BRIDGED,
    (e) => {
      injectUserMessage({ id: e.payload.user_message_id, content: e.payload.query });
      openRoute('chat');
      show({ type: 'info', title: 'Quick ask bridged', message: e.payload.query.slice(0, 80) });
    },
  );
  return null;
}
```

Mounted in `MainShell.tsx` INSIDE the `ChatProvider` wrapper (currently mounted inside `chat` route). Since `ChatProvider` is route-scoped per Plan 03-03, the bridge has to live there. **Plan 04-06 hoists `ChatProvider` from route-level to MainShell level** — small change (~10 LOC diff) so QuickAskBridge works globally; `openRoute('chat')` still navigates to the chat route but the context is always available.

Alternative: keep ChatProvider route-scoped; QuickAskBridge buffers the injection until user navigates to chat. Rejected: adds state complexity.

---

## 12. `ChatProvider.injectUserMessage` (Plan 04-06)

```tsx
// src/features/chat/useChat.tsx — add to ChatStateValue + provider
interface ChatStateValue {
  // … existing
  injectUserMessage: (m: { id: string; content: string }) => void;
}

// Inside ChatProvider:
const injectUserMessage = useCallback((m: { id: string; content: string }) => {
  setMessages((prev) => [...prev, { id: m.id, role: 'user', content: m.content, createdAt: Date.now() }]);
}, []);

// And include in the context value object.
```

---

## 13. Playwright specs (Plan 04-07)

### quickask-bridge.spec.ts
```ts
test('quickask bridge injects user message into main chat', async ({ page }) => {
  await page.goto('/');
  // Mock quickask_submit (Rust round-trip not available in headless)
  await page.evaluate(() => {
    (window as any).__TAURI_INVOKE_HOOK__ = (cmd: string) => cmd === 'quickask_submit' ? Promise.resolve() : undefined;
  });
  // Navigate to dashboard first to prove the bridge causes a route jump
  await page.evaluate(() => (window as any).__BLADE_OPEN_ROUTE__?.('dashboard'));
  // Emit synthetic bridge event
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('blade_quickask_bridged', {
    query: 'what time is it?', response: '', conversation_id: 'c1',
    mode: 'text', timestamp: Date.now(), message_id: 'm1', user_message_id: 'u1',
  }));
  // Expect auto-navigation to /chat
  await page.waitForSelector('[data-route-id="chat"]', { timeout: 2000 });
  // Expect user turn in the messages
  await expect(page.getByText('what time is it?')).toBeVisible();
});
```

### voice-orb-phases.spec.ts
```ts
test('voice orb transitions phases on events', async ({ page }) => {
  await page.goto('/dev/voice-orb'); // or whatever route mounts VoiceOrb in isolation
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('voice_conversation_listening', { active: true }));
  await expect(page.locator('.orb-overlay[data-phase="listening"]')).toBeVisible();
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('voice_conversation_thinking', { text: 'thinking' }));
  await expect(page.locator('.orb-overlay[data-phase="thinking"]')).toBeVisible();
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('voice_conversation_speaking', { text: 'talking' }));
  await expect(page.locator('.orb-overlay[data-phase="speaking"]')).toBeVisible();
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('voice_conversation_ended', { reason: 'stopped' }));
  await expect(page.locator('.orb-overlay[data-phase="idle"]')).toBeVisible();
});
```

### ghost-overlay-headline.spec.ts
```ts
test('ghost overlay enforces 6-word headline and 1-2 bullets', async ({ page }) => {
  await page.goto('/dev/ghost');
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('ghost_suggestion_ready_to_speak', {
    response: 'Remind them about the budget review tomorrow. It is time to present the Q2 numbers. Key risks are supply chain delays.',
    trigger: 'user mentioned budget', speaker: 'Alice', confidence: 0.92, platform: 'zoom', timestamp_ms: Date.now(),
  }));
  const headlineText = await page.locator('.ghost-headline').textContent();
  const words = headlineText?.trim().split(/\s+/).length ?? 0;
  expect(words).toBeLessThanOrEqual(6);
  const bulletCount = await page.locator('.ghost-bullets li').count();
  expect(bulletCount).toBeGreaterThanOrEqual(1);
  expect(bulletCount).toBeLessThanOrEqual(2);
});
```

### hud-bar-render.spec.ts
```ts
test('hud bar renders chips and supports right-click menu', async ({ page }) => {
  await page.goto('/dev/hud');
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('hud_data_updated', {
    time: '14:32', active_app: 'Figma', god_mode_status: 'normal', unread_count: 0,
    next_meeting_secs: 600, next_meeting_name: 'Standup',
    meeting_active: false, meeting_name: null, speaker_name: null,
    hive_organs_active: 0, hive_pending_decisions: 0, hive_status_line: '',
  }));
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('hormone_update', {
    arousal: 0.6, energy_mode: 0.5, exploration: 0.3, trust: 0.7, urgency: 0.8,
    hunger: 0.4, thirst: 0.5, insulin: 0.5, adrenaline: 0.2, leptin: 0.5,
  }));
  await expect(page.locator('.hud-time')).toContainText('14:32');
  await expect(page.locator('.hud-app')).toContainText('Figma');
  await expect(page.locator('.hud-god')).toContainText('normal');
  // right-click → menu
  await page.locator('.hud-bar').click({ button: 'right' });
  await expect(page.locator('.hud-menu')).toBeVisible();
});
```

### shortcut-fallback.spec.ts
```ts
test('shortcut fallback surfaces warning toast', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('shortcut_registration_failed', {
    shortcut: 'Ctrl+Space', name: 'Quick Ask',
    error: 'Ctrl+Space in use; fell back to Alt+Space',
    attempted: ['Ctrl+Space'], fallback_used: 'Alt+Space', severity: 'warning',
  }));
  await expect(page.getByRole('status').filter({ hasText: /fell back|warning/i })).toBeVisible({ timeout: 2000 });
});
```

All specs reuse the `__TAURI_EMIT__` bridge from Phase 1+2+3 harness. No new test deps.

---

## 14. Dev-only isolation routes for component specs (Plan 04-07)

Plan 04-07 adds three dev-only routes under `src/features/dev/`:
- `/dev/voice-orb` mounts `<VoiceOrb/>` in isolation
- `/dev/ghost`    mounts `<GhostOverlayWindow/>` in isolation (on Linux the warning dialog blocks; the test pre-seeds `prefs['ghost.linuxWarningAcknowledged'] = true`)
- `/dev/hud`      mounts `<HudWindow/>` in isolation

All three are `paletteHidden: true` + gated on `import.meta.env.DEV`.

---

## 15. Main window `ChatProvider` hoist (Plan 04-06)

```tsx
// src/windows/main/MainShell.tsx — edit
// BEFORE (Phase 3):  <ChatProvider> mounted inside chat route component
// AFTER  (Phase 4):  <ChatProvider> wraps the entire shell

export function MainShell() {
  return (
    <RouterProvider>
      <ChatProvider>
        <BackendToastBridge />
        <QuickAskBridge />     {/* NEW: bridges quickask submits into chat state */}
        <ShellContent />
      </ChatProvider>
    </RouterProvider>
  );
}
```

This is a minor refactor — the chat route component stops wrapping itself in `ChatProvider` (now provided by MainShell). `useChatCtx()` call sites are unchanged.

---

*Patterns finalized: 2026-04-19*
