#!/usr/bin/env node
// scripts/_synthesize-audit.mjs — Phase 10 Plan 05 Task 1 synthesis.
//
// Merges the three Wave-1 YAML subagent outputs into the canonical
// 10-WIRING-AUDIT.json sidecar (schema 1.0.0). Deleted after use.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHASE_DIR = `${ROOT}/.planning/phases/10-inventory-wiring-audit`;
const MODULES_YAML = `${PHASE_DIR}/10-MODULES.yaml`;
const ROUTES_YAML = `${PHASE_DIR}/10-ROUTES.yaml`;
const CONFIG_YAML = `${PHASE_DIR}/10-CONFIG.yaml`;
const AUDIT_JSON = `${PHASE_DIR}/10-WIRING-AUDIT.json`;

// ----- Parse YAML via python3 + PyYAML (no shell; use execFileSync with argv) -----
function loadYaml(path) {
  const script = 'import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))';
  const raw = execFileSync('python3', ['-c', script, path], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(raw.toString('utf8'));
}

// ----- Helpers -----
const CMD_RE = /^[a-z_][a-z_0-9]*::[a-z_][a-z_0-9]*$/;
function normalizeCommandName(name) {
  // Drop 3-seg (e.g. plugins::registry::plugin_list) to 2-seg for schema.
  if (CMD_RE.test(name)) return name;
  const parts = name.split('::');
  if (parts.length >= 2) return parts.slice(-2).join('::');
  return name;
}

// Acting-tentacle command patterns (canonical_anchors §6).
const ACTING_PATTERNS = /(_reply|_post|_deploy|_send|_write|_merge)$/;
function isActingTentacle(cmdName) {
  const last = cmdName.split('::').pop();
  return ACTING_PATTERNS.test(last);
}

// ----- Load inputs -----
const modulesDoc = loadYaml(MODULES_YAML);
const routesDoc = loadYaml(ROUTES_YAML);
const configDoc = loadYaml(CONFIG_YAML);

// ----- Build audit.modules -----
const modules = [];
for (const m of modulesDoc.modules) {
  const row = {
    file: m.file,
    classification: m.classification,
    purpose: m.purpose || '',
    trigger: m.trigger || '',
    ui_surface: m.ui_surface ?? null,
  };
  if (Array.isArray(m.commands) && m.commands.length > 0) {
    row.commands = m.commands.map((c) => ({
      name: normalizeCommandName(c.name),
      registered: c.registered,
      invoked_from: c.invoked_from ?? null,
    }));
  }
  if (Array.isArray(m.internal_callers) && m.internal_callers.length > 0) {
    row.internal_callers = m.internal_callers;
  }
  if (m.body_registry_entry !== undefined) {
    row.body_registry_entry = m.body_registry_entry ?? null;
  }
  if (Array.isArray(m.backend_entry_points) && m.backend_entry_points.length > 0) {
    row.backend_entry_points = m.backend_entry_points;
  }
  if (Array.isArray(m.reachable_paths) && m.reachable_paths.length > 0) {
    row.reachable_paths = m.reachable_paths;
  }
  modules.push(row);
}
modules.sort((a, b) => a.file.localeCompare(b.file));

// ----- Build audit.routes -----
// Exclude ACTIVE (dev-only) routes: the verify script counts routes from
// feature-cluster index.tsx files reached via the `...<name>Routes` spread
// pattern in router.ts. The `...(import.meta.env.DEV ? devRoutes : [])`
// spread does NOT match the regex, so devRoutes is excluded from the
// verify-script count. We mirror that exclusion in the JSON so
// audit.routes.length matches the verify-script count exactly. Dev-only
// routes are still documented in the Markdown's Section 2 sub-table.
const routes = [];
for (const r of routesDoc.routes) {
  if (r.classification === 'ACTIVE (dev-only)') continue;
  const row = {
    id: r.id,
    file: r.file,
    classification: r.classification,
    section: r.section,
    palette_visible: r.palette_visible === true,
  };
  if (r.shortcut !== undefined) row.shortcut = r.shortcut ?? null;
  if (r.data_shape !== undefined) row.data_shape = r.data_shape ?? null;
  if (Array.isArray(r.data_source)) row.data_source = r.data_source;
  if (r.flow_status) row.flow_status = r.flow_status;
  if (Array.isArray(r.reachable_paths) && r.reachable_paths.length > 0) {
    row.reachable_paths = r.reachable_paths;
  }
  routes.push(row);
}
routes.sort((a, b) => a.id.localeCompare(b.id));

// ----- Build audit.config -----
const CONFIG_ENUM = new Set(['ACTIVE', 'WIRED-NOT-USED', 'NOT-WIRED', 'DEAD']);
function normalizeClassification(raw) {
  if (!raw) return 'ACTIVE';
  if (raw === 'ACTIVE (internal)') return 'ACTIVE';
  if (CONFIG_ENUM.has(raw)) return raw;
  return 'ACTIVE';
}

const config = [];

// BladeConfig + DiskConfig struct fields
for (const c of configDoc.config) {
  const row = {
    field: c.field,
    file: c.file,
    classification: normalizeClassification(c.classification),
  };
  if (c.struct) row.struct = c.struct; // OMIT key when absent per schema (no null)
  if (typeof c.disk_persisted === 'boolean') row.disk_persisted = c.disk_persisted;
  if (c.ui_surface !== undefined) row.ui_surface = c.ui_surface ?? null;
  if (c.control_type) row.control_type = c.control_type;
  config.push(row);
}

// Statics — namespace the field; OMIT struct key
for (const s of configDoc.statics) {
  config.push({
    field: `static::${s.name}`,
    file: s.file,
    classification: normalizeClassification(s.classification),
    disk_persisted: false,
    ui_surface: null,
    control_type: s.type || 'static',
  });
}

// Environment variables
for (const e of configDoc.env_vars) {
  config.push({
    field: `env::${e.name}`,
    file: e.file,
    classification: normalizeClassification(e.classification),
    disk_persisted: false,
    ui_surface: e.ui_surface ?? null,
    control_type: 'env_var',
  });
}

// Cargo feature flags
for (const f of configDoc.cargo_features) {
  config.push({
    field: `cargo_feature::${f.name}`,
    file: f.file,
    classification: normalizeClassification(f.classification),
    disk_persisted: false,
    ui_surface: null,
    control_type: 'cargo_feature',
  });
}

// Keyring secrets (storage location only)
for (const k of configDoc.keyring_secrets) {
  config.push({
    field: `keyring::${k.service}::${k.key}`,
    file: k.file,
    classification: 'ACTIVE',
    disk_persisted: false,
    ui_surface: 'src/features/settings/panes/ProvidersPane.tsx',
    control_type: 'keyring',
  });
}

config.sort((a, b) => a.field.localeCompare(b.field));

// ----- Build audit.not_wired_backlog -----
const not_wired_backlog = [];

for (const m of modulesDoc.modules) {
  if (m.classification !== 'NOT-WIRED') continue;
  let isDeferred = false;
  let deferralRationale = null;
  const notesLower = (m.notes || '').toLowerCase();
  if (notesLower.includes('deferred to v1.2')) {
    isDeferred = true;
    deferralRationale = m.notes;
  } else if (Array.isArray(m.commands)) {
    for (const c of m.commands) {
      if (isActingTentacle(c.name)) {
        isDeferred = true;
        deferralRationale = 'deferred to v1.2 — acting capability (M-03 observe-only guardrail)';
        break;
      }
    }
  }
  const entryPoints = Array.isArray(m.backend_entry_points) && m.backend_entry_points.length > 0
    ? m.backend_entry_points
    : [`${m.file}:1`];
  not_wired_backlog.push({
    item_type: 'module',
    identifier: m.file,
    backend_entry_points: entryPoints,
    phase_14_owner: isDeferred ? 'DEFERRED_V1_2' : 'WIRE2',
    deferral_rationale: deferralRationale,
  });
}

for (const r of routesDoc.routes) {
  if (r.classification !== 'NOT-WIRED') continue;
  not_wired_backlog.push({
    item_type: 'route',
    identifier: r.id,
    backend_entry_points: [`${r.file}:1`],
    phase_14_owner: 'WIRE2',
    deferral_rationale: null,
  });
}

for (const c of configDoc.config) {
  const cls = c.classification;
  if (cls !== 'NOT-WIRED' && cls !== 'WIRED-NOT-USED') continue;
  const rationale = cls === 'WIRED-NOT-USED'
    ? (c.notes && c.notes.length > 0 ? `6-place-rule gap: ${c.notes.slice(0, 140)}` : '6-place-rule gap; add to DiskConfig')
    : null;
  not_wired_backlog.push({
    item_type: 'config',
    identifier: c.field,
    backend_entry_points: [c.file],
    phase_14_owner: 'WIRE2',
    deferral_rationale: rationale,
  });
}

for (const f of configDoc.cargo_features) {
  if (f.classification !== 'NOT-WIRED') continue;
  not_wired_backlog.push({
    item_type: 'config',
    identifier: `cargo_feature::${f.name}`,
    backend_entry_points: [f.file],
    phase_14_owner: 'WIRE2',
    deferral_rationale: f.notes ? f.notes.slice(0, 160) : null,
  });
}

for (const e of configDoc.env_vars) {
  if (e.classification !== 'WIRED-NOT-USED') continue;
  not_wired_backlog.push({
    item_type: 'config',
    identifier: `env::${e.name}`,
    backend_entry_points: [e.file],
    phase_14_owner: 'WIRE2',
    deferral_rationale: e.notes ? e.notes.slice(0, 160) : null,
  });
}

// ----- Build audit.dead_deletion_plan -----
const dead_deletion_plan = [];

for (const m of modulesDoc.modules) {
  if (m.classification !== 'DEAD') continue;
  dead_deletion_plan.push({
    identifier: m.file,
    callers: Array.isArray(m.internal_callers) ? m.internal_callers : [],
    imports: [],
    safe_to_delete: !Array.isArray(m.internal_callers) || m.internal_callers.length === 0,
    deletion_note: m.notes || 'No callers; no UI surface; not in v1.1 or v1.2 roadmap.',
  });
}

for (const c of configDoc.config) {
  if (c.classification !== 'DEAD') continue;
  dead_deletion_plan.push({
    identifier: c.field,
    callers: [c.file],
    imports: [],
    safe_to_delete: true,
    deletion_note: c.notes || 'Legacy field; superseded by BladeConfig counterpart.',
  });
}

// ----- Assemble the audit object -----
const audit = {
  schema_version: '1.0.0',
  generated_at: new Date().toISOString(),
  modules,
  routes,
  config,
  not_wired_backlog,
  dead_deletion_plan,
};

writeFileSync(AUDIT_JSON, JSON.stringify(audit, null, 2) + '\n', 'utf8');

console.log(`[synthesize-audit] wrote ${AUDIT_JSON}`);
console.log(`  modules: ${modules.length}`);
console.log(`  routes: ${routes.length}`);
console.log(`  config: ${config.length}`);
console.log(`  not_wired_backlog: ${not_wired_backlog.length}`);
console.log(`  dead_deletion_plan: ${dead_deletion_plan.length}`);
const deferredCount = not_wired_backlog.filter(r => r.phase_14_owner === 'DEFERRED_V1_2').length;
console.log(`  deferred_v1_2: ${deferredCount}`);
