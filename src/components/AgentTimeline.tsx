import { useState, useMemo } from "react";

/**
 * Agent Timeline — Real-time visual timeline of agent execution.
 * Shows what agents are doing, which tools they're calling,
 * sub-agent hierarchies, and decision points.
 *
 * Built because developers asked for:
 * "clear visual timeline of what all these sub-agents are actually doing"
 * "real-time insight into exactly what they were doing"
 */

export interface TimelineEvent {
  id: string;
  agentId: string;
  agentName: string;
  parentAgentId?: string;
  type: "start" | "think" | "tool_call" | "tool_result" | "spawn_agent" | "decision" | "error" | "complete";
  content: string;
  timestamp: number;
  durationMs?: number;
  metadata?: {
    toolName?: string;
    toolInput?: string;
    success?: boolean;
    costUsd?: number;
    tokenCount?: number;
    childAgentId?: string;
  };
}

interface AgentNode {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  children: AgentNode[];
  events: TimelineEvent[];
  startedAt: number;
  completedAt?: number;
  totalCost: number;
  totalTokens: number;
}

const EVENT_ICONS: Record<TimelineEvent["type"], string> = {
  start: "🚀",
  think: "💭",
  tool_call: "🔧",
  tool_result: "📋",
  spawn_agent: "🤖",
  decision: "🔀",
  error: "❌",
  complete: "✅",
};

const EVENT_COLORS: Record<TimelineEvent["type"], string> = {
  start: "border-emerald-500",
  think: "border-blade-accent",
  tool_call: "border-amber-500",
  tool_result: "border-cyan-500",
  spawn_agent: "border-violet-500",
  decision: "border-pink-500",
  error: "border-red-500",
  complete: "border-emerald-500",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildAgentTree(events: TimelineEvent[]): AgentNode[] {
  const agents = new Map<string, AgentNode>();

  for (const event of events) {
    if (!agents.has(event.agentId)) {
      agents.set(event.agentId, {
        id: event.agentId,
        name: event.agentName,
        status: "running",
        children: [],
        events: [],
        startedAt: event.timestamp,
        totalCost: 0,
        totalTokens: 0,
      });
    }

    const agent = agents.get(event.agentId)!;
    agent.events.push(event);

    if (event.type === "complete") {
      agent.status = "completed";
      agent.completedAt = event.timestamp;
    }
    if (event.type === "error") {
      agent.status = "error";
      agent.completedAt = event.timestamp;
    }
    if (event.metadata?.costUsd) {
      agent.totalCost += event.metadata.costUsd;
    }
    if (event.metadata?.tokenCount) {
      agent.totalTokens += event.metadata.tokenCount;
    }

    // Link parent-child
    if (event.type === "spawn_agent" && event.metadata?.childAgentId) {
      const childId = event.metadata.childAgentId;
      if (agents.has(childId)) {
        agent.children.push(agents.get(childId)!);
      }
    }
  }

  // Return root agents (no parent)
  const childIds = new Set<string>();
  for (const event of events) {
    if (event.type === "spawn_agent" && event.metadata?.childAgentId) {
      childIds.add(event.metadata.childAgentId);
    }
  }

  return Array.from(agents.values()).filter((a) => !childIds.has(a.id));
}

function AgentTreeNode({ node, depth = 0 }: { node: AgentNode; depth?: number }) {
  const [expanded, setExpanded] = useState(true);

  const statusColors = {
    running: "bg-blade-accent animate-pulse",
    completed: "bg-emerald-500",
    error: "bg-red-500",
  };

  const duration = node.completedAt
    ? formatDuration(node.completedAt - node.startedAt)
    : "running...";

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 py-1 text-xs hover:bg-blade-surface-hover rounded px-2 w-full text-left transition-colors"
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${statusColors[node.status]}`} />
        <span className="font-medium text-blade-text">{node.name}</span>
        <span className="text-2xs text-blade-muted">{duration}</span>
        {node.totalCost > 0 && (
          <span className="text-2xs text-blade-muted/50">${node.totalCost.toFixed(4)}</span>
        )}
        <span className="text-2xs text-blade-muted/30 ml-auto">
          {node.events.length} events
        </span>
        {node.children.length > 0 && (
          <svg
            viewBox="0 0 24 24"
            className={`w-3 h-3 text-blade-muted transition-transform ${expanded ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {expanded && node.children.map((child) => (
        <AgentTreeNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function TimelineEventRow({ event, showAgent }: { event: TimelineEvent; showAgent?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex items-start gap-2 group">
      {/* Timeline connector */}
      <div className="flex flex-col items-center shrink-0 pt-1">
        <div className={`w-2 h-2 rounded-full border-2 bg-blade-bg ${EVENT_COLORS[event.type]}`} />
        <div className="w-px h-full bg-blade-border/30 min-h-[8px]" />
      </div>

      {/* Content */}
      <div
        className="flex-1 min-w-0 pb-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-baseline gap-2">
          <span className="text-xs shrink-0">{EVENT_ICONS[event.type]}</span>
          {showAgent && (
            <span className="text-2xs text-blade-accent font-mono shrink-0">[{event.agentName}]</span>
          )}
          <span className="text-xs text-blade-secondary truncate">{event.content}</span>
          <span className="text-2xs text-blade-muted/30 shrink-0 ml-auto">{formatTime(event.timestamp)}</span>
        </div>

        {event.durationMs != null && (
          <span className="text-2xs text-blade-muted/40 ml-5">{formatDuration(event.durationMs)}</span>
        )}

        {event.metadata?.toolName && (
          <div className="ml-5 mt-0.5 flex items-center gap-1.5">
            <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-mono">
              {event.metadata.toolName}
            </span>
            {event.metadata.success !== undefined && (
              <span className={`text-2xs ${event.metadata.success ? "text-emerald-400" : "text-red-400"}`}>
                {event.metadata.success ? "✓" : "✗"}
              </span>
            )}
          </div>
        )}

        {expanded && event.metadata?.toolInput && (
          <pre className="ml-5 mt-1 text-2xs text-blade-muted bg-blade-bg/50 rounded p-2 overflow-x-auto font-mono">
            {event.metadata.toolInput}
          </pre>
        )}
      </div>
    </div>
  );
}

interface Props {
  events: TimelineEvent[];
  title?: string;
}

export function AgentTimeline({ events, title }: Props) {
  const [view, setView] = useState<"timeline" | "tree">("timeline");
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => a.timestamp - b.timestamp),
    [events],
  );

  const filteredEvents = useMemo(
    () => agentFilter ? sortedEvents.filter((e) => e.agentId === agentFilter) : sortedEvents,
    [sortedEvents, agentFilter],
  );

  const agentTree = useMemo(() => buildAgentTree(sortedEvents), [sortedEvents]);

  const uniqueAgents = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (!seen.has(e.agentId)) seen.set(e.agentId, e.agentName);
    }
    return Array.from(seen.entries());
  }, [events]);

  const totalCost = events.reduce((sum, e) => sum + (e.metadata?.costUsd || 0), 0);
  const totalTokens = events.reduce((sum, e) => sum + (e.metadata?.tokenCount || 0), 0);
  const totalDuration = events.length >= 2
    ? events[events.length - 1].timestamp - events[0].timestamp
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-blade-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <h3 className="text-xs font-semibold">{title || "Agent Timeline"}</h3>
          <div className="flex items-center gap-2 text-2xs text-blade-muted/50">
            <span>{events.length} events</span>
            <span>•</span>
            <span>{uniqueAgents.length} agents</span>
            {totalDuration > 0 && (
              <>
                <span>•</span>
                <span>{formatDuration(totalDuration)}</span>
              </>
            )}
            {totalCost > 0 && (
              <>
                <span>•</span>
                <span>${totalCost.toFixed(4)}</span>
              </>
            )}
            {totalTokens > 0 && (
              <>
                <span>•</span>
                <span>{totalTokens.toLocaleString()} tokens</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {(["timeline", "tree"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-0.5 rounded text-2xs transition-colors ${
                view === v ? "bg-blade-accent-muted text-blade-text" : "text-blade-muted hover:text-blade-secondary"
              }`}
            >
              {v === "timeline" ? "Timeline" : "Tree"}
            </button>
          ))}
        </div>
      </div>

      {/* Agent filter */}
      {uniqueAgents.length > 1 && view === "timeline" && (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-blade-border/30 overflow-x-auto">
          <button
            onClick={() => setAgentFilter(null)}
            className={`px-2 py-0.5 rounded text-2xs shrink-0 transition-colors ${
              !agentFilter ? "bg-blade-accent-muted text-blade-text" : "text-blade-muted hover:text-blade-secondary"
            }`}
          >
            All
          </button>
          {uniqueAgents.map(([id, name]) => (
            <button
              key={id}
              onClick={() => setAgentFilter(id)}
              className={`px-2 py-0.5 rounded text-2xs shrink-0 transition-colors ${
                agentFilter === id ? "bg-blade-accent-muted text-blade-text" : "text-blade-muted hover:text-blade-secondary"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-blade-muted/40">
            <span className="text-2xl mb-2">⏳</span>
            <p className="text-xs">Waiting for agent events...</p>
          </div>
        ) : view === "timeline" ? (
          <div>
            {filteredEvents.map((event) => (
              <TimelineEventRow
                key={event.id}
                event={event}
                showAgent={!agentFilter && uniqueAgents.length > 1}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {agentTree.map((node) => (
              <AgentTreeNode key={node.id} node={node} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
