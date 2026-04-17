// src/components/AgentFactory.tsx
// BLADE Agent Factory — NosShip-inspired "describe it, deploy it" agent builder.
// User types a natural-language description → LLM parses → blueprint preview → deploy.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Inline icon helpers ───────────────────────────────────────────────────────

type IconProps = { size?: number; className?: string };
const Ic = ({ d, size = 14, className = "" }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d={d} />
  </svg>
);
const ArrowLeft  = (p: IconProps) => <Ic size={p.size} className={p.className} d="M19 12H5M5 12l7 7M5 12l7-7" />;
const Wand2      = (p: IconProps) => <Ic size={p.size} className={p.className} d="M15 4l5 5L7 22H2v-5zM12 7l5 5" />;
const Play       = (p: IconProps) => <Ic size={p.size} className={p.className} d="M5 3l14 9-14 9V3z" />;
const Pause      = (p: IconProps) => <Ic size={p.size} className={p.className} d="M6 4h4v16H6zM14 4h4v16h-4z" />;
const Trash2     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
const Zap        = (p: IconProps) => <Ic size={p.size} className={p.className} d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />;
const Bot        = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a4 4 0 014 4v1h1a2 2 0 012 2v8a2 2 0 01-2 2H7a2 2 0 01-2-2V9a2 2 0 012-2h1V6a4 4 0 014-4zM9 9v1M15 9v1M9 15h6" />;
const Globe      = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a10 10 0 100 20A10 10 0 0012 2zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />;
const Bell       = (p: IconProps) => <Ic size={p.size} className={p.className} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />;
const Terminal   = (p: IconProps) => <Ic size={p.size} className={p.className} d="M4 17l6-6-6-6M12 19h8" />;
const BookOpen   = (p: IconProps) => <Ic size={p.size} className={p.className} d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z" />;
const CheckCircle = (p: IconProps) => <Ic size={p.size} className={p.className} d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3" />;
const Loader     = (p: IconProps) => <Ic size={p.size} className={`${p.className ?? ""} animate-spin`} d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Trigger {
  type: "message" | "schedule" | "event" | "condition";
  platform?: string;
  contains?: string;
  from?: string;
  cron?: string;
  event_type?: string;
  check?: string;
}

interface Action {
  type: "reply" | "create_ticket" | "notify_user" | "run_command" | "call_api" | "custom";
  draft?: boolean;
  project?: string;
  channel?: string;
  command?: string;
  url?: string;
  method?: string;
  description?: string;
}

interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  tentacle_type: string;
  triggers: Trigger[];
  actions: Action[];
  knowledge_sources: string[];
  personality: string;
  autonomy: number;
  active: boolean;
  created_at: number;
  deployed_at: number | null;
}

interface AgentFactoryProps {
  onBack: () => void;
}

// ── Trigger / Action label helpers ────────────────────────────────────────────

function triggerLabel(t: Trigger): string {
  switch (t.type) {
    case "message":
      return [
        `${t.platform ?? "any platform"} message`,
        t.contains ? `containing "${t.contains}"` : null,
        t.from ? `from ${t.from}` : null,
      ]
        .filter(Boolean)
        .join(" ");
    case "schedule":
      return `Schedule: ${t.cron ?? "?"}`;
    case "event":
      return `Event: ${t.event_type ?? "?"}`;
    case "condition":
      return `Condition: ${t.check ?? "?"}`;
    default:
      return "Unknown trigger";
  }
}

function actionLabel(a: Action): string {
  switch (a.type) {
    case "reply":
      return a.draft ? "Draft a reply (awaits approval)" : "Auto-send reply";
    case "create_ticket":
      return `Create ticket in ${a.project ?? "project"}`;
    case "notify_user":
      return `Notify via ${a.channel ?? "channel"}`;
    case "run_command":
      return `Run: ${a.command ?? "command"}`;
    case "call_api":
      return `${a.method ?? "GET"} ${a.url ?? "url"}`;
    case "custom":
      return a.description ?? "Custom action";
    default:
      return "Unknown action";
  }
}

function tentacleIcon(type: string): string {
  const icons: Record<string, string> = {
    slack: "💬",
    discord: "🎮",
    email: "✉️",
    github: "🐙",
    custom: "⚡",
  };
  return icons[type.toLowerCase()] ?? "🤖";
}

function autonomyLabel(v: number): string {
  if (v <= 0.2) return "Ask every time";
  if (v <= 0.5) return "Mostly supervised";
  if (v <= 0.8) return "Mostly autonomous";
  return "Fully autonomous";
}

// ── BlueprintCard ─────────────────────────────────────────────────────────────

function BlueprintCard({
  blueprint,
  onDeploy,
  onPause,
  onDelete,
}: {
  blueprint: AgentBlueprint;
  onDeploy: (bp: AgentBlueprint) => void;
  onPause: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const ts = new Date(blueprint.created_at * 1000).toLocaleDateString();

  return (
    <div className="rounded-xl border border-blade-border bg-blade-surface p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">{tentacleIcon(blueprint.tentacle_type)}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-blade-text">{blueprint.name}</span>
            {blueprint.active ? (
              <span className="px-1.5 py-0.5 rounded text-2xs bg-green-500/15 text-green-400 border border-green-500/20">
                live
              </span>
            ) : (
              <span className="px-1.5 py-0.5 rounded text-2xs bg-blade-muted/20 text-blade-muted border border-blade-border">
                paused
              </span>
            )}
            <span className="text-2xs text-blade-muted">{ts}</span>
          </div>
          <p className="text-2xs text-blade-muted mt-0.5 line-clamp-2">{blueprint.description}</p>
        </div>
      </div>

      {/* Triggers */}
      {blueprint.triggers.length > 0 && (
        <div>
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-1">Triggers</div>
          <div className="flex flex-wrap gap-1">
            {blueprint.triggers.map((t, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full text-2xs bg-blade-accent-muted text-blade-accent border border-blade-accent/20">
                {triggerLabel(t)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {blueprint.actions.length > 0 && (
        <div>
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-1">Actions</div>
          <div className="flex flex-col gap-1">
            {blueprint.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 text-2xs text-blade-secondary">
                <Zap size={10} className="text-blade-accent shrink-0" />
                {actionLabel(a)}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge sources */}
      {blueprint.knowledge_sources.length > 0 && (
        <div>
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-1">Knowledge</div>
          <div className="flex flex-wrap gap-1">
            {blueprint.knowledge_sources.map((k, i) => (
              <span key={i} className="px-2 py-0.5 rounded text-2xs bg-blade-surface border border-blade-border text-blade-muted font-mono">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Autonomy bar */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-2xs text-blade-muted">Autonomy</span>
          <span className="text-2xs text-blade-secondary">{autonomyLabel(blueprint.autonomy)}</span>
        </div>
        <div className="h-1 rounded-full bg-blade-border overflow-hidden">
          <div
            className="h-full rounded-full bg-blade-accent transition-all"
            style={{ width: `${blueprint.autonomy * 100}%` }}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 pt-1">
        {!blueprint.active && (
          <button
            onClick={() => onDeploy(blueprint)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blade-accent text-black text-xs font-medium hover:opacity-90 transition-opacity"
          >
            <Play size={11} />
            Deploy
          </button>
        )}
        {blueprint.active && (
          <button
            onClick={() => onPause(blueprint.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs hover:bg-yellow-500/20 transition-colors"
          >
            <Pause size={11} />
            Pause
          </button>
        )}
        <button
          onClick={() => onDelete(blueprint.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs hover:bg-red-500/20 transition-colors ml-auto"
        >
          <Trash2 size={11} />
          Delete
        </button>
      </div>
    </div>
  );
}

// ── BlueprintPreview ──────────────────────────────────────────────────────────

function BlueprintPreview({
  blueprint,
  onDeploy,
  onDiscard,
  deploying,
}: {
  blueprint: AgentBlueprint;
  onDeploy: () => void;
  onDiscard: () => void;
  deploying: boolean;
}) {
  return (
    <div className="rounded-xl border border-blade-accent/30 bg-blade-accent-muted/10 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <CheckCircle size={14} className="text-blade-accent" />
        <span className="text-xs font-semibold text-blade-text">Blueprint ready — review before deploying</span>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
        {/* Name */}
        <div>
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-0.5">Name</div>
          <div className="font-medium text-blade-text">
            {tentacleIcon(blueprint.tentacle_type)} {blueprint.name}
          </div>
        </div>

        {/* Platform */}
        <div>
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-0.5">Platform</div>
          <div className="text-blade-secondary capitalize">{blueprint.tentacle_type}</div>
        </div>

        {/* Personality */}
        <div className="col-span-2">
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-0.5">Personality</div>
          <div className="text-blade-secondary">{blueprint.personality || "—"}</div>
        </div>

        {/* Autonomy */}
        <div className="col-span-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-2xs uppercase tracking-wider text-blade-muted">Autonomy</div>
            <span className="text-2xs text-blade-secondary">{autonomyLabel(blueprint.autonomy)} ({Math.round(blueprint.autonomy * 100)}%)</span>
          </div>
          <div className="h-1.5 rounded-full bg-blade-border overflow-hidden">
            <div
              className="h-full rounded-full bg-blade-accent transition-all"
              style={{ width: `${blueprint.autonomy * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Triggers */}
      <div>
        <div className="text-2xs uppercase tracking-wider text-blade-muted mb-2">Triggers ({blueprint.triggers.length})</div>
        {blueprint.triggers.length === 0 ? (
          <div className="text-2xs text-blade-muted italic">No triggers parsed</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {blueprint.triggers.map((t, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-blade-accent/10 border border-blade-accent/20 text-xs text-blade-accent">
                <Bell size={10} />
                {triggerLabel(t)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div>
        <div className="text-2xs uppercase tracking-wider text-blade-muted mb-2">Actions ({blueprint.actions.length})</div>
        {blueprint.actions.length === 0 ? (
          <div className="text-2xs text-blade-muted italic">No actions parsed</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {blueprint.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-blade-secondary">
                <Zap size={11} className="text-blade-accent shrink-0" />
                {actionLabel(a)}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Knowledge sources */}
      {blueprint.knowledge_sources.length > 0 && (
        <div>
          <div className="text-2xs uppercase tracking-wider text-blade-muted mb-2">Knowledge sources</div>
          <div className="flex flex-wrap gap-1">
            {blueprint.knowledge_sources.map((k, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-0.5 rounded text-2xs bg-blade-surface border border-blade-border text-blade-muted font-mono">
                <BookOpen size={9} />
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Deploy / Discard */}
      <div className="flex items-center gap-2 pt-1 border-t border-blade-border">
        <button
          onClick={onDeploy}
          disabled={deploying}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blade-accent text-black text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {deploying ? <Loader size={12} /> : <Play size={12} />}
          {deploying ? "Deploying…" : "Deploy agent"}
        </button>
        <button
          onClick={onDiscard}
          disabled={deploying}
          className="px-4 py-2 rounded-lg border border-blade-border text-xs text-blade-muted hover:text-blade-text transition-colors disabled:opacity-50"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentFactory({ onBack }: AgentFactoryProps) {
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AgentBlueprint | null>(null);
  const [agents, setAgents] = useState<AgentBlueprint[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);

  // ── Load existing agents ──────────────────────────────────────────────────

  const loadAgents = useCallback(async () => {
    try {
      const list = await invoke<AgentBlueprint[]>("factory_list_agents");
      setAgents(list);
    } catch {
      // non-fatal — empty list is fine
    } finally {
      setLoadingAgents(false);
    }
  }, []);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // ── Generate blueprint ────────────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    setPreview(null);
    try {
      const bp = await invoke<AgentBlueprint>("factory_create_agent", {
        description: description.trim(),
      });
      setPreview(bp);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setGenerating(false);
    }
  };

  // ── Deploy blueprint ──────────────────────────────────────────────────────

  const handleDeploy = async (bp: AgentBlueprint = preview!) => {
    if (!bp) return;
    setDeploying(true);
    setError(null);
    try {
      await invoke<string>("factory_deploy_agent", { blueprint: bp });
      setPreview(null);
      setDescription("");
      await loadAgents();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setDeploying(false);
    }
  };

  // ── Pause agent ───────────────────────────────────────────────────────────

  const handlePause = async (id: string) => {
    try {
      await invoke("factory_pause_agent", { agentId: id });
      await loadAgents();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  };

  // ── Delete agent ──────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    try {
      await invoke("factory_delete_agent", { agentId: id });
      setAgents((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    }
  };

  // ── Example prompts ───────────────────────────────────────────────────────

  const examples = [
    "Monitor #support on Slack, auto-reply to questions using our docs wiki",
    "Watch my Gmail for support emails from customers, draft a reply using the FAQ",
    "Check Discord every hour for unanswered questions, reply with helpful context",
    "When a GitHub issue is opened, create a Linear ticket and assign it to me",
    "Every morning at 9 am, send me a Slack summary of yesterday's GitHub activity",
  ];

  // ── Active / paused split ─────────────────────────────────────────────────

  const activeAgents = agents.filter((a) => a.active);
  const pausedAgents = agents.filter((a) => !a.active);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-blade-surface transition-colors text-blade-muted hover:text-blade-text"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-blade-accent" />
          <span className="text-sm font-semibold text-blade-text">Agent Factory</span>
        </div>
        <div className="ml-auto flex items-center gap-2 text-2xs text-blade-muted">
          <span className={`w-1.5 h-1.5 rounded-full ${activeAgents.length > 0 ? "bg-green-400" : "bg-blade-muted"}`} />
          {activeAgents.length} live
        </div>
      </div>

      {/* Main area — scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">

          {/* Description input */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-medium text-blade-secondary">
              Describe the agent you want
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Monitor #support on Slack, auto-reply to questions using our docs wiki…"
              rows={4}
              className="w-full rounded-xl border border-blade-border bg-blade-surface text-sm text-blade-text placeholder:text-blade-muted px-4 py-3 resize-none focus:outline-none focus:border-blade-accent/60 transition-colors"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />

            {/* Example chips */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs text-blade-muted">Examples</span>
              <div className="flex flex-wrap gap-1.5">
                {examples.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => setDescription(ex)}
                    className="px-2.5 py-1 rounded-lg border border-blade-border bg-blade-surface/50 text-2xs text-blade-muted hover:text-blade-text hover:border-blade-accent/40 transition-colors text-left"
                  >
                    {ex.length > 60 ? ex.slice(0, 60) + "…" : ex}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!description.trim() || generating}
              className="self-start flex items-center gap-2 px-4 py-2 rounded-lg bg-blade-accent text-black text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {generating ? (
                <>
                  <Loader size={12} />
                  Generating blueprint…
                </>
              ) : (
                <>
                  <Wand2 size={12} />
                  Generate blueprint
                  <span className="text-2xs opacity-60 font-normal">Ctrl+Enter</span>
                </>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Blueprint preview */}
          {preview && !generating && (
            <BlueprintPreview
              blueprint={preview}
              onDeploy={() => handleDeploy(preview)}
              onDiscard={() => setPreview(null)}
              deploying={deploying}
            />
          )}

          {/* Divider */}
          {agents.length > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-blade-border" />
              <span className="text-2xs text-blade-muted uppercase tracking-wider">Deployed agents</span>
              <div className="flex-1 border-t border-blade-border" />
            </div>
          )}

          {/* Active agents */}
          {activeAgents.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5 text-2xs text-blade-muted uppercase tracking-wider">
                <Globe size={10} className="text-green-400" />
                Live ({activeAgents.length})
              </div>
              {activeAgents.map((a) => (
                <BlueprintCard
                  key={a.id}
                  blueprint={a}
                  onDeploy={handleDeploy}
                  onPause={handlePause}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {/* Paused agents */}
          {pausedAgents.length > 0 && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-1.5 text-2xs text-blade-muted uppercase tracking-wider">
                <Terminal size={10} />
                Paused ({pausedAgents.length})
              </div>
              {pausedAgents.map((a) => (
                <BlueprintCard
                  key={a.id}
                  blueprint={a}
                  onDeploy={handleDeploy}
                  onPause={handlePause}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loadingAgents && agents.length === 0 && !preview && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="w-12 h-12 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center">
                <Bot size={22} className="text-blade-muted" />
              </div>
              <div className="text-sm text-blade-secondary">No agents yet</div>
              <div className="text-2xs text-blade-muted max-w-xs">
                Describe what you want your agent to do above and click "Generate blueprint" to get started.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
