// src/components/InitWizard.tsx
// BLADE onboarding — 3 steps, under 30 seconds.
// Step 1: Connect AI provider (pick + paste key + test)
// Step 2: What's your name? (optional, skippable)
// Step 3: Done — straight into the app

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { GlassButton, GlassInput, Chip, OrbLogo, Wordmark, AmbientBackground, Divider } from "./ui/Glass";

// ── Providers ─────────────────────────────────────────────────────────────────

const PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    badge: "Free · Recommended",
    model: "gemini-2.0-flash",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
  },
  {
    id: "groq",
    name: "Groq",
    badge: "Free · Fastest",
    model: "llama-3.3-70b-versatile",
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    placeholder: "gsk_…",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    badge: "Best reasoning",
    model: "claude-sonnet-4-20250514",
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    placeholder: "sk-ant-…",
  },
  {
    id: "openai",
    name: "OpenAI",
    badge: "GPT-4o",
    model: "gpt-4o-mini",
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-…",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    badge: "200+ models · One key",
    model: "anthropic/claude-sonnet-4.5",
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-…",
  },
  {
    id: "ollama",
    name: "Ollama",
    badge: "Local · Offline",
    model: "llama3.2",
    needsKey: false,
    keyUrl: "",
    placeholder: "",
  },
];

type Provider = typeof PROVIDERS[0];
type Step = "connect" | "name" | "ready";

interface Props {
  onComplete: () => void;
  isReinit?: boolean;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function InitWizard({ onComplete, isReinit = false }: Props) {
  const [step, setStep] = useState<Step>("connect");

  // Connect sub-state
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");
  const keyRef = useRef<HTMLInputElement>(null);

  // Name step
  const [userName, setUserName] = useState("");

  // Auto-focus key input when provider is selected
  useEffect(() => {
    if (selectedProvider?.needsKey) {
      setTimeout(() => keyRef.current?.focus(), 80);
    }
  }, [selectedProvider]);

  const openUrl = (url: string) => {
    try { void tauriOpenUrl(url); } catch { window.open(url, "_blank"); }
  };

  const handleTestKey = async () => {
    if (!selectedProvider) return;
    setTestState("testing");
    setTestError("");
    try {
      await invoke("test_provider", {
        provider: selectedProvider.id,
        apiKey: selectedProvider.needsKey ? apiKey : "",
        model: selectedProvider.model,
      });
      setTestState("ok");
    } catch (e) {
      setTestState("error");
      setTestError(typeof e === "string" ? e : String(e));
    }
  };

  const handleFinish = async () => {
    if (!selectedProvider) return;
    await invoke("set_config", {
      provider: selectedProvider.id,
      apiKey: selectedProvider.needsKey ? apiKey : "",
      model: selectedProvider.model,
      tokenEfficient: false,
      userName: userName.trim(),
      workMode: "",
      responseStyle: "thorough",
      bladeEmail: "",
    });
    if (userName.trim()) {
      await invoke("set_persona", { content: `Name: ${userName.trim()}` }).catch(() => {});
    }
    // Run environment discovery silently in background
    invoke("run_discovery").catch(() => {});
    onComplete();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[50] text-white overflow-y-auto">
      <AmbientBackground />

      <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
        <div
          className="w-full max-w-[460px] rounded-[26px] p-10 animate-[fadeUp_0.6s_cubic-bezier(0.22,1,0.36,1)_both]"
          style={{
            background: "linear-gradient(155deg, rgba(22,22,32,0.82) 0%, rgba(14,14,22,0.86) 100%)",
            backdropFilter: "blur(44px) saturate(1.9)",
            WebkitBackdropFilter: "blur(44px) saturate(1.9)",
            border: "1px solid rgba(255,255,255,0.1)",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.06) inset, 0 40px 100px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,0,0,0.4), 0 0 80px rgba(129,140,248,0.08)",
          }}
        >
          {/* Top-edge specular highlight */}
          <div
            className="absolute left-0 right-0 top-0 h-[50%] rounded-t-[26px] pointer-events-none"
            style={{
              background: "linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 100%)",
            }}
          />

          <div className="relative z-10">
            {/* Header — orb + wordmark */}
            <div className="flex items-center gap-3 mb-10">
              <OrbLogo size={32} />
              <Wordmark className="text-[13px]" />
              {isReinit && (
                <Chip color="dim" size="xs" className="ml-auto">Re-init</Chip>
              )}
            </div>

            {/* ── Step 1: Connect ──────────────────────────────────────── */}
            {step === "connect" && (
              <div className="animate-[fadeUp_0.45s_cubic-bezier(0.22,1,0.36,1)_both]">
                {!selectedProvider ? (
                  <>
                    <div className="mb-8">
                      <p className="text-[10px] font-bold tracking-[0.24em] uppercase text-[#a5b4fc] mb-3">
                        Step 1 of 3
                      </p>
                      <h2 className="font-display text-[30px] font-bold text-white tracking-[-0.03em] leading-[1.05] mb-3">
                        {isReinit ? "Pick a provider." : "Connect your AI brain."}
                      </h2>
                      <p className="text-[13.5px] text-[rgba(255,255,255,0.55)] leading-[1.55]">
                        {isReinit
                          ? "Switch to a different provider or re-enter your key."
                          : "Free options available. Switch any time."}
                      </p>
                    </div>

                    <div className="space-y-[7px]">
                      {PROVIDERS.map((p, i) => {
                        const isFree = p.badge.toLowerCase().includes("free") || p.id === "ollama";
                        const accentTint = i === 0; // Recommended: Gemini gets the accent treatment
                        return (
                          <button
                            key={p.id + p.model}
                            onClick={() => {
                              setSelectedProvider(p);
                              setApiKey("");
                              setTestState("idle");
                              if (!p.needsKey) {
                                setTestState("testing");
                                invoke("test_provider", { provider: p.id, apiKey: "", model: p.model })
                                  .then(() => setTestState("ok"))
                                  .catch((e: unknown) => {
                                    setTestState("error");
                                    setTestError(typeof e === "string" ? e : String(e));
                                  });
                              }
                            }}
                            className={`group relative w-full text-left rounded-[14px] border transition-all duration-200 overflow-hidden
                              ${accentTint
                                ? "border-[rgba(129,140,248,0.35)] bg-[linear-gradient(155deg,rgba(129,140,248,0.1)_0%,rgba(129,140,248,0.03)_100%)] hover:border-[rgba(129,140,248,0.55)]"
                                : "border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] hover:border-[rgba(255,255,255,0.18)] hover:bg-[rgba(255,255,255,0.05)]"
                              } hover:translate-x-[2px] active:scale-[0.99]`}
                            style={{ animationDelay: `${i * 50}ms` }}
                          >
                            <div className="flex items-center gap-4 px-4 py-[14px]">
                              <div className={`w-[32px] h-[32px] rounded-[10px] flex items-center justify-center flex-shrink-0 font-serif font-semibold text-[15px] ${
                                accentTint
                                  ? "bg-[rgba(129,140,248,0.18)] text-[#a5b4fc] border border-[rgba(129,140,248,0.3)]"
                                  : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.7)] border border-[rgba(255,255,255,0.08)]"
                              }`}>
                                {p.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-[14px] font-semibold text-white tracking-[-0.005em]">
                                    {p.name}
                                  </span>
                                  {isFree && <Chip color="green" size="xs">Free</Chip>}
                                  {accentTint && <Chip color="accent" size="xs">Recommended</Chip>}
                                </div>
                                <div className="text-[11.5px] text-[rgba(255,255,255,0.42)] mt-[2px] leading-none">
                                  {p.badge.replace(/free\s*·\s*/i, "").replace(/Recommended\s*·?\s*/i, "") || p.badge}
                                </div>
                              </div>
                              <svg
                                viewBox="0 0 16 16"
                                className={`w-[14px] h-[14px] transition-all flex-shrink-0 ${
                                  accentTint ? "text-[#818cf8]" : "text-[rgba(255,255,255,0.25)] group-hover:text-white"
                                } group-hover:translate-x-[3px]`}
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M6 4l4 4-4 4" />
                              </svg>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <p className="mt-6 text-center text-[11px] text-[rgba(255,255,255,0.3)]">
                      Keys stored locally in your OS keychain.
                    </p>
                  </>
                ) : (
                  <>
                    {/* Back */}
                    <button
                      onClick={() => { setSelectedProvider(null); setTestState("idle"); }}
                      className="flex items-center gap-[5px] text-[11px] font-semibold tracking-[0.05em] text-[rgba(255,255,255,0.45)] hover:text-white transition-colors mb-6"
                    >
                      <svg viewBox="0 0 16 16" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 12L6 8l4-4" />
                      </svg>
                      {selectedProvider.name}
                    </button>

                    {selectedProvider.needsKey ? (
                      <>
                        <div className="mb-6">
                          <p className="text-[10px] font-bold tracking-[0.24em] uppercase text-[#a5b4fc] mb-3">
                            Step 1 of 3
                          </p>
                          <h2 className="font-display text-[26px] font-bold text-white tracking-[-0.025em] leading-[1.1] mb-2">
                            Paste your API key.
                          </h2>
                          <p className="text-[13px] text-[rgba(255,255,255,0.55)]">
                            Stored in your OS keychain. Never leaves this device.
                          </p>
                        </div>

                        <GlassInput
                          ref={keyRef}
                          type="password"
                          value={apiKey}
                          onChange={(e) => { setApiKey(e.target.value); setTestState("idle"); }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && apiKey.trim()) void handleTestKey();
                          }}
                          placeholder={selectedProvider.placeholder}
                          mono
                          autoComplete="off"
                        />

                        <button
                          onClick={() => openUrl(selectedProvider.keyUrl)}
                          className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#a5b4fc] hover:text-white transition-colors mt-3"
                        >
                          Get a free {selectedProvider.name} key
                          <svg viewBox="0 0 16 16" className="w-[11px] h-[11px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                            <path d="M6 3h7v7M13 3l-9 9" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <div className="mb-6">
                        <p className="text-[10px] font-bold tracking-[0.24em] uppercase text-[#a5b4fc] mb-3">
                          Step 1 of 3
                        </p>
                        <h2 className="font-display text-[26px] font-bold text-white tracking-[-0.025em] leading-[1.1] mb-2">
                          Connecting to Ollama…
                        </h2>
                        <p className="text-[13px] text-[rgba(255,255,255,0.55)]">
                          Make sure Ollama is running on localhost:11434.
                        </p>
                      </div>
                    )}

                    {/* Status feedback */}
                    {testState === "testing" && (
                      <div className="mt-5 flex items-center gap-2 text-[12px] text-[rgba(255,255,255,0.7)]">
                        <div className="w-[6px] h-[6px] rounded-full bg-[#818cf8] animate-pulse shrink-0"
                          style={{ boxShadow: "0 0 8px #818cf8" }} />
                        Testing connection…
                      </div>
                    )}
                    {testState === "ok" && (
                      <div className="mt-5 px-3 py-[10px] rounded-[10px] bg-[var(--green-weak)] border border-[var(--green-border)] text-[#86efac] text-[12px] flex items-center gap-2">
                        <svg viewBox="0 0 16 16" className="w-[12px] h-[12px] shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 8l3 3 7-7" />
                        </svg>
                        Connected. Let's go.
                      </div>
                    )}
                    {testState === "error" && (
                      <div className="mt-5 px-3 py-[10px] rounded-[10px] bg-[var(--red-weak)] border border-[var(--red-border)] text-[#fca5a5] text-[12px]">
                        {testError}
                      </div>
                    )}

                    <div className="mt-6">
                      {testState !== "ok" ? (
                        <GlassButton
                          onClick={() => void handleTestKey()}
                          disabled={(selectedProvider.needsKey && !apiKey.trim()) || testState === "testing"}
                          variant="primary"
                          size="lg"
                          className="w-full"
                        >
                          {testState === "testing" ? "Testing…" : "Test connection"}
                        </GlassButton>
                      ) : (
                        <GlassButton
                          onClick={() => setStep("name")}
                          variant="primary"
                          size="lg"
                          className="w-full"
                          trailingIcon={
                            <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 8h10M9 4l4 4-4 4" />
                            </svg>
                          }
                        >
                          Continue
                        </GlassButton>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Step 2: Name ─────────────────────────────────────────── */}
            {step === "name" && (
              <div className="animate-[fadeUp_0.45s_cubic-bezier(0.22,1,0.36,1)_both]">
                <div className="mb-8">
                  <p className="text-[10px] font-bold tracking-[0.24em] uppercase text-[#a5b4fc] mb-3">
                    Step 2 of 3
                  </p>
                  <h2 className="font-display text-[30px] font-bold text-white tracking-[-0.03em] leading-[1.05] mb-3">
                    What should BLADE call you?
                  </h2>
                  <p className="text-[13.5px] text-[rgba(255,255,255,0.55)] leading-[1.55]">
                    Used in responses and remembered. Feel free to skip.
                  </p>
                </div>

                <GlassInput
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") setStep("ready"); }}
                  placeholder="Your name"
                  autoFocus
                />

                <div className="flex gap-2 mt-6">
                  <GlassButton onClick={() => setStep("connect")} variant="secondary" size="lg">
                    Back
                  </GlassButton>
                  <GlassButton
                    onClick={() => setStep("ready")}
                    variant="primary"
                    size="lg"
                    className="flex-1"
                    trailingIcon={
                      <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8h10M9 4l4 4-4 4" />
                      </svg>
                    }
                  >
                    {userName.trim() ? "Continue" : "Skip"}
                  </GlassButton>
                </div>
              </div>
            )}

            {/* ── Step 3: Ready ────────────────────────────────────────── */}
            {step === "ready" && (
              <div className="animate-[fadeUp_0.45s_cubic-bezier(0.22,1,0.36,1)_both] text-center">
                <p className="text-[10px] font-bold tracking-[0.24em] uppercase text-[#a5b4fc] mb-5">
                  Step 3 of 3
                </p>

                {/* Big animated orb */}
                <div className="relative w-[84px] h-[84px] mx-auto mb-7">
                  <div
                    className="absolute inset-[-6px] rounded-full opacity-40"
                    style={{
                      background: "radial-gradient(circle, rgba(129,140,248,0.5) 0%, transparent 70%)",
                      animation: "pulseBreathe 3s ease-in-out infinite",
                    }}
                  />
                  <OrbLogo size={84} />
                </div>

                <h2 className="font-display text-[30px] font-bold text-white tracking-[-0.03em] leading-[1.05] mb-2">
                  BLADE is online.
                </h2>
                <p className="text-[13.5px] text-[rgba(255,255,255,0.55)] mb-8 leading-[1.55]">
                  {userName.trim()
                    ? <>Ready to work with you, <span className="text-white font-semibold">{userName.trim()}</span>.</>
                    : "Your AI desktop assistant is ready."}
                </p>

                {/* Quick reference shortcuts */}
                <div className="text-left space-y-2 mb-8">
                  {[
                    { keys: "Alt+Space", label: "Quick ask from anywhere" },
                    { keys: "Ctrl+Shift+V", label: "Voice input anywhere" },
                    { keys: "/settings", label: "Change provider or connect integrations" },
                  ].map(({ keys, label }) => (
                    <div
                      key={keys}
                      className="flex items-center gap-3 px-[14px] py-[10px] rounded-[12px] border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)]"
                    >
                      <code className="text-[10.5px] font-mono font-semibold tracking-wide text-[#a5b4fc] shrink-0 px-[6px] py-[2px] rounded bg-[var(--accent-weak)] border border-[var(--accent-border)]">
                        {keys}
                      </code>
                      <span className="text-[12px] text-[rgba(255,255,255,0.55)]">{label}</span>
                    </div>
                  ))}
                </div>

                <GlassButton
                  onClick={() => void handleFinish()}
                  variant="primary"
                  size="lg"
                  className="w-full"
                  trailingIcon={
                    <svg viewBox="0 0 16 16" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                  }
                >
                  Let's go
                </GlassButton>
              </div>
            )}
          </div>
        </div>
      </div>

      <Divider className="hidden" />
    </div>
  );
}
