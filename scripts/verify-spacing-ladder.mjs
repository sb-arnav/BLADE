#!/usr/bin/env node
// scripts/verify-spacing-ladder.mjs
//
// Phase 15 Plan 15-01 (DENSITY-01 / DENSITY-06).
//
// Enforces the canonical spacing ladder documented in
// `.planning/phases/15-density-polish/SPACING-LADDER.md`.
//
// Rule: every layout-position `padding`, `margin` (except 0 / auto),
// `gap`, `row-gap`, `column-gap`, `grid-gap` declaration in feature /
// design-system / styles CSS MUST resolve through `var(--s-*)` tokens
// OR match the documented whitelist of sub-token micro-padding +
// chip/pill micro-padding selectors.
//
// Scope: src/features/**/*.css, src/design-system/**/*.css,
// src/styles/**/*.css EXCLUDING tokens.css + layout.css (they DEFINE
// the scale).
//
// Exit: 0 on pass, 1 on any violation.
// Runtime: ~50ms walking ~200 CSS files.
//
// First-run failure is EXPECTED — the violation count defines the
// backlog that Plans 15-02..15-04 close against.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── File discovery ────────────────────────────────────────────────────────

function walkDir(dir, exts, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, exts, results);
    } else if (entry.isFile() && exts.some((e) => full.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

const cssFiles = [];
walkDir(path.join(ROOT, 'src/features'), ['.css'], cssFiles);
walkDir(path.join(ROOT, 'src/design-system'), ['.css'], cssFiles);

// src/styles/*.css, EXCLUDING tokens.css + layout.css (which DEFINE the scale).
const stylesDir = path.join(ROOT, 'src/styles');
if (fs.existsSync(stylesDir)) {
  for (const entry of fs.readdirSync(stylesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.css')) continue;
    if (entry.name === 'tokens.css' || entry.name === 'layout.css') continue;
    cssFiles.push(path.join(stylesDir, entry.name));
  }
}

// Deduplicate (defensive — shouldn't happen with disjoint walks above).
const seen = new Set();
const uniqueCssFiles = cssFiles.filter((f) => {
  if (seen.has(f)) return false;
  seen.add(f);
  return true;
});

// ── Whitelists ────────────────────────────────────────────────────────────

// Always-allowed values — matched after trimming and stripping a trailing `;`.
const VALUE_WHITELIST = new Set([
  '0',
  '1px',
  '2px',
  '3px',
  '0 0',
  '0 1px',
  '0 2px',
  '0 6px',
  '0 10px',
  '0 12px',
]);

// Chip / pill micro-padding values — allowed ONLY on matching selectors.
const CHIP_WHITELIST_VALUES = new Set([
  '3px 10px',
  '4px 10px',
  '4px 12px',
  '6px 10px',
  '6px 12px',
  '8px 12px',
  '8px 14px',
  '8px 16px',
  '10px 14px',
  '10px 12px',
  '12px 16px',
  '2px 6px',
  '1px 4px',
  '1px 6px',
]);

const CHIP_SELECTOR_RE =
  /\.(chip|pill|badge|status|tlight|titlebar-traffic|tlight-|hormone-chip|dash-hero-state|dash-hero-chip|titlebar-status|titlebar-hint|coming-soon-card|voice-orb-window)/;

// Scrollbar / traffic-light — any scrollbar pseudo or tlight selector gets
// a blanket pass on small pixel padding (the token ladder is the wrong tool
// for UA-controlled scrollbar widgets + macOS traffic-light alignment).
const SCROLLBAR_SELECTOR_RE =
  /(::?-webkit-scrollbar|\.tlight|\.titlebar-traffic)/;

// Layout-position properties we enforce.
const PROP_RE =
  /^\s*(padding|padding-top|padding-bottom|padding-left|padding-right|margin|margin-top|margin-bottom|margin-left|margin-right|gap|row-gap|column-gap|grid-gap)\s*:\s*([^;]+?)\s*;?\s*$/;

// ── Violations collector ──────────────────────────────────────────────────

const violations = [];

function addViolation(file, line, selector, property, value) {
  violations.push({
    file: path.relative(ROOT, file),
    line,
    selector,
    property,
    value,
  });
}

// ── Per-file parse ────────────────────────────────────────────────────────

for (const f of uniqueCssFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  // Selector stack — track nested selectors (media queries, supports blocks).
  // Push on `{`, pop on `}`. Current selector is the top of the stack whose
  // text is NOT an at-rule. This is approximate but good enough for CSS
  // without @scope / @nest.
  const stack = [];
  let pendingSelector = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // Strip line comments (CSS has /* */ block comments; handled coarsely).
    const line = raw.replace(/\/\*[^*]*\*+(?:[^/*][^*]*\*+)*\//g, '');

    // Accumulate selector text until we see `{`.
    // When a line contains `{`, treat everything before it (plus any
    // pendingSelector accumulator) as the selector string.
    const openIdx = line.indexOf('{');
    const closeIdx = line.indexOf('}');

    if (openIdx !== -1 && (closeIdx === -1 || closeIdx > openIdx)) {
      const selectorText = (pendingSelector + ' ' + line.slice(0, openIdx))
        .trim()
        .replace(/\s+/g, ' ');
      stack.push(selectorText);
      pendingSelector = '';
    } else if (closeIdx !== -1 && openIdx === -1) {
      if (stack.length > 0) stack.pop();
      pendingSelector = '';
    } else if (openIdx === -1 && closeIdx === -1) {
      // Could be a declaration OR a continuation of a selector.
      // Heuristic: if the line has `:` WITHOUT a trailing `,` AND we are
      // inside a block (stack non-empty), treat it as a declaration.
      // Otherwise, accumulate as part of the next selector.
      const isDeclaration = stack.length > 0 && /^\s*[a-zA-Z-]+\s*:/.test(line);
      if (!isDeclaration && line.trim() !== '') {
        pendingSelector = (pendingSelector + ' ' + line).trim();
      }
    }

    // Check this line for a violation regardless of selector-tracking shape.
    if (stack.length === 0) continue;

    const m = line.match(PROP_RE);
    if (!m) continue;

    const property = m[1];
    const value = m[2].trim();

    // Composite token use — always pass.
    if (value.includes('var(--')) continue;

    // calc() with var(--...) inside — composite token math, pass.
    if (/calc\([^)]*var\(--/.test(value)) continue;

    // margin: 0 / auto / 0 auto / auto 0 — layout primitives, not spacing.
    if (property.startsWith('margin')) {
      if (/^(0|auto|0\s+auto|auto\s+0|0\s+0|auto\s+auto)$/.test(value)) continue;
    }

    // Current selector — rightmost non-at-rule in the stack.
    const currentSelector =
      [...stack]
        .reverse()
        .find((s) => !s.startsWith('@')) || '';

    // Scrollbar + traffic-light blanket pass for small pixel values.
    if (SCROLLBAR_SELECTOR_RE.test(currentSelector)) continue;

    // Always-allowed literal values.
    if (VALUE_WHITELIST.has(value)) continue;

    // Chip-scoped whitelist.
    if (
      CHIP_WHITELIST_VALUES.has(value) &&
      CHIP_SELECTOR_RE.test(currentSelector)
    ) {
      continue;
    }

    // Value contains px or rem AND isn't inside a var() — violation.
    if (/\d/.test(value) && /(px|rem)/.test(value)) {
      addViolation(f, i + 1, currentSelector, property, value);
      continue;
    }

    // Value is a bare number > 0 (like `margin: 4`) — violation.
    if (/^\d+$/.test(value) && value !== '0') {
      addViolation(f, i + 1, currentSelector, property, value);
    }
  }
}

// ── Report ────────────────────────────────────────────────────────────────

console.log(
  `[verify:spacing-ladder] Scanned ${uniqueCssFiles.length} files across src/features, src/design-system, src/styles`
);

if (violations.length === 0) {
  console.log('[verify:spacing-ladder] PASS — 0 off-ladder layout spacing values');
  process.exit(0);
}

console.error(
  `[verify:spacing-ladder] FAIL — ${violations.length} violation(s):`
);
for (const v of violations) {
  console.error(
    `  ${v.file}:${v.line} — ${v.selector || '(no selector)'} { ${v.property}: ${v.value}; } — not in spacing ladder or whitelist`
  );
}
process.exit(1);
