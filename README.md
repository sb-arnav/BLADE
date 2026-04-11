# Blade — Personal AI Desktop

A native desktop AI assistant for Windows, macOS, and Linux. Multiple providers, voice input, screen awareness, and an agent mode that can actually do things.

Built with Tauri 2 + React + Rust.

---

## What It Does

**Multi-provider chat** — OpenAI, Anthropic, Google Gemini, Groq, Ollama, or any OpenAI-compatible endpoint (Vercel AI Gateway, Cloudflare AI, Azure OpenAI). Switch models mid-conversation. Configure a base URL to route any provider through a gateway.

**Voice input** — Push-to-talk (hold Ctrl+Space) or always-on VAD that listens continuously and auto-captures speech segments. Wake word support ("hey blade", "ok blade") — say the wake word and Blade auto-sends; without it, transcription fills the input for review. Powered by Groq Whisper.

**Screen awareness** — Screenshot the primary monitor, attach it to a message, let the AI describe or analyze what's on screen. Works from the toolbar or `/screenshot` command.

**God Mode** — Background context injection. Blade periodically captures your active window, clipboard, and running apps, then injects this context into every AI call so the model always knows what you're working on. Three tiers: Normal (5 min), Intermediate (2 min), Extreme (1 min + JARVIS directive for proactive suggestions).

**Agent mode** — Multi-step task execution. Blade can plan, use tools (web search, file read/write, shell commands), and iterate until the task is done.

**Obsidian vault integration** — Point Blade at your vault and it can read and write notes as part of any conversation.

**System tray** — Runs in the background. Global shortcut to show/hide. Auto-starts on login.

**Local conversation history** — SQLite, stored on device. Semantic search with local embeddings (FastEmbed). No data leaves the machine unless you send it to an AI provider.

---

## Install

Download the latest installer for your platform from [Releases](https://github.com/sb-arnav/blade/releases/latest):

| Platform | Format |
|----------|--------|
| Windows  | `.exe` (NSIS) or `.msi` |
| macOS    | `.dmg` |
| Linux    | `.AppImage`, `.deb`, or `.rpm` |

Installed builds auto-update from GitHub Releases.

---

## Quick Start

1. Install and launch Blade.
2. On first run, the setup wizard walks you through picking a provider and pasting an API key.
3. Start chatting.

**Slash commands** — type `/` to see available commands: `/clear`, `/new`, `/screenshot`, `/voice`, `/focus`, `/export`, `/help`.

**Voice** — configure in Settings → Voice Mode. Requires a Groq API key for transcription (free tier available at console.groq.com).

---

## Build From Source

Node 20.19+ and Rust stable required.

```bash
# Install frontend deps
npm install

# Dev mode (hot reload, no installer)
npm run tauri dev

# Production build
npm run tauri build
```

**Linux system deps** (Ubuntu/Debian):

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  libasound2-dev libdbus-1-dev pkg-config libssl-dev \
  libsecret-1-dev libglib2.0-dev libxdo-dev \
  libpipewire-0.3-dev libspa-0.2-dev libdrm-dev libgbm-dev
```

---

## Configuration

All settings live in the Settings panel (gear icon or `Cmd/Ctrl+,`):

- **Provider + Model** — pick from presets or enter a custom base URL for any OpenAI-compatible API
- **God Mode** — off / normal / intermediate / extreme
- **Voice Mode** — off / push-to-talk / always-on
- **Obsidian Vault** — path to your vault folder
- **Theme** — system / light / dark

API keys are stored in the system keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux).

---

## Release Setup (maintainers)

Add these secrets to the GitHub repo before tagging releases:

| Secret | Purpose |
|--------|---------|
| `TAURI_UPDATER_PUBKEY` | Public key for updater signature verification |
| `TAURI_SIGNING_PRIVATE_KEY` | Private key for signing update bundles |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the private key |

If the updater secrets are not set, CI falls back to unsigned builds (no auto-update).

**To publish a release:**

```bash
# Bump version in package.json and src-tauri/tauri.conf.json, then:
git tag v0.x.y
git push origin v0.x.y
```

GitHub Actions builds and attaches installers for all three platforms.

---

## Stack

| Layer | Tech |
|-------|------|
| Desktop shell | Tauri 2 |
| Frontend | React 18, TypeScript, Tailwind CSS |
| Backend | Rust (async via Tokio) |
| Database | SQLite via rusqlite (bundled) |
| Embeddings | FastEmbed (local, no API) |
| Voice capture | Web Audio API (VAD) + MediaRecorder |
| Transcription | Groq Whisper API |
| Screen capture | xcap |
| Keychain | keyring crate (platform-native) |

---

## License

MIT
