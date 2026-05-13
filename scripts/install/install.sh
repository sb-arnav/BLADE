#!/usr/bin/env bash
# BLADE installer — macOS + Linux.
# Detects OS/arch, fetches the latest GitHub release manifest (CDN fallback for proxied networks),
# downloads the matching asset (.dmg / .deb / .rpm / .AppImage), verifies SHA256 when sibling
# checksum is published, installs to the platform-native location, and launches BLADE.
# Preserves ~/.blade/ user data (who-you-are.md, blade.db, keychain) across upgrades — never deletes it.
# Safe to audit: curl -sSL slayerblade.site/install > install.sh && less install.sh && bash install.sh

set -euo pipefail

# --- constants ----------------------------------------------------------------
GITHUB_REPO="sb-arnav/BLADE"
GITHUB_API="https://api.github.com/repos/${GITHUB_REPO}/releases/latest"
CDN_BASE="https://cdn.slayerblade.site/releases"
CURL_TIMEOUT=30
CURL_RETRY=3
CURL_RETRY_DELAY=2

# --- ui helpers ---------------------------------------------------------------
if [ -t 1 ]; then
  C_RESET="$(printf '\033[0m')"
  C_BOLD="$(printf '\033[1m')"
  C_DIM="$(printf '\033[2m')"
  C_RED="$(printf '\033[31m')"
  C_GREEN="$(printf '\033[32m')"
  C_YELLOW="$(printf '\033[33m')"
  C_BLUE="$(printf '\033[34m')"
else
  C_RESET=""; C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""
fi

log()   { printf "%s[blade]%s %s\n" "$C_BLUE" "$C_RESET" "$1"; }
ok()    { printf "%s[blade]%s %s\n" "$C_GREEN" "$C_RESET" "$1"; }
warn()  { printf "%s[blade]%s %s\n" "$C_YELLOW" "$C_RESET" "$1" >&2; }
die()   { printf "%s[blade]%s %s\n" "$C_RED" "$C_RESET" "$1" >&2; exit 1; }

# --- arg parsing --------------------------------------------------------------
DRY_RUN=0
INSTALL_VERSION=""
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --version=*) INSTALL_VERSION="${arg#--version=}" ;;
    -h|--help)
      cat <<EOF
BLADE installer (macOS + Linux)

Usage: bash install.sh [--dry-run] [--version=vX.Y.Z]

Options:
  --dry-run         Print actions without installing
  --version=vX.Y.Z  Pin a specific release (default: latest)
  -h, --help        Show this help

After install, BLADE launches automatically. User data in ~/.blade is preserved on upgrade.
EOF
      exit 0
      ;;
    *) warn "Unknown arg ignored: $arg" ;;
  esac
done

# --- dependencies -------------------------------------------------------------
for cmd in curl uname mktemp; do
  command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
done

HAS_JQ=0
if command -v jq >/dev/null 2>&1; then
  HAS_JQ=1
fi

HAS_SHA256=0
if command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; then
  HAS_SHA256=1
fi

# --- platform detection -------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      die "Unsupported OS: $(uname -s). BLADE supports macOS and Linux from this installer; Windows uses install.ps1." ;;
  esac
}

detect_arch() {
  local os="$1"
  local raw
  raw="$(uname -m)"

  # macOS Rosetta edge case: a Rosetta-translated shell on Apple Silicon reports x86_64.
  if [ "$os" = "macos" ]; then
    local brand=""
    if command -v sysctl >/dev/null 2>&1; then
      brand="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo "")"
    fi
    if echo "$brand" | grep -qi "Apple"; then
      echo "aarch64"
      return
    fi
  fi

  case "$raw" in
    x86_64|amd64)   echo "x86_64" ;;
    aarch64|arm64)  echo "aarch64" ;;
    *) die "Unsupported architecture: $raw. Open an issue: https://github.com/${GITHUB_REPO}/issues" ;;
  esac
}

# --- net helpers --------------------------------------------------------------
curl_get() {
  # Fetch a URL to stdout with timeout + retry.
  local url="$1"
  curl --silent --show-error --location \
    --max-time "$CURL_TIMEOUT" \
    --retry "$CURL_RETRY" \
    --retry-delay "$CURL_RETRY_DELAY" \
    --retry-connrefused \
    --fail \
    "$url"
}

curl_download() {
  # Download URL to path; returns nonzero on HTTP error.
  local url="$1"
  local out="$2"
  curl --location \
    --max-time 600 \
    --retry "$CURL_RETRY" \
    --retry-delay "$CURL_RETRY_DELAY" \
    --retry-connrefused \
    --fail \
    --output "$out" \
    --progress-bar \
    "$url"
}

# --- release manifest ---------------------------------------------------------
fetch_release_json() {
  local url="$GITHUB_API"
  if [ -n "$INSTALL_VERSION" ]; then
    url="https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${INSTALL_VERSION}"
  fi
  curl_get "$url"
}

# Extract tag_name + asset (name, browser_download_url) from release JSON.
# Uses jq if available, else a grep-based parser (fewer deps preferred per phase brief).
release_tag_from_json() {
  local json="$1"
  if [ "$HAS_JQ" -eq 1 ]; then
    printf "%s" "$json" | jq -r '.tag_name // empty'
  else
    printf "%s" "$json" | grep -oE '"tag_name":[[:space:]]*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
  fi
}

asset_url_from_json() {
  # $1 = json, $2 = asset name suffix to match (e.g., aarch64.dmg)
  local json="$1"
  local pattern="$2"
  if [ "$HAS_JQ" -eq 1 ]; then
    printf "%s" "$json" \
      | jq -r --arg p "$pattern" '.assets[] | select(.name | endswith($p)) | .browser_download_url' \
      | head -1
  else
    # Pair every "name": ... with the next "browser_download_url": ... that follows it.
    printf "%s" "$json" \
      | tr -d '\n' \
      | grep -oE '"name":[[:space:]]*"[^"]*",[[:space:]]*"[^"]*":[^,]*,[[:space:]]*"browser_download_url":[[:space:]]*"[^"]+"' \
      | grep -F "$pattern" \
      | head -1 \
      | grep -oE '"browser_download_url":[[:space:]]*"[^"]+"' \
      | sed 's/.*"\([^"]*\)"$/\1/'
  fi
}

# --- checksum -----------------------------------------------------------------
sha256_of() {
  local f="$1"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  else
    sha256sum "$f" | awk '{print $1}'
  fi
}

verify_checksum() {
  # $1 = downloaded file, $2 = url of file, $3 = release_json
  local file="$1"
  local file_url="$2"
  local json="$3"
  local asset_name
  asset_name="$(basename "$file_url")"
  local sum_name="${asset_name}.sha256"
  local sum_url
  sum_url="$(asset_url_from_json "$json" "$sum_name")"

  if [ -z "$sum_url" ]; then
    warn "No .sha256 sibling published for ${asset_name} — skipping checksum verify."
    return 0
  fi

  if [ "$HAS_SHA256" -ne 1 ]; then
    warn "No shasum/sha256sum on PATH — skipping checksum verify."
    return 0
  fi

  log "Verifying SHA256 checksum..."
  local expected actual sum_text
  sum_text="$(curl_get "$sum_url" || true)"
  expected="$(printf "%s" "$sum_text" | awk '{print $1}' | head -1)"
  if [ -z "$expected" ]; then
    warn "Checksum file empty or unreachable — skipping verify."
    return 0
  fi
  actual="$(sha256_of "$file")"
  if [ "$expected" != "$actual" ]; then
    die "Checksum mismatch: expected $expected, got $actual"
  fi
  ok "Checksum OK ($actual)"
}

# --- download with cdn fallback (INSTALL-07) ----------------------------------
download_with_fallback() {
  # $1 = primary url (github), $2 = version, $3 = asset name, $4 = out path
  local primary_url="$1"
  local version="$2"
  local asset_name="$3"
  local out="$4"

  log "Downloading ${asset_name}..."
  if curl_download "$primary_url" "$out"; then
    return 0
  fi

  warn "GitHub download failed; trying CDN mirror..."
  local cdn_url="${CDN_BASE}/${version}/${asset_name}"
  if curl_download "$cdn_url" "$out"; then
    ok "CDN mirror download succeeded"
    return 0
  fi

  die "Failed to download ${asset_name} from GitHub and CDN. Check your network or open an issue."
}

# --- macOS install ------------------------------------------------------------
install_macos() {
  local arch="$1"
  local version="$2"
  local json="$3"
  local mode="$4"   # "Installing" or "Upgrading"

  local asset_suffix
  case "$arch" in
    aarch64) asset_suffix="aarch64.dmg" ;;
    x86_64)  asset_suffix="x64.dmg" ;;
    *)       die "Unsupported macOS arch: $arch" ;;
  esac

  local url
  url="$(asset_url_from_json "$json" "$asset_suffix")"
  [ -n "$url" ] || die "No matching macOS asset (*${asset_suffix}) in release ${version}"

  local asset_name
  asset_name="$(basename "$url")"

  local tmpdir
  tmpdir="$(mktemp -d -t blade-install.XXXXXX)"
  trap 'rm -rf "$tmpdir"' EXIT

  local dmg="${tmpdir}/${asset_name}"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] Would download ${url} -> ${dmg}"
    log "[dry-run] Would mount ${dmg}, copy Blade.app to /Applications, xattr -cr, open Blade"
    return 0
  fi

  download_with_fallback "$url" "$version" "$asset_name" "$dmg"
  verify_checksum "$dmg" "$url" "$json"

  log "${mode} BLADE to /Applications..."
  local mount_point
  mount_point="$(mktemp -d -t blade-mount.XXXXXX)"
  hdiutil attach -nobrowse -quiet -mountpoint "$mount_point" "$dmg"
  trap 'hdiutil detach -quiet "$mount_point" 2>/dev/null || true; rm -rf "$tmpdir" "$mount_point"' EXIT

  local source_app="${mount_point}/Blade.app"
  [ -d "$source_app" ] || die "Blade.app not found inside DMG"

  # Remove existing app bundle (user data in ~/.blade is untouched).
  if [ -d "/Applications/Blade.app" ]; then
    rm -rf "/Applications/Blade.app"
  fi
  cp -R "$source_app" "/Applications/Blade.app"

  hdiutil detach -quiet "$mount_point" 2>/dev/null || true

  # Clear quarantine flag so Gatekeeper doesn't block first launch.
  xattr -cr "/Applications/Blade.app" 2>/dev/null || warn "xattr -cr failed; you may need to run it manually."

  ok "${mode} complete — launching BLADE..."
  open "/Applications/Blade.app"
}

# --- Linux install ------------------------------------------------------------
install_linux() {
  local arch="$1"
  local version="$2"
  local json="$3"
  local mode="$4"

  # Prefer .deb on dpkg-based systems, .rpm on rpm-based, else .AppImage.
  local pkg_mode=""
  local asset_suffix=""

  if [ "$arch" = "x86_64" ]; then
    if command -v dpkg >/dev/null 2>&1; then
      pkg_mode="deb"
      asset_suffix="amd64.deb"
    elif command -v rpm >/dev/null 2>&1; then
      pkg_mode="rpm"
      asset_suffix="x86_64.rpm"
    else
      pkg_mode="appimage"
      asset_suffix="amd64.AppImage"
    fi
  else
    # aarch64: AppImage only for now (no .deb/.rpm published for arm64).
    pkg_mode="appimage"
    asset_suffix="aarch64.AppImage"
  fi

  local url
  url="$(asset_url_from_json "$json" "$asset_suffix")"
  [ -n "$url" ] || die "No matching Linux asset (*${asset_suffix}) in release ${version}"

  local asset_name
  asset_name="$(basename "$url")"

  local tmpdir
  tmpdir="$(mktemp -d -t blade-install.XXXXXX)"
  trap 'rm -rf "$tmpdir"' EXIT

  local pkg_file="${tmpdir}/${asset_name}"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] Would download ${url} -> ${pkg_file}"
    log "[dry-run] Would install via ${pkg_mode}"
    return 0
  fi

  download_with_fallback "$url" "$version" "$asset_name" "$pkg_file"
  verify_checksum "$pkg_file" "$url" "$json"

  case "$pkg_mode" in
    deb)
      log "${mode} BLADE via dpkg..."
      if [ "$(id -u)" -eq 0 ]; then
        dpkg -i "$pkg_file" || apt-get install -f -y
      else
        sudo dpkg -i "$pkg_file" || sudo apt-get install -f -y
      fi
      ;;
    rpm)
      log "${mode} BLADE via rpm..."
      if [ "$(id -u)" -eq 0 ]; then
        rpm -U --force "$pkg_file"
      else
        sudo rpm -U --force "$pkg_file"
      fi
      ;;
    appimage)
      log "${mode} BLADE as AppImage..."
      mkdir -p "$HOME/.local/bin"
      cp "$pkg_file" "$HOME/.local/bin/blade"
      chmod +x "$HOME/.local/bin/blade"
      ok "Installed to ~/.local/bin/blade"
      case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) warn "~/.local/bin is not in your PATH. Add it to use \`blade\` from any shell." ;;
      esac
      ;;
  esac

  ok "${mode} complete — launching BLADE..."
  if command -v blade >/dev/null 2>&1; then
    nohup blade >/dev/null 2>&1 &
  elif [ -x "$HOME/.local/bin/blade" ]; then
    nohup "$HOME/.local/bin/blade" >/dev/null 2>&1 &
  else
    warn "Couldn't auto-launch BLADE. Start it from your applications menu."
  fi
}

# --- main ---------------------------------------------------------------------
main() {
  local os arch json version mode

  os="$(detect_os)"
  arch="$(detect_arch "$os")"

  log "OS: ${os}  Arch: ${arch}"

  # Upgrade detection — runs BEFORE any download so the banner is accurate.
  mode="Installing"
  case "$os" in
    macos)
      [ -d "/Applications/Blade.app" ] && mode="Upgrading"
      ;;
    linux)
      if [ -x "$HOME/.local/bin/blade" ] || command -v blade >/dev/null 2>&1; then
        mode="Upgrading"
      fi
      ;;
  esac
  log "${mode} BLADE (user data in ~/.blade preserved)."

  log "Fetching latest release manifest..."
  json="$(fetch_release_json)" || die "Could not reach GitHub Releases API."
  version="$(release_tag_from_json "$json")"
  [ -n "$version" ] || die "Could not parse release tag from API response."
  log "Target version: ${version}"

  case "$os" in
    macos) install_macos "$arch" "$version" "$json" "$mode" ;;
    linux) install_linux "$arch" "$version" "$json" "$mode" ;;
  esac

  printf "\n%s%s BLADE %s installed.%s\n" "$C_GREEN" "$C_BOLD" "$version" "$C_RESET"
  printf "%s   Docs:%s  https://github.com/%s\n" "$C_DIM" "$C_RESET" "$GITHUB_REPO"
  printf "%s   Data:%s  ~/.blade (untouched on upgrade)\n\n" "$C_DIM" "$C_RESET"
}

main "$@"
