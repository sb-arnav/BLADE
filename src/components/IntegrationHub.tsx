import React, { useState, useMemo, useCallback } from "react";
import {
  useIntegrations,
  Integration,
  IntegrationTemplate,
  INTEGRATION_TEMPLATES,
} from "../hooks/useIntegrations";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Types ──────────────────────────────────────────────────────────────────────

type View = "catalog" | "connected" | "events";
type CategoryFilter = Integration["category"] | "all";

// ── Icon map ───────────────────────────────────────────────────────────────────

const ICONS: Record<string, React.ReactNode> = {
  github: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.43 9.8 8.21 11.39.6.11.79-.26.79-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.21.08 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 016.02 0c2.28-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.81 5.63-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.19.7.8.58A12.01 12.01 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ),
  slack: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M5.04 15.16a2.53 2.53 0 01-2.52 2.53A2.53 2.53 0 010 15.16a2.53 2.53 0 012.52-2.52h2.52v2.52zm1.27 0a2.53 2.53 0 012.52-2.52 2.53 2.53 0 012.53 2.52v6.32A2.53 2.53 0 018.83 24a2.53 2.53 0 01-2.52-2.52v-6.32zM8.83 5.04a2.53 2.53 0 01-2.52-2.52A2.53 2.53 0 018.83 0a2.53 2.53 0 012.53 2.52v2.52H8.83zm0 1.27a2.53 2.53 0 012.53 2.52 2.53 2.53 0 01-2.53 2.53H2.52A2.53 2.53 0 010 8.83a2.53 2.53 0 012.52-2.52h6.31zM18.96 8.83a2.53 2.53 0 012.52-2.52A2.53 2.53 0 0124 8.83a2.53 2.53 0 01-2.52 2.53h-2.52V8.83zm-1.27 0a2.53 2.53 0 01-2.52 2.53 2.53 2.53 0 01-2.53-2.53V2.52A2.53 2.53 0 0115.17 0a2.53 2.53 0 012.52 2.52v6.31zM15.17 18.96a2.53 2.53 0 012.52 2.52A2.53 2.53 0 0115.17 24a2.53 2.53 0 01-2.53-2.52v-2.52h2.53zm0-1.27a2.53 2.53 0 01-2.53-2.52 2.53 2.53 0 012.53-2.53h6.31A2.53 2.53 0 0124 15.17a2.53 2.53 0 01-2.52 2.52h-6.31z" />
    </svg>
  ),
  discord: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M20.32 4.37A19.8 19.8 0 0015.39 3a13.5 13.5 0 00-.62 1.27 18.4 18.4 0 00-5.54 0A13.5 13.5 0 008.6 3 19.8 19.8 0 003.68 4.37 20.47 20.47 0 00.1 17.26a19.9 19.9 0 006.07 3.07 14.8 14.8 0 001.3-2.1 12.9 12.9 0 01-2.04-.98l.5-.38a14.16 14.16 0 0012.14 0l.5.38c-.65.39-1.33.72-2.05.98a14.8 14.8 0 001.3 2.1 19.86 19.86 0 006.08-3.07A20.42 20.42 0 0020.32 4.37zM8.01 14.53c-1.12 0-2.04-1.03-2.04-2.29s.9-2.29 2.04-2.29 2.06 1.03 2.04 2.29c0 1.26-.9 2.29-2.04 2.29zm7.98 0c-1.12 0-2.04-1.03-2.04-2.29s.9-2.29 2.04-2.29 2.06 1.03 2.04 2.29c0 1.26-.9 2.29-2.04 2.29z" />
    </svg>
  ),
  linear: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M2.1 13.16a9.9 9.9 0 008.74 8.74L2.1 13.16zM1.5 11.2a10.01 10.01 0 0011.3 11.3L1.5 11.2zm18.87-4.86a9.93 9.93 0 01.13 6.44L10.22 2.5a9.93 9.93 0 016.44.13l6.63 6.63a9.95 9.95 0 00-2.92-2.92zM18.5 5.5A9.96 9.96 0 0012 2C6.48 2 2 6.48 2 12c0 1.82.49 3.53 1.34 5L18.5 5.5z" />
    </svg>
  ),
  notion: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M4.46 4.09l9.2-.67c1.13-.1 1.42-.03 2.13.47l2.93 2.04c.48.33.63.43.63.8v12.1c0 .66-.24 1.04-1.1 1.1l-10.7.63c-.64.04-.94-.06-1.28-.49L3.98 17.1c-.38-.52-.54-.86-.54-1.27V5.14c0-.54.24-.98.97-1.05h.05zm9.67 1.9c0 .34-.03.41-.2.41l-1.1.17v9.39c-.97.5-1.85.79-2.59.79-.67 0-.84-.21-1.34-.84l-4.1-6.42v6.2l2.27.5s0 .43-.6.43l-1.66.1c-.05-.34.1-.82.53-.92l.67-.18V8.43l-.93-.08c-.03-.34.1-.83.72-.87l1.78-.12 4.27 6.53V8.41l-1.9-.2c-.04-.4.21-.7.59-.72l1.58-.1v.6zm2.48-1.12L7.98 5.6l-.67.66v10.32l6.98-.41V5.47l1.67-.18.65-.42z" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  jira: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 00-.84-.84H11.53zM6.77 6.8a4.36 4.36 0 004.34 4.34h1.78v1.72a4.36 4.36 0 004.35 4.34V7.63a.84.84 0 00-.84-.84H6.77zM2 11.6a4.35 4.35 0 004.35 4.35h1.78v1.71c0 2.4 1.95 4.35 4.35 4.35V12.44a.84.84 0 00-.84-.84H2z" />
    </svg>
  ),
  sentry: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M13.91 2.33a1.96 1.96 0 00-3.38 0L7.27 8.2A12.47 12.47 0 0118.9 19.84h-2.99a9.53 9.53 0 00-8.89-8.89l2.66-4.6a6.6 6.6 0 016.24 6.25h-2.99a3.62 3.62 0 00-3.25-3.25l-1.7 2.94a.66.66 0 01.31.56.66.66 0 01-.66.65h-5.1a.33.33 0 01-.28-.49L13.91 2.33z" />
    </svg>
  ),
  vercel: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M12 2L2 19.5h20L12 2z" />
    </svg>
  ),
  webhook: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 16.98h-5.99c-1.66 0-3.01-1.34-3.01-3s1.35-3 3.01-3H15" />
      <circle cx="18" cy="16.98" r="3" />
      <circle cx="6" cy="7.02" r="3" />
      <path d="M6 10.02v4.96" />
    </svg>
  ),
  api: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="8" cy="6" r="1.5" fill="currentColor" />
      <circle cx="16" cy="12" r="1.5" fill="currentColor" />
      <circle cx="10" cy="18" r="1.5" fill="currentColor" />
    </svg>
  ),
  rss: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <circle cx="6.18" cy="17.82" r="2.18" />
      <path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83C19.56 11.33 12.67 4.44 4 4.44zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z" />
    </svg>
  ),
};

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: "All",
  communication: "Communication",
  development: "Development",
  productivity: "Productivity",
  data: "Data",
  custom: "Custom",
};

const CATEGORY_COLORS: Record<Integration["category"], string> = {
  communication: "bg-pink-500/20 text-pink-400",
  development: "bg-violet-500/20 text-violet-400",
  productivity: "bg-blue-500/20 text-blue-400",
  data: "bg-cyan-500/20 text-cyan-400",
  custom: "bg-amber-500/20 text-amber-400",
};

const STATUS_DOT: Record<Integration["status"], string> = {
  connected: "bg-emerald-400",
  disconnected: "bg-zinc-500",
  error: "bg-red-400",
  pending: "bg-amber-400 animate-pulse",
};

// ── Utility ────────────────────────────────────────────────────────────────────

function timeAgo(ts: number | null): string {
  if (!ts) return "Never";
  const d = Date.now() - ts;
  if (d < 60_000) return "Just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

function truncate(s: string, len: number): string {
  return s.length > len ? s.slice(0, len) + "..." : s;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function IntegrationHub({ onBack, onSendToChat }: Props) {
  const hub = useIntegrations();
  const [view, setView] = useState<View>("catalog");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [configuring, setConfiguring] = useState<IntegrationTemplate | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  // ── Filtered data ────────────────────────────────────────────────────────

  const filteredTemplates = useMemo(() => {
    if (categoryFilter === "all") return INTEGRATION_TEMPLATES;
    return INTEGRATION_TEMPLATES.filter(t => t.category === categoryFilter);
  }, [categoryFilter]);

  const filteredIntegrations = useMemo(() => {
    if (categoryFilter === "all") return hub.integrations;
    return hub.integrations.filter(i => i.category === categoryFilter);
  }, [hub.integrations, categoryFilter]);

  const recentEvents = useMemo(() => hub.getEvents(undefined, 100), [hub]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleStartConfig = useCallback((tpl: IntegrationTemplate) => {
    setConfiguring(tpl);
    setConfigValues({});
    setEditing(null);
  }, []);

  const handleEditConfig = useCallback((int: Integration) => {
    const tpl = INTEGRATION_TEMPLATES.find(t => t.icon === int.icon);
    if (!tpl) return;
    setConfiguring(tpl);
    setConfigValues({ ...int.config });
    setEditing(int);
  }, []);

  const handleSaveConfig = useCallback(() => {
    if (!configuring) return;

    // Check required fields
    const missing = configuring.configFields
      .filter(f => f.required && !configValues[f.key]?.trim())
      .map(f => f.label);
    if (missing.length) return; // fields will show red borders

    if (editing) {
      hub.updateIntegration(editing.id, { config: configValues, status: "pending" });
    } else {
      hub.addIntegration(configuring.id, configValues);
    }

    setConfiguring(null);
    setConfigValues({});
    setEditing(null);
    setView("connected");
  }, [configuring, configValues, editing, hub]);

  const handleTest = useCallback(async (id: string) => {
    setTesting(id);
    await hub.testIntegration(id);
    setTesting(null);
  }, [hub]);

  const handleRemove = useCallback((id: string) => {
    hub.removeIntegration(id);
    setConfirmRemove(null);
  }, [hub]);

  const handleAnalyzeEvent = useCallback((eventId: string) => {
    const prompt = hub.processEvent(eventId);
    if (prompt) onSendToChat(prompt);
  }, [hub, onSendToChat]);

  // ── Render helpers ───────────────────────────────────────────────────────

  const renderIcon = (iconKey: string, color: string) => (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
      style={{ backgroundColor: color + "22", color }}
    >
      {ICONS[iconKey] ?? ICONS.webhook}
    </div>
  );

  // ── Config form overlay ──────────────────────────────────────────────────

  const renderConfigForm = () => {
    if (!configuring) return null;
    return (
      <div className="absolute inset-0 z-50 bg-zinc-950/80 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            {renderIcon(configuring.icon, configuring.color)}
            <div>
              <h3 className="text-white font-semibold text-lg">
                {editing ? "Edit" : "Connect"} {configuring.name}
              </h3>
              <p className="text-zinc-400 text-xs mt-0.5">{configuring.description}</p>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-3">
            {configuring.configFields.map(field => (
              <div key={field.key}>
                <label className="text-xs text-zinc-400 mb-1 block">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <input
                  type={field.type === "secret" ? "password" : "text"}
                  placeholder={field.placeholder}
                  value={configValues[field.key] || ""}
                  onChange={e => setConfigValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className={`w-full bg-zinc-800 border rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                    field.required && !configValues[field.key]?.trim()
                      ? "border-zinc-700"
                      : "border-zinc-700"
                  }`}
                />
              </div>
            ))}
          </div>

          {/* Webhook URL (if applicable) */}
          {configuring.webhookUrl && (
            <div className="mt-4 p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg">
              <p className="text-xs text-zinc-400 mb-1">Webhook URL (paste in your service):</p>
              <code className="text-xs text-cyan-400 break-all select-all">
                https://hooks.blade.dev/v1/ingest/{"<id>"}
              </code>
              <p className="text-[10px] text-zinc-600 mt-1">
                Generated after saving. Copy and add to your service's webhook settings.
              </p>
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => { setConfiguring(null); setEditing(null); }}
              className="flex-1 px-4 py-2 text-sm text-zinc-400 bg-zinc-800 rounded-lg hover:bg-zinc-700 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveConfig}
              className="flex-1 px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-500 transition font-medium"
            >
              {editing ? "Update" : "Connect"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ── Main views ───────────────────────────────────────────────────────────

  const renderCatalog = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
      {filteredTemplates.map(tpl => {
        const alreadyConnected = hub.integrations.some(i => i.icon === tpl.icon);
        return (
          <button
            key={tpl.id}
            onClick={() => handleStartConfig(tpl)}
            className="text-left bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-600 hover:bg-zinc-800/60 transition group"
          >
            <div className="flex items-start gap-3">
              {renderIcon(tpl.icon, tpl.color)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium text-sm">{tpl.name}</span>
                  {alreadyConnected && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                      Connected
                    </span>
                  )}
                </div>
                <p className="text-zinc-500 text-xs mt-1 line-clamp-2">{tpl.description}</p>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${CATEGORY_COLORS[tpl.category]}`}>
                    {CATEGORY_LABELS[tpl.category]}
                  </span>
                  <span className="text-[10px] text-zinc-600 uppercase">{tpl.type}</span>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );

  const renderConnected = () => (
    <div className="p-4 space-y-2">
      {filteredIntegrations.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-zinc-600 text-sm">No integrations connected yet.</div>
          <button
            onClick={() => setView("catalog")}
            className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition"
          >
            Browse catalog
          </button>
        </div>
      ) : (
        filteredIntegrations.map(int => (
          <div
            key={int.id}
            className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition"
          >
            <div className="flex items-center gap-3">
              {renderIcon(int.icon, int.color)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium text-sm">{int.name}</span>
                  <span className={`w-2 h-2 rounded-full ${STATUS_DOT[int.status]}`} />
                  <span className="text-[10px] text-zinc-500 capitalize">{int.status}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-zinc-500">
                  <span>Last sync: {timeAgo(int.lastSync)}</span>
                  <span>{int.eventCount} events</span>
                  <span className={`px-1.5 py-0.5 rounded ${CATEGORY_COLORS[int.category]}`}>
                    {CATEGORY_LABELS[int.category]}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {/* Toggle */}
                <button
                  onClick={() => hub.toggleIntegration(int.id)}
                  className={`w-9 h-5 rounded-full transition relative ${
                    int.enabled ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                  title={int.enabled ? "Disable" : "Enable"}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      int.enabled ? "left-[18px]" : "left-0.5"
                    }`}
                  />
                </button>
                {/* Test */}
                <button
                  onClick={() => handleTest(int.id)}
                  disabled={testing === int.id}
                  className="px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition"
                >
                  {testing === int.id ? "..." : "Test"}
                </button>
                {/* Edit */}
                <button
                  onClick={() => handleEditConfig(int)}
                  className="px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition"
                >
                  Edit
                </button>
                {/* Remove */}
                {confirmRemove === int.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleRemove(int.id)}
                      className="px-2 py-1 text-[11px] rounded-lg bg-red-600 text-white hover:bg-red-500 transition"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmRemove(null)}
                      className="px-2 py-1 text-[11px] rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(int.id)}
                    className="px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 text-red-400 hover:bg-red-900/30 transition"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Webhook URL display for webhook-type integrations */}
            {int.webhookSecret && (
              <div className="mt-3 p-2.5 bg-zinc-800/50 border border-zinc-700/50 rounded-lg">
                <p className="text-[10px] text-zinc-500 mb-0.5">Webhook URL:</p>
                <code className="text-[11px] text-cyan-400 break-all select-all">
                  {hub.getWebhookUrl(int.id)}
                </code>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  const renderEvents = () => (
    <div className="p-4 space-y-2">
      {recentEvents.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-zinc-600 text-sm">No events yet.</div>
          <p className="text-zinc-700 text-xs mt-1">
            Events will appear here when your integrations fire.
          </p>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-2">
            <button
              onClick={() => hub.clearEvents()}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition"
            >
              Clear all
            </button>
          </div>
          {recentEvents.map(evt => {
            const int = hub.integrations.find(i => i.id === evt.integrationId);
            const isExpanded = expandedEvent === evt.id;
            let payloadPreview = evt.payload;
            try {
              const p = JSON.parse(evt.payload);
              payloadPreview = JSON.stringify(p, null, 2);
            } catch { /* text payload */ }

            return (
              <div
                key={evt.id}
                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => setExpandedEvent(isExpanded ? null : evt.id)}
                  className="w-full text-left p-3 flex items-center gap-3 hover:bg-zinc-800/40 transition"
                >
                  {int ? renderIcon(int.icon, int.color) : (
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500">
                      ?
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-sm font-medium">
                        {int?.name ?? "Unknown"}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                        {evt.type}
                      </span>
                      {evt.processed && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                          Analyzed
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-500 text-xs mt-0.5 truncate">
                      {truncate(evt.payload, 120)}
                    </p>
                  </div>
                  <span className="text-[10px] text-zinc-600 shrink-0">
                    {timeAgo(evt.timestamp)}
                  </span>
                  <svg
                    className={`w-4 h-4 text-zinc-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="border-t border-zinc-800 p-3">
                    <pre className="text-[11px] text-zinc-400 bg-zinc-950 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap break-words">
                      {payloadPreview}
                    </pre>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => handleAnalyzeEvent(evt.id)}
                        className="px-3 py-1.5 text-[11px] rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition font-medium"
                      >
                        Analyze with AI
                      </button>
                      <button
                        onClick={() => navigator.clipboard.writeText(evt.payload)}
                        className="px-3 py-1.5 text-[11px] rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition"
                      >
                        Copy payload
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div className="relative flex flex-col h-full bg-zinc-950 text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 shrink-0">
        <button
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-800 transition text-zinc-400"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold">Integrations</h2>
        {hub.connectedCount > 0 && (
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
            {hub.connectedCount} connected
          </span>
        )}
        {hub.errorCount > 0 && (
          <span className="px-2 py-0.5 text-[11px] rounded-full bg-red-500/20 text-red-400 font-medium">
            {hub.errorCount} error{hub.errorCount !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-[11px] text-zinc-600">{hub.totalEvents} total events</span>
      </div>

      {/* View tabs */}
      <div className="flex items-center gap-1 px-4 pt-3 pb-1 shrink-0">
        {(["catalog", "connected", "events"] as View[]).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-xs rounded-lg transition font-medium capitalize ${
              view === v
                ? "bg-zinc-800 text-white"
                : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
            }`}
          >
            {v}
            {v === "connected" && hub.integrations.length > 0 && (
              <span className="ml-1.5 text-[10px] text-zinc-500">{hub.integrations.length}</span>
            )}
            {v === "events" && hub.totalEvents > 0 && (
              <span className="ml-1.5 text-[10px] text-zinc-500">{hub.totalEvents}</span>
            )}
          </button>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-1 px-4 py-2 shrink-0 overflow-x-auto">
        {(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map(cat => (
          <button
            key={cat}
            onClick={() => setCategoryFilter(cat)}
            className={`px-2.5 py-1 text-[11px] rounded-lg transition whitespace-nowrap ${
              categoryFilter === cat
                ? "bg-zinc-800 text-white"
                : "text-zinc-600 hover:text-zinc-400"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {view === "catalog" && renderCatalog()}
        {view === "connected" && renderConnected()}
        {view === "events" && renderEvents()}
      </div>

      {/* Config overlay */}
      {renderConfigForm()}
    </div>
  );
}
