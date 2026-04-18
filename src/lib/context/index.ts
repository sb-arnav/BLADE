// src/lib/context/index.ts — barrel for React context providers.
//
// Phase 1 ships ConfigContext only (D-41 main-window boot). Later phases add
// ToastContext (Phase 2 Shell) + ModalContext etc. Each is independently
// re-exported here; consumers `import { ConfigProvider } from '@/lib/context'`.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-41

export { ConfigProvider, useConfig } from './ConfigContext';
