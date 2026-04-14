import { useState, useEffect, useCallback, useRef } from "react";

/**
 * Proactive mode — Blade watches clipboard and screen context,
 * and offers help unprompted when it detects something useful.
 *
 * Phase 2 feature: "Blade watches clipboard/screen and offers help unprompted"
 */

export interface ProactiveSuggestion {
  id: string;
  type: "clipboard" | "screen" | "time" | "pattern" | "reminder";
  title: string;
  description: string;
  prompt: string;
  priority: "low" | "medium" | "high";
  timestamp: number;
  dismissed: boolean;
  expiresAt: number;
}

interface ProactiveConfig {
  enabled: boolean;
  clipboardWatch: boolean;
  contextWatch: boolean;
  reminderWatch: boolean;
  quietHoursStart: number; // hour 0-23
  quietHoursEnd: number;
  maxSuggestionsPerHour: number;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true, // on by default — Blade is proactive
  clipboardWatch: true,
  contextWatch: true,
  reminderWatch: true,
  quietHoursStart: 22,
  quietHoursEnd: 7,
  maxSuggestionsPerHour: 5,
};

const STORAGE_KEY = "blade-proactive";
// Dismissed suggestion IDs are persisted so they don't come back after a restart
const DISMISSED_KEY = "blade-proactive-dismissed";
const SUGGESTION_TTL = 5 * 60 * 1000; // suggestions expire after 5 minutes

function loadConfig(): ProactiveConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: ProactiveConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function loadDismissedIds(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedId(id: string) {
  try {
    const existing = loadDismissedIds();
    existing.add(id);
    // Cap at 500 entries — prune oldest (arbitrary string order is fine here,
    // we just need the Set to not grow without bound)
    const arr = Array.from(existing);
    if (arr.length > 500) arr.splice(0, arr.length - 500);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(arr));
  } catch {
    // localStorage quota — non-fatal
  }
}

function isQuietHours(config: ProactiveConfig): boolean {
  const hour = new Date().getHours();
  if (config.quietHoursStart < config.quietHoursEnd) {
    return hour >= config.quietHoursStart && hour < config.quietHoursEnd;
  }
  // Wraps midnight
  return hour >= config.quietHoursStart || hour < config.quietHoursEnd;
}

// Time-based suggestions
function getTimeSuggestions(): ProactiveSuggestion[] {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  const suggestions: ProactiveSuggestion[] = [];

  // Monday morning planning
  if (day === 1 && hour >= 8 && hour <= 10) {
    suggestions.push({
      id: "weekly-plan",
      type: "time",
      title: "Weekly planning",
      description: "Start your week with a plan?",
      prompt: "Help me plan my week. What should I focus on?",
      priority: "medium",
      timestamp: Date.now(),
      dismissed: false,
      expiresAt: Date.now() + SUGGESTION_TTL,
    });
  }

  // Friday reflection
  if (day === 5 && hour >= 16 && hour <= 18) {
    suggestions.push({
      id: "weekly-review",
      type: "time",
      title: "Weekly review",
      description: "Reflect on your week?",
      prompt: "Help me review what I accomplished this week and what I can improve",
      priority: "low",
      timestamp: Date.now(),
      dismissed: false,
      expiresAt: Date.now() + SUGGESTION_TTL,
    });
  }

  // End of day summary
  if (hour >= 17 && hour <= 19) {
    suggestions.push({
      id: "daily-summary",
      type: "time",
      title: "Daily wrap-up",
      description: "Summarize today's conversations?",
      prompt: "Summarize the key topics and decisions from my conversations today",
      priority: "low",
      timestamp: Date.now(),
      dismissed: false,
      expiresAt: Date.now() + SUGGESTION_TTL,
    });
  }

  return suggestions;
}

export function useProactiveMode(onSendMessage?: (prompt: string) => void) {
  const [config, setConfig] = useState<ProactiveConfig>(loadConfig);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [suggestionsThisHour, setSuggestionsThisHour] = useState(0);
  const lastHourRef = useRef(new Date().getHours());
  // Dismissed IDs loaded once on mount — used to filter out re-surfaced suggestions
  const dismissedIdsRef = useRef<Set<string>>(loadDismissedIds());

  // Reset hourly counter
  useEffect(() => {
    const interval = setInterval(() => {
      const currentHour = new Date().getHours();
      if (currentHour !== lastHourRef.current) {
        lastHourRef.current = currentHour;
        setSuggestionsThisHour(0);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Time-based suggestions
  useEffect(() => {
    if (!config.enabled || !config.reminderWatch) return;
    if (isQuietHours(config)) return;

    const checkTime = () => {
      const timeSuggestions = getTimeSuggestions();
      if (timeSuggestions.length > 0 && suggestionsThisHour < config.maxSuggestionsPerHour) {
        setSuggestions((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          // Skip suggestions that were already dismissed (persisted across restarts)
          const newOnes = timeSuggestions.filter(
            (s) => !existingIds.has(s.id) && !dismissedIdsRef.current.has(s.id)
          );
          return [
            ...prev.filter((s) => !s.dismissed && s.expiresAt > Date.now()),
            ...newOnes,
          ];
        });
      }
    };

    checkTime();
    const interval = setInterval(checkTime, 15 * 60 * 1000); // check every 15 min
    return () => clearInterval(interval);
  }, [config, suggestionsThisHour]);

  // Prune expired suggestions
  useEffect(() => {
    const interval = setInterval(() => {
      setSuggestions((prev) => prev.filter((s) => !s.dismissed && s.expiresAt > Date.now()));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const addSuggestion = useCallback((suggestion: Omit<ProactiveSuggestion, "id" | "timestamp" | "dismissed" | "expiresAt">) => {
    if (!config.enabled || isQuietHours(config)) return;
    if (suggestionsThisHour >= config.maxSuggestionsPerHour) return;
    // Don't re-add a previously dismissed stable-id suggestion
    if (dismissedIdsRef.current.has(suggestion.id ?? "")) return;

    setSuggestionsThisHour((prev) => prev + 1);
    setSuggestions((prev) => [
      ...prev,
      {
        ...suggestion,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        dismissed: false,
        expiresAt: Date.now() + SUGGESTION_TTL,
      },
    ]);
  }, [config, suggestionsThisHour]);

  const dismissSuggestion = useCallback((id: string) => {
    // Persist the dismissal so this suggestion never re-appears after a restart
    dismissedIdsRef.current.add(id);
    saveDismissedId(id);
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, dismissed: true } : s)));
  }, []);

  const dismissAll = useCallback(() => {
    setSuggestions((prev) => {
      prev.forEach((s) => {
        if (!s.dismissed) {
          dismissedIdsRef.current.add(s.id);
          saveDismissedId(s.id);
        }
      });
      return prev.map((s) => ({ ...s, dismissed: true }));
    });
  }, []);

  // Send the suggestion's prompt as a chat message and dismiss it
  const acceptSuggestion = useCallback((id: string) => {
    const suggestion = suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    dismissSuggestion(id);
    if (onSendMessage && suggestion.prompt) {
      onSendMessage(suggestion.prompt);
    }
  }, [suggestions, dismissSuggestion, onSendMessage]);

  const updateConfig = useCallback((updates: Partial<ProactiveConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveConfig(next);
      return next;
    });
  }, []);

  const activeSuggestions = suggestions.filter((s) => !s.dismissed && s.expiresAt > Date.now());

  return {
    config,
    updateConfig,
    suggestions: activeSuggestions,
    addSuggestion,
    dismissSuggestion,
    dismissAll,
    acceptSuggestion,
    isQuietHours: isQuietHours(config),
  };
}
