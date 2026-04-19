// Ghost overlay window bootstrap — Phase 4 Plan 04-04.
//
// Replaces the Phase 1 placeholder with the full GhostOverlayWindow. Window
// label is `ghost_overlay` (Rust creation site: src-tauri/src/ghost_mode.rs:471).
//
// D-09 discipline: content protection is set at window creation (Rust side,
// `.content_protected(true)` at ghost_mode.rs:481), NOT CSS. This bootstrap
// and `src/features/ghost/ghost.css` deliberately set zero cursor /
// click-through styles — a sanity grep in `verify:all` enforces this.
//
// D-34 invariant: no raw `@tauri-apps/api/core` or `/event` imports below.
// All tauri surface area flows through `src/lib/events` + `src/lib/tauri/*`.
//
// @see .planning/phases/04-overlay-windows/04-04-PLAN.md
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-09, §D-34

import '@/styles/index.css';
import '@/features/ghost/ghost.css';
import { createRoot } from 'react-dom/client';
import { GhostOverlayWindow } from '@/features/ghost';

const el = document.getElementById('root');
if (!el) throw new Error('[ghost] no #root');
createRoot(el).render(<GhostOverlayWindow />);
