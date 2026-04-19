// src/features/life-os/index.tsx — Phase 6 Plan 06-02 rewrite (D-143 single-writer)
// Phase 1 ComingSoonSkeleton stubs replaced with lazy imports of real per-route
// components. Plans 06-03 + 06-04 fill in the placeholder bodies WITHOUT editing
// this file (D-143 single-writer invariant on shared registry files).
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-143, §D-163
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §LIFE-01..09

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const HealthView         = lazy(() => import('./HealthView').then((m) => ({ default: m.HealthView })));
const FinanceView        = lazy(() => import('./FinanceView').then((m) => ({ default: m.FinanceView })));
const GoalView           = lazy(() => import('./GoalView').then((m) => ({ default: m.GoalView })));
const HabitView          = lazy(() => import('./HabitView').then((m) => ({ default: m.HabitView })));
const MeetingsView       = lazy(() => import('./MeetingsView').then((m) => ({ default: m.MeetingsView })));
const SocialGraphView    = lazy(() => import('./SocialGraphView').then((m) => ({ default: m.SocialGraphView })));
const PredictionsView    = lazy(() => import('./PredictionsView').then((m) => ({ default: m.PredictionsView })));
const EmotionalIntelView = lazy(() => import('./EmotionalIntelView').then((m) => ({ default: m.EmotionalIntelView })));
const AccountabilityView = lazy(() => import('./AccountabilityView').then((m) => ({ default: m.AccountabilityView })));

export const routes: RouteDefinition[] = [
  { id: 'health',          label: 'Health',                 section: 'life', component: HealthView,         phase: 6, description: "Today's snapshot + streak" },
  { id: 'finance',         label: 'Finance',                section: 'life', component: FinanceView,        phase: 6 },
  { id: 'goals',           label: 'Goals',                  section: 'life', component: GoalView,           phase: 6 },
  { id: 'habits',          label: 'Habits',                 section: 'life', component: HabitView,          phase: 6 },
  { id: 'meetings',        label: 'Meetings',               section: 'life', component: MeetingsView,       phase: 6 },
  { id: 'social-graph',    label: 'Social Graph',           section: 'life', component: SocialGraphView,    phase: 6 },
  { id: 'predictions',     label: 'Predictions',            section: 'life', component: PredictionsView,    phase: 6 },
  { id: 'emotional-intel', label: 'Emotional Intelligence', section: 'life', component: EmotionalIntelView, phase: 6 },
  { id: 'accountability',  label: 'Accountability',         section: 'life', component: AccountabilityView, phase: 6 },
];
