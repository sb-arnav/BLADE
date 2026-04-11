// RemindersPanel — view, create, and delete pending reminders.
// BLADE sets reminders automatically from conversation; this panel makes them visible.

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface Reminder {
  id: string;
  title: string;
  note: string;
  fire_at: number;
  fired: boolean;
  created_at: number;
}

function formatFireAt(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  const diff = ts - Math.floor(Date.now() / 1000);

  if (diff < 60) return "in a moment";
  if (diff < 3600) return `in ${Math.round(diff / 60)}m`;
  if (diff < 86400) return `in ${Math.round(diff / 3600)}h`;

  const isToday = d.toDateString() === now.toDateString();
  const isTomorrow = d.toDateString() === new Date(Date.now() + 86400000).toDateString();

  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today ${timeStr}`;
  if (isTomorrow) return `Tomorrow ${timeStr}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ` ${timeStr}`;
}

export function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [title, setTitle] = useState("");
  const [timeExpr, setTimeExpr] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(() => {
    invoke<Reminder[]>("reminder_list").then(setReminders).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // Refresh when a reminder fires or is created
    const unlistenFired = listen("blade_reminder_fired", () => load());
    const unlistenCreated = listen("blade_reminder_created", () => load());
    return () => {
      unlistenFired.then((fn) => fn());
      unlistenCreated.then((fn) => fn());
    };
  }, [load]);

  const handleAdd = async () => {
    if (!title.trim() || !timeExpr.trim()) {
      setError("Title and time are required.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await invoke("reminder_add_natural", {
        title: title.trim(),
        note: "",
        timeExpression: timeExpr.trim(),
      });
      setTitle("");
      setTimeExpr("");
      setShowForm(false);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    await invoke("reminder_delete", { id }).catch(() => {});
    setReminders((r) => r.filter((x) => x.id !== id));
  };

  return (
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-blade-secondary">
          {reminders.length === 0 ? "No pending reminders" : `${reminders.length} pending`}
        </span>
        <button
          onClick={() => { setShowForm((v) => !v); setError(null); }}
          className="text-[11px] px-2 py-0.5 rounded bg-blade-surface hover:bg-blade-surface-hover border border-blade-border/40 text-blade-secondary transition"
        >
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="space-y-2 p-3 rounded-lg bg-blade-surface border border-blade-border/30">
          <input
            type="text"
            placeholder="What to remind you about…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-2.5 py-1.5 text-xs bg-blade-bg border border-blade-border/50 rounded focus:outline-none focus:border-blade-accent/50 placeholder:text-blade-muted"
          />
          <input
            type="text"
            placeholder="When? e.g. 30 minutes, 2 hours, tomorrow, tonight"
            value={timeExpr}
            onChange={(e) => setTimeExpr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            className="w-full px-2.5 py-1.5 text-xs bg-blade-bg border border-blade-border/50 rounded focus:outline-none focus:border-blade-accent/50 placeholder:text-blade-muted"
          />
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          <button
            onClick={() => void handleAdd()}
            disabled={adding}
            className="w-full py-1.5 text-xs rounded bg-blade-accent text-white hover:bg-blade-accent/80 transition disabled:opacity-50"
          >
            {adding ? "Setting…" : "Set reminder"}
          </button>
        </div>
      )}

      {/* Reminder list */}
      {reminders.length > 0 ? (
        <div className="space-y-1.5">
          {reminders.map((r) => (
            <div
              key={r.id}
              className="flex items-start justify-between gap-2 px-3 py-2 rounded-lg bg-blade-surface border border-blade-border/30 group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-blade-text truncate">{r.title}</p>
                {r.note && (
                  <p className="text-[11px] text-blade-muted truncate">{r.note}</p>
                )}
                <p className="text-[10px] text-blade-accent mt-0.5">{formatFireAt(r.fire_at)}</p>
              </div>
              <button
                onClick={() => void handleDelete(r.id)}
                className="text-blade-muted hover:text-red-400 transition opacity-0 group-hover:opacity-100 flex-shrink-0 text-[10px] mt-0.5"
                title="Delete reminder"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        !showForm && (
          <p className="text-[11px] text-blade-muted/60 italic">
            BLADE sets reminders automatically from conversation — or add one above.
          </p>
        )
      )}
    </div>
  );
}
