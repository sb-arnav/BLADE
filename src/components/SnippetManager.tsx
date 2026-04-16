import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useSnippetManager,
  CodeSnippet,
  SortMode,
} from "../hooks/useSnippetManager";

// ── Minimal highlight helper (maps language to token-color classes) ────
// In production, swap with highlight.js or shiki; kept inline for zero-dep.

const LANG_COLORS: Record<string, string> = {
  javascript: "text-yellow-400",
  typescript: "text-blue-400",
  python: "text-green-400",
  rust: "text-orange-400",
  go: "text-cyan-400",
  java: "text-red-400",
  ruby: "text-rose-400",
  php: "text-indigo-400",
  bash: "text-lime-400",
  sql: "text-amber-400",
  html: "text-orange-300",
  css: "text-purple-400",
  json: "text-emerald-400",
  yaml: "text-pink-400",
  markdown: "text-[rgba(255,255,255,0.7)]",
  text: "text-blade-muted",
};

const LANG_LABELS: Record<string, string> = {
  javascript: "JS",
  typescript: "TS",
  python: "PY",
  rust: "RS",
  go: "GO",
  java: "Java",
  ruby: "Ruby",
  php: "PHP",
  bash: "Bash",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  json: "JSON",
  yaml: "YAML",
  markdown: "MD",
  text: "TXT",
  csharp: "C#",
  cpp: "C++",
  kotlin: "KT",
  swift: "Swift",
  docker: "Docker",
  hcl: "HCL",
};

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onInsertToChat: (code: string) => void;
}

type View = "list" | "editor" | "import";

// ── Component ──────────────────────────────────────────────────────────

export default function SnippetManager({ onBack, onInsertToChat }: Props) {
  const {
    snippets,
    addSnippet,
    updateSnippet,
    deleteSnippet,
    incrementUsage,
    searchSnippets,
    toggleFavorite,
    exportSnippet,
    stats,
    extractCodeBlocks,
  } = useSnippetManager();

  // ── Local state ──────────────────────────────────────────────────────

  const [view, setView] = useState<View>("list");
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [sort, setSort] = useState<SortMode>("newest");
  const [selected, setSelected] = useState<CodeSnippet | null>(null);
  const [contextMenuId, setContextMenuId] = useState<string | null>(null);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  // Editor form fields
  const [editTitle, setEditTitle] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editLang, setEditLang] = useState("javascript");
  const [editDesc, setEditDesc] = useState("");
  const [editTags, setEditTags] = useState("");
  const [isNew, setIsNew] = useState(false);

  // Import preview
  const [importBlocks, setImportBlocks] = useState<
    { language: string; code: string; context: string; selected: boolean }[]
  >([]);

  const codeRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Derived data ─────────────────────────────────────────────────────

  const allLanguages = useMemo(() => {
    const langs = new Set(snippets.map((s) => s.language));
    return Array.from(langs).sort();
  }, [snippets]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    snippets.forEach((s) => s.tags.forEach((t) => tags.add(t)));
    return Array.from(tags).sort();
  }, [snippets]);

  const filtered = useMemo(() => {
    let list = query ? searchSnippets(query) : [...snippets];

    if (langFilter !== "all") {
      list = list.filter((s) => s.language === langFilter);
    }
    if (tagFilter) {
      list = list.filter((s) => s.tags.includes(tagFilter));
    }

    if (sort === "newest") list.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === "most-used") list.sort((a, b) => b.usageCount - a.usageCount);
    else list.sort((a, b) => a.title.localeCompare(b.title));

    return list;
  }, [snippets, query, langFilter, tagFilter, sort, searchSnippets]);

  // ── Effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenuId) setContextMenuId(null);
        else if (view !== "list") {
          setView("list");
          setSelected(null);
        } else onBack();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, contextMenuId, onBack]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenuId) return;
    const close = () => setContextMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenuId]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const openEditor = useCallback((snippet: CodeSnippet | null) => {
    if (snippet) {
      setSelected(snippet);
      setEditTitle(snippet.title);
      setEditCode(snippet.code);
      setEditLang(snippet.language);
      setEditDesc(snippet.description);
      setEditTags(snippet.tags.join(", "));
      setIsNew(false);
    } else {
      setSelected(null);
      setEditTitle("");
      setEditCode("");
      setEditLang("javascript");
      setEditDesc("");
      setEditTags("");
      setIsNew(true);
    }
    setView("editor");
  }, []);

  const handleSave = useCallback(() => {
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (isNew) {
      const created = addSnippet({
        title: editTitle || "Untitled Snippet",
        code: editCode,
        language: editLang,
        description: editDesc,
        tags,
        source: "manual",
      });
      setSelected(created);
      setIsNew(false);
    } else if (selected) {
      updateSnippet(selected.id, {
        title: editTitle,
        code: editCode,
        language: editLang,
        description: editDesc,
        tags,
      });
    }
  }, [isNew, selected, editTitle, editCode, editLang, editDesc, editTags, addSnippet, updateSnippet]);

  const handleDelete = useCallback(
    (id: string) => {
      deleteSnippet(id);
      if (selected?.id === id) {
        setView("list");
        setSelected(null);
      }
    },
    [deleteSnippet, selected],
  );

  const handleCopy = useCallback(
    (id: string) => {
      exportSnippet(id, "clipboard");
      incrementUsage(id);
    },
    [exportSnippet, incrementUsage],
  );

  const handleInsert = useCallback(
    (code: string, id?: string) => {
      onInsertToChat(code);
      if (id) incrementUsage(id);
    },
    [onInsertToChat, incrementUsage],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenuId(id);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleRun = useCallback(() => {
    if (editLang === "javascript" || editLang === "typescript") {
      try {
        const fn = new Function(editCode);
        const result = fn();
        alert(`Result: ${JSON.stringify(result, null, 2) ?? "undefined"}`);
      } catch (err: any) {
        alert(`Error: ${err.message}`);
      }
    } else {
      navigator.clipboard.writeText(editCode);
      alert(`Code copied! Paste and run in your terminal for ${editLang}.`);
    }
  }, [editCode, editLang]);

  // ── Import from chat ─────────────────────────────────────────────────

  const startImport = useCallback(() => {
    // Try reading messages from localStorage (common Blade pattern)
    let messages: { role: string; content: string }[] = [];
    try {
      const stored = localStorage.getItem("blade-messages");
      if (stored) messages = JSON.parse(stored);
    } catch { /* noop */ }

    if (!messages.length) {
      alert("No conversation messages found to scan.");
      return;
    }

    const blocks = extractCodeBlocks(messages);
    setImportBlocks(blocks.map((b) => ({ ...b, selected: true })));
    setView("import");
  }, [extractCodeBlocks]);

  const confirmImport = useCallback(() => {
    const toImport = importBlocks.filter((b) => b.selected);
    for (const block of toImport) {
      addSnippet({
        title: block.context.length > 3 ? block.context.slice(0, 60) : `${block.language} snippet`,
        code: block.code,
        language: block.language,
        source: "conversation",
      });
    }
    setView("list");
  }, [importBlocks, addSnippet]);

  // ── Helpers ──────────────────────────────────────────────────────────

  function preview(code: string, lines = 2): string {
    return code.split("\n").slice(0, lines).join("\n");
  }

  function langBadge(lang: string) {
    const color = LANG_COLORS[lang] ?? "text-blade-muted";
    const label = LANG_LABELS[lang] ?? lang.toUpperCase();
    return (
      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blade-surface-hover ${color}`}>
        {label}
      </span>
    );
  }

  function timeAgo(ts: number): string {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // ── Render ───────────────────────────────────────────────────────────

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
              onClick={() => {
                if (view !== "list") { setView("list"); setSelected(null); }
                else onBack();
              }}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-sm font-semibold text-blade-text">
              {view === "list" && "Snippet Manager"}
              {view === "editor" && (isNew ? "New Snippet" : "Edit Snippet")}
              {view === "import" && "Import from Chat"}
            </h2>
            <span className="text-[10px] text-blade-muted bg-blade-surface-hover px-1.5 py-0.5 rounded-full">
              {stats.total} snippets
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={startImport}
              className="text-xs px-3 py-1.5 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors"
            >
              Import from Chat
            </button>
            <button
              onClick={() => openEditor(null)}
              className="text-xs px-3 py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity"
            >
              + New Snippet
            </button>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        {view === "list" && (
          <div className="flex flex-1 min-h-0">
            {/* Left: Snippet list */}
            <div className="w-full flex flex-col min-h-0">
              {/* Toolbar */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-blade-border flex-wrap">
                {/* Search */}
                <div className="relative flex-1 min-w-[180px]">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blade-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    placeholder="Search snippets..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                  />
                </div>

                {/* Language filter */}
                <select
                  value={langFilter}
                  onChange={(e) => setLangFilter(e.target.value)}
                  className="text-xs px-2 py-1.5 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text focus:outline-none"
                >
                  <option value="all">All Languages</option>
                  {allLanguages.map((l) => (
                    <option key={l} value={l}>{LANG_LABELS[l] ?? l}</option>
                  ))}
                </select>

                {/* Tag pills */}
                {allTags.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto max-w-[300px]">
                    {tagFilter && (
                      <button
                        onClick={() => setTagFilter("")}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-blade-accent text-white shrink-0"
                      >
                        {tagFilter} x
                      </button>
                    )}
                    {allTags.filter((t) => t !== tagFilter).slice(0, 8).map((tag) => (
                      <button
                        key={tag}
                        onClick={() => setTagFilter(tag)}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-blade-surface-hover text-blade-muted hover:text-blade-secondary shrink-0 transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                {/* Sort */}
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  className="text-xs px-2 py-1.5 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text focus:outline-none"
                >
                  <option value="newest">Newest</option>
                  <option value="most-used">Most Used</option>
                  <option value="alphabetical">A-Z</option>
                </select>
              </div>

              {/* Snippet list */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-blade-muted py-16">
                    <svg className="w-12 h-12 mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M16 18l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                      <path d="M3 7v10a2 2 0 002 2h6m4-14H5a2 2 0 00-2 2v0" />
                      <path d="M14 3v4a1 1 0 001 1h4" />
                      <path d="M14 3l5 5v2" />
                    </svg>
                    <p className="text-xs font-medium mb-1">No snippets yet</p>
                    <p className="text-[10px]">Save code snippets from AI conversations</p>
                  </div>
                ) : (
                  <div className="divide-y divide-blade-border">
                    {filtered.map((snippet) => (
                      <div
                        key={snippet.id}
                        className="px-4 py-3 hover:bg-blade-surface-hover cursor-pointer transition-colors group"
                        onClick={() => openEditor(snippet)}
                        onContextMenu={(e) => handleContextMenu(e, snippet.id)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {/* Favorite star */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(snippet.id); }}
                            className={`text-sm transition-colors ${snippet.isFavorite ? "text-yellow-400" : "text-blade-muted opacity-0 group-hover:opacity-100"}`}
                          >
                            {snippet.isFavorite ? "\u2605" : "\u2606"}
                          </button>

                          <span className="text-xs font-medium text-blade-text truncate flex-1">
                            {snippet.title}
                          </span>

                          {langBadge(snippet.language)}

                          <span className="text-[10px] text-blade-muted">{timeAgo(snippet.createdAt)}</span>
                        </div>

                        {/* Code preview */}
                        <pre className="text-[10px] font-mono text-blade-muted bg-blade-bg/50 rounded px-2 py-1 overflow-hidden whitespace-pre leading-relaxed max-h-[2.4em]">
                          {preview(snippet.code)}
                        </pre>

                        {/* Tags row */}
                        {snippet.tags.length > 0 && (
                          <div className="flex gap-1 mt-1.5">
                            {snippet.tags.slice(0, 4).map((tag) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blade-surface-hover text-blade-muted">
                                {tag}
                              </span>
                            ))}
                            {snippet.tags.length > 4 && (
                              <span className="text-[9px] text-blade-muted">+{snippet.tags.length - 4}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Stats bar */}
              {stats.total > 0 && (
                <div className="flex items-center gap-4 px-4 py-2 border-t border-blade-border text-[10px] text-blade-muted shrink-0">
                  <span>{stats.total} total</span>
                  <span>{stats.favoriteCount} favorites</span>
                  <span>{stats.totalTags} tags</span>
                  <span>{Object.keys(stats.byLanguage).length} languages</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Editor / Preview ────────────────────────────────────── */}
        {view === "editor" && (
          <div className="flex flex-1 min-h-0">
            {/* Left: code editor */}
            <div className="flex-1 flex flex-col min-h-0 border-r border-blade-border">
              {/* Title */}
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Snippet title..."
                className="px-4 py-2.5 text-sm font-semibold bg-transparent border-b border-blade-border text-blade-text placeholder:text-blade-muted focus:outline-none"
              />

              {/* Language selector bar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-blade-border">
                <select
                  value={editLang}
                  onChange={(e) => setEditLang(e.target.value)}
                  className="text-xs px-2 py-1 bg-blade-surface-hover border border-blade-border rounded text-blade-text focus:outline-none"
                >
                  {["javascript", "typescript", "python", "rust", "go", "java", "ruby", "php",
                    "bash", "sql", "html", "css", "json", "yaml", "markdown", "csharp", "cpp",
                    "kotlin", "swift", "docker", "text",
                  ].map((l) => (
                    <option key={l} value={l}>{LANG_LABELS[l] ?? l}</option>
                  ))}
                </select>

                {langBadge(editLang)}

                {(editLang === "javascript" || editLang === "typescript") && (
                  <span className="text-[10px] text-green-400 ml-auto">Runnable</span>
                )}
              </div>

              {/* Code area with line numbers */}
              <div className="flex flex-1 min-h-0 overflow-auto bg-blade-bg/60">
                {/* Line numbers */}
                <div className="py-3 px-2 text-right select-none shrink-0 border-r border-blade-border/50">
                  {(editCode || " ").split("\n").map((_, i) => (
                    <div key={i} className="text-[10px] leading-[1.6em] font-mono text-blade-muted/40">
                      {i + 1}
                    </div>
                  ))}
                </div>
                {/* Code textarea */}
                <textarea
                  ref={codeRef}
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value)}
                  placeholder="Paste or write your code here..."
                  spellCheck={false}
                  className="flex-1 py-3 px-3 text-xs font-mono leading-[1.6em] bg-transparent text-blade-text placeholder:text-blade-muted/50 resize-none focus:outline-none custom-scrollbar"
                  style={{ tabSize: 2 }}
                />
              </div>
            </div>

            {/* Right: metadata + actions */}
            <div className="w-72 flex flex-col min-h-0 shrink-0">
              {/* Description */}
              <div className="px-4 py-3 border-b border-blade-border">
                <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                  Description
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="What does this snippet do?"
                  rows={3}
                  className="w-full text-xs bg-blade-surface-hover border border-blade-border rounded-lg px-2.5 py-2 text-blade-text placeholder:text-blade-muted resize-none focus:outline-none focus:border-blade-accent"
                />
              </div>

              {/* Tags */}
              <div className="px-4 py-3 border-b border-blade-border">
                <label className="text-[10px] font-medium text-blade-muted uppercase tracking-wider mb-1 block">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="react, hooks, util..."
                  className="w-full text-xs bg-blade-surface-hover border border-blade-border rounded-lg px-2.5 py-1.5 text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                />
                {editTags && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {editTags.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
                      <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-blade-accent/20 text-blade-accent">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Info */}
              {selected && !isNew && (
                <div className="px-4 py-3 border-b border-blade-border text-[10px] text-blade-muted space-y-1">
                  <p>Created: {new Date(selected.createdAt).toLocaleDateString()}</p>
                  <p>Updated: {new Date(selected.updatedAt).toLocaleDateString()}</p>
                  <p>Used: {selected.usageCount} times</p>
                  <p>Source: {selected.source}</p>
                  <p>Lines: {editCode.split("\n").length}</p>
                </div>
              )}

              {/* Actions */}
              <div className="px-4 py-3 flex flex-col gap-2 mt-auto shrink-0">
                <button
                  onClick={handleSave}
                  className="w-full text-xs py-2 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity font-medium"
                >
                  {isNew ? "Create Snippet" : "Save Changes"}
                </button>

                <button
                  onClick={() => handleCopy(selected?.id ?? "")}
                  disabled={!editCode}
                  className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors disabled:opacity-40"
                >
                  Copy to Clipboard
                </button>

                <button
                  onClick={() => handleInsert(editCode, selected?.id)}
                  disabled={!editCode}
                  className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors disabled:opacity-40"
                >
                  Insert to Chat
                </button>

                <button
                  onClick={handleRun}
                  disabled={!editCode}
                  className={`w-full text-xs py-2 rounded-lg transition-colors disabled:opacity-40 ${
                    editLang === "javascript" || editLang === "typescript"
                      ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      : "bg-blade-surface-hover text-blade-muted hover:bg-blade-border"
                  }`}
                >
                  {editLang === "javascript" || editLang === "typescript" ? "Run (JS sandbox)" : "Copy + Run in Terminal"}
                </button>

                {selected && !isNew && (
                  <>
                    <button
                      onClick={() => exportSnippet(selected.id, "file")}
                      className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-muted hover:text-blade-secondary hover:bg-blade-border transition-colors"
                    >
                      Export as File
                    </button>
                    <button
                      onClick={() => handleDelete(selected.id)}
                      className="w-full text-xs py-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      Delete Snippet
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Import from Chat View ───────────────────────────────── */}
        {view === "import" && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-blade-border text-xs text-blade-muted">
              {importBlocks.length === 0
                ? "No code blocks found in the current conversation."
                : `Found ${importBlocks.length} code block${importBlocks.length !== 1 ? "s" : ""}. Select which to save:`}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
              {importBlocks.map((block, i) => (
                <div
                  key={i}
                  className={`border rounded-xl p-3 transition-colors ${
                    block.selected
                      ? "border-blade-accent bg-blade-accent/5"
                      : "border-blade-border bg-blade-surface-hover"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={block.selected}
                      onChange={() => {
                        setImportBlocks((prev) =>
                          prev.map((b, j) => (j === i ? { ...b, selected: !b.selected } : b)),
                        );
                      }}
                      className="accent-blade-accent"
                    />
                    {langBadge(block.language)}
                    {block.context && (
                      <span className="text-[10px] text-blade-muted truncate">{block.context}</span>
                    )}
                  </div>
                  <pre className="text-[10px] font-mono text-blade-text bg-blade-bg/60 rounded-lg px-3 py-2 overflow-x-auto max-h-[120px] leading-relaxed custom-scrollbar">
                    {block.code}
                  </pre>
                </div>
              ))}
            </div>

            {importBlocks.length > 0 && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-blade-border shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setImportBlocks((prev) => prev.map((b) => ({ ...b, selected: true })))}
                    className="text-[10px] text-blade-secondary hover:underline"
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => setImportBlocks((prev) => prev.map((b) => ({ ...b, selected: false })))}
                    className="text-[10px] text-blade-muted hover:underline"
                  >
                    Deselect All
                  </button>
                  <span className="text-[10px] text-blade-muted">
                    {importBlocks.filter((b) => b.selected).length} selected
                  </span>
                </div>
                <button
                  onClick={confirmImport}
                  disabled={importBlocks.filter((b) => b.selected).length === 0}
                  className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  Import Selected
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Context menu ────────────────────────────────────────── */}
        {contextMenuId && (
          <div
            className="fixed bg-blade-surface border border-blade-border rounded-lg shadow-xl py-1 z-[60] min-w-[140px]"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { handleCopy(contextMenuId); setContextMenuId(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-blade-text hover:bg-blade-surface-hover transition-colors"
            >
              Copy Code
            </button>
            <button
              onClick={() => {
                const s = snippets.find((s) => s.id === contextMenuId);
                if (s) handleInsert(s.code, s.id);
                setContextMenuId(null);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-blade-text hover:bg-blade-surface-hover transition-colors"
            >
              Insert to Chat
            </button>
            <button
              onClick={() => { exportSnippet(contextMenuId, "file"); setContextMenuId(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-blade-text hover:bg-blade-surface-hover transition-colors"
            >
              Export as File
            </button>
            <div className="border-t border-blade-border my-1" />
            <button
              onClick={() => { handleDelete(contextMenuId); setContextMenuId(null); }}
              className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
