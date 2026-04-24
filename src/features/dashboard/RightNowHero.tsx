// src/features/dashboard/RightNowHero.tsx — DASH-01 perception_fusion consumer.
//
// On mount: perceptionGetLatest() → if cache empty (cold boot before 30s
// tick) fall back to perceptionUpdate() which forces a fresh capture. After
// state lands, fire performance.mark('dashboard-paint') — this is the SC-5
// first-paint mark asserted by Plan 03-07's dashboard-paint.spec.ts (D-77
// falsifier: Playwright measures boot → dashboard-paint < 400ms headless).
//
// Poll: setInterval(perceptionUpdate, 30s) matches the backend cache cadence
// (perception_fusion.rs start_perception_loop ticks every 30s; perception_
// update is backend-cached for 30s so the IPC is cheap — D-74). Cleanup
// clears the interval and sets a cancelled flag so the async fetcher never
// setState after unmount (T-03-05-02 mitigation — back/forward navigation
// would otherwise leak intervals).
//
// Visible errors are sliced to 5 max in render (T-03-05-05 — OCR may
// surface arbitrary-length error lists; clamp defensively). `\u00A0`
// placeholder for empty active_title prevents the secondary-line reflow on
// apps that don't expose a window title.
//
// NO backdrop-filter in this component's CSS contribution — T-03-05-04
// keeps us under the D-07 cap of 3 blur layers (NavRail + TitleBar + shell
// already count; adding a fourth here blows the SC-5 budget).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-74, §D-77
// @see .planning/phases/03-dashboard-chat-settings/03-PATTERNS.md §7
// @see src-tauri/src/perception_fusion.rs:19 (PerceptionState shape)

import { useEffect, useState } from 'react';
import { perceptionGetLatest, perceptionUpdate } from '@/lib/tauri/perception';
import { ecosystemListTentacles } from '@/lib/tauri/ecosystem';
import { deepScanResults } from '@/lib/tauri/deepscan';
import type { PerceptionState } from '@/types/perception';

// DENSITY-07 (Plan 15-04): the hero carries ≥ 3 live signals from the union of
// three independent backends — perception_fusion (active app + user state +
// vitals), ecosystem (enabled tentacle count), and deep_scan (repo count from
// the scan profile). Each fetch silently degrades on error so a cold install
// with no scan run and no tentacles enabled still renders chips with `0` /
// `…` placeholders rather than "No data" bare negation (15-03 copy rule).

export function RightNowHero() {
  const [state, setState] = useState<PerceptionState | null>(null);
  const [tentacleCount, setTentacleCount] = useState<number | null>(null);
  const [scanRepoCount, setScanRepoCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    // DENSITY-07: parallel fetch of ecosystem + scan signals. These run
    // alongside perception so the hero paints its three signals in one
    // commit cycle. No retry loops (T-15-04-02 mitigation).
    ecosystemListTentacles()
      .then((t) => {
        if (cancelled) return;
        setTentacleCount(t.filter((x) => x.enabled).length);
      })
      .catch(() => {
        /* silent degrade — chip renders `…` when tentacleCount stays null */
      });

    deepScanResults()
      .then((r) => {
        if (cancelled) return;
        if (!r) {
          // Cold install — scan has never run. 0 IS a live signal
          // (truthful "you have 0 known repos") per DENSITY-07.
          setScanRepoCount(0);
          return;
        }
        // DeepScanResults is typed as Record<string, unknown> in the TS
        // surface (src/types/provider.ts:48). The Rust struct exposes a
        // `repos` array in the fs_repos scanner output, but the exact
        // shape isn't narrowed in TS. Read defensively so a future Rust
        // schema rename doesn't crash the hero — fall back to 0.
        const rec = r as Record<string, unknown>;
        const repos = rec.repos;
        const count = Array.isArray(repos)
          ? repos.length
          : typeof rec.repos_found === 'number'
            ? (rec.repos_found as number)
            : typeof rec.repo_count === 'number'
              ? (rec.repo_count as number)
              : 0;
        setScanRepoCount(count);
      })
      .catch(() => {
        /* silent degrade */
      });

    (async () => {
      let latest: PerceptionState | null = null;
      try {
        latest = await perceptionGetLatest();
      } catch {
        latest = null;
      }
      if (!latest) {
        try {
          latest = await perceptionUpdate();
        } catch {
          latest = null;
        }
      }
      if (cancelled) return;
      setState(latest);
      // P-01 / D-77: first-paint mark. Fires AFTER setState has queued the
      // render so the Playwright assertion boot → dashboard-paint covers
      // the full perception fetch + commit path.
      try {
        performance.mark('dashboard-paint');
        if (import.meta.env.DEV) {
          try {
            performance.measure('boot-to-dashboard-paint', 'boot', 'dashboard-paint');
            const m = performance.getEntriesByName('boot-to-dashboard-paint').slice(-1)[0];
            if (m) {
              // eslint-disable-next-line no-console
              console.log(
                `[perf] dashboard-first-paint: ${m.duration.toFixed(1)}ms (budget 200ms)`,
              );
            }
          } catch {
            /* noop — boot mark missing (e.g. hot-reload) */
          }
        }
      } catch {
        /* perf API unavailable */
      }
    })();

    // 30s poll matches backend cache cadence — cheap IPC, bounded render
    // pressure. Cleared in cleanup to prevent T-03-05-02 (interval leak on
    // route churn back/forward ×N).
    const interval = window.setInterval(async () => {
      try {
        const next = await perceptionUpdate();
        if (!cancelled) setState(next);
      } catch {
        /* transient backend error — next tick retries */
      }
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!state) {
    return (
      <section className="dash-hero dash-hero-loading" aria-busy="true">
        <span className="dash-hero-loading-text">Reading the room…</span>
      </section>
    );
  }

  const activeApp = state.active_app || 'No active app';
  const activeTitle = state.active_title || '\u00A0';
  const userState = state.user_state || 'focused';
  // T-03-05-05: clamp OCR visible_errors to 5 max for rendering; the full
  // list stays in state for DEV inspection but never goes to the DOM.
  const errorsShown = state.visible_errors.slice(0, 5);

  return (
    <section className="dash-hero" aria-label="Right now">
      <header className="dash-hero-head">
        {/* DENSITY-07: live signal — active app from perception_fusion */}
        <h2 className="dash-hero-app t-h2" data-signal="active-app">{activeApp}</h2>
        <span
          className={`dash-hero-state state-${userState}`}
          aria-label={`user state: ${userState}`}
        >
          {userState}
        </span>
      </header>
      <p className="dash-hero-title t-body" title={state.active_title || undefined}>
        {activeTitle}
      </p>
      <ul className="dash-hero-chips">
        <li className="dash-hero-chip">
          <span className="dash-hero-chip-label">RAM</span>
          <span className="dash-hero-chip-value">{state.ram_used_gb.toFixed(1)} GB</span>
        </li>
        <li className="dash-hero-chip">
          <span className="dash-hero-chip-label">Disk free</span>
          <span className="dash-hero-chip-value">{state.disk_free_gb.toFixed(1)} GB</span>
        </li>
        <li className="dash-hero-chip">
          <span className="dash-hero-chip-label">Top</span>
          <span className="dash-hero-chip-value">{state.top_cpu_process || '—'}</span>
        </li>
        {/* DENSITY-07: live signal — repos from scan profile (deep_scan) */}
        <li className="dash-hero-chip" data-signal="scan-repos">
          <span className="dash-hero-chip-label">Repos</span>
          <span className="dash-hero-chip-value">
            {scanRepoCount === null ? '…' : scanRepoCount}
          </span>
        </li>
        {/* DENSITY-07: live signal — active ecosystem tentacles */}
        <li className="dash-hero-chip" data-signal="tentacles">
          <span className="dash-hero-chip-label">Watching</span>
          <span className="dash-hero-chip-value">
            {tentacleCount === null
              ? '…'
              : `${tentacleCount} tentacle${tentacleCount === 1 ? '' : 's'}`}
          </span>
        </li>
        {/* DENSITY-07: live signal — user state from perception (already fetched) */}
        <li className="dash-hero-chip" data-signal="user-state">
          <span className="dash-hero-chip-label">State</span>
          <span className="dash-hero-chip-value">{userState}</span>
        </li>
      </ul>
      {state.visible_errors.length > 0 ? (
        <details className="dash-hero-errors">
          <summary>
            {state.visible_errors.length} visible error
            {state.visible_errors.length === 1 ? '' : 's'}
          </summary>
          <ul>
            {errorsShown.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
