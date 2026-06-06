// Phase 90 (v2.6 POST-TURN-PARITY) — MemoryManager facade.
//
// Pattern-lift from NousResearch/hermes-agent `agent/memory_manager.py` (MIT).
// A single seam over BLADE's 8 scattered memory subsystems (memory.rs,
// typed_memory.rs, knowledge_graph.rs, embeddings.rs, people_graph.rs,
// personality_mirror.rs, memory_palace.rs, thread.rs). Before this, the loop
// had no place to ask "what does memory want for this turn?" — recall was
// assembled in brain.rs and end-of-turn writes were ~5 uncoordinated
// fire-and-forget `tokio::spawn` calls in loop_engine.
//
// v2.6 scope is ADDITIVE: the facade delegates to the existing module
// functions (which keep working unchanged). It coalesces the end-of-turn
// memory-write cluster into `sync_all`, and exposes `prefetch_all` (the recall
// block Phase 86 injects into the user message). The auxiliary-client +
// background_review fork (Phases 91/92) build on this seam.

use crate::providers::ChatMessage;

/// Minimum chars on either side of an exchange before fact-extraction runs.
/// Matches the prior inline gate at loop_engine.rs (was `len() > 50`).
const FACT_EXTRACTION_MIN_CHARS: usize = 50;

/// The synchronous half of the facade contract — recall assembly + prompt
/// block + per-turn lifecycle hooks. The async write half (`sync_all`) is an
/// inherent method (kept off the trait to avoid an async-trait dependency).
pub trait MemoryFacade {
    /// Assemble the cross-source recall block for a query (typed memory,
    /// knowledge graph, memory palace, embeddings, people/social graph).
    /// Returns "" when nothing recalled or when the Hive is active.
    fn prefetch_all(
        &self,
        user_query: &str,
        vector_store: Option<&crate::embeddings::SharedVectorStore>,
        hive_is_active: bool,
    ) -> String;

    /// The system-prompt-resident memory block. v2.6: empty — recall moved to
    /// the user message in v2.5 Phase 86. Kept as a seam for callers that still
    /// expect a system-prompt block; v2.7 may repopulate a stable summary tier.
    fn build_system_prompt_block(&self) -> String;

    /// Per-turn lifecycle hook (turn counter). Cheap; no I/O.
    fn on_turn_start(&mut self, turn_num: u32);
}

/// Default facade implementation. Stateless aside from the turn counter — the
/// 8 subsystems own their own persistence; the facade only routes.
#[derive(Debug, Clone, Default)]
pub struct MemoryManager {
    turn: u32,
}

impl MemoryManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn turn(&self) -> u32 {
        self.turn
    }

    /// True when an exchange carries enough content to be worth extracting
    /// facts from. Pure — unit-testable without touching any subsystem.
    pub fn should_extract_facts(user_text: &str, assistant_text: &str) -> bool {
        user_text.len() > FACT_EXTRACTION_MIN_CHARS
            || assistant_text.len() > FACT_EXTRACTION_MIN_CHARS
    }

    /// Coalesced end-of-turn memory write. Routes a finished exchange through
    /// every memory-write subsystem in one call, replacing the scattered
    /// fire-and-forget cluster previously inline in loop_engine. Each delegate
    /// is independently fire-safe (the modules swallow their own errors), so
    /// ordering is not load-bearing.
    pub async fn sync_all(&self, user_text: &str, assistant_text: &str) {
        // Fact extraction → knowledge graph + typed memory (gated on content).
        if Self::should_extract_facts(user_text, assistant_text) {
            let fact_msgs = vec![
                ChatMessage {
                    role: "user".to_string(),
                    content: user_text.to_string(),
                    image_base64: None,
                },
                ChatMessage {
                    role: "assistant".to_string(),
                    content: assistant_text.to_string(),
                    image_base64: None,
                },
            ];
            let _ = crate::memory::extract_conversation_facts(&fact_msgs).await;
        }
        // Memory palace — crystallise substantive exchanges.
        crate::memory_palace::auto_consolidate_from_conversation(user_text, assistant_text).await;
        // Knowledge graph — extract concepts and grow the semantic network.
        let full_exchange = format!("User: {}\n\nAssistant: {}", user_text, assistant_text);
        crate::knowledge_graph::grow_graph_from_conversation(&full_exchange).await;
        // People graph — names mentioned + communication context.
        crate::people_graph::learn_from_conversation_text(user_text, assistant_text).await;
        // Personality mirror — BLADE's chat style from this exchange.
        crate::personality_mirror::learn_from_exchange(user_text, assistant_text).await;
    }

    /// Queue a prefetch for the next turn. v2.6 placeholder: prefetch is
    /// currently synchronous at recall-build time (Phase 86). The async
    /// queue/cache lands with the auxiliary client (Phase 91); the seam exists
    /// now so call sites can adopt the contract.
    pub fn queue_prefetch_all(&self, _user_msg: &str) {}

    /// Memory-write notification hook (used by the Phase 92 background_review
    /// fork to report curator/typed-memory writes back through the facade).
    /// v2.6 placeholder — no-op until background_review wires it.
    pub fn on_memory_write(
        &self,
        _action: &str,
        _target: &str,
        _content: &str,
        _metadata: Option<&serde_json::Value>,
    ) {
    }
}

impl MemoryFacade for MemoryManager {
    fn prefetch_all(
        &self,
        user_query: &str,
        vector_store: Option<&crate::embeddings::SharedVectorStore>,
        hive_is_active: bool,
    ) -> String {
        // Delegates to the Phase 86 recall assembler — the single source of the
        // `<memory-context>` body injected into the user message.
        crate::brain::build_memory_recall_block(user_query, vector_store, hive_is_active)
    }

    fn build_system_prompt_block(&self) -> String {
        // Recall lives in the user message since v2.5 Phase 86 — the system
        // prompt carries no memory block (keeps the stable tier byte-stable).
        String::new()
    }

    fn on_turn_start(&mut self, turn_num: u32) {
        self.turn = turn_num;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fact_extraction_gate_matches_prior_inline_threshold() {
        // > 50 chars on either side → extract; short exchanges skip.
        assert!(!MemoryManager::should_extract_facts("hi", "ok"));
        let long = "x".repeat(51);
        assert!(MemoryManager::should_extract_facts(&long, "ok"));
        assert!(MemoryManager::should_extract_facts("hi", &long));
        assert!(!MemoryManager::should_extract_facts(&"y".repeat(50), &"z".repeat(50)),
            "exactly 50 is not > 50 — boundary preserved");
    }

    #[test]
    fn prefetch_empty_query_returns_empty() {
        let mm = MemoryManager::new();
        // build_memory_recall_block guards on !user_query.is_empty(); empty
        // query → empty block (no recall sources fire).
        assert_eq!(mm.prefetch_all("", None, false), "");
    }

    #[test]
    fn prefetch_hive_active_returns_empty() {
        let mm = MemoryManager::new();
        // hive_is_active short-circuits recall (the Hive owns context then).
        assert_eq!(mm.prefetch_all("what did we discuss", None, true), "");
    }

    #[test]
    fn system_prompt_block_is_empty_post_phase86() {
        let mm = MemoryManager::new();
        assert_eq!(mm.build_system_prompt_block(), "");
    }

    #[test]
    fn on_turn_start_updates_counter() {
        let mut mm = MemoryManager::new();
        assert_eq!(mm.turn(), 0);
        mm.on_turn_start(7);
        assert_eq!(mm.turn(), 7);
    }
}
