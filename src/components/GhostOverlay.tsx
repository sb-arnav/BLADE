/// BLADE Ghost Overlay — floating suggestion card shown during meetings.
///
/// This is the standalone ghost overlay window (legacy path).
/// The HUD bar (HudBar.tsx) also renders the ghost card inline.
/// This component handles the ghost_overlay window launched by ghost_mode.rs.
///
/// Ctrl+G toggles visibility (registered globally).

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

interface GhostSuggestion {
  response: string;
  trigger: string;
  speaker: string | null;
  confidence: number;
  platform: string;
  timestamp_ms: number;
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return "#10b981";
  if (c >= 0.65) return "#f59e0b";
  return "#f87171";
}

export function GhostOverlay() {
  const [suggestion, setSuggestion] = useState<GhostSuggestion | null>(null);
  const [visible, setVisible] = useState(true);
  const [isCopying, setIsCopying] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const windowRef = useRef(getCurrentWindow());

  // Listen for suggestions
  useEffect(() => {
    const unlisten = listen<GhostSuggestion>("ghost_suggestion", (ev) => {
      setSuggestion(ev.payload);
      setVisible(true);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Ctrl+G toggle — both local keyboard and Tauri global shortcut event
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        setVisible((v) => !v);
      }
      if (e.key === "Escape") {
        windowRef.current.hide().catch(() => {});
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const unlisten = listen("ghost_toggle_card", () => {
      setVisible((v) => !v);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const copyResponse = useCallback(async () => {
    if (!suggestion) return;
    try {
      await invoke("set_clipboard", { text: suggestion.response });
      setIsCopying(true);
      setTimeout(() => setIsCopying(false), 1200);
    } catch {
      try {
        await navigator.clipboard.writeText(suggestion.response);
        setIsCopying(true);
        setTimeout(() => setIsCopying(false), 1200);
      } catch {}
    }
  }, [suggestion]);

  const typeResponse = useCallback(async () => {
    if (!suggestion) return;
    setIsTyping(true);
    try {
      await invoke("auto_type_text", { text: suggestion.response });
    } catch {}
    setTimeout(() => setIsTyping(false), 1500);
    setVisible(false);
  }, [suggestion]);

  if (!suggestion || !visible) {
    return (
      <div
        style={{
          width: "100vw",
          height: "100vh",
          background: "transparent",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: "8px",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          onClick={() => setVisible(true)}
          style={{
            padding: "4px 10px",
            borderRadius: "6px",
            background: "rgba(9,9,11,0.7)",
            border: "1px solid rgba(99,102,241,0.25)",
            color: "rgba(255,255,255,0.4)",
            fontSize: "10px",
            cursor: "pointer",
            backdropFilter: "blur(10px)",
          }}
        >
          BLADE {suggestion ? "· Ctrl+G" : "· waiting…"}
        </div>
      </div>
    );
  }

  const gmColor = confidenceColor(suggestion.confidence);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "transparent",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "flex-end",
        padding: "8px",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          width: "300px",
          background: "rgba(9,9,11,0.94)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderRadius: "10px",
          border: "1px solid rgba(99,102,241,0.25)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.7)",
          padding: "12px",
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
              {suggestion.speaker ? `${suggestion.speaker} asked` : "Suggested response"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span
              style={{ width: "6px", height: "6px", borderRadius: "50%", background: gmColor, flexShrink: 0 }}
              title={`Confidence: ${Math.round(suggestion.confidence * 100)}%`}
            />
            <button
              onClick={() => setVisible(false)}
              style={{ background: "none", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", padding: 0, lineHeight: 1, fontSize: "14px" }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Trigger */}
        {suggestion.trigger && (
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
            "{suggestion.trigger.length > 80 ? suggestion.trigger.slice(0, 80) + "…" : suggestion.trigger}"
          </div>
        )}

        {/* Response */}
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
          {suggestion.response}
        </div>

        {/* Confidence bar */}
        <div style={{ marginBottom: "10px" }}>
          <div style={{ height: "2px", borderRadius: "1px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${Math.round(suggestion.confidence * 100)}%`,
                background: gmColor,
                borderRadius: "1px",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px" }}>
            <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.2)" }}>confidence</span>
            <span style={{ fontSize: "9px", color: gmColor }}>{Math.round(suggestion.confidence * 100)}%</span>
          </div>
        </div>

        {/* Actions */}
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
            }}
          >
            {isCopying ? "Copied!" : "Copy"}
          </button>
        </div>

        <div style={{ marginTop: "8px", fontSize: "9px", color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
          Ctrl+G to toggle · Esc to close
        </div>
      </div>
    </div>
  );
}
