// src/features/dev-tools/index.tsx — Phase 7 rewrite (Plan 07-02, D-170 single-writer)
// Phase 1 ComingSoonSkeleton stubs replaced with lazy imports of real route
// component files. Each body is a minimal placeholder shipped by Plan 07-02;
// Plans 07-03 and 07-04 REPLACE the placeholder bodies with real feature UIs.
//
// @see .planning/phases/07-dev-tools-admin/07-CONTEXT.md §D-170
// @see .planning/phases/07-dev-tools-admin/07-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §DEV-01..10

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const Terminal          = lazy(() => import('./Terminal').then((m) => ({ default: m.Terminal })));
const FileBrowser       = lazy(() => import('./FileBrowser').then((m) => ({ default: m.FileBrowser })));
const GitPanel          = lazy(() => import('./GitPanel').then((m) => ({ default: m.GitPanel })));
const Canvas            = lazy(() => import('./Canvas').then((m) => ({ default: m.Canvas })));
const WebAutomation     = lazy(() => import('./WebAutomation').then((m) => ({ default: m.WebAutomation })));
const EmailAssistant    = lazy(() => import('./EmailAssistant').then((m) => ({ default: m.EmailAssistant })));
const DocumentGenerator = lazy(() => import('./DocumentGenerator').then((m) => ({ default: m.DocumentGenerator })));
const CodeSandbox       = lazy(() => import('./CodeSandbox').then((m) => ({ default: m.CodeSandbox })));
const ComputerUse       = lazy(() => import('./ComputerUse').then((m) => ({ default: m.ComputerUse })));
// Phase 59 Plan 59-01 (TRIO-DEV-PANE) — host the v2.0-held trio (Body Map /
// Organ Registry / Pixel World / Tentacle Detail / mortality-salience monitor
// / Ghost Mode) inside a single /dev-tools route with sub-tabs. The trio's
// individual routes stay registered (TRIO-DEMOTE-NAV demotes them from nav +
// palette via paletteHidden, but keeps openRoute() reachability).
const DevToolsPane      = lazy(() => import('./DevToolsPane').then((m) => ({ default: m.DevToolsPane })));

export const routes: RouteDefinition[] = [
  { id: 'dev-tools',          label: 'Open Developer Tools', section: 'dev', component: DevToolsPane, phase: 59, description: 'Held-trio: Body Map / Organ Registry / Pixel World / Tentacle / Mortality / Ghost.' },
  { id: 'terminal',           label: 'Terminal',        section: 'dev', component: Terminal,          phase: 7 },
  { id: 'file-browser',       label: 'File Browser',    section: 'dev', component: FileBrowser,       phase: 7 },
  { id: 'git-panel',          label: 'Git',             section: 'dev', component: GitPanel,          phase: 7 },
  { id: 'canvas',             label: 'Canvas',          section: 'dev', component: Canvas,            phase: 7 },
  { id: 'web-automation',     label: 'Web Automation',  section: 'dev', component: WebAutomation,     phase: 7 },
  { id: 'email-assistant',    label: 'Email Assistant', section: 'dev', component: EmailAssistant,    phase: 7 },
  { id: 'document-generator', label: 'Documents',       section: 'dev', component: DocumentGenerator, phase: 7 },
  { id: 'code-sandbox',       label: 'Sandbox',         section: 'dev', component: CodeSandbox,       phase: 7 },
  { id: 'computer-use',       label: 'Computer Use',    section: 'dev', component: ComputerUse,       phase: 7 },
];
