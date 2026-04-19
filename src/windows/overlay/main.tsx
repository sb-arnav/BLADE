// Overlay (Voice Orb) window bootstrap — Phase 4 Plan 04-03.
//
// Replaces the Phase 1 placeholder div with the full VoiceOrbWindow. Window
// label stays 'overlay' (D-106) so every existing Rust emit_to('overlay', ...)
// site (voice_conversation_listening/thinking/speaking/ended + wake_word) keeps
// working without a rename.
//
// Rust creation site: src-tauri/src/lib.rs:349-366 — fullscreen transparent,
// always-on-top, borderless. See Phase 1 D-43 HTML entry for `overlay.html`.
//
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-105, §D-106, §D-107

import '@/styles/index.css'; // Design tokens + Tailwind + glass + typography
import '@/features/voice-orb/orb.css'; // Voice Orb visuals (ported from docs/design/orb.css)
import { createRoot } from 'react-dom/client';
import { VoiceOrbWindow } from '@/features/voice-orb';

const el = document.getElementById('root');
if (!el) throw new Error('[overlay] no #root');
createRoot(el).render(<VoiceOrbWindow />);
