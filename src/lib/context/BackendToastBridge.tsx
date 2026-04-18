// src/lib/context/BackendToastBridge.tsx — Bridges 3 Rust events to useToast().
//
// Mounted ONCE at MainShell (Plan 02-06). Splitting this out of ToastProvider
// keeps the provider reusable in test harnesses that don't need event bridging.
//
// Subscriptions (single listen() per event name, P-06 discipline):
//   - BLADE_NOTIFICATION → info/warn/error, default durations
//   - BLADE_TOAST        → caller-controlled type + duration_ms
//   - SHORTCUT_REGISTRATION_FAILED → warn with shortcut + error detail
//
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-60
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
      show({
        type: 'warn',
        title: `Shortcut failed: ${e.payload.shortcut}`,
        message: e.payload.error,
      });
    },
  );

  return null;
}
