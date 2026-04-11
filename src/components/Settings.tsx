import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { BladeConfig } from "../types";
import { McpSettings } from "./McpSettings";
import { McpCatalog } from "./McpCatalog";
import { TelegramBridge } from "./TelegramBridge";

type SettingsTab = "provider" | "memory" | "mcp" | "integrations" | "about";

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
  { id: "provider", label: "Provider" },
  { id: "integrations", label: "Integrations" },
  { id: "memory", label: "Memory" },
  { id: "mcp", label: "MCP" },
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

export function Settings({ config, onBack, onSaved, onConfigRefresh }: Props) {
  const [tab, setTab] = useState<SettingsTab>("provider");
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
  const [obsidianVaultPath, setObsidianVaultPath] = useState(config.obsidian_vault_path ?? "");
  const [persona, setPersona] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("dev");
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    setProvider(config.provider);
    setApiKey(config.api_key);
    setModel(config.model);
    setBaseUrl(config.base_url ?? "");
    setGodModeTier(config.god_mode ? (config.god_mode_tier ?? "normal") : "off");
    setVoiceMode(config.voice_mode ?? "off");
    setObsidianVaultPath(config.obsidian_vault_path ?? "");
  }, [config]);

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
      setUpdateError(typeof cause === "string" ? cause : String(cause));
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
                const labels: Record<string, string> = { off: "Off", normal: "Normal", intermediate: "Focused", extreme: "Extreme" };
                const descs: Record<string, string> = {
                  off: "Disabled",
                  normal: "5 min scan",
                  intermediate: "2 min + clipboard",
                  extreme: "1 min + JARVIS",
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
                Extreme mode scans every 60 seconds and runs Blade as an active co-pilot — it will proactively suggest actions on every message. Uses significantly more API tokens. Don't use this unless you have a paid key with budget to spare.
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
            <div className="grid grid-cols-3 gap-1.5">
              {(["off", "push-to-talk", "always-on"] as const).map((m) => {
                const labels = { off: "Off", "push-to-talk": "Push-to-Talk", "always-on": "Always On" };
                const descs = { off: "Disabled", "push-to-talk": "Hold Ctrl+Space", "always-on": "VAD + wake word" };
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
            {voiceMode === "always-on" && (
              <p className="text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2">
                Always-on uses your microphone continuously. Speech is sent to Whisper (via Groq). Say "Hey Blade" to trigger auto-send — otherwise your words fill the input box for you to review.
              </p>
            )}
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
