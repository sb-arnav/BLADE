# Phase 46 — Agentic Hunt Onboarding

**Milestone:** v2.0 — Setup-as-Conversation + Forge Demo
**Status:** Pending
**Requirements:** HUNT-01..10
**Goal:** Replace the 4-step wizard with the LLM-driven agentic hunt per `.planning/v2.0-onboarding-spec.md`. First 60 seconds delivers BLADE's wedge: it knows you before you tell it.

## Background

The full spec lives at `.planning/v2.0-onboarding-spec.md`. Read that for the load-bearing language design (Act 1-7, the "feels illegal but legal" register, the synthesis to `~/.blade/who-you-are.md`, etc.). This CONTEXT.md captures the IMPLEMENTATION approach.

Per V2-AUTONOMOUS-HANDOFF.md §0:
> "Agentic hunt onboarding. Acts 1–7 per `.planning/v2.0-onboarding-spec.md` (locked 2026-05-13). Pre-scan → message #1 with key disclose + override + 'feels illegal but legal' register → LLM-driven hunt narrated live in chat → `platform_paths.md` knowledge file for per-OS install conventions → no-data fallback (one sharp question) → contradiction surfacing → synthesis to `~/.blade/who-you-are.md` (user-editable Markdown) → first task closes onboarding by BLADE *acting*. Rips the old Steps flow as part of this work."

## Approach

### Files to RIP (cut wholesale)

Per V2-AUTONOMOUS-HANDOFF.md §0 item 7 — the Steps-flow cut deferred from v1.6 lands here:

- `src/features/onboarding/Steps.tsx`
- `src/features/onboarding/ApiKeyEntry.tsx`
- `src/features/onboarding/DeepScanReview.tsx`
- `src/features/onboarding/PersonaCheck.tsx`
- Any other components exclusively wired into the Steps flow

Routes for Steps removed from `src/windows/main/router.ts` (or wherever onboarding routes live now after Phase 39's deep_scan cut).

### Files to CREATE

**`src-tauri/src/onboarding/hunt.rs`** — The LLM-driven hunt module.

- `start_hunt(app, initial_context: InitialContext) -> Result<(), String>` — kicks off the hunt LLM session.
- The hunt session is a normal `providers::complete_turn` call with:
  - System prompt: the spec language ("you're BLADE, learning who this user is on first launch...")
  - Initial user message: serialized `InitialContext` + path to `platform_paths.md`
  - Tools: a NEW sandboxed set — `hunt_read_file`, `hunt_list_dir`, `hunt_run_shell` (readonly, no-network), `hunt_emit_chat_line`
- Sandbox enforcement: any tool call that tries to write or hit a non-localhost URL is rejected with structured error feedback
- Token cap: 50K input. If exceeded, hunt summarizes early and proceeds to synthesis.
- Recency-weighted reads: files >30 days old → one-line summary tool; files <7 days → full content tool.
- Sensitive-file deny list: `.ssh/`, `.env`, `.aws/credentials`, `.gnupg/`, `keychain`, `Login.keychain`, anything matching `*secret*` or `*password*` patterns.

**`src-tauri/src/onboarding/pre_scan.rs`** — The ≤2s pre-scan.

- `run_pre_scan() -> InitialContext` — runs everything per spec Act 1:
  - Agent presence: `which claude/cursor/ollama/aider/gh` (Tokio process spawn with 200ms timeout each)
  - API keys: env vars + `~/.claude/config` + `~/.cursor/config` + OS keychain entries
  - Local LLM: TCP probe `:11434` for Ollama (50ms timeout)
  - OS + arch: `uname` / `sw_vers` / Windows registry
  - Default browser: macOS `LaunchServices`, Windows registry, Linux `xdg-mime`
  - Mic permission: check only, no recording
- Returns `InitialContext` struct (not persisted).

**`src-tauri/src/onboarding/synthesis.rs`** — Writes `~/.blade/who-you-are.md`.

- `synthesize_to_markdown(hunt_session: &HuntSession) -> String` — converts the hunt's accumulated findings into the user-editable Markdown.
- `write_who_you_are(content: &str) -> Result<(), String>` — atomic write to `~/.blade/who-you-are.md`.

**`src-tauri/src/onboarding/platform_paths.md`** — Knowledge file with per-OS conventions.

Per spec Act 4:
```markdown
## Windows
- Claude Code: %USERPROFILE%\AppData\Local\Programs\Claude\
- WSL detection: `wsl --list --quiet` → for each distro, `wsl which claude`
- WSL Claude conversations: `wsl ls /home/$USER/.claude/projects`
- Cursor: %APPDATA%\Cursor\User\globalStorage\
- Default browser: HKCU\Software\Classes\http\shell\open\command
- Shell history: PowerShell at %APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\

## macOS
- Claude Code: /Applications/Claude.app, ~/.claude/
- Cursor: /Applications/Cursor.app, ~/Library/Application Support/Cursor/
- Default browser: `defaults read com.apple.LaunchServices/com.apple.launchservices.secure`
- Shell history: ~/.zsh_history (default), ~/.bash_history

## Linux
- Claude Code: /usr/local/bin/claude, ~/.local/bin/claude, ~/.claude/
- Cursor: /opt/cursor, ~/.config/Cursor/
- Default browser: `xdg-mime query default x-scheme-handler/http`
- Shell history: ~/.bash_history, ~/.zsh_history, ~/.local/share/fish/
```

Embed via `include_str!` so it ships in the binary.

**`src/features/onboarding/Hunt.tsx`** — Frontend chat surface that consumes the hunt's chat-line emissions.

Each `hunt_emit_chat_line` from Rust emits a Tauri event `blade_hunt_line`. The Hunt.tsx component subscribes and appends to a scrolling chat view. Renders Markdown. Supports the "stop" command (user types "stop" → emits `blade_hunt_stop` → hunt session terminates cleanly mid-probe).

### Message #1 implementation

The four-sentence first bubble per spec Act 2:
```
> Found these on your machine: {agents}, {keys}. {tools_loaded}.
>
> I'll default to {default_provider} for thinking. Override if you want — say
> "use Ollama only" for full-local, "skip" to start talking now and set this up later.
>
> Otherwise, just answer the next message.
```

Implementation: `start_hunt` first emits a single `blade_hunt_line` with this content, then waits for user input. If "skip" → captures core command from first task; if a provider name → re-routes; otherwise proceeds with default.

### OAuth flows (HUNT-10)

Build but mock-test only per V2-AUTONOMOUS-HANDOFF.md §1:
- `src-tauri/src/oauth/slack.rs` — Slack OAuth URL builder + token exchange + refresh
- `src-tauri/src/oauth/gmail.rs` — Google OAuth (Gmail scope)
- `src-tauri/src/oauth/github.rs` — GitHub OAuth
- Each module exposes `build_auth_url(state: &str) -> String`, `exchange_code_for_token(code: &str) -> Result<Token>`
- Integration tests in `src-tauri/tests/oauth_integration.rs` against `mockito` or `wiremock` localhost OAuth servers — verify URL shape, token parsing, refresh flow
- No real-account auth happens at build time

### Behavioral rules

- Hunt MUST narrate every probe in chat. No silent reads of user filesystem.
- User can interrupt at any line with "stop" or just close the app.
- If hunt runs longer than 60s total elapsed, prompt user: "Still going — want me to wrap up with what I have?"
- All tool calls log to BLADE's normal activity log (existing infrastructure from v1.1).

## Risks

1. **Hunt LLM token cost** per V2-AUTONOMOUS-HANDOFF.md §0 falsification: routine cost >$3 per onboarding means the selectivity prompt is wrong. Track cost in chat live; if any test run exceeds $1.50, tighten the prompt.
2. **Hunt finds nothing on fresh machine** — no-data fallback (HUNT-05). One sharp question, answer drives subsequent probes (e.g., user says "I run a B2B SaaS called Clarify" → BLADE does `git remote -v` on `~/code/clarify*` patterns, GitHub handle search, etc.).
3. **Hunt narration verbose** — operator UAT may flag as "slows me down." Per spec falsification: "if Arnav/Abhinav flag the live narration as 'verbose / slows me down' rather than 'wow,' narration is wrong (mechanism stays, density tuned)." Default to terse narration with progressive detail on demand.
4. **OAuth mock-test flakiness** — localhost mock servers can leak between tests if not torn down. Use `serial_test` crate or per-test ports.
5. **Steps.tsx removal breaks routes** — other parts of the app may navigate to the Steps routes via `openRoute('onboarding-step-*')`. Grep for those call sites before deletion; route the orphans to the chat or remove them.

## Success criteria

Per ROADMAP.md milestone-level success criteria 1-9:
- Pre-scan completes < 2s
- Message #1 lands within 1s of chat paint
- Hunt LLM session runs with live narration
- `platform_paths.md` ships in the binary
- Hunt synthesizes `~/.blade/who-you-are.md`
- No-data fallback works on fresh machine
- Contradiction surfacing fires on conflicting signals
- Onboarding closes with BLADE acting on a real task
- Steps.tsx + ApiKeyEntry + DeepScanReview + PersonaCheck removed
- OAuth flows build + pass mock-server integration tests
