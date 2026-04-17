import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Agent } from "../types";

// ── Event payloads ─────────────────────────────────────────────────────────────

interface StepStartedPayload {
  agent_id: string;
  step_id: string;
  description: string;
}

interface StepCompletedPayload {
  agent_id: string;
  step_id: string;
  result: string;
}

interface StepFailedPayload {
  agent_id: string;
  step_id: string;
  error: string;
}

interface AgentCompletedPayload {
  agent_id: string;
  status: Agent["status"];
}

interface DesktopActionPendingPayload {
  agent_id: string;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const patchAgent = useCallback((agentId: string, updater: (prev: Agent) => Agent) => {
    setAgents((prev) => prev.map((a) => (a.id === agentId ? updater(a) : a)));
  }, []);

  // ── Bootstrap ────────────────────────────────────────────────────────────────

  const refresh = useCallback(async () => {
    try {
      const list = await invoke<Agent[]>("agent_list");
      setAgents(list.slice().sort((a, b) => b.created_at - a.created_at));
      setError(null);
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to load agents");
    }
  }, []);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    refresh();
  }, [refresh]);

  // ── Event listeners ──────────────────────────────────────────────────────────

  useEffect(() => {
    let active = true;

    const unlistenStepStarted = listen<StepStartedPayload>("agent_step_started", (event) => {
      if (!active) return;
      const { agent_id, step_id, description } = event.payload;
      patchAgent(agent_id, (agent) => ({
        ...agent,
        steps: agent.steps.map((s) =>
          s.id === step_id
            ? { ...s, status: "Running" as const, description, started_at: Date.now() }
            : s
        ),
        updated_at: Date.now(),
      }));
    });

    const unlistenStepCompleted = listen<StepCompletedPayload>("agent_step_completed", (event) => {
      if (!active) return;
      const { agent_id, step_id, result } = event.payload;
      patchAgent(agent_id, (agent) => ({
        ...agent,
        steps: agent.steps.map((s) =>
          s.id === step_id
            ? { ...s, status: "Completed" as const, result, completed_at: Date.now() }
            : s
        ),
        current_step: agent.current_step + 1,
        updated_at: Date.now(),
      }));
    });

    const unlistenStepFailed = listen<StepFailedPayload>("agent_step_failed", (event) => {
      if (!active) return;
      const { agent_id, step_id, error } = event.payload;
      patchAgent(agent_id, (agent) => ({
        ...agent,
        steps: agent.steps.map((s) =>
          s.id === step_id
            ? { ...s, status: "Failed" as const, result: error, completed_at: Date.now() }
            : s
        ),
        error,
        updated_at: Date.now(),
      }));
    });

    const unlistenAgentCompleted = listen<AgentCompletedPayload>("agent_completed", async (event) => {
      if (!active) return;
      const { agent_id, status } = event.payload;
      // Fetch fresh state from backend to get accurate final snapshot
      try {
        const fresh = await invoke<Agent>("agent_get", { agentId: agent_id });
        setAgents((prev) =>
          prev.map((a) => (a.id === agent_id ? fresh : a))
        );
      } catch {
        patchAgent(agent_id, (agent) => ({ ...agent, status, updated_at: Date.now() }));
      }
    });

    const unlistenDesktopActionPending = listen<DesktopActionPendingPayload>(
      "agent_desktop_action_pending",
      async (event) => {
        if (!active) return;
        const { agent_id } = event.payload;
        try {
          const fresh = await invoke<Agent>("agent_get", { agentId: agent_id });
          setAgents((prev) => prev.map((a) => (a.id === agent_id ? fresh : a)));
        } catch {
          patchAgent(agent_id, (agent) => ({
            ...agent,
            status: "WaitingApproval" as const,
            updated_at: Date.now(),
          }));
        }
      }
    );

    return () => {
      active = false;
      unlistenStepStarted.then((fn) => fn());
      unlistenStepCompleted.then((fn) => fn());
      unlistenStepFailed.then((fn) => fn());
      unlistenAgentCompleted.then((fn) => fn());
      unlistenDesktopActionPending.then((fn) => fn());
    };
  }, [patchAgent]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const createAgent = useCallback(async (goal: string): Promise<string | null> => {
    if (!goal.trim()) return null;
    setCreating(true);
    setError(null);
    try {
      const agentId = await invoke<string>("agent_create", { goal: goal.trim() });
      const fresh = await invoke<Agent>("agent_get", { agentId });
      setAgents((prev) => [fresh, ...prev]);
      return agentId;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to create agent");
      return null;
    } finally {
      setCreating(false);
    }
  }, []);

  const createDesktopAgent = useCallback(
    async (
      goal: string,
      maxSteps = 8,
      executionMode: "supervised" | "auto" = "supervised"
    ): Promise<string | null> => {
    if (!goal.trim()) return null;
    setCreating(true);
    setError(null);
    try {
      const agentId = await invoke<string>("agent_create_desktop", {
        goal: goal.trim(),
        maxSteps,
        executionMode,
      });
      const fresh = await invoke<Agent>("agent_get", { agentId });
      setAgents((prev) => [fresh, ...prev]);
      return agentId;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to create desktop agent");
      return null;
    } finally {
      setCreating(false);
    }
    },
    []
  );

  const pauseAgent = useCallback(async (agentId: string) => {
    try {
      await invoke("agent_pause", { agentId });
      patchAgent(agentId, (a) => ({ ...a, status: "Paused" as const, updated_at: Date.now() }));
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to pause agent");
    }
  }, [patchAgent]);

  const resumeAgent = useCallback(async (agentId: string) => {
    try {
      await invoke("agent_resume", { agentId });
      patchAgent(agentId, (a) => ({ ...a, status: "Executing" as const, updated_at: Date.now() }));
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to resume agent");
    }
  }, [patchAgent]);

  const cancelAgent = useCallback(async (agentId: string) => {
    try {
      await invoke("agent_cancel", { agentId });
      patchAgent(agentId, (a) => ({ ...a, status: "Failed" as const, updated_at: Date.now() }));
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to cancel agent");
    }
  }, [patchAgent]);

  const respondDesktopAction = useCallback(async (agentId: string, approved: boolean) => {
    try {
      await invoke("agent_respond_desktop_action", { agentId, approved });
      const fresh = await invoke<Agent>("agent_get", { agentId });
      setAgents((prev) => prev.map((a) => (a.id === agentId ? fresh : a)));
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to respond to desktop action");
    }
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return {
    agents,
    creating,
    error,
    dismissError,
    createAgent,
    createDesktopAgent,
    respondDesktopAction,
    pauseAgent,
    resumeAgent,
    cancelAgent,
    refresh,
  };
}
