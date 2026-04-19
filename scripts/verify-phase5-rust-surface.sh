#!/usr/bin/env bash
# scripts/verify-phase5-rust-surface.sh — Phase 5 Plan 05-07 regression guard.
#
# Greps src-tauri/src/lib.rs for every Phase 5 Rust command required by the
# agents + knowledge cluster frontend wrappers (D-119 inventory). Fails if any
# command is missing from the generate_handler![] registration — catches
# accidental un-registration on future Rust refactors (D-123 defensive check).
#
# Runtime: ~100ms (single grep pass over lib.rs).
#
# @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-119, §D-123
# @see .planning/phases/05-agents-knowledge/05-07-PLAN.md Task 2

set -euo pipefail

LIB_RS="src-tauri/src/lib.rs"

if [ ! -f "$LIB_RS" ]; then
  echo "[verify-phase5-rust-surface] ERROR: $LIB_RS not found; wrong cwd?" >&2
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
# Agents cluster (D-119 inventory — 33 commands)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'agent_commands::agent_create' \
  'agent_commands::agent_create_desktop' \
  'agent_commands::agent_list' \
  'agent_commands::agent_get' \
  'agent_commands::agent_pause' \
  'agent_commands::agent_resume' \
  'agent_commands::agent_cancel' \
  'agent_commands::agent_respond_desktop_action' \
  'background_agent::agent_spawn' \
  'background_agent::agent_list_background' \
  'background_agent::agent_get_background' \
  'background_agent::agent_cancel_background' \
  'background_agent::agent_detect_available' \
  'background_agent::agent_get_output' \
  'background_agent::get_active_agents' \
  'background_agent::agent_auto_spawn' \
  'background_agent::agent_spawn_codex' \
  'swarm_commands::swarm_create' \
  'swarm_commands::swarm_list' \
  'swarm_commands::swarm_get' \
  'swarm_commands::swarm_pause' \
  'swarm_commands::swarm_resume' \
  'swarm_commands::swarm_cancel' \
  'swarm_commands::swarm_get_progress' \
  'swarm_commands::swarm_write_scratchpad' \
  'swarm_commands::swarm_read_scratchpad' \
  'agent_factory::factory_create_agent' \
  'agent_factory::factory_deploy_agent' \
  'agent_factory::factory_list_agents' \
  'agent_factory::factory_pause_agent' \
  'agent_factory::factory_delete_agent' \
  'managed_agents::run_managed_agent'
do
  check "$cmd"
done

# ─────────────────────────────────────────────────────────────────────
# Knowledge cluster (D-119 inventory — 42 commands)
# ─────────────────────────────────────────────────────────────────────
for cmd in \
  'db_commands::db_list_knowledge' \
  'db_commands::db_get_knowledge' \
  'db_commands::db_add_knowledge' \
  'db_commands::db_update_knowledge' \
  'db_commands::db_delete_knowledge' \
  'db_commands::db_search_knowledge' \
  'db_commands::db_knowledge_by_tag' \
  'db_commands::db_knowledge_tags' \
  'db_commands::db_knowledge_stats' \
  'db_commands::db_list_templates' \
  'db_commands::db_add_template' \
  'db_commands::db_delete_template' \
  'embeddings::embed_and_store' \
  'embeddings::semantic_search' \
  'embeddings::vector_store_size' \
  'knowledge_graph::graph_add_node' \
  'knowledge_graph::graph_search_nodes' \
  'knowledge_graph::graph_traverse' \
  'knowledge_graph::graph_find_path' \
  'knowledge_graph::graph_extract_from_text' \
  'knowledge_graph::graph_answer' \
  'knowledge_graph::graph_get_stats' \
  'knowledge_graph::graph_delete_node' \
  'memory_palace::memory_search' \
  'memory_palace::memory_get_recent' \
  'memory_palace::memory_recall' \
  'memory_palace::memory_add_manual' \
  'memory_palace::memory_delete' \
  'memory_palace::memory_consolidate_now' \
  'typed_memory::memory_store_typed' \
  'typed_memory::memory_recall_category' \
  'typed_memory::memory_get_all_typed' \
  'typed_memory::memory_delete_typed' \
  'typed_memory::memory_generate_user_summary' \
  'screen_timeline_commands::timeline_search_cmd' \
  'screen_timeline_commands::timeline_browse_cmd' \
  'screen_timeline_commands::timeline_get_screenshot' \
  'screen_timeline_commands::timeline_get_thumbnail' \
  'document_intelligence::doc_ingest' \
  'document_intelligence::doc_search' \
  'document_intelligence::doc_get' \
  'document_intelligence::doc_list' \
  'document_intelligence::doc_answer_question' \
  'document_intelligence::doc_cross_synthesis'
do
  check "$cmd"
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[verify-phase5-rust-surface] ERROR: ${#MISSING[@]} Phase 5 Rust command(s) missing from $LIB_RS:" >&2
  for m in "${MISSING[@]}"; do
    echo "  - $m" >&2
  done
  echo "" >&2
  echo "Phase 5 ships zero new Rust; every command in D-119 inventory must stay registered." >&2
  echo "Re-add the missing handler(s) to the generate_handler![] in $LIB_RS." >&2
  exit 1
fi

echo "[verify-phase5-rust-surface] OK — all 75 Phase 5 Rust commands registered in $LIB_RS."
