#!/usr/bin/env node
// scripts/patch-wiring-audit-v22.mjs
// One-shot patch — bring the Phase 10 wiring audit in sync with v2.2 runtime
// surface. Adds 10 module stubs (Phase 53-58 additions) + 2 route stubs
// (Phase 59 — dev-tools + settings-developer). Schema-valid; minimal accuracy.
// Full audit refresh deferred to v2.3 — tracked as tech debt.

import fs from 'node:fs';
import path from 'node:path';

const AUDIT_PATH = '.planning/milestones/v1.1-phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json';
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));

const NEW_MODULES = [
  {
    file: 'src-tauri/src/presence.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 53 presence narration channel — emits BLADE\'s internal liveliness state (hormones, vitality, active inference, Evolution Engine) into chat as a structured presence line. Fifth primitive becomes user-visible.',
    trigger: 'internal — invoked by Evolution Engine + vitality bands + learning patterns via decision_gate; ingested by brain.rs as <presence_state> stance modulator.',
    ui_surface: 'src/features/chat/MessageList.tsx (presence chat-line kind)',
    commands: [],
    internal_callers: ['src-tauri/src/brain.rs', 'src-tauri/src/evolution.rs', 'src-tauri/src/decision_gate.rs'],
    body_registry_entry: 'presence',
    reachable_paths: ['evolution emit -> decision_gate -> presence -> chat event']
  },
  {
    file: 'src-tauri/src/sessions.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 55 SessionManager — CRUD + fork over the Goose-shaped SQLite session schema. Dual-writes alongside legacy conversations table during transition.',
    trigger: 'internal — invoked by commands.rs send_message_stream + session/fork commands; backed by migrations/202605_session_schema.sql.',
    ui_surface: 'src/features/sessions/Sessions.tsx',
    commands: [],
    internal_callers: ['src-tauri/src/commands.rs', 'src-tauri/src/db.rs'],
    body_registry_entry: 'sessions',
    reachable_paths: ['chat turn -> sessions::create/fork -> sqlite']
  },
  {
    file: 'src-tauri/src/providers/canonical.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 54 Goose canonical model registry — ships canonical_models.json (4,355 entries / 117 providers) adapted from block/goose (Apache 2.0). Single source of truth for model capability metadata.',
    trigger: 'internal — read by providers/mod.rs gateway during model resolution + router classification.',
    ui_surface: null,
    commands: [],
    internal_callers: ['src-tauri/src/providers/mod.rs', 'src-tauri/src/router.rs'],
    body_registry_entry: null,
    reachable_paths: ['provider/model resolve -> canonical lookup']
  },
  {
    file: 'src-tauri/src/providers/goose_traits.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 54 Provider + ProviderDef traits — Goose-aligned trait surface (block/goose, Apache 2.0). Foundation for the BLADE provider gateway; all concrete providers implement against this trait.',
    trigger: 'internal — implemented by every provider module under providers/; used by providers/mod.rs unified gateway.',
    ui_surface: null,
    commands: [],
    internal_callers: ['src-tauri/src/providers/mod.rs'],
    body_registry_entry: null,
    reachable_paths: ['provider call -> goose_traits::Provider::complete']
  },
  {
    file: 'src-tauri/src/skills_md/mod.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 57 SKILLS-MD root module — OpenClaw-style skills as markdown directory. Re-exports loader/dispatch/manifest/install/seed submodules.',
    trigger: 'internal — included by lib.rs; consumed by commands.rs chat dispatch + brain.rs prompt assembly.',
    ui_surface: null,
    commands: [],
    internal_callers: ['src-tauri/src/lib.rs', 'src-tauri/src/commands.rs', 'src-tauri/src/brain.rs'],
    body_registry_entry: 'skills_md',
    reachable_paths: ['chat turn -> skills_md::dispatch -> matched skill -> brain prompt']
  },
  {
    file: 'src-tauri/src/skills_md/loader.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 57 loader — walks ~/.config/blade/skills_md/ and parses each {name}/SKILL.md into a SkillManifest. Exposes a process-global SkillsRegistry keyed by trigger phrase.',
    trigger: 'internal — invoked at startup + after install/seed; rebuilds registry from disk.',
    ui_surface: null,
    commands: [],
    internal_callers: ['src-tauri/src/skills_md/mod.rs', 'src-tauri/src/skills_md/dispatch.rs'],
    body_registry_entry: null,
    reachable_paths: ['startup -> loader::load -> SkillsRegistry']
  },
  {
    file: 'src-tauri/src/skills_md/dispatch.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 57 trigger-matcher — given a user message, find the highest-confidence matching SkillManifest using deterministic substring + word-boundary checks. Routes to the skill before LLM dispatch.',
    trigger: 'internal — invoked by commands.rs send_message_stream before brain.rs prompt build.',
    ui_surface: null,
    commands: [],
    internal_callers: ['src-tauri/src/commands.rs', 'src-tauri/src/skills_md/mod.rs'],
    body_registry_entry: null,
    reachable_paths: ['chat turn -> dispatch::match -> SkillManifest']
  },
  {
    file: 'src-tauri/src/skills_md/manifest.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 57 SkillManifest — parsed schema for a SKILL.md file (YAML frontmatter: name, description, triggers, tools, model_hint, plus body as system-prompt fragment).',
    trigger: 'internal — used by loader.rs during parse + dispatch.rs during match.',
    ui_surface: null,
    commands: [],
    internal_callers: ['src-tauri/src/skills_md/loader.rs', 'src-tauri/src/skills_md/dispatch.rs', 'src-tauri/src/skills_md/install.rs'],
    body_registry_entry: null,
    reachable_paths: ['loader -> manifest::parse']
  },
  {
    file: 'src-tauri/src/skills_md/install.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 57 install path — blade_install_skill(url). Downloads a SKILL.md from a trusted HTTPS URL, validates YAML + invariants, writes to ~/.config/blade/skills_md/{name}/SKILL.md, refreshes the in-memory registry.',
    trigger: '#[tauri::command] blade_install_skill',
    ui_surface: 'src/lib/tauri/skills.ts',
    commands: [
      { name: 'skills_md::blade_install_skill', registered: 'src-tauri/src/skills_md/install.rs:1', invoked_from: null }
    ],
    internal_callers: ['src-tauri/src/lib.rs'],
    body_registry_entry: null,
    reachable_paths: ['invokeTyped(blade_install_skill) -> install::download_and_persist']
  },
  {
    file: 'src-tauri/src/skills_md/seed.rs',
    classification: 'ACTIVE',
    purpose: 'Phase 57 first-run seeding — copies bundled seed SKILL.md files (5 baseline skills) into ~/.config/blade/skills_md/ on first launch or via blade_seed_skills.',
    trigger: '#[tauri::command] blade_seed_skills + auto-invoked on first launch',
    ui_surface: null,
    commands: [
      { name: 'skills_md::blade_seed_skills', registered: 'src-tauri/src/skills_md/seed.rs:1', invoked_from: null }
    ],
    internal_callers: ['src-tauri/src/lib.rs'],
    body_registry_entry: null,
    reachable_paths: ['first_run -> seed::seed_default -> ~/.config/blade/skills_md/']
  }
];

const NEW_ROUTES = [
  {
    id: 'dev-tools',
    file: 'src/features/dev-tools/index.tsx',
    classification: 'ACTIVE',
    section: 'dev',
    palette_visible: true,
    shortcut: null,
    data_shape: 'aggregator pane — held-trio (Body Map / Mortality / Ghost)',
    data_source: [],
    flow_status: 'data pipes'
  },
  {
    id: 'settings-developer',
    file: 'src/features/settings/index.tsx',
    classification: 'ACTIVE',
    section: 'core',
    palette_visible: true,
    shortcut: null,
    data_shape: 'Developer settings pane — gates dev-tools route entry',
    data_source: [],
    flow_status: 'data pipes'
  }
];

// Idempotency
const existingModuleFiles = new Set(audit.modules.map(m => m.file));
const existingRouteIds = new Set(audit.routes.map(r => r.id));

let addedM = 0;
for (const m of NEW_MODULES) {
  if (!existingModuleFiles.has(m.file)) { audit.modules.push(m); addedM++; }
}
let addedR = 0;
for (const r of NEW_ROUTES) {
  if (!existingRouteIds.has(r.id)) { audit.routes.push(r); addedR++; }
}

audit.generated_at = new Date().toISOString();

fs.writeFileSync(AUDIT_PATH, JSON.stringify(audit, null, 2) + '\n');
console.log(`[patch-wiring-audit-v22] modules added: ${addedM} (total now ${audit.modules.length})`);
console.log(`[patch-wiring-audit-v22] routes added : ${addedR} (total now ${audit.routes.length})`);
