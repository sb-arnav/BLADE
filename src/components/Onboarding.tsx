import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Free tier, fast, recommended to start",
    model: "gemini-2.0-flash",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Free tier, fastest inference",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o mini, reliable",
    model: "gpt-4o-mini",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude, strong reasoning",
    model: "claude-sonnet-4-20250514",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Local, offline, needs hardware",
    model: "llama3.2",
    needsKey: false,
    keyUrl: "",
  },
];

interface Props {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState<"pick" | "key" | "testing">("pick");
  const [selected, setSelected] = useState(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const handleTest = async () => {
    setStep("testing");
    setTestResult(null);
    setTestError(null);
    try {
      const result = await invoke<string>("test_provider", {
        provider: selected.id,
        apiKey: selected.needsKey ? apiKey : "",
        model: selected.model,
      });
      setTestResult(result);
    } catch (e) {
      setTestError(typeof e === "string" ? e : String(e));
    }
  };

  const handleSave = async () => {
    await invoke("set_config", {
      provider: selected.id,
      apiKey: selected.needsKey ? apiKey : "",
      model: selected.model,
    });
    onComplete();
  };

  return (
    <div className="flex-1 flex flex-col justify-center bg-blade-bg text-blade-text p-6">
      <div className="max-w-sm mx-auto w-full animate-fade-in">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-blade-accent-muted flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blade-accent" />
            </div>
            <h1 className="text-base font-semibold tracking-tight">Blade</h1>
          </div>
          <p className="text-blade-secondary text-xs leading-relaxed">
            {step === "pick" && "Connect a provider to get started."}
            {step === "key" && `Paste your ${selected.name} API key.`}
            {step === "testing" && "Checking connection..."}
          </p>
        </div>

        {step === "pick" && (
          <div className="space-y-1.5">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                onClick={() => {
                  setSelected(provider);
                  if (!provider.needsKey) {
                    setStep("testing");
                    setTimeout(() => handleTest(), 0);
                  } else {
                    setStep("key");
                  }
                }}
                className="w-full text-left px-3.5 py-3 rounded-lg border border-blade-border hover:border-blade-border-hover hover:bg-blade-surface transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[0.8125rem] font-medium">{provider.name}</span>
                  <svg viewBox="0 0 24 24" className="w-3 h-3 text-blade-muted group-hover:text-blade-secondary transition-colors" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </div>
                <p className="text-2xs text-blade-muted mt-0.5">{provider.description}</p>
              </button>
            ))}
          </div>
        )}

        {step === "key" && (
          <div className="space-y-4 animate-fade-in">
            <div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleTest(); }}
                placeholder="sk-..."
                className="w-full bg-blade-surface border border-blade-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors"
                autoFocus
              />
              <a
                href={selected.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-2xs text-blade-accent hover:text-blade-accent-hover mt-2 inline-block transition-colors"
              >
                Get a {selected.name} key
              </a>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep("pick")}
                className="px-3 py-2 text-xs text-blade-muted hover:text-blade-secondary transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleTest}
                disabled={!apiKey.trim()}
                className="flex-1 px-3 py-2 text-xs font-medium bg-blade-accent text-white rounded-lg disabled:opacity-30 hover:bg-blade-accent-hover transition-colors"
              >
                Test connection
              </button>
            </div>
          </div>
        )}

        {step === "testing" && (
          <div className="space-y-4 animate-fade-in">
            {!testResult && !testError && (
              <div className="flex items-center gap-2 text-xs text-blade-secondary">
                <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse-slow" />
                Testing {selected.name}...
              </div>
            )}
            {testResult && (
              <div className="space-y-3">
                <div className="px-3.5 py-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 text-xs">
                  Connected.
                </div>
                <button
                  onClick={handleSave}
                  className="w-full px-3 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-lg hover:bg-blade-accent-hover transition-colors"
                >
                  Continue
                </button>
              </div>
            )}
            {testError && (
              <div className="space-y-3">
                <div className="px-3.5 py-2.5 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
                  {testError}
                </div>
                <button
                  onClick={() => setStep("key")}
                  className="text-xs text-blade-muted hover:text-blade-secondary transition-colors"
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
