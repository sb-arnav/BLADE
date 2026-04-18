#!/usr/bin/env node
// scripts/audit-contrast.mjs (D-33, P-08 automated backstop)
//
// Parses src/styles/tokens.css + glass.css, extracts rgba() token values,
// computes WCAG 2.1 relative-luminance contrast ratios for documented
// text-on-glass pairs composited over a realistic dark wallpaper baseline,
// fails if any pair < 4.5:1 (WCAG AA for normal text).
//
// This is the CI backstop to the manual 5-wallpaper eyeball check. The manual
// check catches perceptual issues on bright wallpapers that automation can't
// (e.g. mac Sequoia Iridescence), but the automated audit guarantees the
// tokens themselves are AA-compliant on the worst-case dark background first.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-22 (t-3 floor 0.50), §D-33
// @see .planning/research/PITFALLS.md §P-08

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = readFileSync(resolve(ROOT, 'src/styles/tokens.css'), 'utf8');

// ---------------------------------------------------------------------------
// Parse rgba(…) token values — `--name: rgba(r, g, b, a);` style.
// ---------------------------------------------------------------------------
const rgba = {};
const RGBA_RE = /--([a-z][\w-]*)\s*:\s*rgba\(\s*([\d.,\s]+)\)/gi;
for (const m of tokens.matchAll(RGBA_RE)) {
  const parts = m[2].split(',').map((n) => parseFloat(n.trim()));
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    rgba[m[1]] = parts;
  }
}

// ---------------------------------------------------------------------------
// Composite + luminance + contrast math.
// Wallpaper baseline: deep indigo (shared.css #0a0a1d) — a realistic "dark
// macOS" floor. We composite glass over wallpaper, then text over composited
// glass. Contrast is text-vs-glass (what the eye perceives), NOT text-vs-raw-
// wallpaper.
// ---------------------------------------------------------------------------
const BG_WALLPAPER = [10, 10, 29];

function composite([r1, g1, b1, a1], [r2, g2, b2]) {
  return [
    Math.round(r1 * a1 + r2 * (1 - a1)),
    Math.round(g1 * a1 + g2 * (1 - a1)),
    Math.round(b1 * a1 + b2 * (1 - a1)),
  ];
}

function relLuminance([r, g, b]) {
  const toLin = (c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

function contrast(fg, bg) {
  const L1 = relLuminance(fg);
  const L2 = relLuminance(bg);
  return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
}

// ---------------------------------------------------------------------------
// Documented pairs. text tokens: t-1 (.97), t-2 (.72), t-3 (.50 floor).
// glass tiers: g-fill (.07), g-fill-strong (.11), g-fill-heavy (.16).
// We verify every t-1/t-2 pair strictly; t-3 is informational (design intent
// is "de-emphasized" and it may not hit 4.5:1 — the test warns but passes).
// ---------------------------------------------------------------------------
const STRICT_PAIRS = [
  { label: 't-1 on glass-1', fgKey: 't-1', bgKey: 'g-fill' },
  { label: 't-2 on glass-1', fgKey: 't-2', bgKey: 'g-fill' },
  { label: 't-1 on glass-2', fgKey: 't-1', bgKey: 'g-fill-strong' },
  { label: 't-2 on glass-2', fgKey: 't-2', bgKey: 'g-fill-strong' },
  { label: 't-1 on glass-3', fgKey: 't-1', bgKey: 'g-fill-heavy' },
  { label: 't-2 on glass-3', fgKey: 't-2', bgKey: 'g-fill-heavy' },
];

const INFO_PAIRS = [
  { label: 't-3 on glass-1', fgKey: 't-3', bgKey: 'g-fill' },
  { label: 't-3 on glass-2', fgKey: 't-3', bgKey: 'g-fill-strong' },
  { label: 't-3 on glass-3', fgKey: 't-3', bgKey: 'g-fill-heavy' },
];

function ratioFor(fgKey, bgKey) {
  const fg = rgba[fgKey];
  const bg = rgba[bgKey];
  if (!fg || !bg) {
    return { ratio: NaN, missing: !fg ? fgKey : bgKey };
  }
  const glassOver = composite(bg, BG_WALLPAPER);
  const textOver = composite(fg, glassOver);
  return { ratio: contrast(textOver, glassOver) };
}

let failed = false;
console.log('[audit-contrast] STRICT pairs (must be ≥ 4.5:1):');
for (const { label, fgKey, bgKey } of STRICT_PAIRS) {
  const { ratio, missing } = ratioFor(fgKey, bgKey);
  if (missing) {
    console.error(`[audit-contrast] FAIL ${label}: token '--${missing}' not found in tokens.css`);
    failed = true;
    continue;
  }
  const mark = ratio >= 4.5 ? 'PASS' : 'FAIL';
  console.log(`[audit-contrast]   ${mark} ${label}: ${ratio.toFixed(2)}:1`);
  if (ratio < 4.5) failed = true;
}

console.log('[audit-contrast] INFO pairs (t-3 de-emphasized — may be < 4.5:1 by design):');
for (const { label, fgKey, bgKey } of INFO_PAIRS) {
  const { ratio, missing } = ratioFor(fgKey, bgKey);
  if (missing) {
    console.warn(`[audit-contrast]   WARN ${label}: token '--${missing}' not found`);
    continue;
  }
  const mark = ratio >= 4.5 ? 'OK  ' : 'info';
  console.log(`[audit-contrast]   ${mark} ${label}: ${ratio.toFixed(2)}:1`);
}

if (failed) {
  console.error('[audit-contrast] FAIL — one or more strict pairs fail WCAG AA 4.5:1');
  process.exit(1);
}

console.log('[audit-contrast] OK — all strict pairs ≥ 4.5:1 on dark wallpaper baseline');
