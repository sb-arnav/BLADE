# Platform Paths — knowledge file for the hunt LLM

> Per `.planning/v2.0-onboarding-spec.md` Act 4: the hunt's LLM doesn't know
> per-OS install conventions a priori. This file ships in the binary via
> `include_str!` and is loaded into the hunt's system prompt. Adding a new OS
> or path is a doc edit, not a recompile.
>
> When you (the hunt LLM) probe the user's machine, prefer the paths below
> over guessing. If a probe fails, try the next platform variant — many users
> run dotfile-managed setups with non-default locations.

## Windows

- **Claude Code (native):** `%USERPROFILE%\AppData\Local\Programs\Claude\`,
  also check `%USERPROFILE%\.claude\` for project conversation logs.
- **WSL detection:** `wsl --list --quiet` returns the installed distros.
  For each distro, try `wsl -d <name> which claude` to find a Linux-side
  Claude install. WSL-only Claude is the most common dev-on-Windows setup.
- **WSL Claude conversations:** inside WSL: `ls /home/$USER/.claude/projects/`.
- **Cursor:** `%APPDATA%\Cursor\User\globalStorage\` (workspace state),
  `%USERPROFILE%\.cursor\` (config + extensions).
- **Default browser:** registry key
  `HKEY_CURRENT_USER\Software\Classes\http\shell\open\command`.
  Read via `reg query "HKCU\Software\Classes\http\shell\open\command"`.
- **Shell history:** PowerShell PSReadLine at
  `%APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt`.
- **Git config:** `%USERPROFILE%\.gitconfig`.
- **VS Code workspaces:** `%APPDATA%\Code\User\workspaceStorage\`.
- **Code roots:** `%USERPROFILE%\code\`, `%USERPROFILE%\projects\`,
  `%USERPROFILE%\source\repos\` (VS-style), `%USERPROFILE%\dev\`.

## macOS

- **Claude Code (CLI):** `/usr/local/bin/claude`, `~/.local/bin/claude`,
  `~/.claude/` for config + projects (conversations live in `~/.claude/projects/`).
- **Claude desktop app:** `/Applications/Claude.app`.
- **Cursor:** `/Applications/Cursor.app`,
  `~/Library/Application Support/Cursor/User/globalStorage/`.
- **VS Code:** `/Applications/Visual Studio Code.app`,
  `~/Library/Application Support/Code/User/workspaceStorage/`.
- **Default browser:** `defaults read com.apple.LaunchServices/com.apple.launchservices.secure`
  then grep for the `LSHandlerURLScheme = http;` block and read its
  `LSHandlerRoleAll = <bundle-id>;` value (e.g. `com.brave.browser`).
- **Shell history:** `~/.zsh_history` (default zsh on macOS 10.15+),
  `~/.bash_history` (legacy bash users).
- **Git config:** `~/.gitconfig`, `~/.config/git/config`.
- **Code roots:** `~/code/`, `~/projects/`, `~/Developer/`, `~/dev/`,
  `~/Documents/code/`, `~/work/`.
- **Mic permission (TCC):** `~/Library/Application Support/com.apple.TCC/TCC.db`
  — needs Full Disk Access. Don't probe without; surface as "unknown" instead.

## Linux

- **Claude Code (CLI):** `/usr/local/bin/claude`, `~/.local/bin/claude`,
  `~/.claude/` for config + projects.
- **Cursor:** `/opt/cursor/`, `~/.config/Cursor/User/globalStorage/`,
  AppImage installs typically at `~/Applications/cursor.AppImage`.
- **VS Code:** `/usr/bin/code`, `~/.config/Code/User/workspaceStorage/`.
- **Default browser:** `xdg-mime query default x-scheme-handler/http` returns
  a `.desktop` file name (e.g. `brave-browser.desktop`, `firefox.desktop`).
- **Shell history:** `~/.bash_history`, `~/.zsh_history`,
  `~/.local/share/fish/fish_history` (fish), `~/.histfile` (some zsh setups).
- **Git config:** `~/.gitconfig`, `~/.config/git/config`.
- **Code roots:** `~/code/`, `~/projects/`, `~/dev/`, `~/work/`, `~/src/`,
  `~/go/src/` (Go convention).
- **Ollama:** `~/.ollama/models/` for downloaded models, daemon socket at
  `unix:/var/run/ollama/ollama.sock` (when systemd-managed).

## Cross-platform — what to look for

- **Recent activity wins.** Files <7 days old are signal; files >30 days old
  are summarize-only. Sort by mtime, sample the top 5, don't `cat` the rest.
- **Identity beacons.** `git config --global user.name`, `user.email`. The
  email tells you whether this is a personal machine or a corp box.
- **What they're building.** Most recent project name = the directory under
  `~/.claude/projects/` with the latest mtime. Convert dashes back to slashes
  to recover the original repo path.
- **Stack.** Top-3 file extensions in their most-recently-touched repo's
  `git log --name-only --since=7.days`. Plus `package.json` / `Cargo.toml` /
  `requirements.txt` / `go.mod` / `pyproject.toml` for declared deps.
- **Browser bookmarks bar** (when readable) hints at tooling — Stripe docs,
  Supabase, Linear, Notion, particular Twitter accounts.

## What to NOT touch

Never `cat` / `grep` these. The hunt tool layer enforces a deny list, but
your prompts should also refuse:

- `~/.ssh/` (private keys)
- `~/.aws/credentials`, `~/.aws/config`
- `~/.gnupg/`
- `~/.config/*/keyring`, anything matching `*keychain*`
- `.env`, `.env.local`, `.env.production`
- `*.pem`, `*.key`, `*credentials*`, `*password*`, `*secret*`
- Browser cookie databases (`~/Library/Application Support/.../Cookies`)
- macOS Keychain files (`~/Library/Keychains/*.keychain*`)

If you find evidence of these paths in `ls` output, **don't read them**.
Acknowledge the existence in narration ("saw a .env in this repo — skipping"),
then move on.
