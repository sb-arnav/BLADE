import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

interface Props {
  onComplete: () => void;
}

export function OnboardingModal({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(Array(QUESTIONS.length).fill(""));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = QUESTIONS[step];
  const isLast = step === QUESTIONS.length - 1;
  const canAdvance = answers[step].trim().length > 0;

  const handleNext = async () => {
    if (!canAdvance) return;

    if (!isLast) {
      setStep((s) => s + 1);
      return;
    }

    // Final step — submit
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
    // Submit with whatever answers we have, filling empties with placeholders
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

  return (
    // Full-screen overlay with dark backdrop
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md mx-4 bg-blade-bg border border-blade-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-blade-border/50">
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-6 h-6 rounded-md bg-blade-accent-muted flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-blade-accent" />
            </div>
            <h2 className="text-sm font-semibold tracking-tight text-blade-text">
              Let's get to know you
            </h2>
          </div>
          <p className="text-2xs text-blade-muted leading-relaxed">
            5 quick questions so BLADE can actually be useful from the start.
          </p>
        </div>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 px-6 pt-4">
          {QUESTIONS.map((_, i) => (
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

        {/* Question body */}
        <div className="px-6 py-5">
          <div key={step} className="animate-fade-in">
            <p className="text-2xs text-blade-muted mb-1.5">
              {step + 1} of {QUESTIONS.length}
            </p>
            <label className="block text-[0.8125rem] font-medium text-blade-text mb-3">
              {current.label}
            </label>
            <textarea
              className="w-full bg-blade-surface border border-blade-border rounded-lg px-3.5 py-2.5 text-[0.8125rem] text-blade-text outline-none focus:border-blade-accent/50 placeholder:text-blade-muted transition-colors resize-none"
              rows={3}
              placeholder={current.placeholder}
              value={answers[step]}
              autoFocus
              onChange={(e) => {
                const updated = [...answers];
                updated[step] = e.target.value;
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

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button
            onClick={handleSkip}
            disabled={saving}
            className="text-xs text-blade-muted hover:text-blade-secondary transition-colors disabled:opacity-40"
          >
            Skip setup
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                disabled={saving}
                className="px-3 py-2 text-xs text-blade-muted hover:text-blade-secondary transition-colors disabled:opacity-40"
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={!canAdvance || saving}
              className="px-4 py-2 text-xs font-medium bg-blade-accent text-white rounded-lg disabled:opacity-30 hover:bg-blade-accent-hover transition-colors"
            >
              {saving ? "Saving…" : isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
