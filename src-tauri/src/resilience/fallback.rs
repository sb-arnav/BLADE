// src-tauri/src/resilience/fallback.rs
//
// Phase 34 / RES-05 — provider fallback chain with exponential backoff.
//
// Plan 34-03 ships the FallbackExhausted struct + try_with_fallback stub.
// Plan 34-07 fills the body (chain walk, retries, exponential backoff with
// jitter, RES_FORCE_PROVIDER_ERROR test seam).

use crate::config::BladeConfig;
use crate::providers::{AssistantTurn, ConversationMessage, ToolDefinition};

/// RES-05 — surfaced to the user as a single chat_error AFTER the entire
/// fallback chain has been exhausted. Per CONTEXT lock §RES-05, intermediate
/// failures emit no chat_error — silent fallover within the chain.
#[derive(Debug, Clone)]
pub struct FallbackExhausted {
    pub chain_len: usize,
    pub last_error: String,
}

impl std::fmt::Display for FallbackExhausted {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "All providers in fallback chain exhausted ({} tried, last error: {})",
            self.chain_len, self.last_error)
    }
}

impl std::error::Error for FallbackExhausted {}

/// Plan 34-07 — test-only override seam. When set, every provider call inside
/// try_with_fallback returns Err(forced_error) instead of hitting the network.
/// Used to deterministically exhaust the chain in tests without making real
/// API calls.
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_PROVIDER_ERROR: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };
}

/// RES-05 — generalises commands::try_free_model_fallback. Walks the chain
/// in BladeConfig.resilience.provider_fallback_chain; for each chain element,
/// retries up to max_retries_per_provider times with exponential backoff +
/// jitter. Returns Ok(turn) on first success; Err(FallbackExhausted) if every
/// provider in the chain fails every retry.
///
/// Plan 34-03 ships the STUB returning Err(FallbackExhausted{0, "stub"}).
/// Plan 34-07 fills the body.
///
/// Per CONTEXT lock §RES-05, fallback is independent of the circuit breaker:
/// the same successful fallback (after 4 retries) still resets the circuit on
/// success.
#[allow(dead_code)]
pub async fn try_with_fallback(
    config: &BladeConfig,
    _conversation: &[ConversationMessage],
    _tools: &[ToolDefinition],
    _app: &tauri::AppHandle,
) -> Result<AssistantTurn, FallbackExhausted> {
    Err(FallbackExhausted {
        chain_len: config.resilience.provider_fallback_chain.len(),
        last_error: "Plan 34-03 stub — Plan 34-07 fills the body".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phase34_fallback_exhausted_constructs_and_displays() {
        let e = FallbackExhausted {
            chain_len: 3,
            last_error: "timeout".to_string(),
        };
        let s = format!("{}", e);
        assert!(s.contains("3 tried"), "got: {}", s);
        assert!(s.contains("timeout"), "got: {}", s);
    }
}
