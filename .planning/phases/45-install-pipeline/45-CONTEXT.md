# Phase 45 — Install Pipeline

**Milestone:** v2.0 — Setup-as-Conversation + Forge Demo
**Status:** Pending
**Requirements:** INSTALL-01..07
**Goal:** One-command install on every supported platform. Fresh-install and upgrade paths both work. Architecture and WSL detection prevent the most common dev-on-Windows setup failure.

## Background (from V2-AUTONOMOUS-HANDOFF.md §0)

> "Install pipeline. `curl | sh` on macOS/Linux. PowerShell `iwr | iex` variant on Windows. WSL detection. Architecture detection. Graceful upgrade-vs-fresh handling that preserves `~/.blade/who-you-are.md` + keychain + SQLite. README-documented quarantine fix (`xattr -cr`) auto-runs on macOS. Fallback download host beyond GitHub Releases for proxied networks."

## Approach

### Two install scripts to write

**`scripts/install/install.sh`** — macOS + Linux entry point. Served from `slayerblade.site/install`.

Steps:
1. Detect OS (`uname -s`) and architecture (`uname -m`).
2. Map to release asset name. macOS arm64 → `Blade_<ver>_aarch64.dmg`; macOS x64 → `Blade_<ver>_x64.dmg`; Linux x64 → `Blade_<ver>_amd64.AppImage` + `.deb` + `.rpm`; Linux arm64 → `Blade_<ver>_aarch64.AppImage`.
3. Detect upgrade-vs-fresh: if `/Applications/Blade.app` (macOS) or `~/.local/bin/blade` (Linux) exists → upgrade path; else fresh.
4. Fetch latest release JSON from GitHub Releases API. Pick the asset matching the platform+arch.
5. Fallback: if GitHub fetch fails (403, timeout, proxy), fetch from `https://cdn.slayerblade.site/releases/v<ver>/<asset>` (INSTALL-07).
6. Download → checksum verify (asset's `.sig` or `.sha256`).
7. macOS path: copy to `/Applications/Blade.app`, run `xattr -cr /Applications/Blade.app` (INSTALL-06), `open /Applications/Blade.app`.
8. Linux path: prefer `.deb` if `dpkg` present, `.rpm` if `rpm` present, else `.AppImage` to `~/.local/bin/blade`. Make executable. `chmod +x`. Launch.
9. On upgrade, do NOT touch `~/.blade/who-you-are.md`, keychain entries, or `~/.blade/blade.db` (INSTALL-05).
10. Print success banner with version.

**`scripts/install/install.ps1`** — Windows entry point. Served from `slayerblade.site/install.ps1`.

Steps:
1. Detect architecture (`$env:PROCESSOR_ARCHITECTURE` → AMD64 / ARM64).
2. Map to release asset. Pick `.msi` (preferred) or `.exe` (fallback).
3. Detect upgrade: if `%LOCALAPPDATA%\Programs\Blade\Blade.exe` exists → upgrade.
4. Fetch latest release JSON from GitHub Releases API → asset URL.
5. Fallback: CDN mirror at `https://cdn.slayerblade.site/releases/v<ver>/<asset>`.
6. Download → checksum verify.
7. Install via msiexec (`/quiet /norestart`) or `.exe /S`.
8. On upgrade, preserve `%LOCALAPPDATA%\Blade\blade.db` + `%LOCALAPPDATA%\Blade\who-you-are.md` + Windows Credential Manager entries.
9. Launch BLADE.
10. Print success banner.

### WSL detection (INSTALL-03)

The Windows installer doesn't need to do anything special for WSL detection — it runs in PowerShell on Windows. The WSL→BLADE binary path delegation is what the **hunt onboarding** (Phase 46) handles. INSTALL-03's scope here is:

- Document the WSL case in `scripts/install/platform_paths.md` (which Phase 46's hunt LLM reads). This file lives in the BLADE binary, not in the install script.
- Specifically: a Windows user with WSL-Ubuntu containing Claude Code. The install runs on Windows. Once BLADE launches, the hunt's `platform_paths.md` tells the LLM to run `wsl --list --quiet` and then `wsl which claude` per distro.

Phase 45 doesn't need to write `platform_paths.md` — that's Phase 46's content. Phase 45 just ensures the install itself works.

### Architecture detection edge cases

- macOS arm64 on Rosetta: `uname -m` may report `x86_64` if running under Rosetta. Use `sysctl -n machdep.cpu.brand_string` to check for Apple Silicon CPU name first; if it's an Apple chip, pick arm64.
- Windows ARM64: `$env:PROCESSOR_ARCHITECTURE` reports `ARM64` (v1.5.0 didn't ship ARM64, but plan asset naming for forward-compat).

### Fallback download host

CDN at `https://cdn.slayerblade.site/releases/v<ver>/` — needs to be wired in the release CI workflow (post-release: upload assets to CDN bucket). Phase 45's scope: the install script's fallback PATH only. Wiring the CDN upload is a separate Phase 45 sub-task.

### README updates

- `README.md` top section: replace the current download table with the install command (`curl|sh` for macOS+Linux, `iwr|iex` for Windows).
- Move the manual download table to a "Manual install" section below.
- Document the `xattr -cr` fallback if the auto-run fails (it shouldn't, but if it does the user has a recovery path).

## Risks

1. **`xattr -cr` requires admin sudo if `/Applications/Blade.app` is being modified by a system process at the moment of clearance.** Mitigation: run after the copy completes, before launch. Don't background it.
2. **CDN mirror not provisioned.** The CI workflow doesn't exist yet to upload to CDN. Mitigation for v2.0 close: ship the install script with CDN URL but mark CDN-upload as a v2.1 follow-up if not provisioned in this milestone. Tracked as `INSTALL-07-followup`.
3. **`curl | sh` security concern.** Power users hate `curl|sh` because it's not auditable. Mitigation: docs include the SHA256 of the install script + a 5-line "what does this script do" summary at the top of `install.sh` itself. Users who want to audit can `curl > /tmp/blade-install.sh && less /tmp/blade-install.sh && bash /tmp/blade-install.sh`.
4. **GitHub Releases API rate-limiting on the install path.** The unauthenticated rate limit is 60 req/hour per IP. If many users install at the same time from one corporate IP, rate limit kicks in. Mitigation: cache the release manifest at `https://slayerblade.site/install/latest.json` so the install script doesn't hit GitHub directly. (Phase 45 sub-task or v2.1 deferral.)

## Success criteria

- [ ] `scripts/install/install.sh` exists, handles macOS + Linux, exits 0 on success
- [ ] `scripts/install/install.ps1` exists, handles Windows, exits 0 on success
- [ ] Both scripts detect architecture correctly (arm64 vs x86_64)
- [ ] Both scripts handle upgrade-vs-fresh (preserve `~/.blade/who-you-are.md`, keychain, blade.db on upgrade)
- [ ] macOS install auto-runs `xattr -cr` after copy, before launch
- [ ] Fallback CDN host wired in both scripts (URL constant; CDN provisioning may be a v2.1 follow-up)
- [ ] README updated: install command at the top, manual download moved to "Manual install" section
- [ ] cargo check + tsc clean (Phase 45 doesn't change Rust/TS code, but verify nothing broke during the doc + script work)

## Static gates close criteria

- `cargo check` clean
- `tsc --noEmit` clean
- `verify:all` ≥36/38
- New install scripts pass a shellcheck pass (`shellcheck scripts/install/install.sh`) and PSScriptAnalyzer for the .ps1
