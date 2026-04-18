# Phase 2 Patterns — Recurring Recipes

**Mapped:** 2026-04-18
**Scope:** Code recipes Phase 2 implementers MUST follow verbatim (or cite a deviation in their commit message).

---

## 1. Wrapper recipe (extending `src/lib/tauri/config.ts`)

Every new wrapper cites Rust file:line in JSDoc and passes snake_case args verbatim. Template:

```ts
/** @see src-tauri/src/config.rs:605 `pub fn get_all_provider_keys() -> serde_json::Value` */
export function getAllProviderKeys(): Promise<ProviderKeyList> {
  return invokeTyped<ProviderKeyList>('get_all_provider_keys');
}

/** @see src-tauri/src/config.rs:636 `pub fn store_provider_key(provider: String, api_key: String) -> Result<(), String>` */
export function storeProviderKey(provider: string, apiKey: string): Promise<void> {
  return invokeTyped<void, { provider: string; api_key: string }>(
    'store_provider_key',
    { provider, api_key: apiKey },
  );
}

/** @see src-tauri/src/commands.rs:2025 `pub async fn test_provider(provider, api_key, model, base_url) -> Result<String, String>` */
export function testProvider(args: {
  provider: string;
  apiKey: string;
  model: string;
  baseUrl?: string;
}): Promise<string> {
  return invokeTyped<string, { provider: string; api_key: string; model: string; base_url?: string }>(
    'test_provider',
    { provider: args.provider, api_key: args.apiKey, model: args.model, base_url: args.baseUrl },
  );
}
```

**Discipline (D-38):** function name camelCase; invoke arg keys snake_case. Never transform in the wrapper body — the object literal inside `invokeTyped` is the single mapping point.

---

## 2. `useOnboardingState` hook skeleton

```ts
// src/features/onboarding/useOnboardingState.ts
export type OnbStep = 'provider' | 'apikey' | 'scan' | 'persona';

interface OnbState {
  step: OnbStep;
  providerId: string;          // 'anthropic' by default
  modelId: string;             // derived from providerId
  apiKey: string;              // cleared after store_provider_key succeeds
  testResult: string | null;   // test_provider response text
  testError: string | null;
  scanComplete: boolean;
  scanProgress: Record<string, number>; // phase → found count; derived percent in UI
  personaAnswers: string[];    // length 5 when enabled
}

export function useOnboardingState() {
  const [state, setState] = useState<OnbState>(INITIAL);
  const advance = (to: OnbStep) => setState(s => ({ ...s, step: to }));
  // ... mutators for each step
  return { state, advance, /* setters */ };
}
```

`scanProgress` collected via `useTauriEvent(BLADE_EVENTS.DEEP_SCAN_PROGRESS, e => setState(s => ({ ...s, scanProgress: { ...s.scanProgress, [e.payload.phase]: e.payload.found } })))`.

---

## 3. Step-pill component template (used in every onboarding screen)

```tsx
interface StepPill { n: number; label: string; state: 'active' | 'done' | 'idle' }

function Steps({ items }: { items: StepPill[] }) {
  return (
    <div className="onb-steps">
      {items.map((s, i) => (
        <React.Fragment key={s.n}>
          <div className={`step-pill ${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
            <span className="num">{s.state === 'done' ? '✓' : s.n}</span>
            {s.label}
          </div>
          {i < items.length - 1 && <span className="step-divider" />}
        </React.Fragment>
      ))}
    </div>
  );
}
```

CSS already ported in `docs/design/onboarding-01-provider.html:14-23` — re-express using tokens (`var(--r-pill)`, `var(--t-3)`, etc.) in a co-located `Onboarding.css`.

---

## 4. Deep-scan SVG ring pattern

```tsx
function ProgressRing({ percent }: { percent: number }) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - Math.max(0, Math.min(100, percent)) / 100);
  return (
    <svg viewBox="0 0 100 100" width={100} height={100} role="progressbar"
         aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="3" />
      <circle cx="50" cy="50" r={R} fill="none" stroke="rgba(255,255,255,0.92)" strokeWidth="3"
              strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 360ms var(--ease-smooth)' }} />
    </svg>
  );
}
```

Percent is derived client-side per D-49 phase → percent map. Scanner labels list mirrors `src-tauri/src/deep_scan.rs:1375-1383`.

---

## 5. Toast provider skeleton (D-59)

```tsx
// src/lib/context/ToastContext.tsx
interface ToastItem { id: string; type: 'info'|'success'|'warn'|'error'; title: string; message?: string; createdAt: number; durationMs: number }

const ToastCtx = createContext<{ show: (t: Omit<ToastItem, 'id' | 'createdAt' | 'durationMs'> & { durationMs?: number }) => void; dismiss: (id: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((t) => {
    const id = crypto.randomUUID();
    const durationMs = t.durationMs ?? (t.type === 'error' || t.type === 'warn' ? 7000 : 4000);
    const item: ToastItem = { ...t, id, createdAt: Date.now(), durationMs };
    setItems(prev => [...prev, item].slice(-5));
    setTimeout(() => setItems(prev => prev.filter(x => x.id !== id)), durationMs);
  }, []);
  const dismiss = useCallback((id) => setItems(prev => prev.filter(x => x.id !== id)), []);
  return (
    <ToastCtx.Provider value={{ show, dismiss }}>
      {children}
      <ToastViewport items={items} dismiss={dismiss} />
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error('useToast must be inside <ToastProvider>');
  return v;
}
```

`ToastViewport` renders in a React Portal to `document.body` so Dialog z-indexing doesn't bury it.

---

## 6. BackendToastBridge (D-60)

```tsx
// src/lib/context/BackendToastBridge.tsx
export function BackendToastBridge() {
  const { show } = useToast();
  useTauriEvent<BladeNotificationPayload>(BLADE_EVENTS.BLADE_NOTIFICATION, e => {
    show({ type: e.payload.type === 'warn' ? 'warn' : e.payload.type, title: e.payload.message });
  });
  useTauriEvent<BladeToastPayload>(BLADE_EVENTS.BLADE_TOAST, e => {
    show({ type: e.payload.type ?? 'info', title: e.payload.message, durationMs: e.payload.duration_ms });
  });
  useTauriEvent<ShortcutRegistrationFailedPayload>(BLADE_EVENTS.SHORTCUT_REGISTRATION_FAILED, e => {
    show({ type: 'warn', title: `Shortcut failed: ${e.payload.shortcut}`, message: e.payload.error });
  });
  return null;
}
```

Mounted once inside `ToastProvider` (under the children tree).

---

## 7. Command Palette structure (D-57, D-58)

```tsx
// src/design-system/shell/CommandPalette.tsx
function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, setPref } = usePrefs();
  const { openRoute } = useRouter();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);

  const items = useMemo(() => {
    const recentIds = Array.isArray(prefs['palette.recent']) ? (prefs['palette.recent'] as unknown as string[]) : [];
    const scored = PALETTE_COMMANDS.map(c => ({ c, score: fuzzyScore(c, query) })).filter(x => x.score >= 0);
    if (!query) {
      // Empty query: recents first, then the rest alphabetically
      const recent = recentIds.map(id => PALETTE_COMMANDS.find(c => c.id === id)).filter(Boolean) as RouteDefinition[];
      const rest = PALETTE_COMMANDS.filter(c => !recentIds.includes(c.id)).sort((a, b) => a.label.localeCompare(b.label));
      return [...recent, ...rest];
    }
    return scored.sort((a, b) => b.score - a.score).map(x => x.c);
  }, [query, prefs]);

  // Keyboard handlers: ArrowUp/Down, Enter, Esc

  function choose(r: RouteDefinition) {
    const recent = [r.id, ...((prefs['palette.recent'] as unknown as string[]) ?? []).filter(x => x !== r.id)].slice(0, 5);
    setPref('palette.recent', recent as unknown as string);  // prefs index sig accepts this at runtime; narrow in Plan 06
    openRoute(r.id);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} ariaLabel="Command palette">
      {/* input + filtered list + keyboard handlers */}
    </Dialog>
  );
}
```

Fuzzy score from `src.bak/components/CommandPalette.tsx:48-79` — re-typed, not imported.

---

## 8. `useRouter` skeleton (D-51, D-52)

```ts
// src/windows/main/useRouter.ts
export function useRouter() {
  const { prefs, setPref } = usePrefs();
  const initial = useMemo(() =>
    (prefs['app.lastRoute'] as string | undefined) ??
    (prefs['app.defaultRoute'] as string | undefined) ??
    DEFAULT_ROUTE_ID, []);
  const [routeId, setRouteId] = useState<string>(initial);
  const backStackRef = useRef<string[]>([]);
  const fwdStackRef = useRef<string[]>([]);

  const openRoute = useCallback((id: string) => {
    if (!ROUTE_MAP.has(id)) { console.warn('[useRouter] unknown route', id); return; }
    if (id === routeId) return;
    backStackRef.current.push(routeId);
    fwdStackRef.current = [];
    setRouteId(id);
    setPref('app.lastRoute', id);
  }, [routeId, setPref]);

  const back = useCallback(() => {
    const prev = backStackRef.current.pop();
    if (!prev) return;
    fwdStackRef.current.push(routeId);
    setRouteId(prev);
    setPref('app.lastRoute', prev);
  }, [routeId, setPref]);

  const forward = useCallback(() => {
    const next = fwdStackRef.current.pop();
    if (!next) return;
    backStackRef.current.push(routeId);
    setRouteId(next);
    setPref('app.lastRoute', next);
  }, [routeId, setPref]);

  return { routeId, openRoute, back, forward, canBack: backStackRef.current.length > 0, canForward: fwdStackRef.current.length > 0 };
}
```

`useRouter` is consumed via a React Context (`RouterProvider` + `useRouterCtx`) so NavRail / Palette / TitleBar share state without prop-drilling. The Context lives next to the hook in `src/windows/main/useRouter.ts`.

---

## 9. NavRail derivation (D-55)

```tsx
// src/design-system/shell/NavRail.tsx
const CORE_IDS = ['dashboard', 'chat', 'settings'] as const;

export function NavRail() {
  const { routeId, openRoute } = useRouterCtx();
  const core = CORE_IDS
    .map(id => PALETTE_COMMANDS.find(c => c.id === id))
    .filter(Boolean) as RouteDefinition[];
  const sectionFirsts = new Map<string, RouteDefinition>();
  for (const r of PALETTE_COMMANDS) {
    if (r.section !== 'core' && !sectionFirsts.has(r.section)) sectionFirsts.set(r.section, r);
  }

  return (
    <nav className="navrail" aria-label="Primary">
      <div className="navrail-logo">B</div>
      {core.map(r => <NavBtn key={r.id} route={r} active={routeId === r.id} onClick={() => openRoute(r.id)} />)}
      <div className="navrail-divider" />
      {[...sectionFirsts.values()].map(r => (
        <NavBtn key={r.id} route={r} active={routeId.startsWith(r.section + '-') || routeId === r.id} onClick={() => openRoute(r.id)} />
      ))}
    </nav>
  );
}
```

Icons: inline SVG in `NavRail.tsx`, keyed by `RouteDefinition.id` or `.section`. Falls back to a generic dot if unmapped.

---

## 10. Keyboard shortcut hook (D-62)

```ts
// src/windows/main/useGlobalShortcuts.ts
export function useGlobalShortcuts({ openPalette }: { openPalette: () => void }) {
  const { openRoute, back, forward } = useRouterCtx();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (isEditableTarget(e.target)) {
        // Do not swallow Mod+K inside text inputs unless the binding is palette-open;
        // for everything else, bail so text-editing shortcuts still work.
        if (e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
        return;
      }
      switch (e.key) {
        case 'k': case 'K': e.preventDefault(); openPalette(); break;
        case '1': e.preventDefault(); openRoute('dashboard'); break;
        case '/': e.preventDefault(); openRoute('chat'); break;
        case ',': e.preventDefault(); openRoute('settings'); break;
        case '[': e.preventDefault(); back(); break;
        case ']': e.preventDefault(); forward(); break;
        default:
          // derived from RouteDefinition.shortcut (e.g. 'Mod+1')
          const match = ALL_ROUTES.find(r => r.shortcut && shortcutMatches(r.shortcut, e));
          if (match) { e.preventDefault(); openRoute(match.id); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette, openRoute, back, forward]);
}
```

`isEditableTarget` checks `INPUT`, `TEXTAREA`, `[contenteditable]`. `shortcutMatches('Mod+1', e)` splits on `+` and compares.

---

## 11. Provider registry (Phase 2 onboarding)

Inline constant in `src/features/onboarding/providers.ts`:

```ts
export interface ProviderDef {
  id: 'anthropic' | 'openai' | 'openrouter' | 'gemini' | 'groq' | 'ollama';
  name: string;
  defaultModel: string;
  tagline: string;
  keyUrl: string;
  needsKey: boolean;
  gradient: [string, string]; // 2-stop CSS gradient for the logo chip
}

export const PROVIDERS: ProviderDef[] = [
  { id: 'anthropic',  name: 'Anthropic',    defaultModel: 'claude-sonnet-4-20250514', tagline: 'Claude, strong reasoning', keyUrl: 'https://console.anthropic.com/settings/keys', needsKey: true, gradient: ['#c96442', '#f0a97e'] },
  { id: 'openai',     name: 'OpenAI',       defaultModel: 'gpt-4o-mini',              tagline: 'GPT-4o mini, reliable',   keyUrl: 'https://platform.openai.com/api-keys',         needsKey: true, gradient: ['#0f8a60', '#10b27a'] },
  { id: 'openrouter', name: 'OpenRouter',   defaultModel: 'meta-llama/llama-3.3-70b-instruct:free', tagline: 'One key, 200+ models', keyUrl: 'https://openrouter.ai/settings/keys', needsKey: true, gradient: ['#5b5fe8', '#8b6fff'] },
  { id: 'gemini',     name: 'Google Gemini', defaultModel: 'gemini-2.0-flash',        tagline: 'Free tier, fast',         keyUrl: 'https://aistudio.google.com/apikey',           needsKey: true, gradient: ['#4285f4', '#34a0f5'] },
  { id: 'groq',       name: 'Groq',         defaultModel: 'llama-3.3-70b-versatile', tagline: 'Free tier, fastest',      keyUrl: 'https://console.groq.com/keys',                needsKey: true, gradient: ['#f55036', '#ff7a50'] },
  { id: 'ollama',     name: 'Ollama',       defaultModel: 'llama3.2',                 tagline: 'Local, offline',          keyUrl: '',                                              needsKey: false, gradient: ['#2c2c2c', '#555555'] },
];
```

Anthropic first = default-selected in the picker.

---

## 12. Deep scan phase enumeration (D-49)

Ordered list (source: `src-tauri/src/deep_scan.rs:1331-1419`):

```ts
export const DEEP_SCAN_PHASES = [
  'starting',
  'installed_apps',
  'git_repos',
  'ides',
  'ai_tools',
  'wsl_distros',
  'ssh_keys',
  'package_managers',
  'docker',
  'bookmarks',
  'complete',
] as const;
export type DeepScanPhase = typeof DEEP_SCAN_PHASES[number];

export function deepScanPercent(seen: Record<string, number>): number {
  // Each observed phase contributes equally; 'complete' jumps to 100 immediately.
  if (seen['complete'] !== undefined) return 100;
  const observed = DEEP_SCAN_PHASES.filter(p => p !== 'complete' && seen[p] !== undefined).length;
  return Math.round((observed / (DEEP_SCAN_PHASES.length - 1)) * 100);
}
```

`seen` is the `scanProgress` record in `OnbState`.

---

## 13. Playwright spec skeleton (D-63)

```ts
// tests/e2e/shell.spec.ts
import { test, expect } from '@playwright/test';

test('shell: Cmd+K opens palette, Enter navigates, Esc closes', async ({ page }) => {
  await page.goto('/'); // harness already loads the dev build
  await page.keyboard.press('Meta+KeyK'); // Control+KeyK on Linux — Playwright normalizes
  await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible();
  await page.fill('input[placeholder*="Search"]', 'settings');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/./); // single-page; assert shell body switched by querying a route data-attr
  await expect(page.locator('[data-route-id="settings"]')).toBeVisible();
  await page.keyboard.press('Escape'); // palette already closed; this is a smoke
});
```

Backend-event test uses `__TAURI_INVOKE_HOOK__` mocking shipped by the Phase 1 harness.

---

*Patterns finalized: 2026-04-18*
