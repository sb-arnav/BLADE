// src/features/body/BodyMap.tsx — BODY-01 (SC-1 falsifier).
//
// Plan 08-03 Task 1: real implementation.
//
// Renders the 12-system responsive card grid from body_get_summary() with a
// click drill-in that stores prefs.body.activeSystem and navigates to
// body-system-detail (D-201). Uses body_get_map() for hover-preview module
// names (first 3 modules per system).
//
// - Every Tauri call flows through @/lib/tauri/body wrappers (ESLint no-raw-tauri).
// - Cards are real `<button>` elements for keyboard a11y + focus ring.
// - data-testid="body-map-root" + per-card data-testid="body-system-card-{system}"
//   match Plan 08-05 Playwright expectations (D-199 placeholder roots preserved).
//
// @see .planning/phases/08-body-hive/08-03-PLAN.md Task 1
// @see .planning/phases/08-body-hive/08-CONTEXT.md §D-201 (SC-1 falsifier)
// @see .planning/REQUIREMENTS.md §BODY-01

import { useEffect, useMemo, useState } from 'react';
import { Button, GlassPanel, GlassSpinner, Pill } from '@/design-system/primitives';
import { usePrefs } from '@/hooks/usePrefs';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';
import { bodyGetMap, bodyGetSummary } from '@/lib/tauri/body';
import type { ModuleMapping } from '@/lib/tauri/body';
import './body.css';

export function BodyMap() {
  const router = useRouterCtx();
  const { setPref } = usePrefs();
  const toast = useToast();

  const [summary, setSummary] = useState<Array<[string, number]> | null>(null);
  const [map, setMap] = useState<ModuleMapping[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([bodyGetSummary(), bodyGetMap()])
      .then(([s, m]) => {
        if (cancelled) return;
        setSummary(s);
        setMap(m);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(typeof e === 'string' ? e : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Group modules per system for hover-preview (up to 3 names each).
  const previewBySystem = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!map) return out;
    for (const row of map) {
      const list = out.get(row.body_system) ?? [];
      if (list.length < 3) list.push(row.module);
      out.set(row.body_system, list);
    }
    return out;
  }, [map]);

  const totalModules = useMemo(() => {
    if (!summary) return 0;
    return summary.reduce((acc, [, count]) => acc + count, 0);
  }, [summary]);

  const openSystem = (system: string) => {
    setPref('body.activeSystem', system);
    router.openRoute('body-system-detail');
  };

  return (
    <GlassPanel tier={1} className="body-map-surface" data-testid="body-map-root">
      <header className="body-map-header">
        <div>
          <h1 className="body-map-title">Body Map</h1>
          <p className="body-map-sub">
            {summary
              ? `${summary.length} body systems · ${totalModules} modules registered`
              : 'Loading anatomy chart…'}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            setLoading(true);
            Promise.all([bodyGetSummary(), bodyGetMap()])
              .then(([s, m]) => {
                setSummary(s);
                setMap(m);
                setError(null);
                toast.show({ type: 'success', title: 'Body map refreshed' });
              })
              .catch((e) => {
                const msg = typeof e === 'string' ? e : String(e);
                setError(msg);
                toast.show({ type: 'error', title: 'Refresh failed', message: msg });
              })
              .finally(() => setLoading(false));
          }}
          disabled={loading}
          data-testid="body-map-refresh"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </header>

      {loading && !summary && (
        <div className="body-map-loading">
          <GlassSpinner />
          <span>Fetching body registry…</span>
        </div>
      )}

      {error && !loading && (
        <GlassPanel tier={2} className="body-map-error">
          <strong>Body registry unavailable.</strong>
          <p>{error}</p>
        </GlassPanel>
      )}

      {summary && summary.length > 0 && (
        <div className="body-map" role="list" data-testid="body-map-grid">
          {summary.map(([system, count]) => {
            const preview = previewBySystem.get(system) ?? [];
            return (
              <button
                key={system}
                type="button"
                role="listitem"
                className="body-system-card"
                data-testid={`body-system-card-${system}`}
                onClick={() => openSystem(system)}
                aria-label={`${system} — ${count} modules`}
              >
                <div className="body-system-card-head">
                  <span className="body-system-name">{system}</span>
                  <Pill tone="default">{count}</Pill>
                </div>
                <ul className="body-system-preview">
                  {preview.length === 0 ? (
                    <li className="body-system-preview-empty">No modules listed</li>
                  ) : (
                    preview.map((mod) => (
                      <li key={mod} className="body-system-preview-item">
                        {mod}
                      </li>
                    ))
                  )}
                </ul>
                <span className="body-system-card-cta">Open system →</span>
              </button>
            );
          })}
        </div>
      )}

      {summary && summary.length === 0 && !loading && (
        <p className="body-map-empty">No body systems registered.</p>
      )}
    </GlassPanel>
  );
}
