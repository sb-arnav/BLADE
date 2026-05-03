---
phase: 30-organism-eval
reviewed: 2026-05-03T12:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src-tauri/src/evals/organism_eval.rs
  - src-tauri/src/homeostasis.rs
  - src-tauri/src/evals/mod.rs
  - scripts/verify-organism.sh
  - package.json
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-05-03T12:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

The Phase 30 organism eval introduces 13 deterministic integration test fixtures covering vitality timeline, hormone-behavior integration, persona stability, and safety bundle cross-checks. The test harness is well-structured with proper isolation (temp DB, dormancy stubs, `--test-threads=1`). The `homeostasis.rs` module is mature and well-organized.

Three warnings relate to: (1) `std::env::set_var` usage in a test context that relies solely on `--test-threads=1` for safety, (2) a byte/char threshold inconsistency in the emotion classifier, and (3) potential mutex poisoning in `hypothalamus_tick`. Three info items flag dead code, an unused variable assignment, and a minor redundancy.

## Warnings

### WR-01: `std::env::set_var` in test relies solely on `--test-threads=1` for safety

**File:** `src-tauri/src/evals/organism_eval.rs:598`
**Issue:** `std::env::set_var("BLADE_CONFIG_DIR", ...)` mutates global process state. The test header correctly mandates `--test-threads=1`, but if another test module or CI runner invokes this test without that flag, or if another thread (e.g., from a previous `OnceLock` initialization) reads `BLADE_CONFIG_DIR` concurrently, the behavior is undefined. In Rust edition 2024 this call becomes `unsafe`. Even in 2021, POSIX `setenv` is not thread-safe.
**Fix:** Use a constructor-injected path or a `thread_local!` / `OnceCell` test-configuration pattern instead. Alternatively, wrap the call in an `unsafe` block with a comment explaining the `--test-threads=1` invariant to make the reliance explicit:
```rust
// SAFETY: organism_eval requires --test-threads=1 (global state sharing).
// This set_var is only safe because no other threads are running.
unsafe { std::env::set_var("BLADE_CONFIG_DIR", temp_dir.to_str().unwrap_or("/tmp/blade_organism_eval")); }
```
This at minimum documents the constraint; ideally the path would be passed via a test-scoped config.

### WR-02: Mixed byte-length and char-length threshold in `classify_response_emotion`

**File:** `src-tauri/src/homeostasis.rs:340-341`
**Issue:** The guard at line 337 correctly uses `.chars().count() < 50` (char-based). However line 340 checks `text.len() > 2000` (byte-based) to decide whether to truncate, then slices by character index at 2000. For ASCII text these are equivalent, but for multibyte UTF-8 content, a text with 1800 characters but 3000 bytes would enter the truncation branch yet `nth(2000)` would return `None`, causing it to fall back to `text.len()` (full text). This defeats the performance-bounding intent -- the full text is still lowercased and scanned.
**Fix:** Use char count consistently:
```rust
let char_count = text.chars().count();
if char_count < 50 { return None; }

let classify_text = if char_count > 2000 {
    let end_byte = text.char_indices().nth(2000).map(|(i, _)| i).unwrap_or(text.len());
    &text[..end_byte]
} else {
    text
};
```

### WR-03: `hypothalamus_tick` unwraps poisoned mutex with `unwrap_or_else(|e| e.into_inner())`

**File:** `src-tauri/src/homeostasis.rs:489`
**Issue:** `hormone_store().lock().unwrap_or_else(|e| e.into_inner()).clone()` silently recovers from a poisoned mutex. While this is a deliberate pattern to prevent cascading panics, it means that if a prior thread panicked mid-update, the HormoneState may be in a partially-written (inconsistent) state. The controller then overwrites it entirely (which mitigates data corruption), but the intermediate `.clone()` snapshot is used for the audit diff at line 752, potentially logging garbage values.
**Fix:** Log when recovering from a poisoned mutex so the condition is observable:
```rust
let state = match hormone_store().lock() {
    Ok(guard) => guard.clone(),
    Err(poisoned) => {
        eprintln!("[homeostasis] WARNING: mutex was poisoned, recovering");
        poisoned.into_inner().clone()
    }
};
```

## Info

### IN-01: Unused `l2_distance` function could be dead code outside OEVAL-03

**File:** `src-tauri/src/evals/organism_eval.rs:242-247`
**Issue:** `l2_distance` is a helper used only in `fixture_persona_stability`. It is defined at module scope but has no `#[allow(dead_code)]` annotation. This compiles fine under `#[cfg(test)]` because the module is test-only, but if the module were ever extracted or reused, the function would trigger warnings.
**Fix:** No action needed -- this is informational. The function is correctly scoped within a `#[cfg(test)]` module.

### IN-02: `total_days_observed` assigned twice (once as `0u32`, then overwritten)

**File:** `src-tauri/src/homeostasis.rs:966,999`
**Issue:** `let mut total_days_observed = 0u32;` at line 966 is immediately overwritten at line 999 with `total_days_observed = days_seen.len() as u32;`. The initial `0u32` is never read in the success path.
**Fix:** Remove the `mut` declaration and declare at line 999 instead:
```rust
let total_days_observed = days_seen.len() as u32;
```

### IN-03: `verify:organism` not included in a phased test script

**File:** `package.json:48`
**Issue:** `verify:organism` is included in `verify:all` (line 48) which is correct. However, unlike other phase-specific evals (safety, hormone, inference, vitality), there is no `test:e2e:phase30` script. This is purely informational -- organism eval is a Rust-only test with no E2E component, so an E2E script would be inappropriate.
**Fix:** No action needed. Documented for completeness.

---

_Reviewed: 2026-05-03T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
