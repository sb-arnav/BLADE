// src/features/ghost/MeetingGhostView.tsx — Phase 11 Plan 11-05 (PROV-08).
//
// Main-window consumer surface for Meeting Ghost (transcription). The actual
// Ghost overlay lives in src/windows/ghost — a separate Tauri webview without
// access to MainShell's ConfigProvider / RouterProvider. This view gates the
// Ghost configuration preview on audio capability so the user sees a clear
// "Add a provider" CTA when no audio-capable model is wired.
//
// When audio IS configured, the view renders an info panel describing the
// Ghost meeting-overlay behavior + how to enable it.
//
// @see src/features/ghost/GhostOverlayWindow.tsx (the actual overlay)
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54

import { GlassPanel } from '@/design-system/primitives';
import { CapabilityGap, useCapability } from '@/features/providers';

export function MeetingGhostView() {
  const { hasCapability } = useCapability('audio');

  if (!hasCapability) {
    return (
      <div style={{ padding: 'var(--s-6)' }} data-testid="meeting-ghost-view-root">
        <CapabilityGap capability="audio" surfaceLabel="Meeting Ghost transcription" />
      </div>
    );
  }

  return (
    <GlassPanel tier={1} data-testid="meeting-ghost-view-root" style={{ padding: 'var(--s-6)' }}>
      <h2 className="t-h2" style={{ marginTop: 0 }}>Meeting Ghost</h2>
      <p className="t-body">
        Meeting Ghost renders an invisible-to-capture overlay on top of video calls
        with live transcription and suggested replies. Screen-capture protection is
        enforced on macOS / Windows; Linux falls back with a warning.
      </p>
      <p className="t-body" style={{ color: 'var(--t-3)' }}>
        Toggle with <kbd>Cmd+G</kbd>.
      </p>
    </GlassPanel>
  );
}
