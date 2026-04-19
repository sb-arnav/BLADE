// src/features/settings/panes/RoutingPane.tsx — SET-03 (D-83).
//
// 5-row routing grid (code / vision / fast / creative / fallback). Each row
// picks a provider id from PROVIDERS. Null values mean "use active provider".
//
// Rust surface: getTaskRouting() reads current, setTaskRouting(routing) writes
// the whole struct back (Rust does not merge — see config.rs:719).
//
// Cross-check: if a selected provider has no key stored, surface an inline
// warning with a hint to visit the Providers tab.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-83
// @see src-tauri/src/config.rs:713 get_task_routing
// @see src-tauri/src/config.rs:719 set_task_routing

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, Pill } from '@/design-system/primitives';
import { getTaskRouting, setTaskRouting, getAllProviderKeys } from '@/lib/tauri';
import { useToast } from '@/lib/context';
import { PROVIDERS } from '@/features/onboarding/providers';
import type { TaskRouting } from '@/types/routing';
import type { ProviderKeyList } from '@/types/provider';

type RoutingKey = keyof TaskRouting;

const ROWS: { id: RoutingKey; label: string; hint: string }[] = [
  { id: 'code',     label: 'Code',     hint: 'Coding, refactoring, debugging' },
  { id: 'vision',   label: 'Vision',   hint: 'Screenshots, images, OCR' },
  { id: 'fast',     label: 'Fast',     hint: 'Quick answers, classification' },
  { id: 'creative', label: 'Creative', hint: 'Writing, brainstorming' },
  { id: 'fallback', label: 'Fallback', hint: 'When the primary fails' },
];

const EMPTY_ROUTING: TaskRouting = {
  code: null,
  vision: null,
  fast: null,
  creative: null,
  fallback: null,
};

export function RoutingPane() {
  const { show } = useToast();
  const [routing, setRouting] = useState<TaskRouting | null>(null);
  const [keys, setKeys] = useState<ProviderKeyList | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r, k] = await Promise.all([getTaskRouting(), getAllProviderKeys()]);
        if (!cancelled) {
          setRouting(r ?? EMPTY_ROUTING);
          setKeys(k);
        }
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const keyByProvider = useMemo(() => {
    const map = new Map<string, boolean>();
    keys?.providers.forEach((p) => map.set(p.provider, p.has_key));
    return map;
  }, [keys]);

  const handleChange = (row: RoutingKey, value: string) => {
    setRouting((prev) => ({
      ...(prev ?? EMPTY_ROUTING),
      [row]: value === '' ? null : value,
    }));
  };

  const handleSave = async () => {
    if (!routing) return;
    setSaving(true);
    try {
      await setTaskRouting(routing);
      show({ type: 'success', title: 'Routing saved' });
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: String(e) });
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return (
      <div className="settings-section">
        <h2>Routing</h2>
        <div className="settings-notice warn">Failed to load routing: {loadError}</div>
      </div>
    );
  }

  if (!routing) {
    return (
      <div className="settings-section">
        <h2>Routing</h2>
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h2>Routing</h2>
      <p>Pick which provider handles each task type. Leave empty to use the active provider.</p>

      <Card>
        <div className="settings-routing-grid">
          {ROWS.map((row) => {
            const selected = routing[row.id];
            const hasKey = selected ? keyByProvider.get(selected) : true;
            return (
              <div key={row.id} style={{ display: 'contents' }}>
                <div>
                  <div style={{ color: 'var(--t-1)', fontSize: 14 }}>{row.label}</div>
                  <div style={{ color: 'var(--t-3)', fontSize: 12 }}>{row.hint}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <select
                    value={selected ?? ''}
                    onChange={(e) => handleChange(row.id, e.target.value)}
                    disabled={saving}
                    aria-label={`${row.label} provider`}
                  >
                    <option value="">— Active provider —</option>
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {selected && hasKey === false ? (
                    <Pill tone="new">No key stored — configure in Providers</Pill>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="settings-actions">
          <Button variant="primary" onClick={handleSave} disabled={saving}>
            Save routing
          </Button>
        </div>
      </Card>
    </div>
  );
}
