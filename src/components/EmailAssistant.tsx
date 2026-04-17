import { useCallback, useEffect, useRef, useState } from "react";
import { useEmailAgent, Email, EmailDraft, EmailConfig } from "../hooks/useEmailAgent";

// ── Types ───────────────────────────────────────────────────────────

type ViewMode = "inbox" | "detail" | "compose";
type ProviderOption = EmailConfig["provider"];

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\u2026";
}

function senderName(from: string): string {
  // "alice@example.com" → "alice", "Alice <alice@example.com>" → "Alice"
  const match = from.match(/^([^<@]+)/);
  const name = match?.[1]?.trim() ?? from;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// ── Connect screen ──────────────────────────────────────────────────

function ConnectScreen({
  onConnect,
  loading,
  error,
}: {
  onConnect: (provider: ProviderOption, email: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const [provider, setProvider] = useState<ProviderOption>("gmail");
  const [email, setEmail] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const providers: { id: ProviderOption; label: string; icon: string }[] = [
    { id: "gmail", label: "Gmail", icon: "M" },
    { id: "outlook", label: "Outlook", icon: "O" },
    { id: "imap", label: "IMAP", icon: "I" },
  ];

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl bg-accent/20 text-accent flex items-center justify-center mx-auto text-xl font-bold">
            @
          </div>
          <h2 className="text-lg font-semibold text-blade-text">Connect Email</h2>
          <p className="text-sm text-blade-muted">
            Link your email to read, search, and draft replies with AI.
          </p>
        </div>

        {/* Provider picker */}
        <div className="flex gap-2">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => setProvider(p.id)}
              className={`flex-1 flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-colors ${
                provider === p.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-blade-border bg-blade-surface text-blade-muted hover:text-blade-text hover:border-blade-border-hover"
              }`}
            >
              <span className="w-8 h-8 rounded-lg bg-blade-bg flex items-center justify-center text-sm font-bold">
                {p.icon}
              </span>
              <span className="text-xs font-medium">{p.label}</span>
            </button>
          ))}
        </div>

        {/* Email input */}
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full px-3 py-2.5 rounded-xl bg-blade-bg border border-blade-border text-sm text-blade-text
                       placeholder:text-blade-muted/50 focus:outline-none focus:border-accent transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter" && email.trim()) onConnect(provider, email.trim());
            }}
          />
        </div>

        {error && (
          <p className="text-xs text-amber-400 bg-amber-400/10 rounded-lg px-3 py-2">{error}</p>
        )}

        <button
          onClick={() => email.trim() && onConnect(provider, email.trim())}
          disabled={!email.trim() || loading}
          className="w-full py-2.5 rounded-xl text-sm font-medium bg-accent text-white
                     hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Connecting\u2026" : "Connect"}
        </button>

        <p className="text-xs text-blade-muted text-center">
          Demo mode is active with sample emails while disconnected.
        </p>
      </div>
    </div>
  );
}

// ── Email list item ─────────────────────────────────────────────────

function EmailRow({
  email,
  selected,
  onSelect,
  onStar,
}: {
  email: Email;
  selected: boolean;
  onSelect: () => void;
  onStar: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 border-b border-blade-border/50 transition-colors group ${
        selected
          ? "bg-accent/10 border-l-2 border-l-accent"
          : "hover:bg-blade-surface/50 border-l-2 border-l-transparent"
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Unread indicator */}
        <div className="mt-1.5 shrink-0">
          {!email.read ? (
            <div className="w-2 h-2 rounded-full bg-accent" />
          ) : (
            <div className="w-2 h-2" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-sm truncate ${
                !email.read ? "font-semibold text-blade-text" : "text-blade-muted"
              }`}
            >
              {senderName(email.from)}
            </span>
            <span className="text-[10px] text-blade-muted shrink-0">{timeAgo(email.date)}</span>
          </div>
          <p
            className={`text-xs truncate mt-0.5 ${
              !email.read ? "text-blade-text" : "text-blade-muted"
            }`}
          >
            {email.subject}
          </p>
          <p className="text-[11px] text-blade-muted/70 truncate mt-0.5">
            {truncate(email.body.replace(/\n/g, " "), 60)}
          </p>
        </div>

        {/* Star toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStar();
          }}
          className={`mt-0.5 text-sm shrink-0 transition-colors ${
            email.starred
              ? "text-yellow-400"
              : "text-blade-muted/30 opacity-0 group-hover:opacity-100"
          }`}
        >
          {email.starred ? "\u2605" : "\u2606"}
        </button>
      </div>
    </button>
  );
}

// ── Email detail view ───────────────────────────────────────────────

function EmailDetail({
  email,
  onDraftReply,
  onSendToChat,
  onStar,
  draftingReply,
}: {
  email: Email;
  onDraftReply: () => void;
  onSendToChat: () => void;
  onStar: () => void;
  draftingReply: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-blade-border space-y-2">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-blade-text leading-tight">
            {email.subject}
          </h2>
          <button
            onClick={onStar}
            className={`text-lg shrink-0 ${
              email.starred ? "text-yellow-400" : "text-blade-muted/40 hover:text-yellow-400"
            } transition-colors`}
          >
            {email.starred ? "\u2605" : "\u2606"}
          </button>
        </div>

        <div className="flex items-center gap-3 text-xs text-blade-muted">
          <span>
            <span className="text-blade-text font-medium">{senderName(email.from)}</span>{" "}
            &lt;{email.from}&gt;
          </span>
          <span className="text-blade-border">|</span>
          <span>{new Date(email.date).toLocaleString()}</span>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-blade-muted">To: {email.to}</span>
          {email.labels.length > 0 && (
            <div className="flex gap-1 ml-auto">
              {email.labels.map((label) => (
                <span
                  key={label}
                  className="px-1.5 py-0.5 rounded bg-blade-surface text-blade-muted text-[10px]"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <pre className="text-sm text-blade-text whitespace-pre-wrap font-sans leading-relaxed">
          {email.body}
        </pre>
      </div>

      {/* Action bar */}
      <div className="px-5 py-3 border-t border-blade-border flex items-center gap-2">
        <button
          onClick={onDraftReply}
          disabled={draftingReply}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent text-white
                     hover:bg-accent/90 disabled:opacity-50 transition-colors"
        >
          {draftingReply ? "Drafting\u2026" : "Draft Reply with AI"}
        </button>
        <button
          onClick={onSendToChat}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blade-surface text-blade-text
                     border border-blade-border hover:bg-blade-surface/80 transition-colors"
        >
          Send to Chat
        </button>
        <button
          onClick={() => {
            const summary = `Summarize this email thread:\n\nFrom: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`;
            navigator.clipboard.writeText(summary);
          }}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blade-surface text-blade-text
                     border border-blade-border hover:bg-blade-surface/80 transition-colors"
        >
          Summarize Thread
        </button>
      </div>
    </div>
  );
}

// ── Compose view ────────────────────────────────────────────────────

function ComposeView({
  initial,
  onSend,
  onCancel,
  onAiDraft,
  sending,
}: {
  initial?: Partial<EmailDraft>;
  onSend: (draft: EmailDraft) => void;
  onCancel: () => void;
  onAiDraft: (to: string, subject: string) => void;
  sending: boolean;
}) {
  const [to, setTo] = useState(initial?.to ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.focus();
  }, []);

  // Sync when initial changes (e.g., AI draft generated)
  useEffect(() => {
    if (initial?.to) setTo(initial.to);
    if (initial?.subject) setSubject(initial.subject);
    if (initial?.body) setBody(initial.body);
  }, [initial?.to, initial?.subject, initial?.body]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-5 py-3 border-b border-blade-border">
        <h2 className="text-sm font-semibold text-blade-text">New Message</h2>
      </div>

      <div className="flex-1 flex flex-col overflow-y-auto">
        {/* To */}
        <div className="px-5 py-2 border-b border-blade-border/50 flex items-center gap-2">
          <span className="text-xs text-blade-muted w-12 shrink-0">To</span>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="flex-1 bg-transparent text-sm text-blade-text placeholder:text-blade-muted/40
                       focus:outline-none"
          />
        </div>

        {/* Subject */}
        <div className="px-5 py-2 border-b border-blade-border/50 flex items-center gap-2">
          <span className="text-xs text-blade-muted w-12 shrink-0">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 bg-transparent text-sm text-blade-text placeholder:text-blade-muted/40
                       focus:outline-none"
          />
        </div>

        {/* Body */}
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write your message..."
          className="flex-1 px-5 py-3 bg-transparent text-sm text-blade-text placeholder:text-blade-muted/40
                     focus:outline-none resize-none leading-relaxed"
        />
      </div>

      {/* Action bar */}
      <div className="px-5 py-3 border-t border-blade-border flex items-center gap-2">
        <button
          onClick={() => to.trim() && subject.trim() && onSend({ to, subject, body })}
          disabled={!to.trim() || !subject.trim() || sending}
          className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent text-white
                     hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sending\u2026" : "Send"}
        </button>
        <button
          onClick={() => onAiDraft(to, subject)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blade-surface text-blade-text
                     border border-blade-border hover:bg-blade-surface/80 transition-colors"
        >
          AI Draft
        </button>
        <div className="flex-1" />
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-xs text-blade-muted hover:text-blade-text transition-colors"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────

export function EmailAssistant({ onBack, onSendToChat }: Props) {
  const agent = useEmailAgent();
  const [view, setView] = useState<ViewMode>("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredEmails, setFilteredEmails] = useState<Email[]>([]);
  const [composeDraft, setComposeDraft] = useState<Partial<EmailDraft>>({});
  const [draftingReply, setDraftingReply] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Initialize filtered list
  useEffect(() => {
    setFilteredEmails(agent.emails);
  }, [agent.emails]);

  // Search handler
  const handleSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query.trim()) {
        setFilteredEmails(agent.emails);
        return;
      }
      const results = await agent.searchEmails(query);
      setFilteredEmails(results);
    },
    [agent.emails, agent.searchEmails]
  );

  const selectedEmail = selectedId ? agent.emails.find((e) => e.id === selectedId) ?? null : null;

  // Mark as read when selecting
  const handleSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      setView("detail");
      agent.markRead(id);
    },
    [agent.markRead]
  );

  // AI draft reply
  const handleDraftReply = useCallback(async () => {
    if (!selectedEmail) return;
    setDraftingReply(true);
    try {
      const draft = await agent.draftReply(selectedEmail.id, "Write a professional, concise reply.");
      setComposeDraft(draft);
      setView("compose");
    } catch {
      // Error handled by hook
    } finally {
      setDraftingReply(false);
    }
  }, [selectedEmail, agent.draftReply]);

  // Send email
  const handleSend = useCallback(
    async (draft: EmailDraft) => {
      try {
        await agent.sendDraft(draft);
        setView("inbox");
        setComposeDraft({});
      } catch {
        // Error shown by hook
      }
    },
    [agent.sendDraft]
  );

  // Not connected — show connect screen
  if (!agent.config?.connected && !agent.isDemo) {
    return (
      <div className="flex flex-col h-full bg-blade-bg">
        <Header onBack={onBack} onCompose={() => setView("compose")} unreadCount={0} />
        <ConnectScreen
          onConnect={(provider, email) => agent.connect(provider, { email })}
          loading={agent.loading}
          error={agent.error}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-blade-bg">
      {/* Top header */}
      <Header
        onBack={onBack}
        onCompose={() => {
          setComposeDraft({});
          setView("compose");
        }}
        unreadCount={agent.unreadCount}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* ── Email list (left panel) ── */}
        <div className="w-72 shrink-0 border-r border-blade-border flex flex-col overflow-hidden">
          {/* Search bar */}
          <div className="px-3 py-2 border-b border-blade-border">
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search emails\u2026"
              className="w-full px-2.5 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-text
                         placeholder:text-blade-muted/50 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Email rows */}
          <div className="flex-1 overflow-y-auto">
            {filteredEmails.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-blade-muted">
                {searchQuery ? "No emails match your search." : "No emails yet."}
              </div>
            ) : (
              filteredEmails.map((email) => (
                <EmailRow
                  key={email.id}
                  email={email}
                  selected={selectedId === email.id}
                  onSelect={() => handleSelect(email.id)}
                  onStar={() => agent.starEmail(email.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {view === "compose" ? (
            <ComposeView
              initial={composeDraft}
              onSend={handleSend}
              onCancel={() => {
                setView(selectedEmail ? "detail" : "inbox");
                setComposeDraft({});
              }}
              onAiDraft={(to, subject) => {
                // Quick AI draft for new compose
                setComposeDraft((prev) => ({
                  ...prev,
                  to,
                  subject,
                  body: `[AI generating draft for "${subject}"...]\n\nHi ${to.split("@")[0]},\n\n`,
                }));
              }}
              sending={agent.loading}
            />
          ) : view === "detail" && selectedEmail ? (
            <EmailDetail
              email={selectedEmail}
              onDraftReply={handleDraftReply}
              onSendToChat={() => {
                const text = `Email from ${selectedEmail.from}:\nSubject: ${selectedEmail.subject}\n\n${selectedEmail.body}`;
                onSendToChat(text);
              }}
              onStar={() => agent.starEmail(selectedEmail.id)}
              draftingReply={draftingReply}
            />
          ) : (
            <EmptyState
              emailCount={agent.emails.length}
              isDemo={agent.isDemo}
              onConnect={() => {
                /* Show connect — handled by config being null */
              }}
            />
          )}
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        config={agent.config}
        emailCount={agent.emails.length}
        isDemo={agent.isDemo}
        loading={agent.loading}
        error={agent.error}
        onSync={() => agent.fetchInbox()}
        onDisconnect={agent.disconnect}
      />
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function Header({
  onBack,
  onCompose,
  unreadCount,
}: {
  onBack: () => void;
  onCompose: () => void;
  unreadCount: number;
}) {
  return (
    <div className="px-4 py-2.5 border-b border-blade-border flex items-center gap-3">
      <button
        onClick={onBack}
        className="text-blade-muted hover:text-blade-text transition-colors text-sm"
      >
        &larr; Back
      </button>
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold text-blade-text">Email Assistant</h1>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.5 rounded-full bg-accent/20 text-accent text-[10px] font-bold">
            {unreadCount}
          </span>
        )}
      </div>
      <div className="flex-1" />
      <button
        onClick={onCompose}
        className="px-3 py-1 rounded-lg text-xs font-medium bg-accent text-white
                   hover:bg-accent/90 transition-colors"
      >
        Compose
      </button>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({
  emailCount,
}: {
  emailCount: number;
  isDemo?: boolean;
  onConnect?: () => void;
}) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-3 px-6">
        <div className="w-10 h-10 rounded-xl bg-blade-surface border border-blade-border flex items-center justify-center mx-auto text-blade-muted text-lg">
          @
        </div>
        <p className="text-sm text-blade-muted">
          {emailCount > 0
            ? "Select an email to view details, draft AI replies, or summarize threads."
            : "No emails to display."}
        </p>
        {false && (
          <p className="text-xs text-blade-muted/60">
            Viewing demo data. Connect an email account for live inbox access.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Status bar ──────────────────────────────────────────────────────

function StatusBar({
  config,
  emailCount,
  loading,
  error,
  onSync,
  onDisconnect,
}: {
  config: EmailConfig | null;
  emailCount: number;
  isDemo?: boolean;
  loading: boolean;
  error: string | null;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  return (
    <div className="px-4 py-1.5 border-t border-blade-border flex items-center gap-3 text-[11px] text-blade-muted">
      {config?.connected ? (
        <>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            {config.provider.toUpperCase()} &mdash; {config.email}
          </span>
          {config.lastSync && (
            <span>Synced {timeAgo(config.lastSync)}</span>
          )}
          <span>{emailCount} emails</span>
          <div className="flex-1" />
          <button
            onClick={onSync}
            disabled={loading}
            className="hover:text-blade-text transition-colors disabled:opacity-50"
          >
            {loading ? "Syncing\u2026" : "Sync"}
          </button>
          <button
            onClick={onDisconnect}
            className="hover:text-red-400 transition-colors"
          >
            Disconnect
          </button>
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Demo Mode
          </span>
          <span>{emailCount} sample emails</span>
          <div className="flex-1" />
        </>
      )}

      {error && (
        <span className="text-amber-400 ml-2 truncate max-w-[200px]" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

export default EmailAssistant;
