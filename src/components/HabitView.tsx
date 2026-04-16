// src/components/HabitView.tsx
// Habit tracking with streaks, AI advisor, and history calendars.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Habit {
  id: string;
  name: string;
  description?: string;
  frequency: "daily" | "weekly" | "weekdays" | "custom";
  target_time?: string;
  category: string;
  cue?: string;
  reward?: string;
  current_streak: number;
  best_streak: number;
  completion_rate: number;
  friction_score: number;
  archived: boolean;
}

interface HabitLog {
  date: string;
  completed: boolean;
  skipped: boolean;
  skip_reason?: string;
  mood_after?: number;
}

interface TodayHabit {
  habit: Habit;
  completed: boolean;
  skipped: boolean;
  mood_after?: number;
  completed_at?: string;
}

interface HabitInsight {
  kind: "streak_at_risk" | "achievement" | "friction_point" | "pattern_found";
  title: string;
  body: string;
  habit_name?: string;
}

interface HabitDesign {
  cue: string;
  routine: string;
  reward: string;
  implementation_intention?: string;
}

// ── Category colours ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  health: "bg-green-500",
  fitness: "bg-emerald-500",
  mindfulness: "bg-purple-500",
  productivity: "bg-blue-500",
  learning: "bg-yellow-500",
  social: "bg-pink-500",
  finance: "bg-amber-500",
  creativity: "bg-orange-500",
};

function categoryDot(category: string) {
  return CATEGORY_COLORS[category.toLowerCase()] ?? "bg-[rgba(255,255,255,0.04)]";
}

// ── Stars rating ──────────────────────────────────────────────────────────────

function StarRating({ value, max = 10 }: { value: number; max?: number }) {
  const filled = Math.round(value);
  return (
    <span className="text-xs text-yellow-400">
      {"★".repeat(filled)}{"☆".repeat(max - filled)}
      <span className="text-[rgba(255,255,255,0.4)] ml-1">({value}/10)</span>
    </span>
  );
}

// ── Skip reason modal ─────────────────────────────────────────────────────────

function SkipModal({
  habitName,
  onConfirm,
  onClose,
}: {
  habitName: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#09090b] border border-[rgba(255,255,255,0.1)] rounded-lg p-6 w-96">
        <h3 className="text-green-400 font-mono text-sm mb-1">Skip habit</h3>
        <p className="text-[rgba(255,255,255,0.5)] text-xs mb-4">{habitName}</p>
        <textarea
          className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs text-[rgba(255,255,255,0.85)] font-mono resize-none h-20 focus:outline-none focus:border-green-500"
          placeholder="Why are you skipping? (optional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.1)] rounded hover:border-[rgba(255,255,255,0.2)]"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            className="px-3 py-1.5 text-xs text-amber-400 border border-amber-700 rounded hover:bg-amber-900/30"
          >
            Skip anyway
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add habit modal ───────────────────────────────────────────────────────────

function AddHabitModal({
  onSave,
  onClose,
}: {
  onSave: (data: Partial<Habit>) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<Habit["frequency"]>("daily");
  const [targetTime, setTargetTime] = useState("");
  const [category, setCategory] = useState("productivity");
  const [cue, setCue] = useState("");
  const [reward, setReward] = useState("");

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#09090b] border border-[rgba(255,255,255,0.1)] rounded-lg p-6 w-[480px] max-h-[90vh] overflow-y-auto">
        <h3 className="text-green-400 font-mono text-sm mb-4">+ New Habit</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Name *</label>
            <input
              className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning meditation"
            />
          </div>
          <div>
            <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Description</label>
            <input
              className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="10 minutes of focused breathing"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Frequency</label>
              <select
                className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Habit["frequency"])}
              >
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Target time</label>
              <input
                type="time"
                className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
                value={targetTime}
                onChange={(e) => setTargetTime(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Category</label>
            <select
              className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {Object.keys(CATEGORY_COLORS).map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Cue (trigger)</label>
            <input
              className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
              value={cue}
              onChange={(e) => setCue(e.target.value)}
              placeholder="After I brew my morning coffee"
            />
          </div>
          <div>
            <label className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Reward</label>
            <input
              className="w-full mt-1 bg-black border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-[rgba(255,255,255,0.85)] font-mono focus:outline-none focus:border-green-500"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              placeholder="I can then scroll news for 5 min"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-5 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.1)] rounded hover:border-[rgba(255,255,255,0.2)]"
          >
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onSave({ name, description, frequency, target_time: targetTime, category, cue, reward })}
            className="px-3 py-1.5 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Create habit
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 30-day dot calendar ───────────────────────────────────────────────────────

function DotCalendar({ logs }: { logs: HabitLog[] }) {
  const logMap = new Map(logs.map((l) => [l.date, l]));
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {days.map((day) => {
        const log = logMap.get(day);
        let color = "bg-[rgba(255,255,255,0.04)]";
        if (log?.completed) color = "bg-green-500";
        else if (log?.skipped) color = "bg-amber-600";
        return (
          <div
            key={day}
            title={day}
            className={`w-4 h-4 rounded-sm ${color}`}
          />
        );
      })}
    </div>
  );
}

// ── History modal ─────────────────────────────────────────────────────────────

function HistoryModal({
  habit,
  onClose,
}: {
  habit: Habit;
  onClose: () => void;
}) {
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<HabitLog[]>("habit_get_logs", { habitId: habit.id, daysBack: 30 })
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [habit.id]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-[#09090b] border border-[rgba(255,255,255,0.1)] rounded-lg p-6 w-[480px]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-green-400 font-mono text-sm">{habit.name} — Last 30 days</h3>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] text-lg leading-none">✕</button>
        </div>
        {loading ? (
          <p className="text-[rgba(255,255,255,0.4)] text-xs font-mono">Loading logs...</p>
        ) : (
          <>
            <div className="flex gap-4 text-xs text-[rgba(255,255,255,0.4)] font-mono mb-3">
              <span><span className="inline-block w-3 h-3 bg-green-500 rounded-sm mr-1" />Completed</span>
              <span><span className="inline-block w-3 h-3 bg-amber-600 rounded-sm mr-1" />Skipped</span>
              <span><span className="inline-block w-3 h-3 bg-[rgba(255,255,255,0.04)] rounded-sm mr-1" />Missed</span>
            </div>
            <DotCalendar logs={logs} />
            <p className="text-[rgba(255,255,255,0.3)] text-xs font-mono mt-3">
              {logs.filter((l) => l.completed).length} completions out of 30 days
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Today section ─────────────────────────────────────────────────────────────

function TodaySection() {
  const [todayHabits, setTodayHabits] = useState<TodayHabit[]>([]);
  const [loading, setLoading] = useState(false);
  const [skipTarget, setSkipTarget] = useState<TodayHabit | null>(null);

  const fetchToday = useCallback(() => {
    setLoading(true);
    invoke<TodayHabit[]>("habit_get_today")
      .then(setTodayHabits)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  async function complete(th: TodayHabit) {
    await invoke("habit_complete", { habitId: th.habit.id });
    fetchToday();
  }

  async function skip(th: TodayHabit, reason: string) {
    await invoke("habit_skip", { habitId: th.habit.id, reason });
    setSkipTarget(null);
    fetchToday();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-green-400 font-mono text-xs uppercase tracking-widest">Today's Habits</h2>
        <button
          onClick={fetchToday}
          className="text-xs text-[rgba(255,255,255,0.4)] border border-[rgba(255,255,255,0.1)] rounded px-2 py-0.5 hover:border-[rgba(255,255,255,0.2)] font-mono"
        >
          Check Due Now
        </button>
      </div>

      {loading && <p className="text-[rgba(255,255,255,0.3)] text-xs font-mono">Loading...</p>}

      {!loading && todayHabits.length === 0 && (
        <p className="text-[rgba(255,255,255,0.3)] text-xs font-mono border border-[rgba(255,255,255,0.07)] rounded p-4 text-center">
          No habits due today. Great job or nothing set up yet!
        </p>
      )}

      <div className="space-y-2">
        {todayHabits.map((th) => (
          <div
            key={th.habit.id}
            className={`border rounded-lg p-3 flex items-center gap-3 ${
              th.completed
                ? "border-green-900 bg-green-950/20"
                : th.skipped
                ? "border-[rgba(255,255,255,0.07)] bg-[#09090b]/50 opacity-60"
                : "border-[rgba(255,255,255,0.1)] bg-[#09090b]"
            }`}
          >
            {/* Category dot */}
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${categoryDot(th.habit.category)}`} />

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-white text-xs font-mono font-semibold">{th.habit.name}</span>
                <span className="text-[rgba(255,255,255,0.3)] text-2xs font-mono border border-[rgba(255,255,255,0.07)] rounded px-1">
                  {th.habit.frequency}
                </span>
                {th.habit.target_time && (
                  <span className="text-[rgba(255,255,255,0.3)] text-2xs font-mono">⏰ {th.habit.target_time}</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-xs">🔥 {th.habit.current_streak} days</span>
                {th.completed && th.mood_after !== undefined && (
                  <StarRating value={th.mood_after} />
                )}
                {th.skipped && (
                  <span className="text-amber-600 text-xs font-mono">skipped</span>
                )}
              </div>
            </div>

            {/* Actions */}
            {!th.completed && !th.skipped && (
              <div className="flex gap-1.5 flex-shrink-0">
                <button
                  onClick={() => complete(th)}
                  className="text-xs px-2 py-1 border border-green-700 text-green-400 rounded hover:bg-green-900/30"
                  title="Mark complete"
                >
                  ✅
                </button>
                <button
                  onClick={() => setSkipTarget(th)}
                  className="text-xs px-2 py-1 border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] rounded hover:border-amber-700 hover:text-amber-400"
                  title="Skip"
                >
                  ⏭
                </button>
              </div>
            )}
            {th.completed && (
              <span className="text-green-500 text-lg">✓</span>
            )}
          </div>
        ))}
      </div>

      {skipTarget && (
        <SkipModal
          habitName={skipTarget.habit.name}
          onConfirm={(reason) => skip(skipTarget, reason)}
          onClose={() => setSkipTarget(null)}
        />
      )}
    </section>
  );
}

// ── All habits section ────────────────────────────────────────────────────────

function AllHabitsSection() {
  const [habits, setHabits] = useState<Habit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [historyHabit, setHistoryHabit] = useState<Habit | null>(null);

  const fetchHabits = useCallback(() => {
    setLoading(true);
    invoke<Habit[]>("habit_list")
      .then((list) => setHabits(list.filter((h) => !h.archived)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchHabits(); }, [fetchHabits]);

  async function createHabit(data: Partial<Habit>) {
    await invoke("habit_create", { ...data });
    setShowAdd(false);
    fetchHabits();
  }

  async function archiveHabit(id: string) {
    await invoke("habit_archive", { habitId: id });
    fetchHabits();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-green-400 font-mono text-xs uppercase tracking-widest">All Habits</h2>
        <button
          onClick={() => setShowAdd(true)}
          className="text-xs text-green-400 border border-green-700 rounded px-2 py-0.5 hover:bg-green-900/30 font-mono"
        >
          + Add Habit
        </button>
      </div>

      {loading && <p className="text-[rgba(255,255,255,0.3)] text-xs font-mono">Loading habits...</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {habits.map((habit) => {
          const atRisk = habit.completion_rate < 0.6;
          return (
            <div
              key={habit.id}
              className={`border rounded-lg p-4 bg-[#09090b] ${
                atRisk ? "border-amber-700" : "border-[rgba(255,255,255,0.1)]"
              }`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${categoryDot(habit.category)}`} />
                  <span className="text-white text-xs font-mono font-semibold">{habit.name}</span>
                </div>
                <span className={`text-2xs font-mono px-1.5 py-0.5 rounded border ${categoryDot(habit.category)} bg-opacity-20 border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)]`}>
                  {habit.category}
                </span>
              </div>

              <div className="flex gap-4 text-xs text-[rgba(255,255,255,0.5)] font-mono mb-3">
                <span>🔥 {habit.current_streak}d</span>
                <span>🏆 {habit.best_streak}d best</span>
                {atRisk && <span className="text-amber-500">⚠ at risk</span>}
              </div>

              {/* Completion rate bar */}
              <div className="mb-1">
                <div className="flex justify-between text-2xs text-[rgba(255,255,255,0.3)] font-mono mb-0.5">
                  <span>Completion rate</span>
                  <span>{Math.round(habit.completion_rate * 100)}%</span>
                </div>
                <div className="h-1.5 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${habit.completion_rate >= 0.8 ? "bg-green-500" : habit.completion_rate >= 0.6 ? "bg-yellow-500" : "bg-red-500"}`}
                    style={{ width: `${habit.completion_rate * 100}%` }}
                  />
                </div>
              </div>

              {/* Friction score */}
              <div className="flex items-center gap-1 mt-1 mb-3">
                <span className="text-2xs text-[rgba(255,255,255,0.3)] font-mono">Friction:</span>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-sm ${i < habit.friction_score ? "bg-red-500" : "bg-[rgba(255,255,255,0.04)]"}`}
                    />
                  ))}
                </div>
                <span className="text-2xs text-[rgba(255,255,255,0.3)] font-mono">{habit.friction_score}/5</span>
              </div>

              <div className="flex gap-1.5">
                <button
                  onClick={() => setHistoryHabit(habit)}
                  className="text-2xs text-blue-400 border border-blue-900 rounded px-2 py-0.5 hover:bg-blue-900/20"
                >
                  History
                </button>
                <button
                  onClick={() => archiveHabit(habit.id)}
                  className="text-2xs text-[rgba(255,255,255,0.4)] border border-[rgba(255,255,255,0.07)] rounded px-2 py-0.5 hover:border-[rgba(255,255,255,0.15)]"
                >
                  Archive
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {showAdd && <AddHabitModal onSave={createHabit} onClose={() => setShowAdd(false)} />}
      {historyHabit && <HistoryModal habit={historyHabit} onClose={() => setHistoryHabit(null)} />}
    </section>
  );
}

// ── AI Advisor section ────────────────────────────────────────────────────────

function AIAdvisorSection() {
  const [goalText, setGoalText] = useState("");
  const [design, setDesign] = useState<HabitDesign | null>(null);
  const [designing, setDesigning] = useState(false);

  const [insights, setInsights] = useState<HabitInsight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);

  async function designHabit() {
    if (!goalText.trim()) return;
    setDesigning(true);
    setDesign(null);
    try {
      const result = await invoke<HabitDesign>("habit_suggest_design", { goal: goalText });
      setDesign(result);
    } catch (e) {
      console.error(e);
    } finally {
      setDesigning(false);
    }
  }

  async function getInsights() {
    setLoadingInsights(true);
    try {
      const result = await invoke<HabitInsight[]>("habit_insights");
      setInsights(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingInsights(false);
    }
  }

  const insightColors: Record<HabitInsight["kind"], string> = {
    streak_at_risk: "border-amber-600 bg-amber-950/20",
    achievement: "border-green-600 bg-green-950/20",
    friction_point: "border-red-700 bg-red-950/20",
    pattern_found: "border-blue-700 bg-blue-950/20",
  };

  const insightIcons: Record<HabitInsight["kind"], string> = {
    streak_at_risk: "⚠️",
    achievement: "🏆",
    friction_point: "🔴",
    pattern_found: "🔵",
  };

  return (
    <section className="space-y-6">
      {/* Design a Habit */}
      <div className="border border-[rgba(255,255,255,0.1)] rounded-lg p-4 bg-[#09090b]">
        <h3 className="text-green-400 font-mono text-xs mb-3">🧠 Design a Habit</h3>
        <p className="text-[rgba(255,255,255,0.4)] text-xs font-mono mb-2">Describe your goal and BLADE will design a cue/routine/reward structure.</p>
        <textarea
          className="w-full bg-black border border-[rgba(255,255,255,0.1)] rounded p-2 text-xs text-[rgba(255,255,255,0.85)] font-mono resize-none h-20 focus:outline-none focus:border-green-500"
          placeholder="e.g. I want to exercise consistently in the morning..."
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
        />
        <button
          onClick={designHabit}
          disabled={designing || !goalText.trim()}
          className="mt-2 px-3 py-1.5 text-xs text-green-400 border border-green-700 rounded hover:bg-green-900/30 disabled:opacity-40 disabled:cursor-not-allowed font-mono"
        >
          {designing ? "Designing..." : "Design Habit →"}
        </button>

        {design && (
          <div className="mt-4 space-y-3">
            {(["cue", "routine", "reward"] as const).map((part) => (
              <div key={part} className="border border-[rgba(255,255,255,0.07)] rounded p-3">
                <p className="text-[rgba(255,255,255,0.4)] text-2xs font-mono uppercase tracking-wider mb-1">{part}</p>
                <p className="text-[rgba(255,255,255,0.85)] text-xs font-mono">{design[part]}</p>
              </div>
            ))}
            {design.implementation_intention && (
              <div className="border border-blue-900 rounded p-3">
                <p className="text-blue-500 text-2xs font-mono uppercase tracking-wider mb-1">Implementation intention</p>
                <p className="text-[rgba(255,255,255,0.85)] text-xs font-mono">{design.implementation_intention}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Get Insights */}
      <div className="border border-[rgba(255,255,255,0.1)] rounded-lg p-4 bg-[#09090b]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-green-400 font-mono text-xs">💡 Habit Insights</h3>
          <button
            onClick={getInsights}
            disabled={loadingInsights}
            className="text-xs text-blue-400 border border-blue-800 rounded px-2 py-0.5 hover:bg-blue-900/20 disabled:opacity-40 font-mono"
          >
            {loadingInsights ? "Analyzing..." : "Get Insights"}
          </button>
        </div>

        {insights.length === 0 && !loadingInsights && (
          <p className="text-[rgba(255,255,255,0.3)] text-xs font-mono">Click "Get Insights" to analyze your habit patterns.</p>
        )}

        <div className="space-y-2">
          {insights.map((ins, i) => (
            <div key={i} className={`border rounded-lg p-3 ${insightColors[ins.kind]}`}>
              <div className="flex items-center gap-2 mb-1">
                <span>{insightIcons[ins.kind]}</span>
                <span className="text-white text-xs font-mono font-semibold">{ins.title}</span>
                {ins.habit_name && (
                  <span className="text-[rgba(255,255,255,0.4)] text-2xs font-mono">({ins.habit_name})</span>
                )}
              </div>
              <p className="text-[rgba(255,255,255,0.7)] text-xs font-mono">{ins.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export function HabitView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"today" | "all" | "ai">("today");

  const tabs = [
    { id: "today" as const, label: "Today" },
    { id: "all" as const, label: "All Habits" },
    { id: "ai" as const, label: "AI Advisor" },
  ];

  return (
    <div className="flex flex-col h-screen bg-black text-[rgba(255,255,255,0.85)] font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.07)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] text-xs border border-[rgba(255,255,255,0.07)] rounded px-2 py-1"
          >
            ← Back
          </button>
          <span className="text-green-400 text-sm font-mono">🔥 Habits</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[rgba(255,255,255,0.07)] px-4">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-xs font-mono border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-green-500 text-green-400"
                : "border-transparent text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {tab === "today" && <TodaySection />}
        {tab === "all" && <AllHabitsSection />}
        {tab === "ai" && <AIAdvisorSection />}
      </div>
    </div>
  );
}
