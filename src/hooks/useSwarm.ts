import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

export interface SwarmTask {
  id: string;
  swarm_id: string;
  title: string;
  goal: string;
  task_type: "code" | "research" | "desktop";
  depends_on: string[];
  agent_id: string | null;
  status: "pending" | "blocked" | "ready" | "running" | "completed" | "failed";
  result: string | null;
  scratchpad_key: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  error: string | null;
}

export interface Swarm {
  id: string;
  goal: string;
  status: "planning" | "running" | "paused" | "completed" | "failed";
  scratchpad: Record<string, string>;
  final_result: string | null;
  tasks: SwarmTask[];
  created_at: number;
  updated_at: number;
}

export function useSwarm() {
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [activeSwarm, setActiveSwarm] = useState<Swarm | null>(null);
  const [creating, setCreating] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  const loadSwarms = useCallback(async () => {
    try {
      const list = await invoke<Swarm[]>("swarm_list", { limit: 20 });
      setSwarms(list);
    } catch (e) {
      console.error("[swarm] loadSwarms:", e);
    }
  }, []);

  const refreshActive = useCallback(async (swarmId: string) => {
    try {
      const s = await invoke<Swarm | null>("swarm_get", { swarmId });
      if (s) {
        setActiveSwarm(s);
        setSwarms((prev) => prev.map((sw) => (sw.id === s.id ? s : sw)));
      }
    } catch (e) {
      console.error("[swarm] refreshActive:", e);
    }
  }, []);

  const createSwarm = useCallback(async (goal: string) => {
    setCreating(true);
    try {
      const swarm = await invoke<Swarm>("swarm_create", { goal });
      setSwarms((prev) => [swarm, ...prev]);
      setActiveSwarm(swarm);
      return swarm;
    } catch (e) {
      console.error("[swarm] createSwarm:", e);
      throw e;
    } finally {
      setCreating(false);
    }
  }, []);

  const pauseSwarm = useCallback(async (swarmId: string) => {
    await invoke("swarm_pause", { swarmId });
    await refreshActive(swarmId);
  }, [refreshActive]);

  const resumeSwarm = useCallback(async (swarmId: string) => {
    await invoke("swarm_resume", { swarmId });
    await refreshActive(swarmId);
  }, [refreshActive]);

  const cancelSwarm = useCallback(async (swarmId: string) => {
    await invoke("swarm_cancel", { swarmId });
    await refreshActive(swarmId);
  }, [refreshActive]);

  useEffect(() => {
    loadSwarms();
  }, [loadSwarms]);

  // Real-time event listeners
  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setup = async () => {
      unlisteners.push(
        await listen<{ swarm_id: string; goal: string; task_count: number }>(
          "swarm_created",
          () => { loadSwarms(); }
        ),
        await listen<{ swarm_id: string; task_id: string; agent_id: string }>(
          "swarm_task_started",
          ({ payload }) => {
            if (activeSwarm?.id === payload.swarm_id) refreshActive(payload.swarm_id);
          }
        ),
        await listen<{ swarm_id: string; task_id: string; result_preview: string }>(
          "swarm_task_completed",
          ({ payload }) => {
            if (activeSwarm?.id === payload.swarm_id) refreshActive(payload.swarm_id);
          }
        ),
        await listen<{ swarm_id: string; task_id: string; error: string }>(
          "swarm_task_failed",
          ({ payload }) => {
            if (activeSwarm?.id === payload.swarm_id) refreshActive(payload.swarm_id);
          }
        ),
        await listen<{ swarm_id: string; completed: number; total: number; percent: number }>(
          "swarm_progress",
          ({ payload }) => {
            if (activeSwarm?.id === payload.swarm_id) refreshActive(payload.swarm_id);
          }
        ),
        await listen<{ swarm_id: string; final_result_preview: string }>(
          "swarm_completed",
          ({ payload }) => {
            refreshActive(payload.swarm_id);
            loadSwarms();
          }
        )
      );
    };

    setup();
    return () => { unlisteners.forEach((fn) => fn()); };
  }, [activeSwarm?.id, loadSwarms, refreshActive]);

  return {
    swarms,
    activeSwarm,
    setActiveSwarm,
    creating,
    goalInput,
    setGoalInput,
    loadSwarms,
    createSwarm,
    pauseSwarm,
    resumeSwarm,
    cancelSwarm,
    refreshActive,
  };
}
