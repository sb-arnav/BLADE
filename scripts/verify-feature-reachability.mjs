#!/usr/bin/env node
// scripts/verify-feature-reachability.mjs
//
// Phase 14 Plan 14-04 (WIRE2-06) — hardened production gate.
// Checks that NOT-WIRED backlog items in 10-WIRING-AUDIT.json have
// corresponding invokeTyped() call sites in src/lib/tauri/**/*.ts.
//
// Flags:
//   --verbose   Print each checked item with WIRED / MISSING / DEFERRED status
//   --summary   Print only the counts (default when no flag given)
//
// Exit 0 = all WIRE2 module items have ≥1 invoke call-site (PASS)
// Exit 1 = one or more WIRE2 module items missing call sites (FAIL)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const VERBOSE = process.argv.includes('--verbose');
const SUMMARY = process.argv.includes('--summary') || !VERBOSE;

// ── Load wiring audit ──────────────────────────────────────────────────────

const auditPath = path.join(ROOT, '.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json');

let audit;
try {
  audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
} catch (e) {
  console.error(`[verify:feature-reachability] Cannot read wiring audit: ${e.message}`);
  process.exit(1);
}

// ── Build deferred set from not_wired_backlog ──────────────────────────────
// The not_wired_backlog array has the canonical phase_14_owner field.
// modules[] does NOT have phase_14_owner — must cross-reference here.

const deferredFiles = new Set();
for (const item of audit.not_wired_backlog ?? []) {
  if (item.phase_14_owner === 'DEFERRED_V1_2') {
    deferredFiles.add(item.identifier);
  }
}

// ── Collect NOT-WIRED module items (excluding DEFERRED_V1_2) ─────────────
// Use modules[] which has the full commands[] list.
// Config items (50 of 99) are checked separately via saveConfigField pattern;
// they are not tracked by invokeTyped call-site search.

const checkItems = []; // { file, commands: string[] }

for (const mod of audit.modules ?? []) {
  if (mod.classification !== 'NOT-WIRED') continue;
  if (deferredFiles.has(mod.file)) continue;

  // Extract leaf command name from "module::command_name" format
  const commands = (mod.commands ?? []).map((c) => {
    const parts = (c.name ?? '').split('::');
    return parts[parts.length - 1];
  }).filter(Boolean);

  if (commands.length > 0) {
    checkItems.push({ file: mod.file, commands });
  }
}

if (checkItems.length === 0) {
  console.log('[verify:feature-reachability] No NOT-WIRED module items to check — PASS');
  process.exit(0);
}

// ── Collect invokeTyped call sites from src/lib/tauri/**/*.ts ─────────────

function walkDir(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, results);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const tauriLibDir = path.join(ROOT, 'src/lib/tauri');
const tsFiles = walkDir(tauriLibDir);

// Extract all invokeTyped('command_name') call sites.
// Handles:
//   invokeTyped('cmd', ...)
//   invokeTyped<T>('cmd', ...)
//   invokeTyped<T, U>('cmd', ...)
const invokedCommands = new Set();
const invokeRe = /invokeTyped(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g;
for (const f of tsFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = invokeRe.exec(content)) !== null) {
    invokedCommands.add(m[1]);
  }
}

// ── Check coverage ─────────────────────────────────────────────────────────

const missing = [];
let wiredCount = 0;
const deferredCount = deferredFiles.size;

for (const item of checkItems) {
  const uncovered = item.commands.filter((cmd) => !invokedCommands.has(cmd));
  if (uncovered.length === 0) {
    wiredCount++;
    if (VERBOSE) {
      console.log(`  WIRED    ${item.file}`);
    }
  } else {
    missing.push({ file: item.file, uncovered });
    if (VERBOSE) {
      console.log(`  MISSING  ${item.file}: ${uncovered.join(', ')}`);
    }
  }
}

// Also print deferred items in verbose mode
if (VERBOSE) {
  for (const f of deferredFiles) {
    console.log(`  DEFERRED ${f} (DEFERRED_V1_2 — excluded from check)`);
  }
}

// ── Report ─────────────────────────────────────────────────────────────────

if (missing.length === 0) {
  if (SUMMARY) {
    console.log(
      `[verify:feature-reachability] PASS — ${wiredCount} wired, 0 missing, ${deferredCount} deferred`
    );
  }
  process.exit(0);
} else {
  if (SUMMARY) {
    console.error(
      `[verify:feature-reachability] FAIL — ${wiredCount} wired, ${missing.length} missing, ${deferredCount} deferred`
    );
  }
  if (!VERBOSE) {
    // Print missing items even in summary mode so CI logs are actionable
    for (const m of missing) {
      console.error(`  MISSING  ${m.file}: ${m.uncovered.join(', ')}`);
    }
  }
  process.exit(1);
}
