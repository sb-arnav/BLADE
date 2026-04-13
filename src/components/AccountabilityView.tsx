import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface KeyResult {
  id: string;
  title: string;
  metric: string;
  target_value: number;
  current_value: number;
  unit: string;
  status: "on_track" | "at_risk" | "behind" | "completed";
}

interface Objective {
  id: string;
  title: string;
  description: string;
  timeframe: string;
  progress_pct: number;
  status: string;
  key_results: KeyResult[];
}

interface DailyAction {
  id: string;
  title: string;
  completed: boolean;
  energy_level: string;
}

interface DailyPlan {
  date: string;
  actions: DailyAction[];
  focus_objective: string;
  energy_recommendation: string;
  blade_message: string;
}

interface ProgressReport {
  period: string;
  summary: string;
  completed_actions: number;
  total_actions: number;
  highlights: string[];
  blockers: string[];
}

const palette = {
  bg: "#0a0a0a",
  panel: "#10150f",
  panelAlt: "#0d120d",
  green: "#00ff41",
  amber: "#ffb000",
  red: "#ff0040",
  blue: "#00b8ff",
  line: "rgba(0, 255, 65, 0.24)",
  dim: "rgba(0, 255, 65, 0.54)",
  muted: "rgba(164, 255, 188, 0.74)",
  glow: "rgba(0, 255, 65, 0.18)",
} as const;

function SectionFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={`relative overflow-hidden border p-4 ${className}`}
      style={{
        borderColor: palette.line,
        background: `linear-gradient(180deg, ${palette.panel} 0%, ${palette.panelAlt} 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(0, 255, 65, 0.06), 0 0 18px ${palette.glow}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div className="relative">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: palette.amber }}>
          {`=== ${title} ===`}
        </div>
        {children}
      </div>
    </section>
  );
}

function krStatusColor(status: KeyResult["status"]): string {
  if (status === "on_track" || status === "completed") return palette.green;
  if (status === "at_risk") return palette.amber;
  return palette.red;
}

function energyDot(level: string) {
  if (level === "high") return { dot: "🔴", color: palette.red };
  if (level === "medium") return { dot: "🟡", color: palette.amber };
  return { dot: "🟢", color: palette.green };
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const blocks = 20;
  const filled = Math.round((Math.min(100, pct) / 100) * blocks);
  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: blocks }).map((_, i) => (
        <div
          key={i}
          className="h-3 flex-1 border"
          style={{
            borderColor: i < filled ? `${color}88` : "rgba(0,255,65,0.12)",
            backgroundColor: i < filled ? color : "rgba(0,255,65,0.04)",
            boxShadow: i < filled ? `0 0 6px ${color}44` : "none",
          }}
        />
      ))}
    </div>
  );
}

function RingProgress({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - Math.min(100, pct) / 100);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(0,255,65,0.12)"
        strokeWidth={4}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={4}
        strokeDasharray={circ}
        strokeDashoffset={offset}
        strokeLinecap="square"
        style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
      />
    </svg>
  );
}

export function AccountabilityView({ onBack }: { onBack: () => void }) {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(null);
  const [dailyActions, setDailyActions] = useState<DailyAction[]>([]);
  const [nudgeBanner, setNudgeBanner] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [report, setReport] = useState<ProgressReport | null>(null);
  const [showReport, setShowReport] = useState(false);

  // Check-in state
  const [showCheckin, setShowCheckin] = useState(false);
  const [checkinMood, setCheckinMood] = useState(5);
  const [checkinEnergy, setCheckinEnergy] = useState(5);
  const [checkinWin, setCheckinWin] = useState("");
  const [checkinBlocker, setCheckinBlocker] = useState("");
  const [checkinTomorrow, setCheckinTomorrow] = useState("");
  const [checkinLoading, setCheckinLoading] = useState(false);
  const [checkinDone, setCheckinDone] = useState(false);

  // New objective form
  const [showNewObj, setShowNewObj] = useState(false);
  const [objTitle, setObjTitle] = useState("");
  const [objDesc, setObjDesc] = useState("");
  const [objTimeframe, setObjTimeframe] = useState("");
  const [objDays, setObjDays] = useState("90");
  const [objCreating, setObjCreating] = useState(false);

  // KR update
  const [editingKr, setEditingKr] = useState<string | null>(null);
  const [krValue, setKrValue] = useState("");

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const load = useCallback(async () => {
    const [objRes, actRes] = await Promise.allSettled([
      invoke<Objective[]>("accountability_get_objectives"),
      invoke<DailyAction[]>("accountability_get_daily_actions", { date: null }),
    ]);
    setObjectives(objRes.status === "fulfilled" ? objRes.value : []);
    const actions = actRes.status === "fulfilled" ? actRes.value : [];
    setDailyActions(actions);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<string>("accountability_nudge", (e) => {
      setNudgeBanner(e.payload);
      setTimeout(() => setNudgeBanner(null), 8000);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  async function generatePlan() {
    setPlanLoading(true);
    try {
      const plan = await invoke<DailyPlan>("accountability_daily_plan");
      setDailyPlan(plan);
      setDailyActions(plan.actions);
    } catch {
      // silent
    } finally {
      setPlanLoading(false);
    }
  }

  async function completeAction(id: string) {
    await invoke("accountability_complete_action", { actionId: id }).catch(() => {});
    setDailyActions((prev) =>
      prev.map((a) => (a.id === id ? { ...a, completed: true } : a))
    );
  }

  async function submitCheckin() {
    setCheckinLoading(true);
    try {
      await invoke("accountability_checkin", {
        mood: checkinMood,
        energy: checkinEnergy,
        win: checkinWin,
        blocker: checkinBlocker,
        tomorrow: checkinTomorrow,
      });
      setCheckinDone(true);
      setTimeout(() => { setShowCheckin(false); setCheckinDone(false); }, 1500);
    } catch {
      // silent
    } finally {
      setCheckinLoading(false);
    }
  }

  async function createObjective() {
    if (!objTitle.trim()) return;
    setObjCreating(true);
    try {
      await invoke("accountability_create_objective", {
        title: objTitle,
        description: objDesc,
        timeframe: objTimeframe,
        durationDays: parseInt(objDays) || 90,
      });
      setObjTitle(""); setObjDesc(""); setObjTimeframe(""); setObjDays("90");
      setShowNewObj(false);
      await load();
    } catch {
      // silent
    } finally {
      setObjCreating(false);
    }
  }

  async function updateKr(krId: string) {
    const val = parseFloat(krValue);
    if (isNaN(val)) return;
    await invoke("accountability_update_kr", { krId, currentValue: val }).catch(() => {});
    setEditingKr(null);
    setKrValue("");
    await load();
  }

  async function fetchReport() {
    setReportLoading(true);
    try {
      const r = await invoke<ProgressReport>("accountability_progress_report", { period: "week" });
      setReport(r);
      setShowReport(true);
    } catch {
      // silent
    } finally {
      setReportLoading(false);
    }
  }

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center font-mono text-sm uppercase tracking-[0.3em]"
        style={{ color: palette.green, backgroundColor: palette.bg, textShadow: `0 0 10px ${palette.green}88` }}
      >
        Loading accountability engine...
      </div>
    );
  }

  const completedCount = dailyActions.filter((a) => a.completed).length;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden font-mono"
      style={{
        background:
          "radial-gradient(circle at top, rgba(255,176,0,0.06) 0%, rgba(0,255,65,0.02) 18%, rgba(10,10,10,1) 55%), #0a0a0a",
        color: palette.green,
      }}
    >
      <style>{`
        @keyframes acc-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.45; }
        }
        @keyframes acc-nudge {
          0% { transform: translateY(-100%); opacity: 0; }
          10% { transform: translateY(0); opacity: 1; }
          85% { transform: translateY(0); opacity: 1; }
          100% { transform: translateY(-100%); opacity: 0; }
        }
        @keyframes acc-flicker {
          0%, 100% { opacity: 0.18; }
          50% { opacity: 0.26; }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)",
          animation: "acc-flicker 4s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 90px rgba(0,0,0,0.72)" }}
      />

      {/* Nudge Banner */}
      {nudgeBanner && (
        <div
          className="absolute left-0 right-0 top-0 z-50 flex items-center gap-3 border-b px-4 py-2"
          style={{
            borderColor: palette.amber,
            backgroundColor: `${palette.amber}18`,
            animation: "acc-nudge 8s ease forwards",
          }}
        >
          <span style={{ color: palette.amber }}>▶</span>
          <span className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: palette.amber }}>
            {nudgeBanner}
          </span>
        </div>
      )}

      {/* Header */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: palette.line, backgroundColor: "rgba(10, 16, 10, 0.92)" }}
      >
        <button
          onClick={onBack}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ borderColor: palette.line, color: palette.amber }}
        >
          &lt; Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.32em]" style={{ color: "#d5ffd8" }}>
            Accountability Engine
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.dim }}>
            {today} | {completedCount}/{dailyActions.length} tasks done
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchReport}
            disabled={reportLoading}
            className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] disabled:opacity-40"
            style={{ borderColor: palette.line, color: palette.muted }}
          >
            {reportLoading ? "..." : "Weekly Report"}
          </button>
          <button
            onClick={load}
            className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
            style={{ borderColor: palette.line, color: palette.green }}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="space-y-4">

          {/* BLADE morning message */}
          {dailyPlan?.blade_message && (
            <div
              className="relative border p-4"
              style={{
                borderColor: `${palette.amber}55`,
                background: `linear-gradient(135deg, rgba(255,176,0,0.08), rgba(10,10,10,0.9))`,
                boxShadow: `inset 0 0 0 1px ${palette.amber}18`,
              }}
            >
              <div className="mb-2 text-[10px] uppercase tracking-[0.28em]" style={{ color: palette.amber }}>
                BLADE // {dailyPlan.date}
              </div>
              <div
                className="text-[12px] leading-relaxed"
                style={{ color: "#ffe8b3", fontStyle: "italic" }}
              >
                "{dailyPlan.blade_message}"
              </div>
              {dailyPlan.focus_objective && (
                <div className="mt-3 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.amber }}>
                  Focus → {dailyPlan.focus_objective}
                </div>
              )}
              {dailyPlan.energy_recommendation && (
                <div className="mt-1 text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.dim }}>
                  Energy: {dailyPlan.energy_recommendation}
                </div>
              )}
            </div>
          )}

          {/* Daily Actions */}
          <SectionFrame title={`TODAY'S ACTIONS [${completedCount}/${dailyActions.length}]`}>
            <div className="mb-3 flex gap-3">
              <button
                onClick={generatePlan}
                disabled={planLoading}
                className="border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                style={{ borderColor: palette.green, color: palette.green }}
              >
                {planLoading ? "Generating..." : "Generate Today's Plan ⚡"}
              </button>
              <button
                onClick={() => setShowCheckin(true)}
                className="border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]"
                style={{ borderColor: palette.amber, color: palette.amber }}
              >
                Quick Check-in
              </button>
            </div>

            {dailyActions.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No actions planned. Generate today's plan above.
              </div>
            ) : (
              <div className="space-y-2">
                {dailyActions.map((action) => {
                  const { dot } = energyDot(action.energy_level);
                  return (
                    <div
                      key={action.id}
                      className="flex items-center gap-3 border px-3 py-2"
                      style={{
                        borderColor: action.completed ? "rgba(0,255,65,0.3)" : palette.line,
                        backgroundColor: action.completed ? "rgba(0,255,65,0.05)" : "transparent",
                      }}
                    >
                      <button
                        onClick={() => !action.completed && completeAction(action.id)}
                        className="flex h-4 w-4 shrink-0 items-center justify-center border text-[10px] font-bold"
                        style={{
                          borderColor: action.completed ? palette.green : palette.line,
                          color: palette.green,
                          backgroundColor: action.completed ? `${palette.green}22` : "transparent",
                        }}
                      >
                        {action.completed ? "✓" : ""}
                      </button>
                      <span
                        className="flex-1 text-[12px]"
                        style={{
                          color: action.completed ? palette.dim : "#d5ffd8",
                          textDecoration: action.completed ? "line-through" : "none",
                        }}
                      >
                        {action.title}
                      </span>
                      <span className="text-[12px]" title={`Energy: ${action.energy_level}`}>
                        {dot}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionFrame>

          {/* Quick Check-in Modal */}
          {showCheckin && (
            <SectionFrame title="DAILY CHECK-IN">
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.amber }}>
                      Mood: {checkinMood}/10
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={checkinMood}
                      onChange={(e) => setCheckinMood(Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: palette.amber }}
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.blue }}>
                      Energy: {checkinEnergy}/10
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={checkinEnergy}
                      onChange={(e) => setCheckinEnergy(Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: palette.blue }}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.green }}>
                    Today's Win
                  </label>
                  <textarea
                    value={checkinWin}
                    onChange={(e) => setCheckinWin(e.target.value)}
                    rows={2}
                    placeholder="What went well today?"
                    className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.red }}>
                    Blocker
                  </label>
                  <textarea
                    value={checkinBlocker}
                    onChange={(e) => setCheckinBlocker(e.target.value)}
                    rows={2}
                    placeholder="What's blocking you?"
                    className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.amber }}>
                    Tomorrow's Focus
                  </label>
                  <textarea
                    value={checkinTomorrow}
                    onChange={(e) => setCheckinTomorrow(e.target.value)}
                    rows={2}
                    placeholder="What will you focus on tomorrow?"
                    className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={submitCheckin}
                    disabled={checkinLoading || checkinDone}
                    className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-60"
                    style={{ borderColor: palette.green, color: palette.green }}
                  >
                    {checkinDone ? "✓ Logged" : checkinLoading ? "Saving..." : "Submit Check-in"}
                  </button>
                  <button
                    onClick={() => setShowCheckin(false)}
                    className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                    style={{ borderColor: palette.line, color: palette.muted }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </SectionFrame>
          )}

          {/* Objectives */}
          <SectionFrame title={`OBJECTIVES & KEY RESULTS [${objectives.length}]`}>
            <button
              onClick={() => setShowNewObj(!showNewObj)}
              className="mb-4 border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.2em]"
              style={{ borderColor: palette.line, color: palette.amber }}
            >
              {showNewObj ? "Cancel" : "+ New Objective"}
            </button>

            {showNewObj && (
              <div className="mb-4 space-y-3 border p-3" style={{ borderColor: `${palette.amber}44` }}>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: palette.amber }}>
                  Create Objective
                </div>
                <input
                  value={objTitle}
                  onChange={(e) => setObjTitle(e.target.value)}
                  placeholder="Objective title"
                  className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                />
                <input
                  value={objDesc}
                  onChange={(e) => setObjDesc(e.target.value)}
                  placeholder="Description"
                  className="w-full border bg-transparent px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={objTimeframe}
                    onChange={(e) => setObjTimeframe(e.target.value)}
                    placeholder="Timeframe (e.g. Q2 2026)"
                    className="border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                  <input
                    type="number"
                    value={objDays}
                    onChange={(e) => setObjDays(e.target.value)}
                    placeholder="Duration (days)"
                    className="border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <button
                  onClick={createObjective}
                  disabled={objCreating || !objTitle.trim()}
                  className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                  style={{ borderColor: palette.amber, color: palette.amber }}
                >
                  {objCreating ? "Creating..." : "Create Objective"}
                </button>
              </div>
            )}

            {objectives.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No objectives set. Create your first objective above.
              </div>
            ) : (
              <div className="space-y-4">
                {objectives.map((obj) => {
                  const progColor =
                    obj.progress_pct >= 70
                      ? palette.green
                      : obj.progress_pct >= 40
                      ? palette.amber
                      : palette.red;
                  return (
                    <div
                      key={obj.id}
                      className="border p-3"
                      style={{ borderColor: `${progColor}33`, backgroundColor: `${progColor}05` }}
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <RingProgress pct={obj.progress_pct} color={progColor} />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-[13px]" style={{ color: "#d5ffd8" }}>
                            {obj.title}
                          </div>
                          <div className="mt-0.5 text-[10px] uppercase tracking-[0.16em]" style={{ color: palette.dim }}>
                            {obj.timeframe} · {obj.progress_pct.toFixed(0)}% complete
                          </div>
                          {obj.description && (
                            <div className="mt-1 text-[11px]" style={{ color: palette.muted }}>
                              {obj.description}
                            </div>
                          )}
                        </div>
                      </div>

                      {obj.key_results.length > 0 && (
                        <div className="space-y-2">
                          {obj.key_results.map((kr) => {
                            const krColor = krStatusColor(kr.status);
                            const krPct =
                              kr.target_value > 0
                                ? (kr.current_value / kr.target_value) * 100
                                : 0;
                            return (
                              <div key={kr.id} className="border-t pt-2" style={{ borderColor: "rgba(0,255,65,0.12)" }}>
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-[11px]" style={{ color: palette.muted }}>
                                    {kr.title}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    {editingKr === kr.id ? (
                                      <>
                                        <input
                                          value={krValue}
                                          onChange={(e) => setKrValue(e.target.value)}
                                          className="w-20 border bg-transparent px-2 py-0.5 text-[11px] outline-none"
                                          style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                                          autoFocus
                                          onKeyDown={(e) => {
                                            if (e.key === "Enter") updateKr(kr.id);
                                            if (e.key === "Escape") setEditingKr(null);
                                          }}
                                        />
                                        <button
                                          onClick={() => updateKr(kr.id)}
                                          className="border px-2 py-0.5 text-[10px]"
                                          style={{ borderColor: palette.green, color: palette.green }}
                                        >
                                          Save
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <span
                                          className="font-bold tabular-nums text-[11px]"
                                          style={{ color: krColor }}
                                        >
                                          {kr.current_value}/{kr.target_value} {kr.unit}
                                        </span>
                                        <button
                                          onClick={() => { setEditingKr(kr.id); setKrValue(String(kr.current_value)); }}
                                          className="border px-2 py-0.5 text-[9px] uppercase"
                                          style={{ borderColor: palette.line, color: palette.muted }}
                                        >
                                          Update
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                                <ProgressBar pct={krPct} color={krColor} />
                                <div className="mt-1 text-[9px] uppercase tracking-[0.14em]" style={{ color: krColor }}>
                                  {kr.status.replace("_", " ")}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionFrame>

        </div>
      </div>

      {/* Weekly Report Modal */}
      {showReport && report && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
          onClick={() => setShowReport(false)}
        >
          <div
            className="relative w-full max-w-2xl border p-6 font-mono mx-4"
            style={{
              borderColor: palette.amber,
              backgroundColor: palette.panel,
              boxShadow: `0 0 40px ${palette.amber}33`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: palette.amber }}>
                === WEEKLY PROGRESS REPORT ===
              </div>
              <button
                onClick={() => setShowReport(false)}
                className="border px-3 py-1 text-[11px] font-bold"
                style={{ borderColor: palette.line, color: palette.muted }}
              >
                Close
              </button>
            </div>
            <div className="mb-3 text-[12px] leading-relaxed" style={{ color: "#d5ffd8" }}>
              {report.summary}
            </div>
            <div className="mb-3 text-[11px] uppercase tracking-[0.18em]" style={{ color: palette.green }}>
              Completed: {report.completed_actions}/{report.total_actions} actions
            </div>
            {report.highlights?.length > 0 && (
              <div className="mb-3">
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.green }}>
                  Highlights
                </div>
                {report.highlights.map((h, i) => (
                  <div key={i} className="text-[11px]" style={{ color: palette.muted }}>
                    ✓ {h}
                  </div>
                ))}
              </div>
            )}
            {report.blockers?.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.red }}>
                  Blockers
                </div>
                {report.blockers.map((b, i) => (
                  <div key={i} className="text-[11px]" style={{ color: palette.red }}>
                    ✗ {b}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
