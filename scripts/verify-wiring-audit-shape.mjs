#!/usr/bin/env node
// scripts/verify-wiring-audit-shape.mjs (Phase 10 Wave 0 — AUDIT-01..05)
//
// Loads .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json and
// validates it against 10-WIRING-AUDIT.schema.json using zod. Enforces:
//   - (AUDIT-01) modules.length === live count of .rs files under src-tauri/src/
//     (excludes build.rs at crate root)
//   - (AUDIT-02) routes.length === ALL_ROUTES.length (parsed from
//     src/windows/main/router.ts)
//   - (AUDIT-03) every `pub <field>:` in src-tauri/src/config.rs BladeConfig
//     block appears in config[]
//   - (AUDIT-04) every not_wired_backlog[i].backend_entry_points[] is non-empty
//     AND every entry matches .+:[0-9]+$
//   - (AUDIT-05) every dead_deletion_plan[i] has callers[], imports[],
//     safe_to_delete: boolean present
//
// Subcommands via argv: --self-test | --check=modules | --check=routes |
//   --check=config | --check=not-wired | --check=dead. Default (no arg) runs all.
//
// @see .planning/phases/10-inventory-wiring-audit/10-RESEARCH.md §"JSON Sidecar Schema"
// @see .planning/phases/10-inventory-wiring-audit/10-VALIDATION.md §"Wave 0 Requirements"

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHASE_DIR = join(ROOT, '.planning', 'phases', '10-inventory-wiring-audit');
const AUDIT_JSON = join(PHASE_DIR, '10-WIRING-AUDIT.json');
const SCHEMA_JSON = join(PHASE_DIR, '10-WIRING-AUDIT.schema.json');
const RUST_DIR = join(ROOT, 'src-tauri', 'src');
const ROUTER_TS = join(ROOT, 'src', 'windows', 'main', 'router.ts');
const CONFIG_RS = join(ROOT, 'src-tauri', 'src', 'config.rs');
const FEATURES_DIR = join(ROOT, 'src', 'features');

// ---------------------------------------------------------------------------
// zod schema mirror — mirrors 10-WIRING-AUDIT.schema.json field-for-field.
// ---------------------------------------------------------------------------
const Classification = z.enum(['ACTIVE', 'WIRED-NOT-USED', 'NOT-WIRED', 'DEAD']);
const RouteClassification = z.enum(['ACTIVE', 'ACTIVE (dev-only)', 'WIRED-NOT-USED', 'NOT-WIRED', 'DEAD']);
const FileLine = z.string().regex(/^src-tauri\/src\/.+:[0-9]+$/);
const FileLineLoose = z.string().regex(/.+:[0-9]+$/);
const CommandName = z.string().regex(/^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$/);
const Section = z.enum(['core', 'agents', 'knowledge', 'life', 'identity', 'dev', 'admin', 'body', 'hive']);
const FlowStatus = z.enum(['data pipes', 'placeholder', 'dead']);
const OwnerEnum = z.enum(['WIRE2', 'A11Y2', 'LOG', 'DENSITY', 'DEFERRED_V1_2']);
const ItemType = z.enum(['module', 'route', 'config', 'event']);

const ModuleRow = z.object({
  file: z.string().regex(/^src-tauri\/src\//),
  classification: Classification,
  purpose: z.string(),
  trigger: z.string(),
  ui_surface: z.string().nullable().optional(),
  commands: z.array(z.object({
    name: CommandName,
    registered: FileLine,
    invoked_from: z.string().regex(/^src\/.+:[0-9]+$/).nullable(),
  })).optional(),
  internal_callers: z.array(z.string()).optional(),
  body_registry_entry: z.string().nullable().optional(),
  backend_entry_points: z.array(FileLine).optional(),
  reachable_paths: z.array(z.string()).optional(),
});

const RouteRow = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  file: z.string().regex(/^src\//),
  classification: RouteClassification,
  section: Section,
  palette_visible: z.boolean(),
  shortcut: z.string().nullable().optional(),
  data_shape: z.string().nullable().optional(),
  data_source: z.array(z.any()).optional(),
  flow_status: FlowStatus.optional(),
  reachable_paths: z.array(z.string()).optional(),
});

const ConfigRow = z.object({
  field: z.string(),
  file: z.string().regex(/^src-tauri\/.+:[0-9]+$/),
  struct: z.string().optional(),
  disk_persisted: z.boolean().optional(),
  classification: Classification,
  ui_surface: z.string().nullable().optional(),
  control_type: z.string().optional(),
});

const NotWiredRow = z.object({
  item_type: ItemType,
  identifier: z.string(),
  backend_entry_points: z.array(FileLineLoose).min(1),
  phase_14_owner: OwnerEnum,
  deferral_rationale: z.string().nullable().optional(),
});

const DeadRow = z.object({
  identifier: z.string(),
  callers: z.array(z.string()),
  imports: z.array(z.string()),
  safe_to_delete: z.boolean(),
  deletion_note: z.string().optional(),
});

const AuditSchema = z.object({
  schema_version: z.literal('1.0.0'),
  generated_at: z.string(),
  modules: z.array(ModuleRow),
  routes: z.array(RouteRow),
  config: z.array(ConfigRow),
  not_wired_backlog: z.array(NotWiredRow),
  dead_deletion_plan: z.array(DeadRow),
});

// ---------------------------------------------------------------------------
// Utility: recursive .rs file walk.
// ---------------------------------------------------------------------------
function* walkRs(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walkRs(p);
    else if (entry.endsWith('.rs')) yield p;
  }
}

// ---------------------------------------------------------------------------
// Subcommand: --self-test
// ---------------------------------------------------------------------------
function checkSelfTest() {
  const fixture = {
    schema_version: '1.0.0',
    generated_at: new Date().toISOString(),
    modules: [],
    routes: [],
    config: [],
    not_wired_backlog: [],
    dead_deletion_plan: [],
  };
  AuditSchema.parse(fixture); // throws on shape mismatch
  if (!existsSync(SCHEMA_JSON)) {
    throw new Error(`schema file missing: ${SCHEMA_JSON}`);
  }
  // Confirm the schema file parses as JSON.
  JSON.parse(readFileSync(SCHEMA_JSON, 'utf8'));
  console.log('[verify-wiring-audit-shape] OK — self-test (schema accepts empty-shape fixture, schema file exists)');
}

// ---------------------------------------------------------------------------
// Subcommand: --check=modules (AUDIT-01)
// ---------------------------------------------------------------------------
function checkModules(audit) {
  let rsCount = 0;
  for (const file of walkRs(RUST_DIR)) {
    // Defensive: exclude build.rs if it somehow lives under src/ (canonical
    // location is src-tauri/build.rs at crate root, already excluded by
    // RUST_DIR scope — D-49).
    if (file.endsWith('/build.rs') || file.endsWith('\\build.rs')) continue;
    rsCount += 1;
  }
  if (audit.modules.length !== rsCount) {
    throw new Error(`modules.length (${audit.modules.length}) !== live .rs count under src-tauri/src/ (${rsCount})`);
  }
  console.log(`[verify-wiring-audit-shape] OK — modules (${rsCount} .rs files match modules.length)`);
}

// ---------------------------------------------------------------------------
// Subcommand: --check=routes (AUDIT-02)
// Parses src/windows/main/router.ts for the spread names and counts entries
// in each referenced feature cluster's `export const routes: RouteDefinition[]`.
// ---------------------------------------------------------------------------
function checkRoutes(audit) {
  if (!existsSync(ROUTER_TS)) {
    throw new Error(`router.ts missing: ${ROUTER_TS}`);
  }
  const routerSrc = readFileSync(ROUTER_TS, 'utf8');

  // Extract spread names inside ALL_ROUTES.
  const spreadNames = new Set();
  for (const m of routerSrc.matchAll(/\.\.\.([a-zA-Z][a-zA-Z0-9_]*Routes)/g)) {
    spreadNames.add(m[1]);
  }

  if (spreadNames.size === 0) {
    throw new Error('router.ts has no `...<name>Routes` spread entries — parse failure');
  }

  // Map a spread name (e.g. `dashboardRoutes`) to its feature folder path by
  // reading the corresponding `import { routes as <name> } from '@/features/<folder>'`
  // line earlier in the file.
  const importRe = /import\s*\{\s*routes\s+as\s+([a-zA-Z][a-zA-Z0-9_]*)\s*\}\s*from\s*['"]@\/features\/([a-zA-Z0-9-]+)['"]/g;
  const spreadToFolder = new Map();
  for (const m of routerSrc.matchAll(importRe)) {
    spreadToFolder.set(m[1], m[2]);
  }

  // Count route entries across feature clusters.
  // We tolerate per-file parse failure by falling back to literal `{ id:`
  // occurrences across the entire src/features tree.
  let totalRoutes = 0;
  const perClusterCounts = [];
  let anyParseFailure = false;
  for (const spreadName of spreadNames) {
    const folder = spreadToFolder.get(spreadName);
    if (!folder) {
      anyParseFailure = true;
      continue;
    }
    const indexPath = join(FEATURES_DIR, folder, 'index.tsx');
    const indexTsPath = join(FEATURES_DIR, folder, 'index.ts');
    const candidate = existsSync(indexPath) ? indexPath : (existsSync(indexTsPath) ? indexTsPath : null);
    if (!candidate) {
      anyParseFailure = true;
      continue;
    }
    const body = readFileSync(candidate, 'utf8');
    // Locate the exported routes array block.
    const arrBlock = body.match(/export\s+const\s+routes\s*:\s*RouteDefinition\[\]\s*=\s*\[([\s\S]*?)\n\]\s*;?/m);
    if (!arrBlock) {
      anyParseFailure = true;
      continue;
    }
    const inner = arrBlock[1];
    // Count top-level route-object entries by counting `id:` occurrences.
    const count = (inner.match(/(^|[\s{,])\s*id\s*:\s*['"]/g) || []).length;
    totalRoutes += count;
    perClusterCounts.push(`${spreadName}=${count}`);
  }

  // Dev-routes spread is gated on import.meta.env.DEV — it's present in
  // ALL_ROUTES under dev but not in prod. For the purposes of this check,
  // we count what is in the ALL_ROUTES spread list regardless of gating —
  // the audit JSON may classify dev-only routes as "ACTIVE (dev-only)" or
  // exclude them; either outcome is consistent if audit.routes.length
  // matches the union we compute.

  // Fallback: if any cluster failed to parse, warn and fall back to a
  // best-effort count across all src/features/*/index.{tsx,ts} files.
  if (anyParseFailure) {
    console.warn('[verify-wiring-audit-shape] WARN: one or more feature cluster index files could not be parsed; falling back to full-tree { id: count');
    totalRoutes = 0;
    for (const entry of readdirSync(FEATURES_DIR)) {
      const dirPath = join(FEATURES_DIR, entry);
      if (!statSync(dirPath).isDirectory()) continue;
      for (const candidate of ['index.tsx', 'index.ts']) {
        const p = join(dirPath, candidate);
        if (!existsSync(p)) continue;
        const body = readFileSync(p, 'utf8');
        const arrBlock = body.match(/export\s+const\s+routes\s*:\s*RouteDefinition\[\]\s*=\s*\[([\s\S]*?)\n\]\s*;?/m);
        if (!arrBlock) continue;
        const count = (arrBlock[1].match(/(^|[\s{,])\s*id\s*:\s*['"]/g) || []).length;
        totalRoutes += count;
      }
    }
  }

  if (audit.routes.length !== totalRoutes) {
    throw new Error(`routes.length (${audit.routes.length}) !== feature-cluster route count (${totalRoutes}) [${perClusterCounts.join(', ')}]`);
  }
  console.log(`[verify-wiring-audit-shape] OK — routes (${totalRoutes} feature-cluster routes match routes.length)`);
}

// ---------------------------------------------------------------------------
// Subcommand: --check=config (AUDIT-03)
// Regex-extracts `pub <field>:` lines from the BladeConfig struct block.
// ---------------------------------------------------------------------------
function checkConfig(audit) {
  if (!existsSync(CONFIG_RS)) {
    throw new Error(`config.rs missing: ${CONFIG_RS}`);
  }
  const src = readFileSync(CONFIG_RS, 'utf8');
  const blockMatch = src.match(/pub struct BladeConfig\s*\{([\s\S]*?)^\}/m);
  if (!blockMatch) {
    throw new Error('could not locate `pub struct BladeConfig { ... }` block in config.rs');
  }
  const block = blockMatch[1];
  const fieldNames = new Set();
  for (const m of block.matchAll(/\bpub\s+([a-z_][a-z_0-9]*)\s*:/g)) {
    fieldNames.add(m[1]);
  }
  if (fieldNames.size === 0) {
    throw new Error('BladeConfig block parsed but no `pub <field>:` lines found');
  }

  const missing = [];
  for (const name of fieldNames) {
    const found = audit.config.some((row) => {
      const f = row.field;
      return f === name || f.endsWith(`.${name}`) || f.endsWith(`::${name}`) || f.includes(`BladeConfig.${name}`);
    });
    if (!found) missing.push(name);
  }
  if (missing.length > 0) {
    throw new Error(`${missing.length} BladeConfig field(s) missing from config[]: ${missing.join(', ')}`);
  }
  console.log(`[verify-wiring-audit-shape] OK — config (all ${fieldNames.size} BladeConfig pub fields represented in config[])`);
}

// ---------------------------------------------------------------------------
// Subcommand: --check=not-wired (AUDIT-04)
// ---------------------------------------------------------------------------
function checkNotWired(audit) {
  const fileLineRe = /.+:[0-9]+$/;
  const violations = [];
  for (const row of audit.not_wired_backlog) {
    if (!Array.isArray(row.backend_entry_points) || row.backend_entry_points.length === 0) {
      violations.push(`${row.identifier || '<unknown>'}: backend_entry_points empty or missing`);
      continue;
    }
    for (const ep of row.backend_entry_points) {
      if (typeof ep !== 'string' || !fileLineRe.test(ep)) {
        violations.push(`${row.identifier || '<unknown>'}: entry '${ep}' does not match .+:[0-9]+$`);
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`not_wired_backlog: ${violations.length} violation(s):\n  - ${violations.join('\n  - ')}`);
  }
  console.log(`[verify-wiring-audit-shape] OK — not-wired (${audit.not_wired_backlog.length} rows all have file:line entry points)`);
}

// ---------------------------------------------------------------------------
// Subcommand: --check=dead (AUDIT-05)
// ---------------------------------------------------------------------------
function checkDead(audit) {
  const violations = [];
  for (const row of audit.dead_deletion_plan) {
    const id = row.identifier || '<unknown>';
    if (!Array.isArray(row.callers)) violations.push(`${id}: callers is not an array`);
    if (!Array.isArray(row.imports)) violations.push(`${id}: imports is not an array`);
    if (typeof row.safe_to_delete !== 'boolean') violations.push(`${id}: safe_to_delete is not a boolean`);
  }
  if (violations.length > 0) {
    throw new Error(`dead_deletion_plan: ${violations.length} violation(s):\n  - ${violations.join('\n  - ')}`);
  }
  console.log(`[verify-wiring-audit-shape] OK — dead (${audit.dead_deletion_plan.length} rows all have callers[], imports[], safe_to_delete:boolean)`);
}

// ---------------------------------------------------------------------------
// Main dispatcher.
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const subcommands = new Set();
let selfTest = false;
for (const arg of args) {
  if (arg === '--self-test') selfTest = true;
  else if (arg.startsWith('--check=')) subcommands.add(arg.slice(8));
}
const runAll = !selfTest && subcommands.size === 0;

let failed = false;

// Self-test runs without needing the audit JSON to exist.
if (selfTest) {
  try {
    checkSelfTest();
  } catch (e) {
    console.error('[verify-wiring-audit-shape] FAIL: self-test —', e.message);
    failed = true;
  }
}

// All other checks need the audit JSON.
if (runAll || subcommands.size > 0) {
  if (!existsSync(AUDIT_JSON)) {
    // If the script is invoked as part of verify:all BEFORE the audit ships,
    // treat missing JSON as a soft skip (log a WARN, do not fail). This is
    // the Wave 0 → Wave 1/2 transition gap; Plan 05 creates the file.
    console.warn(`[verify-wiring-audit-shape] WARN: audit JSON missing ( ${AUDIT_JSON} ); run plan 05 to produce it. Skipping checks.`);
  } else {
    let audit;
    try {
      const raw = JSON.parse(readFileSync(AUDIT_JSON, 'utf8'));
      audit = AuditSchema.parse(raw);
    } catch (e) {
      console.error('[verify-wiring-audit-shape] FAIL: schema validation —', e.message);
      failed = true;
    }
    if (audit) {
      const checks = runAll ? new Set(['modules', 'routes', 'config', 'not-wired', 'dead']) : subcommands;
      if (checks.has('modules')) {
        try { checkModules(audit); } catch (e) {
          console.error('[verify-wiring-audit-shape] FAIL: modules —', e.message); failed = true;
        }
      }
      if (checks.has('routes')) {
        try { checkRoutes(audit); } catch (e) {
          console.error('[verify-wiring-audit-shape] FAIL: routes —', e.message); failed = true;
        }
      }
      if (checks.has('config')) {
        try { checkConfig(audit); } catch (e) {
          console.error('[verify-wiring-audit-shape] FAIL: config —', e.message); failed = true;
        }
      }
      if (checks.has('not-wired')) {
        try { checkNotWired(audit); } catch (e) {
          console.error('[verify-wiring-audit-shape] FAIL: not-wired —', e.message); failed = true;
        }
      }
      if (checks.has('dead')) {
        try { checkDead(audit); } catch (e) {
          console.error('[verify-wiring-audit-shape] FAIL: dead —', e.message); failed = true;
        }
      }
    }
  }
}

if (failed) {
  console.error('[verify-wiring-audit-shape] FAIL: one or more checks failed');
  process.exit(1);
}

console.log('[verify-wiring-audit-shape] OK');
