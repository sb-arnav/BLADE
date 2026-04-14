import { useCallback, useRef, useState, useMemo, KeyboardEvent, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const SLASH_COMMANDS = [
  { cmd: "/clear", label: "Clear conversation", action: "clear" },
  { cmd: "/new", label: "New conversation", action: "new" },
  { cmd: "/screenshot", label: "Capture screen", action: "screenshot" },
  { cmd: "/voice", label: "Start voice input", action: "voice" },
  { cmd: "/focus", label: "Enter focus mode", action: "focus" },
  { cmd: "/export", label: "Export conversation", action: "export" },
  { cmd: "/help", label: "Show keyboard shortcuts", action: "help" },
  { cmd: "/memory", label: "Search your memory", action: "memory" },
  { cmd: "/research", label: "Deep research mode", action: "research" },
  { cmd: "/think", label: "Think deeply about this (extended reasoning)", action: "think" },
  { cmd: "/swarm", label: "Spawn parallel agent swarm", action: "swarm" },
  { cmd: "/timeline", label: "Open screen timeline", action: "timeline" },
] as const;

type SlashAction = (typeof SLASH_COMMANDS)[number]["action"];

interface Props {
  onSend: (message: string, imageBase64?: string) => void;
  onSlashCommand?: (action: SlashAction) => void;
  disabled: boolean;
  loading?: boolean;
  draftValue?: string | null;
  onDraftConsumed?: () => void;
  onPttMouseDown?: () => void;
  onPttMouseUp?: () => void;
}

export function InputBar({ onSend, onSlashCommand, disabled, loading, draftValue, onDraftConsumed, onPttMouseDown, onPttMouseUp }: Props) {
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [slashActive, setSlashActive] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    // Handle slash commands
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
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        executeSlash(slashMatches[slashIndex].action);
        return;
      }
      if (e.key === "Escape") {
        setSlashActive(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          if (base64) onSend("What's in this image?", base64);
        };
        reader.readAsDataURL(blob);
        return;
      }
    }
  }, [onSend]);

  const handleVoice = useCallback(async () => {
    setInputError(null);
    if (recording) {
      setRecording(false);
      setTranscribing(true);
      try {
        const wav = await invoke<string>("voice_stop_recording");
        const text = await invoke<string>("voice_transcribe", { audioBase64: wav });
        if (text.trim()) {
          setValue((prev) => (prev ? prev + " " + text.trim() : text.trim()));
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

  return (
    <div className="px-4 pb-4 pt-2 relative">
      {slashActive && slashMatches.length > 0 && (
        <div className="absolute bottom-full left-4 right-4 mb-1 bg-blade-surface border border-blade-border rounded-lg shadow-lg overflow-hidden animate-fade-in z-10">
          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.cmd}
              onClick={() => executeSlash(cmd.action)}
              className={`w-full text-left px-3 py-2 flex items-center gap-3 text-xs transition-colors ${
                i === slashIndex ? "bg-blade-accent-muted text-blade-text" : "text-blade-secondary hover:bg-blade-surface-hover"
              }`}
            >
              <span className="font-mono text-blade-accent">{cmd.cmd}</span>
              <span className="text-blade-muted">{cmd.label}</span>
            </button>
          ))}
        </div>
      )}
      {inputError && (
        <div className="mb-2 px-3 py-1.5 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-2xs animate-fade-in">
          {inputError}
        </div>
      )}
      <div className={`flex items-end gap-1.5 rounded-xl border transition-colors ${
        recording
          ? "border-red-500/30 bg-red-500/5"
          : "border-blade-border bg-blade-surface"
      } px-3 py-2`}>
        {/* Action buttons */}
        <div className="flex items-center gap-0.5 pb-0.5">
          <button
            onClick={handleScreenshot}
            disabled={busy}
            className="w-7 h-7 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover disabled:opacity-30 transition-colors"
            title="Screenshot"
          >
            {capturing ? (
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse-slow" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
          <button
            onClick={onPttMouseDown ? undefined : handleVoice}
            onMouseDown={onPttMouseDown}
            onMouseUp={onPttMouseUp}
            onMouseLeave={onPttMouseUp}
            disabled={busy && !recording && !onPttMouseDown}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              recording
                ? "text-red-400 bg-red-400/10"
                : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
            } ${(busy && !recording && !onPttMouseDown) ? "opacity-30" : ""}`}
            title={onPttMouseDown ? "Hold to talk" : recording ? "Stop" : "Voice"}
          >
            {transcribing ? (
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse-slow" />
            ) : (
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <path d="M12 18v4M8 22h8" />
              </svg>
            )}
          </button>
        </div>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            if (v.startsWith("/") && v.length <= 15) {
              setSlashActive(true);
              setSlashIndex(0);
            } else {
              setSlashActive(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={recording ? "Listening..." : transcribing ? "Transcribing..." : "Message Blade..."}
          disabled={busy}
          rows={1}
          className="flex-1 bg-transparent text-blade-text text-[0.8125rem] resize-none outline-none placeholder:text-blade-muted max-h-32 min-h-[1.5rem] leading-relaxed"
          style={{ height: "auto" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
          }}
        />

        {/* Send / Stop */}
        {loading ? (
          <button
            onClick={() => invoke("cancel_chat")}
            className="w-7 h-7 rounded-lg flex items-center justify-center mb-0.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
            aria-label="Stop"
            title="Stop generating"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={busy || !value.trim()}
            className={`w-7 h-7 rounded-lg flex items-center justify-center mb-0.5 transition-all ${
              value.trim() && !busy
                ? "bg-blade-accent text-white hover:bg-blade-accent-hover"
                : "text-blade-muted/30"
            }`}
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex items-center justify-between mt-1 px-1">
        <span className="text-2xs text-blade-muted/50">
          {recording ? "Recording... click mic to stop" : "Type, speak, paste, or capture your screen"}
        </span>
        <div className="flex items-center gap-2">
          {value.length > 0 && (
            <span className={`text-2xs font-mono ${value.length > 8000 ? "text-red-400/70" : value.length > 3000 ? "text-amber-400/60" : value.length > 300 ? "text-blade-muted/40" : "text-blade-muted/20"}`}>
              {value.length > 999 ? `${(value.length / 1000).toFixed(1)}k` : value.length}c · ~{Math.round(value.length / 4)}t
            </span>
          )}
          <kbd className="text-2xs text-blade-muted/40 font-mono">Ctrl+K</kbd>
        </div>
      </div>
    </div>
  );
}
