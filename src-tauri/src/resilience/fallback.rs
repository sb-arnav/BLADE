// src-tauri/src/resilience/fallback.rs
//
// Phase 34 / RES-05 — provider fallback chain with exponential backoff + jitter.
//
// Plan 34-03 shipped the FallbackExhausted struct + try_with_fallback stub.
// Plan 34-07 fills the body (chain walk, retries, exponential backoff with
// jitter, RES_FORCE_PROVIDER_ERROR test seam).

use crate::config::BladeConfig;
use crate::providers::{self, AssistantTurn, ConversationMessage, ToolDefinition};

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
        write!(
            f,
            "All providers in fallback chain exhausted ({} tried, last error: {})",
            self.chain_len, self.last_error
        )
    }
}

impl std::error::Error for FallbackExhausted {}

// Plan 34-07 — test-only override seams.
//
// RES_FORCE_PROVIDER_ERROR — when set, every provider call inside
// `try_with_fallback_inner` returns Err(forced_error) instead of hitting the
// network. Used to deterministically exhaust the chain in tests without
// making real API calls.
//
// RES_CAPTURED_ATTEMPTS — Phase 34 / HI-02 (REVIEW finding) — test-only
// capture of the (provider, model) tuple passed to each `complete_turn`
// attempt inside `try_with_fallback_inner`. Used by
// `phase34_res_05_primary_uses_user_configured_model` to verify the PRIMARY
// chain element forwards `config.model` (not `default_model_for(config.provider)`).
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_PROVIDER_ERROR: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };

    pub(crate) static RES_CAPTURED_ATTEMPTS: std::cell::RefCell<Vec<(String, String)>> =
        const { std::cell::RefCell::new(Vec::new()) };
}

/// RES-05 — generalises `commands::try_free_model_fallback`. Walks the chain
/// in `BladeConfig.resilience.provider_fallback_chain`; for each chain element,
/// retries up to `max_retries_per_provider` times with exponential backoff +
/// jitter. Returns Ok(turn) on first success; Err(FallbackExhausted) if every
/// provider in the chain fails every retry.
///
/// Per CONTEXT lock §RES-05, fallback is independent of the circuit breaker:
/// the same successful fallback (after retries) still resets the circuit on
/// success. Intermediate failures emit no chat_error — silent fallover within
/// the chain. Only chain exhaustion surfaces to the user.
///
/// Smart-off behavior: when `smart_resilience_enabled = false`, collapse to a
/// single attempt on `config.provider` — Phase 33 posture preserved (CTX-07).
///
/// The `_app` parameter is reserved for future emit hooks (e.g. surfacing
/// fallback-exhausted as `blade_loop_event` during runtime). Today it is
/// unused; the deprecated `commands::try_free_model_fallback` alias still
/// passes its `app` so the signature stays stable for the dozen call sites
/// that already wired it.
pub async fn try_with_fallback(
    config: &BladeConfig,
    conversation: &[ConversationMessage],
    tools: &[ToolDefinition],
    _app: &tauri::AppHandle,
) -> Result<AssistantTurn, FallbackExhausted> {
    try_with_fallback_inner(config, conversation, tools).await
}

/// Inner chain-walk implementation. Split out from `try_with_fallback` so
/// unit tests can exercise the chain logic without constructing a real
/// `tauri::AppHandle` (the `tauri::test` feature is not enabled in this
/// project — see `reward.rs:660` for prior art on this trade-off).
pub(crate) async fn try_with_fallback_inner(
    config: &BladeConfig,
    conversation: &[ConversationMessage],
    tools: &[ToolDefinition],
) -> Result<AssistantTurn, FallbackExhausted> {
    // ---- Smart-off path (CTX-07): single attempt on config.provider ------
    if !config.resilience.smart_resilience_enabled {
        let provider = config.provider.as_str();
        // Phase 34 / HI-02 (REVIEW finding) — smart-off MUST honor the user's
        // explicitly-configured model on the primary attempt. Previously this
        // hardcoded `default_model_for(provider)`, which silently upgraded a
        // user on `claude-haiku-4-5` to `claude-sonnet-4` (5-10× more
        // expensive). Smart-off has only one attempt and that attempt is
        // always on `config.provider`, so use `config.model` directly.
        let model = config.model.as_str();
        let key = if provider == "ollama" {
            String::new()
        } else {
            crate::config::get_provider_key(provider)
        };

        // Test seam: deterministic Err without network.
        #[cfg(test)]
        {
            // HI-02 capture: record (provider, model) so the regression test
            // can assert config.model survived the smart-off path.
            RES_CAPTURED_ATTEMPTS.with(|c| {
                c.borrow_mut().push((provider.to_string(), model.to_string()))
            });
            let forced = RES_FORCE_PROVIDER_ERROR.with(|c| c.borrow().clone());
            if let Some(e) = forced {
                return Err(FallbackExhausted {
                    chain_len: 1,
                    last_error: e,
                });
            }
        }

        return match providers::complete_turn(provider, &key, model, conversation, tools, None)
            .await
        {
            Ok(t) => Ok(t),
            Err(e) => Err(FallbackExhausted {
                chain_len: 1,
                last_error: e,
            }),
        };
    }

    // ---- Smart-on path: walk the chain --------------------------------
    let chain = &config.resilience.provider_fallback_chain;
    let chain_len = chain.len();
    let mut last_error = String::from("no providers attempted");

    for chain_elem in chain {
        // "primary" resolves to BladeConfig.provider; otherwise use literal.
        // Phase 34 / HI-02 (REVIEW finding) — for the PRIMARY chain element
        // we must use the user's explicitly-configured `config.model`. Falling
        // back to `default_model_for(provider)` silently upgrades (e.g.) a
        // user on `claude-haiku-4-5` to the canonical Sonnet default — 5-10×
        // more expensive AND violates the explicit choice. Only non-primary
        // chain elements (the literal "openrouter"/"groq"/"ollama" entries)
        // fall through to `default_model_for(provider)` because the user
        // hasn't picked a specific model for those.
        let (provider, model): (&str, &str) = if chain_elem == "primary" {
            (config.provider.as_str(), config.model.as_str())
        } else {
            (chain_elem.as_str(), providers::default_model_for(chain_elem.as_str()))
        };
        let key = if provider == "ollama" {
            String::new()
        } else {
            crate::config::get_provider_key(provider)
        };
        // Skip elements with no key (except ollama which doesn't need one).
        if key.is_empty() && provider != "ollama" {
            last_error = format!("{}: no API key configured", provider);
            continue;
        }

        for attempt in 0..=config.resilience.max_retries_per_provider {
            // Test seam — bypasses real provider call.
            #[cfg(test)]
            {
                // HI-02 capture: record (provider, model) PER ATTEMPT so the
                // regression test can assert the PRIMARY chain element forwards
                // config.model (not default_model_for(provider)).
                RES_CAPTURED_ATTEMPTS.with(|c| {
                    c.borrow_mut().push((provider.to_string(), model.to_string()))
                });
                let forced = RES_FORCE_PROVIDER_ERROR.with(|c| c.borrow().clone());
                if let Some(e) = forced {
                    last_error = e;
                    if attempt < config.resilience.max_retries_per_provider {
                        // Cap test sleeps at 10ms so test suites stay fast.
                        let delay_ms = compute_backoff_ms(
                            config.resilience.backoff_base_ms,
                            config.resilience.backoff_max_ms,
                            attempt,
                        )
                        .min(10);
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    }
                    continue;
                }
            }

            match providers::complete_turn(provider, &key, model, conversation, tools, None).await
            {
                Ok(t) => return Ok(t),
                Err(e) => {
                    last_error = e;
                    if attempt < config.resilience.max_retries_per_provider {
                        let delay_ms = compute_backoff_ms(
                            config.resilience.backoff_base_ms,
                            config.resilience.backoff_max_ms,
                            attempt,
                        );
                        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                    }
                }
            }
        }
    }

    Err(FallbackExhausted {
        chain_len,
        last_error,
    })
}

/// RES-05 — exponential backoff with additive jitter.
///
/// `delay_ms = min(base_ms × 2^attempt, max_ms) + random(0..=200)`
///
/// Defaults (from `ResilienceConfig::default`): base=500, max=30_000. The
/// exponent is capped at 8 to avoid `u64` overflow when test configs pass
/// pathological attempt counts. Jitter is process-local via `rand::random`
/// (ThreadRng seeded by the OS — no entropy starvation surface; see
/// PLAN threat T-34-30).
fn compute_backoff_ms(base_ms: u64, max_ms: u64, attempt: u32) -> u64 {
    let exp = attempt.min(8); // 2^8 = 256 — already saturates min(_, max_ms) for normal configs.
    let delay = base_ms
        .saturating_mul(2u64.saturating_pow(exp))
        .min(max_ms);
    let jitter: u64 = rand::random::<u64>() % 201; // 0..=200 inclusive
    delay + jitter
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

    #[test]
    fn phase34_compute_backoff_ms_caps_at_max() {
        // 500 × 2^20 ≈ 524M; saturated at 30_000 + jitter (0..=200).
        let d = compute_backoff_ms(500, 30_000, 20);
        assert!(d >= 30_000, "got {} (must be at least max)", d);
        assert!(d <= 30_200, "got {} (must be at most max + jitter)", d);
    }

    #[test]
    fn phase34_compute_backoff_ms_grows_exponentially() {
        // Average across many samples to dampen jitter randomness.
        let mut sum0 = 0u64;
        let mut sum3 = 0u64;
        let n = 50;
        for _ in 0..n {
            sum0 += compute_backoff_ms(500, 30_000, 0);
            sum3 += compute_backoff_ms(500, 30_000, 3);
        }
        let avg0 = sum0 / n;
        let avg3 = sum3 / n;
        // attempt=0 → ~500 + jitter; attempt=3 → ~4000 + jitter.
        assert!(avg3 > avg0 + 1000, "avg0={} avg3={}", avg0, avg3);
    }

    /// Test config: small chain + tiny backoff so chain-exhaustion tests
    /// finish in milliseconds. Pre-seeds keyring overrides for every chain
    /// element so the "no key" skip branch does NOT short-circuit chain-len.
    fn test_config() -> BladeConfig {
        let mut c = BladeConfig::default();
        c.provider = "anthropic".to_string();
        c.api_key = "fake-key-anthropic".to_string();
        // Override the default 4-element chain with a 2-element chain to
        // bound test runtime. "primary" resolves to anthropic.
        c.resilience.provider_fallback_chain =
            vec!["primary".to_string(), "groq".to_string()];
        c.resilience.max_retries_per_provider = 1;
        c.resilience.backoff_base_ms = 1;
        c.resilience.backoff_max_ms = 5;
        c.resilience.smart_resilience_enabled = true;
        c
    }

    fn seed_test_keys() {
        crate::config::test_clear_keyring_overrides();
        crate::config::test_set_keyring_override("anthropic", "sk-ant-test");
        crate::config::test_set_keyring_override("groq", "groq-test");
        crate::config::test_set_keyring_override("openrouter", "or-test");
    }

    /// RES-05 — every provider in the chain returns Err(forced); the chain
    /// is fully exhausted; FallbackExhausted carries chain_len matching the
    /// configured chain length and last_error includes the forced text.
    #[tokio::test]
    async fn phase34_res_05_provider_fallback_chain_exhaustion() {
        seed_test_keys();
        RES_FORCE_PROVIDER_ERROR
            .with(|c| *c.borrow_mut() = Some("forced timeout".to_string()));
        let cfg = test_config();
        let conv: Vec<ConversationMessage> = vec![ConversationMessage::User("hi".into())];
        let tools: Vec<ToolDefinition> = Vec::new();
        let r = try_with_fallback_inner(&cfg, &conv, &tools).await;
        RES_FORCE_PROVIDER_ERROR.with(|c| *c.borrow_mut() = None);
        crate::config::test_clear_keyring_overrides();
        match r {
            Err(e) => {
                assert_eq!(e.chain_len, 2, "chain has 2 elements (primary, groq)");
                assert!(
                    e.last_error.contains("forced timeout"),
                    "last_error must contain forced text; got: {}",
                    e.last_error
                );
            }
            Ok(_) => panic!("expected FallbackExhausted with forced error"),
        }
    }

    /// CTX-07 — when smart_resilience_enabled=false, collapse to a single
    /// attempt on config.provider. No chain walk, no retries.
    #[tokio::test]
    async fn phase34_res_05_smart_off_collapses_to_single_attempt() {
        seed_test_keys();
        RES_FORCE_PROVIDER_ERROR
            .with(|c| *c.borrow_mut() = Some("forced".to_string()));
        let mut cfg = test_config();
        cfg.resilience.smart_resilience_enabled = false;
        let conv: Vec<ConversationMessage> = vec![ConversationMessage::User("hi".into())];
        let tools: Vec<ToolDefinition> = Vec::new();
        let r = try_with_fallback_inner(&cfg, &conv, &tools).await;
        RES_FORCE_PROVIDER_ERROR.with(|c| *c.borrow_mut() = None);
        crate::config::test_clear_keyring_overrides();
        match r {
            Err(e) => assert_eq!(
                e.chain_len, 1,
                "smart-off must collapse to single attempt (chain_len=1)"
            ),
            Ok(_) => panic!("expected FallbackExhausted on smart-off forced error"),
        }
    }

    /// RES-05 — a chain element with no API key (and not ollama) is silently
    /// skipped. Here the chain is just `["openrouter"]` with NO openrouter
    /// key seeded; the function must return FallbackExhausted with last_error
    /// indicating the missing key.
    #[tokio::test]
    async fn phase34_res_05_chain_skips_provider_with_no_key() {
        crate::config::test_clear_keyring_overrides();
        // Deliberately do NOT seed "openrouter".
        let mut cfg = test_config();
        cfg.resilience.provider_fallback_chain = vec!["openrouter".to_string()];
        cfg.resilience.max_retries_per_provider = 0;
        cfg.resilience.smart_resilience_enabled = true;
        let conv: Vec<ConversationMessage> = vec![ConversationMessage::User("hi".into())];
        let tools: Vec<ToolDefinition> = Vec::new();
        let r = try_with_fallback_inner(&cfg, &conv, &tools).await;
        crate::config::test_clear_keyring_overrides();
        match r {
            Err(e) => {
                assert_eq!(e.chain_len, 1, "chain has 1 element (openrouter, skipped)");
                assert!(
                    e.last_error.contains("openrouter")
                        && e.last_error.contains("no API key"),
                    "last_error must explain the missing key; got: {}",
                    e.last_error
                );
            }
            Ok(_) => panic!("expected FallbackExhausted when openrouter has no key"),
        }
    }

    /// Phase 34 / HI-02 (REVIEW finding) — the PRIMARY chain element must use
    /// the user's explicitly-configured `config.model` rather than
    /// `default_model_for(config.provider)`. A user on
    /// `claude-haiku-4-5-20251001` who hits a transient error must NOT be
    /// silently upgraded to `claude-sonnet-4-20250514` (the Anthropic default).
    /// The test config picks `anthropic` + `claude-haiku-4-5-20251001` and
    /// forces a chain walk via RES_FORCE_PROVIDER_ERROR; we then assert the
    /// captured-attempt list shows haiku for the primary attempt(s) and the
    /// non-primary defaults for any subsequent chain elements.
    #[tokio::test]
    async fn phase34_res_05_primary_uses_user_configured_model() {
        seed_test_keys();
        RES_FORCE_PROVIDER_ERROR
            .with(|c| *c.borrow_mut() = Some("forced".to_string()));
        RES_CAPTURED_ATTEMPTS.with(|c| c.borrow_mut().clear());

        let mut cfg = test_config();
        cfg.provider = "anthropic".to_string();
        cfg.model = "claude-haiku-4-5-20251001".to_string();
        // Chain: ["primary", "groq"] — primary resolves to anthropic + the
        // configured haiku model; groq resolves to its default.
        cfg.resilience.max_retries_per_provider = 1; // 2 attempts per element

        let conv: Vec<ConversationMessage> = vec![ConversationMessage::User("hi".into())];
        let tools: Vec<ToolDefinition> = Vec::new();
        let _ = try_with_fallback_inner(&cfg, &conv, &tools).await;
        let captured: Vec<(String, String)> =
            RES_CAPTURED_ATTEMPTS.with(|c| c.borrow().clone());
        RES_FORCE_PROVIDER_ERROR.with(|c| *c.borrow_mut() = None);
        RES_CAPTURED_ATTEMPTS.with(|c| c.borrow_mut().clear());
        crate::config::test_clear_keyring_overrides();

        // First attempt MUST be (anthropic, claude-haiku-4-5-20251001) — the
        // user's configured model, NOT the canonical Sonnet default.
        let first = captured.first().expect("at least one attempt captured");
        assert_eq!(
            first.0, "anthropic",
            "primary chain element resolves provider to config.provider"
        );
        assert_eq!(
            first.1, "claude-haiku-4-5-20251001",
            "primary chain element MUST forward config.model verbatim — \
             previously this hardcoded default_model_for(anthropic) which \
             silently upgraded haiku to sonnet (HI-02 regression). \
             Captured attempts: {:?}",
            captured
        );

        // Subsequent groq attempts (after primary fails the retry budget)
        // SHOULD use default_model_for("groq") because the user hasn't picked
        // a specific groq model.
        let groq_attempts: Vec<&(String, String)> =
            captured.iter().filter(|(p, _)| p == "groq").collect();
        if let Some(first_groq) = groq_attempts.first() {
            assert_eq!(
                first_groq.1, "llama-3.3-70b-versatile",
                "non-primary chain element falls back to default_model_for"
            );
        }
    }

    /// RES-05 — validate the RES_FORCE_PROVIDER_ERROR seam itself. Setting
    /// the seam must cause every chain attempt to record the forced text as
    /// the last_error (i.e. the seam IS being read inside the retry loop).
    #[tokio::test]
    async fn phase34_res_05_force_provider_error_seam_works() {
        seed_test_keys();
        RES_FORCE_PROVIDER_ERROR
            .with(|c| *c.borrow_mut() = Some("seam-marker-abc".to_string()));
        let cfg = test_config();
        let conv: Vec<ConversationMessage> = vec![ConversationMessage::User("hi".into())];
        let tools: Vec<ToolDefinition> = Vec::new();
        let r = try_with_fallback_inner(&cfg, &conv, &tools).await;
        RES_FORCE_PROVIDER_ERROR.with(|c| *c.borrow_mut() = None);
        crate::config::test_clear_keyring_overrides();
        match r {
            Err(e) => assert!(
                e.last_error.contains("seam-marker-abc"),
                "seam marker must propagate to FallbackExhausted.last_error; got: {}",
                e.last_error
            ),
            Ok(_) => panic!("expected FallbackExhausted with seam-marker error"),
        }
    }
}
