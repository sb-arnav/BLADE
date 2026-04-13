// src/components/EmotionalIntelligenceView.tsx
// BLADE's emotional awareness dashboard — current state, trends, patterns, readings.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ─────────────────────────────────────────────────────────────────────

type EmotionName =
  | "stressed"
  | "excited"
  | "focused"
  | "tired"
  | "frustrated"
  | "happy"
  | "anxious"
  | "neutral"
  | string;

interface EmotionState {
  primary_emotion: EmotionName;
  valence: number;   // -1 to +1
  arousal: number;   // 0 to 1
  confidence: number;
  signals: string[];
  detected_at?: string;
}

interface EmotionReading {
  id: string;
  timestamp: string;
  emotion: EmotionName;
  valence: number;
  arousal: number;
  confidence: number;
  signals: string[];
}

interface EmotionShift {
  from_emotion: EmotionName;
  to_emotion: EmotionName;
  at: string;
}

interface EmotionTrend {
  period: string;
  avg_valence: number;
  dominant_emotion: EmotionName;
  notable_shifts: EmotionShift[];
  reading_count: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emotionColor(emotion: EmotionName): {
  text: string;
  bg: string;
  border: string;
  dot: string;
} {
  switch (emotion) {
    case "stressed":
      return { text: "text-red-400", bg: "bg-red-950", border: "border-red-700", dot: "bg-red-500" };
    case "excited":
      return { text: "text-yellow-400", bg: "bg-yellow-950", border: "border-yellow-700", dot: "bg-yellow-400" };
    case "focused":
      return { text: "text-green-400", bg: "bg-green-950", border: "border-green-700", dot: "bg-green-500" };
    case "tired":
      return { text: "text-gray-400", bg: "bg-gray-900", border: "border-gray-700", dot: "bg-gray-500" };
    case "frustrated":
      return { text: "text-orange-400", bg: "bg-orange-950", border: "border-orange-700", dot: "bg-orange-500" };
    case "happy":
      return { text: "text-green-300", bg: "bg-green-950", border: "border-green-600", dot: "bg-green-400" };
    case "anxious":
      return { text: "text-purple-400", bg: "bg-purple-950", border: "border-purple-700", dot: "bg-purple-500" };
    case "neutral":
    default:
      return { text: "text-gray-400", bg: "bg-gray-900", border: "border-gray-700", dot: "bg-gray-500" };
  }
}

function valenceColor(valence: number): string {
  if (valence > 0.2) return "bg-green-500";
  if (valence < -0.2) return "bg-red-500";
  return "bg-gray-500";
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

// ── Valence-Arousal Grid ──────────────────────────────────────────────────────

function ValenceArousalGrid({ valence, arousal, emotion }: { valence: number; arousal: number; emotion: EmotionName }) {
  // valence: -1..+1 → x: 0..100%
  // arousal:  0..1  → y: 100%..0% (high arousal = top)
  const xPct = ((valence + 1) / 2) * 100;
  const yPct = (1 - arousal) * 100;
  const dotColor = emotionColor(emotion).dot;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-2xs text-gray-600 font-mono">
        <span>negative</span>
        <span className="text-gray-500">valence</span>
        <span>positive</span>
      </div>
      <div className="relative border border-gray-700 bg-gray-900/80 rounded" style={{ height: 120 }}>
        {/* Quadrant dividers */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 bottom-0 left-1/2 border-l border-gray-800" />
          <div className="absolute left-0 right-0 top-1/2 border-t border-gray-800" />
        </div>
        {/* Quadrant labels */}
        <span className="absolute top-1 left-1.5 text-2xs text-gray-700 font-mono leading-none">tense</span>
        <span className="absolute top-1 right-1.5 text-2xs text-gray-700 font-mono leading-none">excited</span>
        <span className="absolute bottom-1 left-1.5 text-2xs text-gray-700 font-mono leading-none">sad</span>
        <span className="absolute bottom-1 right-1.5 text-2xs text-gray-700 font-mono leading-none">calm</span>
        {/* Dot */}
        <div
          className={`absolute w-3 h-3 rounded-full ${dotColor} border-2 border-black shadow-lg transition-all duration-500`}
          style={{
            left: `calc(${xPct}% - 6px)`,
            top: `calc(${yPct}% - 6px)`,
          }}
        />
        {/* Arousal labels */}
        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-2xs text-gray-700 font-mono leading-none">
          high
        </span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-2xs text-gray-700 font-mono leading-none">
          low
        </span>
      </div>
      <div className="text-right text-2xs text-gray-600 font-mono">arousal</div>
    </div>
  );
}

// ── Emotion Timeline (horizontal valence line) ─────────────────────────────────

function EmotionTimeline({ readings }: { readings: EmotionReading[] }) {
  if (readings.length === 0) return null;
  const recent = readings.slice(0, 20).reverse();

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {recent.map((r) => {
          const col = emotionColor(r.emotion);
          return (
            <div
              key={r.id}
              className="flex flex-col items-center gap-0.5 shrink-0"
              title={`${r.emotion} — valence ${r.valence.toFixed(2)} @ ${formatTimestamp(r.timestamp)}`}
            >
              <div
                className={`w-2.5 h-2.5 rounded-full ${col.dot} border border-black`}
              />
              <div className="w-2.5 h-8 bg-gray-900 rounded-sm overflow-hidden flex flex-col-reverse">
                <div
                  className={`w-full ${valenceColor(r.valence)} rounded-sm`}
                  style={{ height: `${Math.abs(r.valence) * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-2xs text-gray-700 font-mono">
        <span>older</span>
        <span>recent →</span>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EmotionalIntelligenceView({ onBack }: { onBack: () => void }) {
  const [currentState, setCurrentState] = useState<EmotionState | null>(null);
  const [readings, setReadings] = useState<EmotionReading[]>([]);
  const [trend, setTrend] = useState<EmotionTrend | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<"today" | "this_week">("today");
  const [trendLoading, setTrendLoading] = useState(false);
  const [patternAnalysis, setPatternAnalysis] = useState<string | null>(null);
  const [patternLoading, setPatternLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load readings on mount
  useEffect(() => {
    invoke<EmotionReading[]>("emotion_get_readings")
      .then((data) => {
        setReadings(data ?? []);
        // Set initial current state from most recent reading if available
        if (data && data.length > 0) {
          const latest = data[0];
          setCurrentState({
            primary_emotion: latest.emotion,
            valence: latest.valence,
            arousal: latest.arousal,
            confidence: latest.confidence,
            signals: latest.signals ?? [],
            detected_at: latest.timestamp,
          });
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Listen for live emotion detection
  useEffect(() => {
    const unlisten = listen<EmotionState>("blade_emotion_detected", (event) => {
      setCurrentState(event.payload);
      // Also add to readings list
      const reading: EmotionReading = {
        id: `live-${Date.now()}`,
        timestamp: event.payload.detected_at ?? new Date().toISOString(),
        emotion: event.payload.primary_emotion,
        valence: event.payload.valence,
        arousal: event.payload.arousal,
        confidence: event.payload.confidence,
        signals: event.payload.signals,
      };
      setReadings((prev) => [reading, ...prev]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Load trend when period changes
  useEffect(() => {
    setTrendLoading(true);
    invoke<EmotionTrend>("emotion_get_trend", { period: trendPeriod })
      .then((data) => setTrend(data))
      .catch((e) => setError(String(e)))
      .finally(() => setTrendLoading(false));
  }, [trendPeriod]);

  const handleAnalyzePatterns = useCallback(async () => {
    setPatternLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("emotion_analyze_patterns", { daysBack: 30 });
      setPatternAnalysis(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setPatternLoading(false);
    }
  }, []);

  const emotion = currentState?.primary_emotion ?? "neutral";
  const emotionStyle = emotionColor(emotion);

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
            Emotional Intelligence
          </h1>
          <span className="text-2xs text-gray-600 font-mono">emotional awareness</span>
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

          {/* ── Section 1: Current State ──────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Current State
              </span>
              <div className="flex-1 h-px bg-gray-800" />
              {currentState?.detected_at && (
                <span className="text-2xs text-gray-600 font-mono">
                  {formatTimestamp(currentState.detected_at)}
                </span>
              )}
            </div>

            <div className="border border-gray-700 bg-gray-900/50 rounded p-4 flex flex-col gap-4">
              {currentState ? (
                <>
                  {/* Primary emotion display */}
                  <div className="flex items-center gap-4">
                    <div
                      className={`px-4 py-2 rounded ${emotionStyle.bg} ${emotionStyle.border} border`}
                    >
                      <span className={`text-2xl font-mono font-bold uppercase ${emotionStyle.text}`}>
                        {emotion}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-gray-500 w-20">confidence</span>
                        <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-green-500 rounded-full"
                            style={{ width: `${Math.round(currentState.confidence * 100)}%` }}
                          />
                        </div>
                        <span className="text-2xs text-gray-500">
                          {Math.round(currentState.confidence * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Valence-Arousal grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <ValenceArousalGrid
                        valence={currentState.valence}
                        arousal={currentState.arousal}
                        emotion={emotion}
                      />
                    </div>
                    <div className="flex flex-col justify-center gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-gray-500 w-14">valence</span>
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden relative">
                          {/* Center marker */}
                          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-600" />
                          {currentState.valence >= 0 ? (
                            <div
                              className="absolute top-0 bottom-0 bg-green-500 rounded-full"
                              style={{
                                left: "50%",
                                width: `${currentState.valence * 50}%`,
                              }}
                            />
                          ) : (
                            <div
                              className="absolute top-0 bottom-0 bg-red-500 rounded-full"
                              style={{
                                right: "50%",
                                width: `${Math.abs(currentState.valence) * 50}%`,
                              }}
                            />
                          )}
                        </div>
                        <span className="text-2xs text-gray-500 w-10 text-right">
                          {currentState.valence.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-gray-500 w-14">arousal</span>
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-amber-500 rounded-full"
                            style={{ width: `${Math.round(currentState.arousal * 100)}%` }}
                          />
                        </div>
                        <span className="text-2xs text-gray-500 w-10 text-right">
                          {currentState.arousal.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Signals */}
                  {currentState.signals && currentState.signals.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-2xs text-gray-500 font-mono">detected via</span>
                      <div className="flex flex-wrap gap-1.5">
                        {currentState.signals.map((signal, i) => (
                          <span
                            key={i}
                            className="text-2xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 border border-gray-700 font-mono"
                          >
                            {signal}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs text-gray-600 font-mono">No emotion data yet</p>
                  <p className="text-2xs text-gray-700 mt-1">
                    BLADE will detect your emotional state as you interact.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ── Section 2: Trend Analysis ─────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Trend Analysis
              </span>
              <div className="flex-1 h-px bg-gray-800" />
              {/* Period selector */}
              <div className="flex items-center gap-1">
                {(["today", "this_week"] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setTrendPeriod(p)}
                    className={`text-2xs font-mono px-2 py-0.5 rounded border transition-colors ${
                      trendPeriod === p
                        ? "bg-green-900/40 text-green-400 border-green-700"
                        : "bg-gray-900 text-gray-500 border-gray-700 hover:text-gray-300"
                    }`}
                  >
                    {p.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-gray-700 bg-gray-900/50 rounded p-4 flex flex-col gap-4">
              {trendLoading ? (
                <div className="flex items-center gap-2 text-2xs text-gray-500 font-mono">
                  <span className="w-3 h-3 border border-green-500 border-t-transparent rounded-full animate-spin" />
                  <span>Loading trend…</span>
                </div>
              ) : trend ? (
                <>
                  {/* Avg valence bar */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-2xs text-gray-500">avg valence</span>
                      <span className={`text-2xs font-mono ${trend.avg_valence >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {trend.avg_valence.toFixed(2)}
                      </span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden relative">
                      <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-600" />
                      {trend.avg_valence >= 0 ? (
                        <div
                          className="absolute top-0 bottom-0 bg-green-500 rounded-full"
                          style={{ left: "50%", width: `${trend.avg_valence * 50}%` }}
                        />
                      ) : (
                        <div
                          className="absolute top-0 bottom-0 bg-red-500 rounded-full"
                          style={{ right: "50%", width: `${Math.abs(trend.avg_valence) * 50}%` }}
                        />
                      )}
                    </div>
                  </div>

                  {/* Dominant emotion */}
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-gray-500">dominant</span>
                    <span
                      className={`text-xs font-mono px-2 py-0.5 rounded border font-semibold ${emotionColor(trend.dominant_emotion).text} ${emotionColor(trend.dominant_emotion).bg} ${emotionColor(trend.dominant_emotion).border}`}
                    >
                      {trend.dominant_emotion}
                    </span>
                    <span className="text-2xs text-gray-600">{trend.reading_count} readings</span>
                  </div>

                  {/* Notable shifts */}
                  {trend.notable_shifts && trend.notable_shifts.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-2xs text-gray-500 font-mono">notable shifts</span>
                      <div className="flex flex-col gap-1">
                        {trend.notable_shifts.map((shift, i) => (
                          <div key={i} className="flex items-center gap-1.5 text-2xs font-mono">
                            <span className={emotionColor(shift.from_emotion).text}>{shift.from_emotion}</span>
                            <span className="text-gray-600">→</span>
                            <span className={emotionColor(shift.to_emotion).text}>{shift.to_emotion}</span>
                            <span className="text-gray-600 ml-auto">{formatTimestamp(shift.at)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Emotion timeline */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-2xs text-gray-500 font-mono">recent readings</span>
                    <EmotionTimeline readings={readings} />
                  </div>
                </>
              ) : (
                <div className="text-center py-4">
                  <p className="text-xs text-gray-600 font-mono">No trend data for this period</p>
                </div>
              )}
            </div>
          </section>

          {/* ── Section 3: Patterns ───────────────────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Pattern Analysis
              </span>
              <div className="flex-1 h-px bg-gray-800" />
            </div>

            <div className="border border-gray-700 bg-gray-900/40 rounded p-4 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-gray-200">Analyze 30-Day Patterns</p>
                  <p className="text-2xs text-gray-500 mt-0.5">
                    Run LLM analysis across your recent emotional data.
                  </p>
                </div>
                <button
                  onClick={handleAnalyzePatterns}
                  disabled={patternLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono rounded border border-green-700 bg-green-900/30 text-green-400 hover:bg-green-900/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                >
                  {patternLoading ? (
                    <>
                      <span className="w-3 h-3 border border-green-500 border-t-transparent rounded-full animate-spin" />
                      <span>Analyzing…</span>
                    </>
                  ) : (
                    <span>Analyze</span>
                  )}
                </button>
              </div>

              {patternAnalysis && (
                <div className="bg-black border border-gray-800 rounded p-3">
                  <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                    {patternAnalysis}
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ── Section 4: Recent Readings Table ──────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xs font-mono text-green-400 uppercase tracking-widest">
                Recent Readings
              </span>
              <div className="flex-1 h-px bg-gray-800" />
              <span className="text-2xs text-gray-600">{readings.length} records</span>
            </div>

            {readings.length === 0 ? (
              <div className="border border-gray-800 rounded p-6 text-center">
                <p className="text-xs text-gray-600 font-mono">No readings yet</p>
              </div>
            ) : (
              <div className="border border-gray-700 rounded overflow-hidden">
                <table className="w-full text-2xs font-mono">
                  <thead>
                    <tr className="border-b border-gray-700 bg-gray-900">
                      <th className="text-left px-3 py-2 text-gray-500 font-normal">time</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-normal">emotion</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-normal w-20">valence</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-normal w-20">arousal</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-normal w-16">conf</th>
                      <th className="text-left px-3 py-2 text-gray-500 font-normal">signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readings.slice(0, 30).map((r) => {
                      const ec = emotionColor(r.emotion);
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-gray-800 hover:bg-gray-900/50 transition-colors"
                        >
                          <td className="px-3 py-1.5 text-gray-500">{formatTimestamp(r.timestamp)}</td>
                          <td className={`px-3 py-1.5 font-semibold ${ec.text}`}>{r.emotion}</td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1">
                              <div className="w-14 h-1.5 bg-gray-800 rounded-full overflow-hidden relative">
                                <div className="absolute top-0 bottom-0 left-1/2 w-px bg-gray-700" />
                                {r.valence >= 0 ? (
                                  <div
                                    className="absolute top-0 bottom-0 bg-green-500"
                                    style={{ left: "50%", width: `${r.valence * 50}%` }}
                                  />
                                ) : (
                                  <div
                                    className="absolute top-0 bottom-0 bg-red-500"
                                    style={{ right: "50%", width: `${Math.abs(r.valence) * 50}%` }}
                                  />
                                )}
                              </div>
                              <span className="text-gray-600 text-2xs">{r.valence.toFixed(2)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5">
                            <div className="flex items-center gap-1">
                              <div className="w-14 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-amber-500"
                                  style={{ width: `${r.arousal * 100}%` }}
                                />
                              </div>
                              <span className="text-gray-600 text-2xs">{r.arousal.toFixed(2)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-gray-500">{Math.round(r.confidence * 100)}%</td>
                          <td className="px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                              {(r.signals ?? []).slice(0, 3).map((s, i) => (
                                <span
                                  key={i}
                                  className="px-1 py-0.5 rounded bg-gray-800 text-gray-400 text-2xs border border-gray-700"
                                >
                                  {s}
                                </span>
                              ))}
                              {(r.signals ?? []).length > 3 && (
                                <span className="text-gray-600">+{r.signals.length - 3}</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
