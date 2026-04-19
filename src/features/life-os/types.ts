// src/features/life-os/types.ts
// Cluster-local barrel — re-exports Tauri wrapper types + UI-only types.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-161
// @see src/lib/tauri/life_os.ts

export type {
  // health_tracker
  HealthLog,
  HealthInsight,
  HealthStats,
  // health
  ProjectHealth,
  // health_guardian
  HealthGuardianStats,
  HealthTakeBreakResult,
  // financial_brain
  FinanceTransaction,
  FinancialSnapshot,
  FinancialInsight,
  FinancialGoal,
  // goal_engine
  Goal,
  GoalSubtask,
  // habit_engine
  Habit,
  HabitLog,
  HabitInsight,
  // meeting_intelligence
  Meeting,
  MeetingActionItem,
  // social_graph
  Contact,
  Interaction,
  RelationshipInsight,
  // prediction_engine
  Prediction,
  BehaviorPattern,
  // emotional_intelligence
  EmotionalState,
  EmotionalTrend,
  // accountability
  KeyResult,
  Objective,
  DailyAction,
  DailyPlan,
  ProgressReport,
  // streak_stats
  StreakStats,
  StreakDisplay,
  // people_graph
  Person,
  // learning_engine
  UserPrediction,
} from '@/lib/tauri/life_os';

// ═══════════════════════════════════════════════════════════════════════════
// Cluster-only UI types (Plans 06-03..06 extend).
// ═══════════════════════════════════════════════════════════════════════════

/** Active tab key for tab-bearing Life OS surfaces (Finance right-pane, Meetings). */
export type LifeTabKey = string;

/** Stat card data used by HealthView + FinanceView KPI rows. */
export interface LifeStatCard {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'flat';
  hint?: string;
}
