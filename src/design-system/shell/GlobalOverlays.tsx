// src/design-system/shell/GlobalOverlays.tsx — SHELL-05 (D-61).
//
// Phase 2 originally shipped 3 dev-mode "stub pills" (catchup / ambient /
// nudge) anchored top-right that proved the event plumbing worked. The
// real UI replaced them: AmbientStrip lives in Dashboard, toasts handle
// nudges, and catchup status surfaces in the TitleBar pill. The stubs
// were never deleted and kept rendering on every route in dev builds —
// 3 stacked pills overlapping content (v1.1 retraction "popups overlap
// with other things"). Removed 2026-04-28; component kept as a hook for
// real future overlays (e.g. ghost meeting card landing in this slot).
export function GlobalOverlays() {
  return null;
}
