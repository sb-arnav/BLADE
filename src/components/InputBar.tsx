import { useCallback, useRef, useState, useMemo, KeyboardEvent, useEffect, DragEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

const SLASH_COMMANDS = [
  { cmd: "/clear",    label: "Clear conversation",                   icon: "✕", action: "clear" },
  { cmd: "/new",      label: "New conversation",                     icon: "+", action: "new" },
  { cmd: "/screenshot", label: "Capture screen",                     icon: "⬚", action: "screenshot" },
  { cmd: "/voice",    label: "Start voice input",                    icon: "◉", action: "voice" },
  { cmd: "/focus",    label: "Enter focus mode",                     icon: "◎", action: "focus" },
  { cmd: "/export",   label: "Export conversation",                  icon: "↗", action: "export" },
  { cmd: "/help",     label: "Show keyboard shortcuts",              icon: "?", action: "help" },
  { cmd: "/memory",   label: "Search your memory",                   icon: "◈", action: "memory" },
  { cmd: "/research", label: "Deep research mode",                   icon: "⬡", action: "research" },
  { cmd: "/think",    label: "Think deeply (extended reasoning)",    icon: "◇", action: "think" },
  { cmd: "/swarm",    label: "Spawn parallel agent swarm",          icon: "⬡", action: "swarm" },
  { cmd: "/timeline", label: "Open screen timeline",                 icon: "▦", action: "timeline" },
] as const;

type SlashAction = (typeof SLASH_COMMANDS)[number]["action"];

interface Suggestion {
  label: string;
  prompt: string;
}

interface Props {
  onSend: (message: string, imageBase64?: string) => void;
  onSlashCommand?: (action: SlashAction) => void;
  disabled: boolean;
  loading?: boolean;
  draftValue?: string | null;
  onDraftConsumed?: () => void;
  onPttMouseDown?: () => void;
  onPttMouseUp?: () => void;
  modelLabel?: string | null;
  suggestions?: Suggestion[];
  clipboardText?: string | null;
}

function buildSuggestions(
  clipboardText: string | null | undefined,
  externalSuggestions: Suggestion[] | undefined,
): Suggestion[] {
  const out: Suggestion[] = [];

  if (clipboardText) {
    const text = clipboardText.trim();
    if (/error|exception|traceback|undefined|null|cannot|failed|ENOENT/i.test(text)) {
      out.push({ label: "Diagnose clipboard error", prompt: `Diagnose this error:\n\n${text.slice(0, 500)}` });
    } else if (/^https?:\/\//i.test(text)) {
      out.push({ label: "Summarize this URL", prompt: `Summarize the content at: ${text}` });
    }
  }

  const hour = new Date().getHours();
  if (hour >= 5 && hour < 11 && out.length < 3) {
    out.push({ label: "Morning briefing", prompt: "Give me a morning briefing — what should I focus on today?" });
  }

  if (externalSuggestions) {
    for (const s of externalSuggestions) {
      if (out.length >= 3) break;
      if (!out.find((o) => o.label === s.label)) out.push({ label: s.label, prompt: s.prompt });
    }
  }

  return out.slice(0, 3);
}

// ─── Icon components ─────────────────────────────────────────────────────────

function IconScreenshot({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconMic({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 18v4M8 22h8" />
    </svg>
  );
}

function IconUpload({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconArrowUp({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

function IconStop({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="3" />
    </svg>
  );
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div
      className="relative"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
          px-2 py-1 rounded-md
          bg-blade-surface/95 backdrop-blur-sm
          border border-blade-border/70
          text-2xs text-blade-secondary font-medium
          shadow-surface-md whitespace-nowrap
          pointer-events-none animate-fade-in
        ">
          {label}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-blade-border/50" />
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InputBar({
  onSend,
  onSlashCommand,
  disabled,
  loading,
  draftValue,
  onDraftConsumed,
  onPttMouseDown,
  onPttMouseUp,
  modelLabel,
  suggestions: externalSuggestions,
  clipboardText,
}: Props) {
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [slashActive, setSlashActive] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const slashListRef = useRef<HTMLDivElement>(null);

  const slashMatches = useMemo(() => {
    if (!slashActive || !value.startsWith("/")) return [];
    const q = value.toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(q) || c.label.toLowerCase().includes(q.slice(1)));
  }, [value, slashActive]);

  const executeSlash = useCallback((action: SlashAction) => {
    setValue("");
    setSlashActive(false);
    onSlashCommand?.(action);
  }, [onSlashCommand]);

  // Scroll active slash item into view
  useEffect(() => {
    if (!slashListRef.current) return;
    const active = slashListRef.current.querySelector("[data-active='true']") as HTMLElement | null;
    active?.scrollIntoView({ block: "nearest" });
  }, [slashIndex]);

  useEffect(() => {
    if (!draftValue) return;
    setValue(draftValue);
    setSlashActive(draftValue.startsWith("/"));
    setSlashIndex(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        const end = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(end, end);
      }
    });
    onDraftConsumed?.();
  }, [draftValue, onDraftConsumed]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;

    if (slashMatches.length > 0 && slashActive) {
      executeSlash(slashMatches[slashIndex].action);
      return;
    }

    onSend(trimmed);
    setValue("");
    setSlashActive(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashActive && slashMatches.length > 0) {
      if (e.key === "ArrowDown")  { e.preventDefault(); setSlashIndex((i) => Math.min(i + 1, slashMatches.length - 1)); return; }
      if (e.key === "ArrowUp")    { e.preventDefault(); setSlashIndex((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Tab")        { e.preventDefault(); executeSlash(slashMatches[slashIndex].action); return; }
      if (e.key === "Escape")     { setSlashActive(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(",")[1];
          if (base64) onSend("What's in this image?", base64);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }, [onSend]);

  const handleDragEnter  = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }, []);
  const handleDragLeave  = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }, []);
  const handleDragOver   = useCallback((e: DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop       = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (!files.length) return;
    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        if (base64) onSend(`What's in this image? (${img.name})`, base64);
      };
      reader.readAsDataURL(img);
    } else {
      setValue((prev) => (prev ? `${prev} ${files.map((f) => f.name).join(", ")}` : files.map((f) => f.name).join(", ")));
      textareaRef.current?.focus();
    }
  }, [onSend]);

  const handleVoice = useCallback(async () => {
    setInputError(null);
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      try {
        const wav  = await invoke<string>("voice_stop_recording");
        const text = await invoke<string>("voice_transcribe", { audioBase64: wav });
        if (text.trim()) {
          setValue((prev) => (prev ? `${prev} ${text.trim()}` : text.trim()));
          textareaRef.current?.focus();
        }
      } catch (e) {
        setInputError(typeof e === "string" ? e : "Transcription failed");
        setTimeout(() => setInputError(null), 8000);
      }
      setTranscribing(false);
    } else {
      try {
        await invoke("voice_start_recording");
        setRecording(true);
      } catch (e) {
        setInputError(typeof e === "string" ? e : "Mic not available");
        setTimeout(() => setInputError(null), 8000);
      }
    }
  }, [recording]);

  const handleScreenshot = useCallback(async () => {
    setInputError(null);
    setCapturing(true);
    try {
      const png = await invoke<string>("capture_screen");
      onSend("What's on my screen?", png);
    } catch (e) {
      setInputError(typeof e === "string" ? e : "Screenshot failed");
      setTimeout(() => setInputError(null), 8000);
    }
    setCapturing(false);
  }, [onSend]);

  const busy = disabled || transcribing || capturing;
  const canSend = value.trim().length > 0 && !busy;

  const smartSuggestions = useMemo(
    () => buildSuggestions(clipboardText, externalSuggestions),
    [clipboardText, externalSuggestions]
  );

  const showSuggestions = !loading && !value && smartSuggestions.length > 0 && !slashActive;

  // Border state classes
  const borderClass = recording
    ? "border-red-500/40 shadow-glow-error"
    : isDragging
    ? "border-blade-accent/50 shadow-glow-accent-sm"
    : isFocused
    ? "border-blade-accent/40 shadow-inner-focus"
    : "border-blade-border/50";

  return (
    <div
      className="relative px-3 pb-3 pt-1.5"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Spotlight overlay — dims the rest of the UI when input is focused */}
      <div className={`input-spotlight-overlay ${isFocused ? "active" : ""}`} />
      {/* Smart suggestion pills */}
      {showSuggestions && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap animate-fade-up">
          {smartSuggestions.map((s) => (
            <button
              key={s.label}
              onClick={() => onSend(s.prompt)}
              disabled={busy}
              className="
                px-2.5 py-1 rounded-full
                border border-blade-border/50
                bg-blade-surface/60 backdrop-blur-sm
                text-2xs font-medium text-blade-muted
                hover:text-blade-text hover:border-blade-accent/30 hover:bg-blade-surface
                hover:shadow-glow-accent-sm
                disabled:opacity-40
                transition-all duration-200
              "
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Slash command palette — VS Code command palette style */}
      {slashActive && slashMatches.length > 0 && (
        <div
          ref={slashListRef}
          className="
            absolute bottom-full left-3 right-3 mb-1.5 z-50
            bg-blade-surface/98 backdrop-blur-xl
            border border-blade-border
            rounded-xl overflow-hidden
            shadow-surface-xl
            animate-fade-up
            max-h-64 overflow-y-auto
          "
        >
          {/* Palette header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-blade-border/60">
            <span className="text-2xs font-mono text-blade-accent/70">/</span>
            <span className="text-2xs text-blade-muted/60 font-medium">Commands</span>
            <span className="ml-auto text-2xs text-blade-muted/40 font-mono">↑↓ navigate · ↵ run · esc close</span>
          </div>

          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.cmd}
              data-active={i === slashIndex}
              onClick={() => executeSlash(cmd.action)}
              className={`
                w-full text-left px-3 py-2.5 flex items-center gap-3
                transition-all duration-100
                ${i === slashIndex
                  ? "bg-blade-accent/10 border-l-2 border-blade-accent"
                  : "border-l-2 border-transparent text-blade-secondary hover:bg-blade-surface-hover hover:text-blade-text"
                }
              `}
            >
              <span className={`text-[11px] font-mono w-4 text-center shrink-0 ${i === slashIndex ? "text-blade-accent" : "text-blade-muted/50"}`}>
                {cmd.icon}
              </span>
              <span className={`text-2xs font-mono font-medium w-20 shrink-0 ${i === slashIndex ? "text-blade-accent" : "text-blade-secondary"}`}>
                {cmd.cmd}
              </span>
              <span className={`text-2xs ${i === slashIndex ? "text-blade-text" : "text-blade-muted/70"}`}>
                {cmd.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Error banner */}
      {inputError && (
        <div className="mb-2 px-3 py-2 rounded-lg bg-red-500/6 border border-red-500/20 text-red-400/90 text-2xs animate-fade-up flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="currentColor">
            <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 2.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-1 0V4a.5.5 0 0 1 .5-.5zm0 7a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5z" />
          </svg>
          {inputError}
        </div>
      )}

      {/* File drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-20 mx-3 mb-3 mt-1.5 rounded-xl border-2 border-dashed border-blade-accent/50 bg-blade-accent/5 flex items-center justify-center pointer-events-none animate-fade-in">
          <div className="flex flex-col items-center gap-2">
            <IconUpload className="w-6 h-6 text-blade-accent/60" />
            <span className="text-2xs font-medium text-blade-accent/70">Drop to send</span>
          </div>
        </div>
      )}

      {/* Main input container */}
      <div
        className={`
          flex items-end gap-2 rounded-xl
          bg-blade-surface/80 backdrop-blur-sm
          border transition-all duration-200
          px-3 py-2.5
          ${borderClass}
        `}
      >
        {/* Left icon buttons */}
        <div className="flex items-center gap-0.5 pb-0.5 shrink-0">
          <Tooltip label="Capture screen">
            <button
              onClick={handleScreenshot}
              disabled={busy}
              className={`
                w-7 h-7 rounded-lg flex items-center justify-center
                transition-all duration-150
                disabled:opacity-25
                ${capturing
                  ? "text-blade-accent bg-blade-accent/10"
                  : "text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface-active"
                }
              `}
            >
              {capturing
                ? <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse-subtle" />
                : <IconScreenshot />
              }
            </button>
          </Tooltip>

          <Tooltip label={onPttMouseDown ? "Hold to talk" : recording ? "Stop recording" : "Voice input"}>
            <button
              onClick={onPttMouseDown ? undefined : handleVoice}
              onMouseDown={onPttMouseDown}
              onMouseUp={onPttMouseUp}
              onMouseLeave={onPttMouseUp}
              disabled={busy && !recording && !onPttMouseDown}
              className={`
                w-7 h-7 rounded-lg flex items-center justify-center
                transition-all duration-150
                ${recording
                  ? "text-red-400 bg-red-500/10 shadow-glow-error"
                  : "text-blade-muted/60 hover:text-blade-secondary hover:bg-blade-surface-active"
                }
                ${(busy && !recording && !onPttMouseDown) ? "opacity-25" : ""}
              `}
            >
              {transcribing
                ? <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse-subtle" />
                : <IconMic className={recording ? "w-3.5 h-3.5 animate-pulse-subtle" : "w-3.5 h-3.5"} />
              }
            </button>
          </Tooltip>
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            if (v.startsWith("/") && v.length <= 20) {
              setSlashActive(true);
              setSlashIndex(0);
            } else {
              setSlashActive(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={
            recording ? "Listening…"
            : transcribing ? "Transcribing…"
            : "Message BLADE…"
          }
          disabled={busy}
          rows={1}
          className="
            flex-1 bg-transparent resize-none outline-none
            text-blade-text text-[0.8125rem] leading-relaxed
            placeholder:text-blade-muted/40
            max-h-40 min-h-[1.5rem]
            disabled:opacity-60
          "
          style={{ height: "auto" }}
          onInput={(e) => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = `${t.scrollHeight}px`;
          }}
        />

        {/* Send / Stop */}
        <div className="pb-0.5 shrink-0">
          {loading ? (
            <Tooltip label="Stop generating">
              <button
                onClick={() => invoke("cancel_chat")}
                className="
                  w-7 h-7 rounded-lg flex items-center justify-center
                  bg-red-500/15 text-red-400
                  hover:bg-red-500/25 hover:shadow-glow-error
                  transition-all duration-150
                "
                aria-label="Stop"
              >
                <IconStop />
              </button>
            </Tooltip>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`
                w-7 h-7 rounded-lg flex items-center justify-center
                transition-all duration-200
                ${canSend
                  ? "bg-blade-accent text-white hover:bg-blade-accent-hover hover:shadow-glow-accent-sm animate-send-pulse"
                  : "text-blade-muted/20 bg-transparent"
                }
              `}
              aria-label="Send"
            >
              <IconArrowUp />
            </button>
          )}
        </div>
      </div>

      {/* Footer row */}
      <div className="flex items-center justify-between mt-1.5 px-1">
        <span className="text-2xs text-blade-muted/35">
          {recording
            ? "Recording — click mic to stop"
            : "Speak, paste, drop files, or type"}
        </span>
        <div className="flex items-center gap-2">
          {value.length > 0 && (
            <span className={`
              text-2xs font-mono
              ${value.length > 8000 ? "text-red-400/70"
                : value.length > 3000 ? "text-amber-400/60"
                : value.length > 300 ? "text-blade-muted/35"
                : "text-blade-muted/20"}
            `}>
              {value.length > 999 ? `${(value.length / 1000).toFixed(1)}k` : value.length}
            </span>
          )}
          {modelLabel ? (
            <span className="text-2xs text-blade-muted/25 font-mono truncate max-w-[140px]" title={modelLabel}>
              {modelLabel}
            </span>
          ) : (
            <kbd className="text-2xs text-blade-muted/30 font-mono bg-blade-surface/60 border border-blade-border/30 px-1.5 py-0.5 rounded">
              Ctrl+K
            </kbd>
          )}
        </div>
      </div>
    </div>
  );
}
