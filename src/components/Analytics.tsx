import { useState, useMemo } from "react";
import { useAnalytics, type AnalyticsSummary, type DailyStats } from "../hooks/useAnalytics";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatHour(hour: number): string {
  if (hour === 0) return "12am";
  if (hour < 12) return `${hour}am`;
  if (hour === 12) return "12pm";
  return `${hour - 12}pm`;
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function todayStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatMs(ms: number): string {
  if (ms === 0) return "--";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function weekLabel(weekIndex: number): string {
  const labels = ["4w ago", "3w ago", "2w ago", "This week"];
  return labels[weekIndex] ?? "";
}

function trendArrow(
  current: number,
  previous: number
): { symbol: string; color: string } {
  if (previous === 0 && current === 0) return { symbol: "--", color: "text-blade-muted" };
  if (current > previous) return { symbol: "\u2191", color: "text-emerald-400" };
  if (current < previous) return { symbol: "\u2193", color: "text-red-400" };
  return { symbol: "\u2192", color: "text-blade-muted" };
}

function pctChange(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const pct = Math.round(((current - previous) / previous) * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <div className="bg-blade-surface border border-blade-border rounded-2xl p-4 flex flex-col items-center justify-center min-w-0">
      <span className="text-2xl font-bold text-blade-text leading-none">
        {value}
      </span>
      <span className="text-2xs text-blade-muted mt-1.5 text-center leading-tight">
        {label}
      </span>
      {sublabel && (
        <span className="text-2xs text-blade-muted/50 mt-0.5 text-center">
          {sublabel}
        </span>
      )}
    </div>
  );
}

function ActivityChart({ dailyStats }: { dailyStats: DailyStats[] }) {
  const today = todayStr();
  const maxCount = useMemo(() => {
    let m = 0;
    for (const d of dailyStats) {
      const total = d.messagesSent + d.messagesReceived;
      if (total > m) m = total;
    }
    return Math.max(m, 1);
  }, [dailyStats]);

  return (
    <div className="bg-blade-surface border border-blade-border rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-blade-text mb-3">
        Activity — Last 30 Days
      </h3>
      <div className="max-h-[320px] overflow-y-auto pr-1 custom-scrollbar space-y-[3px]">
        {dailyStats.map((day) => {
          const total = day.messagesSent + day.messagesReceived;
          const widthPct = (total / maxCount) * 100;
          const isToday = day.date === today;

          return (
            <div key={day.date} className="flex items-center gap-2 group">
              {/* Date label */}
              <span
                className={`text-2xs font-mono w-[52px] shrink-0 text-right ${
                  isToday ? "text-blade-accent font-semibold" : "text-blade-muted/70"
                }`}
              >
                {shortDate(day.date)}
              </span>

              {/* Bar container */}
              <div className="flex-1 h-[14px] relative rounded-sm overflow-hidden bg-blade-bg/50">
                {total > 0 && (
                  <div
                    className={`absolute left-0 top-0 h-full rounded-sm transition-all duration-300 ${
                      isToday
                        ? "bg-blade-accent"
                        : "bg-blade-accent/40 group-hover:bg-blade-accent/60"
                    }`}
                    style={{ width: `${Math.max(widthPct, 2)}%` }}
                  />
                )}
              </div>

              {/* Count */}
              <span
                className={`text-2xs font-mono w-[28px] text-right ${
                  isToday ? "text-blade-accent font-semibold" : "text-blade-muted/60"
                }`}
              >
                {total > 0 ? total : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HourlyHeatmap({
  hourlyDistribution,
}: {
  hourlyDistribution: number[];
}) {
  const maxHourly = useMemo(
    () => Math.max(...hourlyDistribution, 1),
    [hourlyDistribution]
  );

  const quarterLabels: Record<number, string> = {
    0: "12am",
    6: "6am",
    12: "12pm",
    18: "6pm",
  };

  return (
    <div className="bg-blade-surface border border-blade-border rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-blade-text mb-3">
        Hourly Activity
      </h3>
      <div className="flex gap-[3px] items-end">
        {hourlyDistribution.map((count, hour) => {
          const intensity = count / maxHourly;
          const opacity = count === 0 ? 0.06 : 0.15 + intensity * 0.85;
          const height = count === 0 ? 8 : 8 + intensity * 40;

          return (
            <div key={hour} className="flex flex-col items-center flex-1 min-w-0">
              {/* Bar */}
              <div
                className="w-full rounded-sm bg-blade-accent transition-all duration-300"
                style={{
                  height: `${height}px`,
                  opacity,
                }}
                title={`${formatHour(hour)}: ${count} events`}
              />
            </div>
          );
        })}
      </div>

      {/* Labels row */}
      <div className="flex mt-1.5">
        {hourlyDistribution.map((_, hour) => (
          <div key={hour} className="flex-1 min-w-0 text-center">
            {quarterLabels[hour] !== undefined ? (
              <span className="text-[9px] text-blade-muted/60 font-mono">
                {quarterLabels[hour]}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyTrend({ weeklyTrend }: { weeklyTrend: number[] }) {
  return (
    <div className="bg-blade-surface border border-blade-border rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-blade-text mb-3">
        Weekly Trend
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {weeklyTrend.map((count, i) => {
          const prevCount = i > 0 ? weeklyTrend[i - 1] : 0;
          const trend = trendArrow(count, prevCount);
          const change = i > 0 ? pctChange(count, prevCount) : "";

          return (
            <div
              key={i}
              className="bg-blade-bg/50 rounded-xl p-3 text-center border border-blade-border/50"
            >
              <div className="text-lg font-bold text-blade-text">{count}</div>
              <div className="text-2xs text-blade-muted mt-0.5">
                {weekLabel(i)}
              </div>
              {i > 0 && (
                <div className={`text-xs mt-1 font-semibold ${trend.color}`}>
                  {trend.symbol} {change}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlashCommandsList({
  commands,
}: {
  commands: { command: string; count: number }[];
}) {
  if (commands.length === 0) {
    return (
      <div className="bg-blade-surface border border-blade-border rounded-2xl p-4">
        <h3 className="text-xs font-semibold text-blade-text mb-2">
          Top Slash Commands
        </h3>
        <p className="text-2xs text-blade-muted py-2">
          No slash commands used yet. Try /help to get started.
        </p>
      </div>
    );
  }

  const maxCount = commands[0]?.count ?? 1;

  return (
    <div className="bg-blade-surface border border-blade-border rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-blade-text mb-3">
        Top Slash Commands
      </h3>
      <div className="space-y-1.5">
        {commands.map((cmd, idx) => {
          const widthPct = (cmd.count / maxCount) * 100;
          return (
            <div key={cmd.command} className="flex items-center gap-2">
              <span className="text-2xs text-blade-muted/50 w-4 text-right font-mono">
                {idx + 1}
              </span>
              <span className="text-xs text-blade-accent font-mono w-[100px] truncate">
                /{cmd.command}
              </span>
              <div className="flex-1 h-[10px] bg-blade-bg/50 rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm bg-blade-accent/50"
                  style={{ width: `${Math.max(widthPct, 4)}%` }}
                />
              </div>
              <span className="text-2xs text-blade-muted font-mono w-[28px] text-right">
                {cmd.count}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function InsightRow({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-2xs text-blade-muted flex items-center gap-1.5">
        <span className="text-xs">{icon}</span>
        {label}
      </span>
      <span className="text-xs text-blade-text font-medium">{value}</span>
    </div>
  );
}

function InsightsPanel({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div className="bg-blade-surface border border-blade-border rounded-2xl p-4">
      <h3 className="text-xs font-semibold text-blade-text mb-2">
        Insights
      </h3>
      <div className="divide-y divide-blade-border/30">
        <InsightRow
          icon={"\u2605"}
          label="Longest Streak"
          value={`${summary.longestStreak} day${summary.longestStreak !== 1 ? "s" : ""}`}
        />
        <InsightRow
          icon={"\u2302"}
          label="Top Provider"
          value={summary.topProvider}
        />
        <InsightRow
          icon={"\u263C"}
          label="Most Active Day"
          value={summary.mostActiveDay}
        />
        <InsightRow
          icon={"\u260E"}
          label="Conversations"
          value={String(summary.totalConversations)}
        />
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function Analytics({ onBack }: Props) {
  const { summary, dailyStats, reset } = useAnalytics();
  const [confirmReset, setConfirmReset] = useState(false);

  const dateRangeLabel = useMemo(() => {
    if (dailyStats.length === 0) return "";
    const first = dailyStats[0];
    const last = dailyStats[dailyStats.length - 1];
    return `${shortDate(first.date)} \u2014 ${shortDate(last.date)}`;
  }, [dailyStats]);

  const handleReset = () => {
    if (confirmReset) {
      reset();
      setConfirmReset(false);
    } else {
      setConfirmReset(true);
    }
  };

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border bg-blade-surface shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-text transition-colors"
            aria-label="Go back"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Analytics</h1>
            <span className="text-2xs text-blade-muted/60">{dateRangeLabel}</span>
          </div>
        </div>

        {/* Decorative accent dot */}
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
          <span className="text-2xs text-blade-muted/40 font-mono">live</span>
        </div>
      </div>

      {/* ── Scrollable body ────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-2">
          <SummaryCard
            label="Total Messages"
            value={summary.totalMessages}
            sublabel={`${summary.totalConversations} conversations`}
          />
          <SummaryCard
            label="Avg Response"
            value={formatMs(summary.averageResponseTime)}
          />
          <SummaryCard
            label="Current Streak"
            value={`${summary.currentStreak}d`}
            sublabel={`Best: ${summary.longestStreak}d`}
          />
          <SummaryCard
            label="Most Active"
            value={formatHour(summary.mostActiveHour)}
            sublabel={summary.mostActiveDay}
          />
        </div>

        {/* Activity chart — 30 day bar chart */}
        <ActivityChart dailyStats={dailyStats} />

        {/* Hourly heatmap */}
        <HourlyHeatmap hourlyDistribution={summary.hourlyDistribution} />

        {/* Two-column: weekly trend + insights */}
        <div className="grid grid-cols-2 gap-2">
          <WeeklyTrend weeklyTrend={summary.weeklyTrend} />
          <InsightsPanel summary={summary} />
        </div>

        {/* Top slash commands */}
        <SlashCommandsList commands={summary.favoriteSlashCommands} />

        {/* ── Reset ──────────────────────────────────────────────────── */}
        <div className="pt-2 pb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleReset}
              className={`text-2xs px-3 py-1.5 rounded-lg border transition-colors ${
                confirmReset
                  ? "bg-red-500/20 border-red-500/40 text-red-400 hover:bg-red-500/30"
                  : "bg-blade-surface border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-border/80"
              }`}
            >
              {confirmReset ? "Confirm Reset" : "Reset Analytics"}
            </button>
            {confirmReset && (
              <>
                <span className="text-2xs text-red-400/70">
                  This will erase all analytics data.
                </span>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="text-2xs text-blade-muted hover:text-blade-text transition-colors"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
