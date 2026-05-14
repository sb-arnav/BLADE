# Phase 56 — SUMMARY (Hunt TELOS)

**Status:** Complete
**Closed:** 2026-05-14

## Outcome

Hunt onboarding now captures the user's optimization target (Mission / Goals / Beliefs / Challenges) — Daniel Miessler's PAI "telos" block — into a YAML frontmatter on `~/.blade/who-you-are.md`. The brain reads it on every chat turn and surfaces mission + goals to the LLM unconditionally, so BLADE has something to optimize against, not just context to recall. Closes VISION.md §42 ("setup-as-conversation primitive") and lands the last substantive v2.2 phase before launch prep.

## REQ-list check

| REQ | SHA | Status |
|---|---|---|
| TELOS-PROMPT | `96111dc` | Done |
| TELOS-SYNTH | `2d444f8` | Done |
| TELOS-INGEST | `a91377d` | Done |
| TELOS-EDIT-FLOW | `4313629` | Done |
| TELOS-TESTS | `fc2a1a8` | Done |

## Static gates

| Gate | Result |
|---|---|
| `cargo check` | Clean (verified post-REQ-3 build; final post-REQ-5 build clean) |
| `tsc --noEmit` | Clean |
| `cargo test --test telos_integration` | 5/5 pass (0.05s) |

## Test coverage (over-delivered)

REQ asked for 4 integration tests; agent shipped 5 — the 4 REQ scenarios + 1 empty-telos sentinel (`telos_empty_renders_empty`) defending against the brain pushing a section composed of headings with no content when no hunt has run yet.

## Files touched

- `src-tauri/src/onboarding/hunt.rs` (+31) — prompt extension instructing the LLM to capture Mission/Goals/Beliefs/Challenges opportunistically and emit a fenced ```telos``` YAML block at the close of the synthesis turn.
- `src-tauri/src/onboarding/synthesis.rs` (+259 / -6) — `Telos` struct (serde Deserialize/Serialize, all-optional fields), `parse_telos_from_synthesis` (fence extraction), `parse_telos_from_frontmatter` (idempotent re-read), `strip_telos_fence` + `strip_frontmatter` (renderer hygiene), `render_telos_frontmatter` (YAML emit), `read_who_you_are` + `who_you_are_path` helpers, new idempotent `synthesize_to_markdown_with_existing` entry point that preserves user body edits + merges telos fields via `Telos::merge_preserve_self` (existing user values win, new hunt fills gaps), `write_who_you_are_at` for tempdir-redirectable test writes.
- `src-tauri/src/brain.rs` (+107) — `telos_section()` reads ~/.blade/who-you-are.md frontmatter; `render_telos_section()` formats Mission/Goals/Beliefs/Challenges as a labeled prompt block. Wired into `build_system_prompt_inner` at priority 0.5 (right after identity supplement, ahead of memory + character bible) so it lands ON EVERY TURN with no selective-injection gate.
- `src-tauri/src/commands.rs` (+96) — `blade_open_who_you_are` Tauri command (xdg-open / open / start by OS) with first-run stub-file creation, plus a `/edit-self` slash-command intercept in `send_message_stream_inline` that fires before any LLM call and routes to the command via the chat-streaming contract (blade_message_start → chat_token → chat_done early-return).
- `src-tauri/src/lib.rs` (+2) — `commands::blade_open_who_you_are` registered in `generate_handler![]`.
- `src-tauri/tests/telos_integration.rs` (new, 363 lines) — 5 integration tests + HomeGuard helper for $HOME-redirected sandbox.

## Frontmatter contract

```yaml
---
telos:
  mission: "..."
  goals:
    - "..."
  beliefs:
    - "..."
  challenges:
    - "..."
---
```

Fields are all-optional (serde `#[serde(default)]` + `skip_serializing_if`). Missing-field hunts produce frontmatter with only the captured keys — no `goals: []` placeholders that would suggest the user has zero goals when the hunt simply didn't capture any.

## Idempotency contract

`synthesize_to_markdown_with_existing(findings, Some(existing))`:

1. **Telos merge** — `Telos::merge_preserve_self`: existing values WIN. The new hunt fills gaps only. User edits to `mission` / a specific goal / a specific belief survive re-runs of the hunt.
2. **Body preservation** — when an existing markdown body is present (anything after the frontmatter), it is preserved verbatim. The synthesis acts as a frontmatter refresher after the first run, not a wholesale rewrite. This protects custom user-added sections ("## My Custom Section", "## Notes I added") from being clobbered.

Test `telos_c_user_edits_round_trip_preserved` pins both contracts.

## Brain prompt injection point

Telos sits at priority 0.5 — right after `build_identity_supplement` and BEFORE `memory_l0` / character bible / role / safety / hormones / identity_extension. This is intentional:

- Telos IS the optimization target. The LLM needs it as early as identity itself.
- Bypasses the Phase 32 selective-injection gates — it's universally relevant (every turn should ground in the user's mission).
- ~200 chars when populated; cheap. Cannot blow the 1500-token budget on its own.
- Empty rendering when no telos is set OR no who-you-are.md exists — defensive against fresh installs.

The `record_section("telos", ...)` call surfaces telos token contribution in the DoctorPane budget panel (Phase 32 / CTX-06 wire format).

## Slash command surface (`/edit-self`)

First slash command in the BLADE chat router. Pattern is reusable for future shortcuts:

```rust
if trimmed.eq_ignore_ascii_case("/edit-self") {
    let confirmation = match blade_open_who_you_are() { ... };
    emit_stream_event(&app, "blade_message_start", ...);
    emit_stream_event(&app, "chat_token", ...);
    emit_stream_event(&app, "chat_done", ());
    return Ok(());
}
```

Fires BEFORE the proposal-reply intent router and BEFORE the LLM provider call. Early-return discipline prevents `/edit-self` from leaking into the model's conversation history.

## Deviations from REQ list

1. **5 tests instead of 4.** Added `telos_empty_renders_empty` to pin the empty-state contract — `render_telos_section(&Telos::default()) == ""` so the brain never injects a section of headings with no content.
2. **`render_telos_section` is a public sibling of `telos_section`.** REQ said "add a `telos_section()` helper". The split is intentional: `telos_section()` reads from disk + parses + renders (the live brain call site); `render_telos_section(&Telos)` is the pure renderer the tests drive without filesystem coupling. Same pattern as Phase 53 `build_presence_state_block` / Phase 57 `match_trigger`.
3. **`who_you_are_path` exposed publicly.** REQ implied the path is internal; making it pub lets `blade_open_who_you_are` resolve the file path AND the integration tests assert the file location, without duplicating the `dirs::home_dir().join(".blade").join(WHO_YOU_ARE_FILENAME)` logic.
4. **First-run stub on `/edit-self`.** REQ said open the file in the user's default editor. If the file doesn't exist (no hunt has run yet), we create a stub with empty telos frontmatter first. Without this, `xdg-open` on Linux fails silently when the path doesn't exist, leaving the user staring at chat with no visible side-effect.
5. **No SUMMARY-write step deferred.** SUMMARY written immediately after REQ-5 commit (no crash risk played out).

## What this milestone is NOT

- Not a re-run of the hunt UI. The chat-line phrasing in `compose_message_one` and Hunt.tsx is unchanged — telos is captured in the existing hunt flow, not via four new explicit questions.
- Not a frontend UI for editing telos. `/edit-self` opens the markdown in the user's editor; a dedicated TelosPane in React is deferred to v2.3 if the markdown round-trip proves friction-heavy in real use.
- Not changing the synthesis chat-line ("Right? — Give me one thing you've been putting off this week."). The closing first-task prompt fires unchanged after the markdown write.
- Not a generic skill-trigger system. `/edit-self` is the only slash command today; the trigger pattern is reusable but not generalized.

## PAI / VISION attribution

- Daniel Miessler's [PAI](https://github.com/danielmiessler/PAI) — `telos.md` block concept (Mission / Goals / Beliefs / Challenges as the universal personal-AI optimization target).
- VISION.md §42 — "setup-as-conversation primitive" closure: hunt now writes an optimization target, not just a context dump.
