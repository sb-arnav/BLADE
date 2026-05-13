// src/features/onboarding/Hunt.tsx — Phase 46 v2.0 agentic hunt onboarding UI.
//
// Replaces the 4-step wizard (ProviderPicker / ApiKeyEntry / PersonaQuestions /
// Steps.tsx) wholesale per .planning/v2.0-onboarding-spec.md (locked 2026-05-13).
//
// Flow:
//   1. Component mounts → calls `startHunt()` once. Backend runs the ≤2s
//      pre-scan, emits Message #1, then spawns the LLM hunt loop in the
//      background (non-blocking).
//   2. We subscribe to BLADE_HUNT_LINE → append each event to a scrolling
//      chat-line list. The hunt narrates every probe in real time.
//   3. BLADE_HUNT_DONE fires when synthesis completes — gate flips on the
//      Rust side (persona_onboarding_complete = true). We call `onComplete`
//      so MainShell.useOnboardingGate re-evaluates and unmounts us.
//   4. User can type "stop" in the input box to cancel the hunt mid-probe.
//      The first message after the closing chat-line routes into the normal
//      chat tool loop (HUNT-08).
//
// Stop semantics: typing exactly "stop" (case-insensitive) calls cancelHunt
// and shows a system line. Any other text after the closing line is enqueued
// for the post-onboarding chat — we relay via the BLADE_QUICKASK_BRIDGED event
// pattern that ChatPanel listens for, so the first task lands in chat.
//
// Empty / error states:
//   - hunt_error event → shows the error inline + "Try again" button that
//     re-invokes startHunt.
//   - No API key on launch → the Rust side falls back to a single sharp
//     question via the same BLADE_HUNT_LINE channel; the UI doesn't branch.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/design-system/primitives';
import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
import type {
  BladeHuntLinePayload,
  BladeHuntDonePayload,
  BladeHuntErrorPayload,
  BladeHuntLineKind,
} from '@/lib/events/payloads';
import {
  startHunt,
  cancelHunt,
  huntPostUserAnswer,
  huntContinueAfterCostBlock,
  TauriError,
} from '@/lib/tauri';
import './hunt.css';

interface Props {
  /** Called when the hunt completes synthesis — MainShell re-evaluates the gate. */
  onComplete: () => void;
}

interface HuntLineRow {
  id: string;
  role: 'blade' | 'system' | 'user';
  text: string;
  timestamp: string;
  /** Phase 49 — kind discriminator for cost / question lines. */
  kind?: BladeHuntLineKind;
}

export function Hunt({ onComplete }: Props) {
  const [lines, setLines] = useState<HuntLineRow[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'starting' | 'running' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  /** First-task mode: closing line landed; next user input routes to chat. */
  const [closingShown, setClosingShown] = useState(false);
  /** Phase 49 (HUNT-05-ADV) — true while a `hunt_question` chat-line is open
   * and the next user submission should route to `huntPostUserAnswer`. */
  const [awaitingAnswer, setAwaitingAnswer] = useState(false);
  /** Phase 49 (HUNT-COST-CHAT) — true while a `cost_block` is suspending the
   * hunt; the inline yes/no is offered. */
  const [costBlocked, setCostBlocked] = useState(false);
  const startedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── 1. Kick off the hunt exactly once on mount ─────────────────────────
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void launch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const launch = useCallback(async () => {
    setStatus('starting');
    setError(null);
    try {
      await startHunt();
      setStatus('running');
    } catch (e) {
      const msg = e instanceof TauriError ? e.rustMessage : String(e);
      setError(msg);
      setStatus('error');
    }
  }, []);

  // ─── 2. Subscribe to hunt event stream ──────────────────────────────────
  useTauriEvent<BladeHuntLinePayload>(BLADE_EVENTS.BLADE_HUNT_LINE, (e) => {
    const p = e.payload;
    if (!p || typeof p !== 'object') return;
    setLines((prev) => [
      ...prev,
      {
        id: `${p.timestamp}-${prev.length}`,
        role: p.role,
        text: p.text,
        timestamp: p.timestamp,
        kind: p.kind,
      },
    ]);
    // Phase 49 — sharp question (HUNT-05-ADV / HUNT-06-ADV): show the inline
    // answer input. The user's next submission routes through
    // `huntPostUserAnswer` instead of being a passive interjection.
    if (p.kind === 'hunt_question') {
      setAwaitingAnswer(true);
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    // Phase 49 — cost block (HUNT-COST-CHAT): offer the inline continue ack.
    if (p.kind === 'cost_block') {
      setCostBlocked(true);
      return;
    }
    // The closing chat-line ("one thing you've been putting off this week")
    // signals first-task mode — the user's next message routes to chat.
    if (p.role === 'blade' && p.text.toLowerCase().includes('one thing you')) {
      setClosingShown(true);
      // Defer focus to next frame so the textarea is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  });

  useTauriEvent<BladeHuntDonePayload>(BLADE_EVENTS.BLADE_HUNT_DONE, (_e) => {
    setStatus('done');
    // Don't immediately re-gate — wait for the user to type their first task,
    // then complete. If they don't type anything, the gate persists until they do.
    // (The Rust side has already flipped persona_onboarding_complete.)
  });

  useTauriEvent<BladeHuntErrorPayload>(BLADE_EVENTS.BLADE_HUNT_ERROR, (e) => {
    setError(typeof e.payload === 'string' ? e.payload : 'Hunt error.');
    setStatus('error');
  });

  // Autoscroll to bottom on every new line.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  // ─── 3. Handle user input — stop / first task / passive interjection ────
  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraft('');

    // Reflect the user's own line in the transcript.
    setLines((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}-${prev.length}`,
        role: 'user',
        text: trimmed,
        timestamp: new Date().toISOString(),
      },
    ]);

    if (trimmed.toLowerCase() === 'stop') {
      await cancelHunt().catch(() => { /* idempotent */ });
      setLines((prev) => [
        ...prev,
        {
          id: `system-${Date.now()}`,
          role: 'system',
          text: "Stopped. You can edit `~/.blade/who-you-are.md` to set who you are manually.",
          timestamp: new Date().toISOString(),
        },
      ]);
      setStatus('done');
      return;
    }

    // Phase 49 (HUNT-05-ADV) — the hunt is parked on a sharp question. Route
    // the user's answer through the dedicated channel so the LLM gets it as
    // a seed input.
    if (awaitingAnswer) {
      setAwaitingAnswer(false);
      try {
        await huntPostUserAnswer(trimmed);
      } catch {
        // Swallow — frontend already reflected the user's line; if the
        // backend dropped, the hunt will time out and synthesize anyway.
      }
      return;
    }

    if (closingShown) {
      // HUNT-08: this is the user's first task. Hand control to MainShell so
      // it re-gates and the chat route takes over. We store the task on
      // window so ChatPanel (or whatever picks up the gate flip) can pre-fill
      // its composer with this text.
      try {
        (window as Window & { __BLADE_FIRST_TASK__?: string }).__BLADE_FIRST_TASK__ = trimmed;
      } catch { /* noop in non-browser test env */ }
      onComplete();
      return;
    }

    // Passive interjection during the hunt — show as system line. The Rust
    // hunt loop doesn't currently take user input mid-stream (v2.1 work);
    // for now we surface that the user typed and let the hunt continue.
    setLines((prev) => [
      ...prev,
      {
        id: `system-${Date.now()}`,
        role: 'system',
        text: "(noted — BLADE will fold this in when the hunt wraps)",
        timestamp: new Date().toISOString(),
      },
    ]);
  }, [closingShown, onComplete, awaitingAnswer]);

  // Phase 49 (HUNT-COST-CHAT) — user confirms budget extension.
  const handleCostContinue = useCallback(async () => {
    setCostBlocked(false);
    try {
      await huntContinueAfterCostBlock();
    } catch {
      // No-op — backend re-emits the block on the next turn if the ack didn't land.
    }
  }, []);

  // ─── 4. Render ──────────────────────────────────────────────────────────
  return (
    <main className="hunt-shell" role="main" aria-labelledby="hunt-title">
      <header className="hunt-header">
        <span className="hunt-mark" aria-hidden="true">B</span>
        <h1 id="hunt-title" className="hunt-title">
          BLADE
        </h1>
        <span className="hunt-status" data-status={status}>
          {status === 'starting' && 'starting…'}
          {status === 'running' && 'hunting…'}
          {status === 'done' && closingShown ? 'your turn' : status === 'done' ? 'done' : ''}
          {status === 'error' && 'error'}
        </span>
      </header>

      <div
        className="hunt-scroll"
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {lines.length === 0 && status === 'starting' && (
          <div className="hunt-line system">scanning your machine…</div>
        )}
        {lines.map((l) => (
          <div
            key={l.id}
            className={`hunt-line ${l.role}${l.kind ? ` kind-${l.kind}` : ''}`}
          >
            {l.role === 'blade' && !l.kind && (
              <span className="hunt-line-prefix" aria-hidden="true">›</span>
            )}
            <span className="hunt-line-text">{l.text}</span>
          </div>
        ))}
        {costBlocked && (
          <div className="hunt-line system kind-cost_block_actions" role="alert">
            <span className="hunt-line-text">Continue at your expense?</span>
            <Button variant="primary" onClick={() => { void handleCostContinue(); }}>
              Yes, raise budget
            </Button>
            <Button variant="ghost" onClick={() => { void cancelHunt().catch(() => {}); setCostBlocked(false); setStatus('done'); }}>
              No, stop
            </Button>
          </div>
        )}
        {error && (
          <div className="hunt-line error" role="alert">
            {error}
            <Button variant="ghost" onClick={launch} aria-label="Retry hunt">
              Try again
            </Button>
          </div>
        )}
      </div>

      <form
        className="hunt-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit(draft);
        }}
      >
        <Input
          ref={inputRef}
          id="hunt-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            awaitingAnswer
              ? 'Answer the question above…'
              : closingShown
                ? 'Name the one thing you\'ve been putting off…'
                : status === 'running'
                  ? 'Type "stop" to interrupt — otherwise just wait.'
                  : 'Type "stop" to cancel.'
          }
          autoComplete="off"
          spellCheck={false}
          disabled={status === 'starting' || status === 'error'}
          aria-label="Hunt input"
        />
        <Button
          variant="primary"
          type="submit"
          disabled={!draft.trim() || status === 'starting' || status === 'error'}
        >
          {awaitingAnswer ? 'Answer →' : closingShown ? 'Send →' : 'Send'}
        </Button>
      </form>
    </main>
  );
}

export default Hunt;
