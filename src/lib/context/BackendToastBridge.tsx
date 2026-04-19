// src/lib/context/BackendToastBridge.tsx — Bridges 3 Rust events to useToast().
//
// Mounted ONCE at MainShell (Plan 02-06). Splitting this out of ToastProvider
// keeps the provider reusable in test harnesses that don't need event bridging.
//
// Subscriptions (single listen() per event name, P-06 discipline):
//   - BLADE_NOTIFICATION → info/warn/error, default durations
//   - BLADE_TOAST        → caller-controlled type + duration_ms
//   - SHORTCUT_REGISTRATION_FAILED → severity-aware:
//       severity === 'warning' → warn toast "Shortcut fell back …"
//       severity === 'error' (default/legacy) → error toast with attempted list
//     (Phase 4 Plan 04-06 D-94 consumer — payload extended by Plan 04-01.)
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-60
// @see .planning/phases/04-overlay-windows/04-CONTEXT.md §D-94
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §6

import { useToast, type ToastType } from './ToastContext';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  BladeNotificationPayload,
  BladeToastPayload,
  ShortcutRegistrationFailedPayload,
} from '@/lib/events';

function normaliseType(t: string | undefined): ToastType {
  if (t === 'success') return 'success';
  if (t === 'error') return 'error';
  if (t === 'warn' || t === 'warning') return 'warn';
  return 'info';
}

export function BackendToastBridge() {
  const { show } = useToast();

  useTauriEvent<BladeNotificationPayload>(
    BLADE_EVENTS.BLADE_NOTIFICATION,
    (e) => {
      show({
        type: normaliseType(e.payload.type),
        title: e.payload.message,
      });
    },
  );

  useTauriEvent<BladeToastPayload>(BLADE_EVENTS.BLADE_TOAST, (e) => {
    show({
      type: normaliseType(e.payload.type),
      title: e.payload.message,
      durationMs: e.payload.duration_ms,
    });
  });

  useTauriEvent<ShortcutRegistrationFailedPayload>(
    BLADE_EVENTS.SHORTCUT_REGISTRATION_FAILED,
    (e) => {
      const {
        shortcut,
        error,
        name,
        attempted,
        fallback_used,
        severity,
      } = e.payload;
      // Phase 4 Plan 04-06 (D-94 consumer) — branch on severity. Phase 3
      // emits did not set severity; treat undefined as 'error' for back-compat.
      const isWarning = severity === 'warning';
      if (isWarning) {
        // Fallback succeeded — non-fatal, warn-level toast.
        show({
          type: 'warn',
          title: 'Shortcut fell back',
          message: `${shortcut} (${name ?? 'shortcut'}) was in use; registered to ${fallback_used ?? 'fallback'} instead.`,
        });
      } else {
        // Every candidate failed — error-level toast with the attempted list
        // so the user can see which combinations were tried.
        const tried =
          attempted && attempted.length > 0 ? attempted : [shortcut];
        show({
          type: 'error',
          title: 'Shortcut registration failed',
          message: `${name ?? 'shortcut'} could not register any of: ${tried.join(', ')}. ${error}`,
        });
      }
    },
  );

  return null;
}
