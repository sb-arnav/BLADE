# Changelog

All notable changes to BLADE are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

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
