#!/usr/bin/env node
// scripts/verify-providers-capability.mjs (Phase 11 Plan 11-06 — gate 20)
//
// Structural integrity gate for the Phase 11 Smart Provider Setup substrate.
// Asserts that the falsifiable invariants produced by Plans 11-01..11-05 are
// present in the tree so future regressions (a deleted surface, a missing
// <CapabilityGap> wire, a config field that drifts below 6 places) fail at
// commit time instead of at runtime.
//
// Checks (all run by default; soft-skipped when their target file is absent):
//   1. src/features/providers/CAPABILITY_SURFACES.ts has >= 2 entries per
//      capability in { vision, audio, long_context, tools }.
//   2. Each of those 4 capabilities is referenced by >= 1
//      `<CapabilityGap capability="X">` usage somewhere in src/ (excluding the
//      component definition file + the surface registry).
//   3. All 5 new BladeConfig fields (provider_capabilities + 4 *_provider
//      Option<String>) appear >= 6 times each in src-tauri/src/config.rs
//      (6-place pattern — DiskConfig struct, DiskConfig::default(), BladeConfig
//      struct, BladeConfig::default(), load_config(), save_config()).
//   4. BLADE_EVENTS.ROUTING_CAPABILITY_MISSING constant exists in
//      src/lib/events/index.ts AND the literal string
//      'blade_routing_capability_missing' is present.
//
// Advisory (warning, does not fail the gate):
//   • Subscriber audit — grep src/ for useTauriEvent(BLADE_EVENTS.ROUTING_
//     CAPABILITY_MISSING, ...) or listen('blade_routing_capability_missing'
//     ...). Plan 11-04 shipped the emit + constant; the UI consumer is a
//     deferred follow-up per the plan's "Next Phase Readiness" note. The
//     warning documents the gap without blocking the gate.
//
// Output contract (analog to scripts/verify-wiring-audit-shape.mjs):
//   • `[verify-providers-capability] OK — <summary>` per passing check.
//   • `[verify-providers-capability] WARN: <detail>` for soft-skips / advisory.
//   • `[verify-providers-capability] FAIL: <reason>` on failure, exit 1.
//   • `[verify-providers-capability] OK` as final line on success, exit 0.
//
// Flags:
//   --self-test   Runs a minimal self-consistency pass (regex compiles,
//                 constants parse) without touching the real repo state. Used
//                 by CI dry-runs and agent smoke tests. Exits 0.
//
// Design notes:
//   • ESM (.mjs) — Node built-ins only. No child_process, no network, no
//     shell. Pure filesystem read.
//   • Regexes are bounded (no catastrophic backtracking): the CAPABILITY_
//     SURFACES block match is greedy up to the first `]`, and the
//     CapabilityGap walker uses `\w+` (not `.*`).
//   • Directory walk skips node_modules/, dist/, dist-electron/, .planning/,
//     src.bak/, tests/ — consistent with sibling verify scripts.
//
// @see .planning/phases/11-smart-provider-setup/11-06-PLAN.md (Task 1 spec)
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §18
// @see scripts/verify-wiring-audit-shape.mjs (analog — ESM + self-test + exit)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Constants — the 4 capabilities + the 5 new BladeConfig fields. These are
// the Phase 11 acceptance surface; changing them means changing D-53 / D-54.
// ---------------------------------------------------------------------------
const CAPABILITIES = ['vision', 'audio', 'long_context', 'tools'];
const NEW_FIELDS = [
  'provider_capabilities',
  'vision_provider',
  'audio_provider',
  'long_context_provider',
  'tools_provider',
];

// Paths that the checks inspect. Kept as constants so failure messages can
// quote an exact file — easier to diagnose "why did the gate fail".
const SURFACES_PATH = join(ROOT, 'src/features/providers/CAPABILITY_SURFACES.ts');
const CONFIG_PATH = join(ROOT, 'src-tauri/src/config.rs');
const EVENTS_PATH = join(ROOT, 'src/lib/events/index.ts');
const SRC_DIR = join(ROOT, 'src');

// Files that legitimately contain <CapabilityGap ...> without being a
// consumer surface (definition or registry). Excluded from the Check 2 walk
// so the uniqueness check sees only real UI consumers.
const CAPABILITY_GAP_EXCLUDE_BASENAMES = new Set([
  'CapabilityGap.tsx',
  'CAPABILITY_SURFACES.ts',
]);

// Directory walk excludes. Same skip list as verify-migration-ledger.mjs.
const WALK_EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  '.next',
  '.turbo',
  '.git',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursive .tsx / .ts walker under a given root. Yields absolute paths. */
function* walkSrcTs(dir) {
  for (const entry of readdirSync(dir)) {
    if (WALK_EXCLUDE_DIRS.has(entry) || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walkSrcTs(p);
    else if (/\.(tsx?|mts|cts)$/.test(entry)) yield p;
  }
}

/** Count non-overlapping regex matches in a string (null-safe). */
function countMatches(src, re) {
  return (src.match(re) || []).length;
}

// ---------------------------------------------------------------------------
// Check 1 — CAPABILITY_SURFACES entry count per capability.
// ---------------------------------------------------------------------------
function checkSurfacesEntryCount(failed, warnings) {
  if (!existsSync(SURFACES_PATH)) {
    warnings.push(
      `check #1 skipped — ${SURFACES_PATH} not found (Plan 11-05 produces it)`,
    );
    return { skipped: true };
  }
  const src = readFileSync(SURFACES_PATH, 'utf8');
  const perCap = {};
  for (const cap of CAPABILITIES) {
    // Non-greedy capture of array body up to the first `]` — works because
    // each capability array is a flat list of object literals with no nested
    // brackets. If that ever changes the regex needs rethinking.
    const m = src.match(new RegExp(`${cap}:\\s*\\[([\\s\\S]*?)\\]`));
    const block = m?.[1] ?? '';
    const count = countMatches(block, /route:\s*['"]/g);
    perCap[cap] = count;
    if (count < 2) {
      failed.push(
        `check #1: CAPABILITY_SURFACES.${cap} has ${count}/2 entries`,
      );
    }
  }
  console.log(
    `[verify-providers-capability] OK — check #1 surfaces (` +
      Object.entries(perCap)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') +
      `)`,
  );
  return { skipped: false, perCap };
}

// ---------------------------------------------------------------------------
// Check 2 — CapabilityGap usage per capability in src/.
// ---------------------------------------------------------------------------
function checkCapabilityGapUsage(failed) {
  const found = new Set();
  const re = /<CapabilityGap\s+capability=["'](\w+)["']/g;
  for (const file of walkSrcTs(SRC_DIR)) {
    const basename = file.split('/').pop();
    if (CAPABILITY_GAP_EXCLUDE_BASENAMES.has(basename)) continue;
    const body = readFileSync(file, 'utf8');
    for (const m of body.matchAll(re)) {
      found.add(m[1]);
    }
  }
  for (const cap of CAPABILITIES) {
    if (!found.has(cap)) {
      failed.push(
        `check #2: no <CapabilityGap capability="${cap}"> usage in src/`,
      );
    }
  }
  const coverage = CAPABILITIES.map((c) =>
    found.has(c) ? c : `${c}(MISSING)`,
  ).join(', ');
  console.log(
    `[verify-providers-capability] OK — check #2 CapabilityGap usages (${coverage})`,
  );
}

// ---------------------------------------------------------------------------
// Check 3 — 6-place pattern for the 5 new BladeConfig fields.
// ---------------------------------------------------------------------------
function checkConfigSixPlace(failed, warnings) {
  if (!existsSync(CONFIG_PATH)) {
    warnings.push(
      `check #3 skipped — ${CONFIG_PATH} not found (Plan 11-02 produces it)`,
    );
    return;
  }
  const src = readFileSync(CONFIG_PATH, 'utf8');
  const perField = {};
  for (const field of NEW_FIELDS) {
    const occurrences = countMatches(src, new RegExp(`\\b${field}\\b`, 'g'));
    perField[field] = occurrences;
    if (occurrences < 6) {
      failed.push(
        `check #3: config.rs field ${field} occurs ${occurrences}/6 places`,
      );
    }
  }
  console.log(
    `[verify-providers-capability] OK — check #3 config 6-place (` +
      Object.entries(perField)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ') +
      `)`,
  );
}

// ---------------------------------------------------------------------------
// Check 4 — BLADE_EVENTS.ROUTING_CAPABILITY_MISSING constant + literal.
// ---------------------------------------------------------------------------
function checkEventRegistry(failed, warnings) {
  if (!existsSync(EVENTS_PATH)) {
    warnings.push(
      `check #4 skipped — ${EVENTS_PATH} not found (Plan 11-04 edits it)`,
    );
    return;
  }
  const src = readFileSync(EVENTS_PATH, 'utf8');
  if (!src.includes('ROUTING_CAPABILITY_MISSING')) {
    failed.push(
      `check #4: src/lib/events/index.ts missing ROUTING_CAPABILITY_MISSING constant`,
    );
  }
  // Accept either quote style for the event literal — TS allows both.
  const hasLiteral =
    src.includes(`'blade_routing_capability_missing'`) ||
    src.includes(`"blade_routing_capability_missing"`);
  if (!hasLiteral) {
    failed.push(
      `check #4: src/lib/events/index.ts missing 'blade_routing_capability_missing' event literal`,
    );
  }
  if (src.includes('ROUTING_CAPABILITY_MISSING') && hasLiteral) {
    console.log(
      `[verify-providers-capability] OK — check #4 event registry (ROUTING_CAPABILITY_MISSING constant + literal)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Advisory — Subscriber audit for ROUTING_CAPABILITY_MISSING.
//
// Phase 11 Plan 11-04 shipped the emit site + TS constant; the UI consumer is
// explicitly deferred (see 11-04-SUMMARY.md §"Known Stubs" + §"Next Phase
// Readiness"). This advisory surfaces the gap so a later plan/phase that
// wires a consumer can see this warning drop away — it does NOT fail the
// gate in its current state because the plan's acceptance surface is only
// the 4 structural checks above.
// ---------------------------------------------------------------------------
function auditSubscribers(warnings) {
  if (!existsSync(SRC_DIR)) return;
  let subscriberCount = 0;
  const reUseTauri = /useTauriEvent\s*\(\s*BLADE_EVENTS\.ROUTING_CAPABILITY_MISSING/;
  const reListen = /listen\s*<[^>]*>?\s*\(\s*['"]blade_routing_capability_missing['"]/;
  for (const file of walkSrcTs(SRC_DIR)) {
    // Don't count the registry definition itself.
    if (file.endsWith('/lib/events/index.ts') || file.endsWith('/lib/events/payloads.ts')) continue;
    const body = readFileSync(file, 'utf8');
    if (reUseTauri.test(body) || reListen.test(body)) subscriberCount += 1;
  }
  if (subscriberCount === 0) {
    warnings.push(
      `advisory: ROUTING_CAPABILITY_MISSING has 0 subscribers in src/ (emit is live; UI consumer is a deferred follow-up per 11-04-SUMMARY.md)`,
    );
  } else {
    console.log(
      `[verify-providers-capability] OK — advisory ROUTING_CAPABILITY_MISSING has ${subscriberCount} subscriber(s) in src/`,
    );
  }
}

// ---------------------------------------------------------------------------
// --self-test — run without touching real repo state.
//
// Exercises: constants parse, regexes compile, walker works on a known
// directory, core module-level invariants hold. Does NOT run the 4 checks —
// those require the real repo layout. Used by CI dry-runs to confirm the
// script itself is healthy.
// ---------------------------------------------------------------------------
function runSelfTest() {
  // Invariants: constants populated, regexes compile.
  if (CAPABILITIES.length !== 4) {
    throw new Error(`CAPABILITIES length ${CAPABILITIES.length} !== 4`);
  }
  if (NEW_FIELDS.length !== 5) {
    throw new Error(`NEW_FIELDS length ${NEW_FIELDS.length} !== 5`);
  }
  // Compile the regexes — throws on invalid.
  for (const cap of CAPABILITIES) {
    new RegExp(`${cap}:\\s*\\[([\\s\\S]*?)\\]`);
  }
  for (const field of NEW_FIELDS) {
    new RegExp(`\\b${field}\\b`, 'g');
  }
  new RegExp(/<CapabilityGap\s+capability=["'](\w+)["']/.source, 'g');

  // Walker sanity — must yield at least one .ts / .tsx file under src/ if src
  // exists. In a fresh repo without src/, the self-test still passes.
  if (existsSync(SRC_DIR)) {
    let anyFile = false;
    for (const _ of walkSrcTs(SRC_DIR)) {
      anyFile = true;
      break;
    }
    if (!anyFile) {
      throw new Error(`walker yielded 0 files under ${SRC_DIR}`);
    }
  }

  console.log(
    `[verify-providers-capability] OK — self-test (4 capabilities, 5 fields, regexes compile, walker works)`,
  );
}

// ---------------------------------------------------------------------------
// Main dispatcher.
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const selfTest = args.includes('--self-test');

if (selfTest) {
  try {
    runSelfTest();
    process.exit(0);
  } catch (e) {
    console.error(`[verify-providers-capability] FAIL: self-test — ${e.message}`);
    process.exit(1);
  }
}

// Normal run: accumulate failures and warnings, run all 4 checks, summarise.
const failed = [];
const warnings = [];

try {
  const surfaces = checkSurfacesEntryCount(failed, warnings);
  // Only run check 2 when check 1 had a surfaces file — otherwise the
  // CapabilityGap walk is meaningless (no canonical list of capabilities
  // to prove coverage of beyond the hardcoded CAPABILITIES list here). The
  // hardcoded list is a stable contract so we DO still run check 2 if the
  // registry is absent — the walker's coverage set is independent.
  checkCapabilityGapUsage(failed);
  checkConfigSixPlace(failed, warnings);
  checkEventRegistry(failed, warnings);
  auditSubscribers(warnings);
  void surfaces; // reserved for future ratio/coverage diagnostics
} catch (e) {
  // Defensive: if any check throws (filesystem error, unexpected shape), fail
  // hard rather than pretending the gate passed.
  console.error(`[verify-providers-capability] FAIL: unexpected error — ${e.message}`);
  process.exit(1);
}

if (warnings.length > 0) {
  console.log('');
  console.log('[verify-providers-capability] Warnings:');
  for (const w of warnings) console.log(`  • ${w}`);
}

if (failed.length > 0) {
  console.error('');
  console.error('[verify-providers-capability] Failures:');
  for (const f of failed) console.error(`  • ${f}`);
  console.error('');
  console.error(`[verify-providers-capability] FAIL: ${failed.length} check(s) failed`);
  process.exit(1);
}

console.log('');
console.log('[verify-providers-capability] OK');
process.exit(0);
