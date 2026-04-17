import { useState, useCallback } from "react";

/**
 * Collaboration System — share conversations, snippets, and knowledge
 * with other Blade users (or export for non-users).
 *
 * Inspired by Warp's collaborative terminal and Notion's sharing.
 */

export interface SharedItem {
  id: string;
  type: "conversation" | "snippet" | "knowledge" | "template" | "workflow" | "canvas";
  title: string;
  content: string;
  sharedBy: string;
  sharedAt: number;
  expiresAt: number | null;
  accessCount: number;
  password: string | null;
  isPublic: boolean;
}

export interface ShareLink {
  id: string;
  itemId: string;
  url: string;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  maxAccess: number | null;
}

export interface CollaborationStats {
  totalShared: number;
  totalAccesses: number;
  activeLinks: number;
  expiredLinks: number;
}

const STORAGE_KEY = "blade-shared-items";

function loadShared(): SharedItem[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveShared(items: SharedItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

// Generate a shareable markdown export
function exportToMarkdown(item: SharedItem): string {
  const lines = [
    `# ${item.title}`,
    "",
    `> Shared from Blade — ${new Date(item.sharedAt).toLocaleDateString()}`,
    "",
    item.content,
    "",
    "---",
    `*Shared via [Blade](https://slayerblade.site) — Personal AI*`,
  ];
  return lines.join("\n");
}

// Generate a shareable HTML page
function exportToHtml(item: SharedItem): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${item.title} — Shared from Blade</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; background: #09090b; color: #ececef; line-height: 1.6; }
    h1 { color: #6366f1; border-bottom: 1px solid #1c1c22; padding-bottom: 0.5rem; }
    pre { background: #0f0f12; border: 1px solid #1c1c22; border-radius: 8px; padding: 1rem; overflow-x: auto; }
    code { font-family: 'JetBrains Mono', monospace; font-size: 0.9em; }
    a { color: #818cf8; }
    blockquote { border-left: 3px solid #1c1c22; padding-left: 1rem; color: #a1a1aa; }
    .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #1c1c22; color: #52525b; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>${item.title}</h1>
  <blockquote>Shared from Blade — ${new Date(item.sharedAt).toLocaleDateString()}</blockquote>
  <div>${item.content.replace(/\n/g, "<br>")}</div>
  <div class="footer">Shared via <a href="https://slayerblade.site">Blade</a> — Personal AI</div>
</body>
</html>`;
}

// Generate a unique share ID
function generateShareId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 8; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

export function useCollaboration() {
  const [sharedItems, setSharedItems] = useState<SharedItem[]>(loadShared);

  const shareItem = useCallback((
    type: SharedItem["type"],
    title: string,
    content: string,
    options?: {
      expiresIn?: number;  // ms from now
      password?: string;
      isPublic?: boolean;
      maxAccess?: number;
    },
  ): SharedItem => {
    const item: SharedItem = {
      id: generateShareId(),
      type,
      title,
      content,
      sharedBy: "local",
      sharedAt: Date.now(),
      expiresAt: options?.expiresIn ? Date.now() + options.expiresIn : null,
      accessCount: 0,
      password: options?.password || null,
      isPublic: options?.isPublic ?? false,
    };

    setSharedItems((prev) => {
      const next = [...prev, item];
      saveShared(next);
      return next;
    });

    return item;
  }, []);

  const unshareItem = useCallback((id: string) => {
    setSharedItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      saveShared(next);
      return next;
    });
  }, []);

  const getShareableMarkdown = useCallback((id: string): string | null => {
    const item = sharedItems.find((i) => i.id === id);
    return item ? exportToMarkdown(item) : null;
  }, [sharedItems]);

  const getShareableHtml = useCallback((id: string): string | null => {
    const item = sharedItems.find((i) => i.id === id);
    return item ? exportToHtml(item) : null;
  }, [sharedItems]);

  const copyShareLink = useCallback(async (id: string) => {
    const item = sharedItems.find((i) => i.id === id);
    if (!item) return;
    const markdown = exportToMarkdown(item);
    await navigator.clipboard.writeText(markdown);
  }, [sharedItems]);

  const downloadShareable = useCallback((id: string, format: "md" | "html") => {
    const item = sharedItems.find((i) => i.id === id);
    if (!item) return;

    const content = format === "html" ? exportToHtml(item) : exportToMarkdown(item);
    const blob = new Blob([content], { type: format === "html" ? "text/html" : "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.title.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sharedItems]);

  const stats: CollaborationStats = {
    totalShared: sharedItems.length,
    totalAccesses: sharedItems.reduce((s, i) => s + i.accessCount, 0),
    activeLinks: sharedItems.filter((i) => !i.expiresAt || i.expiresAt > Date.now()).length,
    expiredLinks: sharedItems.filter((i) => i.expiresAt && i.expiresAt <= Date.now()).length,
  };

  return {
    sharedItems,
    shareItem,
    unshareItem,
    getShareableMarkdown,
    getShareableHtml,
    copyShareLink,
    downloadShareable,
    stats,
  };
}
