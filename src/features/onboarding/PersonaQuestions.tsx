// src/features/onboarding/PersonaQuestions.tsx — Step 4 (ONBD-05, ONBD-06).
//
// 5 text inputs → completeOnboarding(answers) → setConfig({onboarded=true}) →
// useConfig().reload() → onComplete() prop triggers gate re-eval.
//
// Success chain is exactly 4 awaited calls (≤10 lines of happy-path code per
// plan's success criterion).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-47 Step 4, §D-50

import { useState } from 'react';
import { Button, Input } from '@/design-system/primitives';
import { Steps } from './Steps';
import { completeOnboarding, setConfig, TauriError } from '@/lib/tauri';
import { useConfig, useToast } from '@/lib/context';
import { PROVIDERS } from './providers';
import type { useOnboardingState } from './useOnboardingState';

type State = ReturnType<typeof useOnboardingState>;

interface Props {
  state: State['state'];
  setStep: State['setStep'];
  setAnswer: State['setAnswer'];
  onComplete: () => void;
}

const LABELS: [string, string, string, string, string] = [
  'Your name and role',
  'What are you building right now?',
  'Your stack (languages, tools, services)',
  'Your biggest goal this quarter',
  'Communication style (terse / exploratory / step-by-step)',
];

export function PersonaQuestions({ state, setStep, setAnswer, onComplete }: Props) {
  const { show } = useToast();
  const { reload } = useConfig();
  const [submitting, setSubmitting] = useState(false);
  const allFilled = state.personaAnswers.every((a) => a.trim().length > 0);
  const provider = PROVIDERS.find((p) => p.id === state.providerId) ?? PROVIDERS[0];

  async function handleComplete() {
    if (!allFilled) return;
    setSubmitting(true);
    try {
      await completeOnboarding(state.personaAnswers);
      // D-50: flip config.onboarded=true via set_config with empty api_key
      // (Rust guards against clobber; keyring untouched).
      await setConfig({
        provider: provider.id,
        apiKey: '',
        model: provider.defaultModel,
      });
      await reload();
      show({ type: 'success', title: 'Welcome to BLADE' });
      onComplete();
    } catch (e) {
      const msg = e instanceof TauriError ? e.rustMessage : String(e);
      show({ type: 'error', title: 'Could not finish onboarding', message: msg });
      setSubmitting(false);
    }
  }

  return (
    <section className="onb glass glass-1" aria-labelledby="onb-persona-title">
      <Steps current="persona" />
      <h1 id="onb-persona-title" className="title">
        A few quick questions.
      </h1>
      <p className="subtitle">
        These seed BLADE's memory so it can act like it's met you before.
      </p>

      <div className="persona-grid">
        {LABELS.map((label, i) => (
          <div key={i} className="persona-row">
            <label htmlFor={`persona-${i}`}>{label}</label>
            <Input
              id={`persona-${i}`}
              value={state.personaAnswers[i]}
              onChange={(e) => setAnswer(i as 0 | 1 | 2 | 3 | 4, e.target.value)}
              placeholder={i === 0 ? 'Arnav, founder' : ''}
              autoComplete="off"
            />
          </div>
        ))}
      </div>

      <div className="onb-footer">
        <Button variant="ghost" onClick={() => setStep('apikey')} disabled={submitting}>
          ← Back
        </Button>
        <Button
          variant="primary"
          onClick={handleComplete}
          disabled={!allFilled || submitting}
        >
          {submitting ? 'Finishing…' : 'Enter BLADE →'}
        </Button>
      </div>
    </section>
  );
}
