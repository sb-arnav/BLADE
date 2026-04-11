// src/data/characterBible.ts
// SQLite CRUD layer for the Character Bible — all calls go through Tauri invoke().

import { invoke } from "@tauri-apps/api/core";
import {
  BrainEdge,
  BrainMemory,
  BrainNode,
  BrainPreference,
  BrainReaction,
  BrainSkill,
  BrainStyleTag,
} from "../types";

// ── Identity ──────────────────────────────────────────────────────────────────

export async function getIdentity(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("brain_get_identity").catch(() => ({}));
}

export async function setIdentity(key: string, value: string): Promise<void> {
  return invoke("brain_set_identity", { key, value });
}

// ── Style tags ────────────────────────────────────────────────────────────────

export async function getStyleTags(): Promise<string[]> {
  return invoke<string[]>("brain_get_style_tags").catch(() => []);
}

export async function getStyleTagEntries(): Promise<BrainStyleTag[]> {
  return invoke<BrainStyleTag[]>("brain_get_style_tag_entries").catch(() => []);
}

export async function addStyleTag(tag: string): Promise<void> {
  const id = crypto.randomUUID();
  return invoke("brain_add_style_tag", { id, tag });
}

export async function removeStyleTag(id: string): Promise<void> {
  return invoke("brain_remove_style_tag", { id });
}

// ── Preferences ───────────────────────────────────────────────────────────────

export async function getPreferences(): Promise<BrainPreference[]> {
  return invoke<BrainPreference[]>("brain_get_preferences").catch(() => []);
}

export async function upsertPreference(
  id: string,
  text: string,
  confidence: number,
  source: "feedback" | "manual"
): Promise<void> {
  return invoke("brain_upsert_preference", { id, text, confidence, source });
}

export async function deletePreference(id: string): Promise<void> {
  return invoke("brain_delete_preference", { id });
}

// ── Memories ──────────────────────────────────────────────────────────────────

export async function getMemories(limit = 50): Promise<BrainMemory[]> {
  return invoke<BrainMemory[]>("brain_get_memories", { limit }).catch(() => []);
}

export async function addMemory(
  text: string,
  sourceConversationId: string,
  entities: string[],
  confidence = 0.7,
  expiresAt?: number
): Promise<void> {
  const id = crypto.randomUUID();
  return invoke("brain_add_memory", {
    id,
    text,
    sourceConversationId,
    entitiesJson: JSON.stringify(entities),
    confidence,
    expiresAt: expiresAt ?? null,
  });
}

export async function deleteMemory(id: string): Promise<void> {
  return invoke("brain_delete_memory", { id });
}

export async function clearMemories(): Promise<void> {
  return invoke("brain_clear_memories");
}

// ── Knowledge graph ───────────────────────────────────────────────────────────

export async function getNodes(): Promise<BrainNode[]> {
  return invoke<BrainNode[]>("brain_get_nodes").catch(() => []);
}

export async function upsertNode(
  label: string,
  kind: BrainNode["kind"],
  summary = ""
): Promise<void> {
  // Deterministic ID: kind + normalised label
  const id = `${kind}:${label.toLowerCase().replace(/\s+/g, "-")}`;
  return invoke("brain_upsert_node", { id, label, kind, summary });
}

export async function deleteNode(id: string): Promise<void> {
  return invoke("brain_delete_node", { id });
}

export async function getEdges(): Promise<BrainEdge[]> {
  return invoke<BrainEdge[]>("brain_get_edges").catch(() => []);
}

export async function upsertEdge(
  fromId: string,
  toId: string,
  label: string
): Promise<void> {
  const id = `${fromId}|${toId}|${label}`;
  return invoke("brain_upsert_edge", { id, fromId, toId, label });
}

// ── Skills ────────────────────────────────────────────────────────────────────

export async function getSkills(): Promise<BrainSkill[]> {
  return invoke<BrainSkill[]>("brain_get_skills").catch(() => []);
}

export async function upsertSkill(
  id: string,
  name: string,
  triggerPattern: string,
  promptModifier: string,
  tools: string[] = []
): Promise<void> {
  return invoke("brain_upsert_skill", {
    id,
    name,
    triggerPattern,
    promptModifier,
    toolsJson: JSON.stringify(tools),
  });
}

export async function deleteSkill(id: string): Promise<void> {
  return invoke("brain_delete_skill", { id });
}

export async function setSkillActive(id: string, active: boolean): Promise<void> {
  return invoke("brain_set_skill_active", { id, active });
}

// ── Reactions ─────────────────────────────────────────────────────────────────

export async function addReaction(
  messageId: string,
  polarity: 1 | -1,
  content: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  const id = crypto.randomUUID();
  return invoke("brain_add_reaction", {
    id,
    messageId,
    polarity,
    content,
    contextJson: JSON.stringify(context),
  });
}

export async function getReactions(limit = 100): Promise<BrainReaction[]> {
  return invoke<BrainReaction[]>("brain_get_reactions", { limit }).catch(() => []);
}

// ── Context (for system prompt) ───────────────────────────────────────────────

export async function getBrainContext(budgetTokens = 700): Promise<string> {
  return invoke<string>("brain_get_context", { budgetTokens }).catch(() => "");
}
