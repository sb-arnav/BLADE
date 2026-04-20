---
phase: 10-inventory-wiring-audit
plan: 01
subsystem: verify-gate
tags: [audit, verify-gate, json-schema, zod, phase-10, wave-0]

# Dependency graph
requires:
  - phase: 09-polish
    provides: existing verify:all chain (18 gates) that this plan extends without re-ordering
provides:
  - scripts/verify-wiring-audit-shape.mjs Wave 0 integrity gate with 6 subcommands (--self-test, --check=modules|routes|config|not-wired|dead)
  - .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json JSON Schema Draft 2020-12 spec for the audit sidecar
  - package.json verify:wiring-audit-shape npm script + verify:all chain append (gate 19 of 19)
  - zod-based schema validation substrate that downstream Wave 1 plans (02, 03, 04) invoke in their acceptance criteria via --check=<dimension>
affects: [10-02-PLAN, 10-03-PLAN, 10-04-PLAN, 10-05-PLAN, phase-14-WIRE2, phase-15-feature-reachability]

# Tech tracking
tech-stack:
  added: [zod (first live consumer; was in package.json dependencies but had no runtime callers)]
  patterns:
    - "Node ESM verify script with soft-skip WARN when downstream artifact absent (chain-safe during multi-wave rollout)"
    - "zod schema mirror of a JSON Schema file — single source of truth in JSON, runtime validator in JS"
    - "CLI subcommand dispatcher pattern: --self-test + --check=<dim> + default (runs all)"

key-files:
  created:
    - scripts/verify-wiring-audit-shape.mjs
    - .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json
  modified:
    - package.json (added verify:wiring-audit-shape entry; appended && npm run verify:wiring-audit-shape to verify:all chain)

key-decisions:
  - "JSON Schema is the spec; zod mirrors it in JS — Phase 14/15 verify scripts parse JSON Schema; Phase 10's own verifier parses with zod for richer errors"
  - "Soft-skip with WARN on missing audit JSON — lets Wave 0 land the gate before Plan 05 produces the JSON, keeping verify:all green throughout the phase"
  - "routes.file pattern loosened from ^src/features/.+ to ^src/ — onboarding and window-shell routes legitimately live under src/windows/*"
  - "reachable_paths extended symmetrically to modules[] (RESEARCH.md had it routes-only) — closes D-47 contract with zero added complexity"

patterns-established:
  - "Verify-script ESM canonical shape: shebang + header with @see refs + node:fs/path/url imports + ROOT derivation + walk generator + per-check function + CLI dispatcher + [name] OK/FAIL/WARN log prefix (mirrors scripts/verify-emit-policy.mjs)"
  - "Soft-skip gate pattern: when a Wave 0 gate's target artifact doesn't yet exist, log WARN and exit 0 — gate becomes active the moment the artifact lands without requiring a package.json edit"

requirements-completed: [AUDIT-04, AUDIT-05]

# Metrics
duration: ~12 min
completed: 2026-04-20
---

# Phase 10 Plan 01: Wave 0 Verify-Gate Substrate Summary

**Wave 0 integrity gate for 10-WIRING-AUDIT.json — zod-validated, 6 subcommands, chain-appended to verify:all as gate 19 of 19.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 3 (all autonomous, all committed atomically)
- **Files modified:** 3 (2 created, 1 edited)
- **verify:all chain:** 18 → 19 gates
- **verify:all status post-plan:** green end-to-end (new gate runs last; soft-skips with WARN until Plan 05 produces the audit JSON)

## Accomplishments

- **JSON Schema Draft 2020-12 spec committed** — `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` transcribes 10-RESEARCH.md §"JSON Sidecar Schema" verbatim. 7 top-level required keys. file:line pattern enforced everywhere. 4/5 classification enums (modules/config/not_wired have 4; routes has 5 adding `ACTIVE (dev-only)`).
- **Wave 0 verify script authored** — `scripts/verify-wiring-audit-shape.mjs` (416 lines). zod mirror of the JSON Schema, 6 subcommands (`--self-test`, `--check=modules|routes|config|not-wired|dead`, default runs all). All subcommands wired to AUDIT-01..05. Soft-skip WARN path for Wave 0/1 transition.
- **package.json chained** — new `verify:wiring-audit-shape` npm script + `verify:all` extended with `&& npm run verify:wiring-audit-shape` at the end of the chain. No existing entry reordered; gate count 18 → 19.
- **Downstream enabled** — Wave 1 plans (10-02 modules, 10-03 routes, 10-04 config) can now invoke `node scripts/verify-wiring-audit-shape.mjs --check=<dim>` as their acceptance criteria. Plan 05 synthesis output will exercise the full gate chain.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author 10-WIRING-AUDIT.schema.json** — `0c035a0` (feat)
2. **Task 2: Author scripts/verify-wiring-audit-shape.mjs** — `27f6720` (feat)
3. **Task 3: Wire verify:wiring-audit-shape into package.json** — `40168ea` (feat)

## Files Created/Modified

- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` — **NEW** — JSON Schema Draft 2020-12 spec for the `10-WIRING-AUDIT.json` sidecar. 7 top-level required keys, classification enums, file:line patterns.
- `scripts/verify-wiring-audit-shape.mjs` — **NEW** — Node ESM verify script. zod schema mirror. 6 subcommands. Soft-skip WARN when audit JSON absent (keeps chain green during Wave 0/1).
- `package.json` — **MODIFIED** — Added `verify:wiring-audit-shape` script entry + appended `&& npm run verify:wiring-audit-shape` to the end of `verify:all`. Chain now 19 gates deep.

## Decisions Made

**1. JSON Schema is the spec; zod mirrors it in JS.** Downstream Phase 14/15 verify scripts have no zod dependency (Bash + jq preferred for reachability checks); they parse the JSON Schema directly. This plan's verifier uses zod in JS because it gives richer per-row errors than a hand-rolled Draft 2020-12 walker, and zod was already in `package.json` dependencies with zero live consumers (it has its first user now).

**2. Soft-skip with WARN on missing audit JSON.** The Wave 0 gate ships before the audit JSON exists (Plan 05 produces it). Hard-failing the gate would fail `verify:all` for the duration of the phase. Instead, when `10-WIRING-AUDIT.json` is missing, the script logs a WARN and exits 0. The moment Plan 05 writes the file, the same script starts enforcing AUDIT-01..05 with zero configuration change.

**3. `routes.file` pattern loosened.** RESEARCH.md specified `^src/features/.+` but onboarding/window-shell route rows legitimately point into `src/windows/*` (e.g. `src/windows/main/MainShell.tsx`, `src/windows/quickask/main.tsx`). The looser `^src/` still rejects absolute paths and node_modules while allowing legitimate non-feature routes. JSON Schema and zod mirror both use this anchor.

**4. `reachable_paths` extended to modules[].** D-47 (CONTEXT.md) names `reachable_paths` as an ACTIVE-row field. RESEARCH.md only attached it to `routes[]`; symmetry costs nothing and closes the D-47 contract for ACTIVE module rows as well. Added to both JSON Schema and zod schemas.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Defensive `build.rs` exclusion in checkModules()**

- **Found during:** Task 2 (implementing `checkModules`)
- **Issue:** D-49 says "Excludes `build.rs` at crate root" but the canonical build.rs lives at `src-tauri/build.rs` (not under `src-tauri/src/`). The walker is scoped to `src-tauri/src/` so it wouldn't ever see it. However, if someone later places a `build.rs` under `src-tauri/src/<anywhere>/build.rs`, D-49 says it's still excluded.
- **Fix:** Added defensive `if (file.endsWith('/build.rs') || file.endsWith('\\build.rs')) continue;` inside the count loop so D-49 intent is preserved regardless of location.
- **Files modified:** scripts/verify-wiring-audit-shape.mjs
- **Committed in:** 27f6720 (Task 2 commit)

**2. [Rule 2 - Missing critical] JSON parse error separated from schema validation error path**

- **Found during:** Task 2 (main dispatcher)
- **Issue:** The plan's inline code sample wrapped `AuditSchema.parse(JSON.parse(readFileSync(...)))` in a single try block — but a malformed JSON file (SyntaxError) and a schema mismatch (ZodError) are different failure modes. Emitting the same `FAIL: <checkname>` prefix for both would conflate "JSON unparseable" with "check failed".
- **Fix:** Moved JSON.parse + AuditSchema.parse into its own try/catch with label `FAIL: schema validation —`, and guarded downstream subcommand calls with `if (audit)` so a schema-level failure doesn't cascade into 5 false-positive per-check FAIL lines.
- **Files modified:** scripts/verify-wiring-audit-shape.mjs
- **Committed in:** 27f6720 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2 missing-critical — correctness/ergonomics; no scope change)
**Impact on plan:** No scope creep. Both adjustments strengthen the gate's robustness without altering its contract.

## Issues Encountered

None. All three task verifications passed on first run:

- Task 1: `node -e "JSON.parse(...)"` + key-existence assertion — PASS
- Task 2: `node scripts/verify-wiring-audit-shape.mjs --self-test` — PASS (`[verify-wiring-audit-shape] OK — self-test (schema accepts empty-shape fixture, schema file exists)`)
- Task 3: `node -e "..."` assertion + `npm run verify:wiring-audit-shape` — PASS; `npm run verify:all` — PASS end-to-end with the new gate appended.

## Verify Gate Count Baseline

- Pre-plan: `verify:all` chained 18 gates (entries → no-raw-tauri → migration-ledger → emit-policy → contrast → chat-rgba → ghost-no-cursor → orb-rgba → hud-chip-count → phase5-rust → feature-cluster-routes → phase6-rust → phase7-rust → phase8-rust → aria-icon-buttons → motion-tokens → tokens-consistency → empty-state-coverage).
- Post-plan: **19 gates**. `verify:wiring-audit-shape` appended at the end, no existing entry reordered.

## Wave 1 / Downstream Readiness

Wave 1 plans (10-02 modules, 10-03 routes, 10-04 config) can now reference:

- `node scripts/verify-wiring-audit-shape.mjs --check=modules` as AUDIT-01 acceptance
- `node scripts/verify-wiring-audit-shape.mjs --check=routes` as AUDIT-02 acceptance
- `node scripts/verify-wiring-audit-shape.mjs --check=config` as AUDIT-03 acceptance
- `node scripts/verify-wiring-audit-shape.mjs --check=not-wired` as AUDIT-04 acceptance
- `node scripts/verify-wiring-audit-shape.mjs --check=dead` as AUDIT-05 acceptance

These subcommands are soft-skipping today (audit JSON not yet produced) and will begin hard-enforcing when Plan 05 writes `10-WIRING-AUDIT.json`.

Downstream Phase 14/15 scripts that lock against the schema have a stable `$id` reference (`https://blade/.planning/phases/10/wiring-audit.schema.json`) and `schema_version: "1.0.0"` constant — additive schema evolution is supported via minor version bump per RESEARCH.md extension policy.

## Self-Check: PASSED

**Files verified to exist:**

- FOUND: `/home/arnav/blade/.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json`
- FOUND: `/home/arnav/blade/scripts/verify-wiring-audit-shape.mjs`
- FOUND: `/home/arnav/blade/package.json` (modified; `verify:wiring-audit-shape` entry + chain append present)

**Commits verified via `git log --oneline -5`:**

- FOUND: `0c035a0` (Task 1)
- FOUND: `27f6720` (Task 2)
- FOUND: `40168ea` (Task 3)

**Automated verifications executed:**

- `node scripts/verify-wiring-audit-shape.mjs --self-test` → exit 0, `[verify-wiring-audit-shape] OK`
- `node scripts/verify-wiring-audit-shape.mjs` (default, no audit JSON yet) → exit 0, WARN soft-skip
- `node scripts/verify-wiring-audit-shape.mjs --check=modules --check=routes` → exit 0, WARN soft-skip (multi-flag argv parse works)
- `npm run verify:all` → exit 0, 19/19 gates green

---

*Phase: 10-inventory-wiring-audit*
*Completed: 2026-04-20*
