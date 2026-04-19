# Phase 9 — Discussion Log (AUTO MODE — no interactive session)

**Invocation:** `/gsd-plan-phase 9 --auto`
**Date:** 2026-04-18
**Mode:** Planner picks defensible defaults to maintain phase velocity. All defaults are logged here, and every new decision also lands in `09-CONTEXT.md` as `D-211..D-230`.

Prior locked decisions `D-01..D-210` (Phase 1–8 CONTEXT files) are treated as non-negotiable constraints. This log captures only the NEW choices the planner made for Phase 9.

Phase 9 is the **FINAL phase**. It is audit-shaped, NOT cluster-shaped — so the Phase 5/6/7/8 seven-plan template does NOT apply. Planner designs a 6-plan shape derived from the 10 POL-01..10 requirements and the horizontal concerns they imply.

---

## Source inputs consulted

- `.planning/ROADMAP.md` Phase 9 §Requirements (POL-01..10) + §Success Criteria 1–5
- `.planning/STATE.md` — Phase 1..8 substrate inventory
- `.planning/migration-ledger.md` — 82 rows (3 Shipped, 79 Pending as of Phase 1 end; real counts at runtime will be 79 Shipped by Phase 8 close)
- `.planning/phases/01..08/*-CONTEXT.md` — D-01..D-210 locked
- `.planning/phases/08-body-hive/08-CONTEXT.md` §deferred — source for Plan 09-01 Rust backfill decisions
- `.planning/phases/08-body-hive/08-PATTERNS.md` §7 Playwright + §8 verify script recipes — inherited verbatim
- `src/windows/main/MainShell.tsx` — 135 lines; the SINGLE writer site for ErrorBoundary wrap
- `src/design-system/primitives/*` — 9 existing primitives; Phase 9 adds 3
- `src/styles/motion.css` — 34 lines; Phase 9 creates sibling motion-a11y.css + motion-entrance.css
- `src/features/**/*.tsx` — scanned for empty-state baseline (275 hits of `empty|no data` across 93 files — many are already-string fallbacks that Phase 9 standardizes)
- `src/design-system/primitives/index.ts` — 9 existing exports; Phase 9 adds 3
- `src-tauri/src/lib.rs:1284-1338` — generate_handler![] registration site (Phase 9 adds 3 entries in Plan 09-01)
- `src-tauri/src/hive.rs:3259-3296` — `hive_approve_decision` pattern source for `hive_reject_decision`
- `scripts/verify-*` — 14 existing scripts; Phase 9 adds 4
- `tests/e2e/*` — 25 existing specs; Phase 9 adds 5
- `package.json` — version 0.7.9 (stays)
- `src-tauri/Cargo.toml` + `tauri.conf.json` — version 0.7.9 (stays)

---

## Decision points + planner choices

### DP-1: How many plans + what wave structure?

**Options considered:**
- (a) Mirror Phase 5/6/7/8 seven-plan cluster template. Rejected — Phase 9 is audit-shaped, not cluster-shaped; no wrapper + routes + Playwright structure to mirror.
- (b) One plan per POL-01..10 requirement (10 plans). Rejected — 10 requirements collapse into 6 clustered concerns (Rust backfill, error/empty primitives, a11y, motion+consistency, perf+prod-build, final verification).
- (c) 6 plans across 4 waves (CHOSEN). Matches the audit shape — each plan is a horizontal concern with a single theme.

**Choice:** 6 plans across 4 waves (D-228).

**Trade-off accepted:** Plan 09-02 and Plan 09-04 both do empty-state sweeps but across DIFFERENT feature clusters (D-229 disjoint-ownership split). This avoids a giant single empty-state plan that would consume >50% context. Consequence: two plan SUMMARYs each list empty-state swaps; the Phase-9 retrospective cross-links them.

---

### DP-2: Rust gap backfill — what to include, what to defer?

**Options:**
- (a) Backfill all 5 known deferred gaps (save_config_cmd, hive_reject_decision, delegate_feedback, dna_set_identity, HiveStatus per-head wire). Rejected — HiveStatus per-head wire is ALREADY in response (grep confirms `heads[].pending_decisions` at hive.rs:194, 3078, 3089); no Rust change needed. save_config_cmd is redundant (save_config_field already commands). So only 3 genuinely-new Rust additions.
- (b) Backfill zero; defer everything to v1.1. Rejected — closing the 3 Phase-8 documented deferrals costs ~70 Rust LOC total and yields 3 visible UX improvements (Dismiss → Reject, DNA save, AiDelegate persisted feedback) — good ROI at Phase 9 polish.
- (c) Backfill 3 surgical additions (CHOSEN — D-213). `hive_reject_decision` + `dna_set_identity` + `delegate_feedback`.

**Choice:** 3 Rust additions (D-213), zero-Rust invariant partially relaxed (D-214). Backfill is scope-scoped polish, not domain-scoped expansion.

**Trade-off accepted:** Plan 09-01 becomes a Rust + frontend-wiring plan. Tasks: 1 Rust change (3 commands + 1 lib.rs edit), 1 wrapper additions, 3 frontend edits to ApprovalQueue + DNA + AiDelegate to call the new commands. ~4 tasks, ~35% context.

---

### DP-3: ErrorBoundary granularity — per-route vs per-pane?

**Options:**
- (a) Per-route (single boundary around route component). CHOSEN — satisfies SC-3 minimally; <50 LOC; 1 file edit in MainShell. v1.1 can add per-pane boundaries inside a crashed route.
- (b) Per-pane (each major sub-panel has its own boundary). Rejected — explodes into a sweep across ~30 feature files; exceeds plan budget.

**Choice:** Per-route MVP (D-218).

**Trade-off accepted:** If a crashed route is composed of multiple sub-panes (e.g., Diagnostics with 6 tabs), the whole route shows the error panel rather than just the crashed tab. This is acceptable for V1 — the recovery affordance works and prevents shell death, which is SC-3's intent.

---

### DP-4: EmptyState primitive vs per-feature local text?

**Options:**
- (a) Per-feature local text — keep existing "No data" spans. Rejected — inconsistent across routes; no cross-route style unity.
- (b) EmptyState primitive (CHOSEN — D-215). One primitive, used everywhere.

**Choice:** Primitive. Consumers import from `@/design-system/primitives` like any other primitive.

**Trade-off accepted:** ~25-30 feature files need edits. Split across 09-02 and 09-04 to honor per-plan budget (D-217 coverage table + D-229 disjoint ownership).

---

### DP-5: Motion audit — inline-edit motion.css or create siblings?

**Options:**
- (a) Inline-edit motion.css in both 09-03 (reduced-motion) and 09-04 (list-entrance). Rejected — same-wave file-conflict invariant would be violated.
- (b) Separate motion.css edits across waves (09-03 in Wave 2a, 09-04 in Wave 2b). Rejected — breaks the "Wave 2 is parallel" intent; serializes the wave.
- (c) Create siblings motion-a11y.css (09-03) + motion-entrance.css (09-04). CHOSEN — append-only new files, disjoint ownership, zero wave-2 conflict.

**Choice:** Sibling files (D-228 last paragraph).

**Trade-off accepted:** Two new CSS files. Minor import churn in `src/styles/index.css` — both 09-03 and 09-04 would add an import line, which IS a file-conflict. Mitigation: 09-03 edits `src/styles/index.css` to add the motion-a11y.css import; 09-04 does NOT edit index.css — instead, 09-04's motion-entrance.css is imported by the individual feature CSS files (e.g., `agents.css`, `body.css`) via `@import '../styles/motion-entrance.css'`. Alternative (cleaner): 09-03 edits index.css to add BOTH import lines at once. 09-04 reads a sentinel comment in index.css and appends its ownership there. CHOSEN for simplicity: Plan 09-03 includes BOTH imports in its single edit to index.css — Plan 09-04 only creates motion-entrance.css and relies on 09-03's pre-staged import. This requires 09-04 to trust 09-03's edit; enforced by both plans having `depends_on: ['09-02']` (both wave 2), and motion-entrance.css filename being pre-reserved. Acceptable.

Actually simpler: **Plan 09-03 adds the reduced-motion rules INLINE to `src/styles/motion.css`** (append-only at end of file) and **Plan 09-04 creates `src/styles/motion-entrance.css`** (new file, no overlap). This avoids the sibling CSS file for a11y. 09-04 imports motion-entrance.css from feature CSS files that need list-entrance (`agents.css`, `body.css`, `hive.css`, etc.). Plan 09-04 edits those feature CSS files (already in its scope per D-221 consistency audit). Plan 09-03 only edits motion.css (append-only) + Dialog.tsx (focus return, if needed) + icon-button files. Zero file-conflict with 09-04 because motion.css is "append-only" in 09-03's sole section, and 09-04 does not touch motion.css. CHOSEN as the final variant.

Final carve:
- **09-03 writes:** `src/styles/motion.css` (append reduced-motion section at end), `src/design-system/primitives/Dialog.tsx` (focus return if audit finds gaps), specific icon-button `.tsx` files identified by 09-03 Task 1 audit.
- **09-04 writes:** `src/styles/motion-entrance.css` (new), `src/design-system/primitives/ListSkeleton.tsx` (new), feature CSS files under body + hive + dev-tools + admin clusters (consistency audit), feature `.tsx` files under body + hive + dev-tools + admin for empty-state swap.

This is disjoint. Confirmed.

---

### DP-6: Perf budget — tight (P-01 16ms/200ms) vs loose (Playwright harness slack)?

**Options:**
- (a) Tight only — spec fails if > 16ms. Rejected — Playwright adds harness overhead; false failures in CI erode trust.
- (b) Loose Playwright + tight Mac-smoke (CHOSEN — D-223..225). CI-spec targets are relaxed (250ms/20ms/50ms-dropped-frame); tight P-01 verified in M-41..M-43 on real hardware.

**Choice:** Two-tier — CI loose + Mac-smoke tight.

**Trade-off accepted:** A regression that brings dashboard first paint from 150ms to 230ms passes CI but fails M-41. Acceptable because CI catches catastrophic regressions (1500ms) + Mac-smoke catches subtle regressions pre-release.

---

### DP-7: CHANGELOG format — Keep a Changelog vs conventional-changelog?

**Options:**
- (a) Conventional-changelog (machine-parseable). Rejected — V1 release is human-facing (website, App Store, Discord).
- (b) Keep a Changelog (keepachangelog.com) — human-readable, grouped by Added/Changed/Fixed/Deferred. CHOSEN — D-227.

**Choice:** Keep a Changelog.

---

### DP-8: Version bump — who and when?

**Options:**
- (a) Plan 09-06 bumps 0.7.9 → 1.0.0 at commit time. Rejected — planner doesn't declare V1 shipped.
- (b) Operator bumps after Mac-smoke M-41..M-46 pass. CHOSEN — D-227.

**Choice:** Operator post-phase decision. Planner leaves 0.7.9 in place in all manifests.

---

### DP-9: Sandbox prod build — run or defer?

**Options:**
- (a) Run `npm run tauri build` in sandbox. Rejected if unreliable — cargo takes 5-15min and cross-compile to macOS target from Linux needs special toolchain.
- (b) Best-effort run + document + queue to Mac-smoke. CHOSEN — D-226.

**Choice:** Plan 09-05 Task 4 attempts the build; if it succeeds, runs `verify-html-entries.mjs --prod`. If it times out or errors, the plan SUMMARY notes the failure + Mac-smoke M-44 becomes the authoritative check. Non-blocking.

---

### DP-10: Shortcut help panel — persistent vs transient?

**Options:**
- (a) Persistent — tracks open state in usePrefs. Rejected — small UX footprint; not worth a pref.
- (b) Transient Dialog — local state. CHOSEN — D-222 / D-215.

**Choice:** Transient.

---

## Sources NOT consulted (reasoning)

- Individual 1..8 plan files — summaries and CONTEXT.md are sufficient; deep-read each plan would cost 100k+ context for marginal gain.
- `src.bak/` — D-17 forbids.
- `/home/arnav/WORKSPACE.md` — BLADE-specific context in /home/arnav/blade/CLAUDE.md takes precedence (per workspace operating rules).

---

## Summary of locked decisions

- **D-211..D-230** — scope, Rust backfill, primitives, a11y, empty-state coverage, error-boundary architecture, motion audit, skeletons, consistency, shortcut help, perf budget, prod build, CHANGELOG, plan split, file-ownership, Mac-smoke.
- Plans: 09-01..09-06 (6 plans across 4 waves).
- Rust: 3 new commands.
- Primitives: 3 new (ErrorBoundary, EmptyState, ListSkeleton).
- Verify scripts: 4 new + `verify-html-entries.mjs --prod` flag.
- Playwright specs: 5 new.
- Mac smoke: M-41..M-46.
- Version: 0.7.9 (unchanged — operator bumps post-phase).

---

*Discussion completed: 2026-04-18. No interactive session — auto mode. Ready to plan.*
