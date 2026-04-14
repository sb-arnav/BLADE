/// BLADE Ghost Overlay — sci-fi meeting suggestion card.
///
/// Sci-fi upgrades:
///   - Glass effect with backdrop-blur + border glow
///   - Visual confidence bar (not just text)
///   - Speaker labels with distinct colors per person
///   - "Type it" button shows brief keyboard animation when clicked
///   - New suggestion slides in from bottom with bounce
///   - Ctrl+G toggles visibility

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

// ── Speaker color palette ────────────────────────────────────────────────────
// Deterministic color based on speaker name hash

const SPEAKER_PALETTE = [
  { bg: "rgba(99,102,241,0.2)",  border: "rgba(99,102,241,0.45)", text: "#a5b4fc" },  // indigo
  { bg: "rgba(16,185,129,0.18)", border: "rgba(16,185,129,0.4)",  text: "#6ee7b7" },  // emerald
  { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.38)", text: "#fcd34d" },  // amber
  { bg: "rgba(236,72,153,0.15)", border: "rgba(236,72,153,0.38)", text: "#f9a8d4" },  // pink
  { bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.4)",  text: "#93c5fd" },  // blue
  { bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.4)",  text: "#d8b4fe" },  // purple
];

function speakerColor(name: string | null) {
  if (!name) return SPEAKER_PALETTE[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return SPEAKER_PALETTE[hash % SPEAKER_PALETTE.length];
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return "#10b981";
  if (c >= 0.65) return "#f59e0b";
  return "#f87171";
}

function confidenceLabel(c: number): string {
  if (c >= 0.85) return "HIGH";
  if (c >= 0.65) return "MED";
  return "LOW";
}

// ── Keyboard animation on "Type it" ──────────────────────────────────────────

function KeyboardAnim() {
  return (
    <div style={{ display: "flex", gap: "3px", alignItems: "center", justifyContent: "center" }}>
      {["K", "E", "Y", "S"].map((ch, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "14px",
            height: "14px",
            borderRadius: "2px",
            background: "rgba(99,102,241,0.35)",
            border: "1px solid rgba(99,102,241,0.6)",
            fontSize: "8px",
            fontWeight: 700,
            color: "#a5b4fc",
            fontFamily: "monospace",
            animation: `keyPress 0.4s ease-in-out forwards`,
            animationDelay: `${i * 0.06}s`,
          }}
        >
          {ch}
        </span>
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GhostOverlay() {
  const [suggestion, setSuggestion] = useState<GhostSuggestion | null>(null);
  const [visible, setVisible] = useState(true);
  const [isCopying, setIsCopying] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [isKeyboardAnim, setIsKeyboardAnim] = useState(false);
  const [isSlideIn, setIsSlideIn] = useState(false);
  const windowRef = useRef(getCurrentWindow());

  // Listen for suggestions
  useEffect(() => {
    const unlisten = listen<GhostSuggestion>("ghost_suggestion", (ev) => {
      setSuggestion(ev.payload);
      setVisible(true);
      // Trigger slide-in bounce
      setIsSlideIn(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsSlideIn(true));
      });
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
    setIsKeyboardAnim(true);
    setTimeout(() => setIsKeyboardAnim(false), 700);
    try {
      await invoke("auto_type_text", { text: suggestion.response });
    } catch {}
    setTimeout(() => setIsTyping(false), 1500);
    setVisible(false);
  }, [suggestion]);

  // ── Empty/hidden state ──────────────────────────────────────────────────────

  if (!suggestion || !visible) {
    return (
      <>
        <style>{`
          @keyframes keyPress {
            0% { transform: translateY(0); background: rgba(99,102,241,0.35); }
            40% { transform: translateY(2px); background: rgba(99,102,241,0.6); }
            100% { transform: translateY(0); background: rgba(99,102,241,0.35); }
          }
          @keyframes slideInBounce {
            0%  { transform: translateY(40px); opacity: 0; }
            65% { transform: translateY(-6px); opacity: 1; }
            80% { transform: translateY(3px); }
            100%{ transform: translateY(0); opacity: 1; }
          }
          @keyframes confidenceFill {
            from { width: 0%; }
          }
        `}</style>
        <div
          style={{
            width: "100vw", height: "100vh", background: "transparent",
            display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
            padding: "8px",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          }}
        >
          <div
            onClick={() => setVisible(true)}
            style={{
              padding: "4px 10px", borderRadius: "6px",
              background: "rgba(6,6,10,0.75)",
              border: "1px solid rgba(99,102,241,0.25)",
              color: "rgba(255,255,255,0.4)", fontSize: "10px",
              cursor: "pointer", backdropFilter: "blur(12px)",
            }}
          >
            BLADE {suggestion ? "· Ctrl+G" : "· waiting…"}
          </div>
        </div>
      </>
    );
  }

  const sc = speakerColor(suggestion.speaker);
  const confColor = confidenceColor(suggestion.confidence);
  const confPct = Math.round(suggestion.confidence * 100);

  return (
    <>
      <style>{`
        @keyframes keyPress {
          0% { transform: translateY(0); background: rgba(99,102,241,0.35); }
          40% { transform: translateY(2px); background: rgba(99,102,241,0.6); }
          100% { transform: translateY(0); background: rgba(99,102,241,0.35); }
        }
        @keyframes slideInBounce {
          0%  { transform: translateY(40px); opacity: 0; }
          65% { transform: translateY(-6px); opacity: 1; }
          80% { transform: translateY(3px); }
          100%{ transform: translateY(0); opacity: 1; }
        }
        @keyframes confidenceFill {
          from { width: 0%; }
          to { width: ${confPct}%; }
        }
        @keyframes borderGlow {
          0%, 100% { box-shadow: 0 16px 48px rgba(0,0,0,0.8), 0 0 0 0.5px rgba(255,255,255,0.03), 0 0 16px rgba(99,102,241,0.06); }
          50% { box-shadow: 0 16px 48px rgba(0,0,0,0.8), 0 0 0 0.5px rgba(255,255,255,0.03), 0 0 28px rgba(99,102,241,0.14); }
        }
      `}</style>

      <div
        style={{
          width: "100vw", height: "100vh", background: "transparent",
          display: "flex", alignItems: "flex-end", justifyContent: "flex-end",
          padding: "8px",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            width: "320px",
            background: "rgba(6,6,10,0.88)",
            backdropFilter: "blur(28px) saturate(180%)",
            WebkitBackdropFilter: "blur(28px) saturate(180%)",
            borderRadius: "12px",
            border: "1px solid rgba(99,102,241,0.28)",
            animation: isSlideIn
              ? "slideInBounce 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards, borderGlow 3s ease-in-out infinite"
              : "borderGlow 3s ease-in-out infinite",
            padding: "14px",
          }}
        >
          {/* Header: speaker badge + confidence badge + close */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              {/* BLADE logo */}
              <div style={{
                width: "16px", height: "16px", borderRadius: "4px",
                background: "rgba(99,102,241,0.2)", display: "flex",
                alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <svg viewBox="0 0 16 16" width="10" height="10" fill="none">
                  <path d="M8 2L14 8L8 14L2 8L8 2Z" fill="#6366f1" fillOpacity="0.9" />
                </svg>
              </div>

              {/* Speaker label — color per person */}
              {suggestion.speaker ? (
                <div style={{
                  padding: "2px 7px", borderRadius: "4px",
                  background: sc.bg, border: `1px solid ${sc.border}`,
                  fontSize: "10px", fontWeight: 600, color: sc.text,
                  letterSpacing: "0.02em", flexShrink: 0,
                }}>
                  {suggestion.speaker}
                </div>
              ) : (
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "10px" }}>
                  Suggested response
                </span>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
              {/* Confidence badge */}
              <div style={{
                padding: "1px 6px", borderRadius: "3px",
                background: `${confColor}14`,
                border: `1px solid ${confColor}30`,
                fontSize: "9px", fontWeight: 700,
                color: confColor, letterSpacing: "0.06em",
              }}>
                {confPct}%
              </div>

              <button
                onClick={() => setVisible(false)}
                style={{
                  background: "none", border: "none",
                  color: "rgba(255,255,255,0.22)", cursor: "pointer",
                  padding: 0, lineHeight: 1, fontSize: "14px",
                }}
              >
                ×
              </button>
            </div>
          </div>

          {/* Trigger */}
          {suggestion.trigger && (
            <div style={{
              padding: "5px 9px", borderRadius: "6px",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: "10px", color: "rgba(255,255,255,0.32)",
              marginBottom: "9px", overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              "{suggestion.trigger.length > 80 ? suggestion.trigger.slice(0, 80) + "…" : suggestion.trigger}"
            </div>
          )}

          {/* Response */}
          <div style={{
            fontSize: "12px", lineHeight: "1.65",
            color: "rgba(255,255,255,0.9)",
            marginBottom: "11px", wordBreak: "break-word", whiteSpace: "pre-wrap",
          }}>
            {suggestion.response}
          </div>

          {/* Confidence meter — visual bar */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "9px", color: "rgba(255,255,255,0.18)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                confidence
              </span>
              <span style={{ fontSize: "9px", fontWeight: 700, color: confColor, letterSpacing: "0.04em" }}>
                {confidenceLabel(suggestion.confidence)}
              </span>
            </div>
            {/* Track */}
            <div style={{
              height: "4px", borderRadius: "2px",
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
              position: "relative",
            }}>
              {/* Segmented tick marks */}
              {[25, 50, 75].map((pct) => (
                <div key={pct} style={{
                  position: "absolute", top: 0, bottom: 0,
                  left: `${pct}%`, width: "1px",
                  background: "rgba(0,0,0,0.4)", zIndex: 1,
                }} />
              ))}
              {/* Fill */}
              <div style={{
                height: "100%",
                width: `${confPct}%`,
                background: `linear-gradient(90deg, ${confColor}80, ${confColor})`,
                borderRadius: "2px",
                animation: "confidenceFill 0.6s ease-out",
                boxShadow: `0 0 6px ${confColor}60`,
              }} />
            </div>
          </div>

          {/* Action buttons */}
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={typeResponse}
              disabled={isTyping}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: "6px",
                background: isTyping ? "rgba(99,102,241,0.2)" : "rgba(99,102,241,0.28)",
                border: "1px solid rgba(99,102,241,0.45)",
                color: "rgba(255,255,255,0.88)",
                cursor: isTyping ? "not-allowed" : "pointer",
                fontSize: "11px", fontWeight: 600,
                outline: "none", transition: "background 0.15s",
                minHeight: "30px",
              }}
            >
              {isKeyboardAnim ? <KeyboardAnim /> : isTyping ? "Typing…" : "Type it"}
            </button>
            <button
              onClick={copyResponse}
              style={{
                flex: 1, padding: "6px 10px", borderRadius: "6px",
                background: isCopying ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${isCopying ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.09)"}`,
                color: isCopying ? "#10b981" : "rgba(255,255,255,0.55)",
                cursor: "pointer", fontSize: "11px", fontWeight: 500,
                outline: "none", transition: "all 0.15s",
              }}
            >
              {isCopying ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Footer hint */}
          <div style={{ marginTop: "9px", fontSize: "9px", color: "rgba(255,255,255,0.14)", textAlign: "center", letterSpacing: "0.02em" }}>
            Ctrl+G to toggle · Esc to close
          </div>
        </div>
      </div>
    </>
  );
}
