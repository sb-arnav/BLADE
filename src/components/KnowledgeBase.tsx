import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useKnowledgeBase, KnowledgeEntry } from "../hooks/useKnowledgeBase";
import { KnowledgeCard } from "./KnowledgeCard";

type SortMode = "newest" | "updated";
type ViewMode = "list" | "detail" | "create" | "edit";

interface Props {
  onBack: () => void;
  onInsertToChat: (content: string) => void;
}

// ── Confirm dialog ───────────────────────────────────────────────────

function ConfirmDialog({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-blade-surface border border-blade-border rounded-2xl p-5 max-w-sm w-full mx-4 space-y-4 animate-fade-in">
        <p className="text-sm text-blade-text">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl text-sm text-blade-muted hover:text-blade-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-xl text-sm bg-red-500/20 text-red-400 border border-red-500/30
                       hover:bg-red-500/30 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Entry form ───────────────────────────────────────────────────────

interface EntryFormProps {
  initial?: KnowledgeEntry;
  onSubmit: (data: { title: string; content: string; tags: string[]; source: KnowledgeEntry["source"] }) => void;
  onCancel: () => void;
}

function EntryForm({ initial, onSubmit, onCancel }: EntryFormProps) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [tagsRaw, setTagsRaw] = useState(initial?.tags.join(", ") ?? "");
  const [source, setSource] = useState<KnowledgeEntry["source"]>(initial?.source ?? "manual");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    onSubmit({ title: title.trim(), content, tags, source });
  };

  const isValid = title.trim().length > 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
      <div className="bg-blade-surface border border-blade-border rounded-2xl p-5 space-y-4">
        <h2 className="text-base font-semibold text-blade-text">
          {initial ? "Edit Entry" : "New Entry"}
        </h2>

        {/* Title */}
        <label className="space-y-2 block">
          <span className="text-xs uppercase tracking-wide text-blade-muted">Title</span>
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. How to configure Tailwind dark mode"
            className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2.5 text-sm
                       outline-none focus:border-blade-accent transition-colors placeholder:text-blade-muted/50"
          />
        </label>

        {/* Content */}
        <label className="space-y-2 block">
          <span className="text-xs uppercase tracking-wide text-blade-muted">Content</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
            placeholder="Write your knowledge entry here... Markdown is supported."
            className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2.5 text-sm
                       outline-none focus:border-blade-accent transition-colors resize-y
                       min-h-[200px] font-mono leading-relaxed placeholder:text-blade-muted/50"
          />
        </label>

        {/* Tags */}
        <label className="space-y-2 block">
          <span className="text-xs uppercase tracking-wide text-blade-muted">
            Tags <span className="normal-case tracking-normal text-blade-muted/70">(comma separated, auto-detected tags will be added)</span>
          </span>
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="e.g. React, hooks, performance"
            className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2.5 text-sm
                       outline-none focus:border-blade-accent transition-colors placeholder:text-blade-muted/50"
          />
        </label>

        {/* Source */}
        <label className="space-y-2 block">
          <span className="text-xs uppercase tracking-wide text-blade-muted">Category</span>
          <div className="flex items-center gap-2">
            {(["manual", "auto", "pinned"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSource(s)}
                className={`px-3 py-1.5 rounded-xl text-xs border transition-colors ${
                  source === s
                    ? s === "auto"
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                      : s === "manual"
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                      : "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-blade-border text-blade-muted hover:text-blade-secondary"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </label>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm text-blade-muted hover:text-blade-text transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isValid}
          className="px-4 py-2 rounded-xl bg-blade-accent text-white text-sm hover:opacity-90
                     transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {initial ? "Save Changes" : "Add Entry"}
        </button>
      </div>
    </form>
  );
}

// ── Detail view ──────────────────────────────────────────────────────

interface DetailViewProps {
  entry: KnowledgeEntry;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onInsertToChat: (content: string) => void;
}

function DetailView({ entry, onBack, onEdit, onDelete, onInsertToChat }: DetailViewProps) {
  const sourceStyle =
    entry.source === "auto"
      ? "border-blue-500/20 bg-blue-500/10 text-blue-400"
      : entry.source === "manual"
      ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
      : "border-amber-500/20 bg-amber-500/10 text-amber-400";

  const createdStr = new Date(entry.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const updatedStr = new Date(entry.updatedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Back link */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-blade-muted hover:text-blade-text transition-colors"
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
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to list
      </button>

      {/* Card */}
      <div className="bg-blade-surface border border-blade-border rounded-2xl p-5 space-y-4">
        {/* Title + meta */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-blade-text">{entry.title}</h2>
          <div className="flex items-center flex-wrap gap-2">
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-2xs font-medium ${sourceStyle}`}
            >
              {entry.source}
            </span>
            <span className="text-2xs text-blade-muted">Created {createdStr}</span>
            {entry.updatedAt !== entry.createdAt && (
              <span className="text-2xs text-blade-muted">Updated {updatedStr}</span>
            )}
            {entry.conversationId && (
              <span className="text-2xs text-blade-muted/60">
                from conversation
              </span>
            )}
          </div>
        </div>

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

        {/* Divider */}
        <div className="border-t border-blade-border" />

        {/* Content — rendered as markdown */}
        <div className="prose prose-invert prose-sm max-w-none
                        prose-headings:text-blade-text prose-headings:font-semibold
                        prose-p:text-blade-secondary prose-p:leading-relaxed
                        prose-a:text-blade-accent prose-a:no-underline hover:prose-a:underline
                        prose-code:text-blade-accent prose-code:bg-blade-accent-muted
                        prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:text-xs
                        prose-pre:bg-blade-bg prose-pre:border prose-pre:border-blade-border
                        prose-pre:rounded-xl
                        prose-blockquote:border-blade-accent prose-blockquote:text-blade-secondary
                        prose-strong:text-blade-text
                        prose-li:text-blade-secondary
                        prose-th:text-blade-text prose-td:text-blade-secondary
                        prose-hr:border-blade-border">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {entry.content || "*No content*"}
          </ReactMarkdown>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onInsertToChat(entry.content)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blade-accent text-white text-sm
                     hover:opacity-90 transition-opacity"
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
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Insert to Chat
        </button>
        <button
          onClick={onEdit}
          className="px-4 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm text-blade-secondary
                     hover:border-blade-muted hover:text-blade-text transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onDelete}
          className="px-4 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm text-blade-muted
                     hover:border-red-500/30 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Main KnowledgeBase component ─────────────────────────────────────

export function KnowledgeBase({ onBack, onInsertToChat }: Props) {
  const {
    entries,
    addEntry,
    updateEntry,
    deleteEntry,
    searchEntries,
    getTags,
    stats,
  } = useKnowledgeBase();

  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search on mount
  useEffect(() => {
    if (viewMode === "list") {
      searchRef.current?.focus();
    }
  }, [viewMode]);

  // Keyboard shortcut: Ctrl+N to create new entry
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && viewMode === "list") {
        e.preventDefault();
        setViewMode("create");
      }
      if (e.key === "Escape") {
        if (viewMode === "create" || viewMode === "edit") {
          setViewMode("list");
          setEditingEntryId(null);
        } else if (viewMode === "detail") {
          setViewMode("list");
          setSelectedEntryId(null);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode]);

  // ── Derived data ─────────────────────────────────────────────────

  const allTags = useMemo(() => getTags(), [getTags, entries]);

  const filteredEntries = useMemo(() => {
    let result: KnowledgeEntry[];

    if (searchQuery.trim()) {
      result = searchEntries(searchQuery);
    } else {
      result = [...entries];
    }

    // Filter by active tag
    if (activeTag) {
      const lower = activeTag.toLowerCase();
      result = result.filter((entry) =>
        entry.tags.some((t) => t.toLowerCase() === lower)
      );
    }

    // Sort
    if (!searchQuery.trim()) {
      result.sort((a, b) => {
        if (sortMode === "newest") return b.createdAt - a.createdAt;
        return b.updatedAt - a.updatedAt;
      });
    }

    return result;
  }, [entries, searchQuery, searchEntries, activeTag, sortMode]);

  const selectedEntry = useMemo(
    () => entries.find((e) => e.id === selectedEntryId) ?? null,
    [entries, selectedEntryId]
  );

  const editingEntry = useMemo(
    () => entries.find((e) => e.id === editingEntryId) ?? null,
    [entries, editingEntryId]
  );

  // ── Handlers ─────────────────────────────────────────────────────

  const handleCreate = useCallback(
    (data: { title: string; content: string; tags: string[]; source: KnowledgeEntry["source"] }) => {
      addEntry({
        title: data.title,
        content: data.content,
        tags: data.tags,
        source: data.source,
      });
      setViewMode("list");
    },
    [addEntry]
  );

  const handleUpdate = useCallback(
    (data: { title: string; content: string; tags: string[]; source: KnowledgeEntry["source"] }) => {
      if (!editingEntryId) return;
      updateEntry(editingEntryId, {
        title: data.title,
        content: data.content,
        tags: data.tags,
        source: data.source,
      });
      setEditingEntryId(null);
      setViewMode(selectedEntryId === editingEntryId ? "detail" : "list");
    },
    [editingEntryId, selectedEntryId, updateEntry]
  );

  const handleDelete = useCallback(
    (entry: KnowledgeEntry) => {
      setDeleteTarget(entry);
    },
    []
  );

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    deleteEntry(deleteTarget.id);
    if (selectedEntryId === deleteTarget.id) {
      setSelectedEntryId(null);
      setViewMode("list");
    }
    setDeleteTarget(null);
  }, [deleteTarget, deleteEntry, selectedEntryId]);

  const handleCardClick = useCallback((entry: KnowledgeEntry) => {
    setSelectedEntryId(entry.id);
    setViewMode("detail");
  }, []);

  const handleEditFromDetail = useCallback(() => {
    if (!selectedEntryId) return;
    setEditingEntryId(selectedEntryId);
    setViewMode("edit");
  }, [selectedEntryId]);

  const handleTagClick = useCallback((tag: string) => {
    setActiveTag((prev) => (prev === tag ? null : tag));
    setSearchQuery("");
  }, []);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-blade-text">Knowledge Base</h1>
            <span className="text-2xs text-blade-muted bg-blade-surface border border-blade-border rounded-full px-2.5 py-0.5">
              {stats.totalEntries} {stats.totalEntries === 1 ? "entry" : "entries"}
            </span>
            {stats.recentlyAdded > 0 && (
              <span className="text-2xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-0.5">
                +{stats.recentlyAdded} this week
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {viewMode === "list" && (
              <button
                onClick={() => setViewMode("create")}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blade-accent text-white text-sm
                           hover:opacity-90 transition-opacity"
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
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                Add Entry
              </button>
            )}
            <button
              onClick={onBack}
              className="text-sm text-blade-muted hover:text-blade-text transition-colors"
            >
              back
            </button>
          </div>
        </div>

        {/* ── List view ──────────────────────────────────────────── */}
        {viewMode === "list" && (
          <div className="space-y-4 animate-fade-in">
            {/* Search bar */}
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 text-blade-muted"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchRef}
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setActiveTag(null);
                }}
                placeholder="Search knowledge base... (title, content, tags)"
                className="w-full bg-blade-surface border border-blade-border rounded-xl pl-10 pr-4 py-2.5 text-sm
                           outline-none focus:border-blade-accent transition-colors placeholder:text-blade-muted/50"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-blade-muted hover:text-blade-text
                             transition-colors"
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
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            {/* Tag cloud */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <span className="text-2xs text-blade-muted shrink-0 uppercase tracking-wide">Tags</span>
                <div className="flex items-center gap-1.5">
                  {allTags.map(({ tag, count }) => (
                    <button
                      key={tag}
                      onClick={() => handleTagClick(tag)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-2xs transition-colors whitespace-nowrap ${
                        activeTag === tag
                          ? "bg-blade-accent text-white"
                          : "bg-blade-accent-muted text-blade-accent hover:bg-blade-accent/20"
                      }`}
                    >
                      {tag}
                      <span className="ml-1 opacity-60">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Sort toggle */}
            {entries.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-2xs text-blade-muted">
                  {filteredEntries.length === entries.length
                    ? `${entries.length} entries`
                    : `${filteredEntries.length} of ${entries.length} entries`}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSortMode("newest")}
                    className={`px-2 py-1 rounded-lg text-2xs transition-colors ${
                      sortMode === "newest"
                        ? "text-blade-text bg-blade-surface-hover"
                        : "text-blade-muted hover:text-blade-secondary"
                    }`}
                  >
                    Newest
                  </button>
                  <button
                    onClick={() => setSortMode("updated")}
                    className={`px-2 py-1 rounded-lg text-2xs transition-colors ${
                      sortMode === "updated"
                        ? "text-blade-text bg-blade-surface-hover"
                        : "text-blade-muted hover:text-blade-secondary"
                    }`}
                  >
                    Recently Updated
                  </button>
                </div>
              </div>
            )}

            {/* Entry list */}
            {filteredEntries.length > 0 ? (
              <div className="space-y-0.5">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    onClick={() => handleCardClick(entry)}
                    className="cursor-pointer"
                  >
                    <KnowledgeCard
                      entry={entry}
                      compact
                      onEdit={() => {
                        setEditingEntryId(entry.id);
                        setViewMode("edit");
                      }}
                      onDelete={() => handleDelete(entry)}
                    />
                  </div>
                ))}
              </div>
            ) : entries.length === 0 ? (
              /* Empty state — no entries at all */
              <div className="flex flex-col items-center justify-center py-16 space-y-4">
                <div className="w-16 h-16 rounded-2xl bg-blade-surface border border-blade-border flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="28"
                    height="28"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-blade-muted"
                  >
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                </div>
                <div className="text-center max-w-xs">
                  <p className="text-sm text-blade-text font-medium">
                    Your knowledge base is empty
                  </p>
                  <p className="text-xs text-blade-muted mt-1.5 leading-relaxed">
                    Blade will auto-populate it as you chat, or add entries manually.
                    Important facts, code snippets, and insights are saved here.
                  </p>
                </div>
                <button
                  onClick={() => setViewMode("create")}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blade-accent text-white text-sm
                             hover:opacity-90 transition-opacity mt-2"
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
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add your first entry
                </button>
              </div>
            ) : (
              /* No results for current search/filter */
              <div className="flex flex-col items-center justify-center py-12 space-y-3">
                <div className="w-12 h-12 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-blade-muted"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    <line x1="8" y1="11" x2="14" y2="11" />
                  </svg>
                </div>
                <p className="text-sm text-blade-muted">
                  No entries match{" "}
                  {searchQuery ? (
                    <>
                      &ldquo;<span className="text-blade-secondary">{searchQuery}</span>&rdquo;
                    </>
                  ) : activeTag ? (
                    <>
                      tag &ldquo;<span className="text-blade-accent">{activeTag}</span>&rdquo;
                    </>
                  ) : (
                    "your filter"
                  )}
                </p>
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setActiveTag(null);
                  }}
                  className="text-xs text-blade-accent hover:underline"
                >
                  Clear filters
                </button>
              </div>
            )}

            {/* Stats footer */}
            {entries.length > 0 && (
              <div className="flex items-center justify-center gap-4 pt-2 border-t border-blade-border">
                <span className="text-2xs text-blade-muted">
                  {stats.totalEntries} entries
                </span>
                <span className="text-2xs text-blade-muted">
                  {stats.totalTags} tags
                </span>
                {stats.recentlyAdded > 0 && (
                  <span className="text-2xs text-blade-muted">
                    {stats.recentlyAdded} added this week
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Detail view ────────────────────────────────────────── */}
        {viewMode === "detail" && selectedEntry && (
          <DetailView
            entry={selectedEntry}
            onBack={() => {
              setViewMode("list");
              setSelectedEntryId(null);
            }}
            onEdit={handleEditFromDetail}
            onDelete={() => handleDelete(selectedEntry)}
            onInsertToChat={onInsertToChat}
          />
        )}

        {/* ── Create view ────────────────────────────────────────── */}
        {viewMode === "create" && (
          <EntryForm
            onSubmit={handleCreate}
            onCancel={() => setViewMode("list")}
          />
        )}

        {/* ── Edit view ──────────────────────────────────────────── */}
        {viewMode === "edit" && editingEntry && (
          <EntryForm
            initial={editingEntry}
            onSubmit={handleUpdate}
            onCancel={() => {
              setEditingEntryId(null);
              setViewMode(selectedEntryId ? "detail" : "list");
            }}
          />
        )}
      </div>

      {/* ── Delete confirmation dialog ─────────────────────────────── */}
      {deleteTarget && (
        <ConfirmDialog
          message={`Delete "${deleteTarget.title}"? This cannot be undone.`}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
