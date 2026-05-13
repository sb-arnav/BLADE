#!/usr/bin/env bash
# scripts/verify-feature-cluster-routes.sh — Phase 5 + 6 + 7 + 8 regression guard.
#
# Asserts that the agents + knowledge + life-os + identity + dev-tools + admin
# + body + hive cluster feature indexes lazy-import real per-route components
# (NOT ComingSoonSkeleton stubs), and that every Phase 5 + 6 + 7 + 8 per-route
# file exists on disk. Catches accidental reversion to skeletons or route-file
# deletion on future refactors (D-122 / D-143 / D-170 / D-199 single-writer +
# D-120 / D-141 / D-168 / D-197 real surface invariants).
#
# Runtime: ~100ms (a few greps + existence checks).
#
# @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-120, §D-122
# @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2
# @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-141, §D-143
# @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 2
# @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-168, §D-170
# @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 2
# @see .planning/phases/08-body-hive/08-CONTEXT.md §D-197, §D-199
# @see .planning/phases/08-body-hive/08-05-PLAN.md Task 2

set -euo pipefail

AGENTS_INDEX="src/features/agents/index.tsx"
KNOWLEDGE_INDEX="src/features/knowledge/index.tsx"
LIFEOS_INDEX="src/features/life-os/index.tsx"
IDENTITY_INDEX="src/features/identity/index.tsx"
DEVTOOLS_INDEX="src/features/dev-tools/index.tsx"
ADMIN_INDEX="src/features/admin/index.tsx"
BODY_INDEX="src/features/body/index.tsx"
HIVE_INDEX="src/features/hive/index.tsx"

for idx in "$AGENTS_INDEX" "$KNOWLEDGE_INDEX" "$LIFEOS_INDEX" "$IDENTITY_INDEX" "$DEVTOOLS_INDEX" "$ADMIN_INDEX" "$BODY_INDEX" "$HIVE_INDEX"; do
  if [ ! -f "$idx" ]; then
    echo "[verify-feature-cluster-routes] ERROR: cluster index file missing: $idx" >&2
    exit 2
  fi
done

ERRORS=0

for f in "$AGENTS_INDEX" "$KNOWLEDGE_INDEX" "$LIFEOS_INDEX" "$IDENTITY_INDEX" "$DEVTOOLS_INDEX" "$ADMIN_INDEX" "$BODY_INDEX" "$HIVE_INDEX"; do
  # D-120 / D-168: cluster indexes ship real lazy imports; ComingSoonSkeleton
  # must be gone. Strip // line comments before grepping so header prose
  # mentioning the class name doesn't false-positive.
  if sed 's|//.*$||' "$f" | grep -q 'ComingSoonSkeleton'; then
    echo "[verify-feature-cluster-routes] ERROR: $f still references ComingSoonSkeleton in code" >&2
    echo "  Phase 5/6/7/8 replaced skeletons with real lazy imports (D-120, D-141, D-168, D-197)." >&2
    ERRORS=$((ERRORS + 1))
  fi
  # Must use React.lazy for per-route component imports.
  if ! grep -q 'lazy(() => import' "$f"; then
    echo "[verify-feature-cluster-routes] ERROR: $f has no React.lazy imports" >&2
    echo "  Cluster indexes lazy-import per-route files." >&2
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
  # FinanceView removed by v1.6 chore commit ae54a15 (financial_brain cut, VISION list #1).
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
  # SidecarView removed by v1.6 chore commit aa789f7 (deep_scan + ecosystem auto-enable cut, VISION list #7).
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

# ─────────────────────────────────────────────────────────────────────
# Per-route file existence — 10 dev-tools + 11 admin routes (D-170 layout).
# Phase 7 ships 10+11 real per-route files owned exclusively by each plan's
# lane (Plan 07-03 / 07-04 / 07-05 / 07-06). Plan 07-02 owns the two cluster
# index files as sole writer (D-170). Placeholder reversion on any file would
# fail this guard.
# ─────────────────────────────────────────────────────────────────────
DEVTOOLS_FILES=(
  "Terminal"
  "FileBrowser"
  "GitPanel"
  "Canvas"
  # WorkflowBuilder removed by v1.6 chore commit 2686761 (workflow_builder cut, VISION list #5).
  "WebAutomation"
  "EmailAssistant"
  "DocumentGenerator"
  "CodeSandbox"
  "ComputerUse"
)
for name in "${DEVTOOLS_FILES[@]}"; do
  path="src/features/dev-tools/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 7 Plan 07-03 / 07-04 (D-170)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

ADMIN_FILES=(
  "Analytics"
  "CapabilityReports"
  "Reports"
  "DecisionLog"
  # SecurityDashboard removed by v1.6 chore commit 7083d14 (security_monitor cut, VISION list #3).
  "Temporal"
  "Diagnostics"
  "IntegrationStatus"
  "McpSettings"
  "ModelComparison"
  "KeyVault"
)
for name in "${ADMIN_FILES[@]}"; do
  path="src/features/admin/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 7 Plan 07-05 / 07-06 (D-170)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

# ─────────────────────────────────────────────────────────────────────
# Per-route file existence — 6 body + 5 hive routes (D-210 layout).
# Phase 8 ships 6+5 real per-route files owned exclusively by each plan's
# lane (Plan 08-03 owns body/, Plan 08-04 owns hive/). Plan 08-02 is the
# sole writer of the two cluster index.tsx files (D-199). Placeholder
# reversion on any file would fail this guard.
# ─────────────────────────────────────────────────────────────────────
BODY_FILES=(
  "BodyMap"
  "BodySystemDetail"
  "HormoneBus"
  "OrganRegistry"
  "DNA"
  "WorldModel"
)
for name in "${BODY_FILES[@]}"; do
  path="src/features/body/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 8 Plan 08-03 (D-210)." >&2
    ERRORS=$((ERRORS + 1))
  elif ! grep -q "export function $name" "$path" && ! grep -q "export const $name" "$path"; then
    echo "[verify-feature-cluster-routes] ERROR: $path does not export named component \`$name\`" >&2
    ERRORS=$((ERRORS + 1))
  fi
done

HIVE_FILES=(
  "HiveMesh"
  "TentacleDetail"
  "AutonomyControls"
  "ApprovalQueue"
  "AiDelegate"
)
for name in "${HIVE_FILES[@]}"; do
  path="src/features/hive/${name}.tsx"
  if [ ! -f "$path" ]; then
    echo "[verify-feature-cluster-routes] ERROR: missing $path" >&2
    echo "  Required by Phase 8 Plan 08-04 (D-210)." >&2
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

echo "[verify-feature-cluster-routes] OK — all 66 Phase 5+6+7+8 routes present; clusters wired via lazy imports."
