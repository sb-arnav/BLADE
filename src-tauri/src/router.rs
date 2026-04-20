use serde::{Deserialize, Serialize};

/// Classify what kind of task a message is, to route to the right model
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskType {
    /// Simple chat, greetings, quick answers
    Simple,
    /// Code generation, debugging, technical
    Code,
    /// Analysis, reasoning, complex questions
    Complex,
    /// Image/vision related
    Vision,
    /// Creative writing, brainstorming
    Creative,
}

/// Classify a user message to determine routing
pub fn classify_task(message: &str, has_image: bool) -> TaskType {
    if has_image {
        return TaskType::Vision;
    }

    let lower = message.to_lowercase();

    // Code signals
    let code_signals = [
        "code",
        "function",
        "error",
        "bug",
        "debug",
        "compile",
        "syntax",
        "implement",
        "refactor",
        "api",
        "endpoint",
        "database",
        "query",
        "```",
        "def ",
        "fn ",
        "class ",
        "import ",
        "const ",
        "let ",
        "var ",
        "rust",
        "python",
        "javascript",
        "typescript",
    ];
    let code_score: usize = code_signals.iter().filter(|s| lower.contains(*s)).count();

    // Complex signals
    let complex_signals = [
        "explain",
        "analyze",
        "compare",
        "why",
        "how does",
        "trade-off",
        "architecture",
        "design",
        "strategy",
        "plan",
        "review",
        "what are the implications",
        "pros and cons",
    ];
    let complex_score: usize = complex_signals
        .iter()
        .filter(|s| lower.contains(*s))
        .count();

    // Creative signals
    let creative_signals = [
        "write",
        "draft",
        "compose",
        "story",
        "poem",
        "essay",
        "brainstorm",
        "ideas",
        "name",
        "slogan",
        "tagline",
    ];
    let creative_score: usize = creative_signals
        .iter()
        .filter(|s| lower.contains(*s))
        .count();

    // Simple: short messages, greetings, yes/no
    if message.len() < 20 {
        return TaskType::Simple;
    }

    if code_score >= 2 {
        return TaskType::Code;
    }
    if complex_score >= 2 {
        return TaskType::Complex;
    }
    if creative_score >= 2 {
        return TaskType::Creative;
    }

    // Default based on length
    if message.len() > 200 {
        TaskType::Complex
    } else {
        TaskType::Simple
    }
}

/// Suggest the best model for a task type given the provider
pub fn suggest_model(provider: &str, task: &TaskType) -> Option<String> {
    match provider {
        "groq" => match task {
            TaskType::Simple => Some("llama-3.3-70b-versatile".to_string()),
            TaskType::Code => Some("llama-3.3-70b-versatile".to_string()),
            TaskType::Complex => Some("llama-3.3-70b-versatile".to_string()),
            TaskType::Vision => Some("meta-llama/llama-4-scout-17b-16e-instruct".to_string()),
            TaskType::Creative => Some("llama-3.3-70b-versatile".to_string()),
        },
        "openai" => match task {
            TaskType::Simple => Some("gpt-4o-mini".to_string()),
            TaskType::Code | TaskType::Complex => Some("gpt-4o".to_string()),
            TaskType::Vision => Some("gpt-4o".to_string()),
            TaskType::Creative => Some("gpt-4o".to_string()),
        },
        "anthropic" => match task {
            TaskType::Simple => Some("claude-haiku-4-5-20251001".to_string()),
            TaskType::Code | TaskType::Complex => Some("claude-sonnet-4-20250514".to_string()),
            TaskType::Vision => Some("claude-sonnet-4-20250514".to_string()),
            TaskType::Creative => Some("claude-sonnet-4-20250514".to_string()),
        },
        "gemini" => match task {
            TaskType::Simple => Some("gemini-2.0-flash".to_string()),
            TaskType::Code | TaskType::Complex => Some("gemini-2.5-pro-preview-06-05".to_string()),
            TaskType::Vision => Some("gemini-2.0-flash".to_string()),
            TaskType::Creative => Some("gemini-2.5-pro-preview-06-05".to_string()),
        },
        // OpenRouter: never override — the user picked their model deliberately
        // (may be free-tier, may be a specific version). Return None so the caller
        // falls back to config.model.
        "openrouter" => None,
        // Ollama: prefer Hermes 3 for tool-heavy tasks (it has native function-calling training)
        // and a lighter model for simple queries. Falls back to whatever the user set if unknown.
        "ollama" => match task {
            TaskType::Code | TaskType::Complex => Some("hermes3".to_string()),
            TaskType::Simple => Some("hermes3".to_string()),
            TaskType::Creative => Some("hermes3".to_string()),
            TaskType::Vision => None, // Vision varies too much; use user's configured model
        },
        _ => None,
    }
}

#[tauri::command]
pub fn classify_message(message: String, has_image: bool) -> TaskType {
    classify_task(&message, has_image)
}

// ── Phase 11 Plan 11-04 (D-55) — Capability-aware provider selection ─────────
//
// `select_provider` implements the 3-tier resolution locked in CONTEXT §D-55:
//
//   Tier 0 — Custom base_url escape hatch.
//            If the user set a base_url (NVIDIA NIM, DeepSeek, etc.) the
//            router has no knowledge of which providers that endpoint models,
//            so tiers 1-2 are skipped entirely and the user's primary wins.
//
//   Tier 1 — Capability hard filter.
//            Vision tasks (and eventually audio / long_context / tools) MUST
//            route to a capability-capable provider. The 4 capability_provider
//            slots (BladeConfig.vision_provider etc. from Plan 11-02) win first;
//            then a scan of `provider_capabilities` picks any capable provider
//            with a stored key; otherwise we graceful-degrade to primary AND
//            signal `capability_unmet` so the caller can emit a one-shot
//            `blade_routing_capability_missing` event.
//
//   Tier 2 — Task-type soft preference.
//            Delegates to `config::resolve_provider_for_task` — the existing
//            25+-callsite path stays untouched; we just reuse it here.
//
//   Tier 3 — Primary fallback (handled implicitly by resolve_provider_for_task
//            when no routing override is set).
//
// The returned `fallback_chain` is a capability-filtered `Vec<(provider, model)>`
// for tier-1 calls, and a generic chain (fallback_providers minus the primary,
// minus any provider without a stored key) otherwise. `fallback_chain` is
// consumed verbatim by `providers::fallback_chain_complete_with_override` at
// the single rewired call site in `commands.rs::send_message_stream` — the
// other 25+ `resolve_provider_for_task` call sites are unchanged per
// blast-radius discipline (RESEARCH.md §Router Rewire).
//
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-55
// @see .planning/phases/11-smart-provider-setup/11-RESEARCH.md §Router Rewire
// @see src-tauri/src/config.rs:526 `get_provider_key` (pub(crate))
// @see src-tauri/src/config.rs:805 `resolve_provider_for_task`
// @see src-tauri/src/providers/mod.rs `fallback_chain_complete_with_override`

use std::collections::HashSet;

/// Capability-aware provider selection with 3-tier resolution + capability-
/// filtered fallback chain.
///
/// Returns `(provider, api_key, model, fallback_chain, capability_unmet)`:
///   - `provider` / `api_key` / `model` — the resolved primary attempt
///   - `fallback_chain` — `Vec<(provider, model)>` of retry targets; every
///     entry is capability-capable when tier 1 required a capability; the
///     primary is NEVER duplicated in the chain (HashSet dedup).
///   - `capability_unmet` — `Some("vision" | "audio" | ...)` when tier 1
///     required a capability but no capable provider with a stored key was
///     found. The caller emits `blade_routing_capability_missing` ONCE on
///     this signal (no retry loop per 4ab464c posture).
pub fn select_provider(
    task_type: TaskType,
    config: &crate::config::BladeConfig,
) -> (String, String, String, Vec<(String, String)>, Option<&'static str>) {
    // Tier 0 — custom base_url escape hatch (D-55; mirrors config.rs:813).
    // Users on NVIDIA NIM / DeepSeek / Vercel AI Gateway / etc. win verbatim.
    if config.base_url.is_some() {
        return (
            config.provider.clone(),
            config.api_key.clone(),
            config.model.clone(),
            vec![],
            None,
        );
    }

    // Derive required capability from task type. Only Vision enters this path
    // from the chat orchestrator in v1.1; audio/long_context/tools route via
    // voice-orb / context-length / tool-loop sidecars (RESEARCH.md §5).
    let required_capability: Option<&'static str> = match task_type {
        TaskType::Vision => Some("vision"),
        _ => None,
    };

    // Tier 1 — capability hard filter.
    if let Some(cap) = required_capability {
        // 1a: explicit per-capability provider slot (vision_provider, etc.)
        let cap_provider_field: Option<&str> = match cap {
            "vision" => config.vision_provider.as_deref(),
            "audio" => config.audio_provider.as_deref(),
            "long_context" => config.long_context_provider.as_deref(),
            "tools" => config.tools_provider.as_deref(),
            _ => None,
        };

        if let Some(prov_model_str) = cap_provider_field {
            let (prov, model) = crate::providers::parse_model_string(
                prov_model_str,
                &config.provider,
            );
            let key = crate::config::get_provider_key(prov);
            if !key.is_empty() || prov == "ollama" {
                let chain = build_capability_filtered_chain(cap, prov, config);
                return (prov.to_string(), key, model.to_string(), chain, None);
            }
        }

        // 1b: scan provider_capabilities for any capable provider with a key.
        let capable = find_capable_providers(cap, config);
        for (prov, model) in &capable {
            let key = crate::config::get_provider_key(prov);
            if !key.is_empty() || prov == "ollama" {
                let chain = build_capability_filtered_chain(cap, prov, config);
                return (prov.clone(), key, model.clone(), chain, None);
            }
        }

        // 1c: no capable provider found — graceful degrade to primary,
        // signal unmet so the caller emits the one-shot missing event.
        let chain = build_generic_chain(&config.provider, config);
        return (
            config.provider.clone(),
            config.api_key.clone(),
            config.model.clone(),
            chain,
            Some(cap),
        );
    }

    // Tier 2 — task-type soft preference (reuses existing selector so the
    // other 25+ callsites and this new code stay semantically aligned).
    let (prov, key, model) = crate::config::resolve_provider_for_task(config, &task_type);

    // Tier 3 — generic fallback chain (primary excluded, deduped, key-gated).
    let chain = build_generic_chain(&prov, config);
    (prov, key, model, chain, None)
}

/// Return every provider in `provider_capabilities` whose flag for `capability`
/// is true. Order is HashMap iteration order — callers filter further by
/// stored-key availability before committing to a selection.
fn find_capable_providers(
    capability: &str,
    config: &crate::config::BladeConfig,
) -> Vec<(String, String)> {
    config
        .provider_capabilities
        .iter()
        .filter(|(_, rec)| match capability {
            "vision" => rec.vision,
            "audio" => rec.audio,
            "tools" => rec.tool_calling,
            "long_context" => rec.long_context,
            _ => false,
        })
        .map(|(prov, rec)| (prov.clone(), rec.model.clone()))
        .collect()
}

/// Build a capability-filtered fallback chain.
///
/// Every entry in the returned chain MUST be capability-capable. The primary
/// provider is excluded (dedup via HashSet) so the runtime retry loop doesn't
/// re-attempt the one that just failed. Providers without a stored key are
/// skipped (ollama is the sole exception — it authenticates via local socket).
///
/// Order: capability-capable providers from `provider_capabilities` first
/// (deterministic iteration NOT guaranteed by HashMap), then user-ordered
/// `fallback_providers` that are also capable.
fn build_capability_filtered_chain(
    capability: &str,
    primary_provider: &str,
    config: &crate::config::BladeConfig,
) -> Vec<(String, String)> {
    let mut chain: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(primary_provider.to_string());

    // Step 1: providers with capability records showing the capability = true.
    for (prov, rec) in &config.provider_capabilities {
        if seen.contains(prov) {
            continue;
        }
        let has_cap = match capability {
            "vision" => rec.vision,
            "audio" => rec.audio,
            "tools" => rec.tool_calling,
            "long_context" => rec.long_context,
            _ => false,
        };
        if !has_cap {
            continue;
        }
        let key = crate::config::get_provider_key(prov);
        if key.is_empty() && prov != "ollama" {
            continue;
        }
        seen.insert(prov.clone());
        chain.push((prov.clone(), rec.model.clone()));
    }

    // Step 2: user-ordered fallback_providers (filtered by capability).
    for prov in &config.fallback_providers {
        if seen.contains(prov) {
            continue;
        }
        let rec = config.provider_capabilities.get(prov);
        let has_cap = rec
            .map(|r| match capability {
                "vision" => r.vision,
                "audio" => r.audio,
                "tools" => r.tool_calling,
                "long_context" => r.long_context,
                _ => false,
            })
            .unwrap_or(false);
        if !has_cap {
            continue;
        }
        let key = crate::config::get_provider_key(prov);
        if key.is_empty() && prov != "ollama" {
            continue;
        }
        seen.insert(prov.clone());
        chain.push((
            prov.clone(),
            rec.map(|r| r.model.clone()).unwrap_or_default(),
        ));
    }

    chain
}

/// Build a generic fallback chain for non-capability tasks.
///
/// Iterates `config.fallback_providers` in order, skipping the primary and any
/// provider without a stored key. Uses whatever model is recorded in the
/// capability table, or an empty string if unknown (caller's provider-dispatch
/// resolves a sensible default at retry time).
fn build_generic_chain(
    primary_provider: &str,
    config: &crate::config::BladeConfig,
) -> Vec<(String, String)> {
    let mut chain: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    seen.insert(primary_provider.to_string());
    for prov in &config.fallback_providers {
        if seen.contains(prov) {
            continue;
        }
        let key = crate::config::get_provider_key(prov);
        if key.is_empty() && prov != "ollama" {
            continue;
        }
        let rec = config.provider_capabilities.get(prov);
        let model = rec.map(|r| r.model.clone()).unwrap_or_default();
        seen.insert(prov.clone());
        chain.push((prov.clone(), model));
    }
    chain
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        test_clear_keyring_overrides, test_set_keyring_override, BladeConfig,
        ProbeStatus, ProviderCapabilityRecord,
    };
    use std::collections::HashMap;

    // Helper — build a ProviderCapabilityRecord with the capability flags
    // set by the caller. Other fields get deterministic defaults.
    fn cap_rec(
        provider: &str,
        model: &str,
        vision: bool,
        tool_calling: bool,
        long_context: bool,
        audio: bool,
    ) -> ProviderCapabilityRecord {
        ProviderCapabilityRecord {
            provider: provider.to_string(),
            model: model.to_string(),
            context_window: 128_000,
            vision,
            audio,
            tool_calling,
            long_context,
            last_probed: chrono::Utc::now(),
            probe_status: ProbeStatus::Active,
        }
    }

    #[test]
    fn select_provider_tier0_base_url() {
        // Tier 0 — base_url set → skip all capability logic even on Vision.
        test_clear_keyring_overrides();

        let mut cfg = BladeConfig::default();
        cfg.provider = "deepseek".to_string();
        cfg.api_key = "sk-deepseek".to_string();
        cfg.model = "deepseek-chat".to_string();
        cfg.base_url = Some("https://api.deepseek.com/v1".to_string());
        // Even with a vision_provider set, tier 0 wins.
        cfg.vision_provider = Some("anthropic/claude-sonnet-4".to_string());

        let (prov, key, model, chain, unmet) = select_provider(TaskType::Vision, &cfg);
        assert_eq!(prov, "deepseek");
        assert_eq!(key, "sk-deepseek");
        assert_eq!(model, "deepseek-chat");
        assert!(chain.is_empty(), "base_url tier 0 returns empty chain");
        assert_eq!(unmet, None);

        test_clear_keyring_overrides();
    }

    #[test]
    fn select_provider_tier1_vision_override() {
        // Tier 1a — explicit vision_provider slot wins over primary.
        test_clear_keyring_overrides();
        test_set_keyring_override("anthropic", "sk-ant-test-key");

        let mut cfg = BladeConfig::default();
        cfg.provider = "groq".to_string();
        cfg.api_key = "gsk-primary".to_string();
        cfg.model = "llama-3.3-70b-versatile".to_string();
        cfg.vision_provider = Some("anthropic/claude-sonnet-4".to_string());

        let (prov, key, model, _chain, unmet) = select_provider(TaskType::Vision, &cfg);
        assert_eq!(prov, "anthropic", "vision task should route to vision_provider");
        assert_eq!(key, "sk-ant-test-key");
        assert_eq!(model, "claude-sonnet-4");
        assert_eq!(unmet, None);

        test_clear_keyring_overrides();
    }

    #[test]
    fn select_provider_tier2_task_routing() {
        // Tier 2 — no capability req → delegate to resolve_provider_for_task.
        test_clear_keyring_overrides();
        test_set_keyring_override("groq", "gsk-routing-test");

        let mut cfg = BladeConfig::default();
        cfg.provider = "anthropic".to_string();
        cfg.api_key = "sk-ant-primary".to_string();
        cfg.model = "claude-sonnet-4-20250514".to_string();
        cfg.task_routing.creative = Some("groq".to_string());

        let (prov, _key, _model, _chain, unmet) = select_provider(TaskType::Creative, &cfg);
        // resolve_provider_for_task falls back to api_key-from-keyring — our
        // override seam supplies "gsk-routing-test" so the branch is taken.
        assert_eq!(prov, "groq", "creative task should honor task_routing.creative");
        assert_eq!(unmet, None);

        test_clear_keyring_overrides();
    }

    #[test]
    fn select_provider_tier3_primary() {
        // Tier 3 — no capability, no routing override → primary wins.
        test_clear_keyring_overrides();

        let mut cfg = BladeConfig::default();
        cfg.provider = "openai".to_string();
        cfg.api_key = "sk-openai-primary".to_string();
        cfg.model = "gpt-4o".to_string();

        let (prov, key, model, _chain, unmet) = select_provider(TaskType::Simple, &cfg);
        assert_eq!(prov, "openai");
        assert_eq!(key, "sk-openai-primary");
        assert_eq!(model, "gpt-4o");
        assert_eq!(unmet, None);

        test_clear_keyring_overrides();
    }

    #[test]
    fn chain_filters_noncapable() {
        // Capability filter MUST exclude non-capable providers from the chain.
        // Groq.llama (vision=false) is present in fallback_providers; anthropic
        // (vision=true) is the primary. Resulting chain must NOT contain groq.
        test_clear_keyring_overrides();
        test_set_keyring_override("groq", "gsk-test");
        test_set_keyring_override("openai", "sk-openai-test");

        let mut cfg = BladeConfig::default();
        cfg.provider = "anthropic".to_string();

        let mut caps: HashMap<String, ProviderCapabilityRecord> = HashMap::new();
        caps.insert("groq".into(), cap_rec("groq", "llama-3.3-70b-versatile", false, true, false, false));
        caps.insert("openai".into(), cap_rec("openai", "gpt-4o", true, true, false, false));
        caps.insert("anthropic".into(), cap_rec("anthropic", "claude-sonnet-4", true, true, true, false));
        cfg.provider_capabilities = caps;
        cfg.fallback_providers = vec!["groq".into(), "openai".into()];

        let chain = build_capability_filtered_chain("vision", "anthropic", &cfg);

        // Every entry in the chain must be vision-capable.
        for (prov, _) in &chain {
            assert_ne!(prov, "groq", "groq is non-capable; must NOT be in chain");
            assert_ne!(prov, "anthropic", "primary must NOT be duplicated");
        }
        // openai must be present (vision-capable + key stored).
        assert!(
            chain.iter().any(|(p, _)| p == "openai"),
            "openai is vision-capable with key — must be in chain"
        );

        test_clear_keyring_overrides();
    }

    #[test]
    fn chain_dedupes() {
        // If fallback_providers lists the primary, the chain must not include
        // it. Dedup is enforced via HashSet.
        test_clear_keyring_overrides();
        test_set_keyring_override("anthropic", "sk-ant-test");
        test_set_keyring_override("openai", "sk-openai-test");

        let mut cfg = BladeConfig::default();
        cfg.provider = "anthropic".to_string();
        cfg.fallback_providers = vec!["anthropic".into(), "openai".into()];

        let mut caps: HashMap<String, ProviderCapabilityRecord> = HashMap::new();
        caps.insert("anthropic".into(), cap_rec("anthropic", "claude-sonnet-4", true, true, true, false));
        caps.insert("openai".into(), cap_rec("openai", "gpt-4o", true, true, false, false));
        cfg.provider_capabilities = caps;

        let chain = build_capability_filtered_chain("vision", "anthropic", &cfg);

        // primary must appear zero times
        let ant_count = chain.iter().filter(|(p, _)| p == "anthropic").count();
        assert_eq!(ant_count, 0, "primary anthropic must not appear in chain");

        // dedup: each non-primary provider appears exactly once
        let mut seen: HashSet<&str> = HashSet::new();
        for (p, _) in &chain {
            assert!(seen.insert(p.as_str()), "duplicate {} in chain", p);
        }

        test_clear_keyring_overrides();
    }

    #[test]
    fn emits_missing_event() {
        // Primary=groq (vision=false), no vision_provider, no other vision-
        // capable provider with a stored key → select_provider graceful-
        // degrades to primary AND signals capability_unmet == Some("vision").
        // commands.rs:send_message_stream then emits the one-shot event.
        test_clear_keyring_overrides();
        test_set_keyring_override("groq", "gsk-only-provider");

        let mut cfg = BladeConfig::default();
        cfg.provider = "groq".to_string();
        cfg.api_key = "gsk-only-provider".to_string();
        cfg.model = "llama-3.3-70b-versatile".to_string();
        // No vision_provider. No vision-capable records with keys.
        let mut caps: HashMap<String, ProviderCapabilityRecord> = HashMap::new();
        caps.insert(
            "groq".into(),
            cap_rec("groq", "llama-3.3-70b-versatile", false, true, false, false),
        );
        cfg.provider_capabilities = caps;

        let (prov, _key, _model, _chain, unmet) = select_provider(TaskType::Vision, &cfg);

        // Graceful degrade — primary returned...
        assert_eq!(prov, "groq");
        // ...with unmet signal so caller emits the missing event ONCE.
        assert_eq!(unmet, Some("vision"));

        test_clear_keyring_overrides();
    }

    #[test]
    fn tier1_vision_override_with_no_key_falls_through_to_scan() {
        // If vision_provider is set but the referenced provider has no key
        // (empty override), tier 1b scan should take over. openai has a key
        // AND vision=true, so it wins.
        test_clear_keyring_overrides();
        // Deliberately do NOT set an override for anthropic.
        test_set_keyring_override("openai", "sk-openai-present");

        let mut cfg = BladeConfig::default();
        cfg.provider = "groq".to_string();
        cfg.api_key = "gsk-primary".to_string();
        cfg.model = "llama-3.3-70b-versatile".to_string();
        cfg.vision_provider = Some("anthropic/claude-sonnet-4".to_string());

        let mut caps: HashMap<String, ProviderCapabilityRecord> = HashMap::new();
        caps.insert("openai".into(), cap_rec("openai", "gpt-4o", true, true, false, false));
        cfg.provider_capabilities = caps;

        let (prov, key, _model, _chain, unmet) = select_provider(TaskType::Vision, &cfg);
        assert_eq!(prov, "openai", "tier 1b scan finds openai when anthropic has no key");
        assert_eq!(key, "sk-openai-present");
        assert_eq!(unmet, None);

        test_clear_keyring_overrides();
    }
}
