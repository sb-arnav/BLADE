# Phase 12: Smart Deep Scan - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `12-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 12-smart-deep-scan
**Mode:** Auto-delegation (user response: "your call, idk" — same pattern as Phase 11)
**Areas discussed:** Lead-following algorithm, Profile surface + edit model, LLM classification boundary, Privacy + existing-scanner migration

---

## Gray-area selection question

| Option | Description | Selected |
|--------|-------------|----------|
| Lead-following algorithm | SCAN-09 core intelligence — seeds, priority tiers, stopping conditions | |
| Profile surface + edit model | SCAN-11/12 — location, grouping, round-trip semantics | |
| LLM classification boundary | Soft dep on Phase 11 — when scanner calls capability providers vs pure heuristics | |
| Privacy + existing-scanner migration | Privacy gates on sensitive classes + hard-cutover vs compat-shim for `deep_scan_start` | |

**User's choice:** "your call, idk" — full delegation, same pattern as Phase 11 CONTEXT.md.
**Notes:** Claude resolved all four gray areas using pragmatic defaults grounded in Phase 10 audit + Phase 11 D-51..D-58 + codebase scout of `deep_scan.rs` + `src/features/identity/index.tsx` + onboarding event wiring.

---

## Lead-following algorithm (D-59, D-60)

Three fundamental shapes considered:

| Option | Description | Selected |
|--------|-------------|----------|
| 12 parallel scanners via `tokio::join!` | Current implementation — fast-fan-out, no coordination, surfaces 1 repo on cold install | |
| Priority queue with single sequential drain + 3 tiers + follow-up lead enqueue | Lead-following intelligence. Hot drains before Warm before Cold. Scanner "thinks out loud." | ✓ |
| Event-driven actor system per source class | Rust actor crate (e.g. `ractor`) with per-class mailbox. Overkill for a one-shot scan; adds a dependency. | |

**Decision rationale:** ROADMAP explicitly requires "builds its own todo list at scan start — highest-priority leads run first, breadth fills in after" (SCAN-09) + "scan thinks out loud" (SCAN-10). Priority queue is the minimum shape that satisfies both. Actor system would add framework weight without SCAN-0N benefit. 12-parallel is the thing being replaced.

**Selected:** Priority `VecDeque<Lead>` + 3 tiers (Hot ≤7d, Warm ≤30d, Cold breadth) + follow-up lead enqueue. Per-scanner budgets 15/20/30s soft, 30/45/60s hard. File count cap 10k per tier. Depth cap 6 levels on fs walk with standard ignore-list (`node_modules`, `.git`, `.venv`, `target`, `dist`, `build`, `.next`, `.turbo`, `__pycache__`).

---

## Profile surface + edit model (D-62, D-63)

**Surface location:**

| Option | Description | Selected |
|--------|-------------|----------|
| New top-level route `profile` | Own section in sidebar | |
| Identity sub-view (8th entry in `features/identity/index.tsx`) | Joins Soul, Persona, Character Bible, Negotiation, Reasoning, Context Engine, Sidecar | ✓ |
| Dashboard widget only | Read-only card; no dedicated view | |

**Decision rationale:** Identity section is semantically correct (profile = identity data) and the registry pattern is proven across 7 sibling views. Zero-friction addition — matches Phase 6 D-143 single-writer exception for registry files. Dashboard widget alone fails SCAN-11 requirement of an editable surface.

**Selected:** Identity sub-view. Route id `profile`, 5 section tabs (Repos, Accounts, Stack, Rhythm, Files).

**Edit round-trip model:**

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite `scan_results.json` with edits | Edits merged into canonical scan output | |
| Two-file split: `scan_results.json` (canonical, replaced on rescan) + `profile_overlay.json` (user deltas) | Overlay wins at render time; re-scan preserves edits | ✓ |
| Database (SQLite) with versioned rows | Heavier; gives audit history but Phase 12 doesn't need it | |

**Decision rationale:** SCAN-12 hard requirement "edits round-trip through save → restart → reload" is incompatible with overwrite-on-rescan. Overlay is the minimum pattern that satisfies both "re-scan refreshes data" AND "user edits persist." SQLite adds a dependency for capability not required by SCAN-0N.

**Selected:** Two-file split with stable row_id scheme `{row_kind}:{primary_key}`. Orphaned rows flagged (`not found in latest scan` pill), never silently dropped.

---

## LLM classification boundary (D-61)

| Option | Description | Selected |
|--------|-------------|----------|
| Heuristics only, zero LLM calls | Fast, deterministic, no provider dependency. Rhythm narrative + account summary would be missing | |
| Heuristics first, LLM on-demand for enrichment only, ≤3 calls per scan, 7-day cache | Scanner works with zero LLM, richer with Phase 11 providers available | ✓ |
| LLM-first classification for every row | High cost, fragile, violates silence-log-spam discipline from tester-pass `4ab464c` | |

**Decision rationale:** Soft dep on Phase 11 (ROADMAP §37) means scanner must work without Phase 11 landed. Heuristics-first + budgeted enrichment is the only shape that makes Phase 11 a true soft dep. 3-call budget + 7-day cache matches silence-log-spam discipline.

**Selected:** Account narrative + rhythm narrative + ambiguous-repo language call — all batched, all non-blocking, all optional. Uses `long_context_provider` (Phase 11 D-53) if set, primary provider otherwise. Scan completes valid with zero LLM calls.

---

## Privacy + existing-scanner migration (D-65, D-66)

**Privacy default:**

| Option | Description | Selected |
|--------|-------------|----------|
| All classes ON, per-class opt-out in Settings | Cold install meets SCAN-13 baseline out of the box | ✓ |
| Opt-in per class at first run | Stronger privacy posture but fails "BLADE works out of the box" core value and reproduces the 1-repo cold install failure | |
| Class-based tiered consent (basic / extended / full) | Extra UX ceremony for minimal gain; WCAG + A11Y pass 2 cost not justified for v1.1 | |

**Decision rationale:** The baseline target "≥10 repos, ≥5 accounts, ≥3 rhythm signals, ≥3 IDE/AI tool signals" is SCAN-13 — the falsifiable close-target for the whole phase. Classes-off-by-default fails this target. Per-class opt-out in Settings → Privacy gives the escape hatch without undermining the core value.

**Selected:** All 8 classes ON by default. `ScanClassesEnabled` struct with 6-place config pattern. New Settings → Privacy route. Two new verify gates: `verify:scan-no-egress`, `verify:scan-no-write`.

**Migration strategy for existing `deep_scan.rs`:**

| Option | Description | Selected |
|--------|-------------|----------|
| Hard cutover: replace internals, keep `#[tauri::command]` + event contract stable | Old scanners lifted into new tree; orchestration replaced | ✓ |
| Compat shim: keep old `deep_scan_start` alongside new `deep_scan_start_v2` | Doubles maintenance, doubles scan time during transition, re-creates the 1-repo failure until migration complete | |
| Gradual scanner-by-scanner migration behind a feature flag | Long-tail of dual-code paths; verify gates harder to enforce | |

**Decision rationale:** The dumb sweep is the thing being replaced — its existence is the failure mode. Keeping it in parallel keeps the failure mode. Public contract (command names, event name, file paths, struct) stays stable; internals are rewritten. Onboarding consumer (`DeepScanStep.tsx`) keeps working without change because payload extension is additive.

**Selected:** Hard cutover with stable public contract. `src-tauri/src/deep_scan.rs` → `src-tauri/src/deep_scan/` module tree. Additive `DeepScanResults` schema extension. Four new Tauri commands for profile overlay + cancel.

---

## Plan layout (D-67)

Mirror Phase 11 D-58's 3-wave layout:

| Wave | Plan count | Dependency |
|------|-----------|------------|
| Wave 0 (backend scanner foundation) | 2 plans (parallel) | None |
| Wave 1 (profile surface + overlay) | 2 plans (sequential on W0) | Wave 0 queue + row_id scheme |
| Wave 2 (LLM + gates + goal-backward trace) | 1 plan (sequential on W1) | Wave 1 UI for manual trace |

**Selected:** 5 plans across 3 waves. Mirrors the Phase 11 pacing that the user explicitly delegated to Claude.

---

## Claude's Discretion

- Scanner filenames within `deep_scan/scanners/` (D-60 table is authoritative for mapping, filenames can adjust)
- SVG / visual treatment for Profile page (reuses existing primitives)
- LLM prompt wording for 3 enrichment calls (D-61)
- Specific curated CLI list for `which` sweep (D-59 gives starting list)
- Hour-of-day heatmap visual style
- Settings → Privacy copy wording

## Deferred Ideas

Logged in `12-CONTEXT.md` §`<deferred>`:
- Tentacle auto-enable from scan findings → Phase 13
- Persistent Activity Log strip → Phase 14
- Dashboard cards binding to profile data → Phase 15
- Continuous / background re-scan → v1.2+
- Profile data egress / export → out of scope
- Deep-scan WSL distro / Mac apps → kept as-is but not counted toward SCAN-13 baseline on Arnav's Linux-WSL machine
