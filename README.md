# Blade

Blade is a Tauri desktop app with a React frontend. It is intended to be distributed as a normal installable desktop app on Windows, macOS, and Linux rather than run from source by end users.

## Local Development

Use Node 20.19+ and npm 10+.

```bash
npm install
npm run dev
```

To run the desktop shell during development:

```bash
npm run tauri dev
```

## Build From Source

Frontend build:

```bash
npm run build
```

Desktop bundle build:

```bash
npm run tauri build
```

The base Tauri config is in `src-tauri/tauri.conf.json`. Release-only updater settings are generated into `src-tauri/tauri.release.conf.json` so local development does not require signing secrets.

## Distribution

Blade is configured to ship installable desktop artifacts for:

- Windows: `nsis`, `msi`
- macOS: `app`, `dmg`
- Linux: `AppImage`, `deb`, `rpm`

Tagged releases are built by GitHub Actions in `.github/workflows/release.yml`.

## Auto Updates

Installed builds use the Tauri updater plugin. The app checks GitHub Releases at:

- `https://github.com/sb-arnav/blade/releases/latest/download/latest.json`

The Settings screen includes a manual update check button. After the first install, users should be able to update from inside the app instead of downloading a fresh installer every time.

## Release Setup

Add these GitHub repository secrets before creating tagged releases:

- `TAURI_UPDATER_PUBKEY`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

`TAURI_UPDATER_PUBKEY` is injected into the release config by:

```bash
npm run release:prepare-updater
```

## Publishing A Release

1. Bump the app version in `package.json` and `src-tauri/tauri.conf.json`.
2. Commit the changes.
3. Create and push a tag like `v0.2.0`.
4. GitHub Actions will build installers for Windows, macOS, and Linux and attach updater metadata to the release.

## Validation

`.github/workflows/build.yml` runs a cross-platform frontend validation pass on pushes and pull requests.
