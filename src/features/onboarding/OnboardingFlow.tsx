// src/features/onboarding/OnboardingFlow.tsx — Phase 46 v2.0 agentic hunt entry.
//
// PRIOR SHAPE (v1.6 and earlier): 4-step wizard mounting useOnboardingState +
//   ProviderPicker / ApiKeyEntry / PersonaQuestions. Steps.tsx rendered the
//   pill row above each step. All five files were retired by Phase 46.
//
// CURRENT SHAPE (v2.0): the hunt is the onboarding. The pre-scan runs in
//   parallel to chat-window paint; Message #1 fires within ≤2s; the LLM hunt
//   narrates probes in real time; synthesis writes ~/.blade/who-you-are.md
//   and emits the closing "one thing you've been putting off" line. The
//   user's first task IS the closing demo of onboarding — there is no
//   separate "setup complete" screen.
//
// MainShell.useOnboardingGate consumes `OnboardingFlow { onComplete }` —
// preserving that export shape means no MainShell changes for the rip.
//
// @see .planning/phases/46-agentic-hunt-onboarding/46-CONTEXT.md
// @see .planning/v2.0-onboarding-spec.md (Acts 1-7)

import { Hunt } from './Hunt';
import './onboarding.css'; // surface wrapper + design tokens shared with the hunt

interface Props {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: Props) {
  return (
    <div className="onb-surface" role="main">
      <Hunt onComplete={onComplete} />
    </div>
  );
}

export default OnboardingFlow;
