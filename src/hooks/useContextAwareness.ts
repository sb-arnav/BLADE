import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Context awareness — monitors what the user is doing (active window,
 * time of day, recent activity) and provides contextual suggestions.
 */

export interface ActiveWindowInfo {
  title: string;
  process_name: string;
  pid: number;
}

export interface UserContext {
  activeWindow: ActiveWindowInfo | null;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  dayOfWeek: string;
  isWorkHours: boolean;
  recentApps: string[];
  suggestedActions: ContextSuggestion[];
}

export interface ContextSuggestion {
  id: string;
  label: string;
  prompt: string;
  icon: string;
  relevance: number; // 0-1
}

function getTimeOfDay(): UserContext["timeOfDay"] {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function isWorkHours(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}

function getDayOfWeek(): string {
  return new Date().toLocaleDateString("en", { weekday: "long" });
}

const APP_SUGGESTIONS: Record<string, ContextSuggestion[]> = {
  "code": [
    { id: "review", label: "Review my code", prompt: "Review the code I'm working on and suggest improvements", icon: "🔍", relevance: 0.9 },
    { id: "debug", label: "Debug help", prompt: "I'm debugging an issue. Help me figure out what's wrong", icon: "🐛", relevance: 0.8 },
    { id: "explain", label: "Explain this code", prompt: "Explain what this code does", icon: "📖", relevance: 0.7 },
  ],
  "terminal": [
    { id: "cmd-help", label: "Command help", prompt: "Help me with a terminal command", icon: "⌨️", relevance: 0.9 },
    { id: "script", label: "Write a script", prompt: "Write a shell script that", icon: "📝", relevance: 0.7 },
  ],
  "browser": [
    { id: "summarize", label: "Summarize page", prompt: "Summarize what I'm reading", icon: "📄", relevance: 0.8 },
    { id: "research", label: "Research this topic", prompt: "Help me research this topic further", icon: "🔬", relevance: 0.7 },
  ],
  "design": [
    { id: "feedback", label: "Design feedback", prompt: "Give me feedback on this design", icon: "🎨", relevance: 0.8 },
    { id: "copy", label: "Write copy", prompt: "Write copy for this UI element", icon: "✍️", relevance: 0.7 },
  ],
  "email": [
    { id: "draft", label: "Draft reply", prompt: "Help me draft a reply to this email", icon: "✉️", relevance: 0.9 },
    { id: "summarize-email", label: "Summarize thread", prompt: "Summarize this email thread", icon: "📋", relevance: 0.7 },
  ],
  "default": [
    { id: "ask", label: "Ask anything", prompt: "", icon: "💬", relevance: 0.5 },
    { id: "brainstorm", label: "Brainstorm", prompt: "Help me brainstorm ideas for", icon: "💡", relevance: 0.4 },
  ],
};

function categorizeApp(processName: string, title: string): string {
  const lower = (processName + " " + title).toLowerCase();
  if (lower.includes("code") || lower.includes("vim") || lower.includes("nvim") || lower.includes("idea") || lower.includes("studio")) return "code";
  if (lower.includes("terminal") || lower.includes("cmd") || lower.includes("powershell") || lower.includes("warp") || lower.includes("iterm")) return "terminal";
  if (lower.includes("chrome") || lower.includes("firefox") || lower.includes("edge") || lower.includes("safari") || lower.includes("brave")) return "browser";
  if (lower.includes("figma") || lower.includes("sketch") || lower.includes("photoshop") || lower.includes("canva")) return "design";
  if (lower.includes("outlook") || lower.includes("mail") || lower.includes("gmail") || lower.includes("thunderbird")) return "email";
  return "default";
}

function getSuggestionsForContext(activeWindow: ActiveWindowInfo | null): ContextSuggestion[] {
  if (!activeWindow) return APP_SUGGESTIONS["default"];
  const category = categorizeApp(activeWindow.process_name, activeWindow.title);
  return [...(APP_SUGGESTIONS[category] || []), ...APP_SUGGESTIONS["default"]];
}

export function useContextAwareness(pollIntervalMs = 5000) {
  const [context, setContext] = useState<UserContext>({
    activeWindow: null,
    timeOfDay: getTimeOfDay(),
    dayOfWeek: getDayOfWeek(),
    isWorkHours: isWorkHours(),
    recentApps: [],
    suggestedActions: APP_SUGGESTIONS["default"],
  });

  const recentAppsRef = useRef<string[]>([]);

  const pollContext = useCallback(async () => {
    try {
      const win = await invoke<ActiveWindowInfo>("get_active_window");
      const suggestions = getSuggestionsForContext(win);

      // Track recent apps
      if (win?.process_name) {
        const apps = recentAppsRef.current;
        if (apps[apps.length - 1] !== win.process_name) {
          apps.push(win.process_name);
          if (apps.length > 10) apps.shift();
          recentAppsRef.current = apps;
        }
      }

      setContext({
        activeWindow: win,
        timeOfDay: getTimeOfDay(),
        dayOfWeek: getDayOfWeek(),
        isWorkHours: isWorkHours(),
        recentApps: [...recentAppsRef.current],
        suggestedActions: suggestions,
      });
    } catch {
      // Context detection not available
      setContext((prev) => ({
        ...prev,
        timeOfDay: getTimeOfDay(),
        dayOfWeek: getDayOfWeek(),
        isWorkHours: isWorkHours(),
      }));
    }
  }, []);

  useEffect(() => {
    pollContext();
    const interval = setInterval(pollContext, pollIntervalMs);
    return () => clearInterval(interval);
  }, [pollContext, pollIntervalMs]);

  const getGreeting = useCallback((): string => {
    const time = getTimeOfDay();
    const greetings: Record<string, string[]> = {
      morning: ["Good morning", "Morning", "Rise and grind"],
      afternoon: ["Good afternoon", "Afternoon"],
      evening: ["Good evening", "Evening"],
      night: ["Burning the midnight oil?", "Late night session"],
    };
    const options = greetings[time];
    return options[Math.floor(Math.random() * options.length)];
  }, []);

  const getContextPrompt = useCallback((): string => {
    const parts: string[] = [];
    if (context.activeWindow) {
      parts.push(`User is currently in: ${context.activeWindow.process_name} — "${context.activeWindow.title}"`);
    }
    parts.push(`Time: ${context.timeOfDay}, ${context.dayOfWeek}`);
    if (context.recentApps.length > 0) {
      parts.push(`Recent apps: ${[...new Set(context.recentApps)].join(", ")}`);
    }
    return parts.join(". ");
  }, [context]);

  return { context, getGreeting, getContextPrompt, pollContext };
}
