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

export function useProactiveMode() {
  const [config, setConfig] = useState<ProactiveConfig>(loadConfig);
  const [suggestions, setSuggestions] = useState<ProactiveSuggestion[]>([]);
  const [suggestionsThisHour, setSuggestionsThisHour] = useState(0);
  const lastHourRef = useRef(new Date().getHours());

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
          const newOnes = timeSuggestions.filter((s) => !existingIds.has(s.id));
          return [...prev.filter((s) => !s.dismissed && s.expiresAt > Date.now()), ...newOnes];
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
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, dismissed: true } : s)));
  }, []);

  const dismissAll = useCallback(() => {
    setSuggestions((prev) => prev.map((s) => ({ ...s, dismissed: true })));
  }, []);

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
    isQuietHours: isQuietHours(config),
  };
}
