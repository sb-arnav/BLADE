import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import {
  cancelChat,
  onChatCancelled,
  onChatDone,
  onChatRouting,
  onChatToken,
  sendMessageStream,
} from "../lib/tauri";
import type { ChatRoutingPayload } from "../types/blade";

/**
 * QuickAsk — the Ctrl+Space overlay pill.
 *
 * Rust creates this window at 500×72, decorationless, always-on-top, transparent
 * (src-tauri/src/lib.rs:1275). This component paints its own chrome on top of
 * that transparent surface and resizes the window as the answer streams in.
 *
 * Flow:
 *   1. User types prompt → Enter → sendMessageStream
 *   2. chat_routing arrives → show provider·model meta line
 *   3. chat_token arrives → append to answer, expand window height
 *   4. chat_done → unlock input for next query
 *   5. Escape: cancel (if streaming) or hide (if idle)
 */

const COLLAPSED = { width: 500, height: 72 };
const EXPANDED_MIN_HEIGHT = 180;
const EXPANDED_MAX_HEIGHT = 520;

export function QuickAsk() {
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [routing, setRouting] = useState<ChatRoutingPayload | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  /* ── Event wiring — subscribe once, keep unlisteners for cleanup ────────── */
  useEffect(() => {
    let cancelled = false;
    const offs: Array<() => void> = [];

    (async () => {
      const [offToken, offDone, offCancelled, offRouting] = await Promise.all([
        onChatToken((t) => setAnswer((prev) => prev + t)),
        onChatDone(() => setStreaming(false)),
        onChatCancelled(() => setStreaming(false)),
        onChatRouting((r) => setRouting(r)),
      ]);
      if (cancelled) {
        offToken(); offDone(); offCancelled(); offRouting();
        return;
      }
      offs.push(offToken, offDone, offCancelled, offRouting);
    })();

    return () => {
      cancelled = true;
      offs.forEach((off) => off());
    };
  }, []);

  /* ── Focus input on mount; refocus when window shows ────────────────────── */
  useEffect(() => {
    inputRef.current?.focus();
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  /* ── Resize the Tauri window as the answer grows ────────────────────────── */
  useEffect(() => {
    const win = getCurrentWebviewWindow();
    if (!answer && !streaming && !error) {
      win.setSize(new LogicalSize(COLLAPSED.width, COLLAPSED.height)).catch(() => {});
      return;
    }
    // Measure rendered answer height, clamp to bounds
    const measured = answerRef.current?.scrollHeight ?? 0;
    const target = Math.min(
      Math.max(EXPANDED_MIN_HEIGHT, measured + 92 /* input + meta + padding */),
      EXPANDED_MAX_HEIGHT,
    );
    win.setSize(new LogicalSize(COLLAPSED.width, target)).catch(() => {});
  }, [answer, streaming, error]);

  /* ── Send / cancel / hide handlers ──────────────────────────────────────── */
  const submit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || streaming) return;

    setError(null);
    setAnswer("");
    setRouting(null);
    setStreaming(true);

    try {
      await sendMessageStream([{ role: "user", content: trimmed }]);
    } catch (e) {
      setStreaming(false);
      setError(typeof e === "string" ? e : String(e));
    }
  }, [prompt, streaming]);

  const cancelOrHide = useCallback(async () => {
    if (streaming) {
      try { await cancelChat(); } catch { /* ignore */ }
      return;
    }
    // Idle + empty → hide window. Idle + has answer → clear and reset.
    if (answer || error) {
      setAnswer("");
      setError(null);
      setRouting(null);
      setPrompt("");
      return;
    }
    try { await getCurrentWebviewWindow().hide(); } catch { /* ignore */ }
  }, [streaming, answer, error]);

  /* ── Keyboard ───────────────────────────────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelOrHide();
    }
  };

  return (
    <div
      data-surface="quickask"
      className="h-screen w-screen flex items-start justify-center select-none"
    >
      <div
        className={[
          "w-full mx-[10px] mt-[10px]",
          "bg-[rgba(28,28,30,0.86)] backdrop-blur-[32px] backdrop-saturate-[180%]",
          "border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-hud)]",
          "popover-shadow",
          "overflow-hidden",
        ].join(" ")}
      >
        {/* Input row — 52px ---------------------------------------------------- */}
        <div className="h-[52px] flex items-center px-4 gap-3">
          <BladeMark streaming={streaming} />
          <input
            ref={inputRef}
            className={[
              "flex-1 bg-transparent border-0 outline-none",
              "font-display text-[15px] leading-none text-label",
              "placeholder:text-label-tertiary",
              "caret-[var(--system-blue)]",
            ].join(" ")}
            placeholder="Ask Blade"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <KbdHint streaming={streaming} hasContent={!!prompt} />
        </div>

        {/* Answer surface — only rendered when there's something to show -------- */}
        {(answer || streaming || error) && (
          <>
            <Separator />
            {routing && <Meta routing={routing} />}
            <div
              ref={answerRef}
              className={[
                "px-4 py-3 font-sans text-[13px] leading-[1.55] text-label",
                "max-h-[460px] overflow-auto",
                "whitespace-pre-wrap break-words",
              ].join(" ")}
            >
              {error ? (
                <div className="font-mono text-[12px] text-[#FF6B6B]">{error}</div>
              ) : answer ? (
                answer
              ) : (
                <ThinkingLine />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Subcomponents ───────────────────────────────────────────────────────── */

function Separator() {
  return <div className="h-px bg-separator" />;
}

function Meta({ routing }: { routing: ChatRoutingPayload }) {
  return (
    <div className="px-4 py-2 flex items-center gap-3 text-[11px] font-mono text-label-tertiary uppercase tracking-wide border-b border-separator">
      <span>{routing.provider}</span>
      <span>·</span>
      <span className="normal-case tracking-normal">{routing.model}</span>
      {routing.hive_active && (
        <>
          <span>·</span>
          <span>hive</span>
        </>
      )}
    </div>
  );
}

function BladeMark({ streaming }: { streaming: boolean }) {
  // A single 8px dot. Idle = dim, streaming = accent + gentle pulse.
  // No sparkle, no gradient.
  return (
    <span
      aria-hidden
      className={[
        "inline-block h-2 w-2 rounded-full shrink-0",
        "transition-colors duration-[var(--dur-state)] ease-[var(--ease-state)]",
        streaming ? "bg-[var(--system-blue)]" : "bg-[var(--label-tertiary)]",
        streaming ? "animate-[pulse_1.4s_ease-in-out_infinite]" : "",
      ].join(" ")}
    />
  );
}

function KbdHint({ streaming, hasContent }: { streaming: boolean; hasContent: boolean }) {
  if (streaming) return <Kbd>esc</Kbd>;
  if (hasContent) return <Kbd>↵</Kbd>;
  return null;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[20px] h-[20px] px-1.5 rounded-[4px] bg-fill-4 border border-[rgba(255,255,255,0.08)] font-mono text-[10px] text-label-secondary">
      {children}
    </span>
  );
}

function ThinkingLine() {
  return (
    <div className="flex items-center gap-2 text-label-tertiary text-[12px] font-mono">
      <span className="h-1 w-1 rounded-full bg-label-tertiary animate-[pulse_1.2s_ease-in-out_infinite]" />
      <span>thinking</span>
    </div>
  );
}
