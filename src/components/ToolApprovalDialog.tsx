import { useEffect, useRef, useState } from "react";
import { ToolApprovalRequest } from "../types";

interface Props {
  request: ToolApprovalRequest;
  onRespond: (approved: boolean) => void;
}

const RISK_STYLES: Record<string, { border: string; dot: string; label: string; bg: string }> = {
  Auto: { border: "border-emerald-500/20", dot: "bg-emerald-400", label: "Low risk", bg: "bg-emerald-500/5" },
  Ask:  { border: "border-amber-500/30",   dot: "bg-amber-400",   label: "Review needed", bg: "bg-amber-500/5" },
  Blocked: { border: "border-red-500/30",  dot: "bg-red-500",     label: "High risk",     bg: "bg-red-500/5" },
};

// Known safe patterns — shown as reassurance
const SAFE_PATTERNS = [
  { re: /read_file|list_dir|find_symbol|search_web|web_fetch/i, msg: "Read-only operation" },
  { re: /bash/i,  msg: "Shell command — review args below" },
  { re: /write_file|edit_file/i, msg: "Modifies files on disk" },
  { re: /open_url|click|type_text/i, msg: "UI interaction" },
];

function riskNote(toolName: string): string {
  for (const p of SAFE_PATTERNS) {
    if (p.re.test(toolName)) return p.msg;
  }
  return "";
}

export function ToolApprovalDialog({ request, onRespond }: Props) {
  const TIMEOUT = 60;
  const [secondsLeft, setSecondsLeft] = useState(TIMEOUT);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSecondsLeft(TIMEOUT);
    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          onRespond(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current!);
  }, [request.approval_id, onRespond]);

  let argsDisplay: string;
  try {
    const parsed = JSON.parse(request.arguments);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {
    argsDisplay = request.arguments;
  }

  const riskKey = (request.risk as string) in RISK_STYLES ? (request.risk as string) : "Ask";
  const risk = RISK_STYLES[riskKey];
  const note = riskNote(request.name);
  const progress = (secondsLeft / TIMEOUT) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center pb-4 sm:pb-0">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => onRespond(false)} />

      <div className={`relative w-full max-w-sm mx-4 rounded-2xl shadow-2xl overflow-hidden animate-fade-in border ${risk.border} ${risk.bg}`}>
        {/* Timer progress bar */}
        <div className="h-0.5 bg-blade-border/30">
          <div
            className="h-full bg-amber-400/60 transition-all duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${risk.dot} animate-pulse`} />
            <span className="text-xs font-semibold text-blade-text">BLADE wants permission</span>
          </div>
          <span className="text-2xs text-blade-muted font-mono tabular-nums">{secondsLeft}s</span>
        </div>

        {/* Tool */}
        <div className="px-4 pb-3 space-y-2.5">
          <div className="flex items-start gap-2">
            <span className="text-2xs text-blade-muted mt-0.5 shrink-0">Tool</span>
            <div className="min-w-0">
              <p className="text-xs font-mono text-blade-text font-medium">{request.name}</p>
              {note && <p className="text-2xs text-blade-muted/70 mt-0.5">{note}</p>}
            </div>
          </div>

          {argsDisplay && argsDisplay !== "{}" && (
            <div>
              <p className="text-2xs text-blade-muted mb-1">Arguments</p>
              <pre className="text-2xs text-blade-secondary bg-blade-bg/80 rounded-lg px-3 py-2 overflow-x-auto max-h-28 border border-blade-border/50 font-mono leading-relaxed">
                {argsDisplay}
              </pre>
            </div>
          )}

          <p className="text-2xs text-blade-muted/60">{risk.label} · auto-denied in {secondsLeft}s</p>
        </div>

        {/* Actions */}
        <div className="flex border-t border-blade-border/50">
          <button
            onClick={() => onRespond(false)}
            className="flex-1 py-3 text-xs text-blade-secondary hover:text-blade-text hover:bg-red-500/5 transition-colors border-r border-blade-border/50"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(true)}
            className="flex-1 py-3 text-xs text-emerald-400 font-medium hover:bg-emerald-500/8 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
