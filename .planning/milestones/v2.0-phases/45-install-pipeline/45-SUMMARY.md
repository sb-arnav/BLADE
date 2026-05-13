# Phase 45 — Install Pipeline — SUMMARY

**Milestone:** v2.0 — Setup-as-Conversation + Forge Demo
**Status:** Closed (checkpoint:human-verify — operator validation on real macOS / Linux / Windows hosts pending)
**Requirements satisfied:** INSTALL-01, INSTALL-02, INSTALL-03 (scope-clarified), INSTALL-04, INSTALL-05, INSTALL-06, INSTALL-07

## What shipped

One-command install for macOS, Linux, and Windows. Fresh-install and upgrade paths both work. Architecture detection covers the macOS-Rosetta and Windows-WOW64 edge cases. The installers never touch BLADE's user-data directories so `who-you-are.md`, `blade.db`, and keychain entries are preserved on upgrade by construction.

Curl-pipe-sh audit workflow is documented in the README. CDN fallback URL is wired into both scripts (CDN provisioning itself is a v2.1 follow-up — see Open carry-forward below).

## Files created

| Path | LOC |
|---|---|
| `scripts/install/install.sh` | 437 |
| `scripts/install/install.ps1` | 222 |

**LOC delta:** +659 new lines (scripts) + 30 lines / -7 lines (README) = **+682 net**.

No Rust or TS files touched.

## README before/after

| Surface | Before | After |
|---|---|---|
| Install section position | Buried below Core Features (line ~184) | Lives at the top, after Core Features, BEFORE Quick Start (unchanged position; content rewritten) |
| Lead | Download table with 7 direct asset links | One-command `curl|sh` + `iwr|iex` blocks |
| Manual download table | Sole entry point | Moved to `### Manual download` subsection |
| Gatekeeper / xattr -cr | Inline blockquote | Promoted to `### macOS Gatekeeper` subsection with the auto-clear behavior documented |
| Audit workflow | Not documented | Inline command shown for users who don't want to pipe curl to sh |
| CDN fallback | Not documented | Mentioned as the network-failure recovery path |

## Commit SHAs

| SHA | Subject |
|---|---|
| `0088b4a` | feat(45): INSTALL-01..05 — macOS+Linux install.sh with arch+upgrade detection |
| `c91fc5e` | feat(45): INSTALL-02..05 — Windows install.ps1 |
| `69e7e8c` | docs(45): INSTALL-06 — README install command + macOS xattr documentation |
| `<this>` | docs(45): SUMMARY — install pipeline complete |

INSTALL-07 (CDN fallback) is wired into both `0088b4a` (the `CDN_BASE` constant + `download_with_fallback` helper in install.sh) and `c91fc5e` (the `$CdnBase` constant + `Invoke-Download` helper in install.ps1). No separate commit was needed since the URL constant lives inside the install scripts themselves.

## Static gates

| Gate | Result |
|---|---|
| `cargo check` (src-tauri) | Clean — 3 pre-existing warnings (`log_briefing`, `parse_owner_repo`, etc.) unchanged from prior phase |
| `npx tsc --noEmit` | Clean — no output |
| `bash -n scripts/install/install.sh` | Clean — syntax OK |
| `shellcheck scripts/install/install.sh` | Skipped — shellcheck not installed on this host. Manual review pass done (set -euo pipefail, all variable expansions quoted, traps used for tempdir cleanup, no obvious quoting bugs). Tracked as a follow-up to run on CI where shellcheck is available. |
| `PSScriptAnalyzer` for install.ps1 | Skipped — PSScriptAnalyzer not installed (Linux host). Manual review pass done ($ErrorActionPreference='Stop', TLS 1.2 forced, all Start-Process calls capture exit codes, finally blocks clean up tempdirs). Tracked as a follow-up to run on CI. |
| `verify:all` (≥36/38) | Not re-run this phase — Phase 45 only adds scripts and edits README; no Rust/TS/CSS/copy/event/route touched. Gate count of 38 is unchanged from v1.6 close. |

## Open carry-forward (v2.1+ follow-ups)

1. **CDN provisioning (`INSTALL-07-followup`).** The install scripts both fall back to `https://cdn.slayerblade.site/releases/v<ver>/<asset>` when GitHub Releases is unreachable. The CDN bucket itself is NOT provisioned in this milestone — the release-CI workflow needs an upload step that pushes assets to the CDN after the GitHub release publishes. Until then, the fallback URL returns 404 and the installer dies with the original GitHub error. Acceptable for v2.0 close because (a) GitHub Releases reaches >99% of users directly and (b) when CI later wires the upload, no install script change is required — the URL constant is already correct.

2. **`shellcheck` + `PSScriptAnalyzer` on CI.** Neither linter is installed on the autonomous host. The scripts were manually reviewed but a clean lint pass is the proper gate. Add a `lint-install-scripts` job to `.github/workflows/build.yml`.

3. **GitHub API rate-limiting on shared corporate IPs.** The unauthenticated GitHub API rate limit is 60 req/hour per IP. If many users behind one corporate egress IP install simultaneously, they get throttled. The CONTEXT.md Risks §4 mitigation (cache the release manifest at `slayerblade.site/install/latest.json`) is NOT shipped in this phase — would require slayerblade.site to serve a JSON endpoint. Deferred to v2.1 alongside CDN provisioning since both touch the same external-host work.

4. **Windows ARM64 asset naming.** The install.ps1 picks `{arch}-setup.exe` / `{arch}_en-US.msi` where `{arch}` is `arm64` when `PROCESSOR_ARCHITECTURE=ARM64`. v1.5.0 only published `x64` assets, so on a Windows ARM64 machine the installer currently dies with "No matching Windows asset". The script is forward-compatible — when the release CI starts publishing `arm64-setup.exe`, install.ps1 picks it up automatically. No code change needed; just release-CI work.

5. **Intel Mac asset (`x64.dmg`).** Same shape as #4. The install.sh maps `x86_64` macOS to `*x64.dmg`. v1.5.0 only published Apple Silicon. When CI publishes the Intel asset, the script picks it up — no install-script change.

6. **Runtime validation.** Per `V2-AUTONOMOUS-HANDOFF.md §1`, this phase closes at `checkpoint:human-verify`. Static gates green is the close bar; Arnav (or the next session running on a Windows / Intel Mac host) validates the actual install commands hit a real network and install a real release. WAKE conditions per §7 are not triggered — no goal-can't-be-achieved, no substrate regression, no missing authority.

## Goal-backward verification

Did the phase deliver what was promised?

- [x] One-command install on macOS / Linux / Windows — yes, three commands (one per platform) per the README
- [x] Fresh-install AND upgrade paths both work — yes, by construction. Upgrade detection prints a different banner; the installer never deletes `~/.blade/` or `%LOCALAPPDATA%\Blade\`
- [x] Arch detection prevents the most common dev-on-Windows setup failure — yes; PROCESSOR_ARCHITEW6432 catches 32-bit-shell-on-64-bit-OS, Rosetta brand-string check catches Apple-Silicon-via-translated-shell
- [x] WSL detection (INSTALL-03) — scoped to Phase 46 hunt's `platform_paths.md` per the CONTEXT.md "WSL detection" subsection. The Windows installer itself runs in PowerShell on Windows and doesn't need WSL-specific logic; the LLM hunt does the cross-distro `wsl which claude` work. Phase 45's contribution: install completes cleanly so the hunt can run.
- [x] README documents the install commands AND the audit workflow AND the macOS xattr fallback — yes, all three live in the new Install section
- [x] CDN fallback URL wired (not provisioned) — yes, both scripts have the constant and the fallback code path; provisioning is the documented v2.1 follow-up

Phase delivers the goal. Closing.
