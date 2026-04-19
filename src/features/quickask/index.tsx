// src/features/quickask/index.tsx — barrel export for the QuickAsk window.
//
// Consumers:
//   - src/windows/quickask/main.tsx mounts <QuickAskWindow/>
//   - future tests / dev isolation routes can import QuickAskText / QuickAskVoice directly

export { QuickAskWindow } from './QuickAskWindow';
export { QuickAskText } from './QuickAskText';
export type { QuickAskTextProps } from './QuickAskText';
export { QuickAskVoice } from './QuickAskVoice';
