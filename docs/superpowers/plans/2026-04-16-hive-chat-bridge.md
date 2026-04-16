# Hive-Chat Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Hive's real-time organ intelligence into the chat system prompt, replacing scattered context assembly with a compact digest from the already-running Hive tick loop.

**Architecture:** Add a `hive::get_hive_digest()` function that produces a ~500-char summary from active tentacles and head models. Inject this digest into `brain.rs` as a high-priority context block (priority 7, replacing the current scattered perception/clipboard/activity blocks). The Hive already runs, polls APIs, and synthesizes reports — this plan just connects its output to the chat's input.

**Tech Stack:** Rust (Tauri 2), existing hive.rs + brain.rs + commands.rs modules

---

### Task 1: Add `get_hive_digest()` to hive.rs

**Files:**
- Modify: `src-tauri/src/hive.rs` (after `get_hive_status()` at ~line 2910)

This function reads the current Hive state and produces a compact markdown summary for injection into the system prompt. No LLM call — pure data formatting from what the Hive already collected.

- [ ] **Step 1: Add the `get_hive_digest()` function**

Add after the `get_hive_status()` function (around line 2910):

```rust
/// Compact intelligence digest for the chat system prompt.
/// Returns a short markdown block (~300-600 chars) summarizing what the Hive
/// currently knows. Designed to replace scattered context blocks in brain.rs.
/// Returns empty string if Hive is not running or has no data.
pub fn get_hive_digest() -> String {
    let hive = match hive_lock().lock() {
        Ok(h) => h,
        Err(_) => return String::new(),
    };

    if !hive.running {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();
    lines.push("## Live Intelligence (Hive)".to_string());

    // Collect active tentacle summaries — one line each, only notable state
    for tentacle in hive.tentacles.values() {
        if tentacle.status != TentacleStatus::Active {
            continue;
        }
        // Most recent unprocessed report (the freshest signal)
        if let Some(report) = tentacle.pending_reports.iter().rev().find(|r| !r.processed) {
            let urgency = match report.priority {
                Priority::Critical => "URGENT: ",
                Priority::High => "",
                _ => continue, // skip Normal/Low for digest — too noisy
            };
            lines.push(format!(
                "- **{}** {} {}",
                tentacle.platform,
                urgency,
                crate::safe_slice(&report.summary, 100),
            ));
        }
    }

    // Pending decisions that need user attention
    let pending: Vec<&Decision> = hive
        .heads
        .values()
        .flat_map(|h| h.pending_decisions.iter())
        .filter(|d| matches!(d, Decision::Ask { .. }))
        .take(3)
        .collect();

    if !pending.is_empty() {
        lines.push(String::new());
        lines.push("**Pending decisions:**".to_string());
        for d in pending {
            match d {
                Decision::Ask { question, .. } => {
                    lines.push(format!("- {}", crate::safe_slice(question, 80)));
                }
                _ => {}
            }
        }
    }

    // If nothing notable, return a minimal status line
    if lines.len() <= 1 {
        let active = hive.tentacles.values().filter(|t| t.status == TentacleStatus::Active).count();
        if active > 0 {
            lines.push(format!("- {} organs active, nothing urgent", active));
        } else {
            return String::new();
        }
    }

    lines.join("\n")
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/arnav/blade/src-tauri && cargo check 2>&1 | grep "^error\["`

Expected: No Rust compilation errors (only the pre-existing libpipewire system dep error on WSL).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hive.rs
git commit -m "feat(hive): add get_hive_digest() for chat prompt injection"
```

---

### Task 2: Inject Hive digest into brain.rs

**Files:**
- Modify: `src-tauri/src/brain.rs` (inside `build_system_prompt_inner`, after the God Mode context block at priority 7)

The existing brain.rs has a 17-priority context system. The Hive digest replaces the need for brain.rs to independently gather perception, clipboard, activity, and integration data — the Hive already synthesized all of that. We inject it at priority 7 (Live Perception), right after the existing God Mode context.

- [ ] **Step 1: Find the God Mode context injection point in brain.rs**

Search for the God Mode context block. It should be around priority 7 in `build_system_prompt_inner`. Look for text like "God Mode" or "godmode_context" or "Live Perception".

```bash
cd /home/arnav/blade/src-tauri && grep -n "godmode\|god_mode\|God Mode\|Live Perception" src/brain.rs | head -20
```

- [ ] **Step 2: Add Hive digest injection after the God Mode block**

After the God Mode context section (which injects the godmode_context.md file), add:

```rust
// ── Hive intelligence digest (priority 7.5) ────────────────────────────
// The Hive's tentacles are always monitoring platforms (Slack, GitHub, etc.)
// and heads synthesize cross-domain intelligence. This compact digest gives
// the chat model awareness of what's happening WITHOUT bloating the prompt —
// the Hive already did the heavy thinking.
{
    let hive_digest = crate::hive::get_hive_digest();
    if !hive_digest.is_empty() {
        parts.push(hive_digest);
    }
}
```

Insert this AFTER the God Mode context block and BEFORE the memory recall block (priority 8).

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/arnav/blade/src-tauri && cargo check 2>&1 | grep "^error\["`

Expected: No Rust compilation errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/brain.rs
git commit -m "feat(brain): inject hive digest into system prompt at priority 7.5"
```

---

### Task 3: Add a Tauri command to inspect the digest

**Files:**
- Modify: `src-tauri/src/hive.rs` (add command after existing `hive_get_status`)
- Modify: `src-tauri/src/lib.rs` (register in `generate_handler!`)

Expose the digest as a Tauri command so the frontend and developers can inspect what the chat model sees from the Hive.

- [ ] **Step 1: Add the Tauri command to hive.rs**

Add after the existing `hive_get_status` command:

```rust
/// Returns the current Hive intelligence digest — the compact summary
/// injected into the chat system prompt. Useful for debugging/display.
#[tauri::command]
pub fn hive_get_digest() -> String {
    get_hive_digest()
}
```

- [ ] **Step 2: Register in lib.rs generate_handler**

Find `hive_get_status` in the `generate_handler![]` macro and add `hive_get_digest` next to it:

Search for `hive_get_status` in lib.rs, then add `hive_get_digest` immediately after it in the comma-separated list.

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/arnav/blade/src-tauri && cargo check 2>&1 | grep "^error\["`

Expected: No Rust compilation errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/hive.rs src-tauri/src/lib.rs
git commit -m "feat(hive): expose hive_get_digest Tauri command for frontend/debug"
```

---

### Task 4: Include ALL active tentacle status (not just urgent)

**Files:**
- Modify: `src-tauri/src/hive.rs` (`get_hive_digest()`)

The initial digest only shows High/Critical reports. But the Brain needs to know what organs EXIST and what they're doing — even if nothing is urgent. This is the "anatomy awareness" from the spec: Brain sees "6 organs active: slack, github, email, screen, ci, calendar" so it knows what it CAN ask.

- [ ] **Step 1: Add an organ status section to the digest**

Modify `get_hive_digest()` — add an organ status block BEFORE the urgent reports section:

```rust
// Active organ roster — Brain needs to know what capabilities are available
let active_organs: Vec<String> = hive
    .tentacles
    .values()
    .filter(|t| t.status == TentacleStatus::Active)
    .map(|t| t.platform.clone())
    .collect();

if !active_organs.is_empty() {
    lines.push(format!("**Active organs:** {}", active_organs.join(", ")));
}

// Dormant/error organs — Brain should know what's NOT available
let inactive: Vec<String> = hive
    .tentacles
    .values()
    .filter(|t| t.status != TentacleStatus::Active)
    .map(|t| format!("{} ({})", t.platform, match t.status {
        TentacleStatus::Dormant => "dormant",
        TentacleStatus::Error => "error",
        TentacleStatus::Disconnected => "disconnected",
        _ => "inactive",
    }))
    .collect();

if !inactive.is_empty() {
    lines.push(format!("**Unavailable:** {}", inactive.join(", ")));
}
```

Insert this after the header line `"## Live Intelligence (Hive)"` and before the urgent reports loop.

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/arnav/blade/src-tauri && cargo check 2>&1 | grep "^error\["`

Expected: No Rust compilation errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hive.rs
git commit -m "feat(hive): include organ roster in digest for brain anatomy awareness"
```

---

### Task 5: Add head summaries to the digest

**Files:**
- Modify: `src-tauri/src/hive.rs` (`get_hive_digest()`)

Heads synthesize domain intelligence. The digest should include a 1-line summary from each active head so the Brain gets the cross-domain picture.

- [ ] **Step 1: Read the HeadModel struct to find available summary data**

```bash
cd /home/arnav/blade/src-tauri && grep -n "pub struct HeadModel" -A 20 src/hive.rs
```

Check what fields HeadModel has that we can use for a summary line.

- [ ] **Step 2: Add head summaries to the digest**

After the organ roster section, add:

```rust
// Head-level intelligence — one line per domain
for head in hive.heads.values() {
    let report_count = hive
        .tentacles
        .values()
        .filter(|t| t.head == head.id)
        .flat_map(|t| t.pending_reports.iter())
        .filter(|r| !r.processed)
        .count();

    let decision_count = head.pending_decisions.len();

    if report_count > 0 || decision_count > 0 {
        let mut parts = Vec::new();
        if report_count > 0 {
            parts.push(format!("{} pending reports", report_count));
        }
        if decision_count > 0 {
            parts.push(format!("{} decisions pending", decision_count));
        }
        lines.push(format!("- **{} Head:** {}", head.domain, parts.join(", ")));
    }
}
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/arnav/blade/src-tauri && cargo check 2>&1 | grep "^error\["`

Expected: No Rust compilation errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/hive.rs
git commit -m "feat(hive): add head-level summaries to digest"
```

---

### Task 6: Emit hive digest in the chat routing event

**Files:**
- Modify: `src-tauri/src/commands.rs` (in the routing decision emit around line 556)

When a chat message is processed, the frontend shows which provider/model was selected. Add the hive digest to this event so the UI can optionally display what intelligence the Hive contributed to this response.

- [ ] **Step 1: Find the routing decision emit**

```bash
cd /home/arnav/blade/src-tauri && grep -n "chat_routing\|routing_decision\|blade_model" src/commands.rs | head -10
```

- [ ] **Step 2: Add hive_active flag to the routing event**

In the routing emit (around line 556-559), add a `hive_active` field:

```rust
let hive_active = !crate::hive::get_hive_digest().is_empty();
```

Then include `"hive_active": hive_active` in the JSON payload of the routing event.

- [ ] **Step 3: Verify it compiles**

Run: `cd /home/arnav/blade/src-tauri && cargo check 2>&1 | grep "^error\["`

Expected: No Rust compilation errors.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands.rs
git commit -m "feat(commands): include hive_active in chat routing event"
```

---

### Task 7: Update connection-map.md

**Files:**
- Modify: `docs/architecture/connection-map.md`

Document the new Hive → brain.rs data flow so future developers understand the connection.

- [ ] **Step 1: Find the brain.rs dependency section**

```bash
grep -n "brain.rs" docs/architecture/connection-map.md | head -10
```

- [ ] **Step 2: Add hive.rs → brain.rs dependency**

In the brain.rs dependency section, add:

```
  → hive::get_hive_digest()              compact organ/head intelligence for system prompt
```

- [ ] **Step 3: Find the hive.rs section and add brain.rs as a consumer**

If there's a hive.rs dependency section, add brain.rs as a consumer. If not, add one:

```
### hive.rs (distributed agent mesh) → other modules
```

```
hive.rs
  → brain.rs (via get_hive_digest)       system prompt injection
  → decision_gate                        autonomous action routing
  → typed_memory                         stores decisions + high-priority reports
  → execution_memory                     logs actions taken
  → people_graph                         enriches decisions with relationships
  → perception_fusion::get_latest()      screen awareness
  → integration_bridge                   email/slack/github state
```

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/connection-map.md
git commit -m "docs: add hive → brain.rs data flow to connection map"
```

---

## Verification

After all tasks are complete:

1. **Hive digest content check:** Run `cargo test` or manually call `hive_get_digest()` — verify it returns a non-empty string when the Hive is running with at least one active tentacle.

2. **System prompt check:** Set a breakpoint or add a temporary log in `build_system_prompt_inner` to verify the hive digest appears in the assembled prompt between priority 7 (God Mode) and priority 8 (Memory Recall).

3. **Prompt size check:** Verify the hive digest is under 600 chars in typical conditions (a few active tentacles, 1-2 urgent reports). The digest should NOT grow linearly with report count — it caps at High/Critical and takes max 3 pending decisions.

4. **No regression:** The existing God Mode context, memory recall, and context engine injection all still work. The hive digest is additive — it doesn't replace any existing priority blocks (yet — that's Phase 2).
