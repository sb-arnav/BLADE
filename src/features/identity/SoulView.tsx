// src/features/identity/SoulView.tsx
//
// Identity cluster — Soul route (IDEN-01, SC-3). Real body shipped by Plan 06-05.
//
// Layout (D-153):
//   - Top: state stat card (trait count + preference count + last-snapshot)
//   - Actions row: Refresh Bible / Take snapshot
//   - 3-tab surface (Bible / Profile / Preferences) persisted via
//     prefs['identity.activeTab'] (D-153). Distinct tab keys ("soul:bible" etc)
//     to avoid collision with PersonaView's shared activeTab pref.
//   - Bible tab: renders the 6 character_bible sections + BLADE self-body.
//     Each section opens EditSectionDialog → updateCharacterSection.
//     (character.rs is the canonical owner; soul_update_bible_section delegates
//      there anyway per src/lib/tauri/identity.ts JSDoc.)
//   - Profile tab: read-only dossier from get_user_profile.
//   - Preferences tab: list of preferences with Delete button → Dialog confirm
//     → soul_delete_preference.
//
// No auto-save anywhere. Every mutation is behind an explicit Save / Confirm
// button. Identity data is high-stakes (T-06-05-01 mitigation).
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-153, §D-165
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §3, §4
// @see src/lib/tauri/identity.ts (soul_* + character_* + user_profile wrappers)

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { usePrefs } from '@/hooks/usePrefs';
import {
  bladeGetSoul,
  getCharacterBible,
  getUserProfile,
  soulDeletePreference,
  soulGetState,
  soulRefreshBible,
  soulTakeSnapshot,
  updateCharacterSection,
} from '@/lib/tauri/identity';
import type {
  BrainPreference,
  CharacterBible as CharacterBibleDoc,
  SoulState,
  UserProfile,
} from './types';
import { EditSectionDialog } from './EditSectionDialog';
import './identity.css';
import './identity-rich-a.css';

type SoulTab = 'bible' | 'profile' | 'preferences';
const TAB_PREF_KEY = 'identity.activeTab';
const TAB_PREF_PREFIX = 'soul:';
const DEFAULT_TAB: SoulTab = 'bible';

// Ordered bible sections mirrored from src-tauri/src/character.rs CharacterBible.
// Labels are display-only; the section ids match Rust's update_character_section valid list.
const BIBLE_SECTIONS: Array<{ id: keyof CharacterBibleDoc; label: string }> = [
  { id: 'identity',    label: 'Identity' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'projects',    label: 'Projects' },
  { id: 'skills',      label: 'Skills' },
  { id: 'contacts',    label: 'Contacts' },
  { id: 'notes',       label: 'Notes' },
];

function readInitialTab(raw: string | number | boolean | undefined): SoulTab {
  if (typeof raw === 'string' && raw.startsWith(TAB_PREF_PREFIX)) {
    const t = raw.slice(TAB_PREF_PREFIX.length) as SoulTab;
    if (t === 'bible' || t === 'profile' || t === 'preferences') return t;
  }
  return DEFAULT_TAB;
}

export function SoulView() {
  const { prefs, setPref } = usePrefs();
  const [tab, setTab] = useState<SoulTab>(() => readInitialTab(prefs[TAB_PREF_KEY]));

  const [state, setState] = useState<SoulState | null>(null);
  const [bible, setBible] = useState<CharacterBibleDoc | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [bladeSoul, setBladeSoul] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const toast = useToast();

  // Edit dialog state — one at a time.
  const [editing, setEditing] = useState<{ section: keyof CharacterBibleDoc; label: string; content: string } | null>(
    null,
  );

  // Preference delete confirmation state.
  const [pendingDelete, setPendingDelete] = useState<BrainPreference | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [s, b, p, bs] = await Promise.allSettled([
      soulGetState(),
      getCharacterBible(),
      getUserProfile(),
      bladeGetSoul(),
    ]);
    if (s.status === 'fulfilled') setState(s.value);
    if (b.status === 'fulfilled') setBible(b.value);
    if (p.status === 'fulfilled') setProfile(p.value);
    if (bs.status === 'fulfilled') setBladeSoul(bs.value);

    // Collect first error for banner (but still show partial data).
    const failed = [s, b, p, bs].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) {
      setLoadError(typeof failed.reason === 'string' ? failed.reason : String(failed.reason));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleTabChange = (next: SoulTab) => {
    setTab(next);
    setPref(TAB_PREF_KEY, `${TAB_PREF_PREFIX}${next}`);
  };

  const handleRefreshBible = async () => {
    setBusyAction('refresh');
    try {
      await soulRefreshBible();
      toast.show({ type: 'success', title: 'Bible refreshed' });
      await reload();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Refresh failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTakeSnapshot = async () => {
    setBusyAction('snapshot');
    try {
      const note = await soulTakeSnapshot();
      toast.show({ type: 'success', title: 'Snapshot saved', message: note });
      await reload();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Snapshot failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleEditSave = async (content: string) => {
    if (!editing) return;
    // Route every bible-section edit through character::update_character_section.
    // Rationale: soul_update_bible_section delegates to this command anyway (per
    // src/lib/tauri/identity.ts JSDoc) — going direct saves a layer of indirection
    // and keeps ownership explicit. SoulView does NOT call soul_update_bible_section
    // at all; it's still exposed for other consumers that want the soul-layer audit
    // trail if one is added later.
    await updateCharacterSection({ section: String(editing.section), content });
    await reload();
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await soulDeletePreference(pendingDelete.id);
      toast.show({ type: 'success', title: 'Preference removed' });
      setPendingDelete(null);
      await reload();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Delete failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setDeleting(false);
    }
  };

  const stateStats = useMemo(() => {
    const traitCount = profile?.traits.length ?? state?.character_bible ? undefined : 0;
    const preferenceCount = state?.preferences.length ?? 0;
    const snapshotCount = state?.snapshots.length ?? 0;
    const lastSnapshotAt = state?.last_snapshot_at ?? state?.snapshots[0]?.created_at ?? null;
    return {
      traitCount: profile?.traits.length ?? traitCount ?? 0,
      preferenceCount,
      snapshotCount,
      lastSnapshotAt,
    };
  }, [profile, state]);

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="soul-view-root">
      <header className="identity-surface-header">
        <div>
          <h1 className="identity-surface-title">Soul</h1>
          <p className="identity-surface-sub">
            Identity document + preferences + snapshot history — sourced from soul_commands + character.rs.
          </p>
        </div>
      </header>

      {/* State stat card — always visible, even while other loaders run. */}
      <div className="identity-state-card" data-testid="soul-state-card">
        <div className="identity-state-card-stat">
          <span className="identity-state-card-stat-label">Traits tracked</span>
          <span className="identity-state-card-stat-value">{stateStats.traitCount}</span>
        </div>
        <div className="identity-state-card-stat">
          <span className="identity-state-card-stat-label">Preferences</span>
          <span className="identity-state-card-stat-value">{stateStats.preferenceCount}</span>
        </div>
        <div className="identity-state-card-stat">
          <span className="identity-state-card-stat-label">Snapshots</span>
          <span className="identity-state-card-stat-value">{stateStats.snapshotCount}</span>
        </div>
        <div className="identity-state-card-stat">
          <span className="identity-state-card-stat-label">Last snapshot</span>
          <span className="identity-state-card-stat-value">
            {stateStats.lastSnapshotAt
              ? new Date(stateStats.lastSnapshotAt * 1000).toLocaleDateString()
              : '—'}
          </span>
        </div>
      </div>

      <div className="identity-actions-row">
        <Button
          variant="secondary"
          onClick={handleRefreshBible}
          disabled={busyAction !== null || loading}
          data-testid="soul-refresh-bible"
        >
          {busyAction === 'refresh' ? 'Refreshing…' : 'Refresh Bible'}
        </Button>
        <Button
          variant="secondary"
          onClick={handleTakeSnapshot}
          disabled={busyAction !== null || loading}
          data-testid="soul-take-snapshot"
        >
          {busyAction === 'snapshot' ? 'Saving…' : 'Take snapshot'}
        </Button>
      </div>

      {loadError && (
        <div
          className="identity-deferred-card"
          role="status"
          data-testid="soul-load-error"
          style={{ marginBottom: 'var(--s-3)' }}
        >
          <p><strong>Some data failed to load.</strong></p>
          <p>{loadError}</p>
        </div>
      )}

      <div
        className="identity-tabs"
        role="tablist"
        aria-label="Soul sections"
      >
        {(['bible', 'profile', 'preferences'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className="identity-tab-pill"
            data-active={tab === t}
            data-testid="soul-tab"
            data-tab={t}
            onClick={() => handleTabChange(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading && !state && !bible && !profile && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner />
        </div>
      )}

      {tab === 'bible' && (
        <BibleTab
          bible={bible}
          bladeSoul={bladeSoul}
          onEdit={(section, label, content) => setEditing({ section, label, content })}
        />
      )}

      {tab === 'profile' && <ProfileTab profile={profile} />}

      {tab === 'preferences' && (
        <PreferencesTab
          preferences={state?.preferences ?? []}
          onRequestDelete={(p) => setPendingDelete(p)}
        />
      )}

      {editing && (
        <EditSectionDialog
          open={true}
          title={editing.label}
          initialContent={editing.content}
          onClose={() => setEditing(null)}
          onSave={handleEditSave}
          placeholder={`Edit the ${editing.label} section...`}
        />
      )}

      {pendingDelete && (
        <Dialog
          open={true}
          onClose={() => (deleting ? undefined : setPendingDelete(null))}
          ariaLabel="Confirm delete preference"
        >
          <h3 className="identity-edit-dialog-title">Delete preference?</h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13 }}>
            {pendingDelete.key ?? pendingDelete.id}
          </p>
          {pendingDelete.value && (
            <p style={{ color: 'var(--t-3)', fontSize: 12 }}>{pendingDelete.value}</p>
          )}
          <div className="identity-edit-dialog-actions">
            <Button variant="ghost" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </Dialog>
      )}
    </GlassPanel>
  );
}

// ─── Bible tab ──────────────────────────────────────────────────────────────

interface BibleTabProps {
  bible: CharacterBibleDoc | null;
  bladeSoul: string;
  onEdit: (section: keyof CharacterBibleDoc, label: string, content: string) => void;
}

function BibleTab({ bible, bladeSoul, onEdit }: BibleTabProps) {
  if (!bible) {
    return (
      <div className="identity-empty" data-testid="soul-bible-empty">
        No bible content yet. Hit "Refresh Bible" above to consolidate the first pass.
      </div>
    );
  }

  const lastUpdated = bible.last_updated ?? '';

  return (
    <div data-testid="soul-bible-content">
      {BIBLE_SECTIONS.map(({ id, label }) => {
        const content = (bible[id] as string | undefined) ?? '';
        return (
          <article className="identity-section" key={id} data-section={id}>
            <header className="identity-section-header">
              <h3 className="identity-section-title">{label}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onEdit(id, label, content)}
                aria-label={`Edit ${label}`}
              >
                Edit
              </Button>
            </header>
            {content.trim().length > 0 ? (
              <p className="identity-section-content">{content}</p>
            ) : (
              <p className="identity-section-content identity-section-content--empty">
                Empty. Click Edit to write this section.
              </p>
            )}
          </article>
        );
      })}

      <article className="identity-section" data-section="blade-soul">
        <header className="identity-section-header">
          <h3 className="identity-section-title">BLADE's self-characterization</h3>
        </header>
        {bladeSoul.trim().length > 0 ? (
          <p className="identity-section-content">{bladeSoul}</p>
        ) : (
          <p className="identity-section-content identity-section-content--empty">
            BLADE has not yet written a soul body.
          </p>
        )}
      </article>

      {lastUpdated.length > 0 && (
        <p className="identity-surface-sub">Last consolidated: {lastUpdated}</p>
      )}
    </div>
  );
}

// ─── Profile tab ────────────────────────────────────────────────────────────

function ProfileTab({ profile }: { profile: UserProfile | null }) {
  if (!profile) {
    return (
      <div className="identity-empty">Profile has not loaded yet.</div>
    );
  }
  return (
    <div data-testid="soul-profile-content">
      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">User</h3>
        </header>
        <p className="identity-section-content">
          {profile.user_name || '(name not set)'}
        </p>
      </article>
      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">Persona (markdown)</h3>
        </header>
        {profile.persona_md.trim().length > 0 ? (
          <p className="identity-section-content">{profile.persona_md}</p>
        ) : (
          <p className="identity-section-content identity-section-content--empty">
            No persona content yet.
          </p>
        )}
      </article>
      <article className="identity-section">
        <header className="identity-section-header">
          <h3 className="identity-section-title">Current activity context</h3>
        </header>
        {profile.activity_context.trim().length > 0 ? (
          <p className="identity-section-content">{profile.activity_context}</p>
        ) : (
          <p className="identity-section-content identity-section-content--empty">
            No active context right now.
          </p>
        )}
      </article>
      {profile.knowledge_nodes.length > 0 && (
        <article className="identity-section">
          <header className="identity-section-header">
            <h3 className="identity-section-title">Knowledge nodes ({profile.knowledge_nodes.length})</h3>
          </header>
          <ul className="persona-trait-evidence-list">
            {profile.knowledge_nodes.slice(0, 12).map((node) => (
              <li key={node.id}>
                <strong>{node.label}</strong> — {node.description}
              </li>
            ))}
          </ul>
        </article>
      )}
    </div>
  );
}

// ─── Preferences tab ────────────────────────────────────────────────────────

interface PreferencesTabProps {
  preferences: BrainPreference[];
  onRequestDelete: (p: BrainPreference) => void;
}

function PreferencesTab({ preferences, onRequestDelete }: PreferencesTabProps) {
  if (preferences.length === 0) {
    return (
      <div className="identity-empty" data-testid="soul-preferences-empty">
        No preferences stored yet. Preferences are written by{' '}
        <code>consolidate_reactions_to_preferences</code> or by direct chat feedback.
      </div>
    );
  }
  return (
    <div className="identity-list" data-testid="soul-preferences-content">
      {preferences.map((p) => (
        <div className="identity-list-row" key={p.id}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span className="identity-list-row-primary">{p.key ?? p.id}</span>
            {p.value && <span className="identity-list-row-secondary">{p.value}</span>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRequestDelete(p)}
            aria-label={`Delete preference ${p.key ?? p.id}`}
          >
            Delete
          </Button>
        </div>
      ))}
    </div>
  );
}
