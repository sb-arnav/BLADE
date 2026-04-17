# External Integrations

**Analysis Date:** 2026-04-17

## APIs & External Services

**Language Models (LLM Providers):**
- **Anthropic Claude**
  - What: Core AI backbone, tool-calling, vision, streaming responses
  - SDK: Built-in Rust HTTP client
  - Auth: API key from keyring (env var or OS secure storage)
  - Endpoint: `https://api.anthropic.com` (inferred from CSP)
  - Models: claude-3-5-sonnet, claude-opus (configurable)
  - File: `src-tauri/src/providers/anthropic.rs`

- **OpenAI**
  - What: Fallback LLM, GPT-4, vision models, audio/speech-to-text
  - SDK: Built-in reqwest
  - Auth: API key from keyring
  - Endpoint: `https://api.openai.com/v1` (CSP allows `*.openai.com`)
  - Models: gpt-4, gpt-4-turbo, gpt-3.5-turbo, text-embedding-3-small
  - File: `src-tauri/src/providers/openai.rs`

- **Google Gemini**
  - What: Vision, multimodal, fallback model
  - SDK: Built-in reqwest
  - Auth: API key from keyring
  - Endpoint: `generativelanguage.googleapis.com` (CSP allows)
  - Models: gemini-pro, gemini-1.5-pro
  - File: `src-tauri/src/providers/gemini.rs`

- **Groq**
  - What: Fast LLM inference (task routing for quick replies)
  - SDK: Built-in reqwest
  - Auth: API key from keyring
  - Endpoints: `https://api.groq.com/openai/v1`, `https://*.groq.com` (CSP allows)
  - Models: llama-3.3-70b, mixtral-8x7b
  - File: `src-tauri/src/providers/groq.rs`

- **Ollama (Local)**
  - What: Local LLM inference (optional, for private deployments)
  - Connection: HTTP to local `http://localhost:11434`
  - Models: Customizable via Ollama
  - File: `src-tauri/src/providers/ollama.rs`

- **OpenRouter**
  - What: Unified API for 150+ models (supports meta-routing by price/latency)
  - SDK: Built-in reqwest (compatible with OpenAI API)
  - Auth: API key from keyring
  - Endpoint: LiteLLM-style `openrouter/model-name` parsing
  - File: Provider routing in `src-tauri/src/providers/mod.rs`

**Speech & Audio Services:**
- **Groq Audio (Speech-to-Text)**
  - What: Transcribe user voice input in real-time
  - Endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
  - Auth: Groq API key
  - Format: WAV/MP3 multipart upload
  - Files: `src-tauri/src/voice.rs`, `src-tauri/src/ghost_mode.rs`

- **OpenAI TTS (Text-to-Speech)**
  - What: Voice output for conversational mode
  - Endpoint: `https://api.openai.com/v1/audio/speech`
  - Auth: OpenAI API key
  - Models: tts-1, tts-1-hd
  - File: `src-tauri/src/tts.rs`

- **Whisper Local (Optional)**
  - What: On-device speech recognition (no internet required)
  - Backend: whisper.cpp via Rust bindings
  - Feature flag: `local-whisper` (optional at build time)
  - Models: Downloaded separately (tiny, base, small, medium)
  - File: `src-tauri/src/whisper_local.rs`

- **Deepgram (Optional)**
  - What: Real-time transcription via WebSocket
  - Endpoint: WebSocket connection (auth token in header)
  - File: `src-tauri/src/deepgram.rs`

**Web Search & Scraping:**
- **Tavily Search API**
  - What: Web search with context snippets
  - Endpoint: `https://api.tavily.com/search`
  - Auth: API_KEY from config or keyring
  - Rate limit: Free tier 1000/month
  - File: `src-tauri/src/runtimes.rs`

- **Firecrawl (Web Scraping & Extraction)**
  - What: Crawl websites, extract structured data, convert to markdown
  - Endpoint: `https://api.firecrawl.dev` (hosted) or self-hosted URL
  - Auth: FIRECRAWL_API_KEY from config
  - Alternative: Self-hosted instance via `FIRECRAWL_API_URL`
  - File: `src-tauri/src/runtimes.rs`

- **Brave Search API (Optional)**
  - What: Privacy-focused web search alternative to Tavily
  - Auth: BRAVE_API_KEY from config
  - File: `src-tauri/src/evolution.rs`

**Code & Development APIs:**
- **GitHub API**
  - What: Repo search, action runs, issue/PR tracking, Copilot fallback
  - Endpoint: `https://api.github.com`
  - Auth: Optional personal access token (GITHUB_TOKEN from keyring)
  - Rate limit: 60 req/hr (unauthenticated), 5000 req/hr (authenticated)
  - Files: `src-tauri/src/auto_fix.rs`, `src-tauri/src/hive.rs`, `src-tauri/src/autonomous_research.rs`

- **GitHub Copilot API**
  - What: Alternative LLM endpoint (GitHub Copilot as fallback provider)
  - Endpoint: `https://api.githubcopilot.com`
  - Auth: GitHub token
  - File: `src-tauri/src/providers/mod.rs` (base_url support)

- **Linear API (Optional)**
  - What: Issue tracking integration
  - Auth: LINEAR_API_KEY from config
  - File: `src-tauri/src/autoskills.rs`, `src-tauri/src/evolution.rs`

**Smart Home & IoT:**
- **Home Assistant REST API**
  - What: Control smart lights, switches, sensors; fetch entity state
  - Endpoint: Configured via `ha_base_url` in config (e.g., `http://homeassistant.local:8123`)
  - Auth: Bearer token (HA_TOKEN stored in keyring)
  - Endpoints used:
    - `GET /api/states` - List all entities
    - `GET /api/states/{entity_id}` - Get entity state
    - `POST /api/services/{domain}/{service}` - Control devices
  - File: `src-tauri/src/iot_bridge.rs`

- **Spotify (Local Control)**
  - What: Playback control via local Spotify API
  - Connection: Local network (Spotify Connect)
  - Endpoints: `http://127.0.0.1:{port}` (local player)
    - `/remote/status.json` - Get current playback
    - `/remote/pause.json` - Pause
    - `/remote/next.json` - Next track
  - File: `src-tauri/src/iot_bridge.rs`

**Security & Monitoring:**
- **HaveIBeenPwned (Breach Detection)**
  - What: Check if user email/password appears in known breaches
  - Endpoint: `https://api.pwnedpasswords.com/range/{prefix}`
  - Method: K-anonymity model (sends only hash prefix)
  - File: `src-tauri/src/security_monitor.rs`

**Communication & Webhooks:**
- **Telegram Bot API**
  - What: Send notifications/alerts to Telegram
  - Endpoint: `https://api.telegram.org/bot{TOKEN}/sendMessage`
  - Auth: Bot token
  - File: `src-tauri/src/telegram.rs`

- **Discord Webhooks**
  - What: Post messages/alerts to Discord channels
  - Endpoint: `https://discord.com/api/webhooks/{id}/{token}` or `https://discordapp.com/api/webhooks/`
  - Auth: Webhook token
  - File: Webhook receiver in `src-tauri/src/native_tools.rs`

**Browser Automation:**
- **Chrome DevTools Protocol (CDP)**
  - What: Control Chrome/Edge/Brave programmatically (screenshot, click, type, navigate)
  - Connection: Local WebSocket to CDP port (default 9222)
  - File: `src-tauri/src/browser_agent.rs`, `src-tauri/src/computer_use.rs`

**MCP (Model Context Protocol) Servers:**
MCP servers are discoverable and managed via `src-tauri/src/mcp.rs`. When configured, they extend BLADE's tool ecosystem:

- **Gmail (Official Google MCP Server)**
  - What: Read emails, send messages, search
  - Connection: Stdio or HTTP
  - Auth: OAuth 2.0 (Google account)
  - Config location: `config.mcp_servers` (name: "gmail")

- **Google Calendar (Official Google MCP Server)**
  - What: List events, create/update events, free/busy lookup
  - Connection: Stdio or HTTP
  - Auth: OAuth 2.0
  - Config location: `config.mcp_servers` (name: "calendar")

- **Slack (Official Slack MCP Server)**
  - What: Read/send messages, list channels, get mentions
  - Connection: Stdio or HTTP
  - Auth: Slack Bot token
  - Config location: `config.mcp_servers` (name: "slack")

- **GitHub (GitHub-maintained MCP Server)**
  - What: Search repos, list PRs/issues, get workflow runs
  - Connection: Stdio or HTTP
  - Auth: GitHub token
  - Config location: `config.mcp_servers` (name: "github")

- **Linear (Community MCP Server)**
  - What: Issue tracking, team management
  - Connection: Stdio or HTTP
  - Auth: Linear API key
  - Config location: `config.mcp_servers` (name: "linear")

- **Brave Search (Community MCP Server)**
  - What: Web search integration
  - Auth: Brave API key
  - Config location: `config.mcp_servers` (name: "brave_search")

- **Tavily Research (Community MCP Server)**
  - What: Advanced web research
  - Auth: Tavily API key
  - Config location: `config.mcp_servers` (name: "tavily")

- **Composio (Third-party Tool Ecosystem)**
  - What: 500+ tool integrations (HubSpot, Salesforce, Zapier, etc.)
  - Auth: COMPOSIO_API_KEY from config
  - File: `src-tauri/src/evolution.rs`

- **File System Server (BLADE Built-in)**
  - What: Read/write files from the filesystem, sandboxed
  - File: `src-tauri/src/mcp_fs_server.rs`
  - Local only (no network)

- **Memory Server (BLADE Built-in)**
  - What: Persistent context blocks, semantic recall
  - File: `src-tauri/src/mcp_memory_server.rs`
  - Local only

## Data Storage

**Databases:**
- **SQLite (Local)**
  - Type: Embedded relational database
  - Location: `~/.local/share/blade/blade.db` (Linux), `~/Library/Application Support/blade/blade.db` (macOS), `C:\Users\[user]\AppData\Local\blade\blade.db` (Windows)
  - Client: `rusqlite` 0.39 with bundled SQLite
  - Tables: conversations, messages, knowledge, analytics, brain_memory, brain_preferences, brain_style_tags
  - File: `src-tauri/src/db.rs`, `src-tauri/src/db_commands.rs`

**File Storage:**
- **Local filesystem only** - No cloud storage integration
- Screenshots: `timeline/` subdirectory in app data folder
- Obsidian vault: User-configured path (optional integration)
- Audio recordings: Temp cache during processing, not persisted

**Caching:**
- **In-memory:** Embeddings cache, MCP server health state, integration polling results
- **Disk:** SQLite for persistent caching of knowledge, conversations, timeline metadata
- **No external cache service** (Redis, Memcached, etc.)

## Authentication & Identity

**Auth Provider:**
- **Custom/Multi-Provider** - No single auth provider; BLADE uses per-service API keys
- Implementation approach:
  - **OS Keyring** for sensitive credentials (cross-platform: Windows Credential Manager, macOS Keychain, Linux Secret Service via `keyring` crate v3)
  - **SQLite** for non-sensitive config (provider name, model, task routing)
  - **Env vars** as fallback (for automation/CI scenarios)

**OAuth 2.0 Support (for MCP services):**
- **Google OAuth** - Gmail, Calendar (server-side handling, tokens stored in keyring)
- **Slack OAuth** - Slack integration (server-side handling)
- **GitHub OAuth** - GitHub operations (server-side handling)

**Session Management:**
- **Per-process** - No persistent session tokens; credentials refreshed from keyring on each startup
- **Background polling** can maintain service connections (Gmail, Calendar, Slack) when `integration_polling_enabled` is true

## Monitoring & Observability

**Error Tracking:**
- **None** - No external error tracking service (Sentry, Rollbar, etc.)
- Local logging: `tauri-plugin-log` writes to disk
- Console logging via `log` crate + Tauri plugin

**Logs:**
- **Approach:** Structured logging to `~/.local/share/blade/logs/` (Linux), `~/Library/Application Support/blade/logs/` (macOS)
- **Framework:** `tauri-plugin-log` for persistent logs, `log` crate for in-memory
- **Services logged:** API calls, MCP server health, speech processing, tool execution, decision gate events

**Health Monitoring:**
- **MCP Servers:** Background health check every 30 seconds (auto-reconnect on failure)
- **LLM Providers:** Fallback provider chain on 429/5xx errors
- **Smart Home:** Connection timeout 10 seconds
- File: `src-tauri/src/mcp.rs` (health tracking)

## CI/CD & Deployment

**Hosting:**
- **Desktop Application** (not a web service)
- **Distribution:** GitHub Releases (Windows, macOS, Linux installers)
- **Auto-update:** Tauri updater checking against `https://github.com/sb-arnav/BLADE/releases/latest/download/latest.json`

**CI Pipeline:**
- **GitHub Actions:** `.github/workflows/build.yml` (smoke), `release.yml` (full release)
- **Triggers:** Push to `master`, tag creation
- **Outputs:** Platform-specific installers (.exe, .dmg, .AppImage)
- **Upload:** GitHub Releases
- **Key steps:**
  1. Install dependencies (Node, Rust, platform-specific tools)
  2. Build frontend: `npm run build`
  3. Build desktop app: `npm run tauri build`
  4. Sign binaries (macOS notarization, Windows signing optional)
  5. Create installers (NSIS for Windows, DMG for macOS, AppImage for Linux)

**Platform Build Dependencies:**
- **Windows:** Visual Studio Build Tools, LLVM (for optional whisper-rs)
- **macOS:** Xcode, code-signing certificate
- **Linux:** GCC/Clang, system development packages (libxdo, libsecret, libspa)

## Environment Configuration

**Required env vars:**
- **LLM Providers:**
  - `ANTHROPIC_API_KEY` - Anthropic Claude (primary)
  - `OPENAI_API_KEY` - OpenAI/GPT models (fallback)
  - `GOOGLE_API_KEY` - Google Gemini
  - `GROQ_API_KEY` - Groq fast inference
  - `OLLAMA_BASE_URL` - Local Ollama instance (e.g., `http://localhost:11434`)

- **Web Services:**
  - `TAVILY_API_KEY` - Web search (free tier: 1000/mo)
  - `FIRECRAWL_API_KEY` - Hosted Firecrawl (or `FIRECRAWL_API_URL` for self-hosted)
  - `BRAVE_API_KEY` - Brave Search (optional)
  - `GITHUB_TOKEN` - GitHub API (optional, enables higher rate limit)

- **Smart Home:**
  - `HA_BASE_URL` - Home Assistant URL (configured in app settings)
  - `HA_TOKEN` - Home Assistant token (stored in keyring)

- **MCP Servers:**
  - Per-server: Stored in `config.mcp_servers` with environment variables per server
  - Example: Gmail MCP server gets `GMAIL_TOKEN`, Slack gets `SLACK_BOT_TOKEN`, etc.

- **Audio/Voice:**
  - `GROQ_API_KEY` - Groq audio transcription (alternative to local Whisper)
  - `OPENAI_API_KEY` - OpenAI TTS for voice output

**Secrets location:**
- **Primary:** OS Keyring (platform-native)
  - Windows: Windows Credential Manager
  - macOS: Keychain
  - Linux: Secret Service (D-Bus)
- **Fallback:** Env var (for automation, testing, CLI)
- **NOT stored on disk** in plaintext (no .env file, no hardcoded keys)

## Webhooks & Callbacks

**Incoming:**
- **Discord Webhook:** Accept messages from Discord (optional, via native-tools)
- **Telegram Bot:** Accept messages from Telegram (optional, via telegram.rs)
- **Custom HTTP Endpoints:** Workflow builder can define arbitrary HTTP triggers
- **File:** `src-tauri/src/workflow_builder.rs` (HTTP trigger definitions)

**Outgoing:**
- **Workflow Actions:** Can POST to arbitrary URLs (HTTP action in workflow)
- **Telegram:** Send messages/alerts to Telegram
- **Discord:** Send messages/alerts to Discord
- **Custom APIs:** Workflow engine supports arbitrary POST/PUT/DELETE
- **File:** `src-tauri/src/workflow_builder.rs`, `src-tauri/src/native_tools.rs`

**GitHub Webhooks (Optional):**
- **Setup:** User configures repository webhook pointing to local BLADE instance
- **Events:** Push, PR, issue events trigger automations
- **Handling:** Requires BLADE to expose HTTP server (optional feature)

## MCP Server Management

**Registration:**
- Location: SQLite config + runtime in-memory state
- Each server stores: name, command, args[], environment variables
- File: `src-tauri/src/config.rs` (SavedMcpServerConfig struct)

**Lifecycle:**
- **Launch:** Spawned as subprocess via `tokio::process::Command`
- **Communication:** JSON-RPC 2.0 over stdio (stdin/stdout)
- **Health:** Background monitor checks every 30 seconds, auto-reconnect on failure
- **Tool Discovery:** On connect, request/tools, parse schema, cache in memory
- **Tool Calls:** Invoke via initialize_resource/call_tool RPC methods
- **Shutdown:** Clean termination on app close or manual deregister
- **File:** `src-tauri/src/mcp.rs`

---

*Integration audit: 2026-04-17*
