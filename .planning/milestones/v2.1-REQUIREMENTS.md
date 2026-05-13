# Requirements: BLADE

**Defined:** 2026-05-03 baseline; v2.1 milestone scoped 2026-05-13.
**Core Value:** BLADE works out of the box, you can always see what it's doing, and it thinks before it acts.

## v2.1 Requirements — Hunt + Forge + OAuth Depth

Polish + completion pass on v2.0. Closes the rough edges in hunt onboarding, OAuth coverage, and forge robustness. Authority chain: VISION.md (locked 2026-05-10) > V2-AUTONOMOUS-HANDOFF.md > v2.0-MILESTONE-AUDIT.md carry-forward list > REQUIREMENTS.md.

Deliberately deferred to v2.2+:
- Decision-gate per-source pulse threshold tuning (needs operator-dogfood signal)
- VISION-held-for-v2.0-evaluation trio re-evaluation (Body Map / mortality-salience / Ghost Mode — needs operator engagement data)
- Agent-native audit recs #2-10 (separate architectural reframe milestone)
- CDN bucket provisioning (release-CI infrastructure, not feature work)
- shellcheck + PSScriptAnalyzer CI gates (CI infrastructure)
- Windows ARM64 + Intel Mac asset publishing (release-CI infrastructure)

### Hunt Advanced + Cost Surfacing (Phase 49)

- [ ] **HUNT-05-ADV**: Advanced no-data fallback. When `start_hunt` returns the sharp question and gets a user answer, BLADE re-prompts the hunt LLM with the answer as seed input. The hunt then probes for matching identity signals (e.g., user answered "I run a B2B SaaS called Clarify" → BLADE searches for `clarify*` patterns in `~/code/`, `git remote -v` of detected repos, GitHub handle if discoverable, Twitter handle if discoverable). Falls back to the basic synthesis path if probing still yields nothing.
- [ ] **HUNT-06-ADV**: Advanced contradiction-detection. After the hunt accumulates findings, run a second LLM pass that classifies findings into thematic clusters (work / personal / hobby / past-self). If clusters conflict on identity (e.g., year-old Python iOS work vs this-week TypeScript SaaS), surface as a specific contradiction question. New struct `HuntContradictionReport` with thematic classification.
- [ ] **HUNT-COST-CHAT**: Live cost surfacing in chat. Both hunt and forge emit a `blade_chat_line` with `kind: "cost"` after each LLM call, showing cumulative cost. Format: *"≈ $0.04 / $3.00 budget used"*. Soft warning at 50%; hard interrupt at 100% with a "continue?" prompt.

### OAuth Coverage (Phase 50)

- [ ] **OAUTH-SLACK-FULL**: Promote `src-tauri/src/oauth/slack.rs` from stub to full implementation. Auth URL builder + state nonce + code-for-token exchange + refresh-token preservation + scope handling for `chat:write` + `channels:read` + `users:read`. Match Gmail's shape.
- [ ] **OAUTH-GITHUB-FULL**: Promote `src-tauri/src/oauth/github.rs` from stub to full implementation. GitHub OAuth Apps flow with device-code fallback for headless installs. Scopes for `repo` (read-only) + `user:email` + `gist`.
- [ ] **OAUTH-TESTS**: Add `src-tauri/tests/oauth_slack_integration.rs` (3 tests min, matching Gmail shape) + `src-tauri/tests/oauth_github_integration.rs` (3 tests min). All against localhost mock servers per V2-AUTONOMOUS-HANDOFF.md §1. No real-account auth at build time.

### Forge Multi-Gap Robustness (Phase 51)

- [ ] **FORGE-GAP-ARXIV**: Add arXiv abstract pull as a second proven gap. Forge fixture + integration test. LLM-written tool uses arXiv API (no auth).
- [ ] **FORGE-GAP-RSS**: Add RSS/Atom feed extraction as a third proven gap. Forge fixture + integration test.
- [ ] **FORGE-GAP-PYPI**: Add PyPI package metadata pull as a fourth proven gap. Forge fixture + integration test.
- [ ] **FORGE-PROMPT-TUNING**: Iterate the forge tool-writing prompt for reliability across these 4 gaps (HackerNews from v2.0 + 3 new). Track success rate via test runs.
- [ ] **FORGE-PRECHECK-REFINE**: Improve `pre_check_existing_tools` to better disambiguate "MCP server can handle" vs "needs forge." Specifically: handle the case where an MCP server exists but isn't installed by the user.

### Close (Phase 52)

- [ ] **CLOSE-01**: CHANGELOG v2.1 entry — all REQ-IDs, commit SHAs, verify gate count
- [ ] **CLOSE-02**: `.planning/milestones/v2.1-MILESTONE-AUDIT.md` (3-source cross-reference)
- [ ] **CLOSE-03**: Phase 49-52 directories archived to `milestones/v2.1-phases/`. cargo + tsc + verify:all all green to floor.
- [ ] **CLOSE-04**: README v2.1 polish update if user-visible features warrant. MILESTONES.md v2.1 entry. git tag `v2.1`.

## v2.0 Requirements (Validated — Setup-as-Conversation + Forge Demo, closed 2026-05-13 tech_debt)

See `.planning/milestones/v2.0-REQUIREMENTS.md` for full text. 20/20 REQ-IDs shipped. First end-user-shippable release.

## v1.6 Requirements (Validated — Narrowing Pass, closed 2026-05-13 tech_debt)

See `.planning/milestones/v1.6-REQUIREMENTS.md` for full text. 13/13 REQ-IDs shipped.

## Out of Scope — v2.1

Per the deferred-to-v2.2+ list above. Not work for this milestone.

## Kept (locked) — unchanged

Hormones · vitality · active inference · character bible (SOUL) · Hive Mesh architecture · tentacles as a pattern · Evolution Engine (decision-gated). Untouched in v2.1.

---

*Updated 2026-05-13 — v2.1 Hunt + Forge + OAuth Depth milestone scope landed.*
