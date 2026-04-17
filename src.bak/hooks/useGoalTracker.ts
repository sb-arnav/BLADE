import { useState, useCallback, useMemo, useEffect } from "react";

/**
 * AI Coach & Goal Tracker — Set goals, track progress, get AI coaching and accountability.
 *
 * Built because users said:
 * "I set goals but never follow through — need accountability"
 * "AI could coach me through obstacles instead of just answering questions"
 *
 * Goal CRUD, milestone tracking, check-in timeline, streak counting,
 * AI coaching prompts, pattern insights, category overviews.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type GoalCategory = "career" | "health" | "learning" | "financial" | "creative" | "personal" | "custom";
export type GoalStatus = "active" | "completed" | "paused" | "abandoned";
export type GoalPriority = "low" | "medium" | "high";
export type CoachingType = "check-in" | "obstacle" | "celebration" | "planning" | "review";

export interface Milestone {
  id: string;
  title: string;
  completed: boolean;
  targetDate: string | null;
  completedAt: number | null;
}

export interface CheckIn {
  id: string;
  date: string;
  progress: number;
  notes: string;
  mood: number;
}

export interface Goal {
  id: string;
  title: string;
  description: string;
  category: GoalCategory;
  targetDate: string | null;
  progress: number;
  milestones: Milestone[];
  checkIns: CheckIn[];
  status: GoalStatus;
  priority: GoalPriority;
  icon: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  streak: number;
  aiInsights: string[];
}

export interface CoachingSession {
  id: string;
  goalId: string;
  type: CoachingType;
  prompt: string;
  response: string;
  timestamp: number;
}

export interface GoalStats {
  totalGoals: number;
  activeGoals: number;
  completedGoals: number;
  avgProgress: number;
  longestStreak: number;
  totalMilestones: number;
  completedMilestones: number;
  totalCheckIns: number;
  thisWeekCheckIns: number;
  categoryBreakdown: Record<GoalCategory, number>;
}

export interface GoalOverview {
  goal: Goal;
  daysRemaining: number | null;
  milestoneProgress: string;
  lastCheckIn: CheckIn | null;
  needsAttention: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-goals";
const SESSIONS_KEY = "blade-coaching-sessions";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((db - da) / 86400000);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Category Metadata ───────────────────────────────────────────────────────

export const CATEGORY_META: Record<GoalCategory, { label: string; icon: string; color: string }> = {
  career:    { label: "Career",    icon: "\uD83D\uDCBC", color: "#6366f1" },
  health:    { label: "Health",    icon: "\uD83C\uDFCB\uFE0F", color: "#10b981" },
  learning:  { label: "Learning",  icon: "\uD83D\uDCDA", color: "#f59e0b" },
  financial: { label: "Financial", icon: "\uD83D\uDCB0", color: "#06b6d4" },
  creative:  { label: "Creative",  icon: "\uD83C\uDFA8", color: "#ec4899" },
  personal:  { label: "Personal",  icon: "\u2B50",       color: "#8b5cf6" },
  custom:    { label: "Custom",    icon: "\uD83C\uDFAF", color: "#64748b" },
};

// ── Goal Templates ──────────────────────────────────────────────────────────

export interface GoalTemplate {
  title: string;
  description: string;
  category: GoalCategory;
  icon: string;
  color: string;
  milestones: string[];
}

export const GOAL_TEMPLATES: GoalTemplate[] = [
  // Career
  { title: "Get Promoted", description: "Work toward a promotion at my current role", category: "career", icon: "\uD83D\uDE80", color: "#6366f1", milestones: ["Discuss goals with manager", "Take on stretch project", "Complete performance review", "Present impact summary", "Request promotion meeting", "Negotiate offer"] },
  { title: "Switch Careers", description: "Transition into a new career field", category: "career", icon: "\uD83D\uDD04", color: "#4f46e5", milestones: ["Research target industry", "Identify skill gaps", "Complete online course", "Update resume & portfolio", "Network with 10 people", "Apply to 20 positions"] },
  // Health
  { title: "Run a Marathon", description: "Train for and complete a full marathon", category: "health", icon: "\uD83C\uDFC3", color: "#10b981", milestones: ["Run 5K comfortably", "Run 10K", "Complete half marathon", "Hit 40 miles/week", "Taper week", "Race day"] },
  { title: "Daily Meditation", description: "Build a consistent daily meditation practice", category: "health", icon: "\uD83E\uDDD8", color: "#059669", milestones: ["Meditate 5 min/day for a week", "Increase to 10 min", "Try 3 different techniques", "Complete 30-day streak", "Increase to 20 min", "Maintain 60-day streak"] },
  // Learning
  { title: "Learn a Language", description: "Achieve conversational fluency in a new language", category: "learning", icon: "\uD83C\uDF0D", color: "#f59e0b", milestones: ["Learn 500 basic words", "Complete beginner course", "Hold 5-min conversation", "Read a short article", "Watch show without subtitles", "Pass proficiency test"] },
  { title: "Master a Framework", description: "Become proficient in a new programming framework", category: "learning", icon: "\uD83D\uDCBB", color: "#d97706", milestones: ["Complete tutorial", "Build todo app", "Understand core concepts", "Build real project", "Contribute to open source", "Teach someone else"] },
  // Financial
  { title: "Build Emergency Fund", description: "Save 6 months of living expenses", category: "financial", icon: "\uD83C\uDFE6", color: "#06b6d4", milestones: ["Calculate monthly expenses", "Save 1 month", "Save 2 months", "Save 3 months", "Save 4-5 months", "Reach 6-month goal"] },
  { title: "Pay Off Debt", description: "Eliminate outstanding debts systematically", category: "financial", icon: "\uD83D\uDCC9", color: "#0891b2", milestones: ["List all debts", "Create repayment plan", "Pay off smallest debt", "Reach 25% paid", "Reach 50% paid", "Debt free"] },
  // Creative
  { title: "Write a Book", description: "Complete and publish a book", category: "creative", icon: "\uD83D\uDCD6", color: "#ec4899", milestones: ["Outline chapters", "Write 10,000 words", "Complete first draft", "Self-edit pass", "Get beta readers", "Final polish & publish"] },
  { title: "Launch a Side Project", description: "Ship a creative side project from idea to launch", category: "creative", icon: "\uD83D\uDCA1", color: "#db2777", milestones: ["Define concept & scope", "Create prototype", "Build MVP", "Get 10 beta users", "Iterate on feedback", "Public launch"] },
  // Personal
  { title: "Morning Routine", description: "Establish a productive morning routine", category: "personal", icon: "\uD83C\uDF05", color: "#8b5cf6", milestones: ["Wake at target time 5 days", "Add exercise block", "Add reading/journaling", "Maintain 2-week streak", "Optimize routine", "Maintain 30-day streak"] },
  { title: "Digital Declutter", description: "Organize digital life and reduce screen time", category: "personal", icon: "\uD83D\uDCF1", color: "#7c3aed", milestones: ["Audit subscriptions", "Clean up email inbox", "Organize files & photos", "Set screen time limits", "Delete unused apps", "Maintain for 30 days"] },
];

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useGoalTracker() {
  const [goals, setGoals] = useState<Goal[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [sessions] = useState<CoachingSession[]>(() => {
    try {
      const raw = localStorage.getItem(SESSIONS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  const [activeGoalId, setActiveGoalId] = useState<string | null>(null);

  // Persist
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(goals)); }, [goals]);
  useEffect(() => { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); }, [sessions]);

  // ── Active goal ──────────────────────────────────────────────────────────
  const activeGoal = useMemo(() => goals.find((g) => g.id === activeGoalId) ?? null, [goals, activeGoalId]);

  const setActiveGoal = useCallback((id: string | null) => setActiveGoalId(id), []);

  // ── CRUD ─────────────────────────────────────────────────────────────────

  const createGoal = useCallback((data: Partial<Goal> & Pick<Goal, "title">): Goal => {
    const now = Date.now();
    const cat = data.category ?? "custom";
    const meta = CATEGORY_META[cat];
    const goal: Goal = {
      id: uid(),
      title: data.title,
      description: data.description ?? "",
      category: cat,
      targetDate: data.targetDate ?? null,
      progress: 0,
      milestones: data.milestones ?? [],
      checkIns: [],
      status: "active",
      priority: data.priority ?? "medium",
      icon: data.icon ?? meta.icon,
      color: data.color ?? meta.color,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      streak: 0,
      aiInsights: [],
    };
    setGoals((prev) => [goal, ...prev]);
    return goal;
  }, []);

  const updateGoal = useCallback((id: string, patch: Partial<Goal>) => {
    setGoals((prev) => prev.map((g) => g.id === id ? { ...g, ...patch, updatedAt: Date.now() } : g));
  }, []);

  const deleteGoal = useCallback((id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    if (activeGoalId === id) setActiveGoalId(null);
  }, [activeGoalId]);

  // ── Milestones ───────────────────────────────────────────────────────────

  const addMilestone = useCallback((goalId: string, title: string, targetDate?: string | null) => {
    const ms: Milestone = { id: uid(), title, completed: false, targetDate: targetDate ?? null, completedAt: null };
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const milestones = [...g.milestones, ms];
      const progress = calcProgressFromMilestones(milestones);
      return { ...g, milestones, progress, updatedAt: Date.now() };
    }));
  }, []);

  const completeMilestone = useCallback((goalId: string, milestoneId: string) => {
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const milestones = g.milestones.map((m) =>
        m.id === milestoneId ? { ...m, completed: !m.completed, completedAt: m.completed ? null : Date.now() } : m
      );
      const progress = calcProgressFromMilestones(milestones);
      const isComplete = progress === 100 && milestones.length > 0;
      return {
        ...g,
        milestones,
        progress,
        status: isComplete ? "completed" as GoalStatus : g.status,
        completedAt: isComplete ? Date.now() : g.completedAt,
        updatedAt: Date.now(),
      };
    }));
  }, []);

  // ── Check-ins ────────────────────────────────────────────────────────────

  const addCheckIn = useCallback((goalId: string, progress: number, notes: string, mood: number) => {
    const ci: CheckIn = { id: uid(), date: todayStr(), progress, notes, mood };
    setGoals((prev) => prev.map((g) => {
      if (g.id !== goalId) return g;
      const checkIns = [...g.checkIns, ci];
      const streak = calcStreak(checkIns);
      return { ...g, checkIns, progress, streak, updatedAt: Date.now() };
    }));
  }, []);

  // ── Coaching Prompts ─────────────────────────────────────────────────────

  const generateCoachingPrompt = useCallback((goalId: string, type: CoachingType): string => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return "";

    const recentCheckIns = goal.checkIns.slice(-5);
    const completedMs = goal.milestones.filter((m) => m.completed).length;
    const totalMs = goal.milestones.length;
    const daysActive = Math.max(1, daysBetween(new Date(goal.createdAt).toISOString().slice(0, 10), todayStr()));
    const daysLeft = goal.targetDate ? daysBetween(todayStr(), goal.targetDate) : null;

    const context = [
      `Goal: "${goal.title}" (${goal.category})`,
      `Description: ${goal.description || "No description"}`,
      `Progress: ${goal.progress}%`,
      `Milestones: ${completedMs}/${totalMs} completed`,
      `Status: ${goal.status} | Priority: ${goal.priority}`,
      `Active for: ${daysActive} days | Streak: ${goal.streak} days`,
      daysLeft !== null ? `Days remaining: ${daysLeft}` : "No deadline set",
      recentCheckIns.length > 0
        ? `Recent check-ins:\n${recentCheckIns.map((ci) => `  - ${ci.date}: ${ci.progress}% | Mood: ${ci.mood}/5 | "${ci.notes}"`).join("\n")}`
        : "No check-ins yet",
    ].join("\n");

    const prompts: Record<CoachingType, string> = {
      "check-in": [
        `Act as a supportive AI coach. The user wants a progress check-in for their goal.\n`,
        context,
        `\nAsk about their recent progress, acknowledge efforts, and suggest one specific action for this week. Be warm but direct.`,
      ].join("\n"),
      "obstacle": [
        `Act as a problem-solving AI coach. The user is facing an obstacle with their goal.\n`,
        context,
        `\nHelp them identify the root cause of their block, reframe the challenge positively, and suggest 2-3 concrete strategies to overcome it. Be empathetic but action-oriented.`,
      ].join("\n"),
      "celebration": [
        `Act as an enthusiastic AI coach. The user has made progress worth celebrating!\n`,
        context,
        `\nCelebrate their achievement genuinely, highlight what they did well, and help them build on this momentum. Suggest how to leverage this win.`,
      ].join("\n"),
      "planning": [
        `Act as a strategic AI coach. The user needs help planning their next steps.\n`,
        context,
        `\nHelp them break down their next phase into specific, time-bound actions. Consider their pace so far and suggest realistic milestones. Include potential obstacles and preemptive strategies.`,
      ].join("\n"),
      "review": [
        `Act as an analytical AI coach. The user wants a comprehensive review of their goal progress.\n`,
        context,
        `\nAnalyze their trajectory: Are they on track? What patterns do you see in their check-ins? What's working and what isn't? Provide an honest assessment with specific recommendations.`,
      ].join("\n"),
    };

    return prompts[type];
  }, [goals]);

  // ── Insights ─────────────────────────────────────────────────────────────

  const getInsights = useCallback((goalId: string): string[] => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return [];
    const insights: string[] = [];
    const cis = goal.checkIns;

    if (cis.length === 0) {
      insights.push("Start tracking your progress with regular check-ins to unlock insights.");
      return insights;
    }

    // Trend analysis
    if (cis.length >= 3) {
      const recent3 = cis.slice(-3);
      const progDiff = recent3[recent3.length - 1].progress - recent3[0].progress;
      if (progDiff > 15) insights.push("Strong upward momentum! Your progress has accelerated recently.");
      else if (progDiff < -5) insights.push("Progress has dipped lately. Consider a coaching session to identify blockers.");
      else insights.push("Steady progress. Consistency is key — keep showing up.");
    }

    // Mood correlation
    if (cis.length >= 3) {
      const avgMood = cis.reduce((s, c) => s + c.mood, 0) / cis.length;
      if (avgMood >= 4) insights.push("Your mood is consistently positive — this goal energizes you.");
      else if (avgMood <= 2.5) insights.push("Low mood detected across check-ins. Consider breaking this into smaller wins.");
    }

    // Streak
    if (goal.streak >= 7) insights.push(`Impressive ${goal.streak}-day streak! Habits are forming.`);
    else if (goal.streak === 0 && cis.length > 2) insights.push("Your streak broke. A quick check-in today can restart momentum.");

    // Milestone velocity
    const completedMs = goal.milestones.filter((m) => m.completed);
    const pendingMs = goal.milestones.filter((m) => !m.completed);
    if (completedMs.length > 0 && pendingMs.length > 0) {
      const lastCompleted = completedMs[completedMs.length - 1];
      if (lastCompleted.completedAt) {
        const daysSinceMs = daysBetween(new Date(lastCompleted.completedAt).toISOString().slice(0, 10), todayStr());
        if (daysSinceMs > 14) insights.push("It's been a while since your last milestone. Time to tackle the next one!");
      }
    }

    // Deadline proximity
    if (goal.targetDate) {
      const remaining = daysBetween(todayStr(), goal.targetDate);
      if (remaining < 0) insights.push("You've passed your target date. Consider setting a new deadline or reviewing scope.");
      else if (remaining <= 7 && goal.progress < 80) insights.push("Deadline approaching fast with significant work remaining. Focus on highest-impact items.");
      else if (remaining <= 30 && goal.progress < 50) insights.push("One month left but under 50% complete. A planning session could help prioritize.");
    }

    // Check-in frequency
    if (cis.length >= 2) {
      const lastTwo = cis.slice(-2);
      const gap = daysBetween(lastTwo[0].date, lastTwo[1].date);
      if (gap > 7) insights.push("Gaps between check-ins are growing. Try setting a reminder for regular updates.");
    }

    return insights;
  }, [goals]);

  // ── Overview ─────────────────────────────────────────────────────────────

  const getOverview = useCallback((): GoalOverview[] => {
    return goals
      .filter((g) => g.status === "active")
      .map((goal) => {
        const daysRemaining = goal.targetDate ? daysBetween(todayStr(), goal.targetDate) : null;
        const completedMs = goal.milestones.filter((m) => m.completed).length;
        const totalMs = goal.milestones.length;
        const lastCheckIn = goal.checkIns.length > 0 ? goal.checkIns[goal.checkIns.length - 1] : null;
        const daysSinceCheckIn = lastCheckIn ? daysBetween(lastCheckIn.date, todayStr()) : 999;
        const needsAttention = daysSinceCheckIn > 3 || (daysRemaining !== null && daysRemaining < 7 && goal.progress < 80);
        return { goal, daysRemaining, milestoneProgress: `${completedMs}/${totalMs}`, lastCheckIn, needsAttention };
      })
      .sort((a, b) => {
        if (a.needsAttention !== b.needsAttention) return a.needsAttention ? -1 : 1;
        return (a.daysRemaining ?? 9999) - (b.daysRemaining ?? 9999);
      });
  }, [goals]);

  // ── Streak ───────────────────────────────────────────────────────────────

  const getStreak = useCallback((goalId: string): number => {
    const goal = goals.find((g) => g.id === goalId);
    return goal?.streak ?? 0;
  }, [goals]);

  // ── Stats ────────────────────────────────────────────────────────────────

  const stats = useMemo((): GoalStats => {
    const active = goals.filter((g) => g.status === "active");
    const completed = goals.filter((g) => g.status === "completed");
    const allMilestones = goals.flatMap((g) => g.milestones);
    const completedMilestones = allMilestones.filter((m) => m.completed);
    const allCheckIns = goals.flatMap((g) => g.checkIns);
    const weekAgo = daysAgo(7);
    const thisWeekCheckIns = allCheckIns.filter((ci) => ci.date >= weekAgo);

    const categoryBreakdown = {} as Record<GoalCategory, number>;
    for (const cat of Object.keys(CATEGORY_META) as GoalCategory[]) {
      categoryBreakdown[cat] = goals.filter((g) => g.category === cat).length;
    }

    return {
      totalGoals: goals.length,
      activeGoals: active.length,
      completedGoals: completed.length,
      avgProgress: active.length > 0 ? Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length) : 0,
      longestStreak: goals.reduce((max, g) => Math.max(max, g.streak), 0),
      totalMilestones: allMilestones.length,
      completedMilestones: completedMilestones.length,
      totalCheckIns: allCheckIns.length,
      thisWeekCheckIns: thisWeekCheckIns.length,
      categoryBreakdown,
    };
  }, [goals]);

  return {
    goals,
    activeGoal,
    createGoal,
    updateGoal,
    deleteGoal,
    addMilestone,
    completeMilestone,
    addCheckIn,
    setActiveGoal,
    generateCoachingPrompt,
    getInsights,
    getOverview,
    getStreak,
    stats,
    sessions,
    templates: GOAL_TEMPLATES,
  };
}

// ── Helpers (private) ───────────────────────────────────────────────────────

function calcProgressFromMilestones(milestones: Milestone[]): number {
  if (milestones.length === 0) return 0;
  const done = milestones.filter((m) => m.completed).length;
  return Math.round((done / milestones.length) * 100);
}

function calcStreak(checkIns: CheckIn[]): number {
  if (checkIns.length === 0) return 0;
  const dates = [...new Set(checkIns.map((c) => c.date))].sort().reverse();
  const today = todayStr();
  if (dates[0] !== today && dates[0] !== daysAgoStr(1)) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const gap = daysBetween(dates[i], dates[i - 1]);
    if (gap === 1) streak++;
    else break;
  }
  return streak;
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
