import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskStatus = "backlog" | "todo" | "in-progress" | "review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskComment {
  id: string;
  content: string;
  author: string;
  timestamp: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  assignee: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  subtasks: Subtask[];
  comments: TaskComment[];
  attachments: string[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  order: number;
  parentId: string | null;
  projectId: string;
}

export interface TaskProject {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  columns: string[];
  createdAt: number;
}

export interface TaskStats {
  total: number;
  completed: number;
  overdue: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  completionRate: number;
  avgCompletionTime: number;
}

export interface GeneratedTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
  estimatedHours: number | null;
  subtasks: string[];
  labels: string[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const TASKS_KEY = "blade-tasks";
const PROJECTS_KEY = "blade-task-projects";
const ACTIVE_PROJECT_KEY = "blade-task-active-project";

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  "in-progress": "In Progress",
  review: "Review",
  done: "Done",
};

const STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "todo",
  "in-progress",
  "review",
  "done",
];

const DEFAULT_PROJECT: TaskProject = {
  id: "personal",
  name: "Personal",
  icon: "user",
  color: "#6366f1",
  description: "Default personal project",
  columns: ["Backlog", "Todo", "In Progress", "Review", "Done"],
  createdAt: Date.now(),
};

const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function loadProjects(): TaskProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [DEFAULT_PROJECT];
    const parsed: TaskProject[] = JSON.parse(raw);
    // Ensure default project always exists
    if (!parsed.find((p) => p.id === "personal")) {
      parsed.unshift(DEFAULT_PROJECT);
    }
    return parsed;
  } catch {
    return [DEFAULT_PROJECT];
  }
}

function saveProjects(projects: TaskProject[]): void {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

function loadActiveProjectId(): string {
  return localStorage.getItem(ACTIVE_PROJECT_KEY) || "personal";
}

function saveActiveProjectId(id: string): void {
  localStorage.setItem(ACTIVE_PROJECT_KEY, id);
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate || task.status === "done") return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

function nextOrder(tasks: Task[], status: TaskStatus, projectId: string): number {
  const inColumn = tasks.filter(
    (t) => t.status === status && t.projectId === projectId,
  );
  if (inColumn.length === 0) return 0;
  return Math.max(...inColumn.map((t) => t.order)) + 1;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useTaskPlanner() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [projects, setProjects] = useState<TaskProject[]>(loadProjects);
  const [activeProjectId, setActiveProjectIdRaw] = useState<string>(
    loadActiveProjectId,
  );

  // ── Persist ──────────────────────────────────────────────────────────

  useEffect(() => { saveTasks(tasks); }, [tasks]);
  useEffect(() => { saveProjects(projects); }, [projects]);
  useEffect(() => { saveActiveProjectId(activeProjectId); }, [activeProjectId]);

  // ── Derived ──────────────────────────────────────────────────────────

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? projects[0],
    [projects, activeProjectId],
  );

  const projectTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.projectId === activeProjectId)
        .sort((a, b) => a.order - b.order),
    [tasks, activeProjectId],
  );

  // ── Project CRUD ─────────────────────────────────────────────────────

  const setActiveProject = useCallback((id: string) => {
    setActiveProjectIdRaw(id);
  }, []);

  const createProject = useCallback(
    (
      name: string,
      opts?: { icon?: string; color?: string; description?: string },
    ): TaskProject => {
      const project: TaskProject = {
        id: uid(),
        name,
        icon: opts?.icon ?? "folder",
        color: opts?.color ?? "#6366f1",
        description: opts?.description ?? "",
        columns: ["Backlog", "Todo", "In Progress", "Review", "Done"],
        createdAt: Date.now(),
      };
      setProjects((prev) => [...prev, project]);
      return project;
    },
    [],
  );

  const deleteProject = useCallback(
    (id: string) => {
      if (id === "personal") return; // Cannot delete default
      setProjects((prev) => prev.filter((p) => p.id !== id));
      setTasks((prev) => prev.filter((t) => t.projectId !== id));
      if (activeProjectId === id) setActiveProjectIdRaw("personal");
    },
    [activeProjectId],
  );

  // ── Task CRUD ────────────────────────────────────────────────────────

  const createTask = useCallback(
    (
      title: string,
      opts?: Partial<
        Pick<
          Task,
          | "description"
          | "status"
          | "priority"
          | "labels"
          | "assignee"
          | "dueDate"
          | "estimatedHours"
          | "parentId"
          | "projectId"
        >
      >,
    ): Task => {
      const status = opts?.status ?? "todo";
      const projId = opts?.projectId ?? activeProjectId;
      const task: Task = {
        id: uid(),
        title,
        description: opts?.description ?? "",
        status,
        priority: opts?.priority ?? "medium",
        labels: opts?.labels ?? [],
        assignee: opts?.assignee ?? null,
        dueDate: opts?.dueDate ?? null,
        estimatedHours: opts?.estimatedHours ?? null,
        actualHours: null,
        subtasks: [],
        comments: [],
        attachments: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        completedAt: null,
        order: nextOrder(tasks, status, projId),
        parentId: opts?.parentId ?? null,
        projectId: projId,
      };
      setTasks((prev) => [...prev, task]);
      return task;
    },
    [tasks, activeProjectId],
  );

  const updateTask = useCallback(
    (id: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const updated = { ...t, ...updates, updatedAt: Date.now() };
          // Auto-set completedAt when moved to done
          if (updates.status === "done" && t.status !== "done") {
            updated.completedAt = Date.now();
          } else if (updates.status && updates.status !== "done") {
            updated.completedAt = null;
          }
          return updated;
        }),
      );
    },
    [],
  );

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id && t.parentId !== id));
  }, []);

  const moveTask = useCallback(
    (taskId: string, newStatus: TaskStatus, newOrder?: number) => {
      setTasks((prev) => {
        const idx = prev.findIndex((t) => t.id === taskId);
        if (idx === -1) return prev;
        const task = prev[idx];
        const order =
          newOrder ??
          nextOrder(prev, newStatus, task.projectId);
        const completedAt =
          newStatus === "done" && task.status !== "done"
            ? Date.now()
            : newStatus !== "done"
              ? null
              : task.completedAt;
        const copy = [...prev];
        copy[idx] = {
          ...task,
          status: newStatus,
          order,
          updatedAt: Date.now(),
          completedAt,
        };
        return copy;
      });
    },
    [],
  );

  // ── Subtasks ─────────────────────────────────────────────────────────

  const addSubtask = useCallback(
    (taskId: string, title: string) => {
      const sub: Subtask = { id: uid(), title, completed: false };
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, subtasks: [...t.subtasks, sub], updatedAt: Date.now() }
            : t,
        ),
      );
      return sub;
    },
    [],
  );

  const toggleSubtask = useCallback(
    (taskId: string, subtaskId: string) => {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== taskId) return t;
          return {
            ...t,
            subtasks: t.subtasks.map((s) =>
              s.id === subtaskId ? { ...s, completed: !s.completed } : s,
            ),
            updatedAt: Date.now(),
          };
        }),
      );
    },
    [],
  );

  // ── Comments ─────────────────────────────────────────────────────────

  const addComment = useCallback(
    (taskId: string, content: string, author = "You") => {
      const comment: TaskComment = {
        id: uid(),
        content,
        author,
        timestamp: Date.now(),
      };
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                comments: [...t.comments, comment],
                updatedAt: Date.now(),
              }
            : t,
        ),
      );
      return comment;
    },
    [],
  );

  // ── AI Generation ────────────────────────────────────────────────────

  const generateTasksFromPrompt = useCallback(
    (prompt: string): GeneratedTaskDraft[] => {
      // Heuristic task decomposition — no external API call, parses the prompt
      // and generates structured task drafts from it.
      const lines = prompt
        .split(/\n|;|,\s*(?=and )|,\s*(?=[A-Z])/)
        .map((l) => l.trim())
        .filter(Boolean);

      const keywords = prompt.toLowerCase();
      const isLargeProject =
        keywords.includes("app") ||
        keywords.includes("website") ||
        keywords.includes("platform") ||
        keywords.includes("system");

      if (lines.length <= 1 && isLargeProject) {
        // Generate a standard breakdown for larger project prompts
        return generateProjectBreakdown(prompt);
      }

      return lines.map((line) => {
        const priority = guessPriority(line);
        const hours = guessHours(line);
        const subtasks = guessSubtasks(line);
        return {
          title: cleanTitle(line),
          description: `Generated from: "${line}"`,
          priority,
          estimatedHours: hours,
          subtasks,
          labels: guessLabels(line),
        };
      });
    },
    [],
  );

  // ── Stats ────────────────────────────────────────────────────────────

  const getStats = useCallback((): TaskStats => {
    const pt = projectTasks;
    const completed = pt.filter((t) => t.status === "done");
    const overdue = pt.filter(isOverdue);

    const byStatus: Record<string, number> = {};
    const byPriority: Record<string, number> = {};
    for (const s of STATUS_ORDER) byStatus[s] = 0;
    for (const p of ["low", "medium", "high", "urgent"] as const)
      byPriority[p] = 0;

    for (const t of pt) {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    }

    const completionTimes = completed
      .filter((t) => t.completedAt)
      .map((t) => t.completedAt! - t.createdAt);
    const avgCompletionTime =
      completionTimes.length > 0
        ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
        : 0;

    return {
      total: pt.length,
      completed: completed.length,
      overdue: overdue.length,
      byStatus,
      byPriority,
      completionRate: pt.length > 0 ? completed.length / pt.length : 0,
      avgCompletionTime,
    };
  }, [projectTasks]);

  const getOverdueTasks = useCallback(
    (): Task[] => projectTasks.filter(isOverdue),
    [projectTasks],
  );

  // ── Search ───────────────────────────────────────────────────────────

  const searchTasks = useCallback(
    (query: string): Task[] => {
      const q = query.toLowerCase();
      return projectTasks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.labels.some((l) => l.toLowerCase().includes(q)) ||
          (t.assignee && t.assignee.toLowerCase().includes(q)),
      );
    },
    [projectTasks],
  );

  // ── Bulk operations ──────────────────────────────────────────────────

  const bulkUpdate = useCallback(
    (ids: string[], updates: Partial<Omit<Task, "id" | "createdAt">>) => {
      const idSet = new Set(ids);
      setTasks((prev) =>
        prev.map((t) => {
          if (!idSet.has(t.id)) return t;
          const updated = { ...t, ...updates, updatedAt: Date.now() };
          if (updates.status === "done" && t.status !== "done") {
            updated.completedAt = Date.now();
          }
          return updated;
        }),
      );
    },
    [],
  );

  // ── Export ───────────────────────────────────────────────────────────

  const exportTasks = useCallback(
    (format: "json" | "csv" | "markdown" = "json"): string => {
      const pt = projectTasks;
      if (format === "json") return JSON.stringify(pt, null, 2);
      if (format === "csv") {
        const header =
          "id,title,status,priority,assignee,dueDate,estimatedHours,createdAt";
        const rows = pt.map(
          (t) =>
            `"${t.id}","${t.title.replace(/"/g, '""')}","${t.status}","${t.priority}","${t.assignee ?? ""}","${t.dueDate ?? ""}","${t.estimatedHours ?? ""}","${new Date(t.createdAt).toISOString()}"`,
        );
        return [header, ...rows].join("\n");
      }
      // Markdown
      const sections = STATUS_ORDER.map((status) => {
        const inCol = pt.filter((t) => t.status === status);
        if (inCol.length === 0) return "";
        const items = inCol
          .map((t) => {
            const check = t.status === "done" ? "[x]" : "[ ]";
            const pri = `[${t.priority.toUpperCase()}]`;
            const due = t.dueDate ? ` (due ${t.dueDate})` : "";
            return `- ${check} ${pri} ${t.title}${due}`;
          })
          .join("\n");
        return `## ${STATUS_LABELS[status]}\n\n${items}`;
      })
        .filter(Boolean)
        .join("\n\n");
      return `# ${activeProject.name} Tasks\n\n${sections}\n`;
    },
    [projectTasks, activeProject],
  );

  // ── Return ───────────────────────────────────────────────────────────

  return {
    tasks: projectTasks,
    allTasks: tasks,
    projects,
    activeProject,
    statusLabels: STATUS_LABELS,
    statusOrder: STATUS_ORDER,

    createTask,
    updateTask,
    deleteTask,
    moveTask,

    createProject,
    deleteProject,
    setActiveProject,

    addSubtask,
    toggleSubtask,
    addComment,

    generateTasksFromPrompt,
    getStats,
    getOverdueTasks,
    searchTasks,
    bulkUpdate,
    exportTasks,
  };
}

// ── AI Heuristics (offline) ────────────────────────────────────────────────────

function cleanTitle(raw: string): string {
  return raw
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^\w/, (c) => c.toUpperCase())
    .slice(0, 120);
}

function guessPriority(text: string): TaskPriority {
  const low = text.toLowerCase();
  if (/urgent|critical|asap|blocker/i.test(low)) return "urgent";
  if (/important|high|core|essential/i.test(low)) return "high";
  if (/nice.to.have|optional|later|low/i.test(low)) return "low";
  return "medium";
}

function guessHours(text: string): number | null {
  const hourMatch = text.match(/(\d+)\s*h(?:ou)?rs?/i);
  if (hourMatch) return parseInt(hourMatch[1], 10);
  const low = text.toLowerCase();
  if (/design|plan|research|investigate/i.test(low)) return 4;
  if (/implement|build|create|develop/i.test(low)) return 8;
  if (/test|review|fix|debug/i.test(low)) return 2;
  if (/deploy|release|launch/i.test(low)) return 3;
  if (/document|write/i.test(low)) return 3;
  return null;
}

function guessSubtasks(text: string): string[] {
  const low = text.toLowerCase();
  if (/design/i.test(low))
    return ["Research references", "Create wireframe", "Review with team"];
  if (/implement|build|develop/i.test(low))
    return [
      "Set up scaffolding",
      "Implement core logic",
      "Add error handling",
      "Write tests",
    ];
  if (/test/i.test(low))
    return ["Write unit tests", "Integration tests", "Manual QA"];
  if (/deploy|release/i.test(low))
    return ["Prepare changelog", "Run final tests", "Deploy to staging", "Deploy to production"];
  return [];
}

function guessLabels(text: string): string[] {
  const labels: string[] = [];
  const low = text.toLowerCase();
  if (/frontend|ui|ux|css|style|layout|component/i.test(low))
    labels.push("frontend");
  if (/backend|api|server|database|db/i.test(low)) labels.push("backend");
  if (/design|wireframe|mockup|figma/i.test(low)) labels.push("design");
  if (/test|qa|quality/i.test(low)) labels.push("testing");
  if (/bug|fix|issue/i.test(low)) labels.push("bugfix");
  if (/doc|readme|guide/i.test(low)) labels.push("docs");
  if (/devops|ci|cd|deploy|docker/i.test(low)) labels.push("devops");
  if (/security|auth|encrypt/i.test(low)) labels.push("security");
  return labels.length > 0 ? labels : ["general"];
}

function generateProjectBreakdown(prompt: string): GeneratedTaskDraft[] {
  const drafts: GeneratedTaskDraft[] = [];
  const phases = [
    {
      title: "Project Planning & Requirements",
      priority: "high" as TaskPriority,
      hours: 4,
      subs: [
        "Define scope and goals",
        "Identify stakeholders",
        "Create requirements document",
        "Set milestones",
      ],
      labels: ["planning"],
    },
    {
      title: "Architecture & Design",
      priority: "high" as TaskPriority,
      hours: 6,
      subs: [
        "Design system architecture",
        "Create component diagram",
        "Define data models",
        "Choose tech stack",
      ],
      labels: ["design", "architecture"],
    },
    {
      title: "UI/UX Design",
      priority: "medium" as TaskPriority,
      hours: 8,
      subs: [
        "User flow mapping",
        "Wireframes",
        "High-fidelity mockups",
        "Design review",
      ],
      labels: ["design", "frontend"],
    },
    {
      title: "Core Implementation",
      priority: "high" as TaskPriority,
      hours: 16,
      subs: [
        "Set up project scaffolding",
        "Implement core features",
        "Build data layer",
        "Integrate APIs",
      ],
      labels: ["development"],
    },
    {
      title: "Frontend Development",
      priority: "medium" as TaskPriority,
      hours: 12,
      subs: [
        "Build UI components",
        "Implement state management",
        "Add responsive layout",
        "Polish interactions",
      ],
      labels: ["frontend"],
    },
    {
      title: "Testing & QA",
      priority: "high" as TaskPriority,
      hours: 6,
      subs: [
        "Unit tests",
        "Integration tests",
        "E2E tests",
        "Bug fixing",
      ],
      labels: ["testing"],
    },
    {
      title: "Documentation",
      priority: "low" as TaskPriority,
      hours: 4,
      subs: [
        "Write README",
        "API documentation",
        "User guide",
        "Developer onboarding",
      ],
      labels: ["docs"],
    },
    {
      title: "Deployment & Launch",
      priority: "urgent" as TaskPriority,
      hours: 4,
      subs: [
        "Set up CI/CD",
        "Configure hosting",
        "Deploy to staging",
        "Production launch",
      ],
      labels: ["devops"],
    },
  ];

  for (const phase of phases) {
    drafts.push({
      title: phase.title,
      description: `Part of project: "${prompt.slice(0, 100)}"`,
      priority: phase.priority,
      estimatedHours: phase.hours,
      subtasks: phase.subs,
      labels: phase.labels,
    });
  }

  return drafts;
}

export { STATUS_LABELS, STATUS_ORDER, PRIORITY_WEIGHTS, isOverdue };
export type { TaskStatus as TaskStatusType };
