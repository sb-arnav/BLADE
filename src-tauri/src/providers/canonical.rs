//! Phase 54 / PROVIDER-CANONICAL-MODELS — Goose canonical model registry.
//!
//! Adapted from block/goose (Apache 2.0).
//! Source: <https://github.com/block/goose/blob/main/crates/goose/src/providers/canonical/>
//!   - data/canonical_models.json (~4,355 entries across 117 providers)
//!   - model.rs                   (CanonicalModel / Modality / Pricing / Limit)
//!   - registry.rs                (CanonicalModelRegistry::bundled())
//!
//! Bundled at compile time via `include_str!`. Parsed once on first lookup,
//! cached for the process lifetime. Lookups are O(log n) HashMap probes keyed
//! by `"{provider}/{model}"`.
//!
//! Coexistence with the legacy Phase 36 / INTEL-04 registry
//! (`intelligence::capability_registry`):
//!   - That registry is BLADE's own ~20-model curated list at
//!     `src-tauri/canonical_models.json` (different schema — keyed by provider
//!     then model, with simple bool capability flags). Router still consults
//!     it for the boolean capability bits (vision / tool_use / audio /
//!     long_context).
//!   - THIS registry is Goose's ~4,355-model upstream import at
//!     `src-tauri/data/canonical_models.json` (Goose schema — flat list with
//!     rich modalities + pricing + limits). Router uses it for pricing +
//!     context_window when picking the cheapest-sufficient model
//!     (PROVIDER-ROUTER-WIRE).
//!
//! Naming/scheme deltas:
//!   - Goose IDs use `google/` for Gemini; BLADE's provider id is `gemini`.
//!     `lookup("gemini", model)` transparently re-tries under `google/`.
//!   - Goose IDs use full slashed paths for OpenRouter (`openrouter/foo/bar`);
//!     `lookup("openrouter", "foo/bar")` works directly.
//!   - Ollama is local-only; not in Goose's registry. `lookup("ollama", _)`
//!     always returns None (caller falls back to local-zero-cost).

#![allow(dead_code)] // PROVIDER-ROUTER-WIRE + PROVIDER-TESTS consume these symbols.

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

/// Bundled Goose canonical_models.json shipped inside the BLADE binary.
const BUNDLED_CANONICAL_MODELS: &str =
    include_str!("../../data/canonical_models.json");

/// Modality types for model input/output. Mirrors Goose's `Modality` enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modality {
    Text,
    Image,
    Audio,
    Video,
    Pdf,
}

fn deserialize_modalities<'de, D>(deserializer: D) -> Result<Vec<Modality>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Goose stores modalities as a list of lowercase strings. Tolerate unknown
    // values gracefully (drop them) so a new modality landing upstream does
    // not break BLADE's parse.
    let strings: Vec<String> = Vec::deserialize(deserializer)?;
    Ok(strings
        .into_iter()
        .filter_map(|s| serde_json::from_value(serde_json::Value::String(s)).ok())
        .collect())
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Modalities {
    #[serde(default, deserialize_with = "deserialize_modalities")]
    pub input: Vec<Modality>,
    #[serde(default, deserialize_with = "deserialize_modalities")]
    pub output: Vec<Modality>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Pricing {
    /// USD per million input tokens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<f64>,
    /// USD per million output tokens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<f64>,
    /// USD per million cache-read tokens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_read: Option<f64>,
    /// USD per million cache-write tokens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cache_write: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Limit {
    /// Maximum context window in tokens. Goose calls this `context`; BLADE
    /// surfaces it as `context_window` via the public accessor.
    #[serde(default)]
    pub context: usize,
    /// Maximum output/completion tokens. None = provider default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<usize>,
}

/// A canonical model record. Mirrors Goose's `CanonicalModel` struct
/// (crates/goose/src/providers/canonical/model.rs) byte-for-byte at the
/// JSON layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalModel {
    /// "{provider}/{model_id}", e.g. "anthropic/claude-3-5-sonnet".
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Model family (e.g. "claude-sonnet").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
    /// Whether the model accepts attachments (images, pdfs, etc.).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<bool>,
    /// Whether the model supports extended-thinking / reasoning mode.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<bool>,
    /// Whether the model supports tool/function calling.
    #[serde(default)]
    pub tool_call: bool,
    /// Whether the temperature parameter is honored.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<bool>,
    /// Knowledge cutoff date (free-form, e.g. "2024-04-30").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub knowledge: Option<String>,
    /// Release date (free-form, e.g. "2024-10-22").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_date: Option<String>,
    /// Last-updated date.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_updated: Option<String>,
    /// Input/output modalities (Text/Image/Audio/Video/Pdf).
    #[serde(default)]
    pub modalities: Modalities,
    /// Whether the model weights are openly distributed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_weights: Option<bool>,
    /// Pricing — per-million-token costs.
    #[serde(default)]
    pub cost: Pricing,
    /// Context-window + max-output limits.
    #[serde(default)]
    pub limit: Limit,
}

impl CanonicalModel {
    /// Context-window size in tokens.
    pub fn context_window(&self) -> usize {
        self.limit.context
    }

    /// USD per million input tokens, or 0.0 when the registry has no price.
    pub fn pricing_per_1m_input(&self) -> f64 {
        self.cost.input.unwrap_or(0.0)
    }

    /// USD per million output tokens, or 0.0 when the registry has no price.
    pub fn pricing_per_1m_output(&self) -> f64 {
        self.cost.output.unwrap_or(0.0)
    }

    /// Capability strings the model advertises. Mirrors the boolean fields
    /// onto a Vec<&'static str> for compatibility with BLADE's existing
    /// capability-string contract (router.rs::cap_for matches on
    /// "vision" | "audio" | "tools" | "long_context" | "reasoning").
    ///
    /// The vec is empty when the model has no advertised capabilities.
    pub fn capabilities(&self) -> Vec<&'static str> {
        let mut caps = Vec::new();
        if self.modalities.input.contains(&Modality::Image) {
            caps.push("vision");
        }
        if self.modalities.input.contains(&Modality::Audio) {
            caps.push("audio");
        }
        if self.tool_call {
            caps.push("tools");
        }
        if self.limit.context >= 100_000 {
            caps.push("long_context");
        }
        if self.reasoning.unwrap_or(false) {
            caps.push("reasoning");
        }
        caps
    }
}

/// Process-wide bundled registry, parsed on first access and cached forever.
/// Lookup is O(1) HashMap probe.
static REGISTRY: Lazy<Mutex<Option<HashMap<String, CanonicalModel>>>> =
    Lazy::new(|| Mutex::new(None));

fn build_registry() -> HashMap<String, CanonicalModel> {
    // Goose ships canonical_models.json as a flat JSON array of CanonicalModel
    // records. Each record's `id` is unique, formatted as "provider/model_id".
    // We key the HashMap by that id verbatim so `lookup("anthropic",
    // "claude-3-5-sonnet")` → `registry.get("anthropic/claude-3-5-sonnet")`.
    let parsed: Vec<CanonicalModel> =
        match serde_json::from_str(BUNDLED_CANONICAL_MODELS) {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[PROVIDER-CANONICAL-MODELS] failed to parse bundled \
                     canonical_models.json (this is a build-time bug — the \
                     file shipped in src-tauri/data/ is malformed): {e}"
                );
                return HashMap::new();
            }
        };
    parsed.into_iter().map(|m| (m.id.clone(), m)).collect()
}

fn with_registry<R>(f: impl FnOnce(&HashMap<String, CanonicalModel>) -> R) -> R {
    let mut guard = REGISTRY.lock().expect("REGISTRY mutex poisoned");
    if guard.is_none() {
        *guard = Some(build_registry());
    }
    f(guard.as_ref().unwrap())
}

/// Total number of canonical model records loaded from the bundled registry.
/// Useful for diagnostics + tests.
pub fn entry_count() -> usize {
    with_registry(|r| r.len())
}

/// Number of distinct provider prefixes ("anthropic", "openai", …) in the
/// bundled registry.
pub fn provider_count() -> usize {
    with_registry(|r| {
        let mut set = std::collections::HashSet::new();
        for k in r.keys() {
            if let Some((p, _)) = k.split_once('/') {
                set.insert(p.to_string());
            }
        }
        set.len()
    })
}

/// Map a BLADE-internal provider id ("gemini", "openrouter", …) to one or
/// more Goose-canonical provider prefixes. Returned in lookup-priority order.
///
/// Why: Goose's registry uses `google/` for Gemini models; BLADE calls that
/// provider `gemini`. A direct lookup would miss every Gemini model. The
/// mapping below adds the canonical alias as a fallback so callers see the
/// same hit-rate they would on Goose.
fn provider_aliases(provider: &str) -> Vec<&'static str> {
    match provider {
        "anthropic" => vec!["anthropic"],
        "openai" => vec!["openai"],
        "groq" => vec!["groq"],
        "gemini" => vec!["gemini", "google"], // BLADE → Goose alias
        "openrouter" => vec!["openrouter"],
        "ollama" => vec!["ollama"], // not in Goose's registry; will miss
        other => {
            // Forward unknown providers verbatim. Custom base_url installs
            // (DeepSeek, NVIDIA NIM, Vercel AI Gateway) name themselves
            // and may or may not appear in the canonical registry.
            //
            // Need a static-str for the Vec return type; leak the string.
            // This branch fires once per unknown provider per process; the
            // leak is bounded by the number of distinct provider names.
            vec![Box::leak(other.to_string().into_boxed_str())]
        }
    }
}

/// Look up a canonical model by `(provider, model)`. Returns `None` when the
/// (provider, model) pair is not in the bundled registry.
///
/// Behavior:
///   - `provider` is BLADE's internal id ("anthropic", "openai", "gemini", …).
///     Internally we try every Goose-side alias from `provider_aliases`.
///   - `model` is the bare model name as the provider's API expects it
///     ("claude-3-5-sonnet", "gpt-4o", "gemini-1.5-pro"). NOT prefixed with
///     "{provider}/" — `parse_model_string` strips that upstream.
///   - On miss, the caller should fall back to whatever existed before
///     Phase 54 (`providers::price_per_million`, `max_output_tokens_for`).
pub fn lookup(provider: &str, model: &str) -> Option<CanonicalModel> {
    with_registry(|r| {
        for alias in provider_aliases(provider) {
            let key = format!("{}/{}", alias, model);
            if let Some(m) = r.get(&key) {
                return Some(m.clone());
            }
        }
        None
    })
}

/// Return every canonical model record whose id starts with `"{provider}/"`
/// (post-alias resolution). Used by the UI to render a "known models for
/// this provider" picker. Order is unspecified.
pub fn list_for_provider(provider: &str) -> Vec<CanonicalModel> {
    with_registry(|r| {
        let mut out = Vec::new();
        for alias in provider_aliases(provider) {
            let prefix = format!("{}/", alias);
            for (k, v) in r.iter() {
                if k.starts_with(&prefix) {
                    out.push(v.clone());
                }
            }
        }
        out
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_registry_parses_with_nonzero_entries() {
        // Lock: the bundled JSON parses cleanly + the registry is meaningfully
        // populated. Goose's upstream ships ~4,355 records across ~117
        // providers as of 2026-05; we use a lower bound that survives normal
        // upstream churn.
        let n = entry_count();
        assert!(
            n >= 1_500,
            "bundled canonical_models.json should have ≥1500 entries (got {n})"
        );
        let p = provider_count();
        assert!(
            p >= 50,
            "bundled canonical_models.json should cover ≥50 providers (got {p})"
        );
    }

    #[test]
    fn lookup_anthropic_known_model() {
        // Goose's registry uses dot-separated version IDs (e.g.
        // "claude-3.5-sonnet", not "claude-3-5-sonnet"). Lock the accessors
        // against the canonical id.
        let m = lookup("anthropic", "claude-3.5-sonnet")
            .expect("anthropic/claude-3.5-sonnet must be in the bundled registry");
        assert!(
            m.context_window() >= 100_000,
            "claude-3.5-sonnet context window should be ≥100k (got {})",
            m.context_window()
        );
        assert!(m.tool_call, "claude-3.5-sonnet must support tool_call");
        // Capabilities surface tools + long_context at minimum.
        let caps = m.capabilities();
        assert!(caps.contains(&"tools"));
        assert!(caps.contains(&"long_context"));
    }

    #[test]
    fn lookup_gemini_maps_to_google_alias() {
        // BLADE's "gemini" → Goose's "google/" alias. The lookup must
        // transparently resolve.
        let m = lookup("gemini", "gemini-1.5-pro")
            .expect("gemini/gemini-1.5-pro must resolve via google alias");
        assert_eq!(m.id, "google/gemini-1.5-pro");
        assert!(m.context_window() > 0);
    }

    #[test]
    fn lookup_unknown_returns_none() {
        assert!(lookup("anthropic", "not-a-real-model").is_none());
        assert!(lookup("not-a-real-provider", "anything").is_none());
        // Ollama is intentionally absent from the Goose registry.
        assert!(lookup("ollama", "llama3").is_none());
    }

    #[test]
    fn list_for_provider_returns_anthropic_models() {
        let models = list_for_provider("anthropic");
        assert!(
            !models.is_empty(),
            "anthropic should have at least one canonical model in the bundled registry"
        );
        for m in &models {
            assert!(
                m.id.starts_with("anthropic/"),
                "every entry under list_for_provider(\"anthropic\") must have id=\"anthropic/…\" (got {})",
                m.id
            );
        }
    }
}
