import { useState, useMemo, useEffect } from "react";
import {
  useScheduledTasks,
  ScheduledTask,
  PRESET_TASKS,
  describeSchedule,
  getNextCronRuns,
  TaskRunRecord,
} from "../hooks/useScheduledTasks";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const OUTPUT_OPTIONS: { value: ScheduledTask["outputDestination"]; label: string; icon: string }[] = [
  { value: "notification", label: "Notification", icon: "\uD83D\uDD14" },
  { value: "knowledge", label: "Knowledge Base", icon: "\uD83D\uDCD6" },
  { value: "chat", label: "Chat Window", icon: "\uD83D\uDCAC" },
  { value: "file", label: "File", icon: "\uD83D\uDCC4" },
  { value: "clipboard", label: "Clipboard", icon: "\uD83D\uDCCB" },
];

const INTERVAL_UNITS = [
  { label: "Minutes", ms: 60_000 },
  { label: "Hours", ms: 3_600_000 },
  { label: "Days", ms: 86_400_000 },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PRESET_ICONS: Record<string, string> = {
  "Morning Briefing": "\u2600\uFE0F",
  "Code Health Check": "\uD83E\uDE7A",
  "Dependency Monitor": "\uD83D\uDCE6",
  "Knowledge Consolidation": "\uD83E\uDDE0",
  "Weekly Report": "\uD83D\uDCCA",
  "Security Scan": "\uD83D\uDD12",
};

// ── Utility ────────────────────────────────────────────────────────────────────

function formatCountdown(nextRun: number | null): string {
  if (!nextRun) return "Not scheduled";
  const diff = nextRun - Date.now();
  if (diff <= 0) return "Due now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d ${hours % 24}h`;
}

function formatTime(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

// ── Task Card ──────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  isRunning,
  expanded,
  onToggle,
  onExpand,
  onRunNow,
  onDelete,
  onUpdate: _onUpdate,
  history,
}: {
  task: ScheduledTask;
  isRunning: boolean;
  expanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
  onRunNow: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<ScheduledTask>) => void;
  history: TaskRunRecord[];
}) {
  const statusColor = !task.enabled
    ? "bg-blade-muted/40"
    : task.lastError
    ? "bg-red-500"
    : "bg-emerald-500";

  const statusPulse = isRunning;

  return (
    <div
      className={`bg-blade-surface border rounded-xl transition-all ${
        expanded ? "border-blade-accent/30" : "border-blade-border hover:border-blade-accent/15"
      }`}
    >
      {/* Summary row */}
      <button
        onClick={onExpand}
        className="w-full text-left p-3 flex items-center gap-3"
      >
        {/* Status dot */}
        <span className="relative flex shrink-0">
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
          {statusPulse && (
            <span className={`absolute inset-0 w-2.5 h-2.5 rounded-full ${statusColor} animate-ping opacity-75`} />
          )}
        </span>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-blade-text">{task.name}</span>
            {isRunning && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent/15 text-blade-accent font-medium">
                Running
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-2xs text-blade-muted">{describeSchedule(task.schedule)}</span>
            <span className="text-2xs text-blade-muted/40">\u00B7</span>
            <span className="text-2xs text-blade-muted/60">{formatCountdown(task.nextRun)}</span>
          </div>
        </div>

        {/* Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`relative w-8 h-4.5 rounded-full transition-colors shrink-0 ${
            task.enabled ? "bg-blade-accent" : "bg-blade-border"
          }`}
        >
          <span
            className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform ${
              task.enabled ? "translate-x-4" : "translate-x-0.5"
            }`}
          />
        </button>

        {/* Expand chevron */}
        <span className="text-2xs text-blade-muted/30 shrink-0">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 pt-0 border-t border-blade-border/30 animate-fade-in">
          {/* Description */}
          <p className="text-2xs text-blade-muted mt-2.5 leading-relaxed">
            {task.description}
          </p>

          {/* Prompt preview */}
          <div className="mt-2.5 bg-blade-bg rounded-lg p-2">
            <p className="text-2xs text-blade-muted/50 mb-1 font-medium">Prompt</p>
            <p className="text-2xs text-blade-secondary leading-relaxed">
              {truncate(task.prompt, 200)}
            </p>
          </div>

          {/* Meta row */}
          <div className="flex items-center gap-3 mt-2.5 text-2xs text-blade-muted/60">
            <span>Runs: {task.runCount}</span>
            <span>\u00B7</span>
            <span>Last: {formatTime(task.lastRun)}</span>
            <span>\u00B7</span>
            <span>Output: {OUTPUT_OPTIONS.find((o) => o.value === task.outputDestination)?.label}</span>
          </div>

          {/* Tools */}
          {task.tools.length > 0 && (
            <div className="flex gap-1 mt-2 flex-wrap">
              {task.tools.map((t) => (
                <span
                  key={t}
                  className="text-2xs text-blade-muted/40 bg-blade-bg rounded px-1.5 py-0.5"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Last result / error */}
          {task.lastResult && (
            <div className="mt-2.5 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-2">
              <p className="text-2xs text-emerald-400/60 mb-1 font-medium">Last Result</p>
              <p className="text-2xs text-blade-secondary leading-relaxed whitespace-pre-wrap">
                {truncate(task.lastResult, 400)}
              </p>
            </div>
          )}
          {task.lastError && (
            <div className="mt-2.5 bg-red-500/5 border border-red-500/10 rounded-lg p-2">
              <p className="text-2xs text-red-400/60 mb-1 font-medium">Last Error</p>
              <p className="text-2xs text-red-300 leading-relaxed">{task.lastError}</p>
            </div>
          )}

          {/* Run history */}
          {history.length > 0 && (
            <div className="mt-2.5">
              <p className="text-2xs text-blade-muted/50 font-medium mb-1">Recent Runs</p>
              <div className="space-y-1 max-h-28 overflow-y-auto">
                {history.slice(-5).reverse().map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-2xs text-blade-muted/60"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${r.success ? "bg-emerald-500" : "bg-red-500"}`} />
                    <span>{formatTime(r.ranAt)}</span>
                    <span className="text-blade-muted/30">\u00B7</span>
                    <span>{Math.round(r.durationMs / 1000)}s</span>
                    {r.error && (
                      <>
                        <span className="text-blade-muted/30">\u00B7</span>
                        <span className="text-red-400">{truncate(r.error, 60)}</span>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={onRunNow}
              disabled={isRunning}
              className="text-2xs px-3 py-1.5 rounded-lg bg-blade-accent text-white hover:bg-blade-accent-hover disabled:opacity-30 transition-colors font-medium"
            >
              Run Now
            </button>
            <button
              onClick={onDelete}
              className="text-2xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Task Form ──────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  description: string;
  prompt: string;
  scheduleType: ScheduledTask["schedule"]["type"];
  intervalValue: number;
  intervalUnit: number; // ms per unit
  dailyTime: string;
  weeklyDay: number;
  weeklyTime: string;
  cronExpression: string;
  outputDestination: ScheduledTask["outputDestination"];
  outputFilePath: string;
  tools: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  description: "",
  prompt: "",
  scheduleType: "daily",
  intervalValue: 30,
  intervalUnit: 60_000,
  dailyTime: "09:00",
  weeklyDay: 1,
  weeklyTime: "09:00",
  cronExpression: "0 8 * * *",
  outputDestination: "notification",
  outputFilePath: "",
  tools: "",
};

function AddTaskForm({ onAdd, onCancel }: { onAdd: (task: Parameters<ReturnType<typeof useScheduledTasks>["addTask"]>[0]) => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const cronPreview = useMemo(() => {
    if (form.scheduleType !== "cron") return [];
    try {
      return getNextCronRuns(form.cronExpression, 3);
    } catch {
      return [];
    }
  }, [form.scheduleType, form.cronExpression]);

  const buildSchedule = (): ScheduledTask["schedule"] => {
    switch (form.scheduleType) {
      case "interval":
        return { type: "interval", intervalMs: form.intervalValue * form.intervalUnit };
      case "daily":
        return { type: "daily", time: form.dailyTime };
      case "weekly":
        return { type: "weekly", dayOfWeek: form.weeklyDay, time: form.weeklyTime };
      case "cron":
        return { type: "cron", cronExpression: form.cronExpression };
    }
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.prompt.trim()) return;
    onAdd({
      name: form.name.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      schedule: buildSchedule(),
      enabled: true,
      outputDestination: form.outputDestination,
      outputFilePath: form.outputFilePath || undefined,
      tools: form.tools
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  };

  const inputCls =
    "w-full bg-blade-bg border border-blade-border rounded-lg px-2.5 py-1.5 text-2xs text-blade-text outline-none focus:border-blade-accent/30 transition-colors";
  const labelCls = "text-2xs text-blade-muted/60 font-medium mb-1 block";

  return (
    <div className="bg-blade-surface border border-blade-border rounded-xl p-3 space-y-3 animate-fade-in">
      <p className="text-xs font-medium text-blade-text">New Scheduled Task</p>

      {/* Name + Description */}
      <div>
        <label className={labelCls}>Name</label>
        <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Task name" className={inputCls} />
      </div>
      <div>
        <label className={labelCls}>Description</label>
        <input value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Short description" className={inputCls} />
      </div>

      {/* Prompt */}
      <div>
        <label className={labelCls}>Prompt</label>
        <textarea
          value={form.prompt}
          onChange={(e) => set("prompt", e.target.value)}
          placeholder="What should the AI do?"
          rows={4}
          className={`${inputCls} resize-none`}
        />
      </div>

      {/* Schedule type picker */}
      <div>
        <label className={labelCls}>Schedule</label>
        <div className="flex gap-1">
          {(["interval", "daily", "weekly", "cron"] as const).map((type) => (
            <button
              key={type}
              onClick={() => set("scheduleType", type)}
              className={`text-2xs px-2.5 py-1 rounded-lg transition-colors font-medium capitalize ${
                form.scheduleType === type
                  ? "bg-blade-accent text-white"
                  : "bg-blade-bg text-blade-muted hover:text-blade-text"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      {/* Schedule config per type */}
      {form.scheduleType === "interval" && (
        <div className="flex items-center gap-2">
          <label className="text-2xs text-blade-muted/60 shrink-0">Every</label>
          <input
            type="number"
            min={1}
            value={form.intervalValue}
            onChange={(e) => set("intervalValue", Math.max(1, parseInt(e.target.value) || 1))}
            className={`${inputCls} w-20`}
          />
          <select
            value={form.intervalUnit}
            onChange={(e) => set("intervalUnit", parseInt(e.target.value))}
            className={`${inputCls} w-28`}
          >
            {INTERVAL_UNITS.map((u) => (
              <option key={u.ms} value={u.ms}>
                {u.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {form.scheduleType === "daily" && (
        <div className="flex items-center gap-2">
          <label className="text-2xs text-blade-muted/60 shrink-0">Time</label>
          <input
            type="time"
            value={form.dailyTime}
            onChange={(e) => set("dailyTime", e.target.value)}
            className={`${inputCls} w-32`}
          />
        </div>
      )}

      {form.scheduleType === "weekly" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-2xs text-blade-muted/60 shrink-0">Day</label>
            <div className="flex gap-1">
              {DAY_NAMES.map((day, i) => (
                <button
                  key={i}
                  onClick={() => set("weeklyDay", i)}
                  className={`text-2xs px-2 py-1 rounded-lg transition-colors font-medium ${
                    form.weeklyDay === i
                      ? "bg-blade-accent text-white"
                      : "bg-blade-bg text-blade-muted hover:text-blade-text"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-2xs text-blade-muted/60 shrink-0">Time</label>
            <input
              type="time"
              value={form.weeklyTime}
              onChange={(e) => set("weeklyTime", e.target.value)}
              className={`${inputCls} w-32`}
            />
          </div>
        </div>
      )}

      {form.scheduleType === "cron" && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-2xs text-blade-muted/60 shrink-0">Expression</label>
            <input
              value={form.cronExpression}
              onChange={(e) => set("cronExpression", e.target.value)}
              placeholder="0 8 * * *"
              className={`${inputCls} flex-1 font-mono`}
            />
          </div>
          {cronPreview.length > 0 && (
            <div className="bg-blade-bg rounded-lg p-2">
              <p className="text-2xs text-blade-muted/50 mb-1">Next 3 runs:</p>
              {cronPreview.map((d, i) => (
                <p key={i} className="text-2xs text-blade-muted/70">
                  {d.toLocaleString()}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Output destination */}
      <div>
        <label className={labelCls}>Output Destination</label>
        <div className="flex gap-1 flex-wrap">
          {OUTPUT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => set("outputDestination", opt.value)}
              className={`text-2xs px-2.5 py-1 rounded-lg transition-colors font-medium ${
                form.outputDestination === opt.value
                  ? "bg-blade-accent text-white"
                  : "bg-blade-bg text-blade-muted hover:text-blade-text"
              }`}
            >
              {opt.icon} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {form.outputDestination === "file" && (
        <div>
          <label className={labelCls}>File Path</label>
          <input
            value={form.outputFilePath}
            onChange={(e) => set("outputFilePath", e.target.value)}
            placeholder="/path/to/output.md"
            className={inputCls}
          />
        </div>
      )}

      {/* Tools */}
      <div>
        <label className={labelCls}>Tools (comma-separated)</label>
        <input
          value={form.tools}
          onChange={(e) => set("tools", e.target.value)}
          placeholder="terminal, git, web_search"
          className={inputCls}
        />
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={!form.name.trim() || !form.prompt.trim()}
          className="text-2xs px-4 py-1.5 rounded-lg bg-blade-accent text-white hover:bg-blade-accent-hover disabled:opacity-30 transition-colors font-medium"
        >
          Create Task
        </button>
        <button
          onClick={onCancel}
          className="text-2xs px-4 py-1.5 rounded-lg bg-blade-bg text-blade-muted hover:text-blade-text transition-colors font-medium"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

export default function ScheduledTasksPanel({ onBack }: Props) {
  const {
    tasks,
    runningTaskId,
    addTask,
    updateTask,
    deleteTask,
    toggleTask,
    runNow,
    getTaskHistory,
    activeCount,
  } = useScheduledTasks();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [, setTick] = useState(0);

  // Tick every 30s to refresh countdowns
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, []);

  const handleAddPreset = (preset: (typeof PRESET_TASKS)[number]) => {
    addTask(preset);
  };

  const handleAddCustom = (task: Parameters<typeof addTask>[0]) => {
    addTask(task);
    setShowAddForm(false);
  };

  return (
    <div className="flex flex-col h-full bg-blade-bg">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-blade-border shrink-0">
        <button
          onClick={onBack}
          className="text-blade-muted hover:text-blade-text transition-colors text-xs"
        >
          \u2190
        </button>
        <h2 className="text-xs font-semibold text-blade-text tracking-tight flex-1">
          Scheduled Tasks
        </h2>
        {activeCount > 0 && (
          <span className="text-2xs px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
            {activeCount} active
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2.5">
        {/* Task list */}
        {tasks.length === 0 && !showAddForm && !showPresets && (
          <div className="text-center py-8">
            <p className="text-2xs text-blade-muted/40">No scheduled tasks yet</p>
            <p className="text-2xs text-blade-muted/30 mt-1">
              Add a preset or create a custom task below
            </p>
          </div>
        )}

        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            isRunning={runningTaskId === task.id}
            expanded={expandedId === task.id}
            onToggle={() => toggleTask(task.id)}
            onExpand={() => setExpandedId(expandedId === task.id ? null : task.id)}
            onRunNow={() => runNow(task.id)}
            onDelete={() => {
              deleteTask(task.id);
              if (expandedId === task.id) setExpandedId(null);
            }}
            onUpdate={(updates) => updateTask(task.id, updates)}
            history={getTaskHistory(task.id)}
          />
        ))}

        {/* Preset templates section */}
        {showPresets && (
          <div className="bg-blade-surface border border-blade-border rounded-xl p-3 animate-fade-in">
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-medium text-blade-text">Preset Templates</p>
              <button
                onClick={() => setShowPresets(false)}
                className="text-2xs text-blade-muted hover:text-blade-text transition-colors"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {PRESET_TASKS.map((preset) => {
                const alreadyAdded = tasks.some((t) => t.name === preset.name);
                return (
                  <button
                    key={preset.name}
                    onClick={() => !alreadyAdded && handleAddPreset(preset)}
                    disabled={alreadyAdded}
                    className={`text-left p-2.5 rounded-lg transition-all ${
                      alreadyAdded
                        ? "bg-blade-bg/50 opacity-40 cursor-not-allowed"
                        : "bg-blade-bg hover:bg-blade-bg/80 hover:border-blade-accent/15 border border-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm mt-0.5">
                        {PRESET_ICONS[preset.name] || "\u23F0"}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-2xs font-medium text-blade-text">
                          {preset.name}
                          {alreadyAdded && (
                            <span className="text-blade-muted/40 ml-1.5 font-normal">
                              (added)
                            </span>
                          )}
                        </p>
                        <p className="text-2xs text-blade-muted/60 mt-0.5 leading-relaxed">
                          {preset.description}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-2xs text-blade-muted/40">
                            {describeSchedule(preset.schedule)}
                          </span>
                          <span className="text-2xs text-blade-muted/30">\u00B7</span>
                          <span className="text-2xs text-blade-muted/40">
                            {OUTPUT_OPTIONS.find((o) => o.value === preset.outputDestination)?.icon}{" "}
                            {OUTPUT_OPTIONS.find((o) => o.value === preset.outputDestination)?.label}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Add form */}
        {showAddForm && (
          <AddTaskForm onAdd={handleAddCustom} onCancel={() => setShowAddForm(false)} />
        )}
      </div>

      {/* Footer actions */}
      {!showAddForm && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-blade-border shrink-0">
          <button
            onClick={() => {
              setShowAddForm(true);
              setShowPresets(false);
            }}
            className="text-2xs px-3 py-1.5 rounded-lg bg-blade-accent text-white hover:bg-blade-accent-hover transition-colors font-medium"
          >
            + New Task
          </button>
          <button
            onClick={() => {
              setShowPresets(!showPresets);
              setShowAddForm(false);
            }}
            className="text-2xs px-3 py-1.5 rounded-lg bg-blade-bg text-blade-muted hover:text-blade-text border border-blade-border transition-colors font-medium"
          >
            Presets
          </button>
          {runningTaskId && (
            <span className="text-2xs text-blade-accent/70 ml-auto animate-pulse">
              Task running...
            </span>
          )}
        </div>
      )}
    </div>
  );
}
