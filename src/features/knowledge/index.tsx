// src/features/knowledge/index.tsx — Phase 5 Plan 05-02 rewrite (D-122 single-writer)
// Phase 1 ComingSoonSkeleton stubs replaced with lazy imports of real per-route
// components. Plans 05-05 + 05-06 fill in the placeholder bodies WITHOUT editing
// this file (D-122 single-writer invariant on shared registry files).
//
// @see .planning/phases/05-agents-knowledge/05-CONTEXT.md §D-122, §D-131
// @see .planning/phases/05-agents-knowledge/05-PATTERNS.md §5
// @see .planning/REQUIREMENTS.md §KNOW-01..09

import { lazy } from 'react';
import type { RouteDefinition } from '@/lib/router';

const KnowledgeBase        = lazy(() => import('./KnowledgeBase').then((m) => ({ default: m.KnowledgeBase })));
const KnowledgeGraph       = lazy(() => import('./KnowledgeGraph').then((m) => ({ default: m.KnowledgeGraph })));
const MemoryPalace         = lazy(() => import('./MemoryPalace').then((m) => ({ default: m.MemoryPalace })));
const ScreenTimeline       = lazy(() => import('./ScreenTimeline').then((m) => ({ default: m.ScreenTimeline })));
const RewindTimeline       = lazy(() => import('./RewindTimeline').then((m) => ({ default: m.RewindTimeline })));
const LiveNotes            = lazy(() => import('./LiveNotes').then((m) => ({ default: m.LiveNotes })));
const DailyLog             = lazy(() => import('./DailyLog').then((m) => ({ default: m.DailyLog })));
const ConversationInsights = lazy(() => import('./ConversationInsights').then((m) => ({ default: m.ConversationInsights })));
const CodebaseExplorer     = lazy(() => import('./CodebaseExplorer').then((m) => ({ default: m.CodebaseExplorer })));

export const routes: RouteDefinition[] = [
  { id: 'knowledge-base',        label: 'Knowledge Base',        section: 'knowledge', component: KnowledgeBase,        phase: 5 },
  { id: 'knowledge-graph',       label: 'Knowledge Graph',       section: 'knowledge', component: KnowledgeGraph,       phase: 5 },
  { id: 'memory-palace',         label: 'Memory Palace',         section: 'knowledge', component: MemoryPalace,         phase: 5 },
  { id: 'screen-timeline',       label: 'Screen Timeline',       section: 'knowledge', component: ScreenTimeline,       phase: 5 },
  { id: 'rewind-timeline',       label: 'Rewind',                section: 'knowledge', component: RewindTimeline,       phase: 5 },
  { id: 'live-notes',            label: 'Live Notes',            section: 'knowledge', component: LiveNotes,            phase: 5 },
  { id: 'daily-log',             label: 'Daily Log',             section: 'knowledge', component: DailyLog,             phase: 5 },
  { id: 'conversation-insights', label: 'Conversation Insights', section: 'knowledge', component: ConversationInsights, phase: 5 },
  { id: 'codebase-explorer',     label: 'Codebase Explorer',     section: 'knowledge', component: CodebaseExplorer,     phase: 5 },
];
