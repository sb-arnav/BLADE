/// BLADE HUD Bar — fighter-jet heads-up display. Always-on-top, 30px at top of screen.
///
/// Displays: time (monospaced, glowing), active app (typing reveal animation),
/// God Mode status, unread count, next meeting countdown (amber/<15min, red/<5min),
/// tiny waveform when audio capture is active, camera blink when screenshot taken.
///
/// Alert pulses: red for errors/security, amber for warnings.
/// Scan line effect: subtle 1px horizontal lines scrolling slowly.
/// Double-click opens main BLADE window.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HudData {
  time: string;
  active_app: string;
  god_mode_status: string; // "off" | "normal" | "intermediate" | "extreme"
  unread_count: number;
  next_meeting_secs: number | null;
  next_meeting_name: string | null;
  meeting_active: boolean;
  meeting_name: string | null;
  speaker_name: string | null;
}

interface GhostSuggestion {
  response: string;
  trigger: string;
  speaker: string | null;
  confidence: number;
  platform: string;
  timestamp_ms: number;
}

interface ToastPayload {
  title: string;
  body: string;
  duration_ms: number;
  level: string; // "info" | "success" | "warning" | "error"
}

interface Toast extends ToastPayload {
  id: string;
  exiting: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCountdown(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function godModeColor(status: string): string {
  switch (status) {
    case "extreme": return "#f59e0b";
    case "intermediate": return "#6366f1";
    case "normal": return "#10b981";
    default: return "rgba(255,255,255,0.2)";
  }
}

function godModeLabel(status: string): string {
  switch (status) {
    case "extreme": return "EX";
    case "intermediate": return "INT";
    case "normal": return "ON";
    default: return "OFF";
  }
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return "#10b981";
  if (c >= 0.65) return "#f59e0b";
  return "#f87171";
}

// ── Waveform bars component ───────────────────────────────────────────────────

function AudioWaveform() {
  const BAR_COUNT = 5;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "1.5px", height: "12px" }}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <div
          key={i}
          style={{
            width: "2px",
            height: "3px",
            borderRadius: "1px",
            background: "#10b981",
            animation: `waveBar ${0.6 + i * 0.1}s ease-in-out infinite alternate`,
            animationDelay: `${i * 0.07}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Camera icon (blinks on screenshot) ───────────────────────────────────────

function CameraIcon({ blinking }: { blinking: boolean }) {
  return (
    <svg
      viewBox="0 0 12 10"
      width="12"
      height="10"
      fill="none"
      style={{
        opacity: blinking ? 1 : 0.25,
        transition: "opacity 0.15s",
        filter: blinking ? "drop-shadow(0 0 3px #3b82f6)" : "none",
      }}
    >
      <path
        d="M4.5 1h3l1 1.5H11a.5.5 0 01.5.5v5a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5h2.5L4.5 1z"
        stroke={blinking ? "#3b82f6" : "rgba(255,255,255,0.35)"}
        strokeWidth="1"
      />
      <circle cx="6" cy="5" r="1.5" stroke={blinking ? "#3b82f6" : "rgba(255,255,255,0.35)"} strokeWidth="1" />
    </svg>
  );
}

// ── Typing reveal for active app name ────────────────────────────────────────

function useTypingReveal(text: string, delay = 18) {
  const [displayed, setDisplayed] = useState(text);
  const [revealing, setRevealing] = useState(false);
  const prevTextRef = useRef(text);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (text === prevTextRef.current) return;
    prevTextRef.current = text;

    if (timerRef.current) clearTimeout(timerRef.current);
    setRevealing(true);
    setDisplayed("");

    let i = 0;
    const reveal = () => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i < text.length) {
        timerRef.current = setTimeout(reveal, delay);
      } else {
        setRevealing(false);
      }
    };
    timerRef.current = setTimeout(reveal, delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [text, delay]);

  return { displayed, revealing };
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function HudBar() {
  const [data, setData] = useState<HudData>({
    time: "--:--",
    active_app: "",
    god_mode_status: "off",
    unread_count: 0,
    next_meeting_secs: null,
    next_meeting_name: null,
    meeting_active: false,
    meeting_name: null,
    speaker_name: null,
  });

  const [ghost, setGhost] = useState<GhostSuggestion | null>(null);
  const [ghostVisible, setGhostVisible] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isCopying, setIsCopying] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // HUD alert pulse state: null | "error" | "warning"
  const [alertPulse, setAlertPulse] = useState<"error" | "warning" | null>(null);

  // Audio capture active
  const [audioActive, setAudioActive] = useState(false);

  // Screenshot camera blink
  const [cameraBlink, setCameraBlink] = useState(false);
  const cameraBlinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen flash (blue border)
  const [screenFlash, setScreenFlash] = useState(false);
  const screenFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [localSecs, setLocalSecs] = useState<number | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Typing reveal for active app name
  const { displayed: displayedApp, revealing: appRevealing } = useTypingReveal(data.active_app);

  // ── Data listener ──────────────────────────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<HudData>("hud_update", (ev) => {
      setData(ev.payload);
      if (ev.payload.next_meeting_secs !== null) {
        setLocalSecs(ev.payload.next_meeting_secs);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Local countdown tick between server updates
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (localSecs !== null && localSecs > 0) {
      countdownRef.current = setInterval(() => {
        setLocalSecs((s) => (s !== null && s > 0 ? s - 1 : s));
      }, 1000);
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [localSecs]);

  // ── Alert pulse on errors/warnings ──────────────────────────────────────────

  useEffect(() => {
    const unlistenErr = listen("blade_alert_error", () => {
      triggerAlert("error");
    });
    const unlistenWarn = listen("blade_alert_warning", () => {
      triggerAlert("warning");
    });
    // Also fire on error/warning toasts
    return () => {
      unlistenErr.then((fn) => fn());
      unlistenWarn.then((fn) => fn());
    };
  }, []);

  function triggerAlert(level: "error" | "warning") {
    setAlertPulse(level);
    if (alertTimer.current) clearTimeout(alertTimer.current);
    alertTimer.current = setTimeout(() => setAlertPulse(null), 1800);
  }

  // ── Audio active polling via hud_update ────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<{ active: boolean }>("audio_capture_state", (ev) => {
      setAudioActive(ev.payload.active);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Screenshot camera blink + screen flash ────────────────────────────────

  useEffect(() => {
    const unlisten = listen("screenshot_taken", () => {
      // Camera blink for 1.2s
      setCameraBlink(true);
      if (cameraBlinkTimerRef.current) clearTimeout(cameraBlinkTimerRef.current);
      cameraBlinkTimerRef.current = setTimeout(() => setCameraBlink(false), 1200);

      // Screen flash for 600ms
      setScreenFlash(true);
      if (screenFlashTimerRef.current) clearTimeout(screenFlashTimerRef.current);
      screenFlashTimerRef.current = setTimeout(() => setScreenFlash(false), 600);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Ghost suggestion listener ───────────────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<GhostSuggestion>("ghost_suggestion", (ev) => {
      setGhost(ev.payload);
      setGhostVisible(true); // auto-show on new suggestion
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Listen to ghost meeting state so HUD can enter meeting mode independent of hud_update
  useEffect(() => {
    const unlistenState = listen<{ platform: string; meeting_name: string; speaker_name: string | null; duration_secs: number; listening: boolean }>(
      "ghost_meeting_state",
      (ev) => {
        setData((prev) => ({
          ...prev,
          meeting_active: true,
          meeting_name: ev.payload.meeting_name,
          speaker_name: ev.payload.speaker_name,
        }));
      }
    );
    const unlistenEnded = listen("ghost_meeting_ended", () => {
      setData((prev) => ({
        ...prev,
        meeting_active: false,
        meeting_name: null,
        speaker_name: null,
      }));
    });
    return () => {
      unlistenState.then((fn) => fn());
      unlistenEnded.then((fn) => fn());
    };
  }, []);

  // Ctrl+G to toggle ghost card — both local keyboard and Tauri global shortcut event
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setGhostVisible((v) => !v);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const unlisten = listen("ghost_toggle_card", () => {
      setGhostVisible((v) => !v);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Toast listener ─────────────────────────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<ToastPayload>("blade_toast", (ev) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { ...ev.payload, id, exiting: false };
      setToasts((prev) => [...prev, toast]);

      // Trigger HUD alert pulse for warnings/errors
      if (ev.payload.level === "error") triggerAlert("error");
      else if (ev.payload.level === "warning") triggerAlert("warning");

      const timer = setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
        );
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== id));
          toastTimers.current.delete(id);
        }, 300);
      }, Math.min(toast.duration_ms, 30_000));

      toastTimers.current.set(id, timer);
    });
    return () => {
      unlisten.then((fn) => fn());
      toastTimers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  // ── Actions ────────────────────────────────────────────────────────────────

  const openMain = useCallback(async () => {
    try {
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch {
      invoke("open_main_window").catch(() => {});
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.current.delete(id);
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  const copyResponse = useCallback(async () => {
    if (!ghost) return;
    try {
      await invoke("set_clipboard", { text: ghost.response });
      setIsCopying(true);
      setTimeout(() => setIsCopying(false), 1200);
    } catch {
      try {
        await navigator.clipboard.writeText(ghost.response);
        setIsCopying(true);
        setTimeout(() => setIsCopying(false), 1200);
      } catch {}
    }
  }, [ghost]);

  const typeResponse = useCallback(async () => {
    if (!ghost) return;
    setIsTyping(true);
    try {
      await invoke("auto_type_text", { text: ghost.response });
    } catch {}
    setTimeout(() => setIsTyping(false), 1500);
    setGhostVisible(false);
  }, [ghost]);

  // ── Toast level styles ─────────────────────────────────────────────────────

  function toastLevelStyle(level: string): { border: string; accent: string } {
    switch (level) {
      case "success": return { border: "rgba(16,185,129,0.3)", accent: "#10b981" };
      case "warning": return { border: "rgba(245,158,11,0.3)", accent: "#f59e0b" };
      case "error": return { border: "rgba(248,113,113,0.3)", accent: "#f87171" };
      default: return { border: "rgba(99,102,241,0.3)", accent: "#6366f1" };
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isMeeting = data.meeting_active;
  const gmColor = godModeColor(data.god_mode_status);
  const displayCountdown = localSecs ?? data.next_meeting_secs;

  // Countdown urgency
  const countdownUrgent = displayCountdown !== null && displayCountdown < 300;    // < 5 min
  const countdownAmber  = displayCountdown !== null && displayCountdown < 900;    // < 15 min
  const countdownColor  = countdownUrgent ? "#f87171" : countdownAmber ? "#f59e0b" : "rgba(255,255,255,0.45)";

  // Alert pulse bar color
  const alertBarColor = alertPulse === "error" ? "rgba(248,113,113,0.22)" : alertPulse === "warning" ? "rgba(245,158,11,0.18)" : null;
  const alertBorderColor = alertPulse === "error" ? "rgba(248,113,113,0.5)" : alertPulse === "warning" ? "rgba(245,158,11,0.4)" : null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "transparent",
        pointerEvents: "none",
        zIndex: 9998,
      }}
    >
      {/* Screen edge flash on screenshot (blue border around screen edges) */}
      {screenFlash && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10002,
            boxShadow: "inset 0 0 0 3px rgba(59,130,246,0.7)",
            borderRadius: "0",
            animation: "screenFlashFade 0.6s ease-out forwards",
          }}
        />
      )}

      {/* HUD bar strip */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          width: "100vw",
          height: "30px",
          background: alertBarColor
            ? alertBarColor
            : isMeeting
            ? "rgba(99,102,241,0.18)"
            : "rgba(6,6,10,0.88)",
          backdropFilter: "blur(20px) saturate(200%)",
          WebkitBackdropFilter: "blur(20px) saturate(200%)",
          borderBottom: alertBorderColor
            ? `1px solid ${alertBorderColor}`
            : isMeeting
            ? "1px solid rgba(99,102,241,0.4)"
            : "1px solid rgba(255,255,255,0.05)",
          boxShadow: alertPulse === "error"
            ? "0 0 18px rgba(248,113,113,0.25), inset 0 -1px 0 rgba(248,113,113,0.1)"
            : alertPulse === "warning"
            ? "0 0 18px rgba(245,158,11,0.2), inset 0 -1px 0 rgba(245,158,11,0.1)"
            : "0 1px 0 rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 12px",
          userSelect: "none",
          cursor: "default",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          fontSize: "11px",
          letterSpacing: "0.02em",
          color: "rgba(255,255,255,0.7)",
          zIndex: 9999,
          boxSizing: "border-box",
          pointerEvents: "auto",
          // Scan line effect via repeating gradient
          backgroundImage: alertBarColor
            ? `repeating-linear-gradient(
                180deg,
                transparent,
                transparent 4px,
                rgba(0,0,0,0.04) 4px,
                rgba(0,0,0,0.04) 5px
              ), linear-gradient(${alertBarColor}, ${alertBarColor})`
            : `repeating-linear-gradient(
                180deg,
                transparent,
                transparent 4px,
                rgba(0,0,0,0.05) 4px,
                rgba(0,0,0,0.05) 5px
              ), linear-gradient(${isMeeting ? "rgba(99,102,241,0.18)" : "rgba(6,6,10,0.88)"}, ${isMeeting ? "rgba(99,102,241,0.18)" : "rgba(6,6,10,0.88)"})`,
          transition: "background 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease",
        }}
        onDoubleClick={openMain}
      >
        {/* LEFT: time + active app (or meeting info) */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, overflow: "hidden" }}>
          {/* Time — monospaced, subtle glow */}
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: "rgba(255,255,255,0.92)",
              fontWeight: 600,
              fontSize: "12px",
              letterSpacing: "0.08em",
              flexShrink: 0,
              textShadow: "0 0 8px rgba(255,255,255,0.25), 0 0 16px rgba(99,102,241,0.15)",
            }}
          >
            {data.time}
          </span>

          {/* Divider */}
          <div style={{ width: "1px", height: "12px", background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

          {isMeeting ? (
            <>
              {/* Meeting badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "5px",
                  padding: "2px 7px",
                  borderRadius: "3px",
                  background: "rgba(99,102,241,0.2)",
                  border: "1px solid rgba(99,102,241,0.4)",
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    background: "#f87171",
                    animation: "hudPulse 1.5s ease-in-out infinite",
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "rgba(255,255,255,0.92)", fontWeight: 600, letterSpacing: "0.04em" }}>
                  {data.meeting_name ?? "MEETING"}
                </span>
              </div>
              {data.speaker_name && (
                <span style={{ color: "rgba(255,255,255,0.4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "10px" }}>
                  {data.speaker_name} speaking
                </span>
              )}
            </>
          ) : (
            /* Active app with typing reveal */
            data.active_app && (
              <span
                style={{
                  color: appRevealing ? "rgba(99,102,241,0.8)" : "rgba(255,255,255,0.4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "220px",
                  fontSize: "10px",
                  letterSpacing: "0.03em",
                  transition: "color 0.4s ease",
                }}
              >
                {displayedApp}
                {appRevealing && (
                  <span style={{ borderRight: "1px solid rgba(99,102,241,0.8)", marginLeft: "1px", animation: "cursorBlink 0.6s step-end infinite" }} />
                )}
              </span>
            )
          )}
        </div>

        {/* RIGHT: camera icon, audio waveform, god mode, unread, next meeting, ghost toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* Camera icon — blinks when screenshot is taken */}
          <div style={{ display: "flex", alignItems: "center" }}>
            <CameraIcon blinking={cameraBlink} />
          </div>

          {/* Audio waveform — visible only when audio capture is active */}
          {audioActive && (
            <div style={{ display: "flex", alignItems: "center" }}>
              <AudioWaveform />
            </div>
          )}

          {/* Vertical separator */}
          <div style={{ width: "1px", height: "12px", background: "rgba(255,255,255,0.06)", flexShrink: 0 }} />

          {/* Next meeting countdown */}
          {!isMeeting && displayCountdown !== null && data.next_meeting_name && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 6px",
                borderRadius: "3px",
                background: countdownUrgent
                  ? "rgba(248,113,113,0.12)"
                  : countdownAmber
                  ? "rgba(245,158,11,0.10)"
                  : "rgba(255,255,255,0.04)",
                border: `1px solid ${countdownUrgent ? "rgba(248,113,113,0.3)" : countdownAmber ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.07)"}`,
                animation: countdownUrgent ? "hudPulse 2s ease-in-out infinite" : "none",
              }}
            >
              <svg viewBox="0 0 12 12" width="9" height="9" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="6" cy="6" r="5" stroke={countdownColor} strokeWidth="1.2" />
                <path d="M6 3.5V6l2 1.5" stroke={countdownColor} strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <span style={{ color: countdownColor, fontWeight: 600, fontSize: "10px" }}>
                {formatCountdown(displayCountdown)}
              </span>
            </div>
          )}

          {/* Unread count */}
          {data.unread_count > 0 && (
            <div
              style={{
                padding: "1px 5px",
                borderRadius: "3px",
                background: "rgba(248,113,113,0.12)",
                border: "1px solid rgba(248,113,113,0.22)",
                color: "#f87171",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.02em",
              }}
            >
              {data.unread_count > 99 ? "99+" : data.unread_count}
            </div>
          )}

          {/* God Mode badge */}
          <div
            style={{
              padding: "1px 5px",
              borderRadius: "3px",
              background: `${gmColor}12`,
              border: `1px solid ${gmColor}30`,
              color: gmColor,
              fontSize: "9px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textShadow: data.god_mode_status !== "off" ? `0 0 6px ${gmColor}` : "none",
            }}
          >
            {godModeLabel(data.god_mode_status)}
          </div>

          {/* Ghost card toggle (only visible during meeting) */}
          {isMeeting && ghost && (
            <button
              onClick={() => setGhostVisible((v) => !v)}
              title="Toggle response card (Ctrl+G)"
              style={{
                padding: "2px 7px",
                borderRadius: "3px",
                background: ghostVisible ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.12)",
                border: "1px solid rgba(99,102,241,0.4)",
                color: "rgba(255,255,255,0.85)",
                cursor: "pointer",
                fontSize: "9px",
                fontWeight: 700,
                letterSpacing: "0.06em",
                outline: "none",
                textShadow: "0 0 6px rgba(99,102,241,0.6)",
              }}
            >
              BLADE
            </button>
          )}
        </div>
      </div>

      {/* Ghost suggestion card */}
      {ghost && ghostVisible && (
        <div
          style={{
            position: "fixed",
            top: "38px",
            right: "12px",
            width: "340px",
            background: "rgba(6,6,10,0.92)",
            backdropFilter: "blur(24px) saturate(180%)",
            WebkitBackdropFilter: "blur(24px) saturate(180%)",
            borderRadius: "10px",
            border: "1px solid rgba(99,102,241,0.3)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.75), 0 0 0 0.5px rgba(255,255,255,0.04), 0 0 20px rgba(99,102,241,0.08)",
            padding: "12px",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            zIndex: 10000,
            pointerEvents: "auto",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  width: "16px", height: "16px", borderRadius: "4px",
                  background: "rgba(99,102,241,0.2)", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
                  <path d="M8 2L14 8L8 14L2 8L8 2Z" fill="#6366f1" fillOpacity="0.9" />
                </svg>
              </div>
              <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px" }}>
                {ghost.speaker ? `${ghost.speaker} asked` : "Suggested response"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                style={{ width: "6px", height: "6px", borderRadius: "50%", background: confidenceColor(ghost.confidence), flexShrink: 0 }}
                title={`Confidence: ${Math.round(ghost.confidence * 100)}%`}
              />
              <button
                onClick={() => setGhostVisible(false)}
                style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: "14px" }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Trigger */}
          {ghost.trigger && (
            <div
              style={{
                padding: "5px 8px", borderRadius: "5px", background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)", fontSize: "10px",
                color: "rgba(255,255,255,0.35)", marginBottom: "8px",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              "{ghost.trigger.length > 80 ? ghost.trigger.slice(0, 80) + "…" : ghost.trigger}"
            </div>
          )}

          {/* Response text */}
          <div
            style={{
              fontSize: "12px", lineHeight: "1.6", color: "rgba(255,255,255,0.88)",
              marginBottom: "10px", wordBreak: "break-word", whiteSpace: "pre-wrap",
            }}
          >
            {ghost.response}
          </div>

          {/* Confidence bar */}
          <div style={{ marginBottom: "10px" }}>
            <div style={{ height: "2px", borderRadius: "1px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%", width: `${Math.round(ghost.confidence * 100)}%`,
                  background: confidenceColor(ghost.confidence), borderRadius: "1px",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
              <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)" }}>confidence</span>
              <span style={{ fontSize: "9px", color: confidenceColor(ghost.confidence) }}>
                {Math.round(ghost.confidence * 100)}%
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={typeResponse}
              disabled={isTyping}
              style={{
                flex: 1, padding: "5px 10px", borderRadius: "5px",
                background: isTyping ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.25)",
                border: "1px solid rgba(99,102,241,0.4)", color: "rgba(255,255,255,0.85)",
                cursor: isTyping ? "not-allowed" : "pointer", fontSize: "11px",
                fontWeight: 500, outline: "none", transition: "background 0.15s",
              }}
            >
              {isTyping ? "Typing…" : "Type it"}
            </button>
            <button
              onClick={copyResponse}
              style={{
                flex: 1, padding: "5px 10px", borderRadius: "5px",
                background: isCopying ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${isCopying ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.1)"}`,
                color: isCopying ? "#10b981" : "rgba(255,255,255,0.6)",
                cursor: "pointer", fontSize: "11px", fontWeight: 500,
                outline: "none", transition: "all 0.15s",
              }}
            >
              {isCopying ? "Copied!" : "Copy"}
            </button>
          </div>

          <div style={{ marginTop: "8px", fontSize: "9px", color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
            Ctrl+G to toggle
          </div>
        </div>
      )}

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed", top: "38px", left: "12px",
            display: "flex", flexDirection: "column", gap: "6px",
            zIndex: 10001, pointerEvents: "auto",
          }}
        >
          {toasts.map((toast) => {
            const { border, accent } = toastLevelStyle(toast.level);
            return (
              <div
                key={toast.id}
                style={{
                  width: "300px",
                  background: "rgba(6,6,10,0.94)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                  borderRadius: "8px",
                  border: `1px solid ${border}`,
                  padding: "9px 12px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                  opacity: toast.exiting ? 0 : 1,
                  transform: toast.exiting ? "translateY(-6px)" : "translateY(0)",
                  transition: "opacity 0.25s ease, transform 0.25s ease",
                  cursor: "pointer",
                  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                }}
                onClick={() => dismissToast(toast.id)}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                  <div
                    style={{
                      width: "3px", height: "100%", minHeight: "24px",
                      borderRadius: "2px", background: accent,
                      flexShrink: 0, marginTop: "2px",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(255,255,255,0.9)", marginBottom: "2px" }}>
                      {toast.title}
                    </div>
                    {toast.body && (
                      <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
                        {toast.body}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Global keyframe animations */}
      <style>{`
        @keyframes hudPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.9); }
        }
        @keyframes cursorBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        @keyframes screenFlashFade {
          0% { opacity: 1; }
          60% { opacity: 0.6; }
          100% { opacity: 0; }
        }
        @keyframes waveBar {
          from { height: 3px; }
          to   { height: 11px; }
        }
      `}</style>
    </div>
  );
}
