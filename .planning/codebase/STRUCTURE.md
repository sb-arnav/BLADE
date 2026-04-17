# Codebase Structure

**Analysis Date:** 2026-04-17

## Directory Layout

```
/home/arnav/blade/
├── src-tauri/                  # Rust backend (Tauri host + business logic)
│   ├── Cargo.toml              # Rust dependencies, version control
│   ├── src/
│   │   ├── main.rs             # Tauri app initialization
│   │   ├── lib.rs              # Module registration (159 mod declarations)
│   │   ├── agents/             # Agent execution (executor, planner, queue, thought_tree)
│   │   ├── commands.rs         # Main chat pipeline, streaming, error recovery
│   │   ├── brain.rs            # System prompt assembly
│   │   ├── providers/          # LLM gateway (OpenAI, Claude, OpenRouter)
│   │   ├── config.rs           # BladeConfig struct, keyring integration
│   │   ├── native_tools.rs     # 37+ built-in tools (bash, files, search, browser, etc.)
│   │   ├── mcp.rs              # MCP client, server management
│   │   ├── memory.rs           # Letta-style context blocks
│   │   ├── embeddings.rs       # BM25 + vector search
│   │   ├── knowledge_graph.rs  # Entity-relationship graph
│   │   ├── perception_fusion.rs # Unified perception state
│   │   ├── screen_timeline.rs  # Screenshot capture + timeline
│   │   ├── audio_timeline.rs   # Audio capture + Whisper
│   │   ├── clipboard.rs        # Clipboard monitoring
│   │   ├── decision_gate.rs    # Autonomy classifier
│   │   ├── proactive_engine.rs # Signal detectors
│   │   ├── godmode.rs          # 3-tier ambient intelligence
│   │   ├── swarm.rs            # Agent orchestration DAG
│   │   ├── background_agent.rs # Background executor
│   │   ├── cron.rs             # Task scheduler
│   │   ├── router.rs           # Task classification
│   │   ├── db.rs               # SQLite schema + queries
│   │   ├── history.rs          # Conversation persistence
│   │   └── [130+ other modules] # Voice, browser, system control, learning, etc.
│   └── tauri.conf.json         # Tauri config (window, build, security)
│
├── src/                        # React TypeScript frontend
│   ├── main.tsx                # Entry point, React mount
│   ├── App.tsx                 # Main routing, command palette, event listeners (~2100 lines)
│   ├── components/             # 145+ React components (lazy-loaded via App.tsx)
│   │   ├── ChatWindow.tsx      # Main chat interface
│   │   ├── ActivityFeed.tsx    # Conversation history + summaries
│   │   ├── Settings.tsx        # Configuration UI
│   │   ├── Terminal.tsx        # Terminal emulator
│   │   ├── FileBrowser.tsx     # File explorer
│   │   ├── Canvas.tsx          # Visual thinking board
│   │   ├── Dashboard.tsx       # Home dashboard
│   │   ├── SwarmView.tsx       # Agent orchestration view
│   │   ├── ScreenTimeline.tsx  # Screenshot timeline + search
│   │   ├── [130+ more components] # Feature-specific UIs
│   │   └── index.ts            # Component exports (barrel file pattern not used; lazy loading in App.tsx)
│   ├── hooks/                  # Custom React hooks
│   │   ├── useChat.ts          # Message send, streaming response handling
│   │   ├── useActivityFeed.ts  # Activity management
│   │   ├── useKeyboard.ts      # Global keyboard shortcuts
│   │   ├── useVoiceCommands.ts # Voice input processing
│   │   ├── useContextAwareness.ts # Perception state integration
│   │   └── [10+ other hooks]   # Feature-specific hooks
│   ├── types/                  # TypeScript type definitions
│   │   ├── index.ts            # Core types (Message, BladeConfig, PerceptionState)
│   │   └── api.ts              # API request/response types
│   ├── lib/                    # Utility libraries
│   │   ├── api.ts              # Invoke wrapper with error handling
│   │   ├── events.ts           # Event listener registry
│   │   └── [other utilities]
│   ├── utils/                  # Pure utility functions
│   │   ├── formatters.ts       # Time, text, data formatting
│   │   ├── exportConversation.ts # Chat export
│   │   └── [validation, parsing] # Data helpers
│   ├── styles/                 # CSS variables, Tailwind customization
│   │   └── *.css               # Global styles, component styles
│   ├── assets/                 # Images, icons, static files
│   ├── data/                   # Static data (prompts, templates, examples)
│   ├── App.css                 # App-level styles
│   └── index.css               # Tailwind + custom base styles
│
├── docs/                       # Documentation
│   ├── architecture/           # Architecture analysis documents
│   │   ├── 2026-04-16-blade-body-architecture-design.md  # Rust backend module map
│   │   ├── 2026-04-17-blade-frontend-architecture.md     # React component structure
│   │   ├── connection-map.md   # Invoke/event boundary mapping
│   │   └── body-mapping.md     # Module to feature mapping
│   ├── design/                 # Design system, prototypes
│   ├── research/               # Research docs, technical exploration
│   └── apple-research/         # Apple integration research
│
├── .planning/                  # GSD planning directory
│   └── codebase/               # Codebase maps (this file + ARCHITECTURE.md)
│
├── .github/                    # CI/CD workflows
│   └── workflows/
│       ├── build.yml           # Smoke tests (Linux, macOS, Windows)
│       └── release.yml         # Full build (3 platforms)
│
├── scripts/                    # Build/utility scripts
│
├── package.json                # Node dependencies, npm scripts
├── tsconfig.json               # TypeScript configuration
├── vite.config.ts              # Vite build configuration
├── Cargo.toml                  # Workspace root (src-tauri)
├── Cargo.lock                  # Rust dependency lock
├── CLAUDE.md                   # Project operating file (rules, patterns, conventions)
├── BLADE_CONTEXT.md            # Feature overview + quick reference
├── README.md                   # Public documentation
└── [config files]              # .gitignore, .vscode/, etc.
```

## Directory Purposes

**`src-tauri/src/`:**
- Purpose: Rust backend business logic, system integration, AI orchestration
- Contains: 159 .rs files (~100K lines of Rust)
- Key pattern: Each module (e.g., `memory.rs`, `brain.rs`) exports public functions, registered in `lib.rs`
- Module organization: Grouped by function (core pipeline, perception, decision, memory, agents, desktop control, voice, background)

**`src/components/`:**
- Purpose: React UI components
- Contains: 145+ .tsx files, each a functional component or composition
- Naming: PascalCase (e.g., `ChatWindow.tsx`, `ScreenTimeline.tsx`)
- Pattern: Lazy-loaded in `App.tsx` via `lazy(() => import(...).then(...))`
- No barrel file; components imported directly in App.tsx for code splitting

**`src/hooks/`:**
- Purpose: Custom React hooks for shared stateful logic
- Contains: useChat, useActivityFeed, useNotifications, useVoiceCommands, etc.
- Pattern: Each hook manages one concern (chat, activity, voice, etc.)
- Invokes: Rust backend commands via `invoke()` from `@tauri-apps/api/core`

**`src/types/`:**
- Purpose: Shared TypeScript type definitions
- Key files: `types.ts` (main types), `api.ts` (request/response schemas)
- Synced: Frontend types mirror Rust `BladeConfig`, `ConversationMessage`, `PerceptionState` via serde

**`src/lib/`:**
- Purpose: Utility libraries for common patterns
- Examples: `api.ts` wraps `invoke()` with error handling, `events.ts` registry for listening to Tauri events

**`src/utils/`:**
- Purpose: Pure utility functions (no state)
- Examples: `formatters.ts` (time, text), `exportConversation.ts` (chat export)

**`src/styles/`:**
- Purpose: CSS and Tailwind configuration
- Pattern: Tailwind v4, custom CSS variables for theme (colors, spacing)
- Global styles in `index.css`, component styles in `App.css`

**`src/assets/`:**
- Purpose: Static images, icons, SVGs
- Never changes at runtime

**`src/data/`:**
- Purpose: Hardcoded data (prompts, templates, examples, configuration defaults)
- Pattern: JSON or TypeScript data exports

**`docs/architecture/`:**
- Purpose: Architecture documentation, analysis of live codebase
- Key files: 
  - `2026-04-16-blade-body-architecture-design.md` — Rust module breakdown by function
  - `2026-04-17-blade-frontend-architecture.md` — React routing, component hierarchy
  - `connection-map.md` — Invoke commands + event flows
  - `body-mapping.md` — Module-to-feature cross-reference

**`.planning/codebase/`:**
- Purpose: GSD mapping documents (ARCHITECTURE.md, STRUCTURE.md, others)
- Generated: By gsd-codebase-mapper agent
- Not committed: Can be regenerated from live code

## Key File Locations

**Entry Points:**
- `src-tauri/src/main.rs`: Tauri app initialization, handler registration
- `src/main.tsx`: React mount point, calls `<App />`
- `src/App.tsx`: Route management, command palette, global listeners

**Configuration:**
- `src-tauri/src/config.rs`: BladeConfig struct, load/save, keyring integration
- `src/types.ts`: Frontend type definitions
- `.env` (not in git): API keys, provider configuration
- `tauri.conf.json`: Tauri window, security, build config

**Core Logic:**
- `src-tauri/src/commands.rs`: Main `send_message_stream` command, tool loop, streaming
- `src-tauri/src/brain.rs`: System prompt assembly
- `src-tauri/src/providers/mod.rs`: LLM provider gateway
- `src-tauri/src/native_tools.rs`: 37+ built-in tools

**Perception & Decision:**
- `src-tauri/src/godmode.rs`: Ambient intelligence (screen, audio, clipboard)
- `src-tauri/src/decision_gate.rs`: Autonomy classifier
- `src-tauri/src/proactive_engine.rs`: Signal detection
- `src-tauri/src/perception_fusion.rs`: Unified perception state

**Memory:**
- `src-tauri/src/memory.rs`: Letta-style context blocks
- `src-tauri/src/typed_memory.rs`: 7-category memory system
- `src-tauri/src/knowledge_graph.rs`: Entity graph
- `src-tauri/src/embeddings.rs`: BM25 + vector search

**Agents & Orchestration:**
- `src-tauri/src/swarm.rs`: DAG agent orchestration
- `src-tauri/src/agents/executor.rs`: Step execution
- `src-tauri/src/background_agent.rs`: Background task spawning
- `src-tauri/src/agents/mod.rs`: 8 agent roles

**Frontend Routing:**
- `src/App.tsx`: Route type definition (50+ routes), lazy-loaded components
- Routes include: chat, settings, discovery, terminal, files, canvas, workflows, agents, analytics, etc.

**Testing:**
- No dedicated test directory; tests are inline (Rust) or via GitHub Actions
- GitHub Actions: `.github/workflows/build.yml` (smoke), `release.yml` (full build)

## Naming Conventions

**Rust Files:**
- Module files: `snake_case.rs` (e.g., `commands.rs`, `brain.rs`, `native_tools.rs`)
- Public functions: `snake_case` (e.g., `send_message_stream`, `load_config`)
- Tauri commands: `snake_case` with `#[tauri::command]` decorator
- Structs: `PascalCase` (e.g., `BladeConfig`, `PerceptionState`, `ToolDefinition`)
- Enums: `PascalCase` (e.g., `Decision`, `UserState`, `MemoryType`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `CHAT_CANCEL`, `ERROR_HISTORY`)

**TypeScript/React:**
- Component files: `PascalCase.tsx` (e.g., `ChatWindow.tsx`, `Settings.tsx`)
- Hook files: `usePascalCase.ts` (e.g., `useChat.ts`, `useVoiceCommands.ts`)
- Utility functions: `camelCase` (e.g., `formatTime()`, `exportConversation()`)
- Types: `PascalCase` (e.g., `BladeConfig`, `Message`)
- Enum variants: `PascalCase` (e.g., `ActNow`, `AskUser`, `Queue`)
- Constants: `UPPER_SNAKE_CASE` or `camelCase` depending on scope

**Directories:**
- Rust modules: `snake_case` folder containing multiple .rs files or single .rs file
- React folders: `PascalCase` (e.g., `components/`, but not enforced)
- Utility folders: `lowercase` (e.g., `utils/`, `hooks/`, `lib/`, `styles/`)

## Where to Add New Code

**New Feature (full stack):**
1. **Rust backend:** Create new module in `src-tauri/src/` (e.g., `my_feature.rs`)
   - Add `mod my_feature;` to `src-tauri/src/lib.rs` (alphabetically sorted)
   - Define public functions, optional `#[tauri::command]` for exposed commands
   - If command: Add to `generate_handler![]` in `lib.rs`
2. **Frontend:** Create new component in `src/components/MyFeature.tsx`
   - Add route in `src/App.tsx` type union (e.g., `type Route = "..." | "my_feature"`)
   - Add lazy import: `const MyFeature = lazy(() => import("./components/MyFeature").then(m => ({ default: m.MyFeature })))`
   - Add case in `fullPageRoutes` object: `"my_feature": <MyFeature onBack={...} />`
   - Add command palette entry (optional)
3. **Hook:** Create in `src/hooks/useMyFeature.ts` if shared state needed
4. **Types:** Add to `src/types.ts` if new data structure

**New Tool (in native_tools.rs):**
1. Add function in `src-tauri/src/native_tools.rs` (e.g., `async fn my_tool(...)`)
2. Register in `native_tools::tools()` function
3. Handled automatically by tool loop in `commands.rs`

**New Config Field:**
- **6-place rule:** Add to ALL 6 locations:
  1. `DiskConfig` struct
  2. `DiskConfig::default()`
  3. `BladeConfig` struct
  4. `BladeConfig::default()`
  5. `load_config()` function
  6. `save_config()` function
- File: `src-tauri/src/config.rs`

**New Route:**
1. Add to `Route` type union in `src/App.tsx`
2. Add lazy import and component binding
3. Add command palette entry (optional)

**Utilities:**
- Global helpers: `src/utils/`
- Component-specific hooks: `src/hooks/`
- Shared types: `src/types.ts`

## Special Directories

**`src-tauri/src/agents/`:**
- Purpose: Agent execution subsystem
- Generated: No
- Committed: Yes
- Files: `executor.rs` (step runner), `planner.rs` (DAG), `mod.rs` (agent roles), `queue.rs`, `thought_tree.rs`

**`src-tauri/src/providers/`:**
- Purpose: LLM provider implementations
- Generated: No
- Committed: Yes
- Pattern: Each provider (OpenAI, Claude, OpenRouter) has module; gateway in `mod.rs` routes calls

**`docs/architecture/`:**
- Purpose: Living documentation of codebase design
- Generated: By developers during major refactors or analysis
- Committed: Yes
- Key docs linked in commit messages for context

**`.planning/codebase/`:**
- Purpose: GSD planning artifacts
- Generated: By gsd-codebase-mapper on demand
- Committed: Typically not (git-ignored in most projects, but check `.gitignore`)
- Consumed by: gsd-plan-phase, gsd-execute-phase for code generation context

**`dist/` and `target/`:**
- Purpose: Build outputs
- Generated: Yes (during `npm run build`, `cargo build`)
- Committed: No (in .gitignore)

**`node_modules/` and `src-tauri/target/`:**
- Purpose: Dependency trees
- Generated: Yes (by package managers)
- Committed: No (in .gitignore)

---

*Structure analysis: 2026-04-17*
