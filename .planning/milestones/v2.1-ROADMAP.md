# Roadmap — BLADE

**Current Milestone:** v2.1 — Hunt + Forge + OAuth Depth
**Created:** 2026-05-13 | **Source:** v2.0-MILESTONE-AUDIT.md carry-forward list + autonomous-default scope per V2-AUTONOMOUS-HANDOFF.md §4 pattern
**Phases:** 49–52 (continues global numbering; v2.0 ended at Phase 48)

---

## Milestones

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ Shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ Shipped (tech_debt) | 10–15 | 2026-04-27 |
| v1.2 | Acting Layer with Brain Foundation | ✅ Shipped (tech_debt) | 16–20 | 2026-04-30 |
| v1.3 | Self-extending Agent Substrate | ✅ Shipped | 21–24 | 2026-05-02 |
| v1.4 | Cognitive Architecture | ✅ Shipped | 25–31 | 2026-05-03 |
| v1.5 | Intelligence Layer | ✅ Shipped (tech_debt) | 32–38 | 2026-05-08 |
| v1.6 | Narrowing Pass | ✅ Shipped (tech_debt) | 39–44 | 2026-05-13 |
| v2.0 | Setup-as-Conversation + Forge Demo | ✅ Shipped (tech_debt) | 45–48 | 2026-05-13 |
| **v2.1** | **Hunt + Forge + OAuth Depth** | 🔄 Active | **49–52** | — |

---

## v2.1 Phases

### Summary Checklist

- [ ] **Phase 49: Hunt Advanced + Cost Surfacing** — HUNT-05-ADV (answer-driven probing chain), HUNT-06-ADV (contradiction-detection logic), HUNT-COST-CHAT (live cost surfacing in chat)
- [ ] **Phase 50: OAuth Coverage** — Promote Slack + GitHub OAuth stubs to full implementations matching Gmail's shape. Add integration tests against localhost mock servers.
- [ ] **Phase 51: Forge Multi-Gap Robustness** — Add arXiv + RSS + PyPI gaps (3 new fixtures + integration tests). Tune the forge tool-writing prompt. Refine pre_check_existing_tools.
- [ ] **Phase 52: Close** — CHANGELOG v2.1, MILESTONE-AUDIT, phase archive, MILESTONES.md entry, git tag v2.1.

### Sequencing

```
   Phase 49 (Hunt Advanced + Cost Surfacing)    independent — touches onboarding + chat
       │
       ▼
   Phase 50 (OAuth Coverage)                    independent — touches src-tauri/src/oauth/
       │
       ▼
   Phase 51 (Forge Multi-Gap)                   independent — touches tool_forge.rs + fixtures
       │
       ▼
   Phase 52 (Close)                             gates on all prior phases
```

Phases 49-51 have no file overlap. Could parallelize but sequential keeps atomic commits clean per the V2-AUTONOMOUS-HANDOFF.md §4 pattern.

### Success Criteria (milestone-level)

1. Hunt onboarding handles fresh-machine and contradictory-signals cases (HUNT-05-ADV, HUNT-06-ADV)
2. Cost surfacing in chat for hunt + forge (HUNT-COST-CHAT)
3. OAuth full implementations for Slack + GitHub (parity with Gmail from v2.0)
4. Forge fires reliably on 4 distinct gaps (HN from v2.0 + arXiv + RSS + PyPI)
5. `verify:all` ≥36/38 (OEVAL-01c v1.4 carry-forward documented)
6. cargo + tsc clean
7. v2.0 features remain functional — no regressions

### Phase Details

#### Phase 49: Hunt Advanced + Cost Surfacing

**Goal**: Promote HUNT-05/06 from basic to advanced behaviors. Live cost surfacing in chat for hunt + forge to support the operator-dogfood feedback loop.
**Depends on**: v2.0 close (hunt module exists)
**Requirements**: HUNT-05-ADV, HUNT-06-ADV, HUNT-COST-CHAT
**Success Criteria**:
  1. Fresh-machine user gets sharp question → answer drives subsequent probing (e.g., user names a project → BLADE looks for it in `~/code/`)
  2. Contradiction detector emits a thematic classification + targeted question when findings conflict
  3. Cost surfaces in chat after each LLM call (cumulative) with soft 50% + hard 100% thresholds

#### Phase 50: OAuth Coverage

**Goal**: Slack + GitHub OAuth full implementations matching Gmail's shape from v2.0.
**Depends on**: v2.0 close (Gmail full impl exists as reference)
**Requirements**: OAUTH-SLACK-FULL, OAUTH-GITHUB-FULL, OAUTH-TESTS
**Success Criteria**:
  1. `src-tauri/src/oauth/slack.rs` full impl (auth URL + token exchange + refresh)
  2. `src-tauri/src/oauth/github.rs` full impl with device-code fallback for headless
  3. 6+ new integration tests (3 per provider) against localhost mock servers — all pass
  4. No real-account auth at build time per V2-AUTONOMOUS-HANDOFF.md §1

#### Phase 51: Forge Multi-Gap Robustness

**Goal**: Forge fires reliably on 4 gaps total (HN from v2.0 + arXiv + RSS + PyPI). Improves prompt + pre-check.
**Depends on**: v2.0 close (forge wiring exists)
**Requirements**: FORGE-GAP-ARXIV, FORGE-GAP-RSS, FORGE-GAP-PYPI, FORGE-PROMPT-TUNING, FORGE-PRECHECK-REFINE
**Success Criteria**:
  1. 3 new forge fixtures (arXiv, RSS, PyPI) ship with integration tests
  2. `forge_e2e_integration.rs` test suite covers 4 distinct gaps; all pass
  3. Forge tool-writing prompt tuned — success rate measured across the 4 gaps
  4. `pre_check_existing_tools` distinguishes "MCP exists + installed" vs "MCP exists + not installed"

#### Phase 52: Close

**Goal**: v2.1 closed. CHANGELOG, audit, phase archive, tag.
**Depends on**: Phase 49, 50, 51
**Requirements**: CLOSE-01..04
**Success Criteria**:
  1. CHANGELOG.md v2.1 entry shipped
  2. `.planning/milestones/v2.1-MILESTONE-AUDIT.md` written
  3. Phase 49-52 archived to `milestones/v2.1-phases/`
  4. README updated if user-visible
  5. MILESTONES.md v2.1 entry
  6. git tag `v2.1`
  7. cargo + tsc + verify:all green to floor

---

## v2.0 Phases (Validated — Setup-as-Conversation + Forge Demo)

See `.planning/milestones/v2.0-ROADMAP.md`. 4 phases shipped 2026-05-13.

## v1.6 Phases (Validated — Narrowing Pass)

See `.planning/milestones/v1.6-ROADMAP.md`. 6 phases shipped 2026-05-13.

---

## Risk Register (v2.1)

| Risk | Phase impacted | Mitigation |
|---|---|---|
| Hunt advanced probing reads sensitive files via the answer-driven seed | 49 | Same sandbox + deny-list as v2.0 hunt — no path can escape the sensitive-file deny list |
| Cost surfacing creates noise that obscures the actual chat | 49 | Render cost lines with reduced visual weight; merge consecutive cost updates into one line |
| Slack + GitHub OAuth scope changes between build-time and user-runtime | 50 | Use Slack + GitHub's current public scope list; surface scope changes as a separate v2.2+ task if they happen |
| Forge prompt-tuning over-fits to the 4 test gaps and degrades on novel gaps | 51 | Hold a 5th holdout gap (no fixture, no test) — verify a forge run on it after tuning still produces a working tool |
| OEVAL-01c v1.4 carry-forward regresses further | any | v2.1 doesn't touch organism modules; document at close if it changes |

---

## Notes

- **Phase numbering continues globally**. v2.1 starts at Phase 49; v2.2 starts at Phase 53.
- **v2.1 = polish + completion**, not architectural reframe. Agent-native audit recs #2-10 are explicitly deferred to v2.2.
- **Wake conditions** unchanged per V2-AUTONOMOUS-HANDOFF.md §7.
- **Static gates green = close bar** per §1; runtime UAT operator-owned.

---

*Last updated: 2026-05-13 — v2.1 scaffold landed.*
