import { useState, useMemo, useCallback } from "react";
import {
  useTimeTracker,
  Project,
  DEFAULT_COLORS,
  formatDuration,
  formatHours,
} from "../hooks/useTimeTracker";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

type Tab = "today" | "week" | "projects" | "reports";

const TAB_ITEMS: Array<{ key: Tab; label: string }> = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "projects", label: "Projects" },
  { key: "reports", label: "Reports" },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateToStr(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function timeStr(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dateAdd(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatCurrency(usd: number): string {
  return "$" + usd.toFixed(2);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TimeTracker({ onBack }: Props) {
  const {
    entries,
    projects,
    activeTimer,
    startTimer,
    stopTimer,
    pauseTimer,
    resumeTimer,
    addManualEntry,
    updateEntry,
    deleteEntry,
    addProject,
    updateProject,
    getStats,
    getWeeklyReport,
    getProjectReport,
    exportTimesheet,
  } = useTimeTracker();

  const [tab, setTab] = useState<Tab>("today");
  const [quickTask, setQuickTask] = useState("");
  const [quickProject, setQuickProject] = useState(projects[0]?.id ?? "");
  const [editingEntry, setEditingEntry] = useState<string | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(DEFAULT_COLORS[0]);
  const [newProjectClient, setNewProjectClient] = useState("");
  const [newProjectBudget, setNewProjectBudget] = useState("");
  const [manualDate, setManualDate] = useState(todayStr());
  const [manualProject, setManualProject] = useState("");
  const [manualTask, setManualTask] = useState("");
  const [manualStart, setManualStart] = useState("09:00");
  const [manualEnd, setManualEnd] = useState("10:00");
  const [manualNotes, setManualNotes] = useState("");
  const [reportFrom, setReportFrom] = useState(dateAdd(todayStr(), -30));
  const [reportTo, setReportTo] = useState(todayStr());

  const stats = useMemo(() => getStats(), [getStats]);
  const weekReport = useMemo(() => getWeeklyReport(), [getWeeklyReport]);

  const todayEntries = useMemo(
    () => entries.filter((e) => dateToStr(e.startTime) === todayStr()),
    [entries]
  );

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.id, p);
    return m;
  }, [projects]);

  const getProjectColor = useCallback(
    (id: string) => projectMap.get(id)?.color ?? "#6b7280",
    [projectMap]
  );

  const getProjectName = useCallback(
    (id: string) => projectMap.get(id)?.name ?? id,
    [projectMap]
  );

  // ── Quick start ──────────────────────────────────────────────────────────

  const handleQuickStart = () => {
    if (!quickTask.trim()) return;
    const proj = quickProject || projects[0]?.id || "default";
    startTimer(proj, quickTask.trim());
    setQuickTask("");
  };

  const handleStop = () => stopTimer();

  const handlePause = () => {
    if (activeTimer?.pausedAt) resumeTimer();
    else pauseTimer();
  };

  // ── Manual entry ─────────────────────────────────────────────────────────

  const handleManualAdd = () => {
    if (!manualTask.trim()) return;
    const base = new Date(manualDate + "T00:00:00");
    const [sh, sm] = manualStart.split(":").map(Number);
    const [eh, em] = manualEnd.split(":").map(Number);
    const startTime = new Date(base).setHours(sh, sm, 0, 0);
    const endTime = new Date(base).setHours(eh, em, 0, 0);
    if (endTime <= startTime) return;
    addManualEntry({
      project: manualProject || projects[0]?.id || "default",
      task: manualTask.trim(),
      startTime,
      endTime,
      notes: manualNotes,
    });
    setShowManual(false);
    setManualTask("");
    setManualNotes("");
  };

  // ── Add project ──────────────────────────────────────────────────────────

  const handleAddProject = () => {
    if (!newProjectName.trim()) return;
    addProject({
      name: newProjectName.trim(),
      color: newProjectColor,
      client: newProjectClient,
      budget: newProjectBudget ? parseFloat(newProjectBudget) : null,
    });
    setShowAddProject(false);
    setNewProjectName("");
    setNewProjectClient("");
    setNewProjectBudget("");
  };

  // ── CSV export ───────────────────────────────────────────────────────────

  const handleExport = () => {
    const csv = exportTimesheet(reportFrom, reportTo);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timesheet_${reportFrom}_${reportTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Report-range entries ─────────────────────────────────────────────────

  const reportEntries = useMemo(
    () =>
      entries.filter(
        (e) => dateToStr(e.startTime) >= reportFrom && dateToStr(e.startTime) <= reportTo
      ),
    [entries, reportFrom, reportTo]
  );

  const reportStats = useMemo(() => {
    const total = reportEntries.reduce((s, e) => s + e.duration, 0);
    const billable = reportEntries.filter((e) => e.billable).reduce((s, e) => s + e.duration, 0);
    const aiCost = reportEntries.reduce((s, e) => s + e.aiCost, 0);
    const byProject = new Map<string, number>();
    for (const e of reportEntries) byProject.set(e.project, (byProject.get(e.project) ?? 0) + e.duration);
    const projectBreakdown = Array.from(byProject.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, time]) => ({ id, name: getProjectName(id), color: getProjectColor(id), time, pct: total ? Math.round((time / total) * 100) : 0 }));
    return { total, billable, aiCost, projectBreakdown };
  }, [reportEntries, getProjectName, getProjectColor]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#09090b] text-white">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[rgba(255,255,255,0.07)] px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-[rgba(255,255,255,0.5)] hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-lg font-semibold">Time Tracker</h1>
          </div>
          <button
            onClick={() => setShowManual(true)}
            className="text-xs px-3 py-1.5 rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
          >
            + Manual Entry
          </button>
        </div>

        {/* Active Timer Display */}
        <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 mb-3">
          {activeTimer ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full animate-pulse"
                  style={{ backgroundColor: getProjectColor(activeTimer.project) }}
                />
                <div>
                  <div className="text-sm font-medium">{activeTimer.task}</div>
                  <div className="text-xs text-[rgba(255,255,255,0.4)]">{getProjectName(activeTimer.project)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-2xl font-mono font-bold tabular-nums text-accent">
                  {formatDuration(activeTimer.elapsed)}
                </span>
                <button
                  onClick={handlePause}
                  className="p-2 rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
                  title={activeTimer.pausedAt ? "Resume" : "Pause"}
                >
                  {activeTimer.pausedAt ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={handleStop}
                  className="p-2 rounded-md bg-red-600 hover:bg-red-500 text-white transition-colors"
                  title="Stop"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h12v12H6z" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={quickProject}
                onChange={(e) => setQuickProject(e.target.value)}
                className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1.5 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {projects.length === 0 && <option value="">No projects</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={quickTask}
                onChange={(e) => setQuickTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleQuickStart()}
                placeholder="What are you working on?"
                className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={handleQuickStart}
                disabled={!quickTask.trim()}
                className="px-4 py-1.5 rounded-md bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-colors"
              >
                Start
              </button>
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="flex gap-4 text-xs text-[rgba(255,255,255,0.5)]">
          <span>Today: <b className="text-[rgba(255,255,255,0.85)]">{formatDuration(stats.todayTotal)}</b></span>
          <span>Week: <b className="text-[rgba(255,255,255,0.85)]">{formatDuration(stats.weekTotal)}</b></span>
          <span>Month: <b className="text-[rgba(255,255,255,0.85)]">{formatDuration(stats.monthTotal)}</b></span>
          {stats.aiCostTotal > 0 && (
            <span>AI Cost: <b className="text-amber-400">{formatCurrency(stats.aiCostTotal)}</b></span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-[rgba(255,255,255,0.07)] px-4">
        {TAB_ITEMS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-accent text-accent"
                : "border-transparent text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* ── Today Tab ────────────────────────────────────────────────── */}
        {tab === "today" && (
          <>
            {todayEntries.length === 0 && (
              <div className="text-center text-[rgba(255,255,255,0.4)] py-12">
                <p className="text-sm">No entries today yet.</p>
                <p className="text-xs mt-1">Start a timer or add a manual entry to begin tracking.</p>
              </div>
            )}
            {todayEntries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 hover:border-[rgba(255,255,255,0.1)] transition-colors cursor-pointer"
                onClick={() => {
                  if (editingEntry === entry.id) {
                    setEditingEntry(null);
                  } else {
                    setEditingEntry(entry.id);
                    setEditNotes(entry.notes);
                  }
                }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getProjectColor(entry.project) }}
                    />
                    <div>
                      <span className="text-sm font-medium">{entry.task}</span>
                      <span className="text-xs text-[rgba(255,255,255,0.4)] ml-2">{getProjectName(entry.project)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.aiTokensUsed > 0 && (
                      <span className="text-xs text-amber-400/70">{entry.aiTokensUsed.toLocaleString()} tok</span>
                    )}
                    <span className="text-sm font-mono tabular-nums text-[rgba(255,255,255,0.7)]">
                      {formatDuration(entry.duration)}
                    </span>
                    <span className="text-xs text-[rgba(255,255,255,0.4)]">
                      {timeStr(entry.startTime)} - {entry.endTime ? timeStr(entry.endTime) : "..."}
                    </span>
                  </div>
                </div>
                {entry.notes && !editingEntry && (
                  <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1 ml-5">{entry.notes}</p>
                )}
                {editingEntry === entry.id && (
                  <div className="mt-3 ml-5 space-y-2" onClick={(e) => e.stopPropagation()}>
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Add notes..."
                      rows={2}
                      className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-xs text-[rgba(255,255,255,0.85)] placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          updateEntry(entry.id, { notes: editNotes });
                          setEditingEntry(null);
                        }}
                        className="text-xs px-2.5 py-1 rounded bg-accent text-white hover:opacity-90"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          updateEntry(entry.id, { billable: !entry.billable });
                        }}
                        className={`text-xs px-2.5 py-1 rounded border ${
                          entry.billable
                            ? "border-emerald-600 text-emerald-400"
                            : "border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.5)]"
                        }`}
                      >
                        {entry.billable ? "Billable" : "Non-billable"}
                      </button>
                      <button
                        onClick={() => deleteEntry(entry.id)}
                        className="text-xs px-2.5 py-1 rounded border border-red-800 text-red-400 hover:bg-red-900/30"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {/* ── Week Tab ─────────────────────────────────────────────────── */}
        {tab === "week" && (
          <>
            <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-4">
              <h3 className="text-sm font-medium mb-3">
                Week of {weekReport.weekStart}
                <span className="text-[rgba(255,255,255,0.4)] ml-2">({formatHours(weekReport.totalTime)} total)</span>
              </h3>
              <div className="grid grid-cols-7 gap-2">
                {weekReport.days.map((day) => {
                  const maxH = Math.max(...weekReport.days.map((d) => d.totalTime), 1);
                  const barH = day.totalTime > 0 ? Math.max((day.totalTime / maxH) * 120, 4) : 0;
                  return (
                    <div key={day.date} className="flex flex-col items-center">
                      <div className="h-[130px] w-full flex flex-col justify-end items-center">
                        {day.projectBreakdown.length > 0 ? (
                          <div
                            className="w-8 rounded-t-sm overflow-hidden flex flex-col-reverse"
                            style={{ height: barH }}
                          >
                            {day.projectBreakdown.map((pb, i) => {
                              const segH = day.totalTime > 0 ? (pb.time / day.totalTime) * 100 : 0;
                              return (
                                <div
                                  key={i}
                                  style={{ backgroundColor: pb.color, height: `${segH}%` }}
                                  title={`${pb.project}: ${formatDuration(pb.time)}`}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="w-8 h-1 bg-[rgba(255,255,255,0.04)] rounded" />
                        )}
                      </div>
                      <span className="text-xs text-[rgba(255,255,255,0.4)] mt-1">{day.dayLabel}</span>
                      <span className="text-[10px] text-[rgba(255,255,255,0.3)] tabular-nums">
                        {day.totalTime > 0 ? formatHours(day.totalTime) : "--"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Week project totals */}
            <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-4">
              <h3 className="text-sm font-medium mb-3">Project Breakdown</h3>
              {weekReport.projectTotals.length === 0 && (
                <p className="text-xs text-[rgba(255,255,255,0.4)]">No tracked time this week.</p>
              )}
              {weekReport.projectTotals.map((pt) => (
                <div key={pt.name} className="flex items-center gap-2 py-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: pt.color }} />
                  <span className="text-sm flex-1">{getProjectName(pt.name)}</span>
                  <span className="text-sm font-mono tabular-nums text-[rgba(255,255,255,0.5)]">{formatHours(pt.time)}</span>
                  {pt.cost > 0 && (
                    <span className="text-xs text-amber-400/70">{formatCurrency(pt.cost)}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Week summary */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 text-center">
                <div className="text-lg font-bold tabular-nums">{formatHours(weekReport.totalTime)}</div>
                <div className="text-xs text-[rgba(255,255,255,0.4)]">Total</div>
              </div>
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 text-center">
                <div className="text-lg font-bold tabular-nums text-emerald-400">{formatHours(weekReport.totalBillable)}</div>
                <div className="text-xs text-[rgba(255,255,255,0.4)]">Billable</div>
              </div>
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 text-center">
                <div className="text-lg font-bold tabular-nums text-amber-400">{formatCurrency(weekReport.totalAiCost)}</div>
                <div className="text-xs text-[rgba(255,255,255,0.4)]">AI Cost</div>
              </div>
            </div>
          </>
        )}

        {/* ── Projects Tab ─────────────────────────────────────────────── */}
        {tab === "projects" && (
          <>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-medium text-[rgba(255,255,255,0.5)]">
                {projects.length} project{projects.length !== 1 ? "s" : ""}
              </h3>
              <button
                onClick={() => setShowAddProject(true)}
                className="text-xs px-3 py-1 rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
              >
                + New Project
              </button>
            </div>

            {showAddProject && (
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-4 space-y-3">
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Project name"
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent"
                  autoFocus
                />
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[rgba(255,255,255,0.5)]">Color:</span>
                  {DEFAULT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setNewProjectColor(c)}
                      className={`w-5 h-5 rounded-full border-2 transition-colors ${
                        newProjectColor === c ? "border-white" : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  value={newProjectClient}
                  onChange={(e) => setNewProjectClient(e.target.value)}
                  placeholder="Client (optional)"
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <input
                  type="number"
                  value={newProjectBudget}
                  onChange={(e) => setNewProjectBudget(e.target.value)}
                  placeholder="Budget in $ (optional)"
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddProject}
                    disabled={!newProjectName.trim()}
                    className="px-3 py-1.5 rounded-md bg-accent text-white text-sm hover:opacity-90 disabled:opacity-40"
                  >
                    Create Project
                  </button>
                  <button
                    onClick={() => setShowAddProject(false)}
                    className="px-3 py-1.5 rounded-md bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.7)] text-sm hover:bg-[rgba(255,255,255,0.07)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {projects.map((project) => {
              const report = getProjectReport(project.id);
              const utilization = project.budget && report
                ? Math.min((report.totalCost / project.budget) * 100, 100)
                : null;
              return (
                <div
                  key={project.id}
                  className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 hover:border-[rgba(255,255,255,0.1)] transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="text-sm font-medium">{project.name}</span>
                      {project.client && (
                        <span className="text-xs text-[rgba(255,255,255,0.4)]">{project.client}</span>
                      )}
                      {!project.active && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.4)]">Archived</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono tabular-nums text-[rgba(255,255,255,0.7)]">
                        {formatHours(project.totalTime)}
                      </span>
                      <button
                        onClick={() => updateProject(project.id, { active: !project.active })}
                        className="text-xs text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]"
                      >
                        {project.active ? "Archive" : "Restore"}
                      </button>
                    </div>
                  </div>
                  {project.budget !== null && utilization !== null && (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-[rgba(255,255,255,0.4)] mb-1">
                        <span>Budget: {formatCurrency(project.budget)}</span>
                        <span>{utilization.toFixed(0)}% used</span>
                      </div>
                      <div className="w-full h-1.5 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            utilization > 90
                              ? "bg-red-500"
                              : utilization > 70
                              ? "bg-amber-500"
                              : "bg-emerald-500"
                          }`}
                          style={{ width: `${utilization}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {report && report.aiCost > 0 && (
                    <div className="text-xs text-amber-400/70 mt-1">
                      AI cost: {formatCurrency(report.aiCost)}
                    </div>
                  )}
                </div>
              );
            })}

            {projects.length === 0 && !showAddProject && (
              <div className="text-center text-[rgba(255,255,255,0.4)] py-12">
                <p className="text-sm">No projects yet.</p>
                <p className="text-xs mt-1">Create a project to start organizing your time.</p>
              </div>
            )}
          </>
        )}

        {/* ── Reports Tab ──────────────────────────────────────────────── */}
        {tab === "reports" && (
          <>
            {/* Date range picker */}
            <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 flex items-center gap-3">
              <label className="text-xs text-[rgba(255,255,255,0.5)]">From:</label>
              <input
                type="date"
                value={reportFrom}
                onChange={(e) => setReportFrom(e.target.value)}
                className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <label className="text-xs text-[rgba(255,255,255,0.5)]">To:</label>
              <input
                type="date"
                value={reportTo}
                onChange={(e) => setReportTo(e.target.value)}
                className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="flex-1" />
              <button
                onClick={handleExport}
                className="text-xs px-3 py-1.5 rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
              >
                Export CSV
              </button>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 text-center">
                <div className="text-lg font-bold tabular-nums">{formatHours(reportStats.total)}</div>
                <div className="text-xs text-[rgba(255,255,255,0.4)]">Total Hours</div>
              </div>
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 text-center">
                <div className="text-lg font-bold tabular-nums text-emerald-400">{formatHours(reportStats.billable)}</div>
                <div className="text-xs text-[rgba(255,255,255,0.4)]">Billable Hours</div>
              </div>
              <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-3 text-center">
                <div className="text-lg font-bold tabular-nums text-amber-400">{formatCurrency(reportStats.aiCost)}</div>
                <div className="text-xs text-[rgba(255,255,255,0.4)]">AI Cost</div>
              </div>
            </div>

            {/* Time by project chart */}
            <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-4">
              <h3 className="text-sm font-medium mb-3">Time by Project</h3>
              {reportStats.projectBreakdown.length === 0 && (
                <p className="text-xs text-[rgba(255,255,255,0.4)]">No data in selected range.</p>
              )}
              {reportStats.projectBreakdown.map((pb) => (
                <div key={pb.id} className="mb-2">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pb.color }} />
                      <span className="text-[rgba(255,255,255,0.7)]">{pb.name}</span>
                    </div>
                    <span className="text-[rgba(255,255,255,0.5)] tabular-nums">{formatHours(pb.time)} ({pb.pct}%)</span>
                  </div>
                  <div className="w-full h-2 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pb.pct}%`, backgroundColor: pb.color }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Entries table */}
            <div className="rounded-lg bg-[#0a0a0f] border border-[rgba(255,255,255,0.07)] p-4">
              <h3 className="text-sm font-medium mb-3">
                Entries ({reportEntries.length})
              </h3>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {reportEntries.slice(0, 50).map((e) => (
                  <div key={e.id} className="flex items-center gap-2 py-1 text-xs">
                    <span className="text-[rgba(255,255,255,0.4)] tabular-nums w-20">{dateToStr(e.startTime)}</span>
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: getProjectColor(e.project) }}
                    />
                    <span className="flex-1 text-[rgba(255,255,255,0.7)] truncate">{e.task}</span>
                    <span className="tabular-nums text-[rgba(255,255,255,0.5)]">{formatDuration(e.duration)}</span>
                    {e.aiCost > 0 && (
                      <span className="text-amber-400/70 tabular-nums">{formatCurrency(e.aiCost)}</span>
                    )}
                  </div>
                ))}
                {reportEntries.length > 50 && (
                  <p className="text-xs text-[rgba(255,255,255,0.4)] pt-1">
                    ...and {reportEntries.length - 50} more. Export CSV for full data.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Manual Entry Modal ──────────────────────────────────────────── */}
      {showManual && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#0a0a0f] border border-[rgba(255,255,255,0.1)] rounded-xl p-5 w-[420px] shadow-xl space-y-3">
            <h2 className="text-sm font-semibold">Add Manual Entry</h2>
            <input
              type="date"
              value={manualDate}
              onChange={(e) => setManualDate(e.target.value)}
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <select
              value={manualProject}
              onChange={(e) => setManualProject(e.target.value)}
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={manualTask}
              onChange={(e) => setManualTask(e.target.value)}
              placeholder="Task description"
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-[rgba(255,255,255,0.5)] mb-1 block">Start</label>
                <input
                  type="time"
                  value={manualStart}
                  onChange={(e) => setManualStart(e.target.value)}
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-[rgba(255,255,255,0.5)] mb-1 block">End</label>
                <input
                  type="time"
                  value={manualEnd}
                  onChange={(e) => setManualEnd(e.target.value)}
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-[rgba(255,255,255,0.85)] focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>
            <textarea
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="Notes (optional)"
              rows={2}
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-[rgba(255,255,255,0.85)] placeholder:text-[rgba(255,255,255,0.4)] focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
            <div className="flex gap-2 pt-1">
              <button
                onClick={handleManualAdd}
                disabled={!manualTask.trim()}
                className="px-4 py-1.5 rounded-md bg-accent text-white text-sm hover:opacity-90 disabled:opacity-40"
              >
                Add Entry
              </button>
              <button
                onClick={() => setShowManual(false)}
                className="px-4 py-1.5 rounded-md bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.7)] text-sm hover:bg-[rgba(255,255,255,0.07)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
