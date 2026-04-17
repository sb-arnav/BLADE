import { useState, useMemo, useCallback } from "react";
import {
  useGoalTracker,
  GoalCategory,
  GoalPriority,
  CoachingType,
  Milestone,
  GoalTemplate,
  CATEGORY_META,
  GOAL_TEMPLATES,
} from "../hooks/useGoalTracker";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (prompt: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

type View = "overview" | "detail" | "create" | "categories" | "archive";

const PRIORITY_BG: Record<GoalPriority, string> = {
  low: "bg-emerald-500/10 border-emerald-500/20",
  medium: "bg-amber-500/10 border-amber-500/20",
  high: "bg-red-500/10 border-red-500/20",
};

const MOOD_LABELS = ["", "Struggling", "Difficult", "Neutral", "Good", "Excellent"];
const MOOD_EMOJI = ["", "\uD83D\uDE29", "\uD83D\uDE1E", "\uD83D\uDE10", "\uD83D\uDE0A", "\uD83E\uDD29"];

const COACHING_TYPES: { type: CoachingType; label: string; icon: string; desc: string }[] = [
  { type: "check-in", label: "Check In", icon: "\uD83D\uDCCB", desc: "Progress update & next steps" },
  { type: "obstacle", label: "Overcome Obstacle", icon: "\uD83E\uDEA8", desc: "Work through a blocker" },
  { type: "celebration", label: "Celebrate Win", icon: "\uD83C\uDF89", desc: "Acknowledge your progress" },
  { type: "planning", label: "Plan Next Steps", icon: "\uD83D\uDDFA\uFE0F", desc: "Strategic planning session" },
  { type: "review", label: "Full Review", icon: "\uD83D\uDD0D", desc: "Comprehensive progress analysis" },
];

const GOAL_ICONS = ["\uD83C\uDFAF", "\uD83D\uDE80", "\uD83D\uDCA1", "\uD83D\uDD25", "\u2B50", "\uD83C\uDFC6", "\uD83D\uDCAA", "\uD83C\uDF1F", "\uD83D\uDC8E", "\uD83C\uDF3F", "\uD83C\uDFA8", "\uD83D\uDCDA", "\uD83D\uDCBC", "\uD83C\uDFCB\uFE0F", "\uD83D\uDCB0", "\uD83C\uDF0D"];

const GOAL_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ec4899", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#64748b", "#a855f7", "#22d3ee"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ progress, size = 56, stroke = 4, color }: { progress: number; size?: number; stroke?: number; color: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(progress, 100) / 100) * circumference;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-blade-border/30" />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" className="transition-all duration-500" />
    </svg>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function GoalDashboard({ onBack, onSendToChat }: Props) {
  const tracker = useGoalTracker();
  const { goals, activeGoal, stats, createGoal, updateGoal, deleteGoal, addMilestone, completeMilestone, addCheckIn, setActiveGoal, generateCoachingPrompt, getInsights, getOverview } = tracker;

  const [view, setView] = useState<View>("overview");
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [templateFilter, setTemplateFilter] = useState<GoalCategory | null>(null);

  // Create form state
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState<GoalCategory>("personal");
  const [formPriority, setFormPriority] = useState<GoalPriority>("medium");
  const [formTargetDate, setFormTargetDate] = useState("");
  const [formIcon, setFormIcon] = useState("\uD83C\uDFAF");
  const [formColor, setFormColor] = useState("#6366f1");
  const [formMilestones, setFormMilestones] = useState<string[]>([]);
  const [milestoneDraft, setMilestoneDraft] = useState("");

  // Check-in state
  const [ciProgress, setCiProgress] = useState(50);
  const [ciNotes, setCiNotes] = useState("");
  const [ciMood, setCiMood] = useState(3);

  // New milestone state
  const [newMsTitle, setNewMsTitle] = useState("");

  const overview = useMemo(() => getOverview(), [getOverview]);
  const insights = useMemo(() => activeGoal ? getInsights(activeGoal.id) : [], [activeGoal, getInsights]);
  const completedGoals = useMemo(() => goals.filter((g) => g.status === "completed"), [goals]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setFormTitle(""); setFormDesc(""); setFormCategory("personal"); setFormPriority("medium");
    setFormTargetDate(""); setFormIcon("\uD83C\uDFAF"); setFormColor("#6366f1"); setFormMilestones([]); setMilestoneDraft("");
  }, []);

  const handleCreate = useCallback(() => {
    if (!formTitle.trim()) return;
    const milestones: Milestone[] = formMilestones.map((t) => ({
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      title: t,
      completed: false,
      targetDate: null,
      completedAt: null,
    }));
    const goal = createGoal({
      title: formTitle.trim(),
      description: formDesc.trim(),
      category: formCategory,
      priority: formPriority,
      targetDate: formTargetDate || null,
      icon: formIcon,
      color: formColor,
      milestones,
    });
    resetForm();
    setShowCreateForm(false);
    setActiveGoal(goal.id);
    setView("detail");
  }, [formTitle, formDesc, formCategory, formPriority, formTargetDate, formIcon, formColor, formMilestones, createGoal, resetForm, setActiveGoal]);

  const handleFromTemplate = useCallback((t: GoalTemplate) => {
    setFormTitle(t.title);
    setFormDesc(t.description);
    setFormCategory(t.category);
    setFormIcon(t.icon);
    setFormColor(t.color);
    setFormMilestones(t.milestones);
    setShowCreateForm(true);
  }, []);

  const handleCheckIn = useCallback(() => {
    if (!activeGoal) return;
    addCheckIn(activeGoal.id, ciProgress, ciNotes.trim(), ciMood);
    setCiProgress(activeGoal.progress);
    setCiNotes("");
    setCiMood(3);
    setShowCheckIn(false);
  }, [activeGoal, ciProgress, ciNotes, ciMood, addCheckIn]);

  const handleCoach = useCallback((type: CoachingType) => {
    if (!activeGoal) return;
    const prompt = generateCoachingPrompt(activeGoal.id, type);
    onSendToChat(prompt);
    setShowCoaching(false);
  }, [activeGoal, generateCoachingPrompt, onSendToChat]);

  const handleAddMs = useCallback(() => {
    if (!activeGoal || !newMsTitle.trim()) return;
    addMilestone(activeGoal.id, newMsTitle.trim());
    setNewMsTitle("");
  }, [activeGoal, newMsTitle, addMilestone]);

  const openDetail = useCallback((id: string) => {
    setActiveGoal(id);
    setView("detail");
    setShowCheckIn(false);
    setShowCoaching(false);
  }, [setActiveGoal]);

  // ── Weekly Summary ───────────────────────────────────────────────────────

  const weeklySummary = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().slice(0, 10);
    const goalsProgressed = goals.filter((g) => g.checkIns.some((ci) => ci.date >= weekAgoStr)).length;
    const milestonesHit = goals.flatMap((g) => g.milestones).filter((m) => m.completedAt && m.completedAt > weekAgo.getTime()).length;
    const streaksMaintained = goals.filter((g) => g.streak >= 7).length;
    return { goalsProgressed, milestonesHit, streaksMaintained };
  }, [goals]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-blade-base text-blade-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border/50">
        <div className="flex items-center gap-3">
          <button onClick={view === "overview" ? onBack : () => { setView("overview"); setActiveGoal(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blade-surface transition-colors text-blade-muted hover:text-blade-primary">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
            <h1 className="text-base font-semibold">{view === "detail" && activeGoal ? activeGoal.title : "Goal Tracker"}</h1>
            <p className="text-xs text-blade-muted">{view === "detail" && activeGoal ? `${activeGoal.progress}% complete` : `${stats.activeGoals} active goals`}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {["overview", "categories", "archive"].map((v) => (
            <button key={v} onClick={() => { setView(v as View); setActiveGoal(null); }} className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors capitalize ${view === v ? "bg-blade-accent/15 text-blade-accent" : "text-blade-muted hover:text-blade-primary hover:bg-blade-surface"}`}>
              {v}
            </button>
          ))}
          <button onClick={() => { resetForm(); setShowCreateForm(true); setView("create"); }} className="ml-1 px-3 py-1.5 text-xs rounded-lg bg-blade-accent/15 text-blade-accent hover:bg-blade-accent/25 transition-colors font-medium">
            + New Goal
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Overview View ─────────────────────────────────────────────── */}
        {view === "overview" && (
          <>
            {/* Weekly Summary */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Goals Progressed", value: weeklySummary.goalsProgressed, icon: "\uD83D\uDCC8" },
                { label: "Milestones Hit", value: weeklySummary.milestonesHit, icon: "\u2705" },
                { label: "Streaks Maintained", value: weeklySummary.streaksMaintained, icon: "\uD83D\uDD25" },
              ].map((s) => (
                <div key={s.label} className="bg-blade-surface rounded-xl p-3 border border-blade-border/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm">{s.icon}</span>
                    <span className="text-[11px] text-blade-muted">{s.label}</span>
                  </div>
                  <span className="text-2xl font-bold">{s.value}</span>
                  <span className="text-[10px] text-blade-muted ml-1">this week</span>
                </div>
              ))}
            </div>

            {/* Stats Row */}
            <div className="flex items-center gap-4 px-1">
              <span className="text-xs text-blade-muted">Avg Progress: <span className="text-blade-primary font-medium">{stats.avgProgress}%</span></span>
              <span className="text-xs text-blade-muted">Best Streak: <span className="text-blade-primary font-medium">{stats.longestStreak}d</span></span>
              <span className="text-xs text-blade-muted">Check-ins: <span className="text-blade-primary font-medium">{stats.thisWeekCheckIns} this week</span></span>
            </div>

            {/* Active Goals */}
            {overview.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">{"\uD83C\uDFAF"}</div>
                <p className="text-blade-muted text-sm mb-4">No active goals yet. Set your first goal to get started!</p>
                <button onClick={() => { resetForm(); setView("create"); }} className="px-4 py-2 rounded-lg bg-blade-accent/15 text-blade-accent text-sm hover:bg-blade-accent/25 transition-colors">
                  Create Your First Goal
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {overview.map(({ goal, daysRemaining, milestoneProgress, needsAttention }) => (
                  <button key={goal.id} onClick={() => openDetail(goal.id)} className="text-left bg-blade-surface rounded-xl p-4 border border-blade-border/30 hover:border-blade-accent/30 transition-all group relative">
                    {needsAttention && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-amber-400 animate-pulse" />}
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <ProgressRing progress={goal.progress} size={52} stroke={3} color={goal.color} />
                        <span className="absolute inset-0 flex items-center justify-center text-lg">{goal.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <h3 className="font-medium text-sm truncate">{goal.title}</h3>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_BG[goal.priority]}`}>{goal.priority}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-blade-muted">
                          <span>{CATEGORY_META[goal.category].label}</span>
                          <span className="opacity-30">|</span>
                          <span>{milestoneProgress} milestones</span>
                          {daysRemaining !== null && (
                            <>
                              <span className="opacity-30">|</span>
                              <span className={daysRemaining < 7 ? "text-amber-400" : ""}>{daysRemaining < 0 ? "Overdue" : `${daysRemaining}d left`}</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-2">
                          <div className="flex-1 h-1.5 bg-blade-border/30 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${goal.progress}%`, backgroundColor: goal.color }} />
                          </div>
                          <span className="text-xs font-medium" style={{ color: goal.color }}>{goal.progress}%</span>
                        </div>
                        {goal.streak > 0 && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 mt-1.5">{"\uD83D\uDD25"} {goal.streak} day streak</span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── Detail View ──────────────────────────────────────────────── */}
        {view === "detail" && activeGoal && (
          <>
            {/* Progress Header */}
            <div className="bg-blade-surface rounded-xl p-4 border border-blade-border/30">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <ProgressRing progress={activeGoal.progress} size={80} stroke={5} color={activeGoal.color} />
                  <span className="absolute inset-0 flex items-center justify-center text-2xl">{activeGoal.icon}</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${PRIORITY_BG[activeGoal.priority]}`}>{activeGoal.priority}</span>
                    <span className="text-[11px] text-blade-muted">{CATEGORY_META[activeGoal.category].label}</span>
                    {activeGoal.targetDate && (
                      <span className="text-[11px] text-blade-muted">Due {formatDate(activeGoal.targetDate)}</span>
                    )}
                  </div>
                  <p className="text-sm text-blade-muted mt-1">{activeGoal.description || "No description"}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <div className="flex-1 h-2 bg-blade-border/30 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${activeGoal.progress}%`, backgroundColor: activeGoal.color }} />
                    </div>
                    <span className="text-sm font-bold" style={{ color: activeGoal.color }}>{activeGoal.progress}%</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-blade-border/20">
                {activeGoal.streak > 0 && <span className="text-xs text-amber-400">{"\uD83D\uDD25"} {activeGoal.streak} day streak</span>}
                <span className="text-xs text-blade-muted">Created {formatDate(new Date(activeGoal.createdAt).toISOString().slice(0, 10))}</span>
                <div className="flex-1" />
                <select value={activeGoal.status} onChange={(e) => updateGoal(activeGoal.id, { status: e.target.value as any, completedAt: e.target.value === "completed" ? Date.now() : null })} className="text-xs bg-blade-base border border-blade-border/40 rounded-lg px-2 py-1 text-blade-primary focus:outline-none">
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                  <option value="abandoned">Abandoned</option>
                </select>
                <button onClick={() => { if (confirm("Delete this goal?")) { deleteGoal(activeGoal.id); setView("overview"); } }} className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors">
                  Delete
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <button onClick={() => { setCiProgress(activeGoal.progress); setShowCheckIn(!showCheckIn); setShowCoaching(false); }} className="flex-1 px-3 py-2.5 rounded-xl bg-blade-accent/10 text-blade-accent text-sm font-medium hover:bg-blade-accent/20 transition-colors">
                {"\uD83D\uDCCB"} Check In
              </button>
              <button onClick={() => { setShowCoaching(!showCoaching); setShowCheckIn(false); }} className="flex-1 px-3 py-2.5 rounded-xl bg-purple-500/10 text-purple-400 text-sm font-medium hover:bg-purple-500/20 transition-colors">
                {"\uD83E\uDDD1\u200D\uD83C\uDFEB"} Get Coached
              </button>
            </div>

            {/* Check-in Form */}
            {showCheckIn && (
              <div className="bg-blade-surface rounded-xl p-4 border border-blade-accent/20 space-y-3">
                <h3 className="text-sm font-medium">Daily Check-in</h3>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-blade-muted">Progress</label>
                    <span className="text-xs font-medium" style={{ color: activeGoal.color }}>{ciProgress}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={ciProgress} onChange={(e) => setCiProgress(Number(e.target.value))} className="w-full h-1.5 rounded-full appearance-none cursor-pointer" style={{ accentColor: activeGoal.color }} />
                </div>
                <div>
                  <label className="text-xs text-blade-muted block mb-1">How are you feeling about this goal?</label>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((m) => (
                      <button key={m} onClick={() => setCiMood(m)} className={`w-10 h-10 rounded-xl text-lg flex items-center justify-center transition-all ${ciMood === m ? "bg-blade-accent/15 ring-2 ring-blade-accent/40 scale-110" : "bg-blade-base hover:bg-blade-base/80 opacity-50 hover:opacity-80"}`}>
                        {MOOD_EMOJI[m]}
                      </button>
                    ))}
                    <span className="ml-2 text-xs text-blade-muted">{MOOD_LABELS[ciMood]}</span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-blade-muted block mb-1">Notes</label>
                  <textarea value={ciNotes} onChange={(e) => setCiNotes(e.target.value)} placeholder="What did you work on? Any wins or blockers?" rows={2} className="w-full bg-blade-base border border-blade-border/40 rounded-lg px-3 py-2 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40 resize-none" />
                </div>
                <button onClick={handleCheckIn} className="w-full py-2 rounded-lg bg-blade-accent text-white text-sm font-medium hover:bg-blade-accent/90 transition-colors">
                  Save Check-in
                </button>
              </div>
            )}

            {/* Coaching Menu */}
            {showCoaching && (
              <div className="bg-blade-surface rounded-xl p-4 border border-purple-500/20 space-y-2">
                <h3 className="text-sm font-medium mb-2">Choose a coaching session</h3>
                {COACHING_TYPES.map((ct) => (
                  <button key={ct.type} onClick={() => handleCoach(ct.type)} className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-blade-base transition-colors text-left">
                    <span className="text-lg">{ct.icon}</span>
                    <div>
                      <div className="text-sm font-medium">{ct.label}</div>
                      <div className="text-[11px] text-blade-muted">{ct.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Milestones */}
            <div className="bg-blade-surface rounded-xl p-4 border border-blade-border/30">
              <h3 className="text-sm font-medium mb-3">Milestones ({activeGoal.milestones.filter((m) => m.completed).length}/{activeGoal.milestones.length})</h3>
              <div className="space-y-1.5">
                {activeGoal.milestones.map((ms) => (
                  <button key={ms.id} onClick={() => completeMilestone(activeGoal.id, ms.id)} className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-blade-base transition-colors text-left group">
                    <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center text-xs transition-colors ${ms.completed ? "border-emerald-500 bg-emerald-500/20 text-emerald-400" : "border-blade-border/60 text-transparent group-hover:border-blade-accent/40"}`}>
                      {ms.completed ? "\u2713" : ""}
                    </span>
                    <span className={`text-sm flex-1 ${ms.completed ? "line-through text-blade-muted" : ""}`}>{ms.title}</span>
                    {ms.completedAt && <span className="text-[10px] text-blade-muted">{timeAgo(ms.completedAt)}</span>}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-3 pt-2 border-t border-blade-border/20">
                <input value={newMsTitle} onChange={(e) => setNewMsTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleAddMs()} placeholder="Add milestone..." className="flex-1 bg-blade-base border border-blade-border/40 rounded-lg px-2.5 py-1.5 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40" />
                <button onClick={handleAddMs} disabled={!newMsTitle.trim()} className="text-xs px-3 py-1.5 rounded-lg bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 disabled:opacity-30 transition-colors">
                  Add
                </button>
              </div>
            </div>

            {/* Check-in Timeline */}
            {activeGoal.checkIns.length > 0 && (
              <div className="bg-blade-surface rounded-xl p-4 border border-blade-border/30">
                <h3 className="text-sm font-medium mb-3">Progress Timeline</h3>
                {/* Mini chart */}
                <div className="h-20 flex items-end gap-0.5 mb-3">
                  {activeGoal.checkIns.slice(-20).map((ci) => (
                    <div key={ci.id} className="flex-1 flex flex-col items-center gap-0.5" title={`${ci.date}: ${ci.progress}%`}>
                      <div className="w-full rounded-t" style={{ height: `${Math.max(ci.progress * 0.7, 2)}px`, backgroundColor: activeGoal.color, opacity: 0.4 + (ci.progress / 100) * 0.6 }} />
                    </div>
                  ))}
                </div>
                {/* Recent check-ins list */}
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {activeGoal.checkIns.slice().reverse().slice(0, 10).map((ci) => (
                    <div key={ci.id} className="flex items-start gap-2 text-xs">
                      <span className="text-blade-muted w-16 shrink-0">{formatDateShort(ci.date)}</span>
                      <span className="font-medium w-10 text-right" style={{ color: activeGoal.color }}>{ci.progress}%</span>
                      <span className="text-sm">{MOOD_EMOJI[ci.mood]}</span>
                      <span className="text-blade-muted flex-1 truncate">{ci.notes || "No notes"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Insights */}
            {insights.length > 0 && (
              <div className="bg-blade-surface rounded-xl p-4 border border-blade-border/30">
                <h3 className="text-sm font-medium mb-2">{"\uD83D\uDCA1"} AI Insights</h3>
                <div className="space-y-2">
                  {insights.map((insight, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-blade-muted">
                      <span className="w-1.5 h-1.5 rounded-full bg-blade-accent mt-1.5 shrink-0" />
                      <span>{insight}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Create View ──────────────────────────────────────────────── */}
        {view === "create" && (
          <>
            {/* Templates */}
            {!showCreateForm && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setTemplateFilter(null)} className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${templateFilter === null ? "bg-blade-accent/15 text-blade-accent" : "text-blade-muted hover:text-blade-primary hover:bg-blade-surface"}`}>
                    All
                  </button>
                  {(Object.keys(CATEGORY_META) as GoalCategory[]).filter((c) => c !== "custom").map((cat) => (
                    <button key={cat} onClick={() => setTemplateFilter(cat)} className={`px-2.5 py-1.5 text-xs rounded-lg transition-colors ${templateFilter === cat ? "bg-blade-accent/15 text-blade-accent" : "text-blade-muted hover:text-blade-primary hover:bg-blade-surface"}`}>
                      {CATEGORY_META[cat].icon} {CATEGORY_META[cat].label}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {GOAL_TEMPLATES.filter((t) => !templateFilter || t.category === templateFilter).map((t, i) => (
                    <button key={i} onClick={() => handleFromTemplate(t)} className="text-left bg-blade-surface rounded-xl p-4 border border-blade-border/30 hover:border-blade-accent/30 transition-all">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{t.icon}</span>
                        <h3 className="font-medium text-sm">{t.title}</h3>
                      </div>
                      <p className="text-[11px] text-blade-muted mb-2">{t.description}</p>
                      <div className="flex items-center gap-1 text-[10px] text-blade-muted">
                        <span className="px-1.5 py-0.5 rounded bg-blade-base">{CATEGORY_META[t.category].label}</span>
                        <span>{t.milestones.length} milestones</span>
                      </div>
                    </button>
                  ))}
                </div>
                <button onClick={() => { resetForm(); setShowCreateForm(true); }} className="w-full py-3 rounded-xl border-2 border-dashed border-blade-border/40 text-sm text-blade-muted hover:border-blade-accent/40 hover:text-blade-accent transition-colors">
                  + Create Custom Goal
                </button>
              </>
            )}

            {/* Create Form */}
            {showCreateForm && (
              <div className="bg-blade-surface rounded-xl p-4 border border-blade-border/30 space-y-4">
                <h3 className="text-sm font-medium">Create New Goal</h3>

                {/* Title */}
                <div>
                  <label className="text-xs text-blade-muted block mb-1">Title *</label>
                  <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="What do you want to achieve?" className="w-full bg-blade-base border border-blade-border/40 rounded-lg px-3 py-2 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40" />
                </div>

                {/* Description */}
                <div>
                  <label className="text-xs text-blade-muted block mb-1">Description</label>
                  <textarea value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Why is this goal important to you?" rows={2} className="w-full bg-blade-base border border-blade-border/40 rounded-lg px-3 py-2 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40 resize-none" />
                </div>

                {/* Category + Priority */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-blade-muted block mb-1">Category</label>
                    <select value={formCategory} onChange={(e) => { setFormCategory(e.target.value as GoalCategory); setFormIcon(CATEGORY_META[e.target.value as GoalCategory].icon); setFormColor(CATEGORY_META[e.target.value as GoalCategory].color); }} className="w-full bg-blade-base border border-blade-border/40 rounded-lg px-3 py-2 text-sm text-blade-primary focus:outline-none">
                      {(Object.keys(CATEGORY_META) as GoalCategory[]).map((cat) => (
                        <option key={cat} value={cat}>{CATEGORY_META[cat].icon} {CATEGORY_META[cat].label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-blade-muted block mb-1">Priority</label>
                    <select value={formPriority} onChange={(e) => setFormPriority(e.target.value as GoalPriority)} className="w-full bg-blade-base border border-blade-border/40 rounded-lg px-3 py-2 text-sm text-blade-primary focus:outline-none">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>

                {/* Target Date */}
                <div>
                  <label className="text-xs text-blade-muted block mb-1">Target Date (optional)</label>
                  <input type="date" value={formTargetDate} onChange={(e) => setFormTargetDate(e.target.value)} className="w-full bg-blade-base border border-blade-border/40 rounded-lg px-3 py-2 text-sm text-blade-primary focus:outline-none" />
                </div>

                {/* Icon + Color */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-blade-muted block mb-1">Icon</label>
                    <div className="flex flex-wrap gap-1">
                      {GOAL_ICONS.map((ic) => (
                        <button key={ic} onClick={() => setFormIcon(ic)} className={`w-8 h-8 rounded-lg text-sm flex items-center justify-center transition-all ${formIcon === ic ? "bg-blade-accent/15 ring-2 ring-blade-accent/40" : "bg-blade-base hover:bg-blade-base/80"}`}>
                          {ic}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-blade-muted block mb-1">Color</label>
                    <div className="flex flex-wrap gap-1">
                      {GOAL_COLORS.map((c) => (
                        <button key={c} onClick={() => setFormColor(c)} className={`w-8 h-8 rounded-lg transition-all ${formColor === c ? "ring-2 ring-white/40 scale-110" : "hover:scale-105"}`} style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>

                {/* Milestones */}
                <div>
                  <label className="text-xs text-blade-muted block mb-1">Milestones</label>
                  <div className="space-y-1.5">
                    {formMilestones.map((ms, i) => (
                      <div key={i} className="flex items-center gap-2 group">
                        <span className="w-5 h-5 rounded-md border-2 border-blade-border/40 flex items-center justify-center text-[10px] text-blade-muted">{i + 1}</span>
                        <span className="text-sm flex-1">{ms}</span>
                        <button onClick={() => setFormMilestones(formMilestones.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 text-blade-muted hover:text-red-400 text-xs transition-opacity">
                          x
                        </button>
                      </div>
                    ))}
                    <div className="flex items-center gap-2">
                      <input value={milestoneDraft} onChange={(e) => setMilestoneDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && milestoneDraft.trim()) { setFormMilestones([...formMilestones, milestoneDraft.trim()]); setMilestoneDraft(""); } }} placeholder="Add a milestone..." className="flex-1 bg-blade-base border border-blade-border/40 rounded-lg px-2.5 py-1.5 text-sm text-blade-primary placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40" />
                      <button onClick={() => { if (milestoneDraft.trim()) { setFormMilestones([...formMilestones, milestoneDraft.trim()]); setMilestoneDraft(""); } }} disabled={!milestoneDraft.trim()} className="text-xs px-2.5 py-1.5 rounded-lg bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 disabled:opacity-30 transition-colors">
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                {/* Submit */}
                <div className="flex items-center gap-2 pt-2">
                  <button onClick={() => setShowCreateForm(false)} className="flex-1 py-2 rounded-lg bg-blade-base text-sm text-blade-muted hover:text-blade-primary transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleCreate} disabled={!formTitle.trim()} className="flex-1 py-2 rounded-lg bg-blade-accent text-white text-sm font-medium hover:bg-blade-accent/90 disabled:opacity-30 transition-colors">
                    Create Goal
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Categories View ──────────────────────────────────────────── */}
        {view === "categories" && (
          <div className="space-y-4">
            {(Object.keys(CATEGORY_META) as GoalCategory[]).map((cat) => {
              const catGoals = goals.filter((g) => g.category === cat && g.status !== "abandoned");
              if (catGoals.length === 0) return null;
              const avgProgress = Math.round(catGoals.reduce((s, g) => s + g.progress, 0) / catGoals.length);
              const active = catGoals.filter((g) => g.status === "active").length;
              const completed = catGoals.filter((g) => g.status === "completed").length;
              return (
                <div key={cat} className="bg-blade-surface rounded-xl p-4 border border-blade-border/30">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{CATEGORY_META[cat].icon}</span>
                      <h3 className="font-medium text-sm">{CATEGORY_META[cat].label}</h3>
                      <span className="text-[11px] text-blade-muted">({catGoals.length} goals)</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-blade-muted">
                      <span>{active} active</span>
                      <span>{completed} done</span>
                      <span className="font-medium" style={{ color: CATEGORY_META[cat].color }}>avg {avgProgress}%</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {catGoals.map((g) => (
                      <button key={g.id} onClick={() => openDetail(g.id)} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-blade-base transition-colors text-left">
                        <span className="text-sm">{g.icon}</span>
                        <span className="text-sm flex-1 truncate">{g.title}</span>
                        <div className="w-20 h-1.5 bg-blade-border/30 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${g.progress}%`, backgroundColor: g.color }} />
                        </div>
                        <span className="text-xs text-blade-muted w-8 text-right">{g.progress}%</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${g.status === "completed" ? "bg-emerald-500/10 text-emerald-400" : g.status === "paused" ? "bg-amber-500/10 text-amber-400" : "bg-blade-accent/10 text-blade-accent"}`}>
                          {g.status}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            {goals.length === 0 && (
              <div className="text-center py-12 text-blade-muted text-sm">
                No goals to categorize yet. Create your first goal to see them organized here.
              </div>
            )}
          </div>
        )}

        {/* ── Archive View ─────────────────────────────────────────────── */}
        {view === "archive" && (
          <>
            {completedGoals.length === 0 ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">{"\uD83C\uDFC6"}</div>
                <p className="text-blade-muted text-sm">No completed goals yet. Keep going!</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-blade-muted">{completedGoals.length} completed goal{completedGoals.length !== 1 ? "s" : ""}</p>
                {completedGoals.map((g) => (
                  <button key={g.id} onClick={() => openDetail(g.id)} className="w-full text-left bg-blade-surface rounded-xl p-4 border border-blade-border/30 hover:border-emerald-500/30 transition-all">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <ProgressRing progress={100} size={44} stroke={3} color="#10b981" />
                        <span className="absolute inset-0 flex items-center justify-center text-base">{g.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium text-sm">{g.title}</h3>
                        <div className="flex items-center gap-2 text-[11px] text-blade-muted mt-0.5">
                          <span>{CATEGORY_META[g.category].label}</span>
                          <span className="opacity-30">|</span>
                          <span>{g.milestones.length} milestones</span>
                          <span className="opacity-30">|</span>
                          <span>{g.checkIns.length} check-ins</span>
                          {g.completedAt && (
                            <>
                              <span className="opacity-30">|</span>
                              <span>Completed {formatDate(new Date(g.completedAt).toISOString().slice(0, 10))}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <span className="text-emerald-400 text-xs font-medium">{"\u2713"} Done</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
