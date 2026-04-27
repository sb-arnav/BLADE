#!/usr/bin/env bash
# scripts/verify-phase7-rust-surface.sh — Phase 7 Plan 07-07 regression guard.
#
# Greps src-tauri/src/lib.rs for every Phase 7 Rust command required by the
# dev-tools + admin cluster frontend wrappers (D-167 inventory). Fails if any
# command is missing from the generate_handler![] registration — catches
# accidental un-registration on future Rust refactors (D-171 defensive check).
#
# Phase 7 ships zero new Rust; every command here is already registered as of
# Plan 07-02 wrapper calibration. This script defends the surface for future
# phases.
#
# Runtime: ~100ms (single grep pass over lib.rs).
#
# @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-167, §D-171
# @see .planning/phases/07-dev-tools-admin/07-07-PLAN.md Task 2

set -euo pipefail

LIB_RS="src-tauri/src/lib.rs"

if [ ! -f "$LIB_RS" ]; then
  echo "[verify-phase7-rust-surface] ERROR: $LIB_RS not found; wrong cwd?" >&2
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
# Dev Tools — native_tools (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'native_tools::run_code_block' \
  'native_tools::run_shell' \
  'native_tools::ask_ai'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — files (6)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'files::file_read' \
  'files::file_write' \
  'files::file_list' \
  'files::file_tree' \
  'files::file_exists' \
  'files::file_mkdir'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — file_indexer (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'file_indexer::file_index_scan_now' \
  'file_indexer::file_index_search' \
  'file_indexer::file_index_recent' \
  'file_indexer::file_index_stats'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — indexer (5)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'indexer::blade_index_project' \
  'indexer::blade_find_symbol' \
  'indexer::blade_list_indexed_projects' \
  'indexer::blade_reindex_file' \
  'indexer::blade_project_summary'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — git_style (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'git_style::git_style_mine' \
  'git_style::git_style_get' \
  'git_style::git_style_clear'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — code_sandbox (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'code_sandbox::sandbox_run' \
  'code_sandbox::sandbox_run_explain' \
  'code_sandbox::sandbox_fix_and_run' \
  'code_sandbox::sandbox_detect_language'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — workflow_builder (8)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'workflow_builder::workflow_list' \
  'workflow_builder::workflow_get' \
  'workflow_builder::workflow_create' \
  'workflow_builder::workflow_update' \
  'workflow_builder::workflow_delete' \
  'workflow_builder::workflow_run_now' \
  'workflow_builder::workflow_get_runs' \
  'workflow_builder::workflow_generate_from_description'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — browser_agent (2) + browser_native (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'browser_agent::browser_action' \
  'browser_agent::browser_agent_loop' \
  'browser_native::web_action' \
  'browser_native::browser_describe_page' \
  'browser_native::browser_session_status' \
  'browser_native::connect_to_user_browser'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — auto_reply (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'auto_reply::auto_reply_draft' \
  'auto_reply::auto_reply_learn_from_edit' \
  'auto_reply::auto_reply_draft_batch'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — document_intelligence (8)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'document_intelligence::doc_ingest' \
  'document_intelligence::doc_search' \
  'document_intelligence::doc_get' \
  'document_intelligence::doc_list' \
  'document_intelligence::doc_delete' \
  'document_intelligence::doc_answer_question' \
  'document_intelligence::doc_cross_synthesis' \
  'document_intelligence::doc_generate_study_notes'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — computer_use (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'computer_use::computer_use_task' \
  'computer_use::computer_use_stop' \
  'computer_use::computer_use_screenshot'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — automation (15)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'automation::auto_type_text' \
  'automation::auto_press_key' \
  'automation::auto_key_combo' \
  'automation::auto_mouse_move' \
  'automation::auto_get_mouse_position' \
  'automation::auto_mouse_click' \
  'automation::auto_mouse_click_relative' \
  'automation::auto_mouse_double_click' \
  'automation::auto_mouse_drag' \
  'automation::auto_scroll' \
  'automation::auto_open_url' \
  'automation::auto_open_path' \
  'automation::auto_launch_app' \
  'automation::auto_copy_to_clipboard' \
  'automation::auto_paste_clipboard'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — ui_automation (7)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'ui_automation::uia_get_active_window_snapshot' \
  'ui_automation::uia_describe_active_window' \
  'ui_automation::uia_click_element' \
  'ui_automation::uia_invoke_element' \
  'ui_automation::uia_focus_element' \
  'ui_automation::uia_set_element_value' \
  'ui_automation::uia_wait_for_element'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Dev Tools — reminders (5) + watcher (4) + cron (5)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'reminders::reminder_add' \
  'reminders::reminder_add_natural' \
  'reminders::reminder_list' \
  'reminders::reminder_delete' \
  'reminders::reminder_parse_time' \
  'watcher::watcher_add' \
  'watcher::watcher_list_all' \
  'watcher::watcher_remove' \
  'watcher::watcher_toggle' \
  'cron::cron_add' \
  'cron::cron_list' \
  'cron::cron_delete' \
  'cron::cron_toggle' \
  'cron::cron_run_now'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — commands (mcp + admin helpers — 14)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'commands::mcp_add_server' \
  'commands::mcp_install_catalog_server' \
  'commands::mcp_discover_tools' \
  'commands::mcp_call_tool' \
  'commands::mcp_get_tools' \
  'commands::mcp_get_servers' \
  'commands::mcp_remove_server' \
  'commands::mcp_server_status' \
  'commands::mcp_server_health' \
  'commands::test_provider' \
  'commands::debug_config' \
  'commands::set_config' \
  'commands::update_init_prefs' \
  'commands::reset_onboarding'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — permissions (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'permissions::classify_mcp_tool' \
  'permissions::set_tool_trust' \
  'permissions::reset_tool_trust' \
  'permissions::get_tool_overrides'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — db_commands analytics subset (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'db_commands::db_track_event' \
  'db_commands::db_events_since' \
  'db_commands::db_prune_analytics' \
  'db_commands::db_analytics_summary'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — reports (5)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'reports::report_gap' \
  'reports::get_reports' \
  'reports::update_report_status' \
  'reports::set_report_webhook' \
  'reports::get_report_webhook'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — self_upgrade (8)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'self_upgrade::self_upgrade_install' \
  'self_upgrade::self_upgrade_catalog' \
  'self_upgrade::self_upgrade_audit' \
  'pentest::pentest_authorize' \
  'pentest::pentest_check_auth' \
  'pentest::pentest_revoke' \
  'pentest::pentest_list_auth' \
  'pentest::pentest_check_model_safety'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — evolution (6) + immune_system (1)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'evolution::evolution_get_level' \
  'evolution::evolution_get_suggestions' \
  'evolution::evolution_dismiss_suggestion' \
  'evolution::evolution_install_suggestion' \
  'evolution::evolution_run_now' \
  'evolution::evolution_log_capability_gap' \
  'immune_system::immune_resolve_gap'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — decision_gate (3) + authority_engine (6) + audit (1)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'decision_gate::get_decision_log' \
  'decision_gate::decision_feedback' \
  'decision_gate::decision_evaluate' \
  'authority_engine::authority_get_agents' \
  'authority_engine::authority_get_audit_log' \
  'authority_engine::authority_get_delegations' \
  'authority_engine::authority_delegate' \
  'authority_engine::authority_route_and_run' \
  'authority_engine::authority_run_chain' \
  'audit::audit_get_log'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — security_monitor (9) + symbolic (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'security_monitor::security_scan_network' \
  'security_monitor::security_check_breach' \
  'security_monitor::security_check_password_hash' \
  'security_monitor::security_scan_sensitive_files' \
  'security_monitor::security_check_url' \
  'security_monitor::security_overview' \
  'security_monitor::security_run_audit' \
  'security_monitor::security_audit_deps' \
  'security_monitor::security_scan_code' \
  'symbolic::symbolic_check_policy' \
  'symbolic::symbolic_list_policies' \
  'symbolic::symbolic_add_policy' \
  'symbolic::symbolic_verify_plan'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — temporal_intel (4) + execution_memory (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'temporal_intel::temporal_what_was_i_doing' \
  'temporal_intel::temporal_daily_standup' \
  'temporal_intel::temporal_detect_patterns' \
  'temporal_intel::temporal_meeting_prep' \
  'execution_memory::exmem_record' \
  'execution_memory::exmem_search' \
  'execution_memory::exmem_recent'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — deep_scan (3) + supervisor (2) + trace (1)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'deep_scan::deep_scan_start' \
  'deep_scan::deep_scan_results' \
  'deep_scan::deep_scan_summary' \
  'supervisor::supervisor_get_health' \
  'supervisor::supervisor_get_service' \
  'trace::get_recent_traces'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — sysadmin (8) + integration_bridge (3)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'sysadmin::sysadmin_detect_hardware' \
  'sysadmin::sysadmin_dry_run_edit' \
  'sysadmin::sysadmin_dry_run_command' \
  'sysadmin::sysadmin_list_checkpoints' \
  'sysadmin::sysadmin_save_checkpoint' \
  'sysadmin::sysadmin_load_checkpoint' \
  'sysadmin::sysadmin_rollback' \
  'sysadmin::sysadmin_sudo_exec' \
  'integration_bridge::integration_get_state' \
  'integration_bridge::integration_toggle' \
  'integration_bridge::integration_poll_now'
do check "$cmd"; done

# ─────────────────────────────────────────────────────────────────────
# Admin — config provider/routing (6) + self_critique (4) + tool_forge (4)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'config::get_all_provider_keys' \
  'config::store_provider_key' \
  'config::switch_provider' \
  'config::get_task_routing' \
  'config::set_task_routing' \
  'config::save_config_field' \
  'self_critique::self_critique_response' \
  'self_critique::self_critique_history' \
  'self_critique::self_critique_deep_roast' \
  'self_critique::self_critique_weekly_meta' \
  'tool_forge::forge_new_tool' \
  'tool_forge::forge_list_tools' \
  'tool_forge::forge_delete_tool' \
  'tool_forge::forge_test_tool'
do check "$cmd"; done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[verify-phase7-rust-surface] ERROR: ${#MISSING[@]} Phase 7 Rust command(s) missing from $LIB_RS:" >&2
  for m in "${MISSING[@]}"; do
    echo "  - $m" >&2
  done
  echo "" >&2
  echo "Phase 7 ships zero new Rust; every command in D-167 inventory must stay registered." >&2
  echo "Re-add the missing handler(s) to the generate_handler![] in $LIB_RS." >&2
  exit 1
fi

echo "[verify-phase7-rust-surface] OK — all 192 Phase 7 Rust commands registered in $LIB_RS."
