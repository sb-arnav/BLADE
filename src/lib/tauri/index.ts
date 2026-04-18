// src/lib/tauri/index.ts — barrel for Phase 1 wrappers.
// Convenience: `import { getConfig, sendMessageStream } from '@/lib/tauri'`.
//
// Explicit named re-exports (no `export *`) — D-34 ESLint rules can assert
// against specific names, and the barrel is grep-able. Tree-shaking works
// either way with Vite 7 + ESM.
//
// Plan 06 will extend this barrel to re-export event helpers from ./events.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-36

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
