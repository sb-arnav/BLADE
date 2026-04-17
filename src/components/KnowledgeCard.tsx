import { useState } from "react";
import { KnowledgeEntry } from "../hooks/useKnowledgeBase";

interface Props {
  entry: KnowledgeEntry;
  onEdit: () => void;
  onDelete: () => void;
  compact?: boolean;
}

const SOURCE_STYLES: Record<
  KnowledgeEntry["source"],
  { label: string; bg: string; text: string; border: string }
> = {
  auto: {
    label: "auto",
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
  },
  manual: {
    label: "manual",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  pinned: {
    label: "pinned",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
};

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (weeks < 5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;

  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function truncateContent(content: string, maxLines: number): string {
  const lines = content.split("\n").slice(0, maxLines);
  const truncated = lines.join("\n");
  if (content.split("\n").length > maxLines) {
    return truncated + "...";
  }
  return truncated;
}

export function KnowledgeCard({ entry, onEdit, onDelete, compact = false }: Props) {
  const [hovered, setHovered] = useState(false);
  const source = SOURCE_STYLES[entry.source];
  const dateStr = formatRelativeDate(entry.updatedAt);

  // ── Compact mode: single-line row ──────────────────────────────────
  if (compact) {
    return (
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="group flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent
                   hover:border-blade-border hover:bg-blade-surface transition-colors cursor-pointer"
      >
        {/* Source dot indicator */}
        <span
          className={`shrink-0 w-1.5 h-1.5 rounded-full ${
            entry.source === "auto"
              ? "bg-blue-400"
              : entry.source === "manual"
              ? "bg-emerald-400"
              : "bg-amber-400"
          }`}
        />

        {/* Title */}
        <span className="text-sm text-blade-text truncate flex-1 min-w-0">
          {entry.title}
        </span>

        {/* Tags (show up to 3) */}
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {entry.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-2xs bg-blade-accent-muted text-blade-accent
                         whitespace-nowrap"
            >
              {tag}
            </span>
          ))}
          {entry.tags.length > 3 && (
            <span className="text-2xs text-blade-muted">
              +{entry.tags.length - 3}
            </span>
          )}
        </div>

        {/* Date */}
        <span className="text-2xs text-blade-muted shrink-0 w-14 text-right">
          {dateStr}
        </span>

        {/* Hover actions */}
        <div
          className={`flex items-center gap-1 shrink-0 transition-opacity ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="p-1 rounded-md text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover
                       transition-colors"
            title="Edit"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 rounded-md text-blade-muted hover:text-red-400 hover:bg-red-500/10
                       transition-colors"
            title="Delete"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Full mode: card with content preview ───────────────────────────
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group rounded-2xl border border-blade-border bg-blade-surface p-4 space-y-3
                 hover:border-blade-border-hover transition-colors"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-blade-text truncate">
            {entry.title}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            {/* Source badge */}
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-2xs font-medium
                          ${source.bg} ${source.text} ${source.border}`}
            >
              {source.label}
            </span>
            <span className="text-2xs text-blade-muted">{dateStr}</span>
          </div>
        </div>

        {/* Hover actions */}
        <div
          className={`flex items-center gap-1 shrink-0 transition-opacity ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        >
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover
                       transition-colors"
            title="Edit"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-blade-muted hover:text-red-400 hover:bg-red-500/10
                       transition-colors"
            title="Delete"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content preview (first 3 lines) */}
      {entry.content && (
        <p className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap break-words">
          {truncateContent(entry.content, 3)}
        </p>
      )}

      {/* Tags */}
      {entry.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-2xs bg-blade-accent-muted text-blade-accent"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
