import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

type TransactionCategory =
  | "food"
  | "rent"
  | "transport"
  | "entertainment"
  | "utilities"
  | "healthcare"
  | "shopping"
  | "income"
  | "savings"
  | "other";

interface Transaction {
  id: string;
  amount: number;
  description: string;
  category: TransactionCategory;
  date: string;
  is_income: boolean;
}

interface MonthStats {
  income: number;
  expenses: number;
  savings_rate: number;
}

interface CategoryBreakdown {
  category: string;
  amount: number;
  percentage: number;
}

type InsightType = "warning" | "opportunity" | "trend" | "achievement";

interface FinanceInsight {
  type: InsightType;
  title: string;
  description: string;
  action_items: string[];
}

interface FinanceGoal {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline: string;
  monthly_required: number;
  status: "on_track" | "behind" | "achieved";
}

interface InvestmentSuggestion {
  name: string;
  description: string;
  expected_return: string;
  risk: string;
}

const CATEGORIES: TransactionCategory[] = [
  "food", "rent", "transport", "entertainment", "utilities",
  "healthcare", "shopping", "income", "savings", "other",
];

const CATEGORY_COLORS: Record<TransactionCategory, string> = {
  food: "bg-orange-600",
  rent: "bg-blue-600",
  transport: "bg-cyan-600",
  entertainment: "bg-purple-600",
  utilities: "bg-yellow-600",
  healthcare: "bg-pink-600",
  shopping: "bg-rose-600",
  income: "bg-green-600",
  savings: "bg-teal-600",
  other: "bg-gray-600",
};

const CATEGORY_TEXT: Record<TransactionCategory, string> = {
  food: "text-orange-400",
  rent: "text-blue-400",
  transport: "text-cyan-400",
  entertainment: "text-purple-400",
  utilities: "text-yellow-400",
  healthcare: "text-pink-400",
  shopping: "text-rose-400",
  income: "text-green-400",
  savings: "text-teal-400",
  other: "text-gray-400",
};

const INSIGHT_ICONS: Record<InsightType, string> = {
  warning: "⚠️",
  opportunity: "💡",
  trend: "📈",
  achievement: "🏆",
};

const INSIGHT_BORDER: Record<InsightType, string> = {
  warning: "border-yellow-700",
  opportunity: "border-blue-700",
  trend: "border-purple-700",
  achievement: "border-green-700",
};

// ── Modals ────────────────────────────────────────────────────────────────────

function BudgetModal({ content, onClose }: { content: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-gray-700 rounded max-w-lg w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <span className="text-green-400 font-mono text-sm uppercase tracking-widest">// Budget Recommendation</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="text-gray-200 text-sm leading-relaxed whitespace-pre-wrap font-mono">{content}</div>
        <button
          onClick={onClose}
          className="mt-6 w-full bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 transition-colors"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

function InvestmentModal({ suggestions, onClose }: { suggestions: InvestmentSuggestion[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-black border border-gray-700 rounded max-w-2xl w-full p-6 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <span className="text-green-400 font-mono text-sm uppercase tracking-widest">// Investment Ideas</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
        </div>
        <div className="flex flex-col gap-3">
          {suggestions.map((s, i) => (
            <div key={i} className="bg-gray-950 border border-gray-800 rounded p-3">
              <div className="flex items-start justify-between mb-1">
                <span className="text-green-400 font-mono text-sm">{s.name}</span>
                <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                  s.risk === "low" ? "bg-green-900/40 text-green-400" :
                  s.risk === "medium" ? "bg-amber-900/40 text-amber-400" :
                  "bg-red-900/40 text-red-400"
                }`}>{s.risk.toUpperCase()} RISK</span>
              </div>
              <div className="text-gray-400 text-xs mb-2">{s.description}</div>
              <div className="text-gray-500 font-mono text-xs">Expected return: <span className="text-green-400">{s.expected_return}</span></div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-4 w-full bg-gray-900 border border-gray-700 text-gray-400 font-mono text-xs py-2 hover:text-gray-200 transition-colors"
        >
          CLOSE
        </button>
      </div>
    </div>
  );
}

// ── Transactions Tab ──────────────────────────────────────────────────────────

function TransactionsTab({ month }: { month: string }) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TransactionCategory>("food");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [isIncome, setIsIncome] = useState(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<Transaction[]>("finance_list_transactions", { month });
      setTransactions(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  async function addTransaction() {
    const parsedAmount = parseFloat(amount);
    if (!amount || isNaN(parsedAmount) || !description.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("finance_add_transaction", {
        transaction: {
          amount: isIncome ? Math.abs(parsedAmount) : -Math.abs(parsedAmount),
          description: description.trim(),
          category,
          date,
          is_income: isIncome,
        },
      });
      setAmount("");
      setDescription("");
      await loadTransactions();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function deleteTransaction(id: string) {
    try {
      await invoke("finance_delete_transaction", { id });
      await loadTransactions();
    } catch (e) {
      setError(String(e));
    }
  }

  // Group by date
  const grouped: Record<string, Transaction[]> = {};
  for (const tx of transactions) {
    if (!grouped[tx.date]) grouped[tx.date] = [];
    grouped[tx.date].push(tx);
  }
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="flex flex-col gap-4">
      {/* Add form */}
      <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
        <div className="text-green-400 font-mono text-xs uppercase tracking-widest">// Add Transaction</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">AMOUNT</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsIncome((v) => !v)}
                className={`font-mono text-sm w-8 h-8 border flex items-center justify-center transition-colors ${
                  isIncome ? "border-green-700 text-green-400 bg-green-900/30" : "border-red-700 text-red-400 bg-red-900/30"
                }`}
              >
                {isIncome ? "+" : "−"}
              </button>
              <input
                type="number"
                className="flex-1 bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">DATE</label>
            <input
              type="date"
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-gray-500 font-mono text-xs">DESCRIPTION</label>
          <input
            className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
            placeholder="What was this for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-gray-500 font-mono text-xs">CATEGORY</label>
          <select
            className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
            value={category}
            onChange={(e) => setCategory(e.target.value as TransactionCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <button
          onClick={addTransaction}
          disabled={loading || !amount || !description.trim()}
          className="bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "SAVING..." : "+ ADD TRANSACTION"}
        </button>
        {error && <div className="text-red-400 font-mono text-xs">{error}</div>}
      </div>

      {/* Transaction list */}
      <div className="flex flex-col gap-2">
        {loading && transactions.length === 0 && (
          <div className="text-gray-600 font-mono text-xs text-center py-8">Loading...</div>
        )}
        {sortedDates.length === 0 && !loading && (
          <div className="text-gray-700 font-mono text-xs text-center py-8">No transactions for {month}</div>
        )}
        {sortedDates.map((dateKey) => (
          <div key={dateKey} className="flex flex-col gap-1">
            <div className="text-gray-600 font-mono text-xs px-1">{dateKey}</div>
            {grouped[dateKey].map((tx) => (
              <div
                key={tx.id}
                className="bg-gray-950 border border-gray-800 rounded px-3 py-2 flex items-center gap-3"
              >
                <span className={`font-mono text-sm font-bold min-w-[90px] text-right ${tx.is_income ? "text-green-400" : "text-red-400"}`}>
                  {tx.is_income ? "+" : "−"}${Math.abs(tx.amount).toFixed(2)}
                </span>
                <span className="text-gray-300 text-sm flex-1 truncate">{tx.description}</span>
                <span className={`font-mono text-xs px-2 py-0.5 rounded ${CATEGORY_TEXT[tx.category]} bg-gray-900`}>
                  {tx.category}
                </span>
                <button
                  onClick={() => deleteTransaction(tx.id)}
                  className="text-gray-700 hover:text-red-400 font-mono text-xs transition-colors ml-1"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab() {
  const [breakdown, setBreakdown] = useState<CategoryBreakdown[]>([]);
  const [insights, setInsights] = useState<FinanceInsight[]>([]);
  const [budgetRec, setBudgetRec] = useState<string | null>(null);
  const [showBudget, setShowBudget] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await invoke<CategoryBreakdown[]>("finance_category_breakdown");
        setBreakdown(result);
      } catch {}
    })();
  }, []);

  async function generateInsights() {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<FinanceInsight[]>("finance_generate_insights", { monthsBack: 3 });
      setInsights(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function getBudgetRecommendation() {
    setLoading(true);
    try {
      const result = await invoke<{ recommendation: string }>("finance_budget_recommendation");
      setBudgetRec(result.recommendation);
      setShowBudget(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const maxAmount = Math.max(...breakdown.map((b) => b.amount), 1);

  return (
    <div className="flex flex-col gap-4">
      {showBudget && budgetRec && (
        <BudgetModal content={budgetRec} onClose={() => setShowBudget(false)} />
      )}

      {/* Spending breakdown */}
      <div className="bg-gray-950 border border-gray-800 rounded p-4">
        <div className="text-green-400 font-mono text-xs uppercase tracking-widest mb-3">// Spending by Category</div>
        {breakdown.length === 0 && (
          <div className="text-gray-700 font-mono text-xs text-center py-4">No spending data available</div>
        )}
        <div className="flex flex-col gap-2">
          {breakdown.map((item) => {
            const catKey = item.category.toLowerCase() as TransactionCategory;
            const barColor = CATEGORY_COLORS[catKey] ?? "bg-gray-600";
            const barWidth = Math.round((item.amount / maxAmount) * 100);
            return (
              <div key={item.category} className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-xs ${CATEGORY_TEXT[catKey] ?? "text-gray-400"}`}>
                    {item.category.toUpperCase()}
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400 font-mono text-xs">{item.percentage.toFixed(1)}%</span>
                    <span className="text-gray-200 font-mono text-xs min-w-[80px] text-right">
                      ${item.amount.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-gray-900 rounded overflow-hidden">
                  <div
                    className={`h-full ${barColor} transition-all duration-500`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={generateInsights}
          disabled={loading}
          className="flex-1 bg-blue-900/30 border border-blue-700 text-blue-400 font-mono text-xs py-2 hover:bg-blue-900/50 disabled:opacity-40 transition-colors"
        >
          {loading ? "ANALYZING..." : "📊 GENERATE INSIGHTS"}
        </button>
        <button
          onClick={getBudgetRecommendation}
          disabled={loading}
          className="flex-1 bg-green-900/30 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/50 disabled:opacity-40 transition-colors"
        >
          {loading ? "..." : "💰 BUDGET RECOMMENDATION"}
        </button>
      </div>
      {error && <div className="text-red-400 font-mono text-xs">{error}</div>}

      {/* Insight cards */}
      {insights.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-green-400 font-mono text-xs uppercase tracking-widest">// Insights</div>
          {insights.map((insight, i) => (
            <div key={i} className={`bg-gray-950 border ${INSIGHT_BORDER[insight.type]} rounded p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{INSIGHT_ICONS[insight.type]}</span>
                <span className="text-gray-200 font-mono text-sm">{insight.title}</span>
              </div>
              <p className="text-gray-400 text-sm mb-3">{insight.description}</p>
              {insight.action_items.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {insight.action_items.map((item, j) => (
                    <li key={j} className="text-gray-500 text-xs flex gap-2">
                      <span className="text-green-700">▸</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Goals Tab ─────────────────────────────────────────────────────────────────

function GoalsTab() {
  const [goals, setGoals] = useState<FinanceGoal[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [investments, setInvestments] = useState<InvestmentSuggestion[] | null>(null);
  const [showInvestments, setShowInvestments] = useState(false);
  const [riskTolerance, setRiskTolerance] = useState<"conservative" | "moderate" | "aggressive">("moderate");
  const [monthlySurplus, setMonthlySurplus] = useState("500");

  // Goal form
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDeadline, setGoalDeadline] = useState("");
  const [goalStarting, setGoalStarting] = useState("0");

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<FinanceGoal[]>("finance_list_goals");
      setGoals(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  async function addGoal() {
    if (!goalName.trim() || !goalTarget || !goalDeadline) return;
    setLoading(true);
    try {
      await invoke("finance_add_goal", {
        goal: {
          name: goalName.trim(),
          target_amount: parseFloat(goalTarget),
          deadline: goalDeadline,
          starting_amount: parseFloat(goalStarting || "0"),
        },
      });
      setGoalName("");
      setGoalTarget("");
      setGoalDeadline("");
      setGoalStarting("0");
      setShowAddGoal(false);
      await loadGoals();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function getInvestmentIdeas() {
    setLoading(true);
    try {
      const result = await invoke<InvestmentSuggestion[]>("finance_investment_suggestions", {
        monthlySurplus: parseFloat(monthlySurplus || "0"),
        riskTolerance,
      });
      setInvestments(result);
      setShowInvestments(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const STATUS_COLOR: Record<string, string> = {
    on_track: "text-green-400 border-green-700",
    behind: "text-yellow-400 border-yellow-700",
    achieved: "text-teal-400 border-teal-700",
  };

  return (
    <div className="flex flex-col gap-4">
      {showInvestments && investments && (
        <InvestmentModal suggestions={investments} onClose={() => setShowInvestments(false)} />
      )}

      {/* Goals list */}
      <div className="flex items-center justify-between">
        <div className="text-green-400 font-mono text-xs uppercase tracking-widest">// Financial Goals</div>
        <button
          onClick={() => setShowAddGoal((v) => !v)}
          className="border border-gray-700 text-gray-500 font-mono text-xs px-3 py-1 hover:text-gray-300 hover:border-gray-500 transition-colors"
        >
          {showAddGoal ? "CANCEL" : "+ ADD GOAL"}
        </button>
      </div>

      {showAddGoal && (
        <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">GOAL NAME</label>
              <input
                className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
                placeholder="e.g. Emergency Fund"
                value={goalName}
                onChange={(e) => setGoalName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">TARGET AMOUNT ($)</label>
              <input
                type="number"
                className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
                placeholder="10000"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">DEADLINE</label>
              <input
                type="date"
                className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
                value={goalDeadline}
                onChange={(e) => setGoalDeadline(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-gray-500 font-mono text-xs">STARTING AMOUNT ($)</label>
              <input
                type="number"
                className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
                placeholder="0"
                value={goalStarting}
                onChange={(e) => setGoalStarting(e.target.value)}
              />
            </div>
          </div>
          <button
            onClick={addGoal}
            disabled={loading || !goalName.trim() || !goalTarget || !goalDeadline}
            className="bg-green-900/40 border border-green-700 text-green-400 font-mono text-xs py-2 hover:bg-green-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            SAVE GOAL
          </button>
        </div>
      )}

      {error && <div className="text-red-400 font-mono text-xs">{error}</div>}

      {loading && goals.length === 0 && (
        <div className="text-gray-600 font-mono text-xs text-center py-8">Loading...</div>
      )}

      {goals.length === 0 && !loading && (
        <div className="text-gray-700 font-mono text-xs text-center py-8 border border-dashed border-gray-800 rounded">
          No goals yet. Add one above.
        </div>
      )}

      {goals.map((goal) => {
        const progress = Math.min((goal.current_amount / goal.target_amount) * 100, 100);
        const statusClass = STATUS_COLOR[goal.status] ?? "text-gray-400 border-gray-700";
        return (
          <div key={goal.id} className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <span className="text-gray-200 font-mono text-sm">{goal.name}</span>
              <span className={`font-mono text-xs px-2 py-0.5 border rounded ${statusClass}`}>
                {goal.status.replace("_", " ").toUpperCase()}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-gray-400">
                ${goal.current_amount.toLocaleString()} <span className="text-gray-600">/ ${goal.target_amount.toLocaleString()}</span>
              </span>
              <span className="text-green-400">{progress.toFixed(1)}%</span>
            </div>
            <div className="h-3 bg-gray-900 rounded overflow-hidden border border-gray-800">
              <div
                className={`h-full transition-all duration-700 ${
                  goal.status === "achieved" ? "bg-teal-600" :
                  goal.status === "behind" ? "bg-yellow-600" : "bg-green-600"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs font-mono text-gray-600">
              <span>Deadline: {goal.deadline}</span>
              <span>Need: <span className="text-amber-400">${goal.monthly_required.toFixed(0)}/mo</span></span>
            </div>
          </div>
        );
      })}

      {/* Investment Ideas */}
      <div className="bg-gray-950 border border-gray-800 rounded p-4 flex flex-col gap-3">
        <div className="text-green-400 font-mono text-xs uppercase tracking-widest">// Investment Ideas</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">MONTHLY SURPLUS ($)</label>
            <input
              type="number"
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
              value={monthlySurplus}
              onChange={(e) => setMonthlySurplus(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-gray-500 font-mono text-xs">RISK TOLERANCE</label>
            <select
              className="bg-black border border-gray-700 text-gray-200 font-mono text-sm px-3 py-2 rounded focus:outline-none focus:border-green-700"
              value={riskTolerance}
              onChange={(e) => setRiskTolerance(e.target.value as typeof riskTolerance)}
            >
              <option value="conservative">CONSERVATIVE</option>
              <option value="moderate">MODERATE</option>
              <option value="aggressive">AGGRESSIVE</option>
            </select>
          </div>
        </div>
        <button
          onClick={getInvestmentIdeas}
          disabled={loading}
          className="bg-teal-900/30 border border-teal-700 text-teal-400 font-mono text-xs py-2 hover:bg-teal-900/50 disabled:opacity-40 transition-colors"
        >
          {loading ? "LOADING..." : "📈 GET INVESTMENT IDEAS"}
        </button>
      </div>
    </div>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────

export function FinancialView({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<"transactions" | "analytics" | "goals">("transactions");
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState<MonthStats | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const result = await invoke<MonthStats>("finance_month_stats", { month });
        setStats(result);
      } catch {}
    })();
  }, [month]);

  const tabs = [
    { key: "transactions" as const, label: "TRANSACTIONS" },
    { key: "analytics" as const, label: "ANALYTICS" },
    { key: "goals" as const, label: "GOALS" },
  ];

  return (
    <div className="flex flex-col h-full bg-black text-gray-200">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-4 mb-3">
          <button
            onClick={onBack}
            className="text-gray-600 hover:text-gray-300 font-mono text-xs transition-colors"
          >
            ← BACK
          </button>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full" />
            <span className="text-green-400 font-mono text-sm uppercase tracking-widest">FINANCIAL DASHBOARD</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="text-gray-600 font-mono text-xs">MONTH</label>
            <input
              type="month"
              className="bg-black border border-gray-700 text-gray-200 font-mono text-xs px-2 py-1 rounded focus:outline-none focus:border-green-700"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
        </div>

        {/* Quick stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-gray-950 border border-gray-800 rounded px-3 py-2">
              <div className="text-gray-600 font-mono text-xs mb-1">INCOME</div>
              <div className="text-green-400 font-mono text-sm">${stats.income.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="bg-gray-950 border border-gray-800 rounded px-3 py-2">
              <div className="text-gray-600 font-mono text-xs mb-1">EXPENSES</div>
              <div className="text-red-400 font-mono text-sm">${stats.expenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
            </div>
            <div className="bg-gray-950 border border-gray-800 rounded px-3 py-2">
              <div className="text-gray-600 font-mono text-xs mb-1">SAVINGS RATE</div>
              <div className={`font-mono text-sm ${stats.savings_rate >= 20 ? "text-green-400" : stats.savings_rate >= 10 ? "text-amber-400" : "text-red-400"}`}>
                {stats.savings_rate.toFixed(1)}%
              </div>
            </div>
          </div>
        )}

        {/* Tab buttons */}
        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`font-mono text-xs px-4 py-1.5 border transition-colors ${
                tab === t.key
                  ? "border-green-700 text-green-400 bg-green-900/20"
                  : "border-gray-800 text-gray-600 hover:text-gray-300 hover:border-gray-600"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full">
        {tab === "transactions" && <TransactionsTab month={month} />}
        {tab === "analytics" && <AnalyticsTab />}
        {tab === "goals" && <GoalsTab />}
      </div>
    </div>
  );
}
