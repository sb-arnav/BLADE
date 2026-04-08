import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  description: string;
  summary?: string;
  tags: string[];
  folder: string;
  favicon?: string;
  addedAt: number;
  readAt: number | null;
  isRead: boolean;
  source: "manual" | "conversation" | "auto";
  notes: string;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  icon: string;
  count: number;
}

export interface BookmarkStats {
  total: number;
  unread: number;
  byFolder: Record<string, number>;
  bySource: Record<string, number>;
  totalTags: number;
  recentlyAdded: number;
}

export type BookmarkSort = "newest" | "oldest" | "unread-first";

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-bookmarks";
const FOLDERS_KEY = "blade-bookmark-folders";

const DEFAULT_FOLDERS: BookmarkFolder[] = [
  { id: "read-later", name: "Read Later", icon: "clock", count: 0 },
  { id: "references", name: "References", icon: "book", count: 0 },
  { id: "tools", name: "Tools", icon: "wrench", count: 0 },
  { id: "articles", name: "Articles", icon: "newspaper", count: 0 },
];

// ── URL extraction ─────────────────────────────────────────────────────

const URL_REGEX =
  /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/g;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  // Deduplicate, strip trailing punctuation that got captured
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of matches) {
    const url = raw.replace(/[.)>,;:!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      cleaned.push(url);
    }
  }
  return cleaned;
}

/** Attempt to derive a title from a URL path. */
function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname
      .split("/")
      .filter(Boolean)
      .pop();

    if (path) {
      const decoded = decodeURIComponent(path)
        .replace(/[-_]/g, " ")
        .replace(/\.\w+$/, "");
      // Capitalize first letter of each word
      const titled = decoded
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      return `${titled} - ${host}`;
    }
    return host;
  } catch {
    return url.slice(0, 60);
  }
}

/** Build a favicon URL from a domain. */
function faviconUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${parsed.hostname}&sz=32`;
  } catch {
    return "";
  }
}

/** Auto-detect tags from a URL. */
function autoTagFromUrl(url: string): string[] {
  const tags: string[] = [];
  const lower = url.toLowerCase();

  const domainTags: Record<string, string> = {
    "github.com": "GitHub",
    "stackoverflow.com": "StackOverflow",
    "dev.to": "dev.to",
    "medium.com": "Medium",
    "arxiv.org": "Research",
    "docs.google.com": "Docs",
    "notion.so": "Notion",
    "figma.com": "Design",
    "youtube.com": "Video",
    "youtu.be": "Video",
    "twitter.com": "Twitter",
    "x.com": "Twitter",
    "reddit.com": "Reddit",
    "npmjs.com": "npm",
    "crates.io": "Rust",
    "pypi.org": "Python",
    "developer.mozilla.org": "MDN",
    "docs.rs": "Rust",
    "huggingface.co": "AI/ML",
    "openai.com": "AI/ML",
    "anthropic.com": "AI/ML",
  };

  for (const [domain, tag] of Object.entries(domainTags)) {
    if (lower.includes(domain)) {
      tags.push(tag);
      break;
    }
  }

  // Path-based hints
  if (lower.includes("/blog")) tags.push("Blog");
  if (lower.includes("/docs") || lower.includes("/documentation")) tags.push("Documentation");
  if (lower.includes("/api")) tags.push("API");
  if (lower.includes("/tutorial")) tags.push("Tutorial");
  if (lower.includes("/release")) tags.push("Release");

  return tags;
}

// ── Persistence helpers ────────────────────────────────────────────────

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks: Bookmark[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

function loadFolders(): BookmarkFolder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return [...DEFAULT_FOLDERS];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [...DEFAULT_FOLDERS];
  } catch {
    return [...DEFAULT_FOLDERS];
  }
}

function saveFolders(folders: BookmarkFolder[]) {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

// ── Search scoring ─────────────────────────────────────────────────────

function scoreBookmark(bookmark: Bookmark, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const terms = q.split(/\s+/).filter(Boolean);
  let score = 0;

  const titleLower = bookmark.title.toLowerCase();
  const urlLower = bookmark.url.toLowerCase();
  const descLower = bookmark.description.toLowerCase();
  const notesLower = bookmark.notes.toLowerCase();
  const tagsLower = bookmark.tags.map((t) => t.toLowerCase());

  for (const term of terms) {
    if (titleLower.includes(term)) {
      score += 100;
      if (titleLower.startsWith(term)) score += 50;
    }
    if (urlLower.includes(term)) score += 60;
    for (const tag of tagsLower) {
      if (tag === term) score += 80;
      else if (tag.includes(term)) score += 40;
    }
    if (descLower.includes(term)) score += 30;
    if (notesLower.includes(term)) score += 20;
    if (bookmark.summary?.toLowerCase().includes(term)) score += 25;
  }

  return score;
}

// ── OPML export ────────────────────────────────────────────────────────

function buildOpml(bookmarks: Bookmark[], folders: BookmarkFolder[]): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let opml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  opml += `<opml version="2.0">\n`;
  opml += `  <head><title>Blade Bookmarks</title></head>\n`;
  opml += `  <body>\n`;

  for (const folder of folders) {
    const items = bookmarks.filter((b) => b.folder === folder.id);
    if (items.length === 0) continue;
    opml += `    <outline text="${escape(folder.name)}">\n`;
    for (const bk of items) {
      opml += `      <outline type="link" text="${escape(bk.title)}" url="${escape(bk.url)}" description="${escape(bk.description)}" />\n`;
    }
    opml += `    </outline>\n`;
  }

  // Unfiled bookmarks
  const unfiled = bookmarks.filter((b) => !folders.some((f) => f.id === b.folder));
  if (unfiled.length > 0) {
    opml += `    <outline text="Unfiled">\n`;
    for (const bk of unfiled) {
      opml += `      <outline type="link" text="${escape(bk.title)}" url="${escape(bk.url)}" description="${escape(bk.description)}" />\n`;
    }
    opml += `    </outline>\n`;
  }

  opml += `  </body>\n</opml>`;
  return opml;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => loadBookmarks());
  const [folders, setFolders] = useState<BookmarkFolder[]>(() => loadFolders());
  const bookmarksRef = useRef(bookmarks);

  useEffect(() => {
    bookmarksRef.current = bookmarks;
  }, [bookmarks]);

  // Persist on change
  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    saveFolders(folders);
  }, [folders]);

  // Cross-tab sync
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setBookmarks(loadBookmarks());
      if (event.key === FOLDERS_KEY) setFolders(loadFolders());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Recompute folder counts whenever bookmarks change
  useEffect(() => {
    setFolders((prev) =>
      prev.map((f) => ({
        ...f,
        count: bookmarks.filter((b) => b.folder === f.id).length,
      })),
    );
  }, [bookmarks]);

  // ── CRUD ─────────────────────────────────────────────────────────────

  const addBookmark = useCallback(
    (
      partial: Pick<Bookmark, "url"> &
        Partial<Omit<Bookmark, "id" | "addedAt">>,
    ): Bookmark => {
      const now = Date.now();
      const autoTags = autoTagFromUrl(partial.url);
      const manualTags = (partial.tags ?? []).filter(Boolean);

      const tagSet = new Set<string>();
      const finalTags: string[] = [];
      for (const tag of [...manualTags, ...autoTags]) {
        const lower = tag.toLowerCase();
        if (!tagSet.has(lower)) {
          tagSet.add(lower);
          finalTags.push(tag);
        }
      }

      const bookmark: Bookmark = {
        id: crypto.randomUUID(),
        url: partial.url,
        title: partial.title || titleFromUrl(partial.url),
        description: partial.description ?? "",
        summary: partial.summary,
        tags: finalTags,
        folder: partial.folder ?? "read-later",
        favicon: partial.favicon || faviconUrl(partial.url),
        addedAt: now,
        readAt: null,
        isRead: false,
        source: partial.source ?? "manual",
        notes: partial.notes ?? "",
      };

      setBookmarks((prev) => [bookmark, ...prev]);
      return bookmark;
    },
    [],
  );

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const updateBookmark = useCallback(
    (id: string, changes: Partial<Omit<Bookmark, "id" | "addedAt">>) => {
      setBookmarks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, ...changes } : b)),
      );
    },
    [],
  );

  const toggleRead = useCallback((id: string) => {
    setBookmarks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const nowRead = !b.isRead;
        return { ...b, isRead: nowRead, readAt: nowRead ? Date.now() : null };
      }),
    );
  }, []);

  const moveToFolder = useCallback((id: string, folderId: string) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, folder: folderId } : b)),
    );
  }, []);

  // ── Folder management ────────────────────────────────────────────────

  const addFolder = useCallback(
    (name: string, icon: string = "folder"): BookmarkFolder => {
      const folder: BookmarkFolder = {
        id: `folder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        icon,
        count: 0,
      };
      setFolders((prev) => [...prev, folder]);
      return folder;
    },
    [],
  );

  const removeFolder = useCallback(
    (folderId: string) => {
      // Move bookmarks from deleted folder to "read-later"
      setBookmarks((prev) =>
        prev.map((b) => (b.folder === folderId ? { ...b, folder: "read-later" } : b)),
      );
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
    },
    [],
  );

  // ── Queries ──────────────────────────────────────────────────────────

  const search = useCallback(
    (query: string): Bookmark[] => {
      const q = query.trim();
      if (!q) return bookmarksRef.current;

      return bookmarksRef.current
        .map((b) => ({ b, score: scoreBookmark(b, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ b }) => b);
    },
    [],
  );

  const getByFolder = useCallback(
    (folderId: string): Bookmark[] => {
      return bookmarksRef.current.filter((b) => b.folder === folderId);
    },
    [],
  );

  const getUnread = useCallback((): Bookmark[] => {
    return bookmarksRef.current.filter((b) => !b.isRead);
  }, []);

  // ── Import from conversation ─────────────────────────────────────────

  const importFromConversation = useCallback(
    (messages: { role: string; content: string }[]): Bookmark[] => {
      const allUrls = new Set<string>();
      const existing = new Set(bookmarksRef.current.map((b) => b.url));

      for (const msg of messages) {
        if (!msg.content) continue;
        const urls = extractUrls(msg.content);
        for (const url of urls) {
          if (!existing.has(url)) allUrls.add(url);
        }
      }

      const created: Bookmark[] = [];
      for (const url of allUrls) {
        const bookmark = addBookmark({
          url,
          source: "conversation",
          folder: "read-later",
        });
        created.push(bookmark);
      }

      return created;
    },
    [addBookmark],
  );

  // ── Export ───────────────────────────────────────────────────────────

  const exportAsOpml = useCallback(() => {
    const opml = buildOpml(bookmarksRef.current, folders);
    const blob = new Blob([opml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "blade-bookmarks.opml";
    a.click();
    URL.revokeObjectURL(url);
  }, [folders]);

  // ── Stats ────────────────────────────────────────────────────────────

  const stats = useMemo((): BookmarkStats => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const byFolder: Record<string, number> = {};
    const bySource: Record<string, number> = {};
    const allTags = new Set<string>();
    let unread = 0;
    let recentlyAdded = 0;

    for (const b of bookmarks) {
      byFolder[b.folder] = (byFolder[b.folder] ?? 0) + 1;
      bySource[b.source] = (bySource[b.source] ?? 0) + 1;
      b.tags.forEach((t) => allTags.add(t.toLowerCase()));
      if (!b.isRead) unread++;
      if (b.addedAt > weekAgo) recentlyAdded++;
    }

    return {
      total: bookmarks.length,
      unread,
      byFolder,
      bySource,
      totalTags: allTags.size,
      recentlyAdded,
    };
  }, [bookmarks]);

  return {
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
    getByFolder,
    getUnread,
    importFromConversation,
    exportAsOpml,
    stats,
  };
}
