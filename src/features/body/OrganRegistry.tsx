// src/features/body/OrganRegistry.tsx — Plan 08-02 placeholder (BODY-04).
// Real implementation lands in Plan 08-03.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §BODY-04

import { GlassPanel } from '@/design-system/primitives';
import './body.css';

export function OrganRegistry() {
  return (
    <GlassPanel className="organ-registry" data-testid="organ-registry-root">
      <h2>Organ Registry</h2>
      <p>Ships in Plan 08-03 (BODY-04).</p>
    </GlassPanel>
  );
}
