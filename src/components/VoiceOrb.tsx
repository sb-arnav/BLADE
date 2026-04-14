/**
 * VoiceOrb — the PRIMARY interface for talking to BLADE.
 *
 * Apple Siri-style: a morphing gradient sphere. No particles, no orbiting dots.
 * Clean, purposeful, minimal.
 *
 * States:
 *   idle        — quiet sphere, gentle breathe
 *   listening   — green blob morphs
 *   processing  — spinner ring
 *   speaking    — blue pulsing blob
 *   error       — red, click to dismiss
 *
 * Interactions:
 *   click           — start/stop voice conversation
 *   long-press      — push-to-talk
 *   drag            — move to any corner (persisted to localStorage)
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceStatus } from "../hooks/useVoiceMode";

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

interface Props {
  status: VoiceStatus;
  mode: string;
  onDismissError?: () => void;

  conversationState?: "idle" | "listening" | "thinking" | "speaking";
  isConversationActive?: boolean;
  onStartConversation?: () => Promise<void>;
  onStopConversation?: () => void;

  onPttDown?: () => void;
  onPttUp?: () => void;

  onOpenChat?: () => void;

  lastResponse?: string | null;
}

const LONG_PRESS_MS = 400;
const DRAG_THRESHOLD_PX = 6;

function getCornerStyle(corner: Corner): React.CSSProperties {
  switch (corner) {
    case "bottom-right": return { bottom: "1.5rem", right: "1.5rem" };
    case "bottom-left":  return { bottom: "1.5rem", left:  "1.5rem" };
    case "top-right":    return { top:    "1.5rem", right: "1.5rem" };
    case "top-left":     return { top:    "1.5rem", left:  "1.5rem" };
  }
}

function getCornerFromPosition(x: number, y: number): Corner {
  const midX = window.innerWidth / 2;
  const midY = window.innerHeight / 2;
  if (x < midX && y < midY) return "top-left";
  if (x >= midX && y < midY) return "top-right";
  if (x < midX && y >= midY) return "bottom-left";
  return "bottom-right";
}

function loadCorner(): Corner {
  try {
    const saved = localStorage.getItem("blade-voice-orb-corner");
    if (saved === "bottom-right" || saved === "bottom-left" || saved === "top-right" || saved === "top-left") {
      return saved;
    }
  } catch {}
  return "bottom-right";
}

export function VoiceOrb({
  status,
  mode,
  onDismissError,
  conversationState = "idle",
  isConversationActive = false,
  onStartConversation,
  onStopConversation,
  onPttDown,
  onPttUp,
  onOpenChat,
  lastResponse,
}: Props) {
  const [corner, setCorner] = useState<Corner>(loadCorner);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipText, setTooltipText] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPttActive, setIsPttActive] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  const orbRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const didDragRef = useRef(false);
  const pttModeRef = useRef(false);

  // Show last response as tooltip briefly
  useEffect(() => {
    if (lastResponse && conversationState === "idle" && !isConversationActive) {
      setTooltipText(lastResponse.slice(0, 120) + (lastResponse.length > 120 ? "…" : ""));
      setShowTooltip(true);
      const t = setTimeout(() => setShowTooltip(false), 4000);
      return () => clearTimeout(t);
    }
  }, [lastResponse, conversationState, isConversationActive]);

  // Auto-open chat when conversation becomes active
  useEffect(() => {
    if (isConversationActive && onOpenChat) {
      onOpenChat();
    }
  }, [isConversationActive, onOpenChat]);

  useEffect(() => {
    if (isPttActive && onOpenChat) {
      onOpenChat();
    }
  }, [isPttActive, onOpenChat]);

  // ── Drag logic ─────────────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    didDragRef.current = false;
    pttModeRef.current = false;
    setIsPressed(true);

    longPressTimer.current = setTimeout(() => {
      if (!didDragRef.current && mode === "push-to-talk") {
        pttModeRef.current = true;
        setIsPttActive(true);
        onPttDown?.();
      }
    }, LONG_PRESS_MS);

    e.currentTarget.setPointerCapture(e.pointerId);
  }, [mode, onPttDown]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      didDragRef.current = true;
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      setIsDragging(true);
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    setIsPressed(false);

    if (pttModeRef.current) {
      setIsPttActive(false);
      onPttUp?.();
      pttModeRef.current = false;
      dragStartRef.current = null;
      setIsDragging(false);
      return;
    }

    if (isDragging) {
      const newCorner = getCornerFromPosition(e.clientX, e.clientY);
      setCorner(newCorner);
      try { localStorage.setItem("blade-voice-orb-corner", newCorner); } catch {}
      setIsDragging(false);
      dragStartRef.current = null;
      didDragRef.current = false;
      return;
    }

    dragStartRef.current = null;
    didDragRef.current = false;

    if (status === "error") {
      onDismissError?.();
      return;
    }

    if (isConversationActive) {
      onStopConversation?.();
    } else {
      onStartConversation?.();
    }
  }, [isDragging, status, isConversationActive, onDismissError, onStopConversation, onStartConversation, onPttUp]);

  // ── Derive visual state ────────────────────────────────────────────────────
  let orbState: "idle" | "listening" | "thinking" | "speaking" | "recording" | "processing" | "error" = "idle";
  if (status === "error") {
    orbState = "error";
  } else if (isConversationActive) {
    orbState = conversationState === "idle" ? "listening" : conversationState;
  } else if (isPttActive || status === "recording" || status === "detecting") {
    orbState = "recording";
  } else if (status === "processing") {
    orbState = "processing";
  } else if (status === "listening") {
    orbState = "listening";
  }

  const isActive = orbState !== "idle" && orbState !== "error";

  // State config — Apple color palette, no glow
  const stateConfig = {
    idle:       {
      gradient: "radial-gradient(circle at 35% 35%, #3a3a4c 0%, #1c1c1e 70%)",
      shadow: "0 4px 16px rgba(0,0,0,0.4), 0 1px 4px rgba(0,0,0,0.3)",
      ring: "rgba(255,255,255,0.08)",
      label: "Click to talk",
    },
    listening:  {
      gradient: "radial-gradient(circle at 35% 35%, #1e5c34 0%, #0d3320 50%, #030f08 100%)",
      shadow: "0 4px 20px rgba(48,209,88,0.15), 0 1px 6px rgba(0,0,0,0.4)",
      ring: "rgba(48,209,88,0.25)",
      label: "Listening...",
    },
    thinking:   {
      gradient: "radial-gradient(circle at 35% 35%, #4a3500 0%, #291e00 50%, #0a0800 100%)",
      shadow: "0 4px 20px rgba(255,214,10,0.12), 0 1px 6px rgba(0,0,0,0.4)",
      ring: "rgba(255,214,10,0.2)",
      label: "Thinking...",
    },
    speaking:   {
      gradient: "radial-gradient(circle at 35% 35%, #003878 0%, #001f4a 50%, #000815 100%)",
      shadow: "0 4px 20px rgba(0,122,255,0.2), 0 1px 6px rgba(0,0,0,0.4)",
      ring: "rgba(0,122,255,0.25)",
      label: "Speaking",
    },
    recording:  {
      gradient: "radial-gradient(circle at 35% 35%, #5c1010 0%, #360808 50%, #0f0202 100%)",
      shadow: "0 4px 20px rgba(255,69,58,0.15), 0 1px 6px rgba(0,0,0,0.4)",
      ring: "rgba(255,69,58,0.25)",
      label: "Recording",
    },
    processing: {
      gradient: "radial-gradient(circle at 35% 35%, #4a3500 0%, #291e00 50%, #0a0800 100%)",
      shadow: "0 4px 20px rgba(255,214,10,0.12), 0 1px 6px rgba(0,0,0,0.4)",
      ring: "rgba(255,214,10,0.2)",
      label: "Processing...",
    },
    error:      {
      gradient: "radial-gradient(circle at 35% 35%, #4a1010 0%, #2a0808 70%)",
      shadow: "0 4px 16px rgba(255,69,58,0.12), 0 1px 4px rgba(0,0,0,0.4)",
      ring: "rgba(255,69,58,0.2)",
      label: "Error — click to dismiss",
    },
  }[orbState];

  const showSpinner = orbState === "thinking" || orbState === "processing";
  const cornerStyle = getCornerStyle(corner);

  // Scale: hover +5%, press -5%
  const scale = isPressed ? 0.95 : isHovered ? 1.05 : 1;

  return (
    <>
      <style>{`
        @keyframes siri-morph {
          0%,100% { border-radius: 50%; }
          20%      { border-radius: 46% 54% 52% 48% / 50% 48% 52% 50%; }
          40%      { border-radius: 52% 48% 48% 52% / 46% 52% 48% 54%; }
          60%      { border-radius: 48% 52% 54% 46% / 52% 50% 50% 48%; }
          80%      { border-radius: 54% 46% 50% 50% / 48% 54% 46% 52%; }
        }
        @keyframes orb-idle-breathe {
          0%,100% { transform: scale(1); opacity: 0.9; }
          50%       { transform: scale(1.03); opacity: 1; }
        }
        @keyframes orb-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>

      <div
        ref={orbRef}
        className={`fixed z-50 flex flex-col items-center gap-2 select-none ${isDragging ? "cursor-grabbing" : "cursor-pointer"}`}
        style={{ ...cornerStyle, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title={stateConfig.label}
      >
        {/* Tooltip — last response */}
        {(showTooltip && tooltipText) && (
          <div
            className="absolute bottom-full mb-3 right-0 max-w-[220px] rounded-xl px-3 py-2.5 pointer-events-none animate-fade-in"
            style={{
              background: "rgba(44,44,46,0.95)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
              fontSize: "11px",
              lineHeight: "1.5",
              color: "#ffffff",
            }}
          >
            <div className="text-[9px] uppercase tracking-[0.12em] font-semibold mb-1" style={{ color: "#8e8e93" }}>
              BLADE
            </div>
            {tooltipText}
            <div className="absolute bottom-[-5px] right-4 w-2.5 h-2.5 rotate-45"
              style={{ background: "rgba(44,44,46,0.95)", border: "0 solid transparent", borderRight: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>
        )}

        {/* State label — only when active */}
        {isActive && (
          <div className="text-[9px] font-medium tracking-[0.12em] pointer-events-none"
            style={{ color: "#8e8e93", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            {stateConfig.label}
          </div>
        )}

        {/* Main orb */}
        <div className="relative flex items-center justify-center"
          style={{
            transition: "transform 250ms cubic-bezier(0.25, 0.1, 0.25, 1)",
            transform: `scale(${scale})`,
          }}
        >
          {/* Outer ring — very subtle */}
          <div
            className="absolute w-12 h-12 rounded-full"
            style={{
              border: `1px solid ${stateConfig.ring}`,
              transition: "border-color 400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
            }}
          />

          {/* Spinner ring for thinking/processing */}
          {showSpinner && (
            <div
              className="absolute w-12 h-12 rounded-full"
              style={{
                border: "1.5px solid transparent",
                borderTopColor: "rgba(255,214,10,0.7)",
                animation: "orb-spin 0.9s linear infinite",
              }}
            />
          )}

          {/* Core sphere — Siri morphing blob */}
          <div
            className="w-10 h-10 flex items-center justify-center"
            style={{
              background: stateConfig.gradient,
              boxShadow: stateConfig.shadow,
              animation: isActive
                ? `siri-morph ${orbState === "listening" || orbState === "recording" ? "1.2s" : "2s"} ease-in-out infinite`
                : "orb-idle-breathe 3.5s ease-in-out infinite",
              transition: "background 400ms cubic-bezier(0.25, 0.1, 0.25, 1), box-shadow 400ms cubic-bezier(0.25, 0.1, 0.25, 1)",
            }}
          >
            {/* Center icon */}
            {orbState === "speaking" ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="rgba(0,122,255,0.9)" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            ) : orbState === "thinking" || orbState === "processing" ? (
              <div className="flex gap-0.5 items-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1 h-1 rounded-full animate-bounce"
                    style={{
                      backgroundColor: "rgba(255,214,10,0.8)",
                      animationDelay: `${i * 0.12}s`,
                      animationDuration: "0.8s",
                    }}
                  />
                ))}
              </div>
            ) : orbState === "error" ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="rgba(255,69,58,0.9)" strokeWidth="2">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            ) : orbState === "listening" || orbState === "recording" ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none"
                stroke={orbState === "recording" ? "rgba(255,69,58,0.9)" : "rgba(48,209,88,0.9)"}
                strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="rgba(142,142,147,0.6)" strokeWidth="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </div>

          {/* Subtle shadow under orb for depth */}
          <div
            className="absolute -bottom-2 w-8 h-2 rounded-full pointer-events-none"
            style={{
              background: "rgba(0,0,0,0.3)",
              filter: "blur(4px)",
              opacity: isActive ? 0.6 : 0.35,
              transition: "opacity 400ms ease",
            }}
          />
        </div>

        {/* PTT hint */}
        {mode === "push-to-talk" && orbState === "idle" && (
          <div className="text-[8px] pointer-events-none" style={{ color: "rgba(142,142,147,0.4)", letterSpacing: "0.08em" }}>hold</div>
        )}
      </div>
    </>
  );
}
