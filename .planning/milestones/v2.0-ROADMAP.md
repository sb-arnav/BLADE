# Roadmap — BLADE

**Current Milestone:** v2.0 — Setup-as-Conversation + Forge Demo
**Created:** 2026-05-13 | **Source:** VISION.md (locked 2026-05-10) + V2-AUTONOMOUS-HANDOFF.md §0 + `.planning/v2.0-onboarding-spec.md` + `.planning/decisions.md` 2026-05-13 entries
**Phases:** 45–48 (continues global numbering; v1.6 ended at Phase 44)

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
| **v2.0** | **Setup-as-Conversation + Forge Demo** | 🔄 Active | **45–48** | — |

---

## v2.0 Phases

### Summary Checklist

- [ ] **Phase 45: Install Pipeline** — `curl|sh` macOS/Linux + `iwr|iex` Windows + WSL detection + arch detection + upgrade-vs-fresh + macOS xattr fix + fallback download host
- [ ] **Phase 46: Agentic Hunt Onboarding** — Acts 1-7 per `.planning/v2.0-onboarding-spec.md`: pre-scan → message #1 → LLM-driven hunt with live chat narration → platform_paths.md → no-data fallback → contradiction surfacing → synthesis to `~/.blade/who-you-are.md` → first task closes onboarding by BLADE acting. Rips Steps.tsx flow wholesale. OAuth via mock-server integration tests.
- [ ] **Phase 47: One Forge Wire** — Pick one real capability gap. Wire forge to fire visibly in chat. End-to-end against a real LLM. The Twitter-video moment per VISION:40.
- [ ] **Phase 48: Close** — CHANGELOG v2.0, MILESTONE-AUDIT, phase archive, README rewrite, git tag v2.0.

### Sequencing

```
   Phase 45 (Install Pipeline)             FIRST — needed before any user can install v2.0
       │
       ▼
   Phase 46 (Agentic Hunt Onboarding)      depends on Install (user must be able to launch BLADE)
       │
       ▼
   Phase 47 (One Forge Wire)               depends on Hunt (user must reach chat to see forge)
       │
       ▼
   Phase 48 (Close)                        gates on all prior phases
```

### Success Criteria (milestone-level)

1. New user can run a single command (`curl|sh` or `iwr|iex`) and have BLADE installed + launched on macOS / Linux / Windows
2. First launch opens chat → pre-scan completes < 2s → message #1 lands with key disclosure + override + "feels illegal but legal" register
3. After key verify, BLADE runs the agentic hunt with live narration → synthesizes `~/.blade/who-you-are.md` (user-editable)
4. Onboarding closes with BLADE acting on a real user task, not a "setup complete" screen
5. Forge primitive fires visibly on one real capability gap end-to-end against a real LLM. A 30-second screen recording of the loop is producible.
6. `verify:all` ≥36/38 (OEVAL-01c v1.4 carry-forward documented)
7. Steps.tsx + ApiKeyEntry + DeepScanReview + PersonaCheck removed from codebase

### Phase Details

#### Phase 45: Install Pipeline

**Goal**: One-command install on every supported platform. Fresh-install and upgrade paths both work. Architecture and WSL detection prevent the most common dev-on-Windows setup failure.
**Requirements**: INSTALL-01..07
**Depends on**: v1.6 close (substrate ready)
**Success Criteria**:
  1. `curl -sSL slayerblade.site/install | sh` installs + auto-launches on macOS + Linux
  2. `iwr -useb slayerblade.site/install.ps1 | iex` installs + auto-launches on Windows
  3. Architecture detection picks arm64 vs x86_64 correctly on macOS + Linux + Windows
  4. Upgrade preserves `~/.blade/who-you-are.md`, keychain entries, blade.db
  5. macOS Gatekeeper quarantine cleared automatically (`xattr -cr`)
  6. README documents the install command + manual fallback if quarantine fix fails
  7. Fallback download host wired (CDN mirror beyond GitHub Releases)

#### Phase 46: Agentic Hunt Onboarding

**Goal**: Replace the 4-step wizard with the LLM-driven agentic hunt. First 60 seconds delivers BLADE's wedge: it knows you before you tell it.
**Requirements**: HUNT-01..10
**Depends on**: Phase 45 (install must work for users to launch v2.0)
**Success Criteria**:
  1. Pre-scan completes < 2s on a typical machine; result lands in `InitialContext` in memory
  2. Message #1 lands within 1s of chat window paint; four-sentence shape per spec
  3. After key verify, the hunt LLM session begins; every probe narrates to chat in real time
  4. `platform_paths.md` ships in the binary; hunt LLM reads from it as context for per-OS path conventions
  5. Hunt synthesizes `~/.blade/who-you-are.md` (Markdown, user-editable)
  6. No-data fallback fires on fresh machine: one sharp question, then probe driven by the answer
  7. Contradiction surfacing: when signals conflict, BLADE asks the specific contradiction not a generic question
  8. Onboarding closes with BLADE acting on a real user task (the first task IS the close)
  9. Steps.tsx + ApiKeyEntry + DeepScanReview + PersonaCheck removed; their routes cleaned out of router.ts; their assertions cleaned out of any remaining verify scripts
  10. OAuth flows (Slack/Gmail/etc.) build cleanly + pass localhost mock-server integration tests

#### Phase 47: One Forge Wire

**Goal**: The forge primitive (`evolution.rs` → `autoskills.rs` → `tool_forge.rs` from v1.3) fires visibly on one real capability gap end-to-end against a real LLM. Per VISION:40 — the only feature in the vision other personal-AI projects cannot copy in a sprint.
**Requirements**: FORGE-01..03
**Depends on**: Phase 46 (user must reach the chat to see forge fire)
**Success Criteria**:
  1. One real capability gap chosen (locked in `47-CONTEXT.md`)
  2. Forge fires chat-line emissions in 4 phases: gap detected → writing tool → testing → registered → retrying
  3. End-to-end against a real LLM: tool written, registered, original request retried successfully
  4. 30-second screen recording captures the full loop visibly

#### Phase 48: Close

**Goal**: v2.0 milestone closed cleanly. CHANGELOG, audit, phase archive, README rewrite, git tag.
**Requirements**: CLOSE-01..04
**Depends on**: Phase 45, 46, 47
**Success Criteria**:
  1. CHANGELOG.md v2.0 entry with all 20 REQ-IDs + commit SHAs
  2. `.planning/milestones/v2.0-MILESTONE-AUDIT.md` written
  3. Phase 45-48 directories archived to `milestones/v2.0-phases/`
  4. README.md rewritten: install command up top + agentic hunt + forge demo
  5. MILESTONES.md v2.0 entry
  6. cargo + tsc + verify:all all green to floor
  7. git tag `v2.0` pushed

---

## v1.6 Phases (Validated — Narrowing Pass)

See `.planning/milestones/v1.6-ROADMAP.md` for full text. 6/6 phases shipped. ~17,700 LOC removed.

---

## Risk Register (v2.0)

| Risk | Phase impacted | Mitigation |
|---|---|---|
| Install script fails silently on macOS with Gatekeeper blocking the auto-launch | 45 | xattr -cr runs automatically in post-install. Manual fallback documented in README. First-launch script checks and runs if needed. |
| WSL-on-Windows: user has Claude Code installed inside WSL, naive PowerShell `which claude` returns nothing | 45 + 46 | `platform_paths.md` documents the `wsl --list --quiet` → per-distro `wsl which claude` probe pattern. Hunt LLM reads from it. |
| Hunt LLM exceeds 50K token budget on a richly-instrumented machine | 46 | Hunt prompt instructs sample-not-exhaust. Recency-weighted: files >30 days get one-line summaries; files <7 days get deep reads. Cost surfaces live. |
| Hunt reads sensitive files (~/.ssh, .env, .aws/credentials) | 46 | Sandboxed readonly tool: explicit deny-list (.ssh, .env, .aws, .gnupg, keyring/keychain paths). Live chat narration ensures user sees and can stop. |
| Forge writes a tool that doesn't work on first try | 47 | Forge already has retry-on-test-fail in v1.3 substrate; verify the loop completes within 3 iterations. If still failing, surface the failure in chat ("capability gap is structural — not tool-shaped"). |
| Forge fires on a gap that's actually solved by an existing tool (false positive) | 47 | Run pre-check before forge fires: search the existing tool catalog + MCP registry. Only fire if no extant tool matches. |
| OAuth integration tests against localhost mock servers diverge from real provider behavior | 46 | Per V2-AUTONOMOUS-HANDOFF.md §1: build + ship; real "click Allow" happens per-user on their machine. Mock-server tests are sufficient for v2.0 close. |
| OEVAL-01c v1.4 organism-eval drift regresses further during v2.0 work | 46 + 47 | v2.0 doesn't touch organism modules. If verify:eval drops below the 36/38 floor: wake per V2-AUTONOMOUS-HANDOFF.md §7 #2. |

---

## Notes

- **Phase numbering continues globally** per M-05/M-12. v2.0 starts at Phase 45.
- **v2.0 close criteria** per V2-AUTONOMOUS-HANDOFF.md §0: install pipeline works on macOS+Linux+Windows; hunt onboarding lives in chat; forge fires visibly on one gap. Anything beyond rolls to v2.1+.
- **Wake conditions** unchanged: GSD verifier BLOCKED twice on same phase after one self-fix; verify gates regress below 36/38 and code-fixer fails; authority gap.
- **Static gates ≠ done** per CLAUDE.md verification protocol. Per V2-AUTONOMOUS-HANDOFF.md §1, runtime UAT is operator-owned for v2.0 (Arnav tests on his machine; you test on Windows when available). Close at static-gates-green.

---

*Last updated: 2026-05-13 — v2.0 scaffold landed per V2-AUTONOMOUS-HANDOFF.md §0.*
