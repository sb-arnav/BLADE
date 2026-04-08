import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * Claude Managed Agents integration for Blade.
 *
 * Uses the Claude Agent SDK to run autonomous agents with:
 * - Built-in tools (Read, Edit, Bash, Glob, Grep, WebSearch)
 * - MCP server connections
 * - Subagent delegation
 * - Session persistence
 * - Lifecycle hooks
 *
 * Agents run in the Rust backend via a Node.js subprocess,
 * streaming messages back to the frontend via Tauri events.
 */

export interface ManagedAgentConfig {
  prompt: string;
  tools: string[];
  mcpServers?: Record<string, { command: string; args: string[] }>;
  subagents?: Record<string, {
    description: string;
    prompt: string;
    tools: string[];
  }>;
  workingDirectory?: string;
  permissionMode?: "default" | "acceptEdits" | "full";
  maxTurns?: number;
  sessionId?: string; // resume a previous session
}

export interface AgentMessage {
  id: string;
  type: "system" | "assistant" | "tool_use" | "tool_result" | "result" | "error";
  content: string;
  timestamp: number;
  metadata?: {
    toolName?: string;
    toolInput?: unknown;
    sessionId?: string;
    subtype?: string;
    costUsd?: number;
    durationMs?: number;
  };
}

export interface ManagedAgentRun {
  id: string;
  config: ManagedAgentConfig;
  status: "starting" | "running" | "completed" | "error" | "cancelled";
  messages: AgentMessage[];
  sessionId: string | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  totalCostUsd: number;
}

const AVAILABLE_TOOLS = [
  { name: "Read", description: "Read any file", category: "filesystem", risk: "safe" },
  { name: "Write", description: "Create new files", category: "filesystem", risk: "moderate" },
  { name: "Edit", description: "Edit existing files", category: "filesystem", risk: "moderate" },
  { name: "Bash", description: "Run terminal commands", category: "system", risk: "dangerous" },
  { name: "Glob", description: "Find files by pattern", category: "filesystem", risk: "safe" },
  { name: "Grep", description: "Search file contents", category: "filesystem", risk: "safe" },
  { name: "WebSearch", description: "Search the web", category: "web", risk: "safe" },
  { name: "WebFetch", description: "Fetch web page content", category: "web", risk: "safe" },
  { name: "Agent", description: "Spawn subagents", category: "system", risk: "moderate" },
] as const;

const PRESET_AGENTS: Record<string, Omit<ManagedAgentConfig, "prompt">> = {
  "code-reviewer": {
    tools: ["Read", "Glob", "Grep"],
    permissionMode: "default",
    maxTurns: 20,
  },
  "bug-fixer": {
    tools: ["Read", "Edit", "Bash", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    maxTurns: 30,
  },
  "researcher": {
    tools: ["WebSearch", "WebFetch", "Read", "Write"],
    permissionMode: "acceptEdits",
    maxTurns: 15,
  },
  "project-scaffolder": {
    tools: ["Read", "Write", "Bash", "Glob"],
    permissionMode: "acceptEdits",
    maxTurns: 25,
  },
  "refactorer": {
    tools: ["Read", "Edit", "Glob", "Grep"],
    permissionMode: "acceptEdits",
    maxTurns: 40,
  },
};

export function useManagedAgents() {
  const [runs, setRuns] = useState<ManagedAgentRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startAgent = useCallback(async (config: ManagedAgentConfig) => {
    const runId = crypto.randomUUID();
    const run: ManagedAgentRun = {
      id: runId,
      config,
      status: "starting",
      messages: [],
      sessionId: config.sessionId || null,
      startedAt: Date.now(),
      completedAt: null,
      error: null,
      totalCostUsd: 0,
    };

    setRuns((prev) => [...prev, run]);
    setActiveRunId(runId);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Listen for streaming agent messages from Rust backend
      const unlistenMsg = await listen<AgentMessage>("agent_message", (event) => {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === runId
              ? { ...r, status: "running", messages: [...r.messages, event.payload] }
              : r,
          ),
        );
      });

      const unlistenDone = await listen<{ sessionId: string; costUsd: number }>("agent_done", (event) => {
        setRuns((prev) =>
          prev.map((r) =>
            r.id === runId
              ? {
                  ...r,
                  status: "completed",
                  sessionId: event.payload.sessionId,
                  completedAt: Date.now(),
                  totalCostUsd: event.payload.costUsd,
                }
              : r,
          ),
        );
        unlistenMsg();
        unlistenDone();
      });

      // Invoke the Rust command that spawns the agent subprocess
      await invoke("run_managed_agent", {
        runId,
        prompt: config.prompt,
        tools: config.tools,
        mcpServers: config.mcpServers ? JSON.stringify(config.mcpServers) : null,
        permissionMode: config.permissionMode || "default",
        maxTurns: config.maxTurns || 20,
        sessionId: config.sessionId || null,
        workingDirectory: config.workingDirectory || null,
      });
    } catch (e) {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === runId
            ? {
                ...r,
                status: "error",
                error: typeof e === "string" ? e : String(e),
                completedAt: Date.now(),
              }
            : r,
        ),
      );
    }

    setActiveRunId(null);
    abortRef.current = null;
  }, []);

  const startPresetAgent = useCallback(
    async (preset: keyof typeof PRESET_AGENTS, prompt: string) => {
      const config = PRESET_AGENTS[preset];
      if (!config) return;
      await startAgent({ ...config, prompt });
    },
    [startAgent],
  );

  const cancelRun = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    if (activeRunId) {
      setRuns((prev) =>
        prev.map((r) =>
          r.id === activeRunId
            ? { ...r, status: "cancelled", completedAt: Date.now() }
            : r,
        ),
      );
      setActiveRunId(null);
    }
  }, [activeRunId]);

  const resumeSession = useCallback(
    async (sessionId: string, prompt: string, tools?: string[]) => {
      await startAgent({
        prompt,
        tools: tools || ["Read", "Edit", "Bash", "Glob", "Grep"],
        sessionId,
      });
    },
    [startAgent],
  );

  const clearRuns = useCallback(() => {
    setRuns([]);
    setActiveRunId(null);
  }, []);

  const activeRun = runs.find((r) => r.id === activeRunId) || null;
  const completedRuns = runs.filter((r) => r.status === "completed" || r.status === "error");

  return {
    runs,
    activeRun,
    completedRuns,
    activeRunId,
    startAgent,
    startPresetAgent,
    cancelRun,
    resumeSession,
    clearRuns,
    availableTools: AVAILABLE_TOOLS,
    presets: PRESET_AGENTS,
  };
}
