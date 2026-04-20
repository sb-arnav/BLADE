---
phase: 10
slug: inventory-wiring-audit
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Domain:** Read-only audit. Falsifiable validation gates check the **structural integrity** of the audit artifacts (Markdown + JSON sidecar), not behavioral correctness — Phase 10 produces no runtime behavior.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js + `zod 3.25.76` (already in `package.json`) + bash shell |
| **Config file** | `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` (committed in this phase) |
| **Quick run command** | `node scripts/verify-wiring-audit-shape.mjs` |
| **Full suite command** | `npm run verify:all` (existing 18 gates + new wiring-audit-shape gate) |
| **Estimated runtime** | ~2 seconds for shape gate; ~90 seconds for full `verify:all` |

---

## Sampling Rate

- **After every task commit:** Run `node scripts/verify-wiring-audit-shape.mjs` (only after the shape gate exists; pre-existence runs `node -e "JSON.parse(require('fs').readFileSync('.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json', 'utf8'))"` as parse-only fallback)
- **After every plan wave:** Run `npm run verify:all` (full chain)
- **Before `/gsd-verify-work`:** `verify:all` must be green AND `10-WIRING-AUDIT.md` + `10-WIRING-AUDIT.json` + `10-WIRING-AUDIT.schema.json` exist
- **Max feedback latency:** 2 seconds for shape gate; 90 seconds for full chain

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 0 | AUDIT-04, AUDIT-05 | — | N/A — read-only audit | integrity | `node scripts/verify-wiring-audit-shape.mjs --self-test` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 0 | AUDIT-01..05 | — | N/A | schema | `node -e "import('zod').then(z=>{const s=JSON.parse(require('fs').readFileSync('.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json','utf8'));console.log('schema ok',Object.keys(s).length)})"` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 1 | AUDIT-01 | — | N/A | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=modules` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 1 | AUDIT-04 | — | N/A | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=not-wired` | ❌ W0 | ⬜ pending |
| 10-02-03 | 02 | 1 | AUDIT-05 | — | N/A | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=dead` | ❌ W0 | ⬜ pending |
| 10-03-01 | 03 | 1 | AUDIT-02 | — | N/A | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=routes` | ❌ W0 | ⬜ pending |
| 10-04-01 | 04 | 1 | AUDIT-03 | — | N/A | integrity | `node scripts/verify-wiring-audit-shape.mjs --check=config` | ❌ W0 | ⬜ pending |
| 10-05-01 | 05 | 2 | AUDIT-01..05 | — | N/A | synthesis | `node scripts/verify-wiring-audit-shape.mjs && test -f .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md && test -f .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` | ❌ W0 | ⬜ pending |
| 10-05-02 | 05 | 2 | AUDIT-01..05 | — | N/A | end-to-end | `npm run verify:all` (must include `verify:wiring-audit-shape`) | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Task IDs are placeholders; planner will refine in PLAN frontmatter. The mapping pattern (every AUDIT-xx → automated `verify-wiring-audit-shape.mjs --check=<dimension>` invocation) is the contract.

---

## Wave 0 Requirements

- [ ] `scripts/verify-wiring-audit-shape.mjs` — new Node.js script. Loads `10-WIRING-AUDIT.json`, validates against `10-WIRING-AUDIT.schema.json` using zod. Subcommands:
  - `--self-test` — schema validates an empty-but-shape-correct fixture
  - `--check=modules` — `modules.length` matches the live count of `.rs` files under `src-tauri/src/` (excludes `build.rs`)
  - `--check=routes` — `routes.length` matches `ALL_ROUTES.length` extracted from `src/windows/main/router.ts`
  - `--check=config` — every `pub <field>:` line in `src-tauri/src/config.rs` `BladeConfig` block appears in `config[]`
  - `--check=not-wired` — every `not_wired_backlog[i].backend_entry_points[]` is non-empty AND every entry matches `.+:[0-9]+$`
  - `--check=dead` — every `dead_deletion_plan[i]` has `callers[]`, `imports[]`, `safe_to_delete: boolean` present
- [ ] `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` — JSON Schema (Draft 2020-12) committed alongside the audit artifact, mirroring the zod schema 1:1
- [ ] `package.json` script: `"verify:wiring-audit-shape": "node scripts/verify-wiring-audit-shape.mjs"` added to `scripts` block
- [ ] `verify:all` chain extended: append `&& npm run verify:wiring-audit-shape` (or include via the existing chain mechanism)

**No framework install needed** — `zod` already in `package.json`, Node.js native to the dev workflow.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tester-pass evidence cross-reference (Appendix A) is *plausible* | AUDIT-01..05 (cross-cut) | Mapping symptom → module requires holistic judgment; no static check resolves "this NOT-WIRED row plausibly explains symptom #4" | Read `10-WIRING-AUDIT.md` Appendix A. Each of the 7 symptoms in `notes/v1-1-milestone-shape.md` §"Why this framing" must reference at least 1 row from the catalog with a one-line rationale. |
| Classification calls (`ACTIVE`/`WIRED-NOT-USED`/`NOT-WIRED`/`DEAD`) match D-48 heuristic intent | AUDIT-01..03 | Static checks confirm a row exists with a tag; only human review confirms the tag is *correct* per D-48 | Spot-check 10 rows per classification per surface (modules / routes / config). For each: trace one literal call site (or absence) to confirm the tag. |
| `Appendix B (Deferred-to-v1.2)` rationale is sound | AUDIT-04 | `"deferred to v1.2"` annotation is a judgment call; static checks only confirm presence | Review every Appendix B entry. Each must have one line of rationale tying it to M-03 (acting-tentacle deferred) or another locked v1.1-out-of-scope decision. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (script, schema, package.json wiring)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s for full chain, < 2s for shape gate
- [ ] `nyquist_compliant: true` set in frontmatter once planner has authored task IDs that match this map

**Approval:** pending
