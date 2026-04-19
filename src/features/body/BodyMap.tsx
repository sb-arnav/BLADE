// src/features/body/BodyMap.tsx — Plan 08-02 placeholder (BODY-01).
// Real implementation lands in Plan 08-03. Keeping this thin so the cluster
// route registry resolves; Plan 08-05 Playwright spec asserts body-map-root.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §BODY-01

import { GlassPanel } from '@/design-system/primitives';
import './body.css';

export function BodyMap() {
  return (
    <GlassPanel className="body-map" data-testid="body-map-root">
      <h2>Body Map</h2>
      <p>Ships in Plan 08-03 (BODY-01).</p>
    </GlassPanel>
  );
}
