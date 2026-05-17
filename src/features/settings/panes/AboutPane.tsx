// src/features/settings/panes/AboutPane.tsx — SET-10 (D-90).
//
// Pure static content: BLADE wordmark + version + Tauri version + GitHub link
// + credit line.
//
// Version sourced from package.json via Vite define injection. If
// __APP_VERSION__ is not defined at build time, falls back to a literal
// constant that the operator updates per release.
//
// @see .planning/phases/03-dashboard-chat-settings/03-CONTEXT.md §D-90

import { openUrl } from '@tauri-apps/plugin-opener';
import { Card, Pill } from '@/design-system/primitives';

declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD_DATE__: string | undefined;

const FALLBACK_VERSION = '2.3-dev';
const TAURI_API_VERSION = '2.10.1'; // mirrors package.json @tauri-apps/api
const REPO_URL = 'https://github.com/sb-arnav/BLADE';

const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : FALLBACK_VERSION;
const BUILD_DATE =
  typeof __APP_BUILD_DATE__ !== 'undefined' ? __APP_BUILD_DATE__ : '';

export function AboutPane() {
  return (
    <div className="settings-section">
      <h2>About BLADE</h2>
      <p>JARVIS-level desktop AI agent. Local-first, zero telemetry.</p>

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontFamily: 'Syne, sans-serif', letterSpacing: '0.02em' }}>BLADE</h1>
          <Pill>v{APP_VERSION}</Pill>
        </div>

        <dl className="settings-readout">
          <dt>App version</dt>
          <dd>{APP_VERSION}</dd>
          <dt>Tauri runtime</dt>
          <dd>{TAURI_API_VERSION}</dd>
          {BUILD_DATE ? (
            <>
              <dt>Build date</dt>
              <dd>{BUILD_DATE}</dd>
            </>
          ) : null}
          <dt>License</dt>
          <dd>MIT — see LICENSE file</dd>
        </dl>
      </Card>

      <Card>
        <h3>Source</h3>
        <p>
          <a
            href={REPO_URL}
            onClick={(e) => {
              e.preventDefault();
              openUrl(REPO_URL).catch(() => {});
            }}
            className="settings-link"
          >
            github.com/sb-arnav/BLADE
          </a>
        </p>
        <p style={{ color: 'var(--t-3)', fontSize: 13, marginTop: 8 }}>
          Built by Arnav. Local-first. Zero telemetry. Your machine, your model, your files, your rules.
        </p>
      </Card>
    </div>
  );
}
