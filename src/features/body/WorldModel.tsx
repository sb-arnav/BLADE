// src/features/body/WorldModel.tsx — Plan 08-02 placeholder (BODY-06).
// Real implementation lands in Plan 08-03.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §BODY-06

import { GlassPanel } from '@/design-system/primitives';
import './body.css';

export function WorldModel() {
  return (
    <GlassPanel className="world-model" data-testid="world-model-root">
      <h2>World Model</h2>
      <p>Ships in Plan 08-03 (BODY-06).</p>
    </GlassPanel>
  );
}
