// src/features/knowledge/ConversationInsights.tsx — Phase 5 Plan 05-06 (KNOW-08).
//
// Surfaces recent conversations + a best-effort "topics this week" view backed
// by the existing semantic_search index.
//
// db_list_conversations is registered in Rust (lib.rs:616) but lives on the
// chat/history side of the split, not the knowledge side, so no knowledge.ts
// wrapper exists for it. Per plan Interfaces §(c), this component invokes it
// directly through `invokeTyped` — the ESLint no-raw-tauri rule permits
// invokeTyped (it only blocks raw `@tauri-apps/api/core` invoke). Phase 6
// (Identity / Life OS cluster) will consolidate this into a history.ts
// wrapper when history surfaces stabilize.
//
// @see src-tauri/src/db_commands.rs:13 db_list_conversations
// @see src-tauri/src/db.rs:9 ConversationRow
// @see .planning/phases/05-agents-knowledge/05-06-PLAN.md §Interfaces (c)
// @see .planning/REQUIREMENTS.md §KNOW-08

import { useCallback, useEffect, useMemo, useState } from 'react';
import { GlassPanel, Pill, Button } from '@/design-system/primitives';
import { useRouterCtx } from '@/windows/main/useRouter';
import { invokeTyped } from '@/lib/tauri/_base';
import { semanticSearch } from '@/lib/tauri/knowledge';
import type { SemanticHit } from '@/lib/tauri/knowledge';
import './knowledge.css';
import './knowledge-rich-b.css';

/**
 * Shape of db_list_conversations' return rows. Matches Rust ConversationRow
 * verbatim (snake_case preserved). Index signature for forward-compat per
 * D-38-payload.
 *
 * TODO(phase-6): migrate to a proper history.ts wrapper when the chat cluster
 * re-opens to surface conversation metadata beyond the Phase 3 substrate.
 */
interface ConversationRow {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  pinned: boolean;
  [k: string]: unknown;
}

interface TopicEntry {
  label: string;
  count: number;
}

const RECENT_LIMIT = 20;
const TOPIC_QUERY = 'this week';
const TOPIC_SEARCH_LIMIT = 20;

function formatTimestamp(unixMs: number): string {
  if (!Number.isFinite(unixMs)) return '—';
  // ConversationRow uses unix MS (i64 millis per db.rs), but be defensive.
  const ms = unixMs > 1e12 ? unixMs : unixMs * 1000;
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Pull rough topic labels out of a bag of SemanticHits. We look at the hit
 * metadata's `source_type` plus any short content preview tokens; this is a
 * heuristic — if it produces zero usable buckets we render an honest deferral
 * card instead of a fake visualisation.
 */
function extractTopics(hits: SemanticHit[]): TopicEntry[] {
  const counts = new Map<string, number>();
  for (const hit of hits) {
    // Prefer explicit metadata.topic / metadata.tag if the hit carries one.
    const meta = (hit as Record<string, unknown>).metadata as
      | Record<string, unknown>
      | undefined;
    const metaTag =
      (meta?.topic as string | undefined) ??
      (meta?.tag as string | undefined) ??
      (meta?.category as string | undefined);
    if (metaTag && typeof metaTag === 'string') {
      counts.set(metaTag, (counts.get(metaTag) ?? 0) + 1);
      continue;
    }
    const label = hit.source_type || 'general';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export function ConversationInsights() {
  const router = useRouterCtx();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [hits, setHits] = useState<SemanticHit[]>([]);
  const [loadingConv, setLoadingConv] = useState(true);
  const [loadingHits, setLoadingHits] = useState(true);
  const [convError, setConvError] = useState<string | null>(null);
  const [hitsError, setHitsError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoadingConv(true);
    setConvError(null);
    try {
      const rows = await invokeTyped<ConversationRow[]>('db_list_conversations', {});
      // Sort newest-first by updated_at. Rust should return sorted already;
      // this is defensive and cheap.
      const sorted = [...rows].sort(
        (a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0),
      );
      setConversations(sorted);
    } catch (e) {
      setConvError(e instanceof Error ? e.message : String(e));
      setConversations([]);
    } finally {
      setLoadingConv(false);
    }
  }, []);

  const loadTopics = useCallback(async () => {
    setLoadingHits(true);
    setHitsError(null);
    try {
      const results = await semanticSearch({ query: TOPIC_QUERY, topK: TOPIC_SEARCH_LIMIT });
      setHits(results);
    } catch (e) {
      setHitsError(e instanceof Error ? e.message : String(e));
      setHits([]);
    } finally {
      setLoadingHits(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    void loadTopics();
  }, [loadConversations, loadTopics]);

  const topics = useMemo(() => extractTopics(hits), [hits]);
  const shouldDeferTopics = !loadingHits && !hitsError && topics.length === 0;

  const onRowClick = useCallback(
    (_row: ConversationRow) => {
      // Full deep-link (history_load_conversation → chat) needs Phase 6 wiring
      // per plan. For Phase 5 we simply open /chat; selecting the specific
      // conversation is deferred to the history-cluster work.
      router.openRoute('chat');
    },
    [router],
  );

  return (
    <GlassPanel tier={1} className="knowledge-surface" data-testid="conversation-insights-root">
      <div className="conversation-insights-layout">
        <section aria-label="Recent conversations">
          <div className="kb-section-heading">
            <h2 className="kb-section-title">Recent conversations</h2>
            <Pill tone="default">
              {loadingConv ? '…' : conversations.length}
            </Pill>
          </div>

          {convError ? (
            <div className="memory-palace-empty" role="alert">
              Could not load conversations: {convError}
            </div>
          ) : conversations.length === 0 && !loadingConv ? (
            <div className="memory-palace-empty">No conversations yet.</div>
          ) : (
            <div className="conversation-insights-list">
              {conversations.slice(0, RECENT_LIMIT).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="conversation-row"
                  onClick={() => onRowClick(row)}
                  data-testid="conversation-row"
                >
                  <div className="conversation-row-head">
                    <span className="conversation-row-title">{row.title || '(untitled)'}</span>
                    <span className="conversation-row-time">
                      {formatTimestamp(row.updated_at)}
                    </span>
                  </div>
                  <div className="conversation-row-meta">
                    {row.message_count} message{row.message_count === 1 ? '' : 's'}
                    {row.pinned ? ' · pinned' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Topics this week">
          <div className="kb-section-heading">
            <h2 className="kb-section-title">Topics this week</h2>
            {!shouldDeferTopics && topics.length > 0 ? (
              <Button variant="ghost" size="sm" type="button" onClick={() => void loadTopics()}>
                Refresh
              </Button>
            ) : null}
          </div>

          {hitsError ? (
            <div className="conversation-insights-defer" role="alert">
              Topic search unavailable: {hitsError}
            </div>
          ) : loadingHits ? (
            <div className="memory-palace-empty">Scanning semantic index…</div>
          ) : shouldDeferTopics ? (
            <div className="conversation-insights-defer">
              Weekly topic extraction coming in Phase 9 polish. The semantic
              index did not return enough tagged hits to build a reliable topic
              list yet.
            </div>
          ) : (
            <div className="topic-pills">
              {topics.map((t) => (
                <span key={t.label} className="topic-pill">
                  {t.label}
                  <span className="topic-pill-count">{t.count}</span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
    </GlassPanel>
  );
}
