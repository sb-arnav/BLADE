import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useWritingStudio,
  WritingProject,
} from "../hooks/useWritingStudio";

// ── Constants ──────────────────────────────────────────────────────────

const TYPE_ICONS: Record<WritingProject["type"], string> = {
  blog: "\u270D",    // writing hand
  docs: "\uD83D\uDCC4",   // page facing up
  email: "\u2709",   // envelope
  essay: "\uD83D\uDCDD",  // memo
  script: "\uD83C\uDFAC", // clapper board
  notes: "\uD83D\uDDD2",  // spiral notepad
  custom: "\u2726",  // four pointed star
};

const TYPE_LABELS: Record<WritingProject["type"], string> = {
  blog: "Blog Post",
  docs: "Documentation",
  email: "Email",
  essay: "Essay",
  script: "Script",
  notes: "Notes",
  custom: "Custom",
};

const STATUS_COLORS: Record<WritingProject["status"], string> = {
  draft: "bg-yellow-500/20 text-yellow-400",
  review: "bg-blue-500/20 text-blue-400",
  final: "bg-green-500/20 text-green-400",
  published: "bg-purple-500/20 text-purple-400",
};

type AITab = "suggestions" | "outline" | "versions";

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
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
  return `${days}d ago`;
}

function formatWordCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function markdownToHtml(md: string): string {
  // Minimal markdown-to-HTML for export; keeps it dependency-free
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}

// ── Component ──────────────────────────────────────────────────────────

export default function WritingStudio({ onBack, onSendToChat }: Props) {
  const {
    projects,
    activeProject,
    createProject,
    updateProject,
    deleteProject,
    saveVersion,
    restoreVersion,
    setActiveProject,
    getAISuggestions,
    expandOutline,
    improveSection,
    proofread,
    continueWriting,
    stats,
    lastSaved,
  } = useWritingStudio();

  // ── Local state ──────────────────────────────────────────────────────

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<WritingProject["type"]>("blog");
  const [newTarget, setNewTarget] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(true);
  const [aiTab, setAiTab] = useState<AITab>("suggestions");
  const [selectedText, setSelectedText] = useState("");
  const [outlineInput, setOutlineInput] = useState("");
  const [versionLabel, setVersionLabel] = useState("");
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [saveIndicator, setSaveIndicator] = useState(false);

  const editorRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // ── Derived ──────────────────────────────────────────────────────────

  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => b.updatedAt - a.updatedAt),
    [projects],
  );

  const wordProgress = useMemo(() => {
    if (!activeProject || !activeProject.targetWordCount) return null;
    const pct = Math.min(100, Math.round((activeProject.wordCount / activeProject.targetWordCount) * 100));
    return pct;
  }, [activeProject]);

  // ── Save indicator flash ─────────────────────────────────────────────

  useEffect(() => {
    if (lastSaved) {
      setSaveIndicator(true);
      const t = setTimeout(() => setSaveIndicator(false), 2000);
      return () => clearTimeout(t);
    }
  }, [lastSaved]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Escape: exit focus mode, or go back
      if (e.key === "Escape") {
        if (focusMode) { setFocusMode(false); return; }
        if (activeProject) { setActiveProject(null); return; }
        onBack();
        return;
      }
      // Ctrl+S: save version
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (activeProject) {
          saveVersion(activeProject.id, `Auto-save`);
        }
      }
      // Ctrl+Shift+P: proofread
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "P") {
        e.preventDefault();
        if (activeProject) {
          const prompt = proofread(activeProject.content);
          if (prompt) onSendToChat(prompt);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeProject, focusMode, onBack, saveVersion, setActiveProject, proofread, onSendToChat]);

  // ── Track text selection in editor ───────────────────────────────────

  const handleEditorSelect = useCallback(() => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const sel = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd);
    setSelectedText(sel);
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleCreateProject = useCallback(() => {
    if (!newTitle.trim()) return;
    createProject({
      title: newTitle.trim(),
      type: newType,
      targetWordCount: newTarget ? parseInt(newTarget, 10) || null : null,
    });
    setNewTitle("");
    setNewType("blog");
    setNewTarget("");
    setShowNewDialog(false);
  }, [newTitle, newType, newTarget, createProject]);

  const handleContentChange = useCallback(
    (content: string) => {
      if (!activeProject) return;
      updateProject(activeProject.id, { content });
    },
    [activeProject, updateProject],
  );

  const handleTitleChange = useCallback(
    (title: string) => {
      if (!activeProject) return;
      updateProject(activeProject.id, { title });
    },
    [activeProject, updateProject],
  );

  const handleStatusChange = useCallback(
    (status: WritingProject["status"]) => {
      if (!activeProject) return;
      updateProject(activeProject.id, { status });
    },
    [activeProject, updateProject],
  );

  const handleAddOutlineItem = useCallback(() => {
    if (!activeProject || !outlineInput.trim()) return;
    updateProject(activeProject.id, {
      outline: [...activeProject.outline, outlineInput.trim()],
    });
    setOutlineInput("");
  }, [activeProject, outlineInput, updateProject]);

  const handleRemoveOutlineItem = useCallback(
    (index: number) => {
      if (!activeProject) return;
      const next = activeProject.outline.filter((_, i) => i !== index);
      updateProject(activeProject.id, { outline: next });
    },
    [activeProject, updateProject],
  );

  const insertFormatting = useCallback(
    (prefix: string, suffix: string) => {
      const textarea = editorRef.current;
      if (!textarea || !activeProject) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = activeProject.content;
      const before = text.slice(0, start);
      const selected = text.slice(start, end);
      const after = text.slice(end);
      const newContent = `${before}${prefix}${selected || "text"}${suffix}${after}`;
      updateProject(activeProject.id, { content: newContent });
      // Restore cursor after React re-render
      requestAnimationFrame(() => {
        textarea.focus();
        const cursorPos = start + prefix.length + (selected ? selected.length : 4);
        textarea.setSelectionRange(cursorPos, cursorPos);
      });
    },
    [activeProject, updateProject],
  );

  // ── Export ───────────────────────────────────────────────────────────

  const exportMarkdown = useCallback(() => {
    if (!activeProject) return;
    const blob = new Blob([`# ${activeProject.title}\n\n${activeProject.content}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeProject.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [activeProject]);

  const exportHtml = useCallback(() => {
    if (!activeProject) return;
    const html = `<!DOCTYPE html><html><head><title>${activeProject.title}</title><style>body{font-family:system-ui;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.7;color:#333}h1,h2,h3{margin-top:1.5em}code{background:#f4f4f4;padding:2px 6px;border-radius:3px}blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:1rem;color:#666}</style></head><body>${markdownToHtml(activeProject.content)}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeProject.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  }, [activeProject]);

  const copyToClipboard = useCallback(() => {
    if (!activeProject) return;
    navigator.clipboard.writeText(activeProject.content);
    setShowExportMenu(false);
  }, [activeProject]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const close = () => setShowExportMenu(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [showExportMenu]);

  // ── AI action handlers ───────────────────────────────────────────────

  const handleGetSuggestions = useCallback(() => {
    if (!activeProject) return;
    const prompt = getAISuggestions(activeProject.id);
    if (prompt) onSendToChat(prompt);
  }, [activeProject, getAISuggestions, onSendToChat]);

  const handleExpandOutline = useCallback(() => {
    if (!activeProject) return;
    const prompt = expandOutline(activeProject.id);
    if (prompt) onSendToChat(prompt);
  }, [activeProject, expandOutline, onSendToChat]);

  const handleImproveSelection = useCallback(() => {
    if (!selectedText.trim()) return;
    const prompt = improveSection(selectedText);
    if (prompt) onSendToChat(prompt);
  }, [selectedText, improveSection, onSendToChat]);

  const handleProofread = useCallback(() => {
    if (!activeProject) return;
    const prompt = proofread(activeProject.content);
    if (prompt) onSendToChat(prompt);
  }, [activeProject, proofread, onSendToChat]);

  const handleContinueWriting = useCallback(() => {
    if (!activeProject) return;
    const prompt = continueWriting(activeProject.id);
    if (prompt) onSendToChat(prompt);
  }, [activeProject, continueWriting, onSendToChat]);

  const handleSaveVersion = useCallback(() => {
    if (!activeProject) return;
    saveVersion(activeProject.id, versionLabel || undefined);
    setVersionLabel("");
  }, [activeProject, versionLabel, saveVersion]);

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50">
      <div
        className="w-full max-w-7xl h-[90vh] bg-blade-surface border border-blade-border rounded-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0 border-b border-blade-border">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (activeProject) setActiveProject(null);
                else onBack();
              }}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="text-sm font-semibold text-blade-text">Writing Studio</h2>
            <span className="text-[10px] text-blade-muted bg-blade-surface-hover px-1.5 py-0.5 rounded-full">
              {stats.totalProjects} projects / {formatWordCount(stats.totalWords)} words
            </span>
          </div>

          <div className="flex items-center gap-2">
            {activeProject && (
              <>
                {/* Save indicator */}
                {saveIndicator && (
                  <span className="text-[10px] text-green-400 animate-pulse">Saved</span>
                )}

                {/* Focus mode */}
                <button
                  onClick={() => setFocusMode(!focusMode)}
                  className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                    focusMode
                      ? "bg-blade-accent text-white"
                      : "bg-blade-surface-hover text-blade-muted hover:text-blade-secondary"
                  }`}
                  title="Focus mode (hide panels)"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </button>

                {/* Toggle AI panel */}
                {!focusMode && (
                  <button
                    onClick={() => setShowAIPanel(!showAIPanel)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                      showAIPanel
                        ? "bg-blade-accent/20 text-blade-accent"
                        : "bg-blade-surface-hover text-blade-muted hover:text-blade-secondary"
                    }`}
                    title="Toggle AI panel"
                  >
                    AI
                  </button>
                )}

                {/* Export */}
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); }}
                    className="text-xs px-2.5 py-1 rounded-lg bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
                  >
                    Export
                  </button>
                  {showExportMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-blade-surface border border-blade-border rounded-lg shadow-xl py-1 z-10 min-w-[140px]">
                      <button onClick={exportMarkdown} className="w-full text-left px-3 py-1.5 text-xs text-blade-text hover:bg-blade-surface-hover transition-colors">
                        Markdown (.md)
                      </button>
                      <button onClick={exportHtml} className="w-full text-left px-3 py-1.5 text-xs text-blade-text hover:bg-blade-surface-hover transition-colors">
                        HTML (.html)
                      </button>
                      <button onClick={copyToClipboard} className="w-full text-left px-3 py-1.5 text-xs text-blade-text hover:bg-blade-surface-hover transition-colors">
                        Copy to Clipboard
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="flex flex-1 min-h-0">

          {/* ── Sidebar: project list ──────────────────────────────── */}
          {!focusMode && !activeProject && (
            <div className="w-full flex flex-col min-h-0">
              {/* New project button */}
              <div className="px-4 py-3 border-b border-blade-border">
                <button
                  onClick={() => setShowNewDialog(true)}
                  className="w-full text-xs py-2 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity font-medium"
                >
                  + New Project
                </button>
              </div>

              {/* Project list */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {sortedProjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-blade-muted py-16">
                    <svg className="w-12 h-12 mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <p className="text-xs font-medium mb-1">No writing projects</p>
                    <p className="text-[10px]">Create your first blog post, doc, or essay</p>
                  </div>
                ) : (
                  <div className="divide-y divide-blade-border">
                    {sortedProjects.map((project) => (
                      <div
                        key={project.id}
                        className="px-4 py-3 hover:bg-blade-surface-hover cursor-pointer transition-colors group"
                        onClick={() => setActiveProject(project.id)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm">{TYPE_ICONS[project.type]}</span>
                          <span className="text-xs font-medium text-blade-text truncate flex-1">
                            {project.title}
                          </span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[project.status]}`}>
                            {project.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-blade-muted">
                          <span>{TYPE_LABELS[project.type]}</span>
                          <span>{formatWordCount(project.wordCount)} words</span>
                          <span>{timeAgo(project.updatedAt)}</span>
                        </div>
                        {project.tags.length > 0 && (
                          <div className="flex gap-1 mt-1.5">
                            {project.tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blade-surface-hover text-blade-muted">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Delete on hover */}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}
                          className="absolute right-3 top-3 opacity-0 group-hover:opacity-100 text-blade-muted hover:text-red-400 transition-all"
                        >
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Stats footer */}
              {stats.totalProjects > 0 && (
                <div className="flex items-center gap-4 px-4 py-2 border-t border-blade-border text-[10px] text-blade-muted shrink-0">
                  <span>{stats.totalProjects} projects</span>
                  <span>{formatWordCount(stats.totalWords)} total words</span>
                  <span>avg {formatWordCount(stats.avgWordCount)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── Editor view (when project is active) ──────────────── */}
          {activeProject && (
            <>
              {/* Sidebar: project list (narrow) */}
              {!focusMode && (
                <div className="w-48 border-r border-blade-border flex flex-col min-h-0 shrink-0">
                  <div className="px-2 py-2 border-b border-blade-border">
                    <button
                      onClick={() => setShowNewDialog(true)}
                      className="w-full text-[10px] py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity font-medium"
                    >
                      + New
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {sortedProjects.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setActiveProject(p.id)}
                        className={`w-full text-left px-2.5 py-2 border-b border-blade-border/50 transition-colors ${
                          p.id === activeProject.id
                            ? "bg-blade-accent/10 border-l-2 border-l-blade-accent"
                            : "hover:bg-blade-surface-hover"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px]">{TYPE_ICONS[p.type]}</span>
                          <span className="text-[11px] font-medium text-blade-text truncate">{p.title}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[9px] text-blade-muted">
                          <span>{formatWordCount(p.wordCount)}w</span>
                          <span className={`px-1 py-px rounded ${STATUS_COLORS[p.status]}`}>{p.status}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Main editor area */}
              <div className="flex-1 flex flex-col min-h-0">
                {/* Title bar */}
                <div className="flex items-center gap-3 px-5 py-2 border-b border-blade-border">
                  <span className="text-lg">{TYPE_ICONS[activeProject.type]}</span>
                  <input
                    ref={titleRef}
                    type="text"
                    value={activeProject.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    className="flex-1 text-lg font-bold bg-transparent text-blade-text placeholder:text-blade-muted focus:outline-none"
                    placeholder="Untitled"
                  />
                  <select
                    value={activeProject.status}
                    onChange={(e) => handleStatusChange(e.target.value as WritingProject["status"])}
                    className={`text-[10px] px-2 py-1 rounded-lg border-0 font-medium focus:outline-none cursor-pointer ${STATUS_COLORS[activeProject.status]}`}
                  >
                    <option value="draft">Draft</option>
                    <option value="review">Review</option>
                    <option value="final">Final</option>
                    <option value="published">Published</option>
                  </select>
                </div>

                {/* Formatting toolbar */}
                <div className="flex items-center gap-1 px-5 py-1.5 border-b border-blade-border/50">
                  <button onClick={() => insertFormatting("**", "**")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-xs font-bold" title="Bold (Ctrl+B)">
                    B
                  </button>
                  <button onClick={() => insertFormatting("*", "*")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-xs italic" title="Italic">
                    I
                  </button>
                  <button onClick={() => insertFormatting("\n## ", "\n")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-[10px] font-bold" title="Heading">
                    H2
                  </button>
                  <button onClick={() => insertFormatting("\n### ", "\n")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-[10px] font-bold" title="Subheading">
                    H3
                  </button>
                  <div className="w-px h-4 bg-blade-border mx-1" />
                  <button onClick={() => insertFormatting("\n- ", "\n")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-xs" title="List">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                  </button>
                  <button onClick={() => insertFormatting("\n> ", "\n")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-sm" title="Quote">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z" />
                      <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
                    </svg>
                  </button>
                  <button onClick={() => insertFormatting("[", "](url)")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors text-xs" title="Link">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
                    </svg>
                  </button>
                  <button onClick={() => insertFormatting("`", "`")} className="w-7 h-7 rounded flex items-center justify-center text-blade-muted hover:text-blade-text hover:bg-blade-surface-hover transition-colors font-mono text-[10px]" title="Inline code">
                    {"</>"}
                  </button>
                </div>

                {/* Editor textarea */}
                <div className="flex-1 min-h-0 overflow-hidden">
                  <textarea
                    ref={editorRef}
                    value={activeProject.content}
                    onChange={(e) => handleContentChange(e.target.value)}
                    onSelect={handleEditorSelect}
                    placeholder="Start writing..."
                    spellCheck
                    className="w-full h-full px-8 py-6 text-[15px] leading-[1.8] bg-transparent text-blade-text placeholder:text-blade-muted/40 resize-none focus:outline-none custom-scrollbar overflow-y-auto"
                    style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
                  />
                </div>

                {/* Footer: word count + target */}
                <div className="flex items-center justify-between px-5 py-2 border-t border-blade-border shrink-0">
                  <div className="flex items-center gap-3 text-[10px] text-blade-muted">
                    <span>{activeProject.wordCount.toLocaleString()} words</span>
                    {activeProject.targetWordCount && (
                      <>
                        <span>/</span>
                        <span>{activeProject.targetWordCount.toLocaleString()} target</span>
                        <div className="w-24 h-1.5 bg-blade-surface-hover rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              (wordProgress ?? 0) >= 100 ? "bg-green-400" : "bg-blade-accent"
                            }`}
                            style={{ width: `${Math.min(100, wordProgress ?? 0)}%` }}
                          />
                        </div>
                        <span>{wordProgress}%</span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-blade-muted">
                    <span>{activeProject.content.split("\n").length} lines</span>
                    <span>{Math.ceil(activeProject.wordCount / 200)} min read</span>
                    <span>Ctrl+S save</span>
                  </div>
                </div>
              </div>

              {/* ── AI Panel (right) ────────────────────────────────── */}
              {!focusMode && showAIPanel && (
                <div className="w-64 border-l border-blade-border flex flex-col min-h-0 shrink-0">
                  {/* Tab bar */}
                  <div className="flex border-b border-blade-border shrink-0">
                    {(["suggestions", "outline", "versions"] as AITab[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setAiTab(tab)}
                        className={`flex-1 text-[10px] py-2.5 font-medium transition-colors capitalize ${
                          aiTab === tab
                            ? "text-blade-accent border-b-2 border-blade-accent"
                            : "text-blade-muted hover:text-blade-secondary"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* Tab content */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">

                    {/* ── Suggestions tab ──────────────────────────── */}
                    {aiTab === "suggestions" && (
                      <>
                        <button
                          onClick={handleGetSuggestions}
                          disabled={!activeProject.content.trim()}
                          className="w-full text-xs py-2 rounded-lg bg-blade-accent/20 text-blade-accent hover:bg-blade-accent/30 transition-colors disabled:opacity-40 font-medium"
                        >
                          Get AI Suggestions
                        </button>

                        <button
                          onClick={handleProofread}
                          disabled={!activeProject.content.trim()}
                          className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors disabled:opacity-40"
                        >
                          Proofread (Ctrl+Shift+P)
                        </button>

                        <button
                          onClick={handleImproveSelection}
                          disabled={!selectedText.trim()}
                          className="w-full text-xs py-2 rounded-lg bg-blade-surface-hover text-blade-secondary hover:bg-blade-border transition-colors disabled:opacity-40"
                        >
                          {selectedText ? `Improve Selection (${selectedText.split(/\s+/).length}w)` : "Select text to improve"}
                        </button>

                        <button
                          onClick={handleContinueWriting}
                          disabled={!activeProject.content.trim()}
                          className="w-full text-xs py-2 rounded-lg bg-green-500/15 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-40"
                        >
                          Continue Writing
                        </button>

                        {activeProject.aiSuggestions.length > 0 && (
                          <div className="space-y-1.5 mt-3">
                            <p className="text-[10px] text-blade-muted font-medium uppercase tracking-wider">
                              Previous Suggestions
                            </p>
                            {activeProject.aiSuggestions.map((s, i) => (
                              <div
                                key={i}
                                className="text-[10px] p-2 rounded-lg bg-blade-surface-hover text-blade-text leading-relaxed"
                              >
                                {s}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* ── Outline tab ──────────────────────────────── */}
                    {aiTab === "outline" && (
                      <>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={outlineInput}
                            onChange={(e) => setOutlineInput(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddOutlineItem()}
                            placeholder="Add outline item..."
                            className="flex-1 text-xs px-2.5 py-1.5 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                          />
                          <button
                            onClick={handleAddOutlineItem}
                            disabled={!outlineInput.trim()}
                            className="text-xs px-2.5 py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>

                        {activeProject.outline.length > 0 && (
                          <>
                            <button
                              onClick={handleExpandOutline}
                              className="w-full text-xs py-2 rounded-lg bg-blade-accent/20 text-blade-accent hover:bg-blade-accent/30 transition-colors font-medium mt-1"
                            >
                              AI Expand All
                            </button>

                            <div className="space-y-1 mt-1">
                              {activeProject.outline.map((item, i) => (
                                <div
                                  key={i}
                                  className="flex items-start gap-2 group p-1.5 rounded-lg hover:bg-blade-surface-hover transition-colors"
                                >
                                  <span className="text-[10px] text-blade-accent font-mono mt-0.5 shrink-0">
                                    {i + 1}.
                                  </span>
                                  <span className="text-xs text-blade-text flex-1 leading-relaxed">
                                    {item}
                                  </span>
                                  <button
                                    onClick={() => handleRemoveOutlineItem(i)}
                                    className="opacity-0 group-hover:opacity-100 text-blade-muted hover:text-red-400 transition-all shrink-0"
                                  >
                                    <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </>
                        )}

                        {activeProject.outline.length === 0 && (
                          <p className="text-[10px] text-blade-muted text-center py-4">
                            Add outline items to structure your writing. AI can expand them into drafts.
                          </p>
                        )}
                      </>
                    )}

                    {/* ── Versions tab ─────────────────────────────── */}
                    {aiTab === "versions" && (
                      <>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={versionLabel}
                            onChange={(e) => setVersionLabel(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleSaveVersion()}
                            placeholder="Version label..."
                            className="flex-1 text-xs px-2.5 py-1.5 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent"
                          />
                          <button
                            onClick={handleSaveVersion}
                            className="text-xs px-2.5 py-1.5 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity"
                          >
                            Save
                          </button>
                        </div>

                        {activeProject.versions.length > 0 ? (
                          <div className="space-y-1.5 mt-1">
                            {[...activeProject.versions].reverse().map((v) => (
                              <div
                                key={v.id}
                                className="flex items-center justify-between p-2 rounded-lg bg-blade-surface-hover group"
                              >
                                <div>
                                  <p className="text-[11px] text-blade-text font-medium">{v.label}</p>
                                  <p className="text-[9px] text-blade-muted">
                                    {new Date(v.savedAt).toLocaleString()} &middot; {v.content.split(/\s+/).filter(Boolean).length}w
                                  </p>
                                </div>
                                <button
                                  onClick={() => restoreVersion(activeProject.id, v.id)}
                                  className="text-[10px] px-2 py-1 rounded bg-blade-accent/20 text-blade-accent hover:bg-blade-accent/30 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  Restore
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[10px] text-blade-muted text-center py-4">
                            No versions saved yet. Save snapshots to track progress and restore earlier drafts.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── New project dialog ──────────────────────────────────── */}
        {showNewDialog && (
          <div
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]"
            onClick={() => setShowNewDialog(false)}
          >
            <div
              className="w-full max-w-md bg-blade-surface border border-blade-border rounded-2xl shadow-2xl p-5"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-blade-text mb-4">New Writing Project</h3>

              {/* Title */}
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
                placeholder="Project title..."
                autoFocus
                className="w-full text-sm px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent mb-3"
              />

              {/* Type selector */}
              <label className="text-[10px] text-blade-muted font-medium uppercase tracking-wider mb-1.5 block">
                Type
              </label>
              <div className="grid grid-cols-4 gap-1.5 mb-3">
                {(Object.keys(TYPE_ICONS) as WritingProject["type"][]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setNewType(type)}
                    className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] transition-colors ${
                      newType === type
                        ? "bg-blade-accent/20 text-blade-accent border border-blade-accent/40"
                        : "bg-blade-surface-hover text-blade-muted hover:text-blade-secondary border border-transparent"
                    }`}
                  >
                    <span className="text-base">{TYPE_ICONS[type]}</span>
                    <span>{TYPE_LABELS[type]}</span>
                  </button>
                ))}
              </div>

              {/* Target word count */}
              <label className="text-[10px] text-blade-muted font-medium uppercase tracking-wider mb-1.5 block">
                Target Word Count (optional)
              </label>
              <input
                type="number"
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                placeholder="e.g. 2000"
                className="w-full text-xs px-3 py-2 bg-blade-surface-hover border border-blade-border rounded-lg text-blade-text placeholder:text-blade-muted focus:outline-none focus:border-blade-accent mb-4"
              />

              {/* Actions */}
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowNewDialog(false)}
                  className="text-xs px-4 py-2 rounded-lg bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateProject}
                  disabled={!newTitle.trim()}
                  className="text-xs px-4 py-2 rounded-lg bg-blade-accent text-white hover:opacity-90 transition-opacity disabled:opacity-40 font-medium"
                >
                  Create Project
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
