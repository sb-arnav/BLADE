// src/components/PredictionView.tsx
// BLADE's anticipatory intelligence dashboard — active predictions, detected patterns, controls.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

type TimeWindow = "NOW" | "NEXT_HOUR" | "TODAY" | "THIS_WEEK";

interface Prediction {
  id: string;
  title: string;
  description: string;
  confidence: number;
  time_window: TimeWindow;
  action?: string;
  created_at: string;
  helpful?: boolean;
}

type PatternType = "time_routine" | "sequence" | "frequency" | "context_trigger";

interface BehaviorPattern {
  id: string;
  pattern_type: PatternType;
  trigger?: string;
  expected_action: string;
  confidence: number;
  occurrences: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function confidenceBar(confidence: number): string {
  if (confidence > 0.75) return "bg-green-500";
  if (confidence > 0.5) return "bg-amber-500";
  return "bg-red-500";
}

function timeWindowBadge(tw: TimeWindow): { label: string; cls: string; blink?: boolean } {
  switch (tw) {
    case "NOW":
      return { label: "NOW", cls: "bg-red-900 text-red-300 border border-red-700", blink: true };
    case "NEXT_HOUR":
      return { label: "NEXT HOUR", cls: "bg-amber-900 text-amber-300 border border-amber-700" };
    case "TODAY":
      return { label: "TODAY", cls: "bg-blue-900 text-blue-300 border border-blue-700" };
    case "THIS_WEEK":
      return { label: "THIS WEEK", cls: "bg-gray-800 text-gray-400 border border-gray-600" };
  }
}

function patternTypeBadge(pt: PatternType): { label: string; cls: string } {
  switch (pt) {
    case "time_routine":
      return { label: "TIME ROUTINE", cls: "bg-purple-900 text-purple-300 border border-purple-700" };
    case "sequence":
      return { label: "SEQUENCE", cls: "bg-blue-900 text-blue-300 border border-blue-700" };
    case "frequency":
      return { label: "FREQUENCY", cls: "bg-green-900 text-green-300 border border-green-700" };
    case "context_trigger":
      return { label: "CONTEXT TRIGGER", cls: "bg-amber-900 text-amber-300 border border-amber-700" };
  }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PredictionCard({
  prediction,
  onAccept,
  onDismiss,
}: {
  prediction: Prediction;
  onAccept: (id: string) => void;
  onDismiss: (id: string, helpful: boolean) => void;
}) {
  const [helpful, setHelpful] = useState(true);
  const tw = timeWindowBadge(prediction.time_window);
  const barColor = confidenceBar(prediction.confidence);

  return (
    <div className="border border-gray-700 bg-gray-900/60 rounded p-3 flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-2xs font-mono px-1.5 py-0.5 rounded ${tw.cls} ${tw.blink ? "animate-pulse" : ""}`}
            >
              {tw.label}
            </span>
            <span className="text-xs font-semibold text-green-400 truncate">{prediction.title}</span>
          </div>
          <p className="text-2xs text-gray-400 mt-1 leading-relaxed">{prediction.description}</p>
        </div>
      </div>

      {/* Confidence bar */}
      <div className="flex items-center gap-2">
        <span className="text-2xs text-gray-500 w-16 shrink-0">confidence</span>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.round(prediction.confidence * 100)}%` }}
          />
        </div>
        <span className="text-2xs text-gray-500 w-8 text-right">
          {Math.round(prediction.confidence * 100)}%
        </span>
      </div>

      {/* Action chip */}
      {prediction.action && (
        <div className="flex items-center gap-1.5">
          <span className="text-2xs text-gray-500">action:</span>
          <button
            className="text-2xs font-mono px-2 py-0.5 rounded bg-green-900/40 text-green-400 border border-green-800 hover:bg-green-800/50 transition-colors"
            onClick={() => {}}
          >
            {prediction.action}
          </button>
        </div>
      )}

      {/* Buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onAccept(prediction.id)}
          className="flex items-center gap-1 text-2xs px-2 py-1 rounded bg-green-900/30 text-green-400 border border-green-800 hover:bg-green-900/60 transition-colors"
        >
          <span>✓</span>
          <span>Accept</span>
        </button>
        <div className="flex items-center gap-1.5 ml-auto">
          <button
            onClick={() => setHelpful((h) => !h)}
            className={`text-2xs px-1.5 py-0.5 rounded border transition-colors ${
              helpful
                ? "bg-gray-800 text-gray-300 border-gray-600"
                : "bg-gray-900 text-gray-500 border-gray-700"
            }`}
            title="Toggle helpful flag before dismissing"
          >
            {helpful ? "helpful" : "not helpful"}
          </button>
          <button
            onClick={() => onDismiss(prediction.id, helpful)}
            className="flex items-center gap-1 text-2xs px-2 py-1 rounded bg-gray-900 text-gray-400 border border-gray-700 hover:bg-gray-800 hover:text-gray-300 transition-colors"
          >
            <span>✗</span>
            <span>Dismiss</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function PatternCard({ pattern }: { pattern: BehaviorPattern }) {
  const badge = patternTypeBadge(pattern.pattern_type);
  const barColor = confidenceBar(pattern.confidence);

  return (
    <div className="border border-gray-700 bg-gray-900/50 rounded p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.label}</span>
        {pattern.trigger && (
          <span className="text-2xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-600 font-mono">
            trigger: {pattern.trigger}
          </span>
        )}
        <span className="ml-auto text-2xs text-gray-500">{pattern.occurrences}× seen</span>
      </div>

      <p className="text-xs text-gray-300">{pattern.expected_action}</p>

      <div className="flex items-center gap-2">
        <span className="text-2xs text-gray-500 w-16 shrink-0">confidence</span>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor}`}
            style={{ width: `${Math.round(pattern.confidence * 100)}%` }}
          />
        </div>
        <span className="text-2xs text-gray-500 w-8 text-right">
          {Math.round(pattern.confidence * 100)}%
        </span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function PredictionView({ onBack }: { onBack: () => void }) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [patterns, setPatterns] = useState<BehaviorPattern[]>([]);
  const [generating, setGenerating] = useState(false);
  const [contextInput, setContextInput] = useState("");
  const [contextPredictions, setContextPredictions] = useState<Prediction[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load pending predictions on mount
  useEffect(() => {
    invoke<Prediction[]>("prediction_get_pending")
      .then((data) => setPredictions(data ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  // Load detected patterns on mount
  useEffect(() => {
    invoke<BehaviorPattern[]>("prediction_get_patterns")
      .then((data) => setPatterns(data ?? []))
      .catch((e) => setError(String(e)));
  }, []);

  // Listen for live prediction events
  useEffect(() => {
    const unlisten = listen<Prediction>("blade_prediction", (event) => {
      setPredictions((prev) => {
        const exists = prev.find((p) => p.id === event.payload.id);
        if (exists) return prev;
        return [event.payload, ...prev];
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleAccept = useCallback((id: string) => {
    invoke("prediction_accept", { id })
      .then(() => setPredictions((prev) => prev.filter((p) => p.id !== id)))
      .catch((e) => setError(String(e)));
  }, []);

  const handleDismiss = useCallback((id: string, helpful: boolean) => {
    invoke("prediction_dismiss", { id, helpful })
      .then(() => setPredictions((prev) => prev.filter((p) => p.id !== id)))
      .catch((e) => setError(String(e)));
  }, []);

  const handleGenerateNow = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const newPreds = await invoke<Prediction[]>("prediction_generate_now");
      if (newPreds && newPreds.length > 0) {
        setPredictions((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          return [...newPreds.filter((p) => !ids.has(p.id)), ...prev];
        });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setGenerating(false);
    }
  }, []);

  const handleContextualPredict = useCallback(async () => {
    if (!contextInput.trim()) return;
    setContextLoading(true);
    setError(null);
    try {
      const result = await invoke<Prediction[]>("prediction_contextual", {
        currentContext: contextInput.trim(),
      });
      setContextPredictions(result ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setContextLoading(false);
    }
  }, [contextInput]);

  // Group patterns by type
  const patternGroups = patterns.reduce<Record<PatternType, BehaviorPattern[]>>(
    (acc, p) => {
      if (!acc[p.pattern_type]) acc[p.pattern_type] = [];
      acc[p.pattern_type].push(p);
      return acc;
    },
    {} as Record<PatternType, BehaviorPattern[]>
  );

  const patternTypeOrder: PatternType[] = ["time_routine", "sequence", "frequency", "context_trigger"];

  return (
    <div className="flex flex-col h-full bg-black text-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-2xs text-gray-500 hover:text-green-400 transition-colors font-mono"
          >
            ← back
          </button>
          <div className="w-px h-3 bg-gray-700" />
          <h1 className="text-sm font-mono text-green-400 tracking-widest uppercase">
            Predictions
          </h1>
          <span className="text-2xs text-gray-600 font-mono">anticipatory intelligence</span>
        </div>
        <div className="flex items-center gap-2">
          {predictions.length > 0 && (
            <span className="text-2xs font-mono px-2 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-800">
              {predictions.length} pending
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-950 border-b border-red-800 text-2xs text-red-400 font-mono shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-col gap-6">

          {/* ── Section 1: Active Predictions ────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Active Predictions
              </span>
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            {predictions.length === 0 ? (
              <div className="border border-gray-800 rounded p-6 text-center">
                <p className="text-xs text-gray-600 font-mono">No pending predictions</p>
                <p className="text-2xs text-gray-700 mt-1">
                  Run "Generate Predictions Now" or use me more to build patterns.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {predictions.map((p) => (
                  <PredictionCard
                    key={p.id}
                    prediction={p}
                    onAccept={handleAccept}
                    onDismiss={handleDismiss}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── Section 2: Detected Patterns ─────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Detected Patterns
              </span>
              <div className="flex-1 h-px bg-gray-800" />
              <span className="text-2xs text-gray-600">{patterns.length} patterns</span>
            </div>

            {patterns.length === 0 ? (
              <div className="border border-gray-800 rounded p-6 text-center">
                <p className="text-xs text-gray-600 font-mono">No patterns detected yet</p>
                <p className="text-2xs text-gray-700 mt-1">
                  Patterns emerge as BLADE observes your behavior over time.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {patternTypeOrder
                  .filter((type) => patternGroups[type]?.length > 0)
                  .map((type) => {
                    const badge = patternTypeBadge(type);
                    return (
                      <div key={type}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`text-2xs font-mono px-1.5 py-0.5 rounded ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <span className="text-2xs text-gray-600">
                            {patternGroups[type].length}
                          </span>
                        </div>
                        <div className="flex flex-col gap-2 pl-2 border-l border-gray-800">
                          {patternGroups[type].map((pattern) => (
                            <PatternCard key={pattern.id} pattern={pattern} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>

          {/* ── Section 3: Controls ───────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Controls
              </span>
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            <div className="flex flex-col gap-4">
              {/* Generate now */}
              <div className="border border-gray-700 bg-gray-900/40 rounded p-3 flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-200">Generate Predictions Now</p>
                  <p className="text-2xs text-gray-500 mt-0.5">
                    Force BLADE to run the prediction engine using current context.
                  </p>
                </div>
                <button
                  onClick={handleGenerateNow}
                  disabled={generating}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-green-700 bg-green-900/30 text-green-400 hover:bg-green-900/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {generating ? (
                    <>
                      <span className="w-3 h-3 border border-green-500 border-t-transparent rounded-full animate-spin" />
                      <span>Running…</span>
                    </>
                  ) : (
                    <span>▶ Run</span>
                  )}
                </button>
              </div>

              {/* Contextual prediction */}
              <div className="border border-gray-700 bg-gray-900/40 rounded p-3 flex flex-col gap-3">
                <div>
                  <p className="text-xs text-gray-200">Contextual Prediction</p>
                  <p className="text-2xs text-gray-500 mt-0.5">
                    Describe your current situation and get instant predictions.
                  </p>
                </div>
                <textarea
                  value={contextInput}
                  onChange={(e) => setContextInput(e.target.value)}
                  placeholder="e.g. I just finished a standup meeting and opened Slack…"
                  rows={3}
                  className="w-full bg-black border border-gray-700 rounded p-2 text-xs text-gray-300 font-mono placeholder-gray-700 focus:outline-none focus:border-green-700 resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleContextualPredict}
                    disabled={contextLoading || !contextInput.trim()}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-green-700 bg-green-900/30 text-green-400 hover:bg-green-900/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {contextLoading ? (
                      <>
                        <span className="w-3 h-3 border border-green-500 border-t-transparent rounded-full animate-spin" />
                        <span>Predicting…</span>
                      </>
                    ) : (
                      <span>Predict</span>
                    )}
                  </button>
                </div>

                {/* Contextual prediction results */}
                {contextPredictions.length > 0 && (
                  <div className="flex flex-col gap-2 mt-1">
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-gray-500 font-mono uppercase tracking-widest">
                        Instant predictions
                      </span>
                      <div className="flex-1 h-px bg-gray-800" />
                    </div>
                    {contextPredictions.map((p) => (
                      <PredictionCard
                        key={p.id}
                        prediction={p}
                        onAccept={handleAccept}
                        onDismiss={handleDismiss}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
