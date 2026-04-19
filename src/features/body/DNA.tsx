// src/features/body/DNA.tsx — Plan 08-02 placeholder (BODY-05).
// Real implementation lands in Plan 08-03.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §BODY-05

import { GlassPanel } from '@/design-system/primitives';
import './body.css';

export function DNA() {
  return (
    <GlassPanel className="dna" data-testid="dna-root">
      <h2>DNA</h2>
      <p>Ships in Plan 08-03 (BODY-05).</p>
    </GlassPanel>
  );
}
