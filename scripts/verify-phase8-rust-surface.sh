#!/usr/bin/env bash
# scripts/verify-phase8-rust-surface.sh — Phase 8 Plan 08-05 regression guard.
#
# Greps src-tauri/src/lib.rs for every Phase 8 Rust command required by the
# body + hive cluster frontend wrappers (D-196 inventory). Fails if any
# command is missing from the generate_handler![] registration — catches
# accidental un-registration on future Rust refactors (D-200 defensive check).
#
# Phase 8 ships zero new Rust; every command here is already registered as of
# Plan 08-02 wrapper calibration. This script defends the surface for Phase 9+.
#
# Runtime: ~80ms (single grep pass over lib.rs).
#
# @see .planning/phases/08-body-hive/08-CONTEXT.md §D-196, §D-200
# @see .planning/phases/08-body-hive/08-PATTERNS.md §8
# @see .planning/phases/08-body-hive/08-05-PLAN.md Task 2

set -euo pipefail

LIB_RS="src-tauri/src/lib.rs"

if [ ! -f "$LIB_RS" ]; then
  echo "[verify-phase8-rust-surface] ERROR: $LIB_RS not found; wrong cwd?" >&2
  exit 2
fi

MISSING=()

check() {
  # Allow either `mod::cmd,` or `mod::cmd` (the register macro accepts both).
  if ! grep -Eq "(^|[^a-zA-Z_])$1([, \n]|$)" "$LIB_RS"; then
    MISSING+=("$1")
  fi
}

# ─────────────────────────────────────────────────────────────────────
# Body — body_registry (3)  — BodyMap + BodySystemDetail
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'body_registry::body_get_map' \
  'body_registry::body_get_system' \
  'body_registry::body_get_summary'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — homeostasis (4)  — HormoneBus (D-75 wrapper already shipped Phase 3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'homeostasis::homeostasis_get' \
  'homeostasis::homeostasis_get_directive' \
  'homeostasis::homeostasis_get_circadian' \
  'homeostasis::homeostasis_relearn_circadian'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — organ (4)  — OrganRegistry + Hive per-tentacle autonomy (cross-cluster)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'organ::organ_get_registry' \
  'organ::organ_get_roster' \
  'organ::organ_set_autonomy' \
  'organ::organ_get_autonomy'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — dna (4)  — DNA route (Identity/Goals/Patterns/Query tabs)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'dna::dna_get_identity' \
  'dna::dna_get_goals' \
  'dna::dna_get_patterns' \
  'dna::dna_query'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — world_model (3)  — WorldModel route (git / processes / ports tabs)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'world_model::world_get_state' \
  'world_model::world_get_summary' \
  'world_model::world_refresh'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — cardiovascular (3)  — BodySystemDetail cardio drill-in
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'cardiovascular::cardio_get_blood_pressure' \
  'cardiovascular::cardio_get_event_registry' \
  'cardiovascular::blade_vital_signs'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — urinary + immune (2)  — BodySystemDetail urinary/immune drill-in
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'urinary::urinary_flush' \
  'urinary::immune_get_status'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — reproductive (2)  — BodySystemDetail identity drill-in + spawn
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'reproductive::reproductive_get_dna' \
  'reproductive::reproductive_spawn'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Body — joints (2)  — BodySystemDetail skeleton drill-in
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'joints::joints_list_providers' \
  'joints::joints_list_stores'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Hive — hive (8)  — HiveMesh + TentacleDetail + AutonomyControls + ApprovalQueue
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'hive::hive_start' \
  'hive::hive_stop' \
  'hive::hive_get_status' \
  'hive::hive_get_digest' \
  'hive::hive_spawn_tentacle' \
  'hive::hive_get_reports' \
  'hive::hive_approve_decision' \
  'hive::hive_set_autonomy'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Hive — ai_delegate (2)  — AiDelegate route
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'ai_delegate::ai_delegate_introduce' \
  'ai_delegate::ai_delegate_check'
do check "$cmd"; done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[verify-phase8-rust-surface] ERROR: ${#MISSING[@]} Phase 8 Rust command(s) missing from $LIB_RS:" >&2
  for m in "${MISSING[@]}"; do
    echo "  - $m" >&2
  done
  echo "" >&2
  echo "Phase 8 ships zero new Rust; every command in D-196 inventory must stay registered." >&2
  echo "Re-add the missing handler(s) to the generate_handler![] in $LIB_RS." >&2
  exit 1
fi

echo "[verify-phase8-rust-surface] OK — all 37 Phase 8 Rust commands registered in $LIB_RS."
