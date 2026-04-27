---
phase: 11-smart-provider-setup
plan: 06
subsystem: verify-gates

tags:
  - phase-11
  - verify-gate
  - integration
  - wave-2
  - tooling

requires:
  - phase: 11-smart-provider-setup
    provides: "Plans 11-01 (parser) + 11-02 (probe + config fields) + 11-03 (UI + e2e) + 11-04 (router rewire + event constant) + 11-05 (CapabilityGap + surface registry)"

provides:
  - "scripts/verify-providers-capability.mjs — Phase 11 structural integrity gate (4 hard checks + 1 advisory warning)"
  - "package.json verify:providers-capability script — Gate 20 in the verify:all chain"
  - "package.json test:e2e:phase11 script — Single command running all 11 Phase 11 Playwright specs"
  - "11-MANUAL-TRACE.md — Goal-backward trace mapping each ROADMAP success criterion to implementing plans + automated verify + manual verify"
  - ".planning/migration-ledger.md 4 Phase 11 route rows (unblocked verify:migration-ledger gate)"
  - "10-WIRING-AUDIT.json 12 Phase 11 surface entries (unblocked verify:wiring-audit-shape gate)"

affects:
  - "Phase 12+ — new gate protects Phase 11 structural invariants against regression"
  - "/gsd-verify-work — can read 11-MANUAL-TRACE.md top-to-bottom for goal-backward audit"

tech-stack:
  added: []
  patterns:
    - "ESM Node verify-gate pattern: shebang + node:fs imports + --self-test flag + accumulated failed[]/warnings[] arrays + exit 0 / exit 1 discipline (analog: scripts/verify-wiring-audit-shape.mjs)"
    - "Soft-skip when target file absent: each check returns early with a warning if its input file doesn't exist, so the gate can run during partial-landing states (Wave-0-only, Wave-1-partial) without false FAIL"
    - "Advisory (WARN, non-blocking) for surface-area gaps that are explicitly deferred in a plan summary — the subscriber audit for ROUTING_CAPABILITY_MISSING is a WARN rather than a hard FAIL because Plan 11-04 flagged the UI consumer as a deferred follow-up"
    - "Drift-triggered regression: the gate's 4 checks are falsifiable — rename a field, delete a surface, drop a capability in the registry, and the gate exits 1. Sanity-tested by temporarily renaming tools_provider in config.rs and confirming exit 1."

key-files:
  created:
    - "scripts/verify-providers-capability.mjs (378 lines — ESM Node gate; 4 checks + advisory + --self-test)"
    - ".planning/phases/11-smart-provider-setup/11-MANUAL-TRACE.md (300 lines — 5 success-criterion walkthroughs)"
    - ".planning/phases/11-smart-provider-setup/11-06-SUMMARY.md (this file)"
  modified:
    - "package.json (+2 script entries: verify:providers-capability + test:e2e:phase11; +1 chain extension on verify:all — total 19 → 20 gates)"
    - ".planning/migration-ledger.md (+4 Phase 11 route rows: quickask, voice-orb, meeting-ghost, agents-swarm; totals 82 → 86 / 79 → 83 Pending)"
    - ".planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json (+12 entries: 2 modules + 5 routes + 5 BladeConfig fields — backfill of Phase 11 surface introduced across Plans 11-01, 11-02, 11-05)"

key-decisions:
  - "Verify gate specifies 4 hard checks (per Task 1 action spec) + 1 soft advisory for subscriber coverage. The subscriber check is advisory-only because Plan 11-04 explicitly shipped the emit + TS constant while deferring the UI consumer — the gate must pass today, and the advisory makes the deferred-consumer gap visible to future wiring plans."
  - "Migration-ledger backfill instead of seed:ledger rewrite: `npm run seed:ledger` would have reformatted the entire file (losing curated status metadata like SET-01 / SET-04 and some src.bak path overrides). Adding the 4 missing rows manually preserved the existing curation while closing the orphan-route gate."
  - "Wiring-audit-shape backfill scope: only the minimum needed to unblock the gate (2 modules + 5 routes + 5 config fields) with ACTIVE classifications. A full Phase 10 audit rerun for Phase 11 surface is not in Plan 11-06's scope — this backfill is a regression fix, not a re-audit."
  - "`test:e2e:phase11` uses exact filenames (not globs) so CI without shell expansion (e.g., some npm-lifecycle scripts) works reliably. Matches the convention set by test:e2e:phase2/3/4."

patterns-established:
  - "Phase-N origination of a verify gate joining verify:all — this is the first gate authored by a Phase N > 10 to protect that phase's invariants. Future phases can follow the same shape: ship scripts/verify-<phase-subsystem>.mjs with 3-5 structural checks, append to verify:all chain, document in the phase's manual-trace."
  - "Manual-trace.md as /gsd-verify-work input — the 5-criterion goal-backward doc is a standard Phase 11 output now. It includes Criterion verbatim / Implementing plans / Automated verify commands / Expected evidence / Manual verify steps. Future phases with >= 3 ROADMAP success criteria should ship the same artifact."
  - "Pre-existing gate fixes documented as auto-fix Rule 3 deviations — 2 fixes landed in this plan (migration-ledger orphan-routes + wiring-audit-shape missing-modules), both caused by earlier Phase 11 plans not updating downstream audit/ledger files. Deviations are documented in this summary under Auto-fixed Issues so later audits can trace each fix to its root cause."

requirements-completed:
  - PROV-01
  - PROV-02
  - PROV-03
  - PROV-04
  - PROV-05
  - PROV-06
  - PROV-07
  - PROV-08
  - PROV-09

duration: 50min
completed: 2026-04-20
---

# Phase 11 Plan 06: Verify Gate + E2E Script + Manual Trace — Summary

**Shipped the Phase 11 integrity substrate: a new Node ESM gate (`verify:providers-capability`) joining `verify:all` as gate 20, the `test:e2e:phase11` single-command Playwright runner (11 specs), and a goal-backward manual trace mapping each ROADMAP success criterion to its closing artifacts. Along the way, fixed two pre-existing blockers in sibling gates (migration-ledger + wiring-audit-shape) so `verify:all` exits 0 with 20/20 gates green.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 2 planned (Task 1 verify script, Task 2 package.json + trace) + 2 Rule 3 auto-fixes (migration-ledger + wiring-audit-shape backfill)
- **Files created:** 3 (verify script, manual trace, this summary)
- **Files modified:** 3 (package.json, migration-ledger, 10-WIRING-AUDIT.json)
- **Lines added:** ~820 total (378 verify script + 300 manual trace + 140 audit JSON backfill + 6 ledger rows + 3 package.json edits + summary)

## Accomplishments

- **Gate 20 (`verify:providers-capability`) ships with 4 falsifiable structural checks:**
  1. `src/features/providers/CAPABILITY_SURFACES.ts` has ≥ 2 entries per capability in {vision, audio, long_context, tools}. Current state: 2 per cap — passes.
  2. Every capability has ≥ 1 `<CapabilityGap capability="X">` usage in src/ (excluding CapabilityGap.tsx + CAPABILITY_SURFACES.ts). Current state: all 4 capabilities covered.
  3. All 5 new BladeConfig fields (`provider_capabilities` + 4 `*_provider` Options) occur ≥ 6 times each in `src-tauri/src/config.rs`. Current state: provider_capabilities=14, vision_provider=12, audio_provider=12, long_context_provider=12, tools_provider=12.
  4. `src/lib/events/index.ts` contains the `ROUTING_CAPABILITY_MISSING` constant AND the string `'blade_routing_capability_missing'` (or double-quoted equivalent). Current state: both present.
- **Sanity-drift verified:** temporarily renamed `tools_provider` to `tools_provider_renamed` in config.rs and confirmed the gate exits 1 with `check #3: config.rs field tools_provider occurs 0/6 places`. Restored and reconfirmed exit 0.
- **Advisory (soft WARN) for `ROUTING_CAPABILITY_MISSING` subscriber coverage.** Plan 11-04 shipped the emit site + TS constant, but the UI consumer (toast / card suggesting "Add a vision-capable key") is a deferred follow-up per 11-04-SUMMARY.md §Known Stubs + Next Phase Readiness. The gate emits a WARN but does not fail — this makes the gap visible to future wiring plans without blocking Phase 11 acceptance.
- **`--self-test` flag runs without touching repo state** (regex compile + walker sanity + constants arity) — analog to `scripts/verify-wiring-audit-shape.mjs:346-361`. Used for CI dry-run / agent smoke tests.
- **`test:e2e:phase11` runs all 11 Phase 11 Playwright specs** in one command: 3 from Plan 11-03 (onboarding-paste-card, settings-providers-pane, fallback-order-drag) + 8 from Plan 11-05 (4 capabilities × 2 surfaces each).
- **`verify:all` chain extended** from 19 gates to 20 — `verify:providers-capability` appended after `verify:wiring-audit-shape`. Full chain exits 0 cleanly.
- **Manual trace document** walks each of the 5 ROADMAP Phase 11 success criteria with: criterion verbatim, implementing plans, automated verify commands, expected evidence, manual verify steps. Consumed by `/gsd-verify-work` and future auditors.

## Task Commits

1. **Task 1: Author scripts/verify-providers-capability.mjs** — `97f1380` (feat)
2. **Rule 3 auto-fix: migration-ledger orphan routes** — `d2fa21b` (fix)
3. **Rule 3 auto-fix: 10-WIRING-AUDIT.json Phase 11 surface backfill** — `1c242b2` (fix)
4. **Task 2: package.json + 11-MANUAL-TRACE.md** — `4a6c365` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Migration-ledger orphan routes broke `verify:migration-ledger` (gate 3 in verify:all chain)**

- **Found during:** pre-Task-2 diagnostic run of `npm run verify:all`.
- **Issue:** Plan 11-05 added 4 new palette-hidden route ids (`quickask`, `voice-orb`, `meeting-ghost`, `agents-swarm`) to feature-cluster `index.tsx` files but did not update `.planning/migration-ledger.md`. `scripts/verify-migration-ledger.mjs` correctly flagged 4 `ORPHAN: src/ references route '<id>' but migration-ledger.md has no row` and exited 1. This directly blocked Plan 11-06's success criterion "npm run verify:all exits 0".
- **Fix:** Appended 4 Phase-11 Pending rows to the migration-ledger (`agents-swarm`, `quickask`, `voice-orb`, `meeting-ghost`) with status notes explaining the capability-gap context. Updated Totals (82 → 86 tracked, 79 → 83 Pending). Did NOT run `npm run seed:ledger` because that would have reformatted the entire file and lost curated metadata (SET-01, SET-04 tags, src.bak path overrides).
- **Files modified:** `.planning/migration-ledger.md`
- **Verification:** `npm run verify:migration-ledger` exits 0 (was FAIL). Loaded 93 rows, 26 referenced ids all tracked.
- **Committed in:** `d2fa21b`

**2. [Rule 3 — Blocking] 10-WIRING-AUDIT.json missing Phase 11 surface broke `verify:wiring-audit-shape` (gate 19 in verify:all chain)**

- **Found during:** Task-2 diagnostic run of `npm run verify:all` (after fix #1).
- **Issue:** Plans 11-01 (provider_paste_parser.rs), 11-02 (capability_probe.rs + 5 new BladeConfig fields), and 11-05 (5 palette-hidden routes) collectively added 12 new surface entries that were never backfilled into the Phase 10 audit JSON. `scripts/verify-wiring-audit-shape.mjs` failed all 3 structural invariants (modules.length 178 ≠ 180 .rs files / routes.length 80 ≠ 85 feature-cluster routes / 5 BladeConfig fields missing from config[]) and exited 1.
- **Fix:** Appended 12 entries to `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`: 2 modules (provider_paste_parser, capability_probe) with ACTIVE classification + real Tauri command registrations; 5 routes (quickask, voice-orb, meeting-ghost, agents-swarm, knowledge-full-repo) with palette_visible=false; 5 BladeConfig fields tied to ProvidersPane.tsx / CapabilityPillStrip.tsx as ui_surface. Schema validation first failed on invoked_from paths not matching `^src/.+:[0-9]+$`; corrected by pointing at actual call sites (`src/lib/tauri/config.ts:97` for parse_provider_paste, `src/lib/tauri/config.ts:132` for probe_provider_capabilities).
- **Files modified:** `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`
- **Verification:** `node scripts/verify-wiring-audit-shape.mjs` exits 0 — all 5 checks pass (modules/routes/config/not-wired/dead).
- **Scope note:** This is a minimum-surface backfill, NOT a re-audit. Each new entry is a shape-correct ACTIVE record; full Phase 10 audit depth (backend_entry_points[] enumeration for each module, data_source[] enumeration for each route) is out of scope for Plan 11-06.
- **Committed in:** `1c242b2`

---

**Total deviations:** 2 Rule 3 auto-fixes. Both fixes were directly caused by earlier Phase 11 plans that didn't update downstream audit/ledger files when new surface was added. Documented here so later audits can trace each fix to its root cause.

**Impact on plan:** Zero scope creep. Both fixes were strictly blocking the plan's own success criterion ("npm run verify:all exits 0 (20/20 gates green)"). No architectural changes. No new code beyond the verify gate + trace doc.

## Issues Encountered

- **None in Task 1 or Task 2 directly.**
- During the wiring-audit-shape fix, the Zod schema's regex `^src/.+:[0-9]+$` rejected `invoked_from` values that didn't include a line number. Discovered via schema validation output, fixed by populating the field with real call-site file:line values from the actual TS wrappers.

## Known Stubs

**Advisory: ROUTING_CAPABILITY_MISSING has 0 subscribers in src/.**

- **File:** `src/lib/events/index.ts` line 72 defines `BLADE_EVENTS.ROUTING_CAPABILITY_MISSING: 'blade_routing_capability_missing'`.
- **Reason:** Plan 11-04 explicitly deferred the UI consumer. The emit side is live (commands.rs emits exactly one event per send_message_stream call when no capable provider has a key); the subscribe side (a toast or card suggesting "Add a vision-capable key") is a future-phase wiring target. Deferral documented in 11-04-SUMMARY.md §Known Stubs + §Next Phase Readiness.
- **Gate behavior:** `verify:providers-capability` surfaces this as an advisory WARN (not a hard FAIL) so it doesn't block Phase 11 acceptance. A future plan that wires a subscriber will see the warning silence itself.

No other stubs.

## Threat Flags

None. Plan 11-06 is pure tooling (one Node ESM script + package.json edits + one .md doc + audit/ledger backfill). No runtime code, no user input, no network I/O. Threat model in the plan (T-11-30..33) was accepted / mitigated as designed.

## Next Phase Readiness

- **Phase 11 complete** — all 9 requirements (PROV-01..PROV-09) closed across 6 plans. `npm run verify:all` + `npm run test:e2e:phase11` are the single-command acceptance checks.
- **Phase 12+ can rely on the gate** — any Phase-12+ change that drops a capability surface, renames a BladeConfig field, or deletes the ROUTING_CAPABILITY_MISSING constant will fail `verify:providers-capability` at commit time.
- **Manual trace is the `/gsd-verify-work` input** — the doc walks each ROADMAP success criterion with exact verify commands and manual-step instructions, which is what the verifier reads top-to-bottom.

## Verification Evidence

```
# Verify script runs standalone
$ node scripts/verify-providers-capability.mjs
[verify-providers-capability] OK — check #1 surfaces (vision=2, audio=2, long_context=2, tools=2)
[verify-providers-capability] OK — check #2 CapabilityGap usages (vision, audio, long_context, tools)
[verify-providers-capability] OK — check #3 config 6-place (provider_capabilities=14, vision_provider=12, audio_provider=12, long_context_provider=12, tools_provider=12)
[verify-providers-capability] OK — check #4 event registry (ROUTING_CAPABILITY_MISSING constant + literal)

[verify-providers-capability] Warnings:
  • advisory: ROUTING_CAPABILITY_MISSING has 0 subscribers in src/ (emit is live; UI consumer is a deferred follow-up per 11-04-SUMMARY.md)

[verify-providers-capability] OK
exit 0

# Self-test
$ node scripts/verify-providers-capability.mjs --self-test
[verify-providers-capability] OK — self-test (4 capabilities, 5 fields, regexes compile, walker works)
exit 0

# Drift sanity
$ sed -i 's/\btools_provider\b/tools_provider_renamed/g' src-tauri/src/config.rs
$ node scripts/verify-providers-capability.mjs; echo "exit: $?"
[verify-providers-capability] FAIL: 1 check(s) failed
exit: 1
# (reverted)

# Full chain green
$ npm run verify:all; echo "EXIT: $?"
... (20 gates, all OK) ...
[verify-providers-capability] OK
EXIT: 0
```

- Grep audits:
  - `"verify:providers-capability"` in package.json: 2 matches (script definition + chain entry)
  - `"test:e2e:phase11"` in package.json: 1 match
  - `&& npm run verify:providers-capability` in package.json: 1 match (chain extension)
  - `Criterion 1`..`Criterion 5` headers in 11-MANUAL-TRACE.md: 5 matches
  - `CAPABILITY_SURFACES` in verify-providers-capability.mjs: 3 matches
  - `<CapabilityGap` in verify-providers-capability.mjs: 3 matches
  - `NEW_FIELDS` in verify-providers-capability.mjs: 3 matches
  - `ROUTING_CAPABILITY_MISSING` in verify-providers-capability.mjs: 4 matches
  - `process.exit` in verify-providers-capability.mjs: 5 matches (covers all branches)
  - `--self-test` in verify-providers-capability.mjs: 2 matches
  - `child_process|require\(` in verify-providers-capability.mjs: 0 matches (no shell/CJS escape)
  - scripts/verify-providers-capability.mjs line count: 378 (≥ 180 target from must_haves)
  - .planning/phases/11-smart-provider-setup/11-MANUAL-TRACE.md line count: 300 (≥ 80 target)

## Self-Check: PASSED

Files verified to exist:
- `/home/arnav/blade/scripts/verify-providers-capability.mjs`: FOUND (378 lines, shebang + ESM imports)
- `/home/arnav/blade/.planning/phases/11-smart-provider-setup/11-MANUAL-TRACE.md`: FOUND (300 lines, 5 criterion headers)
- `/home/arnav/blade/package.json`: MODIFIED (verify:providers-capability + test:e2e:phase11 + chain extension all present)
- `/home/arnav/blade/.planning/migration-ledger.md`: MODIFIED (4 Phase-11 rows added)
- `/home/arnav/blade/.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`: MODIFIED (12 entries added)

Commits verified via `git log --oneline`:
- `97f1380` (Task 1 — verify script): FOUND
- `d2fa21b` (Rule 3 fix — migration-ledger): FOUND
- `1c242b2` (Rule 3 fix — audit JSON): FOUND
- `4a6c365` (Task 2 — package.json + manual trace): FOUND

Gate state verified: `npm run verify:all` exits 0 with all 20 gates OK.

---
*Phase: 11-smart-provider-setup*
*Plan: 06*
*Completed: 2026-04-20*
