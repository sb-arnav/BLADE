import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConversationSummary, Message, StoredConversation, ToolExecution } from "../types";

function sortConversations(items: ConversationSummary[]) {
  return [...items].sort((a, b) => b.updated_at - a.updated_at);
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([]);
  const [clipboardText, setClipboardText] = useState<string | null>(null);
  const streamBuffer = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const persistConversation = useCallback(
    async (conversationId: string, nextMessages: Message[]) => {
      const summary = await invoke<ConversationSummary>("history_save_conversation", {
        conversationId,
        messages: nextMessages,
      });

      setConversations((prev) => {
        const withoutCurrent = prev.filter((item) => item.id !== summary.id);
        return sortConversations([summary, ...withoutCurrent]);
      });
    },
    []
  );

  const loadConversation = useCallback(async (conversationId: string) => {
    const conversation = await invoke<StoredConversation>("history_load_conversation", {
      conversationId,
    });
    setCurrentConversationId(conversation.id);
    setMessages(conversation.messages);
  }, []);

  const createConversation = useCallback(async () => {
    const conversationId = crypto.randomUUID();
    setCurrentConversationId(conversationId);
    setMessages([]);
    await persistConversation(conversationId, []);
    return conversationId;
  }, [persistConversation]);

  useEffect(() => {
    if (bootstrappedRef.current) {
      return;
    }
    bootstrappedRef.current = true;

    const bootstrap = async () => {
      const items = await invoke<ConversationSummary[]>("history_list_conversations");
      const sorted = sortConversations(items);
      setConversations(sorted);

      if (sorted.length > 0) {
        await loadConversation(sorted[0].id);
        return;
      }

      await createConversation();
    };

    bootstrap().catch((cause) => {
      setError(typeof cause === "string" ? cause : String(cause));
    });
  }, [createConversation, loadConversation]);

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
      setToolExecutions([]);
    });

    const unlistenToolExecuting = listen<{ name: string; risk: string }>("tool_executing", (event) => {
      const execution: ToolExecution = {
        id: crypto.randomUUID(),
        tool_name: event.payload.name,
        risk: (event.payload.risk as ToolExecution["risk"]) ?? "Ask",
        status: "executing",
        started_at: Date.now(),
      };
      setToolExecutions((prev) => [...prev, execution]);
    });

    const unlistenToolCompleted = listen<{ name: string; is_error: boolean }>("tool_completed", (event) => {
      setToolExecutions((prev) =>
        prev.map((ex) =>
          ex.tool_name === event.payload.name && ex.status === "executing"
            ? { ...ex, status: "completed" as const, is_error: event.payload.is_error, completed_at: Date.now() }
            : ex
        )
      );
    });

    const unlistenClipboard = listen<string>("clipboard_changed", (event) => {
      const text = event.payload?.trim();
      if (text && text.length > 10 && text.length < 5000) {
        setClipboardText(text);
      }
    });

    return () => {
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenToolExecuting.then((fn) => fn());
      unlistenToolCompleted.then((fn) => fn());
      unlistenClipboard.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!currentConversationId || loading) {
      return;
    }

    persistConversation(currentConversationId, messages).catch((cause) => {
      setError(typeof cause === "string" ? cause : String(cause));
    });
  }, [currentConversationId, loading, messages, persistConversation]);

  const sendMessage = useCallback(
    async (content: string) => {
      const conversationId = currentConversationId ?? (await createConversation());
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

      const nextMessages = [...messagesRef.current, userMsg, assistantMsg];

      streamBuffer.current = "";
      setMessages(nextMessages);
      setCurrentConversationId(conversationId);
      setLoading(true);
      setError(null);

      try {
        await invoke("send_message_stream", {
          messages: nextMessages
            .filter((message) => message.role === "user" || message.role === "assistant")
            .map((message) => ({
              role: message.role,
              content: message.content,
            })),
        });
      } catch (cause) {
        setError(typeof cause === "string" ? cause : String(cause));
        setLoading(false);
      }
    },
    [createConversation, currentConversationId]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  const newConversation = useCallback(async () => {
    setError(null);
    await createConversation();
  }, [createConversation]);

  const switchConversation = useCallback(
    async (conversationId: string) => {
      if (loading || conversationId === currentConversationId) {
        return;
      }

      setError(null);
      await loadConversation(conversationId);
    },
    [currentConversationId, loadConversation, loading]
  );

  const currentConversation = useMemo(
    () => conversations.find((item) => item.id === currentConversationId) ?? null,
    [conversations, currentConversationId]
  );

  const dismissClipboard = useCallback(() => setClipboardText(null), []);

  return {
    messages,
    loading,
    error,
    toolExecutions,
    clipboardText,
    dismissClipboard,
    conversations,
    currentConversationId,
    currentConversation,
    sendMessage,
    clearMessages,
    newConversation,
    switchConversation,
  };
}
