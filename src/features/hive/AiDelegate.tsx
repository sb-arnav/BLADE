// src/features/hive/AiDelegate.tsx — Plan 08-02 placeholder (HIVE-06).
// Real implementation lands in Plan 08-04.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §HIVE-06

import { GlassPanel } from '@/design-system/primitives';
import './hive.css';

export function AiDelegate() {
  return (
    <GlassPanel className="ai-delegate" data-testid="ai-delegate-root">
      <h2>AI Delegate</h2>
      <p>Ships in Plan 08-04 (HIVE-06).</p>
    </GlassPanel>
  );
}
