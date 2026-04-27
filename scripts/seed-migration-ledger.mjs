#!/usr/bin/env node
// scripts/seed-migration-ledger.mjs
// Phase 1 Plan 08 — Migration ledger seed (FOUND-11, D-27, D-28, P-03).
//
// Walks src/features/<cluster>/index.tsx files, parses every RouteDefinition
// entry (id / label / section / phase), heuristically finds a src.bak/components/*.tsx
// analog for each route (so D-17 stays honored — src.bak is read-only reference),
// and writes .planning/migration-ledger.md.
//
// Idempotent: re-running preserves existing `status` column values for rows that
// still exist. New routes land as `Pending`. Missing rows stay missing (Plan 09's
// verify-migration-ledger.mjs will fail CI on orphan route-ids so we don't silently
// drop coverage).
//
// Usage:
//   node scripts/seed-migration-ledger.mjs
//   npm run seed:ledger
//
// Enforcement (D-27): CI script + checklist doc, not reviewer-required PR gate.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-27 §D-28 §D-44
// @see .planning/research/PITFALLS.md §P-03
// @see .planning/phases/01-foundation/01-08-PLAN.md

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');

// ───────────────────────────────────────────────────────────────────────────
// 1. Parse feature index (src/features/<cluster>/index.tsx)
//    Regex targets RouteDefinition object literals. The `[\s\S]*?` is
//    non-greedy so we don't overshoot past the next closing brace into the
//    following entry.
// ───────────────────────────────────────────────────────────────────────────
const ROUTE_RE =
  /\{\s*id:\s*'([a-z][a-z0-9-]*)',\s*label:\s*'([^']+)',\s*section:\s*'([a-z]+)'[\s\S]*?phase:\s*(\d+)/g;

function parseFeatureIndex(path) {
  const src = readFileSync(path, 'utf8');
  const matches = [...src.matchAll(ROUTE_RE)];
  return matches.map((m) => ({
    id: m[1],
    label: m[2],
    section: m[3],
    phase: Number(m[4]),
  }));
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Find src.bak/components/*.tsx analog. Heuristic:
//    (a) exact PascalCase match of label (no spaces, no punctuation)
//    (b) fuzzy prefix-substring match on first ~6 chars
//    (c) a small curated override map for routes whose label differs
//        materially from the old filename.
//    Returns `N/A (new)` when no analog exists — Plan 09 respects that.
// ───────────────────────────────────────────────────────────────────────────
// Manual overrides for routes whose label doesn't PascalCase-match any src.bak
// filename. Every path in this map was verified to exist under
// src.bak/components/ at seed time (2026-04-18). Values are relative to ROOT.
// Special values:
//   'N/A (new)'           — rebuild introduced this route; no old analog
//   '<rel-path>'          — the listed src.bak file is the closest analog
const MANUAL_BAK = {
  // new routes with no src.bak analog (rebuild-era surfaces)
  reports: 'N/A (new — backend capability_gap_detected target)',
  primitives: 'N/A (new — dev showcase)',
  'wrapper-smoke': 'N/A (new — P-04 harness)',
  'diagnostics-dev': 'src.bak/components/Diagnostics.tsx',

  // routes whose label doesn't exactly PascalCase-match the old filename
  chat: 'src.bak/components/ChatWindow.tsx',
  settings: 'src.bak/components/Settings.tsx',
  'settings-providers': 'src.bak/components/Settings.tsx',
  'settings-integrations': 'src.bak/components/IntegrationHub.tsx',
  'settings-voice': 'src.bak/components/Settings.tsx',
  'settings-ghost': 'src.bak/components/Settings.tsx',
  'settings-ambient': 'src.bak/components/Settings.tsx',
  'settings-autonomy': 'src.bak/components/Settings.tsx',
  'settings-shortcuts': 'src.bak/components/Settings.tsx',
  'settings-advanced': 'src.bak/components/Settings.tsx',
  'settings-about': 'src.bak/components/Settings.tsx',
  'security-dashboard': 'src.bak/components/SecurityDashboard.tsx',
  temporal: 'src.bak/components/TemporalPanel.tsx',
  agents: 'src.bak/components/AgentDashboard.tsx',
  'agent-team': 'src.bak/components/AgentTeamPanel.tsx',
  'background-agents': 'src.bak/components/BackgroundAgentsPanel.tsx',
  'task-agents': 'src.bak/components/ManagedAgentPanel.tsx',
  'daily-log': 'src.bak/components/DailyLogPanel.tsx',
  'conversation-insights': 'src.bak/components/ConversationInsightsPanel.tsx',
  health: 'src.bak/components/HealthPanel.tsx',
  finance: 'src.bak/components/FinanceView.tsx',
  goals: 'src.bak/components/GoalView.tsx',
  habits: 'src.bak/components/HabitView.tsx',
  meetings: 'src.bak/components/MeetingView.tsx',
  'social-graph': 'src.bak/components/SocialGraphView.tsx',
  predictions: 'src.bak/components/PredictionView.tsx',
  'emotional-intel': 'src.bak/components/EmotionalIntelligenceView.tsx',
  accountability: 'src.bak/components/AccountabilityView.tsx',
  persona: 'src.bak/components/PersonaView.tsx',
  character: 'src.bak/components/CharacterBible.tsx',
  negotiation: 'src.bak/components/NegotiationView.tsx',
  reasoning: 'src.bak/components/ReasoningView.tsx',
  'context-engine': 'src.bak/components/ContextEngineView.tsx',
  sidecar: 'src.bak/components/SidecarView.tsx',
  terminal: 'src.bak/components/Terminal.tsx',
  'web-automation': 'src.bak/components/WebAutomation.tsx',
  'code-sandbox': 'src.bak/components/CodeSandboxView.tsx',
  'computer-use': 'src.bak/components/ComputerUsePanel.tsx',

  // 'body' cluster — Phase 8 surfaces; src.bak never shipped dedicated views
  'body-map': 'N/A (new — Phase 8 body visualization)',
  'body-system-detail': 'N/A (new — Phase 8 body visualization)',
  'hormone-bus': 'N/A (new — Phase 8 body visualization)',
  'organ-registry': 'N/A (new — Phase 8 body visualization)',
  dna: 'N/A (new — Phase 8 body visualization)',
  'world-model': 'N/A (new — Phase 8 body visualization)',

  // 'hive' cluster — all sub-routes rolled up into HiveView.tsx in src.bak
  'hive-mesh': 'src.bak/components/HiveView.tsx',
  'hive-tentacle': 'src.bak/components/TentacleDetail.tsx',
  'hive-autonomy': 'src.bak/components/HiveView.tsx',
  'hive-approval-queue': 'src.bak/components/HiveView.tsx',
  'hive-ai-delegate': 'src.bak/components/HiveView.tsx',

  onboarding: 'src.bak/components/OnboardingFlow.tsx',
};

function findBakAnalog(routeId, label) {
  if (MANUAL_BAK[routeId] !== undefined) {
    const manual = MANUAL_BAK[routeId];
    // Sanity-check: if the manual override points to a path that doesn't exist
    // on disk, log a warning — the MANUAL_BAK map is hand-maintained and should
    // stay truthful across renames. CI (Plan 09) is the backstop.
    if (manual.startsWith('src.bak/')) {
      const onDisk = join(ROOT, manual);
      if (!existsSync(onDisk)) {
        console.warn(
          `[seed-migration-ledger] WARN: MANUAL_BAK[${routeId}] → ${manual} not found on disk`
        );
      }
    }
    return manual;
  }

  const bakDir = join(ROOT, 'src.bak', 'components');
  if (!existsSync(bakDir)) return 'N/A (no src.bak)';
  const files = readdirSync(bakDir);
  const pascal = label.replace(/\s+/g, '').replace(/[^A-Za-z0-9]/g, '');
  const exact = files.find((f) => f.toLowerCase() === `${pascal.toLowerCase()}.tsx`);
  if (exact) return `src.bak/components/${exact}`;
  const head = pascal.toLowerCase().slice(0, 6);
  if (head.length >= 4) {
    const fuzzy = files.find((f) => f.toLowerCase().includes(head));
    if (fuzzy) return `src.bak/components/${fuzzy}`;
  }
  return 'N/A (new)';
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Idempotency: preserve existing `status` column if the ledger already
//    exists. Parse row-by-row; keyed by route_id.
// ───────────────────────────────────────────────────────────────────────────
function loadExistingStatus(ledgerPath) {
  if (!existsSync(ledgerPath)) return {};
  const text = readFileSync(ledgerPath, 'utf8');
  const statusMap = {};
  // Match a table row where column 1 = route_id, and find the 6th pipe-delimited cell = status.
  const ROW_RE = /^\|\s*([a-z][a-z0-9-]*)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([A-Za-z]+)\s*\|/gm;
  for (const m of text.matchAll(ROW_RE)) {
    const id = m[1];
    const status = m[2];
    if (['Pending', 'Shipped', 'Deferred'].includes(status)) {
      statusMap[id] = status;
    }
  }
  return statusMap;
}

// Load full hand-curated rows so re-seeding preserves bak_path / new_component
// / note / cross_refs alongside status. Without this, any operator edit gets
// overwritten on the next `npm run seed:ledger`, breaking the build.yml
// migration-ledger drift gate (D-28 idempotency contract).
function loadExistingRows(ledgerPath) {
  if (!existsSync(ledgerPath)) return {};
  const text = readFileSync(ledgerPath, 'utf8');
  const rowMap = {};
  // Capture all 8 pipe-delimited cells: id | bak | newComp | section | phase | status | cross_refs | note
  const ROW_RE = /^\|\s*([a-z][a-z0-9-]*)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|\s*([A-Za-z]+)\s*\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/gm;
  for (const m of text.matchAll(ROW_RE)) {
    const [, id, bak, newComp, , , status, crossRefs, note] = m;
    if (!['Pending', 'Shipped', 'Deferred'].includes(status)) continue;
    rowMap[id] = { bak, newComp, status, crossRefs, note };
  }
  return rowMap;
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Walk src/features/<cluster>/index.tsx, collect all routes.
// ───────────────────────────────────────────────────────────────────────────
const featuresDir = join(ROOT, 'src', 'features');
if (!existsSync(featuresDir)) {
  console.error(`[seed-migration-ledger] src/features not found at ${featuresDir}`);
  process.exit(1);
}
const clusters = readdirSync(featuresDir).filter((d) =>
  statSync(join(featuresDir, d)).isDirectory()
);
const allRoutes = [];
for (const c of clusters) {
  const indexFile = join(featuresDir, c, 'index.tsx');
  if (!existsSync(indexFile)) continue;
  for (const r of parseFeatureIndex(indexFile)) {
    allRoutes.push({ ...r, cluster: c });
  }
}

// Stable sort: section alphabetical, then phase ascending, then id alphabetical.
allRoutes.sort((a, b) => {
  if (a.section !== b.section) return a.section.localeCompare(b.section);
  if (a.phase !== b.phase) return a.phase - b.phase;
  return a.id.localeCompare(b.id);
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Build ledger markdown.
// ───────────────────────────────────────────────────────────────────────────
const ledgerPath = join(ROOT, '.planning', 'migration-ledger.md');
const existingStatus = loadExistingStatus(ledgerPath);
const existingRows = loadExistingRows(ledgerPath);

// Preferred component file paths: stubs live in the cluster index.tsx today,
// but the ledger records where each route's real component will live post-
// migration. For most routes we PascalCase the label; a small override map
// pins specific filenames that downstream plans already commit to (e.g.
// Plan 09's `src/features/dev/Primitives.tsx`).
const MANUAL_NEW_COMPONENT = {
  primitives: 'src/features/dev/Primitives.tsx',
  'wrapper-smoke': 'src/features/dev/WrapperSmoke.tsx',
  'diagnostics-dev': 'src/features/dev/Diagnostics.tsx',
  'mcp-settings': 'src/features/admin/McpSettings.tsx',
  'settings-ghost': 'src/features/settings/Ghost.tsx',
  'emotional-intel': 'src/features/life-os/EmotionalIntelligence.tsx',
  'agent-pixel-world': 'src/features/agents/AgentPixelWorld.tsx',
};

function preferredNewComponent(r) {
  if (MANUAL_NEW_COMPONENT[r.id]) return MANUAL_NEW_COMPONENT[r.id];
  const pascal = r.label.replace(/[^A-Za-z0-9]+/g, '');
  return `src/features/${r.cluster}/${pascal}.tsx`;
}

const MANUAL_NOTES = {
  dashboard: 'Default route; P-01 gate surface',
  chat: 'Streaming; tool approval dialog',
  settings: '10 sub-tabs',
  reports: 'NEW stub — backend pushes via capability_gap_detected → openRoute("reports") (P-03)',
  primitives: 'DEV-only showcase; palette-hidden',
  'wrapper-smoke': 'DEV-only P-04 harness; palette-hidden',
  'diagnostics-dev': 'DEV-only listener counter + perf marks; palette-hidden',
  onboarding: 'First-run flow; palette-hidden',
};

const rows = allRoutes.map((r) => {
  const prior = existingRows[r.id];
  // Prefer hand-curated columns when the row already exists; only re-derive
  // for new IDs. This keeps `npm run seed:ledger` truly idempotent so the
  // build.yml drift gate stops firing on every re-seed.
  const bak = prior?.bak ?? findBakAnalog(r.id, r.label);
  const newComp = prior?.newComp ?? preferredNewComponent(r);
  const status = existingStatus[r.id] ?? 'Pending';
  const crossRefs = prior?.crossRefs ?? '–';
  const note = prior?.note ?? (MANUAL_NOTES[r.id] ?? '');
  return `| ${r.id} | ${bak} | ${newComp} | ${r.section} | ${r.phase} | ${status} | ${crossRefs} | ${note} |`;
});

// Preserve the existing **Seeded:** date if the ledger already exists. This
// keeps `npm run seed:ledger` idempotent across days — required for the
// migration-ledger CI gate (build.yml:39 runs `git diff --exit-code` after
// re-seeding). Falls back to today only when the ledger is being created
// fresh (no prior **Seeded:** line found).
const SEED_DATE_RE = /\*\*Seeded:\*\*\s+(\d{4}-\d{2}-\d{2})/;
let seededDate = null;
if (existsSync(ledgerPath)) {
  const match = readFileSync(ledgerPath, 'utf8').match(SEED_DATE_RE);
  if (match) seededDate = match[1];
}
const today = seededDate ?? new Date().toISOString().slice(0, 10);
const pendingCount = rows.filter((r) => r.includes('| Pending |')).length;
const shippedCount = rows.filter((r) => r.includes('| Shipped |')).length;
const deferredCount = rows.filter((r) => r.includes('| Deferred |')).length;

const out = `# BLADE Migration Ledger

**Seeded:** ${today} (Plan 01-08 auto-generated via \`scripts/seed-migration-ledger.mjs\`)
**Discipline:** D-27 + D-28 + P-03.
**Enforcement:** CI via \`scripts/verify-migration-ledger.mjs\` (Plan 09), not reviewer-required PR gate.

## Invariants

1. **No old route removed before its new component ships.** Status \`Pending\` must flip to \`Shipped\` before any \`src.bak\` reference is deleted or the route-id is renamed.
2. **\`cross_refs\` column MUST be cleared before flipping \`status\` to \`Shipped\`.** All consumers of the old path must be updated first.
3. **Adding a new route appends a row.** FOUND-08 acceptance: 1 file + 1 entry. Re-run \`npm run seed:ledger\` after editing any \`src/features/<cluster>/index.tsx\` to refresh the table; existing status values are preserved.
4. **\`N/A (new)\`** in the \`src.bak_path\` column is expected for routes introduced by the rebuild (e.g. \`reports\`, \`primitives\`, \`wrapper-smoke\`).

## Rows

| route_id | src.bak_path | new_component | section | phase | status | cross_refs | notes |
|----------|--------------|---------------|---------|-------|--------|------------|-------|
${rows.join('\n')}

## Totals

- **Routes tracked:** ${rows.length}
- **Pending:** ${pendingCount}
- **Shipped:** ${shippedCount}
- **Deferred:** ${deferredCount}
- **Source:** ${clusters.length} feature clusters under \`src/features/\` (\`${clusters.join('\`, \`')}\`)

## Re-seed

\`\`\`bash
npm run seed:ledger
# or
node scripts/seed-migration-ledger.mjs
\`\`\`
`;

writeFileSync(ledgerPath, out, 'utf8');
console.log(
  `[seed-migration-ledger] wrote ${rows.length} rows to ${ledgerPath} ` +
    `(Pending=${pendingCount} Shipped=${shippedCount} Deferred=${deferredCount})`
);
