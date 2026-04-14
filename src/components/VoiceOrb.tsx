/**
 * VoiceOrb — the PRIMARY interface for talking to BLADE.
 *
 * A floating circle in the bottom-right corner that is ALWAYS visible.
 * It's not a secondary button — it's the front door.
 *
 * States:
 *   idle        — subtle slow pulse, waiting
 *   listening   — active green pulse + waveform bars animate
 *   processing  — amber spinner ring
 *   speaking    — rhythmic blue pulse (BLADE is talking)
 *   error       — red, click to dismiss
 *
 * Interactions:
 *   click           — start/stop voice conversation
 *   long-press      — push-to-talk (hold to record, release to send)
 *   drag            — move to any corner (persisted to localStorage)
 *
 * When voice is active, fires onOpenChat() so the chat panel auto-opens
 * to show the transcript.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceStatus } from "../hooks/useVoiceMode";

type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

interface Props {
  // Legacy voice mode (PTT / always-on background mode)
  status: VoiceStatus;
  mode: string;
  onDismissError?: () => void;

  // Conversational voice mode (Phase 6)
  conversationState?: "idle" | "listening" | "thinking" | "speaking";
  isConversationActive?: boolean;
  onStartConversation?: () => Promise<void>;
  onStopConversation?: () => void;

  // PTT handlers
  onPttDown?: () => void;
  onPttUp?: () => void;

  // Opens chat panel to show transcript
  onOpenChat?: () => void;

  // Last BLADE response for tooltip
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

// Waveform bars — animate when voice is active
function Waveform({ active, color }: { active: boolean; color: string }) {
  const bars = [3, 5, 8, 6, 9, 5, 3];
  return (
    <div className="flex items-end gap-[1.5px] h-4">
      {bars.map((base, i) => (
        <div
          key={i}
          className={`w-[2px] rounded-full transition-all ${color}`}
          style={{
            height: active ? `${base + 2}px` : "3px",
            animation: active ? `blade-waveform ${0.5 + i * 0.07}s ease-in-out infinite alternate` : "none",
            animationDelay: `${i * 0.06}s`,
            opacity: active ? 0.9 : 0.3,
          }}
        />
      ))}
    </div>
  );
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

  // PTT auto-open chat
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

    // Long-press = PTT
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

    if (pttModeRef.current) {
      // Release PTT
      setIsPttActive(false);
      onPttUp?.();
      pttModeRef.current = false;
      dragStartRef.current = null;
      setIsDragging(false);
      return;
    }

    if (isDragging) {
      // Drop into nearest corner
      const newCorner = getCornerFromPosition(e.clientX, e.clientY);
      setCorner(newCorner);
      try { localStorage.setItem("blade-voice-orb-corner", newCorner); } catch {}
      setIsDragging(false);
      dragStartRef.current = null;
      didDragRef.current = false;
      return;
    }

    // Regular click — toggle conversation
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
  // Priority: conversation state > legacy voice status
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

  // Colors and animations per state
  const stateConfig = {
    idle:       { ring: "border-blade-border/30",        glow: "",                          dot: "bg-blade-muted/40",         waveColor: "bg-blade-muted/40",    label: "Click to talk" },
    listening:  { ring: "border-emerald-500/60",         glow: "shadow-emerald-500/20",     dot: "bg-emerald-400",            waveColor: "bg-emerald-400",       label: "Listening..." },
    thinking:   { ring: "border-amber-500/60",           glow: "shadow-amber-500/20",       dot: "bg-amber-400",              waveColor: "bg-amber-400",         label: "Thinking..." },
    speaking:   { ring: "border-blade-accent/70",        glow: "shadow-blade-accent/25",    dot: "bg-blade-accent",           waveColor: "bg-blade-accent",      label: "Speaking" },
    recording:  { ring: "border-red-500/70",             glow: "shadow-red-500/20",         dot: "bg-red-500",                waveColor: "bg-red-400",           label: "Recording" },
    processing: { ring: "border-amber-400/60",           glow: "shadow-amber-400/20",       dot: "bg-amber-400",              waveColor: "bg-amber-400",         label: "Processing..." },
    error:      { ring: "border-red-500/50",             glow: "",                          dot: "bg-red-500/70",             waveColor: "bg-red-400",           label: "Mic error — click to dismiss" },
  }[orbState];

  // Pulse animation class per state
  const pulseClass = {
    idle:       "animate-pulse-slow",
    listening:  "animate-ping",
    thinking:   "",
    speaking:   "animate-pulse",
    recording:  "animate-ping",
    processing: "",
    error:      "",
  }[orbState];

  // Spinner ring for thinking/processing
  const showSpinner = orbState === "thinking" || orbState === "processing";

  const cornerStyle = getCornerStyle(corner);

  return (
    <>
      {/* Waveform keyframes */}
      <style>{`
        @keyframes blade-waveform {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.6); }
        }
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 0.8; transform: scale(1.05); }
        }
        .animate-pulse-slow {
          animation: pulse-slow 3s ease-in-out infinite;
        }
      `}</style>

      <div
        ref={orbRef}
        className={`fixed z-50 flex flex-col items-center gap-2 select-none ${isDragging ? "cursor-grabbing" : "cursor-pointer"}`}
        style={{ ...cornerStyle, touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title={stateConfig.label}
      >
        {/* Tooltip — last response or state hint */}
        {(showTooltip && tooltipText) && (
          <div
            className="absolute bottom-full mb-3 right-0 max-w-[220px] bg-blade-surface/95 border border-blade-border/60 rounded-xl px-3 py-2 shadow-surface-xl backdrop-blur-md pointer-events-none animate-fade-in"
            style={{ fontSize: "11px", lineHeight: "1.5", color: "var(--color-blade-text)" }}
          >
            <div className="text-blade-muted/40 text-[9px] uppercase tracking-[0.15em] font-semibold mb-0.5">BLADE said</div>
            {tooltipText}
            {/* Arrow */}
            <div className="absolute bottom-[-5px] right-4 w-2.5 h-2.5 bg-blade-surface/95 border-r border-b border-blade-border/60 rotate-45" />
          </div>
        )}

        {/* Label — only show when active */}
        {isActive && (
          <div className="text-[9px] font-medium uppercase tracking-[0.18em] text-blade-muted/60 pointer-events-none">
            {stateConfig.label}
          </div>
        )}

        {/* Waveform — shown when listening or recording */}
        {(orbState === "listening" || orbState === "recording") && (
          <Waveform active={true} color={stateConfig.waveColor} />
        )}

        {/* Main orb */}
        <div className="relative flex items-center justify-center">
          {/* Outer glow ring — pings when active */}
          {isActive && pulseClass && (
            <div
              className={`absolute w-14 h-14 rounded-full border ${stateConfig.ring} ${pulseClass} opacity-40`}
              style={{ animationDuration: orbState === "listening" || orbState === "recording" ? "1s" : "2s" }}
            />
          )}

          {/* Spinner ring for thinking/processing */}
          {showSpinner && (
            <div
              className={`absolute w-12 h-12 rounded-full border-2 border-transparent ${orbState === "thinking" ? "border-t-amber-400/80" : "border-t-amber-300/80"} animate-spin`}
              style={{ animationDuration: "0.9s" }}
            />
          )}

          {/* Core circle */}
          <div
            className={`w-10 h-10 rounded-full border-2 ${stateConfig.ring} bg-blade-surface/90 backdrop-blur-sm shadow-surface-xl flex items-center justify-center transition-all duration-300 ${isActive ? stateConfig.glow + " shadow-lg" : ""}`}
          >
            {/* Center indicator */}
            {orbState === "speaking" ? (
              // Sound waves icon when speaking
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-blade-accent" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            ) : orbState === "thinking" || orbState === "processing" ? (
              // Dots for thinking
              <div className="flex gap-0.5 items-center">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1 h-1 rounded-full bg-amber-400/80 animate-bounce"
                    style={{ animationDelay: `${i * 0.12}s`, animationDuration: "0.8s" }}
                  />
                ))}
              </div>
            ) : orbState === "error" ? (
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              </svg>
            ) : orbState === "listening" || orbState === "recording" ? (
              // Mic icon when listening
              <svg viewBox="0 0 24 24" className={`w-4 h-4 ${orbState === "recording" ? "text-red-400" : "text-emerald-400"}`} fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            ) : (
              // Idle — subtle mic
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-blade-muted/50" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </div>

          {/* Idle slow pulse */}
          {orbState === "idle" && (
            <div className={`absolute w-10 h-10 rounded-full bg-blade-muted/5 ${pulseClass}`} />
          )}
        </div>

        {/* PTT hint */}
        {mode === "push-to-talk" && orbState === "idle" && (
          <div className="text-[8px] text-blade-muted/30 pointer-events-none">hold</div>
        )}
      </div>
    </>
  );
}
