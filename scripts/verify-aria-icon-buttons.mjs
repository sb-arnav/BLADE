#!/usr/bin/env node
// scripts/verify-aria-icon-buttons.mjs — Phase 9 Plan 09-06 (POL-06).
//
// Regression guard for a11y icon-only button audit. Walks src/ for .tsx files
// and flags any <button> whose visible content is a single non-semantic glyph
// (×, ✕, ✗, ←, →, ↑, ↓, ⋯) without an aria-label attribute on the same tag.
//
// Why: screen readers cannot narrate a pure emoji/glyph; every icon-only
// button MUST carry an accessible name via aria-label (WCAG 2.1 §4.1.2).
// Plan 09-03 Task 1 audited + fixed existing violations; this script keeps
// that guarantee defensively.
//
// Scope: src/features/**, src/design-system/**, src/windows/** — every .tsx
// under src/. Excludes tests/ and scripts/ (non-product code).
//
// Exit: 0 on pass, 1 on any violations with per-line diagnostics.
// Runtime: ~50ms (walks ~200 .tsx files).
//
// @see .planning/phases/09-polish/09-PATTERNS.md §6
// @see .planning/phases/09-polish/09-CONTEXT.md §D-216

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const FILES = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.tsx')) FILES.push(path);
  }
}
walk(ROOT);

// Single-glyph icon-only button content. Double-escape the unicode class so
// the regex matches exactly one of the listed glyphs (no surrounding text).
const ICON_ONLY = /<button[^>]*>\s*([×✕✗←→↑↓⋯])\s*<\/button>/g;

let violations = 0;
const hits = [];

for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  for (const match of src.matchAll(ICON_ONLY)) {
    // If the opening tag already carries an aria-label, accept.
    if (!/aria-label\s*=/.test(match[0])) {
      hits.push({ file, snippet: match[0] });
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`[verify-aria-icon-buttons] FAIL — ${violations} icon-only button(s) missing aria-label:`);
  for (const h of hits) console.error(`  ${h.file}: ${h.snippet.replace(/\s+/g, ' ')}`);
  process.exit(1);
}

console.log(`[verify-aria-icon-buttons] OK — scanned ${FILES.length} .tsx files; no violations.`);
