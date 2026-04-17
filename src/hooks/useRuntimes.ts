import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  InstallRequirement,
  MissionRunResult,
  OperatorMission,
  PlannedMissionStage,
  RuntimeDescriptor,
  RuntimeRouteRecommendation,
  RuntimeMessageEvent,
  RuntimeSessionRef,
  RuntimeStateChangedEvent,
  TaskCheckpointEvent,
  TaskDoneEvent,
  TaskGraph,
  StoredMission,
  CompanyObject,
  SecurityEngagement,
  CapabilityBlueprint,
  InstalledPlugin,
  PluginCommandInfo,
} from "../types";

export interface RuntimeLaunchOptions {
  cwd?: string | null;
  sessionId?: string | null;
  operatorType?: string | null;
  preferredSubstrate?: string | null;
  securityEngagementId?: string | null;
  missionId?: string | null;
  stageId?: string | null;
  parentTaskId?: string | null;
  handoffNote?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  maxTurns?: number | null;
  tools?: string[] | null;
}

export interface RuntimeTaskState extends TaskGraph {
  runtimeId: string;
  sessionId: string | null;
  messages: RuntimeMessageEvent[];
  error: string | null;
  summary: string | null;
}

export interface UseRuntimesResult {
  runtimes: RuntimeDescriptor[];
  tasks: RuntimeTaskState[];
  missions: StoredMission[];
  companyObjects: CompanyObject[];
  securityEngagements: SecurityEngagement[];
  capabilityBlueprints: CapabilityBlueprint[];
  installedPlugins: InstalledPlugin[];
  pluginCommands: PluginCommandInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshSessions: (runtimeId: string) => Promise<RuntimeSessionRef[]>;
  startServer: (runtimeId: string) => Promise<string | null>;
  stopServer: (runtimeId: string) => Promise<void>;
  recommendRoute: (goal: string) => Promise<RuntimeRouteRecommendation | null>;
  designMission: (goal: string) => Promise<OperatorMission | null>;
  saveMission: (mission: OperatorMission, autoRun?: boolean) => Promise<StoredMission | null>;
  saveCompanyObject: (object: {
    kind: string;
    title: string;
    summary: string;
    status?: string | null;
    owner?: string | null;
    linkedMissionId?: string | null;
  }) => Promise<CompanyObject | null>;
  createSecurityEngagement: (engagement: {
    title: string;
    ownerName: string;
    contact: string;
    scope: string;
    assetKind: string;
    verificationMethod: string;
  }) => Promise<SecurityEngagement | null>;
  verifySecurityEngagement: (engagementId: string, proofValue: string) => Promise<SecurityEngagement | null>;
  togglePlugin: (pluginName: string, enabled: boolean) => Promise<void>;
  planNextMissionStage: (mission: OperatorMission) => Promise<PlannedMissionStage | null>;
  continueMission: (mission: OperatorMission) => Promise<TaskGraph | null>;
  runMission: (mission: OperatorMission, maxStages?: number) => Promise<MissionRunResult | null>;
  startTask: (runtimeId: string, goal: string, options?: RuntimeLaunchOptions) => Promise<TaskGraph | null>;
  resumeSession: (
    runtimeId: string,
    sessionId: string,
    goal: string,
    options?: RuntimeLaunchOptions
  ) => Promise<TaskGraph | null>;
  stopTask: (taskId: string) => Promise<void>;
  prepareInstall: (runtimeId: string) => Promise<InstallRequirement | null>;
  dismissError: () => void;
}

function taskFromGraph(graph: TaskGraph): RuntimeTaskState {
  return {
    ...graph,
    runtimeId: graph.preferred_runtime || "unknown",
    sessionId: graph.session?.session_id || null,
    messages: [],
    error: null,
    summary: null,
  };
}

function patchTask(
  tasks: RuntimeTaskState[],
  taskId: string,
  updater: (task: RuntimeTaskState) => RuntimeTaskState
) {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) {
    const placeholder: RuntimeTaskState = {
      id: taskId,
      goal: "Runtime task",
      operator_type: "delegated_operator",
      preferred_runtime: null,
      preferred_substrate: null,
      security_engagement_id: null,
      checkpoints: [],
      artifacts: [],
      approvals: [],
      status: "starting",
      session: null,
      runtimeId: "unknown",
      sessionId: null,
      messages: [],
      error: null,
      summary: null,
    };
    return [updater(placeholder), ...tasks];
  }
  return tasks.map((task) => (task.id === taskId ? updater(task) : task));
}

function upsertTask(tasks: RuntimeTaskState[], next: RuntimeTaskState) {
  const existing = tasks.find((task) => task.id === next.id);
  if (!existing) return [next, ...tasks];
  return tasks.map((task) =>
    task.id === next.id
      ? {
          ...task,
          ...next,
          messages: task.messages,
          checkpoints: next.checkpoints.length > 0 ? next.checkpoints : task.checkpoints,
          error: next.error ?? task.error,
          summary: next.summary ?? task.summary,
        }
      : task
  );
}

export function useRuntimes(): UseRuntimesResult {
  const [runtimes, setRuntimes] = useState<RuntimeDescriptor[]>([]);
  const [tasks, setTasks] = useState<RuntimeTaskState[]>([]);
  const [missions, setMissions] = useState<StoredMission[]>([]);
  const [companyObjects, setCompanyObjects] = useState<CompanyObject[]>([]);
  const [securityEngagements, setSecurityEngagements] = useState<SecurityEngagement[]>([]);
  const [capabilityBlueprints, setCapabilityBlueprints] = useState<CapabilityBlueprint[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [pluginCommands, setPluginCommands] = useState<PluginCommandInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bootstrappedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [
        nextRuntimes,
        nextTasks,
        nextMissions,
        nextCompanyObjects,
        nextSecurityEngagements,
        nextBlueprints,
        nextPlugins,
        nextPluginCommands,
      ] = await Promise.all([
        invoke<RuntimeDescriptor[]>("discover_ai_runtimes"),
        invoke<TaskGraph[]>("runtime_list_task_graphs"),
        invoke<StoredMission[]>("runtime_list_missions"),
        invoke<CompanyObject[]>("runtime_list_company_objects"),
        invoke<SecurityEngagement[]>("security_list_engagements"),
        invoke<CapabilityBlueprint[]>("runtime_list_capability_blueprints"),
        invoke<InstalledPlugin[]>("plugin_list"),
        invoke<PluginCommandInfo[]>("plugin_get_commands"),
      ]);
      setRuntimes(nextRuntimes);
      setTasks((prev) => nextTasks.reduce((acc, graph) => upsertTask(acc, taskFromGraph(graph)), prev));
      setMissions(nextMissions);
      setCompanyObjects(nextCompanyObjects);
      setSecurityEngagements(nextSecurityEngagements);
      setCapabilityBlueprints(nextBlueprints);
      setInstalledPlugins(nextPlugins);
      setPluginCommands(nextPluginCommands);
      setError(null);
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to discover runtimes");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSessions = useCallback(async (runtimeId: string) => {
    try {
      const sessions = await invoke<RuntimeSessionRef[]>("runtime_list_sessions", { runtimeId });
      setRuntimes((prev) =>
        prev.map((runtime) =>
          runtime.id === runtimeId ? { ...runtime, sessions } : runtime
        )
      );
      return sessions;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to load runtime sessions");
      return [];
    }
  }, []);

  const startServer = useCallback(async (runtimeId: string) => {
    try {
      const serverUrl = await invoke<string>("runtime_start_server", { runtimeId });
      setRuntimes((prev) =>
        prev.map((runtime) =>
          runtime.id === runtimeId ? { ...runtime, server_url: serverUrl } : runtime
        )
      );
      setError(null);
      void refresh();
      return serverUrl;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to start runtime server");
      return null;
    }
  }, [refresh]);

  const stopServer = useCallback(async (runtimeId: string) => {
    try {
      await invoke("runtime_stop_server", { runtimeId });
      setRuntimes((prev) =>
        prev.map((runtime) =>
          runtime.id === runtimeId ? { ...runtime, server_url: null } : runtime
        )
      );
      setError(null);
      void refresh();
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to stop runtime server");
    }
  }, [refresh]);

  const recommendRoute = useCallback(async (goal: string) => {
    if (!goal.trim()) return null;
    try {
      const recommendation = await invoke<RuntimeRouteRecommendation>("route_operator_task", {
        goal: goal.trim(),
      });
      setError(null);
      return recommendation;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to route task");
      return null;
    }
  }, []);

  const designMission = useCallback(async (goal: string) => {
    if (!goal.trim()) return null;
    try {
      const mission = await invoke<OperatorMission>("design_operator_mission", {
        goal: goal.trim(),
      });
      setError(null);
      return mission;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to design mission");
      return null;
    }
  }, []);

  const saveMission = useCallback(async (mission: OperatorMission, autoRun = false) => {
    try {
      const stored = await invoke<StoredMission>("runtime_save_mission", { mission, autoRun });
      setMissions((prev) => [stored, ...prev.filter((item) => item.mission.id !== stored.mission.id)]);
      setError(null);
      return stored;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to save mission");
      return null;
    }
  }, []);

  const saveCompanyObject = useCallback(async (object: {
    kind: string;
    title: string;
    summary: string;
    status?: string | null;
    owner?: string | null;
    linkedMissionId?: string | null;
  }) => {
    try {
      const saved = await invoke<CompanyObject>("runtime_save_company_object", {
        kind: object.kind,
        title: object.title,
        summary: object.summary,
        status: object.status || null,
        owner: object.owner || null,
        linkedMissionId: object.linkedMissionId || null,
      });
      setCompanyObjects((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)]);
      setError(null);
      return saved;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to save company object");
      return null;
    }
  }, []);

  const createSecurityEngagement = useCallback(async (engagement: {
    title: string;
    ownerName: string;
    contact: string;
    scope: string;
    assetKind: string;
    verificationMethod: string;
  }) => {
    try {
      const created = await invoke<SecurityEngagement>("security_create_engagement", {
        title: engagement.title,
        ownerName: engagement.ownerName,
        contact: engagement.contact,
        scope: engagement.scope,
        assetKind: engagement.assetKind,
        verificationMethod: engagement.verificationMethod,
      });
      setSecurityEngagements((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setError(null);
      return created;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to create security engagement");
      return null;
    }
  }, []);

  const verifySecurityEngagement = useCallback(async (engagementId: string, proofValue: string) => {
    try {
      const verified = await invoke<SecurityEngagement>("security_mark_engagement_verified", {
        engagementId,
        proofValue,
      });
      setSecurityEngagements((prev) => [verified, ...prev.filter((item) => item.id !== verified.id)]);
      setError(null);
      void refresh();
      return verified;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to verify security engagement");
      return null;
    }
  }, [refresh]);

  const togglePlugin = useCallback(async (pluginName: string, enabled: boolean) => {
    try {
      await invoke("plugin_toggle", { pluginName, enabled });
      setError(null);
      void refresh();
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to update plugin state");
    }
  }, [refresh]);

  const planNextMissionStage = useCallback(async (mission: OperatorMission) => {
    try {
      const plan = await invoke<PlannedMissionStage | null>("runtime_plan_next_mission_stage", {
        mission,
      });
      setError(null);
      return plan;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to plan next mission stage");
      return null;
    }
  }, []);

  const continueMission = useCallback(async (mission: OperatorMission) => {
    try {
      const graph = await invoke<TaskGraph | null>("runtime_continue_mission", { mission });
      if (graph) {
        setTasks((prev) => upsertTask(prev, taskFromGraph(graph)));
      }
      setError(null);
      void refresh();
      return graph;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to continue mission");
      return null;
    }
  }, [refresh]);

  const runMission = useCallback(async (mission: OperatorMission, maxStages = 8) => {
    try {
      const result = await invoke<MissionRunResult>("runtime_run_mission", { mission, maxStages });
      if (result.launched.length > 0) {
        setTasks((prev) =>
          result.launched.reduce((acc, graph) => upsertTask(acc, taskFromGraph(graph)), prev)
        );
      }
      setError(null);
      void refresh();
      return result;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to run mission");
      return null;
    }
  }, [refresh]);

  useEffect(() => {
    if (bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;

    const unlistenMessage = listen<RuntimeMessageEvent>("runtime_message", (event) => {
      if (!active) return;
      const payload = event.payload;
      setTasks((prev) =>
        patchTask(prev, payload.taskId, (task) => ({
          ...task,
          runtimeId: payload.runtimeId || task.runtimeId,
          sessionId: payload.sessionId ?? task.sessionId,
          messages: [...task.messages, payload],
        }))
      );
    });

    const unlistenState = listen<RuntimeStateChangedEvent>("runtime_state_changed", (event) => {
      if (!active) return;
      const payload = event.payload;
      setTasks((prev) =>
        patchTask(prev, payload.taskId, (task) => ({
          ...task,
          runtimeId: payload.runtimeId || task.runtimeId,
          status: payload.status,
          sessionId: payload.sessionId ?? task.sessionId,
          error: payload.error ?? task.error,
          session:
            payload.sessionId || task.sessionId
              ? {
                  runtime_id: payload.runtimeId || task.runtimeId,
                  session_id: payload.sessionId ?? task.sessionId ?? "",
                  cwd: task.session?.cwd ?? null,
                  title: task.session?.title ?? task.goal,
                  resumable: true,
                  last_active_at: Date.now(),
                }
              : task.session,
        }))
      );
      void refresh();
    });

    const unlistenCheckpoint = listen<TaskCheckpointEvent>("task_checkpoint", (event) => {
      if (!active) return;
      const payload = event.payload;
      setTasks((prev) =>
        patchTask(prev, payload.taskId, (task) => ({
          ...task,
          runtimeId: payload.runtimeId || task.runtimeId,
          checkpoints: [...task.checkpoints, payload.checkpoint],
        }))
      );
    });

    const unlistenDone = listen<TaskDoneEvent>("task_done", (event) => {
      if (!active) return;
      const payload = event.payload;
      setTasks((prev) =>
        patchTask(prev, payload.taskId, (task) => ({
          ...task,
          runtimeId: payload.runtimeId || task.runtimeId,
          status: payload.status,
          sessionId: payload.sessionId ?? task.sessionId,
          error: payload.error ?? task.error,
          summary: payload.summary ?? task.summary,
        }))
      );
      void refresh();
    });

    return () => {
      active = false;
      unlistenMessage.then((fn) => fn());
      unlistenState.then((fn) => fn());
      unlistenCheckpoint.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, [refresh]);

  const startTask = useCallback(
    async (runtimeId: string, goal: string, options: RuntimeLaunchOptions = {}) => {
      if (!goal.trim()) return null;
      try {
        const graph = await invoke<TaskGraph>("runtime_start_task", {
          runtimeId,
          goal: goal.trim(),
          cwd: options.cwd || null,
          sessionId: options.sessionId || null,
          operatorType: options.operatorType || null,
          preferredSubstrate: options.preferredSubstrate || null,
          securityEngagementId: options.securityEngagementId || null,
          missionId: options.missionId || null,
          stageId: options.stageId || null,
          parentTaskId: options.parentTaskId || null,
          handoffNote: options.handoffNote || null,
          model: options.model || null,
          permissionMode: options.permissionMode || null,
          maxTurns: options.maxTurns || null,
          tools: options.tools || null,
        });
        setTasks((prev) => upsertTask(prev, taskFromGraph(graph)));
        setError(null);
        void refresh();
        return graph;
      } catch (cause) {
        setError(typeof cause === "string" ? cause : "Failed to start runtime task");
        return null;
      }
    },
    [refresh]
  );

  const resumeSession = useCallback(
    async (
      runtimeId: string,
      sessionId: string,
      goal: string,
      options: RuntimeLaunchOptions = {}
    ) => {
      if (!goal.trim() || !sessionId.trim()) return null;
      try {
        const graph = await invoke<TaskGraph>("runtime_resume_session", {
          runtimeId,
          sessionId,
          goal: goal.trim(),
          cwd: options.cwd || null,
          operatorType: options.operatorType || null,
          preferredSubstrate: options.preferredSubstrate || null,
          securityEngagementId: options.securityEngagementId || null,
          missionId: options.missionId || null,
          stageId: options.stageId || null,
          parentTaskId: options.parentTaskId || null,
          handoffNote: options.handoffNote || null,
          model: options.model || null,
          permissionMode: options.permissionMode || null,
          maxTurns: options.maxTurns || null,
          tools: options.tools || null,
        });
        setTasks((prev) => upsertTask(prev, taskFromGraph(graph)));
        setError(null);
        void refresh();
        return graph;
      } catch (cause) {
        setError(typeof cause === "string" ? cause : "Failed to resume runtime session");
        return null;
      }
    },
    [refresh]
  );

  const stopTask = useCallback(
    async (taskId: string) => {
      try {
        await invoke("runtime_stop_task", { taskId });
        setTasks((prev) =>
          patchTask(prev, taskId, (task) => ({
            ...task,
            status: "cancelled",
          }))
        );
        setError(null);
        void refresh();
      } catch (cause) {
        setError(typeof cause === "string" ? cause : "Failed to stop runtime task");
      }
    },
    [refresh]
  );

  const prepareInstall = useCallback(async (runtimeId: string) => {
    try {
      const requirement = await invoke<InstallRequirement>("runtime_prepare_install", {
        runtimeId,
      });
      setError(null);
      return requirement;
    } catch (cause) {
      setError(typeof cause === "string" ? cause : "Failed to load install instructions");
      return null;
    }
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  const sortedTasks = useMemo(
    () => tasks.slice().sort((a, b) => {
      const aTs = a.checkpoints[a.checkpoints.length - 1]?.timestamp ?? 0;
      const bTs = b.checkpoints[b.checkpoints.length - 1]?.timestamp ?? 0;
      return bTs - aTs;
    }),
    [tasks]
  );

  return {
    runtimes,
    tasks: sortedTasks,
    missions,
    companyObjects,
    securityEngagements,
    capabilityBlueprints,
    installedPlugins,
    pluginCommands,
    loading,
    error,
    refresh,
    refreshSessions,
    startServer,
    stopServer,
    recommendRoute,
    designMission,
    saveMission,
    saveCompanyObject,
    createSecurityEngagement,
    verifySecurityEngagement,
    togglePlugin,
    planNextMissionStage,
    continueMission,
    runMission,
    startTask,
    resumeSession,
    stopTask,
    prepareInstall,
    dismissError,
  };
}
