//! Phase 54 / PROVIDER-TESTS — integration target for the Goose canonical
//! models registry adoption (Phase 54).
//!
//! Five tests, one per requirement in the phase scope:
//!   (a) parse canonical_models.json successfully + non-zero entry count
//!   (b) lookup known Anthropic model returns correct context window
//!   (c) lookup unknown model returns None gracefully
//!   (d) router picks cheapest-sufficient via canonical lookup
//!   (e) provider trait impl roundtrip for a mock provider response
//!
//! Crate name observed in `src-tauri/Cargo.toml`:
//!   [package].name = "blade"     (binary)
//!   [lib].name     = "blade_lib" (library — what integration tests import)
//!
//! No real provider API calls happen in this target; the trait roundtrip
//! uses a mock Provider impl that fabricates an AssistantTurn.

use blade_lib::providers::canonical;
use blade_lib::providers::goose_traits::{
    BladeModelConfig, ConfigKey, Provider, ProviderDef, ProviderMetadata,
};
use blade_lib::providers::{
    context_window_for, pick_cheapest_sufficient, price_per_million, AssistantTurn,
    ConversationMessage, ToolDefinition,
};

// ── (a) parse + non-zero entries ─────────────────────────────────────────────

/// Phase 54 / PROVIDER-TESTS (a) — canonical_models.json parses successfully
/// and surfaces ≥1,500 entries across ≥50 providers. Goose's upstream ships
/// ~4,355 entries / ~117 providers as of 2026-05-14; the lower bound survives
/// normal upstream churn.
///
/// Failure mode this guards against: the bundled JSON drifts to a schema
/// `serde_json::from_str::<Vec<CanonicalModel>>` can't parse, or someone
/// truncates the file by accident.
#[test]
fn phase54_provider_tests_a_canonical_models_parse_with_nonzero_entries() {
    let n = canonical::entry_count();
    assert!(
        n >= 1_500,
        "canonical_models.json should have ≥1500 entries (got {n}) — \
         bundled file at src-tauri/data/canonical_models.json may be \
         truncated, malformed, or out of sync with Goose upstream"
    );

    let p = canonical::provider_count();
    assert!(
        p >= 50,
        "canonical_models.json should cover ≥50 providers (got {p})"
    );
}

// ── (b) lookup known Anthropic model returns correct context window ──────────

/// Phase 54 / PROVIDER-TESTS (b) — `canonical::lookup("anthropic", "claude-…")`
/// resolves and surfaces the published context window. Locks the accessor
/// contract: `.context_window()` returns the limit.context value (not the
/// limit.output value), and it matches the Anthropic-documented 200,000-token
/// ceiling for the Claude 3.5+ generation.
#[test]
fn phase54_provider_tests_b_lookup_anthropic_returns_context_window() {
    // Goose's canonical id is dot-separated; use the upstream key.
    let m = canonical::lookup("anthropic", "claude-3.5-sonnet")
        .expect("anthropic/claude-3.5-sonnet must be in the bundled registry");

    assert!(
        m.context_window() >= 100_000,
        "claude-3.5-sonnet context window should clear the long-context \
         floor (100k); got {}",
        m.context_window()
    );

    // Anthropic publishes 200,000 tokens for Claude 3.5+; pin the upper-bound
    // expectation so accidental zero/garbage values get caught.
    assert!(
        m.context_window() >= 200_000 && m.context_window() <= 1_000_000,
        "claude-3.5-sonnet context_window should be in [200k, 1M] (got {})",
        m.context_window()
    );

    // Sister assertion: providers::context_window_for surfaces the same
    // value via the public router-side helper.
    let via_helper = context_window_for("anthropic", "claude-3.5-sonnet")
        .expect("context_window_for must mirror canonical::lookup");
    assert_eq!(via_helper as usize, m.context_window());
}

// ── (c) lookup unknown model returns None gracefully ─────────────────────────

/// Phase 54 / PROVIDER-TESTS (c) — unknown provider/model pairs return None,
/// NOT a panic or fallback to a wrong record. Locks the graceful-degrade
/// posture the router relies on: when canonical::lookup misses, the static
/// table at the bottom of `price_per_million` takes over.
#[test]
fn phase54_provider_tests_c_lookup_unknown_returns_none_gracefully() {
    // Unknown model under a known provider.
    assert!(
        canonical::lookup("anthropic", "claude-7.5-quantum-sonnet").is_none(),
        "unknown anthropic model must return None"
    );

    // Unknown provider, valid-shape model.
    assert!(
        canonical::lookup("not-a-provider-xyz", "gpt-99").is_none(),
        "unknown provider must return None"
    );

    // Ollama is intentionally not in Goose's registry — local-only.
    assert!(
        canonical::lookup("ollama", "llama3").is_none(),
        "ollama is local-only and must return None from the canonical registry"
    );

    // context_window_for mirrors lookup() for None.
    assert!(context_window_for("anthropic", "claude-7.5-quantum-sonnet").is_none());

    // price_per_million keeps its non-zero default for unknown pairs (T-33-28).
    let (inp, out) = price_per_million("not-a-provider-xyz", "weird-model");
    assert!(
        inp > 0.0 && out > 0.0,
        "unknown providers MUST keep non-zero default pricing to prevent \
         silent cost-guard bypass (got input={inp}, output={out})"
    );
}

// ── (d) router picks cheapest-sufficient via canonical lookup ────────────────

/// Phase 54 / PROVIDER-TESTS (d) — `pick_cheapest_sufficient` ranks
/// (provider, model) candidates by total per-million pricing AFTER filtering
/// to those whose context window clears the floor. Locks the router's
/// cheapest-sufficient invariant: cheaper provider beats more-expensive one
/// when both clear the context floor; expensive provider wins when the cheap
/// one falls short of the floor.
#[test]
fn phase54_provider_tests_d_router_picks_cheapest_sufficient() {
    let candidates: Vec<(String, String)> = vec![
        // Groq Llama 3.1 8B — cheap, 131k context per Goose.
        ("groq".to_string(), "llama-3.1-8b-instant".to_string()),
        // Claude 3.5 Sonnet — expensive, 200k context.
        ("anthropic".to_string(), "claude-3.5-sonnet".to_string()),
        // Claude Opus 4 — very expensive, 200k context.
        ("anthropic".to_string(), "claude-opus-4".to_string()),
    ];

    // Floor at 100k — every candidate clears it. Cheapest wins (groq).
    let cheapest = pick_cheapest_sufficient(&candidates, 100_000)
        .expect("at least one candidate should clear 100k floor");
    assert_eq!(
        cheapest.0, "groq",
        "at the 100k floor, the cheapest candidate must win (got {})",
        cheapest.0
    );

    // Floor at 150k — groq's 131k falls short. Cheapest 200k candidate wins
    // (Claude Sonnet beats Opus on price).
    let cheapest = pick_cheapest_sufficient(&candidates, 150_000)
        .expect("at least one Anthropic candidate should clear 150k floor");
    assert_eq!(
        cheapest.0, "anthropic",
        "at the 150k floor, the cheapest 200k-context candidate must win"
    );
    assert!(
        cheapest.1.contains("sonnet") || cheapest.1.contains("3.5"),
        "sonnet should beat opus on price at 200k context (got {})",
        cheapest.1
    );

    // Floor at 10M — no candidate clears it. Returns None (graceful degrade).
    assert!(
        pick_cheapest_sufficient(&candidates, 10_000_000).is_none(),
        "no candidate clears 10M context floor — must return None"
    );

    // Empty candidate list → None.
    assert!(
        pick_cheapest_sufficient(&[], 100_000).is_none(),
        "empty candidate list must return None"
    );
}

// ── (e) provider trait impl roundtrip for a mock provider response ───────────

/// A minimal mock Provider impl used only by this integration test. Avoids
/// real HTTP — the trait contract is what we're locking.
struct MockProvider {
    config: BladeModelConfig,
}

struct MockDef;

impl ProviderDef for MockDef {
    fn metadata() -> ProviderMetadata {
        ProviderMetadata::new(
            "mock",
            "Mock Provider",
            "test fixture for the Provider trait roundtrip",
            "mock-1",
            "https://example.com/docs",
            vec![ConfigKey::new("MOCK_API_KEY", true, true, None)],
        )
    }
}

impl Provider for MockProvider {
    fn get_name(&self) -> &str {
        "mock"
    }

    fn get_model_config(&self) -> &BladeModelConfig {
        &self.config
    }

    async fn complete(
        &self,
        api_key: &str,
        messages: &[ConversationMessage],
        _tools: &[ToolDefinition],
    ) -> Result<AssistantTurn, String> {
        // Fabricate a deterministic AssistantTurn that echoes the last user
        // message + asserts the api_key reached us. Mirrors what a real
        // provider returns: content + stop_reason + token counts.
        if api_key.is_empty() {
            return Err("mock: api_key must be set".to_string());
        }
        let last_user_text = messages
            .iter()
            .rev()
            .find_map(|m| match m {
                ConversationMessage::User(t) => Some(t.clone()),
                _ => None,
            })
            .unwrap_or_default();
        Ok(AssistantTurn {
            content: format!("echo: {last_user_text}"),
            tool_calls: vec![],
            stop_reason: Some("end_turn".to_string()),
            tokens_in: 10,
            tokens_out: (last_user_text.len() as u32) + 6, // "echo: ".len() == 6
        })
    }

    fn supports_cache_control(&self) -> bool {
        false
    }
}

/// Phase 54 / PROVIDER-TESTS (e) — Provider trait impl roundtrip. A mock
/// provider with a hand-rolled `complete` returns an AssistantTurn whose
/// shape matches what BLADE's downstream consumers (loop_engine, brain,
/// commands) expect. Locks the trait contract: `complete(api_key, messages,
/// tools)` returns `Result<AssistantTurn, String>` and surfaces token usage.
#[tokio::test]
async fn phase54_provider_tests_e_provider_trait_roundtrip() {
    let provider = MockProvider {
        config: BladeModelConfig::new("mock-1"),
    };

    // ProviderDef static metadata path.
    let meta = MockDef::metadata();
    assert_eq!(meta.name, "mock");
    assert_eq!(meta.default_model, "mock-1");
    assert_eq!(meta.config_keys.len(), 1);

    // Provider runtime path.
    assert_eq!(provider.get_name(), "mock");
    assert_eq!(provider.get_model_config().model_name, "mock-1");
    assert!(!provider.supports_cache_control());

    // Empty api_key returns an Err — locks the error-propagation shape.
    let err = provider
        .complete(
            "",
            &[ConversationMessage::User("hi".to_string())],
            &[],
        )
        .await
        .expect_err("empty api_key must error");
    assert!(err.contains("api_key"));

    // Round-trip with a real(ish) api_key + a user message.
    let turn = provider
        .complete(
            "mock-key-abc",
            &[
                ConversationMessage::System("be terse".to_string()),
                ConversationMessage::User("ping".to_string()),
            ],
            &[],
        )
        .await
        .expect("mock complete should succeed");

    assert_eq!(turn.content, "echo: ping");
    assert_eq!(turn.stop_reason.as_deref(), Some("end_turn"));
    assert_eq!(turn.tokens_in, 10);
    assert!(turn.tokens_out > 0);
    assert!(turn.tool_calls.is_empty());
}
