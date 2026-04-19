// src/features/identity/PersonaView.tsx
//
// Identity cluster — Persona route (IDEN-02). 4-tab surface (D-154):
//   Traits / Relationship / User Model / People.
//
// Tab state is persisted via prefs['identity.activeTab'] with a "persona:"
// prefix to avoid collision with SoulView's "soul:" tab keys (both surfaces
// share the dotted-key per D-165 — prefix is the disambiguator).
//
// Edit flow: traits use a CUSTOM inline Dialog (slider for score + textarea
// for evidence). EditSectionDialog is text-only and ships elsewhere for
// bible / soul sections. Score range 0..1, step 0.01 (T-06-05-02 mitigation).
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-154, §D-165
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §3
// @see src/lib/tauri/identity.ts

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Dialog, GlassPanel, GlassSpinner, Input, Pill } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import { usePrefs } from '@/hooks/usePrefs';
import {
  getExpertiseMap,
  getUserModel,
  personaAnalyzeNow,
  personaEstimateMood,
  personaGetRelationship,
  personaGetTraits,
  personaUpdateTrait,
  predictNextNeedCmd,
} from '@/lib/tauri/identity';
import { peopleList, peopleSuggestReplyStyle, peopleUpsert } from '@/lib/tauri/life_os';
import type { Person } from '@/features/life-os/types';
import type {
  ExpertiseEntry,
  PersonaTrait,
  RelationshipState,
  UserModel,
} from './types';
import './identity.css';
import './identity-rich-a.css';

type PersonaTab = 'traits' | 'relationship' | 'model' | 'people';
const TAB_PREF_KEY = 'identity.activeTab';
const TAB_PREF_PREFIX = 'persona:';
const DEFAULT_TAB: PersonaTab = 'traits';

function readInitialTab(raw: string | number | boolean | undefined): PersonaTab {
  if (typeof raw === 'string' && raw.startsWith(TAB_PREF_PREFIX)) {
    const t = raw.slice(TAB_PREF_PREFIX.length) as PersonaTab;
    if (t === 'traits' || t === 'relationship' || t === 'model' || t === 'people') return t;
  }
  return DEFAULT_TAB;
}

export function PersonaView() {
  const { prefs, setPref } = usePrefs();
  const [tab, setTab] = useState<PersonaTab>(() => readInitialTab(prefs[TAB_PREF_KEY]));

  const handleTabChange = (next: PersonaTab) => {
    setTab(next);
    setPref(TAB_PREF_KEY, `${TAB_PREF_PREFIX}${next}`);
  };

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="persona-view-root">
      <header className="identity-surface-header">
        <div>
          <h1 className="identity-surface-title">Persona</h1>
          <p className="identity-surface-sub">
            Persona engine dossier — traits, relationship, user model, people graph.
          </p>
        </div>
      </header>

      <div className="identity-tabs" role="tablist" aria-label="Persona sections">
        {(['traits', 'relationship', 'model', 'people'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="identity-tab-pill"
            data-active={tab === t}
            data-testid="persona-tab"
            data-tab={t}
            onClick={() => handleTabChange(t)}
          >
            {t === 'model' ? 'User Model' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'traits' && <TraitsTab />}
      {tab === 'relationship' && <RelationshipTab />}
      {tab === 'model' && <UserModelTab />}
      {tab === 'people' && <PeopleTab />}
    </GlassPanel>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Traits tab
// ═══════════════════════════════════════════════════════════════════════════

function TraitsTab() {
  const { prefs, setPref } = usePrefs();
  const [traits, setTraits] = useState<PersonaTrait[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [editing, setEditing] = useState<PersonaTrait | null>(null);
  const toast = useToast();

  const expanded = (prefs['identity.persona.expandedTrait'] as string | undefined) ?? null;

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await personaGetTraits();
      setTraits(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const next = await personaAnalyzeNow();
      setTraits(next);
      toast.show({ type: 'success', title: 'Trait analysis complete', message: `${next.length} traits` });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Analyze failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleExpand = (name: string) => {
    setPref('identity.persona.expandedTrait', expanded === name ? '' : name);
  };

  return (
    <div>
      <div className="identity-actions-row">
        <Button
          variant="secondary"
          onClick={handleAnalyze}
          disabled={analyzing}
          data-testid="persona-analyze-now"
        >
          {analyzing ? 'Analyzing…' : 'Analyze now'}
        </Button>
        <Button variant="ghost" onClick={() => void reload()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && traits.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner />
        </div>
      )}

      {error && (
        <div className="identity-deferred-card" role="status">
          <p><strong>Trait load failed.</strong></p>
          <p>{error}</p>
        </div>
      )}

      {!loading && traits.length === 0 && !error && (
        <div className="identity-empty">
          No traits tracked yet. Send a few chat messages + click thumbs-up/down for BLADE
          to derive traits via reaction → apply_reaction_to_traits.
        </div>
      )}

      {traits.length > 0 && (
        <div className="persona-trait-grid">
          {traits.map((t) => (
            <TraitCard
              key={t.trait_name}
              trait={t}
              expanded={expanded === t.trait_name}
              onToggle={() => toggleExpand(t.trait_name)}
              onEdit={() => setEditing(t)}
            />
          ))}
        </div>
      )}

      {editing && (
        <TraitEditDialog
          trait={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

interface TraitCardProps {
  trait: PersonaTrait;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}

function TraitCard({ trait, expanded, onToggle, onEdit }: TraitCardProps) {
  const pct = Math.max(0, Math.min(1, trait.score)) * 100;
  const updatedStr = trait.updated_at
    ? new Date(trait.updated_at * 1000).toLocaleDateString()
    : '—';
  return (
    <article
      className="persona-trait-card"
      data-testid="persona-trait-card"
      data-trait-name={trait.trait_name}
      data-expanded={expanded}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="persona-trait-header">
        <span className="persona-trait-name">{trait.trait_name}</span>
        <span className="persona-trait-score-numeric">{trait.score.toFixed(2)}</span>
      </div>
      <div className="persona-trait-score-bar" aria-hidden="true">
        <div className="persona-trait-score-fill" style={{ width: `${pct}%` }} />
      </div>
      {!expanded && trait.evidence.length > 0 && (
        <p className="persona-trait-evidence">
          {trait.evidence[0]!.length > 120
            ? `${trait.evidence[0]!.slice(0, 120)}…`
            : trait.evidence[0]}
        </p>
      )}
      {expanded && (
        <>
          {trait.evidence.length > 0 ? (
            <ul className="persona-trait-evidence-list">
              {trait.evidence.map((ev, i) => (
                <li key={i}>{ev}</li>
              ))}
            </ul>
          ) : (
            <p className="persona-trait-evidence">No evidence recorded yet.</p>
          )}
          <div className="persona-trait-meta">
            confidence {trait.confidence.toFixed(2)} · updated {updatedStr}
          </div>
          <div className="persona-trait-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
            >
              Edit
            </Button>
          </div>
        </>
      )}
    </article>
  );
}

interface TraitEditDialogProps {
  trait: PersonaTrait;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function TraitEditDialog({ trait, onClose, onSaved }: TraitEditDialogProps) {
  const [score, setScore] = useState<number>(trait.score);
  const [evidence, setEvidence] = useState<string>(trait.evidence[0] ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true);
    try {
      await personaUpdateTrait({
        traitName: trait.trait_name,
        score,
        evidence,
      });
      toast.show({ type: 'success', title: `Updated trait "${trait.trait_name}"` });
      await onSaved();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Trait update failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={true} onClose={onClose} ariaLabel={`Edit trait ${trait.trait_name}`}>
      <h3 className="identity-edit-dialog-title">Edit {trait.trait_name}</h3>

      <div className="persona-trait-edit-field">
        <label className="persona-trait-edit-field-label" htmlFor="trait-score-slider">
          Score: {score.toFixed(2)}
        </label>
        <input
          id="trait-score-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          className="persona-trait-edit-slider"
          disabled={busy}
        />
      </div>

      <div className="persona-trait-edit-field">
        <label className="persona-trait-edit-field-label" htmlFor="trait-evidence">
          Evidence
        </label>
        <textarea
          id="trait-evidence"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          rows={8}
          className="identity-edit-textarea"
          placeholder="Single evidence line to record with this update..."
          disabled={busy}
        />
      </div>

      <div className="identity-edit-dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Relationship tab
// ═══════════════════════════════════════════════════════════════════════════

function RelationshipTab() {
  const [rel, setRel] = useState<RelationshipState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await personaGetRelationship();
        if (!cancelled) setRel(r);
      } catch (e) {
        if (!cancelled) setError(typeof e === 'string' ? e : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
        <GlassSpinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="identity-deferred-card" role="status">
        <p><strong>Relationship load failed.</strong></p>
        <p>{error}</p>
      </div>
    );
  }
  if (!rel) {
    return <div className="identity-empty">No relationship data yet.</div>;
  }

  const intimacyPct = Math.max(0, Math.min(1, rel.intimacy_score)) * 100;
  const trustPct = Math.max(0, Math.min(1, rel.trust_score)) * 100;

  return (
    <div data-testid="persona-relationship-content">
      <div className="persona-relationship-bar-wrap">
        <div className="persona-relationship-bar-label">
          <span>Intimacy</span>
          <span>{rel.intimacy_score.toFixed(2)}</span>
        </div>
        <div className="persona-relationship-bar">
          <div className="persona-relationship-bar-fill" style={{ width: `${intimacyPct}%` }} />
        </div>
      </div>

      <div className="persona-relationship-bar-wrap">
        <div className="persona-relationship-bar-label">
          <span>Trust</span>
          <span>{rel.trust_score.toFixed(2)}</span>
        </div>
        <div className="persona-relationship-bar">
          <div className="persona-relationship-bar-fill" style={{ width: `${trustPct}%` }} />
        </div>
      </div>

      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">Shared context</h3>
        </header>
        {rel.shared_context.length > 0 ? (
          <ul className="persona-trait-evidence-list">
            {rel.shared_context.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        ) : (
          <p className="identity-section-content identity-section-content--empty">
            No shared context yet.
          </p>
        )}
      </article>

      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">Inside jokes</h3>
        </header>
        {rel.inside_jokes.length > 0 ? (
          <ul className="persona-trait-evidence-list">
            {rel.inside_jokes.map((j, i) => (
              <li key={i}>{j}</li>
            ))}
          </ul>
        ) : (
          <p className="identity-section-content identity-section-content--empty">
            No inside jokes recorded yet.
          </p>
        )}
      </article>

      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">Growth moments</h3>
        </header>
        {rel.growth_moments.length > 0 ? (
          <ul className="persona-trait-evidence-list">
            {rel.growth_moments.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        ) : (
          <p className="identity-section-content identity-section-content--empty">
            No growth moments recorded yet.
          </p>
        )}
      </article>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// User Model tab — read-only dossier
// ═══════════════════════════════════════════════════════════════════════════

function UserModelTab() {
  const [model, setModel] = useState<UserModel | null>(null);
  const [expertise, setExpertise] = useState<ExpertiseEntry[]>([]);
  const [mood, setMood] = useState<string>('');
  const [prediction, setPrediction] = useState<string | null | 'idle'>('idle');
  const [loading, setLoading] = useState(true);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // persona_estimate_mood takes recentMessages + timeOfDay (0-23) + streakMinutes.
      // No recent-message feed is wired into PersonaView in Phase 6, so we pass
      // safe empty defaults — the Rust implementation tolerates empty messages
      // and returns a neutral mood based on time_of_day. Documented in the
      // 06-05 SUMMARY as a known simplification (not a bug).
      const hour = new Date().getHours();
      const [m, em, md] = await Promise.allSettled([
        getUserModel(),
        getExpertiseMap(),
        personaEstimateMood({ recentMessages: [], timeOfDay: hour, streakMinutes: 0 }),
      ]);
      if (cancelled) return;
      if (m.status === 'fulfilled') setModel(m.value);
      if (em.status === 'fulfilled') setExpertise(em.value);
      if (md.status === 'fulfilled') setMood(md.value);
      const fail = [m, em, md].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (fail) setError(typeof fail.reason === 'string' ? fail.reason : String(fail.reason));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePredict = async () => {
    setPredicting(true);
    try {
      const p = await predictNextNeedCmd();
      setPrediction(p);
      toast.show({
        type: 'success',
        title: 'Prediction updated',
        message: p ?? 'No prediction at this time.',
      });
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Prediction failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setPredicting(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
        <GlassSpinner />
      </div>
    );
  }

  return (
    <div data-testid="persona-model-content">
      {error && (
        <div className="identity-deferred-card" role="status" style={{ marginBottom: 'var(--s-3)' }}>
          <p><strong>Some model data failed to load.</strong></p>
          <p>{error}</p>
        </div>
      )}

      {!model ? (
        <div className="identity-empty">No user model available yet.</div>
      ) : (
        <div className="persona-model-dossier">
          <div className="persona-model-field">
            <span className="persona-model-field-label">Name</span>
            <span className="persona-model-field-value">{model.name || '—'}</span>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Role</span>
            <span className="persona-model-field-value">{model.role || '—'}</span>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Work hours</span>
            <span className="persona-model-field-value">
              {model.work_hours[0]}:00 – {model.work_hours[1]}:00
            </span>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Energy pattern</span>
            <span className="persona-model-field-value">{model.energy_pattern || '—'}</span>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Communication style</span>
            <span className="persona-model-field-value">{model.communication_style || '—'}</span>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Mood today</span>
            <span className="persona-model-field-value">
              {model.mood_today || mood || '—'}
            </span>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Primary languages</span>
            <div className="persona-model-chip-list">
              {model.primary_languages.length > 0 ? (
                model.primary_languages.map((l) => (
                  <Pill key={l}>{l}</Pill>
                ))
              ) : (
                <span className="identity-section-content--empty">—</span>
              )}
            </div>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Active projects</span>
            <div className="persona-model-chip-list">
              {model.active_projects.length > 0 ? (
                model.active_projects.map((p) => <Pill key={p}>{p}</Pill>)
              ) : (
                <span className="identity-section-content--empty">—</span>
              )}
            </div>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Goals</span>
            <div className="persona-model-chip-list">
              {model.goals.length > 0 ? (
                model.goals.map((g) => <Pill key={g}>{g}</Pill>)
              ) : (
                <span className="identity-section-content--empty">—</span>
              )}
            </div>
          </div>
          <div className="persona-model-field">
            <span className="persona-model-field-label">Pet peeves</span>
            <div className="persona-model-chip-list">
              {model.pet_peeves.length > 0 ? (
                model.pet_peeves.map((p) => <Badge key={p} tone="warn">{p}</Badge>)
              ) : (
                <span className="identity-section-content--empty">—</span>
              )}
            </div>
          </div>
        </div>
      )}

      <article className="identity-section" style={{ marginTop: 'var(--s-4)' }}>
        <header className="identity-section-header">
          <h3 className="identity-section-title">Expertise map</h3>
        </header>
        {expertise.length === 0 ? (
          <p className="identity-section-content identity-section-content--empty">
            No expertise tracked yet.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-1)' }}>
            {expertise.slice(0, 20).map(([topic, conf]) => (
              <div className="persona-model-expertise-row" key={topic}>
                <span>{topic}</span>
                <span>{conf.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </article>

      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">Next-need prediction</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePredict}
            disabled={predicting}
            data-testid="persona-predict-now"
          >
            {predicting ? 'Predicting…' : 'Predict now'}
          </Button>
        </header>
        {prediction === 'idle' ? (
          <p className="identity-section-content identity-section-content--empty">
            Click "Predict now" to ask the persona engine what you're likely to need next.
          </p>
        ) : prediction === null ? (
          <p className="identity-section-content identity-section-content--empty">
            No prediction available right now.
          </p>
        ) : (
          <p className="identity-section-content">{prediction}</p>
        )}
      </article>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// People tab — cross-references SocialGraph (D-149)
// ═══════════════════════════════════════════════════════════════════════════

function PeopleTab() {
  const router = useRouterCtx();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [pendingName, setPendingName] = useState<string | null>(null);

  const [form, setForm] = useState<{ name: string; relationship: string; notes: string }>({
    name: '',
    relationship: '',
    notes: '',
  });
  const [savingForm, setSavingForm] = useState(false);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await peopleList();
      setPeople(list);
      setError(null);
    } catch (e) {
      setError(typeof e === 'string' ? e : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleSuggest = async (name: string) => {
    setPendingName(name);
    try {
      const out = await peopleSuggestReplyStyle(name);
      setSuggestions((s) => ({ ...s, [name]: out }));
    } catch (e) {
      toast.show({
        type: 'error',
        title: `Reply-style suggestion failed for ${name}`,
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setPendingName(null);
    }
  };

  const handleUpsert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSavingForm(true);
    try {
      const person: Person = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        relationship: form.relationship.trim(),
        communication_style: '',
        platform: '',
        topics: [],
        last_interaction: Math.floor(Date.now() / 1000),
        interaction_count: 0,
        notes: form.notes.trim(),
      };
      await peopleUpsert(person);
      toast.show({ type: 'success', title: `Added ${person.name}` });
      setForm({ name: '', relationship: '', notes: '' });
      await reload();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Upsert failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setSavingForm(false);
    }
  };

  return (
    <div data-testid="persona-people-content">
      <form className="persona-upsert-form" onSubmit={handleUpsert}>
        <Input
          placeholder="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          aria-label="Person name"
        />
        <Input
          placeholder="Relationship (e.g. friend, colleague)"
          value={form.relationship}
          onChange={(e) => setForm((f) => ({ ...f, relationship: e.target.value }))}
          aria-label="Relationship"
        />
        <Input
          placeholder="Notes"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          aria-label="Notes"
        />
        <Button type="submit" variant="primary" disabled={savingForm || !form.name.trim()}>
          {savingForm ? 'Saving…' : 'Add / update'}
        </Button>
      </form>

      <div className="identity-actions-row">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.openRoute('social-graph')}
          data-testid="persona-open-social-graph"
        >
          Open full CRM at /social-graph →
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void reload()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && people.length === 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner />
        </div>
      )}

      {error && (
        <div className="identity-deferred-card" role="status">
          <p><strong>People load failed.</strong></p>
          <p>{error}</p>
        </div>
      )}

      {!loading && people.length === 0 && !error && (
        <div className="identity-empty">
          No people yet. Use the form above, or BLADE will learn from conversations via
          people_learn_from_conversation.
        </div>
      )}

      {people.length > 0 && (
        <div className="persona-people-grid">
          {people.map((p) => {
            const suggestion = suggestions[p.name];
            return (
              <article className="persona-person-card" key={p.id} data-testid="persona-person-card">
                <header className="persona-person-header">
                  <span className="persona-person-name">{p.name}</span>
                  <span className="persona-person-relationship">
                    {p.relationship || 'contact'}
                  </span>
                </header>
                {p.notes && <p className="persona-trait-evidence">{p.notes}</p>}
                {p.topics.length > 0 && (
                  <div className="persona-model-chip-list">
                    {p.topics.slice(0, 5).map((t) => (
                      <Pill key={t}>{t}</Pill>
                    ))}
                  </div>
                )}
                <div className="persona-trait-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleSuggest(p.name)}
                    disabled={pendingName === p.name}
                  >
                    {pendingName === p.name ? 'Thinking…' : 'Suggest reply style'}
                  </Button>
                </div>
                {suggestion && (
                  <div className="persona-person-result">{suggestion}</div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

