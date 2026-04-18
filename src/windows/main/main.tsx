// Main window bootstrap — Phase 1 foundation
// P-01 gate (D-29): performance.mark('boot') BEFORE any React work.
performance.mark('boot');

import React from 'react';
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (!el) throw new Error('[main] no #root');
createRoot(el).render(
  <React.StrictMode>
    <div style={{ padding: 40, fontSize: 14, color: '#ccc' }}>
      BLADE Main — Phase 1 bootstrap (tokens + router land in subsequent plans)
    </div>
  </React.StrictMode>
);
