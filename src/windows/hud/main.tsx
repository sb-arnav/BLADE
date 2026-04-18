// HUD bar window bootstrap — Phase 1 foundation
// Rust creation site: src-tauri/src/overlay_manager.rs:76 — this file stops the panic.
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (!el) throw new Error('[hud] no #root');
createRoot(el).render(
  <div style={{ padding: 8, fontSize: 12, color: '#ccc' }}>
    BLADE HUD — Phase 1 bootstrap
  </div>
);
