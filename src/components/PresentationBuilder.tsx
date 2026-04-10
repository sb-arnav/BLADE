import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  usePresentation,
  Slide,
  Presentation,
  THEME_COLORS,
  SLIDE_TYPE_LABELS,
} from "../hooks/usePresentation";

// ── Constants ──────────────────────────────────────────────────────────

const SLIDE_TYPES = Object.keys(SLIDE_TYPE_LABELS) as Slide["type"][];

const THEME_OPTIONS: { value: Presentation["theme"]; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "blade", label: "Blade" },
  { value: "minimal", label: "Minimal" },
];

const THEME_BADGE_COLORS: Record<Presentation["theme"], string> = {
  dark: "bg-zinc-700/50 text-zinc-300",
  light: "bg-zinc-200/50 text-zinc-700",
  blade: "bg-indigo-500/20 text-indigo-300",
  minimal: "bg-zinc-400/20 text-zinc-400",
};

const BG_PRESETS = [
  "",
  "#0f0f14",
  "#1e1b4b",
  "#172554",
  "#14532d",
  "#7f1d1d",
  "#451a03",
  "#ffffff",
  "#f4f4f5",
  "#18181b",
];

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

function slideTypeIcon(type: Slide["type"]): string {
  const icons: Record<Slide["type"], string> = {
    title: "\u2605",
    content: "\u2261",
    bullets: "\u2022",
    image: "\u25A3",
    code: "</>",
    quote: "\u201C",
    comparison: "\u21C4",
    timeline: "\u2193",
    stats: "\u2191",
  };
  return icons[type] || "\u25A1";
}

// ── Component ──────────────────────────────────────────────────────────

export default function PresentationBuilder({ onBack, onSendToChat }: Props) {
  const {
    presentations,
    active,
    createPresentation,
    deletePresentation,
    updatePresentation,
    setActive,
    addSlide,
    updateSlide,
    deleteSlide,
    reorderSlides,
    duplicateSlide,
    generateFromPrompt,
    exportAsMarkdown,
    exportAsHtml,
    stats,
  } = usePresentation();

  // ── Local state ──────────────────────────────────────────────────────

  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newAuthor, setNewAuthor] = useState("");
  const [newTheme, setNewTheme] = useState<Presentation["theme"]>("dark");
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [genTopic, setGenTopic] = useState("");
  const [genCount, setGenCount] = useState(8);
  const [isPresenting, setIsPresenting] = useState(false);
  const [presentSlideIdx, setPresentSlideIdx] = useState(0);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);
  const presContainerRef = useRef<HTMLDivElement>(null);

  // ── Derived ──────────────────────────────────────────────────────────

  const sortedPresentations = useMemo(
    () => [...presentations].sort((a, b) => b.updatedAt - a.updatedAt),
    [presentations],
  );

  const currentSlide = useMemo(() => {
    if (!active) return null;
    return active.slides[activeSlideIdx] ?? active.slides[0] ?? null;
  }, [active, activeSlideIdx]);

  const themeColors = useMemo(
    () => (active ? THEME_COLORS[active.theme] : THEME_COLORS.dark),
    [active],
  );

  // ── Clamp activeSlideIdx ─────────────────────────────────────────────

  useEffect(() => {
    if (active && activeSlideIdx >= active.slides.length) {
      setActiveSlideIdx(Math.max(0, active.slides.length - 1));
    }
  }, [active, activeSlideIdx]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isPresenting) {
        if (e.key === "Escape") {
          setIsPresenting(false);
          return;
        }
        if (e.key === "ArrowRight" || e.key === " ") {
          e.preventDefault();
          setPresentSlideIdx((i) =>
            active ? Math.min(i + 1, active.slides.length - 1) : i,
          );
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setPresentSlideIdx((i) => Math.max(i - 1, 0));
          return;
        }
        return;
      }

      if (e.key === "Escape") {
        if (editingTitle) {
          setEditingTitle(false);
          return;
        }
        if (active) {
          setActive(null);
          return;
        }
        onBack();
        return;
      }

      // Ctrl+E: export menu
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        setShowExportMenu((v) => !v);
      }

      // Ctrl+Enter: present
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (active && active.slides.length > 0) {
          setPresentSlideIdx(0);
          setIsPresenting(true);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isPresenting, active, editingTitle, onBack, setActive]);

  // ── Handlers ─────────────────────────────────────────────────────────

  const handleCreate = useCallback(() => {
    if (!newTitle.trim()) return;
    createPresentation(newTitle.trim(), newAuthor.trim() || "Anonymous", newTheme);
    setNewTitle("");
    setNewAuthor("");
    setNewTheme("dark");
    setShowNewDialog(false);
    setActiveSlideIdx(0);
  }, [newTitle, newAuthor, newTheme, createPresentation]);

  const handleGenerate = useCallback(() => {
    if (!genTopic.trim() || !active) return;
    const prompt = generateFromPrompt(genTopic.trim(), genCount);
    onSendToChat(prompt);
    setShowGenerateDialog(false);
  }, [genTopic, genCount, active, generateFromPrompt, onSendToChat]);

  const handleAddSlide = useCallback(
    (atIndex?: number) => {
      if (!active) return;
      addSlide(active.id, "content", atIndex);
      setActiveSlideIdx(atIndex ?? active.slides.length);
    },
    [active, addSlide],
  );

  const handleDeleteSlide = useCallback(
    (idx: number) => {
      if (!active) return;
      const slide = active.slides[idx];
      if (!slide) return;
      deleteSlide(active.id, slide.id);
      if (activeSlideIdx >= idx && activeSlideIdx > 0) {
        setActiveSlideIdx(activeSlideIdx - 1);
      }
    },
    [active, activeSlideIdx, deleteSlide],
  );

  const handleDuplicateSlide = useCallback(
    (idx: number) => {
      if (!active) return;
      const slide = active.slides[idx];
      if (!slide) return;
      duplicateSlide(active.id, slide.id);
      setActiveSlideIdx(idx + 1);
    },
    [active, duplicateSlide],
  );

  const handleSlideFieldChange = useCallback(
    (field: string, value: unknown) => {
      if (!active || !currentSlide) return;
      updateSlide(active.id, currentSlide.id, { [field]: value });
    },
    [active, currentSlide, updateSlide],
  );

  const handleDragStart = useCallback((idx: number) => {
    setDragIdx(idx);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, idx: number) => {
      e.preventDefault();
      if (dragIdx !== null && dragIdx !== idx) {
        setDragOverIdx(idx);
      }
    },
    [dragIdx],
  );

  const handleDrop = useCallback(
    (idx: number) => {
      if (!active || dragIdx === null || dragIdx === idx) return;
      reorderSlides(active.id, dragIdx, idx);
      setActiveSlideIdx(idx);
      setDragIdx(null);
      setDragOverIdx(null);
    },
    [active, dragIdx, reorderSlides],
  );

  const handleDragEnd = useCallback(() => {
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const handleExportPdf = useCallback(() => {
    window.print();
    setShowExportMenu(false);
  }, []);

  // ── Presentation mode ────────────────────────────────────────────────

  if (isPresenting && active) {
    const slide = active.slides[presentSlideIdx];
    if (!slide) {
      setIsPresenting(false);
      return null;
    }
    const tc = THEME_COLORS[active.theme];
    const bg = slide.backgroundColor || tc.bg;

    return (
      <div
        ref={presContainerRef}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center select-none"
        style={{ background: bg, color: tc.text }}
        onClick={(e) => {
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          const x = e.clientX - rect.left;
          if (x > rect.width / 2) {
            setPresentSlideIdx((i) => Math.min(i + 1, active.slides.length - 1));
          } else {
            setPresentSlideIdx((i) => Math.max(i - 1, 0));
          }
        }}
      >
        {/* Slide content */}
        <div className="max-w-4xl w-full px-12 text-center">
          {renderSlideContent(slide, tc)}
        </div>

        {/* Controls bar */}
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/50 backdrop-blur-sm px-4 py-2 rounded-full text-white/80 text-sm">
          <button
            className="px-3 py-1 rounded border border-white/20 hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setPresentSlideIdx((i) => Math.max(i - 1, 0));
            }}
          >
            &#8592;
          </button>
          <span className="min-w-[4rem] text-center">
            {presentSlideIdx + 1} / {active.slides.length}
          </span>
          <button
            className="px-3 py-1 rounded border border-white/20 hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setPresentSlideIdx((i) => Math.min(i + 1, active.slides.length - 1));
            }}
          >
            &#8594;
          </button>
          <button
            className="ml-2 px-3 py-1 rounded border border-white/20 hover:bg-white/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsPresenting(false);
            }}
          >
            Exit
          </button>
        </div>
      </div>
    );
  }

  // ── List view (no active presentation) ───────────────────────────────

  if (!active) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/70">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="text-zinc-400 hover:text-zinc-200 transition-colors text-sm"
            >
              &#8592; Back
            </button>
            <h1 className="text-base font-semibold">Presentations</h1>
            <span className="text-xs text-zinc-500">
              {stats.totalPresentations} decks &middot; {stats.totalSlides} slides
            </span>
          </div>
          <button
            onClick={() => setShowNewDialog(true)}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
          >
            + New Deck
          </button>
        </div>

        {/* Presentation list */}
        <div className="flex-1 overflow-y-auto p-5">
          {sortedPresentations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <div className="text-4xl mb-3 opacity-30">{"\u25A1"}</div>
              <p className="text-sm">No presentations yet</p>
              <button
                onClick={() => setShowNewDialog(true)}
                className="mt-3 text-indigo-400 hover:text-indigo-300 text-sm transition-colors"
              >
                Create your first deck
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedPresentations.map((pres) => (
                <div
                  key={pres.id}
                  className="group bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4 cursor-pointer hover:border-indigo-500/40 hover:bg-zinc-900/80 transition-all"
                  onClick={() => {
                    setActive(pres.id);
                    setActiveSlideIdx(0);
                  }}
                >
                  {/* Mini preview */}
                  <div
                    className="h-28 rounded-lg mb-3 flex items-center justify-center text-center px-4"
                    style={{
                      background: THEME_COLORS[pres.theme].bg,
                      color: THEME_COLORS[pres.theme].text,
                    }}
                  >
                    <span className="text-sm font-medium opacity-80 line-clamp-2">
                      {pres.title}
                    </span>
                  </div>
                  <h3 className="text-sm font-medium text-zinc-200 truncate">{pres.title}</h3>
                  <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-500">
                    <span className={`px-1.5 py-0.5 rounded ${THEME_BADGE_COLORS[pres.theme]}`}>
                      {pres.theme}
                    </span>
                    <span>{pres.slides.length} slides</span>
                    <span className="ml-auto">{timeAgo(pres.updatedAt)}</span>
                  </div>
                  {/* Delete button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePresentation(pres.id);
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 text-xs transition-all"
                  >
                    &#10005;
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* New dialog */}
        {showNewDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl p-6 w-full max-w-md shadow-2xl">
              <h2 className="text-base font-semibold mb-4">New Presentation</h2>
              <div className="space-y-3">
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Presentation title"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
                <input
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  placeholder="Author name"
                  value={newAuthor}
                  onChange={(e) => setNewAuthor(e.target.value)}
                />
                <div className="flex gap-2">
                  {THEME_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setNewTheme(t.value)}
                      className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                        newTheme === t.value
                          ? "border-indigo-500 bg-indigo-500/10 text-indigo-300"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setShowNewDialog(false)}
                  className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded-lg transition-colors"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Editor view ──────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/70 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActive(null)}
            className="text-zinc-400 hover:text-zinc-200 transition-colors text-sm"
          >
            &#8592; Decks
          </button>

          {/* Editable title */}
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="bg-zinc-800 border border-indigo-500 rounded px-2 py-0.5 text-sm font-semibold focus:outline-none"
              value={active.title}
              onChange={(e) => updatePresentation(active.id, { title: e.target.value })}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => e.key === "Enter" && setEditingTitle(false)}
              autoFocus
            />
          ) : (
            <h1
              className="text-sm font-semibold cursor-pointer hover:text-indigo-300 transition-colors"
              onClick={() => setEditingTitle(true)}
              title="Click to edit"
            >
              {active.title}
            </h1>
          )}

          <span className={`text-xs px-1.5 py-0.5 rounded ${THEME_BADGE_COLORS[active.theme]}`}>
            {active.theme}
          </span>
          <span className="text-xs text-zinc-500">
            {active.slides.length} slides
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Generate Deck */}
          <button
            onClick={() => setShowGenerateDialog(true)}
            className="px-2.5 py-1 text-xs bg-violet-600/20 text-violet-300 hover:bg-violet-600/30 rounded-lg transition-colors"
          >
            AI Generate
          </button>

          {/* Present */}
          <button
            onClick={() => {
              setPresentSlideIdx(0);
              setIsPresenting(true);
            }}
            className="px-2.5 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
            title="Ctrl+Enter"
          >
            Present
          </button>

          {/* Export */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-2.5 py-1 text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 rounded-lg transition-colors"
            >
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-30 py-1 min-w-[140px]">
                <button
                  onClick={() => { exportAsHtml(); setShowExportMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors"
                >
                  HTML Slideshow
                </button>
                <button
                  onClick={() => { exportAsMarkdown(); setShowExportMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors"
                >
                  Markdown
                </button>
                <button
                  onClick={handleExportPdf}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-700 transition-colors"
                >
                  PDF (Print)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main editor area: navigator + slide + properties */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Slide Navigator (left) ──────────────────────────────────── */}
        <div className="w-48 border-r border-zinc-800/70 overflow-y-auto shrink-0 p-2 space-y-1">
          {active.slides.map((slide, idx) => (
            <div key={slide.id}>
              {/* Insert button between slides */}
              {idx === 0 && (
                <button
                  onClick={() => handleAddSlide(0)}
                  className="w-full py-0.5 text-[10px] text-zinc-600 hover:text-indigo-400 transition-colors text-center"
                >
                  + Add slide
                </button>
              )}

              <div
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDrop={() => handleDrop(idx)}
                onDragEnd={handleDragEnd}
                onClick={() => setActiveSlideIdx(idx)}
                className={`group relative rounded-lg p-1.5 cursor-pointer transition-all ${
                  activeSlideIdx === idx
                    ? "bg-indigo-500/15 border border-indigo-500/40"
                    : "border border-transparent hover:bg-zinc-800/50 hover:border-zinc-700/50"
                } ${dragOverIdx === idx ? "border-indigo-400 bg-indigo-500/10" : ""}`}
              >
                {/* Thumbnail */}
                <div
                  className="h-20 rounded flex items-center justify-center text-center px-2 mb-1"
                  style={{
                    background: slide.backgroundColor || themeColors.bg,
                    color: themeColors.text,
                  }}
                >
                  <span className="text-[9px] leading-tight line-clamp-3 opacity-70">
                    {slide.title || `Slide ${idx + 1}`}
                  </span>
                </div>

                {/* Slide info */}
                <div className="flex items-center justify-between px-0.5">
                  <span className="text-[10px] text-zinc-500">
                    {idx + 1}. {slideTypeIcon(slide.type)}
                  </span>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateSlide(idx);
                      }}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 px-0.5"
                      title="Duplicate"
                    >
                      {"\u2398"}
                    </button>
                    {active.slides.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSlide(idx);
                        }}
                        className="text-[10px] text-zinc-500 hover:text-red-400 px-0.5"
                        title="Delete"
                      >
                        &#10005;
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Insert after button */}
              <button
                onClick={() => handleAddSlide(idx + 1)}
                className="w-full py-0.5 text-[10px] text-zinc-600 hover:text-indigo-400 transition-colors text-center"
              >
                +
              </button>
            </div>
          ))}
        </div>

        {/* ── Slide Editor (center) ───────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-6 bg-zinc-900/30">
          {currentSlide ? (
            <div
              className="w-full max-w-3xl aspect-video rounded-xl shadow-2xl flex flex-col items-center justify-center p-10 relative overflow-hidden"
              style={{
                background: currentSlide.backgroundColor || themeColors.bg,
                color: themeColors.text,
              }}
            >
              {renderEditableSlide(currentSlide, themeColors, handleSlideFieldChange, active)}
            </div>
          ) : (
            <div className="text-zinc-500 text-sm">No slide selected</div>
          )}
        </div>

        {/* ── Properties Panel (right) ────────────────────────────────── */}
        <div className="w-56 border-l border-zinc-800/70 overflow-y-auto shrink-0 p-3 space-y-4">
          {currentSlide && (
            <>
              {/* Slide type */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                  Slide Type
                </label>
                <div className="grid grid-cols-3 gap-1">
                  {SLIDE_TYPES.map((t) => (
                    <button
                      key={t}
                      onClick={() => handleSlideFieldChange("type", t)}
                      className={`text-[10px] py-1.5 rounded transition-colors ${
                        currentSlide.type === t
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                          : "bg-zinc-800/50 text-zinc-400 border border-transparent hover:bg-zinc-800"
                      }`}
                    >
                      {slideTypeIcon(t)} {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Background color */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                  Background
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {BG_PRESETS.map((c) => (
                    <button
                      key={c || "default"}
                      onClick={() => handleSlideFieldChange("backgroundColor", c)}
                      className={`w-6 h-6 rounded-md border transition-all ${
                        currentSlide.backgroundColor === c
                          ? "border-indigo-400 ring-1 ring-indigo-400/50"
                          : "border-zinc-700 hover:border-zinc-500"
                      }`}
                      style={{
                        background: c || themeColors.bg,
                      }}
                      title={c || "Theme default"}
                    />
                  ))}
                </div>
                <input
                  className="mt-1.5 w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-indigo-500"
                  placeholder="Custom color (#hex)"
                  value={currentSlide.backgroundColor}
                  onChange={(e) =>
                    handleSlideFieldChange("backgroundColor", e.target.value)
                  }
                />
              </div>

              {/* Theme */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                  Deck Theme
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {THEME_OPTIONS.map((t) => (
                    <button
                      key={t.value}
                      onClick={() =>
                        updatePresentation(active.id, { theme: t.value })
                      }
                      className={`text-[11px] py-1.5 rounded transition-colors ${
                        active.theme === t.value
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                          : "bg-zinc-800/50 text-zinc-400 border border-transparent hover:bg-zinc-800"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                  Speaker Notes
                </label>
                <textarea
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs resize-none focus:outline-none focus:border-indigo-500 min-h-[80px]"
                  placeholder="Add speaker notes..."
                  value={currentSlide.notes}
                  onChange={(e) =>
                    handleSlideFieldChange("notes", e.target.value)
                  }
                />
              </div>

              {/* Type-specific fields */}
              {currentSlide.type === "bullets" && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                    Bullet Points
                  </label>
                  {(currentSlide.bullets || []).map((b, i) => (
                    <div key={i} className="flex gap-1 mb-1">
                      <input
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-indigo-500"
                        value={b}
                        onChange={(e) => {
                          const next = [...(currentSlide.bullets || [])];
                          next[i] = e.target.value;
                          handleSlideFieldChange("bullets", next);
                        }}
                      />
                      <button
                        onClick={() => {
                          const next = (currentSlide.bullets || []).filter(
                            (_, j) => j !== i,
                          );
                          handleSlideFieldChange("bullets", next);
                        }}
                        className="text-zinc-500 hover:text-red-400 text-[10px] px-1"
                      >
                        &#10005;
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      handleSlideFieldChange("bullets", [
                        ...(currentSlide.bullets || []),
                        "",
                      ])
                    }
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-1"
                  >
                    + Add bullet
                  </button>
                </div>
              )}

              {currentSlide.type === "code" && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                    Code
                  </label>
                  <input
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] mb-1 focus:outline-none focus:border-indigo-500"
                    placeholder="Language"
                    value={currentSlide.code?.language || ""}
                    onChange={(e) =>
                      handleSlideFieldChange("code", {
                        ...(currentSlide.code || { language: "", code: "" }),
                        language: e.target.value,
                      })
                    }
                  />
                  <textarea
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 py-2 text-xs font-mono resize-none focus:outline-none focus:border-indigo-500 min-h-[100px]"
                    placeholder="Code snippet..."
                    value={currentSlide.code?.code || ""}
                    onChange={(e) =>
                      handleSlideFieldChange("code", {
                        ...(currentSlide.code || { language: "", code: "" }),
                        code: e.target.value,
                      })
                    }
                  />
                </div>
              )}

              {currentSlide.type === "stats" && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                    Statistics
                  </label>
                  {(currentSlide.stats || []).map((s, i) => (
                    <div key={i} className="bg-zinc-800/50 rounded p-1.5 mb-1 space-y-1">
                      <input
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
                        placeholder="Label"
                        value={s.label}
                        onChange={(e) => {
                          const next = [...(currentSlide.stats || [])];
                          next[i] = { ...next[i], label: e.target.value };
                          handleSlideFieldChange("stats", next);
                        }}
                      />
                      <div className="flex gap-1">
                        <input
                          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
                          placeholder="Value"
                          value={s.value}
                          onChange={(e) => {
                            const next = [...(currentSlide.stats || [])];
                            next[i] = { ...next[i], value: e.target.value };
                            handleSlideFieldChange("stats", next);
                          }}
                        />
                        <input
                          className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
                          placeholder="+/-"
                          value={s.change || ""}
                          onChange={(e) => {
                            const next = [...(currentSlide.stats || [])];
                            next[i] = { ...next[i], change: e.target.value };
                            handleSlideFieldChange("stats", next);
                          }}
                        />
                      </div>
                      <button
                        onClick={() => {
                          const next = (currentSlide.stats || []).filter((_, j) => j !== i);
                          handleSlideFieldChange("stats", next);
                        }}
                        className="text-[9px] text-zinc-500 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      handleSlideFieldChange("stats", [
                        ...(currentSlide.stats || []),
                        { label: "", value: "", change: "" },
                      ])
                    }
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-1"
                  >
                    + Add stat
                  </button>
                </div>
              )}

              {currentSlide.type === "comparison" && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                    Comparison
                  </label>
                  {(["left", "right"] as const).map((side) => {
                    const data = currentSlide.comparison?.[side] || { title: "", points: [] };
                    return (
                      <div key={side} className="bg-zinc-800/50 rounded p-1.5 mb-1.5">
                        <input
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] mb-1 focus:outline-none focus:border-indigo-500"
                          placeholder={`${side === "left" ? "Left" : "Right"} title`}
                          value={data.title}
                          onChange={(e) => {
                            const comp = currentSlide.comparison || {
                              left: { title: "", points: [] },
                              right: { title: "", points: [] },
                            };
                            handleSlideFieldChange("comparison", {
                              ...comp,
                              [side]: { ...comp[side], title: e.target.value },
                            });
                          }}
                        />
                        {data.points.map((p, pi) => (
                          <div key={pi} className="flex gap-1 mb-0.5">
                            <input
                              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
                              value={p}
                              onChange={(e) => {
                                const comp = currentSlide.comparison || {
                                  left: { title: "", points: [] },
                                  right: { title: "", points: [] },
                                };
                                const pts = [...comp[side].points];
                                pts[pi] = e.target.value;
                                handleSlideFieldChange("comparison", {
                                  ...comp,
                                  [side]: { ...comp[side], points: pts },
                                });
                              }}
                            />
                            <button
                              onClick={() => {
                                const comp = currentSlide.comparison || {
                                  left: { title: "", points: [] },
                                  right: { title: "", points: [] },
                                };
                                const pts = comp[side].points.filter((_, j) => j !== pi);
                                handleSlideFieldChange("comparison", {
                                  ...comp,
                                  [side]: { ...comp[side], points: pts },
                                });
                              }}
                              className="text-zinc-500 hover:text-red-400 text-[9px]"
                            >
                              &#10005;
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const comp = currentSlide.comparison || {
                              left: { title: "", points: [] },
                              right: { title: "", points: [] },
                            };
                            handleSlideFieldChange("comparison", {
                              ...comp,
                              [side]: { ...comp[side], points: [...comp[side].points, ""] },
                            });
                          }}
                          className="text-[9px] text-indigo-400 hover:text-indigo-300"
                        >
                          + Point
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {currentSlide.type === "timeline" && (
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 block">
                    Timeline Items
                  </label>
                  {(currentSlide.timeline || []).map((t, i) => (
                    <div key={i} className="bg-zinc-800/50 rounded p-1.5 mb-1 space-y-1">
                      <input
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
                        placeholder="Label (date, phase...)"
                        value={t.label}
                        onChange={(e) => {
                          const next = [...(currentSlide.timeline || [])];
                          next[i] = { ...next[i], label: e.target.value };
                          handleSlideFieldChange("timeline", next);
                        }}
                      />
                      <input
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus:border-indigo-500"
                        placeholder="Description"
                        value={t.description}
                        onChange={(e) => {
                          const next = [...(currentSlide.timeline || [])];
                          next[i] = { ...next[i], description: e.target.value };
                          handleSlideFieldChange("timeline", next);
                        }}
                      />
                      <button
                        onClick={() => {
                          const next = (currentSlide.timeline || []).filter((_, j) => j !== i);
                          handleSlideFieldChange("timeline", next);
                        }}
                        className="text-[9px] text-zinc-500 hover:text-red-400"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      handleSlideFieldChange("timeline", [
                        ...(currentSlide.timeline || []),
                        { label: "", description: "" },
                      ])
                    }
                    className="text-[10px] text-indigo-400 hover:text-indigo-300 mt-1"
                  >
                    + Add item
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Generate dialog */}
      {showGenerateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h2 className="text-base font-semibold mb-1">Generate Deck with AI</h2>
            <p className="text-xs text-zinc-500 mb-4">
              Describe the topic and the AI will create a full slide deck.
            </p>
            <div className="space-y-3">
              <textarea
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-indigo-500 min-h-[80px]"
                placeholder="e.g. Introduction to Rust programming language for web developers"
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                autoFocus
              />
              <div className="flex items-center gap-3">
                <label className="text-xs text-zinc-400">Slide count:</label>
                <input
                  type="range"
                  min={4}
                  max={20}
                  value={genCount}
                  onChange={(e) => setGenCount(parseInt(e.target.value))}
                  className="flex-1 accent-indigo-500"
                />
                <span className="text-sm font-medium text-indigo-300 min-w-[2rem] text-center">
                  {genCount}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowGenerateDialog(false)}
                className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg transition-colors"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Render helpers (outside component to keep JSX cleaner) ─────────────

function renderSlideContent(
  slide: Slide,
  tc: { bg: string; text: string; accent: string; surface: string },
): ReactElement {
  switch (slide.type) {
    case "title":
      return (
        <div className="text-center">
          <h1 className="text-4xl font-bold mb-3">{slide.title || "Untitled"}</h1>
          <p className="text-lg opacity-60">{slide.content}</p>
        </div>
      );

    case "content":
      return (
        <div className="text-left w-full max-w-2xl">
          <h2 className="text-3xl font-bold mb-4">{slide.title}</h2>
          <p className="text-base leading-relaxed opacity-80">{slide.content}</p>
        </div>
      );

    case "bullets":
      return (
        <div className="text-left w-full max-w-2xl">
          <h2 className="text-3xl font-bold mb-5">{slide.title}</h2>
          <ul className="space-y-2">
            {(slide.bullets || []).map((b, i) => (
              <li key={i} className="flex items-start gap-3 text-base">
                <span className="mt-1.5 w-2 h-2 rounded-full shrink-0" style={{ background: tc.accent }} />
                <span className="opacity-80">{b}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case "code":
      return (
        <div className="text-left w-full max-w-2xl">
          <h2 className="text-2xl font-bold mb-4">{slide.title}</h2>
          <pre
            className="rounded-xl p-5 text-sm font-mono overflow-x-auto text-left"
            style={{ background: tc.surface }}
          >
            <code>{slide.code?.code || ""}</code>
          </pre>
          {slide.code?.language && (
            <span className="text-xs opacity-40 mt-1 inline-block">{slide.code.language}</span>
          )}
        </div>
      );

    case "quote":
      return (
        <div className="text-center max-w-2xl">
          <div
            className="text-2xl italic leading-relaxed mb-4"
            style={{ borderLeft: `4px solid ${tc.accent}`, paddingLeft: "1.2em", textAlign: "left" }}
          >
            {slide.content || "Quote text..."}
          </div>
          <p className="opacity-50 text-sm">{slide.title}</p>
        </div>
      );

    case "stats":
      return (
        <div className="w-full max-w-2xl">
          <h2 className="text-3xl font-bold mb-6 text-center">{slide.title}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(slide.stats || []).map((s, i) => (
              <div
                key={i}
                className="rounded-xl p-4 text-center"
                style={{ background: tc.surface }}
              >
                <div className="text-2xl font-bold" style={{ color: tc.accent }}>
                  {s.value}
                </div>
                <div className="text-xs opacity-60 mt-1">{s.label}</div>
                {s.change && (
                  <div className="text-xs text-green-400 mt-0.5">{s.change}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      );

    case "comparison":
      return (
        <div className="w-full max-w-2xl">
          <h2 className="text-3xl font-bold mb-6 text-center">{slide.title}</h2>
          <div className="grid grid-cols-2 gap-6">
            {slide.comparison &&
              (["left", "right"] as const).map((side) => {
                const data = slide.comparison![side];
                return (
                  <div key={side} className="rounded-xl p-5 text-left" style={{ background: tc.surface }}>
                    <h3 className="text-lg font-semibold mb-3" style={{ color: tc.accent }}>
                      {data.title}
                    </h3>
                    <ul className="space-y-1.5">
                      {data.points.map((p, i) => (
                        <li key={i} className="text-sm opacity-80 flex items-start gap-2">
                          <span className="opacity-50">&#8226;</span> {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
          </div>
        </div>
      );

    case "timeline":
      return (
        <div className="w-full max-w-2xl text-left">
          <h2 className="text-3xl font-bold mb-6">{slide.title}</h2>
          <div className="relative pl-6" style={{ borderLeft: `3px solid ${tc.accent}` }}>
            {(slide.timeline || []).map((t, i) => (
              <div key={i} className="mb-5 relative">
                <div
                  className="absolute -left-[1.9rem] top-1 w-3 h-3 rounded-full"
                  style={{ background: tc.accent }}
                />
                <div className="font-semibold text-sm" style={{ color: tc.accent }}>
                  {t.label}
                </div>
                <div className="text-sm opacity-70 mt-0.5">{t.description}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "image":
      return (
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">{slide.title}</h2>
          <div
            className="w-full h-48 rounded-xl flex items-center justify-center"
            style={{ background: tc.surface }}
          >
            <span className="text-zinc-500 text-sm">Image placeholder</span>
          </div>
          {slide.content && <p className="text-sm opacity-60 mt-3">{slide.content}</p>}
        </div>
      );

    default:
      return (
        <div>
          <h2 className="text-2xl font-bold mb-2">{slide.title}</h2>
          <p className="opacity-70">{slide.content}</p>
        </div>
      );
  }
}

function renderEditableSlide(
  slide: Slide,
  tc: { bg: string; text: string; accent: string; surface: string },
  onChange: (field: string, value: unknown) => void,
  _pres: Presentation,
): ReactElement {
  const titleInput = (
    <input
      className="bg-transparent border-none outline-none w-full text-center font-bold focus:ring-1 focus:ring-indigo-500/30 rounded px-2 py-1"
      style={{ color: tc.text }}
      value={slide.title}
      onChange={(e) => onChange("title", e.target.value)}
      placeholder="Click to add title..."
    />
  );

  const contentTextarea = (
    <textarea
      className="bg-transparent border-none outline-none w-full resize-none focus:ring-1 focus:ring-indigo-500/30 rounded px-2 py-1 min-h-[60px]"
      style={{ color: tc.text, opacity: 0.8 }}
      value={slide.content}
      onChange={(e) => onChange("content", e.target.value)}
      placeholder="Click to add content..."
    />
  );

  switch (slide.type) {
    case "title":
      return (
        <div className="text-center w-full">
          <div className="text-4xl mb-3">{titleInput}</div>
          <div className="text-lg opacity-60">{contentTextarea}</div>
        </div>
      );

    case "content":
      return (
        <div className="text-left w-full">
          <div className="text-3xl mb-4">{titleInput}</div>
          <div className="text-base leading-relaxed">{contentTextarea}</div>
        </div>
      );

    case "bullets":
      return (
        <div className="text-left w-full">
          <div className="text-3xl mb-4">{titleInput}</div>
          <ul className="space-y-1.5">
            {(slide.bullets || []).map((b, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tc.accent }} />
                <span className="text-sm opacity-70">{b}</span>
              </li>
            ))}
            {(!slide.bullets || slide.bullets.length === 0) && (
              <li className="text-sm opacity-30">Add bullets in the properties panel</li>
            )}
          </ul>
        </div>
      );

    case "code":
      return (
        <div className="text-left w-full">
          <div className="text-2xl mb-3">{titleInput}</div>
          <pre
            className="rounded-xl p-4 text-xs font-mono overflow-x-auto"
            style={{ background: tc.surface }}
          >
            <code>{slide.code?.code || "// Edit code in properties panel"}</code>
          </pre>
        </div>
      );

    case "quote":
      return (
        <div className="w-full text-center">
          <div
            className="text-xl italic mb-3"
            style={{ borderLeft: `4px solid ${tc.accent}`, paddingLeft: "1em", textAlign: "left" }}
          >
            {contentTextarea}
          </div>
          <div className="text-sm opacity-50">{titleInput}</div>
        </div>
      );

    case "stats":
      return (
        <div className="w-full">
          <div className="text-3xl mb-5 text-center">{titleInput}</div>
          <div className="grid grid-cols-2 gap-3">
            {(slide.stats || []).map((s, i) => (
              <div key={i} className="rounded-lg p-3 text-center" style={{ background: tc.surface }}>
                <div className="text-xl font-bold" style={{ color: tc.accent }}>{s.value || "--"}</div>
                <div className="text-[10px] opacity-60">{s.label || "Label"}</div>
              </div>
            ))}
            {(!slide.stats || slide.stats.length === 0) && (
              <div className="col-span-2 text-sm opacity-30 text-center py-4">
                Add stats in the properties panel
              </div>
            )}
          </div>
        </div>
      );

    case "comparison":
      return (
        <div className="w-full">
          <div className="text-3xl mb-4 text-center">{titleInput}</div>
          <div className="grid grid-cols-2 gap-4">
            {slide.comparison ? (
              (["left", "right"] as const).map((side) => {
                const data = slide.comparison![side];
                return (
                  <div key={side} className="rounded-lg p-3 text-left" style={{ background: tc.surface }}>
                    <h3 className="text-sm font-semibold mb-2" style={{ color: tc.accent }}>
                      {data.title || "Side"}
                    </h3>
                    <ul className="space-y-1">
                      {data.points.map((p, i) => (
                        <li key={i} className="text-xs opacity-70">&#8226; {p}</li>
                      ))}
                    </ul>
                  </div>
                );
              })
            ) : (
              <div className="col-span-2 text-sm opacity-30 text-center py-4">
                Add comparison in the properties panel
              </div>
            )}
          </div>
        </div>
      );

    case "timeline":
      return (
        <div className="w-full text-left">
          <div className="text-3xl mb-4">{titleInput}</div>
          <div className="relative pl-5" style={{ borderLeft: `3px solid ${tc.accent}` }}>
            {(slide.timeline || []).map((t, i) => (
              <div key={i} className="mb-3 relative">
                <div
                  className="absolute -left-[1.6rem] top-1 w-2.5 h-2.5 rounded-full"
                  style={{ background: tc.accent }}
                />
                <div className="text-xs font-semibold" style={{ color: tc.accent }}>{t.label}</div>
                <div className="text-xs opacity-60">{t.description}</div>
              </div>
            ))}
            {(!slide.timeline || slide.timeline.length === 0) && (
              <div className="text-xs opacity-30 py-2">Add timeline items in the properties panel</div>
            )}
          </div>
        </div>
      );

    case "image":
      return (
        <div className="w-full text-center">
          <div className="text-2xl mb-3">{titleInput}</div>
          <div
            className="w-full h-36 rounded-xl flex items-center justify-center mb-2"
            style={{ background: tc.surface }}
          >
            <span className="text-xs opacity-30">Image placeholder</span>
          </div>
          {contentTextarea}
        </div>
      );

    default:
      return (
        <div className="w-full">
          <div className="text-2xl mb-2">{titleInput}</div>
          {contentTextarea}
        </div>
      );
  }
}
