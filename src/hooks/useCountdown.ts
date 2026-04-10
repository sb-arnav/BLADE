import { useState, useCallback, useEffect, useRef } from "react";

/**
 * Countdown Timer & Pomodoro — focus timer with AI integration.
 * Pomodoro technique: 25m work → 5m break → repeat.
 */

export interface TimerState {
  mode: "idle" | "work" | "break" | "custom";
  remaining: number;       // seconds
  total: number;           // total seconds for current interval
  isRunning: boolean;
  isPaused: boolean;
  completedPomodoros: number;
  currentSession: number;  // which pomodoro we're on
  label: string;
}

export interface PomodoroConfig {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreak: boolean;
  autoStartWork: boolean;
  notifyOnComplete: boolean;
  soundOnComplete: boolean;
}

export interface TimerHistory {
  id: string;
  mode: "work" | "break" | "custom";
  duration: number;         // completed seconds
  label: string;
  startedAt: number;
  completedAt: number;
}

const DEFAULT_CONFIG: PomodoroConfig = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreak: true,
  autoStartWork: false,
  notifyOnComplete: true,
  soundOnComplete: true,
};

const CONFIG_KEY = "blade-pomodoro-config";
const HISTORY_KEY = "blade-pomodoro-history";
function loadConfig(): PomodoroConfig {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || "{}") }; }
  catch { return DEFAULT_CONFIG; }
}

function saveConfig(config: PomodoroConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function loadHistory(): TimerHistory[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(history: TimerHistory[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-200)));
}

function playChime() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // Audio not available
  }
}

export function useCountdown() {
  const [config, setConfig] = useState<PomodoroConfig>(loadConfig);
  const [state, setState] = useState<TimerState>({
    mode: "idle",
    remaining: config.workMinutes * 60,
    total: config.workMinutes * 60,
    isRunning: false,
    isPaused: false,
    completedPomodoros: 0,
    currentSession: 1,
    label: "",
  });
  const [history, setHistory] = useState<TimerHistory[]>(loadHistory);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Timer tick
  useEffect(() => {
    if (!state.isRunning || state.isPaused) return;

    intervalRef.current = setInterval(() => {
      setState((prev) => {
        if (prev.remaining <= 1) {
          // Timer complete
          if (intervalRef.current) clearInterval(intervalRef.current);

          // Record to history
          const entry: TimerHistory = {
            id: crypto.randomUUID(),
            mode: prev.mode === "idle" ? "custom" : prev.mode as "work" | "break" | "custom",
            duration: prev.total,
            label: prev.label,
            startedAt: startTimeRef.current,
            completedAt: Date.now(),
          };
          setHistory((h) => {
            const next = [...h, entry].slice(-200);
            saveHistory(next);
            return next;
          });

          // Play sound
          if (config.soundOnComplete) playChime();

          // Auto transition
          if (prev.mode === "work") {
            const completed = prev.completedPomodoros + 1;
            const isLongBreak = completed % config.sessionsBeforeLongBreak === 0;
            const breakMinutes = isLongBreak ? config.longBreakMinutes : config.breakMinutes;

            if (config.autoStartBreak) {
              startTimeRef.current = Date.now();
              return {
                ...prev,
                mode: "break",
                remaining: breakMinutes * 60,
                total: breakMinutes * 60,
                completedPomodoros: completed,
                isRunning: true,
              };
            }

            return {
              ...prev,
              mode: "break",
              remaining: breakMinutes * 60,
              total: breakMinutes * 60,
              completedPomodoros: completed,
              isRunning: false,
            };
          }

          if (prev.mode === "break") {
            if (config.autoStartWork) {
              startTimeRef.current = Date.now();
              return {
                ...prev,
                mode: "work",
                remaining: config.workMinutes * 60,
                total: config.workMinutes * 60,
                currentSession: prev.currentSession + 1,
                isRunning: true,
              };
            }

            return {
              ...prev,
              mode: "idle",
              remaining: config.workMinutes * 60,
              total: config.workMinutes * 60,
              currentSession: prev.currentSession + 1,
              isRunning: false,
            };
          }

          // Custom timer
          return { ...prev, mode: "idle", isRunning: false };
        }

        return { ...prev, remaining: prev.remaining - 1 };
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [state.isRunning, state.isPaused, config]);

  const startWork = useCallback((label = "") => {
    startTimeRef.current = Date.now();
    setState((prev) => ({
      ...prev,
      mode: "work",
      remaining: config.workMinutes * 60,
      total: config.workMinutes * 60,
      isRunning: true,
      isPaused: false,
      label,
    }));
  }, [config]);

  const startBreak = useCallback(() => {
    startTimeRef.current = Date.now();
    setState((prev) => {
      const isLong = prev.completedPomodoros % config.sessionsBeforeLongBreak === 0 && prev.completedPomodoros > 0;
      const mins = isLong ? config.longBreakMinutes : config.breakMinutes;
      return { ...prev, mode: "break", remaining: mins * 60, total: mins * 60, isRunning: true, isPaused: false };
    });
  }, [config]);

  const startCustom = useCallback((minutes: number, label = "Custom Timer") => {
    startTimeRef.current = Date.now();
    setState((prev) => ({
      ...prev,
      mode: "custom",
      remaining: minutes * 60,
      total: minutes * 60,
      isRunning: true,
      isPaused: false,
      label,
    }));
  }, []);

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isPaused: true }));
  }, []);

  const resume = useCallback(() => {
    setState((prev) => ({ ...prev, isPaused: false }));
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setState((prev) => ({
      ...prev,
      mode: "idle",
      remaining: config.workMinutes * 60,
      total: config.workMinutes * 60,
      isRunning: false,
      isPaused: false,
    }));
  }, [config]);

  const skip = useCallback(() => {
    setState((prev) => ({ ...prev, remaining: 1 }));
  }, []);

  const updateConfig = useCallback((updates: Partial<PomodoroConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      saveConfig(next);
      return next;
    });
  }, []);

  const formatTime = useCallback((seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }, []);

  const progress = state.total > 0 ? ((state.total - state.remaining) / state.total) * 100 : 0;

  const todayStats = {
    completedPomodoros: state.completedPomodoros,
    totalWorkMinutes: history
      .filter((h) => h.mode === "work" && h.completedAt > new Date().setHours(0, 0, 0, 0))
      .reduce((sum, h) => sum + h.duration / 60, 0),
    totalBreakMinutes: history
      .filter((h) => h.mode === "break" && h.completedAt > new Date().setHours(0, 0, 0, 0))
      .reduce((sum, h) => sum + h.duration / 60, 0),
  };

  return {
    state,
    config,
    history,
    progress,
    todayStats,
    startWork,
    startBreak,
    startCustom,
    pause,
    resume,
    stop,
    skip,
    updateConfig,
    formatTime,
  };
}
