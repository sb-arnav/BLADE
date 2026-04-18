// src/features/onboarding/useOnboardingState.ts
//
// 4-step onboarding state machine (D-47). Owned by the OnboardingFlow
// container component in Plan 02-04; this module ships the state surface +
// setters only, so tests can mock the hook and Plan 02-04 UI components
// compose around a stable contract.
//
// State shape is intentionally flat — no nested sub-objects — so `useState`
// reducers in the setters stay local. `scanProgress` accumulates phase →
// `found` count as `deep_scan_progress` events arrive (see observePhase).
//
// Step transitions are explicit via `setStep(...)`; there is no implicit
// "next step" helper because each step's advance condition differs (provider
// selected vs key tested vs scan complete vs 5 answers filled).
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-47
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §2
// @see src/features/onboarding/providers.ts (DEFAULT_PROVIDER)

import { useCallback, useState } from 'react';
import type { ProviderId } from '@/types/provider';
import { DEFAULT_PROVIDER } from './providers';

export type OnbStep = 'provider' | 'apikey' | 'scan' | 'persona';

/**
 * Full onboarding state. All fields are mutated via the setters returned from
 * `useOnboardingState()` — never reach in and `setState(...)` from outside.
 */
export interface OnbState {
  step: OnbStep;
  providerId: ProviderId;
  modelId: string;
  /** Cleared by `setProvider` (on provider switch) and should be cleared by
   *  the UI after a successful `storeProviderKey` call to minimise in-memory
   *  key exposure (T-02-01-04 mitigation). */
  apiKey: string;
  testing: boolean;
  /** Rust `test_provider` success text — e.g. "Connection OK". null = not run yet. */
  testResult: string | null;
  /** Rust `test_provider` error text on failure. null = no error. */
  testError: string | null;
  scanRunning: boolean;
  /** phase name → `found` count from DeepScanProgressPayload. Empty before scan starts. */
  scanProgress: Record<string, number>;
  scanComplete: boolean;
  scanError: string | null;
  /** Fixed-length 5-tuple — `complete_onboarding` requires exactly 5 answers. */
  personaAnswers: [string, string, string, string, string];
}

const INITIAL: OnbState = {
  step: 'provider',
  providerId: DEFAULT_PROVIDER.id,
  modelId: DEFAULT_PROVIDER.defaultModel,
  apiKey: '',
  testing: false,
  testResult: null,
  testError: null,
  scanRunning: false,
  scanProgress: {},
  scanComplete: false,
  scanError: null,
  personaAnswers: ['', '', '', '', ''],
};

/**
 * Returns the onboarding state + atomic setters. Callers mount this once in
 * OnboardingFlow (Plan 02-04); all step components consume via props.
 */
export function useOnboardingState() {
  const [state, setState] = useState<OnbState>(INITIAL);

  const setStep = useCallback((step: OnbStep) => {
    setState((s) => ({ ...s, step }));
  }, []);

  const setProvider = useCallback((providerId: ProviderId, modelId: string) => {
    setState((s) => ({
      ...s,
      providerId,
      modelId,
      apiKey: '',
      testResult: null,
      testError: null,
    }));
  }, []);

  const setApiKey = useCallback((apiKey: string) => {
    setState((s) => ({ ...s, apiKey, testResult: null, testError: null }));
  }, []);

  const beginTest = useCallback(() => {
    setState((s) => ({ ...s, testing: true, testResult: null, testError: null }));
  }, []);

  const endTestOk = useCallback((result: string) => {
    setState((s) => ({ ...s, testing: false, testResult: result, testError: null }));
  }, []);

  const endTestErr = useCallback((err: string) => {
    setState((s) => ({ ...s, testing: false, testError: err, testResult: null }));
  }, []);

  const beginScan = useCallback(() => {
    setState((s) => ({
      ...s,
      scanRunning: true,
      scanComplete: false,
      scanProgress: {},
      scanError: null,
    }));
  }, []);

  const observePhase = useCallback((phase: string, found: number) => {
    setState((s) => ({
      ...s,
      scanProgress: { ...s.scanProgress, [phase]: found },
    }));
  }, []);

  const endScan = useCallback((err?: string) => {
    setState((s) => ({
      ...s,
      scanRunning: false,
      scanComplete: !err,
      scanError: err ?? null,
    }));
  }, []);

  const setAnswer = useCallback(
    (index: 0 | 1 | 2 | 3 | 4, value: string) => {
      setState((s) => {
        const next = [...s.personaAnswers] as OnbState['personaAnswers'];
        next[index] = value;
        return { ...s, personaAnswers: next };
      });
    },
    [],
  );

  const reset = useCallback(() => setState(INITIAL), []);

  return {
    state,
    setStep,
    setProvider,
    setApiKey,
    beginTest,
    endTestOk,
    endTestErr,
    beginScan,
    observePhase,
    endScan,
    setAnswer,
    reset,
  };
}
