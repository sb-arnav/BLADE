//! Phase 68 (v2.4) — HERMES-GRAMMAR.
//!
//! Hermes Function Calling format emit + parse. Targets any model trained on
//! Hermes Function Calling (NousResearch/Hermes-Function-Calling, MIT licensed
//! pattern source) — Hermes 3/4, DeepHermes, Hermes-trained Qwen variants,
//! Hermes-trained Llama variants. Plain ChatML XML conventions, NO special
//! tokens (deep source-read 2026-05-17 confirmed: `<tool_call>` is a substring
//! the model is trained to emit, not a tokenizer special-token).
//!
//! Architecture per `.planning/research/v2.4-hermes-source-read.md`:
//! - Emit: 6-field system-prompt scaffold (Role / Objective / Tools / Examples
//!   / Schema / Instructions) with the tools JSON-Schema list interpolated into
//!   the Tools field. Output goes into the assistant's system message.
//! - Parse: scan assistant output for `<tool_call>...</tool_call>` substring
//!   blocks; JSON-parse the inner payload into `{name, arguments}`. Treat
//!   `<tool_response>...</tool_response>` as the result-injection format for
//!   the next user/tool turn.
//!
//! Hermes models emit prose OR tool calls per turn, never both in the same
//! turn — caller (loop_engine) must handle this turn-disjointness.
//!
//! Reference: NousResearch/Hermes-Function-Calling (MIT) — `utils.py:92`
//! `validate_and_extract_tool_calls` is the canonical Python parser. This is
//! the Rust port; written in own words, no verbatim code lifted.

use serde::{Deserialize, Serialize};

/// A parsed Hermes-format tool call. Mirrors the existing `providers::ToolCall`
/// shape so the rest of the pipeline doesn't care which format produced it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HermesToolCall {
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Build the Hermes-format system-prompt tools block. Returns a string suitable
/// for concatenation into the system message of a Hermes-family model.
///
/// Output shape (the canonical Hermes Function Calling format — plain text,
/// no copyrighted prompt copy reproduced from upstream):
///
/// ```text
/// You have access to the following tools. To call one, output a JSON block
/// inside <tool_call>...</tool_call> tags. Use one tool at a time per turn.
///
/// <tools>
///   [{"name": "...", "description": "...", "parameters": {...}}, ...]
/// </tools>
///
/// Each tool call must use this exact schema:
///   <tool_call>{"name": "<tool_name>", "arguments": {...}}</tool_call>
/// ```
pub fn serialize_tools_hermes(tools: &[crate::providers::ToolDefinition]) -> String {
    if tools.is_empty() {
        return String::new();
    }

    let tools_json: Vec<serde_json::Value> = tools
        .iter()
        .map(|t| {
            serde_json::json!({
                "name": t.name,
                "description": t.description,
                "parameters": t.input_schema,
            })
        })
        .collect();

    let tools_block = serde_json::to_string_pretty(&tools_json).unwrap_or_else(|_| "[]".to_string());

    format!(
        "You have access to the following tools. To call one, output a JSON block inside `<tool_call>...</tool_call>` tags. Use one tool at a time per turn.\n\n\
         <tools>\n{}\n</tools>\n\n\
         Each tool call must use this exact schema:\n\
         <tool_call>{{\"name\": \"<tool_name>\", \"arguments\": {{...}}}}</tool_call>\n\n\
         When the tool returns, you will see a `<tool_response>...</tool_response>` block. \
         After all needed tool calls complete, respond to the user in plain prose without further tags.",
        tools_block
    )
}

/// Build the tool-result injection block. Hermes uses `<tool_response>...</tool_response>`
/// to feed tool results back into the model's context as the next "tool" role
/// message (per `functioncall.py:133` in Hermes-FC). Body is the tool's stdout
/// or structured return value as a JSON string.
pub fn serialize_tool_result_hermes(name: &str, result: &str) -> String {
    let payload = serde_json::json!({ "name": name, "content": result }).to_string();
    format!("<tool_response>{}</tool_response>", payload)
}

/// Parse all Hermes-format tool calls from an assistant turn's full text body.
/// Returns the calls in emit order. Returns an empty Vec if no `<tool_call>`
/// blocks present (the assistant turn is pure prose).
///
/// Robust to: whitespace inside tags, multiple tool calls per turn, malformed
/// JSON inside a single block (skipped with a debug log), missing closing tag
/// (treated as "no tool call present").
pub fn parse_tool_calls_hermes(text: &str) -> Vec<HermesToolCall> {
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(open_rel) = text[cursor..].find("<tool_call>") {
        let open = cursor + open_rel + "<tool_call>".len();
        let Some(close_rel) = text[open..].find("</tool_call>") else {
            // Unterminated tag — treat as no more calls (matches Hermes's
            // reference parser behavior: missing closing tag = malformed,
            // skip rest of stream).
            break;
        };
        let close = open + close_rel;
        let inner = text[open..close].trim();
        match parse_single_tool_call_json(inner) {
            Some(call) => out.push(call),
            None => {
                // Malformed JSON inside <tool_call>...</tool_call> — log + skip.
                log::debug!("[hermes_format] skipping malformed tool_call payload: {}", inner);
            }
        }
        cursor = close + "</tool_call>".len();
    }
    out
}

/// Parse a single `<tool_call>` payload (the JSON between the tags). Tolerates
/// both `{"name": ..., "arguments": ...}` and `{"name": ..., "parameters": ...}`
/// variants — different fine-tunes of Hermes use slightly different field names
/// for the args; both have been observed in the wild.
fn parse_single_tool_call_json(inner: &str) -> Option<HermesToolCall> {
    let v: serde_json::Value = serde_json::from_str(inner).ok()?;
    let name = v.get("name")?.as_str()?.to_string();
    let arguments = v
        .get("arguments")
        .or_else(|| v.get("parameters"))
        .cloned()
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    Some(HermesToolCall { name, arguments })
}

/// Substring test — does the assistant turn body contain any `<tool_call>`
/// opener? Used by the streaming accumulator (Phase 69) to decide whether the
/// current text stream is on a tool-emit trajectory or a pure-prose one.
pub fn contains_tool_call_opener(buf: &str) -> bool {
    buf.contains("<tool_call>")
}

/// Detect whether a model name is in the Hermes family. Provider gate handled
/// by caller (only local providers like ollama / lmstudio should engage the
/// Hermes prompt + format path; never hosted Anthropic / OpenAI which use
/// native tool definitions).
///
/// Patterns covered:
/// - `hermes` (Hermes 1/2/3/4)
/// - `deephermes` (DeepHermes Llama variants)
/// - `nous-hermes` (early naming convention)
/// - `function-calling-specialist` (Atropos fine-tunes)
pub fn is_hermes_model(model: &str) -> bool {
    let m = model.to_lowercase();
    m.contains("hermes")
        || m.contains("deephermes")
        || m.contains("nous-hermes")
        || m.contains("function-calling-specialist")
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::providers::ToolDefinition;
    use serde_json::json;

    fn td(name: &str, desc: &str) -> ToolDefinition {
        ToolDefinition {
            name: name.to_string(),
            description: desc.to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string" }
                },
                "required": ["query"]
            }),
        }
    }

    #[test]
    fn serialize_emits_tools_block() {
        let tools = vec![td("calendar_list", "List calendar events")];
        let out = serialize_tools_hermes(&tools);
        assert!(out.contains("<tools>"));
        assert!(out.contains("</tools>"));
        assert!(out.contains("calendar_list"));
        assert!(out.contains("List calendar events"));
        assert!(out.contains("<tool_call>"));
    }

    #[test]
    fn serialize_empty_tools_returns_empty_string() {
        let tools: Vec<ToolDefinition> = vec![];
        assert_eq!(serialize_tools_hermes(&tools), "");
    }

    #[test]
    fn parse_extracts_single_tool_call() {
        let body = r#"Let me check.
<tool_call>{"name": "calendar_list", "arguments": {"date": "today"}}</tool_call>"#;
        let calls = parse_tool_calls_hermes(body);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "calendar_list");
        assert_eq!(calls[0].arguments["date"], "today");
    }

    #[test]
    fn parse_extracts_multiple_tool_calls() {
        let body = r#"<tool_call>{"name": "a", "arguments": {}}</tool_call>
<tool_call>{"name": "b", "arguments": {"x": 1}}</tool_call>"#;
        let calls = parse_tool_calls_hermes(body);
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].name, "a");
        assert_eq!(calls[1].name, "b");
        assert_eq!(calls[1].arguments["x"], 1);
    }

    #[test]
    fn parse_tolerates_parameters_field_variant() {
        // Some Hermes fine-tunes emit "parameters" instead of "arguments".
        let body = r#"<tool_call>{"name": "search", "parameters": {"q": "blade"}}</tool_call>"#;
        let calls = parse_tool_calls_hermes(body);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].arguments["q"], "blade");
    }

    #[test]
    fn parse_skips_malformed_json_inside_block() {
        let body = r#"<tool_call>not valid json</tool_call>
<tool_call>{"name": "ok", "arguments": {}}</tool_call>"#;
        let calls = parse_tool_calls_hermes(body);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "ok");
    }

    #[test]
    fn parse_handles_missing_closing_tag() {
        let body = r#"<tool_call>{"name": "incomplete""#;
        let calls = parse_tool_calls_hermes(body);
        assert_eq!(calls.len(), 0);
    }

    #[test]
    fn parse_returns_empty_for_pure_prose() {
        let body = "Just a plain text response with no tool calls at all.";
        assert_eq!(parse_tool_calls_hermes(body).len(), 0);
    }

    #[test]
    fn serialize_tool_result_wraps_in_tool_response() {
        let out = serialize_tool_result_hermes("calendar_list", "3 events today");
        assert!(out.starts_with("<tool_response>"));
        assert!(out.ends_with("</tool_response>"));
        assert!(out.contains("calendar_list"));
        assert!(out.contains("3 events today"));
    }

    #[test]
    fn is_hermes_model_positive_cases() {
        assert!(is_hermes_model("hermes-4-8b"));
        assert!(is_hermes_model("DeepHermes-3-Llama-3-8B"));
        assert!(is_hermes_model("nous-hermes-2-mistral-7b"));
        assert!(is_hermes_model("deephermes-toolcalling-specialist-atropos"));
        assert!(is_hermes_model("custom-function-calling-specialist"));
    }

    #[test]
    fn is_hermes_model_negative_cases() {
        assert!(!is_hermes_model("claude-sonnet-4-20250514"));
        assert!(!is_hermes_model("gpt-4o"));
        assert!(!is_hermes_model("llama-3.1-8b"));
        assert!(!is_hermes_model("qwen2.5-coder"));
    }

    #[test]
    fn contains_tool_call_opener_detects_early() {
        // The streaming accumulator (Phase 69) calls this against accumulating
        // text chunks to decide whether to switch modes.
        assert!(contains_tool_call_opener("Let me check. <tool_call>"));
        assert!(!contains_tool_call_opener("Just thinking out loud here."));
        assert!(!contains_tool_call_opener("<tool_response>not the opener</tool_response>"));
    }
}
