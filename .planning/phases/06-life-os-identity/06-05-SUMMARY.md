---
phase: 06-life-os-identity
plan: 05
subsystem: identity-frontend
tags: [identity, soul, persona, character-bible, negotiation, iden-01, iden-02, iden-03, iden-04, sc-3, sc-4]
requires:
  - Plan 06-02 wrapper scaffolding (src/lib/tauri/identity.ts, src/features/identity/types.ts, placeholders, identity.css base)
  - Plan 06-01 usePrefs extension (identity.activeTab, identity.persona.expandedTrait)
  - Phase 5 status tokens (--status-running/success/error) reused verbatim
  - Phase 1 Dialog + Button + Input + Pill + Badge + GlassPanel + GlassSpinner primitives
  - Phase 2 ToastContext (useToast().show)
  - Phase 2 RouterContext (useRouterCtx / openRoute)
provides:
  - Real Identity-A surfaces (SoulView, PersonaView, CharacterBible, NegotiationView) — SC-3 met, SC-4 pragmatic
  - Shared EditSectionDialog sub-component for identity-data edits (reusable by Plan 06-06)
  - identity-rich-a.css scoped partial — 40+ rules spanning shared identity-section, state cards, deferred cards, trait cards, relationship bars, model dossier, people grid, negotiation layout/rounds/tools
affects:
  - NavRail + palette routes for /soul, /persona, /character, /negotiation now render real surfaces (Plan 06-02 placeholders gone)
  - No other-lane files — 06-03 / 06-04 / 06-06 worktrees are untouched
tech-stack:
  added: []  # no new deps
  patterns:
    - D-153 SoulView 3-tab + explicit-save flow
    - D-154 PersonaView 4-tab; tab-key collision avoided via prefix namespacing (soul:* vs persona:*)
    - D-155 honest deferred card for trait evolution log — no faked data
    - D-156 NegotiationView 4-tab with plain-text debate rows (no chat-bubble reuse)
    - D-163 per-route file layout
    - D-164 cluster-owned CSS file appended (identity-rich-a.css); identity.css base untouched
    - D-165 dotted-key pref conventions
    - Pattern §3 tabbed surface (PersonaView + NegotiationView)
    - Pattern §4 edit-with-Dialog (EditSectionDialog; Trait custom Dialog with slider)
key-files:
  created:
    - src/features/identity/EditSectionDialog.tsx
    - src/features/identity/identity-rich-a.css
  modified:
    - src/features/identity/SoulView.tsx  (placeholder → real 3-tab surface)
    - src/features/identity/PersonaView.tsx  (placeholder → real 4-tab surface)
    - src/features/identity/CharacterBible.tsx  (placeholder → consolidated text + deferral + editors)
    - src/features/identity/NegotiationView.tsx  (placeholder → 4-tab debate/scenarios/analyze/tools)
decisions:
  - SoulView routes bible-section edits through updateCharacterSection (character.rs), not soulUpdateBibleSection — the wrapper JSDoc confirms soul_update_bible_section delegates there anyway. Soul-layer audit trail remains available for other consumers but SoulView doesn't add an extra hop.
  - PersonaView + SoulView both touch prefs['identity.activeTab'] but use distinct prefix namespaces ('persona:' / 'soul:'). Tab keys that fail the expected prefix fall back to each surface's default, so cross-surface navigation is clean.
  - NegotiationView deliberately does NOT persist its tab state to prefs — it would either collide with PersonaView (same key) or expand the pref surface for low value. Local useState only; resets to 'debate' on each mount.
  - Trait-edit Dialog is CUSTOM inline (slider + textarea), separate from EditSectionDialog (text-only). EditSectionDialog stays simple because the shared case is bible/soul/character-section prose.
  - personaEstimateMood is called on User Model tab mount with empty recentMessages, current-hour timeOfDay, 0 streakMinutes — documented simplification; the Rust implementation tolerates empty messages and falls back to time-of-day heuristics. If a recent-message feed becomes available (e.g. Phase 8 chat event subscription), this call should be revisited.
  - CharacterBible renders sections as a consolidated scrollable `<pre>` block (joined '## Label\n\nbody') PLUS a per-section Edit grid below. The consolidated block is the primary content per SC-3 wording; the Edit grid mirrors SoulView's Bible tab so edits are one click from anywhere.
metrics:
  duration-minutes: ~60
  completed-date: 2026-04-18
  tasks-completed: 3
  commits: 3
  files-created: 2
  files-modified: 4
  lines-added-net: ~3300
---

# Phase 6 Plan 06-05: Identity Subset A — SoulView, PersonaView, CharacterBible, NegotiationView Summary

Shipped the four Identity-A routes with real, backend-wired bodies plus a shared EditSectionDialog and a scoped CSS partial. SC-3 for Identity is met verbatim (SoulView displays loaded identity-document content). SC-4 is met pragmatically per D-155: the chat thumbs-up → trait update round-trip is live (Phase 3), and CharacterBible carries an honest deferral card for the historical log view pointing operators at /persona for observable round-trip evidence (M-25).

## Requirement Coverage

| Req     | Surface                   | Wrappers consumed                                                                                                                                                                                 | Testids anchor |
|---------|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------|
| IDEN-01 | SoulView (/soul)          | soulGetState, getCharacterBible, getUserProfile, bladeGetSoul, soulRefreshBible, soulTakeSnapshot, soulDeletePreference, updateCharacterSection                                                 | soul-view-root, soul-bible-content, soul-tab, soul-state-card, soul-profile-content, soul-preferences-content, soul-refresh-bible, soul-take-snapshot |
| IDEN-02 | PersonaView (/persona)    | personaGetTraits, personaUpdateTrait, personaAnalyzeNow, personaGetRelationship, getUserModel, getExpertiseMap, personaEstimateMood, predictNextNeedCmd, peopleList, peopleUpsert, peopleSuggestReplyStyle | persona-view-root, persona-tab (+data-tab), persona-trait-card (+data-trait-name+data-expanded), persona-relationship-content, persona-model-content, persona-people-content, persona-analyze-now, persona-predict-now, persona-person-card, persona-open-social-graph |
| IDEN-03 | CharacterBible (/character)| getCharacterBible, consolidateCharacter, consolidateReactionsToPreferences, updateCharacterSection                                                                                                | character-bible-root, character-bible-content, character-bible-sections, trait-log-deferred, character-consolidate, character-reactions, character-open-persona |
| IDEN-04 | NegotiationView (/negotiation) | negotiationGetDebates, negotiationStartDebate, negotiationRound, negotiationConclude, negotiationGetScenarios, negotiationRoleplay, negotiationAnalyze, negotiationBuildArgument, negotiationSteelman, negotiationFindCommonGround, negotiationCritiqueMove | negotiation-view-root, negotiation-tab (+data-tab), negotiation-debate-root, negotiation-rounds, negotiation-scenarios-root, negotiation-analyze-root, negotiation-analyze-result, negotiation-tools-root, negotiation-tool-build/steelman/common-ground/critique |

All 4 routes render real data without 404 → SC-3 explicitly satisfied. SC-3's "SoulView displays loaded identity document content" is satisfied because `BibleTab` renders the 6 `CharacterBibleDoc` sections + `bladeGetSoul()` self-characterization on initial load (Promise.allSettled lets partial data show if any single wrapper errors).

## SC-4 Pragmatic Closure (D-155)

Plan explicitly called for a pragmatic SC-4 closure because the literal "trait evolution log" reading would require a new Rust reader command, which D-140 forbids in Phase 6. We ship:

1. **Round-trip is live** — chat thumbs-up/down in Phase 3 Chat fires `applyReactionToTraits`. `PersonaView`'s Traits tab immediately reflects updated scores (operator verifies via M-25: send chat message → thumbs-up → navigate to /persona → see the changed score).
2. **CharacterBible renders an honest deferral card** — `.identity-deferred-card` with `data-testid="trait-log-deferred"` plus a "Open Persona → Traits" button that deep-links to /persona via `router.openRoute('persona')`. Card text explicitly says "ships in Phase 9 polish" and cites the D-140 zero-Rust invariant.

No faked data. Phase 6 retrospective will carry the backend-reader-for-log gap forward.

## Wrapper Signature Surprises

One behavior worth noting beyond what Plan 06-02 already flagged:

- **`personaEstimateMood`** takes `{recentMessages, timeOfDay, streakMinutes}` not a bare call. PersonaView → UserModelTab passes safe defaults: `[]`, `new Date().getHours()`, `0`. The Rust implementation tolerates an empty message array and falls back to time-of-day heuristics. A future phase (likely Phase 8 Hive or Phase 9 polish) that wires the Chat stream into PersonaView can replace the placeholder with real recent messages.
- **`negotiationGetDebates(limit)` / `negotiationGetScenarios(limit)`** — limit is required (not Option). NegotiationView passes `20` for both, a sensible page size that matches other Phase 6 list fetches.
- **`negotiationRound({sessionId, userMessage})`** — AppHandle is Tauri-managed so only session + message are sent. Enter-to-submit triggers `handleSend()` on the compose input.
- **`negotiationAnalyze`** returns `NegotiationScenario` (topic+user_goal+their_goal+tactics+scripts+batna), not a free-form string — the result panel renders the structured shape inline.
- **`CharacterBibleDoc.sections` doesn't exist** as a Rust field — the type is a flat struct with `identity | preferences | projects | skills | contacts | notes | last_updated`. Both SoulView and CharacterBible iterate over the fixed `BIBLE_SECTIONS` ordered array (module-local constant) that mirrors the Rust struct.
- **`PersonaTrait.trait_name`** (not `name`). Cards use `trait_name` for the id hook (`data-trait-name`) and rendered label.

No wrapper bugs surfaced; no Rust changes needed.

## CSS Delta in identity-rich-a.css

Newly introduced scoped classes (all under `@layer features`):

| Group                  | Classes |
|------------------------|---------|
| Shared identity section | `.identity-section`, `.identity-section-header`, `.identity-section-title`, `.identity-section-content`, `.identity-section-content--empty` |
| Surface header          | `.identity-surface-header`, `.identity-surface-title`, `.identity-surface-sub` |
| State stat grid         | `.identity-state-card`, `.identity-state-card-stat`, `.identity-state-card-stat-label`, `.identity-state-card-stat-value` |
| Deferred card           | `.identity-deferred-card` |
| Edit Dialog chrome      | `.identity-edit-dialog-title`, `.identity-edit-dialog-actions` |
| Action row + list       | `.identity-actions-row`, `.identity-list`, `.identity-list-row`, `.identity-list-row-primary`, `.identity-list-row-secondary` |
| Empty state             | `.identity-empty` |
| Persona traits          | `.persona-trait-grid`, `.persona-trait-card` (+data-expanded), `.persona-trait-header`, `.persona-trait-name`, `.persona-trait-score-numeric`, `.persona-trait-score-bar`, `.persona-trait-score-fill`, `.persona-trait-evidence`, `.persona-trait-evidence-list`, `.persona-trait-meta`, `.persona-trait-actions`, `.persona-trait-edit-*` |
| Relationship bars       | `.persona-relationship-bar-wrap`, `.persona-relationship-bar-label`, `.persona-relationship-bar`, `.persona-relationship-bar-fill` |
| User model dossier      | `.persona-model-dossier`, `.persona-model-field`, `.persona-model-field-label`, `.persona-model-field-value`, `.persona-model-chip-list`, `.persona-model-expertise-row` |
| People grid             | `.persona-people-grid`, `.persona-person-card`, `.persona-person-header`, `.persona-person-name`, `.persona-person-relationship`, `.persona-person-result`, `.persona-upsert-form` |
| Character bible         | `.character-bible-content` |
| Negotiation layout      | `.negotiation-layout`, `.negotiation-sidebar`, `.negotiation-sidebar-header`, `.negotiation-debate-row` (+data-selected), `.negotiation-debate-row-topic`, `.negotiation-debate-row-meta`, `.negotiation-main` |
| Negotiation rounds      | `.negotiation-rounds`, `.negotiation-round` (+data-role=user/blade/coaching), `.negotiation-round-role`, `.negotiation-compose`, `.negotiation-compose-input`, `.negotiation-start-form` |
| Negotiation tools       | `.negotiation-tools-grid`, `.negotiation-tool-card`, `.negotiation-tool-title`, `.negotiation-tool-desc`, `.negotiation-tool-result` |
| Negotiation scenarios   | `.negotiation-scenario-card`, `.negotiation-scenario-title`, `.negotiation-scenario-meta`, `.negotiation-analyze-result` |

All rules use project tokens (`--s-N`, `--r-md`, `--r-pill`, `--r-sm`, `--line`, `--line-strong`, `--t-1..4`, `--status-running`, `--font-mono`, `--font-display`, `--ease-out`). No hex values. No `backdrop-filter` inside inner cards (D-07 / D-70 preserved — outer GlassPanel is the only blur layer).

## No Cross-Lane Overlap (D-143)

`git status --short` before each commit confirmed only the following files were in my working set:

- src/features/identity/EditSectionDialog.tsx (created)
- src/features/identity/SoulView.tsx (modified)
- src/features/identity/PersonaView.tsx (modified)
- src/features/identity/CharacterBible.tsx (modified)
- src/features/identity/NegotiationView.tsx (modified)
- src/features/identity/identity-rich-a.css (created)

Other-lane working changes visible in status (06-03 FinanceView, 06-04 EmotionalIntel/Accountability, 06-06 ReasoningView/SidecarView, life-os-rich-{a,b}.css, identity-rich-b.css) were deliberately excluded from `git add` — each lane commits its own files atomically. I touched zero other-lane files.

## Verification

- `npx tsc --noEmit` — clean (0 errors) after each task commit.
- `npm run verify:all` — all 11 checks pass:
  - verify:entries OK (5 HTML entries present)
  - verify:no-raw-tauri OK (every identity wrapper consumed via `@/lib/tauri/identity` namespace)
  - verify:migration-ledger OK (89 rows, 13 referenced ids tracked)
  - verify:emit-policy OK (59 broadcast emits match allowlist)
  - verify:contrast OK (all strict pairs ≥ 4.5:1 — SoulView/PersonaView/CharacterBible/NegotiationView colors unchanged — use token-driven t-1..t-3 only)
  - verify:chat-rgba OK (D-70 preserved)
  - verify:ghost-no-cursor OK (D-09 preserved)
  - verify:orb-rgba OK (D-07/D-18 preserved)
  - verify:hud-chip-count OK (HUD-02 preserved)
  - verify:phase5-rust OK (75 Phase 5 commands still registered)
  - verify:feature-cluster-routes OK (18 Phase 5 routes present)
- ESLint `blade/no-raw-tauri` — passes (every invoke routes through the cluster wrapper).
- Zero Rust changes — `src-tauri/` untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `keyof CharacterBibleDoc` includes `number` → updateCharacterSection section type mismatch**
- **Found during:** Task 1 typecheck.
- **Issue:** `CharacterBibleDoc` carries an `[k: string]: unknown` index signature per D-160, which widens `keyof` to `string | number`. Passing `editing.section` (typed `keyof CharacterBibleDoc`) to `updateCharacterSection({section: string, ...})` tripped TS2322.
- **Fix:** Coerced to string at the API boundary (`String(editing.section)`). The BIBLE_SECTIONS constant only lists string ids so runtime behavior is unchanged.
- **Files modified:** src/features/identity/SoulView.tsx, src/features/identity/CharacterBible.tsx.
- **Commits:** 533b177, 426f56d.

**2. [Rule 3 — Blocking] `Person` type lives in life-os/types, not identity/types**
- **Found during:** Task 2 typecheck (PersonaView).
- **Issue:** `Person` is re-exported by `src/features/life-os/types.ts` (not identity/types — the cluster-local barrel for identity doesn't include it). PersonaView's People tab needs the type for `peopleUpsert({...} as Person)`.
- **Fix:** Imported `Person` from `@/features/life-os/types` explicitly — identity types barrel stays clean; people_graph is a Life-OS module that Identity happens to read for the D-149 cross-reference.
- **Files modified:** src/features/identity/PersonaView.tsx.
- **Commit:** 426f56d.

**3. [Rule 1 — Bug] Dialog primitive has no `title` prop**
- **Found during:** Task 1 EditSectionDialog write.
- **Issue:** The plan draft passed `<Dialog title={...}>`, but the native `<dialog>` wrapper only accepts `open`, `onClose`, `ariaLabel`, `children`.
- **Fix:** Render an `<h3 className="identity-edit-dialog-title">` inside children and pass `ariaLabel={\`Edit ${title}\`}` for screen-reader support (T-04-04 mitigation). Same pattern used by delete-preference / consolidate-confirm dialogs.
- **Files modified:** src/features/identity/EditSectionDialog.tsx (+ inline confirm dialogs in SoulView / CharacterBible / NegotiationView).
- **Commits:** 533b177, 426f56d, 8f46e5c.

All three fixes were Rule-1 / Rule-3 auto-corrections — no architectural changes, no user prompts needed. Plan intent preserved verbatim.

### Planner-Draft Preserved

- **No chat-bubble reuse** (plan §D-156): NegotiationView debate rows are plain-text with role-colored backgrounds, not chat bubbles.
- **No auto-save on identity edits** (plan D-153/D-154/D-155): every mutation lands behind an explicit Save / Confirm button.
- **Trait range 0..1 step 0.01** (plan T-06-05-02): custom trait Dialog uses `<input type="range" min={0} max={1} step={0.01}>`.
- **EditSectionDialog is text-only**: Trait-edit uses a CUSTOM inline Dialog (slider + textarea) — plan explicitly called this out.
- **Honest deferral** (plan D-155): no faked log data; card explicitly cites the D-140 invariant.

## Known Simplifications (not stubs)

- `personaEstimateMood` called with empty recentMessages on PersonaView → UserModel tab. This is an intentional Phase 6 simplification — the Rust implementation tolerates empty feeds and the returned mood is used as a fallback only when `UserModel.mood_today` is empty. Not a bug; not a stub (the pane renders whichever is present, preferring the model value).
- NegotiationView tab state is local-only. Intentional — persisting it to `identity.activeTab` would collide with PersonaView's key. Phase 6 keeps the pref surface small.
- Critique-move card asks for a raw `scenario id` string (no dropdown of existing scenarios). Phase 6 simplification; Phase 9 polish can add a scenario picker once the scenario page has stable ids in the UI.

## Threat Model Compliance

Per the plan's STRIDE register:

- **T-06-05-01 (Tampering — bible overwrite)**: MITIGATED — every section edit behind EditSectionDialog with explicit Save button; no auto-save; Save handler awaits the backend round-trip before closing.
- **T-06-05-02 (Tampering — invalid trait score)**: MITIGATED — `<input type="range" min={0} max={1} step={0.01}>` bounds the value; TraitEditDialog also clamps via `Math.max(0, Math.min(1, value))` when rendering.
- **T-06-05-05 (Tampering — consolidate without confirm)**: MITIGATED — both `consolidateCharacter` and `consolidateReactionsToPreferences` are gated behind Dialog confirms in CharacterBible.

## Commits

| Task | Commit    | Summary |
|------|-----------|---------|
| 1    | 533b177   | EditSectionDialog + SoulView (IDEN-01, SC-3) + identity-rich-a.css scoped partial |
| 2    | 426f56d   | PersonaView 4-tab + CharacterBible (IDEN-02, IDEN-03, SC-4) |
| 3    | 8f46e5c   | NegotiationView 4-tab (IDEN-04) |

## Self-Check: PASSED

Verified artifacts exist:
- src/features/identity/EditSectionDialog.tsx FOUND
- src/features/identity/SoulView.tsx FOUND (real body, no "Ships in Plan 06-05" remaining)
- src/features/identity/PersonaView.tsx FOUND (real body, no placeholder remaining)
- src/features/identity/CharacterBible.tsx FOUND (real body, deferred-card present)
- src/features/identity/NegotiationView.tsx FOUND (real body, no placeholder remaining)
- src/features/identity/identity-rich-a.css FOUND

Verified commits exist:
- 533b177 FOUND
- 426f56d FOUND
- 8f46e5c FOUND

Verified no-overlap with 06-03 / 06-04 / 06-06 lanes — each only touched files under `src/features/identity/` that Plan 06-05 owns per D-143. Other-lane changes remained unstaged throughout.
