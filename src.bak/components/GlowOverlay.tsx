/**
 * GLOW OVERLAY — Visual feedback that BLADE is alive and thinking.
 * Ported from Omi's GlowEdgeWindow / GlowOverlayWindow.
 *
 * Subtle animated border glow around the app window:
 *   - Idle: faint purple pulse (breathing)
 *   - Thinking: brighter blue pulse (processing)
 *   - Speaking: green glow (TTS active)
 *   - Alert: amber glow (needs attention)
 *   - Error: red glow (something went wrong)
 *
 * Uses CSS only — no canvas or WebGL. Lightweight.
 */

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

type GlowState = "idle" | "thinking" | "speaking" | "alert" | "error" | "off";

const glowColors: Record<GlowState, string> = {
  idle: "rgba(129,140,248,0.15)",
  thinking: "rgba(96,165,250,0.35)",
  speaking: "rgba(74,222,128,0.3)",
  alert: "rgba(251,191,36,0.35)",
  error: "rgba(248,113,113,0.3)",
  off: "transparent",
};

const glowAnimations: Record<GlowState, string> = {
  idle: "glow-breathe 4s ease-in-out infinite",
  thinking: "glow-pulse 1.2s ease-in-out infinite",
  speaking: "glow-wave 2s ease-in-out infinite",
  alert: "glow-pulse 0.8s ease-in-out infinite",
  error: "glow-pulse 0.6s ease-in-out infinite",
  off: "none",
};

export function GlowOverlay() {
  const [state, setState] = useState<GlowState>("idle");

  useEffect(() => {
    const cleanups: Array<() => void> = [];

    // Processing → thinking glow
    listen<string>("blade_status", (e) => {
      const status = typeof e.payload === "string" ? e.payload : "";
      if (status === "processing") setState("thinking");
      else if (status === "error") setState("error");
      else if (status === "idle") setState("idle");
    }).then((u) => cleanups.push(u));

    // TTS speaking → green glow
    listen("voice_conversation_speaking", () => setState("speaking"))
      .then((u) => cleanups.push(u));
    listen("voice_conversation_listening", () => setState("idle"))
      .then((u) => cleanups.push(u));

    // Proactive card → alert glow (brief)
    listen("proactive_card", () => {
      setState("alert");
      setTimeout(() => setState("idle"), 3000);
    }).then((u) => cleanups.push(u));

    // Service crash → error glow (brief)
    listen("service_crashed", () => {
      setState("error");
      setTimeout(() => setState("idle"), 5000);
    }).then((u) => cleanups.push(u));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  if (state === "off") return null;

  return (
    <>
      <style>{`
        @keyframes glow-breathe {
          0%, 100% { opacity: 0.3; }
          50% { opacity: 0.7; }
        }
        @keyframes glow-pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }
        @keyframes glow-wave {
          0% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.01); }
          100% { opacity: 0.3; transform: scale(1); }
        }
      `}</style>
      {/* Top edge */}
      <div
        className="fixed top-0 left-0 right-0 h-[2px] z-[9999] pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent, ${glowColors[state]}, transparent)`,
          animation: glowAnimations[state],
          boxShadow: `0 0 15px 5px ${glowColors[state]}`,
        }}
      />
      {/* Bottom edge */}
      <div
        className="fixed bottom-0 left-0 right-0 h-[2px] z-[9999] pointer-events-none"
        style={{
          background: `linear-gradient(90deg, transparent, ${glowColors[state]}, transparent)`,
          animation: glowAnimations[state],
          boxShadow: `0 0 15px 5px ${glowColors[state]}`,
        }}
      />
      {/* Left edge */}
      <div
        className="fixed top-0 bottom-0 left-0 w-[2px] z-[9999] pointer-events-none"
        style={{
          background: `linear-gradient(180deg, transparent, ${glowColors[state]}, transparent)`,
          animation: glowAnimations[state],
          boxShadow: `0 0 15px 5px ${glowColors[state]}`,
        }}
      />
      {/* Right edge */}
      <div
        className="fixed top-0 bottom-0 right-0 w-[2px] z-[9999] pointer-events-none"
        style={{
          background: `linear-gradient(180deg, transparent, ${glowColors[state]}, transparent)`,
          animation: glowAnimations[state],
          boxShadow: `0 0 15px 5px ${glowColors[state]}`,
        }}
      />
    </>
  );
}
