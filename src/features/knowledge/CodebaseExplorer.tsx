// src/features/knowledge/CodebaseExplorer.tsx — Phase 5 Plan 05-06 (KNOW-09).
//
// Document list + per-doc search + Q&A surface. Backed by document_intelligence:
//   - doc_list               on mount — populates the left column
//   - doc_search(query)      cross-document search — Rust returns matched docs
//   - doc_answer_question    LLM-backed Q&A scoped to a single doc
//   - doc_ingest(file_path)  ingest a new document from a file path
//   - doc_delete(id)         remove a document
//
// The selected-doc pane holds two inputs:
//   1. Search within the library (scoped visually to the selected doc when
//      one is picked) — runs doc_search(query) since the Rust wrapper takes no
//      document-scope arg. We filter client-side to the selected doc when
//      applicable, and fall back to the full cross-doc hit list otherwise.
//   2. "Ask this document" — runs doc_answer_question({question, docIds: [id]}).
//
// T-05-06-02 mitigation: the LLM-bound question is rendered back to the user
// as plain text only (React auto-escape) — no raw HTML injection. Prompt-injection
// against the LLM itself is out of scope for the frontend.
//
// @see .planning/phases/05-agents-knowledge/05-06-PLAN.md
// @see src-tauri/src/document_intelligence.rs
// @see .planning/REQUIREMENTS.md §KNOW-09

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Input, Dialog } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  docList,
  docSearch,
  docAnswerQuestion,
  docIngest,
  docDelete,
} from '@/lib/tauri/knowledge';
import type { DocumentEntry, DocQA } from '@/lib/tauri/knowledge';
import './knowledge.css';
import './knowledge-rich-b.css';

function formatTimestamp(unixMs: number): string {
  if (!Number.isFinite(unixMs)) return '—';
  const ms = unixMs > 1e12 ? unixMs : unixMs * 1000;
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function CodebaseExplorer() {
  const toast = useToast();

  const [docs, setDocs] = useState<DocumentEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DocumentEntry[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<DocQA | null>(null);
  const [asking, setAsking] = useState(false);

  const [ingestOpen, setIngestOpen] = useState(false);
  const [ingestPath, setIngestPath] = useState('');
  const [ingesting, setIngesting] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true);
    setDocsError(null);
    try {
      const rows = await docList();
      setDocs(rows);
      // Auto-select first doc if nothing is selected yet.
      setSelectedId((prev) => prev ?? (rows[0]?.id ?? null));
    } catch (e) {
      setDocsError(e instanceof Error ? e.message : String(e));
      setDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const selected = useMemo(
    () => docs.find((d) => d.id === selectedId) ?? null,
    [docs, selectedId],
  );

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setAnswer(null);
    setSearchResults(null);
    setSearchQuery('');
    setQuestion('');
  }, []);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = searchQuery.trim();
      if (!q || searching) return;
      setSearching(true);
      try {
        const results = await docSearch(q);
        setSearchResults(results);
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Search failed',
          message: err instanceof Error ? err.message : String(err),
        });
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    },
    [searchQuery, searching, toast],
  );

  const handleAsk = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const q = question.trim();
      if (!q || !selected || asking) return;
      setAsking(true);
      setAnswer(null);
      try {
        const result = await docAnswerQuestion({
          question: q,
          docIds: [selected.id],
        });
        setAnswer(result);
      } catch (err) {
        toast.show({
          type: 'error',
          title: 'Could not answer',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setAsking(false);
      }
    },
    [question, selected, asking, toast],
  );

  const handleIngest = useCallback(async () => {
    const path = ingestPath.trim();
    if (!path || ingesting) return;
    setIngesting(true);
    try {
      const doc = await docIngest(path);
      setIngestOpen(false);
      setIngestPath('');
      toast.show({
        type: 'success',
        title: 'Document ingested',
        message: doc.title,
      });
      await loadDocs();
      setSelectedId(doc.id);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Ingest failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIngesting(false);
    }
  }, [ingestPath, ingesting, toast, loadDocs]);

  const handleDelete = useCallback(async () => {
    const id = deleteId;
    if (!id) return;
    try {
      await docDelete(id);
      setDocs((prev) => prev.filter((d) => d.id !== id));
      if (selectedId === id) setSelectedId(null);
      toast.show({ type: 'success', title: 'Document removed' });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDeleteId(null);
    }
  }, [deleteId, selectedId, toast]);

  // When a search is active, filter results to the selected doc if we have
  // one. The Rust doc_search returns matched documents, so "filter to this
  // doc" means "did this doc appear in the match set?".
  const filteredSearchResults = useMemo(() => {
    if (!searchResults) return null;
    if (!selected) return searchResults;
    const self = searchResults.find((d) => d.id === selected.id);
    if (self) return [self, ...searchResults.filter((d) => d.id !== selected.id)];
    return searchResults;
  }, [searchResults, selected]);

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="codebase-explorer-root">
      <div className="codebase-explorer-layout">
        {/* ── Left column: document list ─────────────────────────────── */}
        <aside className="codebase-doc-list" aria-label="Documents">
          <div className="codebase-doc-list-head">
            <h2 className="kb-section-title">Library</h2>
            <Button
              variant="primary"
              size="sm"
              type="button"
              onClick={() => setIngestOpen(true)}
            >
              Ingest new
            </Button>
          </div>

          {docsError ? (
            <div className="codebase-empty" role="alert">
              Could not load documents: {docsError}
            </div>
          ) : loadingDocs ? (
            <div className="codebase-empty">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="codebase-empty">
              No documents yet. Ingest a file to begin.
            </div>
          ) : (
            <div className="codebase-doc-list-scroll">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  className="codebase-doc-card"
                  data-selected={doc.id === selectedId ? 'true' : 'false'}
                  onClick={() => handleSelect(doc.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSelect(doc.id);
                    }
                  }}
                >
                  <span className="codebase-doc-card-title">{doc.title || '(untitled)'}</span>
                  <span className="codebase-doc-card-meta">
                    {doc.word_count.toLocaleString()} words ·{' '}
                    {formatTimestamp(doc.added_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* ── Right column: selected doc pane ────────────────────────── */}
        <div className="codebase-doc-pane">
          {selected ? (
            <>
              <header className="codebase-doc-pane-heading">
                <h2 className="codebase-doc-pane-title">{selected.title}</h2>
                <span className="codebase-doc-pane-meta">
                  {selected.doc_type} · {selected.word_count.toLocaleString()} words ·
                  ingested {formatTimestamp(selected.added_at)}
                </span>
                <div style={{ display: 'flex', gap: 'var(--s-2)', marginTop: 'var(--s-1)' }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => setDeleteId(selected.id)}
                  >
                    Delete
                  </Button>
                </div>
              </header>

              {selected.summary ? (
                <p style={{ color: 'var(--t-2)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  {selected.summary}
                </p>
              ) : null}

              <form className="codebase-search-form" onSubmit={handleSearch}>
                <Input
                  type="search"
                  placeholder="Search library…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  disabled={searching}
                />
                <Button variant="secondary" size="sm" type="submit" disabled={!searchQuery.trim() || searching}>
                  {searching ? 'Searching…' : 'Search'}
                </Button>
              </form>

              {filteredSearchResults && filteredSearchResults.length > 0 ? (
                <div className="codebase-search-results">
                  {filteredSearchResults.map((hit) => (
                    <div
                      key={hit.id}
                      className="codebase-search-result"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelect(hit.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleSelect(hit.id);
                        }
                      }}
                    >
                      <strong>{hit.title}</strong>
                      {hit.summary ? (
                        <>
                          {' — '}
                          {hit.summary.slice(0, 180)}
                          {hit.summary.length > 180 ? '…' : ''}
                        </>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : filteredSearchResults && filteredSearchResults.length === 0 ? (
                <div className="codebase-empty">No matches for &ldquo;{searchQuery}&rdquo;.</div>
              ) : null}

              <form className="codebase-question-form" onSubmit={handleAsk}>
                <Input
                  type="text"
                  placeholder={`Ask "${selected.title}" anything…`}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  disabled={asking}
                />
                <Button variant="primary" size="sm" type="submit" disabled={!question.trim() || asking}>
                  {asking ? 'Thinking…' : 'Ask'}
                </Button>
              </form>

              {answer ? (
                <div className="codebase-answer">
                  <h3 className="codebase-answer-heading">Answer</h3>
                  {answer.answer}
                  {answer.relevant_quotes && answer.relevant_quotes.length > 0 ? (
                    <div className="codebase-answer-sources">
                      {answer.relevant_quotes.length} relevant quote
                      {answer.relevant_quotes.length === 1 ? '' : 's'} ·{' '}
                      confidence {Math.round((answer.confidence ?? 0) * 100)}%
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="codebase-empty">
              {loadingDocs
                ? 'Loading library…'
                : docs.length === 0
                  ? 'Ingest a document to begin exploring.'
                  : 'Select a document from the list.'}
            </div>
          )}
        </div>
      </div>

      {/* ── Ingest dialog ─────────────────────────────────────────── */}
      <Dialog
        open={ingestOpen}
        onClose={() => {
          setIngestOpen(false);
          setIngestPath('');
        }}
        ariaLabel="Ingest a new document"
      >
        <form
          style={{
            padding: 'var(--s-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-3)',
            minWidth: 420,
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void handleIngest();
          }}
        >
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>
            Ingest new document
          </h3>
          <label htmlFor="ingest-path" style={{ color: 'var(--t-2)', fontSize: 13 }}>
            Absolute file path
          </label>
          <Input
            id="ingest-path"
            type="text"
            value={ingestPath}
            onChange={(e) => setIngestPath(e.target.value)}
            placeholder="/path/to/document.md"
            autoFocus
            disabled={ingesting}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setIngestOpen(false);
                setIngestPath('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!ingestPath.trim() || ingesting}
            >
              {ingesting ? 'Ingesting…' : 'Ingest'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── Delete confirm ─────────────────────────────────────────── */}
      <Dialog
        open={deleteId !== null}
        onClose={() => setDeleteId(null)}
        ariaLabel="Confirm document deletion"
      >
        <div
          style={{
            padding: 'var(--s-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s-3)',
          }}
        >
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 18 }}>
            Delete this document?
          </h3>
          <p style={{ margin: 0, color: 'var(--t-2)', fontSize: 14 }}>
            The indexed chunks and Q&amp;A history will be removed. This cannot be undone.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--s-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)}>
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
