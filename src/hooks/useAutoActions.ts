import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Auto Actions — Blade performs actions automatically based on triggers.
 *
 * Like IFTTT/Zapier but local and AI-powered:
 * - "When I copy an error, auto-debug it"
 * - "When a new file is created, auto-review it"
 * - "When I switch to VS Code, set skill mode to Senior Dev"
 * - "Every morning, summarize yesterday's conversations"
 */

export interface AutoAction {
  id: string;
  name: string;
  description: string;
  trigger: {
    type: "clipboard" | "app_switch" | "file_change" | "time" | "keyword" | "manual";
    config: Record<string, string>;
  };
  action: {
    type: "chat" | "skill_mode" | "notification" | "clipboard" | "file" | "command";
    config: Record<string, string>;
  };
  enabled: boolean;
  runCount: number;
  lastRun: number | null;
  lastError: string | null;
  createdAt: number;
  cooldownMs: number; // minimum time between runs
}

const STORAGE_KEY = "blade-auto-actions";
const MAX_ACTIONS = 50;

const PRESET_ACTIONS: Omit<AutoAction, "id" | "runCount" | "lastRun" | "lastError" | "createdAt">[] = [
  {
    name: "Auto-Debug Errors",
    description: "When you copy an error message, Blade automatically debugs it",
    trigger: { type: "clipboard", config: { pattern: "Error|Exception|Traceback|FAILED|panic" } },
    action: { type: "chat", config: { prompt: "Debug this error:\n\n{{content}}" } },
    enabled: false,
    cooldownMs: 30000,
  },
  {
    name: "Auto-Explain Code",
    description: "When you copy code, Blade explains what it does",
    trigger: { type: "clipboard", config: { pattern: "function |const |let |def |class |fn |pub " } },
    action: { type: "chat", config: { prompt: "Explain this code:\n\n{{content}}" } },
    enabled: false,
    cooldownMs: 30000,
  },
  {
    name: "Coding Mode on VS Code",
    description: "Switch to Senior Dev skill mode when VS Code is focused",
    trigger: { type: "app_switch", config: { appName: "code" } },
    action: { type: "skill_mode", config: { mode: "senior-dev" } },
    enabled: false,
    cooldownMs: 60000,
  },
  {
    name: "Writing Mode on Docs",
    description: "Switch to Technical Writer when Google Docs or Notion is focused",
    trigger: { type: "app_switch", config: { appName: "docs|notion" } },
    action: { type: "skill_mode", config: { mode: "technical-writer" } },
    enabled: false,
    cooldownMs: 60000,
  },
  {
    name: "Auto-Translate",
    description: "When you copy non-English text, auto-translate to English",
    trigger: { type: "clipboard", config: { pattern: "[\\u00C0-\\u024F\\u0400-\\u04FF\\u4E00-\\u9FFF\\u3040-\\u309F]" } },
    action: { type: "chat", config: { prompt: "Translate this to English:\n\n{{content}}" } },
    enabled: false,
    cooldownMs: 15000,
  },
  {
    name: "Summarize Long Text",
    description: "When you copy text longer than 500 words, auto-summarize",
    trigger: { type: "clipboard", config: { minLength: "2000" } },
    action: { type: "chat", config: { prompt: "Summarize the key points:\n\n{{content}}" } },
    enabled: false,
    cooldownMs: 30000,
  },
  {
    name: "URL Analysis",
    description: "When you copy a URL, fetch and summarize the page",
    trigger: { type: "clipboard", config: { pattern: "^https?://" } },
    action: { type: "chat", config: { prompt: "Summarize this page: {{content}}" } },
    enabled: false,
    cooldownMs: 30000,
  },
  {
    name: "Morning Standup",
    description: "At 9am, generate a standup summary from yesterday's work",
    trigger: { type: "time", config: { hour: "9", minute: "0" } },
    action: { type: "chat", config: { prompt: "Generate my standup update based on yesterday's conversations and activity" } },
    enabled: false,
    cooldownMs: 86400000, // once per day
  },
];

function loadActions(): AutoAction[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveActions(actions: AutoAction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actions.slice(0, MAX_ACTIONS)));
}

export function useAutoActions() {
  const [actions, setActions] = useState<AutoAction[]>(loadActions);
  const lastRunTimesRef = useRef<Record<string, number>>({});

  const addAction = useCallback((action: Omit<AutoAction, "id" | "runCount" | "lastRun" | "lastError" | "createdAt">) => {
    const newAction: AutoAction = {
      ...action,
      id: crypto.randomUUID(),
      runCount: 0,
      lastRun: null,
      lastError: null,
      createdAt: Date.now(),
    };
    setActions((prev) => {
      const next = [...prev, newAction].slice(0, MAX_ACTIONS);
      saveActions(next);
      return next;
    });
    return newAction.id;
  }, []);

  const addFromPreset = useCallback((index: number) => {
    const preset = PRESET_ACTIONS[index];
    if (!preset) return null;
    return addAction(preset);
  }, [addAction]);

  const updateAction = useCallback((id: string, updates: Partial<AutoAction>) => {
    setActions((prev) => {
      const next = prev.map((a) => a.id === id ? { ...a, ...updates } : a);
      saveActions(next);
      return next;
    });
  }, []);

  const deleteAction = useCallback((id: string) => {
    setActions((prev) => {
      const next = prev.filter((a) => a.id !== id);
      saveActions(next);
      return next;
    });
  }, []);

  const toggleAction = useCallback((id: string) => {
    setActions((prev) => {
      const next = prev.map((a) => a.id === id ? { ...a, enabled: !a.enabled } : a);
      saveActions(next);
      return next;
    });
  }, []);

  // Check if an action should run (respecting cooldown)
  const shouldRun = useCallback((action: AutoAction): boolean => {
    if (!action.enabled) return false;
    const lastRun = lastRunTimesRef.current[action.id] || 0;
    return Date.now() - lastRun >= action.cooldownMs;
  }, []);

  // Mark an action as run
  const markRun = useCallback((id: string, error?: string) => {
    lastRunTimesRef.current[id] = Date.now();
    setActions((prev) => {
      const next = prev.map((a) =>
        a.id === id
          ? { ...a, runCount: a.runCount + 1, lastRun: Date.now(), lastError: error || null }
          : a,
      );
      saveActions(next);
      return next;
    });
  }, []);

  // Check clipboard trigger
  const checkClipboardTrigger = useCallback((clipboardContent: string): AutoAction | null => {
    for (const action of actions) {
      if (action.trigger.type !== "clipboard" || !shouldRun(action)) continue;

      const pattern = action.trigger.config.pattern;
      const minLength = parseInt(action.trigger.config.minLength || "0", 10);

      if (minLength > 0 && clipboardContent.length < minLength) continue;

      if (pattern) {
        try {
          const regex = new RegExp(pattern, "i");
          if (regex.test(clipboardContent)) return action;
        } catch {
          if (clipboardContent.includes(pattern)) return action;
        }
      } else if (minLength > 0) {
        return action;
      }
    }
    return null;
  }, [actions, shouldRun]);

  // Check app switch trigger
  const checkAppTrigger = useCallback((appName: string): AutoAction | null => {
    const lower = appName.toLowerCase();
    for (const action of actions) {
      if (action.trigger.type !== "app_switch" || !shouldRun(action)) continue;
      const patterns = action.trigger.config.appName?.split("|") || [];
      if (patterns.some((p) => lower.includes(p.toLowerCase()))) return action;
    }
    return null;
  }, [actions, shouldRun]);

  // Check time trigger
  const checkTimeTrigger = useCallback((): AutoAction | null => {
    const now = new Date();
    const hour = now.getHours().toString();
    const minute = now.getMinutes().toString();

    for (const action of actions) {
      if (action.trigger.type !== "time" || !shouldRun(action)) continue;
      if (action.trigger.config.hour === hour && action.trigger.config.minute === minute) {
        return action;
      }
    }
    return null;
  }, [actions, shouldRun]);

  // Resolve action template
  const resolveAction = useCallback((action: AutoAction, context: Record<string, string> = {}): {
    type: AutoAction["action"]["type"];
    payload: string;
  } => {
    let payload = action.action.config.prompt || action.action.config.mode || "";
    for (const [key, value] of Object.entries(context)) {
      payload = payload.replace(`{{${key}}}`, value);
    }
    return { type: action.action.type, payload };
  }, []);

  // Time trigger checker (runs every minute)
  useEffect(() => {
    const interval = setInterval(() => {
      const triggered = checkTimeTrigger();
      if (triggered) {
        // Time triggers are handled by the parent component
        // Just mark as needing to run
        console.log(`[Blade] Auto-action triggered: ${triggered.name}`);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [checkTimeTrigger]);

  const enabledCount = actions.filter((a) => a.enabled).length;
  const totalRuns = actions.reduce((s, a) => s + a.runCount, 0);

  return {
    actions,
    presets: PRESET_ACTIONS,
    addAction,
    addFromPreset,
    updateAction,
    deleteAction,
    toggleAction,
    checkClipboardTrigger,
    checkAppTrigger,
    checkTimeTrigger,
    resolveAction,
    markRun,
    enabledCount,
    totalRuns,
  };
}
