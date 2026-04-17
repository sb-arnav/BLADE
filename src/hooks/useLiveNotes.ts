import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Live Notes — Rowboat-inspired auto-updating notes.
 *
 * A Live Note is a note that automatically refreshes its content
 * by monitoring a topic. Examples:
 * - Track a competitor's latest moves
 * - Monitor a GitHub repo for new releases
 * - Keep a running summary of a project's status
 * - Track mentions of a topic across conversations
 *
 * Each live note has a query, a refresh interval, and accumulated content.
 */

export interface LiveNote {
  id: string;
  title: string;
  query: string;          // what to search/monitor
  source: "web" | "conversations" | "knowledge" | "manual";
  content: string;        // accumulated markdown content
  lastRefreshed: number | null;
  refreshIntervalMs: number; // default: 1 hour
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  refreshCount: number;
  pinned: boolean;
}

const STORAGE_KEY = "blade-live-notes";
const MAX_NOTES = 50;

function loadNotes(): LiveNote[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveNotes(notes: LiveNote[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

const PRESETS: Array<Omit<LiveNote, "id" | "content" | "lastRefreshed" | "createdAt" | "updatedAt" | "refreshCount">> = [
  {
    title: "Industry News",
    query: "latest AI industry news and announcements",
    source: "web",
    refreshIntervalMs: 3600000, // 1 hour
    enabled: true,
    pinned: false,
  },
  {
    title: "Competitor Watch",
    query: "",
    source: "web",
    refreshIntervalMs: 7200000, // 2 hours
    enabled: false,
    pinned: false,
  },
  {
    title: "Project Summary",
    query: "summarize recent conversations and decisions about the current project",
    source: "conversations",
    refreshIntervalMs: 86400000, // daily
    enabled: true,
    pinned: true,
  },
  {
    title: "Weekly Learnings",
    query: "extract key technical learnings and insights from recent conversations",
    source: "conversations",
    refreshIntervalMs: 604800000, // weekly
    enabled: true,
    pinned: false,
  },
  {
    title: "Action Items",
    query: "find all action items, TODOs, and commitments from recent conversations",
    source: "conversations",
    refreshIntervalMs: 3600000, // hourly
    enabled: true,
    pinned: true,
  },
];

export function useLiveNotes() {
  const [notes, setNotes] = useState<LiveNote[]>(loadNotes);
  const [refreshing, setRefreshing] = useState<string | null>(null);

  const addNote = useCallback((note: Omit<LiveNote, "id" | "content" | "lastRefreshed" | "createdAt" | "updatedAt" | "refreshCount">) => {
    const newNote: LiveNote = {
      ...note,
      id: crypto.randomUUID(),
      content: "",
      lastRefreshed: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      refreshCount: 0,
    };
    setNotes((prev) => {
      const next = [...prev, newNote].slice(-MAX_NOTES);
      saveNotes(next);
      return next;
    });
    return newNote.id;
  }, []);

  const addFromPreset = useCallback((presetIndex: number, customQuery?: string) => {
    const preset = PRESETS[presetIndex];
    if (!preset) return null;
    return addNote({
      ...preset,
      query: customQuery || preset.query,
    });
  }, [addNote]);

  const updateNote = useCallback((id: string, updates: Partial<LiveNote>) => {
    setNotes((prev) => {
      const next = prev.map((n) => n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n);
      saveNotes(next);
      return next;
    });
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      saveNotes(next);
      return next;
    });
  }, []);

  const refreshNote = useCallback(async (id: string) => {
    const note = notes.find((n) => n.id === id);
    if (!note || !note.query.trim()) return;

    setRefreshing(id);

    try {
      let newContent = "";

      if (note.source === "web") {
        // Use AI to search and summarize
        // In production, this sends the query to AI for web research.
        // For now, we mark it for manual refresh via chat.
        newContent = note.content
          ? `${note.content}\n\n---\n\n**Update ${new Date().toLocaleDateString()}:**\n_Refresh triggered. Send this note's query to chat for AI-powered update._`
          : `# ${note.title}\n\n_Created ${new Date().toLocaleDateString()}. Send query to chat for first update._\n\nQuery: ${note.query}`;
      } else if (note.source === "conversations") {
        // Search through conversation history
        try {
          const results = await invoke<Array<{ content: string }>>("db_search_messages", { query: note.query });
          if (results && results.length > 0) {
            const snippets = results.slice(0, 10).map((r) => `- ${r.content.slice(0, 200)}`).join("\n");
            newContent = `# ${note.title}\n\n**Last updated:** ${new Date().toLocaleString()}\n\n## Relevant mentions:\n\n${snippets}`;
          } else {
            newContent = note.content || `# ${note.title}\n\n_No matching conversations found yet._`;
          }
        } catch {
          newContent = note.content || `# ${note.title}\n\n_Search unavailable. Content will populate as you chat._`;
        }
      } else if (note.source === "knowledge") {
        try {
          const results = await invoke<Array<{ title: string; content: string }>>("db_search_knowledge", { query: note.query });
          if (results && results.length > 0) {
            const entries = results.slice(0, 10).map((r) => `### ${r.title}\n${r.content.slice(0, 300)}`).join("\n\n");
            newContent = `# ${note.title}\n\n**Last updated:** ${new Date().toLocaleString()}\n\n${entries}`;
          } else {
            newContent = note.content || `# ${note.title}\n\n_No matching knowledge entries._`;
          }
        } catch {
          newContent = note.content || `# ${note.title}\n\n_Knowledge base unavailable._`;
        }
      }

      updateNote(id, {
        content: newContent,
        lastRefreshed: Date.now(),
        refreshCount: (note.refreshCount || 0) + 1,
      });
    } catch (e) {
      console.error("[Blade] Live note refresh failed:", e);
    }

    setRefreshing(null);
  }, [notes, updateNote]);

  const toggleEnabled = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => n.id === id ? { ...n, enabled: !n.enabled } : n);
      saveNotes(next);
      return next;
    });
  }, []);

  const togglePinned = useCallback((id: string) => {
    setNotes((prev) => {
      const next = prev.map((n) => n.id === id ? { ...n, pinned: !n.pinned } : n);
      saveNotes(next);
      return next;
    });
  }, []);

  // Sort: pinned first, then by updated
  const sortedNotes = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  return {
    notes: sortedNotes,
    refreshing,
    addNote,
    addFromPreset,
    updateNote,
    deleteNote,
    refreshNote,
    toggleEnabled,
    togglePinned,
    presets: PRESETS,
  };
}
