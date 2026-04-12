<div align="center">

<img src="src-tauri/icons/128x128@2x.png" width="96" height="96" alt="Blade" />

# BLADE

**Personal AI that lives on your machine.**

Not a chat window. An operating intelligence — wired into your files, apps, terminal, and memory.

[![Release](https://img.shields.io/github/v/release/sb-arnav/blade?style=flat-square&label=latest&color=0f0f0f)](https://github.com/sb-arnav/blade/releases/latest)
[![License](https://img.shields.io/github/license/sb-arnav/blade?style=flat-square&color=0f0f0f)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-0f0f0f?style=flat-square)](https://github.com/sb-arnav/blade/releases/latest)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-0f0f0f?style=flat-square)](https://tauri.app)

[**Download**](https://slayerblade.site/blade) · [Releases](https://github.com/sb-arnav/blade/releases) · [Report a bug](https://github.com/sb-arnav/blade/issues)

</div>

---

## What makes it different

Most AI tools reset every session. Blade compounds. It stores everything — shell commands, file reads, conversations, tool results — and pulls from that history automatically. The second week is smarter than the first.

| Feature | Blade | Claude Code | ChatGPT |
|---------|:-----:|:-----------:|:-------:|
| Persistent cross-session memory | ✓ | ✗ | ✗ |
| Execution history recall | ✓ | ✗ | ✗ |
| Native desktop (not browser) | ✓ | CLI only | ✗ |
| Global voice input | ✓ | ✗ | ✗ |
| Background agents | ✓ | ✗ | ✗ |
| MCP tool network | ✓ | ✓ | ✗ |
| God Mode (live screen context) | ✓ | ✗ | ✗ |
| Codebase indexing | ✓ | ✓ | ✗ |
| Multi-provider (any API key) | ✓ | ✗ | ✗ |
| Local inference (Ollama) | ✓ | ✗ | ✗ |
| Pentest mode | ✓ | ✗ | ✗ |
| Learns from reactions | ✓ | ✗ | ✗ |

---

## Features

### 🧠 Permanent Memory
Every command, file read, and conversation is embedded and stored locally. When something breaks again, Blade searches past executions for what worked before — automatically.

### 🎙️ Global Voice Input
Press `Ctrl+Shift+V` from anywhere on your desktop. Blade records. Press again — it transcribes via Whisper and opens QuickAsk pre-filled with your words. No window switching, no copy-paste.

### 👁️ God Mode
Background context injection. Blade captures your active window, clipboard, and running apps periodically, then injects this into every AI call. The model always knows what you're working on — without being told.

### 🤖 Background Agents
Spawn Claude Code, Aider, or Goose as background workers. Blade stays the orchestrator — one command surface, multiple specialists working in parallel.

### ⏰ BLADE Cron
Schedule recurring autonomous tasks: *"every Monday at 9am, check GitHub notifications and send me only what matters."* Blade runs while you sleep.

### 🔌 MCP Tool Network
Connect any MCP server — browser automation, terminal, files, databases, APIs. Blade orchestrates them as a unified toolkit.

### 🎯 Codebase Indexer
Indexes every function, class, and symbol across your projects. Find any symbol instantly. No re-reading files — Blade already knows your code.

### 🔒 Pentest Mode
Security testing with mandatory ownership verification. Uses Groq or Ollama — never your Anthropic key. Kali tools, nmap, sqlmap, metasploit — gated behind an explicit authorization record.

### 💡 Learns From You
Thumbs up or down on any response. Every 5 reactions, Blade extracts behavioral preferences and bakes them into every future reply automatically.

### ⚡ Multi-Provider + Smart Routing
OpenAI, Anthropic, Google Gemini, Groq, Ollama, or any OpenAI-compatible endpoint. Smart routing selects the right model tier per task. Model-adaptive prompting means even small models (Llama 8B, GPT-4o mini) get scaffolded to punch above their weight.

---

## Install

Download the latest build from [slayerblade.site/blade](https://slayerblade.site/blade) or directly:

| Platform | Download |
|----------|----------|
| **macOS** (Apple Silicon) | [`.dmg` ↗](https://github.com/sb-arnav/blade/releases/latest/download/Blade_0.4.0_aarch64.dmg) |
| **macOS** (Intel) | [`.dmg` ↗](https://github.com/sb-arnav/blade/releases/latest/download/Blade_0.4.0_x64.dmg) |
| **Windows** | [`.exe` ↗](https://github.com/sb-arnav/blade/releases/latest/download/Blade_0.4.0_x64-setup.exe) |
| **Linux** | [`.AppImage` ↗](https://github.com/sb-arnav/blade/releases/latest/download/blade_0.4.0_amd64.AppImage) |

> **macOS note:** If you see "Blade is damaged and can't be opened", run this in Terminal after installing:
> ```bash
> xattr -cr /Applications/Blade.app
> ```
> This removes the quarantine flag macOS adds to downloaded apps. Blade isn't notarized yet (no Apple Developer certificate). Right-click → Open no longer bypasses this on macOS Sequoia.

Installed builds auto-update from GitHub Releases.

---

## Quick Start

1. Install and launch Blade
2. The setup wizard picks your provider and API key
3. **`Alt+Space`** — QuickAsk from anywhere
4. **`Ctrl+Shift+V`** — Voice input from anywhere

**Slash commands** — type `/` in chat: `/clear` `/new` `/screenshot` `/voice` `/focus` `/init` `/help`

---

## Build From Source

Requires Node 20.19+ and Rust stable.

```bash
git clone https://github.com/sb-arnav/blade.git && cd blade
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
blade/
├── src/                    # React + Vite frontend
│   ├── components/         # Chat, Settings, QuickAsk, God Mode UI
│   └── hooks/              # State
└── src-tauri/src/          # Rust backend
    ├── brain.rs            # System prompt builder + model-adaptive prompting
    ├── commands.rs         # Message loop + tool execution
    ├── db.rs               # SQLite (memory, timeline, preferences, embeddings)
    ├── embeddings.rs       # Local semantic search (fastembed AllMiniLML6V2)
    ├── native_tools.rs     # 20+ built-in tools (bash, file, web, UI automation)
    ├── mcp.rs              # MCP client + tool orchestration
    ├── godmode.rs          # Screen + window context capture
    ├── voice_global.rs     # Global push-to-talk shortcut
    ├── tts.rs              # TTS (system voices + OpenAI nova/alloy/shimmer)
    ├── runtimes.rs         # Background agents + security engagements
    ├── indexer.rs          # Codebase symbol indexing
    ├── character.rs        # Preference learning from reactions
    └── providers/          # Anthropic, OpenAI, Gemini, Groq, Ollama
```

All storage is local: `~/.blade/blade.db` (SQLite). No cloud sync, no telemetry. API calls go directly to your provider using your own key.

---

## Privacy

| Data | Where it goes |
|------|--------------|
| Conversations, memory, embeddings | Local only (`~/.blade/`) |
| API keys | OS keychain or local config |
| Your messages | Sent to **your configured provider** with **your API key** |
| Analytics / telemetry | None — Blade has no servers |

Create `~/.blade/BLADE.md` to give Blade workspace-level instructions (restrict access, require confirmation, set tone, etc.)

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
