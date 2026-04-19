// src/lib/tauri/iot.ts — Wrappers for src-tauri/src/iot_bridge.rs.
// Phase 3 D-87 IoT pane (SET-07) consumes these.
//
// Command names verified against src-tauri/src/lib.rs:1115-1120 (registered
// handlers). Plan-text snippet referenced `iot_list_entities` /
// `iot_set_state` / `iot_spotify_now_playing` — actual registered Rust names
// are `iot_get_entities` / `iot_call_service` / `spotify_now_playing_cmd`
// (etc.). Per the Plan §2c "use the EXACT names registered in lib.rs"
// directive and D-38, we wrap the actual Rust names while keeping the
// convenience export names from the plan's must-haves.
//
// `iotSetState(entityId, "on"|"off")` is a thin convenience over
// `iot_call_service` — it picks domain from entity_id (e.g.
// "light.living_room" → "light") and maps "on"/"off" to "turn_on"/"turn_off".
// Anything more complex (climate setpoints, scenes) goes via `iotCallService`.
//
// IoT pane is fail-soft: a missing wrapper just hides that affordance. Plan
// 03-06 IoT pane handles failures via TauriError catch + "Service unavailable"
// notice.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-87
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-13, §D-38

import { invokeTyped } from './_base';
import type { IoTEntity, IoTState, SpotifyTrack } from '@/types/iot';

/**
 * @see src-tauri/src/iot_bridge.rs:469
 *   `pub async fn iot_get_entities() -> Result<Vec<IoTEntity>, String>`
 *
 * Returns ALL entities (lights, switches, sensors, climate, etc.) from
 * Home Assistant. Errors when ha_base_url or homeassistant token are unset.
 */
export function iotListEntities(): Promise<IoTEntity[]> {
  return invokeTyped<IoTEntity[]>('iot_get_entities');
}

/**
 * @see src-tauri/src/iot_bridge.rs:477
 *   `pub async fn iot_get_state(entity_id: String) -> Result<IoTState, String>`
 */
export function iotGetState(entityId: string): Promise<IoTState> {
  return invokeTyped<IoTState, { entity_id: string }>(
    'iot_get_state',
    { entity_id: entityId },
  );
}

/**
 * @see src-tauri/src/iot_bridge.rs:485
 *   `pub async fn iot_call_service(domain, service, entity_id, data?) -> Result<(), String>`
 *
 * Direct passthrough to Home Assistant's call_service endpoint. Use this for
 * any service beyond plain on/off (climate setpoints, scene activation, etc.).
 */
export function iotCallService(args: {
  domain: string;
  service: string;
  entityId: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  return invokeTyped<void, {
    domain: string;
    service: string;
    entity_id: string;
    data?: Record<string, unknown>;
  }>('iot_call_service', {
    domain: args.domain,
    service: args.service,
    entity_id: args.entityId,
    data: args.data,
  });
}

/**
 * Convenience over `iot_call_service` — toggles a binary entity on/off.
 * Domain inferred from entity_id prefix (everything before the first dot).
 *
 * @see src-tauri/src/iot_bridge.rs:485 `iot_call_service`
 *
 * Throws if `state` is not "on" or "off" — for richer states use
 * `iotCallService` directly.
 */
export function iotSetState(entityId: string, state: 'on' | 'off'): Promise<void> {
  const domain = entityId.split('.')[0] ?? 'switch';
  const service = state === 'on' ? 'turn_on' : 'turn_off';
  return iotCallService({ domain, service, entityId });
}

/**
 * @see src-tauri/src/iot_bridge.rs:498
 *   `pub async fn spotify_now_playing_cmd() -> Result<Option<SpotifyTrack>, String>`
 *
 * Returns null when nothing is playing. Errors when Spotify control is
 * unavailable (token missing / app not running).
 */
export function iotSpotifyNowPlaying(): Promise<SpotifyTrack | null> {
  return invokeTyped<SpotifyTrack | null>('spotify_now_playing_cmd');
}

/**
 * @see src-tauri/src/iot_bridge.rs:504
 *   `pub async fn spotify_play_pause_cmd() -> Result<(), String>`
 */
export function iotSpotifyPlayPause(): Promise<void> {
  return invokeTyped<void>('spotify_play_pause_cmd');
}

/**
 * @see src-tauri/src/iot_bridge.rs:510
 *   `pub async fn spotify_next_cmd() -> Result<(), String>`
 */
export function iotSpotifyNext(): Promise<void> {
  return invokeTyped<void>('spotify_next_cmd');
}
