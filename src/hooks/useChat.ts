import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Message } from "../types";

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamBuffer = useRef("");

  useEffect(() => {
    const unlistenToken = listen<string>("chat_token", (event) => {
      streamBuffer.current += event.payload;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: streamBuffer.current },
          ];
        }
        return prev;
      });
    });

    const unlistenDone = listen("chat_done", () => {
      streamBuffer.current = "";
      setLoading(false);
    });

    return () => {
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: Date.now(),
      };

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };

      streamBuffer.current = "";
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setLoading(true);
      setError(null);

      try {
        const allMessages = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        }));

        await invoke("send_message_stream", { messages: allMessages });
      } catch (e) {
        setError(typeof e === "string" ? e : String(e));
        setLoading(false);
      }
    },
    [messages]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { messages, loading, error, sendMessage, clearMessages };
}
