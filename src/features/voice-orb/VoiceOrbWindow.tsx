// src/features/voice-orb/VoiceOrbWindow.tsx (ORB-01, ORB-02, ORB-07, ORB-08)
//
// Full Voice Orb window shell:
//   - phase state machine driven ONLY by Rust events (D-105)
//   - 5 events subscribed via useTauriEvent (no raw @tauri-apps/api/event imports)
//   - acquireMic on `listening`, releaseMic on every other phase (D-104, T-04-03-01)
//   - wake_word_detected invokes `start_voice_conversation` when idle — gated
//     by a 2s ignore-wake window after `voice_conversation_ended` (T-04-03-02)
//   - drag-to-any-corner via mousedown/move/up on window; snap-to-nearest
//     quadrant on release; persisted via usePrefs under 'voice_orb.corner' (D-107)
//
// Window label stays 'overlay' (D-106) — Rust emit_to('overlay', ...) sites
// continue to work; this bootstrap replaces the Phase 1 placeholder div.
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-103..D-108

import { useEffect, useRef, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  VoiceConversationListeningPayload,
  VoiceConversationThinkingPayload,
  VoiceConversationSpeakingPayload,
  VoiceConversationEndedPayload,
  WakeWordDetectedPayload,
} from '@/lib/events';
import { invokeTyped } from '@/lib/tauri/_base';
import { usePrefs } from '@/hooks/usePrefs';
import { VoiceOrb } from './VoiceOrb';
import type { OrbPhase } from './useOrbPhase';
import { useMicRms } from './useMicRms';

type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
const DEFAULT_CORNER: Corner = 'bottom-right';
const VALID_CORNERS: readonly Corner[] = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
];
/** Wake-word ignore window after voice_conversation_ended — prevents TTS tail
 *  from self-triggering a new session (T-04-03-02 mitigation). */
const WAKE_IGNORE_MS = 2000;
/** Drag threshold before we consider the interaction a drag vs. a tap. */
const DRAG_THRESHOLD_PX = 6;

function readCorner(value: unknown): Corner {
  return VALID_CORNERS.includes(value as Corner) ? (value as Corner) : DEFAULT_CORNER;
}

function cornerFromPoint(x: number, y: number): Corner {
  const midX = window.innerWidth / 2;
  const midY = window.innerHeight / 2;
  if (x < midX && y < midY) return 'top-left';
  if (x >= midX && y < midY) return 'top-right';
  if (x < midX && y >= midY) return 'bottom-left';
  return 'bottom-right';
}

export function VoiceOrbWindow() {
  const [phase, setPhase] = useState<OrbPhase>('idle');
  const { prefs, setPref } = usePrefs();
  const corner = readCorner(prefs['voice_orb.corner']);
  const { micRmsRef, acquireMic, releaseMic, micError } = useMicRms();
  const ignoreWakeUntilRef = useRef<number>(0);
  const phaseRef = useRef<OrbPhase>('idle');
  // Keep a ref in sync with phase so event callbacks always see the latest
  // value without re-subscribing. useTauriEvent handlers close over first
  // render's state otherwise (handler-in-ref pattern inside the hook).
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useTauriEvent<VoiceConversationListeningPayload>(
    BLADE_EVENTS.VOICE_CONVERSATION_LISTENING,
    () => {
      setPhase('listening');
      acquireMic();
    },
  );
  useTauriEvent<VoiceConversationThinkingPayload>(
    BLADE_EVENTS.VOICE_CONVERSATION_THINKING,
    () => {
      setPhase('thinking');
      releaseMic();
    },
  );
  useTauriEvent<VoiceConversationSpeakingPayload>(
    BLADE_EVENTS.VOICE_CONVERSATION_SPEAKING,
    () => {
      setPhase('speaking');
      releaseMic();
    },
  );
  useTauriEvent<VoiceConversationEndedPayload>(
    BLADE_EVENTS.VOICE_CONVERSATION_ENDED,
    () => {
      setPhase('idle');
      releaseMic();
      ignoreWakeUntilRef.current = Date.now() + WAKE_IGNORE_MS;
    },
  );
  useTauriEvent<WakeWordDetectedPayload>(
    BLADE_EVENTS.WAKE_WORD_DETECTED,
    () => {
      if (Date.now() < ignoreWakeUntilRef.current) return;
      if (phaseRef.current !== 'idle') return;
      invokeTyped<void>('start_voice_conversation').catch(() => {
        /* already active / command unavailable — ignore */
      });
    },
  );

  // ─── Drag-to-corner handlers — snap on release + persist via usePrefs ──
  useEffect(() => {
    let isDown = false;
    let startX = 0;
    let startY = 0;
    let moved = false;
    const onDown = (e: MouseEvent) => {
      isDown = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
    };
    const onMove = (e: MouseEvent) => {
      if (!isDown) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        moved = true;
      }
    };
    const onUp = (e: MouseEvent) => {
      if (!isDown) return;
      isDown = false;
      if (!moved) return; // click, not drag — don't move corner
      const next = cornerFromPoint(e.clientX, e.clientY);
      if (next !== corner) {
        setPref('voice_orb.corner', next);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [corner, setPref]);

  return (
    <div className={`voice-orb-window corner-${corner}`} data-corner={corner}>
      <VoiceOrb phase={phase} micRmsRef={micRmsRef} />
      {micError && (
        <div className="orb-mic-error" role="alert">
          {micError}
        </div>
      )}
    </div>
  );
}
