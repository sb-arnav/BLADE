import { useState, useRef, useEffect, useMemo } from "react";
import {
  useAgentTeam,
  AgentTeam,
  TeamAgent,
  TeamTemplate,
  CoordinationEntry,
} from "../hooks/useAgentTeam";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ROLE_ICONS: Record<string, string> = {
  lead: "\u{1F3AF}",       // dart
  researcher: "\u{1F52C}",  // microscope
  coder: "\u{1F4BB}",       // laptop
  reviewer: "\u{1F440}",    // eyes
  writer: "\u{270D}\uFE0F", // writing hand
};

const STATUS_CONFIG: Record<string, { color: string; label: string; pulse?: boolean }> = {
  idle: { color: "bg-blade-muted/40", label: "Idle" },
  working: { color: "bg-emerald-500", label: "Working", pulse: true },
  waiting: { color: "bg-amber-500", label: "Waiting", pulse: true },
  done: { color: "bg-emerald-500", label: "Done" },
  error: { color: "bg-red-500", label: "Error" },
};

const TEAM_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  planning: { color: "text-amber-400", label: "Planning" },
  executing: { color: "text-blue-400", label: "Executing" },
  reviewing: { color: "text-purple-400", label: "Reviewing" },
  completed: { color: "text-emerald-400", label: "Completed" },
  error: { color: "text-red-400", label: "Error" },
};

// ── Utility ────────────────────────────────────────────────────────────────────

function formatElapsed(startedAt: number, completedAt?: number): string {
  const elapsed = (completedAt || Date.now()) - startedAt;
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onLaunch,
  disabled,
}: {
  template: TeamTemplate;
  onLaunch: (templateId: string, goal: string) => void;
  disabled: boolean;
}) {
  const [goal, setGoal] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handleLaunch = () => {
    if (!goal.trim() || disabled) return;
    onLaunch(template.id, goal.trim());
    setGoal("");
    setExpanded(false);
  };

  return (
    <div
      className={`bg-blade-surface border border-blade-border rounded-xl p-3 transition-all ${
        disabled ? "opacity-50 pointer-events-none" : "hover:border-blade-accent/20"
      }`}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-start gap-2.5"
      >
        <span className="text-xl mt-0.5">{template.icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-blade-text">{template.name}</p>
          <p className="text-2xs text-blade-muted mt-0.5 leading-relaxed">
            {template.description}
          </p>
          {/* Agent avatars */}
          <div className="flex items-center gap-1 mt-1.5">
            {template.agents.map((a, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-0.5 text-2xs text-blade-muted/60 bg-blade-bg rounded px-1 py-0.5"
                title={`${a.name} (${a.role})`}
              >
                {ROLE_ICONS[a.role] || "\u{1F916}"} {a.name.split(" ")[0]}
              </span>
            ))}
          </div>
        </div>
        <span className="text-2xs text-blade-muted/30 shrink-0 mt-1">
          {expanded ? "\u25B2" : "\u25BC"}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 pt-2.5 border-t border-blade-border/30 animate-fade-in">
          {/* Agent details */}
          <div className="space-y-1.5 mb-3">
            {template.agents.map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-2xs">
                <span className="shrink-0">{ROLE_ICONS[a.role] || "\u{1F916}"}</span>
                <div className="min-w-0">
                  <span className="text-blade-secondary font-medium">{a.name}</span>
                  <span className="text-blade-muted/50 ml-1">({a.role})</span>
                  <p className="text-blade-muted/60 leading-relaxed mt-0.5">
                    {truncate(a.instructions, 120)}
                  </p>
                  <div className="flex gap-1 mt-0.5">
                    {a.tools.map((t) => (
                      <span key={t} className="text-blade-muted/30 bg-blade-bg rounded px-1 py-px">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Goal input + launch */}
          <div className="flex items-center gap-1.5">
            <input
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Describe the goal for this team..."
              className="flex-1 bg-blade-bg border border-blade-border rounded-lg px-2.5 py-1.5 text-2xs text-blade-text outline-none focus:border-blade-accent/30 transition-colors"
              onKeyDown={(e) => e.key === "Enter" && handleLaunch()}
            />
            <button
              onClick={handleLaunch}
              disabled={!goal.trim()}
              className="text-2xs px-3 py-1.5 rounded-lg bg-blade-accent text-white hover:bg-blade-accent-hover disabled:opacity-30 transition-colors shrink-0 font-medium"
            >
              Launch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  isExpanded,
  onToggle,
}: {
  agent: TeamAgent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const statusCfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.idle;
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [isExpanded, agent.output]);

  return (
    <div
      className={`bg-blade-surface border rounded-xl overflow-hidden transition-all ${
        agent.status === "working"
          ? "border-emerald-500/30 shadow-sm shadow-emerald-500/5"
          : agent.status === "error"
            ? "border-red-500/30"
            : agent.status === "done"
              ? "border-emerald-500/20"
              : "border-blade-border/50"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-blade-surface-hover/50 transition-colors"
      >
        {/* Role icon */}
        <span className="text-base shrink-0 mt-px">
          {ROLE_ICONS[agent.role] || "\u{1F916}"}
        </span>

        <div className="flex-1 min-w-0">
          {/* Name + role */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-blade-text">{agent.name}</span>
            <span className="text-2xs text-blade-muted/50">({agent.role})</span>
          </div>

          {/* Task description */}
          {agent.task && (
            <p className="text-2xs text-blade-secondary mt-0.5 leading-relaxed truncate">
              {agent.task}
            </p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-2xs text-blade-muted/40">
              {agent.messageCount} msg{agent.messageCount !== 1 ? "s" : ""}
            </span>
            <span className="text-2xs text-blade-muted/40">
              {agent.tokenCount > 1000
                ? `${(agent.tokenCount / 1000).toFixed(1)}k`
                : agent.tokenCount}{" "}
              tok
            </span>
            {agent.startedAt && agent.completedAt && (
              <span className="text-2xs text-blade-muted/40">
                {formatElapsed(agent.startedAt, agent.completedAt)}
              </span>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className={`w-1.5 h-1.5 rounded-full ${statusCfg.color} ${
              statusCfg.pulse ? "animate-pulse" : ""
            }`}
          />
          <span
            className={`text-2xs ${
              agent.status === "error"
                ? "text-red-400"
                : agent.status === "done"
                  ? "text-emerald-400"
                  : agent.status === "working"
                    ? "text-emerald-400"
                    : "text-blade-muted/50"
            }`}
          >
            {statusCfg.label}
          </span>
        </div>
      </button>

      {/* Expanded output */}
      {isExpanded && (
        <div className="border-t border-blade-border/30 animate-fade-in">
          {agent.error && (
            <div className="px-3 py-1.5 bg-red-500/5 text-2xs text-red-400">
              Error: {agent.error}
            </div>
          )}
          <div
            ref={outputRef}
            className="px-3 py-2 max-h-48 overflow-y-auto bg-blade-bg/30"
          >
            {agent.output ? (
              <pre className="text-2xs text-blade-secondary whitespace-pre-wrap break-words font-mono leading-relaxed">
                {agent.output}
              </pre>
            ) : (
              <p className="text-2xs text-blade-muted/30 italic">
                {agent.status === "idle" ? "Waiting for assignment..." : "Working..."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CoordinationLog({ entries }: { entries: CoordinationEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-2xs text-blade-muted/30 italic">No coordination messages yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 max-h-44 overflow-y-auto">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 text-2xs">
          <span className="text-blade-muted/20 shrink-0 font-mono w-14 text-right">
            {new Date(entry.timestamp).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
          <span className="text-blade-accent shrink-0 font-medium">{entry.from}</span>
          <span className="text-blade-muted/30">{"\u2192"}</span>
          <span className="text-blade-secondary shrink-0 font-medium">{entry.to}</span>
          <span className="text-blade-muted/60 break-words min-w-0">
            {truncate(entry.message, 200)}
          </span>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function PlanChecklist({
  plan,
}: {
  plan: AgentTeam["plan"];
}) {
  if (plan.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-2xs text-blade-muted/30 italic">Plan will appear once the lead agent creates it</p>
      </div>
    );
  }

  const statusIcons: Record<string, string> = {
    pending: "\u25CB",  // circle
    active: "\u25D4",   // half circle
    done: "\u2713",     // check
    error: "\u2717",    // x
  };

  const statusColors: Record<string, string> = {
    pending: "text-blade-muted/40",
    active: "text-blue-400",
    done: "text-emerald-400",
    error: "text-red-400",
  };

  return (
    <div className="space-y-1">
      {plan.map((step, i) => (
        <div key={i} className="flex items-start gap-2 text-2xs">
          <span className={`shrink-0 font-mono ${statusColors[step.status]}`}>
            {statusIcons[step.status]}
          </span>
          <span className="text-blade-accent/70 shrink-0 font-medium">
            {step.assignee}
          </span>
          <span
            className={`min-w-0 break-words ${
              step.status === "done"
                ? "text-blade-muted/50 line-through"
                : step.status === "active"
                  ? "text-blade-text"
                  : "text-blade-secondary"
            }`}
          >
            {step.step}
          </span>
        </div>
      ))}
    </div>
  );
}

function TeamResultPanel({
  team,
  onSendToChat,
}: {
  team: AgentTeam;
  onSendToChat: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!team.finalOutput) return;
    try {
      await navigator.clipboard.writeText(team.finalOutput);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may fail
    }
  };

  if (!team.finalOutput) return null;

  return (
    <div className="border-t border-blade-border/50">
      <div className="px-4 py-2 flex items-center justify-between">
        <h3 className="text-2xs uppercase tracking-wider text-blade-muted/50">
          Final Output
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleCopy}
            className="text-2xs px-2 py-0.5 rounded bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            onClick={() => onSendToChat(team.finalOutput!)}
            className="text-2xs px-2.5 py-0.5 rounded bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors"
          >
            Send to Chat
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 max-h-64 overflow-y-auto">
        <pre className="text-2xs text-blade-secondary whitespace-pre-wrap break-words font-mono leading-relaxed">
          {team.finalOutput}
        </pre>
      </div>
    </div>
  );
}

function TeamHistoryItem({
  team,
  onSelect,
}: {
  team: AgentTeam;
  onSelect: () => void;
}) {
  const statusCfg = TEAM_STATUS_CONFIG[team.status] || TEAM_STATUS_CONFIG.error;

  return (
    <button
      onClick={onSelect}
      className="w-full text-left border border-blade-border/50 rounded-lg px-3 py-2 flex items-center gap-2.5 hover:bg-blade-surface-hover transition-colors"
    >
      <span className="text-sm shrink-0">{team.name.includes("Full") ? "\u{1F3D7}\uFE0F" : team.name.includes("Research") ? "\u{1F52C}" : team.name.includes("Content") ? "\u270D\uFE0F" : team.name.includes("Review") ? "\u{1F440}" : "\u{1F41B}"}</span>
      <div className="flex-1 min-w-0">
        <p className="text-2xs text-blade-secondary truncate">{team.goal}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-2xs ${statusCfg.color}`}>{statusCfg.label}</span>
          <span className="text-2xs text-blade-muted/30">
            {team.agents.length} agents
          </span>
          <span className="text-2xs text-blade-muted/30">
            {formatElapsed(team.startedAt, team.completedAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AgentTeamPanel({ onBack, onSendToChat }: Props) {
  const {
    teams,
    activeTeam,
    activeTeamId,
    createTeam,
    startTeam,
    cancelTeam,
    clearHistory,
    templates,
  } = useAgentTeam();

  const [view, setView] = useState<"templates" | "active" | "history">("templates");
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"agents" | "plan" | "log">("agents");
  const [selectedHistoryTeamId, setSelectedHistoryTeamId] = useState<string | null>(null);

  // Auto-switch to active view when a team starts
  useEffect(() => {
    if (activeTeam) {
      setView("active");
    }
  }, [activeTeam?.id]);

  // Auto-switch back to templates when team completes
  useEffect(() => {
    if (!activeTeam && view === "active" && !selectedHistoryTeamId) {
      // Stay on active if we have a history team selected
    }
  }, [activeTeam, view, selectedHistoryTeamId]);

  const handleLaunchTeam = async (templateId: string, goal: string) => {
    const team = createTeam(templateId, goal);
    if (team) {
      await startTeam(team.id);
    }
  };

  const handleCancel = () => {
    if (activeTeamId) {
      cancelTeam(activeTeamId);
    }
  };

  // The team to display in the detail view (active or selected history)
  const displayTeam = useMemo(() => {
    if (activeTeam) return activeTeam;
    if (selectedHistoryTeamId) return teams.find((t) => t.id === selectedHistoryTeamId) || null;
    return null;
  }, [activeTeam, selectedHistoryTeamId, teams]);

  const completedTeams = teams.filter(
    (t) => (t.status === "completed" || t.status === "error") && t.id !== activeTeamId,
  );

  // Elapsed time ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!activeTeam) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [activeTeam?.id]);

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-blade-border shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-secondary text-xs transition-colors"
          >
            {"\u2190"}
          </button>
          <div>
            <h1 className="text-sm font-semibold flex items-center gap-2">
              Agent Teams
              <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent/10 text-blade-accent font-normal">
                Multi-Agent
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* View toggle */}
          <div className="flex items-center bg-blade-surface rounded-md p-0.5 mr-2">
            {(
              [
                { key: "templates", label: "Teams" },
                { key: "active", label: "Live" },
                { key: "history", label: "History" },
              ] as const
            ).map((v) => (
              <button
                key={v.key}
                onClick={() => {
                  setView(v.key);
                  if (v.key !== "active") setSelectedHistoryTeamId(null);
                }}
                className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                  view === v.key
                    ? "bg-blade-accent-muted text-blade-text"
                    : "text-blade-muted hover:text-blade-secondary"
                }`}
              >
                {v.label}
                {v.key === "active" && activeTeam && (
                  <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                )}
              </button>
            ))}
          </div>

          {activeTeam && (
            <button
              onClick={handleCancel}
              className="text-2xs px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              Stop Team
            </button>
          )}
          {completedTeams.length > 0 && !activeTeam && (
            <button
              onClick={clearHistory}
              className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Template Picker View ────────────────────────────────────── */}
      {view === "templates" && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
            <p className="text-2xs text-blade-muted/50 leading-relaxed">
              Launch a team of AI agents that work together in parallel. Each agent has a
              specialized role, tools, and instructions. The lead agent plans and coordinates.
            </p>

            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onLaunch={handleLaunchTeam}
                disabled={!!activeTeamId}
              />
            ))}

            {/* Empty history hint */}
            {completedTeams.length === 0 && (
              <div className="text-center py-6">
                <p className="text-2xs text-blade-muted/30">
                  Pick a team template above, describe your goal, and launch.
                  <br />
                  Agents will plan, delegate, execute, and compile results.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Active Team / Detail View ──────────────────────────────── */}
      {(view === "active" || (view === "history" && selectedHistoryTeamId)) && displayTeam && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Team header */}
          <div className="px-4 py-2.5 bg-blade-surface/50 border-b border-blade-border/50 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-blade-text">
                    {displayTeam.name}
                  </span>
                  <span
                    className={`text-2xs font-medium ${
                      TEAM_STATUS_CONFIG[displayTeam.status]?.color || "text-blade-muted"
                    }`}
                  >
                    {TEAM_STATUS_CONFIG[displayTeam.status]?.label || displayTeam.status}
                  </span>
                </div>
                <p className="text-2xs text-blade-muted mt-0.5 truncate">
                  {displayTeam.goal}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-2xs text-blade-muted/50 font-mono">
                  {formatElapsed(displayTeam.startedAt, displayTeam.completedAt)}
                </p>
                <p className="text-2xs text-blade-muted/30">
                  {displayTeam.agents.length} agents
                </p>
              </div>
            </div>

            {/* Error banner */}
            {displayTeam.error && (
              <div className="mt-1.5 px-2 py-1 rounded bg-red-500/10 text-2xs text-red-400">
                {displayTeam.error}
              </div>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex items-center gap-0.5 px-4 pt-2 pb-1 shrink-0">
            {(
              [
                { key: "agents", label: "Agents", count: displayTeam.agents.length },
                { key: "plan", label: "Plan", count: displayTeam.plan.length },
                { key: "log", label: "Log", count: displayTeam.coordinationLog.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-2.5 py-1 rounded-lg text-2xs transition-colors ${
                  activeTab === tab.key
                    ? "bg-blade-accent-muted text-blade-text"
                    : "text-blade-muted hover:text-blade-secondary"
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1 text-blade-muted/30">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
            {activeTab === "agents" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {displayTeam.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isExpanded={expandedAgentId === agent.id}
                    onToggle={() =>
                      setExpandedAgentId(
                        expandedAgentId === agent.id ? null : agent.id,
                      )
                    }
                  />
                ))}
              </div>
            )}

            {activeTab === "plan" && (
              <PlanChecklist plan={displayTeam.plan} />
            )}

            {activeTab === "log" && (
              <CoordinationLog entries={displayTeam.coordinationLog} />
            )}
          </div>

          {/* Results panel (when completed) */}
          {displayTeam.status === "completed" && displayTeam.finalOutput && (
            <TeamResultPanel team={displayTeam} onSendToChat={onSendToChat} />
          )}
        </div>
      )}

      {/* Active view but no team running */}
      {view === "active" && !displayTeam && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xs text-blade-muted/40">No active team</p>
            <button
              onClick={() => setView("templates")}
              className="mt-2 text-2xs text-blade-accent hover:text-blade-accent-hover transition-colors"
            >
              Launch a team
            </button>
          </div>
        </div>
      )}

      {/* ── History View ────────────────────────────────────────────── */}
      {view === "history" && !selectedHistoryTeamId && (
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-4 space-y-2">
            {completedTeams.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-2xs text-blade-muted/30">
                  No completed team runs yet.
                  <br />
                  Completed teams will appear here.
                </p>
              </div>
            ) : (
              <>
                <h3 className="text-2xs uppercase tracking-wider text-blade-muted/50 mb-2">
                  Completed Teams
                </h3>
                {completedTeams
                  .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
                  .map((team) => (
                    <TeamHistoryItem
                      key={team.id}
                      team={team}
                      onSelect={() => {
                        setSelectedHistoryTeamId(team.id);
                        setActiveTab("agents");
                      }}
                    />
                  ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
