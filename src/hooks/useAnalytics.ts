import { useState, useCallback, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnalyticsEvent {
  type:
    | "message_sent"
    | "message_received"
    | "voice_used"
    | "screenshot_taken"
    | "tool_executed"
    | "template_used"
    | "slash_command";
  timestamp: number;
  metadata?: Record<string, string | number>;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  messagesSent: number;
  messagesReceived: number;
  avgResponseTime: number;
  voiceInputs: number;
  screenshots: number;
  toolCalls: number;
}

export interface AnalyticsSummary {
  totalMessages: number;
  totalConversations: number;
  averageResponseTime: number;
  mostActiveHour: number; // 0-23
  mostActiveDay: string; // "Monday" etc
  topProvider: string;
  longestStreak: number;
  currentStreak: number;
  dailyStats: DailyStats[]; // Last 30 days
  hourlyDistribution: number[]; // 24 slots
  weeklyTrend: number[]; // Last 4 weeks message counts
  favoriteSlashCommands: { command: string; count: number }[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-analytics";
const RETENTION_DAYS = 30;
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayStr(): string {
  return formatDate(new Date());
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function cutoffTimestamp(): number {
  return daysAgo(RETENTION_DAYS).getTime();
}

function loadEvents(): AnalyticsEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as AnalyticsEvent[];
  } catch {
    return [];
  }
}

function saveEvents(events: AnalyticsEvent[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function pruneOldEvents(events: AnalyticsEvent[]): AnalyticsEvent[] {
  const cutoff = cutoffTimestamp();
  return events.filter((e) => e.timestamp >= cutoff);
}

// ── Build the last 30 day date list ─────────────────────────────────────────

function buildLast30Days(): string[] {
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(formatDate(daysAgo(i)));
  }
  return days;
}

// ── Compute daily stats from events ─────────────────────────────────────────

function computeDailyStats(events: AnalyticsEvent[]): DailyStats[] {
  const days = buildLast30Days();
  const buckets = new Map<string, AnalyticsEvent[]>();
  for (const day of days) {
    buckets.set(day, []);
  }

  for (const ev of events) {
    const dateKey = formatDate(new Date(ev.timestamp));
    const bucket = buckets.get(dateKey);
    if (bucket) {
      bucket.push(ev);
    }
  }

  return days.map((date) => {
    const dayEvents = buckets.get(date) || [];

    const messagesSent = dayEvents.filter(
      (e) => e.type === "message_sent"
    ).length;
    const messagesReceived = dayEvents.filter(
      (e) => e.type === "message_received"
    ).length;
    const voiceInputs = dayEvents.filter(
      (e) => e.type === "voice_used"
    ).length;
    const screenshots = dayEvents.filter(
      (e) => e.type === "screenshot_taken"
    ).length;
    const toolCalls = dayEvents.filter(
      (e) => e.type === "tool_executed"
    ).length;

    // Average response time from metadata
    const responseTimes = dayEvents
      .filter(
        (e) =>
          e.type === "message_received" &&
          e.metadata?.responseTimeMs !== undefined
      )
      .map((e) => Number(e.metadata!.responseTimeMs));
    const avgResponseTime =
      responseTimes.length > 0
        ? Math.round(
            responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
          )
        : 0;

    return {
      date,
      messagesSent,
      messagesReceived,
      avgResponseTime,
      voiceInputs,
      screenshots,
      toolCalls,
    };
  });
}

// ── Compute hourly distribution ─────────────────────────────────────────────

function computeHourlyDistribution(events: AnalyticsEvent[]): number[] {
  const hours = new Array(24).fill(0);
  for (const ev of events) {
    const hour = new Date(ev.timestamp).getHours();
    hours[hour]++;
  }
  return hours;
}

// ── Compute weekly trend (last 4 weeks) ─────────────────────────────────────

function computeWeeklyTrend(events: AnalyticsEvent[]): number[] {
  const weeks: number[] = [0, 0, 0, 0];
  const now = new Date();
  now.setHours(23, 59, 59, 999);

  for (const ev of events) {
    const daysAgoVal = Math.floor(
      (now.getTime() - ev.timestamp) / (1000 * 60 * 60 * 24)
    );
    if (daysAgoVal < 7) {
      weeks[3]++;
    } else if (daysAgoVal < 14) {
      weeks[2]++;
    } else if (daysAgoVal < 21) {
      weeks[1]++;
    } else if (daysAgoVal < 28) {
      weeks[0]++;
    }
  }
  return weeks;
}

// ── Compute most active hour ────────────────────────────────────────────────

function computeMostActiveHour(hourly: number[]): number {
  let maxIdx = 0;
  let maxVal = 0;
  for (let i = 0; i < 24; i++) {
    if (hourly[i] > maxVal) {
      maxVal = hourly[i];
      maxIdx = i;
    }
  }
  return maxIdx;
}

// ── Compute most active day of week ─────────────────────────────────────────

function computeMostActiveDay(events: AnalyticsEvent[]): string {
  const dayCounts = new Array(7).fill(0);
  for (const ev of events) {
    const dayOfWeek = new Date(ev.timestamp).getDay();
    dayCounts[dayOfWeek]++;
  }
  let maxIdx = 0;
  let maxVal = 0;
  for (let i = 0; i < 7; i++) {
    if (dayCounts[i] > maxVal) {
      maxVal = dayCounts[i];
      maxIdx = i;
    }
  }
  return DAY_NAMES[maxIdx];
}

// ── Compute top provider ────────────────────────────────────────────────────

function computeTopProvider(events: AnalyticsEvent[]): string {
  const providerCounts = new Map<string, number>();
  for (const ev of events) {
    if (ev.metadata?.provider) {
      const p = String(ev.metadata.provider);
      providerCounts.set(p, (providerCounts.get(p) || 0) + 1);
    }
  }
  if (providerCounts.size === 0) return "N/A";
  let topProvider = "";
  let topCount = 0;
  for (const [provider, count] of providerCounts) {
    if (count > topCount) {
      topCount = count;
      topProvider = provider;
    }
  }
  return topProvider;
}

// ── Compute streaks ─────────────────────────────────────────────────────────

function computeStreaks(events: AnalyticsEvent[]): {
  longest: number;
  current: number;
} {
  if (events.length === 0) return { longest: 0, current: 0 };

  // Collect unique active dates
  const activeDates = new Set<string>();
  for (const ev of events) {
    if (ev.type === "message_sent" || ev.type === "message_received") {
      activeDates.add(formatDate(new Date(ev.timestamp)));
    }
  }

  if (activeDates.size === 0) return { longest: 0, current: 0 };

  const sortedDates = Array.from(activeDates).sort();
  let longest = 1;
  let currentRun = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1] + "T00:00:00");
    const curr = new Date(sortedDates[i] + "T00:00:00");
    const diffDays = Math.round(
      (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 1) {
      currentRun++;
    } else {
      currentRun = 1;
    }

    if (currentRun > longest) {
      longest = currentRun;
    }
  }

  // Check if current streak is still active (last active date is today or yesterday)
  const today = todayStr();
  const yesterday = formatDate(daysAgo(1));
  const lastDate = sortedDates[sortedDates.length - 1];

  let currentStreak = 0;
  if (lastDate === today || lastDate === yesterday) {
    currentStreak = 1;
    for (let i = sortedDates.length - 2; i >= 0; i--) {
      const prev = new Date(sortedDates[i] + "T00:00:00");
      const curr = new Date(sortedDates[i + 1] + "T00:00:00");
      const diffDays = Math.round(
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  return { longest, current: currentStreak };
}

// ── Compute favorite slash commands ─────────────────────────────────────────

function computeFavoriteSlashCommands(
  events: AnalyticsEvent[]
): { command: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const ev of events) {
    if (ev.type === "slash_command" && ev.metadata?.command) {
      const cmd = String(ev.metadata.command);
      counts.set(cmd, (counts.get(cmd) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([command, count]) => ({ command, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// ── Compute conversation count estimate ─────────────────────────────────────

function estimateConversations(events: AnalyticsEvent[]): number {
  // A "conversation" is a cluster of messages with < 30 min gap between them
  const messageTimes = events
    .filter((e) => e.type === "message_sent" || e.type === "message_received")
    .map((e) => e.timestamp)
    .sort((a, b) => a - b);

  if (messageTimes.length === 0) return 0;

  let conversations = 1;
  const GAP_MS = 30 * 60 * 1000; // 30 minutes

  for (let i = 1; i < messageTimes.length; i++) {
    if (messageTimes[i] - messageTimes[i - 1] > GAP_MS) {
      conversations++;
    }
  }

  return conversations;
}

// ── Compute average response time ───────────────────────────────────────────

function computeAverageResponseTime(events: AnalyticsEvent[]): number {
  const responseTimes = events
    .filter(
      (e) =>
        e.type === "message_received" &&
        e.metadata?.responseTimeMs !== undefined
    )
    .map((e) => Number(e.metadata!.responseTimeMs));

  if (responseTimes.length === 0) return 0;
  return Math.round(
    responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
  );
}

// ── Build full summary ──────────────────────────────────────────────────────

function buildSummary(events: AnalyticsEvent[]): AnalyticsSummary {
  const dailyStats = computeDailyStats(events);
  const hourlyDistribution = computeHourlyDistribution(events);
  const weeklyTrend = computeWeeklyTrend(events);
  const streaks = computeStreaks(events);

  const totalMessages = events.filter(
    (e) => e.type === "message_sent" || e.type === "message_received"
  ).length;

  return {
    totalMessages,
    totalConversations: estimateConversations(events),
    averageResponseTime: computeAverageResponseTime(events),
    mostActiveHour: computeMostActiveHour(hourlyDistribution),
    mostActiveDay: computeMostActiveDay(events),
    topProvider: computeTopProvider(events),
    longestStreak: streaks.longest,
    currentStreak: streaks.current,
    dailyStats,
    hourlyDistribution,
    weeklyTrend,
    favoriteSlashCommands: computeFavoriteSlashCommands(events),
  };
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalytics() {
  const [events, setEvents] = useState<AnalyticsEvent[]>(() =>
    pruneOldEvents(loadEvents())
  );

  const trackEvent = useCallback(
    (
      type: AnalyticsEvent["type"],
      metadata?: Record<string, string | number>
    ) => {
      setEvents((prev) => {
        const newEvent: AnalyticsEvent = {
          type,
          timestamp: Date.now(),
          metadata,
        };
        const updated = pruneOldEvents([...prev, newEvent]);
        saveEvents(updated);
        return updated;
      });
    },
    []
  );

  const summary = useMemo<AnalyticsSummary>(
    () => buildSummary(events),
    [events]
  );

  const dailyStats = useMemo<DailyStats[]>(
    () => summary.dailyStats,
    [summary]
  );

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setEvents([]);
  }, []);

  return { trackEvent, summary, dailyStats, reset };
}
