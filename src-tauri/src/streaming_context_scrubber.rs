// src-tauri/src/streaming_context_scrubber.rs
//
// Phase 86 (RECALL-SCRUBBER) — minimal post-accumulation echo strip.
//
// Plan 03 injects a `<memory-context>...</memory-context>` fence into the user
// message to carry recalled (often PRIVATE) memory. Models sometimes echo such
// fences verbatim. If that echo reaches the persisted JSONL / displayed output /
// learn-from-text path, recalled private data leaks into the saved transcript.
// `strip` removes the echo before any of those consumers see it (Plan 03 wires
// the call at the assistant-turn site, NEVER on user input).
//
// Scope: MINIMAL post-accumulation strip only. The full mid-stream
// StreamingContextScrubber is deferred to v2.7 Phase 98.

use once_cell::sync::Lazy;
use regex::Regex;

// Non-greedy, dot-all (`(?s)`) so a multi-line fenced span ANYWHERE in the text
// is removed. Matches the fence shape Plan 03 injects. The `regex` crate is a
// linear-time engine, so adversarial input cannot trigger catastrophic
// backtracking (T-86-05).
static FENCE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?s)<memory-context>.*?</memory-context>").unwrap());

/// Strip every `<memory-context>...</memory-context>` span (non-greedy, dot-all)
/// from assistant text. No-op pass-through when no fence present (RECALL-TEST #6).
pub fn strip(text: &str) -> String {
    if !text.contains("<memory-context>") {
        return text.to_string();
    }
    FENCE.replace_all(text, "").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recall_scrubber_strips_echo() {
        // Single-line span removed, surrounding text survives.
        let single = strip("ok <memory-context>x</memory-context> done");
        assert!(!single.contains("<memory-context>"));
        assert!(single.contains("ok") && single.contains("done"));

        // Mid-text span (fence not at the start) removed.
        let mid = strip("prefix here <memory-context>secret</memory-context> suffix");
        assert!(!mid.contains("<memory-context>"));
        assert!(mid.contains("prefix") && mid.contains("suffix"));

        // Multiline span removed (D-10: dot-all, strip anywhere).
        let multi = strip("a\n<memory-context>\nline1\nline2\n</memory-context>\nb");
        assert!(!multi.contains("<memory-context>"));
        assert!(!multi.contains("line1"));
        assert!(multi.contains('a') && multi.contains('b'));
    }

    #[test]
    fn recall_empty_recall_noop() {
        // No fence => pass-through unchanged.
        assert_eq!(strip("plain text"), "plain text");
        assert_eq!(strip(""), "");
    }

    #[test]
    fn recall_scrubber_multiple_spans() {
        let two = strip(
            "start <memory-context>one</memory-context> mid \
             <memory-context>two</memory-context> end",
        );
        assert!(!two.contains("<memory-context>"));
        assert!(!two.contains("</memory-context>"));
        assert!(two.contains("start") && two.contains("mid") && two.contains("end"));
    }
}
