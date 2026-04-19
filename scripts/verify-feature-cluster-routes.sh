#!/usr/bin/env bash
# scripts/verify-feature-cluster-routes.sh — Phase 5 + Phase 6 regression guard.
#
# Asserts that the agents + knowledge + life-os + identity cluster feature
# indexes lazy-import real per-route components (NOT ComingSoonSkeleton stubs),
# and that every Phase 5 + Phase 6 per-route file exists on disk. Catches
# accidental reversion to skeletons or route-file deletion on future refactors
# (D-122 / D-143 single-writer + D-120 / D-141 real surface invariants).
#
# Runtime: ~50ms (a few greps + existence checks).
#
# @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-120, §D-122
# @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2
# @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-141, §D-143
# @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 2

set -euo pipefail

AGENTS_INDEX="src/features/agents/index.tsx"
KNOWLEDGE_INDEX="src/features/knowledge/index.tsx"
LIFEOS_INDEX="src/features/life-os/index.tsx"
IDENTITY_INDEX="src/features/identity/index.tsx"

for idx in "$AGENTS_INDEX" "$KNOWLEDGE_INDEX" "$LIFEOS_INDEX" "$IDENTITY_INDEX"; do
  if [ ! -f "$idx" ]; then
    echo "[verify-feature-cluster-routes] ERROR: cluster index file missing: $idx" >&2
    exit 2
  fi
done

ERRORS=0

for f in "$AGENTS_INDEX" "$KNOWLEDGE_INDEX" "$LIFEOS_INDEX" "$IDENTITY_INDEX"; do
  # D-120: Phase 5 ships real lazy imports; ComingSoonSkeleton must be gone.
  # Strip // line comments before grepping so header prose mentioning the
  # class name doesn't false-positive.
  if sed 's|//.*$||' "$f" | grep -q 'ComingSoonSkeleton'; then
    echo "[verify-feature-cluster-routes] ERROR: $f still references ComingSoonSkeleton in code" >&2
    echo "  Phase 5 replaced skeletons with real lazy imports (D-120, D-122)." >&2
    ERRORS=$((ERRORS + 1))
  fi
  # Must use React.lazy for per-route component imports.
  if ! grep -q 'lazy(() => import' "$f"; then
    echo "[verify-feature-cluster-routes] ERROR: $f has no React.lazy imports" >&2
    echo "  Phase 5 cluster indexes lazy-import 9 per-route files each." >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# ─────────────────────────────────────────────────────────────────────
# Per-route file existence — 9 agents + 9 knowledge routes (D-131 layout)
# ─────────────────────────────────────────────────────────────────────
AGENT_FILES=(
  "AgentDashboard"
  "AgentDetail"
  "AgentFactory"
  "AgentTeam"
  "AgentTimeline"
  "BackgroundAgents"
  "TaskAgents"
  "SwarmView"
  "AgentPixelWorld"
)
for name in "${AGENT_FILES[@]}"; do
  path="src/features/agents/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 5 Plan 05-03 / 05-04 (D-131)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

KNOWLEDGE_FILES=(
  "KnowledgeBase"
  "KnowledgeGraph"
  "MemoryPalace"
  "ScreenTimeline"
  "RewindTimeline"
  "LiveNotes"
  "DailyLog"
  "ConversationInsights"
  "CodebaseExplorer"
)
for name in "${KNOWLEDGE_FILES[@]}"; do
  path="src/features/knowledge/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 5 Plan 05-05 / 05-06 (D-131)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# ─────────────────────────────────────────────────────────────────────
# Per-route file existence — 9 life-os + 7 identity routes (D-163 layout).
# Phase 6 ships 9+7 (not 10+9) per D-139 scope discipline; orphan reqs
# LIFE-10 / IDEN-08 / IDEN-09 flagged for the Phase 6 retrospective (DP-3).
# ─────────────────────────────────────────────────────────────────────
LIFEOS_FILES=(
  "HealthView"
  "FinanceView"
  "GoalView"
  "HabitView"
  "MeetingsView"
  "SocialGraphView"
  "PredictionsView"
  "EmotionalIntelView"
  "AccountabilityView"
)
for name in "${LIFEOS_FILES[@]}"; do
  path="src/features/life-os/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 6 Plan 06-02 / 06-03 / 06-04 (D-163)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

IDENTITY_FILES=(
  "SoulView"
  "PersonaView"
  "CharacterBible"
  "NegotiationView"
  "ReasoningView"
  "ContextEngineView"
  "SidecarView"
)
for name in "${IDENTITY_FILES[@]}"; do
  path="src/features/identity/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 6 Plan 06-02 / 06-05 / 06-06 (D-163)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "[verify-feature-cluster-routes] FAIL — $ERRORS error(s) above" >&2
  exit 1
fi

echo "[verify-feature-cluster-routes] OK — all 34 Phase 5+6 routes present; clusters wired via lazy imports."
