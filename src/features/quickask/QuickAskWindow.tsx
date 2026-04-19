// src/features/quickask/QuickAskWindow.tsx (QUICK-01, 02, 03, 06, 07)
//
// Top-level QuickAsk window — replaces the Phase 1 placeholder. Hosts a
// single component with two sub-modes (`text` | `voice`) per D-98.
//
// Responsibilities:
//   - Owns mode state (Tab toggles text↔voice; D-98 + WAKE_WORD_DETECTED flips to voice)
//   - Owns busy + streaming buffer (simple setState concat — QuickAsk is ephemeral;
//     the Phase 3 rAF pattern in useChat is overkill for a ~seconds-long window)
//   - Subscribes 4 Tauri events via useTauriEvent (D-13 discipline, no raw listen())
//   - localStorage history (blob `blade_quickask_history_v1`, max 5, dedup on submit — D-99)
//   - Esc hides, blur (click-outside) hides, chat_done schedules 2s auto-hide (D-101)
//   - Cmd/Ctrl+Enter submits (text mode only)
//
// Streaming path (D-100): quickaskSubmit → Rust parallel-emits chat_token /
// chat_done to BOTH main AND quickask → this window accumulates streaming
// in-window while main's ChatProvider receives the bridged conversation.
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-98..D-101
// @see .planning/phases/04-overlay-windows/04-PATTERNS.md §5

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  BladeMessageStartPayload,
  ChatDonePayload,
  ChatTokenPayload,
  WakeWordDetectedPayload,
} from '@/lib/events';
import { quickaskSubmit } from '@/lib/tauri/chat';
import { getCurrentWebviewWindow } from '@/lib/tauri/window';
import { QuickAskText } from './QuickAskText';
import { QuickAskVoice } from './QuickAskVoice';

type Mode = 'text' | 'voice';

// ── History helpers (D-99) ────────────────────────────────────────────────
const HISTORY_KEY = 'blade_quickask_history_v1';
const HISTORY_MAX = 5;
/** Auto-hide delay after chat_done (D-101). */
const AUTO_HIDE_MS = 2000;

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, HISTORY_MAX);
  } catch {
    return [];
  }
}

function pushHistory(q: string): string[] {
  const trimmed = q.trim();
  if (!trimmed) return loadHistory();
  const prev = loadHistory().filter((h) => h !== trimmed);
  const next = [trimmed, ...prev].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota / privacy mode — ignore */
  }
  return next;
}

// ── Component ─────────────────────────────────────────────────────────────

export function QuickAskWindow() {
  const [mode, setMode] = useState<Mode>('text');
  const [query, setQuery] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Streaming subscribers (D-100) ───────────────────────────────────────
  useTauriEvent<BladeMessageStartPayload>(
    BLADE_EVENTS.BLADE_MESSAGE_START,
    () => {
      setStreaming('');
    },
  );
  useTauriEvent<ChatTokenPayload>(BLADE_EVENTS.CHAT_TOKEN, (e) => {
    setStreaming((s) => s + e.payload);
  });
  useTauriEvent<ChatDonePayload>(BLADE_EVENTS.CHAT_DONE, () => {
    setBusy(false);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      getCurrentWebviewWindow()
        .hide()
        .catch(() => {
          /* window closed / label missing — ignore */
        });
    }, AUTO_HIDE_MS);
  });
  // Wake word while QuickAsk is open → switch to voice mode (D-98).
  useTauriEvent<WakeWordDetectedPayload>(
    BLADE_EVENTS.WAKE_WORD_DETECTED,
    () => {
      setMode('voice');
    },
  );

  // Clean up the hide timer on unmount.
  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  // ── Submit handler (D-100) ──────────────────────────────────────────────
  const submit = useCallback(async () => {
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    setStreaming('');
    const nextHistory = pushHistory(q);
    setHistory(nextHistory);
    try {
      await quickaskSubmit({ query: q, mode, sourceWindow: 'quickask' });
    } catch (e) {
      setBusy(false);
      setStreaming(typeof e === 'string' ? e : String(e));
    }
  }, [query, busy, mode]);

  // ── Keyboard: Esc hides, Cmd/Ctrl+Enter submits, Tab toggles mode ──────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        getCurrentWebviewWindow()
          .hide()
          .catch(() => {});
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (mode === 'text') void submit();
        return;
      }
      if (e.key === 'Tab') {
        // Tab toggles text → voice; Shift+Tab toggles voice → text.
        // Both directions preventDefault so focus doesn't escape to chrome.
        e.preventDefault();
        setMode((m) =>
          e.shiftKey ? (m === 'voice' ? 'text' : 'voice') : m === 'text' ? 'voice' : 'text',
        );
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, submit]);

  // ── Blur = hide (click outside the window) ─────────────────────────────
  useEffect(() => {
    const onBlur = () => {
      getCurrentWebviewWindow()
        .hide()
        .catch(() => {});
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // ── History prefill (click a row → fill input, do NOT auto-submit) ─────
  const onPickHistory = useCallback((q: string) => {
    setQuery(q);
  }, []);

  const onQueryChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  }, []);

  return (
    <div className={`quickask quickask-${mode}`} data-mode={mode}>
      {mode === 'text' ? (
        <QuickAskText
          query={query}
          onQueryChange={onQueryChange}
          busy={busy}
          streaming={streaming}
          history={history}
          onPickHistory={onPickHistory}
        />
      ) : (
        <QuickAskVoice />
      )}
    </div>
  );
}
