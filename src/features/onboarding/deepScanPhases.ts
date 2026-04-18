// src/features/onboarding/deepScanPhases.ts — Enumerated phase ticks emitted
// by src-tauri/src/deep_scan.rs:1325. Order matches the emit sequence at
// deep_scan.rs:1331 (`starting`) and deep_scan.rs:1375-1383 (scanner results)
// and deep_scan.rs:1419 (`complete`).
//
// `starting` fires once at the top of `deep_scan_start`; each intermediate
// phase fires once per scanner result; `complete` fires last. The UI derives
// a 0-100 display percent as (observed non-complete phases / 10) * 100; seeing
// `complete` forces 100 immediately.
//
// @see src-tauri/src/deep_scan.rs:1325 (emit site)
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §12
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-49

/**
 * Ordered list of phase names emitted by `deep_scan_progress`. `starting`
 * first, `complete` last. Ten intermediate scanner phases in between.
 */
export const DEEP_SCAN_PHASES = [
  'starting',
  'installed_apps',
  'git_repos',
  'ides',
  'ai_tools',
  'wsl_distros',
  'ssh_keys',
  'package_managers',
  'docker',
  'bookmarks',
  'complete',
] as const;

export type DeepScanPhase = typeof DEEP_SCAN_PHASES[number];

/**
 * Derive a 0-100 display percent from the phase-tick history. `seen` maps
 * phase name → `found` count (from DeepScanProgressPayload accumulated into
 * `OnbState.scanProgress`).
 *
 * Completed scan (`complete` observed) jumps to 100 immediately; partial runs
 * get a linear percent across the 10 non-complete phases.
 */
export function deepScanPercent(seen: Record<string, number>): number {
  if (Object.prototype.hasOwnProperty.call(seen, 'complete')) return 100;
  const nonComplete = DEEP_SCAN_PHASES.length - 1;
  const observed = DEEP_SCAN_PHASES.filter(
    (p) => p !== 'complete' && Object.prototype.hasOwnProperty.call(seen, p),
  ).length;
  return Math.round((observed / nonComplete) * 100);
}

/**
 * Human-readable labels for the scanner phases — surfaced under the progress
 * ring in Plan 02-04's Deep Scan step. `starting` is intentionally present
 * but typically suppressed in the UI (it's the trigger, not a scanner
 * outcome).
 */
export const PHASE_LABEL: Record<DeepScanPhase, string> = {
  starting: 'Initialising',
  installed_apps: 'Installed apps',
  git_repos: 'Git repositories',
  ides: 'IDEs',
  ai_tools: 'AI tools',
  wsl_distros: 'WSL distros',
  ssh_keys: 'SSH keys',
  package_managers: 'Package managers',
  docker: 'Docker containers',
  bookmarks: 'Browser bookmarks',
  complete: 'Ready',
};
