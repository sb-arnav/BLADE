import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  id: string;
  type: "prompt" | "condition" | "transform" | "output" | "loop" | "mcp_tool";
  config: {
    prompt?: string;
    condition?: string;
    trueStepId?: string;
    falseStepId?: string;
    operation?: string;
    destination?: string;
    maxIterations?: number;
    loopStepId?: string;
    toolName?: string;
    arguments?: string;
  };
  label: string;
  order: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  icon: string;
  steps: WorkflowStep[];
  createdAt: number;
  updatedAt: number;
  runCount: number;
  lastRunAt?: number;
  isBuiltIn?: boolean;
}

export interface WorkflowRun {
  workflowId: string;
  status: "running" | "completed" | "error" | "paused";
  currentStepIndex: number;
  stepOutputs: Record<string, string>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

// ── Built-in Templates ─────────────────────────────────────────────────────────

function makeStep(
  type: WorkflowStep["type"],
  label: string,
  order: number,
  config: WorkflowStep["config"] = {}
): WorkflowStep {
  return {
    id: crypto.randomUUID(),
    type,
    label,
    order,
    config,
  };
}

function createBuiltInTemplates(): Workflow[] {
  const now = Date.now();

  const codeReviewer: Workflow = {
    id: "builtin-code-reviewer",
    name: "Code Reviewer",
    description:
      "Reviews code for issues, suggests improvements, and outputs the report to chat.",
    icon: "🔍",
    steps: [
      makeStep("prompt", "Review Code", 0, {
        prompt:
          "You are a senior code reviewer. Analyze the following code for bugs, security issues, performance problems, and code style. Be thorough and specific.\n\nCode to review:\n{{input}}",
      }),
      makeStep("prompt", "Suggest Improvements", 1, {
        prompt:
          "Based on the code review below, provide concrete, actionable improvements. Include refactored code snippets where helpful. Prioritize by impact.\n\nReview:\n{{previous_output}}",
      }),
      makeStep("output", "Send to Chat", 2, { destination: "chat" }),
    ],
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    isBuiltIn: true,
  };

  const researchAssistant: Workflow = {
    id: "builtin-research-assistant",
    name: "Research Assistant",
    description:
      "Researches a topic in depth, summarizes findings, extracts action items, and copies the result.",
    icon: "📚",
    steps: [
      makeStep("prompt", "Research Topic", 0, {
        prompt:
          "You are a research analyst. Conduct thorough research on the following topic. Cover key facts, different perspectives, recent developments, and notable sources.\n\nTopic:\n{{input}}",
      }),
      makeStep("prompt", "Summarize Findings", 1, {
        prompt:
          "Summarize the following research into a concise, well-structured brief. Use headings, bullet points, and highlight the most important insights.\n\nResearch:\n{{previous_output}}",
      }),
      makeStep("prompt", "Extract Action Items", 2, {
        prompt:
          "From the research summary below, extract a clear list of actionable next steps. Format as a numbered checklist with owners/deadlines where appropriate.\n\nSummary:\n{{previous_output}}",
      }),
      makeStep("output", "Copy to Clipboard", 3, { destination: "clipboard" }),
    ],
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    isBuiltIn: true,
  };

  const contentPipeline: Workflow = {
    id: "builtin-content-pipeline",
    name: "Content Pipeline",
    description:
      "Generates an outline, expands sections in a loop, proofreads, and outputs to chat.",
    icon: "✍️",
    steps: [
      makeStep("prompt", "Generate Outline", 0, {
        prompt:
          "Create a detailed content outline for the following topic. Include a title, introduction hook, 4-6 main sections with sub-points, and a conclusion.\n\nTopic:\n{{input}}",
      }),
      makeStep("loop", "Expand Sections", 1, {
        maxIterations: 5,
        loopStepId: "", // will reference the expand prompt step
      }),
      makeStep("prompt", "Expand Current Section", 2, {
        prompt:
          "You are expanding a content outline section by section. Take the next un-expanded section from the outline and write 2-3 detailed paragraphs for it. If all sections are expanded, respond with the full compiled article.\n\nOutline and progress so far:\n{{previous_output}}",
      }),
      makeStep("prompt", "Proofread & Polish", 3, {
        prompt:
          "Proofread and polish the following content. Fix grammar, improve flow, ensure consistent tone, and enhance readability. Return the final polished version.\n\nDraft:\n{{previous_output}}",
      }),
      makeStep("output", "Send to Chat", 4, { destination: "chat" }),
    ],
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    isBuiltIn: true,
  };

  // Wire up the loop step to reference the expand prompt
  contentPipeline.steps[1].config.loopStepId = contentPipeline.steps[2].id;

  const bugHunter: Workflow = {
    id: "builtin-bug-hunter",
    name: "Bug Hunter",
    description:
      "Analyzes errors, checks if a fix exists, implements the fix, and outputs to chat.",
    icon: "🐛",
    steps: [
      makeStep("prompt", "Analyze Error", 0, {
        prompt:
          "You are an expert debugger. Analyze the following error message, stack trace, or bug report. Identify the root cause, affected components, and severity.\n\nError:\n{{input}}",
      }),
      makeStep("condition", "Has Fix?", 1, {
        condition: "contains:fix,solution,resolve,patch,workaround",
        trueStepId: "", // will wire up
        falseStepId: "", // will wire up
      }),
      makeStep("prompt", "Implement Fix", 2, {
        prompt:
          "Based on the analysis below, implement a concrete fix. Provide the exact code changes needed, explain why each change is necessary, and note any side effects.\n\nAnalysis:\n{{previous_output}}",
      }),
      makeStep("output", "Send to Chat", 3, { destination: "chat" }),
    ],
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    isBuiltIn: true,
  };

  // Wire up condition branches
  bugHunter.steps[1].config.trueStepId = bugHunter.steps[2].id;
  bugHunter.steps[1].config.falseStepId = bugHunter.steps[3].id;

  return [codeReviewer, researchAssistant, contentPipeline, bugHunter];
}

// ── Storage helpers ────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-workflows";

function loadWorkflowsFromStorage(): Workflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Workflow[];
  } catch {
    return [];
  }
}

function saveWorkflowsToStorage(workflows: Workflow[]) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(workflows.filter((w) => !w.isBuiltIn))
  );
}

// ── Evaluation helpers ─────────────────────────────────────────────────────────

function interpolateTemplate(template: string, input: string, previousOutput: string): string {
  return template
    .replace(/\{\{input\}\}/g, input)
    .replace(/\{\{previous_output\}\}/g, previousOutput);
}

function evaluateCondition(condition: string, text: string): boolean {
  const lower = text.toLowerCase();

  if (condition.startsWith("contains:")) {
    const keywords = condition.slice("contains:".length).split(",").map((k) => k.trim().toLowerCase());
    return keywords.some((kw) => lower.includes(kw));
  }

  if (condition.startsWith("equals:")) {
    const value = condition.slice("equals:".length).trim().toLowerCase();
    return lower.trim() === value;
  }

  if (condition.startsWith("length>")) {
    const threshold = parseInt(condition.slice("length>".length).trim(), 10);
    return text.length > threshold;
  }

  if (condition.startsWith("length<")) {
    const threshold = parseInt(condition.slice("length<".length).trim(), 10);
    return text.length < threshold;
  }

  // Default: treat as keyword list (contains any)
  const keywords = condition.split(",").map((k) => k.trim().toLowerCase());
  return keywords.some((kw) => lower.includes(kw));
}

function applyTransform(operation: string, text: string): string {
  switch (operation) {
    case "uppercase":
      return text.toUpperCase();
    case "lowercase":
      return text.toLowerCase();
    case "trim":
      return text.trim();
    case "split_lines":
      return text
        .split("\n")
        .map((line, i) => `${i + 1}. ${line}`)
        .join("\n");
    case "extract_json": {
      const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) return match[1].trim();
      // Try to find raw JSON
      const jsonMatch = text.match(/[\[{][\s\S]*[\]}]/);
      return jsonMatch ? jsonMatch[0] : text;
    }
    case "word_count": {
      const count = text.split(/\s+/).filter(Boolean).length;
      return `Word count: ${count}\n\n${text}`;
    }
    case "reverse_lines":
      return text.split("\n").reverse().join("\n");
    case "remove_empty_lines":
      return text
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .join("\n");
    case "extract_urls": {
      const urls = text.match(/https?:\/\/[^\s)]+/g);
      return urls ? urls.join("\n") : "(no URLs found)";
    }
    default:
      return text;
  }
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useWorkflows() {
  const builtInTemplates = useRef(createBuiltInTemplates());
  const [userWorkflows, setUserWorkflows] = useState<Workflow[]>(() =>
    loadWorkflowsFromStorage()
  );
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null);
  const abortRef = useRef(false);
  const streamBufferRef = useRef("");
  const streamDoneRef = useRef(false);

  // Persist user workflows whenever they change
  useEffect(() => {
    saveWorkflowsToStorage(userWorkflows);
  }, [userWorkflows]);

  // Combine built-in + user workflows
  const workflows: Workflow[] = [
    ...builtInTemplates.current,
    ...userWorkflows,
  ];

  // ── CRUD ─────────────────────────────────────────────────────────────────────

  const addWorkflow = useCallback((workflow: Omit<Workflow, "id" | "createdAt" | "updatedAt" | "runCount">) => {
    const now = Date.now();
    const newWorkflow: Workflow = {
      ...workflow,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    };
    setUserWorkflows((prev) => [...prev, newWorkflow]);
    return newWorkflow;
  }, []);

  const updateWorkflow = useCallback((id: string, updates: Partial<Workflow>) => {
    setUserWorkflows((prev) =>
      prev.map((w) =>
        w.id === id
          ? { ...w, ...updates, updatedAt: Date.now() }
          : w
      )
    );
  }, []);

  const deleteWorkflow = useCallback((id: string) => {
    setUserWorkflows((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const duplicateWorkflow = useCallback((id: string) => {
    const source = [...builtInTemplates.current, ...userWorkflows].find((w) => w.id === id);
    if (!source) return null;

    const now = Date.now();
    const duplicated: Workflow = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (copy)`,
      createdAt: now,
      updatedAt: now,
      runCount: 0,
      isBuiltIn: false,
      steps: source.steps.map((s) => ({ ...s, id: crypto.randomUUID() })),
    };
    setUserWorkflows((prev) => [...prev, duplicated]);
    return duplicated;
  }, [userWorkflows]);

  // ── Execution ────────────────────────────────────────────────────────────────

  const sendPromptAndCollect = useCallback(
    async (prompt: string): Promise<string> => {
      return new Promise<string>((resolve, reject) => {
        streamBufferRef.current = "";
        streamDoneRef.current = false;

        let unlistenToken: (() => void) | null = null;
        let unlistenDone: (() => void) | null = null;
        let unlistenError: (() => void) | null = null;

        const cleanup = () => {
          unlistenToken?.();
          unlistenDone?.();
          unlistenError?.();
        };

        const setupListeners = async () => {
          const tokenUnsub = await listen<string>("chat_token", (event) => {
            streamBufferRef.current += event.payload;
          });
          unlistenToken = tokenUnsub;

          const doneUnsub = await listen("chat_done", () => {
            streamDoneRef.current = true;
            const result = streamBufferRef.current;
            cleanup();
            resolve(result);
          });
          unlistenDone = doneUnsub;

          // Also listen for errors
          const errorUnsub = await listen<string>("chat_error", (event) => {
            cleanup();
            reject(new Error(event.payload || "Stream error"));
          });
          unlistenError = errorUnsub;

          // Send the actual message
          try {
            await invoke("send_message_stream", {
              messages: [
                { role: "user", content: prompt },
              ],
            });
          } catch (err) {
            cleanup();
            reject(err);
          }
        };

        setupListeners().catch((err) => {
          cleanup();
          reject(err);
        });

        // Timeout safety: resolve after 120s even if no done event
        setTimeout(() => {
          if (!streamDoneRef.current) {
            const partial = streamBufferRef.current;
            cleanup();
            if (partial.length > 0) {
              resolve(partial);
            } else {
              reject(new Error("Workflow step timed out after 120s"));
            }
          }
        }, 120_000);
      });
    },
    []
  );

  const runWorkflow = useCallback(
    async (workflowId: string, initialInput: string) => {
      const workflow = [...builtInTemplates.current, ...userWorkflows].find(
        (w) => w.id === workflowId
      );
      if (!workflow) throw new Error("Workflow not found");

      abortRef.current = false;

      const run: WorkflowRun = {
        workflowId,
        status: "running",
        currentStepIndex: 0,
        stepOutputs: {},
        startedAt: Date.now(),
      };

      setActiveRun({ ...run });

      // Track the current input/output flowing through the chain
      let currentOutput = initialInput;
      const stepOutputs: Record<string, string> = {};

      // Sort steps by order
      const sortedSteps = [...workflow.steps].sort((a, b) => a.order - b.order);

      let stepIndex = 0;
      let loopCounters: Record<string, number> = {};

      try {
        while (stepIndex < sortedSteps.length) {
          if (abortRef.current) {
            run.status = "paused";
            run.completedAt = Date.now();
            setActiveRun({ ...run, stepOutputs: { ...stepOutputs } });
            return run;
          }

          const step = sortedSteps[stepIndex];
          run.currentStepIndex = stepIndex;
          setActiveRun({ ...run, stepOutputs: { ...stepOutputs } });

          switch (step.type) {
            case "prompt": {
              const template = step.config.prompt || "{{input}}";
              const filled = interpolateTemplate(template, initialInput, currentOutput);
              const response = await sendPromptAndCollect(filled);
              currentOutput = response;
              stepOutputs[step.id] = response;
              break;
            }

            case "condition": {
              const expression = step.config.condition || "";
              const passes = evaluateCondition(expression, currentOutput);
              stepOutputs[step.id] = passes ? "true" : "false";

              if (passes && step.config.trueStepId) {
                const trueIdx = sortedSteps.findIndex((s) => s.id === step.config.trueStepId);
                if (trueIdx !== -1) {
                  stepIndex = trueIdx;
                  continue;
                }
              } else if (!passes && step.config.falseStepId) {
                const falseIdx = sortedSteps.findIndex((s) => s.id === step.config.falseStepId);
                if (falseIdx !== -1) {
                  stepIndex = falseIdx;
                  continue;
                }
              }
              break;
            }

            case "transform": {
              const op = step.config.operation || "trim";
              const result = applyTransform(op, currentOutput);
              currentOutput = result;
              stepOutputs[step.id] = result;
              break;
            }

            case "output": {
              stepOutputs[step.id] = currentOutput;
              const dest = step.config.destination || "chat";
              if (dest === "clipboard") {
                try {
                  await navigator.clipboard.writeText(currentOutput);
                } catch {
                  // Clipboard write may fail in some contexts
                }
              }
              // "chat" and "file" destinations are handled by the caller via onRunOutput
              break;
            }

            case "loop": {
              const loopKey = step.id;
              const maxIter = step.config.maxIterations || 3;
              const counter = loopCounters[loopKey] || 0;

              if (counter < maxIter && step.config.loopStepId) {
                loopCounters[loopKey] = counter + 1;
                const loopTargetIdx = sortedSteps.findIndex(
                  (s) => s.id === step.config.loopStepId
                );
                if (loopTargetIdx !== -1) {
                  stepOutputs[step.id] = `Loop iteration ${counter + 1}/${maxIter}`;
                  stepIndex = loopTargetIdx;
                  continue;
                }
              } else {
                stepOutputs[step.id] = `Loop completed (${counter} iterations)`;
              }
              break;
            }

            case "mcp_tool": {
              const toolName = step.config.toolName || "";
              const argsTemplate = step.config.arguments || "{}";
              const filledArgs = interpolateTemplate(argsTemplate, initialInput, currentOutput);

              try {
                const result = await invoke<string>("mcp_call_tool", {
                  toolName,
                  arguments: filledArgs,
                });
                currentOutput = result;
                stepOutputs[step.id] = result;
              } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                currentOutput = `MCP tool error: ${errMsg}`;
                stepOutputs[step.id] = currentOutput;
              }
              break;
            }

            default:
              stepOutputs[step.id] = currentOutput;
          }

          stepIndex++;
        }

        // Success
        run.status = "completed";
        run.completedAt = Date.now();
        run.stepOutputs = { ...stepOutputs };
        setActiveRun({ ...run });

        // Update run count
        if (workflow.isBuiltIn) {
          // Built-in workflows: we track run count in a separate localStorage key
          const countsRaw = localStorage.getItem("blade-workflow-run-counts");
          const counts: Record<string, number> = countsRaw ? JSON.parse(countsRaw) : {};
          counts[workflowId] = (counts[workflowId] || 0) + 1;
          localStorage.setItem("blade-workflow-run-counts", JSON.stringify(counts));
        } else {
          setUserWorkflows((prev) =>
            prev.map((w) =>
              w.id === workflowId
                ? { ...w, runCount: w.runCount + 1, lastRunAt: Date.now() }
                : w
            )
          );
        }

        return run;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        run.status = "error";
        run.error = errMsg;
        run.completedAt = Date.now();
        run.stepOutputs = { ...stepOutputs };
        setActiveRun({ ...run });
        return run;
      }
    },
    [userWorkflows, sendPromptAndCollect]
  );

  const stopRun = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    workflows,
    addWorkflow,
    updateWorkflow,
    deleteWorkflow,
    duplicateWorkflow,
    runWorkflow,
    activeRun,
    stopRun,
  };
}
