# BLADE Migration Ledger

**Seeded:** 2026-04-18 (Plan 01-08 auto-generated via `scripts/seed-migration-ledger.mjs`)
**Discipline:** D-27 + D-28 + P-03.
**Enforcement:** CI via `scripts/verify-migration-ledger.mjs` (Plan 09), not reviewer-required PR gate.

## Invariants

1. **No old route removed before its new component ships.** Status `Pending` must flip to `Shipped` before any `src.bak` reference is deleted or the route-id is renamed.
2. **`cross_refs` column MUST be cleared before flipping `status` to `Shipped`.** All consumers of the old path must be updated first.
3. **Adding a new route appends a row.** FOUND-08 acceptance: 1 file + 1 entry. Re-run `npm run seed:ledger` after editing any `src/features/<cluster>/index.tsx` to refresh the table; existing status values are preserved.
4. **`N/A (new)`** in the `src.bak_path` column is expected for routes introduced by the rebuild (e.g. `reports`, `primitives`, `wrapper-smoke`).

## Rows

| route_id | src.bak_path | new_component | section | phase | status | cross_refs | notes |
|----------|--------------|---------------|---------|-------|--------|------------|-------|
| analytics | src.bak/components/Analytics.tsx | src/features/admin/Analytics.tsx | admin | 7 | Pending | – |  |
| capability-reports | src.bak/components/CapabilityReports.tsx | src/features/admin/CapabilityReports.tsx | admin | 7 | Pending | – |  |
| decision-log | src.bak/components/DecisionLog.tsx | src/features/admin/DecisionLog.tsx | admin | 7 | Pending | – |  |
| diagnostics | src.bak/components/Diagnostics.tsx | src/features/admin/Diagnostics.tsx | admin | 7 | Pending | – |  |
| integration-status | src.bak/components/IntegrationStatus.tsx | src/features/admin/IntegrationStatus.tsx | admin | 7 | Pending | – |  |
| key-vault | src.bak/components/KeyVault.tsx | src/features/admin/KeyVault.tsx | admin | 7 | Pending | – |  |
| mcp-settings | N/A (new) | src/features/admin/McpSettings.tsx | admin | 7 | Pending | – |  |
| model-comparison | src.bak/components/ModelComparison.tsx | src/features/admin/ModelComparison.tsx | admin | 7 | Pending | – |  |
| reports | N/A (new — backend capability_gap_detected target) | src/features/admin/Reports.tsx | admin | 7 | Pending | – | NEW stub — backend pushes via capability_gap_detected → openRoute("reports") (P-03) |
| security-dashboard | src.bak/components/SecurityDashboard.tsx | src/features/admin/Security.tsx | admin | 7 | Pending | – |  |
| temporal | src.bak/components/TemporalPanel.tsx | src/features/admin/Temporal.tsx | admin | 7 | Pending | – |  |
| agent-detail | src.bak/components/AgentDetail.tsx | src/features/agents/AgentDetail.tsx | agents | 5 | Pending | – |  |
| agent-factory | src.bak/components/AgentFactory.tsx | src/features/agents/AgentFactory.tsx | agents | 5 | Pending | – |  |
| agent-pixel-world | src.bak/components/AgentPixelWorld.tsx | src/features/agents/AgentPixelWorld.tsx | agents | 5 | Pending | – |  |
| agent-team | src.bak/components/AgentTeamPanel.tsx | src/features/agents/AgentTeam.tsx | agents | 5 | Pending | – |  |
| agent-timeline | src.bak/components/AgentTimeline.tsx | src/features/agents/AgentTimeline.tsx | agents | 5 | Pending | – |  |
| agents | src.bak/components/AgentDashboard.tsx | src/features/agents/Agents.tsx | agents | 5 | Pending | – |  |
| background-agents | src.bak/components/BackgroundAgentsPanel.tsx | src/features/agents/BackgroundAgents.tsx | agents | 5 | Pending | – |  |
| swarm-view | src.bak/components/SwarmView.tsx | src/features/agents/Swarm.tsx | agents | 5 | Pending | – |  |
| task-agents | src.bak/components/ManagedAgentPanel.tsx | src/features/agents/TaskAgents.tsx | agents | 5 | Pending | – |  |
| agents-swarm | N/A (new — Phase 11 Plan 11-05 capability-gap surface) | src/features/agents/SwarmView.tsx | agents | 11 | Pending | – | PROV-08 tools capability; palette-hidden route (useCapability gate) |
| body-map | N/A (new — Phase 8 body visualization) | src/features/body/BodyMap.tsx | body | 8 | Pending | – |  |
| body-system-detail | N/A (new — Phase 8 body visualization) | src/features/body/BodySystemDetail.tsx | body | 8 | Pending | – |  |
| dna | N/A (new — Phase 8 body visualization) | src/features/body/DNA.tsx | body | 8 | Pending | – |  |
| hormone-bus | N/A (new — Phase 8 body visualization) | src/features/body/HormoneBus.tsx | body | 8 | Pending | – |  |
| organ-registry | N/A (new — Phase 8 body visualization) | src/features/body/OrganRegistry.tsx | body | 8 | Pending | – |  |
| world-model | N/A (new — Phase 8 body visualization) | src/features/body/WorldModel.tsx | body | 8 | Pending | – |  |
| onboarding | src.bak/components/OnboardingFlow.tsx | src/features/onboarding/Onboarding.tsx | core | 2 | Pending | – | First-run flow; palette-hidden |
| chat | src.bak/components/ChatWindow.tsx | src/features/chat/Chat.tsx | core | 3 | Pending | – | Streaming; tool approval dialog |
| dashboard | src.bak/components/Dashboard.tsx | src/features/dashboard/Dashboard.tsx | core | 3 | Pending | – | Default route; P-01 gate surface |
| settings | src.bak/components/Settings.tsx | src/features/settings/SettingsShell.tsx | core | 3 | Shipped | – | Tabbed shell — 10 child panes (D-79) |
| settings-about | src.bak/components/Settings.tsx | src/features/settings/panes/AboutPane.tsx | core | 3 | Shipped | – | SET-10 |
| settings-advanced | src.bak/components/Settings.tsx | src/features/settings/Advanced.tsx | core | 3 | Deferred | – | Phase 3 D-79 dropped from top-level tabs; reachable via palette only |
| settings-ambient | src.bak/components/Settings.tsx | src/features/settings/panes/PersonalityPane.tsx | core | 3 | Deferred | settings-personality | Renamed to settings-personality per D-79 |
| settings-autonomy | src.bak/components/Settings.tsx | src/features/settings/Autonomy.tsx | core | 3 | Deferred | – | Phase 3 D-79 dropped from top-level tabs; reachable via palette only |
| settings-ghost | src.bak/components/Settings.tsx | src/features/settings/Ghost.tsx | core | 3 | Deferred | – | Phase 3 D-79 dropped from top-level tabs; reachable via palette only |
| settings-integrations | src.bak/components/IntegrationHub.tsx | src/features/settings/panes/IoTPane.tsx | core | 3 | Deferred | settings-iot | Renamed to settings-iot per D-79 |
| settings-providers | src.bak/components/Settings.tsx | src/features/settings/panes/ProvidersPane.tsx | core | 3 | Shipped | – | SET-01 |
| settings-shortcuts | src.bak/components/Settings.tsx | src/features/settings/Shortcuts.tsx | core | 3 | Deferred | – | Phase 3 D-79 dropped from top-level tabs; reachable via palette only |
| settings-voice | src.bak/components/Settings.tsx | src/features/settings/panes/VoicePane.tsx | core | 3 | Shipped | – | SET-04 |
| settings-models | N/A (new — D-79 + ROADMAP SET-02) | src/features/settings/panes/ModelsPane.tsx | core | 3 | Shipped | – | SET-02 |
| settings-routing | N/A (new — D-79 + ROADMAP SET-03) | src/features/settings/panes/RoutingPane.tsx | core | 3 | Shipped | – | SET-03 |
| settings-personality | src.bak/components/Settings.tsx | src/features/settings/panes/PersonalityPane.tsx | core | 3 | Shipped | settings-ambient | SET-05 (renamed from settings-ambient per D-79) |
| settings-appearance | N/A (new — D-79 + ROADMAP SET-06) | src/features/settings/panes/AppearancePane.tsx | core | 3 | Shipped | – | SET-06 |
| settings-iot | src.bak/components/IntegrationHub.tsx | src/features/settings/panes/IoTPane.tsx | core | 3 | Shipped | settings-integrations | SET-07 (renamed from settings-integrations per D-79) |
| settings-privacy | N/A (new — D-79 + ROADMAP SET-08) | src/features/settings/panes/PrivacyPane.tsx | core | 3 | Shipped | – | SET-08 |
| settings-diagnostics | N/A (new — D-79 + ROADMAP SET-09) | src/features/settings/panes/DiagnosticsEntryPane.tsx | core | 3 | Shipped | – | SET-09 — DEV opens diagnostics-dev; PROD shows Phase 7 admin notice |
| quickask | N/A (new — Phase 11 Plan 11-05 capability-gap surface) | src/features/quickask/QuickAskView.tsx | core | 11 | Pending | – | PROV-07 vision capability; palette-hidden main-window route (useCapability gate). Existing `quickask` Tauri window unchanged. |
| voice-orb | N/A (new — Phase 11 Plan 11-05 capability-gap surface) | src/features/voice-orb/VoiceOrbView.tsx | core | 11 | Pending | – | PROV-08 audio capability; palette-hidden main-window route (useCapability gate). Existing voice orb overlay window unchanged. |
| meeting-ghost | N/A (new — Phase 11 Plan 11-05 capability-gap surface) | src/features/ghost/MeetingGhostView.tsx | core | 11 | Pending | – | PROV-08 audio capability; palette-hidden main-window route (useCapability gate). Existing ghost overlay window unchanged. |
| diagnostics-dev | src.bak/components/Diagnostics.tsx | src/features/dev/Diagnostics.tsx | dev | 1 | Shipped | – | DEV-only listener counter + perf marks; palette-hidden |
| primitives | N/A (new — dev showcase) | src/features/dev/Primitives.tsx | dev | 1 | Shipped | – | DEV-only showcase; palette-hidden |
| wrapper-smoke | N/A (new — P-04 harness) | src/features/dev/WrapperSmoke.tsx | dev | 1 | Shipped | – | DEV-only P-04 harness; palette-hidden |
| canvas | src.bak/components/Canvas.tsx | src/features/dev-tools/Canvas.tsx | dev | 7 | Pending | – |  |
| code-sandbox | src.bak/components/CodeSandboxView.tsx | src/features/dev-tools/Sandbox.tsx | dev | 7 | Pending | – |  |
| computer-use | src.bak/components/ComputerUsePanel.tsx | src/features/dev-tools/ComputerUse.tsx | dev | 7 | Pending | – |  |
| document-generator | src.bak/components/DocumentGenerator.tsx | src/features/dev-tools/Documents.tsx | dev | 7 | Pending | – |  |
| email-assistant | src.bak/components/EmailAssistant.tsx | src/features/dev-tools/EmailAssistant.tsx | dev | 7 | Pending | – |  |
| file-browser | src.bak/components/FileBrowser.tsx | src/features/dev-tools/FileBrowser.tsx | dev | 7 | Pending | – |  |
| git-panel | N/A (new) | src/features/dev-tools/Git.tsx | dev | 7 | Pending | – |  |
| terminal | src.bak/components/Terminal.tsx | src/features/dev-tools/Terminal.tsx | dev | 7 | Pending | – |  |
| web-automation | src.bak/components/WebAutomation.tsx | src/features/dev-tools/WebAutomation.tsx | dev | 7 | Pending | – |  |
| workflow-builder | src.bak/components/WorkflowBuilder.tsx | src/features/dev-tools/Workflows.tsx | dev | 7 | Pending | – |  |
| hive-ai-delegate | src.bak/components/HiveView.tsx | src/features/hive/AIDelegate.tsx | hive | 8 | Pending | – |  |
| hive-approval-queue | src.bak/components/HiveView.tsx | src/features/hive/ApprovalQueue.tsx | hive | 8 | Pending | – |  |
| hive-autonomy | src.bak/components/HiveView.tsx | src/features/hive/AutonomyControls.tsx | hive | 8 | Pending | – |  |
| hive-mesh | src.bak/components/HiveView.tsx | src/features/hive/Hive.tsx | hive | 8 | Pending | – |  |
| hive-tentacle | src.bak/components/TentacleDetail.tsx | src/features/hive/TentacleDetail.tsx | hive | 8 | Pending | – |  |
| character | src.bak/components/CharacterBible.tsx | src/features/identity/CharacterBible.tsx | identity | 6 | Pending | – |  |
| context-engine | src.bak/components/ContextEngineView.tsx | src/features/identity/ContextEngine.tsx | identity | 6 | Pending | – |  |
| negotiation | src.bak/components/NegotiationView.tsx | src/features/identity/Negotiation.tsx | identity | 6 | Pending | – |  |
| persona | src.bak/components/PersonaView.tsx | src/features/identity/Persona.tsx | identity | 6 | Pending | – |  |
| reasoning | src.bak/components/ReasoningView.tsx | src/features/identity/Reasoning.tsx | identity | 6 | Pending | – |  |
| sidecar | src.bak/components/SidecarView.tsx | src/features/identity/Sidecar.tsx | identity | 6 | Pending | – |  |
| soul | src.bak/components/SoulView.tsx | src/features/identity/Soul.tsx | identity | 6 | Pending | – |  |
| codebase-explorer | src.bak/components/CodebaseExplorer.tsx | src/features/knowledge/CodebaseExplorer.tsx | knowledge | 5 | Pending | – |  |
| conversation-insights | src.bak/components/ConversationInsightsPanel.tsx | src/features/knowledge/ConversationInsights.tsx | knowledge | 5 | Pending | – |  |
| daily-log | src.bak/components/DailyLogPanel.tsx | src/features/knowledge/DailyLog.tsx | knowledge | 5 | Pending | – |  |
| knowledge-base | src.bak/components/KnowledgeBase.tsx | src/features/knowledge/KnowledgeBase.tsx | knowledge | 5 | Pending | – |  |
| knowledge-graph | src.bak/components/KnowledgeBase.tsx | src/features/knowledge/KnowledgeGraph.tsx | knowledge | 5 | Pending | – |  |
| live-notes | src.bak/components/LiveNotes.tsx | src/features/knowledge/LiveNotes.tsx | knowledge | 5 | Pending | – |  |
| memory-palace | N/A (new) | src/features/knowledge/MemoryPalace.tsx | knowledge | 5 | Pending | – |  |
| rewind-timeline | src.bak/components/RewindTimeline.tsx | src/features/knowledge/Rewind.tsx | knowledge | 5 | Pending | – |  |
| screen-timeline | src.bak/components/ScreenTimeline.tsx | src/features/knowledge/ScreenTimeline.tsx | knowledge | 5 | Pending | – |  |
| accountability | src.bak/components/AccountabilityView.tsx | src/features/life-os/Accountability.tsx | life | 6 | Pending | – |  |
| emotional-intel | src.bak/components/EmotionalIntelligenceView.tsx | src/features/life-os/EmotionalIntelligence.tsx | life | 6 | Pending | – |  |
| finance | src.bak/components/FinanceView.tsx | src/features/life-os/Finance.tsx | life | 6 | Pending | – |  |
| goals | src.bak/components/GoalView.tsx | src/features/life-os/Goals.tsx | life | 6 | Pending | – |  |
| habits | src.bak/components/HabitView.tsx | src/features/life-os/Habits.tsx | life | 6 | Pending | – |  |
| health | src.bak/components/HealthPanel.tsx | src/features/life-os/Health.tsx | life | 6 | Pending | – |  |
| meetings | src.bak/components/MeetingView.tsx | src/features/life-os/Meetings.tsx | life | 6 | Pending | – |  |
| predictions | src.bak/components/PredictionView.tsx | src/features/life-os/Predictions.tsx | life | 6 | Pending | – |  |
| social-graph | src.bak/components/SocialGraphView.tsx | src/features/life-os/SocialGraph.tsx | life | 6 | Pending | – |  |

## Totals

- **Routes tracked:** 86
- **Pending:** 83
- **Shipped:** 3
- **Deferred:** 0
- **Source:** 13 feature clusters under `src/features/` (`admin`, `agents`, `body`, `chat`, `dashboard`, `dev`, `dev-tools`, `hive`, `identity`, `knowledge`, `life-os`, `onboarding`, `settings`)

## Re-seed

```bash
npm run seed:ledger
# or
node scripts/seed-migration-ledger.mjs
```
