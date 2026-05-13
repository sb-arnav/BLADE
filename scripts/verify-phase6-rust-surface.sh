#!/usr/bin/env bash
# scripts/verify-phase6-rust-surface.sh — Phase 6 Plan 06-07 regression guard.
#
# Greps src-tauri/src/lib.rs for every Phase 6 Rust command required by the
# life-os + identity cluster frontend wrappers (D-140 inventory). Fails if any
# command is missing from the generate_handler![] registration — catches
# accidental un-registration on future Rust refactors (D-144 defensive check).
#
# Phase 6 ships zero new Rust; every command here is already registered as of
# Plan 06-02 wrapper calibration. This script defends the surface for future
# phases.
#
# Runtime: ~100ms (single grep pass over lib.rs).
#
# @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-140, §D-144
# @see .planning/phases/06-life-os-identity/06-07-PLAN.md Task 2

set -euo pipefail

LIB_RS="src-tauri/src/lib.rs"

if [ ! -f "$LIB_RS" ]; then
  echo "[verify-phase6-rust-surface] ERROR: $LIB_RS not found; wrong cwd?" >&2
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
# Life OS — health_tracker (9)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'health_tracker::health_log' \
  'health_tracker::health_get_today' \
  'health_tracker::health_update_today' \
  'health_tracker::health_get_logs' \
  'health_tracker::health_get_stats' \
  'health_tracker::health_get_insights' \
  'health_tracker::health_get_context' \
  'health_tracker::health_correlate_productivity' \
  'health_tracker::health_streak_info'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — health (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'health::health_get_scan' \
  'health::health_scan_now' \
  'health::health_summary_all'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — health_guardian: REMOVED by v1.6 chore commit b775857
# (VISION cut list #2 — Health Guardian vertical cut).
# ─────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────
# Life OS — financial_brain: REMOVED by v1.6 chore commit ae54a15
# (VISION cut list #1 — Financial Brain vertical cut).
# ─────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────
# Life OS — goal_engine (6)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'goal_engine::goal_add' \
  'goal_engine::goal_list' \
  'goal_engine::goal_complete' \
  'goal_engine::goal_delete' \
  'goal_engine::goal_update_priority' \
  'goal_engine::goal_pursue_now'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — habit_engine (10)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'habit_engine::habit_create' \
  'habit_engine::habit_list' \
  'habit_engine::habit_get' \
  'habit_engine::habit_complete' \
  'habit_engine::habit_skip' \
  'habit_engine::habit_get_logs' \
  'habit_engine::habit_get_today' \
  'habit_engine::habit_insights' \
  'habit_engine::habit_suggest_design' \
  'habit_engine::habit_get_context'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — meeting_intelligence (10)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'meeting_intelligence::meeting_process' \
  'meeting_intelligence::meeting_get' \
  'meeting_intelligence::meeting_list' \
  'meeting_intelligence::meeting_search' \
  'meeting_intelligence::meeting_delete' \
  'meeting_intelligence::meeting_get_action_items' \
  'meeting_intelligence::meeting_complete_action' \
  'meeting_intelligence::meeting_follow_up_email' \
  'meeting_intelligence::meeting_compare' \
  'meeting_intelligence::meeting_recurring_themes'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — social_graph (11)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'social_graph::social_add_contact' \
  'social_graph::social_get_contact' \
  'social_graph::social_search_contacts' \
  'social_graph::social_update_contact' \
  'social_graph::social_delete_contact' \
  'social_graph::social_list_contacts' \
  'social_graph::social_log_interaction' \
  'social_graph::social_get_interactions' \
  'social_graph::social_analyze_interaction' \
  'social_graph::social_get_insights' \
  'social_graph::social_how_to_approach'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — prediction_engine (6)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'prediction_engine::prediction_get_pending' \
  'prediction_engine::prediction_accept' \
  'prediction_engine::prediction_dismiss' \
  'prediction_engine::prediction_generate_now' \
  'prediction_engine::prediction_contextual' \
  'prediction_engine::prediction_get_patterns'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — emotional_intelligence (5)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'emotional_intelligence::emotion_get_current' \
  'emotional_intelligence::emotion_get_trend' \
  'emotional_intelligence::emotion_get_readings' \
  'emotional_intelligence::emotion_analyze_patterns' \
  'emotional_intelligence::emotion_get_context'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — accountability (8)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'accountability::accountability_get_objectives' \
  'accountability::accountability_create_objective' \
  'accountability::accountability_update_kr' \
  'accountability::accountability_daily_plan' \
  'accountability::accountability_complete_action' \
  'accountability::accountability_checkin' \
  'accountability::accountability_progress_report' \
  'accountability::accountability_get_daily_actions'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — streak_stats (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'streak_stats::streak_get_stats' \
  'streak_stats::streak_record_activity' \
  'streak_stats::streak_get_display'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — people_graph (7)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'people_graph::people_list' \
  'people_graph::people_get' \
  'people_graph::people_upsert' \
  'people_graph::people_delete' \
  'people_graph::people_suggest_reply_style' \
  'people_graph::people_learn_from_conversation' \
  'people_graph::people_get_context_for_prompt'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Life OS — learning_engine + temporal_intel (2)
# ─────────────────────────────────────────────────────────────────────
check 'learning_engine::learning_get_predictions'
check 'temporal_intel::temporal_meeting_prep'

# ─────────────────────────────────────────────────────────────────────
# Identity — character (7)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'character::consolidate_character' \
  'character::consolidate_reactions_to_preferences' \
  'character::reaction_instant_rule' \
  'character::blade_get_soul' \
  'character::get_character_bible' \
  'character::update_character_section' \
  'character::apply_reaction_to_traits'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — soul_commands (6)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'soul_commands::soul_get_state' \
  'soul_commands::soul_take_snapshot' \
  'soul_commands::soul_delete_preference' \
  'soul_commands::soul_update_bible_section' \
  'soul_commands::soul_refresh_bible' \
  'soul_commands::get_user_profile'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — persona_engine (12)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'persona_engine::persona_get_traits' \
  'persona_engine::persona_get_relationship' \
  'persona_engine::persona_update_trait' \
  'persona_engine::persona_get_context' \
  'persona_engine::persona_analyze_now' \
  'persona_engine::persona_record_outcome' \
  'persona_engine::persona_analyze_now_weekly' \
  'persona_engine::get_user_model' \
  'persona_engine::predict_next_need_cmd' \
  'persona_engine::get_expertise_map' \
  'persona_engine::update_expertise' \
  'persona_engine::persona_estimate_mood'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — negotiation_engine (11)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'negotiation_engine::negotiation_build_argument' \
  'negotiation_engine::negotiation_steelman' \
  'negotiation_engine::negotiation_find_common_ground' \
  'negotiation_engine::negotiation_start_debate' \
  'negotiation_engine::negotiation_round' \
  'negotiation_engine::negotiation_conclude' \
  'negotiation_engine::negotiation_analyze' \
  'negotiation_engine::negotiation_roleplay' \
  'negotiation_engine::negotiation_critique_move' \
  'negotiation_engine::negotiation_get_debates' \
  'negotiation_engine::negotiation_get_scenarios'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — reasoning_engine (5)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'reasoning_engine::reasoning_think' \
  'reasoning_engine::reasoning_decompose' \
  'reasoning_engine::reasoning_test_hypothesis' \
  'reasoning_engine::reasoning_socratic' \
  'reasoning_engine::reasoning_get_traces'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — context_engine (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'context_engine::context_assemble' \
  'context_engine::context_score_chunk' \
  'context_engine::context_clear_cache'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — sidecar (7)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'sidecar::sidecar_list_devices' \
  'sidecar::sidecar_register_device' \
  'sidecar::sidecar_remove_device' \
  'sidecar::sidecar_ping_device' \
  'sidecar::sidecar_run_command' \
  'sidecar::sidecar_run_all' \
  'sidecar::sidecar_start_server'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — personality_mirror (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'personality_mirror::personality_analyze' \
  'personality_mirror::personality_import_chats' \
  'personality_mirror::personality_get_profile'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Identity — kali: REMOVED by v1.6 chore commit c0bf13f
# (VISION cut list #4 — Pentest Mode incl. Kali tools vertical cut).
# ─────────────────────────────────────────────────────────────────────

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[verify-phase6-rust-surface] ERROR: ${#MISSING[@]} Phase 6 Rust command(s) missing from $LIB_RS:" >&2
  for m in "${MISSING[@]}"; do
    echo "  - $m" >&2
  done
  echo "" >&2
  echo "Phase 6 ships zero new Rust; every command in D-140 inventory must stay registered." >&2
  echo "Re-add the missing handler(s) to the generate_handler![] in $LIB_RS." >&2
  exit 1
fi

echo "[verify-phase6-rust-surface] OK — Phase 6 Rust commands registered in $LIB_RS (v1.6 narrowing: financial_brain + health_guardian + kali cut per VISION)."
