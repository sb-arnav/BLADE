import { useEffect, useRef, useState } from "react";
import { Message } from "../types";

interface FocusModeProps {
  messages: Message[];
  loading: boolean;
  onSend: (content: string) => void;
  onExit: () => void;
}

export default function FocusMode({ messages, loading, onSend, onExit }: FocusModeProps) {
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const visible = messages.slice(-20);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [visible.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onExit]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <div className="h-screen bg-blade-bg flex flex-col animate-fade-in">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-xl mx-auto px-4 py-12">
          {visible.map((msg) => (
            <div
              key={msg.id}
              className={`mb-4 text-sm ${
                msg.role === "user" ? "text-right text-blade-accent" : "text-left text-blade-light"
              }`}
            >
              {msg.content}
            </div>
          ))}
          {loading && (
            <div className="mb-4 text-sm text-left text-blade-muted">...</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="max-w-xl mx-auto w-full px-4 pb-8">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder=""
          className={`w-full bg-transparent text-sm text-blade-light outline-none pb-2 transition-colors ${
            focused ? "border-b border-blade-border/30" : "border-b border-transparent"
          }`}
          autoFocus
        />
      </div>

      <span className="fixed bottom-3 right-4 text-2xs text-blade-muted/30 select-none">
        esc
      </span>
    </div>
  );
}
