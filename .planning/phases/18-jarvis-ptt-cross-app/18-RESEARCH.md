# Phase 18: Chat → Cross-App Action — Research

**Researched:** 2026-04-30
**Domain:** BLADE chat-capability spine — Rust ego/intent/dispatch + React consent dialog + JARVIS pill
**Confidence:** HIGH (grep-verified live against the BLADE repo on 2026-04-30; all decisions D-01..D-21 verified actionable; one architectural correction surfaced — see § OBSERVE_ONLY)

---

<user_constraints>
## User Constraints (from 18-CONTEXT.md)

### Locked Decisions
All architectural decisions D-01..D-21 in CONTEXT.md are LOCKED. The planner MUST honor them verbatim. The plan-checker rejects any plan that proposes alternatives.

- **D-01** Text chat is the only input surface for Phase 18. PTT (JARVIS-01) and Whisper STT (JARVIS-02) DEFERRED to v1.3. JARVIS-12 rewritten as text-chat → consent → real cross-app action → action visible in target service.
- **D-02** Phase title in CONTEXT = "Chat → Cross-App Action." Roadmap title stays "JARVIS Push-to-Talk → Cross-App Action."
- **D-03** Reuse `router.rs::classify_message`. Add parallel `IntentClass` enum (`ChatOnly | ActionRequired{service, action}`). Existing `TaskType` stays for model routing.
- **D-04** Heuristic-first, LLM-fallback intent classification (regex/keywords first; haiku-class LLM on ambiguity).
- **D-05** Three dispatch backends in priority order: existing tentacles → MCP tools → native_tools.
- **D-06** Credential reuse — observer creds become writer creds with explicit consent. Per-tentacle observe-only flag flipped during action execution.
- **D-07** No new credential storage in Phase 18.
- **D-08** Modal consent dialog on first action per (intent_class, target_service) tuple. Persisted in keyring or new `consent_decisions` table — research-stage call (verdict in this RESEARCH).
- **D-09** Consent dialog wording: target service, content preview (safe_slice), intent verb, "Allow once / Allow always / Deny."
- **D-10** Hard fail on missing creds; no silent skip.
- **D-11** New `src-tauri/src/ego.rs` module with `intercept_assistant_output`, `EgoVerdict`, `handle_refusal`, `EgoOutcome`.
- **D-12** Refusal detection: ≥5 patterns (initial set listed verbatim in CONTEXT). `ego::REFUSAL_PATTERNS: &[(Regex, &str)]`.
- **D-13** Capability gap detection precedes refusal classification.
- **D-14** Retry cap = 1 per turn (atomic counter scoped to chat-turn-id).
- **D-15** Hard-refuse output format: `"I tried, but {reason}. Here's what I'd need: {capability}. You can connect it via {path_in_BLADE}."`
- **D-16** `self_upgrade::capability_catalog` extended with integration-kind entries (slack_outbound, github_outbound, gmail_outbound, calendar_write, linear_outbound). Catalog gains `kind: Runtime | Integration` discriminator.
- **D-17** Every action turn emits one ActivityStrip line via `app.emit_to("main", "blade_activity_log", ...)` per ecosystem.rs:46-58 pattern.
- **D-18** New event `jarvis_intercept` + chat surface listener; MessageList renders inline pill.
- **D-19** Add `JARVIS_INTERCEPT: 'jarvis_intercept'` to `BLADE_EVENTS` registry.
- **D-20** `research/questions.md` Q1 verdict: always require explicit consent for browser-harness installs.
- **D-21** Demo path = text chat → consent → real Slack post → ActivityStrip → screenshot to `docs/testing ss/jarvis-cold-install-demo.png`.

### Claude's Discretion (CONTEXT.md "Claude's Discretion")
- Exact regex tuning for refusal patterns (planner can adjust; user revises if needed)
- Consent dialog visual design (use existing Dialog primitive)
- Whether `consent_decisions` lives in keyring or new SQLite table — **research verdict below: SQLite, see § Consent Persistence Verdict**
- Exact wording of JARVIS pill states (planner drafts)
- Order of dispatch backends within "MCP-or-tentacle" — **research verdict: native tentacle FIRST when present, MCP only when no native tentacle exists** (see § Dispatch Order Verdict — overrides CONTEXT.md "MCP-first by default" speculation)
- Per-pattern refusal counter (lightweight; recommend yes — append to existing capability_gap timeline rows)
- Multi-step action chains — defer to v1.3, single-action per turn in Phase 18

### Deferred Ideas (OUT OF SCOPE)
- PTT / Whisper STT integration with the JARVIS dispatcher — v1.3
- Multi-step action chains
- Voice-agent always-on listening mode — v1.3+
- Per-tentacle standalone outbound surface as first-class flows — v1.3 ACT-XX
- System-tray notifications on action completion — v1.3 polish
- LLM-only intent classifier (skipping heuristic pre-filter)
- Per-pattern refusal counter dashboard (Doctor sub-tab)
- Consent decisions UI surface (list / revoke individual decisions)
- Browser-harness auto-install — JARVIS-09 verdict locked: always explicit consent
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| JARVIS-01 | PTT global hotkey — **DEFERRED v1.3 per D-01** | n/a — no work in Phase 18 |
| JARVIS-02 | PTT → Whisper STT — **DEFERRED v1.3 per D-01** | n/a — no work in Phase 18 |
| JARVIS-03 | Intent classification → IntentClass | § Router Extension (existing `classify_message` + new parallel `IntentClass`) |
| JARVIS-04 | Cross-app dispatch reuses observer creds | § Outbound Surfaces (calendar_post_meeting_summary + linear_create_issue + new slack/github/gmail outbound) + § Credential Reuse |
| JARVIS-05 | Per-action consent dialog persisted per (intent_class, target_service) | § Consent Persistence Verdict (SQLite `consent_decisions` table) |
| JARVIS-06 | Ego refusal regex (≥5 patterns) | § Ego Module Surface + § Refusal Pattern Tuning |
| JARVIS-07 | Capability_gap → evolution_log_capability_gap → auto_install → retry | § Ego Loop Integration + § Capability Catalog Extension |
| JARVIS-08 | Retry cap = 1 per turn | § Ego Module Surface (`RETRY_COUNT: AtomicU32` keyed by turn_id) |
| JARVIS-09 | Browser-harness Q1 closed in `research/questions.md` | § Q1 Closure (the file already exists at `.planning/research/questions.md` — D-20 needs correction) |
| JARVIS-10 | Every JARVIS action emits to ActivityStrip | § ActivityStrip Emission (reuse ecosystem.rs:46-58 verbatim) |
| JARVIS-11 | Inline JARVIS pill in chat on intercept | § JARVIS Pill Placement |
| JARVIS-12 | Cold-install demo (rewritten as text-chat → real cross-app action) | § Cold-Install Demo Viability |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Intent classification (chat vs action) | API/Backend (Rust `intent_router` or extension of `router.rs`) | — | Heuristic + LLM-fallback runs server-side; no UI tier needs to know |
| Refusal detection + capability_gap classification | API/Backend (Rust `ego.rs`) | — | Regex matchers + verdict enum; integrated into chat pipeline before tokens leave the assistant turn |
| Outbound dispatch fan-out | API/Backend (Rust `jarvis_dispatch.rs` or fold into ego.rs) | — | Routes to existing tentacle / MCP / native_tools — pure server-side |
| Per-action consent decision | API/Backend (storage) + Frontend (modal UI) | — | Decision persisted in SQLite (verdict below); modal rendered in main window via `Dialog` primitive |
| Credential reuse for outbound writes | API/Backend (existing `keyring` via `config::get_provider_key`) | — | Reuse the observer creds path; no new credential storage per D-07 |
| OBSERVE_ONLY guardrail toggle | API/Backend (Rust — see § OBSERVE_ONLY Architecture) | — | Currently a single global AtomicBool; Phase 18 must ADD per-tentacle gating |
| ActivityStrip emission | API/Backend (Rust `app.emit_to("main", "blade_activity_log", ...)`) | Frontend `ActivityLogProvider` | M-07 contract; same path doctor.rs/ecosystem.rs use |
| `jarvis_intercept` event emission | API/Backend (Rust → main window) | Frontend `useTauriEvent` subscriber in MessageList | Standard Tauri push pattern (D-13 lock) |
| JARVIS pill render | Frontend (`MessageList.tsx`) | Design-system `Badge` / `Pill` primitives | Inline UI surface; D-18 |
| Consent dialog render | Frontend (`ConsentDialog.tsx`) | Design-system `Dialog` primitive | Existing centered-modal primitive; D-08 + D-09 |

---

## Standard Stack

### Core (in-repo, no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Tauri 2 | 2.x [VERIFIED: src-tauri/Cargo.toml] | Command + event surface | Only IPC framework BLADE uses |
| serde / serde_json | already in tree | `IntentClass` / `EgoVerdict` derive(Serialize) | Standard Rust serialization |
| tokio | already in tree | Async dispatch, atomic state | Already used throughout |
| `regex` | "1" [VERIFIED: src-tauri/Cargo.toml:56] | `REFUSAL_PATTERNS: &[(Regex, &str)]` per D-12 | Already in tree — no new dep |
| rusqlite | already in tree | `consent_decisions` table (verdict below) | Same crate `evolution_log_capability_gap` uses |
| reqwest | already in tree | Slack/Gmail HTTP outbound (when MCP missing) | Used by github_deep, calendar_tentacle |
| chrono | already in tree | Timestamps, retry counters | Standard across BLADE |
| React 19 (existing) | — | ConsentDialog, JarvisPill | UI-SPEC compositional |
| `@/design-system/primitives` | in-tree | `Dialog`, `Badge`, `Pill`, `Button` | All exported per `index.ts` [VERIFIED: src/design-system/primitives/index.ts] |

### Supporting (in-repo)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `BLADE_EVENTS` registry [VERIFIED: src/lib/events/index.ts:34-211] | in-tree | Frozen event registry | Phase 18 MUST add `JARVIS_INTERCEPT: 'jarvis_intercept'` |
| `useTauriEvent` hook [VERIFIED: src/lib/events/index.ts:252-291] | in-tree | The ONLY permitted listen() surface (D-13) | MessageList subscribes to `jarvis_intercept` via this hook |
| `invokeTyped` helper [VERIFIED: src/lib/tauri/_base.ts] | in-tree | Type-safe Tauri command invocation | Phase 18 adds wrappers to `src/lib/tauri/{chat,system}.ts` |
| `safe_slice` [VERIFIED: lib.rs] | in-tree | Non-ASCII string slicing for content preview | Consent dialog `content_preview` field MUST use this |
| `Emitter` trait | in-tree | `app.emit_to("main", ...)` | Reused for `jarvis_intercept` + `blade_activity_log` |

### Alternatives Considered (rejected)
| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| `regex` crate (already in tree) | `lazy_static!` + manual matching | Saves 0 dependencies; no win | NO — `regex` is already in Cargo.toml line 56 |
| Per-tentacle `OBSERVE_ONLY` flags | Single global flag toggled briefly during action | Single flag is simpler but breaks isolation: while one action runs, all tentacles unlock | **CRITICAL — see § OBSERVE_ONLY Architecture below** |
| Keyring for consent decisions | New SQLite `consent_decisions` table | Keyring is per-key (1 entry per provider — ~20 max); consent matrix is (intent × service) → up to 50+ entries; SQLite is the right shape | **VERDICT: SQLite — see § Consent Persistence Verdict** |
| Single MCP-first dispatch order | Native-tentacle-first dispatch | CONTEXT.md "Claude's Discretion" speculated MCP-first; research finds Slack tentacle ALREADY uses MCP under the hood, so MCP-first creates double-routing | **VERDICT: native-tentacle-first — see § Dispatch Order Verdict** |

**Installation:** None required. All dependencies already in tree. [VERIFIED: 2026-04-30]

---

## Architecture Patterns

### System Architecture Diagram

```
                ┌────────────────────────────────────────────────┐
                │  ChatView / MessageList (src/features/chat)    │
                │  • streams via useChat / chat_token events     │
                │  • renders ConsentDialog + JarvisPill inline   │
                └───────────────────────┬────────────────────────┘
                                        │ user submits
                                        ▼
                ┌────────────────────────────────────────────────┐
                │  send_message_stream (commands.rs:647)         │
                │  ─────────────────────────────────────────     │
                │  Tool-loop branch (l.~1320 complete_turn ...)  │
                │  ↳ assistant turn returns AssistantTurn{...}   │
                │  ↳ turn.content is the FULL TEXT before emit   │ ◄── EGO INTERCEPT POINT
                │                                                 │     (D-11; before chat_token loop l.1531)
                │  Fast streaming branch (l.1166)                │
                │  ↳ tokens streamed live; no accumulator        │ ◄── EGO BLIND HERE
                │  ↳ ego post-process NOT POSSIBLE in fast path  │     (architecture insight — see § Ego Pipeline Integration)
                └───────────────────────┬────────────────────────┘
                                        │ before final chat_token emission
                                        ▼
                ┌────────────────────────────────────────────────┐
                │  intent_router::classify (preflight, before    │
                │  send_message_stream forks chat-vs-tool)       │
                │  ↳ IntentClass::ChatOnly → straight to chat    │
                │  ↳ IntentClass::ActionRequired{...} → dispatch │
                └───────────────────────┬────────────────────────┘
                                        │ ActionRequired branch
                                        ▼
                ┌────────────────────────────────────────────────┐
                │  consent_check(intent_class, target_service)   │
                │  ↳ SQLite SELECT decision FROM consent_decisions│
                │  ↳ no row → emit "request_consent" event;       │
                │     wait for ConsentDialog response (channel)   │
                │  ↳ "allow_always" persisted; "allow_once" runs │
                │     this turn only; "deny" → log + return      │
                └───────────────────────┬────────────────────────┘
                                        │ approved
                                        ▼
                ┌────────────────────────────────────────────────┐
                │  jarvis_dispatch::dispatch_action              │
                │  ─────────────────────────────────────────     │
                │  Priority order (research verdict):            │
                │   1. Native tentacle (calendar/linear/slack/   │
                │      github outbound) — direct call            │
                │   2. MCP tool (mcp__<server>_<tool>)           │
                │   3. native_tools.rs (filesystem, shell, ...)  │
                │  ───────────────────────────                   │
                │  Toggles OBSERVE_ONLY off → runs action →      │
                │  toggles back on (atomically, RAII guard)      │
                └─┬───────────────┬───────────────────┬──────────┘
                  │               │                   │
                  ▼               ▼                   ▼
       ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
       │tentacles/       │ │mcp::         │ │native_tools.rs   │
       │ slack_outbound  │ │ call_tool    │ │ (37+ in-tree)    │
       │ github_outbound │ │ (qualified   │ │                  │
       │ gmail_outbound  │ │  name)       │ │                  │
       │ calendar_write  │ │              │ │                  │
       │ linear (exists) │ │              │ │                  │
       └─────────────────┘ └──────────────┘ └──────────────────┘
                  │
                  ▼ (action returns Ok | Err)
                ┌────────────────────────────────────────────────┐
                │  ego::intercept_assistant_output(transcript)   │
                │  → EgoVerdict::                                │
                │    Pass             — no refusal               │
                │    CapabilityGap{}  — has match in catalog     │
                │    Refusal{}        — bare refusal             │
                └───────────────────────┬────────────────────────┘
                                        │ verdict ≠ Pass
                                        ▼
                ┌────────────────────────────────────────────────┐
                │  ego::handle_refusal                           │
                │  ↳ CapabilityGap → log via                     │
                │    evolution_log_capability_gap (evolution.rs  │
                │    :1115) + auto_install (self_upgrade) IF     │
                │    catalog kind=Runtime; if Integration, route │
                │    user to "Connect via Integrations tab"      │
                │  ↳ retry once (RETRY_COUNT.fetch_add(1) ≤ 1)    │
                │  ↳ on persistent refusal → hard_refuse with    │
                │    locked output format (D-15)                 │
                └───────────────────────┬────────────────────────┘
                                        │
                                        ▼
                ┌────────────────────────────────────────────────┐
                │  emit `jarvis_intercept` (D-18) + emit         │
                │  `blade_activity_log` (D-17, D-21) + emit      │
                │  chat_token + chat_done                        │
                └────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src-tauri/src/
├── ego.rs                          # NEW — refusal detector + verdict + handle_refusal
├── intent_router.rs                # NEW — IntentClass + classify_intent (parallel to existing TaskType)
│                                   #       (alternative: extend router.rs — recommend separate file for blast-radius isolation)
├── jarvis_dispatch.rs              # NEW — outbound fan-out (tentacle / MCP / native_tools)
├── consent.rs                      # NEW — consent_decisions SQLite CRUD + Tauri commands
├── tentacles/
│   ├── slack_outbound.rs           # NEW — chat.postMessage via Slack MCP (when configured) or HTTP fallback
│   ├── github_outbound.rs          # NEW — issue/PR comment create via existing github_token() helper
│   ├── gmail_outbound.rs           # NEW — Gmail send via OAuth (or MCP fallback)
│   ├── calendar_tentacle.rs        # MODIFY — add `calendar_create_event` write path
│   ├── linear_jira.rs              # (no change — linear_create_issue already exists)
│   └── slack_deep.rs               # (no change — observer-only)
├── self_upgrade.rs                 # MODIFY — extend capability_catalog with Integration-kind entries; add `kind` discriminator field to CapabilityGap
├── ecosystem.rs                    # MODIFY (light) — extend OBSERVE_ONLY to per-tentacle map (see § OBSERVE_ONLY)
├── commands.rs                     # MODIFY — wrap turn.content in tool-loop branch with ego::intercept_assistant_output (l.~1517 before chat_token loop)
├── lib.rs                          # MODIFY — add `mod ego;` `mod intent_router;` `mod jarvis_dispatch;` `mod consent;` + new commands in `generate_handler!`

src/
├── features/chat/
│   ├── ConsentDialog.tsx           # NEW — modal per D-08/D-09
│   ├── JarvisPill.tsx              # NEW — inline pill per D-18
│   ├── MessageList.tsx             # MODIFY — render JarvisPill on jarvis_intercept event
│   └── useChat.tsx                 # MODIFY (light) — wire ConsentDialog open/close
├── lib/events/
│   ├── index.ts                    # MODIFY — add JARVIS_INTERCEPT to BLADE_EVENTS
│   └── payloads.ts                 # MODIFY — add JarvisInterceptPayload interface
└── lib/tauri/
    ├── chat.ts (or system.ts)      # MODIFY — add typed wrappers for ego/dispatch/consent commands

scripts/
└── verify-emit-policy.mjs          # MODIFY — add 'ego.rs:jarvis_intercept' to CROSS_WINDOW_ALLOWLIST (preemptive — Phase 17 missed this and caught it on policy gate)

.planning/
└── research/questions.md           # MODIFY — close Q1 with verdict (D-20)
                                    # NOTE: D-20 says file does NOT exist; research found it DOES exist at
                                    # .planning/research/questions.md (verified 2026-04-30). Plan must MODIFY,
                                    # not CREATE. The Q1 stub is already in place; only the verdict needs landing.

.planning/milestones/v1.1-phases/10-inventory-wiring-audit/
└── 10-WIRING-AUDIT.json            # MODIFY — add entries for ego, intent_router, jarvis_dispatch, consent (preemptive — Phase 17 missed and patched in Wave 5)
```

### Pattern 1: New Module + Tauri Command + Module Registration
**What:** Module registration 3-step from CLAUDE.md
**When to use:** Every new Rust file (ego.rs, intent_router.rs, jarvis_dispatch.rs, consent.rs)
**Source:** Phase 17 17-PATTERNS.md § doctor.rs CREATE pattern (proven Phase 17 shipped 2026-04-30)
```rust
// src-tauri/src/ego.rs (NEW — example)
use serde::{Deserialize, Serialize};

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

pub fn intercept_assistant_output(transcript: &str) -> EgoVerdict {
    // ... regex match against REFUSAL_PATTERNS
}
```
Then in `lib.rs`:
```rust
mod ego;            // ←  add line
mod intent_router;  // ←
mod jarvis_dispatch;// ←
mod consent;        // ←

generate_handler![
    // ... existing 760+ commands ...
    ego::ego_intercept,
    intent_router::intent_router_classify,
    jarvis_dispatch::dispatch_action,
    consent::consent_get_decision,
    consent::consent_set_decision,
    consent::consent_revoke_all,
];
```

### Pattern 2: Refusal Pattern Set (regex compiled once)
**What:** Static `&[(Regex, &str)]` table for unit-testable pattern coverage
**Source:** D-12 + the regex crate already in tree at line 56 of Cargo.toml
```rust
use once_cell::sync::Lazy;
use regex::Regex;

static REFUSAL_PATTERNS: Lazy<Vec<(Regex, &'static str)>> = Lazy::new(|| {
    vec![
        (Regex::new(r"(?i)\bI can'?t\b(?: directly)?").unwrap(), "i_cant"),
        (Regex::new(r"(?i)\bI don'?t have access\b").unwrap(),   "no_access"),
        (Regex::new(r"(?i)\bI'?m not able to\b").unwrap(),       "not_able"),
        (Regex::new(r"(?i)\bI cannot directly\b").unwrap(),      "cannot_directly"),
        (Regex::new(r"(?i)\bI lack the\b").unwrap(),             "lack_the"),
        (Regex::new(r"(?i)\bas an AI\b").unwrap(),               "as_an_ai"),       // stretch
        (Regex::new(r"(?i)\bI'?m unable to\b").unwrap(),         "unable_to"),      // stretch
        (Regex::new(r"(?i)\bI don'?t have the (capability|ability|tools)\b").unwrap(), "no_capability"),  // stretch
    ]
});
```
**Note:** `once_cell` is already a transitive dep via tauri; if not direct, use `std::sync::OnceLock<Vec<…>>` instead — same outcome.

### Pattern 3: Activity-Strip Emission (verbatim from ecosystem.rs:46-58, proven Phase 17)
**What:** D-17 emission format
**Source:** ecosystem.rs:46-58 (canonical pattern; doctor.rs reuses; Phase 18 reuses)
```rust
fn emit_jarvis_activity(app: &AppHandle, intent_class: &str, target_service: &str, outcome: &str) {
    let _ = app.emit_to("main", "blade_activity_log", serde_json::json!({
        "module":        "jarvis",
        "action":        outcome,                    // "executed" | "denied" | "auto_approved" | "hard_refused" | "capability_gap_logged" | "retry_succeeded"
        "human_summary": crate::safe_slice(
            &format!("[JARVIS] {}: {} → {}", intent_class, target_service, outcome),
            200
        ),
        "payload_id":    None::<String>,
        "timestamp":     now_secs(),
    }));
}
```
**Don't paraphrase** — the line format `[JARVIS] {intent_class}: {target_service} → {outcome}` is a D-17 lock.

### Pattern 4: New Tauri Event + Frontend Subscriber (proven Phase 17 DOCTOR_EVENT)
**What:** D-18 `jarvis_intercept` event wiring
**Source:** Phase 17 added `DOCTOR_EVENT: 'doctor_event'` to BLADE_EVENTS at index.ts:210; payloads.ts:758-764 has DoctorEventPayload. Phase 18 mirrors this surface verbatim.
```typescript
// src/lib/events/index.ts — ADD ONE LINE in the registry
JARVIS_INTERCEPT: 'jarvis_intercept',

// src/lib/events/payloads.ts — ADD THE INTERFACE
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
```typescript
// src/features/chat/MessageList.tsx — modify to render JarvisPill on event
import { useState } from 'react';
import { useTauriEvent, BLADE_EVENTS, type JarvisInterceptPayload } from '@/lib/events';
import { JarvisPill } from './JarvisPill';

const [intercept, setIntercept] = useState<JarvisInterceptPayload | null>(null);
useTauriEvent<JarvisInterceptPayload>(BLADE_EVENTS.JARVIS_INTERCEPT, (e) => {
  setIntercept(e.payload);
  if (e.payload.action !== 'hard_refused') {
    // Auto-clear after next assistant message lands; hard_refused stays until dismiss.
  }
});
// render <JarvisPill payload={intercept} onDismiss={() => setIntercept(null)} /> below the live bubble
```

### Pattern 5: Consent Persistence (SQLite — research verdict)
**What:** D-08 persisted decision per (intent_class, target_service)
**Source:** Reuse `evolution.rs:1115` blade.db pattern (rusqlite::Connection::open)
```rust
// src-tauri/src/consent.rs (NEW)
const CONSENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS consent_decisions (
    intent_class    TEXT NOT NULL,
    target_service  TEXT NOT NULL,
    decision        TEXT NOT NULL,    -- 'allow_always' | 'denied'
    decided_at      INTEGER NOT NULL,
    PRIMARY KEY (intent_class, target_service)
);
"#;

pub fn consent_get(intent_class: &str, target_service: &str) -> Option<String> {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    let conn = rusqlite::Connection::open(&db_path).ok()?;
    conn.execute(CONSENT_SCHEMA, []).ok()?;
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
    // DELETE FROM consent_decisions
}
```

### Anti-Patterns to Avoid

- **Wrapping the fast streaming path with ego.** The fast streaming branch (commands.rs:1166) emits tokens directly — no full text exists at intercept time. **Phase 18 ego MUST run only in the tool-loop branch where `turn.content` is fully materialized at l.1517 before the per-character chat_token loop at l.1531.** If ego is required on the fast path, the architecture must change first (accumulate-then-emit) — that's a separate bigger refactor not in v1.2 scope.
- **Pinging the LLM twice for intent classification.** D-04 says "heuristic-first, LLM-fallback" — never run the LLM unconditionally; the heuristic must short-circuit ≥80% of inputs. Otherwise we double cost.
- **Putting consent in keyring.** Keyring entries are 1-per-key; consent matrix is (intent × service) → up to 50 rows. Don't fight the data shape — see § Consent Persistence Verdict.
- **Toggling the global OBSERVE_ONLY flag.** Currently a single AtomicBool — toggling it briefly makes ALL tentacles writable for that window. **Per-tentacle gating is required** — see § OBSERVE_ONLY Architecture for the surgical extension.
- **Hardcoded `intent_router_classify` LLM model.** Use existing `router::select_provider` for the haiku-class fallback — don't add another model selection path.
- **Forgetting `verify-emit-policy` allowlist.** Phase 17 caught this on the gate. Phase 18 must add `'ego.rs:jarvis_intercept'` to `CROSS_WINDOW_ALLOWLIST` in `scripts/verify-emit-policy.mjs` BEFORE the emit lands. Or use `app.emit_to("main", "jarvis_intercept", ...)` (single-window — no allowlist entry needed; matches doctor.rs:doctor_event which IS in allowlist because it's broadcast — Phase 18 should follow the same single-window emit pattern as the activity log).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Refusal regex matching | Custom `String::contains` patterns | `regex` crate (already in Cargo.toml line 56) | Word-boundary, case-insensitive, captures — battle-tested |
| Intent classification | Custom NLP / token-counting | `router::classify_message` for the heuristic, then `providers::complete_turn` (or `select_provider` for cheap model) for LLM-fallback | Existing surface; haiku-class fallback proven in router.rs:135 |
| Capability gap logging | New SQLite table | `evolution_log_capability_gap` (evolution.rs:1115) writes to `activity_timeline` already; Phase 17 reads it | Phase 17's DOCTOR-03 already consumes this; Phase 18 just writes to the same surface |
| Auto-install runtime tools | Custom installer shell-out | `self_upgrade::auto_install` + extended catalog (D-16) | Cooldown logic, platform detection, error handling already there |
| Slack outbound HTTP | Custom reqwest call | If MCP server registered: `mcp::call_tool("mcp__slack_post_message")` (slack_deep.rs already proves this pattern at l.34); else fall back to chat.postMessage HTTP | Slack MCP server has the writer surface already if user has it installed |
| Calendar event create | Custom Google Calendar HTTP | Reuse Calendar MCP if registered; else extend calendar_tentacle.rs with `calendar_create_event` matching the existing `calendar_post_meeting_summary` pattern | calendar_tentacle.rs:915 + 943 already proves the outbound shape |
| GitHub PR comment | Custom octocrab usage | Extend github_deep.rs — `github_token()` (l.164) + `gh_post()` (l.185) helpers already exist | github_deep.rs already does outbound (review_pr posts at l.375) — Phase 18 just adds a new write fn next to it |
| Consent dialog modal | Custom modal | `Dialog` primitive (src/design-system/primitives/Dialog.tsx) | Already exported; ActivityDrawer + Phase 17 drill-down both use it; focus-restore + a11y handled |
| Inline pill | Custom badge | `Badge` or `Pill` primitive (src/design-system/primitives/{Badge,Pill}.tsx) | Both exported; D-18 explicitly says "extend Badge primitive minimally" |
| Tauri event subscription | Raw `listen()` | `useTauriEvent` hook (src/lib/events/index.ts:252) | D-13 lock; ESLint banned raw imports; P-06 leak prevention |

**Key insight:** Phase 18 introduces zero new dependencies. The whole spine is composition over existing surfaces. The work is **glue** — wiring ego into the tool-loop branch, wiring intent_router preflight, wiring per-action consent, and adding 4 outbound commands that follow existing tentacle patterns.

---

## Common Pitfalls

### Pitfall 1: OBSERVE_ONLY is global, not per-tentacle (D-06 architectural mismatch)
**What goes wrong:** D-06 says "flip per-tentacle observe-only flag for one action duration." Reading `ecosystem.rs:17` shows `static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true)` — it's ONE global flag. Toggling it briefly opens write paths for ALL tentacles for that window, breaking isolation between concurrent actions.
**Why it happens:** v1.1's M-03 specified a single global guardrail. D-06 anticipates per-tentacle gating without acknowledging the surface doesn't yet exist.
**How to avoid:** Phase 18 MUST extend `ecosystem.rs` to add a per-tentacle map alongside the global flag. Recommended shape:
```rust
static PER_TENTACLE_WRITE_UNLOCK: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

pub fn unlock_for_action(tentacle: &str, ttl: Duration) { /* insert with deadline */ }
pub fn is_write_allowed(tentacle: &str) -> bool {
    // Global flag check first; then per-tentacle map; auto-purge expired entries
}
```
Then `assert_observe_only_allowed` (ecosystem.rs:26) takes a tentacle name and checks the map. RAII guard via `struct WriteScope { tentacle: String } impl Drop for WriteScope { fn drop(&mut self) { /* lock again */ } }` ensures the unlock window closes even on panic.
**Warning signs:** Two parallel JARVIS actions in the same chat turn (currently impossible per D-21 single-action; but defense-in-depth required); panic mid-action leaves OBSERVE_ONLY off globally → permanent breach.

### Pitfall 2: Slack tentacle currently uses MCP — D-05 dispatch order ambiguity
**What goes wrong:** D-05 says "Existing tentacles" priority 1, "MCP tools" priority 2. But `slack_deep.rs:34 slack_call` ALREADY routes through MCP under the hood (`manager.call_tool("mcp__slack_<tool>", args)`). If the dispatcher queries "is there a native Slack tentacle?", the answer is yes — but the tentacle itself calls MCP. Net effect: dispatch goes tentacle→MCP, same as if dispatcher had picked MCP directly.
**Why it happens:** "Tentacle" in BLADE history means "observer wrapper around something" — sometimes that something IS an MCP server, sometimes it's a native HTTP client (github_deep uses reqwest; calendar uses MCP).
**How to avoid:** **Dispatch order verdict (research):** Use the *thinnest* call path. If a native tentacle exists with an outbound write fn (`linear_create_issue`, `calendar_post_meeting_summary`), call that; the tentacle decides if it goes via MCP or HTTP. Only route directly to `mcp::call_tool` for services with **no** native tentacle wrapper. This is "tentacle-first, MCP-fallback when no tentacle exists" — which collapses to D-05 priority 1.
**Warning signs:** Phase 18 dispatcher detecting "Slack" twice (once as tentacle, once as MCP server) and getting confused about which to call.

### Pitfall 3: Fast streaming branch is ego-blind
**What goes wrong:** ego.rs intercepts `transcript: &str`. In the tool-loop branch, `turn.content` is fully materialized at commands.rs:1517 before token emission. **In the fast streaming branch (commands.rs:1166), tokens are emitted live** by `providers::stream_text` (anthropic.rs:236 emits each token directly). There's no accumulator — text is sent to the client incrementally and never collected server-side.
**Why it happens:** Streaming was designed for low-latency; ego post-processing wants the whole response. These are competing requirements.
**How to avoid:** Phase 18 wires ego ONLY into the tool-loop branch (l.1503-1552 region). The fast streaming branch is taken when `tools.is_empty() || (only_native_tools && is_conversational && is_short_conversation)` — by definition, this branch only fires for short conversational queries, which are unlikely to trigger refusals. **Document in plan:** "Phase 18 ego intercept covers the tool-loop branch only. Fast-streaming refusals are a known gap; if user reports a fast-path refusal, route the message through tool-loop (e.g. by adding a hint that forces only_native_tools=false). Full coverage requires accumulator refactor — out of scope."
**Warning signs:** User submits a refusal-eliciting message but ego doesn't fire. Check if the message hit the fast streaming branch.

### Pitfall 4: `research/questions.md` location mismatch
**What goes wrong:** D-20 says `research/questions.md` does NOT exist; multiple docs reference both `research/questions.md` and `.planning/research/questions.md`. The actual file lives at **`.planning/research/questions.md`** (verified 2026-04-30 via `ls`). Q1 stub already exists with status "open."
**Why it happens:** REQUIREMENTS.md / ROADMAP.md / CONTEXT.md use the path `research/questions.md`; DOCS.md uses `.planning/research/questions.md`. The `.planning/` prefix was dropped in some refs.
**How to avoid:** Plan task is **MODIFY** (close Q1 with verdict), not **CREATE**. Update D-20 verdict text into the existing Q1 entry under the "Status:" line.
**Warning signs:** Plan creates a new file at the wrong path; CI greenfield — no test catches this. Manual proofread required.

### Pitfall 5: verify-emit-policy.mjs allowlist (Phase 17 caught this on the gate)
**What goes wrong:** `app.emit("jarvis_intercept", payload)` is a **broadcast** emit and fails `scripts/verify-emit-policy.mjs` (line 107 regex). Phase 17 caught this when DOCTOR_EVENT shipped — needed `'doctor.rs:doctor_event'` added to CROSS_WINDOW_ALLOWLIST.
**Why it happens:** The default `app.emit(...)` is broadcast; only `app.emit_to("main", ...)` is exempt. Static gate failure blocks merge.
**How to avoid:** Two viable paths:
1. Use `app.emit_to("main", "jarvis_intercept", payload)` — single-window, no allowlist entry needed. **Recommended** (matches doctor.rs activity log pattern).
2. Use `app.emit("jarvis_intercept", ...)` and add `'ego.rs:jarvis_intercept'` (or wherever the emit lives) to `CROSS_WINDOW_ALLOWLIST` at scripts/verify-emit-policy.mjs:81.
**Warning signs:** `npm run verify:all` failing with `[verify-emit-policy] VIOLATION: ego.rs:N emits 'jarvis_intercept' as broadcast`.

### Pitfall 6: 10-WIRING-AUDIT.json missing Phase 18 modules (Phase 17 lesson)
**What goes wrong:** Phase 17 missed adding the new `doctor.rs` module to `10-WIRING-AUDIT.json` and had to patch in Wave 5 (commit referenced in STATE.md). Phase 18 introduces 4 new modules (ego, intent_router, jarvis_dispatch, consent) + 3 new tentacles (slack_outbound, github_outbound, gmail_outbound).
**Why it happens:** The audit shape verifier (`scripts/verify-wiring-audit-shape.mjs`) cross-checks every Rust module file against the JSON. New modules without entries fail.
**How to avoid:** Plan Wave 0 task: append entries for the 4 new modules + 3 new tentacles to `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json`. Use the doctor.rs entry at offset 7297 as the template.
**Warning signs:** `npm run verify:all` failing on `verify-wiring-audit-shape`.

### Pitfall 7: Flat `#[tauri::command]` namespace clash
**What goes wrong:** CLAUDE.md: "Duplicate `#[tauri::command]` function names across modules — Tauri's macro namespace is FLAT."
**Why it happens:** Auto-naming during scaffolding picks generic names.
**How to avoid:** **VERIFIED 2026-04-30** — `grep -rn "fn (ego|jarvis|consent|intent)_" src-tauri/src/` returns zero existing commands with these prefixes (only `intent_suggestion` in terminal_watch.rs at l.253, which is a private fn — no clash). The full namespace is clean. Plan should still verify before each new command lands. Recommended naming: `ego_intercept`, `intent_router_classify`, `jarvis_dispatch_action`, `consent_get_decision`, `consent_set_decision`, `consent_revoke_all`.
**Warning signs:** Cargo error "expected unique tauri::command names" or runtime "duplicate command".

### Pitfall 8: Refusal patterns over-match the assistant's helpful negations
**What goes wrong:** Pattern `\bI can'?t\b` matches both "I can't post to Slack" (refusal — should fire) AND "I can't help you with that, but I can help with X" (intent-deflect — should NOT fire). Single-pass match flags the latter as refusal, ego retries unnecessarily.
**Why it happens:** Refusal regex isolates the verb without seeing the disjunction that follows.
**How to avoid:** Add a "but … can" lookahead exclusion or a post-match check. Recommended: after a regex hit, check if the next 80 chars contain `"\bbut\b.+\bcan\b"` — if yes, treat as Pass not Refusal. **Phase 18 should ship 7-8 patterns total** (5 mandatory + 3 stretch) with the disjunction-aware post-check baked into `intercept_assistant_output`. Unit tests must cover both true positives and the "but I can" false-positive avoidance case.
**Warning signs:** ego retries on conversational replies that aren't actually refusals; users see spurious JARVIS pills.

---

## Runtime State Inventory

> Phase 18 is a **greenfield feature phase**, not a rename/refactor. This section is included anyway because of the OBSERVE_ONLY toggle behavior — it touches process-lifetime atomic state that existing code depends on.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 18 ADDS a new SQLite table `consent_decisions` to `~/.blade/blade.db`; no existing rows to migrate | None for migration; CREATE TABLE IF NOT EXISTS handles fresh installs |
| Live service config | Slack/GitHub/Gmail/Calendar OAuth tokens already in keyring under `blade-ai`/`<provider>` (e.g. github_token() at github_deep.rs:164 reads `crate::config::get_provider_key("github")`); these are reused verbatim per D-07 | Verify each target service has a stored token before consent dialog appears (D-10 hard-fail-on-missing-creds path) |
| OS-registered state | None — no Task Scheduler, launchd, or systemd entries created by Phase 18 | None |
| Secrets/env vars | None new — Phase 18 reads existing keyring entries; no new env vars introduced | None |
| Build artifacts | None — pure additive Rust modules + frontend components; no compiled deliverables outside the existing tauri app | Standard `npm run tauri build` produces the unified bundle |

**Critical runtime caveat (the OBSERVE_ONLY architectural correction):** Existing `static OBSERVE_ONLY: AtomicBool` at ecosystem.rs:17 is process-lifetime memory — flipping briefly during action execution leaves a window where ANY tentacle (not just the consenting one) could write. Per-tentacle gating is required runtime state, not just a flag toggle. See § Pitfall 1 + § OBSERVE_ONLY Architecture.

---

## OBSERVE_ONLY Architecture (research correction to D-06)

**Current state (verified 2026-04-30):**
- `ecosystem.rs:17` — `static OBSERVE_ONLY: AtomicBool = AtomicBool::new(true);` (single global)
- `ecosystem.rs:26` — `pub fn assert_observe_only_allowed(action: &str) -> Result<(), String>` (no tentacle parameter)
- `ecosystem.rs:390` — `pub fn ecosystem_observe_only_check() -> bool` (Tauri command — main toggle test seam)
- `config.rs:289-290` — `ecosystem_observe_only: bool` config field (currently always true)
- **No production callers yet** (commented `#[allow(dead_code)]` at l.25)

**D-06 says:** flip per-tentacle observe-only flag for one action.

**The gap:** there is no per-tentacle flag. `assert_observe_only_allowed` is a no-op in v1.1 because no acting tentacles call it. Phase 18 is the first phase that BOTH calls the guardrail AND needs per-tentacle isolation.

**Recommended Phase 18 approach (planner should treat as locked decision):**

1. **Keep the global `OBSERVE_ONLY` flag.** Don't remove or invert it. v1.1 lock is "true at startup, never cleared in v1.1" — Phase 18 keeps it true at startup and adds a SECOND surface for narrow per-action exceptions.

2. **Add per-tentacle write-unlock map:**
   ```rust
   // ecosystem.rs (extension)
   static WRITE_UNLOCKS: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();

   pub fn grant_write_window(tentacle: &str, ttl_secs: u64) -> WriteScope {
       let map = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
       let mut g = map.lock().unwrap();
       let deadline = Instant::now() + Duration::from_secs(ttl_secs);
       g.insert(tentacle.to_string(), deadline);
       WriteScope { tentacle: tentacle.to_string() }
   }

   pub struct WriteScope { tentacle: String }
   impl Drop for WriteScope {
       fn drop(&mut self) {
           let map = WRITE_UNLOCKS.get_or_init(|| Mutex::new(HashMap::new()));
           if let Ok(mut g) = map.lock() { g.remove(&self.tentacle); }
       }
   }
   ```

3. **Extend `assert_observe_only_allowed` to take a tentacle parameter:**
   ```rust
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

4. **`jarvis_dispatch::dispatch_action` calls** `let _scope = ecosystem::grant_write_window(target_service, 30);` BEFORE invoking the outbound, RAII guard auto-revokes on completion / panic.

5. **TTL cap = 30 seconds** — generous enough for slow OAuth bounces, narrow enough that a panic-and-leak doesn't open the door indefinitely.

This preserves M-03 (observe-only by default) while enabling D-06 (per-action consent → narrow per-tentacle write window).

**Verification:** `verify-ecosystem-guardrail.mjs` exists in scripts/ — Phase 18 must update or extend it to test the per-tentacle path doesn't accidentally unlock the global flag.

---

## Dispatch Order Verdict (CONTEXT.md "Claude's Discretion")

CONTEXT.md "Claude's Discretion" speculated **MCP-first by default**. Research finds this creates double-routing because Slack tentacle ALREADY proxies through MCP under the hood (`slack_deep.rs:34`).

**Verdict (LOCKED for planner):** Native-tentacle-FIRST with three sub-rules:

1. **If a native tentacle has an outbound write function** (e.g. `linear_create_issue`, `calendar_post_meeting_summary`, the new `slack_outbound::post_message`) → call it directly. The tentacle decides whether to use MCP or HTTP under the hood.
2. **If no native tentacle exists for the target service**, but an MCP server is registered with a matching tool → use `mcp::call_tool("mcp__<server>_<tool>", args)` directly.
3. **If neither**, fall back to `native_tools.rs` (only viable for non-tentacle actions: filesystem, shell, browser, system control).

**Result:** D-05's three-tier order collapses to a single resolution function:

```rust
// jarvis_dispatch.rs (sketch)
pub async fn dispatch_action(intent: &IntentClass, app: &AppHandle) -> DispatchResult {
    match intent {
        IntentClass::ActionRequired { service, action } => {
            // Tier 1: native tentacle
            if let Some(result) = try_native_tentacle(service, action, app).await {
                return result;
            }
            // Tier 2: MCP fallback
            if let Some(result) = try_mcp_tool(service, action, app).await {
                return result;
            }
            // Tier 3: native_tools (only for non-service actions)
            try_native_tool(action, app).await
        }
        IntentClass::ChatOnly => DispatchResult::NotApplicable,
    }
}
```

This honors D-05 priority order verbatim while avoiding the double-route trap.

---

## Consent Persistence Verdict

**The data shape:** consent matrix is `(intent_class, target_service) → decision`. With ~5 intent classes (chat_only, action_required for slack/github/gmail/calendar/linear) and ~5 services, that's up to 25 rows; expansion to all 37+ native tools brings it to ~50.

**Keyring is the wrong shape:**
- Keyring entries are 1-per-key (`KEYRING_SERVICE = "blade-ai"` namespace, key = provider name).
- Storing 50 separate keyring entries means 50 separate OS calls to read state.
- Listing/iterating keyring entries is platform-specific and fragile (no `list_all_keys` API in `keyring` crate v2).
- "Revoke all consents" (D-08) requires iteration → must track a separate index → defeats keyring's atomic guarantee.

**SQLite is the right shape:**
- Existing `blade.db` at `crate::config::blade_config_dir().join("blade.db")` (used by evolution.rs:1117 + 9 other modules).
- Two-column composite primary key fits naturally.
- Bulk delete for "revoke all" is one SQL statement.
- Easy to surface in Doctor sub-tab later (Phase 17 reads the same DB for capability_gap aggregation).

**Verdict (LOCKED for planner):** New table `consent_decisions` in `~/.blade/blade.db`. Schema in § Pattern 5. CREATE TABLE IF NOT EXISTS at every connection-open (idempotent). Three Tauri commands: `consent_get_decision`, `consent_set_decision`, `consent_revoke_all`.

---

## Refusal Pattern Tuning

**D-12 initial set (5 mandatory):**
1. `r"(?i)\bI can'?t\b(?: directly)?"`
2. `r"(?i)\bI don'?t have access\b"`
3. `r"(?i)\bI'?m not able to\b"`
4. `r"(?i)\bI cannot directly\b"`
5. `r"(?i)\bI lack the\b"`

**Stretch (D-12 mentions; recommend including in initial Phase 18 ship):**
6. `r"(?i)\bas an AI\b"`
7. `r"(?i)\bI'?m unable to\b"`
8. `r"(?i)\bI don'?t have the (capability|ability|tools)\b"`

**Mental run-through against typical Claude/GPT refusals:**

| Hypothetical assistant output | Pattern that fires | False positive? |
|------------------------------|-------------------|-----------------|
| "I can't post to Slack — I don't have access to your workspace." | 1 + 2 | Both fire correctly (true refusal) |
| "I don't have the ability to send emails directly." | 8 | Correct |
| "As an AI, I can't browse the web autonomously." | 6 + 1 | Correct |
| "I can't help with that, but I can suggest some approaches." | 1 | **FALSE POSITIVE** — see Pitfall 8 |
| "I'm unable to verify those credentials, but the format looks correct." | 7 | **FALSE POSITIVE** — same pattern |
| "I'd need a Slack integration to do that." | (none) | Should be CapabilityGap, not Refusal — but neither matches → falls through to Pass. Add pattern 9: `r"(?i)\bI'?d need (a |an )?\w+ (integration|tool|api)\b"` to catch this as CapabilityGap. |

**Verdict:** Ship 8 patterns (5 mandatory + 3 stretch from D-12) PLUS pattern 9 for CapabilityGap detection PLUS the "but … can" exclusion (Pitfall 8). Total 9 patterns + 1 disjunction-aware post-check.

**Phase 18 plan should include:** unit tests for each pattern with at least one true positive and one false-positive avoidance case.

---

## Cold-Install Demo Viability (D-21)

**Demo target service:** Slack (per D-21).

**Slack credential path verification (2026-04-30):**
- `slack_deep.rs` already exists as observer-only.
- Credential path is **MCP-mediated**: `slack_deep::mcp_registered()` checks if user has Slack MCP server installed (`cfg.mcp_servers` iter for `name="slack"`).
- If Slack MCP is registered, `slack_call("chat.postMessage", {...})` would go through `manager.call_tool("mcp__slack_chat.postMessage", args)`.
- **No direct OAuth flow in BLADE for Slack** — the Slack MCP server (e.g. `@modelcontextprotocol/server-slack`) handles its own auth via `SLACK_BOT_TOKEN` env var passed to the MCP child process at registration time.

**Demo path viability assessment:**

| Target | Cred path exists? | Demo viability |
|--------|-------------------|----------------|
| Slack | YES *if user has Slack MCP server installed* | High — but D-10 says "hard fail on missing creds." If operator's machine doesn't have Slack MCP registered, demo fails at consent dialog stage. **Plan must verify operator has Slack MCP installed BEFORE running the demo, OR pick a fallback service.** |
| Linear | YES — `linear_create_issue` already shipped (linear_jira.rs:108 + tauri command at l.836) using existing keyring `linear_token` | **HIGH viability — recommended fallback** |
| Calendar | YES — `calendar_post_meeting_summary` (l.916) — uses MCP path same as Slack | Medium (depends on Calendar MCP) |
| GitHub | YES — `github_token()` (l.164) reads keyring; gh_post() exists | High if user has GitHub PAT in keyring |

**Verdict (LOCKED for planner):** Demo target = **Slack as primary (per D-21), Linear as fallback**. Plan must include a Wave 0 task that verifies operator's MCP/keyring state and prints a clear pass/fail diagnostic. If Slack MCP is missing, the operator should either install the Slack MCP server first OR run the demo against Linear (which has guaranteed credential availability via existing `linear_token` keyring entry).

**Operator's actual screenshot path:** `docs/testing ss/jarvis-cold-install-demo.png` (literal space — D-21).

---

## Code Examples

### Existing Pattern: Tentacle Outbound Write (calendar_post_meeting_summary — l.916)
Source: `src-tauri/src/tentacles/calendar_tentacle.rs:915-922`
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
**Phase 18 replication for new tentacles:** Identical signature shape. New file `src-tauri/src/tentacles/slack_outbound.rs` exports `slack_outbound_post_message` taking `app, channel, text` returning `Result<PostResult, String>`.

### Existing Pattern: Capability Gap Logging (evolution.rs:1115)
Source: verbatim
```rust
#[tauri::command]
pub fn evolution_log_capability_gap(capability: String, user_request: String) -> String {
    let db_path = crate::config::blade_config_dir().join("blade.db");
    if let Ok(conn) = rusqlite::Connection::open(&db_path) {
        let _ = crate::db::timeline_record(
            &conn,
            "capability_gap",
            &format!("Blocked on: {}", crate::safe_slice(&capability, 80)),
            &user_request,
            "BLADE",
            &serde_json::json!({"capability": capability}).to_string(),
        );
    }
    format!("Capability gap detected: {}. ...", capability)
}
```
**Phase 18 reuse:** `ego::handle_refusal` calls this verbatim from the CapabilityGap match arm.

### Existing Pattern: Capability Catalog Extension (D-16)
Source: `src-tauri/src/self_upgrade.rs:110-242` (capability_catalog fn) + l.27-32 (CapabilityGap struct)

**Phase 18 modification:**
```rust
// Add discriminator
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityGap {
    pub description: String,
    pub category: String,
    pub suggestion: String,
    pub install_cmd: String,           // existing — empty for Integration kind
    #[serde(default)]
    pub kind: CapabilityKind,          // NEW
    #[serde(default)]
    pub integration_path: String,      // NEW — populated for Integration kind, e.g. "Integrations tab → Slack"
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityKind { Runtime, Integration }

impl Default for CapabilityKind {
    fn default() -> Self { Self::Runtime }   // back-compat with existing 18 entries
}

// In capability_catalog():
map.insert("slack_outbound", CapabilityGap {
    description: "BLADE doesn't have a Slack writer integration".to_string(),
    category: "missing_integration".to_string(),
    suggestion: "Connect Slack via Integrations tab".to_string(),
    install_cmd: String::new(),            // empty — no shell install
    kind: CapabilityKind::Integration,
    integration_path: "Integrations tab → Slack".to_string(),
});
// Same for github_outbound, gmail_outbound, calendar_write, linear_outbound.
```
**`auto_install` modification at self_upgrade.rs:290:** check `gap.kind`; if `Integration`, return early with a message routing the user to `gap.integration_path` (no shell-out).

### Existing Pattern: AssistantTurn return shape (the ego intercept point)
Source: `src-tauri/src/providers/mod.rs:161` + `commands.rs:1517`
```rust
// providers/mod.rs:161
pub struct AssistantTurn {
    pub content: String,                              // ← THIS is what ego intercepts
    pub tool_calls: Vec<...>,
}

// commands.rs:1517 (current code)
let (clean_content, parsed_actions) = crate::action_tags::extract_actions(&turn.content);
```
**Phase 18 wraps at this point:**
```rust
// commands.rs:1517 (proposed)
let verdict = crate::ego::intercept_assistant_output(&turn.content);
let final_content = match verdict {
    EgoVerdict::Pass => turn.content.clone(),
    EgoVerdict::CapabilityGap { .. } | EgoVerdict::Refusal { .. } => {
        let outcome = crate::ego::handle_refusal(&app, verdict, &last_user_text).await;
        match outcome {
            EgoOutcome::Retried { new_response } | EgoOutcome::AutoInstalled { then_retried: new_response, .. } => new_response,
            EgoOutcome::HardRefused { final_response, .. } => final_response,
        }
    }
};
let (clean_content, parsed_actions) = crate::action_tags::extract_actions(&final_content);
// rest of existing flow continues unchanged
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled refusal regex with String::contains | `regex` crate with word-boundaries + case-insensitive flag | Built into BLADE Cargo.toml line 56 | Use the in-tree dep; no new dep |
| Voice-first JARVIS demo (PTT) | Text-chat-first JARVIS demo (chat-first pivot) | Operator pivot 2026-04-30 (memory `feedback_chat_first_pivot.md`) | Phase 18 ships text-chat path; voice deferred to v1.3 with zero rework needed |
| Single global OBSERVE_ONLY toggle | Per-tentacle write windows over a global default-deny baseline | Phase 18 adds the per-tentacle path | M-03 preserved; D-06 enabled |
| MCP-first dispatch speculation | Native-tentacle-first (research verdict) | Phase 18 research 2026-04-30 | Avoids double-routing in Slack tentacle |

**Deprecated/outdated:**
- D-20's "research/questions.md does NOT exist yet" — outdated; file exists at `.planning/research/questions.md` (verified 2026-04-30). Plan task is MODIFY, not CREATE.

---

## Q1 Closure (research/questions.md)

**Verified file location:** `.planning/research/questions.md` (D-20 path is wrong; correct path verified 2026-04-30).

**Q1 current state:** Open. Stub asks whether `browser-use/browser-harness` solves browser-control problem.

**D-20 verdict to land in the file:**

> **Verdict — closed 2026-04-30 (Phase 18 research):** Browser-harness installs ALWAYS require explicit consent. They are large, slow, and user-perceptible (downloads a Chromium binary, starts a long-lived process). Routine creds-based capability gaps (Slack OAuth, GitHub PAT, etc.) auto-prompt via the standard consent dialog. Browser/runtime installs go through a separate explicit-consent surface that surfaces install size, time-to-first-use, and disk footprint before downloading. Browser-harness adoption decision (whether to integrate it at all vs. keeping browser_native.rs + browser_agent.rs) is **deferred to v1.3** when Phase 18's chat-action spine is operational and we can measure where browser fallback is actually needed. **Status:** closed.

Plan task: append this verdict block to the existing Q1 entry, change `Status: open` → `Status: closed`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The fast streaming branch (commands.rs:1166) is rare for action-eliciting messages because of its `is_conversational && is_short_conversation` guards | § Pitfall 3 + Anti-Patterns | If users frequently hit the fast path with refusal-eliciting prompts, ego coverage gap shows up in production. Mitigation: track in metrics whether refusals happen on fast vs tool-loop branch. |
| A2 | `regex` crate at Cargo.toml line 56 is sufficient for D-12 patterns; no need for `lazy_static` or `once_cell` direct dep | § Standard Stack + § Pattern 2 | If once_cell isn't a transitive dep, fall back to `std::sync::OnceLock<Vec<…>>` (stable since Rust 1.70). Verified ASSUMED — needs confirmation by running cargo expand against trial code. |
| A3 | Slack MCP server (`@modelcontextprotocol/server-slack` or similar) handles its own OAuth — BLADE doesn't need to add Slack OAuth flow in Phase 18 | § Cold-Install Demo Viability | If the operator's Slack MCP server doesn't exist or doesn't expose `chat.postMessage` write tool, the demo target fallback to Linear is safer. Plan should validate operator's MCP state in Wave 0. |
| A4 | Per-tentacle WriteScope RAII pattern works correctly for async dispatch (Drop fires on .await cancellation, panic, AND clean exit) | § OBSERVE_ONLY Architecture | Tokio cancellation safety with sync Mutex + Drop is well-established but worth a unit test. Plan should include a "scope drops on panic" test. |
| A5 | The ConsentDialog → user-decision → continue-action flow can be implemented with a one-shot Tauri channel + an async wait without timing out the chat stream | Pattern 5 + § System Architecture | If the chat pipeline times out waiting for user click, the action gets stuck. Recommend: max 60s wait; on timeout, assume "deny" and surface the timeout reason in the JARVIS pill. |
| A6 | "But I can …" disjunction is the dominant false-positive pattern for refusal regex (Pitfall 8) | § Refusal Pattern Tuning | Operator usage will validate. Plan unit tests should include 5+ false-positive cases beyond just "but can." |
| A7 | `intent_router::classify` heuristic short-circuits ≥80% of inputs without LLM-fallback | § Anti-Patterns | If heuristic miss-rate is high, LLM cost balloons. Recommend telemetry from day 1 — log heuristic-vs-LLM-fallback ratio in evolution timeline. |

---

## Open Questions

1. **Should the consent decision matrix include `Allow once` as a row, or only `Allow always` / `Denied`?**
   - What we know: D-08 says "Allow once / Allow always / Deny" are the dialog options; persistence is "per (intent_class, target_service)."
   - What's unclear: "Allow once" should NOT be persisted (or it's not a consent decision, just a single-action approval); "Allow always" persists as `allow_always`; "Deny" persists as `denied`. Three-state UI maps to two-state storage.
   - Recommendation: persist only `allow_always` and `denied`. Treat `allow_once` as "execute this action without writing a row." Plan unit test: `consent_get_decision` returns None after Allow once → re-prompt next turn.

2. **Should ego_intercept run on `chat_done` (post-stream client-side accumulation) instead of pre-stream server-side?**
   - What we know: tool-loop branch has full text at l.1517 — ego can run server-side. Fast branch streams live without accumulator.
   - What's unclear: an alternative architecture would have client accumulate `chat_token` events, fire ego on `chat_done`, and re-emit replacement text. This covers fast path too.
   - Recommendation: stick with server-side tool-loop intercept for Phase 18 (matches D-11 verbatim). Document fast-path gap. Revisit in v1.3 if fast-path refusals become user-visible.

3. **Does `app.emit_to("main", "jarvis_intercept", ...)` reach the MessageList component, given main is the only window with chat?**
   - What we know: chat surface lives only in the main window per existing architecture (commands.rs has cross-window emit only for blade_status, blade_message_start to main+quickask).
   - What's unclear: should jarvis_intercept also reach quickask if a quickask user could trigger a JARVIS action? If quickask has chat capability in v1.2, yes.
   - Recommendation: emit to main only in Phase 18. If quickask chat is in scope, broadcast (and add to allowlist). Verify quickask scope with operator.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `regex` Rust crate | REFUSAL_PATTERNS (D-12) | ✓ | "1" [VERIFIED: Cargo.toml:56] | — |
| `rusqlite` Rust crate | consent_decisions table | ✓ (already used by 9+ modules) | in tree | — |
| `keyring` Rust crate | Existing observer creds (reused per D-07) | ✓ | in tree | — |
| `Dialog` primitive | ConsentDialog | ✓ [VERIFIED: src/design-system/primitives/Dialog.tsx + index.ts:8] | in tree | — |
| `Badge` primitive | JarvisPill | ✓ [VERIFIED: src/design-system/primitives/Badge.tsx + index.ts:6] | in tree | — |
| `Pill` primitive | JarvisPill (alternative) | ✓ [VERIFIED: src/design-system/primitives/Pill.tsx + index.ts:5] | in tree | — |
| Slack MCP server | Cold-install demo target (D-21) | ✗ (operator-machine specific) | — | Use Linear as demo fallback (linear_create_issue ships with guaranteed creds path) |
| GitHub PAT in keyring | github_outbound | ✗ (operator-machine specific) | — | Skip GitHub demo paths if no PAT; show consent dialog with "Connect via Integrations tab" hint per D-10 |
| Calendar MCP server | calendar_create_event | ✗ (operator-machine specific) | — | Use existing calendar_post_meeting_summary path which already proves the MCP detection logic |
| Gmail OAuth | gmail_outbound | ✗ (operator-machine specific, depends on Gmail MCP) | — | Same hard-fail-with-suggestion pattern per D-10 |
| `tauri-plugin-updater` | (no Phase 18 dependency) | ✓ | "2" | — (Phase 17 surface) |

**Missing dependencies with no fallback:**
- (none — all Phase 18 work can ship with degraded but functional fallbacks)

**Missing dependencies with fallback:**
- All cross-app target services have a "Connect via Integrations tab" fallback path per D-10 (hard-fail-on-missing-creds). For the cold-install demo (D-21 + JARVIS-12), Linear is the recommended primary target since `linear_create_issue` ships with a guaranteed-credentials path; Slack is a nice-to-have if operator has Slack MCP installed.

---

## Validation Architecture

> Required because `workflow.nyquist_validation: true` in `.planning/config.json` (verified 2026-04-30). Without this section, plans fail Dimension 8.

### Test Framework
| Property | Value |
|----------|-------|
| Rust framework | `cargo test` (built-in) — `#[cfg(test)] mod tests { ... }` per-file pattern (proven in `router.rs:423-663` for `select_provider`) |
| Rust config file | `Cargo.toml` (workspace-default) |
| TypeScript framework | (no frontend test framework currently in tree — visual UAT instead per Phase 17 lesson) |
| Quick run command | `cd src-tauri && cargo test --lib ego intent_router consent jarvis_dispatch -- --nocapture` |
| Full suite command | `cd src-tauri && cargo test --lib && cd .. && npm run verify:all` |
| TypeScript clean check | `npx tsc --noEmit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| JARVIS-03 | `intent_router::classify` returns ChatOnly for "hello world" | unit | `cargo test --lib intent_router::classify_chat_only -- --nocapture` | ❌ Wave 0 |
| JARVIS-03 | `intent_router::classify` returns ActionRequired{slack, post_message} for "post X to #team in Slack" | unit | `cargo test --lib intent_router::classify_action_required -- --nocapture` | ❌ Wave 0 |
| JARVIS-03 | LLM-fallback fires only on heuristic ambiguity | unit (mocked LLM) | `cargo test --lib intent_router::heuristic_short_circuits -- --nocapture` | ❌ Wave 0 |
| JARVIS-04 | `jarvis_dispatch::dispatch_action` routes Slack ActionRequired to slack_outbound | unit (mocked tentacle) | `cargo test --lib jarvis_dispatch::routes_to_native_tentacle -- --nocapture` | ❌ Wave 0 |
| JARVIS-04 | dispatch falls back to MCP when no native tentacle | unit (mocked) | `cargo test --lib jarvis_dispatch::mcp_fallback -- --nocapture` | ❌ Wave 0 |
| JARVIS-04 | dispatch hard-fails on missing creds (D-10) | unit | `cargo test --lib jarvis_dispatch::hard_fail_no_creds -- --nocapture` | ❌ Wave 0 |
| JARVIS-05 | `consent_set_decision` persists allow_always to SQLite | unit | `cargo test --lib consent::set_persists -- --nocapture` | ❌ Wave 0 |
| JARVIS-05 | `consent_get_decision` returns None for unknown tuple | unit | `cargo test --lib consent::get_returns_none_for_unknown -- --nocapture` | ❌ Wave 0 |
| JARVIS-05 | `consent_revoke_all` clears all rows | unit | `cargo test --lib consent::revoke_all_clears -- --nocapture` | ❌ Wave 0 |
| JARVIS-06 | Each refusal pattern (≥5) matches expected input | unit (table-driven) | `cargo test --lib ego::refusal_patterns -- --nocapture` | ❌ Wave 0 |
| JARVIS-06 | "but I can…" disjunction does NOT trigger refusal | unit | `cargo test --lib ego::no_false_positive_on_but_can -- --nocapture` | ❌ Wave 0 |
| JARVIS-07 | CapabilityGap verdict triggers `evolution_log_capability_gap` | integration (in-process) | `cargo test --lib ego::handle_refusal_logs_gap -- --nocapture` | ❌ Wave 0 |
| JARVIS-07 | Auto-install fires for Runtime kind, NOT for Integration kind | unit | `cargo test --lib ego::auto_install_only_runtime -- --nocapture` | ❌ Wave 0 |
| JARVIS-08 | RETRY_COUNT increments to 1 then refuses | unit | `cargo test --lib ego::retry_cap_holds -- --nocapture` | ❌ Wave 0 |
| JARVIS-09 | `.planning/research/questions.md` Q1 status == "closed" | static | `grep -q "Status: closed" .planning/research/questions.md` | ✅ (file exists; needs Q1 status update) |
| JARVIS-10 | `dispatch_action` emits one `blade_activity_log` per outcome | integration (event capture) | `cargo test --lib jarvis_dispatch::emits_activity_log -- --nocapture` | ❌ Wave 0 |
| JARVIS-11 | `useTauriEvent(JARVIS_INTERCEPT)` subscriber receives payload | manual UAT (no frontend test framework) | observe in `npm run tauri dev` + browser dev console | ✅ existing useTauriEvent surface |
| JARVIS-12 (rewritten) | Cold-install demo: text chat → consent → real cross-app action → ActivityStrip emission → screenshot saved | end-to-end runtime UAT | `npm run tauri dev` + manual chat input + screenshot to `docs/testing ss/jarvis-cold-install-demo.png` | n/a — runtime UAT |
| (M-03 preservation) | Per-tentacle WriteScope drops on panic, restoring observe-only | unit | `cargo test --lib ecosystem::write_scope_drops_on_panic -- --nocapture` | ❌ Wave 0 |
| (verify-emit-policy) | `app.emit_to("main", "jarvis_intercept", ...)` passes the gate | static | `npm run verify:emit-policy` | ✅ existing script; no new entry needed if emit_to "main" used |
| (verify-wiring-audit-shape) | New modules registered in 10-WIRING-AUDIT.json | static | `npm run verify:wiring-audit-shape` | ❌ Wave 0 (4 module entries to add) |

### Sampling Rate
- **Per task commit:** `cd src-tauri && cargo test --lib <module-being-edited>` — fast subset matching the file changed
- **Per wave merge:** `cd src-tauri && cargo test --lib && npm run verify:all && npx tsc --noEmit` — full Rust suite + 30+ verify gates + TS clean
- **Phase gate:** Full suite green before `/gsd-verify-work`; PLUS the JARVIS-12 cold-install demo runtime UAT (NOT polish — it's the SC per CONTEXT.md operator-blessed framing)

### Wave 0 Gaps
- [ ] `src-tauri/src/ego.rs` — needs `#[cfg(test)] mod tests` block with refusal pattern table-driven tests + retry cap test
- [ ] `src-tauri/src/intent_router.rs` — needs tests block with heuristic + LLM-fallback path mocks
- [ ] `src-tauri/src/jarvis_dispatch.rs` — needs tests block (tentacle/MCP/native_tools fallback chain)
- [ ] `src-tauri/src/consent.rs` — needs tests block (SQLite CRUD + revoke_all)
- [ ] `src-tauri/src/ecosystem.rs` — extend existing `mod tests` (l.408+) with WriteScope drop tests
- [ ] `.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` — append 4 module entries (ego, intent_router, jarvis_dispatch, consent) + 3 tentacle entries (slack_outbound, github_outbound, gmail_outbound)
- [ ] `.planning/research/questions.md` — Q1 closure verdict (D-20)
- [ ] No framework install needed — `cargo test` is built-in; regex + rusqlite already in tree

---

## Sources

### Primary (HIGH confidence)
- **CLAUDE.md** — module registration 3-step, flat #[tauri::command] namespace, safe_slice, Verification Protocol (read 2026-04-30)
- **18-CONTEXT.md** D-01..D-21 — locked architectural decisions
- **STATE.md** — chat-first pivot context, M-03 OBSERVE_ONLY lock, M-07 ActivityStrip contract
- **PROJECT.md** D-01..D-45 — stack rules, useTauriEvent only, Tailwind v4
- **17-RESEARCH.md** + 17-PATTERNS.md — Phase 17 module registration / event registry / activity-log emission patterns (proven shipped 2026-04-30)
- **`src-tauri/src/router.rs`** (full read 2026-04-30) — TaskType + classify_message + classify_task signatures
- **`src-tauri/src/self_upgrade.rs:110-242,290-354`** (read) — capability_catalog + auto_install (D-16 extension target)
- **`src-tauri/src/evolution.rs:1115`** (read) — evolution_log_capability_gap (D-13 reuse target)
- **`src-tauri/src/ecosystem.rs:1-100,380-475`** (read) — OBSERVE_ONLY surface + emit_activity_with_id pattern
- **`src-tauri/src/integration_bridge.rs:1-100`** (read) — observer creds store
- **`src-tauri/src/tentacles/calendar_tentacle.rs:897-950`** (read) — outbound write tauri command pattern
- **`src-tauri/src/tentacles/linear_jira.rs:108-136,836`** (read) — linear_create_issue outbound pattern
- **`src-tauri/src/tentacles/github_deep.rs:13,164-200`** (read) — github_token() + gh_get/gh_post helpers (reused for github_outbound)
- **`src-tauri/src/tentacles/slack_deep.rs:10-58`** (read) — Slack MCP integration pattern (slack_call uses MCP)
- **`src-tauri/src/mcp.rs:440-560`** (read) — discover_all_tools + call_tool API
- **`src-tauri/src/commands.rs:1100-1180,1500-1600`** (read) — fast streaming branch + tool-loop branch + ego intercept point at l.1517
- **`src-tauri/src/providers/mod.rs:161,257-300,600-707`** (read) — AssistantTurn + stream_text + fallback_chain_complete
- **`src-tauri/src/providers/anthropic.rs:174-249`** (read) — stream_text emits tokens directly (no accumulator)
- **`src/lib/events/index.ts`** (full read 2026-04-30) — BLADE_EVENTS frozen registry + useTauriEvent hook
- **`src/lib/events/payloads.ts`** (full read 2026-04-30) — payload interface registry; DoctorEventPayload pattern
- **`src/features/chat/MessageList.tsx`** (full read) — D-18 pill placement target
- **`scripts/verify-emit-policy.mjs`** (full read) — CROSS_WINDOW_ALLOWLIST surface; 'doctor.rs:doctor_event' precedent
- **`.planning/research/questions.md`** (read) — Q1 stub already in place; D-20 verdict to land here

### Secondary (MEDIUM confidence)
- **`feedback_chat_first_pivot.md`** memory file — operator pivot context (read 2026-04-30)
- **`.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json:7297-7305`** — doctor.rs entry as template for Phase 18 module entries

### Tertiary (LOW confidence — flagged for validation)
- **`once_cell` transitive dep** — assumed available via tauri; if not, fall back to `std::sync::OnceLock`. Stable in Rust 1.70+.
- **Slack MCP server tool name** (`mcp__slack_chat.postMessage`) — assumed from slack_deep.rs `slack_call("chat.postMessage", ...)` pattern at l.34, where qualified name = `format!("mcp__slack_{}", tool)`. Actual tool name depends on which Slack MCP server the operator installed; a different server may expose `chat_post_message` (underscore vs dot). **Plan must validate at runtime — see Wave 0 task on operator MCP audit.**

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all deps already in tree; no new installs
- Architecture: HIGH — every integration point grep-verified live in repo on 2026-04-30
- OBSERVE_ONLY architecture correction: HIGH — single-flag verified at ecosystem.rs:17; per-tentacle gap is real, recommendation is concrete
- Refusal pattern tuning: MEDIUM — mental run-through of patterns; production validation will surface false-positive rate
- Cold-install demo viability: MEDIUM-HIGH — Slack/Linear paths verified; Slack MCP availability is operator-machine specific
- Pitfalls: HIGH — every pitfall traced to a specific code line or Phase 17 lesson

**Research date:** 2026-04-30
**Valid until:** 2026-05-30 (30 days for stable BLADE codebase; revalidate if commands.rs send_message_stream surface changes or if Slack MCP server schema changes)
