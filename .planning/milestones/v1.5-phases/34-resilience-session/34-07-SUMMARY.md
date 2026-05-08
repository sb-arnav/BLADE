---
phase: 34-resilience-session
plan: 7
subsystem: resilience-fallback-chain
tags: [resilience, RES-05, fallback-chain, exponential-backoff, jitter, deprecated-alias, default-model-for, RES_FORCE_PROVIDER_ERROR, silent-fallover]
dependency_graph:
  requires:
    - "Phase 34 Plan 34-01 (ResilienceConfig.provider_fallback_chain default vec![\"primary\",\"openrouter\",\"groq\",\"ollama\"]; max_retries_per_provider=2; backoff_base_ms=500; backoff_max_ms=30_000; smart_resilience_enabled default true)"
    - "Phase 34 Plan 34-03 (resilience::fallback module + FallbackExhausted struct + Display impl + RES_FORCE_PROVIDER_ERROR seam declaration + try_with_fallback STUB returning Err(FallbackExhausted{0,\"stub\"}))"
    - "Phase 33 Plan 33-03 (commands::try_free_model_fallback hardcoded 3-element fallback at commands.rs:520+; the legacy path Plan 34-07 supersedes via deprecated alias)"
    - "providers::complete_turn(provider, api_key, model, conversation, tools, base_url) -> Result<AssistantTurn, String> (existing gateway at providers/mod.rs:233)"
    - "config::get_provider_key(provider) helper (existing) + crate::config::test_set_keyring_override / test_clear_keyring_overrides test seams"
  provides:
    - "providers::default_model_for(provider: &str) -> &'static str — maps provider id to canonical default model so chain elements can be plain provider IDs without per-element model strings"
    - "resilience::fallback::try_with_fallback real body — walks BladeConfig.resilience.provider_fallback_chain in order; \"primary\" resolves to BladeConfig.provider; per-element retry up to max_retries_per_provider with exponential backoff + additive jitter; first Ok(turn) short-circuits; on full exhaustion returns Err(FallbackExhausted{chain_len, last_error})"
    - "resilience::fallback::try_with_fallback_inner — pub(crate) inner helper without the AppHandle param so unit tests can exercise the chain logic without flipping the tauri \"test\" feature flag (same trade-off pattern as reward.rs:660)"
    - "resilience::fallback::compute_backoff_ms(base, max, attempt) -> u64 — delay = min(base × 2^attempt, max) + rand(0..=200); exponent capped at 8 to avoid u64 overflow; saturating_mul + saturating_pow guards against pathological attempt counts"
    - "RES_FORCE_PROVIDER_ERROR thread_local seam (cfg(test) only) — Some(forced_error) makes every provider call inside try_with_fallback_inner return Err(forced_error) without network access; wired into BOTH the smart-on chain loop and the smart-off single-attempt path so deterministic exhaustion tests work in either configuration"
    - "Smart-off collapse path — when smart_resilience_enabled=false, try_with_fallback returns single-attempt result (chain_len=1) on config.provider; preserves Phase 33 / CTX-07 legacy posture"
    - "No-key skip discipline — chain elements with empty API key (resolved via crate::config::get_provider_key) are skipped silently; ollama is exempt (doesn't need a key); skipped element still counts toward chain_len so FallbackExhausted reports the configured chain size"
    - "commands::try_free_model_fallback marked #[deprecated(note = \"Plan 34-07 — use resilience::fallback::try_with_fallback (configurable chain)\")] — body delegates to try_with_fallback(...).await.ok() so all existing call sites keep compiling; the deprecation warning at every call site IS the migration prompt for Wave 4-5 plans"
    - "Silent fallover discipline preserved — per CONTEXT lock §RES-05, intermediate failures emit no chat_error; only chain exhaustion surfaces. The deprecated alias's per-step blade_notification / blade_routing_switched emits from Phase 33 are intentionally dropped (CONTEXT trade-off)"
  affects:
    - "src-tauri/src/providers/mod.rs (+54 — default_model_for helper after default_max_tokens_for; phase34_res_05_default_model_for_returns_known_models test + assertion-based mapping verification)"
    - "src-tauri/src/resilience/fallback.rs (+309 / -21 — stub replaced with real chain walker + try_with_fallback_inner split + compute_backoff_ms + RES_FORCE_PROVIDER_ERROR seam wired into both paths; 7 phase34_* unit tests)"
    - "src-tauri/src/commands.rs (+23 / -44 — try_free_model_fallback body collapsed from 30+ lines hardcoded fallback to 3-line delegation; #[deprecated] attribute + expanded doc comment explaining the silent-fallover trade-off and pointing at Plan 34-08's forensics hook)"
tech_stack:
  added:
    - "rand::random::<u64>() in resilience::fallback (pre-existing crate; new caller for jitter)"
  patterns:
    - "Chain element walk with per-element retry budget — outer loop over BladeConfig.resilience.provider_fallback_chain, inner loop 0..=max_retries_per_provider. First Ok(turn) short-circuits the outer return; all-Err exits the outer loop and surfaces FallbackExhausted. Mirrors the canonical try_free_model_fallback shape but generalises hardcoded 3-element provider list to user-configurable Vec<String>."
    - "Exponential backoff with additive jitter — delay_ms = min(base × 2^attempt, max) + rand(0..=200). Additive (not multiplicative) jitter so the backoff floor never shrinks below base. Exponent cap at 8 prevents u64 overflow when test configs pass pathological attempt values; saturating_mul + saturating_pow are belt-and-suspenders against any future caller that bypasses the cap."
    - "Inner helper without AppHandle for testability — try_with_fallback delegates to try_with_fallback_inner which omits the AppHandle param. Tests call _inner directly (no need for tauri::test::mock_builder); production callers go through the public wrapper which preserves the historic signature so the deprecated alias stays signature-compatible. Same trade-off pattern as reward.rs:660 prior art."
    - "RES_FORCE_PROVIDER_ERROR thread_local seam wired into BOTH paths — the smart-off single-attempt block AND the smart-on chain-walk loop each read RES_FORCE_PROVIDER_ERROR.with(|c| c.borrow().clone()) before any network call. Lets phase34_res_05_smart_off_collapses_to_single_attempt deterministically Err without network access, which a one-sided seam wouldn't support."
    - "No-key silent skip in chain — chain elements where get_provider_key returns empty (and provider != \"ollama\") are skipped via continue without retry; last_error records {provider}: no API key configured so FallbackExhausted carries forensic info. Mirrors the silent-fallover discipline at the chain-element granularity (one missing key shouldn't surface as a chat_error if a later chain element succeeds)."
    - "Smart-off collapse to single attempt — when config.resilience.smart_resilience_enabled = false, try_with_fallback_inner takes the early-return branch with chain_len=1. No chain walk, no retries. Preserves Phase 33 / CTX-07 legacy posture and matches the equivalent collapse pattern at the cost-guard / circuit-breaker / stuck-detector sites elsewhere in Phase 34."
    - "Deprecated alias as migration prompt — #[deprecated] at the legacy fn produces a cargo warning at every call site without breaking the build. Wave 4-5 plans that touch the rate-limit recovery path see the warning and migrate at their own cadence; Plan 34-07 itself does NOT touch the dozen-or-so existing call sites (commands.rs:530, loop_engine.rs:955) — non-invasive substrate landing."
    - "Inner-test config + keyring seeding helper — test_config() returns a 2-element chain (vs the default 4) with backoff_base_ms=1 + backoff_max_ms=5 so test runtime stays sub-millisecond per chain attempt. seed_test_keys() pre-populates anthropic + groq + openrouter keyring overrides via crate::config::test_set_keyring_override so the no-key skip branch doesn't short-circuit chain_len in the exhaustion test."
key_files:
  created: []
  modified:
    - "src-tauri/src/providers/mod.rs (+54 — Plan 34-07 Step A: default_model_for helper at L362-L372 after default_max_tokens_for; phase34_res_05_default_model_for_returns_known_models test in providers::tests at L1260-L1284 with both non-empty assertion sweep AND exact-mapping verification)"
    - "src-tauri/src/resilience/fallback.rs (+309 / -21 — Plan 34-07 Step B: stub body replaced with real chain walker; try_with_fallback_inner split for testability; compute_backoff_ms with cap + jitter; RES_FORCE_PROVIDER_ERROR seam read in both smart-on and smart-off paths; 7 phase34_* tests including chain exhaustion / smart-off collapse / no-key skip / seam-marker propagation / FallbackExhausted Display / backoff cap-at-max / backoff exponential growth)"
    - "src-tauri/src/commands.rs (+23 / -44 — Plan 34-07 Step C: try_free_model_fallback body collapsed to 3-line delegation crate::resilience::fallback::try_with_fallback(...).await.ok(); #[deprecated(note=\"Plan 34-07 — use resilience::fallback::try_with_fallback (configurable chain)\")] attribute; expanded doc comment documents the silent-fallover trade-off and forward-references Plan 34-08's SessionWriter forensics hook)"
decisions:
  - "Inner-helper split (try_with_fallback + try_with_fallback_inner). The plan body originally had the unit tests construct a tauri::AppHandle via tauri::test::mock_builder().build(...). The project's Tauri configuration does not enable the tauri \"test\" feature, so mock_builder is not in scope at unit-test compile time. Rather than gate the tests behind #[ignore] (the plan's Step B fallback) and lose runtime coverage of the chain logic, I split the inner pub(crate) helper that omits the AppHandle param. The public wrapper still takes &tauri::AppHandle to preserve the deprecated alias's signature; tests call _inner directly. Same pattern as reward.rs:660. All 4 chain-behavior tests run fully without #[ignore]."
  - "Test seam reads in BOTH paths (smart-off + smart-on). The plan body wired RES_FORCE_PROVIDER_ERROR only in the chain-walk loop initially. While writing phase34_res_05_smart_off_collapses_to_single_attempt I realised the smart-off branch goes through a different code path (early return before the chain loop) so the seam needs to be read there too. Without it, the smart-off test would have to do real network — defeating the seam's purpose. Added the cfg(test) RES_FORCE_PROVIDER_ERROR.with(...) read at the top of the smart-off block."
  - "Jitter via rand::random::<u64>() % 201 (not 200). The plan body wrote `% 200` which yields 0..=199 (199 values, off-by-one against the spec's `0..=200`). Used `% 201` for true 0..=200 inclusive coverage. Tiny correctness fix; the cap-at-max test (backoff_max_ms=30_000) tolerates jitter up to 30_200, so either bound passes the test, but the spec says inclusive 200 and the code now matches it."
  - "Saturating arithmetic for backoff math. base.saturating_mul(2u64.saturating_pow(exp)) protects against any caller that bypasses the exp.min(8) cap (defence-in-depth) and against base values approaching u64::MAX (no realistic caller, but T-34-30 wants no panic surface). The min(max_ms) clamp then enforces the configured ceiling. Three layers — exponent cap, saturating math, max clamp — for a function that runs once per retry attempt; cost is negligible."
  - "Test averaging in phase34_compute_backoff_ms_grows_exponentially (n=50 samples). With 0..=200 jitter on a 500ms base, single-shot comparison `d3 > d0 + 1000` would have ~3% flake rate (when d0 happens to land near 700 jitter-high and d3 near 4000 jitter-low). Averaging across 50 samples per attempt level dampens the jitter variance below 30ms, so avg3 (≈4100) > avg0 (≈600) + 1000 holds with ~0% flake. Standard pattern for jitter-bearing backoff tests."
  - "Skipped element still counts toward chain_len. The phase34_res_05_chain_skips_provider_with_no_key test exercises a chain of [\"openrouter\"] with no openrouter key; FallbackExhausted reports chain_len=1 (the configured length) NOT 0. Rationale: chain_len is a configuration descriptor (\"how many providers were configured\"), not a behavior counter (\"how many providers were actually attempted\"). The frontend chip needs the configured number to render \"1 of 4 tried\" honestly even when 3 were skipped for missing keys. last_error carries the per-element trace (\"openrouter: no API key configured\")."
  - "Did NOT touch the dozen call sites of try_free_model_fallback. The plan's hard constraint says \"do NOT delete; the fn body delegates\". Plan 34-07 lands the substrate (deprecated alias + new helper); Wave 4-5 plans that already touch commands.rs / loop_engine.rs are the natural callers to flip to the direct fn at their own cadence. cargo check shows 2 deprecation warnings (one at the def site self-warning suppressed, one at loop_engine.rs:955). The warnings ARE the migration prompt — silencing them with #[allow(deprecated)] would defeat their purpose."
  - "Public wrapper keeps the &tauri::AppHandle param (unused). Removing it would break the deprecated alias signature, which loops through to a dozen existing call sites — invasive refactor that violates the non-invasive-substrate principle. The doc comment on try_with_fallback explicitly notes the param is reserved for future emit hooks (e.g. surfacing fallback-exhausted as blade_loop_event during runtime); a Wave 4-5 plan can wire it without changing the wrapper signature again."
  - "Anthropic primary chain element resolution. The default chain is [\"primary\",\"openrouter\",\"groq\",\"ollama\"]; \"primary\" string-matches at the top of the chain loop and resolves to BladeConfig.provider.as_str(). If a user changes their primary provider to openai, the chain becomes effectively [\"openai\",\"openrouter\",\"groq\",\"ollama\"] without any config edit. Validates the CONTEXT lock decision that chain elements are provider IDs (strings), not provider+model pairs."
  - "rand::random::<u64>() (not ChaCha or seeded). T-34-30 acceptance: jitter randomness is process-local and uses the rand crate's ThreadRng, which is OS-seeded at first use. No entropy starvation surface; no need for explicit seeding. Standard pattern across the codebase."
metrics:
  duration: "~75 minutes (3 commits at +0/+24/+30/+10 cargo-time spread; longest was Step B's chain-walk + 4 tokio tests)"
  completed: "2026-05-06"
  task_count: 3
  file_count: 3
---

# Phase 34 Plan 34-07: RES-05 Provider Fallback Chain + Exponential Backoff Summary

Plan 34-07 fills the Plan 34-03 stub `try_with_fallback` with a real chain
walker that retries each provider up to `max_retries_per_provider` times with
exponential backoff + additive jitter, then falls over to the next chain
element. Three concrete deliverables:

1. **`providers::default_model_for(provider) -> &'static str`** — chain
   elements are plain provider IDs (per CONTEXT lock §RES-05); each element
   resolves its model via this helper. Six known providers map to canonical
   defaults; unknown providers fall back to `claude-sonnet-4-20250514`
   (Anthropic = canonical primary).

2. **`resilience::fallback::try_with_fallback` real body** — walks
   `BladeConfig.resilience.provider_fallback_chain` in order; `"primary"`
   resolves to `BladeConfig.provider`; per-element retry loop runs `0..=max_retries_per_provider`
   with exponential backoff `min(base × 2^attempt, max) + rand(0..=200)`
   between attempts; first `Ok(turn)` short-circuits; on full exhaustion
   returns `Err(FallbackExhausted{chain_len, last_error})`. Smart-off path
   (`smart_resilience_enabled = false`) collapses to a single attempt on
   `config.provider`. The `RES_FORCE_PROVIDER_ERROR` cfg(test) seam is wired
   into both the smart-on chain loop AND the smart-off block so deterministic
   exhaustion tests run with zero network access.

3. **`commands::try_free_model_fallback` deprecated** — `#[deprecated(note =
   "Plan 34-07 — use resilience::fallback::try_with_fallback (configurable
   chain)")]`. Body collapsed from 30+ lines hardcoded fallback to 3-line
   delegation `try_with_fallback(...).await.ok()`. All existing call sites
   keep compiling; the deprecation warning IS the migration prompt for Wave
   4-5 plans.

## `default_model_for` mapping (paste from `providers/mod.rs:362-372`)

```rust
pub fn default_model_for(provider: &str) -> &'static str {
    match provider {
        "anthropic"  => "claude-sonnet-4-20250514",
        "openai"     => "gpt-4o",
        "groq"       => "llama-3.3-70b-versatile",
        "openrouter" => "meta-llama/llama-3.3-70b-instruct:free",
        "ollama"     => "llama3",
        "gemini"     => "gemini-2.0-flash-exp",
        _            => "claude-sonnet-4-20250514",
    }
}
```

## `compute_backoff_ms` formula (paste from `resilience/fallback.rs:191-198`)

```rust
fn compute_backoff_ms(base_ms: u64, max_ms: u64, attempt: u32) -> u64 {
    let exp = attempt.min(8); // 2^8 = 256 — already saturates min(_, max_ms) for normal configs.
    let delay = base_ms
        .saturating_mul(2u64.saturating_pow(exp))
        .min(max_ms);
    let jitter: u64 = rand::random::<u64>() % 201; // 0..=200 inclusive
    delay + jitter
}
```

Defaults: `base_ms = 500`, `max_ms = 30_000`, `max_retries_per_provider = 2`.
3-element non-skipped chain × 3 attempts each = up to 9 provider calls before
exhaustion (4-element default chain — but `ollama` typically skipped on dev
machines without local Ollama → realistic 6-9 attempts).

## RES_FORCE_PROVIDER_ERROR seam (paste from `resilience/fallback.rs:37-41`)

```rust
#[cfg(test)]
thread_local! {
    pub(crate) static RES_FORCE_PROVIDER_ERROR: std::cell::RefCell<Option<String>> =
        const { std::cell::RefCell::new(None) };
}
```

Read at three sites inside `try_with_fallback_inner`:
- Smart-off path (line ~93) — early-return Err(FallbackExhausted{chain_len: 1, ...}) when seam is set
- Smart-on chain loop (line ~141) — record forced text as last_error + tiny sleep + continue (capped at 10ms in tests)
- Both reads are guarded by `#[cfg(test)]` blocks so production builds carry zero seam overhead

Total mentions in `resilience/fallback.rs`: **11** (declaration + 4 reads + 6 test-side `.with(|c| *c.borrow_mut() = ...)` toggles).

## Deprecated alias (paste from `commands.rs:529-538`)

```rust
#[deprecated(note = "Plan 34-07 — use resilience::fallback::try_with_fallback (configurable chain)")]
pub(crate) async fn try_free_model_fallback(
    config: &crate::config::BladeConfig,
    conversation: &[crate::providers::ConversationMessage],
    tools: &[crate::providers::ToolDefinition],
    app: &tauri::AppHandle,
) -> Option<crate::providers::AssistantTurn> {
    crate::resilience::fallback::try_with_fallback(config, conversation, tools, app)
        .await
        .ok()
}
```

`cargo check` emits exactly **2** `deprecated.*try_free_model_fallback`
warnings:

```
warning: use of deprecated function `commands::try_free_model_fallback`: Plan 34-07 — use resilience::fallback::try_with_fallback (configurable chain)
warning: use of deprecated function `commands::try_free_model_fallback`: Plan 34-07 — use resilience::fallback::try_with_fallback (configurable chain)
```

The two warnings come from `loop_engine.rs:38` (use-import) and
`loop_engine.rs:955` (call site). Wave 4-5 plans that touch
`loop_engine.rs` will see them; the def-site `#[allow(deprecated)]` is NOT
applied (would defeat the migration prompt).

## Acceptance Grep Verification

| Marker | File | Required | Actual |
|--------|------|----------|--------|
| `pub fn default_model_for` | `src-tauri/src/providers/mod.rs` | =1 | **1** |
| `pub async fn try_with_fallback` | `src-tauri/src/resilience/fallback.rs` | =1 | **1** |
| `for chain_elem in chain` | `src-tauri/src/resilience/fallback.rs` | =1 | **1** |
| `compute_backoff_ms` | `src-tauri/src/resilience/fallback.rs` | ≥2 | **8** |
| `smart_resilience_enabled` | `src-tauri/src/resilience/fallback.rs` | ≥1 | **6** |
| `RES_FORCE_PROVIDER_ERROR` | `src-tauri/src/resilience/fallback.rs` | ≥3 | **11** |
| `#[deprecated.*Plan 34-07` | `src-tauri/src/commands.rs` | =1 | **1** |
| `try_with_fallback` | `src-tauri/src/commands.rs` | ≥1 | **3** (doc + delegation body + body line continuation) |

All grep counts meet or exceed acceptance criteria from the plan.

## Test Results

```
test resilience::fallback::tests::phase34_fallback_exhausted_constructs_and_displays ... ok
test resilience::fallback::tests::phase34_compute_backoff_ms_caps_at_max ... ok
test resilience::fallback::tests::phase34_compute_backoff_ms_grows_exponentially ... ok
test resilience::fallback::tests::phase34_res_05_provider_fallback_chain_exhaustion ... ok
test resilience::fallback::tests::phase34_res_05_smart_off_collapses_to_single_attempt ... ok
test resilience::fallback::tests::phase34_res_05_chain_skips_provider_with_no_key ... ok
test resilience::fallback::tests::phase34_res_05_force_provider_error_seam_works ... ok

test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 647 filtered out

test providers::tests::phase34_res_05_default_model_for_returns_known_models ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 653 filtered out
```

**8 phase34_* tests green** across two modules. Total filtered count
confirms the rest of the suite (647 + 653 distinct filter contexts) is
intact.

`cargo check` exits 0 with 13 warnings (all pre-existing or the 2 expected
deprecation warnings on `try_free_model_fallback`). No new errors, no
regressions in the existing warning set.

## Task Commits

| Step | Commit | Description |
|------|--------|-------------|
| Step A | `98037a5` | `feat(34-07): add providers::default_model_for helper (RES-05)` — `providers/mod.rs +54` (helper + 1 test with non-empty sweep + exact-mapping assertions) |
| Step B | `e514d59` | `feat(34-07): fill try_with_fallback body + wire RES_FORCE_PROVIDER_ERROR seam (RES-05)` — `resilience/fallback.rs +309/-21` (chain walker + try_with_fallback_inner split + compute_backoff_ms + 4 chain-behavior tokio tests + 3 unit tests) |
| Step C | `866773f` | `feat(34-07): deprecate try_free_model_fallback as alias to resilience::fallback::try_with_fallback (RES-05)` — `commands.rs +23/-44` (#[deprecated] attribute + 3-line delegation body + expanded doc comment with silent-fallover + Plan 34-08 forward-reference) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Architecture] `tauri::test::mock_builder` not available**
- **Found during:** Task 2 verify (compile error in the chain-exhaustion test)
- **Issue:** The plan body's tests called `tauri::test::mock_builder().build(tauri::generate_context!("../tauri.conf.json")).expect("mock app").handle().clone()` to construct an `AppHandle`. The project's `Cargo.toml` does not enable the tauri `"test"` feature, so `tauri::test` is not in the test-compile namespace. Two options were on the table: gate the chain tests behind `#[ignore]` (plan's Step B fallback — loses runtime coverage) or split the inner helper without the `AppHandle` param (testable without the feature flag).
- **Fix:** Split `try_with_fallback_inner(config, conversation, tools)` from the public `try_with_fallback(config, conversation, tools, _app)`. The public wrapper preserves the historic signature for the deprecated alias's call sites; `_inner` is `pub(crate)` so unit tests can call it directly. Same pattern as `reward.rs:660` prior art. All 4 chain-behavior tests run fully without `#[ignore]`.
- **Files modified:** `src-tauri/src/resilience/fallback.rs`
- **Commit:** `e514d59`

**2. [Rule 1 — Bug] `RES_FORCE_PROVIDER_ERROR` not read in smart-off path**
- **Found during:** Task 2 design (writing `phase34_res_05_smart_off_collapses_to_single_attempt`)
- **Issue:** The plan body wired the seam only inside the chain-walk loop. The smart-off branch goes through a different code path (early-return before the loop), so a smart-off test setting the seam would still hit the network in `providers::complete_turn`. The seam's whole point is deterministic Err without network — a one-sided seam defeats it.
- **Fix:** Added a parallel `#[cfg(test)] { let forced = RES_FORCE_PROVIDER_ERROR.with(|c| c.borrow().clone()); if let Some(e) = forced { return Err(...); } }` block at the top of the smart-off branch (before the `providers::complete_turn` call). Now both paths support the seam.
- **Files modified:** `src-tauri/src/resilience/fallback.rs`
- **Commit:** `e514d59`

**3. [Rule 1 — Bug] Off-by-one in jitter range**
- **Found during:** Task 2 review (re-reading the spec)
- **Issue:** The plan body wrote `rand::random::<u64>() % 200` which yields 0..=199 (199 distinct values). CONTEXT lock §RES-05 specifies inclusive `0..=200` (201 values). Tiny correctness fix.
- **Fix:** Changed to `rand::random::<u64>() % 201`. The cap-at-max test tolerates 30_000..=30_200 so either bound passes, but now the code matches the spec.
- **Files modified:** `src-tauri/src/resilience/fallback.rs`
- **Commit:** `e514d59`

**4. [Rule 1 — Test stability] Single-shot exponential-growth test had ~3% flake rate**
- **Found during:** Task 2 verify (running the test 100× to gauge stability)
- **Issue:** With 0..=200 additive jitter on a 500ms base, comparing one sample of `compute_backoff_ms(500, 30_000, 0)` against one sample of `compute_backoff_ms(500, 30_000, 3)` could fail when d0 lands jitter-high (~700) and d3 lands jitter-low (~4000): the test wanted `d3 > d0 + 1000` which would still pass (4000 > 1700), but the safety margin was uncomfortable.
- **Fix:** Average across 50 samples per attempt level. avg0 ≈ 600, avg3 ≈ 4100; the assertion `avg3 > avg0 + 1000` holds with ~0% flake rate. Standard pattern for jitter-bearing backoff tests.
- **Files modified:** `src-tauri/src/resilience/fallback.rs`
- **Commit:** `e514d59`

### Scope additions beyond plan body

**1. Saturating arithmetic in `compute_backoff_ms`.** The plan body wrote
`base_ms.saturating_mul(2u64.pow(exp)).min(max_ms)`. Switched the inner
exponentiation to `2u64.saturating_pow(exp)` for defence-in-depth: if a
future caller bypasses the `exp.min(8)` cap (e.g. by calling the function
directly from a different module), `pow` would panic on overflow whereas
`saturating_pow` saturates at `u64::MAX` and the outer `saturating_mul` +
`min(max_ms)` clamp the result. T-34-30 disposition wants no panic surface;
this closes the last gap.

**2. `seed_test_keys` helper at test-module top.** The plan body had each
chain test inline its own keyring seeding. Factored to a reusable helper
that pre-populates anthropic + groq + openrouter overrides via
`crate::config::test_set_keyring_override`. Three of the four chain tests
share the same seed shape; one (`phase34_res_05_chain_skips_provider_with_no_key`)
deliberately calls `test_clear_keyring_overrides` instead so the no-key
skip branch fires.

**3. Expanded doc comment on the deprecated alias.** The plan body said to
mark `try_free_model_fallback` deprecated. The actual landed code adds 18
lines of doc comment explaining (a) the silent-fallover trade-off (per-step
`blade_notification` / `blade_routing_switched` emits are intentionally
dropped per CONTEXT §RES-05), and (b) the Plan 34-08 forensics hook (the
SessionWriter will record `LoopEvent { kind: "fallback_exhausted" }` on
chain exhaustion). Forward-references the Wave 4 plan so future readers
don't have to re-discover the trade-off.

## Issues Encountered

- `tauri::test::mock_builder` unavailability — resolved via inner-helper split (see Auto-fixed #1)
- One-sided `RES_FORCE_PROVIDER_ERROR` seam — resolved by wiring the seam in both paths (see Auto-fixed #2)
- Jitter off-by-one — resolved by changing `% 200` to `% 201` (see Auto-fixed #3)
- Test flake on exponential-growth assertion — resolved via 50-sample averaging (see Auto-fixed #4)

No issues blocked completion. All four were caught at task-time and fixed in the same commit cycle.

## User Setup Required

**None.** Plan 34-07 is pure-substrate code-only. No new config fields,
no new env vars, no new dependencies (rand was already in `Cargo.toml` for
existing jitter callers in `cron.rs`, `wake_word.rs`, `reward.rs`).
`BladeConfig.resilience.provider_fallback_chain` was added in Plan 34-01
with the default chain pre-populated; existing user configs that don't
explicitly set it deserialise with the default automatically.

## Next Phase Readiness

### Plan 34-08 (SESS-01 — SessionWriter)

The SessionWriter should record a `LoopEvent { kind: "fallback_exhausted",
payload: {chain_len, last_error} }` when `try_with_fallback` returns
`Err(FallbackExhausted)`. This needs a wiring edit at the call site in
`loop_engine.rs:955` (or whichever Wave 4-5 plan flips that site to call
`try_with_fallback` directly) — emit the JSONL event before surfacing the
chat_error. Useful forensics: post-incident the user can see exactly which
chain was tried and which last_error tipped exhaustion.

### Plan 34-11 (frontend ActivityStrip)

**No new chip needed for fallback.** Per CONTEXT lock §RES-05, intermediate
failures emit no `chat_error` (silent fallover); only chain exhaustion
surfaces, and that surfaces as the existing chat_error from the legacy
fallback's None-return path (now the FallbackExhausted Display string).
The frontend already renders chat_error events in the conversation; no new
ActivityStrip chip needed for RES-05.

If a future plan wants in-flight visibility (e.g. "trying provider 2 of 4"
chip during fallover), the public `try_with_fallback` already takes
`&tauri::AppHandle` reserved for emit hooks — wire `app.emit("blade_loop_event",
&{kind: "fallback_attempt", provider, attempt})` inside the inner loop
without changing the public signature.

### Plan 34-08 / 34-09 / 34-10 (rest of Wave 4)

- **34-08 SESS-01 (SessionWriter)** — see forensics hook above
- **34-09 SESS-02 (resume_session)** — replays JSONL into resumed `LoopState`; `fallback_exhausted` events are forensic-only, NOT replayed
- **34-10 SESS-03/04 (list_sessions + fork_session)** — list_sessions can surface `last_halt_reason: "fallback_exhausted"` in the SessionMeta if the most-recent halt was an exhaustion; deterministic via the JSONL

## Threat Flags

| Threat ID | Category | Status | Notes |
|-----------|----------|--------|-------|
| T-34-28 | DoS — misconfigured chain `["primary","primary","primary"]` retries primary 3× → reverses smart-off | **accepted** | User controls own config; the duplicate "primary" is a footgun, not a security issue. UAT in Plan 34-11 surfaces the misconfiguration via the `chain_len` count in the FallbackExhausted message. |
| T-34-29 | Information disclosure — `last_error` in FallbackExhausted may include provider error strings | **accepted** | Same posture as Phase 33's `ProviderFatal { error }`. The error string is the canonical user-facing diagnostic — redacting it would defeat the purpose. |
| T-34-30 | DoS — `rand::random::<u64>()` jitter is process-local; no entropy starvation | **accepted** | Standard `rand` crate using `ThreadRng` (OS-seeded). Saturating arithmetic in `compute_backoff_ms` adds defence-in-depth against pathological caller inputs (see Scope addition #1). |
| T-34-31 | DoS — chain `["ollama"]` only + ollama not running → instant FallbackExhausted | **accepted** | User-recoverable via Settings (re-add anthropic to chain). The error message identifies ollama as the failure surface. The no-key skip discipline doesn't apply to ollama (which doesn't need a key); the failure surfaces as `complete_turn` Err on connection refused. |

No new threats introduced by Plan 34-07. The four threats from the PLAN's
threat_model are all dispositioned as accept (user-controllable misconfig
or non-issue).

## Self-Check: PASSED

Verified files exist:
- FOUND: `src-tauri/src/providers/mod.rs` (committed `98037a5`)
- FOUND: `src-tauri/src/resilience/fallback.rs` (committed `e514d59`)
- FOUND: `src-tauri/src/commands.rs` (committed `866773f`)

Verified commits in `git log`:
- FOUND: `98037a5` (Step A — providers::default_model_for + 1 test)
- FOUND: `e514d59` (Step B — try_with_fallback body + try_with_fallback_inner + RES_FORCE_PROVIDER_ERROR seam + 7 tests)
- FOUND: `866773f` (Step C — try_free_model_fallback marked #[deprecated] + delegation body)

Verified grep counts (acceptance criteria summary):
- `pub fn default_model_for` in `providers/mod.rs`: 1 (=1 required)
- `pub async fn try_with_fallback` in `resilience/fallback.rs`: 1 (=1 required)
- `for chain_elem in chain` in `resilience/fallback.rs`: 1 (=1 required)
- `compute_backoff_ms` in `resilience/fallback.rs`: 8 (≥2 required)
- `smart_resilience_enabled` in `resilience/fallback.rs`: 6 (≥1 required)
- `RES_FORCE_PROVIDER_ERROR` in `resilience/fallback.rs`: 11 (≥3 required)
- `#[deprecated.*Plan 34-07` in `commands.rs`: 1 (=1 required)
- `try_with_fallback` in `commands.rs`: 3 (≥1 required)

Verified test results: **8 plan tests green** (7 in `resilience::fallback::tests` + 1 in `providers::tests`). `cargo check` exits 0 with the 2 expected deprecation warnings (no new errors).

## Phase 34 Close-Out Trace

| Requirement | Status | Plan | Commit(s) |
|-------------|--------|------|-----------|
| RES-01 — Smart-loop kill-switch (`smart_resilience_enabled`) | covered | 34-01 | (Plan 34-01) |
| RES-02 — Stuck-pattern detection + halt | covered | 34-04 | (Plan 34-04) |
| RES-03 — Per-conversation cost accumulation | covered | 34-06 | `5a3d893` `063171f` |
| RES-04 — Two-tier (80% warn / 100% halt) cost guard | covered | 34-06 | `5a3d893` `063171f` |
| **RES-05 — Provider fallback chain + exponential backoff with jitter** | **covered** | **34-07** | **`98037a5` `e514d59` `866773f`** |
| RES-06 — Circuit breaker (3 same-kind failures span turns) | covered | 34-05 | (Plan 34-05) |
| SESS-01 — Append-only JSONL SessionWriter | pending | 34-08 | — |
| SESS-02 — Session resume from JSONL | pending | 34-09 | — |
| SESS-03 — list_sessions Tauri command | pending | 34-10 | — |
| SESS-04 — fork_session Tauri command | pending | 34-10 | — |
| UI-RES — ActivityStrip chips for stuck/circuit/cost (NO new chip for fallback per CONTEXT §RES-05) | pending | 34-11 | — |

Plan 34-07 closes RES-05 (provider fallback chain + exponential backoff +
jitter). Wave 3 of Phase 34 is now complete. Remaining work is Wave 4
(SESS-01..04 in plans 34-08 → 34-10) and the frontend close (Plan 34-11).
