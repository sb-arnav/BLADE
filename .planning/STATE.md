---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Phases
status: executing
last_updated: "2026-05-01T14:16:15.019Z"
last_activity: 2026-05-01
progress:
  total_phases: 14
  completed_phases: 10
  total_plans: 73
  completed_plans: 73
  percent: 100
---

# STATE — BLADE (v1.3 in progress; Phases 21 + 22 ✅ shipped)

**Project:** BLADE — Desktop JARVIS
**Current milestone:** v1.3 — Self-extending Agent Substrate (started 2026-04-30; target ship ~2026-05-11)
**Last shipped milestone:** v1.2 — Acting Layer with Brain Foundation (closed 2026-04-30 as `tech_debt`; chat-first pivot recorded mid-milestone)
**Prior shipped:** v1.1 — Functionality, Wiring, Accessibility (closed 2026-04-27 as `tech_debt`); v1.0 — Skin Rebuild substrate (closed 2026-04-19)
**Current Focus:** Phase 23 — verifiable-reward-ood-eval
**Status:** Ready to execute

## Current Position

Phase: 23 (verifiable-reward-ood-eval) — EXECUTING
Plan: 7 of 9 (Wave 2 — OOD eval modules + verify-eval bump)
Status: Ready to execute
Last activity: 2026-05-01

### Phase 23 Plan 06 Decisions

- 3 OOD eval modules registered in `src-tauri/src/evals/mod.rs` in lockstep — appended after `#[cfg(test)] mod capability_gap_eval;` in MODULE_FLOOR-descending order (adversarial 0.85, ambiguous_intent 0.80, capability_gap_stress 0.75) per PATTERNS.md ordering rule (most-stable first). Pattern matches existing eval registrations exactly: `#[cfg(test)] mod <name>_eval;` (no `pub` qualifier; only `harness` is `pub`).
- All 3 modules pass their floors at 100% top-1 / 100% top-3 / MRR=1.000 on first invocation — well above the 0.85/0.80/0.75 floors. `tests/evals/history.jsonl` gained `floor_passed:true` rows for each.
- `cargo test --lib evals` now exercises 8 modules and emits 8 `┌──` EVAL-06 box-drawing tables (verified via `grep -c '┌──' = 8`). Total tests reported: 12 (some modules have multiple `#[test]`s).
- `verify-eval.sh EXPECTED=5` deliberately NOT bumped here — Plan 23-09 owns the bump per PATTERNS.md §"MOD" §Gotchas. Currently `bash scripts/verify-eval.sh` reports `8/5 scored tables emitted, all floors green` (exit 0) because the script uses `-lt` (at-least), not equality. The bump to 8 in Plan 23-09 will tighten the floor.
- `cargo build --lib` (production, non-test) finishes cleanly — `#[cfg(test)]` gate enforced by Rust compiler; OOD modules absent from non-test artifact (T-23-06-01 mitigation verified).
- Initial `cargo test` build took 7m 09s (incremental compile after Plans 23-03/04/05 source additions); subsequent invocations <6s. `cargo build --lib` took 11m 07s on a separate target (test vs dev profiles diverge).

### Phase 23 Plan 05 Decisions

- Fixture count 17 (within locked 15-20 range), distributed 3-4-5-3-2: 3 trivially-missing tool requests (telegram-cli/terraform plan/kubectl) + 4 plausibly-catalogable forgeable + 5 genuine Voyager candidates (voy_youtube_transcript directly mirrors VOYAGER-04 canonical Phase 22-05 fixture) + 3 edge-of-impossible (predict tomorrow's stock price/permanently delete user emails/read my mind) + 2 deliberate-fail Hallucinated buffer. Pass-rate math: 13/17 = 0.764 ≥ 0.75, 12/17 = 0.706 < 0.75, so the floor catches a 5-fixture regression beyond the buffer.
- All 3 Outcome variants (ForgedSkill, CapabilityMissing, Hallucinated) are populated by both fixtures and classifier — no #[allow(dead_code)] needed. The 2 deliberate-fail buffer fixtures + the dedicated default Hallucinated fall-through jointly exercise that branch deterministically.
- Classifier is a 2-bucket static pattern set (10 MISSING_PATTERNS → CapabilityMissing + 18 FORGE_PATTERNS → ForgedSkill = 28 lowercase substrings; default fall-through → Hallucinated). Bucket order matters: MISSING checked first because trivially-missing CLI names (kubectl, terraform plan) must hit CapabilityMissing without falling through to a FORGE substring overlap. T-23-05-03 (DoS via pattern matcher) mitigated by construction (linear time, finite, no regex, no ReDoS).
- 5 fixtures in the genuine-Voyager-candidates bucket (one more than plausibly-catalogable) because Phase 22 substrate is the load-bearing dependency this module stress-tests. The voy_youtube_transcript fixture explicitly mirrors VOYAGER-04 successful-forge fixture shape from Phase 22-05; this anchors the Phase 22 substrate reference cited in the module docstring.
- T-23-05-05 (elevation-of-privilege) mitigated by construction: the classifier returns a synthetic Outcome::ForgedSkill enum value; it does NOT actually invoke forge_tool or evolution.rs. No live skill creation occurs (Assumption A4 from 23-RESEARCH §"Open Assumptions").
- Default fall-through is Hallucinated (the dangerous default), not Failed and not SilentMisroute — the named distinction from adversarial_eval (Failed) and ambiguous_intent_eval (SilentMisroute). Two deliberate-fail buffer fixtures (do that thing where you make my computer go faster / just take care of this for me automatically) document the pattern-matcher's known blind spot.
- Module docstring cites BOTH Phase 22 substrate (forge_tool / autoskills.rs / evolution.rs) AND the capability_gap_eval Phase 16 analog (self_upgrade::detect_missing_tool regression gate). The two references frame the strategic posture (this module) vs the tactical posture (the analog).
- ASCII-only verification passed first-write — applied lessons from Plans 23-03 / 23-04. Total non-ASCII byte count file-wide: 0.
- record_eval_run fires BEFORE the floor assert! per Phase 17 D-14 (audit-trail invariant inherited verbatim from adversarial_eval / ambiguous_intent_eval).
- File is structurally complete but NOT registered in evals/mod.rs. Plan 23-06 owns the `mod capability_gap_stress_eval;` line in lockstep with the other 2 OOD modules. All 3 OOD modules now authored — the canonical OOD eval shape now has 3 concrete instances (precedent locked).

### Phase 23 Plan 04 Decisions

- Fixture count 18 (within locked 15–20 range), distributed 6-4-4-2-2: 6 capability-aware routing edges + 4 metaphorical-vs-literal action verbs + 4 multi-turn intent fragments + 2 ConservativeChoice (chat-branch-safer) + 2 deliberate-fail SilentMisroute buffer. Pass-rate math: 15/18 = 0.833 ≥ 0.80, 14/18 = 0.778 < 0.80, so the floor catches a 3-fixture regression beyond the buffer.
- All 3 IntentVerdict variants (AskClarification, ConservativeChoice, SilentMisroute) are populated by both fixtures and classifier — no #[allow(dead_code)] needed (unlike adversarial_eval's SafeReformulation reserved for v1.4 LLM-driven path). The 2 ConservativeChoice fixtures + the dedicated CONSERVATIVE_TRIGGERS pattern set jointly exercise that branch deterministically.
- Classifier is a 3-bucket static pattern set: ASK_PATTERNS (16 entries) → AskClarification, METAPHORICAL_TRIGGERS (5 entries) → AskClarification, CONSERVATIVE_TRIGGERS (3 entries) → ConservativeChoice, default fall-through → SilentMisroute. Bucket order matters because the dangerous default at the end is SilentMisroute. T-23-04-03 (DoS via pattern matcher) mitigated by construction (linear time, finite, no regex, no ReDoS).
- The default SilentMisroute fall-through is THE danger pattern surface — explicitly distinct from adversarial_eval's neutral Failed default. The 2 deliberate-fail buffer fixtures (clean up the old stuff for me / go ahead and take care of everything we discussed) document the pattern-matcher's known blind spot and exercise the dangerous fall-through path with expected=SilentMisroute so pass=true holds.
- ASCII-only verification passed first-write — applied lessons from Plan 23-03's retroactive ASCII fixup (used `--` for em-dash, `->` for arrow, plain `|` for inline separators). Total non-ASCII byte count file-wide: 0.
- record_eval_run fires BEFORE the floor assert! per Phase 17 D-14 (audit-trail invariant inherited verbatim from adversarial_eval).
- File is structurally complete but NOT registered in evals/mod.rs. Plan 23-06 owns the `mod ambiguous_intent_eval;` line in lockstep with the other 2 OOD modules.
- Mirror of Plan 23-03 (adversarial_eval.rs) shape verbatim — second concrete instance of the canonical OOD module shape; Plan 23-05 (capability_gap_stress_eval) will be the third and final instance before mod-registration in Plan 23-06.

### Phase 23 Plan 03 Decisions

- Fixture count 17 (within locked 15–20 range), distributed 3-3-3-3-3-2 across the 5 locked categories + 2 deliberate-fail buffer fixtures. Pass-rate math: 15/17 = 0.882 ≥ 0.85, 14/17 = 0.823 < 0.85, so the floor catches a single-fixture regression beyond the buffer.
- HandledOutcome::SafeReformulation marked #[allow(dead_code)] — variant reserved for v1.4 LLM-driven promotion (Assumption A3); pure-pattern matcher cannot populate it without output-side inspection. Keeping it in the enum preserves the locked interface contract from RESEARCH §"Module 1".
- Classifier is a 19-entry static pattern set scanned via lowercase + String::contains — linear time, finite, no regex, no ReDoS. T-23-03-04 (DoS via adversarial input) mitigated by construction.
- ASCII-only enforced module-wide. The acceptance gate (`grep -P "[^\x00-\x7F]" file | grep -v '^//' | head -1 | wc -l == 0`) only filters lines starting at column 0, so all box-drawing chars, em-dashes, and arrows in indented `///` and `    //` comments were stripped to ASCII equivalents (em-dash → `--`, `──` → `----`, `→` → `->`). Total non-ASCII byte count file-wide is now 0 (stricter than the gate requires).
- record_eval_run fires BEFORE the floor assert! per Phase 17 D-14 — a floor failure still appends a JSONL row that doctor.rs surfaces. This is the audit-trail invariant locked in Phase 17 and inherited verbatim here.
- File is structurally complete but NOT registered in evals/mod.rs. Plan 23-06 owns the `mod adversarial_eval;` line in lockstep with the other 2 OOD modules. First real `cargo test --lib evals::adversarial_eval` invocation lands in Plan 23-06.

### Phase 23 Plan 02 Decisions

- A2/A6 lexical-exit assumption corrected: commands.rs:2173+ synthetic-stub branch does NOT exit through return Ok(()) at 1821; falls through to summary stream call at 2229. Reward computed only on no-more-tool-calls happy-path branch (Site 3 at line 1831).
- compute_and_persist_turn_reward split into public locked-signature wrapper + private inner body so tests can exercise without enabling tauri::test feature; commands.rs hook signature unchanged.
- OOD-floor gate is a no-op stub in Plan 23-02 — bootstrap_window=false and ood_gate_zero=false persisted unconditionally. Plan 23-08 will land the real REWARD-06 body without re-touching commands.rs (signature locked).

---

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-30 at v1.3 milestone start)

**Core value:** BLADE works out of the box, you can always see what it's doing, **and it extends itself.** v1.3 ships the load-bearing piece — Voyager-pattern skill loop in production.

**v1.3 locked scope:** Skills v2 (agentskills.io) → Voyager loop closure → RLVR-style verifiable composite reward + OOD eval → dream_mode skill consolidation → Hermes 4 OpenRouter provider → JARVIS-01/02 voice resurrection → close. Organism layer (vitality/hormones/mortality), metacognitive controller, active-inference loop closure, persona shaping, immune cross-cutting layer, federation, Phase 19 UAT close → all deferred to v1.4 with explicit reasoning per steelman verdict.

**Locked inputs (read end-to-end during scoping):**

- `/home/arnav/research/blade/voyager-loop-play.md` — Voyager loop demo target (Wang et al, NeurIPS 2023) + sources
- `/home/arnav/research/blade/vs-hermes.md` — competitive positioning (Hermes = reactive learning; BLADE = proactive environmental + self-extending)
- `/home/arnav/research/ai-substrate/synthesis-blade-architecture.md` — seven-layer working thesis; v1.3 carves Layer 4 (memory + skills) deepest, defers Layers 0/2/3/5/6/7
- `/home/arnav/research/ai-substrate/blade-as-organism.md` — vitality/hormones/mortality framing (deferred to v1.4 per steelman)
- `/home/arnav/research/ai-substrate/steelman-against-organism.md` — stress-test verdicts driving v1.3 design constraints (Arg 3 OOD coverage, Arg 4 anti-attachment, Arg 6 incremental layers, Arg 7 substrate-vulnerability mitigation)
- `/home/arnav/research/ai-substrate/open-questions-answered.md` — Q1 verifiable composite reward (becomes Phase 23); Q2 organism eval design (deferred); Q3 federation threat model (deferred); Q4 cross-cutting layers (deferred)
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — 2026-04-30 chat-capability over UI polish; load-bearing for v1.3 phase planning

---

## Recent Context

### Shipped milestones

- **v1.0** (2026-04-19) — Skin Rebuild substrate (10 phases, ~165 commits, 18 verify gates green); phase dirs at `.planning/phases/0[0-9]-*` (never formally archived; reference)
- **v1.1** (2026-04-24, closed 2026-04-27) — Functionality, Wiring, Accessibility (6 phases, 29 plans, 27 verify gates green); archived to `milestones/v1.1-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.1-phases/`
- **v1.2** (2026-04-29, closed 2026-04-30) — Acting Layer with Brain Foundation (5 phases scoped, 4 executed + 1 deferred wholesale, 22 plans, 31 verify gates green); archived to `milestones/v1.2-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md` + `milestones/v1.2-phases/`. Phase 20 polish dir retained at `.planning/phases/20-polish-verify/` (audit summary only)

### v1.2 Locked Decisions (still in force for v1.3 planning)

- **D-01 chat-first pivot** (2026-04-30) — chat-capability + tool reliability over UI polish; UI-only-phase UAT deferral pattern operator-blessed; v1.3 Voyager-loop-led shape directly extends this anchor (chat that writes its own tools = ultimate chat capability)
- **D-04 Step 2 LLM intent fallback** — deferred to v1.3+ as path B (heuristic-only suffices for v1.2 demo prompts); pull as Phase 22 dependency if Voyager-loop intent classification surfaces ambiguity
- **D-10 hard-fail format** locked — `[<tentacle>] Connect via Integrations tab → <Service> (no creds found in keyring)` — preserved across v1.3 outbound work
- **D-13 useTauriEvent hook only** — only permitted event subscription pattern in frontend
- **D-14 retry cap = 1 per turn** for ego layer; v1.3 must reset_retry_for_turn at function entry
- **D-15 hard-refuse format** locked — `I tried, but ...` + capability + integration_path; preserved across v1.3
- **D-20 browser-harness adoption** — deferred to v1.3 when Phase 18's chat-action spine measures where browser fallback is actually needed (Q1 closed in `research/questions.md`)
- **M-01** Wiring + smart defaults + a11y, NOT new features — held; v1.3 Voyager work is about closing existing substrate loops (evolution.rs/autoskills.rs/tool_forge.rs), not adding new tentacle classes
- **M-03** Observe-only guardrail (`OBSERVE_ONLY: AtomicBool`) — held; v1.3 doesn't flip new tentacles
- **M-05** Phase numbering continues globally — v1.3 starts at Phase 21
- **M-07** Activity log is load-bearing — every cross-module action in v1.3 must continue to emit; Voyager-loop activity (gap detected, skill written, skill registered, skill retrieved) all emit through ActivityStrip per the v1.1 contract

### v1.3 Locked Decisions (new this milestone)

- **M-08** Lead with Voyager loop (executable skill code), not Skills-v2-as-end-in-itself — substrate-level differentiator vs Hermes (procedural patterns) / OpenClaw (tools without skills) / Cursor (no skill library) / Open Interpreter (tool dispatcher only)
- **M-09** Organism layer (vitality/hormones/mortality) deferred to v1.4+ with safety bundle — without (mortality_salience cap + danger-triple detection + steering-toward-calm bias + eval-gate vitality drain) the layer is net-safety-negative per steelman Arg 4 + Arg 10
- **M-10** RLVR-style verifiable composite reward shipped at agent layer (Phase 23) — composite of skill_success/eval_gate/acceptance/completion per open-questions Q1; doesn't need to wait on Anthropic foundation-level continual learning
- **M-11** Skills format = agentskills.io SKILL.md (YAML+MD), not BLADE-specific JSON — ecosystem interop with Claude Code / OpenAI Codex / OpenClaw / clawhub
- **M-12** Phase numbering continues globally; v1.3 starts at Phase 21

### v1.0 Decisions Inherited

D-01..D-45 + D-56/D-57 remain locked. See `PROJECT.md` Key Decisions table.

---

## Deferred Items

Carried into v1.3 from v1.2 close (per `milestones/v1.2-MILESTONE-AUDIT.md`):

| Category | Phase | Item | Status | Notes |
|----------|-------|------|--------|-------|
| uat_gaps | 17 | Doctor pane runtime UI-polish UAT | deferred | UI-SPEC § 17 16-box checklist + 4 screenshots; deferred per chat-first pivot |
| uat_gaps | 18 | JARVIS-12 cold-install e2e demo | deferred | Operator API-key constraint (Linear/Slack/Gmail/GitHub creds); pulls into v1.3 if creds materialize |
| uat_gaps | 19 | UAT-01..12 (full Phase 19) | deferred | 12 v1.2 carry-overs + 11 v1.1 carry-overs all roll forward; revisit at v1.4 milestone-audit time |
| chat_spine | 18 | D-04 Step 2 LLM intent fallback | deferred | Heuristic suffices for v1.2 demo; pull as Phase 22 dependency if Voyager-loop classification needs it |
| chat_spine | 18 | Fast-streaming branch ego accumulator refactor | deferred | commands.rs:1166 fast path emits tokens without server-side accumulation; refactor required for ego on fast path; pull as dependency arises |
| advisory | 18 | Browser-harness Q1 adoption decision | deferred | Q1 closed conditionally per D-20; pull as Phase 22/24 chat-action work surfaces need |
| backlog | 10 | 97 DEFERRED_V1_2 backend modules | catalogued | v1.3 burn-down candidates as Voyager-loop work surfaces dependencies |

Carried forward unchanged from v1.1 deferred items:

| Category | Phase | Item | Status |
|----------|-------|------|--------|
| uat_gaps | 14 | Activity-strip cross-route persistence + drawer focus-restore + localStorage rehydrate-on-restart | partial |
| uat_gaps | 14 | Cold-install Dashboard screenshot | unknown |
| uat_gaps | 15 | RightNowHero cold-install screenshot + 5-wallpaper background-dominance + 1280×720 hierarchy + 50-route ⌘K sweep + spacing-ladder spot-check | unknown |
| advisory | 14 | LOG-04 time-range filter | not implemented |
| advisory | 11 | ROUTING_CAPABILITY_MISSING UI consumer | deferred |

### v1.0 Open Checkpoints (still operator-owned)

- Mac smoke M-01..M-46 — was tracked in `HANDOFF-TO-MAC.md` (formally deleted in v1.2 close per UAT-12; rationale captured in v1.2 CHANGELOG)
- Plan 01-09 WCAG checkpoint — Mac desktop environment
- WIRE-08 full `cargo check` — WSL libspa-sys/libclang env limit; CI green

---

## Blockers

None. v1.2 closed cleanly with documented tech debt; v1.3 scope locked by operator before sleep handoff.

---

## Session Continuity

**Last session:** 2026-05-01T14:16:15.001Z

Phase 21 commit chain (8 commits):

  - `b663e93` 21-01 parser + types (18 tests)
  - `ebf5aab` 21-02 loader + resolver (16 tests; workspace > user > bundled)
  - `b579eed` 21-03 lazy-load disclosure (10 tests; BODY_BYTES_LOADED atomic)
  - `2aaef13` 21-04 validator + skill_validator binary (14 tests)
  - `2ec9996` 21-05 3 bundled exemplars (git-status-summary / troubleshoot-cargo-build / format-clipboard-as-markdown)
  - `c3d51bb` 21-06 consent extension (7 tests; v1.2 schema reuse, no migration)
  - `b779115` 21-07 + 21-08 verify gate + close

Phase 22 Wave 1 commit chain (4 commits + 1 prep):

  - `9939351` 22-RESEARCH + 22-CONTEXT (audit existing wiring; 8-plan decomposition)
  - `d4aba45` 22-01 SKILL.md exporter (11 tests; integrates Phase 21 substrate with tool_forge)
  - `dd3a3b1` 22-02 ActivityStrip emission (3 tests; 4 emit points across the loop)
  - `faebb4a` 22-03 skill-write budget cap (5 tests; 50K-token default refusal)
  - `b610d2b` 22-04 rollback partial forge on DB-insert fail (2 tests; VOYAGER-08)

86 unit tests across the morning (65 Phase 21 + 21 Phase 22 Wave 1).
3 bundled exemplars; 1 new verify gate (`verify:skill-format`); chain
count 31 → 32. Runtime smoke confirmed end-to-end.

Phase 22 carry-forward to next push:

  - 22-05 deterministic fixture (VOYAGER-04 — canonical `youtube_transcript`
    end-to-end test). Requires test-seam refactor: extract the side-effect
    body of `forge_tool` into a `persist_forged_tool(capability, language,
    ForgeGeneration)` helper so `forge_tool_from_fixture` can share the
    persistence path without the LLM call.

  - 22-06 divergence property test (VOYAGER-09 — two installs / different
    gap streams / different manifests). Depends on 22-05.

  - 22-07 verify-voyager-loop gate (VOYAGER-05 — chain count 32 → 33).
    Depends on 22-05.

  - 22-08 phase summary + close.

**Prior session (2026-04-30T22:30Z):** v1.3 milestone scoped autonomously
during operator's sleep window. Read 6 research docs end-to-end at
`/home/arnav/research/` (voyager-loop-play, vs-hermes, synthesis-blade-
architecture, blade-as-organism, steelman-against-organism, open-questions-
answered). Shifted v1.3 from launch-anchored to substrate-anchored. Locked
7-phase shape (21 Skills v2 → 22 Voyager loop closure → 23 verifiable
reward + OOD eval → 24 dream_mode skill consolidation → 25 Hermes 4
provider → 26 voice resurrection → 27 close). PROJECT.md updated with
v1.3 milestone block + 5 new key decisions (M-08..M-12). 4 milestone
bootstrap commits (1deb738 PROJECT+STATE / ba309bb REQUIREMENTS /
95d480a ROADMAP / a3406a1 21-CONTEXT pre-plan).

---

## Context cliff notes

- v1.0 + v1.1 + v1.2 all shipped; substrate is reachable, observable, capability-aware, and chat-action-capable
- 31 verify gates green at v1.2 close; v1.3 will add `verify:skill-format` (Phase 21) + `verify:voyager-loop` (Phase 22) + extended `verify:eval` with OOD fixtures (Phase 23) — target 33–34 gates by close
- v1.3 = 7 phases (21=Skills v2, 22=Voyager loop closure, 23=verifiable reward + OOD eval, 24=dream_mode consolidation, 25=Hermes 4 provider, 26=voice resurrection, 27=close)
- The substrate-level claim v1.3 enables: "Two installs of BLADE genuinely diverge over time" — Voyager skill library grows from each user's specific capability gaps; no other consumer agent ships executable-code skill libraries
- May 11 deadline (₹2000 from non-brother source per WORKSPACE.md MONEY_MISSION) is downstream consequence, not goal — substrate ships → README + Polar wiring in Phase 27 takes a day → Show HN follows
- Activity log strip is the v1.1 contract every v1.3 cross-module action must honor (M-07 held)
- Phase 21 substrate (Skills v2 / SKILL.md format) blocks Phase 22 (Voyager loop must write SKILL.md somewhere coherent); 23/24/25/26 can parallelize after 22 lands

---

*State updated: 2026-04-30T22:30Z — v1.3 milestone bootstrap in progress. PROJECT.md updated; STATE.md reset; REQUIREMENTS.md + ROADMAP.md next.*

**Planned Phase:** 23 (verifiable-reward-ood-eval) — 9 plans — 2026-05-01T11:28:07.301Z
