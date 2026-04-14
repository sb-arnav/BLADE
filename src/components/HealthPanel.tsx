import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface GuardianStats {
  current_streak_minutes: number;
  daily_total_minutes: number;
  weekly_avg_minutes: number;
  breaks_taken: number;
  status: string;
}

const DAILY_RECOMMENDED_MINUTES = 480; // 8 hours

function formatMinutes(totalMinutes: number): string {
  if (totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function ProgressBar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  const color =
    pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-yellow-500" : "bg-blade-accent";
  return (
    <div className={`w-full h-2 rounded-full bg-blade-border overflow-hidden ${className ?? ""}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

interface BreakBannerProps {
  message: string;
  onDismiss: () => void;
}

function BreakBanner({ message, onDismiss }: BreakBannerProps) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-3 border border-yellow-700/60 rounded-lg bg-yellow-500/10 px-3 py-2.5 animate-fade-in">
      <span className="text-yellow-400 mt-0.5 shrink-0">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5M8 11v.5" />
        </svg>
      </span>
      <p className="text-xs text-yellow-300 flex-1 leading-relaxed">{message}</p>
      <button
        onClick={onDismiss}
        className="text-yellow-600 hover:text-yellow-400 transition-colors shrink-0"
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M2 2l8 8M10 2L2 10" />
        </svg>
      </button>
    </div>
  );
}

export function HealthPanel({ onBack }: { onBack: () => void }) {
  const [stats, setStats] = useState<GuardianStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [takingBreak, setTakingBreak] = useState(false);
  const [breakSuccess, setBreakSuccess] = useState(false);
  const [breakBanners, setBreakBanners] = useState<{ id: string; message: string }[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<GuardianStats>("health_guardian_stats");
      setStats(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();

    const unlisten = listen<{ message?: string } | string>("health_break_reminder", (event) => {
      let message = "Time for a break! Step away from the screen for a few minutes.";
      if (event.payload) {
        if (typeof event.payload === "string") {
          message = event.payload;
        } else if (typeof event.payload === "object" && "message" in event.payload && event.payload.message) {
          message = event.payload.message;
        }
      }
      const id = crypto.randomUUID();
      setBreakBanners((prev) => [...prev, { id, message }]);
    });

    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const dismissBanner = useCallback((id: string) => {
    setBreakBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  async function handleTakeBreak() {
    setTakingBreak(true);
    setBreakSuccess(false);
    try {
      await invoke("health_take_break");
      setBreakSuccess(true);
      await load();
      setTimeout(() => setBreakSuccess(false), 3000);
    } catch {
      // ignore
    } finally {
      setTakingBreak(false);
    }
  }

  const dailyPct = stats
    ? Math.min(100, Math.round((stats.daily_total_minutes / DAILY_RECOMMENDED_MINUTES) * 100))
    : 0;

  const statusColor = (status: string): string => {
    const s = status.toLowerCase();
    if (s.includes("good") || s.includes("ok") || s.includes("fine")) return "text-green-400";
    if (s.includes("warn") || s.includes("tired") || s.includes("long")) return "text-yellow-400";
    if (s.includes("danger") || s.includes("overwork") || s.includes("rest")) return "text-red-400";
    return "text-blade-secondary";
  };

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-blade-border bg-blade-surface/60 sticky top-0 z-10">
        <button
          onClick={onBack}
          className="text-blade-muted hover:text-blade-accent transition-colors"
          aria-label="Go back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 12L6 8l4-4" />
          </svg>
        </button>
        <span className="text-blade-accent text-sm font-semibold tracking-wide">Health Guardian</span>
        <div className="flex-1" />
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] text-blade-muted hover:text-blade-accent transition-colors disabled:opacity-40"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {/* Break banners */}
      {breakBanners.map((b) => (
        <BreakBanner key={b.id} message={b.message} onDismiss={() => dismissBanner(b.id)} />
      ))}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
        {loading && (
          <div className="space-y-3 animate-pulse">
            <div className="border border-blade-border rounded-xl bg-blade-surface/40 h-28" />
            <div className="border border-blade-border rounded-lg bg-blade-surface/40 h-20" />
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-blade-border rounded-lg bg-blade-surface/40 h-16" />
              <div className="border border-blade-border rounded-lg bg-blade-surface/40 h-16" />
            </div>
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-red-900/20 border border-red-700/40 flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-red-400">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 5v3.5M8 10.5v.5" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-blade-secondary">Something went wrong</p>
              <p className="text-xs text-blade-muted mt-1 max-w-xs">Could not load health data. The health guardian may still be starting up.</p>
            </div>
            <button
              onClick={load}
              className="px-4 py-1.5 text-xs font-medium rounded border border-blade-border text-blade-secondary hover:border-blade-accent/50 hover:text-blade-accent transition-all bg-blade-surface"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && stats && stats.daily_total_minutes === 0 && stats.current_streak_minutes === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
            <div className="w-14 h-14 rounded-2xl bg-blade-surface border border-blade-border flex items-center justify-center">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-blade-accent">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
            </div>
            <div>
              <p className="text-base font-semibold text-blade-text">BLADE is tracking your screen time</p>
              <p className="text-xs text-blade-muted mt-1.5 max-w-xs leading-relaxed">
                Check back in an hour for insights on your focus sessions, break habits, and daily usage patterns.
              </p>
            </div>
            <div className="border border-blade-border/50 rounded-lg bg-blade-surface/40 p-3 text-xs text-blade-muted text-left max-w-xs w-full space-y-1">
              <p className="font-medium text-blade-secondary">What BLADE tracks:</p>
              <p>· Active screen time per session</p>
              <p>· Break frequency and duration</p>
              <p>· Daily totals vs. recommended 8h max</p>
            </div>
          </div>
        )}

        {!loading && !error && stats && !(stats.daily_total_minutes === 0 && stats.current_streak_minutes === 0) && (
          <>
            {/* Current streak — hero number */}
            <div className="border border-blade-border rounded-xl bg-blade-surface p-5 text-center space-y-1">
              <p className="text-[10px] text-blade-muted uppercase tracking-widest">Current Session</p>
              <p className="text-4xl font-bold text-blade-accent tabular-nums leading-none">
                {formatMinutes(stats.current_streak_minutes)}
              </p>
              {stats.status && (
                <p className={`text-xs mt-1 ${statusColor(stats.status)}`}>{stats.status}</p>
              )}
            </div>

            {/* Daily progress */}
            <div className="border border-blade-border rounded-lg bg-blade-surface p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blade-secondary uppercase tracking-wide">Today</span>
                <span className="text-xs text-blade-muted">
                  {formatMinutes(stats.daily_total_minutes)} / {formatMinutes(DAILY_RECOMMENDED_MINUTES)} recommended max
                </span>
              </div>
              <ProgressBar value={stats.daily_total_minutes} max={DAILY_RECOMMENDED_MINUTES} />
              <div className="flex items-center justify-between text-[10px] text-blade-muted">
                <span>{dailyPct}% of daily max</span>
                {dailyPct >= 100 && (
                  <span className="text-red-400 font-medium">Over limit — take a break</span>
                )}
                {dailyPct >= 75 && dailyPct < 100 && (
                  <span className="text-yellow-400">Getting close to daily max</span>
                )}
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-blade-border rounded-lg bg-blade-surface p-3 text-center space-y-0.5">
                <p className="text-[10px] text-blade-muted uppercase tracking-wide">Weekly Avg</p>
                <p className="text-xl font-bold text-blade-text tabular-nums">
                  {formatMinutes(stats.weekly_avg_minutes)}
                </p>
                <p className="text-[10px] text-blade-muted">per day</p>
              </div>
              <div className="border border-blade-border rounded-lg bg-blade-surface p-3 text-center space-y-0.5">
                <p className="text-[10px] text-blade-muted uppercase tracking-wide">Breaks Taken</p>
                <p className="text-xl font-bold text-blade-text tabular-nums">{stats.breaks_taken}</p>
                <p className="text-[10px] text-blade-muted">today</p>
              </div>
            </div>

            {/* Take a break */}
            <div className="border border-blade-border rounded-lg bg-blade-surface p-4 space-y-3">
              <div>
                <p className="text-xs font-semibold text-blade-secondary">Ready for a break?</p>
                <p className="text-[11px] text-blade-muted mt-0.5">
                  Step away, stretch, rest your eyes. BLADE will log it.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleTakeBreak}
                  disabled={takingBreak}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-blade-accent/40 bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 hover:border-blade-accent/60 transition-all disabled:opacity-40"
                >
                  {takingBreak ? "Logging break..." : "Take Break"}
                </button>
                {breakSuccess && (
                  <span className="text-xs text-green-400 animate-fade-in">Break logged!</span>
                )}
              </div>
            </div>

            {/* Guidance */}
            <div className="border border-blade-border/50 rounded-lg bg-blade-surface/40 p-3 space-y-1.5 text-[11px] text-blade-muted">
              <p className="font-medium text-blade-secondary text-xs">Health guidelines</p>
              <ul className="space-y-1 list-none">
                <li className="flex items-start gap-1.5">
                  <span className="text-blade-accent mt-0.5">·</span>
                  <span>Take a 5–10 min break every 60–90 minutes of focused work</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-blade-accent mt-0.5">·</span>
                  <span>Follow the 20-20-20 rule: every 20 min, look 20 feet away for 20 seconds</span>
                </li>
                <li className="flex items-start gap-1.5">
                  <span className="text-blade-accent mt-0.5">·</span>
                  <span>Aim for no more than 8 hours of screen time per day</span>
                </li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
