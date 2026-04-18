// QuickAsk window bootstrap — Phase 1 foundation
// No performance.mark (P-01 applies to Main only).
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (!el) throw new Error('[quickask] no #root');
createRoot(el).render(
  <div style={{ padding: 16, fontSize: 13, color: '#ccc' }}>
    BLADE QuickAsk — Phase 1 bootstrap
  </div>
);
