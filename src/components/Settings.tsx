import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BladeConfig } from "../types";
import { McpSettings } from "./McpSettings";

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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProvider(config.provider);
    setApiKey(config.api_key);
    setModel(config.model);
  }, [config]);

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

        <McpSettings
          onServersChanged={async () => {
            await onConfigRefresh();
          }}
        />
      </div>
    </div>
  );
}
