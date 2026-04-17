import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useNotes, Note, ExportFormat } from "../hooks/useNotes";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const NOTE_COLORS: { value: string | null; label: string; tw: string }[] = [
  { value: null, label: "None", tw: "" },
  { value: "amber", label: "Amber", tw: "bg-amber-500/6" },
  { value: "rose", label: "Rose", tw: "bg-rose-500/6" },
  { value: "blue", label: "Blue", tw: "bg-blue-500/6" },
  { value: "emerald", label: "Green", tw: "bg-emerald-500/6" },
  { value: "violet", label: "Violet", tw: "bg-violet-500/6" },
  { value: "orange", label: "Orange", tw: "bg-orange-500/6" },
  { value: "cyan", label: "Cyan", tw: "bg-cyan-500/6" },
];

const FOLDER_ICONS: Record<string, string> = {
  zap: "M13 10V3L4 14h7v7l9-11h-7z",
  lightbulb: "M9.663 17h4.674M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  "book-open": "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253",
  archive: "M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4",
  folder: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z",
  star: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function colorBg(color: string | null): string {
  const c = NOTE_COLORS.find((nc) => nc.value === color);
  return c?.tw ?? "";
}

function preview(content: string, max: number = 60): string {
  const first = content.split("\n").find((l) => l.trim()) ?? "";
  return first.length > max ? first.slice(0, max) + "..." : first;
}

function SvgIcon({ path, className = "w-4 h-4" }: { path: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

// ── Virtual folder types ─────────────────────────────────────────────────────

type VirtualFolder = "all" | "pinned" | "recent" | string;

// ── Component ────────────────────────────────────────────────────────────────

export default function NotesPanel({ onBack, onSendToChat }: Props) {
  const {
    notes,
    folders,
    activeNote,
    openNote,
    createNote,
    updateNote,
    deleteNote,
    archiveNote,
    pinNote,
    moveToFolder,
    addFolder,
    searchNotes,
    getBacklinks,
    linkNotes,
    exportNote,
    getRecentNotes,
    importNote,
    stats,
  } = useNotes();

  // ── Local state ─────────────────────────────────────────────────────────
  const [selectedFolder, setSelectedFolder] = useState<VirtualFolder>("all");
  const [search, setSearch] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [wikiSearch, setWikiSearch] = useState<string | null>(null);
  const [wikiResults, setWikiResults] = useState<Note[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // ── Filtered notes ──────────────────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    let pool: Note[];
    if (search.trim()) {
      pool = searchNotes(search);
    } else if (selectedFolder === "all") {
      pool = notes.filter((n) => !n.archived);
    } else if (selectedFolder === "pinned") {
      pool = notes.filter((n) => n.pinned && !n.archived);
    } else if (selectedFolder === "recent") {
      pool = getRecentNotes(30);
    } else {
      pool = notes.filter((n) => n.folder === selectedFolder && !n.archived);
    }
    return pool.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  }, [notes, selectedFolder, search, searchNotes, getRecentNotes]);

  // ── Backlinks for active note ───────────────────────────────────────────
  const backlinks = useMemo(() => {
    if (!activeNote) return [];
    return getBacklinks(activeNote.id);
  }, [activeNote, getBacklinks]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Ctrl+N — new note
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        handleNewNote();
      }
      // Ctrl+Shift+F — focus search
      if (e.ctrlKey && e.shiftKey && e.key === "F") {
        e.preventDefault();
        document.getElementById("notes-search")?.focus();
      }
      // Ctrl+P — pin active note
      if (e.ctrlKey && e.key === "p" && activeNote) {
        e.preventDefault();
        pinNote(activeNote.id);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeNote, pinNote]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleNewNote = useCallback(() => {
    const note = createNote({ folder: selectedFolder === "all" || selectedFolder === "pinned" || selectedFolder === "recent" ? "quick-notes" : selectedFolder });
    openNote(note.id);
    setTimeout(() => titleRef.current?.focus(), 50);
  }, [createNote, openNote, selectedFolder]);

  const handleContentChange = useCallback(
    (value: string) => {
      if (!activeNote) return;
      updateNote(activeNote.id, { content: value });

      // Wiki link detection: check if user just typed [[
      const cursor = editorRef.current?.selectionStart ?? 0;
      const before = value.slice(0, cursor);
      const wikiMatch = before.match(/\[\[([^\]]*)$/);
      if (wikiMatch) {
        const query = wikiMatch[1];
        setWikiSearch(query);
        const results = notes
          .filter((n) => n.id !== activeNote.id && n.title.toLowerCase().includes(query.toLowerCase()))
          .slice(0, 8);
        setWikiResults(results);
      } else {
        setWikiSearch(null);
        setWikiResults([]);
      }
    },
    [activeNote, updateNote, notes],
  );

  const handleWikiSelect = useCallback(
    (target: Note) => {
      if (!activeNote || !editorRef.current) return;
      const el = editorRef.current;
      const cursor = el.selectionStart;
      const content = activeNote.content;
      // Find the [[ and replace with [[Title]]
      const before = content.slice(0, cursor);
      const bracketPos = before.lastIndexOf("[[");
      if (bracketPos === -1) return;
      const after = content.slice(cursor);
      const newContent = content.slice(0, bracketPos) + `[[${target.title}]]` + after;
      updateNote(activeNote.id, { content: newContent });
      linkNotes(activeNote.id, target.id);
      setWikiSearch(null);
      setWikiResults([]);
      setTimeout(() => {
        const newPos = bracketPos + target.title.length + 4;
        el.setSelectionRange(newPos, newPos);
        el.focus();
      }, 10);
    },
    [activeNote, updateNote, linkNotes],
  );

  const handleAddTag = useCallback(() => {
    if (!activeNote || !tagInput.trim()) return;
    const newTags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && !activeNote.tags.includes(t));
    if (newTags.length) {
      updateNote(activeNote.id, { tags: [...activeNote.tags, ...newTags] });
    }
    setTagInput("");
  }, [activeNote, tagInput, updateNote]);

  const handleRemoveTag = useCallback(
    (tag: string) => {
      if (!activeNote) return;
      updateNote(activeNote.id, { tags: activeNote.tags.filter((t) => t !== tag) });
    },
    [activeNote, updateNote],
  );

  const handleExport = useCallback(
    (format: ExportFormat) => {
      if (!activeNote) return;
      const text = exportNote(activeNote.id, format);
      if (!text) return;
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${activeNote.title.replace(/[^a-zA-Z0-9-_ ]/g, "")}.${format === "markdown" ? "md" : "txt"}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [activeNote, exportNote],
  );

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.txt,.markdown";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ext = file.name.split(".").pop()?.toLowerCase();
      importNote(text, ext === "md" || ext === "markdown" ? "markdown" : "plain");
    };
    input.click();
  }, [importNote]);

  const handleToggleChecklist = useCallback(() => {
    if (!activeNote) return;
    const newFormat = activeNote.format === "checklist" ? "markdown" : "checklist";
    updateNote(activeNote.id, { format: newFormat });
  }, [activeNote, updateNote]);

  const handleChecklistToggle = useCallback(
    (lineIdx: number) => {
      if (!activeNote) return;
      const lines = activeNote.content.split("\n");
      const line = lines[lineIdx];
      if (!line) return;
      if (line.match(/^\[x\]/i)) {
        lines[lineIdx] = line.replace(/^\[x\]/i, "[ ]");
      } else if (line.match(/^\[ ?\]/)) {
        lines[lineIdx] = line.replace(/^\[ ?\]/, "[x]");
      }
      updateNote(activeNote.id, { content: lines.join("\n") });
    },
    [activeNote, updateNote],
  );

  const handleAddFolder = useCallback(() => {
    if (!newFolderName.trim()) return;
    addFolder(newFolderName.trim());
    setNewFolderName("");
    setShowNewFolder(false);
  }, [newFolderName, addFolder]);

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderFolderIcon = (icon: string) => {
    const path = FOLDER_ICONS[icon] ?? FOLDER_ICONS.folder;
    return <SvgIcon path={path} className="w-4 h-4 shrink-0" />;
  };

  // ── Render: Folders Column ──────────────────────────────────────────────
  const renderFolders = () => (
    <div className="w-40 shrink-0 border-r border-blade-border flex flex-col bg-blade-base/50">
      {/* Header */}
      <div className="p-3 border-b border-blade-border">
        <div className="flex items-center justify-between mb-2">
          <button onClick={onBack} className="text-blade-muted hover:text-blade-primary transition-colors" title="Back">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-xs font-semibold text-blade-primary tracking-wide uppercase">Notes</span>
          <button onClick={handleNewNote} className="text-blade-accent hover:text-blade-accent/80 transition-colors" title="New Note (Ctrl+N)">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
        <div className="text-2xs text-blade-muted">{stats.total} notes, {stats.totalWords} words</div>
      </div>

      {/* Virtual folders */}
      <div className="p-2 space-y-0.5">
        {[
          { id: "all" as const, label: "All Notes", icon: "folder", count: notes.filter((n) => !n.archived).length },
          { id: "pinned" as const, label: "Pinned", icon: "star", count: stats.pinned },
          { id: "recent" as const, label: "Recent", icon: "zap", count: 0 },
        ].map((vf) => (
          <button
            key={vf.id}
            onClick={() => setSelectedFolder(vf.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
              selectedFolder === vf.id
                ? "bg-blade-accent/10 text-blade-accent"
                : "text-blade-secondary hover:bg-blade-surface hover:text-blade-primary"
            }`}
          >
            {renderFolderIcon(vf.icon)}
            <span className="flex-1 text-left truncate">{vf.label}</span>
            {vf.count > 0 && <span className="text-2xs text-blade-muted">{vf.count}</span>}
          </button>
        ))}
      </div>

      <div className="px-3 py-1">
        <div className="border-t border-blade-border" />
      </div>

      {/* Real folders */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {folders.map((f) => (
          <button
            key={f.id}
            onClick={() => setSelectedFolder(f.id)}
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all group ${
              selectedFolder === f.id
                ? "bg-blade-accent/10 text-blade-accent"
                : "text-blade-secondary hover:bg-blade-surface hover:text-blade-primary"
            }`}
          >
            {renderFolderIcon(f.icon)}
            <span className="flex-1 text-left truncate">{f.name}</span>
            <span className="text-2xs text-blade-muted">{f.noteCount}</span>
          </button>
        ))}
      </div>

      {/* Add folder */}
      <div className="p-2 border-t border-blade-border">
        {showNewFolder ? (
          <div className="flex items-center gap-1">
            <input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddFolder()}
              placeholder="Folder name"
              autoFocus
              className="flex-1 bg-blade-surface border border-blade-border rounded px-1.5 py-1 text-xs text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40"
            />
            <button onClick={handleAddFolder} className="text-blade-accent text-xs px-1">+</button>
            <button onClick={() => { setShowNewFolder(false); setNewFolderName(""); }} className="text-blade-muted text-xs px-1">x</button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            <span>New Folder</span>
          </button>
        )}
      </div>
    </div>
  );

  // ── Render: Note List Column ────────────────────────────────────────────
  const renderNoteList = () => (
    <div className="w-56 shrink-0 border-r border-blade-border flex flex-col bg-blade-base/30">
      {/* Search */}
      <div className="p-2 border-b border-blade-border">
        <div className="relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blade-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            id="notes-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes... (Ctrl+Shift+F)"
            className="w-full bg-blade-surface border border-blade-border rounded-lg pl-7 pr-2 py-1.5 text-xs text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-blade-muted hover:text-blade-primary text-xs">
              x
            </button>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-xs text-blade-muted">No notes found</p>
            <button onClick={handleNewNote} className="mt-2 text-xs text-blade-accent hover:text-blade-accent/80 transition-colors">
              Create one
            </button>
          </div>
        ) : (
          filteredNotes.map((note) => (
            <button
              key={note.id}
              onClick={() => openNote(note.id)}
              className={`w-full text-left p-2.5 border-b border-blade-border/50 transition-all ${
                activeNote?.id === note.id
                  ? "bg-blade-accent/8"
                  : "hover:bg-blade-surface/60"
              } ${colorBg(note.color)}`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {note.pinned && (
                  <svg className="w-3 h-3 text-blade-accent shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                )}
                <span className="text-xs font-medium text-blade-primary truncate flex-1">
                  {note.title || "Untitled"}
                </span>
                {note.format === "checklist" && (
                  <svg className="w-3 h-3 text-blade-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                )}
              </div>
              <p className="text-2xs text-blade-muted truncate">{preview(note.content) || "Empty note"}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-2xs text-blade-muted/60">{timeAgo(note.updatedAt)}</span>
                {note.tags.length > 0 && (
                  <div className="flex items-center gap-1 overflow-hidden flex-1">
                    {note.tags.slice(0, 2).map((t) => (
                      <span key={t} className="text-2xs px-1 rounded bg-blade-accent/8 text-blade-accent truncate max-w-[60px]">
                        {t}
                      </span>
                    ))}
                    {note.tags.length > 2 && (
                      <span className="text-2xs text-blade-muted">+{note.tags.length - 2}</span>
                    )}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>

      {/* Import button */}
      <div className="p-2 border-t border-blade-border">
        <button
          onClick={handleImport}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Import
        </button>
      </div>
    </div>
  );

  // ── Render: Checklist view ──────────────────────────────────────────────
  const renderChecklist = () => {
    if (!activeNote) return null;
    const lines = activeNote.content.split("\n");
    return (
      <div className="space-y-1 py-2">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;
          const checked = /^\[x\]/i.test(trimmed);
          const unchecked = /^\[ ?\]/.test(trimmed);
          const text = trimmed.replace(/^\[[ x]?\]\s*/i, "");
          return (
            <div key={i} className="flex items-center gap-2 group">
              <button
                onClick={() => handleChecklistToggle(i)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
                  checked
                    ? "bg-blade-accent border-blade-accent"
                    : "border-blade-border hover:border-blade-accent/50"
                }`}
              >
                {checked && (
                  <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
              <span className={`text-sm ${checked ? "line-through text-blade-muted" : "text-blade-primary"}`}>
                {text || (unchecked || checked ? "" : trimmed)}
              </span>
            </div>
          );
        })}
        {/* Add item input */}
        <div className="flex items-center gap-2 mt-2">
          <div className="w-4 h-4 rounded border-2 border-blade-border/50 shrink-0" />
          <input
            placeholder="Add item..."
            className="flex-1 bg-transparent text-sm text-blade-primary placeholder:text-blade-muted/40 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const value = (e.target as HTMLInputElement).value.trim();
                if (value) {
                  updateNote(activeNote.id, {
                    content: activeNote.content + (activeNote.content ? "\n" : "") + `[ ] ${value}`,
                  });
                  (e.target as HTMLInputElement).value = "";
                }
              }
            }}
          />
        </div>
      </div>
    );
  };

  // ── Render: Editor Column ───────────────────────────────────────────────
  const renderEditor = () => {
    if (!activeNote) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-blade-muted">
          <svg className="w-12 h-12 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <p className="text-sm">Select a note or create a new one</p>
          <button
            onClick={handleNewNote}
            className="px-4 py-2 rounded-xl bg-blade-accent/10 text-blade-accent text-sm hover:bg-blade-accent/20 transition-colors"
          >
            New Note (Ctrl+N)
          </button>
        </div>
      );
    }

    return (
      <div className={`flex-1 flex flex-col min-w-0 ${colorBg(activeNote.color)}`}>
        {/* Toolbar */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-blade-border">
          <button
            onClick={() => handleToggleChecklist()}
            title="Toggle checklist"
            className={`p-1.5 rounded-lg text-xs transition-all ${
              activeNote.format === "checklist"
                ? "bg-blade-accent/10 text-blade-accent"
                : "text-blade-muted hover:text-blade-primary hover:bg-blade-surface"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </button>
          <button
            onClick={() => setShowPreview(!showPreview)}
            title="Toggle preview"
            className={`p-1.5 rounded-lg text-xs transition-all ${
              showPreview
                ? "bg-blade-accent/10 text-blade-accent"
                : "text-blade-muted hover:text-blade-primary hover:bg-blade-surface"
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>

          <div className="flex-1" />

          {/* Color picker */}
          <div className="relative">
            <button
              onClick={() => setShowColorPicker(!showColorPicker)}
              title="Note color"
              className="p-1.5 rounded-lg text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
              </svg>
            </button>
            {showColorPicker && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-blade-surface border border-blade-border rounded-xl shadow-lg p-2 flex gap-1.5">
                {NOTE_COLORS.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => { updateNote(activeNote.id, { color: c.value }); setShowColorPicker(false); }}
                    title={c.label}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      activeNote.color === c.value ? "border-blade-accent scale-110" : "border-blade-border hover:border-blade-accent/40"
                    } ${c.value ? `bg-${c.value}-400` : "bg-blade-base"}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* AI actions */}
          <button
            onClick={() => onSendToChat(`Summarize this note:\n\n${activeNote.title}\n\n${activeNote.content}`)}
            title="AI Summarize"
            className="p-1.5 rounded-lg text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </button>
          <button
            onClick={() => onSendToChat(`Expand and elaborate on this note:\n\n${activeNote.title}\n\n${activeNote.content}`)}
            title="AI Expand"
            className="p-1.5 rounded-lg text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
            </svg>
          </button>

          <button
            onClick={() => pinNote(activeNote.id)}
            title={activeNote.pinned ? "Unpin (Ctrl+P)" : "Pin (Ctrl+P)"}
            className={`p-1.5 rounded-lg transition-all ${
              activeNote.pinned
                ? "text-blade-accent bg-blade-accent/10"
                : "text-blade-muted hover:text-blade-primary hover:bg-blade-surface"
            }`}
          >
            <svg className="w-4 h-4" fill={activeNote.pinned ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          </button>
          <button
            onClick={() => archiveNote(activeNote.id)}
            title="Archive"
            className="p-1.5 rounded-lg text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
            </svg>
          </button>

          {/* Export dropdown */}
          <div className="relative group">
            <button className="p-1.5 rounded-lg text-blade-muted hover:text-blade-primary hover:bg-blade-surface transition-all" title="Export">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-50 bg-blade-surface border border-blade-border rounded-xl shadow-lg py-1 min-w-[120px]">
              <button onClick={() => handleExport("markdown")} className="w-full text-left px-3 py-1.5 text-xs text-blade-secondary hover:bg-blade-accent/10 hover:text-blade-accent">
                Markdown (.md)
              </button>
              <button onClick={() => handleExport("plain")} className="w-full text-left px-3 py-1.5 text-xs text-blade-secondary hover:bg-blade-accent/10 hover:text-blade-accent">
                Plain text (.txt)
              </button>
            </div>
          </div>

          {/* Delete */}
          <button
            onClick={() => setConfirmDelete(activeNote.id)}
            title="Delete"
            className="p-1.5 rounded-lg text-blade-muted hover:text-red-400 hover:bg-red-400/10 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>

        {/* Title */}
        <div className="px-5 pt-4">
          <input
            ref={titleRef}
            value={activeNote.title}
            onChange={(e) => updateNote(activeNote.id, { title: e.target.value })}
            placeholder="Note title"
            className="w-full bg-transparent text-xl font-semibold text-blade-primary placeholder:text-blade-muted/40 focus:outline-none"
          />
          <div className="flex items-center gap-3 mt-1 text-2xs text-blade-muted">
            <span>{activeNote.wordCount} words</span>
            <span>{activeNote.format}</span>
            <span>Updated {timeAgo(activeNote.updatedAt)}</span>
            {activeNote.folder && (
              <span className="px-1.5 py-0.5 rounded bg-blade-surface text-blade-secondary">
                {folders.find((f) => f.id === activeNote.folder)?.name ?? activeNote.folder}
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-3 relative">
          {activeNote.format === "checklist" ? (
            renderChecklist()
          ) : (
            <textarea
              ref={editorRef}
              value={activeNote.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Start writing... Use [[Note Title]] to link to other notes"
              className="w-full h-full bg-transparent text-sm text-blade-primary placeholder:text-blade-muted/40 focus:outline-none resize-none leading-relaxed"
            />
          )}

          {/* Wiki link popup */}
          {wikiSearch !== null && wikiResults.length > 0 && (
            <div className="absolute left-5 bottom-16 z-50 bg-blade-surface border border-blade-border rounded-xl shadow-xl py-1 min-w-[200px] max-h-[200px] overflow-y-auto">
              <div className="px-3 py-1.5 text-2xs text-blade-muted border-b border-blade-border">Link to note</div>
              {wikiResults.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleWikiSelect(n)}
                  className="w-full text-left px-3 py-1.5 text-xs text-blade-secondary hover:bg-blade-accent/10 hover:text-blade-accent transition-colors"
                >
                  {n.title}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="px-5 py-2 border-t border-blade-border">
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeNote.tags.map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blade-accent/8 text-blade-accent text-2xs group">
                {tag}
                <button onClick={() => handleRemoveTag(tag)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">x</button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }}
              placeholder="Add tags..."
              className="bg-transparent text-2xs text-blade-primary placeholder:text-blade-muted/40 focus:outline-none min-w-[80px] flex-1"
            />
          </div>
        </div>

        {/* Backlinks */}
        {backlinks.length > 0 && (
          <div className="px-5 py-2 border-t border-blade-border">
            <div className="flex items-center gap-1.5 mb-1.5">
              <svg className="w-3.5 h-3.5 text-blade-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span className="text-2xs font-medium text-blade-muted uppercase tracking-wide">
                Backlinks ({backlinks.length})
              </span>
            </div>
            <div className="space-y-0.5">
              {backlinks.map((bl) => (
                <button
                  key={bl.id}
                  onClick={() => openNote(bl.id)}
                  className="w-full text-left px-2 py-1 rounded-lg text-xs text-blade-secondary hover:text-blade-accent hover:bg-blade-accent/5 transition-all"
                >
                  {bl.title || "Untitled"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Move to folder (at very bottom) */}
        <div className="px-5 py-2 border-t border-blade-border flex items-center gap-2">
          <span className="text-2xs text-blade-muted">Move to:</span>
          <div className="flex items-center gap-1 flex-wrap">
            {folders
              .filter((f) => f.id !== activeNote.folder)
              .map((f) => (
                <button
                  key={f.id}
                  onClick={() => moveToFolder(activeNote.id, f.id)}
                  className="px-2 py-0.5 rounded-lg text-2xs text-blade-secondary bg-blade-surface hover:bg-blade-accent/10 hover:text-blade-accent transition-all"
                >
                  {f.name}
                </button>
              ))}
          </div>
        </div>
      </div>
    );
  };

  // ── Confirm delete modal ────────────────────────────────────────────────
  const renderDeleteModal = () => {
    if (!confirmDelete) return null;
    const note = notes.find((n) => n.id === confirmDelete);
    if (!note) return null;
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-blade-surface border border-blade-border rounded-2xl p-6 w-80 shadow-xl">
          <h3 className="text-sm font-semibold text-blade-primary mb-2">Delete note?</h3>
          <p className="text-xs text-blade-muted mb-4">
            "{note.title}" will be permanently deleted. This cannot be undone.
          </p>
          <div className="flex items-center gap-2 justify-end">
            <button
              onClick={() => setConfirmDelete(null)}
              className="px-3 py-1.5 rounded-lg text-xs text-blade-secondary hover:bg-blade-surface transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { deleteNote(confirmDelete); setConfirmDelete(null); }}
              className="px-3 py-1.5 rounded-lg text-xs bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────
  return (
    <div className="flex h-full bg-blade-base text-blade-primary">
      {renderFolders()}
      {renderNoteList()}
      {renderEditor()}
      {renderDeleteModal()}

      {/* Floating new note button */}
      <button
        onClick={handleNewNote}
        title="Quick note (Ctrl+N)"
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-2xl bg-blade-accent text-white shadow-lg shadow-blade-accent/20 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
