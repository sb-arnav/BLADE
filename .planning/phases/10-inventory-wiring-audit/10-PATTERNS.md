# Phase 10: Inventory & Wiring Audit — Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 5 new artifacts (3 audit deliverables + 1 verify script + 1 `package.json` script entry)
**Analogs found:** 5 / 5 (100% coverage; one file — the JSON Schema — has no prior-art in the repo and falls back to the zod-mirroring spec in `10-RESEARCH.md` §"JSON Sidecar Schema")

## Context at a Glance

Phase 10 is a **read-only audit** that ships planning artifacts, not source code. The "new files" are:

1. `10-WIRING-AUDIT.md` — human-readable monolithic Markdown with 5 sections + Appendix A/B (D-46)
2. `10-WIRING-AUDIT.json` — machine-parseable sidecar; schema locked in research §"JSON Sidecar Schema"
3. `10-WIRING-AUDIT.schema.json` — JSON Schema Draft 2020-12, zod-mirrored
4. `scripts/verify-wiring-audit-shape.mjs` — Wave 0 verify script (Node + zod)
5. `package.json` script entry `verify:wiring-audit-shape` + `verify:all` chain append

The audit **subagents** (A = Rust modules, B = routes/palette, C = config) are execution-time procedures, not files, so they are intentionally omitted from the pattern assignments — their analog is documented in `10-RESEARCH.md` §"Architectural Responsibility Map" + §"Subagent Contract Design" and the planner should read that section directly when authoring subagent prompts.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.md` | planning-artifact (audit doc) | batch-transform (grep results → classified tables) | `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` + `00-BACKEND-EXTRACT.md` | exact (same shape: header prose + classification table + summary, same phase ledger location) |
| `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` | planning-artifact (sidecar) | batch-transform (audit synthesis → structured JSON) | **No JSON sidecar precedent in `.planning/**`** (the only JSON file is `.planning/config.json`, a tool config unrelated to audit output). Analog fallback = the zod-mirroring schema spec inside `10-RESEARCH.md` §"JSON Sidecar Schema" (lines 446-552). | novel (no local precedent; schema spec in RESEARCH.md is load-bearing) |
| `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` | planning-artifact (JSON Schema Draft 2020-12) | static (one-time declaration consumed by verify script) | **No JSON Schema file in repo.** Analog fallback = mirror the inline schema in `10-RESEARCH.md` lines 449-552; zod version in `package.json:70` is the live validator stack. | novel |
| `scripts/verify-wiring-audit-shape.mjs` | verify script (Node ESM) | file-I/O + validation (read JSON, read Rust source, assert shape) | `scripts/verify-emit-policy.mjs` (best: same file-walk + regex extraction + allowlist-style gate pattern); secondary: `scripts/verify-migration-ledger.mjs` (best: Markdown-table-parse + src/ cross-ref pattern); tertiary: `scripts/verify-entries.mjs` (simplest existence check shape) | exact (Node ESM mjs verify + filesystem walk + pass/fail exit code + `@see` comment block) |
| `package.json` (script entry insertion) | config (npm scripts) | config | `package.json:12-28` existing `verify:*` script entries + `verify:all` chain at line 29 | exact (same file, append a sibling `verify:wiring-audit-shape` entry and extend the `verify:all` chain) |

---

## Pattern Assignments

### 1. `10-WIRING-AUDIT.md` (planning-artifact, batch-transform)

**Analog:** `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md`

**Header-prose pattern** (lines 1-12):
```markdown
# Phase 0 — emit_all Classification Audit (resolves WIRE-08)

> Scanned: `src-tauri/src/**/*.rs` for `app.emit(`, `emit_all(`, `emit_to(` patterns.
> Policy: D-14 — `emit_to(label, ...)` for single-window; `emit_all` / `app.emit()` (broadcast) for cross-window only.
> Note: In Tauri 2, `app.emit(event, payload)` broadcasts to ALL windows (equivalent to emit_all). `app.emit_to(label, event, payload)` targets a single window.

## Summary

- Total emit sites scanned: 247
- **cross-window:** 42 (events legitimately needed by multiple windows)
- **single-window:** 142 (events consumed by exactly one window — should convert to `emit_to`)
- **ambiguous:** 63 (cannot determine single consumer from emit site alone)
```

**Apply to `10-WIRING-AUDIT.md`** as:
- H1 title referencing the phase ID + the acceptance-requirement IDs it resolves (AUDIT-01..05)
- Blockquote with "Scanned:" source list + "Policy:" reference to the D-48 classification heuristic
- `## Summary` section with per-classification totals (count of `ACTIVE` / `WIRED-NOT-USED` / `NOT-WIRED` / `DEAD` across modules + routes + config; session-measured baseline = 178 .rs + ALL_ROUTES count + ~130 config surfaces)

**Classification-table pattern** (lines 14-20):
```markdown
## Classification Table

| file:line | event name | payload type | classification | proposed replacement (if single-window) |
|-----------|------------|--------------|----------------|------------------------------------------|
| src-tauri/src/commands.rs:77 | `chat_cancelled` | `()` | single-window | `emit_to("main", "chat_cancelled", ())` |
| src-tauri/src/commands.rs:78 | `blade_status` | `"idle"` | cross-window (main + HUD) | — |
```

**Apply as:** every row carries `file:line` as the leftmost cell, classification in the middle, a follow-up-action column on the right. For `10-WIRING-AUDIT.md` that becomes:
- Section 1 (Module Catalog) columns: `file | classification | purpose | trigger | ui_surface`
- Section 2 (Route + Palette Catalog) columns: `id | classification | section | palette_visible | data_source | flow_status`
- Section 3 (Config Surface Catalog) columns: `field | file:line | classification | ui_surface | control_type | disk_persisted`
- Section 4 (NOT-WIRED Backlog) columns: `item_type | identifier | backend_entry_points | phase_14_owner | deferral_rationale`
- Section 5 (DEAD Deletion Plan) columns: `identifier | callers | imports | safe_to_delete | deletion_note`

**Secondary analog:** `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` lines 1-5 (header + numbered sections `## 1. QuickAsk Submission Path`, `## 2. Voice Orb Driving Events`, `## 3. Onboarding Backend Wiring`):

```markdown
# Phase 0 — Backend Contract Extract

> Sources: `src-tauri/src/commands.rs`, `src-tauri/src/voice_global.rs`, ...
> D-17 enforced: no reference to `src.bak/`. D-19 enforced: no RECOVERY_LOG here.

---

## 1. QuickAsk Submission Path
```

**Apply as:** the five-section spine of `10-WIRING-AUDIT.md` uses the same `## N. Section Name` numbering + horizontal rule separators.

**Trailing-metadata pattern** (`00-EMIT-AUDIT.md:338`):
```markdown
*Extract produced: 2026-04-18. No `src.bak/` referenced. No files in `src/` or `src-tauri/` modified.*
```

**Apply as:** final italic line `*Audit produced: 2026-04-20. No source code modified (read-only phase per D-50). 178 .rs files + N routes + M config surfaces classified.*`

---

### 2. `10-WIRING-AUDIT.json` (planning-artifact, batch-transform)

**Analog:** **No JSON artifact precedent** in `.planning/phases/**`. The only existing `.planning/*.json` is `.planning/config.json` (a GSD tool config — unrelated shape).

**Fallback authority:** `.planning/phases/10-inventory-wiring-audit/10-RESEARCH.md` §"JSON Sidecar Schema" (lines 446-552) is the authoritative spec. Every field + type + pattern constraint is defined there. The planner's plan for this file should instruct the synthesizer to:

1. Open `10-RESEARCH.md` lines 446-552
2. Read the schema block verbatim
3. Produce a JSON file whose top-level keys match `required: ["schema_version", "generated_at", "modules", "routes", "config", "not_wired_backlog", "dead_deletion_plan"]`
4. Fill each array with rows conforming to the per-item schema (see lines 458-549 in RESEARCH.md)

**Key schema excerpts to copy verbatim** (RESEARCH.md:449-477):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://blade/.planning/phases/10/wiring-audit.schema.json",
  "type": "object",
  "required": ["schema_version", "generated_at", "modules", "routes", "config", "not_wired_backlog", "dead_deletion_plan"],
  "properties": {
    "schema_version": { "const": "1.0.0" },
    "generated_at": { "type": "string", "format": "date-time" },
    ...
  }
}
```

**`file:line` format constraint** (RESEARCH.md:554, non-negotiable): every location reference in the JSON MUST be `path:line` (e.g. `"src-tauri/src/commands.rs:591"`) — enforced by the schema `pattern: ":[0-9]+$"`. Phase 14 and Phase 15 scripts parse the colon as the delimiter.

---

### 3. `10-WIRING-AUDIT.schema.json` (planning-artifact, static declaration)

**Analog:** **No JSON Schema file in repo.** Zod is present (`package.json:70` → `"zod": "^3.25.76"`) but has zero live consumers (grep finds only `src.bak/lib/validation.ts` which is forbidden reading per D-17).

**Fallback authority:** Mirror the schema inline in `10-RESEARCH.md` §"JSON Sidecar Schema" (lines 449-552). That block is already written in JSON Schema Draft 2020-12 syntax — copy it verbatim as the file content.

**Zod integration pattern** (for the consumer, `verify-wiring-audit-shape.mjs`):
Because no live zod usage exists, the verify script should follow vanilla zod v3 import syntax. The `package.json` entry already declares the dependency, so the import pattern is:

```javascript
import { z } from 'zod';
```

No existing file in `src/` currently imports zod at runtime; the verify script will be the first. Use zod's `z.object({...}).parse(data)` for runtime validation and mirror the JSON Schema field-by-field. The cleanest reference is zod's own README (not a repo file) — this is one case where there is genuinely no local analog to copy.

---

### 4. `scripts/verify-wiring-audit-shape.mjs` (verify script, Node ESM + file-I/O + validation)

**Analog:** `scripts/verify-emit-policy.mjs` (best overall structural match)

**Shebang + header-comment pattern** (lines 1-18):
```javascript
#!/usr/bin/env node
// scripts/verify-emit-policy.mjs (D-45-regress)
//
// Greps src-tauri/src/ for `app.emit(` and `emit_all(` (broadcast emits).
// Fails if any call is not in the CROSS_WINDOW allowlist. Allowlist is
// transcribed from .planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md —
// every row classified `cross-window` above is represented here as
// `<relative_path>:<event_name>`. Line numbers are intentionally excluded so
// the allowlist survives code churn; what matters is the source file + event
// name.
//
// Regression prevention: a new feature that introduces a single-window
// `app.emit(...)` or `emit_all(...)` site will fail CI until either:
//   1. The call is rewritten to `app.emit_to("<label>", ...)`, OR
//   2. The site is added to CROSS_WINDOW_ALLOWLIST below.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-45, §D-45-regress
// @see .planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md
```

**Apply to `verify-wiring-audit-shape.mjs`** as:
```javascript
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
// --check=config | --check=not-wired | --check=dead. Default (no arg) runs all.
//
// @see .planning/phases/10-inventory-wiring-audit/10-RESEARCH.md §"JSON Sidecar Schema"
// @see .planning/phases/10-inventory-wiring-audit/10-VALIDATION.md §"Wave 0 Requirements"
```

**ESM import pattern** (verify-emit-policy.mjs lines 20-25):
```javascript
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUST_DIR = join(ROOT, 'src-tauri', 'src');
```

**Apply verbatim** — this is the canonical repo pattern for every Node-based verify script. Extend with `import { z } from 'zod';` for schema validation.

**Recursive-walk generator pattern** (verify-emit-policy.mjs lines 83-90):
```javascript
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (entry.endsWith('.rs')) yield p;
  }
}
```

**Apply as:** the AUDIT-01 count check re-scans `src-tauri/src/` with this exact generator, counts yields, asserts equal to `modules.length`.

**Exit-code + message pattern** (verify-emit-policy.mjs lines 96-127):
```javascript
let failed = false;
let totalChecked = 0;
for (const file of walk(RUST_DIR)) {
  // ... scan work ...
  if (!CROSS_WINDOW_ALLOWLIST.has(key)) {
    console.error(
      `[verify-emit-policy] VIOLATION: ${rel}:${lineNum} emits '${eventName}' as broadcast`,
    );
    failed = true;
  }
}

if (failed) {
  console.error(
    '[verify-emit-policy] FAIL: one or more broadcast emits not in cross-window allowlist',
  );
  process.exit(1);
}

console.log(
  `[verify-emit-policy] OK — all ${totalChecked} broadcast emits match cross-window allowlist`,
);
```

**Apply as:** every `[verify-wiring-audit-shape]` message uses the `[script-name] FAIL/OK —` prefix; `process.exit(1)` on any violation; final success log states quantitative result (`OK — 178 modules, 50 routes, 130 config fields validated`).

**Secondary analog:** `scripts/verify-migration-ledger.mjs` lines 15-41 — for the Markdown-parse step when reading the audit doc or cross-referencing router.ts:

```javascript
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER_PATH = join(ROOT, '.planning', 'migration-ledger.md');
const SRC_DIR = join(ROOT, 'src');

// ...

const ledger = readFileSync(LEDGER_PATH, 'utf8');
const rows = {};

// Table columns: route_id | ... | status | ...
const ROW_RE = /^\|\s*([a-z][a-z0-9-]*)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*(Pending|Shipped|Deferred)\s*\|/;
for (const line of ledger.split('\n')) {
  const m = line.match(ROW_RE);
  if (m) rows[m[1]] = m[2];
}
```

**Apply as:** the AUDIT-02 route-count check reads `src/windows/main/router.ts`, grep-extracts the spread list `[...dashboardRoutes, ...chatRoutes, ...]`, cross-references with per-feature `routes: RouteDefinition[]` exports, and counts union length. Regex-based parsing is acceptable — a TypeScript AST is not required per `10-RESEARCH.md:22` ("TypeScript AST optional but not required").

**Tertiary analog:** `scripts/verify-entries.mjs` (the simplest shape — existence checks with zero validation). Useful reference for the `--self-test` subcommand which just asserts three file paths exist.

---

### 5. `package.json` script entry insertion

**Analog:** `package.json:12-29` existing `verify:*` script entries

**Add exactly one line** (after line 28, before `verify:all`):
```json
"verify:wiring-audit-shape": "node scripts/verify-wiring-audit-shape.mjs",
```

**Extend `verify:all` chain** (currently at line 29):
```json
"verify:all": "npm run verify:entries && npm run verify:no-raw-tauri && npm run verify:migration-ledger && npm run verify:emit-policy && npm run verify:contrast && npm run verify:chat-rgba && npm run verify:ghost-no-cursor && npm run verify:orb-rgba && npm run verify:hud-chip-count && npm run verify:phase5-rust && npm run verify:feature-cluster-routes && npm run verify:phase6-rust && npm run verify:phase7-rust && npm run verify:phase8-rust && npm run verify:aria-icon-buttons && npm run verify:motion-tokens && npm run verify:tokens-consistency && npm run verify:empty-state-coverage && npm run verify:wiring-audit-shape"
```

Append ` && npm run verify:wiring-audit-shape` at the very end of the chain. This preserves the 18/18 baseline ordering; the new gate becomes gate #19.

**Apply note:** Script keys in `package.json:2-35` use kebab-case throughout (`verify:emit-policy`, `verify:no-raw-tauri`) and every entry is `"node scripts/*.mjs"` or `"bash scripts/*.sh"`. The wiring-audit gate is Node + zod, so `node scripts/...mjs` is the match. Do NOT add it earlier in the chain — ordering is preserved on every commit per the existing `verify-phase5-rust-surface.sh` → `verify-feature-cluster-routes.sh` → `verify-phase6-rust-surface.sh` sequence, which has a meaningful dependency order (surface before routes, then next phase).

---

## Shared Patterns

### Verify-Script Canonical Shape

**Source:** `scripts/verify-emit-policy.mjs` (best-in-class exemplar), `scripts/verify-migration-ledger.mjs`, `scripts/verify-html-entries.mjs`, `scripts/verify-aria-icon-buttons.mjs`, `scripts/verify-tokens-consistency.mjs`

**Apply to:** every new Node-based verify script in the repo, including Phase 10's `verify-wiring-audit-shape.mjs`.

**Canonical structure:**
```javascript
#!/usr/bin/env node
// scripts/<name>.mjs (<decision-ref or phase-ref>)
//
// <what this script does in 2-3 lines>
//
// @see <decision or plan reference>
// @see <source-of-truth reference>

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// ... derive additional paths from ROOT ...

// ---- pure functions (walk, parse, validate) ----

// ---- main: scan, accumulate `failed` flag, print per-violation lines ----

let failed = false;
// ... scan work + console.error on each violation ...

if (failed) {
  console.error(`[<name>] FAIL: <summary>`);
  process.exit(1);
}

console.log(`[<name>] OK — <quantitative success statement>`);
```

This shape is repeated across 14 `.mjs`/`.sh` verify scripts with near-identical structure. New verify scripts must match.

### Audit Document Canonical Shape

**Source:** `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md`, `00-BACKEND-EXTRACT.md`

**Apply to:** every planning-doc-shaped audit artifact, including `10-WIRING-AUDIT.md`.

**Canonical structure:**
```markdown
# Phase N — <Title> (<ID-refs>)

> Scanned: <source paths>
> Policy: <decision ID> — <one-line policy statement>
> Note: <any critical caveat>

## Summary

- <count stat 1>
- <count stat 2>
- <count stat 3>

## <Section 1 — Classification Table>

| <col1> | <col2> | classification | <followup-col> |
|--------|--------|----------------|----------------|
| <rows with `file:line` in leftmost col> | ... |

## <Section 2 ...>

---

*<Produced: date>. <Read-only attestation>. <Quantitative completion note>.*
```

Every row's leftmost cell is `file:line` (format enforced in the JSON sidecar schema pattern `:[0-9]+$`).

### Phase-Directory Artifact Co-Location

**Source:** `.planning/phases/00-pre-rebuild-audit/` (lists the audit doc + extracts + plans + summaries side-by-side)

**Apply to:** all three Phase 10 output artifacts (`10-WIRING-AUDIT.md`, `10-WIRING-AUDIT.json`, `10-WIRING-AUDIT.schema.json`) — they live in the same phase directory as `10-CONTEXT.md`, `10-RESEARCH.md`, `10-VALIDATION.md`, `10-PATTERNS.md` (this file), and the forthcoming `10-*-PLAN.md` / `10-*-SUMMARY.md` files. Phase 0's precedent shows the audit deliverable lives alongside its planning files, not in a separate output tree.

### `file:line` Reference Format

**Source:** universally enforced in `00-EMIT-AUDIT.md`, `00-BACKEND-EXTRACT.md`, and the entire verify-script suite.

**Apply to:** every location reference in both `10-WIRING-AUDIT.md` (tables) and `10-WIRING-AUDIT.json` (schema-enforced pattern). Format = `<relative-path>:<line-number>`, colon-delimited. Phase 14 agents `cat <file>` + navigate to `<line>`; Phase 15's `verify:feature-reachability` parses the colon.

---

## No Analog Found

Files with no close prior-art in the repo (planner should use `10-RESEARCH.md` as primary spec):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.json` | JSON sidecar | structured audit output | No `.planning/**/*.json` audit artifact exists. `.planning/config.json` is a tool config (unrelated shape). **Use schema in `10-RESEARCH.md:449-552` as authoritative.** |
| `.planning/phases/10-inventory-wiring-audit/10-WIRING-AUDIT.schema.json` | JSON Schema Draft 2020-12 | schema declaration | No JSON Schema file exists anywhere in the repo. Zod is available (`package.json:70`) but has no live consumers. **Mirror the inline JSON Schema in `10-RESEARCH.md:449-552` field-for-field.** |

Both files' shapes are fully specified inside `10-RESEARCH.md`; the planner does not need to invent any structure, only transcribe + fill.

---

## Metadata

**Analog search scope:**
- `.planning/phases/00-pre-rebuild-audit/` (Phase 0 audit precedent)
- `.planning/phases/01-foundation/` through `.planning/phases/09-polish/` (PATTERNS.md convention reference)
- `scripts/` (all verify scripts, Node + Bash)
- `package.json` (script entries)
- `.planning/*.json` + `.planning/**/*.json` (JSON artifact search)

**Files read (no range re-reads, per constraint):**
- `.planning/phases/10-inventory-wiring-audit/10-CONTEXT.md` (full)
- `.planning/phases/10-inventory-wiring-audit/10-RESEARCH.md` (full, 766 lines)
- `.planning/phases/10-inventory-wiring-audit/10-VALIDATION.md` (full)
- `.planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md` (lines 1-120, 240-338; skipped middle based on header + tail representativeness)
- `.planning/phases/00-pre-rebuild-audit/00-BACKEND-EXTRACT.md` (lines 1-220)
- `.planning/config.json` (full)
- `scripts/verify-emit-policy.mjs` (full)
- `scripts/verify-no-raw-tauri.sh` (full)
- `scripts/verify-phase5-rust-surface.sh` (full)
- `scripts/verify-feature-cluster-routes.sh` (full)
- `scripts/verify-html-entries.mjs` (full)
- `scripts/verify-tokens-consistency.mjs` (full)
- `scripts/verify-migration-ledger.mjs` (full)
- `scripts/verify-entries.mjs` (full)
- `scripts/verify-aria-icon-buttons.mjs` (full)
- `scripts/verify-phase8-rust-surface.sh` (lines 1-40 for header format only)
- `package.json` (full)
- `.planning/phases/09-polish/09-PATTERNS.md` (lines 1-80 for Phase 10-PATTERNS.md self-reference shape)

**Pattern extraction date:** 2026-04-20

**Key findings for planner:**
1. **Every new file has a direct analog** except the two JSON artifacts (schema + sidecar) — for those, `10-RESEARCH.md` §"JSON Sidecar Schema" is the authoritative spec and the planner's plan should tell the synthesizer to transcribe that block verbatim.
2. **Verify-script shape is uniformly canonical** across 14 existing scripts; any deviation in `verify-wiring-audit-shape.mjs` would be a red flag.
3. **`file:line` format is the universal reference key** across every audit artifact + every verify-script violation message. The JSON schema enforces this with `pattern: ":[0-9]+$"` — the planner should surface this as a non-negotiable in the synthesis task.
4. **Phase 0 precedent (`00-EMIT-AUDIT.md`) is the exact template** for `10-WIRING-AUDIT.md` — same header-blockquote-summary-table-trailing-metadata spine.
5. **Zod has no live consumers yet** — the verify script will be the first runtime zod user in `src/` or `scripts/`. No deviation from zod's standard `import { z } from 'zod'` pattern is needed; just use it.
