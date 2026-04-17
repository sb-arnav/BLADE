# Architecture

**Analysis Date:** 2026-04-17

## Pattern Overview

**Overall:** Tauri 2 desktop shell with backend-frontend boundary separation. Rust-based native backend (130+ modules) communicating with React TypeScript frontend (145+ components, 50+ routes) via IPC invoke/emit pattern. Local-first SQLite persistence. Zero telemetry.

**Key Characteristics:**
- Layered separation: Rust backend (system control, LLM orchestration, decision gates) ↔ invoke/event boundary ↔ React frontend (UI, routing, user interaction)
- Streaming command pattern: `send_message_stream` returns async streaming responses via `@tauri-apps/api/core#invoke`
- MCP (Model Context Protocol) client integrated into Rust backend for external tool integration
- Perception fusion: 3-tier ambient intelligence (screen capture, audio, clipboard monitoring) feeds into decision gate
- Memory system: Letta-style virtual context blocks, typed memory (7 categories), embeddings (BM25 + vector hybrid search)
- Agent orchestration: DAG-based swarm planner with parallel execution, 8 agent roles
- Background systems: Cron scheduler, integration bridge for persistent external polling, deep system scanning
- Decision autonomy: Act/ask/queue/ignore classifier based on proactive signals (5 detectors)

## Layers

**Tauri Desktop Shell (`src-tauri/`):**
- Purpose: Native host process for desktop integration, IPC management, window handling
- Location: `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`
- Contains: Window initialization, Tauri configuration
- Depends on: Rust backend modules
- Used by: React frontend via Tauri IPC

**Rust Backend (`src-tauri/src/`):**
- Purpose: Core intelligence, LLM orchestration, native tools, system monitoring, autonomy engine
- Location: 159 Rust files in `src-tauri/src/` totaling ~100K lines
- Contains: Commands, business logic, system integration, decision gates
- Depends on: External LLM providers (OpenAI, Claude, OpenRouter), MCP servers, system APIs
- Used by: React frontend via `invoke` commands, background tasks via internal spawning

**React Frontend (`src/`):**
- Purpose: User-facing UI, routing, real-time display, user input handling
- Location: `src/` directory with 145+ components in `src/components/`, routes in `src/App.tsx`
- Contains: UI components (lazy-loaded), hooks, utilities, type definitions
- Depends on: Tauri core API (`@tauri-apps/api`), Tauri event system
- Used by: Main application window and overlay windows

**Invoke Boundary:**
- Purpose: Type-safe IPC between Rust and React
- Pattern: Async functions decorated with `#[tauri::command]` in Rust, invoked via `invoke<T>("command_name", {args})`
- Error handling: Exceptions propagate as `Result<T, String>`
- Streaming: Special case `send_message_stream` returns streaming text via events (`chat_response_chunk`) rather than single invoke response

**Event System:**
- Purpose: Backend → Frontend real-time updates without request-response
- Pattern: `app.emit("event_name", payload)` in Rust, `listen("event_name", (e) => {})` in React
- Common events: `chat_response_chunk`, `blade_status`, `notification`, `perception_update`, `autonomy_action`

## Data Flow

**Chat Message Flow (Core Pipeline):**

1. User types in `ChatWindow` component
2. `useChat` hook invokes `send_message_stream` command with message + context
3. Rust `commands.rs:send_message_stream` receives message
4. Message routed through `brain.rs` (system prompt assembly)
5. `providers/mod.rs` gateway selects LLM provider based on config + router rules
6. If tools needed: `native_tools.rs` executes 37+ built-in tools (bash, files, search, etc.) or MCP client (`mcp.rs`) for external integrations
7. Tool results fed back into LLM as `ToolResult` messages
8. Final response streamed back via `chat_response_chunk` event
9. Frontend `ChatWindow` accumulates chunks and renders in real-time

**Perception → Decision → Action Flow:**

1. Ambient monitors fire: `screen_timeline.rs` (30s screenshots), `audio_timeline.rs` (continuous capture), `clipboard.rs` (clipboard changes)
2. `perception_fusion.rs` unifies signals into single `PerceptionState`
3. `proactive_engine.rs` detects 5 signals: context change, urgency escalation, user idle, pattern match, deadline
4. Signals routed through `decision_gate.rs` with learned thresholds
5. Decision: Act (execute autonomously) | Ask (interrupt user) | Queue (schedule later) | Ignore
6. If Act: `background_agent.rs` spawns executor, `agents/executor.rs` runs steps with tool fallback + provider fallback
7. Frontend observes via `autonomy_action` event, displays toast or modal based on action type

**Memory Recall Flow:**

1. User message enters `memory.rs` (Letta-style context blocks)
2. `embeddings.rs` converts text to BM25 + vector embeddings
3. `smart_context_recall` retrieves relevant facts/relationships from `knowledge_graph.rs`
4. `typed_memory.rs` categorizes: Fact (static), Preference (learned), Decision (chosen), Skill (capability), Goal (objective), Routine (recurring), Relationship (social)
5. Recalled context injected into brain prompt via `brain.rs`

**Config Persistence:**

1. User changes setting in `Settings` component
2. Invoke `save_config` with updated `BladeConfig` struct
3. Rust `config.rs` serializes to disk, also updates keyring for sensitive fields
4. On app startup: `load_config` reads from disk + keyring, populates state
5. Changes broadcast via `config_updated` event to React state

**State Management:**

- React: Context + hooks (useChat, useActivityFeed, useNotifications, etc.) for local UI state
- Rust: Config in `Arc<Mutex<BladeConfig>>`, transient state via module-level statics (AtomicBool for flags)
- Sync: Commands return state updates; events emit state changes
- No Redux/Zustand pattern; hooks manage component state directly

## Key Abstractions

**Provider Gateway (`providers/mod.rs`):**
- Purpose: Unified interface to multiple LLM providers (OpenAI, Claude, OpenRouter, local models)
- Pattern: `Provider` enum, `ModelConfig` with fallback chains
- Example: `invoke<ChatResponse>("send_message_stream", { messages, provider: "claude", model: "claude-3-opus", ... })`
- Routing: `router.rs` classifies tasks and picks provider per context

**MCP Client (`mcp.rs`):**
- Purpose: Call external tools via Model Context Protocol
- Pattern: `McpManager` maintains connections to MCP servers, `McpTool` definitions parsed, results fed back to LLM
- Health monitoring: Auto-reconnect on failure, tool quality ranking
- Integration bridge: `integration_bridge.rs` polls MCP servers persistently (Gmail, Slack, GitHub, Calendar)

**Tool Loop:**
- Purpose: Execute tools until LLM says "done"
- Pattern: Seen in `commands.rs:send_message_stream` loop: call LLM → if tool use → execute tool → add result → repeat
- Fallback: If tool fails, try next provider's implementation of same tool

**Decision Gate (`decision_gate.rs`):**
- Purpose: Act/ask/queue/ignore classifier with learning thresholds
- Input: Perception state + proactive signals
- Output: `Decision { action: ActNow | AskUser | Queue | Ignore, confidence: f32, reason: String }`
- Learning: Thumbs up/down feedback in `character.rs` adjusts thresholds over time

**Perception Fusion (`perception_fusion.rs`):**
- Purpose: Unify OCR, context tags, user state (idle/active), vitals
- Data: Screen pixels → OCR text, audio → Whisper transcription, clipboard → content classification
- Output: `PerceptionState { context: String, tags: Vec<Tag>, user_state: UserState, ... }`

**Memory System:**
- `memory.rs`: Letta-style virtual context blocks (conversation facts auto-extracted)
- `typed_memory.rs`: 7 categories (Fact, Preference, Decision, Skill, Goal, Routine, Relationship)
- `knowledge_graph.rs`: Entity-relationship graph (people, orgs, projects)
- `embeddings.rs`: BM25 full-text + vector similarity search
- `smart_context_recall`: Fetch relevant facts based on message intent

**Swarm Orchestration (`swarm.rs` + `swarm_planner.rs`):**
- Purpose: DAG-based parallel agent execution
- Pattern: Define task graph with dependencies, `swarm_planner.rs` topologically sorts, `agents/executor.rs` runs steps in parallel
- Agent roles: Researcher, Coder, Analyst, Writer, Reviewer, SecurityAuditor, SecurityPatcher, PrivacyGuard
- Tool fallback: If executor step fails, try next provider's model for that step

**Brain System (`brain.rs`):**
- Purpose: Assemble system prompt dynamically per message
- Components: Identity (name, role), context (recent messages, perception), tools (available tools), personality (learned traits), memory (recalled facts)
- Pattern: ~2K line module building prompt from all subsystems, returns final `String` passed to LLM

## Entry Points

**Tauri Window (`src-tauri/src/main.rs`):**
- Location: `src-tauri/src/main.rs`
- Triggers: App startup via `npm run tauri dev` or binary execution
- Responsibilities: Initialize Tauri app, register command handlers, spawn background tasks (cron, screen capture), attach listeners

**React App Root (`src/App.tsx`):**
- Location: `src/App.tsx` (~2100 lines)
- Triggers: HTML `<div id="root">` mount via `src/main.tsx`
- Responsibilities: Route management, command palette, global event listeners, main UI layout

**Main Chat Command (`commands.rs:send_message_stream`):**
- Location: `src-tauri/src/commands.rs`
- Triggers: `invoke("send_message_stream", { message, context, ... })`
- Responsibilities: Core message processing, tool loop, streaming response, error recovery

**Perception Startup (`godmode.rs`):**
- Location: `src-tauri/src/godmode.rs`
- Triggers: User enables "Ambient Intelligence" in settings
- Responsibilities: Start screen capture loop, audio capture, clipboard monitoring; feed into decision gate

**Background Agent Loop (`background_agent.rs`):**
- Location: `src-tauri/src/background_agent.rs`
- Triggers: Proactive engine detects signal requiring action
- Responsibilities: Spawn executor, run agent steps, report progress via events

**Cron Scheduler (`cron.rs`):**
- Location: `src-tauri/src/cron.rs`
- Triggers: App startup
- Responsibilities: Morning briefing, weekly review, inbox check on schedule

## Error Handling

**Strategy:** Result<T, String> throughout. Graceful fallback at decision points.

**Patterns:**
- Circuit breaker: `commands.rs` tracks error frequency; if same error 3x in 5 min, pause for exponential backoff
- Tool fallback: If tool X fails on provider A, retry on provider B
- Provider fallback: If primary LLM fails, use secondary from config fallback chain
- User notification: Errors emit `blade_error` event, displayed as toast in UI
- Logging: Log to console (dev) + optional file sink (production)

**Example (from `commands.rs`):**
```rust
if is_circuit_broken("provider_api") {
    tokio::time::sleep(Duration::from_secs(backoff_secs(10, "provider_api"))).await;
}
// Retry logic with fallback providers
```

## Cross-Cutting Concerns

**Logging:** 
- Console output in development
- Optional file-based logging in production (configurable)
- Trace module (`trace.rs`) for request/response auditing

**Validation:** 
- Frontend: Form validation in components, TS type checking
- Rust: Config validation on load, message schema validation via `providers.rs`

**Authentication:** 
- API keys: Stored in keyring (platform secret store) via `config.rs`
- No OAuth in current implementation; user configures provider keys directly
- MCP server auth: Per-server credentials in `BladeConfig.mcp_servers`

**Concurrency:**
- Rust: `tokio` async runtime with `Arc<Mutex<T>>` for shared state
- Frontend: Hooks manage local async state, no global async library needed
- IPC is inherently async (Promise-based)

---

*Architecture analysis: 2026-04-17*
