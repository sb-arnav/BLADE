---
phase: 36-context-intelligence
reviewed: 2026-05-07T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - src-tauri/src/config.rs
  - src-tauri/src/intelligence/mod.rs
  - src-tauri/src/intelligence/tree_sitter_parser.rs
  - src-tauri/src/intelligence/symbol_graph.rs
  - src-tauri/src/intelligence/pagerank.rs
  - src-tauri/src/intelligence/repo_map.rs
  - src-tauri/src/intelligence/capability_registry.rs
  - src-tauri/src/intelligence/anchor_parser.rs
  - src-tauri/canonical_models.json
  - src-tauri/src/router.rs
  - src-tauri/src/brain.rs
  - src-tauri/src/commands.rs
  - src-tauri/src/lib.rs
  - src/lib/tauri/intelligence.ts
  - src/features/chat/AnchorChip.tsx
  - src/features/chat/MessageBubble.tsx
findings:
  blocker: 1
  high: 4
  medium: 5
  low: 4
  total: 14
status: issues_found
---

# Phase 36: Code Review Report

**Reviewed:** 2026-05-07
**Depth:** deep
**Files Reviewed:** 14
**Status:** issues_found (1 BLOCKER + 4 HIGH + 5 MEDIUM + 4 LOW)

## Summary

Phase 36 ships substantial new context-intelligence infrastructure (tree-sitter symbol graph, personalized PageRank, repo-map injection, canonical capability registry, @-anchor extraction). The catch_unwind discipline is consistently applied, the FORCE seams mirror the established Phase 32-35 fault-injection pattern, and the unit-test surface is genuinely exhaustive (125+ tests across the new modules). PageRank determinism, regex `\B` discipline, and registry fallback shapes are all locked by tests.

The single BLOCKER is an exfiltration vector through the anchor parser: `@file:` resolves arbitrary paths (including `~/.ssh/id_rsa`, `/etc/passwd`, `/proc/self/environ`) into the system prompt, which is then sent to the upstream LLM provider. The parser is documented as "local-first → path traversal accepted," but local-first is exactly what makes the leak path bidirectional — text the user pastes in (a malicious meeting transcript, a shared link, a clipboard payload) can cause silent exfil to a remote LLM. The four HIGH items are: anchor budget unbounded (multi-MB injections are possible), `init()` never wired into `lib.rs` (registry/probe drift never surfaces), `escape_like` produces SQL patterns SQLite cannot interpret without an `ESCAPE` clause (idempotent re-index leaves stale rows), and `default_model_for("gemini")` returns `gemini-2.0-flash-exp` which has no registry entry (silent probe fallback for the default Gemini route).

## BLOCKER Issues

### BL-01: Anchor `@file:` resolves arbitrary local paths into prompt sent to remote LLM

**File:** `src-tauri/src/intelligence/anchor_parser.rs:178-206`
**Issue:** `resolve_file` accepts any path the regex captures — relative, absolute, parent-traversal. The 200KB content is then injected into `system_prompt` and shipped to the upstream provider. If a user pastes adversarial text (a malicious meeting transcript, a shared chat log, a clipboard payload from a phishing site) containing `@file:~/.ssh/id_rsa`, `@file:/etc/passwd`, `@file:.env`, or `@file:/proc/self/environ`, the file content silently leaves the local machine. The "binary heuristic" at line 216-223 does NOT block PEM-encoded private keys (PEM is text), `.env` files, plaintext password stores, or `/etc/shadow` (root-readable only on most systems but readable as user on macOS and some Linux configs). The `phase36_intel_06_extract_anchors_rejects_path_traversal` test asserts traversal IS captured by the parser — this is the test that should be inverted.

The threat model collapses because:
1. Anchors bypass Phase 32 selective gating (by design).
2. The user's `last_user_text` is stripped of anchor tokens BEFORE going to the model — so the user's chat history shows "what does say" instead of "what does @file:.env say". The user has no on-screen evidence the file was read.
3. `commands.rs:1287` runs `extract_anchors` on the sanitized `last_user_text`. `sanitize_input` does not strip `@file:` syntax (it can't — anchors need to survive into the parser).

**Fix:** Add a path policy enforced in `resolve_file` before `std::fs::read`:
```rust
fn resolve_file(path: &str) -> String {
    let p = std::path::PathBuf::from(path);
    // Reject absolute paths and parent traversal — anchored content leaves
    // the local boundary into the upstream provider's logs.
    if p.is_absolute() || path.contains("..") {
        return format!("[ANCHOR:@file:{path} rejected: absolute or parent-traversal path; resolve relative to project root]");
    }
    // Resolve under the active project root only (config.active_project_path
    // or cwd). Reject any resolved path that escapes the project boundary.
    let project_root = crate::config::active_project_root().unwrap_or_else(std::env::current_dir().unwrap_or_default());
    let resolved = match project_root.join(&p).canonicalize() {
        Ok(r) if r.starts_with(&project_root) => r,
        _ => return format!("[ANCHOR:@file:{path} rejected: outside project root]"),
    };
    // ... existing read / binary / truncate logic ...
}
```
And update `phase36_intel_06_extract_anchors_rejects_absolute_path` to assert the resolver returns the rejection placeholder (the parser still captures, but the resolver refuses). At minimum, surface a UAT confirmation in the chat UI before any absolute or `..`-bearing path is shipped to the provider.

---

## HIGH Issues

### HI-01: Anchor injections have no aggregate byte cap — multi-MB system prompts possible

**File:** `src-tauri/src/intelligence/anchor_parser.rs:190` + `src-tauri/src/brain.rs:791-797`
**Issue:** Each `@file:` resolves up to 200,000 bytes (line 190). The dedup map keys on `(type, path)` so distinct paths each contribute 200KB. There is no aggregate cap. A query like `@file:a.json @file:b.json @file:c.json @file:d.json @file:e.json` injects up to 1MB into `parts`. brain.rs's `enforce_budget` is `#[allow(dead_code)]` and never called (line 207, never invoked). `SYSTEM_PROMPT_CHAR_BUDGET = 150_000` is unenforced. Anthropic Sonnet 4 will accept it; Groq's 32k models will reject the request; the user sees a cryptic provider error.
**Fix:** Add an aggregate cap in `resolve_anchors`:
```rust
const ANCHOR_TOTAL_CAP: usize = 100_000; // bytes
let mut total = 0usize;
for a in anchors {
    let body = /* existing resolve logic */;
    if total + body.len() > ANCHOR_TOTAL_CAP {
        out.push((label, format!("[ANCHOR:@{anchor} truncated: aggregate cap {ANCHOR_TOTAL_CAP} bytes reached]")));
        break;
    }
    total += body.len();
    out.push((label, body));
}
```
Or wire `enforce_budget` and document anchors as "non-keep" so the budget enforcer can drop them under pressure.

### HI-02: `intelligence::init()` is never called from `lib.rs` — registry/probe drift never surfaces

**File:** `src-tauri/src/intelligence/mod.rs:39-51` + `src-tauri/src/lib.rs` (no call site)
**Issue:** The `init()` function seeds `canonical_models.json` to `blade_config_dir`, loads it, and runs `validate_against_probe` to log `[INTEL-04] registry/probe mismatch` warnings at startup. `lib.rs` registers the three Tauri commands but never calls `intelligence::init()` from the `setup` closure. The lazy `get_capabilities` call site does seed the file (via `ensure_registry_file`), but `validate_against_probe` is NEVER run unless explicitly invoked. The doc-comment promise at mod.rs:36-38 ("registry/capability_probe drifts surface as `[INTEL-04]` warnings at startup (non-halting)") is broken. Combined with the test `phase36_intel_04_capability_probe_parity` which only `eprintln!`s mismatches without failing, drift between the two sources is invisible in production.
**Fix:** Add to `lib.rs:setup` closure (alongside existing init calls):
```rust
crate::intelligence::init();
```
Place it after `provider_capabilities` are loaded so `infer_capabilities` has cached data to compare against.

### HI-03: `escape_like` is a no-op — SQL LIKE has no escape character without `ESCAPE` clause

**File:** `src-tauri/src/intelligence/symbol_graph.rs:103-112` + `src-tauri/src/intelligence/symbol_graph.rs:306-310`
**Issue:** `escape_like` produces `\%`, `\_`, `\\` patterns, but the surrounding SQL `... description LIKE ?1` does NOT declare `ESCAPE '\\'`. SQLite's default `LIKE` has NO escape character — the backslashes become literal characters in the pattern. Result: any `project_root` containing `_` (extremely common — `my_project`, `node_modules`, `src_tauri`) produces a LIKE pattern of `my\_project` which fails to match the actual stored payload `my_project`. Stale rows from deleted source files persist across reindex passes; `INSERT OR REPLACE` keyed on `concept` masks this for re-edited files but never cleans up rows for files that were *removed* from the project.
**Fix:**
```rust
// Either declare the escape:
"SELECT id FROM kg_nodes WHERE node_type = 'symbol' AND description LIKE ?1 ESCAPE '\\'"
// Or drop escape_like entirely — '_' and '%' in real filesystem paths are
// rare enough that the false-positive risk (matching extra rows) is
// strictly less harmful than the current false-negative (matching ZERO
// rows for any path with '_'). If kept, write a regression test that
// reindexes a project at /tmp/my_project and asserts a SUBSEQUENT
// reindex of the same path with one file removed leaves zero stale rows
// in kg_nodes.
```

### HI-04: `default_model_for("gemini")` returns `gemini-2.0-flash-exp`; registry has `gemini-2.0-flash` (no `-exp`)

**File:** `src-tauri/src/providers/mod.rs:369` + `src-tauri/canonical_models.json:144`
**Issue:** `router.rs:408` uses `default_model_for(prov)` to look up the model for capability filtering when no probe record exists. For Gemini, this returns `gemini-2.0-flash-exp`. The registry has `gemini-2.0-flash` (no suffix). `cap_for` calls `get_capabilities("gemini", "gemini-2.0-flash-exp", config)` which returns None (HashMap requires exact match), falling through to the probe path. `capability_probe::OVR_GEMINI` substring-matches `gemini-2.0-flash` against `gemini-2.0-flash-exp` and reports the right caps — so the runtime behavior is correct *via fallback* — but Plan 36-06's "registry-first" promise silently fails for the canonical Gemini default. Any registry-only feature (cost reporting, audio bit) misses for the most-used Gemini route.
**Fix:** Either rename the registry entry to `gemini-2.0-flash-exp` to match `default_model_for`, or change `default_model_for("gemini")` to `gemini-2.0-flash`. The latter is preferable since the `-exp` suffix on Gemini's preview SKU has been deprecated by Google. Add a regression test that pairs `default_model_for(prov)` with `get_capabilities(prov, default_model_for(prov), &cfg)` and asserts `is_some()` for every provider.

---

## MEDIUM Issues

### ME-01: `ensure_registry_file` race — concurrent first-boot can corrupt seed

**File:** `src-tauri/src/intelligence/capability_registry.rs:92-102`
**Issue:** `ensure_registry_file` checks `path.exists()` then writes if missing. If two threads call this simultaneously on first boot (e.g., `init()` from setup closure + lazy `get_capabilities` from a fast Tauri command race), both pass the existence check and both call `std::fs::write`. On most platforms `write` is atomic at the inode level, but on Windows simultaneous opens with default flags can produce truncated payloads or `ERROR_SHARING_VIOLATION`. The lazy callers fall back to `parse_bundled_then_lookup` so the runtime survives, but the user's on-disk override file may be a corrupted half-write that breaks subsequent `force_reload` calls.
**Fix:** Wrap the seed in an atomic write-and-rename:
```rust
let tmp = path.with_extension("tmp");
std::fs::write(&tmp, BUNDLED_REGISTRY)?;
std::fs::rename(&tmp, path)?;
```
Or guard with the existing `REGISTRY` mutex.

### ME-02: PageRank `RANK_CACHE` lock held across `clone()` of large vectors

**File:** `src-tauri/src/intelligence/pagerank.rs:120-126`
**Issue:** The cache hit path (`return vec.clone()` while holding the `Mutex` guard) clones up to 200 `(SymbolNode, f32)` tuples — each `SymbolNode` has 6 String fields. For a large workspace the clone is thousands of bytes, and the lock is held for the full duration. Concurrent rank requests serialize on this clone. Not a correctness bug (no deadlock since no awaits inside the lock), but under load the cache becomes a contention point. Phase 32-04 made the same mistake with `LAST_BREAKDOWN` (since fixed).
**Fix:** Drop the guard before cloning:
```rust
let cached = if let Ok(cache) = RANK_CACHE.lock() {
    cache.get(&key).filter(|(t, _)| t.elapsed() < Duration::from_secs(CACHE_TTL_SECONDS))
        .map(|(_, v)| v.clone())
} else { None };
if let Some(v) = cached { return v; }
```

### ME-03: PageRank cache key collision risk — empty mentions yield identical key across all queries

**File:** `src-tauri/src/intelligence/pagerank.rs:74-86`
**Issue:** `cache_key` consumes only `mentioned_symbols`; `_query` is unused. Two different user queries that happen to harvest zero mentions (e.g., "hi" and "hello there") share the same cache key and return the same PageRank vector. The `query` parameter is plumbed but ignored. This is partly intentional (the cache TTL is 5 min so the staleness window is bounded), but the `_query: &str` unused parameter is a code smell that signals the cache key is incomplete. If a future plan adds query-aware ranking (BM25 fusion), the cache will silently return wrong results.
**Fix:** Either remove `_query` from the signature (document that PageRank is purely mentions-driven and the cache key is correct as-is), or fold `query` into `cache_key`:
```rust
pub fn cache_key(query: &str, mentions: &[String]) -> String {
    // include sha256 of normalized query
}
```

### ME-04: `repo_map` byte-vs-char budget drift on non-ASCII symbol names

**File:** `src-tauri/src/intelligence/repo_map.rs:191-217`
**Issue:** `char_budget = (token_budget as usize) * 4` is treated as chars by the doc-comment, but the budget check at line 217 uses `out.len() + line.len()` (byte length). A symbol name with non-ASCII characters (e.g. CJK identifier `处理用户`, common in Chinese codebases the user might index) takes 12 bytes for 4 chars, so the budget is consumed 3× faster. The truncation marker reservation (`marker_reserve = 40`) is also bytes, not chars. For ASCII-only repos (the BLADE codebase itself) this is fine; for any internationalized codebase the repo map gets prematurely truncated.
**Fix:** Either pick char-counting consistently (`out.chars().count() + line.chars().count()`) or rename `char_budget` → `byte_budget` and update the doc to match. The chars/4 token approximation is an OpenAI heuristic for English text; document it as a byte-budget for clarity.

### ME-05: `ReindexStats` TS interface missing `files_skipped` field

**File:** `src/lib/tauri/intelligence.ts:137-144` vs `src-tauri/src/intelligence/symbol_graph.rs:60-68`
**Issue:** Rust `ReindexStats` has 6 fields: `files_walked`, `files_parsed`, `files_skipped`, `symbols_inserted`, `edges_inserted`, `elapsed_ms`. The TypeScript interface omits `files_skipped`. TypeScript will tolerate the extra field at runtime (excess properties are silently kept), but any frontend code reading `stats.files_skipped` to render a "skipped" counter gets `undefined` and TypeScript's compiler will not catch it. v1.1 lesson: type drift across the IPC boundary is exactly the class of bug the phase-32 verify gates were designed to catch.
**Fix:**
```typescript
export interface ReindexStats {
  files_walked: number;
  files_parsed: number;
  files_skipped: number;  // ADD
  symbols_inserted: number;
  edges_inserted: number;
  elapsed_ms: number;
}
```

---

## LOW Issues

### LO-01: `INTEL_FORCE_ANCHOR_PANIC` thread-local is exposed at runtime, not gated on `cfg(test)`

**File:** `src-tauri/src/intelligence/anchor_parser.rs:59-61`
**Issue:** Unlike `INTEL_FORCE_PARSE_ERROR` (tree_sitter_parser.rs, also runtime), `INTEL_FORCE_ANCHOR_PANIC` is intentionally non-test-gated per the doc-comment ("Plan 36-09 wires the panic-injection regression at the commands.rs integration site"). However, this exposes a public API in production binaries that, if accidentally `set(true)` from any code path, panics on every chat send. The doc-comment justifies exposure but the surface is wider than needed — `pub` makes it callable from any crate consumer (tests in other modules). Phase 33's `LOOP_OVERRIDE` and Phase 34's `RES_FORCE_STUCK` also live runtime, so this is consistent — but it means a future contributor who Cmd-clicks the symbol can `INTEL_FORCE_ANCHOR_PANIC.with(|c| c.set(true))` from anywhere.
**Fix:** Mark `pub(crate)` instead of `pub` if no external Tauri command needs it (none do). Or add a `debug_assertions` cfg gate so release builds elide the seam.

### LO-02: `validate_canonical_models` and `get_canonical_models` commands referenced in scope are not registered

**File:** `src-tauri/src/lib.rs:1490-1493`
**Issue:** The Phase 36 review prompt lists `validate_canonical_models` and `get_canonical_models` as registered Tauri commands. The actual `lib.rs` registers only `reindex_symbol_graph`, `reload_capability_registry`, and `get_active_model_capabilities`. The other two commands do not exist anywhere in the tree. Either the planning docs claim something that wasn't shipped, or the scope description is stale. SUMMARY 36-09 should be cross-checked.
**Fix:** Decide whether these commands are intentional dead-code (drop from plan) or missing implementation (add `#[tauri::command] pub async fn validate_canonical_models() -> Result<ValidationReport, String>` that wraps `validate_against_probe` and returns the mismatch list as a structured payload). Reconcile the SUMMARY with the actual lib.rs handler list.

### LO-03: `filetime` is a `[dependencies]` entry but only used in `#[cfg(test)]`

**File:** `src-tauri/Cargo.toml:86` + `src-tauri/src/intelligence/capability_registry.rs:319`
**Issue:** `filetime = "0.2"` is declared as a regular dependency, but the only use site is the `phase36_intel_04_mtime_refresh_picks_up_changes` test. Production builds carry the crate (and its `libc` transitive deps) for no reason. Minor but adds ~3KB to the release binary.
**Fix:** Move to `[dev-dependencies]` and ensure no other module uses it at runtime.

### LO-04: `repo_map.rs` ships dead-code dispatcher — Plan 36-03 PageRank exists but isn't called

**File:** `src-tauri/src/intelligence/repo_map.rs:245-266`
**Issue:** The doc-comment at lines 27-38 says the dispatcher should swap to `super::pagerank::rank_symbols(...)` once Plan 36-03 lands. Plan 36-03 DID land (commit `efe0b19`, see `pagerank.rs`), but `rank_symbols_or_fallback` still calls the degree-centrality fallback. The personalized PageRank (the headline feature of INTEL-02) is never invoked from the production code path — only the cold-start SQL approximation is. The brain.rs repo-map injection runs the cheap fallback; the expensive PageRank is only exercised by its own unit tests. This is a missing wire, not a logic bug — but it means INTEL-03's prompt-rendered "scores" are degree-centrality scores, not PageRank scores, and the runtime UAT plan-step that asserts "PageRank ranks call sites higher than leaf functions" will not reflect what users actually see in chat.
**Fix:** Replace lines 261-265 with the real call (the comment even tells you):
```rust
return super::pagerank::rank_symbols(_query, mentioned_symbols, _damping, conn);
```
Add a regression test that exercises `build_repo_map` and asserts the returned scores match `pagerank::rank_symbols` output (not the degree-centrality fallback's normalized degree values).

---

## Notes on items NOT flagged

- **`@screen` regex `\B@screen\b` start-of-string match** — verified equivalent semantics: at position 0, both sides are non-word, so `\B` succeeds and `@screen` at the very start of input matches. The dedup logic in `extract_anchors` collapses `@@screen` (matches the second `@`) into a single `Anchor::Screen`. Behavior is correct.
- **PageRank determinism** — locked by `phase36_intel_02_pagerank_deterministic` running 10 iterations and asserting byte-equal scores within 1e-4. SQL `ORDER BY` on both nodes and edges, deterministic petgraph index assignment, and `.then_with(|a, b| a.0.id.cmp(&b.0.id))` tiebreak all hold.
- **Cache invalidation on backdated entry** — locked by `phase36_intel_02_pagerank_cache_invalidates_after_5_min`.
- **`catch_unwind` discipline in `reindex_project`, `rank_symbols`, `build_repo_map`, `extract_anchors`** — all four critical entry points have correctly-shaped `AssertUnwindSafe` wrappers, and the corresponding panic-injection regression tests (Plan 36-09 Task 3 panic regressions) are in place.
- **Six-place rule for `IntelligenceConfig`** — verified: DiskConfig struct (config.rs:862), DiskConfig::default (line 948), BladeConfig struct (line 1125), BladeConfig::default (line 1197), load_config (line 1363), save_config (line 1444 + 2016). All six places present.
- **Anchor regex `\B` discipline against email** — locked by `phase36_intel_06_email_address_does_not_match_screen` and the explicit comment block at anchor_parser.rs:43-49.
- **No catastrophic backtracking on 50k-char input** — locked by `phase36_intel_06_extract_anchors_no_catastrophic_backtracking` (regex crate is RE2 by construction).

---

_Reviewed: 2026-05-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
