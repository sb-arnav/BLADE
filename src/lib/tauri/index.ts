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
  testProvider,
  getAllProviderKeys,
  storeProviderKey,
  switchProvider,
  setConfig,
} from './config';

export {
  sendMessageStream,
  cancelChat,
} from './chat';

export { deepScanStart, deepScanResults, deepScanSummary } from './deepscan';
export { minimizeWindow, closeWindow, toggleMaximize } from './window';

// Phase 3 additions — chat tool-approval, history, quickask bridge,
// task routing + persona reset + generic config field save, perception
// (DASH-01), homeostasis (DASH-02), iot (SET-07).
export {
  respondToolApproval,
  historyListConversations,
  historyLoadConversation,
  historyDeleteConversation,
  quickaskSubmit,
} from './chat';

export {
  getTaskRouting,
  setTaskRouting,
  saveConfigField,
  resetOnboarding,
  debugConfig,
} from './config';

export { perceptionGetLatest, perceptionUpdate } from './perception';
export {
  homeostasisGet,
  homeostasisGetDirective,
  homeostasisGetCircadian,
} from './homeostasis';
export {
  iotListEntities,
  iotGetState,
  iotCallService,
  iotSetState,
  iotSpotifyNowPlaying,
  iotSpotifyPlayPause,
  iotSpotifyNext,
} from './iot';

// Phase 5 additions — Agents + Knowledge cluster wrappers (Plan 05-02, D-118).
// Exposed as namespace re-exports so per-route files in 05-03..06 can import
// either via the barrel (`import { agents } from '@/lib/tauri'`) or directly
// from `@/lib/tauri/agents`. Both paths resolve to the same module.
export * as agents from './agents';
export * as knowledge from './knowledge';

// Phase 6 additions — Life OS + Identity cluster wrappers (Plan 06-02, D-139).
// Same namespace-re-export convention as Phase 5; consumers can use either
// `import { lifeOs } from '@/lib/tauri'` or `import { healthGetToday } from '@/lib/tauri/life_os'`.
export * as lifeOs from './life_os';
export * as identity from './identity';

// Events convenience re-export (D-38-evt, D-38-hook). Raw `listen`/`invoke`
// are intentionally NOT re-exported here — the wrapped surfaces (useTauriEvent,
// invokeTyped) are the only permitted escape hatches per D-13.
export { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
export type { BladeEventName } from '@/lib/events';
