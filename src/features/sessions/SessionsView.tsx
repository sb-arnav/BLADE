// src/features/sessions/SessionsView.tsx
//
// Phase 34 / Plan 34-11 (SESS-03 + SESS-04) — Sessions list UI.
//
// Renders a list of past sessions sorted desc by started_at_ms. Each row has
// three actions: Resume (calls resumeSession + navigates to chat), Branch
// (opens a numeric-index picker modal then calls forkSession), Archive (v1.6
// placeholder — auto-rotation already handles overflow, manual archive
// surfaces in a follow-up plan).
//
// Reuses existing list-card patterns from src/features/dashboard. NO bespoke
// design system work per CONTEXT lock §SESS-03 ("reuse list-card patterns").
//
// Navigation: consumers nav via useRouterCtx — RouteDefinition contracts in
// src/lib/router.ts do not pass props to lazy-loaded components, so this
// component owns its own resume/back wiring through the router context that
// MainShell hosts (see src/windows/main/useRouter.ts).
//
// @see src-tauri/src/session/list.rs (4 #[tauri::command] handlers)
// @see .planning/phases/34-resilience-session/34-CONTEXT.md §SESS-03 / §SESS-04

import { useCallback, useEffect, useState } from 'react';
import { useRouterCtx } from '@/windows/main/useRouter';
import { useChatCtx, type ChatStreamMessage } from '@/features/chat';
import {
  forkSession,
  listSessions,
  resumeSession,
  type SessionMeta,
} from '@/lib/tauri/sessions';

export function SessionsView() {
  const { openRoute } = useRouterCtx();
  const { setHistory, setActiveSessionId } = useChatCtx();
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branchTarget, setBranchTarget] = useState<SessionMeta | null>(null);
  const [branchIdx, setBranchIdx] = useState<number>(1);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listSessions();
      setSessions(list);
    } catch (e) {
      setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleResume = useCallback(
    async (id: string) => {
      setBusy(id);
      setError(null);
      try {
        // Phase 34 / BL-02 (REVIEW finding) — full resume hand-off:
        //   1. resumeSession(id) → ResumedConversation { session_id, messages }
        //   2. setHistory(narrowed messages) — chat surface re-renders with
        //      the resumed turns instead of empty state.
        //   3. setActiveSessionId(session_id) — next send_message_stream call
        //      threads this id through to the Rust SessionWriter so the new
        //      turn appends to the SAME JSONL and the per-conversation
        //      cumulative cost cap continues from the prior total.
        //   4. openRoute('chat') — navigate.
        // Without (2) + (3) the Resume button is a visual no-op (the v1.5
        // bug this REVIEW finding caught).
        const r = await resumeSession(id);
        // Narrow ResumedConversation.messages (Vec<serde_json::Value> on Rust
        // side) into ChatStreamMessage. Rust emits {role, content} +
        // optionally {tool_name, is_error} for tool rows. We surface tool
        // results as system-style rows so the chat history reflects them —
        // they are NOT replayed back to the LLM provider on the next turn
        // because the Rust send_message_stream rebuilds conversation from
        // the JSONL on its own (commands.rs build_conversation path).
        const hydrated: ChatStreamMessage[] = r.messages.map((raw, i) => {
          const m = (raw ?? {}) as Record<string, unknown>;
          const role = (m.role as string) ?? 'system';
          const content = (m.content as string) ?? '';
          // tool rows surface to the user as 'system'-styled rows so the
          // history shows what happened — the chat ChatStreamMessage type
          // doesn't have a 'tool' role so fold them into 'system' with a
          // labelled prefix.
          if (role === 'tool') {
            const toolName = (m.tool_name as string) ?? 'tool';
            const isErr = m.is_error === true;
            return {
              id: crypto.randomUUID(),
              role: 'system',
              content: `[${toolName}${isErr ? ' error' : ''}] ${content}`,
              createdAt: Date.now() + i,
              isError: isErr,
            };
          }
          if (role === 'user' || role === 'assistant' || role === 'system') {
            return {
              id: crypto.randomUUID(),
              role,
              content,
              createdAt: Date.now() + i,
            };
          }
          // Unknown role — fold into system with verbatim role prefix.
          return {
            id: crypto.randomUUID(),
            role: 'system',
            content: `[${role}] ${content}`,
            createdAt: Date.now() + i,
          };
        });
        setHistory(hydrated);
        setActiveSessionId(r.session_id);
        openRoute('chat');
      } catch (e) {
        setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e)));
      } finally {
        setBusy(null);
      }
    },
    [openRoute, setHistory, setActiveSessionId],
  );

  const openBranchPicker = useCallback((session: SessionMeta) => {
    setBranchTarget(session);
    // Default to a sensible fork point — the third message — clamped to the
    // session's actual count. Backend re-clamps via min(parent.message_count)
    // so user-chosen overshoot is safe.
    setBranchIdx(Math.max(1, Math.min(3, session.message_count)));
  }, []);

  const handleBranch = useCallback(async () => {
    if (!branchTarget) return;
    setBusy(branchTarget.id);
    setError(null);
    try {
      await forkSession(branchTarget.id, branchIdx);
      setBranchTarget(null);
      await refresh();
    } catch (e) {
      setError(typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(null);
    }
  }, [branchTarget, branchIdx, refresh]);

  return (
    <div className="sessions-view" style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
      }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Sessions ({sessions.length})</h1>
        <button onClick={() => openRoute('chat')} style={btnStyle('ghost')}>
          Back to chat
        </button>
      </header>

      {loading && <p style={{ color: 'var(--t-3)' }}>Loading sessions…</p>}
      {error && (
        <p style={{ color: 'tomato', marginBottom: 12 }} role="alert">
          Error: {error}
        </p>
      )}
      {!loading && !error && sessions.length === 0 && (
        <p style={{ color: 'var(--t-3)' }}>
          No past sessions yet. Send a chat message to start one.
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sessions.map((s) => (
          <li
            key={s.id}
            className="session-card"
            style={{
              padding: 14,
              marginBottom: 10,
              border: '1px solid var(--surface-border, #2a2a2a)',
              borderRadius: 8,
              background: 'var(--surface-1, transparent)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ fontSize: 14 }}>
                    {new Date(s.started_at_ms).toLocaleString()}
                  </strong>
                  {s.parent && (
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      forked from {s.parent.slice(0, 8)}…
                    </span>
                  )}
                  {s.halt_reason && (
                    <span
                      style={{
                        padding: '2px 6px',
                        background: 'var(--warn-bg, #553)',
                        color: 'var(--warn-fg, #fffde0)',
                        borderRadius: 4,
                        fontSize: 11,
                      }}
                    >
                      {s.halt_reason}
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, color: 'var(--t-2, #ccc)', wordBreak: 'break-word' }}>
                  {s.first_message_excerpt || <em style={{ opacity: 0.6 }}>(empty session)</em>}
                </div>
                <div style={{ marginTop: 4, fontSize: 11, color: 'var(--t-3, #888)' }}>
                  {s.message_count} messages · ~{s.approximate_tokens.toLocaleString()} tokens · id {s.id.slice(0, 8)}…
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => void handleResume(s.id)}
                  disabled={busy === s.id}
                  style={btnStyle('primary')}
                >
                  {busy === s.id ? '…' : 'Resume'}
                </button>
                <button
                  onClick={() => openBranchPicker(s)}
                  disabled={busy === s.id || s.message_count === 0}
                  style={btnStyle('secondary')}
                >
                  Branch
                </button>
                <button
                  disabled
                  title="v1.6 — auto-rotation handles overflow today; manual archive coming soon"
                  style={btnStyle('ghost-disabled')}
                >
                  Archive
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {branchTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Branch session at message index"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setBranchTarget(null);
          }}
        >
          <div
            className="branch-picker-modal"
            style={{
              background: 'var(--surface-2, #1a1a1a)',
              padding: 24,
              border: '1px solid var(--surface-border, #2a2a2a)',
              borderRadius: 8,
              minWidth: 360,
              maxWidth: 480,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 18 }}>Branch session</h2>
            <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
              Parent has {branchTarget.message_count} messages. Picking N
              creates a new session containing the first N user / assistant
              messages of the parent. Tool calls + halt reasons within that
              range pass through unchanged.
            </p>
            <label style={{ display: 'block', fontSize: 12, marginTop: 12 }}>
              Fork at message index
              <input
                type="number"
                min={1}
                max={Math.max(1, branchTarget.message_count)}
                value={branchIdx}
                onChange={(e) => setBranchIdx(parseInt(e.target.value, 10) || 1)}
                style={{
                  display: 'block',
                  marginTop: 6,
                  padding: 8,
                  fontSize: 14,
                  width: '100%',
                  boxSizing: 'border-box',
                  background: 'var(--surface-3, #111)',
                  color: 'var(--t-1, #eee)',
                  border: '1px solid var(--surface-border, #2a2a2a)',
                  borderRadius: 4,
                }}
              />
            </label>
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setBranchTarget(null)} style={btnStyle('ghost')}>
                Cancel
              </button>
              <button
                onClick={() => void handleBranch()}
                disabled={busy === branchTarget.id}
                style={btnStyle('primary')}
              >
                {busy === branchTarget.id ? '…' : 'Branch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline button-style helper. Reuses CSS custom-property tokens from the
// existing design system (var(--…)) so the buttons inherit the project's
// palette automatically. Not promoted to the design-system primitives
// because the SessionsView surface is intentionally low-chrome (CONTEXT
// lock: reuse list-card patterns; no bespoke design work for v1.5).
function btnStyle(kind: 'primary' | 'secondary' | 'ghost' | 'ghost-disabled'): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: 12,
    border: '1px solid var(--surface-border, #2a2a2a)',
    borderRadius: 4,
    cursor: 'pointer',
    background: 'transparent',
    color: 'var(--t-1, #eee)',
  };
  if (kind === 'primary') {
    return { ...base, background: 'var(--accent, #4a90e2)', color: '#fff', border: 'none' };
  }
  if (kind === 'secondary') {
    return { ...base, background: 'var(--surface-2, #1a1a1a)' };
  }
  if (kind === 'ghost-disabled') {
    return { ...base, opacity: 0.45, cursor: 'not-allowed' };
  }
  return base;
}
