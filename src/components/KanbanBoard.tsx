import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useTaskPlanner,
  Task,
  TaskStatus,
  TaskPriority,
  GeneratedTaskDraft,
  STATUS_ORDER,
  STATUS_LABELS,
  PRIORITY_WEIGHTS,
  isOverdue,
} from "../hooks/useTaskPlanner";

// ── Constants ──────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-blue-400",
};

const PRIORITY_TEXT: Record<TaskPriority, string> = {
  urgent: "text-red-400",
  high: "text-orange-400",
  medium: "text-yellow-400",
  low: "text-blue-400",
};

const PRIORITY_BORDER: Record<TaskPriority, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-blue-400",
};

const STATUS_ICONS: Record<TaskStatus, string> = {
  backlog: "📋",
  todo: "📝",
  "in-progress": "🔄",
  review: "🔍",
  done: "✅",
};

const LABEL_COLORS: Record<string, string> = {
  frontend: "bg-purple-500/20 text-purple-300",
  backend: "bg-green-500/20 text-green-300",
  design: "bg-pink-500/20 text-pink-300",
  testing: "bg-cyan-500/20 text-cyan-300",
  bugfix: "bg-red-500/20 text-red-300",
  docs: "bg-amber-500/20 text-amber-300",
  devops: "bg-teal-500/20 text-teal-300",
  security: "bg-rose-500/20 text-rose-300",
  planning: "bg-indigo-500/20 text-indigo-300",
  architecture: "bg-violet-500/20 text-violet-300",
  development: "bg-emerald-500/20 text-emerald-300",
  general: "bg-slate-500/20 text-slate-300",
};

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

type ViewMode = "kanban" | "list";
type FilterPriority = TaskPriority | "all";
type SortField = "order" | "priority" | "dueDate" | "title" | "createdAt";

// ── Component ──────────────────────────────────────────────────────────────────

export default function KanbanBoard({ onBack, onSendToChat }: Props) {
  const {
    tasks,
    projects,
    activeProject,
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
    searchTasks,
    exportTasks,
  } = useTaskPlanner();

  // ── State ────────────────────────────────────────────────────────────

  const [viewMode, setViewMode] = useState<ViewMode>("kanban");
  const [query, setQuery] = useState("");
  const [filterPriority, setFilterPriority] = useState<FilterPriority>("all");
  const [filterLabel, setFilterLabel] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [filterOverdue, setFilterOverdue] = useState(false);
  const [sortField, setSortField] = useState<SortField>("order");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showProjectSidebar, setShowProjectSidebar] = useState(false);
  const [showAIPlan, setShowAIPlan] = useState(false);
  const [aiPrompt, setAIPrompt] = useState("");
  const [aiDrafts, setAIDrafts] = useState<GeneratedTaskDraft[]>([]);
  const [showNewTask, setShowNewTask] = useState<TaskStatus | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showProjectCreate, setShowProjectCreate] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState("#6366f1");
  const [showExport, setShowExport] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Detail-modal form
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<TaskPriority>("medium");
  const [editStatus, setEditStatus] = useState<TaskStatus>("todo");
  const [editAssignee, setEditAssignee] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editEstHours, setEditEstHours] = useState("");
  const [editActHours, setEditActHours] = useState("");
  const [editLabels, setEditLabels] = useState("");
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newCommentText, setNewCommentText] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);

  // ── Derived data ─────────────────────────────────────────────────────

  const stats = useMemo(() => getStats(), [getStats, tasks]);

  const allLabels = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => t.labels.forEach((l) => s.add(l)));
    return Array.from(s).sort();
  }, [tasks]);

  const allAssignees = useMemo(() => {
    const s = new Set<string>();
    tasks.forEach((t) => { if (t.assignee) s.add(t.assignee); });
    return Array.from(s).sort();
  }, [tasks]);

  const filtered = useMemo(() => {
    let list = query ? searchTasks(query) : [...tasks];
    if (filterPriority !== "all")
      list = list.filter((t) => t.priority === filterPriority);
    if (filterLabel)
      list = list.filter((t) => t.labels.includes(filterLabel));
    if (filterAssignee)
      list = list.filter((t) => t.assignee === filterAssignee);
    if (filterOverdue) list = list.filter(isOverdue);

    if (sortField === "priority")
      list.sort(
        (a, b) =>
          PRIORITY_WEIGHTS[b.priority] - PRIORITY_WEIGHTS[a.priority],
      );
    else if (sortField === "dueDate")
      list.sort(
        (a, b) =>
          (a.dueDate ? new Date(a.dueDate).getTime() : Infinity) -
          (b.dueDate ? new Date(b.dueDate).getTime() : Infinity),
      );
    else if (sortField === "title")
      list.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortField === "createdAt")
      list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => a.order - b.order);

    return list;
  }, [
    tasks,
    query,
    filterPriority,
    filterLabel,
    filterAssignee,
    filterOverdue,
    sortField,
    searchTasks,
  ]);

  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      "in-progress": [],
      review: [],
      done: [],
    };
    for (const t of filtered) {
      map[t.status].push(t);
    }
    return map;
  }, [filtered]);

  // ── Detail modal helpers ─────────────────────────────────────────────

  const openTask = useCallback((task: Task) => {
    setSelectedTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditStatus(task.status);
    setEditAssignee(task.assignee ?? "");
    setEditDueDate(task.dueDate ?? "");
    setEditEstHours(task.estimatedHours?.toString() ?? "");
    setEditActHours(task.actualHours?.toString() ?? "");
    setEditLabels(task.labels.join(", "));
    setNewSubtaskTitle("");
    setNewCommentText("");
  }, []);

  const saveTaskDetail = useCallback(() => {
    if (!selectedTask) return;
    updateTask(selectedTask.id, {
      title: editTitle.trim() || selectedTask.title,
      description: editDescription,
      priority: editPriority,
      status: editStatus,
      assignee: editAssignee.trim() || null,
      dueDate: editDueDate || null,
      estimatedHours: editEstHours ? parseFloat(editEstHours) : null,
      actualHours: editActHours ? parseFloat(editActHours) : null,
      labels: editLabels
        .split(",")
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    });
    // If status changed, also move
    if (editStatus !== selectedTask.status) {
      moveTask(selectedTask.id, editStatus);
    }
    // Refresh selected with updated data
    setSelectedTask((prev) =>
      prev
        ? {
            ...prev,
            title: editTitle.trim() || prev.title,
            description: editDescription,
            priority: editPriority,
            status: editStatus,
            assignee: editAssignee.trim() || null,
            dueDate: editDueDate || null,
            estimatedHours: editEstHours ? parseFloat(editEstHours) : null,
            actualHours: editActHours ? parseFloat(editActHours) : null,
            labels: editLabels
              .split(",")
              .map((l) => l.trim().toLowerCase())
              .filter(Boolean),
          }
        : null,
    );
  }, [
    selectedTask,
    editTitle,
    editDescription,
    editPriority,
    editStatus,
    editAssignee,
    editDueDate,
    editEstHours,
    editActHours,
    editLabels,
    updateTask,
    moveTask,
  ]);

  // ── Quick add ────────────────────────────────────────────────────────

  const handleQuickAdd = useCallback(
    (status: TaskStatus) => {
      if (!newTaskTitle.trim()) return;
      createTask(newTaskTitle.trim(), { status });
      setNewTaskTitle("");
      setShowNewTask(null);
    },
    [newTaskTitle, createTask],
  );

  // ── AI Plan ──────────────────────────────────────────────────────────

  const handleAIPlan = useCallback(() => {
    if (!aiPrompt.trim()) return;
    const drafts = generateTasksFromPrompt(aiPrompt.trim());
    setAIDrafts(drafts);
  }, [aiPrompt, generateTasksFromPrompt]);

  const acceptAIDrafts = useCallback(() => {
    for (const draft of aiDrafts) {
      const task = createTask(draft.title, {
        description: draft.description,
        priority: draft.priority,
        estimatedHours: draft.estimatedHours,
        labels: draft.labels,
        status: "backlog",
      });
      for (const sub of draft.subtasks) {
        addSubtask(task.id, sub);
      }
    }
    setAIDrafts([]);
    setAIPrompt("");
    setShowAIPlan(false);
  }, [aiDrafts, createTask, addSubtask]);

  // ── Keyboard shortcut ───────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedTask) setSelectedTask(null);
        else if (showAIPlan) setShowAIPlan(false);
        else if (showProjectSidebar) setShowProjectSidebar(false);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && !selectedTask) {
        e.preventDefault();
        setShowNewTask("todo");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTask, showAIPlan, showProjectSidebar]);

  // ── Render: Column move arrows ───────────────────────────────────────

  const moveLeft = (task: Task) => {
    const idx = STATUS_ORDER.indexOf(task.status);
    if (idx > 0) moveTask(task.id, STATUS_ORDER[idx - 1]);
  };

  const moveRight = (task: Task) => {
    const idx = STATUS_ORDER.indexOf(task.status);
    if (idx < STATUS_ORDER.length - 1) moveTask(task.id, STATUS_ORDER[idx + 1]);
  };

  // ── Format helpers ──────────────────────────────────────────────────

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    });
  };

  const formatDue = (due: string) => {
    const d = new Date(due);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return "Due today";
    if (days === 1) return "Due tomorrow";
    if (days <= 7) return `${days}d left`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const subtaskProgress = (task: Task) => {
    if (task.subtasks.length === 0) return null;
    const done = task.subtasks.filter((s) => s.completed).length;
    return { done, total: task.subtasks.length, pct: (done / task.subtasks.length) * 100 };
  };

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col bg-blade-surface text-blade-text overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-blade-border px-4 py-3 shrink-0">
        <button
          onClick={onBack}
          className="rounded p-1.5 hover:bg-blade-hover text-blade-muted"
          title="Back"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Project switcher */}
        <button
          onClick={() => setShowProjectSidebar(!showProjectSidebar)}
          className="flex items-center gap-2 rounded-lg px-3 py-1.5 hover:bg-blade-hover"
        >
          <span
            className="h-3 w-3 rounded-full shrink-0"
            style={{ backgroundColor: activeProject.color }}
          />
          <span className="font-semibold text-sm">{activeProject.name}</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="text-blade-muted">
            <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Stats bar */}
        <div className="hidden md:flex items-center gap-4 ml-2 text-xs text-blade-muted">
          <span>{stats.total} tasks</span>
          <span className="text-green-400">{stats.completed} done</span>
          {stats.overdue > 0 && (
            <span className="text-red-400">{stats.overdue} overdue</span>
          )}
          <span>
            {Math.round(stats.completionRate * 100)}% complete
          </span>
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search tasks... (Ctrl+F)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-48 rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs placeholder:text-blade-muted focus:border-accent focus:outline-none"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-blade-muted hover:text-blade-text"
            >
              x
            </button>
          )}
        </div>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`rounded-lg px-3 py-1.5 text-xs border ${
            showFilters || filterPriority !== "all" || filterLabel || filterOverdue
              ? "border-accent text-accent"
              : "border-blade-border text-blade-muted hover:text-blade-text"
          }`}
        >
          Filters
        </button>

        {/* View toggle */}
        <div className="flex rounded-lg border border-blade-border overflow-hidden">
          <button
            onClick={() => setViewMode("kanban")}
            className={`px-3 py-1.5 text-xs ${viewMode === "kanban" ? "bg-accent/20 text-accent" : "text-blade-muted hover:text-blade-text"}`}
          >
            Board
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 text-xs ${viewMode === "list" ? "bg-accent/20 text-accent" : "text-blade-muted hover:text-blade-text"}`}
          >
            List
          </button>
        </div>

        {/* AI Plan button */}
        <button
          onClick={() => { setShowAIPlan(true); setTimeout(() => aiInputRef.current?.focus(), 100); }}
          className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/30"
        >
          AI Plan
        </button>

        {/* Export */}
        <button
          onClick={() => setShowExport(!showExport)}
          className="rounded-lg px-2 py-1.5 text-blade-muted hover:text-blade-text text-xs"
        >
          Export
        </button>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────── */}
      {showFilters && (
        <div className="flex items-center gap-3 border-b border-blade-border px-4 py-2 text-xs bg-blade-base/50">
          <span className="text-blade-muted">Priority:</span>
          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as FilterPriority)}
            className="rounded border border-blade-border bg-blade-surface px-2 py-1 text-xs"
          >
            <option value="all">All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <span className="text-blade-muted ml-2">Label:</span>
          <select
            value={filterLabel}
            onChange={(e) => setFilterLabel(e.target.value)}
            className="rounded border border-blade-border bg-blade-surface px-2 py-1 text-xs"
          >
            <option value="">All</option>
            {allLabels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>

          {allAssignees.length > 0 && (
            <>
              <span className="text-blade-muted ml-2">Assignee:</span>
              <select
                value={filterAssignee}
                onChange={(e) => setFilterAssignee(e.target.value)}
                className="rounded border border-blade-border bg-blade-surface px-2 py-1 text-xs"
              >
                <option value="">All</option>
                {allAssignees.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </>
          )}

          <label className="ml-2 flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filterOverdue}
              onChange={(e) => setFilterOverdue(e.target.checked)}
              className="accent-accent"
            />
            <span className="text-red-400">Overdue only</span>
          </label>

          <button
            onClick={() => {
              setFilterPriority("all");
              setFilterLabel("");
              setFilterAssignee("");
              setFilterOverdue(false);
            }}
            className="ml-auto text-blade-muted hover:text-blade-text"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* ── Export dropdown ─────────────────────────────────────────── */}
      {showExport && (
        <div className="absolute right-4 top-14 z-50 rounded-lg border border-blade-border bg-blade-surface shadow-xl p-2 text-xs">
          {(["json", "csv", "markdown"] as const).map((fmt) => (
            <button
              key={fmt}
              onClick={() => {
                const data = exportTasks(fmt);
                navigator.clipboard.writeText(data);
                setShowExport(false);
              }}
              className="block w-full rounded px-3 py-1.5 text-left hover:bg-blade-hover"
            >
              Copy as {fmt.toUpperCase()}
            </button>
          ))}
          <button
            onClick={() => {
              const md = exportTasks("markdown");
              onSendToChat(md);
              setShowExport(false);
            }}
            className="block w-full rounded px-3 py-1.5 text-left hover:bg-blade-hover text-accent"
          >
            Send to chat
          </button>
        </div>
      )}

      {/* ── Main area ──────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Project sidebar ────────────────────────────────────── */}
        {showProjectSidebar && (
          <div className="w-56 shrink-0 border-r border-blade-border bg-blade-base p-3 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-blade-muted uppercase tracking-wider">
                Projects
              </span>
              <button
                onClick={() => setShowProjectCreate(true)}
                className="text-accent text-xs hover:underline"
              >
                + New
              </button>
            </div>

            {showProjectCreate && (
              <div className="mb-3 rounded-lg border border-blade-border bg-blade-surface p-2">
                <input
                  type="text"
                  placeholder="Project name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="w-full rounded border border-blade-border bg-blade-base px-2 py-1 text-xs mb-2 focus:outline-none focus:border-accent"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newProjectName.trim()) {
                      createProject(newProjectName.trim(), {
                        color: newProjectColor,
                      });
                      setNewProjectName("");
                      setShowProjectCreate(false);
                    }
                    if (e.key === "Escape") setShowProjectCreate(false);
                  }}
                />
                <div className="flex gap-1">
                  {["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"].map(
                    (c) => (
                      <button
                        key={c}
                        onClick={() => setNewProjectColor(c)}
                        className={`h-5 w-5 rounded-full border-2 ${
                          newProjectColor === c ? "border-white" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ),
                  )}
                </div>
              </div>
            )}

            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setActiveProject(p.id);
                  setShowProjectSidebar(false);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm mb-1 ${
                  p.id === activeProject.id
                    ? "bg-accent/15 text-accent"
                    : "hover:bg-blade-hover text-blade-text"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span className="truncate flex-1 text-left">{p.name}</span>
                {p.id !== "personal" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete project "${p.name}"?`)) {
                        deleteProject(p.id);
                      }
                    }}
                    className="text-blade-muted hover:text-red-400 shrink-0"
                  >
                    x
                  </button>
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── Kanban / List view ─────────────────────────────────── */}
        {viewMode === "kanban" ? (
          <div className="flex flex-1 gap-3 overflow-x-auto p-4">
            {STATUS_ORDER.map((status) => {
              const colTasks = columnTasks[status];
              return (
                <div
                  key={status}
                  className="flex w-64 shrink-0 flex-col rounded-xl bg-blade-base/60 border border-blade-border/50"
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-3 py-2.5 border-b border-blade-border/40">
                    <span className="text-sm">{STATUS_ICONS[status]}</span>
                    <span className="text-xs font-semibold flex-1">
                      {STATUS_LABELS[status]}
                    </span>
                    <span className="text-xs text-blade-muted bg-blade-surface rounded-full px-2 py-0.5">
                      {colTasks.length}
                    </span>
                    <button
                      onClick={() => setShowNewTask(status)}
                      className="text-blade-muted hover:text-accent text-sm leading-none"
                      title="Add task"
                    >
                      +
                    </button>
                  </div>

                  {/* Quick-add inline */}
                  {showNewTask === status && (
                    <div className="px-2 pt-2">
                      <input
                        type="text"
                        placeholder="Task title..."
                        value={newTaskTitle}
                        onChange={(e) => setNewTaskTitle(e.target.value)}
                        className="w-full rounded-lg border border-blade-border bg-blade-surface px-2.5 py-1.5 text-xs focus:border-accent focus:outline-none"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleQuickAdd(status);
                          if (e.key === "Escape") {
                            setShowNewTask(null);
                            setNewTaskTitle("");
                          }
                        }}
                        onBlur={() => {
                          if (newTaskTitle.trim()) handleQuickAdd(status);
                          else { setShowNewTask(null); setNewTaskTitle(""); }
                        }}
                      />
                    </div>
                  )}

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {colTasks.map((task) => {
                      const progress = subtaskProgress(task);
                      const overdue = isOverdue(task);
                      return (
                        <div
                          key={task.id}
                          onClick={() => openTask(task)}
                          className={`group cursor-pointer rounded-lg border-l-[3px] bg-blade-surface p-3 hover:bg-blade-hover transition-colors ${PRIORITY_BORDER[task.priority]}`}
                        >
                          {/* Labels */}
                          {task.labels.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {task.labels.slice(0, 3).map((l) => (
                                <span
                                  key={l}
                                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                                    LABEL_COLORS[l] || LABEL_COLORS.general
                                  }`}
                                >
                                  {l}
                                </span>
                              ))}
                              {task.labels.length > 3 && (
                                <span className="text-[10px] text-blade-muted">
                                  +{task.labels.length - 3}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Title */}
                          <p className="text-xs font-medium leading-snug mb-1.5 line-clamp-2">
                            {task.title}
                          </p>

                          {/* Subtask progress */}
                          {progress && (
                            <div className="mb-1.5">
                              <div className="flex items-center gap-1.5">
                                <div className="flex-1 h-1 rounded-full bg-blade-border overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-accent transition-all"
                                    style={{ width: `${progress.pct}%` }}
                                  />
                                </div>
                                <span className="text-[10px] text-blade-muted">
                                  {progress.done}/{progress.total}
                                </span>
                              </div>
                            </div>
                          )}

                          {/* Footer: due date, assignee, comments, arrows */}
                          <div className="flex items-center gap-2 text-[10px] text-blade-muted">
                            {task.dueDate && (
                              <span className={overdue ? "text-red-400 font-medium" : ""}>
                                {formatDue(task.dueDate)}
                              </span>
                            )}
                            {task.assignee && (
                              <span className="bg-blade-border rounded-full px-1.5 py-0.5">
                                {task.assignee}
                              </span>
                            )}
                            {task.comments.length > 0 && (
                              <span>{task.comments.length} cmt</span>
                            )}
                            <div className="flex-1" />
                            {/* Move arrows */}
                            <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
                              {STATUS_ORDER.indexOf(task.status) > 0 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); moveLeft(task); }}
                                  className="hover:text-accent"
                                  title="Move left"
                                >
                                  &larr;
                                </button>
                              )}
                              {STATUS_ORDER.indexOf(task.status) < STATUS_ORDER.length - 1 && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); moveRight(task); }}
                                  className="hover:text-accent"
                                  title="Move right"
                                >
                                  &rarr;
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {colTasks.length === 0 && (
                      <div className="py-8 text-center text-xs text-blade-muted opacity-60">
                        No tasks
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── List view ──────────────────────────────────────────── */
          <div className="flex-1 overflow-auto p-4">
            {/* Sort bar */}
            <div className="flex items-center gap-3 mb-3 text-xs text-blade-muted">
              <span>Sort:</span>
              {(["order", "priority", "dueDate", "title", "createdAt"] as SortField[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setSortField(f)}
                  className={`px-2 py-1 rounded ${sortField === f ? "bg-accent/20 text-accent" : "hover:text-blade-text"}`}
                >
                  {f === "dueDate" ? "Due" : f === "createdAt" ? "Created" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>

            <div className="rounded-xl border border-blade-border overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_80px_80px_100px_80px_60px] gap-2 px-4 py-2 bg-blade-base text-xs font-semibold text-blade-muted border-b border-blade-border">
                <span>Title</span>
                <span>Status</span>
                <span>Priority</span>
                <span>Due</span>
                <span>Assignee</span>
                <span>Subtasks</span>
              </div>

              {filtered.length === 0 && (
                <div className="py-12 text-center text-xs text-blade-muted">
                  No tasks found
                </div>
              )}

              {filtered.map((task) => {
                const progress = subtaskProgress(task);
                const overdue = isOverdue(task);
                return (
                  <div
                    key={task.id}
                    onClick={() => openTask(task)}
                    className="grid grid-cols-[1fr_80px_80px_100px_80px_60px] gap-2 px-4 py-2.5 text-xs border-b border-blade-border/50 cursor-pointer hover:bg-blade-hover items-center"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${PRIORITY_COLORS[task.priority]}`} />
                      <span className="truncate font-medium">{task.title}</span>
                      {task.labels.length > 0 && (
                        <span className="text-[10px] text-blade-muted">
                          [{task.labels[0]}]
                        </span>
                      )}
                    </div>
                    <span className="text-blade-muted">{STATUS_LABELS[task.status]}</span>
                    <span className={PRIORITY_TEXT[task.priority]}>
                      {task.priority}
                    </span>
                    <span className={overdue ? "text-red-400 font-medium" : "text-blade-muted"}>
                      {task.dueDate ? formatDue(task.dueDate) : "--"}
                    </span>
                    <span className="text-blade-muted truncate">
                      {task.assignee || "--"}
                    </span>
                    <span className="text-blade-muted">
                      {progress ? `${progress.done}/${progress.total}` : "--"}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Stats footer ───────────────────────────────────────────── */}
      <div className="flex items-center gap-4 border-t border-blade-border px-4 py-2 text-[11px] text-blade-muted shrink-0 bg-blade-base/30">
        <span>
          Completion: <strong className="text-green-400">{Math.round(stats.completionRate * 100)}%</strong>
        </span>
        <span>
          Total: <strong className="text-blade-text">{stats.total}</strong>
        </span>
        <span>
          Done: <strong className="text-green-400">{stats.completed}</strong>
        </span>
        {stats.overdue > 0 && (
          <span>
            Overdue: <strong className="text-red-400">{stats.overdue}</strong>
          </span>
        )}
        {stats.avgCompletionTime > 0 && (
          <span>
            Avg time:{" "}
            <strong className="text-blade-text">
              {Math.round(stats.avgCompletionTime / 3600000)}h
            </strong>
          </span>
        )}
        <div className="flex-1" />
        <span className="opacity-50">Ctrl+N new task / Ctrl+F search</span>
      </div>

      {/* ── Task detail modal ──────────────────────────────────────── */}
      {selectedTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              saveTaskDetail();
              setSelectedTask(null);
            }
          }}
        >
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border border-blade-border bg-blade-surface shadow-2xl">
            {/* Modal header */}
            <div className="flex items-center gap-3 border-b border-blade-border px-5 py-3">
              <span className={`h-3 w-3 rounded-full ${PRIORITY_COLORS[editPriority]}`} />
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={saveTaskDetail}
                className="flex-1 bg-transparent text-sm font-semibold focus:outline-none"
                placeholder="Task title"
              />
              <button
                onClick={() => {
                  saveTaskDetail();
                  setSelectedTask(null);
                }}
                className="text-blade-muted hover:text-blade-text text-lg leading-none"
              >
                x
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Status + Priority row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                    Status
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as TaskStatus)}
                    onBlur={saveTaskDetail}
                    className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs"
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                    Priority
                  </label>
                  <select
                    value={editPriority}
                    onChange={(e) => setEditPriority(e.target.value as TaskPriority)}
                    onBlur={saveTaskDetail}
                    className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs"
                  >
                    {(["urgent", "high", "medium", "low"] as const).map((p) => (
                      <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Assignee + Due + Hours */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                    Assignee
                  </label>
                  <input
                    value={editAssignee}
                    onChange={(e) => setEditAssignee(e.target.value)}
                    onBlur={saveTaskDetail}
                    placeholder="Unassigned"
                    className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                    Due Date
                  </label>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                    onBlur={saveTaskDetail}
                    className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                      Est. hrs
                    </label>
                    <input
                      type="number"
                      value={editEstHours}
                      onChange={(e) => setEditEstHours(e.target.value)}
                      onBlur={saveTaskDetail}
                      placeholder="--"
                      className="w-full rounded-lg border border-blade-border bg-blade-base px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                      Actual
                    </label>
                    <input
                      type="number"
                      value={editActHours}
                      onChange={(e) => setEditActHours(e.target.value)}
                      onBlur={saveTaskDetail}
                      placeholder="--"
                      className="w-full rounded-lg border border-blade-border bg-blade-base px-2 py-1.5 text-xs focus:outline-none focus:border-accent"
                    />
                  </div>
                </div>
              </div>

              {/* Labels */}
              <div>
                <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                  Labels (comma-separated)
                </label>
                <input
                  value={editLabels}
                  onChange={(e) => setEditLabels(e.target.value)}
                  onBlur={saveTaskDetail}
                  placeholder="frontend, design, ..."
                  className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-1 block">
                  Description
                </label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  onBlur={saveTaskDetail}
                  rows={4}
                  placeholder="Add a description..."
                  className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-2 text-xs leading-relaxed resize-none focus:outline-none focus:border-accent"
                />
              </div>

              {/* Subtasks */}
              <div>
                <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-2 block">
                  Subtasks ({selectedTask.subtasks.filter((s) => s.completed).length}/{selectedTask.subtasks.length})
                </label>
                <div className="space-y-1 mb-2">
                  {selectedTask.subtasks.map((sub) => (
                    <label
                      key={sub.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-blade-hover cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={sub.completed}
                        onChange={() => {
                          toggleSubtask(selectedTask.id, sub.id);
                          setSelectedTask((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  subtasks: prev.subtasks.map((s) =>
                                    s.id === sub.id
                                      ? { ...s, completed: !s.completed }
                                      : s,
                                  ),
                                }
                              : null,
                          );
                        }}
                        className="accent-accent"
                      />
                      <span
                        className={`text-xs ${sub.completed ? "line-through text-blade-muted" : ""}`}
                      >
                        {sub.title}
                      </span>
                    </label>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtaskTitle}
                    onChange={(e) => setNewSubtaskTitle(e.target.value)}
                    placeholder="Add subtask..."
                    className="flex-1 rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newSubtaskTitle.trim()) {
                        const sub = addSubtask(selectedTask.id, newSubtaskTitle.trim());
                        setSelectedTask((prev) =>
                          prev ? { ...prev, subtasks: [...prev.subtasks, sub] } : null,
                        );
                        setNewSubtaskTitle("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (!newSubtaskTitle.trim()) return;
                      const sub = addSubtask(selectedTask.id, newSubtaskTitle.trim());
                      setSelectedTask((prev) =>
                        prev ? { ...prev, subtasks: [...prev.subtasks, sub] } : null,
                      );
                      setNewSubtaskTitle("");
                    }}
                    className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs text-accent hover:bg-accent/30"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Comments */}
              <div>
                <label className="text-[10px] uppercase text-blade-muted font-semibold tracking-wider mb-2 block">
                  Comments ({selectedTask.comments.length})
                </label>
                <div className="space-y-2 mb-2 max-h-40 overflow-y-auto">
                  {selectedTask.comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg bg-blade-base px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium">{c.author}</span>
                        <span className="text-[10px] text-blade-muted">
                          {formatDate(c.timestamp)}
                        </span>
                      </div>
                      <p className="text-blade-muted leading-relaxed">{c.content}</p>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    placeholder="Add a comment..."
                    className="flex-1 rounded-lg border border-blade-border bg-blade-base px-3 py-1.5 text-xs focus:outline-none focus:border-accent"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newCommentText.trim()) {
                        const cmt = addComment(selectedTask.id, newCommentText.trim());
                        setSelectedTask((prev) =>
                          prev
                            ? { ...prev, comments: [...prev.comments, cmt] }
                            : null,
                        );
                        setNewCommentText("");
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (!newCommentText.trim()) return;
                      const cmt = addComment(selectedTask.id, newCommentText.trim());
                      setSelectedTask((prev) =>
                        prev ? { ...prev, comments: [...prev.comments, cmt] } : null,
                      );
                      setNewCommentText("");
                    }}
                    className="rounded-lg bg-accent/20 px-3 py-1.5 text-xs text-accent hover:bg-accent/30"
                  >
                    Post
                  </button>
                </div>
              </div>

              {/* Timestamps + actions */}
              <div className="flex items-center gap-4 pt-2 border-t border-blade-border text-[10px] text-blade-muted">
                <span>Created {formatDate(selectedTask.createdAt)}</span>
                <span>Updated {formatDate(selectedTask.updatedAt)}</span>
                {selectedTask.completedAt && (
                  <span className="text-green-400">
                    Completed {formatDate(selectedTask.completedAt)}
                  </span>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => {
                    onSendToChat(
                      `Task: ${selectedTask.title}\nStatus: ${selectedTask.status}\nPriority: ${selectedTask.priority}\n${selectedTask.description}`,
                    );
                  }}
                  className="text-accent hover:underline"
                >
                  Send to chat
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${selectedTask.title}"?`)) {
                      deleteTask(selectedTask.id);
                      setSelectedTask(null);
                    }
                  }}
                  className="text-red-400 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── AI Plan modal ──────────────────────────────────────────── */}
      {showAIPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowAIPlan(false);
              setAIDrafts([]);
            }
          }}
        >
          <div className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-2xl border border-blade-border bg-blade-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-blade-border px-5 py-3">
              <span className="text-sm font-semibold">AI Task Planner</span>
              <button
                onClick={() => { setShowAIPlan(false); setAIDrafts([]); }}
                className="text-blade-muted hover:text-blade-text text-lg leading-none"
              >
                x
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs text-blade-muted leading-relaxed">
                Describe your project or goal and AI will break it down into
                actionable tasks with priorities, estimates, and subtasks.
              </p>

              <textarea
                ref={aiInputRef}
                value={aiPrompt}
                onChange={(e) => setAIPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. Build a personal finance tracker web app with React, charts, and CSV import..."
                className="w-full rounded-lg border border-blade-border bg-blade-base px-3 py-2 text-xs leading-relaxed resize-none focus:outline-none focus:border-accent"
              />

              <button
                onClick={handleAIPlan}
                disabled={!aiPrompt.trim()}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-40"
              >
                Generate Tasks
              </button>

              {/* Drafts preview */}
              {aiDrafts.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      Generated {aiDrafts.length} tasks
                    </span>
                    <button
                      onClick={acceptAIDrafts}
                      className="rounded-lg bg-green-500/20 px-3 py-1.5 text-xs font-medium text-green-400 hover:bg-green-500/30"
                    >
                      Add all to Backlog
                    </button>
                  </div>

                  {aiDrafts.map((draft, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border-l-[3px] bg-blade-base p-3 ${PRIORITY_BORDER[draft.priority]}`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[draft.priority]}`} />
                        <span className="text-xs font-medium">{draft.title}</span>
                        {draft.estimatedHours && (
                          <span className="text-[10px] text-blade-muted ml-auto">
                            ~{draft.estimatedHours}h
                          </span>
                        )}
                      </div>
                      {draft.labels.length > 0 && (
                        <div className="flex gap-1 mb-1">
                          {draft.labels.map((l) => (
                            <span
                              key={l}
                              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                LABEL_COLORS[l] || LABEL_COLORS.general
                              }`}
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                      {draft.subtasks.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {draft.subtasks.map((s, j) => (
                            <div key={j} className="text-[10px] text-blade-muted flex items-center gap-1">
                              <span className="opacity-40">-</span> {s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
