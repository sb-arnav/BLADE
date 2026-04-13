import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { BladeConfig } from "../types";
import { McpSettings } from "./McpSettings";
import { McpCatalog } from "./McpCatalog";
import { TelegramBridge } from "./TelegramBridge";
import { DiscordBridge } from "./DiscordBridge";
import { WatcherPanel } from "./WatcherPanel";
import { RemindersPanel } from "./RemindersPanel";
import { SkillsPanel } from "./SkillsPanel";

type SettingsTab = "provider" | "memory" | "mcp" | "integrations" | "about" | "privacy" | "evolution";

interface EvolutionLevel {
  level: number;
  score: number;
  breakdown: string[];
  next_unlock: string | null;
}

interface EvolutionSuggestion {
  id: string;
  name: string;
  package: string;
  description: string;
  trigger_app: string;
  required_token_hint: string | null;
  auto_install: boolean;
  status: string;
  created_at: number;
}

interface ProviderEntry {
  id: string;
  name: string;
  model: string;
  baseUrl?: string;
  badges: string[];
  keyPlaceholder?: string;
}

// Every provider that speaks OpenAI-compatible format routes through
// providers/openai.rs automatically when base_url is set.
const PROVIDER_MATRIX: ProviderEntry[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    model: "gemini-2.0-flash",
    badges: ["fast", "tools", "good default"],
    keyPlaceholder: "AIza...",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    model: "claude-sonnet-4-20250514",
    badges: ["tools", "strong reasoning", "careful"],
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    name: "OpenAI",
    model: "gpt-4o-mini",
    badges: ["tools", "reliable", "multi-modal"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "groq",
    name: "Groq",
    model: "llama-3.3-70b-versatile",
    badges: ["very fast", "tools", "cheap"],
    keyPlaceholder: "gsk_...",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    model: "anthropic/claude-sonnet-4-5",
    badges: ["200+ models", "one key", "frontier access"],
    keyPlaceholder: "sk-or-v1-...",
  },
  {
    id: "openai",
    name: "Nvidia NIM",
    model: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    badges: ["free tier", "Llama/Mistral/MiniMax", "OpenAI-compat"],
    keyPlaceholder: "nvapi-...",
  },
  {
    id: "openai",
    name: "DeepSeek",
    model: "deepseek-chat",
    baseUrl: "https://api.deepseek.com/v1",
    badges: ["cheap", "strong coding", "OpenAI-compat"],
    keyPlaceholder: "sk-...",
  },
  {
    id: "openai",
    name: "xAI Grok",
    model: "grok-3-mini",
    baseUrl: "https://api.x.ai/v1",
    badges: ["Elon's AI", "fast", "OpenAI-compat"],
    keyPlaceholder: "xai-...",
  },
  {
    id: "openai",
    name: "MiniMax",
    model: "MiniMax-Text-01",
    baseUrl: "https://api.minimax.io/v1",
    badges: ["long context", "cheap", "OpenAI-compat"],
    keyPlaceholder: "eyJ...",
  },
  {
    id: "openai",
    name: "Mistral",
    model: "mistral-small-latest",
    baseUrl: "https://api.mistral.ai/v1",
    badges: ["EU-hosted", "tools", "OpenAI-compat"],
    keyPlaceholder: "...",
  },
  {
    id: "openai",
    name: "Together AI",
    model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    baseUrl: "https://api.together.xyz/v1",
    badges: ["open models", "cheap", "OpenAI-compat"],
    keyPlaceholder: "...",
  },
  {
    id: "openai",
    name: "Perplexity",
    model: "sonar-pro",
    baseUrl: "https://api.perplexity.ai",
    badges: ["web search built-in", "OpenAI-compat"],
    keyPlaceholder: "pplx-...",
  },
  {
    id: "openai",
    name: "Fireworks AI",
    model: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    badges: ["fast inference", "cheap", "OpenAI-compat"],
    keyPlaceholder: "fw-...",
  },
  {
    id: "openai",
    name: "Cohere",
    model: "command-r-plus",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    badges: ["enterprise RAG", "OpenAI-compat"],
    keyPlaceholder: "...",
  },
  {
    id: "openai",
    name: "GitHub Copilot",
    model: "claude-sonnet-4-5",
    baseUrl: "https://api.githubcopilot.com",
    badges: ["Claude + GPT-4o + Gemini", "one subscription", "OpenAI-compat"],
    keyPlaceholder: "ghp_... or ghu_...",
  },
  {
    id: "openai",
    name: "Azure OpenAI",
    model: "gpt-4o",
    baseUrl: "https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT",
    badges: ["enterprise", "private", "OpenAI-compat"],
    keyPlaceholder: "Azure API key",
  },
  {
    id: "ollama",
    name: "Ollama — Hermes 3",
    model: "hermes3",
    badges: ["local", "no api key", "best tool-calling", "agent-optimised"],
  },
  {
    id: "ollama",
    name: "Ollama",
    model: "llama3.2",
    badges: ["local", "offline", "no api key"],
  },
  {
    id: "openai",
    name: "Custom",
    model: "",
    baseUrl: "",
    badges: ["any OpenAI-compat endpoint"],
    keyPlaceholder: "your-api-key",
  },
];

interface Props {
  config: BladeConfig;
  onBack: () => void;
  onSaved: (config: BladeConfig) => void;
  onConfigRefresh: () => Promise<void>;
}

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "evolution", label: "Evolution" },
  { id: "provider", label: "Provider" },
  { id: "integrations", label: "Integrations" },
  { id: "memory", label: "Memory" },
  { id: "mcp", label: "MCP" },
  { id: "privacy", label: "Privacy" },
  { id: "about", label: "About" },
];

// Find the best matching provider entry for existing config
function matchProviderEntry(cfg: { provider: string; model: string; base_url?: string }): ProviderEntry | null {
  // Custom base_url — try to find by base_url first, then by name
  if (cfg.base_url) {
    const byUrl = PROVIDER_MATRIX.find(
      (p) => p.baseUrl && cfg.base_url && p.baseUrl.startsWith(cfg.base_url.split("/v1")[0])
    );
    if (byUrl) return byUrl;
  }
  // Native provider match
  return PROVIDER_MATRIX.find(
    (p) => p.id === cfg.provider && !p.baseUrl && cfg.provider !== "openai"
  ) ?? PROVIDER_MATRIX.find((p) => p.id === cfg.provider) ?? null;
}

// Providers that need a key
const KEY_PROVIDERS = [
  { id: "anthropic", label: "Anthropic (Claude)", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI (GPT)", placeholder: "sk-..." },
  { id: "openrouter", label: "OpenRouter (200+ models)", placeholder: "sk-or-v1-..." },
  { id: "gemini", label: "Google Gemini", placeholder: "AIza..." },
  { id: "groq", label: "Groq (Llama)", placeholder: "gsk_..." },
];

// ── Pentest Panel ─────────────────────────────────────────────────────────────

interface PentestAuth {
  target: string;
  target_type: string;
  ownership_claim: string;
  scope_notes: string;
  confirmed_at: number;
  session_id: string;
}

function PentestPanel() {
  const [auths, setAuths] = useState<PentestAuth[]>([]);
  const [modelSafety, setModelSafety] = useState<{ safe: boolean; provider: string; model: string; warning?: string } | null>(null);

  const load = () => {
    invoke<PentestAuth[]>("pentest_list_auth").then(setAuths).catch(() => {});
    invoke<{ safe: boolean; provider: string; model: string; warning?: string }>("pentest_check_model_safety")
      .then(setModelSafety).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleRevoke = async (target: string) => {
    await invoke("pentest_revoke", { target }).catch(() => {});
    load();
  };

  const now = Math.floor(Date.now() / 1000);

  const typeLabel: Record<string, string> = { ip: "IP", domain: "Domain", range: "Range", description: "Description" };
  const claimLabel: Record<string, string> = { owner: "Owned", authorized: "Authorized", bug_bounty: "Bug Bounty", ctf: "CTF" };

  if (auths.length === 0 && !modelSafety) {
    return <p className="text-blade-muted text-xs">No active pentest authorizations. Ask BLADE to authorize a target to begin.</p>;
  }

  return (
    <div className="space-y-2">
      {modelSafety && (
        <div className={`flex items-start gap-2 p-2 rounded-lg text-xs ${modelSafety.safe ? "bg-green-500/10 border border-green-500/20" : "bg-yellow-500/10 border border-yellow-500/20"}`}>
          <span>{modelSafety.safe ? "✓" : "⚠"}</span>
          <div>
            <span className={modelSafety.safe ? "text-green-400" : "text-yellow-400"}>
              {modelSafety.safe ? `Pentest provider: ${modelSafety.provider}/${modelSafety.model}` : modelSafety.warning}
            </span>
          </div>
        </div>
      )}
      {auths.map((auth) => {
        const expiresIn = 86400 - (now - auth.confirmed_at);
        const hoursLeft = Math.max(0, Math.floor(expiresIn / 3600));
        const minsLeft = Math.max(0, Math.floor((expiresIn % 3600) / 60));
        const expired = expiresIn <= 0;
        return (
          <div key={auth.session_id} className={`flex items-start gap-2 p-2 rounded-lg border ${expired ? "opacity-50 border-blade-border/30" : "border-blade-border/50"} bg-blade-bg`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-blade-secondary">{auth.target}</span>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent/15 text-blade-accent">{typeLabel[auth.target_type] ?? auth.target_type}</span>
                <span className="text-2xs px-1.5 py-0.5 rounded bg-blade-surface text-blade-muted">{claimLabel[auth.ownership_claim] ?? auth.ownership_claim}</span>
              </div>
              {auth.scope_notes && <p className="text-2xs text-blade-muted mt-0.5 truncate">{auth.scope_notes}</p>}
              <p className="text-2xs text-blade-muted/50 mt-0.5">
                {expired ? "Expired" : `Expires in ${hoursLeft}h ${minsLeft}m`}
              </p>
            </div>
            <button onClick={() => handleRevoke(auth.target)} className="text-blade-muted/50 hover:text-red-400 text-xs transition-colors flex-shrink-0">Revoke</button>
          </div>
        );
      })}
      {auths.length === 0 && (
        <p className="text-blade-muted text-xs">No active authorizations. Ask BLADE: "authorize pentest on [target]" to begin.</p>
      )}
    </div>
  );
}

// ── Cron Panel ────────────────────────────────────────────────────────────────

interface CronTask {
  id: string;
  name: string;
  description: string;
  schedule: { kind: string; time_of_day?: number; day_of_week?: number; interval_secs?: number };
  action: { kind: string; content: string; agent_type?: string; cwd?: string };
  enabled: boolean;
  last_run?: number;
  next_run: number;
  run_count: number;
  created_at: number;
}

function formatSchedule(s: CronTask["schedule"]): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const t = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  if (s.kind === "daily") return s.time_of_day !== undefined ? `Daily at ${t(s.time_of_day)}` : "Daily";
  if (s.kind === "weekly") {
    const day = s.day_of_week !== undefined ? days[s.day_of_week] : "?";
    return s.time_of_day !== undefined ? `Every ${day} at ${t(s.time_of_day)}` : `Every ${day}`;
  }
  if (s.kind === "hourly") return "Every hour";
  if (s.kind === "interval" && s.interval_secs !== undefined) {
    return s.interval_secs < 3600 ? `Every ${Math.round(s.interval_secs / 60)} min` : `Every ${Math.round(s.interval_secs / 3600)}h`;
  }
  return s.kind;
}

function CronPanel() {
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [actionKind, setActionKind] = useState<"bash" | "message" | "spawn_agent">("bash");
  const [actionPayload, setActionPayload] = useState("");
  const [cwd, setCwd] = useState("");
  const [saving, setSaving] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);

  const load = () => {
    invoke<CronTask[]>("cron_list").then(setTasks).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async () => {
    if (!name.trim() || !schedule.trim() || !actionPayload.trim()) return;
    setSaving(true);
    setCronError(null);
    try {
      await invoke("cron_add", {
        name: name.trim(),
        description: name.trim(),
        scheduleText: schedule.trim(),
        actionKind,
        actionContent: actionPayload.trim(),
        actionCwd: cwd.trim() || null,
        actionAgentType: actionKind === "spawn_agent" ? "claude" : null,
      });
      setAdding(false);
      setName(""); setSchedule(""); setActionPayload(""); setCwd("");
      load();
    } catch (e) {
      setCronError(typeof e === "string" ? e : "Invalid schedule — try: 'daily at 9am', 'every hour', 'every monday at 3pm'");
    }
    setSaving(false);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await invoke("cron_toggle", { id, enabled: !enabled }).catch(() => {});
    load();
  };

  const handleDelete = async (id: string) => {
    await invoke("cron_delete", { id }).catch(() => {});
    load();
  };

  return (
    <div>
      {tasks.length === 0 && !adding && (
        <p className="text-blade-muted text-xs mb-2">No scheduled tasks yet.</p>
      )}
      <div className="space-y-1.5 mb-2">
        {tasks.map((task) => {
          const nextDt = new Date(task.next_run * 1000);
          const nextStr = nextDt.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <div key={task.id} className="flex items-start gap-2 p-2 rounded-lg bg-blade-bg border border-blade-border/50">
              <button
                onClick={() => handleToggle(task.id, task.enabled)}
                className={`mt-0.5 w-7 h-3.5 rounded-full flex-shrink-0 relative transition-colors ${task.enabled ? "bg-blade-accent" : "bg-blade-border"}`}
              >
                <span className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-all ${task.enabled ? "left-3.5" : "left-0.5"}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-blade-secondary truncate">{task.name}</span>
                  <span className="text-2xs text-blade-muted/60 flex-shrink-0">{formatSchedule(task.schedule)}</span>
                </div>
                <p className="text-2xs text-blade-muted truncate mt-0.5">{task.action.content}</p>
                <p className="text-2xs text-blade-muted/40 mt-0.5">next: {nextStr} · ran {task.run_count}×</p>
              </div>
              <button onClick={() => handleDelete(task.id)} className="text-blade-muted/50 hover:text-red-400 text-xs transition-colors flex-shrink-0">×</button>
            </div>
          );
        })}
      </div>

      {adding ? (
        <div className="border border-blade-border/50 rounded-lg p-3 space-y-2 bg-blade-bg/50">
          <input
            className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text placeholder:text-blade-muted"
            placeholder="Task name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <input
            className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text placeholder:text-blade-muted"
            placeholder="Schedule: every day at 9am, every Monday at 10am, every 30 minutes…"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
          <select
            className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text"
            value={actionKind}
            onChange={(e) => setActionKind(e.target.value as typeof actionKind)}
          >
            <option value="bash">Run shell command</option>
            <option value="message">Send me a message</option>
            <option value="spawn_agent">Spawn AI agent</option>
          </select>
          <textarea
            className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text placeholder:text-blade-muted resize-none h-14"
            placeholder={actionKind === "bash" ? "git pull && npm run build" : actionKind === "message" ? "Good morning! Check your GitHub notifications." : "Refactor all console.log calls to use the logger utility"}
            value={actionPayload}
            onChange={(e) => setActionPayload(e.target.value)}
          />
          {actionKind !== "message" && (
            <input
              className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text placeholder:text-blade-muted"
              placeholder="Working directory (optional)"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
            />
          )}
          {cronError && (
            <p className="text-2xs text-red-400 bg-red-500/8 border border-red-500/15 rounded-lg px-2.5 py-1.5">{cronError}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setAdding(false); setName(""); setSchedule(""); setActionPayload(""); setCronError(null); }} className="text-xs text-blade-muted hover:text-blade-secondary px-3 py-1 transition-colors">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={saving || !name.trim() || !schedule.trim() || !actionPayload.trim()}
              className="text-xs px-3 py-1 rounded-lg bg-blade-accent text-white hover:bg-blade-accent/90 disabled:opacity-40 transition-colors"
            >
              {saving ? "Saving…" : "Schedule"}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blade-accent hover:text-blade-accent/80 transition-colors">
          + Add scheduled task
        </button>
      )}
    </div>
  );
}

function KeyVault({ activeProvider }: { activeProvider: string }) {
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  useEffect(() => {
    invoke<{ providers: Array<{ provider: string; has_key: boolean; masked: string; is_active: boolean }> }>(
      "get_all_provider_keys"
    ).then((res) => {
      const init: Record<string, string> = {};
      for (const p of res.providers) {
        init[p.provider] = p.masked;
      }
      setKeys(init);
    }).catch(() => {});
  }, [activeProvider]);

  const handleStore = async (providerId: string) => {
    const key = keys[providerId] ?? "";
    if (!key.trim() || key.includes("...")) return; // don't re-save masked or empty value
    try {
      await invoke("store_provider_key", { provider: providerId, apiKey: key.trim() });
      setSaved((s) => ({ ...s, [providerId]: true }));
      setTimeout(() => setSaved((s) => ({ ...s, [providerId]: false })), 2000);
    } catch {}
  };

  return (
    <div className="space-y-2">
      {KEY_PROVIDERS.map((p) => {
        const isActive = p.id === activeProvider;
        const val = keys[p.id] ?? "";
        const isMasked = val.includes("...");
        return (
          <div key={p.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${isActive ? "border-blade-accent/40 bg-blade-accent/5" : "border-blade-border"}`}>
            <div className="w-28 flex-shrink-0">
              <p className="text-xs text-blade-secondary leading-tight">{p.label}</p>
              {isActive && <p className="text-[9px] text-blade-accent">active</p>}
            </div>
            <input
              type="password"
              value={val}
              onChange={(e) => setKeys((k) => ({ ...k, [p.id]: e.target.value }))}
              onFocus={() => { if (isMasked) setKeys((k) => ({ ...k, [p.id]: "" })); }}
              placeholder={p.placeholder}
              className="flex-1 min-w-0 bg-blade-bg border border-blade-border rounded-lg px-2 py-1.5 text-xs outline-none font-mono"
            />
            <button
              onClick={() => handleStore(p.id)}
              disabled={!val || isMasked}
              className="text-xs px-2 py-1 rounded-lg bg-blade-surface border border-blade-border hover:border-blade-muted transition-colors disabled:opacity-30"
            >
              {saved[p.id] ? "✓" : "Store"}
            </button>
          </div>
        );
      })}
      <p className="text-2xs text-blade-muted">All keys stored in OS keychain. BLADE uses the right key for each task automatically — Anthropic for chat, Groq/Ollama for pentest mode.</p>
    </div>
  );
}

interface TaskRouting {
  code?: string | null;
  vision?: string | null;
  fast?: string | null;
  creative?: string | null;
  fallback?: string | null;
}

const ROUTING_TASKS = [
  { key: "code" as const, label: "Code & debugging", hint: "Claude / GPT-4o excel here" },
  { key: "vision" as const, label: "Screenshots & images", hint: "Gemini Flash is cheap + good" },
  { key: "fast" as const, label: "Quick replies", hint: "Groq is 10× faster for simple asks" },
  { key: "creative" as const, label: "Writing & brainstorming", hint: "Any strong model works" },
  { key: "fallback" as const, label: "Fallback (when primary fails)", hint: "Retried automatically on rate-limit or outage" },
];

const ROUTABLE_PROVIDERS = [
  { id: "", label: "— Active provider —" },
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "openrouter", label: "OpenRouter (200+ models)" },
  { id: "gemini", label: "Google Gemini" },
  { id: "groq", label: "Groq (Llama — fast)" },
  { id: "ollama", label: "Ollama / Hermes 3 (local, private)" },
];

function RoutingPanel() {
  const [routing, setRouting] = useState<TaskRouting>({});
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    invoke<TaskRouting>("get_task_routing").then(setRouting).catch(() => {});
  }, []);

  const update = (key: keyof TaskRouting, value: string) => {
    const next = { ...routing, [key]: value || null };
    setRouting(next);
    invoke("set_task_routing", { routing: next })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 1500); })
      .catch(() => {});
  };

  return (
    <div className="space-y-2">
      {ROUTING_TASKS.map((task) => (
        <div key={task.key} className="flex items-center gap-3 rounded-xl border border-blade-border px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-blade-text">{task.label}</div>
            <div className="text-[10px] text-blade-muted/60">{task.hint}</div>
          </div>
          <select
            value={routing[task.key] ?? ""}
            onChange={(e) => update(task.key, e.target.value)}
            className="text-xs bg-blade-bg border border-blade-border rounded-lg px-2 py-1 outline-none text-blade-text"
          >
            {ROUTABLE_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
      ))}
      {saved && <p className="text-[10px] text-green-400">Saved</p>}
      <p className="text-[10px] text-blade-muted/50">
        Routing uses stored keys. The brain/soul context is injected regardless — BLADE stays coherent across providers.
      </p>
    </div>
  );
}

export function Settings({ config, onBack, onSaved, onConfigRefresh }: Props) {
  const [tab, setTab] = useState<SettingsTab>("evolution");
  const [evolutionLevel, setEvolutionLevel] = useState<EvolutionLevel | null>(null);
  const [evolutionSuggestions, setEvolutionSuggestions] = useState<EvolutionSuggestion[]>([]);
  const [evolutionRunning, setEvolutionRunning] = useState(false);
  const [suggestionTokens, setSuggestionTokens] = useState<Record<string, string>>({});
  const [researchEntries, setResearchEntries] = useState<Array<{ id: number; query: string; results: string; source: string; created_at: number }>>([]);
  const [researchQuery, setResearchQuery] = useState("");
  const [researchRunning, setResearchRunning] = useState(false);
  const [provider, setProvider] = useState(config.provider);
  const [apiKey, setApiKey] = useState(config.api_key);
  const [model, setModel] = useState(config.model);
  const [baseUrl, setBaseUrl] = useState(config.base_url ?? "");
  const [selectedEntry, setSelectedEntry] = useState<ProviderEntry | null>(
    () => matchProviderEntry(config)
  );
  const [godModeTier, setGodModeTier] = useState<string>(
    config.god_mode ? (config.god_mode_tier ?? "normal") : "off"
  );
  const [voiceMode, setVoiceMode] = useState(config.voice_mode ?? "off");
  const [ttsVoice, setTtsVoice] = useState(config.tts_voice ?? "system");
  const [quickAskShortcut, setQuickAskShortcut] = useState(config.quick_ask_shortcut ?? "Alt+Space");
  const [voiceShortcut, setVoiceShortcut] = useState(config.voice_shortcut ?? "Ctrl+Shift+V");
  const [shortcutStatus, setShortcutStatus] = useState<string | null>(null);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const [ttsVoices, setTtsVoices] = useState<Array<{ id: string; label: string; description: string; provider: string }>>([]);
  const [obsidianVaultPath, setObsidianVaultPath] = useState(config.obsidian_vault_path ?? "");
  const [persona, setPersona] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("dev");
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [bladeSourcePath, setBladeSourcePath] = useState(config.blade_source_path ?? "");
  const [jitroGoal, setJitroGoal] = useState("");
  const [jitroRunning, setJitroRunning] = useState(false);
  const [jitroStatus, setJitroStatus] = useState<string | null>(null);
  const [timelineEnabled, setTimelineEnabled] = useState(config.screen_timeline_enabled ?? false);
  const [timelineInterval, setTimelineInterval] = useState(config.timeline_capture_interval ?? 30);
  const [timelineRetention, setTimelineRetention] = useState(config.timeline_retention_days ?? 14);
  const [aiDelegate, setAiDelegate] = useState(config.trusted_ai_delegate ?? "");
  const [delegateCheckResult, setDelegateCheckResult] = useState<{ available: boolean } | null>(null);
  const [introduceStatus, setIntroduceStatus] = useState<string | null>(null);

  useEffect(() => {
    setProvider(config.provider);
    setApiKey(config.api_key);
    setModel(config.model);
    setBaseUrl(config.base_url ?? "");
    setGodModeTier(config.god_mode ? (config.god_mode_tier ?? "normal") : "off");
    setVoiceMode(config.voice_mode ?? "off");
    setTtsVoice(config.tts_voice ?? "system");
    setQuickAskShortcut(config.quick_ask_shortcut ?? "Alt+Space");
    setVoiceShortcut(config.voice_shortcut ?? "Ctrl+Shift+V");
    setObsidianVaultPath(config.obsidian_vault_path ?? "");
    setTimelineEnabled(config.screen_timeline_enabled ?? false);
    setTimelineInterval(config.timeline_capture_interval ?? 30);
    setTimelineRetention(config.timeline_retention_days ?? 14);
    setAiDelegate(config.trusted_ai_delegate ?? "");
  }, [config]);

  // Load evolution data whenever the tab is visible
  useEffect(() => {
    if (tab !== "evolution") return;
    const load = async () => {
      try {
        const [level, suggestions, research] = await Promise.all([
          invoke<EvolutionLevel>("evolution_get_level"),
          invoke<EvolutionSuggestion[]>("evolution_get_suggestions"),
          invoke<Array<{ id: number; query: string; results: string; source: string; created_at: number }>>("research_get_recent", { limit: 8 }),
        ]);
        setEvolutionLevel(level);
        setEvolutionSuggestions(suggestions);
        setResearchEntries(research);
      } catch {
        // non-fatal
      }
    };
    load();
  }, [tab]);

  useEffect(() => {
    const loadBrain = async () => {
      try {
        const [nextPersona, nextContext, nextVersion] = await Promise.all([
          invoke<string>("get_persona"),
          invoke<string>("get_context"),
          getVersion().catch(() => "dev"),
        ]);
        setPersona(nextPersona);
        setContextNotes(nextContext);
        setAppVersion(nextVersion);
      } catch (cause) {
        setError(typeof cause === "string" ? cause : String(cause));
      }
    };

    loadBrain();
  }, []);

  // Load TTS voices on mount
  useEffect(() => {
    invoke<Array<{ id: string; label: string; description: string; provider: string }>>("tts_list_voices")
      .then(setTtsVoices)
      .catch(() => {});
  }, []);

  const handleSaveShortcuts = async () => {
    setShortcutStatus("Saving shortcuts...");
    setShortcutError(null);
    try {
      await invoke("update_shortcuts", {
        quickAsk: quickAskShortcut,
        voice: voiceShortcut,
      });
      setShortcutStatus("Shortcuts saved. Active immediately.");
    } catch (cause) {
      setShortcutStatus(null);
      setShortcutError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleTest = async () => {
    setStatus("Testing connection...");
    setError(null);

    try {
      const result = await invoke<string>("test_provider", { provider, apiKey, model, baseUrl: baseUrl || null });
      setStatus(`Connected: ${result}`);
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleSave = async () => {
    setStatus("Saving settings...");
    setError(null);

    try {
      const godModeEnabled = godModeTier !== "off";
      const godModeTierVal = godModeEnabled ? godModeTier : "normal";
      await invoke("set_config", {
        provider, apiKey, model, baseUrl: baseUrl || null,
        godMode: godModeEnabled, godModeTier: godModeTierVal,
        voiceMode, obsidianVaultPath: obsidianVaultPath || null,
      });
      const nextConfig: BladeConfig = {
        ...config,
        provider,
        api_key: apiKey,
        model,
        base_url: baseUrl || undefined,
        god_mode: godModeEnabled,
        god_mode_tier: godModeTierVal,
        voice_mode: voiceMode,
        obsidian_vault_path: obsidianVaultPath || undefined,
        tts_voice: ttsVoice,
        quick_ask_shortcut: quickAskShortcut,
        voice_shortcut: voiceShortcut,
        onboarded: true,
      };
      setStatus("Settings saved.");
      onSaved(nextConfig);
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleSaveBrain = async () => {
    setStatus("Saving Blade memory...");
    setError(null);

    try {
      await Promise.all([
        invoke("set_persona", { content: persona }),
        invoke("set_context", { content: contextNotes }),
      ]);
      setStatus("Blade memory saved.");
    } catch (cause) {
      setStatus(null);
      setError(typeof cause === "string" ? cause : String(cause));
    }
  };

  const handleCheckForUpdates = async () => {
    setCheckingForUpdates(true);
    setUpdateError(null);
    setUpdateStatus("Checking for updates...");

    try {
      const update = await check();

      if (!update) {
        setUpdateStatus("You're up to date.");
        return;
      }

      setUpdateStatus(`Downloading Blade ${update.version}...`);
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          const contentLength = event.data.contentLength;
          setUpdateStatus(
            contentLength
              ? `Downloading update (${Math.round(contentLength / 1024 / 1024)} MB)...`
              : "Downloading update...",
          );
        }

        if (event.event === "Progress") {
          setUpdateStatus(`Downloading update... +${Math.round(event.data.chunkLength / 1024)} KB`);
        }

        if (event.event === "Finished") {
          setUpdateStatus("Installing update...");
        }
      });

      setUpdateStatus(`Blade ${update.version} is ready. Restart to finish updating.`);
    } catch (cause) {
      setUpdateStatus(null);
      const msg = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : String(cause);
      // Provide a more actionable message for the common "can't fetch JSON" case
      if (msg.includes("valid release JSON") || msg.includes("fetch")) {
        setUpdateError(`Update check failed: ${msg}. This can happen right after a release is published — try again in a minute, or download directly from github.com/sb-arnav/blade/releases`);
      } else {
        setUpdateError(msg);
      }
    } finally {
      setCheckingForUpdates(false);
    }
  };

  const handleRestartForUpdate = async () => {
    try {
      await relaunch();
    } catch (cause) {
      setUpdateError(typeof cause === "string" ? cause : String(cause));
    }
  };

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Settings</h1>
          <button
            onClick={onBack}
            className="text-sm text-blade-muted hover:text-blade-text transition-colors"
          >
            back
          </button>
        </div>
        <div className="flex items-center gap-1 border-b border-blade-border pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs rounded-t-lg transition-colors -mb-px ${
                tab === t.id
                  ? "text-blade-text bg-blade-surface border border-blade-border border-b-blade-surface"
                  : "text-blade-muted hover:text-blade-secondary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "provider" && <>
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          {/* Provider card grid */}
          <div>
            <span className="text-xs uppercase tracking-wide text-blade-muted">Provider</span>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {PROVIDER_MATRIX.map((entry, i) => {
                const isSelected = selectedEntry === entry ||
                  (selectedEntry?.name === entry.name && selectedEntry?.baseUrl === entry.baseUrl);
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setSelectedEntry(entry);
                      setProvider(entry.id);
                      if (entry.model) setModel(entry.model);
                      if (entry.baseUrl !== undefined) setBaseUrl(entry.baseUrl);
                    }}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "border-blade-accent bg-blade-accent/10 text-blade-accent"
                        : "border-blade-border text-blade-muted hover:border-blade-accent/40 hover:text-blade-text"
                    }`}
                  >
                    <span className="text-xs font-semibold leading-tight">{entry.name}</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {entry.badges.map((b) => (
                        <span
                          key={b}
                          className={`text-[9px] px-1 rounded ${isSelected ? "bg-blade-accent/20 text-blade-accent" : "bg-blade-bg text-blade-muted"}`}
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model + key fields */}
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs uppercase tracking-wide text-blade-muted">Model</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none font-mono"
                placeholder="model-name"
              />
            </label>

            {provider !== "ollama" && (
              <label className="space-y-1.5">
                <span className="text-xs uppercase tracking-wide text-blade-muted">API Key</span>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
                  placeholder={selectedEntry?.keyPlaceholder ?? "your-api-key"}
                />
              </label>
            )}
          </div>

          {/* Hermes 3 setup guide — shown when Ollama + hermes3 is selected */}
          {provider === "ollama" && model === "hermes3" && (
            <div className="rounded-xl border border-blade-accent/30 bg-blade-accent/5 px-3 py-3 space-y-2">
              <p className="text-xs font-semibold text-blade-accent">Hermes 3 — Local Tool-Calling AI</p>
              <p className="text-[11px] text-blade-muted leading-relaxed">
                Hermes 3 (NousResearch) is the best open-source model for tool use and agent tasks. It runs 100% locally via Ollama.
                BLADE automatically routes complex agent tasks to Hermes when you use this provider.
              </p>
              <div className="rounded-lg bg-blade-bg border border-blade-border px-2.5 py-1.5">
                <p className="text-[10px] text-blade-muted mb-1">If you haven&apos;t pulled the model yet, run this once:</p>
                <code className="text-xs font-mono text-blade-accent">ollama pull hermes3</code>
              </div>
              <p className="text-[10px] text-blade-muted/60">
                Make sure Ollama is running before starting a conversation. Default port is 11434.
                For a bigger context window, try <code className="font-mono">hermes3:8b</code> or <code className="font-mono">hermes3:70b</code>.
              </p>
            </div>
          )}

          {/* Base URL — shown for openai-compat providers or when custom */}
          {(baseUrl || selectedEntry?.name === "Custom") && provider !== "ollama" && (
            <label className="space-y-1.5 block">
              <span className="text-xs uppercase tracking-wide text-blade-muted">
                Base URL <span className="normal-case text-blade-muted/60">(OpenAI-compatible endpoint)</span>
              </span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none font-mono"
                placeholder="https://api.example.com/v1"
              />
            </label>
          )}

          {/* God Mode tier selector */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">God Mode</p>
              <p className="text-xs text-blade-muted mt-0.5">Blade scans your machine and injects live context — files, apps, clipboard — into every conversation. Short prompts work because Blade already knows what you're doing.</p>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {(["off", "normal", "intermediate", "extreme"] as const).map((tier) => {
                const labels: Record<string, string> = { off: "Off", normal: "Normal", intermediate: "Focused", extreme: "GOD MODE" };
                const descs: Record<string, string> = {
                  off: "Disabled",
                  normal: "5 min scan",
                  intermediate: "2 min + clipboard",
                  extreme: "1 min · full JARVIS",
                };
                const active = godModeTier === tier;
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={async () => {
                      setGodModeTier(tier);
                      const enabled = tier !== "off";
                      try {
                        await invoke("toggle_god_mode", { enabled, tier: enabled ? tier : null });
                      } catch { /* ignore */ }
                    }}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors ${
                      active
                        ? tier === "extreme"
                          ? "border-orange-500 bg-orange-500/10 text-orange-400"
                          : "border-blade-accent bg-blade-accent/10 text-blade-accent"
                        : "border-blade-border text-blade-muted hover:border-blade-accent/50"
                    }`}
                  >
                    <span className="text-xs font-semibold">{labels[tier]}</span>
                    <span className="text-[10px] leading-tight opacity-70">{descs[tier]}</span>
                  </button>
                );
              })}
            </div>
            {godModeTier === "extreme" && (
              <p className="text-xs text-orange-400 bg-orange-500/10 border border-orange-500/30 rounded-lg px-3 py-2">
                GOD MODE: BLADE scans every 60 seconds and acts as a live co-pilot — proactively surfacing context, flagging issues, and suggesting actions without being asked. Costs more tokens. Requires a paid key.
              </p>
            )}
          </div>

          {/* Voice Mode */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Voice Mode</p>
              <p className="text-xs text-blade-muted mt-0.5">
                Push-to-talk: hold <kbd className="font-mono bg-blade-surface border border-blade-border rounded px-1 text-[10px]">Ctrl+Space</kbd> to speak.
                Always On: VAD listens continuously — say "hey Blade" to trigger, or turn on auto-send in Extreme mode.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {(["off", "tts", "push-to-talk", "always-on"] as const).map((m) => {
                const labels = { off: "Off", tts: "Speak", "push-to-talk": "Push-to-Talk", "always-on": "Always On" };
                const descs = {
                  off: "Silent",
                  tts: "BLADE talks back",
                  "push-to-talk": "Hold Ctrl+Space",
                  "always-on": "VAD + wake word",
                };
                const active = voiceMode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setVoiceMode(m)}
                    className={`flex flex-col items-center gap-0.5 rounded-xl border px-2 py-2 text-center transition-colors ${
                      active
                        ? "border-blade-accent bg-blade-accent/10 text-blade-accent"
                        : "border-blade-border text-blade-muted hover:border-blade-accent/50"
                    }`}
                  >
                    <span className="text-xs font-semibold">{labels[m]}</span>
                    <span className="text-[10px] leading-tight opacity-70">{descs[m]}</span>
                  </button>
                );
              })}
            </div>
            {voiceMode === "tts" && (
              <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                BLADE will speak its pulse thoughts and morning briefings aloud using your OS speech engine. No cloud API needed.
              </p>
            )}
            {voiceMode === "always-on" && (
              <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2">
                Always-on uses your microphone continuously. Speech is sent to Whisper (via Groq). Say "Hey Blade" to trigger auto-send — otherwise your words fill the input box for you to review.
              </p>
            )}
          </div>

          {/* TTS Voice */}
          {(voiceMode === "tts" || voiceMode === "always-on") && ttsVoices.length > 0 && (
            <div className="space-y-2">
              <div>
                <p className="text-sm font-medium">Voice</p>
                <p className="text-xs text-blade-muted mt-0.5">
                  OpenAI voices require an OpenAI API key. System voices use your OS speech engine (no key needed).
                </p>
              </div>
              <select
                value={ttsVoice}
                onChange={(e) => setTtsVoice(e.target.value)}
                className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
              >
                <optgroup label="OpenAI (cloud, best quality)">
                  {ttsVoices.filter(v => v.provider === "openai").map(v => (
                    <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                  ))}
                </optgroup>
                <optgroup label="System (offline, no key)">
                  {ttsVoices.filter(v => v.provider === "system").map(v => (
                    <option key={v.id} value={v.id}>{v.label} — {v.description}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          )}

          {/* Shortcuts */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium">Keyboard Shortcuts</p>
              <p className="text-xs text-blade-muted mt-0.5">
                Global hotkeys work system-wide — even when BLADE is in the background.
                Format: <code className="font-mono text-[10px] bg-blade-surface px-1 rounded">Ctrl+Shift+V</code>,{" "}
                <code className="font-mono text-[10px] bg-blade-surface px-1 rounded">Alt+Space</code>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs text-blade-muted uppercase tracking-wide">Quick Ask</span>
                <input
                  type="text"
                  value={quickAskShortcut}
                  onChange={(e) => setQuickAskShortcut(e.target.value)}
                  className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm font-mono outline-none"
                  placeholder="Alt+Space"
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs text-blade-muted uppercase tracking-wide">Voice Input</span>
                <input
                  type="text"
                  value={voiceShortcut}
                  onChange={(e) => setVoiceShortcut(e.target.value)}
                  className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm font-mono outline-none"
                  placeholder="Ctrl+Shift+V"
                />
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveShortcuts}
                className="px-4 py-1.5 rounded-lg bg-blade-accent/20 hover:bg-blade-accent/30 text-blade-accent text-sm border border-blade-accent/30 transition-colors"
              >
                Apply Shortcuts
              </button>
              {shortcutStatus && <span className="text-xs text-emerald-400">{shortcutStatus}</span>}
              {shortcutError && <span className="text-xs text-red-400">{shortcutError}</span>}
            </div>
            <p className="text-xs text-blade-muted/60">
              Voice input shortcut toggles recording. First press starts mic, second press transcribes and opens Quick Ask pre-filled with your speech.
            </p>
          </div>

          {/* Obsidian Vault */}
          <label className="space-y-2 block">
            <span className="text-xs uppercase tracking-wide text-blade-muted">
              Obsidian Vault Path <span className="normal-case text-blade-muted/60">(optional — Blade will read and write notes here)</span>
            </span>
            <input
              type="text"
              value={obsidianVaultPath}
              onChange={(e) => setObsidianVaultPath(e.target.value)}
              className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none font-mono"
              placeholder="/home/user/vault or C:\Users\user\vault"
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              className="px-4 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm hover:border-blade-muted transition-colors"
            >
              Test
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-xl bg-blade-accent text-white text-sm hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>

          {status && <p className="text-xs text-green-400">{status}</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Key Vault</h2>
            <p className="text-xs text-blade-muted mt-0.5">Store all your provider keys at once. BLADE keeps them all — switches automatically based on context.</p>
          </div>
          <KeyVault activeProvider={provider} />
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold">Smart Routing</h2>
            <p className="text-xs text-blade-muted mt-0.5">Route different task types to different providers. Code → Claude, quick replies → Groq, vision → Gemini. One brain, best model per job.</p>
          </div>
          <RoutingPanel />
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Provider Guide</h2>
            <p className="text-sm text-blade-muted">
              Quick guidance for choosing a provider without leaving the app.
            </p>
          </div>
          <div className="space-y-3">
            {PROVIDER_MATRIX.map((providerInfo) => {
              const isActive = providerInfo.id === provider;

              return (
                <button
                  key={providerInfo.id}
                  onClick={() => {
                    setProvider(providerInfo.id);
                    setModel(providerInfo.model);
                  }}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-colors ${
                    isActive
                      ? "border-blade-accent bg-blade-bg"
                      : "border-blade-border bg-blade-bg/60 hover:border-blade-muted"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">{providerInfo.name}</div>
                      <div className="text-xs text-blade-muted mt-0.5">
                        Recommended default: {providerInfo.model}
                      </div>
                    </div>
                    {isActive && (
                      <span className="text-[11px] uppercase tracking-[0.2em] text-blade-accent">
                        active
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {providerInfo.badges.map((badge) => (
                      <span
                        key={badge}
                        className="text-[11px] rounded-full border border-blade-border bg-blade-surface px-2.5 py-1 text-blade-muted"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
        </>}

        {tab === "memory" && <>
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Blade Memory</h2>
            <p className="text-sm text-blade-muted">
              Personalize how Blade writes and what long-lived context it should remember.
            </p>
          </div>

          <label className="space-y-2 block">
            <span className="text-xs uppercase tracking-wide text-blade-muted">Persona</span>
            <textarea
              value={persona}
              onChange={(event) => setPersona(event.target.value)}
              rows={5}
              className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none resize-y min-h-[120px]"
              placeholder="Example: I like concise answers, TypeScript-first examples, and startup-style prioritization."
            />
          </label>

          <label className="space-y-2 block">
            <span className="text-xs uppercase tracking-wide text-blade-muted">Context Notes</span>
            <textarea
              value={contextNotes}
              onChange={(event) => setContextNotes(event.target.value)}
              rows={6}
              className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none resize-y min-h-[140px]"
              placeholder="Pinned facts, active projects, conventions, or reminders Blade should fold into future system prompts."
            />
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveBrain}
              className="px-4 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm hover:border-blade-muted transition-colors"
            >
              Save memory
            </button>
            <p className="text-xs text-blade-muted">
              Stored locally and injected into Blade&apos;s system prompt.
            </p>
          </div>
        </section>
        </>}

        {tab === "evolution" && <>
        {/* Evolution Dashboard */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-semibold">BLADE Evolution</h2>
              <p className="text-sm text-blade-muted">BLADE watches what you use and wires itself in automatically.</p>
            </div>
            <button
              onClick={async () => {
                setEvolutionRunning(true);
                try {
                  await invoke("evolution_run_now");
                  const [level, suggestions] = await Promise.all([
                    invoke<EvolutionLevel>("evolution_get_level"),
                    invoke<EvolutionSuggestion[]>("evolution_get_suggestions"),
                  ]);
                  setEvolutionLevel(level);
                  setEvolutionSuggestions(suggestions);
                } finally {
                  setEvolutionRunning(false);
                }
              }}
              disabled={evolutionRunning}
              className="px-3 py-1.5 rounded-lg bg-blade-bg border border-blade-border text-xs hover:border-blade-muted transition-colors disabled:opacity-50"
            >
              {evolutionRunning ? "Scanning..." : "Scan now"}
            </button>
          </div>

          {/* Level badge */}
          {evolutionLevel && (
            <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-violet-950/60 to-blade-bg border border-violet-800/40">
              <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-violet-900/50 border border-violet-700/50 flex items-center justify-center">
                <span className="text-2xl font-bold text-violet-300">L{evolutionLevel.level}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">Level {evolutionLevel.level} — Score {evolutionLevel.score}</div>
                <div className="text-xs text-blade-muted mt-1 flex flex-wrap gap-1">
                  {evolutionLevel.breakdown.map((item, i) => (
                    <span key={i} className="bg-blade-surface border border-blade-border rounded px-1.5 py-0.5">{item}</span>
                  ))}
                </div>
                {evolutionLevel.next_unlock && (
                  <div className="text-xs text-violet-400 mt-2">{evolutionLevel.next_unlock}</div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Pending suggestions */}
        {evolutionSuggestions.length > 0 && (
          <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Detected capabilities</h2>
              <p className="text-sm text-blade-muted">BLADE saw you using these — connect them to unlock full control.</p>
            </div>
            <div className="space-y-3">
              {evolutionSuggestions.map((s) => {
                const isRuleMutation = !s.package; // empty package = prompt rule suggestion, not MCP install
                return (
                <div key={s.id} className={`rounded-xl border bg-blade-bg/60 p-3 space-y-2 ${isRuleMutation ? "border-amber-500/30" : "border-blade-border"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium">{s.name}</div>
                        {isRuleMutation && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">rule</span>
                        )}
                      </div>
                      <div className="text-xs text-blade-muted mt-0.5">{s.description}</div>
                      {!isRuleMutation && <div className="text-xs text-blade-muted/60 mt-1">Detected via: {s.trigger_app}</div>}
                    </div>
                    <button
                      onClick={async () => {
                        await invoke("evolution_dismiss_suggestion", { id: s.id });
                        setEvolutionSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                      }}
                      className="flex-shrink-0 text-blade-muted/50 hover:text-blade-muted text-xs"
                    >
                      dismiss
                    </button>
                  </div>

                  {isRuleMutation && (
                    <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-2">
                      <div className="text-[10px] text-amber-400/80 mb-1.5">Proposed rule (from failure analysis):</div>
                      <div className="text-xs font-mono text-blade-text/80 whitespace-pre-wrap">{s.description}</div>
                      <div className="mt-2 text-[10px] text-blade-muted/60">Copy this rule and ask BLADE to add it to its system prompt, or dismiss if not relevant.</div>
                    </div>
                  )}

                  {!isRuleMutation && s.required_token_hint && (
                    <div className="space-y-1.5">
                      <div className="text-xs text-amber-400/80">Needs: {s.required_token_hint}</div>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          placeholder="Paste token / key here"
                          value={suggestionTokens[s.id] ?? ""}
                          onChange={(e) => setSuggestionTokens((prev) => ({ ...prev, [s.id]: e.target.value }))}
                          className="flex-1 bg-blade-bg border border-blade-border rounded-lg px-2.5 py-1.5 text-xs outline-none min-w-0"
                        />
                        <button
                          onClick={async () => {
                            const token = suggestionTokens[s.id] ?? "";
                            if (!token) return;
                            const envKey = s.required_token_hint?.split(/[\s(]/)[0] ?? "TOKEN";
                            try {
                              const toolCount = await invoke<number>("evolution_install_suggestion", {
                                id: s.id, tokenKey: envKey, tokenValue: token,
                              });
                              setEvolutionSuggestions((prev) => prev.filter((x) => x.id !== s.id));
                              const level = await invoke<EvolutionLevel>("evolution_get_level");
                              setEvolutionLevel(level);
                              setStatus(`${s.name} connected — ${toolCount} tool(s) available`);
                            } catch (e) {
                              setError(String(e));
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 text-white text-xs transition-colors flex-shrink-0"
                        >
                          Connect
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </section>
        )}

        {evolutionSuggestions.length === 0 && evolutionLevel && (
          <section className="bg-blade-surface border border-blade-border rounded-2xl p-4">
            <p className="text-sm text-blade-muted text-center">
              {config.god_mode
                ? "No new capabilities detected yet — BLADE is watching."
                : "Enable God Mode so BLADE can see what you use and suggest integrations."}
            </p>
          </section>
        )}

        {/* Research Log */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Intelligence Feed</h2>
              <p className="text-xs text-blade-muted">What BLADE has been researching while you work</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="text-xs bg-blade-bg border border-blade-border rounded-lg px-2 py-1 w-40 focus:outline-none focus:ring-1 focus:ring-violet-500"
                placeholder="Search anything..."
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== "Enter" || !researchQuery.trim() || researchRunning) return;
                  setResearchRunning(true);
                  try {
                    await invoke<string>("research_query", { query: researchQuery.trim() });
                    const fresh = await invoke<Array<{ id: number; query: string; results: string; source: string; created_at: number }>>("research_get_recent", { limit: 8 });
                    setResearchEntries(fresh);
                    setResearchQuery("");
                  } catch {
                    // ignore
                  } finally {
                    setResearchRunning(false);
                  }
                }}
              />
              <button
                className="text-xs px-3 py-1 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors disabled:opacity-40"
                disabled={!researchQuery.trim() || researchRunning}
                onClick={async () => {
                  if (!researchQuery.trim() || researchRunning) return;
                  setResearchRunning(true);
                  try {
                    await invoke<string>("research_query", { query: researchQuery.trim() });
                    const fresh = await invoke<Array<{ id: number; query: string; results: string; source: string; created_at: number }>>("research_get_recent", { limit: 8 });
                    setResearchEntries(fresh);
                    setResearchQuery("");
                  } catch {
                    // ignore
                  } finally {
                    setResearchRunning(false);
                  }
                }}
              >
                {researchRunning ? "..." : "Search"}
              </button>
            </div>
          </div>

          {researchEntries.length === 0 ? (
            <p className="text-xs text-blade-muted text-center py-4">
              BLADE will research topics from your active work every 30 minutes.<br />
              Or search anything manually above.
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {researchEntries.map((entry) => {
                const dt = new Date(entry.created_at * 1000);
                const timeStr = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                // Extract top 2 result lines from the raw text
                const lines = entry.results.split("\n").filter(l => l.trim().length > 0).slice(0, 6);
                return (
                  <div key={entry.id} className="border border-blade-border rounded-xl bg-blade-bg/60 p-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-violet-300">{entry.query}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {entry.source === "auto" ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-violet-900/40 text-violet-400 rounded-full">auto</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded-full">manual</span>
                        )}
                        <span className="text-[10px] text-blade-muted">{timeStr}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-blade-muted leading-relaxed font-mono whitespace-pre-wrap">
                      {lines.join("\n")}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {researchEntries.length > 0 && (
            <button
              className="text-[11px] text-blade-muted hover:text-red-400 transition-colors"
              onClick={async () => {
                try {
                  await invoke("research_clear", { olderThanDays: 0 });
                  setResearchEntries([]);
                } catch { /* ignore */ }
              }}
            >
              Clear all research
            </button>
          )}
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">AI Friends — Delegate Permissions</h2>
            <p className="text-sm text-blade-muted">
              When BLADE needs permission for a risky action in the background, it can ask another AI instead of interrupting you. The delegate reviews the request and approves or blocks it.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-blade-muted uppercase tracking-wide">Trusted AI Delegate</label>
            <div className="flex gap-2">
              <select
                value={aiDelegate}
                onChange={async (e) => {
                  const val = e.target.value;
                  setAiDelegate(val);
                  setDelegateCheckResult(null);
                  await invoke("save_config_field", { key: "trusted_ai_delegate", value: val });
                }}
                className="flex-1 rounded-xl border border-blade-border bg-blade-bg px-3 py-2 text-sm outline-none focus:border-blade-accent"
              >
                <option value="">None — always ask me</option>
                <option value="claude-code">Claude Code CLI</option>
              </select>
              {aiDelegate === "claude-code" && (
                <button
                  onClick={async () => {
                    const result = await invoke<{ available: boolean }>("ai_delegate_check").catch(() => null);
                    setDelegateCheckResult(result);
                  }}
                  className="px-3 py-2 rounded-xl border border-blade-border text-sm hover:border-blade-muted transition-colors"
                >
                  Check
                </button>
              )}
            </div>
            {delegateCheckResult !== null && (
              <p className={`text-xs ${delegateCheckResult.available ? "text-green-400" : "text-red-400"}`}>
                {delegateCheckResult.available ? "Claude Code found and available" : "Claude Code not found — install with: npm install -g @anthropic-ai/claude-code"}
              </p>
            )}
          </div>

          {aiDelegate === "claude-code" && (
            <div className="space-y-3">
              <div className="rounded-xl border border-blade-accent/20 bg-blade-accent/5 px-3 py-3 space-y-2">
                <p className="text-xs font-semibold text-blade-accent">Make Friends</p>
                <p className="text-[11px] text-blade-muted leading-relaxed">
                  Introduce BLADE to Claude Code so it recognizes future approval requests. This saves BLADE&apos;s identity to Claude Code&apos;s memory — next time BLADE asks for permission, Claude Code won&apos;t be clueless about who it is.
                </p>
                <button
                  onClick={async () => {
                    setIntroduceStatus("Introducing BLADE to Claude Code…");
                    try {
                      const result = await invoke<string>("ai_delegate_introduce");
                      setIntroduceStatus(result);
                    } catch (e) {
                      setIntroduceStatus(`Error: ${e}`);
                    }
                  }}
                  className="w-full py-1.5 rounded-lg bg-blade-accent text-white text-xs font-medium hover:opacity-90 transition-opacity"
                >
                  Introduce BLADE to Claude Code
                </button>
                {introduceStatus && (
                  <p className="text-[11px] text-blade-muted/80 leading-relaxed">{introduceStatus}</p>
                )}
              </div>

              <div className="text-[11px] text-blade-muted/60 leading-relaxed">
                <span className="text-blade-text font-medium">How it works:</span> When BLADE runs a background agent and needs to write a file, delete something, or make a network request, it asks Claude Code: &quot;Hey, I&apos;m BLADE, I was doing X and need to do Y. Should I?&quot; — Claude Code approves or blocks, and BLADE proceeds accordingly.
              </div>
            </div>
          )}
        </section>
        </>}

        {tab === "privacy" && <>
        {/* Privacy & Trust panel */}
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Privacy & Data</h2>
            <p className="text-sm text-blade-muted">Exactly what BLADE stores and what leaves your machine.</p>
          </div>

          {/* Local only */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-green-400">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M8 1a5 5 0 1 0 0 10A5 5 0 0 0 8 1zm0 9a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/>
                <path d="M8 3a1 1 0 0 0-1 1v3.586l-1.293 1.293a1 1 0 0 0 1.414 1.414l1.586-1.586A1 1 0 0 0 9 8V4a1 1 0 0 0-1-1z"/>
              </svg>
              Stays on your machine
            </div>
            {[
              ["Conversation memory", "SQLite at ~/.blade/blade.db — never uploaded anywhere"],
              ["Execution history", "Every shell command you've run, stored locally"],
              ["Embeddings & semantic memory", "Vector store on disk — fastembed runs 100% locally"],
              ["Codebase index", "Function/symbol index stored in ~/.blade/ — never leaves"],
              ["API keys", "Stored in your OS keychain or local config — BLADE has no servers to send them to"],
              ["God mode snapshots", "Screenshots and window context are only processed by your configured provider, then discarded"],
            ].map(([label, desc]) => (
              <div key={label} className="flex items-start gap-3 rounded-xl border border-blade-border bg-blade-bg/50 px-3 py-2.5">
                <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 text-green-400 shrink-0" fill="currentColor">
                  <path d="M13.354 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                </svg>
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-blade-muted">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Leaves device */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-400">
              <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="currentColor">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 13A6 6 0 1 1 8 2a6 6 0 0 1 0 12z"/>
                <path d="M7.5 4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5zm0 6a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z"/>
              </svg>
              Sent to your AI provider
            </div>
            {[
              ["Your messages", "Sent to the provider you configure (Anthropic, OpenAI, Groq, Gemini, or your local Ollama). BLADE uses your own API key — no middleman, no proxy."],
              ["Tool results (if using tools)", "When BLADE uses tools (search results, file contents), those results are included in the API call to your provider so the model can reason about them."],
            ].map(([label, desc]) => (
              <div key={label} className="flex items-start gap-3 rounded-xl border border-amber-900/30 bg-amber-900/10 px-3 py-2.5">
                <svg viewBox="0 0 16 16" className="w-4 h-4 mt-0.5 text-amber-400 shrink-0" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 13A6 6 0 1 1 8 2a6 6 0 0 1 0 12z"/>
                  <path d="M7.5 4a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5zm0 6a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z"/>
                </svg>
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-blade-muted">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          {/* No telemetry */}
          <div className="rounded-xl border border-blade-border bg-blade-bg/50 px-3 py-3 text-xs text-blade-muted leading-relaxed">
            <span className="text-white font-medium">No telemetry, no analytics, no BLADE servers.</span> BLADE is a native app. It talks to your AI provider — that's it. The developers cannot see your conversations, keys, or usage.
          </div>

          {/* BLADE.md control */}
          <div className="rounded-xl border border-blade-border bg-blade-bg/50 px-3 py-2.5 text-xs text-blade-muted leading-relaxed">
            <span className="text-white font-medium">Control BLADE with BLADE.md:</span> Create a file at <code className="bg-blade-border px-1 py-0.5 rounded">~/.blade/BLADE.md</code> to give BLADE workspace-level instructions — restrict what it can access, require confirmation before file writes, set tone, etc.
          </div>
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Total Recall — Screen Timeline</h2>
            <p className="text-sm text-blade-muted">
              Captures a screenshot every N seconds during God Mode, describes it with vision AI, and makes it semantically searchable. "What error was I looking at 10 minutes ago?"
            </p>
          </div>

          {/* Enable toggle */}
          <div className="flex items-center justify-between rounded-xl border border-blade-border bg-blade-bg/50 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Enable screen timeline</div>
              <div className="text-xs text-blade-muted">Screenshots processed by your configured AI provider only</div>
            </div>
            <button
              onClick={async () => {
                const next = !timelineEnabled;
                setTimelineEnabled(next);
                await invoke("set_config", {
                  config: {
                    ...config,
                    screen_timeline_enabled: next,
                    timeline_capture_interval: timelineInterval,
                    timeline_retention_days: timelineRetention,
                  },
                });
              }}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${timelineEnabled ? "bg-blade-accent" : "bg-blade-border"}`}
            >
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${timelineEnabled ? "translate-x-4" : "translate-x-1"}`} />
            </button>
          </div>

          {timelineEnabled && (
            <div className="space-y-3">
              {/* Capture interval */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-blade-muted uppercase tracking-wide">Capture interval</label>
                  <span className="text-xs text-blade-text font-mono">{timelineInterval}s</span>
                </div>
                <div className="flex items-center gap-2">
                  {[15, 30, 60, 120].map((s) => (
                    <button
                      key={s}
                      onClick={async () => {
                        setTimelineInterval(s);
                        await invoke("set_config", {
                          config: {
                            ...config,
                            screen_timeline_enabled: timelineEnabled,
                            timeline_capture_interval: s,
                            timeline_retention_days: timelineRetention,
                          },
                        });
                      }}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        timelineInterval === s
                          ? "border-blade-accent bg-blade-accent/10 text-blade-accent"
                          : "border-blade-border text-blade-muted hover:border-blade-muted"
                      }`}
                    >
                      {s >= 60 ? `${s / 60}m` : `${s}s`}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-blade-muted/60">
                  {timelineInterval === 15 ? "~200MB/day — very detailed but high disk usage" :
                   timelineInterval === 30 ? "~100MB/day — recommended balance" :
                   timelineInterval === 60 ? "~50MB/day — lighter, less granular" :
                   "~25MB/day — minimal footprint"}
                </p>
              </div>

              {/* Retention */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-blade-muted uppercase tracking-wide">Keep screenshots for</label>
                <div className="flex items-center gap-2">
                  {[7, 14, 30].map((d) => (
                    <button
                      key={d}
                      onClick={async () => {
                        setTimelineRetention(d);
                        await invoke("set_config", {
                          config: {
                            ...config,
                            screen_timeline_enabled: timelineEnabled,
                            timeline_capture_interval: timelineInterval,
                            timeline_retention_days: d,
                          },
                        });
                      }}
                      className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                        timelineRetention === d
                          ? "border-blade-accent bg-blade-accent/10 text-blade-accent"
                          : "border-blade-border text-blade-muted hover:border-blade-muted"
                      }`}
                    >
                      {d} days
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-blade-muted/60">
                  Older screenshots are deleted automatically. Stored at <code className="bg-blade-border px-1 rounded">~/.blade/screenshots/</code>
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-blade-border bg-blade-bg/50 px-3 py-2.5 text-xs text-blade-muted leading-relaxed">
            <span className="text-white font-medium">Requires God Mode.</span> Timeline capture only runs while God Mode is active. Screenshots never leave your machine — only the text description is sent to your AI provider for embedding.
          </div>
        </section>
        </>}

        {tab === "about" && <>
        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-3">
          <div>
            <h2 className="text-base font-semibold">Diagnostics</h2>
            <p className="text-sm text-blade-muted">Quick view of the current runtime setup.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-blade-border bg-blade-bg/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-blade-muted">Provider</div>
              <div className="text-sm mt-1">{provider || "Not set"}</div>
            </div>
            <div className="rounded-xl border border-blade-border bg-blade-bg/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-blade-muted">Model</div>
              <div className="text-sm mt-1 break-all">{model || "Not set"}</div>
            </div>
            <div className="rounded-xl border border-blade-border bg-blade-bg/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-blade-muted">Tool Mode</div>
              <div className="text-sm mt-1">Auto with MCP when tools are available</div>
            </div>
            <div className="rounded-xl border border-blade-border bg-blade-bg/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-blade-muted">Version</div>
              <div className="text-sm mt-1">{appVersion}</div>
            </div>
            <div className="rounded-xl border border-blade-border bg-blade-bg/70 px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-blade-muted">Secret Storage</div>
              <div className="text-sm mt-1">OS Keychain (Credential Manager)</div>
            </div>
          </div>
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">JITRO — Self-Coding</h2>
            <p className="text-sm text-blade-muted">
              BLADE can write features into itself. Point it at its own source repo and describe what you want built.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-blade-muted uppercase tracking-wide">Source path</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={bladeSourcePath}
                onChange={(e) => setBladeSourcePath(e.target.value)}
                placeholder="~/blade  (auto-detected if left blank)"
                className="flex-1 rounded-xl border border-blade-border bg-blade-bg px-3 py-2 text-sm outline-none focus:border-blade-accent"
              />
              <button
                onClick={async () => {
                  await invoke("save_config_field", { key: "blade_source_path", value: bladeSourcePath });
                  setJitroStatus("Path saved");
                  setTimeout(() => setJitroStatus(null), 1500);
                }}
                className="px-3 py-2 rounded-xl border border-blade-border text-sm hover:border-blade-muted transition-colors"
              >Save</button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-blade-muted uppercase tracking-wide">Feature to build</label>
            <textarea
              value={jitroGoal}
              onChange={(e) => setJitroGoal(e.target.value)}
              placeholder="Describe a feature you want BLADE to add to itself..."
              rows={3}
              className="w-full rounded-xl border border-blade-border bg-blade-bg px-3 py-2 text-sm outline-none focus:border-blade-accent resize-none"
            />
            <button
              disabled={jitroRunning || !jitroGoal.trim()}
              onClick={async () => {
                setJitroRunning(true);
                setJitroStatus(null);
                try {
                  await invoke("blade_self_code", {
                    feature: jitroGoal.trim(),
                    sourcePath: bladeSourcePath || null,
                  });
                  setJitroStatus("JITRO agent spawned — watch Background Agents for progress");
                  setJitroGoal("");
                } catch (e) {
                  setJitroStatus(`Error: ${e}`);
                } finally {
                  setJitroRunning(false);
                }
              }}
              className="w-full py-2 rounded-xl bg-blade-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {jitroRunning ? "Spawning…" : "Spawn JITRO"}
            </button>
            {jitroStatus && <p className="text-xs text-green-400">{jitroStatus}</p>}
          </div>
          <p className="text-[11px] text-blade-muted/60 leading-relaxed">
            JITRO spawns a background Claude Code agent that reads CLAUDE.md, implements the feature, and runs <code className="bg-blade-border px-1 rounded">cargo check</code>. You'll get a notification when it's done.
          </p>
        </section>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Updates</h2>
            <p className="text-sm text-blade-muted">
              Installed builds can pull the latest signed release without reinstalling manually.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleCheckForUpdates}
              disabled={checkingForUpdates}
              className="px-4 py-2 rounded-xl bg-blade-bg border border-blade-border text-sm hover:border-blade-muted transition-colors disabled:opacity-60"
            >
              {checkingForUpdates ? "Checking..." : "Check for updates"}
            </button>
            <button
              onClick={handleRestartForUpdate}
              className="px-4 py-2 rounded-xl bg-blade-accent text-white text-sm hover:opacity-90 transition-opacity"
            >
              Restart app
            </button>
          </div>

          {updateStatus && <p className="text-xs text-green-400">{updateStatus}</p>}
          {updateError && <p className="text-xs text-red-400">{updateError}</p>}
        </section>
        </>}

        {tab === "integrations" && (
          <div className="relative h-full flex flex-col gap-0 overflow-y-auto">
            {/* Native bridges first */}
            <div className="px-4 pt-4 pb-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                Bridges
              </p>
              <TelegramBridge />
              <div className="mt-3">
                <DiscordBridge />
              </div>
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                Resource Watcher
              </p>
              <WatcherPanel />
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                Reminders
              </p>
              <RemindersPanel />
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                Pentest Authorizations
              </p>
              <PentestPanel />
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                Scheduled Tasks
              </p>
              <CronPanel />
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                Learned Skills
              </p>
              <SkillsPanel />
            </div>
            <div className="px-4 py-2">
              <p className="text-[10px] font-semibold tracking-widest text-blade-muted/70 uppercase mb-3">
                MCP Servers
              </p>
            </div>
            <McpCatalog
              onInstalled={() => {
                void onConfigRefresh();
              }}
            />
          </div>
        )}

        {tab === "mcp" && <>
        <McpSettings
          onServersChanged={async () => {
            await onConfigRefresh();
          }}
        />
        </>}
      </div>
    </div>
  );
}
