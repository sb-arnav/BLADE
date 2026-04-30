---
phase: 18
plan: 04
subsystem: jarvis-ptt-cross-app
tags: [scaffolding, frontend, events, wiring-audit, payloads, snake-case-lock]
type: execute
autonomous: true
requirements: [JARVIS-09, JARVIS-11]
dependency-graph:
  requires:
    - "src/lib/events/index.ts (Phase 17 DOCTOR_EVENT precedent at line 210)"
    - "src/lib/events/payloads.ts (Phase 17 DoctorEventPayload precedent at line 758)"
    - ".planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json (Phase 17 doctor.rs entry at line 7297 used as verbatim template)"
    - "scripts/verify-wiring-audit-shape.mjs (zod schema enforcement; modules.length must equal live .rs count)"
  provides:
    - "BLADE_EVENTS.JARVIS_INTERCEPT = 'jarvis_intercept' (frozen registry constant)"
    - "BLADE_EVENTS.CONSENT_REQUEST = 'consent_request' (frozen registry constant)"
    - "JarvisInterceptPayload TS interface (intent_class, action, capability?, reason?)"
    - "ConsentRequestPayload TS interface (intent_class, target_service, action_verb, content_preview, request_id)"
    - "7 new module rows in 10-WIRING-AUDIT.json (4 core + 3 outbound tentacles)"
  affects:
    - "Plan 18-08 ego.rs::emit_jarvis_intercept will emit_to('main', BLADE_EVENTS.JARVIS_INTERCEPT, JarvisInterceptPayload) — wire form already locked here"
    - "Plan 18-14 jarvis_dispatch.rs::emit_consent_request will emit_to('main', BLADE_EVENTS.CONSENT_REQUEST, ConsentRequestPayload) — wire form already locked here"
    - "Plan 18-17 frontend MessageList.tsx will consume JARVIS_INTERCEPT via useTauriEvent<JarvisInterceptPayload>(...) for inline JarvisPill rendering"
    - "Plan 18-17 frontend ChatPanel.tsx will consume CONSENT_REQUEST via useTauriEvent<ConsentRequestPayload>(...) for ConsentDialog modal"
    - "verify-wiring-audit-shape gate is now green for the 7 new Phase 18 modules at Wave 0 (preempts Phase 17 Wave-5 patch pattern)"
tech-stack:
  added: []
  patterns:
    - "BLADE_EVENTS frozen registry pattern (`as const` literal-narrowing) — Phase 18 follows the Phase 17 DOCTOR_EVENT precedent verbatim with 5-line section comments (banner + emit-site reference + payload pointer + entry)"
    - "snake_case wire form lock between Rust #[serde(rename_all=\"snake_case\")] and TS interface field names — JSDoc on each interface points to the Rust emit site so drift is caught in code review (D-38-payload accepted manual review risk)"
    - "10-WIRING-AUDIT.json doctor.rs Phase 17 patch as the canonical template for late-added modules: classification=ACTIVE, purpose (concrete), trigger (#[tauri::command] body), commands[].name in module::command form (CommandName regex), registered file:line, invoked_from=null when no frontend consumer yet, internal_callers=[], reachable_paths populated"
    - "emit_to('main', ...) single-window strategy means NO emit-policy allowlist entry is required — Plan 18 follows the Phase 17 doctor.rs precedent (verified against verify-emit-policy: 60 broadcasts unchanged)"
key-files:
  created:
    - ".planning/phases/18-jarvis-ptt-cross-app/18-04-SUMMARY.md (this file)"
  modified:
    - "src/lib/events/index.ts (+15 lines: 2 new BLADE_EVENTS constants under Phase 18 banners after DOCTOR_EVENT)"
    - "src/lib/events/payloads.ts (+38 lines: Phase 18 banner + 2 payload interfaces with snake_case fields + JSDoc tying each to its Rust emit site)"
    - ".planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json (+144 lines: 7 module entries appended after doctor.rs entry; modules.length 197 → 204)"
decisions:
  - "JARVIS_INTERCEPT string value = 'jarvis_intercept' (D-19) — must match Rust emit_to(\"main\", \"jarvis_intercept\", ...) literal exactly when Plan 08 lands. CONSENT_REQUEST = 'consent_request' similarly locked for Plan 14."
  - "Snake_case wire form locked at the field level: intent_class / target_service / action_verb / content_preview / request_id — each TS interface field corresponds 1:1 with #[serde(rename_all=\"snake_case\")] Rust struct fields; ghost-snake_case landmine from Phase 17 PATTERNS.md is the precedent driving the explicit JSDoc note on every interface."
  - "JarvisInterceptPayload.action is a literal union ('intercepting' | 'installing' | 'retrying' | 'hard_refused') — Plan 17 frontend consumer (MessageList) gets exhaustiveness checking from TS; Rust side will mirror this with an enum + #[serde(rename_all=\"snake_case\")]."
  - "JarvisInterceptPayload uses optional fields (capability?, reason?) rather than discriminated union — keeps interface flat, allows JSDoc to document which action variants populate which optional. Discriminated union deferred until shape stabilizes (single-source-of-truth lives Rust-side per D-38-payload)."
  - "ConsentRequestPayload.content_preview is documented as 'safe_slice'd to 200 chars Rust-side' — content cap enforced upstream per CLAUDE.md non-ASCII safe_slice rule + T-18-CARRY-12 (Information Disclosure mitigation accepted-by-design: user MUST see content to consent)."
  - "ConsentRequestPayload.request_id added (not in original CONTEXT.md D-08 sketch) — needed for the consent-response correlation channel Plan 14 will introduce (60s timeout → assumed deny). Adding it to the payload now avoids a wire-form revision in Plan 14."
  - "10-WIRING-AUDIT.json entries follow the schema's CommandName regex `^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$` exactly — every command name is qualified as `<module>::<command>` (e.g. `ego::ego_intercept`), matching the doctor.rs Phase 17 patch verbatim. Bare command names (e.g. `ego_intercept`) would fail zod validation."
  - "All 7 modules classified ACTIVE despite skeleton-only state per Phase 18 Plans 18-01..03 — matches the Phase 17 doctor.rs convention (registered #[tauri::command] = ACTIVE even with stub body); WIRED-NOT-USED would only apply if the command is registered but never callable from frontend or internally."
  - "invoked_from = null on every entry — Wave 0 skeletons have no frontend consumer yet (consumer plans 18-17 + later); doctor.rs entry shows `invoked_from: 'src/lib/tauri/admin.ts:1853'` for a wired call site, which is the right form to flip to once Plan 17 ships."
  - "registered file:line points at command body line (e.g. ego.rs:60) rather than the #[tauri::command] attribute line — matches doctor.rs precedent (which points at line 771 = `pub async fn doctor_run_full_check(` body declaration)."
metrics:
  duration: "~3.5 min execution + 30s verification"
  completed: "2026-04-30T15:30Z"
  task_count: 2
  test_count_added: 0
  files_created: 1
  files_modified: 3
  commits: ["ea34fbe", "708856b"]
threat-flags: []
---

# Phase 18 Plan 04: Frontend Event Surface + WIRING-AUDIT Preempt Summary

**One-liner:** BLADE_EVENTS gains JARVIS_INTERCEPT + CONSENT_REQUEST with snake_case wire form locked at the field level (matching Rust `#[serde(rename_all=\"snake_case\")]`), 2 payload interfaces export with JSDoc citing future Rust emit sites, and 10-WIRING-AUDIT.json gains 7 Phase 18 module entries (4 core + 3 outbound tentacles) at Wave 0 preempting the Phase 17 Wave-5 gate-miss patch pattern — all 5 wiring-audit checks + tsc + emit-policy green on first run.

## What Shipped

### Task 1 — BLADE_EVENTS registry + payload interfaces (commit `ea34fbe`)

**`src/lib/events/index.ts` (+15 lines):**
Two new constants land in the BLADE_EVENTS frozen registry, AFTER the Phase 17 `DOCTOR_EVENT` entry and BEFORE the closing `} as const;`:

```typescript
  // ───── Phase 18 — JARVIS Chat → Cross-App Action (JARVIS-11) ─────────────
  // Emitted by ego.rs::emit_jarvis_intercept (single-window via emit_to("main", ...))
  // on capability_gap / refusal / retry / hard_refused state transitions in the
  // tool-loop branch only. Fast-streaming branch is ego-blind (RESEARCH Pitfall 3).
  // Payload: JarvisInterceptPayload (see ./payloads.ts).
  JARVIS_INTERCEPT: 'jarvis_intercept',

  // ───── Phase 18 — JARVIS Consent Request (JARVIS-05) ─────────────────────
  // Emitted by jarvis_dispatch::emit_consent_request when consent_check returns
  // NeedsPrompt for a (intent_class, target_service) tuple. ChatPanel opens
  // ConsentDialog and awaits user decision (max 60s, then assumed deny).
  // Payload: ConsentRequestPayload (see ./payloads.ts).
  CONSENT_REQUEST: 'consent_request',
```

**`src/lib/events/payloads.ts` (+38 lines):**
Phase 18 banner section + 2 payload interfaces appended AFTER the Phase 17 `DoctorEventPayload`:

```typescript
export interface JarvisInterceptPayload {
  intent_class: string;                                // e.g. "action_required" / "chat_only"
  action: 'intercepting' | 'installing' | 'retrying' | 'hard_refused';
  capability?: string;                                 // present for installing/retrying
  reason?: string;                                     // present for hard_refused
}

export interface ConsentRequestPayload {
  intent_class: string;                                // e.g. "action_required"
  target_service: string;                              // e.g. "slack" / "linear"
  action_verb: string;                                 // human-readable, e.g. "Post message to #team"
  content_preview: string;                             // safe_slice'd to 200 chars Rust-side
  request_id: string;                                  // correlation id for the consent response channel
}
```

Each interface carries a JSDoc block tying it to the future Rust emit site (`src-tauri/src/ego.rs::emit_jarvis_intercept` for Plan 18-08; `src-tauri/src/jarvis_dispatch::emit_consent_request` for Plan 18-14) plus the explicit `#[serde(rename_all = "snake_case")]` Rust note — drift will be caught in code review per D-38-payload.

### Task 2 — 10-WIRING-AUDIT.json preempt (commit `708856b`)

**`.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` (+144 lines):**
7 module entries appended IMMEDIATELY AFTER the Phase 17 `doctor.rs` entry (line 7325) and BEFORE the closing `]` of the modules array — using the doctor.rs Phase 17 patch as a verbatim template:

| # | File | Tauri commands | Notes |
|---|------|---------------|-------|
| 1 | `src-tauri/src/ego.rs` | `ego::ego_intercept` (line 60) | Refusal detector + retry orchestrator (D-11..D-15); body lands Plan 18-08 |
| 2 | `src-tauri/src/intent_router.rs` | `intent_router::intent_router_classify` (line 23) | IntentClass classifier (D-03/D-04); body lands Plan 18-05 |
| 3 | `src-tauri/src/jarvis_dispatch.rs` | `jarvis_dispatch::jarvis_dispatch_action` (line 28) | Outbound fan-out across tentacles/MCP/native_tools (D-05); body lands Plan 18-09 |
| 4 | `src-tauri/src/consent.rs` | `consent::consent_get_decision` (27), `consent::consent_set_decision` (34), `consent::consent_revoke_all` (44) | Per-action consent persistence (D-08); body lands Plan 18-06 |
| 5 | `src-tauri/src/tentacles/slack_outbound.rs` | `slack_outbound::slack_outbound_post_message` (line 21) | Slack chat.postMessage (D-05 priority 1); body lands Plan 18-11 |
| 6 | `src-tauri/src/tentacles/github_outbound.rs` | `github_outbound::github_outbound_create_pr_comment` (26), `github_outbound::github_outbound_create_issue` (41) | GitHub PR comment + issue create; body lands Plan 18-12 |
| 7 | `src-tauri/src/tentacles/gmail_outbound.rs` | `gmail_outbound::gmail_outbound_send` (line 20) | Gmail send via OAuth or MCP fallback; body lands Plan 18-13 |

Every entry uses `classification: "ACTIVE"`, `internal_callers: []`, `invoked_from: null` (no frontend consumer yet), `reachable_paths` populated with `invokeTyped(\"<command>\") -> <file>:<line>` strings, and concrete `purpose` + `trigger` strings citing the relevant CONTEXT.md decisions (D-05, D-06, D-08, D-11..D-15) and follow-up plans.

The `commands[].name` field follows the schema's `CommandName` regex `^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$` (qualified `<module>::<command>` form) — matches the doctor.rs precedent and zod validates clean.

`modules.length` advanced from 197 → 204, exactly matching the live `.rs` file count under `src-tauri/src/` (excluding `evals/` per the script's `#[cfg(test)]` filter at line 170).

## Verification

- `npx tsc --noEmit` → exit 0 (no TS errors; literal-narrowing `as const` preserved in BLADE_EVENTS).
- `node scripts/verify-wiring-audit-shape.mjs` → all 5 checks OK:
  - `modules` (204 .rs files match modules.length)
  - `routes` (88 feature-cluster routes match routes.length — unchanged)
  - `config` (all 53 BladeConfig pub fields represented)
  - `not-wired` (99 rows all have file:line entry points)
  - `dead` (1 row has callers[]/imports[]/safe_to_delete:boolean)
- `node scripts/verify-emit-policy.mjs` → OK (60 broadcast emits match cross-window allowlist; no new emit site yet — Plan 18-08 will add `jarvis_intercept` via `emit_to("main", ...)` single-window pattern, NO allowlist entry required).
- `node -e "require('./.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json')"` → exit 0 (JSON parses cleanly).
- `grep -n "JARVIS_INTERCEPT: 'jarvis_intercept'" src/lib/events/index.ts` → 1 match at line 217.
- `grep -n "CONSENT_REQUEST: 'consent_request'" src/lib/events/index.ts` → 1 match at line 224.
- `grep -n "as const;" src/lib/events/index.ts` → 1 match (frozen-form preserved).
- `grep -n "export interface JarvisInterceptPayload" src/lib/events/payloads.ts` → 1 match at line 785.
- `grep -n "export interface ConsentRequestPayload" src/lib/events/payloads.ts` → 1 match at line 797.

## Acceptance Criteria

- [x] BLADE_EVENTS gains JARVIS_INTERCEPT + CONSENT_REQUEST with snake_case wire form locked
- [x] JarvisInterceptPayload + ConsentRequestPayload exported with snake_case fields matching Rust serde
- [x] 10-WIRING-AUDIT.json gains 7 new entries (4 core + 3 tentacles)
- [x] All static gates green: tsc + verify:wiring-audit-shape + verify:emit-policy
- [x] Phase 17 entries (DOCTOR_EVENT, ACTIVITY_LOG, doctor.rs entry) UNCHANGED
- [x] Each task committed atomically with `feat(18-04)` / `chore(18-04)` prefix and no Co-Authored-By line

## Wire-Form Snake_Case Lock — verified Rust ↔ TS field correspondence

| TS field (payloads.ts) | Rust field (future, with `#[serde(rename_all="snake_case")]`) | Plan landing |
|---|---|---|
| `intent_class: string` | `intent_class: String` (or `IntentClass` enum with snake_case rename) | 18-05 (router) / 18-08 (ego emit) / 18-14 (dispatch emit) |
| `action: 'intercepting' \| 'installing' \| 'retrying' \| 'hard_refused'` | `action: EgoAction` enum with `#[serde(rename_all="snake_case")]` | 18-08 |
| `capability?: string` | `capability: Option<String>` | 18-08 |
| `reason?: string` | `reason: Option<String>` | 18-08 |
| `target_service: string` | `target_service: String` | 18-14 |
| `action_verb: string` | `action_verb: String` | 18-14 |
| `content_preview: string` (200-char-capped) | `content_preview: String` (safe_slice'd Rust-side) | 18-14 |
| `request_id: string` | `request_id: String` (Uuid::new_v4().to_string()) | 18-14 |

If a future Rust struct fails to add `#[serde(rename_all="snake_case")]` or uses CamelCase field names, the TS interface will silently skip the wrong fields at runtime (`e.payload.intentClass === undefined` instead of `intent_class`) — Phase 17 PATTERNS.md ghost-snake_case landmine; Plan 17 frontend consumer is the catch surface in code review.

## Deviations from Plan

None — plan executed exactly as written.

## Open / Hand-off

- **Plan 18-05 (intent_router body):** Implements `IntentClass` enum + `classify_intent` heuristic + LLM fallback. MUST use `#[serde(rename_all="snake_case")]` on the enum so JSON output matches the `intent_class` field locked here.
- **Plan 18-06 (consent body):** Implements `consent_check` returning `ConsentVerdict::NeedsPrompt`, plus `consent_get_decision` / `consent_set_decision` / `consent_revoke_all` bodies. The 3 commands are already audited at the right line numbers.
- **Plan 18-08 (ego emit):** Adds `emit_jarvis_intercept(app, JarvisInterceptPayload)` helper using `app.emit_to("main", "jarvis_intercept", payload)` — single-window, NO allowlist entry needed (verify-emit-policy already accepts this pattern via the doctor.rs Phase 17 precedent).
- **Plan 18-09 (dispatch body):** Implements `jarvis_dispatch_action`; calls `consent::consent_check` first; if NeedsPrompt, emits `consent_request` event with `ConsentRequestPayload` (request_id correlates to the response channel).
- **Plan 18-14 (consent dispatch + 60s timeout):** Adds `emit_consent_request(app, ConsentRequestPayload)` helper + the response correlation channel keyed by `request_id`; 60s timeout → assumed deny.
- **Plan 18-17 (frontend consumers):** MessageList.tsx subscribes via `useTauriEvent<JarvisInterceptPayload>(BLADE_EVENTS.JARVIS_INTERCEPT, ...)` for inline JarvisPill rendering; ChatPanel.tsx subscribes via `useTauriEvent<ConsentRequestPayload>(BLADE_EVENTS.CONSENT_REQUEST, ...)` for ConsentDialog modal. Once Plan 17 ships, the 7 wiring-audit `invoked_from: null` slots flip to point at the consumer file:line.
- **Wiring-audit upkeep:** When Plan 18-08 + 18-14 add their respective emit helper functions, the audit entries do NOT need modification — `registered` already points at the command body declaration; the helper fn additions are internal and don't change the Tauri command surface.

## Self-Check: PASSED

- File `src/lib/events/index.ts` modified — JARVIS_INTERCEPT at line 217, CONSENT_REQUEST at line 224 — FOUND.
- File `src/lib/events/payloads.ts` modified — JarvisInterceptPayload at line 785, ConsentRequestPayload at line 797 — FOUND.
- File `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` modified — modules.length = 204 with 7 new Phase 18 entries appended after doctor.rs — FOUND.
- Commit `ea34fbe` (Task 1: feat(18-04) BLADE_EVENTS + payloads) — FOUND in git log.
- Commit `708856b` (Task 2: chore(18-04) WIRING-AUDIT preempt) — FOUND in git log.
- `npx tsc --noEmit` → exit 0 — VERIFIED.
- `node scripts/verify-wiring-audit-shape.mjs` → all 5 checks OK — VERIFIED.
- `node scripts/verify-emit-policy.mjs` → OK (60 broadcasts) — VERIFIED.
