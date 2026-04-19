// src/windows/hud/main.tsx — HUD window bootstrap (Phase 4 Plan 04-05).
//
// Replaces the Phase 1 placeholder (`<div>BLADE HUD — Phase 1 bootstrap</div>`)
// with the full HudWindow: 5 chips, click + right-click handlers, notch-aware
// positioning (D-115), cross-window event subscriptions (D-13).
//
// Rust creation site: src-tauri/src/overlay_manager.rs:66 — window label is
// `blade_hud`. Plan 04-01 parallel-emits `hud_data_updated` to both
// `blade_hud` and `hud` labels so whichever the window runs under receives
// the tick (D-97). This bootstrap doesn't care about the label — the
// useTauriEvent subscription is local to this webview.
//
// @see .planning/phases/04-overlay-windows/04-05-PLAN.md Task 2c
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-97, §D-113

import '@/styles/index.css'; // Design tokens + Tailwind + glass + typography
import '@/features/hud/hud.css'; // HUD-specific bar + chip + menu styles
import { createRoot } from 'react-dom/client';
import { HudWindow } from '@/features/hud';

const el = document.getElementById('root');
if (!el) throw new Error('[hud] no #root');
createRoot(el).render(<HudWindow />);
