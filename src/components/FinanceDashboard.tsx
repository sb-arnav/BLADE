import { useState, useMemo, useCallback } from "react";
import {
  useFinance,
  Transaction,
  Budget,
  Invoice,
  InvoiceItem,
  EXPENSE_CATEGORIES,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DateRange,
} from "../hooks/useFinance";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

type Tab = "overview" | "transactions" | "budgets" | "invoices";

const TAB_ITEMS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "transactions", label: "Transactions", icon: "💸" },
  { key: "budgets", label: "Budgets", icon: "🎯" },
  { key: "invoices", label: "Invoices", icon: "📄" },
];

const TRANSACTION_TYPES: Array<{ value: Transaction["type"]; label: string }> = [
  { value: "income", label: "Income" },
  { value: "expense", label: "Expense" },
  { value: "subscription", label: "Subscription" },
  { value: "ai-cost", label: "AI Cost" },
];

const INVOICE_STATUSES: Array<{ value: Invoice["status"]; label: string; color: string }> = [
  { value: "draft", label: "Draft", color: "text-zinc-400" },
  { value: "sent", label: "Sent", color: "text-blue-400" },
  { value: "paid", label: "Paid", color: "text-emerald-400" },
  { value: "overdue", label: "Overdue", color: "text-red-400" },
];

const STATUS_BG: Record<Invoice["status"], string> = {
  draft: "bg-zinc-500/10 border-zinc-500/20",
  sent: "bg-blue-500/10 border-blue-500/20",
  paid: "bg-emerald-500/10 border-emerald-500/20",
  overdue: "bg-red-500/10 border-red-500/20",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatCurrency(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FinanceDashboard({ onBack }: Props) {
  const {
    transactions,
    budgets,
    invoices,
    addTransaction,
    deleteTransaction,
    addBudget,
    deleteBudget,
    updateInvoice,
    deleteInvoice,
    generateInvoice,
    getStats,
    exportReport,
    importTransactions,
  } = useFinance();

  const [tab, setTab] = useState<Tab>("overview");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<Transaction["type"] | "all">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>({ start: daysAgo(90), end: todayStr() });

  // Transaction form
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [txnType, setTxnType] = useState<Transaction["type"]>("expense");
  const [txnAmount, setTxnAmount] = useState("");
  const [txnCategory, setTxnCategory] = useState<string>("Other");
  const [txnDesc, setTxnDesc] = useState("");
  const [txnDate, setTxnDate] = useState(todayStr());
  const [txnRecurring, setTxnRecurring] = useState(false);
  const [txnRecPeriod, setTxnRecPeriod] = useState<"daily" | "weekly" | "monthly" | "yearly">("monthly");

  // Budget form
  const [showBudgetForm, setShowBudgetForm] = useState(false);
  const [budgetName, setBudgetName] = useState("");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [budgetPeriod, setBudgetPeriod] = useState<Budget["period"]>("monthly");
  const [budgetCategory, setBudgetCategory] = useState<string>("Other");

  // Invoice form
  const [showInvForm, setShowInvForm] = useState(false);
  const [invClient, setInvClient] = useState("");
  const [invItems, setInvItems] = useState<InvoiceItem[]>([{ description: "", quantity: 1, rate: 0, amount: 0 }]);
  const [invTax, setInvTax] = useState("0");
  const [invNotes, setInvNotes] = useState("");
  const [invDueDays, setInvDueDays] = useState("30");
  const [previewInvoice, setPreviewInvoice] = useState<Invoice | null>(null);

  // ── Stats ──────────────────────────────────────────────────────────────

  const stats = useMemo(() => getStats(dateRange), [getStats, dateRange]);

  const filteredTransactions = useMemo(() => {
    let result = transactions.filter((t) => t.date >= dateRange.start && t.date <= dateRange.end);
    if (filterType !== "all") result = result.filter((t) => t.type === filterType);
    if (filterCategory !== "all") result = result.filter((t) => t.category === filterCategory);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.category.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    return result.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }, [transactions, dateRange, filterType, filterCategory, search]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleAddTransaction = useCallback(() => {
    const amount = parseFloat(txnAmount);
    if (!amount || amount <= 0) return;
    addTransaction({
      type: txnType,
      amount,
      currency: "USD",
      category: txnCategory,
      description: txnDesc || txnCategory,
      date: txnDate,
      recurring: txnRecurring,
      recurringPeriod: txnRecurring ? txnRecPeriod : undefined,
      tags: [],
    });
    setTxnAmount("");
    setTxnDesc("");
    setShowTxnForm(false);
  }, [txnType, txnAmount, txnCategory, txnDesc, txnDate, txnRecurring, txnRecPeriod, addTransaction]);

  const handleAddBudget = useCallback(() => {
    const amount = parseFloat(budgetAmount);
    if (!amount || !budgetName.trim()) return;
    addBudget({ name: budgetName, amount, period: budgetPeriod, category: budgetCategory });
    setBudgetName("");
    setBudgetAmount("");
    setShowBudgetForm(false);
  }, [budgetName, budgetAmount, budgetPeriod, budgetCategory, addBudget]);

  const handleUpdateInvoiceItem = useCallback((index: number, field: keyof InvoiceItem, value: string) => {
    setInvItems((prev) => {
      const next = [...prev];
      const item = { ...next[index] };
      if (field === "description") item.description = value;
      else if (field === "quantity") item.quantity = parseFloat(value) || 0;
      else if (field === "rate") item.rate = parseFloat(value) || 0;
      item.amount = item.quantity * item.rate;
      next[index] = item;
      return next;
    });
  }, []);

  const handleGenerateInvoice = useCallback(() => {
    if (!invClient.trim() || invItems.every((it) => !it.description)) return;
    const validItems = invItems.filter((it) => it.description && it.amount > 0);
    generateInvoice(invClient, validItems, parseFloat(invTax) || 0, invNotes, parseInt(invDueDays) || 30);
    setInvClient("");
    setInvItems([{ description: "", quantity: 1, rate: 0, amount: 0 }]);
    setInvNotes("");
    setShowInvForm(false);
  }, [invClient, invItems, invTax, invNotes, invDueDays, generateInvoice]);

  const handleExport = useCallback(() => {
    const csv = exportReport(dateRange);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blade-finance-${dateRange.start}-to-${dateRange.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportReport, dateRange]);

  const handleImportCSV = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const count = importTransactions(reader.result as string);
        alert(`Imported ${count} transactions.`);
      };
      reader.readAsText(file);
    };
    input.click();
  }, [importTransactions]);

  const handlePrintInvoice = useCallback((inv: Invoice) => {
    const html = `<!DOCTYPE html>
<html><head><title>Invoice ${inv.number}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:40px auto;padding:20px;color:#1a1a1a}
h1{font-size:28px;margin-bottom:4px} .meta{color:#666;margin-bottom:32px}
table{width:100%;border-collapse:collapse;margin:24px 0}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e5e5}
th{background:#f8f8f8;font-weight:600} .amount{text-align:right}
.totals{margin-top:16px;text-align:right} .totals p{margin:4px 0}
.total-line{font-size:20px;font-weight:700;border-top:2px solid #333;padding-top:8px;margin-top:8px}
.notes{margin-top:32px;padding:16px;background:#f8f8f8;border-radius:8px}
.status{display:inline-block;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600}
.status-paid{background:#d1fae5;color:#065f46} .status-sent{background:#dbeafe;color:#1e40af}
.status-draft{background:#f3f4f6;color:#374151} .status-overdue{background:#fee2e2;color:#991b1b}
</style></head><body>
<h1>Invoice ${inv.number}</h1>
<div class="meta">
<p><strong>Client:</strong> ${inv.client}</p>
<p><strong>Date:</strong> ${new Date(inv.createdAt).toLocaleDateString()}</p>
<p><strong>Due:</strong> ${formatDate(inv.dueDate)}</p>
<p><span class="status status-${inv.status}">${inv.status.toUpperCase()}</span></p>
</div>
<table>
<thead><tr><th>Description</th><th class="amount">Qty</th><th class="amount">Rate</th><th class="amount">Amount</th></tr></thead>
<tbody>${inv.items.map((it) => `<tr><td>${it.description}</td><td class="amount">${it.quantity}</td><td class="amount">$${it.rate.toFixed(2)}</td><td class="amount">$${it.amount.toFixed(2)}</td></tr>`).join("")}</tbody>
</table>
<div class="totals">
<p>Subtotal: $${inv.subtotal.toFixed(2)}</p>
<p>Tax: $${inv.tax.toFixed(2)}</p>
<p class="total-line">Total: $${inv.total.toFixed(2)}</p>
</div>
${inv.notes ? `<div class="notes"><strong>Notes:</strong><br/>${inv.notes}</div>` : ""}
</body></html>`;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  }, []);

  // ── Bar chart helper ───────────────────────────────────────────────────

  const maxTrend = useMemo(
    () => Math.max(1, ...stats.monthlyTrend.flatMap((m) => [m.income, m.expenses])),
    [stats.monthlyTrend]
  );

  const maxCat = useMemo(
    () => Math.max(1, ...stats.topCategories.map((c) => c.amount)),
    [stats.topCategories]
  );

  // ── Render ─────────────────────────────────────────────────────────────

  const inputCls =
    "w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/25";
  const btnPrimary =
    "px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors";
  const btnSecondary =
    "px-4 py-2 bg-zinc-700/60 hover:bg-zinc-600/60 text-zinc-300 text-sm font-medium rounded-lg transition-colors border border-zinc-600/40";

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-100">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-zinc-400 hover:text-zinc-200 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">Finance Dashboard</h1>
          <span className="text-xs text-zinc-500">{transactions.length} transactions</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => setDateRange((r) => ({ ...r, start: e.target.value }))}
            className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
          />
          <span className="text-zinc-500 text-xs">to</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => setDateRange((r) => ({ ...r, end: e.target.value }))}
            className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-2 py-1.5 text-xs text-zinc-300"
          />
          <button onClick={handleExport} className={btnSecondary} title="Export CSV">
            Export
          </button>
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 px-5 pt-3 border-b border-zinc-800/40">
        {TAB_ITEMS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              tab === t.key
                ? "bg-zinc-800/80 text-zinc-100 border-b-2 border-blue-500"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* ──────────── OVERVIEW TAB ──────────── */}
        {tab === "overview" && (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "Income", value: stats.totalIncome, color: "text-emerald-400", bg: "bg-emerald-500/10" },
                { label: "Expenses", value: stats.totalExpenses, color: "text-red-400", bg: "bg-red-500/10" },
                { label: "Net Income", value: stats.netIncome, color: stats.netIncome >= 0 ? "text-emerald-400" : "text-red-400", bg: stats.netIncome >= 0 ? "bg-emerald-500/10" : "bg-red-500/10" },
                { label: "AI Costs", value: stats.aiCostTotal, color: "text-cyan-400", bg: "bg-cyan-500/10" },
              ].map((card) => (
                <div key={card.label} className={`${card.bg} rounded-xl p-4 border border-zinc-700/30`}>
                  <p className="text-xs text-zinc-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{formatCurrency(card.value)}</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    {card.label === "Expenses" ? `~${formatCurrency(stats.monthlyBurn)}/mo burn` : ""}
                  </p>
                </div>
              ))}
            </div>

            {/* Monthly Trend Bar Chart */}
            <div className="bg-zinc-800/40 rounded-xl p-5 border border-zinc-700/30">
              <h3 className="text-sm font-semibold text-zinc-300 mb-4">Monthly Trend</h3>
              {stats.monthlyTrend.length === 0 ? (
                <p className="text-zinc-600 text-sm text-center py-8">No data yet. Add transactions to see trends.</p>
              ) : (
                <div className="flex items-end gap-2 h-48">
                  {stats.monthlyTrend.map((m) => (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                      <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: "160px" }}>
                        <div
                          className="w-1/3 bg-emerald-500/60 rounded-t-sm transition-all"
                          style={{ height: `${(m.income / maxTrend) * 100}%`, minHeight: m.income > 0 ? "4px" : "0" }}
                          title={`Income: ${formatCurrency(m.income)}`}
                        />
                        <div
                          className="w-1/3 bg-red-500/60 rounded-t-sm transition-all"
                          style={{ height: `${(m.expenses / maxTrend) * 100}%`, minHeight: m.expenses > 0 ? "4px" : "0" }}
                          title={`Expenses: ${formatCurrency(m.expenses)}`}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-600 truncate w-full text-center">{m.month}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-4 mt-3 justify-center">
                <span className="flex items-center gap-1 text-xs text-zinc-500">
                  <span className="w-3 h-2 bg-emerald-500/60 rounded-sm" /> Income
                </span>
                <span className="flex items-center gap-1 text-xs text-zinc-500">
                  <span className="w-3 h-2 bg-red-500/60 rounded-sm" /> Expenses
                </span>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-zinc-800/40 rounded-xl p-5 border border-zinc-700/30">
                <h3 className="text-sm font-semibold text-zinc-300 mb-4">Category Breakdown</h3>
                {stats.topCategories.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-4">No expense data.</p>
                ) : (
                  <div className="space-y-3">
                    {stats.topCategories.map((cat) => (
                      <div key={cat.category}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-zinc-400">
                            {CATEGORY_ICONS[cat.category] || "📎"} {cat.category}
                          </span>
                          <span className="text-zinc-500">{formatCurrency(cat.amount)}</span>
                        </div>
                        <div className="h-2 bg-zinc-700/40 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${(cat.amount / maxCat) * 100}%`,
                              backgroundColor: CATEGORY_COLORS[cat.category] || "#64748b",
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Donut-style Category Pie */}
              <div className="bg-zinc-800/40 rounded-xl p-5 border border-zinc-700/30">
                <h3 className="text-sm font-semibold text-zinc-300 mb-4">Spending Share</h3>
                {stats.topCategories.length === 0 ? (
                  <p className="text-zinc-600 text-sm text-center py-4">No expense data.</p>
                ) : (
                  <div className="flex items-center justify-center">
                    <svg viewBox="0 0 100 100" className="w-40 h-40">
                      {(() => {
                        const total = stats.topCategories.reduce((s, c) => s + c.amount, 0);
                        let offset = 0;
                        return stats.topCategories.map((cat) => {
                          const pct = total > 0 ? (cat.amount / total) * 100 : 0;
                          const dashArray = `${pct * 2.51327} ${251.327 - pct * 2.51327}`;
                          const dashOffset = -offset * 2.51327;
                          offset += pct;
                          return (
                            <circle
                              key={cat.category}
                              cx="50"
                              cy="50"
                              r="40"
                              fill="none"
                              stroke={CATEGORY_COLORS[cat.category] || "#64748b"}
                              strokeWidth="16"
                              strokeDasharray={dashArray}
                              strokeDashoffset={dashOffset}
                              className="opacity-70"
                            />
                          );
                        });
                      })()}
                    </svg>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 mt-3 justify-center">
                  {stats.topCategories.slice(0, 6).map((cat) => (
                    <span key={cat.category} className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <span
                        className="w-2 h-2 rounded-full inline-block"
                        style={{ backgroundColor: CATEGORY_COLORS[cat.category] || "#64748b" }}
                      />
                      {cat.category}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="bg-zinc-800/40 rounded-xl p-5 border border-zinc-700/30">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Recent Transactions</h3>
              {transactions.length === 0 ? (
                <p className="text-zinc-600 text-sm text-center py-4">No transactions yet.</p>
              ) : (
                <div className="space-y-1">
                  {transactions
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .slice(0, 8)
                    .map((t) => (
                      <div key={t.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-zinc-700/20">
                        <div className="flex items-center gap-3">
                          <span className="text-base">{CATEGORY_ICONS[t.category] || "📎"}</span>
                          <div>
                            <p className="text-sm text-zinc-200">{t.description}</p>
                            <p className="text-xs text-zinc-600">{t.category} &middot; {formatDate(t.date)}</p>
                          </div>
                        </div>
                        <span className={`text-sm font-semibold ${t.type === "income" ? "text-emerald-400" : "text-red-400"}`}>
                          {t.type === "income" ? "+" : "-"}{formatCurrency(t.amount)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ──────────── TRANSACTIONS TAB ──────────── */}
        {tab === "transactions" && (
          <>
            {/* Filters & Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <input
                type="text"
                placeholder="Search transactions..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={`${inputCls} max-w-xs`}
              />
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as Transaction["type"] | "all")}
                className={inputCls + " max-w-[140px]"}
              >
                <option value="all">All Types</option>
                {TRANSACTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className={inputCls + " max-w-[160px]"}
              >
                <option value="all">All Categories</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <div className="flex-1" />
              <button onClick={handleImportCSV} className={btnSecondary}>
                Import CSV
              </button>
              <button onClick={() => setShowTxnForm(true)} className={btnPrimary}>
                + Add Transaction
              </button>
            </div>

            {/* Add Transaction Form */}
            {showTxnForm && (
              <div className="bg-zinc-800/60 rounded-xl p-5 border border-zinc-700/30 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300">New Transaction</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Type</label>
                    <select value={txnType} onChange={(e) => setTxnType(e.target.value as Transaction["type"])} className={inputCls}>
                      {TRANSACTION_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Amount ($)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={txnAmount}
                      onChange={(e) => setTxnAmount(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Category</label>
                    <select value={txnCategory} onChange={(e) => setTxnCategory(e.target.value)} className={inputCls}>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Date</label>
                    <input type="date" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} className={inputCls} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="text-xs text-zinc-500 mb-1 block">Description</label>
                    <input
                      type="text"
                      placeholder="What was this for?"
                      value={txnDesc}
                      onChange={(e) => setTxnDesc(e.target.value)}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex items-end gap-3">
                    <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={txnRecurring}
                        onChange={(e) => setTxnRecurring(e.target.checked)}
                        className="rounded border-zinc-600"
                      />
                      Recurring
                    </label>
                    {txnRecurring && (
                      <select value={txnRecPeriod} onChange={(e) => setTxnRecPeriod(e.target.value as typeof txnRecPeriod)} className={inputCls + " max-w-[120px]"}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowTxnForm(false)} className={btnSecondary}>Cancel</button>
                  <button onClick={handleAddTransaction} className={btnPrimary}>Add Transaction</button>
                </div>
              </div>
            )}

            {/* Transaction List */}
            <div className="bg-zinc-800/40 rounded-xl border border-zinc-700/30 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500 text-xs border-b border-zinc-700/30">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-zinc-600">
                        No transactions found. {!showTxnForm && "Click '+ Add Transaction' to get started."}
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.slice(0, 100).map((t) => (
                      <tr key={t.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                        <td className="px-4 py-2.5 text-zinc-400">{formatDate(t.date)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            t.type === "income"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : t.type === "ai-cost"
                              ? "bg-cyan-500/10 text-cyan-400"
                              : t.type === "subscription"
                              ? "bg-purple-500/10 text-purple-400"
                              : "bg-red-500/10 text-red-400"
                          }`}>
                            {t.type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-zinc-300">
                          {CATEGORY_ICONS[t.category] || "📎"} {t.category}
                        </td>
                        <td className="px-4 py-2.5 text-zinc-300 max-w-[200px] truncate">{t.description}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${t.type === "income" ? "text-emerald-400" : "text-red-400"}`}>
                          {t.type === "income" ? "+" : "-"}{formatCurrency(t.amount)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <button onClick={() => deleteTransaction(t.id)} className="text-zinc-600 hover:text-red-400 transition-colors text-xs">
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {filteredTransactions.length > 100 && (
                <p className="text-xs text-zinc-600 text-center py-2">Showing 100 of {filteredTransactions.length} transactions</p>
              )}
            </div>
          </>
        )}

        {/* ──────────── BUDGETS TAB ──────────── */}
        {tab === "budgets" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300">Budget Tracker</h2>
              <button onClick={() => setShowBudgetForm(true)} className={btnPrimary}>+ New Budget</button>
            </div>

            {/* Add Budget Form */}
            {showBudgetForm && (
              <div className="bg-zinc-800/60 rounded-xl p-5 border border-zinc-700/30 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300">Create Budget</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Name</label>
                    <input type="text" placeholder="e.g. AI Spending" value={budgetName} onChange={(e) => setBudgetName(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Amount ($)</label>
                    <input type="number" step="1" min="0" placeholder="500" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Period</label>
                    <select value={budgetPeriod} onChange={(e) => setBudgetPeriod(e.target.value as Budget["period"])} className={inputCls}>
                      <option value="monthly">Monthly</option>
                      <option value="quarterly">Quarterly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Category</label>
                    <select value={budgetCategory} onChange={(e) => setBudgetCategory(e.target.value)} className={inputCls}>
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setShowBudgetForm(false)} className={btnSecondary}>Cancel</button>
                  <button onClick={handleAddBudget} className={btnPrimary}>Create Budget</button>
                </div>
              </div>
            )}

            {/* Budget Cards */}
            {budgets.length === 0 && !showBudgetForm ? (
              <div className="text-center py-16 text-zinc-600">
                <p className="text-4xl mb-3">🎯</p>
                <p className="text-sm">No budgets set. Create one to start tracking spending limits.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {budgets.map((b) => {
                  const utilization = b.amount > 0 ? (b.spent / b.amount) * 100 : 0;
                  const barColor = utilization >= 100 ? "bg-red-500" : utilization >= 80 ? "bg-amber-500" : "bg-emerald-500";
                  const textColor = utilization >= 100 ? "text-red-400" : utilization >= 80 ? "text-amber-400" : "text-emerald-400";
                  return (
                    <div key={b.id} className="bg-zinc-800/40 rounded-xl p-5 border border-zinc-700/30">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h4 className="text-sm font-semibold text-zinc-200">{b.name}</h4>
                          <p className="text-xs text-zinc-500">{CATEGORY_ICONS[b.category]} {b.category} &middot; {b.period}</p>
                        </div>
                        <button onClick={() => deleteBudget(b.id)} className="text-zinc-700 hover:text-red-400 transition-colors text-xs">
                          Remove
                        </button>
                      </div>
                      <div className="flex items-end justify-between mb-2">
                        <span className="text-lg font-bold text-zinc-200">{formatCurrency(b.spent)}</span>
                        <span className="text-xs text-zinc-500">of {formatCurrency(b.amount)}</span>
                      </div>
                      <div className="h-2.5 bg-zinc-700/40 rounded-full overflow-hidden mb-2">
                        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${clamp(utilization, 0, 100)}%` }} />
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className={textColor}>{utilization.toFixed(0)}% used</span>
                        <span className="text-zinc-500">{formatCurrency(b.remaining)} remaining</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ──────────── INVOICES TAB ──────────── */}
        {tab === "invoices" && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-300">Invoices</h2>
              <button onClick={() => setShowInvForm(true)} className={btnPrimary}>+ Create Invoice</button>
            </div>

            {/* Create Invoice Form */}
            {showInvForm && (
              <div className="bg-zinc-800/60 rounded-xl p-5 border border-zinc-700/30 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-300">New Invoice</h3>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Client Name</label>
                    <input type="text" placeholder="Acme Corp" value={invClient} onChange={(e) => setInvClient(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Tax Rate (%)</label>
                    <input type="number" step="0.5" min="0" value={invTax} onChange={(e) => setInvTax(e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs text-zinc-500 mb-1 block">Due In (days)</label>
                    <input type="number" step="1" min="1" value={invDueDays} onChange={(e) => setInvDueDays(e.target.value)} className={inputCls} />
                  </div>
                </div>

                {/* Line Items */}
                <div>
                  <label className="text-xs text-zinc-500 mb-2 block">Line Items</label>
                  <div className="space-y-2">
                    {invItems.map((item, i) => (
                      <div key={i} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Description"
                          value={item.description}
                          onChange={(e) => handleUpdateInvoiceItem(i, "description", e.target.value)}
                          className={inputCls + " col-span-5"}
                        />
                        <input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity || ""}
                          onChange={(e) => handleUpdateInvoiceItem(i, "quantity", e.target.value)}
                          className={inputCls + " col-span-2"}
                        />
                        <input
                          type="number"
                          placeholder="Rate"
                          step="0.01"
                          value={item.rate || ""}
                          onChange={(e) => handleUpdateInvoiceItem(i, "rate", e.target.value)}
                          className={inputCls + " col-span-2"}
                        />
                        <span className="col-span-2 text-sm text-zinc-400 text-right">{formatCurrency(item.amount)}</span>
                        {invItems.length > 1 && (
                          <button
                            onClick={() => setInvItems((prev) => prev.filter((_, j) => j !== i))}
                            className="col-span-1 text-zinc-600 hover:text-red-400 text-xs"
                          >
                            X
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => setInvItems((prev) => [...prev, { description: "", quantity: 1, rate: 0, amount: 0 }])}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      + Add line item
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 mb-1 block">Notes</label>
                  <textarea
                    placeholder="Payment terms, thank you note, etc."
                    value={invNotes}
                    onChange={(e) => setInvNotes(e.target.value)}
                    rows={2}
                    className={inputCls}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-zinc-400">
                    Subtotal: {formatCurrency(invItems.reduce((s, it) => s + it.amount, 0))}
                    {parseFloat(invTax) > 0 && (
                      <span className="ml-3">
                        Tax: {formatCurrency(invItems.reduce((s, it) => s + it.amount, 0) * (parseFloat(invTax) / 100))}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setShowInvForm(false)} className={btnSecondary}>Cancel</button>
                    <button onClick={handleGenerateInvoice} className={btnPrimary}>Generate Invoice</button>
                  </div>
                </div>
              </div>
            )}

            {/* Invoice Preview Modal */}
            {previewInvoice && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
                <div className="bg-zinc-900 rounded-2xl border border-zinc-700/50 max-w-2xl w-full max-h-[80vh] overflow-y-auto p-8">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h2 className="text-xl font-bold text-zinc-100">Invoice {previewInvoice.number}</h2>
                      <p className="text-sm text-zinc-500">Client: {previewInvoice.client}</p>
                    </div>
                    <button onClick={() => setPreviewInvoice(null)} className="text-zinc-500 hover:text-zinc-300 text-lg">&times;</button>
                  </div>
                  <table className="w-full text-sm mb-4">
                    <thead>
                      <tr className="border-b border-zinc-700/40 text-zinc-500 text-xs">
                        <th className="py-2 text-left">Description</th>
                        <th className="py-2 text-right">Qty</th>
                        <th className="py-2 text-right">Rate</th>
                        <th className="py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewInvoice.items.map((it, i) => (
                        <tr key={i} className="border-b border-zinc-800/40">
                          <td className="py-2 text-zinc-300">{it.description}</td>
                          <td className="py-2 text-right text-zinc-400">{it.quantity}</td>
                          <td className="py-2 text-right text-zinc-400">{formatCurrency(it.rate)}</td>
                          <td className="py-2 text-right text-zinc-200">{formatCurrency(it.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="text-right space-y-1 mb-4">
                    <p className="text-sm text-zinc-500">Subtotal: {formatCurrency(previewInvoice.subtotal)}</p>
                    <p className="text-sm text-zinc-500">Tax: {formatCurrency(previewInvoice.tax)}</p>
                    <p className="text-lg font-bold text-zinc-100 border-t border-zinc-700/40 pt-2">
                      Total: {formatCurrency(previewInvoice.total)}
                    </p>
                  </div>
                  {previewInvoice.notes && (
                    <div className="bg-zinc-800/40 rounded-lg p-3 text-sm text-zinc-400 mb-4">{previewInvoice.notes}</div>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setPreviewInvoice(null)} className={btnSecondary}>Close</button>
                    <button onClick={() => handlePrintInvoice(previewInvoice)} className={btnPrimary}>Print / Export</button>
                  </div>
                </div>
              </div>
            )}

            {/* Invoice List */}
            {invoices.length === 0 && !showInvForm ? (
              <div className="text-center py-16 text-zinc-600">
                <p className="text-4xl mb-3">📄</p>
                <p className="text-sm">No invoices yet. Create one to bill your clients professionally.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {invoices
                  .sort((a, b) => b.createdAt - a.createdAt)
                  .map((inv) => (
                    <div key={inv.id} className="bg-zinc-800/40 rounded-xl p-4 border border-zinc-700/30 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`px-2.5 py-1 rounded-lg border text-xs font-semibold ${STATUS_BG[inv.status]}`}>
                          <span className={INVOICE_STATUSES.find((s) => s.value === inv.status)?.color}>{inv.status.toUpperCase()}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-zinc-200">{inv.number}</p>
                          <p className="text-xs text-zinc-500">{inv.client} &middot; Due {formatDate(inv.dueDate)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-bold text-zinc-200">{formatCurrency(inv.total)}</span>
                        <div className="flex gap-1">
                          <button onClick={() => setPreviewInvoice(inv)} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1">
                            Preview
                          </button>
                          <button onClick={() => handlePrintInvoice(inv)} className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1">
                            Print
                          </button>
                          {inv.status === "draft" && (
                            <button
                              onClick={() => updateInvoice(inv.id, { status: "sent" })}
                              className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1"
                            >
                              Mark Sent
                            </button>
                          )}
                          {(inv.status === "sent" || inv.status === "overdue") && (
                            <button
                              onClick={() => updateInvoice(inv.id, { status: "paid" })}
                              className="text-xs text-emerald-400 hover:text-emerald-300 px-2 py-1"
                            >
                              Mark Paid
                            </button>
                          )}
                          <button onClick={() => deleteInvoice(inv.id)} className="text-xs text-zinc-700 hover:text-red-400 px-2 py-1">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
