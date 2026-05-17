# BLADE — Milestones

Historical record of shipped versions. Each entry summarizes what shipped, what was deferred, and where to look for the full archive.

---

## v2.3 — HARNESS-REBUILD-ON-CLAW (in progress, scoped 2026-05-17)

**Status:** In progress
**Phases planned:** 62–67 (6 phases)
**Artifacts:** `milestones/v2.3-REQUIREMENTS.md`, `milestones/v2.3-ROADMAP.md`, `milestones/v2.3-STATE.md`, `research/v2.3-competitor-scan.md`

### Trigger

Mac UAT 2026-05-17 reported the v2.2 build silently drops `tool_use` blocks on conversational-shaped prompts ("check my calendar" → 17 chars → fast-path streaming → text rendering instead of tool dispatch). Forge can't fire because `loop_engine::run_loop` is never reached on chat-shaped turns. `forged_tools` table stayed at 0 rows across every probe.

### Scope (single focus: functionality recovery)

- **Phase 62 TOOL-LOOP-ALWAYS** — rip the `is_conversational` heuristic at `commands.rs:1822` + add a Hermes-style streaming parser gate that switches to tool-accumulation on first `tool_use`/`<tool_call>` event.
- **Phase 63 FORGE-GITHUB-FIRST** — search GitHub for existing MCP servers before write-from-scratch (operator-surfaced).
- **Phase 64 MAC-SIGNED-RELEASE** — Developer ID + stable bundle ID so install doesn't trigger a permission storm.
- **Phase 65 STATUS-INDICATOR-RENDER** — chat UI shows "Working…" between send and first token.
- **Phase 66 ONBOARDED-FLAG-FROM-STATE** — flags reflect actual state; skill seed model_hint upgrade.
- **Phase 67 CLOSE** — operator UAT on signed Mac build; falsification test (calendar prompt → real tool dispatch) must pass.

### Authority

VISION.md (locked 2026-05-10) → decisions.md 2026-05-17 → Mac UAT report → REQUIREMENTS.md.

---

## v2.2 — VISION-Close + Goose-Integrate + Launch-Ready

**Shipped:** 2026-05-14 (status: tech_debt — OEVAL-01c v1.4 carry-forward persists; v2.3+ follow-ups documented in `v2.2-MILESTONE-AUDIT.md`)
**Phases:** 53–61 (9 phases)
**Archives:** `milestones/v2.2-ROADMAP.md`, `milestones/v2.2-REQUIREMENTS.md`, `milestones/v2.2-MILESTONE-AUDIT.md`, `milestones/v2.2-phases/`

### Delivered

The wedge milestone. Three workstreams in 9 phases, anchored on a 5-agent parallel research swarm 2026-05-14.

1. **Close load-bearing VISION gaps** —
   - Phase 53 ships the fifth primitive (presence) as a new chat-line kind. Evolution Engine + vitality bands + learning patterns now emit visible-to-user narration lines, decision-gated through `decision_gate::evaluate`. Brain prompt includes latest 3 emissions + current vitality band as a `<presence_state>` stance modulator. Closes VISION line 53.
   - Phase 56 makes setup-as-conversation produce a TELOS-shaped optimization target (Mission / Goals / Beliefs / Challenges) — `~/.blade/who-you-are.md` written with YAML frontmatter, brain prompt ingests on every turn, `/edit-self` chat command + `blade_open_who_you_are` Tauri command.
   - Phase 59 reorganizes the VISION §57–64 held-trio (Body Map / mortality-salience / Ghost Mode) into a `/dev-tools` route + Settings → Developer pane. Demoted from main nav, still accessible. Per workspace rule (no_feature_removal — reorganize hierarchy, don't delete).

2. **Stop building what already exists** —
   - Phase 54 adopts Goose's Provider + ProviderDef traits (Apache 2.0) + `canonical_models.json` (4,355 entries / 117 providers, bundled verbatim). Router consults the registry for context-window + pricing. All 5 BLADE providers (anthropic/openai/groq/gemini/ollama) implement the new trait. VISION roadmap line 156 milestone met.
   - Phase 55 adopts Goose's SQLite session schema — 4 tables (sessions/session_messages/tool_calls/tool_results) + indexes. `SessionManager` CRUD + transactional fork. `send_message_stream` dual-writes new schema + legacy JSON history. Substrate for v2.3 "second time destroys it"; legacy stays canonical for v2.2.
   - Phase 57 adopts OpenClaw's skill-as-markdown pattern at `~/.config/blade/skills_md/`. Directory loader + trigger-matching dispatch + `blade_install_skill(url)` Tauri command. 5 seed skills shipped via `include_str!` (`summarize-page`, `draft-followup-email`, `extract-todos-from-notes`, `morning-context`, `kill-tabs-i-dont-need`).
   - Phase 58 removes the embeddings vector layer (PAI v5 evidence + Zep paper personal-scale data — vectors don't earn weight at ~100k facts + typed-category structure + 1M-context models). BM25 + KG only. fastembed + ~80 transitive deps dropped (Cargo.lock -567 net entries). Existing hybrid_search_eval 8/8 still passes on BM25-only path (MRR 1.000).

3. **Prep the forge launch trigger** —
   - Phase 60 assembles everything for operator to record + post: 75s screencast script (`scripts/demo/launch-forge-demo.md`), README rewrite (8-word literal first line + `curl|sh` install command above the fold), Show HN post (`docs/launch/show-hn-post.md`), Miessler DM template (`docs/launch/miessler-dm.md`), 3-tweet launch thread (`docs/launch/launch-tweet-thread.md`). Recording + posting are operator-owned per V2-AUTONOMOUS-HANDOFF.md §1.

4. **Close (Phase 61)** — CHANGELOG v2.2 entry, MILESTONE-AUDIT, phase archive, MILESTONES.md update to Shipped, git tag `v2.2` (operator pushes when ready).

### Verify chain

`cargo check` clean. `tsc --noEmit` clean. Phase-specific test counts:
- Phase 53: 5 unit + 4 integration (presence)
- Phase 54: 5 integration + 33/33 existing provider tests
- Phase 55: 10 integration (sessions)
- Phase 56: 5 integration (TELOS)
- Phase 57: 5 integration + 16 unit (skills-md)
- Phase 58: 3 new + 8/8 existing hybrid_search_eval BM25-only path
- Phase 59: 2 Playwright e2e
- Phase 60: docs-only

`verify:all` not regressed below the 37/38 v2.1 floor (OEVAL-01c v1.4 carry-forward documented since v1.4).

### Surprises (logged to ~/surprises.md)

1. **Concurrent multi-agent `git add` race** — 4-way parallel Wave A surfaced cross-agent index leakage; selective `git reset --soft` + restage was the recovery pattern. 2-way Wave B was fine.
2. **`#[cfg(test)] pub fn` invisible to integration tests** — fix is `#[doc(hidden)] pub fn`.
3. **Goose canonical_models bigger than scoped** — 4,355 entries vs ~1,700 estimate; used verbatim.
4. **Skills namespace already occupied by Phase 21** — `skills_md/` adopted alongside, both modules coexist.

### Carry-forward to v2.3+

OEVAL-01c v1.4 persists. v2.3+ follow-ups: "second time destroys it" memory continuity cutover (substrate ready in Phase 55), Goose Recipes engine (defer), Cline-style approval gate (operator-dogfood), context-gated privacy questions (VISION §44, wait for trust primitive), held-trio full evaluation (engagement data), vector retrieval re-evaluation (3 callers TODO-flagged), CDN provisioning + Windows ARM64 + shellcheck CI, Gmail OAuth error-type migration.

### Authority chain

VISION.md (locked 2026-05-10) → V2-AUTONOMOUS-HANDOFF.md → v2.1-MILESTONE-AUDIT.md carry-forward → 5-agent research swarm 2026-05-14 → v2.2-REQUIREMENTS.md → execution. No §7 wake conditions fired. WSL crashed once mid-Phase-55-wrap-up; substantive work intact, SUMMARY reconstructed inline.

---

## v2.1 — Hunt + Forge + OAuth Depth

**Shipped:** 2026-05-13 (status: tech_debt — OEVAL-01c v1.4 carry-forward + v2.2+ follow-ups documented)
**Phases:** 49–52 (4 phases)
**Archives:** `milestones/v2.1-ROADMAP.md`, `milestones/v2.1-REQUIREMENTS.md`, `milestones/v2.1-MILESTONE-AUDIT.md`, `milestones/v2.1-phases/`

### Delivered

Polish + completion pass on v2.0. Closes the rough edges in hunt onboarding, OAuth coverage, and forge robustness. No architectural reframe (deferred to v2.2+).

1. **Hunt Advanced + Cost Surfacing (Phase 49)** — HUNT-05 answer-driven probing chain (fresh-machine path → sharp question → user answer drives subsequent probes). HUNT-06 thematic contradiction-detection (second LLM pass classifies findings into work/personal/hobby/past-self clusters; surfaces specific question on conflict). Live cost surfacing for hunt + forge with $3 default budget, soft 50% warning, hard 100% interrupt.
2. **OAuth Coverage (Phase 50)** — Slack OAuth v2 full impl (no-refresh-token surfaces via `Err(NotSupported)`); GitHub OAuth full impl with device-code flow for headless. 10/10 OAuth integration tests (3 Gmail + 4 Slack + 3 GitHub).
3. **Forge Multi-Gap Robustness (Phase 51)** — 3 new gap fixtures (arXiv + RSS + PyPI); 8/8 forge e2e tests; prompt tuning with explicit language anchors + library hints + JSON-serializable return + HN few-shot. Pre-check refined with `PreCheckOutcome` enum routing MCP-cataloged-but-not-installed → fire forge per user autonomy preference.

### Verify chain

cargo + tsc clean. 45/45 onboarding tests + 8/8 forge e2e + 10/10 OAuth integration + verify:all 37/38 (OEVAL-01c carry-forward).

### Carry-forward

OEVAL-01c v1.4 persists. v2.2+ follow-ups: agent-native audit recs #2-10 (architectural reframe), decision_gate threshold tuning (operator-dogfood), VISION-held trio re-evaluation, CDN provisioning + CI lint gates, Gmail error-type migration, Slack token-rotation, 5th holdout forge gap, Tauri-runtime emit assertions, `immune_system::check_mcp_catalog` retirement.

---

## v2.0 — Setup-as-Conversation + Forge Demo

**Shipped:** 2026-05-13 (status: tech_debt — OEVAL-01c v1.4 carry-forward + v2.1+ follow-ups documented)
**Phases:** 45–48 (4 phases)
**Archives:** `milestones/v2.0-ROADMAP.md`, `milestones/v2.0-REQUIREMENTS.md`, `milestones/v2.0-MILESTONE-AUDIT.md`, `milestones/v2.0-phases/`

### Delivered

First end-user-shippable release. The four VISION primitives live in chat, not just in the substrate.

1. **Install pipeline (Phase 45)** — `curl -sSL slayerblade.site/install | sh` on macOS+Linux; `iwr -useb slayerblade.site/install.ps1 | iex` on Windows. Architecture detection (arm64 vs x86_64) with Rosetta brand-string override. Upgrade preserves `~/.blade/who-you-are.md`, keychain, blade.db. macOS Gatekeeper auto-cleared via `xattr -cr`. CDN fallback URL wired (provisioning is v2.1+).
2. **Agentic hunt onboarding (Phase 46)** — Pre-scan ≤2s → message #1 with "feels illegal but legal" register → LLM-driven hunt with sandboxed readonly tools narrated live in chat → `platform_paths.md` per-OS knowledge file → synthesis to `~/.blade/who-you-are.md` (user-editable) → first task closes onboarding by BLADE *acting*, not a setup-complete screen. Steps wizard ripped (621 LOC retired). OAuth: Gmail full + 3 mock-server integration tests pass; Slack + GitHub stubs (v2.1+ for full impl).
3. **One forge wire (Phase 47)** — The Twitter-video moment per VISION:40. Gap chosen = HackerNews top-N stories (overrode Twitter recommendation because Twitter already had MCP routing that would short-circuit the forge). 5 chat-line emissions wired (gap_detected → writing → testing → registered → retrying). Pre-check searches existing tools before firing. End-to-end loop covered by 5/5 mock-LLM integration tests. Real-LLM screencast path documented in `scripts/demo/forge-demo.md`.

### Verify chain

`cargo check` clean; `tsc --noEmit` clean; `verify:all` 37/38 (OEVAL-01c v1.4 carry-forward); 5/5 forge e2e tests pass; 3/3 OAuth Gmail integration tests pass.

### Carry-forward

OEVAL-01c v1.4 organism-eval drift persists. CDN provisioning + advanced hunt fallback + Slack/GitHub OAuth full impl + agent-native audit recs #2-10 deferred to v2.1+. Held-for-v2.0-evaluation trio (Body Map, mortality-salience, Ghost Mode) carries to v2.1+ pending operator-dogfood signal.

---

## v1.6 — Narrowing Pass

**Shipped:** 2026-05-13 (started 2026-05-12 with chore deletions; retroactive scaffold + Phases 40-44 closed 2026-05-13)
**Phases:** 39–44 (6 phases — Phase 39 retro-wraps 7 chore commits)
**Status:** ✅ Shipped (audit status: tech_debt — inherited OEVAL-01c v1.4 carry-forward; no v1.6-introduced gaps).
**Archives:** `milestones/v1.6-ROADMAP.md`, `milestones/v1.6-REQUIREMENTS.md`, `milestones/v1.6-MILESTONE-AUDIT.md`, `milestones/v1.6-phases/`

### Scope

**Phase 39 — Vertical Deletions (SHIPPED retroactively)** — 7 `chore(v1.6)` commits remove the verticals VISION named "Removed (locked)":
1. Financial Brain (`ae54a15`)
2. Health Guardian (`b775857`)
3. Security Monitor (`7083d14`)
4. Pentest Mode incl. Kali (`c0bf13f`)
5. Workflow Builder (`2686761`)
6. deeplearn auto-write synthesizer (`568b236`)
7. Deep Scan + ecosystem auto-enable + scan onboarding (`aa789f7`)

**Phases 40–43 — Significantly Reduced items** per VISION cut list:
- Phase 40: Always-On → On-Demand (Total Recall + Audio Timeline + tentacle passive obs default-off)
- Phase 41: Persona Auto-Extraction Removal (rip silent inference from filenames + shell history)
- Phase 42: Background Agent Delegation (detect + route to user's Claude Code / Cursor / Goose / Aider)
- Phase 43: Pulse Reduction (cron primitive stays; daily-summary engine cuts)

**Phase 44 — Close** — CHANGELOG v1.6, MILESTONE-AUDIT, phase archive, README narrowed-scope update, git tag v1.6.

**Onboarding Steps cut folded to v2.0 Phase 1** per V2-AUTONOMOUS-HANDOFF §0 item 7 — the hunt replaces Steps wholesale, avoid two passes on same files.

### Close criteria

- `verify:all` ≥36/38 (OEVAL-01c v1.4 carry-forward documented)
- cargo check + tsc --noEmit clean
- CHANGELOG + MILESTONE-AUDIT + phase archive shipped
- Git tag `v1.6` pushed

---

## v1.5 — Intelligence Layer

**Shipped:** 2026-05-08 (status: tech_debt — runtime UAT operator-deferred)
**Phases:** 32–38 (7 phases, 59 plans)
**Archives:** `milestones/v1.5-ROADMAP.md`, `milestones/v1.5-REQUIREMENTS.md`, `milestones/v1.5-MILESTONE-AUDIT.md`, `milestones/v1.5-phases/`

### Delivered

Transformed BLADE's naive 12-iteration tool loop into agentic intelligence. Selective context injection (CTX-01..07, 8 brain sections gated by relevance), condenser compaction (keep-first-8k + last-8k, LLM-summarize middle), mid-loop verification every 3 tool calls (LOOP-01..06), stuck detection on 5 semantic patterns + circuit breaker + cost guard + JSONL session log + resume + fork (RES-01..05, SESS-01..04), brain_planner → swarm auto-decomposition with isolated sub-agent contexts (DECOMP-01..05), tree-sitter symbol graph + personalized PageRank repo map + canonical_models.json capability registry + @context-anchor chat syntax (INTEL-01..06), 26-fixture intelligence eval suite + verify:intelligence gate #38 (EVAL-01..05).

37 → 38 verify gates. 435+ tests. cargo check + tsc clean. OEVAL-01c v1.4 organism-eval drift documented as carry-forward tech_debt. Phases 32-37 closed at checkpoint:human-verify boundary; runtime UAT operator-deferred per feedback_deferred_uat_pattern.md.

---

## v1.4 — Cognitive Architecture

**Shipped:** 2026-05-03 (zero debt at close)
**Phases:** 25–31 (7 phases)
**Archives:** `milestones/v1.4-ROADMAP.md`, `milestones/v1.4-REQUIREMENTS.md`, `milestones/v1.4-MILESTONE-AUDIT.md`, `milestones/v1.4-phases/`

### Delivered

The organism layer. Metacognitive controller v0 (META-01..05) — confidence-delta detection, verifier routing, gap log → evolution.rs, DoctorPane signal. Safety bundle (SAFE-01..07) — danger-triple detection, mortality-salience cap, steering-toward-calm bias, eval-gate vitality drain, anti-attachment guardrails. Hormone physiology + emotion classifier (HORM-01..09) — 7 hormones with decay/gain, text→valence/arousal→hormone with α=0.05 smoothing, behavioral modulation (cortisol→terse, dopamine→exploration). Active inference loop (AINF-01..06) — tentacle predictions, prediction error → hormone bus → behavior, prediction-error-weighted memory replay. Vitality engine (VITA-01..06) — 0.0–1.0 scalar with 5 behavioral bands, SDT replenishment, dormancy at 0.0. Organism eval (OEVAL-01..05) — vitality dynamics, hormone-driven behavior, persona stability, 13/13 fixtures MRR 1.000, verify:organism gate.

37 verify gates, 435+ tests.

---

## v1.3 — Self-Extending Agent Substrate

**Shipped:** 2026-05-02 (closed at Phase 24)
**Phases:** 21–24 (4 phases)
**Archives:** `milestones/v1.3-ROADMAP.md`, `milestones/v1.3-REQUIREMENTS.md`, `milestones/v1.3-MILESTONE-AUDIT.md`, `milestones/v1.3-phases/`

### Delivered

The forge substrate (per VISION.md primitive #3). SKILLS — agentskills.io SKILL.md format (YAML+MD), progressive disclosure, workspace→user→bundled resolution, validator + 3 bundled exemplars (Phase 21, 65 tests). VOYAGER — `evolution.rs → autoskills.rs → tool_forge.rs` end-to-end, verify:voyager-loop gate, deterministic `youtube_transcript` fixture (Phase 22, 21 tests). REWARD — RLVR-style composite reward (0.5·skill_success + 0.3·eval_gate + 0.1·acceptance + 0.1·completion), 3 OOD eval modules, DoctorPane RewardTrend row, verify:eval extended to 8 modules (Phase 23, 45 tests). DREAM — `dream_mode.rs` skill consolidation (prune >90d, consolidate redundant, generate from traces), `.pending/` proposal queue, chat-injected operator confirmation, skill_validator CLI (Phase 24, 435 tests total at close).

**Note:** The forge substrate has not fired on a real capability gap in lived chat as of 2026-05-13 (11 days). v2.0 wires the Twitter-video forge demo per VISION:40.

---

## v1.2 — Acting Layer with Brain Foundation

**Shipped:** 2026-04-29 (closed 2026-04-30 at status tech_debt)
**Phases:** 16–20 (5 phases)
**Archives:** `milestones/v1.2-ROADMAP.md`, `milestones/v1.2-REQUIREMENTS.md`, `milestones/v1.2-MILESTONE-AUDIT.md`, `milestones/v1.2-phases/`

### Delivered

Chat → consent → cross-app write. Brain foundation: brain.rs system-prompt builder assembles identity + vision + memory + tools + personality from 16 context sections. JARVIS push-to-talk (deferred from v1.1 M-04). 4 tier-1 acting tentacles wired: Gmail send, Calendar create, Slack send, GitHub PR. Cross-app consent dialog per action class. Phase 19 wholesale + JARVIS-01/02 voice + JARVIS-12 cold-install demo deferred to v1.3.

### Strategic anchor (2026-04-30)

Chat-first pivot — "one chat capable of doing anything." UI-polish UAT deferred for UI-only phases; chat capability + tool reliability prioritized. Carried into v1.3 + v1.4 + v1.5.

---

## v1.1 — Functionality, Wiring, Accessibility

**Shipped:** 2026-04-24 (closed 2026-04-27)
**Phases:** 10–15 (6 phases, 29 plans, ~133 commits)
**Status:** ✅ Complete (audit status: tech_debt — no blockers; 11 operator-owned UAT items deferred)

### Delivered

The v1.0 substrate became something a first-time user can actually use. Every backend has a UI surface or a documented v1.2 deferral; capability-aware provider routing landed; smart deep scan replaces the dumb sweep; observer-class tentacles auto-enable behind a runtime guardrail; the activity-log strip mounts in the main shell; the spacing/density pass tokenized the surface.

### Key Accomplishments

1. **Smart Provider Setup** (Phase 11) — paste cURL/JSON/Python → auto-extract provider+model+headers; capability probe persists vision/audio/long-context/tool-calling support; router does 3-tier capability-aware resolution with capability-filtered fallback chains; 8 capability-gap consumer surfaces with deep-link CTAs.
2. **Smart Deep Scan** (Phase 12) — replaced 12-scanner sweep with lead-following scanner across 8 source classes (filesystem walk, git remotes, IDE workspaces, AI sessions, shell history, MRU, bookmarks, `which` sweep); structured editable profile with round-trip persistence.
3. **Self-Configuring Ecosystem** (Phase 13) — 6 observer probes (repo-watcher, Slack, deploy-monitor, PR-watcher, session-bridge, calendar) auto-enable from scan; runtime `OBSERVE_ONLY: AtomicBool` guardrail rejects outbound writes; per-tentacle rationale + one-click disable in Settings.
4. **Wiring & Activity Log** (Phase 14) — closed every NOT-WIRED gap from Phase 10 audit (97 deferred-with-rationale to v1.2); replaced 3 ComingSoonCards on Dashboard with live tentacle/calendar/integrations bindings; persistent ActivityStrip + ActivityDrawer with 500-entry localStorage ring buffer.
5. **Density + Polish** (Phase 15) — spacing-ladder audit + verify gate (0 violations across 39 CSS files); empty-state copy rewrite across 18 files (173 TSX scanned, 0 bare-negation); top-bar 4-tier hierarchy with 1280/1100 responsive guardrails; Dashboard RightNowHero with 4 live-signal chips.
6. **Verify chain** — verify:all grew from 18 (v1.0) to 27 gates (v1.1), all green; tsc --noEmit clean; npx playwright specs across phases 11/14/15.

### Known Deferred Items at Close

11 operator-owned UAT items (per v1.0 Mac-smoke convention) — see STATE.md `## Deferred Items` and `.planning/milestones/v1.1-MILESTONE-AUDIT.md`. Categories:

- 4 cold-install screenshots (Phase 12 SCAN-13, Phase 13 ECOSYS-10, Phase 14 Dashboard, Phase 15 RightNowHero)
- 3 runtime persistence checks (activity-strip cross-route, drawer focus-restore, localStorage rehydrate-on-restart)
- 2 visual passes (5-wallpaper contrast for A11Y2-02 and DENSITY-03)
- 1 keyboard-nav UAT (A11Y2-01 tab traversal + focus rings)
- 1 50-route empty-state ⌘K sweep (DENSITY-05/06)

Plus 97 NOT-WIRED backend modules flagged DEFERRED_V1_2 in 10-WIRING-AUDIT.json.

### Archives

- `milestones/v1.1-ROADMAP.md` — full phase details
- `milestones/v1.1-REQUIREMENTS.md` — all 61 requirements with completion evidence
- `milestones/v1.1-MILESTONE-AUDIT.md` — 3-source coverage cross-reference + tech-debt log
- `milestones/v1.1-phases/` — phase 10..15 working directories (SUMMARYs, VERIFICATIONs, plans)

---

## v1.0 — Skin Rebuild (substrate)

**Shipped:** 2026-04-19 (~165 commits, 64 plans, 18 verify gates green)
**Phases:** 0–9 (10 phases)
**Status:** ✅ Substrate complete; Mac smoke (M-01..M-46) and WCAG 5-wallpaper checkpoints operator-owned per `HANDOFF-TO-MAC.md`. Was never formally archived via complete-milestone — phase directories remain at `.planning/phases/0[0-9]-*` for reference.

### Delivered

178+ Rust modules, 764 `#[tauri::command]`s, 73 event emitters; 5 windows boot; design tokens locked; 9 self-built primitives (no shadcn/Radix); typed Tauri wrapper + useTauriEvent + BLADE_EVENTS registry; custom router; ConfigContext; chat streaming + tool calls; Voice Orb + QuickAsk + Ghost Mode + HUD bar; 18 verify gates green; 156 v1 requirements shipped.

See `git log` before commit `6a78538` for the v1.0 REQUIREMENTS.md.

---

*Updated 2026-05-13 — v1.6 entry added at retroactive scaffold landing; v1.2/v1.3/v1.4/v1.5 entries backfilled.*
