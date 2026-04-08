import { useEffect, useState } from "react";
import { ToolApprovalRequest } from "../types";

interface Props {
  request: ToolApprovalRequest;
  onRespond: (approved: boolean) => void;
}

export function ToolApprovalDialog({ request, onRespond }: Props) {
  const [secondsLeft, setSecondsLeft] = useState(60);

  useEffect(() => {
    setSecondsLeft(60);
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          onRespond(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [request.approval_id, onRespond]);

  let argsDisplay: string;
  try {
    const parsed = JSON.parse(request.arguments);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {
    argsDisplay = request.arguments;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" />
      <div className="relative w-full max-w-sm bg-blade-surface border border-amber-500/20 rounded-xl shadow-2xl overflow-hidden animate-fade-in">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-slow" />
            <span className="text-xs font-medium text-blade-text">Tool approval</span>
          </div>
          <span className="text-2xs text-blade-muted font-mono tabular-nums">{secondsLeft}s</span>
        </div>

        <div className="px-4 pb-3 space-y-3">
          <div>
            <p className="text-2xs text-blade-muted mb-1">Tool</p>
            <p className="text-xs font-mono text-blade-text">{request.name}</p>
          </div>

          {argsDisplay && argsDisplay !== "{}" && (
            <div>
              <p className="text-2xs text-blade-muted mb-1">Arguments</p>
              <pre className="text-2xs text-blade-secondary bg-blade-bg rounded-lg p-2.5 overflow-x-auto max-h-32 border border-blade-border font-mono">
                {argsDisplay}
              </pre>
            </div>
          )}
        </div>

        <div className="flex border-t border-blade-border">
          <button
            onClick={() => onRespond(false)}
            className="flex-1 py-2.5 text-xs text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover transition-colors border-r border-blade-border"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(true)}
            className="flex-1 py-2.5 text-xs text-blade-accent font-medium hover:bg-blade-accent-muted transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
