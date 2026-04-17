import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface RSSFeed {
  id: string;
  url: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  lastFetched: number | null;
  itemCount: number;
  unreadCount: number;
  enabled: boolean;
  createdAt: number;
}

export interface RSSItem {
  id: string;
  feedId: string;
  title: string;
  link: string;
  description: string;
  content: string;
  author: string;
  pubDate: number;
  read: boolean;
  starred: boolean;
  summary: string | null;
  tags: string[];
}

export interface RSSStats {
  totalFeeds: number;
  totalItems: number;
  unreadCount: number;
  starredCount: number;
  byCategory: Record<string, number>;
  lastRefresh: number | null;
}

// ── Constants ──────────────────────────────────────────────────────────

const FEEDS_KEY = "blade-rss-feeds";
const ITEMS_KEY = "blade-rss-items";

const DEFAULT_FEEDS: Omit<RSSFeed, "id" | "lastFetched" | "itemCount" | "unreadCount" | "createdAt">[] = [
  {
    url: "https://hnrss.org/frontpage",
    title: "Hacker News",
    description: "Links for the intellectually curious",
    icon: "hn",
    category: "Tech",
    enabled: true,
  },
  {
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
    title: "TechCrunch AI",
    description: "AI coverage from TechCrunch",
    icon: "techcrunch",
    category: "AI",
    enabled: true,
  },
  {
    url: "https://www.theverge.com/rss/index.xml",
    title: "The Verge",
    description: "Technology, science, art, and culture",
    icon: "verge",
    category: "Tech",
    enabled: true,
  },
  {
    url: "https://www.anthropic.com/feed.xml",
    title: "Anthropic Blog",
    description: "Research and updates from Anthropic",
    icon: "anthropic",
    category: "AI",
    enabled: true,
  },
  {
    url: "https://openai.com/blog/rss.xml",
    title: "OpenAI Blog",
    description: "Research and announcements from OpenAI",
    icon: "openai",
    category: "AI",
    enabled: true,
  },
  {
    url: "https://github.blog/feed/",
    title: "GitHub Blog",
    description: "Updates, ideas, and inspiration from GitHub",
    icon: "github",
    category: "Dev",
    enabled: true,
  },
  {
    url: "https://css-tricks.com/feed/",
    title: "CSS-Tricks",
    description: "Tips, tricks, and techniques on CSS",
    icon: "css",
    category: "Dev",
    enabled: true,
  },
  {
    url: "https://www.smashingmagazine.com/feed/",
    title: "Smashing Magazine",
    description: "Web design and development articles",
    icon: "smashing",
    category: "Dev",
    enabled: true,
  },
  {
    url: "https://dev.to/feed",
    title: "Dev.to",
    description: "Community-powered developer articles",
    icon: "devto",
    category: "Dev",
    enabled: true,
  },
  {
    url: "https://buttondown.com/ainews/rss",
    title: "AI News Daily",
    description: "Daily AI news roundup and analysis",
    icon: "ai",
    category: "AI",
    enabled: true,
  },
];

// ── Persistence helpers ────────────────────────────────────────────────

function loadFeeds(): RSSFeed[] {
  try {
    const raw = localStorage.getItem(FEEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveFeeds(feeds: RSSFeed[]) {
  localStorage.setItem(FEEDS_KEY, JSON.stringify(feeds));
}

function loadItems(): RSSItem[] {
  try {
    const raw = localStorage.getItem(ITEMS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveItems(items: RSSItem[]) {
  // Keep at most 2000 items to avoid exceeding localStorage limits
  const trimmed = items.slice(0, 2000);
  localStorage.setItem(ITEMS_KEY, JSON.stringify(trimmed));
}

// ── XML parsing helpers ───────────────────────────────────────────────

function getTextContent(el: Element, tagName: string): string {
  const child = el.querySelector(tagName);
  return child?.textContent?.trim() ?? "";
}

function parseRSSDate(dateStr: string): number {
  if (!dateStr) return Date.now();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

function parseRSSXml(xml: string, feedId: string): RSSItem[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  const items: RSSItem[] = [];

  // Try RSS 2.0 <item> elements
  const rssItems = doc.querySelectorAll("item");
  if (rssItems.length > 0) {
    rssItems.forEach((el) => {
      const title = getTextContent(el, "title");
      const link = getTextContent(el, "link");
      const description = getTextContent(el, "description");
      const content =
        el.querySelector("content\\:encoded")?.textContent?.trim() ??
        el.querySelector("encoded")?.textContent?.trim() ??
        description;
      const author =
        getTextContent(el, "dc\\:creator") ||
        getTextContent(el, "creator") ||
        getTextContent(el, "author");
      const pubDate =
        getTextContent(el, "pubDate") || getTextContent(el, "dc\\:date") || getTextContent(el, "date");
      const categories: string[] = [];
      el.querySelectorAll("category").forEach((c) => {
        if (c.textContent) categories.push(c.textContent.trim());
      });

      items.push({
        id: `${feedId}_${btoa(link || title).slice(0, 24)}_${items.length}`,
        feedId,
        title,
        link,
        description: stripHtml(description).slice(0, 300),
        content,
        author,
        pubDate: parseRSSDate(pubDate),
        read: false,
        starred: false,
        summary: null,
        tags: categories.slice(0, 5),
      });
    });
    return items;
  }

  // Try Atom <entry> elements
  const entries = doc.querySelectorAll("entry");
  entries.forEach((el) => {
    const title = getTextContent(el, "title");
    const linkEl = el.querySelector("link[href]");
    const link = linkEl?.getAttribute("href") ?? "";
    const summary = getTextContent(el, "summary");
    const content = getTextContent(el, "content") || summary;
    const author = getTextContent(el, "author > name") || getTextContent(el, "author");
    const published = getTextContent(el, "published") || getTextContent(el, "updated");
    const categories: string[] = [];
    el.querySelectorAll("category").forEach((c) => {
      const term = c.getAttribute("term");
      if (term) categories.push(term);
    });

    items.push({
      id: `${feedId}_${btoa(link || title).slice(0, 24)}_${items.length}`,
      feedId,
      title,
      link,
      description: stripHtml(summary).slice(0, 300),
      content,
      author,
      pubDate: parseRSSDate(published),
      read: false,
      starred: false,
      summary: null,
      tags: categories.slice(0, 5),
    });
  });

  return items;
}

function stripHtml(html: string): string {
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.textContent ?? "";
}

export function detectFeedTitle(xml: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");
  // RSS 2.0
  const channelTitle = doc.querySelector("channel > title");
  if (channelTitle?.textContent) return channelTitle.textContent.trim();
  // Atom
  const feedTitle = doc.querySelector("feed > title");
  if (feedTitle?.textContent) return feedTitle.textContent.trim();
  return "Unknown Feed";
}

// ── Search scoring ────────────────────────────────────────────────────

function scoreItem(item: RSSItem, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const terms = q.split(/\s+/).filter(Boolean);
  let score = 0;

  const titleLower = item.title.toLowerCase();
  const descLower = item.description.toLowerCase();
  const authorLower = item.author.toLowerCase();

  for (const term of terms) {
    if (titleLower.includes(term)) {
      score += 100;
      if (titleLower.startsWith(term)) score += 50;
    }
    if (descLower.includes(term)) score += 40;
    if (authorLower.includes(term)) score += 30;
    for (const tag of item.tags) {
      if (tag.toLowerCase().includes(term)) score += 60;
    }
    if (item.summary?.toLowerCase().includes(term)) score += 35;
  }

  return score;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useRSSReader() {
  const [feeds, setFeeds] = useState<RSSFeed[]>(() => {
    const saved = loadFeeds();
    if (saved.length > 0) return saved;
    // Initialize with defaults
    const now = Date.now();
    return DEFAULT_FEEDS.map((f, i) => ({
      ...f,
      id: `feed_${i}_${now.toString(36)}`,
      lastFetched: null,
      itemCount: 0,
      unreadCount: 0,
      createdAt: now,
    }));
  });

  const [items, setItems] = useState<RSSItem[]>(() => loadItems());
  const feedsRef = useRef(feeds);
  const itemsRef = useRef(items);

  useEffect(() => { feedsRef.current = feeds; }, [feeds]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Persist on change
  useEffect(() => { saveFeeds(feeds); }, [feeds]);
  useEffect(() => { saveItems(items); }, [items]);

  // Cross-tab sync
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === FEEDS_KEY) setFeeds(loadFeeds());
      if (event.key === ITEMS_KEY) setItems(loadItems());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // ── Feed management ─────────────────────────────────────────────────

  const addFeed = useCallback(
    (url: string, opts?: { title?: string; category?: string; icon?: string }): RSSFeed => {
      const now = Date.now();
      const feed: RSSFeed = {
        id: `feed_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        url,
        title: opts?.title || new URL(url).hostname.replace(/^www\./, ""),
        description: "",
        icon: opts?.icon || "rss",
        category: opts?.category || "Custom",
        lastFetched: null,
        itemCount: 0,
        unreadCount: 0,
        enabled: true,
        createdAt: now,
      };
      setFeeds((prev) => [feed, ...prev]);
      return feed;
    },
    [],
  );

  const removeFeed = useCallback((id: string) => {
    setFeeds((prev) => prev.filter((f) => f.id !== id));
    setItems((prev) => prev.filter((item) => item.feedId !== id));
  }, []);

  // ── Fetch & parse ───────────────────────────────────────────────────

  const refreshFeed = useCallback(async (feedId: string): Promise<RSSItem[]> => {
    const feed = feedsRef.current.find((f) => f.id === feedId);
    if (!feed) return [];

    try {
      // Use a CORS proxy for browser compatibility
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feed.url)}`;
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const xml = await res.text();
      const newItems = parseRSSXml(xml, feedId);

      // Merge: keep existing read/starred state, add new items
      const existingByLink = new Map(itemsRef.current.filter((i) => i.feedId === feedId).map((i) => [i.link, i]));

      const merged = newItems.map((ni) => {
        const existing = existingByLink.get(ni.link);
        if (existing) {
          return { ...ni, id: existing.id, read: existing.read, starred: existing.starred, summary: existing.summary };
        }
        return ni;
      });

      const otherItems = itemsRef.current.filter((i) => i.feedId !== feedId);

      setItems([...merged, ...otherItems].sort((a, b) => b.pubDate - a.pubDate));

      const unread = merged.filter((i) => !i.read).length;
      setFeeds((prev) =>
        prev.map((f) =>
          f.id === feedId
            ? { ...f, lastFetched: Date.now(), itemCount: merged.length, unreadCount: unread }
            : f,
        ),
      );

      return merged;
    } catch (err) {
      console.error(`Failed to refresh feed ${feed.title}:`, err);
      return [];
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const enabled = feedsRef.current.filter((f) => f.enabled);
    await Promise.allSettled(enabled.map((f) => refreshFeed(f.id)));
  }, [refreshFeed]);

  // ── Item operations ─────────────────────────────────────────────────

  const markRead = useCallback((itemId: string) => {
    setItems((prev) => {
      const updated = prev.map((i) => (i.id === itemId ? { ...i, read: true } : i));
      // Update feed unread count
      const item = prev.find((i) => i.id === itemId);
      if (item && !item.read) {
        setFeeds((fPrev) =>
          fPrev.map((f) =>
            f.id === item.feedId ? { ...f, unreadCount: Math.max(0, f.unreadCount - 1) } : f,
          ),
        );
      }
      return updated;
    });
  }, []);

  const markAllRead = useCallback((feedId?: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (feedId && i.feedId !== feedId) return i;
        return { ...i, read: true };
      }),
    );
    setFeeds((prev) =>
      prev.map((f) => {
        if (feedId && f.id !== feedId) return f;
        return { ...f, unreadCount: 0 };
      }),
    );
  }, []);

  const starItem = useCallback((itemId: string) => {
    setItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, starred: !i.starred } : i)),
    );
  }, []);

  // ── Queries ─────────────────────────────────────────────────────────

  const searchItems = useCallback((query: string): RSSItem[] => {
    const q = query.trim();
    if (!q) return itemsRef.current;
    return itemsRef.current
      .map((i) => ({ i, score: scoreItem(i, q) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ i }) => i);
  }, []);

  const getUnread = useCallback((): RSSItem[] => {
    return itemsRef.current.filter((i) => !i.read);
  }, []);

  const getStarred = useCallback((): RSSItem[] => {
    return itemsRef.current.filter((i) => i.starred);
  }, []);

  const getByFeed = useCallback((feedId: string): RSSItem[] => {
    return itemsRef.current.filter((i) => i.feedId === feedId);
  }, []);

  // ── AI summary ──────────────────────────────────────────────────────

  const generateSummary = useCallback(async (itemId: string): Promise<string> => {
    const item = itemsRef.current.find((i) => i.id === itemId);
    if (!item) return "";
    if (item.summary) return item.summary;

    // Build a text-only version of the content for summarization
    const plainText = stripHtml(item.content || item.description).slice(0, 3000);

    const prompt = `Summarize this article in 2-3 concise sentences. Focus on the key points and takeaways.\n\nTitle: ${item.title}\nAuthor: ${item.author}\n\n${plainText}`;

    // Use the chat invoke if available, otherwise return a placeholder
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke("ask_ai", { prompt });
      const summary = typeof result === "string" ? result : "Summary generation unavailable.";
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, summary } : i)),
      );
      return summary;
    } catch {
      const fallback = `${item.title} — ${plainText.slice(0, 200)}...`;
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, summary: fallback } : i)),
      );
      return fallback;
    }
  }, []);

  // ── Stats ───────────────────────────────────────────────────────────

  const stats = useMemo((): RSSStats => {
    const byCategory: Record<string, number> = {};
    for (const f of feeds) {
      byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    }

    let lastRefresh: number | null = null;
    for (const f of feeds) {
      if (f.lastFetched && (!lastRefresh || f.lastFetched > lastRefresh)) {
        lastRefresh = f.lastFetched;
      }
    }

    return {
      totalFeeds: feeds.length,
      totalItems: items.length,
      unreadCount: items.filter((i) => !i.read).length,
      starredCount: items.filter((i) => i.starred).length,
      byCategory,
      lastRefresh,
    };
  }, [feeds, items]);

  return {
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
  };
}
