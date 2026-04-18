// src/features/dev-tools/index.tsx — Dev Tools cluster (10 routes, Phase 7).
// Phase 1 stubs per DEV-01..10.
//
// @see .planning/phases/01-foundation/01-CONTEXT.md §D-40
// @see .planning/REQUIREMENTS.md §DEV-01..10

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const skeleton = (label: string, phase: number) =>
  lazy(async () => {
    const { ComingSoonSkeleton } = await import('@/design-system/primitives');
    const Component = () => <ComingSoonSkeleton routeLabel={label} phase={phase} />;
    return { default: Component };
  });

export const routes: RouteDefinition[] = [
  { id: 'terminal',           label: 'Terminal',        section: 'dev', component: skeleton('Terminal', 7),       phase: 7 },
  { id: 'file-browser',       label: 'File Browser',    section: 'dev', component: skeleton('File Browser', 7),   phase: 7 },
  { id: 'git-panel',          label: 'Git',             section: 'dev', component: skeleton('Git', 7),            phase: 7 },
  { id: 'canvas',             label: 'Canvas',          section: 'dev', component: skeleton('Canvas', 7),         phase: 7 },
  { id: 'workflow-builder',   label: 'Workflows',       section: 'dev', component: skeleton('Workflows', 7),      phase: 7 },
  { id: 'web-automation',     label: 'Web Automation',  section: 'dev', component: skeleton('Web Automation', 7), phase: 7 },
  { id: 'email-assistant',    label: 'Email Assistant', section: 'dev', component: skeleton('Email Assistant', 7),phase: 7 },
  { id: 'document-generator', label: 'Documents',       section: 'dev', component: skeleton('Documents', 7),      phase: 7 },
  { id: 'code-sandbox',       label: 'Sandbox',         section: 'dev', component: skeleton('Code Sandbox', 7),   phase: 7 },
  { id: 'computer-use',       label: 'Computer Use',    section: 'dev', component: skeleton('Computer Use', 7),   phase: 7 },
];
