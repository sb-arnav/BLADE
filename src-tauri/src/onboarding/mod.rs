//! Phase 46 — Agentic Hunt Onboarding.
//!
//! Replaces the v1.6 4-step wizard (Steps.tsx + ApiKeyEntry + DeepScanReview +
//! PersonaCheck) with the LLM-driven agentic hunt per
//! `.planning/v2.0-onboarding-spec.md` (locked 2026-05-13).
//!
//! Flow (Acts 1–7 in spec):
//!
//!   1. App launches. Chat window paints.
//!   2. `pre_scan::run_pre_scan` (HUNT-01) fills an InitialContext in ≤2s.
//!   3. Frontend (`Hunt.tsx`) calls Tauri command `start_hunt_cmd`.
//!   4. Rust emits Message #1 (HUNT-02) via `compose_message_one`.
//!   5. Rust spawns `hunt::start_hunt` (HUNT-03) on a background task.
//!      The hunt LLM session reads `platform_paths.md` (HUNT-04), narrates
//!      every probe via `blade_hunt_line` events, and resolves to a final
//!      synthesis turn.
//!   6. `synthesis::on_hunt_done` (HUNT-07) writes `~/.blade/who-you-are.md`,
//!      emits the closing chat-line that invites the first task (HUNT-08),
//!      and flips `persona_onboarding_complete = true` so the gate clears.
//!
//! No-data fallback (HUNT-05 basic): if no API key, emit one sharp question.
//! Contradiction surfacing (HUNT-06 basic): instructed in the hunt system prompt.

pub mod pre_scan;
pub mod hunt;
pub mod synthesis;
pub mod contradictions;

use pre_scan::InitialContext;

/// HUNT-02 — compose the four-sentence first chat-line per spec Act 2.
///
/// Four sentences:
///   1. Disclosure of what was found on the machine.
///   2. Default model choice + reasoning.
///   3. Override options including "use Ollama only" + "skip".
///   4. Implicit handoff to the next message.
pub fn compose_message_one(ctx: &InitialContext) -> String {
    let mut found: Vec<&str> = Vec::new();
    if ctx.agents.claude.is_some() { found.push("Claude Code"); }
    if ctx.agents.cursor.is_some() { found.push("Cursor"); }
    if ctx.agents.gh.is_some()     { found.push("GitHub CLI"); }
    if ctx.agents.aider.is_some()  { found.push("Aider"); }
    if ctx.agents.codex.is_some()  { found.push("Codex"); }
    if ctx.agents.goose.is_some()  { found.push("Goose"); }
    if ctx.ollama_running          { found.push("Ollama (running)"); }

    let mut keys: Vec<&str> = Vec::new();
    if ctx.env_keys.anthropic || ctx.keyring_keys.anthropic { keys.push("Anthropic"); }
    if ctx.env_keys.openai    || ctx.keyring_keys.openai    { keys.push("OpenAI"); }
    if ctx.env_keys.groq      || ctx.keyring_keys.groq      { keys.push("Groq"); }
    if ctx.env_keys.gemini    || ctx.keyring_keys.gemini    { keys.push("Gemini"); }
    if ctx.env_keys.xai       || ctx.keyring_keys.xai       { keys.push("xAI"); }
    if ctx.env_keys.openrouter|| ctx.keyring_keys.openrouter{ keys.push("OpenRouter"); }

    let agents_line = if found.is_empty() {
        "Fresh machine — no agents detected".to_string()
    } else {
        format!("Found these on your machine: {}", found.join(", "))
    };
    let keys_line = if keys.is_empty() {
        "No API keys yet".to_string()
    } else {
        format!("{} {} key{}", if found.is_empty() { "Found" } else { "+" }, keys.join(" + "), if keys.len() == 1 { "" } else { "s" })
    };

    // Default model choice — per spec: claude-opus-4-7 if Anthropic, else
    // the cheapest free-tier path we know works.
    let (default_provider, default_reason) = if ctx.env_keys.anthropic || ctx.keyring_keys.anthropic {
        ("Anthropic claude-sonnet-4 for thinking", "best reasoning available with your key")
    } else if ctx.env_keys.groq || ctx.keyring_keys.groq {
        ("Groq llama-3.3-70b", "fastest free-tier path with your key")
    } else if ctx.env_keys.gemini || ctx.keyring_keys.gemini {
        ("Gemini 2.0 flash", "free tier + fast")
    } else if ctx.env_keys.openai || ctx.keyring_keys.openai {
        ("OpenAI gpt-4o-mini", "reliable + cheap")
    } else if ctx.ollama_running {
        ("Ollama (local llama3.2)", "you have it running locally — fully offline")
    } else {
        ("Anthropic claude-sonnet-4 (needs key)", "best reasoning; you'll need to paste a key")
    };

    format!(
        "{}. {}.\n\n\
         I'll default to {} — {}.\n\n\
         Use what I found, or paste a different key. Say \"use Ollama only\" to stay 100% local. Say \"skip\" if you want to start talking now and set this up later.\n\n\
         Otherwise, just answer the next message.",
        agents_line, keys_line, default_provider, default_reason
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use pre_scan::{AgentPresence, ApiKeyPresence};

    #[test]
    fn message_one_rich_machine() {
        let ctx = InitialContext {
            agents: AgentPresence {
                claude: Some("/usr/local/bin/claude".into()),
                cursor: Some("/usr/local/bin/cursor".into()),
                ..Default::default()
            },
            env_keys: ApiKeyPresence { anthropic: true, groq: true, ..Default::default() },
            ollama_running: true,
            os: "macos".into(),
            arch: "aarch64".into(),
            ..Default::default()
        };
        let msg = compose_message_one(&ctx);
        assert!(msg.contains("Claude Code"));
        assert!(msg.contains("Cursor"));
        assert!(msg.contains("Anthropic"));
        assert!(msg.contains("Groq"));
        assert!(msg.contains("Ollama"));
        assert!(msg.contains("default to Anthropic"));
        // The four-paragraph shape: three \n\n separators.
        assert_eq!(msg.matches("\n\n").count(), 3);
    }

    #[test]
    fn message_one_fresh_machine() {
        let ctx = InitialContext::default();
        let msg = compose_message_one(&ctx);
        assert!(msg.contains("Fresh machine"));
        assert!(msg.contains("No API keys yet"));
        assert!(msg.contains("skip"));
        assert!(msg.contains("Ollama only"));
    }

    #[test]
    fn message_one_only_groq() {
        let ctx = InitialContext {
            env_keys: ApiKeyPresence { groq: true, ..Default::default() },
            ..Default::default()
        };
        let msg = compose_message_one(&ctx);
        assert!(msg.contains("Groq"));
        assert!(msg.contains("free-tier"));
    }
}
