// src/components/FinanceView.tsx
// BLADE Finance — spending summary, category breakdown, subscriptions, CSV import

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CategoryAmount {
  category: string;
  amount: number;
}

interface SpendingSummary {
  total_expense: number;
  total_income: number;
  net: number;
  by_category: CategoryAmount[];
}

interface Subscription {
  merchant: string;
  amount: number;
  occurrences: number;
  annual_cost: number;
  last_charge: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs >= 1000
    ? `$${(abs / 1000).toFixed(1)}k`
    : `$${abs.toFixed(2)}`;
  return amount < 0 ? `-${formatted}` : formatted;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-blade-border bg-blade-surface px-4 py-3 flex-1 min-w-0">
      <p className="text-2xs uppercase tracking-[0.15em] text-blade-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums truncate ${valueClass ?? "text-blade-text"}`}>
        {value}
      </p>
      {sub && <p className="text-2xs text-blade-muted">{sub}</p>}
    </div>
  );
}

// ── Category bar chart (CSS-only) ─────────────────────────────────────────────

function CategoryBreakdown({ categories }: { categories: CategoryAmount[] }) {
  if (categories.length === 0) {
    return (
      <p className="text-xs text-blade-muted py-2">No category data available.</p>
    );
  }

  const sorted = [...categories].sort((a, b) => b.amount - a.amount);
  const maxAmount = sorted[0]?.amount ?? 1;

  const barColors = [
    "bg-blade-accent",
    "bg-blue-500",
    "bg-purple-500",
    "bg-yellow-500",
    "bg-pink-500",
    "bg-teal-500",
    "bg-orange-500",
    "bg-indigo-500",
  ];

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((cat, i) => {
        const pct = maxAmount > 0 ? (cat.amount / maxAmount) * 100 : 0;
        const color = barColors[i % barColors.length];
        return (
          <div key={cat.category} className="flex items-center gap-3">
            <p className="text-2xs text-blade-secondary w-28 shrink-0 truncate capitalize">
              {cat.category}
            </p>
            <div className="flex-1 h-2 rounded-full bg-blade-border overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${color}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-2xs text-blade-muted tabular-nums w-16 text-right shrink-0">
              {formatCurrency(cat.amount)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ── Subscriptions list ────────────────────────────────────────────────────────

function SubscriptionRow({ sub }: { sub: Subscription }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-blade-border/40 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-blade-surface border border-blade-border flex items-center justify-center shrink-0">
        <span className="text-xs font-semibold text-blade-secondary">
          {sub.merchant.slice(0, 2).toUpperCase()}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-blade-text truncate">{sub.merchant}</p>
        <p className="text-2xs text-blade-muted">
          {sub.occurrences} charge{sub.occurrences !== 1 ? "s" : ""} &middot; last {formatDate(sub.last_charge)}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-semibold text-blade-text tabular-nums">
          {formatCurrency(sub.amount)}/mo
        </p>
        <p className="text-2xs text-blade-muted tabular-nums">
          {formatCurrency(sub.annual_cost)}/yr
        </p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function FinanceView({ onBack }: { onBack: () => void }) {
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const data = await invoke<SpendingSummary>("finance_spending_summary", { days: 30 });
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setLoadingSummary(false);
    }
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    setLoadingSubs(true);
    try {
      const subs = await invoke<Subscription[]>("finance_detect_subscriptions");
      setSubscriptions(subs);
    } catch {
      setSubscriptions([]);
    } finally {
      setLoadingSubs(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
    fetchSubscriptions();
  }, [fetchSummary, fetchSubscriptions]);

  const handleImport = useCallback(async () => {
    setImportMessage(null);
    setImportError(null);
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!selected) return;
      const path = typeof selected === "string" ? selected : selected;
      setImporting(true);
      await invoke("finance_import_csv", { path });
      setImportMessage("Import successful. Refreshing data...");
      await fetchSummary();
      await fetchSubscriptions();
    } catch (e) {
      setImportError(String(e));
    } finally {
      setImporting(false);
    }
  }, [fetchSummary, fetchSubscriptions]);

  const netClass = summary
    ? summary.net >= 0
      ? "text-green-400"
      : "text-red-400"
    : "text-blade-text";

  const totalAnnualSubscriptions = subscriptions.reduce((s, r) => s + r.annual_cost, 0);

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-text transition-colors"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1 className="text-sm font-semibold text-blade-text">Finance</h1>
            <p className="text-2xs text-blade-muted">Last 30 days</p>
          </div>
        </div>
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blade-accent/10 border border-blade-accent/30 text-xs text-blade-accent hover:bg-blade-accent/20 transition-colors disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {importing ? "Importing..." : "Import CSV"}
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
        {/* Import feedback */}
        {importMessage && (
          <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2 text-xs text-green-400">
            {importMessage}
          </div>
        )}
        {importError && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
            {importError}
          </div>
        )}

        {/* Summary cards */}
        <div>
          <p className="text-2xs uppercase tracking-[0.15em] text-blade-muted mb-2">This Month</p>
          {loadingSummary ? (
            <div className="flex items-center gap-2 text-blade-muted text-xs py-2">
              <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
              Loading summary...
            </div>
          ) : (
            <div className="flex gap-2">
              <SummaryCard
                label="Spending"
                value={summary ? formatCurrency(summary.total_expense) : "—"}
                valueClass="text-red-400"
              />
              <SummaryCard
                label="Income"
                value={summary ? formatCurrency(summary.total_income) : "—"}
                valueClass="text-green-400"
              />
              <SummaryCard
                label="Net"
                value={summary ? formatCurrency(summary.net) : "—"}
                valueClass={netClass}
                sub={summary && summary.net >= 0 ? "surplus" : "deficit"}
              />
            </div>
          )}
        </div>

        {/* Category breakdown */}
        <div>
          <p className="text-2xs uppercase tracking-[0.15em] text-blade-muted mb-3">By Category</p>
          <div className="rounded-xl border border-blade-border bg-blade-surface px-4 py-3">
            {loadingSummary ? (
              <div className="flex items-center gap-2 text-blade-muted text-xs py-2">
                <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
                Loading...
              </div>
            ) : (
              <CategoryBreakdown categories={summary?.by_category ?? []} />
            )}
          </div>
        </div>

        {/* Subscriptions */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-2xs uppercase tracking-[0.15em] text-blade-muted">
              Recurring Charges
              {subscriptions.length > 0 && (
                <span className="ml-1 opacity-50">({subscriptions.length})</span>
              )}
            </p>
            {subscriptions.length > 0 && (
              <p className="text-2xs text-blade-muted tabular-nums">
                {formatCurrency(totalAnnualSubscriptions)}/yr total
              </p>
            )}
          </div>
          <div className="rounded-xl border border-blade-border bg-blade-surface px-4">
            {loadingSubs ? (
              <div className="flex items-center gap-2 text-blade-muted text-xs py-4">
                <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
                Detecting subscriptions...
              </div>
            ) : subscriptions.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-xs text-blade-secondary">No recurring charges detected</p>
                <p className="text-2xs text-blade-muted mt-1">
                  Import transactions to detect subscriptions.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-blade-border/40">
                {subscriptions.map((sub) => (
                  <SubscriptionRow key={`${sub.merchant}-${sub.amount}`} sub={sub} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Empty state — no data at all */}
        {!loadingSummary && !summary && subscriptions.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <div className="w-10 h-10 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-blade-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-blade-secondary">No financial data yet</p>
              <p className="text-2xs text-blade-muted mt-1">
                Import a CSV to get started.
              </p>
            </div>
            <button
              onClick={handleImport}
              disabled={importing}
              className="px-4 py-1.5 rounded-lg bg-blade-accent/10 border border-blade-accent/30 text-xs text-blade-accent hover:bg-blade-accent/20 transition-colors disabled:opacity-40"
            >
              Import CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
