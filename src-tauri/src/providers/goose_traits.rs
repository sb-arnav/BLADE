//! Phase 54 / PROVIDER-TRAIT-PORT — Goose-aligned Provider + ProviderDef traits.
//!
//! Adapted from block/goose (Apache 2.0).
//! Source: <https://github.com/block/goose/blob/main/crates/goose/src/providers/base.rs>
//!
//! BLADE keeps its existing concrete provider functions (anthropic::complete,
//! openai::complete, …) untouched; the trait shape lives alongside them and is
//! implemented in Phase 54's PROVIDER-MIGRATION step via thin per-provider
//! adapter structs that delegate to those existing functions. This isolates the
//! adoption blast radius:
//!
//!   - keyring/auth layer:    untouched
//!   - per-provider HTTP:     untouched (anthropic.rs, openai.rs, etc.)
//!   - public call sites:     untouched (commands.rs, brain.rs, etc. still
//!                            call `providers::complete_turn` and
//!                            `providers::stream_text`)
//!   - new surface:           `Provider` + `ProviderDef` traits, plus the
//!                            canonical_models.json registry shipping
//!                            ~1,700 known models (PROVIDER-CANONICAL-MODELS).
//!
//! Naming deltas from Goose:
//!   - `Message` (Goose) → `super::ConversationMessage` (BLADE). Same role.
//!   - `Tool` (Goose, via rmcp) → `super::ToolDefinition` (BLADE).
//!   - `ProviderError` (Goose anyhow-style) → `String` (BLADE convention).
//!     Every existing BLADE provider already returns `Result<_, String>` so
//!     the trait inherits that posture for zero-churn migration.
//!   - `ProviderUsage` + `Usage` (Goose) → reuse `super::AssistantTurn`'s
//!     `tokens_in` / `tokens_out` fields (already present from LOOP-06).
//!   - `ModelConfig` (Goose) → `BladeModelConfig` (defined here). BLADE has no
//!     equivalent struct today; the trait takes one so callers stay
//!     forwards-compatible with future config-rich call paths.
//!
//! Dead-code suppression: these symbols are surfaced to the rest of BLADE in
//! Phase 54's PROVIDER-MIGRATION + PROVIDER-ROUTER-WIRE sub-tasks. Until then,
//! they look unused to the compiler.
//!
//! What we did NOT copy from Goose's base.rs:
//!   - `ThinkFilter` + `<think>` stream filter — BLADE has a different stream
//!     handling shape, this lives outside the trait surface.
//!   - `generate_session_name`, embeddings, cache_control hooks — not in scope
//!     for Phase 54 (Phase 55 will adopt the session schema; embeddings are
//!     handled in MEMORY-SIMPLIFY).
//!   - `from_env` constructor — BLADE constructs providers via the existing
//!     config layer; the trait does not impose a constructor signature.

#![allow(dead_code)] // Phase 54 — consumers land in PROVIDER-MIGRATION + PROVIDER-ROUTER-WIRE sub-tasks.

use serde::{Deserialize, Serialize};

/// Configuration passed to a `Provider::complete` / `Provider::stream` call.
///
/// Mirrors Goose's `ModelConfig` shape minus the parts BLADE doesn't use
/// (toolshim, temperature override). Existing BLADE providers always source
/// the model name from the call args (`anthropic::complete(api_key, model, ..)`)
/// — this struct simply collects the same fields plus the optional
/// `max_tokens_override` already plumbed by LOOP-04.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BladeModelConfig {
    /// Model name as the provider's API expects it (no "provider/" prefix —
    /// `providers::parse_model_string` strips that before reaching here).
    pub model_name: String,
    /// Optional cap on output tokens. None = each provider's hardcoded default
    /// (anthropic 4096, openai 4096, etc — see `providers::default_max_tokens_for`).
    pub max_tokens_override: Option<u32>,
    /// Optional custom base URL (NVIDIA NIM, Vercel AI Gateway, etc.). Honored
    /// by `Provider::complete` for OpenAI-compatible providers only.
    pub base_url: Option<String>,
}

impl BladeModelConfig {
    pub fn new(model_name: impl Into<String>) -> Self {
        Self {
            model_name: model_name.into(),
            max_tokens_override: None,
            base_url: None,
        }
    }

    pub fn with_max_tokens(mut self, n: u32) -> Self {
        self.max_tokens_override = Some(n);
        self
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = Some(url.into());
        self
    }
}

/// Static metadata about a provider's identity, default model, and config
/// requirements. Adapted from Goose's `ProviderMetadata`.
///
/// One instance per Provider impl. Surfaced to the UI for provider-picker
/// rendering and to the router for default-model + config-key lookup.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderMetadata {
    /// Stable provider id ("anthropic", "openai", "groq", …). Matches the
    /// keyring service-name and the canonical_models.json top-level key.
    pub name: String,
    /// Human-readable label for UIs.
    pub display_name: String,
    /// Short tagline.
    pub description: String,
    /// Recommended model when the user has not picked one.
    pub default_model: String,
    /// Models BLADE knows about for this provider (sourced from the
    /// canonical_models.json registry at lookup time, not duplicated here).
    /// Empty when the registry is the source of truth.
    pub known_models: Vec<String>,
    /// URL where the provider documents its model list.
    pub model_doc_link: String,
    /// Config keys the provider requires (API key, org id, etc.).
    pub config_keys: Vec<ConfigKey>,
}

impl ProviderMetadata {
    pub fn new(
        name: &str,
        display_name: &str,
        description: &str,
        default_model: &str,
        model_doc_link: &str,
        config_keys: Vec<ConfigKey>,
    ) -> Self {
        Self {
            name: name.to_string(),
            display_name: display_name.to_string(),
            description: description.to_string(),
            default_model: default_model.to_string(),
            known_models: vec![],
            model_doc_link: model_doc_link.to_string(),
            config_keys,
        }
    }
}

/// Config key metadata. Mirrors Goose's `ConfigKey`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigKey {
    /// Key name as stored in the keyring (e.g. "ANTHROPIC_API_KEY").
    pub name: String,
    /// Whether the provider cannot function without it.
    pub required: bool,
    /// Whether the value should be stored securely (vs. plain config).
    pub secret: bool,
    /// Optional default value when the user has not set one.
    pub default: Option<String>,
}

impl ConfigKey {
    pub fn new(name: &str, required: bool, secret: bool, default: Option<&str>) -> Self {
        Self {
            name: name.to_string(),
            required,
            secret,
            default: default.map(|s| s.to_string()),
        }
    }
}

/// Token usage reported by a provider after a `complete` call. Mirrors
/// Goose's `Usage` minus the cache fields (Anthropic-prompt-cache values
/// surface via per-provider extensions, not the trait — Phase 33's
/// `AssistantTurn.tokens_in/out` already provides the same shape).
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ProviderUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}

impl ProviderUsage {
    pub fn new(input_tokens: u32, output_tokens: u32) -> Self {
        Self {
            input_tokens: Some(input_tokens),
            output_tokens: Some(output_tokens),
            total_tokens: Some(input_tokens + output_tokens),
        }
    }
}

/// Static metadata interface — implemented by zero-sized marker types per
/// provider so the metadata can be fetched without instantiating a Provider.
///
/// Goose ties this to a `type Provider: Provider + 'static` associated type
/// and a `from_env` constructor. BLADE's existing `config::get_provider_key`
/// + `providers::complete_turn` dispatch already cover the construction path,
/// so the `ProviderDef` trait here is intentionally smaller — pure metadata.
pub trait ProviderDef {
    fn metadata() -> ProviderMetadata
    where
        Self: Sized;
}

/// Runtime provider interface. Implemented by per-provider adapter structs in
/// PROVIDER-MIGRATION (anthropic.rs, openai.rs, etc.). Each impl delegates to
/// the existing concrete `complete` / `stream_text` functions in the same file.
///
/// Goose's trait uses `#[async_trait]` so the trait is object-safe (`dyn
/// Provider`). BLADE uses the stable `async fn in trait` syntax (rustc ≥1.75)
/// — `dyn Provider` is not needed in Phase 54 (the dispatch table in
/// `providers::complete_turn` is a `match` on provider name, not dynamic
/// trait dispatch). If a future phase needs `dyn Provider`, switch to
/// `#[async_trait]` or wrap return types in `BoxFuture`.
///
/// Method names match Goose where the semantics align:
///   - `get_name`         — stable provider id, e.g. "anthropic"
///   - `get_model_config` — currently-bound model config
///   - `complete`         — one-shot turn, returns assistant text + tool calls + usage
///   - `stream_text`      — streaming turn; tokens emitted via Tauri event channel
///   - `supports_cache_control` / `supports_embeddings` — capability bits
pub trait Provider: Send + Sync {
    /// Stable provider id matching the keyring service-name and the
    /// canonical_models.json top-level key.
    fn get_name(&self) -> &str;

    /// The model config currently bound to this provider instance.
    fn get_model_config(&self) -> &BladeModelConfig;

    /// Complete a single turn. Returns the assistant turn (content + tool
    /// calls + token usage) on success, or a user-facing error string.
    ///
    /// Default impl returns a "not implemented" error so adapters can opt-in
    /// gradually. The PROVIDER-MIGRATION step overrides this on every
    /// shipping provider.
    fn complete(
        &self,
        api_key: &str,
        messages: &[super::ConversationMessage],
        tools: &[super::ToolDefinition],
    ) -> impl std::future::Future<Output = Result<super::AssistantTurn, String>> + Send {
        async move {
            let _ = (api_key, messages, tools);
            Err(format!(
                "{}: Provider::complete not implemented (Phase 54 migration in progress)",
                self.get_name()
            ))
        }
    }

    /// Whether this provider supports Anthropic-style prompt caching.
    /// Default false; anthropic's adapter overrides.
    fn supports_cache_control(&self) -> bool {
        false
    }

    /// Whether this provider supports embedding generation. Default false.
    fn supports_embeddings(&self) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_metadata_constructs() {
        let meta = ProviderMetadata::new(
            "anthropic",
            "Anthropic",
            "Claude family",
            "claude-sonnet-4-20250514",
            "https://docs.anthropic.com/en/docs/about-claude/models",
            vec![ConfigKey::new("ANTHROPIC_API_KEY", true, true, None)],
        );
        assert_eq!(meta.name, "anthropic");
        assert_eq!(meta.config_keys.len(), 1);
        assert!(meta.config_keys[0].secret);
    }

    #[test]
    fn model_config_builder_chain() {
        let cfg = BladeModelConfig::new("claude-sonnet-4-20250514")
            .with_max_tokens(8192)
            .with_base_url("https://api.anthropic.com");
        assert_eq!(cfg.model_name, "claude-sonnet-4-20250514");
        assert_eq!(cfg.max_tokens_override, Some(8192));
        assert_eq!(cfg.base_url.as_deref(), Some("https://api.anthropic.com"));
    }

    #[test]
    fn provider_usage_total_tokens() {
        let u = ProviderUsage::new(1000, 200);
        assert_eq!(u.input_tokens, Some(1000));
        assert_eq!(u.output_tokens, Some(200));
        assert_eq!(u.total_tokens, Some(1200));
    }

    #[test]
    fn provider_def_zero_sized_marker_pattern() {
        // PROVIDER-MIGRATION uses the zero-sized marker pattern Goose adopted:
        // a unit-struct implements ProviderDef so `Foo::metadata()` is a
        // static call. Lock the shape here.
        struct DummyDef;
        impl ProviderDef for DummyDef {
            fn metadata() -> ProviderMetadata {
                ProviderMetadata::new(
                    "dummy",
                    "Dummy",
                    "test fixture",
                    "dummy-1",
                    "https://example.com",
                    vec![],
                )
            }
        }
        let m = DummyDef::metadata();
        assert_eq!(m.name, "dummy");
    }
}
