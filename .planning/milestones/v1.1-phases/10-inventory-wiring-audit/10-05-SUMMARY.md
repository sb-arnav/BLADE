---
phase: 10-inventory-wiring-audit
plan: 05
subsystem: audit
tags: [audit, synthesis, wiring, tester-pass, appendix, phase-10, schema-validation, zod]

# Dependency graph
requires:
  - phase: 10-inventory-wiring-audit
    provides: "10-WIRING-AUDIT.schema.json (Plan 01), 10-MODULES.yaml (Plan 02), 10-ROUTES.yaml (Plan 03), 10-CONFIG.yaml (Plan 04); verify-wiring-audit-shape.mjs Wave-0 gate"
provides:
  - "10-WIRING-AUDIT.json canonical sidecar (schema 1.0.0; 178 modules, 80 prod routes, 155 config surfaces, 99 NOT-WIRED backlog rows, 1 DEAD deletion-plan row, 2 DEFERRED_V1_2 rows)"
  - "10-WIRING-AUDIT.md human-readable monolithic audit (5 numbered sections + Summary + Appendix A (7 tester-pass symptoms) + Appendix B + Meta-findings + trailing metadata)"
  - "Phase 14 WIRE2 backlog seed (99 rows, consumable verbatim)"
  - "Phase 14 DEAD deletion plan (1 row: DiskConfig.api_key legacy migration field)"
  - "Phase 15 verify:feature-reachability input (schema 1.0.0 parse contract)"
  - "Appendix A tester-pass evidence map grounding the audit in falsifiable reality (maps all 7 symptoms from notes/v1-1-milestone-shape.md §'Why this framing' to catalog rows)"
  - "Appendix B deferred-to-v1.2 rationale for acting-tentacle commands (M-03 observe-only guardrail scope anchor)"
affects: [phase-11-smart-provider, phase-12-smart-deep-scan, phase-14-wiring-backlog, phase-15-reachability-contract]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hybrid subagent + inline synthesis (D-50): 3 subagent YAMLs → 2 canonical artifacts via one-shot synthesis+render scripts (deleted post-synthesis per Phase 0 precedent)"
    - "Struct-key omission for non-struct config rows (zod schema accepts optional, rejects explicit null)"
    - "Dev-only route exclusion from JSON mirrors verify-script parser gate (the dev-routes spread is invisible to the spread-name regex)"
    - "3-segment command name normalization: plugins::registry::cmd → registry::cmd to satisfy schema pattern ^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$"
    - "Acting-tentacle detection via regex suffix match `(_reply|_post|_deploy|_send|_write|_merge)$` + `deferred to v1.2 — acting capability` rationale stamp"

key-files:
  created:
    - ".planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json (11864 lines; machine-parseable)"
    - ".planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md (709 lines; human-readable)"
    - ".planning/phases/10-inventory-wiring-audit/10-05-SUMMARY.md (this file)"
  modified: []
  deleted:
    - ".planning/phases/10-inventory-wiring-audit/10-MODULES.yaml (intermediate; folded into JSON modules[])"
    - ".planning/phases/10-inventory-wiring-audit/10-ROUTES.yaml (intermediate; folded into JSON routes[] + MD §2b + §2c)"
    - ".planning/phases/10-inventory-wiring-audit/10-CONFIG.yaml (intermediate; folded into JSON config[] + MD §3a-3e)"
    - "scripts/_synthesize-audit.mjs (one-shot Task 1 synthesizer)"
    - "scripts/_render-audit-md.mjs (one-shot Task 2 renderer)"

key-decisions:
  - "Dev-only routes (20 rows) excluded from audit.routes[] in JSON to keep length-gate symmetric with verify-wiring-audit-shape parser (which does not count the dev-routes spread behind import.meta.env.DEV). Dev routes remain documented in MD §2b."
  - "Non-struct config rows (statics, env vars, cargo features, keyring secrets) folded into audit.config[] with namespaced field prefixes (`static::`, `env::`, `cargo_feature::`, `keyring::`) and struct key omitted entirely (not set to null) per schema optional semantics."
  - "3-segment command names (plugins::registry::*, tentacles::*::*) normalized to last-2-segment form (registry::plugin_list) to satisfy the schema's mod::cmd pattern. The generate_handler![] registration in lib.rs uses the last-2-segment form anyway."
  - "Acting-tentacle classification based on regex suffix match on command's last segment: `(_reply|_post|_deploy|_send|_write|_merge)$`. Flagged 2 modules (discord.rs, session_handoff.rs) as DEFERRED_V1_2."
  - "`ACTIVE (internal)` and `ACTIVE (dev-only)` normalized: statics/env_vars `ACTIVE (internal)` → `ACTIVE` in JSON (internal callers are still callers); dev-only routes excluded from JSON entirely (mirror verify script)."
  - "WIRED-NOT-USED config rows count as NOT-WIRED backlog with `6-place-rule gap` deferral_rationale; Phase 14 WIRE2 agenda."

patterns-established:
  - "Phase 10 canonical pattern: .schema.json + .json + .md triple; intermediate YAMLs deleted after synthesis (mirrors Phase 0 .md + .json discipline)."
  - "Synthesis helpers committed per-task (Task 1, Task 2) then deleted in cleanup task — leaves a diff trail for review but no long-term repo noise."

requirements-completed:
  - AUDIT-01
  - AUDIT-02
  - AUDIT-03
  - AUDIT-04
  - AUDIT-05

# Metrics
duration: 18min
completed: 2026-04-20
---

# Phase 10 Plan 05: Wave 2 Synthesis — Inventory & Wiring Audit ships two canonical artifacts

**178-module + 80-prod-route + 155-config-surface audit merged into schema-1.0.0 JSON sidecar + 709-line human-readable Markdown with all 7 tester-pass symptoms mapped to catalog rows in Appendix A and 2 acting-tentacle modules deferred to v1.2 in Appendix B.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-20T15:50:00Z (approx; single sequential executor session)
- **Completed:** 2026-04-20T16:08:00Z
- **Tasks:** 3 (synthesize JSON → render MD → cleanup + final verify)
- **Files modified:** 0 code; 3 created + 5 deleted under `.planning/phases/10-inventory-wiring-audit/` and `scripts/`

## Accomplishments

- **10-WIRING-AUDIT.json (11864 lines)** — machine-parseable audit, schema 1.0.0, validates against 10-WIRING-AUDIT.schema.json via verify-wiring-audit-shape.mjs. Contains 178 modules + 80 prod routes + 155 config surfaces + 99 NOT-WIRED backlog rows + 1 DEAD deletion-plan row + 2 DEFERRED_V1_2 rows.
- **10-WIRING-AUDIT.md (709 lines)** — human-readable monolithic audit with 5 numbered sections (Module Catalog, Route + Palette Catalog, Config Surface Catalog, NOT-WIRED Backlog, DEAD Deletion Plan) + Summary + Appendix A (7 tester-pass symptoms mapped) + Appendix B (DEFERRED_V1_2 rationale) + Meta-findings + trailing metadata.
- **Phase 14 WIRE2 backlog seeded** — 99 rows consumable verbatim (49 modules + 0 routes + 49 config items + 1 cargo feature).
- **Phase 14 DEAD deletion plan** — 1 row: `DiskConfig.api_key` legacy migration field (safe_to_delete: true, keyring-replaced).
- **Appendix A tester-pass evidence** — all 7 symptoms from `notes/v1-1-milestone-shape.md` §"Why this framing" mapped to catalog rows with one-line rationale per symptom.
- **Appendix B deferred-to-v1.2** — 2 acting-tentacle modules (discord.rs, session_handoff.rs) flagged DEFERRED_V1_2 with "deferred to v1.2 — acting capability (M-03 observe-only guardrail)" rationale.

## Task Commits

Each task was committed atomically (per Plan 05 canonical_anchors §Claude's Discretion 3):

1. **Task 1: Synthesize 10-WIRING-AUDIT.json** — `84caa0a` (docs) — merge 3 YAMLs into schema-1.0.0 JSON; 99 not-wired rows; 2 deferred; all 5 verify checks pass
2. **Task 2: Render 10-WIRING-AUDIT.md** — `586414c` (docs) — 5 sections + Appendix A (7 symptoms) + Appendix B + meta-findings; 709 lines
3. **Task 3: Cleanup + final verify** — `4591b3f` (chore) — delete 3 intermediate YAMLs + 2 helper scripts; npm run verify:all = 19/19 green

## Files Created/Modified

**Created (kept):**
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` — canonical machine-parseable sidecar (schema 1.0.0)
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` — canonical human-readable audit

**Created (one-shot, then deleted in Task 3):**
- `scripts/_synthesize-audit.mjs` — Task 1 synthesizer (uses execFileSync + python3/PyYAML, explicit argv, no shell invocation)
- `scripts/_render-audit-md.mjs` — Task 2 renderer (same pattern)

**Deleted in Task 3 (intermediate extraction artifacts):**
- `.planning/phases/10-inventory-wiring-audit/10-MODULES.yaml` (Subagent A output, 4957 lines)
- `.planning/phases/10-inventory-wiring-audit/10-ROUTES.yaml` (Subagent B output, 1668 lines)
- `.planning/phases/10-inventory-wiring-audit/10-CONFIG.yaml` (Subagent C output, 1420 lines)

**Total row counts in final JSON (per-classification breakdown):**

| Dimension | ACTIVE | WIRED-NOT-USED | NOT-WIRED | DEAD | ACTIVE (dev-only) | Total |
|-----------|--------|----------------|-----------|------|-------------------|-------|
| Modules | 129 | 0 | 49 | 0 | — | 178 |
| Routes (prod) | 80 | 0 | 0 | 0 | — | 80 |
| Routes (+ dev-only, MD only) | — | — | — | — | 20 | 20 |
| Config | 104 | 49 | 1 | 1 | — | 155 |

**NOT-WIRED backlog breakdown (99 rows):**

| Owner | Count |
|-------|-------|
| WIRE2 | 97 |
| DEFERRED_V1_2 | 2 |
| Total | 99 |

**Item-type breakdown:**

| item_type | Count |
|-----------|-------|
| module | 49 |
| route | 0 |
| config | 50 (49 WIRED-NOT-USED struct fields + 1 NOT-WIRED cargo feature; env var excluded in this run — none were WIRED-NOT-USED) |
| event | 0 |

**Cross-reference override count: 0** — Subagent A's classifications were already accurate. No modules needed reclassification from NOT-WIRED → ACTIVE after checking against the 458 unique ACTIVE commands in `scripts/verify-phase{5..8}-rust-surface.sh`.

**Appendix A tester-pass evidence confirmation:** all 7 symptoms have at least one catalog row reference (verified via `| N |` row markers in Appendix A table for N=1..7).

**Verify gate count:** 18 baseline → 19 (added `verify:wiring-audit-shape` in Plan 01) → 19/19 green at Plan 05 final verify.

## Decisions Made

See frontmatter `key-decisions`. Six-line executive summary:

1. Dev-only routes excluded from JSON (verify-parser symmetry).
2. Non-struct config surfaces folded into `config[]` with namespaced field prefixes; struct key OMITTED (not null).
3. 3-segment command names normalized to 2-segment form (schema pattern).
4. `ACTIVE (internal)` coerced to `ACTIVE` in JSON.
5. Acting-tentacle regex detection for DEFERRED_V1_2 flag.
6. WIRED-NOT-USED config rows routed to WIRE2 backlog with 6-place-rule gap rationale.

## Deviations from Plan

**1. [Rule 3 — Blocking] Excluded `ACTIVE (dev-only)` routes from audit.routes[]**
- **Found during:** Task 1 (initial verify run)
- **Issue:** Subagent B's YAML contained 100 routes (80 prod + 20 dev-only). Including all 100 in the JSON caused `verify-wiring-audit-shape` `checkRoutes()` to fail because it parses `src/windows/main/router.ts` for `...<name>Routes` spread patterns and the dev-routes spread appears as `...(import.meta.env.DEV ? devRoutes : [])` — a compound expression the regex does not match. The verify parser returns 80; audit.routes.length was 100; mismatch.
- **Fix:** Filter `ACTIVE (dev-only)` classifications out of audit.routes[] in the synthesis script. Dev-only routes remain documented in the Markdown §2b sub-table (which reads directly from the YAML).
- **Files modified:** `scripts/_synthesize-audit.mjs` (added filter line before route row construction)
- **Verification:** `verify-wiring-audit-shape` `OK — routes (80 feature-cluster routes match routes.length)`
- **Committed in:** `84caa0a` (Task 1 commit)

**2. [Rule 3 — Blocking] Normalized 3-segment command names (plugins::registry::*, tentacles::*::*)**
- **Found during:** Task 1 (schema validation)
- **Issue:** 41 command names in MODULES.yaml had 3 path segments (e.g. `plugins::registry::plugin_list`), but the schema regex `^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$` only accepts 2-segment `mod::cmd`. Zod parse failed.
- **Fix:** In the synthesis script's `normalizeCommandName()`, if the 3-segment pattern doesn't match the schema regex, drop to the last 2 segments (`registry::plugin_list`). This is the form lib.rs's `generate_handler![]` registration uses anyway.
- **Files modified:** `scripts/_synthesize-audit.mjs` (normalizeCommandName function)
- **Verification:** `verify-wiring-audit-shape` schema validation passes for all 178 module rows.
- **Committed in:** `84caa0a` (Task 1 commit)

**3. [Rule 2 — Missing Critical] Omitted `struct` key for non-struct config rows (not null-set)**
- **Found during:** Task 1 (designing config fold)
- **Issue:** Plan warned explicitly (critical_instructions #2): zod `struct: z.string().optional()` accepts omission but rejects explicit null. Naively setting `struct: null` for statics/env_vars/cargo_features/keyring_secrets would have caused schema-validation failures.
- **Fix:** In the synthesis script, only conditionally set `row.struct` when `c.struct` is truthy. Non-struct rows never include the key in the object literal.
- **Files modified:** `scripts/_synthesize-audit.mjs` (all 5 config fold loops)
- **Verification:** `verify-wiring-audit-shape` OK — schema accepts all 155 config rows (41 with struct key present, 114 with struct key absent).
- **Committed in:** `84caa0a` (Task 1 commit)

**4. [Rule 3 — Blocking] Switched synthesis helper from shelled command to argv-based spawn**
- **Found during:** Task 1 (initial _synthesize-audit.mjs write)
- **Issue:** PreToolUse security-reminder hook blocked my first Write because it constructed a python command via a template string. That pattern can trigger command injection if an input path contains shell metacharacters.
- **Fix:** Switched to execFileSync('python3', ['-c', script, path], ...) with argv passed as an array — no shell is invoked, no injection surface.
- **Files modified:** `scripts/_synthesize-audit.mjs` (loadYaml function) — later replicated in `scripts/_render-audit-md.mjs`
- **Verification:** Hook approved the Write; script runs cleanly.
- **Committed in:** `84caa0a` (Task 1 commit)

---

**Total deviations:** 4 auto-fixed (2 Rule 3 blocking, 1 Rule 2 missing critical, 1 Rule 3 blocking security-hook). Zero Rule 4 architectural changes.

**Impact on plan:** All auto-fixes were necessary to satisfy the pre-existing verify gate and schema contract. Zero scope creep; plan shipped exactly as specified. The dev-only exclusion is actually a faithful reading of the plan (§5 classifies "Dev-routes spread is gated on import.meta.env.DEV" and says "audit JSON may classify dev-only routes as 'ACTIVE (dev-only)' or exclude them; either outcome is consistent if audit.routes.length matches the union we compute"). We chose exclusion to satisfy the verify script.

## Issues Encountered

None beyond the 4 auto-fixed deviations documented above. No architectural questions, no blockers requiring user input, no runtime-state changes.

## User Setup Required

None — read-only audit phase per D-50. No external service configuration.

## Next Phase Readiness

- **Phase 11 (Smart Provider Setup) ready** — 4 capability-gap config fields (`vision_provider`, `audio_provider`, `long_context_provider`, `tools_provider`) flagged as 6-place-gap WIRED-NOT-USED in §3a; Phase 11 PROV-06/09 consumes these rows directly.
- **Phase 12 (Smart Deep Scan) ready** — §1 surfaces the existing scanner modules (deep_scan.rs, indexer.rs, file_indexer.rs) as ACTIVE; Phase 12 uses the §1 inventory as its upgrade starting point.
- **Phase 14 (Wiring + Deletion) ready** — `not_wired_backlog[]` (99 rows) consumable verbatim; `dead_deletion_plan[]` (1 row) consumable verbatim. `phase_14_owner` field routes each row to the correct Phase 14 sub-plan (WIRE2 / A11Y2 / LOG / DENSITY / DEFERRED_V1_2).
- **Phase 15 (Reachability Contract) ready** — `verify:feature-reachability` parses `10-WIRING-AUDIT.json` with schema_version 1.0.0 lock; contract stable.

No blockers. Plan 05 completes Phase 10 cleanly.

## Self-Check: PASSED

Verified post-write:
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` — FOUND
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` — FOUND
- `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` — FOUND (preserved from Plan 01)
- `.planning/phases/10-inventory-wiring-audit/10-MODULES.yaml` — DELETED (confirmed)
- `.planning/phases/10-inventory-wiring-audit/10-ROUTES.yaml` — DELETED (confirmed)
- `.planning/phases/10-inventory-wiring-audit/10-CONFIG.yaml` — DELETED (confirmed)
- Commit `84caa0a` (Task 1) — FOUND in `git log --oneline`
- Commit `586414c` (Task 2) — FOUND in `git log --oneline`
- Commit `4591b3f` (Task 3) — FOUND in `git log --oneline`
- `npm run verify:all` — exits 0 with 19/19 gates green
- `node scripts/verify-wiring-audit-shape.mjs` — exits 0 with 5/5 checks pass

---
*Phase: 10-inventory-wiring-audit*
*Plan: 05*
*Completed: 2026-04-20*
