/// BLADE QuickAsk — Spotlight-style popup. Clean frosted glass, Apple style.
///
/// Slash commands:
///   /screenshot  — capture screen + analyze
///   /voice       — start voice input
///   /lock        — lock screen
///   /break       — take a break reminder

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
  if (!trimmed || trimmed.startsWith("/")) return history;
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
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [ambientLine, setAmbientLine] = useState("");

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

        invoke<ActiveWindow>("get_active_window").then((w) => {
          if (w.app_name && w.app_name.toLowerCase() !== "blade") {
            setContextApp(w.app_name);
            buildContextSuggestions(w.app_name);
          }
        }).catch(() => {});

        invoke<string>("get_clipboard").then((text) => {
          clipboardRef.current = text ?? "";
          buildContextSuggestions(contextApp ?? "");
        }).catch(() => {});

        // Fetch ambient hive status for the context line
        invoke<string>("hive_get_digest").then((digest) => {
          if (!digest) { setAmbientLine(""); return; }
          // Extract the most useful line: first organ report or status
          const lines = digest.split("\n").filter(l => l.startsWith("- **") || l.includes("Active organs:"));
          const active = lines.find(l => l.includes("Active organs:"));
          const urgent = lines.find(l => l.includes("URGENT"));
          setAmbientLine(
            urgent ? urgent.replace(/\*\*/g, "").replace(/^- /, "")
            : active ? active.replace(/\*\*/g, "")
            : ""
          );
        }).catch(() => {});
      }
    });

    setTimeout(() => inputRef.current?.focus(), 50);
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

  // ── Keyboard shortcuts 1–5 for history items ──────────────────────────────

  useEffect(() => {
    const handleGlobal = (e: KeyboardEvent) => {
      if (!showSuggestions || loading || response) return;
      const key = parseInt(e.key);
      if (key >= 1 && key <= 5 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Only fire if input is focused and empty
        if (document.activeElement === inputRef.current && !query) {
          const histItems = history.slice(0, 5);
          const item = histItems[key - 1];
          if (item) {
            e.preventDefault();
            sendMessage(item);
          }
        }
      }
    };
    window.addEventListener("keydown", handleGlobal);
    return () => window.removeEventListener("keydown", handleGlobal);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSuggestions, loading, response, history, query]);

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

    if (trimmed.startsWith("/")) {
      const cmd = trimmed.split(" ")[0].toLowerCase();
      setQuery("");
      await handleSlashCommand(cmd);
      return;
    }

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

  const allSuggestions: Array<{ text: string; label?: string; isHistory?: boolean; isSlash?: boolean; icon?: string; shortcut?: string }> =
    query.startsWith("/")
      ? SLASH_COMMANDS
          .filter((s) => s.cmd.startsWith(query.toLowerCase()))
          .map((s) => ({ text: s.cmd, label: s.desc, isSlash: true, icon: s.icon }))
      : query.trim()
      ? []
      : [
          ...suggestions.map((s) => ({ text: s.text, label: s.label, icon: s.icon })),
          ...history.map((h, i) => ({ text: h, isHistory: true, icon: "🕐", shortcut: String(i + 1) })),
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

  // ── Render ────────────────────────────────────────────────────────────────

  const hasResponse = response.length > 0;
  const showSuggestionList = showSuggestions && !loading && !hasResponse && !error && allSuggestions.length > 0;
  const isSlashMode = query.startsWith("/");

  return (
    <>
      <style>{`
        .quickask-input::placeholder { color: rgba(160,160,172,0.45); }
        .quickask-input:focus { outline: none; }
      `}</style>

      <div
        className="flex flex-col w-full overflow-hidden"
        style={{
          background: "rgba(18,18,22,0.92)",
          backdropFilter: "blur(28px) saturate(1.8)",
          WebkitBackdropFilter: "blur(28px) saturate(1.8)",
          borderRadius: "14px",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset",
          minHeight: "64px",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4" style={{ height: "64px", flexShrink: 0 }}>
          {/* Search icon */}
          <svg viewBox="0 0 16 16" className="flex-shrink-0 w-4 h-4" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>

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
            placeholder={isSlashMode ? "Type a command…" : "Ask BLADE…"}
            disabled={loading}
            className="quickask-input flex-1 bg-transparent"
            style={{
              fontSize: "15px",
              fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              color: "rgba(255,255,255,0.9)",
              caretColor: "#818cf8",
              border: "none",
            }}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />

          {/* Loading indicator — simple spinner */}
          {loading && (
            <div
              style={{
                width: "14px", height: "14px", borderRadius: "50%",
                border: "1.5px solid rgba(255,255,255,0.12)",
                borderTopColor: "rgba(255,255,255,0.6)",
                flexShrink: 0,
                animation: "spin 0.7s linear infinite",
              }}
            />
          )}

          {/* Ambient context — what BLADE sees right now */}
          {!loading && !query.trim() && ambientLine && (
            <span
              className="flex-shrink-0 truncate"
              style={{
                fontSize: "10px",
                color: "rgba(129,140,248,0.5)",
                maxWidth: "200px",
              }}
            >
              {ambientLine}
            </span>
          )}

          {/* Enter hint */}
          {!loading && query.trim() && (
            <kbd
              className="flex-shrink-0"
              style={{
                fontSize: "11px",
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.3)",
                padding: "2px 5px",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.07)",
              }}
            >
              ↵
            </kbd>
          )}

          {/* Esc hint */}
          {!loading && !query.trim() && (
            <kbd
              className="flex-shrink-0"
              style={{
                fontSize: "11px",
                fontFamily: "monospace",
                color: "rgba(255,255,255,0.2)",
                padding: "2px 5px",
                borderRadius: "4px",
                background: "rgba(255,255,255,0.05)",
              }}
            >
              Esc
            </kbd>
          )}

          <button
            onClick={hide}
            className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center"
            style={{ color: "rgba(255,255,255,0.25)", background: "none", border: "none", cursor: "pointer" }}
            title="Close (Esc)"
          >
            <svg viewBox="0 0 16 16" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Context label */}
        {contextApp && !hasResponse && !loading && !showSuggestionList && (
          <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(129,140,248,0.6)", flexShrink: 0 }} />
            <span style={{
              fontSize: "12px",
              color: "rgba(129,140,248,0.7)",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              maxWidth: "280px",
            }}>
              {contextApp}
            </span>
          </div>
        )}

        {/* Suggestions / history / slash commands list */}
        {showSuggestionList && (
          <>
            <div style={{ height: "1px", background: "rgba(255,255,255,0.07)", margin: "0 0" }} />
            <div style={{ padding: "6px 0 8px" }}>
              {allSuggestions.map((item, i) => (
                <div
                  key={i}
                  onClick={() => sendMessage(item.text)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: "10px",
                    padding: "9px 16px",
                    background: selectedIdx === i ? "rgba(255,255,255,0.06)" : "transparent",
                    cursor: "pointer", transition: "background 0.25s ease",
                  }}
                >
                  <span style={{ fontSize: "15px", flexShrink: 0, width: "20px", textAlign: "center" }}>{item.icon}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: "13px",
                      fontWeight: item.isHistory ? 400 : 500,
                      color: item.isHistory ? "rgba(255,255,255,0.5)" : item.isSlash ? "#a5b4fc" : "rgba(255,255,255,0.85)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {item.isSlash ? (item as { text: string }).text : item.label ?? item.text}
                    </div>
                    {item.isSlash && item.label && (
                      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", marginTop: "1px" }}>
                        {item.label}
                      </div>
                    )}
                  </div>
                  {/* Keyboard shortcut badge — subtle gray */}
                  {item.isHistory && item.shortcut && (
                    <kbd style={{
                      marginLeft: "auto", fontSize: "11px", flexShrink: 0,
                      padding: "2px 6px", borderRadius: "4px",
                      background: "rgba(255,255,255,0.07)",
                      color: "rgba(255,255,255,0.3)",
                      fontFamily: "monospace",
                    }}>
                      {item.shortcut}
                    </kbd>
                  )}
                  {selectedIdx === i && !item.isHistory && (
                    <span style={{ marginLeft: "auto", fontSize: "12px", color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>↵</span>
                  )}
                </div>
              ))}

              <div style={{ padding: "6px 16px 0", display: "flex", gap: "12px" }}>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>↑↓ navigate</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>Tab complete</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>1–5 history</span>
              </div>
            </div>
          </>
        )}

        {/* Response / error area */}
        {(hasResponse || error) && (
          <>
            <div style={{ height: "1px", background: "rgba(255,255,255,0.07)" }} />
            <div
              className="px-4 py-3 overflow-y-auto"
              style={{
                maxHeight: "320px",
                fontSize: "14px",
                lineHeight: "1.65",
                color: error ? "#ff3b30" : "rgba(255,255,255,0.88)",
                fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
                wordBreak: "break-word",
                whiteSpace: "pre-wrap",
              }}
            >
              {error ? error : response}
            </div>

            {hasResponse && !loading && (
              <div className="px-4 pb-3 flex items-center gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "8px" }}>
                <kbd style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.06)", padding: "2px 5px", borderRadius: "4px" }}>Shift+Enter</kbd>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>open in BLADE</span>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.15)", margin: "0 4px" }}>·</span>
                <kbd style={{ fontSize: "11px", fontFamily: "monospace", color: "rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.06)", padding: "2px 5px", borderRadius: "4px" }}>Esc</kbd>
                <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>clear</span>
              </div>
            )}
          </>
        )}
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
