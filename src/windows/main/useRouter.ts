// src/windows/main/useRouter.ts — In-memory router + prefs-backed lastRoute (D-52).
//
// RouterProvider lives at MainShell (Plan 02-06); consumers call useRouterCtx.
// Back/forward history is session-scoped; app restart resets it.
//
// Implementation note: this file stays a `.ts` (not `.tsx`) per Plan 02-05
// frontmatter — the <Ctx.Provider> wrapper is constructed with
// `createElement` so we don't need the JSX transform here. Phase 2 Plan 02-06
// consumes via aliased import; extension is invisible to callers.
//
// Phase 11 Plan 11-05 (D-54) extensions:
//   • `openRoute(id, hint?)` — optional second arg `hint?: Record<string,string>`
//     threads a side-channel payload (e.g., `{ needs: 'vision' }`) to the
//     target route so it can deep-link-focus a specific affordance. Existing
//     single-arg callers are unaffected — the parameter is optional.
//   • `routeHint` — sidecar state exposed via RouterContext. ProvidersPane
//     consumes it (Plan 11-05 Task 2) to scroll-focus the paste textarea.
//   • `__BLADE_TEST_OPEN_ROUTE` — window hatch attached under test-mode
//     (`import.meta.env.MODE === 'test'`) OR dev-mode + `?e2e=1` URL param.
//     Production builds strip the branch (Vite constant-folds `import.meta.env.DEV`
//     to `false` at build time → dead-code elimination drops the useEffect).
//     Plan 11-03 + this plan's 8 e2e specs depend on this hatch for navigation.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-52
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §8
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54
// @see .planning/phases/11-smart-provider-setup/11-05-PLAN.md

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_ROUTE_ID } from '@/lib/router';
import { ROUTE_MAP } from '@/windows/main/router';
import { usePrefs } from '@/hooks/usePrefs';
// Phase 4 Plan 04-06 (D-114, D-116) — cross-window navigation consumer.
// Rust `emit_route_request` (Plan 04-01) + HUD right-click menu emit
// BLADE_ROUTE_REQUEST with `{route_id}`; main-side forwards to openRoute.
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { BladeRouteRequestPayload } from '@/lib/events';

/** Phase 11 Plan 11-05 — router hint shape. Freeform key/value bag the
 *  originating caller ships to the target route (e.g., `{ needs: 'vision' }`
 *  for Settings → Providers paste-focus). Enum-typed call sites constrain
 *  values; the map accepts any string to stay forward-compatible. */
export type RouteHint = Record<string, string>;

export interface RouterContextValue {
  routeId: string;
  /**
   * Open a route by id. Optional second arg ships a `hint` payload surfaced
   * at the target route via `routeHint`. Hint clears automatically when a
   * different route is opened with no hint supplied.
   */
  openRoute: (id: string, hint?: RouteHint) => void;
  /** Most recent hint passed to openRoute; null outside a hint-carrying navigation. */
  routeHint: RouteHint | null;
  back: () => void;
  forward: () => void;
  canBack: boolean;
  canForward: boolean;
}

const Ctx = createContext<RouterContextValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const { prefs, setPref } = usePrefs();

  // prefs is stable at first render; subsequent localStorage writes don't
  // re-initialise the router — that's intentional per D-52. The lazy
  // `useState` initializer below captures the initial value exactly once.
  const [routeId, setRouteId] = useState<string>(() => {
    const last = prefs['app.lastRoute'];
    const dflt = prefs['app.defaultRoute'];
    if (typeof last === 'string' && ROUTE_MAP.has(last)) return last;
    if (typeof dflt === 'string' && ROUTE_MAP.has(dflt)) return dflt;
    return DEFAULT_ROUTE_ID;
  });

  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  // Phase 11 Plan 11-05 — route hint sidecar. Set when openRoute receives a
  // 2nd arg; cleared when openRoute is called with no hint. Consumers
  // (e.g., ProvidersPane) react to changes via useEffect([routeHint]).
  const [routeHint, setRouteHint] = useState<RouteHint | null>(null);
  const backStack = useRef<string[]>([]);
  const fwdStack = useRef<string[]>([]);

  const openRoute = useCallback(
    (id: string, hint?: RouteHint) => {
      if (!ROUTE_MAP.has(id)) {
        // T-02-05-02 mitigation — unknown id logged + ignored, never poisons state.
        console.warn('[useRouter] unknown route id, ignoring:', id);
        return;
      }
      // Phase 11 Plan 11-05 — set (or clear) the hint on every openRoute call.
      // Consumers that depend on the hint see a fresh reference even when
      // navigating to the same route again with a different hint.
      setRouteHint(hint ?? null);
      setRouteId((prev) => {
        if (id === prev) return prev;
        backStack.current.push(prev);
        fwdStack.current = [];
        setCanBack(backStack.current.length > 0);
        setCanForward(false);
        setPref('app.lastRoute', id);
        return id;
      });
    },
    [setPref],
  );

  const back = useCallback(() => {
    setRouteId((prev) => {
      const target = backStack.current.pop();
      if (!target) return prev;
      fwdStack.current.push(prev);
      setCanBack(backStack.current.length > 0);
      setCanForward(fwdStack.current.length > 0);
      setPref('app.lastRoute', target);
      return target;
    });
    // History navigation clears any pending hint — hints only apply on fresh
    // forward navigations triggered by an intent (e.g., deep-link).
    setRouteHint(null);
  }, [setPref]);

  const forward = useCallback(() => {
    setRouteId((prev) => {
      const target = fwdStack.current.pop();
      if (!target) return prev;
      backStack.current.push(prev);
      setCanBack(backStack.current.length > 0);
      setCanForward(fwdStack.current.length > 0);
      setPref('app.lastRoute', target);
      return target;
    });
    setRouteHint(null);
  }, [setPref]);

  const value = useMemo<RouterContextValue>(
    () => ({ routeId, openRoute, routeHint, back, forward, canBack, canForward }),
    [routeId, openRoute, routeHint, back, forward, canBack, canForward],
  );

  // Phase 4 Plan 04-06 (D-114, D-116) — cross-window navigation hint.
  // HUD right-click menu (Plan 04-05) + Rust `emit_route_request` (Plan 04-01)
  // publish BLADE_ROUTE_REQUEST with a validated route_id. openRoute's own
  // T-02-05-02 guard (ROUTE_MAP.has) drops unknown ids silently, so the
  // cross-window surface can't poison router state.
  useTauriEvent<BladeRouteRequestPayload>(
    BLADE_EVENTS.BLADE_ROUTE_REQUEST,
    (e) => {
      openRoute(e.payload.route_id);
    },
  );

  // Phase 11 Plan 11-05 — test-only navigation hatch. Plan 11-03 + this plan's
  // 8 Playwright specs depend on this. Gated so it never reaches production:
  //   (a) `import.meta.env.MODE === 'test'` — Vitest / unit-test runners
  //   (b) `import.meta.env.DEV && ?e2e=1` — Playwright drives the dev build
  // Vite inlines `import.meta.env.DEV` to `false` in production bundles; the
  // entire useEffect body becomes unreachable and tree-shakes out.
  useEffect(() => {
    const isTest = import.meta.env.MODE === 'test';
    const isDevE2E =
      import.meta.env.DEV &&
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('e2e');
    if (!isTest && !isDevE2E) return;

    const w = window as unknown as {
      __BLADE_TEST_OPEN_ROUTE?: (id: string, hint?: RouteHint) => void;
    };
    w.__BLADE_TEST_OPEN_ROUTE = (id: string, hint?: RouteHint) => {
      openRoute(id, hint);
    };
    return () => {
      try {
        delete w.__BLADE_TEST_OPEN_ROUTE;
      } catch {
        /* noop — HMR dev only, never throws in practice */
      }
    };
  }, [openRoute]);

  return createElement(Ctx.Provider, { value }, children);
}

export function useRouterCtx(): RouterContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRouterCtx must be used inside <RouterProvider>');
  return v;
}

/** Convenience alias for top-level MainShell consumers. */
export const useRouter = useRouterCtx;
