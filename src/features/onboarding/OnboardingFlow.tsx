// src/features/onboarding/OnboardingFlow.tsx — 4-step wizard container (D-47).
//
// Mounts useOnboardingState once, passes state + atomic setters to whichever
// step component matches `state.step`. No event subscriptions here — each
// step owns its own useTauriEvent call (DeepScanStep owns the only one).
//
// The `onComplete` prop is the gate re-evaluation trigger; MainShell (Plan 06)
// passes a callback that flips its gate status back to 'checking' → re-runs
// getOnboardingStatus + useConfig().config.onboarded.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-47, §D-48
// @see src/features/onboarding/useOnboardingState.ts

import { useOnboardingState } from './useOnboardingState';
import { ProviderPicker } from './ProviderPicker';
import { ApiKeyEntry } from './ApiKeyEntry';
import { PersonaQuestions } from './PersonaQuestions';
import './onboarding.css';

interface Props {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: Props) {
  const hook = useOnboardingState();
  const { state } = hook;

  return (
    <main className="onb-surface" role="main">
      {state.step === 'provider' && (
        <ProviderPicker
          state={state}
          setProvider={hook.setProvider}
          setStep={hook.setStep}
        />
      )}
      {state.step === 'apikey' && (
        <ApiKeyEntry
          state={state}
          setApiKey={hook.setApiKey}
          setStep={hook.setStep}
          beginTest={hook.beginTest}
          endTestOk={hook.endTestOk}
          endTestErr={hook.endTestErr}
        />
      )}
      {state.step === 'persona' && (
        <PersonaQuestions
          state={state}
          setStep={hook.setStep}
          setAnswer={hook.setAnswer}
          onComplete={onComplete}
        />
      )}
    </main>
  );
}

export default OnboardingFlow;
