# Roadmap — BLADE

**Current Milestone:** v1.3 — Self-extending Agent Substrate
**Created:** 2026-04-30 | **Source:** `/home/arnav/research/` (voyager-loop-play, vs-hermes, synthesis-blade-architecture, blade-as-organism, steelman-against-organism, open-questions-answered) + chat-first pivot memory + `/gsd-new-milestone` autonomous bootstrap
**Phases:** 21–27 (continues global numbering per M-05/M-12; v1.2 ended at Phase 20)
**Total target:** ~12 days (May-11 ship downstream consequence, not goal)

---

## Milestones

| Version | Name | Status | Phases | Closed |
|---|---|---|---|---|
| v1.0 | Skin Rebuild substrate | ✅ Shipped | 0–9 | 2026-04-19 |
| v1.1 | Functionality, Wiring, Accessibility | ✅ Shipped (tech_debt) | 10–15 | 2026-04-27 |
| v1.2 | Acting Layer with Brain Foundation | ✅ Shipped (tech_debt) | 16–20 | 2026-04-30 |
| **v1.3** | **Self-extending Agent Substrate** | 🚧 **Active** | **21–27** | — |

---

## v1.3 Phases

| # | Phase | Goal | Requirements | Success Criteria | Days |
|---|---|---|---|---|---|
| 21 ✅ | **Skills v2 / agentskills.io adoption** *(shipped 2026-05-01)* | The substrate prerequisite. SKILL.md (YAML+MD) format, progressive disclosure, workspace→user→bundled resolution, validator + 3 bundled exemplars. | SKILLS-01..08 (8/8 ✓) | All 4 SCs green: (1) `skill_validator --recursive skills/bundled` OK on all 3 exemplars; (2) progressive-disclosure assertion holds (`BODY_BYTES_LOADED == 0` after scan; equals body size after activate); (3) workspace > user > bundled tier-priority loop verified across 3 collision tests; (4) `verify:skill-format` gate green (count 31 → 32). 65 unit tests added. | 1 |
| 22 | **Voyager loop closure** ← *load-bearing* | Wire `evolution.rs → autoskills.rs → tool_forge.rs` end-to-end. One reproducible gap (`youtube_transcript`) closed. The substrate-level differentiator. | VOYAGER-01..09 (9 REQs) | (1) `youtube_transcript` fixture: ask→fail→write skill→retry→success; skill file present that wasn't; (2) `verify:voyager-loop` gate green deterministically (count 32 → 33); (3) ActivityStrip emits 4 entries per closed loop (gap_detected, skill_written, skill_registered, skill_used); (4) two installs with different gap streams produce different skill libraries (property test); (5) loop-failure recovery rolls back partial skill on tool_forge::register error | 3 |
| 23 | **Verifiable reward + OOD eval** | RLVR-style composite reward in production + steelman Arg 3 mitigation. | REWARD-01..07 (7 REQs) | (1) Composite reward computed per turn with reward-hacking penalties; (2) per-turn reward written to `tests/evals/reward_history.jsonl`; (3) 3 new OOD eval modules pass baseline floor; (4) reward fail-safe gates to zero on >15% OOD score drop; (5) Doctor pane surfaces `reward_trend` signal | 2 |
| 24 | **Skill consolidation in dream_mode** | The continual-forgetting half. Prune unused, consolidate redundant, generate skills from successful traces. | DREAM-01..06 (6 REQs) | (1) Skill-prune moves >90d unused to `.archived/`; (2) consolidation flags semantic-similarity ≥0.85 + identical 5-trace pairs; (3) skill-from-trace generates SKILL.md from ≥3-tool successful turn; (4) `blade skill list --diff` shows session-over-session changes; (5) dream_mode aborts within 1s of user input | 2 |
| 25 | **Hermes 4 OpenRouter provider** | Open-weight tier flag-plant. ~1 day. | PROVIDER-01..06 (6 REQs) | (1) `providers/openrouter.rs` cargo check clean + parser handles `openrouter/<slug>`; (2) router places hermes-4 in offline-preferred tier; (3) 6-place config rule honored; (4) tool-use round-trip succeeds with `nousresearch/hermes-4-70b`; (5) Anthropic→OpenRouter failover under 429 stays within 8s budget | 1 |
| 26 | **Voice resurrection (JARVIS-01/02)** | v1.2 carry-forward. PTT + Whisper STT wired to v1.2 voice-source-agnostic dispatcher. | JARVIS-01, JARVIS-02 (carry-forward) + VOICE-03..05 (5 REQs total) | (1) PTT global hotkey registers + releases on app exit; (2) Whisper STT → text → dispatcher round-trip; (3) voice-initiated `"create a linear issue: test demo"` opens ConsentDialog; (4) ActivityStrip emits ≥2 entries per voice turn; (5) settings let operator change hotkey + toggle whisper_local without restart | 1 |
| 27 | **v1.3 close** | README, CHANGELOG, audit, archive, gates green. | CLOSE-01..06 (6 REQs) | (1) README cites Voyager + Karpathy + Marcus + agentskills.io; (2) CHANGELOG v1.3 entry parallel to v1.2 shape; (3) cargo + tsc + verify:all all exit 0; (4) `milestones/v1.3-MILESTONE-AUDIT.md` written with phase coverage + 3-source cross-ref + sign-off; (5) Phase 21–27 dirs archived to `milestones/v1.3-phases/` | 1 |

**Total:** 7 phases, 39 requirements (active) + carry-forwards from v1.2 + extensive Future Requirements section, ~12 day target.

---

## Sequencing

```
   Phase 21 (Skills v2 / agentskills.io)         substrate prerequisite
       │
       ▼
   Phase 22 (Voyager loop closure)               load-bearing — needs 21's SKILL.md substrate
       │
       ├──────────────┬──────────────┬──────────────┐
       ▼              ▼              ▼              ▼
   Phase 23        Phase 24        Phase 25       Phase 26     ← all independent after 22
   (reward+OOD)    (dream_mode)    (Hermes 4)     (voice)
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                          │
                          ▼
                      Phase 27 (close)
```

**Hard sequencing:** Phase 21 → Phase 22 (Voyager needs SKILL.md format to write into). Phase 27 closes after all five middle phases land.

**Parallelizable after Phase 22:** Phases 23, 24, 25, 26 can run in parallel waves — none modifies the same module surface as another. Default execution serial for predictable tracking; switch to wave parallelization if velocity demands it (operator decision per phase plan).

**Inter-phase dependencies (light):**
- Phase 23's `reward_trend` signal extends Phase 17's Doctor pane (DOCTOR-02 / `compute_eval_signal` extends to read `reward_history.jsonl`) — non-blocking; Doctor surface adds the row when REWARD-04 lands
- Phase 24's skill-from-trace generation reads Voyager's `skill_used` ActivityStrip entries (Phase 22 contract M-07) — non-blocking; works after Phase 22 ships
- Phase 26's voice path uses Phase 22's VOYAGER-01 capability-gap detector if voice-driven prompts surface gaps (e.g., "summarize this YouTube video" via voice) — non-blocking; voice flow doesn't fail without it

---

## Phase Details

### Phase 21 — Skills v2 / agentskills.io adoption

**Goal:** Establish the substrate format Phase 22's Voyager loop writes into. Switch BLADE's skill format from any prior JSON-shape thinking (per `notes/v1-2-milestone-shape.md` Phase 3 reference) to agentskills.io `SKILL.md` (YAML frontmatter + Markdown body) — interop with Claude Code / OpenAI Codex / OpenClaw / clawhub. Lazy-load progressive disclosure (metadata always at startup; body on activation; references on traversal). Workspace → user → bundled resolution.

**Requirements:** SKILLS-01..08 (8 REQs)

**Success criteria:**
1. **Validator green on bundled exemplars** — `blade skill validate <repo>/skills/<each>` exits 0 across all 3 exemplars (one tool-wrapper, one with `references/`, one with `scripts/`).
2. **Progressive-disclosure token budget holds** — integration test: load 5 skills at startup, assert `body_bytes_loaded == 0`; activate one skill, assert `body_bytes_loaded == 1·body_size`; references untouched until SKILL.md cites a path.
3. **Resolution order correct** — same-name skill in `<repo>/skills/X` and `~/.blade/skills/X`; lookup returns repo-path body.
4. **`verify:skill-format` gate landed** — `bash scripts/verify-skill-format.sh` exits 0; `verify:all` chain count moves 31 → 32.

**Approach hint:** Start with the parser (SKILLS-01) → validator (SKILLS-05) → loader with lazy-load (SKILLS-03) → resolution order (SKILLS-04) → exemplars (SKILLS-06) → consent gate (SKILLS-07) → verify gate (SKILLS-08). Layout enforcement (SKILLS-02) is a parser-side check.

**Locked references:** `agentskills.io/specification` (canonical), `notes/v1-3-hermes-openclaw-skills-research.md` §3 + §4 (format details), `github.com/openclaw/openclaw/blob/main/skills/skill-creator/SKILL.md` (authoritative example). The earlier `notes/v1-3-hermes-openclaw-skills-research.md` documented this format extensively; v1.3 is its execution.

---

### Phase 22 — Voyager loop closure ← load-bearing

**Goal:** Close the existing-by-name Voyager loop in production. The substrate-level differentiator vs Hermes (procedural skill memory) / OpenClaw (tools without skills) / Cluely (recorder) / Cursor (no skill library) / Open Interpreter (tool dispatcher). When BLADE encounters a capability gap, it writes new executable code, registers it, and uses it next time. Two installs of BLADE diverge over time. **Per `voyager-loop-play.md` §"smallest viable demo" — this is the lead substrate moment.**

**Requirements:** VOYAGER-01..09 (9 REQs)

**Success criteria:**
1. **Canonical fixture closed end-to-end** — `cargo test --lib voyager::end_to_end_youtube_transcript` green in <60s; ask → fail → wait → ask again → success; skill file at `~/.blade/skills/youtube-transcript-fetch/SKILL.md` present that wasn't before.
2. **`verify:voyager-loop` gate green deterministically** — `bash scripts/verify-voyager-loop.sh` exits 0 in deterministic mode (no network for LLM call; deterministic skill writer); `verify:all` chain count moves 32 → 33.
3. **ActivityStrip emits all 4 phases** — driving the canonical fixture produces 4 entries: `voyager:gap_detected`, `voyager:skill_written`, `voyager:skill_registered`, `voyager:skill_used` (per M-07 contract).
4. **Two installs diverge** — property test: feed install A `[gap_A1, gap_A2, gap_A3]`, install B `[gap_B1, gap_B2, gap_B3]`; assert skill-manifest set difference non-empty in both directions.
5. **Loop-failure recovery cleans up** — mock tool_forge::register Err; assert `~/.blade/skills/<name>/` empty + new evolution log entry with `prior_attempt_failed=true`.

**Approach hint:** evolution.rs already detects gaps (Phase 16 capability-gap eval lives at `self_upgrade::detect_missing_tool`). autoskills.rs and tool_forge.rs exist by name. Wire is: VOYAGER-01 (real fire) → VOYAGER-02 (autoskills writes) → VOYAGER-03 (tool_forge registers) → VOYAGER-04 (canonical fixture) → VOYAGER-05 (verify gate) → VOYAGER-06 (M-07 emits) → VOYAGER-07 (budget cap) → VOYAGER-08 (failure recovery) → VOYAGER-09 (divergence test). Skill-write-budget cap (VOYAGER-07) prevents the infinite-loop failure mode where a skill write costs > productive budget.

**Locked references:** Voyager paper (Wang et al, NeurIPS 2023, [arXiv 2305.16291](https://arxiv.org/abs/2305.16291)). Karpathy cognitive core thesis. `voyager-loop-play.md` §"build target this week".

---

### Phase 23 — Verifiable reward + OOD eval

**Goal:** Ship a real RLVR-style composite reward signal in production (per `open-questions-answered.md` Q1) so BLADE can self-improve at the agent layer without waiting on Anthropic foundation-level continual learning (steelman Arg 7 mitigation). Mitigate steelman Arg 3 (OOD failure mode) with explicit adversarial / ambiguous / capability-gap-shaped fixtures.

**Requirements:** REWARD-01..07 (7 REQs)

**Success criteria:**
1. **Composite reward computed per turn** with reward-hacking penalties (skill_success penalty if test coverage <50%; eval_gate penalty if turn touches eval assertion code; completion penalty if final action is a no-op).
2. **Per-turn reward persisted** at `tests/evals/reward_history.jsonl` (parallel to existing `tests/evals/history.jsonl` from Phase 16).
3. **OOD eval modules pass baseline floor** — `adversarial_eval.rs`, `ambiguous_intent_eval.rs`, `capability_gap_stress_eval.rs`; each asserts a floor and contributes to `verify:eval`.
4. **Fail-safe reward gating** — simulate 20% drop in adversarial_eval; observe per-turn reward = 0 for the next turn (don't trust reward when OOD eval is breached).
5. **Doctor pane shows `reward_trend`** — DoctorPane.tsx renders new row with severity D-05 mapping (Red >20% drop, Amber >10%, Green otherwise).

**Approach hint:** Start with REWARD-01/02 (compute + verifiable components) → REWARD-04 (persist to jsonl) → REWARD-05 (OOD modules) → REWARD-03 (penalties) → REWARD-06 (fail-safe gate) → REWARD-07 (Doctor extension; small touch). Reward weights are configurable per BladeConfig.reward_weights; defaults are 0.5/0.3/0.1/0.1 from research.

**Locked references:** `open-questions-answered.md` Q1 + sources (RLVR survey, arXiv 2509.15557 Verifiable Composite Rewards, arXiv 2604.12086 Robust Optimization with Correlated Proxies). Steelman Arg 3 + Argument 7 design implications.

---

### Phase 24 — Skill consolidation in dream_mode

**Goal:** Close the continual-forgetting half of the Voyager loop. Skills not used → archived (preserved). Redundant skills → consolidated (with user confirm). Successful traces with no existing skill match → propose new skill (with user confirm). Skill manifest grows visibly between sessions per `voyager-loop-play.md` §"the piece worth shipping is dream-mode that produces a measurable artifact — skill library growth overnight is screenshotable."

**Requirements:** DREAM-01..06 (6 REQs)

**Success criteria:**
1. **Prune pass moves stale skills** — skill with `last_used` ≥91d → moved to `~/.blade/skills/.archived/<name>/` (preserved, not deleted).
2. **Consolidation flags pairs** — semantic-similarity ≥0.85 (per existing embeddings.rs) + identical tool-call traces over last 5 invocations → flag pair for merge with user confirm.
3. **Skill-from-trace generates** — successful turn using ≥3 tool calls without invoking any existing skill → propose SKILL.md with the trace as `scripts/` + body summarizing.
4. **`blade skill list --diff` works across sessions** — 2 sessions with skill changes between, diff output non-empty with correct categorization (added / archived / consolidated).
5. **Dream-mode aborts on user input** — trigger dream_mode → send chat input mid-pass → dream_mode aborts within 1s; no partial-skill artifacts left.

**Approach hint:** dream_mode.rs substrate exists. Order: DREAM-01 (prune; simplest) → DREAM-02 (consolidate) → DREAM-03 (generate from trace) → DREAM-04 (CLI diff) → DREAM-05 (idle gating + abort) → DREAM-06 (M-07 emits).

**Locked references:** `synthesis-blade-architecture.md` §Layer 4 ("forgetting mechanism in dream_mode — continual learning works because of continual forgetting; both halves needed"). `voyager-loop-play.md` §"sleep-cycle consolidation."

---

### Phase 25 — Hermes 4 OpenRouter provider

**Goal:** Add `providers/openrouter.rs` with `nousresearch/hermes-4-70b` model option. Open-weight tier flag-plant. ~1 day. Plants the option without buying Hermes Agent's runtime architecture (per `vs-hermes.md` competitive positioning + `notes/v1-3-hermes-openclaw-skills-research.md` §6).

**Requirements:** PROVIDER-01..06 (6 REQs)

**Success criteria:**
1. **`providers/openrouter.rs` lands** — patterned on `openai.rs` (OpenAI-compatible Chat Completions); cargo check clean.
2. **Provider parser handles `openrouter/<slug>`** — e.g. `openrouter/nousresearch/hermes-4-405b` → (Provider::OpenRouter, "nousresearch/hermes-4-405b").
3. **Router places hermes-4 in offline-preferred tier** — `classify_task` with `privacy_mode=true` routes to OpenRouter+hermes-4 when configured.
4. **Tool-use round-trip succeeds** with `nousresearch/hermes-4-70b` — gated behind `OPENROUTER_API_KEY` env var; skipped in CI without key.
5. **Failover budget held** — Anthropic→OpenRouter failover under simulated 429 stays within 8s budget for short turn.

**Approach hint:** Patterning openai.rs verbatim works because Hermes 4 OpenRouter endpoint is OpenAI-compatible. 6-place config rule for `openrouter_api_key` + `default_openrouter_model` (PROVIDER-04) is the most error-prone step — grep the 6 sites carefully (CLAUDE.md docs the rule).

**Locked references:** [Hermes 4 70B on OpenRouter](https://openrouter.ai/nousresearch/hermes-4-70b), [Hermes Function Calling spec](https://github.com/NousResearch/Hermes-Function-Calling), `notes/v1-3-hermes-openclaw-skills-research.md` §6.

---

### Phase 26 — Voice resurrection (JARVIS-01/02 carry-forward)

**Goal:** Wire PTT global hotkey + Whisper STT to the existing v1.2 chat dispatcher (signature is voice-source-agnostic by design per v1.2 audit M-04 hand-off note). Voice → chat → consent → action exercised end-to-end. JARVIS-01/02 carry-forward from v1.2 Phase 18 deferral under chat-first pivot pause.

**Requirements:** JARVIS-01 + JARVIS-02 (carry-forward) + VOICE-03..05 (5 REQs total)

**Success criteria:**
1. **PTT global hotkey** — register_global_shortcut succeeds (default `Ctrl+Alt+Space` on Win/Linux, `Cmd+Opt+Space` on Mac); releases on app exit.
2. **Whisper STT round-trip** — feature flag `whisper_local` default OFF; gracefully fails with "voice unavailable" if not built; when ON, audio → transcript → dispatcher.
3. **End-to-end voice trigger** — operator holds PTT, speaks "create a linear issue: test demo", releases → ConsentDialog opens with the parsed intent.
4. **ActivityStrip emits voice events** — ≥2 entries per voice turn (`voice_captured`, `transcript_dispatched`) before downstream chat/JARVIS entries.
5. **Settings live-reload** — settings let operator change hotkey + toggle `whisper_local` without restart.

**Approach hint:** voice_global.rs PTT primitive stays in tree per v1.2 audit; this phase adds the wiring to the v1.2 dispatcher (jarvis_dispatch / commands.rs send_message_stream). Whisper integration is gated behind feature flag for cargo-build portability (LLVM/libclang dep).

**Locked references:** v1.2-MILESTONE-AUDIT.md `tech_debt` entry on JARVIS-01/02. Commit `2230333` (Plan 18-14 Task 3) tokio::oneshot consent — voice will hit the same path. CLAUDE.md Voice section.

---

### Phase 27 — v1.3 close

**Goal:** README rewrite + CHANGELOG + milestone audit + phase archive + final gate sweep. Match v1.1 / v1.2 closure shape.

**Requirements:** CLOSE-01..06 (6 REQs)

**Success criteria:**
1. **README cites the research** — Voyager paper, Karpathy cognitive core, Marcus on neurosymbolic, agentskills.io spec; new `## Architectural bets` section.
2. **CHANGELOG v1.3 entry** — Added (Skills v2, Voyager loop, RLVR composite reward, OOD eval, dream_mode consolidation, Hermes 4 provider, voice resurrection); Changed (verify gates 31 → 33+); Deferred (organism + meta + active-inference + persona + immune + federation + v1.2 carry-overs to v1.4).
3. **Static gates green** — cargo check + npx tsc --noEmit + npm run verify:all all exit 0.
4. **Milestone audit doc** — `milestones/v1.3-MILESTONE-AUDIT.md` parallel to `v1.1`/`v1.2` shape (phase coverage, requirements 3-source cross-ref, static gates, executive verdict, sign-off, status `green` or `tech_debt`).
5. **Phase archive** — `phases/21-*/` through `phases/26-*/` moved to `milestones/v1.3-phases/`; Phase 27 moves last.
6. **Traceability closed** — REQUIREMENTS.md + ROADMAP.md every checkbox closed (or marked deferred with carry-forward target); footer dates reflect close.

**Approach hint:** Phase 27 is the last phase; runs after Phases 21–26. README rewrite (CLOSE-01) is the most user-facing artifact; CHANGELOG (CLOSE-02) is the most decision-laden; audit doc (CLOSE-04) follows v1.2's exact YAML frontmatter shape.

**Locked references:** `milestones/v1.2-MILESTONE-AUDIT.md` (template), `CHANGELOG.md` v1.2 entry (template), `voyager-loop-play.md` §"Show HN narrative" (README phrasing reference, but honest framing per steelman Arg 1).

---

## Risk register

Tracking risks that could derail v1.3 ship target. Each gets a mitigation in the relevant phase plan.

| Risk | Phase impacted | Mitigation |
|---|---|---|
| Voyager loop too brittle for verify gate (deterministic closure flaky) | 22 | Mock LLM in deterministic mode; pin skill writer output; widen budget if first attempt times out |
| Skills v2 progressive-disclosure assertion hard to test cleanly | 21 | Use fs read counters in test harness; check before/after activation; bytes-loaded delta is the assertion |
| Hermes 4 OpenRouter API behavior diverges from OpenAI shape (esp. `<think>` reasoning traces) | 25 | Defer reasoning-trace handling; default `reasoning_enabled: false` for first cut; log if model emits unexpected fields |
| Whisper STT feature-flag build breaks Linux/macOS/Windows CI | 26 | Feature flag default OFF in `Cargo.toml`; CI smoke run with feature OFF; release-build gates feature ON only on platforms where libclang is present |
| dream_mode skill-from-trace generates noisy / low-quality SKILL.md | 24 | Manual confirm prompt before write; show full proposed body in dialog; user can edit before save |
| Reward-hacking penalties calibrate wrong (penalize legit work too aggressively) | 23 | Land penalties at low default weight; bump only after observing 1 week of reward_history.jsonl in production; surface penalty events in Doctor for debug |
| Phase 22 takes longer than budget (3 days) | 22 | Hard fallback: ship with synthetic-LLM fixture for VOYAGER-04 only; real-LLM path lands in v1.3.1 patch — but the gate stays green and the substrate ships |

---

## Out-of-roadmap (deferred from v1.3 to v1.4+)

- Organism layer (vitality, hormones, mortality salience) — needs safety bundle; ship as v1.4 bundle or skip permanently
- Metacognitive controller v0
- Active-inference loop closure
- Persona shaping via curated SFT data
- Immune / behavioral-drift cross-cutting layer
- Federation Pattern A + selection mechanisms
- V-JEPA 2 world model integration (Layer 2 — research arc, v3+)
- TTT continual learning at agent layer (Layer 3 — vulnerable per steelman Arg 7; v2+)
- Phase 19 UAT close (12 v1.2 + 11 v1.1 carry-overs)
- OpenClaw gateway sidecar
- Profile isolation work/personal split
- Browser-harness adoption final decision (D-20 conditional close)
- D-04 Step 2 LLM intent fallback for ambiguous classification
- Fast-streaming branch ego accumulator refactor

Each is in REQUIREMENTS.md `## Future Requirements` with explicit reasoning + carry-forward target.

---

## Notes

- **Phase numbering continues globally** per M-05 / M-12. v1.3 starts at 21; v1.4 starts at the phase after v1.3 closes.
- **Activity log strip is load-bearing.** Every cross-module action in v1.3 must continue to emit (M-07 v1.1 contract).
- **Performance budgets carry forward from v1.0/v1.1/v1.2.** Dashboard first paint ≤200ms on integrated GPU, max 3 backdrop-filter per viewport, blur caps 20/12/8px.
- **Verify gates extend, not replace.** v1.3 adds `verify:skill-format` + `verify:voyager-loop` + extended `verify:eval` OOD coverage. Existing 31 gates must stay green; regressions fail the phase.
- **Static gates ≠ done** per CLAUDE.md `## Verification Protocol` — the v1.1 retraction lesson holds; runtime UAT applies to chat-functionality regressions even under chat-first pivot. UI-only deferrals remain operator-blessed.
- **No new tentacle classes.** v1.3 obeys M-01 + v1.2 acting-work anchor: substrate work, not new feature classes.

---

*Last updated: 2026-04-30T22:30Z — v1.3 ROADMAP.md written during autonomous milestone bootstrap.*
