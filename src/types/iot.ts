// src/types/iot.ts — DTOs for src-tauri/src/iot_bridge.rs.
//
// IoTState.attributes is `serde_json::Value` on the Rust side — typed here as
// `Record<string, unknown>` since shape varies per entity (light vs sensor vs
// climate). Consumers narrow as needed.
//
// SpotifyTrack.duration_ms / progress_ms are Option<u64> in Rust — null when
// the track has unknown duration or no playback in progress.
//
// @see src-tauri/src/iot_bridge.rs:10   (pub struct IoTEntity)
// @see src-tauri/src/iot_bridge.rs:18   (pub struct IoTState)
// @see src-tauri/src/iot_bridge.rs:26   (pub struct SpotifyTrack)
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-87

export interface IoTEntity {
  /** Fully-qualified entity id, e.g. "light.living_room". */
  entity_id: string;
  /** Display label set in Home Assistant. */
  friendly_name: string;
  /** Domain segment of entity_id, e.g. "light", "switch", "sensor". */
  domain: string;
  /** Current state ("on" | "off" | numeric string for sensors). */
  state: string;
}

export interface IoTState {
  entity_id: string;
  state: string;
  /** serde_json::Value on the Rust side; shape varies per entity domain. */
  attributes: Record<string, unknown>;
  /** ISO datetime string from Home Assistant. */
  last_changed: string;
}

export interface SpotifyTrack {
  title: string;
  artist: string;
  album: string;
  is_playing: boolean;
  /** null when duration is unknown (Rust Option<u64>). */
  duration_ms: number | null;
  /** null when no playback in progress (Rust Option<u64>). */
  progress_ms: number | null;
}
