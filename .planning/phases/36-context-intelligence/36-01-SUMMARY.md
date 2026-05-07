---
phase: 36-context-intelligence
plan: 1
subsystem: config + intelligence-substrate
tags: [config, six-place-rule, intelligence, tree-sitter, petgraph, scaffold]
status: complete
dependency_graph:
  requires:
    - "Phase 35-01 DecompositionConfig (gold-standard six-place precedent)"
    - "Phase 35-02 decomposition/ scaffold (mirrored module layout)"
  provides:
    - "BladeConfig.intelligence: IntelligenceConfig (5 locked fields, six-place wired)"
    - "src-tauri/src/intelligence/ module root + 6 stub submodules"
    - "tree-sitter family + petgraph crates resolved in Cargo.lock"
  affects:
    - "lib.rs (mod intelligence; declared)"
    - "Cargo.toml + Cargo.lock"
    - "src-tauri/src/config.rs (+141 lines)"
tech_stack:
  added:
    - "tree-sitter 0.22.6"
    - "tree-sitter-typescript 0.21.2"
    - "tree-sitter-rust 0.21.2"
    - "tree-sitter-python 0.21.0"
    - "petgraph 0.6.5"
  patterns:
    - "six-place rule (CLAUDE.md): 5 fields × 6 placements = 30 touch points"
    - "#[serde(default)] field-level + per-field default fns + #[serde(default)] struct-level (legacy-config tolerance, INTEL-01..06 escape-hatch toggles)"
    - "module scaffold pattern (mod.rs re-exports + 6 stubs) mirrored from Phase 35-02 decomposition/"
key_files:
  created:
    - "src-tauri/src/intelligence/mod.rs"
    - "src-tauri/src/intelligence/tree_sitter_parser.rs"
    - "src-tauri/src/intelligence/symbol_graph.rs"
    - "src-tauri/src/intelligence/pagerank.rs"
    - "src-tauri/src/intelligence/repo_map.rs"
    - "src-tauri/src/intelligence/capability_registry.rs"
    - "src-tauri/src/intelligence/anchor_parser.rs"
  modified:
    - "src-tauri/src/config.rs"
    - "src-tauri/src/lib.rs"
    - "src-tauri/Cargo.toml"
    - "src-tauri/Cargo.lock"
decisions:
  - "Mirror Phase 35-01 DecompositionConfig wire-up verbatim — only field name swapped"
  - "Place IntelligenceConfig declaration immediately after DecompositionConfig in config.rs"
  - "Stage all 5 Cargo deps in 36-01 (not deferred to consumer plans) so 36-02..36-07 land code without touching Cargo.toml"
  - "Submodule layout: 1 mod.rs + 6 stubs, each tagged with the requirement it serves"
metrics:
  duration_minutes: 9
  tasks_completed: 3
  files_created: 7
  files_modified: 4
  commits: 3
  tests_added: 3
  tests_pass: "3/3"
  cargo_check_errors: 0
completed_date: "2026-05-07"
requirements_addressed: [INTEL-01, INTEL-02, INTEL-03, INTEL-04, INTEL-05, INTEL-06]
---

# Phase 36 Plan 36-01: IntelligenceConfig + intelligence/ scaffold + tree-sitter/petgraph cargo deps Summary

**One-liner:** Substrate plumbing for Phase 36 — IntelligenceConfig (5 fields covering INTEL-01..06 toggles + repo-map budget + PageRank damping + capability registry path) wired through canonical six-place rule, plus 7-file intelligence/ module scaffold and 5 cargo deps (tree-sitter family + petgraph), no behavior change.

## Six-Place Wire-Up Confirmed

All 6 grep markers satisfied (config.rs):

| Marker | Count | Location |
|--------|-------|----------|
| `pub struct IntelligenceConfig` | **1** | type declaration block (right after DecompositionConfig) |
| `intelligence: IntelligenceConfig` | **4** | DiskConfig field + DiskConfig::default + BladeConfig field + BladeConfig::default |
| `intelligence: disk.intelligence` | **1** | load_config copy site |
| `intelligence: config.intelligence.clone()` | **1** | save_config copy site |
| 5 default fns | **5** | default_tree_sitter_enabled / default_repo_map_token_budget / default_pagerank_damping / default_capability_registry_path / default_context_anchor_enabled |
| `phase36_intelligence_*` test names | **3** | mod tests at end of config.rs |

Total = 6 wire-up placements + 5 default fns + 3 tests, exact mirror of Phase 35-01 DecompositionConfig precedent (5 fields × 6 places = 30 touch points distributed across the file).

There is also a 7th `intelligence:` placement inside the test-module reward-weights round-trip block (`cfg.intelligence.clone()` at the test-only DiskConfig literal, ~line 1934) — required for that pre-existing test to keep compiling; mirrors the analogous `decomposition: cfg.decomposition.clone()` line above it.

## Tests Added (all green)

```
running 3 tests
test config::tests::phase36_intelligence_default_values        ... ok
test config::tests::phase36_intelligence_config_round_trip     ... ok
test config::tests::phase36_intelligence_missing_uses_defaults ... ok
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 733 filtered out; finished in 0.01s
```

Tests cover the three substrate guarantees:

1. **`phase36_intelligence_default_values`** — Asserts the 5 locked CONTEXT defaults: `tree_sitter_enabled=true`, `repo_map_token_budget=1000`, `pagerank_damping=0.85` (within 1e-6), `capability_registry_path` ends in `canonical_models.json`, `context_anchor_enabled=true`.
2. **`phase36_intelligence_config_round_trip`** — Builds a non-default `IntelligenceConfig` (all 5 fields flipped), serialises through `DiskConfig`, parses back, asserts struct equality. Locks the wire format so future refactors can't silently lose a field.
3. **`phase36_intelligence_missing_uses_defaults`** — Parses a legacy 3-field `DiskConfig` JSON (no `intelligence` key) and asserts the loaded value equals `IntelligenceConfig::default()`. The non-negotiable CLAUDE.md guarantee (existing user configs MUST keep loading).

## Cargo Crate Versions Resolved

The plan requested `tree-sitter = "0.22"`, `tree-sitter-typescript|rust|python = "0.21"`, `petgraph = "0.6"`. The actual resolved versions in Cargo.lock:

| Crate | Requested | Resolved |
|-------|-----------|----------|
| tree-sitter | 0.22 | **0.22.6** |
| tree-sitter-typescript | 0.21 | **0.21.2** |
| tree-sitter-rust | 0.21 | **0.21.2** |
| tree-sitter-python | 0.21 | **0.21.0** |
| petgraph | 0.6 | **0.6.5** |

No version bumps required — all 5 crates resolved cleanly at the planned major.minor tracks. `cargo check` exited **0** with only the 13 pre-existing warnings (dead-code on functions in commands.rs / active_inference.rs / vitality_engine.rs / session/log.rs — all from prior phases, not introduced by 36-01).

## intelligence/ Module Scaffold

`/home/arnav/blade/src-tauri/src/intelligence/` — 7 files, all empty except for top-of-file doc comments naming the requirement each will serve:

| File | Lines | Requirement | Filled by Plan |
|------|-------|-------------|----------------|
| `mod.rs` | 29 | module root + `pub fn init()` no-op stub | 36-01 (this plan) |
| `tree_sitter_parser.rs` | 2 | INTEL-01 per-language symbol extraction | 36-02 |
| `symbol_graph.rs` | 4 | INTEL-01 SymbolNode + edge persistence (extends knowledge_graph.rs) | 36-02 |
| `pagerank.rs` | 2 | INTEL-02 personalized PageRank with petgraph | 36-03 |
| `repo_map.rs` | 2 | INTEL-03 budget-bounded map builder + brain.rs injection | 36-04 |
| `capability_registry.rs` | 2 | INTEL-04 + INTEL-05 canonical_models.json loader | 36-05 + 36-06 |
| `anchor_parser.rs` | 2 | INTEL-06 @screen/@file:/@memory: regex extractor | 36-07 |

`mod intelligence;` registered in `src-tauri/src/lib.rs` immediately below `mod decomposition;` (Phase 35) — matches the established phase-marker comment style.

## Adjacent Sub-Struct Cohabitation

The 5 prior config sub-structs (`ContextConfig`, `LoopConfig`, `ResilienceConfig`, `SessionConfig`, `DecompositionConfig`) and the new `IntelligenceConfig` now sit adjacent in config.rs at lines 600–720 (declarations) and inside `DiskConfig`/`BladeConfig`/`load_config`/`save_config` field clusters at the canonical six-place sites. They are independent — no field collisions, no ordering dependencies, no shared default fns. The `mod tests` block has 18 phase-marker tests (3 each for ContextConfig, LoopConfig, ResilienceConfig, SessionConfig, DecompositionConfig, IntelligenceConfig). All green.

## Commits

| Hash | Message |
|------|---------|
| `081bd77` | feat(36-01): add IntelligenceConfig sub-struct + 6-place wire-up (INTEL-01..06) |
| `9049061` | feat(36-01): add intelligence/ module scaffold + lib.rs registration (INTEL-01..06) |
| `fb80601` | feat(36-01): add tree-sitter family + petgraph cargo deps (INTEL-01..02) |

3 atomic commits, one per task, each `git add <specific path>` only — the 188 pre-existing staged-deletion entries in `.planning/phases/...` were NOT swept in.

## Deviations from Plan

**None.** Plan executed exactly as written. Three minor items worth noting (not deviations, just observations):

1. **Test-module DiskConfig literal** — The pre-existing reward-weights round-trip test inside `mod tests` (~line 1934) builds a synthetic `DiskConfig` literal that mirrors the `save_config` body. To keep that test compiling I added `intelligence: cfg.intelligence.clone()` to it, parallel to the existing `decomposition: cfg.decomposition.clone()` line. This is the same maintenance pattern Phase 35-01 followed; counted as "place 6.5" in the wire-up but not a separate deviation.
2. **`#[allow(dead_code)]` on `init()`** — The mod.rs `pub fn init()` is currently a no-op never called from lib.rs setup (Plans 36-02..36-07 will wire it). To suppress the dead-code warning until then I tagged the fn with `#[allow(dead_code)]`, mirroring the pattern used for `safe_slice` in lib.rs. Stub-only, no behavior implication.
3. **Cargo deps required ~2m fresh build** — On first `cargo check` after the Cargo.toml change the tree-sitter family C bindings compiled (~108s), but the second check on the unchanged tree took <2s. No action required; 36-02 onward will reuse the cached artifacts.

## Auth Gates

None. No auth surfaces touched.

## Threat Surface Scan

Reviewed all files modified/created against the plan's threat register:

- **T-36-01** (legacy config missing `intelligence` key) — mitigated by `#[serde(default)]` + `phase36_intelligence_missing_uses_defaults` test (green).
- **T-36-07** (supply-chain risk on new crates) — mitigated by Cargo.lock pinning exact versions; the 5 newly added crate roots (tree-sitter@0.22.6, tree-sitter-typescript@0.21.2, tree-sitter-rust@0.21.2, tree-sitter-python@0.21.0, petgraph@0.6.5) are visible in the lockfile diff for review.

No new threat surfaces introduced beyond what the plan's `<threat_model>` already enumerates. No flags added.

## Next-Wave Plans Unblocked

This substrate plan unblocks every Wave 2/3/4/5 plan in Phase 36:

- **Plan 36-02** — INTEL-01 tree-sitter parser + SymbolNode/SymbolKind schema (mounts on `intelligence/tree_sitter_parser.rs` + `intelligence/symbol_graph.rs`, uses `tree-sitter*` crates, reads `config.intelligence.tree_sitter_enabled`)
- **Plan 36-03** — INTEL-02 personalized PageRank (mounts on `intelligence/pagerank.rs`, uses `petgraph`, reads `config.intelligence.pagerank_damping`)
- **Plan 36-04** — INTEL-03 repo map builder + brain.rs injection (mounts on `intelligence/repo_map.rs`, reads `config.intelligence.repo_map_token_budget`)
- **Plan 36-05** — INTEL-04 canonical_models.json loader (mounts on `intelligence/capability_registry.rs`, reads `config.intelligence.capability_registry_path`)
- **Plan 36-06** — INTEL-05 router.rs capability lookup (mounts on `intelligence/capability_registry.rs`)
- **Plan 36-07** — INTEL-06 @screen/@file:/@memory: anchor parser (mounts on `intelligence/anchor_parser.rs`, reads `config.intelligence.context_anchor_enabled`)

## Self-Check: PASSED

Verified before writing this section:

- `[ -f src-tauri/src/config.rs ]` → FOUND (modified, +141 LOC)
- `[ -f src-tauri/src/intelligence/mod.rs ]` → FOUND
- `[ -f src-tauri/src/intelligence/tree_sitter_parser.rs ]` → FOUND
- `[ -f src-tauri/src/intelligence/symbol_graph.rs ]` → FOUND
- `[ -f src-tauri/src/intelligence/pagerank.rs ]` → FOUND
- `[ -f src-tauri/src/intelligence/repo_map.rs ]` → FOUND
- `[ -f src-tauri/src/intelligence/capability_registry.rs ]` → FOUND
- `[ -f src-tauri/src/intelligence/anchor_parser.rs ]` → FOUND
- Commit `081bd77` → FOUND in `git log`
- Commit `9049061` → FOUND in `git log`
- Commit `fb80601` → FOUND in `git log`
- `cargo test --lib config::tests::phase36_intelligence` → 3 passed, 0 failed
- `cargo check` → 0 errors (only pre-existing warnings)
