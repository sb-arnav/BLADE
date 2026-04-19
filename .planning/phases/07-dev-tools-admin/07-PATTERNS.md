# Phase 7 Patterns — Recurring Recipes

**Mapped:** 2026-04-18
**Scope:** Code recipes Phase 7 implementers MUST follow verbatim (or cite a deviation in their commit message).

**IMPORTANT:** Phase 7 is a structural mirror of Phase 5 + Phase 6. Patterns §1, §2, §3, §4, §5, §6, §7, §8, §9, §10 in `.planning/phases/05-agents-knowledge/05-PATTERNS.md` and `.planning/phases/06-life-os-identity/06-PATTERNS.md` apply verbatim — only the cluster names change (agents → dev-tools; knowledge → admin). This file captures ONLY the Phase-7-specific recipes that diverge or extend Phase 5/6.

---

## 1. Typed wrapper per Rust command — cluster-scoped (inherits Phase 5 §1 + Phase 6 §1)

Same recipe as Plan 05-02 / 06-02. Two new wrapper files:

```ts
// src/lib/tauri/dev_tools.ts (Plan 07-02)
import { invokeTyped } from './_base';

// ─── Types (mirror Rust Serialize shape exactly — snake_case returns preserved) ───
export interface ShellResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  [k: string]: unknown;
}

export interface FileTreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  size?: number;
  children?: FileTreeNode[];
  [k: string]: unknown;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps: Array<{ type: string; config: Record<string, unknown> }>;
  last_run_at?: number;
  [k: string]: unknown;
}

export interface BrowserActionResult {
  ok: boolean;
  screenshot_b64?: string;
  description?: string;
  [k: string]: unknown;
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  duration_ms?: number;
  language?: string;
  [k: string]: unknown;
}

// ─── Wrappers (one per command; JSDoc cites Rust file:line) ────────────────
/** @see src-tauri/src/native_tools.rs run_shell */
export function runShell(args: { command: string; cwd?: string }): Promise<ShellResult> {
  return invokeTyped<ShellResult>('run_shell', {
    command: args.command,
    cwd: args.cwd,
  });
}

/** @see src-tauri/src/files.rs file_tree */
export function fileTree(args: { path: string; depth?: number }): Promise<FileTreeNode> {
  return invokeTyped<FileTreeNode>('file_tree', {
    path: args.path,
    depth: args.depth,
  });
}

/** @see src-tauri/src/workflow_builder.rs workflow_list */
export function workflowList(): Promise<Workflow[]> {
  return invokeTyped<Workflow[]>('workflow_list', {});
}

/** @see src-tauri/src/browser_agent.rs browser_agent_loop */
export function browserAgentLoop(args: { goal: string; maxSteps?: number }): Promise<BrowserActionResult> {
  return invokeTyped<BrowserActionResult>('browser_agent_loop', {
    goal: args.goal,
    max_steps: args.maxSteps,
  });
}

/** @see src-tauri/src/code_sandbox.rs sandbox_run */
export function sandboxRun(args: { language: string; code: string }): Promise<SandboxResult> {
  return invokeTyped<SandboxResult>('sandbox_run', {
    language: args.language,
    code: args.code,
  });
}
```

```ts
// src/lib/tauri/admin.ts (Plan 07-02)
import { invokeTyped } from './_base';

export interface DecisionLogEntry {
  id: string;
  decision_type: string;
  confidence: number;
  outcome?: string;
  timestamp: number;
  [k: string]: unknown;
}

export interface SecurityOverview {
  status: 'ok' | 'warn' | 'critical';
  active_alerts: number;
  last_scan_at?: number;
  [k: string]: unknown;
}

export interface SupervisorHealth {
  services: Array<{ name: string; status: 'running' | 'stopped' | 'error'; uptime_seconds?: number }>;
  [k: string]: unknown;
}

export interface IntegrationState {
  services: Array<{ name: string; enabled: boolean; last_poll_at?: number; error?: string }>;
  [k: string]: unknown;
}

export interface McpServerInfo {
  name: string;
  connected: boolean;
  tool_count: number;
  last_error?: string;
  [k: string]: unknown;
}

/** @see src-tauri/src/decision_gate.rs get_decision_log */
export function getDecisionLog(args: { limit?: number }): Promise<DecisionLogEntry[]> {
  return invokeTyped<DecisionLogEntry[]>('get_decision_log', {
    limit: args.limit,
  });
}

/** @see src-tauri/src/security_monitor.rs security_overview */
export function securityOverview(): Promise<SecurityOverview> {
  return invokeTyped<SecurityOverview>('security_overview', {});
}

/** @see src-tauri/src/supervisor.rs supervisor_get_health */
export function supervisorGetHealth(): Promise<SupervisorHealth> {
  return invokeTyped<SupervisorHealth>('supervisor_get_health', {});
}
```

**Rules (same as Phase 5 §1 + Phase 6 §1):**
- One wrapper per `#[tauri::command]`. No multiplexing.
- Arg keys in invoke call MUST be snake_case. Wrapper signature MAY expose camelCase.
- Return types are hand-written interfaces in the SAME file.
- ESLint `no-raw-tauri` enforced.
- **File size budget:** dev_tools.ts ≈ 700-900 lines (~90 wrappers × 8-10 lines). admin.ts ≈ 900-1100 lines (~110 wrappers × 8-10 lines).

---

## 2. Cluster index rewrite (Plan 07-02 — ONE-WRITE rule, inherits Phase 5 §5 + Phase 6 §2)

```tsx
// src/features/dev-tools/index.tsx (Plan 07-02 rewrites — final form)
// Phase 7: replaces Phase 1 skeletons with lazy imports of real route components.
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-170

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const Terminal          = lazy(() => import('./Terminal').then((m) => ({ default: m.Terminal })));
const FileBrowser       = lazy(() => import('./FileBrowser').then((m) => ({ default: m.FileBrowser })));
const GitPanel          = lazy(() => import('./GitPanel').then((m) => ({ default: m.GitPanel })));
const Canvas            = lazy(() => import('./Canvas').then((m) => ({ default: m.Canvas })));
const WorkflowBuilder   = lazy(() => import('./WorkflowBuilder').then((m) => ({ default: m.WorkflowBuilder })));
const WebAutomation     = lazy(() => import('./WebAutomation').then((m) => ({ default: m.WebAutomation })));
const EmailAssistant    = lazy(() => import('./EmailAssistant').then((m) => ({ default: m.EmailAssistant })));
const DocumentGenerator = lazy(() => import('./DocumentGenerator').then((m) => ({ default: m.DocumentGenerator })));
const CodeSandbox       = lazy(() => import('./CodeSandbox').then((m) => ({ default: m.CodeSandbox })));
const ComputerUse       = lazy(() => import('./ComputerUse').then((m) => ({ default: m.ComputerUse })));

export const routes: RouteDefinition[] = [
  { id: 'terminal',           label: 'Terminal',        section: 'dev', component: Terminal,          phase: 7 },
  { id: 'file-browser',       label: 'File Browser',    section: 'dev', component: FileBrowser,       phase: 7 },
  { id: 'git-panel',          label: 'Git',             section: 'dev', component: GitPanel,          phase: 7 },
  { id: 'canvas',             label: 'Canvas',          section: 'dev', component: Canvas,            phase: 7 },
  { id: 'workflow-builder',   label: 'Workflows',       section: 'dev', component: WorkflowBuilder,   phase: 7 },
  { id: 'web-automation',     label: 'Web Automation',  section: 'dev', component: WebAutomation,     phase: 7 },
  { id: 'email-assistant',    label: 'Email Assistant', section: 'dev', component: EmailAssistant,    phase: 7 },
  { id: 'document-generator', label: 'Documents',       section: 'dev', component: DocumentGenerator, phase: 7 },
  { id: 'code-sandbox',       label: 'Sandbox',         section: 'dev', component: CodeSandbox,       phase: 7 },
  { id: 'computer-use',       label: 'Computer Use',    section: 'dev', component: ComputerUse,       phase: 7 },
];
```

```tsx
// src/features/admin/index.tsx (Plan 07-02 rewrites — final form)
import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const Analytics         = lazy(() => import('./Analytics').then((m) => ({ default: m.Analytics })));
const CapabilityReports = lazy(() => import('./CapabilityReports').then((m) => ({ default: m.CapabilityReports })));
const Reports           = lazy(() => import('./Reports').then((m) => ({ default: m.Reports })));
const DecisionLog       = lazy(() => import('./DecisionLog').then((m) => ({ default: m.DecisionLog })));
const SecurityDashboard = lazy(() => import('./SecurityDashboard').then((m) => ({ default: m.SecurityDashboard })));
const Temporal          = lazy(() => import('./Temporal').then((m) => ({ default: m.Temporal })));
const Diagnostics       = lazy(() => import('./Diagnostics').then((m) => ({ default: m.Diagnostics })));
const IntegrationStatus = lazy(() => import('./IntegrationStatus').then((m) => ({ default: m.IntegrationStatus })));
const McpSettings       = lazy(() => import('./McpSettings').then((m) => ({ default: m.McpSettings })));
const ModelComparison   = lazy(() => import('./ModelComparison').then((m) => ({ default: m.ModelComparison })));
const KeyVault          = lazy(() => import('./KeyVault').then((m) => ({ default: m.KeyVault })));

export const routes: RouteDefinition[] = [
  { id: 'analytics',          label: 'Analytics',          section: 'admin', component: Analytics,         phase: 7 },
  { id: 'capability-reports', label: 'Capability Reports', section: 'admin', component: CapabilityReports, phase: 7 },
  { id: 'reports',            label: 'Reports',            section: 'admin', component: Reports,           phase: 7, description: 'Backend openRoute target for capability_gap_detected' },
  { id: 'decision-log',       label: 'Decision Log',       section: 'admin', component: DecisionLog,       phase: 7 },
  { id: 'security-dashboard', label: 'Security',           section: 'admin', component: SecurityDashboard, phase: 7 },
  { id: 'temporal',           label: 'Temporal',           section: 'admin', component: Temporal,          phase: 7 },
  { id: 'diagnostics',        label: 'Diagnostics',        section: 'admin', component: Diagnostics,       phase: 7 },
  { id: 'integration-status', label: 'Integration Status', section: 'admin', component: IntegrationStatus, phase: 7 },
  { id: 'mcp-settings',       label: 'MCP Servers',        section: 'admin', component: McpSettings,       phase: 7 },
  { id: 'model-comparison',   label: 'Model Comparison',   section: 'admin', component: ModelComparison,   phase: 7 },
  { id: 'key-vault',          label: 'Key Vault',          section: 'admin', component: KeyVault,          phase: 7 },
];
```

**Rules:**
- Plan 07-02 is the SINGLE writer of these two index.tsx files.
- Plans 07-03..06 each CREATE a disjoint subset of per-route files; file ownership is exclusive.
- Route id + label order preserved from Phase 1 substrate so NavRail ordering doesn't shift.
- The `reports` route retains its Phase 1 description (Backend openRoute target for capability_gap_detected) since that's the reason it exists.

---

## 3. Terminal scrollback recipe (Plan 07-03 Terminal surface)

Line-oriented terminal using `native_tools::run_shell`. NO PTY (Phase 9 polish).

```tsx
// src/features/dev-tools/Terminal.tsx (Plan 07-03) — pattern reference
import { useState, useRef, useEffect } from 'react';
import { GlassPanel, Button } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { runShell } from '@/lib/tauri/dev_tools';
import { useToast } from '@/lib/context/ToastContext';
import './dev-tools.css';

interface Line {
  type: 'cmd' | 'stdout' | 'stderr';
  text: string;
}

export function Terminal() {
  const { prefs, setPref } = usePrefs();
  const cwd = prefs['devTools.terminal.cwd'] ?? '~';
  const [lines, setLines] = useState<Line[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLPreElement | null>(null);
  const toast = useToast();

  // Autoscroll on new output
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines]);

  const submit = async () => {
    if (!input.trim()) return;
    const cmd = input;
    setInput('');
    setBusy(true);
    setLines((prev) => [...prev, { type: 'cmd', text: `$ ${cmd}` }]);
    try {
      const result = await runShell({ command: cmd, cwd });
      setLines((prev) => [
        ...prev,
        ...(result.stdout ? [{ type: 'stdout' as const, text: result.stdout }] : []),
        ...(result.stderr ? [{ type: 'stderr' as const, text: result.stderr }] : []),
      ]);
    } catch (e) {
      toast.push({ type: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <GlassPanel tier={1} className="dev-surface" data-testid="terminal-root">
      <div className="terminal-topbar">
        <span className="terminal-cwd">cwd: {cwd}</span>
        <Button variant="ghost" onClick={() => setLines([])}>Clear</Button>
      </div>
      <pre ref={scrollRef} className="terminal-scrollback" data-testid="terminal-scrollback">
        {lines.map((l, i) => (
          <span key={i} className={`terminal-line terminal-line-${l.type}`} data-testid={`terminal-line-${l.type}`}>
            {l.text}
            {'\n'}
          </span>
        ))}
      </pre>
      <div className="terminal-input-row">
        <span className="terminal-prompt">$</span>
        <input
          className="terminal-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          disabled={busy}
          data-testid="terminal-input"
        />
      </div>
    </GlassPanel>
  );
}
```

**Rules:**
- Scrollback is a `<pre>` with line-type styling (cmd bold, stdout default, stderr tinted `--status-error`).
- `usePrefs` for cwd memory.
- Explicit disabled state while `run_shell` is pending.
- `data-testid` coverage for Plan 07-07 spec.

---

## 4. Danger-zone Dialog confirm recipe (shared with ComputerUse / SecurityDashboard pentest / Diagnostics sysadmin / McpSettings remove)

Identity-edit Dialog discipline (Phase 6 §4) reused for EVERY destructive operation in Phase 7.

```tsx
// src/features/admin/SecurityDashboardPentestTab.tsx — pattern reference
import { useState } from 'react';
import { Dialog, Button } from '@/design-system/primitives';
import { pentestAuthorize } from '@/lib/tauri/admin';
import { useToast } from '@/lib/context/ToastContext';

interface AuthorizeDialogProps {
  open: boolean;
  onClose: () => void;
  onAuthorized: () => void;
}

export function AuthorizeDialog({ open, onClose, onAuthorized }: AuthorizeDialogProps) {
  const [target, setTarget] = useState('');
  const [rationale, setRationale] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const confirm = async () => {
    setBusy(true);
    try {
      await pentestAuthorize({ target, rationale });
      toast.push({ type: 'success', message: `Pentest authorized for ${target}` });
      onAuthorized();
      onClose();
    } catch (e) {
      toast.push({ type: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="AUTHORIZE PENTEST — IRREVERSIBLE">
      <div className="danger-banner" data-testid="danger-banner">
        AUTHORIZING PENTEST FOR A TARGET YOU DO NOT OWN IS ILLEGAL.
        Confirmed authorization is logged and attributable to your user.
      </div>
      <label>Target (hostname / IP)</label>
      <input value={target} onChange={(e) => setTarget(e.target.value)} />
      <label>Rationale (required)</label>
      <textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={4} />
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" onClick={confirm} disabled={busy || !target || !rationale}>
          {busy ? 'Authorizing…' : 'Authorize'}
        </Button>
      </div>
    </Dialog>
  );
}
```

**Rules:**
- NO silent destructive actions. Every one uses Dialog.
- ALL-CAPS warning banner for truly dangerous commands (pentest, sysadmin_sudo_exec, sysadmin_rollback, mcp_remove_server, integration_toggle OFF for production services).
- `variant="danger"` on the confirmation button.
- Disabled until required inputs filled.
- Consumer refetches after `onAuthorized()`.

---

## 5. Supervisor health panel recipe (Plan 07-06 Diagnostics)

`supervisor_get_health()` returns running background tasks — render as a grid.

```tsx
// src/features/admin/DiagnosticsHealthPanel.tsx — pattern reference
import { useEffect, useState } from 'react';
import { GlassPanel } from '@/design-system/primitives';
import { supervisorGetHealth, SupervisorHealth } from '@/lib/tauri/admin';

export function DiagnosticsHealthPanel() {
  const [health, setHealth] = useState<SupervisorHealth | null>(null);

  useEffect(() => {
    supervisorGetHealth().then(setHealth).catch(console.error);
  }, []);

  if (!health) return <div className="admin-placeholder-hint">Loading supervisor health…</div>;

  return (
    <div className="admin-health-grid" data-testid="supervisor-health-grid">
      {health.services.map((svc) => (
        <div
          key={svc.name}
          className="admin-card"
          data-status={svc.status === 'running' ? 'complete' : svc.status === 'error' ? 'failed' : 'idle'}
          data-testid="health-card"
        >
          <div className="admin-card-title">{svc.name}</div>
          <div className="admin-card-meta">{svc.status}</div>
          {svc.uptime_seconds != null && (
            <div className="admin-card-secondary">up {Math.round(svc.uptime_seconds / 60)}m</div>
          )}
        </div>
      ))}
    </div>
  );
}
```

**Rules:**
- Status tokens (`--status-running/success/error`) derive the card accent color via `data-status` attribute.
- Empty state: honest "supervisor returned 0 services" card (never render a white void).
- ROADMAP SC-4: "Diagnostics view shows module health for all running background tasks" — this panel is the falsifier.

---

## 6. File tree recursive render recipe (Plan 07-03 FileBrowser)

Line-oriented tree with expandable folders; depth=2 eager per D-173.

```tsx
// src/features/dev-tools/FileBrowserTree.tsx — pattern reference
import { useState } from 'react';
import type { FileTreeNode } from '@/lib/tauri/dev_tools';
import { fileTree } from '@/lib/tauri/dev_tools';
import { usePrefs } from '@/hooks/usePrefs';

interface Props {
  root: FileTreeNode;
  onSelect: (path: string) => void;
}

export function FileBrowserTree({ root, onSelect }: Props) {
  const { prefs, setPref } = usePrefs();
  const expandedKey = 'devTools.fileBrowser.expandedPaths';
  const expanded = new Set((prefs[expandedKey] as string | undefined)?.split('\n') ?? []);

  const toggleExpand = async (node: FileTreeNode) => {
    if (expanded.has(node.path)) {
      expanded.delete(node.path);
    } else {
      expanded.add(node.path);
      // Lazy-load children on first expand (depth 3+ per D-173)
      if (!node.children) {
        const fresh = await fileTree({ path: node.path, depth: 1 });
        node.children = fresh.children ?? [];
      }
    }
    setPref(expandedKey, Array.from(expanded).join('\n'));
  };

  const render = (node: FileTreeNode, depth: number): React.ReactNode => (
    <div
      key={node.path}
      className="file-tree-row"
      style={{ paddingLeft: depth * 12 }}
      data-testid="file-tree-row"
    >
      {node.is_dir ? (
        <button className="file-tree-toggle" onClick={() => toggleExpand(node)}>
          {expanded.has(node.path) ? '▾' : '▸'} {node.name}
        </button>
      ) : (
        <button className="file-tree-file" onClick={() => onSelect(node.path)}>
          {node.name}
        </button>
      )}
      {expanded.has(node.path) && node.children?.map((c) => render(c, depth + 1))}
    </div>
  );

  return <div className="file-tree" data-testid="file-browser-tree">{render(root, 0)}</div>;
}
```

**Rules:**
- Eager render to depth 2 (`fileTree({ path, depth: 2 })` in parent on mount); deeper lazy per-click.
- Expanded paths persisted as newline-joined string in Prefs (single blob discipline D-12).
- `data-testid` coverage for Plan 07-07 spec.

---

## 7. WorkflowBuilder tabs + streaming runs recipe (Plan 07-03 WorkflowBuilder + optional Plan 07-01 event audit)

Phase 6 §3 tabbed-surface recipe applies. If `workflow_run_started` / `workflow_run_completed` emits exist (Plan 07-01 audits), the runs tab subscribes via `useTauriEvent` — otherwise poll on focus + after "Run now".

```tsx
// Optional live-runs subscription (conditional on Plan 07-01 audit finding emits)
import { useTauriEvent } from '@/lib/events';
import type { WorkflowRunPayload } from '@/lib/events/payloads';

useTauriEvent<WorkflowRunPayload>(BLADE_EVENTS.WORKFLOW_RUN_COMPLETED, (payload) => {
  if (payload.workflow_id === selectedId) {
    setRuns((prev) => [payload, ...prev]);
  }
});
```

**Rules:**
- `usePrefs` persistence for tab selection (`devTools.activeTab`).
- Subscription ONLY if Plan 07-01 audit found the emit; otherwise use polling.

---

## 8. usePrefs extension (Plan 07-01)

```ts
// src/hooks/usePrefs.ts (Plan 07-01 extension)
export interface Prefs {
  // ... existing keys from Phase 1..6

  // ───── Phase 7 (Plan 07-01, D-192) ─────
  /** Dev Tools active tab (WorkflowBuilder, ComputerUse, DocumentGenerator). */
  'devTools.activeTab'?: string;
  /** Terminal current working directory memory. */
  'devTools.terminal.cwd'?: string;
  /** FileBrowser expanded folder paths (newline-joined string). */
  'devTools.fileBrowser.expandedPaths'?: string;
  /** Admin active tab (SecurityDashboard, Diagnostics, CapabilityReports). */
  'admin.activeTab'?: string;
  /** Last-expanded alert id in SecurityDashboard. */
  'admin.security.expandedAlert'?: string;
}
```

Debounce + single blob discipline preserved (D-12).

---

## 9. Common CSS conventions (Plan 07-03..06)

```css
/* src/features/dev-tools/dev-tools.css (Plan 07-02 creates; 07-03..04 extend) */
@layer features {
  .dev-surface {
    padding: var(--sp-4);
    height: 100%;
    overflow-y: auto;
  }

  .dev-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--sp-3);
  }

  .dev-card[data-status="running"]  { border-left: 3px solid var(--status-running); }
  .dev-card[data-status="complete"] { border-left: 3px solid var(--status-success); }
  .dev-card[data-status="failed"]   { border-left: 3px solid var(--status-error); }

  .dev-tab-pill {
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    cursor: pointer;
    font-size: 13px;
    transition: background 140ms var(--ease-out);
  }
  .dev-tab-pill[data-active="true"] {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.22);
  }

  /* Terminal-specific */
  .terminal-scrollback {
    font-family: var(--font-mono);
    font-size: 13px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--sp-2);
    height: calc(100vh - 240px);
    overflow-y: auto;
    white-space: pre;
  }
  .terminal-line-cmd    { color: var(--t-1); font-weight: 600; }
  .terminal-line-stdout { color: var(--t-2); }
  .terminal-line-stderr { color: var(--status-error); }

  /* File browser tree */
  .file-tree-row { font-family: var(--font-mono); font-size: 12px; }
  .file-tree-toggle, .file-tree-file {
    background: none; border: none; color: var(--t-1); cursor: pointer; text-align: left;
  }
}

/* src/features/admin/admin.css — parallel structure (Plan 07-02 creates) */
@layer features {
  .admin-surface {
    padding: var(--sp-4);
    height: 100%;
    overflow-y: auto;
  }
  .admin-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--sp-3);
  }
  .admin-card[data-status="running"]  { border-left: 3px solid var(--status-running); }
  .admin-card[data-status="complete"] { border-left: 3px solid var(--status-success); }
  .admin-card[data-status="failed"]   { border-left: 3px solid var(--status-error); }

  .admin-health-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--sp-2);
  }

  .admin-tabs {
    display: flex;
    gap: var(--sp-1);
    padding: var(--sp-2) 0;
    border-bottom: 1px solid var(--line);
    margin-bottom: var(--sp-3);
  }
  .admin-tab-pill {
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    cursor: pointer;
    font-size: 13px;
  }
  .admin-tab-pill[data-active="true"] {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.22);
  }

  /* Danger zone */
  .danger-banner {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid var(--status-error);
    border-radius: var(--radius-card);
    padding: var(--sp-2);
    color: var(--status-error);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: 12px;
  }
}
```

**Rules (inherit Phase 5 §10 + Phase 6 §7):**
- Only `GlassPanel` primitive uses `backdrop-filter`; inner cards use `rgba(...)` bg (D-07 + D-70).
- Every status color is a CSS token (`--status-running` etc.) — already introduced by Phase 5 Plan 05-02; Phase 7 REUSES.
- No hex colors in component files (danger banner uses `rgba(239,68,68,0.08)` which is a one-off accent; approved per D-183).

---

## 10. Playwright spec recipe (Plan 07-07, inherits Phase 5 §7 + Phase 6 §8)

Same harness, 4 new specs covering the 5 Phase 7 SCs. Example:

```ts
// tests/e2e/dev-tools-terminal.spec.ts (Plan 07-07)
import { test, expect } from '@playwright/test';

test('Terminal renders scrollback + echoes run_shell output (SC-1)', async ({ page }) => {
  await page.goto('http://localhost:1420/#/dev-terminal');
  await page.waitForSelector('[data-testid="terminal-root"]', { timeout: 5000 });

  await page.locator('[data-testid="terminal-input"]').fill('echo mock-output');
  await page.keyboard.press('Enter');

  // Dev-isolation hook returns mocked ShellResult — cmd + stdout appear as lines
  await expect.poll(async () =>
    await page.locator('[data-testid="terminal-line-cmd"]').count(),
    { timeout: 3000 }
  ).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-testid="terminal-scrollback"]')).toContainText('mock-output');
});
```

**Rules:**
- Dev-only isolation routes (Plan 07-07 Task 1): `/dev-terminal`, `/dev-workflow-builder`, `/dev-security-dashboard`, `/dev-mcp-settings`.
- All specs reuse existing harness — NO new test deps.
- Each spec asserts ONE success criterion.

---

## 11. Verify script recipe (Plan 07-07, inherits Phase 5 §8 + Phase 6 §9)

```bash
# scripts/verify-phase7-rust-surface.sh (Plan 07-07)
#!/usr/bin/env bash
set -euo pipefail

MISSING=()

check() {
  local pattern="$1"
  if ! grep -q -E "$pattern" src-tauri/src/lib.rs; then
    MISSING+=("$pattern")
  fi
}

# Dev Tools — native_tools (3)
check 'native_tools::run_shell'
check 'native_tools::run_code_block'
check 'native_tools::ask_ai'

# Dev Tools — files (6)
check 'files::file_read'
check 'files::file_write'
check 'files::file_list'
check 'files::file_tree'
check 'files::file_exists'
check 'files::file_mkdir'

# ... (continue for all 200+ commands per D-167 inventory)

# Admin — decision_gate (3)
check 'decision_gate::get_decision_log'
check 'decision_gate::decision_feedback'
check 'decision_gate::decision_evaluate'

# Admin — security_monitor (9)
check 'security_monitor::security_scan_network'
check 'security_monitor::security_overview'
# ... etc

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Phase 7 required Rust commands not found in lib.rs:" >&2
  for m in "${MISSING[@]}"; do echo "  - $m" >&2; done
  exit 1
fi
echo "OK: all Phase 7 Rust commands registered."
```

**Rules:**
- Enumerate all 200+ Phase 7 commands per D-167 inventory.
- Exit non-zero on missing; CI fails fast.
- `npm run verify:all` composes.

---

## 12. Edit convention: `scripts/verify-feature-cluster-routes.sh` extension

Extend the Phase 5 + Phase 6 version to also check the 10+11 Phase 7 routes:

```bash
# Phase 7 addition — append to existing verify-feature-cluster-routes.sh
DEVTOOLS=src/features/dev-tools/index.tsx
ADMIN=src/features/admin/index.tsx

for f in "$DEVTOOLS" "$ADMIN"; do
  if grep -q 'ComingSoonSkeleton' "$f"; then
    echo "ERROR: $f still references ComingSoonSkeleton — Phase 7 should use real lazy imports per D-170." >&2
    exit 1
  fi
  if ! grep -q "lazy(() => import" "$f"; then
    echo "ERROR: $f missing React.lazy imports — Phase 7 needs real route components." >&2
    exit 1
  fi
done

for f in Terminal FileBrowser GitPanel Canvas WorkflowBuilder WebAutomation EmailAssistant DocumentGenerator CodeSandbox ComputerUse; do
  if [ ! -f "src/features/dev-tools/${f}.tsx" ]; then
    echo "ERROR: Missing src/features/dev-tools/${f}.tsx (Plan 07-02/03/04 contract)" >&2
    exit 1
  fi
done
for f in Analytics CapabilityReports Reports DecisionLog SecurityDashboard Temporal Diagnostics IntegrationStatus McpSettings ModelComparison KeyVault; do
  if [ ! -f "src/features/admin/${f}.tsx" ]; then
    echo "ERROR: Missing src/features/admin/${f}.tsx (Plan 07-02/05/06 contract)" >&2
    exit 1
  fi
done
```

---

*Phase: 07-dev-tools-admin*
*Patterns captured: 2026-04-18 — downstream plans MUST follow these or justify in commit messages. Phase 5 + Phase 6 patterns apply verbatim where this file is silent.*
