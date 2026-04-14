/// BLADE QuickAsk — Alt+Space popup with contextual suggestions, command history,
/// inline results, and slash command support.
///
/// Sci-fi upgrades:
///   - Blurred glass background with border glow
///   - Input auto-focuses with cursor blink animation
///   - Results stream in via typewriter effect (not instant)
///   - "BLADE is thinking" animation (3 dots with wave)
///   - Recent commands show keyboard shortcuts [1]–[5]
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

// Typewriter speed: ms per character added to display
const TYPEWRITER_CHAR_MS = 8;

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

// ── Thinking dots component ───────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        padding: "10px 0",
      }}
    >
      <span style={{ fontSize: "10px", color: "rgba(99,102,241,0.6)", marginRight: "4px", letterSpacing: "0.04em" }}>
        BLADE
      </span>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: "rgba(99,102,241,0.7)",
            animation: `thinkWave 1s ease-in-out infinite`,
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function QuickAsk() {
  const [query, setQuery] = useState("");
  // fullResponse: complete buffered response from streaming
  const [fullResponse, setFullResponse] = useState("");
  // displayedResponse: typewriter-revealed portion of fullResponse
  const [displayedResponse, setDisplayedResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextApp, setContextApp] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [history, setHistory] = useState<string[]>(loadHistory);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const streamBuffer = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const clipboardRef = useRef("");

  // Typewriter state
  const typewriterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typewriterPosRef = useRef(0);

  // Drive typewriter: reveal fullResponse char-by-char
  useEffect(() => {
    if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current);
    if (!fullResponse) {
      setDisplayedResponse("");
      typewriterPosRef.current = 0;
      return;
    }

    const revealNext = () => {
      typewriterPosRef.current = Math.min(typewriterPosRef.current + 1, fullResponse.length);
      setDisplayedResponse(fullResponse.slice(0, typewriterPosRef.current));
      if (typewriterPosRef.current < fullResponse.length) {
        typewriterTimerRef.current = setTimeout(revealNext, TYPEWRITER_CHAR_MS);
      }
    };

    if (typewriterPosRef.current < fullResponse.length) {
      typewriterTimerRef.current = setTimeout(revealNext, TYPEWRITER_CHAR_MS);
    }

    return () => { if (typewriterTimerRef.current) clearTimeout(typewriterTimerRef.current); };
  }, [fullResponse]);

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
      setFullResponse(streamBuffer.current);
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
      if (!showSuggestions || loading || fullResponse) return;
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
  }, [showSuggestions, loading, fullResponse, history, query]);

  // ── Slash command handling ────────────────────────────────────────────────

  const handleSlashCommand = useCallback(async (cmd: string) => {
    switch (cmd) {
      case "/screenshot": {
        setLoading(true);
        setFullResponse("");
        setDisplayedResponse("");
        setError(null);
        streamBuffer.current = "";
        typewriterPosRef.current = 0;
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
          setFullResponse("Listening… press Ctrl+Space again to stop.");
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
    setFullResponse("");
    setDisplayedResponse("");
    setError(null);
    setLoading(false);
    setContextApp(null);
    setShowSuggestions(true);
    setSelectedIdx(-1);
    streamBuffer.current = "";
    typewriterPosRef.current = 0;
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
    typewriterPosRef.current = 0;
    setFullResponse("");
    setDisplayedResponse("");
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
        if (fullResponse || error) {
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
    [hide, openMain, query, sendMessage, allSuggestions, selectedIdx, fullResponse, error, resetState]
  );

  // ── Styles ────────────────────────────────────────────────────────────────

  const hasResponse = fullResponse.length > 0;
  const showSuggestionList = showSuggestions && !loading && !hasResponse && !error && allSuggestions.length > 0;
  const isSlashMode = query.startsWith("/");
  const typewriterDone = displayedResponse.length >= fullResponse.length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes thinkWave {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes inputGlow {
          0%, 100% { box-shadow: 0 0 0 1px rgba(99,102,241,0.15), 0 32px 64px rgba(0,0,0,0.7); }
          50% { box-shadow: 0 0 0 1px rgba(99,102,241,0.4), 0 32px 72px rgba(0,0,0,0.75), 0 0 20px rgba(99,102,241,0.08); }
        }
        @keyframes cursorPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
        .quickask-input::placeholder { color: rgba(113,113,122,0.6); }
        .quickask-input:focus { outline: none; }
      `}</style>

      <div
        className="flex flex-col w-full overflow-hidden"
        style={{
          background: "rgba(6,6,10,0.88)",
          backdropFilter: "blur(28px) saturate(200%)",
          WebkitBackdropFilter: "blur(28px) saturate(200%)",
          borderRadius: "14px",
          border: "1px solid rgba(99,102,241,0.2)",
          boxShadow: "0 32px 64px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.04), 0 0 24px rgba(99,102,241,0.06)",
          minHeight: "72px",
          fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          animation: "inputGlow 4s ease-in-out infinite",
        }}
      >
        {/* Input row */}
        <div className="flex items-center gap-3 px-4" style={{ height: "72px", flexShrink: 0 }}>
          {/* BLADE logo */}
          <div
            className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
            style={{ background: "rgba(99,102,241,0.2)", boxShadow: "0 0 8px rgba(99,102,241,0.2)" }}
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
            className="quickask-input flex-1 bg-transparent text-blade-text"
            style={{
              fontSize: "0.9rem",
              fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              letterSpacing: "-0.01em",
              color: isSlashMode ? "#a5b4fc" : "rgba(255,255,255,0.88)",
              caretColor: "#6366f1",
              border: "none",
            }}
            autoComplete="off"
            spellCheck={false}
            autoFocus
          />

          {/* Thinking animation */}
          {loading && <ThinkingDots />}

          {/* Enter hint */}
          {!loading && query.trim() && (
            <kbd
              className="flex-shrink-0"
              style={{
                fontSize: "0.6rem",
                fontFamily: "monospace",
                color: "rgba(99,102,241,0.5)",
                padding: "1px 4px",
                borderRadius: "3px",
                border: "1px solid rgba(99,102,241,0.2)",
                background: "rgba(99,102,241,0.05)",
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
                fontSize: "0.6rem",
                fontFamily: "monospace",
                color: "rgba(113,113,122,0.35)",
                padding: "1px 4px",
                borderRadius: "3px",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              Esc
            </kbd>
          )}

          <button
            onClick={hide}
            className="flex-shrink-0 w-5 h-5 rounded flex items-center justify-center"
            style={{ color: "rgba(113,113,122,0.4)", background: "none", border: "none", cursor: "pointer" }}
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
                display: "flex", alignItems: "center", gap: "5px",
                padding: "3px 8px", borderRadius: "6px",
                background: "rgba(99,102,241,0.07)",
                border: "1px solid rgba(99,102,241,0.12)",
              }}
            >
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "rgba(99,102,241,0.65)", flexShrink: 0 }} />
              <span style={{
                fontSize: "0.6rem",
                color: "rgba(99,102,241,0.75)",
                fontFamily: "Inter, sans-serif",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
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
              <div style={{
                padding: "2px 8px 4px",
                fontSize: "9px", fontWeight: 700, letterSpacing: "0.08em",
                color: "rgba(255,255,255,0.18)", textTransform: "uppercase",
              }}>
                {isSlashMode ? "Commands" : "Suggestions"}
              </div>

              {allSuggestions.map((item, i) => (
                <div
                  key={i}
                  onClick={() => sendMessage(item.text)}
                  onMouseEnter={() => setSelectedIdx(i)}
                  style={{
                    display: "flex", alignItems: "center", gap: "8px",
                    padding: "6px 8px", borderRadius: "6px",
                    background: selectedIdx === i ? "rgba(99,102,241,0.12)" : "transparent",
                    cursor: "pointer", transition: "background 0.1s",
                    border: selectedIdx === i ? "1px solid rgba(99,102,241,0.15)" : "1px solid transparent",
                  }}
                >
                  <span style={{ fontSize: "13px", flexShrink: 0 }}>{item.icon}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: "11px",
                      color: item.isHistory ? "rgba(255,255,255,0.42)" : item.isSlash ? "#a5b4fc" : "rgba(255,255,255,0.75)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {item.isSlash ? (item as { text: string }).text : item.label ?? item.text}
                    </div>
                    {item.isSlash && item.label && (
                      <div style={{ fontSize: "9px", color: "rgba(255,255,255,0.22)", marginTop: "1px" }}>
                        {item.label}
                      </div>
                    )}
                    {!item.isSlash && item.label && item.text !== item.label && (
                      <div style={{
                        fontSize: "9px", color: "rgba(255,255,255,0.2)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: "1px",
                      }}>
                        {item.text.length > 55 ? item.text.slice(0, 55) + "…" : item.text}
                      </div>
                    )}
                  </div>
                  {/* Keyboard shortcut for history items */}
                  {item.isHistory && item.shortcut && (
                    <kbd style={{
                      marginLeft: "auto", fontSize: "9px", flexShrink: 0,
                      padding: "1px 4px", borderRadius: "3px",
                      background: selectedIdx === i ? "rgba(99,102,241,0.2)" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${selectedIdx === i ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.07)"}`,
                      color: selectedIdx === i ? "rgba(99,102,241,0.9)" : "rgba(255,255,255,0.2)",
                      fontFamily: "monospace",
                    }}>
                      {item.shortcut}
                    </kbd>
                  )}
                  {selectedIdx === i && !item.isHistory && (
                    <kbd style={{
                      marginLeft: "auto", fontSize: "9px", flexShrink: 0,
                      color: "rgba(255,255,255,0.2)", fontFamily: "monospace",
                    }}>↵</kbd>
                  )}
                </div>
              ))}

              <div style={{ padding: "4px 8px 2px", fontSize: "9px", color: "rgba(255,255,255,0.12)", display: "flex", gap: "8px" }}>
                <span>↑↓ navigate</span>
                <span>Tab complete</span>
                <span>1–5 history</span>
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
              {error ? error : displayedResponse}
              {/* Blinking cursor while typewriter is running or loading */}
              {!error && (loading || !typewriterDone) && (
                <span
                  style={{
                    display: "inline-block",
                    width: "2px",
                    height: "0.9em",
                    background: "#6366f1",
                    marginLeft: "1px",
                    verticalAlign: "middle",
                    animation: "cursorPulse 0.7s step-end infinite",
                  }}
                />
              )}
            </div>

            {hasResponse && !loading && typewriterDone && (
              <div className="px-4 pb-2 flex items-center gap-1.5" style={{ fontSize: "0.6rem", color: "rgba(82,82,91,0.55)" }}>
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
    </>
  );
}
