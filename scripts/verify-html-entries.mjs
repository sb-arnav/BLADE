#!/usr/bin/env node
// scripts/verify-html-entries.mjs (WIN-09)
//
// Post-build check: asserts all 5 HTML files present in dist/. Run AFTER
// `npm run build` (Vite) to catch any rollup input that silently dropped.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-43
// @see .planning/REQUIREMENTS.md §WIN-09

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED = [
  'index.html',
  'quickask.html',
  'overlay.html',
  'hud.html',
  'ghost_overlay.html',
];

let failed = false;
for (const name of EXPECTED) {
  const full = resolve(ROOT, 'dist', name);
  if (!existsSync(full)) {
    console.error(`[verify-html-entries] MISSING in dist/: ${name}`);
    failed = true;
  } else {
    console.log(`[verify-html-entries]   OK: dist/${name}`);
  }
}

if (failed) {
  console.error('[verify-html-entries] FAIL: one or more HTML files absent from dist/');
  process.exit(1);
}

console.log(`[verify-html-entries] OK — all ${EXPECTED.length} HTML entries in dist/`);
