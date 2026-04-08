import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useLearning,
  LearningPath,
  LearningModule,
  PathCategory,
} from "../hooks/useLearning";

// ── Props ───────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (prompt: string) => void;
}

// ── Constants ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<PathCategory, string> = {
  programming: "Programming",
  devops: "DevOps",
  design: "Design",
  data: "Data",
  ai: "AI / ML",
  business: "Business",
  custom: "Custom",
};

const CATEGORY_COLORS: Record<PathCategory, string> = {
  programming: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  devops: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  design: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  data: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  ai: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  business: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  custom: "bg-blade-accent/20 text-blade-accent border-blade-accent/30",
};

const MODULE_TYPE_ICONS: Record<LearningModule["type"], string> = {
  lesson: "book-open",
  exercise: "code",
  quiz: "help-circle",
  project: "folder-kanban",
};

const MODULE_TYPE_LABELS: Record<LearningModule["type"], string> = {
  lesson: "Lesson",
  exercise: "Exercise",
  quiz: "Quiz",
  project: "Project",
};

// ── Helpers ─────────────────────────────────────────────────────────

function timeEstimate(modules: LearningModule[]): string {
  const minutes = modules.reduce((acc, m) => {
    switch (m.type) {
      case "lesson": return acc + 15;
      case "exercise": return acc + 25;
      case "quiz": return acc + 10;
      case "project": return acc + 45;
      default: return acc + 20;
    }
  }, 0);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function LucideIcon({ name, size = 16 }: { name: string; size?: number }) {
  // Simple SVG icon mapping for common icons used in the component
  const icons: Record<string, string> = {
    "arrow-left": "M19 12H5m0 0l7 7m-7-7l7-7",
    "book-open": "M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z",
    "code": "M16 18l6-6-6-6M8 6l-6 6 6 6",
    "help-circle": "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-6v.01M12 8a2 2 0 011.71 3.04L12 13",
    "folder-kanban": "M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2h-7.93a2 2 0 01-1.66-.9l-.82-1.2A2 2 0 007.93 3H4a2 2 0 00-2 2v13c0 1.1.9 2 2 2z",
    "check": "M20 6L9 17l-5-5",
    "check-circle": "M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3",
    "plus": "M12 5v14m-7-7h14",
    "trash-2": "M3 6h18m-2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2",
    "rotate-ccw": "M1 4v6h6M3.51 15a9 9 0 102.13-9.36L1 10",
    "send": "M22 2L11 13M22 2l-7 20-4-9-9-4z",
    "trophy": "M6 9H4.5a2.5 2.5 0 010-5H6m12 5h1.5a2.5 2.5 0 000-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22m10 0c0-2-0.85-3.25-2.03-3.79A1.07 1.07 0 0114 17v-2.34M18 2H6v7a6 6 0 0012 0V2z",
    "flame": "M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 11-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 002.5 2.5z",
    "sparkles": "M12 3l1.912 5.813L20 12l-6.088 3.187L12 21l-1.912-5.813L4 12l6.088-3.187z",
    "x": "M18 6L6 18M6 6l12 12",
    "chevron-right": "M9 18l6-6-6-6",
    "clock": "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2",
    "file-text": "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8m8 4H8m2-8H8",
    "award": "M12 15l-3.26 1.72.62-3.63L6.73 10.5l3.64-.53L12 6.5l1.63 3.47 3.64.53-2.63 2.59.62 3.63z",
  };

  const d = icons[name] || icons["file-text"];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}

// ── Progress Bar ────────────────────────────────────────────────────

function ProgressBar({ percent, size = "md" }: { percent: number; size?: "sm" | "md" }) {
  const h = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className={`w-full ${h} bg-blade-surface rounded-full overflow-hidden`}>
      <div
        className="h-full bg-blade-accent rounded-full transition-all duration-500 ease-out"
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

// ── Path Card ───────────────────────────────────────────────────────

function PathCard({
  path,
  onStart,
  onDelete,
  onReset,
}: {
  path: LearningPath;
  onStart: (pathId: string) => void;
  onDelete: (pathId: string) => void;
  onReset: (pathId: string) => void;
}) {
  const completed = path.modules.filter((m) => m.completed).length;
  const total = path.modules.length;
  const isComplete = path.completedAt !== null;

  return (
    <div
      onClick={() => onStart(path.id)}
      className="group relative bg-blade-surface border border-blade-border rounded-2xl p-4
                 hover:border-blade-accent/40 transition-all duration-200 cursor-pointer"
    >
      {isComplete && (
        <div className="absolute top-3 right-3 text-emerald-400">
          <LucideIcon name="trophy" size={18} />
        </div>
      )}

      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl leading-none">{path.icon}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-blade-text truncate">
            {path.title}
          </h3>
          <p className="text-xs text-blade-muted mt-0.5 line-clamp-2">
            {path.description}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span
          className={`text-[10px] px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[path.category]}`}
        >
          {CATEGORY_LABELS[path.category]}
        </span>
        <span className="text-[10px] text-blade-muted flex items-center gap-1">
          <LucideIcon name="clock" size={10} />
          {timeEstimate(path.modules)}
        </span>
        <span className="text-[10px] text-blade-muted">
          {total} modules
        </span>
      </div>

      <ProgressBar percent={path.progress} size="sm" />

      <div className="flex items-center justify-between mt-2">
        <span className="text-[10px] text-blade-muted">
          {completed}/{total} completed
        </span>
        <span className="text-[10px] text-blade-accent font-medium">
          {path.progress}%
        </span>
      </div>

      {/* Hover actions */}
      <div
        className="absolute bottom-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        {isComplete && (
          <button
            onClick={() => onReset(path.id)}
            className="p-1 rounded-lg text-blade-muted hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
            title="Reset progress"
          >
            <LucideIcon name="rotate-ccw" size={12} />
          </button>
        )}
        {path.category === "custom" && (
          <button
            onClick={() => onDelete(path.id)}
            className="p-1 rounded-lg text-blade-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete path"
          >
            <LucideIcon name="trash-2" size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Module List Sidebar ─────────────────────────────────────────────

function ModuleSidebar({
  path,
  activeModuleId,
  onSelect,
}: {
  path: LearningPath;
  activeModuleId: string | null;
  onSelect: (moduleId: string) => void;
}) {
  return (
    <div className="w-56 shrink-0 border-r border-blade-border overflow-y-auto">
      <div className="p-3 border-b border-blade-border">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{path.icon}</span>
          <h3 className="text-xs font-semibold text-blade-text truncate">
            {path.title}
          </h3>
        </div>
        <ProgressBar percent={path.progress} size="sm" />
        <span className="text-[10px] text-blade-muted mt-1 block">
          {path.modules.filter((m) => m.completed).length}/{path.modules.length} completed
        </span>
      </div>

      <div className="p-2 space-y-0.5">
        {path.modules.map((mod, _idx) => {
          const isActive = mod.id === activeModuleId;
          return (
            <button
              key={mod.id}
              onClick={() => onSelect(mod.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left transition-colors ${
                isActive
                  ? "bg-blade-accent/15 text-blade-accent"
                  : "text-blade-muted hover:text-blade-text hover:bg-white/5"
              }`}
            >
              <div className="shrink-0">
                {mod.completed ? (
                  <span className="text-emerald-400">
                    <LucideIcon name="check-circle" size={14} />
                  </span>
                ) : (
                  <span className="text-blade-muted opacity-50">
                    <LucideIcon name={MODULE_TYPE_ICONS[mod.type]} size={14} />
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium truncate">{mod.title}</p>
                <p className="text-[9px] opacity-60">{MODULE_TYPE_LABELS[mod.type]}</p>
              </div>
              {mod.score !== null && (
                <span className="text-[9px] text-emerald-400 font-mono">
                  {mod.score}%
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Quiz View ───────────────────────────────────────────────────────

function QuizView({
  mod: _mod,
  onSubmit,
}: {
  mod: LearningModule;
  onSubmit: (answers: string[]) => void;
}) {
  const [answers, setAnswers] = useState<string[]>(Array(5).fill(""));

  const updateAnswer = (idx: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  };

  const allAnswered = answers.every((a) => a.trim().length > 0);

  return (
    <div className="space-y-4">
      <div className="bg-blade-surface border border-blade-border rounded-xl p-4">
        <p className="text-xs text-blade-muted mb-3">
          Answer all 5 questions below. The AI will evaluate your responses.
        </p>
        <p className="text-sm text-blade-text leading-relaxed">
          Click "Generate Quiz" to get your questions from the AI, then fill in
          your answers and submit for evaluation.
        </p>
      </div>

      {[1, 2, 3, 4, 5].map((q, idx) => (
        <div key={idx} className="space-y-1.5">
          <label className="text-xs font-medium text-blade-text">
            Question {q}
          </label>
          <input
            type="text"
            value={answers[idx]}
            onChange={(e) => updateAnswer(idx, e.target.value)}
            placeholder="Your answer..."
            className="w-full bg-blade-surface border border-blade-border rounded-xl px-3 py-2
                       text-sm text-blade-text placeholder:text-blade-muted/50
                       focus:outline-none focus:border-blade-accent/50 transition-colors"
          />
        </div>
      ))}

      <button
        onClick={() => onSubmit(answers)}
        disabled={!allAnswered}
        className="px-4 py-2 rounded-xl text-sm font-medium bg-blade-accent text-white
                   hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Submit Answers
      </button>
    </div>
  );
}

// ── Module Content View ─────────────────────────────────────────────

function ModuleView({
  mod,
  pathTitle,
  onSendToChat,
  onComplete,
  onUpdateNotes,
}: {
  mod: LearningModule;
  pathTitle: string;
  onSendToChat: (prompt: string) => void;
  onComplete: (score?: number) => void;
  onUpdateNotes: (notes: string) => void;
}) {
  const [showNotes, setShowNotes] = useState(false);

  const handleGenerateLesson = () => {
    const prompt =
      `You are an expert tutor. Generate an interactive lesson for "${mod.title}" ` +
      `in the learning path "${pathTitle}".\n\n${mod.content}\n\n` +
      `Format with clear headings, code examples, key takeaways, and a brief comprehension check.`;
    onSendToChat(prompt);
  };

  const handleGenerateExercise = () => {
    const prompt =
      `You are an expert programming tutor. Create a hands-on exercise for "${mod.title}" ` +
      `in the learning path "${pathTitle}".\n\n${mod.content}\n\n` +
      `Include: problem statement, starter code, hints, and expected output.`;
    onSendToChat(prompt);
  };

  const handleGenerateQuiz = () => {
    const prompt =
      `You are a quiz generator. Create a quiz for "${mod.title}" ` +
      `in the learning path "${pathTitle}".\n\n${mod.content}\n\n` +
      `Generate exactly 5 multiple-choice questions with 4 options each (A-D). ` +
      `Mark the correct answer for each.`;
    onSendToChat(prompt);
  };

  const handleGenerateProject = () => {
    const prompt =
      `You are an expert project mentor. Create a guided project for "${mod.title}" ` +
      `in the learning path "${pathTitle}".\n\n${mod.content}\n\n` +
      `Include: project overview, milestones with checkpoints, tech stack, ` +
      `step-by-step guidance, and stretch goals.`;
    onSendToChat(prompt);
  };

  const handleQuizSubmit = (answers: string[]) => {
    const prompt =
      `You are a quiz evaluator for "${mod.title}" in "${pathTitle}".\n\n` +
      `Student answers:\n${answers.map((a, i) => `Q${i + 1}: ${a}`).join("\n")}\n\n` +
      `Original quiz instructions: ${mod.content}\n\n` +
      `Evaluate each answer, provide a score out of 5 as a percentage, ` +
      `explain correct/incorrect answers, and suggest areas to review.`;
    onSendToChat(prompt);
    onComplete(Math.round((answers.filter((a) => a.trim()).length / 5) * 100));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-5">
        {/* Module header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border ${
                mod.completed
                  ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                  : "bg-blade-accent/20 text-blade-accent border-blade-accent/30"
              }`}
            >
              {mod.completed ? "Completed" : MODULE_TYPE_LABELS[mod.type]}
            </span>
            {mod.score !== null && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Score: {mod.score}%
              </span>
            )}
          </div>
          <h2 className="text-lg font-semibold text-blade-text">{mod.title}</h2>
          <p className="text-sm text-blade-muted leading-relaxed">{mod.content}</p>
        </div>

        {/* Action area based on module type */}
        <div className="border border-blade-border rounded-xl p-4 space-y-3 bg-blade-surface/50">
          {mod.type === "lesson" && (
            <>
              <p className="text-xs text-blade-muted">
                Send to Blade AI to generate an interactive lesson on this topic.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateLesson}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             bg-blade-accent text-white hover:opacity-90 transition-opacity"
                >
                  <LucideIcon name="sparkles" size={14} />
                  Generate Lesson
                </button>
                {!mod.completed && (
                  <button
                    onClick={() => onComplete()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  >
                    <LucideIcon name="check" size={14} />
                    Mark Complete
                  </button>
                )}
              </div>
            </>
          )}

          {mod.type === "exercise" && (
            <>
              <p className="text-xs text-blade-muted">
                Generate a hands-on coding exercise. Work through it and mark complete when done.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateExercise}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             bg-blade-accent text-white hover:opacity-90 transition-opacity"
                >
                  <LucideIcon name="code" size={14} />
                  Generate Exercise
                </button>
                {!mod.completed && (
                  <button
                    onClick={() => onComplete()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  >
                    <LucideIcon name="check" size={14} />
                    Mark Complete
                  </button>
                )}
              </div>
            </>
          )}

          {mod.type === "quiz" && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={handleGenerateQuiz}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             bg-blade-accent text-white hover:opacity-90 transition-opacity"
                >
                  <LucideIcon name="help-circle" size={14} />
                  Generate Quiz
                </button>
              </div>
              <QuizView mod={mod} onSubmit={handleQuizSubmit} />
            </>
          )}

          {mod.type === "project" && (
            <>
              <p className="text-xs text-blade-muted">
                Start a guided project with milestones, checkpoints, and step-by-step instructions.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleGenerateProject}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                             bg-blade-accent text-white hover:opacity-90 transition-opacity"
                >
                  <LucideIcon name="folder-kanban" size={14} />
                  Start Project
                </button>
                {!mod.completed && (
                  <button
                    onClick={() => onComplete()}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                               border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                  >
                    <LucideIcon name="check" size={14} />
                    Mark Complete
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        {/* Notes section */}
        <div className="space-y-2">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="flex items-center gap-1.5 text-xs text-blade-muted hover:text-blade-text transition-colors"
          >
            <LucideIcon name="file-text" size={12} />
            {showNotes ? "Hide Notes" : "Show Notes"}
            {mod.notes && <span className="text-blade-accent ml-1">(has notes)</span>}
          </button>
          {showNotes && (
            <textarea
              value={mod.notes}
              onChange={(e) => onUpdateNotes(e.target.value)}
              placeholder="Write your notes here..."
              rows={5}
              className="w-full bg-blade-surface border border-blade-border rounded-xl px-3 py-2.5
                         text-sm text-blade-text placeholder:text-blade-muted/50 resize-y
                         focus:outline-none focus:border-blade-accent/50 transition-colors"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Create Custom Path Dialog ───────────────────────────────────────

function CreatePathDialog({
  onClose,
  onSendToChat,
  onCreate,
}: {
  onClose: () => void;
  onSendToChat: (prompt: string) => void;
  onCreate: (
    title: string,
    description: string,
    category: PathCategory,
    icon: string,
    modules: Array<{ title: string; type: LearningModule["type"]; content: string }>
  ) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<PathCategory>("custom");
  const [icon, setIcon] = useState("📚");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleCreateWithAI = () => {
    const prompt =
      `I want to learn: "${title}"${description ? ` — ${description}` : ""}.\n\n` +
      `Generate a structured learning path with 5-8 modules. For each module, provide:\n` +
      `1. Title\n2. Type (lesson, exercise, quiz, or project)\n3. A detailed content prompt\n\n` +
      `Mix different module types for varied learning. Start with fundamentals and progress to advanced topics.`;
    onSendToChat(prompt);
    onClose();
  };

  const handleCreateManual = () => {
    if (!title.trim()) return;
    // Create a basic path with placeholder modules
    onCreate(title.trim(), description.trim(), category, icon, [
      { title: "Introduction", type: "lesson", content: `Teach the fundamentals of ${title}. Cover key concepts, terminology, and why this topic matters.` },
      { title: "Core Concepts", type: "lesson", content: `Teach the core concepts of ${title} in depth with practical examples and code where relevant.` },
      { title: "Hands-On Practice", type: "exercise", content: `Create practical exercises for ${title}. Include problem statements, starter code, and expected outcomes.` },
      { title: "Knowledge Check", type: "quiz", content: `Generate 5 multiple-choice questions testing understanding of ${title} fundamentals and core concepts.` },
      { title: "Capstone Project", type: "project", content: `Guide a capstone project applying ${title} skills. Include milestones, checkpoints, and stretch goals.` },
    ]);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-blade-surface border border-blade-border rounded-2xl p-5 max-w-md w-full mx-4 space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-blade-text">
            Create Custom Learning Path
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-blade-muted hover:text-blade-text transition-colors"
          >
            <LucideIcon name="x" size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-10 h-10 text-center text-xl bg-blade-surface border border-blade-border
                         rounded-xl focus:outline-none focus:border-blade-accent/50"
              maxLength={2}
            />
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What do you want to learn?"
              className="flex-1 bg-blade-surface border border-blade-border rounded-xl px-3 py-2
                         text-sm text-blade-text placeholder:text-blade-muted/50
                         focus:outline-none focus:border-blade-accent/50 transition-colors"
            />
          </div>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe your learning goals (optional)"
            rows={3}
            className="w-full bg-blade-surface border border-blade-border rounded-xl px-3 py-2.5
                       text-sm text-blade-text placeholder:text-blade-muted/50 resize-none
                       focus:outline-none focus:border-blade-accent/50 transition-colors"
          />

          <div>
            <label className="text-xs text-blade-muted mb-1.5 block">Category</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CATEGORY_LABELS) as PathCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                    category === cat
                      ? CATEGORY_COLORS[cat]
                      : "border-blade-border text-blade-muted hover:border-blade-accent/30"
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-xl text-sm text-blade-muted hover:text-blade-text transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateManual}
            disabled={!title.trim()}
            className="px-3 py-1.5 rounded-xl text-sm border border-blade-accent/30 text-blade-accent
                       hover:bg-blade-accent/10 transition-colors disabled:opacity-40"
          >
            Create Basic
          </button>
          <button
            onClick={handleCreateWithAI}
            disabled={!title.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium
                       bg-blade-accent text-white hover:opacity-90 transition-opacity
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <LucideIcon name="sparkles" size={12} />
            AI Generate
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stats Bar ───────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: ReturnType<typeof useLearning>["stats"] }) {
  const items = [
    { label: "Paths", value: `${stats.completedPaths}/${stats.totalPaths}` },
    { label: "Modules", value: `${stats.completedModules}/${stats.totalModules}` },
    { label: "Avg Quiz", value: stats.averageQuizScore > 0 ? `${stats.averageQuizScore}%` : "--" },
    { label: "Streak", value: stats.streakDays > 0 ? `${stats.streakDays}d` : "--" },
  ];

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-blade-border bg-blade-surface/50">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span className="text-[10px] text-blade-muted">{item.label}</span>
          <span className="text-xs font-mono font-medium text-blade-text">{item.value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Achievement Badges ──────────────────────────────────────────────

function AchievementBadges({ paths }: { paths: LearningPath[] }) {
  const completedPaths = paths.filter((p) => p.completedAt !== null);
  if (completedPaths.length === 0) return null;

  return (
    <div className="px-4 py-3 border-b border-blade-border">
      <div className="flex items-center gap-2 mb-2">
        <LucideIcon name="award" size={14} />
        <span className="text-xs font-medium text-blade-text">Achievements</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {completedPaths.map((path) => (
          <div
            key={path.id}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full
                       bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
            title={`Completed: ${path.title}`}
          >
            <span className="text-sm">{path.icon}</span>
            <span className="text-[10px] font-medium">{path.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function LearningHub({ onBack, onSendToChat }: Props) {
  const learning = useLearning();
  const {
    paths,
    activePath,
    activeModule,
    activePathId,
    activeModuleId,
    createPath,
    deletePath,
    startModule,
    completeModule,
    updateModuleNotes,
    resetPath,
    stats,
    setActivePathId,
    setActiveModuleId,
  } = learning;

  const [filterCategory, setFilterCategory] = useState<PathCategory | "all">("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredPaths = useMemo(() => {
    let result = paths;
    if (filterCategory !== "all") {
      result = result.filter((p) => p.category === filterCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [paths, filterCategory, searchQuery]);

  const handleStartPath = useCallback(
    (pathId: string) => {
      const path = paths.find((p) => p.id === pathId);
      if (!path) return;
      // Find first incomplete module, or first module
      const firstIncomplete = path.modules.find((m) => !m.completed);
      const target = firstIncomplete ?? path.modules[0];
      if (target) {
        startModule(pathId, target.id);
      }
    },
    [paths, startModule]
  );

  const handleBack = useCallback(() => {
    if (activeModuleId) {
      setActiveModuleId(null);
    } else if (activePathId) {
      setActivePathId(null);
    } else {
      onBack();
    }
  }, [activeModuleId, activePathId, setActiveModuleId, setActivePathId, onBack]);

  // ── Active module view ──────────────────────────────────────────
  if (activePath && activeModule) {
    return (
      <div className="flex flex-col h-full bg-blade-bg">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border">
          <button
            onClick={handleBack}
            className="p-1.5 rounded-xl text-blade-muted hover:text-blade-text
                       hover:bg-white/5 transition-colors"
          >
            <LucideIcon name="arrow-left" size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-blade-text truncate">
              {activePath.title}
            </h2>
            <div className="flex items-center gap-2 mt-0.5">
              <ProgressBar percent={activePath.progress} size="sm" />
              <span className="text-[10px] text-blade-muted shrink-0">
                {activePath.progress}%
              </span>
            </div>
          </div>
        </div>

        {/* Content area with sidebar */}
        <div className="flex flex-1 overflow-hidden">
          <ModuleSidebar
            path={activePath}
            activeModuleId={activeModuleId}
            onSelect={(id) => setActiveModuleId(id)}
          />
          <ModuleView
            mod={activeModule}
            pathTitle={activePath.title}
            onSendToChat={onSendToChat}
            onComplete={(score) => completeModule(activeModule.id, score)}
            onUpdateNotes={(notes) => updateModuleNotes(activeModule.id, notes)}
          />
        </div>
      </div>
    );
  }

  // ── Path browser view ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-blade-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border">
        <button
          onClick={handleBack}
          className="p-1.5 rounded-xl text-blade-muted hover:text-blade-text
                     hover:bg-white/5 transition-colors"
        >
          <LucideIcon name="arrow-left" size={16} />
        </button>
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-blade-text">Learning</h2>
          <p className="text-[10px] text-blade-muted">
            Structured learning paths powered by AI
          </p>
        </div>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                     bg-blade-accent text-white hover:opacity-90 transition-opacity"
        >
          <LucideIcon name="plus" size={12} />
          Custom Path
        </button>
      </div>

      <StatsBar stats={stats} />
      <AchievementBadges paths={paths} />

      {/* Search & Filter */}
      <div className="px-4 py-3 space-y-2 border-b border-blade-border">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search learning paths..."
          className="w-full bg-blade-surface border border-blade-border rounded-xl px-3 py-2
                     text-sm text-blade-text placeholder:text-blade-muted/50
                     focus:outline-none focus:border-blade-accent/50 transition-colors"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFilterCategory("all")}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
              filterCategory === "all"
                ? "bg-blade-accent/20 text-blade-accent border-blade-accent/30"
                : "border-blade-border text-blade-muted hover:border-blade-accent/30"
            }`}
          >
            All
          </button>
          {(Object.keys(CATEGORY_LABELS) as PathCategory[]).map((cat) => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${
                filterCategory === cat
                  ? CATEGORY_COLORS[cat]
                  : "border-blade-border text-blade-muted hover:border-blade-accent/30"
              }`}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* Path grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredPaths.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-blade-muted">
            <LucideIcon name="book-open" size={32} />
            <p className="text-sm mt-3">No paths found</p>
            <p className="text-xs mt-1">Try a different filter or create a custom path</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredPaths.map((path) => (
              <PathCard
                key={path.id}
                path={path}
                onStart={handleStartPath}
                onDelete={deletePath}
                onReset={resetPath}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreateDialog && (
        <CreatePathDialog
          onClose={() => setShowCreateDialog(false)}
          onSendToChat={onSendToChat}
          onCreate={createPath}
        />
      )}
    </div>
  );
}
