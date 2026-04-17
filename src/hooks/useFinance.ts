import { useState, useCallback, useMemo, useEffect } from "react";

/**
 * Finance Manager — Invoice & budget tracking for freelancers and power users.
 *
 * Built because developers said:
 * "I want to track AI costs alongside my other expenses"
 * "Need a simple invoice generator without leaving my workflow"
 *
 * Tracks income, expenses, subscriptions, AI costs.
 * Budget monitoring with category breakdowns.
 * Professional invoice generation and CSV export.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  type: "income" | "expense" | "subscription" | "ai-cost";
  amount: number;
  currency: string;
  category: string;
  description: string;
  date: string;
  recurring: boolean;
  recurringPeriod?: "daily" | "weekly" | "monthly" | "yearly";
  tags: string[];
  createdAt: number;
}

export interface Budget {
  id: string;
  name: string;
  amount: number;
  period: "monthly" | "quarterly" | "yearly";
  category: string;
  spent: number;
  remaining: number;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  number: string;
  client: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  status: "draft" | "sent" | "paid" | "overdue";
  dueDate: string;
  createdAt: number;
  paidAt: number | null;
  notes: string;
}

export interface FinanceStats {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  monthlyBurn: number;
  aiCostTotal: number;
  topCategories: Array<{ category: string; amount: number }>;
  monthlyTrend: Array<{ month: string; income: number; expenses: number }>;
}

export interface DateRange {
  start: string;
  end: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

export const EXPENSE_CATEGORIES = [
  "Housing",
  "Food",
  "Transport",
  "Entertainment",
  "Software",
  "AI Services",
  "Subscriptions",
  "Education",
  "Health",
  "Business",
  "Savings",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const CATEGORY_COLORS: Record<string, string> = {
  Housing: "#6366f1",
  Food: "#f59e0b",
  Transport: "#3b82f6",
  Entertainment: "#ec4899",
  Software: "#8b5cf6",
  "AI Services": "#06b6d4",
  Subscriptions: "#14b8a6",
  Education: "#10b981",
  Health: "#ef4444",
  Business: "#f97316",
  Savings: "#22d3ee",
  Other: "#64748b",
};

export const CATEGORY_ICONS: Record<string, string> = {
  Housing: "🏠",
  Food: "🍕",
  Transport: "🚗",
  Entertainment: "🎮",
  Software: "💻",
  "AI Services": "🤖",
  Subscriptions: "📦",
  Education: "📚",
  Health: "💊",
  Business: "💼",
  Savings: "🏦",
  Other: "📎",
};

const STORAGE_KEY = "blade-finance";
const STORAGE_BUDGETS = "blade-finance-budgets";
const STORAGE_INVOICES = "blade-finance-invoices";
const MAX_TRANSACTIONS = 5000;

// ── Storage helpers ──────────────────────────────────────────────────────────

function loadTransactions(): Transaction[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveTransactions(txns: Transaction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txns.slice(-MAX_TRANSACTIONS)));
}

function loadBudgets(): Budget[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_BUDGETS) || "[]");
  } catch {
    return [];
  }
}

function saveBudgets(budgets: Budget[]) {
  localStorage.setItem(STORAGE_BUDGETS, JSON.stringify(budgets));
}

function loadInvoices(): Invoice[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_INVOICES) || "[]");
  } catch {
    return [];
  }
}

function saveInvoices(invoices: Invoice[]) {
  localStorage.setItem(STORAGE_INVOICES, JSON.stringify(invoices));
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function startOfQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) * 3;
  d.setMonth(q, 1);
  return d.toISOString().slice(0, 10);
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

function isInPeriod(dateStr: string, period: "monthly" | "quarterly" | "yearly"): boolean {
  if (period === "monthly") return dateStr >= startOfMonth();
  if (period === "quarterly") return dateStr >= startOfQuarter();
  return dateStr >= startOfYear();
}

function isInRange(dateStr: string, range: DateRange): boolean {
  return dateStr >= range.start && dateStr <= range.end;
}

// ── Next invoice number ──────────────────────────────────────────────────────

function nextInvoiceNumber(invoices: Invoice[]): string {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const existing = invoices
    .filter((inv) => inv.number.startsWith(prefix))
    .map((inv) => parseInt(inv.number.replace(prefix, ""), 10))
    .filter((n) => !isNaN(n));
  const next = existing.length > 0 ? Math.max(...existing) + 1 : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useFinance() {
  const [transactions, setTransactions] = useState<Transaction[]>(loadTransactions);
  const [budgets, setBudgets] = useState<Budget[]>(loadBudgets);
  const [invoices, setInvoices] = useState<Invoice[]>(loadInvoices);

  // Sync AI costs from useCostTracker storage
  useEffect(() => {
    try {
      const costEntries = JSON.parse(localStorage.getItem("blade-costs") || "[]");
      const existingAiIds = new Set(
        transactions.filter((t) => t.type === "ai-cost").map((t) => t.id)
      );
      const newAiTxns: Transaction[] = [];
      for (const entry of costEntries) {
        const aiId = `ai-${entry.id}`;
        if (!existingAiIds.has(aiId) && entry.costUsd > 0) {
          newAiTxns.push({
            id: aiId,
            type: "ai-cost",
            amount: entry.costUsd,
            currency: "USD",
            category: "AI Services",
            description: `${entry.provider} / ${entry.model} (${entry.source})`,
            date: new Date(entry.timestamp).toISOString().slice(0, 10),
            recurring: false,
            tags: ["ai", entry.provider, entry.source],
            createdAt: entry.timestamp,
          });
        }
      }
      if (newAiTxns.length > 0) {
        setTransactions((prev) => {
          const merged = [...prev, ...newAiTxns].slice(-MAX_TRANSACTIONS);
          saveTransactions(merged);
          return merged;
        });
      }
    } catch {
      // ignore parse errors
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transaction CRUD ─────────────────────────────────────────────────────

  const addTransaction = useCallback(
    (data: Omit<Transaction, "id" | "createdAt">) => {
      const txn: Transaction = {
        ...data,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      setTransactions((prev) => {
        const next = [...prev, txn].slice(-MAX_TRANSACTIONS);
        saveTransactions(next);
        return next;
      });
      return txn;
    },
    []
  );

  const updateTransaction = useCallback((id: string, updates: Partial<Transaction>) => {
    setTransactions((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, ...updates } : t));
      saveTransactions(next);
      return next;
    });
  }, []);

  const deleteTransaction = useCallback((id: string) => {
    setTransactions((prev) => {
      const next = prev.filter((t) => t.id !== id);
      saveTransactions(next);
      return next;
    });
  }, []);

  // ── Budget CRUD ──────────────────────────────────────────────────────────

  const addBudget = useCallback((data: Omit<Budget, "id" | "spent" | "remaining">) => {
    const budget: Budget = {
      ...data,
      id: crypto.randomUUID(),
      spent: 0,
      remaining: data.amount,
    };
    setBudgets((prev) => {
      const next = [...prev, budget];
      saveBudgets(next);
      return next;
    });
    return budget;
  }, []);

  const updateBudget = useCallback((id: string, updates: Partial<Budget>) => {
    setBudgets((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, ...updates } : b));
      saveBudgets(next);
      return next;
    });
  }, []);

  const deleteBudget = useCallback((id: string) => {
    setBudgets((prev) => {
      const next = prev.filter((b) => b.id !== id);
      saveBudgets(next);
      return next;
    });
  }, []);

  // Recompute budget spent/remaining based on transactions
  const computedBudgets = useMemo((): Budget[] => {
    return budgets.map((b) => {
      const spent = transactions
        .filter(
          (t) =>
            (t.type === "expense" || t.type === "subscription" || t.type === "ai-cost") &&
            t.category === b.category &&
            isInPeriod(t.date, b.period)
        )
        .reduce((sum, t) => sum + t.amount, 0);
      return { ...b, spent, remaining: Math.max(0, b.amount - spent) };
    });
  }, [budgets, transactions]);

  // ── Invoice CRUD ─────────────────────────────────────────────────────────

  const addInvoice = useCallback(
    (data: Omit<Invoice, "id" | "number" | "createdAt" | "paidAt">) => {
      const inv: Invoice = {
        ...data,
        id: crypto.randomUUID(),
        number: nextInvoiceNumber(invoices),
        createdAt: Date.now(),
        paidAt: null,
      };
      setInvoices((prev) => {
        const next = [...prev, inv];
        saveInvoices(next);
        return next;
      });
      return inv;
    },
    [invoices]
  );

  const updateInvoice = useCallback((id: string, updates: Partial<Invoice>) => {
    setInvoices((prev) => {
      const next = prev.map((inv) => {
        if (inv.id !== id) return inv;
        const updated = { ...inv, ...updates };
        if (updates.status === "paid" && !inv.paidAt) {
          updated.paidAt = Date.now();
        }
        return updated;
      });
      saveInvoices(next);
      return next;
    });
  }, []);

  const deleteInvoice = useCallback((id: string) => {
    setInvoices((prev) => {
      const next = prev.filter((inv) => inv.id !== id);
      saveInvoices(next);
      return next;
    });
  }, []);

  const generateInvoice = useCallback(
    (client: string, items: InvoiceItem[], taxRate = 0, notes = "", dueInDays = 30) => {
      const subtotal = items.reduce((sum, it) => sum + it.amount, 0);
      const tax = subtotal * (taxRate / 100);
      const total = subtotal + tax;
      const dueDate = new Date(Date.now() + dueInDays * 86400000).toISOString().slice(0, 10);
      return addInvoice({
        client,
        items,
        subtotal,
        tax,
        total,
        status: "draft",
        dueDate,
        notes,
      });
    },
    [addInvoice]
  );

  // ── Stats ────────────────────────────────────────────────────────────────

  const getStats = useCallback(
    (range?: DateRange): FinanceStats => {
      const filtered = range ? transactions.filter((t) => isInRange(t.date, range)) : transactions;

      let totalIncome = 0;
      let totalExpenses = 0;
      let aiCostTotal = 0;
      const catMap: Record<string, number> = {};
      const trendMap: Record<string, { income: number; expenses: number }> = {};

      for (const t of filtered) {
        const mk = monthKey(t.date);
        if (!trendMap[mk]) trendMap[mk] = { income: 0, expenses: 0 };

        if (t.type === "income") {
          totalIncome += t.amount;
          trendMap[mk].income += t.amount;
        } else {
          totalExpenses += t.amount;
          trendMap[mk].expenses += t.amount;
          catMap[t.category] = (catMap[t.category] || 0) + t.amount;
          if (t.type === "ai-cost") aiCostTotal += t.amount;
        }
      }

      const topCategories = Object.entries(catMap)
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8);

      const monthlyTrend = Object.entries(trendMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([key, data]) => ({ month: monthLabel(key), ...data }));

      const months = Object.keys(trendMap).length || 1;
      const monthlyBurn = totalExpenses / months;

      return {
        totalIncome,
        totalExpenses,
        netIncome: totalIncome - totalExpenses,
        monthlyBurn,
        aiCostTotal,
        topCategories,
        monthlyTrend,
      };
    },
    [transactions]
  );

  // ── Export/Import ────────────────────────────────────────────────────────

  const exportReport = useCallback(
    (range: DateRange): string => {
      const filtered = transactions.filter((t) => isInRange(t.date, range));
      const header = "Date,Type,Category,Description,Amount,Currency,Tags\n";
      const rows = filtered
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(
          (t) =>
            `${t.date},${t.type},"${t.category}","${t.description.replace(/"/g, '""')}",${t.amount},${t.currency},"${t.tags.join("; ")}"`
        )
        .join("\n");

      const stats = getStats(range);
      const summary = [
        "",
        "",
        "Summary",
        `Total Income,${stats.totalIncome.toFixed(2)}`,
        `Total Expenses,${stats.totalExpenses.toFixed(2)}`,
        `Net Income,${stats.netIncome.toFixed(2)}`,
        `AI Costs,${stats.aiCostTotal.toFixed(2)}`,
        `Monthly Burn Rate,${stats.monthlyBurn.toFixed(2)}`,
      ].join("\n");

      return header + rows + summary;
    },
    [transactions, getStats]
  );

  const importTransactions = useCallback(
    (csv: string) => {
      const lines = csv.trim().split("\n").slice(1); // skip header
      let imported = 0;
      for (const line of lines) {
        if (!line.trim() || line.startsWith("Summary") || line.startsWith("Total") || line.startsWith("Net") || line.startsWith("AI") || line.startsWith("Monthly")) continue;
        const parts = line.match(/(?:^|,)("(?:[^"]*(?:""[^"]*)*)"|[^,]*)/g);
        if (!parts || parts.length < 5) continue;
        const clean = (s: string) => s.replace(/^,?"?|"?$/g, "").replace(/""/g, '"');
        const date = clean(parts[0]);
        const type = clean(parts[1]) as Transaction["type"];
        const category = clean(parts[2]);
        const description = clean(parts[3]);
        const amount = parseFloat(clean(parts[4]));
        const currency = parts[5] ? clean(parts[5]) : "USD";
        const tags = parts[6] ? clean(parts[6]).split("; ").filter(Boolean) : [];

        if (!isNaN(amount) && date && type) {
          addTransaction({ type, amount, currency, category, description, date, recurring: false, tags });
          imported++;
        }
      }
      return imported;
    },
    [addTransaction]
  );

  // ── Categories ───────────────────────────────────────────────────────────

  const categories = useMemo(
    () =>
      EXPENSE_CATEGORIES.map((name) => ({
        name,
        color: CATEGORY_COLORS[name],
        icon: CATEGORY_ICONS[name],
      })),
    []
  );

  return {
    transactions,
    budgets: computedBudgets,
    invoices,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addBudget,
    updateBudget: updateBudget,
    deleteBudget,
    addInvoice,
    updateInvoice,
    deleteInvoice,
    generateInvoice,
    getStats,
    exportReport,
    importTransactions,
    categories,
  };
}
