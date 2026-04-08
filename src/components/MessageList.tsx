import { Message, ToolExecution } from "../types";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  messages: Message[];
  loading: boolean;
  toolExecutions: ToolExecution[];
}

export function MessageList({ messages, loading, toolExecutions }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, toolExecutions]);

  const activeTools = toolExecutions.filter((t) => t.status === "executing");
  const recentCompleted = toolExecutions.filter(
    (t) => t.status === "completed" && t.completed_at && Date.now() - t.completed_at < 3000
  );

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-2">
          <div className="w-3 h-3 rounded-full bg-blade-accent opacity-60" />
          <p className="text-blade-muted text-sm">What are we working on?</p>
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

      {(activeTools.length > 0 || recentCompleted.length > 0) && (
        <div className="flex justify-start">
          <div className="space-y-1">
            {activeTools.map((tool) => (
              <div key={tool.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-blade-muted">
                <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                  tool.risk === "Blocked" ? "bg-red-400" : tool.risk === "Ask" ? "bg-amber-400" : "bg-green-400"
                }`} />
                <span className="font-mono">{tool.tool_name}</span>
              </div>
            ))}
            {recentCompleted.map((tool) => (
              <div key={tool.id} className="flex items-center gap-2 rounded-lg px-3 py-1 text-xs text-blade-muted opacity-60">
                <span className={tool.is_error ? "text-red-400" : "text-green-400"}>
                  {tool.is_error ? "x" : "\u2713"}
                </span>
                <span className="font-mono">{tool.tool_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && activeTools.length === 0 && recentCompleted.length === 0 && (
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
