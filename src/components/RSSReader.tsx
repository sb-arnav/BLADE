import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRSSReader, RSSFeed, RSSItem } from "../hooks/useRSSReader";

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

type VirtualFeed = "all" | "unread" | "starred";

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

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\u2026" : text;
}

function stripHtml(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent ?? "";
}

// ── Feed icon map ─────────────────────────────────────────────────────

function FeedIcon({ icon, className = "w-4 h-4" }: { icon: string; className?: string }) {
  const base = "flex-shrink-0";
  const map: Record<string, string> = {
    hn: "Y",
    techcrunch: "TC",
    verge: "V",
    anthropic: "A",
    openai: "OA",
    github: "GH",
    css: "CS",
    smashing: "SM",
    devto: "D",
    ai: "AI",
    rss: "R",
  };
  const label = map[icon] || icon.slice(0, 2).toUpperCase();
  return (
    <span className={`${base} ${className} inline-flex items-center justify-center rounded bg-white/10 text-[9px] font-bold leading-none`}>
      {label}
    </span>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────

function Icon({ name, className = "w-4 h-4" }: { name: string; className?: string }) {
  const s = { viewBox: "0 0 24 24", className, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "arrow-left":
      return <svg {...s}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
    case "refresh":
      return <svg {...s}><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" /></svg>;
    case "search":
      return <svg {...s}><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>;
    case "star":
      return <svg {...s}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
    case "star-fill":
      return <svg {...s} fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>;
    case "inbox":
      return <svg {...s}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></svg>;
    case "check-all":
      return <svg {...s}><path d="M18 6L7 17l-5-5" /><path d="M22 10l-11 11-1.5-1.5" /></svg>;
    case "plus":
      return <svg {...s}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
    case "x":
      return <svg {...s}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
    case "external":
      return <svg {...s}><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>;
    case "send":
      return <svg {...s}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>;
    case "sparkle":
      return <svg {...s}><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z" /></svg>;
    case "trash":
      return <svg {...s}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>;
    case "rss":
      return <svg {...s}><path d="M4 11a9 9 0 019 9" /><path d="M4 4a16 16 0 0116 16" /><circle cx="5" cy="19" r="1" /></svg>;
    case "folder":
      return <svg {...s}><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>;
    default:
      return <svg {...s}><circle cx="12" cy="12" r="10" /></svg>;
  }
}

// ── Add Feed Modal ────────────────────────────────────────────────────

function AddFeedModal({
  onAdd,
  onClose,
  categories,
}: {
  onAdd: (url: string, title: string, category: string) => void;
  onClose: () => void;
  categories: string[];
}) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(categories[0] || "Custom");
  const [detecting, setDetecting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleDetect = useCallback(async () => {
    if (!url.trim()) return;
    setDetecting(true);
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url.trim())}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
      const xml = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "text/xml");
      const detected =
        doc.querySelector("channel > title")?.textContent?.trim() ||
        doc.querySelector("feed > title")?.textContent?.trim() ||
        "";
      if (detected) setTitle(detected);
    } catch {
      // silent fail
    }
    setDetecting(false);
  }, [url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    onAdd(url.trim(), title.trim(), category);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-[420px] rounded-lg border border-white/10 bg-[#1a1a2e] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white/90">Add RSS Feed</h3>
          <button type="button" onClick={onClose} className="text-white/40 hover:text-white/70 transition-colors">
            <Icon name="x" className="w-4 h-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs text-white/50">Feed URL</label>
        <div className="mb-3 flex gap-2">
          <input
            ref={inputRef}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml"
            className="flex-1 rounded bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white/90 placeholder:text-white/25 outline-none focus:border-blue-500/50"
          />
          <button
            type="button"
            onClick={handleDetect}
            disabled={detecting || !url.trim()}
            className="rounded bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/15 disabled:opacity-40 transition-colors"
          >
            {detecting ? "..." : "Detect"}
          </button>
        </div>

        <label className="mb-1 block text-xs text-white/50">Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Feed title (auto-detected or manual)"
          className="mb-3 w-full rounded bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white/90 placeholder:text-white/25 outline-none focus:border-blue-500/50"
        />

        <label className="mb-1 block text-xs text-white/50">Category</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="mb-4 w-full rounded bg-white/5 border border-white/10 px-3 py-1.5 text-xs text-white/90 outline-none focus:border-blue-500/50"
        >
          {[...new Set([...categories, "Custom"])].map((c) => (
            <option key={c} value={c} className="bg-[#1a1a2e]">{c}</option>
          ))}
        </select>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-white/50 hover:text-white/70 transition-colors">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!url.trim()}
            className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
          >
            Add Feed
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────

export default function RSSReader({ onBack, onSendToChat }: Props) {
  const {
    feeds,
    items,
    addFeed,
    removeFeed,
    refreshFeed,
    refreshAll,
    markRead,
    markAllRead,
    starItem,
    searchItems,
    getUnread,
    getStarred,
    getByFeed,
    generateSummary,
    stats,
  } = useRSSReader();

  const [selectedFeed, setSelectedFeed] = useState<string | VirtualFeed>("all");
  const [selectedItem, setSelectedItem] = useState<RSSItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [refreshingFeed, setRefreshingFeed] = useState<string | null>(null);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryText, setSummaryText] = useState<string | null>(null);

  const readerRef = useRef<HTMLDivElement>(null);

  // Get visible items based on current filter
  const visibleItems = useMemo(() => {
    if (searchQuery.trim()) return searchItems(searchQuery);

    let filtered: RSSItem[];
    switch (selectedFeed) {
      case "all":
        filtered = [...items];
        break;
      case "unread":
        filtered = items.filter((i) => !i.read);
        break;
      case "starred":
        filtered = items.filter((i) => i.starred);
        break;
      default:
        filtered = items.filter((i) => i.feedId === selectedFeed);
    }

    return filtered.sort((a, b) => b.pubDate - a.pubDate);
  }, [items, selectedFeed, searchQuery, searchItems]);

  // Feed categories
  const categories = useMemo(() => {
    const cats = new Set(feeds.map((f) => f.category));
    return Array.from(cats).sort();
  }, [feeds]);

  // Feed name lookup
  const feedNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of feeds) map.set(f.id, f.title);
    return map;
  }, [feeds]);

  // Handlers
  const handleRefreshFeed = useCallback(
    async (feedId: string) => {
      setRefreshingFeed(feedId);
      await refreshFeed(feedId);
      setRefreshingFeed(null);
    },
    [refreshFeed],
  );

  const handleRefreshAll = useCallback(async () => {
    setRefreshingAll(true);
    await refreshAll();
    setRefreshingAll(false);
  }, [refreshAll]);

  const handleSelectItem = useCallback(
    (item: RSSItem) => {
      setSelectedItem(item);
      setSummaryText(item.summary);
      if (!item.read) markRead(item.id);
    },
    [markRead],
  );

  const handleSummarize = useCallback(async () => {
    if (!selectedItem) return;
    setSummarizing(true);
    const result = await generateSummary(selectedItem.id);
    setSummaryText(result);
    setSummarizing(false);
  }, [selectedItem, generateSummary]);

  const handleSendToChat = useCallback(() => {
    if (!selectedItem) return;
    const plain = stripHtml(selectedItem.content || selectedItem.description).slice(0, 2000);
    const text = `**${selectedItem.title}**\n${selectedItem.author ? `By ${selectedItem.author} | ` : ""}${new Date(selectedItem.pubDate).toLocaleDateString()}\n\n${plain}\n\nSource: ${selectedItem.link}`;
    onSendToChat(text);
  }, [selectedItem, onSendToChat]);

  const handleAddFeed = useCallback(
    (url: string, title: string, category: string) => {
      addFeed(url, { title: title || undefined, category });
      setShowAddModal(false);
    },
    [addFeed],
  );

  const handleOpenInBrowser = useCallback(() => {
    if (!selectedItem) return;
    window.open(selectedItem.link, "_blank");
  }, [selectedItem]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showAddModal) setShowAddModal(false);
        else if (selectedItem) setSelectedItem(null);
        else onBack();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showAddModal, selectedItem, onBack]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-[#0e0e1a] text-white/90">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-white/40 hover:text-white/70 transition-colors">
            <Icon name="arrow-left" className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <Icon name="rss" className="w-4 h-4 text-orange-400" />
            <h1 className="text-sm font-semibold">RSS Reader</h1>
          </div>
          <div className="flex items-center gap-1.5 ml-3 text-[10px] text-white/30">
            <span>{stats.totalFeeds} feeds</span>
            <span>&middot;</span>
            <span>{stats.totalItems} articles</span>
            <span>&middot;</span>
            <span className="text-orange-400/70">{stats.unreadCount} unread</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Icon name="search" className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/25" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search articles..."
              className="w-48 rounded bg-white/5 border border-white/10 pl-7 pr-3 py-1 text-xs text-white/90 placeholder:text-white/25 outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <button
            onClick={handleRefreshAll}
            disabled={refreshingAll}
            className="flex items-center gap-1.5 rounded bg-white/5 border border-white/10 px-2.5 py-1 text-xs text-white/60 hover:text-white/90 hover:bg-white/10 disabled:opacity-40 transition-colors"
          >
            <Icon name="refresh" className={`w-3 h-3 ${refreshingAll ? "animate-spin" : ""}`} />
            Refresh All
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded bg-blue-600/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500 transition-colors"
          >
            <Icon name="plus" className="w-3 h-3" />
            Add Feed
          </button>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Column 1: Feeds sidebar ───────────────────────────────── */}
        <div className="w-48 flex-shrink-0 border-r border-white/[0.06] overflow-y-auto scrollbar-thin">
          <div className="p-2 space-y-0.5">
            {/* Virtual feeds */}
            {(["all", "unread", "starred"] as const).map((vf) => {
              const label = { all: "All Articles", unread: "Unread", starred: "Starred" }[vf];
              const icon = { all: "inbox", unread: "rss", starred: "star" }[vf];
              const count = vf === "all" ? items.length : vf === "unread" ? stats.unreadCount : stats.starredCount;
              const active = selectedFeed === vf;
              return (
                <button
                  key={vf}
                  onClick={() => { setSelectedFeed(vf); setSelectedItem(null); }}
                  className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                    active ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  <Icon name={icon} className="w-3.5 h-3.5" />
                  <span className="flex-1 text-left truncate">{label}</span>
                  {count > 0 && (
                    <span className={`text-[10px] min-w-[18px] text-center rounded-full px-1 ${
                      vf === "unread" ? "bg-orange-500/20 text-orange-400" : "bg-white/10 text-white/40"
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="my-2 border-t border-white/[0.06]" />

            {/* Feeds by category */}
            {categories.map((cat) => (
              <div key={cat}>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/25">
                  {cat}
                </div>
                {feeds
                  .filter((f) => f.category === cat)
                  .map((feed) => {
                    const active = selectedFeed === feed.id;
                    return (
                      <div key={feed.id} className="group flex items-center">
                        <button
                          onClick={() => { setSelectedFeed(feed.id); setSelectedItem(null); }}
                          className={`flex-1 flex items-center gap-2 rounded-l px-2 py-1.5 text-xs transition-colors ${
                            active ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/70"
                          }`}
                        >
                          <FeedIcon icon={feed.icon} className="w-4 h-4" />
                          <span className="flex-1 text-left truncate">{feed.title}</span>
                          {feed.unreadCount > 0 && (
                            <span className="text-[10px] min-w-[18px] text-center rounded-full px-1 bg-orange-500/20 text-orange-400">
                              {feed.unreadCount}
                            </span>
                          )}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRefreshFeed(feed.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-white/30 hover:text-white/60 transition-all"
                          title="Refresh feed"
                        >
                          <Icon name="refresh" className={`w-3 h-3 ${refreshingFeed === feed.id ? "animate-spin" : ""}`} />
                        </button>
                      </div>
                    );
                  })}
              </div>
            ))}
          </div>
        </div>

        {/* ── Column 2: Item list ───────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
          {/* List header */}
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
            <span className="text-xs text-white/50">
              {visibleItems.length} article{visibleItems.length !== 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-1">
              {selectedFeed !== "all" && selectedFeed !== "starred" && (
                <button
                  onClick={() => markAllRead(selectedFeed === "unread" ? undefined : selectedFeed)}
                  className="flex items-center gap-1 text-[10px] text-white/30 hover:text-white/60 transition-colors"
                  title="Mark all read"
                >
                  <Icon name="check-all" className="w-3 h-3" />
                </button>
              )}
              {typeof selectedFeed === "string" && !["all", "unread", "starred"].includes(selectedFeed) && (
                <button
                  onClick={() => { removeFeed(selectedFeed); setSelectedFeed("all"); setSelectedItem(null); }}
                  className="flex items-center gap-1 text-[10px] text-white/30 hover:text-red-400/70 transition-colors"
                  title="Remove feed"
                >
                  <Icon name="trash" className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Item list */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {visibleItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-white/20 gap-2">
                <Icon name="rss" className="w-8 h-8" />
                <span className="text-xs">No articles yet</span>
                <span className="text-[10px]">Click "Refresh All" to fetch</span>
              </div>
            ) : (
              visibleItems.map((item) => {
                const isActive = selectedItem?.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelectItem(item)}
                    className={`w-full text-left border-b border-white/[0.04] px-3 py-2.5 transition-colors ${
                      isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs leading-snug mb-0.5 ${item.read ? "text-white/40" : "text-white/90 font-medium"}`}>
                          {truncate(item.title, 80)}
                        </div>
                        <div className="flex items-center gap-1.5 text-[10px] text-white/25 mb-1">
                          <span>{feedNameMap.get(item.feedId) || "Unknown"}</span>
                          <span>&middot;</span>
                          <span>{timeAgo(item.pubDate)}</span>
                          {item.author && (
                            <>
                              <span>&middot;</span>
                              <span>{truncate(item.author, 20)}</span>
                            </>
                          )}
                        </div>
                        <div className="text-[10px] text-white/20 leading-relaxed">
                          {truncate(stripHtml(item.description), 120)}
                        </div>
                      </div>
                      <div className="flex flex-col items-center gap-1 pt-0.5">
                        {!item.read && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                        )}
                        {item.starred && (
                          <Icon name="star-fill" className="w-3 h-3 text-yellow-500/70" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Column 3: Reader panel ────────────────────────────────── */}
        <div ref={readerRef} className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedItem ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15 gap-3">
              <Icon name="rss" className="w-12 h-12" />
              <span className="text-sm">Select an article to read</span>
              <div className="text-xs text-white/10 text-center max-w-xs">
                Add feeds, refresh them, and click an article from the list to start reading.
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto px-6 py-6">
              {/* Article toolbar */}
              <div className="flex items-center gap-2 mb-5 pb-3 border-b border-white/[0.06]">
                <button
                  onClick={() => starItem(selectedItem.id)}
                  className={`p-1.5 rounded transition-colors ${
                    selectedItem.starred ? "text-yellow-500" : "text-white/30 hover:text-yellow-500/70"
                  }`}
                  title={selectedItem.starred ? "Unstar" : "Star"}
                >
                  <Icon name={selectedItem.starred ? "star-fill" : "star"} className="w-4 h-4" />
                </button>
                <button
                  onClick={handleSummarize}
                  disabled={summarizing}
                  className="flex items-center gap-1.5 rounded bg-purple-600/20 border border-purple-500/20 px-2.5 py-1 text-xs text-purple-300 hover:bg-purple-600/30 disabled:opacity-40 transition-colors"
                >
                  <Icon name="sparkle" className={`w-3 h-3 ${summarizing ? "animate-pulse" : ""}`} />
                  {summarizing ? "Summarizing..." : "AI Summarize"}
                </button>
                <button
                  onClick={handleSendToChat}
                  className="flex items-center gap-1.5 rounded bg-blue-600/20 border border-blue-500/20 px-2.5 py-1 text-xs text-blue-300 hover:bg-blue-600/30 transition-colors"
                >
                  <Icon name="send" className="w-3 h-3" />
                  Send to Chat
                </button>
                <button
                  onClick={handleOpenInBrowser}
                  className="flex items-center gap-1.5 rounded bg-white/5 border border-white/10 px-2.5 py-1 text-xs text-white/50 hover:text-white/70 hover:bg-white/10 transition-colors"
                >
                  <Icon name="external" className="w-3 h-3" />
                  Open
                </button>
              </div>

              {/* Article header */}
              <h2 className="text-lg font-semibold leading-snug text-white/95 mb-2">
                {selectedItem.title}
              </h2>
              <div className="flex items-center gap-2 text-xs text-white/35 mb-1">
                <span className="text-white/50">{feedNameMap.get(selectedItem.feedId) || "Unknown"}</span>
                {selectedItem.author && (
                  <>
                    <span>&middot;</span>
                    <span>by {selectedItem.author}</span>
                  </>
                )}
                <span>&middot;</span>
                <span>{new Date(selectedItem.pubDate).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
              </div>

              {/* Tags */}
              {selectedItem.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 mb-4">
                  {selectedItem.tags.map((tag) => (
                    <span key={tag} className="rounded bg-white/5 border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-white/30">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* AI Summary */}
              {summaryText && (
                <div className="mt-4 mb-5 rounded-lg bg-purple-500/[0.06] border border-purple-500/15 p-4">
                  <div className="flex items-center gap-1.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-purple-400/70">
                    <Icon name="sparkle" className="w-3 h-3" />
                    AI Summary
                  </div>
                  <p className="text-sm leading-relaxed text-white/70">{summaryText}</p>
                </div>
              )}

              {/* Article content */}
              <div
                className="prose-reader mt-4 text-sm leading-[1.8] text-white/65 [&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-300 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-white/80 [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white/75 [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-white/70 [&_h3]:mt-4 [&_h3]:mb-2 [&_p]:mb-3 [&_ul]:mb-3 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:mb-3 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:mb-1 [&_code]:bg-white/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:text-orange-300/70 [&_pre]:bg-white/[0.04] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_blockquote]:border-l-2 [&_blockquote]:border-white/10 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-white/45 [&_blockquote]:my-4 [&_img]:rounded-lg [&_img]:my-4 [&_img]:max-w-full"
                dangerouslySetInnerHTML={{
                  __html: selectedItem.content || selectedItem.description || "<p>No content available.</p>",
                }}
              />

              {/* Source link footer */}
              <div className="mt-8 pt-4 border-t border-white/[0.06]">
                <a
                  href={selectedItem.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400/60 hover:text-blue-400 transition-colors"
                >
                  {selectedItem.link}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add feed modal */}
      {showAddModal && (
        <AddFeedModal
          onAdd={handleAddFeed}
          onClose={() => setShowAddModal(false)}
          categories={categories}
        />
      )}
    </div>
  );
}
