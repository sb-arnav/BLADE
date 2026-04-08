import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface WritingVersion {
  id: string;
  content: string;
  savedAt: number;
  label: string;
}

export interface WritingProject {
  id: string;
  title: string;
  content: string;           // markdown
  type: "blog" | "docs" | "email" | "essay" | "script" | "notes" | "custom";
  wordCount: number;
  targetWordCount: number | null;
  status: "draft" | "review" | "final" | "published";
  outline: string[];
  versions: WritingVersion[];
  createdAt: number;
  updatedAt: number;
  tags: string[];
  aiSuggestions: string[];
}

export interface WritingStats {
  totalProjects: number;
  totalWords: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  avgWordCount: number;
  longestProject: { title: string; words: number } | null;
}

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-writing-projects";
const AUTO_SAVE_MS = 30_000; // 30 seconds
const MAX_VERSIONS = 50;

// ── Helpers ────────────────────────────────────────────────────────────

function generateId(): string {
  return `wp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function loadProjects(): WritingProject[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistProjects(projects: WritingProject[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

// ── AI prompt builders ─────────────────────────────────────────────────
// These build prompts that can be sent to the chat AI for processing.
// In a real integration, these would call the model directly; here they
// return structured suggestion strings for the UI to relay via onSendToChat.

function buildSuggestionsPrompt(project: WritingProject): string {
  const snippet = project.content.slice(0, 2000);
  return (
    `Analyze this ${project.type} titled "${project.title}" and suggest 3-5 specific improvements ` +
    `for clarity, structure, engagement, and tone. Be concise — one sentence each.\n\n` +
    `---\n${snippet}\n---`
  );
}

function buildExpandOutlinePrompt(project: WritingProject): string {
  const outlineText = project.outline.map((item, i) => `${i + 1}. ${item}`).join("\n");
  return (
    `Expand each outline section below into a 2-3 sentence draft paragraph for a ${project.type} ` +
    `titled "${project.title}". Keep the same numbered structure.\n\n${outlineText}`
  );
}

function buildImprovePrompt(text: string): string {
  return (
    `Improve the following text for clarity, grammar, and professional tone. ` +
    `Return only the improved version, no commentary.\n\n---\n${text}\n---`
  );
}

function buildProofreadPrompt(text: string): string {
  return (
    `Proofread the following text. List each error found with the original text, ` +
    `the correction, and a brief explanation. If no errors, say "No errors found."\n\n---\n${text}\n---`
  );
}

function buildContinuePrompt(project: WritingProject): string {
  const last500 = project.content.slice(-500);
  return (
    `Continue writing the next paragraph for this ${project.type} titled "${project.title}". ` +
    `Match the existing tone and style. Here is the end of the current text:\n\n---\n${last500}\n---`
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useWritingStudio() {
  const [projects, setProjects] = useState<WritingProject[]>(loadProjects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dirtyRef = useRef(false);

  // Persist on change
  useEffect(() => {
    persistProjects(projects);
  }, [projects]);

  // Active project derived
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  // ── Auto-save ─────────────────────────────────────────────────────────

  useEffect(() => {
    autoSaveTimer.current = setInterval(() => {
      if (dirtyRef.current && activeProjectId) {
        dirtyRef.current = false;
        setLastSaved(Date.now());
        // projects already persisted via useEffect above
      }
    }, AUTO_SAVE_MS);

    return () => {
      if (autoSaveTimer.current) clearInterval(autoSaveTimer.current);
    };
  }, [activeProjectId]);

  // ── CRUD ──────────────────────────────────────────────────────────────

  const createProject = useCallback(
    (partial: Pick<WritingProject, "title" | "type"> & Partial<WritingProject>) => {
      const now = Date.now();
      const project: WritingProject = {
        id: generateId(),
        content: "",
        wordCount: 0,
        targetWordCount: null,
        status: "draft",
        outline: [],
        versions: [],
        createdAt: now,
        updatedAt: now,
        tags: [],
        aiSuggestions: [],
        ...partial,
      };
      setProjects((prev) => [project, ...prev]);
      setActiveProjectId(project.id);
      return project;
    },
    [],
  );

  const updateProject = useCallback(
    (id: string, changes: Partial<WritingProject>) => {
      dirtyRef.current = true;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const updated = { ...p, ...changes, updatedAt: Date.now() };
          // Auto-update word count when content changes
          if (changes.content !== undefined) {
            updated.wordCount = countWords(changes.content);
          }
          return updated;
        }),
      );
    },
    [],
  );

  const deleteProject = useCallback(
    (id: string) => {
      setProjects((prev) => prev.filter((p) => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
      }
    },
    [activeProjectId],
  );

  const setActiveProject = useCallback((id: string | null) => {
    setActiveProjectId(id);
    dirtyRef.current = false;
  }, []);

  // ── Version management ────────────────────────────────────────────────

  const saveVersion = useCallback(
    (projectId: string, label?: string) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const version: WritingVersion = {
            id: generateId(),
            content: p.content,
            savedAt: Date.now(),
            label: label || `v${p.versions.length + 1}`,
          };
          const versions = [...p.versions, version].slice(-MAX_VERSIONS);
          return { ...p, versions, updatedAt: Date.now() };
        }),
      );
      setLastSaved(Date.now());
    },
    [],
  );

  const restoreVersion = useCallback(
    (projectId: string, versionId: string) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const version = p.versions.find((v) => v.id === versionId);
          if (!version) return p;
          return {
            ...p,
            content: version.content,
            wordCount: countWords(version.content),
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [],
  );

  // ── AI features (return prompts for chat relay) ──────────────────────

  const getAISuggestions = useCallback(
    (projectId: string): string | null => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || !project.content.trim()) return null;
      return buildSuggestionsPrompt(project);
    },
    [projects],
  );

  const expandOutline = useCallback(
    (projectId: string): string | null => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || project.outline.length === 0) return null;
      return buildExpandOutlinePrompt(project);
    },
    [projects],
  );

  const improveSection = useCallback((text: string): string | null => {
    if (!text.trim()) return null;
    return buildImprovePrompt(text);
  }, []);

  const proofread = useCallback((text: string): string | null => {
    if (!text.trim()) return null;
    return buildProofreadPrompt(text);
  }, []);

  const continueWriting = useCallback(
    (projectId: string): string | null => {
      const project = projects.find((p) => p.id === projectId);
      if (!project || !project.content.trim()) return null;
      return buildContinuePrompt(project);
    },
    [projects],
  );

  // ── Stats ─────────────────────────────────────────────────────────────

  const stats: WritingStats = useMemo(() => {
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalWords = 0;
    let longest: { title: string; words: number } | null = null;

    for (const p of projects) {
      byType[p.type] = (byType[p.type] ?? 0) + 1;
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      totalWords += p.wordCount;
      if (!longest || p.wordCount > longest.words) {
        longest = { title: p.title, words: p.wordCount };
      }
    }

    return {
      totalProjects: projects.length,
      totalWords,
      byType,
      byStatus,
      avgWordCount: projects.length > 0 ? Math.round(totalWords / projects.length) : 0,
      longestProject: longest,
    };
  }, [projects]);

  return {
    projects,
    activeProject,
    createProject,
    updateProject,
    deleteProject,
    saveVersion,
    restoreVersion,
    setActiveProject,
    getAISuggestions,
    expandOutline,
    improveSection,
    proofread,
    continueWriting,
    stats,
    lastSaved,
  };
}
