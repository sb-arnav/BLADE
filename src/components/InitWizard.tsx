// src/components/InitWizard.tsx
// Full Blade initialisation wizard — first-run onboarding + /init re-run.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";

// ── Provider catalogue ────────────────────────────────────────────────────────

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
    name: "Anthropic / Claude",
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
    id: "ollama",
    name: "Ollama",
    badge: "Local · Offline",
    model: "llama3.2",
    needsKey: false,
    keyUrl: "",
    placeholder: "",
  },
];

// ── Work modes ────────────────────────────────────────────────────────────────

const WORK_MODES = [
  { id: "coding", label: "Coding", icon: "⌨️", hint: "Code review, debugging, architecture" },
  { id: "research", label: "Research", icon: "🔬", hint: "Deep dives, summaries, competitive intel" },
  { id: "writing", label: "Writing", icon: "✍️", hint: "Drafts, editing, content strategy" },
  { id: "ops", label: "Ops / Automation", icon: "⚙️", hint: "Workflows, tasks, browser automation" },
  { id: "all", label: "All of the above", icon: "✦", hint: "General-purpose, no constraints" },
];

// ── Step definition ───────────────────────────────────────────────────────────

type Step = "welcome" | "about" | "preferences" | "provider" | "key" | "email" | "discovery" | "ready";

interface WizardState {
  userName: string;
  workMode: string;
  tokenEfficient: boolean;
  responseStyle: "concise" | "thorough";
  provider: typeof PROVIDERS[0];
  apiKey: string;
  emailChoice: "mine" | "new" | "skip";
  myEmail: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ProgressDots({ current }: { current: Step }) {
  // Skip "key" from dot count — it's a sub-step of "provider"
  const visible: Step[] = ["welcome", "about", "preferences", "provider", "email", "discovery", "ready"];
  const ci = visible.indexOf(current === "key" ? "provider" : current);
  return (
    <div className="flex items-center gap-1.5 justify-center mb-8">
      {visible.map((s, i) => (
        <div
          key={s}
          className={`rounded-full transition-all duration-300 ${
            i < ci ? "w-4 h-1 bg-blade-accent/60" :
            i === ci ? "w-4 h-1.5 bg-blade-accent" :
            "w-1.5 h-1.5 bg-blade-border"
          }`}
        />
      ))}
    </div>
  );
}

function StepHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-base font-semibold text-blade-text tracking-tight">{title}</h2>
      <p className="text-xs text-blade-muted mt-1 leading-relaxed">{sub}</p>
    </div>
  );
}

function NextButton({ onClick, disabled, label = "Continue →" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full mt-5 px-4 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-xl disabled:opacity-30 hover:bg-blade-accent/90 transition-colors"
    >
      {label}
    </button>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-xs text-blade-muted hover:text-blade-secondary transition-colors mt-3 block mx-auto"
    >
      ← back
    </button>
  );
}

// ── Discovery results type ────────────────────────────────────────────────────

interface DiscoveryReport {
  user_identity?: { name?: string | null; email?: string | null; github_username?: string | null } | null;
  ai_tools?: { name: string }[];
  projects?: { name: string; stack: string[] }[];
  dev_environment?: { languages?: string[]; editors?: string[] };
  installed_tools?: string[];
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function InitWizard({ onComplete, isReinit = false }: { onComplete: () => void; isReinit?: boolean }) {
  const [step, setStep] = useState<Step>("welcome");
  const [state, setState] = useState<WizardState>({
    userName: "",
    workMode: "",
    tokenEfficient: false,
    responseStyle: "thorough",
    provider: PROVIDERS[0],
    apiKey: "",
    emailChoice: "skip",
    myEmail: "",
  });
  const [testState, setTestState] = useState<"idle" | "testing" | "ok" | "error">("idle");
  const [testError, setTestError] = useState("");
  const [discoveryData, setDiscoveryData] = useState<DiscoveryReport | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const patch = (partial: Partial<WizardState>) =>
    setState((s) => ({ ...s, ...partial }));

  const go = (next: Step) => setStep(next);

  // Auto-run discovery when we land on that step
  useEffect(() => {
    if (step === "discovery") runDiscovery();
  }, [step]);

  // Auto-focus key input
  useEffect(() => {
    if (step === "key") setTimeout(() => keyInputRef.current?.focus(), 80);
  }, [step]);

  const runDiscovery = async () => {
    setDiscovering(true);
    try {
      const report = await invoke<DiscoveryReport>("run_discovery");
      setDiscoveryData(report);
      // Auto-fill name if not yet set
      if (!state.userName && report.user_identity?.name) {
        patch({ userName: report.user_identity.name });
      }
    } catch {
      setDiscoveryData({});
    } finally {
      setDiscovering(false);
    }
  };

  const handleTestConnection = async () => {
    setTestState("testing");
    setTestError("");
    try {
      await invoke("test_provider", {
        provider: state.provider.id,
        apiKey: state.provider.needsKey ? state.apiKey : "",
        model: state.provider.model,
      });
      setTestState("ok");
    } catch (e) {
      setTestState("error");
      setTestError(typeof e === "string" ? e : String(e));
    }
  };

  const handleFinish = async () => {
    await invoke("set_config", {
      provider: state.provider.id,
      apiKey: state.provider.needsKey ? state.apiKey : "",
      model: state.provider.model,
      tokenEfficient: state.tokenEfficient,
      userName: state.userName.trim(),
      workMode: state.workMode,
      responseStyle: state.responseStyle,
      bladeEmail: state.emailChoice === "mine" ? state.myEmail.trim() : "",
    });

    // Persist brain identity if we have a name
    if (state.userName.trim()) {
      await invoke("set_persona", { name: state.userName.trim() }).catch(() => {});
    }

    onComplete();
  };

  const openUrl = async (url: string) => {
    try { await tauriOpenUrl(url); } catch { window.open(url, "_blank"); }
  };

  // ── Render steps ────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col justify-center bg-blade-bg text-blade-text p-6 overflow-y-auto">
      <div className="max-w-sm mx-auto w-full animate-fade-in">
        {/* Logo mark */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-lg bg-blade-accent-muted flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-blade-accent" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-blade-text">Blade</span>
          {isReinit && (
            <span className="text-2xs px-1.5 py-0.5 rounded border border-blade-border text-blade-muted">re-init</span>
          )}
        </div>

        <ProgressDots current={step} />

        {/* ── Welcome ─────────────────────────────────────────────────── */}
        {step === "welcome" && (
          <div className="animate-fade-in">
            <StepHeading
              title={isReinit ? "Let's reconfigure Blade." : "Let's get you set up."}
              sub={isReinit
                ? "Walk through setup again to update your preferences, provider, or identity."
                : "Blade is your personal AI OS. This takes about 60 seconds."}
            />
            <div className="space-y-2">
              {[
                { icon: "🧠", label: "Learns your preferences as you use it" },
                { icon: "⚡", label: "Routes tasks to the right model automatically" },
                { icon: "🔌", label: "Connects to tools, files, browser, terminal" },
                { icon: "🔒", label: "Everything stays local — no cloud sync" },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-blade-surface border border-blade-border">
                  <span className="text-base flex-shrink-0">{icon}</span>
                  <span className="text-xs text-blade-secondary">{label}</span>
                </div>
              ))}
            </div>
            <NextButton onClick={() => go("about")} label="Get started →" />
          </div>
        )}

        {/* ── About you ───────────────────────────────────────────────── */}
        {step === "about" && (
          <div className="animate-fade-in">
            <StepHeading
              title="What should Blade call you?"
              sub="Used in your system prompt and remembered forever."
            />
            <input
              type="text"
              value={state.userName}
              onChange={(e) => patch({ userName: e.target.value })}
              placeholder="Your name"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && state.userName.trim()) go("preferences"); }}
              className="w-full bg-blade-surface border border-blade-border rounded-xl px-3.5 py-2.5 text-sm text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors"
            />

            <div className="mt-5 mb-2 text-2xs uppercase tracking-[0.18em] text-blade-muted">
              What are you mainly using Blade for?
            </div>
            <div className="space-y-1.5">
              {WORK_MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => patch({ workMode: m.id })}
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-colors ${
                    state.workMode === m.id
                      ? "border-blade-accent/50 bg-blade-accent/5 text-blade-text"
                      : "border-blade-border hover:border-blade-border-hover text-blade-secondary"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-base">{m.icon}</span>
                    <div>
                      <div className="text-xs font-medium">{m.label}</div>
                      <div className="text-2xs text-blade-muted mt-0.5">{m.hint}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <NextButton
              onClick={() => go("preferences")}
              disabled={!state.userName.trim() || !state.workMode}
            />
            <BackButton onClick={() => go("welcome")} />
          </div>
        )}

        {/* ── Preferences ─────────────────────────────────────────────── */}
        {step === "preferences" && (
          <div className="animate-fade-in">
            <StepHeading
              title="How should Blade behave?"
              sub="These affect how Blade responds to every message."
            />

            {/* Token efficiency toggle */}
            <div className="rounded-xl border border-blade-border bg-blade-surface p-4 mb-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-blade-text">Token efficient mode</div>
                  <div className="text-2xs text-blade-muted mt-0.5 leading-relaxed">
                    Uses faster, lighter models. Saves cost,<br />slightly less depth on complex tasks.
                  </div>
                </div>
                <button
                  onClick={() => patch({ tokenEfficient: !state.tokenEfficient })}
                  className={`relative w-10 h-5.5 rounded-full transition-colors flex-shrink-0 ${
                    state.tokenEfficient ? "bg-blade-accent" : "bg-blade-border"
                  }`}
                  style={{ height: "22px" }}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      state.tokenEfficient ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
              {state.tokenEfficient && (
                <div className="mt-2.5 text-2xs text-blade-accent/80 bg-blade-accent/5 rounded-lg px-2.5 py-1.5">
                  Gemini Flash · Claude Haiku · GPT-4o mini
                </div>
              )}
            </div>

            {/* Response style */}
            <div className="rounded-xl border border-blade-border bg-blade-surface p-4">
              <div className="text-xs font-medium text-blade-text mb-3">Response style</div>
              <div className="grid grid-cols-2 gap-2">
                {(["concise", "thorough"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => patch({ responseStyle: s })}
                    className={`py-2.5 rounded-lg border text-xs font-medium transition-colors capitalize ${
                      state.responseStyle === s
                        ? "border-blade-accent/50 bg-blade-accent/5 text-blade-text"
                        : "border-blade-border text-blade-muted hover:text-blade-secondary"
                    }`}
                  >
                    {s === "concise" ? "⚡ Concise" : "🔎 Thorough"}
                  </button>
                ))}
              </div>
              <div className="text-2xs text-blade-muted mt-2.5 leading-relaxed">
                {state.responseStyle === "concise"
                  ? "Short, direct answers. No unnecessary context."
                  : "Detailed explanations with full reasoning."}
              </div>
            </div>

            <NextButton onClick={() => go("provider")} />
            <BackButton onClick={() => go("about")} />
          </div>
        )}

        {/* ── Provider pick ────────────────────────────────────────────── */}
        {step === "provider" && (
          <div className="animate-fade-in">
            <StepHeading
              title="Which AI provider?"
              sub="You can change this any time in settings."
            />
            <div className="space-y-1.5">
              {PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    patch({ provider: p, apiKey: "" });
                    setTestState("idle");
                    if (!p.needsKey) {
                      go("email");
                    } else {
                      go("key");
                    }
                  }}
                  className="w-full text-left px-3.5 py-3 rounded-xl border border-blade-border hover:border-blade-border-hover hover:bg-blade-surface transition-colors group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[0.8125rem] font-medium">{p.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-2xs text-blade-muted">{p.badge}</span>
                      <svg viewBox="0 0 24 24" className="w-3 h-3 text-blade-muted group-hover:text-blade-secondary transition-colors" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <BackButton onClick={() => go("preferences")} />
          </div>
        )}

        {/* ── API key ──────────────────────────────────────────────────── */}
        {step === "key" && (
          <div className="animate-fade-in">
            <StepHeading
              title={`${state.provider.name} API key`}
              sub="Stored in your OS keychain — never leaves this machine."
            />

            <input
              ref={keyInputRef}
              type="password"
              value={state.apiKey}
              onChange={(e) => { patch({ apiKey: e.target.value }); setTestState("idle"); }}
              onKeyDown={(e) => { if (e.key === "Enter" && state.apiKey.trim()) handleTestConnection(); }}
              placeholder={state.provider.placeholder}
              className="w-full bg-blade-surface border border-blade-border rounded-xl px-3.5 py-2.5 text-sm text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors font-mono"
            />

            <button
              onClick={() => openUrl(state.provider.keyUrl)}
              className="text-2xs text-blade-accent hover:text-blade-accent/80 mt-2 inline-block transition-colors"
            >
              Get a {state.provider.name} key ↗
            </button>

            {/* Test feedback */}
            {testState === "testing" && (
              <div className="mt-3 flex items-center gap-2 text-xs text-blade-secondary">
                <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
                Testing connection…
              </div>
            )}
            {testState === "ok" && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-emerald-500/8 border border-emerald-500/15 text-emerald-400 text-xs">
                Connected ✓
              </div>
            )}
            {testState === "error" && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-red-500/8 border border-red-500/15 text-red-400 text-xs">
                {testError}
              </div>
            )}

            <div className="flex gap-2 mt-4">
              {testState !== "ok" ? (
                <button
                  onClick={handleTestConnection}
                  disabled={!state.apiKey.trim() || testState === "testing"}
                  className="flex-1 px-3 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-xl disabled:opacity-30 hover:bg-blade-accent/90 transition-colors"
                >
                  {testState === "testing" ? "Testing…" : "Test connection"}
                </button>
              ) : (
                <button
                  onClick={() => go("email")}
                  className="flex-1 px-3 py-2.5 text-xs font-medium bg-blade-accent text-white rounded-xl hover:bg-blade-accent/90 transition-colors"
                >
                  Continue →
                </button>
              )}
            </div>
            <BackButton onClick={() => { setTestState("idle"); go("provider"); }} />
          </div>
        )}

        {/* ── Email ────────────────────────────────────────────────────── */}
        {step === "email" && (
          <div className="animate-fade-in">
            <StepHeading
              title="Email identity"
              sub="Blade uses an email to act on your behalf — sending drafts, signing up for services, registering accounts."
            />

            <div className="space-y-2">
              {/* Use mine */}
              <button
                onClick={() => patch({ emailChoice: "mine" })}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${
                  state.emailChoice === "mine"
                    ? "border-blade-accent/50 bg-blade-accent/5"
                    : "border-blade-border hover:border-blade-border-hover"
                }`}
              >
                <div className="text-xs font-medium text-blade-text">Use my email</div>
                <div className="text-2xs text-blade-muted mt-0.5">Blade acts as you</div>
              </button>

              {/* Create new */}
              <button
                onClick={() => { patch({ emailChoice: "new" }); openUrl("https://accounts.google.com/signup"); }}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${
                  state.emailChoice === "new"
                    ? "border-blade-accent/50 bg-blade-accent/5"
                    : "border-blade-border hover:border-blade-border-hover"
                }`}
              >
                <div className="text-xs font-medium text-blade-text">Create a new Gmail for Blade</div>
                <div className="text-2xs text-blade-muted mt-0.5">Opens browser → create → paste address below</div>
              </button>

              {/* Skip */}
              <button
                onClick={() => patch({ emailChoice: "skip" })}
                className={`w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${
                  state.emailChoice === "skip"
                    ? "border-blade-accent/50 bg-blade-accent/5"
                    : "border-blade-border hover:border-blade-border-hover"
                }`}
              >
                <div className="text-xs font-medium text-blade-text">Skip for now</div>
                <div className="text-2xs text-blade-muted mt-0.5">Set up later in settings</div>
              </button>
            </div>

            {/* Email input if "mine" or "new" selected */}
            {(state.emailChoice === "mine" || state.emailChoice === "new") && (
              <div className="mt-3 animate-fade-in">
                <input
                  type="email"
                  value={state.myEmail}
                  onChange={(e) => patch({ myEmail: e.target.value })}
                  placeholder={state.emailChoice === "new" ? "blade@gmail.com" : "your@email.com"}
                  autoFocus
                  className="w-full bg-blade-surface border border-blade-border rounded-xl px-3.5 py-2.5 text-sm text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors"
                />
              </div>
            )}

            <NextButton
              onClick={() => go("discovery")}
              disabled={
                (state.emailChoice !== "skip") &&
                !state.myEmail.trim().includes("@")
              }
            />
            <BackButton onClick={() => go(state.provider.needsKey ? "key" : "provider")} />
          </div>
        )}

        {/* ── Discovery ───────────────────────────────────────────────── */}
        {step === "discovery" && (
          <div className="animate-fade-in">
            <StepHeading
              title="Scanning your environment…"
              sub="Blade maps your tools, projects, and dev setup. Nothing leaves this machine."
            />

            {discovering && (
              <div className="space-y-2">
                {["Checking installed tools…", "Reading project directories…", "Detecting AI setups…"].map((msg, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-blade-surface border border-blade-border">
                    <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse flex-shrink-0" style={{ animationDelay: `${i * 150}ms` }} />
                    <span className="text-xs text-blade-secondary">{msg}</span>
                  </div>
                ))}
              </div>
            )}

            {!discovering && discoveryData && (
              <div className="space-y-2 animate-fade-in">
                {/* Identity */}
                {discoveryData.user_identity?.name && (
                  <DiscoveryRow
                    icon="👤"
                    label="Identity"
                    value={[discoveryData.user_identity.name, discoveryData.user_identity.email].filter(Boolean).join(" · ")}
                  />
                )}
                {/* Languages */}
                {(discoveryData.dev_environment?.languages?.length ?? 0) > 0 && (
                  <DiscoveryRow
                    icon="💻"
                    label="Languages"
                    value={discoveryData.dev_environment!.languages!.slice(0, 5).join(", ")}
                  />
                )}
                {/* Editors */}
                {(discoveryData.dev_environment?.editors?.length ?? 0) > 0 && (
                  <DiscoveryRow
                    icon="✏️"
                    label="Editors"
                    value={discoveryData.dev_environment!.editors!.join(", ")}
                  />
                )}
                {/* Projects */}
                {(discoveryData.projects?.length ?? 0) > 0 && (
                  <DiscoveryRow
                    icon="📁"
                    label="Projects"
                    value={`${discoveryData.projects!.length} found`}
                  />
                )}
                {/* AI tools */}
                {(discoveryData.ai_tools?.length ?? 0) > 0 && (
                  <DiscoveryRow
                    icon="🤖"
                    label="AI tools"
                    value={discoveryData.ai_tools!.map((t) => t.name).join(", ")}
                  />
                )}

                {Object.keys(discoveryData).length === 0 && (
                  <div className="text-xs text-blade-muted text-center py-4">Nothing detected — that's fine. Blade will learn as you work.</div>
                )}
              </div>
            )}

            {!discovering && (
              <NextButton onClick={() => go("ready")} label="Look good →" />
            )}
          </div>
        )}

        {/* ── Ready ───────────────────────────────────────────────────── */}
        {step === "ready" && (
          <div className="animate-fade-in">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-2xl bg-blade-accent-muted flex items-center justify-center mx-auto mb-4">
                <div className="w-4 h-4 rounded-full bg-blade-accent" />
              </div>
              <h2 className="text-base font-semibold text-blade-text">Blade is ready.</h2>
              <p className="text-xs text-blade-muted mt-1">Here's how you're set up.</p>
            </div>

            <div className="space-y-1.5 mb-6">
              <SummaryRow label="Provider" value={state.provider.name} />
              {state.userName && <SummaryRow label="Name" value={state.userName} />}
              {state.workMode && <SummaryRow label="Focus" value={WORK_MODES.find((m) => m.id === state.workMode)?.label ?? state.workMode} />}
              <SummaryRow label="Response style" value={state.responseStyle === "concise" ? "⚡ Concise" : "🔎 Thorough"} />
              <SummaryRow label="Token efficient" value={state.tokenEfficient ? "On" : "Off"} />
              {state.emailChoice !== "skip" && state.myEmail && (
                <SummaryRow label="Email" value={state.myEmail} />
              )}
            </div>

            <div className="text-2xs text-blade-muted mb-4 leading-relaxed text-center">
              Type <code className="font-mono text-blade-accent">/init</code> any time to reconfigure.
            </div>

            <button
              onClick={handleFinish}
              className="w-full px-4 py-2.5 text-sm font-medium bg-blade-accent text-white rounded-xl hover:bg-blade-accent/90 transition-colors"
            >
              Start using Blade →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small display components ──────────────────────────────────────────────────

function DiscoveryRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-blade-surface border border-blade-border">
      <span className="text-base flex-shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="text-2xs uppercase tracking-[0.15em] text-blade-muted">{label}</div>
        <div className="text-xs text-blade-secondary truncate">{value}</div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-blade-surface border border-blade-border">
      <span className="text-2xs text-blade-muted">{label}</span>
      <span className="text-xs text-blade-secondary font-medium">{value}</span>
    </div>
  );
}
