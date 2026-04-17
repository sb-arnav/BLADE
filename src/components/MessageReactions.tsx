import React, { useState, useCallback, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { addReaction as brainAddReaction } from "../data/characterBible";

const STORAGE_KEY = "blade-reactions";

type ReactionsMap = Record<string, string[]>;

function readReactions(): ReactionsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeReactions(map: ReactionsMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event("blade-reactions-change"));
}

// External store so every consumer stays in sync
let snapshotCache = readReactions();

function subscribe(cb: () => void) {
  const handler = () => {
    snapshotCache = readReactions();
    cb();
  };
  window.addEventListener("blade-reactions-change", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("blade-reactions-change", handler);
    window.removeEventListener("storage", handler);
  };
}

function getSnapshot(): ReactionsMap {
  return snapshotCache;
}

// ── Hook ────────────────────────────────────────────────────────────────

export function useReactions() {
  const reactions = useSyncExternalStore(subscribe, getSnapshot);

  const getReactions = useCallback(
    (messageId: string): string[] => reactions[messageId] ?? [],
    [reactions],
  );

  const toggleReaction = useCallback((messageId: string, emoji: string) => {
    const map = readReactions();
    const current = map[messageId] ?? [];
    const idx = current.indexOf(emoji);
    if (idx === -1) {
      map[messageId] = [...current, emoji];
    } else {
      map[messageId] = current.filter((e) => e !== emoji);
      if (map[messageId].length === 0) delete map[messageId];
    }
    writeReactions(map);
  }, []);

  const pinnedMessages: string[] = Object.entries(reactions)
    .filter(([, emojis]) => emojis.includes("\u{1F4CC}"))
    .map(([id]) => id);

  return { getReactions, toggleReaction, pinnedMessages };
}

// ── Component ───────────────────────────────────────────────────────────

const REACTIONS = [
  { emoji: "\u{1F44D}", label: "Good" },
  { emoji: "\u{1F44E}", label: "Bad" },
  { emoji: "\u{1F4CC}", label: "Pin" },
] as const;

export default function MessageReactions({
  messageId,
  messageContent,
  visible,
  onThumbsUp,
}: {
  messageId: string;
  messageContent?: string;
  visible: boolean;
  onThumbsUp?: (e: React.MouseEvent) => void;
}) {
  const { getReactions, toggleReaction } = useReactions();
  const active = getReactions(messageId);
  const [hovered, setHovered] = useState(false);
  const [justReacted, setJustReacted] = useState<string | null>(null);

  const show = visible || hovered;

  const handleReaction = useCallback(
    (emoji: string, e: React.MouseEvent) => {
      toggleReaction(messageId, emoji);
      setJustReacted(emoji);
      setTimeout(() => setJustReacted(null), 500);
      // Feed 👍/👎 into Brain for pattern detection + preference extraction
      if ((emoji === "\u{1F44D}" || emoji === "\u{1F44E}") && messageContent) {
        const polarity = emoji === "\u{1F44D}" ? 1 : -1;
        void brainAddReaction(messageId, polarity as 1 | -1, messageContent).then(() => {
          // Every 5 reactions, synthesize into behavioral preferences (limbic loop)
          void invoke("consolidate_reactions_to_preferences").catch(() => {});
        });
        // 👍 → fire confetti
        if (emoji === "\u{1F44D}" && onThumbsUp) {
          onThumbsUp(e);
        }
        // 👎 → immediately generate a specific behavioral rule (don't wait for batch)
        if (emoji === "\u{1F44E}") {
          void invoke<string>("reaction_instant_rule", { messageContent }).catch(() => {});
        }
      }
    },
    [messageId, messageContent, toggleReaction, onThumbsUp],
  );

  return (
    <div
      className="flex flex-row gap-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {REACTIONS.map(({ emoji, label }) => {
        const isActive = active.includes(emoji);
        const isPin = emoji === "\u{1F4CC}";
        const isVisible = show || (isPin && isActive);
        const isPopping = justReacted === emoji;

        return (
          <button
            key={emoji}
            aria-label={label}
            title={label}
            onClick={(e) => handleReaction(emoji, e)}
            className={[
              "w-6 h-6 rounded-md text-xs flex items-center justify-center transition-all",
              "hover:bg-blade-surface-hover",
              isActive ? "bg-blade-accent-muted" : "",
              isVisible ? "opacity-100" : "opacity-0 pointer-events-none",
              isPopping ? "scale-150" : "scale-100",
            ].join(" ")}
            style={{
              transition: isPopping
                ? "transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)"
                : "transform 0.2s ease, opacity 0.15s ease",
            }}
          >
            {emoji}
          </button>
        );
      })}
    </div>
  );
}
