#!/usr/bin/env node
// scripts/verify-ecosystem-guardrail.mjs — Phase 13 Plan 13-03 (ECOSYS-09)
//
// Verifies the observe-only guardrail is correctly implemented in ecosystem.rs:
//   1. OBSERVE_ONLY is initialized to `true` (never false at startup)
//   2. assert_observe_only_allowed is defined and present (write-path gate)
//   3. OBSERVE_ONLY is never set to false in v1.1 (store(false) absent)
//   4. ecosystem_observe_only_check command is registered in lib.rs
//   5. mod ecosystem is registered in lib.rs
//   6. ecosystem::auto_enable_from_scan hook present in deep_scan/mod.rs
//   7. ecosystem_tentacles appears >= 6 times in config.rs (6-place pattern)
//   8. EcosystemPane.tsx exists and contains "Observe only" badge text
//
// Exits 0 on all checks pass; exits 1 with FAIL lines on any failure.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
let errors = 0;

function fail(msg) { console.error(`[FAIL] ${msg}`); errors++; }
function ok(msg)   { console.log(`[ OK ] ${msg}`); }

// ── Load ecosystem.rs ─────────────────────────────────────────────────────────

const ecosystemPath = resolve(ROOT, 'src-tauri/src/ecosystem.rs');
if (!existsSync(ecosystemPath)) {
  fail('src-tauri/src/ecosystem.rs does not exist — ecosystem module not created');
  console.error(`\n${errors} check(s) failed.`);
  process.exit(1);
}
const ecosystem = readFileSync(ecosystemPath, 'utf8');

// ── Check 1: OBSERVE_ONLY initialized to true ─────────────────────────────────
if (/OBSERVE_ONLY\s*:\s*AtomicBool\s*=\s*AtomicBool::new\(true\)/.test(ecosystem)) {
  ok('OBSERVE_ONLY initialized to AtomicBool::new(true)');
} else {
  fail('OBSERVE_ONLY not found or not initialized to true in ecosystem.rs');
}

// ── Check 2: assert_observe_only_allowed is defined ──────────────────────────
if (/pub fn assert_observe_only_allowed/.test(ecosystem)) {
  ok('assert_observe_only_allowed function is defined');
} else {
  fail('assert_observe_only_allowed not found in ecosystem.rs — write-path gate missing');
}

// ── Check 3: OBSERVE_ONLY never set to false (v1.1 invariant) ────────────────
const storeFalseMatches = ecosystem.match(/OBSERVE_ONLY\.store\s*\(\s*false/g);
if (!storeFalseMatches) {
  ok('OBSERVE_ONLY.store(false, ...) absent — guardrail never cleared in v1.1');
} else {
  fail(`OBSERVE_ONLY.store(false) found ${storeFalseMatches.length} time(s) — guardrail must not be cleared in v1.1`);
}

// ── Check 4: ecosystem_observe_only_check registered in lib.rs ───────────────
const librsPath = resolve(ROOT, 'src-tauri/src/lib.rs');
const librs = readFileSync(librsPath, 'utf8');
if (/ecosystem_observe_only_check/.test(librs)) {
  ok('ecosystem_observe_only_check found in lib.rs generate_handler![]');
} else {
  fail('ecosystem_observe_only_check not found in lib.rs — command not registered');
}

// ── Check 5: mod ecosystem registered in lib.rs ──────────────────────────────
if (/^\s*mod\s+ecosystem\s*;/m.test(librs)) {
  ok('mod ecosystem; registered in lib.rs');
} else {
  fail('mod ecosystem; not found in lib.rs — module not registered');
}

// ── Check 6: auto_enable_from_scan hook in deep_scan/mod.rs ──────────────────
// v1.6 narrowing (commit aa789f7 — VISION cut list #7): deep_scan + ecosystem
// auto-enable cut. The scan-to-tentacle auto-wire is gone; tentacle observation
// defaults to off (REDUCE-04). This check retires.
ok('deep_scan + ecosystem auto-enable cut by v1.6 (commit aa789f7) — check retired.');

// ── Check 7: ecosystem_tentacles in config.rs (6-place pattern) ──────────────
const configPath = resolve(ROOT, 'src-tauri/src/config.rs');
const config = readFileSync(configPath, 'utf8');
const tentacleCount = (config.match(/ecosystem_tentacles/g) || []).length;
if (tentacleCount >= 6) {
  ok(`ecosystem_tentacles appears ${tentacleCount} times in config.rs (>= 6 required)`);
} else {
  fail(`ecosystem_tentacles only appears ${tentacleCount} times in config.rs — 6-place pattern requires >= 6`);
}

// ── Check 8: EcosystemPane.tsx exists with observe-only badge ────────────────
const panePath = resolve(ROOT, 'src/features/settings/panes/EcosystemPane.tsx');
if (existsSync(panePath)) {
  const pane = readFileSync(panePath, 'utf8');
  if (/Observe only/.test(pane)) {
    ok('EcosystemPane.tsx exists and contains observe-only badge text');
  } else {
    fail('EcosystemPane.tsx exists but is missing "Observe only" badge text (ECOSYS-09 UI requirement)');
  }
} else {
  fail('EcosystemPane.tsx does not exist — UI wave not completed');
}

// ── Summary ───────────────────────────────────────────────────────────────────
if (errors > 0) {
  console.error(`\n${errors} check(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll ecosystem guardrail checks passed.');
}
