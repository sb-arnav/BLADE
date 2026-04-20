# ROADMAP — BLADE v1.1 (Functionality, Wiring, Accessibility)

**Project:** BLADE — Desktop JARVIS
**Active milestone:** v1.1 (started 2026-04-20)
**Granularity:** Standard (6 phases derived from `notes/v1-1-milestone-shape.md`)
**Coverage:** v1.1 — 61/61 requirements mapped | v1.0 — 156/156 requirements shipped
**Numbering:** continues from v1.0 (phases 10..15)

---

## Phase Dependency Diagram (v1.1)

```
Phase 10: Inventory & Wiring Audit  (foundation — feeds every subsequent phase)
        │
        ▼
  ┌─────┴─────┐
  │           │
Phase 11   Phase 12            parallel-eligible
Smart      Smart Deep Scan     (Phase 12 consumes Phase 11's
Provider   (parallel)           capability-aware routing when
Setup      │                    calling LLMs for lead-following)
  │        │
  └─────┬──┘
        ▼
Phase 13: Self-Configuring Ecosystem   (consumes Phase 12's scan profile)
        │
        ▼
Phase 14: Wiring & Accessibility Pass   (consumes Phase 10 audit + Phase 13 tentacles)
        │
        ▼
Phase 15: Density + Polish              (consumes everything)
```

Phase 10 must complete before any other v1.1 phase starts — the audit produces the backlog Phase 14 consumes and the reachability contract Phase 15 verifies.

Phase 11 and Phase 12 may run in parallel. Phase 12's scanner intelligence uses Phase 11's capability-aware routing when classifying discovered signals with an LLM; this is a soft data dependency resolvable at the integration point, not a blocker on starting Phase 12 planning.

---

## Phases (v1.1)

- [ ] **Phase 10: Inventory & Wiring Audit** — Classify every Rust module + every route + every config field. Output `WIRING-AUDIT.md`; feeds Phase 14 backlog.
- [ ] **Phase 11: Smart Provider Setup** — Custom config paste (cURL/JSON/Python), key validation probe, per-capability routing, capability-gap empty states with upgrade CTAs.
- [ ] **Phase 12: Smart Deep Scan** — Replace dumb 12-scanner sweep with lead-following scanner (8 source classes), streaming, structured editable profile.
- [ ] **Phase 13: Self-Configuring Ecosystem** — Scan-result-driven auto-enable of observer-class tentacles; observe-only guardrail; Settings rationale + one-click disable.
- [ ] **Phase 14: Wiring & Accessibility Pass** — Close NOT-WIRED gaps, remove/fix WIRED-NOT-USED dead UI, a11y sweep 2, persistent Activity Log strip.
- [ ] **Phase 15: Density + Polish** — Spacing audit, card gaps, background-image dominance, top-bar hierarchy, empty-state copy rewrite across all 50+ routes.

---

## Phase Details (v1.1)

### Phase 10: Inventory & Wiring Audit

**Goal**: Produce a structured `WIRING-AUDIT.md` that classifies every Rust module, every UI route, and every config field so Phase 11–15 work is evidence-driven rather than intuition-driven.

**Depends on**: Nothing (v1.1 entry point; assumes v1.0 substrate)

**Requirements**: AUDIT-01, AUDIT-02, AUDIT-03, AUDIT-04, AUDIT-05

**Success Criteria** (what must be TRUE):
1. `.planning/phases/10-inventory-wiring-audit/WIRING-AUDIT.md` exists and classifies every file under `src-tauri/src/` as ACTIVE / WIRED-NOT-USED / NOT-WIRED / DEAD with purpose + trigger + UI-surface reference per row.
2. Every route registered in `src/lib/router.ts` is listed in the audit with data shape, data source, and flow status.
3. Every field in `BladeConfig` (and sibling config structs) is catalogued with the UI surface that exposes it, control type, and discoverability path; fields with no surface are flagged NOT-WIRED.
4. NOT-WIRED backlog section is structured (file:line references per backend entry point) and is consumable verbatim by Phase 14 planning.
5. DEAD items list includes a deletion plan that cross-checks callers + imports so Phase 14 removal does not break the build.

**Notes**: No code changes in this phase. The audit is a planning input. If gaps surface between the audit and the tester pass fixes already on master, note them in the audit's cross-reference section.

**Plans**:
- [ ] 10-01-PLAN.md — Wave 0: verify:wiring-audit-shape script + JSON Schema + package.json wiring (AUDIT-04, AUDIT-05)
- [ ] 10-02-PLAN.md — Wave 1: Subagent A (Rust module classifier) → 10-MODULES.yaml (AUDIT-01, AUDIT-04, AUDIT-05)
- [ ] 10-03-PLAN.md — Wave 1: Subagent B (route + command-palette mapper) → 10-ROUTES.yaml (AUDIT-02)
- [ ] 10-04-PLAN.md — Wave 1: Subagent C (config surface catalog) → 10-CONFIG.yaml (AUDIT-03)
- [ ] 10-05-PLAN.md — Wave 2: Synthesis → 10-WIRING-AUDIT.{md,json}, Appendix A/B, cleanup (AUDIT-01..05)

**UI hint**: no

---

### Phase 11: Smart Provider Setup

**Goal**: Onboarding and Settings → Providers stop locking users into the 6 hardcoded provider cards. Paste any config, probe the actual model, route by capability.

**Depends on**: Phase 10

**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05, PROV-06, PROV-07, PROV-08, PROV-09

**Success Criteria** (what must be TRUE):
1. Pasting a raw OpenAI / Anthropic / Groq cURL command into the provider form auto-extracts provider + model + `base_url` + headers and fills the form — verified across 3 representative cURL snippets.
2. Pasting a JSON config blob OR a Python SDK snippet produces the same auto-fill behavior.
3. Saving a new API key triggers one test call that retrieves and persists model name, context window, vision / audio / tool-calling support; the probe result is visible in the provider row.
4. Adding a key with no vision support causes vision-needing UI surfaces (e.g. screen-aware views) to show "needs vision-capable model" prompt with an "add key" CTA that opens the provider add flow — verified on ≥2 vision-consuming surfaces. Same behavior for audio, long-context, and tool-calling capability gaps.
5. `router.rs` routing consults per-capability config; a task classified as requiring vision routes to `vision_provider` with fallback chain, not to the primary provider when primary lacks vision — verified by unit test + manual trace.

**Notes**: The onboarding custom-paste flow and the Settings custom-paste flow share one parser module. The probe test call is idempotent and must not be retried in a loop on failure — surface the error clearly (related to tester pass fix `4ab464c`).

**Plans**: TBD

**UI hint**: yes

---

### Phase 12: Smart Deep Scan

**Goal**: Replace the dumb 12-scanner sweep (which surfaced 1 repo on Arnav's cold install) with a lead-following scanner that reads 8 source classes intelligently, streams progress to the activity log, and outputs a structured editable profile.

**Depends on**: Phase 10 (hard); Phase 11 (soft — capability-aware routing for LLM-assisted classification of discovered signals)

**Requirements**: SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05, SCAN-06, SCAN-07, SCAN-08, SCAN-09, SCAN-10, SCAN-11, SCAN-12, SCAN-13

**Success Criteria** (what must be TRUE):
1. Cold-install scan on Arnav's machine surfaces ≥10 repos (up from 1), ≥5 accounts, ≥3 daily-rhythm signals, ≥3 IDE/AI tool signals — measured against a documented baseline run.
2. Scanner executes all 8 source classes (filesystem repo walk, git remotes, IDE workspaces, AI session history, shell history, filesystem MRU, browser bookmarks, CLI/app `which` sweep) and each produces ≥1 structured row in the profile on Arnav's machine.
3. Scanner builds its own todo list at start — highest-priority leads (recent-edited repos, active sessions) run first, breadth fills in after; todo order is visible in the activity log stream.
4. Scan streams progress in real time to the activity log strip (LOG-01 wires Phase 14; during Phase 12 a simple log tail is sufficient, and the strip integration completes in Phase 14).
5. Profile page renders the structured scan output; every row shows source origin; user edits round-trip through save → restart → reload.

**Notes**: Soft dependency on Phase 11 — if Phase 11 lands first, Phase 12 uses `vision_provider` / `long_context_provider` for richer signal classification; if Phase 12 starts first, it falls back to primary provider. Scan must never write to external services.

**Plans**: TBD

**UI hint**: yes

---

### Phase 13: Self-Configuring Ecosystem (observe-only)

**Goal**: Phase 12 scan results silently activate observer-class tentacles. Watching, not editing. No destructive surprises on cold install.

**Depends on**: Phase 12

**Requirements**: ECOSYS-01, ECOSYS-02, ECOSYS-03, ECOSYS-04, ECOSYS-05, ECOSYS-06, ECOSYS-07, ECOSYS-08, ECOSYS-09, ECOSYS-10

**Success Criteria** (what must be TRUE):
1. Cold install on Arnav's machine + Phase 12 scan → ≥5 observer tentacles auto-enable (repo-watcher, Slack monitor, deploy-monitor, PR-watcher, session bridge, calendar-monitor where credentials / CLI / config detected).
2. Every auto-enabled tentacle appears in Settings with a per-row rationale ("Auto-enabled because deep scan found …") and a one-click disable toggle; disabled state persists across restart.
3. Observe-only guardrail: a runtime check (not just policy) rejects any outbound action attempted by an auto-enabled tentacle during v1.1 — verified by a test that calls a tentacle's write-path and asserts it is blocked with a clear error.
4. Auto-enablement is idempotent — re-running scan does not duplicate tentacles or re-enable ones the user disabled.
5. Every observer tentacle emits an activity-log row for each observation (read / poll / event received) so Phase 14's log strip has live data to surface.

**Notes**: The runtime guardrail is load-bearing — it is the difference between "safe smart default" and "scary surprise". Implement the guard as a central policy check rather than per-tentacle, so v1.2 acting-capability work removes one check in one place.

**Plans**: TBD

**UI hint**: yes

---

### Phase 14: Wiring & Accessibility Pass

**Goal**: Close every NOT-WIRED gap from the Phase 10 audit, remove every WIRED-NOT-USED dead UI, re-pass a11y on the new surfaces, and ship the persistent Activity Log strip that turns background activity into a trust surface.

**Depends on**: Phase 10 (audit backlog), Phase 13 (ecosystem data to wire)

**Requirements**: WIRE2-01, WIRE2-02, WIRE2-03, WIRE2-04, WIRE2-05, WIRE2-06, A11Y2-01, A11Y2-02, A11Y2-03, A11Y2-04, A11Y2-05, A11Y2-06, LOG-01, LOG-02, LOG-03, LOG-04, LOG-05

**Success Criteria** (what must be TRUE):
1. Post-phase WIRING-AUDIT.md re-run reports NOT-WIRED count = 0 OR every remaining NOT-WIRED row carries a documented "deferred to v1.2" rationale with sign-off reference.
2. Dashboard cards bind to real data from Phase 12 scan profile + Phase 13 tentacles — a cold-install screenshot shows populated cards, not "No data" placeholder text.
3. Activity Log strip mounts in main shell and remains visible across routes; every cross-module action in v1.1 emits a log event, verified by a script that asserts no backend action completes without a corresponding emission (acceptance threshold: 100% for Phase 13 tentacles, ≥95% elsewhere with flagged exceptions).
4. `npm run verify:all` gains 2 new scripts — `verify:feature-reachability` (asserts every backend module reachable from route registry or command palette) and `verify:a11y-pass-2` (asserts no icon-only buttons without labels, no dialogs without focus traps, no unguarded animations) — both green.
5. Click on any activity log entry opens a drawer with full payload + reasoning + outcome; last N entries persist across app restart.

**Notes**: Phase 14 is the largest phase (17 requirements across 3 sub-categories). Expect 3–5 parallel workstreams: (a) wire NOT-WIRED backends, (b) remove WIRED-NOT-USED dead UI, (c) a11y sweep on new surfaces, (d) activity log implementation (strip + drawer + event emission + filter). Sub-streams (a), (b), (d) can proceed in parallel; (c) runs after each of them closes a surface.

**Plans**: TBD

**UI hint**: yes

---

### Phase 15: Density + Polish

**Goal**: Now that content exists (Phases 11–14), make the surface feel intentional. Spacing ladder, card gaps, background-image dominance, top-bar hierarchy, empty-state copy.

**Depends on**: Phase 14

**Requirements**: DENSITY-01, DENSITY-02, DENSITY-03, DENSITY-04, DENSITY-05, DENSITY-06, DENSITY-07

**Success Criteria** (what must be TRUE):
1. UI review across all 50+ routes reports 0 padding violations against the documented spacing ladder; verification script asserts spacing tokens are used exclusively (no hardcoded px).
2. Every empty state has either real content (populated by Phase 12+13 data) or a CTA + expected-timeline copy — e.g. *"BLADE is still learning — give me 24h"* not *"No recent decisions"*.
3. Dashboard hero pulls ≥3 live signals from scan profile + ecosystem tentacles + perception state — verified on cold-install screenshot.
4. Background-image dominance audit: content takes visual priority over ambient imagery on all 5 representative wallpapers; contrast + eye-path pass documented.
5. Top bar hierarchy pass: primary actions, activity-log strip, status chips, user/settings affordances have clear visual priority order; no overstuff; fits at 1280px minimum width.

**Notes**: Regressions in v1.0 verify gates (contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, etc.) fail the phase. Polish means no regressions, not just new wins.

**Plans**: TBD

**UI hint**: yes

---

## Progress Table (v1.1)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 10. Inventory & Wiring Audit | 0/5 | Not started | — |
| 11. Smart Provider Setup | 0/TBD | Not started | — |
| 12. Smart Deep Scan | 0/TBD | Not started | — |
| 13. Self-Configuring Ecosystem | 0/TBD | Not started | — |
| 14. Wiring & Accessibility Pass | 0/TBD | Not started | — |
| 15. Density + Polish | 0/TBD | Not started | — |

---

## Coverage Verification (v1.1)

**Total v1.1 requirements: 61**
**Mapped: 61/61** ✓

| Category | Count | Phase |
|----------|-------|-------|
| AUDIT-01..05 | 5 | Phase 10 |
| PROV-01..09 | 9 | Phase 11 |
| SCAN-01..13 | 13 | Phase 12 |
| ECOSYS-01..10 | 10 | Phase 13 |
| WIRE2-01..06 | 6 | Phase 14 |
| A11Y2-01..06 | 6 | Phase 14 |
| LOG-01..05 | 5 | Phase 14 |
| DENSITY-01..07 | 7 | Phase 15 |
| **Total** | **61** | ✓ |

---

## Shape Doc Mapping

The locked shape in `.planning/notes/v1-1-milestone-shape.md` uses internal phase numbers 0–5. They map 1:1 to the global roadmap phase numbers:

| Shape doc | Global roadmap | Name |
|-----------|----------------|------|
| Phase 0 | Phase 10 | Inventory & Wiring Audit |
| Phase 1 | Phase 11 | Smart Provider Setup |
| Phase 2 | Phase 12 | Smart Deep Scan |
| Phase 3 | Phase 13 | Self-Configuring Ecosystem |
| Phase 4 | Phase 14 | Wiring & Accessibility Pass |
| Phase 5 | Phase 15 | Density + Polish |

Any reference to "Phase N" in the shape doc means "global Phase (N+10)" here.

---

## v1.0 History (shipped)

v1.0 — Skin Rebuild — completed 2026-04-19 (~165 commits, 64 plans, 18 verify gates green). Mac smoke checkpoints (M-01..M-46) and WCAG screenshots tracked separately in `.planning/HANDOFF-TO-MAC.md`.

| Phase | Name | Status |
|-------|------|--------|
| 0 | Pre-Rebuild Audit | Complete (b26a965) |
| 1 | Foundation | Substrate shipped, WCAG checkpoint operator-owned |
| 2 | Onboarding + Main Shell | Substrate shipped, operator smoke pending |
| 3 | Dashboard + Chat + Settings | Substrate shipped, Mac smoke + cargo check pending |
| 4 | Overlay Windows (QuickAsk + Orb + Ghost + HUD) | Substrate shipped, M-01..M-13 pending |
| 5 | Agents + Knowledge | Complete |
| 6 | Life OS + Identity | Complete |
| 7 | Dev Tools + Admin | Complete |
| 8 | Body + Hive | Complete |
| 9 | Polish Pass | Complete |

Phase directories for v1.0 remain at `.planning/phases/00-*` through `.planning/phases/09-*`. v1.1 creates new directories at `10-*` through `15-*`.

---

*Roadmap created: 2026-04-17 (v1.0). v1.1 added: 2026-04-20 from locked shape in `.planning/notes/v1-1-milestone-shape.md`.*
