/// CAPABILITY PROBE — Wraps providers::test_connection with a static capability
/// matrix lookup, returning a ProviderCapabilityRecord for the saved key + model.
///
/// Idempotent: one HTTP call, one ProbeStatus classification, one return.
/// No retry loops — per tester-pass commit 4ab464c posture. The UI re-invokes
/// the probe (explicit user click) if a transient error needs a second shot.
///
/// Static matrix source: `.planning/phases/11-smart-provider-setup/11-RESEARCH.md`
/// §Capability Matrix — encoded verbatim below. `long_context` is DERIVED from
/// `context_window >= 100_000`; the matrix's `long_context` hint is ignored at
/// inference time and recomputed from the window.
///
/// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-52 + §D-53
/// @see src-tauri/src/config.rs (ProbeStatus, ProviderCapabilityRecord types)

use crate::config::{BladeConfig, ProbeStatus, ProviderCapabilityRecord};
use std::collections::HashMap;
use std::sync::OnceLock;

// ---------------------------------------------------------------------------
// Internal matrix types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy)]
pub(crate) struct CapabilityDefaults {
    pub vision: bool,
    pub audio: bool,
    pub tool_calling: bool,
    pub context_window: u32,
}

impl CapabilityDefaults {
    const fn new(vision: bool, audio: bool, tool_calling: bool, context_window: u32) -> Self {
        Self { vision, audio, tool_calling, context_window }
    }

    const fn all_false(context_window: u32) -> Self {
        Self { vision: false, audio: false, tool_calling: false, context_window }
    }
}

/// Per-provider capability defaults + ordered list of model-substring overrides.
/// `first-match-wins` iteration — e.g. `gpt-4o-audio-preview` must appear
/// before `gpt-4o` in the OpenAI override list.
pub(crate) struct ProviderMatrix {
    pub defaults: CapabilityDefaults,
    pub overrides: &'static [(&'static str, CapabilityDefaults)],
}

// ---------------------------------------------------------------------------
// PROVIDER_CAPABILITIES — static matrix (RESEARCH.md §Capability Matrix)
// ---------------------------------------------------------------------------

// Override arrays are declared as `const` items so each slice has `'static`
// lifetime (array literals inside closures produce temporaries, which don't).
// First match wins: order matters — e.g. `gpt-4o-audio-preview` must appear
// before `gpt-4o` in OVR_OPENAI.

const OVR_ANTHROPIC: &[(&str, CapabilityDefaults)] = &[
    ("claude-sonnet-4",   CapabilityDefaults::new(true, false, true, 200_000)),
    ("claude-opus-4",     CapabilityDefaults::new(true, false, true, 200_000)),
    ("claude-haiku-4-5",  CapabilityDefaults::new(true, false, true, 200_000)),
    ("claude-3-5-sonnet", CapabilityDefaults::new(true, false, true, 200_000)),
];

const OVR_OPENAI: &[(&str, CapabilityDefaults)] = &[
    ("gpt-4o-audio-preview", CapabilityDefaults::new(true,  true,  true,  128_000)),
    ("gpt-4o-mini",          CapabilityDefaults::new(true,  false, true,  128_000)),
    ("gpt-4o",               CapabilityDefaults::new(true,  false, true,  128_000)),
    ("gpt-5",                CapabilityDefaults::new(true,  false, true,  400_000)),
    ("gpt-4-turbo",          CapabilityDefaults::new(true,  false, true,  128_000)),
    ("gpt-3.5-turbo",        CapabilityDefaults::new(false, false, true,  16_385)),
    ("whisper-1",            CapabilityDefaults::new(false, true,  false, 0)),
    ("tts-1",                CapabilityDefaults::new(false, true,  false, 0)),
    ("o1",                   CapabilityDefaults::new(true,  false, true,  128_000)),
    ("o3-mini",              CapabilityDefaults::new(true,  false, true,  128_000)),
    ("o4-mini",              CapabilityDefaults::new(true,  false, true,  128_000)),
];

const OVR_GEMINI: &[(&str, CapabilityDefaults)] = &[
    ("gemini-2.5-pro",   CapabilityDefaults::new(true, true,  true, 2_097_152)),
    ("gemini-2.0-flash", CapabilityDefaults::new(true, false, true, 1_048_576)),
    ("gemini-1.5-pro",   CapabilityDefaults::new(true, true,  true, 2_097_152)),
    ("gemini-1.5-flash", CapabilityDefaults::new(true, true,  true, 1_048_576)),
];

const OVR_GROQ: &[(&str, CapabilityDefaults)] = &[
    ("llama-3.3-70b-versatile",  CapabilityDefaults::new(false, false, true,  131_072)),
    ("llama-3.1-8b-instant",     CapabilityDefaults::new(false, false, true,  131_072)),
    ("meta-llama/llama-4-scout", CapabilityDefaults::new(true,  false, true,  131_072)),
    ("llama-3.2-90b-vision",     CapabilityDefaults::new(true,  false, true,  131_072)),
    ("llama-3.2-vision",         CapabilityDefaults::new(true,  false, true,  131_072)),
    ("mixtral-8x7b",             CapabilityDefaults::new(false, false, true,  32_768)),
    ("whisper-large-v3",         CapabilityDefaults::new(false, true,  false, 0)),
];

// OpenRouter: `:free` must win over substring matches like "claude" so free
// tier models surface as uncapable (the free tier often strips multimodal).
const OVR_OPENROUTER: &[(&str, CapabilityDefaults)] = &[
    (":free",     CapabilityDefaults::new(false, false, false, 8_192)),
    ("gpt-4o",    CapabilityDefaults::new(true,  false, true,  128_000)),
    ("claude",    CapabilityDefaults::new(true,  false, true,  200_000)),
    ("gemini",    CapabilityDefaults::new(true,  false, true,  1_000_000)),
    ("vision",    CapabilityDefaults::new(true,  false, true,  128_000)),
    ("llama-4",   CapabilityDefaults::new(true,  false, true,  131_072)),
    ("llama-3.3", CapabilityDefaults::new(false, false, true,  131_072)),
];

const OVR_OLLAMA: &[(&str, CapabilityDefaults)] = &[
    ("llava",    CapabilityDefaults::new(true,  false, false, 8_192)),
    ("vision",   CapabilityDefaults::new(true,  false, false, 8_192)),
    ("hermes3",  CapabilityDefaults::new(false, false, true,  8_192)),
    ("llama3.3", CapabilityDefaults::new(false, false, true,  128_000)),
    ("llama3.2", CapabilityDefaults::new(false, false, true,  128_000)),
];

const OVR_CUSTOM: &[(&str, CapabilityDefaults)] = &[];

fn provider_capabilities() -> &'static HashMap<&'static str, ProviderMatrix> {
    static MATRIX: OnceLock<HashMap<&'static str, ProviderMatrix>> = OnceLock::new();
    MATRIX.get_or_init(|| {
        let mut m: HashMap<&'static str, ProviderMatrix> = HashMap::new();

        m.insert("anthropic", ProviderMatrix {
            defaults: CapabilityDefaults::new(true, false, true, 200_000),
            overrides: OVR_ANTHROPIC,
        });

        m.insert("openai", ProviderMatrix {
            defaults: CapabilityDefaults::new(false, false, true, 128_000),
            overrides: OVR_OPENAI,
        });

        m.insert("gemini", ProviderMatrix {
            defaults: CapabilityDefaults::new(true, false, true, 1_000_000),
            overrides: OVR_GEMINI,
        });

        m.insert("groq", ProviderMatrix {
            defaults: CapabilityDefaults::new(false, false, true, 131_072),
            overrides: OVR_GROQ,
        });

        m.insert("openrouter", ProviderMatrix {
            defaults: CapabilityDefaults::new(false, false, false, 8_192),
            overrides: OVR_OPENROUTER,
        });

        m.insert("ollama", ProviderMatrix {
            defaults: CapabilityDefaults::new(false, false, false, 8_192),
            overrides: OVR_OLLAMA,
        });

        m.insert("custom", ProviderMatrix {
            defaults: CapabilityDefaults::all_false(8_192),
            overrides: OVR_CUSTOM,
        });

        m
    })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Infer capabilities for a given (provider, model) pair from the static matrix.
///
/// Returns `(vision, audio, tool_calling, long_context, context_window)`.
/// `long_context` is DERIVED from `context_window >= 100_000` — the matrix
/// rows don't store it directly.
///
/// `ctx_window_from_api` lets a probe override the static ctx when the provider
/// returns a live value in its response (e.g. Anthropic's `context_window`
/// field). Today's probes don't extract it yet, but the parameter is reserved
/// so Plan 11-03 can wire it without a signature change.
pub fn infer_capabilities(
    provider: &str,
    model: &str,
    ctx_window_from_api: Option<u32>,
) -> (bool, bool, bool, bool, u32) {
    let matrix = provider_capabilities();
    let default_custom = ProviderMatrix {
        defaults: CapabilityDefaults::all_false(8_192),
        overrides: &[],
    };
    let prov = matrix.get(provider).unwrap_or(&default_custom);

    let model_lower = model.to_ascii_lowercase();
    let best = prov
        .overrides
        .iter()
        .find(|(pattern, _)| model_lower.contains(&pattern.to_ascii_lowercase()))
        .map(|(_, caps)| *caps)
        .unwrap_or(prov.defaults);

    let ctx = ctx_window_from_api.unwrap_or(best.context_window);
    let long_context = ctx >= 100_000;
    (best.vision, best.audio, best.tool_calling, long_context, ctx)
}

/// Run the idempotent capability probe.
///
/// ONE HTTP call to `providers::test_connection`. The probe classifies the
/// result into a `ProbeStatus` enum and builds a `ProviderCapabilityRecord`
/// with capabilities derived from the static matrix. No retry loops.
///
/// - `Ok(_)` from test_connection → `ProbeStatus::Active`, return record
/// - 429 / "rate limit" → `ProbeStatus::RateLimitedButValid`, return record
///   (the key IS valid; downstream UI can show a warning pill)
/// - 401 / "unauthorized" → `Err(...)` with original message
/// - 404 / "not_found" → `Err(...)` with original message
/// - 5xx / "server error" → `Err(...)` with original message
/// - Anything else (network/DNS) → `Err(...)` with original message
///
/// Callers: Plan 11-03 Settings row re-probe, paste-form initial probe.
pub async fn probe(
    provider: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<ProviderCapabilityRecord, String> {
    let result = crate::providers::test_connection(provider, api_key, model, base_url).await;

    let probe_status = match &result {
        Ok(_) => ProbeStatus::Active,
        Err(err) => classify_error(err),
    };

    // Non-success statuses surface the error once. RateLimitedButValid is a
    // success-ish signal — the key works, the server is just busy — so we
    // still return a record.
    match probe_status {
        ProbeStatus::Active | ProbeStatus::RateLimitedButValid => {
            let (vision, audio, tools, long_context, context_window) =
                infer_capabilities(provider, model, None);
            Ok(ProviderCapabilityRecord {
                provider: provider.to_string(),
                model: model.to_string(),
                context_window,
                vision,
                audio,
                tool_calling: tools,
                long_context,
                last_probed: chrono::Utc::now(),
                probe_status,
            })
        }
        _ => Err(result.err().unwrap_or_else(|| "Unknown probe error".to_string())),
    }
}

/// Classify a test_connection error string into a ProbeStatus.
fn classify_error(err: &str) -> ProbeStatus {
    let lower = err.to_ascii_lowercase();
    if lower.contains("401") || lower.contains("unauthorized") || lower.contains("invalid api key") || lower.contains("invalid_api_key") {
        ProbeStatus::InvalidKey
    } else if lower.contains("404") || lower.contains("not_found") || lower.contains("model not found") {
        ProbeStatus::ModelNotFound
    } else if lower.contains("429") || lower.contains("rate limit") || lower.contains("too many requests") {
        ProbeStatus::RateLimitedButValid
    } else if lower.contains("500") || lower.contains("502") || lower.contains("503") || lower.contains("504") || lower.contains("5xx") || lower.contains("server error") || lower.contains("service unavailable") || lower.contains("bad gateway") {
        ProbeStatus::ProviderDown
    } else {
        ProbeStatus::NetworkError
    }
}

/// Auto-populate capability slots on BladeConfig from a fresh probe record.
///
/// ONLY fills slots that are currently `None` — never overwrites a user-set
/// preference. First capable provider wins each slot. Idempotent re-probe of
/// the same provider is safe: the slot is already filled, the `is_none()`
/// guard makes this a no-op.
///
/// Invariants (tested):
/// - `record.vision == false` → never touches `vision_provider` even if None
/// - `config.vision_provider.is_some()` → never overwritten regardless of record
pub fn maybe_auto_populate(config: &mut BladeConfig, rec: &ProviderCapabilityRecord) {
    let prov_model = format!("{}/{}", rec.provider, rec.model);
    if rec.vision && config.vision_provider.is_none() {
        config.vision_provider = Some(prov_model.clone());
    }
    if rec.audio && config.audio_provider.is_none() {
        config.audio_provider = Some(prov_model.clone());
    }
    if rec.long_context && config.long_context_provider.is_none() {
        config.long_context_provider = Some(prov_model.clone());
    }
    if rec.tool_calling && config.tools_provider.is_none() {
        config.tools_provider = Some(prov_model);
    }
}

// ---------------------------------------------------------------------------
// Tests — matrix lookup + auto-populate invariants. Probe() itself is
// network-coupled; end-to-end is covered by Plan 11-03 + manual
// VALIDATION.md. Classify-error coverage lives here too.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_record(provider: &str, model: &str, vision: bool, audio: bool, tools: bool, long: bool) -> ProviderCapabilityRecord {
        ProviderCapabilityRecord {
            provider: provider.to_string(),
            model: model.to_string(),
            context_window: if long { 200_000 } else { 8_192 },
            vision,
            audio,
            tool_calling: tools,
            long_context: long,
            last_probed: chrono::Utc::now(),
            probe_status: ProbeStatus::Active,
        }
    }

    // ── Matrix lookup ─────────────────────────────────────────────────────

    #[test]
    fn matrix_anthropic_default() {
        let (v, a, t, lc, ctx) = infer_capabilities("anthropic", "claude-sonnet-4-20250514", None);
        assert_eq!((v, a, t, lc, ctx), (true, false, true, true, 200_000));
    }

    #[test]
    fn matrix_openai_gpt4o() {
        let (v, a, t, lc, ctx) = infer_capabilities("openai", "gpt-4o", None);
        assert_eq!((v, a, t, lc, ctx), (true, false, true, true, 128_000));
    }

    #[test]
    fn matrix_openai_audio_preview_wins_over_gpt4o() {
        // gpt-4o-audio-preview must match BEFORE gpt-4o — first match wins
        let (v, a, t, lc, ctx) = infer_capabilities("openai", "gpt-4o-audio-preview", None);
        assert_eq!((v, a, t, lc, ctx), (true, true, true, true, 128_000));
    }

    #[test]
    fn matrix_groq_llama_33() {
        let (v, a, t, lc, ctx) = infer_capabilities("groq", "llama-3.3-70b-versatile", None);
        assert_eq!((v, a, t, lc, ctx), (false, false, true, true, 131_072));
    }

    #[test]
    fn matrix_openrouter_free_is_all_false() {
        let (v, a, t, lc, ctx) = infer_capabilities(
            "openrouter",
            "meta-llama/llama-3.3-70b-instruct:free",
            None,
        );
        assert_eq!((v, a, t, lc, ctx), (false, false, false, false, 8_192));
    }

    #[test]
    fn matrix_openrouter_claude_full() {
        let (v, a, t, lc, ctx) = infer_capabilities("openrouter", "anthropic/claude-opus-4", None);
        assert_eq!((v, a, t, lc, ctx), (true, false, true, true, 200_000));
    }

    #[test]
    fn matrix_custom_unknown_all_false() {
        let (v, a, t, lc, ctx) = infer_capabilities("custom", "any-model-name", None);
        assert_eq!((v, a, t, lc, ctx), (false, false, false, false, 8_192));
    }

    #[test]
    fn matrix_unknown_provider_defaults_to_custom() {
        let (v, a, t, lc, ctx) = infer_capabilities("not-a-real-provider", "anything", None);
        assert_eq!((v, a, t, lc, ctx), (false, false, false, false, 8_192));
    }

    #[test]
    fn matrix_long_context_derived_at_100k_threshold() {
        // gpt-3.5-turbo has ctx=16_385 — must report long_context=false
        let (_, _, _, lc, ctx) = infer_capabilities("openai", "gpt-3.5-turbo", None);
        assert!(!lc, "long_context must be false when ctx < 100_000");
        assert_eq!(ctx, 16_385);
    }

    #[test]
    fn matrix_ctx_from_api_overrides_static() {
        // Pass Some(300_000) — overrides the 200_000 default; long_context stays true
        let (_, _, _, lc, ctx) = infer_capabilities("anthropic", "claude-sonnet-4", Some(300_000));
        assert_eq!(ctx, 300_000);
        assert!(lc);
    }

    // ── classify_error ────────────────────────────────────────────────────

    #[test]
    fn classify_401_as_invalid_key() {
        assert_eq!(classify_error("401 Unauthorized"), ProbeStatus::InvalidKey);
        assert_eq!(classify_error("invalid_api_key"), ProbeStatus::InvalidKey);
    }

    #[test]
    fn classify_404_as_model_not_found() {
        assert_eq!(classify_error("404 Not Found"), ProbeStatus::ModelNotFound);
        assert_eq!(classify_error("model not found"), ProbeStatus::ModelNotFound);
    }

    #[test]
    fn classify_429_as_rate_limited() {
        assert_eq!(classify_error("429 Too Many Requests"), ProbeStatus::RateLimitedButValid);
        assert_eq!(classify_error("rate limit exceeded"), ProbeStatus::RateLimitedButValid);
    }

    #[test]
    fn classify_5xx_as_provider_down() {
        assert_eq!(classify_error("503 Service Unavailable"), ProbeStatus::ProviderDown);
        assert_eq!(classify_error("500 Internal Server Error"), ProbeStatus::ProviderDown);
    }

    #[test]
    fn classify_network_as_network_error() {
        assert_eq!(classify_error("dns error: no record"), ProbeStatus::NetworkError);
        assert_eq!(classify_error("connection refused"), ProbeStatus::NetworkError);
    }

    // ── maybe_auto_populate ───────────────────────────────────────────────

    #[test]
    fn auto_populate_fills_none_slots() {
        let mut cfg = BladeConfig::default();
        // Anthropic: vision=true, audio=false, tools=true, long=true
        let rec = fresh_record("anthropic", "claude-sonnet-4", true, false, true, true);

        maybe_auto_populate(&mut cfg, &rec);

        assert_eq!(cfg.vision_provider, Some("anthropic/claude-sonnet-4".to_string()));
        assert_eq!(cfg.long_context_provider, Some("anthropic/claude-sonnet-4".to_string()));
        assert_eq!(cfg.tools_provider, Some("anthropic/claude-sonnet-4".to_string()));
        // Audio was false — slot stays None
        assert!(cfg.audio_provider.is_none());
    }

    #[test]
    fn auto_populate_respects_user_choice() {
        let mut cfg = BladeConfig::default();
        cfg.vision_provider = Some("openai/gpt-4o".to_string());

        // A new capable Anthropic record arrives — should NOT overwrite
        let rec = fresh_record("anthropic", "claude-sonnet-4", true, false, true, true);
        maybe_auto_populate(&mut cfg, &rec);

        // Vision slot is untouched
        assert_eq!(cfg.vision_provider, Some("openai/gpt-4o".to_string()));
        // Other None slots DO get filled
        assert_eq!(cfg.tools_provider, Some("anthropic/claude-sonnet-4".to_string()));
    }

    #[test]
    fn auto_populate_idempotent_on_reprobe() {
        let mut cfg = BladeConfig::default();
        let rec = fresh_record("anthropic", "claude-sonnet-4", true, false, true, true);

        maybe_auto_populate(&mut cfg, &rec);
        let first_vision = cfg.vision_provider.clone();

        // Re-probe the same provider → slot already filled → no-op
        maybe_auto_populate(&mut cfg, &rec);
        assert_eq!(cfg.vision_provider, first_vision);
    }

    #[test]
    fn auto_populate_audio_slot_only_fills_when_rec_audio_true() {
        let mut cfg = BladeConfig::default();
        // OpenAI audio model — audio=true
        let rec_audio = fresh_record("openai", "gpt-4o-audio-preview", true, true, true, true);
        maybe_auto_populate(&mut cfg, &rec_audio);
        assert_eq!(cfg.audio_provider, Some("openai/gpt-4o-audio-preview".to_string()));
    }
}
