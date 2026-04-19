---
phase: 06-life-os-identity
plan: 07
subsystem: phase-6-closure
tags: [playwright, verify, dev-isolation-routes, mac-smoke-handoff, sc-1, sc-2, sc-3, sc-4, sc-5]
status: partial-awaiting-mac-smoke
requires:
  - Plan 06-01 (usePrefs extensions + event payloads — lifeOs.*/identity.* keys)
  - Plan 06-02 (life_os.ts + identity.ts wrappers + 16 per-route placeholders)
  - Plan 06-03 (HealthView + FinanceView + GoalView + HabitView + MeetingsView real surfaces)
  - Plan 06-04 (SocialGraphView + PredictionsView + EmotionalIntelView + AccountabilityView)
  - Plan 06-05 (SoulView + PersonaView + CharacterBible + NegotiationView + EditSectionDialog)
  - Plan 06-06 (ReasoningView + ContextEngineView + SidecarView + Kali sub-section)
  - Phase 1..5 Playwright harness (__TAURI_INTERNALS__ shim, __BLADE_TEST_EMIT__,
    blade_route_request event contract — D-114)
  - Phase 5 Plan 05-07 dev-isolation pattern (passthrough components; shim in spec)
provides:
  - tests/e2e/life-os-health-view.spec.ts — SC-1 falsifier (5 stats + streak chip)
  - tests/e2e/life-os-finance-view.spec.ts — SC-2 falsifier (4 KPIs + CSV import)
  - tests/e2e/identity-character-bible.spec.ts — SC-4 pragmatic (bible + deferral)
  - tests/e2e/identity-persona-view.spec.ts — SC-3 + SC-4 approximation (4 tabs + traits)
  - scripts/verify-phase6-rust-surface.sh — 157 Phase 6 Rust commands regression guard
  - scripts/verify-feature-cluster-routes.sh extended — covers 9 life-os + 7 identity
  - src/features/dev/HealthViewDev.tsx, FinanceViewDev.tsx, CharacterBibleDev.tsx,
    PersonaViewDev.tsx — 4 passthrough dev-isolation routes (palette-hidden, DEV-gated)
  - src/features/dev/index.tsx extended with 4 dev route entries (phase=6, paletteHidden)
  - package.json verify:all chain extended with verify:phase6-rust (12 gates total)
affects:
  - Phase 6 success criteria SC-1..SC-4 become falsifiable in CI via Playwright + bash.
  - verify:all regression guard expands to defend the 157-command Phase 6 surface + 34
    feature-route files across Phase 5 + Phase 6 clusters.
  - Dev-only isolation routes permit deterministic per-route Playwright assertions with
    no live Rust state — consistent with the Phase 5 05-07 pattern.
  - Mac-session handoff M-21..M-27 queued for the operator along with the prior
    Phase 1..5 bundled checks (WCAG, smoke, cargo check, provider keyring, etc).
tech-stack:
  added: []  # no new deps; reuse Phase 1..5 @playwright/test harness
  patterns:
    - D-141 real surfaces across all 16 in-scope Phase 6 routes (no ComingSoonSkeleton
      inside the cluster indexes — verify guard enforces this)
    - D-143 single-writer invariant on cluster index.tsx files (unchanged by 06-07)
    - D-144 defensive Rust-surface regression guard via bash grep over lib.rs
    - D-158 Kali sub-section inside SidecarView — flagged for Phase 7 retrospective
    - D-165 existing prefs dotted-keys surface — no new keys in 06-07
    - Plan 05-07 dev-isolation pattern (passthrough components + per-spec shim) reused
      verbatim for the 4 new Phase 6 dev routes (SwarmViewDev / KnowledgeBaseDev style)
    - Phase 1..5 Playwright harness (__TAURI_INTERNALS__.invoke + __BLADE_TEST_EMIT__
      + blade_route_request event contract — D-114)
key-files:
  created:
    - tests/e2e/life-os-health-view.spec.ts
    - tests/e2e/life-os-finance-view.spec.ts
    - tests/e2e/identity-character-bible.spec.ts
    - tests/e2e/identity-persona-view.spec.ts
    - scripts/verify-phase6-rust-surface.sh
    - src/features/dev/HealthViewDev.tsx
    - src/features/dev/FinanceViewDev.tsx
    - src/features/dev/CharacterBibleDev.tsx
    - src/features/dev/PersonaViewDev.tsx
  modified:
    - scripts/verify-feature-cluster-routes.sh  (Phase 6 cluster+file checks appended)
    - package.json                              (verify:phase6-rust added to chain)
    - src/features/dev/index.tsx                (4 new RouteDefinition entries)
decisions:
  - Playwright specs use the existing Phase 1..5 shim pattern (__TAURI_INTERNALS__ +
    __BLADE_TEST_EMIT__ + blade_route_request navigation) rather than the plan-draft
    __TAURI_INVOKE_HOOK__ shape. Reason — the INVOKE_HOOK pattern is described in the
    plan context but never implemented in _base.ts or invokeTyped. The working
    pattern lives in tests/e2e/{agent-detail-timeline,swarm-view-render,
    knowledge-base-search}.spec.ts and is used by 9 shipped specs. Matching the
    shipped pattern keeps the harness one-shot instead of fragmenting it.
  - Dev-isolation components are passthroughs (return <RealComponent />), not
    hook-installing components. Mocking lives in each spec's addInitScript shim, same
    as SwarmViewDev + KnowledgeBaseDev. This avoids dev-only code paths leaking into
    the real route components (T-06-07-01 strengthened — the dev route doesn't need
    to mutate window globals at all; the real routes read data from invokeTyped
    which goes through __TAURI_INTERNALS__.invoke when the shim is installed).
  - Spec URLs use the blade_route_request event dispatch (not hash-URL paths). The
    plan-draft URLs like /#/dev-health-view don't match the app's router — routing
    goes through the ROUTE_MAP lookup after openRoute() is called from the
    BLADE_ROUTE_REQUEST subscriber in useRouter.ts (D-114).
  - verify-phase6-rust-surface.sh enumerates 157 commands (not "150+" as the plan
    headline said — precise count after the D-140 inventory).
  - verify-feature-cluster-routes.sh extended additively: Phase 5 block untouched,
    Phase 6 checks appended. Both phase file lists live in a disjoint KNOWLEDGE_FILES /
    LIFEOS_FILES / IDENTITY_FILES array, each iterated the same way, so a regression
    on either phase produces a clear ERROR line.
  - Mac-session checkpoint M-21..M-27 documented in this SUMMARY rather than treated
    as a "blocker" return — the plan marks Task 3 `checkpoint:human-action`, but
    Auto mode directed executing the automated portion and bundling the Mac items
    with the prior Phase 1..5 handoff (matches STATE.md operator strategy).
metrics:
  duration-minutes: ~15
  completed-date: 2026-04-18
  tasks-completed-automated: 2
  tasks-pending-operator: 1  # Task 3: Mac smoke M-21..M-27 (bundled handoff)
  commits: 2
  files-created: 9
  files-modified: 3
  lines-added: ~1390
---

# Phase 6 Plan 06-07: Phase 6 Closure Summary (Partial — Awaiting Mac Smoke)

Shipped 4 Playwright specs (one per critical Phase 6 SC falsifier), 1 new verify
script (`verify-phase6-rust-surface.sh`), extended `verify-feature-cluster-routes.sh`
to cover the 9+7 Phase 6 routes, and 4 dev-only isolation passthroughs so the specs
can mount each surface deterministically without touching the real Rust backend.

This SUMMARY covers **Tasks 1–2 (automated)**. **Task 3 (Mac smoke M-21..M-27)** is
bundled with the prior Phase 1..5 operator handoff per STATE.md strategy.

## Coverage Mapping: Phase 6 Success Criteria → Observability

| SC | Gate | Observability | Automated? |
|----|------|---------------|------------|
| SC-1 | Any Life OS route renders; streak from streak_* | `tests/e2e/life-os-health-view.spec.ts` asserts `health-view-root` + 5 `health-stat` + `health-streak-chip` | Yes |
| SC-2 | FinanceView + financial_* + CSV import present | `tests/e2e/life-os-finance-view.spec.ts` asserts `finance-view-root` + 4 `finance-kpi` + `finance-import-csv` | Yes |
| SC-3 | Identity renders; SoulView displays bible content | `tests/e2e/identity-character-bible.spec.ts` asserts `character-bible-root` + non-empty content; `tests/e2e/identity-persona-view.spec.ts` asserts persona dossier with 4 tabs | Yes (via CharacterBible + PersonaView; SoulView operator-verified M-24) |
| SC-4 | CharacterBible log + chat thumbs round-trip | `tests/e2e/identity-character-bible.spec.ts` asserts `trait-log-deferred` (D-155 honest deferral); full chat→thumbs→persona round-trip is operator-verified M-25 | Partial (log-deferral spec'd; round-trip on operator) |
| SC-5 | Both clusters registered via feature index exports | `scripts/verify-feature-cluster-routes.sh` asserts `routes` array + lazy imports present in 4 cluster index files | Yes |

## Dev-Isolation Routes (palette-hidden + DEV-gated)

| Route id | Component | Real surface | Spec file |
|----------|-----------|--------------|-----------|
| `dev-health-view` | `HealthViewDev` | `src/features/life-os/HealthView.tsx` | `life-os-health-view.spec.ts` |
| `dev-finance-view` | `FinanceViewDev` | `src/features/life-os/FinanceView.tsx` | `life-os-finance-view.spec.ts` |
| `dev-character-bible` | `CharacterBibleDev` | `src/features/identity/CharacterBible.tsx` | `identity-character-bible.spec.ts` |
| `dev-persona-view` | `PersonaViewDev` | `src/features/identity/PersonaView.tsx` | `identity-persona-view.spec.ts` |

All 4 routes gated via `import.meta.env.DEV` filter in `src/windows/main/router.ts`
(`...(import.meta.env.DEV ? devRoutes : [])`). Vite constant-folds the spread to `[]`
in prod; the dev feature module is tree-shaken out of the prod bundle (T-06-07-01
mitigation retained verbatim from Phase 5 05-07).

## Playwright Shim Pattern (inherits Phase 5 verbatim)

Each new spec installs `window.__TAURI_INTERNALS__.invoke` + `window.__BLADE_TEST_EMIT__`
via `page.addInitScript`, responds to the mocked command names (e.g.
`health_get_today`, `finance_get_snapshot`, `get_character_bible`,
`persona_get_traits`), then emits `blade_route_request` with the dev route id to
navigate. Exact pattern from `tests/e2e/knowledge-base-search.spec.ts` / `swarm-view-render.spec.ts`.

**Mocked commands per spec** (grouped; JSDoc in each spec enumerates the full list):

- `life-os-health-view.spec.ts`: `health_get_today`, `health_get_stats`,
  `health_get_insights`, `health_streak_info`, `streak_get_stats`, `health_get_scan`,
  `health_scan_now`, `health_update_today`, `health_correlate_productivity` (9)
- `life-os-finance-view.spec.ts`: `finance_get_snapshot`, `finance_get_transactions`,
  `finance_get_goals`, `finance_detect_subscriptions`, `finance_generate_insights`,
  `finance_import_csv`, `finance_auto_categorize` (7)
- `identity-character-bible.spec.ts`: `get_character_bible`, `consolidate_character`,
  `consolidate_reactions_to_preferences`, `update_character_section` (4)
- `identity-persona-view.spec.ts`: `persona_get_traits`, `persona_analyze_now`,
  `persona_update_trait`, `persona_get_relationship`, `get_user_model`,
  `get_expertise_map`, `persona_estimate_mood`, `predict_next_need_cmd`,
  `people_list`, `people_suggest_reply_style`, `people_upsert` (11)

## verify:all Chain — 12 Gates (was 11)

```
verify:entries
verify:no-raw-tauri
verify:migration-ledger
verify:emit-policy
verify:contrast
verify:chat-rgba
verify:ghost-no-cursor
verify:orb-rgba
verify:hud-chip-count
verify:phase5-rust
verify:feature-cluster-routes  ← EXTENDED (Phase 5 + Phase 6)
verify:phase6-rust             ← NEW
```

`npm run verify:all` output confirmed all 12 gates green (full log in the commit
message body of `11a0b69`):

- `verify:phase5-rust` — 75 Phase 5 Rust commands registered
- `verify:phase6-rust` — 157 Phase 6 Rust commands registered
- `verify:feature-cluster-routes` — 34 Phase 5 + Phase 6 routes present; all 4
  cluster indexes lazy-import real per-route components

## Operator Mac-Session Handoff — M-21..M-27

Bundled with the prior Phase 1 WCAG + Phase 2 Operator smoke + Phase 3..5 Mac-smoke
operator session (STATE.md strategy: one operator run covers all unresolved
"requires-Mac" checks). Owned by the operator; executor does not block on this.

| ID | What | Run on Mac |
|----|------|-----------|
| M-21 | `npm run tauri dev` launches — main window opens, all 5 windows still launch; navigate to `/health` — HealthView renders without 404 (SC-1 with real data or empty-state); streak chip visible | `npm install && npm run tauri dev` |
| M-22 | Navigate to `/finance` — KPI row renders with 4 cards; transactions list populated (or empty); "Import CSV" button present (SC-2) | UI click |
| M-23 | Import a sample CSV via the Import CSV button → `finance_import_csv` round-trips; transactions appear; "Auto-categorize" runs successfully (SC-2 full round-trip) | UI click + CSV file |
| M-24 | Navigate to `/soul` — SoulView state card + Bible content loads from `get_character_bible` (SC-3 literal) | UI click |
| M-25 | Navigate to `/character` — CharacterBible renders + `trait-log-deferred` card visible. In chat, send a message + click thumbs-up. Navigate back to `/persona` → refreshed trait scores visible (SC-4 chat→thumbs→persona round-trip) | UI interaction |
| M-26 | Navigate to each of: `/goals`, `/habits`, `/meetings`, `/predictions`, `/emotional-intel`, `/accountability`, `/social-graph`, `/persona`, `/negotiation`, `/reasoning`, `/context-engine`, `/sidecar` — each renders without 404; each has live data or an honest empty-state. Kali sub-section on `/sidecar` is collapsed by default with a warning banner (D-158) | UI nav sweep |
| M-27 | `cd src-tauri && cargo check` — still 0 errors. D-65 inheritance regression check (Phase 6 touches no Rust) | Rust build |
| BONUS | `npm run test:e2e` — all Phase 1..5 specs continue to pass; all 4 new Phase 6 specs pass; `npm run verify:all` all 12 gates green | Test runner |

## Orphan Requirements — Phase 6 Retrospective (per DP-3)

Phase 6 covered 16 routes (9 life-os + 7 identity) against 19 requirements in the
ROADMAP (LIFE-01..10 + IDEN-01..09). **Three orphan requirement ids** remain unshipped
and are flagged here for the Phase 6 retrospective scope decision (add new routes in
Phase 7+ Admin or retire the requirements):

| Requirement | Missing surface | Rationale |
|-------------|------------------|-----------|
| LIFE-10 | 10th Life OS route (no Phase 1 stub existed) | Phase 1 shipped 9 stubs not 10; DP-3 analog of Phase 5 orphan. |
| IDEN-08 | 8th Identity route (no Phase 1 stub existed) | Same pattern — Phase 1 shipped 7 identity stubs not 9. |
| IDEN-09 | 9th Identity route (no Phase 1 stub existed) | Same pattern. |

Closing these requires a scope decision outside Phase 6's authority — add new
routes (with matching Rust commands, or defer via ComingSoonSkeleton) or retire the
requirements from ROADMAP. Carry forward into the phase retrospective.

## Deferred Ideas — Phase 9 Polish Candidates (per plan `<deferred>`)

- Exhaustive per-route Playwright coverage (Plan 06-07 ships 4 representative specs;
  one per big SC).
- Richer analytics views (FinanceView chart library, EmotionalIntelView dashboard,
  SocialGraphView force-directed network).
- Drag-drop CSV import, auto-save on identity edits, mobile responsive layouts.
- Trait evolution log literal reader (ROADMAP SC-4 literal; D-155 honest deferral
  until a Rust reader command exists; revisit in Phase 9 polish or a future
  Rust-surface phase).

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 | `e7a670c` | 4 dev-only isolation passthrough components + dev barrel extended |
| 2 | `11a0b69` | 4 Playwright specs + verify-phase6-rust.sh + extend verify-feature-cluster-routes.sh + package.json chain |
| 3 | (pending — operator Mac session) | M-21..M-27 |

## Verification

- `npx tsc --noEmit` — clean (0 errors)
- `npm run verify:all` — all 12 gates green (output above)
- `bash scripts/verify-phase6-rust-surface.sh` standalone — 157/157 registered
- `bash scripts/verify-feature-cluster-routes.sh` standalone — 34/34 routes present

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `__TAURI_INVOKE_HOOK__` pattern does not exist in codebase**

- **Found during:** Task 1 design (reading `_base.ts` + existing dev-route
  components + shipped Playwright specs).
- **Issue:** The plan draft's Task 1 action block defined dev-isolation components
  that install a `window.__TAURI_INVOKE_HOOK__` Map mapping command names to mock
  return values, and cleanup restores the previous hook. The plan said "consumed by
  `_base.ts` invokeTyped (NOT raw invoke bypass)". Reading `_base.ts` reveals no
  such hook — `invokeTyped` simply calls `invoke` from `@tauri-apps/api/core`. All
  existing Phase 1..5 specs use a different mechanism: `page.addInitScript` installs
  `window.__TAURI_INTERNALS__.invoke` (the native-bridge hook Tauri respects) +
  `window.__BLADE_TEST_EMIT__` for synthetic events. The INVOKE_HOOK shape is
  mentioned in several plan docs (Phase 02..06) but never realized in code.
- **Fix:** Dev-isolation components are now passthroughs (same as `SwarmViewDev` +
  `KnowledgeBaseDev`), and each new Playwright spec installs the real
  `__TAURI_INTERNALS__.invoke` shim via `addInitScript` — matching the 9 specs
  already shipped. No dev-only code leaks into window globals; the dev route
  simply mounts the real component.
- **Files affected:** `src/features/dev/HealthViewDev.tsx`, `FinanceViewDev.tsx`,
  `CharacterBibleDev.tsx`, `PersonaViewDev.tsx`, plus the 4 spec files.
- **Commits:** `e7a670c`, `11a0b69`.

**2. [Rule 1 — Bug] Plan draft spec URLs don't match the app router**

- **Found during:** Reading `playwright.config.ts` + `useRouter.ts`.
- **Issue:** The plan draft specs navigated via `page.goto('http://localhost:1420/#/dev-health-view')`
  — a hash-URL style never wired into the app. Routing is triggered by
  `BLADE_ROUTE_REQUEST` events received by the main-window `RouterProvider`
  (`useRouter.ts:114-122`); `openRoute(route_id)` is the sole resolver.
- **Fix:** Specs now do `await page.goto('/')` + `await page.waitForSelector('[data-gate-status="complete"]', {timeout: 15_000})`
  + `await handles.emitEvent('blade_route_request', { route_id: 'dev-health-view' })`.
  Same pattern as `swarm-view-render.spec.ts:187-191`. No new surfaces introduced.
- **Commits:** `11a0b69`.

**3. [Rule 3 — Blocking] Spec header testid assertions reconciled with real route testids**

- **Found during:** Writing the specs + greping shipped route components.
- **Issue:** Plan draft specs used testids like `persona-tab` with `data-tab="model"`
  and `data-active="true"` to assert tab state. Confirmed these exist in the shipped
  `PersonaView.tsx` (lines 86–88) — no change needed. Plan draft's
  `health-stat` / `finance-kpi` / `character-bible-content` / `trait-log-deferred`
  / `persona-trait-card` all match shipped testids per Plan 06-03 + 06-05 SUMMARY
  §"Data Testids Delivered".
- **Fix:** Specs written with exact testids as shipped; no route-side changes
  required.

**4. [Rule 1 — Bug] Plan draft command count "150+" is imprecise; actual is 157**

- **Found during:** Writing the verify script + enumerating the D-140 inventory.
- **Issue:** Plan intro says "150+ Phase 6 Rust commands"; actual count per
  D-140 inventory is 157 (9+3+2+15+6+10+10+11+6+5+8+3+7+1+1+7+6+12+11+5+3+7+3+6).
- **Fix:** Script reports "157 Phase 6 Rust commands" on OK. Not a real divergence
  — planner headline rounded down.

No architectural changes, no Rule 4 checkpoints required.

### Planner-Draft Preserved

- The plan's Task 3 is explicitly a `checkpoint:human-action` for the Mac operator
  session. Auto mode directed executing the automated portion and bundling Mac
  items into the existing operator handoff — this SUMMARY documents that queue
  without blocking.
- All plan must_haves delivered:
  - 4 Playwright specs, 1 new verify script, 1 extended verify script — done
  - 4 dev isolation routes palette-hidden + DEV-gated — done
  - package.json verify:all composition preserved + extended — done
  - Operator M-21..M-27 list explicit run commands — done
  - LIFE-10 + IDEN-08 + IDEN-09 orphan requirements flagged — done

## Threat Model Compliance

| Threat ID | Mitigation applied | Status |
|-----------|--------------------|--------|
| T-06-07-01 (dev route shipped to prod users) | paletteHidden + import.meta.env.DEV + tree-shake in prod + no `no-raw-tauri` ESLint allowance for test files | Preserved verbatim from Phase 5 05-07 |
| T-06-07-02 (spec hangs on missing testid) | 5000ms waitForSelector timeout on each `locator`; 15000ms boot timeout; Playwright global 60000ms test timeout | Enforced in all 4 specs |
| T-06-07-03 (verify script misses a command) | Script enumerates 157 commands explicitly with a `check()` helper + accumulating MISSING array; clear error list on fail | Mitigated |
| T-06-07-04 (extended cluster-routes breaks Phase 5) | Phase 5 block preserved verbatim; Phase 6 block appended with disjoint arrays; new unified OK message | Mitigated — confirmed: `verify:feature-cluster-routes` returns "all 34 Phase 5+6 routes present" |

## Known Stubs

None. The 4 dev-isolation components are passthroughs to real Phase 6 surfaces;
the 4 Playwright specs mock well-typed data against exact Rust wire shapes from
`src/lib/tauri/{life_os,identity}.ts`. `verify-phase6-rust-surface.sh` fails loudly
if any Rust command disappears. No placeholders, no hard-coded empty renders.

## Phase 6 Completion Commit Template (for orchestrator)

```
docs(06): phase 6 substrate complete — 7 plans, ~30 commits; awaiting Mac session M-21..M-27
```

Phase 6 ships 35 commits across 7 plans (01..07):
- 06-01: usePrefs + event registry
- 06-02: life_os.ts + identity.ts wrappers + 16 placeholders
- 06-03: 5 Life OS-A real surfaces (Health / Finance / Goal / Habit / Meetings)
- 06-04: 4 Life OS-B real surfaces (SocialGraph / Predictions / EmotionalIntel / Accountability)
- 06-05: 4 Identity-A real surfaces (Soul / Persona / CharacterBible / Negotiation)
- 06-06: 3 Identity-B real surfaces (Reasoning / ContextEngine / Sidecar + Kali)
- 06-07: 4 Playwright specs + verify:phase6-rust + extended cluster-routes verify + 4 dev isolation routes

## Next Actions

1. **Operator Mac session** — run M-21..M-27 bundled with the prior Phase 1..5
   operator handoff. On pass, proceed to Phase 7 planning.
2. **STATE.md / ROADMAP.md updates** — left untouched per executor instruction.
   Orchestrator or operator updates:
   - STATE.md: mark Phase 6 complete (after operator pass); add D-139..D-165 to
     the locked decisions block; increment commit counter to ~35.
   - ROADMAP.md §"Phase 6": flip status → Shipped (after operator pass); flag
     LIFE-10 / IDEN-08 / IDEN-09 as orphans in the Coverage Verification block.
   - REQUIREMENTS.md: mark LIFE-01..09 + IDEN-01..07 complete (post-operator).
3. **Phase 7 planning** — kicks off after operator Mac session passes. Consider
   re-homing Kali sub-section (D-158 divergence flag) and deciding orphan
   requirements scope.

## Self-Check: PASSED

Verified artifacts exist:
- `src/features/dev/HealthViewDev.tsx` FOUND (26 lines, passthrough)
- `src/features/dev/FinanceViewDev.tsx` FOUND (25 lines, passthrough)
- `src/features/dev/CharacterBibleDev.tsx` FOUND (24 lines, passthrough)
- `src/features/dev/PersonaViewDev.tsx` FOUND (26 lines, passthrough)
- `src/features/dev/index.tsx` MODIFIED (4 new RouteDefinition entries, lazy-loaded)
- `tests/e2e/life-os-health-view.spec.ts` FOUND (full shim + 3 assertions)
- `tests/e2e/life-os-finance-view.spec.ts` FOUND (full shim + 3 assertions)
- `tests/e2e/identity-character-bible.spec.ts` FOUND (full shim + 3 assertions)
- `tests/e2e/identity-persona-view.spec.ts` FOUND (full shim + 4 assertions)
- `scripts/verify-phase6-rust-surface.sh` FOUND (executable; 157 commands)
- `scripts/verify-feature-cluster-routes.sh` MODIFIED (Phase 6 block appended)
- `package.json` MODIFIED (verify:phase6-rust in verify:all chain)

Verified commits exist:
- `e7a670c` — feat(06-07): add 4 dev-only isolation routes for Phase 6 Playwright specs
- `11a0b69` — test(06-07): 4 Phase 6 Playwright specs + verify-phase6-rust + extend cluster-routes

Verified gates:
- `npm run verify:all` — 12/12 green
- `npx tsc --noEmit` — 0 errors
- `bash scripts/verify-phase6-rust-surface.sh` — 157 commands registered OK
- `bash scripts/verify-feature-cluster-routes.sh` — 34 routes present OK

Mac smoke M-21..M-27 pending — queued with prior bundled operator handoff.
