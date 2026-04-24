// src/features/admin/ModelComparison.tsx
//
// Admin cluster — ModelComparison route (ADMIN-10, D-185). Renders
// get_task_routing() as rows for the 5 known routing slots (code / vision /
// fast / creative / fallback per Rust TaskRouting) + Change Dialog,
// Test button per row, and Switch provider globally Dialog.
//
// testProvider in Rust takes (provider, api_key, model, base_url?). We surface
// the minimal Test call with empty api_key so Rust falls back to the stored
// key for that provider (correct behaviour per current Rust signature —
// see admin.ts:635).
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-185

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, Input, Pill, EmptyState } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  getTaskRouting,
  saveConfigField,
  setTaskRouting,
  switchProvider,
  testProvider,
} from '@/lib/tauri/admin';
import type { TaskRouting } from './types';
import './admin.css';
import './admin-rich-b.css';

type TaskKey = 'code' | 'vision' | 'fast' | 'creative' | 'fallback';
const TASK_ORDER: TaskKey[] = ['fast', 'code', 'creative', 'vision', 'fallback'];

interface Row {
  task: TaskKey;
  spec: string; // "provider/model"
  provider: string;
  model: string;
}

function parseSpec(spec: string | null | undefined): { provider: string; model: string } {
  const raw = (spec ?? '').trim();
  if (!raw) return { provider: '', model: '' };
  const slash = raw.indexOf('/');
  if (slash < 0) return { provider: raw, model: '' };
  return { provider: raw.slice(0, slash), model: raw.slice(slash + 1) };
}

function rowsFromRouting(r: TaskRouting | null): Row[] {
  const rec = (r ?? {}) as Record<string, string | null | undefined>;
  return TASK_ORDER.map((task) => {
    const spec = rec[task] ?? '';
    const { provider, model } = parseSpec(spec ?? '');
    return { task, spec: spec ?? '', provider, model };
  });
}

export function ModelComparison() {
  const [routing, setRouting] = useState<TaskRouting | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changeTarget, setChangeTarget] = useState<Row | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [latency, setLatency] = useState<Record<TaskKey, string>>({} as Record<TaskKey, string>);
  const [testing, setTesting] = useState<TaskKey | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const r = await getTaskRouting();
      setRouting(r);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleTest = useCallback(
    async (row: Row) => {
      if (!row.provider || !row.model) {
        toast.show({ type: 'warn', title: 'No model set for this task' });
        return;
      }
      setTesting(row.task);
      const t0 = performance.now();
      try {
        const result = await testProvider({
          provider: row.provider,
          apiKey: '', // Rust falls back to stored key for that provider.
          model: row.model,
        });
        const ms = Math.round(performance.now() - t0);
        setLatency((prev) => ({ ...prev, [row.task]: `${ms}ms • ${String(result).slice(0, 40)}` }));
      } catch (e) {
        setLatency((prev) => ({
          ...prev,
          [row.task]: `err • ${typeof e === 'string' ? e : String(e)}`.slice(0, 80),
        }));
      } finally {
        setTesting(null);
      }
    },
    [toast],
  );

  const rows = rowsFromRouting(routing);

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="model-comparison-root">
      <div className="model-comparison-layout">
        <section className="diagnostics-hero">
          <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
            <h3>Task routing</h3>
            <div className="admin-inline-row">
              <Button variant="primary" size="sm" onClick={() => setSwitchOpen(true)}>
                Switch provider globally
              </Button>
              <Button variant="ghost" size="sm" onClick={refresh}>
                Refresh
              </Button>
            </div>
          </div>
          {error && <p className="admin-empty">Error: {error}</p>}
        </section>

        <section className="diagnostics-section">
          {Object.keys(latency).length === 0 && (
            <EmptyState
              label="BLADE is still learning your routing preferences"
              description="Latency scores will appear once you test each slot — give me a minute after clicking Test."
            />
          )}
          <div className="model-comparison-table">
            {rows.map((row) => (
              <div
                key={row.task}
                className="model-comparison-row"
                data-testid="task-routing-row"
                data-task={row.task}
              >
                <span className="model-comparison-row-task">{row.task}</span>
                <span className="model-comparison-row-model">
                  {row.spec || <span className="admin-empty">— not set —</span>}
                </span>
                <Pill tone="default" data-testid="task-latency-chip">
                  {latency[row.task] ?? '—'}
                </Pill>
                <Pill>{row.provider || '?'}</Pill>
                <div className="model-comparison-row-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleTest(row)}
                    disabled={testing === row.task}
                    data-testid="task-test-button"
                  >
                    {testing === row.task ? 'Testing…' : 'Test'}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setChangeTarget(row)}
                    data-testid="task-change-button"
                  >
                    Change
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <ChangeRoutingDialog
        row={changeTarget}
        routing={routing}
        onClose={() => setChangeTarget(null)}
        onDone={refresh}
      />
      <SwitchProviderDialog
        open={switchOpen}
        onClose={() => setSwitchOpen(false)}
        onDone={refresh}
      />
    </GlassPanel>
  );
}

function ChangeRoutingDialog(props: {
  row: Row | null;
  routing: TaskRouting | null;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (props.row) {
      setProvider(props.row.provider);
      setModel(props.row.model);
    }
  }, [props.row]);

  const confirm = useCallback(async () => {
    if (!props.row) return;
    setBusy(true);
    try {
      // Build the new routing object from the existing routing + the edited row.
      const base = (props.routing ?? {}) as Record<string, string | null | undefined>;
      const next: TaskRouting = { ...base };
      const spec = provider && model ? `${provider}/${model}` : '';
      (next as Record<string, string>)[props.row.task] = spec;
      await setTaskRouting(next);
      // Also save_config_field for persistence guarantee (D-185).
      try {
        await saveConfigField({ key: 'task_routing', value: JSON.stringify(next) });
      } catch {
        /* saveConfigField may not accept this key shape; set_task_routing is the primary write. */
      }
      toast.show({
        type: 'success',
        title: 'Routing updated',
        message: `${props.row.task} → ${spec}`,
      });
      await props.onDone();
      props.onClose();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Update failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [props, provider, model, toast]);

  return (
    <Dialog
      open={!!props.row}
      onClose={props.onClose}
      ariaLabel="Change task routing"
    >
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>
        Change routing for {props.row?.task}
      </h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Provider
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
            placeholder="anthropic, openai, openrouter, ollama"
          />
        </label>
        <label className="admin-dialog-label">
          Model
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
            placeholder="claude-opus-4, gpt-4o, qwen2.5:32b"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
}

function SwitchProviderDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      await switchProvider({ provider, model: model || undefined });
      toast.show({
        type: 'success',
        title: 'Provider switched',
        message: provider,
      });
      await props.onDone();
      props.onClose();
      setProvider('');
      setModel('');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Switch failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [provider, model, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Switch provider globally">
      <div className="danger-banner">
        Switching provider interrupts any in-flight chat stream. Continue only if no chat is
        running.
      </div>
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Switch provider globally</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Provider
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            aria-label="Provider"
          />
        </label>
        <label className="admin-dialog-label">
          Model (optional)
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            aria-label="Model"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy || !provider.trim()}>
          {busy ? 'Switching…' : 'Switch'}
        </Button>
      </div>
    </Dialog>
  );
}
