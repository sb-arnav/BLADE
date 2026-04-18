#!/usr/bin/env node
// scripts/verify-migration-ledger.mjs (D-27, P-03)
//
// Parses .planning/migration-ledger.md, greps src/ for openRoute / routeId
// references, fails if any src/ reference targets a route whose ledger row is
// missing. Also warns if the ledger row exists but status is `Deferred` (row
// kept for traceability but surface explicitly not shipping yet).
//
// CI enforcement replaces reviewer-required PR gate per Arnav's "CI-enforced,
// not manual" directive.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-27, §D-28
// @see .planning/research/PITFALLS.md §P-03

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = join(ROOT, '.planning', 'migration-ledger.md');
const SRC_DIR = join(ROOT, 'src');

// ---------------------------------------------------------------------------
// 1. Load ledger — parse the Markdown table rows.
// ---------------------------------------------------------------------------
const ledger = readFileSync(LEDGER_PATH, 'utf8');
const rows = {};

// Table columns: route_id | src.bak_path | new_component | section | phase | status | cross_refs | notes
// Pipe + optional whitespace; route_id is kebab-case; status is one of 3 values.
const ROW_RE = /^\|\s*([a-z][a-z0-9-]*)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*(Pending|Shipped|Deferred)\s*\|/;
for (const line of ledger.split('\n')) {
  const m = line.match(ROW_RE);
  if (m) rows[m[1]] = m[2];
}

const rowCount = Object.keys(rows).length;
if (rowCount === 0) {
  console.error('[verify-migration-ledger] FAIL: ledger has no parseable rows');
  process.exit(1);
}
console.log(`[verify-migration-ledger] Ledger loaded: ${rowCount} rows`);

// ---------------------------------------------------------------------------
// 2. Walk src/ for openRoute('<id>') / routeId === '<id>' references.
// ---------------------------------------------------------------------------
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?)$/.test(entry)) yield p;
  }
}

const referencedIds = new Set();
for (const file of walk(SRC_DIR)) {
  const src = readFileSync(file, 'utf8');
  // openRoute('id') or openRoute("id")
  for (const m of src.matchAll(/openRoute\s*\(\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
    referencedIds.add(m[1]);
  }
  // routeId === 'id' or routeId == 'id'
  for (const m of src.matchAll(/routeId\s*===?\s*['"]([a-z][a-z0-9-]*)['"]/g)) {
    referencedIds.add(m[1]);
  }
}

// ---------------------------------------------------------------------------
// 3. Cross-reference.
// ---------------------------------------------------------------------------
let failed = false;
for (const id of referencedIds) {
  if (!(id in rows)) {
    console.error(
      `[verify-migration-ledger] ORPHAN: src/ references route '${id}' but migration-ledger.md has no row`,
    );
    failed = true;
  } else if (rows[id] === 'Deferred') {
    console.warn(
      `[verify-migration-ledger] WARN: src/ references route '${id}' whose ledger status is Deferred`,
    );
  }
}

if (failed) {
  console.error('[verify-migration-ledger] FAIL: one or more src/ route references lack a ledger row');
  process.exit(1);
}

console.log(
  `[verify-migration-ledger] OK — ${referencedIds.size} referenced ids all tracked (of ${rowCount} ledger rows)`,
);
