# Phase 18: Chat → Cross-App Action — Context

**Gathered:** 2026-04-30
**Status:** Ready for research + planning
**Source:** Direct decisions by orchestrator under operator's chat-first pivot (2026-04-30 session). No interactive Q&A round — operator delegated with "go cook" after stating the v1.2 frame: "we only need a chat place capable enough to do anything."

> **Pivot note:** The roadmap title for Phase 18 is "JARVIS Push-to-Talk → Cross-App Action." Under the chat-first pivot, the high-leverage half is the action+ego loop, not the voice input. PTT/STT is **DEFERRED to v1.3** (D-04 below). The phase is renamed in this CONTEXT to **Chat → Cross-App Action** to reflect actual scope. ROADMAP.md remains source-of-truth for the original locked title; the rename is contextual, not a roadmap edit.

<domain>
## Phase Boundary

Phase 18 ships the chat-capability spine BLADE has been wired for since v1.0:

1. **Text chat** → user types a command (e.g. "post a heads-up to #team in Slack: shipping the doctor module today")
2. **Intent classifier** → routes to either chat-only (no action) or tool-dispatch (action required)
3. **Tool dispatch** → routes to existing native_tools / MCP / tentacle outbound surface
4. **Per-action consent** → first invocation prompts; persisted decision per (intent_class, target_service)
5. **Action executes** → cross-app write via existing tentacle/MCP surface
6. **Ego post-processor** → if assistant output contains a refusal pattern, intercept; log capability_gap; attempt `auto_install` from `self_upgrade::capability_catalog`; retry once; if still refusing, hard_refuse with logged reason
7. **ActivityStrip emission** → every action turn emits per M-07 contract
8. **Inline JARVIS pill in chat** → user-visible feedback when ego intercepts ("BLADE detected a capability gap (browser); attempting to resolve…")

**Out of scope (locked):**
- **PTT / voice input** — voice path adds STT latency + accuracy issues; deferred to v1.3 (D-04). The existing `voice_global.rs` PTT primitive stays in tree, just not wired into the JARVIS dispatcher in Phase 18.
- **Per-tentacle standalone outbound surface** (full Slack / Email / GitHub / Calendar / Linear as first-class flows) — that's v1.3 ACT-XX. Phase 18 ships the JARVIS-mediated subset only: chat → intent → existing tentacle/MCP outbound.
- **System-tray notifications on action completion** — v1.3 polish.
- **Voice agent mode (always-on listening)** — v1.3+; out of v1.2 entirely.

</domain>

<decisions>
## Implementation Decisions

### Phase scope — chat-first, voice-deferred (operator pivot 2026-04-30)
- **D-01:** **Text chat is the only input surface for Phase 18.** PTT (JARVIS-01) and Whisper STT (JARVIS-02) are deferred to v1.3. JARVIS-12 (cold-install demo) is rewritten as **type a command in chat → BLADE prompts consent → executes real cross-app action → action visible in target service.** Voice can ride on the same dispatcher in v1.3 with zero rework — the dispatcher takes a transcript string, the source of that transcript is irrelevant to the rest of the pipeline.
- **D-02:** **Phase title in this CONTEXT.md = "Chat → Cross-App Action."** Roadmap title stays "JARVIS Push-to-Talk → Cross-App Action" — operator decides whether to update the roadmap title at v1.2 close.

### Intent classification (JARVIS-03)
- **D-03:** **Reuse `router.rs::classify_message`.** It already returns `TaskType` enum; extend with two new task types — `IntentClass::ChatOnly` (no action — pure conversation) and `IntentClass::ActionRequired { service, action }` (cross-app write). Keep the existing `TaskType` enum for model routing; add a parallel `IntentClass` enum specifically for action-vs-chat routing.
- **D-04:** **Heuristic-first, LLM-fallback.** Step 1: regex/keyword rules — if the message contains an action verb + a service-name token (post, send, create, update, comment, draft, reply × Slack/GitHub/Gmail/Calendar/Linear), classify as ActionRequired. Step 2: if ambiguous, send to a small LLM call (haiku-class) that returns one of `{chat, action, capability_gap}`. Cheap, fast, debug-friendly via prompt logging.

### Outbound dispatch (JARVIS-04)
- **D-05:** **Three dispatch backends, in priority order:**
  1. **Existing tentacles** — `calendar_post_meeting_summary`, `calendar_post_meeting_with_draft`, `linear_create_issue` already exist. Phase 18 adds: `slack_post_message`, `github_create_pr_comment`, `gmail_send_draft`, `calendar_create_event`. These reuse the existing observer credentials (D-06 + JARVIS-04 wording).
  2. **MCP tools** (mcp.rs) — if the user has any MCP server installed that exposes a matching tool, prefer it for that target service. Doctrine: if MCP can do it, MCP does it; native tentacle is the fallback when MCP is missing or not auth'd.
  3. **`native_tools.rs`** — for non-tentacle actions (file ops, shell, browser_native, computer_use, system_control). The existing 37+ tools already cover most local actions; chat → action just needs the dispatcher to find them.
- **D-06:** **Credential reuse — observer creds become writer creds with explicit consent.** The existing `OBSERVE_ONLY: AtomicBool` (M-03 lock from v1.1) flips per-tentacle behind explicit user consent + trust escalation. Phase 18 wires consent (D-08) to flip the per-tentacle observe-only flag for the duration of one action; flag flips back to observe-only after the write completes.
- **D-07:** **No new credential storage in Phase 18.** Tentacle creds already live in `keyring`; Phase 18 just adds write paths that reuse them.

### Per-action consent UX (JARVIS-05)
- **D-08:** **Modal consent dialog on first action per (intent_class, target_service) tuple.** Decision persisted in `keyring` (or a new lightweight `consent_decisions` table — research-stage decision). On every subsequent same-tuple action: skip dialog, log to ActivityStrip ("Auto-approved: prior consent for slack_post"). Opt-out path: command palette entry "Revoke all JARVIS consents" clears the persisted decisions.
- **D-09:** **Consent dialog wording is concrete.** Shows: target service name, the actual content being sent (with safe_slice cap if long), the intent verb, "Allow once / Allow always / Deny." Never abstract — the user sees exactly what BLADE is about to do.
- **D-10:** **Hard fail on missing creds.** If the target service has no creds in keyring, the consent dialog instead shows "BLADE doesn't have access to {service}. Connect via Integrations tab → {service}." No silent skip; no auto-install of credentials (that's a separate flow).

### Ego refusal-elimination (JARVIS-06..08)
- **D-11:** **New `src-tauri/src/ego.rs` module.** Public API:
  ```rust
  pub fn intercept_assistant_output(transcript: &str) -> EgoVerdict;
  pub enum EgoVerdict {
      Pass,                                   // no refusal detected
      Refusal { pattern: String, reason: String },
      CapabilityGap { capability: String, suggestion: String },
  }
  pub async fn handle_refusal(app: &AppHandle, verdict: EgoVerdict, original_message: &str) -> EgoOutcome;
  pub enum EgoOutcome {
      Retried { new_response: String },
      AutoInstalled { capability: String, then_retried: String },
      HardRefused { final_response: String, logged_gap: bool },
  }
  ```
- **D-12:** **Refusal detection: ≥5 patterns, ordered most-specific-first.** Initial set per JARVIS-06 wording:
  - `r"(?i)\bI can'?t\b(?: directly)?"`
  - `r"(?i)\bI don'?t have access\b"`
  - `r"(?i)\bI'?m not able to\b"`
  - `r"(?i)\bI cannot directly\b"`
  - `r"(?i)\bI lack the\b"`
  - (extras the planner can add) `r"(?i)\bas an AI\b"`, `r"(?i)\bI'?m unable to\b"`, `r"(?i)\bI don'?t have the (capability|ability|tools)\b"`
  Each pattern is a regex; full set lives in `ego::REFUSAL_PATTERNS: &[(Regex, &str)]` for unit-testability.
- **D-13:** **Capability gap detection precedes refusal classification.** If the assistant output mentions a specific tool or capability ("I'd need a Slack integration", "I don't have a browser tool"), classify as `CapabilityGap` first; route to `evolution_log_capability_gap` + `self_upgrade::auto_install` if the capability is in `capability_catalog`. If the catalog has no match, fall through to `Refusal`.
- **D-14:** **Retry cap = 1 per turn (JARVIS-08).** Atomic counter scoped to the chat-turn-id; resets on next user message. After auto-install, retry once with the new capability available. After retry: hard_refuse → log final reason → no further retries.
- **D-15:** **Hard-refuse output format:** `"I tried, but {reason}. Here's what I'd need: {capability}. You can connect it via {path_in_BLADE}."` — never silent; always tells the user what blocked.

### Capability catalog growth (JARVIS-07 support)
- **D-16:** **`self_upgrade::capability_catalog` extended.** Phase 18 adds entries for: `slack_outbound`, `github_outbound`, `gmail_outbound`, `calendar_write`, `linear_outbound`. Each maps to a "Connect via Integrations tab" action — NOT an `install_cmd` (these are auth flows, not pkg installs). The catalog gains a discriminator `kind: Runtime | Integration` so `auto_install` knows when to shell out vs when to open an integration flow.

### ActivityStrip emission (JARVIS-10)
- **D-17:** **Every action turn emits one ActivityStrip line.** Format: `[JARVIS] {intent_class}: {target_service} → {outcome}`. Outcomes: `executed | denied | auto_approved | hard_refused | capability_gap_logged | retry_succeeded`. Reuse the existing `app.emit_to("main", "blade_activity_log", json!({…}))` pattern from ecosystem.rs:46-58 (already proven in Phase 17 Doctor emission).

### Inline JARVIS pill in chat (JARVIS-11)
- **D-18:** **New event `jarvis_intercept` + chat surface listener.** When ego intercepts, emit `jarvis_intercept` with payload `{intent_class, action: "intercepting"|"installing"|"retrying"|"hard_refused", capability?: string}`. MessageList renders an inline pill (small badge with status text) until the next assistant message lands. Use the existing pill primitive if one exists in design-system; otherwise extend Badge primitive minimally.
- **D-19:** **Add `JARVIS_INTERCEPT: 'jarvis_intercept'` to `BLADE_EVENTS` registry.** Same pattern as Phase 17's `DOCTOR_EVENT`. Frontend consumer goes through `useTauriEvent` per D-13 lock.

### Browser-harness Q1 closure (JARVIS-09)
- **D-20:** **`research/questions.md` does NOT exist yet.** Phase 18 creates it during research with Q1 = "Should ego's auto-install path attempt browser-harness installs (e.g. headless Chromium for browser_native expansion) automatically, or always require explicit consent?" **Verdict (locked here):** Always require explicit consent for browser-harness installs — they're large, slow, and user-perceptible. Routine creds-based capability gaps (Slack OAuth, GitHub PAT) auto-prompt; browser/runtime installs always go through a separate explicit-consent surface.

### Cold-install end-to-end demo (JARVIS-12 rewritten)
- **D-21:** **Demo path = text chat, not voice.** Operator opens BLADE → types into chat: "post 'shipping doctor module today' to #team in Slack" → BLADE shows consent dialog ("Allow BLADE to post to Slack #team?") → operator clicks "Allow once" → BLADE posts → ActivityStrip shows the entry → screenshot saved to `docs/testing ss/jarvis-cold-install-demo.png` per CLAUDE.md UAT path. No voice, no PTT.

### Claude's Discretion (under chat-first frame)
- Exact regex tuning for refusal patterns (planner can adjust the initial set; user revises if needed)
- Consent dialog visual design (use existing Dialog primitive, no new design system work)
- Whether `consent_decisions` lives in `keyring` (BLADE convention) or a new SQLite table (research-stage call)
- Exact wording of the JARVIS pill states (planner drafts, operator can revise)
- Order of dispatch backends within "MCP-or-tentacle" — recommend MCP-first by default (chat-first frame: leverage user's installed tools), tentacle as fallback
- Whether ego logs every refusal pattern hit to a per-pattern counter (helps tune patterns over time) — recommend yes, lightweight
- Whether `intent_router::classify` handles multi-step actions ("post X then comment Y") — defer to v1.3, single-action per turn in Phase 18

### Folded Todos
None — no relevant pending todos in the inbox.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before research/planning.**

### Phase 18 authority
- `.planning/ROADMAP.md` § Phase 18 (lines 115–129) — goal, REQs, success criteria, dependencies, blocks
- `.planning/REQUIREMENTS.md` § JARVIS-01..12 (lines 46–59) — every REQ wording (note: JARVIS-01/02/12 reinterpreted under chat-first pivot per D-01/D-02/D-21 above)
- `.planning/STATE.md` § "Current Focus" — operator's 2026-04-30 chat-first pivot is the load-bearing context for this phase
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — the pivot memory; planner should re-confirm its applicability at plan-stage

### Existing code to reuse / extend (READ before research)
- `src-tauri/src/router.rs:5,19,164` — `TaskType` enum + `classify_task` + `classify_message`. D-03 extends with parallel `IntentClass` enum for action-vs-chat routing.
- `src-tauri/src/self_upgrade.rs:110,284,474,484,490` — `capability_catalog` + 4 internal call-sites. D-16 extends the catalog with integration-kind entries (slack_outbound, github_outbound, gmail_outbound, calendar_write, linear_outbound).
- `src-tauri/src/evolution.rs:1115` — `evolution_log_capability_gap` (DOCTOR-03 source from Phase 17; reused by Phase 18 ego on capability_gap verdict).
- `src-tauri/src/integration_bridge.rs` — observer credentials store + per-service last_poll. D-06 wires consent to flip per-tentacle observe-only flag during action execution.
- `src-tauri/src/tentacles/calendar_tentacle.rs` — already exposes `calendar_post_meeting_summary`, `calendar_post_meeting_with_draft`. Reference for outbound write pattern.
- `src-tauri/src/tentacles/linear_jira.rs` — `linear_create_issue` (existing outbound). Reference for the pattern Phase 18 replicates for Slack / GitHub / Gmail.
- `src-tauri/src/native_tools.rs` — 37+ tools surface. Phase 18 dispatcher routes here for local actions.
- `src-tauri/src/mcp.rs` — MCP client + tool quality ranking. D-05 priority-2 backend.
- `src-tauri/src/ecosystem.rs:46-58` — canonical `app.emit_to("main", "blade_activity_log", …)` pattern (proven in Phase 17 Doctor emission). D-17 reuses this verbatim.
- `src-tauri/src/voice_global.rs` — PTT primitive **stays in tree, NOT wired into Phase 18 dispatcher** per D-01. Available for v1.3 voice resurrection with zero refactor needed.

### Frontend surface (READ before planning)
- `src/lib/events/index.ts` — BLADE_EVENTS frozen registry (Phase 17 added DOCTOR_EVENT; Phase 18 adds JARVIS_INTERCEPT per D-19)
- `src/lib/events/payloads.ts` — payload type interfaces (Phase 17 added DoctorEventPayload; Phase 18 adds JarvisInterceptPayload)
- `src/lib/events/useTauriEvent.ts` (or wherever the hook lives) — D-13 lock from PROJECT.md; only permitted listen() surface
- `src/features/chat/MessageList.tsx` — JARVIS pill renders here on `jarvis_intercept` event (D-18)
- `src/design-system/primitives/{Dialog,Badge}.tsx` — consent dialog (D-08) + JARVIS pill (D-18) reuse these

### Project rules (apply throughout)
- `CLAUDE.md` — module registration 3-step (mod ego; in lib.rs + 3+ entries in generate_handler!); flat #[tauri::command] namespace (zero `ego_*` / `jarvis_*` clashes — verify at research stage); `safe_slice` for non-ASCII content in consent dialogs and chat content; no Co-Authored-By in commits
- `.planning/PROJECT.md` — D-01..D-45 stack rules (no shadcn/Radix, no Framer Motion, no Zustand, no React Router, Tailwind v4 only, useTauriEvent only listen surface)
- `.planning/STATE.md` § v1.1 Locked Decisions — M-03 observe-only guardrail (Phase 18's D-06 is the first explicit per-tentacle flip behind consent + trust escalation, the M-03 wording predicted exactly this); M-07 ActivityStrip contract (D-17 honors)
- `/home/arnav/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` — chat-first pivot — load-bearing for the planner

### v1.1 retraction lesson (apply if Phase 18 touches UI)
- Phase 18 has UI surface (consent dialog, JARVIS pill in chat). Per CLAUDE.md Verification Protocol, Plan 18-XX (verification wave) MUST require runtime UAT — but operator's chat-first pivot says UAT may be deferred for UI polish. **However: end-to-end runtime UAT for the JARVIS-12 cold-install demo is NOT polish — it's the success criterion.** Plan-stage decision: planner produces an end-to-end UAT step that validates an actual cross-app write happens; operator can defer the screenshot+read-back UI fidelity step but NOT the e2e write proof.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`router.rs::classify_message`** — extend with `IntentClass` (D-03/D-04). Existing TaskType stays for model routing.
- **`self_upgrade::capability_catalog`** — extend with integration-kind entries (D-16). Existing pkg-install entries unchanged.
- **`evolution_log_capability_gap` (`evolution.rs:1115`)** — Phase 17 already consumes this for Doctor; Phase 18 reuses for ego capability_gap verdict (D-13).
- **`integration_bridge.rs`** — observer creds store; D-06 wires consent → per-tentacle observe_only flag flip.
- **`mcp.rs`** — MCP tool surface; D-05 priority-2 backend.
- **`ecosystem.rs:46-58`** — `blade_activity_log` emission pattern; D-17 reuses verbatim.
- **`tentacles/calendar_tentacle.rs` + `tentacles/linear_jira.rs`** — existing outbound write patterns; Phase 18 replicates for Slack / GitHub / Gmail.
- **`voice_global.rs`** — PTT stays available; not wired in Phase 18 (D-01).

### New Modules / Files
- `src-tauri/src/ego.rs` — refusal detector + capability_gap classifier + retry orchestrator (D-11..D-15)
- `src-tauri/src/intent_router.rs` (or extend router.rs) — `IntentClass` enum + classify (D-03..D-04)
- `src-tauri/src/jarvis_dispatch.rs` (or fold into ego.rs) — outbound dispatch fan-out across tentacles / MCP / native_tools (D-05)
- `src-tauri/src/tentacles/slack_outbound.rs` — Slack post via existing creds (D-05 priority 1)
- `src-tauri/src/tentacles/github_outbound.rs` — GitHub PR comment / issue create (D-05 priority 1)
- `src-tauri/src/tentacles/gmail_outbound.rs` — Gmail send via OAuth (D-05 priority 1)
- `src/features/chat/JarvisPill.tsx` — inline pill component for chat surface (D-18)
- `src/features/chat/ConsentDialog.tsx` — per-action consent modal (D-08, D-09)
- `research/questions.md` — Q1 closure file for JARVIS-09 (D-20)

### Established Patterns
- **Tauri command + event:** `#[tauri::command] pub async fn ... -> Result<T, String>` registered in `generate_handler!`; events via `app.emit_to("main", ...)`. Phase 18 follows verbatim.
- **Module registration 3-step** — every new module hits lib.rs + generate_handler! per CLAUDE.md.
- **Frontend event listening** — `useTauriEvent` hook only; never raw `listen()`. Phase 18 follows D-13 lock.
- **Lazy-loaded UI surfaces** — chat features lazy-load. JarvisPill + ConsentDialog can be eagerly imported (small) or lazy depending on chat code-split policy.

### Integration Points
- **`lib.rs::generate_handler!`** — register all new commands (intent classify, ego intercept, dispatch_action, consent_get/set, etc.)
- **Existing chat send_message_stream pipeline (`commands.rs`)** — Phase 18 wraps the assistant's final output in `ego::intercept_assistant_output` BEFORE returning to frontend. If verdict ≠ Pass, run handle_refusal flow + emit `jarvis_intercept` events; only the final transcript reaches the chat surface.
- **`integration_bridge.rs::OBSERVE_ONLY` per-tentacle flag** — flipped by consent layer for the duration of one action.
- **`research/questions.md`** — created by Phase 18 research with Q1 closed per D-20.

</code_context>

<specifics>
## Specific Ideas

- **Refusal pattern initial set** (D-12) — 5 patterns mandatory, ~3 stretch. Each pattern includes the matched substring in the EgoVerdict so the test suite can assert pattern coverage exhaustively.
- **Consent dialog content** (D-09) — show:
  - Target service icon + name (e.g. "Slack")
  - Action verb (e.g. "Post message to #team")
  - Content preview (first 200 chars via safe_slice)
  - Three buttons: "Allow once" (default focus) / "Allow always" / "Deny"
- **JARVIS pill states** (D-18):
  - "Detecting capability gap…" (during ego classification)
  - "Installing {capability}…" (during auto_install)
  - "Retrying with {capability}…" (post-install retry)
  - "Couldn't complete: {reason}" (hard_refuse — pill stays until dismissed)
- **Cold-install demo script** (D-21):
  1. Operator types: "post 'shipping doctor module today' to #team in Slack"
  2. ConsentDialog opens; operator clicks "Allow once"
  3. Slack post lands in #team
  4. ActivityStrip shows: `[JARVIS] action_required: slack → executed`
  5. Screenshot: `docs/testing ss/jarvis-cold-install-demo.png` (literal space)
  6. Caption in commit message: "JARVIS-12 e2e: text chat → consent → real Slack post → ActivityStrip emission"

</specifics>

<deferred>
## Deferred Ideas

- **PTT / Whisper STT integration with the JARVIS dispatcher** — defer to v1.3 (D-01). Voice path adds STT latency + accuracy issues; the dispatcher is voice-source-agnostic so wiring it up later is zero-rework.
- **Multi-step action chains** ("post X then comment Y") — Phase 18 handles single-action-per-turn. Chain support → v1.3.
- **Voice-agent always-on listening mode** — out of v1.2 entirely.
- **Per-tentacle standalone outbound surface as first-class flows** (full ACT-XX) — v1.3.
- **System-tray notifications on action completion** — v1.3 polish.
- **LLM-only intent classifier** (skipping the heuristic pre-filter) — keep heuristic-first per D-04; revisit only if the heuristic causes user-visible misclassification.
- **Per-pattern refusal counter dashboard** (Doctor sub-tab — track which refusal patterns hit most) — speculative; v1.3+.
- **Consent decisions UI surface** (list / revoke individual decisions, not just "revoke all") — v1.3 polish.
- **Browser-harness auto-install** — JARVIS-09 verdict is "always require explicit consent" (D-20); browser-tools install path → v1.3 if needed.

</deferred>

---

*Phase: 18-jarvis-ptt-cross-app*
*Context gathered: 2026-04-30 — orchestrator decided D-01..D-21 under operator's chat-first pivot. Discussion log skipped (operator delegated with "go cook"). Downstream agents: read this CONTEXT.md + canonical refs before research/planning. The pivot memory at `~/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` is load-bearing — plans must honor "chat-first, UI-polish-deferred" framing.*
