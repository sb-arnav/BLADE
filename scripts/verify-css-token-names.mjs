#!/usr/bin/env node
// scripts/verify-css-token-names.mjs — v1.3 (2026-04-28).
//
// Catches the v1.1 retraction bug class: CSS files referencing var(--name)
// where --name has never been declared anywhere. Every such reference
// resolves to the empty string at runtime, collapsing whatever property
// uses it (gap → 0, padding → 0, color → unset). The v1.1 cascade was 210
// such ghosts across 9 files (--space-N, --glass-fill, --accent, --r-card,
// --fs-display, --font-sans, etc.) — invisible until you opened the app.
//
// Algorithm:
//   1. Walk src/ for .css and .tsx files.
//   2. Build the "declared" set from:
//        - `--name:` declarations in any .css file (covers global tokens.css
//          and locally-scoped declarations like `.orb { --orb-size: 60px }`)
//        - `@property --name` blocks
//        - React inline custom props: `style={{ '--name': value }}` in .tsx
//   3. Walk every var(--name) reference. Flag any name not in the declared set.
//
// Fallback form `var(--name, <fallback>)` is intentionally NOT matched — the
// fallback is the legitimate escape hatch when a token is set at runtime
// (inline style, @property, parent's CSS var). The regex requires `)` to
// immediately follow the name, so the fallback form is automatically excluded.
//
// Exit: 0 on pass, 1 with per-token diagnostics on any violation.
// Runtime: ~80ms (walks ~250 files).

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

// Declarations.
const CSS_DECLARE_RE = /--([a-zA-Z][\w-]*)\s*:/g;
const CSS_PROPERTY_RE = /@property\s+--([a-zA-Z][\w-]*)/g;
const REACT_INLINE_DECLARE_RE = /['"]--([a-zA-Z][\w-]*)['"]\s*:/g;

const declared = new Set();
for (const file of FILES) {
  const src = readFileSync(file, 'utf8');
  if (file.endsWith('.css')) {
    for (const m of src.matchAll(CSS_DECLARE_RE)) declared.add(m[1]);
    for (const m of src.matchAll(CSS_PROPERTY_RE)) declared.add(m[1]);
  } else if (file.endsWith('.tsx')) {
    for (const m of src.matchAll(REACT_INLINE_DECLARE_RE)) declared.add(m[1]);
    // Also pick up `--name:` inside template-string / styled-component blocks.
    for (const m of src.matchAll(CSS_DECLARE_RE)) declared.add(m[1]);
  }
}

// References. Closing paren immediately after the name → no fallback form.
const USE_RE = /var\(--([a-zA-Z][\w-]*)\)/g;

// Strip /* ... */ block comments and // line comments before scanning so
// JSDoc/inline references like "via var(--x)" in a comment don't false-fail.
// Preserves line numbers by replacing each comment with the same number of
// newlines as the original.
function stripComments(src) {
  // Block comments — keep newlines so reported line numbers stay accurate.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, ' '),
  );
  // Line comments (TS/JS only — safe in CSS too because `//` doesn't appear
  // mid-rule legitimately). Strips from `//` to end-of-line.
  out = out.replace(/\/\/.*/g, (m) => m.replace(/[^\n]/g, ' '));
  return out;
}

const violations = [];
for (const file of FILES) {
  const raw = readFileSync(file, 'utf8');
  const src = stripComments(raw);
  const lines = src.split('\n');
  const rawLines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(USE_RE)) {
      const name = m[1];
      if (!declared.has(name)) {
        violations.push({ file, line: i + 1, name, snippet: rawLines[i].trim() });
      }
    }
  }
}

if (violations.length > 0) {
  console.error(
    `[verify-css-token-names] FAIL — ${violations.length} reference(s) to undeclared CSS tokens:`,
  );
  const byName = new Map();
  for (const v of violations) {
    if (!byName.has(v.name)) byName.set(v.name, []);
    byName.get(v.name).push(v);
  }
  const sorted = [...byName].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, refs] of sorted) {
    console.error(`\n  ✗ var(--${name})  (${refs.length} ref${refs.length === 1 ? '' : 's'})`);
    for (const r of refs.slice(0, 5)) {
      console.error(`      ${r.file}:${r.line}`);
    }
    if (refs.length > 5) console.error(`      … +${refs.length - 5} more`);
  }
  console.error('');
  console.error('Each var(--x) above resolves to the empty string at runtime,');
  console.error('collapsing whatever property uses it (gap, padding, color, etc).');
  console.error('');
  console.error('Fix options:');
  console.error('  1. Rebind to an existing token from src/styles/tokens.css');
  console.error('  2. Add the missing token to tokens.css if it deserves a name');
  console.error('  3. Use the fallback form var(--name, <fallback>) if the token');
  console.error('     is set at runtime via inline style or @property');
  process.exit(1);
}

console.log(
  `[verify-css-token-names] OK — ${FILES.length} files scanned, ${declared.size} tokens declared, all var(--x) names reachable.`,
);
