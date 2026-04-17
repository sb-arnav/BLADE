// src/components/InitWizard.tsx
// BLADE onboarding — 3 steps, under 30 seconds.
// Step 1: Connect AI provider (pick + paste key + test)
// Step 2: What's your name? (optional, skippable)
// Step 3: Done — straight into the app

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

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
    <div
      className="fixed inset-0 z-[50] flex items-center justify-center text-blade-text overflow-y-auto p-6"
      style={{
        background: "radial-gradient(ellipse 90% 70% at 20% 30%, rgba(88,50,220,0.35) 0%, transparent 60%), radial-gradient(ellipse 70% 90% at 85% 20%, rgba(40,20,140,0.3) 0%, transparent 55%), radial-gradient(ellipse 80% 60% at 70% 85%, rgba(160,30,90,0.2) 0%, transparent 60%), #050508",
      }}
    >
      <div
        className="w-full max-w-[440px] rounded-[24px] p-8"
        style={{
          background: "rgba(14,14,20,0.78)",
          backdropFilter: "blur(40px) saturate(1.6)",
          WebkitBackdropFilter: "blur(40px) saturate(1.6)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >

        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-10">
          <div className="w-8 h-8 rounded-[10px] flex items-center justify-center"
            style={{
              background: "linear-gradient(145deg, #7c3aed, #6366f1, #3b82f6)",
              boxShadow: "0 0 22px rgba(129,140,248,0.4), 0 4px 14px rgba(0,0,0,0.5)",
            }}>
            <div className="w-2 h-2 rounded-full bg-white" />
          </div>
          <span className="text-[12px] font-bold tracking-[0.34em] text-white">BLADE</span>
          {isReinit && (
            <span className="ml-auto text-[9.5px] font-semibold tracking-[0.08em] uppercase px-2 py-[3px] rounded-full border border-[rgba(255,255,255,0.15)] text-[rgba(255,255,255,0.4)]">
              Re-init
            </span>
          )}
        </div>

        {/* ── Step 1: Connect ──────────────────────────────────────────── */}
        {step === "connect" && (
          <div className="animate-fade-in">
            {!selectedProvider ? (
              <>
                <div className="mb-7">
                  <h2 className="text-[22px] font-bold text-white tracking-[-0.02em] leading-tight mb-1.5">
                    {isReinit ? "Pick a provider" : "Connect your AI brain"}
                  </h2>
                  <p className="text-[13px] text-[rgba(255,255,255,0.5)] leading-relaxed">
                    {isReinit
                      ? "Switch to a different provider or re-enter your key."
                      : "Free options available. You can switch any time."}
                  </p>
                </div>

                <div className="space-y-2">
                  {PROVIDERS.map((p) => {
                    const isFree = p.badge.toLowerCase().includes("free") || p.id === "ollama";
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
                        className="w-full text-left px-4 py-3.5 rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.025)] hover:border-[rgba(129,140,248,0.35)] hover:bg-[rgba(129,140,248,0.06)] transition-all group"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] font-semibold text-white">
                                {p.name}
                              </span>
                              {isFree && (
                                <span className="text-[9px] font-bold px-1.5 py-[1px] rounded-full bg-[rgba(74,222,128,0.12)] text-[#4ade80] border border-[rgba(74,222,128,0.25)]">
                                  FREE
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5">{p.badge}</div>
                          </div>
                          <svg
                            viewBox="0 0 24 24"
                            className="w-4 h-4 text-[rgba(255,255,255,0.25)] group-hover:text-[#818cf8] group-hover:translate-x-0.5 transition-all flex-shrink-0"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          >
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                {/* Back to provider list */}
                <button
                  onClick={() => {
                    setSelectedProvider(null);
                    setTestState("idle");
                  }}
                  className="flex items-center gap-1 text-2xs text-blade-muted hover:text-blade-secondary transition-colors mb-5"
                >
                  <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  {selectedProvider.name}
                </button>

                {selectedProvider.needsKey ? (
                  <>
                    <div className="mb-5">
                      <h2 className="text-base font-semibold text-blade-text tracking-tight">
                        Paste your API key.
                      </h2>
                      <p className="text-xs text-blade-muted mt-1">
                        Stored in your OS keychain — never leaves this device.
                      </p>
                    </div>

                    <input
                      ref={keyRef}
                      type="password"
                      value={apiKey}
                      onChange={(e) => { setApiKey(e.target.value); setTestState("idle"); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && apiKey.trim()) void handleTestKey();
                      }}
                      placeholder={selectedProvider.placeholder}
                      className="w-full bg-blade-surface border border-blade-border rounded-xl px-3.5 py-2.5 text-sm text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors font-mono"
                      autoComplete="off"
                    />

                    <button
                      onClick={() => openUrl(selectedProvider.keyUrl)}
                      className="text-2xs text-blade-accent hover:text-blade-accent/80 mt-2 inline-block transition-colors"
                    >
                      Get a free {selectedProvider.name} key ↗
                    </button>
                  </>
                ) : (
                  <div className="mb-5">
                    <h2 className="text-base font-semibold text-blade-text tracking-tight">
                      Connecting to Ollama…
                    </h2>
                    <p className="text-xs text-blade-muted mt-1">
                      Make sure Ollama is running locally.
                    </p>
                  </div>
                )}

                {/* Status feedback */}
                {testState === "testing" && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-blade-secondary">
                    <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse shrink-0" />
                    Testing connection…
                  </div>
                )}
                {testState === "ok" && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 text-xs flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    Connected
                  </div>
                )}
                {testState === "error" && (
                  <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
                    {testError}
                  </div>
                )}

                <div className="mt-4">
                  {testState !== "ok" ? (
                    <button
                      onClick={() => void handleTestKey()}
                      disabled={
                        (selectedProvider.needsKey && !apiKey.trim()) ||
                        testState === "testing"
                      }
                      className="w-full px-4 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-xl disabled:opacity-30 hover:bg-blade-accent/90 transition-colors"
                    >
                      {testState === "testing" ? "Testing…" : "Test connection"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setStep("name")}
                      className="w-full px-4 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-xl hover:bg-blade-accent/90 transition-colors"
                    >
                      Continue →
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Name ─────────────────────────────────────────────── */}
        {step === "name" && (
          <div className="animate-fade-in">
            <div className="mb-6">
              <h2 className="text-base font-semibold text-blade-text tracking-tight">
                What should BLADE call you?
              </h2>
              <p className="text-xs text-blade-muted mt-1">
                Used in responses and remembered. You can skip this.
              </p>
            </div>

            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setStep("ready");
              }}
              placeholder="Your name"
              autoFocus
              className="w-full bg-blade-surface border border-blade-border rounded-xl px-3.5 py-2.5 text-sm text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors"
            />

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setStep("ready")}
                className="flex-1 px-4 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-xl hover:bg-blade-accent/90 transition-colors"
              >
                {userName.trim() ? "Continue →" : "Skip →"}
              </button>
            </div>

            <button
              onClick={() => setStep("connect")}
              className="text-xs text-blade-muted hover:text-blade-secondary transition-colors mt-3 block mx-auto"
            >
              ← back
            </button>
          </div>
        )}

        {/* ── Step 3: Ready ────────────────────────────────────────────── */}
        {step === "ready" && (
          <div className="animate-fade-in text-center">
            {/* Animated orb */}
            <div className="relative w-16 h-16 mx-auto mb-6">
              <div className="absolute inset-0 rounded-full bg-blade-accent/15 animate-ping" style={{ animationDuration: "2s" }} />
              <div className="relative w-16 h-16 rounded-full bg-blade-accent-muted flex items-center justify-center border border-blade-accent/20">
                <div className="w-5 h-5 rounded-full bg-blade-accent shadow-[0_0_16px_rgba(99,102,241,0.6)]" />
              </div>
            </div>

            <h2 className="text-lg font-semibold text-blade-text tracking-tight mb-1">
              BLADE is online.
            </h2>
            <p className="text-xs text-blade-muted mb-6 leading-relaxed">
              {userName.trim()
                ? `Ready to work with you, ${userName.trim()}.`
                : "Your AI desktop assistant is ready."}
            </p>

            {/* Quick reference */}
            <div className="text-left space-y-1.5 mb-6">
              {[
                { keys: "Alt+Space", label: "Quick ask from anywhere" },
                { keys: "/settings", label: "Change provider or connect integrations" },
                { keys: "/init", label: "Redo this setup" },
              ].map(({ keys, label }) => (
                <div key={keys} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blade-surface border border-blade-border/60">
                  <code className="text-2xs font-mono text-blade-accent shrink-0">{keys}</code>
                  <span className="text-2xs text-blade-muted">{label}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => void handleFinish()}
              className="w-full px-4 py-2.5 text-sm font-semibold bg-blade-accent text-white rounded-xl hover:bg-blade-accent/90 transition-colors"
            >
              Let's go →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
