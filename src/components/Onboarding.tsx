import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    description: "Free tier · Fast · Recommended",
    model: "gemini-2.0-flash",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Free tier · Fastest responses",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT-4o mini · Bring your key",
    model: "gpt-4o-mini",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude · Bring your key",
    model: "claude-sonnet-4-20250514",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Local · Free · Needs good hardware",
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
      <div className="max-w-md mx-auto w-full">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-blade-accent" />
            <h1 className="text-xl font-semibold">Blade</h1>
          </div>
          <p className="text-blade-muted text-sm">
            {step === "pick" && "Connect an AI provider to get started."}
            {step === "key" && `Enter your ${selected.name} API key.`}
            {step === "testing" && "Testing connection..."}
          </p>
        </div>

        {step === "pick" && (
          <div className="space-y-2">
            {PROVIDERS.map((provider) => (
              <button
                key={provider.id}
                onClick={() => {
                  setSelected(provider);
                  setStep(provider.needsKey ? "key" : "testing");
                  if (!provider.needsKey) {
                    setTimeout(() => handleTest(), 0);
                  }
                }}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                  selected.id === provider.id
                    ? "border-blade-accent bg-blade-surface"
                    : "border-blade-border hover:border-blade-muted"
                }`}
              >
                <div className="text-sm font-medium">{provider.name}</div>
                <div className="text-xs text-blade-muted">{provider.description}</div>
              </button>
            ))}
          </div>
        )}

        {step === "key" && (
          <div className="space-y-4">
            <div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste API key..."
                className="w-full bg-blade-surface border border-blade-border rounded-xl px-4 py-3 text-sm text-blade-text outline-none focus:border-blade-accent placeholder:text-blade-muted"
                autoFocus
              />
              <a
                href={selected.keyUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blade-accent hover:underline mt-2 inline-block"
              >
                Get a free {selected.name} key
              </a>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setStep("pick")}
                className="px-4 py-2 text-sm text-blade-muted hover:text-blade-text transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleTest}
                disabled={!apiKey.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium bg-blade-accent text-white rounded-xl disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                Test Connection
              </button>
            </div>
          </div>
        )}

        {step === "testing" && (
          <div className="space-y-4">
            {!testResult && !testError && (
              <div className="text-blade-muted text-sm animate-pulse">
                Testing {selected.name}...
              </div>
            )}
            {testResult && (
              <div className="space-y-3">
                <div className="px-4 py-3 bg-green-950 border border-green-900 rounded-xl text-green-400 text-sm">
                  Connected! Response: "{testResult}"
                </div>
                <button
                  onClick={handleSave}
                  className="w-full px-4 py-3 text-sm font-medium bg-blade-accent text-white rounded-xl hover:opacity-90 transition-opacity"
                >
                  Start using Blade
                </button>
              </div>
            )}
            {testError && (
              <div className="space-y-3">
                <div className="px-4 py-3 bg-red-950 border border-red-900 rounded-xl text-red-400 text-sm">
                  {testError}
                </div>
                <button
                  onClick={() => setStep("key")}
                  className="px-4 py-2 text-sm text-blade-muted hover:text-blade-text transition-colors"
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
