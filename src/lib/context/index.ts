// src/lib/context/index.ts — barrel for React context providers.
//
// Phase 1 ships ConfigContext only (D-41 main-window boot). Phase 2 adds
// ToastContext + BackendToastBridge (SHELL-04, D-59/D-60). Each is
// independently re-exported here; consumers
// `import { ConfigProvider } from '@/lib/context'`.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-41
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-59, §D-60

export { ConfigProvider, useConfig } from './ConfigContext';
export { ToastProvider, useToast } from './ToastContext';
export type { ToastType, ToastItem } from './ToastContext';
export { BackendToastBridge } from './BackendToastBridge';
