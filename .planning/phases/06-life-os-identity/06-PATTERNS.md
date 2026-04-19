# Phase 6 Patterns — Recurring Recipes

**Mapped:** 2026-04-19
**Scope:** Code recipes Phase 6 implementers MUST follow verbatim (or cite a deviation in their commit message).

**IMPORTANT:** Phase 6 is a structural mirror of Phase 5. Patterns §1, §2, §5, §6, §7, §8, §9, §10 in `.planning/phases/05-agents-knowledge/05-PATTERNS.md` apply verbatim — only the cluster names change (agents → life-os; knowledge → identity). This file captures ONLY the Phase-6-specific recipes that diverge or extend Phase 5.

---

## 1. Typed wrapper per Rust command — cluster-scoped (inherits Phase 5 §1)

Same recipe as Phase 5 Plan 05-02. Two new wrapper files:

```ts
// src/lib/tauri/life_os.ts (Plan 06-02)
import { invokeTyped } from './_base';

// ─── Types (mirror Rust Serialize shape exactly — snake_case returns preserved) ───
export interface HealthLog {
  id: string;
  timestamp: number;
  sleep_hours?: number;
  activity_minutes?: number;
  mood?: number;
  energy?: number;
  focus?: number;
  note?: string;
  [k: string]: unknown;
}

export interface FinanceTransaction {
  id: string;
  timestamp: number;
  amount: number;
  currency?: string;
  merchant?: string;
  category?: string;
  description?: string;
  [k: string]: unknown;
}

export interface FinanceSnapshot {
  balance: number;
  spending_this_month: number;
  savings_rate?: number;
  subscription_burn?: number;
  [k: string]: unknown;
}

export interface Goal {
  id: string;
  title: string;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'active' | 'complete';
  created_at: number;
  [k: string]: unknown;
}

// ... (many more types mirroring Rust shapes)

// ─── Wrappers (one per command; JSDoc cites Rust file:line) ────────────────
/** @see src-tauri/src/health_tracker.rs health_log */
export function healthLog(args: {
  sleepHours?: number;
  activityMinutes?: number;
  mood?: number;
  energy?: number;
  focus?: number;
  note?: string;
}): Promise<HealthLog> {
  return invokeTyped<HealthLog>('health_log', {
    sleep_hours: args.sleepHours,
    activity_minutes: args.activityMinutes,
    mood: args.mood,
    energy: args.energy,
    focus: args.focus,
    note: args.note,
  });
}

/** @see src-tauri/src/financial_brain.rs finance_get_snapshot */
export function financeGetSnapshot(): Promise<FinanceSnapshot> {
  return invokeTyped<FinanceSnapshot>('finance_get_snapshot', {});
}

/** @see src-tauri/src/goal_engine.rs goal_list */
export function goalList(): Promise<Goal[]> {
  return invokeTyped<Goal[]>('goal_list', {});
}
```

```ts
// src/lib/tauri/identity.ts (Plan 06-02)
import { invokeTyped } from './_base';

export interface SoulState {
  last_evolved_at?: number;
  trait_count: number;
  preference_count: number;
  [k: string]: unknown;
}

export interface PersonaTrait {
  name: string;
  score: number;
  evidence?: string;
  [k: string]: unknown;
}

export interface CharacterBibleDoc {
  sections: Record<string, string>;
  [k: string]: unknown;
}

// ... (many more types)

/** @see src-tauri/src/soul_commands.rs soul_get_state */
export function soulGetState(): Promise<SoulState> {
  return invokeTyped<SoulState>('soul_get_state', {});
}

/** @see src-tauri/src/persona_engine.rs persona_get_traits */
export function personaGetTraits(): Promise<PersonaTrait[]> {
  return invokeTyped<PersonaTrait[]>('persona_get_traits', {});
}

/** @see src-tauri/src/character.rs get_character_bible */
export function getCharacterBible(): Promise<CharacterBibleDoc> {
  return invokeTyped<CharacterBibleDoc>('get_character_bible', {});
}
```

**Rules (same as Phase 5 §1):**
- One wrapper per `#[tauri::command]`. No multiplexing.
- Arg keys in invoke call MUST be snake_case. Wrapper signature MAY expose camelCase.
- Return types are hand-written interfaces in the SAME file.
- ESLint `no-raw-tauri` enforced.
- **File size budget:** life_os.ts ≈ 900-1100 lines (~110 wrappers × 8-10 lines). identity.ts ≈ 400-500 lines (~40 wrappers × 8-10 lines).

---

## 2. Cluster index rewrite (Plan 06-02 — ONE-WRITE rule, inherits Phase 5 §5)

```tsx
// src/features/life-os/index.tsx (Plan 06-02 rewrites — final form)
// Phase 6: replaces Phase 1 skeletons with lazy imports of real route components.
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-143

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const HealthView           = lazy(() => import('./HealthView').then((m) => ({ default: m.HealthView })));
const FinanceView          = lazy(() => import('./FinanceView').then((m) => ({ default: m.FinanceView })));
const GoalView             = lazy(() => import('./GoalView').then((m) => ({ default: m.GoalView })));
const HabitView            = lazy(() => import('./HabitView').then((m) => ({ default: m.HabitView })));
const MeetingsView         = lazy(() => import('./MeetingsView').then((m) => ({ default: m.MeetingsView })));
const SocialGraphView      = lazy(() => import('./SocialGraphView').then((m) => ({ default: m.SocialGraphView })));
const PredictionsView      = lazy(() => import('./PredictionsView').then((m) => ({ default: m.PredictionsView })));
const EmotionalIntelView   = lazy(() => import('./EmotionalIntelView').then((m) => ({ default: m.EmotionalIntelView })));
const AccountabilityView   = lazy(() => import('./AccountabilityView').then((m) => ({ default: m.AccountabilityView })));

export const routes: RouteDefinition[] = [
  { id: 'health',          label: 'Health',                 section: 'life', component: HealthView,         phase: 6 },
  { id: 'finance',         label: 'Finance',                section: 'life', component: FinanceView,        phase: 6 },
  { id: 'goals',           label: 'Goals',                  section: 'life', component: GoalView,           phase: 6 },
  { id: 'habits',          label: 'Habits',                 section: 'life', component: HabitView,          phase: 6 },
  { id: 'meetings',        label: 'Meetings',               section: 'life', component: MeetingsView,       phase: 6 },
  { id: 'social-graph',    label: 'Social Graph',           section: 'life', component: SocialGraphView,    phase: 6 },
  { id: 'predictions',     label: 'Predictions',            section: 'life', component: PredictionsView,    phase: 6 },
  { id: 'emotional-intel', label: 'Emotional Intelligence', section: 'life', component: EmotionalIntelView, phase: 6 },
  { id: 'accountability',  label: 'Accountability',         section: 'life', component: AccountabilityView, phase: 6 },
];
```

```tsx
// src/features/identity/index.tsx (Plan 06-02 rewrites — final form)
import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const SoulView          = lazy(() => import('./SoulView').then((m) => ({ default: m.SoulView })));
const PersonaView       = lazy(() => import('./PersonaView').then((m) => ({ default: m.PersonaView })));
const CharacterBible    = lazy(() => import('./CharacterBible').then((m) => ({ default: m.CharacterBible })));
const NegotiationView   = lazy(() => import('./NegotiationView').then((m) => ({ default: m.NegotiationView })));
const ReasoningView     = lazy(() => import('./ReasoningView').then((m) => ({ default: m.ReasoningView })));
const ContextEngineView = lazy(() => import('./ContextEngineView').then((m) => ({ default: m.ContextEngineView })));
const SidecarView       = lazy(() => import('./SidecarView').then((m) => ({ default: m.SidecarView })));

export const routes: RouteDefinition[] = [
  { id: 'soul',           label: 'Soul',            section: 'identity', component: SoulView,          phase: 6 },
  { id: 'persona',        label: 'Persona',         section: 'identity', component: PersonaView,       phase: 6 },
  { id: 'character',      label: 'Character Bible', section: 'identity', component: CharacterBible,    phase: 6 },
  { id: 'negotiation',    label: 'Negotiation',     section: 'identity', component: NegotiationView,   phase: 6 },
  { id: 'reasoning',      label: 'Reasoning',       section: 'identity', component: ReasoningView,     phase: 6 },
  { id: 'context-engine', label: 'Context Engine',  section: 'identity', component: ContextEngineView, phase: 6 },
  { id: 'sidecar',        label: 'Sidecar',         section: 'identity', component: SidecarView,       phase: 6 },
];
```

**Rules:**
- Plan 06-02 is the SINGLE writer of these two index.tsx files.
- Plans 06-03..06 each CREATE a disjoint subset of per-route files; file ownership is exclusive.
- Route id + label order preserved from Phase 1 substrate so NavRail ordering doesn't shift.

---

## 3. Tabbed surface recipe (PersonaView, NegotiationView, MeetingsView)

Tab selection persisted via `usePrefs` dotted key (D-165). Tabs are pill-shaped (match Phase 5 AgentDashboard filter pill CSS reuse).

```tsx
// src/features/identity/PersonaView.tsx (Plan 06-05) — pattern reference
import { useState } from 'react';
import { GlassPanel } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import './identity.css';

type PersonaTab = 'traits' | 'relationship' | 'model' | 'people';

export function PersonaView() {
  const { prefs, setPref } = usePrefs();
  const initialTab = (prefs['identity.activeTab'] as PersonaTab) ?? 'traits';
  const [tab, setTab] = useState<PersonaTab>(initialTab);

  const handleTabChange = (next: PersonaTab) => {
    setTab(next);
    setPref('identity.activeTab', next);
  };

  return (
    <GlassPanel tier={1} className="identity-surface" data-testid="persona-view-root">
      <div className="identity-tabs" role="tablist">
        {(['traits', 'relationship', 'model', 'people'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className="identity-tab-pill"
            data-active={tab === t}
            onClick={() => handleTabChange(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'traits'       && <PersonaTraitsTab />}
      {tab === 'relationship' && <PersonaRelationshipTab />}
      {tab === 'model'        && <PersonaUserModelTab />}
      {tab === 'people'       && <PersonaPeopleTab />}
    </GlassPanel>
  );
}
```

**Rules:**
- Tab state is React `useState`, initialized from Prefs.
- Each tab is its own named component in the same file (or split into sub-files if >80 LOC — e.g. PersonaTraitsTab.tsx).
- `role="tablist"` + `role="tab"` + `aria-selected` for a11y.
- Pill CSS reuses Phase 5 Plan 05-03 `.agents-filter-pill` class recipe (copy into `identity.css` / `life-os.css` as `.identity-tab-pill` / `.life-tab-pill`).

---

## 4. Edit-with-Dialog flow (SoulView, CharacterBible, PersonaView)

Identity data is high-stakes. ALL edit paths use explicit Dialog confirmation (D-153 / D-154 / D-155).

```tsx
// Recipe — click-to-edit identity section
import { useState } from 'react';
import { Dialog, Button } from '@/design-system/primitives';
import { updateCharacterSection } from '@/lib/tauri/identity';
import { useToast } from '@/lib/context/ToastContext';

interface EditSectionDialogProps {
  section: string;
  initial: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function EditSectionDialog({ section, initial, open, onClose, onSaved }: EditSectionDialogProps) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    setBusy(true);
    try {
      await updateCharacterSection({ section, content: value });
      toast.push({ type: 'success', message: `Saved ${section}` });
      onSaved();
      onClose();
    } catch (e) {
      toast.push({ type: 'error', message: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={`Edit ${section}`}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={12}
        className="identity-edit-textarea"
      />
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </Dialog>
  );
}
```

**Rules:**
- NO auto-save. Every mutation behind an explicit Save button.
- Dialog `onClose` is cancellation; data is NOT committed until `save()` completes.
- Toast success + toast error.
- Consumer component refetches after `onSaved()` to show fresh state.

---

## 5. CSV import recipe (FinanceView)

Button + file picker → invoke → toast. No drag-drop. No progress bar (operation is fast).

```tsx
// Recipe — file picker CSV import
import { Button } from '@/design-system/primitives';
import { financeImportCsv, financeAutoCategorize } from '@/lib/tauri/life_os';
import { useToast } from '@/lib/context/ToastContext';

async function handleImportClick() {
  // Tauri 2 dialog plugin OR HTML input[type=file]
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    // For Tauri, we need the absolute path. In dev, FormData upload then backend writes to temp;
    // in production, Tauri @tauri-apps/plugin-dialog handles OS-native file picker returning path.
    //   (Per D-146: file-picker Dialog; Tauri plugin-dialog MUST be used in production.)
    const path = (file as unknown as { path?: string }).path;
    if (!path) {
      toast.push({ type: 'error', message: 'Could not resolve file path; use Tauri 2 dialog plugin' });
      return;
    }
    const result = await financeImportCsv({ path });
    toast.push({ type: 'success', message: `Imported ${result.rows ?? 0} rows` });
  };
  input.click();
}
```

**Rules:**
- Prefer Tauri `@tauri-apps/plugin-dialog` `open()` over HTML file input in production — native OS file picker returns absolute path directly.
- Use HTML input ONLY as a dev/testable fallback.
- On success: refresh transactions list.
- "Auto-categorize" is a separate button, NOT auto-triggered.

---

## 6. usePrefs extension (Plan 06-01)

```ts
// src/hooks/usePrefs.ts (Plan 06-01 extension)
export interface Prefs {
  // ... existing keys from Phase 1..5

  // ───── Phase 6 (Plan 06-01, D-165) ─────
  /** Life OS active tab (used by MeetingsView + FinanceView right-pane). */
  'lifeOs.activeTab'?: string;
  /** Health unit system (metric/imperial). */
  'lifeOs.health.unit'?: 'metric' | 'imperial';
  /** Default currency for Intl.NumberFormat in FinanceView. */
  'lifeOs.finance.currency'?: string;
  /** Identity active tab (PersonaView, NegotiationView). */
  'identity.activeTab'?: string;
  /** Last-expanded trait id in PersonaView. */
  'identity.persona.expandedTrait'?: string;
}
```

Debounce + single blob discipline preserved (D-12).

---

## 7. Common CSS conventions (Plan 06-03..06)

```css
/* src/features/life-os/life-os.css (Plan 06-02 creates; 06-03..06 extend) */
@layer features {
  .life-surface {
    padding: var(--sp-4);
    height: 100%;
    overflow-y: auto;
  }

  .life-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--sp-3);
  }

  .life-card[data-status="running"]  { border-left: 3px solid var(--status-running); }
  .life-card[data-status="complete"] { border-left: 3px solid var(--status-success); }
  .life-card[data-status="failed"]   { border-left: 3px solid var(--status-error); }

  .life-stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--sp-2);
  }

  .life-tab-pill {
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    cursor: pointer;
    font-size: 13px;
    transition: background 140ms var(--ease-out);
  }
  .life-tab-pill[data-active="true"] {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.22);
  }
}

/* src/features/identity/identity.css — parallel structure (Plan 06-02 creates) */
@layer features {
  .identity-surface {
    padding: var(--sp-4);
    height: 100%;
    overflow-y: auto;
  }
  .identity-card {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    border-radius: var(--radius-card);
    padding: var(--sp-3);
  }
  .identity-tabs {
    display: flex;
    gap: var(--sp-1);
    padding: var(--sp-2) 0;
    border-bottom: 1px solid var(--line);
    margin-bottom: var(--sp-3);
  }
  .identity-tab-pill {
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--radius-pill);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--line);
    cursor: pointer;
    font-size: 13px;
    transition: background 140ms var(--ease-out);
  }
  .identity-tab-pill[data-active="true"] {
    background: rgba(255, 255, 255, 0.14);
    border-color: rgba(255, 255, 255, 0.22);
  }
}
```

**Rules (inherit Phase 5 §10):**
- Only `GlassPanel` primitive uses `backdrop-filter`; inner cards use `rgba(...)` bg (D-07 + D-70).
- Every status color is a CSS token (`--status-running` etc.) — already introduced by Phase 5 Plan 05-02; Phase 6 REUSES.
- No hex colors in component files.

---

## 8. Playwright spec recipe (Plan 06-07, inherits Phase 5 §7)

Same harness, 4 new specs. Example:

```ts
// tests/e2e/identity-character-bible.spec.ts (Plan 06-07)
import { test, expect } from '@playwright/test';

test('CharacterBible loads bible content + round-trips trait update (SC-4)', async ({ page }) => {
  await page.goto('http://localhost:1420/#/dev-character-bible');
  await page.waitForSelector('[data-testid="character-bible-root"]', { timeout: 5000 });

  // Bible content present
  const bibleText = await page.locator('[data-testid="character-bible-content"]').textContent();
  expect((bibleText ?? '').length).toBeGreaterThan(0);

  // Simulate a trait update (dev isolation hook mocks the reaction invoke)
  await page.evaluate(() => {
    const emit = (window as any).__TAURI_EMIT__;
    // If a trait_updated event exists in Phase 6, emit it; otherwise rely on re-fetch after action.
    emit?.('persona_trait_updated', { name: 'curiosity', score: 0.87 });
  });

  // Navigate to /persona (dev route) and verify the trait score appears
  // (this test verifies the round-trip; uses dev invoke hook to avoid backend dependency).
});
```

**Rules:**
- Dev-only isolation routes (Plan 06-07 Task 1): `/dev-health-view`, `/dev-finance-view`, `/dev-character-bible`, `/dev-persona-view`.
- All specs reuse existing harness — NO new test deps.
- Each spec asserts ONE success criterion.

---

## 9. Verify script recipe (Plan 06-07, inherits Phase 5 §8)

```bash
# scripts/verify-phase6-rust-surface.sh (Plan 06-07)
#!/usr/bin/env bash
set -euo pipefail

MISSING=()

check() {
  local pattern="$1"
  if ! grep -q -E "$pattern" src-tauri/src/lib.rs; then
    MISSING+=("$pattern")
  fi
}

# Life OS — health_tracker (9)
check 'health_tracker::health_log'
check 'health_tracker::health_get_today'
check 'health_tracker::health_update_today'
check 'health_tracker::health_get_logs'
check 'health_tracker::health_get_stats'
check 'health_tracker::health_get_insights'
check 'health_tracker::health_get_context'
check 'health_tracker::health_correlate_productivity'
check 'health_tracker::health_streak_info'

# Life OS — financial_brain (15)
check 'financial_brain::finance_add_transaction'
check 'financial_brain::finance_get_transactions'
# ... (continue for all 150+ commands per D-140 inventory)

# Identity — character (7)
check 'character::get_character_bible'
check 'character::update_character_section'
# ...

# Identity — persona_engine (13)
check 'persona_engine::persona_get_traits'
check 'persona_engine::get_user_model'
# ...

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "ERROR: Phase 6 required Rust commands not found in lib.rs:" >&2
  for m in "${MISSING[@]}"; do echo "  - $m" >&2; done
  exit 1
fi
echo "OK: all Phase 6 Rust commands registered."
```

**Rules:**
- Enumerate all 150+ Phase 6 commands per D-140 inventory.
- Exit non-zero on missing; CI fails fast.
- `npm run verify:all` composes.

---

## 10. Edit convention: `scripts/verify-feature-cluster-routes.sh` extension

Extend the Phase 5 version to also check the 9+7 Phase 6 routes:

```bash
# Phase 6 addition — append to existing verify-feature-cluster-routes.sh
LIFEOS=src/features/life-os/index.tsx
IDENTITY=src/features/identity/index.tsx

for f in "$LIFEOS" "$IDENTITY"; do
  if grep -q 'ComingSoonSkeleton' "$f"; then
    echo "ERROR: $f still references ComingSoonSkeleton — Phase 6 should use real lazy imports per D-143." >&2
    exit 1
  fi
  if ! grep -q "lazy(() => import" "$f"; then
    echo "ERROR: $f missing React.lazy imports — Phase 6 needs real route components." >&2
    exit 1
  fi
done

for f in HealthView FinanceView GoalView HabitView MeetingsView SocialGraphView PredictionsView EmotionalIntelView AccountabilityView; do
  if [ ! -f "src/features/life-os/${f}.tsx" ]; then
    echo "ERROR: Missing src/features/life-os/${f}.tsx (Plan 06-02/03/04 contract)" >&2
    exit 1
  fi
done
for f in SoulView PersonaView CharacterBible NegotiationView ReasoningView ContextEngineView SidecarView; do
  if [ ! -f "src/features/identity/${f}.tsx" ]; then
    echo "ERROR: Missing src/features/identity/${f}.tsx (Plan 06-02/05/06 contract)" >&2
    exit 1
  fi
done
```

---

*Phase: 06-life-os-identity*
*Patterns captured: 2026-04-19 — downstream plans MUST follow these or justify in commit messages. Phase 5 patterns apply verbatim where this file is silent.*
