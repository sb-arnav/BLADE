import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── Smart API key detection ──────────────────────────────────────────────

function detectProvider(key: string): { provider: string; model: string } | null {
  if (key.startsWith("sk-or-v1-")) return { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" };
  if (key.startsWith("sk-ant-")) return { provider: "anthropic", model: "claude-sonnet-4-20250514" };
  if (key.startsWith("sk-")) return { provider: "openai", model: "gpt-4o-mini" };
  if (key.startsWith("gsk_")) return { provider: "groq", model: "llama-3.3-70b-versatile" };
  if (key.startsWith("AIza")) return { provider: "gemini", model: "gemini-2.0-flash" };
  return null;
}

const PROVIDER_DETECT_LABELS: Record<string, string> = {
  openrouter: "Detected OpenRouter key — set model to llama-3.3-70b (free)",
  anthropic: "Detected Anthropic key — set model to Claude Sonnet 4",
  openai: "Detected OpenAI key — set model to gpt-4o-mini",
  groq: "Detected Groq key — set model to llama-3.3-70b",
  gemini: "Detected Gemini key — set model to gemini-2.0-flash",
};

const PROVIDER_FREE_TIER: Record<string, string> = {
  openrouter: "Free models available",
  gemini: "Generous free tier",
  groq: "Free tier available",
  ollama: "Completely free (local)",
  openai: "Paid only",
  anthropic: "Paid only",
};

// ─── Provider setup step ───────────────────────────────────────────────────

interface ProviderOption {
  id: string;
  name: string;
  defaultModel: string;
  keyPlaceholder: string;
  needsKey: boolean;
}

const PROVIDERS: ProviderOption[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    keyPlaceholder: "sk-or-v1-...",
    needsKey: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    keyPlaceholder: "AIza...",
    needsKey: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    defaultModel: "claude-sonnet-4-20250514",
    keyPlaceholder: "sk-ant-...",
    needsKey: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-4o-mini",
    keyPlaceholder: "sk-...",
    needsKey: true,
  },
  {
    id: "groq",
    name: "Groq",
    defaultModel: "llama-3.3-70b-versatile",
    keyPlaceholder: "gsk_...",
    needsKey: true,
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    defaultModel: "hermes3",
    keyPlaceholder: "no key required",
    needsKey: false,
  },
];

// ─── Personality questions ────────────────────────────────────────────────

const QUESTIONS = [
  {
    id: "identity",
    label: "What's your name and what do you do?",
    placeholder: "e.g. Arnav, indie developer building AI apps",
    hint: "BLADE will use this to address you correctly and understand your context.",
  },
  {
    id: "project",
    label: "What are you currently working on or building?",
    placeholder: "e.g. BLADE — a local-first AI agent desktop app",
    hint: "Your active project becomes BLADE's primary reference point.",
  },
  {
    id: "stack",
    label: "What tools, languages, or stack do you use most?",
    placeholder: "e.g. Rust, React, TypeScript, SQLite, Tauri",
    hint: "Separate with commas. BLADE won't suggest things you already know.",
  },
  {
    id: "goal",
    label: "What's your biggest goal right now?",
    placeholder: "e.g. Ship v1.0 of BLADE to 1000 users",
    hint: "BLADE will orient its suggestions toward this.",
  },
  {
    id: "comm",
    label: "How do you prefer I communicate?",
    placeholder: "e.g. brief & blunt / detailed / friendly",
    hint: "This shapes every response BLADE gives you.",
  },
];

// ─── Total step count: provider + scan + N personality steps ─────────────
const SCAN_STEP = 1;
const PERSONALITY_START = 2;
const TOTAL_STEPS = PERSONALITY_START + QUESTIONS.length;

// ─── Scan progress event payload ─────────────────────────────────────────

interface ScanProgressEvent {
  phase: string;
  found: number;
  detail: string;
}

interface Props {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Props) {
  // step 0 = provider setup; step 1 = system scan; steps 2..N = personality questions
  const [step, setStep] = useState(0);

  // Provider step state
  const [selectedProvider, setSelectedProvider] = useState<ProviderOption>(PROVIDERS[0]);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(PROVIDERS[0].defaultModel);
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState<string | null>(null);
  const [_providerSaved, setProviderSaved] = useState(false);

  // System scan state
  const [scanState, setScanState] = useState<"idle" | "running" | "done">("idle");
  const [scanPhases, setScanPhases] = useState<ScanProgressEvent[]>([]);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const scanLogRef = useRef<HTMLDivElement>(null);

  // Personality step state
  const [answers, setAnswers] = useState<string[]>(Array(QUESTIONS.length).fill(""));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectedToast, setDetectedToast] = useState<string | null>(null);

  // ── Auto-scroll scan log ───────────────────────────────────────────────

  useEffect(() => {
    if (scanLogRef.current) {
      scanLogRef.current.scrollTop = scanLogRef.current.scrollHeight;
    }
  }, [scanPhases]);

  // ── Provider step helpers ──────────────────────────────────────────────

  const handleProviderChange = (providerId: string) => {
    const p = PROVIDERS.find((x) => x.id === providerId) ?? PROVIDERS[0];
    setSelectedProvider(p);
    setModel(p.defaultModel);
    setApiKey("");
    setTestState("idle");
    setTestMessage(null);
    setProviderSaved(false);
  };

  const handleTest = async () => {
    setTestState("testing");
    setTestMessage(null);
    try {
      const result = await invoke<string>("test_provider", {
        provider: selectedProvider.id,
        apiKey: apiKey.trim(),
        model: model.trim(),
        baseUrl: null,
      });
      setTestState("ok");
      setTestMessage(result);
    } catch (e) {
      setTestState("fail");
      setTestMessage(typeof e === "string" ? e : "Connection failed — check key and model.");
    }
  };

  const handleSaveProvider = async () => {
    setSaving(true);
    setError(null);
    try {
      await invoke("set_config", {
        provider: selectedProvider.id,
        apiKey: apiKey.trim(),
        model: model.trim(),
        baseUrl: null,
      });
      setProviderSaved(true);
      setStep(SCAN_STEP);
    } catch (e) {
      setError(typeof e === "string" ? e : "Failed to save provider settings.");
    } finally {
      setSaving(false);
    }
  };

  const canSaveProvider =
    model.trim().length > 0 &&
    (selectedProvider.needsKey ? apiKey.trim().length > 0 : true);

  // ── System scan helpers ────────────────────────────────────────────────

  const handleStartScan = async () => {
    setScanState("running");
    setScanPhases([]);
    setScanSummary(null);

    // Listen to progress events
    const unlisten = await listen<ScanProgressEvent>("deep_scan_progress", (event) => {
      setScanPhases((prev) => {
        // Update existing phase or append new one
        const idx = prev.findIndex((p) => p.phase === event.payload.phase);
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = event.payload;
          return updated;
        }
        return [...prev, event.payload];
      });
    });

    try {
      await invoke("deep_scan_start");
      const summary = await invoke<string>("deep_scan_summary");
      setScanSummary(summary);
      setScanState("done");
    } catch (e) {
      setScanState("done");
      setScanSummary(null);
    } finally {
      unlisten();
    }
  };

  // ── Personality step helpers ───────────────────────────────────────────

  const questionIndex = step - PERSONALITY_START; // 0-based index into QUESTIONS
  const current = QUESTIONS[questionIndex] ?? QUESTIONS[0];
  const isLastQuestion = questionIndex === QUESTIONS.length - 1;
  const canAdvanceQuestion = answers[questionIndex]?.trim().length > 0;

  const handleNext = async () => {
    if (!canAdvanceQuestion) return;
    if (!isLastQuestion) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await invoke("complete_onboarding", { answers });
      onComplete();
    } catch (e) {
      setError(typeof e === "string" ? e : "Something went wrong. Try again.");
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    // Step 0: skip provider — use Ollama defaults
    if (step === 0) {
      setSaving(true);
      try {
        await invoke("set_config", {
          provider: "ollama",
          apiKey: "",
          model: "hermes3",
          baseUrl: null,
        });
      } catch {
        // best effort
      } finally {
        setSaving(false);
      }
      setStep(SCAN_STEP);
      return;
    }

    // Step 1: skip scan — go straight to personality
    if (step === SCAN_STEP) {
      setStep(PERSONALITY_START);
      return;
    }

    // Personality steps: fill empties with placeholders and finish
    setSaving(true);
    setError(null);
    const filledAnswers = answers.map((a, i) =>
      a.trim() ? a : QUESTIONS[i].placeholder
    );
    try {
      await invoke("complete_onboarding", { answers: filledAnswers });
      onComplete();
    } catch (e) {
      setError(typeof e === "string" ? e : "Something went wrong.");
      setSaving(false);
    }
  };

  // ── Header text per step ──────────────────────────────────────────────

  const headerTitle =
    step === 0
      ? "Connect your AI provider"
      : step === SCAN_STEP
      ? "Let me get to know your machine"
      : "Let's get to know you";

  const headerSub =
    step === 0
      ? "Pick a provider and paste your API key to get started."
      : step === SCAN_STEP
      ? "BLADE will scan your system to understand your setup — apps, projects, tools."
      : `${QUESTIONS.length} quick questions so BLADE can actually be useful from the start.`;

  // ── Summary lines: split on newlines ─────────────────────────────────

  const summaryLines = scanSummary
    ? scanSummary.split("\n").filter((l) => l.trim().length > 0)
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md mx-4 bg-blade-bg border border-blade-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-blade-border/50">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-6 h-6 rounded-md bg-blade-accent-muted flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blade-accent" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight text-blade-text">
              {headerTitle}
            </h2>
          </div>
          <p className="text-2xs text-blade-muted leading-relaxed">
            {headerSub}
          </p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-1.5 px-6 pt-4">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-0.5 flex-1 rounded-full transition-all duration-300 ${
                i < step
                  ? "bg-blade-accent"
                  : i === step
                  ? "bg-blade-accent/60"
                  : "bg-blade-border"
              }`}
            />
          ))}
        </div>

        {/* ── Step 0: Provider setup ── */}
        {step === 0 && (
          <div className="px-6 py-5 animate-fade-in space-y-4">
            {/* Provider selector */}
            <div>
              <label className="block text-[0.8125rem] font-medium text-blade-text mb-1.5">
                Provider
              </label>
              <select
                value={selectedProvider.id + "|" + selectedProvider.name}
                onChange={(e) => {
                  const [id] = e.target.value.split("|");
                  handleProviderChange(id);
                }}
                className="w-full bg-blade-surface border border-blade-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-blade-text outline-none focus:border-blade-accent/50 transition-colors appearance-none"
              >
                {PROVIDERS.map((p) => {
                  const freeTier = PROVIDER_FREE_TIER[p.id];
                  const label = freeTier ? `${p.name}  —  ${freeTier}` : p.name;
                  return (
                    <option key={p.id + p.name} value={p.id + "|" + p.name}>
                      {label}
                    </option>
                  );
                })}
              </select>
              {selectedProvider && PROVIDER_FREE_TIER[selectedProvider.id] && (
                <p className={`text-2xs mt-1 ${!PROVIDER_FREE_TIER[selectedProvider.id].includes("Paid") ? "text-emerald-400/80" : "text-blade-muted/60"}`}>
                  {PROVIDER_FREE_TIER[selectedProvider.id]}
                </p>
              )}
            </div>

            {/* API key */}
            <div>
              <label className="block text-[0.8125rem] font-medium text-blade-text mb-1.5">
                API Key
                {!selectedProvider.needsKey && (
                  <span className="ml-2 text-2xs text-blade-muted font-normal">
                    (not required for Ollama)
                  </span>
                )}
              </label>
              <input
                type="password"
                className="w-full bg-blade-surface border border-blade-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors"
                placeholder={selectedProvider.keyPlaceholder}
                value={apiKey}
                disabled={!selectedProvider.needsKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setApiKey(val);
                  setTestState("idle");
                  setTestMessage(null);
                  const detected = detectProvider(val.trim());
                  if (detected) {
                    const matchedProvider = PROVIDERS.find(p => p.id === detected.provider);
                    if (matchedProvider) {
                      setSelectedProvider(matchedProvider);
                    }
                    setModel(detected.model);
                    setDetectedToast(PROVIDER_DETECT_LABELS[detected.provider] ?? `Detected ${detected.provider}`);
                    setTimeout(() => setDetectedToast(null), 4000);
                  }
                }}
              />
              {/* Auto-detect toast */}
              {detectedToast && (
                <div className="flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-blade-accent/10 border border-blade-accent/30 text-blade-accent text-2xs">
                  <svg viewBox="0 0 16 16" className="w-3 h-3 shrink-0" fill="currentColor"><path d="M13.354 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>
                  {detectedToast}
                </div>
              )}
            </div>

            {/* Model name */}
            <div>
              <label className="block text-[0.8125rem] font-medium text-blade-text mb-1.5">
                Model
              </label>
              <input
                type="text"
                className="w-full bg-blade-surface border border-blade-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors font-mono"
                placeholder="model name"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setTestState("idle");
                  setTestMessage(null);
                }}
              />
            </div>

            {/* Test connection */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTest}
                disabled={!canSaveProvider || testState === "testing" || saving}
                className="px-3 py-2 text-xs font-medium border border-blade-border text-blade-secondary rounded-lg hover:border-blade-accent/40 hover:text-blade-accent transition-colors disabled:opacity-30"
              >
                {testState === "testing" ? "Testing…" : "Test Connection"}
              </button>
              {testState === "ok" && (
                <span className="text-xs text-green-400 truncate">{testMessage ?? "Connected"}</span>
              )}
              {testState === "fail" && (
                <span className="text-xs text-red-400 truncate">{testMessage ?? "Failed"}</span>
              )}
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
                {error}
              </div>
            )}
          </div>
        )}

        {/* ── Step 1: System Scan ── */}
        {step === SCAN_STEP && (
          <div className="px-6 py-5 animate-fade-in space-y-4">

            {/* Idle state: show start button */}
            {scanState === "idle" && (
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="text-center space-y-1.5">
                  <p className="text-[0.8125rem] text-blade-text font-medium">
                    Scan your system
                  </p>
                  <p className="text-2xs text-blade-muted leading-relaxed max-w-xs mx-auto">
                    BLADE will look at your installed apps, git repos, shell history, and
                    environment to build a picture of your setup. Nothing leaves your machine.
                  </p>
                </div>
                <button
                  onClick={handleStartScan}
                  className="px-5 py-2.5 text-xs font-semibold bg-blade-accent text-white rounded-lg hover:bg-blade-accent-hover transition-colors"
                >
                  Start Scan
                </button>
              </div>
            )}

            {/* Running / done: show progress log */}
            {scanState !== "idle" && (
              <div className="space-y-3">
                {/* Phase log */}
                <div
                  ref={scanLogRef}
                  className="bg-blade-surface border border-blade-border rounded-xl px-3 py-2.5 space-y-1.5 max-h-44 overflow-y-auto"
                >
                  {scanPhases.length === 0 && scanState === "running" && (
                    <p className="text-2xs text-blade-muted animate-pulse">Initialising scan…</p>
                  )}
                  {scanPhases.map((p, i) => (
                    <div key={i} className="flex items-baseline justify-between gap-3">
                      <span className="text-2xs text-blade-text leading-relaxed flex-1 min-w-0 truncate">
                        {p.detail || p.phase}
                      </span>
                      {p.found > 0 && (
                        <span className="text-2xs text-blade-accent tabular-nums shrink-0">
                          {p.found}
                        </span>
                      )}
                    </div>
                  ))}
                  {scanState === "running" && scanPhases.length > 0 && (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <span className="w-1 h-1 rounded-full bg-blade-accent animate-pulse" />
                      <span className="w-1 h-1 rounded-full bg-blade-accent animate-pulse [animation-delay:0.2s]" />
                      <span className="w-1 h-1 rounded-full bg-blade-accent animate-pulse [animation-delay:0.4s]" />
                    </div>
                  )}
                </div>

                {/* Progress bar fill while running */}
                {scanState === "running" && (
                  <div className="h-0.5 rounded-full bg-blade-border overflow-hidden">
                    <div className="h-full bg-blade-accent rounded-full animate-[progress-indeterminate_1.6s_ease-in-out_infinite]" />
                  </div>
                )}

                {/* Summary when done */}
                {scanState === "done" && summaryLines.length > 0 && (
                  <div className="bg-blade-surface border border-blade-accent/20 rounded-xl px-3 py-2.5 space-y-1">
                    <p className="text-2xs font-semibold text-blade-accent uppercase tracking-wide mb-1.5">
                      Summary
                    </p>
                    {summaryLines.map((line, i) => (
                      <p key={i} className="text-2xs text-blade-text leading-relaxed">
                        {line}
                      </p>
                    ))}
                  </div>
                )}

                {scanState === "done" && !scanSummary && (
                  <p className="text-2xs text-blade-muted text-center">
                    Scan complete.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Steps 2+: Personality questions ── */}
        {step >= PERSONALITY_START && (
          <div className="px-6 py-5">
            <div key={step} className="animate-fade-in">
              <p className="text-2xs text-blade-muted mb-1.5">
                {questionIndex + 1} of {QUESTIONS.length}
              </p>
              <label className="block text-[0.8125rem] font-medium text-blade-text mb-3">
                {current.label}
              </label>
              <textarea
                className="w-full bg-blade-surface border border-blade-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors resize-none"
                rows={3}
                placeholder={current.placeholder}
                value={answers[questionIndex] ?? ""}
                autoFocus
                onChange={(e) => {
                  const updated = [...answers];
                  updated[questionIndex] = e.target.value;
                  setAnswers(updated);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleNext();
                  }
                }}
              />
              <p className="text-2xs text-blade-muted mt-1.5 leading-relaxed">
                {current.hint}
              </p>
            </div>

            {error && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
                {error}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={handleSkip}
            disabled={saving || (step === SCAN_STEP && scanState === "running")}
            className="text-xs text-blade-muted hover:text-blade-secondary transition-colors disabled:opacity-40"
          >
            {step === 0
              ? "Skip for now"
              : step === SCAN_STEP
              ? "Skip scan"
              : "Skip setup"}
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={saving || (step === SCAN_STEP && scanState === "running")}
                className="px-3 py-2 text-xs text-blade-muted hover:text-blade-secondary transition-colors disabled:opacity-40"
              >
                Back
              </button>
            )}

            {step === 0 && (
              <button
                onClick={handleSaveProvider}
                disabled={!canSaveProvider || saving}
                className="px-4 py-2 text-xs font-medium bg-blade-accent text-white rounded-lg disabled:opacity-30 hover:bg-blade-accent-hover transition-colors"
              >
                {saving ? "Saving…" : "Next"}
              </button>
            )}

            {step === SCAN_STEP && scanState === "done" && (
              <button
                onClick={() => setStep(PERSONALITY_START)}
                className="px-4 py-2 text-xs font-medium bg-blade-accent text-white rounded-lg hover:bg-blade-accent-hover transition-colors"
              >
                Continue
              </button>
            )}

            {step >= PERSONALITY_START && (
              <button
                onClick={handleNext}
                disabled={!canAdvanceQuestion || saving}
                className="px-4 py-2 text-xs font-medium bg-blade-accent text-white rounded-lg disabled:opacity-30 hover:bg-blade-accent-hover transition-colors"
              >
                {saving ? "Saving…" : isLastQuestion ? "Finish" : "Next"}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
