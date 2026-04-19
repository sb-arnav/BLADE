// src/features/knowledge/LiveNotes.tsx — Phase 5 Plan 05-06 (KNOW-06).
//
// Quick-capture notes surface. Large textarea at the top pushes a manual
// episode into the memory palace via `memory_add_manual`; the recent list
// below pulls the last 20 episodes via `memory_get_recent`.
//
// memory_add_manual signature (memory_palace.rs:806):
//   (title, summary, episode_type, importance: i32) -> Result<String, String>
// We use the first ~40 chars of the note as title, the full body as summary,
// and a fixed episode_type="note" so these are easy to identify later.
//
// Cmd/Ctrl+Enter submits the form (D-138 Claude's Discretion — matches the
// chat composer keyboard pattern from Phase 3).
//
// @see .planning/phases/05-agents-knowledge/05-06-PLAN.md
// @see src-tauri/src/memory_palace.rs:806 memory_add_manual
// @see src-tauri/src/memory_palace.rs:796 memory_get_recent
// @see .planning/REQUIREMENTS.md §KNOW-06

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassPanel, Button } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { memoryAddManual, memoryGetRecent } from '@/lib/tauri/knowledge';
import type { MemoryEpisode } from '@/lib/tauri/knowledge';
import './knowledge.css';
import './knowledge-rich-b.css';

const RECENT_LIMIT = 20;
const NOTE_IMPORTANCE = 3; // Default middle importance for manual notes.
const NOTE_EPISODE_TYPE = 'note';

function formatTimestamp(unix: number): string {
  if (!Number.isFinite(unix)) return '—';
  const ms = unix > 1e12 ? unix : unix * 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function titleFromBody(body: string): string {
  const trimmed = body.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 57)}…`;
}

export function LiveNotes() {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<MemoryEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const recent = await memoryGetRecent({ limit: RECENT_LIMIT });
      setRows(recent);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    try {
      const title = titleFromBody(text);
      const newId = await memoryAddManual({
        title,
        summary: text,
        episodeType: NOTE_EPISODE_TYPE,
        importance: NOTE_IMPORTANCE,
      });
      // Optimistic prepend; the server-side row shape matches MemoryEpisode.
      const nowSecs = Math.floor(Date.now() / 1000);
      const optimistic: MemoryEpisode = {
        id: newId,
        title,
        summary: text,
        full_context: text,
        tags: [],
        episode_type: NOTE_EPISODE_TYPE,
        importance: NOTE_IMPORTANCE,
        emotional_valence: 'neutral',
        people: [],
        projects: [],
        recall_count: 0,
        created_at: nowSecs,
      };
      setRows((prev) => [optimistic, ...prev].slice(0, RECENT_LIMIT));
      setBody('');
      toast.show({ type: 'success', title: 'Note saved' });
      // Re-sync from backend shortly after to capture server-canonical fields.
      void load();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Could not save note',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [body, saving, toast, load]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleSave],
  );

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="live-notes-root">
      <div className="live-notes-layout">
        <form
          className="live-notes-capture"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <label htmlFor="live-notes-body" className="live-notes-capture-hint">
            What&rsquo;s on your mind?
          </label>
          <textarea
            id="live-notes-body"
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jot it down — BLADE will remember."
            disabled={saving}
          />
          <div className="live-notes-capture-actions">
            <span className="live-notes-capture-hint">
              {saving ? 'Saving…' : 'Cmd/Ctrl + Enter to save'}
            </span>
            <Button variant="primary" size="sm" type="submit" disabled={!body.trim() || saving}>
              Save
            </Button>
          </div>
        </form>

        <section aria-label="Recent notes">
          <div className="kb-section-heading">
            <h2 className="kb-section-title">Recent</h2>
            <span className="memory-palace-entry-meta">
              {loading ? 'Loading…' : `${rows.length} note${rows.length === 1 ? '' : 's'}`}
            </span>
          </div>

          {error ? (
            <div className="memory-palace-empty" role="alert">
              Could not load notes: {error}
            </div>
          ) : rows.length === 0 && !loading ? (
            <div className="memory-palace-empty">No notes yet.</div>
          ) : (
            <div className="live-notes-list">
              {rows.map((row) => {
                const isOpen = expanded[row.id] === true;
                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`live-notes-row${isOpen ? '' : ' live-notes-row-collapsed'}`}
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [row.id]: !isOpen }))
                    }
                    aria-expanded={isOpen}
                  >
                    <div className="live-notes-row-head">
                      <span className="live-notes-row-title">{row.title || '(untitled)'}</span>
                      <span className="live-notes-row-time">
                        {formatTimestamp(row.created_at)}
                      </span>
                    </div>
                    <div className="live-notes-row-body">
                      {isOpen ? row.full_context || row.summary : row.summary || row.title}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </GlassPanel>
  );
}
