// src/features/identity/CharacterBible.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-05 (D-155 — bible text + consolidate + section edit).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-155
import { GlassPanel } from '@/design-system/primitives';
import './identity.css';

export function CharacterBible() {
  return (
    <GlassPanel tier={1} className="identity-surface">
      <div className="identity-placeholder" data-testid="character-bible-placeholder">
        <h2>Character Bible</h2>
        <p className="identity-placeholder-hint">Ships in Plan 06-05.</p>
      </div>
    </GlassPanel>
  );
}
