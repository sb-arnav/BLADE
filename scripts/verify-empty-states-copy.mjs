#!/usr/bin/env node
// scripts/verify-empty-states-copy.mjs
//
// Phase 15 Plan 15-01 (DENSITY-05).
//
// Enforces empty-state copy discipline per
// `.planning/phases/15-density-polish/SPACING-LADDER.md` §Empty-State Copy Rules.
//
// Rule: bare-negation <EmptyState> labels ("No data", "No results",
// "No recent X", "No X yet", "Nothing yet", "Nothing here") FAIL unless
// paired with at least one escape hatch:
//   (a) actionLabel= + onAction= on the same element (CTA escape)
//   (b) description= whose value matches the timeline phrasing regex
//   (c) label itself matches the timeline phrasing regex
//
// Scope: src/features/**/*.tsx. Design-system primitives, windows, and
// tests are out of scope.
//
// Exit: 0 on pass, 1 on any violation.
// Runtime: ~60ms walking ~400 TSX files.
//
// First-run failure is EXPECTED — the violation count defines the
// backlog that Plan 15-04 closes against.

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

const tsxFiles = [];
walkDir(path.join(ROOT, 'src/features'), ['.tsx'], tsxFiles);

// ── Rules ─────────────────────────────────────────────────────────────────

// Banned label content — matches any substring match on a label value.
const BANNED_LABEL_RE =
  /(No\s+data|No\s+results|No\s+recent|Nothing\s+yet|Nothing\s+here)/i;

// Bare "No X" / "No X yet" at the start/end of a label string.
const BARE_NEGATION_RE = /^\s*No\s+\w+(\s+yet)?\s*$/i;

// Timeline / CTA allow phrases — any match anywhere in label or description
// is enough to pass.
const TIMELINE_RE =
  /(learning|give me|still|once|after|when|24h|48h|will appear|as BLADE|will populate|come back|start|add|connect|configure|enable)/i;

// ── Violations collector ──────────────────────────────────────────────────

const violations = [];

function addViolation(file, line, label, reason) {
  violations.push({
    file: path.relative(ROOT, file),
    line,
    label,
    reason,
  });
}

// ── Per-file parse ────────────────────────────────────────────────────────

/**
 * Extract every `<EmptyState ... />` or `<EmptyState ...>...</EmptyState>`
 * occurrence from a file as `{ tagContent, startLine }`. Tag content is the
 * full attribute string between `<EmptyState` and the terminating `>` of the
 * opening tag, possibly spanning multiple lines.
 */
function extractEmptyStateTags(content) {
  const tags = [];
  const lines = content.split('\n');

  let inTag = false;
  let startLine = 0;
  let buffer = '';
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inTag) {
      const idx = line.indexOf('<EmptyState');
      if (idx === -1) continue;
      // Guard against `<EmptyStateX` (other component names starting the
      // same). Require the next char after the match to be whitespace or `>`
      // or `/`.
      const next = line.charAt(idx + '<EmptyState'.length);
      if (next !== '' && !/[\s>/]/.test(next)) continue;

      inTag = true;
      startLine = i + 1;
      buffer = line.slice(idx);
      // Track brace/bracket depth to avoid mistaking a `>` inside a JSX
      // expression (e.g. `onAction={() => foo()}`) for tag close.
      depth = countDepth(buffer);
      if (tagClosed(buffer, depth)) {
        tags.push({ tagContent: sliceOpeningTag(buffer), startLine });
        inTag = false;
        buffer = '';
        depth = 0;
      }
      continue;
    }

    buffer += '\n' + line;
    depth += countDepth(line);
    if (tagClosed(buffer, depth)) {
      tags.push({ tagContent: sliceOpeningTag(buffer), startLine });
      inTag = false;
      buffer = '';
      depth = 0;
    }
  }

  return tags;
}

/** Compute net brace/paren depth added by a chunk of text. */
function countDepth(text) {
  let d = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === '{' || c === '(') d++;
    else if (c === '}' || c === ')') d--;
  }
  return d;
}

/** True once the opening tag has closed (outside any JSX expression). */
function tagClosed(buffer, depth) {
  if (depth > 0) return false;
  // A closing `>` or `/>` that isn't inside braces/parens.
  // Walk buffer, track depth at each position, look for `>` at depth 0
  // AFTER the initial `<EmptyState` token.
  let d = 0;
  const start = buffer.indexOf('<EmptyState') + '<EmptyState'.length;
  for (let i = start; i < buffer.length; i++) {
    const c = buffer.charAt(i);
    if (c === '{' || c === '(') d++;
    else if (c === '}' || c === ')') d--;
    else if (c === '>' && d === 0) return true;
  }
  return false;
}

/** Slice the opening-tag attribute string out of the buffer. */
function sliceOpeningTag(buffer) {
  const start = buffer.indexOf('<EmptyState');
  let d = 0;
  for (let i = start + '<EmptyState'.length; i < buffer.length; i++) {
    const c = buffer.charAt(i);
    if (c === '{' || c === '(') d++;
    else if (c === '}' || c === ')') d--;
    else if (c === '>' && d === 0) {
      return buffer.slice(start, i + 1);
    }
  }
  return buffer.slice(start);
}

/**
 * Pull the `label=` value out of a tag. Returns the string literal if
 * possible. For `label={variable}` expressions (non-string), returns null —
 * we don't flag dynamic labels because we can't statically read them.
 */
function extractLabel(tagContent) {
  // label="..." or label={"..."} (single-line literal)
  const dqMatch = tagContent.match(/\blabel=(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`]*)`\s*\})/);
  if (dqMatch) {
    return dqMatch[1] ?? dqMatch[2] ?? dqMatch[3] ?? dqMatch[4] ?? dqMatch[5] ?? null;
  }
  return null;
}

/** Extract the `description=` value — string literal only. */
function extractDescription(tagContent) {
  const m = tagContent.match(/\bdescription=(?:"([^"]*)"|'([^']*)'|\{\s*"([^"]*)"\s*\}|\{\s*'([^']*)'\s*\}|\{\s*`([^`]*)`\s*\})/);
  if (m) {
    return m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? null;
  }
  return null;
}

for (const f of tsxFiles) {
  const content = fs.readFileSync(f, 'utf8');
  const tags = extractEmptyStateTags(content);

  for (const { tagContent, startLine } of tags) {
    const label = extractLabel(tagContent);
    if (label == null) continue; // dynamic label — can't statically evaluate

    const bannedSubstring = BANNED_LABEL_RE.test(label);
    const bareNegation = BARE_NEGATION_RE.test(label);

    if (!bannedSubstring && !bareNegation) continue;

    // Escape hatch 1: CTA — both actionLabel AND onAction present.
    const hasActionLabel = /\bactionLabel\s*=/.test(tagContent);
    const hasOnAction = /\bonAction\s*=/.test(tagContent);
    if (hasActionLabel && hasOnAction) continue;

    // Escape hatch 2: description containing timeline phrasing.
    const description = extractDescription(tagContent);
    if (description != null && TIMELINE_RE.test(description)) continue;

    // Escape hatch 3: label itself matches timeline phrasing.
    if (TIMELINE_RE.test(label)) continue;

    addViolation(
      f,
      startLine,
      label,
      bareNegation
        ? 'bare "No X" label with no CTA, description, or timeline phrase'
        : 'banned bare-negation phrase with no CTA, description, or timeline phrase'
    );
  }
}

// ── Report ────────────────────────────────────────────────────────────────

console.log(
  `[verify:empty-states-copy] Scanned ${tsxFiles.length} TSX files across src/features`
);

if (violations.length === 0) {
  console.log(
    '[verify:empty-states-copy] PASS — 0 bare-negation empty states'
  );
  process.exit(0);
}

console.error(
  `[verify:empty-states-copy] FAIL — ${violations.length} bare-negation empty state(s) missing CTA/timeline/description:`
);
for (const v of violations) {
  console.error(
    `  ${v.file}:${v.line} — label="${v.label}" — ${v.reason}`
  );
}
process.exit(1);
