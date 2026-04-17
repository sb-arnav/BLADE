import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ConversationSummary, Message, StoredConversation, ToolApprovalRequest, ToolExecution } from "../types";

// Warn the user if their message exceeds this character count (~25k tokens).
const MAX_INPUT_CHARS = 100_000;

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
  const [thinkingText, setThinkingText] = useState<string | null>(null);
  const [ackText, setAckText] = useState<string | null>(null);
  const streamBuffer = useRef("");
  const streamRequestId = useRef<string>("");
  const requestStartRef = useRef<number>(0);
  const messagesRef = useRef<Message[]>([]);
  const bootstrappedRef = useRef(false);
  const currentConversationIdRef = useRef<string | null>(null);
  // True if we've shown a fast-ack but the real stream hasn't started yet.
  const awaitingRealStream = useRef(false);
  // Holds the handle for the 120-second safety timeout so chat_done can clear it.
  const safetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    currentConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

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
    // Reset transient state so it doesn't bleed across conversations
    setToolExecutions([]);
    setError(null);
    setPendingApproval(null);
    setThinkingText(null);
  }, []);

  const createConversation = useCallback(async () => {
    const conversationId = crypto.randomUUID();
    setCurrentConversationId(conversationId);
    setMessages([]);
    // Reset transient state for the new conversation
    setToolExecutions([]);
    setError(null);
    setPendingApproval(null);
    setThinkingText(null);
    // Persist immediately — but don't let a DB failure block the UI from showing the
    // new conversation.  The debounced persist will retry on the next message anyway.
    try {
      await persistConversation(conversationId, []);
    } catch {
      // Non-fatal: the conversation is live in memory; the next chat_done will re-save it.
    }
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
      // Reset the guard so a subsequent mount (e.g. hot-reload, Strict Mode double-invoke)
      // can attempt bootstrap again rather than silently doing nothing.
      bootstrappedRef.current = false;
      setError(typeof cause === "string" ? cause : String(cause));
    });
  }, [createConversation, loadConversation]);

  useEffect(() => {
    let active = true;
    // thinkingTimeout must be tracked locally so it can be cleaned up on unmount
    let thinkingTimeout: ReturnType<typeof setTimeout> | null = null;

    // Fast acknowledgment — emitted by the cheap/fast model before the real stream starts.
    const unlistenAck = listen<string>("chat_ack", (event) => {
      if (!active) return;
      // Guard: ignore stale acks that arrive after a new request has started.
      // Snapshot the request ID at emit time — if it's blank or mismatched, discard.
      const myRequestId = streamRequestId.current;
      if (!myRequestId) return;

      // Only show if the stream hasn't already produced real tokens.
      if (streamBuffer.current.length > 0) return;
      awaitingRealStream.current = true;
      setAckText(event.payload);
      // Render the ack in the assistant bubble (italicised via ackText state)
      setMessages((prev) => {
        // Double-check: if request was superseded while waiting for setState, bail out.
        if (streamRequestId.current !== myRequestId) return prev;
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: event.payload, isAck: true },
          ];
        }
        return prev;
      });
    });

    const unlistenToken = listen<string>("chat_token", (event) => {
      if (!active) return;
      // Guard: snapshot the current request ID at the moment this token arrives.
      // If it has changed (a new request started), discard the token entirely so
      // the new request's buffer is never contaminated by stale stream data.
      const myRequestId = streamRequestId.current;
      if (!myRequestId) return; // no active request — discard

      // If this is the first real token after a fast-ack, clear the ack display.
      // IMPORTANT: only do this if the token actually belongs to the CURRENT request.
      // Without this check a stale ack token could wipe the buffer for the new request.
      if (awaitingRealStream.current && streamRequestId.current === myRequestId) {
        awaitingRealStream.current = false;
        setAckText(null);
        // Do NOT clear the buffer here — sendMessage already zeroed it when the
        // request started.  Wiping it again would drop any tokens that beat the ack.
      }

      // Discard entirely if this token belongs to a stale (superseded) request.
      if (streamRequestId.current !== myRequestId) return;

      streamBuffer.current += event.payload;
      const content = streamBuffer.current;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return [
            ...prev.slice(0, -1),
            { ...last, content, isAck: false },
          ];
        }
        return prev;
      });
    });

    const unlistenDone = listen("chat_done", () => {
      if (!active) return;
      // Clear the safety timer — chat completed normally
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      const assembledBuffer = streamBuffer.current;
      streamBuffer.current = "";
      // Retire this request's ID so late-arriving tokens from a stale response
      // (race condition: token arrives after done fires) get dropped
      streamRequestId.current = "";
      awaitingRealStream.current = false;
      setAckText(null);
      if (requestStartRef.current > 0) {
        setLastResponseTime(Date.now() - requestStartRef.current);
        requestStartRef.current = 0;
      }
      setLoading(false);
      setToolExecutions([]);
      setThinkingText(null);

      // If the backend sent zero tokens (empty response), replace the empty
      // assistant bubble with a placeholder so the user never sees a blank message.
      if (!assembledBuffer) {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && (!last.content || last.isAck)) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: "...", isAck: false },
            ];
          }
          return prev;
        });
      }

      // Persist the conversation immediately after every chat completes.
      // We patch the last assistant message with assembledBuffer before saving so
      // that the save isn't racing against React's state flush of the final token.
      // Cancel the debounced persist so it doesn't fire a redundant second save.
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      const convId = currentConversationIdRef.current;
      const msgs = messagesRef.current;
      if (convId && msgs.length > 0) {
        // Ensure the saved copy always has the definitive assistant text.
        const msgsToSave = assembledBuffer
          ? msgs.map((m, i) =>
              i === msgs.length - 1 && m.role === "assistant"
                ? { ...m, content: assembledBuffer, isAck: false }
                : m
            )
          : msgs;
        invoke("history_save_conversation", { conversationId: convId, messages: msgsToSave }).catch(() => {});

        // Record streak activity — every completed chat counts toward the streak
        invoke("streak_record_activity").catch(() => {});

        // Fire-and-forget: let the backend learn from the completed conversation
        invoke("learn_from_conversation", { messages: msgsToSave }).catch(() => {});

        // Let the people graph learn who was mentioned in this conversation
        invoke("people_learn_from_conversation", { messages: msgsToSave }).catch(() => {});

        // Background entity extraction + full exchange embedding — use assembled text
        const lastUser = [...msgsToSave].reverse().find((m) => m.role === "user");
        const lastAssistant = assembledBuffer ||
          ([...msgsToSave].reverse().find((m) => m.role === "assistant")?.content ?? "");
        if (lastUser && lastAssistant) {
          invoke("brain_extract_from_exchange", {
            userText: lastUser.content,
            assistantText: lastAssistant,
          }).catch(() => {});
          // Auto-update working thread for streaming path (tool loop path does this in Rust)
          invoke("blade_thread_auto_update", {
            userText: lastUser.content,
            assistantText: lastAssistant,
          }).catch(() => {});
          // Auto-title after the FIRST exchange (2 messages: user + assistant)
          const convId2 = currentConversationIdRef.current;
          if (msgsToSave.length === 2 && convId2) {
            invoke("auto_title_conversation", {
              conversationId: convId2,
              userText: lastUser.content,
              assistantText: lastAssistant,
            }).catch(() => {});
          }
        }
      }
    });

    // Voice → Chat unification: when the user speaks a command via voice,
    // add it to the chat messages so voice and typing share the same history.
    // The response arrives via chat_token (same as typed messages) because
    // voice now routes through send_message_stream.
    const unlistenVoiceUser = listen<{ content: string }>("voice_user_message", (event) => {
      if (!active) return;
      const voiceMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: event.payload.content,
        timestamp: Date.now(),
        isVoice: true,
      };
      setMessages((prev) => {
        const next = [...prev, voiceMsg];
        messagesRef.current = next;
        return next;
      });
      // Also add an empty assistant message placeholder for the streaming response
      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      setMessages((prev) => {
        const next = [...prev, assistantMsg];
        messagesRef.current = next;
        return next;
      });
      setLoading(true);
      streamBuffer.current = "";
      streamRequestId.current = crypto.randomUUID();
    });

    const unlistenToolExecuting = listen<{ name: string; arguments?: unknown; risk: string }>("tool_executing", (event) => {
      if (!active) return;
      // arguments arrives as a JSON Value (object) from Rust, not a string — normalize it
      const rawArgs = event.payload.arguments;
      const argsStr = rawArgs == null
        ? undefined
        : typeof rawArgs === "string"
          ? rawArgs
          : JSON.stringify(rawArgs);
      const execution: ToolExecution = {
        id: crypto.randomUUID(),
        tool_name: event.payload.name,
        arguments: argsStr,
        risk: (event.payload.risk as ToolExecution["risk"]) ?? "Ask",
        status: "executing",
        started_at: Date.now(),
      };
      setToolExecutions((prev) => [...prev, execution]);
    });

    const unlistenToolCompleted = listen<{ name: string; is_error: boolean; result?: string }>("tool_completed", (event) => {
      if (!active) return;
      setToolExecutions((prev) => {
        // Match the LAST (most recently started) executing tool with this name.
        // This handles parallel tools with the same name correctly — each completion
        // updates the tool that was started most recently.
        let lastIdx = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].tool_name === event.payload.name && prev[i].status === "executing") {
            lastIdx = i;
            break;
          }
        }
        if (lastIdx === -1) return prev;
        return prev.map((ex, i) =>
          i === lastIdx
            ? { ...ex, status: "completed" as const, is_error: event.payload.is_error, result: event.payload.result, completed_at: Date.now() }
            : ex
        );
      });
    });

    const unlistenApproval = listen<Omit<ToolApprovalRequest, "arguments"> & { arguments: unknown }>("tool_approval_needed", (event) => {
      if (!active) return;
      const rawArgs = event.payload.arguments;
      const argsStr = rawArgs == null
        ? "{}"
        : typeof rawArgs === "string"
          ? rawArgs
          : JSON.stringify(rawArgs);
      setPendingApproval({ ...event.payload, arguments: argsStr });
    });

    // Extended thinking events from Anthropic
    const thinkingBuffer = { current: "" };

    const resetThinkingBuffer = () => {
      thinkingBuffer.current = "";
      setThinkingText(null);
      if (thinkingTimeout) { clearTimeout(thinkingTimeout); thinkingTimeout = null; }
    };

    const unlistenThinking = listen<string>("chat_thinking", (event) => {
      if (!active) return;
      thinkingBuffer.current += event.payload;
      setThinkingText(thinkingBuffer.current);
      // Auto-reset after 60s of no new tokens (guards against lost chat_thinking_done)
      if (thinkingTimeout) clearTimeout(thinkingTimeout);
      thinkingTimeout = setTimeout(resetThinkingBuffer, 60_000);
    });
    const unlistenThinkingDone = listen("chat_thinking_done", () => {
      if (!active) return;
      resetThinkingBuffer();
    });

    const unlistenClipboard = listen<string>("clipboard_changed", (event) => {
      const text = event.payload?.trim();
      if (text && text.length > 10 && text.length < 5000) {
        setClipboardText(text);
      }
    });

    // Listen for self-critique improvements
    const unlistenImproved = listen<{ improved: string }>("response_improved", (event) => {
      if (!active) return;
      setMessages(prev => {
        const updated = [...prev];
        // Find last assistant message and replace its content
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i].role === "assistant") {
            updated[i] = {
              ...updated[i],
              content: event.payload.improved,
              refined: true,
            };
            break;
          }
        }
        return updated;
      });
    });

    return () => {
      active = false;
      // Clear any pending timers so they don't fire against unmounted state
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      if (thinkingTimeout) {
        clearTimeout(thinkingTimeout);
        thinkingTimeout = null;
      }
      unlistenAck.then((fn) => fn());
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
      unlistenThinking.then((fn) => fn());
      unlistenThinkingDone.then((fn) => fn());
      unlistenToolExecuting.then((fn) => fn());
      unlistenToolCompleted.then((fn) => fn());
      unlistenVoiceUser.then((fn) => fn());
      unlistenApproval.then((fn) => fn());
      unlistenClipboard.then((fn) => fn());
      unlistenImproved.then((fn) => fn());
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
      if (!content?.trim() && !imageBase64) return;

      // Warn on excessively long messages — context window limits will cause backend errors.
      if (content.length > MAX_INPUT_CHARS) {
        setError(
          `Message is too long (${content.length.toLocaleString()} characters). Please shorten it to under ${MAX_INPUT_CHARS.toLocaleString()} characters.`
        );
        return;
      }

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

      // Cancel any in-flight safety timer from a previous request before starting a new one
      if (safetyTimerRef.current) {
        clearTimeout(safetyTimerRef.current);
        safetyTimerRef.current = null;
      }
      streamBuffer.current = "";
      // Assign a fresh request ID — the token handler captures this immediately so stale
      // tokens arriving after a new request starts will be discarded (the guard below).
      const thisRequestId = crypto.randomUUID();
      streamRequestId.current = thisRequestId;
      requestStartRef.current = Date.now();
      awaitingRealStream.current = false;
      setAckText(null);
      setThinkingText(null);
      setLastResponseTime(null);
      setMessages(nextMessages);
      setCurrentConversationId(conversationId);
      setLoading(true);
      setError(null);

      // Safety timeout: if no chat_done arrives within 120s, unstick loading.
      // This prevents the UI from being permanently locked if the backend dies mid-stream.
      safetyTimerRef.current = setTimeout(() => {
        // Only fire if this same request is still active (not superseded by a newer one)
        if (streamRequestId.current === thisRequestId) {
          // Replace the empty OR partial assistant bubble with a visible error.
          // A partial response that's forever frozen is just as bad as an empty one.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              const suffix = last.content ? "\n\n*(timed out — response may be incomplete)*" : "Request timed out — no response received.";
              return [
                ...prev.slice(0, -1),
                { ...last, content: (last.content || "") + suffix, isAck: false },
              ];
            }
            return prev;
          });
          streamBuffer.current = "";
          streamRequestId.current = "";
          awaitingRealStream.current = false;
          setAckText(null);
          safetyTimerRef.current = null;
          setLoading(false);
          setToolExecutions([]);
          setThinkingText(null);
          setError("Request timed out — no response received. Check your API key and model in Settings.");
        }
      }, 120_000);

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
        if (safetyTimerRef.current) {
          clearTimeout(safetyTimerRef.current);
          safetyTimerRef.current = null;
        }
        streamBuffer.current = "";
        streamRequestId.current = "";
        awaitingRealStream.current = false;
        setAckText(null);
        setToolExecutions([]);
        setThinkingText(null);
        const errorMsg = typeof cause === "string" ? cause : String(cause);
        // Replace the assistant bubble (whether empty or partially streamed) with the
        // error text so the conversation stays readable and the user understands what happened.
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return [
              ...prev.slice(0, -1),
              { ...last, content: `Error: ${errorMsg}`, isAck: false },
            ];
          }
          return prev;
        });
        setError(errorMsg);
        setLoading(false);
      }
    },
    [createConversation, currentConversationId]
  );

  // Retry last failed message — removes empty assistant msg and resends
  const retryLastMessage = useCallback(async () => {
    const msgs = messagesRef.current;
    // Find the last user message (skip trailing empty/error assistant)
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

  const updateConversationTitle = useCallback((id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c))
    );
  }, []);

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
    thinkingText,
    ackText,
    sendMessage,
    retryLastMessage,
    clearMessages,
    newConversation,
    switchConversation,
    updateConversationTitle,
  };
}
