#!/usr/bin/env bash
# scripts/verify-empty-state-coverage.sh — Phase 9 Plan 09-06 (POL-02).
#
# Regression guard for Plans 09-02 Task 3 + 09-04 Task 3 (D-217 coverage
# table). Asserts every feature route with a zero-data surface imports
# EmptyState from the primitives barrel. Catches silent regressions where
# a future refactor deletes the EmptyState import + swaps for a raw span.
#
# REQUIRED_FILES: the union of Plan 09-02 (core clusters — agents, knowledge,
# life-os, identity, dev-tools, admin) + Plan 09-04 (body, hive, + remaining
# admin) empty-state sweeps, 41 files total. Excludes Dashboard (uses
# ComingSoonCard per D-217) and Chat (composer-first layout).
#
# Exit: 0 on pass, 1 if any file missing or missing EmptyState import.
# Runtime: ~40ms (41 file reads + grep).
#
# @see .planning/phases/09-polish/09-PATTERNS.md §8
# @see .planning/phases/09-polish/09-CONTEXT.md §D-217

set -euo pipefail

REQUIRED_FILES=(
  # Agents cluster (3)
  src/features/agents/AgentDashboard.tsx
  src/features/agents/SwarmView.tsx
  src/features/agents/AgentDetail.tsx
  # Knowledge cluster (2)
  src/features/knowledge/KnowledgeBase.tsx
  src/features/knowledge/ScreenTimeline.tsx
  # Life OS cluster (8 — FinanceView cut by v1.6 commit ae54a15, VISION list #1)
  src/features/life-os/HealthView.tsx
  src/features/life-os/GoalView.tsx
  src/features/life-os/HabitView.tsx
  src/features/life-os/MeetingsView.tsx
  src/features/life-os/PredictionsView.tsx
  src/features/life-os/SocialGraphView.tsx
  src/features/life-os/AccountabilityView.tsx
  src/features/life-os/EmotionalIntelView.tsx
  # Identity cluster (6 — SidecarView cut by v1.6 commit aa789f7, VISION list #7)
  src/features/identity/CharacterBible.tsx
  src/features/identity/SoulView.tsx
  src/features/identity/PersonaView.tsx
  src/features/identity/ReasoningView.tsx
  src/features/identity/NegotiationView.tsx
  src/features/identity/ContextEngineView.tsx
  # Dev-tools cluster (1 — Terminal excluded per D-217)
  src/features/dev-tools/FileBrowser.tsx
  # Admin cluster (9 — SecurityDashboard cut by v1.6 commit 7083d14, VISION list #3)
  src/features/admin/Analytics.tsx
  src/features/admin/CapabilityReports.tsx
  src/features/admin/DecisionLog.tsx
  src/features/admin/Diagnostics.tsx
  src/features/admin/IntegrationStatus.tsx
  src/features/admin/McpSettings.tsx
  src/features/admin/ModelComparison.tsx
  src/features/admin/KeyVault.tsx
  src/features/admin/Reports.tsx
  src/features/admin/Temporal.tsx
  # Body cluster (4 — BodyMap + HormoneBus excluded per D-217, always populated)
  src/features/body/BodySystemDetail.tsx
  src/features/body/OrganRegistry.tsx
  src/features/body/DNA.tsx
  src/features/body/WorldModel.tsx
  # Hive cluster (4 — AutonomyControls excluded per D-217, matrix always present)
  src/features/hive/HiveMesh.tsx
  src/features/hive/TentacleDetail.tsx
  src/features/hive/ApprovalQueue.tsx
  src/features/hive/AiDelegate.tsx
)

MISSING=()

for f in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$f" ]; then
    MISSING+=("$f: FILE MISSING")
    continue
  fi
  if ! grep -q "EmptyState" "$f"; then
    MISSING+=("$f: no EmptyState reference")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[verify-empty-state-coverage] FAIL — ${#MISSING[@]} issue(s):" >&2
  for m in "${MISSING[@]}"; do
    echo "  - $m" >&2
  done
  echo "" >&2
  echo "Every D-217 coverage-table route MUST import EmptyState from" >&2
  echo "'@/design-system/primitives' and render it on zero-data surfaces." >&2
  exit 1
fi

echo "[verify-empty-state-coverage] OK — all ${#REQUIRED_FILES[@]} D-217 coverage files carry EmptyState."
