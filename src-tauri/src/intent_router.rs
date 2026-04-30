//! intent_router.rs body — heuristic-first / LLM-fallback (D-04).
//!
//! Phase 18 (chat-first reinterpretation) — see 18-CONTEXT.md D-03 (parallel to TaskType)
//! and D-04 (heuristic-first, LLM-fallback).
//!
//! Plan 18-06 fills the Wave 0 skeleton with the heuristic-first body.
//! Plan 18-14 (Wave 4) extends `classify_intent` to return `(IntentClass, ArgsBag)` so
//! the dispatcher can receive real args extracted from the user message instead of the
//! empty `{}` placeholder Plan 09 shipped.
//!
//! D-04 Step 2 (LLM-fallback) is DEFERRED to v1.3 per Plan 14 path B and 18-DEFERRAL.md —
//! heuristic-only suffices for v1.2 cold-install demo prompts. The hook
//! `classify_intent_llm` exists for v1.3 wiring; it returns None unconditionally in v1.2.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
}

/// ArgsBag — opaque key/value extracted heuristically from the user message.
/// Plan 14 addition; consumed by `jarvis_dispatch::try_native_tentacle` (which already
/// reads via `args.get("...").and_then(|v| v.as_str())`).
pub type ArgsBag = serde_json::Map<String, serde_json::Value>;

const ACTION_VERBS: &[&str] = &["post", "send", "create", "update", "comment", "draft", "reply"];

const SERVICES: &[(&str, &str)] = &[
    ("slack", "slack"),
    ("github", "github"),
    ("gmail", "gmail"),
    ("email", "gmail"), // alias — many users say "send email" meaning gmail
    ("calendar", "calendar"),
    ("linear", "linear"),
];

/// Heuristic-first classifier (D-04). Returns `(IntentClass, ArgsBag)`.
///
/// Tier 1: action verb × service token. Args are extracted heuristically per
/// service/action tuple. Tier 2 LLM-fallback DEFERRED to v1.3 per Plan 14 path B
/// and 18-DEFERRAL.md. Tier 1 short-circuits ≥80% of inputs (RESEARCH § Anti-Patterns lock).
pub async fn classify_intent(message: &str) -> (IntentClass, ArgsBag) {
    let intent = classify_intent_class(message).await;
    let args = match &intent {
        IntentClass::ChatOnly => serde_json::Map::new(),
        IntentClass::ActionRequired { service, action } => {
            extract_args(message, service, action)
        }
    };
    (intent, args)
}

/// Internal — kept separate from the public surface so tests can exercise the
/// classification logic without args extraction noise.
async fn classify_intent_class(message: &str) -> IntentClass {
    let lower = message.to_lowercase();

    // Tier 1: heuristic — action verb AND service token must both be present.
    if let Some((verb, service)) = match_heuristic(&lower) {
        return IntentClass::ActionRequired {
            service: service.to_string(),
            action: verb.to_string(),
        };
    }

    // Tier 2: LLM-fallback DEFERRED to v1.3 per Plan 14 path B and 18-DEFERRAL.md.
    // The hook exists; the body returns None unconditionally in v1.2.
    // Heuristic-only covers all cold-install demo prompts.
    classify_intent_llm(message)
        .await
        .unwrap_or(IntentClass::ChatOnly)
}

fn match_heuristic(lower: &str) -> Option<(&'static str, &'static str)> {
    for verb in ACTION_VERBS {
        if lower.contains(verb) {
            for (token, service) in SERVICES {
                if lower.contains(token) {
                    return Some((verb, service));
                }
            }
        }
    }
    None
}

/// Tier-2 LLM-fallback. Phase 18 ships a stub that returns None unconditionally.
/// D-04 Step 2 LLM-fallback DEFERRED to v1.3 per Plan 14 path B (see 18-DEFERRAL.md).
/// v1.3 wires the actual cheap-model call via `crate::router::select_provider`
/// when operator UAT surfaces heuristic miss-rate as a real friction.
async fn classify_intent_llm(_message: &str) -> Option<IntentClass> {
    None
}

// ── Plan 14 — heuristic args extraction ─────────────────────────────────────
//
// Tier-1 only for v1.2. The dispatcher's match arms (jarvis_dispatch::try_native_tentacle)
// already read `args.get("...").and_then(|v| v.as_str())`, so missing keys are tolerated:
// fields the heuristic can't parse are simply absent from the bag.

fn extract_args(message: &str, service: &str, action: &str) -> ArgsBag {
    use serde_json::Value;
    let mut bag = serde_json::Map::new();
    let trimmed = message.trim();

    match (service, action) {
        ("slack", _) => {
            // channel: prefer `#channel` token; fall back to "to channel" pattern.
            if let Some(channel) = extract_channel_after_hash(trimmed)
                .or_else(|| extract_after_marker_lc(trimmed, "to "))
            {
                bag.insert("channel".to_string(), Value::String(channel));
            }
            if let Some(text) = extract_quoted_or_after_colon(trimmed) {
                bag.insert("text".to_string(), Value::String(text));
            }
        }
        ("linear", _) => {
            // title: prefer quoted/after-colon content; else after the verb.
            if let Some(title) = extract_quoted_or_after_colon(trimmed)
                .or_else(|| extract_after_action_verb(trimmed, &["create", "make", "open"]))
            {
                bag.insert("title".to_string(), Value::String(title));
                // description: pass the full original message so auto_create_ticket has
                // enough context for its LLM-driven extraction. (Cold-install demo's
                // SC: "create a linear issue: test demo" — title=text-after-colon,
                // description=full message; auto_create_ticket re-extracts cleanly.)
                bag.insert("description".to_string(), Value::String(trimmed.to_string()));
            }
        }
        ("github", _) => {
            // owner / repo: from "owner/repo" pattern if present.
            if let Some((owner, repo)) = extract_github_owner_repo(trimmed) {
                bag.insert("owner".to_string(), Value::String(owner));
                bag.insert("repo".to_string(), Value::String(repo));
            }
            if let Some(title) = extract_quoted_or_after_colon(trimmed) {
                bag.insert("title".to_string(), Value::String(title));
                bag.insert("body".to_string(), Value::String(trimmed.to_string()));
            }
        }
        ("gmail", _) => {
            if let Some(to) = extract_after_marker_lc(trimmed, "to ") {
                bag.insert("to".to_string(), Value::String(to));
            }
            if let Some(subject) = extract_after_marker_lc(trimmed, "subject:") {
                bag.insert("subject".to_string(), Value::String(subject));
            }
            if let Some(body) = extract_quoted_or_after_colon(trimmed) {
                bag.insert("body".to_string(), Value::String(body));
            }
        }
        ("calendar", _) => {
            // meeting_title: after "summary of " / "summarize ".
            if let Some(title) = extract_after_marker_lc(trimmed, "summary of ")
                .or_else(|| extract_after_marker_lc(trimmed, "summarize "))
            {
                bag.insert("meeting_title".to_string(), Value::String(title));
            }
            // transcript: pass the raw message; caller (commands.rs) may override
            // with a real transcript from the meeting if available.
            bag.insert("transcript".to_string(), Value::String(trimmed.to_string()));
        }
        _ => {}
    }
    bag
}

// ── Heuristic helpers ───────────────────────────────────────────────────────

/// Extract content after the first occurrence of `marker` in a case-insensitive
/// search. Behaviour depends on `marker`:
/// - `"to "` → returns the FIRST whitespace-separated token (e.g. email address
///   or channel name). Inner periods (e.g. `bob@example.com`) are preserved
///   since email addresses and `#` channels MUST survive.
/// - Any other marker (e.g. `"subject:"`, `"summary of "`) → returns the rest
///   of the line up to the first newline or terminating sentence punctuation.
fn extract_after_marker_lc(s: &str, marker: &str) -> Option<String> {
    let lower = s.to_lowercase();
    let lower_marker = marker.to_lowercase();
    let idx = lower.find(&lower_marker)?;
    let start = idx + lower_marker.len();
    let rest = s.get(start..)?.trim_start();
    if rest.is_empty() {
        return None;
    }

    // For "to " specifically, take only the immediate next whitespace-bounded
    // token. This keeps emails (containing `.`) intact — `bob@example.com` is a
    // single token — while preventing prepositional drift ("to alice about the
    // launch" → just "alice", not "alice about the launch").
    if marker.trim() == "to" {
        let first = rest.split_whitespace().next()?;
        let cleaned = first.trim_end_matches([',', ';', '!', '?']);
        if cleaned.is_empty() {
            return None;
        }
        return Some(cleaned.to_string());
    }

    // Other markers take the rest of the line up to newline / sentence-terminal.
    let end = rest
        .find(['\n', ',', ';', '!', '?'])
        .unwrap_or(rest.len());
    let candidate = rest.get(..end)?.trim();
    // Trim a trailing period only if it ends a sentence (not inside an email or
    // a token where the period is part of the name).
    let candidate = candidate.trim_end_matches('.').trim();
    if candidate.is_empty() {
        None
    } else {
        Some(candidate.to_string())
    }
}

/// Extract a Slack-style `#channel` token. Returns the channel name without the `#`.
fn extract_channel_after_hash(s: &str) -> Option<String> {
    let idx = s.find('#')?;
    let rest = s.get(idx + 1..)?;
    let end = rest
        .find(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
        .unwrap_or(rest.len());
    let channel = rest.get(..end)?.trim();
    if channel.is_empty() {
        None
    } else {
        Some(channel.to_string())
    }
}

/// Prefer single/double quoted content. Otherwise text after the FIRST colon.
fn extract_quoted_or_after_colon(s: &str) -> Option<String> {
    if let Some(start) = s.find('\'') {
        if let Some(end_rel) = s[start + 1..].find('\'') {
            let q = &s[start + 1..start + 1 + end_rel];
            if !q.is_empty() {
                return Some(q.to_string());
            }
        }
    }
    if let Some(start) = s.find('"') {
        if let Some(end_rel) = s[start + 1..].find('"') {
            let q = &s[start + 1..start + 1 + end_rel];
            if !q.is_empty() {
                return Some(q.to_string());
            }
        }
    }
    if let Some(idx) = s.find(':') {
        let rest = s[idx + 1..].trim();
        if !rest.is_empty() {
            return Some(rest.to_string());
        }
    }
    None
}

/// Find the text after one of the action verbs, skipping articles and stop-phrases.
fn extract_after_action_verb(s: &str, verbs: &[&str]) -> Option<String> {
    let lower = s.to_lowercase();
    for verb in verbs {
        if let Some(idx) = lower.find(verb) {
            let after_byte = idx + verb.len();
            let after = s.get(after_byte..)?.trim_start();
            // Strip articles
            let after = after
                .strip_prefix("a ")
                .or_else(|| after.strip_prefix("A "))
                .or_else(|| after.strip_prefix("an "))
                .or_else(|| after.strip_prefix("An "))
                .or_else(|| after.strip_prefix("the "))
                .or_else(|| after.strip_prefix("The "))
                .unwrap_or(after);
            // Strip stop-phrases (service noun pairs)
            let after_lower = after.to_lowercase();
            for stop in &[
                "linear issue",
                "github issue",
                "slack message",
                "issue",
                "message",
                "ticket",
            ] {
                if after_lower.starts_with(stop) {
                    let stripped = &after[stop.len()..];
                    let candidate = stripped.trim_start_matches([':', ' ']).trim();
                    if !candidate.is_empty() {
                        return Some(candidate.to_string());
                    }
                }
            }
            let candidate = after.trim();
            if !candidate.is_empty() {
                return Some(candidate.to_string());
            }
        }
    }
    None
}

/// Match an `owner/repo` token. Both halves must be non-empty and consist only of
/// `[a-zA-Z0-9._-]` (mirrors GitHub's name validation).
fn extract_github_owner_repo(s: &str) -> Option<(String, String)> {
    for word in s.split_whitespace() {
        let core = word.trim_matches([',', '.', ':', ';', ')', '(', '\'', '"']);
        if core.contains('/') && !core.starts_with('/') && !core.ends_with('/') {
            if let Some((o, r)) = core.split_once('/') {
                let valid_char = |c: char| c.is_alphanumeric() || c == '-' || c == '_' || c == '.';
                if !o.is_empty()
                    && !r.is_empty()
                    && o.chars().all(valid_char)
                    && r.chars().all(valid_char)
                {
                    return Some((o.to_string(), r.to_string()));
                }
            }
        }
    }
    None
}

/// Tauri command — returns combined `{intent, args}` JSON so the frontend can
/// inspect both. Plan 14 widens the wire shape; consumers (admin.ts) updated.
#[tauri::command]
pub async fn intent_router_classify(message: String) -> serde_json::Value {
    let (intent, args) = classify_intent(&message).await;
    serde_json::json!({ "intent": intent, "args": args })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn classify_chat_only_for_greeting() {
        let (v, args) = classify_intent("hello there how are you").await;
        assert_eq!(v, IntentClass::ChatOnly);
        assert!(args.is_empty());
    }

    #[tokio::test]
    async fn classify_action_required_slack() {
        let (v, _args) = classify_intent("post 'shipping today' to #team in Slack").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "slack");
                assert_eq!(action, "post");
            }
            _ => panic!("expected ActionRequired/slack/post, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_linear() {
        let (v, _args) = classify_intent("create a Linear issue: test JARVIS demo from Phase 18").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "linear");
                assert_eq!(action, "create");
            }
            _ => panic!("expected ActionRequired/linear/create, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_gmail_via_email_alias() {
        let (v, _args) = classify_intent("send an email to alice about the launch").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "gmail");
                assert_eq!(action, "send");
            }
            _ => panic!("expected ActionRequired/gmail/send, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_github_comment() {
        let (v, _args) = classify_intent("comment on the GitHub PR with my review").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "github");
                assert_eq!(action, "comment");
            }
            _ => panic!("expected ActionRequired/github/comment, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn classify_action_required_calendar_create() {
        let (v, _args) = classify_intent("create a calendar event for tomorrow at 3pm").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "calendar");
                assert_eq!(action, "create");
            }
            _ => panic!("expected ActionRequired/calendar/create, got {v:?}"),
        }
    }

    #[tokio::test]
    async fn capitalization_invariant() {
        let (v, _args) = classify_intent("POST a message to Slack").await;
        match v {
            IntentClass::ActionRequired { service, action } => {
                assert_eq!(service, "slack");
                assert_eq!(action, "post");
            }
            _ => panic!("capitalization should not affect classification"),
        }
    }

    #[tokio::test]
    async fn heuristic_short_circuits_fast() {
        let start = std::time::Instant::now();
        let _ = classify_intent("post to Slack").await;
        let elapsed = start.elapsed();
        assert!(
            elapsed.as_millis() < 50,
            "heuristic should short-circuit; took {}ms",
            elapsed.as_millis()
        );
    }

    #[tokio::test]
    async fn no_action_verb_returns_chat_only() {
        let (v, args) = classify_intent("tell me about slack as a company").await;
        assert_eq!(v, IntentClass::ChatOnly);
        assert!(args.is_empty());
    }

    #[tokio::test]
    async fn no_service_token_returns_chat_only() {
        let (v, args) = classify_intent("post-modernism is an art movement").await;
        assert_eq!(v, IntentClass::ChatOnly);
        assert!(args.is_empty());
    }

    // ── Plan 14 — args extraction tests ──────────────────────────────────

    #[tokio::test]
    async fn extract_args_for_linear_create() {
        let (_, args) = classify_intent("create a linear issue: test demo").await;
        assert_eq!(
            args.get("title").and_then(|v| v.as_str()),
            Some("test demo")
        );
        assert!(args.get("description").is_some());
    }

    #[tokio::test]
    async fn extract_args_for_slack_post() {
        // Message must contain "slack" service token for heuristic to match
        // (intent classifier requires verb × service token; "#team" alone does not
        // map to slack at the classifier layer).
        let (_, args) = classify_intent("post 'hello world' to #team in slack").await;
        assert_eq!(args.get("channel").and_then(|v| v.as_str()), Some("team"));
        assert_eq!(args.get("text").and_then(|v| v.as_str()), Some("hello world"));
    }

    #[tokio::test]
    async fn extract_args_for_github_create() {
        let (_, args) = classify_intent("create a github issue in acme/widgets: ship phase 18").await;
        assert_eq!(args.get("owner").and_then(|v| v.as_str()), Some("acme"));
        assert_eq!(args.get("repo").and_then(|v| v.as_str()), Some("widgets"));
        assert_eq!(
            args.get("title").and_then(|v| v.as_str()),
            Some("ship phase 18")
        );
    }

    #[tokio::test]
    async fn extract_args_for_calendar_summary() {
        let (_, args) = classify_intent("create a calendar summary of weekly sync").await;
        assert!(args.get("meeting_title").is_some());
        assert!(args.get("transcript").is_some());
    }

    #[tokio::test]
    async fn extract_args_for_gmail_send() {
        let (_, args) = classify_intent("send an email to bob@example.com subject: launch update").await;
        assert_eq!(
            args.get("to").and_then(|v| v.as_str()),
            Some("bob@example.com")
        );
        assert!(args.get("subject").is_some());
    }

    #[tokio::test]
    async fn chat_only_returns_empty_args() {
        let (intent, args) = classify_intent("hello there").await;
        assert!(matches!(intent, IntentClass::ChatOnly));
        assert!(args.is_empty());
    }
}
