// src/features/agents/AgentFactory.tsx — Phase 5 Plan 05-04
//
// AGENT-03: "describe it, deploy it" managed factory agent surface.
// Left column — natural-language "Create new" form → factoryCreateAgent(desc).
//   NOTE on the create flow: the Rust signature is
//     factory_create_agent(description: String) -> AgentBlueprint
//   (agent_factory.rs:539). It SYNTHESISES the blueprint from a single
//   description; the plan's "name + role + description" three-field form
//   doesn't map to the wire. This implementation honours the actual wrapper
//   shape (Rule 1 — auto-fix plan/wire mismatch) and exposes the planner's
//   8-role dropdown as an optional hint appended to the description so the
//   synthesis has structured input.
// Right column — existing blueprints as factory-agent-card grid with
//   Deploy / Pause / Delete actions (Dialog confirm on Delete, T-05-04-02).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-120, §D-131
// @see .planning/REQUIREMENTS.md §AGENT-03
// @see src-tauri/src/agent_factory.rs:539,545,551,557,563

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  GlassPanel,
  GlassSpinner,
  Pill,
} from '@/design-system/primitives';
import {
  factoryCreateAgent,
  factoryDeleteAgent,
  factoryDeployAgent,
  factoryListAgents,
  factoryPauseAgent,
} from '@/lib/tauri/agents';
import type { AgentBlueprint } from './types';
import { useToast } from '@/lib/context';
import './agents.css';
import './agents-dag-pack.css';

/** Canonical role set — src-tauri/src/agents/mod.rs AgentRole. */
const AGENT_ROLES = [
  'Researcher',
  'Coder',
  'Analyst',
  'Writer',
  'Reviewer',
  'SecurityRedTeam',
  'SecurityBlueTeam',
  'SecurityTestResearcher',
] as const;

export function AgentFactory() {
  const toast = useToast();
  const [blueprints, setBlueprints] = useState<AgentBlueprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [role, setRole] = useState<(typeof AGENT_ROLES)[number]>('Researcher');
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AgentBlueprint | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await factoryListAgents();
      setBlueprints(list);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = useCallback(async () => {
    const trimmed = description.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      // Appending the role as a structured hint — synthesis reads it verbatim.
      const fullDesc = `[role=${role}] ${trimmed}`;
      const blueprint = await factoryCreateAgent(fullDesc);
      setBlueprints((prev) => [blueprint, ...prev]);
      setDescription('');
      toast.show({ type: 'success', title: 'Agent blueprint created', message: blueprint.name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.show({ type: 'error', title: 'Create failed', message: msg });
    } finally {
      setCreating(false);
    }
  }, [description, role, toast]);

  const onDeploy = useCallback(
    async (bp: AgentBlueprint) => {
      try {
        const id = await factoryDeployAgent(bp);
        toast.show({ type: 'success', title: 'Deployed', message: id });
        void refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.show({ type: 'error', title: 'Deploy failed', message: msg });
      }
    },
    [toast, refresh],
  );

  const onPause = useCallback(
    async (bp: AgentBlueprint) => {
      try {
        await factoryPauseAgent(bp.id);
        toast.show({ type: 'info', title: 'Paused', message: bp.name });
        void refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.show({ type: 'error', title: 'Pause failed', message: msg });
      }
    },
    [toast, refresh],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await factoryDeleteAgent(deleteTarget.id);
      toast.show({ type: 'success', title: 'Deleted', message: deleteTarget.name });
      setBlueprints((prev) => prev.filter((b) => b.id !== deleteTarget.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.show({ type: 'error', title: 'Delete failed', message: msg });
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, toast]);

  return (
    <GlassPanel tier={1} className="agents-surface" data-testid="agent-factory-root">
      <div className="factory-layout">
        <section className="factory-create" aria-label="Create new agent blueprint">
          <h2 className="factory-heading">Agent Factory</h2>
          <p className="factory-sub">Describe the agent you want to deploy.</p>

          <label className="factory-field">
            <span className="factory-label">Role</span>
            <select
              className="factory-select"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof AGENT_ROLES)[number])}
              disabled={creating}
            >
              {AGENT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="factory-field">
            <span className="factory-label">Description</span>
            <textarea
              className="factory-textarea"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Monitor my Slack for urgent threads and draft replies…"
              disabled={creating}
            />
          </label>

          <Button variant="primary" onClick={onCreate} disabled={creating || !description.trim()}>
            {creating ? 'Creating…' : 'Create blueprint'}
          </Button>
        </section>

        <section className="factory-list" aria-label="Deployed agents">
          <div className="factory-list-head">
            <h3 className="factory-heading factory-heading-sm">Blueprints</h3>
            <span className="factory-count">{blueprints.length}</span>
          </div>
          {loading ? (
            <div className="factory-empty">
              <GlassSpinner label="Loading blueprints" />
            </div>
          ) : err ? (
            <div className="factory-empty factory-error" role="alert">
              {err}
            </div>
          ) : blueprints.length === 0 ? (
            <div className="factory-empty">No blueprints yet. Describe one on the left.</div>
          ) : (
            <div className="factory-grid">
              {blueprints.map((bp) => (
                <FactoryCard
                  key={bp.id}
                  blueprint={bp}
                  onDeploy={() => onDeploy(bp)}
                  onPause={() => onPause(bp)}
                  onDelete={() => setDeleteTarget(bp)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        ariaLabel="Delete agent blueprint"
      >
        <div className="factory-dialog">
          <h3>Delete blueprint?</h3>
          <p>
            Permanently delete <strong>{deleteTarget?.name}</strong>? This can&rsquo;t be undone.
          </p>
          <div className="factory-dialog-actions">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </GlassPanel>
  );
}

interface FactoryCardProps {
  blueprint: AgentBlueprint;
  onDeploy: () => void;
  onPause: () => void;
  onDelete: () => void;
}

function FactoryCard({ blueprint, onDeploy, onPause, onDelete }: FactoryCardProps) {
  return (
    <div className="factory-agent-card" data-testid="factory-agent-card" data-agent-id={blueprint.id}>
      <div className="factory-agent-card-head">
        <span className="factory-agent-name">{blueprint.name}</span>
        <Pill tone="default">{blueprint.tentacle_type}</Pill>
      </div>
      <p className="factory-agent-desc" title={blueprint.description}>
        {blueprint.description}
      </p>
      <div className="factory-agent-meta">
        <span>{(blueprint.triggers ?? []).length} triggers</span>
        <span>·</span>
        <span>{(blueprint.actions ?? []).length} actions</span>
      </div>
      <div className="factory-agent-actions">
        <Button variant="primary" size="sm" onClick={onDeploy}>
          Deploy
        </Button>
        <Button variant="secondary" size="sm" onClick={onPause}>
          Pause
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}
