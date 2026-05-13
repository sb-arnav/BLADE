# Requirements: BLADE

**Defined:** 2026-05-03 baseline; v2.0 milestone scoped 2026-05-13.
**Core Value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.

## v2.0 Requirements — Setup-as-Conversation + Forge Demo

Three outcomes only per V2-AUTONOMOUS-HANDOFF.md §0. Detailed flow in `.planning/v2.0-onboarding-spec.md`. Authority chain: VISION.md (locked 2026-05-10) > `.planning/decisions.md` 2026-05-13 entries > V2-AUTONOMOUS-HANDOFF.md > this milestone scope.

### Install Pipeline (Phase 45)

- [ ] **INSTALL-01**: `curl -sSL slayerblade.site/install | sh` macOS/Linux installer downloads BLADE Tauri binary, installs to `/Applications/Blade.app` (macOS) or `~/.local/bin/blade` (Linux), auto-launches.
- [ ] **INSTALL-02**: PowerShell `iwr -useb slayerblade.site/install.ps1 | iex` Windows variant — installs to `%LOCALAPPDATA%\Programs\Blade\`.
- [ ] **INSTALL-03**: WSL detection during install. If user runs the Linux installer inside WSL, install proceeds normally (no change). If user runs the Windows installer on a machine that has WSL with Claude Code installed inside WSL, document the WSL→Windows binary path delegation in `platform_paths.md` (consumed by Phase 46's hunt).
- [ ] **INSTALL-04**: Architecture detection — installer picks the correct arm64-vs-x86_64 binary based on `uname -m` (macOS/Linux) and `$env:PROCESSOR_ARCHITECTURE` (Windows).
- [ ] **INSTALL-05**: Upgrade-vs-fresh handling. On upgrade, preserve `~/.blade/who-you-are.md`, the OS keychain entries for API keys, and `~/.blade/blade.db` SQLite. On fresh install, none of these exist yet.
- [ ] **INSTALL-06**: macOS quarantine fix. The installer post-install step or first-launch script runs `xattr -cr /Applications/Blade.app` automatically to clear Gatekeeper quarantine. README documents the manual fallback if it fails.
- [ ] **INSTALL-07**: Fallback download host beyond GitHub Releases for proxied / restricted networks. Mirror to `cdn.slayerblade.site/releases/v{version}/` (or similar).

### Agentic Hunt Onboarding (Phase 46)

Per `.planning/v2.0-onboarding-spec.md` Acts 1-7. Rips `Steps.tsx → ApiKeyEntry → DeepScanReview → PersonaCheck` wholesale (the cut deferred from v1.6 per V2-AUTONOMOUS-HANDOFF.md §0 item 7).

- [ ] **HUNT-01**: Pre-scan (≤2s) — agent presence (`which claude/cursor/ollama/aider/gh`), API keys (env vars + Claude Code config + Cursor config + OS keychain), Ollama TCP probe `:11434`, OS+arch via `uname` / Windows registry, default browser via OS-native API, mic permission check (no recording). Result lands in in-memory `InitialContext`; nothing persisted unless user opts in.
- [ ] **HUNT-02**: Message #1 — key disclosure + default model rationale + override paths + "feels illegal but legal" register + skip semantics. Four-sentence first bubble per spec.
- [ ] **HUNT-03**: LLM-driven hunt with live chat narration. Single LLM session prompted to decide what to probe; equipped with sandboxed readonly tools (`read_file`, `list_dir`, `run_shell` no-network). Every probe narrates as it runs. ~50K token input cap; recency-weighted sampling; cost surfaces live.
- [ ] **HUNT-04**: `platform_paths.md` knowledge file ships with BLADE. Per-OS install conventions (Windows + macOS + Linux + WSL detection). Loaded into the hunt LLM's context.
- [ ] **HUNT-05**: No-data fallback. If hunt yields nothing (fresh machine), BLADE asks ONE sharp question — *"what do you do? not your job — the thing you'd point a friend at if they asked"* — then uses the answer as a search seed.
- [ ] **HUNT-06**: Contradiction surfacing. When hunt finds contradictory signals (year-old Python iOS workspace + this-week TypeScript SaaS commits), BLADE asks the contradiction directly, not a generic question.
- [ ] **HUNT-07**: Synthesis to `~/.blade/who-you-are.md` — user-editable Markdown file. Like CLAUDE.md but it's BLADE's model of the human.
- [ ] **HUNT-08**: First task closes onboarding by BLADE *acting*, not a "setup complete" screen. *"Give me one thing you've been putting off this week — I'll handle it now."*
- [ ] **HUNT-09**: Steps.tsx + ApiKeyEntry + DeepScanReview + PersonaCheck flow retired. The hunt replaces it wholesale.
- [ ] **HUNT-10**: External-account OAuth flows (Slack/Gmail/etc.) built with mock-server integration tests. Real "click Allow on Google's screen" happens on each end-user's first run on their machine. Build-time only uses localhost mock OAuth servers per V2-AUTONOMOUS-HANDOFF.md §1.

### One Forge Wire (Phase 47)

The Twitter-video moment per VISION:40. The forge primitive shipped substrate 2026-05-02 (v1.3 Phase 22: `evolution.rs` → `autoskills.rs` → `tool_forge.rs`) but has not fired on a real capability gap in lived chat in 11+ days. v2.0 makes it fire visibly on one real gap.

- [ ] **FORGE-01**: Pick one capability gap a power user actually hits. Candidates: "fetch a YouTube transcript and summarize," "scrape this Notion page and extract the action items," "extract structured data from a Twitter/X thread." Lock the gap in `47-CONTEXT.md` discussion.
- [ ] **FORGE-02**: Wire forge to fire visibly in chat. Chat-line emission: *"capability gap detected → writing tool → testing → registered → retrying"*. Each transition is a separate chat-line, not a single status update.
- [ ] **FORGE-03**: End-to-end against a real LLM (not the existing `youtube_transcript` fixture). Forge writes the tool, registers it, retries the original user request, succeeds. The 30-second demo video is recordable.

### Close (Phase 48)

- [ ] **CLOSE-01**: CHANGELOG v2.0 entry — all 20 REQ-IDs, commit SHAs, verify gate count
- [ ] **CLOSE-02**: `.planning/milestones/v2.0-MILESTONE-AUDIT.md` (3-source cross-reference: VISION ↔ REQUIREMENTS.md ↔ git log + the v2.0-onboarding-spec.md falsification conditions)
- [ ] **CLOSE-03**: Phase 45-48 directories archived to `milestones/v2.0-phases/`. cargo + tsc + verify:all all green to floor.
- [ ] **CLOSE-04**: README rewrite reflecting v2.0 positioning — install command up top, hunt onboarding documented, forge demo section. MILESTONES.md v2.0 entry. git tag `v2.0` pushed.

## v1.6 Requirements (Validated — Narrowing Pass, closed 2026-05-13 tech_debt)

See `.planning/milestones/v1.6-REQUIREMENTS.md` for full text. 13/13 REQ-IDs shipped. OEVAL-01c v1.4 carry-forward from v1.5 inherited but not introduced by v1.6.

## Out of Scope — v2.0 (still held for evaluation)

Per VISION.md "Held for v2.0 evaluation": Body Map / Organ Registry / Pixel World / Tentacle Detail panes, mortality-salience implementation, Ghost Mode invisible meeting overlay. v2.0 evaluation outcome documented at close.

## Kept (locked) — unchanged from v1.6

Hormones · vitality · active inference · character bible (SOUL) · Hive Mesh architecture · tentacles as a pattern · Evolution Engine (decision-gated). Untouched in v2.0.

---

*Updated 2026-05-13 — v2.0 Setup-as-Conversation + Forge Demo milestone scope landed per V2-AUTONOMOUS-HANDOFF.md §0.*
