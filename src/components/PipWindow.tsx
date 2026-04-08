import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface PipMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface Props {
  onExpand: () => void;
}

export function PipWindow({ onExpand }: Props) {
  const [messages, setMessages] = useState<PipMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamBuffer = useRef("");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    let active = true;

    const unlistenToken = listen<string>("chat_token", (event) => {
      if (!active) return;
      streamBuffer.current += event.payload;
      const content = streamBuffer.current;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [...prev.slice(0, -1), { ...last, content }];
        }
        return prev;
      });
    });

    const unlistenDone = listen("chat_done", () => {
      if (!active) return;
      streamBuffer.current = "";
      setLoading(false);
    });

    return () => {
      active = false;
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, []);

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: PipMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    const assistantMsg: PipMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
    };

    streamBuffer.current = "";
    setMessages((prev) => [...prev.slice(-10), userMsg, assistantMsg]);
    setInput("");
    setLoading(true);

    try {
      const allMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));
      await invoke("send_message_stream", { messages: allMessages });
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-blade-bg/95 backdrop-blur-sm text-blade-text select-none">
      {/* Drag handle + controls */}
      <div
        data-tauri-drag-region
        className="h-7 flex items-center justify-between px-2 shrink-0"
      >
        <div className="flex items-center gap-1.5" data-tauri-drag-region>
          <div className="w-1.5 h-1.5 rounded-full bg-blade-accent" />
          <span className="text-2xs text-blade-muted font-medium">PiP</span>
        </div>
        <button
          onClick={onExpand}
          className="text-blade-muted hover:text-blade-secondary text-2xs transition-colors"
          title="Expand to full window"
        >
          ↗
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-1.5 min-h-0">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-2xs text-blade-muted/40">Ask anything</p>
          </div>
        )}
        {messages.slice(-8).map((msg) => (
          <div key={msg.id} className={`text-2xs leading-relaxed ${
            msg.role === "user"
              ? "text-blade-accent/80 text-right"
              : "text-blade-secondary"
          }`}>
            {msg.content || (loading && msg.role === "assistant" ? (
              <span className="text-blade-muted animate-pulse">...</span>
            ) : null)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-2 pb-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Quick question..."
          disabled={loading}
          className="w-full bg-blade-surface border border-blade-border rounded-lg px-2 py-1 text-2xs text-blade-text outline-none placeholder:text-blade-muted/40 focus:border-blade-accent/30 transition-colors"
        />
      </div>
    </div>
  );
}
