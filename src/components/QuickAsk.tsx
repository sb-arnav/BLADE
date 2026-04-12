import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { Message } from "../types";

interface ActiveWindow { app_name: string; window_title: string; }

export function QuickAsk() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextApp, setContextApp] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const streamBuffer = useRef("");
  // Messages held in ref so Shift+Enter can hand them off without stale closure
  const messagesRef = useRef<Message[]>([]);

  // Auto-focus + capture context whenever the window becomes visible
  useEffect(() => {
    const win = getCurrentWindow();

    const unlisten = win.onFocusChanged(({ payload: focused }: { payload: boolean }) => {
      if (focused) {
        setTimeout(() => inputRef.current?.focus(), 30);
        // Capture what app was in focus before QuickAsk appeared
        invoke<ActiveWindow>("get_active_window").then((w) => {
          if (w.app_name && w.app_name !== "blade" && w.app_name !== "BLADE") {
            const label = w.window_title
              ? `${w.app_name} — ${w.window_title.slice(0, 40)}`
              : w.app_name;
            setContextApp(label);
          }
        }).catch(() => {});
      }
    });

    setTimeout(() => inputRef.current?.focus(), 50);

    return () => {
      unlisten.then((fn: () => void) => fn());
    };
  }, []);

  // Listen for global voice transcript — pre-fill input
  useEffect(() => {
    const unlisten = listen<{ text: string }>("voice_transcript_ready", (event) => {
      const text = event.payload.text.trim();
      if (text) {
        setQuery(text);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Listen to streaming tokens
  useEffect(() => {
    let active = true;

    const unlistenToken = listen<string>("chat_token", (event) => {
      if (!active) return;
      streamBuffer.current += event.payload;
      setResponse(streamBuffer.current);
    });

    const unlistenDone = listen("chat_done", () => {
      if (!active) return;
      setLoading(false);
    });

    return () => {
      active = false;
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, []);

  const resetState = useCallback(() => {
    setQuery("");
    setResponse("");
    setError(null);
    setLoading(false);
    setContextApp(null);
    streamBuffer.current = "";
    messagesRef.current = [];
  }, []);

  const hide = useCallback(async () => {
    resetState();
    await getCurrentWindow().hide();
  }, [resetState]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    };

    const assistantMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };

    const nextMessages: Message[] = [...messagesRef.current, userMsg, assistantMsg];
    messagesRef.current = nextMessages;

    streamBuffer.current = "";
    setResponse("");
    setError(null);
    setLoading(true);

    try {
      await invoke("send_message_stream", {
        messages: nextMessages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Something went wrong");
      setLoading(false);
    }
  }, [loading]);

  const openMain = useCallback(async () => {
    // Show the main window and bring it to focus
    const app = getCurrentWindow();
    // We can't directly get another window from within the webview using
    // getCurrentWindow, so we use the Tauri window label API instead
    try {
      // Emit a custom event the main window listens for (or just show it via invoke)
      // Since we can't invoke arbitrary window ops from frontend, use the
      // window plugin's WebviewWindow constructor to get the main window
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch {
      // If this fails, nothing critical breaks
    }
    // Hide quickask after opening main
    await app.hide();
    resetState();
  }, [resetState]);

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        await hide();
        return;
      }

      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        await openMain();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        await sendMessage(query);
        return;
      }
    },
    [hide, openMain, query, sendMessage]
  );

  const hasResponse = response.length > 0;

  return (
    <div
      className="flex flex-col w-full overflow-hidden"
      style={{
        background: "rgba(9,9,11,0.92)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        borderRadius: "14px",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04)",
        minHeight: "72px",
      }}
    >
      {/* Input row */}
      <div className="flex items-center gap-3 px-4" style={{ height: "72px", flexShrink: 0 }}>
        {/* Blade logo mark */}
        <div
          className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "rgba(99,102,241,0.2)" }}
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none">
            <path
              d="M8 2L14 8L8 14L2 8L8 2Z"
              fill="#6366f1"
              fillOpacity="0.9"
            />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Blade about your current work, screen, or next step..."
          disabled={loading}
          className="flex-1 bg-transparent outline-none text-blade-text placeholder:text-blade-muted"
          style={{
            fontSize: "0.9rem",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            letterSpacing: "-0.01em",
          }}
          autoComplete="off"
          spellCheck={false}
        />

        {/* State indicators */}
        {loading && (
          <div className="flex-shrink-0 flex items-center gap-1">
            <span
              className="inline-block w-1 h-1 rounded-full bg-blade-accent animate-pulse-slow"
              style={{ animationDelay: "0ms" }}
            />
            <span
              className="inline-block w-1 h-1 rounded-full bg-blade-accent animate-pulse-slow"
              style={{ animationDelay: "150ms" }}
            />
            <span
              className="inline-block w-1 h-1 rounded-full bg-blade-accent animate-pulse-slow"
              style={{ animationDelay: "300ms" }}
            />
          </div>
        )}

        {!loading && query.trim() && (
          <kbd
            className="flex-shrink-0 text-blade-muted/40"
            style={{ fontSize: "0.6rem", fontFamily: "monospace" }}
          >
            ↵
          </kbd>
        )}

        {!loading && !query.trim() && (
          <kbd
            className="flex-shrink-0 text-blade-muted/30"
            style={{ fontSize: "0.6rem", fontFamily: "monospace" }}
          >
            Esc
          </kbd>
        )}

        <button
          onClick={hide}
          className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-blade-muted/30 hover:text-blade-muted transition-colors"
          title="Close (Esc)"
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      {/* Context pill — shows what app BLADE can see */}
      {contextApp && !hasResponse && !loading && (
        <div
          style={{
            padding: "0 16px 8px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              padding: "3px 8px",
              borderRadius: "6px",
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.15)",
            }}
          >
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(99,102,241,0.7)", flexShrink: 0 }} />
            <span style={{ fontSize: "0.6rem", color: "rgba(99,102,241,0.8)", fontFamily: "Inter, sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "280px" }}>
              {contextApp}
            </span>
          </div>
        </div>
      )}

      {/* Divider + response area — only rendered when there's something to show */}
      {(hasResponse || error) && (
        <>
          <div
            style={{
              height: "1px",
              background: "rgba(255,255,255,0.05)",
              marginLeft: "16px",
              marginRight: "16px",
            }}
          />
          <div
            className="px-4 py-3 overflow-y-auto"
            style={{
              maxHeight: "320px",
              fontSize: "0.8125rem",
              lineHeight: "1.65",
              color: error ? "#f87171" : "#ececef",
              fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              letterSpacing: "-0.01em",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {error ? error : response}
            {loading && !error && (
              <span
                className="inline-block w-[2px] h-[0.85em] bg-blade-accent ml-0.5 align-middle typing-cursor"
              />
            )}
          </div>

          {/* Shift+Enter hint when response is showing */}
          {hasResponse && !loading && (
            <div
              className="px-4 pb-2 flex items-center gap-1.5"
              style={{ fontSize: "0.6rem", color: "rgba(82,82,91,0.6)" }}
            >
              <kbd style={{ fontFamily: "monospace" }}>Shift+Enter</kbd>
              <span>open in Blade</span>
              <span className="mx-1 opacity-40">·</span>
              <kbd style={{ fontFamily: "monospace" }}>Esc</kbd>
              <span>dismiss</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
