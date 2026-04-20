// src/features/quickask/index.tsx — barrel export for the QuickAsk window.
//
// Consumers:
//   - src/windows/quickask/main.tsx mounts <QuickAskWindow/>
//   - future tests / dev isolation routes can import QuickAskText / QuickAskVoice directly
//
// Phase 11 Plan 11-05 adds a main-window-routable QuickAskView that gates on
// vision capability (PROV-07) — reachable via openRoute('quickask').

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

export { QuickAskWindow } from './QuickAskWindow';
export { QuickAskText } from './QuickAskText';
export type { QuickAskTextProps } from './QuickAskText';
export { QuickAskVoice } from './QuickAskVoice';
export { QuickAskView } from './QuickAskView';

const QuickAskViewLazy = lazy(() => import('./QuickAskView').then((m) => ({ default: m.QuickAskView })));

export const routes: RouteDefinition[] = [
  { id: 'quickask', label: 'QuickAsk', section: 'core', component: QuickAskViewLazy, phase: 11, paletteHidden: true },
];
