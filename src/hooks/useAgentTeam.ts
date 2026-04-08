import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TeamAgent {
  id: string;
  name: string;
  role: "lead" | "researcher" | "coder" | "reviewer" | "writer";
  status: "idle" | "working" | "waiting" | "done" | "error";
  task: string;
  output: string;
  tools: string[];
  instructions: string;
  startedAt?: number;
  completedAt?: number;
  messageCount: number;
  tokenCount: number;
  error?: string;
}

export interface CoordinationEntry {
  from: string;
  to: string;
  message: string;
  timestamp: number;
}

export interface AgentTeam {
  id: string;
  name: string;
  goal: string;
  templateId: string;
  status: "planning" | "executing" | "reviewing" | "completed" | "error";
  agents: TeamAgent[];
  plan: Array<{ step: string; assignee: string; status: "pending" | "active" | "done" | "error" }>;
  coordinationLog: CoordinationEntry[];
  startedAt: number;
  completedAt?: number;
  finalOutput?: string;
  error?: string;
}

export interface TeamTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  agents: Array<{
    name: string;
    role: TeamAgent["role"];
    tools: string[];
    instructions: string;
  }>;
}

// ── Built-in Team Templates ────────────────────────────────────────────────────

const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    id: "fullstack-dev",
    name: "Full-Stack Dev Team",
    icon: "🏗️",
    description: "A complete dev team: lead architect plans, frontend and backend devs build, reviewer catches issues, tester verifies.",
    agents: [
      {
        name: "Architect",
        role: "lead",
        tools: ["Read", "Glob", "Grep", "Agent"],
        instructions: "You are the lead architect. Analyze the goal, break it into frontend and backend tasks, define interfaces, and coordinate the team. Create a clear plan with task assignments.",
      },
      {
        name: "Frontend Dev",
        role: "coder",
        tools: ["Read", "Write", "Edit", "Glob", "Grep"],
        instructions: "You are a frontend developer. Implement UI components, pages, and client-side logic. Use React, TypeScript, and Tailwind CSS. Follow the architect's specifications.",
      },
      {
        name: "Backend Dev",
        role: "coder",
        tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
        instructions: "You are a backend developer. Implement APIs, database schemas, server logic, and integrations. Follow the architect's specifications and ensure type safety.",
      },
      {
        name: "Code Reviewer",
        role: "reviewer",
        tools: ["Read", "Glob", "Grep"],
        instructions: "You are a senior code reviewer. Review all changes for bugs, security issues, performance problems, and adherence to best practices. Be thorough and specific.",
      },
      {
        name: "QA Tester",
        role: "writer",
        tools: ["Read", "Write", "Bash", "Glob", "Grep"],
        instructions: "You are a QA engineer. Write comprehensive tests for all new code. Verify the implementation matches requirements. Run tests and report any failures.",
      },
    ],
  },
  {
    id: "research-team",
    name: "Research Team",
    icon: "🔬",
    description: "Deep research squad: lead frames questions, three researchers explore different angles, synthesizer combines findings.",
    agents: [
      {
        name: "Research Lead",
        role: "lead",
        tools: ["WebSearch", "WebFetch", "Read", "Write"],
        instructions: "You lead the research team. Break the research goal into specific questions and angles. Assign each researcher a distinct area to avoid duplication. Synthesize the final report.",
      },
      {
        name: "Researcher Alpha",
        role: "researcher",
        tools: ["WebSearch", "WebFetch", "Read"],
        instructions: "You are a research analyst. Investigate your assigned topic thoroughly. Find primary sources, data, and expert opinions. Document findings with citations.",
      },
      {
        name: "Researcher Beta",
        role: "researcher",
        tools: ["WebSearch", "WebFetch", "Read"],
        instructions: "You are a research analyst. Explore alternative perspectives and counterarguments. Look for recent developments and emerging trends. Document findings with citations.",
      },
      {
        name: "Researcher Gamma",
        role: "researcher",
        tools: ["WebSearch", "WebFetch", "Read"],
        instructions: "You are a research analyst specializing in technical depth. Dive into implementation details, benchmarks, comparisons, and case studies. Document findings with citations.",
      },
      {
        name: "Synthesizer",
        role: "writer",
        tools: ["Read", "Write"],
        instructions: "You synthesize research from multiple analysts into a cohesive, well-structured report. Identify key themes, resolve contradictions, and produce actionable conclusions.",
      },
    ],
  },
  {
    id: "content-team",
    name: "Content Team",
    icon: "✍️",
    description: "Editorial pipeline: editor plans structure, writer drafts, fact-checker verifies, SEO optimizer polishes for reach.",
    agents: [
      {
        name: "Editor-in-Chief",
        role: "lead",
        tools: ["Read", "WebSearch"],
        instructions: "You are the editor-in-chief. Define the content strategy, outline structure, set tone and audience. Review drafts and provide editorial feedback. Ensure the final piece is publication-ready.",
      },
      {
        name: "Staff Writer",
        role: "writer",
        tools: ["Read", "Write", "WebSearch", "WebFetch"],
        instructions: "You are a skilled content writer. Produce engaging, well-researched drafts following the editor's outline. Write clearly, use strong examples, and maintain consistent voice.",
      },
      {
        name: "Fact Checker",
        role: "researcher",
        tools: ["WebSearch", "WebFetch", "Read"],
        instructions: "You verify every claim, statistic, quote, and reference in the content. Flag anything unverifiable or inaccurate. Provide corrections with sources.",
      },
      {
        name: "SEO Optimizer",
        role: "reviewer",
        tools: ["Read", "Edit", "WebSearch"],
        instructions: "You optimize content for search engines. Improve headings, meta descriptions, keyword density, internal linking, and readability scores. Preserve the writer's voice while boosting discoverability.",
      },
    ],
  },
  {
    id: "code-review-squad",
    name: "Code Review Squad",
    icon: "👀",
    description: "Thorough code audit: lead reviewer coordinates, security auditor hunts vulnerabilities, perf analyst finds bottlenecks, style checker enforces standards.",
    agents: [
      {
        name: "Lead Reviewer",
        role: "lead",
        tools: ["Read", "Glob", "Grep", "Bash"],
        instructions: "You coordinate the code review. Identify files to review, assign focus areas to each specialist, and compile a final review summary with prioritized findings.",
      },
      {
        name: "Security Auditor",
        role: "reviewer",
        tools: ["Read", "Glob", "Grep"],
        instructions: "You are a security specialist. Audit code for vulnerabilities: injection, XSS, CSRF, auth flaws, hardcoded secrets, insecure dependencies. Rate each finding by severity (critical/high/medium/low).",
      },
      {
        name: "Perf Analyst",
        role: "reviewer",
        tools: ["Read", "Glob", "Grep", "Bash"],
        instructions: "You analyze code for performance issues: unnecessary re-renders, N+1 queries, memory leaks, large bundle sizes, unoptimized algorithms. Suggest concrete improvements with expected impact.",
      },
      {
        name: "Style Checker",
        role: "reviewer",
        tools: ["Read", "Glob", "Grep"],
        instructions: "You enforce code style and quality standards: naming conventions, file organization, DRY principle, proper typing, documentation coverage, consistent patterns. Reference project conventions.",
      },
    ],
  },
  {
    id: "bug-squad",
    name: "Bug Squad",
    icon: "🐛",
    description: "Bug-fixing assembly line: triager categorizes, debugger finds root cause, fixer patches, test writer prevents regression.",
    agents: [
      {
        name: "Triager",
        role: "lead",
        tools: ["Read", "Glob", "Grep", "Bash"],
        instructions: "You triage bugs. Reproduce the issue, categorize severity, identify affected components, and assign the debugger. Create a clear bug report with repro steps.",
      },
      {
        name: "Debugger",
        role: "researcher",
        tools: ["Read", "Bash", "Glob", "Grep"],
        instructions: "You are an expert debugger. Trace the root cause using logs, stack traces, and code analysis. Build a causal chain from trigger to symptom. Document the exact location and mechanism of the bug.",
      },
      {
        name: "Fixer",
        role: "coder",
        tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
        instructions: "You implement bug fixes. Apply the minimal correct fix based on the debugger's analysis. Ensure the fix doesn't introduce regressions. Explain your changes clearly.",
      },
      {
        name: "Test Writer",
        role: "writer",
        tools: ["Read", "Write", "Bash", "Glob", "Grep"],
        instructions: "You write regression tests for every bug fix. Create tests that would have caught the original bug. Verify tests pass with the fix and fail without it.",
      },
    ],
  },
];

// ── Storage ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-agent-teams";
const MAX_PERSISTED_TEAMS = 5;

function loadTeamsFromStorage(): AgentTeam[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AgentTeam[];
  } catch {
    return [];
  }
}

function saveTeamsToStorage(teams: AgentTeam[]) {
  const completed = teams
    .filter((t) => t.status === "completed" || t.status === "error")
    .slice(-MAX_PERSISTED_TEAMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useAgentTeam() {
  const [teams, setTeams] = useState<AgentTeam[]>(() => loadTeamsFromStorage());
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const streamBufferRef = useRef("");
  const streamDoneRef = useRef(false);

  // Persist teams when they change
  useEffect(() => {
    saveTeamsToStorage(teams);
  }, [teams]);

  const activeTeam = teams.find((t) => t.id === activeTeamId) || null;

  // Helper: update a specific team in state
  const updateTeam = useCallback((teamId: string, updater: (team: AgentTeam) => AgentTeam) => {
    setTeams((prev) => prev.map((t) => (t.id === teamId ? updater(t) : t)));
  }, []);

  // Helper: update a specific agent within a team
  const updateAgent = useCallback(
    (teamId: string, agentId: string, updater: (agent: TeamAgent) => TeamAgent) => {
      updateTeam(teamId, (team) => ({
        ...team,
        agents: team.agents.map((a) => (a.id === agentId ? updater(a) : a)),
      }));
    },
    [updateTeam],
  );

  // Helper: add coordination log entry
  const addLogEntry = useCallback(
    (teamId: string, from: string, to: string, message: string) => {
      updateTeam(teamId, (team) => ({
        ...team,
        coordinationLog: [
          ...team.coordinationLog,
          { from, to, message, timestamp: Date.now() },
        ],
      }));
    },
    [updateTeam],
  );

  // Send a prompt and collect the full streamed response
  const sendPromptAndCollect = useCallback(async (prompt: string): Promise<string> => {
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

      const setup = async () => {
        unlistenToken = await listen<string>("chat_token", (event) => {
          streamBufferRef.current += event.payload;
        });
        unlistenDone = await listen("chat_done", () => {
          streamDoneRef.current = true;
          cleanup();
          resolve(streamBufferRef.current);
        });
        unlistenError = await listen<string>("chat_error", (event) => {
          cleanup();
          reject(new Error(event.payload || "Stream error"));
        });

        try {
          await invoke("send_message_stream", {
            messages: [{ role: "user", content: prompt }],
          });
        } catch (err) {
          cleanup();
          reject(err);
        }
      };

      setup().catch((err) => {
        cleanup();
        reject(err);
      });

      // Safety timeout
      setTimeout(() => {
        if (!streamDoneRef.current) {
          const partial = streamBufferRef.current;
          cleanup();
          partial.length > 0
            ? resolve(partial)
            : reject(new Error("Agent step timed out after 120s"));
        }
      }, 120_000);
    });
  }, []);

  // ── Create Team ──────────────────────────────────────────────────────────────

  const createTeam = useCallback(
    (templateId: string, goal: string): AgentTeam | null => {
      const template = TEAM_TEMPLATES.find((t) => t.id === templateId);
      if (!template || !goal.trim()) return null;

      const team: AgentTeam = {
        id: crypto.randomUUID(),
        name: template.name,
        goal: goal.trim(),
        templateId,
        status: "planning",
        agents: template.agents.map((a) => ({
          id: crypto.randomUUID(),
          name: a.name,
          role: a.role,
          status: "idle",
          task: "",
          output: "",
          tools: a.tools,
          instructions: a.instructions,
          messageCount: 0,
          tokenCount: 0,
        })),
        plan: [],
        coordinationLog: [],
        startedAt: Date.now(),
      };

      setTeams((prev) => [...prev, team]);
      return team;
    },
    [],
  );

  // ── Start Team Execution ─────────────────────────────────────────────────────

  const startTeam = useCallback(
    async (teamId: string) => {
      const team = teams.find((t) => t.id === teamId);
      if (!team || activeTeamId) return;

      abortRef.current = false;
      setActiveTeamId(teamId);
      updateTeam(teamId, (t) => ({ ...t, status: "planning" }));

      try {
        // Phase 1: Lead agent creates a plan
        const lead = team.agents.find((a) => a.role === "lead");
        if (!lead) throw new Error("No lead agent found");

        updateAgent(teamId, lead.id, (a) => ({ ...a, status: "working", task: "Creating execution plan", startedAt: Date.now() }));
        addLogEntry(teamId, "System", lead.name, `Starting team for goal: ${team.goal}`);

        const agentRoster = team.agents
          .map((a) => `- ${a.name} (${a.role}): ${a.instructions.slice(0, 80)}...`)
          .join("\n");

        const planPrompt = `You are ${lead.name}, the lead of a team. Your team members are:\n${agentRoster}\n\nGoal: ${team.goal}\n\nCreate a numbered execution plan (5-8 steps). For each step, specify which team member should handle it. Format each step as:\nSTEP N: [Agent Name] — [Task description]\n\nBe specific and actionable. The plan should leverage each team member's strengths.`;

        const planResponse = await sendPromptAndCollect(planPrompt);

        if (abortRef.current) {
          updateTeam(teamId, (t) => ({ ...t, status: "error", error: "Cancelled", completedAt: Date.now() }));
          setActiveTeamId(null);
          return;
        }

        // Parse plan steps
        const stepRegex = /STEP\s+\d+:\s*\[?([^\]—\-\n]+?)\]?\s*[—\-]\s*(.+)/gi;
        const parsedSteps: Array<{ step: string; assignee: string; status: "pending" | "active" | "done" | "error" }> = [];
        let match: RegExpExecArray | null;

        while ((match = stepRegex.exec(planResponse)) !== null) {
          const assigneeName = match[1].trim();
          const stepDesc = match[2].trim();
          const closest = team.agents.reduce((best, a) => {
            const similarity = a.name.toLowerCase().includes(assigneeName.toLowerCase()) ? 1 : 0;
            return similarity > 0 ? a : best;
          }, team.agents[0]);
          parsedSteps.push({ step: stepDesc, assignee: closest.name, status: "pending" });
        }

        // Fallback: if parsing fails, create generic steps
        if (parsedSteps.length === 0) {
          team.agents.forEach((a) => {
            if (a.role !== "lead") {
              parsedSteps.push({ step: `${a.name}: Execute assigned portion of the goal`, assignee: a.name, status: "pending" });
            }
          });
          parsedSteps.push({ step: "Lead compiles final output", assignee: lead.name, status: "pending" });
        }

        updateTeam(teamId, (t) => ({ ...t, plan: parsedSteps, status: "executing" }));
        updateAgent(teamId, lead.id, (a) => ({
          ...a, status: "done", task: "Plan created", output: planResponse,
          completedAt: Date.now(), messageCount: 1, tokenCount: planResponse.length,
        }));
        addLogEntry(teamId, lead.name, "Team", `Plan created with ${parsedSteps.length} steps`);

        // Phase 2: Execute each plan step sequentially
        for (let i = 0; i < parsedSteps.length; i++) {
          if (abortRef.current) break;

          const planStep = parsedSteps[i];
          const agent = team.agents.find((a) => a.name === planStep.assignee) || team.agents[0];

          // Mark step active
          updateTeam(teamId, (t) => ({
            ...t,
            plan: t.plan.map((s, idx) => (idx === i ? { ...s, status: "active" } : s)),
          }));

          updateAgent(teamId, agent.id, (a) => ({
            ...a, status: "working", task: planStep.step, startedAt: a.startedAt || Date.now(),
          }));

          addLogEntry(teamId, lead.name, agent.name, `Execute: ${planStep.step}`);

          // Gather context from previous agents' outputs
          const previousOutputs = team.agents
            .filter((a) => a.output && a.id !== agent.id)
            .map((a) => `[${a.name}]: ${a.output.slice(0, 500)}`)
            .join("\n\n");

          const agentPrompt = `You are ${agent.name} (${agent.role}) on a team.\n\n${agent.instructions}\n\nTeam goal: ${team.goal}\n\nYour current task: ${planStep.step}\n\n${previousOutputs ? `Context from teammates:\n${previousOutputs}\n\n` : ""}Complete your task thoroughly. Be specific and detailed.`;

          try {
            const response = await sendPromptAndCollect(agentPrompt);

            updateAgent(teamId, agent.id, (a) => ({
              ...a,
              status: "done",
              output: (a.output ? a.output + "\n\n---\n\n" : "") + response,
              completedAt: Date.now(),
              messageCount: a.messageCount + 1,
              tokenCount: a.tokenCount + response.length,
            }));

            updateTeam(teamId, (t) => ({
              ...t,
              plan: t.plan.map((s, idx) => (idx === i ? { ...s, status: "done" } : s)),
            }));

            addLogEntry(teamId, agent.name, lead.name, `Completed: ${planStep.step.slice(0, 60)}...`);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            updateAgent(teamId, agent.id, (a) => ({ ...a, status: "error", error: errMsg }));
            updateTeam(teamId, (t) => ({
              ...t,
              plan: t.plan.map((s, idx) => (idx === i ? { ...s, status: "error" } : s)),
            }));
            addLogEntry(teamId, agent.name, lead.name, `Error: ${errMsg}`);
          }
        }

        if (abortRef.current) {
          updateTeam(teamId, (t) => ({ ...t, status: "error", error: "Cancelled by user", completedAt: Date.now() }));
          setActiveTeamId(null);
          return;
        }

        // Phase 3: Lead reviews and compiles final output
        updateTeam(teamId, (t) => ({ ...t, status: "reviewing" }));
        updateAgent(teamId, lead.id, (a) => ({ ...a, status: "working", task: "Compiling final output" }));
        addLogEntry(teamId, "System", lead.name, "All tasks done. Compile final output.");

        // Re-read team state for latest outputs
        const latestTeam = teams.find((t) => t.id === teamId);
        const allOutputs = (latestTeam || team).agents
          .filter((a) => a.output)
          .map((a) => `## ${a.name} (${a.role})\n${a.output}`)
          .join("\n\n---\n\n");

        const reviewPrompt = `You are ${lead.name}, the team lead. Your team has completed all assigned tasks for the goal: "${team.goal}"\n\nHere are all team member outputs:\n\n${allOutputs}\n\nCompile a comprehensive final deliverable that combines the best of all contributions. Structure it clearly with sections. Include actionable recommendations.`;

        const finalOutput = await sendPromptAndCollect(reviewPrompt);

        updateAgent(teamId, lead.id, (a) => ({
          ...a, status: "done", output: (a.output ? a.output + "\n\n---\n\n" : "") + finalOutput,
          completedAt: Date.now(), messageCount: a.messageCount + 1, tokenCount: a.tokenCount + finalOutput.length,
        }));

        updateTeam(teamId, (t) => ({
          ...t, status: "completed", finalOutput, completedAt: Date.now(),
        }));

        addLogEntry(teamId, lead.name, "Team", "Final output compiled. Team work complete.");
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        updateTeam(teamId, (t) => ({
          ...t, status: "error", error: errMsg, completedAt: Date.now(),
        }));
      }

      setActiveTeamId(null);
    },
    [teams, activeTeamId, updateTeam, updateAgent, addLogEntry, sendPromptAndCollect],
  );

  // ── Pause / Cancel ───────────────────────────────────────────────────────────

  const pauseTeam = useCallback(() => {
    abortRef.current = true;
  }, []);

  const cancelTeam = useCallback(
    (teamId: string) => {
      abortRef.current = true;
      updateTeam(teamId, (t) => ({
        ...t,
        status: "error",
        error: "Cancelled by user",
        completedAt: Date.now(),
        agents: t.agents.map((a) =>
          a.status === "working" ? { ...a, status: "error", error: "Cancelled" } : a,
        ),
      }));
      setActiveTeamId(null);
    },
    [updateTeam],
  );

  // ── Clear History ────────────────────────────────────────────────────────────

  const clearHistory = useCallback(() => {
    setTeams((prev) => prev.filter((t) => t.id === activeTeamId));
  }, [activeTeamId]);

  return {
    teams,
    activeTeam,
    activeTeamId,
    createTeam,
    startTeam,
    pauseTeam,
    cancelTeam,
    clearHistory,
    templates: TEAM_TEMPLATES,
  };
}
