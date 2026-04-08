import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DiscoveryReport } from "../types";

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

type Step = "ask" | "scanning" | "results" | "interview" | "synthesizing" | "done";

const INTERVIEW_QUESTIONS = [
  { id: "role", question: "What do you do?", placeholder: "e.g. indie builder, student, designer, data scientist..." },
  { id: "building", question: "What are you building right now?", placeholder: "e.g. a SaaS app, a game, a portfolio..." },
  { id: "help", question: "What should Blade help you with most?", placeholder: "e.g. coding, research, writing, brainstorming..." },
  { id: "anything", question: "Anything else Blade should know about you?", placeholder: "e.g. I work late nights, I'm learning Rust, I hate boilerplate..." },
];

export function Discovery({ onComplete, onSkip }: Props) {
  const [step, setStep] = useState<Step>("ask");
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [inputValue, setInputValue] = useState("");

  const runScan = async () => {
    setStep("scanning");
    try {
      const result = await invoke<DiscoveryReport>("run_discovery");
      setReport(result);
      setStep("results");
    } catch {
      setStep("interview");
    }
  };

  const submitAnswer = () => {
    const q = INTERVIEW_QUESTIONS[currentQuestion];
    const trimmed = inputValue.trim();
    if (trimmed) {
      setAnswers((prev) => ({ ...prev, [q.id]: trimmed }));
    }
    setInputValue("");

    if (currentQuestion < INTERVIEW_QUESTIONS.length - 1) {
      setCurrentQuestion((prev) => prev + 1);
    } else {
      synthesize();
    }
  };

  const synthesize = async () => {
    setStep("synthesizing");

    const sections: string[] = [];

    if (report?.user_identity) {
      const id = report.user_identity;
      const parts: string[] = [];
      if (id.name) parts.push(`Name: ${id.name}`);
      if (id.github_username) parts.push(`GitHub: @${id.github_username}`);
      if (parts.length > 0) sections.push(parts.join("\n"));
    }

    if (answers.role) sections.push(`Role: ${answers.role}`);
    if (answers.building) sections.push(`Currently building: ${answers.building}`);
    if (answers.help) sections.push(`Wants Blade to help with: ${answers.help}`);
    if (answers.anything) sections.push(`Notes: ${answers.anything}`);

    if (report?.ai_tools && report.ai_tools.length > 0) {
      sections.push(`AI tools installed: ${report.ai_tools.map((t) => t.name).join(", ")}`);
    }

    if (report?.dev_environment) {
      const env = report.dev_environment;
      if (env.languages.length > 0) sections.push(`Languages: ${env.languages.join(", ")}`);
      if (env.editors.length > 0) sections.push(`Editors: ${env.editors.join(", ")}`);
    }

    if (report?.projects && report.projects.length > 0) {
      const projectList = report.projects
        .slice(0, 10)
        .map((p) => {
          const stack = p.stack.length > 0 ? ` (${p.stack.join(", ")})` : "";
          return `- ${p.name}${stack}`;
        })
        .join("\n");
      sections.push(`Projects:\n${projectList}`);
    }

    if (report?.installed_tools && report.installed_tools.length > 0) {
      sections.push(`Tools: ${report.installed_tools.join(", ")}`);
    }

    const persona = sections.join("\n\n");

    try {
      await invoke("set_persona", { content: persona });
    } catch {
      // Non-fatal
    }

    setStep("done");
  };

  const summaryStats = report
    ? {
        projects: report.projects.length,
        aiTools: report.ai_tools.length,
        tools: report.installed_tools.length,
        languages: report.dev_environment.languages.length,
      }
    : null;

  return (
    <div className="flex-1 flex flex-col justify-center bg-blade-bg text-blade-text p-6">
      <div className="max-w-md mx-auto w-full">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-3 h-3 rounded-full bg-blade-accent" />
          <h1 className="text-xl font-semibold">Blade</h1>
        </div>

        {step === "ask" && (
          <div className="space-y-4">
            <p className="text-sm text-blade-text leading-relaxed">
              Blade can scan your PC to understand your setup — what tools you use, what you're building, how you work. Everything stays local.
            </p>
            <p className="text-xs text-blade-muted">
              This makes Blade deeply personal from the first conversation.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                onClick={runScan}
                className="flex-1 px-4 py-3 text-sm font-medium bg-blade-accent text-white rounded-xl hover:opacity-90 transition-opacity"
              >
                Scan my setup
              </button>
              <button
                onClick={onSkip}
                className="px-4 py-3 text-sm text-blade-muted hover:text-blade-text transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === "scanning" && (
          <div className="space-y-3">
            <div className="text-sm text-blade-muted animate-pulse">
              Looking around...
            </div>
            <div className="text-xs text-blade-muted">
              Checking AI tools, projects, dev environment...
            </div>
          </div>
        )}

        {step === "results" && summaryStats && (
          <div className="space-y-4">
            <p className="text-sm text-blade-text">Here's what I found:</p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Projects" value={summaryStats.projects} />
              <Stat label="AI tools" value={summaryStats.aiTools} />
              <Stat label="Languages" value={summaryStats.languages} />
              <Stat label="Dev tools" value={summaryStats.tools} />
            </div>
            {report?.user_identity?.name && (
              <p className="text-xs text-blade-muted">
                Hi {report.user_identity.name}
                {report.user_identity.github_username
                  ? ` (@${report.user_identity.github_username})`
                  : ""}
              </p>
            )}
            {report?.ai_tools && report.ai_tools.length > 0 && (
              <p className="text-xs text-blade-muted">
                AI: {report.ai_tools.map((t) => t.name).join(", ")}
              </p>
            )}
            <button
              onClick={() => setStep("interview")}
              className="w-full px-4 py-3 text-sm font-medium bg-blade-accent text-white rounded-xl hover:opacity-90 transition-opacity"
            >
              Continue — a few quick questions
            </button>
          </div>
        )}

        {step === "interview" && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-blade-text">
              {INTERVIEW_QUESTIONS[currentQuestion].question}
            </p>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAnswer();
              }}
              placeholder={INTERVIEW_QUESTIONS[currentQuestion].placeholder}
              className="w-full bg-blade-surface border border-blade-border rounded-xl px-4 py-3 text-sm text-blade-text outline-none focus:border-blade-accent placeholder:text-blade-muted"
              autoFocus
            />
            <div className="flex justify-between items-center">
              <span className="text-xs text-blade-muted">
                {currentQuestion + 1} / {INTERVIEW_QUESTIONS.length}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={submitAnswer}
                  className="px-4 py-2 text-sm text-blade-muted hover:text-blade-text transition-colors"
                >
                  {inputValue.trim() ? "Next" : "Skip"}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "synthesizing" && (
          <div className="text-sm text-blade-muted animate-pulse">
            Building your profile...
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4">
            <div className="px-4 py-3 bg-green-950 border border-green-900 rounded-xl text-green-400 text-sm">
              Blade is ready. Every conversation will be tailored to you.
            </div>
            <button
              onClick={onComplete}
              className="w-full px-4 py-3 text-sm font-medium bg-blade-accent text-white rounded-xl hover:opacity-90 transition-opacity"
            >
              Start chatting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-blade-surface border border-blade-border rounded-xl px-3 py-2">
      <div className="text-lg font-semibold text-blade-text">{value}</div>
      <div className="text-xs text-blade-muted">{label}</div>
    </div>
  );
}
