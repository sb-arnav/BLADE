// WatcherPanel — BLADE's ambient web monitor.
// Add URLs you care about and BLADE will alert you the moment something changes.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Watcher {
  id: string;
  url: string;
  label: string;
  interval_mins: number;
  last_content_hash: string;
  last_checked: number;
  last_changed: number;
  active: boolean;
  created_at: number;
}

interface WatcherAlert {
  watcher_id: string;
  url: string;
  label: string;
  summary: string;
  timestamp: number;
}

const INTERVAL_OPTIONS = [
  { label: "5 min", value: 5 },
  { label: "15 min", value: 15 },
  { label: "30 min", value: 30 },
  { label: "1 hour", value: 60 },
  { label: "6 hours", value: 360 },
  { label: "Daily", value: 1440 },
];

function formatRelative(ts: number): string {
  if (!ts) return "never";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function WatcherPanel() {
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [alerts, setAlerts] = useState<WatcherAlert[]>([]);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [interval, setInterval] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<Watcher[]>("watcher_list_all")
      .then(setWatchers)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();

    const unsub = listen<WatcherAlert>("watcher_alert", (event) => {
      setAlerts((prev) => [event.payload, ...prev.slice(0, 19)]);
      refresh();
    });

    return () => { unsub.then((f) => f()); };
  }, [refresh]);

  const handleAdd = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("watcher_add", {
        url: trimmedUrl,
        label: label.trim(),
        intervalMins: interval,
      });
      setUrl("");
      setLabel("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async (id: string) => {
    await invoke("watcher_remove", { id });
    refresh();
  };

  const handleToggle = async (id: string, active: boolean) => {
    await invoke("watcher_toggle", { id, active: !active });
    refresh();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-blade-border/30">
        <h2 className="text-sm font-semibold">Resource Watcher</h2>
        <p className="text-[11px] text-blade-muted mt-0.5">
          BLADE monitors URLs for changes and alerts you automatically.
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
        {/* Add watcher form */}
        <div className="space-y-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-blade-muted">Watch a URL</p>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="https://example.com/pricing"
            className="w-full px-3 py-2 text-xs bg-blade-surface border border-blade-border rounded-xl focus:outline-none focus:border-blade-accent/50 placeholder:text-blade-muted font-mono"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label (optional)"
              className="flex-1 px-3 py-2 text-xs bg-blade-surface border border-blade-border rounded-xl focus:outline-none focus:border-blade-accent/50 placeholder:text-blade-muted"
            />
            <select
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
              className="px-2 py-2 text-xs bg-blade-surface border border-blade-border rounded-xl focus:outline-none focus:border-blade-accent/50 text-blade-text"
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
          <button
            onClick={handleAdd}
            disabled={loading || !url.trim()}
            className="w-full px-3 py-2 rounded-xl bg-blade-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {loading ? "Adding..." : "Add Watcher"}
          </button>
        </div>

        {/* Active watchers */}
        {watchers.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-blade-muted">Active Watchers</p>
            {watchers.map((w) => (
              <div
                key={w.id}
                className={`p-3 rounded-xl border transition-colors ${
                  w.active
                    ? "border-blade-border bg-blade-surface/30"
                    : "border-blade-border/40 bg-blade-surface/10 opacity-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium truncate">
                        {w.label || w.url}
                      </span>
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        w.active ? "bg-emerald-400" : "bg-blade-muted"
                      }`} />
                    </div>
                    {w.label && (
                      <p className="text-[9px] text-blade-muted font-mono truncate mt-0.5">{w.url}</p>
                    )}
                    <div className="flex gap-3 mt-1">
                      <span className="text-[9px] text-blade-muted">
                        checked {formatRelative(w.last_checked)}
                      </span>
                      {w.last_changed > 0 && (
                        <span className="text-[9px] text-amber-400">
                          changed {formatRelative(w.last_changed)}
                        </span>
                      )}
                      <span className="text-[9px] text-blade-muted">
                        every {w.interval_mins < 60 ? `${w.interval_mins}m` : `${w.interval_mins / 60}h`}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleToggle(w.id, w.active)}
                      className="text-[9px] px-2 py-1 rounded-lg border border-blade-border text-blade-muted hover:text-blade-text transition-colors"
                    >
                      {w.active ? "Pause" : "Resume"}
                    </button>
                    <button
                      onClick={() => handleRemove(w.id)}
                      className="text-[9px] px-2 py-1 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/5 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {watchers.length === 0 && (
          <div className="text-center py-8 text-blade-muted text-xs space-y-1">
            <p className="text-xl">👁</p>
            <p>No watchers yet. Add a URL above and BLADE will alert you when it changes.</p>
          </div>
        )}

        {/* Recent alerts */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-blade-muted">Recent Alerts</p>
            {alerts.map((a, i) => (
              <div key={i} className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-amber-400 text-xs">Change detected</span>
                  <span className="text-[9px] text-blade-muted">{formatRelative(a.timestamp)}</span>
                </div>
                <p className="text-[10px] font-medium text-blade-text">{a.label || a.url}</p>
                <p className="text-[10px] text-blade-muted mt-0.5 leading-relaxed">{a.summary}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
