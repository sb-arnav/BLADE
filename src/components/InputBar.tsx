import { useCallback, useRef, useState, KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

interface Props {
  onSend: (message: string, imageBase64?: string) => void;
  disabled: boolean;
}

export function InputBar({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleVoice = useCallback(async () => {
    if (recording) {
      // Stop recording and transcribe
      setRecording(false);
      setTranscribing(true);
      try {
        const wav = await invoke<string>("voice_stop_recording");
        const text = await invoke<string>("voice_transcribe", { audioBase64: wav });
        if (text.trim()) {
          setValue((prev) => (prev ? prev + " " + text.trim() : text.trim()));
          textareaRef.current?.focus();
        }
      } catch {
        // Voice failed silently — user can retry
      }
      setTranscribing(false);
    } else {
      // Start recording
      try {
        await invoke("voice_start_recording");
        setRecording(true);
      } catch {
        // Mic not available
      }
    }
  }, [recording]);

  const handleScreenshot = useCallback(async () => {
    setCapturing(true);
    try {
      const png = await invoke<string>("capture_screen");
      onSend("What's on my screen?", png);
    } catch {
      // Screenshot failed
    }
    setCapturing(false);
  }, [onSend]);

  const busy = disabled || transcribing || capturing;

  return (
    <div className="px-4 py-3 border-t border-blade-border bg-blade-bg">
      <div className="flex items-end gap-2 bg-blade-surface border border-blade-border rounded-xl px-3 py-2">
        {/* Screenshot button */}
        <button
          onClick={handleScreenshot}
          disabled={busy}
          className="text-blade-muted hover:text-blade-text disabled:text-blade-muted/40 transition-colors pb-0.5"
          aria-label="Capture screen"
          title="Screenshot"
        >
          {capturing ? (
            <div className="w-4 h-4 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blade-muted animate-pulse" />
            </div>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>

        {/* Mic button */}
        <button
          onClick={handleVoice}
          disabled={busy && !recording}
          className={`transition-colors pb-0.5 ${
            recording
              ? "text-red-400 hover:text-red-300"
              : transcribing
                ? "text-blade-muted/40"
                : "text-blade-muted hover:text-blade-text"
          }`}
          aria-label={recording ? "Stop recording" : "Start voice input"}
          title={recording ? "Stop recording" : "Voice input"}
        >
          {transcribing ? (
            <div className="w-4 h-4 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blade-muted animate-pulse" />
            </div>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0" />
              <path d="M12 18v4M8 22h8" />
            </svg>
          )}
        </button>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={recording ? "Listening..." : transcribing ? "Transcribing..." : "Ask Blade anything..."}
          disabled={busy}
          rows={1}
          className="flex-1 bg-transparent text-blade-text text-sm resize-none outline-none placeholder:text-blade-muted max-h-32 min-h-[1.5rem]"
          style={{ height: "auto" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
          }}
        />

        {/* Recording indicator */}
        {recording && (
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0 mb-1" />
        )}

        <button
          onClick={handleSend}
          disabled={busy || !value.trim()}
          className="text-blade-accent hover:text-white disabled:text-blade-muted transition-colors pb-0.5"
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5 ml-1">
        <p className="text-blade-muted text-xs">Enter to send · Shift+Enter for newline</p>
        <p className="text-blade-muted text-xs mr-1">
          <kbd className="font-mono text-[10px] border border-blade-border rounded px-1 py-0.5">Ctrl K</kbd>
        </p>
      </div>
    </div>
  );
}
