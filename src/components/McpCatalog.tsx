// McpCatalog — one-click MCP integration marketplace.
// The JARVIS lever: connect Blade to your entire work stack.
// Each card installs the MCP server, configures env, registers tools.

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  // How to run: "npx" | "uvx" | "node" | "python"
  runtime: "npx" | "uvx" | "node" | "python";
  package: string;
  args: string[];
  // Env vars the user needs to provide
  envVars: { key: string; label: string; placeholder: string; url?: string }[];
  docsUrl?: string;
  badge?: string;
}

const CATALOG: CatalogEntry[] = [
  // ── Productivity ──────────────────────────────────────────────────────────
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read/write events, schedule meetings, check availability. Blade briefs you before every meeting.",
    icon: "📅",
    category: "Productivity",
    runtime: "npx",
    package: "@modelcontextprotocol/server-google-calendar",
    args: [],
    envVars: [
      { key: "GOOGLE_CLIENT_ID", label: "Google Client ID", placeholder: "xxx.apps.googleusercontent.com" },
      { key: "GOOGLE_CLIENT_SECRET", label: "Client Secret", placeholder: "GOCSPX-..." },
      { key: "GOOGLE_REFRESH_TOKEN", label: "Refresh Token", placeholder: "1//..." },
    ],
    badge: "🔥 BLADE",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Read, search, draft, and send emails. Blade handles your inbox.",
    icon: "📧",
    category: "Productivity",
    runtime: "npx",
    package: "@modelcontextprotocol/server-gmail",
    args: [],
    envVars: [
      { key: "GOOGLE_CLIENT_ID", label: "Google Client ID", placeholder: "xxx.apps.googleusercontent.com" },
      { key: "GOOGLE_CLIENT_SECRET", label: "Client Secret", placeholder: "GOCSPX-..." },
      { key: "GOOGLE_REFRESH_TOKEN", label: "Refresh Token", placeholder: "1//..." },
    ],
    badge: "🔥 BLADE",
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read channels, send messages, manage threads. Blade stays in the loop.",
    icon: "💬",
    category: "Productivity",
    runtime: "npx",
    package: "@modelcontextprotocol/server-slack",
    args: [],
    envVars: [
      { key: "SLACK_BOT_TOKEN", label: "Slack Bot Token", placeholder: "xoxb-...", url: "https://api.slack.com/apps" },
      { key: "SLACK_TEAM_ID", label: "Team ID (optional)", placeholder: "T01234..." },
    ],
    badge: "🔥 BLADE",
  },
  {
    id: "notion",
    name: "Notion",
    description: "Read and write pages, databases, and docs. Your second brain, fully accessible.",
    icon: "📝",
    category: "Productivity",
    runtime: "npx",
    package: "@modelcontextprotocol/server-notion",
    args: [],
    envVars: [
      { key: "NOTION_API_KEY", label: "Notion API Key", placeholder: "secret_...", url: "https://www.notion.so/my-integrations" },
    ],
  },
  {
    id: "linear",
    name: "Linear",
    description: "Manage issues, projects, and cycles. Blade tracks what's in progress.",
    icon: "⚡",
    category: "Productivity",
    runtime: "npx",
    package: "@linear/mcp-server",
    args: [],
    envVars: [
      { key: "LINEAR_API_KEY", label: "Linear API Key", placeholder: "lin_api_...", url: "https://linear.app/settings/api" },
    ],
  },

  // ── Engineering ───────────────────────────────────────────────────────────
  {
    id: "github",
    name: "GitHub",
    description: "Read repos, issues, PRs. Create branches, comment, merge. Blade runs your dev workflow.",
    icon: "🐙",
    category: "Engineering",
    runtime: "npx",
    package: "@modelcontextprotocol/server-github",
    args: [],
    envVars: [
      { key: "GITHUB_PERSONAL_ACCESS_TOKEN", label: "GitHub PAT", placeholder: "ghp_...", url: "https://github.com/settings/tokens" },
    ],
    badge: "🔥 BLADE",
  },
  {
    id: "gitlab",
    name: "GitLab",
    description: "Issues, MRs, pipelines — full GitLab access for self-hosted or cloud.",
    icon: "🦊",
    category: "Engineering",
    runtime: "npx",
    package: "@modelcontextprotocol/server-gitlab",
    args: [],
    envVars: [
      { key: "GITLAB_PERSONAL_ACCESS_TOKEN", label: "GitLab PAT", placeholder: "glpat-...", url: "https://gitlab.com/-/user_settings/personal_access_tokens" },
      { key: "GITLAB_URL", label: "GitLab URL (optional)", placeholder: "https://gitlab.com" },
    ],
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    description: "Query your database directly from conversation. Blade runs your SQL.",
    icon: "🐘",
    category: "Engineering",
    runtime: "npx",
    package: "@modelcontextprotocol/server-postgres",
    args: ["$DATABASE_URL"],
    envVars: [
      { key: "DATABASE_URL", label: "Database URL", placeholder: "postgresql://user:pass@host/db" },
    ],
  },
  {
    id: "filesystem",
    name: "Extended Filesystem",
    description: "Advanced file operations beyond native tools — directory watching, bulk ops.",
    icon: "📂",
    category: "Engineering",
    runtime: "npx",
    package: "@modelcontextprotocol/server-filesystem",
    args: ["$HOME"],
    envVars: [],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Manage databases, auth, storage, edge functions. Full Supabase control.",
    icon: "⚡",
    category: "Engineering",
    runtime: "npx",
    package: "@supabase/mcp-server-supabase",
    args: [],
    envVars: [
      { key: "SUPABASE_ACCESS_TOKEN", label: "Supabase Access Token", placeholder: "sbp_...", url: "https://supabase.com/dashboard/account/tokens" },
    ],
  },

  // ── Research & Data ───────────────────────────────────────────────────────
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Real-time web search with no rate limits. Blade stays current.",
    icon: "🔍",
    category: "Research",
    runtime: "npx",
    package: "@modelcontextprotocol/server-brave-search",
    args: [],
    envVars: [
      { key: "BRAVE_API_KEY", label: "Brave API Key", placeholder: "BSA...", url: "https://api.search.brave.com/app/keys" },
    ],
  },
  {
    id: "fetch",
    name: "Web Fetch",
    description: "Fetch and convert web pages to Markdown. Deep web reading for Blade.",
    icon: "🌐",
    category: "Research",
    runtime: "npx",
    package: "@modelcontextprotocol/server-fetch",
    args: [],
    envVars: [],
    badge: "no key needed",
  },

  // ── Finance ───────────────────────────────────────────────────────────────
  {
    id: "stripe",
    name: "Stripe",
    description: "Query payments, customers, subscriptions. Blade knows your MRR.",
    icon: "💳",
    category: "Finance",
    runtime: "npx",
    package: "@stripe/agent-toolkit",
    args: [],
    envVars: [
      { key: "STRIPE_SECRET_KEY", label: "Stripe Secret Key", placeholder: "sk_live_...", url: "https://dashboard.stripe.com/apikeys" },
    ],
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(CATALOG.map((e) => e.category)))];

interface EnvValues {
  [key: string]: string;
}

interface Props {
  onInstalled?: (name: string, toolCount: number) => void;
}

export function McpCatalog({ onInstalled }: Props) {
  const [category, setCategory] = useState("All");
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<CatalogEntry | null>(null);
  const [envValues, setEnvValues] = useState<EnvValues>({});
  const [search, setSearch] = useState("");

  const filtered = CATALOG.filter((e) => {
    const matchCat = category === "All" || e.category === category;
    const matchSearch = !search || e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const startInstall = (entry: CatalogEntry) => {
    if (entry.envVars.length === 0) {
      doInstall(entry, {});
      return;
    }
    setConfiguring(entry);
    setEnvValues({});
    setError(null);
  };

  const doInstall = async (entry: CatalogEntry, env: EnvValues) => {
    setInstalling(entry.id);
    setError(null);
    try {
      // Substitute env var references in args
      const resolvedArgs = entry.args.map((arg) =>
        arg.startsWith("$") ? (env[arg.slice(1)] ?? arg) : arg
      );

      // Map runtime to command
      let command: string;
      let args: string[];
      if (entry.runtime === "npx") {
        command = "npx";
        args = ["-y", entry.package, ...resolvedArgs];
      } else if (entry.runtime === "uvx") {
        command = "uvx";
        args = [entry.package, ...resolvedArgs];
      } else {
        command = entry.runtime;
        args = [entry.package, ...resolvedArgs];
      }

      const toolCount = await invoke<number>("mcp_install_catalog_server", {
        name: entry.name,
        command,
        args,
        env,
      });

      setInstalled((prev) => new Set([...prev, entry.id]));
      setConfiguring(null);
      onInstalled?.(entry.name, toolCount);
    } catch (e) {
      setError(String(e));
    } finally {
      setInstalling(null);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 space-y-3 border-b border-blade-border/30">
        <div>
          <h2 className="text-sm font-semibold">Integrations</h2>
          <p className="text-[11px] text-blade-muted mt-0.5">Connect Blade to your work stack. One click, full access.</p>
        </div>
        <input
          type="text"
          placeholder="Search integrations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-xs bg-blade-surface border border-blade-border rounded-lg focus:outline-none focus:border-blade-accent/50 placeholder:text-blade-muted"
        />
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap transition-colors ${
                category === cat
                  ? "bg-blade-accent text-white"
                  : "bg-blade-surface text-blade-muted hover:text-blade-text border border-blade-border"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Catalog grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {filtered.map((entry) => {
          const isInstalled = installed.has(entry.id);
          const isInstalling = installing === entry.id;

          return (
            <div
              key={entry.id}
              className={`p-3 rounded-xl border transition-colors ${
                isInstalled
                  ? "border-blade-accent/30 bg-blade-accent/5"
                  : "border-blade-border bg-blade-surface/30 hover:bg-blade-surface/60"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl flex-shrink-0 mt-0.5">{entry.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-blade-text">{entry.name}</span>
                    {entry.badge && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blade-accent/15 text-blade-accent font-medium">
                        {entry.badge}
                      </span>
                    )}
                    <span className="text-[9px] text-blade-muted px-1 py-0.5 rounded bg-blade-surface border border-blade-border/50">
                      {entry.category}
                    </span>
                  </div>
                  <p className="text-[10px] text-blade-muted mt-0.5 leading-relaxed">{entry.description}</p>
                  <p className="text-[9px] text-blade-muted/60 mt-1 font-mono">{entry.runtime} {entry.package}</p>
                </div>
                <button
                  onClick={() => isInstalled ? null : startInstall(entry)}
                  disabled={isInstalling || isInstalled}
                  className={`px-3 py-1.5 rounded-lg text-[10px] font-medium flex-shrink-0 transition-all ${
                    isInstalled
                      ? "bg-blade-accent/15 text-blade-accent cursor-default"
                      : isInstalling
                      ? "bg-blade-surface border border-blade-border text-blade-muted cursor-wait"
                      : "bg-blade-accent text-white hover:opacity-90"
                  }`}
                >
                  {isInstalled ? "✓ Connected" : isInstalling ? "Installing..." : "Connect"}
                </button>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-blade-muted text-xs">
            No integrations found for "{search}"
          </div>
        )}
      </div>

      {/* Env config modal */}
      {configuring && (
        <div className="absolute inset-0 bg-blade-bg/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-blade-surface border border-blade-border rounded-2xl p-5 w-full max-w-sm space-y-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{configuring.icon}</span>
              <div>
                <h3 className="text-sm font-semibold">{configuring.name}</h3>
                <p className="text-[10px] text-blade-muted">Enter your credentials to connect</p>
              </div>
            </div>

            <div className="space-y-3">
              {configuring.envVars.map((envVar) => (
                <div key={envVar.key}>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] font-medium text-blade-secondary">{envVar.label}</label>
                    {envVar.url && (
                      <a
                        href={envVar.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-blade-accent hover:opacity-70"
                        onClick={(e) => { e.preventDefault(); invoke("auto_open_url", { url: envVar.url }); }}
                      >
                        Get key →
                      </a>
                    )}
                  </div>
                  <input
                    type="password"
                    placeholder={envVar.placeholder}
                    value={envValues[envVar.key] ?? ""}
                    onChange={(e) => setEnvValues((prev) => ({ ...prev, [envVar.key]: e.target.value }))}
                    className="w-full px-3 py-2 text-xs bg-blade-bg border border-blade-border rounded-lg focus:outline-none focus:border-blade-accent/50 placeholder:text-blade-muted font-mono"
                  />
                </div>
              ))}
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setConfiguring(null); setError(null); }}
                className="flex-1 px-3 py-2 rounded-xl border border-blade-border text-blade-muted text-xs hover:text-blade-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => doInstall(configuring, envValues)}
                disabled={installing !== null || configuring.envVars.some((v) => !envValues[v.key]?.trim())}
                className="flex-1 px-3 py-2 rounded-xl bg-blade-accent text-white text-xs font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {installing ? "Connecting..." : `Connect ${configuring.name}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
