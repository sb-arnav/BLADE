# Phase 9 Patterns — Recurring Recipes

**Mapped:** 2026-04-18
**Scope:** Code recipes Phase 9 implementers MUST follow verbatim (or cite a deviation in their commit message).

**IMPORTANT:** Phase 9 is audit-shaped, not cluster-shaped. Phase 5/6/7/8 patterns §1..§10 apply to narrow slices (Plan 09-01 Rust wrapper recipe, Plans 09-05 + 09-06 Playwright + verify-script recipes). This file captures ONLY the Phase-9-specific recipes (ErrorBoundary, EmptyState, ListSkeleton, reduced-motion, shortcut help, ARIA icon-button audit, motion audit, empty-state swap recipe, prod build dist check).

---

## 1. ErrorBoundary primitive (Plan 09-02 Task 1)

```tsx
// src/design-system/primitives/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { GlassPanel } from './GlassPanel';
import { Button } from './Button';

interface ErrorBoundaryProps {
  /** Children to guard. */
  children: ReactNode;
  /** When this value changes, the boundary resets (e.g., route id). */
  resetKey?: string;
  /** Called when the boundary catches; for logging/analytics. */
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // Dev visibility; production consumers can wire onError → analytics.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info);
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null, info: null });
    }
  }

  private handleReset = (): void => this.setState({ error: null, info: null });

  private handleCopy = (): void => {
    const { error, info } = this.state;
    if (!error) return;
    const text = `${error.name}: ${error.message}\n\n${info?.componentStack ?? ''}`;
    void navigator.clipboard.writeText(text);
  };

  private handleHome = (): void => {
    // Trigger a back-to-dashboard navigation via URL hash (router-free contract per D-05).
    window.location.hash = '#/dashboard';
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <GlassPanel
        tier={1}
        role="alert"
        aria-label="Route error — recovery affordances below"
        style={{ margin: 'var(--s-8) auto', maxWidth: 560, padding: 'var(--s-8)' }}
      >
        <h2 className="t-h2" style={{ margin: 0 }}>Something broke in this route.</h2>
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          {this.state.error.message}
        </p>
        <div style={{ display: 'flex', gap: 'var(--s-3)', marginTop: 'var(--s-5)' }}>
          <Button onClick={this.handleReset}>Reset route</Button>
          <Button onClick={this.handleHome}>Back to dashboard</Button>
          <Button onClick={this.handleCopy}>Copy error</Button>
        </div>
      </GlassPanel>
    );
  }
}
```

**Do / Don't:**
- DO wrap `<Cmp />` in MainShell.RouteSlot inside `<ErrorBoundary resetKey={route.id}>`.
- DO NOT wrap individual sub-panes in Phase 9 (per-pane boundaries deferred to v1.1).
- DO NOT swallow errors silently — always call console.error in dev.

---

## 2. EmptyState primitive (Plan 09-02 Task 2)

```tsx
// src/design-system/primitives/EmptyState.tsx
import type { ReactNode } from 'react';
import { GlassPanel } from './GlassPanel';
import { Button } from './Button';

interface EmptyStateProps {
  /** Short label (e.g., "No agents yet"). */
  label: string;
  /** Optional longer description. */
  description?: string;
  /** Call-to-action label (only rendered if onAction provided). */
  actionLabel?: string;
  /** Click handler for the CTA button. */
  onAction?: () => void;
  /** Optional icon/emoji element rendered above the label. */
  icon?: ReactNode;
  /** Optional data-testid override (default: 'empty-state'). */
  testId?: string;
}

export function EmptyState({
  label,
  description,
  actionLabel,
  onAction,
  icon,
  testId = 'empty-state',
}: EmptyStateProps) {
  return (
    <GlassPanel
      tier={1}
      role="status"
      data-testid={testId}
      style={{
        textAlign: 'center',
        padding: 'var(--s-8)',
        margin: 'var(--s-6) auto',
        maxWidth: 420,
      }}
    >
      {icon && <div style={{ fontSize: 32, marginBottom: 'var(--s-3)' }}>{icon}</div>}
      <h3 className="t-h3" style={{ margin: 0 }}>{label}</h3>
      {description && (
        <p className="t-body" style={{ color: 'var(--t-2)', marginTop: 'var(--s-3)' }}>
          {description}
        </p>
      )}
      {actionLabel && onAction && (
        <div style={{ marginTop: 'var(--s-5)' }}>
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      )}
    </GlassPanel>
  );
}
```

**Empty-state swap pattern (feature .tsx edits):**

```tsx
// Before (Plan 09-02 sweeps this pattern out):
{items.length === 0 && <div style={{ opacity: 0.5 }}>No items</div>}

// After:
{items.length === 0 && <EmptyState label="No items yet" actionLabel="Create one" onAction={handleCreate} />}
```

---

## 3. ListSkeleton primitive (Plan 09-04 Task 3)

```tsx
// src/design-system/primitives/ListSkeleton.tsx
interface ListSkeletonProps {
  /** Number of placeholder rows to render (default 5). */
  rows?: number;
  /** Row height in px (default 56). */
  rowHeight?: number;
}

export function ListSkeleton({ rows = 5, rowHeight = 56 }: ListSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      data-testid="list-skeleton"
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="list-skeleton-row"
          style={{ height: rowHeight }}
        />
      ))}
    </div>
  );
}
```

**CSS (lives in `src/design-system/primitives/primitives.css`, appended in Plan 09-04):**
```css
.list-skeleton-row {
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.04) 0%,
    rgba(255,255,255,0.12) 50%,
    rgba(255,255,255,0.04) 100%
  );
  background-size: 200% 100%;
  border-radius: var(--radius-card);
  animation: list-skeleton-shimmer 1.8s var(--ease-smooth) infinite;
}
@keyframes list-skeleton-shimmer {
  from { background-position: 200% 0; }
  to   { background-position: -200% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .list-skeleton-row { animation: none; }
}
```

**Swap pattern:**
```tsx
// Before:
{loading && <GlassSpinner size={32} />}

// After (when the pending data is a list):
{loading && <ListSkeleton rows={5} />}
```

---

## 4. Reduced-motion override (Plan 09-03 Task 2)

Append to `src/styles/motion.css`:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --dur-snap:  0.01ms;
    --dur-fast:  0.01ms;
    --dur-base:  0.01ms;
    --dur-enter: 0.01ms;
    --dur-slow:  0.01ms;
    --dur-float: 0.01ms;
  }
  @keyframes spin { from { transform: none; } to { transform: none; } }
}
```

**Verification:** Plan 09-06 a11y-sweep.spec.ts uses `page.emulateMedia({ reducedMotion: 'reduce' })` + asserts `getComputedStyle(document.documentElement).getPropertyValue('--dur-enter').trim() === '0.01ms'`.

---

## 5. Shortcut help panel (Plan 09-05 Task 3)

```tsx
// src/windows/main/ShortcutHelp.tsx
import { Dialog } from '@/design-system/primitives';
import { ALL_ROUTES } from './router';

const GLOBAL_SHORTCUTS: Array<{ combo: string; label: string }> = [
  { combo: '⌘K',     label: 'Command palette' },
  { combo: '⌘1',     label: 'Dashboard' },
  { combo: '⌘/',     label: 'Chat' },
  { combo: '⌘,',     label: 'Settings' },
  { combo: '⌘[',     label: 'Back' },
  { combo: '⌘]',     label: 'Forward' },
  { combo: '⌘?',     label: 'Shortcut help' },
  { combo: 'Alt+Space', label: 'QuickAsk' },
];

interface ShortcutHelpProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
  const routeShortcuts = ALL_ROUTES
    .filter((r) => r.shortcut)
    .map((r) => ({ combo: r.shortcut!, label: r.label }));

  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div
        role="list"
        data-testid="shortcut-help-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'min-content 1fr',
          gap: 'var(--s-2) var(--s-5)',
          padding: 'var(--s-3) 0',
        }}
      >
        {[...GLOBAL_SHORTCUTS, ...routeShortcuts].map((s) => (
          <>
            <kbd
              key={`k-${s.combo}`}
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--t-1)',
                padding: '2px 8px',
                background: 'var(--g-fill)',
                borderRadius: 4,
              }}
            >
              {s.combo}
            </kbd>
            <span key={`l-${s.combo}`} style={{ color: 'var(--t-2)' }}>{s.label}</span>
          </>
        ))}
      </div>
    </Dialog>
  );
}
```

**Integration:** `useGlobalShortcuts.ts` handles `Mod+Shift+/` (the `?` key on most layouts) → `openShortcutHelp()`. MainShell mounts `<ShortcutHelp open={...} onClose={...} />` alongside CommandPalette.

---

## 6. ARIA icon-button audit + verify script (Plans 09-03 + 09-06)

**Audit pattern (manual + script):**

A button or clickable element is "icon-only" if its accessible name derives purely from an emoji, svg icon, or single punctuation character — no visible text. Plan 09-03 Task 1 greps for these patterns and adds `aria-label`:

```tsx
// Before (audit flags):
<button onClick={close}>×</button>
<button onClick={refresh}><RefreshIcon /></button>

// After:
<button onClick={close} aria-label="Close">×</button>
<button onClick={refresh} aria-label="Refresh"><RefreshIcon /></button>
```

**Verify script (`scripts/verify-aria-icon-buttons.mjs`, Plan 09-06):**

```js
// Simplified sketch — the real script uses @babel/parser or a regex sweep.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const FILES = [];
function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.tsx') && FILES.push(p); } }
walk(ROOT);

const ICON_ONLY = /<button[^>]*>\s*([×✕✗←→↑↓])\s*<\/button>/g;
let violations = 0;
for (const f of FILES) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(ICON_ONLY)) {
    if (!/aria-label=/.test(m[0])) {
      console.error(`[aria-icon-buttons] ${f}: ${m[0]}`);
      violations++;
    }
  }
}
if (violations > 0) { console.error(`${violations} icon-only button(s) missing aria-label.`); process.exit(1); }
console.log('[aria-icon-buttons] OK');
```

---

## 7. Motion audit + verify script (Plan 09-04 + 09-06)

**Audit pattern:**

```bash
# No rogue `transition: * linear *`
grep -rn 'transition:[^;]*\blinear\b' src/ | grep -v 'ease-linear' | grep -v '^\s*//'
# Empty output → pass.
```

**Verify script (`scripts/verify-motion-tokens.sh`, Plan 09-06):**

```bash
#!/usr/bin/env bash
set -euo pipefail
BAD=$(grep -rnE 'transition:[^;]*\blinear\b' src/ 2>/dev/null | grep -v 'ease-linear' || true)
if [ -n "$BAD" ]; then
  echo "[verify-motion-tokens] ERROR: rogue linear transitions found:"
  echo "$BAD"
  exit 1
fi
echo "[verify-motion-tokens] OK"
```

---

## 8. Empty-state coverage verify script (Plan 09-06)

`scripts/verify-empty-state-coverage.sh`:

```bash
#!/usr/bin/env bash
# Assert each audited feature .tsx (from D-217 list) imports EmptyState.
set -euo pipefail
REQUIRED_FILES=(
  src/features/agents/AgentDashboard.tsx
  src/features/agents/SwarmView.tsx
  src/features/agents/AgentDetail.tsx
  src/features/knowledge/KnowledgeBase.tsx
  src/features/knowledge/ScreenTimeline.tsx
  src/features/life-os/HealthView.tsx
  src/features/life-os/FinanceView.tsx
  src/features/life-os/GoalView.tsx
  src/features/life-os/HabitView.tsx
  src/features/life-os/MeetingsView.tsx
  src/features/life-os/PredictionsView.tsx
  src/features/life-os/SocialGraphView.tsx
  src/features/life-os/AccountabilityView.tsx
  src/features/life-os/EmotionalIntelView.tsx
  src/features/identity/CharacterBible.tsx
  src/features/identity/SoulView.tsx
  src/features/identity/PersonaView.tsx
  src/features/identity/ReasoningView.tsx
  src/features/identity/NegotiationView.tsx
  src/features/identity/SidecarView.tsx
  src/features/identity/ContextEngineView.tsx
  src/features/dev-tools/FileBrowser.tsx
  src/features/admin/Analytics.tsx
  src/features/admin/CapabilityReports.tsx
  src/features/admin/DecisionLog.tsx
  src/features/admin/SecurityDashboard.tsx
  src/features/admin/Diagnostics.tsx
  src/features/admin/IntegrationStatus.tsx
  src/features/admin/McpSettings.tsx
  src/features/admin/ModelComparison.tsx
  src/features/admin/KeyVault.tsx
  src/features/admin/Reports.tsx
  src/features/admin/Temporal.tsx
  src/features/body/BodySystemDetail.tsx
  src/features/body/OrganRegistry.tsx
  src/features/body/DNA.tsx
  src/features/body/WorldModel.tsx
  src/features/hive/HiveMesh.tsx
  src/features/hive/TentacleDetail.tsx
  src/features/hive/ApprovalQueue.tsx
  src/features/hive/AIDelegate.tsx
)
MISSING=()
for f in "${REQUIRED_FILES[@]}"; do
  if ! [ -f "$f" ]; then
    MISSING+=("$f: file missing")
    continue
  fi
  if ! grep -q "EmptyState" "$f"; then
    MISSING+=("$f: no EmptyState import/usage")
  fi
done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "[verify-empty-state-coverage] FAIL — ${#MISSING[@]} file(s):"
  for m in "${MISSING[@]}"; do echo "  - $m"; done
  exit 1
fi
echo "[verify-empty-state-coverage] OK — ${#REQUIRED_FILES[@]} files covered"
```

---

## 9. Token consistency verify script (Plan 09-06)

`scripts/verify-tokens-consistency.mjs` — greps for raw px in non-motion contexts:

```js
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const FILES = [];
function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : (p.endsWith('.css') || p.endsWith('.tsx')) && FILES.push(p); } }
walk(ROOT);

// Allow 1px borders, 0/2/4/8/12px (primitive-level tokens), and font-size inside typography.css
const ALLOWED_PX = new Set(['0px', '1px', '2px', '4px', '8px', '12px', '16px', '20px', '24px', '32px']);
const RAW_PX = /\b(padding|margin|gap|font-size)\s*:\s*(\d+)px/g;

let violations = 0;
for (const f of FILES) {
  if (f.endsWith('typography.css') || f.endsWith('tokens.css') || f.endsWith('motion.css') || f.endsWith('primitives.css') || f.endsWith('glass.css')) continue;
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(RAW_PX)) {
    const px = `${m[2]}px`;
    if (!ALLOWED_PX.has(px)) {
      console.error(`[tokens-consistency] ${f}: ${m[0]}`);
      violations++;
    }
  }
}
if (violations > 0) { console.error(`${violations} raw px violation(s).`); process.exit(1); }
console.log('[tokens-consistency] OK');
```

**Allow-list rationale:** primitive-level px values (0/1/2/4/8/12/16/20/24/32) are acceptable as they come from the `--s-N` spacing token ladder; raw numerics outside this set almost always indicate a forgotten token. Excluded files: tokens.css (source), typography.css (font sizes), motion.css (durations), primitives.css + glass.css (low-level).

---

## 10. Playwright a11y + error-boundary specs (Plan 09-06)

```ts
// tests/e2e/a11y-sweep.spec.ts
import { test, expect } from '@playwright/test';

test('reduced-motion zeroes durations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const dur = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--dur-enter').trim()
  );
  expect(dur).toBe('0.01ms');
});

test('⌘? opens shortcut help panel (SC-4)', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Meta+Shift+/');
  await expect(page.getByTestId('shortcut-help-grid')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcut-help-grid')).toBeHidden();
});
```

```ts
// tests/e2e/error-boundary-recovery.spec.ts
import { test, expect } from '@playwright/test';

test('route crash shows recovery panel (SC-3)', async ({ page }) => {
  await page.goto('/');
  // Install a crash route via the dev hook
  await page.evaluate(() => {
    (window as any).__TAURI_INVOKE_HOOK__ = (cmd: string) => {
      if (cmd === 'world_get_state') throw new Error('SIMULATED_CRASH');
      return null;
    };
  });
  await page.goto('/#/world-model');
  await expect(page.getByRole('alert', { name: /Route error/i })).toBeVisible();
  await page.getByRole('button', { name: /Back to dashboard/i }).click();
  // Should navigate away — route alert should vanish.
  await expect(page.getByRole('alert', { name: /Route error/i })).toBeHidden();
});
```

---

## 11. Prod build dist verification (Plan 09-05 Task 4)

`scripts/verify-html-entries.mjs` — add `--prod` flag:

```js
const prodMode = process.argv.includes('--prod');
const ROOT = prodMode ? 'dist' : '.';
const EXPECTED = ['index.html', 'overlay.html', 'hud.html', 'ghost_overlay.html', 'voice_orb.html'];
```

In prod mode, check `dist/index.html`, `dist/overlay.html`, etc. In dev mode (existing behavior), check root-relative paths.

```bash
# After tauri build completes:
npm run tauri build
node scripts/verify-html-entries.mjs --prod
# Expected: all 5 entries present in dist/
```

---

## 12. Rust command backfill pattern (Plan 09-01)

Template (adapted from hive_approve_decision at `src-tauri/src/hive.rs:3259`):

```rust
// src-tauri/src/hive.rs — NEW command after hive_approve_decision
#[tauri::command]
pub async fn hive_reject_decision(
    state: tauri::State<'_, HiveState>,
    head_id: String,
    decision_index: usize,
) -> Result<(), String> {
    let mut hive = state.hive.write().await;
    let head = hive
        .heads
        .get_mut(&head_id)
        .ok_or_else(|| format!("head '{head_id}' not found"))?;
    if decision_index >= head.pending_decisions.len() {
        return Err(format!("decision index {decision_index} out of range"));
    }
    // Drop on the floor — reject semantics.
    let _ = head.pending_decisions.remove(decision_index);
    Ok(())
}
```

```rust
// src-tauri/src/dna.rs — NEW command
#[tauri::command]
pub async fn dna_set_identity(content: String) -> Result<(), String> {
    let path = identity_path()?;  // existing helper — returns the identity.md path
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&path, content).await.map_err(|e| e.to_string())
}
```

```rust
// src-tauri/src/character.rs — NEW command
#[tauri::command]
pub async fn delegate_feedback(
    app: tauri::AppHandle,
    decision_id: String,
    was_correct: bool,
    note: Option<String>,
) -> Result<(), String> {
    let entry = FeedbackEntry {
        decision_id,
        was_correct,
        note: note.unwrap_or_default(),
        timestamp: chrono::Utc::now().timestamp() as u64,
    };
    append_feedback(&app, entry).await  // existing helper
}
```

**Register in `lib.rs`:** add three lines to `generate_handler![]`:
```rust
hive::hive_reject_decision,
dna::dna_set_identity,
character::delegate_feedback,
```

**Wrappers** (in `src/lib/tauri/hive.ts` + `src/lib/tauri/body.ts`):
```ts
/** @see src-tauri/src/hive.rs hive_reject_decision */
export async function hiveRejectDecision(headId: string, decisionIndex: number): Promise<void> {
  return invokeTyped<void, { head_id: string; decision_index: number }>(
    'hive_reject_decision',
    { head_id: headId, decision_index: decisionIndex }
  );
}

/** @see src-tauri/src/character.rs delegate_feedback */
export async function delegateFeedback(
  decisionId: string,
  wasCorrect: boolean,
  note?: string
): Promise<void> {
  return invokeTyped<void, { decision_id: string; was_correct: boolean; note?: string }>(
    'delegate_feedback',
    { decision_id: decisionId, was_correct: wasCorrect, note }
  );
}

// In body.ts:
/** @see src-tauri/src/dna.rs dna_set_identity */
export async function dnaSetIdentity(content: string): Promise<void> {
  return invokeTyped<void, { content: string }>('dna_set_identity', { content });
}
```

---

## Pattern cross-references

| Pattern | Plan(s) | Source |
|---------|---------|--------|
| Wrapper recipe (cluster-scoped) | 09-01 | Phase 5 §1 / Phase 8 §1 (verbatim) |
| Dialog + focus return | 09-03 | Phase 6 §4 + Phase 8 §5 |
| Playwright with __TAURI_INVOKE_HOOK__ | 09-05, 09-06 | Phase 8 §7 |
| Verify script bash template | 09-06 | Phase 8 §8 |
| Typed wrapper + JSDoc @see | 09-01 | Phase 5/6/7/8 all |
| Error boundary (class component) | 09-02 | NEW — Phase 9 §1 |
| EmptyState primitive | 09-02, 09-04 | NEW — Phase 9 §2 |
| ListSkeleton primitive | 09-04 | NEW — Phase 9 §3 |
| reduced-motion override | 09-03 | NEW — Phase 9 §4 |
| Shortcut help panel | 09-05 | NEW — Phase 9 §5 |
| ARIA icon-button audit | 09-03, 09-06 | NEW — Phase 9 §6 |
| Motion-tokens verify | 09-06 | NEW — Phase 9 §7 |
| Empty-state coverage verify | 09-06 | NEW — Phase 9 §8 |
| Tokens-consistency verify | 09-06 | NEW — Phase 9 §9 |
| a11y + error-boundary specs | 09-06 | NEW — Phase 9 §10 |
| Prod-build dist verify | 09-05 | NEW — Phase 9 §11 |

---

*Patterns mapped 2026-04-18 — Phase 9 specific recipes only; Phase 5/6/7/8 patterns inherited verbatim where referenced.*
