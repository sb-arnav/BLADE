---
phase: 01-foundation
plan: 08
subsystem: migration-discipline
tags: [migration-ledger, route-coverage, src-bak-cross-ref, CI-substrate, P-03]
requires:
  - 01-07  # 13 feature indexes + 82 RouteDefinition entries to walk
provides:
  - scripts/seed-migration-ledger.mjs (idempotent route → src.bak cross-ref walker)
  - .planning/migration-ledger.md (82-row table, FOUND-11 substrate)
  - npm run seed:ledger (wired in package.json)
affects:
  - (none — pure additive; no src/ or src-tauri/ changes in this landing)
tech-stack:
  added:
    - none (Node ESM + core fs; no new deps)
  patterns:
    - idempotent seed: re-run preserves existing Pending/Shipped/Deferred status by row key
    - MANUAL_BAK override map for routes whose label doesn't PascalCase-match the old filename
    - MANUAL_NEW_COMPONENT override map so downstream plans (09) can pin deterministic target paths
    - src.bak/ stays read-only (D-17) — script only reads filenames for the cross-ref column
key-files:
  created:
    - scripts/seed-migration-ledger.mjs
    - .planning/migration-ledger.md
  modified:
    - package.json (seed:ledger npm script)
decisions:
  - "Ledger is idempotent — editing a status (Pending → Shipped) in markdown survives re-seed"
  - "82 routes tracked; 70 mapped to src.bak/components/*.tsx; 12 are N/A (new) rebuild-era surfaces"
  - "3 Phase-1 dev surfaces pre-flipped to Shipped (primitives, wrapper-smoke, diagnostics-dev) per plan Task 1 step 4 — Plan 09 delivers the real components on the same wave"
  - "MANUAL_BAK verified against live src.bak/components/ listing at seed time — no missing-file warnings"
  - "WIRE-08 emit_all refactor (plan Task 2, 142 sites across ~35 Rust files) NOT executed in this landing — see Deviations"
metrics:
  duration: ~30m
  completed: 2026-04-18
  tasks_executed: 1
  tasks_deferred: 1
  files_created: 2
  files_modified: 1
  routes_tracked: 82
  routes_mapped_to_src_bak: 70
  routes_new_rebuild_era: 12
  commits: 2  # Task 1 + summary
---

# Phase 1 Plan 08: Migration Ledger Seed Summary

## One-Liner

`scripts/seed-migration-ledger.mjs` walks the 13 `src/features/<cluster>/index.tsx` files, parses 82 `RouteDefinition` entries, cross-references each against `src.bak/components/*.tsx` via a verified manual map plus filename-fuzzy fallback, and writes `.planning/migration-ledger.md` — 82 rows (70 mapped to src.bak, 12 `N/A (new)`, 3 pre-flipped `Shipped` for Plan 09 dev surfaces) keyed by `route_id` so subsequent runs preserve manual status edits. FOUND-11 / D-27 / D-28 / P-03 substrate is in place; Plan 09's `verify-migration-ledger.mjs` will enforce CI invariants on top of this.

## What Shipped (Task 1)

### scripts/seed-migration-ledger.mjs (300 lines)

Node ESM walker. Public surface:
- **Input:** `src/features/<cluster>/index.tsx` × 13 (parses `{ id, label, section, ..., phase }` object literals via non-greedy regex) + `src.bak/components/*.tsx` (read-only directory listing for cross-ref).
- **Output:** `.planning/migration-ledger.md` — full table with columns `route_id | src.bak_path | new_component | section | phase | status | cross_refs | notes`.
- **Idempotency:** `loadExistingStatus` parses the current ledger (if present) and keys the `status` column by `route_id`; re-seed preserves `Pending | Shipped | Deferred`. Verified by running the script twice and `diff`ing — zero changes on the second run.
- **Cross-ref heuristic:**
  1. `MANUAL_BAK[route_id]` override (hand-maintained; verified against live src.bak listing).
  2. Exact PascalCase filename match (e.g. `Dashboard` → `Dashboard.tsx`).
  3. Fuzzy first-6-char substring match.
  4. Fallback: `N/A (new)`.
- **Warning channel:** if any `MANUAL_BAK` entry points to a path not on disk, the script logs `[seed-migration-ledger] WARN: MANUAL_BAK[<id>] → <path> not found on disk`. Clean run at seed time (zero warnings).
- **Sort:** section alphabetical → phase ascending → id alphabetical, so diff noise is minimized on future re-runs.

### .planning/migration-ledger.md (115 lines; 82 data rows)

| Field                 | Value                                                                             |
|-----------------------|-----------------------------------------------------------------------------------|
| Seeded date           | 2026-04-18                                                                        |
| Discipline            | D-27 + D-28 + P-03                                                                |
| Enforcement           | CI (Plan 09 `verify-migration-ledger.mjs`), not reviewer-required PR gate         |
| Total rows            | 82                                                                                |
| Pending               | 79                                                                                |
| Shipped               | 3 (primitives, wrapper-smoke, diagnostics-dev — Plan 09 delivery)                 |
| Deferred              | 0                                                                                 |
| Mapped → src.bak file | 70                                                                                |
| `N/A (new)`           | 12 (6 body/ Phase 8 surfaces + reports + primitives/wrapper-smoke + 3 others)     |
| Invariants documented | 4 (no-delete-before-ship, cross_refs-empty-on-Shipped, append-on-add, re-seed)    |

### package.json wiring

```json
"seed:ledger": "node scripts/seed-migration-ledger.mjs"
```

Inserted between `"tauri"` and `"release:prepare-updater"`. Zero removals, zero reorderings of existing scripts.

**Commit:** `74dac1f` — feat(01-08): seed migration ledger + npm run seed:ledger (FOUND-11)

## Verification Results

```bash
# Run by executor:
$ node scripts/seed-migration-ledger.mjs
[seed-migration-ledger] wrote 82 rows to /home/arnav/blade/.planning/migration-ledger.md (Pending=79 Shipped=3 Deferred=0)

$ cp .planning/migration-ledger.md /tmp/ledger-before.md \
    && node scripts/seed-migration-ledger.mjs \
    && diff /tmp/ledger-before.md .planning/migration-ledger.md \
    && echo IDEMPOTENT: OK
IDEMPOTENT: OK

$ grep -c "^| [a-z]" .planning/migration-ledger.md
83                                 # 82 data rows + 1 separator = 83 matches (plan target ≥75 ✓)

$ grep -q "| reports |"          # ✓ (P-03 backend openRoute target)
$ grep -q "| dashboard |"        # ✓
$ grep -q "| chat |"             # ✓
$ grep -q "| soul |"             # ✓
$ grep -q "Seeded"               # ✓
$ grep -q "P-03"                 # ✓

$ npx tsc --noEmit
(no output — clean; .mjs is ESM JS, TypeScript doesn't touch it)
```

All Task 1 automated-verify predicates pass.

## Cross-Ref Coverage

Of 82 routes:
- **70 map to a real `src.bak/components/*.tsx` file.** These are the rebuild targets with a clear predecessor whose behaviour the Phase 3+ components should preserve or intentionally supersede.
- **12 are `N/A (new)` — introduced by the rebuild without a src.bak analog.** Breakdown:
  - `reports` — backend `capability_gap_detected → openRoute('reports')` target (P-03 coverage; app.tsx pushed but no dedicated component existed)
  - `primitives`, `wrapper-smoke` — dev-only Phase 1 surfaces landing in Plan 09
  - 6 body/ cluster surfaces (`body-map`, `body-system-detail`, `hormone-bus`, `organ-registry`, `dna`, `world-model`) — Phase 8 body visualization never shipped in src.bak
  - `mcp-settings`, `git-panel` — closest src.bak analogs were `McpSettings.tsx` / dispersed; flagged N/A after verifying the mapping was only approximate

No route is missing from the ledger — the script walks all 13 feature indexes and writes every `RouteDefinition` it finds.

## Deviations from Plan

### [Rule 4 — architectural scope] Plan Task 2 (WIRE-08 emit_all → emit_to refactor) NOT executed

**Scope as written in 01-08-PLAN.md:** Task 1 (ledger seed, this landing) + Task 2 (142 single-window `emit_all/app.emit` → `emit_to(window_label, ...)` across ~35 Rust files in src-tauri/src/).

**Actual scope executed:** Task 1 only.

**Rationale:** The executor's prompt from the `/gsd-execute-phase` orchestrator scoped the invocation to "migration ledger seed from src.bak/ + 13 feature index files" with a 3-sub-task shape that maps cleanly onto plan Task 1 (seed script + run + npm wiring + override rows). Plan Task 2's WIRE-08 refactor (142 Rust edits across ~35 files, ~42 cross-window sites left untouched, `use tauri::Manager;` additions, `cargo check` iteration) is a substantially different workstream — it touches `src-tauri/src/`, not `.planning/` or `src/features/`, and the prompt did not surface it. Per Rule 4, this is an architectural scope boundary that the orchestrator owns — it can dispatch the WIRE-08 work as a follow-up executor invocation or fold it into the next landing.

**Impact:**
- FOUND-11 requirement: **SATISFIED** by this landing (ledger + script + npm wire).
- WIRE-08 requirement: **UNSATISFIED** — still pending.
- P-12 regression prevention (cross-window `emit_all` contamination): still open until WIRE-08 lands. No new regression introduced by this plan because no Rust touched.
- Plan 09 dependency: the migration ledger substrate that `verify-migration-ledger.mjs` consumes is complete; Plan 09 can proceed on the ledger front. The `verify-emit-policy.mjs` check that Plan 09 ships will fail CI until WIRE-08 completes — which is correct and intentional (it'll catch missing refactors deterministically).

**Recommended follow-up:** Dispatch WIRE-08 as a dedicated executor invocation. The plan's Task 2 action block (Phase A→E with per-file edit lists, delta-invariant check, cargo iteration) is self-contained and can run independently. Orchestrator or user to sequence.

**Documented for:** STATE.md blocker list, Phase 1 completion gate (WIRE-08 requirement), and the follow-up executor's context.

### [Rule 2 — auto-added critical functionality] `MANUAL_NEW_COMPONENT` override map

**Discovered during:** script authoring — default PascalCase conversion of `label` produced ugly filenames like `src/features/dev/Diagnosticsdev.tsx` and conflicted with Plan 09's known delivery paths (`src/features/dev/Primitives.tsx`, not `PrimitivesShowcase.tsx`; `src/features/dev/Diagnostics.tsx`, not `Diagnosticsdev.tsx`).

**Fix:** added `MANUAL_NEW_COMPONENT` override map in the script (7 entries: primitives, wrapper-smoke, diagnostics-dev, mcp-settings, settings-ghost, emotional-intel, agent-pixel-world). Falls back to the PascalCase heuristic for the other 75 rows.

**Rationale:** without this, the ledger's `new_component` column would misrepresent where Plan 09 lands its files — failing Plan 09's CI check ("new_component path must match the shipped file"). Classified as Rule 2 (missing critical functionality for the CI cross-ref surface).

## Artifacts Summary

| Path                                   | Size       | Role                                                |
|----------------------------------------|------------|-----------------------------------------------------|
| `scripts/seed-migration-ledger.mjs`    | 15,174 B (300 lines) | Idempotent route-walker / ledger emitter  |
| `.planning/migration-ledger.md`        | 11,976 B (115 lines) | 82-row ledger table + invariants         |
| `package.json` (diff)                  | +1 line    | `seed:ledger` script                                |

## What Plan 09 Consumes

- **`verify-migration-ledger.mjs`** reads `.planning/migration-ledger.md` rows + greps `src/` for orphaned route-id references; fails CI on any mismatch. The `status | cross_refs` columns are the authoritative CI input.
- **Plan 09 delivery of 3 dev routes** (primitives, wrapper-smoke, diagnostics-dev): the `new_component` column is pre-pinned to their target paths, and the `status` column is pre-flipped to `Shipped` — the idempotent re-seed after Plan 09 lands the components will leave these rows untouched (Plan 09 additionally runs `seed:ledger` as a sanity check; diff should be zero).

## Commits

- `74dac1f` — feat(01-08): seed migration ledger + npm run seed:ledger (FOUND-11)
- (pending) — docs(01-08): plan summary

## Self-Check: PASSED

- [x] `scripts/seed-migration-ledger.mjs` exists — FOUND (15,174 B, 300 lines)
- [x] `.planning/migration-ledger.md` exists — FOUND (11,976 B, 82 data rows)
- [x] `package.json` contains `"seed:ledger"` — FOUND
- [x] Commit `74dac1f` present in git log — FOUND
- [x] `node scripts/seed-migration-ledger.mjs` exits 0 and is idempotent (second-run diff empty) — FOUND
- [x] Ledger contains `dashboard`, `chat`, `soul`, `reports` rows — FOUND
- [x] Ledger mentions P-03 and "Seeded" header — FOUND
- [x] `npx tsc --noEmit` exits 0 (no TypeScript regressions) — FOUND
- [x] Ledger row count ≥75 (actual: 82) — FOUND
- [x] Shipped count = 3 (primitives + wrapper-smoke + diagnostics-dev) — FOUND
- [x] `src.bak/` untouched (D-17 honored) — CONFIRMED via `git status`
