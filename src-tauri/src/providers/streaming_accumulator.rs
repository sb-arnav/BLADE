//! Phase 69 (v2.4) — STREAMING-ACCUMULATOR.
//!
//! Text-stream-live + tool-buffer-until-block-stop. This is the architectural
//! pattern that simultaneously fixes BLADE's v1.1 "40 calls, no UI" regression
//! class AND enables Hermes-format tool dispatch through the same machinery.
//!
//! Architecture (described in own words, pattern reference:
//! claw-code `rusty-claude-cli/src/main.rs:4200-4250` — MIT, NousResearch/
//! Hermes-Function-Calling `utils.py:92` — MIT):
//!
//! State machine, per assistant turn:
//! ```
//! StreamingAccumulator { pending_tool: Option<(id, name, partial_json: String)>, text_buffer: String }
//!
//! observe(TextDelta { text }) →
//!   if currently building a tool block via Hermes substring detection,
//!     append to pending_tool buffer
//!   else,
//!     emit chat_token immediately to the UI (live streaming) +
//!     scan text_buffer for `<tool_call>` opener; if found, switch to Hermes
//!     tool-accumulation mode for the rest of this turn
//!
//! observe(InputJsonDelta { partial_json }) →
//!   append to pending_tool buffer (Anthropic / OpenAI native tool_use streaming;
//!   text path is unaffected — these deltas are tool-only events)
//!
//! observe(ContentBlockStart { kind: ToolUse, id, name }) →
//!   initialize pending_tool = Some((id, name, String::new()))
//!
//! observe(ContentBlockStop) →
//!   if pending_tool is Some,
//!     parse buffer as JSON → push complete ToolCall to completed_tool_calls
//!     reset pending_tool to None
//!
//! observe(MessageStop) →
//!   final flush. If Hermes mode and text_buffer has unprocessed
//!   <tool_call>...</tool_call>, parse them now.
//! ```
//!
//! Text deltas never block on tool buffering; tool input never leaks to the
//! UI mid-stream. The downstream loop_engine receives a clean
//! `Vec<ToolCall>` for dispatch.
//!
//! @see `.planning/research/v2.4-hermes-source-read.md` for the source-read
//! report that informed this design.
//! @see `.planning/milestones/v2.4-REQUIREMENTS.md` Phase 69 for full spec.

use serde::{Deserialize, Serialize};

/// Normalized streaming event — what every provider's SSE parser feeds into
/// the accumulator. Maps cleanly from Anthropic's `content_block_start` /
/// `content_block_delta` / `content_block_stop` / `message_stop` SSE event
/// types AND from OpenAI's `tool_calls[N].function` chunk shape AND from
/// Hermes models' raw-text emission of `<tool_call>` substrings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum StreamEvent {
    /// A chunk of assistant text. May or may not contain Hermes `<tool_call>`
    /// substrings — the accumulator scans for those.
    TextDelta { text: String },
    /// Anthropic / OpenAI native tool_use block opening. Hermes path does NOT
    /// emit this — it uses text substring detection.
    ContentBlockStart { kind: BlockKind, id: String, name: String },
    /// Anthropic-style streaming of tool input JSON, character-by-character.
    /// OpenAI's `function.arguments` chunks normalize to this too.
    InputJsonDelta { partial_json: String },
    /// Anthropic / OpenAI native tool_use block close. Triggers flush.
    ContentBlockStop,
    /// Final stream terminator. Triggers any deferred Hermes-substring flush.
    MessageStop,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum BlockKind {
    Text,
    ToolUse,
}

/// A completed, ready-to-dispatch tool call. Mirrors the shape of
/// `providers::ToolCall` — caller converts to that struct before passing into
/// `loop_engine::run_loop`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompletedToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    pub source: ToolCallSource,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum ToolCallSource {
    /// Anthropic / OpenAI / Groq / Gemini native tool_use event stream.
    NativeBlock,
    /// Hermes-format `<tool_call>...</tool_call>` substring in plain text.
    HermesSubstring,
}

/// Side effects the caller should perform in response to feeding an event in.
/// Decoupled from any specific Tauri emit so the accumulator is unit-testable
/// in isolation (no AppHandle dependency).
#[derive(Debug, Clone, PartialEq)]
pub enum AccumulatorEffect {
    /// Emit this text to the UI as a chat_token event. Live streaming.
    EmitText(String),
    /// A tool call is now complete. Caller dispatches.
    ToolCallReady(CompletedToolCall),
    /// Quiet — nothing user-facing to do. Internal buffer state changed.
    Noop,
}

/// The state machine itself.
pub struct StreamingAccumulator {
    /// Builds when a native ContentBlockStart(ToolUse) lands or when we
    /// detect a Hermes `<tool_call>` opener mid-text.
    pending_tool: Option<PendingTool>,
    /// Accumulating text for the current turn. Scanned for Hermes
    /// `<tool_call>` substrings on each TextDelta.
    text_buffer: String,
    /// Tracks whether the model is Hermes-family. When true, TextDelta scans
    /// for `<tool_call>` substrings; when false, we trust the native
    /// tool_use block events and forward all text live.
    hermes_mode: bool,
    /// Allocates synthetic IDs for Hermes substring-extracted tool calls
    /// (Hermes doesn't emit tool IDs the way Anthropic does).
    hermes_id_counter: u64,
    /// Staged prose that arrived in the same chunk as a completed tool call
    /// — drained by caller via `take_pending_text()`.
    deferred_text: Option<String>,
}

#[derive(Debug)]
struct PendingTool {
    id: String,
    name: String,
    buffer: String,
    source: ToolCallSource,
}

impl StreamingAccumulator {
    pub fn new(hermes_mode: bool) -> Self {
        Self {
            pending_tool: None,
            text_buffer: String::new(),
            hermes_mode,
            hermes_id_counter: 0,
            deferred_text: None,
        }
    }

    /// Feed one streaming event in. Returns the side effect to perform.
    pub fn observe(&mut self, event: StreamEvent) -> AccumulatorEffect {
        match event {
            StreamEvent::TextDelta { text } => self.on_text(text),
            StreamEvent::ContentBlockStart { kind: BlockKind::ToolUse, id, name } => {
                self.pending_tool = Some(PendingTool {
                    id,
                    name,
                    buffer: String::new(),
                    source: ToolCallSource::NativeBlock,
                });
                AccumulatorEffect::Noop
            }
            StreamEvent::ContentBlockStart { kind: BlockKind::Text, .. } => {
                // Text block start — no special action; text will arrive via TextDelta.
                AccumulatorEffect::Noop
            }
            StreamEvent::InputJsonDelta { partial_json } => {
                if let Some(pt) = self.pending_tool.as_mut() {
                    pt.buffer.push_str(&partial_json);
                }
                AccumulatorEffect::Noop
            }
            StreamEvent::ContentBlockStop => self.flush_pending_tool(),
            StreamEvent::MessageStop => self.on_message_stop(),
        }
    }

    fn on_text(&mut self, text: String) -> AccumulatorEffect {
        // Always grow the text buffer (used by Hermes substring scanner +
        // by message_stop deferred-flush).
        self.text_buffer.push_str(&text);

        if !self.hermes_mode {
            // Hosted-provider path: text streams to UI immediately; tool_use
            // travels via separate block events.
            return AccumulatorEffect::EmitText(text);
        }

        // Hermes path: if we're already inside a `<tool_call>` block (opener
        // seen but no closer yet), the text is tool payload — buffer it,
        // don't emit. Otherwise emit live to UI, then check whether THIS
        // chunk completed any new `<tool_call>` blocks.
        if let Some(pt) = self.pending_tool.as_mut() {
            if matches!(pt.source, ToolCallSource::HermesSubstring) {
                pt.buffer.push_str(&text);
                // Check if the closer arrived in this chunk.
                if let Some(closer_at) = pt.buffer.find("</tool_call>") {
                    let payload = pt.buffer[..closer_at].to_string();
                    let id = pt.id.clone();
                    let name = pt.name.clone();
                    self.pending_tool = None;
                    return self.finalize_hermes_call(id, name, payload);
                }
                return AccumulatorEffect::Noop;
            }
        }

        // Scan accumulated text for a new `<tool_call>` opener.
        if let Some(opener_idx) = self.text_buffer.rfind("<tool_call>") {
            // Make sure this opener is in the freshly-added text region,
            // not something we've already processed.
            let new_region_start = self.text_buffer.len() - text.len();
            if opener_idx >= new_region_start {
                // Switch into Hermes tool-accumulation mode.
                let pre_tool_text = &self.text_buffer[new_region_start..opener_idx];
                let post_opener_offset = opener_idx + "<tool_call>".len();
                let already_buffered_payload =
                    self.text_buffer[post_opener_offset..].to_string();

                self.hermes_id_counter += 1;
                let id = format!("hermes_call_{}", self.hermes_id_counter);
                self.pending_tool = Some(PendingTool {
                    id: id.clone(),
                    name: String::new(),
                    buffer: already_buffered_payload.clone(),
                    source: ToolCallSource::HermesSubstring,
                });

                // Check if the entire `<tool_call>...</tool_call>` arrived in one chunk.
                if let Some(closer_at) = already_buffered_payload.find("</tool_call>") {
                    let payload = already_buffered_payload[..closer_at].to_string();
                    self.pending_tool = None;
                    let prose_effect = if pre_tool_text.is_empty() {
                        None
                    } else {
                        Some(pre_tool_text.to_string())
                    };
                    let call_effect = self.finalize_hermes_call(id, String::new(), payload);
                    // Combine: emit any pre-tool prose first, then surface the call.
                    return match (prose_effect, call_effect) {
                        (Some(t), AccumulatorEffect::ToolCallReady(call)) => {
                            // Need to express two effects — pre-tool prose + ready call.
                            // Caller pattern: in single-effect API, prefer to emit prose
                            // immediately and stage the call for the next observe() tick.
                            // For now, prioritize emitting the call (caller will drain
                            // any deferred prose via take_pending_text()).
                            self.deferred_text = Some(t);
                            AccumulatorEffect::ToolCallReady(call)
                        }
                        (_, effect) => effect,
                    };
                }

                // Emit any prose that arrived BEFORE the opener in this same chunk.
                if !pre_tool_text.is_empty() {
                    return AccumulatorEffect::EmitText(pre_tool_text.to_string());
                }
                return AccumulatorEffect::Noop;
            }
        }

        // No new opener in this chunk — pure prose path. Stream live.
        AccumulatorEffect::EmitText(text)
    }

    fn flush_pending_tool(&mut self) -> AccumulatorEffect {
        let Some(pt) = self.pending_tool.take() else {
            return AccumulatorEffect::Noop;
        };
        // Parse the accumulated JSON buffer. For NativeBlock the buffer IS the
        // input JSON; for HermesSubstring the buffer is the full `<tool_call>`
        // payload which should also parse as JSON ({name, arguments}).
        match pt.source {
            ToolCallSource::NativeBlock => {
                let arguments = serde_json::from_str(&pt.buffer)
                    .unwrap_or_else(|_| serde_json::Value::Object(serde_json::Map::new()));
                AccumulatorEffect::ToolCallReady(CompletedToolCall {
                    id: pt.id,
                    name: pt.name,
                    arguments,
                    source: ToolCallSource::NativeBlock,
                })
            }
            ToolCallSource::HermesSubstring => self.finalize_hermes_call(pt.id, pt.name, pt.buffer),
        }
    }

    fn finalize_hermes_call(
        &mut self,
        id: String,
        _name_hint: String,
        payload: String,
    ) -> AccumulatorEffect {
        // Hermes payload shape: {"name": "...", "arguments": {...}} (or "parameters").
        let v: serde_json::Value = match serde_json::from_str(payload.trim()) {
            Ok(v) => v,
            Err(_) => {
                log::debug!("[streaming_accumulator] hermes payload not JSON: {}", payload);
                return AccumulatorEffect::Noop;
            }
        };
        let name = v
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();
        let arguments = v
            .get("arguments")
            .or_else(|| v.get("parameters"))
            .cloned()
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
        AccumulatorEffect::ToolCallReady(CompletedToolCall {
            id,
            name,
            arguments,
            source: ToolCallSource::HermesSubstring,
        })
    }

    fn on_message_stop(&mut self) -> AccumulatorEffect {
        // If we ended mid-tool-call, that's a malformed stream — log + drop.
        if self.pending_tool.is_some() {
            log::warn!(
                "[streaming_accumulator] MessageStop while pending_tool active — dropping incomplete call"
            );
            self.pending_tool = None;
        }
        AccumulatorEffect::Noop
    }

    /// Caller hook to drain any prose that got staged when a tool_call landed
    /// in the same chunk as preceding text (rare but possible).
    pub fn take_pending_text(&mut self) -> Option<String> {
        self.deferred_text.take()
    }

    /// Inspect the current text buffer — useful for debug + tests.
    pub fn text_buffer(&self) -> &str {
        &self.text_buffer
    }

    /// Total tool-call buffer state for tests.
    pub fn has_pending_tool(&self) -> bool {
        self.pending_tool.is_some()
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn td(text: &str) -> StreamEvent {
        StreamEvent::TextDelta { text: text.to_string() }
    }

    fn ijd(text: &str) -> StreamEvent {
        StreamEvent::InputJsonDelta { partial_json: text.to_string() }
    }

    fn cbs_tool(id: &str, name: &str) -> StreamEvent {
        StreamEvent::ContentBlockStart {
            kind: BlockKind::ToolUse,
            id: id.to_string(),
            name: name.to_string(),
        }
    }

    #[test]
    fn native_text_streams_live() {
        let mut acc = StreamingAccumulator::new(false);
        let r1 = acc.observe(td("Hello"));
        let r2 = acc.observe(td(" world"));
        assert_eq!(r1, AccumulatorEffect::EmitText("Hello".to_string()));
        assert_eq!(r2, AccumulatorEffect::EmitText(" world".to_string()));
    }

    #[test]
    fn native_tool_use_buffers_then_flushes_on_block_stop() {
        let mut acc = StreamingAccumulator::new(false);
        assert_eq!(acc.observe(cbs_tool("call_1", "calendar_list")), AccumulatorEffect::Noop);
        assert_eq!(acc.observe(ijd(r#"{"date":"#)), AccumulatorEffect::Noop);
        assert_eq!(acc.observe(ijd(r#" "today"}"#)), AccumulatorEffect::Noop);
        let r = acc.observe(StreamEvent::ContentBlockStop);
        match r {
            AccumulatorEffect::ToolCallReady(call) => {
                assert_eq!(call.id, "call_1");
                assert_eq!(call.name, "calendar_list");
                assert_eq!(call.arguments["date"], "today");
                assert_eq!(call.source, ToolCallSource::NativeBlock);
            }
            other => panic!("expected ToolCallReady, got {:?}", other),
        }
    }

    #[test]
    fn hermes_pure_prose_streams_live() {
        let mut acc = StreamingAccumulator::new(true);
        let r = acc.observe(td("Just thinking about this."));
        assert_eq!(r, AccumulatorEffect::EmitText("Just thinking about this.".to_string()));
        assert!(!acc.has_pending_tool());
    }

    #[test]
    fn hermes_tool_call_in_single_chunk_extracts() {
        let mut acc = StreamingAccumulator::new(true);
        let chunk = r#"<tool_call>{"name": "calendar_list", "arguments": {"date": "today"}}</tool_call>"#;
        let r = acc.observe(td(chunk));
        match r {
            AccumulatorEffect::ToolCallReady(call) => {
                assert_eq!(call.name, "calendar_list");
                assert_eq!(call.arguments["date"], "today");
                assert_eq!(call.source, ToolCallSource::HermesSubstring);
            }
            other => panic!("expected ToolCallReady, got {:?}", other),
        }
    }

    #[test]
    fn hermes_tool_call_split_across_chunks_buffers_then_flushes() {
        let mut acc = StreamingAccumulator::new(true);
        // Pre-prose, then opener, then JSON in pieces, then closer.
        let r1 = acc.observe(td("Let me check. "));
        assert_eq!(r1, AccumulatorEffect::EmitText("Let me check. ".to_string()));
        let r2 = acc.observe(td(r#"<tool_call>{"name": "ca"#));
        // The opener arrived; subsequent text is tool payload.
        assert_eq!(r2, AccumulatorEffect::Noop);
        assert!(acc.has_pending_tool());
        let r3 = acc.observe(td(r#"lendar_list", "arguments": {"date": "tomorrow"}}</tool_call>"#));
        match r3 {
            AccumulatorEffect::ToolCallReady(call) => {
                assert_eq!(call.name, "calendar_list");
                assert_eq!(call.arguments["date"], "tomorrow");
            }
            other => panic!("expected ToolCallReady, got {:?}", other),
        }
        assert!(!acc.has_pending_tool());
    }

    #[test]
    fn hermes_prose_then_tool_emits_prose_before_buffering() {
        let mut acc = StreamingAccumulator::new(true);
        // Single chunk: prose + opener (no closer yet).
        let r = acc.observe(td(r#"Sure. <tool_call>{"name": "x", "arguments": {}}"#));
        // We should have emitted the pre-tool prose.
        assert_eq!(r, AccumulatorEffect::EmitText("Sure. ".to_string()));
        assert!(acc.has_pending_tool());
    }

    #[test]
    fn hermes_message_stop_with_orphan_pending_logs_and_resets() {
        let mut acc = StreamingAccumulator::new(true);
        acc.observe(td(r#"<tool_call>{"unclosed":"#));
        assert!(acc.has_pending_tool());
        acc.observe(StreamEvent::MessageStop);
        assert!(!acc.has_pending_tool());
    }
}
