# Requirements: BLADE v1.1 (Functionality, Wiring, Accessibility)

**Defined:** 2026-04-20
**Core Value:** BLADE works out of the box. A first-time user pastes a key, the deep scan surfaces their actual environment, observer-class tentacles auto-enable, every backend capability is reachable, and the user can always see what BLADE is doing.

**Source of truth:** `.planning/notes/v1-1-milestone-shape.md` (locked 2026-04-20). REQ-IDs below are derived from the shape's 6-phase falsifiable success criteria — not revised.

## v1 Requirements (v1.0 — shipped)

All 156 v1.0 requirements (FOUND, WIN, WIRE-01..08, ONBD, SHELL, DASH, CHAT, SET, QUICK, ORB, GHOST, HUD, AGENT, KNOW, LIFE, IDEN, DEV, ADMIN, BODY, HIVE, POL) shipped across Phases 0..9. See the git history before commit `6a78538` for the v1.0 REQUIREMENTS.md; validated capabilities are listed in PROJECT.md §Validated.

## v1.1 Requirements

### Inventory & Wiring Audit (AUDIT)

- [x] **AUDIT-01**: `WIRING-AUDIT.md` catalogs every Rust module under `src-tauri/src/` with purpose, trigger, UI surface reference, and classification — one of `ACTIVE`, `WIRED-NOT-USED`, `NOT-WIRED`, `DEAD`
- [x] **AUDIT-02**: Every route registered in `src/lib/router.ts` is classified in `WIRING-AUDIT.md` with data shape, data source, and flow status (data pipes / placeholder / dead)
- [x] **AUDIT-03**: Every field in `BladeConfig` (and its sibling config structs) is listed with the UI surface that exposes it, the control type, and discoverability path
- [x] **AUDIT-04**: NOT-WIRED items form a structured backlog with file:line references for each backend entry point, consumable by Phase 14 wiring work
- [x] **AUDIT-05**: DEAD items list carries a deletion plan noting import cycles + callers, so Phase 14 removal does not break the build

### Smart Provider Setup (PROV)

- [x] **PROV-01**: Pasting a raw cURL command into the provider form auto-extracts provider, model, `base_url`, and headers and fills the form fields
- [x] **PROV-02**: Pasting a JSON provider-config blob auto-extracts the same fields
- [x] **PROV-03**: Pasting a Python SDK snippet (e.g. `client = OpenAI(api_key=…, base_url=…)`) auto-extracts the same fields
- [x] **PROV-04**: Onboarding exposes a "custom config paste" affordance alongside the 6 hardcoded provider cards, accepting any of the three formats above
- [x] **PROV-05**: On API key save, BLADE runs one test call that retrieves model name, context window, vision support, audio support, and tool-calling support; the probe result persists in config
- [x] **PROV-06**: `BladeConfig` stores per-capability provider preference (`vision_provider`, `audio_provider`, `long_context_provider`, `tools_provider`) independent of the primary provider
- [x] **PROV-07**: When a UI surface requires vision and no vision-capable provider is configured, the surface shows a "needs vision-capable model" prompt with an "add key" CTA that opens the provider add flow — no blank dashboard card
- [x] **PROV-08**: Same capability-gap handling for audio-required, long-context-required, and tool-calling-required surfaces
- [x] **PROV-09**: `router.rs` task classification → model selection consults per-capability config and falls back through a prioritized chain on miss; it does not fail hard when the primary lacks the required capability

### Smart Deep Scan (SCAN)

- [ ] **SCAN-01**: Deep scan enumerates filesystem repo sources — `~/Projects`, `~/repos`, `~/src`, `~/code`, user-configured parent dirs — and every `.git` directory underneath them
- [ ] **SCAN-02**: For every discovered repo, deep scan reads git remotes and extracts org/repo names
- [ ] **SCAN-03**: Deep scan reads IDE workspace artifacts — `.code-workspace`, `.idea/`, Cursor state, VS Code recent-projects list
- [ ] **SCAN-04**: Deep scan reads AI session history — `~/.claude/projects/`, `~/.codex/`, `~/.cursor/`, browser-AI history where reachable
- [ ] **SCAN-05**: Deep scan reads shell history — `.bash_history`, `.zsh_history`, `.fish_history` — and extracts tool + repo signals
- [ ] **SCAN-06**: Deep scan builds filesystem MRU across home dir and surfaces files edited within the last 7 days
- [ ] **SCAN-07**: Deep scan reads browser bookmarks (Chrome / Brave / Arc / Edge)
- [ ] **SCAN-08**: Deep scan runs a `which` sweep over a curated list of dev CLIs and GUI apps and reports what's installed
- [ ] **SCAN-09**: Scanner builds its own todo list at scan start; highest-priority leads (recent-edited repos, active sessions) execute first, breadth fills in after
- [x] **SCAN-10**: Scanner streams results live to the activity log (LOG-01
) so the user sees the scan think out loud
- [ ] **SCAN-11**: Scan output is a structured profile document (repos, stack, accounts, people, rhythm, files), persisted and editable in-UI
- [ ] **SCAN-12**: Scan profile edits round-trip (save → restart → reload) and source-linked rows show origin (which scanner produced them)
- [ ] **SCAN-13**: Scan baseline on cold install — Arnav's machine — surfaces ≥10 repos, ≥5 accounts, ≥3 daily-rhythm signals, ≥3 IDE/AI tool signals

### Self-Configuring Ecosystem (ECOSYS)

- [x] **ECOSYS-01
**: If N repos found by scan, repo-watcher tentacle auto-enables (file-change + git-activity monitoring, read-only)
- [x] **ECOSYS-02
**: If Slack token or `~/.slack/` config detected, Slack monitor tentacle auto-enables (read-only triage, no reply capability)
- [x] **ECOSYS-03
**: If Vercel CLI installed and auth'd, deploy-monitor tentacle auto-enables (status reads, no deploys)
- [x] **ECOSYS-04
**: If GitHub CLI auth'd, PR-watcher tentacle auto-enables (read-only, no merges)
- [x] **ECOSYS-05
**: If active Cursor / Claude Code sessions detected, session-context bridge tentacle auto-enables
- [x] **ECOSYS-06
**: If Calendar API credentials detected, calendar-monitor tentacle auto-enables (read-only)
- [x] **ECOSYS-07
**: Settings page lists every auto-enabled tentacle with its trigger rationale (e.g. "Auto-enabled because deep scan found 14 repos") and a one-click disable toggle
- [x] **ECOSYS-08
**: Disabling an auto-enabled tentacle persists across restarts; the tentacle does not re-enable unless the user explicitly opts in
- [x] **ECOSYS-09
**: Hard observe-only guardrail — no auto-enabled tentacle performs any outbound action (reply/post/deploy/modify external state) in v1.1; enforced by a runtime check, not policy. Acting capability requires explicit Settings-side enablement even when credentials are present.
- [x] **ECOSYS-10
**: Cold install on Arnav's machine + Phase 12 scan produces ≥5 auto-enabled observer tentacles, all listed in Settings with rationale, all toggleable

### Wiring Pass (WIRE2)

- [ ] **WIRE2-01**: Every NOT-WIRED backend module from WIRING-AUDIT.md has a UI surface added in Phase 14 (route / dashboard card / Settings tab / command-palette entry) OR an explicit "deferred to v1.2" rationale logged in the audit
- [x] **WIRE2-02
**: Dashboard cards bind to real data from Phase 12 scan profile and Phase 13 auto-enabled tentacles — no placeholder text when the backing data exists
- [x] **WIRE2-03
**: Every WIRED-NOT-USED UI surface either gets its trigger fixed or is removed; no dead UI survives v1.1
- [ ] **WIRE2-04**: Every newly-wired surface gets a command-palette entry (⌘K) so keyboard discovery matches visual discovery
- [ ] **WIRE2-05**: Post-phase re-run of WIRING-AUDIT.md reports NOT-WIRED count = 0 OR every remaining item carries a documented "deferred to v1.2" rationale
- [ ] **WIRE2-06**: `npm run verify:all` gains a feature-reachability script that crawls the route registry + command palette and asserts every backend module has at least one reachable invocation path

### Accessibility Pass 2 (A11Y2)

- [ ] **A11Y2-01**: Every new surface in Phase 14 passes keyboard navigation — logical tab order, all interactives focusable, visible focus ring against glass
- [ ] **A11Y2-02**: WCAG AA 4.5:1 contrast re-verified on every new v1.1 surface against the 5 representative wallpapers used by v1.0's contrast test harness
- [ ] **A11Y2-03**: Every new control has a screen-reader label (`aria-label` or `aria-labelledby`) — no icon-only buttons without text alternative
- [ ] **A11Y2-04**: Every new dialog traps focus on open, restores focus to the trigger on close, and closes on Esc
- [ ] **A11Y2-05**: New animations respect `prefers-reduced-motion` — no unconditional transitions or transforms on reduced-motion users
- [ ] **A11Y2-06**: `npm run verify:all` gains an `a11y-pass-2` script asserting no icon-only buttons without labels, no dialogs without focus traps, no unguarded animations

### Activity Log (LOG)

- [x] **LOG-01
**: Persistent "BLADE is doing…" activity log strip mounts in the main shell (top bar or side strip per visual pass in Phase 15), visible across routes
- [x] **LOG-02
**: Every cross-module action emits an activity-log event with `{ module, action, human_summary, payload_id, timestamp }`; coverage verified by a script that asserts no backend action completes without a corresponding emission
- [x] **LOG-03
**: Click on any activity log entry opens a drawer showing full payload, reasoning, and outcome
- [x] **LOG-04
**: Activity log supports filter by module and time range; persists last N entries across restart (N defaulted in config)
- [x] **LOG-05
**: Phase 13 auto-enabled tentacles emit log rows for every observation so the activity log is the visible trust surface for "what are these tentacles doing?"

### Density + Polish (DENSITY)

- [ ] **DENSITY-01**: Every card, page, and modal passes the spacing ladder audit — padding and gaps use the design-token spacing scale; 0 violations across the 50+ routes
- [ ] **DENSITY-02**: Dashboard and cluster-landing cards use documented gap tokens; the screenshot-density problem (overlapping or crowded card edges) is resolved
- [ ] **DENSITY-03**: Background-image dominance fix — content takes visual priority over ambient imagery; contrast + eye-path pass on the 5 representative wallpapers
- [ ] **DENSITY-04**: Top bar hierarchy pass — primary actions, activity-log strip, status chips, and user/settings affordances have clear visual priority order with no overstuff
- [ ] **DENSITY-05**: Every empty state has either real content (populated by Phase 12 + 13 data) or a CTA + expected-timeline copy — *"BLADE is still learning — give me 24h"* pattern, not *"No recent decisions"*
- [ ] **DENSITY-06**: UI review across all 50+ routes reports 0 padding violations and 0 empty-state-without-CTA routes
- [ ] **DENSITY-07**: Dashboard hero pulls ≥3 live signals from scan profile + ecosystem tentacles + perception state — not placeholder cards

## v1.2+ Requirements

Deferred beyond this milestone. Tracked but not in current roadmap.

### JARVIS push-to-talk demo moment

- **JARVIS-V2-01**: Push-to-talk → natural-language command → cross-app action flow (e.g. "post something about myself from my Arc account"). Consumes v1.1 wiring + ecosystem + activity log.

### Acting tentacles

- **ACT-V2-01..N**: Outbound action capability per tentacle (reply, post, deploy, modify). Requires per-tentacle enablement flow and trust-tier escalation.
- Tentacles scoped for v1.2 acting capability: Slack reply, Email reply, GitHub PR review comments, Calendar decline/accept, Linear ticket creation.

### Browser tentacle deep work

- **BROWSER-V2-01**: Evaluate `browser-use/browser-harness` vs current `browser_native.rs` + `browser_agent.rs` — answer Q1 in `research/questions.md`. Decision deadline: before v1.2 JARVIS phase plan.

### Heads + Big Agent

- **HEAD-V2-01..04**: Communications Head, Development Head, Operations Head, Intelligence Head — each unlocks a cluster of v2+ acting tentacles.
- **BIGAGENT-V3-01**: Cross-head orchestrator. Consumes all 4 heads.

### Adjacent directions (raised but not scoped)

- Multi-instance / business SDK (inter-BLADE protocol)
- Linux power-user niche tooling
- Hyprland-as-host integration

See `.planning/notes/v2-vision-tentacles.md` for the full destination sketch.

## Out of Scope

All v1.0 Out of Scope entries remain in force. Additional v1.1 exclusions:

| Feature | Reason |
|---------|--------|
| Acting capability on any tentacle | Observe-only guardrail (M-03); trust earned via v1.1 observation logs, acting earned in v1.2 with per-tentacle consent flow |
| JARVIS push-to-talk cross-app demo | v1.1 builds the wiring a JARVIS demo would consume; shipping it here dilutes the "make it work" anchor (M-04) |
| Browser harness integration | Q1 research open; decision gated for v1.2 (see `research/questions.md`) |
| Heads or Big Agent | v2+ milestone unit — needs multiple tentacles per head to be useful |
| Multi-instance protocol / business SDK | v2+ adjacent direction; no v1.1 scope |
| Hyprland compositor integration | v2+ adjacent direction; no v1.1 scope |
| Net-new organ/tentacle capabilities | v1.1 is wiring + smart defaults, not backend expansion. The body works. |
| Backend rewrite beyond wiring gaps | Same as v1.0 rule (`Key Decisions` M-01): mutable for wiring only |
| Light theme / accent picker | Inherited from v1.0 out of scope |
| shadcn/Radix primitives, Framer Motion, Zustand, React Router | Inherited v1.0 stack decisions (D-01..D-05) |
| Changes to the 6-phase v1.1 shape without sign-off | Shape locked 2026-04-20 per M-02 |

## Traceability

Populated by roadmap creation below. Each v1.1 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUDIT-01 through AUDIT-05 | Phase 10 — Inventory & Wiring Audit | Pending |
| PROV-01 through PROV-09 | Phase 11 — Smart Provider Setup | Pending |
| SCAN-01 through SCAN-13 | Phase 12 — Smart Deep Scan | Pending |
| ECOSYS-01 through ECOSYS-10 | Phase 13 — Self-Configuring Ecosystem | Pending |
| WIRE2-01 through WIRE2-06 | Phase 14 — Wiring & Accessibility Pass | Pending |
| A11Y2-01 through A11Y2-06 | Phase 14 — Wiring & Accessibility Pass | Pending |
| LOG-01 through LOG-05 | Phase 14 — Wiring & Accessibility Pass | Pending |
| DENSITY-01 through DENSITY-07 | Phase 15 — Density + Polish | Pending |

**Coverage:**
- v1.1 requirements: **61 total** across 8 categories
- Mapped to phases: **61/61** ✓
- Unmapped: 0 ✓

**Category → Phase rollup:**

| Category | Count | Phase |
|----------|-------|-------|
| AUDIT | 5 | Phase 10 |
| PROV | 9 | Phase 11 |
| SCAN | 13 | Phase 12 |
| ECOSYS | 10 | Phase 13 |
| WIRE2 | 6 | Phase 14 |
| A11Y2 | 6 | Phase 14 |
| LOG | 5 | Phase 14 |
| DENSITY | 7 | Phase 15 |
| **Total** | **61** | 6 phases ✓ |

---
*v1.1 requirements defined: 2026-04-20 — derived from `.planning/notes/v1-1-milestone-shape.md` (locked)*
