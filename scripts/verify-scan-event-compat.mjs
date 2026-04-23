#!/usr/bin/env node
// verify-scan-event-compat.mjs — D-64 onboarding compat invariant:
// Every phase name in DEEP_SCAN_PHASES must have a Rust emit site in the new scanner.
// Prevents silent regressions where a renamed phase breaks the onboarding progress ring.
//
// The emit site check is a string-literal search: the phase name must appear as
// "phase_name" (double-quoted) somewhere in the deep_scan/ Rust source tree.
// This catches renames on either side (TS or Rust) without executing any code.
import { readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { exit } from 'process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..');

// Read the TypeScript phase list
const phasesFile = join(repoRoot, 'src', 'features', 'onboarding', 'deepScanPhases.ts');
let phasesSource;
try {
  phasesSource = readFileSync(phasesFile, 'utf8');
} catch (err) {
  console.error(`[FAIL] verify:scan-event-compat: could not read deepScanPhases.ts: ${err.message}`);
  exit(1);
}

// Extract DEEP_SCAN_PHASES array entries using a simple regex
// Matches: 'starting', 'installed_apps', etc. inside the const array
const matches = phasesSource.match(/'([a-z_]+)'/g) || [];
const phaseNames = matches.map(m => m.replace(/'/g, ''));

if (phaseNames.length === 0) {
  console.error('[FAIL] verify:scan-event-compat: could not extract phase names from deepScanPhases.ts');
  exit(1);
}

// Read all Rust source files under src-tauri/src/deep_scan/
const scanDir = join(repoRoot, 'src-tauri', 'src', 'deep_scan');

function collectRsFiles(dir) {
  let files = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(collectRsFiles(full));
      } else if (entry.isFile() && extname(entry.name) === '.rs') {
        files.push(full);
      }
    }
  } catch (_) {}
  return files;
}

const rsFiles = collectRsFiles(scanDir);
if (rsFiles.length === 0) {
  console.error(`[FAIL] verify:scan-event-compat: no .rs files found under ${scanDir}`);
  exit(1);
}

const allRustSource = rsFiles
  .map(f => readFileSync(f, 'utf8'))
  .join('\n');

let failed = false;
for (const phase of phaseNames) {
  // Check that this phase name appears as a string literal in the Rust emit sites.
  // The emit site looks like: emit_progress(&app, "phase_name", ...) or "phase": "phase_name"
  if (!allRustSource.includes(`"${phase}"`)) {
    console.error(`[FAIL] verify:scan-event-compat: phase "${phase}" from DEEP_SCAN_PHASES not found in any Rust emit site in deep_scan/`);
    failed = true;
  }
}

if (!failed) {
  console.log(`[PASS] verify:scan-event-compat: all ${phaseNames.length} phase names have Rust emit sites`);
}
exit(failed ? 1 : 0);
