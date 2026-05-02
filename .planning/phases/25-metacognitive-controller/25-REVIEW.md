---
phase: 25-metacognitive-controller
reviewed: 2026-05-02T14:22:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src-tauri/src/metacognition.rs
  - src-tauri/src/reasoning_engine.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/doctor.rs
  - src-tauri/src/lib.rs
  - src/lib/tauri/admin.ts
  - src/features/admin/DoctorPane.tsx
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 25: Code Review Report

**Reviewed:** 2026-05-02T14:22:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 25 adds metacognitive awareness to BLADE through four integrated changes: (1) a `MetacognitiveState` struct with OnceLock + SQLite persistence, (2) confidence-delta detection and secondary verifier in the reasoning engine, (3) a tool-loop gap logging fallback in commands.rs, and (4) a Doctor signal class with full TypeScript/DoctorPane wiring.

The overall implementation is solid and well-structured. The Doctor integration follows the established D-02 through D-21 patterns correctly. The TypeScript types and DoctorPane row order are in lockstep with the Rust enum. The `secondary_verifier_call` fail-open design is appropriate for a non-critical verification path.

Four warnings found -- most notably a dead-code bug in the people-graph knowledge assessment that silently disables a scoring pathway, and a counter-accumulation issue that can permanently lock the Doctor signal to Red.

## Warnings

### WR-01: People-graph score boost is dead code due to lowercase input

**File:** `src-tauri/src/metacognition.rs:223-226`
**Issue:** `assess_knowledge_level` receives `query_lower` (already `.to_lowercase()`'d at line 148-151), but the `has_people` heuristic checks `w.chars().next().map(|c| c.is_uppercase())`. Since all characters in `query_lower` are lowercase, `is_uppercase()` always returns `false`. The `+0.15` people-graph knowledge boost never fires, meaning BLADE underestimates its knowledge about queries involving known contacts.
**Fix:**
```rust
// In assess_cognitive_state, pass the ORIGINAL query to assess_knowledge_level
// for the people-detection heuristic, or change assess_knowledge_level to accept
// both the lowered query (for content matching) and the original (for case detection):
fn assess_knowledge_level(query: &str) -> (String, f32) {
    let query_lower = query.to_lowercase(); // lowercase locally for content matching
    // ... existing typed_memory and knowledge_graph checks use query_lower ...
    
    // People detection uses ORIGINAL query to detect capitalized names
    let words: Vec<&str> = query.split_whitespace().collect();
    let has_people = words.iter().any(|w| {
        w.len() >= 2 && w.chars().next().map(|c| c.is_uppercase()).unwrap_or(false)
    });
    // ...
}
```

### WR-02: MetacognitiveState counters accumulate permanently, locking Doctor signal to Red

**File:** `src-tauri/src/metacognition.rs:82-93` and `src-tauri/src/metacognition.rs:122-127`
**Issue:** `gap_count` and `uncertainty_count` in `MetacognitiveState` only increment (via `record_uncertainty_marker` and `log_gap`) and are persisted to SQLite. There is no mechanism to reset or decay these counters. The Doctor signal at `doctor.rs:955` classifies `gap_count >= 3` as Red. Once three gaps accumulate (even across multiple app sessions over days/weeks), the Metacognitive Doctor signal locks to Red permanently. The `suggested_fix` copy at line 148 says "in the current session" for the 5+ uncertainty threshold, but the state persists across sessions.
**Fix:** Add a session-scoped reset on app startup or implement time-windowed decay:
```rust
// Option A: Reset counters on app startup (add to skeleton::init_all_tables or similar)
pub fn reset_session_counters() {
    if let Ok(mut state) = meta_store().lock() {
        state.uncertainty_count = 0;
        // Keep gap_count if you want cross-session tracking, or reset it too
        persist_meta_state(&state);
    }
}

// Option B: Time-windowed severity in compute_metacognitive_signal
// Count gaps from the last 24h/7d instead of using the cumulative counter
```

### WR-03: Verifier call is wasted when synth_confidence < 0.5

**File:** `src-tauri/src/reasoning_engine.rs:762-788`
**Issue:** When `synth_confidence < 0.5` (regardless of `any_uncertainty_flag`), the secondary verifier is called. But even if the verifier returns `verified = true`, the condition at line 768 `if !verified || synth_confidence < 0.5` still fires because `synth_confidence < 0.5` is always true in that branch. The verifier's approval is discarded and the initiative phrasing replaces the synthesized answer unconditionally. This burns an LLM API call for no effect.
**Fix:**
```rust
// If confidence < 0.5 is meant to always trigger initiative phrasing regardless
// of verification, skip the verifier call entirely in that case:
let (final_answer, total_confidence) = if synth_confidence < 0.5 {
    // Low confidence -> initiative phrasing directly, no verifier needed
    let topic = extract_topic(&full_question);
    let meta_state = crate::metacognition::get_state();
    crate::metacognition::log_gap(&topic, question, synth_confidence, meta_state.uncertainty_count);
    (build_initiative_response(&topic), synth_confidence)
} else if any_uncertainty_flag {
    // Moderate confidence but step-level drops -> verify
    let (verified, concern) = secondary_verifier_call(...).await;
    if !verified { /* initiative phrasing */ } else { (synth_answer, synth_confidence) }
} else {
    (synth_answer, synth_confidence)
};
```

### WR-04: DefaultHasher produces non-stable hashes across Rust versions

**File:** `src-tauri/src/metacognition.rs:453-463`
**Issue:** `hash_problem` uses `std::collections::hash_map::DefaultHasher` which is explicitly documented as not guaranteeing hash stability across Rust versions or architectures. If the Rust toolchain is updated, all existing `problem_hash` values in the `solution_memory` table become orphans -- the exact-match path in `recall_solution` (line 436) will never find them, silently degrading solution recall. The fuzzy LIKE fallback (line 446) partially compensates but only for problems with overlapping text.
**Fix:** Use a stable hash function. A simple option that avoids adding dependencies:
```rust
fn hash_problem(problem: &str) -> String {
    use std::fmt::Write;
    // Simple FNV-1a or use the existing crate's hashing
    let normalized: String = problem.to_lowercase()
        .chars().filter(|c| c.is_alphanumeric() || c.is_whitespace()).collect::<String>()
        .split_whitespace().collect::<Vec<&str>>().join(" ");
    let key = crate::safe_slice(&normalized, 80);
    // Use a deterministic hash (e.g., CRC32 or just the normalized string itself as the key)
    format!("sol-{}", key)  // or use a stable hash crate
}
```

## Info

### IN-01: Empty topic in initiative phrasing for edge-case queries

**File:** `src-tauri/src/reasoning_engine.rs:665-674`
**Issue:** If the user's question starts with a delimiter character (`?`, `.`, `\n`), `extract_topic` returns an empty string (e.g., question `"?"` yields `pos = 0`, topic `""`). This produces "I'm not confident about  -- want me to observe first?" with an empty topic. While unlikely in practice, it produces awkward phrasing.
**Fix:** Add a fallback:
```rust
let topic_str = crate::safe_slice(topic, 60).to_string();
if topic_str.is_empty() { "this topic".to_string() } else { topic_str }
```

### IN-02: Silent error swallowing on all DB operations in metacognition.rs

**File:** `src-tauri/src/metacognition.rs:49-60, 62-78, 97-128`
**Issue:** Every database operation in the module uses `let _ =` to discard errors (DB open, execute, serialize). While this is defensive and prevents panics, it means gap logging failures, state persistence failures, and table creation failures are completely invisible. A `log::warn!` on failure would aid debugging without changing behavior.
**Fix:** Replace `let _ = conn.execute(...)` with:
```rust
if let Err(e) = conn.execute(...) {
    log::warn!("[metacognition] DB write failed: {}", e);
}
```

### IN-03: Suggested-fix copy says "5+ uncertainty markers in the current session" but state persists across sessions

**File:** `src-tauri/src/doctor.rs:147`
**Issue:** The Amber suggested-fix string says "5+ uncertainty markers have fired in the current session" but `MetacognitiveState.uncertainty_count` persists to SQLite and loads on startup (see WR-02). The text implies session-scoped counting that does not match the implementation. This is a documentation/copy accuracy issue related to WR-02.
**Fix:** Either fix the accumulation behavior (WR-02) or update the copy to say "5+ uncertainty markers have fired since last reset" to match the actual semantics.

---

_Reviewed: 2026-05-02T14:22:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
