// src/features/admin/McpSettings.tsx
//
// Admin cluster — McpSettings route (ADMIN-09, D-185). Renders mcp_get_servers
// with per-server actions + tool trust sub-section.
//
// Commands wired (13 total):
//   mcp_get_servers, mcp_get_tools, mcp_server_status, mcp_server_health
//   mcp_add_server (Dialog), mcp_install_catalog_server (Dialog)
//   mcp_discover_tools (per server), mcp_call_tool (debug Dialog)
//   mcp_remove_server (Dialog-confirm danger — T-07-06-02 mitigated)
//   classify_mcp_tool, set_tool_trust, reset_tool_trust, get_tool_overrides
//
// Note: Rust ToolRisk is Auto|Ask|Blocked; the plan's "trusted/ask/blocked"
// vocabulary maps trusted↔Auto, ask↔Ask, blocked↔Blocked at the UI edge.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-185
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §4

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, Input, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import {
  classifyMcpTool,
  getToolOverrides,
  mcpAddServer,
  mcpCallTool,
  mcpDiscoverTools,
  mcpGetServers,
  mcpGetTools,
  mcpInstallCatalogServer,
  mcpRemoveServer,
  mcpServerHealth,
  mcpServerStatus,
  resetToolTrust,
  setToolTrust,
} from '@/lib/tauri/admin';
import type { McpServerHealth, McpServerInfo, ToolOverride, ToolRisk } from './types';
import './admin.css';
import './admin-rich-b.css';

export function McpSettings() {
  const [servers, setServers] = useState<McpServerInfo[] | null>(null);
  const [health, setHealth] = useState<McpServerHealth[] | null>(null);
  const [status, setStatus] = useState<Array<[string, boolean]> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<McpServerInfo | null>(null);
  const [callToolTarget, setCallToolTarget] = useState<McpServerInfo | null>(null);

  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const [s, h, st] = await Promise.all([
        mcpGetServers(),
        mcpServerHealth(),
        mcpServerStatus(),
      ]);
      setServers(s);
      setHealth(h);
      setStatus(st);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const discover = useCallback(
    async (serverName: string) => {
      try {
        await mcpDiscoverTools();
        toast.show({ type: 'success', title: 'Discovered tools', message: serverName });
        await refresh();
      } catch (e) {
        toast.show({
          type: 'error',
          title: 'Discover failed',
          message: typeof e === 'string' ? e : String(e),
        });
      }
    },
    [refresh, toast],
  );

  const confirmRemove = useCallback(async () => {
    if (!removeTarget) return;
    try {
      await mcpRemoveServer(removeTarget.name);
      toast.show({ type: 'success', title: 'Server removed', message: removeTarget.name });
      setRemoveTarget(null);
      await refresh();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Remove failed',
        message: typeof e === 'string' ? e : String(e),
      });
    }
  }, [removeTarget, refresh, toast]);

  const healthByName = new Map<string, McpServerHealth>();
  (health ?? []).forEach((h) => healthByName.set(h.name, h));
  const statusByName = new Map<string, boolean>();
  (status ?? []).forEach(([n, v]) => statusByName.set(n, v));

  return (
    <GlassPanel tier={1} className="admin-surface" data-testid="mcp-settings-root">
      <div className="mcp-layout">
        <section className="diagnostics-hero">
          <div className="admin-inline-row" style={{ justifyContent: 'space-between' }}>
            <h3>MCP servers</h3>
            <div className="admin-inline-row">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setAddOpen(true)}
                data-testid="mcp-add-server-button"
              >
                Add server
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setCatalogOpen(true)}>
                Install from catalog
              </Button>
              <Button variant="ghost" size="sm" onClick={refresh}>
                Refresh
              </Button>
            </div>
          </div>
          {error && <p className="admin-empty">Error: {error}</p>}
        </section>

        <section className="diagnostics-section">
          <div className="admin-row-list">
            {(servers ?? []).map((s) => {
              const h = healthByName.get(s.name);
              const connected = statusByName.get(s.name) ?? h?.connected ?? false;
              return (
                <div
                  key={s.name}
                  className="mcp-server-row"
                  data-testid="mcp-server-row"
                  data-server={s.name}
                >
                  <div className="mcp-server-row-header">
                    <div>
                      <div className="mcp-server-row-name">{s.name}</div>
                      <div className="mcp-server-row-meta">{s.command}</div>
                    </div>
                    <div className="admin-inline-row">
                      <Pill tone={connected ? 'free' : 'default'}>
                        {connected ? 'connected' : 'offline'}
                      </Pill>
                      <Pill>{h?.tool_count ?? '?'} tools</Pill>
                    </div>
                  </div>
                  <div className="mcp-server-row-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void discover(s.name)}
                    >
                      Discover tools
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setCallToolTarget(s)}
                    >
                      Call tool
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setRemoveTarget(s)}
                      data-testid="mcp-remove-button"
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              );
            })}
            {servers && servers.length === 0 && (
              <p className="admin-empty">No MCP servers yet. Click Add server or Install from catalog.</p>
            )}
          </div>
        </section>

        <ToolTrustSection />
      </div>

      <AddServerDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={refresh} />
      <InstallCatalogDialog
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onDone={refresh}
      />
      <CallToolDialog
        target={callToolTarget}
        onClose={() => setCallToolTarget(null)}
      />
      <Dialog
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        ariaLabel="Remove server"
      >
        <div className="danger-banner">
          Remove server stops the MCP process and deletes its saved config. This cannot be
          undone.
        </div>
        <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Remove {removeTarget?.name}?</h3>
        <div className="admin-dialog-actions">
          <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirmRemove}>
            Remove
          </Button>
        </div>
      </Dialog>
    </GlassPanel>
  );
}

// ─── Add / install dialogs ──────────────────────────────────────────────────

function AddServerDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argsCsv, setArgsCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    try {
      const mcpArgs = argsCsv
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      await mcpAddServer({ name, command, mcpArgs });
      toast.show({ type: 'success', title: 'Server added', message: name });
      await props.onDone();
      props.onClose();
      setName('');
      setCommand('');
      setArgsCsv('');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Add failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [name, command, argsCsv, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Add server">
      <div className="danger-banner">
        Adding an MCP server spawns the given command under your user. Only add commands from
        trusted sources.
      </div>
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Add MCP server</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </label>
        <label className="admin-dialog-label">
          Command
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            aria-label="Command"
            placeholder="npx, uvx, /abs/path"
          />
        </label>
        <label className="admin-dialog-label">
          Args (comma-separated)
          <Input
            value={argsCsv}
            onChange={(e) => setArgsCsv(e.target.value)}
            aria-label="Args"
            placeholder="@scope/server-name, --flag, value"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || !name.trim() || !command.trim()}
        >
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </div>
    </Dialog>
  );
}

function InstallCatalogDialog(props: {
  open: boolean;
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [argsCsv, setArgsCsv] = useState('');
  const [envJson, setEnvJson] = useState('{}');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    let env: Record<string, string>;
    try {
      env = JSON.parse(envJson || '{}') as Record<string, string>;
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Env must be valid JSON',
        message: typeof e === 'string' ? e : String(e),
      });
      setBusy(false);
      return;
    }
    try {
      const mcpArgs = argsCsv
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const count = await mcpInstallCatalogServer({ name, command, mcpArgs, env });
      toast.show({
        type: 'success',
        title: 'Catalog install started',
        message: `${count} tool(s) discovered`,
      });
      await props.onDone();
      props.onClose();
      setName('');
      setCommand('');
      setArgsCsv('');
      setEnvJson('{}');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Install failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [name, command, argsCsv, envJson, props, toast]);

  return (
    <Dialog open={props.open} onClose={props.onClose} ariaLabel="Install from catalog">
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>Install from catalog</h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
        </label>
        <label className="admin-dialog-label">
          Command
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            aria-label="Command"
          />
        </label>
        <label className="admin-dialog-label">
          Args (comma-separated)
          <Input
            value={argsCsv}
            onChange={(e) => setArgsCsv(e.target.value)}
            aria-label="Args"
          />
        </label>
        <label className="admin-dialog-label">
          Env (JSON)
          <textarea
            className="admin-dialog-textarea"
            value={envJson}
            onChange={(e) => setEnvJson(e.target.value)}
            aria-label="Env JSON"
          />
        </label>
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={confirm}
          disabled={busy || !name.trim() || !command.trim()}
        >
          {busy ? 'Installing…' : 'Install'}
        </Button>
      </div>
    </Dialog>
  );
}

function CallToolDialog(props: { target: McpServerInfo | null; onClose: () => void }) {
  const [toolName, setToolName] = useState('');
  const [argsJson, setArgsJson] = useState('{}');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const toast = useToast();

  const confirm = useCallback(async () => {
    setBusy(true);
    let args: unknown;
    try {
      args = JSON.parse(argsJson || '{}');
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Args must be valid JSON',
        message: typeof e === 'string' ? e : String(e),
      });
      setBusy(false);
      return;
    }
    try {
      const out = await mcpCallTool({ toolName, arguments: args });
      setResult(JSON.stringify(out, null, 2));
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Call failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  }, [toolName, argsJson, toast]);

  const open = !!props.target;

  return (
    <Dialog open={open} onClose={props.onClose} ariaLabel="Call tool">
      <h3 style={{ margin: 0, color: 'var(--t-1)' }}>
        Call tool on {props.target?.name ?? ''}
      </h3>
      <div className="admin-dialog-body">
        <label className="admin-dialog-label">
          Tool name (qualified)
          <Input
            value={toolName}
            onChange={(e) => setToolName(e.target.value)}
            aria-label="Tool name"
            data-testid="mcp-call-tool-input"
          />
        </label>
        <label className="admin-dialog-label">
          Arguments (JSON)
          <textarea
            className="admin-dialog-textarea"
            value={argsJson}
            onChange={(e) => setArgsJson(e.target.value)}
            aria-label="Tool args"
          />
        </label>
        {result && <pre className="diagnostics-config-pre">{result}</pre>}
      </div>
      <div className="admin-dialog-actions">
        <Button variant="ghost" onClick={props.onClose} disabled={busy}>
          Close
        </Button>
        <Button variant="primary" onClick={confirm} disabled={busy || !toolName.trim()}>
          {busy ? 'Calling…' : 'Call'}
        </Button>
      </div>
    </Dialog>
  );
}

// ─── Tool trust sub-section ─────────────────────────────────────────────────

function ToolTrustSection() {
  const [overrides, setOverrides] = useState<ToolOverride | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Classify form state.
  const [clsName, setClsName] = useState('');
  const [clsDesc, setClsDesc] = useState('');
  const [clsResult, setClsResult] = useState<ToolRisk | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const map = await getToolOverrides();
      setOverrides(map);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const change = useCallback(
    async (toolName: string, risk: ToolRisk) => {
      try {
        await setToolTrust({ toolName, risk });
        toast.show({ type: 'success', title: 'Trust updated', message: toolName });
        await refresh();
      } catch (e) {
        toast.show({
          type: 'error',
          title: 'Update failed',
          message: typeof e === 'string' ? e : String(e),
        });
      }
    },
    [refresh, toast],
  );

  const reset = useCallback(
    async (toolName: string) => {
      try {
        await resetToolTrust(toolName);
        toast.show({ type: 'success', title: 'Reset', message: toolName });
        await refresh();
      } catch (e) {
        toast.show({
          type: 'error',
          title: 'Reset failed',
          message: typeof e === 'string' ? e : String(e),
        });
      }
    },
    [refresh, toast],
  );

  const classify = useCallback(async () => {
    if (!clsName.trim()) return;
    try {
      const r = await classifyMcpTool({ name: clsName, description: clsDesc });
      setClsResult(r);
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Classify failed',
        message: typeof e === 'string' ? e : String(e),
      });
    }
  }, [clsName, clsDesc, toast]);

  // Also hit mcpGetTools so we know the full tool surface to offer a trust row.
  const [allTools, setAllTools] = useState<string[]>([]);
  useEffect(() => {
    mcpGetTools()
      .then((tools) => setAllTools(tools.map((t) => t.qualified_name ?? t.name)))
      .catch(() => setAllTools([]));
  }, [overrides]);

  const overrideRows = overrides ? Object.entries(overrides) : [];
  const knownSet = new Set(overrideRows.map(([n]) => n));
  const toolsWithoutOverride = allTools.filter((n) => !knownSet.has(n)).slice(0, 50);

  return (
    <section className="diagnostics-section">
      <h4 className="diagnostics-section-title">Tool trust</h4>
      {error && <p className="admin-empty">Error: {error}</p>}
      <div className="admin-row-list">
        {overrideRows.map(([name, risk]) => (
          <div key={name} className="mcp-tool-trust-row">
            <span>{name}</span>
            <select
              className="mcp-tool-trust-select"
              value={risk}
              onChange={(e) => void change(name, e.target.value as ToolRisk)}
              data-testid="mcp-tool-trust-select"
              aria-label={`Trust level for ${name}`}
            >
              <option value="Auto">trusted (auto)</option>
              <option value="Ask">ask</option>
              <option value="Blocked">blocked</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => void reset(name)}>
              Reset
            </Button>
          </div>
        ))}
        {toolsWithoutOverride.map((name) => (
          <div key={name} className="mcp-tool-trust-row">
            <span>{name}</span>
            <select
              className="mcp-tool-trust-select"
              defaultValue="Ask"
              onChange={(e) => void change(name, e.target.value as ToolRisk)}
              aria-label={`Default trust level for ${name}`}
            >
              <option value="Auto">trusted (auto)</option>
              <option value="Ask">ask</option>
              <option value="Blocked">blocked</option>
            </select>
            <span style={{ color: 'var(--t-3)', fontSize: 11 }}>default</span>
          </div>
        ))}
        {overrideRows.length === 0 && toolsWithoutOverride.length === 0 && (
          <p className="admin-empty">No MCP tools yet.</p>
        )}
      </div>

      <div className="diagnostics-section" style={{ marginTop: 'var(--s-3)' }}>
        <h4 className="diagnostics-section-title">Classify tool (debug)</h4>
        <div className="admin-inline-row">
          <Input
            placeholder="tool name"
            value={clsName}
            onChange={(e) => setClsName(e.target.value)}
            aria-label="Tool name to classify"
          />
          <Input
            placeholder="description"
            value={clsDesc}
            onChange={(e) => setClsDesc(e.target.value)}
            aria-label="Tool description"
            style={{ flex: 1 }}
          />
          <Button variant="secondary" onClick={classify} disabled={!clsName.trim()}>
            Classify
          </Button>
        </div>
        {clsResult && (
          <p className="admin-empty">
            Classified as <strong>{clsResult}</strong>.
          </p>
        )}
      </div>
    </section>
  );
}
