# Phase 54 — SUMMARY (GOOSE-PROVIDER)

**Status:** Complete
**Closed:** 2026-05-14

## Outcome

BLADE's bespoke provider abstraction now sits alongside the Goose-aligned
`Provider` / `ProviderDef` trait pair, and the provider mod consults Goose's
upstream `canonical_models.json` (~4,355 model records across ~117 providers)
for pricing + context-window + capability lookup. Every existing BLADE
provider (anthropic, openai, groq, gemini, ollama) ships a thin adapter that
delegates to its existing `complete_ext` function, so HTTP / auth / streaming
behavior is unchanged — zero runtime risk, zero call-site churn.

Authority chain: VISION.md (line 156 "Bundle Goose internals — rip + integrate")
→ v2.2-REQUIREMENTS.md Phase 54 → this phase. Apache 2.0 attribution carried in
every adapted file.

## Deliverables (5 REQs, 9 commits)

| REQ | Commit  | Description |
|---|---|---|
| PROVIDER-TRAIT-PORT      | `ed90327` | Goose Provider/ProviderDef traits in `providers/goose_traits.rs` |
| PROVIDER-CANONICAL-MODELS| `08b9af0` | Goose's canonical_models.json (~4,355 models) + loader in `providers/canonical.rs` |
| PROVIDER-MIGRATION (anthropic) | `4aeba6a` | Adapter struct + ProviderDef impl |
| PROVIDER-MIGRATION (openai)    | `e057e89` | Adapter struct + ProviderDef impl |
| PROVIDER-MIGRATION (groq)      | `16f3eb1` | Adapter struct + ProviderDef impl |
| PROVIDER-MIGRATION (gemini)    | `ad5a73c` | Adapter struct + ProviderDef impl |
| PROVIDER-MIGRATION (ollama)    | `8c6441e` | Adapter struct + ProviderDef impl |
| PROVIDER-ROUTER-WIRE     | `beb5b37` | `price_per_million` + `max_output_tokens_for` consult registry first; new `context_window_for` + `pick_cheapest_sufficient` helpers |
| PROVIDER-TESTS           | `94efe12` | 5 integration tests in `tests/provider_canonical_integration.rs` |

## Static gates

| Gate | Result |
|---|---|
| `cargo check` (lib)                                 | Clean (0 errors, 0 phase-54 warnings) |
| `tsc --noEmit`                                      | Clean (no frontend changes; ran for posture) |
| `cargo test --lib providers::`                      | 33/33 pass (pre-existing pricing + capability + fallback-chain tests all still green; new canonical + adapter tests pass) |
| `cargo test --test provider_canonical_integration`  | 5/5 pass |

## Files touched / added

**New:**
- `src-tauri/src/providers/goose_traits.rs` (313 lines) — Provider + ProviderDef + ProviderMetadata + ConfigKey + ProviderUsage + BladeModelConfig
- `src-tauri/src/providers/canonical.rs` (320 lines) — CanonicalModel / Modality / Pricing / Limit + lookup() + list_for_provider() + entry_count() / provider_count()
- `src-tauri/data/canonical_models.json` (2.4 MB, 4,355 entries) — Goose upstream
- `src-tauri/tests/provider_canonical_integration.rs` (256 lines) — 5 integration tests

**Modified:**
- `src-tauri/src/providers/mod.rs` — registered `canonical` + `goose_traits`; wired `price_per_million` + `max_output_tokens_for` to consult the registry first; added `context_window_for` + `pick_cheapest_sufficient` helpers
- `src-tauri/src/providers/anthropic.rs` — `AnthropicProvider` + `AnthropicDef` (101 lines added)
- `src-tauri/src/providers/openai.rs` — `OpenAIProvider` + `OpenAIDef` (90 lines added)
- `src-tauri/src/providers/groq.rs` — `GroqProvider` + `GroqDef` (88 lines added)
- `src-tauri/src/providers/gemini.rs` — `GeminiProvider` + `GeminiDef` (88 lines added)
- `src-tauri/src/providers/ollama.rs` — `OllamaProvider` + `OllamaDef` (82 lines added)
- `src-tauri/src/lib.rs` — `providers` made `pub` so the integration test target can import the module

## Goose source attribution (Apache 2.0)

Every adapted file carries an `Adapted from block/goose (Apache 2.0)` comment
and an upstream URL. Sources used:

- `crates/goose/src/providers/base.rs` (1,775 lines) — Provider + ProviderDef + ModelInfo + ProviderMetadata + ConfigKey + ProviderUsage + Usage trait + struct shapes. BLADE's `goose_traits.rs` is the trimmed adaptation (drops ThinkFilter, embeddings, session-name generation, cache-control hooks — out of scope for Phase 54).
- `crates/goose/src/providers/canonical/model.rs` (121 lines) — CanonicalModel / Modality / Pricing / Limit struct shapes. BLADE's `canonical.rs` mirrors them byte-identically at the JSON layer.
- `crates/goose/src/providers/canonical/data/canonical_models.json` (2.4 MB) — bundled verbatim into `src-tauri/data/`.
- `crates/goose/src/providers/canonical/registry.rs` (108 lines) — `CanonicalModelRegistry::bundled()` pattern. BLADE's `with_registry` Lazy<Mutex<…>> singleton is the same shape minus Goose's anyhow error type (BLADE returns Option for graceful-degrade on miss).

## Deviations from REQ list

- **`canonical_models.json` location.** REQ wording said "Drop it into
  `src-tauri/data/canonical_models.json`" — done. BLADE already had a smaller
  Phase 36 BLADE-curated registry at `src-tauri/canonical_models.json` (top
  level, not `data/`). Both coexist deliberately:
    - `src-tauri/canonical_models.json` (Phase 36, ~5 providers × ~4 models) — feeds `intelligence::capability_registry`. Used by router for boolean capability bits (vision / tool_use / audio / long_context) per Plan 36-06.
    - `src-tauri/data/canonical_models.json` (Phase 54, 4,355 models) — feeds `providers::canonical`. Used for pricing + context_window + the new `pick_cheapest_sufficient` router helper.
  No collision; the two consumers don't overlap on the same lookup surface.

- **Goose ID format.** Goose's registry uses dot-separated version IDs
  (`claude-3.5-sonnet`, not `claude-3-5-sonnet`). Tests pin the upstream id
  directly so accidental drift surfaces.

- **Provider-id alias mapping.** Goose uses `google/` for Gemini models;
  BLADE's internal provider id is `gemini`. `canonical::lookup("gemini", m)`
  transparently re-tries under the `google/` alias. Ollama is intentionally
  not in Goose's registry (local-only); `lookup("ollama", _)` always returns
  None and the router falls back to its local-zero-cost path.

- **`#[async_trait]` vs stable async-fn-in-trait.** Goose's `Provider` trait
  uses `#[async_trait]` so `dyn Provider` is object-safe. BLADE adopts the
  stable rustc-1.75+ `async fn in trait` syntax — no extra crate dependency.
  `dyn Provider` is not needed in Phase 54 (the dispatch table in
  `providers::complete_turn` is a `match` on provider name, not dynamic
  trait dispatch). If a future phase needs `dyn Provider`, switch to
  `#[async_trait]` or wrap return types in `BoxFuture`.

- **Module visibility.** `src-tauri/src/lib.rs:105` changed from `mod
  providers;` to `pub mod providers;` to let the integration test target
  import `blade_lib::providers::*`. Mirrors the precedent set by Phase 47's
  `pub mod tool_forge` and Phase 58's `pub mod embeddings` for the same
  reason.

## What this does NOT do (deferred)

- **Migrate dispatch to `dyn Provider`.** Current `complete_turn` still
  matches on provider name. The trait shape is in place for a future phase
  to switch to dynamic dispatch — the architectural risk lives at that
  switch, not at the trait introduction.
- **OpenRouter / DeepSeek / NVIDIA NIM adapters.** Out of scope (REQ
  enumerates exactly 5 providers). Custom base_url installs continue to
  route through the OpenAI-compatible code path.
- **Goose's session schema.** Phase 55 (GOOSE-SESSION) covers that.
- **Goose's Recipes engine.** Explicitly deferred to v2.3+ per
  REQUIREMENTS.md.

## Next

Phase 55 — GOOSE-SESSION (SQLite schema for cross-session continuity +
session-fork + future Goose interop).
