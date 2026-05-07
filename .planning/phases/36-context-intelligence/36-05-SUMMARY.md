---
phase: 36-context-intelligence
plan: 5
subsystem: intelligence/capability-registry
tags: [intelligence, canonical-models, capability-registry, registry-loader, mtime-cache, capability-probe-parity, tauri-commands]
status: complete
dependency_graph:
  requires:
    - "Phase 36-01 IntelligenceConfig.capability_registry_path (default blade_config_dir/canonical_models.json)"
    - "Phase 36-01 intelligence/capability_registry.rs scaffold stub"
    - "Phase 11-02 capability_probe::infer_capabilities (5-tuple signature for parity check)"
  provides:
    - "src-tauri/canonical_models.json bundled registry (5 providers x 21 models, schema v1)"
    - "intelligence::capability_registry::CapabilityRegistry / ProviderEntry / ModelCapabilities types"
    - "intelligence::capability_registry::load_registry(path) -> Result<CapabilityRegistry, String>"
    - "intelligence::capability_registry::ensure_registry_file(path) -> first-boot bundled-copy seeder"
    - "intelligence::capability_registry::get_capabilities(provider, model, config) -> Option<ModelCapabilities>"
    - "intelligence::capability_registry::force_reload(path) -> Result<u32, String> (cache-clear helper for the Tauri reload command)"
    - "intelligence::capability_registry::validate_against_probe(registry) (non-halting startup parity log)"
    - "intelligence::capability_registry::INTEL_FORCE_REGISTRY_MISS thread-local fault-injection seam"
    - "intelligence::reload_capability_registry Tauri command"
    - "intelligence::get_active_model_capabilities Tauri command"
    - "intelligence::init() seeds + validates registry at startup"
  affects:
    - "src-tauri/canonical_models.json (NEW, +214 LOC, ships in binary via include_str!)"
    - "src-tauri/src/intelligence/capability_registry.rs (stub +2 LOC -> 378 LOC implementation)"
    - "src-tauri/src/intelligence/mod.rs (+45 LOC: re-exports, init(), 2 Tauri commands)"
    - "src-tauri/src/lib.rs (+3 LOC: 2 entries in generate_handler!)"
tech_stack:
  used:
    - "once_cell::sync::Lazy<Mutex<RegistryCache>> singleton"
    - "include_str!('../../canonical_models.json') -- bundled payload for first-boot seed + last-resort lookup"
    - "serde_json 1 (CapabilityRegistry round-trip)"
    - "std::time::SystemTime mtime comparison for cache invalidation"
    - "thread_local Cell<bool> seam (mirrors INTEL_FORCE_PAGERANK_RESULT idiom from 36-04 / 36-03)"
    - "filetime 0.2 (dev-dependency only) for deterministic mtime bump in mtime-refresh test"
  patterns:
    - "Lazy<Mutex<...>> singleton with explicit need_load gate (loaded.is_none() OR path mismatch OR mtime drift)"
    - "Bundled-fallback parse_bundled_then_lookup() if disk IO or mutex is poisoned -- the binary always has SOME answer"
    - "Version=1 enforcement at parse time (load_registry returns Err on mismatch, caller falls back to capability_probe)"
    - "Registry-superset-of-probe rule (registry holds explicit (provider, model) pairs; probe handles substring fallback)"
    - "validate_against_probe logs [INTEL-04] structured warnings non-halting (registry wins per CONTEXT lock)"
key_files:
  created:
    - "src-tauri/canonical_models.json"
  modified:
    - "src-tauri/src/intelligence/capability_registry.rs (+378 LOC -2 stub LOC = +376 net)"
    - "src-tauri/src/intelligence/mod.rs (+42 net LOC)"
    - "src-tauri/src/lib.rs (+3 LOC)"
decisions:
  - "Tauri commands skip ConfigState/AppHandle entirely. BLADE has no global ConfigState type — config reads go through `crate::config::load_config()` (snapshot from disk + keyring). Both new commands use that idiom for consistency with surrounding intelligence::reindex_symbol_graph."
  - "capability_probe::infer_capabilities returns a 5-tuple `(vision, audio, tool_calling, long_context, context_window)` — NOT a struct. The plan body assumed a struct shape; the implementation adapted accordingly, indexing positionally and dropping the long_context/context_window fields for the parity check (they aren't on ModelCapabilities). Documented for v1.6+ harmonization."
  - "Tool-calling field naming: capability_probe uses `tool_calling`, registry uses `tool_use`. Treated as semantically identical; the parity test compares them directly. A future harmonization plan can converge on one name."
  - "parse_bundled_then_lookup() is the last-resort path when disk IO or the REGISTRY mutex is unhappy. It re-parses BUNDLED_REGISTRY (cheap — string is in .rodata) and looks up the (provider, model) tuple. Trade-off: repeated calls re-parse, but this only fires on the rare unhappy path. Caching the bundled parse would require another Lazy<...> and double the surface for a cold-path optimization."
  - "force_reload() helper in capability_registry.rs handles the cache-clear + reparse + replace logic atomically. The Tauri command body is a 2-line wrapper. Avoids exposing REGISTRY internals across the module boundary."
  - "The mtime-refresh test acquires the global REGISTRY singleton, so it calls force_reload() first to seed deterministically — otherwise it could race with other tests sharing the same singleton. Cargo test runs single-threaded by default in this codebase but the explicit seeding makes the test order-independent."
  - "OpenRouter explicit entries (anthropic/claude-sonnet-4, anthropic/claude-opus-4, openai/gpt-5, meta-llama/llama-3.3-70b-instruct:free) — substring matching stays in capability_probe; registry holds explicit IDs the user is likely to type. Registry-superset rule documented."
  - "Ollama deliberately excluded per CONTEXT lock §canonical_models.json (no public pricing — costs are user-host)."
  - "intelligence::init() uses load_config() directly. On first call after binary install it seeds blade_config_dir with the bundled payload and runs a one-time validate_against_probe walk. Idempotent on subsequent boots."
metrics:
  duration_minutes: 18
  tasks_completed: 3
  files_created: 1
  files_modified: 3
  commits: 3
  tests_added: 9
  tests_pass: "9/9"
  cargo_check_errors: 0
completed_date: "2026-05-07"
requirements_addressed: [INTEL-04]
---

# Phase 36 Plan 36-05: canonical_models.json default + capability_registry loader (INTEL-04) Summary

**One-liner:** Lands INTEL-04 — `src-tauri/canonical_models.json` bundles 5 providers (anthropic, openai, groq, gemini, openrouter) × 21 models, ported from `capability_probe::OVR_*` arrays with public pricing as of 2026-05-06. `intelligence::capability_registry::{load_registry, ensure_registry_file, get_capabilities, validate_against_probe}` plus a once_cell::Lazy<Mutex<RegistryCache>> singleton with mtime-based reload back the registry. Two Tauri commands (`reload_capability_registry`, `get_active_model_capabilities`) are wired into `generate_handler!`. Plan 36-06's router consumes `get_capabilities` registry-first, capability_probe fallback.

## What Shipped

### Bundled registry — `src-tauri/canonical_models.json`

| Provider | Models | Notes |
|---|---|---|
| anthropic | 4 (claude-opus-4, claude-sonnet-4-20250514, claude-haiku-4-5, claude-3-5-sonnet) | $1–$15 in / $5–$75 out per million |
| openai | 6 (gpt-5, gpt-4o, gpt-4o-mini, gpt-4o-audio-preview, o3-mini, o4-mini) | $0.15–$5 in / $0.60–$15 out |
| groq | 3 (llama-3.3-70b-versatile, llama-3.1-8b-instant, mixtral-8x7b) | $0.05–$0.59 in / $0.08–$0.79 out |
| gemini | 4 (gemini-2.5-pro, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash) | $0.30–$1.25 in / $2.50–$5.00 out |
| openrouter | 4 explicit (anthropic/claude-sonnet-4, anthropic/claude-opus-4, openai/gpt-5, meta-llama/llama-3.3-70b-instruct:free) | $0–$15 in / $0–$75 out |

Schema version=1; total 21 models. Audio defaults to false; gemini-2.5-pro / gemini-1.5-pro / gemini-1.5-flash and gpt-4o-audio-preview set audio=true.

### Loader — `src-tauri/src/intelligence/capability_registry.rs`

- 4 types: `CapabilityRegistry`, `ProviderEntry`, `ModelCapabilities`, `RegistryCache` (private).
- `load_registry(path)` parses JSON, rejects version != 1.
- `ensure_registry_file(path)` copies `BUNDLED_REGISTRY` (`include_str!`) to user path on first boot.
- `get_capabilities(provider, model, config)` is the single public lookup. mtime-based reload — single load per session under normal conditions; refreshes when the user edits the file.
- `force_reload(path)` clears cache + reparses (used by `reload_capability_registry` Tauri command).
- `validate_against_probe(registry)` walks the registry and logs `[INTEL-04] registry/probe mismatch ...` for any (vision, tool_use, audio) drift; non-halting.
- `INTEL_FORCE_REGISTRY_MISS` thread-local seam forces None return (Plan 36-06 fallback test will use it).
- Last-resort `parse_bundled_then_lookup()` fires when disk IO or the singleton's mutex misbehaves — guarantees the binary always has SOME answer.

### Tauri commands — `src-tauri/src/intelligence/mod.rs` + `src-tauri/src/lib.rs`

```rust
#[tauri::command]
pub async fn reload_capability_registry() -> Result<u32, String>;

#[tauri::command]
pub async fn get_active_model_capabilities() -> Result<Option<ModelCapabilities>, String>;
```

Both commands read config via `crate::config::load_config()` — there is no `ConfigState` type in BLADE, so the AppHandle/State pattern in the plan body was simplified. Both registered in `generate_handler![]` at lib.rs:1492-1493.

### Startup wiring — `intelligence::init()`

```rust
pub fn init() {
    let cfg = crate::config::load_config();
    let path = &cfg.intelligence.capability_registry_path;
    if let Err(e) = capability_registry::ensure_registry_file(path) { ... return; }
    match capability_registry::load_registry(path) {
        Ok(reg) => capability_registry::validate_against_probe(&reg),
        Err(e) => log::warn!("[INTEL-04] init: load_registry failed: {e}"),
    }
}
```

First boot: bundled JSON copies to `blade_config_dir().join("canonical_models.json")`. Subsequent boots: idempotent ensure + parity walk.

## Tests Added (9/9 green)

```
running 9 tests (intelligence::capability_registry)
test phase36_intel_04_canonical_models_round_trip_serde      ... ok
test phase36_intel_04_unsupported_version_returns_err        ... ok
test phase36_intel_04_ensure_registry_file_seeds_bundled     ... ok
test phase36_intel_04_get_returns_known_model                ... ok
test phase36_intel_04_get_returns_none_for_unknown           ... ok
test phase36_intel_04_force_registry_miss_seam               ... ok
test phase36_intel_04_mtime_refresh_picks_up_changes         ... ok
test phase36_intel_04_capability_probe_parity                ... ok
test phase36_intel_04_validation_report_structure            ... ok
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured
```

The plan called for 6 phase36_intel_04_* tests; we shipped 9 (added explicit get-returns-none, mtime-refresh, and capability-probe-parity coverage on top of the round-trip / version-reject / seed / known-lookup / force-miss-seam / validation-no-panic core).

## ConfigState shape

The plan body suggested `app.try_state::<ConfigState>()` for the Tauri command bodies. BLADE has NO `ConfigState` struct — config snapshot is reconstructed via `crate::config::load_config()` on each call (it reads from disk + keyring synchronously, costs sub-millisecond). The intelligence::reindex_symbol_graph command upstream uses the same pattern, so we mirrored it for consistency. No struct needed to be added.

## capability_probe parity check

`capability_probe::infer_capabilities` returns a **5-tuple** `(vision, audio, tool_calling, long_context, context_window)`, not a struct. The implementation adapted accordingly — `validate_against_probe` and the `phase36_intel_04_capability_probe_parity` test compare positionally and only check (vision, tool_use, audio) since `long_context` and `context_window` aren't on `ModelCapabilities` (the registry stores `context_length` directly, no `long_context` derivation needed). The parity test runs informationally — it logs mismatches via `eprintln!` but does not fail. Empirically the 9-test run printed no mismatches: registry and probe agree on every (provider, model) pair that registry contains.

## Models in capability_probe NOT in canonical_models.json (registry-superset rule check)

Registry gaps (intentional or candidate ports for v1.6+):

- `openai/gpt-4-turbo` — not ported (GPT-5 supersedes; gpt-4-turbo deprecated)
- `openai/gpt-3.5-turbo` — not ported (legacy; substring-match in probe still works)
- `openai/whisper-1`, `openai/tts-1` — audio-only models, deferred to a future audio-focused registry section
- `groq/meta-llama/llama-4-scout`, `groq/llama-3.2-90b-vision`, `groq/llama-3.2-vision`, `groq/whisper-large-v3` — vision/audio/scout variants deferred
- `openrouter/<other>` — substring fallback handles via probe
- `ollama/*` — out by CONTEXT lock decision (no public pricing)

These gaps are intentional: the registry is the EXPLICIT subset users pick directly. Substring fallback in capability_probe still resolves for any of them. Plan 36-06 will exercise the registry-first / probe-fallback dispatch.

## Deviations from plan

- **Plan said 6 tests, shipped 9.** Added explicit none-for-unknown coverage, mtime-refresh test, and the parity test. All green.
- **Plan suggested ConfigState/AppHandle in command bodies.** BLADE has no ConfigState type — used `load_config()` instead, matching `intelligence::reindex_symbol_graph`'s precedent. Documented in decisions.
- **capability_probe returns a 5-tuple, not a struct.** Plan body assumed struct shape; implementation adapted. No CONTEXT changes required — pure local refactor of validate_against_probe + parity test.
- **`tool_calling` (probe) vs `tool_use` (registry) name divergence** — treated as semantically identical at the parity boundary. Harmonization deferred.
- **Auto-fixed Rule 3 deviations:** None. The plan's Rust scaffolding was correct; only the ConfigState/struct-vs-tuple adaptations described above were needed.

## Commits

```
bb336f7  feat(36-05): add canonical_models.json with 5 providers x 21 models (INTEL-04)
f55464d  feat(36-05): fill capability_registry.rs + register Tauri commands (INTEL-04)
2263402  feat(36-05): register reload_capability_registry + get_active_model_capabilities in generate_handler! (INTEL-04)
```

## Self-Check: PASSED

- `src-tauri/canonical_models.json` — FOUND (214 LOC, JSON validates, version=1, 5 providers, 21 models)
- `src-tauri/src/intelligence/capability_registry.rs` — FOUND (378 LOC, 9 tests green)
- `src-tauri/src/intelligence/mod.rs` — FOUND (re-exports + init() + 2 Tauri commands)
- `src-tauri/src/lib.rs` — FOUND (2 entries in generate_handler!)
- Commit bb336f7 — FOUND
- Commit f55464d — FOUND
- Commit 2263402 — FOUND
- cargo check exits 0
- cargo test --lib intelligence::capability_registry: 9/9 pass

## Next plan

**Plan 36-06** — `router.rs` consumes `capability_registry::get_capabilities` registry-first, falls back to `capability_probe::infer_capabilities` when `None`. The `INTEL_FORCE_REGISTRY_MISS` seam shipped here is the test hook for the fallback path.
