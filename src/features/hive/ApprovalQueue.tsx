// src/features/hive/ApprovalQueue.tsx — Plan 08-02 placeholder (HIVE-04).
// Real implementation lands in Plan 08-04.
//
// @see .planning/phases/08-body-hive/08-02-PLAN.md (Task 3)
// @see .planning/REQUIREMENTS.md §HIVE-04

import { GlassPanel } from '@/design-system/primitives';
import './hive.css';

export function ApprovalQueue() {
  return (
    <GlassPanel className="approval-queue" data-testid="approval-queue-root">
      <h2>Approval Queue</h2>
      <p>Ships in Plan 08-04 (HIVE-04).</p>
    </GlassPanel>
  );
}
