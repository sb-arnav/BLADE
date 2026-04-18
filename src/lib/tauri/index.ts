// src/lib/tauri/index.ts — barrel for Phase 1 wrappers + events convenience.
// Convenience: `import { getConfig, sendMessageStream, useTauriEvent } from '@/lib/tauri'`.
//
// Explicit named re-exports (no `export *`) — D-34 ESLint rules can assert
// against specific names, and the barrel is grep-able. Tree-shaking works
// either way with Vite 7 + ESM.
//
// The events re-export block (added by Plan 06) is a DX convenience; the
// canonical import path remains '@/lib/events'. The Plan 09 ESLint rule
// allow-lists src/lib/events/, not this re-export chain — consumers can
// legitimately import useTauriEvent via either path.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36, §D-13 (events)

export { invokeTyped, TauriError } from './_base';
export type { TauriErrorKind } from './_base';

export {
  getConfig,
  saveConfig,
  getOnboardingStatus,
  completeOnboarding,
} from './config';

export {
  sendMessageStream,
  cancelChat,
} from './chat';

// Events convenience re-export (D-38-evt, D-38-hook). Raw `listen`/`invoke`
// are intentionally NOT re-exported here — the wrapped surfaces (useTauriEvent,
// invokeTyped) are the only permitted escape hatches per D-13.
export { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
export type { BladeEventName } from '@/lib/events';
