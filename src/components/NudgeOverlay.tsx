/**
 * NUDGE OVERLAY — When BLADE wants your attention, this glass card slides in
 * with contextual quick-action buttons. Auto-dismisses after 12 seconds.
 * Way more alive than a silent notification in a panel nobody opens.
 */

import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";


interface NudgeAction {
  label: string;
  icon: string;
  action: () => void;
}

interface ActiveNudge {
  message: string;
  type: string;
  raw?: string;
  actions: NudgeAction[];
}

function nudgeActions(
  type: string,
  message: string,
  raw: string | undefined,
  sendChat: (text: string) => void,
  navigate: (route: string) => void,
): NudgeAction[] {
  switch (type) {
    case "error_detected":
      return [
        {
          label: "Diagnose",
          icon: "🔍",
          action: () => sendChat(raw ? `Diagnose this error:\n\`\`\`\n${raw}\n\`\`\`` : "Diagnose the error I just copied"),
        },
        {
          label: "Ignore",
          icon: "🙈",
          action: () => {}, // just dismiss
        },
      ];
    case "duration":
      return [
        {
          label: "Take a break",
          icon: "☕",
          action: () => sendChat("I need a break. What was I working on? Give me a quick summary so I can pick up later."),
        },
        {
          label: "Keep going",
          icon: "💪",
          action: () => {}, // dismiss
        },
        {
          label: "Summarize",
          icon: "📋",
          action: () => sendChat("Summarize what I've been doing for the last hour"),
        },
      ];
    case "idle":
      return [
        {
          label: "Catch me up",
          icon: "📬",
          action: () => sendChat("What happened while I was away? Give me a full summary."),
        },
        {
          label: "What's next?",
          icon: "🎯",
          action: () => navigate("focus-page"),
        },
      ];
    case "long_session":
      return [
        {
          label: "Status update",
          icon: "📊",
          action: () => sendChat("Give me a status update on everything I've been working on today"),
        },
        {
          label: "Focus score",
          icon: "🎯",
          action: () => navigate("focus-page"),
        },
      ];
    case "stale_thread":
      return [
        {
          label: "Update thread",
          icon: "✏️",
          action: () => sendChat("Update my active thread based on what I've been doing"),
        },
        {
          label: "Archive it",
          icon: "📦",
          action: () => sendChat("Archive my current thread, it's done"),
        },
      ];
    default:
      return [
        {
          label: "Tell me more",
          icon: "💬",
          action: () => sendChat(message),
        },
      ];
  }
}

const nudgeTypeIcon: Record<string, string> = {
  error_detected: "🔴",
  duration: "⏱",
  idle: "👋",
  long_session: "🕐",
  stale_thread: "📝",
};

export function NudgeOverlay({
  onSendChat,
  onNavigate,
}: {
  onSendChat: (text: string) => void;
  onNavigate: (route: string) => void;
}) {
  const [nudge, setNudge] = useState<ActiveNudge | null>(null);
  const [exiting, setExiting] = useState(false);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setNudge(null);
      setExiting(false);
    }, 300);
  }, []);

  const handleAction = useCallback((action: () => void) => {
    action();
    dismiss();
  }, [dismiss]);

  useEffect(() => {
    const unlisten = listen<{ message: string; type: string; raw?: string; context?: string }>(
      "proactive_nudge",
      (event) => {
        const { message, type, raw } = event.payload;
        const actions = nudgeActions(type, message, raw, onSendChat, onNavigate);
        setNudge({ message, type, raw, actions });
        setExiting(false);

        // Auto-dismiss after 12 seconds
        setTimeout(() => {
          setExiting(true);
          setTimeout(() => {
            setNudge(null);
            setExiting(false);
          }, 300);
        }, 12000);
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, [onSendChat, onNavigate]);

  if (!nudge) return null;

  return (
    <div
      className={`fixed top-[50px] right-[16px] z-[9990] max-w-[380px] w-full pointer-events-auto ${
        exiting
          ? "animate-[blade-card-out_0.3s_ease-in_forwards]"
          : "animate-[blade-card-in_0.5s_cubic-bezier(0.22,1,0.36,1)_both]"
      }`}
    >
      <div
        className="rounded-2xl border border-[rgba(255,255,255,0.1)] overflow-hidden"
        style={{
          background: "rgba(12,12,18,0.94)",
          backdropFilter: "blur(32px) saturate(1.8)",
          WebkitBackdropFilter: "blur(32px) saturate(1.8)",
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05) inset, 0 0 40px rgba(129,140,248,0.08)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 pt-4 pb-2">
          <div className="w-[32px] h-[32px] rounded-xl bg-[rgba(129,140,248,0.12)] flex items-center justify-center flex-shrink-0">
            <span className="text-[15px]">{nudgeTypeIcon[nudge.type] || "💡"}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-white">BLADE</div>
            <div className="text-[9px] text-[rgba(255,255,255,0.3)] uppercase tracking-[0.1em] font-semibold">
              {nudge.type.replace(/_/g, " ")}
            </div>
          </div>
          <button
            onClick={dismiss}
            className="w-[24px] h-[24px] rounded-lg flex items-center justify-center text-[rgba(255,255,255,0.25)] hover:text-[rgba(255,255,255,0.6)] hover:bg-[rgba(255,255,255,0.06)] transition-all"
          >
            <svg viewBox="0 0 12 12" className="w-[8px] h-[8px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Message */}
        <div className="px-4 pb-3">
          <p className="text-[12px] text-[rgba(255,255,255,0.65)] leading-[1.6]">{nudge.message}</p>
        </div>

        {/* Action buttons */}
        <div className="px-3 pb-3 flex gap-2 flex-wrap">
          {nudge.actions.map((act, i) => (
            <button
              key={i}
              onClick={() => handleAction(act.action)}
              className={`flex items-center gap-[5px] px-3 py-[6px] rounded-xl text-[11px] font-semibold transition-all duration-150 ${
                i === 0
                  ? "bg-[rgba(129,140,248,0.18)] text-[#a5b4fc] border border-[rgba(129,140,248,0.3)] hover:bg-[rgba(129,140,248,0.28)]"
                  : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.1)]"
              }`}
            >
              <span className="text-[12px]">{act.icon}</span>
              {act.label}
            </button>
          ))}
        </div>

        {/* Progress bar */}
        <div className="h-[2px] bg-[rgba(255,255,255,0.04)]">
          <div
            className="h-full bg-[rgba(129,140,248,0.4)]"
            style={{ animation: "toast-progress 12s linear forwards" }}
          />
        </div>
      </div>
    </div>
  );
}
