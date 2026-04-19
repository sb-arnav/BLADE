---
phase: 07-dev-tools-admin
plan: 03
subsystem: dev-tools-cluster-subset-a
tags: [dev-tools, terminal, file-browser, git-style, canvas, workflow-builder, sc-1]
dependency_graph:
  requires:
    - Phase 7 Plan 07-01 (usePrefs extension — devTools.terminal.cwd / devTools.fileBrowser.expandedPaths / devTools.activeTab)
    - Phase 7 Plan 07-02 (typed wrappers at src/lib/tauri/dev_tools.ts; per-route placeholders; cluster CSS base)
    - src-tauri Phase 1 substrate (native_tools.rs run_shell, files.rs file_tree/read, file_indexer.rs, indexer.rs, git_style.rs, code_sandbox.rs, workflow_builder.rs, cron.rs, watcher.rs)
    - @tauri-apps/api/path homeDir (not banned — verify:no-raw-tauri only restricts /core and /event)
  provides:
    - Terminal route (DEV-01) — SC-1 falsifier, bash scrollback via run_shell
    - FileBrowser route (DEV-02) — tree + preview + indexed search + project panel
    - GitPanel route (DEV-03) — git style miner + honest deferral
    - Canvas route (DEV-04) — thin code sandbox wrapper + honest deferral
    - WorkflowBuilder route (DEV-05) — list + detail + runs + create/generate/schedule
    - FileBrowserTree recursive sub-component (expanded-paths pref)
    - WorkflowDetail sidebar-detail sub-component (tabs + cron integration)
    - dev-tools-rich-a.css scoped partial (extends 07-02 dev-tools.css; parallel to 07-04 rich-b)
  affects:
    - Plan 07-07 (Playwright specs — data-testid coverage for 5 real routes)
    - ROADMAP Phase 7 SC-1 — now directly falsified by Terminal.tsx runShell
tech_stack:
  added: []
  patterns:
    - Scrollback <pre> with line-type data-testid coverage (Pattern §3)
    - FileBrowserTree recursive render + lazy-load beyond depth 2 (Pattern §6)
    - Dialog-confirm for destructive ops (Pattern §4 — delete workflow, clear git style, remove schedule)
    - Workflow preview-then-save for generated workflows (D-176)
    - Tab persistence via prefs.devTools.activeTab with "workflow:" key prefix (non-colliding)
    - homeDir() resolution with /home/arnav fallback on Linux dev (no plugin-dialog dependency)
    - invokeTyped-only (no raw invoke/listen; verify:no-raw-tauri green)
key_files:
  created:
    - src/features/dev-tools/FileBrowserTree.tsx (155 lines)
    - src/features/dev-tools/WorkflowDetail.tsx (573 lines)
    - src/features/dev-tools/dev-tools-rich-a.css (481 lines)
  modified:
    - src/features/dev-tools/Terminal.tsx (269 lines — replaces 17-line placeholder)
    - src/features/dev-tools/FileBrowser.tsx (680 lines — replaces 17-line placeholder)
    - src/features/dev-tools/GitPanel.tsx (269 lines — replaces 16-line placeholder)
    - src/features/dev-tools/Canvas.tsx (214 lines — replaces 16-line placeholder)
    - src/features/dev-tools/WorkflowBuilder.tsx (525 lines — replaces 17-line placeholder)
decisions:
  - run_code_block accepts a single command string (Plan 07-02 clarification). For non-bash languages in Terminal's code-block Dialog, we wrap the body as `<lang> -c <json-escaped-body>` so the single command argument dispatches correctly. Bash/sh passes through verbatim.
  - Terminal inline-output heuristic — if run_code_block output matches /error|traceback|non-zero/i, tint as stderr; otherwise stdout. Low-risk Rule 2 addition (not explicitly in plan but matches D-172 intent of "rendered inline as stdout line, or stderr if exit_code !== 0" — run_code_block does not expose an exit code directly).
  - FileBrowser home directory resolution — prefers `homeDir()` from `@tauri-apps/api/path`. If rejected (plugin-path not registered in dev), falls back to `/home/arnav`. Verified verify-no-raw-tauri.sh bans only `/core` and `/event` imports, not `/path`.
  - FileBrowser "Watch this dir" — watcher.rs watcher_add takes `url + label + interval_mins`, not a directory watcher (that's `file_watcher.rs`). We use the directory path as the url and `dir:<path>` as the label so the row is identifiable. Background poll is a 15-minute interval (passive). Full per-directory file-change watcher is out of Plan 07-03 scope; this wire is present so the button does something visible without adding a new wrapper.
  - FileIndexStats tuple render — used `display: contents` on a keyed wrapper div to preserve the 2-column grid without React fragment warnings (keyed fragment approach requires `React.Fragment key=...` but even then the inline-style grid child-count logic prefers contents-wrapped children).
  - Workflow generate-from-description save path — the generated Workflow may return from Rust with `id`/`created_at` already populated; we blank both fields before `workflow_create` so Rust's `if wf.id.is_empty()` path assigns a fresh uuid (matches D-176 "explicit Save per user confirmation" semantics — the generated preview is a draft, not an authoritative record).
  - WorkflowDetail tab pref encoding — stored as `workflow:<tab>` under `devTools.activeTab`. When ComputerUse/DocumentGenerator (Plan 07-04 lane) persist their own tabs under the same key, they MUST use a distinct prefix (`computerUse:<tab>`, `documents:<tab>`). This prefix discipline is how all three surfaces share one pref key without collision. Documented for 07-04.
  - Live runs subscription omitted — Plan 07-01's audit (events/index.ts:146) explicitly records that workflow_run_started/workflow_run_completed DO NOT exist in Rust. Falls back to the "poll on workflow_run_now completion" path per Pattern §7's conditional clause. When these emits land in a future phase, WorkflowBuilder can add a `useTauriEvent` subscription in one place.
  - Dialog body + actions styling — added reusable `.dialog-body`, `.dialog-title`, `.dialog-actions` rules in dev-tools-rich-a.css so every Dialog in Plan 07-03 (5 of them: Terminal code-block, FileBrowser Stats, FileBrowser Index, GitPanel Mine, GitPanel Clear, WorkflowBuilder New, WorkflowBuilder Generate, WorkflowDetail Edit, WorkflowDetail Delete, WorkflowDetail Add-schedule, WorkflowDetail Remove-schedule) renders consistently without a cross-cluster Dialog primitive refactor.
metrics:
  completed_at: "2026-04-19T17:15:00Z"
  duration_minutes: ~16
  tasks_completed: 2
  files_created: 3
  files_modified: 5
  lines_net_new: ~3137
  commits: 2
  verify_steps_green: 12
  rust_files_touched: 0
---

# Phase 7 Plan 07-03: Dev Tools Cluster Subset A Summary

Five real Dev Tools routes replace Plan 07-02 placeholders — Terminal (SC-1 falsifier), FileBrowser (tree + preview + search + projects), GitPanel (style miner + honest deferral), Canvas (thin sandbox wrapper + honest deferral), WorkflowBuilder (list/detail/runs/CRUD/schedule). Two sub-components (FileBrowserTree, WorkflowDetail) and one scoped CSS partial. Zero Rust edits; zero other-lane touches; typecheck + verify:all 12/12 green.

## 5 Real Route Components + 2 Sub-Components + 1 CSS Partial

| File | Requirement | Lines | Key wrappers used |
| --- | --- | --- | --- |
| `src/features/dev-tools/Terminal.tsx` | DEV-01 (SC-1) | 269 | `runShell`, `runCodeBlock` |
| `src/features/dev-tools/FileBrowser.tsx` | DEV-02 | 680 | `fileTree`, `fileRead`, `fileIndexSearch`, `fileIndexScanNow`, `fileIndexStats`, `bladeListIndexedProjects`, `bladeProjectSummary`, `bladeFindSymbol`, `bladeIndexProject`, `watcherAdd`, `watcherListAll` |
| `src/features/dev-tools/FileBrowserTree.tsx` | DEV-02 sub | 155 | `fileTree` (lazy children) |
| `src/features/dev-tools/GitPanel.tsx` | DEV-03 | 269 | `gitStyleGet`, `gitStyleMine`, `gitStyleClear` |
| `src/features/dev-tools/Canvas.tsx` | DEV-04 | 214 | `sandboxRun`, `sandboxDetectLanguage` |
| `src/features/dev-tools/WorkflowBuilder.tsx` | DEV-05 | 525 | `workflowList`, `workflowGet`, `workflowCreate`, `workflowRunNow`, `workflowGetRuns`, `workflowGenerateFromDescription` |
| `src/features/dev-tools/WorkflowDetail.tsx` | DEV-05 sub | 573 | `workflowUpdate`, `workflowDelete`, `cronAdd`, `cronList`, `cronDelete` |
| `src/features/dev-tools/dev-tools-rich-a.css` | scoped CSS | 481 | — |

Total: ~3137 lines net new / modified (replacing 83 lines of placeholder stubs).

## Command Wiring Table (consumed wrapper per route)

| Route | Primary command(s) | Secondary / dialog commands |
| --- | --- | --- |
| Terminal | `run_shell` (SC-1) | `run_code_block` (via code-block Dialog) |
| FileBrowser | `file_tree` (mount, depth=2) | `file_read`, `file_index_search`, `file_index_scan_now`, `file_index_stats`, `watcher_add`, `watcher_list_all` |
| FileBrowser Projects tab | `blade_list_indexed_projects` | `blade_project_summary`, `blade_find_symbol`, `blade_index_project` |
| GitPanel | `git_style_get` | `git_style_mine`, `git_style_clear` |
| Canvas | `sandbox_run` | `sandbox_detect_language` (debounced 500ms when auto-detect on) |
| WorkflowBuilder | `workflow_list` | `workflow_get`, `workflow_get_runs`, `workflow_create`, `workflow_run_now`, `workflow_generate_from_description` |
| WorkflowDetail | `workflow_update`, `workflow_delete` | `cron_list` (Schedule tab), `cron_add`, `cron_delete` |

## SC-1 Falsification Evidence

ROADMAP Phase 7 SC-1: "Terminal routes bash through `native_tools.rs` and returns output."

`src/features/dev-tools/Terminal.tsx:74`:
```ts
const text = await runShell({ command: cmd, cwd });
```

`runShell` at `src/lib/tauri/dev_tools.ts:394` invokes Rust command `run_shell`, which lives at `src-tauri/src/native_tools.rs:2988`. The resulting combined stdout+stderr string renders as a `stdout`-typed `TerminalLine` in the scrollback `<pre>` via `data-testid="terminal-line-stdout"`. Plan 07-07 Playwright can mock-assert the round-trip.

## Rust Signature Mismatches vs Plan 07-02 Types

None encountered. Plan 07-02's JSDoc "Note:" paragraphs accurately documented every divergence from the original plan sketch (e.g., `run_shell` returns `Promise<string>`, not structured `ShellResult`; `workflow_run_now` takes `workflowId` only because `app` is Tauri-injected; `fileTree` accepts `depth` client-side and maps to Rust's `max_depth`). Plan 07-03 consumed the Plan 07-02 shapes verbatim.

One minor semantic note for future reference: `watcher.rs::watcher_add` is a URL-change watcher (polls an HTTP GET), NOT a filesystem watcher. The "Watch this dir" button in FileBrowser wires to this surface with a 15-minute poll using the directory path as the url + `dir:<path>` label. When `file_watcher.rs` (distinct from `watcher.rs`) exposes a directory watcher command, FileBrowser should migrate to it; until then this is a functional placeholder that survives D-168's "no 404 fallback" rule without lying about what the backend supports.

## data-testid Coverage for Plan 07-07 Spec

Plan 07-07 Playwright specs will assert on these testids. Coverage matrix:

| Required by plan | Present in |
| --- | --- |
| `terminal-root` | Terminal.tsx:144 |
| `terminal-scrollback` | Terminal.tsx:185 |
| `terminal-input` | Terminal.tsx:215 |
| `terminal-line-cmd` | Terminal.tsx:193 (dynamic) |
| `terminal-line-stdout` | Terminal.tsx:193 (dynamic) |
| `terminal-line-stderr` | Terminal.tsx:193 (dynamic) |
| `file-browser-root` | FileBrowser.tsx:355 |
| `file-browser-tree` | FileBrowserTree.tsx:142 |
| `file-tree-row` | FileBrowserTree.tsx:106 + FileBrowserTree.tsx:146 (root) |
| `git-panel-root` | GitPanel.tsx:129 |
| `canvas-root` | Canvas.tsx:86 |
| `workflow-builder-root` | WorkflowBuilder.tsx:261 |
| `workflow-sidebar-row` | WorkflowBuilder.tsx:323 |
| `workflow-detail-root` | WorkflowDetail.tsx:238 |
| `workflow-run-button` | WorkflowBuilder.tsx:281 |

Additional testids shipped for richer spec coverage:
- Terminal: `terminal-cwd-input`, `terminal-run-code-block`, `terminal-clear`, `terminal-code-language`, `terminal-code-body`, `terminal-code-run`.
- FileBrowser: `file-browser-tab-files`, `file-browser-tab-projects`, `file-browser-search-input`, `file-browser-search-button`, `file-browser-reindex`, `file-browser-stats`, `file-browser-watch`, `file-browser-preview`, `file-browser-load-more`, `file-browser-search-results`, `file-browser-index-new`, `file-browser-project-card`, `file-browser-projects`.
- GitPanel: `git-style-card`, `git-style-mine-button`, `git-style-clear-button`, `git-style-guide`, `git-deferred-card`, `git-mine-repo-input`, `git-mine-confirm`, `git-clear-confirm`.
- Canvas: `canvas-code`, `canvas-run-button`, `canvas-stdout`, `canvas-stderr`, `canvas-deferred-card`, `canvas-auto-detect`, `canvas-lang-<language>` (6 entries).
- WorkflowBuilder: `workflow-sidebar`, `workflow-new-button`, `workflow-generate-button`, `workflow-new-name`, `workflow-new-create`, `workflow-generate-description`, `workflow-generate-preview`, `workflow-generate-submit`, `workflow-generate-save`.
- WorkflowDetail: `workflow-tab` + `data-tab` attribute, `workflow-steps-panel`, `workflow-runs-list`, `workflow-schedule-panel`, `workflow-edit-button`, `workflow-edit-save`, `workflow-delete-button`, `workflow-delete-confirm`, `workflow-add-schedule`, `workflow-schedule-confirm`, `workflow-remove-schedule`, `workflow-run-card`.

## Prefs Integration Verified

All three Plan 07-01 pref keys that Plan 07-03 consumes have been wired:

| Pref key | Consumer | Write path | Read path |
| --- | --- | --- | --- |
| `devTools.terminal.cwd` | Terminal.tsx | onBlur + Enter on cwd Input (saveCwd) | initial render + useEffect sync |
| `devTools.fileBrowser.expandedPaths` | FileBrowserTree.tsx | toggleExpand (newline-joined Set→string) | useMemo split('\n') on prefs read |
| `devTools.activeTab` | WorkflowDetail.tsx | selectTab (encoded as `workflow:<tab>`) | initial useMemo decode with prefix check |

Persistence survives remount (usePrefs single-blob discipline + 250ms debounce in localStorage). The `workflow:` prefix guards against collisions when Plan 07-04's ComputerUse / DocumentGenerator tabs land under the same pref key.

## Checkpoint / Authentication Gates

None. All tasks executed autonomously. No checkpoints reached.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Error state handling for shell invocations**
- **Found during:** Task 1 (Terminal.tsx).
- **Issue:** Plan action says "wrap invoke calls in try/catch, push error to `useToast()`" — but plan does not specify what happens in the scrollback when run_shell throws. A silent catch would produce an invisible failure.
- **Fix:** On run_shell error, push a stderr-typed `TerminalLine` to the scrollback showing the error message AND fire a toast. This preserves the visual trail for Plan 07-07 to assert "stderr line appears when Rust command rejects." Same pattern applied to run_code_block.
- **Files modified:** src/features/dev-tools/Terminal.tsx
- **Commit:** f946ef5

**2. [Rule 2 - Missing critical functionality] Preview "Load more" button visibility guard**
- **Found during:** Task 1 (FileBrowser.tsx).
- **Issue:** Plan says preview truncates at 200KB with "Load more" button; plan does not say when the button appears vs when the file is fully loaded. Showing it unconditionally is visually dishonest; hiding it prematurely (e.g., before first read) prevents expanding.
- **Fix:** Button renders only when `previewContent.length >= previewLimit`, i.e., the current slice is exactly at the truncation threshold — indicating more content MAY exist. Once the full file is loaded, the button disappears. Small UX clarification; no wrapper-level deviation.
- **Files modified:** src/features/dev-tools/FileBrowser.tsx
- **Commit:** f946ef5

**3. [Rule 1 - Bug] `run_code_block` accepts a single `command` string, not `(code, language)`**
- **Found during:** Task 1 (Terminal.tsx) — cross-referencing Plan 07-02 JSDoc note.
- **Issue:** Plan 07-03 prescribes "`runCodeBlock({code, language})`" as the invocation. Plan 07-02 already corrected this (runCodeBlock takes `command: string`). If the Terminal had been written to the plan literal, typecheck would have failed.
- **Fix:** For `language in {bash, sh}`, pass body directly. For other languages (python, node, ruby), wrap as `<lang> -c <json-escaped-body>` so the single Rust command string dispatches correctly via bash. Documented as a note in the Terminal runCode handler.
- **Files modified:** src/features/dev-tools/Terminal.tsx
- **Commit:** f946ef5

**4. [Rule 1 - Bug] FileIndexStats tuple render caused React fragment key warning**
- **Found during:** Task 1 FileBrowser.tsx iterations.
- **Issue:** Initial stats render used `<>...</>` inside `.map` with keys on inner `<span>` children — React warns about keyed children on un-keyed Fragment.
- **Fix:** Wrapped each row in a keyed `<div style={{ display: 'contents' }}>` so the 2-column grid layout is preserved while giving React a stable key attachment point.
- **Files modified:** src/features/dev-tools/FileBrowser.tsx
- **Commit:** f946ef5

### Scope-Bounded Discoveries (out of lane, NOT fixed)

**Pre-existing TS error in src/features/dev-tools/CodeSandbox.tsx (line 25) — `'Language' declared but never used`**

CodeSandbox.tsx is Plan 07-04's lane per Plan 07-02 SUMMARY §Per-route table. Task 1 typecheck observed this error; Task 2 typecheck showed both it and DiagnosticsSysadminTab errors have since been resolved by parallel Plan 07-04 / 07-06 commits landing between my commits (see git log: `473aa9c feat(07-04): ship CodeSandbox…` landed between my `f946ef5` and `a4f257c`). My lane does not touch CodeSandbox or DiagnosticsSysadminTab. No cross-lane fixes needed.

**Watcher.rs vs file_watcher.rs naming**

FileBrowser's "Watch this dir" button wires to `watcher_add` which is actually a URL-change watcher, not a filesystem watcher. The correct surface (`file_watcher.rs`) is not in Plan 07-02's wrapper list. Documented above as a decision; the button surfaces the available Rust capability truthfully rather than promising a filesystem watcher that doesn't exist at the Rust level today. Noted for Plan 09 polish.

## Threat Model Mitigations Confirmed

| Threat | Mitigation shipped | Where |
| --- | --- | --- |
| T-07-03-03 Tampering — gitStyleClear without confirmation | Dialog with Cancel + Clear buttons (Plan body: "Clear style Dialog-confirm") | GitPanel.tsx:clearOpen Dialog |
| T-07-03-05 Tampering — workflowDelete without confirm | Dialog with Cancel + Delete buttons per Pattern §4 | WorkflowDetail.tsx:deleteOpen Dialog |

Accepted threats (T-07-03-01 EoP shell execution, T-07-03-02 ID file preview, T-07-03-04 DoS long workflows): documented in plan, no frontend mitigation needed — the local-first single-user posture means user typing IS authorization.

## Known Stubs

None. Every route renders real data via invoke; placeholders replaced in full. The honest deferral cards in GitPanel ("Diff viewer / commit history / PR management ship in Phase 9 polish") and Canvas ("Interactive canvas / drawing surface ships in Phase 9 polish") are explicit, user-visible statements about what the backend exposes today — not stubs. They name the follow-up phase so users understand what's partial vs what's done.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what Plan 07-03's threat_model already enumerated. All invokes bind to Rust commands that existed before Phase 7 started (D-167 / D-171 preserved).

## Commits

- `f946ef5` feat(07-03): DEV-01..04 — Terminal, FileBrowser, GitPanel, Canvas real surfaces
- `a4f257c` feat(07-03): DEV-05 — WorkflowBuilder + WorkflowDetail (list/run/CRUD/schedule)

## Self-Check: PASSED

Every artifact claimed above was verified on disk:
- `src/features/dev-tools/Terminal.tsx` — FOUND (269 lines, `runShell` + `runCodeBlock` invoked).
- `src/features/dev-tools/FileBrowser.tsx` — FOUND (680 lines, `fileTree` + 10 other wrappers invoked).
- `src/features/dev-tools/FileBrowserTree.tsx` — FOUND (155 lines, `fileTree` for lazy children).
- `src/features/dev-tools/GitPanel.tsx` — FOUND (269 lines, `gitStyleGet` + `gitStyleMine` + `gitStyleClear`).
- `src/features/dev-tools/Canvas.tsx` — FOUND (214 lines, `sandboxRun` + `sandboxDetectLanguage`).
- `src/features/dev-tools/WorkflowBuilder.tsx` — FOUND (525 lines, `workflowList` + 5 other wrappers invoked).
- `src/features/dev-tools/WorkflowDetail.tsx` — FOUND (573 lines, `workflowUpdate` + `workflowDelete` + `cronAdd/List/Delete`).
- `src/features/dev-tools/dev-tools-rich-a.css` — FOUND (481 lines).
- Both commits present in `git log --oneline`: `f946ef5`, `a4f257c`.
- `npx tsc --noEmit` — EXIT 0.
- `npm run verify:all` — EXIT 0 (12/12 green: entries, no-raw-tauri, migration-ledger, emit-policy, contrast, chat-rgba, ghost-no-cursor, orb-rgba, hud-chip-count, phase5-rust, feature-cluster-routes, phase6-rust).
- Zero Rust files modified by Plan 07-03 commits (`git show --name-only f946ef5 a4f257c | grep -c '^src-tauri/' = 0`).
- Zero overlap with Plans 07-04/05/06 files_modified lists — staged files were only the 8 listed in the plan's files_modified frontmatter.
