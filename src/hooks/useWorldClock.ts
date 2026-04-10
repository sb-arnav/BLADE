import { useState, useEffect, useCallback } from "react";

/**
 * World Clock — track time across timezones.
 * Useful for remote teams and scheduling across regions.
 */

export interface ClockEntry {
  id: string;
  timezone: string;
  label: string;
  city: string;
  country: string;
  offset: number;
  isPrimary: boolean;
  order: number;
}

export interface TimeInfo {
  time: string;
  date: string;
  dayOfWeek: string;
  offset: string;
  isDaytime: boolean;
  isToday: boolean;
  diffFromLocal: string;
}

const POPULAR_TIMEZONES = [
  { timezone: "America/New_York", city: "New York", country: "US", offset: -5 },
  { timezone: "America/Chicago", city: "Chicago", country: "US", offset: -6 },
  { timezone: "America/Denver", city: "Denver", country: "US", offset: -7 },
  { timezone: "America/Los_Angeles", city: "Los Angeles", country: "US", offset: -8 },
  { timezone: "America/Toronto", city: "Toronto", country: "CA", offset: -5 },
  { timezone: "America/Sao_Paulo", city: "São Paulo", country: "BR", offset: -3 },
  { timezone: "Europe/London", city: "London", country: "UK", offset: 0 },
  { timezone: "Europe/Paris", city: "Paris", country: "FR", offset: 1 },
  { timezone: "Europe/Berlin", city: "Berlin", country: "DE", offset: 1 },
  { timezone: "Europe/Amsterdam", city: "Amsterdam", country: "NL", offset: 1 },
  { timezone: "Europe/Moscow", city: "Moscow", country: "RU", offset: 3 },
  { timezone: "Asia/Dubai", city: "Dubai", country: "AE", offset: 4 },
  { timezone: "Asia/Kolkata", city: "Mumbai", country: "IN", offset: 5.5 },
  { timezone: "Asia/Dhaka", city: "Dhaka", country: "BD", offset: 6 },
  { timezone: "Asia/Bangkok", city: "Bangkok", country: "TH", offset: 7 },
  { timezone: "Asia/Singapore", city: "Singapore", country: "SG", offset: 8 },
  { timezone: "Asia/Shanghai", city: "Shanghai", country: "CN", offset: 8 },
  { timezone: "Asia/Hong_Kong", city: "Hong Kong", country: "HK", offset: 8 },
  { timezone: "Asia/Tokyo", city: "Tokyo", country: "JP", offset: 9 },
  { timezone: "Asia/Seoul", city: "Seoul", country: "KR", offset: 9 },
  { timezone: "Australia/Sydney", city: "Sydney", country: "AU", offset: 11 },
  { timezone: "Australia/Melbourne", city: "Melbourne", country: "AU", offset: 11 },
  { timezone: "Pacific/Auckland", city: "Auckland", country: "NZ", offset: 13 },
  { timezone: "Pacific/Honolulu", city: "Honolulu", country: "US", offset: -10 },
];

function getTimeInTimezone(timezone: string): { hours: number; minutes: number; seconds: number; date: Date } {
  try {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const tzDate = new Date(utc);

    // Use Intl to get accurate timezone offset
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: false,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    });

    const parts = formatter.formatToParts(now);
    const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);

    return {
      hours: get("hour"),
      minutes: get("minute"),
      seconds: get("second"),
      date: tzDate,
    };
  } catch {
    const now = new Date();
    return { hours: now.getHours(), minutes: now.getMinutes(), seconds: now.getSeconds(), date: now };
  }
}

function formatTimeInfo(timezone: string): TimeInfo {
  const now = new Date();

  try {
    const timeStr = now.toLocaleTimeString("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: true });
    const dateStr = now.toLocaleDateString("en-US", { timeZone: timezone, month: "short", day: "numeric" });
    const dayStr = now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "short" });
    const localDateStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const { hours } = getTimeInTimezone(timezone);
    const isDaytime = hours >= 6 && hours < 20;

    // Calculate offset string
    const tzFormatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "shortOffset" });
    const offsetPart = tzFormatter.formatToParts(now).find((p) => p.type === "timeZoneName")?.value || "";

    // Diff from local
    const remoteNow = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
    const localNow = new Date(now.toLocaleString("en-US"));
    const diffHours = (remoteNow.getTime() - localNow.getTime()) / 3600000;
    const diffStr = diffHours === 0 ? "same time" : diffHours > 0 ? `+${diffHours}h` : `${diffHours}h`;

    return {
      time: timeStr,
      date: dateStr,
      dayOfWeek: dayStr,
      offset: offsetPart,
      isDaytime,
      isToday: dateStr === localDateStr,
      diffFromLocal: diffStr,
    };
  } catch {
    return {
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      dayOfWeek: "",
      offset: "",
      isDaytime: true,
      isToday: true,
      diffFromLocal: "",
    };
  }
}

const STORAGE_KEY = "blade-world-clock";

function loadClocks(): ClockEntry[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) return saved;
  } catch {}

  // Default: local + a few popular cities
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [
    { id: "local", timezone: localTz, label: "Local", city: localTz.split("/").pop()?.replace("_", " ") || "Local", country: "", offset: 0, isPrimary: true, order: 0 },
    { id: "utc", timezone: "UTC", label: "UTC", city: "UTC", country: "", offset: 0, isPrimary: false, order: 1 },
    { id: "ny", timezone: "America/New_York", label: "New York", city: "New York", country: "US", offset: -5, isPrimary: false, order: 2 },
    { id: "ldn", timezone: "Europe/London", label: "London", city: "London", country: "UK", offset: 0, isPrimary: false, order: 3 },
    { id: "tyo", timezone: "Asia/Tokyo", label: "Tokyo", city: "Tokyo", country: "JP", offset: 9, isPrimary: false, order: 4 },
  ];
}

function saveClocks(clocks: ClockEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clocks));
}

export function useWorldClock() {
  const [clocks, setClocks] = useState<ClockEntry[]>(loadClocks);
  const [tick, setTick] = useState(0);

  // Tick every second
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const addClock = useCallback((timezone: string, label?: string) => {
    const match = POPULAR_TIMEZONES.find((tz) => tz.timezone === timezone);
    const entry: ClockEntry = {
      id: crypto.randomUUID(),
      timezone,
      label: label || match?.city || timezone.split("/").pop()?.replace("_", " ") || timezone,
      city: match?.city || timezone.split("/").pop()?.replace("_", " ") || "",
      country: match?.country || "",
      offset: match?.offset || 0,
      isPrimary: false,
      order: clocks.length,
    };
    setClocks((prev) => {
      const next = [...prev, entry];
      saveClocks(next);
      return next;
    });
  }, [clocks]);

  const removeClock = useCallback((id: string) => {
    setClocks((prev) => {
      const next = prev.filter((c) => c.id !== id);
      saveClocks(next);
      return next;
    });
  }, []);

  const reorderClocks = useCallback((fromIndex: number, toIndex: number) => {
    setClocks((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      next.forEach((c, i) => { c.order = i; });
      saveClocks(next);
      return next;
    });
  }, []);

  const setPrimary = useCallback((id: string) => {
    setClocks((prev) => {
      const next = prev.map((c) => ({ ...c, isPrimary: c.id === id }));
      saveClocks(next);
      return next;
    });
  }, []);

  // Get current time info for each clock
  const clockTimes = clocks.map((clock) => ({
    clock,
    info: formatTimeInfo(clock.timezone),
  }));

  // Use tick to force re-render but void it to avoid unused warning
  void tick;

  // Find best meeting time across all timezones (9am-5pm overlap)
  const findMeetingTime = useCallback((): { hour: number; overlap: number; zones: string[] } | null => {
    let bestHour = -1;
    let bestOverlap = 0;

    for (let utcHour = 0; utcHour < 24; utcHour++) {
      const inWorkHours = clocks.filter((clock) => {
        const localHour = (utcHour + clock.offset + 24) % 24;
        return localHour >= 9 && localHour < 17;
      });

      if (inWorkHours.length > bestOverlap) {
        bestOverlap = inWorkHours.length;
        bestHour = utcHour;
      }
    }

    if (bestHour < 0) return null;

    return {
      hour: bestHour,
      overlap: bestOverlap,
      zones: clocks
        .filter((c) => {
          const h = (bestHour + c.offset + 24) % 24;
          return h >= 9 && h < 17;
        })
        .map((c) => c.label),
    };
  }, [clocks]);

  return {
    clocks: clockTimes,
    addClock,
    removeClock,
    reorderClocks,
    setPrimary,
    findMeetingTime,
    popularTimezones: POPULAR_TIMEZONES,
  };
}
