// src/features/dev-tools/DocumentGenerator.tsx
//
// DEV-08 — Ingest + study notes + cross-synthesis + Q&A.
// Dedicated to the "generate/synthesize" output side of document_intelligence;
// Phase 5 KnowledgeBase handles the "read" side (D-179 dual-home).
//
// @see .planning/phases/07-dev-tools-admin/07-04-PLAN.md (Task 1 — DEV-08)
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-179
// @see src-tauri/src/document_intelligence.rs (doc_* command set)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { GlassPanel, Button, Dialog } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context/ToastContext';
import {
  docList,
  docIngest,
  docSearch,
  docDelete,
  docGenerateStudyNotes,
  docCrossSynthesis,
  docAnswerQuestion,
} from '@/lib/tauri/dev_tools';
import type { Document } from '@/lib/tauri/dev_tools';
import './dev-tools.css';
import './dev-tools-rich-b.css';

type DocTab = 'study' | 'synthesis' | 'qa';
const TAB_PREFIX = 'doc:';

export function DocumentGenerator() {
  const { prefs, setPref } = usePrefs();
  const toast = useToast();

  // Sidebar state ────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<Document[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Document[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const refreshDocs = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const list = await docList();
      setDocs(list);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Load docs failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setLoadingDocs(false);
    }
  }, [toast]);

  useEffect(() => {
    void refreshDocs();
  }, [refreshDocs]);

  const visibleDocs = searchResults ?? docs;

  // Tab state ─────────────────────────────────────────────────────────────
  const rawTab = prefs['devTools.activeTab'];
  const activeTab: DocTab =
    typeof rawTab === 'string' && rawTab.startsWith(TAB_PREFIX)
      ? ((rawTab.slice(TAB_PREFIX.length) as DocTab) ?? 'study')
      : 'study';
  const setActiveTab = (t: DocTab) => setPref('devTools.activeTab', `${TAB_PREFIX}${t}`);

  const singleSelectedId = selectedIds[0] ?? null;

  // Ingest ───────────────────────────────────────────────────────────────
  const [ingesting, setIngesting] = useState(false);

  const handleIngest = async () => {
    if (ingesting) return;
    setIngesting(true);
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Documents', extensions: ['pdf', 'md', 'txt', 'docx'] }],
      });
      if (!picked || typeof picked !== 'string') {
        setIngesting(false);
        return;
      }
      const doc = await docIngest(picked);
      toast.show({
        type: 'success',
        title: 'Ingested',
        message: doc.title || doc.file_path,
      });
      await refreshDocs();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Ingest failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setIngesting(false);
    }
  };

  // Search ────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const results = await docSearch(q);
      setSearchResults(results);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Search failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSearching(false);
    }
  };

  // Delete ────────────────────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deleteTargetId) return;
    try {
      await docDelete(deleteTargetId);
      toast.show({ type: 'success', title: 'Doc deleted' });
      setSelectedIds((prev) => prev.filter((id) => id !== deleteTargetId));
      setDeleteTargetId(null);
      await refreshDocs();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // Study notes tab ───────────────────────────────────────────────────────
  const [studyBusy, setStudyBusy] = useState(false);
  const [studyOutput, setStudyOutput] = useState<string>('');

  const handleStudyNotes = async () => {
    if (!singleSelectedId || studyBusy) return;
    setStudyBusy(true);
    try {
      const notes = await docGenerateStudyNotes(singleSelectedId);
      setStudyOutput(notes);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Generate study notes failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStudyBusy(false);
    }
  };

  // Cross-synthesis tab ───────────────────────────────────────────────────
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const [synthesisQuestion, setSynthesisQuestion] = useState('');
  const [synthesisOutput, setSynthesisOutput] = useState<string>('');

  const handleCrossSynthesis = async () => {
    if (selectedIds.length < 2 || synthesisBusy || !synthesisQuestion.trim()) return;
    setSynthesisBusy(true);
    try {
      // Rust `doc_cross_synthesis(question: String)` scans all ingested docs;
      // selection list is a UX hint (we pass a combined question). When Rust
      // grows a `doc_ids` arg (Phase 9 polish), wire it here.
      const result = await docCrossSynthesis(synthesisQuestion);
      setSynthesisOutput(result);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Cross-synthesis failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSynthesisBusy(false);
    }
  };

  // Q&A tab ───────────────────────────────────────────────────────────────
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaBusy, setQaBusy] = useState(false);
  const [qaAnswer, setQaAnswer] = useState<null | {
    question: string;
    answer: string;
    doc_ids_used: string[];
    confidence: number;
    relevant_quotes: string[];
  }>(null);

  const handleAnswer = async () => {
    if (!singleSelectedId || qaBusy || !qaQuestion.trim()) return;
    setQaBusy(true);
    try {
      const result = await docAnswerQuestion({
        question: qaQuestion,
        docIds: [singleSelectedId],
      });
      setQaAnswer(result);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Answer failed',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setQaBusy(false);
    }
  };

  const deletingDoc = useMemo(
    () => (deleteTargetId ? docs.find((d) => d.id === deleteTargetId) : null),
    [deleteTargetId, docs],
  );

  // Selection helpers ─────────────────────────────────────────────────────
  const toggleSelect = (id: string) => {
    if (activeTab === 'synthesis') {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
    } else {
      setSelectedIds((prev) => (prev[0] === id ? [] : [id]));
    }
  };

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="document-generator-root">
      <div className="doc-generator-layout">
        {/* Sidebar */}
        <aside className="doc-sidebar" data-testid="doc-list-sidebar">
          <div className="doc-sidebar-topbar">
            <div className="devtools-b-section-header">
              <h3>Documents</h3>
              <span style={{ fontSize: 11, color: 'var(--t-3)' }}>{visibleDocs.length}</span>
            </div>
            <input
              className="web-automation-selector-input"
              placeholder="Search docs…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleSearch();
              }}
              data-testid="doc-search-input"
            />
            <div style={{ display: 'flex', gap: 'var(--s-1)' }}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearchResults(null);
                  setSearchQuery('');
                }}
                disabled={searchResults === null && !searchQuery}
              >
                Clear
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSearch}
                disabled={searching || !searchQuery.trim()}
              >
                {searching ? 'Searching…' : 'Search'}
              </Button>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleIngest}
              disabled={ingesting}
              data-testid="doc-ingest-button"
            >
              {ingesting ? 'Ingesting…' : 'Ingest file'}
            </Button>
          </div>
          {loadingDocs ? (
            <div className="dev-placeholder-hint">Loading…</div>
          ) : visibleDocs.length === 0 ? (
            <div className="dev-placeholder-hint">
              {searchResults !== null ? 'No search matches.' : 'No documents ingested yet.'}
            </div>
          ) : (
            visibleDocs.map((doc) => {
              const selected = selectedIds.includes(doc.id);
              return (
                <div
                  key={doc.id}
                  className="doc-sidebar-row"
                  data-selected={String(selected)}
                  data-testid="doc-sidebar-row"
                  onClick={() => toggleSelect(doc.id)}
                >
                  {activeTab === 'synthesis' && (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelect(doc.id)}
                      onClick={(e) => e.stopPropagation()}
                      data-testid="doc-checkbox"
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="doc-sidebar-row-title">{doc.title || doc.id}</div>
                    <div className="doc-sidebar-row-meta">
                      {doc.doc_type} · {doc.word_count} words
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTargetId(doc.id);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              );
            })
          )}
        </aside>

        {/* Main */}
        <section className="doc-main">
          <div className="dev-tab-row">
            {(['study', 'synthesis', 'qa'] as DocTab[]).map((t) => (
              <button
                key={t}
                type="button"
                className="dev-tab-pill"
                data-active={String(activeTab === t)}
                onClick={() => setActiveTab(t)}
                data-testid="doc-tab"
              >
                {t === 'study' ? 'Study notes' : t === 'synthesis' ? 'Cross-synthesis' : 'Q&A'}
              </button>
            ))}
          </div>

          {activeTab === 'study' && (
            <div className="dev-card">
              <div className="devtools-b-section-header">
                <h3>Study notes</h3>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleStudyNotes}
                  disabled={!singleSelectedId || studyBusy}
                  data-testid="doc-study-button"
                >
                  {studyBusy ? 'Generating…' : 'Generate'}
                </Button>
              </div>
              {!singleSelectedId && (
                <div className="dev-placeholder-hint">Pick a single document from the sidebar.</div>
              )}
              {studyOutput && (
                <div className="doc-output-card" data-testid="doc-study-output">
                  {studyOutput}
                </div>
              )}
            </div>
          )}

          {activeTab === 'synthesis' && (
            <div className="dev-card">
              <div className="devtools-b-section-header">
                <h3>Cross-synthesis</h3>
                <span style={{ fontSize: 11, color: 'var(--t-3)' }}>
                  {selectedIds.length} selected
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--t-3)', margin: 0 }}>
                Select ≥2 docs in the sidebar, ask a synthesis question. (Rust surface runs over
                the full corpus today; selection list is a UI hint.)
              </p>
              <textarea
                className="web-automation-textarea"
                placeholder="Synthesize findings across the selected documents…"
                rows={3}
                value={synthesisQuestion}
                onChange={(e) => setSynthesisQuestion(e.target.value)}
                data-testid="doc-synthesis-question"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleCrossSynthesis}
                disabled={
                  selectedIds.length < 2 || synthesisBusy || !synthesisQuestion.trim()
                }
                data-testid="doc-synthesis-button"
              >
                {synthesisBusy ? 'Synthesizing…' : 'Synthesize'}
              </Button>
              {synthesisOutput && (
                <div className="doc-output-card" data-testid="doc-synthesis-output">
                  {synthesisOutput}
                </div>
              )}
            </div>
          )}

          {activeTab === 'qa' && (
            <div className="dev-card">
              <div className="devtools-b-section-header">
                <h3>Q&A</h3>
              </div>
              {!singleSelectedId && (
                <div className="dev-placeholder-hint">Pick a single document from the sidebar.</div>
              )}
              <textarea
                className="web-automation-textarea"
                rows={3}
                placeholder="Ask a question about the selected document…"
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                data-testid="doc-qa-question"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={handleAnswer}
                disabled={!singleSelectedId || qaBusy || !qaQuestion.trim()}
                data-testid="doc-qa-button"
              >
                {qaBusy ? 'Thinking…' : 'Ask'}
              </Button>
              {qaAnswer && (
                <div className="doc-output-card" data-testid="doc-qa-output">
                  <div style={{ fontSize: 11, color: 'var(--t-3)', marginBottom: 'var(--s-1)' }}>
                    Confidence: {Math.round(qaAnswer.confidence * 100)}% · {qaAnswer.doc_ids_used.length} docs
                  </div>
                  <div>{qaAnswer.answer}</div>
                  {qaAnswer.relevant_quotes.length > 0 && (
                    <div style={{ marginTop: 'var(--s-2)' }}>
                      <strong style={{ fontSize: 11, color: 'var(--t-3)' }}>Quotes:</strong>
                      <ul style={{ paddingLeft: 'var(--s-3)', margin: 'var(--s-1) 0 0' }}>
                        {qaAnswer.relevant_quotes.map((q, i) => (
                          <li key={i} style={{ fontSize: 12, color: 'var(--t-2)' }}>
                            {q}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Delete confirm dialog */}
      <Dialog
        open={deleteTargetId !== null}
        onClose={() => setDeleteTargetId(null)}
        ariaLabel="Confirm delete document"
      >
        <div style={{ padding: 'var(--s-3)', maxWidth: 420 }}>
          <div className="devtools-b-danger-banner">DELETE DOCUMENT — IRREVERSIBLE</div>
          <p style={{ margin: 0, fontSize: 13 }}>
            Delete <strong>{deletingDoc?.title ?? deleteTargetId}</strong> from the corpus?
          </p>
          <div className="devtools-b-dialog-actions">
            <Button variant="ghost" onClick={() => setDeleteTargetId(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
