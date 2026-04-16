import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface HealthLog {
  id?: string;
  date: string;
  sleep_hours: number;
  sleep_quality: number;
  energy_level: number;
  mood: number;
  exercise_minutes: number;
  exercise_type: string;
  water_glasses: number;
  notes: string;
}

interface WeekLog {
  date: string;
  sleep_hours: number;
  energy_level: number;
  mood: number;
  has_exercise: boolean;
}

interface HealthStats {
  avg_sleep: number;
  avg_energy: number;
  avg_mood: number;
  exercise_days: number;
  sleep_debt: number;
}

interface StreakInfo {
  exercise_streak: number;
  days_since_log: number;
  longest_streak: number;
}

interface HealthInsight {
  type: "sleep_debt" | "exercise_streak" | "correlation" | "general";
  title: string;
  content: string;
  recommendation: string;
}

const ENERGY_EMOJI = ["", "😴", "😴", "😪", "😐", "😐", "🙂", "🙂", "⚡", "⚡", "⚡"];
const MOOD_EMOJI = ["", "😞", "😔", "😕", "😐", "😐", "🙂", "😊", "😄", "😁", "🤩"];

function dotColor(val: number, max: number): string {
  const pct = val / max;
  if (pct >= 0.7) return "bg-green-500";
  if (pct >= 0.4) return "bg-amber-500";
  return "bg-red-500";
}

function MetricDot({ val, max, label }: { val: number; max: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`w-3 h-3 rounded-full ${dotColor(val, max)}`} title={`${label}: ${val}`} />
      <span className="text-xs text-[rgba(255,255,255,0.3)]">{label[0]}</span>
    </div>
  );
}

function Slider({ label, min, max, step = 1, value, onChange, emoji }: {
  label: string; min: number; max: number; step?: number;
  value: number; onChange: (v: number) => void; emoji?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-[rgba(255,255,255,0.4)]">{label}</label>
        <span className="text-xs text-green-400 font-bold">
          {emoji || ""} {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-[rgba(255,255,255,0.04)] rounded-full appearance-none cursor-pointer accent-green-500"
      />
      <div className="flex justify-between text-xs text-[rgba(255,255,255,0.2)]">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function InsightCard({ insight }: { insight: HealthInsight }) {
  const colors: Record<string, string> = {
    sleep_debt: "border-red-700 bg-red-900/20 text-red-300",
    exercise_streak: "border-green-700 bg-green-900/20 text-green-300",
    correlation: "border-blue-700 bg-blue-900/20 text-blue-300",
    general: "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.04)]/40 text-[rgba(255,255,255,0.7)]",
  };
  const cls = colors[insight.type] || colors.general;
  return (
    <div className={`border rounded p-3 space-y-1 ${cls}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider">{insight.type.replace("_", " ")}</span>
      </div>
      <p className="text-xs font-semibold text-white">{insight.title}</p>
      <p className="text-xs opacity-80">{insight.content}</p>
      {insight.recommendation && (
        <p className="text-xs italic opacity-60 mt-1">{insight.recommendation}</p>
      )}
    </div>
  );
}

export function HealthView({ onBack }: { onBack: () => void }) {
  const today = new Date().toISOString().split("T")[0];

  const [log, setLog] = useState<HealthLog>({
    date: today,
    sleep_hours: 7,
    sleep_quality: 7,
    energy_level: 7,
    mood: 7,
    exercise_minutes: 0,
    exercise_type: "",
    water_glasses: 6,
    notes: "",
  });
  const [logLoading, setLogLoading] = useState(false);
  const [logSuccess, setLogSuccess] = useState(false);

  const [weekData, setWeekData] = useState<WeekLog[]>([]);
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [streakInfo, setStreakInfo] = useState<StreakInfo | null>(null);
  const [insights, setInsights] = useState<HealthInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [correlationText, setCorrelationText] = useState("");
  const [correlationLoading, setCorrelationLoading] = useState(false);

  useEffect(() => {
    loadWeekData();
    loadStats();
    loadStreakInfo();
  }, []);

  async function loadWeekData() {
    try {
      const data = await invoke<WeekLog[]>("health_get_week");
      setWeekData(data);
    } catch {
      // ignore
    }
  }

  async function loadStats() {
    try {
      const data = await invoke<HealthStats>("health_get_stats");
      setStats(data);
    } catch {
      // ignore
    }
  }

  async function loadStreakInfo() {
    try {
      const data = await invoke<StreakInfo>("health_streak_info");
      setStreakInfo(data);
    } catch {
      // ignore
    }
  }

  async function handleLog() {
    setLogLoading(true);
    setLogSuccess(false);
    try {
      await invoke("health_log", { log });
      setLogSuccess(true);
      loadWeekData();
      loadStats();
      loadStreakInfo();
      setTimeout(() => setLogSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setLogLoading(false);
    }
  }

  async function handleGetInsights() {
    setInsightsLoading(true);
    try {
      const data = await invoke<HealthInsight[]>("health_get_insights", { daysBack: 30 });
      setInsights(data);
    } catch {
      // ignore
    } finally {
      setInsightsLoading(false);
    }
  }

  async function handleCorrelate() {
    setCorrelationLoading(true);
    setCorrelationText("");
    try {
      const text = await invoke<string>("health_correlate_productivity", { daysBack: 30 });
      setCorrelationText(text);
    } catch {
      // ignore
    } finally {
      setCorrelationLoading(false);
    }
  }

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });

  function getDayLog(date: string): WeekLog | undefined {
    return weekData.find((w) => w.date === date);
  }

  return (
    <div className="flex flex-col h-full bg-black text-[rgba(255,255,255,0.85)] font-mono overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[rgba(255,255,255,0.1)] bg-black sticky top-0 z-10">
        <button onClick={onBack} className="text-[rgba(255,255,255,0.4)] hover:text-green-400 transition-colors">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="text-green-400 text-sm font-bold tracking-widest uppercase">Health Tracker</span>
        {streakInfo && streakInfo.days_since_log > 1 && (
          <span className="text-xs text-amber-400 border border-amber-700 px-2 py-0.5 rounded ml-2">
            ! Last log {streakInfo.days_since_log}d ago
          </span>
        )}
      </div>

      <div className="p-4 space-y-4 max-w-3xl mx-auto w-full">
        {/* Today's Log */}
        <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-green-400 uppercase tracking-widest">Today — {today}</h2>
            <div className="flex items-center gap-2">
              {logSuccess && <span className="text-xs text-green-400">Logged!</span>}
              <button
                onClick={handleLog}
                disabled={logLoading}
                className="px-4 py-1.5 text-xs font-bold uppercase tracking-wider bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-800/50 disabled:opacity-40 transition-colors"
              >
                {logLoading ? "Saving..." : "Log Today"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Slider
              label="Sleep Hours"
              min={0} max={12} step={0.5}
              value={log.sleep_hours}
              onChange={(v) => setLog({ ...log, sleep_hours: v })}
            />
            <Slider
              label="Sleep Quality"
              min={1} max={10}
              value={log.sleep_quality}
              onChange={(v) => setLog({ ...log, sleep_quality: v })}
            />
            <Slider
              label="Energy Level"
              min={1} max={10}
              value={log.energy_level}
              onChange={(v) => setLog({ ...log, energy_level: v })}
              emoji={ENERGY_EMOJI[log.energy_level] || ""}
            />
            <Slider
              label="Mood"
              min={1} max={10}
              value={log.mood}
              onChange={(v) => setLog({ ...log, mood: v })}
              emoji={MOOD_EMOJI[log.mood] || ""}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-[rgba(255,255,255,0.4)]">Exercise Minutes</label>
              <input
                type="number"
                min={0}
                className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-green-700"
                value={log.exercise_minutes}
                onChange={(e) => setLog({ ...log, exercise_minutes: parseInt(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[rgba(255,255,255,0.4)]">Exercise Type</label>
              <input
                type="text"
                className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-700"
                placeholder="run, gym, walk..."
                value={log.exercise_type}
                onChange={(e) => setLog({ ...log, exercise_type: e.target.value })}
              />
            </div>
          </div>

          {/* Water glasses */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs text-[rgba(255,255,255,0.4)]">Water Glasses</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setLog({ ...log, water_glasses: Math.max(0, log.water_glasses - 1) })}
                  className="w-6 h-6 text-xs border border-[rgba(255,255,255,0.1)] rounded text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] transition-colors"
                >-</button>
                <span className="text-sm font-bold text-blue-300 w-6 text-center">{log.water_glasses}</span>
                <button
                  onClick={() => setLog({ ...log, water_glasses: Math.min(15, log.water_glasses + 1) })}
                  className="w-6 h-6 text-xs border border-[rgba(255,255,255,0.1)] rounded text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] transition-colors"
                >+</button>
              </div>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 15 }).map((_, i) => (
                <div
                  key={i}
                  onClick={() => setLog({ ...log, water_glasses: i + 1 })}
                  className={`flex-1 h-3 rounded-sm cursor-pointer transition-colors ${i < log.water_glasses ? "bg-blue-600" : "bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)]"}`}
                />
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-[rgba(255,255,255,0.4)]">Notes</label>
            <textarea
              className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-2 text-xs text-[rgba(255,255,255,0.7)] placeholder-gray-600 focus:outline-none focus:border-green-700 resize-none"
              rows={2}
              placeholder="Anything noteworthy today..."
              value={log.notes}
              onChange={(e) => setLog({ ...log, notes: e.target.value })}
            />
          </div>
        </div>

        {/* Week View */}
        <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-4">
          <h2 className="text-xs font-bold text-green-400 uppercase tracking-widest mb-3">7-Day Overview</h2>
          <div className="grid grid-cols-7 gap-2">
            {last7Days.map((date) => {
              const dayLog = getDayLog(date);
              const label = new Date(date).toLocaleDateString("en", { weekday: "short" }).slice(0, 2);
              return (
                <div key={date} className="flex flex-col items-center gap-1.5">
                  <span className="text-xs text-[rgba(255,255,255,0.3)]">{label}</span>
                  {dayLog ? (
                    <>
                      <MetricDot val={dayLog.sleep_hours} max={9} label="Sleep" />
                      <MetricDot val={dayLog.energy_level} max={10} label="Energy" />
                      <MetricDot val={dayLog.mood} max={10} label="Mood" />
                      {dayLog.has_exercise && (
                        <span className="text-xs text-green-500">E</span>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="w-3 h-3 rounded-full bg-[rgba(255,255,255,0.04)]" />
                      <div className="w-3 h-3 rounded-full bg-[rgba(255,255,255,0.04)]" />
                      <div className="w-3 h-3 rounded-full bg-[rgba(255,255,255,0.04)]" />
                    </>
                  )}
                  <span className="text-xs text-[rgba(255,255,255,0.2)]">{date.slice(5)}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-3 text-xs text-[rgba(255,255,255,0.3)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Good</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />OK</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Low</span>
            <span className="flex items-center gap-1"><span className="text-green-500">E</span> Exercise</span>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-4">
            <h2 className="text-xs font-bold text-green-400 uppercase tracking-widest mb-3">This Week Stats</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Avg Sleep", value: `${stats.avg_sleep.toFixed(1)}h`, color: "text-blue-300" },
                { label: "Avg Energy", value: `${stats.avg_energy.toFixed(1)}/10`, color: "text-yellow-300" },
                { label: "Avg Mood", value: `${stats.avg_mood.toFixed(1)}/10`, color: "text-pink-300" },
                { label: "Exercise Days", value: `${stats.exercise_days}/7`, color: "text-green-300" },
              ].map((s) => (
                <div key={s.label} className="bg-black border border-[rgba(255,255,255,0.07)] rounded p-2 text-center">
                  <p className="text-xs text-[rgba(255,255,255,0.4)]">{s.label}</p>
                  <p className={`text-base font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            {stats.sleep_debt > 0 && (
              <div className="mt-2 text-xs text-red-400 border border-red-800 rounded p-2 bg-red-900/10">
                Sleep Debt: {stats.sleep_debt.toFixed(1)}h — aim for 8h/night to recover
              </div>
            )}
          </div>
        )}

        {/* Streak info */}
        {streakInfo && (
          <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-3 flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔥</span>
              <div>
                <p className="text-xs text-[rgba(255,255,255,0.4)]">Exercise Streak</p>
                <p className="text-base font-bold text-green-400">{streakInfo.exercise_streak} days</p>
              </div>
            </div>
            <div className="w-px h-8 bg-[rgba(255,255,255,0.07)]" />
            <div>
              <p className="text-xs text-[rgba(255,255,255,0.4)]">Longest Streak</p>
              <p className="text-base font-bold text-amber-400">{streakInfo.longest_streak} days</p>
            </div>
          </div>
        )}

        {/* Insights */}
        <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-green-400 uppercase tracking-widest">AI Insights</h2>
            <div className="flex-1" />
            <button
              onClick={handleGetInsights}
              disabled={insightsLoading}
              className="px-3 py-1 text-xs bg-green-900/30 border border-green-800 text-green-400 rounded hover:bg-green-900/50 disabled:opacity-40 transition-colors"
            >
              {insightsLoading ? "Analyzing..." : "Generate Insights"}
            </button>
          </div>
          {insights.length > 0 ? (
            <div className="space-y-2">
              {insights.map((ins, i) => <InsightCard key={i} insight={ins} />)}
            </div>
          ) : (
            <p className="text-xs text-[rgba(255,255,255,0.3)] italic">Click Generate to analyze 30 days of health data.</p>
          )}
        </div>

        {/* Productivity Correlation */}
        <div className="border border-[rgba(255,255,255,0.1)] rounded bg-[#09090b]/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-blue-400 uppercase tracking-widest">Productivity Correlation</h2>
            <div className="flex-1" />
            <button
              onClick={handleCorrelate}
              disabled={correlationLoading}
              className="px-3 py-1 text-xs bg-blue-900/30 border border-blue-800 text-blue-400 rounded hover:bg-blue-900/50 disabled:opacity-40 transition-colors"
            >
              {correlationLoading ? "Correlating..." : "Analyze"}
            </button>
          </div>
          {correlationText ? (
            <p className="text-sm text-[rgba(255,255,255,0.7)] leading-relaxed whitespace-pre-wrap">{correlationText}</p>
          ) : (
            <p className="text-xs text-[rgba(255,255,255,0.3)] italic">Correlate your health metrics with productivity patterns over the last 30 days.</p>
          )}
        </div>
      </div>
    </div>
  );
}
