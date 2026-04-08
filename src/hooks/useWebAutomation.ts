import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────────────

export interface WebAction {
  id: string;
  type: "navigate" | "click" | "type" | "scroll" | "screenshot" | "extract" | "wait";
  target?: string; // CSS selector or URL
  value?: string;
  timestamp: number;
  status: "pending" | "running" | "done" | "error";
  result?: string;
  error?: string;
}

export interface WebSession {
  id: string;
  url: string;
  title: string;
  status: "active" | "completed" | "error";
  actions: WebAction[];
  startedAt: number;
  completedAt?: number;
  extractedData?: string;
}

export interface WebRecipe {
  id: string;
  name: string;
  icon: string;
  description: string;
  steps: Omit<WebAction, "id" | "timestamp" | "result" | "error" | "status">[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let actionCounter = 0;
function makeActionId(): string {
  return `act_${Date.now()}_${++actionCounter}`;
}

function makeSessionId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Built-in Recipes ─────────────────────────────────────────────────────────

const BUILT_IN_RECIPES: WebRecipe[] = [
  {
    id: "scrape-page",
    name: "Scrape Page",
    icon: "📄",
    description: "Navigate to a URL, extract all visible text content, and return it.",
    steps: [
      { type: "navigate", target: "{{url}}" },
      { type: "wait", value: "1000" },
      { type: "extract", target: "body", value: "textContent" },
    ],
  },
  {
    id: "fill-form",
    name: "Fill Form",
    icon: "📝",
    description: "Navigate to a page, locate form inputs, fill them with values, and submit.",
    steps: [
      { type: "navigate", target: "{{url}}" },
      { type: "wait", value: "1000" },
      { type: "extract", target: "form input, form textarea, form select", value: "outerHTML" },
      { type: "type", target: "{{selector}}", value: "{{value}}" },
      { type: "click", target: "form [type='submit'], form button" },
    ],
  },
  {
    id: "take-screenshots",
    name: "Take Screenshots",
    icon: "📸",
    description: "Navigate to a page and capture full-page screenshots by scrolling.",
    steps: [
      { type: "navigate", target: "{{url}}" },
      { type: "wait", value: "2000" },
      { type: "screenshot" },
      { type: "scroll", value: "bottom" },
      { type: "wait", value: "500" },
      { type: "screenshot" },
    ],
  },
  {
    id: "monitor-changes",
    name: "Monitor Changes",
    icon: "👁",
    description: "Visit a page twice with a delay and diff the extracted content.",
    steps: [
      { type: "navigate", target: "{{url}}" },
      { type: "wait", value: "1000" },
      { type: "extract", target: "body", value: "textContent" },
      { type: "wait", value: "{{interval:5000}}" },
      { type: "navigate", target: "{{url}}" },
      { type: "extract", target: "body", value: "textContent" },
    ],
  },
  {
    id: "search-collect",
    name: "Search & Collect",
    icon: "🔍",
    description: "Navigate to a search engine, enter a query, and extract the results.",
    steps: [
      { type: "navigate", target: "https://www.google.com/search?q={{query}}" },
      { type: "wait", value: "2000" },
      { type: "extract", target: "#search .g", value: "textContent" },
    ],
  },
  {
    id: "login-flow",
    name: "Login Flow",
    icon: "🔐",
    description: "Navigate to a login page, enter credentials, and submit the form.",
    steps: [
      { type: "navigate", target: "{{url}}" },
      { type: "wait", value: "1000" },
      { type: "type", target: "input[type='email'], input[name='username'], #username, #email", value: "{{username}}" },
      { type: "type", target: "input[type='password'], #password", value: "{{password}}" },
      { type: "click", target: "button[type='submit'], input[type='submit'], .login-btn" },
      { type: "wait", value: "3000" },
      { type: "extract", target: "body", value: "textContent" },
    ],
  },
];

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useWebAutomation() {
  const [sessions, setSessions] = useState<WebSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // ── Derived state ────────────────────────────────────────────────────

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const recipes: WebRecipe[] = useMemo(() => BUILT_IN_RECIPES, []);

  // ── Session helpers ──────────────────────────────────────────────────

  const updateSession = useCallback(
    (id: string, patch: Partial<WebSession> | ((s: WebSession) => Partial<WebSession>)) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const updates = typeof patch === "function" ? patch(s) : patch;
          return { ...s, ...updates };
        }),
      );
    },
    [],
  );

  const appendAction = useCallback(
    (sessionId: string, action: WebAction) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return { ...s, actions: [...s.actions, action] };
        }),
      );
    },
    [],
  );

  const patchAction = useCallback(
    (sessionId: string, actionId: string, patch: Partial<WebAction>) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sessionId) return s;
          return {
            ...s,
            actions: s.actions.map((a) => (a.id === actionId ? { ...a, ...patch } : a)),
          };
        }),
      );
    },
    [],
  );

  // ── Core: execute a single action ────────────────────────────────────

  const executeAction = useCallback(
    async (
      sessionId: string,
      actionDef: Omit<WebAction, "id" | "timestamp" | "status" | "result" | "error">,
    ): Promise<WebAction> => {
      const action: WebAction = {
        ...actionDef,
        id: makeActionId(),
        timestamp: Date.now(),
        status: "running",
      };

      appendAction(sessionId, action);

      try {
        const result: string = await invoke("web_action", {
          sessionId,
          actionType: action.type,
          target: action.target ?? "",
          value: action.value ?? "",
        });

        const completed: WebAction = { ...action, status: "done", result };
        patchAction(sessionId, action.id, { status: "done", result });

        // If this was an extract action, store data on the session
        if (action.type === "extract" && result) {
          updateSession(sessionId, (s) => ({
            extractedData: s.extractedData ? s.extractedData + "\n---\n" + result : result,
          }));
        }

        // If this was a navigate action, update session url
        if (action.type === "navigate" && action.target) {
          updateSession(sessionId, { url: action.target });
        }

        return completed;
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        patchAction(sessionId, action.id, { status: "error", error: errorMsg });
        return { ...action, status: "error", error: errorMsg };
      }
    },
    [appendAction, patchAction, updateSession],
  );

  // ── Start a session ──────────────────────────────────────────────────

  const startSession = useCallback(
    async (url: string): Promise<WebSession> => {
      const session: WebSession = {
        id: makeSessionId(),
        url,
        title: url,
        status: "active",
        actions: [],
        startedAt: Date.now(),
      };

      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);

      // Immediately navigate
      await executeAction(session.id, { type: "navigate", target: url });

      return session;
    },
    [executeAction],
  );

  // ── Run a recipe ─────────────────────────────────────────────────────

  const runRecipe = useCallback(
    async (
      recipeId: string,
      params: Record<string, string>,
    ): Promise<void> => {
      const recipe = BUILT_IN_RECIPES.find((r) => r.id === recipeId);
      if (!recipe) return;

      const url = params.url ?? "about:blank";
      const session = await startSession(url);

      for (const step of recipe.steps.slice(1)) {
        // skip first navigate — startSession already did it
        let target = step.target;
        let value = step.value;

        // Template replacement
        if (target) {
          for (const [k, v] of Object.entries(params)) {
            target = target.replace(`{{${k}}}`, v);
          }
        }
        if (value) {
          for (const [k, v] of Object.entries(params)) {
            value = value.replace(`{{${k}}}`, v);
          }
        }

        const result = await executeAction(session.id, {
          type: step.type,
          target,
          value,
        });

        // Abort recipe on error
        if (result.status === "error") {
          updateSession(session.id, { status: "error" });
          return;
        }
      }

      updateSession(session.id, { status: "completed", completedAt: Date.now() });
    },
    [startSession, executeAction, updateSession],
  );

  // ── Stop a session ───────────────────────────────────────────────────

  const stopSession = useCallback(
    (sessionId: string) => {
      updateSession(sessionId, { status: "completed", completedAt: Date.now() });
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId, updateSession],
  );

  return {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    startSession,
    executeAction,
    runRecipe,
    stopSession,
    recipes,
  };
}
