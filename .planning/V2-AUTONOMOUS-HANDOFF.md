---
title: "v2.0 Autonomous Session — Handoff Prompt"
date: 2026-05-13
author: Claude (Opus 4.7, 1M context) — session ending
purpose: Single source of truth for the next session to run BLADE v2.0 autonomously without repeating today's mistakes.
---

# v2.0 Autonomous Session — Handoff

> Read top to bottom **before** running anything. The hooks already load `AGENT_OPERATING_MODE.md` + recent commits + decisions, but the v2.0-specific scope, the conditions Arnav resolved in the 2026-05-13 session, and the failure modes you'd otherwise repeat are not in the hook output. They are here.

---

## 0. What you're shipping (in order)

**Two milestones. Close v1.6 first, then ship v2.0.** Don't skip ahead — v2.0 builds on a clean substrate, which means v1.6's reduce-list has to actually finish first.

### Milestone v1.6 — Narrowing Pass (CLOSE FIRST)

7 deletion commits already landed (financial_brain, health_guardian, security_monitor, pentest/kali, workflow_builder, deeplearn, deep_scan). Per VISION:186–194, the following "Significantly reduced" items are still pending and must close v1.6 before v2.0 can scaffold:

1. **Persona Engine / Personality Mirror auto-extraction → core-command-driven only.** Rip the silent personality inference from filenames + shell history. Voice comes from user-stated core command + actual chat history. Files: `persona_engine.rs` (1,317 LOC), `personality_mirror.rs` (821 LOC) — significant LOC reduction, not deletion.
2. **Total Recall → on-demand.** Stop the 30s screenshot loop. Fires only when *"what was on my screen 10 min ago"* is asked. `screen_timeline.rs` (658 LOC) + capture loop in `lib.rs`.
3. **Audio Timeline → on-demand.** Same pattern — transcription on request, not always-on. `audio_timeline.rs` (1,137 LOC).
4. **Tentacle passive observation → default-off.** B1 already shipped config off-switches; this finishes by making *default-off* the shipped state. Cron-style polling in `tentacles/*`.
5. **Background agent spawning → delegate to user's Claude Code / Cursor / Goose.** Rip BLADE's "spawn arbitrary agents" code. BLADE detects what the user has and routes code work there. `background_agent.rs` (728 LOC).
6. **Pulse / Morning Briefings → cron primitive stays, daily-summary engine cuts.** Proactive interjection routes through decision_gate so it only fires when something matters per the core command. `pulse.rs` (1,094 LOC).
7. **Current onboarding Steps removal.** Per VISION:184, the `Steps.tsx → ApiKeyEntry → DeepScanReview → PersonaCheck` flow retires. **This naturally happens as part of v2.0 hunt onboarding** — the hunt replaces Steps wholesale. So this cut can either land in v1.6 close or fold into v2.0 Phase 1. Default: fold into v2.0 to avoid two passes on the same files.

**v1.6 close criteria:** `verify:all` ≥36/38 (OEVAL-01c carry-forward documented), CHANGELOG v1.6 entry, `milestones/v1.6-MILESTONE-AUDIT.md` written, phase folder created retroactively if missing (the v1.6 deletion commits skipped GSD scaffold — `gsd-health` will flag, run `/gsd-health --repair`).

### Milestone v2.0 — Setup-as-Conversation + Forge Demo

Three outcomes only:

1. **Install pipeline.** `curl | sh` on macOS/Linux. PowerShell `iwr | iex` variant on Windows. WSL detection. Architecture detection. Graceful upgrade-vs-fresh handling that preserves `~/.blade/who-you-are.md` + keychain + SQLite. README-documented quarantine fix (`xattr -cr`) auto-runs on macOS. Fallback download host beyond GitHub Releases for proxied networks.
2. **Agentic hunt onboarding.** Acts 1–7 per `.planning/v2.0-onboarding-spec.md` (locked 2026-05-13). Pre-scan → message #1 with key disclose + override + "feels illegal but legal" register → LLM-driven hunt narrated live in chat → `platform_paths.md` knowledge file for per-OS install conventions → no-data fallback (one sharp question) → contradiction surfacing → synthesis to `~/.blade/who-you-are.md` (user-editable Markdown) → first task closes onboarding by BLADE *acting*. Rips the old Steps flow as part of this work.
3. **One forge wire.** The forge primitive (`evolution.rs` → `autoskills.rs` → `tool_forge.rs`) shipped substrate 2026-05-02 but has not fired on a real capability gap once in 11 days. Pick one gap a power user actually hits, wire forge to fire visibly in chat (chat-line: *"capability gap detected → writing tool → testing → registered → retrying"*), make it work end-to-end against a real LLM. **This is the Twitter-video moment per VISION:40.**

**Everything else BLADE needs is already shipped.** Chat works. Memory exists (fragmented, separate problem). The other four primitives (doesn't refuse / finds a way / forges tools substrate / presence backend) are present. **Do not** rebuild them; do not add scope.

---

## 1. Conditions Arnav resolved in the 2026-05-13 handoff session

These are NOT in any file the hooks load. They're in this doc + in `.planning/decisions.md` final two entries. Treat as authority for *this session only*:

| Condition | Resolution |
|---|---|
| **Token budget** | No cap. Don't conserve. Run the real models. |
| **Runtime UAT** | Close phases at `checkpoint:human-verify`. Arnav tests on his machine (or you test on Windows) after the autonomous session ends. Static gates green is the close bar, not runtime walkthrough. |
| **Wake-up checkpoint** | Only if hard-blocked. NOT scheduled. Hard-block = substrate fails on real LLM (not fixture), build chain regresses below 36/38 gates and can't be fixed without architectural change, or a structural decision authority doesn't cover. Otherwise grind. |
| **External-account auth (OAuth/Slack/Gmail/etc.)** | **Build the OAuth flows + unit-test URL/token logic + integration-test against localhost mock OAuth servers. Ship.** Real "click Allow on Google's screen" happens on each end-user's first run on their machine — not at build time. BLADE is a *product*, not a tool for Arnav. You do not need to authenticate against his real accounts. |
| **Scope creep** | Rejected. v2.0 = install + hunt + one forge wire. The 14-phase agent-native-audit reframe rolls into v2.1+, not v2.0. The "Held for v2.0 evaluation" trio (Body Map / mortality salience / Ghost Mode) stays untouched per Arnav's 2026-05-13 "leave them for now." |

---

## 2. Failure modes from the 2026-05-13 session — DO NOT REPEAT

Today's conversation produced three retractions and two corrections. Read each and pattern-match before sending anything load-bearing:

1. **Forge-first override of VISION.** I argued v1.6 should be the forge demo, not the narrowing pass. VISION says narrowing first. Retracted same day. **Rule encoded:** `decisions.md` is positions log, NOT authority over VISION. When the two contradict, surface to Arnav in plain text. Never silently pick decisions.md as the tiebreaker.

2. **"Memory continuity is BLADE's wedge nobody else has."** Wrong. Claude Code + memory MCP + mem0 + CLAUDE.md gives users memory continuity at the same fidelity. I should have *searched first* before claiming a wedge. Memory is **table stakes** BLADE hasn't reached yet (fragmented across 5 modules, 3,281 LOC, only 2 have consolidation code, agent CRUD at 10%) — not a differentiator that elevates BLADE. **Rule encoded:** before claiming "structurally unique to BLADE," grep + search + read what competitors actually ship. The probe is cheap, the unchecked claim is expensive.

3. **VISION should solve distribution.** Wrong. VISION is product vision. Distribution belongs in a separate launch doc that doesn't exist yet. Conflating them was a category error. **Rule encoded:** when asking "is X missing from VISION?", check the doc's scope first. Doc has a scope; respect it.

4. **Conflating build with run-end-to-end.** I worried about OAuth-as-Arnav for testing. Arnav corrected: BLADE is a product, each user OAuths on their machine, build-time testing uses mock OAuth servers. **Rule encoded:** distinguish *building the code* from *running the runtime against real services*. Production auth is the user's job on their machine. Build-time auth is mock-server territory.

5. **Decorating threads / overlong responses / 2-4 options to pick from.** Caught explicitly three times today: "simpler language," "I asked for proper reasoning not what's wrong," "are you confused on Blade being a product or personal tool." **Rule encoded:** position first, plain language, one bet not four options. If you find yourself writing "Option A / Option B / Option C" — stop, pick the one you'd defend, send only that. Brevity over completeness.

---

## 3. The smart-thinking model (apply per phase)

Per `AGENT_OPERATING_MODE.md` Rules 1–8 (already auto-loaded). Specific to v2.0 work:

**For every user-facing flow (install, onboarding, forge demo), think through if/what-if BEFORE code:**

- *What if user is on Windows / WSL / fresh machine / corporate proxy / behind firewall / on ARM Linux / on Intel Mac?*
- *What if user denies mic permission / has no API keys / has expired keys / only has free-tier keys / has Ollama running but no models?*
- *What if pre-scan times out / hunt finds nothing / hunt finds contradictions / hunt tries to read sensitive files (~/.ssh, .env, .aws/credentials)?*
- *What if user says "skip" / "stop" mid-hunt / closes app mid-synthesis / has previous install with existing `~/.blade/`?*
- *What if first task needs external auth (OAuth) / needs a tool that doesn't exist (forge fires) / is impossibly large / is ambiguous?*
- *What if forge writes a tool that doesn't work on first try / forge can't find a way / capability gap is structural not tool-shaped?*

Spec the answer to each *before* writing the code. The implementation gets cleaner when the edge cases were named first.

**For every load-bearing position taken:**
- Position first, evidence after.
- Adversarial pass — what would defeat this? Write the counter-argument in the response or in `decisions.md`.
- Falsification condition — what observable thing would prove the position wrong in 30 days?
- Log to `decisions.md` if it changes what gets built or shipped.

**For every wandering pass (every ~5 phases or 2 hours):**
- Read one file you weren't told to read.
- Compare BLADE to one external reference (Claude Code skill, Goose pattern, Hermes Agent technique).
- Pull one thread that nags.
- Add one entry to `surprises.md` when a prior gets contradicted.

**For every session-end:**
- Append a 3-line snapshot to `~/.claude/session-state.md` (project, did, next).
- Close phase at `checkpoint:human-verify` with static gates green.

---

## 4. The execution loop (self-policing — no human check-ins)

**The GSD plugin already has the verification agents that catch what static gates miss. Use the autonomous chain. Don't run phases manually.**

### Step 0 — Repair v1.6 scaffold

Seven `chore(v1.6)` deletion commits landed without a phase folder. Run first:

```
/gsd-health --repair       → flags + auto-fixes planning directory health issues
/gsd-new-milestone v1.6    → retroactive scaffold if needed
```

Then for v1.6 "Significantly reduced" items, use the autonomous chain below as a single milestone. Close v1.6 before starting v2.0.

### Step 1 — `/gsd-autonomous` for both milestones

This is THE skill for exactly this use case (description: *"Run all remaining phases autonomously — discuss→plan→execute per phase"*).

```
/gsd-autonomous
```

It chains, per phase:

- **`/gsd-discuss-phase --auto`** → defaults from VISION + decisions.md + this handoff. No interactive questions.
- **`/gsd-plan-phase`** → spawns `gsd-pattern-mapper`, `gsd-phase-researcher`, `gsd-planner`, then `gsd-plan-checker` (goal-backward verification — **blocks if plan won't ship the goal**).
- **`/gsd-execute-phase`** → spawns `gsd-executor` (atomic commits per plan, wave-based parallelization). Static gates (`verify:all`) run per commit.
- **At phase close** (automatic, no prompting needed):
  - `gsd-code-reviewer` → REVIEW.md with severity-classified findings
  - `gsd-code-fixer` → atomic fix commits for Critical/High findings (skill: `/gsd-code-review-fix`)
  - `gsd-integration-checker` → cross-phase E2E flow verification
  - `gsd-verifier` → goal-backward: did this phase deliver what was promised?
  - `gsd-secure-phase` → security audit if PLAN had threat model
  - If any of the above returns BLOCKED → attempt one self-fix via the appropriate fixer agent; if still blocked, write to `.planning/WAKE.md` and exit per §7.
  - Otherwise → commit, push, mark phase closed at `checkpoint:human-verify`, advance to next phase.

### Step 2 — Milestone-close audit (run before declaring v1.6 then v2.0 closed)

```
/gsd-audit-milestone
```

Spawns `gsd-eval-auditor` + `gsd-security-auditor` + `gsd-nyquist-auditor`. Produces `MILESTONE-AUDIT.md` with PASS / FAIL / TECH_DEBT verdict. Handle each:

- **PASS** → `/gsd-complete-milestone` to archive and advance.
- **TECH_DEBT** → log carry-forward to next milestone, close per v1.1 / v1.2 / v1.5 precedent (acceptable per AGENT_OPERATING_MODE.md authority hierarchy).
- **FAIL** → `/gsd-plan-milestone-gaps` then execute remediation phases via `/gsd-autonomous` before close.

### Step 3 — Session-end protocol (always runs, even on partial finish)

```
/gsd-session-report   → token usage, work summary, outcomes
/gsd-progress         → current state + next action
```

Update `STATE.md` + `ROADMAP.md` + append a 3-line snapshot to `~/.claude/session-state.md`. `git push`. If milestone closed, `git tag v1.6` then `v2.0` and push tags.

### What's different from the v1.6 manual sequence (that broke discipline)

v1.6 ran as raw `chore(v1.6)` commits with no phase folder, no plan, no code review, no verifier. That's why Arnav has had to backstop strategy decisions all day. **`/gsd-autonomous` exists so that doesn't happen.** Every phase gets planned, verified, reviewed, integrated, audited — automatically. No human in the loop until a hard-block hits §7.

Site rewrite around VISION's positioning is a separate piece — fold into v2.0 close phase if there's time, otherwise defer to v2.1 (Arnav's call inferred from VISION:155).

---

## 5. Things that should be in VISION but aren't (raised 2026-05-13)

Don't act on these in this session — they're Arnav's call. Flag in decisions.md if you find evidence during the session that pushes a verdict:

- **The fifth primitive (presence) bundles too many things.** Proposal in decisions.md: split into *internal state* (hormones/vitality/active inference) + *initiative* (Evolution Engine / proactive engine) + move Hive Mesh to architecture section. Each becomes atomic and testable.
- **Kids-with-side-projects target user.** Suspicious — kids use free Claude.ai. Arnav agrees framing is wrong but VISION still has it. Worth flagging at v2.0 close for README rewrite.
- **No economic model / stop condition.** When does single-dev burnout get a response? VISION names the risk but not the trigger. Worth a position at v2.0 close.
- **vierisid/jarvis is in BLADE's exact lane** per `surprises.md` 2026-05-12. VISION's competitive table treats it as adjacent. Worth flagging for the README rewrite as competitive copy.

---

## 6. Apply VISION:218's litmus test strictly

> *"Does it advance one of the four primitives (doesn't-refuse / finds-a-way / forges-tools / setup-as-conversation) or the fifth (presence)? Does it serve the user (builders, founders, power users, kids with side projects)? Does it survive the SaaS-eaten era? If yes to all three: ship. If not: defer or kill."*

**Apply this to every commit you make.** If a piece of work doesn't advance one of the primitives directly (not "unblocks" — *advances*), defer it.

The v1.4 + v1.5 milestones shipped foundation work that arguably only *unblocks* the primitives. v2.0 is the milestone that ships the primitives themselves. Don't let infrastructure scope creep eat the wedge work.

---

## 7. The only conditions that wake Arnav

Wake = stop work, commit clean state, write a `.planning/WAKE.md` entry, exit. Wake conditions are restrictive on purpose — the GSD verifier chain catches what static gates miss; it's designed to grind through everything else without supervision.

1. **GSD verifier (`gsd-verifier` or `gsd-plan-checker`) returns BLOCKED twice on the same phase after one self-attempted fix.** Goal can't be achieved as scoped → scope question, not implementation question.

2. **Build chain regresses below 36/38 verify gates AND `gsd-code-fixer` fails to recover in one pass.** Substrate broke architecturally.

3. **A locked decision in VISION or decisions.md genuinely doesn't cover the situation, AND defaulting either way would commit material work in a direction that's hard to reverse.** Authority is silent.

For everything else: `gsd-code-fixer` / `gsd-debugger` / `gsd-audit-fix` / `gsd-reapply-patches` — pick the right fixer agent, attempt fix, log to phase notes, continue. The autonomous chain is designed for exactly this.

**`WAKE.md` format:**
- One sentence: what blocked
- Phase + commit hash
- Specific verifier output or authority gap
- What was tried (which fixer agents ran)
- The default direction if forced to pick

---

## 8. Session-end protocol

Whether you finish or get blocked:

1. Update `.planning/STATE.md` with current position + last activity.
2. Update `.planning/ROADMAP.md` with phase status.
3. Write final entry to `~/.claude/session-state.md` (3-line snapshot: project / did / next).
4. If milestone closed: `git push` and tag v2.0.0-rc.
5. If blocked: leave clean working tree (no half-merged commits), final commit with status, wake message in chat that names the specific block.

---

## 9. The one-line prompt Arnav will paste in the new session

```
Read /home/arnav/blade/.planning/V2-AUTONOMOUS-HANDOFF.md top to bottom, then execute v2.0 autonomously. Wake me only if you hit one of the three hard-block conditions in §7. Go.
```

That's it. The hooks will load operating mode + recent commits + decisions. This doc handles the v2.0-specific scope + the 2026-05-13 conditions + the failure modes. The one line above is sufficient to start.

---

*Handoff written 2026-05-13. If this conflicts with VISION.md, VISION wins.*
