// src/features/life-os/HabitView.tsx — placeholder shipped by Plan 06-02.
// Real body ships in Plan 06-03 (D-147 — today checklist + complete/skip + design suggest).
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-147
import { GlassPanel } from '@/design-system/primitives';
import './life-os.css';

export function HabitView() {
  return (
    <GlassPanel tier={1} className="life-surface">
      <div className="life-placeholder" data-testid="habit-view-placeholder">
        <h2>Habits</h2>
        <p className="life-placeholder-hint">Ships in Plan 06-03.</p>
      </div>
    </GlassPanel>
  );
}
