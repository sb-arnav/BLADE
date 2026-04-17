import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ───────────────────────────────────────────────────────────

export interface Email {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: number;
  read: boolean;
  starred: boolean;
  labels: string[];
}

export interface EmailDraft {
  to: string;
  subject: string;
  body: string;
  replyToId?: string;
}

export interface EmailConfig {
  provider: "gmail" | "outlook" | "imap";
  connected: boolean;
  email: string;
  lastSync: number | null;
}

interface EmailThread {
  id: string;
  subject: string;
  emails: Email[];
  participants: string[];
}

// ── Constants ───────────────────────────────────────────────────────

const CONFIG_KEY = "blade-email-config";
const DRAFTS_KEY = "blade-email-drafts";

// ── Mock data for demo / preview mode ───────────────────────────────

const MOCK_EMAILS: Email[] = [
  {
    id: "mock-1",
    from: "alice@example.com",
    to: "you@blade.dev",
    subject: "Q2 planning sync — agenda items",
    body: "Hey,\n\nHere are the agenda items I'd like to cover in our Q2 planning sync:\n\n1. Roadmap priorities\n2. Headcount discussion\n3. Tech debt backlog review\n4. OKR alignment\n\nLet me know if you want to add anything before Thursday.\n\nBest,\nAlice",
    date: Date.now() - 2 * 60 * 60 * 1000,
    read: false,
    starred: true,
    labels: ["work", "planning"],
  },
  {
    id: "mock-2",
    from: "bob@startup.io",
    to: "you@blade.dev",
    subject: "Re: API integration feedback",
    body: "Thanks for the detailed feedback on the API integration. I've filed tickets for the rate-limiting changes and the auth header format.\n\nWe should have a patch release out by Friday. I'll send the changelog once it's tagged.\n\nCheers,\nBob",
    date: Date.now() - 5 * 60 * 60 * 1000,
    read: true,
    starred: false,
    labels: ["engineering"],
  },
  {
    id: "mock-3",
    from: "notifications@github.com",
    to: "you@blade.dev",
    subject: "[blade-app] PR #247: Add email assistant hook",
    body: "arnav requested your review on PR #247.\n\n---\n\nAdds the useEmailAgent hook with full inbox management, search, and AI-drafted replies.\n\n+312 -0 in 2 files\n\nView on GitHub: https://github.com/blade-app/blade/pull/247",
    date: Date.now() - 8 * 60 * 60 * 1000,
    read: false,
    starred: false,
    labels: ["github"],
  },
  {
    id: "mock-4",
    from: "carol@design.co",
    to: "you@blade.dev",
    subject: "Updated mockups for settings redesign",
    body: "Hi!\n\nAttached are the updated mockups incorporating your feedback from last week. Main changes:\n\n- Simplified the sidebar navigation\n- Added the accent color picker to the appearance tab\n- Reduced spacing in the keybindings section\n\nLet me know your thoughts.\n\nCarol",
    date: Date.now() - 24 * 60 * 60 * 1000,
    read: true,
    starred: true,
    labels: ["design"],
  },
  {
    id: "mock-5",
    from: "dave@infra.dev",
    to: "you@blade.dev",
    subject: "Incident postmortem — March 28 outage",
    body: "Team,\n\nPostmortem for the March 28 outage is now published in Confluence. Root cause was a misconfigured autoscaling rule that triggered during the traffic spike.\n\nAction items are assigned — please review and update your items by EOD Friday.\n\nDave",
    date: Date.now() - 3 * 24 * 60 * 60 * 1000,
    read: true,
    starred: false,
    labels: ["infra", "incident"],
  },
  {
    id: "mock-6",
    from: "eve@product.io",
    to: "you@blade.dev",
    subject: "Feature request: email integration in Blade",
    body: "Hey there,\n\nA few enterprise customers have asked about native email integration. They want to:\n\n- Read and triage inbox from Blade\n- Use AI to draft responses\n- Search across email threads\n\nCould we scope this for the next sprint? Happy to set up a call.\n\nEve",
    date: Date.now() - 5 * 24 * 60 * 60 * 1000,
    read: true,
    starred: false,
    labels: ["product", "feature-request"],
  },
];

// ── Persistence helpers ─────────────────────────────────────────────

function loadConfig(): EmailConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveConfig(config: EmailConfig | null) {
  if (config) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } else {
    localStorage.removeItem(CONFIG_KEY);
  }
}

function loadDrafts(): EmailDraft[] {
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDrafts(drafts: EmailDraft[]) {
  localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

// ── Hook ────────────────────────────────────────────────────────────

export function useEmailAgent() {
  const [config, setConfig] = useState<EmailConfig | null>(() => loadConfig());
  const [emails, setEmails] = useState<Email[]>([]);
  const [drafts, setDrafts] = useState<EmailDraft[]>(() => loadDrafts());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailsRef = useRef(emails);

  useEffect(() => {
    emailsRef.current = emails;
  }, [emails]);

  // Persist config changes
  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // Persist drafts
  useEffect(() => {
    saveDrafts(drafts);
  }, [drafts]);

  // Load mock data when not connected (demo mode)
  useEffect(() => {
    if (!config?.connected) {
      setEmails(MOCK_EMAILS);
    }
  }, [config?.connected]);

  // ── Connection management ───────────────────────────────────────

  const connect = useCallback(
    async (
      provider: EmailConfig["provider"],
      credentials: { email: string; password?: string; token?: string }
    ) => {
      setLoading(true);
      setError(null);

      try {
        await invoke("email_connect", { provider, credentials });

        const newConfig: EmailConfig = {
          provider,
          connected: true,
          email: credentials.email,
          lastSync: Date.now(),
        };
        setConfig(newConfig);
      } catch (err) {
        // Backend command may not exist yet — save config optimistically
        const newConfig: EmailConfig = {
          provider,
          connected: true,
          email: credentials.email,
          lastSync: null,
        };
        setConfig(newConfig);
        setError(err instanceof Error ? err.message : "Connection saved (backend pending)");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const disconnect = useCallback(() => {
    setConfig(null);
    setEmails(MOCK_EMAILS);
    setError(null);
  }, []);

  // ── Inbox operations ────────────────────────────────────────────

  const fetchInbox = useCallback(
    async (limit: number = 50) => {
      if (!config?.connected) return;

      setLoading(true);
      setError(null);

      try {
        const result = await invoke<Email[]>("email_fetch_inbox", { limit });
        setEmails(result);
        setConfig((prev) => (prev ? { ...prev, lastSync: Date.now() } : prev));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch inbox");
        // Keep existing emails on failure
      } finally {
        setLoading(false);
      }
    },
    [config?.connected]
  );

  const searchEmails = useCallback(
    async (query: string): Promise<Email[]> => {
      if (!query.trim()) return emailsRef.current;

      // If connected, try backend search first
      if (config?.connected) {
        try {
          const result = await invoke<Email[]>("email_search", { query });
          return result;
        } catch {
          // Fall through to local search
        }
      }

      // Local search fallback
      const q = query.toLowerCase();
      return emailsRef.current.filter(
        (email) =>
          email.subject.toLowerCase().includes(q) ||
          email.from.toLowerCase().includes(q) ||
          email.body.toLowerCase().includes(q) ||
          email.labels.some((l) => l.toLowerCase().includes(q))
      );
    },
    [config?.connected]
  );

  // ── AI drafting ─────────────────────────────────────────────────

  const draftReply = useCallback(
    async (emailId: string, prompt: string): Promise<EmailDraft> => {
      const email = emailsRef.current.find((e) => e.id === emailId);
      if (!email) throw new Error("Email not found");

      try {
        const result = await invoke<EmailDraft>("email_draft_reply", {
          emailId,
          prompt,
          context: {
            from: email.from,
            subject: email.subject,
            body: email.body,
          },
        });
        const draft: EmailDraft = { ...result, replyToId: emailId };
        setDrafts((prev) => [...prev, draft]);
        return draft;
      } catch {
        // Generate a placeholder draft when backend is unavailable
        const draft: EmailDraft = {
          to: email.from,
          subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
          body: `[AI Draft — prompt: "${prompt}"]\n\nHi ${email.from.split("@")[0]},\n\nThank you for your email. ${prompt}\n\nBest regards`,
          replyToId: emailId,
        };
        setDrafts((prev) => [...prev, draft]);
        return draft;
      }
    },
    []
  );

  const sendDraft = useCallback(
    async (draft: EmailDraft) => {
      setLoading(true);
      setError(null);

      try {
        await invoke("email_send", { draft });
        setDrafts((prev) => prev.filter((d) => d !== draft));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send email");
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ── Email actions ───────────────────────────────────────────────

  const starEmail = useCallback((id: string) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, starred: !e.starred } : e))
    );
    invoke("email_star", { id }).catch(() => {});
  }, []);

  const markRead = useCallback((id: string) => {
    setEmails((prev) =>
      prev.map((e) => (e.id === id ? { ...e, read: true } : e))
    );
    invoke("email_mark_read", { id }).catch(() => {});
  }, []);

  const getThread = useCallback(
    async (emailId: string): Promise<EmailThread> => {
      try {
        return await invoke<EmailThread>("email_get_thread", { emailId });
      } catch {
        // Build a mock thread from local data
        const email = emailsRef.current.find((e) => e.id === emailId);
        if (!email) throw new Error("Email not found");

        return {
          id: emailId,
          subject: email.subject,
          emails: [email],
          participants: [email.from, email.to],
        };
      }
    },
    []
  );

  // ── Draft management ────────────────────────────────────────────

  const addDraft = useCallback((draft: EmailDraft) => {
    setDrafts((prev) => [...prev, draft]);
  }, []);

  const removeDraft = useCallback((index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateDraft = useCallback((index: number, updates: Partial<EmailDraft>) => {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, ...updates } : d))
    );
  }, []);

  // ── Computed values ─────────────────────────────────────────────

  const unreadCount = useMemo(
    () => emails.filter((e) => !e.read).length,
    [emails]
  );

  const starredEmails = useMemo(
    () => emails.filter((e) => e.starred),
    [emails]
  );

  const isDemo = !config?.connected;

  return {
    // State
    config,
    emails,
    drafts,
    loading,
    error,
    unreadCount,
    starredEmails,
    isDemo,

    // Connection
    connect,
    disconnect,

    // Inbox
    fetchInbox,
    searchEmails,

    // AI
    draftReply,

    // Sending
    sendDraft,

    // Actions
    starEmail,
    markRead,
    getThread,

    // Draft management
    addDraft,
    removeDraft,
    updateDraft,
  };
}
