import { useState, KeyboardEvent } from "react";

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function InputBar({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-4 py-3 border-t border-blade-border bg-blade-bg">
      <div className="flex items-end gap-2 bg-blade-surface border border-blade-border rounded-xl px-3 py-2">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask Blade anything..."
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-blade-text text-sm resize-none outline-none placeholder:text-blade-muted max-h-32 min-h-[1.5rem]"
          style={{ height: "auto" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = `${target.scrollHeight}px`;
          }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
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
