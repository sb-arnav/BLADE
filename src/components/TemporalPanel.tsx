// src/components/TemporalPanel.tsx
// BLADE temporal intelligence — what were you doing, standup prep, pattern detection.

import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DetectedPattern {
  pattern_type: string;
  description: string;
  confidence: number;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.7)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</h2>
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  const color =
    pct >= 75 ? "#34c759" :
    pct >= 50 ? "#f59e0b" :
    "#ff3b30";
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: "rgba(255,255,255,0.08)" }}>
        <div style={{ height: "100%", borderRadius: 2, background: color, width: `${pct}%`, transition: "width 0.5s ease" }} />
      </div>
      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", width: 32, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function patternTypeLabel(type: string): string {
  const map: Record<string, string> = {
    work_session: "Work Session",
    break_pattern: "Break Pattern",
    deep_focus: "Deep Focus",
    context_switch: "Context Switch",
    late_night: "Late Night",
    early_morning: "Early Morning",
    communication: "Communication",
    coding: "Coding",
  };
  return map[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Main component ────────────────────────────────────────────────────────────

interface TemporalPanelProps {
  onBack: () => void;
}

export function TemporalPanel({ onBack }: TemporalPanelProps) {
  // "What was I doing?" state
  const [hoursAgo, setHoursAgo] = useState(2);
  const [activityResult, setActivityResult] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Daily standup state
  const [standup, setStandup] = useState<string | null>(null);
  const [standupLoading, setStandupLoading] = useState(false);
  const [standupError, setStandupError] = useState<string | null>(null);

  // Patterns state
  const [patterns, setPatterns] = useState<DetectedPattern[] | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState<string | null>(null);

  const fetchActivity = useCallback(async () => {
    setActivityLoading(true);
    setActivityError(null);
    setActivityResult(null);
    try {
      const result = await invoke<string>("temporal_what_was_i_doing", { hoursAgo });
      setActivityResult(result);
    } catch (e) {
      setActivityError(String(e));
    } finally {
      setActivityLoading(false);
    }
  }, [hoursAgo]);

  const fetchStandup = useCallback(async () => {
    setStandupLoading(true);
    setStandupError(null);
    setStandup(null);
    try {
      const result = await invoke<string>("temporal_daily_standup");
      setStandup(result);
    } catch (e) {
      setStandupError(String(e));
    } finally {
      setStandupLoading(false);
    }
  }, []);

  const fetchPatterns = useCallback(async () => {
    setPatternsLoading(true);
    setPatternsError(null);
    setPatterns(null);
    try {
      const result = await invoke<DetectedPattern[]>("temporal_detect_patterns");
      setPatterns(result);
    } catch (e) {
      setPatternsError(String(e));
    } finally {
      setPatternsLoading(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-blade-border/60 flex-shrink-0">
        <button
          onClick={onBack}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-blade-surface transition-colors text-blade-muted hover:text-blade-text"
          title="Back"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>
        <div>
          <h1 className="text-sm font-semibold text-blade-text">Temporal Intelligence</h1>
          <p className="text-xs text-blade-muted">What were you doing? Patterns. Standup prep.</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* ── What was I doing? ─────────────────────────────────────── */}
        <section className="bg-blade-surface border border-blade-border/60 rounded-xl p-4">
          <SectionHeader icon="🕒" title="What was I doing?" />

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-xs text-blade-muted w-20 flex-shrink-0">Hours ago</label>
              <input
                type="range"
                min={1}
                max={48}
                step={1}
                value={hoursAgo}
                onChange={(e) => setHoursAgo(Number(e.target.value))}
                className="flex-1 accent-blade-accent"
              />
              <span className="text-xs text-blade-accent font-mono w-10 text-right">
                {hoursAgo}h
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={48}
                value={hoursAgo}
                onChange={(e) => {
                  const v = Math.min(48, Math.max(1, Number(e.target.value)));
                  setHoursAgo(v);
                }}
                className="w-20 px-2 py-1.5 rounded-lg bg-blade-bg border border-blade-border text-xs text-blade-text focus:outline-none focus:border-blade-accent/60"
              />
              <span className="text-xs text-blade-muted">hours ago</span>
              <div className="flex-1" />
              <button
                onClick={fetchActivity}
                disabled={activityLoading}
                className="px-3 py-1.5 rounded-lg bg-blade-accent text-blade-bg text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {activityLoading ? "Querying..." : "Query"}
              </button>
            </div>
          </div>

          {activityError && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-xs text-red-400">
                {activityError}
              </div>
              <button
                onClick={fetchActivity}
                className="self-start px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {activityResult && !activityLoading && (
            <div className="mt-3 p-3 rounded-lg bg-blade-bg border border-blade-border/40">
              <p className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap">{activityResult}</p>
            </div>
          )}

          {activityLoading && (
            <div className="mt-3 space-y-2 animate-pulse">
              <div className="h-4 rounded bg-blade-bg border border-blade-border/40 w-3/4" />
              <div className="h-4 rounded bg-blade-bg border border-blade-border/40 w-1/2" />
              <div className="h-4 rounded bg-blade-bg border border-blade-border/40 w-2/3" />
            </div>
          )}
        </section>

        {/* ── Daily Standup ─────────────────────────────────────────── */}
        <section className="bg-blade-surface border border-blade-border/60 rounded-xl p-4">
          <SectionHeader icon="📋" title="Daily Standup" />

          <div className="flex items-center justify-between">
            <p className="text-xs text-blade-muted">Generate a standup summary from your recent activity.</p>
            <button
              onClick={fetchStandup}
              disabled={standupLoading}
              className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors disabled:opacity-50 flex-shrink-0 ml-3"
            >
              {standupLoading ? "Generating..." : "Generate"}
            </button>
          </div>

          {standupError && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-xs text-red-400">
                {standupError}
              </div>
              <button
                onClick={fetchStandup}
                className="self-start px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {standup && !standupLoading && (
            <div className="mt-3 p-3 rounded-lg bg-blade-bg border border-blade-border/40">
              <pre className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap font-mono">{standup}</pre>
            </div>
          )}

          {standupLoading && (
            <div className="mt-3 space-y-2 animate-pulse">
              <div className="h-4 rounded bg-blade-bg border border-blade-border/40 w-full" />
              <div className="h-4 rounded bg-blade-bg border border-blade-border/40 w-4/5" />
              <div className="h-4 rounded bg-blade-bg border border-blade-border/40 w-3/5" />
            </div>
          )}
        </section>

        {/* ── Patterns ──────────────────────────────────────────────── */}
        <section className="bg-blade-surface border border-blade-border/60 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">🧠</span>
              <h2 className="text-sm font-semibold text-blade-text uppercase tracking-wider">Patterns</h2>
            </div>
            <button
              onClick={fetchPatterns}
              disabled={patternsLoading}
              className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors disabled:opacity-50"
            >
              {patternsLoading ? "Detecting..." : patterns ? "Refresh" : "Detect"}
            </button>
          </div>

          {patternsError && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <p className="text-xs text-red-400">{patternsError}</p>
              <button
                onClick={fetchPatterns}
                className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {patternsLoading && (
            <div className="space-y-2 animate-pulse py-2">
              {[0,1,2].map(i => (
                <div key={i} className="h-12 rounded-lg bg-blade-bg border border-blade-border/40" />
              ))}
            </div>
          )}

          {patterns && !patternsLoading && patterns.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-blade-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" strokeLinecap="round" />
                  <path d="M12 8v4l3 3" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blade-secondary">Building your pattern profile</p>
                <p className="text-xs text-blade-muted mt-1 max-w-xs leading-relaxed">
                  BLADE needs a few days of activity to detect your work rhythms. Keep using it and check back soon.
                </p>
              </div>
            </div>
          )}

          {patterns && !patternsLoading && patterns.length > 0 && (
            <ul className="space-y-3">
              {patterns.map((p, i) => (
                <li key={i} className="p-3 rounded-lg bg-blade-bg border border-blade-border/40">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blade-accent">{patternTypeLabel(p.pattern_type)}</span>
                  </div>
                  <p className="text-xs text-blade-secondary mt-1 leading-relaxed">{p.description}</p>
                  <ConfidenceBar confidence={p.confidence} />
                </li>
              ))}
            </ul>
          )}

          {!patterns && !patternsLoading && !patternsError && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-10 h-10 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center">
                <svg viewBox="0 0 24 24" className="w-5 h-5 text-blade-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" strokeLinecap="round" />
                  <path d="M12 8v4l3 3" strokeLinecap="round" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-blade-secondary">BLADE needs a few days of activity</p>
                <p className="text-xs text-blade-muted mt-1 max-w-xs leading-relaxed">
                  Keep using BLADE normally and it will detect your focus patterns, peak hours, and work rhythms.
                </p>
              </div>
              <button
                onClick={fetchPatterns}
                className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-secondary hover:text-blade-text hover:border-blade-accent/60 transition-colors"
              >
                Check now anyway
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
