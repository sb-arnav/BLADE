# Technology Stack

**Analysis Date:** 2026-04-17

## Languages

**Primary:**
- **Rust** 2021 edition - Backend logic (`src-tauri/src/`), 130+ modules, desktop agent runtime, speech/vision processing, system control, database operations
- **TypeScript** 5.9.3 - Frontend UI (`src/`), 293+ React components, type-safe API bindings to Tauri commands, 145+ components
- **JavaScript** - Build scripting, Vite configuration

**Secondary:**
- **Shell (Bash)** - System integration, command execution, shell tools

## Runtime

**Environment:**
- **Node.js** 20.20.1 - Frontend development and build tooling
- **Tauri 2.10.1** - Desktop application runtime (Rust backend + Webview frontend)
  - Manages windowing, process spawning, OS integrations, IPC between Rust and React
- **Rust 1.70+** (via Cargo) - Backend compilation and execution

**Package Managers:**
- **npm** 10.8.2 - Frontend dependencies
- **Cargo** - Rust dependencies
- **Lockfiles:** `package-lock.json`, `Cargo.lock`

## Frameworks

**Core:**
- **Tauri 2** - Desktop app framework with native Rust backend + Webview frontend
- **React** 19.2.5 - UI framework (function components, hooks, Suspense)
- **Vite** 7.3.2 - Frontend build tool and dev server (port 1420)
- **Tailwind CSS** 4.2.1 - Utility-first styling (`@tailwindcss/postcss` 4.2.1)
- **SQLite** - Embedded database (via `rusqlite` 0.39 with bundled SQLite)

**Frontend Components & Utilities:**
- **React Markdown** 10.1.0 - Render markdown responses (with `remark-gfm` 4.0.1 for GitHub Flavored Markdown)
- **Highlight.js** 11.11.1 - Syntax highlighting for code blocks
- **Marked** 18.0.0 - Markdown parsing
- **Mermaid** 11.14.0 - Diagram rendering (flowcharts, state diagrams, etc.)
- **TanStack React Virtual** 3.13.23 - Virtual scrolling for message lists
- **DOM Purify** 3.4.0 - Sanitize HTML/XSS protection
- **date-fns** 4.1.0 - Date/time utilities
- **zod** 3.25.76 - Schema validation (TypeScript-first)
- **usehooks-ts** 3.1.1 - Custom React hooks library

**Desktop/System Integration:**
- **Tauri Plugins:**
  - `@tauri-apps/plugin-dialog` 2.7.0 - File/folder dialogs
  - `@tauri-apps/plugin-opener` 2.5.3 - Open files/URLs with system apps
  - `@tauri-apps/plugin-process` 2.3.1 - Spawn subprocesses
  - `@tauri-apps/plugin-updater` 2.10.1 - Auto-update mechanism
  - `tauri-plugin-global-shortcut` 2 - Global keyboard shortcuts
  - `tauri-plugin-store` 2 - Persistent key-value store
  - `tauri-plugin-notification` 2 - OS notifications
  - `tauri-plugin-autostart` 2 - Auto-start on login
  - `tauri-plugin-single-instance` 2 - Single instance enforcement
  - `tauri-plugin-window-state` 2 - Window position/size persistence
  - `tauri-plugin-log` 2 - Logging to disk
  - `tauri-plugin-fs` 2 - Filesystem access
  - `tauri-plugin-os` 2 - OS info/system details

**Backend Libraries (Rust):**
- **reqwest** 0.12 - Async HTTP client (with JSON, streaming, multipart support)
- **tokio** 1.x - Async runtime (all features enabled)
- **tokio-tungstenite** 0.24 - WebSocket client (for voice/audio streaming)
- **serde** / **serde_json** - Serialization/deserialization
- **rusqlite** 0.39 - SQLite bindings (bundled SQLite)
- **fastembed** 5 - Local embeddings for semantic search
- **chrono** 0.4 - Date/time handling
- **keyring** 3 - OS keyring access (Windows native, Apple native, Linux DBus)
- **arboard** 3 - Clipboard read/write
- **xcap** 0.9.4 - Screenshot capture (cross-platform)
- **enigo** 0.2 - Keyboard/mouse automation
- **image** 0.25 - Image processing (PNG, JPEG, WebP)
- **base64** 0.22 - Base64 encoding/decoding
- **uuid** 1 - UUID generation (v4)
- **aes-gcm** 0.10 - AES encryption
- **zip** 2 - ZIP file handling
- **csv** 1 - CSV parsing/writing
- **regex** 1 - Regular expressions
- **glob** 0.3 - Glob pattern matching
- **cpal** 0.15 - Cross-platform audio I/O
- **hound** 3.5 - WAV file reading/writing
- **whisper-rs** 0.13 (optional, behind `local-whisper` feature) - Local speech-to-text via whisper.cpp

**Platform-Specific (Rust):**
- **Windows:**
  - `uiautomation` 0.24.4 - UI Automation API (accessibility/automation)
  - `winreg` 0.52 - Windows registry access
- **macOS:**
  - Built-in: `tauri` feature `macos-private-api` for advanced system integration

**Development:**
- **TypeScript** 5.9.3 - Type checking
- **Playwright** 1.58.2 - E2E testing framework
- **Autoprefixer** 10.4.27 - CSS vendor prefixes
- **PostCSS** 8.5.8 - CSS processing
- **@vitejs/plugin-react** 4.7.0 - React Fast Refresh for Vite

## Key Dependencies

**Critical (Cannot Work Without):**
- **Tauri 2.10.1** - Core desktop runtime; handles window management, IPC, system integration
- **React 19.2.5** - UI rendering; all 145+ components depend on this
- **Rust backend** - Core intelligence, all tools, integrations, speech processing
- **SQLite** - Persistent storage for conversations, knowledge, memory, analytics

**Infrastructure:**
- **reqwest** - All external API calls (LLM providers, web services, webhooks)
- **tokio** - Async task execution (background jobs, polling, streaming)
- **keyring** - Secure credential storage for API keys across platforms
- **fastembed** - Semantic search for knowledge recall (10+ vector dimensions)

**Critical Features:**
- **Tailwind CSS 4** - UI styling; tightly integrated with frontend components
- **Mermaid** - Diagram rendering in chat responses
- **date-fns** - Time calculations for reminders, scheduling, temporal intelligence
- **zod** - Runtime validation of configuration and API responses
- **TanStack React Virtual** - Virtualization for message lists (prevents memory bloat)

## Configuration

**Environment:**
- **No .env files present** - Configuration stored in SQLite or OS keyring
- **API keys:** Retrieved from OS keyring (platform-native: Windows Credential Manager, macOS Keychain, Linux Secret Service)
- **Config file:** SQLite database (path: user's local data directory, typically `~/.local/share/blade/` on Linux, `~/Library/Application Support/blade/` on macOS, `C:\Users\[user]\AppData\Local\blade\` on Windows)
- **MCP servers:** Configured in SQLite, stored with command, args, and environment variables

**Build Configuration:**
- **Vite config** - Implicit in Tauri build pipeline; uses `src/` as source, outputs to `dist/`
- **Tauri config:** `src-tauri/tauri.conf.json`
  - App identifier: `site.slayerblade.blade`
  - Window: 480x680 transparent, no decorations, center on screen
  - CSP (Content Security Policy): Allows `*.anthropic.com`, `*.openai.com`, `generativelanguage.googleapis.com`, `*.groq.com`, `api.groq.com`, Vercel CDN, Cloudflare AI Gateway
  - Auto-updater: GitHub releases endpoint
- **Cargo.toml:** `src-tauri/Cargo.toml`
  - Lib crate type: staticlib, cdylib, rlib (for FFI and bundling)
  - Release profile: LTO enabled, single codegen unit, stripped binary (minimal size)
- **tsconfig.json** - React strict mode, ES2020 target, JSX "react-jsx"

## Platform Requirements

**Development:**
- **macOS:** Xcode command line tools, macOS 12.0+ (per tauri.conf.json)
- **Windows:** Visual Studio (or build tools), LLVM/libclang for `whisper-rs` (optional feature)
- **Linux:** Standard build tools (gcc/clang), system dependencies:
  - `libsecret-1-dev` - Keyring support
  - `libxdo-dev` - Keyboard/mouse automation
  - `libspa-0.2-dev` - Audio support
  - Development headers for audio libraries (ALSA, PulseAudio)

**Node & Cargo:**
- **Node.js:** 20.x LTS (tested with 20.20.1)
- **npm:** 10.x
- **Rust:** 1.70+ (Cargo manages via rust-toolchain)

**Production (End Users):**
- **Windows:** Windows 10+, WebView2 runtime (auto-installed via NSIS)
- **macOS:** macOS 12.0+
- **Linux:** Glibc 2.31+, common system libraries (Wayland or X11 display server)

**Special Dependencies:**
- **Whisper (speech-to-text):** Only required if `local-whisper` feature is enabled at build time; else Groq API is used
- **Embeddings:** fastembed bundled; no external model server required
- **Browser Automation:** Requires Chrome/Edge/Brave with CDP enabled (via `browser_agent.rs`)

## External Service Integration Points

**LLM Providers:**
- Anthropic (claude-*), OpenAI (gpt-4*, gpt-3.5-turbo), Google Gemini, Groq, Ollama (local), OpenRouter
- Configuration: Provider + API key stored in keyring, model name in config
- Routing: Per-task routing (code, vision, fast, creative) to different providers

**Speech & Audio:**
- **Groq Audio API:** `https://api.groq.com/openai/v1/audio/transcriptions` (speech-to-text, optional alternative to local Whisper)
- **OpenAI TTS:** `https://api.openai.com/v1/audio/speech` (text-to-speech)

**Web Services:**
- **Tavily:** `https://api.tavily.com/search` (web search)
- **Firecrawl:** `https://api.firecrawl.dev` or self-hosted (web scraping/extraction)
- **GitHub API:** `https://api.github.com` (repo search, workflow runs, Copilot fallback)
- **Deepgram:** Voice/audio processing (optional)
- **HaveIBeenPwned:** `https://api.pwnedpasswords.com` (breach detection)

**Smart Home:**
- **Home Assistant:** REST API via configured base URL (e.g., `http://homeassistant.local:8123`)
- **Spotify Local Control:** Spotify Connect playback control

**Real-World Integrations (via MCP servers):**
- Gmail (email monitoring, send)
- Google Calendar (event fetch)
- Slack (messages, mentions)
- GitHub (issues, PRs, notifications)
- Linear (issue tracking)
- Brave Search API (alternative to Tavily)
- Telegram (messaging webhook)
- Discord (webhook integration)

---

*Stack analysis: 2026-04-17*
