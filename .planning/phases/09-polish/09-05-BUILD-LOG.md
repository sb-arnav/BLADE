# Plan 09-05 — Prod Build Attempt Log

**Date:** 2026-04-18
**Host:** Linux WSL2 sandbox (Ubuntu x86_64)
**Attempt:** 1

## Attempt 1 — Frontend Vite build (SC-1 partial falsifier, sandbox-reachable)

**Command:** `npm run build`
**Outcome:** SUCCESS
**Duration:** ~5.8 seconds

**Output tail:**
```
dist/assets/index-DTqJIRmQ.js                 198.27 kB │ gzip: 62.85 kB
✓ built in 5.84s
```

**Verify-html-entries check:**
```
$ npm run verify:prod-entries
[verify-html-entries]   OK: dist/index.html
[verify-html-entries]   OK: dist/quickask.html
[verify-html-entries]   OK: dist/overlay.html
[verify-html-entries]   OK: dist/hud.html
[verify-html-entries]   OK: dist/ghost_overlay.html
[verify-html-entries] OK — all 5 HTML entries present [prod dist]
EXIT=0
```

All 5 HTML window entries emit correctly from the Vite rollupOptions.input
configuration — POL-01 / SC-1 frontend bundle falsifier PASSED.

## Attempt 2 — Full Tauri build (not attempted in sandbox)

**Command:** `npm run tauri build`
**Outcome:** NOT ATTEMPTED — deferred to Mac-smoke M-44

**Rationale:**
- CLAUDE.md notes: "Don't run cargo check after every small edit — it takes
  1-2 min." Full `tauri build` cross-compiles Rust + bundles = 5-15 minutes.
- The Linux sandbox can produce `.AppImage`/`.deb` but NOT the macOS `.app`/`.dmg`
  that is the target V1 artifact.
- D-226 policy: "Mac-smoke M-44 is the authoritative check." Sandbox failure
  MUST NOT block plan completion.
- The frontend build (Attempt 1) is the portion of Tauri build that produces
  the HTML entries — which is what SC-1 actually requires. The Rust bundle
  step only wraps the already-emitted frontend dist/ into a platform binary;
  it does NOT further manipulate HTML entries. Therefore Attempt 1's OK
  outcome is load-bearing evidence for SC-1.

**Deferred to Mac-smoke M-44:** YES
- M-44 item: "`npm run tauri build` on macOS produces a bundle at
  `src-tauri/target/release/bundle/macos/Blade.app`; launch — confirm all 5
  windows open without Rust panic."
- After M-44 passes, the operator re-runs `npm run verify:prod-entries` on
  the dist/ side of that build to double-confirm.

## Summary

- **SC-1 (frontend HTML entries):** VERIFIED via Attempt 1 + verify:prod-entries.
- **SC-1 (macOS bundle launches):** DEFERRED to Mac-smoke M-44 (operator).
- **Frontend build artifacts:** dist/ present with all 5 entries + JS+CSS bundles.

Plan 09-05 completes without blocking on the Rust bundle step.
