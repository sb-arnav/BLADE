import React, { useEffect, useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Inline icon helpers (no lucide-react dependency) ─────────────────────────
type IconProps = { size?: number; className?: string };
const Ic = ({ d, size = 14, className = "" }: { d: string; size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}><path d={d} /></svg>
);
const ArrowLeft    = (p: IconProps) => <Ic size={p.size} className={p.className} d="M19 12H5M5 12l7 7M5 12l7-7" />;
const Play         = (p: IconProps) => <Ic size={p.size} className={p.className} d="M5 3l14 9-14 9V3z" />;
const Save         = (p: IconProps) => <Ic size={p.size} className={p.className} d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2zM17 21v-8H7v8M7 3v5h8" />;
const Plus         = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 5v14M5 12h14" />;
const Trash2       = (p: IconProps) => <Ic size={p.size} className={p.className} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />;
const ChevronDown  = (p: IconProps) => <Ic size={p.size} className={p.className} d="M6 9l6 6 6-6" />;
const ChevronUp    = (p: IconProps) => <Ic size={p.size} className={p.className} d="M18 15l-6-6-6 6" />;
const ChevronRight = (p: IconProps) => <Ic size={p.size} className={p.className} d="M9 18l6-6-6-6" />;
const Clock        = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a10 10 0 100 20A10 10 0 0012 2zM12 6v6l4 2" />;
const Eye          = (p: IconProps) => <Ic size={p.size} className={p.className} d="M1 12S5 5 12 5s11 7 11 7-4 7-11 7S1 12 1 12zM12 9a3 3 0 100 6 3 3 0 000-6z" />;
const Zap          = (p: IconProps) => <Ic size={p.size} className={p.className} d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />;
const Terminal     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M4 17l6-6-6-6M12 19h8" />;
const Globe        = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a10 10 0 100 20A10 10 0 0012 2zM2 12h20M12 2a15 15 0 010 20M12 2a15 15 0 000 20" />;
const FileText     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8" />;
const Bell         = (p: IconProps) => <Ic size={p.size} className={p.className} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />;
const GitBranch    = (p: IconProps) => <Ic size={p.size} className={p.className} d="M6 3v12M18 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9" />;
const Calendar     = (p: IconProps) => <Ic size={p.size} className={p.className} d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />;
const RefreshCw    = (p: IconProps) => <Ic size={p.size} className={p.className} d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />;
const CheckCircle  = (p: IconProps) => <Ic size={p.size} className={p.className} d="M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3" />;
const XCircle      = (p: IconProps) => <Ic size={p.size} className={p.className} d="M12 2a10 10 0 100 20A10 10 0 0012 2zM15 9l-6 6M9 9l6 6" />;
const Wand2        = (p: IconProps) => <Ic size={p.size} className={p.className} d="M15 4l5 5L7 22H2v-5zM12 7l5 5" />;
const ToggleRight  = (p: IconProps) => <Ic size={p.size} className={p.className} d="M17 7H7a5 5 0 000 10h10a5 5 0 000-10zM17 12a2 2 0 100-4 2 2 0 000 4z" />;
const ToggleLeft   = (p: IconProps) => <Ic size={p.size} className={p.className} d="M17 7H7a5 5 0 000 10h10a5 5 0 000-10zM7 12a2 2 0 100-4 2 2 0 000 4z" />;

// ── Types ─────────────────────────────────────────────────────────────────────

type NodeType = "schedule" | "file_watch" | "llm" | "bash" | "http" | "file_write" | "notify" | "condition";

interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  config: Record<string, string>;
}

interface Workflow {
  id?: string;
  name: string;
  description: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  created_at?: string;
  last_run?: string | null;
}

interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: "success" | "failure" | "running";
  started_at: string;
  duration_ms: number | null;
  node_outputs: Record<string, string>;
}

// ── Node palette definitions ──────────────────────────────────────────────────

const NODE_PALETTE: { type: NodeType; label: string; icon: React.ReactNode; color: string; defaultConfig: Record<string, string> }[] = [
  { type: "schedule",   label: "Schedule Trigger", icon: <Calendar size={14} />,   color: "text-purple-400 border-purple-700 bg-purple-900/20",   defaultConfig: { cron: "0 9 * * *" } },
  { type: "file_watch", label: "File Watch",        icon: <Eye size={14} />,        color: "text-blue-400 border-blue-700 bg-blue-900/20",          defaultConfig: { path: "~/Downloads", pattern: "*.pdf" } },
  { type: "llm",        label: "LLM Step",          icon: <Zap size={14} />,        color: "text-green-400 border-green-700 bg-green-900/20",       defaultConfig: { prompt: "Summarize: {{input}}", model: "" } },
  { type: "bash",       label: "Bash",              icon: <Terminal size={14} />,   color: "text-yellow-400 border-yellow-700 bg-yellow-900/20",    defaultConfig: { command: "echo hello" } },
  { type: "http",       label: "HTTP Request",      icon: <Globe size={14} />,      color: "text-cyan-400 border-cyan-700 bg-cyan-900/20",          defaultConfig: { url: "https://", method: "GET", body: "" } },
  { type: "file_write", label: "File Write",        icon: <FileText size={14} />,   color: "text-orange-400 border-orange-700 bg-orange-900/20",    defaultConfig: { path: "~/output.txt", content: "{{input}}" } },
  { type: "notify",     label: "Notify",            icon: <Bell size={14} />,       color: "text-pink-400 border-pink-700 bg-pink-900/20",          defaultConfig: { message: "{{input}}", channel: "desktop" } },
  { type: "condition",  label: "Condition",         icon: <GitBranch size={14} />,  color: "text-teal-400 border-teal-700 bg-teal-900/20",          defaultConfig: { expression: "{{input}} != \"\"", on_true: "continue", on_false: "stop" } },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function nodeColor(type: NodeType): string {
  return NODE_PALETTE.find((p) => p.type === type)?.color ?? "text-[rgba(255,255,255,0.5)] border-[rgba(255,255,255,0.1)] bg-blade-bg/20";
}

function nodeIcon(type: NodeType): React.ReactNode {
  return NODE_PALETTE.find((p) => p.type === type)?.icon ?? <Zap size={14} />;
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 9);
}

function emptyWorkflow(): Workflow {
  return { name: "New Workflow", description: "", enabled: true, nodes: [] };
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTs(ts: string | null | undefined): string {
  if (!ts) return "never";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

// ── Node config fields ────────────────────────────────────────────────────────

function NodeConfigPanel({
  node,
  onChange,
}: {
  node: WorkflowNode;
  onChange: (updated: WorkflowNode) => void;
}) {
  const set = (key: string, val: string) =>
    onChange({ ...node, config: { ...node.config, [key]: val } });

  const field = (key: string, label: string, placeholder = "", type = "text") => (
    <div key={key} className="flex flex-col gap-1">
      <label className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider">{label}</label>
      {type === "textarea" ? (
        <textarea
          className="bg-blade-bg border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-green-300 font-mono resize-none focus:outline-none focus:border-green-600"
          rows={3}
          value={node.config[key] ?? ""}
          placeholder={placeholder}
          onChange={(e) => set(key, e.target.value)}
        />
      ) : (
        <input
          type="text"
          className="bg-blade-bg border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-green-300 font-mono focus:outline-none focus:border-green-600"
          value={node.config[key] ?? ""}
          placeholder={placeholder}
          onChange={(e) => set(key, e.target.value)}
        />
      )}
    </div>
  );

  const select = (key: string, label: string, options: string[]) => (
    <div key={key} className="flex flex-col gap-1">
      <label className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider">{label}</label>
      <select
        className="bg-blade-bg border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-green-300 focus:outline-none focus:border-green-600"
        value={node.config[key] ?? options[0]}
        onChange={(e) => set(key, e.target.value)}
      >
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-wider">Label</label>
        <input
          type="text"
          className="bg-blade-bg border border-[rgba(255,255,255,0.1)] rounded px-2 py-1.5 text-xs text-green-300 font-mono focus:outline-none focus:border-green-600"
          value={node.label}
          onChange={(e) => onChange({ ...node, label: e.target.value })}
        />
      </div>
      {node.type === "schedule"   && field("cron", "Cron Expression", "0 9 * * *")}
      {node.type === "file_watch" && <>
        {field("path", "Watch Path", "~/Downloads")}
        {field("pattern", "File Pattern", "*.pdf")}
      </>}
      {node.type === "llm" && <>
        {field("prompt", "Prompt Template", "Summarize: {{input}}", "textarea")}
        {field("model", "Model (blank = default)", "")}
      </>}
      {node.type === "bash"       && field("command", "Command", "echo {{input}}", "textarea")}
      {node.type === "http"       && <>
        {field("url", "URL", "https://")}
        {select("method", "Method", ["GET", "POST", "PUT", "DELETE", "PATCH"])}
        {field("body", "Body (JSON)", "{}", "textarea")}
      </>}
      {node.type === "file_write" && <>
        {field("path", "Output Path", "~/output.txt")}
        {field("content", "Content Template", "{{input}}", "textarea")}
      </>}
      {node.type === "notify"     && <>
        {field("message", "Message Template", "{{input}}")}
        {select("channel", "Channel", ["desktop", "email", "slack", "discord"])}
      </>}
      {node.type === "condition"  && <>
        {field("expression", "Expression", "{{input}} != \"\"")}
        {select("on_true", "On True", ["continue", "stop", "loop"])}
        {select("on_false", "On False", ["stop", "continue", "loop"])}
      </>}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function WorkflowBuilderView({ onBack }: { onBack: () => void }) {
  // Workflow list state
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Current editing workflow
  const [current, setCurrent] = useState<Workflow>(emptyWorkflow());
  const [isDirty, setIsDirty] = useState(false);

  // UI state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  // Generate dialog
  const [showGenerate, setShowGenerate] = useState(false);
  const [genDesc, setGenDesc] = useState("");
  const [generating, setGenerating] = useState(false);

  const dragNodeType = useRef<NodeType | null>(null);

  // ── Load workflows ──────────────────────────────────────────────────────────
  const loadWorkflows = useCallback(async () => {
    try {
      const list = await invoke<Workflow[]>("workflow_list");
      setWorkflows(list ?? []);
    } catch { setWorkflows([]); }
  }, []);

  useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

  // ── Listen for workflow notifications ───────────────────────────────────────
  useEffect(() => {
    const unlisten = listen<{ message: string }>("blade_workflow_notification", (e) => {
      setNotification(e.payload.message);
      setTimeout(() => setNotification(null), 3000);
      loadWorkflows();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [loadWorkflows]);

  // ── Select workflow ─────────────────────────────────────────────────────────
  const selectWorkflow = useCallback(async (id: string) => {
    try {
      const wf = await invoke<Workflow>("workflow_get", { id });
      if (wf) {
        setCurrent(wf);
        setSelectedId(id);
        setSelectedNodeId(null);
        setIsDirty(false);
        setShowRuns(false);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Runs ────────────────────────────────────────────────────────────────────
  const loadRuns = useCallback(async () => {
    if (!selectedId) return;
    try {
      const r = await invoke<WorkflowRun[]>("workflow_get_runs", { workflowId: selectedId });
      setRuns(r ?? []);
    } catch { setRuns([]); }
  }, [selectedId]);

  useEffect(() => {
    if (showRuns) loadRuns();
  }, [showRuns, loadRuns]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const save = useCallback(async () => {
    setSaving(true);
    try {
      if (selectedId) {
        await invoke("workflow_update", { id: selectedId, workflow: JSON.stringify(current) });
      } else {
        await invoke("workflow_create", { workflow: JSON.stringify(current) });
      }
      setIsDirty(false);
      await loadWorkflows();
      setNotification("Workflow saved.");
      setTimeout(() => setNotification(null), 2000);
    } catch (e) {
      setNotification(`Save failed: ${String(e)}`);
    } finally { setSaving(false); }
  }, [current, selectedId, loadWorkflows]);

  const runNow = useCallback(async () => {
    if (!selectedId) { setNotification("Save first."); return; }
    setRunning(true);
    try {
      await invoke("workflow_run_now", { id: selectedId });
      setNotification("Workflow started.");
      setTimeout(() => setNotification(null), 2000);
    } catch (e) {
      setNotification(`Run failed: ${String(e)}`);
    } finally { setRunning(false); }
  }, [selectedId]);

  const deleteWorkflow = useCallback(async (id: string) => {
    if (!confirm("Delete this workflow?")) return;
    try {
      await invoke("workflow_delete", { id });
      if (selectedId === id) {
        setCurrent(emptyWorkflow());
        setSelectedId(null);
      }
      await loadWorkflows();
    } catch { /* ignore */ }
  }, [selectedId, loadWorkflows]);

  const toggleEnabled = useCallback(async (wf: Workflow) => {
    const updated = { ...wf, enabled: !wf.enabled };
    try {
      await invoke("workflow_update", { id: wf.id, workflow: JSON.stringify(updated) });
      await loadWorkflows();
    } catch { /* ignore */ }
  }, [loadWorkflows]);

  // ── Generate ────────────────────────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (!genDesc.trim()) return;
    setGenerating(true);
    try {
      const generated = await invoke<Workflow>("workflow_generate_from_description", { description: genDesc });
      if (generated) {
        setCurrent(generated);
        setSelectedId(null);
        setIsDirty(true);
        setShowGenerate(false);
        setGenDesc("");
      }
    } catch (e) {
      setNotification(`Generate failed: ${String(e)}`);
    } finally { setGenerating(false); }
  }, [genDesc]);

  // ── Node operations ─────────────────────────────────────────────────────────
  const addNode = useCallback((type: NodeType) => {
    const palette = NODE_PALETTE.find((p) => p.type === type);
    if (!palette) return;
    const node: WorkflowNode = {
      id: makeId(),
      type,
      label: palette.label,
      config: { ...palette.defaultConfig },
    };
    setCurrent((c) => ({ ...c, nodes: [...c.nodes, node] }));
    setSelectedNodeId(node.id);
    setIsDirty(true);
  }, []);

  const updateNode = useCallback((updated: WorkflowNode) => {
    setCurrent((c) => ({
      ...c,
      nodes: c.nodes.map((n) => (n.id === updated.id ? updated : n)),
    }));
    setIsDirty(true);
  }, []);

  const removeNode = useCallback((id: string) => {
    setCurrent((c) => ({ ...c, nodes: c.nodes.filter((n) => n.id !== id) }));
    if (selectedNodeId === id) setSelectedNodeId(null);
    setIsDirty(true);
  }, [selectedNodeId]);

  const moveNode = useCallback((id: string, dir: -1 | 1) => {
    setCurrent((c) => {
      const idx = c.nodes.findIndex((n) => n.id === id);
      if (idx < 0) return c;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= c.nodes.length) return c;
      const nodes = [...c.nodes];
      [nodes[idx], nodes[newIdx]] = [nodes[newIdx], nodes[idx]];
      return { ...c, nodes };
    });
    setIsDirty(true);
  }, []);

  const selectedNode = current.nodes.find((n) => n.id === selectedNodeId) ?? null;

  // ── Drag/drop from palette ──────────────────────────────────────────────────
  const onDragStart = (type: NodeType) => { dragNodeType.current = type; };
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragNodeType.current) { addNode(dragNodeType.current); dragNodeType.current = null; }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 min-h-0 flex flex-col bg-blade-bg text-[rgba(255,255,255,0.7)] font-mono text-xs overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[rgba(255,255,255,0.07)] shrink-0">
        <button onClick={onBack} className="text-[rgba(255,255,255,0.4)] hover:text-green-400 transition-colors">
          <ArrowLeft size={15} />
        </button>
        <span className="text-green-400 font-bold tracking-widest uppercase text-xs">Workflow Builder</span>
        <div className="flex-1" />
        {notification && (
          <span className="text-2xs text-green-400 border border-green-800 bg-green-900/20 px-2 py-0.5 rounded animate-pulse">
            {notification}
          </span>
        )}
        <button
          onClick={() => setShowGenerate(true)}
          className="flex items-center gap-1.5 px-3 py-1 border border-purple-700 bg-purple-900/20 text-purple-300 rounded hover:bg-purple-800/30 transition-colors text-2xs"
        >
          <Wand2 size={12} /> Generate
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1 border border-[rgba(255,255,255,0.1)] bg-blade-bg text-[rgba(255,255,255,0.7)] rounded hover:text-green-400 hover:border-green-700 transition-colors text-2xs"
        >
          <Save size={12} /> {saving ? "Saving…" : "Save"}
          {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
        </button>
        <button
          onClick={runNow}
          disabled={running || !selectedId}
          className="flex items-center gap-1.5 px-3 py-1 border border-green-800 bg-green-900/20 text-green-300 rounded hover:bg-green-800/30 transition-colors text-2xs disabled:opacity-40"
        >
          <Play size={12} /> {running ? "Running…" : "Run Now"}
        </button>
      </div>

      {/* Generate dialog */}
      {showGenerate && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-blade-bg border border-[rgba(255,255,255,0.1)] rounded-lg p-5 w-[480px] flex flex-col gap-3">
            <div className="text-green-400 font-bold text-sm">Generate from description</div>
            <textarea
              className="bg-blade-bg border border-[rgba(255,255,255,0.1)] rounded px-3 py-2 text-xs text-green-300 font-mono resize-none focus:outline-none focus:border-green-600"
              rows={4}
              placeholder="e.g. Every morning at 9am, fetch my GitHub notifications and send me a summary via desktop notification"
              value={genDesc}
              onChange={(e) => setGenDesc(e.target.value)}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowGenerate(false)} className="px-3 py-1 text-2xs text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] border border-[rgba(255,255,255,0.1)] rounded">Cancel</button>
              <button
                onClick={generate}
                disabled={generating || !genDesc.trim()}
                className="px-3 py-1 text-2xs text-green-300 border border-green-700 bg-green-900/20 rounded hover:bg-green-800/30 disabled:opacity-40"
              >
                {generating ? "Generating…" : "Generate"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left sidebar */}
        <div className="w-56 border-r border-[rgba(255,255,255,0.07)] flex flex-col shrink-0 overflow-hidden">
          {/* Workflow list */}
          <div className="border-b border-[rgba(255,255,255,0.07)] p-2 flex flex-col gap-1 overflow-y-auto max-h-64 shrink-0">
            <div className="flex items-center justify-between px-1 mb-1">
              <span className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-widest">Workflows</span>
              <button
                onClick={() => { setCurrent(emptyWorkflow()); setSelectedId(null); setSelectedNodeId(null); setIsDirty(false); }}
                className="text-[rgba(255,255,255,0.3)] hover:text-green-400 transition-colors"
                title="New workflow"
              >
                <Plus size={12} />
              </button>
            </div>
            {workflows.length === 0 && (
              <div className="text-2xs text-[rgba(255,255,255,0.3)] px-1">No workflows yet</div>
            )}
            {workflows.map((wf) => (
              <div
                key={wf.id}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer border transition-colors ${
                  selectedId === wf.id
                    ? "border-green-800 bg-green-900/10 text-green-300"
                    : "border-transparent hover:border-[rgba(255,255,255,0.1)] hover:bg-blade-bg text-[rgba(255,255,255,0.5)]"
                }`}
                onClick={() => selectWorkflow(wf.id!)}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleEnabled(wf); }}
                  className="shrink-0"
                  title={wf.enabled ? "Disable" : "Enable"}
                >
                  {wf.enabled
                    ? <ToggleRight size={13} className="text-green-500" />
                    : <ToggleLeft size={13} className="text-[rgba(255,255,255,0.3)]" />}
                </button>
                <span className="flex-1 truncate text-2xs">{wf.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteWorkflow(wf.id!); }}
                  className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-400 transition-opacity"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>

          {/* Selected workflow meta */}
          {selectedId && (
            <div className="p-2 border-b border-[rgba(255,255,255,0.07)] shrink-0">
              <div className="text-2xs text-[rgba(255,255,255,0.3)] flex items-center gap-1">
                <Clock size={10} /> Last run: {formatTs(current.last_run)}
              </div>
              <button
                onClick={() => setShowRuns((p) => !p)}
                className="mt-1 text-2xs text-[rgba(255,255,255,0.4)] hover:text-green-400 flex items-center gap-1 transition-colors"
              >
                <RefreshCw size={10} /> Run history {showRuns ? "▲" : "▼"}
              </button>
            </div>
          )}

          {/* Node palette */}
          <div className="flex-1 p-2 overflow-y-auto">
            <div className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-widest px-1 mb-2">Node Palette</div>
            <div className="flex flex-col gap-1">
              {NODE_PALETTE.map((p) => (
                <div
                  key={p.type}
                  draggable
                  onDragStart={() => onDragStart(p.type)}
                  onClick={() => addNode(p.type)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-grab active:cursor-grabbing select-none hover:opacity-90 transition-opacity ${p.color}`}
                  title={`Add ${p.label} node`}
                >
                  {p.icon}
                  <span className="text-2xs">{p.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Canvas + config panel */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Workflow name/desc bar */}
          <div className="flex items-center gap-3 px-4 py-2 border-b border-[rgba(255,255,255,0.07)] shrink-0">
            <input
              className="bg-transparent text-green-300 font-bold text-sm border-b border-transparent focus:border-green-700 focus:outline-none w-56 placeholder:text-[rgba(255,255,255,0.3)]"
              value={current.name}
              placeholder="Workflow name"
              onChange={(e) => { setCurrent((c) => ({ ...c, name: e.target.value })); setIsDirty(true); }}
            />
            <input
              className="bg-transparent text-[rgba(255,255,255,0.4)] text-2xs border-b border-transparent focus:border-[rgba(255,255,255,0.1)] focus:outline-none flex-1 placeholder:text-[rgba(255,255,255,0.2)]"
              value={current.description}
              placeholder="Description…"
              onChange={(e) => { setCurrent((c) => ({ ...c, description: e.target.value })); setIsDirty(true); }}
            />
          </div>

          {/* Run history panel */}
          {showRuns && (
            <div className="border-b border-[rgba(255,255,255,0.07)] bg-blade-bg px-4 py-2 max-h-48 overflow-y-auto shrink-0">
              <div className="text-2xs text-[rgba(255,255,255,0.4)] uppercase tracking-widest mb-2">Run History</div>
              {runs.length === 0 && <div className="text-2xs text-[rgba(255,255,255,0.3)]">No runs yet</div>}
              {runs.map((run) => (
                <div key={run.id} className="mb-1">
                  <button
                    onClick={() => setExpandedRun((p) => (p === run.id ? null : run.id))}
                    className="w-full flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                  >
                    {run.status === "success"
                      ? <CheckCircle size={11} className="text-green-400 shrink-0" />
                      : run.status === "failure"
                        ? <XCircle size={11} className="text-red-400 shrink-0" />
                        : <RefreshCw size={11} className="text-yellow-400 shrink-0 animate-spin" />}
                    <span className="text-2xs text-[rgba(255,255,255,0.5)]">{formatTs(run.started_at)}</span>
                    <span className="text-2xs text-[rgba(255,255,255,0.3)]">({formatDuration(run.duration_ms)})</span>
                    <ChevronRight size={10} className={`ml-auto text-[rgba(255,255,255,0.3)] transition-transform ${expandedRun === run.id ? "rotate-90" : ""}`} />
                  </button>
                  {expandedRun === run.id && (
                    <div className="ml-4 mt-1 bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded p-2 text-2xs text-[rgba(255,255,255,0.5)] font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                      {Object.entries(run.node_outputs).map(([k, v]) => (
                        <div key={k}><span className="text-green-600">[{k}]</span> {v}</div>
                      ))}
                      {Object.keys(run.node_outputs).length === 0 && <span className="text-[rgba(255,255,255,0.3)]">No output</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Main canvas + side config */}
          <div className="flex-1 min-h-0 flex overflow-hidden">
            {/* Node canvas */}
            <div
              className="flex-1 overflow-y-auto p-4 flex flex-col items-center gap-0"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onCanvasDrop}
            >
              {current.nodes.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-[rgba(255,255,255,0.2)] select-none">
                  <Zap size={32} className="mb-3 opacity-30" />
                  <div className="text-sm">Drag nodes here or click palette items</div>
                  <div className="text-2xs mt-1 opacity-60">Or use "Generate" to build from a description</div>
                </div>
              )}
              {current.nodes.map((node, idx) => (
                <React.Fragment key={node.id}>
                  <div
                    onClick={() => setSelectedNodeId((p) => (p === node.id ? null : node.id))}
                    className={`relative w-full max-w-md border rounded p-3 cursor-pointer transition-all select-none ${nodeColor(node.type)} ${
                      selectedNodeId === node.id ? "ring-1 ring-green-500/50 shadow-lg shadow-green-900/20" : "hover:opacity-90"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {nodeIcon(node.type)}
                      <span className="font-bold text-2xs uppercase tracking-wider">{node.label}</span>
                      <div className="flex-1" />
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); moveNode(node.id, -1); }}
                          disabled={idx === 0}
                          className="opacity-50 hover:opacity-100 disabled:opacity-20 transition-opacity"
                        ><ChevronUp size={11} /></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); moveNode(node.id, 1); }}
                          disabled={idx === current.nodes.length - 1}
                          className="opacity-50 hover:opacity-100 disabled:opacity-20 transition-opacity"
                        ><ChevronDown size={11} /></button>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
                          className="text-red-500/70 hover:text-red-400 transition-colors"
                        ><Trash2 size={11} /></button>
                      </div>
                    </div>
                    <div className="mt-1 text-2xs opacity-60 font-mono truncate">
                      {Object.entries(node.config).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ")}
                    </div>
                  </div>
                  {idx < current.nodes.length - 1 && (
                    <div className="flex flex-col items-center">
                      <div className="w-px h-4 bg-[rgba(255,255,255,0.07)]" />
                      <div className="text-[rgba(255,255,255,0.2)] text-2xs">▼</div>
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Config panel */}
            {selectedNode && (
              <div className="w-64 border-l border-[rgba(255,255,255,0.07)] p-3 overflow-y-auto shrink-0 bg-blade-bg">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xs text-green-400 font-bold uppercase tracking-wider">Node Config</span>
                  <button onClick={() => setSelectedNodeId(null)} className="text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.5)]">
                    <XCircle size={12} />
                  </button>
                </div>
                <NodeConfigPanel node={selectedNode} onChange={updateNode} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
