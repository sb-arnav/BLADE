<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="BLADE" />

# BLADE

**The AI that watches, learns, and works — while others just talk.**

Not a chat window. An operating intelligence wired into your screen, files, apps, and memory. Runs 5 agents in parallel. Remembers everything you've looked at. Sees your screen. Controls your desktop. Fully local.

[![Release](https://img.shields.io/github/v/release/sb-arnav/BLADE?style=flat-square&label=latest&color=0f0f0f)](https://github.com/sb-arnav/BLADE/releases/latest)
[![License](https://img.shields.io/github/license/sb-arnav/BLADE?style=flat-square&color=0f0f0f)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0f0f0f?style=flat-square)](https://github.com/sb-arnav/BLADE/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-0f0f0f?style=flat-square)](https://tauri.app)
[![Rust](https://img.shields.io/badge/backend-Rust-0f0f0f?style=flat-square)](https://www.rust-lang.org)

[**Download**](https://slayerblade.site/blade) · [Releases](https://github.com/sb-arnav/BLADE/releases) · [Report a bug](https://github.com/sb-arnav/BLADE/issues)

</div>

---

## Why BLADE exists

Every AI tool on the market runs one agent at a time, forgets everything between sessions, and has no idea what's on your screen. BLADE is what happens when you refuse to accept that.

- **Hermes Agent** — lives in your Telegram DMs. No screen awareness, no native desktop, no computer use.
- **OpenClaw** — a WhatsApp chatbot with 355K stars and 9 CVEs. No screen control, flat Markdown memory.
- **Screenpipe** — great screen recorder, that's it. No agents, no chat, no tools.
- **Jan / LM Studio** — polished model launchers. No agents, no memory, no automation.
- **Open Interpreter** — runs code in a terminal. Blind to your screen, no parallelism.

**BLADE does all of it. Natively. In one app.**

---

## What makes it different

| Capability | BLADE | Hermes Agent | OpenClaw | Screenpipe | Jan | Open Interpreter | Claude Code |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Native desktop app (not daemon/CLI) | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | CLI |
| Parallel multi-agent swarms (5 agents at once) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Screen timeline / Total Recall | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Computer use (click, type, OCR, UI control) | ✓ | ✗ | ✗ | ✗ | ✗ | partial | ✗ |
| God Mode (live screen + clipboard context) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Persistent vector memory (BM25 + vector, RRF) | ✓ | partial | ✗ | FTS5 | ✗ | ✗ | ✗ |
| Auto-evolving MCP tool catalog | ✓ | partial | ✗ | ✗ | ✗ | ✗ | ✓ |
| Background agent spawning (Claude Code, Aider, Goose) | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Global voice input | ✓ | partial | ✗ | ✗ | ✗ | ✗ | ✗ |
| Built with Tauri (not Electron) | ✓ | N/A | ✗ | ✓ | ✗ | N/A | N/A |
| Any LLM provider + local (Ollama) | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✗ |
| Zero telemetry, fully local | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ | ✗ |
| Free and open source | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |

---

## Core Features

### BLADE Swarm — Parallel Multi-Agent Orchestration
Give BLADE a complex goal. It decomposes it into a dependency graph of subtasks and runs up to 5 specialized agents simultaneously — routing each step to the best model for the job (coding tasks to a code-capable model, fast lookups to a cheap one). Agents share a scratchpad — findings from one feed directly into the next. If a step fails, BLADE reflects on what went wrong and retries with that insight. When all tasks complete, a final synthesis pass combines the results into a single coherent answer.

No other desktop AI runs more than one agent at a time. BLADE runs a fleet.

### Total Recall — Screen Timeline with Semantic Search
BLADE captures a screenshot every 30 seconds, fingerprints it (identical frames are skipped), runs a vision model description on it, and embeds everything for semantic search.

*"What error was I debugging Tuesday?"* — finds the exact screenshot in seconds.

This is Rewind.ai, open-source, built into BLADE. Rewind charges $30/month. BLADE is free.

### God Mode — Live Screen Context
Runs in the background, capturing your active window title, clipboard contents, and running apps every N minutes. Every AI call gets this context injected automatically. The model knows what you're working on without being told.

### Computer Use — Desktop Agent
BLADE can see your screen and control it. Click buttons, fill forms, read UI elements with OCR, navigate apps, take screenshots and reason about them. 40+ desktop action types.

### Memory That Compounds
BLADE maintains three living memory blocks: what it knows about you (your role, habits, preferences), its own persona, and a rolling conversation summary. Each block auto-compresses via LLM when full — there's no context limit that wipes your history. Every conversation, command, and tool result is also embedded locally and indexed with hybrid BM25 + vector search. The second week is smarter than the first. The second month is a different class of tool entirely.

### Background Agents
Spawn Claude Code, Aider, or Goose as background workers with one command. BLADE stays the orchestrator — one surface, multiple specialists.

### Auto-Evolving MCP Catalog
BLADE ships with 20+ MCP servers pre-catalogued and auto-installs them as you use new apps — Git, Chrome, Linear, Figma, Slack, databases, terminals. The toolkit grows without you touching a config file.

### Global Voice Input
`Ctrl+Shift+V` from anywhere — record, transcribe via Whisper, auto-fill QuickAsk. No window switching.

### BLADE Cron
Schedule recurring autonomous tasks: *"every Monday at 9am, summarize my GitHub notifications and brief me on what matters."* Runs while you sleep.

### Evolution Engine
Background research loop that monitors AI news, suggests new MCP tools to install, and runs a morning briefing pulse. BLADE is always improving itself.

### Pentest Mode
Security testing with mandatory ownership verification. Uses Groq or Ollama — never your Anthropic key. Kali tools, nmap, sqlmap, metasploit — all gated behind an explicit authorization record.

---

## Install

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [`.dmg` ↗](https://github.com/sb-arnav/BLADE/releases/latest/download/Blade_0.5.1_aarch64.dmg) |
| **macOS** (Intel) | [`.dmg` ↗](https://github.com/sb-arnav/BLADE/releases/latest/download/Blade_0.5.1_x64.dmg) |
| **Windows** | [`.exe` ↗](https://github.com/sb-arnav/BLADE/releases/latest/download/Blade_0.5.1_x64-setup.exe) |
| **Linux** | [`.AppImage` ↗](https://github.com/sb-arnav/BLADE/releases/latest/download/Blade_0.5.1_amd64.AppImage) |

> **macOS note:** If you see "Blade is damaged and can't be opened", run:
> ```bash
> xattr -cr /Applications/Blade.app
> ```
> This clears the quarantine flag. BLADE isn't notarized yet.

Installed builds auto-update from GitHub Releases.

---

## Quick Start

1. Download and launch BLADE
2. The setup wizard guides you through provider + API key
3. **`Ctrl+Space`** — QuickAsk from anywhere on your desktop
4. **`Ctrl+Shift+B`** — Global voice input
5. Enable **God Mode** in settings for live screen context
6. Enable **Total Recall** in settings to start building your screen timeline

**Slash commands** — type `/` in chat: `/clear` `/new` `/screenshot` `/voice` `/focus` `/swarm` `/init` `/help`

---

## Build From Source

Requires Node 20.19+ and Rust stable.

```bash
git clone https://github.com/sb-arnav/BLADE.git && cd BLADE
npm install
npm run tauri dev      # dev mode with hot-reload
npm run tauri build    # release binary
```

**Ubuntu/Debian system deps:**
```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev \
  libayatana-appindicator3-dev librsvg2-dev \
  libssl-dev libasound2-dev libpipewire-0.3-dev pkg-config
```

---

## Architecture

```
BLADE/
├── src/                         # React + Vite frontend
│   ├── components/
│   │   ├── SwarmView.tsx        # DAG visualization for parallel agents
│   │   ├── ScreenTimeline.tsx   # Total Recall thumbnail grid + search
│   │   ├── GodMode.tsx          # Screen context UI
│   │   └── ...                  # Chat, Settings, QuickAsk, Agents
│   └── hooks/
│       ├── useSwarm.ts          # Swarm state + real-time events
│       ├── useScreenTimeline.ts # Timeline browse + semantic search
│       └── ...
└── src-tauri/src/               # Rust backend
    ├── swarm.rs                 # SwarmTask DAG — parallel multi-agent orchestration
    ├── swarm_commands.rs        # Coordinator loop — dependency resolution + agent spawning
    ├── swarm_planner.rs         # LLM goal decomposition + DAG synthesis
    ├── screen_timeline.rs       # Screenshot capture, fingerprint dedup, vision description
    ├── screen_timeline_commands.rs  # Timeline search, browse, config
    ├── godmode.rs               # Live screen + clipboard context injection
    ├── brain.rs                 # System prompt builder + model-adaptive prompting
    ├── commands.rs              # Message loop + tool execution
    ├── db.rs                    # SQLite (memory, swarms, timeline, embeddings)
    ├── embeddings.rs            # Local semantic search (fastembed AllMiniLML6V2, BM25+vector RRF)
    ├── native_tools.rs          # 20+ built-in tools (bash, file, web, UI automation)
    ├── mcp.rs                   # MCP client + auto-evolving tool catalog
    ├── evolution.rs             # Background research loop + MCP catalog (20+ servers)
    ├── computer_use.rs          # Vision loop — click, type, OCR, screenshot
    ├── runtimes.rs              # Multi-runtime OperatorCenter (Claude, Goose, Aider)
    ├── background_agent.rs      # Background agent spawning
    ├── voice_global.rs          # Global push-to-talk + Whisper transcription
    ├── tts.rs                   # TTS (system voices + OpenAI nova/alloy/shimmer)
    ├── indexer.rs               # Codebase symbol indexing
    ├── character.rs             # Preference learning from reactions
    ├── cron.rs                  # Scheduled autonomous tasks
    ├── pulse.rs                 # Morning briefing engine
    └── providers/               # Anthropic, OpenAI, Gemini, Groq, Ollama
```

All data is local: `~/.blade/blade.db` (SQLite), `~/.blade/screenshots/` (Total Recall). No cloud sync, no telemetry. API calls go directly to your configured provider using your own key.

---

## Privacy

| Data | Where it goes |
|------|--------------|
| Conversations, memory, embeddings | Local only — `~/.blade/` |
| Screenshots (Total Recall) | Local only — `~/.blade/screenshots/` |
| API keys | OS keychain or local config |
| Your messages | Sent to **your configured provider** with **your API key** |
| Analytics / telemetry | None — BLADE has no servers |

Create `~/.blade/BLADE.md` to give BLADE workspace-level instructions (restrict access, require confirmation, set tone, etc.)

---

## Roadmap

- [ ] "Hey BLADE" wake word (local Whisper + Vosk) — always-on voice
- [ ] SOUL.md diff — weekly transparency report on what BLADE has learned about you
- [ ] God Mode privacy controls — per-app allowlist, blur sensitive areas
- [ ] OpenHands integration as 6th background agent target
- [ ] MCP marketplace — community tool discovery without config files
- [ ] Offline TTS — Piper / Coqui for 100% local voice

---

## Contributing

Issues and PRs welcome. For significant changes, open an issue first.

---

## License

MIT — see [LICENSE](LICENSE)

---

<div align="center">
<sub>Built by <a href="https://slayerblade.site">Arnav Maurya</a> · <a href="https://slayerblade.site/blade">slayerblade.site/blade</a></sub>
</div>
