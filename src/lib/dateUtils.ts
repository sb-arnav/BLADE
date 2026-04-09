/**
 * Date utilities for Blade using date-fns.
 * Centralizes all date formatting, parsing, and manipulation.
 */

import {
  format,
  formatDistanceToNow,
  formatDistance,
  isToday,
  isYesterday,
  isThisWeek,
  isThisMonth,
  isThisYear,
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
  endOfWeek,
  endOfMonth,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  differenceInSeconds,
  differenceInWeeks,
  differenceInMonths,
  isBefore,
  isAfter,
  isSameDay,
  parseISO,
  getDay,
  getHours,
  eachDayOfInterval,
  eachWeekOfInterval,
} from "date-fns";

// ── Smart relative time ─────────────────────────────────────────────────

/**
 * Format a timestamp as a smart relative string:
 * - "just now" (< 1 min)
 * - "5m ago" (< 1 hour)
 * - "2h ago" (< 24 hours)
 * - "Yesterday at 3:14 PM"
 * - "Monday at 3:14 PM" (this week)
 * - "Mar 12 at 3:14 PM" (this year)
 * - "Mar 12, 2024 at 3:14 PM" (older)
 */
export function smartRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffSec = differenceInSeconds(now, date);
  const diffMin = differenceInMinutes(now, date);
  const diffHr = differenceInHours(now, date);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24 && isToday(date)) return `${diffHr}h ago`;
  if (isYesterday(date)) return `Yesterday at ${format(date, "h:mm a")}`;
  if (isThisWeek(date)) return `${format(date, "EEEE")} at ${format(date, "h:mm a")}`;
  if (isThisYear(date)) return format(date, "MMM d") + ` at ${format(date, "h:mm a")}`;
  return format(date, "MMM d, yyyy") + ` at ${format(date, "h:mm a")}`;
}

/**
 * Compact relative time for sidebar/lists:
 * "now", "5m", "2h", "3d", "2w", "Mar 12"
 */
export function compactRelativeTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffSec = differenceInSeconds(now, date);
  const diffMin = differenceInMinutes(now, date);
  const diffHr = differenceInHours(now, date);
  const diffDay = differenceInDays(now, date);
  const diffWk = differenceInWeeks(now, date);

  if (diffSec < 60) return "now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHr < 24) return `${diffHr}h`;
  if (diffDay < 7) return `${diffDay}d`;
  if (diffWk < 5) return `${diffWk}w`;
  if (isThisYear(date)) return format(date, "MMM d");
  return format(date, "MMM d, yy");
}

// ── Date formatting ─────────────────────────────────────────────────────

export function formatDate(timestamp: number, fmt = "MMM d, yyyy"): string {
  return format(new Date(timestamp), fmt);
}

export function formatTime(timestamp: number): string {
  return format(new Date(timestamp), "h:mm a");
}

export function formatDateTime(timestamp: number): string {
  return format(new Date(timestamp), "MMM d, yyyy h:mm a");
}

export function formatISO(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function formatDateForInput(timestamp: number): string {
  return format(new Date(timestamp), "yyyy-MM-dd");
}

export function formatTimeForInput(timestamp: number): string {
  return format(new Date(timestamp), "HH:mm");
}

// ── Date grouping ───────────────────────────────────────────────────────

export type DateGroup = "today" | "yesterday" | "this-week" | "this-month" | "older";

export function getDateGroup(timestamp: number): DateGroup {
  const date = new Date(timestamp);
  if (isToday(date)) return "today";
  if (isYesterday(date)) return "yesterday";
  if (isThisWeek(date)) return "this-week";
  if (isThisMonth(date)) return "this-month";
  return "older";
}

export function getDateGroupLabel(group: DateGroup): string {
  const labels: Record<DateGroup, string> = {
    "today": "Today",
    "yesterday": "Yesterday",
    "this-week": "This Week",
    "this-month": "This Month",
    "older": "Older",
  };
  return labels[group];
}

export function groupByDate<T>(items: T[], getTimestamp: (item: T) => number): Map<DateGroup, T[]> {
  const groups = new Map<DateGroup, T[]>();
  const order: DateGroup[] = ["today", "yesterday", "this-week", "this-month", "older"];

  for (const group of order) {
    groups.set(group, []);
  }

  for (const item of items) {
    const group = getDateGroup(getTimestamp(item));
    groups.get(group)!.push(item);
  }

  // Remove empty groups
  for (const [key, value] of groups) {
    if (value.length === 0) groups.delete(key);
  }

  return groups;
}

// ── Date ranges ─────────────────────────────────────────────────────────

export interface DateRange {
  start: Date;
  end: Date;
  label: string;
}

export function getPresetRanges(): DateRange[] {
  const now = new Date();
  return [
    { start: startOfDay(now), end: endOfDay(now), label: "Today" },
    { start: startOfDay(subDays(now, 1)), end: endOfDay(subDays(now, 1)), label: "Yesterday" },
    { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }), label: "This Week" },
    { start: startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }), end: endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }), label: "Last Week" },
    { start: startOfMonth(now), end: endOfMonth(now), label: "This Month" },
    { start: startOfMonth(subMonths(now, 1)), end: endOfMonth(subMonths(now, 1)), label: "Last Month" },
    { start: subDays(now, 7), end: now, label: "Last 7 Days" },
    { start: subDays(now, 30), end: now, label: "Last 30 Days" },
    { start: subDays(now, 90), end: now, label: "Last 90 Days" },
    { start: new Date(now.getFullYear(), 0, 1), end: now, label: "This Year" },
  ];
}

export function isInRange(timestamp: number, range: DateRange): boolean {
  const date = new Date(timestamp);
  return !isBefore(date, range.start) && !isAfter(date, range.end);
}

// ── Calendar helpers ────────────────────────────────────────────────────

export function getCalendarDays(year: number, month: number): Date[] {
  const start = startOfWeek(new Date(year, month, 1), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(new Date(year, month, 1)), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export function getWeekDays(): string[] {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
}

export function getDayOfWeekName(date: Date): string {
  return format(date, "EEEE");
}

export function isWeekend(date: Date): boolean {
  const day = getDay(date);
  return day === 0 || day === 6;
}

export function isWorkHours(date: Date): boolean {
  const hours = getHours(date);
  return hours >= 9 && hours < 18 && !isWeekend(date);
}

// ── Streak calculation ──────────────────────────────────────────────────

export function calculateStreak(dates: string[]): number {
  if (dates.length === 0) return 0;

  const sorted = [...dates].sort().reverse();
  const today = formatDateForInput(Date.now());
  const yesterday = formatDateForInput(Date.now() - 86400000);

  // Must include today or yesterday
  if (sorted[0] !== today && sorted[0] !== yesterday) return 0;

  let streak = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseISO(sorted[i - 1]);
    const curr = parseISO(sorted[i]);
    if (differenceInDays(prev, curr) === 1) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

// ── Duration formatting ─────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

export function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  return `${Math.floor(ms / 3600000)}h`;
}

// ── Timestamps ──────────────────────────────────────────────────────────

export function now(): number {
  return Date.now();
}

export function todayString(): string {
  return formatDateForInput(Date.now());
}

export function timestampToDate(ts: number): Date {
  return new Date(ts);
}

// Re-export commonly used date-fns functions
export {
  format,
  formatDistanceToNow,
  formatDistance,
  isToday,
  isYesterday,
  isSameDay,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  differenceInDays,
  differenceInHours,
  differenceInMinutes,
  eachDayOfInterval,
  eachWeekOfInterval,
  parseISO,
  startOfDay,
  startOfWeek,
  startOfMonth,
  endOfDay,
};
