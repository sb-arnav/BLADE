// src/features/admin/SecurityPoliciesTab.tsx — Plan 07-05 Task 2.
//
// Policies sub-tab. Symbolic policy engine surface:
//   - symbolicListPolicies() — current policies as cards.
//   - "Add policy" Dialog → symbolicAddPolicy({ id, name, condition, action, reason }).
//   - Per-policy "Check" inline input → symbolicCheckPolicy(action) returns
//     PolicyCheckResult (allowed / triggered_policies / action / reason).
//   - "Verify plan" panel: plan JSON textarea + Verify → symbolicVerifyPlan(plan)
//     returns Vec<String> violations (empty = plan is policy-clean).
//
// Rust shape corrections (Plan 07-02 SUMMARY):
//   - symbolicCheckPolicy takes a flat `action: string` (not an {id, context}
//     tuple). We expose an inline textbox for the action string per-policy
//     card.
//   - symbolicVerifyPlan takes a flat plan JSON string. Output is Vec<String>
//     (violation messages), not a structured diagnostics object.
//
// @see .planning/phases/07-dev-tools-admin/07-05-PLAN.md Task 2

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Input, Pill, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  symbolicListPolicies,
  symbolicAddPolicy,
  symbolicCheckPolicy,
  symbolicVerifyPlan,
} from '@/lib/tauri/admin';
import type { SymbolicPolicy, PolicyCheckResult } from './types';

export function SecurityPoliciesTab() {
  const toast = useToast();

  const [policies, setPolicies] = useState<SymbolicPolicy[]>([]);
  const [loading, setLoading] = useState(true);

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addId, setAddId] = useState('');
  const [addName, setAddName] = useState('');
  const [addCondition, setAddCondition] = useState('');
  const [addAction, setAddAction] = useState('deny');
  const [addReason, setAddReason] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  // Per-policy check inputs
  const [checkInput, setCheckInput] = useState('');
  const [checkBusy, setCheckBusy] = useState(false);
  const [checkResult, setCheckResult] = useState<PolicyCheckResult | null>(null);

  // Verify-plan
  const [planText, setPlanText] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [violations, setViolations] = useState<string[] | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const out = await symbolicListPolicies();
      setPolicies(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Policies failed to load',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAdd = useCallback(async () => {
    if (addBusy) return;
    const id = addId.trim();
    const name = addName.trim();
    const condition = addCondition.trim();
    const action = addAction.trim();
    const reason = addReason.trim();
    if (!id || !name || !condition || !action) return;
    setAddBusy(true);
    try {
      await symbolicAddPolicy({ id, name, condition, action, reason });
      toast.show({ type: 'success', title: 'Policy added', message: name });
      setAddOpen(false);
      setAddId('');
      setAddName('');
      setAddCondition('');
      setAddAction('deny');
      setAddReason('');
      await reload();
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Add policy failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAddBusy(false);
    }
  }, [addBusy, addId, addName, addCondition, addAction, addReason, toast, reload]);

  const handleCheck = useCallback(async () => {
    if (checkBusy || !checkInput.trim()) return;
    setCheckBusy(true);
    setCheckResult(null);
    try {
      const out = await symbolicCheckPolicy(checkInput.trim());
      setCheckResult(out);
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Policy check failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setCheckBusy(false);
    }
  }, [checkBusy, checkInput, toast]);

  const handleVerify = useCallback(async () => {
    if (verifyBusy) return;
    // Validate JSON client-side before sending.
    if (planText.trim().length === 0) return;
    try {
      JSON.parse(planText);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Invalid plan JSON',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    setVerifyBusy(true);
    setViolations(null);
    try {
      const out = await symbolicVerifyPlan(planText);
      setViolations(out);
      toast.show({
        type: out.length === 0 ? 'success' : 'warn',
        title: out.length === 0 ? 'Plan is policy-clean' : `${out.length} violation(s)`,
      });
    } catch (err) {
      toast.show({
        type: 'error',
        title: 'Verify plan failed',
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setVerifyBusy(false);
    }
  }, [verifyBusy, planText, toast]);

  const enabledCount = useMemo(
    () => policies.filter((p) => p.enabled).length,
    [policies],
  );

  return (
    <div data-testid="security-policies-root">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 className="admin-section-title" style={{ margin: 0 }}>
          Policies ({enabledCount}/{policies.length} enabled)
        </h3>
        <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
          Add policy
        </Button>
      </div>

      {loading ? (
        <div style={{ padding: 'var(--s-4)' }}>
          <GlassSpinner size={20} label="Loading policies" />
        </div>
      ) : policies.length === 0 ? (
        <div className="admin-empty">No policies configured.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          {policies.map((p) => (
            <div key={p.id} className="admin-card" data-testid="security-policy-card">
              <div className="admin-card-title">{p.name}</div>
              <div className="admin-card-meta">
                <Pill tone={p.enabled ? 'free' : 'default'}>
                  {p.enabled ? 'enabled' : 'disabled'}
                </Pill>
                {' '}· {p.action}
                {' '}· id: {p.id}
              </div>
              <div className="admin-card-secondary">
                <strong>condition:</strong> {p.condition}
              </div>
              {p.reason ? (
                <div className="admin-card-secondary">
                  <strong>reason:</strong> {p.reason}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Check panel */}
      <h3 className="admin-section-title">Check action against policies</h3>
      <form
        className="security-check-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCheck();
        }}
      >
        <div className="security-check-form-field">
          <label htmlFor="sec-policy-check">Action string</label>
          <Input
            id="sec-policy-check"
            type="text"
            mono
            value={checkInput}
            onChange={(e) => setCheckInput(e.target.value)}
            placeholder="e.g. exfiltrate_data / delete_file /root"
            disabled={checkBusy}
            data-testid="security-policy-check"
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={checkBusy || !checkInput.trim()}>
          {checkBusy ? 'Checking…' : 'Check'}
        </Button>
      </form>
      {checkResult ? (
        <div className="security-check-result">
          <div>
            <Pill tone={checkResult.allowed ? 'free' : 'new'}>
              {checkResult.allowed ? 'allowed' : 'denied'}
            </Pill>
            {' '}· action: {checkResult.action}
          </div>
          {checkResult.triggered_policies.length > 0 ? (
            <div>triggered: {checkResult.triggered_policies.join(', ')}</div>
          ) : null}
          {checkResult.reason ? <div>reason: {checkResult.reason}</div> : null}
        </div>
      ) : null}

      {/* Verify plan panel */}
      <h3 className="admin-section-title">Verify plan</h3>
      <form
        className="admin-dialog-field"
        data-testid="security-verify-plan"
        onSubmit={(e) => {
          e.preventDefault();
          void handleVerify();
        }}
      >
        <label htmlFor="sec-verify-plan">Plan JSON</label>
        <textarea
          id="sec-verify-plan"
          value={planText}
          onChange={(e) => setPlanText(e.target.value)}
          rows={6}
          placeholder='{"steps": [{"action": "read_file", "path": "/etc/passwd"}]}'
          disabled={verifyBusy}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--s-2)' }}>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={verifyBusy || planText.trim().length === 0}
          >
            {verifyBusy ? 'Verifying…' : 'Verify'}
          </Button>
        </div>
      </form>
      {violations !== null ? (
        violations.length === 0 ? (
          <div className="security-check-result">
            <Pill tone="free">plan is policy-clean</Pill>
          </div>
        ) : (
          <div className="security-check-result">
            <div>
              <Pill tone="new">{violations.length} violation{violations.length === 1 ? '' : 's'}</Pill>
            </div>
            <ul style={{ margin: 'var(--s-1) 0 0 var(--s-4)', padding: 0, color: 'var(--status-error)' }}>
              {violations.map((v, idx) => (
                <li key={idx}>{v}</li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {/* Add policy dialog */}
      <Dialog
        open={addOpen}
        onClose={() => {
          if (!addBusy) setAddOpen(false);
        }}
        ariaLabel="Add symbolic policy"
      >
        <form
          className="admin-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd();
          }}
        >
          <h3 className="admin-dialog-heading">Add policy</h3>
          <div className="admin-dialog-field">
            <label htmlFor="add-policy-id">ID (slug)</label>
            <Input
              id="add-policy-id"
              type="text"
              mono
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              placeholder="no_secret_files"
              disabled={addBusy}
            />
          </div>
          <div className="admin-dialog-field">
            <label htmlFor="add-policy-name">Name</label>
            <Input
              id="add-policy-name"
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="No access to secret files"
              disabled={addBusy}
            />
          </div>
          <div className="admin-dialog-field">
            <label htmlFor="add-policy-cond">Condition</label>
            <textarea
              id="add-policy-cond"
              value={addCondition}
              onChange={(e) => setAddCondition(e.target.value)}
              rows={3}
              placeholder='action contains ".env"'
              disabled={addBusy}
            />
          </div>
          <div className="admin-dialog-field">
            <label htmlFor="add-policy-action">Action</label>
            <Input
              id="add-policy-action"
              type="text"
              mono
              value={addAction}
              onChange={(e) => setAddAction(e.target.value)}
              placeholder="deny / allow / escalate"
              disabled={addBusy}
            />
          </div>
          <div className="admin-dialog-field">
            <label htmlFor="add-policy-reason">Reason (optional)</label>
            <Input
              id="add-policy-reason"
              type="text"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              disabled={addBusy}
            />
          </div>
          <div className="admin-dialog-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAddOpen(false)}
              disabled={addBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={
                addBusy ||
                !addId.trim() ||
                !addName.trim() ||
                !addCondition.trim() ||
                !addAction.trim()
              }
            >
              {addBusy ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
