// src/components/InitWizard.tsx
// BLADE onboarding — 3 steps, under 30 seconds.
// Step 1: Pick a provider
// Step 2: Paste API key
// Step 3: Ready / calibrating
//
// Design matches /docs/design/onboarding-*.html — liquid glass over a vibrant
// wallpaper, with step pills, colored provider logos, and white primary button.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

// ── Providers ─────────────────────────────────────────────────────────────────

interface ProviderEntry {
  id: string;
  name: string;
  sub: string;
  model: string;
  needsKey: boolean;
  keyUrl: string;
  placeholder: string;
  keyDomain: string;
  logoChar: string;
  logoClass: string; // maps to a gradient below
  chip?: "free" | "new" | "pro" | null;
}

const PROVIDERS: ProviderEntry[] = [
  { id: "anthropic",  name: "Anthropic",   sub: "Claude Opus · Sonnet · Haiku",  model: "claude-sonnet-4-20250514",            needsKey: true,  keyUrl: "https://console.anthropic.com/settings/keys", placeholder: "sk-ant-api03-…", keyDomain: "console.anthropic.com", logoChar: "A", logoClass: "anthropic", chip: "pro" },
  { id: "openai",     name: "OpenAI",      sub: "GPT-5 · 4.1 · o-series",       model: "gpt-4o-mini",                          needsKey: true,  keyUrl: "https://platform.openai.com/api-keys",        placeholder: "sk-…",           keyDomain: "platform.openai.com",   logoChar: "O", logoClass: "openai",    chip: null  },
  { id: "gemini",     name: "Google",      sub: "Gemini 2.5 Pro · Flash",       model: "gemini-2.0-flash",                     needsKey: true,  keyUrl: "https://aistudio.google.com/apikey",          placeholder: "AIza…",          keyDomain: "aistudio.google.com",   logoChar: "G", logoClass: "google",    chip: null  },
  { id: "groq",       name: "Groq",        sub: "Llama · Mixtral · Whisper",     model: "llama-3.3-70b-versatile",              needsKey: true,  keyUrl: "https://console.groq.com/keys",               placeholder: "gsk_…",          keyDomain: "console.groq.com",      logoChar: "⚡", logoClass: "groq",      chip: "new" },
  { id: "ollama",     name: "Ollama",      sub: "Local models · no network",    model: "llama3.2",                             needsKey: false, keyUrl: "",                                            placeholder: "",               keyDomain: "ollama.com",            logoChar: "◉", logoClass: "ollama",    chip: "free" },
  { id: "openrouter", name: "OpenRouter",  sub: "Any model, one key",           model: "anthropic/claude-sonnet-4.5",          needsKey: true,  keyUrl: "https://openrouter.ai/keys",                  placeholder: "sk-or-v1-…",     keyDomain: "openrouter.ai",         logoChar: "↯", logoClass: "openrouter", chip: null  },
];

const LOGO_GRADIENTS: Record<string, string> = {
  anthropic:  "linear-gradient(135deg, #c96442, #f0a97e)",
  openai:     "linear-gradient(135deg, #0f8a60, #10b27a)",
  google:     "linear-gradient(135deg, #4285f4, #34a0f5)",
  groq:       "linear-gradient(135deg, #f55036, #ff7a50)",
  ollama:     "linear-gradient(135deg, #2c2c2c, #555)",
  openrouter: "linear-gradient(135deg, #5b5fe8, #8b6fff)",
};

type Step = "connect" | "apikey" | "ready";

interface Props {
  onComplete: () => void;
  isReinit?: boolean;
}

// ── Shared atoms ──────────────────────────────────────────────────────────────

function BrandBadge() {
  return (
    <div className="flex items-center gap-[14px]">
      <div
        className="w-[52px] h-[52px] rounded-[16px] grid place-items-center text-[20px] font-extrabold"
        style={{
          background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)",
          color: "#1a0b2a",
          letterSpacing: "-0.04em",
          boxShadow: "inset 0 1px 0 #fff, 0 10px 30px rgba(0,0,0,0.35)",
        }}
      >
        B
      </div>
      <div>
        <div className="font-semibold text-[17px] text-white" style={{ letterSpacing: "-0.02em" }}>BLADE</div>
        <div className="text-[12px]" style={{ color: "var(--t-3)" }}>Your personal intelligence</div>
      </div>
    </div>
  );
}

function StepPills({ step }: { step: Step }) {
  const stepIndex = step === "connect" ? 0 : step === "apikey" ? 1 : 2;
  const steps = [
    { label: "Provider", n: 1 },
    { label: "Key",      n: 2 },
    { label: "Ready",    n: 3 },
  ];
  return (
    <div className="flex items-center gap-[10px]">
      {steps.map((s, i) => {
        const state = i < stepIndex ? "done" : i === stepIndex ? "active" : "idle";
        const isActive = state === "active";
        const isDone = state === "done";
        return (
          <div key={s.label} className="flex items-center gap-[10px]">
            <div
              className={`flex items-center gap-[10px] py-[8px] pr-[16px] pl-[10px] rounded-full text-[12px] border`}
              style={{
                background: isActive ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                borderColor: isActive ? "var(--g-edge-mid)" : "var(--g-edge-lo)",
                color: isActive ? "var(--t-1)" : isDone ? "var(--t-2)" : "var(--t-3)",
              }}
            >
              <span
                className="w-[20px] h-[20px] rounded-full grid place-items-center text-[11px] font-semibold"
                style={
                  isDone
                    ? {
                        background: "rgba(138,255,199,0.22)",
                        border: "1px solid rgba(138,255,199,0.4)",
                        color: "transparent",
                        backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238affc7' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>")`,
                        backgroundSize: "12px",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                      }
                    : isActive
                      ? { background: "#fff", color: "#1a0b2a" }
                      : { background: "rgba(255,255,255,0.08)", color: "var(--t-3)" }
                }
              >
                {!isDone && s.n}
              </span>
              {s.label}
            </div>
            {i < steps.length - 1 && (
              <div className="w-[18px] h-px" style={{ background: "var(--line-strong)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Wallpaper() {
  return (
    <>
      <div className="wallpaper-v2" />
      <div className="vignette-v2" />
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function InitWizard({ onComplete, isReinit = false }: Props) {
  const [step, setStep] = useState<Step>("connect");
  const [selectedProvider, setSelectedProvider] = useState<ProviderEntry | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");
  const [userName, setUserName] = useState("");
  const [scanPct, setScanPct] = useState(0);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "apikey" && selectedProvider?.needsKey) {
      setTimeout(() => keyRef.current?.focus(), 80);
    }
  }, [step, selectedProvider]);

  // Animate scan progress on ready step
  useEffect(() => {
    if (step !== "ready") return;
    const start = Date.now();
    const iv = setInterval(() => {
      const pct = Math.min(100, Math.round(((Date.now() - start) / 5000) * 100));
      setScanPct(pct);
      if (pct >= 100) clearInterval(iv);
    }, 80);
    return () => clearInterval(iv);
  }, [step]);

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

  const handleContinueFromProvider = () => {
    if (!selectedProvider) return;
    if (selectedProvider.needsKey) {
      setStep("apikey");
    } else {
      // Ollama — no key needed, test directly then go ready
      void handleTestKey().then(() => setStep("ready"));
    }
  };

  const handleContinueFromApiKey = () => {
    if (testState === "ok") setStep("ready");
    else void handleTestKey().then(() => setStep("ready"));
  };

  const handleFinish = async () => {
    if (!selectedProvider) return;
    try {
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
      invoke("run_discovery").catch(() => {});
    } catch { /* ignore */ }
    onComplete();
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40, overflow: "hidden" }}>
      <Wallpaper />

      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 2,
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        {step === "connect" && (
          <div className="g2 g2-heavy" style={{ width: 900, maxWidth: "95vw", padding: "56px 64px 52px", borderRadius: "var(--r-2xl)" }}>
            <div className="flex items-start justify-between">
              <BrandBadge />
              <StepPills step={step} />
            </div>

            <h1 className="td-h1 text-white mt-[28px]">{isReinit ? "Switch provider." : "Pick a provider."}</h1>
            <p className="td-body mt-[12px]" style={{ color: "var(--t-2)", maxWidth: 620 }}>
              BLADE routes across many models. Pick one to start — stack more whenever you like. Everything stays on your machine.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginTop: 34 }}>
              {PROVIDERS.map((p) => {
                const selected = selectedProvider?.id === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      padding: "18px 20px",
                      borderRadius: "var(--r-md)",
                      background: selected ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.05)",
                      border: `1px solid ${selected ? "rgba(255,255,255,0.4)" : "var(--g-edge-lo)"}`,
                      boxShadow: selected ? "inset 0 1px 0 rgba(255,255,255,0.25), 0 8px 24px rgba(0,0,0,0.25)" : "none",
                      transition: "all 180ms cubic-bezier(0.2,0.8,0.2,1)",
                      cursor: "pointer",
                      position: "relative",
                      textAlign: "left",
                      color: "var(--t-1)",
                    }}
                    onMouseEnter={(e) => {
                      if (!selected) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.09)";
                        e.currentTarget.style.borderColor = "var(--g-edge-mid)";
                        e.currentTarget.style.transform = "translateY(-1px)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!selected) {
                        e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                        e.currentTarget.style.borderColor = "var(--g-edge-lo)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        display: "grid",
                        placeItems: "center",
                        fontWeight: 700,
                        fontSize: 16,
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)",
                        flexShrink: 0,
                        background: LOGO_GRADIENTS[p.logoClass],
                        color: "#fff",
                      }}
                    >
                      {p.logoChar}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}>
                      <div className="font-semibold text-[15px]" style={{ letterSpacing: "-0.01em" }}>{p.name}</div>
                      <div className="text-[12px]" style={{ color: "var(--t-3)" }}>{p.sub}</div>
                    </div>
                    {p.chip && (
                      <span className={`chip2 ${p.chip === "free" ? "chip2-free" : p.chip === "new" ? "chip2-new" : "chip2-pro"}`}>
                        {p.chip === "pro" ? "Recommended" : p.chip}
                      </span>
                    )}
                    {selected && (
                      <div
                        style={{
                          position: "absolute",
                          top: 14,
                          right: 14,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#fff",
                          backgroundImage:
                            `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231a0b2a' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='20 6 9 17 4 12'/></svg>")`,
                          backgroundSize: 14,
                          backgroundPosition: "center",
                          backgroundRepeat: "no-repeat",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 34,
                paddingTop: 24,
                borderTop: "1px solid var(--line)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--t-3)" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Keys are encrypted in your OS keychain. BLADE never phones home.
              </div>
              <button
                className="btn2-primary"
                onClick={handleContinueFromProvider}
                disabled={!selectedProvider}
                style={{ padding: "16px 28px", fontSize: 15 }}
              >
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {step === "apikey" && selectedProvider && (
          <div className="g2 g2-heavy" style={{ width: 760, maxWidth: "95vw", padding: "56px 64px 52px", borderRadius: "var(--r-2xl)" }}>
            <div className="flex items-start justify-between">
              <BrandBadge />
              <StepPills step={step} />
            </div>

            {/* Provider tag */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 14px 8px 8px",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid var(--g-edge-mid)",
                borderRadius: "var(--r-pill)",
                fontSize: 13,
                fontWeight: 500,
                marginTop: 28,
                marginBottom: 14,
              }}
            >
              <div style={{ width: 26, height: 26, borderRadius: 8, display: "grid", placeItems: "center", background: LOGO_GRADIENTS[selectedProvider.logoClass], color: "#fff", fontWeight: 700, fontSize: 12 }}>
                {selectedProvider.logoChar}
              </div>
              {selectedProvider.name}
            </div>

            <h1 className="td-h1 text-white" style={{ fontSize: 40 }}>Paste your key.</h1>
            <p className="td-small mt-[12px]" style={{ color: "var(--t-2)", fontSize: 15, maxWidth: 560 }}>
              Find it at{" "}
              <span
                className="mono"
                style={{ color: "var(--t-1)", fontSize: 13, padding: "1px 6px", background: "rgba(255,255,255,0.08)", borderRadius: 4 }}
              >
                {selectedProvider.keyDomain}
              </span>{" "}
              → API keys. BLADE stores it encrypted in your OS keychain.
            </p>

            <div style={{ marginTop: 32 }}>
              <label className="td-micro" style={{ display: "block", marginBottom: 10 }}>
                {selectedProvider.name} API Key
              </label>
              <div style={{ position: "relative" }}>
                <input
                  ref={keyRef}
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTestState("idle"); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) void handleTestKey(); }}
                  placeholder={selectedProvider.placeholder}
                  autoComplete="off"
                  style={{
                    width: "100%",
                    padding: "18px 200px 18px 52px",
                    fontFamily: "var(--font-num)",
                    fontSize: 14,
                    letterSpacing: "0.02em",
                    color: "var(--t-1)",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid var(--g-edge-mid)",
                    borderRadius: "var(--r-md)",
                    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.3)",
                    outline: "none",
                  }}
                />
                <span
                  style={{
                    position: "absolute",
                    left: 18,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--t-3)",
                    pointerEvents: "none",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                  </svg>
                </span>
                <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", gap: 6 }}>
                  <button
                    className="btn2-secondary"
                    style={{ padding: "8px 14px", fontSize: 12 }}
                    onClick={async () => {
                      try {
                        const t = await navigator.clipboard.readText();
                        setApiKey(t);
                      } catch {}
                    }}
                  >
                    Paste
                  </button>
                  <button
                    className="btn2-primary"
                    style={{ padding: "8px 14px", fontSize: 12 }}
                    onClick={() => void handleTestKey()}
                    disabled={!apiKey.trim() || testState === "testing"}
                  >
                    {testState === "testing" ? "Testing…" : "Test"}
                  </button>
                </div>
              </div>

              {testState === "ok" && (
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    borderRadius: "var(--r-md)",
                    background: "rgba(138,255,199,0.10)",
                    border: "1px solid rgba(138,255,199,0.3)",
                    fontSize: 13,
                    color: "#c4ffe0",
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#8affc7", boxShadow: "0 0 10px #8affc7" }} />
                  <div>Key verified. Ready to go.</div>
                </div>
              )}
              {testState === "error" && (
                <div
                  style={{
                    marginTop: 14,
                    padding: "12px 16px",
                    borderRadius: "var(--r-md)",
                    background: "rgba(255,154,176,0.10)",
                    border: "1px solid rgba(255,154,176,0.3)",
                    fontSize: 13,
                    color: "#ffccd8",
                  }}
                >
                  {testError}
                </div>
              )}

              <button
                onClick={() => openUrl(selectedProvider.keyUrl)}
                style={{
                  marginTop: 14,
                  background: "none",
                  border: "none",
                  color: "var(--a-cool)",
                  fontSize: 13,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                Get a free {selectedProvider.name} key
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M7 17 17 7M7 7h10v10" />
                </svg>
              </button>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 40,
                paddingTop: 24,
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                onClick={() => setStep("connect")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--t-2)",
                  fontSize: 13,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <button
                className="btn2-primary"
                style={{ padding: "16px 28px", fontSize: 15 }}
                onClick={handleContinueFromApiKey}
                disabled={selectedProvider.needsKey && !apiKey.trim()}
              >
                Continue
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {step === "ready" && (
          <div
            className="g2 g2-heavy"
            style={{
              width: 820,
              maxWidth: "95vw",
              padding: "72px 80px 56px",
              borderRadius: "var(--r-2xl)",
              textAlign: "center",
            }}
          >
            <div style={{ display: "flex", justifyContent: "center" }}>
              <StepPills step={step} />
            </div>

            <div
              style={{
                width: 128,
                height: 128,
                borderRadius: 40,
                background: "linear-gradient(135deg, rgba(255,255,255,0.95) 0%, rgba(255,255,255,0.65) 100%)",
                color: "#1a0b2a",
                display: "grid",
                placeItems: "center",
                fontWeight: 800,
                fontSize: 52,
                letterSpacing: "-0.04em",
                margin: "36px auto 28px",
                boxShadow:
                  "inset 0 2px 0 #fff, 0 30px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.3), 0 0 120px rgba(255,255,255,0.18)",
                position: "relative",
              }}
            >
              B
            </div>

            <h1 className="td-display text-white">You're in.</h1>
            <p className="td-body mt-[14px]" style={{ color: "var(--t-2)", fontSize: 17, maxWidth: 560, margin: "14px auto 0" }}>
              BLADE is reading your system to calibrate. This takes a few seconds. You'll never do it again.
            </p>

            {/* Scan ring */}
            <div
              style={{
                marginTop: 44,
                padding: "20px 24px",
                borderRadius: "var(--r-lg)",
                background: "rgba(0,0,0,0.22)",
                border: "1px solid var(--g-edge-mid)",
                display: "flex",
                alignItems: "center",
                gap: 20,
                textAlign: "left",
              }}
            >
              <div style={{ position: "relative", width: 56, height: 56, flexShrink: 0 }}>
                <svg width="56" height="56" viewBox="0 0 44 44">
                  <circle cx="22" cy="22" r="20" stroke="rgba(255,255,255,0.12)" strokeWidth="3" fill="none" />
                  <circle
                    cx="22" cy="22" r="20"
                    stroke="#ffffff"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="125.6"
                    strokeDashoffset={125.6 - 125.6 * (scanPct / 100)}
                    transform="rotate(-90 22 22)"
                    style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.6))", transition: "stroke-dashoffset 0.3s linear" }}
                  />
                </svg>
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    fontFamily: "var(--font-num)",
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {scanPct}%
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em", lineHeight: 1.3 }}>
                  Calibrating — <span style={{ color: "var(--t-2)" }}>reading your machine</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--t-3)", marginTop: 4, fontFamily: "var(--font-num)" }}>
                  Indexing local tools, scanning projects, warming cache
                </div>
              </div>
            </div>

            {/* Shortcuts */}
            <div style={{ display: "flex", justifyContent: "center", gap: 20, marginTop: 32, flexWrap: "wrap" }}>
              {[
                { label: "Anywhere", keys: ["Ctrl", "Space"] },
                { label: "Voice", keys: ["Ctrl", "Shift", "B"] },
                { label: "Wake word", keys: ['"Hey BLADE"'] },
              ].map((sc) => (
                <div key={sc.label} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--t-2)" }}>
                  {sc.label}
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    {sc.keys.map((k) => (
                      <span
                        key={k}
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "3px 7px",
                          borderRadius: 5,
                          background: "rgba(255,255,255,0.08)",
                          border: "1px solid var(--g-edge-mid)",
                          borderBottomWidth: 2,
                          color: "var(--t-1)",
                        }}
                      >
                        {k}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>

            {/* Optional name field */}
            {!userName && (
              <div style={{ marginTop: 26, display: "flex", justifyContent: "center" }}>
                <input
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="What should BLADE call you? (optional)"
                  style={{
                    width: 360,
                    padding: "10px 16px",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    color: "var(--t-1)",
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid var(--g-edge-mid)",
                    borderRadius: "var(--r-pill)",
                    outline: "none",
                    textAlign: "center",
                  }}
                />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "center", marginTop: 38 }}>
              <button
                className="btn2-primary"
                style={{ padding: "16px 28px", fontSize: 15 }}
                onClick={() => void handleFinish()}
              >
                Enter BLADE
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
