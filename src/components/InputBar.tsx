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
  const [inputError, setInputError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
        setTimeout(() => setInputError(null), 4000);
      }
      setTranscribing(false);
    } else {
      try {
        await invoke("voice_start_recording");
        setRecording(true);
      } catch (e) {
        setInputError(typeof e === "string" ? e : "Mic not available");
        setTimeout(() => setInputError(null), 4000);
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
      setTimeout(() => setInputError(null), 4000);
    }
    setCapturing(false);
  }, [onSend]);

  const busy = disabled || transcribing || capturing;

  return (
    <div className="px-4 pb-4 pt-2">
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
            onClick={handleVoice}
            disabled={busy && !recording}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              recording
                ? "text-red-400 bg-red-400/10"
                : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
            } ${(busy && !recording) ? "opacity-30" : ""}`}
            title={recording ? "Stop" : "Voice"}
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
          onChange={(e) => setValue(e.target.value)}
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

        {/* Send */}
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
      </div>
      <div className="flex items-center justify-between mt-1 px-1">
        <span className="text-2xs text-blade-muted/50">
          {recording ? "Recording... click mic to stop" : "Enter to send"}
        </span>
        <kbd className="text-2xs text-blade-muted/40 font-mono">
          \u2318K
        </kbd>
      </div>
    </div>
  );
}
