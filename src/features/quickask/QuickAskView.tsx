// src/features/quickask/QuickAskView.tsx — Phase 11 Plan 11-05 (PROV-07).
//
// Main-window consumer surface for QuickAsk's image-input affordance. The
// actual QuickAsk flow runs in its own Tauri overlay window
// (src/windows/quickask) which has no ConfigProvider / RouterProvider.
// This View is the main-window-side gate that shows the capability gap
// when the user tries to configure or preview QuickAsk image input but no
// vision-capable provider is wired.
//
// When a vision-capable provider IS configured, the view renders a short
// info panel pointing the user at Cmd+Space (QuickAsk overlay trigger).
//
// @see src/features/quickask/QuickAskWindow.tsx (the actual overlay)
// @see .planning/phases/11-smart-provider-setup/11-CONTEXT.md §D-54

import { GlassPanel } from '@/design-system/primitives';
import { CapabilityGap, useCapability } from '@/features/providers';

export function QuickAskView() {
  const { hasCapability } = useCapability('vision');

  if (!hasCapability) {
    return (
      <div style={{ padding: 'var(--s-6)' }} data-testid="quickask-view-root">
        <CapabilityGap capability="vision" surfaceLabel="QuickAsk image input" />
      </div>
    );
  }

  return (
    <GlassPanel tier={1} data-testid="quickask-view-root" style={{ padding: 'var(--s-6)' }}>
      <h2 className="t-h2" style={{ marginTop: 0 }}>QuickAsk</h2>
      <p className="t-body">
        QuickAsk is an overlay window. Press <kbd>Cmd+Space</kbd> (or the configured
        shortcut) to summon it with text or image input. Vision-capable models are
        wired and ready.
      </p>
    </GlassPanel>
  );
}
