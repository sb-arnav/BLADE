import { useState, useMemo } from "react";
import {
  useProjectDashboard,
  ProjectInfo,
  ProjectSuggestion,
} from "../hooks/useProjectDashboard";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
  projectPath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(timestamp: number): string {
  if (!timestamp) return "never";
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

const FRAMEWORK_BADGES: Record<string, { color: string; icon: string }> = {
  "React":    { color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",     icon: "\u269B" },
  "Next.js":  { color: "bg-white/10 text-white border-white/20",              icon: "\u25B2" },
  "Vue":      { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", icon: "\u2714" },
  "Nuxt":     { color: "bg-green-500/15 text-green-400 border-green-500/30",  icon: "\u25C6" },
  "Angular":  { color: "bg-red-500/15 text-red-400 border-red-500/30",        icon: "A" },
  "Svelte":   { color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: "S" },
  "Vite":     { color: "bg-violet-500/15 text-violet-400 border-violet-500/30", icon: "\u26A1" },
  "Tauri":    { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30", icon: "\uD83E\uDD80" },
  "Express":  { color: "bg-gray-500/15 text-gray-400 border-gray-500/30",     icon: "E" },
  "Electron": { color: "bg-blue-500/15 text-blue-400 border-blue-500/30",     icon: "e" },
};

const SUGGESTION_TYPE_STYLES: Record<ProjectSuggestion["type"], { color: string; label: string }> = {
  fix:         { color: "bg-red-500/15 text-red-400",     label: "Fix" },
  improve:     { color: "bg-blue-500/15 text-blue-400",   label: "Improve" },
  security:    { color: "bg-orange-500/15 text-orange-400", label: "Security" },
  performance: { color: "bg-violet-500/15 text-violet-400", label: "Perf" },
  docs:        { color: "bg-emerald-500/15 text-emerald-400", label: "Docs" },
};

const PRIORITY_DOT: Record<ProjectSuggestion["priority"], string> = {
  high: "bg-red-400",
  medium: "bg-yellow-400",
  low: "bg-blade-muted/40",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex-1 min-w-[100px] bg-blade-surface border border-blade-border/30 rounded-lg px-3 py-2.5">
      <div className="text-[0.6rem] text-blade-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-lg font-semibold text-blade-text leading-tight">{value}</div>
      {sub && <div className="text-[0.6rem] text-blade-muted/60 mt-0.5">{sub}</div>}
    </div>
  );
}

function FrameworkBadge({ framework }: { framework: string }) {
  const badge = FRAMEWORK_BADGES[framework];
  if (!badge) {
    return (
      <span className="px-2 py-0.5 rounded-full text-2xs font-medium bg-blade-surface border border-blade-border/30 text-blade-secondary">
        {framework}
      </span>
    );
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-2xs font-medium border ${badge.color}`}>
      {badge.icon} {framework}
    </span>
  );
}

function GitStatusIndicator({ gitStatus }: { gitStatus: ProjectInfo["gitStatus"] }) {
  const total = gitStatus.staged + gitStatus.unstaged + gitStatus.untracked;
  if (total === 0) {
    return <span className="text-2xs text-green-400/70">Clean</span>;
  }
  return (
    <div className="flex items-center gap-2">
      {gitStatus.staged > 0 && (
        <span className="flex items-center gap-1 text-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
          <span className="text-green-400/80">{gitStatus.staged} staged</span>
        </span>
      )}
      {gitStatus.unstaged > 0 && (
        <span className="flex items-center gap-1 text-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
          <span className="text-yellow-400/80">{gitStatus.unstaged} modified</span>
        </span>
      )}
      {gitStatus.untracked > 0 && (
        <span className="flex items-center gap-1 text-2xs">
          <span className="w-1.5 h-1.5 rounded-full bg-blade-muted/50 shrink-0" />
          <span className="text-blade-muted/70">{gitStatus.untracked} untracked</span>
        </span>
      )}
    </div>
  );
}

function LastCommitRow({ commit }: { commit: ProjectInfo["lastCommit"] }) {
  if (!commit.hash) {
    return <div className="text-2xs text-blade-muted/40 italic">No commits yet</div>;
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="font-mono text-2xs text-blade-accent shrink-0">{commit.hash}</span>
      <span className="text-blade-secondary truncate flex-1">{commit.message}</span>
      <span className="text-[0.6rem] text-blade-muted/50 shrink-0">{commit.author}</span>
      <span className="text-[0.6rem] text-blade-muted/40 shrink-0">{relativeTime(commit.date)}</span>
    </div>
  );
}

function ScriptsSection({
  scripts,
  onRun,
}: {
  scripts: Record<string, string>;
  onRun: (name: string) => void;
}) {
  const entries = Object.entries(scripts);
  if (entries.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-2xs font-medium text-blade-muted uppercase tracking-wider px-1">
        Scripts
      </div>
      <div className="grid grid-cols-1 gap-0.5">
        {entries.map(([name, cmd]) => (
          <div
            key={name}
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-blade-surface-hover group transition-colors"
          >
            <span className="font-mono text-2xs text-blade-accent shrink-0">{name}</span>
            <span className="text-[0.6rem] text-blade-muted/50 truncate flex-1 font-mono">
              {cmd}
            </span>
            <button
              onClick={() => onRun(name)}
              className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-2xs font-medium bg-blade-accent text-black hover:bg-blade-accent/80 transition-all"
            >
              Run
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function SuggestionsSection({
  suggestions,
  onFix,
}: {
  suggestions: ProjectSuggestion[];
  onFix: (command: string) => void;
}) {
  if (suggestions.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-2xs font-medium text-blade-muted uppercase tracking-wider px-1">
        AI Suggestions
      </div>
      <div className="space-y-1">
        {suggestions.map((s) => {
          const style = SUGGESTION_TYPE_STYLES[s.type];
          return (
            <div
              key={s.id}
              className="bg-blade-surface border border-blade-border/20 rounded-lg px-3 py-2 group hover:border-blade-border/40 transition-colors"
            >
              <div className="flex items-start gap-2">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${PRIORITY_DOT[s.priority]}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`px-1.5 py-px rounded text-[0.6rem] font-medium ${style.color}`}>
                      {style.label}
                    </span>
                    <span className="text-xs text-blade-text font-medium truncate">{s.title}</span>
                  </div>
                  <div className="text-[0.65rem] text-blade-muted/70 leading-relaxed">
                    {s.description}
                  </div>
                </div>
                {s.command && (
                  <button
                    onClick={() => onFix(s.command!)}
                    className="opacity-0 group-hover:opacity-100 px-2 py-1 rounded text-2xs font-medium text-blade-accent bg-blade-accent-muted hover:bg-blade-accent/20 transition-all shrink-0"
                  >
                    Fix
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DependenciesSection({ deps }: { deps: ProjectInfo["depList"] }) {
  const [showAll, setShowAll] = useState(false);

  const prodDeps = useMemo(() => deps.filter((d) => !d.dev), [deps]);
  const devDeps = useMemo(() => deps.filter((d) => d.dev), [deps]);
  const displayProd = showAll ? prodDeps : prodDeps.slice(0, 8);
  const displayDev = showAll ? devDeps : devDeps.slice(0, 4);
  const hasMore = prodDeps.length > 8 || devDeps.length > 4;

  if (deps.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-2xs font-medium text-blade-muted uppercase tracking-wider">
          Dependencies
        </span>
        <span className="text-[0.6rem] text-blade-muted/40">
          {prodDeps.length} prod / {devDeps.length} dev
        </span>
      </div>
      {displayProd.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {displayProd.map((d) => (
            <span
              key={d.name}
              className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono bg-blade-surface border border-blade-border/20 text-blade-secondary"
            >
              {d.name}
              <span className="text-blade-muted/40 ml-1">{d.version}</span>
            </span>
          ))}
        </div>
      )}
      {displayDev.length > 0 && (
        <div className="flex flex-wrap gap-1 px-1">
          {displayDev.map((d) => (
            <span
              key={d.name}
              className="px-1.5 py-0.5 rounded text-[0.6rem] font-mono bg-blade-surface/50 border border-blade-border/10 text-blade-muted/60"
            >
              {d.name}
              <span className="text-blade-muted/30 ml-1">{d.version}</span>
            </span>
          ))}
        </div>
      )}
      {hasMore && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="text-[0.6rem] text-blade-accent hover:text-blade-accent/80 px-1 transition-colors"
        >
          Show all ({deps.length})
        </button>
      )}
    </div>
  );
}

function ReadmePreview({ readme }: { readme: string | null }) {
  const [expanded, setExpanded] = useState(false);

  if (!readme) return null;

  const lines = readme.split("\n");
  const preview = expanded ? lines : lines.slice(0, 20);
  const truncated = lines.length > 20 && !expanded;

  return (
    <div className="space-y-1">
      <div className="text-2xs font-medium text-blade-muted uppercase tracking-wider px-1">
        README
      </div>
      <div className="bg-blade-surface border border-blade-border/20 rounded-lg px-3 py-2 overflow-hidden">
        <pre className="text-[0.65rem] text-blade-secondary/80 leading-relaxed whitespace-pre-wrap font-mono overflow-x-auto">
          {preview.join("\n")}
        </pre>
        {truncated && (
          <button
            onClick={() => setExpanded(true)}
            className="mt-1.5 text-[0.6rem] text-blade-accent hover:text-blade-accent/80 transition-colors"
          >
            Read more ({lines.length - 20} more lines)
          </button>
        )}
        {expanded && lines.length > 20 && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-1.5 text-[0.6rem] text-blade-accent hover:text-blade-accent/80 transition-colors"
          >
            Collapse
          </button>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-48">
      <div className="flex flex-col items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
        <span className="text-2xs text-blade-muted/40">Analyzing project...</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectDashboard({ onBack, onSendToChat, projectPath }: Props) {
  const { project, suggestions, loading, error, refresh, runScript } = useProjectDashboard(projectPath);

  const totalGitChanges = project
    ? project.gitStatus.staged + project.gitStatus.unstaged + project.gitStatus.untracked
    : 0;

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-blade-border/50 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-secondary text-xs transition-colors shrink-0"
          >
            &larr; back
          </button>
          {project && (
            <>
              <span className="text-sm text-blade-text font-semibold truncate">{project.name}</span>
              <FrameworkBadge framework={project.framework} />
              <span className="font-mono text-2xs text-blade-accent/70 truncate">
                {project.gitBranch}
              </span>
            </>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="w-7 h-7 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors text-xs disabled:opacity-30"
          title="Refresh"
        >
          {loading ? (
            <span className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
          ) : (
            "\u21BB"
          )}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-red-500/10 border-b border-red-500/20 text-2xs text-red-400">
          {error}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {loading && !project ? (
          <LoadingState />
        ) : project ? (
          <>
            {/* Description */}
            {project.description && (
              <div className="text-xs text-blade-muted/70">{project.description}</div>
            )}

            {/* Stats row */}
            <div className="flex gap-2 flex-wrap">
              <StatCard
                label="Files"
                value={project.fileCount.toLocaleString()}
                sub={project.language}
              />
              <StatCard
                label="Lines"
                value={project.totalLines > 1000
                  ? `${(project.totalLines / 1000).toFixed(1)}k`
                  : project.totalLines.toLocaleString()}
                sub="estimated"
              />
              <StatCard
                label="Deps"
                value={project.dependencies + project.devDependencies}
                sub={`${project.dependencies} prod / ${project.devDependencies} dev`}
              />
              <StatCard
                label="Git"
                value={totalGitChanges}
                sub={totalGitChanges === 0 ? "clean" : "changes"}
              />
            </div>

            {/* Git status */}
            <div className="bg-blade-surface border border-blade-border/20 rounded-lg px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-medium text-blade-muted uppercase tracking-wider">
                  Git Status
                </span>
                <span className="font-mono text-2xs text-blade-accent/60">{project.gitBranch}</span>
              </div>
              <GitStatusIndicator gitStatus={project.gitStatus} />
              <div className="border-t border-blade-border/15 pt-2">
                <LastCommitRow commit={project.lastCommit} />
              </div>
            </div>

            {/* Scripts */}
            <ScriptsSection scripts={project.scripts} onRun={runScript} />

            {/* AI Suggestions */}
            <SuggestionsSection
              suggestions={suggestions}
              onFix={(cmd) => onSendToChat(cmd)}
            />

            {/* Dependencies */}
            <DependenciesSection deps={project.depList} />

            {/* README */}
            <ReadmePreview readme={project.readme} />

            {/* Footer info */}
            <div className="flex items-center gap-3 pt-2 border-t border-blade-border/15 text-[0.6rem] text-blade-muted/30">
              <span>{project.packageManager}</span>
              <span>{project.language}</span>
              <span className="truncate">{project.path}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
