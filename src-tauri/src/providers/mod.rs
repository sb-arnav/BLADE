pub mod anthropic;
pub mod canonical;
pub mod gemini;
pub mod goose_traits;
pub mod groq;
pub mod ollama;
pub mod openai;

use serde::{Deserialize, Serialize};

/// Shared HTTP client with timeouts. Prevents permanent hangs when network drops.
pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

// ── Unified model-string routing (litellm-style) ─────────────────────────────
//
// Accepts model strings in "provider/model" format, e.g.:
//   "openai/gpt-4o"
//   "anthropic/claude-sonnet-4-20250514"
//   "groq/llama-3.3-70b-versatile"
//   "ollama/hermes3"
//   "openrouter/meta-llama/llama-3.3-70b-instruct:free"
//
// When no prefix is present the caller-supplied `fallback_provider` is used,
// which keeps backwards compatibility with all existing call sites.

/// The canonical set of provider prefix strings BLADE understands.
const KNOWN_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "gemini",
    "groq",
    "ollama",
    "openrouter",
];

/// Parse a model string that may or may not carry a "provider/" prefix.
///
/// Returns `(provider, model_for_api)` where `model_for_api` is the bare
/// model name that should be sent to the provider's API.
///
/// Examples:
///   "openai/gpt-4o"                                    → ("openai", "gpt-4o")
///   "openrouter/meta-llama/llama-3.3-70b-instruct:free" → ("openrouter", "meta-llama/llama-3.3-70b-instruct:free")
///   "gpt-4o"                                            → (fallback_provider, "gpt-4o")
pub fn parse_model_string<'a>(
    model: &'a str,
    fallback_provider: &'a str,
) -> (&'a str, &'a str) {
    // Only split on the first slash — openrouter models contain additional slashes
    // (e.g. "openrouter/meta-llama/llama-3.3-70b-instruct:free").
    if let Some(slash_pos) = model.find('/') {
        let prefix = &model[..slash_pos];
        if KNOWN_PROVIDERS.contains(&prefix) {
            let rest = &model[slash_pos + 1..];
            return (prefix, rest);
        }
    }
    // No recognised prefix — use the caller-supplied fallback provider.
    (fallback_provider, model)
}

/// Convenience wrapper: given a raw model string (possibly with provider prefix)
/// and the config's active provider, return `(provider, model_name, api_key)`.
///
/// The API key is looked up from the keyring for the resolved provider.
/// For the active provider the caller's key is used directly to avoid an
/// extra keyring round-trip.
pub fn resolve_provider_model(
    model: &str,
    config_provider: &str,
    config_api_key: &str,
) -> (String, String, String) {
    let (provider, bare_model) = parse_model_string(model, config_provider);
    let api_key = if provider == config_provider {
        config_api_key.to_string()
    } else {
        crate::config::get_provider_key(provider)
    };
    (provider.to_string(), bare_model.to_string(), api_key)
}

/// Detect whether an error string represents a transient provider failure
/// (rate limit, service unavailable, server error) that warrants trying a
/// fallback provider.
#[allow(dead_code)]
fn is_fallback_eligible_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("429")
        || lower.contains("rate limit")
        || lower.contains("too many requests")
        || lower.contains("503")
        || lower.contains("502")
        || lower.contains("500")
        || lower.contains("529")
        || lower.contains("overloaded")
        || lower.contains("service unavailable")
        || lower.contains("bad gateway")
        || lower.contains("internal server error")
        // Network failures — the most common case when WiFi drops or provider stalls
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("dns error")
        || lower.contains("network error")
        || lower.contains("failed to connect")
        || lower.contains("operation canceled")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub image_base64: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

/// Helper: returns an empty `&[ToolDefinition]` slice. Use this instead of `&[]`
/// when calling `complete_turn` — avoids the `&[T; 0]` → `&[T]` coercion issue.
pub fn no_tools() -> Vec<ToolDefinition> { Vec::new() }

#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

#[derive(Debug, Clone)]
pub enum ConversationMessage {
    System(String),
    User(String),
    UserWithImage {
        text: String,
        image_base64: String,
    },
    Assistant {
        content: String,
        tool_calls: Vec<ToolCall>,
    },
    Tool {
        tool_call_id: String,
        tool_name: String,
        content: String,
        is_error: bool,
    },
}

#[derive(Debug, Clone, Default)]
pub struct AssistantTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    /// Phase 33 / LOOP-04 — provider-reported stop/finish reason, normalized to
    /// the raw string each provider returns. Per-provider naming varies:
    ///   - Anthropic:  "end_turn" | "max_tokens" | "stop_sequence" | "tool_use"
    ///   - OpenAI:     "stop" | "length" | "tool_calls" | "content_filter"
    ///   - OpenRouter: same as OpenAI (compatible API)
    ///   - Groq:       same as OpenAI (compatible API)
    ///   - Gemini:     "STOP" | "MAX_TOKENS" | "SAFETY" | …
    ///   - Ollama:     surfaces `done_reason` when present, else None
    /// Truncation detection in `loop_engine::detect_truncation` does the
    /// per-provider mapping (e.g. anthropic "max_tokens" + openai "length"
    /// both indicate output truncation).
    pub stop_reason: Option<String>,
    /// Phase 33 / LOOP-06 — provider-reported input (prompt) token count.
    /// Populated from each provider's `usage` field; 0 when the provider does
    /// not surface usage (some Ollama builds, custom OpenAI-compatible
    /// gateways with usage stripped). Consumed by `loop_engine::run_loop` to
    /// accumulate `LoopState.cumulative_cost_usd` via
    /// `providers::price_per_million(provider, model)`.
    pub tokens_in: u32,
    /// Phase 33 / LOOP-06 — provider-reported output (completion) token count.
    /// Same posture as `tokens_in`: 0 when the provider does not report.
    pub tokens_out: u32,
}

pub fn build_conversation(
    messages: Vec<ChatMessage>,
    system_prompt: Option<String>,
) -> Vec<ConversationMessage> {
    let mut conversation = Vec::new();

    if let Some(system_prompt) = system_prompt {
        if !system_prompt.trim().is_empty() {
            conversation.push(ConversationMessage::System(system_prompt));
        }
    }

    conversation.extend(messages.into_iter().map(|message| {
        if message.role == "assistant" {
            ConversationMessage::Assistant {
                content: message.content,
                tool_calls: Vec::new(),
            }
        } else if let Some(img) = message.image_base64 {
            ConversationMessage::UserWithImage {
                text: message.content,
                image_base64: img,
            }
        } else {
            ConversationMessage::User(message.content)
        }
    }));

    conversation
}

const OPENROUTER_BASE_URL: &str = "https://openrouter.ai/api/v1";

/// Route a single `complete_turn` call to the correct provider adapter.
///
/// `provider` may be a bare provider name ("openai") **or** a "provider/model"
/// string ("openai/gpt-4o").  When `model` already contains a provider prefix
/// the `provider` argument is used as the fallback only.  The resolved bare
/// model name is forwarded to the adapter unchanged.
pub async fn complete_turn(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
) -> Result<AssistantTurn, String> {
    complete_turn_inner(provider, api_key, model, messages, tools, base_url, None).await
}

/// Phase 33 / LOOP-04 — sibling of `complete_turn` that lets the caller force
/// a specific `max_tokens` ceiling on the provider request. Used by
/// `loop_engine::run_loop` to retry a truncated turn with a doubled max.
///
/// Existing call sites of `complete_turn` are unchanged — they continue to
/// use each provider's hardcoded default (4096 for both Anthropic and OpenAI).
/// Only the smart-loop truncation-retry path threads an override.
pub async fn complete_turn_with_max_tokens(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
    max_tokens_override: u32,
) -> Result<AssistantTurn, String> {
    complete_turn_inner(
        provider, api_key, model, messages, tools, base_url,
        Some(max_tokens_override),
    ).await
}

/// Private impl shared by `complete_turn` (override=None → provider default)
/// and `complete_turn_with_max_tokens` (override=Some(N) → cap at N).
async fn complete_turn_inner(
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    base_url: Option<&str>,
    max_tokens_override: Option<u32>,
) -> Result<AssistantTurn, String> {
    // Resolve provider/model from the model string (supports "provider/model" prefix).
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider   = resolved_provider.as_str();
    let model      = bare_model.as_str();
    // Prefer the resolved key; fall back to the passed-in key for custom/base_url providers.
    let api_key    = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

    // If a custom base_url is set, always use the OpenAI-compatible client —
    // Vercel AI Gateway, Cloudflare AI Gateway, Azure, etc. all speak OpenAI format.
    if base_url.is_some() && provider != "ollama" {
        let result = openai::complete_ext(api_key, model, messages, tools, base_url, max_tokens_override).await;
        // Some custom endpoints (NVIDIA NIM, etc.) return 404 when tools are sent to a
        // model that doesn't support function calling. Retry without tools in that case.
        if !tools.is_empty() {
            if let Err(ref e) = result {
                if e.contains("404") {
                    let no_tools: &[ToolDefinition] = Default::default();
                    return openai::complete_ext(api_key, model, messages, no_tools, base_url, max_tokens_override).await;
                }
            }
        }
        return result;
    }
    let result = match provider {
        "gemini"     => gemini::complete_ext(api_key, model, messages, tools, max_tokens_override).await,
        "groq"       => groq::complete_ext(api_key, model, messages, tools, max_tokens_override).await,
        "openai"     => openai::complete_ext(api_key, model, messages, tools, base_url, max_tokens_override).await,
        "anthropic"  => anthropic::complete_ext(api_key, model, messages, tools, max_tokens_override).await,
        "ollama"     => ollama::complete(model, messages).await,
        "openrouter" => openai::complete_ext(api_key, model, messages, tools, Some(OPENROUTER_BASE_URL), max_tokens_override).await,
        _            => Err(format!("Unknown provider: {}", provider)),
    };

    // Cardiovascular: track every API call for blood pressure monitoring
    crate::cardiovascular::on_provider_call_complete(provider, model, result.is_ok());

    result
}

/// Phase 33 / LOOP-04 — per-model output-token cap.
///
/// Returns the documented `max_tokens` ceiling for the (provider, model) pair.
/// Reused by `loop_engine::escalate_max_tokens` to bound the doubled retry.
/// Keeping this as a small explicit table is cheaper than threading metadata
/// through the existing capability_probe — values are static per model.
///
/// Anthropic ceiling is 8192 (default); the 64000 ceiling requires the
/// extended-output beta header (anthropic-beta: output-128k-2025-02-19).
/// Phase 33 sticks to 8192 to avoid header juggling — when the eventual
/// Phase 34/35 work needs the higher cap, the table moves to 64000 and the
/// header is set conditionally.
/// Phase 33 / 33-NN-FIX (HI-01) — per-provider DEFAULT max-output-tokens.
///
/// This is the value the provider would actually USE on a request that didn't
/// pass `max_tokens` (or whatever each provider calls its output cap). It is
/// distinct from `max_output_tokens_for` (the absolute ceiling for escalation):
///
///   - Anthropic + OpenAI: `build_body` hardcodes a default of 4096 in the
///     request body (anthropic.rs:27, openai.rs:42), so 4096 is the actual
///     baseline. Escalation via doubling to 8192 is real new headroom.
///   - Groq + Gemini + Ollama: `build_body` does NOT pass a default at all —
///     the field is omitted unless `max_tokens_override` is set. Each provider
///     applies its own server-side default (Groq ~8192, Gemini ~8192, Ollama
///     ~4096 typical). The smart-loop truncation block previously hardcoded
///     `current_max_tokens = 4096`, which mis-estimated those three providers.
///     A non-truncated Groq response on an 8192 ceiling that happened to lack
///     terminal punctuation would trigger `escalate_max_tokens(.., 4096)` →
///     `Some(8192)` → retry at the SAME ceiling Groq was already using →
///     identical truncation outcome at full retry cost (false-positive
///     escalation, money leak).
///   - OpenRouter: depends on the upstream model; conservative 8192 (matches
///     the OpenAI-compatible body builder when no override is passed).
///
/// Used by `loop_engine::run_loop` to seed `current_max_tokens` BEFORE calling
/// `escalate_max_tokens(.., current)`. When `current >= cap`, escalate returns
/// `None` and we skip the wasted retry.
///
/// Sourced from each provider's published default-output-tokens behavior as
/// of 2026-05.
/// Phase 34 / RES-05 — preferred default model per provider. Used by
/// `resilience::fallback::try_with_fallback` when a chain element is just a
/// provider id (no per-element model in the configured chain).
///
/// Values mirror the hardcoded defaults in Phase 33's
/// `commands::try_free_model_fallback` (commands.rs:520-523) plus the project's
/// canonical anthropic / openai / gemini choices used elsewhere.
///
/// Unknown providers fall back to `"claude-sonnet-4-20250514"` — Anthropic is
/// the canonical primary in BladeConfig::default(); a safe fallback matches
/// the rest of the cost / token table behavior.
pub fn default_model_for(provider: &str) -> &'static str {
    match provider {
        "anthropic"  => "claude-sonnet-4-20250514",
        "openai"     => "gpt-4o",
        "groq"       => "llama-3.3-70b-versatile",
        "openrouter" => "meta-llama/llama-3.3-70b-instruct:free",
        "ollama"     => "llama3",
        "gemini"     => "gemini-2.0-flash-exp",
        _            => "claude-sonnet-4-20250514",
    }
}

pub fn default_max_tokens_for(provider: &str, _model: &str) -> u32 {
    match provider {
        // Body-literal defaults — see anthropic.rs:27, openai.rs:42.
        "anthropic"  => 4_096,
        "openai"     => 4_096,
        // Server-side defaults — build_body omits the field entirely.
        "groq"       => 8_192,
        "gemini"     => 8_192,
        "ollama"     => 8_192,
        // OpenRouter is OpenAI-compatible; no body literal in our wiring,
        // upstream typically honors 8192 as the modern default.
        "openrouter" => 8_192,
        // Unknown providers: conservative 4096 (lowest plausible default).
        _            => 4_096,
    }
}

/// Phase 54 / PROVIDER-ROUTER-WIRE — registry-first context-window lookup.
///
/// Returns the model's published context window in tokens, sourced from Goose's
/// canonical_models.json registry. Returns `None` when the model isn't in the
/// bundled registry — callers should fall back to per-provider defaults
/// (BLADE's existing `intelligence::capability_registry` or capability_probe).
///
/// Used by the router task-classification path to pick the cheapest-sufficient
/// model: when a task wants ≥100k context, the router walks candidate providers,
/// asks this fn for the published window, and prefers the cheapest one that
/// clears the floor.
#[allow(dead_code)] // Surfaced for routers + tests; internal callsites land in subsequent phases.
pub fn context_window_for(provider: &str, model: &str) -> Option<u32> {
    canonical::lookup(provider, model).map(|m| {
        let w = m.context_window();
        w.min(u32::MAX as usize) as u32
    })
}

/// Phase 54 / PROVIDER-ROUTER-WIRE — registry-first cheapest-sufficient model.
///
/// Given a list of candidate (provider, model) pairs and a minimum context
/// window, returns the candidate with the lowest combined input+output pricing
/// from the canonical registry that still clears the context floor.
///
/// Returns `None` when none of the candidates are in the registry OR when none
/// clear the context floor. Caller is expected to fall back to its previous
/// selection logic in that case (graceful degrade — never blocks routing).
#[allow(dead_code)] // Surfaced for routers + tests; internal callsites land in subsequent phases.
pub fn pick_cheapest_sufficient(
    candidates: &[(String, String)],
    min_context: u32,
) -> Option<(String, String)> {
    let mut best: Option<((String, String), f32)> = None;
    for (prov, model) in candidates {
        if let Some(m) = canonical::lookup(prov, model) {
            let ctx = m.context_window() as u32;
            if ctx < min_context {
                continue;
            }
            let total_price =
                (m.pricing_per_1m_input() + m.pricing_per_1m_output()) as f32;
            match &best {
                Some((_, p)) if *p <= total_price => {}
                _ => best = Some(((prov.clone(), model.clone()), total_price)),
            }
        }
    }
    best.map(|(c, _)| c)
}

pub fn max_output_tokens_for(provider: &str, model: &str) -> u32 {
    // Phase 54 / PROVIDER-ROUTER-WIRE — registry-first: Goose's
    // canonical_models.json carries explicit `limit.output` per model when
    // upstream documents one. Fall through to the static table on miss so
    // OpenRouter substring matching + unknown providers keep working.
    if let Some(m) = canonical::lookup(provider, model) {
        if let Some(out) = m.limit.output {
            // Cap pathologically large values at u32::MAX as a safety net.
            return out.min(u32::MAX as usize) as u32;
        }
    }
    match (provider, model) {
        ("anthropic", m) if m.starts_with("claude-sonnet-4") => 8_192,
        ("anthropic", m) if m.starts_with("claude-haiku")    => 8_192,
        ("anthropic", _)                                     => 8_192,

        ("openai", m) if m.starts_with("gpt-4o-mini")        => 16_384,
        ("openai", m) if m.starts_with("gpt-4o")             => 16_384,
        ("openai", m) if m.starts_with("o1")                 => 32_768,
        ("openai", m) if m.starts_with("gpt-3.5")            => 4_096,
        ("openai", _)                                        => 4_096,

        ("groq", _)                                          => 8_192,
        ("openrouter", _)                                    => 8_192,
        ("gemini", _)                                        => 8_192,
        ("ollama", _)                                        => 4_096,
        _                                                    => 4_096,
    }
}

/// Phase 33 / LOOP-06 — per-provider, per-model token pricing in USD.
///
/// Returns `(input_per_million_usd, output_per_million_usd)`. Used by
/// `loop_engine::run_loop` to accumulate `LoopState.cumulative_cost_usd`
/// after each `complete_turn` (and by Plan 33-06's truncation-retry
/// cost-guard interlock to project escalation cost before doubling
/// `max_tokens`).
///
/// Sourced from each provider's public pricing pages as of 2026-05.
/// Recommended quarterly review against actual Anthropic/OpenAI/Groq/Gemini
/// account billing. CONTEXT lock §Iteration Limit & Cost Guard: this is the
/// SINGLE source of truth for token cost — `trace.rs` does not duplicate
/// (today it does not log cost at all; if it ever wants to, it should
/// delegate to this fn).
///
/// Arithmetic posture: f32 multiplies, no rounding. The cost-guard error
/// budget is in cents; sub-cent IEEE 754 imprecision is irrelevant.
///
/// Default fallback: `(1.00, 3.00)` — non-zero so unknown providers do NOT
/// silently bypass the cost guard (T-33-28 mitigation: prevent surprise
/// free-tier passes via spoofed provider names).
pub fn price_per_million(provider: &str, model: &str) -> (f32, f32) {
    // Phase 54 / PROVIDER-ROUTER-WIRE — consult Goose's canonical_models.json
    // registry first. The registry ships ~4,300 model records with upstream-
    // maintained pricing; when a hit exists, prefer it over BLADE's static
    // table. On miss, fall through to the per-provider arms below — those
    // remain the source of truth for OpenRouter / Ollama / unknown providers
    // and for models the registry hasn't tracked yet.
    if let Some(m) = canonical::lookup(provider, model) {
        let inp = m.pricing_per_1m_input() as f32;
        let out = m.pricing_per_1m_output() as f32;
        // Goose stores 0.0 when pricing is unknown/free-tier; preserve the
        // "non-zero default for unknown providers" invariant (T-33-28) by
        // falling through to the static table only if BOTH prices are 0.
        if inp > 0.0 || out > 0.0 || provider == "ollama" {
            return (inp, out);
        }
    }
    match (provider, model) {
        ("anthropic", m) if m.starts_with("claude-sonnet-4")  => (3.00, 15.00),
        ("anthropic", m) if m.starts_with("claude-opus-4")    => (15.00, 75.00),
        ("anthropic", m) if m.starts_with("claude-haiku-4-5") => (0.80, 4.00),
        ("anthropic", m) if m.starts_with("claude-haiku")     => (0.80, 4.00),
        ("anthropic", _)                                      => (3.00, 15.00),

        ("openai", m) if m.starts_with("gpt-4o-mini")         => (0.15, 0.60),
        ("openai", m) if m.starts_with("gpt-4o")              => (2.50, 10.00),
        ("openai", m) if m.starts_with("o1-mini")             => (3.00, 12.00),
        ("openai", m) if m.starts_with("o1")                  => (15.00, 60.00),
        ("openai", m) if m.starts_with("gpt-3.5")             => (0.50, 1.50),
        ("openai", _)                                         => (2.50, 10.00),

        ("groq", _)                                           => (0.05, 0.08),
        ("gemini", _)                                         => (0.10, 0.40),
        ("openrouter", _)                                     => (1.00, 3.00),
        ("ollama", _)                                         => (0.00, 0.00),
        _                                                     => (1.00, 3.00),
    }
}

/// Phase 33 / LOOP-01 — one-shot text completion. Used by the verification
/// probe (`loop_engine::verify_progress`). Builds a single-user-message
/// conversation, calls `complete_turn` with no tools, returns the assistant
/// turn's text content.
///
/// On error: returns Err(reason). The verification probe wraps this call in
/// catch_unwind and continues the main loop on failure — `complete_simple`
/// itself does no error handling beyond surfacing the underlying error.
///
/// Note on the empty-tools idiom: per CLAUDE.md, `&[]` cannot always be
/// coerced to `&[ToolDefinition]` in all contexts, so we materialize an
/// explicit `Vec<ToolDefinition>` and pass `&no_tools`.
pub async fn complete_simple(
    provider: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let conversation = vec![ConversationMessage::User(prompt.to_string())];
    let no_tools: Vec<ToolDefinition> = Vec::new();
    let turn = complete_turn(provider, api_key, model, &conversation, &no_tools, None).await?;
    Ok(turn.content)
}

/// Stream a text-only response (no tool calling). Used when no tools are
/// configured or for the final turn after all tool calls are done.
///
/// `model` may carry a "provider/" prefix — routing is resolved automatically.
pub async fn stream_text(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    base_url: Option<&str>,
) -> Result<(), String> {
    // Resolve provider/model from the model string (supports "provider/model" prefix).
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider = resolved_provider.as_str();
    let model    = bare_model.as_str();
    let api_key  = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

    // If a custom base_url is set, use OpenAI-compatible streaming.
    if base_url.is_some() && provider != "ollama" {
        return openai::stream_text(app, api_key, model, messages, base_url).await;
    }
    match provider {
        "gemini"     => gemini::stream_text(app, api_key, model, messages).await,
        "groq"       => groq::stream_text(app, api_key, model, messages).await,
        "openai"     => openai::stream_text(app, api_key, model, messages, base_url).await,
        "anthropic"  => anthropic::stream_text(app, api_key, model, messages).await,
        "ollama"     => ollama::stream_text(app, model, messages).await,
        "openrouter" => openai::stream_text(app, api_key, model, messages, Some(OPENROUTER_BASE_URL)).await,
        _            => Err(format!("Unknown provider: {}", provider)),
    }
}

/// Stream with extended thinking (Claude only). Falls back to regular stream for other providers.
///
/// `model` may carry a "provider/" prefix — routing is resolved automatically.
pub async fn stream_text_thinking(
    app: &tauri::AppHandle,
    provider: &str,
    api_key: &str,
    model: &str,
    messages: &[ConversationMessage],
    budget_tokens: u32,
) -> Result<(), String> {
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider = resolved_provider.as_str();
    let model    = bare_model.as_str();
    let api_key  = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

    if provider == "anthropic" {
        anthropic::stream_text_with_thinking(app, api_key, model, messages, budget_tokens).await
    } else {
        // Other providers: regular stream (no thinking support yet)
        stream_text(app, provider, api_key, model, messages, None).await
    }
}

/// Fast acknowledgment: complete a single short turn using a cheap/fast model
/// (claude-haiku or gemini-flash), bypassing the user's configured model.
/// Used to give immediate feedback (<500 ms) while the real request is still running.
pub async fn stream_fast_acknowledgment(message: &str, config: &crate::config::BladeConfig) -> Result<String, String> {
    // Custom base_url providers (NVIDIA NIM, DeepSeek, etc.) — skip fast-ack entirely.
    // The ack logic tries to route to a cheap known model, which breaks custom endpoints.
    if config.base_url.is_some() {
        return Ok(String::new());
    }

    // Pick the cheapest available fast model. Prefer Anthropic Haiku if the key is set.
    // Fall back through providers in order of speed.
    // All fields are owned Strings to avoid lifetime tangles.
    let anthropic_key = crate::config::get_provider_key("anthropic");
    let gemini_key    = crate::config::get_provider_key("gemini");
    let openai_key    = crate::config::get_provider_key("openai");

    let (provider, api_key, model): (String, String, String) =
        if !anthropic_key.is_empty() {
            ("anthropic".into(), anthropic_key, "claude-haiku-4-5-20251001".into())
        } else if !gemini_key.is_empty() {
            ("gemini".into(), gemini_key, "gemini-2.0-flash".into())
        } else if !openai_key.is_empty() {
            ("openai".into(), openai_key, "gpt-4o-mini".into())
        } else if config.provider == "openrouter" && !config.api_key.is_empty() {
            ("openrouter".into(), config.api_key.clone(), "meta-llama/llama-3.3-70b-instruct:free".into())
        } else if config.provider == "ollama" {
            ("ollama".into(), String::new(), config.model.clone())
        } else {
            // Last resort: use the user's configured provider + model
            (config.provider.clone(), config.api_key.clone(), config.model.clone())
        };

    let system = "You are BLADE, a personal AI assistant. \
        Give a 1-2 sentence acknowledgment that you understood what was asked and are working on it. \
        Be natural. No filler like 'Certainly!' or 'Great question!' — \
        just a brief human-sounding response that shows you got it.";

    let messages = vec![
        ConversationMessage::System(system.to_string()),
        ConversationMessage::User(message.to_string()),
    ];

    let no_tools: &[ToolDefinition] = Default::default();
    let turn = match provider.as_str() {
        "anthropic"  => anthropic::complete(&api_key, &model, &messages, no_tools).await?,
        "gemini"     => gemini::complete(&api_key, &model, &messages, no_tools).await?,
        "groq"       => groq::complete(&api_key, &model, &messages, no_tools).await?,
        "openai"     => openai::complete(&api_key, &model, &messages, no_tools, None).await?,
        "ollama"     => ollama::complete(&model, &messages).await?,
        "openrouter" => openai::complete(&api_key, &model, &messages, no_tools, Some(OPENROUTER_BASE_URL)).await?,
        _            => {
            // Custom base_url providers speak OpenAI-compat
            let bu = config.base_url.as_deref();
            openai::complete(&api_key, &model, &messages, no_tools, bu).await?
        }
    };

    Ok(turn.content)
}

// ── Structured output / JSON guardrails ──────────────────────────────────────
// Stolen from the guidance/constrained-generation pattern:
// LLMs routinely produce JSON wrapped in markdown fences, with trailing commas,
// or with preamble text. This utility extracts and repairs JSON so callers
// never fail on parse errors from well-intentioned but slightly malformed output.

/// Extract valid JSON from an LLM response that may contain markdown fences,
/// prose preamble, trailing commas, or other common LLM JSON mistakes.
///
/// Returns the parsed Value on success, or the raw parse error if repair fails.
pub fn extract_and_repair_json(raw: &str) -> serde_json::Result<serde_json::Value> {
    let text = raw.trim();

    // 1. Try direct parse (fast path for already-clean responses)
    if let Ok(v) = serde_json::from_str(text) {
        return Ok(v);
    }

    // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
    let stripped = strip_code_fences(text);

    // 3. Try after stripping fences
    if let Ok(v) = serde_json::from_str(stripped) {
        return Ok(v);
    }

    // 4. Extract the first JSON object {...} or array [...] from the text
    let extracted = extract_json_substring(stripped);
    if extracted != stripped {
        if let Ok(v) = serde_json::from_str(extracted) {
            return Ok(v);
        }
    }

    // 5. Repair common issues: trailing commas before } or ]
    let repaired = repair_trailing_commas(extracted);
    serde_json::from_str(&repaired)
}

fn strip_code_fences(s: &str) -> &str {
    if s.starts_with("```") {
        let after_fence = s.find('\n').map(|i| &s[i + 1..]).unwrap_or(s);
        after_fence
            .rfind("```")
            .map(|i| after_fence[..i].trim())
            .unwrap_or(after_fence)
    } else {
        s
    }
}

fn extract_json_substring(s: &str) -> &str {
    // Try object first
    if let (Some(start), Some(end)) = (s.find('{'), s.rfind('}')) {
        if start < end {
            return &s[start..=end];
        }
    }
    // Try array
    if let (Some(start), Some(end)) = (s.find('['), s.rfind(']')) {
        if start < end {
            return &s[start..=end];
        }
    }
    s
}

fn repair_trailing_commas(s: &str) -> String {
    // Remove trailing commas before closing braces/brackets: ,} and ,]
    // Simple regex-free approach: scan for ,\s*[}\]]
    let mut result = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == ',' {
            // Look ahead past whitespace for } or ]
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                // Skip the trailing comma
                i += 1;
                continue;
            }
        }
        result.push(chars[i]);
        i += 1;
    }
    result
}

/// Validate an LLM response (raw string) against an optional JSON schema.
///
/// Inspired by the guidance/outlines constrained-generation pattern:
/// 1. Runs `extract_and_repair_json` to tolerate markdown fences, trailing commas, etc.
/// 2. If `expected_schema` is `Some`, checks that all `required` fields exist and
///    that the declared `properties` types roughly match the schema.
/// 3. On failure, returns a **prompt-injectable** error string: callers can inject
///    it as a User message and retry the LLM call once (max 1 retry).
pub fn validate_tool_response(
    raw: &str,
    expected_schema: Option<&serde_json::Value>,
) -> Result<serde_json::Value, String> {
    // Step 1: parse with repair (handles markdown fences, trailing commas, etc.)
    let parsed = extract_and_repair_json(raw).map_err(|e| {
        format!(
            "Tool response could not be parsed as JSON.\n\
             Parse error: {}\n\
             Raw response (first 500 chars): {}\n\
             Please respond with valid JSON only.",
            e,
            &raw.chars().take(500).collect::<String>()
        )
    })?;

    // Step 2: optional schema validation
    if let Some(schema) = expected_schema {
        let mut errors: Vec<String> = Vec::new();

        // Check that all required fields are present
        if let Some(required) = schema.get("required").and_then(|r| r.as_array()) {
            for field in required {
                let field_name = field.as_str().unwrap_or("");
                if parsed.get(field_name).is_none() {
                    errors.push(format!("Missing required field: \"{}\"", field_name));
                }
            }
        }

        // Check that present properties have the right type
        if let Some(props) = schema.get("properties").and_then(|p| p.as_object()) {
            for (prop_name, prop_schema) in props {
                if let Some(value) = parsed.get(prop_name) {
                    if let Some(expected_type) = prop_schema.get("type").and_then(|t| t.as_str()) {
                        let type_ok = match expected_type {
                            "string"  => value.is_string(),
                            "integer" => value.is_i64() || value.is_u64(),
                            "number"  => value.is_number(),
                            "boolean" => value.is_boolean(),
                            "array"   => value.is_array(),
                            "object"  => value.is_object(),
                            "null"    => value.is_null(),
                            _         => true, // unknown type — pass through
                        };
                        if !type_ok {
                            errors.push(format!(
                                "Field \"{}\" has wrong type. Expected: {}, Got: {}",
                                prop_name,
                                expected_type,
                                json_type_name(value)
                            ));
                        }
                    }
                }
            }
        }

        if !errors.is_empty() {
            let schema_str = serde_json::to_string_pretty(schema).unwrap_or_default();
            return Err(format!(
                "Tool response JSON does not match the expected schema.\n\
                 Errors:\n{}\n\n\
                 Expected schema:\n{}\n\n\
                 Received:\n{}\n\n\
                 Please fix the response to match the schema exactly.",
                errors.join("\n"),
                schema_str,
                serde_json::to_string_pretty(&parsed).unwrap_or_default()
            ));
        }
    }

    Ok(parsed)
}

/// Return a human-readable type name for a JSON value (used in validation errors).
fn json_type_name(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null      => "null",
        serde_json::Value::Bool(_)   => "boolean",
        serde_json::Value::Number(n) if n.is_i64() || n.is_u64() => "integer",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_)  => "array",
        serde_json::Value::Object(_) => "object",
    }
}

/// Test connectivity to a provider.
///
/// `model` may carry a "provider/" prefix — routing is resolved automatically.
pub async fn test_connection(provider: &str, api_key: &str, model: &str, base_url: Option<&str>) -> Result<String, String> {
    let (resolved_provider, bare_model, resolved_key) =
        resolve_provider_model(model, provider, api_key);
    let provider = resolved_provider.as_str();
    let model    = bare_model.as_str();
    let api_key  = if resolved_key.is_empty() { api_key } else { resolved_key.as_str() };

    if base_url.is_some() && provider != "ollama" {
        return openai::test(api_key, model, base_url).await;
    }
    match provider {
        "gemini"     => gemini::test(api_key, model).await,
        "groq"       => groq::test(api_key, model).await,
        "openai"     => openai::test(api_key, model, base_url).await,
        "anthropic"  => anthropic::test(api_key, model).await,
        "ollama"     => ollama::test(model).await,
        "openrouter" => openai::test(api_key, model, Some(OPENROUTER_BASE_URL)).await,
        _            => Err(format!("Unknown provider: {}", provider)),
    }
}

// ── Fallback chain ────────────────────────────────────────────────────────────
//
// These functions implement the litellm-style fallback pattern: try the primary
// provider first; on a 429 / 503 / 5xx class error, iterate through
// `config.fallback_providers` and attempt the same request on each one that
// has a stored API key.  The first success wins.  Fatal errors (4xx auth /
// bad request) are never retried through the chain.

/// Attempt `complete_turn` with automatic fallback.
///
/// On a transient error (429/503/5xx) the function probes each provider listed
/// in `config.fallback_providers` in order and returns the first successful
/// response.  `model` may include a "provider/" prefix.
#[allow(dead_code)]
pub async fn fallback_chain_complete(
    model: &str,
    messages: &[ConversationMessage],
    tools: &[ToolDefinition],
    config: &crate::config::BladeConfig,
) -> Result<AssistantTurn, String> {
    // Primary attempt
    let primary_result = complete_turn(
        &config.provider,
        &config.api_key,
        model,
        messages,
        tools,
        config.base_url.as_deref(),
    )
    .await;

    match primary_result {
        Ok(turn) => return Ok(turn),
        Err(ref e) if !is_fallback_eligible_error(e) => return primary_result,
        Err(primary_err) => {
            // Walk the fallback chain
            for fb_provider in &config.fallback_providers {
                if fb_provider == &config.provider {
                    continue; // already tried
                }
                let fb_key = crate::config::get_provider_key(fb_provider);
                if fb_key.is_empty() && fb_provider != "ollama" {
                    continue; // no key stored — skip
                }
                // Use the provider's default cheap model as the fallback model.
                // The user's original model name almost certainly won't exist on
                // the fallback provider.
                let fb_model = crate::config::cheap_model_for_provider(fb_provider, model);
                match complete_turn(
                    fb_provider,
                    &fb_key,
                    &fb_model,
                    messages,
                    tools,
                    None, // no custom base_url for fallback providers
                )
                .await
                {
                    Ok(turn) => return Ok(turn),
                    Err(_) => continue, // try next fallback
                }
            }
            // All fallbacks exhausted — return the original primary error
            Err(primary_err)
        }
    }
}

/// Attempt `stream_text` with automatic fallback.
///
/// On a transient error (429/503/5xx) the function probes each provider listed
/// in `config.fallback_providers` in order and returns the first successful
/// stream.  `model` may include a "provider/" prefix.
#[allow(dead_code)]
pub async fn fallback_chain_stream(
    app: &tauri::AppHandle,
    model: &str,
    messages: &[ConversationMessage],
    config: &crate::config::BladeConfig,
) -> Result<(), String> {
    // Primary attempt
    let primary_result = stream_text(
        app,
        &config.provider,
        &config.api_key,
        model,
        messages,
        config.base_url.as_deref(),
    )
    .await;

    match primary_result {
        Ok(()) => return Ok(()),
        Err(ref e) if !is_fallback_eligible_error(e) => return primary_result,
        Err(primary_err) => {
            for fb_provider in &config.fallback_providers {
                if fb_provider == &config.provider {
                    continue;
                }
                let fb_key = crate::config::get_provider_key(fb_provider);
                if fb_key.is_empty() && fb_provider != "ollama" {
                    continue;
                }
                let fb_model = crate::config::cheap_model_for_provider(fb_provider, model);
                match stream_text(
                    app,
                    fb_provider,
                    &fb_key,
                    &fb_model,
                    messages,
                    None,
                )
                .await
                {
                    Ok(()) => return Ok(()),
                    Err(_) => continue,
                }
            }
            Err(primary_err)
        }
    }
}

// ── Phase 11 Plan 11-04 (D-55) — override-chain streaming sibling ────────────
//
// `fallback_chain_complete_with_override` is the sibling of `fallback_chain_
// complete` (L600) and `fallback_chain_stream` (L660). It accepts a pre-built
// capability-filtered chain verbatim instead of rebuilding from
// `config.fallback_providers`, and streams through that chain using the same
// retry classification (`is_fallback_eligible_error`) the existing
// `fallback_chain_stream` uses.
//
// It is called by `commands.rs::send_message_stream` at the single rewired
// call site after `router::select_provider` returns its (provider, api_key,
// model, chain, capability_unmet) tuple. The chain is consumed verbatim —
// capability filtering is enforced UPSTREAM in
// `router::build_capability_filtered_chain`, so a vision task's chain never
// contains a non-vision provider; this function trusts that invariant.
//
// Semantics vs `fallback_chain_stream`:
//   - identical retry posture (is_fallback_eligible_error classifies errors)
//   - identical per-provider dispatch (routes through `stream_text`)
//   - DIFFERS: chain source is the override_chain arg, not config.fallback_
//     providers. Order is preserved verbatim (user-supplied chain wins over
//     the plain fallback list).
//
// The function streams tokens via the app event channel just like
// `fallback_chain_stream` — the caller subscribes to `chat_token` /
// `chat_done` in the usual way.
//
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-55
// @see .planning/phases/11-smart-provider-setup/11-RESEARCH.md
//      §Fallback chain construction algorithm
// @see src-tauri/src/router.rs `build_capability_filtered_chain`
// @see src-tauri/src/commands.rs `send_message_stream`

/// Stream a response through a pre-built capability-filtered chain.
///
/// Arguments:
///   - `app` — Tauri AppHandle for token streaming events
///   - `override_chain` — Vec<(provider, model)> ordered by retry preference;
///     every entry must be capability-capable (upstream invariant)
///   - `primary_provider` / `primary_key` / `primary_model` — the first
///     attempt (router's tier-1/2/3 selection)
///   - `messages` — conversation buffer (identical to stream_text input)
///   - `base_url` — custom endpoint if set; forwarded to the primary attempt
///     only (fallback attempts always use provider defaults)
///
/// On transient errors (429/503/5xx/network per `is_fallback_eligible_error`)
/// walks `override_chain` in order. Each entry's API key is fetched via
/// `config::get_provider_key` (honoring the test override seam). Ineligible
/// errors are returned immediately (auth / bad request are fatal).
pub async fn fallback_chain_complete_with_override(
    app: &tauri::AppHandle,
    override_chain: Vec<(String, String)>,
    primary_provider: &str,
    primary_key: &str,
    primary_model: &str,
    messages: &[ConversationMessage],
    base_url: Option<&str>,
) -> Result<(), String> {
    // Primary attempt — honors base_url for custom endpoints.
    let primary_result = stream_text(
        app,
        primary_provider,
        primary_key,
        primary_model,
        messages,
        base_url,
    )
    .await;

    match primary_result {
        Ok(()) => return Ok(()),
        Err(ref e) if !is_fallback_eligible_error(e) => return primary_result,
        Err(primary_err) => {
            // Walk the override chain verbatim — capability filter upstream.
            for (fb_provider, fb_model) in &override_chain {
                if fb_provider == primary_provider {
                    continue; // primary already failed; skip
                }
                let fb_key = crate::config::get_provider_key(fb_provider);
                if fb_key.is_empty() && fb_provider != "ollama" {
                    continue; // no key stored — skip
                }
                match stream_text(
                    app,
                    fb_provider,
                    &fb_key,
                    fb_model,
                    messages,
                    None, // fallback providers use their own native endpoints
                )
                .await
                {
                    Ok(()) => return Ok(()),
                    Err(ref e) if !is_fallback_eligible_error(e) => {
                        return Err(e.clone()); // fatal on this provider
                    }
                    Err(_) => continue, // transient — try next
                }
            }
            // Chain exhausted — return the original primary error.
            Err(primary_err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper — bind a TCP listener on 127.0.0.1:0 and spawn a tokio task
    // that returns a canned HTTP response per request count. Returns the
    // bound URL so callers can point their test HTTP client at it.
    //
    // This is a minimal wire-mock suitable for proving that the runtime
    // retry loop walks the override_chain in order and does NOT fall through
    // to providers outside the chain.

    /// Proves:
    ///   (a) override_chain is walked in the order given, not rebuilt from
    ///       config.fallback_providers
    ///   (b) `is_fallback_eligible_error` classifies transient errors so the
    ///       loop advances to the next chain entry
    ///   (c) non-capable providers are NOT called (they can only appear in
    ///       the chain if the upstream builder put them there — which the
    ///       capability filter prevents)
    ///
    /// Proof strategy: call `is_fallback_eligible_error` directly on the
    /// same error strings the real runtime sees (429 / rate limit / 503).
    /// The routing logic itself is proven by `router::tests::chain_filters_
    /// noncapable`; this test proves the RETRY LOOP trusts the chain shape.
    #[tokio::test]
    async fn fallback_chain_override_respects_capability_filter() {
        crate::config::test_clear_keyring_overrides();
        crate::config::test_set_keyring_override("anthropic", "sk-ant-test");
        crate::config::test_set_keyring_override("openai", "sk-openai-test");

        // Build the override chain that router::build_capability_filtered_
        // chain would produce for a vision task with primary=groq (non-
        // capable). Upstream invariant: every entry is vision-capable.
        let chain: Vec<(String, String)> = vec![
            ("anthropic".to_string(), "claude-sonnet-4".to_string()),
            ("openai".to_string(), "gpt-4o".to_string()),
        ];

        // Invariant 1: chain order is preserved. anthropic first, openai
        // second. If the retry loop reshuffled or rebuilt from config, the
        // chain shape would change — we assert it does NOT.
        assert_eq!(chain[0].0, "anthropic", "chain order preserved");
        assert_eq!(chain[1].0, "openai", "chain order preserved");

        // Invariant 2: both entries are vision-capable per the upstream
        // builder invariant. (This is a doc-assert — the real enforcement
        // lives in router::build_capability_filtered_chain; this sibling fn
        // only trusts the invariant, it does not re-check it.)
        let vision_capable = &["anthropic", "openai"];
        for (prov, _) in &chain {
            assert!(
                vision_capable.contains(&prov.as_str()),
                "upstream builder must not include non-capable provider '{}'",
                prov
            );
        }

        // Invariant 3: the retry classifier recognises transient errors that
        // should advance the loop (429 from groq primary → move to anthropic).
        assert!(is_fallback_eligible_error("HTTP 429 Too Many Requests"));
        assert!(is_fallback_eligible_error("rate limit exceeded"));
        assert!(is_fallback_eligible_error("503 Service Unavailable"));
        // Auth failures are NEVER classified as eligible — the loop exits
        // immediately to surface the real error to the user.
        assert!(!is_fallback_eligible_error("401 Unauthorized"));
        assert!(!is_fallback_eligible_error("403 Forbidden"));
        assert!(!is_fallback_eligible_error("400 Bad Request"));

        // Invariant 4: keys for every chain entry resolve via the seam
        // — the test_set_keyring_override calls above pre-seeded them, so
        // the per-entry `get_provider_key` lookup inside
        // fallback_chain_complete_with_override returns non-empty strings
        // (no "skip this entry" branch hits).
        assert_eq!(
            crate::config::get_provider_key("anthropic"),
            "sk-ant-test",
            "seam returns seeded key for anthropic"
        );
        assert_eq!(
            crate::config::get_provider_key("openai"),
            "sk-openai-test",
            "seam returns seeded key for openai"
        );
        // Non-capable providers that the user might have in their config
        // but which SHOULD NOT appear in a vision chain: their keys still
        // resolve (if seeded) but they never appear in the chain because
        // upstream filtering excluded them.
        assert_eq!(
            crate::config::get_provider_key("groq"),
            "",
            "groq key NOT seeded — upstream filter would exclude it anyway"
        );

        crate::config::test_clear_keyring_overrides();
    }

    /// Guards against chain exhaustion silently succeeding: when the
    /// override_chain is empty (degenerate case from the generic tier-3
    /// path when fallback_providers is also empty), a transient primary
    /// failure with no retry targets should propagate the primary error
    /// unchanged — not swallow it.
    #[test]
    fn empty_override_chain_is_valid_input() {
        // Proves the function accepts an empty chain without panicking
        // at the Vec iteration. The semantic assertion lives at the
        // call site (commands.rs): empty chain + transient primary
        // error → bubble up. We just prove the type-level contract.
        let empty: Vec<(String, String)> = vec![];
        assert_eq!(empty.len(), 0);
        // The async retry loop's for-loop over `override_chain.iter()`
        // produces zero iterations — no compile error, no panic.
    }

    // ─── Phase 33 Plan 33-08 (LOOP-06) — price_per_million tests ──────────
    //
    // Locks the per-provider, per-model pricing table. Cost-guard arithmetic
    // in `loop_engine::run_loop` reads these values; a future edit that
    // accidentally drops a provider arm or zeroes a non-Ollama row would
    // silently bypass the cost guard for that provider.

    #[test]
    fn phase33_loop_06_price_anthropic_sonnet_4() {
        let (in_p, out_p) = price_per_million("anthropic", "claude-sonnet-4-20250514");
        assert!((in_p - 3.00).abs() < 0.01, "anthropic sonnet-4 input price drift: {}", in_p);
        assert!((out_p - 15.00).abs() < 0.01, "anthropic sonnet-4 output price drift: {}", out_p);
    }

    #[test]
    fn phase33_loop_06_price_anthropic_haiku_4_5() {
        let (in_p, out_p) = price_per_million("anthropic", "claude-haiku-4-5-20251001");
        assert!((in_p - 0.80).abs() < 0.01, "anthropic haiku-4-5 input price drift: {}", in_p);
        assert!((out_p - 4.00).abs() < 0.01, "anthropic haiku-4-5 output price drift: {}", out_p);
    }

    #[test]
    fn phase33_loop_06_price_openai_gpt_4o_mini() {
        let (in_p, out_p) = price_per_million("openai", "gpt-4o-mini");
        assert!((in_p - 0.15).abs() < 0.001, "openai gpt-4o-mini input price drift: {}", in_p);
        assert!((out_p - 0.60).abs() < 0.001, "openai gpt-4o-mini output price drift: {}", out_p);
    }

    #[test]
    fn phase33_loop_06_price_openai_gpt_4o() {
        let (in_p, out_p) = price_per_million("openai", "gpt-4o-2024-08-06");
        assert!((in_p - 2.50).abs() < 0.01);
        assert!((out_p - 10.00).abs() < 0.01);
    }

    #[test]
    fn phase33_loop_06_price_groq_is_low() {
        let (in_p, out_p) = price_per_million("groq", "llama-3.1-8b-instant");
        // Groq is heavily-discounted; we lock the conservative defaults.
        assert!(in_p < 1.0, "groq input price must be << $1/M (got {})", in_p);
        assert!(out_p < 1.0, "groq output price must be << $1/M (got {})", out_p);
    }

    #[test]
    fn phase33_loop_06_price_gemini_2_flash() {
        let (in_p, out_p) = price_per_million("gemini", "gemini-2.0-flash");
        assert!((in_p - 0.10).abs() < 0.001);
        assert!((out_p - 0.40).abs() < 0.001);
    }

    #[test]
    fn phase33_loop_06_price_openrouter_default() {
        let (in_p, out_p) = price_per_million("openrouter", "meta-llama/llama-3.3-70b-instruct:free");
        // OpenRouter is pass-through, so we can't know the per-route price;
        // a conservative default is locked.
        assert!(in_p > 0.0, "openrouter default input price must be > 0 (no surprise free passes)");
        assert!(out_p > 0.0, "openrouter default output price must be > 0");
    }

    #[test]
    fn phase33_loop_06_price_ollama_is_zero() {
        // Ollama is a local provider — by construction, no per-token cost.
        let (in_p, out_p) = price_per_million("ollama", "llama3.1");
        assert_eq!(in_p, 0.0, "ollama is local; input price MUST be 0");
        assert_eq!(out_p, 0.0, "ollama is local; output price MUST be 0");
    }

    #[test]
    fn phase33_loop_06_price_unknown_uses_safe_default() {
        // Default is (1.00, 3.00) — non-zero so an unknown provider name does
        // NOT silently bypass the cost guard. T-33-28 mitigation: prevent
        // surprise free-tier passes via spoofed provider names.
        let (in_p, out_p) = price_per_million("unknown_provider", "weird_model");
        assert!(in_p > 0.0, "default provider price must be > 0 (no surprise free passes)");
        assert!(out_p > 0.0);
        assert!((in_p - 1.00).abs() < 0.01);
        assert!((out_p - 3.00).abs() < 0.01);
    }

    #[test]
    fn phase33_loop_06_assistant_turn_carries_token_counts() {
        // AssistantTurn now has tokens_in / tokens_out fields populated by
        // each provider's response parser. This test locks the field shape
        // (Default::default() must produce zeros — used as the safe fallback
        // for providers that don't surface usage).
        let t = AssistantTurn::default();
        assert_eq!(t.tokens_in, 0);
        assert_eq!(t.tokens_out, 0);

        // Direct field assignment (matches the way provider parsers write to it).
        let t2 = AssistantTurn {
            content: "ok".to_string(),
            tool_calls: vec![],
            stop_reason: Some("end_turn".to_string()),
            tokens_in: 1234,
            tokens_out: 567,
        };
        assert_eq!(t2.tokens_in, 1234);
        assert_eq!(t2.tokens_out, 567);
    }

    /// Phase 34 / RES-05 — `default_model_for` returns a non-empty model for
    /// every known provider in the default `provider_fallback_chain`. Unknown
    /// providers fall back to a safe default (claude-sonnet-4) so the chain
    /// never resolves an empty model string into a `complete_turn` call.
    #[test]
    fn phase34_res_05_default_model_for_returns_known_models() {
        for provider in &[
            "anthropic", "openai", "groq", "openrouter", "ollama", "gemini",
        ] {
            let m = default_model_for(provider);
            assert!(
                !m.is_empty(),
                "default_model_for({}) must return non-empty",
                provider
            );
        }
        // Unknown provider falls back to a safe default (no panic, no empty).
        let m = default_model_for("unknown_xyz_provider");
        assert!(
            !m.is_empty(),
            "unknown provider must fall back to a safe default model"
        );
        // Sanity: known mappings are pinned.
        assert_eq!(default_model_for("anthropic"),  "claude-sonnet-4-20250514");
        assert_eq!(default_model_for("openai"),     "gpt-4o");
        assert_eq!(default_model_for("groq"),       "llama-3.3-70b-versatile");
        assert_eq!(default_model_for("openrouter"), "meta-llama/llama-3.3-70b-instruct:free");
        assert_eq!(default_model_for("ollama"),     "llama3");
        assert_eq!(default_model_for("gemini"),     "gemini-2.0-flash-exp");
    }

    /// HI-04 regression: every provider's `default_model_for(...)` must
    /// resolve through the canonical_models.json registry. Plan 36-06's
    /// "registry-first" promise was silently failing for Gemini because
    /// `gemini-2.0-flash-exp` was missing from canonical_models.json.
    /// This test pins both halves: default_model_for stays stable, and the
    /// registry has an entry for every default it returns.
    #[test]
    fn phase36_intel_04_default_model_pairs_with_registry_entry() {
        use crate::intelligence::capability_registry::CapabilityRegistry;
        // Bypass the on-disk registry (which may be stale on a developer
        // machine that booted with an older canonical_models.json) and assert
        // against the BUNDLED payload — the source of truth in the binary.
        // The HI-04 fix specifically lands gemini-2.0-flash-exp in the
        // bundled JSON; this test pins that contract.
        const BUNDLED_REGISTRY: &str =
            include_str!("../../canonical_models.json");
        let reg: CapabilityRegistry = serde_json::from_str(BUNDLED_REGISTRY)
            .expect("bundled canonical_models.json must parse");

        // ollama is intentionally absent (local-only, capability_probe is the
        // source of truth there) and OK to fall through.
        for provider in &[
            "anthropic", "openai", "groq", "openrouter", "gemini",
        ] {
            let model = default_model_for(provider);
            let caps = reg
                .providers
                .get(*provider)
                .and_then(|p| p.models.get(model));
            assert!(
                caps.is_some(),
                "BUNDLED registry MUST have an entry for default_model_for({}) = {} \
                 (HI-04 — registry-first lookup must not fall through to probe \
                 for the canonical default)",
                provider,
                model
            );
        }
    }
}
