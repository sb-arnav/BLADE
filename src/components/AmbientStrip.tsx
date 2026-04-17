/**
 * AMBIENT STRIP — persistent bottom bar showing BLADE's live internal state.
 * Always visible. Breathing dot = alive. Shows what BLADE sees, hears, and is doing.
 * Click to expand into a mini activity feed.
 */

import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

interface PerceptionSnapshot {
  active_app: string;
  active_title: string;
  user_state: string;
  context_tags: string[];
  clipboard_type: string;
}

interface ActivityItem {
  text: string;
  time: number;
  type: "see" | "hear" | "think" | "act" | "speak";
}

export function AmbientStrip() {
  const [perception, setPerception] = useState<PerceptionSnapshot | null>(null);
  const [bladeStatus, setBladeStatus] = useState<string>("idle");
  const [lastAction, setLastAction] = useState<string>("");
  const [audioActive, setAudioActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const feedRef = useRef(feed);
  feedRef.current = feed;

  const addActivity = (text: string, type: ActivityItem["type"]) => {
    const item: ActivityItem = { text, time: Date.now(), type };
    const next = [item, ...feedRef.current].slice(0, 20);
    setFeed(next);
  };

  // Poll perception state
  useEffect(() => {
    const load = () => invoke<PerceptionSnapshot>("perception_get_latest").then(setPerception).catch(() => null);
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  // Listen for live events
  useEffect(() => {
    const unsubs = [
      listen<string>("blade_status", (ev) => {
        setBladeStatus(ev.payload as string);
      }),
      listen<{ message: string }>("proactive_nudge", (ev) => {
        setLastAction(ev.payload.message);
        addActivity(ev.payload.message, "think");
      }),
      listen<{ summary: string }>("blade_catchup", (ev) => {
        addActivity("Welcome back — " + ev.payload.summary.slice(0, 80), "speak");
      }),
      listen<{ active: boolean }>("audio_capture_state", (ev) => {
        setAudioActive(ev.payload.active);
      }),
      listen<{ title: string }>("proactive_card", (ev) => {
        addActivity(ev.payload.title, "see");
      }),
      listen<{ text: string }>("voice_transcription", (ev) => {
        addActivity("Heard: " + ev.payload.text.slice(0, 60), "hear");
      }),
      listen("auto_show_displayed", (ev) => {
        const payload = ev.payload as { trigger?: string };
        addActivity("Showing: " + (payload?.trigger || "content"), "act");
      }),
      // BLADE's internal activity — makes it feel alive
      listen<{ prediction: string }>("blade_suggestion", (ev) => {
        addActivity("Suggestion: " + (ev.payload.prediction || "").slice(0, 60), "think");
      }),
      listen("blade_reflex", () => {
        addActivity("Autonomous reflex fired", "act");
      }),
      listen<string>("blade_planning", () => {
        addActivity("Deep reasoning in progress…", "think");
      }),
      listen("blade_evolving", () => {
        addActivity("Searching for new capabilities", "think");
      }),
      listen<{ step: string }>("computer_use_step", (ev) => {
        const payload = ev.payload as { step?: string; action?: string };
        addActivity("Desktop: " + (payload?.step || payload?.action || "acting"), "act");
      }),
      listen<{ title: string }>("os_notification", (ev) => {
        const payload = ev.payload as { title?: string; app?: string };
        addActivity("Notification: " + (payload?.title || payload?.app || "system"), "see");
      }),
      listen("smart_interrupt", () => {
        addActivity("Interrupting — something needs attention", "act");
      }),
      listen<string>("blade_routing_switched", () => {
        addActivity("Switched to backup AI provider", "think");
      }),
    ];

    return () => { unsubs.forEach((p) => p.then((fn) => fn())); };
  }, []);

  // Derive display text
  const seeText = perception
    ? perception.active_app
      ? `${perception.active_app}${perception.active_title ? " — " + perception.active_title.slice(0, 40) : ""}`
      : "nothing active"
    : "connecting…";

  const stateColor = {
    idle: "#4ade80",
    processing: "#818cf8",
    thinking: "#60a5fa",
    error: "#f87171",
  }[bladeStatus] || "#4ade80";

  const stateLabel = bladeStatus === "idle" ? "watching" : bladeStatus;

  const typeIcon = (t: ActivityItem["type"]) => {
    switch (t) {
      case "see": return "👁";
      case "hear": return "👂";
      case "think": return "💭";
      case "act": return "⚡";
      case "speak": return "🗣";
    }
  };

  return (
    <div className="fixed bottom-0 left-[62px] right-0 z-[180] pointer-events-auto">
      {/* Expanded feed */}
      {expanded && (
        <div
          className="mx-3 mb-1 rounded-xl border border-[rgba(255,255,255,0.08)] max-h-[200px] overflow-y-auto"
          style={{
            background: "rgba(8,8,14,0.92)",
            backdropFilter: "blur(32px) saturate(1.6)",
            WebkitBackdropFilter: "blur(32px) saturate(1.6)",
          }}
        >
          {feed.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-[rgba(255,255,255,0.25)] italic">
              No activity yet — BLADE is watching and listening
            </div>
          ) : (
            <div className="p-2 flex flex-col gap-[2px]">
              {feed.map((item, i) => (
                <div key={i} className="flex items-center gap-2 py-[3px] px-2 rounded-lg hover:bg-[rgba(255,255,255,0.04)]">
                  <span className="text-[10px] w-[16px] flex-shrink-0 text-center">{typeIcon(item.type)}</span>
                  <span className="text-[11px] text-[rgba(255,255,255,0.55)] flex-1 truncate">{item.text}</span>
                  <span className="text-[9px] text-[rgba(255,255,255,0.2)] flex-shrink-0 tabular-nums">
                    {new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Strip bar */}
      <div
        className="flex items-center gap-3 px-4 py-[5px] cursor-pointer select-none border-t border-[rgba(255,255,255,0.06)]"
        style={{
          background: "rgba(8,8,14,0.75)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Breathing dot */}
        <span
          className="w-[6px] h-[6px] rounded-full flex-shrink-0"
          style={{
            background: stateColor,
            boxShadow: `0 0 6px ${stateColor}`,
            animation: bladeStatus === "idle"
              ? "blade-pulse 3s ease-in-out infinite"
              : bladeStatus === "processing" || bladeStatus === "thinking"
                ? "blade-pulse 1s ease-in-out infinite"
                : undefined,
          }}
        />

        {/* State */}
        <span className="text-[10px] font-semibold tracking-[0.08em] uppercase flex-shrink-0" style={{ color: stateColor }}>
          {stateLabel}
        </span>

        {/* Divider */}
        <span className="w-px h-[10px] bg-[rgba(255,255,255,0.08)] flex-shrink-0" />

        {/* What BLADE sees */}
        <span className="text-[10px] text-[rgba(255,255,255,0.35)] flex-shrink-0">👁</span>
        <span className="text-[10px] text-[rgba(255,255,255,0.45)] truncate max-w-[200px]">{seeText}</span>

        {/* Audio indicator */}
        {audioActive && (
          <>
            <span className="w-px h-[10px] bg-[rgba(255,255,255,0.08)] flex-shrink-0" />
            <span className="text-[10px] text-[rgba(255,255,255,0.35)] flex-shrink-0">👂</span>
            <span className="text-[10px] text-[#4ade80]">listening</span>
          </>
        )}

        {/* Last action (if any) */}
        {lastAction && (
          <>
            <span className="w-px h-[10px] bg-[rgba(255,255,255,0.08)] flex-shrink-0" />
            <span className="text-[10px] text-[rgba(255,255,255,0.35)] flex-shrink-0">💭</span>
            <span className="text-[10px] text-[rgba(255,255,255,0.4)] truncate max-w-[250px]">{lastAction}</span>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Context tags */}
        {perception?.context_tags?.slice(0, 3).map((tag) => (
          <span key={tag} className="text-[9px] px-[6px] py-[1px] rounded-full bg-[rgba(129,140,248,0.1)] text-[rgba(129,140,248,0.6)] border border-[rgba(129,140,248,0.15)]">
            {tag}
          </span>
        ))}

        {/* Expand indicator */}
        <svg
          viewBox="0 0 10 6"
          className="w-[8px] h-[5px] text-[rgba(255,255,255,0.2)] transition-transform duration-200 flex-shrink-0"
          style={{ transform: expanded ? "rotate(180deg)" : undefined }}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </div>
    </div>
  );
}
