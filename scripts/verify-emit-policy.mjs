#!/usr/bin/env node
// scripts/verify-emit-policy.mjs (D-45-regress)
//
// Greps src-tauri/src/ for `app.emit(` and `emit_all(` (broadcast emits).
// Fails if any call is not in the CROSS_WINDOW allowlist. Allowlist is
// transcribed from .planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md —
// every row classified `cross-window` above is represented here as
// `<relative_path>:<event_name>`. Line numbers are intentionally excluded so
// the allowlist survives code churn; what matters is the source file + event
// name.
//
// Regression prevention: a new feature that introduces a single-window
// `app.emit(...)` or `emit_all(...)` site will fail CI until either:
//   1. The call is rewritten to `app.emit_to("<label>", ...)`, OR
//   2. The site is added to CROSS_WINDOW_ALLOWLIST below.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-45, §D-45-regress
// @see .planning/phases/00-pre-rebuild-audit/00-EMIT-AUDIT.md

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUST_DIR = join(ROOT, 'src-tauri', 'src');

// ---------------------------------------------------------------------------
// CROSS_WINDOW_ALLOWLIST — sourced from 00-EMIT-AUDIT.md `cross-window` rows.
// Format: `<relative_path>:<event_name>`.
// ---------------------------------------------------------------------------
const CROSS_WINDOW_ALLOWLIST = new Set([
  // ───── commands.rs — blade_status broadcasts (main + HUD) ─────────────
  'commands.rs:blade_status',

  // ───── homeostasis / hormone bus (main + hud + body) ──────────────────
  'homeostasis.rs:homeostasis_update',

  // ───── voice (overlay orb + main; wake + quickask) ────────────────────
  'voice_global.rs:voice_conversation_listening',
  'voice_global.rs:voice_conversation_ended',
  'voice_global.rs:voice_emotion_detected',
  'voice_global.rs:voice_user_message',
  'voice_global.rs:voice_conversation_speaking',
  'voice_global.rs:voice_conversation_thinking',
  'wake_word.rs:wake_word_detected',
  'tts.rs:tts_interrupted',

  // ───── overlay + toast ────────────────────────────────────────────────
  'overlay_manager.rs:blade_toast',

  // ───── hive (main + hud) ──────────────────────────────────────────────
  'hive.rs:hive_tick',
  'hive.rs:hive_status_updated',

  // ───── ambient + cron nudges (main + overlay) ─────────────────────────
  'ambient.rs:proactive_nudge',
  'cron.rs:proactive_nudge',
  'health.rs:proactive_nudge',

  // ───── godmode (main + overlay + hud) ─────────────────────────────────
  'godmode.rs:smart_interrupt',
  'godmode.rs:godmode_update',

  // ───── health + reminders (main + overlay) ────────────────────────────
  'health_guardian.rs:health_break_reminder',
  'reminders.rs:blade_reminder_fired',
  'habit_engine.rs:blade_habit_reminder',
  'goal_engine.rs:goal_reminder',

  // ───── clipboard (main + quickask) ────────────────────────────────────
  'clipboard.rs:clipboard_changed',

  // ───── tentacles (main + overlay) ─────────────────────────────────────
  'tentacles/calendar_tentacle.rs:calendar_event_alert',
  'tentacles/calendar_tentacle.rs:health_alert',
  'health_tracker.rs:health_alert',
]);

// ---------------------------------------------------------------------------
// Walk + scan.
// ---------------------------------------------------------------------------
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (entry.endsWith('.rs')) yield p;
  }
}

// Match `app.emit(` and `emit_all(` but NOT `app.emit_to(`.
// Event name must be a string literal; we don't try to resolve variables.
const EMIT_RE = /\b(?:app\.emit|emit_all)\s*\(\s*"([a-z_][a-z0-9_]*)"/g;

let failed = false;
let totalChecked = 0;
for (const file of walk(RUST_DIR)) {
  const rel = relative(RUST_DIR, file).split('\\').join('/'); // Windows path normalisation
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(EMIT_RE)) {
    totalChecked += 1;
    const eventName = m[1];
    const key = `${rel}:${eventName}`;
    if (!CROSS_WINDOW_ALLOWLIST.has(key)) {
      const lineNum = text.slice(0, m.index).split('\n').length;
      console.error(
        `[verify-emit-policy] VIOLATION: ${rel}:${lineNum} emits '${eventName}' as broadcast`,
      );
      console.error(
        `  → Convert to app.emit_to("<label>", "${eventName}", payload) OR add '${key}' to CROSS_WINDOW_ALLOWLIST`,
      );
      failed = true;
    }
  }
}

if (failed) {
  console.error(
    '[verify-emit-policy] FAIL: one or more broadcast emits not in cross-window allowlist',
  );
  process.exit(1);
}

console.log(
  `[verify-emit-policy] OK — all ${totalChecked} broadcast emits match cross-window allowlist`,
);
