# Blade — Complete Technical Context Document

> Give this file to any AI so it understands the entire Blade codebase, architecture, vision, and how to work on it.

---

## What Is Blade?

Blade is a **personal AI desktop app** built with Tauri 2 (Rust backend + React/TypeScript frontend). It's not a ChatGPT wrapper — it's a full AI operating system that runs natively on your desktop, knows who you are, sees what you see, hears what you say, and actually does things.

**Key differentiators from every other AI app:**
1. **MCP protocol** — connects to 7,600+ MCP servers (Slack, GitHub, databases, etc.)
2. **Compounding personalization** — SOUL.md, Knowledge Graph, auto-learn, feedback loop
3. **Native desktop** — system tray, Alt+Space hotkey, screen capture, clipboard monitoring
4. **Multi-model smart routing** — auto-selects the right model per task
5. **Voice in + voice out** — mic input via Whisper, TTS via Web Speech API
6. **Screen awareness** — screenshot → vision model analysis
7. **Claude Managed Agents** — first desktop client for Anthropic's Agent SDK

---

## Tech Stack

| Layer | Tech | Details |
|-------|------|---------|
| Frontend | React 19 + TypeScript | 75k+ lines, 83 components, 90 hooks |
| Backend | Rust + Tauri 2 | 8k lines, 40 modules |
| Styling | Tailwind CSS | Custom `blade-*` color tokens |
| State | React hooks + localStorage | Migrating to SQLite (db.rs ready) |
| AI Providers | 5 providers | Anthropic, OpenAI, Groq, Gemini, Ollama |
| MCP | Custom client | mcp.rs with tool discovery, permission system |
| Database | SQLite (rusqlite) | db.rs with FTS5 full-text search |
| Security | OS Keychain | API keys in Windows Credential Manager |
| Build | Vite + Cargo | Hot reload dev, NSIS installer for production |

---

## Repository Structure

```
blade/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   # Main app — 14 routes, 32 command palette entries
│   ├── main.tsx                  # Entry point with React.StrictMode
│   ├── index.css                 # Global styles, markdown, code highlighting
│   ├── types.ts                  # Core TypeScript interfaces
│   ├── components/               # 83 React components
│   │   ├── ChatWindow.tsx        # Main chat UI with sidebar, clipboard bar
│   │   ├── MessageList.tsx       # Message rendering with React.memo
│   │   ├── InputBar.tsx          # Input with voice, screenshot, slash commands, paste
│   │   ├── CommandPalette.tsx    # Ctrl+K command palette
│   │   ├── Settings.tsx          # Tabbed settings (Provider/Memory/MCP/About)
│   │   ├── Onboarding.tsx        # Provider selection + API key setup
│   │   ├── ManagedAgentPanel.tsx # Claude Agent SDK UI — 12 one-click recipes
│   │   ├── AgentTimeline.tsx     # Real-time agent execution visualization
│   │   ├── AgentVerification.tsx # Validates agent claims (PASS/FAIL/UNKNOWN)
│   │   ├── AgentTeamPanel.tsx    # Multi-agent orchestrator (5 team templates)
│   │   ├── Canvas.tsx            # Infinite whiteboard with AI nodes
│   │   ├── Terminal.tsx          # Built-in terminal emulator
│   │   ├── FileBrowser.tsx       # File explorer with syntax preview
│   │   ├── KanbanBoard.tsx       # AI-powered task planner
│   │   ├── WritingStudio.tsx     # Long-form writing with AI assist
│   │   ├── CodebaseExplorer.tsx  # Graphify-inspired code knowledge graph
│   │   ├── EmailAssistant.tsx    # Email reader with AI drafting
│   │   ├── DocumentGenerator.tsx # 8 document templates
│   │   ├── GitPanel.tsx          # Full git UI (status, diff, commit, branches)
│   │   ├── Analytics.tsx         # Usage analytics dashboard
│   │   ├── KnowledgeBase.tsx     # Searchable personal wiki
│   │   ├── ModelComparison.tsx   # Compare AI models side-by-side
│   │   ├── WorkflowBuilder.tsx   # Visual workflow/agent builder
│   │   ├── TemplateManager.tsx   # 12 built-in prompt templates
│   │   ├── ThemePicker.tsx       # 8 color themes
│   │   ├── FocusMode.tsx         # Distraction-free chat
│   │   ├── MindMapView.tsx       # SVG mind maps with AI expansion
│   │   ├── TranslationHub.tsx    # 30-language translation
│   │   ├── NotesPanel.tsx        # Wiki-linked notes with [[backlinks]]
│   │   ├── FlashcardStudy.tsx    # SM-2 spaced repetition
│   │   ├── DailyLogPanel.tsx     # Mood/habit/gratitude tracker
│   │   ├── BookmarkManager.tsx   # URL bookmarks with AI summaries
│   │   ├── RSSReader.tsx         # 10-feed news aggregator
│   │   ├── PresentationBuilder.tsx # 9 slide types, AI deck generation
│   │   ├── FormBuilder.tsx       # 12 field types, AI form generation
│   │   ├── DatabaseExplorer.tsx  # SQL query interface for Blade's SQLite
│   │   ├── DebatePanel.tsx       # 8 analysis frameworks (SWOT, Six Hats, etc.)
│   │   ├── FinanceDashboard.tsx  # Budget, invoices, transaction tracking
│   │   ├── MeetingAssistant.tsx  # Meeting notes, action items, AI summary
│   │   ├── TimeTracker.tsx       # Pomodoro + project time tracking
│   │   ├── GoalDashboard.tsx     # Goal tracking with AI coaching
│   │   ├── SnippetManager.tsx    # Code snippet library
│   │   ├── PromptLibrary.tsx     # 20 built-in prompts with history
│   │   ├── WebAutomation.tsx     # Web scraping and automation recipes
│   │   ├── LearningHub.tsx       # 8 learning paths with exercises
│   │   ├── IntegrationHub.tsx    # 12 service integrations
│   │   ├── NotificationCenter.tsx # Notification management panel
│   │   ├── ActivityFeed.tsx      # Activity timeline
│   │   ├── SpaceSwitcher.tsx     # Discord-style chat spaces
│   │   ├── UnifiedSearch.tsx     # Raycast-style universal search
│   │   ├── ShortcutHelp.tsx      # Keyboard shortcut cheatsheet
│   │   ├── ToolApprovalDialog.tsx # MCP tool approval flow
│   │   ├── TitleBar.tsx          # Custom window title bar
│   │   └── ... (40+ more)
│   ├── hooks/                    # 90 React hooks
│   │   ├── useChat.ts            # Core chat with streaming, persistence
│   │   ├── useManagedAgents.ts   # Claude Agent SDK integration
│   │   ├── useAgentTeam.ts       # Multi-agent orchestration
│   │   ├── useTTS.ts             # Text-to-speech (Web Speech API)
│   │   ├── useKeyboard.ts        # Global keyboard shortcuts
│   │   ├── useFileDrop.ts        # Drag-and-drop file handling
│   │   ├── useMemory.ts          # Mem0-inspired persistent memory
│   │   ├── useKnowledgeGraph.ts  # Entity-relationship knowledge graph
│   │   ├── useAIPersonality.ts   # SOUL.md living personality document
│   │   ├── useFeedbackLoop.ts    # Learn from 👍👎 reactions
│   │   ├── useSelfEvolution.ts   # Auto-generate skills from patterns
│   │   ├── useTokenBudget.ts     # Context window management
│   │   ├── useAIRouter.ts        # Smart model selection
│   │   ├── useCostTracker.ts     # Per-model cost tracking with budgets
│   │   ├── useCodebaseGraph.ts   # Graphify-inspired code analysis
│   │   ├── useSkillModes.ts      # 16 AI personality modes
│   │   ├── useProactiveMode.ts   # Time-based proactive suggestions
│   │   ├── useVoiceCommands.ts   # Wake word + command detection
│   │   ├── useContextAwareness.ts # Active window detection
│   │   ├── useAutoActions.ts     # IFTTT-style automation triggers
│   │   └── ... (70+ more)
│   ├── lib/                      # Core libraries
│   │   ├── markdown.ts           # Markdown rendering + analysis (marked + DOMPurify)
│   │   ├── validation.ts         # Zod schemas for all data types
│   │   ├── dateUtils.ts          # Date formatting + ranges (date-fns)
│   │   ├── ai.ts                 # Token estimation, prompt building, model registry
│   │   └── storage.ts            # localStorage wrapper with migration support
│   ├── data/                     # SQLite data layer
│   │   ├── database.ts           # Central re-export
│   │   ├── conversations.ts      # ConversationDB CRUD
│   │   ├── knowledge.ts          # KnowledgeDB CRUD
│   │   ├── analytics.ts          # AnalyticsDB tracking
│   │   ├── templates.ts          # TemplateDB CRUD
│   │   └── settings.ts           # SettingsDB key-value
│   └── utils/                    # Utility functions
│       ├── clipboardDetect.ts    # Smart clipboard type detection
│       ├── exportConversation.ts # Markdown conversation export
│       └── shareSnippet.ts       # Code snippet formatting
├── src-tauri/                    # Backend (Rust)
│   ├── Cargo.toml                # Dependencies (17 crates + 12 Tauri plugins)
│   ├── tauri.conf.json           # App config, CSP, bundle settings
│   ├── capabilities/default.json # Tauri permission scoping
│   └── src/
│       ├── lib.rs                # App setup — plugins, state, commands, tray, hotkey
│       ├── commands.rs           # 30+ Tauri commands (chat, config, MCP, history, etc.)
│       ├── db.rs                 # SQLite with FTS5 (982 lines)
│       ├── db_commands.rs        # 30 Tauri command wrappers for db.rs
│       ├── config.rs             # Config with OS keychain for API keys
│       ├── crypto.rs             # AES-256-GCM encryption at rest
│       ├── providers/            # 5 AI provider adapters
│       │   ├── mod.rs            # Shared types, conversation builder
│       │   ├── anthropic.rs      # Claude API (streaming + tools)
│       │   ├── openai.rs         # OpenAI API
│       │   ├── groq.rs           # Groq API (with vision model routing)
│       │   ├── gemini.rs         # Gemini API
│       │   └── ollama.rs         # Local Ollama
│       ├── agents/               # Agent runtime
│       │   ├── mod.rs            # Agent types and state machine
│       │   ├── planner.rs        # Goal → step planning
│       │   ├── executor.rs       # Step execution with tools
│       │   └── queue.rs          # Background task queue
│       ├── mcp.rs                # MCP protocol client
│       ├── brain.rs              # System prompt construction
│       ├── router.rs             # Smart model routing per task type
│       ├── permissions.rs        # Tool risk classification (Auto/Ask/Blocked)
│       ├── discovery.rs          # PC scanner + Claude memory import
│       ├── history.rs            # Conversation persistence (JSON files)
│       ├── memory.rs             # Auto-learn from conversations
│       ├── character.rs          # Character Bible (living personality doc)
│       ├── voice.rs              # Mic recording + Whisper transcription
│       ├── voice_local.rs        # Local Whisper (whisper-rs)
│       ├── screen.rs             # Screenshot capture (xcap)
│       ├── clipboard.rs          # Clipboard monitoring
│       ├── context.rs            # Active window detection
│       ├── automation.rs         # Keyboard/mouse simulation (enigo)
│       ├── files.rs              # File operations
│       ├── embeddings.rs         # Local embedding generation
│       ├── rag.rs                # RAG pipeline (ingest + query)
│       ├── trace.rs              # Provider call logging
│       ├── tray.rs               # System tray management
│       └── plugins/              # Plugin system
│           ├── mod.rs
│           ├── loader.rs
│           └── registry.rs
├── tailwind.config.js            # Blade color tokens, custom animations
├── vite.config.ts                # Multi-entry (main + quickask + overlay)
├── package.json                  # npm deps (React, Tauri, highlight.js, marked, zod, date-fns, mermaid)
└── BRIDGE.md                     # Ownership split between Claude (backend) and Artemis (frontend)
```

---

## Architecture Principles

### Frontend
- **React hooks** for all state management (no Redux/Zustand)
- **localStorage** for persistence (migrating to SQLite via `src/data/*.ts`)
- **Tailwind CSS** with custom `blade-*` tokens (bg, surface, border, accent, text, muted)
- **React.memo** on heavy components (MessageBubble, CodeBlock)
- **Debounced persistence** (500ms) to avoid hammering backend
- **Type-safe** — `npx tsc --noEmit` must pass (strict mode)

### Backend (Rust)
- **Tauri 2** with 12 plugins (sql, store, notification, autostart, window-state, process, dialog, fs, os, log, global-shortcut, single-instance)
- **SQLite** via rusqlite with FTS5 for full-text search
- **OS Keychain** for API key storage (never in files)
- **Streaming** via Tauri events (`chat_token`, `chat_done`)
- **MCP** — JSON-RPC over stdio to MCP servers
- **Provider adapters** — each provider has `stream_text()` + `complete_turn()` (for tools)

### Design System
- **Dark-first** — `#09090b` background, accent `#6366f1` (indigo)
- **8 themes** — Midnight (default), Abyss, Emerald, Rosewood, Sandstorm, Nebula, Monochrome, Nord
- **Typography** — Inter for UI, JetBrains Mono for code
- **Animations** — fadeIn, slideIn, pulse-slow (all purposeful, no bounce)
- **text-2xs** = 0.65rem for compact secondary info

---

## Key Data Flows

### Chat Flow
```
User types → InputBar → useChat.sendMessage() → invoke("send_message_stream")
  → Rust commands.rs → providers::stream_text() → HTTP to AI API
  → SSE parse → app.emit("chat_token") → useChat listener → setMessages()
  → MessageList re-renders → auto-scroll → chat_done → persist to history
```

### MCP Tool Flow
```
AI response has tool_calls → commands.rs tool loop →
  permissions.rs classifies risk (Auto/Ask/Blocked) →
  Ask? → emit("tool_approval_needed") → UI shows ToolApprovalDialog →
  User approves → mcp.rs calls tool → result back to AI → next turn
```

### Memory/Learning Flow
```
Conversation ends → memory.rs extracts facts →
  useMemory.addFromConversation() → stores in localStorage →
  useFeedbackLoop records 👍👎 → derives patterns →
  useSelfEvolution discovers repeated actions → creates skills →
  useAIPersonality (SOUL.md) ingests identity/preferences →
  Next conversation: assembleSystemPrompt() injects all context
```

---

## How to Run

```bash
# Development (hot reload)
npm run tauri dev

# Production build
npm run tauri build

# TypeScript check
npx tsc --noEmit

# Rust check
cd src-tauri && cargo check
```

### Prerequisites
- Node.js 20+
- Rust stable
- npm
- Windows: Visual Studio Build Tools, WebView2

---

## File Ownership (BRIDGE.md)

**DO NOT modify without checking BRIDGE.md:**
- `src-tauri/src/providers/*.rs` — provider adapters
- `src-tauri/src/commands.rs` — Tauri command layer
- `src-tauri/src/config.rs` — config + keychain
- `src-tauri/src/mcp.rs` — MCP protocol
- `src-tauri/src/permissions.rs` — tool risk classification
- `src-tauri/src/brain.rs` — system prompt
- `src-tauri/src/discovery.rs` — PC scanner
- `src-tauri/Cargo.toml` — Rust dependencies

**Freely modifiable:**
- `src/components/*.tsx` — all UI components
- `src/hooks/*.ts` — React hooks
- `src/lib/*.ts` — utility libraries
- `src/types.ts` — TypeScript types
- `src/index.css` — styles
- `tailwind.config.js` — theme

---

## Current State (as of April 2026)

- **83,800+ lines** across **243 files**
- **83 components**, **90 hooks**, **15 lib files**, **6 data files**
- **14 routes** in App.tsx, **32 command palette entries**
- **5 AI providers** with streaming
- **12 Tauri plugins** installed and wired
- **SQLite database** ready (db.rs + db_commands.rs + data layer)
- **Claude Managed Agents** integration (first desktop client)
- TypeScript compiles clean, Rust compiles clean

### What Works End-to-End
- Onboarding → chat → voice → screenshot flow
- MCP tool calling with approval
- Conversation history + persistence
- Smart model routing
- Clipboard monitoring + smart detection
- Drag & drop files, Ctrl+V paste images
- TTS voice output
- Focus mode, keyboard shortcuts (12+), slash commands (7)

### What Needs Wiring
- Many components exist but aren't routed in App.tsx yet (need routes + palette entries)
- `src/data/*.ts` layer exists but hooks still use localStorage directly
- Some Rust commands registered but not called from frontend (~30 unused)
- Streaming should migrate from events to Tauri Channels (more efficient)

### Known Issues
- Some agent-delivered components have unused variable warnings (strict TS)
- localStorage will hit 5-10MB limit eventually — SQLite migration needed
- Window state can save off-screen positions on minimize (validation added but edge cases remain)

---

## Vision & Roadmap

**Phase 1 (DONE):** Core chat, voice, vision, MCP, polish
**Phase 2 (IN PROGRESS):** Managed Agents, proactive mode, plugin system
**Phase 3:** Character Bible, compounding personalization, monetization
**Phase 4:** Full PC control, background agents, cross-device sync

**The moat:** OpenAI/Google build for 1 billion users. Blade is built for ONE person and gets more valuable every day it runs. The data stays local. The personalization compounds.
