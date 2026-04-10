// src/lib/missionSpec.ts
// Mission DSL helpers: load/save specs, render goal templates, convert to OperatorMission.

import { invoke } from "@tauri-apps/api/core";
import { MissionSpec, MissionStageSpec, OperatorMission, MissionStage, RuntimeRouteRecommendation } from "../types";

// ── Remote CRUD ──────────────────────────────────────────────────────────────

export async function listMissionSpecs(): Promise<MissionSpec[]> {
  const raw = await invoke<unknown[]>("list_mission_specs");
  return raw as MissionSpec[];
}

export async function saveMissionSpec(spec: MissionSpec): Promise<void> {
  await invoke("save_mission_spec", { spec });
}

export async function deleteMissionSpec(id: string): Promise<void> {
  await invoke("delete_mission_spec", { id });
}

// ── Template rendering ───────────────────────────────────────────────────────

export function renderGoal(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ── Runtime hint → route recommendation ─────────────────────────────────────

function runtimeHintToRoute(hint: string | undefined): RuntimeRouteRecommendation {
  const runtimeId = (() => {
    switch (hint) {
      case "claude-code": return "claude-code";
      case "browser-use": return "browser-use";
      case "tavily": return "tavily-backend";
      case "open-interpreter": return "open-interpreter";
      case "aider": return "aider-cli";
      case "codex": return "codex-cli";
      default: return "blade-native";
    }
  })();
  return {
    runtime_id: runtimeId,
    operator_type: "autonomous",
    preferred_substrate: null,
    rationale: hint ?? "general purpose",
    confidence: 0.8,
    prefers_warm_runtime: false,
  };
}

// ── Convert MissionSpec + vars → OperatorMission ────────────────────────────

export function specToOperatorMission(
  spec: MissionSpec,
  vars: Record<string, string>
): OperatorMission {
  const stages: MissionStage[] = spec.stages.map((s: MissionStageSpec) => ({
    id: s.id,
    title: s.title,
    goal: renderGoal(s.goalTemplate, vars),
    depends_on: s.dependsOn ?? [],
    runtime: runtimeHintToRoute(s.runtimeHint),
  }));

  const goal = renderGoal(spec.stages[0]?.goalTemplate ?? spec.description, vars);

  return {
    id: `${spec.id}-${Date.now()}`,
    goal,
    summary: renderGoal(spec.description, vars),
    stages,
  };
}

// ── Validate that all inputVars are filled ───────────────────────────────────

export function missingVars(spec: MissionSpec, vars: Record<string, string>): string[] {
  return spec.inputVars.filter((v) => !vars[v]?.trim());
}
