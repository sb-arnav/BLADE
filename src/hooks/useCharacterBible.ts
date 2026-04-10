// src/hooks/useCharacterBible.ts
// Unified hook for all Brain (Character Bible) state + operations.

import { useCallback, useEffect, useState } from "react";
import * as cb from "../data/characterBible";
import { BrainEdge, BrainMemory, BrainNode, BrainPreference, BrainSkill } from "../types";

export interface CharacterBibleState {
  identity: Record<string, string>;
  styleTags: string[];
  preferences: BrainPreference[];
  memories: BrainMemory[];
  nodes: BrainNode[];
  edges: BrainEdge[];
  skills: BrainSkill[];
  loading: boolean;
  lastUpdated: number | null;
}

export interface UseCharacterBibleResult extends CharacterBibleState {
  refresh: () => Promise<void>;
  setIdentityField: (key: string, value: string) => Promise<void>;
  addStyleTag: (tag: string) => Promise<void>;
  removeStyleTag: (id: string) => Promise<void>;
  upsertPreference: (id: string, text: string, confidence: number, source: "feedback" | "manual") => Promise<void>;
  deletePreference: (id: string) => Promise<void>;
  addMemory: (text: string, sourceConversationId: string, entities?: string[], confidence?: number) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  clearMemories: () => Promise<void>;
  upsertNode: (label: string, kind: BrainNode["kind"], summary?: string) => Promise<void>;
  deleteNode: (id: string) => Promise<void>;
  upsertEdge: (fromId: string, toId: string, label: string) => Promise<void>;
  upsertSkill: (id: string, name: string, triggerPattern: string, promptModifier: string, tools?: string[]) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  setSkillActive: (id: string, active: boolean) => Promise<void>;
  react: (messageId: string, polarity: 1 | -1, content: string) => Promise<void>;
  detectPreferences: () => Promise<void>;
}

export function useCharacterBible(): UseCharacterBibleResult {
  const [state, setState] = useState<CharacterBibleState>({
    identity: {},
    styleTags: [],
    preferences: [],
    memories: [],
    nodes: [],
    edges: [],
    skills: [],
    loading: true,
    lastUpdated: null,
  });

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const [identity, styleTags, preferences, memories, nodes, edges, skills] = await Promise.all([
      cb.getIdentity(),
      cb.getStyleTags(),
      cb.getPreferences(),
      cb.getMemories(100),
      cb.getNodes(),
      cb.getEdges(),
      cb.getSkills(),
    ]);
    setState({ identity, styleTags, preferences, memories, nodes, edges, skills, loading: false, lastUpdated: Date.now() });
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const setIdentityField = useCallback(async (key: string, value: string) => {
    await cb.setIdentity(key, value);
    setState((s) => ({ ...s, identity: { ...s.identity, [key]: value }, lastUpdated: Date.now() }));
  }, []);

  const addStyleTag = useCallback(async (tag: string) => {
    await cb.addStyleTag(tag);
    const styleTags = await cb.getStyleTags();
    setState((s) => ({ ...s, styleTags, lastUpdated: Date.now() }));
  }, []);

  const removeStyleTag = useCallback(async (id: string) => {
    await cb.removeStyleTag(id);
    const styleTags = await cb.getStyleTags();
    setState((s) => ({ ...s, styleTags, lastUpdated: Date.now() }));
  }, []);

  const upsertPreference = useCallback(async (id: string, text: string, confidence: number, source: "feedback" | "manual") => {
    await cb.upsertPreference(id, text, confidence, source);
    const preferences = await cb.getPreferences();
    setState((s) => ({ ...s, preferences, lastUpdated: Date.now() }));
  }, []);

  const deletePreference = useCallback(async (id: string) => {
    await cb.deletePreference(id);
    setState((s) => ({ ...s, preferences: s.preferences.filter((p) => p.id !== id), lastUpdated: Date.now() }));
  }, []);

  const addMemory = useCallback(async (text: string, sourceConversationId: string, entities: string[] = [], confidence = 0.7) => {
    await cb.addMemory(text, sourceConversationId, entities, confidence);
    const memories = await cb.getMemories(100);
    setState((s) => ({ ...s, memories, lastUpdated: Date.now() }));
  }, []);

  const deleteMemory = useCallback(async (id: string) => {
    await cb.deleteMemory(id);
    setState((s) => ({ ...s, memories: s.memories.filter((m) => m.id !== id), lastUpdated: Date.now() }));
  }, []);

  const clearMemories = useCallback(async () => {
    await cb.clearMemories();
    setState((s) => ({ ...s, memories: [], lastUpdated: Date.now() }));
  }, []);

  const upsertNode = useCallback(async (label: string, kind: BrainNode["kind"], summary = "") => {
    await cb.upsertNode(label, kind, summary);
    const nodes = await cb.getNodes();
    setState((s) => ({ ...s, nodes, lastUpdated: Date.now() }));
  }, []);

  const deleteNode = useCallback(async (id: string) => {
    await cb.deleteNode(id);
    const [nodes, edges] = await Promise.all([cb.getNodes(), cb.getEdges()]);
    setState((s) => ({ ...s, nodes, edges, lastUpdated: Date.now() }));
  }, []);

  const upsertEdge = useCallback(async (fromId: string, toId: string, label: string) => {
    await cb.upsertEdge(fromId, toId, label);
    const edges = await cb.getEdges();
    setState((s) => ({ ...s, edges, lastUpdated: Date.now() }));
  }, []);

  const upsertSkill = useCallback(async (id: string, name: string, triggerPattern: string, promptModifier: string, tools: string[] = []) => {
    await cb.upsertSkill(id, name, triggerPattern, promptModifier, tools);
    const skills = await cb.getSkills();
    setState((s) => ({ ...s, skills, lastUpdated: Date.now() }));
  }, []);

  const deleteSkill = useCallback(async (id: string) => {
    await cb.deleteSkill(id);
    setState((s) => ({ ...s, skills: s.skills.filter((sk) => sk.id !== id), lastUpdated: Date.now() }));
  }, []);

  const setSkillActive = useCallback(async (id: string, active: boolean) => {
    await cb.setSkillActive(id, active);
    setState((s) => ({
      ...s,
      skills: s.skills.map((sk) => (sk.id === id ? { ...sk, active } : sk)),
      lastUpdated: Date.now(),
    }));
  }, []);

  // Add reaction and run pattern detection if ≥5 reactions accumulated
  const react = useCallback(async (messageId: string, polarity: 1 | -1, content: string) => {
    await cb.addReaction(messageId, polarity, content);
  }, []);

  // Pattern detection: derive preferences from reaction history
  const detectPreferences = useCallback(async () => {
    const reactions = await cb.getReactions(200);
    if (reactions.length < 5) return;

    const positive = reactions.filter((r) => r.polarity === 1);
    const negative = reactions.filter((r) => r.polarity === -1);

    // Simple heuristic: measure average response length for pos vs neg
    const avgLen = (rs: typeof reactions) =>
      rs.length === 0 ? 0 : rs.reduce((sum, r) => sum + r.content.length, 0) / rs.length;

    const posLen = avgLen(positive);
    const negLen = avgLen(negative);

    const derived: Array<{ text: string; confidence: number }> = [];

    if (positive.length >= 3 && negative.length >= 2) {
      if (posLen < negLen * 0.7) {
        derived.push({ text: "prefers concise, short responses", confidence: 0.72 });
      } else if (posLen > negLen * 1.3) {
        derived.push({ text: "prefers detailed, thorough responses", confidence: 0.72 });
      }
    }

    // Check bullet list preference
    const posBullets = positive.filter((r) => r.content.includes("\n-") || r.content.includes("\n•")).length;
    const negBullets = negative.filter((r) => r.content.includes("\n-") || r.content.includes("\n•")).length;
    const posBulletRatio = positive.length ? posBullets / positive.length : 0;
    const negBulletRatio = negative.length ? negBullets / negative.length : 0;

    if (posBulletRatio > 0.5 && posBulletRatio > negBulletRatio + 0.2) {
      derived.push({ text: "prefers bullet lists over dense prose", confidence: 0.78 });
    }

    // Write derived preferences (only new ones)
    const existing = await cb.getPreferences();
    const existingTexts = new Set(existing.filter((p) => p.source === "feedback").map((p) => p.text));

    for (const d of derived) {
      if (!existingTexts.has(d.text)) {
        await cb.upsertPreference(crypto.randomUUID(), d.text, d.confidence, "feedback");
      }
    }

    const preferences = await cb.getPreferences();
    setState((s) => ({ ...s, preferences, lastUpdated: Date.now() }));
  }, []);

  return {
    ...state,
    refresh,
    setIdentityField,
    addStyleTag,
    removeStyleTag,
    upsertPreference,
    deletePreference,
    addMemory,
    deleteMemory,
    clearMemories,
    upsertNode,
    deleteNode,
    upsertEdge,
    upsertSkill,
    deleteSkill,
    setSkillActive,
    react,
    detectPreferences,
  };
}
