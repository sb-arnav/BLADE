# Phase 38: Close — Context

**Gathered:** 2026-05-08
**Status:** Ready for planning
**Source:** Synthesised from ROADMAP.md (lines 215-225 — Phase 38 success criteria), REQUIREMENTS.md, PROJECT.md, CLAUDE.md, the v1.4 milestone close template (`.planning/milestones/v1.4-MILESTONE-AUDIT.md` 89 lines + the v1.4-phases archive structure), the existing CHANGELOG.md (v1.4 entry at lines 16-75 as the structural template), README.md (current Cognitive Architecture section at line 77, Research Foundations at line 373, Roadmap section at line 336), and the Phase 32–37 close-out artifacts (each phase's CONTEXT + 1+ SUMMARYs documenting code-complete-with-UAT-deferred posture). Autonomous decisions per Arnav's standing instruction; no interactive discuss-phase.

<domain>
## Phase Boundary

**What this phase delivers:**
Phase 38 closes the v1.5 Intelligence Layer milestone with the standard four-artifact closure: (a) README's Cognitive Architecture / Research Foundations sections extend with the v1.5 Intelligence Layer narrative — ported research citations explicit (Claude Code architecture per arxiv 2604.14228, Aider repo map, OpenHands condenser, Goose capability registry, mini-SWE-agent), (b) CHANGELOG.md gains a `## [1.5.0]` entry mirroring the v1.4 shape (per-phase feature breakdown across phases 32–38, verify gate count line, dual-mode eval lane note), (c) `.planning/milestones/v1.5-MILESTONE-AUDIT.md` written following the 89-line v1.4 audit template — Executive Verdict, Phase Coverage table, Requirements Coverage 3-source cross-reference for INTEL/CTX/LOOP/RES/SESS/DECOMP/EVAL/CLOSE = 38 requirements + 4 close requirements = 42 total, Static Gates table, Sign-off, and (d) phase directories `.planning/phases/32-context-management` through `.planning/phases/38-close` move to `.planning/milestones/v1.5-phases/` matching the v1.4-phases archive directory structure. Phase 38 ships ZERO production-code changes. The milestone closes with `tech_debt` status (NOT `complete`) because (1) Phases 32–37 ship at the `checkpoint:human-verify` boundary with operator-deferred runtime UAT per memory `feedback_deferred_uat_pattern.md`, and (2) the pre-existing OEVAL-01c v1.4 organism-eval drift in `verify:eval` / `verify:hybrid_search` gates is documented out-of-scope per Phase 32–37 SCOPE BOUNDARY and carries forward as a v1.6+ intake item. The v1.1 and v1.2 milestones both shipped `tech_debt`; v1.5 mirrors that posture honestly. v1.5 is the third `tech_debt` close in BLADE's history; v1.3 + v1.4 shipped `complete`.

**What this phase does NOT touch:**
- Production Rust code (`src-tauri/src/`) — Phase 38 is documentation-only; zero `*.rs` edits
- Production frontend code (`src/`) — zero React/TypeScript edits
- Provider system, intelligence/ module, evals/ module, loop_engine, resilience, decomposition — all locked in Phase 32-37 close-outs; Phase 38 reads-only
- The 188 pre-existing staged deletions in `.planning/phases/00-31-*/` (ARE prior milestone archive moves; `git add` SPECIFIC paths only — never `-A`/`.`)
- Phase 32-37 SUMMARY content — already committed; Phase 38's archive task moves the directories without editing them
- The OEVAL-01c v1.4 organism-eval drift repair — explicitly out-of-scope per Phase 32-37 boundary; carry-forward to v1.6+
- Operator-deferred runtime UAT for Phases 32-37 — belongs to the operator; Phase 38 documents the carry-forward without acting on it
- `BLADE_RUN_BENCHMARK=true scripts/run-intel-benchmark.sh` execution + `eval-runs/v1.5-baseline.json` commit — operator-deferred per Phase 37-08 close-out
- New verify gates — verify:intelligence already shipped in Phase 37-07 as the 38th gate; Phase 38 adds zero
- Version bumps in `package.json`, `src-tauri/Cargo.toml`, `tauri.conf.json` — operator-controlled per CHANGELOG D-227; Phase 38 does NOT bump
- Git tags — operator triggers `git tag v1.5.0` after acceptance; Phase 38 does NOT tag
- GitHub release pipeline — operator concern; Phase 38 stays local
- v1.6+ scope-defining work (e.g. live A/B routing eval, multi-session aggregate eval, live file-watcher symbol graph updates) — explicitly out per Phase 36/37 deferred lists; v1.6 milestone-init is its own future phase

**Why this is the close phase of v1.5:**
v1.5 spans 8 phases (32–38) and 47 plans across phases 32–37 plus Phase 38's own ~4 plans, ships intelligence improvements across context management, agentic loop, resilience+sessions, auto-decomposition, context intelligence, and intelligence eval. None of those individual phases produces a single artifact answering "what shipped in v1.5?" — that's Phase 38's job. The Milestone Audit is the falsifiable close: requirements 3-source cross-referenced, every REQ-ID traced from ROADMAP → Phase SUMMARYs → REQUIREMENTS.md, gaps and tech debt explicitly enumerated. The CHANGELOG entry is the user-facing close: per-phase feature list, verify gate evolution, dual-mode eval explanation. The README updates surface the intelligence-layer narrative to first-time visitors so the cognitive-architecture story extends with the agentic-intelligence story. The phase archive completes the close: `.planning/phases/` returns to a clean state ready for v1.6 phase-init at Phase 39+. Without Phase 38, the v1.5 milestone exists as 47 commits with no narrative; with it, v1.5 closes as a coherent shippable unit. The `tech_debt` status is the honest call — operator-deferred UAT means the milestone is code-complete but not fully verified at the human-runtime boundary, and the v1.4 carry-forward gate failures mean the formal `verify:all all exit 0` close criterion can't be claimed until v1.6 cleanup. v1.1 (April 2026) and v1.2 (April 2026) both shipped `tech_debt` with similar carry-forward UAT; v1.5 follows the same precedent without apology.

</domain>

<decisions>
## Implementation Decisions

### Milestone Status: `tech_debt` (not `complete`)

- **Locked: v1.5 closes with `status: tech_debt` in MILESTONE-AUDIT.md frontmatter.** This is the honest call. Phases 32–37 each ship at `checkpoint:human-verify` boundary with operator-deferred runtime UAT (per memory `feedback_deferred_uat_pattern.md`); the milestone is NOT fully verified at the human-runtime boundary. Additionally, the pre-existing OEVAL-01c v1.4 organism-eval drift in `verify:eval` / `verify:hybrid_search` gates remains failing, documented out-of-scope per Phase 32–37 close boundaries. The formal `verify:all all exit 0` Close success criterion (ROADMAP line 224) cannot be cleanly claimed.
- **Locked: v1.5 is the third `tech_debt` close in BLADE history.** v1.1 (Phase 15) and v1.2 (Phase 20) both shipped `tech_debt` with documented carry-forward UAT. v1.3 and v1.4 shipped `complete`. v1.5 ships `tech_debt` honestly — no hand-waving the OEVAL-01c drift, no premature operator-UAT bypass.
- **Locked: The MILESTONE-AUDIT explicit `gaps` and `tech_debt` arrays enumerate the carry-forward items.** Two categories:
  ```yaml
  gaps:
    - "Operator-deferred runtime UAT for Phases 32-37 (6 phases at checkpoint:human-verify)"
  tech_debt:
    - "OEVAL-01c v1.4 organism eval drift — verify:eval + verify:hybrid_search failing; carry-forward to v1.6+ per Phase 32-37 SCOPE BOUNDARY"
    - "eval-runs/v1.5-baseline.json operator-deferred — bin target intelligence-benchmark structural skeleton; full run_loop wiring against real providers is operator's separate task per Phase 37-08 SUMMARY"
  ```
- **Locked: The `tech_debt` status does NOT block v1.6 planning.** v1.6 milestone-init (Phase 39+) can begin at any time. Tech debt is tracked in the audit's `tech_debt` array and can be addressed in v1.6 as cleanup phases — same pattern v1.3 used to close v1.2's carry-forward.
- **Claude's discretion:** Whether to flip status to `complete` if the operator runs the runtime UAT + commits the baseline + repairs OEVAL-01c BEFORE Phase 38 commits. Recommend NO — Phase 38 is documentation work; coupling its status to operator-runtime work invites partial-write states. Operator can amend MILESTONE-AUDIT post-Phase-38 if they want to flip status after UAT.

### Plan Shape (4 Plans, No Waves)

- **Locked: Phase 38 spans 4 plans, all sequential, no waves.** Documentation work doesn't benefit from wave parallelism — each plan touches distinct files and lands serially. Plans:
  - **38-01** — README update: extend Cognitive Architecture section with new `## Intelligence Layer (v1.5)` subsection, add v1.5 research citations to Research Foundations section (arxiv 2604.14228, Aider, OpenHands, Goose, mini-SWE-agent), update Roadmap section to mark v1.5 shipped + v1.6 next. ~120 lines diff.
  - **38-02** — CHANGELOG v1.5 entry: insert `## [1.5.0]` section between `## [Unreleased]` and `## [1.4.0]`, mirror the v1.4 entry shape (per-phase feature breakdown, verify gate count line, static gates summary, deferred-UAT note). ~80 lines diff.
  - **38-03** — `.planning/milestones/v1.5-MILESTONE-AUDIT.md` authoring: mirror v1.4-MILESTONE-AUDIT.md structure verbatim (frontmatter + Executive Verdict + Phase Coverage table + Requirements Coverage 3-source cross-reference + Static Gates + Sign-off). 38 v1.5 requirements + 4 close requirements = 42 total tracked. ~140 lines diff.
  - **38-04** — Phase archive + final close-out commit: move `.planning/phases/32-context-management` through `.planning/phases/38-close` to `.planning/milestones/v1.5-phases/` (use `git mv` for each). Also move `.planning/REQUIREMENTS.md` snapshot to `.planning/milestones/v1.5-REQUIREMENTS.md` and `.planning/ROADMAP.md` snapshot to `.planning/milestones/v1.5-ROADMAP.md` per the v1.4 archive pattern. STATE.md gets a final `last_activity: 2026-05-08` + completed_phases bump from 0 to 1 (Phase 38 itself closes; Phases 32–37 stay code-complete-UAT-pending). ~30 lines diff plus the file moves.
- **Locked: 38-04 has NO checkpoint:human-verify task.** Phase 38 is documentary; no runtime UI surface; no checkpoint:human-verify needed. The phase closes formally at the 38-04 commit. Mirrors the Phase 31 v1.4-close pattern. The resume directive's "stop at checkpoint:human-verify" boundary doesn't apply to a docs-only phase.
- **Locked: All 4 plans are foreground-stop boundaries.** After 38-04 commits, the milestone is closed. The orchestrator can stop or proceed to v1.6 init at operator discretion. Per the resume directive's stop-at-checkpoint clause and the autonomy directive, Phase 38 closes fully autonomous.
- **Claude's discretion:** Whether to bundle 38-01 + 38-02 into one plan (both edit top-level user-facing docs). Recommend KEEP SEPARATE — README and CHANGELOG have different review surfaces (one is marketing, one is technical changelog), and separate commits make the diff easier for the operator to review. Plus, Phase 31's v1.4 close used separate README + CHANGELOG plans per the precedent — match the established convention.

### README Update Scope (Plan 38-01)

- **Locked: Add new section `## Intelligence Layer (v1.5)` immediately AFTER the existing `## Cognitive Architecture` section** (line 87 of current README, between "Vitality" bullet and "---" separator at line 87). Mirrors the Cognitive Architecture section's bullet-list style. 6 bullets covering the v1.5 surfaces:
  - **Selective Context Injection** — Phase 32 CTX-01..07: brain.rs gates every section by query relevance; "what time is it?" doesn't see OCR + repo map + hormones; condenser fires at 80% capacity; tool outputs cap at 4k tokens; per-section breakdown visible in DoctorPane.
  - **Agentic Loop with Verification** — Phase 33 LOOP-01..06: mid-loop verifier every 3 tool calls; structured ToolError feedback; plan adaptation on failure; truncation auto-retry; ego intercept on the fast-streaming path; configurable iteration cap (default 25).
  - **Stuck Detection + Session Persistence** — Phase 34 RES-01..05 + SESS-01..04: 5-pattern stuck detection; circuit breaker on N consecutive same-type failures; per-conversation cost guard with 80%/100% tiers; provider fallback chain with exponential backoff; append-only JSONL session log; reopen-and-resume + branch-from-any-point.
  - **Auto-Decomposition** — Phase 35 DECOMP-01..05: brain planner detects 5+ independent steps + auto-fans into parallel sub-agents; isolated sub-agent contexts; summary-only return to parent; conversation forking; sub-agent progress streams into chat.
  - **Context Intelligence** — Phase 36 INTEL-01..06: tree-sitter parses TS/JS/Rust/Python into a symbol graph; personalized PageRank scores symbols by recent mentions; budget-bounded repo map injects at the code section gate; canonical_models.json capability registry replaces per-call probes; @screen / @file: / @memory: anchor syntax bypasses gating with explicit user asks.
  - **Intelligence Eval** — Phase 37 EVAL-01..05: 26 deterministic fixtures across multi-step task completion (10), context efficiency (3), stuck detection (5+5), compaction fidelity (3); verify:intelligence joins verify:all as the 38th gate; opt-in operator-runnable real-LLM benchmark via `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`.
- **Locked: Add `## Research Foundations (v1.5)` subsection after the existing v1.4 Research Foundations bullet list** (line 383 of current README). 5 new bullets, formatted identically:
  - Anthropic. (2025). *Claude Code: A Production Coding Agent*. arxiv:2604.14228 — selective context injection, agentic loop, tree-sitter context awareness.
  - Gauthier, P. (2023). *Aider's Repository Map*. https://aider.chat/2023/10/22/repomap.html — symbol graph + personalized PageRank pattern.
  - All-Hands AI. (2025). *OpenHands Condenser Pattern*. PR #7610 (csmith49) — keep-edges-summarize-middle compaction prompt.
  - Block, Inc. (2025). *Goose Capability Registry*. — per-model capability descriptors as the v1.5 canonical_models.json schema basis.
  - Yang, K., Liu, X., Chen, Y., et al. (2025). *Mini-SWE-Agent: Repurposing SWE-Bench for Agent Loop Verification*. — minimal scaffold pattern for the agentic-loop verification probe.
- **Locked: Roadmap section update** (line 336+): replace "v1.5 — Intelligence Layer (active)" with "v1.5 — Intelligence Layer (shipped 2026-05-08; tech_debt — operator UAT pending)"; add new "v1.6 — TBD" line below.
- **Locked: NO marketing tone changes.** Match the existing Cognitive Architecture section's voice — declarative, specific, technical. Don't re-write prior v1.0–v1.4 bullets; v1.5 narrative extends but doesn't rewrite.
- **Claude's discretion:** Whether to add a "## What's New in v1.5" callout at the top of the README. Recommend NO — the README is evergreen documentation; version-specific callouts go in CHANGELOG. The Roadmap section update is the right surface for "v1.5 shipped" signaling.

### CHANGELOG Entry Scope (Plan 38-02)

- **Locked: Insert `## [1.5.0] — 2026-05-08` between `## [Unreleased]` (line 10) and `## [1.4.0]` (line 16).** Match the v1.4 entry shape verbatim — `### Added (v1.5 — Intelligence Layer)` heading, brief milestone summary line citing static gates posture, then per-phase bullet groups (Phase 32 through Phase 38). Each phase block: bold title with shipped date, 4-7 bullets covering key requirements + their satisfaction count.
- **Locked: Static gates line in the entry header.** "Static gates: `cargo check` clean · `npx tsc --noEmit` clean · `npm run verify:all` 36/38 sub-gates green (verify:intelligence + 35 prior; OEVAL-01c v1.4 carry-forward in verify:eval + verify:hybrid_search documented out-of-scope per Phase 32–37 SCOPE BOUNDARY)."
- **Locked: Per-phase bullet structure** (mirrors v1.4 Phase 25 entry shape):
  ```
  **Phase 32 — Context Management** *(code-complete 2026-05-05; UAT pending)*
  - `brain.rs` selective injection gating sections 0-8 by query relevance; LAST_BREAKDOWN per-section accumulator visible in DoctorPane.
  - OpenHands v7610 structured compaction summary prompt; token-aware keep_recent; ~80% capacity trigger.
  - cap_tool_output helper caps individual tool results at ~4k tokens with summary.
  - DoctorPane breakdown panel shows per-section token breakdown.
  - CTX-07 fallback guarantee: any injection failure degrades to naive path.
  - 7/7 CTX-XX requirements satisfied. checkpoint:human-verify open.
  ```
  Repeat for Phases 32–37 + a closing Phase 38 block (this audit + close artifacts).
- **Locked: Verify-Gate Evolution table update** at the bottom of CHANGELOG.md (line 296+): add row for Phases 32–37 (v1.5): `| Phases 32-37 (v1.5) | 1 (intelligence) | **38** |`. Keep the prior v1.0..v1.4 rows unchanged.
- **Locked: NO version bump.** `package.json` / `Cargo.toml` / `tauri.conf.json` stay at their current 0.7.x V1-candidate version per CHANGELOG.md D-227. Operator bumps after V1 cutover decision; Phase 38 does NOT touch version strings. The CHANGELOG `[1.5.0]` heading is the milestone marker; the binary version is unrelated.
- **Locked: NO `### Removed` / `### Deprecated` / `### Fixed` sections** in the v1.5 CHANGELOG entry. v1.5 is purely additive — no production code removed, no API deprecated, no bugfixes outside Phase 36's REVIEW-FIX commits (which are tracked in their phase artifacts, not at the milestone level).
- **Claude's discretion:** Whether to include the dual-mode eval explanation as a callout in the CHANGELOG entry. Recommend YES — surfaces the design choice (deterministic CI lane + opt-in operator real-LLM lane) for technical readers. Add as a 2-3 line note immediately after the static gates line.

### Milestone Audit Scope (Plan 38-03)

- **Locked: New file `.planning/milestones/v1.5-MILESTONE-AUDIT.md`** mirrors `.planning/milestones/v1.4-MILESTONE-AUDIT.md` structure verbatim — same frontmatter shape, same section ordering (Executive Verdict, Phase Coverage, Requirements Coverage, Static Gates, Sign-off), same length range (~85-100 lines).
- **Locked: Frontmatter shape:**
  ```yaml
  ---
  milestone: v1.5
  milestone_name: Intelligence Layer
  audited: 2026-05-08T00:00:00Z
  status: tech_debt
  scores:
    requirements: 42/42 (mapped); 38/42 (verified in-phase); 4/42 (close phase -- this audit)
    phases: 7/7 routed (32-37 code-complete + 38 close)
    integration: verified-static (cross-phase wiring traced via SUMMARY chains; runtime UAT operator-deferred)
    flows: eval-verified (26 intelligence eval rows, MRR=1.000)
  gaps:
    - "Operator-deferred runtime UAT for Phases 32-37 (6 phases at checkpoint:human-verify)"
  tech_debt:
    - "OEVAL-01c v1.4 organism eval drift -- verify:eval + verify:hybrid_search failing; carry-forward to v1.6+ per Phase 32-37 SCOPE BOUNDARY"
    - "eval-runs/v1.5-baseline.json operator-deferred -- bin target intelligence-benchmark structural skeleton; full run_loop wiring against real providers is operator's separate task per Phase 37-08"
  nyquist:
    compliant_phases: 6
    partial_phases: 0
    missing_phases: 1
    overall: All v1.5 feature phases (32-37) have SUMMARY chains documenting code-complete posture; Phase 38 is docs-only
  ---
  ```
- **Locked: Executive Verdict** — 2-3 paragraphs covering: (1) what v1.5 transformed BLADE into (from naive 12-iteration loop to verified, stuck-aware, decomposable, context-intelligent agent), (2) the dual-mode eval lane and what it proves (deterministic CI lane proves loop shape correctness; operator-runnable lane is required for "measurable improvement" claim), (3) the `tech_debt` honesty — what's deferred and why.
- **Locked: Phase Coverage table** — 7 rows (Phase 32 through 38) matching v1.4-MILESTONE-AUDIT lines 42-50 shape. Each row: Phase | Plans | SUMMARY chain | Status | Score (with REQ-ID coverage citation).
- **Locked: Requirements Coverage 3-source cross-reference** — 8 categories (CTX, LOOP, RES, SESS, DECOMP, INTEL, EVAL, CLOSE). Each row: Category | Count | Phase | ROADMAP | SUMMARYs | REQUIREMENTS.md | Final. Final column reads "satisfied (UAT pending)" for the 6 deferred phases, "satisfied" for INTEL (eval-only) + EVAL + CLOSE. Total: 38 v1.5 requirements + 4 close requirements = 42 routed.
- **Locked: Static Gates table** — 4 rows mirroring v1.4 table shape:
  - `cargo check`: ✅ exit 0 (pre-existing warnings)
  - `npx tsc --noEmit`: ✅ exit 0
  - `npm run verify:all`: ⚠️ 36/38 (verify:intelligence + 35 prior; OEVAL-01c v1.4 drift documented out-of-scope)
  - Intelligence eval (26 rows): ✅ 26/26 MODULE_FLOOR=1.0
- **Locked: Sign-off** — 1 paragraph honest close. Cite the `tech_debt` status, the operator next-steps (run UAT for Phases 32-37, run benchmark, optionally repair OEVAL-01c v1.4), and the v1.6 next-milestone signal.
- **Locked: NO orphans assertion.** Per v1.4 audit: every REQ-ID claimed by exactly one phase. Phase 38's audit explicitly verifies no v1.5 REQ-ID is unclaimed (the audit doc cross-references SUMMARY chains; if a SUMMARY claims coverage that ROADMAP didn't grant, flag in `gaps`).
- **Claude's discretion:** Whether to add a "Research Foundations" subsection inside the audit citing the 5 v1.5 sources. Recommend NO — that lives in README per Plan 38-01; duplicating in audit adds maintenance burden. The audit's Executive Verdict can mention "research-grounded port from arxiv 2604.14228 + Aider + OpenHands + Goose + mini-SWE-agent" as a single sentence without re-citing.

### Phase Archive Scope (Plan 38-04)

- **Locked: Move 7 phase directories** via `git mv`:
  - `.planning/phases/32-context-management` → `.planning/milestones/v1.5-phases/32-context-management`
  - `.planning/phases/33-agentic-loop` → `.planning/milestones/v1.5-phases/33-agentic-loop`
  - `.planning/phases/34-resilience-session` → `.planning/milestones/v1.5-phases/34-resilience-session`
  - `.planning/phases/35-auto-decomposition` → `.planning/milestones/v1.5-phases/35-auto-decomposition`
  - `.planning/phases/36-context-intelligence` → `.planning/milestones/v1.5-phases/36-context-intelligence`
  - `.planning/phases/37-intelligence-eval` → `.planning/milestones/v1.5-phases/37-intelligence-eval`
  - `.planning/phases/38-close` → `.planning/milestones/v1.5-phases/38-close`
- **Locked: Snapshot REQUIREMENTS.md and ROADMAP.md.** Per v1.4-archive pattern (see `.planning/milestones/v1.4-REQUIREMENTS.md` and `v1.4-ROADMAP.md`):
  - `cp .planning/REQUIREMENTS.md .planning/milestones/v1.5-REQUIREMENTS.md`
  - `cp .planning/ROADMAP.md .planning/milestones/v1.5-ROADMAP.md`
  - The active `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` stay in-place for v1.6 work; the snapshots preserve the v1.5 state at close.
- **Locked: Update `.planning/STATE.md`** for the formal close:
  - `last_updated`: 2026-05-08
  - `last_activity`: 2026-05-08 — Phase 38 close-out shipped: README + CHANGELOG + MILESTONE-AUDIT + phase archive
  - `completed_phases`: 0 → 1 (Phase 38 itself; Phases 32–37 stay code-complete-UAT-pending so completed_phases counts the docs-only close phase)
  - `total_plans`: 55 → 59 (add Phase 38's 4 plans)
  - `completed_plans`: 55 → 59
  - `percent`: 81 → 84 (round)
  - `status`: `active` → `complete` (the milestone close phase shipped; tech_debt items live in MILESTONE-AUDIT)
  - Update "Current Focus" line to cite Phase 38 just shipped + v1.6 next
  - Update progress bar: `[████████░░] 84% (59/59 plans complete; 1/7 phases formally closed -- Phase 38)`
  - Update phase tracker block: `38 [x] Close (shipped 2026-05-08; tech_debt)`
- **Locked: STATE.md `status: complete` is the close signal even though `tech_debt` exists.** v1.4 used `status: complete` because no carry-forward; v1.1 + v1.2 used `status: complete` despite tech_debt (the `status` field marks "milestone closed", the audit's `tech_debt` array marks "carry-forward exists"). The two are independent state machines per the v1.1/v1.2/v1.4 precedent. Verify by reading those audits before authoring 38-03.
- **Locked: NO touching of `.planning/phases/00-31-*` directories** (188 pre-existing staged deletions). Those are prior-milestone archive moves; Phase 38 must not interfere. `git status --short | grep "^A "` should show ONLY Phase 38's added/moved files; `git add` must use SPECIFIC paths.
- **Locked: Final commit shape:** Single `feat(38): v1.5 milestone close - README + CHANGELOG + audit + phase archive` commit covering all 4 plans' artifacts. Per v1.4-close precedent (Phase 31 closed in a single milestone close commit). Each individual plan still gets its own intermediate commit during execution; the final 38-04 commit is a clean "milestone shipped" marker.
- **Locked: `cargo check` + `npx tsc --noEmit` + `bash scripts/verify-intelligence.sh` must remain green at the close.** No regressions allowed during Phase 38 (it's docs-only, so this is a sanity check). The 35/37 verify:all carry-forward is the documented exception.
- **Claude's discretion:** Whether to delete or rename the Phase 38 CONTEXT.md after archiving (it's now in `.planning/milestones/v1.5-phases/38-close/38-CONTEXT.md`). Recommend KEEP IN ARCHIVE unchanged — future audits may reference it. v1.4 archive preserves all phase artifacts including CONTEXTs.

### Backward Compatibility (None — Docs Only)

- **Locked: No code changes, no kill switches, no escape hatches.** Phase 38 ships zero production functionality.
- **Locked: No verify gate added.** verify:intelligence already shipped in Phase 37-07. Verify chain stays at 38 entries.
- **Locked: No new Tauri commands, no migrations, no schema changes.** Documentary close only.
- **Claude's discretion:** None — the phase is mechanical close-out work.

### Testing & Verification

- **Locked: NO new automated tests.** Phase 38 is documentation; tests don't apply.
- **Locked: Sanity-check static gates after each plan commits:**
  - 38-01 + 38-02: `cargo check` (no Rust touched, but confirm no spurious diffs); `npx tsc --noEmit`; `bash scripts/verify-intelligence.sh` (verifies prior phases' work intact)
  - 38-03: re-read the audit and grep for missing REQ-IDs to confirm 42/42 coverage
  - 38-04: post-`git mv`, `find .planning/phases/ -maxdepth 1 -type d` should return only `00-09 + 10-15 + 16-20 + 21-24 + 25-31 + 39-onward(if any)` directories. v1.5 phases moved out. Verify no orphan files left in `.planning/phases/3[2-8]-*/`.
- **Locked: Smoke-check the README, CHANGELOG, and audit render via your Read tool after authoring** — confirm formatting, no broken markdown, no truncated sections. The user reads these directly.
- **Locked: NO runtime UAT.** No UI changes. No screenshots required. The CLAUDE.md verification protocol (dev-server + screenshot + cross-viewport) explicitly applies to runtime/UI changes — Phase 38 is exempt.
- **Locked: tsc --noEmit + cargo check must remain clean.** Pre-existing OEVAL-01c carry-forward boundary holds.
- **Claude's discretion:** Whether to run `npm run verify:all` end-to-end at the 38-04 close. Recommend NO — the verify chain takes ~5 minutes + has documented carry-forward failures that aren't part of Phase 38 scope. Spot-check via `npm run verify:intelligence` (the gate added by v1.5) to confirm the milestone's eval surface is green.

### Claude's Discretion (catch-all)

- Whether to embed the v1.5 dual-mode eval ASCII diagram in CHANGELOG. Recommend NO — text bullets convey the design adequately; ASCII diagrams age poorly.
- Whether to include a "What's Next in v1.6" forward-looking section in the audit. Recommend NO — audits are retrospective, not roadmap. v1.6 belongs in a separate `.planning/REQUIREMENTS.md` rev when v1.6 starts.
- Whether to date the phase archive directory or use the same `v1.5-phases/` convention as prior milestones. Recommend MATCH PRIOR CONVENTION (`v1.5-phases/`) — version-tagged is sufficient; the audit timestamp is the authoritative date marker.
- Whether to commit the OEVAL-01c repair as part of v1.5 close. Recommend NO — out-of-scope per the Phase 32-37 SCOPE BOUNDARY documented in every phase close-out. Carry-forward to v1.6.
- Whether to write a v1.6 milestone-init artifact in Phase 38. Recommend NO — Phase 38 closes v1.5 cleanly; v1.6 starts with its own `/gsd-new-milestone` invocation when operator decides.
- Whether to update `.planning/PROJECT.md` to note v1.5 shipped. Recommend YES if the file has a "current focus" line — Phase 31 v1.4 close updated PROJECT.md; mirror that pattern. Verify the file's structure when planning 38-04.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source of Truth (project)
- `/home/arnav/blade/.planning/ROADMAP.md` — Phase 38 row (lines 215-225) + 4 success criteria
- `/home/arnav/blade/.planning/REQUIREMENTS.md` — full 38 v1.5 requirements list + traceability table (lines 106-150)
- `/home/arnav/blade/.planning/STATE.md` — current state (last_updated 2026-05-08; Phases 32-37 code-complete + UAT-pending; total_plans 55)
- `/home/arnav/blade/.planning/PROJECT.md` — current focus line (verify when planning 38-04)
- `/home/arnav/blade/CLAUDE.md` — BLADE-specific rules (verification protocol exempt for docs-only phases)

### v1.4 Close Template (read in full before planning each plan)
- `/home/arnav/blade/.planning/milestones/v1.4-MILESTONE-AUDIT.md` — 89-line structural template for v1.5 audit. Frontmatter shape, Executive Verdict tone, Phase Coverage table format, Requirements Coverage 3-source cross-reference, Static Gates table, Sign-off voice.
- `/home/arnav/blade/.planning/milestones/v1.4-REQUIREMENTS.md` — REQUIREMENTS snapshot pattern (verify how the snapshot was derived from the live REQUIREMENTS.md at v1.4 close)
- `/home/arnav/blade/.planning/milestones/v1.4-ROADMAP.md` — ROADMAP snapshot pattern
- `/home/arnav/blade/.planning/milestones/v1.4-phases/` — directory structure (Phase 25 through Phase 30; Phase 31 may or may not have its own subdir — verify); the v1.5 archive mirrors this layout

### v1.1 + v1.2 `tech_debt` Close Precedents
- `/home/arnav/blade/.planning/milestones/v1.1-MILESTONE-AUDIT.md` — `status: tech_debt` close pattern; what tech_debt arrays look like
- `/home/arnav/blade/.planning/milestones/v1.2-MILESTONE-AUDIT.md` — second `tech_debt` close; same pattern

### CHANGELOG Template
- `/home/arnav/blade/CHANGELOG.md` lines 16-75 — v1.4 entry verbatim. Per-phase bullet structure, requirements satisfaction count format, static gates summary line, verify gate evolution table at bottom.

### README Template
- `/home/arnav/blade/README.md` lines 77-87 — Cognitive Architecture section bullet style. Plan 38-01's new "Intelligence Layer (v1.5)" subsection mirrors this voice + structure.
- `/home/arnav/blade/README.md` lines 373-383 — Research Foundations section bullet style. Plan 38-01's v1.5 citations append in identical format.
- `/home/arnav/blade/README.md` lines 336-372 — Roadmap section. Plan 38-01 updates the v1.5 line.

### Phase 32-37 Close Artifacts (read for milestone audit traceability)
- `/home/arnav/blade/.planning/phases/32-context-management/32-CONTEXT.md` + `32-NN-SUMMARY.md` files — CTX-01..07 satisfaction claims
- `/home/arnav/blade/.planning/phases/33-agentic-loop/` — LOOP-01..06 SUMMARY chain
- `/home/arnav/blade/.planning/phases/34-resilience-session/` — RES-01..05 + SESS-01..04 SUMMARY chain
- `/home/arnav/blade/.planning/phases/35-auto-decomposition/` — DECOMP-01..05 SUMMARY chain
- `/home/arnav/blade/.planning/phases/36-context-intelligence/` — INTEL-01..06 SUMMARY chain + REVIEW + REVIEW-FIX
- `/home/arnav/blade/.planning/phases/37-intelligence-eval/` — EVAL-01..05 SUMMARY chain (8 plans + 8 SUMMARYs + deferred-items.md)

### Operational
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/MEMORY.md` — `feedback_deferred_uat_pattern.md` applies (Phase 32-37 deferred-UAT documented in audit's gaps array); `project_v11_close_failed_uat.md` informs the honesty bias toward `tech_debt` over `complete`
- 188 pre-existing staged deletions in `.planning/phases/00-31-*/` — `git add` SPECIFIC paths only
- The OEVAL-01c v1.4 organism-eval drift in verify:eval + verify:hybrid_search — out-of-scope for v1.5; carry-forward to v1.6+

</canonical_refs>

<specifics>
## Specific Ideas

**Concrete Plan 38-01 README diff shape:**

After line 86 (the "Vitality" bullet) and before line 87 (`---` separator), insert:
```markdown

---

## Intelligence Layer (v1.5)

v1.5 transforms the agentic loop. BLADE no longer runs a naive 12-iteration for-loop with everything injected every turn — the loop verifies its own progress, recovers from structured errors, detects when it's stuck, fans out to parallel sub-agents on big tasks, and injects only the context each query actually needs.

- **Selective Context Injection** — `brain.rs` gates every section by query relevance. "What time is it?" doesn't see your screen OCR + repo map + hormone state. The condenser fires proactively at 80% capacity using OpenHands' v7610 structured summary prompt. Tool outputs cap at ~4k tokens with a one-line summary. Per-section breakdown surfaces in DoctorPane.
- **Verified Agentic Loop** — Mid-loop verifier runs every 3 tool calls; if the goal isn't being served, the loop replans. Tool failures return a structured `ToolError` with what was tried, why it failed, and a suggested alternative. Truncated responses auto-retry with a higher `max_tokens` value. The fast-streaming path runs the ego intercept (closes the Phase 18 known gap). Iteration cap configurable, default 25.
- **Stuck Detection + Session Persistence** — 5-pattern stuck detection (RepeatedActionObservation, ContextWindowThrashing, NoProgress, MonologueSpiral, CostRunaway). Circuit breaker fires after N consecutive same-type failures. Per-conversation cost guard with 80%/100% tiers. Provider fallback chain with exponential backoff. Every conversation persists to an append-only JSONL log; sessions reopen from the last compaction boundary, branch from any point, list with one-line preview.
- **Auto-Decomposition** — When the brain planner detects 5+ independent steps, BLADE fans out to parallel sub-agents automatically. Each sub-agent runs in an isolated context window — one sub-agent's 50k-token bash output doesn't bloat the parent. Only summaries return. Sub-agent progress streams into the chat with explicit checkpoints.
- **Context Intelligence** — `tree-sitter` parses TypeScript/JavaScript, Rust, and Python source into a symbol-level dependency graph (calls, imports, type usage). Personalized PageRank scores symbols by what the current chat actually mentions. A budget-bounded repo map (~1k tokens default) injects at the code-section gate. `canonical_models.json` formalizes per-model capabilities (context length, tool_use, vision, cost) — `router.rs` reads from it instead of per-call probes. Type `@screen` to inject the current OCR; `@file:src/main.rs` to inject a file's content; `@memory:project-deadline` to inject matching memory entries — each anchor renders as a chip in the chat.
- **Intelligence Eval** — 26 deterministic fixtures across 4 surfaces (10 multi-step task completion + 3 context efficiency + 5 stuck + 5 healthy controls + 3 compaction fidelity). `verify:intelligence` gate joins `verify:all` as the 38th. An opt-in operator-runnable mode (`BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`) runs the same 10 fixtures against real LLMs to populate `eval-runs/v1.5-baseline.json` for regression detection.

---
```

**Concrete Plan 38-02 CHANGELOG entry shape:**

Insert between line 14 (the line after "Nothing yet.") and line 16 (`## [1.4.0]`):
```markdown
## [1.5.0] -- 2026-05-08

### Added (v1.5 -- Intelligence Layer)

> Code-complete 2026-05-08 across phases 32-38 (6 feature phases + 1 close phase). Static gates: `cargo check` clean . `npx tsc --noEmit` clean . `npm run verify:all` 36/38 sub-gates green (verify:intelligence + 35 prior; OEVAL-01c v1.4 carry-forward in verify:eval + verify:hybrid_search documented out-of-scope per Phase 32-37 SCOPE BOUNDARY). Phases 32-37 ship at the `checkpoint:human-verify` boundary with operator-deferred runtime UAT.
>
> v1.5's eval is dual-mode: a deterministic CI lane runs 26 fixtures with no LLM calls (verify:intelligence is the 38th gate); an opt-in operator-runnable lane (`BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh`) runs 10 multi-step fixtures against real LLMs to populate `eval-runs/v1.5-baseline.json` for regression-only checks.

**Phase 32 -- Context Management** *(code-complete 2026-05-05; UAT pending)*
- `brain.rs` selective injection gating sections 0-8 by query relevance; LAST_BREAKDOWN per-section accumulator surfaces in DoctorPane.
- Proactive compaction at ~80% capacity using OpenHands v7610 structured summary prompt; token-aware keep_recent.
- `cap_tool_output` helper caps individual tool results at ~4k tokens with summary suffix.
- `ContextBreakdown` wire type + `get_context_breakdown` Tauri command + DoctorPane breakdown panel.
- CTX-07 fallback guarantee: any selective-injection / compaction failure degrades to the naive path.
- 7/7 CTX-XX requirements satisfied. checkpoint:human-verify open.

[... 5 more phase blocks ...]

**Phase 38 -- Close** *(shipped 2026-05-08; tech_debt)*
- README extends Cognitive Architecture section with Intelligence Layer narrative; Research Foundations cites Claude Code (arxiv 2604.14228), Aider, OpenHands, Goose, mini-SWE-agent.
- This CHANGELOG entry.
- `.planning/milestones/v1.5-MILESTONE-AUDIT.md` written; v1.5 status: tech_debt; 42/42 requirements routed; 36/38 verify gates green.
- Phase 32-38 directories archived to `.planning/milestones/v1.5-phases/`.
- 4/4 CLOSE requirements satisfied.

---

## [1.4.0] -- 2026-05-03
[... existing v1.4 entry ...]
```

**Concrete Plan 38-03 milestone audit:**

Verbatim port of `.planning/milestones/v1.4-MILESTONE-AUDIT.md` shape with v1.5 content. ~95 lines.

**Concrete Plan 38-04 git commands sequence:**
```bash
# Phase directory archive (run at repo root)
mkdir -p .planning/milestones/v1.5-phases
git mv .planning/phases/32-context-management .planning/milestones/v1.5-phases/
git mv .planning/phases/33-agentic-loop .planning/milestones/v1.5-phases/
git mv .planning/phases/34-resilience-session .planning/milestones/v1.5-phases/
git mv .planning/phases/35-auto-decomposition .planning/milestones/v1.5-phases/
git mv .planning/phases/36-context-intelligence .planning/milestones/v1.5-phases/
git mv .planning/phases/37-intelligence-eval .planning/milestones/v1.5-phases/
git mv .planning/phases/38-close .planning/milestones/v1.5-phases/

# REQUIREMENTS + ROADMAP snapshots
cp .planning/REQUIREMENTS.md .planning/milestones/v1.5-REQUIREMENTS.md
cp .planning/ROADMAP.md .planning/milestones/v1.5-ROADMAP.md

# STATE update via Edit tool (specific lines)
# - last_updated: 2026-05-08
# - completed_phases: 0 -> 1
# - status: active -> complete (the docs-only close phase)
# - Phase 38 row: 38 [x] Close (shipped 2026-05-08; tech_debt)

# Stage SPECIFIC paths
git add .planning/milestones/v1.5-phases .planning/milestones/v1.5-REQUIREMENTS.md .planning/milestones/v1.5-ROADMAP.md .planning/milestones/v1.5-MILESTONE-AUDIT.md .planning/STATE.md .planning/PROJECT.md README.md CHANGELOG.md

# Final commit
git commit -m "feat(38): v1.5 milestone close - README + CHANGELOG + audit + phase archive"
```

**Anti-pattern to avoid (from existing CLAUDE.md):**
- Don't `git add -A` or `git add .` — 188 pre-existing staged deletions in `.planning/phases/00-31-*/`. Use SPECIFIC paths only.
- Don't add Co-Authored-By lines.
- Don't claim `complete` status when 6 phases have operator-deferred UAT — `tech_debt` is the honest close.
- Don't bump version strings in package.json / Cargo.toml / tauri.conf.json — operator concern per CHANGELOG D-227.
- Don't repair the OEVAL-01c v1.4 carry-forward in this phase — out-of-scope per the Phase 32-37 SCOPE BOUNDARY.
- Don't run real-LLM operations during Phase 38 — the operator runs `BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` separately.
- Don't write v1.6 milestone artifacts here — Phase 38 closes v1.5 only.

</specifics>

<deferred>
## Deferred Ideas

The following surfaced during context synthesis but are explicitly NOT in Phase 38 scope:

- **Operator runtime UAT for Phases 32-37** — operator-deferred per memory `feedback_deferred_uat_pattern.md`. Phase 38 documents the deferral in MILESTONE-AUDIT's `gaps` array. Operator next-step.
- **`BLADE_RUN_BENCHMARK=true bash scripts/run-intel-benchmark.sh` execution + `eval-runs/v1.5-baseline.json` commit** — operator-deferred per Phase 37-08 SUMMARY. Bin target ships as a structural skeleton; full run_loop wiring against real providers is the operator's separate task.
- **OEVAL-01c v1.4 organism-eval drift repair** — out-of-scope per Phase 32-37 SCOPE BOUNDARY. Carry-forward to v1.6+ as a cleanup phase.
- **Version bump** to `1.5.0` in `package.json` / `Cargo.toml` / `tauri.conf.json` — operator-controlled per CHANGELOG D-227. Phase 38 keeps version strings at current 0.7.x.
- **Git tag `v1.5.0`** — operator triggers after V1 cutover decision.
- **GitHub release pipeline** — operator concern; not in BLADE's monorepo scope.
- **v1.6 milestone-init** — separate `/gsd-new-milestone` invocation when operator decides v1.6 scope.
- **Live A/B routing eval** — Phase 37 deferred; v1.6+.
- **Multi-session aggregate eval** — Phase 37 deferred; v1.6+ when SessionWriter logs accumulate.
- **Real-token-usage trend dashboard** — Phase 37 deferred; v1.6+.
- **Live file-watcher symbol graph updates** — Phase 36 deferred; v1.6+.
- **Cross-repo symbol graph** — Phase 36 deferred; v1.6+.
- **LSP integration for richer symbol info** — Phase 36 deferred; v1.6+.
- **Anchor autocomplete UI** — Phase 36 deferred; v1.6+.
- **Sub-agent provider selection consults registry** — Phase 36 deferred; v1.6+ harmonization.
- **Vision-not-on-active-model mid-stream re-route** — Phase 36 deferred; v1.6+.
- **Symbol-graph-aware decomposition** — Phase 35 + 36 deferred; v1.6+.
- **Phase 19 UAT close (23 items)** — pre-v1.5 deferred per chat-first pivot; out of v1.5 scope.
- **Voice resurrection (JARVIS-01/02)** — pre-v1.5 deferred per REQUIREMENTS.md "Future Requirements"; v1.6+.
- **Organism UI surfacing (OSRF-01..03)** — pre-v1.5 deferred; v1.6+.
- **Distribution work (DIST-01..03)** — pre-v1.5 deferred; v1.6+.

</deferred>

<wave-shape>
## Wave Shape (4 plans, no waves)

Phase 38 spans **4 plans, all sequential, no waves** — documentation work doesn't benefit from parallelism. Each plan touches distinct files and lands serially. Total ~370 lines of diff across 4 plans.

```
38-01: README update (Intelligence Layer section + research citations + roadmap)
   |
   v
38-02: CHANGELOG v1.5 entry
   |
   v
38-03: .planning/milestones/v1.5-MILESTONE-AUDIT.md authoring
   |
   v
38-04: Phase archive + STATE/PROJECT update + final close-out commit
```

**Plan summary:**
- **38-01** — README: insert `## Intelligence Layer (v1.5)` after Cognitive Architecture (line 87); append v1.5 entries to Research Foundations (line 383); update Roadmap section (line 336+) to mark v1.5 shipped + add v1.6 placeholder. ~120 lines diff. Single commit `feat(38-01): README updates for v1.5 Intelligence Layer`.
- **38-02** — CHANGELOG: insert `## [1.5.0] -- 2026-05-08` between `## [Unreleased]` and `## [1.4.0]`; add per-phase feature breakdown for Phases 32-38; update Verify-Gate Evolution table at bottom. ~80 lines diff. Single commit `feat(38-02): CHANGELOG v1.5 entry`.
- **38-03** — milestone audit: write `.planning/milestones/v1.5-MILESTONE-AUDIT.md` mirroring v1.4 shape verbatim. Frontmatter + Executive Verdict + Phase Coverage table + Requirements Coverage 3-source cross-reference + Static Gates + Sign-off. ~140 lines new file. Single commit `feat(38-03): v1.5 milestone audit (status: tech_debt)`.
- **38-04** — phase archive + final close-out: 7 `git mv` operations move Phase 32-38 directories to `.planning/milestones/v1.5-phases/`. Snapshot REQUIREMENTS.md + ROADMAP.md to `.planning/milestones/v1.5-REQUIREMENTS.md` + `v1.5-ROADMAP.md`. Update `.planning/STATE.md` (last_updated 2026-05-08, completed_phases 0→1, status active→complete, total_plans 55→59, percent 81→84, Phase 38 row [x]). Update `.planning/PROJECT.md` if it has a current-focus line citing v1.5. ~30 lines diff (most is the file moves). Single commit `feat(38): v1.5 milestone close - phase archive + STATE update`.

**Why no waves:** parallelism would mean two plans editing distinct files at the same time with no aggregator conflict. The 4 plans here CAN parallelize (38-01 README, 38-02 CHANGELOG, 38-03 audit are file-disjoint), but the cost of coordination exceeds the savings — each plan is small, the executor's read-time dominates, and operator review benefits from separate sequential commits. Sequential is also safer against the 188-pre-existing-deletions race.

**Total estimate:** ~370 lines across 4 plans. Smallest of the v1.5 phases by far. Plans 38-01..38-03 are ~30-60 minutes of executor time each; 38-04 is ~15-25 minutes (mostly mechanical `git mv`).

</wave-shape>

<requirements>
## Requirements Coverage

Phase 38 closes the v1.5 milestone. The 4 close-success criteria from ROADMAP map to plans:

| Success Criterion (ROADMAP lines 220-225) | Plans | Artifact |
|-------------------------------------------|-------|----------|
| "README architecture section cites Claude Code (arxiv 2604.14228), Aider repo map, OpenHands condenser, Goose capability registry, and mini-SWE-agent with accurate characterizations of what BLADE ported from each" | 38-01 | README §Intelligence Layer (v1.5) + §Research Foundations (v1.5) |
| "CHANGELOG v1.5 entry lists all delivered features and the verify gate count change (37 → 38)" | 38-02 | CHANGELOG `## [1.5.0]` entry + Verify-Gate Evolution table row |
| "`milestones/v1.5-MILESTONE-AUDIT.md` is written with phase coverage, requirements 3-source cross-reference, static gates, and executive verdict" | 38-03 | `.planning/milestones/v1.5-MILESTONE-AUDIT.md` (~95 lines) |
| "Phase 32–38 directories archived to `milestones/v1.5-phases/`; cargo check + tsc --noEmit + verify:all all exit 0" | 38-04 | 7 phase directory `git mv`s + REQUIREMENTS/ROADMAP snapshots + STATE.md update |

**Static-gates close criterion exception:** the `verify:all all exit 0` clause is the documented exception. v1.5 closes with 36/38 verify gates green (verify:intelligence + 35 prior; OEVAL-01c v1.4 carry-forward in verify:eval + verify:hybrid_search out-of-scope per Phase 32-37 SCOPE BOUNDARY). MILESTONE-AUDIT explicitly notes this in `tech_debt` array. v1.5 status: `tech_debt` (NOT `complete`).

**No standalone close-phase REQ-IDs.** Phase 38's 4 success criteria ARE the close requirements — no CLOSE-01..04 enum exists in REQUIREMENTS.md (the v1.4 audit cited CLOSE-01..04 but those are local to Phase 31's plan-level requirements, not REQUIREMENTS.md). Phase 38 follows the same convention.

**Total v1.5 requirements traced:** 38 (CTX-01..07 + LOOP-01..06 + RES-01..05 + SESS-01..04 + DECOMP-01..05 + INTEL-01..06 + EVAL-01..05) + 4 close = 42 total. The MILESTONE-AUDIT cross-references all 42 against ROADMAP, SUMMARYs, and REQUIREMENTS.md.

</requirements>

---

*Phase: 38-close*
*Context gathered: 2026-05-08 via direct synthesis from authority files (autonomous, no interactive discuss-phase per Arnav's instruction). All locked decisions traceable to ROADMAP.md / REQUIREMENTS.md / PROJECT.md / CLAUDE.md / Phase 32-37 SUMMARY chains / v1.4 close template (.planning/milestones/v1.4-MILESTONE-AUDIT.md, 89 lines) / v1.1 + v1.2 tech_debt close precedents / live README + CHANGELOG state.*
