---
phase: 36-context-intelligence
plan: 6
subsystem: router/capability-resolution
tags: [intelligence, capability-registry, router, vision-routing, registry-first, capability-probe-fallback, intel-05]
status: complete
dependency_graph:
  requires:
    - "Phase 36-05 intelligence::capability_registry::get_capabilities (registry-first lookup)"
    - "Phase 36-05 INTEL_FORCE_REGISTRY_MISS thread-local seam (fault-injection for the fallback test)"
    - "Phase 36-05 canonical_models.json bundled registry (21 models, schema v1)"
    - "Phase 11-04 router.rs select_provider 3-tier resolution + find_capable_providers + build_capability_filtered_chain primitives"
    - "Phase 11-02 capability_probe::infer_capabilities + ProviderCapabilityRecord type"
  provides:
    - "router::cap_for(capability, provider, model, rec, config) -> bool registry-first capability resolver"
    - "Registry-first verdict in find_capable_providers (the candidate enumerator) and build_capability_filtered_chain (the fallback chain builder)"
    - "Probe-fallback path byte-equivalent to pre-Plan-36-06 behavior under INTEL_FORCE_REGISTRY_MISS=true"
    - "ROADMAP success criterion #4 lock — vision query auto-elevates to a vision-capable model when the user's primary lacks vision"
  affects:
    - "src-tauri/src/router.rs (+97 net LOC: cap_for helper + 3 phase36_intel_05_* tests + refactored filter call sites)"
tech_stack:
  used:
    - "intelligence::capability_registry::get_capabilities (registry consultation)"
    - "intelligence::capability_registry::INTEL_FORCE_REGISTRY_MISS (thread-local seam)"
    - "providers::default_model_for(provider) (registry lookup model resolution for fallback_providers entries without a probe record)"
    - "tempfile 3 + serde_json 1 (test fixture registry on disk)"
  patterns:
    - "Registry-first / probe-fallback dispatch via single helper (cap_for) — both call sites in router.rs converged on it"
    - "Lying probe record vs truthful registry test pattern: tests inject ProviderCapabilityRecord with deliberately-wrong flags, registry corrects the verdict"
    - "Stale long_context probe test: probe record long_context=false vs registry context_length=131_072 (≥100k). Registry wins, derivation is consistent with capability_probe::infer_capabilities (≥100k threshold)"
    - "Test-isolation: explicit INTEL_FORCE_REGISTRY_MISS.set(false) at test start AND set(false) after the seam-test body so cargo's per-test thread reuse never leaks the fault"
key_files:
  modified:
    - "src-tauri/src/router.rs (+63 / -34 = +29 net LOC for the rewire; +315 LOC tests block; net +344 LOC over Plan 36-05 baseline)"
decisions:
  - "select_provider's outer signature DID NOT need a &BladeConfig parameter added — find_capable_providers and build_capability_filtered_chain already take &config, so the registry lookup plumbed through their existing config plumbing. The 'add &BladeConfig param' fallback path mentioned in the plan body was unnecessary; the 25+ resolve_provider_for_task call sites are unaffected."
  - "Single helper cap_for(capability, provider, model, rec, config) replaces the inline match expression in two places. Behavior: registry-first; if registry returns None, fall through to the rec.{vision|audio|tool_calling|long_context} read. This collapses the diff to 2 call sites instead of duplicating the registry branch in each."
  - "Registry's `tool_use` field maps to the router's `tools` capability arm; `long_context` is derived from `context_length >= 100_000` (matches capability_probe::infer_capabilities threshold rule for symmetry)."
  - "build_capability_filtered_chain step 2 (user-ordered fallback_providers) needed a model resolution to call get_capabilities. The probe record is preferred when present; falls back to providers::default_model_for(prov) so registry-only entries (no probe ever ran) are still reachable. Behavior on the legacy probe path is unchanged: when rec is None, the prior code returned String::new() — now it returns default_model_for which is strictly more useful and never exercised by the legacy path under FORCE_REGISTRY_MISS=true (cap_for's inner else still returns false when rec is None, regardless of model_for_lookup)."
  - "tempfile is already a dev-dependency from Plan 36-05; no Cargo.toml change needed for the new tests."
  - "The 3rd test (long_context model selection) was added beyond the plan's 2-test baseline because the plan's must-haves list it explicitly: phase36_intel_05_router_picks_correct_model_for_long_context_task. All 3 green."
metrics:
  duration_minutes: 22
  tasks_completed: 1
  files_created: 0
  files_modified: 1
  commits: 2
  tests_added: 3
  tests_pass: "3/3 (phase36_intel_05_*); 34/35 router::* green overall (1 pre-existing failure)"
  cargo_check_errors: 0
completed_date: "2026-05-07"
requirements_addressed: [INTEL-05]
---

# Phase 36 Plan 36-06: router.rs consumes registry + tier-1 rewire (INTEL-05) Summary

**One-liner:** Lands INTEL-05 — `router.rs::find_capable_providers` and `router.rs::build_capability_filtered_chain` now consult `intelligence::capability_registry::get_capabilities` BEFORE the probe-populated `ProviderCapabilityRecord` HashMap on `BladeConfig`. The probe path stays byte-equivalent for registry-miss cases (substring-matched OpenRouter models, custom base_url, Ollama, INTEL_FORCE_REGISTRY_MISS seam fires). Three regression tests lock the contract: registry beats lying probe records, `INTEL_FORCE_REGISTRY_MISS` round-trips through the new code, and `context_length≥100_000` derives `long_context=true` even when the probe record is stale.

## What Shipped

### `cap_for(capability, provider, model, rec, config) -> bool` helper

Single resolver that:

1. Calls `capability_registry::get_capabilities(provider, model, config)`.
2. If `Some(reg_caps)`: returns `reg_caps.{vision|audio|tool_use|context_length≥100_000}` for the requested capability arm.
3. Else: returns `rec.map(|r| r.{vision|audio|tool_calling|long_context}).unwrap_or(false)` — the legacy probe-record read.

This is the entire INTEL-05 wedge — both `find_capable_providers` and `build_capability_filtered_chain` now route through it. `select_provider`'s outer return tuple `(provider, api_key, model, fallback_chain, capability_unmet)` is unchanged; the 25+ `resolve_provider_for_task` call sites see no API delta.

### Refactored `find_capable_providers`

```rust
fn find_capable_providers(capability: &str, config: &BladeConfig) -> Vec<(String, String)> {
    config
        .provider_capabilities
        .iter()
        .filter(|(prov, rec)| cap_for(capability, prov, &rec.model, Some(rec), config))
        .map(|(prov, rec)| (prov.clone(), rec.model.clone()))
        .collect()
}
```

Iteration source unchanged (still `config.provider_capabilities` for candidate enumeration). Capability VERDICT now goes through `cap_for`. Registry overrides any "lying" probe record on a per-(provider, model) basis.

### Refactored `build_capability_filtered_chain`

Step 1 (probe-record iteration) and Step 2 (user-ordered `fallback_providers` iteration) both filter through `cap_for`. Step 2 additionally resolves `model_for_lookup` via `rec.model.clone()` if a probe record exists, else `providers::default_model_for(prov).to_string()` so registry-only entries (no probe ever ran) are still candidates.

The `seen` HashSet dedup, `get_provider_key` empty-key gate, and primary-exclusion semantics are preserved verbatim — only the capability boolean shifted source.

## Tests Added (3/3 green)

```
running 3 tests
test router::phase36_intel_05_tests::phase36_intel_05_router_uses_registry_first ... ok
test router::phase36_intel_05_tests::phase36_intel_05_router_falls_back_to_probe_on_registry_miss ... ok
test router::phase36_intel_05_tests::phase36_intel_05_router_picks_correct_model_for_long_context_task ... ok

test result: ok. 3 passed; 0 failed
```

### Test 1 — `phase36_intel_05_router_uses_registry_first`

Setup: `ProviderCapabilityRecord` for groq/llama-3.3-70b-versatile claims **vision=true** (lying record). The fixture registry says **vision=false** for the same (provider, model) tuple.

Assertion: `find_capable_providers("vision", &cfg)` does NOT contain groq. `build_capability_filtered_chain("vision", "anthropic", &cfg)` also excludes groq. Anthropic (truthful record agreeing with registry) DOES surface.

Locks: registry verdict supersedes the probe-populated cache for known (provider, model) pairs.

### Test 2 — `phase36_intel_05_router_falls_back_to_probe_on_registry_miss`

Setup: identical to Test 1. THEN `INTEL_FORCE_REGISTRY_MISS.with(|c| c.set(true))`.

Assertion: with the seam active, `find_capable_providers("vision", &cfg)` DOES contain groq (the lying record drives the answer because the registry returns None for everything). The chain builder also surfaces groq. Test cleans up the seam (`set(false)`) before exiting.

Locks: legacy probe path is byte-equivalent under the fault-injection seam — no behavioral regression for OpenRouter substring-matched / custom base_url / Ollama / unknown-provider lookups (none of which are in the registry).

### Test 3 — `phase36_intel_05_router_picks_correct_model_for_long_context_task`

Setup: `ProviderCapabilityRecord` for groq/llama-3.1-8b-instant claims **long_context=false** (stale Phase 11-style probe record). The fixture registry says **context_length=131_072** (≥100_000 → derived long_context=true).

Assertion: `find_capable_providers("long_context", &cfg)` contains groq. The chain builder surfaces groq.

Locks: derivation rule (`reg_caps.context_length >= 100_000`) is wired correctly — matches `capability_probe::infer_capabilities`'s `ctx >= 100_000` threshold for behavioral symmetry.

## Pre-existing test failure (out of scope)

`router::tests::select_provider_tier2_task_routing` (line 543, "creative task should honor task_routing.creative") fails at the master HEAD `4166de4` AND at the parent commit `ae9da76` (the RED commit, before any GREEN changes were applied). The failure is a test-isolation flake driven by keyring override leakage between tests: the test expects `prov == "groq"` but the suite's earlier execution leaves `groq` without a keyring override at the moment this test runs. The failure is **NOT introduced by Plan 36-06**.

Verification: a `git stash` + `cargo test --lib router::tests::select_provider_tier2_task_routing` run against commit `ae9da76` (post-RED, pre-GREEN, no router.rs behavior changes) reproduced the same failure. Filed under deferred items; out of Plan 36-06's scope-boundary.

## select_provider signature decision

The plan body raised a question: "If `config: &BladeConfig` isn't in select_provider's signature, EITHER add it as a param (preferred) OR plumb a snapshot via a thread_local."

**Resolution:** select_provider already accepts `&config`, and so do `find_capable_providers` and `build_capability_filtered_chain`. The registry lookup `get_capabilities(prov, model, config)` plumbed through existing parameters. **No signature changes were required** anywhere in router.rs. The 25+ `resolve_provider_for_task` call sites and the single `select_provider` call site in `commands.rs::send_message_stream` are unaffected.

## INTEL_FORCE_REGISTRY_MISS seam round-trip

Plan 36-05 declared the seam; Plan 36-06 exercises it inside `cap_for` via `get_capabilities`'s short-circuit. Test 2 above proves the round-trip works: setting the seam → `get_capabilities` returns None → cap_for falls through to the rec read → router's behavior matches pre-Plan-36-06 byte-for-byte.

## Probe-fallback parity check

The else-branch of `cap_for` is byte-equivalent to the pre-Plan-36-06 inline match expression in `find_capable_providers` and `build_capability_filtered_chain`. Diff:

```
- "vision" => rec.vision,
- "audio" => rec.audio,
- "tools" => rec.tool_calling,
- "long_context" => rec.long_context,
- _ => false,
+ rec.map(|r| match capability { /* same arms */ }).unwrap_or(false)
```

The `Option<&ProviderCapabilityRecord>` wrapping accommodates Step 2 of the chain builder where the lookup may miss; the `unwrap_or(false)` matches the prior `rec.map(...).unwrap_or(false)` shape exactly.

## Behavioral divergence notes

The registry-vs-probe divergence is the entire point of INTEL-05. Concrete cases the registry now overrides:

1. **Stale probe records** — A probe ran in Phase 11 against a provider that has since released a new vision-capable model variant; the canonical_models.json (user can edit + reload via Tauri command) is the new source-of-truth.
2. **Hand-edited registry overrides** — The user edits `blade_config_dir/canonical_models.json` to flip a flag; the router immediately consumes the verdict on the next chain build (mtime-based reload from Plan 36-05).
3. **Capability lies in cached records** — If a transient probe response was misclassified at probe time, the registry corrects without requiring a re-probe.

Threat T-36-35 ("registry says vision=false on the active model → chain elevates → user gets DIFFERENT model than configured") is the desired vision-routing transparency behavior — locked by Test 1.

## Deviations from plan

- **Plan listed 2 tests, shipped 3.** The 3rd (long_context model selection) is in the plan's must_haves list explicitly; we shipped all three. None failed.
- **`select_provider` signature unchanged.** Plan body floated adding `&BladeConfig` as a param — turned out unnecessary because `find_capable_providers` and `build_capability_filtered_chain` already had it.
- **Single helper `cap_for` instead of inline branch in two places.** Plan body showed an inline `if let Some(reg_entry) = ... { ... } else { ... }` block; we collapsed both call sites onto one helper for less duplication and a smaller diff. Behavior identical.
- **Step 2 of the chain builder gained a `default_model_for` fallback for the registry lookup model.** Pre-Plan-36-06 used an empty String when `rec` was None; we now compute a sensible model id so the registry lookup can succeed when the probe never recorded a model. Functionally a tiny widening, intentionally chosen to make registry-only entries reachable in fallback chains.
- **Auto-fixed Rule 1/2/3 deviations:** None. The plan was structurally accurate; only the simplifications above were applied (decisions, not deviations).

## Threat surface scan

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. The registry file (`canonical_models.json` in `blade_config_dir`) remains user-editable per the existing T-36-33 disposition (accept) from Plan 36-05. No new threat flags.

## Commits

```
ae9da76  test(36-06): add failing tests for registry-first capability check (INTEL-05)
4166de4  feat(36-06): rewire router.rs to consume canonical_models.json registry first (INTEL-05)
```

## Self-Check: PASSED

- `src-tauri/src/router.rs` — FOUND (modified; cap_for helper present at ~line 308; 3 phase36_intel_05_* tests at the file tail)
- Commit `ae9da76` — FOUND in `git log`
- Commit `4166de4` — FOUND in `git log`
- `cargo check` exits 0 (only pre-existing warnings)
- `cargo test --lib router::phase36_intel_05_tests` — 3/3 pass
- `cargo test --lib router` — 34/35 pass (1 pre-existing tier2_task_routing flake at HEAD)
- Registry-first branch grep-verifiable: `grep "capability_registry::get_capabilities" router.rs` returns the call inside `cap_for`
- INTEL_FORCE_REGISTRY_MISS seam grep-verifiable inside the test module
- 25+ `resolve_provider_for_task` call sites unaffected — no signature changes anywhere in router.rs

## Next plan

**Plan 36-07** — anchor parser + commands.rs integration (INTEL-06). The router-side capability resolution is now registry-first; Plan 36-07 closes the loop by wiring the anchor extraction and using the registry from the chat command surface to make the runtime UAT (vision query → vision-capable model surfaces in the UI) observable.
