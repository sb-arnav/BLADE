import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ChatSpace } from "../hooks/useChatSpaces";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  spaces: ChatSpace[];
  activeSpaceId: string;
  unread: Record<string, boolean>;
  onSwitch: (spaceId: string) => void;
  onCreateSpace: (space: NewSpaceForm) => void;
  onUpdateSpace: (spaceId: string, updates: Partial<ChatSpace>) => void;
  onDeleteSpace: (spaceId: string) => void;
  onArchiveSpace: (spaceId: string) => void;
  onReorder: (ids: string[]) => void;
  onDuplicateSpace: (spaceId: string) => void;
}

export interface NewSpaceForm {
  name: string;
  icon: string;
  description: string;
  type: ChatSpace["type"];
  systemPrompt?: string;
  model?: string;
  provider?: string;
  color?: string;
}

interface ContextMenuState {
  spaceId: string;
  x: number;
  y: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SPACE_TYPE_OPTIONS: { value: ChatSpace["type"]; label: string }[] = [
  { value: "general", label: "General" },
  { value: "code", label: "Code" },
  { value: "research", label: "Research" },
  { value: "creative", label: "Creative" },
  { value: "data", label: "Data" },
  { value: "ops", label: "Ops" },
  { value: "custom", label: "Custom" },
];

const EMOJI_GRID = [
  "\u{1F4AC}", "\u{1F4BB}", "\u{1F52C}", "\u{270D}\u{FE0F}", "\u{1F4CA}", "\u{1F527}",
  "\u{1F680}", "\u{1F3AF}", "\u{1F9E0}", "\u{2728}", "\u{1F4D0}", "\u{1F5C2}\u{FE0F}",
  "\u{1F310}", "\u{1F512}", "\u{1F916}", "\u{1F9EA}", "\u{1F4E6}", "\u{1F3AD}",
  "\u{1F4A1}", "\u{1F4DD}", "\u{26A1}", "\u{1F525}", "\u{2764}\u{FE0F}", "\u{1F308}",
  "\u{1F30D}", "\u{1F3B5}", "\u{1F4F7}", "\u{1F4DA}", "\u{1F9D1}\u{200D}\u{1F4BB}", "\u{2699}\u{FE0F}",
];

const COLOR_OPTIONS = [
  "#71717a", "#ef4444", "#f59e0b", "#22c55e", "#10b981",
  "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#f97316",
];

const DEFAULT_FORM: NewSpaceForm = {
  name: "",
  icon: "\u{2728}",
  description: "",
  type: "custom",
  systemPrompt: "",
  model: "",
  provider: "",
  color: "#71717a",
};

// ── Component ─────────────────────────────────────────────────────────────────

export function SpaceSwitcher({
  spaces,
  activeSpaceId,
  unread,
  onSwitch,
  onCreateSpace,
  onUpdateSpace,
  onDeleteSpace,
  onArchiveSpace,
  onReorder,
  onDuplicateSpace,
}: Props) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewSpaceForm>({ ...DEFAULT_FORM });
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [tooltip, setTooltip] = useState<{ text: string; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const activeSpaces = useMemo(() => spaces.filter((s) => !s.archived), [spaces]);
  const archivedSpaces = useMemo(() => spaces.filter((s) => s.archived), [spaces]);
  const [showArchived, setShowArchived] = useState(false);

  // ── Keyboard shortcuts: Ctrl+1 through Ctrl+6 ──────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= 6) {
        const target = activeSpaces[num - 1];
        if (target) {
          e.preventDefault();
          onSwitch(target.id);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeSpaces, onSwitch]);

  // ── Close context menu on outside click ─────────────────────────────────────

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  // ── Focus rename input ──────────────────────────────────────────────────────

  useEffect(() => {
    if (renaming) {
      setTimeout(() => renameRef.current?.focus(), 30);
    }
  }, [renaming]);

  // ── Close modal on Escape ───────────────────────────────────────────────────

  useEffect(() => {
    if (!showModal) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowModal(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showModal]);

  // ── Context menu handlers ───────────────────────────────────────────────────

  const handleContextMenu = useCallback((e: React.MouseEvent, spaceId: string) => {
    e.preventDefault();
    setContextMenu({ spaceId, x: e.clientX, y: e.clientY });
  }, []);

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { spaceId } = contextMenu;
      setContextMenu(null);

      switch (action) {
        case "rename": {
          const space = spaces.find((s) => s.id === spaceId);
          if (space) {
            setRenaming(spaceId);
            setRenameValue(space.name);
          }
          break;
        }
        case "icon": {
          // Open modal in edit mode — for simplicity we handle inline
          const space = spaces.find((s) => s.id === spaceId);
          if (space) {
            const nextIdx = EMOJI_GRID.indexOf(space.icon);
            const newIcon = EMOJI_GRID[(nextIdx + 1) % EMOJI_GRID.length];
            onUpdateSpace(spaceId, { icon: newIcon });
          }
          break;
        }
        case "color": {
          const space = spaces.find((s) => s.id === spaceId);
          if (space) {
            const idx = COLOR_OPTIONS.indexOf(space.color);
            const newColor = COLOR_OPTIONS[(idx + 1) % COLOR_OPTIONS.length];
            onUpdateSpace(spaceId, { color: newColor });
          }
          break;
        }
        case "duplicate":
          onDuplicateSpace(spaceId);
          break;
        case "archive":
          onArchiveSpace(spaceId);
          break;
        case "delete":
          onDeleteSpace(spaceId);
          break;
      }
    },
    [contextMenu, spaces, onUpdateSpace, onDuplicateSpace, onArchiveSpace, onDeleteSpace]
  );

  const commitRename = useCallback(() => {
    if (renaming && renameValue.trim()) {
      onUpdateSpace(renaming, { name: renameValue.trim() });
    }
    setRenaming(null);
    setRenameValue("");
  }, [renaming, renameValue, onUpdateSpace]);

  // ── Drag reorder ────────────────────────────────────────────────────────────

  const handleDragStart = useCallback((spaceId: string) => {
    setDragId(spaceId);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, spaceId: string) => {
    e.preventDefault();
    setDragOverId(spaceId);
  }, []);

  const handleDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        setDragOverId(null);
        return;
      }
      const ids = activeSpaces.map((s) => s.id);
      const fromIdx = ids.indexOf(dragId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      const reordered = [...ids];
      reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, dragId);
      onReorder(reordered);
      setDragId(null);
      setDragOverId(null);
    },
    [dragId, activeSpaces, onReorder]
  );

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  // ── Create submit ───────────────────────────────────────────────────────────

  const handleCreateSubmit = useCallback(() => {
    if (!form.name.trim()) return;
    onCreateSpace({
      ...form,
      name: form.name.trim(),
      description: form.description.trim() || `Space for ${form.name.trim()}`,
      model: form.model?.trim() || undefined,
      provider: form.provider?.trim() || undefined,
    });
    setForm({ ...DEFAULT_FORM });
    setShowModal(false);
  }, [form, onCreateSpace]);

  // ── Render helpers ──────────────────────────────────────────────────────────

  const renderSpaceIcon = (space: ChatSpace, isActive: boolean) => {
    const isBeingDragged = dragId === space.id;
    const isDragTarget = dragOverId === space.id && dragId !== space.id;

    return (
      <div
        key={space.id}
        className="relative flex items-center justify-center group"
        draggable
        onDragStart={() => handleDragStart(space.id)}
        onDragOver={(e) => handleDragOver(e, space.id)}
        onDrop={() => handleDrop(space.id)}
        onDragEnd={handleDragEnd}
        onMouseEnter={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setTooltip({ text: `${space.name} (${space.messageCount})`, y: rect.top + rect.height / 2 });
        }}
        onMouseLeave={() => setTooltip(null)}
        onContextMenu={(e) => handleContextMenu(e, space.id)}
      >
        {/* Active indicator bar */}
        <div
          className="absolute left-0 w-1 rounded-r-full transition-all duration-200"
          style={{
            height: isActive ? "32px" : "0px",
            backgroundColor: space.color,
            opacity: isActive ? 1 : 0,
          }}
        />

        <button
          onClick={() => {
            if (renaming === space.id) return;
            onSwitch(space.id);
          }}
          className={[
            "w-10 h-10 rounded-2xl flex items-center justify-center text-lg transition-all duration-200 cursor-pointer select-none",
            isActive
              ? "ring-2 scale-110 rounded-xl shadow-lg"
              : "hover:rounded-xl hover:shadow-md opacity-80 hover:opacity-100",
            isBeingDragged ? "opacity-40" : "",
            isDragTarget ? "ring-2 ring-dashed ring-zinc-500" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{
            backgroundColor: `${space.color}22`,
            ...(isActive ? { ringColor: space.color, boxShadow: `0 0 12px ${space.color}33` } : {}),
            borderColor: isActive ? space.color : "transparent",
            border: isActive ? `2px solid ${space.color}` : "2px solid transparent",
          }}
          title={space.name}
        >
          {renaming === space.id ? (
            <input
              ref={renameRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setRenaming(null); setRenameValue(""); }
              }}
              className="w-8 bg-transparent text-[10px] text-white text-center outline-none"
            />
          ) : (
            <span className="pointer-events-none">{space.icon}</span>
          )}
        </button>

        {/* Unread indicator */}
        {unread[space.id] && !isActive && (
          <div
            className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[rgba(255,255,255,0.1)]"
            style={{ backgroundColor: space.color }}
          />
        )}
      </div>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Vertical sidebar bar */}
      <div className="w-12 h-full bg-blade-bg border-r border-[rgba(255,255,255,0.07)]/60 flex flex-col items-center py-2 gap-1.5 relative shrink-0">
        {/* Active spaces */}
        {activeSpaces.map((space) => renderSpaceIcon(space, space.id === activeSpaceId))}

        {/* Separator before archived */}
        {archivedSpaces.length > 0 && (
          <>
            <div className="w-6 h-px bg-[rgba(255,255,255,0.07)]/50 my-1" />
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="w-10 h-5 flex items-center justify-center text-[10px] text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.5)] transition-colors"
              title={showArchived ? "Hide archived" : `Archived (${archivedSpaces.length})`}
            >
              {showArchived ? "\u{25B4}" : `\u{25BE}${archivedSpaces.length}`}
            </button>
            {showArchived &&
              archivedSpaces.map((space) => (
                <div key={space.id} className="opacity-50">
                  {renderSpaceIcon(space, space.id === activeSpaceId)}
                </div>
              ))}
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Create button */}
        <button
          onClick={() => setShowModal(true)}
          className="w-10 h-10 rounded-2xl flex items-center justify-center text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.04)] hover:rounded-xl transition-all duration-200 mb-1 border border-dashed border-[rgba(255,255,255,0.1)]/50 hover:border-[rgba(255,255,255,0.15)] cursor-pointer"
          title="Create new space"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3v12M3 9h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-[100] px-2.5 py-1 rounded-md bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 text-xs text-[rgba(255,255,255,0.85)] whitespace-nowrap shadow-lg pointer-events-none"
          style={{ left: 56, top: tooltip.y - 12 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[110] bg-blade-bg border border-[rgba(255,255,255,0.1)]/60 rounded-lg shadow-2xl py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            { key: "rename", label: "Rename", icon: "\u{270F}\u{FE0F}" },
            { key: "icon", label: "Cycle icon", icon: "\u{1F3AD}" },
            { key: "color", label: "Cycle color", icon: "\u{1F3A8}" },
            { key: "duplicate", label: "Duplicate", icon: "\u{1F4CB}" },
            { key: "archive", label: "Archive / Unarchive", icon: "\u{1F4E6}" },
            { key: "delete", label: "Delete", icon: "\u{1F5D1}\u{FE0F}" },
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => handleContextAction(item.key)}
              className={[
                "w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors",
                item.key === "delete"
                  ? "text-red-400 hover:bg-red-500/10"
                  : "text-[rgba(255,255,255,0.7)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white",
              ].join(" ")}
            >
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* Create space modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div
            ref={modalRef}
            className="bg-blade-bg border border-[rgba(255,255,255,0.1)]/60 rounded-2xl shadow-2xl w-[480px] max-h-[85vh] flex flex-col overflow-hidden"
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <h2 className="text-lg font-semibold text-white">Create Space</h2>
              <button
                onClick={() => setShowModal(false)}
                className="text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] transition-colors text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 pb-5 space-y-4 overflow-y-auto">
              {/* Icon + Name row */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowEmojiPicker((v) => !v)}
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl border border-[rgba(255,255,255,0.1)]/60 hover:border-[rgba(255,255,255,0.15)] transition-colors cursor-pointer"
                    style={{ backgroundColor: `${form.color ?? "#71717a"}22` }}
                  >
                    {form.icon}
                  </button>
                  {showEmojiPicker && (
                    <div className="absolute top-14 left-0 z-20 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg shadow-xl p-2 grid grid-cols-6 gap-1 w-[200px]">
                      {EMOJI_GRID.map((emoji) => (
                        <button
                          key={emoji}
                          onClick={() => {
                            setForm((f) => ({ ...f, icon: emoji }));
                            setShowEmojiPicker(false);
                          }}
                          className="w-7 h-7 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.07)] transition-colors text-base cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Space name"
                  className="flex-1 bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-[rgba(255,255,255,0.2)] transition-colors"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && form.name.trim()) handleCreateSubmit(); }}
                />
              </div>

              {/* Description */}
              <input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Description (optional)"
                className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-[rgba(255,255,255,0.2)] transition-colors"
              />

              {/* Type dropdown */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as ChatSpace["type"] }))}
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-[rgba(255,255,255,0.2)] transition-colors"
                >
                  {SPACE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Color picker */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Color</label>
                <div className="flex items-center gap-2">
                  {COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setForm((f) => ({ ...f, color }))}
                      className={[
                        "w-6 h-6 rounded-full transition-all cursor-pointer",
                        form.color === color ? "ring-2 ring-offset-2 ring-offset-zinc-900 scale-110" : "hover:scale-110",
                      ].join(" ")}
                      style={{ backgroundColor: color } as React.CSSProperties}
                    />
                  ))}
                </div>
              </div>

              {/* System prompt */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">System Prompt (optional)</label>
                <textarea
                  value={form.systemPrompt ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                  placeholder="Custom instructions for AI in this space..."
                  rows={3}
                  className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-[rgba(255,255,255,0.2)] transition-colors resize-none"
                />
              </div>

              {/* Model / Provider overrides */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Model (optional)</label>
                  <input
                    value={form.model ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="e.g. gpt-4o"
                    className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-[rgba(255,255,255,0.2)] transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Provider (optional)</label>
                  <input
                    value={form.provider ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
                    placeholder="e.g. openai"
                    className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)]/60 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 outline-none focus:border-[rgba(255,255,255,0.2)] transition-colors"
                  />
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 rounded-lg text-sm text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] hover:bg-[rgba(255,255,255,0.04)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSubmit}
                  disabled={!form.name.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-accent hover:bg-accent/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  style={{ backgroundColor: form.color ?? "#71717a" }}
                >
                  Create Space
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
