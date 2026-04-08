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

  // Try to parse arguments as JSON for display
  let argsDisplay: string;
  try {
    const parsed = JSON.parse(request.arguments);
    argsDisplay = JSON.stringify(parsed, null, 2);
  } catch {
    argsDisplay = request.arguments;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60" />
      <div className="relative w-full max-w-md bg-blade-surface border border-amber-900/50 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-blade-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-sm font-medium text-blade-text">Tool wants to run</span>
          </div>
          <span className="text-xs text-blade-muted font-mono">{secondsLeft}s</span>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-blade-muted mb-1">Tool</p>
            <p className="text-sm font-mono text-blade-text">{request.name}</p>
          </div>

          {argsDisplay && argsDisplay !== "{}" && (
            <div>
              <p className="text-xs uppercase tracking-wide text-blade-muted mb-1">Arguments</p>
              <pre className="text-xs text-blade-muted bg-blade-bg rounded-lg p-2.5 overflow-x-auto max-h-40 border border-blade-border">
                {argsDisplay}
              </pre>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-blade-border flex items-center gap-2">
          <button
            onClick={() => onRespond(false)}
            className="flex-1 px-4 py-2.5 text-sm rounded-xl border border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-muted transition-colors"
          >
            Deny
          </button>
          <button
            onClick={() => onRespond(true)}
            className="flex-1 px-4 py-2.5 text-sm rounded-xl bg-blade-accent text-white font-medium hover:opacity-90 transition-opacity"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
