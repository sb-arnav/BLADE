// src/features/hive/HiveMesh.tsx — Plan 08-02 placeholder (HIVE-01).
// Real implementation lands in Plan 08-04.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §HIVE-01

import { GlassPanel } from '@/design-system/primitives';
import './hive.css';

export function HiveMesh() {
  return (
    <GlassPanel className="hive-mesh" data-testid="hive-mesh-root">
      <h2>Hive</h2>
      <p>Ships in Plan 08-04 (HIVE-01).</p>
    </GlassPanel>
  );
}
