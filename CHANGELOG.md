# Changelog

All notable changes to BLADE are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

Nothing yet.

---

## [1.4.0] -- 2026-05-03

### Added (v1.4 -- Cognitive Architecture)

> Shipped 2026-05-03 across phases 25-30 (6 feature phases + 1 close phase). Static gates: `cargo check` clean . `npx tsc --noEmit` clean . `npm run verify:all` 37/37 sub-gates green.

[v1.4 content filled by Task 2]

---

## [1.3.0] -- 2026-05-02

### Added (v1.3 -- Self-extending Agent Substrate)

> Shipped 2026-05-02 across phases 21-24 (4 feature phases). Static gates: `cargo check` clean . `npx tsc --noEmit` clean . `npm run verify:all` 33/33 sub-gates green . 435 Rust tests.

**Phase 21 -- Skills v2 / agentskills.io adoption** *(shipped 2026-05-01)*
- SKILL.md declarative format with progressive disclosure (simple → intermediate → advanced blocks).
- 3-tier resolution: workspace skills → user skills → bundled skills. Validator enforces format on load.
- 3 bundled exemplar skills demonstrating the format (shipped with binary).
- 8/8 SKILLS-XX requirements satisfied.

**Phase 22 -- Voyager Loop Closure** *(shipped 2026-05-01)*
- End-to-end wiring: `evolution.rs` → `autoskills.rs` → `tool_forge.rs` — gap detection → skill generation → tool registration.
- One reproducible gap closed: `youtube_transcript` skill generated from capability-gap fixture, registered, and invocable.
- verify:voyager gate added (chain count 32→33).
- 9/9 VOYAGER-XX requirements satisfied.

**Phase 23 -- Verifiable Reward + OOD Eval** *(shipped 2026-05-01)*
- RLVR-style composite reward signal in production (`reward.rs`): tool-success, user-approval, gap-closure, and novelty components.
- Adversarial eval fixtures: ambiguous queries, capability-gap probes, reward-hacking attempts.
- OOD (out-of-distribution) detection: confidence-calibrated refusal on queries outside training distribution.
- 7/7 REWARD-XX requirements satisfied.

**Phase 24 -- Skill Consolidation in dream_mode** *(shipped 2026-05-02)*
- Prune: unused skills (zero invocations over N cycles) flagged and archived.
- Consolidate: redundant skills merged (semantic similarity threshold) with provenance tracking.
- Generate: successful multi-step traces in dream_mode produce new candidate skills.
- 6/6 DREAM-XX requirements satisfied.

---

## [1.2.0] -- 2026-04-30

### Added (v1.2 — Acting Layer with Brain Foundation)

> Shipped 2026-04-30 across phases 16–20 (5 phases planned; 19 deferred to v1.3 under operator chat-first pivot). 89 commits since 2026-04-29. Static gates: `cargo check` clean · `npx tsc --noEmit` clean · `npm run verify:all` 31/31 sub-gates green · `bash scripts/verify-eval.sh` 5/5 floors green.

**Phase 16 — Eval Scaffolding Expansion** *(shipped 2026-04-29)*
- 5 eval modules under `tests/evals/` driving asserted floors per module (top-3 ≥ 80% / MRR ≥ 0.6): `hybrid_search_eval`, `real_embedding_eval`, `kg_integrity_eval`, `typed_memory_eval`, `capability_gap_eval`. All 5 baselines @ MRR 1.000.
- `verify:eval` script gates `npm run verify:all` chain (chain count 30→31).
- Scored-table format `┌──` rows emit per module per run; rows feed Phase 17 Doctor's eval-history source.
- 8/8 EVAL-XX requirements satisfied; `DEFERRED.md` with 4 v1.3 entries (multi-eval LLM-as-judge, eval-replay-on-PR, eval-MCP-fixtures, eval-trend-graphs).

**Phase 17 — Doctor Module** *(closed 2026-04-30 — code complete; runtime UAT deferred per operator chat-first pivot)*
- New `src-tauri/src/doctor.rs` module aggregating 5 signal classes into a unified Diagnostics sub-tab: `EvalScores`, `CapabilityGaps`, `TentacleHealth`, `ConfigDrift`, `AutoUpdate`.
- 3 Tauri commands: `doctor_run_full_check`, `doctor_get_recent`, `doctor_get_signal`. `tokio::join!` parallel source fetch.
- `doctor_event` Tauri event emits on warn-tier transitions only (D-20 — `prior != current && current ∈ {Amber, Red}`); paired ActivityStrip emission per M-07 (`[Doctor] {class} → {severity}: {summary}`).
- `harness::record_eval_run` extension (Phase 16) + `tests/evals/history.jsonl` append-only artifact (gitignored, dir tracked).
- Frontend: `DoctorPane.tsx` lazy-loaded sub-tab in `Diagnostics.tsx` (existing 6 tabs preserved, Doctor lands as 7th); 5 collapsible severity-stripe rows + Dialog drawer drill-down. Verbatim 15-string `suggested_fix` table from UI-SPEC § 15.
- `BLADE_EVENTS.DOCTOR_EVENT` + `DoctorEventPayload` interface; useTauriEvent subscription per D-13 lock.
- Two infrastructure repairs landed during verification: `verify-emit-policy.mjs` allowlist for `doctor.rs:doctor_event` + comment-stripping (eliminates documentation false-positive class); `10-WIRING-AUDIT.json` registers `doctor.rs` (modules.length 196→197).
- 35/35 `doctor::tests` green; runtime UI-polish UAT deferred (UI not load-bearing for v1.2 chat-first pivot — `17-07-SUMMARY.md`).

**Phase 18 — Chat → Cross-App Action** *(closed 2026-04-30 — code complete; cold-install demo deferred per operator API-key constraint)*

Chat-first reinterpretation per CONTEXT D-01..D-21. Original "JARVIS Push-to-Talk → Cross-App Action" PTT/voice path deferred to v1.3 (`18-DEFERRAL.md`). Phase 18 ships text-chat → intent classifier → 3-tier dispatch → consent → outbound write → ego post-processor.

- 4 new Rust modules: `ego.rs` (refusal regex matcher with 9 patterns + disjunction post-check + retry orchestrator), `intent_router.rs` (heuristic verb × service classifier returning `(IntentClass, ArgsBag)`), `jarvis_dispatch.rs` (3-tier fan-out: native-tentacle FIRST → MCP → native_tools), `consent.rs` (SQLite `consent_decisions` table + tokio::oneshot one-shot consent flow).
- `ecosystem.rs` extension: `WRITE_UNLOCKS: HashMap<tentacle, Instant>` + `WriteScope` RAII guard with 30s TTL — per-tentacle observe-only flip behind explicit consent (M-03 v1.1 lock first-time exercised).
- `self_upgrade::CapabilityGap` extended with `kind: Runtime | Integration` discriminator + 5 Integration entries (slack/github/gmail/calendar/linear outbound) routing to "Connect via Integrations tab → {Service}".
- 3 outbound tentacles: `slack_outbound.rs` (MCP-first + HTTP fallback), `github_outbound.rs` (PR comment + issue create), `gmail_outbound.rs` (base64url MIME + `users.messages.send`).
- `commands.rs` ego intercept wired at line 1539 in tool-loop branch; fast-streaming branch (line 1166) documented as ego-blind known gap (deferred to v1.3 — accumulator refactor).
- Frontend: `JarvisPill.tsx` (4 D-18 states), `ConsentDialog.tsx` (3 buttons: Allow once / Allow always / Deny), `MessageList` + `ChatPanel` integration via `BLADE_EVENTS.JARVIS_INTERCEPT` + `CONSENT_REQUEST` per D-13.
- `research/questions.md` Q1 (browser-harness) closed with verdict: always require explicit consent for browser-harness installs (D-20).
- 87/87 Phase 18 unit tests green; tsc + verify:all + verify:emit-policy + verify:wiring-audit-shape all green on first run (Phase 17 gate-miss patterns preempted in Wave 0 per Plan 18-04).
- Operator deferral: cold-install runtime demo (JARVIS-12 e2e) deferred — operator lacks API keys for Linear/Slack/Gmail/GitHub. Code path is architecturally complete and unit-test covered.

**Phase 19 — Operator UAT Close** *(DEFERRED to v1.3 under chat-first pivot)*

Pure UAT/screenshot phase; operator lacks bandwidth + integration credentials. All 12 UAT-XX requirements roll forward to v1.3 dedicated UAT phase. v1.1 milestone-audit stays `tech_debt`. See `.planning/phases/19-operator-uat-close/19-DEFERRAL.md` for full carry-forward log.

**Phase 20 — Polish + Verify Pass** *(this entry)*
- POLISH-01: `npm run verify:all` 31/31 sub-gates green.
- POLISH-02: `cargo check` exit 0 (1 pre-existing `consent_check_at` testability-seam warning — not a regression).
- POLISH-03: `npx tsc --noEmit` exit 0.
- POLISH-04: this CHANGELOG entry.
- POLISH-05: `milestones/v1.2-MILESTONE-AUDIT.md` (mirrors v1.1 audit pattern).
- POLISH-06: phase dirs 16–20 archived to `milestones/v1.2-phases/`.

### Deferred (v1.3+)
- JARVIS-01 (PTT global hotkey) + JARVIS-02 (Whisper STT integration with dispatcher) — `18-DEFERRAL.md`.
- D-04 Step 2 (LLM-fallback for ambiguous intent classification) — heuristic-only acceptable for v1.2; `18-DEFERRAL.md` path B.
- All 12 UAT-XX requirements (Phase 19 carry-overs) — `19-DEFERRAL.md`.
- Phase 17 Doctor pane runtime UI-polish UAT (16-box UI-SPEC § 17 checklist + screenshots) — `17-07-SUMMARY.md`.
- Phase 18 cold-install runtime demo (JARVIS-12 e2e) — `18-12-SUMMARY.md`.
- Fast-streaming ego intercept gap (`commands.rs:1166` accumulator refactor) — Phase 18 known gap.

### Deleted (v1.2)
- `.planning/HANDOFF-TO-MAC.md` — intentionally deleted in v1.2 close (Mac smoke checkpoints M-01..M-46 absorbed into v1.3 carry-overs). Reconciles UAT-12 deletion intent without restoring the file.

---

### Added (V1 — BLADE Skin Rebuild)

**Phase 0 — Pre-Rebuild Audit**
- `.planning/RECOVERY_LOG.md` codifying QuickAsk bridge contract, Voice Orb OpenClaw state machine, onboarding Rust call sequence.
- Full `emit_all` → `emit_to` migration plan (WIRE-08) classifying every Rust emitter as cross-window (keep) or single-window (convert).

**Phase 1 — Foundation**
- 5 HTML entry points wired in Vite (`index.html`, `overlay.html`, `hud.html`, `ghost_overlay.html`, `quickask.html`).
- Design-token system: `tokens.css` + `glass.css` + `motion.css` + `typography.css` + `layout.css`.
- 9 primitive components: Button, Card, GlassPanel, Input, Pill, Badge, GlassSpinner, Dialog, ComingSoonSkeleton.
- Typed Tauri wrapper pattern (`src/lib/tauri/*.ts`) with `invokeTyped` generic + JSDoc `@see` back-links to Rust.
- `useTauriEvent` hook + `BLADE_EVENTS` registry for type-safe event subscriptions.
- Route registry + migration ledger (82 rows, one per shipped route).
- 14 verify scripts: entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes, phase6-rust, phase7-rust, phase8-rust.
- WCAG AA contrast audit baseline via `scripts/audit-contrast.mjs` (≥ 4.5:1 on 5 wallpapers).
- WIRE-08 refactor across 66 Rust modules (emit_all → emit_to where single-window).

**Phase 2 — Onboarding + Main Shell**
- OnboardingFlow: ProviderPicker → KeyEntry → DeepScan ring → PersonaQuestions (5).
- MainShell (<220 LOC): TitleBar + NavRail + CommandPalette + RouteSlot + GlobalOverlays + BackendToastBridge.
- ToastContext with aria-live viewport + auto-dismiss (≤7s).
- `⌘K` command palette + `⌘1 / ⌘, / ⌘/ / ⌘[ / ⌘]` global shortcuts.
- Native `<dialog>` primitive with built-in focus trap + Escape close.

**Phase 3 — Dashboard + Chat + Settings**
- 6 Rust events wired: `hormone_update`, `blade_message_start`, `blade_thinking_chunk`, `blade_token_ratio`, `blade_quickask_bridged`, `blade_agent_event`.
- Dashboard: `RightNowHero` (perception feed) + `AmbientStrip` (hormone-driven gradient).
- Chat: `ChatProvider` with rAF-flushed token streaming, `ToolApprovalDialog` (500ms delay), `CompactingIndicator`, reasoning-chunk collapsible section.
- Settings: 10 panes (providers, voice, wake-word, god-mode tier, privacy, MCP, integrations, appearance, data, about).

**Phase 4 — Overlay Windows**
- QuickAsk bridge (Cmd+Option+Space) — full round-trip into Main window conversation.
- Voice Orb 4-state machine with OpenClaw math; phases: idle / listening / thinking / speaking.
- Ghost Mode overlay with OS content-protection flag — invisible to screen capture.
- HUD bar with notch-aware positioning (37px clearance on MacBook notch) + 4 chips.
- Cross-window `ChatProvider` hoist at MainShell level for QuickAskBridge `injectUserMessage`.

**Phase 5 — Agents + Knowledge**
- Agents cluster (10 requirements): AgentDashboard, SwarmView, AgentDetail, AgentTeam, AgentFactory, AgentTimeline, BackgroundAgents, AgentPixelWorld, TaskAgents. Typed wrapper `src/lib/tauri/agents.ts`.
- Knowledge cluster (10 requirements): KnowledgeBase (3-group search), KnowledgeGraph (polar layout), ScreenTimeline, RewindTimeline, MemoryPalace, LiveNotes, DailyLog, ConversationInsights, CodebaseExplorer. Typed wrapper `src/lib/tauri/knowledge.ts`.
- rAF-flushed agent-event stream with dropped-frame monitoring.

**Phase 6 — Life OS + Identity**
- Life OS cluster (10 requirements): Health, Finance, Goal, Habit, Meetings (with MeetingDetail), SocialGraph, Predictions, EmotionalIntel, Accountability. Typed wrapper `src/lib/tauri/life_os.ts`.
- Identity cluster (9 requirements): CharacterBible, SoulView, PersonaView, ReasoningView, NegotiationView, SidecarView (Kali), ContextEngineView + `EditSectionDialog`. Typed wrapper `src/lib/tauri/identity.ts`.
- Finance: CSV import + auto-categorize; thumbs-up → persona trait round-trip.

**Phase 7 — Dev Tools + Admin**
- Dev-tools cluster (11 requirements): Terminal, FileBrowser (+Tree), GitPanel, Canvas, WorkflowBuilder + WorkflowDetail, WebAutomation, EmailAssistant, DocumentGenerator, CodeSandbox, ComputerUse. Typed wrapper `src/lib/tauri/dev_tools.ts`.
- Admin cluster (10 requirements): Analytics, CapabilityReports, DecisionLog, SecurityDashboard (+Alerts/Pentest/Policies/Scans tabs), Temporal, Diagnostics (+Sysadmin tab), IntegrationStatus, McpSettings, ModelComparison, KeyVault, Reports. Typed wrapper `src/lib/tauri/admin.ts`.
- Pentest/danger-zone Dialog gating pattern.

**Phase 8 — Body Visualization + Hive Mesh**
- Body cluster (7 requirements): BodyMap (12-card grid), BodySystemDetail (5 system branches), HormoneBus (real-time feeds), OrganRegistry (autonomy sliders), DNA (4-tab identity editor), WorldModel (git/processes/ports/files/todos). Typed wrapper `src/lib/tauri/body.ts`.
- Hive cluster (6 requirements): HiveMesh (10-tentacle grid), TentacleDetail, AutonomyControls (global matrix), ApprovalQueue (decision approval), AiDelegate. Typed wrapper `src/lib/tauri/hive.ts`.
- 40 body+hive Rust commands registered; `verify:phase8-rust` defensive surface guard.

**Phase 9 — Polish Pass**
- **Rust backfill (3 commands closing Phase 8 deferrals):**
  - `hive::hive_reject_decision` — ApprovalQueue client-side Dismiss → real backend reject (closed D-205).
  - `dna::dna_set_identity` — DNA "Save" button persists to identity.md (closed D-203).
  - `character::delegate_feedback` — AiDelegate per-decision Feedback persists (closed D-205).
- **3 new primitives:**
  - `ErrorBoundary` — class-based React boundary wrapping every route in MainShell.RouteSlot; recovery UX with Reset / Back to dashboard / Copy error.
  - `EmptyState` — token-light GlassPanel tier-1 with icon + label + description + CTA; swapped into 41 zero-data surfaces.
  - `ListSkeleton` — shimmer-animated 5-row placeholder replacing GlassSpinner on async-list panels; `prefers-reduced-motion` disables shimmer.
- **Motion + a11y:**
  - `motion-a11y.css` — `prefers-reduced-motion: reduce` collapses every `--dur-*` token to 0.01ms + disables `@keyframes spin`.
  - `motion-entrance.css` — `.list-entrance` class for consistent fade-in/y-translate on listings.
  - A11y sweep on shell + hud + chat + settings icon-only buttons (aria-label audit + fix).
- **UX:**
  - `⌘?` shortcut help panel — 2-column grid of global + route-scoped shortcuts.
- **Verify scripts (4 new, extends verify:all to 18 composed gates):**
  - `verify-aria-icon-buttons.mjs` — scans `.tsx` for icon-only buttons missing `aria-label`.
  - `verify-motion-tokens.sh` — grep guard against rogue `transition: … linear`.
  - `verify-tokens-consistency.mjs` — flags `padding/margin/gap/font-size` px values outside the BLADE spacing ladder.
  - `verify-empty-state-coverage.sh` — asserts 41 D-217 coverage files carry EmptyState.
- **Playwright specs (5 new):**
  - `perf-dashboard-fp.spec.ts` (250ms CI budget; 200ms metal at M-41).
  - `perf-chat-stream.spec.ts` (20ms CI budget; 16ms metal at M-42).
  - `perf-agent-timeline.spec.ts` (50ms frame delta CI; 60fps metal at M-43).
  - `a11y-sweep.spec.ts` — prefers-reduced-motion + `⌘?` panel falsifiers.
  - `error-boundary-recovery.spec.ts` — simulated `world_get_state` crash → role=alert → Back-to-dashboard clears.
- **Prod build verification:**
  - `verify-html-entries.mjs --prod` flag validates `dist/` after Vite build (SC-1 frontend falsifier).
  - Vite frontend build passes in 5.84s with all 5 HTML entries; Tauri macOS bundle deferred to Mac-smoke M-44.

### Changed

- Full frontend skin rebuild from `src.bak` with zero imports (D-17 enforced) — every component re-implemented against Phase 1 primitives + tokens; no legacy code carried forward.
- `verify:html-entries` npm script pinned to `--prod` mode so `.github/workflows/build.yml` validates `dist/` after `npm run build` (Phase 9 09-05 Rule 2 deviation).

### Fixed

- **Phase 8 documented deferrals closed** (Plan 09-01):
  - ApprovalQueue reject — client-side dismiss replaced with `hive_reject_decision` backend call.
  - DNA write — Save button now persists via `dna_set_identity`.
  - AiDelegate feedback — per-decision Feedback now writes to the character.rs feedback log via `delegate_feedback`.

### Deferred to v1.1

- `save_config_cmd` unification — `save_config_field` already covers frontend save path; helper/command collapse is a refactor candidate.
- Per-pane error boundaries — Phase 9 ships per-route MVP; sub-pane isolation is a polish refinement.
- Mobile / responsive layouts — BLADE V1 is desktop-first.
- `ComingSoonSkeleton` cards in Canvas (Phase 7 Plan 07-03) + `ApprovalQueue` Dismiss (Phase 8) — real features pending.
- SVG anatomical body diagram (Phase 8 D-201) — 12-card grid shipped as MVP.
- HiveMesh DAG visualization — tentacle grid shipped as MVP.
- WorldModel git operations — read-only state surface shipped; write operations deferred.
- Full axe-core a11y audit — targeted sweep shipped (icon-only buttons, reduced-motion, focus trap); per-component axe test suite is post-V1.
- High-contrast mode theme (not in POL-01..10 scope).
- Storybook / component gallery — `src/features/dev/Primitives.tsx` serves as dev showcase.
- `.planning/RETROSPECTIVE.md` — post-V1 operator task after ship + stabilization window.
- Version bump to 1.0.0 + tag — gated on operator Mac-smoke sign-off per [D-227](.planning/phases/09-polish/09-CONTEXT.md#d-227).

---

## [0.7.9] — 2026-04-18

Initial V1 candidate tag. Version stays at 0.7.9 until operator Mac-smoke
checkpoints M-41..M-46 pass and the operator approves the 1.0.0 cutover (per
D-227). The sequence operators run after approval:

1. Bump `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` → `1.0.0`.
2. Move `[Unreleased]` → `[1.0.0] — YYYY-MM-DD` in this file.
3. `git commit -m "chore: bump v1.0.0 — V1 shipped"`.
4. `git tag v1.0.0`.
5. `npm run release:prepare-updater` (if release pipeline wired).
6. Push tag + trigger GitHub Actions release workflow.

---

## Verify-Gate Evolution

| Phase | Gates added | Total |
|-------|-------------|-------|
| Phase 1 | 6 (entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba) | 6 |
| Phase 4 | 3 (ghost-no-cursor, orb-rgba, hud-chip-count) | 9 |
| Phase 5 | 2 (phase5-rust, feature-cluster-routes) | 11 |
| Phase 6 | 1 (phase6-rust) | 12 |
| Phase 7 | 1 (phase7-rust) | 13 |
| Phase 8 | 1 (phase8-rust) | 14 |
| Phase 9 | 4 (aria-icon-buttons, motion-tokens, tokens-consistency, empty-state-coverage) | **18** |

Three additional scripts are NOT in `verify:all`: `verify:html-entries` / `verify:dev-html-entries` / `verify:prod-entries` — these require a build artifact (`dist/`) that only exists after `npm run build` and are wired into the GitHub Actions pipeline separately.

---

## Mac-Smoke Checkpoint Queue (Operator Handoff)

Phase 9 closes the V1 substrate build in the sandbox. Three bundled Mac-session
checkpoint groups remain queued on the brother's Mac (see `.planning/HANDOFF-TO-MAC.md`):

1. **Phase 1 WCAG M-WCAG** — on-wallpaper contrast eyeball across 5 wallpapers.
2. **Phases 2–8 manual smoke (M-01..M-40)** — route parity, 5-window launch, shortcut fallbacks, content protection, hormone-bus plumbing.
3. **Phase 9 Mac smoke (M-41..M-46)** — dashboard FP ≤200ms, chat render ≤16ms, agent timeline 60fps, Tauri macOS bundle, prefers-reduced-motion system toggle, ⌘? panel focus return.

When M-41..M-46 pass, operator decides on `1.0.0` cutover per D-227.

---

*Maintained since 2026-04-18. Project root: this repository.*
