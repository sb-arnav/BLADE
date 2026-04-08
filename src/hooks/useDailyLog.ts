import { useState, useCallback, useMemo, useEffect } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DailyEntry {
  id: string;
  date: string; // YYYY-MM-DD
  mood: 1 | 2 | 3 | 4 | 5;
  energyLevel: 1 | 2 | 3 | 4 | 5;
  highlights: string[];
  challenges: string[];
  gratitude: string[];
  notes: string;
  habits: Record<string, boolean>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Habit {
  id: string;
  name: string;
  icon: string;
  color: string;
  frequency: "daily" | "weekday" | "weekly";
  streak: number;
  bestStreak: number;
  completedDates: string[];
  createdAt: number;
}

export interface DailyStats {
  averageMood: number;
  averageEnergy: number;
  topHabits: Array<{ name: string; rate: number }>;
  currentStreaks: Array<{ name: string; streak: number }>;
  totalEntries: number;
  consistency: number;
}

export interface WeekDay {
  date: string;
  entry: DailyEntry | null;
  isToday: boolean;
  habitCompletions: Record<string, boolean>;
}

export interface MonthDay {
  date: string;
  entry: DailyEntry | null;
  isToday: boolean;
  isCurrentMonth: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-daily-log";
const HABITS_KEY = "blade-daily-habits";

const DEFAULT_HABITS: Omit<Habit, "id" | "createdAt">[] = [
  { name: "Exercise", icon: "\u{1F3CB}", color: "#ef4444", frequency: "daily", streak: 0, bestStreak: 0, completedDates: [] },
  { name: "Reading", icon: "\u{1F4D6}", color: "#3b82f6", frequency: "daily", streak: 0, bestStreak: 0, completedDates: [] },
  { name: "Meditation", icon: "\u{1F9D8}", color: "#8b5cf6", frequency: "daily", streak: 0, bestStreak: 0, completedDates: [] },
  { name: "Coding", icon: "\u{1F4BB}", color: "#10b981", frequency: "weekday", streak: 0, bestStreak: 0, completedDates: [] },
  { name: "Learning", icon: "\u{1F4A1}", color: "#f59e0b", frequency: "daily", streak: 0, bestStreak: 0, completedDates: [] },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateAdd(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function createEmptyEntry(date: string): DailyEntry {
  return {
    id: genId(),
    date,
    mood: 3,
    energyLevel: 3,
    highlights: [],
    challenges: [],
    gratitude: [],
    notes: "",
    habits: {},
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function loadEntries(): DailyEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: DailyEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function loadHabits(): Habit[] {
  try {
    const raw = localStorage.getItem(HABITS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  // Seed defaults
  const defaults: Habit[] = DEFAULT_HABITS.map((h) => ({
    ...h,
    id: genId(),
    createdAt: Date.now(),
  }));
  localStorage.setItem(HABITS_KEY, JSON.stringify(defaults));
  return defaults;
}

function saveHabits(habits: Habit[]): void {
  localStorage.setItem(HABITS_KEY, JSON.stringify(habits));
}

function calcStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...dates].sort().reverse();
  const today = todayStr();
  const yesterday = dateAdd(today, -1);

  // Streak must include today or yesterday
  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const expected = dateAdd(sorted[i - 1], -1);
    if (sorted[i] === expected) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDailyLog() {
  const [entries, setEntries] = useState<DailyEntry[]>(loadEntries);
  const [habits, setHabits] = useState<Habit[]>(loadHabits);

  // Persist on change
  useEffect(() => { saveEntries(entries); }, [entries]);
  useEffect(() => { saveHabits(habits); }, [habits]);

  // ── Entry CRUD ───────────────────────────────────────────────────────────

  const getEntry = useCallback(
    (date: string): DailyEntry | null => {
      return entries.find((e) => e.date === date) ?? null;
    },
    [entries],
  );

  const today = useMemo((): DailyEntry => {
    const t = todayStr();
    const existing = entries.find((e) => e.date === t);
    if (existing) return existing;
    const fresh = createEmptyEntry(t);
    return fresh;
  }, [entries]);

  const addEntry = useCallback(
    (entry: Partial<DailyEntry> & { date: string }): DailyEntry => {
      const existing = entries.find((e) => e.date === entry.date);
      if (existing) {
        const updated = { ...existing, ...entry, updatedAt: Date.now() };
        setEntries((prev) => prev.map((e) => (e.date === entry.date ? updated : e)));
        return updated;
      }
      const fresh: DailyEntry = { ...createEmptyEntry(entry.date), ...entry };
      setEntries((prev) => [...prev, fresh]);
      return fresh;
    },
    [entries],
  );

  const updateEntry = useCallback(
    (date: string, patch: Partial<DailyEntry>): void => {
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.date === date);
        if (idx === -1) {
          // Auto-create
          return [...prev, { ...createEmptyEntry(date), ...patch }];
        }
        const updated = [...prev];
        updated[idx] = { ...updated[idx], ...patch, updatedAt: Date.now() };
        return updated;
      });
    },
    [],
  );

  // ── Habits ───────────────────────────────────────────────────────────────

  const addHabit = useCallback(
    (habit: Omit<Habit, "id" | "streak" | "bestStreak" | "completedDates" | "createdAt">): Habit => {
      const h: Habit = {
        ...habit,
        id: genId(),
        streak: 0,
        bestStreak: 0,
        completedDates: [],
        createdAt: Date.now(),
      };
      setHabits((prev) => [...prev, h]);
      return h;
    },
    [],
  );

  const removeHabit = useCallback((habitId: string): void => {
    setHabits((prev) => prev.filter((h) => h.id !== habitId));
  }, []);

  const toggleHabit = useCallback(
    (date: string, habitId: string): void => {
      setHabits((prev) =>
        prev.map((h) => {
          if (h.id !== habitId) return h;
          const completed = h.completedDates.includes(date);
          const newDates = completed
            ? h.completedDates.filter((d) => d !== date)
            : [...h.completedDates, date];
          const streak = calcStreak(newDates);
          return {
            ...h,
            completedDates: newDates,
            streak,
            bestStreak: Math.max(h.bestStreak, streak),
          };
        }),
      );

      // Also update the entry's habits map
      updateEntry(date, {
        habits: {
          ...(entries.find((e) => e.date === date)?.habits ?? {}),
          [habitId]: !entries.find((e) => e.date === date)?.habits?.[habitId],
        },
      });
    },
    [entries, updateEntry],
  );

  // ── Views ────────────────────────────────────────────────────────────────

  const getWeekView = useCallback(
    (refDate?: string): WeekDay[] => {
      const ref = refDate ?? todayStr();
      const monday = getMonday(ref);
      const todayDate = todayStr();
      const week: WeekDay[] = [];

      for (let i = 0; i < 7; i++) {
        const date = dateAdd(monday, i);
        const entry = entries.find((e) => e.date === date) ?? null;
        const habitCompletions: Record<string, boolean> = {};
        habits.forEach((h) => {
          habitCompletions[h.id] = h.completedDates.includes(date);
        });
        week.push({ date, entry, isToday: date === todayDate, habitCompletions });
      }
      return week;
    },
    [entries, habits],
  );

  const getMonthView = useCallback(
    (year?: number, month?: number): MonthDay[] => {
      const now = new Date();
      const y = year ?? now.getFullYear();
      const m = month ?? now.getMonth();
      const todayDate = todayStr();
      const total = daysInMonth(y, m);

      // Pad start of month to Monday
      const firstDay = new Date(y, m, 1).getDay();
      const padBefore = firstDay === 0 ? 6 : firstDay - 1;

      const days: MonthDay[] = [];

      for (let i = padBefore; i > 0; i--) {
        const d = new Date(y, m, 1 - i);
        const date = d.toISOString().slice(0, 10);
        days.push({ date, entry: entries.find((e) => e.date === date) ?? null, isToday: date === todayDate, isCurrentMonth: false });
      }

      for (let d = 1; d <= total; d++) {
        const date = new Date(y, m, d).toISOString().slice(0, 10);
        days.push({ date, entry: entries.find((e) => e.date === date) ?? null, isToday: date === todayDate, isCurrentMonth: true });
      }

      // Pad end to complete the week
      const remaining = 7 - (days.length % 7);
      if (remaining < 7) {
        for (let i = 1; i <= remaining; i++) {
          const d = new Date(y, m + 1, i);
          const date = d.toISOString().slice(0, 10);
          days.push({ date, entry: entries.find((e) => e.date === date) ?? null, isToday: date === todayDate, isCurrentMonth: false });
        }
      }

      return days;
    },
    [entries],
  );

  // ── Stats ────────────────────────────────────────────────────────────────

  const getStats = useCallback((): DailyStats => {
    const last30 = entries.filter((e) => {
      const cutoff = dateAdd(todayStr(), -30);
      return e.date >= cutoff;
    });

    const averageMood = last30.length > 0
      ? Math.round((last30.reduce((s, e) => s + e.mood, 0) / last30.length) * 10) / 10
      : 0;

    const averageEnergy = last30.length > 0
      ? Math.round((last30.reduce((s, e) => s + e.energyLevel, 0) / last30.length) * 10) / 10
      : 0;

    const topHabits = habits
      .map((h) => {
        const relevantDates = h.completedDates.filter((d) => d >= dateAdd(todayStr(), -30));
        return { name: h.name, rate: Math.round((relevantDates.length / 30) * 100) };
      })
      .sort((a, b) => b.rate - a.rate);

    const currentStreaks = habits
      .filter((h) => h.streak > 0)
      .map((h) => ({ name: h.name, streak: h.streak }))
      .sort((a, b) => b.streak - a.streak);

    const daysWithEntries = new Set(entries.map((e) => e.date)).size;
    const totalPossible = Math.min(30, Math.ceil((Date.now() - Math.min(...entries.map((e) => e.createdAt), Date.now())) / 86400000) + 1);
    const consistency = totalPossible > 0 ? Math.round((Math.min(daysWithEntries, totalPossible) / totalPossible) * 100) : 0;

    return { averageMood, averageEnergy, topHabits, currentStreaks, totalEntries: entries.length, consistency };
  }, [entries, habits]);

  // ── AI Insights ──────────────────────────────────────────────────────────

  const generateInsights = useCallback((): string => {
    const stats = getStats();
    const last30 = entries
      .filter((e) => e.date >= dateAdd(todayStr(), -30))
      .sort((a, b) => a.date.localeCompare(b.date));

    const moodTrend = last30.map((e) => `${e.date}: mood=${e.mood} energy=${e.energyLevel}`).join("\n");

    const habitSummary = habits
      .map((h) => {
        const rate = Math.round((h.completedDates.filter((d) => d >= dateAdd(todayStr(), -30)).length / 30) * 100);
        return `- ${h.name}: ${rate}% completion, streak: ${h.streak}, best: ${h.bestStreak}`;
      })
      .join("\n");

    const highlightsSummary = last30
      .filter((e) => e.highlights.length > 0)
      .map((e) => `${e.date}: ${e.highlights.join(", ")}`)
      .join("\n");

    const challengesSummary = last30
      .filter((e) => e.challenges.length > 0)
      .map((e) => `${e.date}: ${e.challenges.join(", ")}`)
      .join("\n");

    return [
      "Analyze my daily log data from the past 30 days and provide actionable insights.",
      "",
      `Overall: ${stats.totalEntries} entries, ${stats.consistency}% consistency`,
      `Average mood: ${stats.averageMood}/5, Average energy: ${stats.averageEnergy}/5`,
      "",
      "--- Mood & Energy Trends ---",
      moodTrend || "(no data)",
      "",
      "--- Habit Completion ---",
      habitSummary || "(no habits tracked)",
      "",
      "--- Highlights ---",
      highlightsSummary || "(none recorded)",
      "",
      "--- Challenges ---",
      challengesSummary || "(none recorded)",
      "",
      "Please identify:",
      "1. Patterns between mood/energy and habit completion",
      "2. Days or periods where I was most/least productive",
      "3. Suggestions for improving consistency",
      "4. Correlations between my highlights and challenges",
      "5. Specific actionable recommendations",
    ].join("\n");
  }, [entries, habits, getStats]);

  return {
    entries,
    habits,
    today,
    addEntry,
    updateEntry,
    getEntry,
    addHabit,
    removeHabit,
    toggleHabit,
    getWeekView,
    getMonthView,
    getStats,
    generateInsights,
  };
}
