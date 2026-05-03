---
phase: 22
type: research
status: complete
written: 2026-05-01T08:45Z
---

# Phase 22 — RESEARCH

Audit of existing Voyager-shaped wiring vs v1.3 thesis target.

## TL;DR

**The Voyager loop is substantially already wired in BLADE v1.2.** Phase 22
is "audit + extend + ActivityStrip + SKILL.md export + verify gate + tests"
— NOT "build from scratch."

Existing flow:

```
chat refusal / capability gap detected
    │
    ▼
immune_system.rs:83 → tool_forge::forge_if_needed(user_request, error)
    │
    ▼
tool_forge.rs:444  forge_if_needed → triage decision via cheap LLM
    │
    ▼
tool_forge.rs:283  forge_tool(capability) → generate script via LLM →
                   write to ~/.config/blade/tools/<name>.{py,sh,js} →
                   smoke-test → persist to forged_tools SQLite table
    │
    ▼
brain.rs:1043     get_tool_usage_for_prompt() → injects into system prompt
                   → next chat turn sees the new tool
```

This is structurally the Voyager loop. What's missing for v1.3:

1. **No ActivityStrip emission** — tool_forge emits zero `blade_activity_log` events; the loop is invisible to the M-07 trust surface
2. **No SKILL.md export** — outputs proprietary JSON manifest, not agentskills.io format; doesn't interop with Phase 21 substrate
3. **No deterministic verify gate** — `forge_tool` requires a real LLM call; can't run in CI without an API key
4. **No skill-write budget cap** — forge_tool will spend whatever tokens it spends; no upper bound
5. **No failure recovery** — partial-write rollback on register-failure not implemented
6. **No canonical fixture** — no `youtube_transcript`-shaped end-to-end test
7. **No divergence property test** — two installs running different gap streams aren't proven to produce different manifests

## Existing API surface

### `evolution.rs`
- `evolution_log_capability_gap(capability, user_request) -> String` (line 1115) — Tauri command, persists to evolution log

### `autoskills.rs`
- `try_acquire(gap: GapContext, app: AppHandle) -> AutoskillResult` (line 169) — checks MCP catalog → installs server OR surfaces suggestion. **Does NOT call tool_forge.**

### `tool_forge.rs`
- `forge_tool(capability: &str) -> Result<ForgedTool>` (line 283) — generate + write + test + persist
- `forge_if_needed(user_request, error) -> Option<ForgedTool>` (line 444) — triage + forge_tool
- `get_tool_usage_for_prompt() -> String` (line 422) — system-prompt injection
- `get_forged_tools() -> Vec<ForgedTool>` (line 380) — list
- `forge_test_tool(id) -> Result<String>` (line 544) — re-test
- `forge_delete_tool(id) -> Result<()>` (line 519) — delete
- `record_tool_use(name)` (line 489) — usage tracking

### `immune_system.rs:83`
- The actual call site: `tool_forge::forge_if_needed(user_request, &format!("Missing capability: {}", capability))`

### `brain.rs:1043`
- `let forged = crate::tool_forge::get_tool_usage_for_prompt();`
- Injects forged tools into system prompt

## ActivityStrip emit pattern (M-07 contract)

Verified in `doctor.rs:730-756` (`emit_activity_for_doctor`):

```rust
app.emit_to("main", "blade_activity_log", serde_json::json!({
    "module":        "Doctor",
    "action":        "regression_detected",
    "human_summary": crate::safe_slice(&summary, 200),
    "payload_id":    serde_json::Value::Null,
    "timestamp":     chrono::Utc::now().timestamp(),
}));
```

Phase 22 needs a `voyager` module label with the 4 actions:
- `gap_detected` (immune_system entry)
- `skill_written` (tool_forge::forge_tool success + SKILL.md export)
- `skill_registered` (post-write registration into runtime tool surface)
- `skill_used` (next call invokes the new tool — likely in commands.rs tool-loop branch)

## Integration with Phase 21 `mod skills`

**Decision: SKILL.md export coexists with tool_forge's existing output. No
migration of the `forged_tools` SQLite table; no removal of
`~/.config/blade/tools/<name>.{ext}`.**

After `forge_tool` returns successfully, write a SKILL.md at
`<blade_config_dir>/skills/<name>/SKILL.md` whose:

- Frontmatter contains the canonical SKILL.md fields built from the
  ForgedTool struct (name = ForgedTool.name, description = ForgedTool.description)
- Body has a short "When to use" + "How to invoke" section auto-generated
  from `usage_template`
- Optionally, a `scripts/<name>.{ext}` symlink (or copy) from
  `<blade_config_dir>/tools/<name>.{ext}` so consumers using the SKILL.md
  resolution path can still find the script

The tool_forge runtime continues to be the canonical execution path for
forged scripts (brain.rs:1043 keeps injecting them). The SKILL.md export
is for **ecosystem interop** (clawhub publishing, validator visibility,
agentskills.io compliance) and **discoverability** through the Phase 21
`Catalog::resolve(name)` API.

This is the "coexist" path from 21-RESEARCH §Q5 / §Q7. Phase 23+ may
deprecate the tool_forge SQLite path in favour of SKILL.md as source of
truth — that's a v1.4 plan-time decision.

## Deterministic verify gate (VOYAGER-05)

`forge_tool` requires a real LLM call. CI doesn't have API keys. Solution:

- Add a `tool_forge::forge_tool_deterministic(capability, fixture)` test
  function that bypasses the LLM and uses a hard-coded fixture
  (script_code + description + usage + parameters all pinned). Behind
  `#[cfg(any(test, feature = "voyager-fixture"))]`.
- The verify gate `scripts/verify-voyager-loop.sh` runs a `cargo test
  --lib voyager::end_to_end_youtube_transcript` invocation that exercises
  the deterministic path.

## Skill-write budget cap (VOYAGER-07)

Add a token estimate check inside `generate_tool_script` — if the prompt
+ expected response budget exceeds 50K tokens (configurable via
`BladeConfig.voyager_skill_write_budget_tokens`), return an error before
the LLM call. Prevents runaway forge attempts on pathological inputs.

## Failure recovery (VOYAGER-08)

In `forge_tool` (around line 320-360):

- Track each side effect in a Vec<UndoStep> as it lands
- On any error after the first side effect, walk Undo in reverse
- Log a new `evolution_log_capability_gap(... + "prior_attempt_failed=true")`

Steps to undo:
- Script file at `tools_dir().join("<name>.<ext>")` → `fs::remove_file`
- SKILL.md write at `<blade_config_dir>/skills/<name>/SKILL.md` → `fs::remove_dir_all` of parent
- DB row in `forged_tools` → `DELETE FROM forged_tools WHERE id = ?`

## Canonical fixture (VOYAGER-04)

`youtube_transcript` is the per-`voyager-loop-play.md` reference target.
Approach:

1. Synthesize a turn: `"summarize this YouTube video: <url>"` with no
   pre-existing youtube tool
2. Drive `immune_system` to detect the gap (forced via test seam)
3. Drive `tool_forge::forge_tool_deterministic("fetch youtube transcript", FIXTURE)`
4. Assert: SKILL.md written at `<test_blade_dir>/skills/youtube-transcript/SKILL.md`
5. Assert: DB row exists in `forged_tools`
6. Assert: 4 ActivityStrip entries emitted (`gap_detected`, `skill_written`,
   `skill_registered`, `skill_used`)
7. Re-issue same chat turn via test driver; assert it resolves to the new
   skill (via `get_tool_usage_for_prompt` injection or `Catalog::resolve`)
8. Total runtime <60s (CI budget)

## Two-installs-diverge property test (VOYAGER-09)

Two `tempfile`-isolated test runs each with `BLADE_CONFIG_DIR` set to a
different temp dir; feed each a different gap stream `[A1, A2, A3]` /
`[B1, B2, B3]`; assert the skill manifest set difference is non-empty in
both directions. Confirms the substrate-level claim "two installs diverge
over time."

## What this phase does NOT do

- **No tool_forge SQLite migration** — coexistence in v1.3
- **No autoskills MCP-catalog deprecation** — autoskills::try_acquire
  remains the MCP path; tool_forge::forge_if_needed remains the
  generated-script path; v1.3 doesn't merge them
- **No frontend changes** — Voyager loop is backend; ActivityStrip
  rendering already exists from v1.1
- **No new Tauri commands** — all loop work happens through existing
  command surfaces

---

*Research complete. Phase 22 is ~8 plans. CONTEXT.md next.*
