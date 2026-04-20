// src/features/voice-orb/VoiceOrbView.tsx — Phase 11 Plan 11-05 (PROV-08).
//
// Main-window consumer surface for the Voice Orb. The actual orb is an
// overlay window (src/windows/overlay) without main-window context. This
// View renders inside MainShell so useCapability('audio') can deep-link
// to Settings → Providers when no audio-capable provider is wired.
//
// When audio IS configured, the view renders the stateless <VoiceOrb> in
// compact preview mode plus an info panel.
//
// @see src/features/voice-orb/VoiceOrbWindow.tsx (the actual overlay)
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54

import { GlassPanel } from '@/design-system/primitives';
import { CapabilityGap, useCapability } from '@/features/providers';
import { VoiceOrb } from './VoiceOrb';

export function VoiceOrbView() {
  const { hasCapability } = useCapability('audio');

  if (!hasCapability) {
    return (
      <div style={{ padding: 'var(--s-6)' }} data-testid="voice-orb-view-root">
        <CapabilityGap capability="audio" surfaceLabel="Voice Orb TTS" />
      </div>
    );
  }

  return (
    <GlassPanel tier={1} data-testid="voice-orb-view-root" style={{ padding: 'var(--s-6)' }}>
      <h2 className="t-h2" style={{ marginTop: 0 }}>Voice Orb</h2>
      <p className="t-body">
        The Voice Orb runs in a dedicated overlay window. Preview below; the live
        orb snaps to a screen corner and responds to "Hey BLADE" wake words.
      </p>
      <div style={{ display: 'grid', placeItems: 'center', margin: 'var(--s-6) 0' }}>
        <VoiceOrb compact phase="idle" />
      </div>
    </GlassPanel>
  );
}
