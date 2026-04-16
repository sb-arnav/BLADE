import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface ActivityItem {
  id: string;
  type: "message" | "conversation" | "knowledge" | "agent" | "tool" | "voice" | "screenshot" | "template" | "workflow" | "setting" | "pulse" | "briefing" | "god_mode" | "window_switch";
  action: string;
  detail: string;
  timestamp: number;
  metadata?: Record<string, string>;
}

const TYPE_ICONS: Record<ActivityItem["type"], string> = {
  message: "💬",
  conversation: "📝",
  knowledge: "🧠",
  agent: "🤖",
  tool: "🔧",
  voice: "🎤",
  screenshot: "📸",
  template: "📋",
  workflow: "⚡",
  setting: "⚙️",
  pulse: "⚡",
  briefing: "🌅",
  god_mode: "👁",
  window_switch: "🖥",
};

const TYPE_COLORS: Record<ActivityItem["type"], string> = {
  message: "bg-blue-500",
  conversation: "bg-emerald-500",
  knowledge: "bg-violet-500",
  agent: "bg-blade-accent",
  tool: "bg-amber-500",
  voice: "bg-red-500",
  screenshot: "bg-cyan-500",
  template: "bg-pink-500",
  workflow: "bg-orange-500",
  setting: "bg-[rgba(255,255,255,0.04)]",
  pulse: "bg-indigo-400",
  briefing: "bg-amber-400",
  god_mode: "bg-[rgba(255,255,255,0.04)]",
  window_switch: "bg-teal-500",
};

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function groupByDate(items: ActivityItem[]): Map<string, ActivityItem[]> {
  const groups = new Map<string, ActivityItem[]>();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const item of items) {
    const dateStr = new Date(item.timestamp).toDateString();
    let label: string;
    if (dateStr === today) label = "Today";
    else if (dateStr === yesterday) label = "Yesterday";
    else label = new Date(item.timestamp).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(item);
  }

  return groups;
}

// Hook to track activities
const STORAGE_KEY = "blade-activity";
const MAX_ITEMS = 200;

function loadActivity(): ActivityItem[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function useActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>(loadActivity);

  const track = (type: ActivityItem["type"], action: string, detail: string, metadata?: Record<string, string>) => {
    const item: ActivityItem = {
      id: crypto.randomUUID(),
      type,
      action,
      detail,
      timestamp: Date.now(),
      metadata,
    };
    setItems((prev) => {
      const next = [...prev, item].slice(-MAX_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  return { items, track };
}

interface Props {
  items: ActivityItem[];
  onBack: () => void;
  maxItems?: number;
}

interface TimelineEvent {
  id: number;
  timestamp: number;
  event_type: string;
  title: string;
  content: string;
  app_name: string;
  metadata: string;
}

export function ActivityFeed({ items, onBack, maxItems = 200 }: Props) {
  const [typeFilter, setTypeFilter] = useState<ActivityItem["type"] | "all">("all");
  const [dbItems, setDbItems] = useState<ActivityItem[]>([]);

  // Load persisted timeline events from DB on mount
  useEffect(() => {
    invoke<TimelineEvent[]>("timeline_get_recent", { limit: 150 })
      .then((events) => {
        const converted: ActivityItem[] = events.map((e) => ({
          id: `tl-${e.id}`,
          type: (e.event_type as ActivityItem["type"]) ?? "tool",
          action: e.event_type.replace(/_/g, " "),
          detail: e.title || e.content.slice(0, 80),
          timestamp: e.timestamp * 1000, // DB stores seconds, ActivityItem uses ms
          metadata: e.app_name ? { app: e.app_name } : undefined,
        }));
        setDbItems(converted);
      })
      .catch(() => {});
  }, []);

  // Merge in-memory + DB items, deduplicate by id
  const allItems = useMemo(() => {
    const map = new Map<string, ActivityItem>();
    for (const item of [...items, ...dbItems]) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
    return Array.from(map.values());
  }, [items, dbItems]);

  const filtered = useMemo(() => {
    const base = typeFilter === "all" ? allItems : allItems.filter((i) => i.type === typeFilter);
    return base.sort((a, b) => b.timestamp - a.timestamp).slice(0, maxItems);
  }, [allItems, typeFilter, maxItems]);

  const grouped = useMemo(() => groupByDate(filtered), [filtered]);

  const types = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of allItems) {
      counts[item.type] = (counts[item.type] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type: type as ActivityItem["type"], count }));
  }, [allItems]);

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Activity</h1>
            <p className="text-2xs text-blade-muted">{items.length} events tracked</p>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-blade-muted hover:text-blade-text transition-colors"
          >
            back
          </button>
        </div>

        {/* Type filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setTypeFilter("all")}
            className={`px-2 py-1 rounded-lg text-2xs shrink-0 transition-colors ${
              typeFilter === "all"
                ? "bg-blade-accent-muted text-blade-text"
                : "text-blade-muted hover:text-blade-secondary"
            }`}
          >
            All ({items.length})
          </button>
          {types.map(({ type, count }) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={`px-2 py-1 rounded-lg text-2xs shrink-0 transition-colors flex items-center gap-1 ${
                typeFilter === type
                  ? "bg-blade-accent-muted text-blade-text"
                  : "text-blade-muted hover:text-blade-secondary"
              }`}
            >
              <span>{TYPE_ICONS[type]}</span>
              <span>{type} ({count})</span>
            </button>
          ))}
        </div>

        {/* Timeline */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-blade-muted/40">
            <span className="text-3xl mb-3">📊</span>
            <p className="text-xs">No activity yet</p>
            <p className="text-2xs mt-1">Start using Blade to see your activity here</p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([dateLabel, dateItems]) => (
            <div key={dateLabel}>
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xs text-blade-muted/50 uppercase tracking-wider shrink-0">{dateLabel}</span>
                <div className="h-px flex-1 bg-blade-border/30" />
              </div>
              <div className="space-y-1 ml-1">
                {dateItems.map((item) => (
                  <div key={item.id} className="flex items-start gap-3 py-1.5 group">
                    {/* Timeline dot */}
                    <div className="flex flex-col items-center shrink-0 mt-1">
                      <div className={`w-2 h-2 rounded-full ${TYPE_COLORS[item.type]}`} />
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs">{TYPE_ICONS[item.type]}</span>
                        <span className="text-xs text-blade-secondary">{item.action}</span>
                        <span className="text-2xs text-blade-muted/40 ml-auto shrink-0">
                          {formatRelativeTime(item.timestamp)}
                        </span>
                      </div>
                      <p className="text-2xs text-blade-muted mt-0.5 truncate">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
