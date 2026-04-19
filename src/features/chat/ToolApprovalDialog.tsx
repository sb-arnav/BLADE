// src/features/chat/ToolApprovalDialog.tsx — Tool approval modal with 500ms
// delay (D-71 / CHAT-04 / CHAT-07).
//
// Mounts whenever `useChatCtx().toolApprovalRequest` is non-null. The Dialog
// primitive wraps a native <dialog> so Esc close + focus trap + scrim are
// native browser behavior (D-01).
//
// 500ms delay (D-71 — user protection against click-through):
//   - Approve + Deny buttons render `disabled` for the first 500ms after the
//     request lands; a useEffect flips `unlocked` to true via setTimeout.
//   - Buttons carry data-countdown="on" during the lock; the CSS pseudo-
//     element ::after fills a transform-scaleX(1)→scaleX(0) bar over 500ms
//     (keyframe `countdownFill` in chat.css) for a visible countdown.
//   - Esc / dialog `onClose` fires denyTool(approvalId) — safer default on
//     accidental dismissal.
//
// Defensive field-name reconciliation (Plan 03-04 checker iter 3):
//   Rust's tool_approval_needed emit (src-tauri/src/commands.rs:1687-1696,
//   1710-1719) uses keys `approval_id` / `name` / `arguments`. The Phase 1
//   payloads.ts interface ToolApprovalNeededPayload still declares
//   `request_id` / `tool_name` / `args`. ChatProvider stores the raw
//   event.payload; this component reads BOTH key names defensively via a
//   cast-to-loose-shape so it works regardless of which declaration wins
//   when Phase 5 normalizes via Zod.
//
// @see src-tauri/src/commands.rs:1687 (emit site — keys: approval_id, name, arguments)
// @see src/lib/events/payloads.ts (ToolApprovalNeededPayload — TS declaration)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-71
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §4

import { useEffect, useState } from 'react';
import { Button, Dialog } from '@/design-system/primitives';
import { useChatCtx } from './useChat';

export function ToolApprovalDialog() {
  const { toolApprovalRequest, approveTool, denyTool } = useChatCtx();
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!toolApprovalRequest) {
      setUnlocked(false);
      return;
    }
    const t = setTimeout(() => setUnlocked(true), 500);
    return () => clearTimeout(t);
  }, [toolApprovalRequest]);

  if (!toolApprovalRequest) return null;

  // Defensive key reading — Rust truth is `approval_id` / `name` /
  // `arguments`; TS payload interface (Phase 1) declares
  // `request_id` / `tool_name` / `args`. We tolerate both shapes.
  const req = toolApprovalRequest as unknown as {
    approval_id?: string;
    request_id?: string;
    name?: string;
    tool_name?: string;
    arguments?: unknown;
    args?: unknown;
    context?: string;
    risk?: string;
  };
  const approvalId = req.approval_id ?? req.request_id ?? '';
  const toolName = req.tool_name ?? req.name ?? 'tool';
  const argsObj = req.args ?? req.arguments ?? {};
  const contextText = req.context;

  return (
    <Dialog
      open
      onClose={() => denyTool(approvalId)}
      ariaLabel={`Approve tool: ${toolName}`}
    >
      <div className="tool-approval">
        <h3 className="tool-approval-title">
          Approve tool: <code>{toolName}</code>
        </h3>
        <pre className="tool-approval-args">{safeStringify(argsObj)}</pre>
        {contextText ? (
          <p className="tool-approval-context">{contextText}</p>
        ) : null}
        <div className="tool-approval-actions">
          <Button
            variant="secondary"
            onClick={() => denyTool(approvalId)}
            disabled={!unlocked}
            data-countdown={unlocked ? 'off' : 'on'}
          >
            Deny
          </Button>
          <Button
            variant="primary"
            onClick={() => approveTool(approvalId)}
            disabled={!unlocked}
            data-countdown={unlocked ? 'off' : 'on'}
          >
            Approve
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
