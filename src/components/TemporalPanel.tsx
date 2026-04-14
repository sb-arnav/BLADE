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

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-base">{icon}</span>
      <h2 className="text-sm font-semibold text-blade-text uppercase tracking-wider">{title}</h2>
    </div>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  const color =
    pct >= 75 ? "bg-green-500" :
    pct >= 50 ? "bg-amber-500" :
    "bg-red-500";
  return (
    <div className="flex items-center gap-2 mt-1">
      <div className="flex-1 h-1 rounded-full bg-blade-surface overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-2xs text-blade-muted w-8 text-right">{pct}%</span>
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
          <p className="text-2xs text-blade-muted">What were you doing? Patterns. Standup prep.</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">

        {/* ── What was I doing? ─────────────────────────────────────── */}
        <section className="bg-blade-surface border border-blade-border/60 rounded-xl p-4">
          <SectionHeader icon="🕒" title="What was I doing?" />

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <label className="text-2xs text-blade-muted w-20 flex-shrink-0">Hours ago</label>
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
              <span className="text-2xs text-blade-muted">hours ago</span>
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
            <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-xs text-red-400">
              {activityError}
            </div>
          )}

          {activityResult && !activityLoading && (
            <div className="mt-3 p-3 rounded-lg bg-blade-bg border border-blade-border/40">
              <p className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap">{activityResult}</p>
            </div>
          )}

          {activityLoading && (
            <div className="mt-3 flex items-center gap-2 text-2xs text-blade-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
              Scanning timeline...
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
            <div className="mt-3 p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-xs text-red-400">
              {standupError}
            </div>
          )}

          {standup && !standupLoading && (
            <div className="mt-3 p-3 rounded-lg bg-blade-bg border border-blade-border/40">
              <pre className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap font-mono">{standup}</pre>
            </div>
          )}

          {standupLoading && (
            <div className="mt-3 flex items-center gap-2 text-2xs text-blade-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
              Building standup...
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
            <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-xs text-red-400">
              {patternsError}
            </div>
          )}

          {patternsLoading && (
            <div className="flex items-center gap-2 text-2xs text-blade-muted py-4">
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
              Analyzing your work patterns...
            </div>
          )}

          {patterns && !patternsLoading && patterns.length === 0 && (
            <p className="text-xs text-blade-muted py-4 text-center">No patterns detected yet. Use BLADE more to build temporal context.</p>
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
            <p className="text-xs text-blade-muted py-4 text-center">Click Detect to analyse your work patterns.</p>
          )}
        </section>
      </div>
    </div>
  );
}
