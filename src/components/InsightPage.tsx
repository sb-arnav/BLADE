/**
 * INSIGHT PAGE — Browsable history of all proactive observations.
 * Ported from Omi's InsightPage.
 *
 * Shows: all proactive cards (task, focus, insight, memory) with filters,
 * search, and dismiss functionality.
 */

import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PageShell } from "./PageShell";

interface ProactiveCard {
  card_type: string;
  title: string;
  body: string;
  source_app: string;
  confidence: number;
  timestamp: number;
  dismissed: boolean;
}

interface InsightPageProps {
  onBack: () => void;
}

const TYPE_FILTERS = ["all", "task", "focus", "insight", "memory"] as const;
const TYPE_ICONS: Record<string, string> = { task: "📋", focus: "🎯", insight: "💡", memory: "🧠" };
const TYPE_COLORS: Record<string, string> = { task: "#fbbf24", focus: "#60a5fa", insight: "#818cf8", memory: "#4ade80" };

export function InsightPage({ onBack }: InsightPageProps) {
  const [cards, setCards] = useState<ProactiveCard[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const loadCards = useCallback(() => {
    invoke<ProactiveCard[]>("proactive_get_cards", { limit: 100 })
      .then(setCards)
      .catch(() => null);
  }, []);

  useEffect(() => { loadCards(); }, [loadCards]);

  const filtered = cards.filter((c) => {
    if (filter !== "all" && c.card_type !== filter) return false;
    if (search && !c.body.toLowerCase().includes(search.toLowerCase()) && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const dismiss = (idx: number) => {
    // Note: proactive_dismiss_card takes an id but we don't have it from the current API
    // For now just remove from local state
    setCards((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <PageShell title="Insights" subtitle={`${filtered.length} observations`} onBack={onBack} noPadding>
      {/* Filters + search */}
      <div className="px-5 py-2 flex items-center gap-3 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex gap-1">
          {TYPE_FILTERS.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-2 py-[3px] rounded-md text-[10px] font-medium transition-colors ${
                filter === t
                  ? "bg-[rgba(129,140,248,0.2)] text-[#818cf8] border border-[rgba(129,140,248,0.3)]"
                  : "text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.6)]"
              }`}
            >
              {t === "all" ? "All" : `${TYPE_ICONS[t] || ""} ${t}`}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search insights..."
          className="flex-1 px-2 py-[4px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-md text-[11px] text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#818cf8]"
        />
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-[6px]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[200px] text-center">
            <div className="text-[30px] opacity-20 mb-2">💡</div>
            <div className="text-[12px] text-[rgba(255,255,255,0.3)]">
              {cards.length === 0 ? "No observations yet — BLADE will surface insights as you work" : "No matches for this filter"}
            </div>
          </div>
        ) : (
          filtered.map((card, i) => {
            const time = new Date(card.timestamp * 1000);
            const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });
            const icon = TYPE_ICONS[card.card_type] || "•";
            const accent = TYPE_COLORS[card.card_type] || "#818cf8";

            return (
              <div
                key={i}
                className="flex items-start gap-3 px-3 py-[10px] rounded-lg bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.06)] transition-colors group"
              >
                <div className="w-[3px] self-stretch rounded-full flex-shrink-0" style={{ background: accent }} />
                <span className="text-[14px] flex-shrink-0 mt-[1px]">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{card.title}</div>
                  <div className="text-[11px] text-[rgba(255,255,255,0.55)] mt-[2px] leading-[1.4]">{card.body}</div>
                  <div className="flex items-center gap-2 mt-[4px]">
                    <span className="text-[9px] text-[rgba(255,255,255,0.25)]">{dateStr} {timeStr}</span>
                    {card.source_app && (
                      <span className="text-[9px] text-[rgba(255,255,255,0.2)]">from {card.source_app}</span>
                    )}
                    <span className="text-[9px] text-[rgba(255,255,255,0.15)]">{(card.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
                <button
                  onClick={() => dismiss(i)}
                  className="text-[10px] text-[rgba(255,255,255,0.2)] hover:text-[rgba(255,255,255,0.5)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                >
                  dismiss
                </button>
              </div>
            );
          })
        )}
      </div>
    </PageShell>
  );
}
