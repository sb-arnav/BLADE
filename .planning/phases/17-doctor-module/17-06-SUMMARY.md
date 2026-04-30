---
phase: 17-doctor-module
plan: 06
subsystem: diagnostics
tags: [doctor, doctor-pane, diagnostics-tab, frontend, lazy-load, useTauriEvent, phase-17, wave-4]

# Dependency graph
requires:
  - phase: 17-doctor-module
    provides: "Plan 17-02 (3 doctor commands registered: doctor_run_full_check, doctor_get_recent, doctor_get_signal); Plan 17-05 (BLADE_EVENTS.DOCTOR_EVENT + DoctorEventPayload typed surface; orchestrator emits doctor_event on warn-tier transitions)"
provides:
  - "src/lib/tauri/admin.ts wrappers: doctorRunFullCheck() / doctorGetRecent({class?}) / doctorGetSignal({class}) — all invokeTyped, JSDoc @see -tagged to the Rust command sites; SignalClass + Severity literal unions match Rust serde rename_all wire form; DoctorSignal interface."
  - "src/features/admin/admin-rich-c.css partial: .doctor-row + 5 [data-severity=*] stripe rules (green/amber/red/unknown/error) using canonical --status-success / --a-warm / --status-error / --status-idle / --t-4 tokens; .doctor-drawer-* hierarchy. Wrapped in @layer features per the admin.css extension contract. ZERO ghost tokens — every var() reference resolves in tokens.css/typography.css/motion.css/primitives.css (verified with shell loop)."
  - "src/features/admin/DoctorPane.tsx (301 lines): lazy-loadable React component. Renders 5 collapsible severity-striped rows in locked most-volatile-first order; click opens a Dialog drawer with suggested_fix copy + JSON-pretty-printed payload + last-changed timestamp. Subscribes to BLADE_EVENTS.DOCTOR_EVENT via useTauriEvent (no raw listen). Per-row triggerRef map for focus restore on drawer close (Pitfall 5). Sparse 'All signals green' summary row when all 5 ∈ {green}. Page-level error EmptyState with retry."
  - "src/features/admin/Diagnostics.tsx +15/-3: 7th 'Doctor' tab appended (existing 6 preserved); DiagTab union extended; readInitialTab guard accepts 'doctor'; admin-rich-c.css imported; DoctorPane lazy()-imported; Suspense wrapper with ListSkeleton fallback."
affects: ["17-07 (Phase 17 verification gate runs /blade-uat against this surface to close the phase — DoctorPane is the runtime falsifier for DOCTOR-07/08/09 must-haves)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy module-scope import via lazy(() => import('./DoctorPane').then(m => ({ default: m.DoctorPane }))) — uses the named-export adapter so the module's named export DoctorPane participates in code-splitting without a default export."
    - "Per-row ref map memoized with useMemo at component scope (one ref object per signal class), passed to <DoctorRow> via rowRef prop and consumed by Dialog as triggerRef. This avoids the v1.1 Pitfall 5 anti-pattern where a single shared ref produced wrong focus restore on lazy-load reconciliation."
    - "useTauriEvent<DoctorEventPayload>(BLADE_EVENTS.DOCTOR_EVENT, handler) is the ONLY listen surface in DoctorPane — D-13 / Plan 09 ESLint no-raw-tauri rule is honored. Handler uses signalsRef.current to avoid stale-closure on rapid event bursts; it merges the new severity into the matching row in place (no full refetch on each event)."
    - "@layer features wrapper on admin-rich-c.css mirrors admin-rich-b.css verbatim — Plan 07 established the contract that admin.css partials NEVER bypass the feature layer (reduces specificity-cascade surprises)."
    - "data-severity attribute drives stripe color via [data-severity=*] selectors — pure CSS, no JS-side color mapping. Severity-token-only pattern (canonical --status-success / --a-warm / --status-error / --status-idle / --t-4) matches the v1.1 retraction rule that ghost tokens like --severity-* are forbidden."
    - "5-edit surgical insert into Diagnostics.tsx preserves all 6 existing tabs verbatim — additive-only, no rename / reorder. The 'Doctor' tab is the LAST entry per UI-SPEC § 4.1 'least disruptive to muscle memory'."
    - "Per-component CSS import: admin-rich-c.css is imported INSIDE Diagnostics.tsx (not globally) — the Doctor pane styles only load when the Diagnostics route mounts. Matches admin-rich-b.css scoping."
    - "Sparse 'All signals green' affordance is rendered as a non-interactive .doctor-row.doctor-row--summary (pointer-events: none, cursor: default) in addition to (not replacing) the 5 row buttons — D-13 sparse-state from the plan."

key-files:
  created:
    - "src/features/admin/admin-rich-c.css (+189): @layer features partial, .doctor-row + 5 severity-stripe rules + .doctor-drawer-* hierarchy."
    - "src/features/admin/DoctorPane.tsx (+301): the Doctor pane component."
  modified:
    - "src/lib/tauri/admin.ts (+71): doctorRunFullCheck / doctorGetRecent / doctorGetSignal wrappers + SignalClass / Severity literal unions + DoctorSignal interface, appended after the tool_forge section."
    - "src/features/admin/Diagnostics.tsx (+15/-3): 5 surgical edits — lazy + Suspense added to React imports, admin-rich-c.css import + module-scope lazy DoctorPane, DiagTab type extended, readInitialTab guard extended, ['doctor', 'Doctor'] tuple appended, Suspense + DoctorPane render branch added."

key-decisions:
  - "TS RefObject<HTMLButtonElement> map needs a tiny cast: `{ current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>`. React's type for RefObject expects current to be `T` (or `T | null` only on MutableRefObject), and the per-row stable ref pattern needs a one-time cast to satisfy the tsc strict mode. Documented inline; no `any` introduced."
  - "Display names locked verbatim per UI-SPEC § 14.3: 'Eval Scores', 'Capability Gaps', 'Tentacle Health', 'Config Drift', 'Auto-Update'. ROW_ORDER constant locks the most-volatile-first sequence (eval_scores → capability_gaps → tentacle_health → config_drift → auto_update) regardless of backend ordering — defensive against backend Vec reorder."
  - "Page-level error state (catch in refresh()) renders an EmptyState with 'Doctor unavailable' label + retry CTA — avoids leaving a blank pane when the Tauri command fails. Per-task UAT will confirm this branch when the user disables the doctor module via debug config."
  - "Drawer payload renders via JSON.stringify(payload, null, 2) inside <pre className='doctor-drawer-payload-pre'> — React text-content interpolation auto-escapes; no innerHTML / unsafe sinks anywhere. T-17-02 information-disclosure threat mitigated as planned."
  - "Suggested-fix copy renders via {openSignal.suggested_fix} text-content interpolation — same React escaping. T-17-02 XSS threat mitigated; the strings come from doctor.rs static &'static str constants per UI-SPEC § 15."
  - "BLADE_EVENTS.DOCTOR_EVENT subscription identity is stable: the handler closure is recreated each render but the ref-pattern in useTauriEvent (handlerRef.current = handler) means the listen() call is invoked exactly once per mount. The signalsRef pattern in DoctorPane avoids stale-closure on signals[] reads inside the handler."
  - "Re-run all checks button calls refresh(true) which sets refreshing=true (NOT loading=true) so the existing list stays rendered while the wallclock cycles — matches IntegrationStatus.tsx UX. ListSkeleton only renders on initial load when orderedSignals is empty."
  - "lazy() module-scope placement (top of file, NOT inside the Diagnostics component) per React rule — placing lazy() inside a component re-creates the lazy module identity on every render, defeating the code-split."
  - "5 surgical edits use Edit tool (not Write) to preserve every existing tab definition verbatim — no rename, no reorder, additive-only. UI-SPEC § 4.1 muscle-memory rule is enforced at the diff level."

patterns-established:
  - "Phase-17 frontend authoring convention: every new component is wired through the existing Diagnostics tabs surface, NOT a new top-level route. CONTEXT.md D-10 dictates Doctor as a sub-tab; this plan honors it."
  - "Per-row stable ref pattern (one rowRef per row, never shared) — Pitfall 5 prevention. Future Phase 17 plans (or v1.3 Doctor enhancements) that add row-level interaction MUST follow this pattern."
  - "Severity-stripe via data-severity attribute + [data-severity=*] CSS selector — pure CSS, no JS color mapping. Future severity-tier UI (e.g. Capability Reports) can copy this pattern to avoid scattering color logic in component code."
  - "admin-rich-{a,b,c}.css naming convention: per-route partials extend admin.css via @layer features + scoped @import inside the consuming component. admin-rich-c.css is the third in this series; 17-06 follows the shape established by 07-05 / 07-06."

requirements-completed: [DOCTOR-07, DOCTOR-08, DOCTOR-09]

# Metrics
duration: ~9min execution + ~3min tsc cycles (3 total) + ~2min token-consistency / grep audits
completed: 2026-04-30
---

# Phase 17 Plan 06: Frontend Doctor pane Summary

## One-liner

DoctorPane.tsx + admin-rich-c.css + admin.ts wrappers + 5 surgical Diagnostics.tsx edits land Phase 17's UI surface — 5 severity-striped collapsible rows, click-to-open Dialog drawer with raw payload + suggested_fix, useTauriEvent live updates, ZERO ghost tokens, tsc clean.

## What Shipped

### Tauri wrappers (src/lib/tauri/admin.ts)

3 type-safe wrappers + 3 supporting types appended to the doctor section banner of admin.ts:

```typescript
export type SignalClass =
  | 'eval_scores' | 'capability_gaps' | 'tentacle_health' | 'config_drift' | 'auto_update';
export type Severity = 'green' | 'amber' | 'red';
export interface DoctorSignal {
  class: SignalClass;
  severity: Severity;
  payload: unknown;
  last_changed_at: number;  // unix ms
  suggested_fix: string;
}

export function doctorRunFullCheck(): Promise<DoctorSignal[]>;
export function doctorGetRecent(args: { class?: SignalClass | null }): Promise<DoctorSignal[]>;
export function doctorGetSignal(args: { class: SignalClass }): Promise<DoctorSignal | null>;
```

Each wrapper:
- Uses `invokeTyped` (not raw `invoke`) per D-186 / Plan 09 ESLint rule.
- JSDoc `@see` cite to `src-tauri/src/doctor.rs::*` so the Rust contract stays discoverable.
- Literal unions are locked to Rust's `#[serde(rename_all = "snake_case")]` for `SignalClass` and `#[serde(rename_all = "lowercase")]` for `Severity` — drift caught at code-review time per D-38-payload.

### admin-rich-c.css partial (src/features/admin/admin-rich-c.css)

189 lines, wrapped in `@layer features { ... }` per the admin.css extension contract (admin.css:5).

5 severity stripe rules using canonical tokens:

```css
.doctor-row[data-severity="green"]   { border-left: 4px solid var(--status-success); }
.doctor-row[data-severity="amber"]   { border-left: 4px solid var(--a-warm); }
.doctor-row[data-severity="red"]     { border-left: 4px solid var(--status-error); }
.doctor-row[data-severity="unknown"] { border-left: 4px solid var(--status-idle); }
.doctor-row[data-severity="error"]   { border-left: 4px solid var(--t-4); }
```

Drawer hierarchy: `.doctor-drawer.dialog`, `.doctor-drawer-header`, `.doctor-drawer-title`, `.doctor-drawer-meta`, `.doctor-drawer-close`, `.doctor-drawer-body`, `.doctor-drawer-section-label`, `.doctor-drawer-fix-copy`, `.doctor-drawer-payload-pre`, `.doctor-drawer-footer`.

### DoctorPane.tsx component (src/features/admin/DoctorPane.tsx)

301 lines. Default-exported via lazy() compatible named export `DoctorPane`.

Structure:
- `DISPLAY_NAME` map locks the verbatim per-class display strings (Eval Scores, Capability Gaps, Tentacle Health, Config Drift, Auto-Update).
- `ROW_ORDER` array locks the most-volatile-first row sequence.
- `badgeTone()` maps severity → Badge primitive tone (green→ok, amber→warn, red→hot).
- `formatTimestamp()` produces relative-then-absolute output ('just now' / 'N minutes ago' / 'HH:MM:SS · YYYY-MM-DD').
- `DoctorRow` sub-component renders one button per signal with `data-severity` attribute, Badge, meta, chevron, aria-label.
- `DoctorPane` (the export) holds:
  - `signals` state + `loading` / `refreshing` / `error` / `openClass` flags.
  - `rowRefs` memoized map (one stable ref per SignalClass — Pitfall 5).
  - `refresh(manual)` callback wraps `doctorRunFullCheck()` with try/catch/finally.
  - `useEffect(() => void refresh(false), [refresh])` for initial mount.
  - `useTauriEvent<DoctorEventPayload>(BLADE_EVENTS.DOCTOR_EVENT, handleEvent)` — the ONLY subscription surface in this file.
  - `orderedSignals` memo sorts by ROW_ORDER and filters undefined.
  - `allGreen` flag drives the sparse 'All signals green — last checked …' summary row (D-13).
- Render: toolbar (last-checked timestamp + Re-run all checks button) → either ListSkeleton (initial load) or `.doctor-row-list` with optional summary row + 5 DoctorRow buttons → Dialog drawer (only when `openSignal` is non-null).

### 5 surgical edits to Diagnostics.tsx (src/features/admin/Diagnostics.tsx)

Cited line numbers reference the post-edit file:

1. **Line 15** — React imports extended:
   ```typescript
   import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
   ```

2. **Lines 45–48** — admin-rich-c.css import + module-scope lazy DoctorPane (after the existing `import './admin-rich-b.css';`):
   ```typescript
   import './admin-rich-c.css';

   const DoctorPane = lazy(() =>
     import('./DoctorPane').then((m) => ({ default: m.DoctorPane }))
   );
   ```

3. **Line 51** — DiagTab union extended:
   ```typescript
   type DiagTab = 'health' | 'traces' | 'authority' | 'deep' | 'sysadmin' | 'config' | 'doctor';
   ```

4. **Line 66** — readInitialTab guard extended (`|| t === 'doctor'` appended).

5. **Line 158** + **lines 185–189** — tab tuple entry + render branch:
   ```typescript
   ['doctor', 'Doctor'],   // 7th + last entry, UI-SPEC § 4.1 muscle-memory
   ```
   ```jsx
   {tab === 'doctor' && (
     <Suspense fallback={<ListSkeleton rows={5} rowHeight={56} />}>
       <DoctorPane />
     </Suspense>
   )}
   ```

`ListSkeleton` was already imported at line 16 from `@/design-system/primitives` so no import edit was needed.

## Verification

**tsc:** `npx tsc --noEmit` exits 0. (verified after each task + final pass)

**Ghost-token audit on admin-rich-c.css:**
- `grep -E 'var\(--(severity|doctor|stripe)' src/features/admin/admin-rich-c.css` returns empty (CLEAN).
- For-loop over every `var(--*)` reference resolved against `tokens.css` / `typography.css` / `motion.css` / `primitives.css`: 0 MISSING.
- Tokens used: `--status-success`, `--a-warm`, `--status-error`, `--status-idle`, `--t-1`, `--t-2`, `--t-3`, `--t-4`, `--line`, `--g-fill-weak`, `--g-edge-mid`, `--s-1`, `--s-2`, `--s-3`, `--s-4`, `--s-12`, `--r-md`, `--r-sm`, `--font-body`, `--font-mono`, `--dur-fast`, `--dur-base`, `--ease-out`. All canonical, all present.

**Token-consistency script:** `node scripts/verify-tokens-consistency.mjs` → `OK — scanned 245 .css/.tsx files; all padding/margin/gap/font-size on ladder.` (exit 0)

**Raw `listen()` audit:** `grep -c "from '@tauri-apps/api/event'" src/features/admin/DoctorPane.tsx` → 0. Subscription surface is exclusively `useTauriEvent` from `@/lib/events`.

**5 Diagnostics.tsx edits — grep verification:**
- `lazy + Suspense in import line` — present.
- `admin-rich-c.css import` — 1 hit.
- `lazy(() =>` — 1 hit.
- `import('./DoctorPane')` — 1 hit.
- `DiagTab union with 'doctor'` — present.
- `['doctor', 'Doctor']` — 1 hit.
- `'doctor'` literal hits at lines 51, 66, 158, 185 (4 sites: type union, readInitialTab guard, tuple, render branch).
- `<DoctorPane />` — 1 hit.
- `<Suspense fallback={<ListSkeleton rows={5} rowHeight={56} />}>` — 1 hit.

## Deviations from Plan

**One minor adaptation** (not a deviation, type-system necessity):

The per-row ref map (Pitfall 5 mitigation) needs a tiny TypeScript cast because `React.RefObject<T>['current']` is typed as `T` (or `T | null` only on `MutableRefObject`):

```typescript
eval_scores: { current: null as HTMLButtonElement | null } as React.RefObject<HTMLButtonElement>,
```

The plan's spec showed `{ current: null }` which TypeScript strict-mode rejects with `error TS2322: Type 'null' is not assignable to type 'HTMLButtonElement'`. The cast is one-time, no `any` introduced, and the runtime semantics are identical. This is a stable pattern Plan 17-06 establishes for future per-row ref consumers in Phase 17.

No other deviations. No CLAUDE.md violations. No ghost tokens. No raw `listen()`.

## Threat Surface — No New Flags

Plan 17-06 does NOT introduce any new trust boundary surface beyond what the plan's `<threat_model>` declared:

- T-17-02 (info disclosure / XSS) — mitigated by React text-content interpolation in `<pre>` (JSON.stringify) and `<div>` (suggested_fix). No unsafe HTML sinks anywhere in the file.
- T-17-04 (listener leak) — mitigated by `useTauriEvent` automatic cleanup (P-06 pattern).
- T-17-03 (wire-form drift) — mitigated by tsc compile-time check + Plan 17-07 `/blade-uat` runtime check.
- Per-row refs (Pitfall 5) — addressed structurally by `useMemo` over a fixed Record keyed by SignalClass.

No new endpoints, no schema changes, no auth path additions, no file-access patterns. Frontend-only consumer of pre-existing Tauri commands.

## Self-Check: PASSED

- [x] `src/lib/tauri/admin.ts` updated, exports `doctorRunFullCheck` / `doctorGetRecent` / `doctorGetSignal` / `SignalClass` / `Severity` / `DoctorSignal`. Commit `476032e`.
- [x] `src/features/admin/admin-rich-c.css` exists, 189 lines, @layer features wrapper, 5 severity stripes, ZERO ghost tokens. Commit `849d957`.
- [x] `src/features/admin/DoctorPane.tsx` exists, 301 lines, exports `DoctorPane`, useTauriEvent subscription, no raw listen, locked row order. Commit `faa0c35`.
- [x] `src/features/admin/Diagnostics.tsx` 5 surgical edits applied, existing 6 tabs preserved verbatim. Commit `f418c04`.
- [x] `npx tsc --noEmit` exits 0.
- [x] `node scripts/verify-tokens-consistency.mjs` exits 0.
- [x] No raw `listen()` import in DoctorPane.

## Commits

```
476032e feat(17-06): add doctor Tauri wrappers + DoctorSignal types in admin.ts
849d957 feat(17-06): add admin-rich-c.css partial for Doctor pane
faa0c35 feat(17-06): add DoctorPane.tsx component for Diagnostics sub-tab
f418c04 feat(17-06): wire 7th 'Doctor' sub-tab in Diagnostics.tsx
```

## Hand-off to Plan 17-07

Plan 17-07 is the Phase 17 verify-eval gate that closes the phase. It runs `/blade-uat` against the Doctor sub-tab + verifies the runtime event flow (doctor_event → DoctorPane state update → ActivityStrip line) end-to-end. Plan 17-06 provides:

- A clickable Doctor sub-tab inside the Diagnostics route (URL: prefs['admin.activeTab']='diag:doctor').
- 5 severity-striped rows in locked order, each clickable to open a Dialog drawer.
- Auto-pull on tab mount + manual 'Re-run all checks' button + live useTauriEvent subscription.
- Sparse 'All signals green' empty state when all 5 signals are healthy.
- Page-level error EmptyState with retry CTA when the Tauri command fails.

Plan 17-07's UAT checklist (UI-SPEC § 17) can validate each of these on the running binary. The 16-box UAT matrix is unchanged.
