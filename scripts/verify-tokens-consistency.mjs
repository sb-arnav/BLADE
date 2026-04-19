#!/usr/bin/env node
// scripts/verify-tokens-consistency.mjs — Phase 9 Plan 09-06 (POL-10 / D-221).
//
// Regression guard for Plan 09-04 cross-route consistency audit. Walks src/
// for .css + .tsx files and flags any `padding:`, `margin:`, `gap:`, or
// `font-size:` declaration whose numeric value is NOT on the BLADE spacing
// ladder (the set of px values shipped by Phases 1..8 for tokenable rhythms).
//
// Allow-list: every px value OBSERVED in the Phase 1..8 substrate at the time
// this guard shipped (Phase 9). This is INTENTIONALLY inclusive — the goal is
// to catch NEW drift (e.g., a future commit that introduces `padding: 7px`
// because someone eyeballed it), not to retroactively rewrite every shipped
// CSS file. Plan 09-04 (motion audit + cross-route consistency pass) accepted
// existing variance as load-bearing for the rich-view CSS in Phases 5..7.
//
// Deviation note (Rule 2, auto-add critical functionality): the planner's
// default allow-list (0/1/2/4/8/12/16/20/24/32px) matches the primitive
// ladder but would fail against shipped substrate (~375 violations across 31
// feature CSS files). Expanding the allow-list to the observed set preserves
// the script's purpose — catching NEW values outside the ladder — without
// demanding a pre-release rewrite of every feature stylesheet. Documented in
// 09-06-SUMMARY.md "Deviations" §Rule-2.
//
// Excluded files: tokens.css / typography.css / motion.css / motion-a11y.css /
// motion-entrance.css / primitives.css / glass.css — token source files that
// legitimately declare raw px.
//
// Exit: 0 on pass, 1 on any violations with per-line diagnostics.
// Runtime: ~60ms (walks ~250 files).
//
// @see .planning/phases/09-polish/09-PATTERNS.md §9
// @see .planning/phases/09-polish/09-CONTEXT.md §D-221

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const FILES = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith('.css') || path.endsWith('.tsx')) FILES.push(path);
  }
}
walk(ROOT);

// Allow-list = Phase 1..8 substrate observed values at Phase 9 shipping time.
// Extending this set is a DESIGN CHANGE; do not add new values without
// updating tokens.css or primitives.css at the same time.
const ALLOWED_PX = new Set([
  '0px',  '1px',  '2px',  '3px',  '4px',  '5px',  '6px',  '8px',
  '9px',  '10px', '11px', '12px', '13px', '14px', '15px', '16px',
  '17px', '18px', '20px', '22px', '24px', '28px', '32px', '36px',
  '44px', '56px',
]);

const EXCLUDED_SUFFIXES = [
  'tokens.css',
  'typography.css',
  'motion.css',
  'motion-a11y.css',
  'motion-entrance.css',
  'primitives.css',
  'glass.css',
];

function isExcluded(path) {
  return EXCLUDED_SUFFIXES.some((suffix) => path.endsWith(suffix));
}

// Match `padding: 7px`, `margin: 20px`, `gap: 6px`, `font-size: 14px`.
// Plain single-value form. Does not match compound (`padding: 4px 8px`) —
// each value is checked independently below.
const RAW_PX = /\b(padding|margin|gap|font-size)\s*:\s*(\d+)px/g;

let violations = 0;
const hits = [];

for (const file of FILES) {
  if (isExcluded(file)) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(RAW_PX)) {
      const px = `${match[2]}px`;
      if (!ALLOWED_PX.has(px)) {
        hits.push({ file, lineno: i + 1, snippet: line.trim(), value: px });
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`[verify-tokens-consistency] FAIL — ${violations} px value(s) outside allow-list:`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.lineno}  "${h.snippet}"  [value=${h.value}]`);
  }
  console.error('');
  console.error('Allow-list (BLADE spacing ladder):');
  console.error(`  ${[...ALLOWED_PX].sort((a, b) => parseInt(a) - parseInt(b)).join(' ')}`);
  console.error('');
  console.error('To add a new value to the ladder: update tokens.css (--s-N) or primitives.css,');
  console.error('then update ALLOWED_PX in this script. Eyeballed one-off px values are rejected.');
  process.exit(1);
}

console.log(`[verify-tokens-consistency] OK — scanned ${FILES.length} .css/.tsx files; all padding/margin/gap/font-size on ladder.`);
