import { useState, useCallback, useMemo, useEffect, useRef } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChatSpace {
  id: string;
  name: string;
  icon: string;
  description: string;
  type: "general" | "code" | "research" | "creative" | "data" | "ops" | "custom";
  systemPrompt: string;
  pinnedContext: string[];
  model?: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessageAt: number | null;
  color: string;
  archived: boolean;
}

export interface SpaceMessage {
  id: string;
  spaceId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface SpaceOrder {
  ids: string[];
}

// ── Storage keys ──────────────────────────────────────────────────────────────

const SPACES_KEY = "blade-spaces";
const MESSAGES_KEY = "blade-spaces-messages";
const ORDER_KEY = "blade-spaces-order";
const ACTIVE_KEY = "blade-spaces-active";
const UNREAD_KEY = "blade-spaces-unread";

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── System prompts ────────────────────────────────────────────────────────────

const CODE_SYSTEM_PROMPT = [
  "You are an expert software engineer. Focus on clean, production-ready code.",
  "Always consider edge cases, error handling, and performance.",
  "Prefer concise explanations with code examples. Use markdown code blocks with language tags.",
  "When reviewing code, check for bugs, security issues, and style consistency.",
].join("\n");

const RESEARCH_SYSTEM_PROMPT = [
  "You are a meticulous research analyst. Provide thorough, well-sourced analysis.",
  "Structure findings with clear headings, bullet points, and evidence.",
  "When uncertain, state confidence levels. Distinguish facts from speculation.",
  "Summarize key findings first, then provide detailed breakdown.",
].join("\n");

const WRITING_SYSTEM_PROMPT = [
  "You are a skilled writing partner — editor, ghostwriter, and creative collaborator.",
  "Adapt your tone to the piece: formal for reports, conversational for blogs, vivid for fiction.",
  "Offer structural feedback first, then line-level edits. Preserve the author's voice.",
  "When drafting, produce complete sections rather than outlines unless asked otherwise.",
].join("\n");

const DATA_SYSTEM_PROMPT = [
  "You are a data analysis expert. Write clean SQL, Python (pandas/numpy), and R.",
  "Always validate assumptions about data shape and types before querying.",
  "Present results with appropriate visualizations described in markdown.",
  "Explain statistical methods in plain language alongside technical output.",
].join("\n");

const OPS_SYSTEM_PROMPT = [
  "You are a senior DevOps / SRE engineer. Prioritize reliability and security.",
  "Provide infrastructure-as-code snippets (Terraform, Docker, k8s YAML).",
  "Always flag potential cost implications and blast radius of changes.",
  "Include rollback strategies when suggesting deployments or migrations.",
].join("\n");

// ── Default spaces ────────────────────────────────────────────────────────────

function createDefaultSpaces(): ChatSpace[] {
  const now = Date.now();
  return [
    {
      id: "space-general",
      name: "General",
      icon: "\u{1F4AC}",
      description: "Default catch-all space for any topic",
      type: "general",
      systemPrompt: "",
      pinnedContext: [],
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: null,
      color: "#71717a",
      archived: false,
    },
    {
      id: "space-code",
      name: "Code",
      icon: "\u{1F4BB}",
      description: "Coding, debugging, and code reviews",
      type: "code",
      systemPrompt: CODE_SYSTEM_PROMPT,
      pinnedContext: [],
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: null,
      color: "#3b82f6",
      archived: false,
    },
    {
      id: "space-research",
      name: "Research",
      icon: "\u{1F52C}",
      description: "Deep analysis, web search, and investigation",
      type: "research",
      systemPrompt: RESEARCH_SYSTEM_PROMPT,
      pinnedContext: [],
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: null,
      color: "#8b5cf6",
      archived: false,
    },
    {
      id: "space-writing",
      name: "Writing",
      icon: "\u{270D}\u{FE0F}",
      description: "Drafts, editing, and creative writing",
      type: "creative",
      systemPrompt: WRITING_SYSTEM_PROMPT,
      pinnedContext: [],
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: null,
      color: "#f59e0b",
      archived: false,
    },
    {
      id: "space-data",
      name: "Data",
      icon: "\u{1F4CA}",
      description: "SQL, analysis, and data visualization",
      type: "data",
      systemPrompt: DATA_SYSTEM_PROMPT,
      pinnedContext: [],
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: null,
      color: "#10b981",
      archived: false,
    },
    {
      id: "space-ops",
      name: "Ops",
      icon: "\u{1F527}",
      description: "DevOps, deployment, and infrastructure",
      type: "ops",
      systemPrompt: OPS_SYSTEM_PROMPT,
      pinnedContext: [],
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      lastMessageAt: null,
      color: "#ef4444",
      archived: false,
    },
  ];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChatSpaces() {
  const [spaces, setSpaces] = useState<ChatSpace[]>(() => {
    const stored = loadJson<ChatSpace[]>(SPACES_KEY, []);
    return stored.length > 0 ? stored : createDefaultSpaces();
  });

  const [order, setOrder] = useState<string[]>(() => {
    const stored = loadJson<SpaceOrder>(ORDER_KEY, { ids: [] });
    if (stored.ids.length > 0) return stored.ids;
    return createDefaultSpaces().map((s) => s.id);
  });

  const [activeSpaceId, setActiveSpaceId] = useState<string>(() => {
    return loadJson<string>(ACTIVE_KEY, "space-general");
  });

  const [messages, setMessages] = useState<Record<string, SpaceMessage[]>>(() => {
    return loadJson<Record<string, SpaceMessage[]>>(MESSAGES_KEY, {});
  });

  const [unread, setUnread] = useState<Record<string, boolean>>(() => {
    return loadJson<Record<string, boolean>>(UNREAD_KEY, {});
  });

  const bootstrappedRef = useRef(false);

  // ── Persist on change ───────────────────────────────────────────────────────

  useEffect(() => {
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      return;
    }
    saveJson(SPACES_KEY, spaces);
  }, [spaces]);

  useEffect(() => {
    saveJson(ORDER_KEY, { ids: order });
  }, [order]);

  useEffect(() => {
    saveJson(ACTIVE_KEY, activeSpaceId);
  }, [activeSpaceId]);

  useEffect(() => {
    saveJson(MESSAGES_KEY, messages);
  }, [messages]);

  useEffect(() => {
    saveJson(UNREAD_KEY, unread);
  }, [unread]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const activeSpace = useMemo(() => {
    return spaces.find((s) => s.id === activeSpaceId) ?? spaces[0] ?? null;
  }, [spaces, activeSpaceId]);

  const orderedSpaces = useMemo(() => {
    const map = new Map(spaces.map((s) => [s.id, s]));
    const sorted: ChatSpace[] = [];
    for (const id of order) {
      const space = map.get(id);
      if (space) sorted.push(space);
    }
    // Append any spaces not in order (newly created)
    for (const s of spaces) {
      if (!order.includes(s.id)) sorted.push(s);
    }
    return sorted;
  }, [spaces, order]);

  // ── Actions ─────────────────────────────────────────────────────────────────

  const createSpace = useCallback(
    (partial: {
      name: string;
      icon: string;
      description: string;
      type: ChatSpace["type"];
      systemPrompt?: string;
      model?: string;
      provider?: string;
      color?: string;
    }): ChatSpace => {
      const now = Date.now();
      const space: ChatSpace = {
        id: `space-${crypto.randomUUID()}`,
        name: partial.name,
        icon: partial.icon,
        description: partial.description,
        type: partial.type,
        systemPrompt: partial.systemPrompt ?? "",
        pinnedContext: [],
        model: partial.model,
        provider: partial.provider,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        lastMessageAt: null,
        color: partial.color ?? "#71717a",
        archived: false,
      };
      setSpaces((prev) => [...prev, space]);
      setOrder((prev) => [...prev, space.id]);
      return space;
    },
    []
  );

  const updateSpace = useCallback(
    (spaceId: string, updates: Partial<Omit<ChatSpace, "id" | "createdAt">>) => {
      setSpaces((prev) =>
        prev.map((s) =>
          s.id === spaceId ? { ...s, ...updates, updatedAt: Date.now() } : s
        )
      );
    },
    []
  );

  const deleteSpace = useCallback(
    (spaceId: string) => {
      // Prevent deleting the last space
      setSpaces((prev) => {
        if (prev.length <= 1) return prev;
        return prev.filter((s) => s.id !== spaceId);
      });
      setOrder((prev) => prev.filter((id) => id !== spaceId));
      setMessages((prev) => {
        const next = { ...prev };
        delete next[spaceId];
        return next;
      });
      // Switch away if we deleted the active space
      if (activeSpaceId === spaceId) {
        const remaining = spaces.filter((s) => s.id !== spaceId);
        if (remaining.length > 0) setActiveSpaceId(remaining[0].id);
      }
    },
    [activeSpaceId, spaces]
  );

  const archiveSpace = useCallback((spaceId: string) => {
    setSpaces((prev) =>
      prev.map((s) =>
        s.id === spaceId ? { ...s, archived: !s.archived, updatedAt: Date.now() } : s
      )
    );
  }, []);

  const switchSpace = useCallback(
    (spaceId: string) => {
      setActiveSpaceId(spaceId);
      setUnread((prev) => {
        const next = { ...prev };
        delete next[spaceId];
        return next;
      });
    },
    []
  );

  const reorderSpaces = useCallback((newOrder: string[]) => {
    setOrder(newOrder);
  }, []);

  const getSpaceMessages = useCallback(
    (spaceId: string): SpaceMessage[] => {
      return messages[spaceId] ?? [];
    },
    [messages]
  );

  const addMessage = useCallback(
    (spaceId: string, role: SpaceMessage["role"], content: string) => {
      const msg: SpaceMessage = {
        id: crypto.randomUUID(),
        spaceId,
        role,
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => ({
        ...prev,
        [spaceId]: [...(prev[spaceId] ?? []), msg],
      }));
      // Update space counters
      setSpaces((prev) =>
        prev.map((s) =>
          s.id === spaceId
            ? { ...s, messageCount: s.messageCount + 1, lastMessageAt: msg.timestamp, updatedAt: msg.timestamp }
            : s
        )
      );
      // Mark unread if not the active space
      if (spaceId !== activeSpaceId) {
        setUnread((prev) => ({ ...prev, [spaceId]: true }));
      }
      return msg;
    },
    [activeSpaceId]
  );

  const clearSpaceMessages = useCallback((spaceId: string) => {
    setMessages((prev) => ({ ...prev, [spaceId]: [] }));
    setSpaces((prev) =>
      prev.map((s) =>
        s.id === spaceId
          ? { ...s, messageCount: 0, lastMessageAt: null, updatedAt: Date.now() }
          : s
      )
    );
  }, []);

  const pinContext = useCallback((spaceId: string, context: string) => {
    setSpaces((prev) =>
      prev.map((s) => {
        if (s.id !== spaceId) return s;
        if (s.pinnedContext.includes(context)) return s;
        return { ...s, pinnedContext: [...s.pinnedContext, context], updatedAt: Date.now() };
      })
    );
  }, []);

  const unpinContext = useCallback((spaceId: string, context: string) => {
    setSpaces((prev) =>
      prev.map((s) => {
        if (s.id !== spaceId) return s;
        return {
          ...s,
          pinnedContext: s.pinnedContext.filter((c) => c !== context),
          updatedAt: Date.now(),
        };
      })
    );
  }, []);

  const getEffectiveSystemPrompt = useCallback(
    (spaceId: string): string => {
      const space = spaces.find((s) => s.id === spaceId);
      if (!space) return "";
      const parts: string[] = [];
      if (space.systemPrompt) parts.push(space.systemPrompt);
      if (space.pinnedContext.length > 0) {
        parts.push("--- Pinned Context ---");
        space.pinnedContext.forEach((ctx, i) => {
          parts.push(`[${i + 1}] ${ctx}`);
        });
      }
      return parts.join("\n\n");
    },
    [spaces]
  );

  const duplicateSpace = useCallback(
    (spaceId: string): ChatSpace | null => {
      const source = spaces.find((s) => s.id === spaceId);
      if (!source) return null;
      return createSpace({
        name: `${source.name} (Copy)`,
        icon: source.icon,
        description: source.description,
        type: source.type,
        systemPrompt: source.systemPrompt,
        model: source.model,
        provider: source.provider,
        color: source.color,
      });
    },
    [spaces, createSpace]
  );

  return {
    spaces: orderedSpaces,
    activeSpace,
    activeSpaceId,
    unread,
    createSpace,
    updateSpace,
    deleteSpace,
    archiveSpace,
    switchSpace,
    reorderSpaces,
    getSpaceMessages,
    addMessage,
    clearSpaceMessages,
    pinContext,
    unpinContext,
    getEffectiveSystemPrompt,
    duplicateSpace,
  };
}
