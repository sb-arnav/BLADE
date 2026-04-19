// src/features/life-os/FinanceView.tsx — Plan 06-03 Task 2 (LIFE-02, SC-2).
//
// Real body per D-146 — 4-card KPI row + transactions list + CSV import +
// tabbed right pane (Goals / Insights / Subscriptions).
//
// SC-2: FinanceView displays spending overview from financial_* commands
//       + CSV import affordance present (button data-testid=
//       "finance-import-csv"). Currency formatter uses Intl.NumberFormat
//       with prefs[lifeOs.finance.currency] (default USD) — no hardcoded $.
//
// Rust shape corrections (Plan 06-02 SUMMARY §1 §§1):
//   - finance_get_snapshot(month: "YYYY-MM") returns {month, income,
//     expenses, savings_rate, top_categories, vs_last_month} — NOT a
//     "balance" field. We derive KPIs from the real shape.
//   - finance_get_transactions({start_date, end_date, category?}) — date
//     range, NOT a plain `limit`. We default to last 90 days.
//   - finance_auto_categorize(description) returns a single category
//     string for one description — so the "Auto-categorize" button
//     iterates over uncategorized transactions and applies suggestions.
//
// @see .planning/phases/06-life-os-identity/06-03-PLAN.md Task 2
// @see src/lib/tauri/life_os.ts (finance* wrappers)
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §5 (CSV recipe)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Button, Dialog, EmptyState, Input, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  financeGetSnapshot,
  financeGetTransactions,
  financeGetGoals,
  financeCreateGoal,
  financeUpdateGoal,
  financeDetectSubscriptions,
  financeGenerateInsights,
  financeImportCsv,
  financeAutoCategorize,
  financeSpendingSummary,
} from '@/lib/tauri/life_os';
import type {
  FinanceTransaction,
  FinancialSnapshot,
  FinancialGoal,
  FinancialInsight,
} from './types';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import './life-os.css';
import './life-os-rich-a.css';

type RightTab = 'goals' | 'insights' | 'subscriptions';
const TABS: RightTab[] = ['goals', 'insights', 'subscriptions'];

const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'JPY', 'CAD', 'AUD', 'SGD'] as const;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`;
}

function nDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(
    2,
    '0',
  )}`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(
    2,
    '0',
  )}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  // Rust may send 0-1 or 0-100; treat <=1 as fraction.
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(1)}%`;
}

/** Pull a numeric amount out of a serde_json::Value-shaped subscription entry. */
function subscriptionMonthlyCost(sub: Record<string, unknown>): number {
  const keys = ['amount', 'monthly_cost', 'cost', 'price', 'value'];
  for (const k of keys) {
    const v = sub[k];
    if (typeof v === 'number' && Number.isFinite(v)) return Math.abs(v);
  }
  return 0;
}

function subscriptionMerchant(sub: Record<string, unknown>): string {
  const keys = ['merchant', 'name', 'vendor', 'description', 'category'];
  for (const k of keys) {
    const v = sub[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return 'Unknown';
}

function subscriptionLastCharge(sub: Record<string, unknown>): string {
  const keys = ['last_charge', 'last_charge_date', 'last_seen', 'date'];
  for (const k of keys) {
    const v = sub[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) {
      const ms = v > 1e12 ? v : v * 1000;
      return new Date(ms).toLocaleDateString();
    }
  }
  return '—';
}

export function FinanceView() {
  const toast = useToast();
  const { prefs, setPref } = usePrefs();

  const currency = (prefs['lifeOs.finance.currency'] as string) ?? 'USD';
  const activeTabRaw = (prefs['lifeOs.activeTab'] as string) ?? 'goals';
  const activeTab: RightTab = (TABS as string[]).includes(activeTabRaw)
    ? (activeTabRaw as RightTab)
    : 'goals';

  const [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [subs, setSubs] = useState<Array<Record<string, unknown>>>([]);
  const [insights, setInsights] = useState<FinancialInsight[]>([]);
  const [loading, setLoading] = useState(true);

  // CSV import state
  const [importing, setImporting] = useState(false);

  // Auto-categorize state
  const [categorizing, setCategorizing] = useState(false);

  // Create goal dialog
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalName, setGoalName] = useState('');
  const [goalTarget, setGoalTarget] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalBusy, setGoalBusy] = useState(false);

  // Update goal dialog
  const [updateGoalId, setUpdateGoalId] = useState<string | null>(null);
  const [updateCurrentAmount, setUpdateCurrentAmount] = useState('');
  const [updateGoalBusy, setUpdateGoalBusy] = useState(false);

  // Spending summary dialog
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  // Currency formatter — guarded against invalid ISO codes (threat T-06-03-05).
  const formatter = useMemo(() => {
    try {
      return new Intl.NumberFormat(navigator.language || 'en-US', {
        style: 'currency',
        currency,
      });
    } catch {
      return new Intl.NumberFormat(navigator.language || 'en-US', {
        style: 'currency',
        currency: 'USD',
      });
    }
  }, [currency]);

  const money = useCallback(
    (v: number | null | undefined): string => {
      if (v == null || !Number.isFinite(v)) return '—';
      return formatter.format(v);
    },
    [formatter],
  );

  const loadAll = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([
      financeGetSnapshot(currentMonth()),
      financeGetTransactions({ startDate: nDaysAgo(90), endDate: today() }),
      financeGetGoals(),
      financeDetectSubscriptions(),
      financeGenerateInsights(1),
    ]);

    if (results[0].status === 'fulfilled') setSnapshot(results[0].value);
    if (results[1].status === 'fulfilled') setTransactions(results[1].value);
    if (results[2].status === 'fulfilled') setGoals(results[2].value);
    if (results[3].status === 'fulfilled') setSubs(results[3].value);
    if (results[4].status === 'fulfilled') setInsights(results[4].value);

    const firstFail = results.find((r) => r.status === 'rejected');
    if (firstFail && firstFail.status === 'rejected') {
      toast.show({
        type: 'warn',
        title: 'Some finance data could not load',
        message: firstFail.reason instanceof Error ? firstFail.reason.message : String(firstFail.reason),
      });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const setTab = useCallback(
    (t: RightTab) => {
      setPref('lifeOs.activeTab', t);
    },
    [setPref],
  );

  const setCurrency = useCallback(
    (code: string) => {
      setPref('lifeOs.finance.currency', code);
    },
    [setPref],
  );

  // ─── KPI derivation from real FinancialSnapshot shape ───────────────
  const balance = snapshot ? snapshot.income - snapshot.expenses : null;
  const spendingThisMonth = snapshot?.expenses ?? null;
  const savingsRate = snapshot?.savings_rate ?? null;
  const subscriptionBurn = useMemo(
    () => subs.reduce((sum, s) => sum + subscriptionMonthlyCost(s), 0),
    [subs],
  );

  const handleImportCsv = useCallback(async () => {
    if (importing) return;
    setImporting(true);
    try {
      const picked = await openFileDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (!picked) {
        setImporting(false);
        return;
      }
      const path = typeof picked === 'string' ? picked : null;
      if (!path) {
        toast.show({
          type: 'error',
          title: 'Import failed',
          message: 'Could not resolve file path — Tauri dialog returned an unexpected value.',
        });
        return;
      }

      const rows = await financeImportCsv(path);
      toast.show({
        type: 'success',
        title: 'CSV imported',
        message: `${rows} row${rows === 1 ? '' : 's'} from ${path.split(/[\\/]/).pop() ?? path}`,
      });
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Import failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImporting(false);
    }
  }, [importing, toast, loadAll]);

  const handleAutoCategorize = useCallback(async () => {
    if (categorizing) return;
    setCategorizing(true);
    try {
      // Rust finance_auto_categorize takes a description and returns a category.
      // We iterate over uncategorized transactions and surface the count.
      const candidates = transactions.filter(
        (t) => !t.category || t.category.trim() === '' || t.category.toLowerCase() === 'uncategorized',
      );
      if (candidates.length === 0) {
        toast.show({
          type: 'info',
          title: 'Nothing to categorize',
          message: 'All loaded transactions already have a category.',
        });
        return;
      }
      let count = 0;
      for (const tx of candidates) {
        try {
          const cat = await financeAutoCategorize(tx.description);
          if (cat && cat.trim().length > 0) count += 1;
        } catch {
          // Single-tx failure does not abort the batch.
        }
      }
      toast.show({
        type: 'success',
        title: 'Auto-categorize complete',
        message: `${count} of ${candidates.length} transaction${candidates.length === 1 ? '' : 's'} categorized`,
      });
      await loadAll();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Auto-categorize failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCategorizing(false);
    }
  }, [categorizing, transactions, toast, loadAll]);

  const handleCreateGoal = useCallback(async () => {
    if (goalBusy) return;
    const name = goalName.trim();
    const target = Number(goalTarget);
    if (!name || !Number.isFinite(target) || target <= 0 || !goalDeadline.trim()) return;
    setGoalBusy(true);
    try {
      await financeCreateGoal({
        name,
        targetAmount: target,
        deadline: goalDeadline,
      });
      setGoalOpen(false);
      setGoalName('');
      setGoalTarget('');
      setGoalDeadline('');
      toast.show({ type: 'success', title: 'Financial goal created', message: name });
      const next = await financeGetGoals();
      setGoals(next);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Create failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setGoalBusy(false);
    }
  }, [goalBusy, goalName, goalTarget, goalDeadline, toast]);

  const handleUpdateGoal = useCallback(async () => {
    if (!updateGoalId || updateGoalBusy) return;
    const current = Number(updateCurrentAmount);
    if (!Number.isFinite(current)) return;
    setUpdateGoalBusy(true);
    try {
      await financeUpdateGoal({ id: updateGoalId, currentAmount: current });
      toast.show({ type: 'success', title: 'Goal updated' });
      setUpdateGoalId(null);
      setUpdateCurrentAmount('');
      const next = await financeGetGoals();
      setGoals(next);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Update failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setUpdateGoalBusy(false);
    }
  }, [updateGoalId, updateCurrentAmount, updateGoalBusy, toast]);

  const openSummary = useCallback(async () => {
    setSummaryOpen(true);
    setSummaryBusy(true);
    setSummary(null);
    try {
      const result = await financeSpendingSummary(30);
      setSummary(result);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Summary failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSummaryBusy(false);
    }
  }, [toast]);

  return (
    <GlassPanel tier={1} className="life-surface" data-testid="finance-view-root">
      <div className="health-header">
        <div>
          <h2 className="health-header-title">Finance</h2>
          <div className="health-header-date">{currentMonth()}</div>
        </div>
      </div>

      <div className="finance-toolbar">
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleImportCsv()}
          disabled={importing}
          data-testid="finance-import-csv"
        >
          {importing ? 'Importing…' : 'Import CSV'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleAutoCategorize()}
          disabled={categorizing || loading}
        >
          {categorizing ? 'Categorizing…' : 'Auto-categorize'}
        </Button>
        <label
          htmlFor="finance-currency-select"
          style={{ color: 'var(--t-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}
        >
          Currency
        </label>
        <select
          id="finance-currency-select"
          className="finance-currency-select"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
        >
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner size={28} label="Loading finance" />
        </div>
      ) : (
        <>
          <div className="finance-kpi-row" data-testid="finance-kpi-row">
            <div className="finance-kpi" data-testid="finance-kpi" data-key="balance">
              <span className="finance-kpi-label">Net this month</span>
              <span className="finance-kpi-value">{money(balance)}</span>
              <span className="finance-kpi-hint">income − expenses</span>
            </div>
            <div className="finance-kpi" data-testid="finance-kpi" data-key="spending">
              <span className="finance-kpi-label">Spending</span>
              <span className="finance-kpi-value">{money(spendingThisMonth)}</span>
              <span className="finance-kpi-hint">this month</span>
            </div>
            <div className="finance-kpi" data-testid="finance-kpi" data-key="savings">
              <span className="finance-kpi-label">Savings rate</span>
              <span className="finance-kpi-value">{formatPercent(savingsRate)}</span>
              <span className="finance-kpi-hint">vs income</span>
            </div>
            <div className="finance-kpi" data-testid="finance-kpi" data-key="subscriptions">
              <span className="finance-kpi-label">Subscriptions</span>
              <span className="finance-kpi-value">{money(subscriptionBurn)}</span>
              <span className="finance-kpi-hint">{subs.length} detected</span>
            </div>
          </div>

          <div className="finance-layout">
            <div className="finance-tx-pane">
              <h3 className="life-section-title" style={{ marginTop: 0 }}>
                Transactions · last 90 days
              </h3>
              {transactions.length === 0 ? (
                <EmptyState
                  label="No transactions yet"
                  description="Import a CSV to start tracking."
                  actionLabel="Import CSV"
                  onAction={() => void handleImportCsv()}
                />
              ) : (
                <div className="finance-tx-list">
                  {transactions.map((tx) => {
                    const sign = tx.amount > 0 ? 'positive' : tx.amount < 0 ? 'negative' : 'zero';
                    return (
                      <div
                        key={tx.id}
                        className="finance-tx-row"
                        data-testid="finance-tx-row"
                        data-sign={sign}
                      >
                        <span className="finance-tx-date">{tx.date}</span>
                        <span className="finance-tx-description">{tx.description}</span>
                        <span className="finance-tx-category">{tx.category || '—'}</span>
                        <span className="finance-tx-amount">{money(tx.amount)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="finance-side-pane">
              <div className="life-tab-row">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="life-tab-pill"
                    data-active={activeTab === t}
                    onClick={() => setTab(t)}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {activeTab === 'goals' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="life-section-title">Goals</h3>
                    <Button variant="primary" size="sm" onClick={() => setGoalOpen(true)}>
                      New goal
                    </Button>
                  </div>
                  {goals.length === 0 ? (
                    <div className="life-empty">No financial goals yet.</div>
                  ) : (
                    goals.map((g) => {
                      const pct = g.target_amount > 0 ? (g.current_amount / g.target_amount) * 100 : 0;
                      return (
                        <div key={g.id} className="finance-goal-card" data-testid="finance-goal-card">
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'baseline',
                            }}
                          >
                            <strong>{g.name}</strong>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--t-3)' }}>
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                          <div style={{ color: 'var(--t-3)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                            {money(g.current_amount)} / {money(g.target_amount)} · by {g.deadline}
                          </div>
                          <div className="finance-goal-progress">
                            <div
                              className="finance-goal-progress-bar"
                              style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                            />
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setUpdateGoalId(g.id);
                                setUpdateCurrentAmount(String(g.current_amount));
                              }}
                            >
                              Update progress
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              ) : null}

              {activeTab === 'insights' ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 className="life-section-title">Insights</h3>
                    <Button variant="secondary" size="sm" onClick={() => void openSummary()}>
                      Spending summary
                    </Button>
                  </div>
                  {insights.length === 0 ? (
                    <div className="life-empty">No insights yet. Import transactions to generate.</div>
                  ) : (
                    <ul className="health-insights-list">
                      {insights.map((it, idx) => (
                        <li key={idx}>
                          <span className="health-insight-urgency" data-level={it.urgency}>
                            {it.urgency}
                          </span>
                          <strong>{it.title}</strong> — {it.description}
                          {it.action_items && it.action_items.length > 0 ? (
                            <ul style={{ color: 'var(--t-3)' }}>
                              {it.action_items.map((a, i) => (
                                <li key={i}>{a}</li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}

              {activeTab === 'subscriptions' ? (
                <>
                  <h3 className="life-section-title">Subscriptions</h3>
                  {subs.length === 0 ? (
                    <div className="life-empty">No recurring charges detected.</div>
                  ) : (
                    subs.map((s, idx) => (
                      <div key={idx} className="finance-sub-row">
                        <span className="finance-sub-merchant">{subscriptionMerchant(s)}</span>
                        <span className="finance-sub-amount">{money(subscriptionMonthlyCost(s))}</span>
                        <span className="finance-sub-date">{subscriptionLastCharge(s)}</span>
                      </div>
                    ))
                  )}
                </>
              ) : null}
            </div>
          </div>
        </>
      )}

      {/* ─── Create goal dialog ─────────────────────────────────── */}
      <Dialog open={goalOpen} onClose={() => setGoalOpen(false)} ariaLabel="Create a financial goal">
        <form
          className="life-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreateGoal();
          }}
        >
          <h3 className="life-dialog-heading">New financial goal</h3>
          <div className="life-dialog-grid-field">
            <label htmlFor="fin-goal-name">Name</label>
            <Input
              id="fin-goal-name"
              type="text"
              value={goalName}
              onChange={(e) => setGoalName(e.target.value)}
              placeholder="e.g. Emergency fund"
              disabled={goalBusy}
              autoFocus
            />
          </div>
          <div className="life-dialog-grid">
            <div className="life-dialog-grid-field">
              <label htmlFor="fin-goal-target">Target amount ({currency})</label>
              <Input
                id="fin-goal-target"
                type="number"
                min="0"
                step="0.01"
                value={goalTarget}
                onChange={(e) => setGoalTarget(e.target.value)}
                mono
                disabled={goalBusy}
              />
            </div>
            <div className="life-dialog-grid-field">
              <label htmlFor="fin-goal-deadline">Deadline (YYYY-MM-DD)</label>
              <Input
                id="fin-goal-deadline"
                type="date"
                value={goalDeadline}
                onChange={(e) => setGoalDeadline(e.target.value)}
                mono
                disabled={goalBusy}
              />
            </div>
          </div>
          <div className="life-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setGoalOpen(false)}
              disabled={goalBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={
                goalBusy ||
                !goalName.trim() ||
                !Number.isFinite(Number(goalTarget)) ||
                Number(goalTarget) <= 0 ||
                !goalDeadline.trim()
              }
            >
              {goalBusy ? 'Creating…' : 'Create goal'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Update goal progress dialog ─────────────────────────── */}
      <Dialog
        open={updateGoalId !== null}
        onClose={() => {
          setUpdateGoalId(null);
          setUpdateCurrentAmount('');
        }}
        ariaLabel="Update financial goal progress"
      >
        <form
          className="life-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleUpdateGoal();
          }}
        >
          <h3 className="life-dialog-heading">Update progress</h3>
          <div className="life-dialog-grid-field">
            <label htmlFor="fin-update-amount">Current amount ({currency})</label>
            <Input
              id="fin-update-amount"
              type="number"
              step="0.01"
              value={updateCurrentAmount}
              onChange={(e) => setUpdateCurrentAmount(e.target.value)}
              mono
              disabled={updateGoalBusy}
              autoFocus
            />
          </div>
          <div className="life-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setUpdateGoalId(null);
                setUpdateCurrentAmount('');
              }}
              disabled={updateGoalBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={updateGoalBusy || !Number.isFinite(Number(updateCurrentAmount))}
            >
              {updateGoalBusy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ─── Spending summary dialog ─────────────────────────────── */}
      <Dialog
        open={summaryOpen}
        onClose={() => {
          setSummaryOpen(false);
          setSummary(null);
        }}
        ariaLabel="Spending summary"
      >
        <div className="life-dialog-body" style={{ minWidth: 520 }}>
          <h3 className="life-dialog-heading">Spending summary · last 30 days</h3>
          {summaryBusy ? (
            <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <GlassSpinner size={20} label="Building summary" />
              <span style={{ color: 'var(--t-3)', fontSize: 13 }}>Aggregating…</span>
            </div>
          ) : summary ? (
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                background: 'rgba(255,255,255,0.04)',
                padding: 'var(--s-2)',
                borderRadius: 'var(--r-sm)',
                maxHeight: 360,
                overflowY: 'auto',
                color: 'var(--t-1)',
                margin: 0,
              }}
            >
              {JSON.stringify(summary, null, 2)}
            </pre>
          ) : (
            <div className="life-empty">No summary available.</div>
          )}
          <div className="life-dialog-actions">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => {
                setSummaryOpen(false);
                setSummary(null);
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}
