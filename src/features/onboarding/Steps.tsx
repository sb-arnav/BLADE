// src/features/onboarding/Steps.tsx — Step-pill row shared by all 4 screens.
//
// Pure-visual component; consumer passes `current` (one of the 4 OnbStep ids)
// and the row derives idle / active / done states by position.
//
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §3
// @see docs/design/onboarding-01-provider.html (step-pill visual reference)

import React from 'react';
import type { OnbStep } from './useOnboardingState';

const STEP_LABEL: Record<OnbStep, string> = {
  provider: 'Provider',
  apikey: 'API key',
  scan: 'Deep scan',
  persona: 'Persona',
};

const ORDER: OnbStep[] = ['provider', 'apikey', 'scan', 'persona'];

interface Props {
  current: OnbStep;
}

export function Steps({ current }: Props) {
  const currentIdx = ORDER.indexOf(current);
  return (
    <div className="onb-steps" role="list" aria-label="Onboarding progress">
      {ORDER.map((s, i) => {
        const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'idle';
        return (
          <React.Fragment key={s}>
            <div
              className={`step-pill ${state}`}
              role="listitem"
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="num" aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </span>
              {STEP_LABEL[s]}
            </div>
            {i < ORDER.length - 1 && <span className="step-divider" aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
