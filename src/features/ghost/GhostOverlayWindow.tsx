// src/features/ghost/GhostOverlayWindow.tsx — Phase 4 Plan 04-04
//
// Top-level Ghost Mode overlay. Two visual states (D-109):
//   1. Idle pill        — subtle "Ghost · Ctrl+G" pill when there's no live
//                         suggestion or when the user has toggled the card off.
//   2. Suggestion card  — full ≤480px card rendered when Rust emits
//                         `ghost_suggestion_ready_to_speak`. Headline ≤6 words +
//                         1–2 bullets ≤60ch each (D-10 enforced via clipHeadline
//                         + ghost.css `max-width: 60ch`).
//
// Linux gating (D-110): on `navigator.platform` matching /linux/i, a one-time
// `Dialog` warns the user that screen-capture protection is not enforced. The
// acknowledgment persists in `usePrefs['ghost.linuxWarningAcknowledged']`. On
// macOS / Windows, the dialog never renders (Rust .content_protected(true) at
// ghost_mode.rs:481 owns the protection contract).
//
// Subscribed events (D-112; useTauriEvent ONLY per D-13/D-34):
//   - GHOST_SUGGESTION_READY_TO_SPEAK → set suggestion + show card
//   - GHOST_MEETING_STATE             → cache for platform/speaker context
//   - GHOST_MEETING_ENDED             → hide window after 2s
//   - GHOST_TOGGLE_CARD               → toggle card visibility (Ctrl+G shortcut
//                                       round-tripped through Rust per
//                                       src-tauri/src/lib.rs:326)
//
// Keyboard:
//   - Ctrl/Cmd+G → toggle card visibility (in addition to Rust shortcut, so the
//                  control works when the OS-level shortcut registration fails).
//   - Esc        → hide the ghost window via `getCurrentWebviewWindow().hide()`.
//
// D-09 discipline: this file deliberately sets NO `cursor:` style (inline or
// in CSS). Content-protection is a Rust window-flag concern; UI surface is
// pure presentation.
// D-111: NO auto-reply / "Send now" button. Phase 4 surfaces text only;
// keyboard injection is deferred to Phase 7+ autonomy sliders.

import { useEffect, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { GhostMeetingStatePayload } from '@/lib/events';
import { Dialog, Button } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { getCurrentWebviewWindow } from '@/lib/tauri/window';
import { clipHeadline } from './clipHeadline';
import { speakerColor, confColor } from './speakerColor';

/** Mirrors src-tauri/src/ghost_mode.rs:96-111 GhostSuggestion. */
interface GhostSuggestionPayload {
  response: string;
  trigger: string;
  speaker: string | null;
  confidence: number;
  platform: string;
  timestamp_ms: number;
}

const isLinux =
  typeof navigator !== 'undefined' && /linux/i.test(navigator.platform ?? '');

export function GhostOverlayWindow() {
  const { prefs, setPref } = usePrefs();
  const [visible, setVisible] = useState<boolean>(true);
  const [suggestion, setSuggestion] = useState<GhostSuggestionPayload | null>(
    null,
  );
  const [meetingState, setMeetingState] =
    useState<GhostMeetingStatePayload | null>(null);
  // Lazy initialiser so the dialog open-state is correct on the very first
  // render — mirrors usePrefs's read-once-on-mount pattern.
  const [warningOpen, setWarningOpen] = useState<boolean>(
    () => isLinux && !prefs['ghost.linuxWarningAcknowledged'],
  );

  // ── Event subscriptions (D-112: useTauriEvent only) ──────────────────────
  useTauriEvent<GhostSuggestionPayload>(
    BLADE_EVENTS.GHOST_SUGGESTION_READY_TO_SPEAK,
    (e) => {
      setSuggestion(e.payload);
      setVisible(true);
    },
  );
  useTauriEvent<GhostMeetingStatePayload>(
    BLADE_EVENTS.GHOST_MEETING_STATE,
    (e) => setMeetingState(e.payload),
  );
  useTauriEvent<null>(BLADE_EVENTS.GHOST_MEETING_ENDED, () => {
    setTimeout(() => {
      getCurrentWebviewWindow()
        .hide()
        .catch(() => {
          /* window already hidden — non-fatal */
        });
    }, 2000);
  });
  useTauriEvent<unknown>(BLADE_EVENTS.GHOST_TOGGLE_CARD, () => {
    setVisible((v) => !v);
  });

  // Keyboard: Ctrl+G toggles card; Esc hides the entire window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setVisible((v) => !v);
        return;
      }
      if (e.key === 'Escape') {
        getCurrentWebviewWindow()
          .hide()
          .catch(() => {
            /* already hidden */
          });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Linux warning gate (D-110) ───────────────────────────────────────────
  // On Linux first-activation, block the overlay UI until the user
  // acknowledges that content-protection is not enforced. Persisted
  // acknowledgment skips the dialog forever after.
  if (warningOpen) {
    const acknowledge = () => {
      setPref('ghost.linuxWarningAcknowledged', true);
      setWarningOpen(false);
    };
    const cancel = () => {
      // Don't persist — keep the warning gate active for next activation.
      getCurrentWebviewWindow()
        .hide()
        .catch(() => {
          /* already hidden */
        });
    };
    return (
      <Dialog
        open
        onClose={cancel}
        ariaLabel="Linux content-protection warning"
      >
        <h3>Ghost Mode is visible on screen share on Linux</h3>
        <p>
          On macOS and Windows, Ghost Mode is hidden from screen capture via
          content protection. Linux does not support this flag — anything you
          see in Ghost Mode, your meeting participants can also see.
        </p>
        <p>Consider using BLADE&apos;s voice-only responses (no visible overlay) on Linux.</p>
        <div className="ghost-dialog-actions">
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={acknowledge}>
            I understand, continue
          </Button>
        </div>
      </Dialog>
    );
  }

  // ── Idle pill (D-109 — default visible on activation) ────────────────────
  if (!visible || !suggestion) {
    return (
      <div className="ghost-idle" role="status" aria-label="Ghost mode idle">
        <span className="gd" aria-hidden="true" /> Ghost ·{' '}
        <span className="kbd">Ctrl+G</span>
      </div>
    );
  }

  // ── Suggestion card (D-109 + D-10 enforced) ──────────────────────────────
  const { headline, bullets } = clipHeadline(suggestion.response);
  const rawPlatform = suggestion.platform || meetingState?.platform;
  const platformLabel =
    typeof rawPlatform === 'string' && rawPlatform.length > 0
      ? rawPlatform
      : null;
  return (
    <div className="ghost-card" role="region" aria-label="Ghost suggestion">
      <div
        className="ghost-speaker"
        style={{ color: speakerColor(suggestion.speaker) }}
      >
        {suggestion.speaker ?? 'Speaker'}{' '}
        <span
          className="ghost-conf"
          style={{ color: confColor(suggestion.confidence) }}
          aria-label={`Confidence ${Math.round(suggestion.confidence * 100)}%`}
        >
          ●
        </span>
        {platformLabel && (
          <span className="ghost-platform"> · {platformLabel}</span>
        )}
      </div>
      <h3 className="ghost-headline">{headline}</h3>
      {bullets.length > 0 && (
        <ul className="ghost-bullets">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
