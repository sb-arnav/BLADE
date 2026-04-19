// src/features/identity/NegotiationView.tsx
//
// Identity cluster — Negotiation route (IDEN-04). 4-tab surface (D-156):
//   Debate / Scenarios / Analyze / Tools.
//
// Tab state is LOCAL useState — deliberately NOT persisted to
// prefs['identity.activeTab'] to avoid collision with PersonaView which owns
// that key with a 'persona:' prefix. Tabs here reset to 'debate' on each
// mount; this is an explicit Phase 6 simplification.
//
// Debate rendering (D-156): plain-text rows, NOT chat bubbles — Phase 3 chat
// infra is not imported here.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-156
// @see src/lib/tauri/identity.ts (negotiation_* wrappers)

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  negotiationAnalyze,
  negotiationBuildArgument,
  negotiationConclude,
  negotiationCritiqueMove,
  negotiationFindCommonGround,
  negotiationGetDebates,
  negotiationGetScenarios,
  negotiationRoleplay,
  negotiationRound,
  negotiationStartDebate,
  negotiationSteelman,
} from '@/lib/tauri/identity';
import type {
  DebateRound,
  DebateSession,
  NegotiationArgument,
  NegotiationScenario,
} from './types';
import './identity.css';
import './identity-rich-a.css';

type NegTab = 'debate' | 'scenarios' | 'analyze' | 'tools';
const DEFAULT_LIMIT = 20;

export function NegotiationView() {
  const [tab, setTab] = useState<NegTab>('debate');

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="negotiation-view-root">
      <header className="identity-surface-header">
        <div>
          <h1 className="identity-surface-title">Negotiation</h1>
          <p className="identity-surface-sub">
            Debate practice + scenario roleplay + conversation analysis + 4 compact tools.
          </p>
        </div>
      </header>

      <div className="identity-tabs" role="tablist" aria-label="Negotiation sections">
        {(['debate', 'scenarios', 'analyze', 'tools'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="identity-tab-pill"
            data-active={tab === t}
            data-testid="negotiation-tab"
            data-tab={t}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'debate' && <DebateTab />}
      {tab === 'scenarios' && <ScenariosTab />}
      {tab === 'analyze' && <AnalyzeTab />}
      {tab === 'tools' && <ToolsTab />}
    </GlassPanel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Debate tab — sidebar list + active session rounds + compose
// ═══════════════════════════════════════════════════════════════════════════

function DebateTab() {
  const toast = useToast();
  const [sessions, setSessions] = useState<DebateSession[]>([]);
  const [active, setActive] = useState<DebateSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startTopic, setStartTopic] = useState('');
  const [startStance, setStartStance] = useState('');
  const [starting, setStarting] = useState(false);

  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);
  const [concluding, setConcluding] = useState<'idle' | 'confirm' | 'running'>('idle');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await negotiationGetDebates(DEFAULT_LIMIT);
      setSessions(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!startTopic.trim() || !startStance.trim()) return;
    setStarting(true);
    try {
      const session = await negotiationStartDebate({
        topic: startTopic.trim(),
        userPosition: startStance.trim(),
      });
      setActive(session);
      setStartTopic('');
      setStartStance('');
      toast.show({ type: 'success', title: 'Debate started', message: session.topic });
      await reload();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Failed to start debate',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setStarting(false);
    }
  };

  const handleSend = async () => {
    if (!active || !compose.trim()) return;
    setSending(true);
    try {
      const round = await negotiationRound({
        sessionId: active.id,
        userMessage: compose.trim(),
      });
      setActive({
        ...active,
        rounds: [...active.rounds, round],
      });
      setCompose('');
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Round failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setSending(false);
    }
  };

  const handleConclude = async () => {
    if (!active) return;
    setConcluding('running');
    try {
      const verdict = await negotiationConclude(active.id);
      toast.show({ type: 'success', title: 'Debate concluded', message: verdict });
      setActive({ ...active, verdict });
      await reload();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Conclude failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setConcluding('idle');
    }
  };

  const pickSession = (session: DebateSession) => {
    setActive(session);
  };

  return (
    <div className="negotiation-layout" data-testid="negotiation-debate-root">
      <aside className="negotiation-sidebar" aria-label="Debate sessions">
        <div className="negotiation-sidebar-header">Recent debates</div>
        {loading && sessions.length === 0 && (
          <div style={{ padding: 'var(--s-3)', display: 'flex', justifyContent: 'center' }}>
            <GlassSpinner />
          </div>
        )}
        {error && (
          <div style={{ padding: 'var(--s-3)', color: 'var(--t-3)', fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && sessions.length === 0 && !error && (
          <div style={{ padding: 'var(--s-3)', color: 'var(--t-3)', fontSize: 12 }}>
            No past debates yet.
          </div>
        )}
        {sessions.map((s) => (
          <button
            type="button"
            key={s.id}
            className="negotiation-debate-row"
            data-selected={active?.id === s.id}
            onClick={() => pickSession(s)}
          >
            <span className="negotiation-debate-row-topic">{s.topic || '(untitled)'}</span>
            <span className="negotiation-debate-row-meta">
              {s.rounds.length} round{s.rounds.length === 1 ? '' : 's'}
              {s.verdict ? ' · concluded' : ''}
            </span>
          </button>
        ))}
      </aside>

      <section className="negotiation-main">
        {!active ? (
          <form className="negotiation-start-form" onSubmit={handleStart}>
            <h3 className="negotiation-tool-title">Start a new debate</h3>
            <Input
              placeholder="Topic"
              value={startTopic}
              onChange={(e) => setStartTopic(e.target.value)}
              aria-label="Debate topic"
            />
            <Input
              placeholder="Your stance"
              value={startStance}
              onChange={(e) => setStartStance(e.target.value)}
              aria-label="Your stance"
            />
            <Button
              type="submit"
              variant="primary"
              disabled={starting || !startTopic.trim() || !startStance.trim()}
            >
              {starting ? 'Starting…' : 'Start debate'}
            </Button>
          </form>
        ) : (
          <>
            <article className="identity-section" style={{ marginBottom: 0 }}>
              <header className="identity-section-header">
                <h3 className="identity-section-title">
                  {active.topic || '(untitled)'}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActive(null)}
                >
                  New debate
                </Button>
              </header>
              <p className="identity-section-content">
                <strong>Your stance:</strong> {active.user_position}
                {'  ·  '}
                <strong>Opponent:</strong> {active.opponent_position}
              </p>
              {active.verdict && (
                <p className="persona-person-result">Verdict — {active.verdict}</p>
              )}
            </article>

            <div className="negotiation-rounds" data-testid="negotiation-rounds">
              {active.rounds.length === 0 ? (
                <div className="identity-empty">No rounds yet. Submit the first below.</div>
              ) : (
                active.rounds.map((r) => <RoundBlock key={r.round_num} round={r} />)
              )}
            </div>

            <div className="negotiation-compose">
              <div className="negotiation-compose-input">
                <Input
                  placeholder="Your turn…"
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                  aria-label="Your argument"
                  disabled={sending || !!active.verdict}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
              </div>
              <Button
                variant="primary"
                onClick={() => void handleSend()}
                disabled={sending || !compose.trim() || !!active.verdict}
              >
                {sending ? 'Sending…' : 'Submit'}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setConcluding('confirm')}
                disabled={sending || concluding !== 'idle' || !!active.verdict}
              >
                Conclude
              </Button>
            </div>
          </>
        )}
      </section>

      {concluding === 'confirm' && (
        <Dialog
          open={true}
          onClose={() => setConcluding('idle')}
          ariaLabel="Confirm conclude debate"
        >
          <h3 className="identity-edit-dialog-title">Conclude this debate?</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13 }}>
            This records the final verdict and locks the session. You can still start a new one
            afterward.
          </p>
          <div className="identity-edit-dialog-actions">
            <Button variant="ghost" onClick={() => setConcluding('idle')}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleConclude()}>
              Conclude
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function RoundBlock({ round }: { round: DebateRound }) {
  return (
    <div>
      <div className="negotiation-round" data-role="user">
        <div className="negotiation-round-role">You · round {round.round_num}</div>
        <div>{round.user_argument.position}</div>
      </div>
      <div className="negotiation-round" data-role="blade">
        <div className="negotiation-round-role">Opponent</div>
        <div>{round.opponent_argument.position}</div>
      </div>
      {round.blade_coaching && (
        <div className="negotiation-round" data-role="coaching">
          <div className="negotiation-round-role">BLADE coaching</div>
          <div>{round.blade_coaching}</div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenarios tab
// ═══════════════════════════════════════════════════════════════════════════

function ScenariosTab() {
  const toast = useToast();
  const [scenarios, setScenarios] = useState<NegotiationScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [active, setActive] = useState<NegotiationScenario | null>(null);
  const [theirMessage, setTheirMessage] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await negotiationGetScenarios(DEFAULT_LIMIT);
      setScenarios(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleRoleplay = async () => {
    if (!active || !theirMessage.trim()) return;
    setRunning(true);
    try {
      const out = await negotiationRoleplay({
        scenarioId: active.id,
        theirMessage: theirMessage.trim(),
      });
      setResponse(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Roleplay failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="negotiation-scenarios-root">
      {loading && scenarios.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner />
        </div>
      )}
      {error && (
        <div className="identity-deferred-card" role="status">
          <p><strong>Scenario load failed.</strong></p>
          <p>{error}</p>
        </div>
      )}
      {!loading && scenarios.length === 0 && !error && (
        <div className="identity-empty">
          No scenarios yet. Analyze a conversation in the "Analyze" tab to seed the first one.
        </div>
      )}

      {scenarios.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--s-2)',
            marginBottom: 'var(--s-3)',
          }}
        >
          {scenarios.map((s) => (
            <article
              key={s.id}
              className="negotiation-scenario-card"
              data-selected={active?.id === s.id}
              style={
                active?.id === s.id
                  ? { borderColor: 'var(--status-running)' }
                  : undefined
              }
            >
              <span className="negotiation-scenario-title">
                {s.context.slice(0, 80)}
                {s.context.length > 80 ? '…' : ''}
              </span>
              <span className="negotiation-scenario-meta">
                Goal: {s.user_goal || '—'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setActive(s)}>
                {active?.id === s.id ? 'Selected' : 'Select'}
              </Button>
            </article>
          ))}
        </div>
      )}

      {active && (
        <article className="negotiation-tool-card">
          <h3 className="negotiation-tool-title">Roleplay: {active.user_goal || active.id}</h3>
          <p className="negotiation-tool-desc">
            Paste what they said; BLADE drafts your counter given the scenario's tactics and BATNA.
          </p>
          <textarea
            value={theirMessage}
            onChange={(e) => setTheirMessage(e.target.value)}
            rows={5}
            className="identity-edit-textarea"
            placeholder="Their message…"
          />
          <Button
            variant="primary"
            onClick={() => void handleRoleplay()}
            disabled={running || !theirMessage.trim()}
          >
            {running ? 'Thinking…' : 'Draft response'}
          </Button>
          {response && <div className="negotiation-tool-result">{response}</div>}
        </article>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Analyze tab
// ═══════════════════════════════════════════════════════════════════════════

function AnalyzeTab() {
  const toast = useToast();
  const [context, setContext] = useState('');
  const [userGoal, setUserGoal] = useState('');
  const [theirInfo, setTheirInfo] = useState('');
  const [result, setResult] = useState<NegotiationScenario | null>(null);
  const [running, setRunning] = useState(false);

  const handleAnalyze = async () => {
    if (!context.trim()) return;
    setRunning(true);
    try {
      const r = await negotiationAnalyze({
        context: context.trim(),
        userGoal: userGoal.trim(),
        theirInfo: theirInfo.trim(),
      });
      setResult(r);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Analyze failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="negotiation-analyze-root">
      <article className="negotiation-tool-card">
        <h3 className="negotiation-tool-title">Analyze conversation</h3>
        <p className="negotiation-tool-desc">
          Paste the conversation + your goal + anything you know about the other party.
          BLADE returns a structured scenario (tactics, scripts, BATNA).
        </p>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={10}
          className="identity-edit-textarea"
          placeholder="Paste conversation text here…"
          aria-label="Conversation context"
        />
        <Input
          placeholder="Your goal"
          value={userGoal}
          onChange={(e) => setUserGoal(e.target.value)}
          aria-label="Your goal"
        />
        <Input
          placeholder="What you know about them"
          value={theirInfo}
          onChange={(e) => setTheirInfo(e.target.value)}
          aria-label="Their info"
        />
        <Button
          variant="primary"
          onClick={() => void handleAnalyze()}
          disabled={running || !context.trim()}
        >
          {running ? 'Analyzing…' : 'Analyze'}
        </Button>
      </article>

      {result && (
        <article
          className="negotiation-analyze-result"
          data-testid="negotiation-analyze-result"
        >
          <p><strong>Context:</strong> {result.context}</p>
          {result.user_goal && <p><strong>Goal:</strong> {result.user_goal}</p>}
          {result.their_likely_goal && (
            <p><strong>Their likely goal:</strong> {result.their_likely_goal}</p>
          )}
          {result.tactics.length > 0 && (
            <>
              <p><strong>Tactics</strong></p>
              <ul className="persona-trait-evidence-list">
                {result.tactics.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {result.scripts.length > 0 && (
            <>
              <p><strong>Scripts</strong></p>
              <ul className="persona-trait-evidence-list">
                {result.scripts.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {result.batna && <p><strong>BATNA:</strong> {result.batna}</p>}
        </article>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Tools tab — 4 compact tool cards
// ═══════════════════════════════════════════════════════════════════════════

function ToolsTab() {
  return (
    <div className="negotiation-tools-grid" data-testid="negotiation-tools-root">
      <BuildArgumentCard />
      <SteelmanCard />
      <FindCommonGroundCard />
      <CritiqueMoveCard />
    </div>
  );
}

function BuildArgumentCard() {
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [position, setPosition] = useState('');
  const [context, setContext] = useState('');
  const [result, setResult] = useState<NegotiationArgument | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!topic.trim() || !position.trim()) return;
    setRunning(true);
    try {
      const r = await negotiationBuildArgument({
        topic: topic.trim(),
        position: position.trim(),
        context: context.trim(),
      });
      setResult(r);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Build argument failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <article className="negotiation-tool-card" data-testid="negotiation-tool-build">
      <h3 className="negotiation-tool-title">Build argument</h3>
      <p className="negotiation-tool-desc">
        Structured argument — position + supporting points + evidence + self-spotted weaknesses.
      </p>
      <Input
        placeholder="Topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        aria-label="Topic"
      />
      <Input
        placeholder="Your position"
        value={position}
        onChange={(e) => setPosition(e.target.value)}
        aria-label="Your position"
      />
      <Input
        placeholder="Context (optional)"
        value={context}
        onChange={(e) => setContext(e.target.value)}
        aria-label="Context"
      />
      <Button
        variant="primary"
        onClick={() => void run()}
        disabled={running || !topic.trim() || !position.trim()}
      >
        {running ? 'Building…' : 'Build'}
      </Button>
      {result && <ArgumentResult argument={result} />}
    </article>
  );
}

function SteelmanCard() {
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [opponent, setOpponent] = useState('');
  const [result, setResult] = useState<NegotiationArgument | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!topic.trim() || !opponent.trim()) return;
    setRunning(true);
    try {
      const r = await negotiationSteelman({
        topic: topic.trim(),
        opponentPosition: opponent.trim(),
      });
      setResult(r);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Steelman failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <article className="negotiation-tool-card" data-testid="negotiation-tool-steelman">
      <h3 className="negotiation-tool-title">Steelman</h3>
      <p className="negotiation-tool-desc">
        Strongest possible version of the opposing position.
      </p>
      <Input
        placeholder="Topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        aria-label="Topic"
      />
      <Input
        placeholder="Opponent position"
        value={opponent}
        onChange={(e) => setOpponent(e.target.value)}
        aria-label="Opponent position"
      />
      <Button
        variant="primary"
        onClick={() => void run()}
        disabled={running || !topic.trim() || !opponent.trim()}
      >
        {running ? 'Steelmanning…' : 'Run'}
      </Button>
      {result && <ArgumentResult argument={result} />}
    </article>
  );
}

function FindCommonGroundCard() {
  const toast = useToast();
  const [topic, setTopic] = useState('');
  const [posA, setPosA] = useState('');
  const [posB, setPosB] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!topic.trim() || !posA.trim() || !posB.trim()) return;
    setRunning(true);
    try {
      const r = await negotiationFindCommonGround({
        topic: topic.trim(),
        posA: posA.trim(),
        posB: posB.trim(),
      });
      setResult(r);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Common-ground search failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <article
      className="negotiation-tool-card"
      data-testid="negotiation-tool-common-ground"
    >
      <h3 className="negotiation-tool-title">Find common ground</h3>
      <p className="negotiation-tool-desc">
        Bridges two opposing positions on a shared topic.
      </p>
      <Input
        placeholder="Topic"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        aria-label="Topic"
      />
      <textarea
        value={posA}
        onChange={(e) => setPosA(e.target.value)}
        rows={3}
        className="identity-edit-textarea"
        placeholder="Position A"
        aria-label="Position A"
      />
      <textarea
        value={posB}
        onChange={(e) => setPosB(e.target.value)}
        rows={3}
        className="identity-edit-textarea"
        placeholder="Position B"
        aria-label="Position B"
      />
      <Button
        variant="primary"
        onClick={() => void run()}
        disabled={running || !topic.trim() || !posA.trim() || !posB.trim()}
      >
        {running ? 'Searching…' : 'Find'}
      </Button>
      {result && <div className="negotiation-tool-result">{result}</div>}
    </article>
  );
}

function CritiqueMoveCard() {
  const toast = useToast();
  const [scenarioId, setScenarioId] = useState('');
  const [userMove, setUserMove] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    if (!scenarioId.trim() || !userMove.trim()) return;
    setRunning(true);
    try {
      const r = await negotiationCritiqueMove({
        scenarioId: scenarioId.trim(),
        userMove: userMove.trim(),
      });
      setResult(r);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Critique failed',
        message: typeof err === 'string' ? err : String(err),
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <article
      className="negotiation-tool-card"
      data-testid="negotiation-tool-critique"
    >
      <h3 className="negotiation-tool-title">Critique move</h3>
      <p className="negotiation-tool-desc">
        Analyze a move you're considering in an existing scenario (paste the scenario id
        from the Scenarios tab).
      </p>
      <Input
        placeholder="Scenario id"
        value={scenarioId}
        onChange={(e) => setScenarioId(e.target.value)}
        aria-label="Scenario id"
      />
      <textarea
        value={userMove}
        onChange={(e) => setUserMove(e.target.value)}
        rows={5}
        className="identity-edit-textarea"
        placeholder="Your proposed move…"
        aria-label="Your move"
      />
      <Button
        variant="primary"
        onClick={() => void run()}
        disabled={running || !scenarioId.trim() || !userMove.trim()}
      >
        {running ? 'Critiquing…' : 'Critique'}
      </Button>
      {result && <div className="negotiation-tool-result">{result}</div>}
    </article>
  );
}

function ArgumentResult({ argument }: { argument: NegotiationArgument }) {
  return (
    <div className="negotiation-tool-result">
      <p><strong>Position:</strong> {argument.position}</p>
      {argument.supporting_points.length > 0 && (
        <>
          <p><strong>Supporting points</strong></p>
          <ul className="persona-trait-evidence-list">
            {argument.supporting_points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      )}
      {argument.evidence.length > 0 && (
        <>
          <p><strong>Evidence</strong></p>
          <ul className="persona-trait-evidence-list">
            {argument.evidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {argument.weaknesses.length > 0 && (
        <>
          <p><strong>Weaknesses</strong></p>
          <ul className="persona-trait-evidence-list">
            {argument.weaknesses.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </>
      )}
      <p className="persona-trait-meta">confidence {argument.confidence.toFixed(2)}</p>
    </div>
  );
}
