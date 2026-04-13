import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface ReasoningStep {
  step_number: number;
  step_type: string;
  thought: string;
  critiques: string[];
  revised?: string;
  confidence: number;
}

interface ReasoningResult {
  question: string;
  steps: ReasoningStep[];
  final_answer: string;
  overall_confidence: number;
  reasoning_quality: number;
}

interface HypothesisResult {
  hypothesis: string;
  evidence_for: string[];
  evidence_against: string[];
  verdict: string;
  confidence: number;
}

interface SocraticPair {
  question: string;
  answer: string;
  depth: number;
  children?: SocraticPair[];
}

interface TraceRecord {
  id: string;
  question: string;
  created_at: string;
  overall_confidence: number;
  reasoning_quality: number;
}

const STEP_TYPE_STYLES: Record<string, string> = {
  decompose: "bg-blue-900/40 text-blue-300 border border-blue-700",
  analyze: "bg-green-900/40 text-green-300 border border-green-700",
  hypothesize: "bg-amber-900/40 text-amber-300 border border-amber-700",
  verify: "bg-purple-900/40 text-purple-300 border border-purple-700",
  conclude: "bg-gray-700/60 text-white border border-gray-500",
};

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

function StepCard({ step }: { step: ReasoningStep }) {
  const typeStyle = STEP_TYPE_STYLES[step.step_type] || "bg-gray-800 text-gray-300 border border-gray-600";
  return (
    <div className="border border-gray-700 rounded bg-gray-900/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-800 border border-gray-600 text-xs font-bold text-green-400">
          {step.step_number}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded font-mono uppercase tracking-wider ${typeStyle}`}>
          {step.step_type}
        </span>
      </div>
      <p className="text-sm text-gray-200 leading-relaxed">{step.thought}</p>
      {step.critiques && step.critiques.length > 0 && (
        <div className="border-l-2 border-red-700 pl-2 space-y-1">
          {step.critiques.map((c, i) => (
            <p key={i} className="text-xs text-red-400 italic">{c}</p>
          ))}
        </div>
      )}
      {step.revised && (
        <div className="border-l-2 border-yellow-600 pl-2">
          <p className="text-xs text-yellow-200 font-semibold mb-0.5">Revised:</p>
          <p className="text-xs text-yellow-100">{step.revised}</p>
        </div>
      )}
      <ConfidenceBar value={step.confidence} />
    </div>
  );
}

function SocraticNode({ pair, indent = 0 }: { pair: SocraticPair; indent?: number }) {
  return (
    <div style={{ marginLeft: indent * 16 }} className="space-y-1">
      <div className="flex items-start gap-2">
        <span className="text-green-400 mt-0.5 text-xs">Q:</span>
        <p className="text-sm text-gray-200">{pair.question}</p>
      </div>
      <div className="flex items-start gap-2">
        <span className="text-blue-400 mt-0.5 text-xs">A:</span>
        <p className="text-sm text-gray-400">{pair.answer}</p>
      </div>
      {pair.children && pair.children.map((child, i) => (
        <SocraticNode key={i} pair={child} indent={indent + 1} />
      ))}
    </div>
  );
}

export function ReasoningView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"think" | "hypothesis" | "socratic">("think");
  const [question, setQuestion] = useState("");
  const [context, setContext] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [maxSteps, setMaxSteps] = useState(5);
  const [loading, setLoading] = useState(false);
  const [liveSteps, setLiveSteps] = useState<ReasoningStep[]>([]);
  const [result, setResult] = useState<ReasoningResult | null>(null);

  // Hypothesis tab
  const [hypothesis, setHypothesis] = useState("");
  const [evidence, setEvidence] = useState("");
  const [hypoLoading, setHypoLoading] = useState(false);
  const [hypoResult, setHypoResult] = useState<HypothesisResult | null>(null);

  // Socratic tab
  const [socraticTopic, setSocraticTopic] = useState("");
  const [socraticDepth, setSocraticDepth] = useState(3);
  const [socraticLoading, setSocraticLoading] = useState(false);
  const [socraticResult, setSocraticResult] = useState<SocraticPair[]>([]);

  // History sidebar
  const [traces, setTraces] = useState<TraceRecord[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const stepsEndRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    loadTraces();
    return () => {
      if (unlistenRef.current) unlistenRef.current();
    };
  }, []);

  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [liveSteps]);

  async function loadTraces() {
    try {
      const data = await invoke<TraceRecord[]>("reasoning_get_traces");
      setTraces(data);
    } catch {
      // ignore
    }
  }

  async function handleThink() {
    if (!question.trim()) return;
    setLoading(true);
    setLiveSteps([]);
    setResult(null);

    if (unlistenRef.current) unlistenRef.current();

    const unlisten = await listen<ReasoningStep>("blade_reasoning_step", (event) => {
      setLiveSteps((prev) => [...prev, event.payload]);
    });
    unlistenRef.current = unlisten;

    try {
      const res = await invoke<ReasoningResult>("reasoning_think", {
        question,
        context,
        maxSteps,
      });
      setResult(res);
      loadTraces();
    } catch (err) {
      console.error("[ReasoningView] reasoning_think error:", err);
    } finally {
      setLoading(false);
      unlisten();
      unlistenRef.current = null;
    }
  }

  async function handleTestHypothesis() {
    if (!hypothesis.trim()) return;
    setHypoLoading(true);
    setHypoResult(null);
    try {
      const res = await invoke<HypothesisResult>("reasoning_test_hypothesis", {
        hypothesis,
        evidence,
      });
      setHypoResult(res);
    } catch (err) {
      console.error("[ReasoningView] reasoning_test_hypothesis error:", err);
    } finally {
      setHypoLoading(false);
    }
  }

  async function handleSocratic() {
    if (!socraticTopic.trim()) return;
    setSocraticLoading(true);
    setSocraticResult([]);
    try {
      const res = await invoke<SocraticPair[]>("reasoning_socratic", {
        question: socraticTopic,
        depth: socraticDepth,
      });
      setSocraticResult(res);
    } catch (err) {
      console.error("[ReasoningView] reasoning_socratic error:", err);
    } finally {
      setSocraticLoading(false);
    }
  }

  function replayTrace(trace: TraceRecord) {
    setQuestion(trace.question);
    setSidebarOpen(false);
    setTab("think");
  }

  const verdictColor: Record<string, string> = {
    supported: "bg-green-800 text-green-200 border-green-600",
    refuted: "bg-red-800 text-red-200 border-red-600",
    inconclusive: "bg-gray-700 text-gray-200 border-gray-500",
  };

  return (
    <div className="flex flex-col h-full bg-black text-gray-200 font-mono">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-700 bg-black">
        <button onClick={onBack} className="text-gray-500 hover:text-green-400 transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-green-400 text-sm font-bold tracking-widest uppercase">Reasoning Engine</span>
        <div className="flex-1" />
        <button
          onClick={() => setSidebarOpen((o) => !o)}
          className="text-xs text-gray-500 hover:text-green-400 border border-gray-700 px-2 py-1 rounded transition-colors"
        >
          History ({traces.length})
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main area */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-gray-700 bg-black px-4">
            {(["think", "hypothesis", "socratic"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-xs uppercase tracking-wider border-b-2 transition-colors ${tab === t ? "border-green-400 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300"}`}
              >
                {t === "think" ? "Think" : t === "hypothesis" ? "Test Hypothesis" : "Socratic Drill"}
              </button>
            ))}
          </div>

          {/* Think tab */}
          {tab === "think" && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Input section */}
              <div className="border-b border-gray-700 bg-gray-900/30 p-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-700"
                    placeholder="What should BLADE reason through?"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleThink()}
                  />
                  <div className="flex items-center gap-1">
                    {([3, 5, 8] as const).map((n) => (
                      <button
                        key={n}
                        onClick={() => setMaxSteps(n)}
                        className={`w-8 h-8 text-xs rounded border transition-colors ${maxSteps === n ? "border-green-600 bg-green-900/40 text-green-300" : "border-gray-700 text-gray-500 hover:border-gray-500"}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleThink}
                    disabled={loading || !question.trim()}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {loading ? "Thinking..." : "Think Through This"}
                  </button>
                </div>

                {/* Context collapsible */}
                <div>
                  <button
                    onClick={() => setContextOpen((o) => !o)}
                    className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1 transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className={`transition-transform ${contextOpen ? "rotate-90" : ""}`}>
                      <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Additional context
                  </button>
                  {contextOpen && (
                    <textarea
                      className="w-full mt-2 bg-black border border-gray-700 rounded px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none"
                      rows={3}
                      placeholder="Paste any relevant background knowledge, constraints, or data..."
                      value={context}
                      onChange={(e) => setContext(e.target.value)}
                    />
                  )}
                </div>
              </div>

              {/* Steps + answer */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {liveSteps.length === 0 && !result && !loading && (
                  <div className="text-center py-16 text-gray-600 text-sm">
                    Ask a question and BLADE will walk through its reasoning step by step.
                  </div>
                )}
                {loading && liveSteps.length === 0 && (
                  <div className="flex items-center gap-2 text-green-400 text-xs animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                    Initializing reasoning chain...
                  </div>
                )}
                {liveSteps.map((step) => (
                  <StepCard key={step.step_number} step={step} />
                ))}
                <div ref={stepsEndRef} />

                {/* Final answer */}
                {result && (
                  <div className="border border-green-800 rounded bg-green-900/10 p-4 space-y-3 mt-4">
                    <div className="flex items-center gap-2 border-b border-green-800 pb-2">
                      <span className="text-green-400 text-xs font-bold uppercase tracking-widest">Final Answer</span>
                      <div className="flex-1" />
                      <span className="text-xs text-gray-400">
                        Quality: <span className="text-green-300 font-bold">{result.reasoning_quality}/10</span>
                      </span>
                    </div>
                    <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">{result.final_answer}</p>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Overall Confidence</p>
                      <ConfidenceBar value={result.overall_confidence} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Hypothesis tab */}
          {tab === "hypothesis" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider">Hypothesis</label>
                  <input
                    className="w-full mt-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-700"
                    placeholder="State a hypothesis to test..."
                    value={hypothesis}
                    onChange={(e) => setHypothesis(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-wider">Evidence</label>
                  <textarea
                    className="w-full mt-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none"
                    rows={5}
                    placeholder="Provide evidence or data to evaluate the hypothesis..."
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                  />
                </div>
                <button
                  onClick={handleTestHypothesis}
                  disabled={hypoLoading || !hypothesis.trim()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-purple-900/40 border border-purple-700 text-purple-300 rounded hover:bg-purple-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {hypoLoading ? "Evaluating..." : "Test Hypothesis"}
                </button>
              </div>

              {hypoResult && (
                <div className="border border-gray-700 rounded bg-gray-900/40 p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-3 py-1 rounded border font-bold uppercase tracking-wider ${verdictColor[hypoResult.verdict] || "bg-gray-700 text-gray-200 border-gray-500"}`}>
                      {hypoResult.verdict}
                    </span>
                    <span className="text-xs text-gray-400">Confidence: {hypoResult.confidence}%</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-green-400 font-bold uppercase tracking-wider mb-2">Evidence For</p>
                      <ul className="space-y-1">
                        {hypoResult.evidence_for.map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                            <span className="text-green-500 mt-0.5">•</span>
                            {e}
                          </li>
                        ))}
                        {hypoResult.evidence_for.length === 0 && <li className="text-xs text-gray-600 italic">None found</li>}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs text-red-400 font-bold uppercase tracking-wider mb-2">Evidence Against</p>
                      <ul className="space-y-1">
                        {hypoResult.evidence_against.map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-gray-300">
                            <span className="text-red-500 mt-0.5">•</span>
                            {e}
                          </li>
                        ))}
                        {hypoResult.evidence_against.length === 0 && <li className="text-xs text-gray-600 italic">None found</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Socratic tab */}
          {tab === "socratic" && (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex gap-2 items-start">
                <input
                  className="flex-1 bg-black border border-gray-700 rounded px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-green-700"
                  placeholder="Topic or concept to drill into..."
                  value={socraticTopic}
                  onChange={(e) => setSocraticTopic(e.target.value)}
                />
                <div className="flex items-center gap-1">
                  {[2, 3, 4, 5].map((d) => (
                    <button
                      key={d}
                      onClick={() => setSocraticDepth(d)}
                      className={`w-7 h-8 text-xs rounded border transition-colors ${socraticDepth === d ? "border-amber-600 bg-amber-900/40 text-amber-300" : "border-gray-700 text-gray-500 hover:border-gray-500"}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleSocratic}
                  disabled={socraticLoading || !socraticTopic.trim()}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-amber-900/40 border border-amber-700 text-amber-300 rounded hover:bg-amber-800/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {socraticLoading ? "Drilling..." : "Drill"}
                </button>
              </div>

              {socraticLoading && (
                <div className="text-xs text-amber-400 animate-pulse flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  Building Socratic chain...
                </div>
              )}

              {socraticResult.length > 0 && (
                <div className="border border-gray-700 rounded bg-gray-900/30 p-4 space-y-3">
                  {socraticResult.map((pair, i) => (
                    <SocraticNode key={i} pair={pair} indent={0} />
                  ))}
                </div>
              )}

              {!socraticLoading && socraticResult.length === 0 && (
                <div className="text-center py-16 text-gray-600 text-sm">
                  Enter a topic to explore through Socratic questioning.
                </div>
              )}
            </div>
          )}
        </div>

        {/* History sidebar */}
        {sidebarOpen && (
          <div className="w-64 border-l border-gray-700 bg-gray-900/50 flex flex-col overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-400 uppercase tracking-wider">Recent Traces</span>
              <button onClick={() => setSidebarOpen(false)} className="text-gray-600 hover:text-gray-400 text-xs">
                x
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {traces.length === 0 && (
                <p className="text-xs text-gray-600 text-center p-4">No traces yet</p>
              )}
              {traces.map((t) => (
                <button
                  key={t.id}
                  onClick={() => replayTrace(t)}
                  className="w-full text-left px-3 py-2.5 border-b border-gray-800 hover:bg-gray-800/50 transition-colors"
                >
                  <p className="text-xs text-gray-200 truncate">{t.question}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-600">{new Date(t.created_at).toLocaleDateString()}</span>
                    <span className="text-xs text-green-600">{t.reasoning_quality}/10</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
