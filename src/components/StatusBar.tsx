/**
 * StatusBar — VS Code-style bottom bar, 28px tall.
 *
 * Left:   current model + provider
 * Center: God Mode tier (Normal / Intermediate / Extreme / Off)
 * Right:  streak · active tentacles · voice status
 */

import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Props {
  provider?: string;
  model?: string;
  streakDays?: number;
}

interface GodModeUpdate {
  tier: string;
}

export function StatusBar({ provider, model, streakDays = 0 }: Props) {
  const [godModeTier, setGodModeTier] = useState<string>("off");
  const [tentacleCount, setTentacleCount] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);

  // Model display — trim to readable length
  const modelShort = model
    ? model
        .replace(/^accounts\/.*\/models\//, "")
        .split("/")
        .pop()
        ?.replace(/-\d{8}$/, "")
        .replace(/^claude-/, "")
        .replace(/^gpt-/, "")
        .replace(/^gemini-/, "") ?? model
    : null;

  const providerShort = provider
    ? provider.charAt(0).toUpperCase() + provider.slice(1).toLowerCase()
    : null;

  useEffect(() => {
    // Load initial god mode state
    invoke<{ tier: string; enabled: boolean }>("god_mode_status")
      .then((s) => setGodModeTier(s.enabled ? s.tier : "off"))
      .catch(() => {});

    // Load hive tentacle count
    invoke<{ active_tentacles: number }>("hive_get_status")
      .then((s) => setTentacleCount(s.active_tentacles))
      .catch(() => {});

    // Listen for god mode updates
    const unlistenGod = listen<GodModeUpdate>("godmode_update", (e) => {
      setGodModeTier(e.payload.tier ?? "off");
    });

    // Listen for voice mode changes
    const unlistenVoice = listen<{ active: boolean }>("voice_mode_changed", (e) => {
      setVoiceActive(e.payload.active);
    });

    // Listen for hive tick — update active tentacle count
    const unlistenHive = listen<{ active_tentacles: number }>("hive_tick", (e) => {
      setTentacleCount(e.payload.active_tentacles);
    });

    return () => {
      unlistenGod.then((fn) => fn());
      unlistenVoice.then((fn) => fn());
      unlistenHive.then((fn) => fn());
    };
  }, []);

  const tierColor = (() => {
    switch (godModeTier) {
      case "extreme":      return "#ff453a";
      case "intermediate": return "#ff9f0a";
      case "normal":       return "#30d158";
      default:             return "rgba(142,142,147,0.5)";
    }
  })();

  const tierLabel = (() => {
    switch (godModeTier) {
      case "extreme":      return "Extreme";
      case "intermediate": return "Intermediate";
      case "normal":       return "Normal";
      default:             return "God Mode off";
    }
  })();

  return (
    <div
      className="h-7 shrink-0 flex items-center px-3 gap-0 select-none overflow-hidden"
      style={{
        background: "rgba(10,10,12,0.95)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        WebkitAppRegion: "no-drag",
      } as CSSProperties}
    >
      {/* Left: model + provider */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: providerShort ? "#5856D6" : "rgba(142,142,147,0.3)" }}
        />
        <span className="text-[11px] font-mono text-white/40 truncate">
          {providerShort && modelShort
            ? `${providerShort} / ${modelShort}`
            : providerShort
            ? providerShort
            : "No model"}
        </span>
      </div>

      {/* Center: God Mode */}
      <div className="flex items-center justify-center gap-1.5 shrink-0">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: tierColor,
            boxShadow: godModeTier !== "off" ? `0 0 4px ${tierColor}80` : "none",
          }}
        />
        <span
          className="text-[11px] font-medium"
          style={{ color: godModeTier !== "off" ? tierColor : "rgba(142,142,147,0.4)" }}
        >
          {tierLabel}
        </span>
      </div>

      {/* Right: streak + tentacles + voice */}
      <div className="flex items-center gap-3 flex-1 justify-end">
        {/* Streak */}
        {streakDays > 0 && (
          <div className="flex items-center gap-1">
            <svg viewBox="0 0 12 14" className="w-2.5 h-2.5 text-[#ff9f0a]" fill="currentColor">
              <path d="M6.5 0C5.3 3 3 4 3 7a3 3 0 006 0c0-1-.4-2-1-2.7.2.7.3 1.4.1 2-.4 1.2-1.8 1.7-1.8 1.7S7 6.5 6.5 0z" />
            </svg>
            <span className="text-[11px] font-mono text-white/40">{streakDays}d</span>
          </div>
        )}

        {/* Tentacles */}
        <div className="flex items-center gap-1">
          <svg viewBox="0 0 14 14" className="w-2.5 h-2.5 text-white/25" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M7 2l4 2v4L7 10l-4-2V4l4-2z" />
            <path d="M7 2v8M3 4l4 2 4-2" />
          </svg>
          <span className="text-[11px] font-mono text-white/40">{tentacleCount} active</span>
        </div>

        {/* Voice */}
        <div className="flex items-center gap-1">
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: voiceActive ? "#30d158" : "rgba(142,142,147,0.25)",
              boxShadow: voiceActive ? "0 0 4px rgba(48,209,88,0.5)" : "none",
            }}
          />
          <span className="text-[11px] font-mono text-white/30">
            {voiceActive ? "voice on" : "voice off"}
          </span>
        </div>
      </div>
    </div>
  );
}
