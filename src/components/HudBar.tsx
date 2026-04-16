/// BLADE HUD Bar — clean always-on-top status bar. Frosted glass, Apple style.

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
  hive_organs_active: number;
  hive_pending_decisions: number;
  hive_status_line: string;
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
    case "normal": return "#34c759";
    default: return "rgba(255,255,255,0.25)";
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
  if (c >= 0.85) return "#34c759";
  if (c >= 0.65) return "#f59e0b";
  return "#ff3b30";
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
        opacity: blinking ? 1 : 0.3,
        transition: "opacity 0.25s ease",
      }}
    >
      <path
        d="M4.5 1h3l1 1.5H11a.5.5 0 01.5.5v5a.5.5 0 01-.5.5H1a.5.5 0 01-.5-.5V3a.5.5 0 01.5-.5h2.5L4.5 1z"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="1"
      />
      <circle cx="6" cy="5" r="1.5" stroke="rgba(255,255,255,0.5)" strokeWidth="1" />
    </svg>
  );
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
    hive_organs_active: 0,
    hive_pending_decisions: 0,
    hive_status_line: "",
  });

  const [ghost, setGhost] = useState<GhostSuggestion | null>(null);
  const [ghostVisible, setGhostVisible] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isCopying, setIsCopying] = useState(false);
  const [isTyping, setIsTyping] = useState(false);

  // HUD alert state: null | "error" | "warning"
  const [alertPulse, setAlertPulse] = useState<"error" | "warning" | null>(null);

  // Audio capture active
  const [audioActive, setAudioActive] = useState(false);

  // Screenshot camera blink
  const [cameraBlink, setCameraBlink] = useState(false);
  const cameraBlinkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Screen flash (subtle border)
  const [screenFlash, setScreenFlash] = useState(false);
  const screenFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [localSecs, setLocalSecs] = useState<number | null>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active app display
  const displayedApp = data.active_app;

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
  const countdownUrgent = displayCountdown !== null && displayCountdown < 300;
  const countdownAmber  = displayCountdown !== null && displayCountdown < 900;
  const countdownColor  = countdownUrgent ? "#ff3b30" : countdownAmber ? "#f59e0b" : "rgba(255,255,255,0.45)";

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
      {/* Subtle screen-edge flash on screenshot */}
      {screenFlash && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 10002,
            boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.15)",
            animation: "screenFlashFade 0.6s ease-out forwards",
          }}
        />
      )}

      {/* HUD bar strip — frosted glass */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          width: "100vw",
          height: "30px",
          background: alertPulse === "error"
            ? "rgba(255,59,48,0.12)"
            : alertPulse === "warning"
            ? "rgba(245,158,11,0.10)"
            : isMeeting
            ? "rgba(99,102,241,0.12)"
            : "rgba(10,10,14,0.86)",
          backdropFilter: "blur(20px) saturate(1.8)",
          WebkitBackdropFilter: "blur(20px) saturate(1.8)",
          borderBottom: alertPulse === "error"
            ? "1px solid rgba(255,59,48,0.3)"
            : alertPulse === "warning"
            ? "1px solid rgba(245,158,11,0.25)"
            : isMeeting
            ? "1px solid rgba(99,102,241,0.2)"
            : "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 1px 0 rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 14px",
          userSelect: "none",
          cursor: "default",
          fontFamily: "'SF Mono', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: "11px",
          color: "rgba(255,255,255,0.65)",
          zIndex: 9999,
          boxSizing: "border-box",
          pointerEvents: "auto",
          transition: "background 0.25s ease, border-color 0.25s ease",
        }}
        onDoubleClick={openMain}
      >
        {/* LEFT: time · app name (or meeting info) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, overflow: "hidden" }}>
          {/* Time */}
          <span
            style={{
              fontVariantNumeric: "tabular-nums",
              color: "rgba(255,255,255,0.88)",
              fontWeight: 500,
              fontSize: "12px",
              letterSpacing: "0.05em",
              flexShrink: 0,
            }}
          >
            {data.time}
          </span>

          {/* Dot separator */}
          <span style={{ color: "rgba(255,255,255,0.18)", fontSize: "10px", flexShrink: 0 }}>·</span>

          {isMeeting ? (
            <>
              {/* Meeting live dot + name */}
              <div style={{ display: "flex", alignItems: "center", gap: "5px", flexShrink: 0 }}>
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#ff3b30",
                    flexShrink: 0,
                    animation: "dotPulse 2s ease-in-out infinite",
                  }}
                />
                <span style={{ color: "rgba(255,255,255,0.88)", fontWeight: 500, fontSize: "11px" }}>
                  {data.meeting_name ?? "Meeting"}
                </span>
              </div>
              {data.speaker_name && (
                <>
                  <span style={{ color: "rgba(255,255,255,0.18)", fontSize: "10px" }}>·</span>
                  <span style={{ color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" }}>
                    {data.speaker_name}
                  </span>
                </>
              )}
            </>
          ) : (
            data.active_app && (
              <span
                style={{
                  color: "rgba(255,255,255,0.4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "200px",
                  fontSize: "11px",
                }}
              >
                {displayedApp}
              </span>
            )
          )}
        </div>

        {/* RIGHT: camera, audio dot, god mode dot, unread, countdown, ghost toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexShrink: 0 }}>
          {/* Camera icon */}
          <CameraIcon blinking={cameraBlink} />

          {/* Audio active dot */}
          {audioActive && (
            <span
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#34c759",
                flexShrink: 0,
              }}
              title="Audio capture active"
            />
          )}

          {/* Dot separator */}
          <div style={{ width: "1px", height: "10px", background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

          {/* Next meeting countdown — just text, changes color */}
          {!isMeeting && displayCountdown !== null && data.next_meeting_name && (
            <span style={{ color: countdownColor, fontSize: "11px", fontWeight: countdownUrgent ? 600 : 400, transition: "color 0.25s ease" }}>
              {formatCountdown(displayCountdown)}
            </span>
          )}

          {/* Unread count */}
          {data.unread_count > 0 && (
            <span style={{ color: "#ff3b30", fontSize: "11px", fontWeight: 600 }}>
              {data.unread_count > 99 ? "99+" : data.unread_count}
            </span>
          )}

          {/* God Mode status dot */}
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: gmColor,
              flexShrink: 0,
              transition: "background 0.25s ease",
            }}
            title={`God Mode: ${data.god_mode_status}`}
          />
          <span style={{ color: gmColor, fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", transition: "color 0.25s ease" }}>
            {godModeLabel(data.god_mode_status)}
          </span>

          {/* Hive organ count — shows when organs are active */}
          {data.hive_organs_active > 0 && (
            <>
              <span style={{ color: "rgba(255,255,255,0.15)", fontSize: "10px" }}>·</span>
              <span
                style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: data.hive_pending_decisions > 0 ? "#f59e0b" : "#818cf8",
                  flexShrink: 0,
                }}
                title={data.hive_status_line || `${data.hive_organs_active} organs active`}
              />
              <span style={{
                color: data.hive_pending_decisions > 0 ? "#f59e0b" : "rgba(129,140,248,0.7)",
                fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em",
              }}>
                {data.hive_pending_decisions > 0
                  ? `${data.hive_pending_decisions} pending`
                  : `${data.hive_organs_active} organs`}
              </span>
            </>
          )}

          {/* Ghost card toggle — only in meeting */}
          {isMeeting && ghost && (
            <button
              onClick={() => setGhostVisible((v) => !v)}
              title="Toggle suggestion card (Ctrl+G)"
              style={{
                padding: "2px 8px",
                borderRadius: "4px",
                background: ghostVisible ? "rgba(99,102,241,0.25)" : "rgba(255,255,255,0.08)",
                border: "none",
                color: ghostVisible ? "#a5b4fc" : "rgba(255,255,255,0.55)",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 500,
                outline: "none",
                transition: "all 0.25s ease",
              }}
            >
              BLADE
            </button>
          )}
        </div>
      </div>

      {/* Ghost suggestion card — frosted glass, slides in from right */}
      {ghost && ghostVisible && (
        <div
          style={{
            position: "fixed",
            top: "38px",
            right: "12px",
            width: "320px",
            background: "rgba(18,18,22,0.92)",
            backdropFilter: "blur(24px) saturate(1.8)",
            WebkitBackdropFilter: "blur(24px) saturate(1.8)",
            borderRadius: "12px",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06) inset",
            padding: "16px",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            zIndex: 10000,
            pointerEvents: "auto",
            animation: "slideInRight 0.25s ease",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: confidenceColor(ghost.confidence),
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "12px" }}>
                {ghost.speaker ? ghost.speaker : "Suggestion"}
              </span>
            </div>
            <button
              onClick={() => setGhostVisible(false)}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", padding: "2px", lineHeight: 1, fontSize: "16px" }}
            >
              ×
            </button>
          </div>

          {/* Trigger */}
          {ghost.trigger && (
            <p
              style={{
                fontSize: "12px",
                color: "rgba(255,255,255,0.35)",
                marginBottom: "10px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontStyle: "italic",
              }}
            >
              "{ghost.trigger.length > 80 ? ghost.trigger.slice(0, 80) + "…" : ghost.trigger}"
            </p>
          )}

          {/* Response text */}
          <p
            style={{
              fontSize: "13px",
              lineHeight: "1.6",
              color: "rgba(255,255,255,0.88)",
              marginBottom: "14px",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {ghost.response}
          </p>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={typeResponse}
              disabled={isTyping}
              style={{
                flex: 1, padding: "7px 12px", borderRadius: "8px",
                background: "rgba(99,102,241,0.2)",
                border: "none",
                color: isTyping ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.88)",
                cursor: isTyping ? "not-allowed" : "pointer",
                fontSize: "13px",
                fontWeight: 500,
                outline: "none",
                transition: "background 0.25s ease",
              }}
            >
              {isTyping ? "Typing…" : "Use"}
            </button>
            <button
              onClick={copyResponse}
              style={{
                flex: 1, padding: "7px 12px", borderRadius: "8px",
                background: isCopying ? "rgba(52,199,89,0.18)" : "rgba(255,255,255,0.07)",
                border: "none",
                color: isCopying ? "#34c759" : "rgba(255,255,255,0.55)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
                outline: "none",
                transition: "all 0.25s ease",
              }}
            >
              {isCopying ? "Copied" : "Copy"}
            </button>
          </div>

          <p style={{ marginTop: "10px", fontSize: "11px", color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
            Ctrl+G to toggle
          </p>
        </div>
      )}

      {/* Toast stack — slides in from right */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed", top: "38px", right: "12px",
            display: "flex", flexDirection: "column", gap: "8px",
            zIndex: 10001, pointerEvents: "auto",
          }}
        >
          {toasts.map((toast) => {
            const { accent } = toastLevelStyle(toast.level);
            return (
              <div
                key={toast.id}
                style={{
                  width: "280px",
                  background: "rgba(18,18,22,0.94)",
                  backdropFilter: "blur(20px) saturate(1.8)",
                  WebkitBackdropFilter: "blur(20px) saturate(1.8)",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "12px 14px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                  opacity: toast.exiting ? 0 : 1,
                  transform: toast.exiting ? "translateX(12px)" : "translateX(0)",
                  transition: "opacity 0.25s ease, transform 0.25s ease",
                  cursor: "pointer",
                  fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                  animation: "slideInRight 0.25s ease",
                }}
                onClick={() => dismissToast(toast.id)}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      background: accent,
                      flexShrink: 0,
                      marginTop: "5px",
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.88)", marginBottom: "2px" }}>
                      {toast.title}
                    </div>
                    {toast.body && (
                      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
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

      {/* Keyframe animations */}
      <style>{`
        @keyframes dotPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes screenFlashFade {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(12px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
