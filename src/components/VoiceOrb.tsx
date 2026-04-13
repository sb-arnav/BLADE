/**
 * VoiceOrb — floating visual feedback for voice mode.
 * Shows in corner when always-on mode is active.
 */
import type { VoiceStatus } from "../hooks/useVoiceMode";

interface Props {
  status: VoiceStatus;
  mode: string;
}

const STATUS_CONFIG: Record<VoiceStatus, { color: string; label: string; hint?: string; pulse: boolean }> = {
  idle:       { color: "bg-blade-muted/30",       label: "Voice off",                         pulse: false },
  listening:  { color: "bg-blue-500/40",           label: "Listening...",                      pulse: true  },
  detecting:  { color: "bg-blue-400",              label: "Hearing you...",                    pulse: true  },
  recording:  { color: "bg-red-500",               label: "Recording",                         pulse: true  },
  processing: { color: "bg-amber-400",             label: "Thinking...",                       pulse: true  },
  error:      { color: "bg-red-500/60",            label: "Mic error", hint: "Check mic settings", pulse: false },
};

interface Props {
  status: VoiceStatus;
  mode: string;
  onDismissError?: () => void;
}

export function VoiceOrb({ status, mode, onDismissError }: Props) {
  if (mode === "off" || mode === "push-to-talk" || status === "idle") return null;

  const cfg = STATUS_CONFIG[status];
  const isError = status === "error";

  return (
    <div
      className={`fixed bottom-20 right-4 z-50 flex items-center gap-2 select-none ${isError ? "cursor-pointer" : "pointer-events-none"}`}
      onClick={isError ? onDismissError : undefined}
      title={isError ? "Click to dismiss" : undefined}
    >
      <div className="flex flex-col items-end">
        <span className="text-2xs text-blade-muted/60 bg-blade-surface border border-blade-border rounded-full px-2 py-0.5">
          {cfg.label}
        </span>
        {cfg.hint && (
          <span className="text-[9px] text-blade-muted/40 mt-0.5 pr-0.5">{cfg.hint}</span>
        )}
      </div>
      <div className="relative w-3 h-3">
        <div className={`w-3 h-3 rounded-full ${cfg.color}`} />
        {cfg.pulse && (
          <div className={`absolute inset-0 rounded-full ${cfg.color} animate-ping opacity-60`} />
        )}
      </div>
    </div>
  );
}
