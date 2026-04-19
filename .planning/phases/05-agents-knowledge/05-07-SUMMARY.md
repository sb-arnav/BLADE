---
phase: 05-agents-knowledge
plan: 07
subsystem: playwright-verify-mac-handoff
status: partial
tags: [phase-5, playwright, verify-scripts, dev-routes, mac-handoff, sc-falsifiers]
requires:
  - Plan 05-03 (AgentDashboard + AgentDetail + useAgentTimeline selectors)
  - Plan 05-04 (SwarmView + SwarmDAG + SwarmNode selectors)
  - Plan 05-05 (KnowledgeBase grouped-search selectors + D-138 labels)
  - Plan 05-06 (knowledge cluster B selectors — consumer spec parity)
  - Phase 4 Plan 04-07 dev-route pattern (VoiceOrbDev / GhostDev / HudDev)
  - Phase 1-4 __TAURI_INTERNALS__ + __BLADE_TEST_EMIT__ Playwright harness
provides:
  - tests/e2e/agents-dashboard.spec.ts — SC-1 AgentDashboard real-surface falsifier
  - tests/e2e/agent-detail-timeline.spec.ts — SC-2 real-time timeline falsifier (WIRE-05)
  - tests/e2e/swarm-view-render.spec.ts — SC-1 explicit DAG render falsifier
  - tests/e2e/knowledge-base-search.spec.ts — SC-4 D-138 3-group falsifier
  - scripts/verify-phase5-rust-surface.sh — 75-command D-119 inventory regression guard
  - scripts/verify-feature-cluster-routes.sh — 18-route + lazy-import + no-ComingSoonSkeleton guard
  - 3 dev-only isolation routes (AgentDetailDev / SwarmViewDev / KnowledgeBaseDev)
  - package.json verify:all now composes 11 gates (was 9)
affects:
  - Mac-session operator handoff now carries M-14..M-20 (bundled with Phase 1-4 items)
  - AGENT-10 + KNOW-10 orphan requirements surfaced for Phase 5 retrospective (DP-3)
tech-stack:
  added: []  # zero new deps (D-119, D-02 discipline)
  patterns:
    - __TAURI_INTERNALS__ invoke shim + __BLADE_TEST_EMIT__ event emit (Phase 2+4 harness, re-used verbatim)
    - addInitScript-installed mock dispatcher — dev routes stay passthrough
    - blade_route_request channel for navigating to paletteHidden dev routes (Phase 4 pattern)
    - usePrefs precondition injection in AgentDetailDev (pins agents.selectedAgent='test-agent-1')
    - expect.poll for rAF-flushed timeline assertions (handles 1-2 frame commit latency)
    - bash verify scripts with explicit command inventory enumeration (D-123 defensive)
    - comment-stripped sed pipe before grep to avoid header-prose false-positives in verify-feature-cluster-routes.sh
key-files:
  created:
    - src/features/dev/AgentDetailDev.tsx
    - src/features/dev/SwarmViewDev.tsx
    - src/features/dev/KnowledgeBaseDev.tsx
    - tests/e2e/agents-dashboard.spec.ts
    - tests/e2e/agent-detail-timeline.spec.ts
    - tests/e2e/swarm-view-render.spec.ts
    - tests/e2e/knowledge-base-search.spec.ts
    - scripts/verify-phase5-rust-surface.sh
    - scripts/verify-feature-cluster-routes.sh
    - .planning/phases/05-agents-knowledge/05-07-SUMMARY.md
  modified:
    - src/features/dev/index.tsx
    - src/windows/main/router.ts
    - package.json
decisions:
  - "AutoFix Rule 3 — adapt to actual harness. Plan prose referenced
    __TAURI_EMIT__ + __TAURI_INVOKE_HOOK__ hooks baked into src/lib/tauri/_base.ts.
    Those hooks do NOT exist; Phases 2-4 use __TAURI_INTERNALS__ + __BLADE_TEST_EMIT__
    installed via page.addInitScript. Specs adopt the actual harness pattern —
    dev routes become passthrough mounts, mocking lives in each test's shim."
  - "Navigation to paletteHidden dev routes uses blade_route_request channel,
    matching Phase 4 Plan 04-07 pattern (voice-orb-phases.spec.ts, hud-bar-render.spec.ts)."
  - "Agents-dashboard spec targets the live /agents route (not /dev-agents-dashboard)
    because AgentDashboard has zero test-specific preconditions to install —
    mocked agent_list + get_active_agents + agent_detect_available invokes in the
    shim are sufficient. A dev passthrough would add indirection with no benefit."
  - "verify-feature-cluster-routes.sh strips // line comments before the
    ComingSoonSkeleton grep so the header-prose mention (\"Phase 1 ComingSoonSkeleton
    stubs replaced with lazy imports\") doesn't false-positive."
  - "verify-phase5-rust-surface.sh enumerates 75 commands (agents: 32, knowledge:
    43) — a superset of the plan's '40+' target. Each command must be registered
    in generate_handler![] or the script fails with the exact missing symbol."
metrics:
  duration: "~35m (automated portion)"
  commits: 2 (pre-SUMMARY) — 7c23c8c (dev routes), ddc4647 (specs + verify scripts)
  tasks_automated_completed: 2 of 2 (Task 1 + Task 2)
  tasks_operator_gated: 1 (Task 3 — Mac-session M-14..M-20, NOT YET STARTED)
  completed: partial — automated only; Mac-session checkpoint deferred
---

# Phase 5 Plan 05-07: Playwright Specs + Verify Scripts + Mac Handoff — **Partial Summary**

**Status:** partial — the 2 autonomous tasks are shipped; Task 3 (Mac-session operator
checkpoint M-14..M-20) is bundled with the outstanding Phase 1-4 operator gates and
remains open.

**One-liner:** Phase 5 SC-1..SC-4 each now falsifiable by an automated Playwright spec
or a bash regression guard; 3 dev-only isolation routes mount the three biggest
surfaces without a live backend; 2 new verify gates ensure future refactors don't
regress the Phase 5 Rust-command surface or drop any per-route file.

---

## What Shipped (Automated Portion)

### 4 Playwright specs (1 per critical SC)

| File | SC covered | Falsifier assertion |
|------|------------|---------------------|
| `tests/e2e/agents-dashboard.spec.ts` | SC-1 (AGENT-01) | `[data-testid="agent-dashboard-root"]` visible + `[data-testid="agent-dashboard-placeholder"]` absent + `[data-testid="agent-dashboard-card"]` ≥ 1 |
| `tests/e2e/agent-detail-timeline.spec.ts` | SC-2 (AGENT-02 / WIRE-05) | `[data-testid="timeline-row"]` count ≥ 3 within 3s after 3 synthetic events (`blade_agent_event` + `agent_step_started` + `agent_step_completed`) |
| `tests/e2e/swarm-view-render.spec.ts` | SC-1 explicit (AGENT-08) | `[data-testid="swarm-dag-root"]` visible + exactly 3 `[data-testid="swarm-node"]` + ≥1 SVG `<path>` edge |
| `tests/e2e/knowledge-base-search.spec.ts` | SC-4 / D-138 (KNOW-01) | Exactly 3 `[data-testid="knowledge-search-group"]` in stable order with `data-source="knowledge"`, `"memory"`, `"timeline"` |

All four reuse the Phase 2-4 `__TAURI_INTERNALS__` + `__BLADE_TEST_EMIT__` harness verbatim
— zero new test dependencies, zero new init-script patterns.

### 2 verify scripts

| Script | Purpose | Entries checked |
|--------|---------|-----------------|
| `scripts/verify-phase5-rust-surface.sh` | Guards D-119 Rust-command inventory in `src-tauri/src/lib.rs` | 32 agents commands + 43 knowledge commands = 75 total |
| `scripts/verify-feature-cluster-routes.sh` | Guards D-120 + D-122 frontend invariants | 2 cluster indexes must lazy-import + no ComingSoonSkeleton; 9 agents + 9 knowledge per-route files must exist and export named components |

Both are wired into `package.json` → `verify:all` (now **11 gates**, was 9).

### 3 dev-only isolation routes

| Route id | Mounts | Used by |
|----------|--------|---------|
| `dev-agent-detail` | `<AgentDetail/>` + pins `agents.selectedAgent='test-agent-1'` via usePrefs | `tests/e2e/agent-detail-timeline.spec.ts` |
| `dev-swarm-view` | `<SwarmView/>` (passthrough — shim supplies mock swarm) | `tests/e2e/swarm-view-render.spec.ts` |
| `dev-knowledge-base` | `<KnowledgeBase/>` (passthrough — shim supplies mock rows) | `tests/e2e/knowledge-base-search.spec.ts` |

All three are `paletteHidden: true`, `phase: 5`, and mount only when
`import.meta.env.DEV` is true (via the existing DEV-gated spread in
`src/windows/main/router.ts` — unchanged structurally; only the header
doc-comment got 3 new route-id bullets).

### package.json verify:all composition

```
1. verify:entries
2. verify:no-raw-tauri
3. verify:migration-ledger
4. verify:emit-policy
5. verify:contrast
6. verify:chat-rgba
7. verify:ghost-no-cursor
8. verify:orb-rgba
9. verify:hud-chip-count
10. verify:phase5-rust                 ← NEW (Plan 05-07)
11. verify:feature-cluster-routes      ← NEW (Plan 05-07)
```

---

## Commits

| Commit | Subject |
|--------|---------|
| `7c23c8c` | `feat(05-07): 3 dev-only isolation routes for Phase 5 Playwright specs` |
| `ddc4647` | `test(05-07): 4 Playwright specs + 2 verify scripts for Phase 5 SCs` |

Two atomic commits. The final summary commit (this file) will be the third.

---

## Mac-Session Operator Handoff — M-14..M-20 (DEFERRED)

Task 3 from the plan is a `checkpoint:human-action` — it cannot be automated in the
sandbox because every step requires the Mac runtime (libclang-enabled build) plus
a live Rust agent to validate the WIRE-05 pipeline end-to-end. Bundled with the
existing Phase 1 WCAG + Phase 2-4 Mac-session items per STATE.md handoff strategy.

The operator should run these in sequence on the Mac:

### Verification Commands (run in order)

```bash
# Repository + dependency sanity
cd ~/blade
git pull
npm install

# Rust regression check (Phase 5 touched zero Rust; this validates transitive)
cd src-tauri && cargo check && cd ..

# Frontend automated gates — all 11 must pass
npm run verify:all

# Full Playwright spec suite — includes Phase 1-4 + 4 new Phase 5 specs
npm run test:e2e

# Optional: start the app for manual M-14..M-20 inspection
npm run tauri dev
```

### Manual Surface Checks — M-14 through M-20

**M-14 — Dev build launches**
Launch `npm run tauri dev`. Main window + 4 overlay windows (voice-orb, ghost,
hud, quick-ask) open without a Rust panic. Console shows no red errors beyond
the known benign Tauri version warnings.

**M-15 — /agents renders real surface**
Navigate via NavRail or ⌘K palette → `/agents`. AgentDashboard mounts with either
a real list (if background agents have been spawned) or the honest empty state
("No agents yet — spawn one via `/background-agents` or the ⌘K palette"). **Not** a
404 fallback; **not** a ComingSoonSkeleton.

**M-16 — /agent-detail timeline streams in real time**
First spawn at least one background agent (e.g., via `/background-agents` →
`claude-code` runtime with a trivial task). Select the agent → route to
`/agent-detail`. As the agent emits `agent_step_*` events, timeline rows must
append **without a page refresh**. Auto-scroll sticks to bottom unless you
scroll up.

**M-17 — /swarm-view DAG renders + live progress**
Create a swarm (via `swarm_create` CLI or by invoking an agent that uses the
swarm planner). Click it in the sidebar. The DAG renders with:
- Node cards colored by status (pending / running / complete / failed).
- SVG edges drawn between deps.
- Progress bar reflects `swarm_progress` events in real time.

If no swarm exists, the view shows an honest empty state mentioning `swarm_create`
(not a fake DAG or a 404).

**M-18 — /knowledge-base grouped search**
Type any term in the search input, press Enter. 3 labelled result sections
appear: **Knowledge Base**, **Memory**, **Timeline**. Empty groups render
"No matches."; the sections themselves always render. Clicking a knowledge row
opens the detail dialog; clicking a timeline row navigates to `/screen-timeline`.

**M-19 — /screen-timeline thumbnails**
If Total Recall has run for ≥30s, at least one screenshot thumbnail renders.
Infinite scroll fetches more on reaching the bottom. Click a thumbnail → detail
Dialog with full screenshot + OCR text. If no captures have occurred yet, the
empty state names that condition.

**M-20 — /knowledge-graph renders without error**
Node circles render at deterministic polar coords (D-137). If the graph has ≥200
nodes, cluster badges with "+N more" appear. Clicking a node highlights it +
opens the sidebar card.

### Regression sanity

```bash
cd src-tauri && cargo check
```

Must return 0 errors. Phase 5 shipped no Rust changes, but transitive breaks
from crate-graph resolution would surface here.

### Spec-level hot path (optional operator spot-check)

While the dev build is running, navigate to each of the 3 Plan 05-07 isolation
routes by pasting these into the address bar (they are `paletteHidden: true`,
so ⌘K won't surface them):

- `blade://internal-nav/dev-agent-detail`  (or emit `blade_route_request` from devtools)
- `blade://internal-nav/dev-swarm-view`
- `blade://internal-nav/dev-knowledge-base`

Each should mount the relevant component. In a **real** Rust session there will
be no mock invoke handler, so the surfaces render "empty" states (no selected
agent, no swarm, no knowledge rows). That's expected — the mocks live in
Playwright, not in the dev runtime.

### Resume signal

Type **"approved"** once all M-14..M-20 passed plus `npm run test:e2e` and
`npm run verify:all` are green on the Mac.

If any step fails, describe the specific failure (which M-N, error output,
cargo check lines, spec name + assertion error) so the follow-up plan can
target the exact regression.

---

## Orphan Requirements (Phase 5 Retrospective Flag — DP-3)

Per `.planning/phases/05-agents-knowledge/05-DISCUSSION-LOG.md` §DP-3, the
ROADMAP Phase 5 §"Coverage Verification" lists **AGENT-01..10** and
**KNOW-01..10** (20 requirements), but the Phase 1 substrate shipped **9+9**
stubs under `src/features/agents/index.tsx` and `src/features/knowledge/index.tsx`
respectively. Plan 05-02..05-06 covered every shipped stub; **AGENT-10 and
KNOW-10 are orphans** — no route, no code, no downstream consumer.

Scope decision required at the Phase 5 retrospective:

1. **Retire** — delete AGENT-10 + KNOW-10 from REQUIREMENTS.md (matches the
   shipped surface; lowest-friction).
2. **Add a 10th route per cluster** — re-open Phase 5 with a scope-creep plan
   (contradicts the PROJECT.md "9 stubs are canonical" discipline).
3. **Defer to Phase 9 polish** — mark orphans as "pending" with a Phase 9
   follow-on plan scoped to a single additional route per cluster.

Planner recommendation: option 1 (retire), because the 9 stubs were chosen
deliberately per ROADMAP §"Phase 1 route inventory" and nothing in user feedback
or product requirements has surfaced a 10th. But the scope decision lies outside
this plan's authority — surfaced here for the Phase 5 retrospective.

---

## Deviations from Plan

### Rule 3 — Plan prose referenced non-existent test-harness hooks

**Found during:** Task 1 pre-write reconnaissance — specifically reading
`src/lib/tauri/_base.ts` and `src/lib/events/index.ts` to locate the
`__TAURI_EMIT__` + `__TAURI_INVOKE_HOOK__` hooks the plan's `<interfaces>`
block referenced.

**Issue:** Those hooks do not exist in the codebase. `_base.ts` imports
`invoke` directly from `@tauri-apps/api/core`; `useTauriEvent` calls `listen`
from `@tauri-apps/api/event`. There is no window-scoped dispatcher that
intercepts either surface.

**Fix:** Adopt the actual harness pattern already used by Phase 2-4 specs
(`shell.spec.ts`, `hud-bar-render.spec.ts`, `voice-orb-phases.spec.ts`):

1. Install `__TAURI_INTERNALS__` via `page.addInitScript` — Tauri 2's
   documented shim-injection surface. All `invoke()` calls route through
   `__TAURI_INTERNALS__.invoke(cmd, args)`.
2. Install `__BLADE_TEST_EMIT__` alongside, driving the same listener map
   that `plugin:event|listen` populates.

This is a **harness-parity fix**, not a behavior change — the specs still
assert the exact same surface the plan intended, they just use the actual
plumbing. Dev isolation routes became passthrough mounts (all mocking lives in
the test shim) instead of carrying an inline `__TAURI_INVOKE_HOOK__` install.

**Files affected:** all 4 spec files + the 3 dev route files diverge in body
from the plan's verbatim snippets; behaviour + assertion intent is identical.

### Rule 1 — verify-feature-cluster-routes false-positive on header comments

**Found during:** first execution of `scripts/verify-feature-cluster-routes.sh`
after writing it verbatim from the plan's action block.

**Issue:** The plan's script runs `grep -q 'ComingSoonSkeleton' $f`. Both
`src/features/agents/index.tsx` and `src/features/knowledge/index.tsx` carry a
header doc-comment "Phase 1 ComingSoonSkeleton stubs replaced with lazy
imports..." — a valid historical note that makes the strict grep fail even
though no code references ComingSoonSkeleton.

**Fix:** Strip `//`-led line comments via `sed 's|//.*$||' "$f" | grep -q 'ComingSoonSkeleton'`
before matching. Header prose no longer false-positives; code-level references
still trip the guard.

**File modified:** `scripts/verify-feature-cluster-routes.sh`.

### No Rule 2 completeness additions; no Rule 4 architectural questions; no auth gates.

---

## Verification

- `npx tsc --noEmit` — **clean (exit 0)**
- `npm run verify:all` — **11/11 GREEN** (existing 9 + 2 new Phase 5 scripts)
- `bash scripts/verify-phase5-rust-surface.sh` — OK, 75 commands registered
- `bash scripts/verify-feature-cluster-routes.sh` — OK, 18 routes + lazy imports
- 4 new spec files present at `tests/e2e/*.spec.ts` — visible in `npm run test:e2e`
  glob (Playwright picks them up automatically; `testDir: './tests/e2e'`)
- 3 new dev routes present in `src/features/dev/index.tsx` route array — each
  with `paletteHidden: true`, `phase: 5`, gated on `import.meta.env.DEV` via
  the existing spread in `src/windows/main/router.ts`

`npm run test:e2e` itself is **NOT** yet run in this partial SUMMARY — that is
part of the Mac-session checkpoint (it needs a Vite dev server running at
:1420). The operator will confirm all 4 Phase 5 specs + all prior Phase 1-4
specs pass on their Mac.

---

## Known Stubs

None introduced by this plan. The dev isolation routes are not stubs — they
mount real Phase 5 components (AgentDetail / SwarmView / KnowledgeBase) with
test-harness preconditions installed. All mocking lives in the Playwright
shim, not in the component or route.

---

## Threat Flags

No new trust boundaries beyond the plan's `<threat_model>`:

- **T-05-07-01 (dev route shipped to prod)** — mitigated: all 3 new routes
  are `paletteHidden: true` and mount only via the existing
  `import.meta.env.DEV ? devRoutes : []` spread in `src/windows/main/router.ts`.
  Vite constant-folds this to `[]` in prod builds; tree-shaking drops the
  dev feature module entirely.
- **T-05-07-02 (spec hang on missing testid)** — accepted: each spec uses a
  5000ms `waitForSelector`; Playwright's 60s global test timeout caps total
  runtime.
- **T-05-07-03 (verify-phase5-rust-surface.sh missing an entry)** — mitigated:
  the script explicitly enumerates 75 commands by namespaced symbol. Any future
  Rust refactor that unregisters a command is caught on the next
  `npm run verify:all`.

---

## Plan Files NOT Touched (Scope Discipline)

- `.planning/STATE.md` — orchestrator's responsibility.
- `.planning/ROADMAP.md` — orchestrator's responsibility.
- `.planning/REQUIREMENTS.md` — orchestrator's responsibility.
- `src-tauri/**` — zero Rust edits (D-119, D-123 preserved).
- `src/lib/tauri/agents.ts` + `src/lib/tauri/knowledge.ts` — Plan 05-02
  single-writer; this plan reads types only.
- `src/lib/events/index.ts` + `src/lib/events/payloads.ts` — Plan 05-01
  single-writer; this plan consumes existing constants + interfaces only.
- `src/features/agents/*.tsx` + `src/features/knowledge/*.tsx` — Plans 05-03
  through 05-06 each own their per-route files; this plan imports them
  through the dev wrappers but never modifies them.

---

## Self-Check: PASSED

**Files created (verified exist on disk):**
- `src/features/dev/AgentDetailDev.tsx` — FOUND (43 lines, pins usePrefs
  agents.selectedAgent='test-agent-1')
- `src/features/dev/SwarmViewDev.tsx` — FOUND (20 lines, passthrough)
- `src/features/dev/KnowledgeBaseDev.tsx` — FOUND (19 lines, passthrough)
- `tests/e2e/agents-dashboard.spec.ts` — FOUND (152 lines)
- `tests/e2e/agent-detail-timeline.spec.ts` — FOUND (167 lines)
- `tests/e2e/swarm-view-render.spec.ts` — FOUND (199 lines)
- `tests/e2e/knowledge-base-search.spec.ts` — FOUND (184 lines)
- `scripts/verify-phase5-rust-surface.sh` — FOUND, executable
- `scripts/verify-feature-cluster-routes.sh` — FOUND, executable

**Files modified (verified commit diff minimal + targeted):**
- `src/features/dev/index.tsx` — adds 3 lazy consts + 3 route entries;
  comment header bumped to "9 routes"
- `src/windows/main/router.ts` — only the header doc-comment block
  mentions the 3 new route ids; no functional changes (dev routes flow
  through `devRoutes` spread unchanged)
- `package.json` — adds 2 new `verify:*` entries + appends to `verify:all`

**Commits (verified in `git log --oneline`):**
- `7c23c8c` — `feat(05-07): 3 dev-only isolation routes for Phase 5 Playwright specs`
- `ddc4647` — `test(05-07): 4 Playwright specs + 2 verify scripts for Phase 5 SCs`

**Verification commands:**
- `npx tsc --noEmit` — exit 0
- `npm run verify:all` — exit 0 with OK from all 11 scripts
- `bash scripts/verify-phase5-rust-surface.sh` — 75/75 commands registered
- `bash scripts/verify-feature-cluster-routes.sh` — 18/18 routes present

All claimed artifacts exist, all claimed commits exist, all automated
verifications pass. Mac-session checkpoint M-14..M-20 + `npm run test:e2e`
validation remain open per plan Task 3's gated nature.
