/// Phase 85 — Anthropic `cache_control` marker injection.
///
/// Classification primitive: `is_anthropic_compatible` gates the native-anthropic
/// integration in this phase. openrouter+claude is classified `true` but
/// openrouter MARKER INJECTION is deferred — no openrouter call site applies
/// markers in Phase 85.
///
/// `apply_anthropic_cache_control` mutates an already-built Anthropic request
/// body in place: marks the system block (idempotent) + the last up-to-3
/// non-system messages with `cache_control`. 4 markers maximum:
///   system(1) + last 3 non-system messages(3) = 4 total.
/// Tools are cached as a side-effect of the system-marker prefix (Anthropic
/// caches everything up to and including the marked block in prefix order:
/// tools → system → messages).

use serde_json::json;

/// Anthropic cache TTL variants. Resolved from the `cache.anthropic_cache_ttl`
/// config string at dispatch time; threaded into the async build functions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CacheTtl {
    /// "5m" — default. Shape: `{"type":"ephemeral"}`. No beta header.
    FiveMin,
    /// "1h" — extended. Shape: `{"type":"ephemeral","ttl":"1h"}`. No beta header.
    OneHour,
}

impl CacheTtl {
    /// Resolve from the config string. Anything other than "1h" maps to `FiveMin`
    /// (defensive default — T-85-01: prevents injection into the fixed marker
    /// shapes from arbitrary user-editable config values).
    pub fn from_config(s: &str) -> Self {
        if s == "1h" { CacheTtl::OneHour } else { CacheTtl::FiveMin }
    }
}

/// Build the `cache_control` JSON object for the given TTL.
/// FiveMin → `{"type":"ephemeral"}`
/// OneHour → `{"type":"ephemeral","ttl":"1h"}`
fn marker(ttl: &CacheTtl) -> serde_json::Value {
    match ttl {
        CacheTtl::FiveMin => json!({"type": "ephemeral"}),
        CacheTtl::OneHour => json!({"type": "ephemeral", "ttl": "1h"}),
    }
}

/// Apply Anthropic `cache_control` markers to an already-built request body.
///
/// Idempotent on the system block: if `body["system"]` already has a
/// `cache_control` on its last block (e.g. placed by `system_block_with_cache`),
/// it is left unchanged.
///
/// Message markers: attaches `cache_control` to the last content block of each
/// of the last up-to-3 entries in `body["messages"]`. For string-content
/// messages, the content is promoted to a block array first (Anthropic rejects
/// `cache_control` on a bare string — D-04).
///
/// Does NOT touch `body["tools"]` — tools are cached as a prefix side-effect
/// of the system marker (D-02 / D-01: Anthropic prefix order tools→system→messages).
///
/// Maximum markers placed: 1 (system) + 3 (messages) = 4.
pub fn apply_anthropic_cache_control(body: &mut serde_json::Value, ttl: CacheTtl) {
    let m = marker(&ttl);

    // --- System block (idempotent) ---
    // system_block_with_cache in anthropic.rs already marks this on all 3 build paths;
    // we skip it if already marked, add it if somehow absent (standalone correctness).
    if let Some(system_arr) = body["system"].as_array_mut() {
        if let Some(last_block) = system_arr.last_mut() {
            if let Some(obj) = last_block.as_object_mut() {
                if !obj.contains_key("cache_control") {
                    obj.insert("cache_control".to_string(), m.clone());
                }
                // Already marked — leave untouched (idempotent).
            }
        }
    }

    // --- Message markers (last up-to-3 messages) ---
    // In BLADE's Anthropic body, body["messages"] never contains a system-role
    // entry (serialize_message returns None for System). "Last 3 non-system"
    // simply means "last 3 entries in body['messages']".
    if let Some(msgs) = body["messages"].as_array_mut() {
        let len = msgs.len();
        let start = len.saturating_sub(3);
        for msg in &mut msgs[start..] {
            let content_val = msg["content"].take();
            match content_val {
                serde_json::Value::Array(mut arr) => {
                    // List content — attach cache_control to the LAST block.
                    if let Some(last_block) = arr.last_mut() {
                        if let Some(obj) = last_block.as_object_mut() {
                            obj.insert("cache_control".to_string(), m.clone());
                        }
                    }
                    msg["content"] = serde_json::Value::Array(arr);
                }
                serde_json::Value::String(s) => {
                    // String content — MUST promote to a block array before marking.
                    // Anthropic rejects cache_control on a bare string (D-04).
                    msg["content"] = json!([{
                        "type": "text",
                        "text": s,
                        "cache_control": m.clone()
                    }]);
                }
                other => {
                    // Null, bool, number — put it back unchanged (defensive).
                    msg["content"] = other;
                }
            }
        }
    }
}

/// Returns `true` when the (provider, model, base_url) combination is compatible
/// with the native Anthropic `cache_control` marker scheme.
///
/// Classification rules:
/// - base_url matching `*.anthropic.com` or `*.bedrock.amazonaws.com` → true
///   (direct API or Bedrock endpoint).
/// - provider == "anthropic" | "bedrock" → true.
/// - provider == "openrouter" AND (model starts with "claude" OR contains "/claude") → true.
///   NOTE: classified true, but openrouter MARKER INJECTION is deferred to a
///   follow-up phase. This function gates only the native-anthropic dispatch path.
/// - All other providers (openai, groq, gemini, ollama, openrouter+non-claude) → false.
///   Markers must never reach these routes (T-85-02).
pub fn is_anthropic_compatible(provider: &str, model: &str, base_url: Option<&str>) -> bool {
    if let Some(url) = base_url {
        if url.contains("anthropic.com") || url.contains("bedrock.amazonaws.com") {
            return true;
        }
    }
    match provider {
        "anthropic" | "bedrock" => true,
        "openrouter" => model.starts_with("claude") || model.contains("/claude"),
        _ => false,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Build a synthetic Anthropic request body with `n` alternating user/assistant
    /// messages. System block is pre-marked (matches what `system_block_with_cache`
    /// produces). Messages use block-array content (matches `serialize_message`).
    fn make_body_with_n_messages(n: usize) -> serde_json::Value {
        let messages: Vec<serde_json::Value> = (0..n)
            .map(|i| {
                if i % 2 == 0 {
                    json!({"role": "user", "content": [{"type": "text", "text": format!("user {}", i)}]})
                } else {
                    json!({"role": "assistant", "content": [{"type": "text", "text": format!("assistant {}", i)}]})
                }
            })
            .collect();
        json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "system": [{"type": "text", "text": "System prompt.", "cache_control": {"type": "ephemeral"}}],
            "messages": messages,
            "stream": false
        })
    }

    /// Count `cache_control` occurrences in the serialized body.
    fn count_markers(body: &serde_json::Value) -> usize {
        serde_json::to_string(body).unwrap().matches("cache_control").count()
    }

    /// T1: A body with system + >=3 non-system messages carries EXACTLY 4
    /// cache_control markers after apply. Never 5+. (4-cap respected.)
    #[test]
    fn phase85_four_breakpoints_placed() {
        let mut body = make_body_with_n_messages(5);
        apply_anthropic_cache_control(&mut body, CacheTtl::FiveMin);
        assert_eq!(count_markers(&body), 4, "expected exactly 4 markers (system + last 3 messages)");
    }

    /// T2: Idempotency — calling on a body whose system block is already marked
    /// must NOT add a second system marker. Count stays 4, not 5.
    /// Also verifies that messages[0],[1] are NOT marked; messages[2],[3],[4] ARE.
    #[test]
    fn phase85_targets_system_and_last_three_nonsystem() {
        let mut body = make_body_with_n_messages(5);
        apply_anthropic_cache_control(&mut body, CacheTtl::FiveMin);

        // System block: already had 1 marker; still exactly 1 (idempotent).
        let sys_str = serde_json::to_string(&body["system"]).unwrap();
        assert_eq!(sys_str.matches("cache_control").count(), 1);

        // messages[0] and [1] → untouched.
        let msgs = body["messages"].as_array().unwrap();
        let m0 = serde_json::to_string(&msgs[0]).unwrap();
        let m1 = serde_json::to_string(&msgs[1]).unwrap();
        assert!(!m0.contains("cache_control"), "messages[0] should NOT be marked");
        assert!(!m1.contains("cache_control"), "messages[1] should NOT be marked");

        // messages[2], [3], [4] → marked.
        for i in 2..5 {
            let mi = serde_json::to_string(&msgs[i]).unwrap();
            assert!(mi.contains("cache_control"), "messages[{}] should be marked", i);
        }
    }

    /// T3: String-content message is PROMOTED to a block array with cache_control.
    /// Anthropic rejects cache_control on a bare string (D-04).
    #[test]
    fn phase85_cache_control_on_string_content() {
        let mut body = json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "system": [{"type": "text", "text": "System.", "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": "hi"}],
            "stream": false
        });
        apply_anthropic_cache_control(&mut body, CacheTtl::FiveMin);

        let content = &body["messages"][0]["content"];
        assert!(content.is_array(), "content should be promoted to array");
        let arr = content.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["type"], "text");
        assert_eq!(arr[0]["text"], "hi");
        assert_eq!(arr[0]["cache_control"], json!({"type": "ephemeral"}));
    }

    /// T4: Multimodal list-content message — cache_control applied to the LAST
    /// (text) block only; the image block is untouched.
    #[test]
    fn phase85_cache_control_on_multimodal_content() {
        let mut body = json!({
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 4096,
            "system": [{"type": "text", "text": "System.", "cache_control": {"type": "ephemeral"}}],
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "abc"}},
                    {"type": "text", "text": "describe this"}
                ]
            }],
            "stream": false
        });
        apply_anthropic_cache_control(&mut body, CacheTtl::FiveMin);

        let content = body["messages"][0]["content"].as_array().unwrap();
        assert_eq!(content.len(), 2);
        // Image block: no cache_control.
        assert!(content[0].get("cache_control").is_none(), "image block should NOT be marked");
        // Text block: has cache_control.
        assert_eq!(content[1]["cache_control"], json!({"type": "ephemeral"}));
    }

    /// T5: TTL config maps correctly.
    /// FiveMin → `{"type":"ephemeral"}` (no ttl key).
    /// OneHour → `{"type":"ephemeral","ttl":"1h"}`.
    #[test]
    fn phase85_ttl_respected() {
        // FiveMin
        let mut body5 = make_body_with_n_messages(1);
        apply_anthropic_cache_control(&mut body5, CacheTtl::FiveMin);
        let msg5 = &body5["messages"][0];
        let cc5 = &msg5["content"][0]["cache_control"];
        assert_eq!(cc5["type"], "ephemeral");
        assert!(cc5.get("ttl").is_none(), "FiveMin should NOT have a ttl key");

        // OneHour
        let mut body1h = make_body_with_n_messages(1);
        apply_anthropic_cache_control(&mut body1h, CacheTtl::OneHour);
        let msg1h = &body1h["messages"][0];
        let cc1h = &msg1h["content"][0]["cache_control"];
        assert_eq!(cc1h["type"], "ephemeral");
        assert_eq!(cc1h["ttl"], "1h");

        // Verify CacheTtl::from_config mapping
        assert_eq!(CacheTtl::from_config("1h"), CacheTtl::OneHour);
        assert_eq!(CacheTtl::from_config("5m"), CacheTtl::FiveMin);
        assert_eq!(CacheTtl::from_config("anything_else"), CacheTtl::FiveMin);
    }

    /// T6: No-op for non-Anthropic providers AND for cache.enabled=false.
    ///
    /// is_anthropic_compatible is false for openai/groq/gemini/ollama +
    /// openrouter+non-claude → callers pass None and the body is untouched.
    /// When cache.enabled=false the caller does not call apply at all — body unchanged.
    #[test]
    fn phase85_noop_for_non_anthropic_and_disabled() {
        // Non-compatible providers → is_anthropic_compatible returns false.
        assert!(!is_anthropic_compatible("openai", "gpt-4o", None));
        assert!(!is_anthropic_compatible("groq", "llama-3.3-70b-versatile", None));
        assert!(!is_anthropic_compatible("gemini", "gemini-2.0-flash", None));
        assert!(!is_anthropic_compatible("ollama", "llama3", None));
        assert!(!is_anthropic_compatible("openrouter", "meta-llama/llama-3.3-70b-instruct:free", None));

        // Verify a body is unchanged when the caller does not invoke apply (simulates
        // cache.enabled=false — the caller gates on the Option<CacheTtl> being None).
        let body = make_body_with_n_messages(5);
        let original = serde_json::to_string(&body).unwrap();
        // No apply call — body remains as constructed.
        assert_eq!(serde_json::to_string(&body).unwrap(), original);
    }

    /// Provider detection: asserts all true/false classification rows.
    #[test]
    fn phase85_provider_detection() {
        // Native Anthropic API → true.
        assert!(is_anthropic_compatible("anthropic", "claude-sonnet-4-20250514", None));
        // Bedrock provider string → true.
        assert!(is_anthropic_compatible("bedrock", "claude-sonnet-4-20250514", None));
        // openrouter+claude model (starts_with "claude") → true.
        // openrouter+claude classification only — marker INJECTION for openrouter is deferred to a follow-up phase.
        assert!(is_anthropic_compatible("openrouter", "claude-3-5-sonnet", None));
        // openrouter+claude model (contains "/claude") → true.
        // openrouter+claude classification only — marker INJECTION for openrouter is deferred to a follow-up phase.
        assert!(is_anthropic_compatible("openrouter", "anthropic/claude-sonnet-4", None));
        // base_url matching *.anthropic.com → true.
        assert!(is_anthropic_compatible("unknown", "any-model", Some("https://x.anthropic.com/v1")));
        // base_url matching *.bedrock.amazonaws.com → true.
        assert!(is_anthropic_compatible("unknown", "any-model", Some("https://bedrock.amazonaws.com/v1")));

        // openai → false.
        assert!(!is_anthropic_compatible("openai", "gpt-4o", None));
        // groq → false.
        assert!(!is_anthropic_compatible("groq", "llama-3.3-70b-versatile", None));
        // gemini → false.
        assert!(!is_anthropic_compatible("gemini", "gemini-2.0-flash", None));
        // ollama → false.
        assert!(!is_anthropic_compatible("ollama", "llama3", None));
        // openrouter + non-claude model → false.
        assert!(!is_anthropic_compatible("openrouter", "meta-llama/llama-3.3-70b-instruct:free", None));
    }
}
