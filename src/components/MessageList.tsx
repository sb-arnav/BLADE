import { Message } from "../types";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  messages: Message[];
  loading: boolean;
}

export function MessageList({ messages, loading }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex items-center justify-center h-full">
          <p className="text-blade-muted text-sm">Blade is ready.</p>
        </div>
      )}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-blade-accent text-white"
                : "bg-blade-surface text-blade-text border border-blade-border"
            }`}
          >
            <div className={`message-markdown ${msg.role === "user" ? "message-markdown-user" : ""}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
            </div>
          </div>
        </div>
      ))}
      {loading && (
        <div className="flex justify-start">
          <div className="bg-blade-surface border border-blade-border rounded-xl px-4 py-2.5">
            <div className="flex space-x-1">
              <div className="w-1.5 h-1.5 bg-blade-muted rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 bg-blade-muted rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-1.5 h-1.5 bg-blade-muted rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
