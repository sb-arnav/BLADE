// src/features/onboarding/useResetOnboarding.ts — Phase 3 Settings hook.
//
// Clears `config.onboarded` + `persona_onboarding_complete` to re-trigger the
// onboarding flow from Settings. The actual reset path requires a Rust
// `reset_onboarding` command that does not yet exist (STATE.md §Blockers).
//
// ⚠ Phase 2 D-50 context: `save_config` is not a Tauri command. This hook is
// a FORWARD DECLARATION that Phase 3 Settings will wire up. For Phase 2 the
// body throws so any accidental early caller sees the TODO immediately in dev
// instead of a silent no-op.
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §"Deferred Ideas"
// @see .planning/STATE.md §Blockers (save_config_cmd)

import { useCallback } from 'react';

export function useResetOnboarding() {
  return useCallback(() => {
    // Phase 3 Settings will add a `reset_onboarding` Rust command and swap
    // this body to call it. For Phase 2 we throw so accidental wiring
    // surfaces immediately in dev.
    throw new Error(
      '[useResetOnboarding] Not yet implemented. Phase 3 Settings will add the reset_onboarding Rust command and swap this implementation.',
    );
  }, []);
}
