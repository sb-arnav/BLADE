# BLADE — Claude Code Operating File

## What This Is

BLADE is a local-first personal AI desktop agent built with Tauri 2 (Rust) + React (TypeScript) + SQLite. It runs entirely on your machine — zero telemetry, zero cloud dependency. Think: an operating intelligence wired into your files, terminal, screen, and apps.

## Build Commands

```bash
# Frontend dev (hot reload)
cd /home/arnav/blade && npm run dev

# Full Tauri build (compiles Rust + bundles frontend)
npm run tauri build

# Rust check only (fast — use this before committing)
cd src-tauri && cargo check

# TypeScript check
npx tsc --noEmit
```

## Project Structure

```
blade/
├── src/                          # React frontend (TypeScript)
│   ├── App.tsx                   # Root: routing, global event listeners, command palette
│   ├── components/               # UI components (one file per feature)
│   │   ├── ChatWindow.tsx        # Main chat + streaming UI
│   │   ├── InputBar.tsx          # Input with stop button, voice, screenshot
│   │   ├── TitleBar.tsx          # Title bar + Role switcher
│   │   ├── Dashboard.tsx         # Mission control (pixel art aesthetic)
│   │   ├── SoulView.tsx          # BLADE's self-knowledge + user profile
│   │   └── ...                   # 30+ other panels
│   └── hooks/                    # useChat, useVoiceMode, etc.
│
└── src-tauri/src/                # Rust backend
    ├── lib.rs                    # Module registry + Tauri setup + command registration
    ├── commands.rs               # Main chat pipeline: send_message_stream, cancel_chat
    ├── brain.rs                  # System prompt builder (multi-source context assembly)
    ├── config.rs                 # BladeConfig: load/save, keyring for API keys
    ├── roles.rs                  # BLADE Roles: Engineering/Research/Marketing/etc
    ├── autoskills.rs             # Auto-install MCP servers when tool calls fail
    ├── git_style.rs              # Mine git history to learn coding style
    ├── evolution.rs              # Self-improvement loop + MCP catalog (20 entries)
    ├── soul_commands.rs          # SOUL: character bible, weekly snapshots, diffs
    ├── wake_word.rs              # "Hey BLADE" always-on detection (cpal + Whisper)
    ├── screen_timeline.rs        # Total Recall: screenshot every 30s + semantic search
    ├── swarm.rs / swarm_commands # Parallel multi-agent DAG orchestration
    ├── background_agent.rs       # Claude Code / Aider / Goose as background workers
    ├── providers/                # Anthropic, OpenAI, Gemini, Groq, Ollama
    ├── embeddings.rs             # SQLite-vec hybrid BM25+vector search
    ├── db.rs                     # All SQLite schema + migrations
    ├── native_tools.rs           # Bash, file ops, web fetch — always available
    └── ...                       # 40+ other modules
```

## Key Architectural Rules

### Rust Backend
- **Every new Tauri command** must be registered in `lib.rs` → `invoke_handler` → `generate_handler![]`
- **Every new module** must be declared in `lib.rs` as `mod module_name;`
- **Config changes**: add to `DiskConfig` struct, `BladeConfig` struct, both `Default` impls, `load_config()`, `save_config()`. All four places or it silently drops.
- **SQL in execute_batch!**: do NOT use double quotes inside SQL strings — they break the macro. Use single quotes or plain text in comments.
- **Cross-module function reuse**: use `pub(crate)` visibility. Example: `pub(crate) fn encode_wav` in voice.rs used by wake_word.rs.
- **Cancel pattern**: `static SOME_ACTIVE: AtomicBool` — see `wake_word.rs` and `commands.rs::CHAT_CANCEL` for the pattern.
- **tauri::Manager**: always `use tauri::Manager;` when calling `app.state()` — without it you get a confusing "no method named 'state'" error.

### Frontend
- **New routes**: add to the `Route` type union in `App.tsx`, add lazy import, add entry in `fullPageRoutes`.
- **Lazy imports**: `const Foo = lazy(() => import("./components/Foo").then((m) => ({ default: m.Foo })));`
- **Tauri events**: listen in `App.tsx` useEffect, add to cleanup return. Pattern: `listen("event_name", handler).then(fn => fn())` in cleanup.
- **Notifications**: `notifications.add({ type, title, message })` — `useNotifications()` hook from `NotificationCenter.tsx`.

## Active Features (don't break these)

| Feature | Key Files | Status |
|---------|-----------|--------|
| Chat + streaming | commands.rs, ChatWindow.tsx | ✅ |
| Stop button | commands.rs:CHAT_CANCEL, InputBar.tsx | ✅ |
| Self-healing errors | commands.rs:classify_api_error | ✅ |
| Smart context compression | commands.rs:compress_conversation_smart | ✅ |
| BLADE Roles | roles.rs, TitleBar.tsx | ✅ |
| Autoskills | autoskills.rs | ✅ |
| God Mode | godmode.rs | ✅ |
| Wake Word | wake_word.rs | ✅ |
| SOUL | soul_commands.rs, SoulView.tsx | ✅ |
| Total Recall | screen_timeline.rs, screen_timeline_commands.rs | ✅ |
| BLADE Swarm | swarm.rs, swarm_commands.rs, SwarmView.tsx | ✅ |
| Background agents | background_agent.rs | ✅ |
| GitStyle | git_style.rs | ✅ |
| Evolution engine | evolution.rs | ✅ |
| Pulse / briefings | pulse.rs | ✅ |
| Dashboard | Dashboard.tsx (pixel art aesthetic) | ✅ |

## CI

GitHub Actions runs on every push to master. Three platforms: macOS, Windows, Linux. Build must pass all three. Watch for:
- SQL strings with double quotes (breaks execute_batch!)
- Missing `use tauri::Manager;` on app.state() calls
- Unregistered commands (Rust compiles but frontend invoke fails at runtime)

## Patterns to Follow

```rust
// New command pattern
#[tauri::command]
pub async fn my_command(app: tauri::AppHandle, param: String) -> Result<String, String> {
    // ...
    Ok(result)
}
// Then register in lib.rs: my_module::my_command,

// Config field pattern (add to DiskConfig, BladeConfig, both Defaults, load, save)
#[serde(default = "default_my_field")]
pub my_field: String,
fn default_my_field() -> String { "default_value".to_string() }
```

```typescript
// New route pattern in App.tsx
type Route = "existing" | "my_new_route"; // add here
const MyView = lazy(() => import("./components/MyView").then(m => ({ default: m.MyView })));
// In fullPageRoutes:
"my_new_route": <MyView onBack={() => openRoute("chat")} />,
```

## What NOT to Do

- Don't add features Arnav didn't ask for (but DO build features that are clearly implied)
- Don't remove existing features — reorganize hierarchy instead
- Don't use `grep`/`cat`/`find` in bash — use the Read/Grep/Glob tools
- Don't commit unless explicitly asked
- Don't push unless explicitly asked
- Don't use `--no-verify` or skip hooks
