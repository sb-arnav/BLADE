/// BLADE Ghost Overlay — clean frosted glass suggestion card. Apple style.

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

// Deterministic color per speaker (text only, no background badges)
const SPEAKER_COLORS = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#a78bfa"];

function speakerColor(name: string | null): string {
  if (!name) return "rgba(255,255,255,0.55)";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_COLORS[hash % SPEAKER_COLORS.length];
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return "#34c759";
  if (c >= 0.65) return "#f59e0b";
  return "#ff3b30";
}

// ── Component ─────────────────────────────────────────────────────────────────

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion]);

  // Ctrl+G toggle
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

  // ── Hidden/empty state ──────────────────────────────────────────────────────

  if (!suggestion || !visible) {
    return (
      <div
        style={{
          width: "100vw", height: "100vh", background: "transparent",
          display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
          padding: "10px",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          onClick={() => setVisible(true)}
          style={{
            padding: "5px 12px", borderRadius: "8px",
            background: "rgba(18,18,22,0.82)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.4)", fontSize: "12px",
            cursor: "pointer",
            backdropFilter: "blur(20px) saturate(1.8)",
            WebkitBackdropFilter: "blur(20px) saturate(1.8)",
          }}
        >
          BLADE{suggestion ? " · Ctrl+G" : " · waiting"}
        </div>
      </div>
    );
  }

  const confColor = confidenceColor(suggestion.confidence);

  return (
    <>
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          width: "100vw", height: "100vh", background: "transparent",
          display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
          padding: "10px",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            width: "300px",
            background: "rgba(18,18,22,0.92)",
            backdropFilter: "blur(28px) saturate(1.8)",
            WebkitBackdropFilter: "blur(28px) saturate(1.8)",
            borderRadius: "14px",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06) inset",
            padding: "16px",
            animation: "slideUp 0.25s ease",
          }}
        >
          {/* Header: speaker name (colored text) + confidence dot + close */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {suggestion.speaker ? (
                <span style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: speakerColor(suggestion.speaker),
                }}>
                  {suggestion.speaker}
                </span>
              ) : (
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "13px" }}>
                  Suggestion
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "6px", height: "6px", borderRadius: "50%",
                  background: confColor, flexShrink: 0,
                }}
                title={`${Math.round(suggestion.confidence * 100)}% confidence`}
              />
              <button
                onClick={() => setVisible(false)}
                style={{
                  background: "none", border: "none",
                  color: "rgba(255,255,255,0.3)", cursor: "pointer",
                  padding: "2px", lineHeight: 1, fontSize: "16px",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Trigger quote */}
          {suggestion.trigger && (
            <p style={{
              fontSize: "12px",
              color: "rgba(255,255,255,0.35)",
              marginBottom: "10px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontStyle: "italic",
            }}>
              "{suggestion.trigger.length > 80 ? suggestion.trigger.slice(0, 80) + "…" : suggestion.trigger}"
            </p>
          )}

          {/* Response text */}
          <p style={{
            fontSize: "13px",
            lineHeight: "1.65",
            color: "rgba(255,255,255,0.88)",
            marginBottom: "16px",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
          }}>
            {suggestion.response}
          </p>

          {/* Use / Dismiss buttons */}
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={typeResponse}
              disabled={isTyping}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: "8px",
                background: "rgba(99,102,241,0.18)",
                border: "none",
                color: isTyping ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.9)",
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
                flex: 1, padding: "8px 12px", borderRadius: "8px",
                background: isCopying ? "rgba(52,199,89,0.18)" : "rgba(255,255,255,0.07)",
                border: "none",
                color: isCopying ? "#34c759" : "rgba(255,255,255,0.5)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
                outline: "none",
                transition: "all 0.25s ease",
              }}
            >
              {isCopying ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setVisible(false)}
              style={{
                padding: "8px 12px", borderRadius: "8px",
                background: "rgba(255,255,255,0.05)",
                border: "none",
                color: "rgba(255,255,255,0.35)",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: 500,
                outline: "none",
                transition: "background 0.25s ease",
              }}
            >
              Dismiss
            </button>
          </div>

          <p style={{ marginTop: "10px", fontSize: "11px", color: "rgba(255,255,255,0.18)", textAlign: "center" }}>
            Ctrl+G to toggle
          </p>
        </div>
      </div>
    </>
  );
}
