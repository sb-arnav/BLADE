// Ghost overlay window bootstrap — Phase 1 foundation
// Rust creation site: src-tauri/src/ghost_mode.rs:472 — this file stops the panic.
// D-09: content protection is set at window creation (Rust side), NOT CSS — this file
//       deliberately does not set cursor/click-through styles.
import { createRoot } from 'react-dom/client';

const el = document.getElementById('root');
if (!el) throw new Error('[ghost] no #root');
createRoot(el).render(
  <div style={{ padding: 16, fontSize: 13, color: '#ccc' }}>
    BLADE Ghost — Phase 1 bootstrap
  </div>
);
