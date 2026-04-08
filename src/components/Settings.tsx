import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BladeConfig } from "../types";
import { McpSettings } from "./McpSettings";

const PROVIDER_MATRIX = [
  {
    id: "gemini",
    name: "Google Gemini",
    model: "gemini-2.0-flash",
    badges: ["fast", "tools", "good default"],
  },
  {
    id: "groq",
    name: "Groq",
    model: "llama-3.3-70b-versatile",
    badges: ["very fast", "tools", "cheap"],
  },
  {
    id: "openai",
    name: "OpenAI",
    model: "gpt-4o-mini",
    badges: ["tools", "reliable", "multi-modal"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    model: "claude-sonnet-4-20250514",
    badges: ["tools", "strong reasoning", "careful"],
  },
  {
    id: "ollama",
    name: "Ollama",
    model: "llama3.2",
    badges: ["local", "offline", "no api key"],
  },
];

interface Props {
  config: BladeConfig;
  onBack: () => void;
  onSaved: (config: BladeConfig) => void;
  onConfigRefresh: () => Promise<void>;
}

export function Settings({ config, onBack, onSaved, onConfigRefresh }: Props) {
  const [provider, setProvider] = useState(config.provider);
  const [apiKey, setApiKey] = useState(config.api_key);
  const [model, setModel] = useState(config.model);
  const [persona, setPersona] = useState("");
  const [contextNotes, setContextNotes] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProvider(config.provider);
    setApiKey(config.api_key);
    setModel(config.model);
  }, [config]);

  useEffect(() => {
    const loadBrain = async () => {
      try {
        const [nextPersona, nextContext] = await Promise.all([
          invoke<string>("get_persona"),
          invoke<string>("get_context"),
        ]);
        setPersona(nextPersona);
        setContextNotes(nextContext);
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
      const result = await invoke<string>("test_provider", { provider, apiKey, model });
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
      await invoke("set_config", { provider, apiKey, model });
      const nextConfig: BladeConfig = {
        ...config,
        provider,
        api_key: apiKey,
        model,
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

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Settings</h1>
            <p className="text-sm text-blade-muted">Provider, model, API key, and MCP servers.</p>
          </div>
          <button
            onClick={onBack}
            className="text-sm text-blade-muted hover:text-blade-text transition-colors"
          >
            back
          </button>
        </div>

        <section className="bg-blade-surface border border-blade-border rounded-2xl p-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-blade-muted">Provider</span>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
              >
                <option value="gemini">Google Gemini</option>
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama</option>
              </select>
            </label>

            <label className="space-y-2">
              <span className="text-xs uppercase tracking-wide text-blade-muted">Model</span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
                placeholder="gpt-4o-mini"
              />
            </label>
          </div>

          <label className="space-y-2 block">
            <span className="text-xs uppercase tracking-wide text-blade-muted">API Key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="w-full bg-blade-bg border border-blade-border rounded-xl px-3 py-2 text-sm outline-none"
              placeholder="Paste provider key"
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
              <div className="text-xs uppercase tracking-wide text-blade-muted">Secret Storage</div>
              <div className="text-sm mt-1">OS Keychain (Credential Manager)</div>
            </div>
          </div>
        </section>

        <McpSettings
          onServersChanged={async () => {
            await onConfigRefresh();
          }}
        />
      </div>
    </div>
  );
}
