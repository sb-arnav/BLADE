// src/features/onboarding/DeepScanStep.tsx — Step 3 (ONBD-04).
//
// Invokes deep_scan_start and subscribes to deep_scan_progress. Shows SVG
// progress ring + 10 scanner labels. Continue CTA enabled when scan completes.
//
// T-02-04-07 mitigation: `startedRef` sentinel prevents duplicate deep_scan_start
// invocations on React Strict Mode double-mount / re-render churn.
//
// @see docs/design/onboarding-03-ready.html
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §4, §12

import { useEffect, useRef } from 'react';
import { Button } from '@/design-system/primitives';
import { Steps } from './Steps';
import { deepScanStart, TauriError } from '@/lib/tauri';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { DeepScanProgressPayload } from '@/lib/events';
import { DEEP_SCAN_PHASES, PHASE_LABEL, deepScanPercent } from './deepScanPhases';
import { useToast } from '@/lib/context';
import type { useOnboardingState } from './useOnboardingState';

type State = ReturnType<typeof useOnboardingState>;

interface Props {
  state: State['state'];
  setStep: State['setStep'];
  beginScan: State['beginScan'];
  observePhase: State['observePhase'];
  endScan: State['endScan'];
}

export function DeepScanStep({
  state,
  setStep,
  beginScan,
  observePhase,
  endScan,
}: Props) {
  const { show } = useToast();
  const startedRef = useRef(false);

  useTauriEvent<DeepScanProgressPayload>(BLADE_EVENTS.DEEP_SCAN_PROGRESS, (e) => {
    observePhase(e.payload.phase, e.payload.found);
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    beginScan();
    deepScanStart()
      .then(() => endScan())
      .catch((err) => {
        const msg = err instanceof TauriError ? err.rustMessage : String(err);
        endScan(msg);
        show({ type: 'error', title: 'Deep scan failed', message: msg });
      });
    // beginScan / endScan / observePhase are stable useCallback refs; re-running
    // the effect on identity change would re-trigger a scan — lock via ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pct = deepScanPercent(state.scanProgress);
  const C = 2 * Math.PI * 46;
  const dashOffset = C * (1 - Math.max(0, Math.min(100, pct)) / 100);

  return (
    <section className="onb glass glass-1" aria-labelledby="onb-scan-title">
      <Steps current="scan" />
      <h1 id="onb-scan-title" className="title">
        Learning your machine.
      </h1>
      <p className="subtitle">
        One scan: apps, git repos, IDEs, shell, SSH, Docker. Stays on your machine.
      </p>

      <div className="scan-panel">
        <div
          className="scan-ring"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`Deep scan progress, ${pct}%`}
        >
          <svg viewBox="0 0 100 100" width="120" height="120">
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="rgba(255,255,255,0.14)"
              strokeWidth="3"
            />
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="rgba(255,255,255,0.92)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dashoffset 360ms var(--ease-smooth)' }}
            />
          </svg>
          <div className="scan-ring-percent">{pct}%</div>
        </div>

        <div className="scan-phases">
          {DEEP_SCAN_PHASES.filter((p) => p !== 'starting' && p !== 'complete').map((p) => (
            <div
              key={p}
              className={`scan-phase ${state.scanProgress[p] !== undefined ? 'done' : ''}`}
            >
              <span className="marker" aria-hidden="true" />
              <span>{PHASE_LABEL[p]}</span>
              {state.scanProgress[p] !== undefined && (
                <span className="p-meta" aria-hidden="true">
                  ({state.scanProgress[p]})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {state.scanError && (
        <div className="onb-error" role="alert">
          {state.scanError}
        </div>
      )}

      <div className="onb-footer">
        <Button variant="ghost" onClick={() => setStep('apikey')}>
          ← Back
        </Button>
        <Button
          variant="primary"
          disabled={!state.scanComplete}
          onClick={() => setStep('persona')}
        >
          {state.scanComplete ? 'Continue →' : 'Scanning…'}
        </Button>
      </div>
    </section>
  );
}
