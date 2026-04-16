/**
 * TASK AGENT VIEW — Autonomous task execution with live progress.
 * Ported from Omi's TaskAgentManager + TaskChatPanel.
 *
 * Shows: spawned agents with live stdout streaming, tool calls,
 * progress tracking, and completion status.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Agent {
  id: string;
  agent_type: string;
  task: string;
  status: string;
  started_at: number;
  output: string;
}

interface TaskAgentViewProps {
  onBack: () => void;
}

export function TaskAgentView({ onBack }: TaskAgentViewProps) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");
  const [agentType, setAgentType] = useState("claude_code");
  const [spawning, setSpawning] = useState(false);
  const [liveOutput, setLiveOutput] = useState<Record<string, string>>({});

  useEffect(() => {
    invoke<Agent[]>("agent_list_background").then(setAgents).catch(() => null);
    const interval = setInterval(() => {
      invoke<Agent[]>("agent_list_background").then(setAgents).catch(() => null);
    }, 5000);

    const cleanups: Array<() => void> = [];

    listen<{ id: string; line: string }>("agent_stdout", (e) => {
      setLiveOutput((prev) => ({
        ...prev,
        [e.payload.id]: (prev[e.payload.id] || "") + e.payload.line + "\n",
      }));
    }).then((u) => cleanups.push(u));

    listen<{ id: string }>("agent_done", () => {
      invoke<Agent[]>("agent_list_background").then(setAgents).catch(() => null);
    }).then((u) => cleanups.push(u));

    return () => {
      clearInterval(interval);
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const spawn = async () => {
    if (!newTask.trim()) return;
    setSpawning(true);
    try {
      const id = await invoke<string>("reproductive_spawn", {
        agentType,
        task: newTask,
        workingDir: null,
      });
      setSelectedId(id);
      setNewTask("");
      invoke<Agent[]>("agent_list_background").then(setAgents).catch(() => null);
    } catch { /* ignore */ }
    setSpawning(false);
  };

  const cancel = async (id: string) => {
    try { await invoke("agent_cancel_background", { id }); } catch { /* ignore */ }
    invoke<Agent[]>("agent_list_background").then(setAgents).catch(() => null);
  };

  const selected = agents.find((a) => a.id === selectedId);
  const output = selectedId ? (liveOutput[selectedId] || selected?.output || "") : "";

  return (
    <div className="flex h-full bg-[#0a0a0f] text-white">
      {/* Left panel: agent list + spawn */}
      <div className="w-[280px] border-r border-[rgba(255,255,255,0.08)] flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[rgba(255,255,255,0.08)]">
          <button onClick={onBack} className="text-[rgba(255,255,255,0.5)] hover:text-white text-sm">←</button>
          <h1 className="text-[14px] font-semibold">Task Agents</h1>
        </div>

        {/* Spawn form */}
        <div className="p-3 border-b border-[rgba(255,255,255,0.06)] space-y-2">
          <select value={agentType} onChange={(e) => setAgentType(e.target.value)}
            className="w-full px-2 py-[6px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md text-[11px] text-white focus:outline-none">
            <option value="claude_code">Claude Code</option>
            <option value="aider">Aider</option>
            <option value="codex">Codex</option>
          </select>
          <textarea value={newTask} onChange={(e) => setNewTask(e.target.value)}
            placeholder="Describe the task..."
            className="w-full h-[60px] px-2 py-[6px] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md text-[11px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#818cf8] resize-none" />
          <button onClick={spawn} disabled={spawning || !newTask.trim()}
            className="w-full px-3 py-[6px] bg-[rgba(129,140,248,0.2)] text-[#818cf8] text-[11px] font-semibold rounded-md hover:bg-[rgba(129,140,248,0.3)] disabled:opacity-40 transition-colors">
            {spawning ? "Spawning..." : "Spawn Agent"}
          </button>
        </div>

        {/* Agent list */}
        <div className="flex-1 overflow-y-auto">
          {agents.length === 0 ? (
            <div className="p-4 text-center text-[11px] text-[rgba(255,255,255,0.25)]">
              No agents running. Spawn one above or say "Hey BLADE, have Claude Code fix the bug."
            </div>
          ) : (
            agents.map((agent) => {
              const isSelected = agent.id === selectedId;
              const statusColor = agent.status === "running" ? "#4ade80" : agent.status === "completed" ? "#818cf8" : "#f87171";
              return (
                <button key={agent.id} onClick={() => setSelectedId(agent.id)}
                  className={`w-full px-3 py-[10px] text-left border-b border-[rgba(255,255,255,0.04)] transition-colors ${
                    isSelected ? "bg-[rgba(129,140,248,0.1)]" : "hover:bg-[rgba(255,255,255,0.04)]"
                  }`}>
                  <div className="flex items-center gap-2">
                    <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: statusColor }} />
                    <span className="text-[11px] font-medium truncate">{agent.agent_type}</span>
                    <span className="text-[9px] text-[rgba(255,255,255,0.25)] ml-auto">{agent.status}</span>
                  </div>
                  <div className="text-[10px] text-[rgba(255,255,255,0.4)] truncate mt-[2px] pl-[13px]">
                    {agent.task.substring(0, 60)}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel: agent output */}
      <div className="flex-1 flex flex-col">
        {selected ? (
          <>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.08)]">
              <div>
                <div className="text-[13px] font-semibold">{selected.agent_type}</div>
                <div className="text-[11px] text-[rgba(255,255,255,0.4)]">{selected.task.substring(0, 80)}</div>
              </div>
              {selected.status === "running" && (
                <button onClick={() => cancel(selected.id)}
                  className="px-3 py-1 text-[10px] text-[#f87171] border border-[rgba(248,113,113,0.3)] rounded-md hover:bg-[rgba(248,113,113,0.1)]">
                  Cancel
                </button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-[11px] text-[rgba(255,255,255,0.7)] whitespace-pre-wrap leading-[1.6] bg-[rgba(0,0,0,0.3)]">
              {output || "Waiting for output..."}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[13px] text-[rgba(255,255,255,0.2)]">
            Select an agent to view its output
          </div>
        )}
      </div>
    </div>
  );
}
