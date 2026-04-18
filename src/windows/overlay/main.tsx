// Overlay window (Voice Orb) bootstrap — Phase 1 foundation
// Rust creation site: src-tauri/src/lib.rs:349-366 — this file stops the panic.
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (!el) throw new Error('[overlay] no #root');
createRoot(el).render(
  <div style={{ padding: 16, fontSize: 13, color: '#ccc' }}>
    BLADE Overlay — Phase 1 bootstrap
  </div>
);
