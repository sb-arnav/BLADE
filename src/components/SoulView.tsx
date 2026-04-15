import { useState, useEffect, useCallback, useRef } from "react";
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

interface PersonaTrait {
  trait_name: string;
  score: number;
  confidence: number;
  evidence: string[];
  updated_at: number;
}

interface RelationshipState {
  intimacy_score: number;
  trust_score: number;
  shared_context: string[];
  growth_moments: string[];
}

interface KnowledgeNode {
  id: string;
  label: string;
  node_type: string;
  description: string;
}

interface UserProfile {
  user_name: string;
  onboarding_complete: boolean;
  traits: PersonaTrait[];
  relationship: RelationshipState;
  persona_md: string;
  activity_context: string;
  knowledge_nodes: KnowledgeNode[];
}

interface StreakStats {
  current_streak: number;
  longest_streak: number;
  total_active_days: number;
  total_conversations: number;
  total_messages: number;
  tools_used_count: number;
  facts_known: number;
  people_known: number;
  active_today: boolean;
  streak_label: string;
}

export function SoulView({ onBack }: Props) {
  const [state, setState] = useState<SoulState | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [streak, setStreak] = useState<StreakStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"profile" | "you" | "blade" | "diff">("profile");
  const [snapshotResult, setSnapshotResult] = useState<string | null>(null);
  const graphCanvasRef = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const [s, p, st] = await Promise.all([
        invoke<SoulState>("soul_get_state"),
        invoke<UserProfile>("get_user_profile").catch(() => null),
        invoke<StreakStats>("streak_get_stats").catch(() => null),
      ]);
      setState(s);
      setProfile(p);
      setStreak(st);
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Render the knowledge graph on canvas whenever profile nodes change
  useEffect(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas || !profile || profile.knowledge_nodes.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const nodes = profile.knowledge_nodes.slice(0, 40); // cap for perf
    const cx = W / 2;
    const cy = H / 2;

    // Simple radial layout
    const positions: { x: number; y: number }[] = nodes.map((_, i) => {
      if (i === 0) return { x: cx, y: cy };
      const angle = (i / (nodes.length - 1)) * 2 * Math.PI;
      const r = 70 + (i % 3) * 20;
      return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r };
    });

    // Draw edges from center node to all others
    ctx.strokeStyle = "rgba(99,102,241,0.15)";
    ctx.lineWidth = 1;
    for (let i = 1; i < positions.length; i++) {
      ctx.beginPath();
      ctx.moveTo(positions[0].x, positions[0].y);
      ctx.lineTo(positions[i].x, positions[i].y);
      ctx.stroke();
    }

    // Draw nodes
    nodes.forEach((node, i) => {
      const { x, y } = positions[i];
      const color =
        node.node_type === "project" ? "rgba(99,102,241,0.8)" :
        node.node_type === "tool"    ? "rgba(52,211,153,0.8)" :
        node.node_type === "person"  ? "rgba(251,191,36,0.8)" :
                                       "rgba(148,163,184,0.6)";
      const r = i === 0 ? 6 : 4;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Label (only for nodes with enough space)
      if (i < 20) {
        ctx.fillStyle = "rgba(148,163,184,0.8)";
        ctx.font = "8px monospace";
        ctx.textAlign = x > cx ? "left" : "right";
        ctx.fillText(node.label.slice(0, 16), x + (x > cx ? r + 2 : -(r + 2)), y + 3);
      }
    });
  }, [profile, activeTab]);

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

  if (error || !state) {
    return (
      <div className="h-full flex flex-col bg-blade-bg text-blade-text">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
          <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors text-sm">
            ← Back
          </button>
          <span className="text-sm font-semibold">SOUL</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-12 gap-4 text-center px-4">
          <div className="w-10 h-10 rounded-xl bg-red-900/20 border border-red-700/40 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-red-400">
              <circle cx="8" cy="8" r="6" />
              <path d="M8 5v3.5M8 10.5v.5" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-blade-secondary">Could not load SOUL data</p>
            <p className="text-xs text-blade-muted mt-1 max-w-xs">
              {error ?? "No data returned. BLADE may still be starting up."}
            </p>
          </div>
          <button
            onClick={load}
            className="px-4 py-1.5 text-xs font-medium rounded border border-blade-border text-blade-secondary hover:border-blade-accent/50 hover:text-blade-accent transition-all bg-blade-surface"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const s = state;
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
      <div className="flex gap-1 px-4 pt-3 shrink-0 border-b border-blade-border pb-2">
        {(["profile", "you", "blade", "diff"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              activeTab === tab
                ? "bg-blade-accent/20 text-blade-accent"
                : "text-blade-muted hover:text-blade-text"
            }`}
          >
            {tab === "profile" ? "Profile" : tab === "you" ? "Bible" : tab === "blade" ? "BLADE" : "Diff"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 space-y-3">

        {/* ── PROFILE TAB — what BLADE knows about the user ── */}
        {activeTab === "profile" && (
          <div className="space-y-4">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">
                  {profile?.user_name ? `${profile.user_name}'s Profile` : "Your Profile"}
                </div>
                <div className="text-[10px] text-blade-muted mt-0.5">
                  Everything BLADE has learned about you — built from conversations, activity, and your answers
                </div>
              </div>
              {!profile?.onboarding_complete && (
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
                  Onboarding pending
                </span>
              )}
            </div>

            {/* Streak & memory stats */}
            {streak && (
              <div className="bg-blade-surface border border-blade-border rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-widest text-blade-muted mb-2">BLADE stats</div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    {
                      label: "Streak",
                      value: streak.current_streak > 0 ? streak.streak_label : "—",
                      sub: streak.active_today ? "active today" : "not active today",
                      accent: streak.current_streak > 0,
                    },
                    {
                      label: "Conversations",
                      value: streak.total_conversations.toLocaleString(),
                      sub: `${streak.total_messages.toLocaleString()} messages`,
                      accent: false,
                    },
                    {
                      label: "Facts known",
                      value: streak.facts_known.toLocaleString(),
                      sub: `${streak.people_known} people`,
                      accent: false,
                    },
                    {
                      label: "Tools used",
                      value: streak.tools_used_count.toLocaleString(),
                      sub: `${streak.total_active_days} active days`,
                      accent: false,
                    },
                  ].map(({ label, value, sub, accent }) => (
                    <div key={label} className="text-center">
                      <div className={`text-base font-bold ${accent ? "text-blade-accent" : "text-blade-text"}`}>
                        {value}
                      </div>
                      <div className="text-[9px] text-blade-muted mt-0.5">{label}</div>
                      <div className="text-[8px] text-blade-muted/50 mt-0.5">{sub}</div>
                    </div>
                  ))}
                </div>
                {streak.longest_streak > 0 && (
                  <div className="mt-2 text-[9px] text-blade-muted/60 text-center">
                    Longest streak: {streak.longest_streak} days
                  </div>
                )}
              </div>
            )}

            {/* Relationship depth */}
            {profile && (profile.relationship.intimacy_score > 0 || profile.relationship.trust_score > 0) && (
              <div className="bg-blade-surface border border-blade-border rounded-lg p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-blade-muted">Relationship</div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Intimacy", val: profile.relationship.intimacy_score },
                    { label: "Trust", val: profile.relationship.trust_score },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <div className="flex justify-between text-[10px] mb-1">
                        <span className="text-blade-muted">{label}</span>
                        <span className="text-blade-text">{Math.round(val)}/100</span>
                      </div>
                      <div className="h-1 bg-blade-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blade-accent transition-all"
                          style={{ width: `${Math.min(val, 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {profile.relationship.growth_moments.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {profile.relationship.growth_moments.slice(0, 3).map((m, i) => (
                      <div key={i} className="text-[10px] text-blade-muted">• {m}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Learned traits */}
            {profile && profile.traits.length > 0 && (
              <div className="bg-blade-surface border border-blade-border rounded-lg p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-blade-muted">
                  Learned traits ({profile.traits.length})
                </div>
                <div className="space-y-2">
                  {profile.traits
                    .sort((a, b) => b.confidence - a.confidence)
                    .map((t) => (
                      <div key={t.trait_name} className="flex items-center gap-3">
                        <div className="w-28 text-[11px] text-blade-text truncate">{t.trait_name.replace(/_/g, " ")}</div>
                        <div className="flex-1 h-1 bg-blade-border rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${t.score > 0.7 ? "bg-green-500" : t.score > 0.4 ? "bg-blade-accent" : "bg-yellow-500"}`}
                            style={{ width: `${t.score * 100}%` }}
                          />
                        </div>
                        <div className="text-[9px] text-blade-muted w-10 text-right">{Math.round(t.confidence * 100)}% conf</div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Knowledge graph nodes — canvas visualization + tag cloud */}
            {profile && profile.knowledge_nodes.length > 0 && (
              <div className="bg-blade-surface border border-blade-border rounded-lg p-3 space-y-2">
                <div className="text-[10px] uppercase tracking-widest text-blade-muted">
                  Known context ({profile.knowledge_nodes.length} nodes)
                </div>
                {/* Canvas graph — renders radial node layout */}
                <canvas
                  ref={graphCanvasRef}
                  width={340}
                  height={200}
                  className="w-full rounded-md bg-blade-bg/50"
                  style={{ maxHeight: 200 }}
                />
                {/* Legend */}
                <div className="flex items-center gap-3 text-[9px] text-blade-muted">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blade-accent inline-block" /> project
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> tool
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> person
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blade-muted/60 inline-block" /> other
                  </span>
                </div>
                {/* Tag cloud (collapsed to top 20) */}
                <div className="flex flex-wrap gap-1.5">
                  {profile.knowledge_nodes.slice(0, 20).map((node) => (
                    <span
                      key={node.id}
                      title={node.description}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        node.node_type === "project"
                          ? "border-blade-accent/40 text-blade-accent bg-blade-accent/5"
                          : node.node_type === "tool"
                          ? "border-green-500/30 text-green-400 bg-green-500/5"
                          : node.node_type === "person"
                          ? "border-yellow-500/30 text-yellow-400 bg-yellow-500/5"
                          : "border-blade-border text-blade-muted"
                      }`}
                    >
                      {node.label}
                    </span>
                  ))}
                  {profile.knowledge_nodes.length > 20 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-blade-border text-blade-muted/50">
                      +{profile.knowledge_nodes.length - 20} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Activity context */}
            {profile?.activity_context && profile.activity_context.trim() && (
              <div className="bg-blade-surface border border-blade-border rounded-lg p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-blade-muted">Live activity</div>
                <pre className="text-[10px] text-blade-muted whitespace-pre-wrap leading-relaxed font-mono">
                  {profile.activity_context}
                </pre>
              </div>
            )}

            {/* Persona.md raw */}
            {profile?.persona_md && profile.persona_md.trim() && (
              <div className="bg-blade-surface border border-blade-border rounded-lg p-3 space-y-1">
                <div className="text-[10px] uppercase tracking-widest text-blade-muted">Your self-description</div>
                <div className="text-[11px] text-blade-text whitespace-pre-wrap leading-relaxed">
                  {profile.persona_md}
                </div>
              </div>
            )}

            {/* Empty state */}
            {profile && profile.traits.length === 0 && profile.knowledge_nodes.length === 0 && !profile.persona_md && (
              <div className="text-center py-8 space-y-2">
                <div className="text-blade-muted text-sm">BLADE doesn't know you yet.</div>
                <div className="text-blade-muted text-[11px]">
                  Chat more, complete the onboarding, or enable God Mode to start building your profile.
                </div>
              </div>
            )}
          </div>
        )}

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
