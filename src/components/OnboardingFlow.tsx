/**
 * ONBOARDING FLOW — Guided setup for new users.
 * Ported from Omi's OnboardingFlow (15+ steps).
 *
 * Steps:
 *   1. Welcome
 *   2. API key setup (pick provider)
 *   3. Permissions (screen, mic, accessibility)
 *   4. File scan (index your machine)
 *   5. Connect platforms (GitHub, Slack, Email)
 *   6. Set goals
 *   7. Persona (tell BLADE who you are)
 *   8. Ready
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface OnboardingFlowProps {
  onComplete: () => void;
}

type Step = "welcome" | "provider" | "permissions" | "scan" | "connect" | "goals" | "persona" | "ready";

const STEPS: Step[] = ["welcome", "provider", "permissions", "scan", "connect", "goals", "persona", "ready"];

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [persona, setPersona] = useState("");
  const [goal, setGoal] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const stepIndex = STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  const next = () => {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  };

  const back = () => {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  };

  const saveProvider = async () => {
    if (!provider || !apiKey) return;
    setSaving(true);
    try {
      await invoke("store_provider_key", { provider, apiKey });
      await invoke("switch_provider", { provider, model: null });
      next();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const startScan = async () => {
    setScanning(true);
    try {
      const count = await invoke<number>("file_index_scan_now");
      setScanResult(count);
    } catch { setScanResult(0); }
    setScanning(false);
  };

  const savePersona = async () => {
    if (!persona.trim()) { next(); return; }
    setSaving(true);
    try {
      await invoke("set_persona", { content: persona });
    } catch { /* ignore */ }
    setSaving(false);
    next();
  };

  const saveGoal = async () => {
    if (!goal.trim()) { next(); return; }
    setSaving(true);
    try {
      await invoke("goal_add", { title: goal, description: "" });
    } catch { /* ignore */ }
    setSaving(false);
    next();
  };

  const finish = () => {
    localStorage.setItem("blade_onboarded", "true");
    onComplete();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ background: "radial-gradient(ellipse at center, rgba(15,15,25,0.98), rgba(5,5,10,0.99))" }}>

      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 h-[3px] bg-[rgba(255,255,255,0.06)]">
        <div className="h-full bg-[#818cf8] transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      <div className="w-full max-w-[480px] px-6">
        {step === "welcome" && (
          <StepContainer>
            <div className="w-[48px] h-[48px] rounded-2xl bg-[rgba(129,140,248,0.15)] flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round">
                <polygon points="12,2 15,8.5 22,9 17,14 18.5,21 12,17.5 5.5,21 7,14 2,9 9,8.5" />
              </svg>
            </div>
            <h1 className="text-[24px] font-bold tracking-[-0.02em] mb-2">Welcome to BLADE</h1>
            <p className="text-[14px] text-[rgba(255,255,255,0.5)] leading-[1.6] mb-8">
              Your personal AI that sees your screen, hears your voice, remembers everything,
              and acts on your behalf. Let's get you set up.
            </p>
            <Btn onClick={next}>Get started</Btn>
          </StepContainer>
        )}

        {step === "provider" && (
          <StepContainer>
            <StepHeader title="Connect an AI" sub="Paste an API key or curl snippet — BLADE figures out the rest" step={2} total={8} />

            {/* Smart paste — just paste anything */}
            <div className="mb-4">
              <input type="text" value={apiKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setApiKey(val);
                  // Auto-detect provider from key or curl
                  const trimmed = val.trim();
                  if (trimmed.startsWith("sk-ant-")) setProvider("anthropic");
                  else if (trimmed.startsWith("sk-or-v1-")) setProvider("openrouter");
                  else if (trimmed.startsWith("sk-")) setProvider("openai");
                  else if (trimmed.startsWith("gsk_")) setProvider("groq");
                  else if (trimmed.startsWith("AIza")) setProvider("gemini");
                  else if (trimmed.startsWith("curl")) {
                    const m = trimmed.match(/[Bb]earer\s+([A-Za-z0-9_-]+)/);
                    if (m) {
                      setApiKey(m[1]);
                      if (m[1].startsWith("sk-ant-")) setProvider("anthropic");
                      else if (m[1].startsWith("sk-or-v1-")) setProvider("openrouter");
                      else if (m[1].startsWith("sk-")) setProvider("openai");
                      else if (m[1].startsWith("gsk_")) setProvider("groq");
                    }
                  }
                }}
                placeholder="Paste API key or curl snippet from provider docs"
                className="w-full px-4 py-3 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-xl text-[13px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#818cf8] font-mono" />
              {provider && (
                <div className="mt-2 px-3 py-2 rounded-xl bg-[rgba(74,222,128,0.1)] border border-[rgba(74,222,128,0.25)] text-[rgba(74,222,128,0.9)] text-[11px]">
                  Detected: {provider.charAt(0).toUpperCase() + provider.slice(1)}
                </div>
              )}
            </div>

            {/* Or pick manually */}
            <p className="text-[10px] text-[rgba(255,255,255,0.3)] mb-2">Or choose a provider:</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[
                { id: "anthropic", label: "Anthropic", sub: "Claude" },
                { id: "openai", label: "OpenAI", sub: "GPT-4o" },
                { id: "gemini", label: "Gemini", sub: "free tier" },
                { id: "groq", label: "Groq", sub: "fast + free" },
                { id: "openrouter", label: "OpenRouter", sub: "200+ models" },
                { id: "ollama", label: "Ollama", sub: "local, free" },
              ].map((p) => (
                <button key={p.id} onClick={() => setProvider(p.id)}
                  className={`px-3 py-2 rounded-xl text-center transition-all ${
                    provider === p.id
                      ? "bg-[rgba(129,140,248,0.15)] border border-[#818cf8]"
                      : "bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.07)]"
                  }`}>
                  <div className="text-[12px] font-semibold">{p.label}</div>
                  <div className="text-[9px] text-[rgba(255,255,255,0.35)]">{p.sub}</div>
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <BtnGhost onClick={back}>Back</BtnGhost>
              <Btn onClick={provider === "ollama" ? next : saveProvider} disabled={!provider || (provider !== "ollama" && !apiKey)}>
                {saving ? "Saving..." : "Continue"}
              </Btn>
            </div>
          </StepContainer>
        )}

        {step === "permissions" && (
          <StepContainer>
            <StepHeader title="Permissions" sub="BLADE needs access to see and hear" step={3} total={8} />
            <div className="space-y-3 mb-6">
              <PermRow icon="👁" label="Screen capture" sub="See what you're working on" />
              <PermRow icon="🎙" label="Microphone" sub="Voice commands and meeting notes" />
              <PermRow icon="⌨️" label="Accessibility" sub="Keyboard shortcuts from any app" />
            </div>
            <p className="text-[11px] text-[rgba(255,255,255,0.3)] mb-4">
              BLADE processes everything locally. Your data never leaves your machine unless you send it to an AI provider.
            </p>
            <div className="flex gap-2">
              <BtnGhost onClick={back}>Back</BtnGhost>
              <Btn onClick={next}>Continue</Btn>
            </div>
          </StepContainer>
        )}

        {step === "scan" && (
          <StepContainer>
            <StepHeader title="File Scan" sub="Let BLADE learn your machine" step={4} total={8} />
            <p className="text-[13px] text-[rgba(255,255,255,0.5)] mb-4">
              BLADE will scan your Downloads, Documents, Desktop, and project folders to understand your files.
            </p>
            {scanResult === null ? (
              <Btn onClick={startScan} disabled={scanning}>
                {scanning ? "Scanning..." : "Start scan"}
              </Btn>
            ) : (
              <>
                <div className="text-[13px] text-[#4ade80] mb-4">Found {scanResult.toLocaleString()} files</div>
                <div className="flex gap-2">
                  <BtnGhost onClick={back}>Back</BtnGhost>
                  <Btn onClick={next}>Continue</Btn>
                </div>
              </>
            )}
            {scanResult === null && !scanning && (
              <button onClick={next} className="mt-3 text-[11px] text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.5)]">
                Skip for now
              </button>
            )}
          </StepContainer>
        )}

        {step === "connect" && (
          <StepContainer>
            <StepHeader title="Connect Platforms" sub="BLADE monitors your work tools" step={5} total={8} />
            <div className="space-y-2 mb-4">
              <ConnectRow label="GitHub" sub="Watch PRs, issues, CI status" />
              <ConnectRow label="Slack" sub="Monitor messages, draft replies" />
              <ConnectRow label="Gmail" sub="Triage inbox, draft responses" />
              <ConnectRow label="Calendar" sub="Meeting prep, scheduling" />
            </div>
            <p className="text-[11px] text-[rgba(255,255,255,0.3)] mb-4">
              You can connect these later from Settings → Integrations.
            </p>
            <div className="flex gap-2">
              <BtnGhost onClick={back}>Back</BtnGhost>
              <Btn onClick={next}>Continue</Btn>
            </div>
          </StepContainer>
        )}

        {step === "goals" && (
          <StepContainer>
            <StepHeader title="Your Goal" sub="What are you working toward?" step={6} total={8} />
            <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Ship the MVP by end of month"
              className="w-full px-4 py-3 mb-4 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-xl text-[13px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#818cf8]" />
            <div className="flex gap-2">
              <BtnGhost onClick={back}>Back</BtnGhost>
              <Btn onClick={saveGoal}>{saving ? "Saving..." : goal ? "Set goal" : "Skip"}</Btn>
            </div>
          </StepContainer>
        )}

        {step === "persona" && (
          <StepContainer>
            <StepHeader title="Who are you?" sub="Help BLADE understand you" step={7} total={8} />
            <textarea value={persona} onChange={(e) => setPersona(e.target.value)}
              placeholder="e.g. I'm a full-stack developer building a SaaS product. I prefer direct communication and hate filler. I work 12pm-3am."
              className="w-full h-[100px] px-4 py-3 mb-4 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-xl text-[13px] text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#818cf8] resize-none" />
            <div className="flex gap-2">
              <BtnGhost onClick={back}>Back</BtnGhost>
              <Btn onClick={savePersona}>{saving ? "Saving..." : persona ? "Save" : "Skip"}</Btn>
            </div>
          </StepContainer>
        )}

        {step === "ready" && (
          <StepContainer>
            <div className="w-[48px] h-[48px] rounded-2xl bg-[rgba(74,222,128,0.15)] flex items-center justify-center mb-4">
              <span className="text-[24px]">✓</span>
            </div>
            <h1 className="text-[24px] font-bold tracking-[-0.02em] mb-2">You're all set</h1>
            <p className="text-[14px] text-[rgba(255,255,255,0.5)] leading-[1.6] mb-2">
              BLADE is now watching your screen, listening for "Hey BLADE", and learning your patterns.
            </p>
            <p className="text-[13px] text-[rgba(255,255,255,0.35)] leading-[1.6] mb-8">
              Press <kbd className="px-1 py-0.5 bg-[rgba(255,255,255,0.08)] rounded text-[11px] font-mono">Ctrl+Space</kbd> from any app to talk to BLADE.
            </p>
            <Btn onClick={finish}>Start using BLADE</Btn>
          </StepContainer>
        )}
      </div>
    </div>
  );
}

function StepContainer({ children }: { children: React.ReactNode }) {
  return <div className="animate-[blade-card-in_0.4s_cubic-bezier(0.22,1,0.36,1)_both]">{children}</div>;
}

function StepHeader({ title, sub, step, total }: { title: string; sub: string; step: number; total: number }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] text-[rgba(255,255,255,0.25)] font-mono mb-1">{step}/{total}</div>
      <h2 className="text-[20px] font-bold tracking-[-0.02em]">{title}</h2>
      <p className="text-[13px] text-[rgba(255,255,255,0.45)]">{sub}</p>
    </div>
  );
}

function Btn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex-1 px-5 py-3 rounded-xl text-[13px] font-semibold bg-[#818cf8] text-white hover:bg-[#6366f1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
      {children}
    </button>
  );
}

function BtnGhost({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="px-5 py-3 rounded-xl text-[13px] text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition-colors">
      {children}
    </button>
  );
}

function PermRow({ icon, label, sub }: { icon: string; label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
      <span className="text-[18px]">{icon}</span>
      <div>
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11px] text-[rgba(255,255,255,0.4)]">{sub}</div>
      </div>
      <div className="ml-auto w-[8px] h-[8px] rounded-full bg-[#4ade80]" />
    </div>
  );
}

function ConnectRow({ label, sub }: { label: string; sub: string }) {
  const [connected] = useState(false);
  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.06)]">
      <div className="flex-1">
        <div className="text-[13px] font-medium">{label}</div>
        <div className="text-[11px] text-[rgba(255,255,255,0.4)]">{sub}</div>
      </div>
      <button className="px-3 py-1 text-[10px] font-semibold rounded-lg border border-[rgba(129,140,248,0.3)] bg-[rgba(129,140,248,0.1)] text-[#818cf8] hover:bg-[rgba(129,140,248,0.2)] transition-colors">
        {connected ? "Connected" : "Connect"}
      </button>
    </div>
  );
}
