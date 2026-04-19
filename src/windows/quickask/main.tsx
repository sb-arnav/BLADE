// QuickAsk window bootstrap — Phase 4 Plan 04-02.
// Replaces the Phase 1 placeholder with the full QuickAskWindow (QUICK-01..07).
//
// Import order matters: global styles first (tokens, glass, layout, motion),
// feature CSS second so feature-scoped selectors can reference the token
// variables declared in :root.
import '@/styles/index.css';
import '@/features/quickask/quickask.css';
import { createRoot } from 'react-dom/client';
import { QuickAskWindow } from '@/features/quickask';

const el = document.getElementById('root');
if (!el) throw new Error('[quickask] no #root');
createRoot(el).render(<QuickAskWindow />);
