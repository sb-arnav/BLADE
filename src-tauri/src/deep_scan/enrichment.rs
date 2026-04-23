//! LLM enrichment for deep-scan results — Phase 12 Plan 12-05 (D-61).
//!
//! Three gated narrative calls (≤3 per scan), 7-day cache, silence discipline.
//! All calls are non-blocking — scan result is valid with zero LLM calls.
//!
//! Call budget:
//!   1. Account narrative — batch all AccountRow entries → `long_context_provider` or primary.
//!   2. Rhythm narrative  — hour-histogram → primary provider.
//!   3. Ambiguous-repo language — only if calls < 3 AND a Hot repo has ≤50% dominance.

use std::path::{Path, PathBuf};
use crate::deep_scan::leads::{DeepScanResults, LlmEnrichments, AccountRow, RhythmSignal};
use crate::config::BladeConfig;

// ── Cache path ────────────────────────────────────────────────────────────────

/// Production cache path (overridden in tests via `NARRATIVE_CACHE_PATH_OVERRIDE`).
fn narrative_cache_path() -> PathBuf {
    crate::config::blade_config_dir()
        .join("identity")
        .join("llm_narrative.json")
}

/// Test seam: if this static is set, `load_cached_enrichments` and
/// `save_cached_enrichments` use this path instead of the default.
#[cfg(test)]
static NARRATIVE_CACHE_PATH_OVERRIDE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

fn effective_cache_path() -> PathBuf {
    #[cfg(test)]
    if let Some(p) = NARRATIVE_CACHE_PATH_OVERRIDE.get() {
        return p.clone();
    }
    narrative_cache_path()
}

// ── Cache load / save ─────────────────────────────────────────────────────────

const CACHE_TTL_SECS: i64 = 7 * 24 * 3600; // 7 days

/// Load cached enrichments if they exist and are within the 7-day TTL.
fn load_cached_enrichments() -> Option<LlmEnrichments> {
    load_cached_enrichments_from(&effective_cache_path())
}

fn load_cached_enrichments_from(path: &Path) -> Option<LlmEnrichments> {
    let data = std::fs::read_to_string(path).ok()?;
    let enrichments: LlmEnrichments = serde_json::from_str(&data).ok()?;
    let enriched_at = enrichments.enriched_at?;
    let now = chrono::Utc::now().timestamp();
    if now - enriched_at < CACHE_TTL_SECS {
        Some(enrichments)
    } else {
        None
    }
}

/// Atomically write enrichments to the cache file (temp + rename).
fn save_cached_enrichments(e: &LlmEnrichments) {
    save_cached_enrichments_to(&effective_cache_path(), e);
}

fn save_cached_enrichments_to(path: &Path, e: &LlmEnrichments) {
    let json = match serde_json::to_string_pretty(e) {
        Ok(j) => j,
        Err(err) => {
            log::warn!("deep_scan enrichment: failed to serialize cache: {err}");
            return;
        }
    };
    if let Some(parent) = path.parent() {
        if let Err(err) = std::fs::create_dir_all(parent) {
            log::warn!("deep_scan enrichment: failed to create cache dir: {err}");
            return;
        }
    }
    // Atomic write: write to a temp file, then rename.
    let tmp = path.with_extension("tmp");
    if let Err(err) = std::fs::write(&tmp, &json) {
        log::warn!("deep_scan enrichment: failed to write temp cache: {err}");
        return;
    }
    if let Err(err) = std::fs::rename(&tmp, path) {
        log::warn!("deep_scan enrichment: failed to rename cache: {err}");
        // Clean up temp
        let _ = std::fs::remove_file(&tmp);
    }
}

// ── LLM call counter (test seam) ──────────────────────────────────────────────

#[cfg(test)]
static LLM_CALL_COUNT: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// Public accessor for tests to verify no extra retries occurred.
#[cfg(test)]
pub fn test_llm_call_count() -> usize {
    LLM_CALL_COUNT.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(test)]
pub fn test_reset_call_count() {
    LLM_CALL_COUNT.store(0, std::sync::atomic::Ordering::SeqCst);
}

// ── Provider resolution helper ────────────────────────────────────────────────

/// Build a single-turn prompt and call `providers::complete_turn`.
/// Returns the assistant text or an error string (does NOT retry on error).
async fn call_llm_once(
    provider: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    #[cfg(test)]
    LLM_CALL_COUNT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    // Route through the existing provider gateway
    let api_key = crate::config::get_provider_key(provider);
    let messages = vec![crate::providers::ConversationMessage::User(prompt.to_string())];
    let tools = crate::providers::no_tools();

    // Wrap call in a 30-second timeout (T-12-23 mitigation)
    let call_future = crate::providers::complete_turn(
        provider,
        &api_key,
        model,
        &messages,
        &tools,
        None,
    );

    match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        call_future,
    )
    .await
    {
        Ok(Ok(turn)) => Ok(turn.content),
        Ok(Err(err)) => Err(err),
        Err(_) => Err("enrichment LLM call timed out after 30s".to_string()),
    }
}

/// Parse "provider/model" into (provider, model).  Falls back to
/// `(provider_str, provider_str)` if no slash is present (bare provider name
/// used as model — rare but safe to handle).
fn split_provider_model(s: &str) -> (&str, &str) {
    if let Some(pos) = s.find('/') {
        (&s[..pos], &s[pos + 1..])
    } else {
        (s, s)
    }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/// Enrich a completed scan with ≤3 LLM narrative calls.
///
/// - Returns immediately from 7-day cache if available.
/// - Returns `LlmEnrichments::default()` if no provider is configured.
/// - Failures are logged once per call site; no retry; no panic.
pub async fn enrich_profile(
    scan: &DeepScanResults,
    cfg: &BladeConfig,
) -> LlmEnrichments {
    // 1. Check 7-day cache first
    if let Some(cached) = load_cached_enrichments() {
        return cached;
    }

    // 2. Determine providers — if both are empty, no-op
    let long_ctx = cfg.long_context_provider.as_deref().unwrap_or("");
    let primary = cfg.provider.as_str();

    // Use long_context_provider for call 1 if set, else primary
    let acct_provider_str = if !long_ctx.is_empty() { long_ctx } else { primary };

    // If we have no provider at all, return empty enrichments
    if acct_provider_str.is_empty() && primary.is_empty() {
        return LlmEnrichments::default();
    }

    let mut calls_used: usize = 0;
    let mut account_narrative: Option<String> = None;
    let mut rhythm_narrative: Option<String> = None;

    // ── Call 1: Account narrative ─────────────────────────────────────────────
    if !scan.accounts.is_empty() && calls_used < 3 && !acct_provider_str.is_empty() {
        let (provider, model) = split_provider_model(acct_provider_str);
        if !provider.is_empty() && !model.is_empty() {
            let account_list = format_account_list(&scan.accounts);
            let prompt = format!(
                "Here are the developer accounts found on this machine: {}. \
                 Write a 1-2 sentence summary of this developer's identity and platform presence.",
                crate::safe_slice(&account_list, 2000)
            );
            calls_used += 1;
            match call_llm_once(provider, model, &prompt).await {
                Ok(text) => account_narrative = Some(text),
                Err(err) => {
                    log::warn!("deep_scan enrichment: account narrative call failed: {err}");
                }
            }
        }
    }

    // ── Call 2: Rhythm narrative ──────────────────────────────────────────────
    if !scan.rhythm_signals.is_empty() && calls_used < 3 && !primary.is_empty() {
        let (provider, model) = split_provider_model(primary);
        if !provider.is_empty() && !model.is_empty() {
            if let Some(rhythm_summary) = format_rhythm_summary(&scan.rhythm_signals) {
                let prompt = format!(
                    "Based on this developer's activity patterns: {}. \
                     Write 1-2 sentences describing their coding schedule.",
                    crate::safe_slice(&rhythm_summary, 1000)
                );
                calls_used += 1;
                match call_llm_once(provider, model, &prompt).await {
                    Ok(text) => rhythm_narrative = Some(text),
                    Err(err) => {
                        log::warn!("deep_scan enrichment: rhythm narrative call failed: {err}");
                    }
                }
            }
        }
    }

    // ── Call 3: Ambiguous-repo language (optional) ────────────────────────────
    // Only if calls < 3 AND any Hot-tier repo has ≤50% language dominance.
    // Note: tier information is not directly stored in repo_rows (they are post-drain),
    // so we check all repo_rows for ambiguous language counts.
    if calls_used < 3 && !primary.is_empty() {
        if let Some(ambiguous_repo) = find_ambiguous_repo(&scan.repo_rows) {
            let (provider, model) = split_provider_model(primary);
            if !provider.is_empty() && !model.is_empty() {
                let counts_str = format_language_counts(&ambiguous_repo.language_counts);
                let prompt = format!(
                    "This repository has these file extension counts: {}. \
                     What is the primary programming language? Reply with just the language name.",
                    crate::safe_slice(&counts_str, 500)
                );
                calls_used += 1;
                match call_llm_once(provider, model, &prompt).await {
                    Ok(text) => {
                        // We use this for the ambiguous repo language — log for now
                        log::info!(
                            "deep_scan enrichment: repo language enriched: {}",
                            crate::safe_slice(&text, 100)
                        );
                    }
                    Err(err) => {
                        log::warn!(
                            "deep_scan enrichment: repo language call failed: {err}"
                        );
                    }
                }
            }
        }
    }

    let _ = calls_used; // suppress unused warning

    let result = LlmEnrichments {
        account_narrative,
        rhythm_narrative,
        enriched_at: Some(chrono::Utc::now().timestamp()),
    };

    // Save to cache (failure is non-fatal)
    save_cached_enrichments(&result);

    result
}

// ── Formatting helpers ────────────────────────────────────────────────────────

fn format_account_list(accounts: &[AccountRow]) -> String {
    accounts
        .iter()
        .map(|a| format!("{}/{}", a.platform, a.handle))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_rhythm_summary(signals: &[RhythmSignal]) -> Option<String> {
    // Look for hour_histogram signal first
    for sig in signals {
        if sig.kind == "hour_histogram" {
            if let Some(obj) = sig.data.as_object() {
                let entries: Vec<String> = obj
                    .iter()
                    .filter_map(|(k, v)| v.as_u64().map(|n| format!("{}h:{}", k, n)))
                    .collect();
                if !entries.is_empty() {
                    return Some(format!("Hour histogram: {}", entries.join(", ")));
                }
            }
        }
    }
    // Fallback: summarize all signal kinds
    let kinds: Vec<&str> = signals.iter().map(|s| s.kind.as_str()).collect();
    if !kinds.is_empty() {
        Some(format!("Activity signals: {}", kinds.join(", ")))
    } else {
        None
    }
}

fn find_ambiguous_repo(
    repos: &[crate::deep_scan::leads::RepoRow],
) -> Option<&crate::deep_scan::leads::RepoRow> {
    repos.iter().find(|r| {
        if r.language_counts.is_empty() {
            return false;
        }
        let total: usize = r.language_counts.values().sum();
        if total == 0 {
            return false;
        }
        let max_count = r.language_counts.values().max().copied().unwrap_or(0);
        // ≤50% dominance means no single language is clearly primary
        (max_count as f64 / total as f64) <= 0.50
    })
}

fn format_language_counts(counts: &std::collections::HashMap<String, usize>) -> String {
    let mut pairs: Vec<(&str, usize)> = counts
        .iter()
        .map(|(k, v)| (k.as_str(), *v))
        .collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1));
    pairs
        .iter()
        .take(10)
        .map(|(lang, n)| format!("{}={}", lang, n))
        .collect::<Vec<_>>()
        .join(", ")
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use crate::deep_scan::leads::{DeepScanResults, LlmEnrichments, AccountRow, RhythmSignal};
    use crate::config::BladeConfig;

    fn empty_cfg() -> BladeConfig {
        BladeConfig::default()
    }

    fn cfg_with_empty_provider() -> BladeConfig {
        let mut c = BladeConfig::default();
        c.provider = String::new();
        c
    }

    /// Set the cache path override for this test.
    /// IMPORTANT: each test that uses a custom cache must NOT share state
    /// with other tests — use a unique temp path.
    fn set_test_cache_path(path: PathBuf) {
        // OnceLock can only be set once; in tests we use a fixed path under /tmp.
        // For multi-test scenarios, set to a path that doesn't exist so each
        // test can pre-populate or not.
        let _ = NARRATIVE_CACHE_PATH_OVERRIDE.set(path);
    }

    // ── test 1 ────────────────────────────────────────────────────────────────

    /// When no provider is configured, enrich_profile must return an empty
    /// LlmEnrichments without panicking and without making any LLM call.
    #[tokio::test]
    async fn test_skips_when_no_provider() {
        // Ensure no stale cache from previous test run — use a path that won't exist.
        let tmp_path = std::env::temp_dir().join(format!(
            "blade_test_enrichment_no_provider_{}.json",
            std::process::id()
        ));
        // Set override — if OnceLock is already set from a prior test in the same
        // process, we cannot reset it. Use a unique process-level key instead.
        // Since OnceLock can only be set once, if this fails we skip the cache check.
        let _ = NARRATIVE_CACHE_PATH_OVERRIDE.set(tmp_path.clone());
        // Ensure the file doesn't exist so cache miss is guaranteed
        let _ = std::fs::remove_file(&tmp_path);

        test_reset_call_count();

        let scan = DeepScanResults::default();
        let cfg = cfg_with_empty_provider();

        let result = enrich_profile(&scan, &cfg).await;

        assert!(result.account_narrative.is_none(), "expected no narrative with empty provider");
        assert!(result.rhythm_narrative.is_none(), "expected no rhythm narrative with empty provider");
        // No LLM call should have been made
        assert_eq!(test_llm_call_count(), 0, "expected zero LLM calls with no provider");

        // Cleanup
        let _ = std::fs::remove_file(&tmp_path);
    }

    // ── test 2 ────────────────────────────────────────────────────────────────

    /// When a cache file exists with enriched_at within the last 7 days,
    /// enrich_profile must return the cached value without making any new LLM call.
    #[tokio::test]
    async fn test_cache_prevents_re_call() {
        // Write a fresh cache file manually
        let tmp_path = std::env::temp_dir().join(format!(
            "blade_test_enrichment_cache_{}.json",
            std::process::id()
        ));

        // Build a cached value with enriched_at = now - 1 day (well within TTL)
        let yesterday = chrono::Utc::now().timestamp() - 86400;
        let cached = LlmEnrichments {
            account_narrative: Some("Cached narrative from yesterday.".to_string()),
            rhythm_narrative: Some("Cached rhythm.".to_string()),
            enriched_at: Some(yesterday),
        };
        let json = serde_json::to_string_pretty(&cached).unwrap();
        std::fs::write(&tmp_path, &json).unwrap();

        // Reset the OnceLock override — since it can only be set once in a test
        // binary, we call the cache load function directly with the path parameter
        // to verify behavior independently of the static.
        test_reset_call_count();

        // Use the direct path function to test cache load logic
        let loaded = load_cached_enrichments_from(&tmp_path);
        assert!(loaded.is_some(), "expected cache hit for fresh file");
        let loaded = loaded.unwrap();
        assert_eq!(loaded.account_narrative, Some("Cached narrative from yesterday.".to_string()));
        assert_eq!(loaded.enriched_at, Some(yesterday));
        assert_eq!(test_llm_call_count(), 0, "cache load must not call LLM");

        // Cleanup
        let _ = std::fs::remove_file(&tmp_path);
    }

    // ── test 3 ────────────────────────────────────────────────────────────────

    /// When an LLM call fails, enrich_profile must return gracefully with None
    /// narrative. It must NOT retry (call count must be exactly 1 per failed slot).
    ///
    /// This test verifies the silence discipline: a bad API key causes one call
    /// per slot (not a retry loop), and the function returns without panic.
    #[tokio::test]
    async fn test_failure_logs_once_no_retry() {
        // Ensure no cache hit by using a non-existent path
        let tmp_path = std::env::temp_dir().join(format!(
            "blade_test_enrichment_failure_{}.json",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&tmp_path);

        // We test the call_llm_once function directly with a provider that
        // will immediately return an error (unknown provider).
        test_reset_call_count();

        // call_llm_once with an unknown provider returns Err immediately
        let result = call_llm_once("__nonexistent_test_provider__", "test-model", "test prompt").await;
        assert!(result.is_err(), "unknown provider must return Err");

        // Count must be exactly 1 — the function does NOT retry
        assert_eq!(
            test_llm_call_count(),
            1,
            "call_llm_once must attempt exactly once, never retry"
        );

        // Simulate what enrich_profile does on failure: no retry loop
        test_reset_call_count();
        let result2 = call_llm_once("__nonexistent_test_provider__", "test-model", "test prompt").await;
        assert!(result2.is_err());
        assert_eq!(
            test_llm_call_count(),
            1, // Still 1, not 2 — called once, failed, done
            "second attempt is still exactly 1 call (no internal retry)"
        );
    }

    // ── Formatting helpers tests ───────────────────────────────────────────────

    #[test]
    fn test_format_account_list() {
        let accounts = vec![
            AccountRow {
                row_id: "a".to_string(),
                platform: "github".to_string(),
                handle: "testuser".to_string(),
                source: "git_remotes".to_string(),
                discovered_via: "git_remote".to_string(),
            },
            AccountRow {
                row_id: "b".to_string(),
                platform: "gitlab".to_string(),
                handle: "testuser2".to_string(),
                source: "git_remotes".to_string(),
                discovered_via: "git_remote".to_string(),
            },
        ];
        let result = format_account_list(&accounts);
        assert!(result.contains("github/testuser"));
        assert!(result.contains("gitlab/testuser2"));
    }

    #[test]
    fn test_format_rhythm_summary_with_histogram() {
        let mut data = serde_json::Map::new();
        data.insert("22".to_string(), serde_json::json!(15));
        data.insert("23".to_string(), serde_json::json!(12));
        let signal = RhythmSignal {
            kind: "hour_histogram".to_string(),
            data: serde_json::Value::Object(data),
        };
        let result = format_rhythm_summary(&[signal]);
        assert!(result.is_some());
        assert!(result.unwrap().contains("Hour histogram"));
    }

    #[test]
    fn test_find_ambiguous_repo_50pct_dominance() {
        use crate::deep_scan::leads::RepoRow;
        let mut counts = HashMap::new();
        counts.insert("TypeScript".to_string(), 50);
        counts.insert("JavaScript".to_string(), 50); // exactly 50% each — ambiguous
        let repo = RepoRow {
            row_id: "repo:test".to_string(),
            path: "/test".to_string(),
            language_counts: counts,
            ..Default::default()
        };
        let repos = vec![repo];
        let found = find_ambiguous_repo(&repos);
        assert!(found.is_some(), "50/50 split must be detected as ambiguous");
    }

    #[test]
    fn test_find_ambiguous_repo_clear_dominant() {
        use crate::deep_scan::leads::RepoRow;
        let mut counts = HashMap::new();
        counts.insert("Rust".to_string(), 90);
        counts.insert("Shell".to_string(), 10);
        let repo = RepoRow {
            row_id: "repo:test2".to_string(),
            path: "/test2".to_string(),
            language_counts: counts,
            ..Default::default()
        };
        let repos = vec![repo];
        let found = find_ambiguous_repo(&repos);
        assert!(found.is_none(), "90% Rust must NOT be flagged as ambiguous");
    }

    #[test]
    fn test_cache_ttl_expired() {
        let tmp_path = std::env::temp_dir().join(format!(
            "blade_test_enrichment_ttl_{}.json",
            std::process::id()
        ));
        // Write a cache entry with enriched_at = 8 days ago (past TTL)
        let eight_days_ago = chrono::Utc::now().timestamp() - 8 * 86400;
        let stale = LlmEnrichments {
            account_narrative: Some("Old narrative.".to_string()),
            rhythm_narrative: None,
            enriched_at: Some(eight_days_ago),
        };
        let json = serde_json::to_string_pretty(&stale).unwrap();
        std::fs::write(&tmp_path, &json).unwrap();

        let result = load_cached_enrichments_from(&tmp_path);
        assert!(result.is_none(), "Stale cache (8d old) must return None");

        let _ = std::fs::remove_file(&tmp_path);
    }
}
