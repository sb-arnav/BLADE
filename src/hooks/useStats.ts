import { useState, useCallback } from "react";

export interface BladeStats {
  totalMessages: number;
  totalConversations: number;
  streakDays: number;
  lastActiveDate: string;
  messagesThisWeek: number;
  weekStart: string;
}

const STORAGE_KEY = "blade-stats";

const defaultStats: BladeStats = {
  totalMessages: 0,
  totalConversations: 0,
  streakDays: 0,
  lastActiveDate: "",
  messagesThisWeek: 0,
  weekStart: "",
};

function getToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getMonday(date: string): string {
  const d = new Date(date + "T00:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadStats(): BladeStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...defaultStats, ...JSON.parse(raw) };
    }
  } catch {
    // ignore corrupt data
  }
  return { ...defaultStats };
}

function saveStats(stats: BladeStats): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
}

function daysBetween(a: string, b: string): number {
  const msA = new Date(a + "T00:00:00").getTime();
  const msB = new Date(b + "T00:00:00").getTime();
  return Math.round((msB - msA) / (1000 * 60 * 60 * 24));
}

export function useStats() {
  const [stats, setStats] = useState<BladeStats>(loadStats);

  const recordMessage = useCallback(() => {
    setStats((prev) => {
      const today = getToday();
      const monday = getMonday(today);
      const next = { ...prev };

      next.totalMessages += 1;

      // Streak logic
      if (!prev.lastActiveDate) {
        next.streakDays = 1;
      } else if (prev.lastActiveDate === today) {
        // Same day, streak unchanged
      } else {
        const gap = daysBetween(prev.lastActiveDate, today);
        next.streakDays = gap === 1 ? prev.streakDays + 1 : 1;
      }

      // Weekly count
      if (prev.weekStart === monday) {
        next.messagesThisWeek += 1;
      } else {
        next.messagesThisWeek = 1;
        next.weekStart = monday;
      }

      next.lastActiveDate = today;

      saveStats(next);
      return next;
    });
  }, []);

  return { stats, recordMessage };
}
