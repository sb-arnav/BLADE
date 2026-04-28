# BLADE — Claude Code Operating File

## What This Is

BLADE is a JARVIS-level desktop AI agent. Tauri 2 (Rust) + React (TypeScript) + SQLite. 130+ Rust modules, 145 React components, 50+ routes. It sees your screen, hears your voice, remembers everything, controls your desktop, and acts autonomously. Local-first, zero telemetry.

**Looking for a specific doc?** [`DOCS.md`](DOCS.md) is the master index — every operating file, design doc, research note, and phase plan in the repo, mapped with a one-liner.

## Build Commands

```bash
npm run tauri dev          # Dev mode with hot reload (kills port 1420 first if needed)
npm run tauri build        # Production build
cd src-tauri && cargo check  # Rust only (only run when batching complete, not after every edit)
npx tsc --noEmit           # TypeScript only
```

**Don't run cargo check after every small edit** — it takes 1-2 min. Batch edits, check once at the end.

## Critical Architecture Rules

### Rust (src-tauri/src/)

**Module registration (EVERY TIME):**
1. New module → `mod module_name;` in `lib.rs`
2. New command → add to `generate_handler![]` in `lib.rs`
3. New config field → add to ALL 6 places: `DiskConfig` struct, `DiskConfig::default()`, `BladeConfig` struct, `BladeConfig::default()`, `load_config()`, `save_config()`

**Common mistakes that waste hours:**
- `use tauri::Manager;` — MUST import when using `app.state()` or you get cryptic "no method named state" error
- SQL in `execute_batch!` — NO double quotes inside SQL strings (breaks the macro)
- `&[]` for empty slices — use `let no_tools: Vec<ToolDefinition> = vec![];` then `&no_tools` (Rust can't coerce `&[T; 0]` to `&[T]` in all contexts)
- Duplicate `#[tauri::command]` function names across modules — Tauri's macro namespace is FLAT. Rename one of them.
- `whisper-rs` requires LLVM/libclang — it's behind `local-whisper` feature flag. Default build doesn't need it.
- Non-ASCII string slicing — ALWAYS use `crate::safe_slice(text, max_chars)`, never `&text[..n]`

**Patterns:**
```rust
// New command
#[tauri::command]
pub async fn my_command(app: tauri::AppHandle, param: String) -> Result<String, String> {
    Ok(result)
}

// Config field (6-place rule)
#[serde(default = "default_my_field")]
pub my_field: String,
fn default_my_field() -> String { "default".to_string() }

// Background task
static RUNNING: AtomicBool = AtomicBool::new(false);
pub fn start_my_loop(app: AppHandle) {
    if RUNNING.swap(true, Ordering::SeqCst) { return; }
    tauri::async_runtime::spawn(async move { loop { /* work */ tokio::time::sleep(...).await; } });
}

// Cancel pattern
static CANCEL: AtomicBool = AtomicBool::new(false);
// Check between iterations: if CANCEL.load(Ordering::SeqCst) { break; }
```

### Frontend (src/)

```typescript
// New route — 3 places in App.tsx:
type Route = "existing" | "my_new_route";
const MyView = lazy(() => import("./components/MyView").then(m => ({ default: m.MyView })));
// In fullPageRoutes:
"my_new_route": <MyView onBack={() => openRoute("chat")} />,
// In command palette entries:
{ label: "My View", action: () => openRoute("my_new_route"), section: "Features" }

// Tauri event listening (in useEffect with cleanup):
const unlisten = listen("event_name", (e) => { /* handle */ });
return () => { unlisten.then(fn => fn()); };

// Invoke with error handling:
try { const result = await invoke<ResultType>("command_name", { arg1, arg2 }); }
catch (e) { setError(typeof e === "string" ? e : String(e)); }
```

## Module Map (what lives where)

### Core Pipeline
| Module | Purpose |
|--------|---------|
| `commands.rs` | Main chat: `send_message_stream`, tool loop, fast-ack, compression |
| `brain.rs` | System prompt builder — assembles identity, context, tools, personality, memory |
| `providers/mod.rs` | Unified LLM gateway, `provider/model` parsing, fallback chains |
| `config.rs` | BladeConfig, keyring, 6-place config pattern |
| `native_tools.rs` | 37+ built-in tools (bash, files, search, clipboard, browser, system, security, IoT) |
| `router.rs` | Task classification, model routing per provider |
| `mcp.rs` | MCP client, health monitoring, auto-reconnect, tool quality ranking |

### Perception
| Module | Purpose |
|--------|---------|
| `godmode.rs` | 3-tier ambient intelligence (Normal/Intermediate/Extreme) |
| `perception_fusion.rs` | Unified PerceptionState (OCR, context tags, user state, vitals) |
| `screen_timeline.rs` | Total Recall — screenshot every 30s + semantic search |
| `clipboard.rs` | Monitor + classify + auto-action (routes through decision_gate) |
| `audio_timeline.rs` | Always-on audio capture + Whisper + meeting detection |
| `notification_listener.rs` | OS notification monitoring |

### Decision & Autonomy
| Module | Purpose |
|--------|---------|
| `decision_gate.rs` | Act/ask/queue/ignore classifier with learning thresholds |
| `proactive_engine.rs` | 5 signal detectors → routes through decision_gate |
| `ghost_mode.rs` | Invisible meeting overlay with content protection |
| `auto_reply.rs` | Draft replies per recipient in user's style |

### Memory & Learning
| Module | Purpose |
|--------|---------|
| `memory.rs` | Letta-style virtual context blocks + conversation fact extraction |
| `typed_memory.rs` | 7 categories (Fact/Preference/Decision/Skill/Goal/Routine/Relationship) |
| `knowledge_graph.rs` | Entity-relationship graph |
| `embeddings.rs` | BM25 + vector hybrid search + smart_context_recall |
| `persona_engine.rs` | Personality traits + UserModel |
| `personality_mirror.rs` | Chat style extraction + external import |
| `people_graph.rs` | Contact knowledge + reply style suggestions |
| `character.rs` | Feedback learning (thumbs up/down → behavioral traits) |

### Agents
| Module | Purpose |
|--------|---------|
| `swarm.rs` + `swarm_commands.rs` + `swarm_planner.rs` | DAG-based parallel agent orchestration |
| `agents/executor.rs` | Step execution with tool fallback + provider fallback |
| `agents/mod.rs` | 8 agent roles (Researcher/Coder/Analyst/Writer/Reviewer + 3 Security) |
| `background_agent.rs` | Spawn Claude Code / Aider / Goose as workers |

### Desktop Control
| Module | Purpose |
|--------|---------|
| `browser_native.rs` | CDP browser control (Chrome/Edge/Brave) |
| `browser_agent.rs` | Vision-driven browser agent loop |
| `computer_use.rs` | Keyboard/mouse automation |
| `system_control.rs` | Lock, volume, brightness, apps, windows, battery, network |
| `iot_bridge.rs` | Home Assistant + Spotify |
| `overlay_manager.rs` | HUD bar + toast notifications |

### Voice
| Module | Purpose |
|--------|---------|
| `voice_global.rs` | Push-to-talk + conversational voice mode |
| `wake_word.rs` | "Hey BLADE" always-on detection |
| `whisper_local.rs` | Local whisper.cpp (behind `local-whisper` feature flag) |
| `tts.rs` | Text-to-speech with speed control + interruption |

### Background Systems
| Module | Purpose |
|--------|---------|
| `deep_scan.rs` | 12 parallel system scanners (first-run identity) |
| `cron.rs` | Task scheduler (morning briefing, weekly review, inbox check) |
| `pulse.rs` | Morning briefings + daily digest |
| `evolution.rs` | Self-improvement + MCP catalog discovery |
| `health_guardian.rs` | Screen time + break reminders |
| `temporal_intel.rs` | Activity recall, standup, pattern detection |
| `security_monitor.rs` | Network, phishing, breach, sensitive files, code scan, dependency audit |
| `financial_brain.rs` | Spending, CSV import, subscriptions |
| `streak_stats.rs` | Daily streaks + gamification |
| `integration_bridge.rs` | Persistent MCP polling (Gmail/Calendar/Slack/GitHub) |

## Verification Protocol — read this before claiming anything is "done"

**The v1.1 lesson.** v1.1 closed with `27 verify gates green` and `tsc --noEmit clean`, then the operator opened the app and discovered chat doesn't render replies (40 Groq API calls hit, no UI feedback), provider page button is below the viewport with scroll locked, UI overlaps on every route, onboarding is unusable, ⌘K is off-center. **Static gates do not see runtime regressions.** This is now load-bearing rule for every BLADE phase, plan, and milestone going forward.

**Static gates ≠ done.** The 27-gate `verify:all` chain is necessary but not sufficient. tsc clean, cargo check clean, file-counts gating, lints, regex-grep gates — all of them can pass while the running app is shipping rendered nothing. They prove syntax/types/structure. They prove nothing about behavior.

**Required evidence before any "done / shipped / verified / phase complete / milestone closed" claim:**

1. **Dev server running.** `npm run tauri dev` came up cleanly. No Rust compile errors. No runtime panic in the first 10 seconds.
2. **Surface screenshotted.** Affected route(s) captured to `docs/testing ss/<surface>.png` (note literal space) at the project's responsive breakpoints (1280×800 + 1100×700 minimum).
3. **Round-trip exercised.** If the change touches chat: send a message, confirm a reply renders. If it touches a form: submit it. If it touches an event handler: trigger the event and confirm the listener fires. The "happy path" must work end-to-end on the running binary.
4. **Screenshot read back.** Use the `Read` tool on the saved PNG. Cite a one-line observation in the response (e.g. "Dashboard 1280×800: RightNowHero 4 chips visible, no overlap, ActivityStrip mounted at bottom").
5. **Cross-viewport check on UI changes.** If you only checked one width, you only verified one width. Provider page button-below-fold was a 1100×700 bug that 1280×800 testing missed.

**The Stop hook.** `.claude/hooks/uat-evidence-required.sh` is a soft warning that fires when the recent transcript contains "done"-claims paired with no UAT evidence. It does not block — but if you see its `[BLADE UAT REMINDER]` text on stderr, you are about to repeat the v1.1 mistake.

**The slash command.** `/blade-uat` runs the full procedure as a checklist. Use it before any phase verification, milestone close, or PR description that says "ships X". Cheaper than re-opening a closed milestone.

**Research / planning sessions are exempt.** This protocol applies to runtime/UI changes. If you're writing PROJECT.md, REQUIREMENTS.md, ROADMAP.md, or pure spec / planning docs, no UAT is needed — the soft hook will keyword-trigger but the warning is a false positive in that case.

## What NOT to Do

- Don't run `cargo check` after every small edit — batch first
- Don't add Co-Authored-By lines to commits — Arnav is the author
- Don't remove existing features — upgrade in place
- Don't use `&text[..n]` on user content — use `safe_slice`
- Don't add `#[tauri::command]` with a name that exists in another module
- Don't use `grep`/`cat`/`find` in bash — use the Read/Grep/Glob tools
- Don't hardcode model names for OpenRouter — user picks their model
- Don't claim a phase / milestone "done" because static gates passed — see Verification Protocol above

## CI

GitHub Actions: `.github/workflows/build.yml` (smoke) + `release.yml` (full). Three platforms. Watch for:
- Missing Linux system deps (libsecret, libxdo, libspa — all in the apt block now)
- `whisper-rs-sys` needs LLVM — gated behind feature flag, default build skips it
- Version mismatch — `package.json`, `Cargo.toml`, `tauri.conf.json` must match
