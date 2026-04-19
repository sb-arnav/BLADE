// src/features/settings/panes/DiagnosticsEntryPane.tsx — SET-09 (D-89).
//
// Doorway pane — full Diagnostics view ships in Phase 7 (ADMIN-*).
//
// DEV path: shows openRoute('diagnostics-dev'), event-listener counter, and a
// debugConfig() refresh button. PROD path: shows a "Phase 7 admin" notice.
//
// debugConfig() output is potentially sensitive (paths, keyring fingerprints
// — Rust redacts API key VALUES per debug_config implementation but path
// strings remain). DEV-only display per T-03-06-08.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-89
// @see src-tauri/src/commands.rs:1969 debug_config

import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@/design-system/primitives';
import { debugConfig, TauriError } from '@/lib/tauri';
import { useToast } from '@/lib/context';
import { useRouterCtx } from '@/windows/main/useRouter';

declare global {
  interface Window {
    __BLADE_LISTENERS_COUNT__?: number;
  }
}

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

export function DiagnosticsEntryPane() {
  const { show } = useToast();
  const { openRoute } = useRouterCtx();
  const [debugDump, setDebugDump] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [listenerCount, setListenerCount] = useState<number | null>(null);

  const isDev = import.meta.env.DEV;

  const refreshDebug = useCallback(async () => {
    setLoading(true);
    try {
      const dump = await debugConfig();
      setDebugDump(dump);
    } catch (e) {
      show({ type: 'error', title: 'debug_config failed', message: errMessage(e) });
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    if (isDev) {
      void refreshDebug();
      // Listener counter (DEV harness instrument); guard against undefined.
      const c = typeof window !== 'undefined' ? window.__BLADE_LISTENERS_COUNT__ : undefined;
      setListenerCount(typeof c === 'number' ? c : null);
    }
  }, [isDev, refreshDebug]);

  return (
    <div className="settings-section">
      <h2>Diagnostics</h2>
      <p>Doorway pane. Full diagnostics dashboard ships in Phase 7 (Admin cluster).</p>

      {isDev ? (
        <>
          <Card>
            <h3>Developer surfaces</h3>
            <p>DEV-only routes for runtime inspection.</p>
            <div className="settings-actions left">
              <Button variant="primary" onClick={() => openRoute('diagnostics-dev')}>
                Open full Diagnostics
              </Button>
              <Button variant="secondary" onClick={() => openRoute('wrapper-smoke')}>
                Run wrapper smoke test
              </Button>
            </div>
          </Card>

          <Card>
            <h3>Event listeners</h3>
            <p>
              Active <code>useTauriEvent</code> registrations (instrumented by the
              DEV harness):
              {' '}
              <strong>{listenerCount ?? 'unavailable'}</strong>
            </p>
          </Card>

          <Card>
            <h3>Raw config dump</h3>
            <div className="settings-actions left" style={{ marginBottom: 8 }}>
              <Button variant="secondary" onClick={refreshDebug} disabled={loading}>
                {loading ? 'Refreshing…' : 'Refresh'}
              </Button>
            </div>
            {debugDump ? (
              <pre className="settings-code">{JSON.stringify(debugDump, null, 2)}</pre>
            ) : (
              <p>No dump fetched.</p>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <h3>Admin cluster</h3>
          <p>Diagnostics is part of the Admin cluster which ships in Phase 7. This pane is intentionally minimal in production builds.</p>
        </Card>
      )}
    </div>
  );
}
