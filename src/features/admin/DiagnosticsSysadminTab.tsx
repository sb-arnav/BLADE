// src/features/admin/DiagnosticsSysadminTab.tsx
//
// Danger-zone sub-component of Diagnostics (D-184 + Pattern §4). Ships all 8
// sysadmin::* commands behind Dialog confirmations with ALL-CAPS warning
// banner. Every dangerous action flows through a Dialog gate; the user click
// IS authorization (T-07-06-01 mitigation).
//
// Commands surfaced:
//   sysadmin_detect_hardware     — Detect hardware (safe, one-button read)
//   sysadmin_list_checkpoints    — list (safe read)
//   sysadmin_save_checkpoint     — Dialog (name input) → save
//   sysadmin_load_checkpoint     — per-row Dialog-confirm
//   sysadmin_rollback            — per-row Dialog-confirm (DANGER)
//   sysadmin_dry_run_edit        — Dialog (path, old, new) → preview
//   sysadmin_dry_run_command     — Dialog (command) → preview
//   sysadmin_sudo_exec           — Dialog + required rationale (DANGER)
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-184
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §4

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassSpinner, Input } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  sysadminDetectHardware,
  sysadminDryRunCommand,
  sysadminDryRunEdit,
  sysadminListCheckpoints,
  sysadminLoadCheckpoint,
  sysadminRollback,
  sysadminSaveCheckpoint,
  sysadminSudoExec,
} from '@/lib/tauri/admin';
import type { HardwareInfo, SysadminCheckpoint, SysadminDryRun } from './types';

export function DiagnosticsSysadminTab() {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}
      data-testid="diagnostics-sysadmin-root"
    >
      <div className="danger-banner" data-testid="danger-banner">
        Sysadmin actions can modify or destroy system state. Use checkpoints before any risky
        operation.
      </div>
      <HardwareSection />
      <CheckpointsSection />
      <DryRunSection />
      <SudoExecSection />
    </div>
  );
}

// ─── Hardware ────────────────────────────────────────────────────────────────

function HardwareSection() {
  const [info, setInfo] = useState<HardwareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detect = useCallback(async () => {
    setBusy(true);
    try {
      const hw = await sysadminDetectHardware();
      setInfo(hw);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="diagnostics-section">
      <h4 className="diagnostics-section-title">Hardware</h4>
      <div className="admin-inline-row">
        <Button variant="secondary" onClick={detect} disabled={busy}>
          {busy ? 'Detecting…' : 'Detect hardware'}
        </Button>
      </div>
      {error && <p className="admin-empty">Error: {error}</p>}
      {info && (
        <pre className="diagnostics-config-pre">{JSON.stringify(info, null, 2)}</pre>
      )}
    </section>
  );
}

// ─── Checkpoints ────────────────────────────────────────────────────────────

function CheckpointsSection() {
  const [list, setList] = useState<SysadminCheckpoint[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<SysadminCheckpoint | null>(null);
  const [loadTarget, setLoadTarget] = useState<SysadminCheckpoint | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const entries = await sysadminListCheckpoints();
      setList(entries);
      setLoadError(null);
    } catch (e) {
      setLoadError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmLoad = useCallback(async () => {
    if (!loadTarget) return;
    setBusy(true);
    try {
      await sysadminLoadCheckpoint(loadTarget.id);
      toast.show({ type: 'success', title: 'Checkpoint loaded', message: loadTarget.title });
      setLoadTarget(null);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Load failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [loadTarget, toast]);

  const confirmSave = useCallback(async () => {
    if (!saveTitle.trim()) {
      toast.show({ type: 'warn', title: 'Title required' });
      return;
    }
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const id = `ckpt-${now}`;
      await sysadminSaveCheckpoint({
        id,
        title: saveTitle.trim(),
        steps: [],
        current_step: 0,
        created_at: now,
        updated_at: now,
        status: 'pending',
        rollback_info: [],
      });
      toast.show({ type: 'success', title: 'Checkpoint saved', message: saveTitle.trim() });
      setSaveOpen(false);
      setSaveTitle('');
      await refresh();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Save failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [saveTitle, refresh, toast]);

  const confirmRollback = useCallback(async () => {
    if (!rollbackTarget) return;
    setBusy(true);
    try {
      const count = await sysadminRollback(rollbackTarget.id);
      toast.show({
        type: 'success',
        title: 'Rolled back',
        message: `${count} actions reverted`,
      });
      setRollbackTarget(null);
      await refresh();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Rollback failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [rollbackTarget, refresh, toast]);

  return (
    <section className="diagnostics-section">
      <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
        <h4 className="diagnostics-section-title">Checkpoints</h4>
        <div className="admin-inline-row">
          <Button variant="secondary" size="sm" onClick={() => setSaveOpen(true)}>
            Save checkpoint
          </Button>
          <Button variant="ghost" size="sm" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>
      {loadError && <p className="admin-empty">Error: {loadError}</p>}
      {list && list.length === 0 && <p className="admin-empty">No checkpoints saved yet.</p>}
      <div className="admin-row-list">
        {(list ?? []).map((c) => (
          <div
            key={c.id}
            className="temporal-exmem-row"
            data-testid="sysadmin-checkpoint-row"
          >
            <div className="temporal-exmem-row-cmd">{c.title}</div>
            <div className="temporal-exmem-row-meta">
              id {c.id} • step {c.current_step} • status {c.status}
            </div>
            <div className="admin-inline-row" style={{ marginTop: 'var(--s-1)' }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setLoadTarget(c)}
                disabled={busy}
              >
                Load
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRollbackTarget(c)}
                disabled={busy}
                data-testid="sysadmin-rollback-button"
              >
                Rollback
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={saveOpen} onClose={() => setSaveOpen(false)} ariaLabel="Save checkpoint">
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Save checkpoint</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--s-2)' }}>
          Save a titled checkpoint so you can roll back later. Steps start empty; use
          rollback to reverse actions recorded against this id.
        </p>
        <div className="admin-dialog-body">
          <label className="admin-dialog-label">
            Title
            <Input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              aria-label="Checkpoint title"
            />
          </label>
        </div>
        <div className="admin-dialog-actions">
          <Button variant="ghost" onClick={() => setSaveOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmSave} disabled={busy || !saveTitle.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Dialog>

      <Dialog open={!!loadTarget} onClose={() => setLoadTarget(null)} ariaLabel="Load checkpoint">
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Load checkpoint</h3>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--s-2)' }}>
          Load <strong>{loadTarget?.title}</strong>? This replaces the in-memory task state with
          the stored checkpoint.
        </p>
        <div className="admin-dialog-actions">
          <Button variant="ghost" onClick={() => setLoadTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmLoad} disabled={busy}>
            {busy ? 'Loading…' : 'Load'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!rollbackTarget}
        onClose={() => setRollbackTarget(null)}
        ariaLabel="Rollback checkpoint"
      >
        <div className="danger-banner">
          Rollback will reverse every action recorded against this checkpoint. This cannot be
          undone.
        </div>
        <p style={{ color: 'var(--t-2)', fontSize: 13, marginTop: 'var(--s-2)' }}>
          Rollback <strong>{rollbackTarget?.title}</strong>?
        </p>
        <div className="admin-dialog-actions">
          <Button variant="ghost" onClick={() => setRollbackTarget(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmRollback} disabled={busy}>
            {busy ? 'Rolling back…' : 'Rollback'}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

// ─── Dry run panels ─────────────────────────────────────────────────────────

function DryRunSection() {
  const [editPath, setEditPath] = useState('');
  const [editOld, setEditOld] = useState('');
  const [editNew, setEditNew] = useState('');
  const [editResult, setEditResult] = useState<SysadminDryRun | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  const [cmd, setCmd] = useState('');
  const [cmdResult, setCmdResult] = useState<SysadminDryRun | null>(null);
  const [cmdBusy, setCmdBusy] = useState(false);

  const toast = useToast();

  const runEdit = useCallback(async () => {
    if (!editPath.trim()) {
      toast.show({ type: 'warn', title: 'Path required' });
      return;
    }
    setEditBusy(true);
    try {
      const out = await sysadminDryRunEdit({
        path: editPath,
        oldContent: editOld,
        newContent: editNew,
      });
      setEditResult(out);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Dry run edit failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setEditBusy(false);
    }
  }, [editPath, editOld, editNew, toast]);

  const runCmd = useCallback(async () => {
    if (!cmd.trim()) {
      toast.show({ type: 'warn', title: 'Command required' });
      return;
    }
    setCmdBusy(true);
    try {
      const out = await sysadminDryRunCommand(cmd);
      setCmdResult(out);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Dry run command failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setCmdBusy(false);
    }
  }, [cmd, toast]);

  return (
    <section className="diagnostics-section">
      <h4 className="diagnostics-section-title">Dry run</h4>
      <p className="diagnostics-sysadmin-warning">
        Dry runs preview changes without applying them. Safe to explore.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          <strong style={{ color: 'var(--t-1)', fontSize: 13 }}>Edit file</strong>
          <Input
            placeholder="/path/to/file"
            value={editPath}
            onChange={(e) => setEditPath(e.target.value)}
            aria-label="Edit path"
          />
          <label className="admin-dialog-label">
            Old content
            <textarea
              className="admin-dialog-textarea"
              value={editOld}
              onChange={(e) => setEditOld(e.target.value)}
              aria-label="Old content"
            />
          </label>
          <label className="admin-dialog-label">
            New content
            <textarea
              className="admin-dialog-textarea"
              value={editNew}
              onChange={(e) => setEditNew(e.target.value)}
              aria-label="New content"
            />
          </label>
          <Button variant="secondary" onClick={runEdit} disabled={editBusy}>
            {editBusy ? 'Running…' : 'Dry run edit'}
          </Button>
          {editResult && (
            <pre className="diagnostics-config-pre">{JSON.stringify(editResult, null, 2)}</pre>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          <strong style={{ color: 'var(--t-1)', fontSize: 13 }}>Shell command</strong>
          <Input
            placeholder="ls -la"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            aria-label="Dry run command"
          />
          <Button variant="secondary" onClick={runCmd} disabled={cmdBusy}>
            {cmdBusy ? 'Running…' : 'Dry run command'}
          </Button>
          {cmdResult && (
            <pre className="diagnostics-config-pre">{JSON.stringify(cmdResult, null, 2)}</pre>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Sudo exec (DANGER) ─────────────────────────────────────────────────────

function SudoExecSection() {
  const [open, setOpen] = useState(false);
  const [cmd, setCmd] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<[string, string, number] | null>(null);
  const toast = useToast();

  const exec = useCallback(async () => {
    if (!cmd.trim() || !rationale.trim()) {
      toast.show({ type: 'warn', title: 'Command and rationale required' });
      return;
    }
    setBusy(true);
    try {
      const out = await sysadminSudoExec({ command: cmd, reason: rationale });
      setResult(out);
      toast.show({
        type: 'success',
        title: 'Sudo exec complete',
        message: `exit ${out[2]}`,
      });
      setOpen(false);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Sudo exec failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [cmd, rationale, toast]);

  return (
    <section className="diagnostics-section">
      <h4 className="diagnostics-section-title">Sudo exec</h4>
      <div className="danger-banner">
        Sudo exec runs elevated commands on your system. Clicking confirm is authorization.
      </div>
      <div className="admin-inline-row">
        <Button
          variant="secondary"
          onClick={() => setOpen(true)}
          data-testid="sysadmin-sudo-button"
        >
          Open sudo exec
        </Button>
      </div>
      {result && (
        <pre className="diagnostics-config-pre">
          {`exit ${result[2]}\n--- stdout ---\n${result[0]}\n--- stderr ---\n${result[1]}`}
        </pre>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} ariaLabel="Sudo exec">
        <div className="danger-banner">
          Elevated execution can modify or destroy system state. Document your rationale below.
        </div>
        <div className="admin-dialog-body">
          <label className="admin-dialog-label">
            Command
            <Input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              aria-label="Sudo command"
              placeholder="e.g. systemctl restart blade"
            />
          </label>
          <label className="admin-dialog-label">
            Rationale (required)
            <textarea
              className="admin-dialog-textarea"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              aria-label="Sudo rationale"
              rows={4}
            />
          </label>
        </div>
        <div className="admin-dialog-actions">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={exec}
            disabled={busy || !cmd.trim() || !rationale.trim()}
          >
            {busy ? (
              <>
                <GlassSpinner /> Executing…
              </>
            ) : (
              'Confirm sudo exec'
            )}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
