// src/windows/main/useOnboardingGate.ts — 2-signal onboarding gate (D-46, D-48).
//
// `status` transitions:
//   'checking' → 'needs_provider_key' (config.onboarded=false; show onboarding)
//   'checking' → 'needs_persona'      (config.onboarded=true but get_onboarding_status()=false)
//   'checking' → 'complete'           (both true; show main shell)
//
// `reEvaluate()` is passed to OnboardingFlow's onComplete so the shell swaps
// to the route tree without a full reload.
//
// T-02-06-02 mitigation: reEvaluate() awaits both reload() on ConfigContext
// AND getOnboardingStatus() before writing personaDone, so there is no window
// in which config.onboarded and personaDone can disagree mid-transition.
//
// T-02-06-04 mitigation: a getOnboardingStatus() rejection fails open within
// the onboarding boundary — personaDone=false so the user lands on the persona
// step rather than an infinite spinner.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-46, §D-48
// @see .planning/RECOVERY_LOG.md §3.1

import { useCallback, useEffect, useState } from 'react';
import { useConfig } from '@/lib/context';
import { getOnboardingStatus, TauriError } from '@/lib/tauri';

export type GateStatus = 'checking' | 'needs_provider_key' | 'needs_persona' | 'complete';

export interface GateResult {
  status: GateStatus;
  reEvaluate: () => Promise<void>;
  error: string | null;
}

export function useOnboardingGate(): GateResult {
  const { config, reload } = useConfig();
  const [personaDone, setPersonaDone] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    try {
      const done = await getOnboardingStatus();
      setPersonaDone(done);
      setError(null);
    } catch (e) {
      const msg = e instanceof TauriError ? e.rustMessage : String(e);
      setError(msg);
      // Fail-open within onboarding boundary: route user to persona step so
      // they can retry rather than watching an infinite spinner (T-02-06-04).
      setPersonaDone(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const reEvaluate = useCallback(async () => {
    setPersonaDone(null);
    await reload();
    await check();
  }, [reload, check]);

  let status: GateStatus;
  if (personaDone === null) status = 'checking';
  else if (!config.onboarded) status = 'needs_provider_key';
  else if (!personaDone) status = 'needs_persona';
  else status = 'complete';

  return { status, reEvaluate, error };
}
