#!/usr/bin/env node
// scripts/verify-a11y-pass-2.mjs
//
// Phase 14 Plan 14-04 (A11Y2-06) — hardened production gate.
// A11y gate for ALL Phase 14 surfaces. Checks:
//   Rule 1: role="dialog" or <dialog elements must use Dialog primitive
//           OR have inert attribute (focus trap enforcement)
//   Rule 2: icon-only buttons must have aria-label
//   Rule 3: CSS transitions/transforms in Phase 14 CSS files must be
//           inside @media (prefers-reduced-motion: no-preference)
//
// Phase 14 scope:
//   TSX: src/features/activity-log/**/*.tsx + src/windows/main/MainShell.tsx
//        (if it imports activity-log)
//        + src/features/dashboard/**/*.tsx (WIRE2 dashboard additions)
//        + src/features/settings/panes/*.tsx (Phase 14 settings additions)
//   CSS: src/features/activity-log/**/*.css + src/features/dashboard/**/*.css
//
// Exit 0 = PASS (no violations)
// Exit 1 = FAIL (violations listed)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── File discovery ─────────────────────────────────────────────────────────

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

// TSX scope: activity-log + dashboard + settings panes (all Phase 14 surfaces)
const tsxFiles = [];
const cssFiles = [];

// Core activity-log directory
const activityLogDir = path.join(ROOT, 'src/features/activity-log');
walkDir(activityLogDir, ['.tsx'], tsxFiles);
walkDir(activityLogDir, ['.css'], cssFiles);

// Dashboard (Phase 14 WIRE2 additions)
const dashboardDir = path.join(ROOT, 'src/features/dashboard');
walkDir(dashboardDir, ['.tsx'], tsxFiles);
walkDir(dashboardDir, ['.css'], cssFiles);

// Settings panes (Phase 14 config-control additions)
const settingsPanesDir = path.join(ROOT, 'src/features/settings/panes');
walkDir(settingsPanesDir, ['.tsx'], tsxFiles);
walkDir(settingsPanesDir, ['.css'], cssFiles);

// MainShell.tsx — only if it imports from activity-log
const mainShellPath = path.join(ROOT, 'src/windows/main/MainShell.tsx');
if (fs.existsSync(mainShellPath)) {
  const content = fs.readFileSync(mainShellPath, 'utf8');
  if (content.includes('@/features/activity-log') && !tsxFiles.includes(mainShellPath)) {
    tsxFiles.push(mainShellPath);
  }
}

// Deduplicate
const seenTsx = new Set();
const uniqueTsxFiles = tsxFiles.filter((f) => {
  if (seenTsx.has(f)) return false;
  seenTsx.add(f);
  return true;
});

const seenCss = new Set();
const uniqueCssFiles = cssFiles.filter((f) => {
  if (seenCss.has(f)) return false;
  seenCss.add(f);
  return true;
});

// ── Violations collector ───────────────────────────────────────────────────

const violations = [];

function addViolation(rule, file, line, message) {
  violations.push({ rule, file: path.relative(ROOT, file), line, message });
}

// ── Rule 1: dialog elements must use Dialog primitive OR have inert ────────
// Any file with role="dialog" or raw <dialog element MUST either:
//   a) Import Dialog from '@/design-system/primitives' (which uses native showModal
//      that provides browser-native focus trap in WebView2), OR
//   b) Have an inert attribute on background content to establish focus containment

for (const f of uniqueTsxFiles) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const usesDialogPrimitive = lines.some(
    (l) =>
      (l.includes("from '@/design-system/primitives'") && l.includes('Dialog')) ||
      l.includes("from '@/design-system/primitives/Dialog'")
  );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for raw <dialog elements (not the Dialog component, which is capitalized)
    if (/<dialog[\s>]/.test(line) || /role=["']dialog["']/.test(line)) {
      if (!usesDialogPrimitive && !line.includes('inert')) {
        addViolation(
          'Rule 1',
          f,
          i + 1,
          'dialog element found without Dialog primitive import or inert attribute — focus trap required'
        );
      }
    }
  }
}

// ── Rule 2: icon-only buttons must have aria-label ─────────────────────────
// Heuristic: <button> that contains SVG and no visible text must have aria-label.

for (const f of uniqueTsxFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  let inButton = false;
  let buttonStart = 0;
  let buttonContent = '';
  let hasAriaLabel = false;
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inButton && /<button[\s>]/.test(line)) {
      inButton = true;
      buttonStart = i + 1;
      buttonContent = line;
      hasAriaLabel = /aria-label/.test(line);
      depth = (line.match(/<button/g) || []).length - (line.match(/<\/button>/g) || []).length;
      if (depth <= 0) {
        // Single-line button — check inline
        const hasText = />[^<{]+[a-zA-Z][^<{]*<\/button>/.test(line);
        const hasSvgOnly = /<svg/.test(line) && !hasText;
        if (hasSvgOnly && !hasAriaLabel) {
          addViolation('Rule 2', f, i + 1, 'icon-only button missing aria-label');
        }
        inButton = false;
        buttonContent = '';
      }
      continue;
    }

    if (inButton) {
      buttonContent += '\n' + line;
      if (/aria-label/.test(line)) hasAriaLabel = true;
      depth += (line.match(/<button/g) || []).length;
      depth -= (line.match(/<\/button>/g) || []).length;

      if (depth <= 0) {
        // End of button block
        const hasVisibleText = />[^<{]*[a-zA-Z][^<{]*<\//.test(
          buttonContent.replace(/<[^>]+>/g, ' ')
        );
        const hasSvg = /<svg/.test(buttonContent);
        if (hasSvg && !hasVisibleText && !hasAriaLabel) {
          addViolation('Rule 2', f, buttonStart, 'icon-only button missing aria-label');
        }
        inButton = false;
        buttonContent = '';
        hasAriaLabel = false;
        depth = 0;
      }
    }
  }
}

// ── Rule 3: CSS transitions/transforms must be inside prefers-reduced-motion
// Checks all CSS files in Phase 14 scope.

for (const f of uniqueCssFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');
  let insideReducedMotion = false;
  let mediaDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('prefers-reduced-motion')) {
      insideReducedMotion = true;
      mediaDepth = 0;
    }
    if (insideReducedMotion) {
      mediaDepth += (line.match(/\{/g) || []).length;
      mediaDepth -= (line.match(/\}/g) || []).length;
      if (mediaDepth <= 0 && (line.includes('}') || mediaDepth < 0)) {
        insideReducedMotion = false;
        mediaDepth = 0;
        continue;
      }
    }

    if (!insideReducedMotion) {
      if (/^\s*transition\s*:/.test(line) || /^\s*animation\s*:/.test(line)) {
        addViolation(
          'Rule 3',
          f,
          i + 1,
          `Unconditional CSS motion property outside @media (prefers-reduced-motion: no-preference): "${line.trim()}"`
        );
      }
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log(
  `[verify:a11y-pass-2] Scanned ${uniqueTsxFiles.length} TSX files, ${uniqueCssFiles.length} CSS files across Phase 14 surfaces`
);

if (violations.length === 0) {
  console.log('[verify:a11y-pass-2] PASS — no a11y violations found');
  process.exit(0);
} else {
  console.error(`[verify:a11y-pass-2] FAIL — ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line} — ${v.message}`);
  }
  process.exit(1);
}
