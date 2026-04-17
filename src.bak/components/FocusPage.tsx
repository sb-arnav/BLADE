/**
 * FOCUS PAGE — Productivity tracking dashboard.
 * Ported from Omi's FocusPage + DailyScoreWidget.
 *
 * Shows: daily focus score, app usage breakdown, productive vs distraction time,
 * proactive cards history, and circadian rhythm visualization.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PageShell } from "./PageShell";

interface FocusScore {
  score: number;
  productive_minutes: number;
  distraction_minutes: number;
  total_minutes: number;
  top_app: string;
}

interface FocusPageProps {
  onBack: () => void;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#4ade80" : score >= 40 ? "#fbbf24" : "#f87171";

  return (
    <div className="relative w-[140px] h-[140px]">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle
          cx="60" cy="60" r={radius} fill="none"
          stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[36px] font-bold tracking-[-0.04em]" style={{ color }}>{score}</span>
        <span className="text-[10px] text-[rgba(255,255,255,0.35)] -mt-1">focus score</span>
      </div>
    </div>
  );
}

export function FocusPage({ onBack }: FocusPageProps) {
  const [focus, setFocus] = useState<FocusScore | null>(null);
  const [circadian, setCircadian] = useState<number[]>([]);
  const [cards, setCards] = useState<Array<{ card_type: string; title: string; body: string; timestamp: number }>>([]);

  useEffect(() => {
    invoke<FocusScore>("proactive_get_focus_score").then(setFocus).catch(() => null);
    invoke<number[]>("homeostasis_get_circadian").then(setCircadian).catch(() => null);
    invoke<typeof cards>("proactive_get_cards", { limit: 20 }).then(setCards).catch(() => null);
  }, []);

  const score = focus?.score ?? 0;
  const productive = focus?.productive_minutes ?? 0;
  const distraction = focus?.distraction_minutes ?? 0;
  const total = focus?.total_minutes ?? 0;
  const neutral = total - productive - distraction;

  return (
    <PageShell title="Focus" subtitle="Productivity tracking" onBack={onBack}>
      <div className="space-y-5">
        {/* Score + breakdown */}
        <div className="flex items-center gap-8">
          <ScoreRing score={score} />
          <div className="flex flex-col gap-3">
            <StatBar label="Productive" minutes={productive} total={total} color="#4ade80" />
            <StatBar label="Neutral" minutes={neutral} total={total} color="#818cf8" />
            <StatBar label="Distraction" minutes={distraction} total={total} color="#f87171" />
            {focus?.top_app && (
              <div className="text-[11px] text-[rgba(255,255,255,0.35)] mt-1">
                Most used: <span className="text-[rgba(255,255,255,0.6)]">{focus.top_app}</span>
              </div>
            )}
          </div>
        </div>

        {/* Circadian rhythm */}
        {circadian.length === 24 && (
          <div>
            <h2 className="text-[12px] font-semibold text-[rgba(255,255,255,0.4)] mb-2">Your Rhythm (learned from 14 days)</h2>
            <div className="flex items-end gap-[2px] h-[60px]">
              {circadian.map((v, i) => {
                const now = new Date().getHours();
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-[2px]">
                    <div
                      className="w-full rounded-t-sm transition-all"
                      style={{
                        height: `${Math.max(v * 55, 2)}px`,
                        background: i === now ? "#818cf8" : `rgba(129,140,248,${0.15 + v * 0.5})`,
                      }}
                    />
                    {i % 6 === 0 && (
                      <span className="text-[8px] text-[rgba(255,255,255,0.2)]">{i}h</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent proactive cards */}
        {cards.length > 0 && (
          <div>
            <h2 className="text-[12px] font-semibold text-[rgba(255,255,255,0.4)] mb-2">Recent Observations</h2>
            <div className="space-y-[6px]">
              {cards.slice(0, 8).map((card, i) => {
                const time = new Date(card.timestamp * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const icon = card.card_type === "task" ? "📋" : card.card_type === "focus" ? "🎯" : card.card_type === "insight" ? "💡" : "🧠";
                return (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
                    <span className="text-[12px]">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-medium truncate">{card.title}</div>
                      <div className="text-[10px] text-[rgba(255,255,255,0.4)] truncate">{card.body}</div>
                    </div>
                    <span className="text-[9px] text-[rgba(255,255,255,0.2)] flex-shrink-0">{time}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function StatBar({ label, minutes, total, color }: { label: string; minutes: number; total: number; color: string }) {
  const pct = total > 0 ? (minutes / total) * 100 : 0;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className="flex items-center gap-2 w-[200px]">
      <span className="text-[10px] text-[rgba(255,255,255,0.4)] w-[65px]">{label}</span>
      <div className="flex-1 h-[4px] bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[10px] text-[rgba(255,255,255,0.35)] w-[40px] text-right">{timeStr}</span>
    </div>
  );
}
