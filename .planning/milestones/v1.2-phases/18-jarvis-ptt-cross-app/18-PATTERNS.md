# Phase 18: Chat → Cross-App Action — Pattern Map

**Mapped:** 2026-04-30
**Files analyzed:** 22 (9 CREATE + 13 MODIFY)
**Analogs found:** 22 / 22 (every file has a real BLADE analog — zero greenfield)

---

## Pre-flight Namespace Check (flat `#[tauri::command]` namespace)

Live grep against `src-tauri/src/` on 2026-04-30:

| Prefix searched | `#[tauri::command]` clashes | Private fn clashes (NOT Tauri-namespace) | Verdict |
|-----------------|----------------------------|------------------------------------------|---------|
| `ego_*`         | **none** | none | clear |
| `intent_*`      | **none** | `tentacles/terminal_watch.rs:253 fn intent_suggestion` (private helper, not exported) | clear — Phase 18 should still avoid `intent_suggestion` as a name |
| `jarvis_*`      | **none** | none | clear |
| `consent_*`     | **none** | none | clear |
| `dispatch_*`    | **none** | `action_tags.rs:84 async fn dispatch_action` + `goal_engine.rs:416 async fn dispatch_action` (BOTH private to their modules) | clear at the Tauri namespace level — but Phase 18's `jarvis_dispatch::dispatch_action` must be **renamed to `jarvis_dispatch_action`** when registered as a `#[tauri::command]` to avoid reader confusion (the two private `dispatch_action` fns are scoped to their own modules and don't collide via Rust modules, but a flat-named Tauri command would shadow them in greppability) |

**Recommended Tauri command names (planner-locked):**
- `ego_intercept` (or `ego_intercept_assistant_output` if longer is preferred)
- `intent_router_classify`
- `jarvis_dispatch_action` (NOT `dispatch_action` — see clash above)
- `consent_get_decision`
- `consent_set_decision`
- `consent_revoke_all`
- `slack_outbound_post_message`
- `github_outbound_create_pr_comment` (or `github_outbound_create_issue`)
- `gmail_outbound_send`
- `calendar_create_event` (extends existing `calendar_*` family in calendar_tentacle.rs)

**Helper-fn collision watch (NOT in Tauri namespace, but Rust module-private — pick distinct names per module):**
- `now_secs` exists in: `ecosystem.rs:39`, `linear_jira.rs:21`, plus several other tentacles. Phase 18 modules can each have their OWN `now_secs` private fn (Rust modules isolate these).
- `http_client` exists in `linear_jira.rs:47`. Phase 18 outbound tentacles can each have their own.
- `github_token`, `linear_token`, `jira_token` — already in the github/linear modules. Phase 18's `slack_outbound.rs`/`gmail_outbound.rs` can use parallel `slack_token()`/`gmail_token()` private fns reading via `crate::config::get_provider_key("slack")` / `("gmail")`.

---

## File Classification

| New / Modified File | Action | Role | Data Flow | Closest Analog | Match |
|---------------------|--------|------|-----------|----------------|-------|
| `src-tauri/src/ego.rs` | CREATE | new module — refusal detector + verdict + retry orchestrator | request-response (in-process) | `src-tauri/src/router.rs` (classify pattern) + `src-tauri/src/doctor.rs` (Phase 17 module shape) | role-match |
| `src-tauri/src/intent_router.rs` | CREATE | new module — IntentClass enum + `classify_intent` | request-response (in-process + LLM-fallback) | `src-tauri/src/router.rs:5,19,164` (TaskType + classify_message) | exact |
| `src-tauri/src/jarvis_dispatch.rs` | CREATE | new module — outbound fan-out | request-response (calls tentacles/MCP/native_tools) | `src-tauri/src/action_tags.rs:84` (existing `dispatch_action` private fn) + `src-tauri/src/mcp.rs::call_tool` | role-match |
| `src-tauri/src/consent.rs` | CREATE | new module — SQLite consent_decisions CRUD + 3 Tauri commands | CRUD (SQLite) | `src-tauri/src/evolution.rs:1115` (rusqlite + blade.db pattern) + `src-tauri/src/db.rs::timeline_record` | exact |
| `src-tauri/src/tentacles/slack_outbound.rs` | CREATE | new tentacle — Slack post via MCP-or-HTTP | request-response (HTTP/MCP) | `src-tauri/src/tentacles/slack_deep.rs:34` (slack_call MCP wrapper) + `src-tauri/src/tentacles/calendar_tentacle.rs:915` (Tauri command shape) | role-match |
| `src-tauri/src/tentacles/github_outbound.rs` | CREATE | new tentacle — PR comment / issue create | request-response (HTTP) | `src-tauri/src/tentacles/github_deep.rs:164,185,375` (github_token + gh_post + review_pr writer) | exact |
| `src-tauri/src/tentacles/gmail_outbound.rs` | CREATE | new tentacle — Gmail send via OAuth/MCP | request-response (HTTP/MCP) | `src-tauri/src/tentacles/email_deep.rs` (in tentacles/) + slack_outbound MCP-fallback shape | role-match |
| `src/features/chat/JarvisPill.tsx` | CREATE | UI — inline pill component | event-driven (jarvis_intercept) | `src/design-system/primitives/Badge.tsx` (component shape) + `src/design-system/primitives/Pill.tsx` | exact (composition) |
| `src/features/chat/ConsentDialog.tsx` | CREATE | UI — per-action consent modal | request-response (Tauri channel) | `src/features/chat/ToolApprovalDialog.tsx` + `src/design-system/primitives/Dialog.tsx` | exact (same pattern, same primitive) |
| `src-tauri/src/router.rs` | MODIFY | add IntentClass enum (or stays in intent_router.rs) | static | self (existing TaskType enum) | exact |
| `src-tauri/src/ecosystem.rs` | MODIFY | add `WRITE_UNLOCKS` map + `WriteScope` RAII guard + extend `assert_observe_only_allowed(tentacle, action)` | guarded state + RAII | self (existing OBSERVE_ONLY AtomicBool) | role-match |
| `src-tauri/src/self_upgrade.rs` | MODIFY | extend `CapabilityGap` with `kind: Runtime \| Integration` discriminator + 5 new entries in `capability_catalog` | static | self (existing CapabilityGap struct + capability_catalog at l.110-242) | exact |
| `src-tauri/src/commands.rs` | MODIFY | wrap assistant transcript in `ego::intercept_assistant_output` at l.1517 (tool-loop branch ONLY — fast-path branch at l.1166 is documented gap) | hook | self (existing tool-loop branch + action_tags::extract_actions chain) | exact |
| `src-tauri/src/lib.rs` | MODIFY | register 4 new modules + ~9 commands | static | self (Phase 17 doctor.rs registration; supervisor.rs registration block) | exact |
| `src/lib/events/index.ts` | MODIFY | add `JARVIS_INTERCEPT: 'jarvis_intercept'` to BLADE_EVENTS | static | self lines 201-210 (Phase 17 added DOCTOR_EVENT — same pattern) | exact |
| `src/lib/events/payloads.ts` | MODIFY | add `JarvisInterceptPayload` interface | TS interface | self (existing DoctorEventPayload + RoutingCapabilityMissingPayload patterns) | exact |
| `src/features/chat/MessageList.tsx` | MODIFY | render JarvisPill on `jarvis_intercept` event via `useTauriEvent` | event-driven | `src/features/activity-log/index.tsx:84-92` (handler-in-ref + useTauriEvent push pattern) | role-match (MessageList has no event subscription today) |
| `src/features/chat/InputBar.tsx` | MODIFY (note: prompt says "ChatInput.tsx" — the actual file is `InputBar.tsx`) | open ConsentDialog when ActionRequired intent dispatches | request-response | `src/features/chat/ToolApprovalDialog.tsx` (existing approval-modal flow inside chat) | exact |
| `src/features/chat/useChat.tsx` | MODIFY (light) | wire ConsentDialog open/close into the send pipeline | request-response | self (existing send loop + tool-approval state) | exact |
| `src/lib/tauri/admin.ts` (or `chat.ts` / `system.ts`) | MODIFY | add typed wrappers for ego/intent/dispatch/consent commands | request-response | `src/lib/tauri/admin.ts:1485-1503` (Phase 17 supervisorGetHealth/supervisorGetService block; same module pattern) | exact |
| `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` | MODIFY | append entries for 4 new modules + 3 new tentacles (Phase 17 missed and patched in Wave 5) | static | self lines 7297-7325 (Phase 17 doctor.rs entry as template) | exact |
| `.planning/research/questions.md` | MODIFY (NOT create — D-20 path was wrong; file exists at `.planning/research/questions.md` per RESEARCH § Q1 Closure) | append D-20 verdict + flip Status: open → closed | static | self (Q1 stub already in place at top of file) | exact |

---

## Pattern Assignments

### `src-tauri/src/ego.rs` (CREATE)

**Role:** new module — `EgoVerdict` enum + `REFUSAL_PATTERNS` static + `intercept_assistant_output` + `handle_refusal` retry orchestrator + `RETRY_COUNT` atomic + `emit_jarvis_intercept` helper
**Closest analog:** `src-tauri/src/doctor.rs` (Phase 17 — module structure + OnceLock cache + Tauri commands + emission); `src-tauri/src/router.rs:135-220` (classify pattern with regex + heuristic); CONTEXT D-12 verbatim regex set.

**Excerpt — Phase 17 module shape (`doctor.rs` proven analog from 17-PATTERNS.md):**
```rust
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EgoVerdict {
    Pass,
    Refusal { pattern: String, reason: String },
    CapabilityGap { capability: String, suggestion: String },
}

#[tauri::command]
pub fn ego_intercept(transcript: String) -> EgoVerdict {
    intercept_assistant_output(&transcript)
}
```

**Excerpt — `REFUSAL_PATTERNS` static (RESEARCH § Pattern 2; D-12 verbatim regex set):**
```rust
use std::sync::OnceLock;
use regex::Regex;

static REFUSAL_PATTERNS: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();

fn refusal_patterns() -> &'static Vec<(Regex, &'static str)> {
    REFUSAL_PATTERNS.get_or_init(|| vec![
        (Regex::new(r"(?i)\bI can'?t\b(?: directly)?").unwrap(), "i_cant"),
        (Regex::new(r"(?i)\bI don'?t have access\b").unwrap(),   "no_access"),
        (Regex::new(r"(?i)\bI'?m not able to\b").unwrap(),       "not_able"),
        (Regex::new(r"(?i)\bI cannot directly\b").unwrap(),      "cannot_directly"),
        (Regex::new(r"(?i)\bI lack the\b").unwrap(),             "lack_the"),
        (Regex::new(r"(?i)\bas an AI\b").unwrap(),               "as_an_ai"),
        (Regex::new(r"(?i)\bI'?m unable to\b").unwrap(),         "unable_to"),
        (Regex::new(r"(?i)\bI don'?t have the (capability|ability|tools)\b").unwrap(), "no_capability"),
        (Regex::new(r"(?i)\bI'?d need (a |an )?\w+ (integration|tool|api)\b").unwrap(), "need_integration"),  // CapabilityGap precursor
    ])
}
```

**Excerpt — RETRY_COUNT atomic + handle_refusal sketch:**
```rust
use std::sync::atomic::{AtomicU32, Ordering};
static RETRY_COUNT: AtomicU32 = AtomicU32::new(0);

pub fn reset_retry_for_turn() { RETRY_COUNT.store(0, Ordering::SeqCst); }

pub async fn handle_refusal(app: &AppHandle, verdict: EgoVerdict, original: &str) -> EgoOutcome {
    if RETRY_COUNT.fetch_add(1, Ordering::SeqCst) >= 1 {
        // D-14: cap = 1 per turn; D-15: hard-refuse format
        return EgoOutcome::HardRefused { /* ... */ };
    }
    // Route per verdict: CapabilityGap → evolution_log_capability_gap + auto_install (if Runtime kind)
    // → retry once → return EgoOutcome::Retried { new_response }
}
```

**Copy:**
- The Phase 17 module-shape header (`use serde…; use std::sync::OnceLock; use tauri::Emitter;`) and `#[derive(Debug, Clone, Serialize, Deserialize)] #[serde(tag = "kind", rename_all = "snake_case")] pub enum EgoVerdict {…}` (snake_case wire form for TS literal-union match — Phase 17 PATTERNS.md "wire-form snake_case" landmine).
- The `OnceLock` lazy-init pattern from `supervisor.rs:32-46` (also used in Phase 17 doctor.rs) — Phase 18 uses it for `REFUSAL_PATTERNS`.
- The `app.emit_to("main", "jarvis_intercept", ...)` single-window emit form per Phase 17 PATTERNS.md "verify-emit-policy single-window pattern" (NO allowlist entry needed — verified at scripts/verify-emit-policy.mjs).
- `crate::safe_slice(content, 200)` for any user-content slicing (CLAUDE.md non-ASCII rule).

**Adapt:**
- Add `EgoOutcome` enum per CONTEXT D-11: `Retried { new_response } | AutoInstalled { capability, then_retried } | HardRefused { final_response, logged_gap }`.
- The `intercept_assistant_output(transcript: &str) -> EgoVerdict` function applies regex set in order, with the **disjunction-aware "but … can" post-check** per RESEARCH Pitfall 8 (after a regex hit, scan next 80 chars for `\bbut\b.+\bcan\b` — if found, return `Pass` instead).
- CapabilityGap precedes Refusal per CONTEXT D-13 — pattern 9 (`I'd need …`) classifies as `CapabilityGap`, the others as `Refusal`.
- `handle_refusal` calls `crate::evolution::evolution_log_capability_gap(capability, original.to_string())` for the CapabilityGap branch (RESEARCH § Code Examples — verbatim reuse of evolution.rs:1115).
- For Runtime-kind catalog matches: call `crate::self_upgrade::auto_install(...)` then retry; for Integration-kind: skip install, return `HardRefused` with `integration_path` from the catalog.
- Hard-refuse output format LOCKED per CONTEXT D-15: `format!("I tried, but {reason}. Here's what I'd need: {capability}. You can connect it via {path_in_BLADE}.", ...)` — never paraphrase.
- `RETRY_COUNT` is a process-global atomic but should be reset per turn — `commands.rs` calls `ego::reset_retry_for_turn()` at the start of each `send_message_stream` invocation. (Alternative: scope by chat-turn-id stored in a `OnceLock<Mutex<HashMap<TurnId, AtomicU32>>>` — heavier but correct under concurrent turns; recommend simple atomic since BLADE chat is sequential per window.)
- Emit `jarvis_intercept` events at every state transition (`intercepting` → `installing` → `retrying` → `hard_refused`) so MessageList shows the pill progression.

**Watch out (BLADE landmines):**
- **Flat `#[tauri::command]` namespace** — verified clear (zero `ego_*` commands today); pick `ego_intercept` (or `ego_intercept_assistant_output`) for the public command name.
- **Module registration 3-step** — `mod ego;` in lib.rs + `ego::ego_intercept` in `generate_handler!`. **6-place config rule does NOT fire** — Phase 18 adds zero `BladeConfig` fields per RESEARCH § Standard Stack ("Installation: None required").
- **`safe_slice` on transcript content** — every `human_summary` or content slice in `app.emit_to("main", "blade_activity_log", ...)` MUST go through `crate::safe_slice(s, 200)`. Never `&transcript[..200]` (CLAUDE.md non-ASCII rule + memory `feedback_uat_evidence.md`).
- **Single-window emit pattern** — `app.emit_to("main", "jarvis_intercept", ...)` — NO `verify-emit-policy.mjs` allowlist entry needed (RESEARCH Pitfall 5; matches `blade_activity_log` precedent). DO NOT use bare `app.emit("jarvis_intercept", ...)` — that's broadcast and fails the gate.
- **Fast-streaming branch is ego-blind** (RESEARCH Pitfall 3) — ego only fires in the tool-loop branch at commands.rs:1517. The fast streaming branch (l.1166) emits tokens directly without an accumulator — refusals there bypass ego silently. **Plan must document this gap explicitly** ("Phase 18 ego intercept covers the tool-loop branch only").
- **"But I can …" false-positive** (RESEARCH Pitfall 8) — unit tests must include both true positives AND `"I can't help with that, but I can suggest …"` false-positive avoidance.
- **No `cat << 'EOF'` heredoc** — use Write/Edit tools (BLADE policy).
- **Missed-emit silent-regression pattern** — every state transition (intercepting / installing / retrying / hard_refused) MUST call `emit_jarvis_intercept(...)`. One missed branch = pill never updates (memory: `project_chat_streaming_contract.md`).

---

### `src-tauri/src/intent_router.rs` (CREATE) — alternative: extend `router.rs`

**Role:** new module — `IntentClass` enum + `classify_intent` (heuristic-first, LLM-fallback per D-04)
**Closest analog:** `src-tauri/src/router.rs:5,19,164` — TaskType enum + classify_task heuristic (extensive code-signals/complex-signals lookup) + classify_message LLM-fallback path

**Excerpt — existing TaskType pattern (`router.rs:5-16`):**
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum TaskType {
    Simple, Code, Complex, Vision, Creative,
}

pub fn classify_task(message: &str, has_image: bool) -> TaskType {
    if has_image { return TaskType::Vision; }
    let lower = message.to_lowercase();
    let code_signals = ["code", "function", "error", /* ... */];
    let code_score: usize = code_signals.iter().filter(|s| lower.contains(*s)).count();
    // ...
}
```

**Excerpt — target shape per CONTEXT D-03/D-04:**
```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IntentClass {
    ChatOnly,
    ActionRequired { service: String, action: String },
}

#[tauri::command]
pub async fn intent_router_classify(message: String) -> IntentClass {
    classify_intent(&message).await
}

pub async fn classify_intent(message: &str) -> IntentClass {
    let lower = message.to_lowercase();
    // Tier 1: heuristic — action verb × service-name token
    let action_verbs = ["post", "send", "create", "update", "comment", "draft", "reply"];
    let services = [("slack", "slack"), ("github", "github"), ("gmail", "gmail"),
                    ("calendar", "calendar"), ("linear", "linear")];
    for verb in &action_verbs {
        if lower.contains(verb) {
            for (token, service) in &services {
                if lower.contains(token) {
                    return IntentClass::ActionRequired {
                        service: service.to_string(),
                        action: verb.to_string(),
                    };
                }
            }
        }
    }
    // Tier 2: LLM-fallback (haiku-class) — only when heuristic is ambiguous
    // (per D-04; reuse providers::complete_turn with cheap model)
    classify_intent_llm(message).await.unwrap_or(IntentClass::ChatOnly)
}
```

**Copy:**
- The `#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]` derive shape from router.rs:4.
- The `lower = message.to_lowercase()` + `signals.iter().filter(|s| lower.contains(*s))` heuristic style — proven in BLADE for years.
- The `pub fn classify_*` naming convention.
- For LLM-fallback: reuse `crate::providers::complete_turn(...)` exactly as `router.rs:135` already does for ambiguous task classification (LLM call only on heuristic miss).

**Adapt:**
- New enum `IntentClass` is **parallel** to `TaskType` — it does NOT replace it. `TaskType` continues to drive model routing; `IntentClass` drives action-vs-chat. CONTEXT D-03 lock.
- `#[serde(tag = "kind", rename_all = "snake_case")]` on the enum — wire form `{"kind": "action_required", "service": "slack", "action": "post"}` matches the TS literal-union the frontend will use for the `JarvisInterceptPayload.intent_class` field.
- LLM-fallback uses a haiku-class model — recommend `crate::router::select_provider("simple")` to pick the cheapest available, NOT a hardcoded model (CLAUDE.md "Don't hardcode model names" rule).
- Add `#[cfg(test)] mod tests` block (RESEARCH § Validation Architecture Wave 0 gap) with: `classify_chat_only` (returns ChatOnly for "hello world"), `classify_action_required` (returns ActionRequired{slack, post} for "post X to Slack"), `heuristic_short_circuits` (LLM-fallback NOT invoked when heuristic matches).

**Watch out:**
- **Flat namespace** — `intent_router_classify` is unique (`intent_suggestion` in `terminal_watch.rs:253` is a private fn; no clash). Verified clean.
- **Don't ping the LLM unconditionally** — RESEARCH § Anti-Patterns: heuristic must short-circuit ≥80% of inputs; only ambiguous misses go to LLM. Otherwise we double cost.
- **Module registration** — `mod intent_router;` in lib.rs + `intent_router::intent_router_classify` in generate_handler!. Alternative: fold into router.rs and skip the new file. **Recommend separate file for blast-radius isolation** (RESEARCH § Recommended Project Structure).
- **Wire-form snake_case match** — TS literal union in `JarvisInterceptPayload` MUST match `#[serde(rename_all = "snake_case")]` exactly (`"chat_only"` / `"action_required"`). One mismatch = silent runtime payload mis-classification (Phase 17 PATTERNS.md ghost-snake_case landmine).

---

### `src-tauri/src/jarvis_dispatch.rs` (CREATE)

**Role:** new module — `dispatch_action(intent, app)` fan-out across native tentacles → MCP fallback → native_tools last-resort
**Closest analog:** RESEARCH § Dispatch Order Verdict (research-locked); `src-tauri/src/mcp.rs::call_tool` (MCP path); `src-tauri/src/action_tags.rs:84` (existing private `dispatch_action` async fn — same name, different scope, NOT a Tauri command)

**Excerpt — research-supplied target (RESEARCH § Dispatch Order Verdict):**
```rust
use crate::ecosystem::{grant_write_window, WriteScope};

#[derive(Debug, Clone, Serialize)]
pub enum DispatchResult {
    Executed { service: String, payload: serde_json::Value },
    NoConsent,
    HardFailedNoCreds { service: String, suggestion: String },
    NotApplicable,
}

#[tauri::command]
pub async fn jarvis_dispatch_action(
    app: tauri::AppHandle,
    intent: IntentClass,
) -> Result<DispatchResult, String> {
    match intent {
        IntentClass::ActionRequired { service, action } => {
            // RAII guard auto-revokes write window on Drop (panic-safe)
            let _scope: WriteScope = grant_write_window(&service, 30);
            // Tier 1: native tentacle
            if let Some(result) = try_native_tentacle(&service, &action, &app).await {
                emit_jarvis_activity(&app, "action_required", &service, "executed");
                return Ok(result);
            }
            // Tier 2: MCP fallback
            if let Some(result) = try_mcp_tool(&service, &action, &app).await {
                emit_jarvis_activity(&app, "action_required", &service, "executed");
                return Ok(result);
            }
            // Tier 3: native_tools (only for non-service actions)
            try_native_tool(&action, &app).await.map_err(|e| e.to_string())
        }
        IntentClass::ChatOnly => Ok(DispatchResult::NotApplicable),
    }
}
```

**Copy:**
- The `#[tauri::command] pub async fn ... -> Result<T, String>` shape from `calendar_tentacle.rs:915-922`.
- The `emit_jarvis_activity(...)` helper following RESEARCH § Pattern 3 verbatim — this is the canonical `app.emit_to("main", "blade_activity_log", json!({...}))` D-17 emission.
- The RAII `WriteScope` guard pattern from RESEARCH § OBSERVE_ONLY Architecture (verifies on Drop that write window closed even on panic — A4 assumption in RESEARCH).

**Adapt:**
- Native-tentacle priority order (D-05 + RESEARCH § Dispatch Order Verdict locked): if service has a known outbound fn (`linear_create_issue`, `calendar_post_meeting_summary`, the new Phase 18 `slack_outbound::post_message`, `github_outbound::create_pr_comment`, `gmail_outbound::send`, `calendar_create_event`) → call it directly.
- MCP fallback (`mcp::call_tool("mcp__<server>_<tool>", args)` — proven via `slack_deep.rs:34`) is taken ONLY when no native tentacle exists.
- D-17 outcomes (lock): `executed | denied | auto_approved | hard_refused | capability_gap_logged | retry_succeeded` — every dispatch path emits exactly one ActivityStrip entry with one of these outcomes.
- D-10 hard-fail-on-missing-creds: before any tentacle call, check creds via `crate::config::get_provider_key(service)`; if empty, return `DispatchResult::HardFailedNoCreds { suggestion: "Connect via Integrations tab → ..." }`.
- The line format `[JARVIS] {intent_class}: {target_service} → {outcome}` is a **D-17 LOCK** — never paraphrase (RESEARCH § Pattern 3 callout).

**Watch out:**
- **Tauri-command rename to `jarvis_dispatch_action`** — two private `dispatch_action` fns exist (action_tags.rs:84, goal_engine.rs:416). They DON'T collide at the Tauri namespace (they're not `#[tauri::command]`), but a `#[tauri::command] dispatch_action` would be confusing in greps. Use `jarvis_dispatch_action`.
- **WriteScope must be held for the duration of the await** — `let _scope = grant_write_window(...);` keeps it alive until the async fn returns; if you write `let _ = grant_write_window(...);` (without binding) it drops immediately and the window closes before the action runs.
- **30s TTL cap** (RESEARCH § OBSERVE_ONLY) — generous for slow OAuth bounces, narrow enough that a panic-and-leak doesn't open the door indefinitely. DO NOT extend beyond 30s.
- **D-17 ActivityStrip emission** (LOCKED format) — RESEARCH § Pattern 3 says don't paraphrase. The exact line `[JARVIS] {intent_class}: {target_service} → {outcome}` is a lock.
- **Three private `dispatch_action` fns now in tree** — Rust's module isolation handles this fine (each is module-private), but double-check Phase 18's planner reads action_tags.rs:84 + goal_engine.rs:416 and confirms scope before naming.
- **`safe_slice` on emitted summary** — `crate::safe_slice(&format!("[JARVIS] {}: {} → {}", ...), 200)` mandatory.

---

### `src-tauri/src/consent.rs` (CREATE)

**Role:** new module — SQLite `consent_decisions` table + 3 Tauri commands (`consent_get_decision`, `consent_set_decision`, `consent_revoke_all`) + `consent_check` internal helper
**Closest analog:** `src-tauri/src/evolution.rs:1115` (`evolution_log_capability_gap` — rusqlite::Connection::open + blade.db pattern, also used by 9 other modules per RESEARCH Standard Stack); `src-tauri/src/db.rs::timeline_record` API.

**Excerpt — evolution.rs blade.db open pattern (verbatim from RESEARCH § Code Examples):**
```rust
#[tauri::command]
pub fn evolution_log_capability_gap(capability: String, user_request: String) -> String {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::db::timeline_record(
            &conn, "capability_gap",
            &format!("Blocked on: {}", crate::safe_slice(&capability, 80)),
            &user_request, "BLADE",
            &serde_json::json!({"capability": capability}).to_string(),
        );
    }
    format!("Capability gap detected: {}. ...", capability)
}
```

**Excerpt — target schema + CRUD (RESEARCH § Pattern 5):**
```rust
const CONSENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS consent_decisions (
    intent_class    TEXT NOT NULL,
    target_service  TEXT NOT NULL,
    decision        TEXT NOT NULL,    -- 'allow_always' | 'denied'
    decided_at      INTEGER NOT NULL,
    PRIMARY KEY (intent_class, target_service)
);
"#;

fn open_consent_db() -> Result<rusqlite::Connection, String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute(CONSENT_SCHEMA, []).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
pub fn consent_get_decision(intent_class: String, target_service: String) -> Option<String> {
    let conn = open_consent_db().ok()?;
    conn.query_row(
        "SELECT decision FROM consent_decisions WHERE intent_class = ?1 AND target_service = ?2",
        rusqlite::params![intent_class, target_service],
        |row| row.get::<_, String>(0),
    ).ok()
}

#[tauri::command]
pub fn consent_set_decision(intent_class: String, target_service: String, decision: String) -> Result<(), String> {
    // INSERT OR REPLACE …
}

#[tauri::command]
pub fn consent_revoke_all() -> Result<(), String> {
    let conn = open_consent_db()?;
    conn.execute("DELETE FROM consent_decisions", []).map_err(|e| e.to_string())?;
    Ok(())
}
```

**Copy:**
- The `crate::config::blade_config_dir().join("blade.db")` path resolution — used by 9+ modules.
- The `CREATE TABLE IF NOT EXISTS` idempotent-migration pattern — fresh installs and existing installs both work.
- `rusqlite::params![...]` macro for parameterized queries (SQL-injection-safe) — used in evolution.rs and 8 other rusqlite consumers.
- `Result<T, String>` return for Tauri commands (BLADE convention from `commands.rs` patterns).

**Adapt:**
- Schema fields per CONTEXT D-08: composite primary key `(intent_class, target_service)`, `decision` text column with two-state values `allow_always | denied` (RESEARCH § Open Questions Q1: persist only those two; "Allow once" is NOT a row — it's a one-shot dispatch flag that doesn't write).
- 3 Tauri commands per CONTEXT D-08: `consent_get_decision(intent_class, target_service) -> Option<String>` / `consent_set_decision(intent_class, target_service, decision) -> Result<(), String>` / `consent_revoke_all() -> Result<(), String>`.
- Add private helper `consent_check(intent_class, target_service) -> ConsentVerdict` (returns `Allow | Deny | NeedsPrompt`) consumed by `jarvis_dispatch::dispatch_action` BEFORE invoking the outbound.
- For NeedsPrompt: emit a custom event (or use a one-shot Tauri channel — RESEARCH § Assumption A5) so the frontend ConsentDialog opens; await user click; max 60s wait per A5 (timeout → assume "deny" + log).
- Add `#[cfg(test)] mod tests` per RESEARCH Wave 0 gap — test `set_persists`, `get_returns_none_for_unknown`, `revoke_all_clears`. Use a temp DB path for tests (override via env var or seam).

**Watch out:**
- **`SQL in execute_batch!` no double quotes** — CLAUDE.md gotcha. Schema string above uses raw `r#" ... "#` so no escapes; safe.
- **Flat `#[tauri::command]` namespace** — `consent_get_decision`, `consent_set_decision`, `consent_revoke_all` — verified clean (zero `consent_*` commands today).
- **`safe_slice` on logged content** — if consent decisions get logged to activity_log (recommended for D-17), the `human_summary` field MUST go through `crate::safe_slice(s, 200)`.
- **Concurrent connection-open** — `rusqlite::Connection::open` is per-call; 9 modules already do this with no issue; SQLite handles concurrent readers via WAL mode (BLADE's default).
- **Test path injection** — `crate::config::blade_config_dir()` is real-FS based; tests should override via `BLADE_CONFIG_DIR` env var if available, OR plan should refactor `open_consent_db` to take an optional path parameter for testability.

---

### `src-tauri/src/tentacles/slack_outbound.rs` (CREATE)

**Role:** new tentacle — `slack_outbound_post_message(channel, text)` Tauri command + private `post_message` HTTP/MCP fallback
**Closest analog:** `src-tauri/src/tentacles/slack_deep.rs:34` (slack_call MCP wrapper — already proves Slack MCP integration); `src-tauri/src/tentacles/calendar_tentacle.rs:915-922` (Tauri command pub-fn-thin-wrapper-around-private-fn shape).

**Excerpt — slack_deep.rs MCP integration (the only Slack auth path in BLADE today):**
```rust
// slack_deep.rs:34 (paraphrased — full read in research)
async fn slack_call(tool: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let manager = crate::mcp::manager();
    let qualified = format!("mcp__slack_{}", tool);
    manager.call_tool(&qualified, args).await
}
```

**Excerpt — calendar_tentacle.rs Tauri command shape (proven):**
```rust
#[tauri::command]
pub async fn calendar_post_meeting_summary(
    app: AppHandle,
    transcript: String,
    meeting_title: String,
) -> Result<MeetingSummary, String> {
    post_meeting_summary(&app, &transcript, &meeting_title).await
}
```

**Copy:**
- The `#[tauri::command] pub async fn ... -> Result<T, String>` shape from calendar_tentacle.rs:915.
- The thin-wrapper-around-private-fn pattern (Tauri command does only IPC adaption; private fn does the work).
- The MCP qualified-name format `format!("mcp__slack_{}", tool)` from slack_deep.rs:34.
- `crate::config::get_provider_key("slack")` for token retrieval (matches `linear_token`/`github_token` helpers).

**Adapt:**
- Command name: `slack_outbound_post_message(app, channel, text) -> Result<PostResult, String>` per RESEARCH § Code Examples.
- Internal fn: `post_message(app, channel, text)` — checks if Slack MCP is registered (via `mcp::manager().has_tool("mcp__slack_chat.postMessage")`); if yes, dispatch through MCP; if no, fall back to direct Slack Web API HTTP call using `chat.postMessage` endpoint with `Authorization: Bearer <SLACK_BOT_TOKEN>` header.
- D-10 hard-fail-on-missing-creds: if neither MCP-registered NOR `SLACK_BOT_TOKEN` env / keyring → return Err with "Connect via Integrations tab → Slack" suggestion.
- Define `PostResult { ts: String, channel: String, ok: bool }` for the return shape.

**Watch out:**
- **Slack MCP tool name** (RESEARCH Tertiary source A3) — could be `mcp__slack_chat.postMessage` OR `mcp__slack_chat_post_message` depending on which MCP server the operator installed. Plan must runtime-validate (Wave 0 task: enumerate MCP tools and pick the matching one).
- **`assert_observe_only_allowed("slack", "post_message")`** — call this at the top of `post_message` BEFORE any HTTP / MCP call (per Phase 18 D-06 + RESEARCH § OBSERVE_ONLY); the WriteScope held by jarvis_dispatch unlocks it. If somehow called outside dispatch (direct Tauri invoke), the guardrail fires and blocks.
- **`safe_slice` on `text` in any logging** — Slack messages can contain emoji, full-width unicode, etc. Never `&text[..200]`.
- **Module registration** — `pub mod slack_outbound;` in `tentacles/mod.rs` + `tentacles::slack_outbound::slack_outbound_post_message` in lib.rs `generate_handler!`.
- **Demo viability gap** (RESEARCH § Cold-Install Demo) — Slack is D-21's primary target but operator's machine may not have Slack MCP installed. Wave 0 task validates and either prepares Slack MCP install OR falls back to Linear demo (linear_create_issue is guaranteed-creds via existing keyring).

---

### `src-tauri/src/tentacles/github_outbound.rs` (CREATE)

**Role:** new tentacle — `github_outbound_create_pr_comment(owner, repo, pr_number, body)` + `github_outbound_create_issue(owner, repo, title, body)`
**Closest analog:** `src-tauri/src/tentacles/github_deep.rs:164` (github_token), `:185` (gh_post helper), `:375` (review_pr writer call site — proven outbound writer)

**Excerpt — github_deep.rs helpers (verbatim from grep):**
```rust
fn github_token() -> String {
    crate::config::get_provider_key("github")
}

async fn gh_post(
    url: &str,
    token: &str,
    body: serde_json::Value,
) -> Result<reqwest::Response, String> {
    gh_client()
        .post(url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "BLADE-Hive/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("[github_deep] POST {url} failed: {e}"))
}
```

**Excerpt — review_pr posting an actual comment (github_deep.rs:375):**
```rust
let post_resp = gh_post(&review_url, &token, payload).await?;
```

**Copy:**
- `github_token()` helper verbatim — already reads keyring via `crate::config::get_provider_key("github")`.
- `gh_client()`, `gh_post()`, `gh_get()`, `gh_put()` helpers — Phase 18 should `pub use` these from github_deep OR re-implement minimally in github_outbound.rs (recommend re-implementing minimally to avoid coupling).
- The header set: `Authorization: Bearer {token}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: BLADE-Hive/1.0` — proven across 18 github_deep call sites.
- The `Result<reqwest::Response, String>` return shape with `.map_err(|e| format!("[github_outbound] ... failed: {e}"))`.

**Adapt:**
- Two Tauri commands: `github_outbound_create_pr_comment(owner, repo, pr_number, body)` (POST `/repos/{owner}/{repo}/issues/{pr_number}/comments`) and `github_outbound_create_issue(owner, repo, title, body)` (POST `/repos/{owner}/{repo}/issues`).
- D-10 hard-fail check: `github_token()` returns empty string when no PAT → return Err with "Connect via Integrations tab → GitHub" suggestion.
- Add `assert_observe_only_allowed("github", "create_comment")` at top per D-06.
- Define `GhCommentResult { id: u64, url: String }` and `GhIssueResult { number: u64, url: String }` for return shapes.

**Watch out:**
- **Module registration** — `pub mod github_outbound;` in `tentacles/mod.rs` + 2 entries in lib.rs generate_handler!.
- **GitHub PAT scope** — issue/comment create requires `repo` or `public_repo` scope. The user's stored PAT might be read-only — D-10 hard-fail surfaces this before the API call.
- **Rate limits** — GitHub API has 5000 req/hr authenticated. Phase 18 single-action-per-turn (D-21) makes this a non-issue for now; defer rate-limiting to v1.3.
- **`safe_slice` on body before logging** — GitHub markdown bodies can contain emoji. Standard rule.
- **Reqwest error mapping** — match `[github_deep]` prefix style → use `[github_outbound]` for greppability.

---

### `src-tauri/src/tentacles/gmail_outbound.rs` (CREATE)

**Role:** new tentacle — `gmail_outbound_send(to, subject, body)` Tauri command
**Closest analog:** `src-tauri/src/tentacles/email_deep.rs` (existing email tentacle, observer-only) + `slack_outbound.rs` MCP-or-HTTP fallback shape (just authored above)

**Excerpt — same shape as slack_outbound (parallel structure):**
```rust
fn gmail_token() -> String {
    crate::config::get_provider_key("gmail")
}

#[tauri::command]
pub async fn gmail_outbound_send(
    app: tauri::AppHandle,
    to: String,
    subject: String,
    body: String,
) -> Result<SendResult, String> {
    crate::ecosystem::assert_observe_only_allowed("gmail", "send_message")?;
    // Tier 1: Gmail MCP if registered
    if let Some(result) = try_gmail_mcp(&to, &subject, &body, &app).await { return result; }
    // Tier 2: Gmail API HTTP via OAuth token
    send_via_http(&to, &subject, &body).await
}
```

**Copy:**
- Same module-shape and Tauri command signature as `slack_outbound.rs` (just authored).
- `crate::config::get_provider_key("gmail")` token retrieval (parallels linear/github/slack pattern).
- The MCP-or-HTTP fallback chain.

**Adapt:**
- Gmail API endpoint: `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send` with raw RFC 2822 message body base64url-encoded under `raw` field.
- Define `SendResult { id: String, threadId: String }` to mirror Gmail API response.
- D-10 hard-fail: if `gmail_token()` empty AND no Gmail MCP → return Err with "Connect via Integrations tab → Gmail" suggestion.

**Watch out:**
- **Gmail OAuth refresh flow is a different shape** than PATs — the stored token may be an access_token that expired. RESEARCH § Cold-Install Demo Viability flagged Gmail as "operator-machine specific." Plan should defer Gmail OAuth refresh to v1.3 (Phase 18 best-effort: fail gracefully on 401 with "reconnect Gmail" suggestion).
- **base64url encoding for the `raw` field** — Gmail expects URL-safe base64 (no padding, `-_` instead of `+/`); use `base64::engine::general_purpose::URL_SAFE_NO_PAD` from the `base64` crate (already in tree per other tentacles).
- **`safe_slice` on subject + body for logging** — emoji/unicode in email bodies is common.
- **Module registration** in `tentacles/mod.rs` + lib.rs.

---

### `src/features/chat/JarvisPill.tsx` (CREATE)

**Role:** UI — inline pill rendered in MessageList on `jarvis_intercept` event; states per CONTEXT § specifics ("Detecting capability gap…", "Installing {capability}…", "Retrying with {capability}…", "Couldn't complete: {reason}")
**Closest analog:** `src/design-system/primitives/Badge.tsx` (component shape — same `<span>` + tone class) + `src/design-system/primitives/Pill.tsx`

**Excerpt — Badge.tsx (full source, 22 lines):**
```tsx
import type { ReactNode, HTMLAttributes } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'default' | 'ok' | 'warn' | 'hot';
  children: ReactNode;
}

export function Badge({ tone = 'default', children, className = '', ...rest }: BadgeProps) {
  const cls = ['badge', tone !== 'default' ? `badge-${tone}` : '', className]
    .filter(Boolean)
    .join(' ');
  return <span className={cls} {...rest}>{children}</span>;
}
```

**Copy:**
- The `interface ...Props extends HTMLAttributes<HTMLSpanElement>` + `tone` discriminator pattern.
- The `cls` array `.filter(Boolean).join(' ')` className composition.
- The exported function-component shape (no React.FC; named function per BLADE convention).

**Adapt:**
- `JarvisPill` accepts a `payload: JarvisInterceptPayload | null` prop (typed against the new payloads.ts interface).
- Render branches per `payload.action`:
  - `'intercepting'` → "Detecting capability gap…" with tone `default`
  - `'installing'` → `Installing ${payload.capability}…` with tone `warn`
  - `'retrying'` → `Retrying with ${payload.capability}…` with tone `warn`
  - `'hard_refused'` → `Couldn't complete: ${payload.reason}` with tone `hot` + dismiss button
- Use the existing `Badge` primitive directly OR extend it (CONTEXT D-18 says "extend Badge primitive minimally" — recommend wrapping Badge in JarvisPill rather than modifying Badge itself, blast-radius isolation).
- `aria-live="polite"` so screen readers announce state transitions.

**Watch out:**
- **Ghost-token trap (v1.1 retraction trigger)** — UI-SPEC tokens locked. Use ONLY existing `--status-success / --a-warm / --a-hot / --a-ok / --a-warn / --t-1..--t-4 / --line / --r-pill / --s-1..--s-4`. NEVER invent `--jarvis-*` tokens (memory: `project_ghost_css_tokens.md` — 210 refs across 9 files broke v1.1).
- **Tone mapping** — `default | ok | warn | hot` — Phase 18 maps `intercepting → default`, `installing/retrying → warn`, `hard_refused → hot`. Don't add new tones.
- **No new design system work** (CONTEXT § Claude's Discretion: "Consent dialog visual design — use existing Dialog primitive, no new design system work" — same applies to pill).
- **Dismiss button only for `hard_refused`** — other states clear automatically when next assistant message lands (CONTEXT § specifics).
- **Lazy-loaded?** — JarvisPill is small (~30 lines); recommend eager import in MessageList for instant render. ConsentDialog is heavier and SHOULD be lazy.

---

### `src/features/chat/ConsentDialog.tsx` (CREATE)

**Role:** UI — modal consent dialog per CONTEXT D-08/D-09; opens on first action per (intent_class, target_service) tuple; persists "Allow always"/"Deny"; "Allow once" runs without persisting
**Closest analog:** `src/features/chat/ToolApprovalDialog.tsx` (existing tool-approval modal in same chat feature folder — same pattern, same primitive); `src/design-system/primitives/Dialog.tsx` (the underlying modal primitive)

**Excerpt — Dialog primitive contract (Dialog.tsx:36-48):**
```tsx
interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  ariaLabel?: string;
  triggerRef?: React.RefObject<HTMLElement>;
}

export function Dialog({ open, onClose, children, ariaLabel, triggerRef }: DialogProps) {
  // Native <dialog> + showModal() + focus restore via triggerRef
}
```

**Excerpt — Phase 17 PATTERNS.md Dialog consumption (proven, ActivityDrawer.tsx):**
```tsx
<Dialog open={open} onClose={onClose} ariaLabel="Activity log">
  <div className="activity-drawer-header">
    <h2 className="activity-drawer-title">Activity Log</h2>
    <button onClick={onClose} aria-label="Close">Close</button>
  </div>
  {/* body content */}
</Dialog>
```

**Copy:**
- `Dialog` primitive consumption — `<Dialog open={open} onClose={onClose} ariaLabel="...">` with internal `<header>` + body + footer-buttons layout.
- The `triggerRef` prop for focus restoration (UI-SPEC § 6.6 mandate from Phase 17).
- The `ToolApprovalDialog.tsx` pattern (same chat folder) — same primitive consumer; same modal inside the chat feature.
- BLADE CSS tokens only — `--g-fill-weak`, `--line`, `--r-md`, `--s-3`, `--s-4`, `--t-1`, `--t-3` for backgrounds, borders, spacing, typography.

**Adapt:**
- Props per CONTEXT D-09: `intentClass: string`, `targetService: string`, `actionVerb: string`, `contentPreview: string` (already safe_slice'd Rust-side to 200 chars), `onDecide: (decision: 'allow_once' | 'allow_always' | 'denied') => void`.
- 3 buttons in footer: "Allow once" (default focus per D-09), "Allow always", "Deny".
- Show: target service name (e.g. "Slack"), action verb ("Post message to #team"), content preview (the safe_slice'd text), 3-button row.
- Wire `onDecide('allow_always')` → `consentSetDecision(intentClass, targetService, 'allow_always')` then dispatch action.
- Wire `onDecide('allow_once')` → dispatch action WITHOUT `consentSetDecision` call (per RESEARCH Open Question Q1: persist only allow_always/denied).
- Wire `onDecide('denied')` → `consentSetDecision(intentClass, targetService, 'denied')` then close + log "Denied by user."

**Watch out:**
- **Listener leak (P-06)** — if ConsentDialog uses any tauri event listening, MUST go through `useTauriEvent` (D-13 lock). Direct `listen()` from `@tauri-apps/api/event` is ESLint-banned.
- **Focus restoration via `triggerRef`** — pass the InputBar's send-button ref so focus returns there after dialog close (UI-SPEC § 6.6 mandate from Phase 17). Otherwise focus falls to body.
- **`aria-label` REQUIRED** since the dialog title is dynamic ("Allow BLADE to {action_verb} on {target_service}?").
- **No new design system primitives** — use Dialog + Badge + standard buttons. CONTEXT § Claude's Discretion confirms "no new design system work."
- **Timeout fallback** (RESEARCH § Assumption A5) — max 60s wait; if user doesn't decide, treat as `denied`. Show a countdown? Recommend NO (keeps dialog clean); just log "Timed out — assumed deny" in activity_log.
- **`/blade-uat` mandatory** for the consent dialog UI surface — both viewports (1280×800 + 1100×700), screenshots, contrast script PASS. CONTEXT § canonical_refs explicitly carves out: e2e UAT for JARVIS-12 demo is NOT polish (it's the SC). UI fidelity screenshot can be deferred per chat-first pivot.

---

### `src-tauri/src/router.rs` (MODIFY — minimal; primary work in intent_router.rs)

**Role:** add `IntentClass` enum + `classify_intent` (alternative to creating intent_router.rs as a separate file — RESEARCH recommends separate file for blast-radius isolation)
**Closest analog:** self — existing `TaskType` + `classify_task` + `classify_message` (same file)

**Recommendation:** **Do NOT modify router.rs.** Place `IntentClass` and `classify_intent` in the new `src-tauri/src/intent_router.rs` per RESEARCH § Recommended Project Structure. router.rs stays as-is for model routing; intent_router.rs handles action-vs-chat. This keeps blast radius small (RESEARCH explicit recommendation).

If the planner overrides this and folds into router.rs, follow the existing TaskType pattern verbatim and watch for import cycles (router.rs is imported by ~15 other modules; intent_router.rs has zero imports today).

**Watch out:** Decided in intent_router.rs section above.

---

### `src-tauri/src/ecosystem.rs` (MODIFY — surgical extension)

**Role:** add `WRITE_UNLOCKS: OnceLock<Mutex<HashMap<String, Instant>>>` map + `WriteScope` RAII guard struct + `grant_write_window(tentacle, ttl_secs)` fn + extend `assert_observe_only_allowed(action: &str)` to take a tentacle parameter (research-locked correction to D-06)
**Closest analog:** self — existing `OBSERVE_ONLY: AtomicBool` at l.17 + `assert_observe_only_allowed` at l.26

**Excerpt — current state (verbatim ecosystem.rs:13-35):**
```rust
static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true);

#[allow(dead_code)]
pub fn assert_observe_only_allowed(action: &str) -> Result<(), String> {
    if OBSERVE_ONLY.load(Ordering::SeqCst) {
        return Err(format!(
            "[ecosystem] OBSERVE_ONLY guardrail blocked: {}. \
             Acting capability requires explicit Settings-side enablement (v1.2).",
            action
        ));
    }
    Ok(())
}
```

**Excerpt — Phase 18 target shape (RESEARCH § OBSERVE_ONLY Architecture, locked):**
```rust
use std::sync::{Mutex, OnceLock};
use std::collections::HashMap;
use std::time::{Duration, Instant};

static WRITE_UNLOCKS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

pub struct WriteScope { tentacle: String }

impl Drop for WriteScope {
    fn drop(&mut self) {
        if let Some(map) = WRITE_UNLOCKS.get() {
            if let Ok(mut g) = map.lock() { g.remove(&self.tentacle); }
        }
    }
}

pub fn grant_write_window(tentacle: &str, ttl_secs: u64) -> WriteScope {
    let map = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut g = map.lock().unwrap();
    let deadline = Instant::now() + Duration::from_secs(ttl_secs);
    g.insert(tentacle.to_string(), deadline);
    WriteScope { tentacle: tentacle.to_string() }
}

pub fn assert_observe_only_allowed(tentacle: &str, action: &str) -> Result<(), String> {
    // Per-tentacle override first
    if let Some(map) = WRITE_UNLOCKS.get() {
        if let Ok(g) = map.lock() {
            if let Some(deadline) = g.get(tentacle) {
                if *deadline > Instant::now() { return Ok(()); }
            }
        }
    }
    // Else fall through to global flag
    if OBSERVE_ONLY.load(Ordering::SeqCst) {
        return Err(format!("[ecosystem] OBSERVE_ONLY guardrail blocked: {} on {}", action, tentacle));
    }
    Ok(())
}
```

**Copy:**
- The existing global `OBSERVE_ONLY: AtomicBool` line — **DO NOT remove or change** (M-03 lock; v1.1 baseline preserved).
- The existing error format string structure — extend to include tentacle name.
- The existing `#[allow(dead_code)]` annotation (RAII guard fields are technically unused — Drop fires regardless).

**Adapt:**
- **Backward-compat break:** `assert_observe_only_allowed` now takes 2 args `(tentacle, action)` instead of 1. **No production callers exist yet** (RESEARCH § OBSERVE_ONLY Architecture verified — only test callers). The test at ecosystem.rs:413 must be updated to the new signature. Plan should grep for any other callers (`grep -rn "assert_observe_only_allowed" src-tauri/`) and update them all atomically.
- TTL = 30s default (RESEARCH lock). Plan should NOT make this configurable in Phase 18.
- `WriteScope` is `pub` — used by `jarvis_dispatch.rs` via `let _scope = ecosystem::grant_write_window(...);`.
- Test additions per RESEARCH Wave 0:
  - `write_scope_drops_on_panic` — verify Drop runs on panic-unwind, scope removed from map.
  - `expired_window_blocks` — insert deadline in past, assert assert_observe_only_allowed returns Err.
  - `concurrent_scopes_isolated` — two tentacles unlocked simultaneously, both can write; one drop doesn't affect the other.
- The existing test at l.413 (`assert_observe_only_allowed` test) needs the new signature: `assert_observe_only_allowed("test", "test_action")`.

**Watch out:**
- **M-03 preservation** — RESEARCH explicit: keep the global flag at startup-true, don't invert it. v1.1 lock says "true at startup, never cleared in v1.1" — Phase 18 keeps this and adds the SECOND surface for narrow per-action exceptions.
- **Async Drop** (RESEARCH § Assumption A4) — sync Mutex inside Drop is well-established but worth a unit test. Tokio cancellation: when an async fn holding `_scope` is cancelled mid-await, Drop runs as the future is dropped — verified.
- **`verify-ecosystem-guardrail.mjs` script** (RESEARCH § OBSERVE_ONLY Architecture last paragraph) — must be updated or extended to test the per-tentacle path doesn't accidentally unlock the global flag. Wave 0 task.
- **Lock poisoning** — if the Mutex is poisoned, `g.lock().unwrap()` panics. Acceptable for now (process-level state); revisit in v1.3.
- **30s TTL not configurable** — keep this as a const for v1.2; making it config opens the M-03 escape hatch wider than intended.

---

### `src-tauri/src/self_upgrade.rs` (MODIFY — extend `CapabilityGap` struct + `capability_catalog()`)

**Role:** add `kind: CapabilityKind { Runtime | Integration }` discriminator field + `integration_path: String` field; add 5 Integration-kind entries (slack_outbound, github_outbound, gmail_outbound, calendar_write, linear_outbound) per CONTEXT D-16
**Closest analog:** self — existing `CapabilityGap` struct at l.27-32 + `capability_catalog()` at l.110-242 (proven 18 entries; Phase 18 adds 5 more)

**Excerpt — RESEARCH § Code Examples (Capability Catalog Extension):**
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityGap {
    pub description: String,
    pub category: String,
    pub suggestion: String,
    pub install_cmd: String,           // existing — empty for Integration kind
    #[serde(default)]
    pub kind: CapabilityKind,          // NEW
    #[serde(default)]
    pub integration_path: String,      // NEW — populated for Integration kind
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityKind { Runtime, Integration }

impl Default for CapabilityKind {
    fn default() -> Self { Self::Runtime }   // back-compat with existing 18 entries
}
```

**Excerpt — new catalog entry shape:**
```rust
map.insert("slack_outbound", CapabilityGap {
    description: "BLADE doesn't have a Slack writer integration".to_string(),
    category: "missing_integration".to_string(),
    suggestion: "Connect Slack via Integrations tab".to_string(),
    install_cmd: String::new(),
    kind: CapabilityKind::Integration,
    integration_path: "Integrations tab → Slack".to_string(),
});
```

**Copy:**
- The existing `CapabilityGap` struct shape (Debug/Clone/Serialize/Deserialize) — Phase 18 just adds two fields with `#[serde(default)]` for back-compat.
- The `capability_catalog()` HashMap pattern at l.110-242 — Phase 18 appends 5 entries.
- The existing 18 catalog entries' format (description, category, suggestion, install_cmd) — NEW entries keep this shape and add `kind`+`integration_path`.

**Adapt:**
- 5 new entries: `slack_outbound`, `github_outbound`, `gmail_outbound`, `calendar_write`, `linear_outbound` (CONTEXT D-16 lock).
- Each has `kind: CapabilityKind::Integration` and an `integration_path` like `"Integrations tab → {Service}"`.
- `auto_install` at self_upgrade.rs:290 needs modification (RESEARCH § Code Examples last paragraph): early-return for Integration kind with a message routing the user to `gap.integration_path` (no shell-out).

**Watch out:**
- **Back-compat for existing 18 entries** — they all have `kind: Runtime` (the default via `impl Default`). Existing `#[serde(default)]` ensures deserialization of older serialized state still works.
- **`auto_install` modification** — must check `gap.kind == Integration` BEFORE the existing shell-out branch; if Integration, return `Ok(format!("Connect via {}", gap.integration_path))` early. Critical: if this check is missed, BLADE will try to `npm install` Slack which makes no sense.
- **Public surface** — `pub enum CapabilityKind` and `pub struct CapabilityGap` — the new fields become part of the public type. Any TS bindings must update too (search `src/lib/tauri/` for CapabilityGap consumers — Phase 17 doctor.rs reads capability_catalog).
- **Phase 17 dependency** — Phase 17 doctor.rs reads from this catalog (the capability_gap class signal). Phase 18 must verify Phase 17's reader still works after the `kind` field is added — recommend an integration test in `evals/capability_gap_eval.rs`.
- **No new config fields** — 6-place rule does NOT fire.

---

### `src-tauri/src/commands.rs` (MODIFY — wrap assistant transcript at l.1517 in tool-loop branch ONLY)

**Role:** insert `ego::intercept_assistant_output` wrapper at the tool-loop branch's transcript-materialization point (l.1517), BEFORE `action_tags::extract_actions`
**Closest analog:** self — current code at l.1517 calls `extract_actions(&turn.content)` directly; Phase 18 wraps the input

**Excerpt — current commands.rs:1503-1531 (verbatim from read):**
```rust
if turn.tool_calls.is_empty() {
    // Phase 3 WIRE-03 (Plan 03-01): emit blade_message_start once before
    let msg_id = uuid::Uuid::new_v4().to_string();
    emit_stream_event(&app, "blade_message_start", serde_json::json!({
        "message_id": &msg_id, "role": "assistant",
    }));
    std::env::set_var("BLADE_CURRENT_MSG_ID", &msg_id);
    _current_message_id = Some(msg_id);

    // Extract and execute semantic action tags before emitting to frontend.
    // clean_content has [ACTION:...] tags stripped; actions are dispatched async.
    let (clean_content, parsed_actions) = crate::action_tags::extract_actions(&turn.content);

    // Execute actions in the background (fire-and-forget)
    if !parsed_actions.is_empty() {
        let actions_app = app.clone();
        let actions_clone = parsed_actions.clone();
        tokio::spawn(async move {
            crate::action_tags::execute_actions(actions_clone, &actions_app).await;
        });
    }

    // Final text response — emit word-by-word for streaming feel
    if !clean_content.is_empty() {
        // ... per-char streaming loop
    }
```

**Excerpt — RESEARCH § Code Examples target shape:**
```rust
// commands.rs:1517 (proposed) — INSERT BEFORE the existing extract_actions call
let verdict = crate::ego::intercept_assistant_output(&turn.content);
let final_content = match verdict {
    crate::ego::EgoVerdict::Pass => turn.content.clone(),
    crate::ego::EgoVerdict::CapabilityGap { .. } | crate::ego::EgoVerdict::Refusal { .. } => {
        let outcome = crate::ego::handle_refusal(&app, verdict, &last_user_text).await;
        match outcome {
            crate::ego::EgoOutcome::Retried { new_response }
            | crate::ego::EgoOutcome::AutoInstalled { then_retried: new_response, .. } => new_response,
            crate::ego::EgoOutcome::HardRefused { final_response, .. } => final_response,
        }
    }
};
let (clean_content, parsed_actions) = crate::action_tags::extract_actions(&final_content);
// ... rest of existing flow continues unchanged
```

**Copy:**
- The existing `if turn.tool_calls.is_empty()` branch structure — Phase 18 adds INSIDE this branch, doesn't restructure it.
- The existing `last_user_text` variable (already in scope at l.1517 — verified by reading l.1495-1531) — passed to `handle_refusal` as the original message context.
- The existing `let (clean_content, parsed_actions) = crate::action_tags::extract_actions(...)` line — Phase 18 just changes the input from `&turn.content` to `&final_content`.
- The existing `tokio::spawn(async move { ... })` action-tag execution — unchanged.

**Adapt:**
- Insert exactly between l.1516 and l.1517: the `verdict + handle_refusal + final_content` block.
- BEFORE calling `intercept_assistant_output`, call `crate::ego::reset_retry_for_turn()` at the top of `send_message_stream` (or at l.1503 before the tool-loop branch) so the retry counter starts at 0 per turn.
- The `&app` AppHandle passed to `handle_refusal` is the same `app` already in scope.
- **Fast streaming branch (l.1166) is NOT wrapped** — RESEARCH Pitfall 3 explicit. Document this gap as a comment at the top of the new block: `// Phase 18 ego intercept covers the tool-loop branch only. Fast-streaming refusals are a known gap (Pitfall 3 in 18-RESEARCH.md).`

**Watch out:**
- **Don't restructure the existing tool-loop** — surgical INSERT at l.1517, no reordering. Phase 17 lesson: minimum-blast-radius edits.
- **Async `handle_refusal`** — must be `.await`'d; currently the surrounding fn is async (verified — it's `send_message_stream` which is `async fn`).
- **`last_user_text` scope** — read commands.rs:1495 confirmed `last_user_text` is in scope at l.1517 (it's set earlier in the conversation loop). Plan should grep-confirm during plan stage.
- **Retry-counter reset placement** — must be at the START of `send_message_stream`, NOT inside the loop iteration. Otherwise concurrent tool-loop iterations within the same turn each reset the counter and bypass the cap.
- **Fast-streaming refusals are silent** — RESEARCH Pitfall 3; Phase 18 plan must document this in the chat README or a dedicated GAP.md so users / future contributors know about it.
- **`safe_slice` already in scope** — `crate::safe_slice` is the canonical import; no new imports needed beyond `crate::ego`.

---

### `src-tauri/src/lib.rs` (MODIFY — register 4 new modules + ~9 commands)

**Role:** module + handler registration (the BLADE 3-step rule)
**Closest analog:** self — Phase 17 added `mod doctor;` at l.~80 + 3 doctor commands in `generate_handler!` at l.1340-1341 (per 17-PATTERNS.md)

**Excerpt — Phase 17 module declaration block (`lib.rs:75-85`):**
```rust
mod show_engine;
mod skeleton;
mod sysadmin;
mod social_cognition;
mod symbolic;
mod supervisor;
mod doctor;       // ← Phase 17 added
mod urinary;
mod embeddings;
```

**Copy:**
- The alphabetical/topical mod-block ordering and the `module::command` pattern in `generate_handler!`.
- Phase 17's verbatim 3-step pattern: `mod doctor;` + 3 entries in generate_handler!.

**Adapt:**
- Add 4 new mod declarations near the diagnostic / chat modules:
  ```rust
  mod ego;
  mod intent_router;
  mod jarvis_dispatch;
  mod consent;
  ```
- Add `pub mod slack_outbound;`, `pub mod github_outbound;`, `pub mod gmail_outbound;` to `src-tauri/src/tentacles/mod.rs` (NOT lib.rs — tentacles are sub-modules under `tentacles::`).
- Add ~9 new entries to `generate_handler![]` (alphabetically grouped near related commands):
  ```rust
  ego::ego_intercept,
  intent_router::intent_router_classify,
  jarvis_dispatch::jarvis_dispatch_action,
  consent::consent_get_decision,
  consent::consent_set_decision,
  consent::consent_revoke_all,
  tentacles::slack_outbound::slack_outbound_post_message,
  tentacles::github_outbound::github_outbound_create_pr_comment,
  tentacles::github_outbound::github_outbound_create_issue,
  tentacles::gmail_outbound::gmail_outbound_send,
  // calendar_create_event — added inside tentacles::calendar_tentacle (modify existing module)
  ```

**Watch out:**
- **Step 3 of registration (config 6-place) does NOT apply** — Phase 18 adds zero `BladeConfig` fields per RESEARCH § Standard Stack. The DiskConfig/BladeConfig/load_config/save_config cascade is untouched.
- **Flat `#[tauri::command]` namespace verified clean** — pre-flight check above confirmed zero clashes for `ego_*`/`intent_*`/`jarvis_*`/`consent_*`/`slack_outbound_*`/`github_outbound_*`/`gmail_outbound_*` prefixes.
- **`use tauri::Manager;` not needed** unless one of the new modules calls `app.state()` — Phase 18 doesn't (RESEARCH verified). Use `use tauri::Emitter;` for the emit pattern.
- **Tentacle submodule registration** — `tentacles::slack_outbound::slack_outbound_post_message` is the qualified path in `generate_handler!`. Phase 18 must also `pub mod slack_outbound;` etc. in `tentacles/mod.rs` (currently has `pub mod calendar_tentacle; pub mod cloud_costs; pub mod discord_deep; ...` — Phase 18 appends).

---

### `src/lib/events/index.ts` (MODIFY — append 1 entry to BLADE_EVENTS)

**Role:** add `JARVIS_INTERCEPT: 'jarvis_intercept'` to the frozen registry
**Closest analog:** self — Phase 17 added `DOCTOR_EVENT: 'doctor_event'` at l.210 (same single-event Phase pattern); pre-Phase-17 `ACTIVITY_LOG: 'blade_activity_log'` at l.204

**Excerpt — current state (`index.ts:201-211`, verified by grep):**
```typescript
  // ───── Phase 14 — Activity Log (Plan 14-01, LOG-01..05) ──────────────────
  // Emitted by ecosystem.rs emit_activity_with_id() on every observer tick.
  // Payload: ActivityLogEntry (see src/features/activity-log/index.tsx).
  ACTIVITY_LOG: 'blade_activity_log',

  // ───── Phase 17 — Doctor Module (DOCTOR-06) ──────────────────────────────
  // Emitted by doctor.rs::emit_doctor_event() on severity transitions.
  // Payload: DoctorEventPayload (see ./payloads.ts).
  DOCTOR_EVENT: 'doctor_event',
} as const;
```

**Copy:**
- The 5-line block pattern: section banner comment + 1-line emit-site reference + 1-line payload pointer + 1-line entry.
- The position: BEFORE the closing `} as const;`.
- The `as const` is load-bearing for `BladeEventName` type derivation (Phase 17 PATTERNS.md flagged this).

**Adapt:**
- New entry insertion AFTER `DOCTOR_EVENT` line, BEFORE `} as const;`:
  ```typescript
    // ───── Phase 18 — JARVIS Chat → Cross-App Action (JARVIS-11) ─────────────
    // Emitted by ego.rs::emit_jarvis_intercept on capability_gap / refusal /
    // retry / hard_refused state transitions in the tool-loop branch only.
    // Payload: JarvisInterceptPayload (see ./payloads.ts).
    JARVIS_INTERCEPT: 'jarvis_intercept',
  ```

**Watch out:**
- **`as const` is load-bearing** — `BladeEventName = typeof BLADE_EVENTS[keyof typeof BLADE_EVENTS]` depends on the frozen-literal types (Phase 17 PATTERNS.md landmine).
- **String value MUST match Rust emit string** — `'jarvis_intercept'` mirrors `app.emit_to("main", "jarvis_intercept", ...)` in `ego.rs::emit_jarvis_intercept` (one mismatch = silent no-op subscription — same lesson as Phase 17 DOCTOR_EVENT).
- **NOT in cross-window allowlist** — Phase 18 emits `app.emit_to("main", ...)` (single-window — broadcast to main only); the verify-emit-policy.mjs allowlist does NOT need updating (RESEARCH § F2 / Pitfall 5 / 17-PATTERNS.md ACTIVITY_LOG precedent).

---

### `src/lib/events/payloads.ts` (MODIFY — append 1 interface)

**Role:** TypeScript payload interface for `JARVIS_INTERCEPT`
**Closest analog:** self — Phase 17's `DoctorEventPayload` (already in file per Phase 17 PATTERNS.md); RESEARCH § Pattern 4

**Excerpt — RESEARCH § Pattern 4 target shape (verbatim):**
```typescript
/** Mirrors Rust emit at `src-tauri/src/ego.rs::emit_jarvis_intercept`.
 *  Fires when ego intercepts an assistant turn (capability gap detected,
 *  retry in flight, or hard refusal). MessageList renders an inline pill. */
export interface JarvisInterceptPayload {
  intent_class: string;                                // e.g. "action_required"
  action: 'intercepting' | 'installing' | 'retrying' | 'hard_refused';
  capability?: string;                                 // present for installing/retrying
  reason?: string;                                     // present for hard_refused
}
```

**Copy:**
- The docblock pattern (Phase / Plan / JARVIS-NN reference + emit context) from existing `RoutingCapabilityMissingPayload` (l.58-74) and `DoctorEventPayload` (Phase 17).
- The `export interface XPayload { ... }` shape; field types use TS literal unions for enum-like fields.
- Optional fields use `?:` syntax — proven across 30+ existing payload interfaces.

**Adapt:**
- New interface name: `JarvisInterceptPayload` (matches `JARVIS_INTERCEPT` registry entry; same Pascal-case convention as `DoctorEventPayload`).
- Fields per CONTEXT D-18 + RESEARCH § Pattern 4:
  - `intent_class: string` — the Rust IntentClass serialized as snake_case ("chat_only" / "action_required")
  - `action: 'intercepting' | 'installing' | 'retrying' | 'hard_refused'` — TS literal union
  - `capability?: string` — populated for installing/retrying states
  - `reason?: string` — populated for hard_refused state
- Docblock cites JARVIS-11 + RESEARCH § Pattern 4 + emit site `src-tauri/src/ego.rs::emit_jarvis_intercept`.

**Watch out:**
- **Wire-form snake_case** — Rust serializes `IntentClass::ActionRequired` as `{"kind": "action_required", ...}` per `#[serde(rename_all = "snake_case")]`; the TS literal union MUST match exactly. One mismatch = silent runtime payload mis-classification (Phase 17 PATTERNS.md landmine — same pattern).
- **`unknown` not `any`** — TS `any` is banned in strict mode; for `intent_class` keep it as a `string` (could narrow to `'chat_only' | 'action_required'` but keeping it loose lets future intent classes ship without TS-level breakage).
- **Phase 17 precedent matches exactly** — DoctorEventPayload was added to the same file in the same way; verify the Phase 17 entry is intact and add the new interface in similar position (recommended: AFTER DoctorEventPayload, near the bottom, with a Phase 18 banner).

---

### `src/features/chat/MessageList.tsx` (MODIFY — render JarvisPill on `jarvis_intercept` event)

**Role:** subscribe to `JARVIS_INTERCEPT` via `useTauriEvent`; render `<JarvisPill payload={...} onDismiss={...} />` inline below the live assistant bubble
**Closest analog:** `src/features/activity-log/index.tsx:84-92` (Phase 14 — handler-in-ref + useTauriEvent push subscriber pattern; cited verbatim in Phase 17 PATTERNS.md as the canonical event-subscription analog)

**Excerpt — current MessageList.tsx top (verified by grep):**
```typescript
import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import { useChatCtx } from './useChat';

export function MessageList() {
  // ... currently no event subscription
}
```

**Excerpt — activity-log/index.tsx:84-92 (canonical subscriber pattern):**
```tsx
const logRef = useRef(log);
logRef.current = log;

const handleEvent = useCallback((e: Event<ActivityLogEntry>) => {
  const entry = e.payload;
  const next = [entry, ...logRef.current].slice(0, MAX_ENTRIES);
  logRef.current = next;
  setLog(next);
}, []);

useTauriEvent<ActivityLogEntry>(BLADE_EVENTS.ACTIVITY_LOG, handleEvent);
```

**Copy:**
- The `useTauriEvent<TPayload>(BLADE_EVENTS.X, handler)` hook usage — D-13 lock; the ONLY permitted listen surface.
- The handler-in-ref pattern (`stateRef.current = state` then closure reads ref) — avoids stale-closure bugs with React 18 batching.
- The `useState<TPayload | null>(null)` for storing the latest payload + clearing on next message.

**Adapt:**
- New imports at top:
  ```typescript
  import { useState, useCallback } from 'react';
  import { useTauriEvent, BLADE_EVENTS } from '@/lib/events';
  import type { JarvisInterceptPayload } from '@/lib/events/payloads';
  import { JarvisPill } from './JarvisPill';
  ```
- New state + subscriber inside `MessageList`:
  ```typescript
  const [intercept, setIntercept] = useState<JarvisInterceptPayload | null>(null);
  const handleIntercept = useCallback((e: { payload: JarvisInterceptPayload }) => {
    setIntercept(e.payload);
    // hard_refused stays until user dismisses; others auto-clear when next assistant message lands
  }, []);
  useTauriEvent<JarvisInterceptPayload>(BLADE_EVENTS.JARVIS_INTERCEPT, handleIntercept);
  ```
- Render the pill below the live assistant bubble (or at the bottom of the message list — UI placement decision):
  ```tsx
  {intercept && <JarvisPill payload={intercept} onDismiss={() => setIntercept(null)} />}
  ```
- Auto-clear logic: when a new `chat_done` event fires (existing chat flow), clear `intercept` if `action !== 'hard_refused'`. The cleanest seam is in `useChat.tsx` — set a callback that MessageList consumes via context.

**Watch out:**
- **Listener leak (P-06)** — `useTauriEvent` is the ONLY permitted listen surface. Do NOT import `listen` from `@tauri-apps/api/event` directly (banned by ESLint per `events/index.ts:5`).
- **Stale-closure with React 18 batching** — handler-in-ref pattern avoids this; the `useCallback` empty-deps array is intentional.
- **Auto-clear coordination** — recommend wiring through `useChat` context: when `chat_done` fires, useChat clears intercept. Don't clear on every render — that would race with the event arrival.
- **Cross-window emit not used** — `app.emit_to("main", ...)` reaches MessageList in the main window (the only window with chat). Quickask doesn't have chat in v1.2 per RESEARCH § Open Questions Q3 — emit_to "main" is safe.
- **Pill positioning** — UI fidelity is deferred per chat-first pivot, but the JARVIS-12 demo screenshot will show this; render below the latest assistant bubble (above the input bar). Plan can iterate on placement during UAT.

---

### `src/features/chat/InputBar.tsx` (MODIFY — open ConsentDialog on ActionRequired dispatch)

**Note:** The prompt mentions `ChatInput.tsx` — the actual file in tree is `InputBar.tsx`. Plan should use the actual filename.

**Role:** when the chat send pipeline receives an `IntentClass::ActionRequired` from `jarvis_dispatch`, open ConsentDialog; on user decision, dispatch the action; on deny/timeout, log + show outcome
**Closest analog:** `src/features/chat/ToolApprovalDialog.tsx` (existing tool-approval modal in same chat folder — Phase 18 ConsentDialog is a sibling component with the same lifecycle)

**Excerpt — ToolApprovalDialog approach (existing chat-modal precedent):**
ToolApprovalDialog.tsx already mounts inside the chat feature, listens to a tauri event for tool approval requests, opens via `<Dialog>`, and on user decision invokes a Tauri command to confirm/deny. Phase 18 ConsentDialog mirrors this exact lifecycle.

**Copy:**
- The mount-in-ChatPanel-OR-InputBar pattern from ToolApprovalDialog — existing code already proves modal-within-chat works.
- The `useTauriEvent` listener pattern (matches MessageList's new pattern) for opening the dialog when a "consent_request" event fires.
- The Tauri command roundtrip on decision: `consentSetDecision(...)` for persist + `jarvisDispatchAction(...)` to continue.

**Adapt:**
- ConsentDialog mount point: recommend ChatPanel.tsx (parent of MessageList + InputBar) — mounts once, available to all chat surfaces. **Do not mount inside InputBar** because InputBar might unmount during route change.
- Wire pipeline:
  1. User types in InputBar → submit → useChat sends → backend classifies intent → ActionRequired → backend checks consent_decisions → no row found → emit "consent_request" event with payload.
  2. ChatPanel listens to "consent_request" → setState `pendingConsent` → renders `<ConsentDialog open={!!pendingConsent} ... />`.
  3. User clicks Allow once / Allow always / Deny → ConsentDialog calls `onDecide(decision)` → ChatPanel calls `consentSetDecision(...)` if persistable → calls `jarvisDispatchAction(...)` to execute (or skips for Deny) → emit jarvis_intercept events from backend during dispatch.
- Use the new `consent_request` event — must be added to BLADE_EVENTS too (Phase 18 may need 2 events: `JARVIS_INTERCEPT` for pill + `CONSENT_REQUEST` for dialog).

**Watch out:**
- **Filename correction** — InputBar.tsx, not ChatInput.tsx. Plan must verify (`ls src/features/chat/`).
- **2 events not 1** — RESEARCH didn't explicitly call out a `consent_request` event; the backend needs a way to signal the frontend "open the consent dialog and wait for user decision" before dispatching. Either:
  - (a) Add second event `CONSENT_REQUEST` to BLADE_EVENTS + ConsentRequestPayload to payloads.ts.
  - (b) Use a one-shot Tauri channel (RESEARCH § Assumption A5) — backend awaits frontend response.
  - **Recommend (a)** — simpler, mirrors existing ToolApprovalDialog event pattern, no new IPC mechanism. **Plan must add this event to BLADE_EVENTS** (small extension to the events/index.ts modify task).
- **Dialog mount point** — ChatPanel, not InputBar. Plan must read existing chat structure to find the right parent.
- **Send-button trigger ref** — pass to ConsentDialog's `triggerRef` so focus restores there on close (UI-SPEC § 6.6 mandate from Phase 17).
- **Timeout** — RESEARCH § A5: max 60s wait; on timeout, treat as deny + log "Timed out — assumed deny" to activity_log.

---

### `src/features/chat/useChat.tsx` (MODIFY — light)

**Role:** wire ConsentDialog open/close into the send pipeline; clear `intercept` state on `chat_done`
**Closest analog:** self — existing chat send loop + tool-approval state

**Adapt:**
- Add a `clearIntercept` callback that ChatPanel/MessageList can read to clear the JARVIS pill on `chat_done` (when `action !== 'hard_refused'`).
- Wire `consent_request` event to a `pendingConsent` state ChatPanel reads.
- Surface `consentSetDecision` and `jarvisDispatchAction` invocations through useChat (centralized — InputBar/ChatPanel don't call invoke directly).

**Watch out:** Same as InputBar — listener leak rule, no raw `listen()`.

---

### `src/lib/tauri/admin.ts` (MODIFY — append wrapper exports)

**Role:** typed `invokeTyped` wrappers for the new ego/intent/dispatch/consent/outbound commands
**Closest analog:** self lines 1485-1503 (Phase 17's supervisorGetHealth + supervisorGetService block — `@see` docblock format with file:line + Rust signature; `invokeTyped<TReturn, TArgs?>('command_name', argsObject)` shape)

**Excerpt — Phase 17's pattern (admin.ts:1485-1503, verbatim):**
```typescript
// ═══════════════════════════════════════════════════════════════════════════
// supervisor.rs — background task health (2 commands)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @see src-tauri/src/supervisor.rs:225 supervisor_get_health
 * Rust signature: `supervisor_get_health() -> Vec<ServiceHealth>`.
 */
export function supervisorGetHealth(): Promise<SupervisorService[]> {
  return invokeTyped<SupervisorService[]>('supervisor_get_health');
}
```

**Copy:**
- The section banner format (`════` block with module name + count).
- The `@see` docblock format with file:line + Rust signature.
- The `invokeTyped<TReturn, TArgs?>('command_name', argsObject)` shape.

**Adapt:**
- New section banners + wrappers (ordered by module):
  ```typescript
  // ═══════════════════════════════════════════════════════════════════════════
  // ego.rs — refusal detector + retry orchestrator (1 command)
  // ═══════════════════════════════════════════════════════════════════════════
  export function egoIntercept(transcript: string): Promise<EgoVerdict> { ... }

  // ═══════════════════════════════════════════════════════════════════════════
  // intent_router.rs — IntentClass classification (1 command)
  // ═══════════════════════════════════════════════════════════════════════════
  export function intentRouterClassify(message: string): Promise<IntentClass> { ... }

  // ═══════════════════════════════════════════════════════════════════════════
  // jarvis_dispatch.rs — outbound fan-out (1 command)
  // ═══════════════════════════════════════════════════════════════════════════
  export function jarvisDispatchAction(intent: IntentClass): Promise<DispatchResult> { ... }

  // ═══════════════════════════════════════════════════════════════════════════
  // consent.rs — per-action consent decisions (3 commands)
  // ═══════════════════════════════════════════════════════════════════════════
  export function consentGetDecision(intentClass: string, targetService: string): Promise<string | null> { ... }
  export function consentSetDecision(intentClass: string, targetService: string, decision: string): Promise<void> { ... }
  export function consentRevokeAll(): Promise<void> { ... }

  // ═══════════════════════════════════════════════════════════════════════════
  // tentacles/{slack,github,gmail}_outbound.rs — write paths (4 commands)
  // ═══════════════════════════════════════════════════════════════════════════
  // ... and so on
  ```
- Add types `EgoVerdict`, `IntentClass`, `DispatchResult` to a sibling file (recommend `src/lib/tauri/types.ts` or co-locate in `chat.ts` if Phase 18 adds one). The TS literal unions MUST match the Rust `#[serde(rename_all = "snake_case")]` wire form.

**Watch out:**
- **camelCase arg keys** — Tauri 2 deserializer uses camelCase keys; `invokeTyped`'s `toCamelArgs` converts `{ intent_class: ... }` → `{ intentClass: ... }`. Match Phase 17's pattern exactly (admin.ts:1485-1503 already shows the convention).
- **`SignalClass`/`IntentClass`/`EgoVerdict` type literals MUST match `#[serde(rename_all = "snake_case")]`** — same wire-form contract as the event payloads.
- **`invokeTyped` is the ONLY permitted invoke surface** — banned to import `invoke` from `@tauri-apps/api/core` directly (D-13 + ESLint rule `no-raw-tauri.js`).
- **File location** — Phase 17 added doctor wrappers to `admin.ts`; Phase 18 wrappers may be a better fit in a new `chat.ts` since they're chat-related, but keeping them in `admin.ts` matches the precedent of "wrappers for Tauri commands live here." Plan should pick one and stick with it; no split-file inconsistency.

---

### `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` (MODIFY — append entries)

**Role:** wiring-audit JSON entries for 4 new modules + 3 new tentacles; Phase 17 missed this and patched in Wave 5 (RESEARCH Pitfall 6)
**Closest analog:** self lines 7297-7325 (Phase 17 doctor.rs entry — verified by grep)

**Excerpt — Phase 17 doctor.rs entry shape (line numbers from grep):**
```json
{
  "file": "src-tauri/src/doctor.rs",
  "module": "...",
  "tauri_commands": [
    { "name": "doctor_run_full_check", "registered": "src-tauri/src/doctor.rs:771" },
    { "name": "doctor_get_recent",     "registered": "src-tauri/src/doctor.rs:827" },
    { "name": "doctor_get_signal",     "registered": "src-tauri/src/doctor.rs:842" }
  ],
  "frontend_consumers": [
    "invokeTyped(\"doctor_run_full_check\") -> src-tauri/src/doctor.rs:771",
    "invokeTyped(\"doctor_get_recent\") -> src-tauri/src/doctor.rs:827",
    "invokeTyped(\"doctor_get_signal\") -> src-tauri/src/doctor.rs:842"
  ]
}
```

**Copy:** the exact JSON shape.

**Adapt:** Append 7 new entries (one per new module + tentacle):
- `src-tauri/src/ego.rs` (1 command: ego_intercept)
- `src-tauri/src/intent_router.rs` (1 command: intent_router_classify)
- `src-tauri/src/jarvis_dispatch.rs` (1 command: jarvis_dispatch_action)
- `src-tauri/src/consent.rs` (3 commands: consent_get_decision, consent_set_decision, consent_revoke_all)
- `src-tauri/src/tentacles/slack_outbound.rs` (1 command: slack_outbound_post_message)
- `src-tauri/src/tentacles/github_outbound.rs` (2 commands: github_outbound_create_pr_comment, github_outbound_create_issue)
- `src-tauri/src/tentacles/gmail_outbound.rs` (1 command: gmail_outbound_send)

**Watch out:**
- **Line numbers must match real source** — fill in actual line numbers AFTER the source files exist. Recommend appending placeholder entries in Wave 0 then updating with real line numbers in the final wave (mirrors Phase 17's Wave 5 patch).
- **Wave 0 task** (RESEARCH Pitfall 6) — this MUST be in Wave 0, not deferred. `npm run verify:wiring-audit-shape` fails CI if entries are missing.
- **JSON validity** — comma placement; the file is already large; use careful JSON editing or a JQ-driven script (NOT bash heredoc).

---

### `.planning/research/questions.md` (MODIFY — close Q1 with verdict)

**Role:** flip Q1 status from "open" to "closed" + append D-20 verdict block
**Closest analog:** self — Q1 stub already exists at the top of the file (verified by reading first 20 lines); D-20 path was wrong (RESEARCH § Q1 Closure)

**Excerpt — D-20 verdict text (RESEARCH § Q1 Closure verbatim):**
```markdown
**Verdict — closed 2026-04-30 (Phase 18 research):** Browser-harness installs ALWAYS require explicit consent. They are large, slow, and user-perceptible (downloads a Chromium binary, starts a long-lived process). Routine creds-based capability gaps (Slack OAuth, GitHub PAT, etc.) auto-prompt via the standard consent dialog. Browser/runtime installs go through a separate explicit-consent surface that surfaces install size, time-to-first-use, and disk footprint before downloading. Browser-harness adoption decision (whether to integrate it at all vs. keeping browser_native.rs + browser_agent.rs) is **deferred to v1.3** when Phase 18's chat-action spine is operational and we can measure where browser fallback is actually needed. **Status:** closed.
```

**Copy:** the verdict text verbatim.

**Adapt:**
- Append the verdict block to the existing Q1 entry (after the `**Decision deadline:**` line).
- Change `Status: open` → `Status: closed`.

**Watch out:**
- **Path correction** — D-20 says `research/questions.md` (no `.planning/` prefix); the actual file is at `.planning/research/questions.md`. Plan must MODIFY (NOT create), at the correct path. RESEARCH § Q1 Closure flagged this explicitly.
- **No CI check for this** — RESEARCH § Validation `JARVIS-09` static gate `grep -q "Status: closed" .planning/research/questions.md` — manual proofread required.

---

## Shared Patterns

### Authentication / Authorization
**Source:** existing keyring entries via `crate::config::get_provider_key("...")` (per-provider; reused across all tentacles)
**Apply to:** every new outbound tentacle (slack_outbound, github_outbound, gmail_outbound). NO new credential storage in Phase 18 (CONTEXT D-07).

### Error Handling
**Source:** `src/features/admin/Diagnostics.tsx:83-94` (catch + setError + finally + setLoading false) — Phase 17 PATTERNS.md canonical TS error handler
**Apply to:** ConsentDialog onDecide handler, JarvisPill (no async though), and any new admin.ts wrapper consumers.

```typescript
const refresh = useCallback(async () => {
  setLoading(true);
  try {
    const result = await invokeTypedThing();
    setError(null);
  } catch (e) {
    setError(typeof e === 'string' ? e : String(e));
  } finally {
    setLoading(false);
  }
}, []);
```

For Rust:
```rust
.map_err(|e| format!("[module] action failed: {e}"))
```
— from github_deep.rs gh_post pattern.

### Tauri Event Subscription (D-13 lock)
**Source:** `src/features/activity-log/index.tsx:84-92` (Phase 17 PATTERNS.md canonical) — handler-in-ref + `useTauriEvent`
**Apply to:** MessageList JARVIS_INTERCEPT subscriber, ChatPanel CONSENT_REQUEST subscriber.

### `safe_slice` for activity_log summary + content previews
**Source:** `CLAUDE.md` "non-ASCII string slicing" rule + `src-tauri/src/ecosystem.rs:54` (`crate::safe_slice(summary, 200)`)
**Apply to:** every Rust `app.emit_to("main", "blade_activity_log", ...)` call site (D-17), every consent dialog `content_preview` field, every JARVIS pill string emitted via jarvis_intercept payload. Never `&summary[..200]`.

### ActivityStrip Emission (D-17 LOCK)
**Source:** `src-tauri/src/ecosystem.rs:46-58` (canonical pattern — Phase 17 doctor.rs reused; Phase 18 jarvis_dispatch reuses)
**Apply to:** every dispatch outcome in jarvis_dispatch.rs, every ego state transition that should land in the strip.

```rust
fn emit_jarvis_activity(app: &AppHandle, intent_class: &str, target_service: &str, outcome: &str) {
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "jarvis",
        "action":        outcome,
        "human_summary": crate::safe_slice(
            &format!("[JARVIS] {}: {} → {}", intent_class, target_service, outcome),
            200
        ),
        "payload_id":    None::<String>,
        "timestamp":     now_secs(),
    }));
}
```

### Single-Window Emit Pattern (verify-emit-policy bypass)
**Source:** Phase 17 PATTERNS.md `events/index.ts` modify section + RESEARCH Pitfall 5
**Apply to:** `app.emit_to("main", "jarvis_intercept", ...)` and `app.emit_to("main", "consent_request", ...)` — single-window emits do NOT need allowlist entries in `scripts/verify-emit-policy.mjs`. Only broadcast `app.emit("name", ...)` requires the entry.

### RAII Guard Pattern (Phase 18 NEW)
**Source:** RESEARCH § OBSERVE_ONLY Architecture (research-locked)
**Apply to:** `WriteScope` in ecosystem.rs (only consumer is jarvis_dispatch.rs — `let _scope = grant_write_window(service, 30);`).

### Frozen Registry Append (events + payloads + BLADE_EVENTS)
**Source:** Phase 17 PATTERNS.md `events/index.ts:201-211` modify pattern
**Apply to:** `JARVIS_INTERCEPT` + (potentially) `CONSENT_REQUEST` additions to BLADE_EVENTS; `JarvisInterceptPayload` + (potentially) `ConsentRequestPayload` additions to payloads.ts. Match the 5-line block format verbatim; `as const` is preserved.

---

## No Analog Found

**None.** Every Phase 18 file has a real BLADE analog. This phase is a pure **glue / composition** phase over existing substrate (chat pipeline, tentacle outbound shape, Phase 17 module-registration pattern, ecosystem guardrail, evolution capability_gap logger, mcp call_tool, keyring observer creds, Dialog primitive, Badge primitive, useTauriEvent hook, BLADE_EVENTS registry).

Only one architectural extension is genuinely new: the **per-tentacle WriteScope RAII guard** in ecosystem.rs (RESEARCH-locked correction to D-06). Even this is "extend an existing module by ~50 lines," not new module work.

---

## Cross-Cutting BLADE Landmines (apply to all plan stages)

| Landmine | Source | Where it bites in Phase 18 |
|----------|--------|----------------------------|
| Flat `#[tauri::command]` namespace | CLAUDE.md "common mistakes" + Phase 17 PATTERNS.md | Pre-flight verified clean; private-fn `dispatch_action` exists in 2 modules — Phase 18 uses `jarvis_dispatch_action` to avoid grep confusion |
| Module registration 3-step | CLAUDE.md "Module registration (EVERY TIME)" | 4 new mod declarations + 7 new tentacle pub mod declarations + ~9 generate_handler! entries; **6-place config rule does NOT fire** (zero new BladeConfig fields) |
| `safe_slice` on user content | CLAUDE.md "Don't use `&text[..n]`" + memory `feedback_uat_evidence.md` | Every blade_activity_log emission, every consent dialog content preview, every jarvis_intercept payload string |
| Ghost CSS tokens | memory `project_ghost_css_tokens.md` (v1.1 retraction trigger — 210 refs across 9 files) | JarvisPill + ConsentDialog use ONLY existing tokens; NEVER invent `--jarvis-*` or `--consent-*` |
| Listener leak (P-06) | `src/lib/events/index.ts:5` ESLint rule | MessageList + ChatPanel + ConsentDialog MUST use `useTauriEvent`; raw `listen` import = lint failure |
| `/blade-uat` runtime evidence | CLAUDE.md "Verification Protocol" + memory `feedback_uat_evidence.md` | UI fidelity UAT for ConsentDialog/JarvisPill is DEFERRED per chat-first pivot; **JARVIS-12 cold-install demo runtime UAT is NOT polish — it's the SC** (CONTEXT canonical_refs paragraph) |
| `docs/testing ss/` literal space | memory `reference_testing_ss_dir.md` | JARVIS-12 demo screenshot to `"docs/testing ss/jarvis-cold-install-demo.png"` (literal space; quote bash paths) |
| Chat streaming "missed once = silent regression" pattern | memory `project_chat_streaming_contract.md` | Every ego state transition (intercepting/installing/retrying/hard_refused) MUST emit `jarvis_intercept`; one missed branch = pill never updates |
| Authority files override scratch ideation | memory `feedback_read_authority_files_first.md` | CONTEXT D-01..D-21 are LOCKED; RESEARCH made 3 corrections (D-06 OBSERVE_ONLY architecture; D-05 dispatch order; D-20 questions.md path); planner does NOT re-decide these |
| 10-WIRING-AUDIT.json missing entries | RESEARCH Pitfall 6 (Phase 17 missed this and patched in Wave 5) | Phase 18 must include this in Wave 0 (4 module + 3 tentacle entries) |
| verify-emit-policy single-window pattern | RESEARCH Pitfall 5 + Phase 17 PATTERNS.md | Use `app.emit_to("main", ...)` for jarvis_intercept + consent_request — NO allowlist entry needed |
| Fast-streaming ego-blind gap | RESEARCH Pitfall 3 | Document as a comment in commands.rs at the new ego-wrap site; track as known gap, NOT a Phase 18 fix |
| "But I can…" refusal false-positive | RESEARCH Pitfall 8 | Unit tests must include 5+ false-positive cases; ego intercept includes disjunction-aware post-check |

---

## Architectural Corrections from RESEARCH (planner: honor these — they override CONTEXT)

| CONTEXT decision | RESEARCH correction | Reason |
|------------------|----------------------|--------|
| D-06: "flip per-tentacle observe-only flag" | Add new `WRITE_UNLOCKS: HashMap<tentacle, Instant>` map alongside the existing global `OBSERVE_ONLY: AtomicBool`; introduce `WriteScope` RAII guard with 30s TTL | The per-tentacle surface doesn't exist today (`OBSERVE_ONLY` is a single global AtomicBool at ecosystem.rs:17). RESEARCH § OBSERVE_ONLY Architecture is research-locked. |
| D-05: "MCP-first by default" (in CONTEXT § Claude's Discretion speculation) | **Native-tentacle-FIRST**, MCP only when no native tentacle exists | Slack tentacle ALREADY proxies through MCP (slack_deep.rs:34); MCP-first creates double-routing (RESEARCH § Dispatch Order Verdict) |
| D-20: "research/questions.md does NOT exist yet" | File EXISTS at `.planning/research/questions.md`; plan task is MODIFY not CREATE | Verified 2026-04-30 (RESEARCH § Q1 Closure) |

---

## Metadata

**Analog search scope:** `src-tauri/src/` (Rust modules), `src-tauri/src/tentacles/` (outbound siblings), `src/features/chat/` (UI siblings), `src/design-system/primitives/` (Dialog/Badge/Pill), `src/lib/events/` (registry + payloads), `src/lib/tauri/` (invoke wrappers), `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/`, `.planning/research/`
**Files scanned:** 21 (read or grep-confirmed live; every file:line reference verified against the live tree on 2026-04-30)
**Pattern extraction date:** 2026-04-30
**Source authorities (re-read before planning):**
- `.planning/phases/18-jarvis-ptt-cross-app/18-CONTEXT.md` (D-01..D-21 LOCKED — chat-first pivot)
- `.planning/phases/18-jarvis-ptt-cross-app/18-RESEARCH.md` (file:line citations + 3 architectural corrections)
- `.planning/phases/17-doctor-module/17-PATTERNS.md` (Phase 17 patterns Phase 18 reuses verbatim — module registration, event registry, payloads, activity-log emission, useTauriEvent, Dialog consumption)
- `CLAUDE.md` (BLADE 3-step module rule + flat namespace + safe_slice + Verification Protocol + verify-emit-policy)
- `~/.claude/projects/-home-arnav-blade/memory/feedback_chat_first_pivot.md` (load-bearing pivot context)
- `~/.claude/projects/-home-arnav-blade/memory/project_chat_streaming_contract.md` (missed-once silent-regression principle)
- `~/.claude/projects/-home-arnav-blade/memory/project_ghost_css_tokens.md` (v1.1 retraction trigger — token discipline)

## PATTERN MAPPING COMPLETE
