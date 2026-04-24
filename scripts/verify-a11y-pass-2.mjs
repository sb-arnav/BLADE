#!/usr/bin/env node
// scripts/verify-a11y-pass-2.mjs
//
// Phase 14 Plan 14-01 (A11Y2-06).
// A11y gate for Phase 14 activity-log files. Checks:
//   Rule 1: dialog elements must use Dialog primitive OR contain 'inert'
//   Rule 2: icon-only buttons must have aria-label
//   Rule 3: CSS transitions/transforms must be inside prefers-reduced-motion block
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

// Phase 14 scope: activity-log directory + any tsx file importing from it
const activityLogDir = path.join(ROOT, 'src/features/activity-log');
const tsxFiles = walkDir(activityLogDir, ['.tsx']);
const cssFiles = walkDir(activityLogDir, ['.css']);

// Also check MainShell for ActivityStrip mount (imports from activity-log)
const mainShellPath = path.join(ROOT, 'src/windows/main/MainShell.tsx');
if (fs.existsSync(mainShellPath)) {
  const content = fs.readFileSync(mainShellPath, 'utf8');
  if (content.includes('@/features/activity-log') && !tsxFiles.includes(mainShellPath)) {
    tsxFiles.push(mainShellPath);
  }
}

// ── Violations collector ───────────────────────────────────────────────────

const violations = [];

function addViolation(rule, file, line, message) {
  violations.push({ rule, file: path.relative(ROOT, file), line, message });
}

// ── Rule 1: dialog elements must use Dialog primitive OR have inert ────────

for (const f of tsxFiles) {
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  const usesDialogPrimitive = lines.some((l) =>
    l.includes("from '@/design-system/primitives'") && l.includes('Dialog')
    || l.includes("from '@/design-system/primitives/Dialog'")
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
          'dialog element found without Dialog primitive import or inert attribute'
        );
      }
    }
  }
}

// ── Rule 2: icon-only buttons must have aria-label ─────────────────────────

for (const f of tsxFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const lines = content.split('\n');

  // Find <button elements that contain only SVG children (no visible text)
  // Simple heuristic: <button without aria-label that contains <svg or icon imports
  // We look for multi-line button blocks
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
        const hasVisibleText = />[^<{]*[a-zA-Z][^<{]*<\//.test(buttonContent.replace(/<[^>]+>/g, ' '));
        const hasSvg = /<svg/.test(buttonContent);
        // If button has SVG and no visible text and no aria-label → violation
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

for (const f of cssFiles) {
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
      // Check for unconditional transition: or animation: declarations
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
