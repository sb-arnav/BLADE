/// BLADE QuickAsk — Alt+Space popup with contextual suggestions, command history,
/// inline results, and slash command support.
///
/// Slash commands:
///   /screenshot  — capture screen + analyze
///   /voice       — start voice input
///   /lock        — lock screen
///   /break       — take a break reminder
///
/// Contextual suggestions are derived from:
///   - clipboard content
///   - active app
///   - time of day
///
/// Recent command history (last 5) shown below suggestions.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Message } from "../types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ActiveWindow { app_name: string; window_title: string; }

interface Suggestion {
  text: string;
  label: string;
  icon: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HISTORY_KEY = "blade_quickask_history_v1";
const HISTORY_MAX = 5;

const SLASH_COMMANDS = [
  { cmd: "/screenshot", desc: "Capture + analyze screen", icon: "📸" },
  { cmd: "/voice",      desc: "Start voice input",        icon: "🎙️" },
  { cmd: "/lock",       desc: "Lock screen",               icon: "🔒" },
  { cmd: "/break",      desc: "Take a break reminder",     icon: "☕" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {}
}

function addToHistory(cmd: string, history: string[]): string[] {
  const trimmed = cmd.trim();
  if (!trimmed || trimmed.startsWith("/")) return history; // don't persist slash cmds
  const deduped = history.filter((h) => h !== trimmed);
  return [trimmed, ...deduped].slice(0, HISTORY_MAX);
}

function getTimeBasedLabel(): string {
  const h = new Date().getHours();
  if (h < 6) return "late night";
  if (h < 12) return "morning";
  if (h < 14) return "midday";
  if (h < 18) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

function buildSuggestions(
  clipboard: string,
  activeApp: string,
  _timeLabel: string
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Clipboard-based
  if (clipboard.length > 10) {
    const lower = clipboard.toLowerCase();
    if (lower.includes("error") || lower.includes("exception") || lower.includes("traceback")) {
      suggestions.push({ text: "Help me fix this error: " + clipboard.slice(0, 60), label: "Fix error in clipboard", icon: "🐛" });
    } else if (clipboard.startsWith("http://") || clipboard.startsWith("https://")) {
      suggestions.push({ text: "Summarize this URL: " + clipboard.slice(0, 80), label: "Summarize URL", icon: "🔗" });
    } else if (clipboard.length > 20 && clipboard.length < 500) {
      suggestions.push({ text: "Improve this text: " + clipboard.slice(0, 60), label: "Improve clipboard text", icon: "✏️" });
    }
  }

  // Active app context
  const app = activeApp.toLowerCase();
  if (app.includes("code") || app.includes("vim") || app.includes("nvim") || app.includes("cursor")) {
    suggestions.push({ text: "Explain the code I'm looking at", label: "Explain current code", icon: "💻" });
  } else if (app.includes("chrome") || app.includes("firefox") || app.includes("edge") || app.includes("safari")) {
    suggestions.push({ text: "Summarize what I'm reading", label: "Summarize current page", icon: "📄" });
  } else if (app.includes("slack") || app.includes("discord") || app.includes("teams")) {
    suggestions.push({ text: "Help me write a reply to this message", label: "Draft a reply", icon: "💬" });
  } else if (app.includes("figma") || app.includes("sketch") || app.includes("xd")) {
    suggestions.push({ text: "Review my design for usability", label: "Design review", icon: "🎨" });
  } else if (app.includes("terminal") || app.includes("powershell") || app.includes("cmd")) {
    suggestions.push({ text: "What does this command do?", label: "Explain command", icon: "⚡" });
  }

  // Time-based
  const hour = new Date().getHours();
  if (hour >= 8 && hour < 10) {
    suggestions.push({ text: "What should I focus on today?", label: "Morning focus", icon: "🌅" });
  } else if (hour >= 17 && hour < 19) {
    suggestions.push({ text: "Summarize what I accomplished today", label: "End-of-day review", icon: "📊" });
  } else if (hour >= 22 || hour < 2) {
    suggestions.push({ text: "Give me a brain dump summary for tomorrow", label: "Late night wrap-up", icon: "🌙" });
  }

  return suggestions.slice(0, 3);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuickAsk() {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextApp, setContextApp] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(-1); // keyboard nav

  const inputRef = useRef<HTMLInputElement>(null);
  const streamBuffer = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const clipboardRef = useRef("");

  // ── Context capture on focus ──────────────────────────────────────────────

  useEffect(() => {
    const win = getCurrentWindow();

    const unlisten = win.onFocusChanged(({ payload: focused }: { payload: boolean }) => {
      if (focused) {
        setTimeout(() => inputRef.current?.focus(), 30);
        setShowSuggestions(true);
        setSelectedIdx(-1);

        // Active app
        invoke<ActiveWindow>("get_active_window").then((w) => {
          if (w.app_name && w.app_name.toLowerCase() !== "blade") {
            setContextApp(w.app_name);
            // Rebuild suggestions with latest context
            buildContextSuggestions(w.app_name);
          }
        }).catch(() => {});

        // Clipboard
        invoke<string>("get_clipboard").then((text) => {
          clipboardRef.current = text ?? "";
          buildContextSuggestions(contextApp ?? "");
        }).catch(() => {});
      }
    });

    setTimeout(() => inputRef.current?.focus(), 50);
    // Initial suggestion build
    buildContextSuggestions("");

    return () => { unlisten.then((fn: () => void) => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildContextSuggestions(app: string) {
    const timeLabel = getTimeBasedLabel();
    setSuggestions(buildSuggestions(clipboardRef.current, app, timeLabel));
  }

  // ── Voice transcript pre-fill ─────────────────────────────────────────────

  useEffect(() => {
    const unlisten = listen<{ text: string }>("voice_transcript_ready", (event) => {
      const text = event.payload.text.trim();
      if (text) {
        setQuery(text);
        setShowSuggestions(false);
        setTimeout(() => inputRef.current?.focus(), 30);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Streaming ─────────────────────────────────────────────────────────────

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

  // ── Slash command handling ────────────────────────────────────────────────

  const handleSlashCommand = useCallback(async (cmd: string) => {
    switch (cmd) {
      case "/screenshot": {
        setLoading(true);
        setResponse("");
        setError(null);
        streamBuffer.current = "";
        try {
          const base64 = await invoke<string>("capture_screen");
          await invoke("send_message_stream", {
            messages: [
              { role: "user", content: `[Screenshot attached — please analyze what's on screen and provide a brief summary.]\n[image: ${base64.slice(0, 50)}...]` },
              { role: "assistant", content: "" },
            ],
          });
        } catch (e) {
          setError(typeof e === "string" ? e : "Screenshot failed");
          setLoading(false);
        }
        break;
      }
      case "/voice": {
        try {
          await invoke("voice_start_recording");
          setQuery("");
          setResponse("Listening… press Ctrl+Space again to stop.");
        } catch (e) {
          setError(typeof e === "string" ? e : "Voice start failed");
        }
        break;
      }
      case "/lock": {
        try {
          await invoke("lock_screen");
          await getCurrentWindow().hide();
        } catch (e) {
          setError(typeof e === "string" ? e : "Lock failed");
        }
        break;
      }
      case "/break": {
        try {
          await invoke("overlay_show_notification", {
            title: "Time for a break",
            body: "Step away from the screen for 5 minutes. You deserve it.",
            durationMs: 8000,
            level: "info",
          });
          await getCurrentWindow().hide();
        } catch (e) {
          setError(typeof e === "string" ? e : "Break reminder failed");
        }
        break;
      }
      default:
        setError(`Unknown command: ${cmd}`);
    }
  }, []);

  // ── Message send ──────────────────────────────────────────────────────────

  const resetState = useCallback(() => {
    setQuery("");
    setResponse("");
    setError(null);
    setLoading(false);
    setContextApp(null);
    setShowSuggestions(true);
    setSelectedIdx(-1);
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

    setShowSuggestions(false);

    // Slash command
    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(" ")[0].toLowerCase();
      setQuery("");
      await handleSlashCommand(cmd);
      return;
    }

    // Save to history
    const newHistory = addToHistory(trimmed, history);
    setHistory(newHistory);
    saveHistory(newHistory);

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
    setQuery("");

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
  }, [loading, history, handleSlashCommand]);

  const openMain = useCallback(async () => {
    try {
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.setFocus();
      }
    } catch {
      invoke("open_main_window").catch(() => {});
    }
    await getCurrentWindow().hide();
    resetState();
  }, [resetState]);

  // ── Keyboard nav ─────────────────────────────────────────────────────────

  // All selectable items: slash commands (if /), suggestions, history
  const allSuggestions: Array<{ text: string; label?: string; isHistory?: boolean; isSlash?: boolean; icon?: string }> =
    query.startsWith("/")
      ? SLASH_COMMANDS
          .filter((s) => s.cmd.startsWith(query.toLowerCase()))
          .map((s) => ({ text: s.cmd, label: s.desc, isSlash: true, icon: s.icon }))
      : query.trim()
      ? []  // don't show suggestions while typing a real query
      : [
          ...suggestions.map((s) => ({ text: s.text, label: s.label, icon: s.icon })),
          ...history.map((h) => ({ text: h, isHistory: true, icon: "🕐" })),
        ];

  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (response || error) {
          resetState();
        } else {
          await hide();
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, allSuggestions.length - 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, -1));
        return;
      }

      if (e.key === "Tab" && allSuggestions.length > 0) {
        e.preventDefault();
        const idx = selectedIdx >= 0 ? selectedIdx : 0;
        const item = allSuggestions[idx];
        if (item) {
          setQuery(item.text);
          setSelectedIdx(-1);
        }
        return;
      }

      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        await openMain();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // If an item is selected in keyboard nav, use it
        if (selectedIdx >= 0 && allSuggestions[selectedIdx]) {
          await sendMessage(allSuggestions[selectedIdx].text);
          setSelectedIdx(-1);
        } else {
          await sendMessage(query);
        }
        return;
      }
    },
    [hide, openMain, query, sendMessage, allSuggestions, selectedIdx, response, error, resetState]
  );

  // ── Styles ────────────────────────────────────────────────────────────────

  const hasResponse = response.length > 0;
  const showSuggestionList = showSuggestions && !loading && !hasResponse && !error && allSuggestions.length > 0;
  const isSlashMode = query.startsWith("/");

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="flex flex-col w-full overflow-hidden"
      style={{
        background: "rgba(9,9,11,0.93)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        borderRadius: "14px",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 32px 64px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04)",
        minHeight: "72px",
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {/* Input row */}
      <div className="flex items-center gap-3 px-4" style={{ height: "72px", flexShrink: 0 }}>
        {/* BLADE logo */}
        <div
          className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
          style={{ background: "rgba(99,102,241,0.2)" }}
        >
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none">
            <path d="M8 2L14 8L8 14L2 8L8 2Z" fill="#6366f1" fillOpacity="0.9" />
          </svg>
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            setSelectedIdx(-1);
          }}
          onKeyDown={handleKeyDown}
          placeholder={
            isSlashMode
              ? "Type a command…"
              : "Ask Blade, or type / for commands…"
          }
          disabled={loading}
          className="flex-1 bg-transparent outline-none text-blade-text placeholder:text-blade-muted"
          style={{
            fontSize: "0.9rem",
            fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            letterSpacing: "-0.01em",
            color: isSlashMode ? "#a5b4fc" : undefined,
          }}
          autoComplete="off"
          spellCheck={false}
        />

        {/* Loading dots */}
        {loading && (
          <div className="flex-shrink-0 flex items-center gap-1">
            {[0, 150, 300].map((delay) => (
              <span
                key={delay}
                className="inline-block w-1 h-1 rounded-full bg-blade-accent animate-pulse-slow"
                style={{ animationDelay: `${delay}ms` }}
              />
            ))}
          </div>
        )}

        {/* Enter hint */}
        {!loading && query.trim() && (
          <kbd className="flex-shrink-0 text-blade-muted/40" style={{ fontSize: "0.6rem", fontFamily: "monospace" }}>
            ↵
          </kbd>
        )}

        {/* Esc hint */}
        {!loading && !query.trim() && (
          <kbd className="flex-shrink-0 text-blade-muted/30" style={{ fontSize: "0.6rem", fontFamily: "monospace" }}>
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

      {/* Context pill */}
      {contextApp && !hasResponse && !loading && !showSuggestionList && (
        <div style={{ padding: "0 16px 8px", display: "flex", alignItems: "center", gap: "6px" }}>
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
            <span style={{
              fontSize: "0.6rem",
              color: "rgba(99,102,241,0.8)",
              fontFamily: "Inter, sans-serif",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "280px",
            }}>
              {contextApp}
            </span>
          </div>
        </div>
      )}

      {/* Suggestions / history / slash commands panel */}
      {showSuggestionList && (
        <>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />
          <div style={{ padding: "6px 8px 6px" }}>
            {/* Section label */}
            <div style={{ padding: "2px 8px 4px", fontSize: "9px", fontWeight: 600, letterSpacing: "0.06em", color: "rgba(255,255,255,0.2)", textTransform: "uppercase" }}>
              {isSlashMode ? "Commands" : "Suggestions"}
            </div>

            {allSuggestions.map((item, i) => (
              <div
                key={i}
                onClick={() => sendMessage(item.text)}
                onMouseEnter={() => setSelectedIdx(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  background: selectedIdx === i ? "rgba(99,102,241,0.12)" : "transparent",
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
              >
                <span style={{ fontSize: "13px", flexShrink: 0 }}>{item.icon}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: "11px",
                    color: item.isHistory ? "rgba(255,255,255,0.45)" : item.isSlash ? "#a5b4fc" : "rgba(255,255,255,0.75)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {item.isSlash ? (item as { text: string }).text : item.label ?? item.text}
                  </div>
                  {item.isSlash && item.label && (
                    <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.25)", marginTop: "1px" }}>
                      {item.label}
                    </div>
                  )}
                  {!item.isSlash && item.label && item.text !== item.label && (
                    <div style={{
                      fontSize: "9px",
                      color: "rgba(255,255,255,0.22)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      marginTop: "1px",
                    }}>
                      {item.text.length > 55 ? item.text.slice(0, 55) + "…" : item.text}
                    </div>
                  )}
                </div>
                {selectedIdx === i && (
                  <kbd style={{ marginLeft: "auto", fontSize: "9px", color: "rgba(255,255,255,0.2)", fontFamily: "monospace", flexShrink: 0 }}>↵</kbd>
                )}
              </div>
            ))}

            {/* Keyboard hint */}
            <div style={{ padding: "4px 8px 2px", fontSize: "9px", color: "rgba(255,255,255,0.15)", display: "flex", gap: "8px" }}>
              <span>↑↓ navigate</span>
              <span>Tab complete</span>
              <span>Enter select</span>
            </div>
          </div>
        </>
      )}

      {/* Response / error area */}
      {(hasResponse || error) && (
        <>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.05)", margin: "0 16px" }} />
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
              <span className="inline-block w-[2px] h-[0.85em] bg-blade-accent ml-0.5 align-middle typing-cursor" />
            )}
          </div>

          {hasResponse && !loading && (
            <div className="px-4 pb-2 flex items-center gap-1.5" style={{ fontSize: "0.6rem", color: "rgba(82,82,91,0.6)" }}>
              <kbd style={{ fontFamily: "monospace" }}>Shift+Enter</kbd>
              <span>open in Blade</span>
              <span className="mx-1 opacity-40">·</span>
              <kbd style={{ fontFamily: "monospace" }}>Esc</kbd>
              <span>new query</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
