// src/lib/context/ConfigContext.tsx — main-window BladeConfig provider
// (FOUND-10, D-41).
//
// Mounts in src/windows/main/main.tsx only. QuickAsk/overlay/HUD/ghost windows
// receive per-window config snapshots via emit_to on window create — they do
// NOT mount ConfigContext (React Context does not cross Tauri webviews anyway).
//
// Contract:
//   - Reads BladeConfig once via getConfig() wrapper (D-13: never raw invoke).
//   - Shows GlassSpinner fullscreen while config loads.
//   - Exposes `{ config, reload }` via useConfig() hook; throws outside provider.
//
// T-07-01 / T-07-02: config comes from Rust (trusted source); wrapper pipes
// TauriError on failure which we log + keep spinner on screen (fail-closed boot).
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-13, §D-41
// @see src/lib/tauri/config.ts — getConfig wrapper

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { getConfig } from '@/lib/tauri';
import { GlassSpinner } from '@/design-system/primitives';
import type { BladeConfig } from '@/types/config';

interface ConfigContextValue {
  config: BladeConfig;
  reload: () => Promise<void>;
}

const Ctx = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<BladeConfig | null>(null);

  const reload = useCallback(async () => {
    try {
      const c = await getConfig();
      setConfig(c);
    } catch (e) {
      // Fail-closed: keep spinner on screen. Consumers cannot mount without config.
      console.error('[ConfigProvider] getConfig failed', e);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!config) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>
        <GlassSpinner size={32} label="Loading BLADE config" />
      </div>
    );
  }

  return <Ctx.Provider value={{ config, reload }}>{children}</Ctx.Provider>;
}

export function useConfig(): ConfigContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useConfig must be used inside <ConfigProvider>');
  return v;
}
