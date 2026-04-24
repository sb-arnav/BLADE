#!/usr/bin/env node
// scripts/verify-feature-reachability.mjs
//
// Phase 14 Plan 14-01 (WIRE2-06).
// Gate script: checks that NOT-WIRED backlog items in the wiring audit have
// corresponding invokeTyped() call sites in src/lib/tauri/**/*.ts.
//
// In Wave 0 (Phase 14-01) this will EXIT 1 because wrappers do not exist yet.
// That is expected — the script must exist and be runnable without throwing.
//
// Exit 0 = all NOT-WIRED items have a call site (PASS)
// Exit 1 = one or more NOT-WIRED items are still missing call sites (FAIL)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Load wiring audit ──────────────────────────────────────────────────────

const auditPath = path.join(ROOT, '.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json');

let audit;
try {
  audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
} catch (e) {
  console.error(`[verify:feature-reachability] Cannot read wiring audit: ${e.message}`);
  process.exit(1);
}

// ── Collect NOT-WIRED items (excluding DEFERRED_V1_2) ─────────────────────

const notWired = [];
for (const mod of audit.modules ?? []) {
  if (mod.classification !== 'NOT-WIRED') continue;
  if (mod.phase_14_owner === 'DEFERRED_V1_2') continue;

  // Collect primary command names from this module
  const commands = (mod.commands ?? []).map((c) => {
    // Command names are in form "module::command_name" — extract leaf
    const parts = c.name.split('::');
    return parts[parts.length - 1];
  });

  if (commands.length > 0) {
    notWired.push({ file: mod.file, commands });
  }
}

if (notWired.length === 0) {
  console.log('[verify:feature-reachability] No NOT-WIRED items to check — PASS');
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

// Extract all invokeTyped('command_name') call sites
const invokedCommands = new Set();
const invokeRe = /invokeTyped\(\s*['"]([^'"]+)['"]/g;
for (const f of tsFiles) {
  const content = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = invokeRe.exec(content)) !== null) {
    invokedCommands.add(m[1]);
  }
}

// ── Check coverage ─────────────────────────────────────────────────────────

const missing = [];
for (const item of notWired) {
  const uncovered = item.commands.filter((cmd) => !invokedCommands.has(cmd));
  if (uncovered.length > 0) {
    missing.push({ file: item.file, uncovered });
  }
}

if (missing.length === 0) {
  console.log(`[verify:feature-reachability] All ${notWired.length} NOT-WIRED items have call sites — PASS`);
  process.exit(0);
} else {
  console.error(`[verify:feature-reachability] FAIL — ${missing.length} module(s) still have unwired commands:`);
  for (const m of missing) {
    console.error(`  ${m.file}: ${m.uncovered.join(', ')}`);
  }
  console.error('(Wave 0 expected — wrappers not yet created)');
  process.exit(1);
}
