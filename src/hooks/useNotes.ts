import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface Note {
  id: string;
  title: string;
  content: string;
  format: "markdown" | "plain" | "checklist";
  folder: string;
  tags: string[];
  links: string[];           // IDs of linked notes (backlinks)
  pinned: boolean;
  archived: boolean;
  color: string | null;
  wordCount: number;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
}

export interface NoteFolder {
  id: string;
  name: string;
  icon: string;
  noteCount: number;
}

export interface NoteStats {
  total: number;
  pinned: number;
  archived: number;
  byFolder: Record<string, number>;
  byFormat: Record<string, number>;
  totalWords: number;
  totalLinks: number;
  totalTags: number;
  recentlyEdited: number;
}

export type NoteSort = "updated" | "created" | "title" | "words";
export type ExportFormat = "markdown" | "plain";

// ── Constants ──────────────────────────────────────────────────────────

const NOTES_KEY = "blade-notes";
const FOLDERS_KEY = "blade-note-folders";

const DEFAULT_FOLDERS: NoteFolder[] = [
  { id: "quick-notes", name: "Quick Notes", icon: "zap", noteCount: 0 },
  { id: "ideas", name: "Ideas", icon: "lightbulb", noteCount: 0 },
  { id: "reference", name: "Reference", icon: "book-open", noteCount: 0 },
  { id: "archive", name: "Archive", icon: "archive", noteCount: 0 },
];

// ── Helpers ────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Extract [[Wiki Link]] references from content. */
const WIKI_LINK_RE = /\[\[([^\]]+)\]\]/g;

function extractWikiLinks(content: string): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    matches.push(m[1].trim());
  }
  return [...new Set(matches)];
}

/** Resolve wiki-link titles to note IDs. */
function resolveWikiLinks(titles: string[], allNotes: Note[]): string[] {
  const titleMap = new Map<string, string>();
  for (const n of allNotes) {
    titleMap.set(n.title.toLowerCase(), n.id);
  }
  const ids: string[] = [];
  for (const t of titles) {
    const id = titleMap.get(t.toLowerCase());
    if (id) ids.push(id);
  }
  return [...new Set(ids)];
}

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveNotes(notes: Note[]): void {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function loadFolders(): NoteFolder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (!raw) return DEFAULT_FOLDERS;
    const parsed: NoteFolder[] = JSON.parse(raw);
    // Ensure default folders exist
    const ids = new Set(parsed.map((f) => f.id));
    for (const df of DEFAULT_FOLDERS) {
      if (!ids.has(df.id)) parsed.push(df);
    }
    return parsed;
  } catch {
    return DEFAULT_FOLDERS;
  }
}

function saveFolders(folders: NoteFolder[]): void {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

function recountFolders(folders: NoteFolder[], notes: Note[]): NoteFolder[] {
  const counts: Record<string, number> = {};
  for (const n of notes) {
    if (!n.archived) {
      counts[n.folder] = (counts[n.folder] || 0) + 1;
    }
  }
  return folders.map((f) => ({ ...f, noteCount: counts[f.id] || 0 }));
}

// ── Export / Import helpers ────────────────────────────────────────────

function noteToMarkdown(note: Note): string {
  const lines: string[] = [];
  lines.push(`# ${note.title}`);
  lines.push("");
  if (note.tags.length) {
    lines.push(`> Tags: ${note.tags.join(", ")}`);
    lines.push("");
  }
  if (note.format === "checklist") {
    for (const line of note.content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) { lines.push(""); continue; }
      if (trimmed.startsWith("[x]") || trimmed.startsWith("[X]")) {
        lines.push(`- [x] ${trimmed.slice(3).trim()}`);
      } else if (trimmed.startsWith("[ ]") || trimmed.startsWith("[]")) {
        lines.push(`- [ ] ${trimmed.slice(trimmed.startsWith("[]") ? 2 : 3).trim()}`);
      } else {
        lines.push(`- [ ] ${trimmed}`);
      }
    }
  } else {
    lines.push(note.content);
  }
  lines.push("");
  lines.push(`---`);
  lines.push(`Created: ${new Date(note.createdAt).toISOString()}`);
  lines.push(`Updated: ${new Date(note.updatedAt).toISOString()}`);
  return lines.join("\n");
}

function noteToPlainText(note: Note): string {
  const lines: string[] = [];
  lines.push(note.title);
  lines.push("=".repeat(note.title.length));
  lines.push("");
  lines.push(note.content);
  if (note.tags.length) {
    lines.push("");
    lines.push(`Tags: ${note.tags.join(", ")}`);
  }
  return lines.join("\n");
}

function parseImportedMarkdown(text: string): Partial<Note> {
  const lines = text.split("\n");
  let title = "Imported Note";
  let contentStart = 0;
  const tags: string[] = [];

  // Extract title from first heading
  if (lines[0]?.startsWith("# ")) {
    title = lines[0].slice(2).trim();
    contentStart = 1;
    if (!lines[1]?.trim()) contentStart = 2;
  }

  // Check for tag line
  if (lines[contentStart]?.startsWith("> Tags:")) {
    const tagLine = lines[contentStart].slice(7).trim();
    tags.push(...tagLine.split(",").map((t) => t.trim()).filter(Boolean));
    contentStart++;
    if (!lines[contentStart]?.trim()) contentStart++;
  }

  // Strip footer
  let contentEnd = lines.length;
  for (let i = lines.length - 1; i >= contentStart; i--) {
    if (lines[i]?.startsWith("---")) {
      contentEnd = i;
      break;
    }
  }

  const content = lines.slice(contentStart, contentEnd).join("\n").trimEnd();

  return { title, content, tags };
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>(loadNotes);
  const [folders, setFolders] = useState<NoteFolder[]>(loadFolders);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  // Persist on change
  useEffect(() => { saveNotes(notes); }, [notes]);
  useEffect(() => { saveFolders(folders); }, [folders]);

  // Recount folder totals when notes change
  useEffect(() => {
    setFolders((prev) => recountFolders(prev, notes));
  }, [notes]);

  // ── Active note ───────────────────────────────────────────────────
  const activeNote = useMemo(
    () => notes.find((n) => n.id === activeNoteId) ?? null,
    [notes, activeNoteId],
  );

  const openNote = useCallback((id: string) => {
    setActiveNoteId(id);
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, lastOpenedAt: Date.now() } : n)),
    );
  }, []);

  // ── CRUD ──────────────────────────────────────────────────────────
  const createNote = useCallback(
    (partial?: Partial<Note>): Note => {
      const now = Date.now();
      const note: Note = {
        id: uid(),
        title: partial?.title ?? "Untitled",
        content: partial?.content ?? "",
        format: partial?.format ?? "markdown",
        folder: partial?.folder ?? "quick-notes",
        tags: partial?.tags ?? [],
        links: partial?.links ?? [],
        pinned: partial?.pinned ?? false,
        archived: false,
        color: partial?.color ?? null,
        wordCount: countWords(partial?.content ?? ""),
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now,
      };
      setNotes((prev) => [note, ...prev]);
      setActiveNoteId(note.id);
      return note;
    },
    [],
  );

  const updateNote = useCallback(
    (id: string, changes: Partial<Note>) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id !== id) return n;
          const updated = { ...n, ...changes, updatedAt: Date.now() };
          // Recount words if content changed
          if (changes.content !== undefined) {
            updated.wordCount = countWords(changes.content);
          }
          // Auto-resolve wiki links if content changed
          if (changes.content !== undefined) {
            const wikiTitles = extractWikiLinks(changes.content);
            const wikiIds = resolveWikiLinks(wikiTitles, prev);
            // Merge with existing manual links, avoiding duplicates
            const existingManual = updated.links.filter((l) => !wikiIds.includes(l));
            // Keep manual links, add resolved wiki links
            updated.links = [...new Set([...existingManual, ...wikiIds])];
          }
          return updated;
        }),
      );
    },
    [],
  );

  const deleteNote = useCallback(
    (id: string) => {
      setNotes((prev) => {
        // Remove this note AND unlink it from all notes that reference it
        return prev
          .filter((n) => n.id !== id)
          .map((n) => ({
            ...n,
            links: n.links.filter((l) => l !== id),
          }));
      });
      if (activeNoteId === id) setActiveNoteId(null);
    },
    [activeNoteId],
  );

  const archiveNote = useCallback(
    (id: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, archived: !n.archived, folder: !n.archived ? "archive" : "quick-notes", updatedAt: Date.now() }
            : n,
        ),
      );
    },
    [],
  );

  const pinNote = useCallback(
    (id: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n,
        ),
      );
    },
    [],
  );

  const moveToFolder = useCallback(
    (noteId: string, folderId: string) => {
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, folder: folderId, updatedAt: Date.now() } : n,
        ),
      );
    },
    [],
  );

  // ── Folders ───────────────────────────────────────────────────────
  const addFolder = useCallback(
    (name: string, icon: string = "folder") => {
      const folder: NoteFolder = { id: uid(), name, icon, noteCount: 0 };
      setFolders((prev) => [...prev, folder]);
      return folder;
    },
    [],
  );

  const removeFolder = useCallback(
    (folderId: string) => {
      // Prevent removing default folders
      if (DEFAULT_FOLDERS.some((f) => f.id === folderId)) return;
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      // Move notes from deleted folder to Quick Notes
      setNotes((prev) =>
        prev.map((n) =>
          n.folder === folderId ? { ...n, folder: "quick-notes", updatedAt: Date.now() } : n,
        ),
      );
    },
    [],
  );

  // ── Links & Backlinks ─────────────────────────────────────────────
  const getBacklinks = useCallback(
    (noteId: string): Note[] => {
      return notes.filter((n) => n.id !== noteId && n.links.includes(noteId));
    },
    [notes],
  );

  const linkNotes = useCallback(
    (fromId: string, toId: string) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id === fromId && !n.links.includes(toId)) {
            return { ...n, links: [...n.links, toId], updatedAt: Date.now() };
          }
          if (n.id === toId && !n.links.includes(fromId)) {
            return { ...n, links: [...n.links, fromId], updatedAt: Date.now() };
          }
          return n;
        }),
      );
    },
    [],
  );

  const unlinkNotes = useCallback(
    (fromId: string, toId: string) => {
      setNotes((prev) =>
        prev.map((n) => {
          if (n.id === fromId) {
            return { ...n, links: n.links.filter((l) => l !== toId), updatedAt: Date.now() };
          }
          if (n.id === toId) {
            return { ...n, links: n.links.filter((l) => l !== fromId), updatedAt: Date.now() };
          }
          return n;
        }),
      );
    },
    [],
  );

  // ── Search ────────────────────────────────────────────────────────
  const searchNotes = useCallback(
    (query: string): Note[] => {
      if (!query.trim()) return notes.filter((n) => !n.archived);
      const q = query.toLowerCase();
      return notes.filter(
        (n) =>
          !n.archived &&
          (n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q))),
      );
    },
    [notes],
  );

  const getRecentNotes = useCallback(
    (limit: number = 10): Note[] => {
      return [...notes]
        .filter((n) => !n.archived)
        .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
        .slice(0, limit);
    },
    [notes],
  );

  // ── Export / Import ───────────────────────────────────────────────
  const exportNote = useCallback(
    (noteId: string, format: ExportFormat = "markdown"): string | null => {
      const note = notes.find((n) => n.id === noteId);
      if (!note) return null;
      return format === "markdown" ? noteToMarkdown(note) : noteToPlainText(note);
    },
    [notes],
  );

  const importNote = useCallback(
    (text: string, format: "markdown" | "plain" = "markdown"): Note => {
      if (format === "markdown") {
        const parsed = parseImportedMarkdown(text);
        return createNote({
          title: parsed.title,
          content: parsed.content,
          tags: parsed.tags,
          format: "markdown",
        });
      }
      // Plain text: first line = title, rest = content
      const lines = text.split("\n");
      const title = lines[0]?.trim() || "Imported Note";
      const content = lines.slice(1).join("\n").trim();
      return createNote({ title, content, format: "plain" });
    },
    [createNote],
  );

  // ── Stats ─────────────────────────────────────────────────────────
  const stats = useMemo<NoteStats>(() => {
    const now = Date.now();
    const dayAgo = now - 86_400_000;
    const byFolder: Record<string, number> = {};
    const byFormat: Record<string, number> = {};
    let totalWords = 0;
    let totalLinks = 0;
    const tagSet = new Set<string>();
    let recentlyEdited = 0;

    for (const n of notes) {
      byFolder[n.folder] = (byFolder[n.folder] || 0) + 1;
      byFormat[n.format] = (byFormat[n.format] || 0) + 1;
      totalWords += n.wordCount;
      totalLinks += n.links.length;
      for (const t of n.tags) tagSet.add(t.toLowerCase());
      if (n.updatedAt > dayAgo) recentlyEdited++;
    }

    return {
      total: notes.length,
      pinned: notes.filter((n) => n.pinned).length,
      archived: notes.filter((n) => n.archived).length,
      byFolder,
      byFormat,
      totalWords,
      totalLinks,
      totalTags: tagSet.size,
      recentlyEdited,
    };
  }, [notes]);

  return {
    notes,
    folders,
    activeNote,
    activeNoteId,
    openNote,
    setActiveNoteId,
    createNote,
    updateNote,
    deleteNote,
    archiveNote,
    pinNote,
    moveToFolder,
    addFolder,
    removeFolder,
    searchNotes,
    getBacklinks,
    linkNotes,
    unlinkNotes,
    getRecentNotes,
    exportNote,
    importNote,
    stats,
  };
}
