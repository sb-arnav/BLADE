# Phase 10: Inventory & Wiring Audit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `10-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 10-inventory-wiring-audit
**Areas discussed:** All four gray areas auto-resolved under user delegation ("idk whatever you say")

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Artifact shape + row depth | Single `WIRING-AUDIT.md` vs split files; JSON sidecar for Phase 14; per-row depth (git-blame age, caller graph, safe-to-delete flag) | ✓ (delegated) |
| Classification heuristic + tester-pass cross-ref | Static grep vs runtime trace; threshold for 'never triggered'; internal-only Rust-to-Rust modules; tester-pass evidence as ground truth | ✓ (delegated) |
| Scope of routes + config | Routes: router.ts + palette + overlays + onboarding. Config: BladeConfig + AtomicBool + env + Cargo flags | ✓ (delegated) |
| Execution mode | 3 parallel subagents + inline synthesis vs sequential one-shot vs incremental checkpoints | ✓ (delegated) |

**User's response:** *"idk whatever you say"*
**Notes:** User delegated all Phase 10 gray-area decisions to Claude. Pragmatic defaults grounded in Phase 0 precedent (D-17/D-18/D-19) and AUDIT-01..05 falsifiable success criteria were applied.

---

## Area 1: Artifact Shape + Row Depth

| Option | Description | Selected |
|--------|-------------|----------|
| Single monolithic `10-WIRING-AUDIT.md` | Mirrors Phase 0 `RECOVERY_LOG.md`; reviewable in one pass | ✓ |
| Split per-category files | Separate files for modules, routes, config | |
| No sidecar | Markdown tables only, no JSON | |
| JSON sidecar | `10-WIRING-AUDIT.json` for Phase 14 + Phase 15 programmatic ingest | ✓ |
| Rich per-row (git-blame age, cargo-tree) | Every row carries deep metadata | |
| Minimum-useful per-row | Only what Phase 14 needs; DEAD rows get caller/import/safe-flag; ACTIVE rows get representative reachable path | ✓ |

**Decision → D-46 / D-47.** Single monolithic Markdown + JSON sidecar + minimum-useful row depth. Git-blame and cargo-tree available on-demand; bloating every row is cost without Phase 14 benefit.

---

## Area 2: Classification Heuristic + Tester-Pass Cross-Ref

| Option | Description | Selected |
|--------|-------------|----------|
| Static grep of `invoke("cmd")` + event listeners | No runtime trace required | ✓ |
| Runtime trace | Instrument app, exercise flows, log what fires | |
| Skip internal Rust-to-Rust modules | Only tag commands/events visible to frontend | |
| Tag internal modules ACTIVE with `internal` trigger note | Preserves visibility of internal callers | ✓ |
| Seed with tester-pass evidence | Pre-load 7 known symptoms; contradict-on-conflict rather than silently override | ✓ |
| Ignore tester-pass evidence | Pure static-analysis output | |

**Decision → D-48.** Static-first; internal callers tagged ACTIVE with trigger annotation; tester-pass symptoms seed expected NOT-WIRED/WIRED-NOT-USED rows and flag static-vs-symptom conflicts rather than silently picking one.

---

## Area 3: Scope of Routes + Config

| Option | Description | Selected |
|--------|-------------|----------|
| Routes = ROUTE_MAP only | Just `src/lib/router.ts` entries | |
| Routes = ROUTE_MAP + palette + overlay windows + onboarding sub-views | Full user-facing reachable surface | ✓ |
| Enumerate every dialog/modal as route | Flat enumeration | |
| Dialogs listed under parent with `triggered_from` | Keeps route table readable | ✓ |
| Config = BladeConfig only | Minimal scope | |
| Config = BladeConfig + siblings + AtomicBool + env + Cargo features | Full discoverable configuration surface | ✓ |

**Decision → D-49.** Full coverage with dialogs nested under parent routes; config includes undocumented static toggles, env vars, and Cargo feature flags (these ARE config, just unsurfaced). Also noted: there is no single `App.tsx` — the 5 window shells under `src/windows/{main,quickask,hud,ghost,overlay}/main.tsx` host command-palette entries. CLAUDE.md reference is outdated.

---

## Area 4: Execution Mode

| Option | Description | Selected |
|--------|-------------|----------|
| 3 parallel subagents + Claude synthesis (Phase 0 D-18 pattern) | Subagent A (modules), B (routes + palette), C (config) | ✓ |
| Sequential Claude one-shot | One pass over everything | |
| Incremental per-category commits with mid-phase user checkpoints | Review after each category | |
| No mid-phase checkpoints | Ship one artifact, review post-write | ✓ |

**Decision → D-50.** Mirrors Phase 0 D-18. Three parallel subagents for mechanical extraction, Claude does cross-cut synthesis, NOT-WIRED backlog, DEAD deletion plan, Appendix A (tester-pass map), and JSON sidecar generation. Subagent retry, not phase retry, on malformed outputs.

---

## Claude's Discretion

- Exact subagent prompt wording and section formatting within `10-WIRING-AUDIT.md` (tables for catalogs, prose for cross-cuts, code blocks for `file:line`).
- Handling of `agents/` subdirectory — flat list vs nested section (recommend nested for scan-ability).
- Whether DEAD Deletion Plan ships in a separate commit after initial audit (recommend: same commit — atomic artifact).
- JSON sidecar schema evolution — if Phase 14 needs a missing field, patch the schema without re-auditing.

## Deferred Ideas

None raised this session. Scope-adjacent items already covered by downstream phases:
- Capability-gap empty states → Phase 11 (PROV-07/08)
- Activity log instrumentation → Phase 14 (LOG-02)
- Acting-tentacle capability → v1.2+ (M-03)
