import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface TimelineEntry {
  id: number;
  timestamp: number;
  screenshot_path: string;
  thumbnail_path: string;
  window_title: string;
  app_name: string;
  description: string;
  fingerprint: number;
}

export interface TimelineConfig {
  enabled: boolean;
  capture_interval_secs: number;
  retention_days: number;
}

export interface TimelineStats {
  total_entries: number;
  disk_bytes: number;
  oldest_timestamp: number | null;
  newest_timestamp: number | null;
}

export function useScreenTimeline() {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [config, setConfig] = useState<TimelineConfig | null>(null);
  const [stats, setStats] = useState<TimelineStats | null>(null);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const PAGE_SIZE = 24;

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await invoke<TimelineConfig>("timeline_get_config");
      setConfig(cfg);
    } catch (e) {
      console.error("[timeline] loadConfig:", e);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const s = await invoke<TimelineStats>("timeline_get_stats_cmd");
      setStats(s);
    } catch (e) {
      console.error("[timeline] loadStats:", e);
    }
  }, []);

  const browse = useCallback(async (reset = false) => {
    const currentOffset = reset ? 0 : offset;
    try {
      const results = await invoke<TimelineEntry[]>("timeline_browse_cmd", {
        date: selectedDate,
        offset: currentOffset,
        limit: PAGE_SIZE,
      });
      if (reset) {
        setEntries(results);
        setOffset(PAGE_SIZE);
      } else {
        setEntries((prev) => [...prev, ...results]);
        setOffset(currentOffset + PAGE_SIZE);
      }
      setHasMore(results.length === PAGE_SIZE);
    } catch (e) {
      console.error("[timeline] browse:", e);
    }
  }, [offset, selectedDate]);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      browse(true);
      return;
    }
    setIsSearching(true);
    try {
      const results = await invoke<TimelineEntry[]>("timeline_search_cmd", {
        query,
        limit: 20,
      });
      setEntries(results);
      setHasMore(false);
    } catch (e) {
      console.error("[timeline] search:", e);
    } finally {
      setIsSearching(false);
    }
  }, [browse]);

  const updateConfig = useCallback(async (changes: Partial<TimelineConfig>) => {
    try {
      const updated = await invoke<TimelineConfig>("timeline_set_config", {
        enabled: changes.enabled,
        captureIntervalSecs: changes.capture_interval_secs,
        retentionDays: changes.retention_days,
      });
      setConfig(updated);
    } catch (e) {
      console.error("[timeline] updateConfig:", e);
    }
  }, []);

  const getThumbnail = useCallback(async (id: number): Promise<string> => {
    return invoke<string>("timeline_get_thumbnail", { id });
  }, []);

  const getScreenshot = useCallback(async (id: number): Promise<string> => {
    return invoke<string>("timeline_get_screenshot", { id });
  }, []);

  // Load on mount
  useEffect(() => {
    loadConfig();
    loadStats();
    browse(true);
  }, []);

  // Re-browse when date changes
  useEffect(() => {
    if (searchQuery.trim() === "") {
      browse(true);
    }
  }, [selectedDate]);

  // Listen for real-time captures
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen<{ id: number; timestamp: number; window_title: string; app_name: string }>(
      "timeline_tick",
      (event) => {
        const { id, timestamp, window_title, app_name } = event.payload;
        // Prepend a placeholder entry (description populated async)
        const placeholder: TimelineEntry = {
          id,
          timestamp,
          screenshot_path: "",
          thumbnail_path: "",
          window_title,
          app_name,
          description: "",
          fingerprint: 0,
        };
        setEntries((prev) => {
          // Avoid duplicates
          if (prev.some((e) => e.id === id)) return prev;
          return [placeholder, ...prev];
        });
        loadStats();
      }
    ).then((fn) => {
      unlisten = fn;
    });
    return () => { unlisten?.(); };
  }, [loadStats]);

  return {
    entries,
    searchQuery,
    setSearchQuery,
    isSearching,
    search,
    selectedDate,
    setSelectedDate,
    config,
    updateConfig,
    stats,
    loadStats,
    browse,
    hasMore,
    loadMore: () => browse(false),
    getThumbnail,
    getScreenshot,
  };
}
