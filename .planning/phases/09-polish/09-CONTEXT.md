# Phase 9: Polish Pass — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning (AUTO mode — defaults chosen by planner and logged in 09-DISCUSSION-LOG.md)
**Source:** `/gsd-plan-phase 9 --auto` (planner-picked defaults; audit-shaped phase — NOT a feature-cluster template)

<domain>
## Phase Boundary

Phase 9 is the FINAL phase of the BLADE Skin Rebuild V1 — the polish pass across the 11 cluster surfaces shipped by Phases 1–8. It is **audit-driven**, not feature-driven. Unlike Phases 5–8 (per-cluster wrapper + routes + Playwright), Phase 9 sweeps horizontal concerns across the whole surface:

- **Motion:** every animation uses `ease-spring`/`ease-out`/`ease-smooth` from `motion.css` (no rogue `linear` transitions); every listing has entrance animations; every surface respects `prefers-reduced-motion`.
- **A11y:** ARIA labels on icon-only buttons, keyboard navigation across Dialogs, focus traps inside overlays, focus return on close, reduced-motion preference honoured.
- **Empty states:** every list/grid/table handles zero-data gracefully (not blank, not error — a real `EmptyState` primitive with label + call to action).
- **Error boundaries:** every top-level route is wrapped in an error boundary so a single crashed route does not kill the shell.
- **Skeletons:** every async-data panel shows a skeleton while loading (not a raw spinner island).
- **Cross-route consistency:** heading sizes, card padding, spacing all derived from tokens — no local `px` overrides.
- **Prod build verification:** `npm run tauri build` produces a complete bundle; `verify-html-entries.mjs` passes on `dist/` with all 5 HTML entries.
- **Perf budget:** explicit budgets — dashboard first paint ≤ 200ms (P-01 re-verified), chat render ≤ 16ms at 50 tok/sec (P-01), agent timeline rAF stable through streaming (P-01/P-06 re-verified).
- **Shortcut help panel:** `⌘?` surfaces every route's primary shortcut (Phase 9 POL-04 falsifier).

**In scope:** 10 requirements — POL-01..10. Each requirement maps to one or more audit tasks below (see D-217 coverage table).

**Out of scope for Phase 9:**
- New feature surfaces (every cluster was closed in Phases 5–8 — Phase 9 polishes, does not extend).
- New Rust commands — Phase 9 preserves the zero-Rust invariant unless a known Phase-1..8 gap is worth closing (D-213 decides per-gap; see below).
- Mobile / responsive redesign (desktop-first; minor responsive touch-ups allowed).
- Version bump / app store prep (tagged as 0.7.x → 1.0.0 cutover happens AFTER Phase 9 closes and the operator signs off on prod-build smoke).

**Key Phase 1..8 substrate Phase 9 leans on (no drift permitted):**
- `src/design-system/primitives/*` — 9 primitives + `ComingSoonSkeleton`. Phase 9 ADDS two new primitives: `ErrorBoundary` (class component, React error boundary API) + `EmptyState` (glass card with icon/label/action).
- `src/styles/tokens.css` + `glass.css` + `motion.css` + `layout.css` — the motion + status tokens are the source of truth. Phase 9 adds `--motion-reduce` media-query override + verifies no inline `transition: * linear *` exists anywhere under `src/`.
- `src/windows/main/MainShell.tsx` — RouteSlot is the single wrapping point for the top-level `<ErrorBoundary>`. Phase 9 edits MainShell ONCE (Plan 09-02 Task 1) to wrap `<Cmp />` in `<ErrorBoundary>`.
- `src/lib/events/index.ts` + `payloads.ts` — 73+ events. Phase 9 does NOT add events (audit-only).
- `src/lib/tauri/*.ts` — 16 wrapper files. Phase 9 may add 1-5 new wrappers if it closes known Rust gaps (D-213).
- `src/hooks/usePrefs.ts` — Phase 9 adds `shell.shortcutHelpOpen` dotted key ONLY if a persisted state is needed; the `⌘?` panel is a transient Dialog so no pref needed (D-215 picks no-pref variant).
- `scripts/verify-*.{mjs,sh}` — 14 existing verify scripts. Phase 9 adds 4 new ones (motion tokens, empty-state coverage, error-boundary coverage, prod-build HTML entries) + extends `verify:all`.
- `tests/e2e/*` — 25 existing specs. Phase 9 adds 2 new specs (a11y sweep via axe-core probe using existing Playwright harness, error-boundary recovery). No new test deps.
- `playwright.config.ts` — reused verbatim.

**Audit-driven plan shape:** Phase 9 plans differ from Phases 5–8 in that each plan is a horizontal concern across MANY routes, not a cluster-vertical slice. The plans are:
1. **Plan 09-01** — Rust gap backfill (ONLY the gaps that have high ROI + low effort + don't drag V1). Planner-chose 3 small Rust commands to backfill (save_config_field already shipped; hive_reject_decision + delegate_feedback + dna_set_identity chosen to backfill because each unlocks a visible frontend improvement at ~30 LOC Rust each). HiveStatus per-head pending_decisions[] wire shape is already in place (verified grep).
2. **Plan 09-02** — ErrorBoundary + EmptyState primitives + wrap every top-level route + apply EmptyState to every zero-data-bearing surface.
3. **Plan 09-03** — A11y sweep (ARIA labels on icon-only buttons, focus management on Dialogs, keyboard nav, `prefers-reduced-motion` media query in `motion.css`).
4. **Plan 09-04** — Motion audit + cross-route consistency + skeleton loaders for async panels.
5. **Plan 09-05** — Perf budget harness (dashboard first paint probe, chat render benchmark) + prod build verification (`npm run tauri build` produces 5 HTML entries + CI assertion passes).
6. **Plan 09-06** — Playwright a11y + error-boundary specs + 4 new verify scripts wired into `verify:all` + final Mac-smoke checkpoint M-41..M-46 + CHANGELOG + commit "READY TO SHIP".

**Parallelism:** Plan 09-01 (Rust) is Wave 1 solo because every frontend plan reads from ConfigContext / usePrefs which are independent. Plans 09-02, 09-03, 09-04 are Wave 2 parallel — but only 09-02 touches primitives + MainShell, 09-03 touches CSS + dialogs + icon buttons, 09-04 touches motion.css + feature CSS files + loading-state code paths. Files are deliberately carved so wave-2 plans have zero `files_modified` overlap. Plan 09-05 (perf harness) is Wave 3 because it consumes the polished surfaces. Plan 09-06 (Playwright + CHANGELOG) is Wave 4 because it verifies Plans 09-01..05.

</domain>

<decisions>
## Implementation Decisions

New decisions continue the D-XX numbering. Phase 8 locked D-193..D-210. Phase 9 adds D-211..D-230.

### Scope philosophy — polish, not expansion (inherits Phase 5/6/7/8 discipline)

- **D-211:** **No new feature surfaces.** Every requirement POL-01..10 maps to a horizontal concern applied across already-shipped routes. Phase 9 does not add a single new route, cluster, or user-facing feature. If an audit surfaces a genuinely-missing feature, it becomes a "v1.1 candidate" line in `.planning/RETROSPECTIVE.md` (Phase 9 does not create the file; that belongs to a separate follow-on).

- **D-212:** **ComingSoonSkeleton stays wherever Phases 5–8 left it.** Phase 9 DOES NOT rip out any ComingSoonSkeleton card (e.g., the Canvas `phase={9}` skeleton from Phase 7 D-171 or ApprovalQueue "dismiss" button). Replacing those skeletons with real features is scope expansion; Phase 9 polishes the skeletons themselves (make sure they render tokens, respect empty-state shape, are consistent).

### Rust gap backfill — surgical (D-213..D-214)

- **D-213:** **Planner-chosen Rust gaps to backfill in Plan 09-01** — three small commands, each closing a Phase 8 documented deferral (see `.planning/phases/08-body-hive/08-CONTEXT.md` §deferred):
  1. **`hive::hive_reject_decision(head_id: String, decision_index: usize) -> Result<(), String>`** — mirrors `hive_approve_decision` exactly; removes the decision from `head.pending_decisions[decision_index]` without executing the action. ApprovalQueue client-side "Dismiss" becomes a real backend reject. ~15 LOC in `hive.rs`, 1-line `lib.rs` registration, 1 wrapper in `src/lib/tauri/hive.ts`. Closes D-205 Phase 8 deferral.
  2. **`dna::dna_set_identity(content: String) -> Result<(), String>`** — simple file write to the identity.md under the DNA root. Allows DNA route's "Save" button to actually persist. ~25 LOC in `dna.rs`, 1-line `lib.rs` registration, 1 wrapper in `src/lib/tauri/body.ts`. Closes D-203 Phase 8 deferral.
  3. **`character::delegate_feedback(decision_id: String, was_correct: bool, note: Option<String>) -> Result<(), String>`** — records feedback to the character.rs feedback log. AiDelegate route's per-decision "Feedback" button persists instead of client-side ring. ~25 LOC in `character.rs`, 1-line `lib.rs` registration, 1 wrapper in `src/lib/tauri/hive.ts`. Closes D-205 Phase 8 deferral.
  
  Rationale: all three are < 30 LOC Rust each, close a documented deferral, unlock a visible UI improvement, and cost little context budget. The three combined Rust LOC is ~70 lines. **NOT backfilled (deferred to v1.1):**
  - `save_config_cmd` — `save_config_field` already exists in `lib.rs:591` and covers the frontend save path. The underlying `save_config` (non-command helper) is reached transitively from ~9 call sites already. No V1 frontend blocker.
  - **HiveStatus per-head pending_decisions[] richer wire shape** — grep confirms `heads[].pending_decisions: Vec<Decision>` ALREADY returned by `hive_get_status()` (hive.rs:194, 3078, 3089). Phase 8 Plan 08-04 ApprovalQueue ALREADY reads `recent_decisions` as a V1-simplification; Phase 9 Plan 09-02 ApprovalQueue update consumes the richer `heads[].pending_decisions` shape (NO Rust change needed; frontend-only adjustment under HIVE-04 improvement).

- **D-214:** **Zero-Rust invariant partially relaxed (justified).** D-213 permits 3 surgical Rust additions because each closes a documented deferral with high UX ROI and minimal code-risk. The Phase 5/6/7/8 zero-Rust invariant was domain-scoped (wrappers cover existing commands); Phase 9 is scope-scoped (polish = close known deferrals). Plan 09-01 MUST NOT add any Rust command not explicitly listed in D-213.

### Primitives split (D-215)

- **D-215:** **Two new primitives added to `src/design-system/primitives/`** — `ErrorBoundary` and `EmptyState`. Both ship in Plan 09-02.
  - **ErrorBoundary** is a class component (React requires class-based error boundaries — functional error hooks don't exist as of React 19). Exported from `src/design-system/primitives/ErrorBoundary.tsx`. Wraps children; on error, renders a recovery `GlassPanel` with three actions: "Reset route" (resets local state — calls a `resetKey` prop re-mount), "Back to dashboard" (`openRoute('dashboard')`), "Copy error" (puts the error.message + component stack in the clipboard for filing). `componentDidCatch` also calls `console.error` for dev visibility.
  - **EmptyState** is a functional component. Props: `label: string`, `description?: string`, `actionLabel?: string`, `onAction?: () => void`, `icon?: ReactNode`. Renders centered GlassPanel tier-1 with icon + label + optional description + optional Button. Uses existing tokens (`--t-2`, `--s-6`). Exported from `src/design-system/primitives/EmptyState.tsx`.
  - Both added to `src/design-system/primitives/index.ts` barrel.
  - Rationale: two primitives are the smallest surface that closes POL-02 (empty states) + POL-03 (error boundaries). No local per-cluster empty-state clutter.

### A11y scope (D-216)

- **D-216:** **A11y pass targets 4 concrete checks (Plan 09-03):**
  1. Every `<button>` or interactive element with ONLY an icon/emoji/symbol has an `aria-label`. Enforced via a new `scripts/verify-aria-icon-buttons.mjs` scan.
  2. Every `Dialog` traps focus + returns focus to the trigger element on close. `Dialog` primitive already uses native `<dialog>` element (D-58) which provides focus trap by default; Phase 9 verifies + augments if gaps found.
  3. `prefers-reduced-motion` media query added to `motion.css` that sets `--dur-snap/--dur-fast/.../--dur-slow` to `0.01ms` and disables `@keyframes spin`. Verified via Playwright `emulateMedia({ reducedMotion: 'reduce' })` spec in Plan 09-06.
  4. Keyboard navigation matrix: Tab moves between top-level landmarks (NavRail, TitleBar, ⌘K palette, route content); Escape closes overlays (Dialog, CommandPalette); Enter activates focused item. Verified via Playwright keyboard-sequence spec in Plan 09-06.

### Empty-state coverage (D-217)

- **D-217:** **POL-02 coverage table — each route surface with a list/table/grid is audited:**
  | Route | Zero-data surface | Empty-state renderer |
  |-------|-------------------|----------------------|
  | Dashboard | No perception data | Existing `ComingSoonCard` covers — NO change |
  | Chat | No messages | Existing composer-first layout covers — NO change |
  | Agents | No agents registered | `<EmptyState label="No agents yet" actionLabel="Spawn agent" />` |
  | SwarmView | No swarm runs | `<EmptyState label="No swarm runs — start one from agent-factory" />` |
  | AgentDetail | No timeline events | `<EmptyState label="No events — timeline emits in real time" />` |
  | KnowledgeBase | Search empty | `<EmptyState label="No matches" description="Try a broader query" />` |
  | ScreenTimeline | No screenshots | `<EmptyState label="Total Recall not running yet" actionLabel="Start recall" />` |
  | Health / Finance / Goals / Habits / Meetings / Predictions / SocialGraph / Accountability / EmotionalIntel | Empty lists | Each gets a one-line `<EmptyState>` |
  | CharacterBible / SoulView / PersonaView / ReasoningView / NegotiationView / SidecarView / ContextEngine | Empty trait log | Each gets `<EmptyState label="No entries yet">` |
  | Terminal | No output | Existing scrollback covers — NO change (empty terminal is valid) |
  | FileBrowser | Empty directory | `<EmptyState label="Empty directory" />` |
  | Analytics / CapabilityReports / DecisionLog / SecurityDashboard / Diagnostics / IntegrationStatus / McpSettings / ModelComparison / KeyVault / Reports / Temporal | Empty tables | Each gets `<EmptyState>` label tailored |
  | BodyMap | Should be populated | `body_get_summary()` always returns — NO empty case |
  | BodySystemDetail | No vitals for system | Existing "No per-system vitals available" text already handles — swap for `<EmptyState>` |
  | HormoneBus | Values always present | NO empty case |
  | OrganRegistry | No organs | `<EmptyState label="No organs registered">` |
  | DNA | All 4 tabs empty | Each tab: `<EmptyState>` if content is empty |
  | WorldModel | No git repos / processes | Each tab: `<EmptyState>` fallback |
  | HiveMesh | No tentacles | `<EmptyState label="Hive not running" actionLabel="Start hive" />` |
  | TentacleDetail | No reports | `<EmptyState label="No reports from this tentacle">` |
  | AutonomyControls | Matrix always present | NO empty case |
  | ApprovalQueue | No pending | `<EmptyState label="Nothing to approve" description="All caught up">` |
  | AiDelegate | No history | `<EmptyState label="No delegate decisions recorded">` |
  
  Rationale: the table is the WORK. Plan 09-02 Task 2 is the editor sweep; it touches approximately 25-30 feature `.tsx` files. To keep the plan within a ~50% context budget, we split the edits across Plan 09-02 Task 2 (core clusters — agents, knowledge, life-os, identity, dev-tools, admin) and Plan 09-04 Task 2 (body + hive cluster + motion audit). This honors the same-wave no-file-overlap rule since plans touch DISJOINT file sets.

### Error-boundary architecture (D-218)

- **D-218:** **Error boundary wraps each route in MainShell.RouteSlot (single-writer).** MainShell.tsx edited ONCE (Plan 09-02 Task 3) to wrap `<Cmp />` inside `<ErrorBoundary resetKey={route.id}>`. The `resetKey` ensures navigating to a different route resets the error state (so you don't see a stale "crashed" panel for a route that is working). **Per-feature error boundaries** (within a single route, to isolate sub-panes) are NOT in Phase 9 scope — we choose the coarsest boundary that passes POL-03. Rationale: per-pane boundaries are a v1.1 refinement; Phase 9 ships the MVP error-boundary that satisfies ROADMAP SC-3 ("simulated error shows a recovery affordance (retry / reset / report), never an unhandled crash").

### Motion audit (D-219)

- **D-219:** **Motion audit — 3 checks (Plan 09-04):**
  1. **No rogue `linear` transitions.** Grep `src/**/*.css` + `src/**/*.tsx` inline style for `transition: * linear` or `animation: * linear *` and fix each to use `var(--ease-spring)` / `var(--ease-out)` / `var(--ease-smooth)`. A verify script `scripts/verify-motion-tokens.sh` catches regressions in CI.
  2. **Entrance animations.** Every listing (list / grid / table body) gets a stagger-free CSS fade-in + subtle y-translate on mount. Implemented as a shared `.list-entrance` class in `src/styles/motion.css` with `animation: blade-enter var(--dur-enter) var(--ease-spring) both;`. Listings adopt the class in Plan 09-04 Task 1.
  3. **`prefers-reduced-motion` override.** Global media query in `motion.css` that sets all durations to `0.01ms` + disables `@keyframes spin` + disables `.list-entrance` animation. (Bound to D-216 sub-check 3.)

### Skeletons (D-220)

- **D-220:** **Skeleton loader primitive exists via `GlassSpinner`; Phase 9 adds a cheaper `ListSkeleton`** for panels that show a list of rows while loading. `ListSkeleton` renders 5 placeholder rows (glass tier-1 cards with animated shimmer gradient). Exported from `src/design-system/primitives/ListSkeleton.tsx`. Rationale: swap `GlassSpinner` for `ListSkeleton` on dashboard panels + agent-detail timeline + knowledge-base search + body-system-detail module list + hive-mesh tentacle grid, where a full list is expected. Plan 09-04 Task 3 applies.

### Cross-route consistency (D-221)

- **D-221:** **Consistency audit — 3 checks (Plan 09-04 Task 4):**
  1. Heading sizes: every `<h1>` uses `.t-h1` class (or `font-size: var(--fs-h1)`); every `<h2>` uses `.t-h2`; no raw `font-size: 28px` literals.
  2. Card padding: every GlassPanel uses `padding: var(--s-N)`; no raw `padding: 20px` literals.
  3. Spacing between sections: `gap: var(--s-N)` only; no raw pixel gap.
  Enforced via `scripts/verify-tokens-consistency.mjs` (new; runs in CI).

### Shortcut help (D-222)

- **D-222:** **⌘? shortcut help panel (POL-04).** Adds a top-level keyboard shortcut `⌘?` (`Mod+?` → maps to `Mod+Shift+/` on QWERTY) handled in `useGlobalShortcuts.ts`. Opens a transient `<Dialog>` that renders a grid of every `RouteDefinition.shortcut` + the fixed global shortcuts (`⌘K`, `⌘,`, `⌘1`, `⌘/`, `⌘[`, `⌘]`). Rendered as a two-column list with shortcut label in monospace + route label in body font. Esc closes. Focus returns to NavRail after close. Rationale: ROADMAP SC-4 "`⌘?` opens the shortcut help panel" — direct falsifier.

### Perf budget (D-223..D-225)

- **D-223:** **Dashboard first paint probe (P-01 re-verify).** New Playwright spec `tests/e2e/perf-dashboard-fp.spec.ts` navigates to `/dashboard`, measures time between `navigation-start` and `paint: first-contentful-paint` via `performance.getEntriesByType('paint')`. Asserts < 250ms (slightly slacker than the 200ms P-01 target to account for Playwright overhead). If the strict P-01 200ms target must be verified, that remains a Mac-smoke item (M-41). Lives in Plan 09-05.

- **D-224:** **Chat render benchmark (P-01 re-verify).** New Playwright spec `tests/e2e/perf-chat-stream.spec.ts` simulates 50 tokens/sec streaming via `__TAURI_EMIT__` harness + `performance.mark` around the message-list render path; asserts max frame time < 20ms (slightly slacker than 16ms P-01 target). Mac-smoke M-42 keeps the tight 16ms target.

- **D-225:** **Agent timeline rAF stability (P-01 re-verify).** New Playwright spec `tests/e2e/perf-agent-timeline.spec.ts` simulates 100 agent events via `__TAURI_EMIT__` at 30 ev/sec + checks `requestAnimationFrame` callback count via `window.performance.now()` deltas; asserts no missed frames > 50ms. Mac-smoke M-43 keeps the tight target.

### Prod build verification (D-226)

- **D-226:** **Prod build verification (POL-01 direct falsifier).** Plan 09-05 Task 4 runs `npm run tauri build` locally (best-effort — may take 5-15 minutes; if build is unavailable in sandbox, document and queue to Mac-smoke M-44). Then runs `node scripts/verify-html-entries.mjs` against `dist/` to assert all 5 HTML entries exist. The existing `scripts/verify-html-entries.mjs` already does this for dev builds; Plan 09-05 adds a `--prod` flag that checks `dist/` instead of `src/`. The Mac-smoke M-44 confirms the Tauri bundle (`.app`, `.dmg`) is produced without Rust panics.

### CHANGELOG + release gate (D-227)

- **D-227:** **`CHANGELOG.md` created + version bump deferred to operator.** Plan 09-06 Task 3 creates `CHANGELOG.md` at the repo root documenting V1 completion — by-phase bullets + list of SC falsifications verified. The version field in `package.json` / `tauri.conf.json` / `Cargo.toml` stays at `0.7.9` (Phase 9 does NOT bump to 1.0.0). The operator is responsible for the version bump + tag + release workflow after Phase 9 Mac-smoke closes. Rationale: tagging 1.0.0 is a human decision gate after confirming no showstoppers; planner has no authority to declare V1 shipped.

### Plan-split strategy (6 plans across 4 waves — audit-driven, NOT cluster-driven)

- **D-228:** **Plan split (audit-shaped — diverges from Phase 5–8 cluster template):**
  - **Plan 09-01** (Wave 1 — Rust backfill solo): 3 small Rust commands per D-213 + 3 wrapper additions + ApprovalQueue.tsx edit to use `hive_reject_decision` + DNA.tsx edit to call `dna_set_identity` + AiDelegate.tsx edit to call `delegate_feedback`. Single plan, 4 tasks.
  - **Plan 09-02** (Wave 2 — primitives + error boundaries + empty states core): 2 new primitives (`ErrorBoundary`, `EmptyState`) + MainShell.tsx edit (wrap RouteSlot) + empty-state sweep across core + agents + knowledge + life-os + identity clusters.
  - **Plan 09-03** (Wave 2 — a11y sweep): ARIA labels on icon-only buttons (audit + add), `prefers-reduced-motion` media query in motion.css, focus-management verification in Dialog primitive, keyboard-navigation hooks.
  - **Plan 09-04** (Wave 2 — motion audit + skeletons + consistency + empty-state sweep across body + hive): motion audit (no-linear check + list-entrance class), ListSkeleton primitive + apply to 6 surfaces, consistency audit, empty-state sweep across body + hive + dev-tools + admin clusters.
  - **Plan 09-05** (Wave 3 — perf budget + prod build): 3 perf Playwright specs + prod-build-dist verification + shortcut help panel (`⌘?`).
  - **Plan 09-06** (Wave 4 — final verification + CHANGELOG + Mac smoke): 2 Playwright specs (a11y sweep, error-boundary recovery), 4 new verify scripts (verify-aria-icon-buttons.mjs, verify-motion-tokens.sh, verify-tokens-consistency.mjs, verify-empty-state-coverage.sh), extend verify:all, CHANGELOG.md, Mac-smoke checkpoint M-41..M-46.

  Rationale: Wave 1 is solo because Rust + frontend-wiring touches files that every wave-2 plan also touches (ApprovalQueue, DNA, AiDelegate). Wave 2 plans are DELIBERATELY carved so their `files_modified` sets are disjoint:
  - 09-02 touches: primitives/ErrorBoundary.tsx, primitives/EmptyState.tsx, primitives/index.ts, MainShell.tsx + agents/knowledge/life-os/identity feature files (empty-state swap).
  - 09-03 touches: motion.css (reduced-motion media query section), primitives/Dialog.tsx (focus-return augmentation if needed), icon-only button files (specific .tsx set — identified by Plan 09-03 Task 1 audit).
  - 09-04 touches: motion.css (list-entrance class section), primitives/ListSkeleton.tsx, feature CSS files (body, hive, dev-tools, admin), body/hive/dev-tools/admin feature .tsx files (empty-state swap + skeleton swap).
  
  The `motion.css` file has two distinct sections edited by 09-03 (reduced-motion) and 09-04 (list-entrance class). To prevent overlap, Plan 09-04 edits motion.css FIRST (earlier in Wave 2 dispatch) and Plan 09-03 appends the reduced-motion section without touching the list-entrance section. Acceptable risk because both are append-only inserts and the file is small (~50 lines). Alternative: carve into motion.css + motion-a11y.css (rejected — token churn for no gain).

  Actually, safer alternative: **Plans 09-03 and 09-04 use separate CSS files.** Plan 09-03 creates `src/styles/motion-a11y.css` (reduced-motion media query + Dialog focus styles) imported AFTER motion.css in `src/styles/index.css`. Plan 09-04 creates `src/styles/motion-entrance.css` (list-entrance class) imported after motion-a11y.css. Both are append-only new files, guaranteed no overlap with motion.css. CHOSEN.

- **D-229:** **`files_modified` no-overlap invariant (inherits D-122 + D-143 + D-170 + D-199).** The wave-2 plans (09-02, 09-03, 09-04) touch a DISJOINT set of files. Wave 3 (09-05) depends on wave 2 outputs. Wave 4 (09-06) depends on wave 3. The plan author in each wave-2 plan MUST NOT touch files owned by another wave-2 plan. The hand-offs for feature files (empty-state swap):
  - 09-02 owns: agents + knowledge + life-os + identity feature `.tsx` empty-state swaps.
  - 09-04 owns: body + hive + dev-tools + admin feature `.tsx` empty-state swaps.
  This partition keeps both plans at ~50% context budget; each swap is ~3-5 LOC per file.

### Mac-smoke extension (D-230)

- **D-230:** **Mac-smoke M-41..M-46 (extending Phase 1..8 list):**
  - M-41: Dashboard first paint ≤ 200ms measured via `about:tracing` on integrated GPU (P-01 tight target).
  - M-42: Chat render ≤ 16ms at 50 tok/sec measured via React Profiler (P-01 tight target).
  - M-43: Agent timeline rAF stable through 5-minute stream (P-01/P-06 tight target).
  - M-44: `npm run tauri build` produces bundle on macOS (`.app` or `.dmg`); launches without Rust panic; all 5 windows open.
  - M-45: `prefers-reduced-motion: reduce` system setting eliminates all entrance animations + spinner spin; verified in System Settings toggle.
  - M-46: `⌘?` opens shortcut help panel; Escape closes; focus returns to NavRail; every listed shortcut actually navigates.

### Claude's Discretion (planner-chosen defaults)

- ErrorBoundary UX: 3 buttons (Reset route / Dashboard / Copy error) vs just "Retry" — planner picks 3-button (more information for user; matches Phase 7 SecurityDashboard danger-zone Dialog discipline D-174).
- EmptyState icon: planner picks no default icon — consumers pass `icon` prop if needed. Rationale: keeps primitive token-light.
- Shortcut help (`⌘?`) dismissal: Escape + click outside + ⌘? toggle — planner picks all three (matches CommandPalette ⌘K).
- Perf spec slack: Playwright targets loose (250ms / 20ms / 50ms) vs P-01 tight (200ms / 16ms / N/A) — planner picks loose for CI (Playwright + harness overhead) + tight for Mac-smoke (real hardware).
- Prod build failure handling: if `npm run tauri build` fails in sandbox (cargo takes 5-15min, no reliable cross-compile to macOS target), planner documents in SUMMARY + queues to Mac-smoke M-44 verbatim. Does NOT fail the plan.
- ListSkeleton shimmer color: planner picks `rgba(255,255,255,0.04)` fill + `rgba(255,255,255,0.12)` highlight (matches tokens `--g-fill-weak` + `--g-edge-mid`). Animated via keyframe left-to-right translate over 1.8s.
- Version bump: stays at 0.7.9. Planner does NOT bump (operator decision per D-227).
- CHANGELOG format: Keep a Changelog (keepachangelog.com) structure — Added / Changed / Fixed / Deferred. Planner picks this over conventional-changelog because it's human-facing at release, not CI-facing.
- Motion audit coverage: only `src/` — no `src.bak/` (read-only per D-17).
- ARIA icon-button audit scope: `src/features/**` + `src/design-system/**` + `src/windows/**` — skips `tests/` and `scripts/`.
- Keyboard shortcut matrix rendering: 2-column grid vs table — planner picks 2-column grid for visual density (matches ModelComparison Phase 7 layout).
- Error boundary reset semantics: on route navigation (resetKey prop) vs manual "Reset" button — planner picks BOTH (route change auto-resets; manual Reset button for same-route recovery).
- Deferred Rust gaps: `save_config_cmd` — NOT backfilled (save_config_field covers frontend save path). HiveStatus per-head pending_decisions wire — NOT a Rust change (data already present in response; frontend wiring change in Plan 09-01 ApprovalQueue update).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (MUST READ)
- `.planning/PROJECT.md` — core value, out-of-scope, constraints
- `.planning/ROADMAP.md` §"Phase 9: Polish Pass" — goal, 10 requirements (POL-01..10), success criteria 1–5
- `.planning/STATE.md` — current position, locked D-01..D-210, Phase 1..8 substrate inventory
- `.planning/RECOVERY_LOG.md` — event catalog; emit policy
- `.planning/migration-ledger.md` — route status (82 rows; Phase 9 verifies all 79 Pending rows flip to Shipped as Phases 1..8 close)

### Phase 1..8 artifacts (this phase's substrate)
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01..D-45
- `.planning/phases/02-onboarding-shell/02-CONTEXT.md` — D-46..D-63
- `.planning/phases/03-dashboard-chat-settings/03-CONTEXT.md` — D-64..D-92
- `.planning/phases/04-overlay-windows/04-CONTEXT.md` — D-93..D-117
- `.planning/phases/05-agents-knowledge/05-CONTEXT.md` — D-118..D-138
- `.planning/phases/06-life-os-identity/06-CONTEXT.md` — D-139..D-165
- `.planning/phases/07-dev-tools-admin/07-CONTEXT.md` — D-166..D-192
- `.planning/phases/08-body-hive/08-CONTEXT.md` — D-193..D-210 (Phase 9 inherits verbatim)
- `.planning/phases/08-body-hive/08-PATTERNS.md` — Playwright + verify-script recipes Phase 9 reuses
- `.planning/phases/07-dev-tools-admin/07-PATTERNS.md` — Dialog/tab recipes Phase 9 reuses

### Code Phase 9 extends (read-only inputs)

**Frontend (substrate — modified by Plan 09-02/03/04):**
- `src/windows/main/MainShell.tsx` — wrap RouteSlot in ErrorBoundary (Plan 09-02 Task 3)
- `src/windows/main/useGlobalShortcuts.ts` — add `⌘?` handler (Plan 09-05 Task 3)
- `src/design-system/primitives/*` — add ErrorBoundary, EmptyState, ListSkeleton (Plans 09-02, 09-04)
- `src/design-system/primitives/index.ts` — barrel
- `src/styles/motion.css` — read-only; 09-03 + 09-04 create sibling motion-a11y.css + motion-entrance.css
- `src/styles/index.css` — import the new motion sibling files
- `src/features/**/*.tsx` — empty-state swaps per D-217 split across 09-02 and 09-04
- `src/features/**/*.css` — consistency audit (09-04)

**Rust (substrate — extended by Plan 09-01):**
- `src-tauri/src/hive.rs` — add `hive_reject_decision` (~15 LOC)
- `src-tauri/src/dna.rs` — add `dna_set_identity` (~25 LOC)
- `src-tauri/src/character.rs` — add `delegate_feedback` (~25 LOC)
- `src-tauri/src/lib.rs` — register 3 new commands
- `src/lib/tauri/hive.ts` — add `hiveRejectDecision` + `delegateFeedback` wrappers
- `src/lib/tauri/body.ts` — add `dnaSetIdentity` wrapper

### Verify scripts + tests (Phase 9 adds)
- `scripts/verify-aria-icon-buttons.mjs` — new (Plan 09-06)
- `scripts/verify-motion-tokens.sh` — new (Plan 09-06)
- `scripts/verify-tokens-consistency.mjs` — new (Plan 09-06)
- `scripts/verify-empty-state-coverage.sh` — new (Plan 09-06)
- `scripts/verify-html-entries.mjs` — existing; Plan 09-05 adds `--prod` flag
- `tests/e2e/perf-dashboard-fp.spec.ts` — new (Plan 09-05)
- `tests/e2e/perf-chat-stream.spec.ts` — new (Plan 09-05)
- `tests/e2e/perf-agent-timeline.spec.ts` — new (Plan 09-05)
- `tests/e2e/a11y-sweep.spec.ts` — new (Plan 09-06)
- `tests/e2e/error-boundary-recovery.spec.ts` — new (Plan 09-06)

### Rust source (authoritative for Plan 09-01)
- `src-tauri/src/hive.rs:3259-3296` — `hive_approve_decision` pattern reference for new `hive_reject_decision`
- `src-tauri/src/dna.rs` — existing dna_get_identity pattern
- `src-tauri/src/character.rs` — existing feedback log (for delegate_feedback)
- `src-tauri/src/lib.rs:1284-1338` — `generate_handler![]` — Phase 9 adds 3 entries

### Explicitly NOT to read (D-17 applies)
- Any `src.bak/` file for import. Read-only layout reference only.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 1..8 substrate Phase 9 polishes

- **`src/design-system/primitives/`** ships 9 primitives: Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton. Phase 9 adds 3: ErrorBoundary, EmptyState, ListSkeleton.
- **`src/windows/main/MainShell.tsx`** (135 lines) — route rendered inside `<Suspense>` inside RouteSlot. Phase 9 wraps `<Cmp />` inside `<ErrorBoundary resetKey={route.id}>` — ONE line change at `<Cmp />` site.
- **`src/styles/motion.css`** (34 lines) — defines `--ease-spring`, `--ease-out`, `--ease-smooth`, `--dur-*` tokens. Phase 9 creates two sibling files (motion-a11y.css, motion-entrance.css) imported after motion.css in index.css.
- **`src/styles/index.css`** — the Tailwind v4 @theme bridge + imports. Phase 9 adds two `@import` lines.
- **`src/features/**/index.tsx`** (14 clusters, total ~1000 lines across all indexes) — NO changes in Phase 9 (routes already lazy-registered).
- **`src/features/**/*.tsx`** per-route components — Phase 9 empty-state swap touches ~25-30 files, each ~3-5 LOC change (replacing a raw "No data" span with `<EmptyState>`).
- **`src/hooks/usePrefs.ts`** — NO changes (shortcut help is transient).
- **`scripts/verify-*`** — 14 existing scripts. Phase 9 adds 4 + extends `verify:all`.

### Rust surface Phase 9 touches (Plan 09-01 only)

- **`src-tauri/src/hive.rs:3259`** — `hive_approve_decision(head_id: String, decision_index: usize)` function body is the template for `hive_reject_decision`. The new function removes the decision from `head.pending_decisions[decision_index]` and returns `Ok(())` without executing the action. No new fields on any struct; the removal drops the decision on the floor (which is the semantic of "reject").
- **`src-tauri/src/dna.rs`** — `dna_get_identity` reads a file under the DNA root. `dna_set_identity` writes the file, creating the parent dir if missing. Uses `tokio::fs::write`. Simple.
- **`src-tauri/src/character.rs`** — existing feedback log (thumbs up/down from Chat). The new `delegate_feedback` appends a new entry to the same log with `{decision_id, was_correct, note, timestamp}`.

### Audit findings at CONTEXT gathering

- **Motion audit grep:** `grep -rn "linear" src/**/*.css` produced 0 rogue `transition: * linear` matches in feature CSS files. A couple of `ease-linear` usages in Tailwind utilities are fine (name-only, not value-level). Good baseline — Plan 09-04 verifies with automated script.
- **ARIA label grep:** `grep -rn "aria-label" src/` produced 325 hits across 88 files — a good baseline. Plan 09-03 Task 1 audits the ~145 React components under `src/features/` + `src/design-system/` to find icon-only buttons missing aria-label (expected ~10-20 hits based on spot-check of TitleBar, HUD, settings tab buttons).
- **Empty-state grep:** ~275 hits for "empty|no data" across 93 files — many are existing fallback text strings that Phase 9 standardizes into `<EmptyState>`.
- **Skeleton grep:** only ComingSoonSkeleton exists today. Phase 9 adds ListSkeleton alongside it.
- **Error boundary grep:** 0 files match `ErrorBoundary|componentDidCatch`. Phase 9 is the first pass.
- **`prefers-reduced-motion` grep:** 0 files. Phase 9 is the first pass.
- **Version strings:** `package.json` + `tauri.conf.json` + `Cargo.toml` all at `0.7.9`. Phase 9 does NOT bump.

### Pattern recipes Phase 9 inherits

- **Wrapper recipe:** Phase 5 §1 / Phase 6 §1 / Phase 7 §1 / Phase 8 §1 — same for the 3 Rust additions in Plan 09-01.
- **Playwright recipe:** Phase 5 §7 / Phase 8 §7 — same for the 5 new specs in Plans 09-05 / 09-06.
- **Verify script recipe:** Phase 5 §8 / Phase 8 §8 — same for the 4 new verify scripts in Plan 09-06.
- **Dialog recipe:** Phase 6 §4 — same for the `⌘?` shortcut help panel in Plan 09-05.

### Known non-blockers (Phase 9 leaves alone)

- ComingSoonSkeleton cards still present in Canvas (Phase 7), ApprovalQueue dismiss (Phase 8) — left alone per D-212.
- `save_config_cmd` — not backfilled per D-213 (save_config_field covers the path).
- Mobile responsive — out of scope per D-211.
- Version bump — operator decision per D-227.

</code_context>

<specifics>
## Specific Ideas

**From ROADMAP Phase 9 success criteria (must be falsifiable):**
- SC-1: Every route mounts without error in `npm run tauri build` prod output; all 5 windows open; no orphan screens or 404 fallbacks anywhere. (Plan 09-05 Task 4 prod build + Mac-smoke M-44 falsifier.)
- SC-2: Every surface has an empty state with a clear call to action; no data-driven view shows a blank white area when its data source returns empty. (Plans 09-02 + 09-04 empty-state sweep + Plan 09-06 verify-empty-state-coverage.sh falsifier.)
- SC-3: Every top-level route is wrapped in an error boundary; a simulated error shows a recovery affordance (retry / reset / report), never an unhandled crash. (Plan 09-02 MainShell wrap + Plan 09-06 error-boundary-recovery.spec.ts falsifier.)
- SC-4: `⌘?` opens the shortcut help panel; every route has at least its primary shortcut documented and functional. (Plan 09-05 Task 3 + Mac-smoke M-46 falsifier.)
- SC-5: WCAG AA 4.5:1 contrast confirmed on all 5 representative wallpapers across all 59 routes; Voice Orb sustains 60fps on integrated GPU through all 4 phase transitions. (Plan 09-06 extended audit-contrast.mjs + Mac-smoke M-41..M-43 + Phase 4 M-13 re-run.)

**From Phase 8 documented deferrals (closed in Plan 09-01):**
- D-203 DNA direct write — closed by `dna_set_identity` backfill.
- D-205 ApprovalQueue reject — closed by `hive_reject_decision` backfill.
- D-205 AiDelegate feedback backend — closed by `delegate_feedback` backfill.
- D-205 HiveStatus per-head pending_decisions wire — closed by frontend rewire (data already in response).

**Migration ledger alignment (Plan 09-06 flips Pending → Shipped):**
- As Phases 1–8 close via their own SUMMARY commits, the ledger rows should already be flipped. Plan 09-06 runs `scripts/verify-migration-ledger.mjs` and asserts all 79 Pending rows → Shipped.

**CHANGELOG content for v1 release notes (Plan 09-06 Task 3):**
- Added: 82 routes, 12 clusters, 16 Tauri wrappers, 73+ typed Rust events, 12 primitives, 14+ verify scripts, 29+ Playwright specs.
- Changed: full skin rebuild from src.bak (0 imports; D-17).
- Fixed: Phase 8 deferrals (4) per Plan 09-01 backfill.
- Deferred (v1.1 candidates): save_config_cmd unification, per-pane error boundaries, mobile responsive, ComingSoonSkeleton cards in Canvas + ApprovalQueue dismiss.

</specifics>

<deferred>
## Deferred Ideas (post-V1 / v1.1 candidates)

- **`save_config_cmd` unification** — `save_config` (helper) + `save_config_field` (command) serve overlapping purposes. v1.1 refactor candidate.
- **Per-pane error boundaries** — Phase 9 ships per-route MVP. Per-pane isolation is v1.1.
- **Mobile / responsive layouts** — desktop-first; responsive redesign is v1.1.
- **ComingSoonSkeleton removal in Canvas + ApprovalQueue dismiss** — left per D-212; real features are v1.1.
- **SVG anatomical body diagram** — Phase 8 D-201 deferred; v1.1 candidate.
- **HiveMesh DAG visualization** — Phase 8 D-204 deferred; v1.1 candidate.
- **WorldModel git operations** — Phase 8 deferred; v1.1 candidate.
- **Full per-cluster axe-core accessibility test** — Phase 9 ships targeted a11y sweep spec (Plan 09-06); full per-component axe audit is v1.1.
- **Exhaustive per-route Playwright coverage** — Phase 9 ships 5 new specs focused on horizontal concerns; exhaustive per-route parity is v1.1.
- **Version bump + app-store prep** — operator decision per D-227.
- **RETROSPECTIVE.md** — `.planning/RETROSPECTIVE.md` creation is NOT Phase 9; it's a follow-on operator task after Mac-smoke signs off.
- **ARIA live region for Toast** — existing ToastViewport uses `aria-live` already (spot-verified Phase 1); Phase 9 audits for regressions.
- **High-contrast mode theme** — not in POL-01..10 scope; v1.1 candidate.
- **Storybook / component gallery** — `src/features/dev/Primitives.tsx` already serves as dev showcase; full Storybook is v1.1.

</deferred>

<mac_session_items>
## Mac-Session Verification Items (Operator Handoff — extends Phase 1..8 list)

These checks cannot be verified in the sandbox. Carry forward to the final operator checkpoint run (bundled with Phase 1 WCAG + Phase 2 Operator smoke + Phase 3..8 Mac-smoke per STATE.md strategy). Plan 09-06 Task 4 adds M-41..M-46.

- **M-41:** `npm run tauri dev` launches; navigate to `/dashboard`. Measure dashboard first paint via about:tracing — confirm ≤ 200ms on integrated GPU (tight P-01 target; POL-05 / SC-5 direct falsifier).
- **M-42:** Navigate to `/chat`; send a long message that triggers model streaming at ≥ 50 tokens/sec. Open React Profiler; confirm max render time ≤ 16ms during stream (tight P-01 target). No full-tree re-renders (confirm via profiler flame graph).
- **M-43:** Navigate to `/agent-detail` (requires a running agent). Verify 5-minute continuous stream with no dropped rAF callbacks. Approx 100+ events. Scroll does not stutter.
- **M-44:** `npm run tauri build` on macOS produces a bundle at `src-tauri/target/release/bundle/macos/Blade.app` (or `.dmg`). Launch — confirm all 5 windows open without Rust panic; navigate to /dashboard + /chat + /body-map + /hive-mesh; no 404 fallbacks; no orphan routes (SC-1 direct falsifier).
- **M-45:** Toggle macOS System Settings → Accessibility → Display → Reduce motion ON. Launch app. Confirm no entrance animations (list-entrance class honored), no GlassSpinner `spin` rotation, no transitions longer than 0.01ms visible. Toggle OFF — animations resume.
- **M-46:** Launch app. Press `⌘?` — shortcut help panel opens. Confirm all global shortcuts (`⌘K`, `⌘,`, `⌘1`, `⌘/`, `⌘[`, `⌘]`, `Alt+Space` QuickAsk) + any route-scoped shortcuts render with their labels. Press Escape — panel closes, focus returns to NavRail (visible focus ring). Click a shortcut label — triggers navigation (SC-4 direct falsifier).

After M-41..M-46 pass, operator decides on version bump to 1.0.0 + tags a release + runs the final `release:prepare-updater` script. Phase 9 closure is at operator sign-off, NOT at Plan 09-06 completion.

</mac_session_items>

---

*Phase: 09-polish*
*Context gathered: 2026-04-18 via /gsd-plan-phase 9 --auto (no interactive discuss; defaults logged in 09-DISCUSSION-LOG.md)*
