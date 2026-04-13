import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DebateRound {
  round: number;
  user_argument: string;
  opponent_argument: string;
  coaching: string;
}

interface DebateSession {
  session_id: string;
  topic: string;
  user_position: string;
  rounds: DebateRound[];
  verdict?: string;
}

interface NegotiationAnalysis {
  scenario_id: string;
  tactics: string[];
  scripts: string[];
  batna: string;
  their_interests: string[];
}

interface RoleplayResponse {
  opponent_message: string;
  subtext: string;
}

interface CritiqueResponse {
  strengths: string[];
  weaknesses: string[];
  better_move: string;
  score: number;
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function VerdictModal({ verdict, onClose }: { verdict: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-gray-700 rounded max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-green-400 font-mono text-sm uppercase tracking-widest">// Debate Verdict</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap font-mono">{verdict}</div>
        <button
          onClick={onClose}
          className="mt-6 w-full bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 transition-colors"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

function BudgetModal({ content, onClose }: { content: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-gray-700 rounded max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-green-400 font-mono text-sm uppercase tracking-widest">// Budget Recommendation</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap font-mono">{content}</div>
        <button
          onClick={onClose}
          className="mt-6 w-full bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 transition-colors"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ── Debate Panel ──────────────────────────────────────────────────────────────

function DebatePanel() {
  const [topic, setTopic] = useState("");
  const [userPosition, setUserPosition] = useState("");
  const [session, setSession] = useState<DebateSession | null>(null);
  const [nextArg, setNextArg] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string | null>(null);
  const [showVerdict, setShowVerdict] = useState(false);

  // Extra tools
  const [steelmanTopic, setSteelmanTopic] = useState("");
  const [steelmanPos, setSteelmanPos] = useState("");
  const [steelmanResult, setSteelmanResult] = useState<string | null>(null);
  const [buildTopic, setBuildTopic] = useState("");
  const [buildPos, setBuildPos] = useState("");
  const [buildContext, setBuildContext] = useState("");
  const [buildResult, setBuildResult] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  async function startDebate() {
    if (!topic.trim() || !userPosition.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DebateSession>("negotiation_start_debate", {
        topic: topic.trim(),
        userPosition: userPosition.trim(),
      });
      setSession(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function nextRound() {
    if (!session || !nextArg.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DebateSession>("negotiation_round", {
        sessionId: session.session_id,
        userMessage: nextArg.trim(),
      });
      setSession(result);
      setNextArg("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function conclude() {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<{ verdict: string }>("negotiation_conclude", {
        sessionId: session.session_id,
      });
      setVerdict(result.verdict);
      setShowVerdict(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function steelman() {
    if (!steelmanTopic.trim() || !steelmanPos.trim()) return;
    setLoading(true);
    try {
      const result = await invoke<{ steelman: string }>("negotiation_steelman", {
        topic: steelmanTopic.trim(),
        opponentPosition: steelmanPos.trim(),
      });
      setSteelmanResult(result.steelman);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function buildArgument() {
    if (!buildTopic.trim() || !buildPos.trim()) return;
    setLoading(true);
    try {
      const result = await invoke<{ argument: string }>("negotiation_build_argument", {
        topic: buildTopic.trim(),
        position: buildPos.trim(),
        context: buildContext.trim(),
      });
      setBuildResult(result.argument);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {showVerdict && verdict && (
        <VerdictModal verdict={verdict} onClose={() => setShowVerdict(false)} />
      )}

      {/* Setup */}
      {!session && (
        <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
          <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-1">// New Debate</div>
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">TOPIC</label>
            <input
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
              placeholder="e.g. Universal Basic Income should be implemented"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">YOUR POSITION</label>
            <textarea
              rows={2}
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700 resize-none"
              placeholder="State your stance and key reasoning..."
              value={userPosition}
              onChange={(e) => setUserPosition(e.target.value)}
            />
          </div>
          <button
            onClick={startDebate}
            disabled={loading || !topic.trim() || !userPosition.trim()}
            className="bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 px-4 hover:bg-green-900/70 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "INITIALIZING..." : "⚔ START DEBATE"}
          </button>
          {error && <div className="text-red-400 font-mono text-xs">{error}</div>}
        </div>
      )}

      {/* Arena */}
      {session && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="text-green-400 font-mono text-xs uppercase tracking-widest">
              ⚔ {session.topic}
            </div>
            <div className="flex gap-2">
              <button
                onClick={conclude}
                disabled={loading}
                className="bg-amber-900/30 border border-amber-700 text-amber-400 font-mono text-xs px-3 py-1 hover:bg-amber-900/50 disabled:opacity-40 transition-colors"
              >
                CONCLUDE
              </button>
              <button
                onClick={() => { setSession(null); setVerdict(null); }}
                className="border border-gray-700 text-gray-500 font-mono text-xs px-3 py-1 hover:text-gray-300 transition-colors"
              >
                RESET
              </button>
            </div>
          </div>

          {/* Round cards */}
          {session.rounds.map((round) => (
            <div key={round.round} className="bg-gray-950 border border-gray-800 rounded overflow-hidden">
              <div className="px-3 py-1 bg-gray-900 border-b border-gray-800 font-mono text-xs text-gray-500">
                ROUND {round.round}
              </div>
              <div className="grid grid-cols-2 gap-0">
                <div className="p-3 border-r border-gray-800">
                  <div className="text-green-500 font-mono text-xs mb-1">YOUR SIDE</div>
                  <div className="text-gray-300 text-sm leading-relaxed">{round.user_argument}</div>
                </div>
                <div className="p-3">
                  <div className="text-red-400 font-mono text-xs mb-1">OPPONENT</div>
                  <div className="text-gray-300 text-sm leading-relaxed">{round.opponent_argument}</div>
                </div>
              </div>
              {round.coaching && (
                <div className="px-3 py-2 border-t border-gray-800 bg-amber-950/20">
                  <span className="text-amber-500/70 font-mono text-xs italic">[BLADE] {round.coaching}</span>
                </div>
              )}
            </div>
          ))}

          {/* Next Round Input */}
          <div className="bg-gray-950 border border-gray-800 rounded p-3 flex flex-col gap-2">
            <label className="text-gray-500 font-mono text-xs">YOUR NEXT ARGUMENT</label>
            <textarea
              rows={3}
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700 resize-none"
              placeholder="Make your case for the next round..."
              value={nextArg}
              onChange={(e) => setNextArg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) nextRound();
              }}
            />
            <button
              onClick={nextRound}
              disabled={loading || !nextArg.trim()}
              className="bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "PROCESSING..." : "NEXT ROUND →"}
            </button>
          </div>
          {error && <div className="text-red-400 font-mono text-xs">{error}</div>}
        </div>
      )}

      {/* Argument Tools */}
      <div className="bg-gray-950 border border-gray-800 rounded">
        <button
          className="w-full flex items-center justify-between px-4 py-2 font-mono text-xs text-gray-500 hover:text-gray-300"
          onClick={() => setToolsOpen((v) => !v)}
        >
          <span>// ARGUMENT TOOLS</span>
          <span>{toolsOpen ? "▲" : "▼"}</span>
        </button>
        {toolsOpen && (
          <div className="p-4 flex flex-col gap-4 border-t border-gray-800">
            {/* Steelman */}
            <div className="flex flex-col gap-2">
              <div className="text-gray-400 font-mono text-xs">STEELMAN OPPONENT</div>
              <input
                className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-3 py-1.5 rounded focus:outline-none focus:border-green-700"
                placeholder="Topic"
                value={steelmanTopic}
                onChange={(e) => setSteelmanTopic(e.target.value)}
              />
              <input
                className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-3 py-1.5 rounded focus:outline-none focus:border-green-700"
                placeholder="Their position"
                value={steelmanPos}
                onChange={(e) => setSteelmanPos(e.target.value)}
              />
              <button
                onClick={steelman}
                disabled={loading}
                className="bg-gray-900 border border-gray-700 text-gray-400 font-mono text-xs py-1.5 hover:border-green-700 hover:text-green-400 disabled:opacity-40 transition-colors"
              >
                STEELMAN →
              </button>
              {steelmanResult && (
                <div className="bg-black border border-gray-800 p-3 text-gray-300 text-xs font-mono leading-relaxed">
                  {steelmanResult}
                </div>
              )}
            </div>

            {/* Build Argument */}
            <div className="flex flex-col gap-2">
              <div className="text-gray-400 font-mono text-xs">BUILD ARGUMENT</div>
              <input
                className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-3 py-1.5 rounded focus:outline-none focus:border-green-700"
                placeholder="Topic"
                value={buildTopic}
                onChange={(e) => setBuildTopic(e.target.value)}
              />
              <input
                className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-3 py-1.5 rounded focus:outline-none focus:border-green-700"
                placeholder="Position"
                value={buildPos}
                onChange={(e) => setBuildPos(e.target.value)}
              />
              <input
                className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-3 py-1.5 rounded focus:outline-none focus:border-green-700"
                placeholder="Context (optional)"
                value={buildContext}
                onChange={(e) => setBuildContext(e.target.value)}
              />
              <button
                onClick={buildArgument}
                disabled={loading}
                className="bg-gray-900 border border-gray-700 text-gray-400 font-mono text-xs py-1.5 hover:border-green-700 hover:text-green-400 disabled:opacity-40 transition-colors"
              >
                BUILD →
              </button>
              {buildResult && (
                <div className="bg-black border border-gray-800 p-3 text-gray-300 text-xs font-mono leading-relaxed">
                  {buildResult}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Negotiation Prep Panel ────────────────────────────────────────────────────

function NegotiationPanel() {
  const [context, setContext] = useState("");
  const [userGoal, setUserGoal] = useState("");
  const [theirInfo, setTheirInfo] = useState("");
  const [analysis, setAnalysis] = useState<NegotiationAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Roleplay
  const [theirMessage, setTheirMessage] = useState("");
  const [roleplayResponse, setRoleplayResponse] = useState<RoleplayResponse | null>(null);

  // Critique
  const [userMove, setUserMove] = useState("");
  const [critique, setCritique] = useState<CritiqueResponse | null>(null);

  async function analyze() {
    if (!context.trim() || !userGoal.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<NegotiationAnalysis>("negotiation_analyze", {
        context: context.trim(),
        userGoal: userGoal.trim(),
        theirInfo: theirInfo.trim(),
      });
      setAnalysis(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function roleplay() {
    if (!analysis || !theirMessage.trim()) return;
    setLoading(true);
    try {
      const result = await invoke<RoleplayResponse>("negotiation_roleplay", {
        scenarioId: analysis.scenario_id,
        theirMessage: theirMessage.trim(),
      });
      setRoleplayResponse(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function critiqueMove() {
    if (!analysis || !userMove.trim()) return;
    setLoading(true);
    try {
      const result = await invoke<CritiqueResponse>("negotiation_critique_move", {
        scenarioId: analysis.scenario_id,
        userMove: userMove.trim(),
      });
      setCritique(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto">
      {/* Input */}
      <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
        <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-1">// Scenario Setup</div>
        <div className="flex flex-col gap-1">
          <label className="text-gray-500 font-mono text-xs">CONTEXT</label>
          <textarea
            rows={2}
            className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700 resize-none"
            placeholder="e.g. Salary negotiation with new employer, annual review, contract renewal..."
            value={context}
            onChange={(e) => setContext(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">YOUR GOAL</label>
            <input
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
              placeholder="What you want to achieve"
              value={userGoal}
              onChange={(e) => setUserGoal(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">THEIR LIKELY GOAL</label>
            <input
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
              placeholder="What they probably want"
              value={theirInfo}
              onChange={(e) => setTheirInfo(e.target.value)}
            />
          </div>
        </div>
        <button
          onClick={analyze}
          disabled={loading || !context.trim() || !userGoal.trim()}
          className="bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "ANALYZING..." : "🧠 ANALYZE SCENARIO"}
        </button>
        {error && <div className="text-red-400 font-mono text-xs">{error}</div>}
      </div>

      {/* Results */}
      {analysis && (
        <>
          {/* Tactics */}
          <div className="bg-gray-950 border border-gray-800 rounded p-4">
            <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-3">// Tactics</div>
            <ol className="flex flex-col gap-2">
              {analysis.tactics.map((tactic, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-green-600 font-mono text-xs mt-0.5 min-w-[20px]">{i + 1}.</span>
                  <span className="text-gray-300 text-sm">{tactic}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Scripts */}
          <div className="bg-gray-950 border border-gray-800 rounded p-4">
            <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-3">// Word-for-Word Scripts</div>
            <div className="flex flex-col gap-3">
              {analysis.scripts.map((script, i) => (
                <blockquote key={i} className="border-l-2 border-green-700 pl-3 text-gray-300 text-sm italic">
                  &ldquo;{script}&rdquo;
                </blockquote>
              ))}
            </div>
          </div>

          {/* BATNA */}
          <div className="bg-gray-950 border border-amber-900/50 rounded p-4">
            <div className="text-amber-400 font-mono text-xs uppercase tracking-widest mb-2">// BATNA</div>
            <p className="text-gray-300 text-sm">{analysis.batna}</p>
          </div>

          {/* Their Interests */}
          {analysis.their_interests && analysis.their_interests.length > 0 && (
            <div className="bg-gray-950 border border-gray-800 rounded p-4">
              <div className="text-red-400 font-mono text-xs uppercase tracking-widest mb-2">// Their Interests</div>
              <ul className="flex flex-col gap-1">
                {analysis.their_interests.map((interest, i) => (
                  <li key={i} className="text-gray-400 text-sm flex gap-2">
                    <span className="text-red-600">▸</span>
                    {interest}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Practice Roleplay */}
          <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
            <div className="text-green-400 font-mono text-xs uppercase tracking-widest">// Practice: Roleplay</div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">THEIR MESSAGE (as opponent)</label>
              <textarea
                rows={2}
                className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700 resize-none"
                placeholder="Type what they might say..."
                value={theirMessage}
                onChange={(e) => setTheirMessage(e.target.value)}
              />
            </div>
            <button
              onClick={roleplay}
              disabled={loading || !theirMessage.trim()}
              className="bg-gray-900 border border-gray-700 text-gray-400 font-mono text-xs py-2 hover:border-green-700 hover:text-green-400 disabled:opacity-40 transition-colors"
            >
              {loading ? "..." : "BLADE RESPONDS AS OPPONENT →"}
            </button>
            {roleplayResponse && (
              <div className="flex flex-col gap-2">
                <div className="bg-black border border-red-900/40 rounded p-3">
                  <div className="text-red-400 font-mono text-xs mb-1">OPPONENT SAYS:</div>
                  <div className="text-gray-300 text-sm">{roleplayResponse.opponent_message}</div>
                </div>
                {roleplayResponse.subtext && (
                  <div className="bg-black border border-amber-900/30 rounded p-2">
                    <div className="text-amber-500/70 font-mono text-xs italic">[BLADE subtext] {roleplayResponse.subtext}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Critique */}
          <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
            <div className="text-green-400 font-mono text-xs uppercase tracking-widest">// Critique My Move</div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">WHAT YOU PLAN TO SAY OR DO</label>
              <textarea
                rows={2}
                className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700 resize-none"
                placeholder='e.g. "I need at least $120k or I\'ll have to consider other offers"'
                value={userMove}
                onChange={(e) => setUserMove(e.target.value)}
              />
            </div>
            <button
              onClick={critiqueMove}
              disabled={loading || !userMove.trim()}
              className="bg-gray-900 border border-gray-700 text-gray-400 font-mono text-xs py-2 hover:border-green-700 hover:text-green-400 disabled:opacity-40 transition-colors"
            >
              {loading ? "..." : "CRITIQUE THIS MOVE →"}
            </button>
            {critique && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-500 font-mono text-xs">SCORE:</span>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div
                        key={i}
                        className={`w-3 h-3 border ${i < critique.score ? "bg-green-600 border-green-500" : "bg-gray-900 border-gray-700"}`}
                      />
                    ))}
                  </div>
                  <span className="text-green-400 font-mono text-xs">{critique.score}/10</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black border border-green-900/30 rounded p-3">
                    <div className="text-green-500 font-mono text-xs mb-1">STRENGTHS</div>
                    <ul className="flex flex-col gap-1">
                      {critique.strengths.map((s, i) => (
                        <li key={i} className="text-gray-400 text-xs">{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-black border border-red-900/30 rounded p-3">
                    <div className="text-red-400 font-mono text-xs mb-1">WEAKNESSES</div>
                    <ul className="flex flex-col gap-1">
                      {critique.weaknesses.map((w, i) => (
                        <li key={i} className="text-gray-400 text-xs">{w}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="bg-black border border-amber-900/30 rounded p-3">
                  <div className="text-amber-400 font-mono text-xs mb-1">BETTER MOVE</div>
                  <div className="text-gray-300 text-sm">{critique.better_move}</div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────

export function NegotiationView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"debate" | "negotiation">("debate");

  return (
    <div className="flex flex-col h-full bg-black text-gray-200">
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-800 shrink-0">
        <button
          onClick={onBack}
          className="text-gray-600 hover:text-gray-300 font-mono text-xs transition-colors"
        >
          ← BACK
        </button>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-green-400 font-mono text-sm uppercase tracking-widest">NEGOTIATION ENGINE</span>
        </div>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setTab("debate")}
            className={`font-mono text-xs px-4 py-1.5 border transition-colors ${
              tab === "debate"
                ? "border-green-700 text-green-400 bg-green-900/20"
                : "border-gray-700 text-gray-500 hover:text-gray-300"
            }`}
          >
            ⚔ DEBATE
          </button>
          <button
            onClick={() => setTab("negotiation")}
            className={`font-mono text-xs px-4 py-1.5 border transition-colors ${
              tab === "negotiation"
                ? "border-green-700 text-green-400 bg-green-900/20"
                : "border-gray-700 text-gray-500 hover:text-gray-300"
            }`}
          >
            🤝 NEGOTIATION PREP
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto p-4 max-w-4xl mx-auto w-full">
          {tab === "debate" ? <DebatePanel /> : <NegotiationPanel />}
        </div>
      </div>
    </div>
  );
}
