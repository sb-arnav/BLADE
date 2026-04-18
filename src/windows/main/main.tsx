// Main window bootstrap — Phase 1 foundation
import '@/styles/index.css';  // Design tokens + Tailwind + glass + typography (FOUND-01)
// P-01 gate (D-29): performance.mark('boot') BEFORE any React work.
// CSS side-effect imports are hoisted by the bundler but kept literally above
// the mark for human readability — CSS parse is pre-React, what we measure is
// React bootstrap cost.
performance.mark('boot');

import React from 'react';
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (!el) throw new Error('[main] no #root');
createRoot(el).render(
  <React.StrictMode>
    <div className="t-body" style={{ padding: 40 }}>
      BLADE Main — Phase 1 bootstrap (tokens loaded; router lands in Plan 07)
    </div>
  </React.StrictMode>
);
