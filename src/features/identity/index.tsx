// src/features/identity/index.tsx — Phase 6 Plan 06-02 rewrite (D-143 single-writer)
// Phase 1 ComingSoonSkeleton stubs replaced with lazy imports of real per-route
// components. Plans 06-05 + 06-06 fill in the placeholder bodies WITHOUT editing
// this file (D-143 single-writer invariant on shared registry files).
//
// @see .planning/phases/06-life-os-identity/06-CONTEXT.md §D-143, §D-163
// @see .planning/phases/06-life-os-identity/06-PATTERNS.md §2
// @see .planning/REQUIREMENTS.md §IDEN-01..07

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const SoulView          = lazy(() => import('./SoulView').then((m) => ({ default: m.SoulView })));
const PersonaView       = lazy(() => import('./PersonaView').then((m) => ({ default: m.PersonaView })));
const CharacterBible    = lazy(() => import('./CharacterBible').then((m) => ({ default: m.CharacterBible })));
const NegotiationView   = lazy(() => import('./NegotiationView').then((m) => ({ default: m.NegotiationView })));
const ReasoningView     = lazy(() => import('./ReasoningView').then((m) => ({ default: m.ReasoningView })));
const ContextEngineView = lazy(() => import('./ContextEngineView').then((m) => ({ default: m.ContextEngineView })));
const ProfileView       = lazy(() => import('./ProfileView').then((m) => ({ default: m.ProfileView })));

export const routes: RouteDefinition[] = [
  { id: 'soul',           label: 'Soul',            section: 'identity', component: SoulView,          phase: 6 },
  { id: 'persona',        label: 'Persona',         section: 'identity', component: PersonaView,       phase: 6 },
  { id: 'character',      label: 'Character Bible', section: 'identity', component: CharacterBible,    phase: 6 },
  { id: 'negotiation',    label: 'Negotiation',     section: 'identity', component: NegotiationView,   phase: 6 },
  { id: 'reasoning',      label: 'Reasoning',       section: 'identity', component: ReasoningView,     phase: 6 },
  { id: 'context-engine', label: 'Context Engine',  section: 'identity', component: ContextEngineView, phase: 6 },
  // Phase 12 Plan 12-04 (D-63) — Profile as 8th identity sub-view
  { id: 'profile',        label: 'Profile',         section: 'identity', component: ProfileView,       phase: 12 },
];
