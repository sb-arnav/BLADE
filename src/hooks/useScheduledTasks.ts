import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ScheduledTask {
  id: string;
  name: string;
  description: string;
  prompt: string;
  schedule: {
    type: "interval" | "daily" | "weekly" | "cron";
    intervalMs?: number;
    time?: string;           // "09:00" for daily/weekly
    dayOfWeek?: number;      // 0-6 for weekly (0=Sunday)
    cronExpression?: string; // for cron type
  };
  enabled: boolean;
  lastRun: number | null;
  nextRun: number | null;
  runCount: number;
  lastResult: string | null;
  lastError: string | null;
  outputDestination: "notification" | "knowledge" | "chat" | "file" | "clipboard";
  outputFilePath?: string;
  tools: string[];
  createdAt: number;
}

export interface TaskRunRecord {
  taskId: string;
  ranAt: number;
  durationMs: number;
  success: boolean;
  resultPreview: string;
  error: string | null;
}

// ── Storage ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-scheduled-tasks";
const HISTORY_KEY = "blade-scheduled-task-history";

function loadTasks(): ScheduledTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTasks(tasks: ScheduledTask[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

function loadHistory(): TaskRunRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: TaskRunRecord[]) {
  // Keep last 500 records
  const trimmed = history.slice(-500);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
}

// ── Schedule Calculation ───────────────────────────────────────────────────────

function parseTime(timeStr: string): { hours: number; minutes: number } {
  const [h, m] = timeStr.split(":").map(Number);
  return { hours: h || 0, minutes: m || 0 };
}

export function calculateNextRun(schedule: ScheduledTask["schedule"], fromTime: number = Date.now()): number {
  const now = new Date(fromTime);

  switch (schedule.type) {
    case "interval": {
      const ms = schedule.intervalMs || 3600000;
      return fromTime + ms;
    }

    case "daily": {
      const { hours, minutes } = parseTime(schedule.time || "08:00");
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      if (next.getTime() <= fromTime) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime();
    }

    case "weekly": {
      const { hours, minutes } = parseTime(schedule.time || "09:00");
      const targetDay = schedule.dayOfWeek ?? 1; // default Monday
      const next = new Date(now);
      next.setHours(hours, minutes, 0, 0);
      const currentDay = next.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= fromTime)) {
        daysUntil += 7;
      }
      next.setDate(next.getDate() + daysUntil);
      return next.getTime();
    }

    case "cron": {
      // Simplified cron: parse "minute hour dayOfMonth month dayOfWeek"
      // For now, treat as daily with parsed hour/minute from first two fields
      const parts = (schedule.cronExpression || "0 8 * * *").split(/\s+/);
      const minute = parts[0] === "*" ? 0 : parseInt(parts[0], 10);
      const hour = parts[1] === "*" ? 0 : parseInt(parts[1], 10);
      const dayOfWeekField = parts[4];

      if (dayOfWeekField && dayOfWeekField !== "*") {
        // Weekly-style cron
        const targetDay = parseInt(dayOfWeekField, 10);
        const next = new Date(now);
        next.setHours(hour, minute, 0, 0);
        const currentDay = next.getDay();
        let daysUntil = targetDay - currentDay;
        if (daysUntil < 0 || (daysUntil === 0 && next.getTime() <= fromTime)) {
          daysUntil += 7;
        }
        next.setDate(next.getDate() + daysUntil);
        return next.getTime();
      }

      // Daily-style cron
      const next = new Date(now);
      next.setHours(hour, minute, 0, 0);
      if (next.getTime() <= fromTime) {
        next.setDate(next.getDate() + 1);
      }
      return next.getTime();
    }

    default:
      return fromTime + 3600000;
  }
}

export function describeSchedule(schedule: ScheduledTask["schedule"]): string {
  switch (schedule.type) {
    case "interval": {
      const ms = schedule.intervalMs || 3600000;
      if (ms < 60000) return `Every ${Math.round(ms / 1000)}s`;
      if (ms < 3600000) return `Every ${Math.round(ms / 60000)} min`;
      if (ms < 86400000) return `Every ${Math.round(ms / 3600000)} hr`;
      return `Every ${Math.round(ms / 86400000)} day(s)`;
    }
    case "daily":
      return `Daily at ${schedule.time || "08:00"}`;
    case "weekly": {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return `${days[schedule.dayOfWeek ?? 1]} at ${schedule.time || "09:00"}`;
    }
    case "cron":
      return `Cron: ${schedule.cronExpression || "0 8 * * *"}`;
    default:
      return "Unknown schedule";
  }
}

export function getNextCronRuns(expression: string, count: number = 3): Date[] {
  const runs: Date[] = [];
  let cursor = Date.now();
  const schedule: ScheduledTask["schedule"] = { type: "cron", cronExpression: expression };
  for (let i = 0; i < count; i++) {
    cursor = calculateNextRun(schedule, cursor);
    runs.push(new Date(cursor));
    cursor += 1000; // advance past this run
  }
  return runs;
}

// ── Preset Tasks ───────────────────────────────────────────────────────────────

function makePreset(
  name: string,
  description: string,
  prompt: string,
  schedule: ScheduledTask["schedule"],
  output: ScheduledTask["outputDestination"],
  tools: string[] = []
): Omit<ScheduledTask, "id" | "createdAt"> {
  return {
    name,
    description,
    prompt,
    schedule,
    enabled: false,
    lastRun: null,
    nextRun: calculateNextRun(schedule),
    runCount: 0,
    lastResult: null,
    lastError: null,
    outputDestination: output,
    tools,
  };
}

export const PRESET_TASKS: Array<Omit<ScheduledTask, "id" | "createdAt">> = [
  makePreset(
    "Morning Briefing",
    "Summarize overnight news and today's calendar to start the day",
    "Give me a concise morning briefing: summarize any important overnight tech news, trending topics in AI/dev, and outline what a productive day could look like. Keep it under 300 words.",
    { type: "daily", time: "08:00" },
    "notification",
    ["web_search"]
  ),
  makePreset(
    "Code Health Check",
    "Run TypeScript checks and review git status for issues",
    "Run a code health check: execute `tsc --noEmit` and `git status`. Summarize any type errors, uncommitted changes, or potential issues. List actionable items.",
    { type: "daily", time: "18:00" },
    "chat",
    ["terminal", "git"]
  ),
  makePreset(
    "Dependency Monitor",
    "Check for outdated packages and security vulnerabilities",
    "Check for outdated npm dependencies using `npm outdated` and look for known vulnerabilities with `npm audit`. Summarize findings with severity levels and recommend which packages to update first.",
    { type: "weekly", dayOfWeek: 1, time: "09:00" },
    "notification",
    ["terminal"]
  ),
  makePreset(
    "Knowledge Consolidation",
    "Review and consolidate the day's learnings into knowledge base",
    "Review today's conversations and extract the most valuable insights, code patterns, and learnings. Consolidate them into well-organized summaries suitable for a knowledge base. Focus on reusable patterns and important decisions.",
    { type: "daily", time: "00:00" },
    "knowledge",
    []
  ),
  makePreset(
    "Weekly Report",
    "Generate a summary of the week's conversations and productivity",
    "Generate a weekly productivity report: summarize the key topics discussed this week, major decisions made, code changes, problems solved, and areas for improvement. Format as a structured report with bullet points.",
    { type: "weekly", dayOfWeek: 5, time: "17:00" },
    "chat",
    []
  ),
  makePreset(
    "Security Scan",
    "Scan codebase for exposed secrets, tokens, and credentials",
    "Scan the current codebase for potential security issues: look for hardcoded API keys, tokens, passwords, or credentials in source files. Check .env files aren't committed. Report any findings with file locations and severity.",
    { type: "weekly", dayOfWeek: 3, time: "10:00" },
    "notification",
    ["terminal", "file_search"]
  ),
];

// ── Check Interval ─────────────────────────────────────────────────────────────

const CHECK_INTERVAL_MS = 60_000; // 60 seconds

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useScheduledTasks() {
  const [tasks, setTasks] = useState<ScheduledTask[]>(loadTasks);
  const [history, setHistory] = useState<TaskRunRecord[]>(loadHistory);
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);
  const tasksRef = useRef(tasks);
  const runningRef = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Persist tasks whenever they change
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  // Persist history whenever it changes
  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // ── Execute a single task ──────────────────────────────────────────────────

  const executeTask = useCallback(async (taskId: string): Promise<void> => {
    const task = tasksRef.current.find((t) => t.id === taskId);
    if (!task || runningRef.current) return;

    runningRef.current = true;
    setRunningTaskId(taskId);
    const startedAt = Date.now();
    let resultBuffer = "";

    // Listen for stream tokens
    const unlisten = await listen<string>("chat_token", (event) => {
      resultBuffer += event.payload;
    });

    const donePromise = new Promise<void>((resolve) => {
      let doneListen: (() => void) | null = null;
      listen("chat_done", () => {
        resolve();
        doneListen?.();
      }).then((fn) => { doneListen = fn; });
    });

    try {
      await invoke("send_message_stream", {
        messages: [
          { role: "user", content: task.prompt },
        ],
      });

      // Wait for done signal (with 5 minute timeout)
      await Promise.race([
        donePromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("Task execution timed out after 5 minutes")), 300_000)
        ),
      ]);

      const result = resultBuffer.trim() || "(no output)";
      const durationMs = Date.now() - startedAt;

      // Update task state
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                lastRun: Date.now(),
                nextRun: t.enabled ? calculateNextRun(t.schedule) : t.nextRun,
                runCount: t.runCount + 1,
                lastResult: result,
                lastError: null,
              }
            : t
        )
      );

      // Record in history
      setHistory((prev) => [
        ...prev,
        {
          taskId,
          ranAt: startedAt,
          durationMs,
          success: true,
          resultPreview: result.slice(0, 500),
          error: null,
        },
      ]);

      // Route output to destination
      await routeOutput(task, result);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                lastRun: Date.now(),
                nextRun: t.enabled ? calculateNextRun(t.schedule) : t.nextRun,
                runCount: t.runCount + 1,
                lastResult: null,
                lastError: errorMsg,
              }
            : t
        )
      );

      setHistory((prev) => [
        ...prev,
        {
          taskId,
          ranAt: startedAt,
          durationMs: Date.now() - startedAt,
          success: false,
          resultPreview: "",
          error: errorMsg,
        },
      ]);
    } finally {
      unlisten();
      runningRef.current = false;
      setRunningTaskId(null);
    }
  }, []);

  // ── Route output to chosen destination ─────────────────────────────────────

  const routeOutput = useCallback(async (task: ScheduledTask, result: string) => {
    switch (task.outputDestination) {
      case "notification":
        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(`Blade: ${task.name}`, {
            body: result.slice(0, 200),
          });
        }
        break;

      case "clipboard":
        try {
          await navigator.clipboard.writeText(result);
        } catch {
          // Clipboard write may fail if window not focused
        }
        break;

      case "knowledge":
        // Store in knowledge base via localStorage
        try {
          const kbRaw = localStorage.getItem("blade-knowledge");
          const kb = kbRaw ? JSON.parse(kbRaw) : [];
          kb.push({
            id: crypto.randomUUID(),
            title: `[Scheduled] ${task.name} — ${new Date().toLocaleDateString()}`,
            content: result,
            tags: ["scheduled-task", task.name.toLowerCase().replace(/\s+/g, "-")],
            source: "auto",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          localStorage.setItem("blade-knowledge", JSON.stringify(kb));
        } catch {
          // Silently fail if knowledge storage is unavailable
        }
        break;

      case "file":
        if (task.outputFilePath) {
          try {
            await invoke("write_file", {
              path: task.outputFilePath,
              content: `# ${task.name}\n_Generated: ${new Date().toISOString()}_\n\n${result}`,
            });
          } catch {
            // File write failure
          }
        }
        break;

      case "chat":
        // Chat output is already captured via stream — no extra action needed
        break;
    }
  }, []);

  // ── Scheduler: check for due tasks every 60 seconds ────────────────────────

  useEffect(() => {
    const checkDueTasks = () => {
      if (runningRef.current) return;

      const now = Date.now();
      const due = tasksRef.current.find(
        (t) => t.enabled && t.nextRun !== null && t.nextRun <= now
      );

      if (due) {
        executeTask(due.id);
      }
    };

    // Initial check
    checkDueTasks();

    const interval = setInterval(checkDueTasks, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [executeTask]);

  // ── CRUD Operations ────────────────────────────────────────────────────────

  const addTask = useCallback((partial: Omit<ScheduledTask, "id" | "createdAt" | "lastRun" | "nextRun" | "runCount" | "lastResult" | "lastError">) => {
    const task: ScheduledTask = {
      ...partial,
      id: crypto.randomUUID(),
      lastRun: null,
      nextRun: partial.enabled ? calculateNextRun(partial.schedule) : null,
      runCount: 0,
      lastResult: null,
      lastError: null,
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, task]);
    return task;
  }, []);

  const updateTask = useCallback((id: string, updates: Partial<ScheduledTask>) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const merged = { ...t, ...updates };
        // Recalculate nextRun if schedule changed or task toggled
        if (updates.schedule || updates.enabled !== undefined) {
          merged.nextRun = merged.enabled ? calculateNextRun(merged.schedule) : null;
        }
        return merged;
      })
    );
  }, []);

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setHistory((prev) => prev.filter((r) => r.taskId !== id));
  }, []);

  const toggleTask = useCallback((id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const enabled = !t.enabled;
        return {
          ...t,
          enabled,
          nextRun: enabled ? calculateNextRun(t.schedule) : null,
        };
      })
    );
  }, []);

  const runNow = useCallback((id: string) => {
    executeTask(id);
  }, [executeTask]);

  const getTaskHistory = useCallback(
    (taskId: string): TaskRunRecord[] => history.filter((r) => r.taskId === taskId),
    [history]
  );

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeCount = useMemo(() => tasks.filter((t) => t.enabled).length, [tasks]);

  const getNextRun = useCallback(
    (taskId: string): number | null => {
      const task = tasks.find((t) => t.id === taskId);
      return task?.nextRun ?? null;
    },
    [tasks]
  );

  return {
    tasks,
    history,
    runningTaskId,
    addTask,
    updateTask,
    deleteTask,
    toggleTask,
    runNow,
    getNextRun,
    getTaskHistory,
    activeCount,
  };
}
