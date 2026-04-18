#!/usr/bin/env node
// scripts/verify-entries.mjs (D-31, P-05)
//
// Parses vite.config.ts rollupOptions.input, asserts every declared HTML exists
// on disk. Fails CI before the Vite build step so a missing HTML entry surfaces
// as a clear error rather than a cryptic Rollup failure.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-31, §D-43-vite
// @see .planning/research/PITFALLS.md §P-05

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8');

// Match   key: resolve(__dirname, "path")  — permissive on whitespace / quote style.
const INPUT_RE = /(\w+)\s*:\s*resolve\(\s*__dirname\s*,\s*["']([^"']+)["']\s*\)/g;
const inputs = [...cfg.matchAll(INPUT_RE)].map((m) => ({ key: m[1], path: m[2] }));

if (inputs.length === 0) {
  console.error('[verify-entries] FAIL: could not parse any inputs from vite.config.ts');
  process.exit(1);
}

let failed = false;
for (const { key, path } of inputs) {
  const full = resolve(ROOT, path);
  if (!existsSync(full)) {
    console.error(`[verify-entries] MISSING: ${key} -> ${path}`);
    failed = true;
  } else {
    console.log(`[verify-entries]   OK: ${key} -> ${path}`);
  }
}

if (failed) {
  console.error('[verify-entries] FAIL: one or more declared entries missing on disk');
  process.exit(1);
}

console.log(`[verify-entries] OK — ${inputs.length} entries present on disk`);
