import { useEffect, useMemo, useState } from "react";
import {
  usePromptLibrary,
  extractVariables,
  fillVariables,
  type SavedPrompt,
  type PromptCategory,
  type PromptHistory,
  type SortMode,
} from "../hooks/usePromptLibrary";

interface Props {
  open: boolean;
  onClose: () => void;
  onUsePrompt: (prompt: string) => void;
}

type MainTab = "library" | "history";
type View = "browse" | "detail" | "fill" | "create" | "edit" | "save-from-history";

const CATEGORY_PILLS: { id: PromptCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "coding", label: "Coding" },
  { id: "writing", label: "Writing" },
  { id: "analysis", label: "Analysis" },
  { id: "creative", label: "Creative" },
  { id: "productivity", label: "Productivity" },
  { id: "custom", label: "Custom" },
];

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "most-used", label: "Most Used" },
  { id: "highest-rated", label: "Top Rated" },
  { id: "newest", label: "Newest" },
  { id: "alphabetical", label: "A-Z" },
];

const CATEGORY_COLORS: Record<PromptCategory, string> = {
  coding: "bg-blue-500/15 text-blue-400",
  writing: "bg-emerald-500/15 text-emerald-400",
  analysis: "bg-amber-500/15 text-amber-400",
  creative: "bg-purple-500/15 text-purple-400",
  productivity: "bg-rose-500/15 text-rose-400",
  custom: "bg-blade-accent-muted text-blade-accent",
};

function StarRating({
  rating,
  onRate,
  size = "sm",
}: {
  rating: number;
  onRate?: (r: number) => void;
  size?: "sm" | "xs";
}) {
  const [hover, setHover] = useState(0);
  const dim = size === "sm" ? "w-4 h-4" : "w-3 h-3";
  return (
    <div className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onClick={(e) => { e.stopPropagation(); onRate?.(star); }}
          onMouseEnter={() => onRate && setHover(star)}
          disabled={!onRate}
          className={`${dim} transition-colors ${onRate ? "cursor-pointer" : "cursor-default"}`}
        >
          <svg viewBox="0 0 24 24" fill={(hover || rating) >= star ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"
            className={`${dim} ${(hover || rating) >= star ? "text-amber-400" : "text-blade-muted/40"}`}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "...";
}

export default function PromptLibrary({ open, onClose, onUsePrompt }: Props) {
  const {
    prompts,
    history,
    addPrompt,
    updatePrompt,
    deletePrompt,
    ratePrompt,
    usePrompt,
    searchPrompts,
    rateHistoryItem,
    saveFromHistory,
    clearHistory,
    stats,
  } = usePromptLibrary();

  const [mainTab, setMainTab] = useState<MainTab>("library");
  const [view, setView] = useState<View>("browse");
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PromptCategory | "all">("all");
  const [sortMode, setSortMode] = useState<SortMode>("most-used");
  const [selectedPrompt, setSelectedPrompt] = useState<SavedPrompt | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Create / edit form
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState<PromptCategory>("custom");
  const [formTags, setFormTags] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  // Save-from-history form
  const [savingHistoryId, setSavingHistoryId] = useState<string | null>(null);
  const [saveTitle, setSaveTitle] = useState("");
  const [saveCategory, setSaveCategory] = useState<PromptCategory>("custom");
  const [saveTags, setSaveTags] = useState("");

  // Reset on close
  useEffect(() => {
    if (!open) {
      setView("browse");
      setQuery("");
      setCategoryFilter("all");
      setSelectedPrompt(null);
      setVariableValues({});
      resetForm();
      setSavingHistoryId(null);
    }
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "browse") {
          setView("browse");
          setSelectedPrompt(null);
          resetForm();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, view, onClose]);

  // Filtered + sorted prompts
  const filtered = useMemo(() => {
    let results = query ? searchPrompts(query) : prompts;
    if (categoryFilter !== "all") {
      results = results.filter((p) => p.category === categoryFilter);
    }
    const sorted = [...results];
    switch (sortMode) {
      case "most-used": sorted.sort((a, b) => b.usageCount - a.usageCount); break;
      case "highest-rated": sorted.sort((a, b) => b.rating - a.rating); break;
      case "newest": sorted.sort((a, b) => b.createdAt - a.createdAt); break;
      case "alphabetical": sorted.sort((a, b) => a.title.localeCompare(b.title)); break;
    }
    return sorted;
  }, [prompts, query, categoryFilter, sortMode, searchPrompts]);

  function resetForm() {
    setFormTitle("");
    setFormContent("");
    setFormCategory("custom");
    setFormTags("");
    setEditingId(null);
  }

  function handleSelectPrompt(prompt: SavedPrompt) {
    setSelectedPrompt(prompt);
    if (prompt.variables.length > 0) {
      const vars: Record<string, string> = {};
      prompt.variables.forEach((v) => { vars[v] = ""; });
      setVariableValues(vars);
      setView("fill");
    } else {
      setView("detail");
    }
  }

  function handleUsePrompt() {
    if (!selectedPrompt) return;
    const filled = selectedPrompt.variables.length > 0
      ? fillVariables(selectedPrompt.content, variableValues)
      : selectedPrompt.content;
    usePrompt(selectedPrompt.id);
    onUsePrompt(filled);
    onClose();
  }

  function handleUseDirectly(prompt: SavedPrompt) {
    if (prompt.variables.length > 0) {
      handleSelectPrompt(prompt);
      return;
    }
    usePrompt(prompt.id);
    onUsePrompt(prompt.content);
    onClose();
  }

  function handleCreateSubmit() {
    if (!formTitle.trim() || !formContent.trim()) return;
    const tags = formTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (editingId) {
      updatePrompt(editingId, {
        title: formTitle.trim(),
        content: formContent.trim(),
        category: formCategory,
        tags,
      });
    } else {
      addPrompt({
        title: formTitle.trim(),
        content: formContent.trim(),
        category: formCategory,
        tags,
      });
    }
    resetForm();
    setView("browse");
  }

  function handleEdit(prompt: SavedPrompt) {
    setEditingId(prompt.id);
    setFormTitle(prompt.title);
    setFormContent(prompt.content);
    setFormCategory(prompt.category);
    setFormTags(prompt.tags.join(", "));
    setView("edit");
  }

  function handleSaveFromHistory(item: PromptHistory) {
    setSavingHistoryId(item.id);
    setSaveTitle("");
    setSaveCategory("custom");
    setSaveTags("");
    setView("save-from-history");
  }

  function handleSaveFromHistorySubmit() {
    if (!savingHistoryId || !saveTitle.trim()) return;
    const tags = saveTags.split(",").map((t) => t.trim()).filter(Boolean);
    saveFromHistory(savingHistoryId, saveTitle.trim(), saveCategory, tags);
    setSavingHistoryId(null);
    setView("browse");
    setMainTab("library");
  }

  function handleUseFromHistory(item: PromptHistory) {
    onUsePrompt(item.prompt);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-blade-surface border border-blade-border rounded-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            {view !== "browse" && (
              <button
                onClick={() => { setView("browse"); setSelectedPrompt(null); resetForm(); }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-sm font-semibold text-blade-text">
              {view === "browse" && "Prompt Library"}
              {view === "detail" && selectedPrompt?.title}
              {view === "fill" && selectedPrompt?.title}
              {view === "create" && "New Prompt"}
              {view === "edit" && "Edit Prompt"}
              {view === "save-from-history" && "Save to Library"}
            </h2>
            {view === "browse" && (
              <span className="text-2xs text-blade-muted ml-1">
                {stats.totalPrompts} prompts
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {view === "browse" && mainTab === "library" && (
              <button
                onClick={() => { resetForm(); setView("create"); }}
                className="text-2xs px-2.5 py-1 rounded-md bg-blade-accent-muted text-blade-accent hover:bg-blade-accent/20 transition-colors font-medium"
              >
                + Add Prompt
              </button>
            )}
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Tabs */}
        {view === "browse" && (
          <div className="flex gap-1 px-5 pb-2 shrink-0 border-b border-blade-border">
            {(["library", "history"] as MainTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                className={`text-xs px-3 py-1.5 rounded-md transition-colors font-medium capitalize ${
                  mainTab === tab
                    ? "bg-blade-accent-muted text-blade-text"
                    : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
                }`}
              >
                {tab}
                {tab === "history" && history.length > 0 && (
                  <span className="ml-1.5 text-2xs text-blade-muted">({history.length})</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Library Tab ─────────────────────────────────────────────── */}
        {view === "browse" && mainTab === "library" && (
          <>
            {/* Search */}
            <div className="px-5 pt-3 pb-2 shrink-0">
              <div className="relative">
                <svg viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blade-muted" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search prompts..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Category pills + sort */}
            <div className="flex items-center justify-between px-5 pb-2 shrink-0">
              <div className="flex gap-1 flex-wrap">
                {CATEGORY_PILLS.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setCategoryFilter(cat.id)}
                    className={`text-2xs px-2 py-0.5 rounded-md transition-colors font-medium ${
                      categoryFilter === cat.id
                        ? "bg-blade-accent-muted text-blade-text"
                        : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="text-2xs bg-blade-bg border border-blade-border rounded-md px-2 py-0.5 text-blade-muted outline-none cursor-pointer"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            {/* Prompt Cards */}
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-blade-muted">
                  <p className="text-xs">{query ? "No prompts match your search" : "No prompts in this category"}</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((prompt) => (
                    <button
                      key={prompt.id}
                      onClick={() => handleSelectPrompt(prompt)}
                      className="group w-full text-left p-3 rounded-xl border border-blade-border hover:border-blade-accent/30 bg-blade-bg/50 hover:bg-blade-bg transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-blade-text truncate">
                              {prompt.title}
                            </span>
                            <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[prompt.category]}`}>
                              {prompt.category}
                            </span>
                            {prompt.source === "community" && (
                              <span className="text-2xs text-blade-muted/50">community</span>
                            )}
                          </div>
                          <p className="text-2xs text-blade-muted leading-relaxed line-clamp-2">
                            {truncate(prompt.content.replace(/\{\{(\w+)\}\}/g, "[$1]"), 120)}
                          </p>
                          <div className="flex items-center gap-3 mt-1.5">
                            <StarRating rating={prompt.rating} size="xs" />
                            {prompt.usageCount > 0 && (
                              <span className="text-2xs text-blade-muted/50">
                                {prompt.usageCount} use{prompt.usageCount !== 1 ? "s" : ""}
                              </span>
                            )}
                            {prompt.tags.length > 0 && (
                              <div className="flex gap-1">
                                {prompt.tags.slice(0, 3).map((tag) => (
                                  <span key={tag} className="text-2xs text-blade-muted/50">#{tag}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleUseDirectly(prompt); }}
                            className="text-2xs px-2 py-1 rounded-md bg-blade-accent text-white hover:bg-blade-accent/80 transition-colors font-medium"
                          >
                            Use
                          </button>
                          {!prompt.id.startsWith("community-") && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleEdit(prompt); }}
                                className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
                                title="Edit"
                              >
                                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); deletePrompt(prompt.id); }}
                                className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-red-400 hover:bg-red-400/10"
                                title="Delete"
                              >
                                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── History Tab ─────────────────────────────────────────────── */}
        {view === "browse" && mainTab === "history" && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            {history.length > 0 && (
              <div className="flex items-center justify-between px-5 pt-3 pb-2 shrink-0">
                <span className="text-2xs text-blade-muted">{history.length} entries</span>
                <button
                  onClick={clearHistory}
                  className="text-2xs px-2 py-0.5 rounded-md text-red-400 hover:bg-red-400/10 transition-colors"
                >
                  Clear History
                </button>
              </div>
            )}
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-blade-muted">
                  <p className="text-xs">No prompt history yet</p>
                  <p className="text-2xs mt-1">Your prompts will appear here as you use them</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="group p-3 rounded-xl border border-blade-border bg-blade-bg/50 hover:bg-blade-bg transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-blade-text line-clamp-2 mb-1">
                            {truncate(item.prompt, 150)}
                          </p>
                          {item.response && (
                            <p className="text-2xs text-blade-muted line-clamp-1 mb-1.5">
                              {truncate(item.response, 100)}
                            </p>
                          )}
                          <div className="flex items-center gap-3">
                            <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-surface-hover text-blade-muted font-mono">
                              {item.model}
                            </span>
                            <span className="text-2xs text-blade-muted/50">
                              {item.provider}
                            </span>
                            <span className="text-2xs text-blade-muted/50">
                              {timeAgo(item.timestamp)}
                            </span>
                            <StarRating
                              rating={item.rating ?? 0}
                              onRate={(r) => rateHistoryItem(item.id, r)}
                              size="xs"
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => handleUseFromHistory(item)}
                            className="text-2xs px-2 py-1 rounded-md bg-blade-accent text-white hover:bg-blade-accent/80 transition-colors font-medium"
                          >
                            Reuse
                          </button>
                          {!item.saved && (
                            <button
                              onClick={() => handleSaveFromHistory(item)}
                              className="text-2xs px-2 py-1 rounded-md text-blade-accent bg-blade-accent-muted hover:bg-blade-accent/20 transition-colors font-medium"
                            >
                              Save
                            </button>
                          )}
                          {item.saved && (
                            <span className="text-2xs text-emerald-400 px-1">Saved</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Detail View (no variables) ──────────────────────────────── */}
        {view === "detail" && selectedPrompt && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="mb-4 p-4 rounded-xl bg-blade-bg/50 border border-blade-border">
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[selectedPrompt.category]}`}>
                  {selectedPrompt.category}
                </span>
                {selectedPrompt.source === "community" && (
                  <span className="text-2xs text-blade-muted/50">community</span>
                )}
                <div className="ml-auto">
                  <StarRating
                    rating={selectedPrompt.rating}
                    onRate={selectedPrompt.id.startsWith("community-") ? undefined : (r) => ratePrompt(selectedPrompt.id, r)}
                  />
                </div>
              </div>
              <pre className="text-xs text-blade-text leading-relaxed whitespace-pre-wrap font-sans">
                {selectedPrompt.content}
              </pre>
              {selectedPrompt.tags.length > 0 && (
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {selectedPrompt.tags.map((tag) => (
                    <span key={tag} className="text-2xs px-1.5 py-0.5 rounded bg-blade-surface-hover text-blade-muted">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setView("browse"); setSelectedPrompt(null); }}
                className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleUsePrompt}
                className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors"
              >
                Use Prompt
              </button>
            </div>
          </div>
        )}

        {/* ── Fill Variables View ─────────────────────────────────────── */}
        {view === "fill" && selectedPrompt && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="mb-4 p-3 rounded-xl bg-blade-bg/50 border border-blade-border">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-blade-text">{selectedPrompt.title}</span>
                <span className={`text-2xs px-1.5 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[selectedPrompt.category]}`}>
                  {selectedPrompt.category}
                </span>
              </div>
              <p className="text-2xs text-blade-muted leading-relaxed whitespace-pre-wrap">
                {selectedPrompt.content.replace(
                  /\{\{(\w+)\}\}/g,
                  (_, key) => variableValues[key]
                    ? `\u25BA${variableValues[key]}\u25C4`
                    : `[${key}]`,
                )}
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-2xs font-semibold text-blade-secondary uppercase tracking-wider">
                Fill in variables
              </h3>
              {selectedPrompt.variables.map((varName) => (
                <div key={varName}>
                  <label className="block text-2xs text-blade-muted mb-1 capitalize">{varName.replace(/_/g, " ")}</label>
                  {varName === "code" || varName === "diff" || varName === "raw_notes" || varName === "bug_report" || varName === "target" || varName === "changes" || varName === "entities" || varName === "requirements" ? (
                    <textarea
                      value={variableValues[varName] ?? ""}
                      onChange={(e) => setVariableValues((prev) => ({ ...prev, [varName]: e.target.value }))}
                      rows={4}
                      className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors resize-y font-mono"
                      placeholder={`Enter ${varName.replace(/_/g, " ")}...`}
                      autoFocus={selectedPrompt.variables[0] === varName}
                    />
                  ) : (
                    <input
                      type="text"
                      value={variableValues[varName] ?? ""}
                      onChange={(e) => setVariableValues((prev) => ({ ...prev, [varName]: e.target.value }))}
                      className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                      placeholder={`Enter ${varName.replace(/_/g, " ")}...`}
                      autoFocus={selectedPrompt.variables[0] === varName}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setView("browse"); setSelectedPrompt(null); }}
                className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUsePrompt}
                className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors"
              >
                Use Prompt
              </button>
            </div>
          </div>
        )}

        {/* ── Create / Edit View ─────────────────────────────────────── */}
        {(view === "create" || view === "edit") && (
          <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">
            <div className="space-y-3">
              {/* Title */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Title</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Prompt title..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                  autoFocus
                />
              </div>

              {/* Category */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Category</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(["coding", "writing", "analysis", "creative", "productivity", "custom"] as PromptCategory[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setFormCategory(cat)}
                      className={`text-2xs px-2.5 py-1 rounded-md transition-colors font-medium capitalize ${
                        formCategory === cat
                          ? "bg-blade-accent-muted text-blade-text"
                          : "text-blade-muted hover:text-blade-secondary bg-blade-bg border border-blade-border hover:border-blade-accent/30"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1">
                  Prompt Content{" "}
                  <span className="text-blade-muted/60">(use {"{{variable}}"} for placeholders)</span>
                </label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  rows={8}
                  placeholder={"Review this {{language}} code for {{aspect}}:\n\n{{code}}"}
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors resize-y font-mono leading-relaxed"
                />
              </div>

              {/* Detected Variables */}
              {formContent && extractVariables(formContent).length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-2xs text-blade-muted">Variables:</span>
                  {extractVariables(formContent).map((v) => (
                    <span key={v} className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent-muted text-blade-accent font-mono">
                      {v}
                    </span>
                  ))}
                </div>
              )}

              {/* Tags */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  placeholder="review, quality, best-practices"
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { resetForm(); setView("browse"); }}
                  className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSubmit}
                  disabled={!formTitle.trim() || !formContent.trim()}
                  className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editingId ? "Save Changes" : "Add Prompt"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Save from History View ──────────────────────────────────── */}
        {view === "save-from-history" && (
          <div className="flex-1 overflow-y-auto px-5 pb-4 pt-2">
            <div className="space-y-3">
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Title</label>
                <input
                  type="text"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="Give this prompt a name..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Category</label>
                <div className="flex gap-1.5 flex-wrap">
                  {(["coding", "writing", "analysis", "creative", "productivity", "custom"] as PromptCategory[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSaveCategory(cat)}
                      className={`text-2xs px-2.5 py-1 rounded-md transition-colors font-medium capitalize ${
                        saveCategory === cat
                          ? "bg-blade-accent-muted text-blade-text"
                          : "text-blade-muted hover:text-blade-secondary bg-blade-bg border border-blade-border hover:border-blade-accent/30"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Tags (comma-separated)</label>
                <input
                  type="text"
                  value={saveTags}
                  onChange={(e) => setSaveTags(e.target.value)}
                  placeholder="tag1, tag2"
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => { setSavingHistoryId(null); setView("browse"); }}
                  className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveFromHistorySubmit}
                  disabled={!saveTitle.trim()}
                  className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Save to Library
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
