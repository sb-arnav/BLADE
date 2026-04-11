import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface BackgroundAgent {
  id: string;
  agent_type: string;
  task: string;
  cwd: string;
  status: "Running" | "Completed" | "Failed" | "Cancelled";
  output: string[];
  exit_code: number | null;
  started_at: number;
  finished_at: number | null;
}

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

export function BackgroundAgentsPanel({ onBack, onSendToChat }: Props) {
  const [agents, setAgents] = useState<BackgroundAgent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [spawnTask, setSpawnTask] = useState("");
  const [spawnType, setSpawnType] = useState("claude");
  const [spawnCwd, setSpawnCwd] = useState("");
  const [available, setAvailable] = useState<string[]>([]);
  const [spawning, setSpawning] = useState(false);
  const outputEndRef = useRef<HTMLDivElement>(null);

  const loadAgents = async () => {
    try {
      const list = await invoke<BackgroundAgent[]>("agent_list_background");
      setAgents(list);
      if (list.length > 0 && !selected) {
        setSelected(list[0].id);
      }
    } catch {}
  };

  useEffect(() => {
    loadAgents();
    invoke<string[]>("agent_detect_available").then(setAvailable).catch(() => {});

    // Stream output lines
    const unlistenOut = listen<{ id: string; line: string }>("agent_stdout", (event) => {
      const { id, line } = event.payload;
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, output: [...a.output, line] } : a
        )
      );
    });

    const unlistenComplete = listen<{ id: string; status: string; exit_code: number }>(
      "agent_complete",
      (event) => {
        const { id, status, exit_code } = event.payload;
        setAgents((prev) =>
          prev.map((a) =>
            a.id === id
              ? { ...a, status: (status === "completed" ? "Completed" : "Failed") as BackgroundAgent["status"], exit_code, finished_at: Math.floor(Date.now() / 1000) }
              : a
          )
        );
      }
    );

    const unlistenSpawned = listen<{ id: string; agent_type: string; task: string }>(
      "agent_spawned",
      () => {
        loadAgents();
      }
    );

    return () => {
      unlistenOut.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenSpawned.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agents, selected]);

  const selectedAgent = agents.find((a) => a.id === selected);

  const handleSpawn = async () => {
    if (!spawnTask.trim()) return;
    setSpawning(true);
    try {
      const id = await invoke<string>("agent_spawn", {
        agentType: spawnType,
        task: spawnTask,
        cwd: spawnCwd || null,
      });
      setSpawnOpen(false);
      setSpawnTask("");
      setSpawnCwd("");
      await loadAgents();
      setSelected(id);
    } catch (e) {
      console.error("Spawn failed:", e);
    }
    setSpawning(false);
  };

  const handleCancel = async (id: string) => {
    try {
      await invoke("agent_cancel_background", { id });
    } catch {}
  };

  const handleSendOutput = (agent: BackgroundAgent) => {
    const output = agent.output.join("\n");
    const summary = output.length > 3000 ? output.slice(-3000) : output;
    onSendToChat(
      `Background agent "${agent.agent_type}" finished. Output:\n\`\`\`\n${summary}\n\`\`\`\nTask was: ${agent.task}`
    );
  };

  const statusColor = (s: BackgroundAgent["status"]) => {
    if (s === "Running") return "text-blue-400";
    if (s === "Completed") return "text-green-400";
    if (s === "Failed") return "text-red-400";
    return "text-blade-muted";
  };

  const statusDot = (s: BackgroundAgent["status"]) => {
    if (s === "Running") return "bg-blue-400 animate-pulse";
    if (s === "Completed") return "bg-green-400";
    if (s === "Failed") return "bg-red-400";
    return "bg-blade-muted";
  };

  const elapsed = (agent: BackgroundAgent) => {
    const end = agent.finished_at ?? Math.floor(Date.now() / 1000);
    const secs = end - agent.started_at;
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m${secs % 60}s`;
  };

  return (
    <div className="flex h-full bg-blade-bg text-blade-text">
      {/* Sidebar — agent list */}
      <div className="w-72 flex-shrink-0 border-r border-blade-border flex flex-col">
        <div className="px-4 py-3 border-b border-blade-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={onBack}
              className="text-blade-muted hover:text-blade-secondary transition-colors text-sm"
            >
              ←
            </button>
            <span className="text-sm font-medium text-blade-secondary">Background Agents</span>
          </div>
          <button
            onClick={() => setSpawnOpen(true)}
            className="text-xs px-2 py-1 rounded bg-blade-accent/20 hover:bg-blade-accent/30 text-blade-accent transition-colors"
          >
            + Spawn
          </button>
        </div>

        {available.length > 0 && (
          <div className="px-4 py-2 border-b border-blade-border/30">
            <p className="text-2xs text-blade-muted">Available: {available.join(", ")}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {agents.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-blade-muted text-sm">No agents yet.</p>
              <p className="text-blade-muted text-2xs mt-1">Spawn one or ask BLADE to handle a complex task.</p>
            </div>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => setSelected(agent.id)}
                className={`px-4 py-3 cursor-pointer border-b border-blade-border/20 hover:bg-blade-surface/40 transition-colors ${selected === agent.id ? "bg-blade-surface/60" : ""}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(agent.status)}`} />
                  <span className="text-xs font-medium text-blade-secondary">{agent.agent_type}</span>
                  <span className={`text-2xs ml-auto ${statusColor(agent.status)}`}>{elapsed(agent)}</span>
                </div>
                <p className="text-2xs text-blade-muted truncate">{agent.task}</p>
                <p className="text-2xs text-blade-muted/50 mt-0.5">{agent.output.length} lines</p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main — output viewer */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedAgent ? (
          <>
            <div className="px-5 py-3 border-b border-blade-border flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(selectedAgent.status)}`} />
                  <span className={`text-xs font-medium ${statusColor(selectedAgent.status)}`}>
                    {selectedAgent.status}
                  </span>
                  <span className="text-blade-muted text-xs">·</span>
                  <span className="text-xs text-blade-muted">{selectedAgent.agent_type}</span>
                  <span className="text-blade-muted text-xs">·</span>
                  <span className="text-2xs text-blade-muted/60 truncate">{selectedAgent.cwd}</span>
                </div>
                <p className="text-sm text-blade-secondary mt-1 leading-snug">{selectedAgent.task}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {selectedAgent.status === "Running" && (
                  <button
                    onClick={() => handleCancel(selectedAgent.id)}
                    className="text-xs px-2 py-1 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    Cancel
                  </button>
                )}
                {(selectedAgent.status === "Completed" || selectedAgent.status === "Failed") && (
                  <button
                    onClick={() => handleSendOutput(selectedAgent)}
                    className="text-xs px-2 py-1 rounded border border-blade-border text-blade-secondary hover:bg-blade-surface transition-colors"
                  >
                    Send to chat
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 font-mono text-2xs text-blade-muted space-y-0.5">
              {selectedAgent.output.length === 0 ? (
                <p className="text-blade-muted/50 italic">Waiting for output...</p>
              ) : (
                selectedAgent.output.map((line, i) => (
                  <div key={i} className={line.startsWith("[err]") ? "text-red-400/70" : ""}>
                    {line}
                  </div>
                ))
              )}
              <div ref={outputEndRef} />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-blade-muted text-sm">Select an agent to view its output</p>
              <p className="text-blade-muted/60 text-2xs mt-2">
                Or spawn one — BLADE can orchestrate Claude Code, Aider, Goose
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Spawn dialog */}
      {spawnOpen && (
        <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setSpawnOpen(false)}>
          <div className="bg-blade-surface rounded-xl border border-blade-border p-6 w-[520px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-blade-secondary mb-4">Spawn Background Agent</h3>

            <div className="space-y-3">
              <div>
                <label className="text-2xs text-blade-muted block mb-1">Agent type</label>
                <select
                  value={spawnType}
                  onChange={(e) => setSpawnType(e.target.value)}
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text"
                >
                  <option value="claude">Claude Code CLI</option>
                  <option value="aider">Aider</option>
                  <option value="goose">Goose (Block)</option>
                  <option value="bash">Bash script</option>
                </select>
              </div>

              <div>
                <label className="text-2xs text-blade-muted block mb-1">Task</label>
                <textarea
                  value={spawnTask}
                  onChange={(e) => setSpawnTask(e.target.value)}
                  placeholder="Refactor the authentication module to use JWT tokens..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text resize-none h-24 placeholder:text-blade-muted"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-2xs text-blade-muted block mb-1">Working directory (optional)</label>
                <input
                  type="text"
                  value={spawnCwd}
                  onChange={(e) => setSpawnCwd(e.target.value)}
                  placeholder="/home/user/project"
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text placeholder:text-blade-muted"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setSpawnOpen(false)}
                className="text-sm text-blade-muted hover:text-blade-secondary transition-colors px-4 py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleSpawn}
                disabled={!spawnTask.trim() || spawning}
                className="text-sm px-4 py-2 rounded-lg bg-blade-accent text-white hover:bg-blade-accent/90 transition-colors disabled:opacity-40"
              >
                {spawning ? "Spawning..." : "Spawn agent"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
