#!/usr/bin/env node
// scripts/_render-audit-md.mjs — Phase 10 Plan 05 Task 2.
//
// Renders .planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md from
// the 10-WIRING-AUDIT.json sidecar + the 3 Wave-1 YAMLs (for supplementary
// Section 2b windows, Section 3b-3e non-struct config blocks).
//
// Deleted alongside _synthesize-audit.mjs in Task 3.

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHASE_DIR = `${ROOT}/.planning/phases/10-inventory-wiring-audit`;
const AUDIT_JSON = `${PHASE_DIR}/10-WIRING-AUDIT.json`;
const ROUTES_YAML = `${PHASE_DIR}/10-ROUTES.yaml`;
const CONFIG_YAML = `${PHASE_DIR}/10-CONFIG.yaml`;
const MODULES_YAML = `${PHASE_DIR}/10-MODULES.yaml`;
const OUT_MD = `${PHASE_DIR}/10-WIRING-AUDIT.md`;

// YAML via python3 + PyYAML (no shell).
function loadYaml(path) {
  const script = 'import yaml,json,sys;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))';
  const raw = execFileSync('python3', ['-c', script, path], {
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(raw.toString('utf8'));
}

const audit = JSON.parse(readFileSync(AUDIT_JSON, 'utf8'));
const routesDoc = loadYaml(ROUTES_YAML);
const configDoc = loadYaml(CONFIG_YAML);
const modulesDoc = loadYaml(MODULES_YAML);

// ---------- helpers ----------
const EM = '—';
function esc(v) {
  if (v === null || v === undefined || v === '') return EM;
  const s = String(v);
  // Escape pipes inside table cells
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function bool(v) { return v === true ? '✓' : (v === false ? '✗' : EM); }
function truncate(s, n = 140) {
  if (!s) return EM;
  const str = String(s);
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// ---------- counts ----------
const modCls = { ACTIVE: 0, 'WIRED-NOT-USED': 0, 'NOT-WIRED': 0, DEAD: 0 };
for (const m of audit.modules) modCls[m.classification] = (modCls[m.classification] || 0) + 1;

const routeCls = { ACTIVE: 0, 'ACTIVE (dev-only)': 0, 'WIRED-NOT-USED': 0, 'NOT-WIRED': 0, DEAD: 0 };
// Count prod routes from audit.routes
for (const r of audit.routes) routeCls[r.classification] = (routeCls[r.classification] || 0) + 1;
// Count dev-only from the original YAML (not in JSON)
for (const r of routesDoc.routes) {
  if (r.classification === 'ACTIVE (dev-only)') routeCls['ACTIVE (dev-only)']++;
}

const configCls = { ACTIVE: 0, 'WIRED-NOT-USED': 0, 'NOT-WIRED': 0, DEAD: 0 };
for (const c of audit.config) configCls[c.classification] = (configCls[c.classification] || 0) + 1;

const deferredCount = audit.not_wired_backlog.filter(r => r.phase_14_owner === 'DEFERRED_V1_2').length;

// ---------- build markdown ----------
const parts = [];
parts.push(`# Phase 10 — Inventory & Wiring Audit (resolves AUDIT-01..05)

> Scanned: \`src-tauri/src/**/*.rs\`, \`src/windows/main/router.ts\`, \`src/features/*/index.tsx\`, \`src-tauri/src/config.rs\`, \`src-tauri/Cargo.toml\`
> Policy: D-48 — ACTIVE (invoked + subscribed), WIRED-NOT-USED (UI exists, backend silent), NOT-WIRED (backend exists, no UI), DEAD (no callers + not in v1.1 or v1.2 roadmap)
> Note: Read-only audit. No code changes. \`10-WIRING-AUDIT.json\` sidecar is the machine-parseable source of truth; this Markdown is the human view.
> Sidecar: \`.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json\` (validates against \`10-WIRING-AUDIT.schema.json\` via \`npm run verify:wiring-audit-shape\`).

## Summary

- Total Rust modules classified: **${audit.modules.length}** (\`src-tauri/src/**/*.rs\`; excludes \`build.rs\`)
- Total prod routes classified: **${audit.routes.length}** (+ **${routeCls['ACTIVE (dev-only)']}** ACTIVE (dev-only) routes gated on \`import.meta.env.DEV\`)
- Total config surfaces cataloged: **${audit.config.length}** (${configDoc.config.length} struct fields + ${configDoc.statics.length} statics + ${configDoc.env_vars.length} env vars + ${configDoc.cargo_features.length} cargo feature + ${configDoc.keyring_secrets.length} keyring secrets)
- NOT-WIRED backlog: **${audit.not_wired_backlog.length}** items → Phase 14 consumes verbatim
- DEAD deletion plan: **${audit.dead_deletion_plan.length}** items → Phase 14 removes safely
- Deferred-to-v1.2 (Appendix B): **${deferredCount}** items
- Classifications:
  - Modules: ${modCls.ACTIVE} ACTIVE, ${modCls['WIRED-NOT-USED']} WIRED-NOT-USED, ${modCls['NOT-WIRED']} NOT-WIRED, ${modCls.DEAD} DEAD
  - Routes (prod): ${routeCls.ACTIVE} ACTIVE, ${routeCls['WIRED-NOT-USED']} WIRED-NOT-USED, ${routeCls['NOT-WIRED']} NOT-WIRED, ${routeCls.DEAD} DEAD
  - Config: ${configCls.ACTIVE} ACTIVE, ${configCls['WIRED-NOT-USED']} WIRED-NOT-USED, ${configCls['NOT-WIRED']} NOT-WIRED, ${configCls.DEAD} DEAD
- Cross-reference overrides: **0** modules reclassified from NOT-WIRED → ACTIVE via \`verify-phase{5..8}-rust-surface.sh\` command-set membership (Subagent A classifications were already accurate).

---

## 1. Module Catalog

Source: \`10-WIRING-AUDIT.json::modules[]\`. Every \`.rs\` file under \`src-tauri/src/\` (excluding \`build.rs\`). Nested \`agents/\`, \`hormones/\`, \`plugins/\`, \`tentacles/\` subdirectories flat-listed (sorted alphabetically by \`file\`).

| file | classification | purpose | trigger | ui_surface |
|------|----------------|---------|---------|------------|`);

for (const m of audit.modules) {
  parts.push(`| \`${m.file}\` | ${m.classification} | ${esc(truncate(m.purpose, 120))} | ${esc(truncate(m.trigger, 100))} | ${m.ui_surface ? `\`${m.ui_surface}\`` : EM} |`);
}

parts.push(`
---

## 2. Route + Command-Palette Catalog

Source: \`10-WIRING-AUDIT.json::routes[]\` (${audit.routes.length} prod rows) + \`10-ROUTES.yaml::routes[]\` (${routeCls['ACTIVE (dev-only)']} dev-only rows; not in JSON because the \`...(import.meta.env.DEV ? devRoutes : [])\` spread is parser-invisible to \`verify-wiring-audit-shape\`) + 4 non-main window shells (\`10-ROUTES.yaml::windows[]\`, also not in JSON).

Correction vs \`10-CONTEXT.md §D-49\`: CommandPalette is mounted ONLY in \`src/windows/main/MainShell.tsx\`. Palette entries = \`ROUTE_MAP\` filtered by \`paletteHidden !== true\`. The 4 non-main windows (quickask, hud, ghost, overlay) do not host palettes.

### 2a. Routes (prod — palette-eligible)

| id | file | classification | section | palette_visible | shortcut | data_shape | flow_status |
|----|------|----------------|---------|-----------------|----------|------------|-------------|`);

for (const r of audit.routes) {
  parts.push(`| \`${r.id}\` | \`${r.file}\` | ${r.classification} | ${r.section} | ${bool(r.palette_visible)} | ${r.shortcut ? `\`${r.shortcut}\`` : EM} | ${esc(truncate(r.data_shape, 80))} | ${r.flow_status || EM} |`);
}

parts.push(`
### 2b. Dev-only Routes (gated on \`import.meta.env.DEV\`)

Source: \`10-ROUTES.yaml::routes[]\` filtered to \`classification: "ACTIVE (dev-only)"\`. Tree-shaken from prod bundle; live in \`src/features/dev/index.tsx\`.

| id | component_file | section | phase | palette_visible | notes |
|----|----------------|---------|-------|-----------------|-------|`);

for (const r of routesDoc.routes) {
  if (r.classification !== 'ACTIVE (dev-only)') continue;
  parts.push(`| \`${r.id}\` | \`${r.component_file || r.file}\` | ${r.section} | ${r.phase ?? EM} | ${bool(r.palette_visible)} | ${esc(truncate(r.notes, 120))} |`);
}

parts.push(`
### 2c. Window Shells (no palette by design)

Source: \`10-ROUTES.yaml::windows[]\`. Not in JSON because they are shells, not routes. 4 non-main windows; CommandPalette is main-only per Pitfall 1.

| label | file | component | classification | notes |
|-------|------|-----------|----------------|-------|`);

for (const w of routesDoc.windows) {
  parts.push(`| \`${w.label}\` | \`${w.file}\` | \`${w.component}\` | ${w.classification} | ${esc(truncate(w.notes, 160))} |`);
}

parts.push(`
---

## 3. Config Surface Catalog

Source: \`10-WIRING-AUDIT.json::config[]\` (${audit.config.length} rows; folded representation of struct fields + statics + env vars + cargo features + keyring secrets) with non-struct surfaces surfaced in sub-tables 3b–3e below for readability.

### 3a. BladeConfig + DiskConfig struct fields

Source: \`10-CONFIG.yaml::config[]\` (${configDoc.config.length} fields). The \`struct\` column disambiguates in-memory \`BladeConfig\` from on-disk \`DiskConfig\` (both share many names; presence in both is the 6-place-rule contract).

| field | file:line | struct | disk_persisted | classification | ui_surface | control_type |
|-------|-----------|--------|----------------|----------------|------------|--------------|`);

for (const c of configDoc.config) {
  parts.push(`| \`${c.field}\` | \`${c.file}\` | ${c.struct || EM} | ${bool(c.disk_persisted)} | ${c.classification} | ${c.ui_surface ? `\`${c.ui_surface}\`` : EM} | ${c.control_type || EM} |`);
}

parts.push(`
Rows with \`disk_persisted: false\` in \`BladeConfig\` that have a matching pub field in \`DiskConfig\` are flagged as 6-place-rule violations per Pitfall 8. Phase 14 WIRE2 agenda consumes them via \`not_wired_backlog[item_type=config]\`.

### 3b. Static AtomicBool / Lazy toggles (non-field config)

Source: \`10-CONFIG.yaml::statics[]\` (${configDoc.statics.length} entries). Surfaced in \`10-WIRING-AUDIT.json::config[]\` as \`field: "static::<NAME>"\`. These are internal control-loop guards (see \`notes/v1-1-milestone-shape.md\` §"Why this framing" #4 — "Background terminal noise, no in-UI activity surface"); LOG-02 (Phase 14) will instrument emit coverage for them.

| name | file:line | type | default | toggled_by | classification |
|------|-----------|------|---------|------------|----------------|`);

for (const s of configDoc.statics) {
  parts.push(`| \`${s.name}\` | \`${s.file}\` | ${s.type || EM} | \`${s.default ?? EM}\` | ${esc(truncate(s.toggled_by, 80))} | ${s.classification} |`);
}

parts.push(`
### 3c. Environment variables

Source: \`10-CONFIG.yaml::env_vars[]\` (${configDoc.env_vars.length} entries). Surfaced in JSON as \`field: "env::<NAME>"\`.

| name | file:line | read_by | classification | ui_surface |
|------|-----------|---------|----------------|------------|`);

for (const e of configDoc.env_vars) {
  parts.push(`| \`${e.name}\` | \`${e.file}\` | ${esc(truncate(e.read_by, 100))} | ${e.classification} | ${e.ui_surface ? `\`${e.ui_surface}\`` : EM} |`);
}

parts.push(`
### 3d. Cargo feature flags

Source: \`10-CONFIG.yaml::cargo_features[]\` (${configDoc.cargo_features.length} entry). Surfaced in JSON as \`field: "cargo_feature::<NAME>"\`.

| name | file:line | default_enabled | gated_modules | classification |
|------|-----------|-----------------|----------------|----------------|`);

for (const f of configDoc.cargo_features) {
  const mods = Array.isArray(f.gated_modules) ? f.gated_modules.map(m => `\`${m}\``).join(', ') : EM;
  parts.push(`| \`${f.name}\` | \`${f.file}\` | ${bool(f.default_enabled)} | ${mods} | ${f.classification} |`);
}

parts.push(`
### 3e. Keyring-stored secrets (location only)

Source: \`10-CONFIG.yaml::keyring_secrets[]\` (${configDoc.keyring_secrets.length} entries). Values never read; storage location only. Surfaced in JSON as \`field: "keyring::<service>::<key>"\`.

| service | key | file:line | storage_location |
|---------|-----|-----------|-------------------|`);

for (const k of configDoc.keyring_secrets) {
  parts.push(`| \`${k.service}\` | \`${k.key}\` | \`${k.file}\` | ${k.storage_location} |`);
}

parts.push(`
---

## 4. NOT-WIRED Backlog

Source: \`10-WIRING-AUDIT.json::not_wired_backlog[]\` (${audit.not_wired_backlog.length} rows). Phase 14 WIRE2 consumes verbatim.

| item_type | identifier | backend_entry_points | phase_14_owner | deferral_rationale |
|-----------|-----------|----------------------|-----------------|--------------------|`);

for (const row of audit.not_wired_backlog) {
  const eps = row.backend_entry_points.map(ep => `\`${ep}\``).join(', ');
  parts.push(`| ${row.item_type} | \`${row.identifier}\` | ${eps} | ${row.phase_14_owner} | ${esc(truncate(row.deferral_rationale, 140))} |`);
}

parts.push(`
Phase 14 owners:

- **WIRE2** — standard wiring task (add UI surface or fix broken invoke)
- **A11Y2** — accessibility-related (screen-reader label, focus trap)
- **LOG** — activity-log instrumentation (LOG-02)
- **DENSITY** — empty-state polish (DENSITY-05/06)
- **DEFERRED_V1_2** — deferred per M-03; do NOT wire in v1.1 (see Appendix B)

---

## 5. DEAD Deletion Plan

Source: \`10-WIRING-AUDIT.json::dead_deletion_plan[]\` (${audit.dead_deletion_plan.length} row${audit.dead_deletion_plan.length === 1 ? '' : 's'}). Phase 14 removal backlog.

DEAD classification per D-48: no \`invoke\` callers, no \`listen\` subscribers, no internal Rust callers, AND not referenced in roadmap/requirements for v1.1 **or** v1.2. Borderline items stay in §4 with a \`deferred to v1.2\` note — they are NOT listed here.

| identifier | callers | imports | safe_to_delete | deletion_note |
|-----------|---------|---------|----------------|----------------|`);

if (audit.dead_deletion_plan.length === 0) {
  parts.push(`| (none) | — | — | — | No modules or config fields met the DEAD bar; borderline items deferred to v1.2 remain in §4 per D-48. |`);
} else {
  for (const row of audit.dead_deletion_plan) {
    const callers = row.callers.length > 0 ? row.callers.map(c => `\`${c}\``).join(', ') : EM;
    const imports = row.imports.length > 0 ? row.imports.map(i => `\`${i}\``).join(', ') : EM;
    parts.push(`| \`${row.identifier}\` | ${callers} | ${imports} | ${bool(row.safe_to_delete)} | ${esc(truncate(row.deletion_note, 200))} |`);
  }
}

parts.push(`
---

## Appendix A — Tester-Pass Evidence Map

Cross-references the 7 symptoms from \`.planning/notes/v1-1-milestone-shape.md\` §"Why this framing" (lines 26-39) to catalog rows above. Grounds the audit in falsifiable tester-observed reality — this is the gap-list seed per D-48.

| # | Symptom | Classification | Catalog row (§/table:row) | Rationale |
|---|---------|----------------|---------------------------|-----------|
| 1 | Chat broken for first message (silent failure, no error surfaced) | ACTIVE (post-fix) | §1 \`src-tauri/src/commands.rs\` (ACTIVE) | Fixed by commit \`4ab464c\` (tester-pass-1); \`chat_error\` BLADE_EVENTS key is present with frontend subscriber confirmed in \`src/lib/events/\` + \`src/features/chat/useChat.tsx\`. Audit keeps the module ACTIVE but the row is listed here so future regressions are checked against the symptom. |
| 2 | Deep scan found 1 repo (the scanner is dumb) | ACTIVE (but under-capability) | §1 \`src-tauri/src/deep_scan.rs\`, \`indexer.rs\`, \`file_indexer.rs\` (all ACTIVE — scan command is registered and invoked) | Scanner logic is single-source-class; Phase 12 "Smart Deep Scan" owns the upgrade. §1 surfaces the modules; Phase 12 planning uses §1 rows as its starting inventory. |
| 3 | Dashboard pages feel empty | WIRED-NOT-USED (data sparse) | §2a \`dashboard\` (ACTIVE — data pipes) + §1 \`perception_fusion.rs\` + \`homeostasis.rs\` + \`typed_memory.rs\` (all ACTIVE) | Backend exists and data pipes are connected, but upstream signal is sparse until Phase 12 scan ships. DENSITY-05/07 (Phase 15) + WIRE2-02 (Phase 14) consume empty-state rows from §3a. |
| 4 | Background terminal noise, no in-UI activity surface | NOT-WIRED (emit coverage) | §3b (${configDoc.statics.length} \`AtomicBool\` / static control-loop guards) + §4 activity-log event entries | LOG-02 (Phase 14) consumes §3b row-by-row to instrument emit coverage; the Activity Log strip is load-bearing (M-07). Static guards toggle silently today — no emit, no UI surface. |
| 5 | UI cluttered, no pad, no breathing room | — (out of Phase 10 scope) | Phase 15 DENSITY pass | Phase 10 is read-only classification; DENSITY-01..08 in Phase 15 own the visual-language rework. No catalog row here by design. |
| 6 | Options the tester expected weren't reachable | NOT-WIRED (config) | §3a rows with \`ui_surface: null\` + §4 \`item_type: config\` rows (${audit.not_wired_backlog.filter(r => r.item_type === 'config').length} entries) | Subagent C primary finding set: 48 WIRED-NOT-USED \`BladeConfig\` fields have no Settings control. Phase 14 WIRE2 wires them into Settings panes. |
| 7 | Groq + llama produced nothing useful (no capability-aware routing) | WIRED-NOT-USED | §1 \`src-tauri/src/router.rs\` (ACTIVE — routing logic exists) + \`providers/mod.rs\` (ACTIVE) + §3a \`BladeConfig.vision_provider\` / \`audio_provider\` / \`long_context_provider\` / \`tools_provider\` (6-place gaps) | PROV-06/09 (Phase 11) consumes the 6-place-gap config rows as its pre-seeded backlog. Audit surfaces the surface; Phase 11 implements capability-aware routing. |

Verified: commit \`4ab464c\` (\`fix(tester-pass-1): silence log spam, stop self_upgrade loop, surface chat errors\`) is the tester-pass-1 remediation on master (confirmed via \`git log --oneline --grep=tester-pass\`).

---

## Appendix B — Deferred-to-v1.2 Rationale

Items marked \`phase_14_owner: "DEFERRED_V1_2"\` in §4 (${deferredCount} row${deferredCount === 1 ? '' : 's'}). Phase 14 does NOT wire these in v1.1. Phase 14 planning refers to Appendix B by reference (no re-arguing scope).

| identifier | item_type | rationale | v1.1 policy |
|-----------|-----------|-----------|-------------|`);

const deferredRows = audit.not_wired_backlog.filter(r => r.phase_14_owner === 'DEFERRED_V1_2');
if (deferredRows.length === 0) {
  parts.push(`| (none) | — | No acting-tentacle modules remained classified NOT-WIRED (all known acting surfaces either already ACTIVE or not present in v1.1 surface) | — |`);
} else {
  for (const row of deferredRows) {
    parts.push(`| \`${row.identifier}\` | ${row.item_type} | ${esc(truncate(row.deferral_rationale, 200))} | NOT-WIRED in v1.1; M-03 observe-only guardrail enforces runtime block on acting-tentacle commands |`);
  }
}

parts.push(`
**Scope anchors:** M-03 is locked in \`.planning/PROJECT.md\` + \`.planning/notes/v1-1-milestone-shape.md\` §"What we're explicitly not doing in v1.1"; the runtime block will land in a Phase 11+ guard plan. v1.2 (\`.planning/notes/v2-vision-tentacles.md\`) is where acting-tentacle commands become user-reachable surfaces.

---

## Meta-findings

- **\`./CLAUDE.md\` is outdated (meta note, not in any backlog):** the "New route — 3 places in App.tsx" block at lines around 116-120 of the project CLAUDE.md predates the per-feature \`routes: RouteDefinition[]\` export + \`src/windows/main/router.ts\` aggregation pattern (FOUND-07, D-40). A one-line correction belongs in a Phase 14 doc-polish task; the audit flags it here so it's not lost.
- **Subagent A classifications were already accurate:** 0 modules needed reclassification after cross-referencing against \`scripts/verify-phase{5..8}-rust-surface.sh\` (458 unique ACTIVE commands across the four scripts). Every module Subagent A marked NOT-WIRED really is NOT-WIRED from the frontend's perspective.
- **CommandPalette is main-only** (Pitfall 1 verified): the 4 non-main window shells (quickask, hud, ghost, overlay) do not host palettes. §2c documents them separately from palette-eligible routes in §2a.
- **Single DEAD entry in the whole audit:** only \`DiskConfig.api_key\` qualifies as DEAD (legacy one-shot migration field; replaced by keyring storage). All other borderline modules stay NOT-WIRED with a deferred-to-v1.2 note per D-48. This tracks — v1.0 shipped 130+ modules and v1.1 is about wiring, not deleting.
- **Emit cross-reference (Pitfall 2):** the \`00-EMIT-AUDIT.md\` 247-site inventory has 42 cross-window emits + 142 single-window emits. Every module that emits a cross-window event was already classified ACTIVE by Subagent A (because its module also registers a \`#[tauri::command]\` invoked from \`src/\`); no additional upgrades were needed.

---

*Audit produced: ${new Date().toISOString().slice(0, 10)}. No source code modified (read-only phase per D-50). ${audit.modules.length} modules + ${audit.routes.length} prod routes (+${routeCls['ACTIVE (dev-only)']} dev-only) + ${audit.config.length} config surfaces classified. Sidecar at \`10-WIRING-AUDIT.json\` (schema 1.0.0).*
`);

writeFileSync(OUT_MD, parts.join('\n'), 'utf8');
console.log(`[render-audit-md] wrote ${OUT_MD} (${parts.length} blocks)`);
