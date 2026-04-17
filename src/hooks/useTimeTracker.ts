import { useState, useCallback, useMemo, useEffect, useRef } from "react";

/**
 * Time & Expense Tracker — Track time spent on tasks, AI usage costs, and project expenses.
 *
 * Built because developers said:
 * "I have no idea how much time I spend on each project"
 * "AI costs sneak up — need them tied to actual work"
 *
 * Timer with start/stop/pause, manual entries, project budgets,
 * weekly/monthly reporting, CSV export, AI cost integration.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface TimeEntry {
  id: string;
  project: string;
  task: string;
  startTime: number;
  endTime: number | null;
  duration: number;
  tags: string[];
  notes: string;
  billable: boolean;
  rate: number;
  aiTokensUsed: number;
  aiCost: number;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  totalTime: number;
  totalCost: number;
  budget: number | null;
  client: string;
  active: boolean;
}

export interface TimeStats {
  todayTotal: number;
  weekTotal: number;
  monthTotal: number;
  topProjects: Array<{ name: string; time: number; percentage: number }>;
  dailyAverage: number;
  aiCostTotal: number;
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  days: Array<{
    date: string;
    dayLabel: string;
    totalTime: number;
    entries: TimeEntry[];
    projectBreakdown: Array<{ project: string; color: string; time: number }>;
  }>;
  totalTime: number;
  totalBillable: number;
  totalAiCost: number;
  projectTotals: Array<{ name: string; color: string; time: number; cost: number }>;
}

export interface ProjectReport {
  project: Project;
  entries: TimeEntry[];
  totalTime: number;
  billableTime: number;
  totalCost: number;
  aiCost: number;
  budgetUsed: number | null;
  averageDaily: number;
}

interface ActiveTimer {
  entryId: string;
  project: string;
  task: string;
  startTime: number;
  pausedAt: number | null;
  pausedDuration: number;
  elapsed: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-time-tracker";

const DEFAULT_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function weekStartStr(date?: Date): string {
  const d = date ?? new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().slice(0, 10);
}

function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function dateToStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

function dateAdd(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatHours(ms: number): string {
  return (ms / 3600000).toFixed(1) + "h";
}

// ── Persistence ──────────────────────────────────────────────────────────────

interface StoredState {
  entries: TimeEntry[];
  projects: Project[];
  activeTimer: ActiveTimer | null;
}

function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { entries: [], projects: [], activeTimer: null };
}

function saveState(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useTimeTracker() {
  const initial = useMemo(() => loadState(), []);
  const [entries, setEntries] = useState<TimeEntry[]>(initial.entries);
  const [projects, setProjects] = useState<Project[]>(initial.projects);
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(initial.activeTimer);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Persist on change
  useEffect(() => {
    saveState({ entries, projects, activeTimer });
  }, [entries, projects, activeTimer]);

  // Live tick for active timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (activeTimer && !activeTimer.pausedAt) {
      timerRef.current = setInterval(() => {
        setActiveTimer((prev) => {
          if (!prev || prev.pausedAt) return prev;
          return { ...prev, elapsed: Date.now() - prev.startTime - prev.pausedDuration };
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeTimer?.entryId, activeTimer?.pausedAt]);

  // ── Timer actions ────────────────────────────────────────────────────────

  const startTimer = useCallback((project: string, task: string) => {
    const id = uid();
    const now = Date.now();
    setActiveTimer({
      entryId: id,
      project,
      task,
      startTime: now,
      pausedAt: null,
      pausedDuration: 0,
      elapsed: 0,
    });
  }, []);

  const pauseTimer = useCallback(() => {
    setActiveTimer((prev) => {
      if (!prev || prev.pausedAt) return prev;
      return { ...prev, pausedAt: Date.now() };
    });
  }, []);

  const resumeTimer = useCallback(() => {
    setActiveTimer((prev) => {
      if (!prev || !prev.pausedAt) return prev;
      const additionalPause = Date.now() - prev.pausedAt;
      return {
        ...prev,
        pausedAt: null,
        pausedDuration: prev.pausedDuration + additionalPause,
      };
    });
  }, []);

  const stopTimer = useCallback(() => {
    setActiveTimer((prev) => {
      if (!prev) return null;
      const now = Date.now();
      let duration = now - prev.startTime - prev.pausedDuration;
      if (prev.pausedAt) {
        duration -= (now - prev.pausedAt);
      }
      const entry: TimeEntry = {
        id: prev.entryId,
        project: prev.project,
        task: prev.task,
        startTime: prev.startTime,
        endTime: now,
        duration: Math.max(0, duration),
        tags: [],
        notes: "",
        billable: true,
        rate: 0,
        aiTokensUsed: 0,
        aiCost: 0,
      };
      setEntries((e) => [entry, ...e]);
      // Update project totals
      setProjects((ps) =>
        ps.map((p) =>
          p.id === prev.project || p.name === prev.project
            ? { ...p, totalTime: p.totalTime + entry.duration }
            : p
        )
      );
      return null;
    });
  }, []);

  // ── Entry CRUD ───────────────────────────────────────────────────────────

  const addManualEntry = useCallback((data: {
    project: string;
    task: string;
    startTime: number;
    endTime: number;
    notes?: string;
    tags?: string[];
    billable?: boolean;
    rate?: number;
    aiTokensUsed?: number;
    aiCost?: number;
  }) => {
    const entry: TimeEntry = {
      id: uid(),
      project: data.project,
      task: data.task,
      startTime: data.startTime,
      endTime: data.endTime,
      duration: data.endTime - data.startTime,
      tags: data.tags ?? [],
      notes: data.notes ?? "",
      billable: data.billable ?? true,
      rate: data.rate ?? 0,
      aiTokensUsed: data.aiTokensUsed ?? 0,
      aiCost: data.aiCost ?? 0,
    };
    setEntries((e) => [entry, ...e]);
    setProjects((ps) =>
      ps.map((p) =>
        p.id === data.project || p.name === data.project
          ? { ...p, totalTime: p.totalTime + entry.duration }
          : p
      )
    );
  }, []);

  const updateEntry = useCallback((id: string, updates: Partial<TimeEntry>) => {
    setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setEntries((es) => {
      const target = es.find((e) => e.id === id);
      if (target) {
        setProjects((ps) =>
          ps.map((p) =>
            p.id === target.project || p.name === target.project
              ? { ...p, totalTime: Math.max(0, p.totalTime - target.duration) }
              : p
          )
        );
      }
      return es.filter((e) => e.id !== id);
    });
  }, []);

  // ── Project CRUD ─────────────────────────────────────────────────────────

  const addProject = useCallback((data: { name: string; color?: string; budget?: number | null; client?: string }) => {
    const project: Project = {
      id: uid(),
      name: data.name,
      color: data.color ?? DEFAULT_COLORS[projects.length % DEFAULT_COLORS.length],
      totalTime: 0,
      totalCost: 0,
      budget: data.budget ?? null,
      client: data.client ?? "",
      active: true,
    };
    setProjects((ps) => [...ps, project]);
    return project;
  }, [projects.length]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects((ps) => ps.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  // ── Stats ────────────────────────────────────────────────────────────────

  const getStats = useCallback((): TimeStats => {
    const today = todayStr();
    const weekStart = weekStartStr();
    const monthStart = monthStartStr();

    const todayEntries = entries.filter((e) => dateToStr(e.startTime) === today);
    const weekEntries = entries.filter((e) => dateToStr(e.startTime) >= weekStart);
    const monthEntries = entries.filter((e) => dateToStr(e.startTime) >= monthStart);

    const todayTotal = todayEntries.reduce((s, e) => s + e.duration, 0);
    const weekTotal = weekEntries.reduce((s, e) => s + e.duration, 0);
    const monthTotal = monthEntries.reduce((s, e) => s + e.duration, 0);
    const aiCostTotal = entries.reduce((s, e) => s + e.aiCost, 0);

    // Top projects
    const projectMap = new Map<string, number>();
    for (const e of entries) {
      projectMap.set(e.project, (projectMap.get(e.project) ?? 0) + e.duration);
    }
    const totalAll = entries.reduce((s, e) => s + e.duration, 0) || 1;
    const topProjects = Array.from(projectMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, time]) => ({
        name,
        time,
        percentage: Math.round((time / totalAll) * 100),
      }));

    // Daily average (last 30 days)
    const daysSet = new Set(entries.map((e) => dateToStr(e.startTime)));
    const dailyAverage = daysSet.size > 0 ? totalAll / daysSet.size : 0;

    return { todayTotal, weekTotal, monthTotal, topProjects, dailyAverage, aiCostTotal };
  }, [entries]);

  // ── Reports ──────────────────────────────────────────────────────────────

  const getWeeklyReport = useCallback((weekOf?: Date): WeeklyReport => {
    const ws = weekStartStr(weekOf);
    const we = dateAdd(ws, 6);
    const days: WeeklyReport["days"] = [];

    for (let i = 0; i < 7; i++) {
      const date = dateAdd(ws, i);
      const dayEntries = entries.filter((e) => dateToStr(e.startTime) === date);
      const totalTime = dayEntries.reduce((s, e) => s + e.duration, 0);

      // Project breakdown per day
      const pMap = new Map<string, number>();
      for (const e of dayEntries) pMap.set(e.project, (pMap.get(e.project) ?? 0) + e.duration);
      const projectBreakdown = Array.from(pMap.entries()).map(([project, time]) => {
        const p = projects.find((pr) => pr.id === project || pr.name === project);
        return { project, color: p?.color ?? "#6b7280", time };
      });

      days.push({ date, dayLabel: dayLabel(date), totalTime, entries: dayEntries, projectBreakdown });
    }

    const weekEntries = entries.filter((e) => dateToStr(e.startTime) >= ws && dateToStr(e.startTime) <= we);
    const totalTime = weekEntries.reduce((s, e) => s + e.duration, 0);
    const totalBillable = weekEntries.filter((e) => e.billable).reduce((s, e) => s + e.duration, 0);
    const totalAiCost = weekEntries.reduce((s, e) => s + e.aiCost, 0);

    const ptMap = new Map<string, { time: number; cost: number }>();
    for (const e of weekEntries) {
      const cur = ptMap.get(e.project) ?? { time: 0, cost: 0 };
      ptMap.set(e.project, { time: cur.time + e.duration, cost: cur.cost + e.aiCost });
    }
    const projectTotals = Array.from(ptMap.entries()).map(([name, val]) => {
      const p = projects.find((pr) => pr.id === name || pr.name === name);
      return { name, color: p?.color ?? "#6b7280", ...val };
    });

    return { weekStart: ws, weekEnd: we, days, totalTime, totalBillable, totalAiCost, projectTotals };
  }, [entries, projects]);

  const getProjectReport = useCallback((projectId: string): ProjectReport | null => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return null;

    const pEntries = entries.filter((e) => e.project === projectId || e.project === project.name);
    const totalTime = pEntries.reduce((s, e) => s + e.duration, 0);
    const billableTime = pEntries.filter((e) => e.billable).reduce((s, e) => s + e.duration, 0);
    const totalCost = pEntries.reduce((s, e) => s + (e.duration / 3600000) * e.rate, 0);
    const aiCost = pEntries.reduce((s, e) => s + e.aiCost, 0);
    const budgetUsed = project.budget ? (totalCost / project.budget) * 100 : null;
    const daysSet = new Set(pEntries.map((e) => dateToStr(e.startTime)));
    const averageDaily = daysSet.size > 0 ? totalTime / daysSet.size : 0;

    return { project, entries: pEntries, totalTime, billableTime, totalCost, aiCost, budgetUsed, averageDaily };
  }, [entries, projects]);

  // ── Export ───────────────────────────────────────────────────────────────

  const exportTimesheet = useCallback((dateFrom?: string, dateTo?: string): string => {
    let filtered = entries;
    if (dateFrom) filtered = filtered.filter((e) => dateToStr(e.startTime) >= dateFrom);
    if (dateTo) filtered = filtered.filter((e) => dateToStr(e.startTime) <= dateTo);

    const header = "Date,Project,Task,Start,End,Duration (h),Billable,Rate,AI Tokens,AI Cost ($),Notes";
    const rows = filtered.map((e) => {
      const date = dateToStr(e.startTime);
      const start = new Date(e.startTime).toLocaleTimeString();
      const end = e.endTime ? new Date(e.endTime).toLocaleTimeString() : "";
      const hours = (e.duration / 3600000).toFixed(2);
      const proj = projects.find((p) => p.id === e.project)?.name ?? e.project;
      const notes = e.notes.replace(/,/g, ";").replace(/\n/g, " ");
      return `${date},"${proj}","${e.task}",${start},${end},${hours},${e.billable},${e.rate},${e.aiTokensUsed},${e.aiCost.toFixed(4)},"${notes}"`;
    });

    return [header, ...rows].join("\n");
  }, [entries, projects]);

  return {
    entries,
    projects,
    activeTimer,
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    addManualEntry,
    updateEntry,
    deleteEntry,
    addProject,
    updateProject,
    getStats,
    getWeeklyReport,
    getProjectReport,
    exportTimesheet,
    formatDuration,
    formatHours,
  };
}

export { formatDuration, formatHours, DEFAULT_COLORS };
