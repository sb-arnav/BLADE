// src/features/identity/CharacterBible.tsx
//
// Identity cluster — Character Bible route (IDEN-03). Satisfies ROADMAP SC-4
// pragmatically (D-155): renders the consolidated bible + honest deferral card
// for the trait-evolution log + consolidate actions + section editor.
//
// The thumbs-up/down → trait update round-trip still flows (Phase 3 feature is
// untouched); operator verifies via M-25 — send chat message + thumbs-up, then
// navigate to /persona to see updated score. A backend-readable "trait
// evolution log" would require a new Rust reader command (D-140 forbids that
// in Phase 6), so we ship an honest deferral card pointing to /persona.
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-155
// @see src/lib/tauri/identity.ts (character_* wrappers)

import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog, GlassPanel, GlassSpinner } from '@/design-system/primitives';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import {
  consolidateCharacter,
  consolidateReactionsToPreferences,
  getCharacterBible,
  updateCharacterSection,
} from '@/lib/tauri/identity';
import type { CharacterBible as CharacterBibleDoc } from './types';
import { EditSectionDialog } from './EditSectionDialog';
import './identity.css';
import './identity-rich-a.css';

// Ordered bible sections (same as SoulView).
const BIBLE_SECTIONS: Array<{ id: keyof CharacterBibleDoc; label: string }> = [
  { id: 'identity',    label: 'Identity' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'projects',    label: 'Projects' },
  { id: 'skills',      label: 'Skills' },
  { id: 'contacts',    label: 'Contacts' },
  { id: 'notes',       label: 'Notes' },
];

function consolidatedBibleText(bible: CharacterBibleDoc): string {
  return BIBLE_SECTIONS.map(({ id, label }) => {
    const content = (bible[id] as string | undefined) ?? '';
    const body = content.trim().length > 0 ? content : '(empty)';
    return `## ${label}\n\n${body}`;
  }).join('\n\n');
}

export function CharacterBible() {
  const router = useRouterCtx();
  const toast = useToast();

  const [bible, setBible] = useState<CharacterBibleDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'consolidate' | 'reactions' | null>(null);

  const [editing, setEditing] = useState<{
    section: keyof CharacterBibleDoc;
    label: string;
    content: string;
  } | null>(null);

  const [confirm, setConfirm] = useState<'consolidate' | 'reactions' | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const b = await getCharacterBible();
      setBible(b);
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

  const runConsolidate = async () => {
    setBusy('consolidate');
    setConfirm(null);
    try {
      const res = await consolidateCharacter();
      toast.show({
        type: 'success',
        title: 'Character consolidated',
        message: res.length > 120 ? `${res.slice(0, 120)}…` : res,
      });
      await reload();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Consolidate failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const runReactions = async () => {
    setBusy('reactions');
    setConfirm(null);
    try {
      const n = await consolidateReactionsToPreferences();
      toast.show({
        type: 'success',
        title: 'Reactions consolidated',
        message: `${n} preference${n === 1 ? '' : 's'} written`,
      });
      await reload();
    } catch (e) {
      toast.show({
        type: 'error',
        title: 'Reaction consolidate failed',
        message: typeof e === 'string' ? e : String(e),
      });
    } finally {
      setBusy(null);
    }
  };

  const handleEditSave = async (content: string) => {
    if (!editing) return;
    await updateCharacterSection({ section: String(editing.section), content });
    await reload();
  };

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="character-bible-root">
      <header className="identity-surface-header">
        <div>
          <h1 className="identity-surface-title">Character Bible</h1>
          <p className="identity-surface-sub">
            Consolidated identity document maintained by character.rs — sections, feedback
            preferences, and trait evolution.
          </p>
        </div>
      </header>

      <div className="identity-actions-row">
        <Button
          variant="secondary"
          onClick={() => setConfirm('consolidate')}
          disabled={busy !== null || loading}
          data-testid="character-consolidate"
        >
          {busy === 'consolidate' ? 'Consolidating…' : 'Consolidate'}
        </Button>
        <Button
          variant="secondary"
          onClick={() => setConfirm('reactions')}
          disabled={busy !== null || loading}
          data-testid="character-reactions"
        >
          {busy === 'reactions' ? 'Writing…' : 'Reactions → preferences'}
        </Button>
      </div>

      {loading && !bible && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--s-6)' }}>
          <GlassSpinner />
        </div>
      )}

      {error && (
        <div className="identity-deferred-card" role="status" style={{ marginBottom: 'var(--s-3)' }}>
          <p><strong>Bible load failed.</strong></p>
          <p>{error}</p>
        </div>
      )}

      {bible && (
        <>
          {/* Consolidated scrollable view — the canonical rendering per SC-3/SC-4. */}
          <pre
            className="character-bible-content"
            data-testid="character-bible-content"
          >
            {consolidatedBibleText(bible)}
          </pre>

          {/* Honest deferral card — D-155 — trait evolution log. */}
          <div className="identity-deferred-card" data-testid="trait-log-deferred">
            <p>
              <strong>Trait evolution log — ships in Phase 9 polish</strong>
            </p>
            <p>
              Chat thumbs-up/down updates are LIVE today — the round-trip is observable from{' '}
              <code>apply_reaction_to_traits</code> → <code>persona_get_traits</code> (M-25). A
              historical log view would need a new reader command, which is outside Phase 6 scope
              (zero-Rust invariant, D-140).
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.openRoute('persona')}
              data-testid="character-open-persona"
            >
              Open Persona → Traits →
            </Button>
          </div>

          {/* Per-section editors — same editing recipe as SoulView (D-153 flow). */}
          <div data-testid="character-bible-sections">
            {BIBLE_SECTIONS.map(({ id, label }) => {
              const content = (bible[id] as string | undefined) ?? '';
              return (
                <article className="identity-section" key={id} data-section={id}>
                  <header className="identity-section-header">
                    <h3 className="identity-section-title">{label}</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditing({ section: id, label, content })}
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
          </div>

          {bible.last_updated && (
            <p className="identity-surface-sub">Last consolidated: {bible.last_updated}</p>
          )}
        </>
      )}

      {editing && (
        <EditSectionDialog
          open={true}
          title={editing.label}
          initialContent={editing.content}
          onClose={() => setEditing(null)}
          onSave={handleEditSave}
        />
      )}

      {confirm && (
        <Dialog
          open={true}
          onClose={() => (busy ? undefined : setConfirm(null))}
          ariaLabel={
            confirm === 'consolidate'
              ? 'Confirm character consolidation'
              : 'Confirm reactions-to-preferences'
          }
        >
          <h3 className="identity-edit-dialog-title">
            {confirm === 'consolidate' ? 'Consolidate character?' : 'Consolidate reactions?'}
          </h3>
          <p style={{ color: 'var(--t-2)', fontSize: 13, lineHeight: 1.5 }}>
            {confirm === 'consolidate'
              ? 'Runs the full consolidation pass over all sections. Safe; idempotent.'
              : 'Transfers accumulated chat reactions into structured preferences.'}
          </p>
          <div className="identity-edit-dialog-actions">
            <Button variant="ghost" onClick={() => setConfirm(null)} disabled={busy !== null}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={confirm === 'consolidate' ? runConsolidate : runReactions}
              disabled={busy !== null}
            >
              {busy !== null ? 'Running…' : 'Confirm'}
            </Button>
          </div>
        </Dialog>
      )}
    </GlassPanel>
  );
}
