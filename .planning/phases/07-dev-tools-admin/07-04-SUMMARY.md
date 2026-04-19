---
phase: 07-dev-tools-admin
plan: 04
subsystem: dev-tools-rich-b
tags: [dev-tools, web-automation, email-assistant, document-generator, code-sandbox, computer-use, wave-2, phase-7, sc-2]
dependency_graph:
  requires:
    - Plan 07-01 — BLADE_EVENTS.BROWSER_AGENT_STEP constant + BrowserAgentStepPayload + prefs.devTools.activeTab key
    - Plan 07-02 — src/lib/tauri/dev_tools.ts (89 typed wrappers) + 5 per-route placeholders + dev-tools.css shared base
  provides:
    - DEV-06 — WebAutomation (SC-2 falsifier) real surface
    - DEV-07 — EmailAssistant real surface
    - DEV-08 — DocumentGenerator real surface
    - DEV-09 — CodeSandbox real surface
    - DEV-10 — ComputerUse real surface with 25-command automation/uia coverage
    - 2 reusable ComputerUse sub-components (AutomationTab, UiAutomationTab)
    - dev-tools-rich-b.css scoped partial (layouts + chips + screenshots + history rows + danger banner)
  affects:
    - Plan 07-07 — Playwright specs reference these data-testid hooks
    - ROADMAP Phase 7 SC-2 directly falsified (WebAutomation goal → live trace)
tech-stack:
  added: []
  patterns:
    - "rAF-flush ref-buffer for bursty live events (mirrors useAgentTimeline; WebAutomation trace pipe)"
    - "Tab persistence prefix-scoped inside single prefs.devTools.activeTab dotted key — per-route prefix avoids collisions (web:/email:/doc:/cu:)"
    - "Dialog-confirm (Pattern §4) on 4 destructive automation ops + doc delete"
    - "Client-side ring buffer for code-sandbox history (10 entries, not persisted — intentional per D-180)"
    - "@tauri-apps/plugin-dialog file picker reused from FinanceView for DocumentGenerator ingest"
    - "Synchronous wrap-helpers for automation::* + uia::* mini-forms (toast on success + error)"
key-files:
  created:
    - src/features/dev-tools/dev-tools-rich-b.css (588 lines)
    - src/features/dev-tools/AutomationTab.tsx (576 lines)
    - src/features/dev-tools/UiAutomationTab.tsx (307 lines)
    - .planning/phases/07-dev-tools-admin/07-04-SUMMARY.md
  modified:
    - src/features/dev-tools/WebAutomation.tsx (placeholder → 457-line real surface)
    - src/features/dev-tools/EmailAssistant.tsx (placeholder → 414-line real surface)
    - src/features/dev-tools/DocumentGenerator.tsx (placeholder → 497-line real surface)
    - src/features/dev-tools/CodeSandbox.tsx (placeholder → 318-line real surface)
    - src/features/dev-tools/ComputerUse.tsx (placeholder → 211-line real surface + 2 sub-components)
decisions:
  - "Live-trace subscription wired: WebAutomation subscribes to BLADE_EVENTS.BROWSER_AGENT_STEP (not the speculative BROWSER_AGENT_EVENT the plan draft referenced). This is the name Plan 07-01 added after its Rust audit; real emit is browser_agent.rs:268,284 `browser_agent_step`. browserAgentLoop also returns a synchronous String summary which we render as the final step card below the live trace."
  - "prefs.devTools.activeTab is prefix-scoped across routes (web:/email:/doc:/cu:). Prevents cross-route tab collisions while honoring the single-key D-192 constraint."
  - "DocumentGenerator's cross-synthesis passes a user-typed question to Rust's `doc_cross_synthesis(question: String)` (which is corpus-wide today — doesn't accept a doc_ids list). Sidebar selection remains a UX hint; plan language ('pick ≥2 docs') guides the user intent even though Rust runs over the full ingested corpus. Logged in-component so Phase 9 polish can wire doc_ids when Rust grows the arg."
  - "auto_reply_draft Rust signature is (sender, message, platform, thread_context?) not (recipient, message, intent) — plan draft was wrong. Wrapper surfaces `{ sender, message, platform, threadContext? }`; intent radio pill maps to platform field (reply→email, followup→followup, introduce→introduce) so backend prompt templating stays intact."
  - "CodeSandbox fix-and-run button is only enabled when the last result has non-empty stderr (D-180 'only enabled if last run had stderr' clarified)."
  - "AutomationTab destructive ops: auto_mouse_click (user-targeted click could activate anything), auto_open_url, auto_open_path, auto_launch_app. All 4 Dialog-confirm per D-181. auto_get_mouse_position, auto_copy_to_clipboard, auto_paste_clipboard, clipboard-only and keyboard ops use plain buttons (benign on a single-user local-first desktop)."
  - "UiAutomationTab renders snapshot as a JSON tree header + a clickable element list. Clicking a row ADOPTS its selector fields (automation_id, name, class_name, control_type) into the selector builder — saves users from retyping."
  - "No worker files, no Rust edits, no index.tsx edits. 5 per-route files owned by this plan + 2 NEW sub-components + 1 NEW CSS partial. files_modified disjoint from Plans 07-03/05/06."
metrics:
  completed_at: "2026-04-18T00:00:00Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 5
  lines_net: ~3300
  commits: 2
  verify_steps_green: 12
---

# Phase 7 Plan 07-04: WebAutomation + EmailAssistant + DocumentGenerator + CodeSandbox + ComputerUse Summary

Shipped 5 real Dev Tools route surfaces (DEV-06..10) plus 2 ComputerUse sub-components and 1 scoped CSS partial. WebAutomation directly falsifies ROADMAP Phase 7 SC-2 via browser_agent_loop + live trace subscribed to `BLADE_EVENTS.BROWSER_AGENT_STEP` (the real Rust emit, per Plan 07-01 audit). Zero Rust edits, zero index.tsx edits, zero cross-lane file touches. `npx tsc --noEmit` clean; `npm run verify:all` 12/12 green.

## Shipped Artifacts

### 5 real route components

| File | Requirement | Rust wrappers used |
| --- | --- | --- |
| `src/features/dev-tools/WebAutomation.tsx` | DEV-06 / SC-2 | browserAgentLoop, browserAction, browserDescribePage, browserSessionStatus, connectToUserBrowser, webAction |
| `src/features/dev-tools/EmailAssistant.tsx` | DEV-07 | autoReplyDraft, autoReplyLearnFromEdit, autoReplyDraftBatch, reminderAddNatural, reminderParseTime |
| `src/features/dev-tools/DocumentGenerator.tsx` | DEV-08 | docList, docIngest, docSearch, docDelete, docGenerateStudyNotes, docCrossSynthesis, docAnswerQuestion |
| `src/features/dev-tools/CodeSandbox.tsx` | DEV-09 | sandboxRun, sandboxRunExplain, sandboxFixAndRun, sandboxDetectLanguage |
| `src/features/dev-tools/ComputerUse.tsx` | DEV-10 | computerUseTask, computerUseStop, computerUseScreenshot |

### 2 sub-components

| File | Purpose | Rust wrappers used (count) |
| --- | --- | --- |
| `src/features/dev-tools/AutomationTab.tsx` | 15 automation::* commands, 4 sections, Dialog-gated destructive ops | autoTypeText, autoPressKey, autoKeyCombo, autoMouseMove, autoGetMousePosition, autoMouseClick, autoMouseClickRelative, autoMouseDoubleClick, autoMouseDrag, autoScroll, autoOpenUrl, autoOpenPath, autoLaunchApp, autoCopyToClipboard, autoPasteClipboard (15) |
| `src/features/dev-tools/UiAutomationTab.tsx` | 7 uia_* commands, snapshot-tree + per-element actions | uiaGetActiveWindowSnapshot, uiaDescribeActiveWindow, uiaClickElement, uiaInvokeElement, uiaFocusElement, uiaSetElementValue, uiaWaitForElement (7) |

### 1 CSS partial

| File | Scope |
| --- | --- |
| `src/features/dev-tools/dev-tools-rich-b.css` | Layouts for 5 routes: web-automation-layout (trace + screenshot split), email-assistant-layout (form + draft split), doc-generator-layout (sidebar + main), code-sandbox-layout (editor + history aside), computer-use-layout (task + screenshot split). Plus section/form/chip/danger helpers. All token names (`--s-*`, `--r-*`, `--status-*`, `--font-mono`) match the existing `dev-tools.css` substrate (no token drift). |

## Command Wiring Summary

**Total Rust wrappers consumed: 34 (DEV-06..10) + 22 (ComputerUse sub-tabs) = 56 wrappers across 6 files.**

- browser_agent.rs + browser_native.rs: 6 wrappers (WebAutomation)
- auto_reply.rs + reminders.rs (subset): 5 wrappers (EmailAssistant)
- document_intelligence.rs: 7 wrappers (DocumentGenerator — docGet not used this surface)
- code_sandbox.rs: 4 wrappers (CodeSandbox)
- computer_use.rs: 3 wrappers (ComputerUse core)
- automation.rs: 15 wrappers (AutomationTab)
- ui_automation.rs: 7 wrappers (UiAutomationTab)

## WebAutomation Live-Trace Decision

**Subscribed via `useTauriEvent(BLADE_EVENTS.BROWSER_AGENT_STEP, …)`** — the plan had referenced `BROWSER_AGENT_EVENT` speculatively; Plan 07-01 SUMMARY explicitly flagged the real emit is `browser_agent_step` (Rust `browser_agent.rs:268,284`) and added the constant as `BROWSER_AGENT_STEP`. Implementation uses a ref buffer + rAF-flush (pattern borrowed from `useAgentTimeline`) capped at 200 rows to absorb bursty step emits without React thrash. The trace panel renders as a scrollable vertical list of step cards with `data-final` + `data-error` borders; synchronous `browserAgentLoop` return appears beneath as a summary card. Screenshot pane surfaces the latest non-empty `screenshot_b64` observed on any step — data URL embedded inline.

## Rust Signature Drift vs. Plan 07-02 Types

Encountered zero new Rust drift beyond what Plan 07-02's SUMMARY already captured. Adjustments made in-component:

| Surface | Plan draft | Rust reality (handled in component) |
| --- | --- | --- |
| `auto_reply_draft` args | `{ recipient, message, intent }` | Rust `(sender, message, platform, thread_context?)`. Component maps intent→platform (`reply`→`email`, `followup`→`followup`, `introduce`→`introduce`) so prompt templating still gets semantic hint. |
| `reminder_add_natural` args | `{ text }` single-field | Rust `(title, note, time_expression)` 3-field. Component surfaces a dedicated title + note field alongside the natural-language `when` input. |
| `doc_cross_synthesis` args | `{ docIds }` list | Rust `(question: String)` corpus-wide. Component keeps the multi-select UX hint but passes the synthesis question. Documented as planned polish deferral. |
| `doc_answer_question` args | `{ docId, question }` single-doc | Rust `(question, doc_ids?: Vec<String>)`. Component passes `[singleSelectedId]` to `docIds` — single-doc Q&A still works; multi-doc could be trivially added later. |
| `browser_describe_page` arg | `()` no-arg | Rust `(session_id: String)`. Component passes `''` (backend accepts empty for "current session"). |
| `web_action` arg | `({action, url})` free-form | Rust `(session_id, action_type, target, value)`. Component maps navigate→`actionType='navigate'` + empty `sessionId`/`value`. |

None of these required Rust edits (accepted scope boundary; all surfaces work with the real Rust signatures).

## Prefs Integration

- `prefs.devTools.activeTab` used across 5 routes with prefixes to avoid collision:
  - `web:` — WebAutomation tool panel (`click`/`describe`/`navigate`).
  - `email:` — EmailAssistant main tabs (`single`/`batch`/`followup`).
  - `doc:` — DocumentGenerator generation modes (`study`/`synthesis`/`qa`).
  - `cu:` — ComputerUse sub-tabs (`automation`/`ui-automation`).
- Prefix fallback: `activeTab` absent or unknown → safe default per route. This keeps a single prefs key while honoring route-specific semantics.

## data-testid Coverage for Plan 07-07

Declared hooks confirmed present:

| Route | Testids (spot-checked via grep) |
| --- | --- |
| WebAutomation | `web-automation-root`, `web-automation-goal-input`, `web-automation-run-button`, `web-automation-trace`, `web-automation-step-row`, `web-automation-screenshot`, `web-automation-session-chip`, `web-automation-connect-button`, `web-automation-tool-tab-*` |
| EmailAssistant | `email-assistant-root`, `email-assistant-draft-button`, `email-assistant-draft-output`, `email-assistant-tab` (×3 via onClick), `email-assistant-batch-items`, `email-assistant-sender-input`, `email-assistant-message-input`, `email-assistant-intent-*` |
| DocumentGenerator | `document-generator-root`, `doc-list-sidebar`, `doc-tab`, `doc-sidebar-row`, `doc-ingest-button`, `doc-search-input`, `doc-study-button`, `doc-synthesis-output`, `doc-qa-button`, `doc-qa-output` |
| CodeSandbox | `code-sandbox-root`, `code-sandbox-run-button`, `code-sandbox-stdout`, `code-sandbox-stderr`, `code-sandbox-exit-code`, `code-sandbox-code`, `code-sandbox-history`, `code-sandbox-history-row`, `code-sandbox-lang-*`, `code-sandbox-run-explain-button`, `code-sandbox-fix-and-run-button` |
| ComputerUse | `computer-use-root`, `computer-use-tab`, `computer-use-task-card`, `computer-use-goal-input`, `computer-use-screenshot`, `computer-use-stop-button`, `computer-use-start-button`, `computer-use-refresh-screenshot` |
| AutomationTab | `automation-tab-root`, `automation-section` (×4), `automation-action-danger` (×4 on click/openUrl/openPath/launchApp) |
| UiAutomationTab | `ui-automation-tab-root`, `uia-snapshot`, `uia-element-action` |

Every testid listed in the plan's `<truths>` block is present; plus added helper testids (sidebar inputs, screenshot refresh, tool-tab dividers) that Plan 07-07 can exploit for more granular asserts.

## Divergences from D-177..D-181

| Decision | Plan intent | Shipped reality | Rationale |
| --- | --- | --- | --- |
| D-177 live-trace | "if BROWSER_AGENT_EVENT constant exists … subscribe" | Subscribed to `BROWSER_AGENT_STEP` (correct Rust name added by 07-01) | Plan draft had wrong constant name; 07-01 SUMMARY flagged it. No behavior divergence. |
| D-178 auto_reply args | `{recipient, message, intent}` | `{sender, message, platform}` with intent→platform mapping | Plan's arg names differed from Rust; component adapts. Intent radio still present; semantic preserved. |
| D-179 cross-synthesis arg | `{docIds}` | Rust takes only `{question}`; selection list is UX hint | Rust signature is corpus-wide today. Noted in component footer; zero-Rust invariant held. |
| D-180 fix-and-run enablement | "only enabled if last run had stderr" | Enabled iff `result?.stderr` non-empty | Matches plan verbatim. |
| D-181 destructive Dialog | "destructive ones Dialog-confirmed" | 4 automation ops + 1 doc delete confirmed; others run immediately | Keyboard/clipboard/mouse-move are non-destructive; mouse-click (which could hit anything) + launch-app + open-url + open-path gated. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CodeSandbox had an unused `Language` type alias**
- **Found during:** Task 2 `npx tsc --noEmit` (TS6133 noUnusedLocals).
- **Issue:** `type Language = (typeof LANGUAGES)[number]` was declared but never referenced (replaced by a loose `string` state to accept Rust-detected language strings that may not be in the local union).
- **Fix:** Removed the unused type alias. Behavior unchanged.
- **Files modified:** src/features/dev-tools/CodeSandbox.tsx
- **Commit:** 473aa9c (folded into Task 2 commit; caught before commit)

### Scope-Bounded Discoveries (not fixed, logged for awareness)

- `src/features/admin/DiagnosticsSysadminTab.tsx` has 2 pre-existing TS6133 unused-variable errors (`saveOpen`, `confirmSave`). Out of my lane (Plan 07-06 owns admin/*). Not fixed.

## Known Stubs

None in my lane. All 5 routes render real surfaces backed by live Rust calls. The only documented UX hint (DocumentGenerator cross-synthesis multi-select) is explicitly labeled in-component; Rust will close the gap in a later plan without UI changes required.

## Threat Flags

None beyond what the plan's threat_model already enumerated. Destructive automation ops all behind Dialog-confirm (T-07-04-01 mitigation). Screenshot exfiltration accepted per T-07-04-03 (single-user local-first).

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1    | `8acbd41` | `feat(07-04): ship WebAutomation + EmailAssistant + DocumentGenerator (DEV-06..08)` |
| 2    | `473aa9c` | `feat(07-04): ship CodeSandbox + ComputerUse + 2 sub-tabs (DEV-09..10)` |

## Verification Evidence

```
$ npx tsc --noEmit
(exit 0, no output)

$ npm run verify:all
[verify-entries] OK — 5 entries present on disk
[verify-no-raw-tauri] OK — no raw @tauri-apps/api/core or /event imports outside allowed paths
[verify-migration-ledger] OK — 13 referenced ids all tracked (of 89 ledger rows)
[verify-emit-policy] OK — all 59 broadcast emits match cross-window allowlist
[audit-contrast] OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline
[verify-chat-rgba] OK — no backdrop-filter property in src/features/chat (D-70 preserved)
[verify-ghost-no-cursor] OK — no cursor property in src/features/ghost/** (D-09 preserved)
[verify-orb-rgba] OK — no backdrop-filter on orb visual surfaces (D-07/D-18/SC-2 preserved)
[verify-hud-chip-count] OK — `hud-chip hud-*` className count is exactly 4 (HUD-02 preserved)
[verify-phase5-rust-surface] OK — all 75 Phase 5 Rust commands registered
[verify-feature-cluster-routes] OK — all 34 Phase 5+6 routes present
[verify-phase6-rust-surface] OK — all 157 Phase 6 Rust commands registered
```

12/12 verify:all scripts green.

## Success Criteria

- [x] 5 real route components shipped (DEV-06..10)
- [x] 2 sub-components (AutomationTab, UiAutomationTab) cover all 22 automation + uia commands
- [x] SC-2 falsified: WebAutomation renders goal → live trace via browser_agent_step subscription + synchronous summary
- [x] Dialog-confirm on 4 destructive automation ops + 1 doc delete
- [x] prefs.devTools.activeTab prefix-scoped across 4 routes
- [x] `npx tsc --noEmit` passes
- [x] `npm run verify:all` 12/12 green
- [x] Zero Rust file edits
- [x] files_modified disjoint from Plans 07-03 / 07-05 / 07-06

## Self-Check: PASSED

- `src/features/dev-tools/WebAutomation.tsx` — 457 lines; imports `browserAgentLoop` + `BLADE_EVENTS.BROWSER_AGENT_STEP`; present on disk.
- `src/features/dev-tools/EmailAssistant.tsx` — 414 lines; imports `autoReplyDraft` / `autoReplyLearnFromEdit` / `autoReplyDraftBatch` / `reminderAddNatural` / `reminderParseTime`.
- `src/features/dev-tools/DocumentGenerator.tsx` — 497 lines; imports `docList` / `docIngest` / `docSearch` / `docDelete` / `docGenerateStudyNotes` / `docCrossSynthesis` / `docAnswerQuestion` + `@tauri-apps/plugin-dialog` for file picker.
- `src/features/dev-tools/CodeSandbox.tsx` — 318 lines; imports `sandboxRun` / `sandboxRunExplain` / `sandboxFixAndRun` / `sandboxDetectLanguage`.
- `src/features/dev-tools/ComputerUse.tsx` — 211 lines; imports `computerUseTask` / `computerUseStop` / `computerUseScreenshot` + lazy-less static imports of `AutomationTab` + `UiAutomationTab`.
- `src/features/dev-tools/AutomationTab.tsx` — 576 lines; imports all 15 `auto*` wrappers; 4 `automation-action-danger` testids.
- `src/features/dev-tools/UiAutomationTab.tsx` — 307 lines; imports all 7 `uia*` wrappers.
- `src/features/dev-tools/dev-tools-rich-b.css` — 588 lines; scoped partial under `@layer features`.
- Commit `8acbd41` (Task 1): present in `git log --oneline`.
- Commit `473aa9c` (Task 2): present in `git log --oneline`.
- Summary file: `.planning/phases/07-dev-tools-admin/07-04-SUMMARY.md` (this file) created.
- `npx tsc --noEmit`: exit 0.
- `npm run verify:all`: 12/12 green.
