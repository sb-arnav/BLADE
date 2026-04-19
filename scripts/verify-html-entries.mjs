#!/usr/bin/env node
// scripts/verify-html-entries.mjs (WIN-09 + Phase 9 D-226)
//
// Asserts all 5 HTML window entries are present.
//
// Modes:
//   - Default (dev mode): checks the root-level HTML files that Vite consumes
//     as rollupOptions.input entries (the source of truth). Safe to run
//     anytime — no build required.
//   - --prod: checks the `dist/` HTML files emitted by `npm run tauri build`.
//     Only meaningful AFTER a successful Vite build; will fail cleanly if
//     `dist/` does not exist.
//
// Phase 9 Plan 09-05 (D-226) SC-1 falsifier: --prod flag verifies that the
// production bundle produces all 5 HTML entries. Mac-smoke M-44 runs this
// after `npm run tauri build` on macOS.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-43
// @see .planning/phases/09-polish/09-CONTEXT.md §D-226
// @see .planning/REQUIREMENTS.md §WIN-09

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const prodMode = process.argv.includes('--prod');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = prodMode ? resolve(REPO_ROOT, 'dist') : REPO_ROOT;
const LABEL = prodMode ? '[prod dist]' : '[dev root]';
const EXPECTED = [
  'index.html',
  'quickask.html',
  'overlay.html',
  'hud.html',
  'ghost_overlay.html',
];

if (prodMode && !existsSync(ROOT)) {
  console.error(`[verify-html-entries] FAIL: dist/ not found (run \`npm run tauri build\` first)`);
  process.exit(1);
}

let failed = false;
const missing = [];
for (const name of EXPECTED) {
  const full = resolve(ROOT, name);
  if (!existsSync(full)) {
    console.error(`[verify-html-entries] ${LABEL} MISSING: ${name}`);
    missing.push(name);
    failed = true;
  } else {
    const rel = prodMode ? `dist/${name}` : name;
    console.log(`[verify-html-entries]   OK: ${rel}`);
  }
}

if (failed) {
  console.error(`[verify-html-entries] FAIL: ${LABEL} missing: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`[verify-html-entries] OK — all ${EXPECTED.length} HTML entries present ${LABEL}`);
