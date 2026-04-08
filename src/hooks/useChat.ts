import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConversationSummary, Message, StoredConversation, ToolApprovalRequest, ToolExecution } from "../types";

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
  const [pendingApproval, setPendingApproval] = useState<ToolApprovalRequest | null>(null);
  const [lastResponseTime, setLastResponseTime] = useState<number | null>(null);
  const streamBuffer = useRef("");
  const requestStartRef = useRef<number>(0);
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
    let active = true;

    const unlistenToken = listen<string>("chat_token", (event) => {
      if (!active) return;
      streamBuffer.current += event.payload;
      const content = streamBuffer.current;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, content },
          ];
        }
        return prev;
      });
    });

    const unlistenDone = listen("chat_done", () => {
      if (!active) return;
      streamBuffer.current = "";
      if (requestStartRef.current > 0) {
        setLastResponseTime(Date.now() - requestStartRef.current);
        requestStartRef.current = 0;
      }
      setLoading(false);
      setToolExecutions([]);

      // Fire-and-forget: let the backend learn from the completed conversation
      invoke("learn_from_conversation", { messages: messagesRef.current }).catch(() => {});
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

    const unlistenApproval = listen<ToolApprovalRequest>("tool_approval_needed", (event) => {
      setPendingApproval(event.payload);
    });

    const unlistenClipboard = listen<string>("clipboard_changed", (event) => {
      const text = event.payload?.trim();
      if (text && text.length > 10 && text.length < 5000) {
        setClipboardText(text);
      }
    });

    return () => {
      active = false;
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenToolExecuting.then((fn) => fn());
      unlistenToolCompleted.then((fn) => fn());
      unlistenApproval.then((fn) => fn());
      unlistenClipboard.then((fn) => fn());
    };
  }, []);

  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentConversationId || loading) {
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(() => {
      persistConversation(currentConversationId, messages).catch((cause) => {
        setError(typeof cause === "string" ? cause : String(cause));
      });
    }, 500);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [currentConversationId, loading, messages, persistConversation]);

  const sendMessage = useCallback(
    async (content: string, imageBase64?: string) => {
      const conversationId = currentConversationId ?? (await createConversation());
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        image_base64: imageBase64,
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
      requestStartRef.current = Date.now();
      setLastResponseTime(null);
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
              ...(message.image_base64 ? { image_base64: message.image_base64 } : {}),
            })),
        });
      } catch (cause) {
        setError(typeof cause === "string" ? cause : String(cause));
        setLoading(false);
      }
    },
    [createConversation, currentConversationId]
  );

  // Retry last failed message — removes empty assistant msg and resends
  const retryLastMessage = useCallback(async () => {
    const msgs = messagesRef.current;
    // Find the last user message (skip trailing empty assistant)
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return;

    const userMsg = msgs[lastUserIdx];
    // Remove the user msg and any assistant msg after it
    const cleaned = msgs.slice(0, lastUserIdx);
    setMessages(cleaned);
    messagesRef.current = cleaned;
    setError(null);

    // Resend
    await sendMessage(userMsg.content, userMsg.image_base64);
  }, [sendMessage]);

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

  const respondToApproval = useCallback(async (approved: boolean) => {
    if (!pendingApproval) return;
    try {
      await invoke("respond_tool_approval", {
        approvalId: pendingApproval.approval_id,
        approved,
      });
    } catch {
      // Backend may have timed out already
    }
    setPendingApproval(null);
  }, [pendingApproval]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await invoke("history_delete_conversation", { conversationId });
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));
      if (conversationId === currentConversationId) {
        await createConversation();
      }
    } catch (cause) {
      setError(typeof cause === "string" ? cause : String(cause));
    }
  }, [currentConversationId, createConversation]);

  return {
    messages,
    loading,
    error,
    toolExecutions,
    clipboardText,
    dismissClipboard,
    pendingApproval,
    respondToApproval,
    deleteConversation,
    conversations,
    currentConversationId,
    currentConversation,
    lastResponseTime,
    sendMessage,
    retryLastMessage,
    clearMessages,
    newConversation,
    switchConversation,
  };
}
