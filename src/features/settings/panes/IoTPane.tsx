// src/features/settings/panes/IoTPane.tsx — SET-07 (D-87).
//
// Three sections: Connect HA (URL + env-var notice), Entities list with
// switchable toggles, Spotify now-playing.
//
// CRITICAL Rust write-surface constraint:
//   • ha_base_url — writable via save_config_field (config.rs:737 allow-list)
//   • ha_token    — NO Rust setter (neither save_config_field nor set_config
//                   accept it). HA token is read from the HA_TOKEN environment
//                   variable at Rust side — this pane shows an instructional
//                   notice directing the user to set HA_TOKEN before launch.
//
// Fail-soft: if iot_* wrappers throw "not_found" (command unregistered), show
// a single "IoT integration unavailable" notice instead of breaking the pane
// (T-03-06-07 mitigation).
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-87
// @see src-tauri/src/config.rs:737 save_config_field allows ha_base_url
// @see src-tauri/src/iot_bridge.rs (HA_TOKEN env-var pattern)

import { useEffect, useState } from 'react';
import { Button, Card, Input, Pill } from '@/design-system/primitives';
import {
  iotListEntities,
  iotSetState,
  iotSpotifyNowPlaying,
  saveConfigField,
  TauriError,
} from '@/lib/tauri';
import { useConfig, useToast } from '@/lib/context';
import type { IoTEntity, SpotifyTrack } from '@/types/iot';

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

function isNotFound(e: unknown): boolean {
  return e instanceof TauriError && e.kind === 'not_found';
}

export function IoTPane() {
  const { config, reload } = useConfig();
  const { show } = useToast();

  const [urlDraft, setUrlDraft] = useState<string>(asString(config.ha_base_url));
  const [savingUrl, setSavingUrl] = useState(false);

  const [entities, setEntities] = useState<IoTEntity[] | null>(null);
  const [entitiesErr, setEntitiesErr] = useState<string | null>(null);
  const [entitiesUnavailable, setEntitiesUnavailable] = useState(false);

  const [spotify, setSpotify] = useState<SpotifyTrack | null>(null);
  const [spotifyErr, setSpotifyErr] = useState<string | null>(null);
  const [spotifyUnavailable, setSpotifyUnavailable] = useState(false);

  const hasBaseUrl = Boolean(asString(config.ha_base_url).trim());

  useEffect(() => {
    let cancelled = false;
    if (hasBaseUrl) {
      iotListEntities()
        .then((list) => { if (!cancelled) { setEntities(list); setEntitiesErr(null); } })
        .catch((e) => {
          if (cancelled) return;
          if (isNotFound(e)) setEntitiesUnavailable(true);
          else setEntitiesErr(errMessage(e));
        });
    }
    iotSpotifyNowPlaying()
      .then((t) => { if (!cancelled) { setSpotify(t); setSpotifyErr(null); } })
      .catch((e) => {
        if (cancelled) return;
        if (isNotFound(e)) setSpotifyUnavailable(true);
        else setSpotifyErr(errMessage(e));
      });
    return () => { cancelled = true; };
  }, [hasBaseUrl]);

  const handleSaveUrl = async () => {
    setSavingUrl(true);
    try {
      // ha_base_url IS in the save_config_field allow-list (config.rs:737).
      // ha_token is NOT — do not add a token field that would throw.
      await saveConfigField('ha_base_url', urlDraft.trim());
      await reload();
      show({ type: 'success', title: 'HA base URL saved' });
    } catch (e) {
      show({ type: 'error', title: 'Save failed', message: errMessage(e) });
    } finally {
      setSavingUrl(false);
    }
  };

  const handleToggle = async (ent: IoTEntity) => {
    const next = ent.state === 'on' ? 'off' : 'on';
    try {
      await iotSetState(ent.entity_id, next);
      // Optimistic local update; HA push events would normally refresh.
      setEntities((cur) =>
        cur?.map((e) => (e.entity_id === ent.entity_id ? { ...e, state: next } : e)) ?? cur,
      );
      show({ type: 'success', title: `${ent.friendly_name} → ${next}` });
    } catch (e) {
      show({ type: 'error', title: 'Toggle failed', message: errMessage(e) });
    }
  };

  return (
    <div className="settings-section">
      <h2>IoT & Integrations</h2>
      <p>Home Assistant + Spotify. BLADE calls your local HA over HTTP with a bearer token.</p>

      <Card>
        <h3>Connect Home Assistant</h3>

        <div className="settings-field">
          <label htmlFor="ha-base-url" className="settings-field-label">Base URL</label>
          <Input
            id="ha-base-url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="http://homeassistant.local:8123"
            disabled={savingUrl}
          />
        </div>

        <div className="settings-actions left">
          <Button variant="primary" onClick={handleSaveUrl} disabled={savingUrl}>
            {savingUrl ? 'Saving…' : 'Save URL'}
          </Button>
        </div>

        <div className="settings-notice" style={{ marginTop: 12 }}>
          <strong>HA token:</strong> Phase 3 does not expose a token setter — the HA token
          is read from the <code>HA_TOKEN</code> environment variable at launch. Set it
          before starting BLADE (e.g. <code>HA_TOKEN=...</code> in your shell profile).
          A token-setter command ships in a future phase.
        </div>
      </Card>

      {hasBaseUrl ? (
        <Card>
          <h3>Entities</h3>
          {entitiesUnavailable ? (
            <div className="settings-notice">Home Assistant integration not available on this build.</div>
          ) : entitiesErr ? (
            <div className="settings-notice warn">Failed to load entities: {entitiesErr}</div>
          ) : entities == null ? (
            <p>Loading entities…</p>
          ) : entities.length === 0 ? (
            <p>No entities returned. Check that your HA instance is reachable at the URL above and <code>HA_TOKEN</code> is set.</p>
          ) : (
            <ul className="settings-iot-list">
              {entities.map((ent) => {
                const canToggle = ent.domain === 'switch' || ent.domain === 'light';
                return (
                  <li key={ent.entity_id} className="settings-iot-item">
                    <div>
                      <div style={{ color: 'var(--t-1)' }}>{ent.friendly_name || ent.entity_id}</div>
                      <div style={{ color: 'var(--t-3)', fontSize: 12 }}>{ent.entity_id}</div>
                    </div>
                    <Pill tone={ent.state === 'on' ? 'free' : 'default'}>{ent.state}</Pill>
                    {canToggle ? (
                      <Button
                        variant="secondary"
                        onClick={() => handleToggle(ent)}
                      >
                        {ent.state === 'on' ? 'Turn off' : 'Turn on'}
                      </Button>
                    ) : <span />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}

      <Card>
        <h3>Spotify</h3>
        {spotifyUnavailable ? (
          <div className="settings-notice">Spotify integration not available on this build.</div>
        ) : spotifyErr ? (
          <div className="settings-notice warn">Failed to reach Spotify: {spotifyErr}</div>
        ) : spotify == null ? (
          <p>Not playing.</p>
        ) : !spotify.is_playing ? (
          <p>Not playing ({spotify.title ? `last: ${spotify.title}` : 'idle'}).</p>
        ) : (
          <div>
            <div style={{ color: 'var(--t-1)', fontSize: 15 }}>{spotify.title}</div>
            <div style={{ color: 'var(--t-2)', fontSize: 13 }}>{spotify.artist}</div>
            <div style={{ color: 'var(--t-3)', fontSize: 12 }}>{spotify.album}</div>
          </div>
        )}
      </Card>
    </div>
  );
}
