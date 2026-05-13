# Requirements: BLADE

**Defined:** 2026-05-03 (v1.5 baseline); v1.6 added 2026-05-13
**Core Value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.

## v1.6 Requirements — Narrowing Pass

VISION.md (locked 2026-05-10) names two reduction tracks for v1.6: **Removed (locked)** and **Significantly reduced**. The "Removed" track shipped 2026-05-12/13 as 7 `chore(v1.6)` commits without phase scaffold (now wrapped as retroactive Phase 39). The "Significantly reduced" track is what v1.6 closes.

Per `.planning/decisions.md` 2026-05-13 "v1.6 shape = pure deletion, NOT the audit's 5-phase agent-native reframe": the agent-native audit's recs #2-10 (slash commands, crud_tools! macro, build-time codegen, etc.) roll into **v2.0**, not v1.6. Per V2-AUTONOMOUS-HANDOFF.md §0 item 7: the **onboarding Steps cut folds into v2.0 Phase 1**, not v1.6.

### Vertical Deletions (Phase 39 — SHIPPED retroactively)

- [x] **DEL-01**: Financial Brain removed — `financial_brain.rs` + UI + routes (commit `ae54a15`)
- [x] **DEL-02**: Health Guardian removed — `health_guardian.rs` + UI + routes (commit `b775857`)
- [x] **DEL-03**: Security Monitor removed — `security_monitor.rs` + scan tooling (commit `7083d14`)
- [x] **DEL-04**: Pentest Mode removed — kali + pentest modules + UI (commit `c0bf13f`)
- [x] **DEL-05**: Workflow Builder removed — visual graph editor (commit `2686761`)
- [x] **DEL-06**: deeplearn auto-write synthesizer removed (commit `568b236`)
- [x] **DEL-07**: Deep Scan + ecosystem auto-enable + scan onboarding removed (commit `aa789f7`)

### Always-On → On-Demand (Phase 40)

- [ ] **REDUCE-02**: Total Recall — `screen_timeline.rs` background 30s screenshot loop disabled by default; fires on demand when user asks "what was on my screen N min ago" (LLM tool call into the on-demand capture path). Background loop in `lib.rs` removed; on-demand command remains.
- [ ] **REDUCE-03**: Audio Timeline — `audio_timeline.rs` always-on transcription removed; on-demand transcription path stays (Whisper invoked from explicit user request only).
- [ ] **REDUCE-04**: Tentacle passive observation — B1 already shipped config off-switches; Phase 40 flips defaults to **off** for all observer-class tentacles. Opt-in only.

### Persona Auto-Extraction Removal (Phase 41)

- [ ] **REDUCE-01**: Rip silent personality inference from filenames + shell history in `persona_engine.rs` (~1,317 LOC) and `personality_mirror.rs` (~821 LOC). Voice comes from user-stated core command (filled by v2.0 hunt) + actual chat history only. Significant LOC reduction, NOT deletion — keep the modules for v2.0 hunt output ingestion.

### Background Agent Delegation (Phase 42)

- [ ] **REDUCE-05**: `background_agent.rs` (~728 LOC) — rip BLADE's "spawn arbitrary agents" code. Replace with detection: which agent stacks does the user have installed (Claude Code, Cursor, Goose, Aider)? Route code work to the detected agent. BLADE itself stops spawning workers.

### Pulse Reduction (Phase 43)

- [ ] **REDUCE-06**: `pulse.rs` (~1,094 LOC) — cron primitive stays. Daily-summary engine cuts. Proactive interjection routes through `decision_gate` so it only fires when something matters per the core command. Morning briefing as a feature retires; the underlying scheduler remains for future cron-driven work.

### Close (Phase 44)

- [ ] **CLOSE-01**: CHANGELOG v1.6 entry — lists all 7 vertical deletions + 6 reductions + verify gate count (must remain ≥36/38 per V2-AUTONOMOUS-HANDOFF §0 close criteria; OEVAL-01c v1.4 carry-forward documented)
- [ ] **CLOSE-02**: `milestones/v1.6-MILESTONE-AUDIT.md` written with phase coverage, requirements 3-source cross-reference, static gates, executive verdict
- [ ] **CLOSE-03**: Phase 39–44 directories archived to `milestones/v1.6-phases/`; cargo check + tsc --noEmit + verify:all all exit 0
- [ ] **CLOSE-04**: README updated to reflect narrowed scope (vertical product surfaces no longer claimed); MILESTONES.md gets v1.6 entry

## Future Requirements — v2.0 (Setup-as-Conversation + Forge Demo)

Three outcomes only per V2-AUTONOMOUS-HANDOFF §0. Detailed phase planning will be created at v1.6 close via `/gsd-new-milestone v2.0`.

### Install Pipeline

- **INSTALL-01**: `curl -sSL slayerblade.site/install | sh` macOS/Linux installer downloads, installs, auto-launches
- **INSTALL-02**: PowerShell `iwr | iex` variant for Windows
- **INSTALL-03**: WSL detection during install — if Windows + WSL, install inside the WSL distro the user is most active in
- **INSTALL-04**: Architecture detection (arm64 vs x86_64, macOS vs Linux vs Windows)
- **INSTALL-05**: Upgrade-vs-fresh handling — preserve `~/.blade/who-you-are.md` + keychain + SQLite on upgrade
- **INSTALL-06**: macOS quarantine fix — `xattr -cr` auto-runs on Gatekeeper-blocked launch with README documentation
- **INSTALL-07**: Fallback download host beyond GitHub Releases for proxied networks

### Agentic Hunt Onboarding (per `.planning/v2.0-onboarding-spec.md`)

- **HUNT-01**: Pre-scan (≤2s, no DB write) — agent presence, API keys, Ollama probe, OS+arch, default browser, mic permission
- **HUNT-02**: Message #1 — key disclose + default model + override + "feels illegal but legal" register + skip path
- **HUNT-03**: LLM-driven hunt with live chat narration — sandboxed readonly tools, ~50K token cap, recency-weighted
- **HUNT-04**: `platform_paths.md` knowledge file — per-OS install conventions (Windows/macOS/Linux + WSL detection)
- **HUNT-05**: No-data fallback — one sharp question + answer-driven probes
- **HUNT-06**: Contradiction surfacing — sharp questions when signals conflict
- **HUNT-07**: Synthesis to `~/.blade/who-you-are.md` (user-editable Markdown)
- **HUNT-08**: First task closes onboarding by BLADE *acting*, not a "setup complete" screen
- **HUNT-09**: Steps.tsx → ApiKeyEntry → DeepScanReview → PersonaCheck flow retired (folded from v1.6 cut list)
- **HUNT-10**: External-account auth (OAuth/Slack/Gmail/etc.) — build OAuth flows + unit-test URL/token logic + integration-test against localhost mock OAuth servers. Real "click Allow" happens on each end-user's first run, NOT at build time.

### One Forge Wire (the Twitter-video moment per VISION:40)

- **FORGE-01**: Pick one capability gap a power user actually hits (e.g., "fetch a YouTube transcript and summarize", "scrape this Notion page")
- **FORGE-02**: Wire forge to fire visibly in chat — *"capability gap detected → writing tool → testing → registered → retrying"*
- **FORGE-03**: End-to-end against a real LLM (not a fixture) — forge writes the tool, registers it, retries the original request, succeeds

## Out of Scope — v1.6 / v2.0 (per VISION.md "Held for v2.0 evaluation")

These are NEITHER cut NOR kept locked. v2.0 evaluation decides, but no work happens on them in this milestone:

- Body Map / Organ Registry / Pixel World / Tentacle Detail visualization panes
- Mortality-salience implementation (the *concept* of dormancy stays; the impl is up for evaluation)
- Ghost Mode (invisible meeting overlay) — demoted from tier-1; v2.0 evaluation question

## Kept (locked — VISION.md "presence, not features")

Hormones · vitality · active inference · character bible (SOUL) · Hive Mesh architecture · tentacles as a pattern · Evolution Engine (reframed as the proactive-presence + autonomous-knowledge-update layer, decision-gated).

These create *liveliness* the way memory creates *continuity*. Both are load-bearing for the JARVIS feel. Not negotiable in v1.6 / v2.0.

## v1.5 Requirements (Validated — Intelligence Layer, closed 2026-05-08 tech_debt)

See `.planning/milestones/v1.5-REQUIREMENTS.md` for full text. All 38 requirements code-complete; runtime UAT operator-deferred per feedback_deferred_uat_pattern.md.

---

*Updated 2026-05-13 — v1.6 retroactive scaffold per V2-AUTONOMOUS-HANDOFF.md*
