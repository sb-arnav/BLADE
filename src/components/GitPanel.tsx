import { useMemo, useState } from "react";
import { useGit, GitCommit, GitDiff } from "../hooks/useGit";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
  repoPath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tab = "status" | "log" | "diff" | "branches";

const TAB_LABELS: Record<Tab, string> = {
  status: "Status",
  log: "Log",
  diff: "Diff",
  branches: "Branches",
};

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function statusColor(status: string): string {
  switch (status) {
    case "added":     return "text-green-400";
    case "modified":  return "text-yellow-400";
    case "deleted":   return "text-red-400";
    case "renamed":   return "text-blue-400";
    case "untracked": return "text-blade-muted";
    default:          return "text-blade-secondary";
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case "added":     return "+";
    case "modified":  return "~";
    case "deleted":   return "-";
    case "renamed":   return "R";
    case "untracked": return "?";
    default:          return " ";
  }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabBar({ active, onChange, counts }: {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: Record<Tab, number>;
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-blade-border/30">
      {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`px-2.5 py-1 rounded text-2xs font-medium transition-colors ${
            active === tab
              ? "bg-blade-accent-muted text-blade-accent"
              : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
          }`}
        >
          {TAB_LABELS[tab]}
          {counts[tab] > 0 && (
            <span className="ml-1 text-[0.6rem] opacity-60">({counts[tab]})</span>
          )}
        </button>
      ))}
    </div>
  );
}

function FileStatusRow({ path, status, action, actionLabel }: {
  path: string;
  status: string;
  action: () => void;
  actionLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-0.5 group hover:bg-blade-surface-hover rounded text-xs">
      <span className={`font-mono text-2xs w-4 text-center shrink-0 ${statusColor(status)}`}>
        {statusIcon(status)}
      </span>
      <span className="truncate flex-1 text-blade-secondary font-mono text-2xs">
        {path}
      </span>
      <button
        onClick={action}
        className="opacity-0 group-hover:opacity-100 text-2xs text-blade-muted hover:text-blade-accent transition-all px-1.5 py-0.5 rounded hover:bg-blade-surface"
      >
        {actionLabel}
      </button>
    </div>
  );
}

function CommitSection({ onCommit, onAiSuggest, stagedCount, loading }: {
  onCommit: (msg: string) => void;
  onAiSuggest: () => void;
  stagedCount: number;
  loading: boolean;
}) {
  const [message, setMessage] = useState("");

  const handleCommit = () => {
    if (!message.trim() || stagedCount === 0) return;
    onCommit(message.trim());
    setMessage("");
  };

  return (
    <div className="px-3 py-2 border-t border-blade-border/30 space-y-1.5">
      <div className="flex items-center gap-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={stagedCount === 0 ? "Stage files to commit..." : "Commit message..."}
          rows={2}
          disabled={stagedCount === 0}
          className="flex-1 bg-blade-surface border border-blade-border/40 rounded-md px-2 py-1.5 text-xs text-blade-text placeholder:text-blade-muted/40 resize-none focus:outline-none focus:border-blade-accent/50 disabled:opacity-40"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleCommit();
            }
          }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          onClick={onAiSuggest}
          disabled={stagedCount === 0 || loading}
          className="px-2 py-1 rounded text-2xs font-medium text-blade-accent bg-blade-accent-muted hover:bg-blade-accent/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          AI Suggest
        </button>
        <button
          onClick={handleCommit}
          disabled={!message.trim() || stagedCount === 0 || loading}
          className="px-2.5 py-1 rounded text-2xs font-medium bg-blade-accent text-black hover:bg-blade-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Commit ({stagedCount})
        </button>
        <span className="ml-auto text-[0.6rem] text-blade-muted/40">
          Ctrl+Enter to commit
        </span>
      </div>
    </div>
  );
}

function StatusTab({ git, onSendToChat }: {
  git: ReturnType<typeof useGit>;
  onSendToChat: (text: string) => void;
}) {
  const { status } = git;
  if (!status) return <LoadingDot />;

  const handleAiSuggest = async () => {
    const prompt = await git.aiCommitMessage();
    onSendToChat(prompt);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-1 py-2 space-y-3">
        {/* Staged */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-2xs font-medium text-green-400/80">
              Staged ({status.staged.length})
            </span>
            {status.staged.length > 0 && (
              <button
                onClick={() => git.unstageAll()}
                className="text-[0.6rem] text-blade-muted hover:text-blade-secondary transition-colors"
              >
                Unstage All
              </button>
            )}
          </div>
          {status.staged.length === 0 ? (
            <div className="px-2 text-2xs text-blade-muted/30 italic">No staged files</div>
          ) : (
            status.staged.map((f) => (
              <FileStatusRow
                key={`staged-${f.path}`}
                path={f.path}
                status={f.status}
                action={() => git.unstage([f.path])}
                actionLabel="unstage"
              />
            ))
          )}
        </div>

        {/* Unstaged */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-2xs font-medium text-yellow-400/80">
              Changes ({status.unstaged.length})
            </span>
            {status.unstaged.length > 0 && (
              <button
                onClick={() => git.stageAll()}
                className="text-[0.6rem] text-blade-muted hover:text-blade-secondary transition-colors"
              >
                Stage All
              </button>
            )}
          </div>
          {status.unstaged.length === 0 ? (
            <div className="px-2 text-2xs text-blade-muted/30 italic">Working tree clean</div>
          ) : (
            status.unstaged.map((f) => (
              <FileStatusRow
                key={`unstaged-${f.path}`}
                path={f.path}
                status={f.status}
                action={() => git.stage([f.path])}
                actionLabel="stage"
              />
            ))
          )}
        </div>

        {/* Stash indicator */}
        {status.stashes > 0 && (
          <div className="px-2 flex items-center gap-2">
            <span className="text-2xs text-violet-400/80">
              {status.stashes} stash{status.stashes > 1 ? "es" : ""}
            </span>
            <button
              onClick={() => git.unstash()}
              className="text-[0.6rem] text-blade-muted hover:text-violet-400 transition-colors"
            >
              pop
            </button>
            <button
              onClick={() => git.stash()}
              className="text-[0.6rem] text-blade-muted hover:text-violet-400 transition-colors"
            >
              + stash
            </button>
          </div>
        )}
      </div>

      {/* Commit bar */}
      <CommitSection
        onCommit={(msg) => git.commit(msg)}
        onAiSuggest={handleAiSuggest}
        stagedCount={status.staged.length}
        loading={git.loading}
      />

      {/* Push / Pull */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-blade-border/20">
        <button
          onClick={() => git.push()}
          disabled={git.loading}
          className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-blade-secondary hover:bg-blade-surface-hover transition-colors disabled:opacity-30"
        >
          <span>Push</span>
          {status.ahead > 0 && (
            <span className="text-green-400/80 font-mono">{status.ahead}</span>
          )}
        </button>
        <button
          onClick={() => git.pull()}
          disabled={git.loading}
          className="flex items-center gap-1 px-2 py-1 rounded text-2xs text-blade-secondary hover:bg-blade-surface-hover transition-colors disabled:opacity-30"
        >
          <span>Pull</span>
          {status.behind > 0 && (
            <span className="text-orange-400/80 font-mono">{status.behind}</span>
          )}
        </button>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="ml-auto text-[0.6rem] text-blade-muted/40 font-mono">
            {status.ahead > 0 && `+${status.ahead}`}
            {status.ahead > 0 && status.behind > 0 && " / "}
            {status.behind > 0 && `-${status.behind}`}
          </span>
        )}
      </div>
    </div>
  );
}

function LogTab({ git }: { git: ReturnType<typeof useGit> }) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [commitDiff, setCommitDiff] = useState<GitDiff[]>([]);

  const handleExpand = async (commit: GitCommit) => {
    if (expandedHash === commit.hash) {
      setExpandedHash(null);
      setCommitDiff([]);
      return;
    }
    setExpandedHash(commit.hash);
    try {
      const d = await git.getCommitDiff(commit.hash);
      setCommitDiff(d);
    } catch {
      setCommitDiff([]);
    }
  };

  return (
    <div className="overflow-y-auto px-1 py-2">
      {git.log.length === 0 ? (
        <div className="text-center py-8 text-2xs text-blade-muted/40">No commits</div>
      ) : (
        git.log.map((c) => (
          <div key={c.hash}>
            <button
              onClick={() => handleExpand(c)}
              className={`w-full text-left px-2 py-1.5 rounded transition-colors hover:bg-blade-surface-hover ${
                expandedHash === c.hash ? "bg-blade-surface-hover" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-2xs text-blade-accent shrink-0">{c.shortHash}</span>
                <span className="text-xs text-blade-secondary truncate flex-1">{c.message}</span>
                <span className="text-[0.6rem] text-blade-muted/40 shrink-0">{relativeTime(c.date)}</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[0.6rem] text-blade-muted/50">{c.author}</span>
                {c.filesChanged > 0 && (
                  <span className="text-[0.6rem] text-blade-muted/30">{c.filesChanged} files</span>
                )}
              </div>
            </button>
            {expandedHash === c.hash && commitDiff.length > 0 && (
              <div className="mx-2 mb-2 border border-blade-border/20 rounded-md overflow-hidden">
                <DiffFileList diffs={commitDiff} compact />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return (
      <div className="bg-green-500/8 text-green-400/90 font-mono text-[0.65rem] leading-relaxed px-2 whitespace-pre overflow-x-auto">
        {line}
      </div>
    );
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return (
      <div className="bg-red-500/8 text-red-400/90 font-mono text-[0.65rem] leading-relaxed px-2 whitespace-pre overflow-x-auto">
        {line}
      </div>
    );
  }
  return (
    <div className="text-blade-muted/60 font-mono text-[0.65rem] leading-relaxed px-2 whitespace-pre overflow-x-auto">
      {line}
    </div>
  );
}

function DiffFileList({ diffs, compact }: { diffs: GitDiff[]; compact?: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div className="space-y-0.5">
      {diffs.map((d) => (
        <div key={d.path}>
          <button
            onClick={() => toggle(d.path)}
            className="w-full text-left flex items-center gap-2 px-2 py-1 hover:bg-blade-surface-hover rounded transition-colors"
          >
            <span className={`text-[0.6rem] ${expanded.has(d.path) ? "rotate-90" : ""} transition-transform text-blade-muted`}>
              {"\u25B6"}
            </span>
            <span className={`font-mono truncate flex-1 ${compact ? "text-[0.65rem]" : "text-2xs"} text-blade-secondary`}>
              {d.path}
            </span>
            <span className="text-[0.6rem] shrink-0">
              <span className="text-green-400/70">+{d.additions}</span>
              <span className="text-blade-muted/30 mx-0.5">/</span>
              <span className="text-red-400/70">-{d.deletions}</span>
            </span>
          </button>
          {expanded.has(d.path) && (
            <div className="ml-4 mr-1 mb-1 border-l-2 border-blade-border/20 overflow-hidden rounded-r">
              {d.hunks.map((hunk, hi) => (
                <div key={hi}>
                  <div className="text-[0.6rem] text-blade-accent/60 bg-blade-accent-muted/30 px-2 py-0.5 font-mono">
                    @@ {hunk.header} @@
                  </div>
                  {hunk.lines.map((line, li) => (
                    <DiffLine key={li} line={line} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DiffTab({ git, onSendToChat }: {
  git: ReturnType<typeof useGit>;
  onSendToChat: (text: string) => void;
}) {
  const handleAiReview = async () => {
    const prompt = await git.aiReviewDiff();
    onSendToChat(prompt);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-blade-border/20">
        <span className="text-2xs text-blade-muted">
          {git.diff.length} file{git.diff.length !== 1 ? "s" : ""} changed
        </span>
        <button
          onClick={handleAiReview}
          disabled={git.diff.length === 0}
          className="px-2 py-0.5 rounded text-2xs font-medium text-blade-accent bg-blade-accent-muted hover:bg-blade-accent/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          AI Review
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {git.diff.length === 0 ? (
          <div className="text-center py-8 text-2xs text-blade-muted/40">No unstaged changes</div>
        ) : (
          <DiffFileList diffs={git.diff} />
        )}
      </div>
    </div>
  );
}

function BranchesTab({ git }: { git: ReturnType<typeof useGit> }) {
  const [newBranch, setNewBranch] = useState("");

  const handleCreate = () => {
    if (!newBranch.trim()) return;
    git.createBranch(newBranch.trim());
    setNewBranch("");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Create branch */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-blade-border/20">
        <input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="New branch name..."
          className="flex-1 bg-blade-surface border border-blade-border/40 rounded px-2 py-1 text-2xs text-blade-text placeholder:text-blade-muted/40 focus:outline-none focus:border-blade-accent/50"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreate();
          }}
        />
        <button
          onClick={handleCreate}
          disabled={!newBranch.trim()}
          className="px-2 py-1 rounded text-2xs font-medium bg-blade-accent text-black hover:bg-blade-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Create
        </button>
      </div>

      {/* Branch list */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {git.branches.map((b) => (
          <div
            key={b.name}
            className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
              b.current ? "bg-blade-accent-muted/40" : "hover:bg-blade-surface-hover"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${b.current ? "bg-blade-accent" : "bg-blade-border/40"}`} />
            <span className={`font-mono text-2xs truncate flex-1 ${b.current ? "text-blade-accent font-medium" : "text-blade-secondary"}`}>
              {b.name}
            </span>
            <span className="text-[0.6rem] text-blade-muted/40 truncate max-w-[120px]">
              {b.lastCommit}
            </span>
            {!b.current && (
              <button
                onClick={() => git.checkout(b.name)}
                className="text-[0.6rem] text-blade-muted hover:text-blade-accent transition-colors px-1.5 py-0.5 rounded hover:bg-blade-surface"
              >
                checkout
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingDot() {
  return (
    <div className="flex items-center justify-center h-20">
      <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GitPanel({ onBack, onSendToChat, repoPath }: Props) {
  const git = useGit(repoPath);
  const [tab, setTab] = useState<Tab>("status");

  const tabCounts = useMemo<Record<Tab, number>>(() => ({
    status: (git.status?.staged.length || 0) + (git.status?.unstaged.length || 0),
    log: git.log.length,
    diff: git.diff.length,
    branches: git.branches.length,
  }), [git.status, git.log, git.diff, git.branches]);

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-blade-border/50 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-secondary text-xs transition-colors shrink-0"
          >
            &larr; back
          </button>
          <span className="text-xs text-blade-secondary font-medium shrink-0">Git</span>
          {git.status && (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="font-mono text-2xs text-blade-accent truncate">{git.status.branch}</span>
              {git.status.ahead > 0 && (
                <span className="text-[0.6rem] text-green-400/70 font-mono shrink-0">+{git.status.ahead}</span>
              )}
              {git.status.behind > 0 && (
                <span className="text-[0.6rem] text-orange-400/70 font-mono shrink-0">-{git.status.behind}</span>
              )}
              {git.status.stashes > 0 && (
                <span className="text-[0.6rem] text-violet-400/60 shrink-0" title={`${git.status.stashes} stash(es)`}>
                  S:{git.status.stashes}
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => git.refresh()}
          disabled={git.loading}
          className="w-7 h-7 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors text-xs disabled:opacity-30"
          title="Refresh"
        >
          {git.loading ? (
            <span className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
          ) : (
            "\u21BB"
          )}
        </button>
      </div>

      {/* Error banner */}
      {git.error && (
        <div className="px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 text-2xs text-red-400">
          {git.error}
        </div>
      )}

      {/* Tabs */}
      <TabBar active={tab} onChange={setTab} counts={tabCounts} />

      {/* Tab content */}
      <div className="flex-1 min-h-0">
        {tab === "status" && <StatusTab git={git} onSendToChat={onSendToChat} />}
        {tab === "log" && <LogTab git={git} />}
        {tab === "diff" && <DiffTab git={git} onSendToChat={onSendToChat} />}
        {tab === "branches" && <BranchesTab git={git} />}
      </div>
    </div>
  );
}
