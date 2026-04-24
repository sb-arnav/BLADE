// src/features/settings/LockScreenAction.tsx — Phase 14 Plan 14-02 (WIRE2-04)
//
// Palette-only action component: locks the screen immediately on mount then
// navigates back to the previous route. Never rendered as a full page view —
// the command palette triggers it via the 'system-lock-screen' route entry.
//
// @see src-tauri/src/system_control.rs `pub async fn lock_screen()`
// @see src/features/settings/index.tsx (palette route registration)

import { useEffect } from 'react';
import { lockScreen } from '@/lib/tauri';
import { useRouterCtx } from '@/windows/main/useRouter';

export function LockScreenAction() {
  const { openRoute } = useRouterCtx();

  useEffect(() => {
    lockScreen()
      .catch(() => {
        // Lock failed — navigate back to settings silently.
        // Users will see the screen did not lock.
      })
      .finally(() => {
        openRoute('settings');
      });
  // Run once on mount only — dependency array intentionally empty.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render nothing — this is a transient action component.
  return null;
}
