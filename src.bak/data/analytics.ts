import { invoke } from "@tauri-apps/api/core";

export interface DbAnalyticsEvent {
  id: number;
  event_type: string;
  timestamp: number;
  metadata?: string;
}

export const AnalyticsDB = {
  async trackEvent(eventType: string, metadata?: Record<string, string | number>): Promise<void> {
    return invoke("db_track_event", {
      eventType,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  },

  async getEventsSince(sinceMs: number): Promise<DbAnalyticsEvent[]> {
    return invoke("db_events_since", { since: sinceMs });
  },

  async getSummary(): Promise<{
    totalMessages: number;
    totalConversations: number;
    avgResponseTime: number;
    currentStreak: number;
    longestStreak: number;
    mostActiveHour: number;
    topProvider: string;
  }> {
    return invoke("db_analytics_summary");
  },

  async prune(olderThanDays: number): Promise<number> {
    return invoke("db_prune_analytics", { olderThanDays });
  },
};
