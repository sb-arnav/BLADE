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
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-52
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §8

import {
  createContext,
  createElement,
  useCallback,
  useContext,
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

export interface RouterContextValue {
  routeId: string;
  openRoute: (id: string) => void;
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
  const backStack = useRef<string[]>([]);
  const fwdStack = useRef<string[]>([]);

  const openRoute = useCallback(
    (id: string) => {
      if (!ROUTE_MAP.has(id)) {
        // T-02-05-02 mitigation — unknown id logged + ignored, never poisons state.
        console.warn('[useRouter] unknown route id, ignoring:', id);
        return;
      }
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
  }, [setPref]);

  const value = useMemo<RouterContextValue>(
    () => ({ routeId, openRoute, back, forward, canBack, canForward }),
    [routeId, openRoute, back, forward, canBack, canForward],
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

  return createElement(Ctx.Provider, { value }, children);
}

export function useRouterCtx(): RouterContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRouterCtx must be used inside <RouterProvider>');
  return v;
}

/** Convenience alias for top-level MainShell consumers. */
export const useRouter = useRouterCtx;
