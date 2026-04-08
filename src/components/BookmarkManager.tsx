import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useBookmarks,
  Bookmark,
  BookmarkSort,
} from "../hooks/useBookmarks";

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

type ViewMode = "list" | "card";

// ── Folder icon map ────────────────────────────────────────────────────

function FolderIcon({ icon, className = "w-3.5 h-3.5" }: { icon: string; className?: string }) {
  const icons: Record<string, React.ReactNode> = {
    clock: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
      </svg>
    ),
    book: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
    wrench: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    newspaper: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2" />
      </svg>
    ),
    folder: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    ),
  };
  return icons[icon] ?? icons.folder;
}

// ── Helpers ────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function truncateUrl(url: string, max = 50): string {
  try {
    const parsed = new URL(url);
    const display = parsed.hostname.replace(/^www\./, "") + parsed.pathname;
    return display.length > max ? display.slice(0, max) + "..." : display;
  } catch {
    return url.length > max ? url.slice(0, max) + "..." : url;
  }
}

function truncateText(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

// ── Component ──────────────────────────────────────────────────────────

export default function BookmarkManager({ onBack, onSendToChat }: Props) {
  const {
    bookmarks,
    folders,
    addBookmark,
    removeBookmark,
    updateBookmark,
    toggleRead,
    moveToFolder,
    addFolder,
    removeFolder,
    search,
    getUnread,
    importFromConversation,
    exportAsOpml,
    stats,
  } = useBookmarks();

  // ── Local state ──────────────────────────────────────────────────────

  const [query, setQuery] = useState("");
  const [activeFolder, setActiveFolder] = useState<string | "all" | "unread">("all");
  const [sort, setSort] = useState<BookmarkSort>("newest");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [selectedBookmark, setSelectedBookmark] = useState<Bookmark | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // Add form fields
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addDesc, setAddDesc] = useState("");
  const [addTags, setAddTags] = useState("");
  const [addFolder_, setAddFolder_] = useState("read-later");

  // New folder form
  const [newFolderName, setNewFolderName] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const addUrlRef = useRef<HTMLInputElement>(null);

  // ── Derived data ─────────────────────────────────────────────────────

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    bookmarks.forEach((b) => b.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [bookmarks]);

  const filtered = useMemo(() => {
    let list: Bookmark[];

    if (query) {
      list = search(query);
    } else if (activeFolder === "unread") {
      list = getUnread();
    } else if (activeFolder === "all") {
      list = [...bookmarks];
    } else {
      list = bookmarks.filter((b) => b.folder === activeFolder);
    }

    if (tagFilter) {
      list = list.filter((b) =>
        b.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase()),
      );
    }

    if (sort === "newest") list.sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === "oldest") list.sort((a, b) => a.addedAt - b.addedAt);
    else if (sort === "unread-first") {
      list.sort((a, b) => {
        if (a.isRead === b.isRead) return b.addedAt - a.addedAt;
        return a.isRead ? 1 : -1;
      });
    }

    return list;
  }, [bookmarks, query, activeFolder, tagFilter, sort, search, getUnread]);

  // ── Effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedBookmark) setSelectedBookmark(null);
        else if (showAddForm) setShowAddForm(false);
        else onBack();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [selectedBookmark, showAddForm, onBack]);

  useEffect(() => {
    if (showAddForm) addUrlRef.current?.focus();
  }, [showAddForm]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleAdd = useCallback(() => {
    if (!addUrl.trim()) return;
    const tags = addTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    addBookmark({
      url: addUrl.trim(),
      title: addTitle.trim() || undefined,
      description: addDesc.trim(),
      tags,
      folder: addFolder_,
      source: "manual",
    });

    setAddUrl("");
    setAddTitle("");
    setAddDesc("");
    setAddTags("");
    setShowAddForm(false);
  }, [addUrl, addTitle, addDesc, addTags, addFolder_, addBookmark]);

  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    addFolder(newFolderName.trim());
    setNewFolderName("");
    setShowNewFolder(false);
  }, [newFolderName, addFolder]);

  const handleAiSummarize = useCallback(
    (bookmark: Bookmark) => {
      onSendToChat(
        `Please summarize this article/page for me:\n\n${bookmark.url}\n\nTitle: ${bookmark.title}`,
      );
    },
    [onSendToChat],
  );

  const handleImportFromChat = useCallback(() => {
    let messages: { role: string; content: string }[] = [];
    try {
      const stored = localStorage.getItem("blade-messages");
      if (stored) messages = JSON.parse(stored);
    } catch {
      /* noop */
    }

    if (!messages.length) {
      alert("No conversation messages found to scan for URLs.");
      return;
    }

    const imported = importFromConversation(messages);
    if (imported.length === 0) {
      alert("No new URLs found in the conversation.");
    } else {
      alert(`Imported ${imported.length} bookmark${imported.length !== 1 ? "s" : ""} from chat.`);
    }
  }, [importFromConversation]);

  const handleMarkAllRead = useCallback(() => {
    for (const b of filtered) {
      if (!b.isRead) toggleRead(b.id);
    }
  }, [filtered, toggleRead]);

  const handleDragStart = useCallback((e: React.DragEvent, bookmarkId: string) => {
    e.dataTransfer.setData("text/plain", bookmarkId);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      const bookmarkId = e.dataTransfer.getData("text/plain");
      if (bookmarkId) moveToFolder(bookmarkId, folderId);
      setDragOverFolder(null);
    },
    [moveToFolder],
  );

  const handleDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolder(folderId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverFolder(null);
  }, []);

  // ── Render helpers ───────────────────────────────────────────────────

  function renderBookmarkCard(bookmark: Bookmark) {
    return (
      <div
        key={bookmark.id}
        draggable
        onDragStart={(e) => handleDragStart(e, bookmark.id)}
        className={`group border rounded-xl p-3 transition-all cursor-pointer hover:border-blade-accent/50 ${
          bookmark.isRead
            ? "border-blade-border bg-blade-surface opacity-75"
            : "border-blade-border bg-blade-surface"
        } ${selectedBookmark?.id === bookmark.id ? "ring-1 ring-blade-accent border-blade-accent" : ""}`}
        onClick={() => setSelectedBookmark(bookmark)}
      >
        <div className="flex items-start gap-2.5">
          {/* Favicon */}
          {bookmark.favicon && (
            <img
              src={bookmark.favicon}
              alt=""
              className="w-4 h-4 rounded mt-0.5 shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          )}

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-xs font-medium text-blade-text truncate flex-1">
                {bookmark.title}
              </span>
              {!bookmark.isRead && (
                <span className="w-1.5 h-1.5 rounded-full bg-blade-accent shrink-0" />
              )}
            </div>

            {/* URL */}
            <p className="text-[10px] text-blade-muted truncate mb-1">
              {truncateUrl(bookmark.url, 60)}
            </p>

            {/* Description */}
            {bookmark.description && (
              <p className="text-[10px] text-blade-secondary leading-relaxed mb-1.5 line-clamp-2">
                {truncateText(bookmark.description, 120)}
              </p>
            )}

            {/* Tags + meta */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {bookmark.tags.slice(0, 3).map((tag) => (
                <button
                  key={tag}
                  onClick={(e) => { e.stopPropagation(); setTagFilter(tag); }}
                  className="text-[9px] px-1.5 py-0.5 rounded-full bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
                >
                  {tag}
                </button>
              ))}
              {bookmark.tags.length > 3 && (
                <span className="text-[9px] text-blade-muted">+{bookmark.tags.length - 3}</span>
              )}
              <span className="text-[9px] text-blade-muted ml-auto shrink-0">
                {timeAgo(bookmark.addedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* Hover actions */}
        <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); toggleRead(bookmark.id); }}
            className="text-[10px] px-2 py-0.5 rounded bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
          >
            {bookmark.isRead ? "Mark Unread" : "Mark Read"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleAiSummarize(bookmark); }}
            className="text-[10px] px-2 py-0.5 rounded bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors"
          >
            AI Summarize
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(bookmark.url, "_blank"); }}
            className="text-[10px] px-2 py-0.5 rounded bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
          >
            Open
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); removeBookmark(bookmark.id); }}
            className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors ml-auto"
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  function renderBookmarkRow(bookmark: Bookmark) {
    return (
      <div
        key={bookmark.id}
        draggable
        onDragStart={(e) => handleDragStart(e, bookmark.id)}
        className={`group flex items-center gap-3 px-4 py-2.5 hover:bg-blade-surface-hover cursor-pointer transition-colors border-b border-blade-border ${
          selectedBookmark?.id === bookmark.id ? "bg-blade-accent/5" : ""
        }`}
        onClick={() => setSelectedBookmark(bookmark)}
      >
        {/* Read indicator */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleRead(bookmark.id); }}
          className={`w-3 h-3 rounded-full border shrink-0 transition-colors ${
            bookmark.isRead
              ? "bg-blade-accent border-blade-accent"
              : "border-blade-muted hover:border-blade-accent"
          }`}
        />

        {/* Favicon */}
        {bookmark.favicon && (
          <img
            src={bookmark.favicon}
            alt=""
            className="w-4 h-4 rounded shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}

        {/* Title + URL */}
        <div className="flex-1 min-w-0">
          <span className={`text-xs font-medium truncate block ${bookmark.isRead ? "text-blade-muted" : "text-blade-text"}`}>
            {bookmark.title}
          </span>
          <span className="text-[10px] text-blade-muted truncate block">
            {truncateUrl(bookmark.url, 50)}
          </span>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-1 shrink-0 max-w-[150px] overflow-hidden">
          {bookmark.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blade-surface-hover text-blade-muted whitespace-nowrap">
              {tag}
            </span>
          ))}
        </div>

        {/* Date */}
        <span className="text-[10px] text-blade-muted shrink-0 w-14 text-right">
          {timeAgo(bookmark.addedAt)}
        </span>

        {/* Quick actions */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); handleAiSummarize(bookmark); }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors"
            title="AI Summarize"
          >
            AI
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); window.open(bookmark.url, "_blank"); }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
            title="Open in browser"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><path d="M15 3h6v6" /><path d="M10 14L21 3" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); removeBookmark(bookmark.id); }}
            className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            title="Delete"
          >
            <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50">
      <div
        className="w-full max-w-5xl h-[85vh] bg-blade-surface border border-blade-border rounded-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0 border-b border-blade-border">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-sm font-semibold text-blade-text">Bookmarks</h2>
            <span className="text-[10px] text-blade-muted bg-blade-surface-hover px-1.5 py-0.5 rounded-full">
              {stats.total} saved
            </span>
            {stats.unread > 0 && (
              <span className="text-[10px] text-blade-accent bg-blade-accent/10 px-1.5 py-0.5 rounded-full font-medium">
                {stats.unread} unread
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleImportFromChat}
              className="text-xs px-3 py-1.5 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors"
            >
              Import from Chat
            </button>
            <button
              onClick={exportAsOpml}
              className="text-xs px-3 py-1.5 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors"
            >
              Export OPML
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity"
            >
              + Add Bookmark
            </button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">
          {/* ── Folder sidebar ──────────────────────────────────── */}
          <div className="w-48 border-r border-blade-border flex flex-col shrink-0">
            <div className="p-3 space-y-0.5 flex-1 overflow-y-auto custom-scrollbar">
              {/* All / Unread */}
              <button
                onClick={() => { setActiveFolder("all"); setTagFilter(""); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  activeFolder === "all"
                    ? "bg-blade-accent/10 text-blade-accent font-medium"
                    : "text-blade-secondary hover:bg-blade-surface-hover"
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                <span className="flex-1 text-left">All Bookmarks</span>
                <span className="text-[10px] text-blade-muted">{stats.total}</span>
              </button>

              <button
                onClick={() => { setActiveFolder("unread"); setTagFilter(""); }}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                  activeFolder === "unread"
                    ? "bg-blade-accent/10 text-blade-accent font-medium"
                    : "text-blade-secondary hover:bg-blade-surface-hover"
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><circle cx="12" cy="16" r="0.5" fill="currentColor" />
                </svg>
                <span className="flex-1 text-left">Unread</span>
                {stats.unread > 0 && (
                  <span className="text-[10px] text-blade-accent font-medium">{stats.unread}</span>
                )}
              </button>

              <div className="border-t border-blade-border my-2" />

              {/* Folder list */}
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  onDrop={(e) => handleDrop(e, folder.id)}
                  onDragOver={(e) => handleDragOver(e, folder.id)}
                  onDragLeave={handleDragLeave}
                  className={`relative group ${
                    dragOverFolder === folder.id ? "ring-1 ring-blade-accent rounded-lg" : ""
                  }`}
                >
                  <button
                    onClick={() => { setActiveFolder(folder.id); setTagFilter(""); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                      activeFolder === folder.id
                        ? "bg-blade-accent/10 text-blade-accent font-medium"
                        : "text-blade-secondary hover:bg-blade-surface-hover"
                    }`}
                  >
                    <FolderIcon icon={folder.icon} />
                    <span className="flex-1 text-left truncate">{folder.name}</span>
                    <span className="text-[10px] text-blade-muted">{folder.count}</span>
                  </button>

                  {/* Delete custom folder (not default) */}
                  {!["read-later", "references", "tools", "articles"].includes(folder.id) && (
                    <button
                      onClick={() => removeFolder(folder.id)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4 rounded flex items-center justify-center text-red-400 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 transition-all"
                    >
                      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}

              {/* Add folder */}
              {showNewFolder ? (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    type="text"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFolder();
                      if (e.key === "Escape") setShowNewFolder(false);
                    }}
                    placeholder="Folder name..."
                    autoFocus
                    className="flex-1 text-[10px] px-2 py-1 bg-blade-surface-hover border border-blade-border rounded text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                  />
                  <button
                    onClick={handleCreateFolder}
                    className="text-[10px] text-blade-accent hover:underline px-1"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNewFolder(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors mt-1"
                >
                  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New Folder
                </button>
              )}
            </div>

            {/* Stats footer */}
            <div className="p-3 border-t border-blade-border text-[10px] text-blade-muted space-y-0.5">
              <p>{stats.totalTags} tags</p>
              <p>{stats.recentlyAdded} added this week</p>
            </div>
          </div>

          {/* ── Main content ────────────────────────────────────── */}
          <div className="flex-1 flex flex-col min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-blade-border flex-wrap">
              {/* Search */}
              <div className="relative flex-1 min-w-[180px]">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blade-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search bookmarks... (Ctrl+K)"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                />
              </div>

              {/* Tag filter pills */}
              {tagFilter && (
                <button
                  onClick={() => setTagFilter("")}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-blade-accent text-white shrink-0"
                >
                  {tagFilter} x
                </button>
              )}
              {allTags
                .filter((t) => t !== tagFilter)
                .slice(0, 5)
                .map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tag)}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-blade-surface-hover text-blade-muted hover:text-blade-secondary shrink-0 transition-colors"
                  >
                    {tag}
                  </button>
                ))}

              {/* Sort */}
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as BookmarkSort)}
                className="text-xs px-2 py-1.5 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text focus:outline-none"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="unread-first">Unread First</option>
              </select>

              {/* View toggle */}
              <div className="flex items-center bg-blade-surface-hover rounded-lg border border-blade-border">
                <button
                  onClick={() => setViewMode("list")}
                  className={`px-2 py-1.5 rounded-l-lg transition-colors ${
                    viewMode === "list" ? "bg-blade-accent/10 text-blade-accent" : "text-blade-muted hover:text-blade-secondary"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode("card")}
                  className={`px-2 py-1.5 rounded-r-lg transition-colors ${
                    viewMode === "card" ? "bg-blade-accent/10 text-blade-accent" : "text-blade-muted hover:text-blade-secondary"
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </button>
              </div>

              {/* Bulk mark read */}
              {stats.unread > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[10px] px-2 py-1 rounded-lg bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
                >
                  Mark All Read
                </button>
              )}
            </div>

            {/* Bookmark list */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-blade-muted py-16">
                  <svg className="w-12 h-12 mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                  </svg>
                  <p className="text-xs font-medium mb-1">No bookmarks yet</p>
                  <p className="text-[10px]">Save URLs, articles, and references</p>
                  <button
                    onClick={() => setShowAddForm(true)}
                    className="mt-3 text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity"
                  >
                    Add Your First Bookmark
                  </button>
                </div>
              ) : viewMode === "card" ? (
                <div className="grid grid-cols-2 gap-3 p-4">
                  {filtered.map((b) => renderBookmarkCard(b))}
                </div>
              ) : (
                <div>{filtered.map((b) => renderBookmarkRow(b))}</div>
              )}
            </div>
          </div>

          {/* ── Detail sidebar ──────────────────────────────────── */}
          {selectedBookmark && (
            <div className="w-72 border-l border-blade-border flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
              {/* Close */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border">
                <span className="text-[10px] font-medium text-blade-muted uppercase tracking-wider">Details</span>
                <button
                  onClick={() => setSelectedBookmark(null)}
                  className="w-5 h-5 rounded flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Favicon + Title */}
              <div className="px-4 py-3 border-b border-blade-border">
                <div className="flex items-center gap-2 mb-2">
                  {selectedBookmark.favicon && (
                    <img
                      src={selectedBookmark.favicon}
                      alt=""
                      className="w-5 h-5 rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <input
                    type="text"
                    value={selectedBookmark.title}
                    onChange={(e) => updateBookmark(selectedBookmark.id, { title: e.target.value })}
                    className="flex-1 text-xs font-medium bg-transparent text-blade-text focus:outline-none"
                  />
                </div>
                <a
                  href={selectedBookmark.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blade-accent hover:underline break-all"
                >
                  {selectedBookmark.url}
                </a>
              </div>

              {/* Description */}
              <div className="px-4 py-3 border-b border-blade-border">
                <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                  Description
                </label>
                <textarea
                  value={selectedBookmark.description}
                  onChange={(e) => updateBookmark(selectedBookmark.id, { description: e.target.value })}
                  placeholder="Add a description..."
                  rows={2}
                  className="w-full text-xs bg-blade-surface-hover border border-blade-border rounded-lg px-2.5 py-2 text-blade-text placeholder:text-blade-muted resize-none focus:outline-none focus:border-blade-accent"
                />
              </div>

              {/* Summary */}
              {selectedBookmark.summary && (
                <div className="px-4 py-3 border-b border-blade-border">
                  <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                    AI Summary
                  </label>
                  <p className="text-[10px] text-blade-secondary leading-relaxed">
                    {selectedBookmark.summary}
                  </p>
                </div>
              )}

              {/* Notes */}
              <div className="px-4 py-3 border-b border-blade-border">
                <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                  Notes
                </label>
                <textarea
                  value={selectedBookmark.notes}
                  onChange={(e) => updateBookmark(selectedBookmark.id, { notes: e.target.value })}
                  placeholder="Personal notes..."
                  rows={3}
                  className="w-full text-xs bg-blade-surface-hover border border-blade-border rounded-lg px-2.5 py-2 text-blade-text placeholder:text-blade-muted resize-none focus:outline-none focus:border-blade-accent"
                />
              </div>

              {/* Tags */}
              <div className="px-4 py-3 border-b border-blade-border">
                <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                  Tags
                </label>
                <div className="flex flex-wrap gap-1 mb-2">
                  {selectedBookmark.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[10px] px-2 py-0.5 rounded-full bg-blade-accent/20 text-blade-accent"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              {/* Move to folder */}
              <div className="px-4 py-3 border-b border-blade-border">
                <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                  Folder
                </label>
                <select
                  value={selectedBookmark.folder}
                  onChange={(e) => {
                    moveToFolder(selectedBookmark.id, e.target.value);
                    setSelectedBookmark({ ...selectedBookmark, folder: e.target.value });
                  }}
                  className="w-full text-xs px-2 py-1.5 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text focus:outline-none"
                >
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>

              {/* Meta info */}
              <div className="px-4 py-3 border-b border-blade-border text-[10px] text-blade-muted space-y-1">
                <p>Added: {new Date(selectedBookmark.addedAt).toLocaleDateString()}</p>
                <p>Status: {selectedBookmark.isRead ? "Read" : "Unread"}</p>
                {selectedBookmark.readAt && (
                  <p>Read at: {new Date(selectedBookmark.readAt).toLocaleDateString()}</p>
                )}
                <p>Source: {selectedBookmark.source}</p>
              </div>

              {/* Actions */}
              <div className="px-4 py-3 flex flex-col gap-2 mt-auto shrink-0">
                <button
                  onClick={() => handleAiSummarize(selectedBookmark)}
                  className="w-full text-xs py-2 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity font-medium"
                >
                  AI Summarize
                </button>
                <button
                  onClick={() => window.open(selectedBookmark.url, "_blank")}
                  className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors"
                >
                  Open in Browser
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(selectedBookmark.url);
                  }}
                  className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors"
                >
                  Copy URL
                </button>
                <button
                  onClick={() => {
                    removeBookmark(selectedBookmark.id);
                    setSelectedBookmark(null);
                  }}
                  className="w-full text-xs py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                >
                  Delete Bookmark
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Add Bookmark Modal ──────────────────────────────────── */}
        {showAddForm && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center z-10">
            <div className="w-full max-w-md bg-blade-surface border border-blade-border rounded-2xl shadow-2xl p-5 animate-fade-in">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-blade-text">Add Bookmark</h3>
                <button
                  onClick={() => setShowAddForm(false)}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                    URL *
                  </label>
                  <input
                    ref={addUrlRef}
                    type="url"
                    value={addUrl}
                    onChange={(e) => setAddUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                    placeholder="https://example.com/article"
                    className="w-full text-xs px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                    Title (auto-detected if empty)
                  </label>
                  <input
                    type="text"
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    placeholder="Page title..."
                    className="w-full text-xs px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                    Description
                  </label>
                  <textarea
                    value={addDesc}
                    onChange={(e) => setAddDesc(e.target.value)}
                    placeholder="Brief description..."
                    rows={2}
                    className="w-full text-xs px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted resize-none focus:outline-none focus:border-blade-accent"
                  />
                </div>

                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                      Tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={addTags}
                      onChange={(e) => setAddTags(e.target.value)}
                      placeholder="react, tutorial..."
                      className="w-full text-xs px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                      Folder
                    </label>
                    <select
                      value={addFolder_}
                      onChange={(e) => setAddFolder_(e.target.value)}
                      className="text-xs px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text focus:outline-none"
                    >
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="text-xs px-4 py-2 rounded-lg bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!addUrl.trim()}
                  className="text-xs px-4 py-2 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
                >
                  Save Bookmark
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
