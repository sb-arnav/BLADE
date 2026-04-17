import { useState, useMemo, useRef, useEffect } from "react";
import { Message } from "../types";
import {
  useConversationBranching,
  BranchComparison,
  BranchTreeNode,
} from "../hooks/useConversationBranching";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  conversationId: string;
  onBranchSwitch: (messages: Message[]) => void;
  open: boolean;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function BranchNode({
  node,
  activeBranchId,
  onSwitch,
  onRename,
  onDelete,
  onMerge,
  onCompareSelect,
  compareMode,
  compareSelected,
}: {
  node: BranchTreeNode;
  activeBranchId: string;
  onSwitch: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onMerge: (id: string) => void;
  onCompareSelect: (id: string) => void;
  compareMode: boolean;
  compareSelected: string[];
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.branch.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isActive = node.branch.id === activeBranchId;
  const isMain = node.branch.id === "main";
  const isCompareSelected = compareSelected.includes(node.branch.id);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const handleDoubleClick = () => {
    if (isMain) return;
    setEditName(node.branch.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (editName.trim() && editName.trim() !== node.branch.name) {
      onRename(node.branch.id, editName.trim());
    }
    setEditing(false);
  };

  return (
    <div style={{ paddingLeft: `${node.depth * 20}px` }}>
      {/* Connector line */}
      {node.depth > 0 && (
        <div className="flex items-center gap-1 ml-1 mb-px">
          <div className="w-3 border-t border-l border-blade-border/40 h-3 rounded-bl" />
        </div>
      )}

      {/* Branch card */}
      <div
        className={`group relative flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all text-xs border ${
          isActive
            ? "bg-blade-accent-muted border-blade-accent/30 text-blade-accent"
            : isCompareSelected
              ? "bg-violet-500/10 border-violet-500/30 text-violet-400"
              : "border-transparent hover:bg-blade-surface-hover text-blade-secondary"
        }`}
        onClick={() => {
          if (compareMode) {
            onCompareSelect(node.branch.id);
          } else {
            onSwitch(node.branch.id);
          }
        }}
        onDoubleClick={handleDoubleClick}
      >
        {/* Branch icon */}
        <div className={`shrink-0 w-5 h-5 rounded flex items-center justify-center text-[0.6rem] font-bold ${
          isMain
            ? "bg-blade-accent-muted text-blade-accent"
            : isActive
              ? "bg-blade-accent/20 text-blade-accent"
              : "bg-blade-surface text-blade-muted"
        }`}>
          {isMain ? "M" : "\u2387"}
        </div>

        {/* Name / edit field */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              ref={inputRef}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              className="w-full bg-blade-bg border border-blade-border rounded px-1.5 py-0.5 text-xs text-blade-primary outline-none focus:border-blade-accent"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="font-medium truncate">{node.branch.name}</span>
              {isActive && (
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
              )}
            </div>
          )}
          <div className="flex items-center gap-2 mt-0.5 text-2xs text-blade-muted/70">
            <span>{node.branch.messages.length} msgs</span>
            <span>\u00b7</span>
            <span>{relativeTime(node.branch.createdAt)}</span>
            {node.branch.branchPoint > 0 && (
              <>
                <span>\u00b7</span>
                <span>from #{node.branch.branchPoint}</span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        {!compareMode && !editing && (
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {!isMain && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMerge(node.branch.id);
                }}
                title="Merge into main"
                className="p-1 rounded text-2xs text-blade-muted hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
              >
                \u2934
              </button>
            )}
            {!isMain && !confirmDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
                title="Delete branch"
                className="p-1 rounded text-2xs text-blade-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                \u2715
              </button>
            )}
            {confirmDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(node.branch.id);
                  setConfirmDelete(false);
                }}
                className="px-1.5 py-0.5 rounded text-2xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
              >
                confirm
              </button>
            )}
          </div>
        )}
      </div>

      {/* Children */}
      {node.children.map((child) => (
        <BranchNode
          key={child.branch.id}
          node={child}
          activeBranchId={activeBranchId}
          onSwitch={onSwitch}
          onRename={onRename}
          onDelete={onDelete}
          onMerge={onMerge}
          onCompareSelect={onCompareSelect}
          compareMode={compareMode}
          compareSelected={compareSelected}
        />
      ))}
    </div>
  );
}

function CompareView({ comparison, onClose }: { comparison: BranchComparison; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-blade-border/30">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-blade-accent font-medium">{comparison.branchA.name}</span>
          <span className="text-blade-muted">vs</span>
          <span className="text-violet-400 font-medium">{comparison.branchB.name}</span>
        </div>
        <button
          onClick={onClose}
          className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors"
        >
          exit compare
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 px-3 py-2 border-b border-blade-border/20 text-2xs text-blade-muted">
        <span>{comparison.shared.length} shared</span>
        <span>\u00b7</span>
        <span className="text-blade-accent">{comparison.onlyA.length} only in {comparison.branchA.name}</span>
        <span>\u00b7</span>
        <span className="text-violet-400">{comparison.onlyB.length} only in {comparison.branchB.name}</span>
      </div>

      {/* Side-by-side diff */}
      <div className="flex-1 overflow-auto">
        {/* Shared messages */}
        {comparison.shared.length > 0 && (
          <div className="px-3 py-2">
            <div className="text-2xs uppercase tracking-wider text-blade-muted/60 mb-1">
              Shared messages ({comparison.shared.length})
            </div>
            {comparison.shared.map((msg) => (
              <div key={msg.id} className="flex items-start gap-2 py-1 text-xs text-blade-muted/70">
                <span className="shrink-0 text-2xs font-mono w-4 text-right opacity-50">
                  {msg.role === "user" ? "U" : "A"}
                </span>
                <span className="truncate">{truncate(msg.content, 80)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Divergent messages */}
        <div className="grid grid-cols-2 gap-px bg-blade-border/20">
          {/* Branch A unique */}
          <div className="bg-blade-bg px-3 py-2">
            <div className="text-2xs uppercase tracking-wider text-blade-accent/60 mb-1.5">
              {comparison.branchA.name}
            </div>
            {comparison.onlyA.length === 0 ? (
              <div className="text-2xs text-blade-muted/40 italic">No unique messages</div>
            ) : (
              comparison.onlyA.map((msg) => (
                <div
                  key={msg.id}
                  className={`py-1.5 px-2 mb-1 rounded text-xs border-l-2 ${
                    msg.role === "user"
                      ? "border-blade-accent/40 bg-blade-accent-muted/30"
                      : "border-blade-border/40 bg-blade-surface/30"
                  }`}
                >
                  <div className="text-2xs text-blade-muted/50 mb-0.5">
                    {msg.role === "user" ? "You" : "AI"}
                  </div>
                  <div className="text-blade-secondary leading-relaxed">
                    {truncate(msg.content, 200)}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Branch B unique */}
          <div className="bg-blade-bg px-3 py-2">
            <div className="text-2xs uppercase tracking-wider text-violet-400/60 mb-1.5">
              {comparison.branchB.name}
            </div>
            {comparison.onlyB.length === 0 ? (
              <div className="text-2xs text-blade-muted/40 italic">No unique messages</div>
            ) : (
              comparison.onlyB.map((msg) => (
                <div
                  key={msg.id}
                  className={`py-1.5 px-2 mb-1 rounded text-xs border-l-2 ${
                    msg.role === "user"
                      ? "border-violet-500/40 bg-violet-500/10"
                      : "border-blade-border/40 bg-blade-surface/30"
                  }`}
                >
                  <div className="text-2xs text-blade-muted/50 mb-0.5">
                    {msg.role === "user" ? "You" : "AI"}
                  </div>
                  <div className="text-blade-secondary leading-relaxed">
                    {truncate(msg.content, 200)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function BranchNavigator({ conversationId, onBranchSwitch, open, onClose }: Props) {
  const {
    branches,
    activeBranch,
    createBranch,
    switchBranch,
    deleteBranch,
    mergeBranch,
    renameBranch,
    compareBranches,
    getBranchTree,
  } = useConversationBranching(conversationId);

  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchFrom, setNewBranchFrom] = useState(0);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [compareSelected, setCompareSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<BranchComparison | null>(null);

  const treeNodes = useMemo(() => getBranchTree(), [getBranchTree]);
  const maxMessageIndex = activeBranch ? Math.max(0, activeBranch.messages.length - 1) : 0;

  // Reset compare state when closing
  useEffect(() => {
    if (!open) {
      setCompareMode(false);
      setComparison(null);
      setCompareSelected([]);
      setShowCreateForm(false);
    }
  }, [open]);

  const handleSwitch = (branchId: string) => {
    switchBranch(branchId);
    const target = branches.find((b) => b.id === branchId);
    if (target) {
      onBranchSwitch(target.messages as Message[]);
    }
  };

  const handleCreate = () => {
    if (!newBranchName.trim()) return;
    const branch = createBranch(newBranchName, newBranchFrom);
    onBranchSwitch(branch.messages as Message[]);
    setNewBranchName("");
    setNewBranchFrom(0);
    setShowCreateForm(false);
  };

  const handleMerge = (branchId: string) => {
    mergeBranch(branchId);
    const main = branches.find((b) => b.id === "main");
    if (main) onBranchSwitch(main.messages as Message[]);
  };

  const handleCompareSelect = (branchId: string) => {
    setCompareSelected((prev) => {
      if (prev.includes(branchId)) return prev.filter((id) => id !== branchId);
      if (prev.length >= 2) return [prev[1], branchId];
      return [...prev, branchId];
    });
  };

  // Trigger comparison when two branches selected
  useEffect(() => {
    if (compareMode && compareSelected.length === 2) {
      const result = compareBranches(compareSelected[0], compareSelected[1]);
      setComparison(result);
    } else {
      setComparison(null);
    }
  }, [compareMode, compareSelected, compareBranches]);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-96 z-50 flex flex-col bg-blade-bg border-l border-blade-border/40 shadow-2xl shadow-black/40 animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border/30">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-blade-accent-muted flex items-center justify-center text-blade-accent text-xs font-bold">
            {"\u2387"}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-blade-primary">Branches</h2>
            <p className="text-2xs text-blade-muted">{branches.length} branch{branches.length !== 1 ? "es" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              setCompareMode(!compareMode);
              setCompareSelected([]);
              setComparison(null);
            }}
            className={`px-2 py-1 rounded text-2xs font-medium transition-colors ${
              compareMode
                ? "bg-violet-500/20 text-violet-400"
                : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
            }`}
          >
            compare
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Compare mode hint */}
      {compareMode && !comparison && (
        <div className="px-3 py-2 bg-violet-500/5 border-b border-violet-500/10 text-2xs text-violet-400">
          Select two branches to compare ({compareSelected.length}/2 selected)
        </div>
      )}

      {/* Comparison view */}
      {comparison ? (
        <CompareView
          comparison={comparison}
          onClose={() => {
            setCompareMode(false);
            setCompareSelected([]);
            setComparison(null);
          }}
        />
      ) : (
        <>
          {/* Branch tree */}
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {treeNodes.map((node) => (
              <BranchNode
                key={node.branch.id}
                node={node}
                activeBranchId={activeBranch?.id ?? "main"}
                onSwitch={handleSwitch}
                onRename={renameBranch}
                onDelete={deleteBranch}
                onMerge={handleMerge}
                onCompareSelect={handleCompareSelect}
                compareMode={compareMode}
                compareSelected={compareSelected}
              />
            ))}
          </div>

          {/* Create branch form */}
          {showCreateForm ? (
            <div className="px-3 py-3 border-t border-blade-border/30 space-y-2">
              <div className="text-2xs uppercase tracking-wider text-blade-muted/60">New Branch</div>
              <input
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                placeholder="Branch name..."
                className="w-full bg-blade-surface border border-blade-border rounded-md px-2.5 py-1.5 text-xs text-blade-primary placeholder:text-blade-muted/40 outline-none focus:border-blade-accent transition-colors"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setShowCreateForm(false);
                }}
                autoFocus
              />
              <div className="flex items-center gap-2">
                <label className="text-2xs text-blade-muted shrink-0">From message #</label>
                <input
                  type="number"
                  min={0}
                  max={maxMessageIndex}
                  value={newBranchFrom}
                  onChange={(e) => setNewBranchFrom(Math.max(0, Math.min(maxMessageIndex, parseInt(e.target.value) || 0)))}
                  className="w-16 bg-blade-surface border border-blade-border rounded px-2 py-1 text-xs text-blade-primary outline-none focus:border-blade-accent transition-colors"
                />
                <span className="text-2xs text-blade-muted/50">of {maxMessageIndex}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newBranchName.trim()}
                  className="flex-1 py-1.5 rounded-md text-xs font-medium bg-blade-accent text-blade-bg hover:bg-blade-accent/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  Create branch
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="px-3 py-1.5 rounded-md text-xs text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="px-3 py-2.5 border-t border-blade-border/30">
              <button
                onClick={() => {
                  setNewBranchFrom(maxMessageIndex);
                  setShowCreateForm(true);
                }}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium text-blade-accent bg-blade-accent-muted hover:bg-blade-accent/20 transition-colors"
              >
                <span className="text-sm">+</span>
                New Branch
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
