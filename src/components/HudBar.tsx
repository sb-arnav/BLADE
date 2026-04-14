/// BLADE HUD Bar — always-on-top slim 30px bar at the top of the screen.
///
/// Displays: time, active app, God Mode status, unread count, next meeting countdown.
/// In meeting mode: shows meeting name + speaking participant.
/// Click anywhere to expand the main BLADE window.
/// Ctrl+G toggles the Ghost response card (when ghost_mode is active).
/// Auto-hides when a fullscreen app is detected.

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
  const toastTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [localSecs, setLocalSecs] = useState<number | null>(null);

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

  // ── Ghost suggestion listener ───────────────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<GhostSuggestion>("ghost_suggestion", (ev) => {
      setGhost(ev.payload);
      setGhostVisible(true); // auto-show on new suggestion
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Ctrl+G to toggle ghost card
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

  // ── Toast listener ─────────────────────────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<ToastPayload>("blade_toast", (ev) => {
      const id = `toast-${Date.now()}-${Math.random()}`;
      const toast: Toast = { ...ev.payload, id, exiting: false };
      setToasts((prev) => [...prev, toast]);

      const timer = setTimeout(() => {
        // Mark as exiting first for animation
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

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        width: "100vw",
        height: "30px",
        background: isMeeting
          ? "rgba(99,102,241,0.18)"
          : "rgba(9,9,11,0.82)",
        backdropFilter: "blur(16px) saturate(180%)",
        WebkitBackdropFilter: "blur(16px) saturate(180%)",
        borderBottom: isMeeting
          ? "1px solid rgba(99,102,241,0.35)"
          : "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        userSelect: "none",
        cursor: "default",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: "11px",
        letterSpacing: "-0.01em",
        color: "rgba(255,255,255,0.7)",
        zIndex: 9999,
        boxSizing: "border-box",
      }}
      onDoubleClick={openMain}
    >
      {/* LEFT: time + active app (or meeting info) */}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, overflow: "hidden" }}>
        {/* Time */}
        <span style={{ fontVariantNumeric: "tabular-nums", color: "rgba(255,255,255,0.85)", fontWeight: 500, flexShrink: 0 }}>
          {data.time}
        </span>

        {isMeeting ? (
          /* Meeting mode: show platform + speaker */
          <>
            <div style={{ width: "1px", height: "12px", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "5px",
                padding: "2px 7px",
                borderRadius: "4px",
                background: "rgba(99,102,241,0.2)",
                border: "1px solid rgba(99,102,241,0.35)",
                flexShrink: 0,
              }}
            >
              {/* Recording dot */}
              <span
                style={{
                  width: "5px",
                  height: "5px",
                  borderRadius: "50%",
                  background: "#f87171",
                  animation: "pulse 1.5s ease-in-out infinite",
                  flexShrink: 0,
                }}
              />
              <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 500 }}>
                {data.meeting_name ?? "Meeting"}
              </span>
            </div>
            {data.speaker_name && (
              <span style={{ color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {data.speaker_name} speaking
              </span>
            )}
          </>
        ) : (
          /* Normal mode: active app */
          data.active_app && (
            <>
              <div style={{ width: "1px", height: "12px", background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
              <span style={{ color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "200px" }}>
                {data.active_app}
              </span>
            </>
          )
        )}
      </div>

      {/* RIGHT: god mode, unread, next meeting, ghost toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
        {/* Next meeting countdown */}
        {!isMeeting && displayCountdown !== null && data.next_meeting_name && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              padding: "2px 7px",
              borderRadius: "4px",
              background: displayCountdown < 300 ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.05)",
              border: `1px solid ${displayCountdown < 300 ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.08)"}`,
            }}
          >
            <svg viewBox="0 0 12 12" width="9" height="9" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="6" cy="6" r="5" stroke={displayCountdown < 300 ? "#f59e0b" : "rgba(255,255,255,0.3)"} strokeWidth="1.2" />
              <path d="M6 3.5V6l2 1.5" stroke={displayCountdown < 300 ? "#f59e0b" : "rgba(255,255,255,0.3)"} strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <span style={{ color: displayCountdown < 300 ? "#f59e0b" : "rgba(255,255,255,0.45)" }}>
              {formatCountdown(displayCountdown)}
            </span>
          </div>
        )}

        {/* Unread count */}
        {data.unread_count > 0 && (
          <div
            style={{
              padding: "1px 5px",
              borderRadius: "9px",
              background: "rgba(248,113,113,0.15)",
              border: "1px solid rgba(248,113,113,0.25)",
              color: "#f87171",
              fontSize: "10px",
              fontWeight: 600,
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
            background: `${gmColor}18`,
            border: `1px solid ${gmColor}35`,
            color: gmColor,
            fontSize: "9px",
            fontWeight: 700,
            letterSpacing: "0.04em",
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
              borderRadius: "4px",
              background: ghostVisible ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.1)",
              border: "1px solid rgba(99,102,241,0.35)",
              color: "rgba(255,255,255,0.8)",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 500,
              outline: "none",
            }}
          >
            BLADE
          </button>
        )}
      </div>

      {/* Ghost suggestion card — floats below the HUD bar */}
      {ghost && ghostVisible && (
        <div
          style={{
            position: "fixed",
            top: "38px",
            right: "12px",
            width: "340px",
            background: "rgba(9,9,11,0.94)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderRadius: "10px",
            border: "1px solid rgba(99,102,241,0.25)",
            boxShadow: "0 16px 40px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.04)",
            padding: "12px",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            zIndex: 10000,
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <div
                style={{
                  width: "16px",
                  height: "16px",
                  borderRadius: "4px",
                  background: "rgba(99,102,241,0.2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
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
              {/* Confidence dot */}
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: confidenceColor(ghost.confidence),
                  flexShrink: 0,
                }}
                title={`Confidence: ${Math.round(ghost.confidence * 100)}%`}
              />
              <button
                onClick={() => setGhostVisible(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255,255,255,0.25)",
                  cursor: "pointer",
                  padding: "0",
                  lineHeight: 1,
                  fontSize: "14px",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Trigger (what was asked) */}
          {ghost.trigger && (
            <div
              style={{
                padding: "5px 8px",
                borderRadius: "5px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "10px",
                color: "rgba(255,255,255,0.35)",
                marginBottom: "8px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              "{ghost.trigger.length > 80 ? ghost.trigger.slice(0, 80) + "…" : ghost.trigger}"
            </div>
          )}

          {/* Response text */}
          <div
            style={{
              fontSize: "12px",
              lineHeight: "1.6",
              color: "rgba(255,255,255,0.88)",
              marginBottom: "10px",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {ghost.response}
          </div>

          {/* Confidence bar */}
          <div style={{ marginBottom: "10px" }}>
            <div style={{ height: "2px", borderRadius: "1px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.round(ghost.confidence * 100)}%`,
                  background: confidenceColor(ghost.confidence),
                  borderRadius: "1px",
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
                flex: 1,
                padding: "5px 10px",
                borderRadius: "5px",
                background: isTyping ? "rgba(99,102,241,0.15)" : "rgba(99,102,241,0.25)",
                border: "1px solid rgba(99,102,241,0.4)",
                color: "rgba(255,255,255,0.85)",
                cursor: isTyping ? "not-allowed" : "pointer",
                fontSize: "11px",
                fontWeight: 500,
                outline: "none",
                transition: "background 0.15s",
              }}
            >
              {isTyping ? "Typing…" : "Type it"}
            </button>
            <button
              onClick={copyResponse}
              style={{
                flex: 1,
                padding: "5px 10px",
                borderRadius: "5px",
                background: isCopying ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.06)",
                border: `1px solid ${isCopying ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.1)"}`,
                color: isCopying ? "#10b981" : "rgba(255,255,255,0.6)",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 500,
                outline: "none",
                transition: "all 0.15s",
              }}
            >
              {isCopying ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Keyboard hint */}
          <div style={{ marginTop: "8px", fontSize: "9px", color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
            Ctrl+G to toggle
          </div>
        </div>
      )}

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div
          style={{
            position: "fixed",
            top: "38px",
            left: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            zIndex: 10001,
          }}
        >
          {toasts.map((toast) => {
            const { border, accent } = toastLevelStyle(toast.level);
            return (
              <div
                key={toast.id}
                style={{
                  width: "300px",
                  background: "rgba(9,9,11,0.94)",
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
                      width: "3px",
                      height: "100%",
                      minHeight: "24px",
                      borderRadius: "2px",
                      background: accent,
                      flexShrink: 0,
                      marginTop: "2px",
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

      {/* Pulse animation for recording dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </div>
  );
}
