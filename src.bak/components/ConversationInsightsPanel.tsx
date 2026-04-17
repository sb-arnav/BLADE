import { Message } from "../types";
import { useConversationInsights, ConversationInsights } from "../hooks/useConversationInsights";

interface Props {
  messages: Message[];
  open: boolean;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 60000) return "< 1m";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

function StatCard({ label, value, sublabel }: { label: string; value: string | number; sublabel?: string }) {
  return (
    <div className="bg-blade-bg rounded-xl border border-blade-border px-3 py-2.5">
      <div className="text-2xs uppercase tracking-wider text-blade-muted">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
      {sublabel && <div className="text-2xs text-blade-muted/60 mt-0.5">{sublabel}</div>}
    </div>
  );
}

function SentimentBadge({ sentiment }: { sentiment: ConversationInsights["sentiment"] }) {
  const colors = {
    positive: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    neutral: "bg-blade-surface text-blade-muted border-blade-border",
    negative: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  const icons = { positive: "↑", neutral: "→", negative: "↓" };

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-2xs border ${colors[sentiment]}`}>
      {icons[sentiment]} {sentiment}
    </span>
  );
}

function ComplexityBadge({ complexity }: { complexity: ConversationInsights["complexity"] }) {
  const colors = {
    simple: "bg-blade-accent-muted text-blade-accent",
    moderate: "bg-amber-500/10 text-amber-400",
    complex: "bg-violet-500/10 text-violet-400",
  };
  const bars = { simple: 1, moderate: 2, complex: 3 };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-2xs ${colors[complexity]}`}>
      <span className="flex items-end gap-0.5 h-2.5">
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            className={`w-0.5 rounded-full ${i <= bars[complexity] ? "bg-current" : "bg-current/20"}`}
            style={{ height: `${i * 33}%` }}
          />
        ))}
      </span>
      {complexity}
    </span>
  );
}

function TopicPills({ topics }: { topics: string[] }) {
  if (topics.length === 0) return <span className="text-2xs text-blade-muted/50">No strong topics detected</span>;

  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((topic) => (
        <span
          key={topic}
          className="px-2 py-0.5 rounded-full text-2xs bg-blade-accent-muted text-blade-accent border border-blade-accent/10"
        >
          {topic}
        </span>
      ))}
    </div>
  );
}

function LanguagePills({ languages }: { languages: string[] }) {
  if (languages.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {languages.map((lang) => (
        <span
          key={lang}
          className="px-2 py-0.5 rounded-full text-2xs bg-blade-surface text-blade-secondary border border-blade-border font-mono"
        >
          {lang}
        </span>
      ))}
    </div>
  );
}

function WordBar({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-2xs text-blade-muted">{label}</span>
        <span className="text-2xs text-blade-secondary font-mono">{count.toLocaleString()}</span>
      </div>
      <div className="h-1.5 bg-blade-border/50 rounded-full overflow-hidden">
        <div
          className="h-full bg-blade-accent rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function ConversationInsightsPanel({ messages, open, onClose }: Props) {
  const insights = useConversationInsights(messages);

  if (!open) return null;

  const maxWords = Math.max(insights.userWords, insights.assistantWords, 1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-blade-surface border border-blade-border rounded-2xl p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto animate-fade-in mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold">Conversation Insights</h2>
            <p className="text-2xs text-blade-muted mt-0.5">{insights.totalMessages} messages analyzed</p>
          </div>
          <button
            onClick={onClose}
            className="text-blade-muted hover:text-blade-secondary transition-colors"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {messages.length === 0 ? (
          <div className="text-center py-8 text-blade-muted text-xs">
            Start a conversation to see insights.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Total Words" value={insights.totalWords.toLocaleString()} />
              <StatCard label="Duration" value={formatDuration(insights.duration)} />
              <StatCard
                label="Pace"
                value={insights.messagesPerMinute || "—"}
                sublabel="msg/min"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <StatCard
                label="Code Blocks"
                value={insights.codeBlockCount}
                sublabel={insights.languages.length > 0 ? insights.languages.slice(0, 3).join(", ") : undefined}
              />
              <StatCard
                label="Images"
                value={insights.imageCount}
                sublabel="screenshots shared"
              />
            </div>

            {/* Badges */}
            <div className="flex items-center gap-2">
              <SentimentBadge sentiment={insights.sentiment} />
              <ComplexityBadge complexity={insights.complexity} />
            </div>

            {/* Word distribution */}
            <div className="bg-blade-bg rounded-xl border border-blade-border p-3 space-y-2">
              <div className="text-2xs uppercase tracking-wider text-blade-muted mb-2">Word Distribution</div>
              <WordBar label="You" count={insights.userWords} max={maxWords} />
              <WordBar label="Blade" count={insights.assistantWords} max={maxWords} />
              <div className="flex justify-between text-2xs text-blade-muted/50 pt-1">
                <span>Avg you: {insights.averageUserLength}w/msg</span>
                <span>Avg Blade: {insights.averageAssistantLength}w/msg</span>
              </div>
            </div>

            {/* Topics */}
            <div>
              <div className="text-2xs uppercase tracking-wider text-blade-muted mb-2">Topics</div>
              <TopicPills topics={insights.topTopics} />
            </div>

            {/* Languages */}
            {insights.languages.length > 0 && (
              <div>
                <div className="text-2xs uppercase tracking-wider text-blade-muted mb-2">Languages Used</div>
                <LanguagePills languages={insights.languages} />
              </div>
            )}

            {/* Longest message */}
            {insights.longestMessage && (
              <div className="bg-blade-bg rounded-xl border border-blade-border p-3">
                <div className="text-2xs uppercase tracking-wider text-blade-muted">Longest Message</div>
                <div className="text-xs text-blade-secondary mt-1">
                  {insights.longestMessage.role === "user" ? "You" : "Blade"} — {insights.longestMessage.words.toLocaleString()} words
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
