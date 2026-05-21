// Phase 83 (v2.5 CACHE-PARITY) / D-01..D-03 — per-session system-prompt cache.
//
// Mirrors `loop_engine.rs::CONVERSATION_STATES` (lines 231-321) exactly in
// shape — same Lazy<Mutex<HashMap<String, T>>> + Lazy<Mutex<VecDeque<String>>>
// FIFO eviction pattern, same CAP = 256, same poisoned-lock defense. Only the
// value type (`String` instead of `ConversationCarryOver`) and the addition of
// atomic hit/miss counters distinguish this module.
//
// Public API (locked by CONTEXT.md D-02):
//   pub fn get_cached(session_id: &str) -> Option<String>;
//   pub fn set_cached(session_id: &str, prompt: String);
//   pub fn clear_cached(session_id: &str);
//   pub fn clear_all_cached();
//   pub fn cache_hit_count() -> u64;       // atomic, relaxed
//   pub fn cache_miss_count() -> u64;      // atomic, relaxed
//   pub fn cache_stats() -> (u64, u64);    // (hits, misses) snapshot
//   pub(crate) fn increment_hit_count();   // wrapper-call internal
//   pub(crate) fn increment_miss_count();  // wrapper-call internal
//
// CAP = 256 matches loop_engine.rs::CONVERSATION_STATES_CAP. Memory ceiling:
// 256 * ~30KB prompts ≈ 7.5 MB. Acceptable.

use once_cell::sync::Lazy;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

/// FIFO eviction cap — matches CONVERSATION_STATES_CAP in loop_engine.rs.
pub const SYSTEM_PROMPT_CACHE_CAP: usize = 256;

/// Process-global per-session prompt cache, keyed by `session_id`.
static SYSTEM_PROMPT_CACHE: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// FIFO insertion order — older entries get evicted on overflow.
static SYSTEM_PROMPT_CACHE_ORDER: Lazy<Mutex<VecDeque<String>>> =
    Lazy::new(|| Mutex::new(VecDeque::new()));

/// Atomic hit counter — `Ordering::Relaxed` because the value is a telemetry
/// snapshot, not a synchronization signal.
static CACHE_HIT_COUNT: AtomicU64 = AtomicU64::new(0);
static CACHE_MISS_COUNT: AtomicU64 = AtomicU64::new(0);

/// Fetch a cached prompt for the given session_id. Returns `None` when not
/// cached OR when the mutex is poisoned (defensive — caller falls through to
/// rebuild path). Does NOT increment counters — that is the wrapper's job
/// (Plan 03 wraps build_system_prompt_for_model and decides hit vs miss).
pub fn get_cached(session_id: &str) -> Option<String> {
    if session_id.is_empty() {
        return None;
    }
    match SYSTEM_PROMPT_CACHE.lock() {
        Ok(map) => map.get(session_id).cloned(),
        Err(e) => {
            eprintln!(
                "[Phase83] SYSTEM_PROMPT_CACHE poisoned on get: {}; treating as miss",
                e
            );
            None
        }
    }
}

/// Insert a prompt into the cache. Empty session_id is a no-op (matches
/// `save_conversation_state` semantics — no SessionWriter = nothing to key on).
/// Maintains FIFO eviction at `SYSTEM_PROMPT_CACHE_CAP`.
pub fn set_cached(session_id: &str, prompt: String) {
    if session_id.is_empty() {
        return;
    }
    let mut map = match SYSTEM_PROMPT_CACHE.lock() {
        Ok(m) => m,
        Err(e) => {
            eprintln!(
                "[Phase83] SYSTEM_PROMPT_CACHE poisoned on set: {}; dropping write for {}",
                e, session_id
            );
            return;
        }
    };
    let mut order = match SYSTEM_PROMPT_CACHE_ORDER.lock() {
        Ok(o) => o,
        Err(e) => {
            eprintln!(
                "[Phase83] SYSTEM_PROMPT_CACHE_ORDER poisoned on set: {}; write applied but eviction skipped",
                e
            );
            map.insert(session_id.to_string(), prompt);
            return;
        }
    };
    let is_new = !map.contains_key(session_id);
    map.insert(session_id.to_string(), prompt);
    if is_new {
        order.push_back(session_id.to_string());
        while map.len() > SYSTEM_PROMPT_CACHE_CAP {
            if let Some(oldest) = order.pop_front() {
                map.remove(&oldest);
            } else {
                break;
            }
        }
    }
}

/// Drop the cached prompt for a specific session. Used by
/// `brain::invalidate_system_prompt` (Plan 03 / D-11).
pub fn clear_cached(session_id: &str) {
    if let Ok(mut map) = SYSTEM_PROMPT_CACHE.lock() {
        map.remove(session_id);
    }
    if let Ok(mut order) = SYSTEM_PROMPT_CACHE_ORDER.lock() {
        order.retain(|id| id != session_id);
    }
}

/// Drop ALL cached prompts. Used by tests + future "Reset all" UI paths.
#[allow(dead_code)]
pub fn clear_all_cached() {
    if let Ok(mut map) = SYSTEM_PROMPT_CACHE.lock() {
        map.clear();
    }
    if let Ok(mut order) = SYSTEM_PROMPT_CACHE_ORDER.lock() {
        order.clear();
    }
}

/// Telemetry counter accessors (D-02).
pub fn cache_hit_count() -> u64 {
    CACHE_HIT_COUNT.load(Ordering::Relaxed)
}
pub fn cache_miss_count() -> u64 {
    CACHE_MISS_COUNT.load(Ordering::Relaxed)
}
pub fn cache_stats() -> (u64, u64) {
    (cache_hit_count(), cache_miss_count())
}

/// Internal increment hooks — only callers inside this crate (Plan 03's
/// `build_system_prompt_for_model` wrapper) should bump these.
pub(crate) fn increment_hit_count() {
    CACHE_HIT_COUNT.fetch_add(1, Ordering::Relaxed);
}
pub(crate) fn increment_miss_count() {
    CACHE_MISS_COUNT.fetch_add(1, Ordering::Relaxed);
}

/// Test-only: zero out both counters. Plans 03/04 tests use this to assert
/// counter deltas without cross-test contamination.
#[cfg(test)]
pub fn reset_counters_for_test() {
    CACHE_HIT_COUNT.store(0, Ordering::Relaxed);
    CACHE_MISS_COUNT.store(0, Ordering::Relaxed);
}
