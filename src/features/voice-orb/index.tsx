// src/features/voice-orb/index.tsx — barrel export
//
// VoiceOrb is imported by:
//   - src/windows/overlay/main.tsx                   (Plan 04-03 — this wave)
//   - src/features/quickask/QuickAskWindow.tsx       (Plan 04-02 — voice sub-view)

export { VoiceOrb } from './VoiceOrb';
export type { VoiceOrbProps } from './VoiceOrb';
export { VoiceOrbWindow } from './VoiceOrbWindow';
export { useOrbPhase } from './useOrbPhase';
export type { OrbPhase } from './useOrbPhase';
export { useMicRms } from './useMicRms';
export type { MicRmsHandle } from './useMicRms';
