import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CharacterBible {
  identity: string;
  preferences: string;
  projects: string;
  skills: string;
  contacts: string;
  notes: string;
  last_updated: string;
}

interface Preference {
  id: string;
  text: string;
  confidence: number;
  source: string;
  updated_at: number;
}

interface SoulSnapshot {
  id: number;
  created_at: number;
  diff_summary: string;
}

interface SoulState {
  character_bible: CharacterBible;
  blade_soul: string;
  preferences: Preference[];
  snapshots: SoulSnapshot[];
  latest_diff: string | null;
  last_snapshot_at: number | null;
}

const BIBLE_SECTIONS: { key: keyof CharacterBible; label: string; hint: string }[] = [
  { key: "identity", label: "Identity", hint: "Who you are — name, role, location" },
  { key: "preferences", label: "How you work", hint: "Tools, style, schedule, habits" },
  { key: "projects", label: "Projects", hint: "What you're building and why" },
  { key: "skills", label: "Skills", hint: "Technical expertise and strengths" },
  { key: "contacts", label: "People", hint: "Collaborators, clients, contacts" },
  { key: "notes", label: "Other", hint: "Anything else worth remembering" },
];

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value > 0.8 ? "bg-green-500" : value > 0.6 ? "bg-blade-accent" : "bg-yellow-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1 bg-blade-border rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[9px] text-blade-muted">{pct}%</span>
    </div>
  );
}

function BibleSection({
  label,
  hint,
  value,
  onSave,
}: {
  label: string;
  hint: string;
  value: string;
  onSave: (val: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);

  const save = async () => {
    setSaving(true);
    await onSave(draft);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="bg-blade-surface border border-blade-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <span className="text-xs font-medium text-blade-text">{label}</span>
          <span className="text-[10px] text-blade-muted ml-2">{hint}</span>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-blade-muted hover:text-blade-accent transition-colors"
          >
            Edit
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full bg-blade-bg border border-blade-accent/40 rounded px-2 py-1.5 text-xs text-blade-text placeholder-blade-muted focus:outline-none focus:border-blade-accent resize-none"
            placeholder={hint}
          />
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setEditing(false); setDraft(value); }}
              className="text-[10px] text-blade-muted hover:text-blade-text px-2 py-1 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="text-[10px] px-3 py-1 rounded bg-blade-accent text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap">
          {value || <span className="text-blade-muted italic">Nothing yet — BLADE will fill this in as you work.</span>}
        </div>
      )}
    </div>
  );
}

interface Props {
  onBack: () => void;
}

export function SoulView({ onBack }: Props) {
  const [state, setState] = useState<SoulState | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotting, setSnapshotting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"you" | "blade" | "diff">("you");
  const [snapshotResult, setSnapshotResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await invoke<SoulState>("soul_get_state");
      setState(s);
    } catch (e) {
      console.error("[soul] load:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const takeSnapshot = async () => {
    setSnapshotting(true);
    setSnapshotResult(null);
    try {
      const diff = await invoke<string>("soul_take_snapshot");
      setSnapshotResult(diff || "Snapshot saved.");
      await load();
    } catch (e) {
      setSnapshotResult(String(e));
    } finally {
      setSnapshotting(false);
    }
  };

  const refreshBible = async () => {
    setRefreshing(true);
    try {
      await invoke("soul_refresh_bible");
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const saveSection = async (section: string, content: string) => {
    await invoke("soul_update_bible_section", { section, content });
    await load();
  };

  const deletePref = async (id: string) => {
    await invoke("soul_delete_preference", { id });
    setState((prev) => prev ? {
      ...prev,
      preferences: prev.preferences.filter((p) => p.id !== id),
    } : prev);
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-blade-muted text-sm">
        Loading…
      </div>
    );
  }

  const s = state!;
  const bible = s.character_bible;
  const daysSinceSnapshot = s.last_snapshot_at
    ? Math.floor((Date.now() / 1000 - s.last_snapshot_at) / 86400)
    : null;

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors text-sm">
          ← Back
        </button>
        <div className="flex-1">
          <div className="text-sm font-semibold">SOUL</div>
          <div className="text-[10px] text-blade-muted">
            Everything BLADE knows about you — editable, transparent, yours
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={refreshBible}
            disabled={refreshing}
            className="text-[10px] px-2.5 py-1 rounded border border-blade-border text-blade-muted hover:text-blade-text hover:border-blade-accent/40 disabled:opacity-40 transition-colors"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          <button
            onClick={takeSnapshot}
            disabled={snapshotting}
            className="text-[10px] px-2.5 py-1 rounded border border-blade-accent text-blade-accent hover:bg-blade-accent/10 disabled:opacity-40 transition-colors"
          >
            {snapshotting ? "Snapshotting…" : "Snapshot now"}
          </button>
        </div>
      </div>

      {/* Snapshot status */}
      {daysSinceSnapshot !== null && (
        <div className="px-4 pt-2 shrink-0">
          <div className="text-[10px] text-blade-muted">
            Last snapshot:{" "}
            {daysSinceSnapshot === 0
              ? "today"
              : daysSinceSnapshot === 1
              ? "yesterday"
              : `${daysSinceSnapshot} days ago`}
            {daysSinceSnapshot >= 7 && (
              <span className="text-yellow-400 ml-2">— weekly snapshot due</span>
            )}
          </div>
        </div>
      )}

      {snapshotResult && (
        <div className="mx-4 mt-2 shrink-0 bg-green-500/5 border border-green-500/20 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-green-400 mb-1">What changed</div>
          <div className="text-xs text-blade-text leading-relaxed whitespace-pre-wrap">{snapshotResult}</div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-4 pt-3 shrink-0">
        {(["you", "blade", "diff"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              activeTab === tab
                ? "bg-blade-accent/20 text-blade-accent"
                : "text-blade-muted hover:text-blade-text"
            }`}
          >
            {tab === "you" ? "What BLADE knows about you" : tab === "blade" ? "BLADE's self-perception" : "Weekly diff"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 space-y-3">
        {activeTab === "you" && (
          <>
            {/* Editable Bible sections */}
            {BIBLE_SECTIONS.map(({ key, label, hint }) => (
              key !== "last_updated" && (
                <BibleSection
                  key={key}
                  label={label}
                  hint={hint}
                  value={bible[key] as string}
                  onSave={(val) => saveSection(key, val)}
                />
              )
            ))}

            {/* Learned preferences */}
            {s.preferences.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-2">
                  Learned preferences ({s.preferences.length})
                </div>
                <div className="space-y-1.5">
                  {s.preferences.map((pref) => (
                    <div
                      key={pref.id}
                      className="flex items-start gap-3 bg-blade-surface border border-blade-border rounded-lg px-3 py-2"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-blade-text leading-snug">{pref.text}</div>
                        <div className="mt-1 flex items-center gap-2">
                          <ConfidenceBar value={pref.confidence} />
                          <span className="text-[9px] text-blade-muted">{pref.source}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => deletePref(pref.id)}
                        className="text-blade-muted hover:text-red-400 transition-colors text-sm shrink-0 mt-0.5"
                        title="Remove this preference"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.preferences.length === 0 && Object.values(bible).every((v) => !v || typeof v !== "string" || v.length === 0) && (
              <div className="h-32 flex items-center justify-center text-blade-muted text-sm text-center px-8">
                BLADE hasn't learned much about you yet. Give it reactions (👍/👎) and keep using it — it fills this in over time.
              </div>
            )}
          </>
        )}

        {activeTab === "blade" && (
          <div className="bg-blade-surface border border-blade-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-2">
              BLADE's self-characterization
            </div>
            {s.blade_soul ? (
              <div className="text-sm text-blade-text leading-relaxed whitespace-pre-wrap">
                {s.blade_soul}
              </div>
            ) : (
              <div className="text-xs text-blade-muted italic">
                BLADE hasn't written its self-characterization yet. This evolves weekly as BLADE works with you — check back after a week of use.
              </div>
            )}
            <div className="mt-3 text-[9px] text-blade-muted">
              This is BLADE's honest first-person perspective on who it's become from working with you. It updates weekly. You can't edit it — it has to earn it.
            </div>
          </div>
        )}

        {activeTab === "diff" && (
          <>
            {s.latest_diff && (
              <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-4">
                <div className="text-[10px] uppercase tracking-widest text-green-400 mb-2">
                  Most recent — what changed
                </div>
                <div className="text-xs text-blade-text leading-relaxed whitespace-pre-wrap">
                  {s.latest_diff}
                </div>
              </div>
            )}

            {s.snapshots.length === 0 && (
              <div className="h-32 flex items-center justify-center text-blade-muted text-sm text-center px-8">
                No snapshots yet. Take one now or wait for the weekly automatic snapshot.
              </div>
            )}

            {s.snapshots.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-2">
                  Snapshot history ({s.snapshots.length} weeks)
                </div>
                <div className="space-y-2">
                  {s.snapshots.map((snap) => (
                    <div key={snap.id} className="bg-blade-surface border border-blade-border rounded-lg p-3">
                      <div className="text-[10px] text-blade-muted font-mono mb-1">
                        {new Date(snap.created_at * 1000).toLocaleDateString("en-US", {
                          weekday: "long", year: "numeric", month: "long", day: "numeric"
                        })}
                      </div>
                      {snap.diff_summary ? (
                        <div className="text-xs text-blade-secondary leading-relaxed whitespace-pre-wrap">
                          {snap.diff_summary}
                        </div>
                      ) : (
                        <div className="text-xs text-blade-muted italic">No diff summary for this snapshot.</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
