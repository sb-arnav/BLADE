// src/features/life-os/SocialGraphView.tsx — Phase 6 Plan 06-04 (LIFE-06).
//
// Contacts CRM: left-pane list + right-pane detail. Search is debounced 250ms
// (T-06-04-02 mitigation); delete is Dialog-confirmed (T-06-04-03 mitigation).
// All IPC flows through the Plan 06-02 life_os.ts wrappers — no raw invoke.
//
// Wrapper signature alignment (discovered in 06-02-SUMMARY):
//   - `socialGetInsights()` takes NO args; it returns a global list of
//     RelationshipInsight entries — we filter client-side by contact_name.
//   - `socialHowToApproach({contactId, goal})` requires a `goal` string.
//   - `socialAddContact` uses `relationshipType` (camelCase → snake_case at
//     the wrapper boundary).
//   - `socialLogInteraction` uses `summary`/`sentiment`/`topics`/`actionItems`
//     (NOT `type`/`notes` from the draft plan).
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-149
// @see .planning/phases/06-life-os-identity/06-04-PLAN.md Task 1
// @see .planning/REQUIREMENTS.md §LIFE-06

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, EmptyState, GlassPanel, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context/ToastContext';
import {
  socialAddContact,
  socialAnalyzeInteraction,
  socialDeleteContact,
  socialGetContact,
  socialGetInsights,
  socialGetInteractions,
  socialHowToApproach,
  socialListContacts,
  socialLogInteraction,
  socialSearchContacts,
} from '@/lib/tauri/life_os';
import type { Contact, Interaction, RelationshipInsight } from './types';
import './life-os.css';
import './life-os-rich-b.css';

const SEARCH_DEBOUNCE_MS = 250;

function formatTimeAgo(ts?: number | null): string {
  if (!ts) return 'never';
  const now = Date.now();
  const diffMs = now - ts * 1000;
  if (diffMs < 0) return 'scheduled';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatInteractionDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function SocialGraphView() {
  const { show } = useToast();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [insights, setInsights] = useState<RelationshipInsight[]>([]);

  const [detailLoading, setDetailLoading] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Dialog open states.
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [approachOpen, setApproachOpen] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);

  // Dialog form state.
  const [addName, setAddName] = useState('');
  const [addRelationship, setAddRelationship] = useState('');
  const [addNotes, setAddNotes] = useState('');

  const [approachGoal, setApproachGoal] = useState('');
  const [approachResult, setApproachResult] = useState<string | null>(null);
  const [approachBusy, setApproachBusy] = useState(false);

  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState<Interaction | null>(null);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);

  // Inline log-interaction form state.
  const [logSummary, setLogSummary] = useState('');
  const [logSentiment, setLogSentiment] = useState('neutral');
  const [logBusy, setLogBusy] = useState(false);

  // Debounce ref for search.
  const searchTimer = useRef<number | null>(null);

  const loadContacts = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const list = await socialListContacts();
      setContacts(list);
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  // Initial load: contacts + global insights.
  useEffect(() => {
    void loadContacts();
    void socialGetInsights()
      .then((list) => setInsights(list))
      .catch(() => {
        // Non-fatal — insights are optional decoration.
      });
  }, [loadContacts]);

  // Debounced search — triggers socialSearchContacts on non-empty query,
  // falls back to full list otherwise. Debounce mitigates T-06-04-02.
  useEffect(() => {
    if (searchTimer.current !== null) {
      window.clearTimeout(searchTimer.current);
    }
    searchTimer.current = window.setTimeout(() => {
      const q = searchQuery.trim();
      if (!q) {
        void loadContacts();
        return;
      }
      void socialSearchContacts(q)
        .then((list) => setContacts(list))
        .catch((e) =>
          show({ type: 'error', title: 'Search failed', message: String(e) }),
        );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimer.current !== null) {
        window.clearTimeout(searchTimer.current);
      }
    };
  }, [searchQuery, loadContacts, show]);

  // Load right-pane detail when selectedId changes.
  useEffect(() => {
    if (!selectedId) {
      setSelectedContact(null);
      setInteractions([]);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([
      socialGetContact(selectedId),
      socialGetInteractions({ contactId: selectedId, limit: 20 }),
    ])
      .then(([c, ix]) => {
        if (cancelled) return;
        setSelectedContact(c);
        setInteractions(ix);
      })
      .catch((e) => {
        if (cancelled) return;
        show({ type: 'error', title: 'Load contact failed', message: String(e) });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, show]);

  const selectedInsights = useMemo(() => {
    if (!selectedContact) return [] as RelationshipInsight[];
    return insights.filter((i) => i.contact_name === selectedContact.name);
  }, [selectedContact, insights]);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) return;
    try {
      await socialAddContact({
        name,
        relationshipType: addRelationship.trim() || undefined,
        notes: addNotes.trim() || undefined,
      });
      show({ type: 'success', title: 'Contact added', message: name });
      setAddOpen(false);
      setAddName('');
      setAddRelationship('');
      setAddNotes('');
      await loadContacts();
    } catch (e) {
      show({ type: 'error', title: 'Add contact failed', message: String(e) });
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    try {
      await socialDeleteContact(selectedId);
      show({ type: 'success', title: 'Contact deleted', message: selectedContact?.name ?? '' });
      setDeleteOpen(false);
      setSelectedId(null);
      await loadContacts();
    } catch (e) {
      show({ type: 'error', title: 'Delete failed', message: String(e) });
    }
  };

  const handleLog = async () => {
    if (!selectedId) return;
    const summary = logSummary.trim();
    if (!summary) return;
    setLogBusy(true);
    try {
      await socialLogInteraction({
        contactId: selectedId,
        summary,
        sentiment: logSentiment,
      });
      show({ type: 'success', title: 'Interaction logged' });
      setLogSummary('');
      // Refresh interactions.
      const ix = await socialGetInteractions({ contactId: selectedId, limit: 20 });
      setInteractions(ix);
    } catch (e) {
      show({ type: 'error', title: 'Log interaction failed', message: String(e) });
    } finally {
      setLogBusy(false);
    }
  };

  const handleApproach = async () => {
    if (!selectedId) return;
    const goal = approachGoal.trim();
    if (!goal) return;
    setApproachBusy(true);
    try {
      const result = await socialHowToApproach({ contactId: selectedId, goal });
      setApproachResult(result);
    } catch (e) {
      show({ type: 'error', title: 'Approach suggestion failed', message: String(e) });
      setApproachResult(null);
    } finally {
      setApproachBusy(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedId) return;
    const text = analyzeText.trim();
    if (!text) return;
    setAnalyzeBusy(true);
    try {
      const result = await socialAnalyzeInteraction({
        contactId: selectedId,
        conversationText: text,
      });
      setAnalyzeResult(result);
    } catch (e) {
      show({ type: 'error', title: 'Analyze failed', message: String(e) });
      setAnalyzeResult(null);
    } finally {
      setAnalyzeBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="social-graph-root">
      <div className="social-graph-header">
        <h2>Social Graph</h2>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          Add contact
        </Button>
      </div>

      <div className="social-graph-layout">
        {/* ─────────── LEFT: search + contacts list ──────────── */}
        <div className="social-contacts-pane">
          <div className="social-search-row">
            <Input
              placeholder="Search contacts"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search contacts"
            />
          </div>

          {listLoading && <GlassSpinner />}
          {listError && !listLoading && (
            <p className="life-placeholder-hint">Error: {listError}</p>
          )}

          {!listLoading && !listError && contacts.length === 0 && (
            <EmptyState
              label="BLADE is still learning your network"
              description="Contacts will appear after 24h of observed chat, email, and calendar activity — give me a day."
            />
          )}

          {contacts.map((c) => (
            <div
              key={c.id}
              className="contact-card"
              data-testid="contact-card"
              data-selected={selectedId === c.id ? 'true' : 'false'}
              onClick={() => setSelectedId(c.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId(c.id);
                }
              }}
            >
              <span className="contact-card-name">{c.name}</span>
              <span className="contact-card-meta">
                {c.relationship_type && (
                  <span className="contact-card-chip">{c.relationship_type}</span>
                )}
                <span>Last: {formatTimeAgo(c.last_interaction)}</span>
                <span>{c.interaction_count} interactions</span>
              </span>
            </div>
          ))}
        </div>

        {/* ─────────── RIGHT: selected contact detail ──────────── */}
        <div className="social-detail-pane" data-testid="contact-detail-pane">
          {!selectedId && (
            <p className="social-detail-empty">
              Select a contact on the left to view their details.
            </p>
          )}

          {selectedId && detailLoading && <GlassSpinner />}

          {selectedId && !detailLoading && selectedContact && (
            <>
              <div className="social-detail-header">
                <h3 className="social-detail-title">{selectedContact.name}</h3>
                <div className="social-detail-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setApproachGoal('');
                      setApproachResult(null);
                      setApproachOpen(true);
                    }}
                  >
                    How to approach
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setAnalyzeText('');
                      setAnalyzeResult(null);
                      setAnalyzeOpen(true);
                    }}
                  >
                    Analyze conversation
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              {/* Relationship metadata */}
              <div>
                <p className="social-section-label">Relationship</p>
                <p className="contact-card-meta">
                  {selectedContact.relationship_type && (
                    <span className="contact-card-chip">
                      {selectedContact.relationship_type}
                    </span>
                  )}
                  <span>Strength: {selectedContact.relationship_strength.toFixed(2)}</span>
                  <span>{selectedContact.interaction_count} interactions</span>
                </p>
                {selectedContact.notes && (
                  <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 4 }}>
                    {selectedContact.notes}
                  </p>
                )}
              </div>

              {/* Interactions */}
              <div>
                <p className="social-section-label">
                  Recent interactions ({interactions.length})
                </p>
                {interactions.length === 0 ? (
                  <p className="life-placeholder-hint" style={{ textAlign: 'left' }}>
                    No interactions logged yet.
                  </p>
                ) : (
                  <div className="social-interactions-list">
                    {interactions.map((i) => (
                      <div key={i.id} className="social-interaction-row">
                        <span>{formatInteractionDate(i.timestamp)}</span>
                        <span>{i.sentiment}</span>
                        <span style={{ color: 'var(--t-1)' }}>{i.summary}</span>
                        <span />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Insights */}
              {selectedInsights.length > 0 && (
                <div>
                  <p className="social-section-label">Insights</p>
                  <ul className="social-insights-list">
                    {selectedInsights.map((ins, idx) => (
                      <li key={idx} style={{ color: 'var(--t-2)', fontSize: 13 }}>
                        <strong style={{ color: 'var(--t-1)' }}>
                          {ins.insight_type}:
                        </strong>{' '}
                        {ins.description}
                        <br />
                        <em style={{ color: 'var(--t-3)', fontSize: 12 }}>
                          {ins.suggested_action}
                        </em>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Log interaction form */}
              <div className="social-log-form">
                <p className="social-section-label">Log interaction</p>
                <textarea
                  className="social-log-textarea"
                  placeholder="Summary of this interaction"
                  value={logSummary}
                  onChange={(e) => setLogSummary(e.target.value)}
                  aria-label="Interaction summary"
                />
                <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
                  <select
                    value={logSentiment}
                    onChange={(e) => setLogSentiment(e.target.value)}
                    aria-label="Sentiment"
                    style={{
                      background: 'rgba(0,0,0,0.2)',
                      color: 'var(--t-1)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--r-md)',
                      padding: 'var(--s-1) var(--s-2)',
                      fontSize: 13,
                    }}
                  >
                    <option value="positive">positive</option>
                    <option value="neutral">neutral</option>
                    <option value="negative">negative</option>
                  </select>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleLog}
                    disabled={logBusy || !logSummary.trim()}
                  >
                    {logBusy ? 'Saving…' : 'Log'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─────────── Add contact Dialog ──────────── */}
      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        ariaLabel="Add new contact"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Add contact</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', marginTop: 'var(--s-3)' }}>
          <Input
            placeholder="Name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            aria-label="Contact name"
          />
          <Input
            placeholder="Relationship (e.g. friend, colleague)"
            value={addRelationship}
            onChange={(e) => setAddRelationship(e.target.value)}
            aria-label="Relationship type"
          />
          <textarea
            className="social-log-textarea"
            placeholder="Notes (optional)"
            value={addNotes}
            onChange={(e) => setAddNotes(e.target.value)}
            aria-label="Contact notes"
          />
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end', marginTop: 'var(--s-4)' }}>
          <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleAdd} disabled={!addName.trim()}>
            Save
          </Button>
        </div>
      </Dialog>

      {/* ─────────── Delete confirm Dialog (T-06-04-03) ──────────── */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        ariaLabel="Confirm delete contact"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Delete contact?</h3>
        <p style={{ color: 'var(--t-2)', marginTop: 'var(--s-2)' }}>
          This will permanently delete {selectedContact?.name ?? 'this contact'} and
          their interaction history. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end', marginTop: 'var(--s-4)' }}>
          <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      </Dialog>

      {/* ─────────── How to approach Dialog ──────────── */}
      <Dialog
        open={approachOpen}
        onClose={() => setApproachOpen(false)}
        ariaLabel="How to approach contact"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>
          How to approach {selectedContact?.name}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', marginTop: 'var(--s-3)' }}>
          <Input
            placeholder="What's your goal? (e.g. ask for intro to X)"
            value={approachGoal}
            onChange={(e) => setApproachGoal(e.target.value)}
            aria-label="Goal for this approach"
          />
          {approachResult && (
            <div
              style={{
                padding: 'var(--s-3)',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                color: 'var(--t-1)',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
              }}
            >
              {approachResult}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end', marginTop: 'var(--s-4)' }}>
          <Button variant="ghost" onClick={() => setApproachOpen(false)}>Close</Button>
          <Button
            variant="primary"
            onClick={handleApproach}
            disabled={approachBusy || !approachGoal.trim()}
          >
            {approachBusy ? 'Thinking…' : 'Suggest opening'}
          </Button>
        </div>
      </Dialog>

      {/* ─────────── Analyze conversation Dialog ──────────── */}
      <Dialog
        open={analyzeOpen}
        onClose={() => setAnalyzeOpen(false)}
        ariaLabel="Analyze conversation"
      >
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Analyze conversation</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)', marginTop: 'var(--s-3)' }}>
          <textarea
            className="social-log-textarea"
            placeholder="Paste conversation text to analyze"
            value={analyzeText}
            onChange={(e) => setAnalyzeText(e.target.value)}
            aria-label="Conversation text"
            style={{ minHeight: 160 }}
          />
          {analyzeResult && (
            <div
              style={{
                padding: 'var(--s-3)',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                color: 'var(--t-2)',
                fontSize: 13,
              }}
            >
              <div style={{ color: 'var(--t-1)', marginBottom: 4 }}>
                {analyzeResult.summary}
              </div>
              <div style={{ fontSize: 12, color: 'var(--t-3)' }}>
                Sentiment: {analyzeResult.sentiment}
                {analyzeResult.topics.length > 0 && ' · Topics: ' + analyzeResult.topics.join(', ')}
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 'var(--s-2)', justifyContent: 'flex-end', marginTop: 'var(--s-4)' }}>
          <Button variant="ghost" onClick={() => setAnalyzeOpen(false)}>Close</Button>
          <Button
            variant="primary"
            onClick={handleAnalyze}
            disabled={analyzeBusy || !analyzeText.trim()}
          >
            {analyzeBusy ? 'Analyzing…' : 'Analyze'}
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
