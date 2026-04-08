import { useState, useCallback, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Integration {
  id: string;
  name: string;
  type: "webhook" | "api" | "mcp" | "oauth" | "file-sync";
  status: "connected" | "disconnected" | "error" | "pending";
  config: Record<string, string>;
  icon: string;
  color: string;
  category: "communication" | "development" | "productivity" | "data" | "custom";
  lastSync: number | null;
  eventCount: number;
  createdAt: number;
  enabled: boolean;
  pollIntervalMs: number | null;
  webhookSecret: string | null;
}

export interface WebhookEvent {
  id: string;
  integrationId: string;
  type: string;
  payload: string;
  timestamp: number;
  processed: boolean;
  summary: string | null;
}

export interface IntegrationConfigField {
  key: string;
  label: string;
  type: "text" | "url" | "secret";
  required: boolean;
  placeholder: string;
}

export interface IntegrationTemplate {
  id: string;
  name: string;
  icon: string;
  color: string;
  category: Integration["category"];
  type: Integration["type"];
  description: string;
  configFields: IntegrationConfigField[];
  webhookUrl?: boolean;
  defaultPollIntervalMs?: number;
}

// ── Storage keys ───────────────────────────────────────────────────────────────

const STORAGE_INTEGRATIONS = "blade-integrations";
const STORAGE_EVENTS = "blade-integration-events";
const MAX_EVENTS = 500;

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateId(): string {
  return `int_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateWebhookSecret(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function generateWebhookUrl(integrationId: string): string {
  return `https://hooks.blade.dev/v1/ingest/${integrationId}`;
}

function loadIntegrations(): Integration[] {
  try {
    const raw = localStorage.getItem(STORAGE_INTEGRATIONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveIntegrations(list: Integration[]): void {
  localStorage.setItem(STORAGE_INTEGRATIONS, JSON.stringify(list));
}

function loadEvents(): WebhookEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_EVENTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveEvents(list: WebhookEvent[]): void {
  const trimmed = list.slice(0, MAX_EVENTS);
  localStorage.setItem(STORAGE_EVENTS, JSON.stringify(trimmed));
}

// ── Templates ──────────────────────────────────────────────────────────────────

export const INTEGRATION_TEMPLATES: IntegrationTemplate[] = [
  {
    id: "github",
    name: "GitHub",
    icon: "github",
    color: "#8b5cf6",
    category: "development",
    type: "webhook",
    description: "Receive webhooks for pull requests, issues, pushes, and CI status checks.",
    configFields: [
      { key: "repo", label: "Repository", type: "text", required: true, placeholder: "owner/repo" },
      { key: "token", label: "Personal Access Token", type: "secret", required: false, placeholder: "ghp_..." },
      { key: "events", label: "Events (comma-separated)", type: "text", required: false, placeholder: "push,pull_request,issues" },
    ],
    webhookUrl: true,
  },
  {
    id: "slack",
    name: "Slack",
    icon: "slack",
    color: "#e01e5a",
    category: "communication",
    type: "webhook",
    description: "Send and receive Slack messages via incoming webhooks and event subscriptions.",
    configFields: [
      { key: "webhookUrl", label: "Incoming Webhook URL", type: "url", required: true, placeholder: "https://hooks.slack.com/services/..." },
      { key: "channel", label: "Channel", type: "text", required: false, placeholder: "#general" },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    icon: "discord",
    color: "#5865f2",
    category: "communication",
    type: "webhook",
    description: "Post messages and receive events from Discord via webhooks.",
    configFields: [
      { key: "webhookUrl", label: "Webhook URL", type: "url", required: true, placeholder: "https://discord.com/api/webhooks/..." },
      { key: "botName", label: "Bot Display Name", type: "text", required: false, placeholder: "Blade AI" },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    icon: "linear",
    color: "#5e6ad2",
    category: "development",
    type: "webhook",
    description: "Receive issue creation, status change, and comment events from Linear.",
    configFields: [
      { key: "apiKey", label: "API Key", type: "secret", required: true, placeholder: "lin_api_..." },
      { key: "teamId", label: "Team ID", type: "text", required: false, placeholder: "TEAM-123" },
    ],
    webhookUrl: true,
  },
  {
    id: "notion",
    name: "Notion",
    icon: "notion",
    color: "#000000",
    category: "productivity",
    type: "api",
    description: "Sync Notion databases and pages as context for your AI conversations.",
    configFields: [
      { key: "apiKey", label: "Integration Token", type: "secret", required: true, placeholder: "secret_..." },
      { key: "databaseId", label: "Database ID", type: "text", required: true, placeholder: "abc123..." },
    ],
    defaultPollIntervalMs: 300_000,
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    icon: "calendar",
    color: "#4285f4",
    category: "productivity",
    type: "oauth",
    description: "Sync upcoming events so Blade can reference your schedule in conversations.",
    configFields: [
      { key: "calendarId", label: "Calendar ID", type: "text", required: true, placeholder: "primary" },
      { key: "clientId", label: "OAuth Client ID", type: "text", required: true, placeholder: "xxxx.apps.googleusercontent.com" },
      { key: "clientSecret", label: "OAuth Client Secret", type: "secret", required: true, placeholder: "" },
    ],
    defaultPollIntervalMs: 600_000,
  },
  {
    id: "jira",
    name: "Jira",
    icon: "jira",
    color: "#0052cc",
    category: "development",
    type: "webhook",
    description: "Track Jira ticket creation, transitions, and comments in real-time.",
    configFields: [
      { key: "domain", label: "Jira Domain", type: "url", required: true, placeholder: "https://yourteam.atlassian.net" },
      { key: "email", label: "Account Email", type: "text", required: true, placeholder: "you@company.com" },
      { key: "apiToken", label: "API Token", type: "secret", required: true, placeholder: "" },
      { key: "project", label: "Project Key", type: "text", required: false, placeholder: "PROJ" },
    ],
    webhookUrl: true,
  },
  {
    id: "sentry",
    name: "Sentry",
    icon: "sentry",
    color: "#362d59",
    category: "development",
    type: "webhook",
    description: "Receive error and performance alerts from Sentry for AI-powered triage.",
    configFields: [
      { key: "dsn", label: "DSN / Auth Token", type: "secret", required: true, placeholder: "https://...@sentry.io/..." },
      { key: "project", label: "Project Slug", type: "text", required: false, placeholder: "my-project" },
    ],
    webhookUrl: true,
  },
  {
    id: "vercel",
    name: "Vercel",
    icon: "vercel",
    color: "#000000",
    category: "development",
    type: "webhook",
    description: "Get notified of deployments, build failures, and domain changes.",
    configFields: [
      { key: "token", label: "Vercel Token", type: "secret", required: true, placeholder: "" },
      { key: "projectId", label: "Project ID", type: "text", required: false, placeholder: "prj_..." },
    ],
    webhookUrl: true,
  },
  {
    id: "custom-webhook",
    name: "Custom Webhook",
    icon: "webhook",
    color: "#f59e0b",
    category: "custom",
    type: "webhook",
    description: "Receive events from any service that supports outgoing webhooks.",
    configFields: [
      { key: "label", label: "Label", type: "text", required: true, placeholder: "My Service" },
      { key: "secret", label: "Signing Secret (optional)", type: "secret", required: false, placeholder: "" },
    ],
    webhookUrl: true,
  },
  {
    id: "rest-api",
    name: "REST API",
    icon: "api",
    color: "#06b6d4",
    category: "data",
    type: "api",
    description: "Poll any REST endpoint on a schedule and pipe results into Blade.",
    configFields: [
      { key: "url", label: "Endpoint URL", type: "url", required: true, placeholder: "https://api.example.com/data" },
      { key: "method", label: "HTTP Method", type: "text", required: false, placeholder: "GET" },
      { key: "headers", label: "Headers (JSON)", type: "text", required: false, placeholder: '{"Authorization":"Bearer ..."}' },
      { key: "apiKey", label: "API Key", type: "secret", required: false, placeholder: "" },
    ],
    defaultPollIntervalMs: 300_000,
  },
  {
    id: "rss-feed",
    name: "RSS Feed",
    icon: "rss",
    color: "#f97316",
    category: "data",
    type: "api",
    description: "Monitor RSS/Atom feeds for new articles, blog posts, or release notes.",
    configFields: [
      { key: "feedUrl", label: "Feed URL", type: "url", required: true, placeholder: "https://blog.example.com/feed.xml" },
      { key: "keyword", label: "Keyword Filter (optional)", type: "text", required: false, placeholder: "AI, machine learning" },
    ],
    defaultPollIntervalMs: 900_000,
  },
];

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useIntegrations() {
  const [integrations, setIntegrations] = useState<Integration[]>(loadIntegrations);
  const [events, setEvents] = useState<WebhookEvent[]>(loadEvents);
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Persist on change
  useEffect(() => { saveIntegrations(integrations); }, [integrations]);
  useEffect(() => { saveEvents(events); }, [events]);

  // ── Poll-based integrations ────────────────────────────────────────────────

  const runPoll = useCallback(async (int: Integration) => {
    if (!int.enabled || int.status === "disconnected") return;

    const url = int.config.url || int.config.feedUrl;
    if (!url) return;

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (int.config.headers) {
        try { Object.assign(headers, JSON.parse(int.config.headers)); } catch { /* skip */ }
      }
      if (int.config.apiKey) {
        headers["Authorization"] = `Bearer ${int.config.apiKey}`;
      }

      const resp = await fetch(url, {
        method: (int.config.method || "GET").toUpperCase(),
        headers,
      });
      const text = await resp.text();

      const evt: WebhookEvent = {
        id: generateId(),
        integrationId: int.id,
        type: resp.ok ? "poll.success" : "poll.error",
        payload: text.slice(0, 4096),
        timestamp: Date.now(),
        processed: false,
        summary: null,
      };

      setEvents(prev => [evt, ...prev].slice(0, MAX_EVENTS));
      setIntegrations(prev =>
        prev.map(i =>
          i.id === int.id
            ? { ...i, lastSync: Date.now(), eventCount: i.eventCount + 1, status: resp.ok ? "connected" : "error" }
            : i
        )
      );
    } catch (err) {
      setIntegrations(prev =>
        prev.map(i => (i.id === int.id ? { ...i, status: "error" as const } : i))
      );
    }
  }, []);

  // Manage poll timers for api-type integrations
  useEffect(() => {
    const active = integrations.filter(
      i => i.enabled && i.pollIntervalMs && i.pollIntervalMs > 0 && (i.type === "api" || i.type === "file-sync")
    );

    // Clear timers for removed / disabled integrations
    for (const [id, timer] of pollTimers.current) {
      if (!active.find(i => i.id === id)) {
        clearInterval(timer);
        pollTimers.current.delete(id);
      }
    }

    // Start timers for new ones
    for (const int of active) {
      if (!pollTimers.current.has(int.id)) {
        const timer = setInterval(() => runPoll(int), int.pollIntervalMs!);
        pollTimers.current.set(int.id, timer);
      }
    }

    return () => {
      for (const timer of pollTimers.current.values()) clearInterval(timer);
      pollTimers.current.clear();
    };
  }, [integrations, runPoll]);

  // ── CRUD ───────────────────────────────────────────────────────────────────

  const addIntegration = useCallback((templateId: string, config: Record<string, string>): Integration => {
    const tpl = INTEGRATION_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) throw new Error(`Unknown template: ${templateId}`);

    const int: Integration = {
      id: generateId(),
      name: config._name || tpl.name,
      type: tpl.type,
      status: "pending",
      config,
      icon: tpl.icon,
      color: tpl.color,
      category: tpl.category,
      lastSync: null,
      eventCount: 0,
      createdAt: Date.now(),
      enabled: true,
      pollIntervalMs: tpl.defaultPollIntervalMs ?? null,
      webhookSecret: tpl.webhookUrl ? generateWebhookSecret() : null,
    };

    setIntegrations(prev => [...prev, int]);
    return int;
  }, []);

  const removeIntegration = useCallback((id: string) => {
    setIntegrations(prev => prev.filter(i => i.id !== id));
    setEvents(prev => prev.filter(e => e.integrationId !== id));
    if (pollTimers.current.has(id)) {
      clearInterval(pollTimers.current.get(id)!);
      pollTimers.current.delete(id);
    }
  }, []);

  const updateIntegration = useCallback((id: string, updates: Partial<Integration>) => {
    setIntegrations(prev =>
      prev.map(i => (i.id === id ? { ...i, ...updates } : i))
    );
  }, []);

  const toggleIntegration = useCallback((id: string) => {
    setIntegrations(prev =>
      prev.map(i =>
        i.id === id
          ? { ...i, enabled: !i.enabled, status: !i.enabled ? "pending" : "disconnected" }
          : i
      )
    );
  }, []);

  // ── Test connection ────────────────────────────────────────────────────────

  const testIntegration = useCallback(async (id: string): Promise<boolean> => {
    const int = integrations.find(i => i.id === id);
    if (!int) return false;

    setIntegrations(prev =>
      prev.map(i => (i.id === id ? { ...i, status: "pending" } : i))
    );

    // Simulate connection test (in production, would hit actual endpoints)
    await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));

    const hasRequiredFields = INTEGRATION_TEMPLATES
      .find(t => t.id.replace("-", "") === int.icon || t.name === int.name)
      ?.configFields.filter(f => f.required)
      .every(f => int.config[f.key]?.trim());

    const success = hasRequiredFields !== false;

    setIntegrations(prev =>
      prev.map(i =>
        i.id === id ? { ...i, status: success ? "connected" : "error", lastSync: success ? Date.now() : i.lastSync } : i
      )
    );

    return success;
  }, [integrations]);

  // ── Events ─────────────────────────────────────────────────────────────────

  const getEvents = useCallback((integrationId?: string, limit = 50): WebhookEvent[] => {
    let filtered = events;
    if (integrationId) filtered = filtered.filter(e => e.integrationId === integrationId);
    return filtered.slice(0, limit);
  }, [events]);

  const processEvent = useCallback((eventId: string): string => {
    const evt = events.find(e => e.id === eventId);
    if (!evt) return "";

    // Mark as processed
    setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, processed: true } : e)));

    // Build a summary prompt for the AI
    const int = integrations.find(i => i.id === evt.integrationId);
    const serviceName = int?.name ?? "Unknown";

    let payloadPreview = evt.payload;
    try {
      const parsed = JSON.parse(evt.payload);
      payloadPreview = JSON.stringify(parsed, null, 2).slice(0, 2048);
    } catch { /* leave as-is */ }

    const prompt = [
      `Analyze this ${serviceName} webhook event (type: ${evt.type}):`,
      "```json",
      payloadPreview,
      "```",
      "Provide a concise summary of what happened and suggest any follow-up actions.",
    ].join("\n");

    return prompt;
  }, [events, integrations]);

  const addEvent = useCallback((integrationId: string, type: string, payload: string) => {
    const evt: WebhookEvent = {
      id: generateId(),
      integrationId,
      type,
      payload,
      timestamp: Date.now(),
      processed: false,
      summary: null,
    };
    setEvents(prev => [evt, ...prev].slice(0, MAX_EVENTS));
    setIntegrations(prev =>
      prev.map(i =>
        i.id === integrationId ? { ...i, eventCount: i.eventCount + 1, lastSync: Date.now() } : i
      )
    );
  }, []);

  const clearEvents = useCallback((integrationId?: string) => {
    if (integrationId) {
      setEvents(prev => prev.filter(e => e.integrationId !== integrationId));
    } else {
      setEvents([]);
    }
  }, []);

  const getWebhookUrl = useCallback((integrationId: string): string | null => {
    const int = integrations.find(i => i.id === integrationId);
    if (!int || !int.webhookSecret) return null;
    return generateWebhookUrl(integrationId);
  }, [integrations]);

  // ── Derived stats ──────────────────────────────────────────────────────────

  const connectedCount = integrations.filter(i => i.status === "connected" && i.enabled).length;
  const errorCount = integrations.filter(i => i.status === "error").length;
  const totalEvents = events.length;

  return {
    integrations,
    events,
    templates: INTEGRATION_TEMPLATES,
    connectedCount,
    errorCount,
    totalEvents,
    addIntegration,
    removeIntegration,
    updateIntegration,
    toggleIntegration,
    testIntegration,
    getEvents,
    processEvent,
    addEvent,
    clearEvents,
    getWebhookUrl,
  };
}

export type IntegrationsState = ReturnType<typeof useIntegrations>;
