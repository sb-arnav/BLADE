// src/lib/tauri/life_os.ts
//
// Typed wrappers for the Life OS cluster — one per registered Rust #[tauri::command]
// across health_tracker.rs, health.rs, health_guardian.rs, financial_brain.rs,
// goal_engine.rs, habit_engine.rs, meeting_intelligence.rs, social_graph.rs,
// prediction_engine.rs, emotional_intelligence.rs, accountability.rs,
// streak_stats.rs, people_graph.rs, learning_engine.rs, temporal_intel.rs
// (D-140 inventory — 14 modules, ~110 commands).
//
// D-139: per-cluster wrapper module lives HERE (life-os cluster only).
// D-140: zero Rust expansion in Phase 6 — every command below is already registered
//        in src-tauri/src/lib.rs generate_handler!.
// D-159: camelCase JS API, snake_case at invoke boundary. No raw invoke.
// D-38:  @see Rust cite in JSDoc; invokeTyped only; ESLint no-raw-tauri.
// D-160: return types mirror Rust #[derive(Serialize)] shape verbatim — snake_case
//        fields preserved to match the wire payload.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-139..D-165
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §1
// @see src-tauri/src/lib.rs:759-1282 generate_handler!

import { invokeTyped } from './_base';

// ═══════════════════════════════════════════════════════════════════════════
// Types — mirror Rust Serialize shape verbatim (snake_case preserved).
// All interfaces carry `[k: string]: unknown` for forward-compat (D-160).
// ═══════════════════════════════════════════════════════════════════════════

// ─── health_tracker.rs types ─────────────────────────────────────────────────

/** @see src-tauri/src/health_tracker.rs:23 HealthLog */
export interface HealthLog {
  id: string;
  date: string; // YYYY-MM-DD
  sleep_hours?: number | null;
  sleep_quality?: number | null; // 1-10
  energy_level?: number | null; // 1-10
  mood?: number | null; // 1-10
  exercise_minutes?: number | null;
  exercise_type?: string | null;
  water_glasses?: number | null;
  notes?: string | null;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/health_tracker.rs:38 HealthInsight */
export interface HealthInsight {
  insight_type: string;
  title: string;
  description: string;
  recommendation: string;
  urgency: string; // "low" | "medium" | "high"
  [k: string]: unknown;
}

/** @see src-tauri/src/health_tracker.rs:47 HealthStats */
export interface HealthStats {
  avg_sleep: number;
  avg_energy: number;
  avg_mood: number;
  exercise_days: number;
  total_exercise_minutes: number;
  sleep_debt: number;
  best_day_pattern: string;
  period_days: number;
  [k: string]: unknown;
}

// ─── health.rs types ─────────────────────────────────────────────────────────

/** @see src-tauri/src/health.rs:30 ProjectHealth */
export interface ProjectHealth {
  project: string;
  issues: Array<Record<string, unknown>>;
  scanned_at: number;
  files_scanned: number;
  summary: string;
  [k: string]: unknown;
}

// ─── health_guardian.rs types — returned as serde_json::Value ────────────────

export type HealthGuardianStats = Record<string, unknown>;
export type HealthTakeBreakResult = Record<string, unknown>;

// ─── financial_brain.rs types ────────────────────────────────────────────────

/** @see src-tauri/src/financial_brain.rs:31 Transaction */
export interface FinanceTransaction {
  id: string;
  amount: number;
  category: string;
  description: string;
  date: string; // YYYY-MM-DD
  tags: string[];
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/financial_brain.rs:44 FinancialSnapshot */
export interface FinancialSnapshot {
  month: string; // YYYY-MM
  income: number;
  expenses: number;
  savings_rate: number;
  top_categories: Array<[string, number]>;
  vs_last_month: Record<string, number>;
  [k: string]: unknown;
}

/** @see src-tauri/src/financial_brain.rs:54 FinancialInsight */
export interface FinancialInsight {
  insight_type: string;
  title: string;
  description: string;
  action_items: string[];
  urgency: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/financial_brain.rs:63 FinancialGoal */
export interface FinancialGoal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string;
  monthly_required: number;
  [k: string]: unknown;
}

// ─── goal_engine.rs types ────────────────────────────────────────────────────

/** @see src-tauri/src/goal_engine.rs:24 GoalSubtask */
export interface GoalSubtask {
  id: string;
  description: string;
  status: string; // "pending" | "done" | "retrying"
  attempts: number;
  last_error: string;
  result: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/goal_engine.rs:34 Goal */
export interface Goal {
  id: string;
  title: string;
  description: string;
  priority: number;
  status: string; // "active" | "in_progress" | "blocked" | "completed"
  strategy: string;
  attempts: number;
  last_error: string;
  subtasks: GoalSubtask[];
  tags: string[];
  result: string;
  created_at: number;
  last_attempted_at?: number | null;
  completed_at?: number | null;
  [k: string]: unknown;
}

// ─── habit_engine.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/habit_engine.rs:21 Habit */
export interface Habit {
  id: string;
  name: string;
  description: string;
  frequency: string;
  target_time?: string | null;
  category: string;
  current_streak: number;
  best_streak: number;
  total_completions: number;
  completion_rate: number;
  friction_score: number;
  cue: string;
  reward: string;
  created_at: number;
  active: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/habit_engine.rs:40 HabitLog */
export interface HabitLog {
  id: string;
  habit_id: string;
  date: string;
  completed: boolean;
  notes?: string | null;
  mood_after?: number | null;
  timestamp: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/habit_engine.rs:51 HabitInsight */
export interface HabitInsight {
  habit_name: string;
  insight_type: string;
  description: string;
  suggestion: string;
  [k: string]: unknown;
}

// ─── meeting_intelligence.rs types ───────────────────────────────────────────

/** @see src-tauri/src/meeting_intelligence.rs Meeting */
export interface Meeting {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  duration_minutes?: number | null;
  participants: string[];
  transcript: string;
  summary: string;
  decisions: string[];
  action_items: MeetingActionItem[];
  open_questions: string[];
  sentiment: string;
  meeting_type: string;
  created_at: number;
  [k: string]: unknown;
}

/** Generic meeting action item shape. Rust emits as typed ActionItem. */
export interface MeetingActionItem {
  description: string;
  owner?: string | null;
  due_date?: string | null;
  completed: boolean;
  [k: string]: unknown;
}

// ─── social_graph.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/social_graph.rs:31 Contact */
export interface Contact {
  id: string;
  name: string;
  aliases: string[];
  relationship_type: string;
  traits: string[];
  interests: string[];
  communication_style: string;
  interaction_count: number;
  last_interaction?: number | null;
  relationship_strength: number;
  notes: string;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/social_graph.rs:50 Interaction */
export interface Interaction {
  id: string;
  contact_id: string;
  summary: string;
  sentiment: string;
  topics: string[];
  action_items: string[];
  timestamp: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/social_graph.rs:63 RelationshipInsight */
export interface RelationshipInsight {
  contact_name: string;
  insight_type: string; // "drift" | "follow_up" | "strengthen"
  description: string;
  suggested_action: string;
  [k: string]: unknown;
}

// ─── prediction_engine.rs types ──────────────────────────────────────────────

/** @see src-tauri/src/prediction_engine.rs:33 Prediction */
export interface Prediction {
  id: string;
  prediction_type: string;
  title: string;
  description: string;
  action?: string | null;
  confidence: number;
  time_window: string;
  was_helpful?: boolean | null;
  created_at: number;
  shown_at?: number | null;
  accepted: boolean;
  [k: string]: unknown;
}

/** @see src-tauri/src/prediction_engine.rs:48 BehaviorPattern */
export interface BehaviorPattern {
  pattern_type: string;
  description: string;
  trigger: string;
  expected_action: string;
  confidence: number;
  occurrences: number;
  [k: string]: unknown;
}

// ─── emotional_intelligence.rs types ─────────────────────────────────────────

/** @see src-tauri/src/emotional_intelligence.rs:22 EmotionalState */
export interface EmotionalState {
  primary_emotion: string;
  valence: number;
  arousal: number;
  confidence: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/emotional_intelligence.rs:38 EmotionalTrend */
export interface EmotionalTrend {
  period: string;
  avg_valence: number;
  dominant_emotion: string;
  notable_shifts: string[];
  recommendation: string;
  [k: string]: unknown;
}

// ─── accountability.rs types ─────────────────────────────────────────────────

/** @see src-tauri/src/accountability.rs:16 KeyResult */
export interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  metric: string;
  target_value: number;
  current_value: number;
  unit: string;
  status: string;
  last_updated: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/accountability.rs:29 Objective */
export interface Objective {
  id: string;
  title: string;
  description: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  status: string;
  key_results: KeyResult[];
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/accountability.rs:43 DailyAction */
export interface DailyAction {
  id: string;
  date: string;
  title: string;
  objective_id?: string | null;
  completed: boolean;
  completed_at?: number | null;
  energy_level: string;
  created_at: number;
  [k: string]: unknown;
}

/** @see src-tauri/src/accountability.rs:67 DailyPlan */
export interface DailyPlan {
  date: string;
  actions: DailyAction[];
  focus_objective?: Objective | null;
  energy_recommendation: string;
  blade_message: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/accountability.rs:76 ProgressReport */
export interface ProgressReport {
  period: string;
  objectives_summary: Array<Record<string, unknown>>;
  wins: string[];
  blockers: string[];
  recommendations: string[];
  score: number;
  [k: string]: unknown;
}

// ─── streak_stats.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/streak_stats.rs:13 StreakStats */
export interface StreakStats {
  current_streak: number;
  longest_streak: number;
  total_active_days: number;
  total_conversations: number;
  total_messages: number;
  tools_used_count: number;
  facts_known: number;
  [k: string]: unknown;
}

/** streak_get_display returns a free-form serde_json::Value display payload. */
export type StreakDisplay = Record<string, unknown>;

// ─── people_graph.rs types ───────────────────────────────────────────────────

/** @see src-tauri/src/people_graph.rs:12 Person */
export interface Person {
  id: string;
  name: string;
  relationship: string;
  communication_style: string;
  platform: string;
  topics: string[];
  last_interaction: number;
  interaction_count: number;
  notes: string;
  [k: string]: unknown;
}

// ─── learning_engine.rs types ────────────────────────────────────────────────

/** @see src-tauri/src/learning_engine.rs:40 UserPrediction */
export interface UserPrediction {
  id: string;
  prediction: string;
  context: string;
  confidence: number;
  created_at: number;
  fulfilled: boolean;
  [k: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// health_tracker.rs — 9 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/health_tracker.rs:769 health_log
 * Rust signature: `health_log(log: HealthLog) -> Result<String, String>` — takes the full HealthLog struct.
 */
export function healthLog(log: HealthLog): Promise<string> {
  return invokeTyped<string, { log: HealthLog }>('health_log', { log });
}

/**
 * @see src-tauri/src/health_tracker.rs:776 health_get_today
 * Returns Option<HealthLog> — surfaces as `HealthLog | null`.
 */
export function healthGetToday(): Promise<HealthLog | null> {
  return invokeTyped<HealthLog | null>('health_get_today', {});
}

/**
 * @see src-tauri/src/health_tracker.rs:781 health_update_today
 * Rust signature: `health_update_today(updates: serde_json::Value) -> Result<(), String>`.
 */
export function healthUpdateToday(updates: Record<string, unknown>): Promise<void> {
  return invokeTyped<void, { updates: Record<string, unknown> }>('health_update_today', {
    updates,
  });
}

/**
 * @see src-tauri/src/health_tracker.rs:786 health_get_logs
 * Rust signature: `health_get_logs(days_back: i32) -> Vec<HealthLog>`.
 */
export function healthGetLogs(daysBack: number): Promise<HealthLog[]> {
  return invokeTyped<HealthLog[], { days_back: number }>('health_get_logs', {
    days_back: daysBack,
  });
}

/**
 * @see src-tauri/src/health_tracker.rs:791 health_get_stats
 * Rust signature: `health_get_stats(days_back: i32) -> HealthStats`.
 */
export function healthGetStats(daysBack: number): Promise<HealthStats> {
  return invokeTyped<HealthStats, { days_back: number }>('health_get_stats', {
    days_back: daysBack,
  });
}

/**
 * @see src-tauri/src/health_tracker.rs:796 health_get_insights
 * Rust signature: `health_get_insights(days_back: i32) -> Vec<HealthInsight>`.
 */
export function healthGetInsights(daysBack: number): Promise<HealthInsight[]> {
  return invokeTyped<HealthInsight[], { days_back: number }>('health_get_insights', {
    days_back: daysBack,
  });
}

/** @see src-tauri/src/health_tracker.rs:801 health_get_context */
export function healthGetContext(): Promise<string> {
  return invokeTyped<string>('health_get_context', {});
}

/**
 * @see src-tauri/src/health_tracker.rs:806 health_correlate_productivity
 * Rust signature: `health_correlate_productivity(days_back: i32) -> String`.
 */
export function healthCorrelateProductivity(daysBack: number): Promise<string> {
  return invokeTyped<string, { days_back: number }>('health_correlate_productivity', {
    days_back: daysBack,
  });
}

/**
 * @see src-tauri/src/health_tracker.rs:811 health_streak_info
 * Returns serde_json::Value; surfaced as Record.
 */
export function healthStreakInfo(): Promise<Record<string, unknown>> {
  return invokeTyped<Record<string, unknown>>('health_streak_info', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// health.rs — 3 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/health.rs:348 health_get_scan
 * Rust signature: `health_get_scan(project: String) -> Option<ProjectHealth>`.
 */
export function healthGetScan(project: string): Promise<ProjectHealth | null> {
  return invokeTyped<ProjectHealth | null, { project: string }>('health_get_scan', {
    project,
  });
}

/**
 * @see src-tauri/src/health.rs:354 health_scan_now
 * Rust signature: `health_scan_now(project: String, root_path: String) -> ProjectHealth`.
 */
export function healthScanNow(args: { project: string; rootPath: string }): Promise<ProjectHealth> {
  return invokeTyped<ProjectHealth, { project: string; root_path: string }>('health_scan_now', {
    project: args.project,
    root_path: args.rootPath,
  });
}

/** @see src-tauri/src/health.rs:363 health_summary_all */
export function healthSummaryAll(): Promise<string[]> {
  return invokeTyped<string[]>('health_summary_all', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// health_guardian.rs — 2 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/health_guardian.rs:307 health_guardian_stats
 * Returns serde_json::Value with screen-time / break data.
 */
export function healthGuardianStats(): Promise<HealthGuardianStats> {
  return invokeTyped<HealthGuardianStats>('health_guardian_stats', {});
}

/**
 * @see src-tauri/src/health_guardian.rs:312 health_take_break
 * Returns serde_json::Value acknowledgement.
 */
export function healthTakeBreak(): Promise<HealthTakeBreakResult> {
  return invokeTyped<HealthTakeBreakResult>('health_take_break', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// financial_brain.rs — 15 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/financial_brain.rs:707 finance_add_transaction
 * Rust signature: `finance_add_transaction(amount: f64, category: Option<String>,
 *   description: String, date: String, tags: Option<Vec<String>>) -> Result<String, String>`.
 */
export function financeAddTransaction(args: {
  amount: number;
  description: string;
  date: string;
  category?: string;
  tags?: string[];
}): Promise<string> {
  return invokeTyped<
    string,
    { amount: number; category?: string; description: string; date: string; tags?: string[] }
  >('finance_add_transaction', {
    amount: args.amount,
    category: args.category,
    description: args.description,
    date: args.date,
    tags: args.tags,
  });
}

/**
 * @see src-tauri/src/financial_brain.rs:729 finance_get_transactions
 * Rust signature: `finance_get_transactions(start_date: String, end_date: String,
 *   category: Option<String>) -> Vec<Transaction>`.
 */
export function financeGetTransactions(args: {
  startDate: string;
  endDate: string;
  category?: string;
}): Promise<FinanceTransaction[]> {
  return invokeTyped<
    FinanceTransaction[],
    { start_date: string; end_date: string; category?: string }
  >('finance_get_transactions', {
    start_date: args.startDate,
    end_date: args.endDate,
    category: args.category,
  });
}

/** @see src-tauri/src/financial_brain.rs:739 finance_delete_transaction */
export function financeDeleteTransaction(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('finance_delete_transaction', { id });
}

/**
 * @see src-tauri/src/financial_brain.rs:744 finance_get_snapshot
 * Rust signature: `finance_get_snapshot(month: String) -> FinancialSnapshot` (month is "YYYY-MM").
 */
export function financeGetSnapshot(month: string): Promise<FinancialSnapshot> {
  return invokeTyped<FinancialSnapshot, { month: string }>('finance_get_snapshot', { month });
}

/**
 * @see src-tauri/src/financial_brain.rs:750 finance_generate_insights
 * Rust signature: `finance_generate_insights(months_back: Option<usize>) -> Vec<FinancialInsight>`.
 */
export function financeGenerateInsights(monthsBack?: number): Promise<FinancialInsight[]> {
  return invokeTyped<FinancialInsight[], { months_back?: number }>('finance_generate_insights', {
    months_back: monthsBack,
  });
}

/** @see src-tauri/src/financial_brain.rs:756 finance_get_goals */
export function financeGetGoals(): Promise<FinancialGoal[]> {
  return invokeTyped<FinancialGoal[]>('finance_get_goals', {});
}

/**
 * @see src-tauri/src/financial_brain.rs:762 finance_create_goal
 * Rust signature: `finance_create_goal(name: String, target_amount: f64, deadline: String,
 *   current_amount: Option<f64>) -> Result<FinancialGoal, String>`.
 */
export function financeCreateGoal(args: {
  name: string;
  targetAmount: number;
  deadline: string;
  currentAmount?: number;
}): Promise<FinancialGoal> {
  return invokeTyped<
    FinancialGoal,
    { name: string; target_amount: number; deadline: string; current_amount?: number }
  >('finance_create_goal', {
    name: args.name,
    target_amount: args.targetAmount,
    deadline: args.deadline,
    current_amount: args.currentAmount,
  });
}

/**
 * @see src-tauri/src/financial_brain.rs:773 finance_update_goal
 * Rust signature: `finance_update_goal(id: String, current_amount: f64) -> Result<(), String>`.
 */
export function financeUpdateGoal(args: { id: string; currentAmount: number }): Promise<void> {
  return invokeTyped<void, { id: string; current_amount: number }>('finance_update_goal', {
    id: args.id,
    current_amount: args.currentAmount,
  });
}

/**
 * @see src-tauri/src/financial_brain.rs:778 finance_investment_suggestions
 * Rust signature: `finance_investment_suggestions(monthly_surplus: f64,
 *   risk_tolerance: Option<String>) -> String`.
 */
export function financeInvestmentSuggestions(args: {
  monthlySurplus: number;
  riskTolerance?: string;
}): Promise<string> {
  return invokeTyped<string, { monthly_surplus: number; risk_tolerance?: string }>(
    'finance_investment_suggestions',
    { monthly_surplus: args.monthlySurplus, risk_tolerance: args.riskTolerance },
  );
}

/** @see src-tauri/src/financial_brain.rs:786 finance_budget_recommendation */
export function financeBudgetRecommendation(): Promise<string> {
  return invokeTyped<string>('finance_budget_recommendation', {});
}

/** @see src-tauri/src/financial_brain.rs:792 finance_get_context */
export function financeGetContext(): Promise<string> {
  return invokeTyped<string>('finance_get_context', {});
}

/**
 * @see src-tauri/src/financial_brain.rs:1297 finance_import_csv
 * Rust signature: `finance_import_csv(path: String) -> Result<u32, String>` —
 * returns the number of imported rows.
 */
export function financeImportCsv(path: string): Promise<number> {
  return invokeTyped<number, { path: string }>('finance_import_csv', { path });
}

/**
 * @see src-tauri/src/financial_brain.rs:1302 finance_auto_categorize
 * Rust signature: `finance_auto_categorize(description: String) -> Result<String, String>` —
 * returns the inferred category for a single description string.
 */
export function financeAutoCategorize(description: string): Promise<string> {
  return invokeTyped<string, { description: string }>('finance_auto_categorize', { description });
}

/**
 * @see src-tauri/src/financial_brain.rs:1307 finance_spending_summary
 * Rust signature: `finance_spending_summary(days: u32) -> Result<serde_json::Value, String>`.
 */
export function financeSpendingSummary(days: number): Promise<Record<string, unknown>> {
  return invokeTyped<Record<string, unknown>, { days: number }>('finance_spending_summary', {
    days,
  });
}

/**
 * @see src-tauri/src/financial_brain.rs:1312 finance_detect_subscriptions
 * Rust returns `Vec<serde_json::Value>` — each element is a free-form subscription entry.
 */
export function financeDetectSubscriptions(): Promise<Array<Record<string, unknown>>> {
  return invokeTyped<Array<Record<string, unknown>>>('finance_detect_subscriptions', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// goal_engine.rs — 6 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/goal_engine.rs:838 goal_add
 * Rust signature: `goal_add(title: String, description: String, priority: Option<i32>,
 *   tags: Option<Vec<String>>) -> Result<String, String>` — returns the new goal id.
 */
export function goalAdd(args: {
  title: string;
  description: string;
  priority?: number;
  tags?: string[];
}): Promise<string> {
  return invokeTyped<
    string,
    { title: string; description: string; priority?: number; tags?: string[] }
  >('goal_add', {
    title: args.title,
    description: args.description,
    priority: args.priority,
    tags: args.tags,
  });
}

/** @see src-tauri/src/goal_engine.rs:868 goal_list */
export function goalList(): Promise<Goal[]> {
  return invokeTyped<Goal[]>('goal_list', {});
}

/** @see src-tauri/src/goal_engine.rs:891 goal_complete */
export function goalComplete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('goal_complete', { id });
}

/** @see src-tauri/src/goal_engine.rs:901 goal_delete */
export function goalDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('goal_delete', { id });
}

/**
 * @see src-tauri/src/goal_engine.rs:910 goal_update_priority
 * Rust signature: `goal_update_priority(id: String, priority: i32) -> Result<(), String>`.
 */
export function goalUpdatePriority(args: { id: string; priority: number }): Promise<void> {
  return invokeTyped<void, { id: string; priority: number }>('goal_update_priority', {
    id: args.id,
    priority: args.priority,
  });
}

/**
 * @see src-tauri/src/goal_engine.rs:918 goal_pursue_now
 * Rust signature: `goal_pursue_now(id: String, app: tauri::AppHandle) -> Result<String, String>`.
 * Note: `app` is the Tauri-managed handle; frontend only passes the goal id.
 */
export function goalPursueNow(id: string): Promise<string> {
  return invokeTyped<string, { id: string }>('goal_pursue_now', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// habit_engine.rs — 10 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/habit_engine.rs:768 habit_create
 * Rust signature: `habit_create(name, description?, frequency?, target_time?,
 *   category?, cue?, reward?) -> Result<String, String>`.
 */
export function habitCreate(args: {
  name: string;
  description?: string;
  frequency?: string;
  targetTime?: string;
  category?: string;
  cue?: string;
  reward?: string;
}): Promise<string> {
  return invokeTyped<
    string,
    {
      name: string;
      description?: string;
      frequency?: string;
      target_time?: string;
      category?: string;
      cue?: string;
      reward?: string;
    }
  >('habit_create', {
    name: args.name,
    description: args.description,
    frequency: args.frequency,
    target_time: args.targetTime,
    category: args.category,
    cue: args.cue,
    reward: args.reward,
  });
}

/**
 * @see src-tauri/src/habit_engine.rs:798 habit_list
 * Rust signature: `habit_list(active_only: Option<bool>) -> Vec<Habit>`.
 */
export function habitList(activeOnly?: boolean): Promise<Habit[]> {
  return invokeTyped<Habit[], { active_only?: boolean }>('habit_list', {
    active_only: activeOnly,
  });
}

/** @see src-tauri/src/habit_engine.rs:803 habit_get */
export function habitGet(id: string): Promise<Habit | null> {
  return invokeTyped<Habit | null, { id: string }>('habit_get', { id });
}

/**
 * @see src-tauri/src/habit_engine.rs:808 habit_complete
 * Rust signature: `habit_complete(habit_id, date?, notes?, mood_after?) -> Result<(), String>`.
 */
export function habitComplete(args: {
  habitId: string;
  date?: string;
  notes?: string;
  moodAfter?: number;
}): Promise<void> {
  return invokeTyped<
    void,
    { habit_id: string; date?: string; notes?: string; mood_after?: number }
  >('habit_complete', {
    habit_id: args.habitId,
    date: args.date,
    notes: args.notes,
    mood_after: args.moodAfter,
  });
}

/**
 * @see src-tauri/src/habit_engine.rs:819 habit_skip
 * Rust signature: `habit_skip(habit_id, date?, reason?) -> Result<(), String>`.
 */
export function habitSkip(args: {
  habitId: string;
  date?: string;
  reason?: string;
}): Promise<void> {
  return invokeTyped<void, { habit_id: string; date?: string; reason?: string }>('habit_skip', {
    habit_id: args.habitId,
    date: args.date,
    reason: args.reason,
  });
}

/**
 * @see src-tauri/src/habit_engine.rs:829 habit_get_logs
 * Rust signature: `habit_get_logs(habit_id: String, days_back: Option<i32>) -> Vec<HabitLog>`.
 */
export function habitGetLogs(args: { habitId: string; daysBack?: number }): Promise<HabitLog[]> {
  return invokeTyped<HabitLog[], { habit_id: string; days_back?: number }>('habit_get_logs', {
    habit_id: args.habitId,
    days_back: args.daysBack,
  });
}

/**
 * @see src-tauri/src/habit_engine.rs:834 habit_get_today
 * Rust returns `Vec<(Habit, bool)>` — each tuple is [habit, is_completed_today].
 */
export function habitGetToday(): Promise<Array<[Habit, boolean]>> {
  return invokeTyped<Array<[Habit, boolean]>>('habit_get_today', {});
}

/** @see src-tauri/src/habit_engine.rs:839 habit_insights */
export function habitInsights(): Promise<HabitInsight[]> {
  return invokeTyped<HabitInsight[]>('habit_insights', {});
}

/**
 * @see src-tauri/src/habit_engine.rs:844 habit_suggest_design
 * Rust signature: `habit_suggest_design(goal: String) -> String`.
 */
export function habitSuggestDesign(goal: string): Promise<string> {
  return invokeTyped<string, { goal: string }>('habit_suggest_design', { goal });
}

/** @see src-tauri/src/habit_engine.rs:849 habit_get_context */
export function habitGetContext(): Promise<string> {
  return invokeTyped<string>('habit_get_context', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// meeting_intelligence.rs — 10 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/meeting_intelligence.rs:754 meeting_process
 * Rust signature: `meeting_process(title, date, transcript, participants) -> Result<Meeting, String>`.
 */
export function meetingProcess(args: {
  title: string;
  date: string;
  transcript: string;
  participants: string[];
}): Promise<Meeting> {
  return invokeTyped<
    Meeting,
    { title: string; date: string; transcript: string; participants: string[] }
  >('meeting_process', {
    title: args.title,
    date: args.date,
    transcript: args.transcript,
    participants: args.participants,
  });
}

/** @see src-tauri/src/meeting_intelligence.rs:765 meeting_get */
export function meetingGet(id: string): Promise<Meeting | null> {
  return invokeTyped<Meeting | null, { id: string }>('meeting_get', { id });
}

/**
 * @see src-tauri/src/meeting_intelligence.rs:771 meeting_list
 * Rust signature: `meeting_list(limit: Option<usize>) -> Vec<Meeting>`.
 */
export function meetingList(limit?: number): Promise<Meeting[]> {
  return invokeTyped<Meeting[], { limit?: number }>('meeting_list', { limit });
}

/** @see src-tauri/src/meeting_intelligence.rs:777 meeting_search */
export function meetingSearch(query: string): Promise<Meeting[]> {
  return invokeTyped<Meeting[], { query: string }>('meeting_search', { query });
}

/** @see src-tauri/src/meeting_intelligence.rs:783 meeting_delete */
export function meetingDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('meeting_delete', { id });
}

/**
 * @see src-tauri/src/meeting_intelligence.rs:788 meeting_get_action_items
 * Rust returns `Vec<serde_json::Value>` with `{meeting_title, description, owner, due_date, completed}`.
 */
export function meetingGetActionItems(): Promise<Array<Record<string, unknown>>> {
  return invokeTyped<Array<Record<string, unknown>>>('meeting_get_action_items', {});
}

/**
 * @see src-tauri/src/meeting_intelligence.rs:805 meeting_complete_action
 * Rust signature: `meeting_complete_action(meeting_id: String, item_index: usize) -> Result<(), String>`.
 */
export function meetingCompleteAction(args: {
  meetingId: string;
  itemIndex: number;
}): Promise<void> {
  return invokeTyped<void, { meeting_id: string; item_index: number }>(
    'meeting_complete_action',
    { meeting_id: args.meetingId, item_index: args.itemIndex },
  );
}

/**
 * @see src-tauri/src/meeting_intelligence.rs:810 meeting_follow_up_email
 * Rust signature: `meeting_follow_up_email(meeting_id: String, recipient: String) -> String`.
 */
export function meetingFollowUpEmail(args: {
  meetingId: string;
  recipient: string;
}): Promise<string> {
  return invokeTyped<string, { meeting_id: string; recipient: string }>(
    'meeting_follow_up_email',
    { meeting_id: args.meetingId, recipient: args.recipient },
  );
}

/**
 * @see src-tauri/src/meeting_intelligence.rs:815 meeting_compare
 * Rust signature: `meeting_compare(ids: Vec<String>) -> String`.
 */
export function meetingCompare(ids: string[]): Promise<string> {
  return invokeTyped<string, { ids: string[] }>('meeting_compare', { ids });
}

/**
 * @see src-tauri/src/meeting_intelligence.rs:820 meeting_recurring_themes
 * Rust signature: `meeting_recurring_themes(days_back: Option<i32>) -> Vec<String>`.
 */
export function meetingRecurringThemes(daysBack?: number): Promise<string[]> {
  return invokeTyped<string[], { days_back?: number }>('meeting_recurring_themes', {
    days_back: daysBack,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// social_graph.rs — 11 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/social_graph.rs:768 social_add_contact
 * Rust signature: `social_add_contact(name, relationship_type?, traits?, interests?,
 *   communication_style?, notes?, aliases?) -> Result<String, String>`.
 */
export function socialAddContact(args: {
  name: string;
  relationshipType?: string;
  traits?: string[];
  interests?: string[];
  communicationStyle?: string;
  notes?: string;
  aliases?: string[];
}): Promise<string> {
  return invokeTyped<
    string,
    {
      name: string;
      relationship_type?: string;
      traits?: string[];
      interests?: string[];
      communication_style?: string;
      notes?: string;
      aliases?: string[];
    }
  >('social_add_contact', {
    name: args.name,
    relationship_type: args.relationshipType,
    traits: args.traits,
    interests: args.interests,
    communication_style: args.communicationStyle,
    notes: args.notes,
    aliases: args.aliases,
  });
}

/** @see src-tauri/src/social_graph.rs:796 social_get_contact */
export function socialGetContact(id: string): Promise<Contact | null> {
  return invokeTyped<Contact | null, { id: string }>('social_get_contact', { id });
}

/** @see src-tauri/src/social_graph.rs:802 social_search_contacts */
export function socialSearchContacts(query: string): Promise<Contact[]> {
  return invokeTyped<Contact[], { query: string }>('social_search_contacts', { query });
}

/**
 * @see src-tauri/src/social_graph.rs:808 social_update_contact
 * Rust signature: `social_update_contact(id: String, updates: serde_json::Value) -> Result<(), String>`.
 */
export function socialUpdateContact(args: {
  id: string;
  updates: Record<string, unknown>;
}): Promise<void> {
  return invokeTyped<void, { id: string; updates: Record<string, unknown> }>(
    'social_update_contact',
    { id: args.id, updates: args.updates },
  );
}

/** @see src-tauri/src/social_graph.rs:814 social_delete_contact */
export function socialDeleteContact(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('social_delete_contact', { id });
}

/** @see src-tauri/src/social_graph.rs:820 social_list_contacts */
export function socialListContacts(): Promise<Contact[]> {
  return invokeTyped<Contact[]>('social_list_contacts', {});
}

/**
 * @see src-tauri/src/social_graph.rs:826 social_log_interaction
 * Rust signature: `social_log_interaction(contact_id, summary, sentiment?, topics?,
 *   action_items?) -> Result<String, String>`.
 */
export function socialLogInteraction(args: {
  contactId: string;
  summary: string;
  sentiment?: string;
  topics?: string[];
  actionItems?: string[];
}): Promise<string> {
  return invokeTyped<
    string,
    {
      contact_id: string;
      summary: string;
      sentiment?: string;
      topics?: string[];
      action_items?: string[];
    }
  >('social_log_interaction', {
    contact_id: args.contactId,
    summary: args.summary,
    sentiment: args.sentiment,
    topics: args.topics,
    action_items: args.actionItems,
  });
}

/**
 * @see src-tauri/src/social_graph.rs:844 social_get_interactions
 * Rust signature: `social_get_interactions(contact_id: String, limit: Option<usize>) -> Vec<Interaction>`.
 */
export function socialGetInteractions(args: {
  contactId: string;
  limit?: number;
}): Promise<Interaction[]> {
  return invokeTyped<Interaction[], { contact_id: string; limit?: number }>(
    'social_get_interactions',
    { contact_id: args.contactId, limit: args.limit },
  );
}

/**
 * @see src-tauri/src/social_graph.rs:850 social_analyze_interaction
 * Rust signature: `social_analyze_interaction(contact_id, conversation_text) -> Result<Interaction, String>`.
 */
export function socialAnalyzeInteraction(args: {
  contactId: string;
  conversationText: string;
}): Promise<Interaction> {
  return invokeTyped<Interaction, { contact_id: string; conversation_text: string }>(
    'social_analyze_interaction',
    { contact_id: args.contactId, conversation_text: args.conversationText },
  );
}

/** @see src-tauri/src/social_graph.rs:859 social_get_insights */
export function socialGetInsights(): Promise<RelationshipInsight[]> {
  return invokeTyped<RelationshipInsight[]>('social_get_insights', {});
}

/**
 * @see src-tauri/src/social_graph.rs:865 social_how_to_approach
 * Rust signature: `social_how_to_approach(contact_id: String, goal: String) -> String`.
 */
export function socialHowToApproach(args: { contactId: string; goal: string }): Promise<string> {
  return invokeTyped<string, { contact_id: string; goal: string }>('social_how_to_approach', {
    contact_id: args.contactId,
    goal: args.goal,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// prediction_engine.rs — 6 commands
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/prediction_engine.rs:861 prediction_get_pending */
export function predictionGetPending(): Promise<Prediction[]> {
  return invokeTyped<Prediction[]>('prediction_get_pending', {});
}

/** @see src-tauri/src/prediction_engine.rs:866 prediction_accept */
export function predictionAccept(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('prediction_accept', { id });
}

/**
 * @see src-tauri/src/prediction_engine.rs:871 prediction_dismiss
 * Rust signature: `prediction_dismiss(id: String, helpful: bool) -> Result<(), String>`.
 */
export function predictionDismiss(args: { id: string; helpful: boolean }): Promise<void> {
  return invokeTyped<void, { id: string; helpful: boolean }>('prediction_dismiss', {
    id: args.id,
    helpful: args.helpful,
  });
}

/**
 * @see src-tauri/src/prediction_engine.rs:876 prediction_generate_now
 * Rust signature: `prediction_generate_now(app: tauri::AppHandle) -> Vec<Prediction>`.
 * Note: AppHandle is Tauri-managed; frontend passes no args.
 */
export function predictionGenerateNow(): Promise<Prediction[]> {
  return invokeTyped<Prediction[]>('prediction_generate_now', {});
}

/**
 * @see src-tauri/src/prediction_engine.rs:881 prediction_contextual
 * Rust signature: `prediction_contextual(current_context: String) -> Vec<Prediction>`.
 */
export function predictionContextual(currentContext: string): Promise<Prediction[]> {
  return invokeTyped<Prediction[], { current_context: string }>('prediction_contextual', {
    current_context: currentContext,
  });
}

/** @see src-tauri/src/prediction_engine.rs:886 prediction_get_patterns */
export function predictionGetPatterns(): Promise<BehaviorPattern[]> {
  return invokeTyped<BehaviorPattern[]>('prediction_get_patterns', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// emotional_intelligence.rs — 5 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/emotional_intelligence.rs:769 emotion_get_current
 * Returns Option<EmotionalState>.
 */
export function emotionGetCurrent(): Promise<EmotionalState | null> {
  return invokeTyped<EmotionalState | null>('emotion_get_current', {});
}

/** @see src-tauri/src/emotional_intelligence.rs:775 emotion_get_trend */
export function emotionGetTrend(): Promise<EmotionalTrend> {
  return invokeTyped<EmotionalTrend>('emotion_get_trend', {});
}

/**
 * @see src-tauri/src/emotional_intelligence.rs:780 emotion_get_readings
 * Rust signature: `emotion_get_readings(limit: Option<usize>) -> Vec<EmotionalState>`.
 */
export function emotionGetReadings(limit?: number): Promise<EmotionalState[]> {
  return invokeTyped<EmotionalState[], { limit?: number }>('emotion_get_readings', { limit });
}

/**
 * @see src-tauri/src/emotional_intelligence.rs:785 emotion_analyze_patterns
 * Rust signature: `emotion_analyze_patterns(days_back: Option<i32>) -> String`.
 */
export function emotionAnalyzePatterns(daysBack?: number): Promise<string> {
  return invokeTyped<string, { days_back?: number }>('emotion_analyze_patterns', {
    days_back: daysBack,
  });
}

/** @see src-tauri/src/emotional_intelligence.rs:790 emotion_get_context */
export function emotionGetContext(): Promise<string> {
  return invokeTyped<string>('emotion_get_context', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// accountability.rs — 8 commands
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/accountability.rs:866 accountability_get_objectives
 * Rust returns `Vec<serde_json::Value>` — each entry is an Objective w/ key-results.
 */
export function accountabilityGetObjectives(): Promise<Array<Record<string, unknown>>> {
  return invokeTyped<Array<Record<string, unknown>>>('accountability_get_objectives', {});
}

/**
 * @see src-tauri/src/accountability.rs:874 accountability_create_objective
 * Rust signature: `accountability_create_objective(title, description, timeframe, duration_days) -> Result<String, String>`.
 */
export function accountabilityCreateObjective(args: {
  title: string;
  description: string;
  timeframe: string;
  durationDays: number;
}): Promise<string> {
  return invokeTyped<
    string,
    { title: string; description: string; timeframe: string; duration_days: number }
  >('accountability_create_objective', {
    title: args.title,
    description: args.description,
    timeframe: args.timeframe,
    duration_days: args.durationDays,
  });
}

/**
 * @see src-tauri/src/accountability.rs:884 accountability_update_kr
 * Rust signature: `accountability_update_kr(kr_id: String, current_value: f64) -> Result<(), String>`.
 */
export function accountabilityUpdateKr(args: {
  krId: string;
  currentValue: number;
}): Promise<void> {
  return invokeTyped<void, { kr_id: string; current_value: number }>(
    'accountability_update_kr',
    { kr_id: args.krId, current_value: args.currentValue },
  );
}

/**
 * @see src-tauri/src/accountability.rs:889 accountability_daily_plan
 * Rust signature: `accountability_daily_plan(date: Option<String>) -> Result<DailyPlan, String>`.
 */
export function accountabilityDailyPlan(date?: string): Promise<DailyPlan> {
  return invokeTyped<DailyPlan, { date?: string }>('accountability_daily_plan', { date });
}

/** @see src-tauri/src/accountability.rs:895 accountability_complete_action */
export function accountabilityCompleteAction(actionId: string): Promise<void> {
  return invokeTyped<void, { action_id: string }>('accountability_complete_action', {
    action_id: actionId,
  });
}

/**
 * @see src-tauri/src/accountability.rs:900 accountability_checkin
 * Rust signature: `accountability_checkin(mood, energy, win, blocker, tomorrow) -> Result<String, String>`.
 */
export function accountabilityCheckin(args: {
  mood: number;
  energy: number;
  win: string;
  blocker: string;
  tomorrow: string;
}): Promise<string> {
  return invokeTyped<
    string,
    { mood: number; energy: number; win: string; blocker: string; tomorrow: string }
  >('accountability_checkin', {
    mood: args.mood,
    energy: args.energy,
    win: args.win,
    blocker: args.blocker,
    tomorrow: args.tomorrow,
  });
}

/**
 * @see src-tauri/src/accountability.rs:911 accountability_progress_report
 * Rust signature: `accountability_progress_report(period: String) -> Result<ProgressReport, String>`.
 */
export function accountabilityProgressReport(period: string): Promise<ProgressReport> {
  return invokeTyped<ProgressReport, { period: string }>('accountability_progress_report', {
    period,
  });
}

/**
 * @see src-tauri/src/accountability.rs:916 accountability_get_daily_actions
 * Rust signature: `accountability_get_daily_actions(date: Option<String>) -> Vec<DailyAction>`.
 */
export function accountabilityGetDailyActions(date?: string): Promise<DailyAction[]> {
  return invokeTyped<DailyAction[], { date?: string }>('accountability_get_daily_actions', {
    date,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// streak_stats.rs — 3 commands
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/streak_stats.rs:305 streak_get_stats */
export function streakGetStats(): Promise<StreakStats> {
  return invokeTyped<StreakStats>('streak_get_stats', {});
}

/**
 * @see src-tauri/src/streak_stats.rs:310 streak_record_activity
 * Rust signature: `streak_record_activity(message_count: u32, tool_calls: u32)` — returns unit.
 */
export function streakRecordActivity(args: {
  messageCount: number;
  toolCalls: number;
}): Promise<void> {
  return invokeTyped<void, { message_count: number; tool_calls: number }>(
    'streak_record_activity',
    { message_count: args.messageCount, tool_calls: args.toolCalls },
  );
}

/**
 * @see src-tauri/src/streak_stats.rs:317 streak_get_display
 * Returns serde_json::Value display payload (emoji + formatted strings).
 */
export function streakGetDisplay(): Promise<StreakDisplay> {
  return invokeTyped<StreakDisplay>('streak_get_display', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// people_graph.rs — 7 commands
// ═══════════════════════════════════════════════════════════════════════════

/** @see src-tauri/src/people_graph.rs:395 people_list */
export function peopleList(): Promise<Person[]> {
  return invokeTyped<Person[]>('people_list', {});
}

/**
 * @see src-tauri/src/people_graph.rs:415 people_get
 * Rust signature: `people_get(name: String) -> Option<Person>` — lookup is by name, not id.
 */
export function peopleGet(name: string): Promise<Person | null> {
  return invokeTyped<Person | null, { name: string }>('people_get', { name });
}

/**
 * @see src-tauri/src/people_graph.rs:421 people_upsert
 * Rust signature: `people_upsert(person: Person) -> Result<(), String>` — takes the full Person.
 */
export function peopleUpsert(person: Person): Promise<void> {
  return invokeTyped<void, { person: Person }>('people_upsert', { person });
}

/**
 * @see src-tauri/src/people_graph.rs:427 people_delete
 * Rust signature: `people_delete(id: String) -> Result<(), String>` — deletion is by id.
 */
export function peopleDelete(id: string): Promise<void> {
  return invokeTyped<void, { id: string }>('people_delete', { id });
}

/**
 * @see src-tauri/src/people_graph.rs:435 people_suggest_reply_style
 * Rust signature: `people_suggest_reply_style(name: String) -> String`.
 */
export function peopleSuggestReplyStyle(name: string): Promise<string> {
  return invokeTyped<string, { name: string }>('people_suggest_reply_style', { name });
}

/**
 * @see src-tauri/src/people_graph.rs:441 people_learn_from_conversation
 * Rust signature: `people_learn_from_conversation(messages: Vec<HistoryMessage>, platform: String)`.
 * Note: Rust returns unit; HistoryMessage is `{role, content}` shaped.
 */
export function peopleLearnFromConversation(args: {
  messages: Array<{ role: string; content: string; [k: string]: unknown }>;
  platform: string;
}): Promise<void> {
  return invokeTyped<
    void,
    { messages: Array<{ role: string; content: string; [k: string]: unknown }>; platform: string }
  >('people_learn_from_conversation', {
    messages: args.messages,
    platform: args.platform,
  });
}

/**
 * @see src-tauri/src/people_graph.rs:477 people_get_context_for_prompt
 * Rust signature: `people_get_context_for_prompt(names: Vec<String>) -> String`.
 */
export function peopleGetContextForPrompt(names: string[]): Promise<string> {
  return invokeTyped<string, { names: string[] }>('people_get_context_for_prompt', { names });
}

// ═══════════════════════════════════════════════════════════════════════════
// learning_engine.rs — 1 command in D-140 scope
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/learning_engine.rs:1068 learning_get_predictions
 * Rust signature: `learning_get_predictions(context: String) -> Vec<UserPrediction>`.
 */
export function learningGetPredictions(context: string): Promise<UserPrediction[]> {
  return invokeTyped<UserPrediction[], { context: string }>('learning_get_predictions', {
    context,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// temporal_intel.rs — 1 command in D-140 scope (meeting prep)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/temporal_intel.rs:721 temporal_meeting_prep
 * Rust signature: `temporal_meeting_prep(topic: String) -> Result<String, String>`.
 * Note: takes a topic string (not a meeting_id), returns a free-form prep briefing.
 */
export function temporalMeetingPrep(topic: string): Promise<string> {
  return invokeTyped<string, { topic: string }>('temporal_meeting_prep', { topic });
}
