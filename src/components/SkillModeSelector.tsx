import { useState, useMemo, useRef, useEffect } from "react";
import {
  SkillMode,
  SKILL_CATEGORIES,
  CATEGORY_LABELS,
  SkillCategory,
} from "../hooks/useSkillModes";

interface Props {
  open: boolean;
  onClose: () => void;
  onActivate: (systemPrompt: string) => void;
  modes: SkillMode[];
  activeMode: SkillMode | null;
  activateMode: (id: string) => void;
  deactivateMode: () => void;
  addCustomMode: (mode: Omit<SkillMode, "id" | "isBuiltin">) => SkillMode;
  deleteCustomMode: (id: string) => void;
}

type Tab = "all" | SkillCategory;

const ALL_TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  ...SKILL_CATEGORIES.map((c) => ({ key: c as Tab, label: CATEGORY_LABELS[c] })),
];

const EMOJI_OPTIONS = [
  "🤖", "🧠", "🔧", "🎯", "📐", "🧪", "🔬", "💻",
  "🛠️", "📈", "🗂️", "✨", "🧩", "🌐", "🎭", "📦",
];

export function SkillModeSelector({
  open,
  onClose,
  onActivate,
  modes,
  activeMode,
  activateMode,
  deactivateMode,
  addCustomMode,
  deleteCustomMode,
}: Props) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [preview, setPreview] = useState<SkillMode | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    icon: "🤖",
    description: "",
    systemPrompt: "",
    category: "productivity" as SkillCategory,
  });
  const searchRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setSearch("");
      setTab("all");
      setPreview(null);
      setCreating(false);
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (creating) setCreating(false);
        else if (preview) setPreview(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, creating, preview, onClose]);

  const filtered = useMemo(() => {
    let list = modes;
    if (tab !== "all") {
      list = list.filter((m) => m.category === tab);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.category.includes(q)
      );
    }
    return list;
  }, [modes, tab, search]);

  const handleActivate = (mode: SkillMode) => {
    activateMode(mode.id);
    onActivate(mode.systemPrompt);
    onClose();
  };

  const handleDeactivate = () => {
    deactivateMode();
    onActivate("");
    onClose();
  };

  const handleCreateSubmit = () => {
    if (!form.name.trim() || !form.systemPrompt.trim()) return;
    const created = addCustomMode({
      name: form.name.trim(),
      icon: form.icon,
      description: form.description.trim() || `Custom mode: ${form.name.trim()}`,
      systemPrompt: form.systemPrompt.trim(),
      suggestedTools: [],
      category: form.category,
      examples: [],
    });
    setCreating(false);
    setForm({ name: "", icon: "🤖", description: "", systemPrompt: "", category: "productivity" });
    handleActivate(created);
  };

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => e.target === overlayRef.current && onClose()}
    >
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">Skill Modes</h2>
            {activeMode && activeMode.id !== "default" ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-zinc-400">
                  Currently: <span className="text-accent font-medium">{activeMode.icon} {activeMode.name}</span>
                </span>
                <button
                  onClick={handleDeactivate}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-zinc-700 transition-colors"
                >
                  Deactivate
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-500 mt-0.5">Switch AI personality and capabilities</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCreating(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 transition-colors border border-zinc-700/50"
            >
              + Custom Mode
            </button>
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search + Tabs */}
        <div className="px-5 pb-3 space-y-3">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modes... (or type /mode-name in chat)"
            className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 transition-colors"
          />
          <div className="flex gap-1 overflow-x-auto scrollbar-none">
            {ALL_TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-xs px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                  tab === t.key
                    ? "bg-zinc-700 text-zinc-100 font-medium"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {creating ? (
            /* Create Custom Mode Form */
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-zinc-200">Create Custom Mode</h3>

              <div className="flex gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Icon</label>
                  <div className="grid grid-cols-8 gap-1 bg-zinc-800 rounded-lg p-2 border border-zinc-700/50">
                    {EMOJI_OPTIONS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setForm((f) => ({ ...f, icon: e }))}
                        className={`w-8 h-8 rounded-md text-base flex items-center justify-center transition-colors ${
                          form.icon === e
                            ? "bg-zinc-600 ring-1 ring-accent"
                            : "hover:bg-zinc-700"
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 space-y-3">
                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Name</label>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g., Marketing Copywriter"
                      className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-zinc-400 block mb-1">Category</label>
                    <select
                      value={form.category}
                      onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as SkillCategory }))}
                      className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                    >
                      {SKILL_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Description</label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short description of what this mode does"
                  className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">System Prompt</label>
                <textarea
                  value={form.systemPrompt}
                  onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                  placeholder="You are a... Describe the AI persona and behavior in 2-4 sentences."
                  rows={4}
                  className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-600 resize-none"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setCreating(false)}
                  className="text-xs px-4 py-2 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSubmit}
                  disabled={!form.name.trim() || !form.systemPrompt.trim()}
                  className="text-xs px-4 py-2 rounded-lg bg-accent text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
                >
                  Create & Activate
                </button>
              </div>
            </div>
          ) : preview ? (
            /* Mode Preview */
            <div className="space-y-4">
              <button
                onClick={() => setPreview(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors flex items-center gap-1"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M8 2L4 6l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back to modes
              </button>

              <div className="flex items-start gap-3">
                <span className="text-3xl">{preview.icon}</span>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-zinc-100">{preview.name}</h3>
                  <p className="text-sm text-zinc-400 mt-0.5">{preview.description}</p>
                  <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 capitalize">
                    {preview.category}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!preview.isBuiltin && (
                    <button
                      onClick={() => {
                        deleteCustomMode(preview.id);
                        setPreview(null);
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      Delete
                    </button>
                  )}
                  <button
                    onClick={() => handleActivate(preview)}
                    className={`text-xs px-4 py-1.5 rounded-lg font-medium transition ${
                      activeMode?.id === preview.id
                        ? "bg-zinc-700 text-zinc-300"
                        : "bg-accent text-white hover:brightness-110"
                    }`}
                  >
                    {activeMode?.id === preview.id ? "Active" : "Activate"}
                  </button>
                </div>
              </div>

              {preview.systemPrompt && (
                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-1.5">System Prompt</h4>
                  <div className="bg-zinc-800/60 border border-zinc-700/40 rounded-lg p-3 text-sm text-zinc-300 leading-relaxed">
                    {preview.systemPrompt}
                  </div>
                </div>
              )}

              {preview.examples.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-1.5">Example Prompts</h4>
                  <div className="space-y-1.5">
                    {preview.examples.map((ex, i) => (
                      <div
                        key={i}
                        className="bg-zinc-800/40 border border-zinc-700/30 rounded-lg px-3 py-2 text-sm text-zinc-300 cursor-pointer hover:bg-zinc-800/70 transition-colors"
                        onClick={() => {
                          handleActivate(preview);
                        }}
                      >
                        <span className="text-zinc-500 mr-1.5">→</span>
                        {ex}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview.suggestedTools.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-zinc-400 mb-1.5">Suggested Tools</h4>
                  <div className="flex gap-1.5 flex-wrap">
                    {preview.suggestedTools.map((t) => (
                      <span
                        key={t}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700/40"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {preview.shortcut && (
                <p className="text-xs text-zinc-500">
                  Shortcut: <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[11px]">{preview.shortcut}</kbd>
                </p>
              )}
            </div>
          ) : (
            /* Mode Grid */
            <div>
              {filtered.length === 0 ? (
                <p className="text-center text-sm text-zinc-500 py-12">
                  No modes match your search.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {filtered.map((mode) => {
                    const isActive = activeMode?.id === mode.id;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setPreview(mode)}
                        onDoubleClick={() => handleActivate(mode)}
                        className={`text-left p-3 rounded-xl border transition-all group ${
                          isActive
                            ? "border-accent/60 bg-accent/5 ring-1 ring-accent/30"
                            : "border-zinc-700/40 bg-zinc-800/40 hover:bg-zinc-800/70 hover:border-zinc-600/50"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-lg leading-none">{mode.icon}</span>
                          {isActive && (
                            <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                          )}
                          {!mode.isBuiltin && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-500">
                              custom
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-medium text-zinc-200 mt-1.5 leading-tight">
                          {mode.name}
                        </h3>
                        <p className="text-[11px] text-zinc-500 mt-1 line-clamp-2 leading-snug">
                          {mode.description}
                        </p>
                        {mode.shortcut && (
                          <span className="inline-block mt-1.5 text-[10px] text-zinc-600 font-mono">
                            {mode.shortcut}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {!creating && !preview && (
          <div className="px-5 py-2.5 border-t border-zinc-800 flex items-center justify-between">
            <span className="text-[11px] text-zinc-600">
              Click to preview, double-click to activate. Type <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">/mode-name</kbd> in chat to quick-switch.
            </span>
            <span className="text-[11px] text-zinc-600">
              {filtered.length} mode{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default SkillModeSelector;
