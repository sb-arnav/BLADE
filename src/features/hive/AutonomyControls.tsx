// src/features/hive/AutonomyControls.tsx — Plan 08-02 placeholder (HIVE-03).
// Real implementation lands in Plan 08-04.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §HIVE-03

import { GlassPanel } from '@/design-system/primitives';
import './hive.css';

export function AutonomyControls() {
  return (
    <GlassPanel className="autonomy-controls" data-testid="hive-autonomy-root">
      <h2>Autonomy Controls</h2>
      <p>Ships in Plan 08-04 (HIVE-03).</p>
    </GlassPanel>
  );
}
