// src/features/knowledge/KnowledgeBase.tsx — Phase 5 Plan 05-05 (KNOW-01).
//
// Grouped search surface — fires `db_search_knowledge` + `semantic_search` +
// `timeline_search_cmd` in parallel on submit and groups the results under
// three labelled columns: Knowledge / Memory / Timeline (D-138 pragmatic
// reinterpretation of ROADMAP SC-4 "web / memory / tools").
//
// Empty state lists the latest 10 knowledge entries via `dbListKnowledge()`
// (Rust returns all; we slice client-side).
//
// All result content is rendered as plain text via React JSX auto-escape
// (T-05-05-03 mitigation) — no raw-HTML injection APIs used anywhere.
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-138
// @see .planning/REQUIREMENTS.md §KNOW-01

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, EmptyState, GlassPanel, Input } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useRouterCtx } from '@/windows/main/useRouter';
import { CapabilityGap, useCapability } from '@/features/providers';
import {
  dbGetKnowledge,
  dbListKnowledge,
  dbSearchKnowledge,
  semanticSearch,
  timelineSearchCmd,
  type KnowledgeEntry,
} from '@/lib/tauri/knowledge';
import type {
  KnowledgeGroupSource,
  KnowledgeSearchGroup,
} from '@/features/knowledge/types';
import './knowledge.css';
import './knowledge-rich-a.css';

const SEARCH_LIMIT = 20;
const RECENT_LIMIT = 10;
const PREVIEW_CHARS = 160;

function slicePreview(s: string | undefined | null): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_CHARS ? t.slice(0, PREVIEW_CHARS - 1) + '…' : t;
}

export function KnowledgeBase() {
  const { prefs, setPref } = usePrefs();
  const { openRoute } = useRouterCtx();
  // Phase 11 Plan 11-05 (PROV-08) — full-repo indexing path requires a
  // long-context-capable model. Surface the banner above the search bar
  // when absent; search itself (memory / timeline) remains usable.
  const { hasCapability: hasLongCtx } = useCapability('long_context');
  const lastQueryInitial =
    typeof prefs['knowledge.lastTab'] === 'string' ? (prefs['knowledge.lastTab'] as string) : '';
  const [query, setQuery] = useState(lastQueryInitial);
  const [submitted, setSubmitted] = useState<string>('');
  const [recent, setRecent] = useState<KnowledgeEntry[]>([]);
  const [groups, setGroups] = useState<KnowledgeSearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<KnowledgeEntry | null>(null);
  const [expandedMemoryId, setExpandedMemoryId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Autofocus on mount for quick search-on-open UX.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load recent entries once on mount.
  useEffect(() => {
    let cancelled = false;
    dbListKnowledge()
      .then((all) => {
        if (cancelled) return;
        // Rust returns ordered newest-first per db_commands.rs; slice client-side.
        setRecent(all.slice(0, RECENT_LIMIT));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(
    async (q: string) => {
      setLoading(true);
      setError(null);
      setSubmitted(q);
      setPref('knowledge.lastTab', q);
      try {
        const [kbRes, memRes, tlRes] = await Promise.allSettled([
          dbSearchKnowledge(q),
          semanticSearch({ query: q, topK: SEARCH_LIMIT }),
          timelineSearchCmd({ query: q, limit: SEARCH_LIMIT }),
        ]);

        const nextGroups: KnowledgeSearchGroup[] = [];

        // Knowledge Base — D-138 group 1
        if (kbRes.status === 'fulfilled') {
          nextGroups.push({
            source: 'knowledge',
            label: 'Knowledge Base',
            results: kbRes.value.map((e) => ({
              id: e.id,
              title: e.title || '(untitled)',
              preview: slicePreview(e.content),
            })),
          });
        } else {
          nextGroups.push({
            source: 'knowledge',
            label: 'Knowledge Base',
            results: [],
          });
        }

        // Memory — semantic_search hits
        if (memRes.status === 'fulfilled') {
          nextGroups.push({
            source: 'memory',
            label: 'Memory',
            results: memRes.value.map((h, i) => ({
              id: `${h.source_type}:${h.source_id}:${i}`,
              title: h.source_type ? `${h.source_type} · ${h.source_id}` : h.source_id || 'memory',
              preview: slicePreview(h.text),
              score: h.score,
            })),
          });
        } else {
          nextGroups.push({ source: 'memory', label: 'Memory', results: [] });
        }

        // Timeline — timeline_search_cmd hits
        if (tlRes.status === 'fulfilled') {
          nextGroups.push({
            source: 'timeline',
            label: 'Timeline',
            results: tlRes.value.map((t) => ({
              id: String(t.id),
              title: t.window_title || t.app_name || 'screenshot',
              preview: slicePreview(t.description),
            })),
          });
        } else {
          nextGroups.push({ source: 'timeline', label: 'Timeline', results: [] });
        }

        setGroups(nextGroups);

        // Surface a hard error only if all three sources failed.
        const allFailed =
          kbRes.status === 'rejected' &&
          memRes.status === 'rejected' &&
          tlRes.status === 'rejected';
        if (allFailed) {
          const firstErr = kbRes.reason ?? memRes.reason ?? tlRes.reason;
          setError(firstErr instanceof Error ? firstErr.message : String(firstErr));
        }
      } finally {
        setLoading(false);
      }
    },
    [setPref],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      setSubmitted('');
      setGroups([]);
      return;
    }
    void runSearch(trimmed);
  };

  const onRowClick = useCallback(
    async (source: KnowledgeGroupSource, row: KnowledgeSearchGroup['results'][number]) => {
      if (source === 'knowledge') {
        try {
          const entry = await dbGetKnowledge(row.id);
          setSelected(entry);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      } else if (source === 'memory') {
        setExpandedMemoryId((cur) => (cur === row.id ? null : row.id));
      } else if (source === 'timeline') {
        // Navigate to ScreenTimeline route; the timeline surface handles its
        // own focus logic. Timestamp hand-off is not part of Phase 5 scope.
        openRoute('screen-timeline');
      }
    },
    [openRoute],
  );

  const onRecentClick = useCallback(async (entry: KnowledgeEntry) => {
    setSelected(entry);
  }, []);

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="knowledge-base-root">
      {!hasLongCtx && (
        <CapabilityGap capability="long_context" surfaceLabel="Full-repo indexing" />
      )}
      <form className="knowledge-search-bar" onSubmit={onSubmit} role="search">
        <Input
          ref={inputRef}
          data-testid="knowledge-base-search-input"
          placeholder="Search knowledge, memory, and timeline…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Knowledge search query"
        />
        <Button type="submit" variant="primary">
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {error && (
        <div className="knowledge-error" role="alert">
          {error}
        </div>
      )}

      {!submitted ? (
        <section className="knowledge-recent-section">
          <h3 className="knowledge-search-group-heading">Recent entries</h3>
          {recent.length === 0 ? (
            <EmptyState
              label="No matches"
              description="Try a broader query or a different source."
            />
          ) : (
            <div className="knowledge-recent-list">
              {recent.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className="knowledge-result-row"
                  onClick={() => void onRecentClick(e)}
                >
                  <div className="knowledge-result-row-title">{e.title || '(untitled)'}</div>
                  <div className="knowledge-result-row-preview">
                    {slicePreview(e.content)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="knowledge-base-layout">
          {groups.map((g) => (
            <div
              key={g.source}
              className="knowledge-search-group"
              data-testid="knowledge-search-group"
              data-source={g.source}
            >
              <h3 className="knowledge-search-group-heading">
                {g.label} · {g.results.length}
              </h3>
              {g.results.length === 0 ? (
                <p className="knowledge-placeholder-hint">No matches.</p>
              ) : (
                g.results.map((row) => {
                  const expanded = g.source === 'memory' && expandedMemoryId === row.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      className="knowledge-result-row"
                      onClick={() => void onRowClick(g.source, row)}
                      aria-expanded={g.source === 'memory' ? expanded : undefined}
                    >
                      <div className="knowledge-result-row-title">{row.title}</div>
                      <div
                        className={
                          expanded
                            ? 'knowledge-result-row-preview expanded'
                            : 'knowledge-result-row-preview'
                        }
                      >
                        {row.preview || '—'}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ))}
        </section>
      )}

      <Dialog
        open={selected !== null}
        onClose={() => setSelected(null)}
        ariaLabel={selected ? `Knowledge entry: ${selected.title}` : 'Knowledge entry detail'}
      >
        {selected ? (
          <div className="knowledge-entry-detail">
            <header className="knowledge-entry-detail-header">
              <h2>{selected.title || '(untitled)'}</h2>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                Close
              </Button>
            </header>
            <div className="knowledge-entry-detail-meta">
              <span>source: {selected.source || '—'}</span>
              <span>
                updated: {new Date(selected.updated_at * 1000).toLocaleString()}
              </span>
            </div>
            <pre className="knowledge-entry-detail-body">{selected.content}</pre>
          </div>
        ) : null}
      </Dialog>
    </GlassPanel>
  );
}
