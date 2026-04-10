// src/components/CharacterBible.tsx
// Character Bible — 3-tab UI: Identity, Knowledge Graph, Skills & Memories

import { useRef, useState } from "react";
import { KnowledgeGraphView } from "./KnowledgeGraphView";
import { useCharacterBible } from "../hooks/useCharacterBible";
import { BrainNode, BrainPreference, BrainSkill } from "../types";

type Tab = "identity" | "graph" | "skills";

interface Props {
  onBack: () => void;
}

function relTime(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 80 ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
    : pct >= 60 ? "text-amber-300 border-amber-500/30 bg-amber-500/10"
    : "text-blade-muted border-blade-border bg-blade-surface";
  return <span className={`text-2xs px-1.5 py-0.5 rounded border ${tone}`}>{pct}%</span>;
}

function TagInput({ onAdd }: { onAdd: (tag: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <input
      type="text"
      placeholder="Add tag..."
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && val.trim()) {
          onAdd(val.trim());
          setVal("");
        }
      }}
      className="text-xs bg-transparent border border-dashed border-blade-border rounded px-2 py-0.5 text-blade-muted placeholder:text-blade-muted/50 outline-none focus:border-blade-accent/50 w-28"
    />
  );
}

// ── Identity Tab ──────────────────────────────────────────────────────────────

function IdentityTab() {
  const brain = useCharacterBible();
  const nameRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl">
      {/* Name + Role */}
      <div className="rounded-xl border border-blade-border bg-blade-surface p-5">
        <h3 className="text-xs uppercase tracking-widest text-blade-muted mb-4">Identity</h3>
        <div className="flex flex-col gap-4">
          <div>
            <label className="text-2xs text-blade-muted mb-1 block">Name</label>
            <input
              ref={nameRef}
              defaultValue={brain.identity.name ?? ""}
              placeholder="Your name"
              className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text outline-none focus:border-blade-accent/50"
              onBlur={(e) => brain.setIdentityField("name", e.target.value)}
            />
          </div>
          <div>
            <label className="text-2xs text-blade-muted mb-1 block">Role</label>
            <input
              ref={roleRef}
              defaultValue={brain.identity.role ?? ""}
              placeholder="What you do"
              className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-sm text-blade-text outline-none focus:border-blade-accent/50"
              onBlur={(e) => brain.setIdentityField("role", e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Working Style */}
      <div className="rounded-xl border border-blade-border bg-blade-surface p-5">
        <h3 className="text-xs uppercase tracking-widest text-blade-muted mb-4">Working Style</h3>
        <div className="flex flex-wrap gap-2">
          {brain.styleTags.map((tag, i) => (
            <span
              key={i}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border border-blade-border bg-blade-bg text-blade-secondary"
            >
              {tag}
              <button
                onClick={() => {
                  // find id from fresh fetch — simplification: use index as proxy
                  brain.removeStyleTag(String(i));
                }}
                className="text-blade-muted hover:text-blade-text transition-colors"
              >
                ×
              </button>
            </span>
          ))}
          <TagInput onAdd={brain.addStyleTag} />
        </div>
      </div>

      {/* Preferences */}
      <div className="rounded-xl border border-blade-border bg-blade-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs uppercase tracking-widest text-blade-muted">Preferences</h3>
          <button
            onClick={brain.detectPreferences}
            className="text-2xs text-blade-muted hover:text-blade-text transition-colors px-2 py-1 rounded border border-blade-border"
          >
            Re-detect
          </button>
        </div>

        {brain.preferences.length === 0 ? (
          <p className="text-sm text-blade-muted/60">No preferences detected yet. React to messages to train Blade.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {brain.preferences.map((pref) => (
              <PreferenceRow key={pref.id} pref={pref} onDelete={brain.deletePreference} onUpdate={brain.upsertPreference} />
            ))}
          </div>
        )}
      </div>

      {brain.lastUpdated && (
        <p className="text-2xs text-blade-muted/50">Last updated · {relTime(brain.lastUpdated)}</p>
      )}
    </div>
  );
}

function PreferenceRow({
  pref,
  onDelete,
  onUpdate,
}: {
  pref: BrainPreference;
  onDelete: (id: string) => void;
  onUpdate: (id: string, text: string, confidence: number, source: "feedback" | "manual") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(pref.text);

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-lg border border-blade-border/60 bg-blade-bg/60 group">
      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => {
            onUpdate(pref.id, val, pref.confidence, "manual");
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && (onUpdate(pref.id, val, pref.confidence, "manual"), setEditing(false))}
          className="flex-1 bg-transparent text-sm text-blade-text outline-none"
        />
      ) : (
        <span className="flex-1 text-sm text-blade-secondary">{pref.text}</span>
      )}
      <ConfidenceBadge value={pref.confidence} />
      <span className={`text-2xs px-1.5 py-0.5 rounded border ${pref.source === "feedback" ? "text-blade-accent border-blade-accent/30 bg-blade-accent/10" : "text-blade-muted border-blade-border bg-blade-surface"}`}>
        {pref.source}
      </span>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="text-2xs text-blade-muted hover:text-blade-text px-1.5 py-0.5 rounded hover:bg-blade-surface transition-colors">edit</button>
        <button onClick={() => onDelete(pref.id)} className="text-2xs text-rose-400/70 hover:text-rose-400 px-1.5 py-0.5 rounded hover:bg-rose-500/10 transition-colors">×</button>
      </div>
    </div>
  );
}

// ── Graph Tab ─────────────────────────────────────────────────────────────────

function GraphTab() {
  const brain = useCharacterBible();
  const [selected, setSelected] = useState<BrainNode | null>(null);

  const nodeMemories = selected
    ? brain.memories.filter((m) => {
        try { return (JSON.parse(m.entities_json) as string[]).includes(selected.id); } catch { return false; }
      })
    : [];

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0">
        <KnowledgeGraphView
          nodes={brain.nodes}
          edges={brain.edges}
          onNodeClick={setSelected}
        />
      </div>

      {selected && (
        <div className="w-72 border-l border-blade-border bg-blade-bg flex flex-col">
          <div className="p-4 border-b border-blade-border flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-blade-text">{selected.label}</div>
              <div className="text-2xs text-blade-muted mt-0.5 uppercase tracking-widest">{selected.kind}</div>
            </div>
            <button onClick={() => setSelected(null)} className="text-blade-muted hover:text-blade-text text-lg leading-none">×</button>
          </div>
          {selected.summary && (
            <div className="px-4 py-3 border-b border-blade-border">
              <p className="text-xs text-blade-secondary">{selected.summary}</p>
            </div>
          )}
          <div className="px-4 py-2 border-b border-blade-border">
            <span className="text-2xs text-blade-muted">Mentioned {selected.mention_count}× · last {relTime(selected.last_seen_at)}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="text-2xs uppercase tracking-widest text-blade-muted mb-2">Related memories</div>
            {nodeMemories.length === 0 ? (
              <p className="text-xs text-blade-muted/60">No memories reference this entity yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {nodeMemories.map((m) => (
                  <div key={m.id} className="text-xs text-blade-secondary p-2 rounded border border-blade-border/50 bg-blade-surface/50">
                    {m.text}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-blade-border">
            <button
              onClick={() => brain.deleteNode(selected.id).then(() => setSelected(null))}
              className="w-full text-2xs text-rose-400/70 hover:text-rose-400 py-1.5 rounded border border-rose-500/20 hover:border-rose-500/40 transition-colors"
            >
              Remove node
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Skills & Memories Tab ─────────────────────────────────────────────────────

function SkillsTab() {
  const brain = useCharacterBible();
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="flex flex-col gap-6 p-6 max-w-2xl overflow-y-auto">
      {/* Skills */}
      <div className="rounded-xl border border-blade-border bg-blade-surface p-5">
        <h3 className="text-xs uppercase tracking-widest text-blade-muted mb-4">Learned Skills</h3>
        {brain.skills.length === 0 ? (
          <p className="text-sm text-blade-muted/60">No skills yet. Blade will discover patterns as you work.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {brain.skills.map((skill) => (
              <SkillCard key={skill.id} skill={skill} onDelete={brain.deleteSkill} onToggle={brain.setSkillActive} />
            ))}
          </div>
        )}
      </div>

      {/* Memories */}
      <div className="rounded-xl border border-blade-border bg-blade-surface p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs uppercase tracking-widest text-blade-muted">
            Memories <span className="text-blade-muted/60 normal-case tracking-normal">({brain.memories.length})</span>
          </h3>
          {!confirmClear ? (
            <button
              onClick={() => setConfirmClear(true)}
              className="text-2xs text-blade-muted hover:text-rose-400 px-2 py-1 rounded border border-blade-border hover:border-rose-500/30 transition-colors"
            >
              Forget all
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-2xs text-blade-muted">Sure?</span>
              <button onClick={() => { brain.clearMemories(); setConfirmClear(false); }} className="text-2xs text-rose-400 px-2 py-0.5 rounded border border-rose-500/30">Yes</button>
              <button onClick={() => setConfirmClear(false)} className="text-2xs text-blade-muted px-2 py-0.5 rounded border border-blade-border">No</button>
            </div>
          )}
        </div>

        {brain.memories.length === 0 ? (
          <p className="text-sm text-blade-muted/60">No memories yet. Blade extracts facts at the end of each conversation.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {brain.memories.map((mem) => (
              <div key={mem.id} className="flex items-start gap-3 py-2 px-3 rounded-lg border border-blade-border/60 bg-blade-bg/60 group">
                <span className="flex-1 text-sm text-blade-secondary">{mem.text}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <ConfidenceBadge value={mem.confidence} />
                  <span className="text-2xs text-blade-muted/50">{relTime(mem.created_at)}</span>
                  <button
                    onClick={() => brain.deleteMemory(mem.id)}
                    className="text-2xs text-blade-muted/40 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  onDelete,
  onToggle,
}: {
  skill: BrainSkill;
  onDelete: (id: string) => void;
  onToggle: (id: string, active: boolean) => void;
}) {
  return (
    <div className={`rounded-lg border p-4 transition-colors ${skill.active ? "border-blade-border bg-blade-bg/60" : "border-blade-border/40 bg-blade-bg/30 opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-blade-text">{skill.name}</div>
          <div className="text-2xs text-blade-muted mt-0.5 truncate">{skill.trigger_pattern}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-2xs text-blade-muted">{skill.usage_count}×</span>
          <button
            onClick={() => onToggle(skill.id, !skill.active)}
            className={`text-2xs px-2 py-0.5 rounded border transition-colors ${skill.active ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-blade-muted border-blade-border"}`}
          >
            {skill.active ? "active" : "off"}
          </button>
          <button onClick={() => onDelete(skill.id)} className="text-2xs text-blade-muted/40 hover:text-rose-400 transition-colors">×</button>
        </div>
      </div>
      {skill.prompt_modifier && (
        <div className="mt-2 text-2xs text-blade-muted/70 italic line-clamp-2">"{skill.prompt_modifier}"</div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "graph", label: "Knowledge Graph" },
  { id: "skills", label: "Skills & Memories" },
];

export function CharacterBible({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>("identity");

  return (
    <div className="flex flex-col h-full bg-blade-bg">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-blade-border shrink-0">
        <button onClick={onBack} className="text-blade-muted hover:text-blade-text transition-colors p-1 rounded hover:bg-blade-surface">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div className="text-sm font-medium text-blade-text">Character Bible</div>
          <div className="text-2xs text-blade-muted">What Blade knows about you</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-4 py-2 border-b border-blade-border shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${tab === t.id ? "bg-blade-accent-muted text-blade-accent" : "text-blade-muted hover:text-blade-text hover:bg-blade-surface"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "identity" && <IdentityTab />}
        {tab === "graph" && <GraphTab />}
        {tab === "skills" && <SkillsTab />}
      </div>
    </div>
  );
}
