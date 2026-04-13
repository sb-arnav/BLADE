import { useState, useEffect, useCallback, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AgentAuthority {
  agent_type: string;
  description: string;
  allowed_actions: string[];
  denied_actions: string[];
  system_prompt: string;
}

interface Delegation {
  id: string;
  task: string;
  delegated_to: string;
  status: string;
  result: string;
  created_at: number;
}

const palette = {
  bg: "#0a0a0a",
  panel: "#10150f",
  panelAlt: "#0d120d",
  green: "#00ff41",
  amber: "#ffb000",
  red: "#ff0040",
  blue: "#00b8ff",
  line: "rgba(0, 255, 65, 0.24)",
  dim: "rgba(0, 255, 65, 0.54)",
  muted: "rgba(164, 255, 188, 0.74)",
  glow: "rgba(0, 255, 65, 0.18)",
} as const;

function relTime(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function SectionFrame({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section
      className={`relative overflow-hidden border p-4 ${className}`}
      style={{
        borderColor: palette.line,
        background: `linear-gradient(180deg, ${palette.panel} 0%, ${palette.panelAlt} 100%)`,
        boxShadow: `inset 0 0 0 1px rgba(0, 255, 65, 0.06), 0 0 18px ${palette.glow}`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div className="relative">
        <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: palette.amber }}>
          {`=== ${title} ===`}
        </div>
        {children}
      </div>
    </section>
  );
}

function AgentCard({
  agent,
  onDelegate,
}: {
  agent: AgentAuthority;
  onDelegate: (agentType: string) => void;
}) {
  const typeColors: Record<string, string> = {
    ARCHITECT: palette.blue,
    ENGINEER: palette.green,
    RESEARCHER: palette.amber,
    ANALYST: "#c678dd",
    WRITER: "#56b6c2",
    CRITIC: palette.red,
    EXECUTOR: "#e5c07b",
    PLANNER: "#61afef",
    GUARDIAN: "#98c379",
  };
  const color = typeColors[agent.agent_type.toUpperCase()] ?? palette.green;

  return (
    <div
      className="relative flex flex-col gap-2 border p-3"
      style={{
        borderColor: `${color}44`,
        backgroundColor: `${color}08`,
        boxShadow: `inset 0 0 0 1px ${color}18`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-[11px] font-bold uppercase tracking-[0.22em]"
          style={{ color, textShadow: `0 0 10px ${color}88` }}
        >
          {agent.agent_type}
        </div>
        <div
          className="h-2 w-2 shrink-0"
          style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}88` }}
        />
      </div>
      <div className="text-[10px] leading-relaxed" style={{ color: palette.muted }}>
        {agent.description}
      </div>
      <div className="flex flex-wrap gap-1">
        {agent.allowed_actions.slice(0, 4).map((action) => (
          <span
            key={action}
            className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
            style={{
              borderColor: `${palette.green}44`,
              color: palette.green,
              backgroundColor: `${palette.green}12`,
            }}
          >
            {action}
          </span>
        ))}
        {agent.denied_actions.slice(0, 2).map((action) => (
          <span
            key={action}
            className="border px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em]"
            style={{
              borderColor: `${palette.red}44`,
              color: palette.red,
              backgroundColor: `${palette.red}12`,
            }}
          >
            ✗ {action}
          </span>
        ))}
      </div>
      <button
        onClick={() => onDelegate(agent.agent_type)}
        className="mt-1 border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors"
        style={{ borderColor: `${color}55`, color }}
      >
        Delegate →
      </button>
    </div>
  );
}

export function AgentDashboard({ onBack }: { onBack: () => void }) {
  const [agents, setAgents] = useState<AgentAuthority[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Delegate form
  const [delegateTarget, setDelegateTarget] = useState<string | null>(null);
  const [delegateTask, setDelegateTask] = useState("");
  const [delegateContext, setDelegateContext] = useState("");
  const [delegateResult, setDelegateResult] = useState<string | null>(null);
  const [delegateRunning, setDelegateRunning] = useState(false);

  // Smart route
  const [routeTask, setRouteTask] = useState("");
  const [routeResult, setRouteResult] = useState<string | null>(null);
  const [routeRunning, setRouteRunning] = useState(false);

  // Chain
  const [chainTask, setChainTask] = useState("");
  const [chainAgents, setChainAgents] = useState<string[]>([]);
  const [chainResults, setChainResults] = useState<string[]>([]);
  const [chainRunning, setChainRunning] = useState(false);

  const load = useCallback(async () => {
    const [agentsRes, delegationsRes, auditRes] = await Promise.allSettled([
      invoke<AgentAuthority[]>("authority_get_agents"),
      invoke<Delegation[]>("authority_get_delegations", { limit: 20 }),
      invoke<any[]>("authority_get_audit_log", { limit: 50 }),
    ]);
    setAgents(agentsRes.status === "fulfilled" ? agentsRes.value : []);
    setDelegations(delegationsRes.status === "fulfilled" ? delegationsRes.value : []);
    setAuditLog(auditRes.status === "fulfilled" ? auditRes.value : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleDelegate() {
    if (!delegateTarget || !delegateTask.trim()) return;
    setDelegateRunning(true);
    setDelegateResult(null);
    try {
      const result = await invoke<string>("authority_delegate", {
        task: delegateTask,
        agentType: delegateTarget,
        context: delegateContext,
      });
      setDelegateResult(result);
      await load();
    } catch (e: any) {
      setDelegateResult(`ERROR: ${e}`);
    } finally {
      setDelegateRunning(false);
    }
  }

  async function handleRoute() {
    if (!routeTask.trim()) return;
    setRouteRunning(true);
    setRouteResult(null);
    try {
      const result = await invoke<string>("authority_route_and_run", { task: routeTask });
      setRouteResult(result);
      await load();
    } catch (e: any) {
      setRouteResult(`ERROR: ${e}`);
    } finally {
      setRouteRunning(false);
    }
  }

  async function handleChain() {
    if (!chainTask.trim() || chainAgents.length === 0) return;
    setChainRunning(true);
    setChainResults([]);
    try {
      const results = await invoke<string[]>("authority_run_chain", {
        task: chainTask,
        agents: chainAgents,
      });
      setChainResults(results);
      await load();
    } catch (e: any) {
      setChainResults([`ERROR: ${e}`]);
    } finally {
      setChainRunning(false);
    }
  }

  function toggleChainAgent(agentType: string) {
    setChainAgents((prev) =>
      prev.includes(agentType) ? prev.filter((a) => a !== agentType) : [...prev, agentType]
    );
  }

  const statusColor = (status: string) => {
    if (status === "completed") return palette.green;
    if (status === "failed") return palette.red;
    if (status === "running") return palette.amber;
    return palette.muted;
  };

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center font-mono text-sm uppercase tracking-[0.3em]"
        style={{ color: palette.green, backgroundColor: palette.bg, textShadow: `0 0 10px ${palette.green}88` }}
      >
        Initializing authority hierarchy...
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden font-mono"
      style={{
        background:
          "radial-gradient(circle at top, rgba(0,180,255,0.06) 0%, rgba(0,255,65,0.02) 18%, rgba(10,10,10,1) 55%), #0a0a0a",
        color: palette.green,
      }}
    >
      <style>{`
        @keyframes auth-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.45; }
        }
        @keyframes auth-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(0,255,65,0.4); }
          50% { box-shadow: 0 0 18px rgba(0,255,65,0.8); }
        }
        @keyframes auth-flicker {
          0%, 100% { opacity: 0.18; }
          50% { opacity: 0.26; }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "repeating-linear-gradient(180deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 4px)",
          animation: "auth-flicker 4s linear infinite",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: "inset 0 0 90px rgba(0, 0, 0, 0.72)" }}
      />

      {/* Header */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ borderColor: palette.line, backgroundColor: "rgba(10, 16, 10, 0.92)" }}
      >
        <button
          onClick={onBack}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors"
          style={{ borderColor: palette.line, color: palette.amber }}
        >
          &lt; Back
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <div className="text-[11px] font-bold" style={{ color: palette.blue }}>
              ▲▲▲
            </div>
            <div className="text-sm font-bold uppercase tracking-[0.32em]" style={{ color: "#d5ffd8" }}>
              Agent Authority Hierarchy
            </div>
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.dim }}>
            {agents.length} specialist agents registered | {delegations.filter((d) => d.status === "running").length} active delegations
          </div>
        </div>
        <button
          onClick={load}
          className="border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{ borderColor: palette.line, color: palette.green }}
        >
          Refresh
        </button>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="space-y-4">

          {/* Agent Grid */}
          <SectionFrame title={`SPECIALIST AGENTS [${agents.length}]`}>
            {agents.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No agents registered. Authority module may not be initialized.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {agents.map((agent) => (
                  <AgentCard
                    key={agent.agent_type}
                    agent={agent}
                    onDelegate={(type) => {
                      setDelegateTarget(type);
                      setDelegateTask("");
                      setDelegateContext("");
                      setDelegateResult(null);
                    }}
                  />
                ))}
              </div>
            )}
          </SectionFrame>

          {/* Delegate inline form */}
          {delegateTarget && (
            <SectionFrame title={`DELEGATE TO ${delegateTarget}`}>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.amber }}>
                    Task
                  </label>
                  <textarea
                    value={delegateTask}
                    onChange={(e) => setDelegateTask(e.target.value)}
                    rows={3}
                    placeholder="Describe the task to delegate..."
                    className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] uppercase tracking-[0.2em]" style={{ color: palette.amber }}>
                    Context (optional)
                  </label>
                  <textarea
                    value={delegateContext}
                    onChange={(e) => setDelegateContext(e.target.value)}
                    rows={2}
                    placeholder="Additional context or constraints..."
                    className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
                  />
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleDelegate}
                    disabled={delegateRunning || !delegateTask.trim()}
                    className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                    style={{ borderColor: palette.green, color: palette.green }}
                  >
                    {delegateRunning ? "Delegating..." : `Delegate → ${delegateTarget}`}
                  </button>
                  <button
                    onClick={() => setDelegateTarget(null)}
                    className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em]"
                    style={{ borderColor: palette.line, color: palette.muted }}
                  >
                    Cancel
                  </button>
                </div>
                {delegateResult && (
                  <div
                    className="border p-3 text-[11px] leading-relaxed"
                    style={{
                      borderColor: palette.line,
                      color: palette.green,
                      backgroundColor: "rgba(0, 255, 65, 0.05)",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {delegateResult}
                  </div>
                )}
              </div>
            </SectionFrame>
          )}

          {/* Smart Route */}
          <SectionFrame title="SMART ROUTE">
            <div className="text-[10px] mb-3 uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              BLADE auto-selects the best specialist for your task
            </div>
            <div className="space-y-3">
              <textarea
                value={routeTask}
                onChange={(e) => setRouteTask(e.target.value)}
                rows={3}
                placeholder="Describe your task — BLADE will route it to the optimal agent..."
                className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
              />
              <button
                onClick={handleRoute}
                disabled={routeRunning || !routeTask.trim()}
                className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                style={{ borderColor: palette.blue, color: palette.blue }}
              >
                {routeRunning ? (
                  <span style={{ animation: "auth-blink 1s steps(2) infinite" }}>
                    Routing...
                  </span>
                ) : "Route to Best Agent ⚡"}
              </button>
              {routeResult && (
                <div
                  className="border p-3 text-[11px] leading-relaxed"
                  style={{
                    borderColor: palette.line,
                    color: palette.green,
                    backgroundColor: "rgba(0, 255, 65, 0.05)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {routeResult}
                </div>
              )}
            </div>
          </SectionFrame>

          {/* Chain Execution */}
          <SectionFrame title="AGENT CHAIN">
            <div className="text-[10px] mb-3 uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              Select agents in execution order, then run the chain
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {agents.map((agent) => {
                  const selected = chainAgents.includes(agent.agent_type);
                  const chainIdx = chainAgents.indexOf(agent.agent_type);
                  return (
                    <button
                      key={agent.agent_type}
                      onClick={() => toggleChainAgent(agent.agent_type)}
                      className="border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] transition-all"
                      style={{
                        borderColor: selected ? palette.amber : palette.line,
                        color: selected ? palette.amber : palette.muted,
                        backgroundColor: selected ? `${palette.amber}12` : "transparent",
                      }}
                    >
                      {selected ? `${chainIdx + 1}. ` : ""}{agent.agent_type}
                    </button>
                  );
                })}
              </div>
              {chainAgents.length > 0 && (
                <div className="text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.amber }}>
                  Chain: {chainAgents.join(" → ")}
                </div>
              )}
              <textarea
                value={chainTask}
                onChange={(e) => setChainTask(e.target.value)}
                rows={2}
                placeholder="Task to pass through the agent chain..."
                className="w-full resize-none border bg-transparent px-3 py-2 text-[12px] outline-none"
                style={{ borderColor: palette.line, color: palette.green, caretColor: palette.green }}
              />
              <button
                onClick={handleChain}
                disabled={chainRunning || chainAgents.length === 0 || !chainTask.trim()}
                className="border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
                style={{ borderColor: palette.amber, color: palette.amber }}
              >
                {chainRunning ? "Running chain..." : `Run Chain [${chainAgents.length} agents]`}
              </button>
              {chainResults.length > 0 && (
                <div className="space-y-2">
                  {chainResults.map((result, i) => (
                    <div
                      key={i}
                      className="border p-3"
                      style={{
                        borderColor: palette.line,
                        backgroundColor: "rgba(0, 0, 0, 0.22)",
                      }}
                    >
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: palette.amber }}>
                        {chainAgents[i] ?? `Step ${i + 1}`}
                      </div>
                      <div className="text-[11px] leading-relaxed" style={{ color: palette.green, whiteSpace: "pre-wrap" }}>
                        {result}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionFrame>

          {/* Recent Delegations */}
          <SectionFrame title={`RECENT DELEGATIONS [${delegations.length}]`}>
            {delegations.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No delegations recorded yet.
              </div>
            ) : (
              <div className="border" style={{ borderColor: palette.line, backgroundColor: "rgba(0, 0, 0, 0.22)" }}>
                <div
                  className="grid grid-cols-[minmax(0,2fr)_8rem_6rem_minmax(0,2fr)] gap-2 border-b px-3 py-2 text-[10px] font-bold uppercase tracking-[0.2em]"
                  style={{ borderColor: palette.line, color: palette.amber }}
                >
                  <div>Task</div>
                  <div>Agent</div>
                  <div>Status</div>
                  <div>Result</div>
                </div>
                {delegations.slice(0, 15).map((d) => (
                  <div
                    key={d.id}
                    className="grid grid-cols-[minmax(0,2fr)_8rem_6rem_minmax(0,2fr)] gap-2 border-b px-3 py-2 text-[11px]"
                    style={{ borderColor: "rgba(0, 255, 65, 0.1)" }}
                  >
                    <div className="truncate" style={{ color: "#d5ffd8" }}>
                      {d.task}
                    </div>
                    <div className="uppercase tracking-[0.12em]" style={{ color: palette.blue }}>
                      {d.delegated_to}
                    </div>
                    <div
                      className="font-bold uppercase tracking-[0.12em]"
                      style={{ color: statusColor(d.status) }}
                    >
                      {d.status}
                    </div>
                    <div className="truncate" style={{ color: palette.dim }}>
                      {d.result || "—"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionFrame>

          {/* Audit Log */}
          <SectionFrame title={`AUDIT LOG [${auditLog.length}]`}>
            {auditLog.length === 0 ? (
              <div className="text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                No audit events recorded.
              </div>
            ) : (
              <div
                className="max-h-64 overflow-y-auto border"
                style={{ borderColor: palette.line, backgroundColor: "rgba(0, 0, 0, 0.22)" }}
              >
                {auditLog.map((entry: any, i) => {
                  const allowed = entry.allowed !== false;
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-3 border-b px-3 py-2 text-[10px]"
                      style={{ borderColor: "rgba(0, 255, 65, 0.1)" }}
                    >
                      <span
                        className="mt-0.5 shrink-0 font-bold"
                        style={{ color: allowed ? palette.green : palette.red }}
                      >
                        {allowed ? "ALLOW" : "DENY "}
                      </span>
                      <span className="min-w-0 flex-1 truncate" style={{ color: palette.muted }}>
                        {entry.action ?? entry.event ?? JSON.stringify(entry)}
                      </span>
                      <span className="shrink-0 tabular-nums" style={{ color: palette.dim }}>
                        {entry.timestamp ? relTime(entry.timestamp) : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionFrame>

        </div>
      </div>
    </div>
  );
}
