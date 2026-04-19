// src/features/knowledge/MemoryPalace.tsx — Phase 5 Plan 05-06 (KNOW-03).
//
// 7-tab typed-memory surface. Each tab queries `memory_recall_category` on
// activation; active tab persists to `knowledge.lastTab` (D-133). Inline
// "New memory" form stores via `memory_store_typed`. Each entry renders as
// a card with confidence bar + delete affordance.
//
// MemoryCategory enum — lowercase on the Rust wire (per typed_memory.rs:35
// `MemoryCategory::as_str()`). We display Capitalized labels but send lowercase
// to Rust. Category order follows the typed_memory.rs declaration exactly.
//
// @see .planning/phases/05-agents-knowledge/05-06-PLAN.md
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-138 (7-tab discretion)
// @see src-tauri/src/typed_memory.rs:35 MemoryCategory
// @see .planning/REQUIREMENTS.md §KNOW-03

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Pill, Dialog } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import {
  memoryRecallCategory,
  memoryStoreTyped,
  memoryDeleteTyped,
} from '@/lib/tauri/knowledge';
import type { MemoryCategory, TypedMemory } from '@/lib/tauri/knowledge';
import './knowledge.css';
import './knowledge-rich-b.css';

/**
 * 7 categories in the order declared by typed_memory.rs. Lowercase on the
 * wire; Capitalized label rendered in the UI (D-138 Claude's Discretion).
 */
const MEMORY_CATEGORIES: ReadonlyArray<{ key: MemoryCategory; label: string; description: string }> = [
  { key: 'fact',         label: 'Fact',         description: 'Things you know to be true.' },
  { key: 'preference',   label: 'Preference',   description: 'How you like things done.' },
  { key: 'decision',     label: 'Decision',     description: 'Choices you have committed to.' },
  { key: 'skill',        label: 'Skill',        description: 'Capabilities you have built.' },
  { key: 'goal',         label: 'Goal',         description: 'Outcomes you are aiming at.' },
  { key: 'routine',      label: 'Routine',      description: 'Rhythms you keep.' },
  { key: 'relationship', label: 'Relationship', description: 'People and how you relate.' },
];

const DEFAULT_CATEGORY: MemoryCategory = 'fact';

function isKnownCategory(v: string | undefined): v is MemoryCategory {
  return !!v && MEMORY_CATEGORIES.some((c) => c.key === v);
}

function formatCreatedAt(unixSeconds: number): string {
  if (!Number.isFinite(unixSeconds)) return '—';
  // Rust memory entries use unix seconds; if the value looks like ms convert.
  const ms = unixSeconds > 1e12 ? unixSeconds : unixSeconds * 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MemoryPalace() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();

  const initialTab: MemoryCategory = useMemo(() => {
    const last = prefs['knowledge.lastTab'];
    return typeof last === 'string' && isKnownCategory(last) ? last : DEFAULT_CATEGORY;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [activeTab, setActiveTab] = useState<MemoryCategory>(initialTab);
  const [entries, setEntries] = useState<TypedMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const loadEntries = useCallback(
    async (category: MemoryCategory) => {
      setLoading(true);
      setError(null);
      try {
        const rows = await memoryRecallCategory({ category, limit: 100 });
        setEntries(rows);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadEntries(activeTab);
  }, [activeTab, loadEntries]);

  const handleTabChange = useCallback(
    (next: MemoryCategory) => {
      if (next === activeTab) return;
      setActiveTab(next);
      setPref('knowledge.lastTab', next);
    },
    [activeTab, setPref],
  );

  const handleSave = useCallback(async () => {
    const content = newContent.trim();
    if (!content || saving) return;
    setSaving(true);
    try {
      await memoryStoreTyped({ category: activeTab, content, source: 'memory-palace-ui' });
      setNewContent('');
      toast.show({ type: 'success', title: 'Memory stored', message: `Added to ${activeTab}.` });
      await loadEntries(activeTab);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Could not store memory',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [newContent, saving, activeTab, toast, loadEntries]);

  const handleDelete = useCallback(async () => {
    const id = confirmDeleteId;
    if (!id) return;
    try {
      await memoryDeleteTyped(id);
      setEntries((prev) => prev.filter((row) => row.id !== id));
      toast.show({ type: 'success', title: 'Memory removed' });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConfirmDeleteId(null);
    }
  }, [confirmDeleteId, toast]);

  const activeMeta = MEMORY_CATEGORIES.find((c) => c.key === activeTab) ?? MEMORY_CATEGORIES[0];

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="memory-palace-root">
      <div className="memory-palace-layout">
        <nav className="memory-palace-tabs" aria-label="Memory categories">
          {MEMORY_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              className="memory-palace-tab"
              data-testid="memory-palace-tab"
              data-category={cat.key}
              data-active={activeTab === cat.key ? 'true' : 'false'}
              aria-pressed={activeTab === cat.key}
              onClick={() => handleTabChange(cat.key)}
            >
              {cat.label}
            </button>
          ))}
        </nav>

        <div className="memory-palace-pane">
          <div className="kb-section-heading">
            <div>
              <h2 className="kb-section-title">{activeMeta.label}</h2>
              <div className="memory-palace-entry-meta">{activeMeta.description}</div>
            </div>
            <Pill tone="default">{entries.length}</Pill>
          </div>

          <form
            className="memory-palace-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <label htmlFor="memory-palace-new" className="memory-palace-entry-meta">
              New {activeMeta.label.toLowerCase()} memory
            </label>
            <textarea
              id="memory-palace-new"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder={`Capture a ${activeMeta.label.toLowerCase()}...`}
              disabled={saving}
            />
            <div className="memory-palace-form-actions">
              <Button
                variant="primary"
                size="sm"
                type="submit"
                disabled={!newContent.trim() || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </form>

          {error ? (
            <div className="memory-palace-empty" role="alert">
              Could not load memories: {error}
            </div>
          ) : loading ? (
            <div className="memory-palace-empty">Loading…</div>
          ) : entries.length === 0 ? (
            <div className="memory-palace-empty">
              No {activeMeta.label.toLowerCase()} memories yet. Capture one above.
            </div>
          ) : (
            <div className="memory-palace-entries">
              {entries.map((entry) => {
                const confidencePct = Math.max(
                  0,
                  Math.min(100, Math.round(entry.confidence * 100)),
                );
                return (
                  <article key={entry.id} className="memory-palace-entry">
                    <div className="memory-palace-entry-content">{entry.content}</div>
                    <div className="memory-palace-entry-meta">
                      <span>{formatCreatedAt(entry.created_at)}</span>
                      <span
                        className="memory-palace-confidence-bar"
                        aria-label={`Confidence ${confidencePct}%`}
                      >
                        <span
                          className="memory-palace-confidence-fill"
                          style={{ width: `${confidencePct}%` }}
                        />
                      </span>
                      <span>{confidencePct}%</span>
                      <span style={{ marginLeft: 'auto' }}>
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => setConfirmDeleteId(entry.id)}
                          aria-label={`Delete memory`}
                        >
                          Delete
                        </Button>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        ariaLabel="Confirm memory deletion"
      >
        <div style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>
            Delete this memory?
          </h3>
          <p style={{ margin: 0, color: 'var(--t-2)', fontSize: 14 }}>
            This is permanent. The typed-memory row will be removed from the palace.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleDelete()}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
