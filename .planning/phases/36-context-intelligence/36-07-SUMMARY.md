---
phase: 36-context-intelligence
plan: 7
subsystem: intelligence/anchor-parser + commands/prelude
tags: [intelligence, anchor-parser, regex, word-boundary, catch-unwind, intel-06, ctx-07-discipline, force-panic-seam]
status: complete
dependency_graph:
  requires:
    - "Phase 36-01 IntelligenceConfig.context_anchor_enabled = true (default)"
    - "Phase 36-01 anchor_parser.rs scaffold stub"
    - "regex 1 + once_cell 1 (already in Cargo.toml)"
    - "tempfile 3 dev-dep (already present from Plan 36-05/06)"
    - "embeddings::smart_context_recall (existing public memory-retrieval helper)"
    - "screen_timeline::timeline_browse (most-recent-frame description accessor)"
  provides:
    - "intelligence::Anchor enum (Screen | File { path } | Memory { topic }) with serde tag/lowercase rename"
    - "intelligence::extract_anchors(query: &str) -> (String, Vec<Anchor>) — three regex passes, dedup-by-(type,payload), \\B word-boundary discipline"
    - "intelligence::resolve_anchors(&[Anchor], &AppHandle, &BladeConfig) async -> Vec<(label, content)>"
    - "INTEL_FORCE_ANCHOR_PANIC thread_local seam (runtime-available, not cfg(test)-only) — Plan 36-09 will exercise the catch_unwind fall-through"
    - "commands.rs::send_message_stream_inline anchor extraction prelude behind config.intelligence.context_anchor_enabled toggle"
    - "Anchored content appended OUTSIDE Phase 32 selective gating (anchor = explicit user ask)"
  affects:
    - "src-tauri/src/intelligence/anchor_parser.rs (stub → +414 LOC body + 19 tests)"
    - "src-tauri/src/intelligence/mod.rs (+1 re-export line)"
    - "src-tauri/src/commands.rs (+59 LOC: prelude block at line ~1263 + system_prompt anchor injection at line ~1382)"
tech_stack:
  used:
    - "regex 1 (NFA / RE2-style — no catastrophic backtracking by construction)"
    - "once_cell 1 (Lazy<Regex> static patterns)"
    - "std::cell::Cell + thread_local! (test seam, mirrors Phase 33-04 / 34-04 / 35-04)"
    - "std::panic::catch_unwind + AssertUnwindSafe (CTX-07 v1.1 discipline)"
    - "std::fs::read + null-byte heuristic (binary detection in first 8 KB)"
    - "tempfile 3 (resolve_file_caps + binary reject tests)"
  patterns:
    - "\\B word-boundary discipline at pattern start — `\\B@screen\\b` matches free-floating @ but NOT embedded-in-word @ (e.g. `arnav@pollpe.in` correctly rejected). Locked by phase36_intel_06_email_address_does_not_match_screen + phase36_intel_06_at_screen_in_word_does_not_match regression tests."
    - "Strip-and-replace algorithm: each match's range replaced with single space; final cleanup via `split_whitespace().join(' ').trim()` collapses the gaps."
    - "Dedup via HashSet<(type_label, payload)> — multiple same-type anchors collapse to one each."
    - "Three sequential passes (Screen → File → Memory) instead of single-regex alternation; simpler control flow, no precedence ambiguity."
    - "Resolve-best-effort: per-anchor failure produces `[ANCHOR:... not found / read error / rejected: binary]` placeholder so the assistant still sees what was asked."
    - "CTX-07 v1.1 catch_unwind at the call site (commands.rs); INTEL_FORCE_ANCHOR_PANIC seam locks the fall-through. Mirrors three prior phases (33-04 LANE_FORCE_PANIC, 34-04 SESSION_FORCE_PANIC, 35-04 RES_FORCE_PROVIDER_ERROR)."
key_files:
  modified:
    - "src-tauri/src/intelligence/anchor_parser.rs (+414 LOC over the 3-line stub)"
    - "src-tauri/src/intelligence/mod.rs (+1 LOC re-export)"
    - "src-tauri/src/commands.rs (+59 LOC: prelude + system_prompt injection)"
decisions:
  - "memory::query_memories does NOT exist in the runtime tree — the plan body referenced it as a target, but `grep -rn 'fn query_memories'` returns nothing. Routed Anchor::Memory resolution to `embeddings::smart_context_recall(topic)` instead, which is the closest existing public memory-retrieval helper (returns a String, sync, hits vector_entries + kg_nodes + brain_preferences). Behavior: best-effort recall; empty result yields `[ANCHOR:@memory:{topic}]\\n[no relevant memory hits]`. Plan 36-08 or 36-09 can introduce a typed `MemoryFact`-shaped wrapper if needed; for 36-07 the smart_context_recall path is sufficient and uses a known-good pipeline."
  - "current_ocr_text accessor stubbed via `screen_timeline::timeline_browse(None, 0, 1)` returning the most recent frame's `description` field. screen_timeline already runs the vision-model description pipeline per frame and persists it to SQLite, so reading the newest entry is a clean, non-blocking proxy for `[ANCHOR:@screen]` content. Empty timeline (first-run, telemetry off) yields the literal `[ANCHOR:@screen]\\n[no recent screenshot description available]` placeholder. No new screenshot is captured during anchor resolution — the resolver is read-only against the existing timeline."
  - "INTEL_FORCE_ANCHOR_PANIC declared at module scope (NOT cfg(test)-gated) so Plan 36-09 can wire the panic-injection regression at the commands.rs integration site without a fresh #[cfg(test)] hop. This matches the seam shape used by Plan 33-04 / 34-04 / 35-04."
  - "brain.rs::build_system_prompt_for_model signature was NOT modified. Anchored content is appended to `system_prompt` AFTER the brain.rs builder returns, in commands.rs itself. Rationale: the must_haves call out 'Anchored content bypasses Phase 32 selective gating (record_section labels: anchor_screen / anchor_file / anchor_memory)' — but Plan 36-08 owns the brain.rs receiver that records those labels via record_section. For 36-07 the prelude wires the commands.rs side; the brain.rs receiver is the 36-08 follow-up. The current 36-07 implementation has the anchored content reaching the model (concatenated into system_prompt outside the gated sections) — Plan 36-08 will route the same anchor_injections argument through brain.rs proper for telemetry parity."
  - "last_user_text is shadowed with the cleaned (anchor-stripped) query immediately after the prelude. All downstream consumers (intent_router::classify_intent, smart_context, brain prompt builder, vector_store auto_embed_exchange, native_tools::suggest_tools_for_query, fast-ack message builder) see the cleaned text. Anchor tokens never leak into ack messages, embeddings, ProposalReply matching, or the LLM payload as raw @ syntax."
  - "Path traversal (`@file:../../etc/passwd`) and absolute paths (`@file:/etc/passwd`) are CAPTURED at the parser layer per the threat model's accept disposition (T-36-39, T-36-44 — local-first product, user owns the filesystem). Tests `phase36_intel_06_extract_anchors_rejects_path_traversal` and `phase36_intel_06_extract_anchors_rejects_absolute_path` lock the capture-and-pass-through behavior; resolve_file refuses with `[ANCHOR:@file:{path} not found]` if the file doesn't exist or `[ANCHOR:@file:{path} rejected: binary]` if the null-byte heuristic trips."
  - "200_000-byte cap is enforced AFTER the std::fs::read returns the full payload — std::fs::read allocates the whole content into memory then we slice the first 200k. T-36-40 marks this as a known-but-accepted DoS surface for v1; for 10GB+ files this would OOM. Mitigation deferred to v1.6+ if observed in eval. Safer alternative: `std::io::Read::take(200_000)` chunked read; not adopted in 36-07 to keep the contract simple — files this large in @file: are operator error and Rule 1 territory at that point."
  - "First test run found phase36_intel_06_resolve_file_caps_at_200kb off-by-one: the original test counted `x` chars in the body but the tempfile filename `big.txt` includes an `x`, producing 200_001 chars. Fixed by switching the payload to `q` repeats and the filename to `payload.dat` so the count is unambiguous (Rule 1 bug, fixed inline)."
metrics:
  duration_minutes: 35
  tasks_completed: 2
  files_created: 0
  files_modified: 3
  commits: 2
  tests_added: 19
  tests_pass: "19/19 anchor_parser tests green; cargo check clean"
  cargo_check_errors: 0
  cargo_check_warnings: "29 (all pre-existing; none introduced by 36-07)"
  static_gates:
    cargo_check: pass
    cargo_test_anchor_parser: pass
    grep_extract_anchors_in_commands_rs: 2_matches
runtime_uat:
  status: deferred-to-36-09
  rationale: "Plan 36-07 is pure-Rust pipeline wiring with no UI surface. Plan 36-08 lands the frontend AnchorChip + brain.rs receiver. Plan 36-09 owns the runtime UAT (operator types `look at @screen and explain @file:Cargo.toml`, observes anchored content in the assistant's reply) plus the panic-injection regression. UAT for 36-07 in isolation would only re-run the unit tests that already locked in this commit pair."
deferred_items:
  - "Plan 36-08: brain.rs receiver — accept `anchor_injections: &[(String, String)]` param OR consume from a session-state field; route each entry through record_section with the locked `anchor_screen` / `anchor_file` / `anchor_memory` labels (telemetry parity with the rest of Phase 32 gated sections)."
  - "Plan 36-08: Frontend AnchorChip rendering — chat input parses @screen / @file: / @memory: as user types and renders inline chips with delete affordance."
  - "Plan 36-09: INTEL_FORCE_ANCHOR_PANIC integration regression at commands.rs — flips the seam, sends a real chat request, asserts the catch_unwind fall-through fires and the assistant still receives the un-stripped query (no crash)."
  - "Plan 36-09: Runtime UAT (dev server up, operator-typed query with all three anchor types, screenshot evidence of anchored content reaching the assistant)."
  - "T-36-40 hardening (chunked-read 200k cap via Read::take) — accept-for-v1, revisit if eval surfaces 1GB+ @file: usage."
linked_plans:
  - "36-08-PLAN.md: brain.rs receiver + frontend AnchorChip"
  - "36-09-PLAN.md: panic-injection regression + UAT"
---

# Phase 36 Plan 36-07: INTEL-06 Anchor Parser + commands.rs Prelude Summary

## One-liner

`@screen` / `@file:PATH` / `@memory:TOPIC` regex extraction with `\B` word-boundary discipline (correctly distinguishes anchored `@` from email-shape `@`), per-anchor resolution to OCR / fs / memory, and a CTX-07-disciplined catch_unwind prelude in `send_message_stream_inline` behind `context_anchor_enabled`.

## What landed

### Task 1 — anchor_parser.rs body + 19 tests (commit `480f562`)

`src-tauri/src/intelligence/anchor_parser.rs`:
- `Anchor` enum: `Screen | File { path: String } | Memory { topic: String }` with `#[serde(tag = "type", rename_all = "lowercase")]`.
- Three `Lazy<Regex>` patterns: `\B@screen\b`, `\B@file:([^\s]+)`, `\B@memory:([^\s]+)`.
- `extract_anchors(query: &str) -> (String, Vec<Anchor>)`:
  - Three sequential `loop { find / captures } → replace_range(.., " ")` passes (Screen → File → Memory).
  - Dedup via `HashSet<(type_label, payload)>`.
  - Final cleanup: `working.split_whitespace().join(" ").trim()`.
- `resolve_anchors(anchors, app, config) -> Vec<(label, content)>` async:
  - `Anchor::Screen` → `current_ocr_text()` → `screen_timeline::timeline_browse(None, 0, 1)[0].description` → `[ANCHOR:@screen]\n{ocr}` (capped at 8000 chars via `safe_slice`); empty timeline yields placeholder.
  - `Anchor::File { path }` → `resolve_file(path)` → exists check → `std::fs::read` → null-byte heuristic in first 8 KB → 200_000-byte cap with `[truncated from N bytes]` suffix.
  - `Anchor::Memory { topic }` → `embeddings::smart_context_recall(topic)` → `[ANCHOR:@memory:{topic}]\n{recall}` (capped at 4000 chars); empty recall yields placeholder.
- `INTEL_FORCE_ANCHOR_PANIC` thread_local Cell<bool> at module scope (runtime-available).
- `pub fn resolve_file_for_test(path: &str) -> String` — sync test wrapper for the 200k-cap test.
- 19 unit tests, all `phase36_intel_06_*` namespaced:
  - `extract_anchors_screen_file_memory` — all 3 types in one query.
  - `anchor_parser_strips_screen` / `_strips_file_with_path` / `_strips_memory_with_topic`.
  - `extract_anchors_no_match_returns_empty`.
  - `email_address_does_not_match_screen` (locked regression for the `\B` discipline).
  - `at_screen_in_word_does_not_match` (`abc@screen` rejected).
  - `strip_anchors_removes_tokens` (multi-type strip).
  - `extract_anchors_rejects_path_traversal` + `_rejects_absolute_path` (capture-and-pass-through per threat model accept disposition).
  - `extract_anchors_no_catastrophic_backtracking` (50k-char input bounded < 1s).
  - `anchor_parser_dedups_repeats` (Screen / File:foo / Memory:x each collapse to one).
  - `anchor_parser_fuzz_malformed_inputs_dont_crash` (~100 cases — enumerated edge cases + 80 random alphanumeric).
  - `force_anchor_panic_seam` (seam fires; `catch_unwind` returns `Err`).
  - `resolve_panic_safe_falls_through` (mirrors the commands.rs prelude — seam + AssertUnwindSafe + fall-through to original query).
  - `resolve_file_caps_at_200kb` (300k-byte payload truncates to exactly 200k payload chars + truncation suffix).
  - `resolve_file_rejects_binary` (null-byte content → `rejected: binary`).
  - `resolve_file_handles_missing` (nonexistent path → `not found`).
  - `smart_off_treats_at_syntax_as_plain_text` (parser-level shape relied on by commands.rs `context_anchor_enabled = false` branch).

### Task 2 — commands.rs prelude (commit `f2161af`)

`src-tauri/src/commands.rs::send_message_stream_inline`:
- Insertion point: line ~1263, immediately after `let last_user_text = sanitize_input(&last_user_text);` and BEFORE the Plan 34-08 SESS-01 `UserMessage` JSONL emit. This ordering is intentional — the JSONL log records the cleaned (anchor-stripped) text so session replay sees what the model actually saw, not the raw `@screen` syntax.
- Prelude logic:

  ```rust
  let (clean_query, anchors) = if config.intelligence.context_anchor_enabled {
      std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          crate::intelligence::anchor_parser::extract_anchors(&last_user_text)
      })).unwrap_or_else(|_| {
          log::warn!("[INTEL-06] anchor parser panicked; treating query as plain text");
          (last_user_text.clone(), Vec::new())
      })
  } else {
      (last_user_text.clone(), Vec::new())
  };
  let last_user_text = clean_query;  // shadow
  let anchor_injections: Vec<(String, String)> = if !anchors.is_empty() {
      crate::intelligence::anchor_parser::resolve_anchors(&anchors, &app, &config).await
  } else {
      Vec::new()
  };
  ```

- Anchored content injected into `system_prompt` at line ~1391 (post `brain::build_system_prompt_for_model`):

  ```rust
  if !anchor_injections.is_empty() {
      system_prompt.push_str("\n\n");
      for (_label, content) in &anchor_injections {
          system_prompt.push_str(content);
          system_prompt.push('\n');
      }
  }
  ```

- The label is dropped at this 36-07 layer; Plan 36-08's brain.rs receiver will route the same `anchor_injections` slice through `record_section("anchor_screen" | "anchor_file" | "anchor_memory", content.len())` for telemetry parity with the rest of Phase 32 gated sections. For 36-07 the content reaches the provider correctly; the gating-bypass behavior is achieved by appending OUTSIDE the gated sections.

## Static gate evidence

```
$ cargo check
warning: `blade` (lib) generated 29 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2m 36s
[exit 0]

$ cargo test --lib intelligence::anchor_parser::tests
running 19 tests
test intelligence::anchor_parser::tests::phase36_intel_06_anchor_parser_strips_memory_with_topic ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_anchor_parser_strips_screen ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_anchor_parser_strips_file_with_path ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_anchor_parser_dedups_repeats ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_email_address_does_not_match_screen ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_anchor_parser_fuzz_malformed_inputs_dont_crash ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_at_screen_in_word_does_not_match ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_extract_anchors_rejects_absolute_path ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_extract_anchors_no_match_returns_empty ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_force_anchor_panic_seam ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_extract_anchors_screen_file_memory ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_extract_anchors_no_catastrophic_backtracking ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_extract_anchors_rejects_path_traversal ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_resolve_panic_safe_falls_through ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_resolve_file_handles_missing ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_smart_off_treats_at_syntax_as_plain_text ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_strip_anchors_removes_tokens ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_resolve_file_rejects_binary ... ok
test intelligence::anchor_parser::tests::phase36_intel_06_resolve_file_caps_at_200kb ... ok

test result: ok. 19 passed; 0 failed; 0 ignored; 0 measured; 776 filtered out

$ grep -c "extract_anchors\|anchor_parser" src-tauri/src/commands.rs
2
```

## Deviations from Plan

### Rule 1 — Bug: 200kb cap test off-by-one

- **Found during:** Task 1 verification.
- **Issue:** First test run produced `truncated content must cap at 200k chars (got 200001)` — the test counted `x` chars in the resolved body, but the tempfile filename `big.txt` contained an `x` character, leaking 1 extra count from the `[ANCHOR:@file:{path}]` header.
- **Fix:** Renamed the payload character from `x` to `q` and the filename from `big.txt` to `payload.dat` so the count is unambiguous. Tightened the assertion to `assert_eq!(q_count, 200_000, ...)`.
- **Files modified:** `src-tauri/src/intelligence/anchor_parser.rs` (test only; production resolve_file unchanged).
- **Commit:** Folded into `480f562` (single Task 1 commit).

### Rule 2 — Auto-add: memory.rs::query_memories not present

- **Found during:** Task 1 read-first.
- **Issue:** Plan body referenced `crate::memory::query_memories(app, topic, 5).await` as the resolution target for `Anchor::Memory`. `grep -rn 'fn query_memories' src-tauri/src/` returned nothing — the function does not exist in the runtime tree. memory.rs's public surface is `update_human_block / update_conversation_block / extract_conversation_facts / weekly_memory_consolidation` — block-style writes, not topic-keyed reads.
- **Fix:** Routed `Anchor::Memory` resolution to the closest existing public retrieval helper: `embeddings::smart_context_recall(topic)` (sync, returns `String`, hits vector_entries + kg_nodes + brain_preferences with semantic-score thresholding). Behavior is morally equivalent: topic-keyed retrieval, top-N hits formatted for prompt injection. The `[ANCHOR:@memory:{topic}]\n{recall}` envelope with `safe_slice(.., 4000)` matches the locked content shape.
- **Documented as decision** above; no test impact.

### Rule 2 — Auto-add: current_ocr_text accessor not present

- **Found during:** Task 1 read-first.
- **Issue:** Plan body referenced `crate::screen_timeline::current_ocr_text(app).await` and `crate::clipboard::current_screen_text(app).await` — neither exists in screen_timeline.rs's public surface (`describe_screenshot_public`, `capture_timeline_tick`, `start_timeline_capture_loop`, `cleanup_old_screenshots`, `timeline_browse`, `timeline_get_entry`, `timeline_get_stats`, `timeline_search`).
- **Fix:** Implemented `current_ocr_text()` as a sync helper inside anchor_parser.rs that calls `screen_timeline::timeline_browse(None, 0, 1)` and returns the most recent entry's `description` field (which is already populated by the vision-model description pipeline). Empty timeline produces `None` → resolve_anchors emits the `[ANCHOR:@screen]\n[no recent screenshot description available]` placeholder.
- **Documented as decision** above; non-empty timeline is exercised in production but cannot be unit-tested without a populated SQLite fixture.

### Out-of-scope items NOT addressed (deferred per scope boundary)

- brain.rs `record_section("anchor_*", ...)` receiver — Plan 36-08 owns this.
- Frontend AnchorChip — Plan 36-08.
- Runtime UAT + panic-injection regression — Plan 36-09.

## Self-Check: PASSED

```
$ [ -f /home/arnav/blade/src-tauri/src/intelligence/anchor_parser.rs ] && echo FOUND
FOUND
$ [ -f /home/arnav/blade/src-tauri/src/intelligence/mod.rs ] && echo FOUND
FOUND
$ git log --oneline | grep -E "480f562|f2161af"
480f562 feat(36-07): fill anchor_parser body with regex extraction + resolve + 19 tests (INTEL-06)
f2161af feat(36-07): wire anchor extraction prelude into send_message_stream_inline (INTEL-06)
```

All claimed files present; both commit hashes resolve.
