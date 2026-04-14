// src/components/SmartHomePanel.tsx
// BLADE Smart Home — IoT device control + Spotify now playing

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HaEntity {
  entity_id: string;
  friendly_name: string;
  domain: string;
  state: string;
}

interface HaEntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

interface SpotifyTrack {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
}

type Domain = "light" | "switch" | "sensor" | "climate" | "other";

const DOMAIN_LABELS: Record<Domain, string> = {
  light: "Lights",
  switch: "Switches",
  sensor: "Sensors",
  climate: "Climate",
  other: "Other",
};

const DOMAIN_ORDER: Domain[] = ["light", "switch", "climate", "sensor", "other"];

function classifyDomain(domain: string): Domain {
  if (domain === "light") return "light";
  if (domain === "switch") return "switch";
  if (domain === "sensor" || domain === "binary_sensor") return "sensor";
  if (domain === "climate") return "climate";
  return "other";
}

function isControllable(domain: string): boolean {
  return domain === "light" || domain === "switch";
}

function stateColor(state: string): string {
  if (state === "on") return "text-blade-accent";
  if (state === "off") return "text-blade-muted";
  if (state === "unavailable") return "text-red-400/60";
  return "text-blade-secondary";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SpotifyCard({
  track,
  onPlayPause,
  onNext,
}: {
  track: SpotifyTrack;
  onPlayPause: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-blade-border bg-blade-surface px-4 py-3">
      {/* Music icon */}
      <div className="w-10 h-10 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center shrink-0">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-green-400" fill="currentColor">
          <path d="M12 3a9 9 0 100 18A9 9 0 0012 3zm3.6 13a.75.75 0 01-.4-.1c-1.1-.7-2.5-1-3.9-.8-.3.1-.6-.1-.7-.4-.1-.3.1-.6.4-.7 1.7-.3 3.4 0 4.7 1 .3.2.3.5.1.8-.1.1-.3.2-.2.2zm.96-2.9a.94.94 0 01-.5-.14c-1.35-.85-3.4-1.1-4.99-.6-.37.1-.76-.1-.86-.47-.1-.37.1-.76.47-.86 1.9-.57 4.25-.28 5.86.7.3.19.4.6.2.9a.9.9 0 01-.18.47zm.08-3c-1.6-1-4.25-1.06-5.78-.59a1.1 1.1 0 01-.67-2.1C12 7.6 15.08 7.67 17 8.88a1.1 1.1 0 01-1.36 1.72l.1-.5z" />
        </svg>
      </div>

      {/* Track info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-blade-text truncate">{track.title}</p>
        <p className="text-2xs text-blade-muted truncate">{track.artist}</p>
        {track.album && (
          <p className="text-2xs text-blade-muted/60 truncate">{track.album}</p>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onPlayPause}
          className="w-8 h-8 rounded-lg bg-blade-border/50 hover:bg-blade-border flex items-center justify-center transition-colors"
          aria-label={track.is_playing ? "Pause" : "Play"}
        >
          {track.is_playing ? (
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-blade-text" fill="currentColor">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-blade-text" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={onNext}
          className="w-8 h-8 rounded-lg bg-blade-border/50 hover:bg-blade-border flex items-center justify-center transition-colors"
          aria-label="Next track"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-blade-text" fill="currentColor">
            <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EntityCard({
  entity,
  entityState,
  onToggle,
  onBrightness,
}: {
  entity: HaEntity;
  entityState: HaEntityState | null;
  onToggle: () => void;
  onBrightness: (value: number) => void;
}) {
  const state = entityState?.state ?? entity.state;
  const attrs = entityState?.attributes ?? {};
  const brightness = typeof attrs.brightness === "number" ? Math.round((attrs.brightness / 255) * 100) : null;
  const canControl = isControllable(entity.domain);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-blade-border bg-blade-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-blade-text truncate">{entity.friendly_name}</p>
          <p className={`text-2xs capitalize ${stateColor(state)}`}>{state}</p>
        </div>
        {canControl && (
          <button
            onClick={onToggle}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${state === "on" ? "bg-blade-accent" : "bg-blade-border"}`}
            aria-label={`Toggle ${entity.friendly_name}`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${state === "on" ? "translate-x-4" : "translate-x-0.5"}`}
            />
          </button>
        )}
      </div>
      {entity.domain === "light" && state === "on" && brightness !== null && (
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-3 h-3 text-blade-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
          <input
            type="range"
            min={1}
            max={100}
            value={brightness}
            onChange={(e) => onBrightness(Number(e.target.value))}
            className="flex-1 h-1 rounded-full accent-blade-accent"
          />
          <span className="text-2xs text-blade-muted w-7 text-right">{brightness}%</span>
        </div>
      )}
      {entity.domain === "sensor" || entity.domain === "binary_sensor" ? (
        <div className="text-2xs text-blade-muted">
          {typeof attrs.unit_of_measurement === "string" ? `${state} ${attrs.unit_of_measurement}` : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Config section ─────────────────────────────────────────────────────────────

function ConfigSection({ onSaved }: { onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("save_config_field", { key: "ha_base_url", value: baseUrl });
      if (token.trim()) {
        await invoke("store_provider_key", { provider: "homeassistant", apiKey: token });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch {
      // silently ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-blade-border bg-blade-surface p-4 flex flex-col gap-3">
      <p className="text-xs font-semibold text-blade-secondary uppercase tracking-wider">
        Home Assistant
      </p>
      <div className="flex flex-col gap-2">
        <label className="text-2xs text-blade-muted">Base URL</label>
        <input
          type="text"
          placeholder="http://homeassistant.local:8123"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full rounded-lg bg-blade-bg border border-blade-border px-3 py-1.5 text-xs text-blade-text placeholder-blade-muted/50 focus:outline-none focus:border-blade-accent/60"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-2xs text-blade-muted">Long-Lived Access Token</label>
        <input
          type="password"
          placeholder="eyJ..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="w-full rounded-lg bg-blade-bg border border-blade-border px-3 py-1.5 text-xs text-blade-text placeholder-blade-muted/50 focus:outline-none focus:border-blade-accent/60"
        />
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !baseUrl.trim()}
        className="self-start px-4 py-1.5 rounded-lg bg-blade-accent/10 border border-blade-accent/30 text-xs text-blade-accent hover:bg-blade-accent/20 transition-colors disabled:opacity-40"
      >
        {saved ? "Saved" : saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SmartHomePanel({ onBack }: { onBack: () => void }) {
  const [entities, setEntities] = useState<HaEntity[]>([]);
  const [entityStates, setEntityStates] = useState<Record<string, HaEntityState>>({});
  const [spotify, setSpotify] = useState<SpotifyTrack | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const fetchEntities = useCallback(async () => {
    try {
      const list = await invoke<HaEntity[]>("iot_get_entities");
      setEntities(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSpotify = useCallback(async () => {
    try {
      const track = await invoke<SpotifyTrack | null>("spotify_now_playing_cmd");
      setSpotify(track);
    } catch {
      setSpotify(null);
    }
  }, []);

  useEffect(() => {
    fetchEntities();
    fetchSpotify();
    const interval = setInterval(() => {
      fetchSpotify();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchEntities, fetchSpotify]);

  const fetchEntityState = useCallback(async (entityId: string) => {
    try {
      const st = await invoke<HaEntityState>("iot_get_state", { entityId });
      setEntityStates((prev) => ({ ...prev, [entityId]: st }));
    } catch {
      // ignore
    }
  }, []);

  const handleToggle = useCallback(async (entity: HaEntity) => {
    const currentState = entityStates[entity.entity_id]?.state ?? entity.state;
    const service = currentState === "on" ? "turn_off" : "turn_on";
    try {
      await invoke("iot_call_service", {
        domain: entity.domain,
        service,
        entityId: entity.entity_id,
        data: {},
      });
      await fetchEntityState(entity.entity_id);
    } catch {
      // ignore
    }
  }, [entityStates, fetchEntityState]);

  const handleBrightness = useCallback(async (entity: HaEntity, pct: number) => {
    try {
      await invoke("iot_call_service", {
        domain: "light",
        service: "turn_on",
        entityId: entity.entity_id,
        data: { brightness: Math.round((pct / 100) * 255) },
      });
      await fetchEntityState(entity.entity_id);
    } catch {
      // ignore
    }
  }, [fetchEntityState]);

  const handlePlayPause = useCallback(async () => {
    try {
      await invoke("spotify_play_pause_cmd");
      setTimeout(fetchSpotify, 500);
    } catch {
      // ignore
    }
  }, [fetchSpotify]);

  const handleNext = useCallback(async () => {
    try {
      await invoke("spotify_next_cmd");
      setTimeout(fetchSpotify, 700);
    } catch {
      // ignore
    }
  }, [fetchSpotify]);

  // Group entities by domain
  const grouped: Record<Domain, HaEntity[]> = {
    light: [],
    switch: [],
    sensor: [],
    climate: [],
    other: [],
  };
  for (const e of entities) {
    grouped[classifyDomain(e.domain)].push(e);
  }

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-blade-border/60">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-text transition-colors"
            aria-label="Back"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1 className="text-sm font-semibold text-blade-text">Smart Home</h1>
            <p className="text-2xs text-blade-muted">
              {entities.length > 0 ? `${entities.length} device${entities.length !== 1 ? "s" : ""}` : "IoT control"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowConfig((p) => !p)}
            className="px-3 py-1.5 rounded-lg text-2xs text-blade-muted hover:text-blade-text border border-blade-border hover:border-blade-border/80 transition-colors"
          >
            {showConfig ? "Hide config" : "Configure"}
          </button>
          <button
            onClick={() => { setLoading(true); fetchEntities(); }}
            className="px-3 py-1.5 rounded-lg text-2xs text-blade-muted hover:text-blade-text border border-blade-border hover:border-blade-border/80 transition-colors"
            aria-label="Refresh"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4v5h5M20 20v-5h-5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 9a8 8 0 0114.7-2.3M20 15a8 8 0 01-14.7 2.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Config section */}
        {showConfig && (
          <ConfigSection onSaved={() => { setShowConfig(false); fetchEntities(); }} />
        )}

        {/* Spotify */}
        {spotify && (
          <div>
            <p className="text-2xs uppercase tracking-[0.15em] text-blade-muted mb-2">Now Playing</p>
            <SpotifyCard track={spotify} onPlayPause={handlePlayPause} onNext={handleNext} />
          </div>
        )}

        {/* Loading / error */}
        {loading && (
          <div className="flex items-center gap-2 text-blade-muted text-xs">
            <div className="w-2 h-2 rounded-full bg-blade-accent animate-pulse" />
            Loading devices...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-400">
            {error}
            <p className="text-2xs text-blade-muted mt-1">Configure your Home Assistant URL and token above.</p>
          </div>
        )}

        {/* Entity groups */}
        {!loading && !error && DOMAIN_ORDER.map((domain) => {
          const group = grouped[domain];
          if (group.length === 0) return null;
          return (
            <div key={domain}>
              <p className="text-2xs uppercase tracking-[0.15em] text-blade-muted mb-2">
                {DOMAIN_LABELS[domain]}
                <span className="ml-1 opacity-50">({group.length})</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                {group.map((entity) => (
                  <EntityCard
                    key={entity.entity_id}
                    entity={entity}
                    entityState={entityStates[entity.entity_id] ?? null}
                    onToggle={() => handleToggle(entity)}
                    onBrightness={(v) => handleBrightness(entity, v)}
                  />
                ))}
              </div>
            </div>
          );
        })}

        {!loading && !error && entities.length === 0 && !showConfig && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="w-10 h-10 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5 text-blade-muted" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9 22V12h6v10" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <p className="text-sm text-blade-secondary">No devices found</p>
              <p className="text-2xs text-blade-muted mt-1">Connect your Home Assistant instance to get started.</p>
            </div>
            <button
              onClick={() => setShowConfig(true)}
              className="px-4 py-1.5 rounded-lg bg-blade-accent/10 border border-blade-accent/30 text-xs text-blade-accent hover:bg-blade-accent/20 transition-colors"
            >
              Configure
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
