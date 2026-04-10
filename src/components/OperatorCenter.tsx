import { useEffect, useMemo, useState } from "react";
import AgentManager from "./AgentManager";
import { ManagedAgentPanel } from "./ManagedAgentPanel";
import { RuntimeTaskState, UseRuntimesResult, useRuntimes } from "../hooks/useRuntimes";
import { MissionSpec, OperatorMission, RuntimeDescriptor, RuntimeRouteRecommendation, RuntimeSessionRef, TaskArtifact } from "../types";
import { invoke } from "@tauri-apps/api/core";
import { BUILT_IN_TEMPLATES } from "../data/missionTemplates";
import { listMissionSpecs, saveMissionSpec, deleteMissionSpec, specToOperatorMission, missingVars } from "../lib/missionSpec";

type OperatorTab = "mission" | "blade" | "managed" | "library";

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
  defaultTab?: OperatorTab;
  runtimeCenter?: UseRuntimesResult;
}

function statusTone(runtime: RuntimeDescriptor) {
  if (!runtime.installed) return "text-amber-300 border-amber-500/30 bg-amber-500/10";
  if (runtime.install_requirement?.kind === "repair") return "text-rose-300 border-rose-500/30 bg-rose-500/10";
  if (!runtime.authenticated) return "text-orange-300 border-orange-500/30 bg-orange-500/10";
  if (runtime.active_tasks > 0) return "text-emerald-300 border-emerald-500/30 bg-emerald-500/10";
  return "text-blade-secondary border-blade-border bg-blade-surface";
}

function statusLabel(runtime: RuntimeDescriptor) {
  if (!runtime.installed) return "missing";
  if (runtime.server_url) return "warm";
  if (runtime.install_requirement?.kind === "repair") return "repair needed";
  if (!runtime.authenticated) return "auth needed";
  if (runtime.active_tasks > 0) return `${runtime.active_tasks} live`;
  return "ready";
}

function capabilityTone(category: string) {
  switch (category) {
    case "system":
      return "text-cyan-200 border-cyan-500/20 bg-cyan-500/10";
    case "creator":
      return "text-pink-200 border-pink-500/20 bg-pink-500/10";
    case "web-intelligence":
      return "text-emerald-200 border-emerald-500/20 bg-emerald-500/10";
    case "self-upgrade":
      return "text-[#c8cbff] border-[#6366f1]/20 bg-[#16172a]";
    case "security":
      return "text-amber-200 border-amber-500/20 bg-amber-500/10";
    default:
      return "text-blade-secondary border-blade-border bg-blade-surface";
  }
}

function relativeTime(ts: number) {
  const diff = Math.max(0, Date.now() - ts);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildHandoffNote(task: RuntimeTaskState) {
  const latestCheckpoint = task.checkpoints[task.checkpoints.length - 1];
  const latestAssistantMessage = [...task.messages]
    .reverse()
    .find((message) => message.role === "assistant" || message.role === "tool");
  const artifactDigest = task.artifacts
    .filter((artifact) =>
      ["summary", "web_results", "crawl_results", "search_results", "result", "scope", "verification"].includes(
        artifact.kind
      )
    )
    .slice(-3)
    .reverse()
    .map(
      (artifact) =>
        `${artifact.label} [${artifact.kind}]: ${artifact.value.replace(/\s+/g, " ").trim().slice(0, 220)}${
          artifact.value.replace(/\s+/g, " ").trim().length > 220 ? "..." : ""
        }`
    );
  return [
    `Source runtime: ${task.runtimeId}`,
    task.sessionId ? `Source session: ${task.sessionId}` : null,
    `Task goal: ${task.goal}`,
    latestCheckpoint
      ? `Latest checkpoint: ${latestCheckpoint.title}${latestCheckpoint.detail ? ` — ${latestCheckpoint.detail}` : ""}`
      : null,
    latestAssistantMessage?.content ? `Latest output:\n${latestAssistantMessage.content}` : null,
    artifactDigest.length > 0 ? `Relevant artifacts:\n${artifactDigest.map((line) => `- ${line}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function compactArtifactValue(value: string, maxChars = 180) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}...`;
}

function prominentArtifacts(artifacts: TaskArtifact[], limit = 3) {
  const preferredKinds = new Set(["summary", "web_results", "crawl_results", "search_results", "result", "scope", "verification"]);
  const prioritized = artifacts.filter((artifact) => preferredKinds.has(artifact.kind));
  const source = prioritized.length > 0 ? prioritized : artifacts;
  return source.slice(-limit).reverse();
}

function looksLikeSecurityGoal(goal: string) {
  return [
    "pentest",
    "penetration test",
    "security assessment",
    "bug bounty",
    "red team",
    "vulnerability",
    "exploit",
    "recon",
    "scan",
  ].some((keyword) => goal.toLowerCase().includes(keyword));
}

function RuntimeCard({
  runtime,
  selected,
  onSelect,
}: {
  runtime: RuntimeDescriptor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-xl border p-3 transition-colors ${
        selected
          ? "border-blade-accent/40 bg-blade-accent-muted"
          : "border-blade-border bg-blade-surface hover:border-blade-accent/20"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-blade-text font-medium">{runtime.name}</div>
          <div className="text-2xs uppercase tracking-[0.18em] text-blade-muted mt-1">{runtime.source}</div>
        </div>
        <span className={`text-2xs px-2 py-1 rounded-full border ${statusTone(runtime)}`}>
          {statusLabel(runtime)}
        </span>
      </div>
      <div className="text-2xs text-blade-muted mt-3 line-clamp-2">
        {runtime.capabilities.slice(0, 2).map((capability) => capability.label).join(" · ")}
      </div>
      {runtime.install_requirement ? (
        <div className="text-2xs text-blade-muted/80 mt-2 line-clamp-2">
          {runtime.install_requirement.title}
        </div>
      ) : null}
      {runtime.version ? (
        <div className="text-2xs text-blade-muted/70 mt-2 font-mono">{runtime.version}</div>
      ) : null}
      {runtime.server_url ? (
        <div className="text-2xs text-emerald-300/80 mt-2 font-mono truncate">
          warm server · {runtime.server_url}
        </div>
      ) : null}
    </button>
  );
}

function SessionRow({
  session,
  onUse,
}: {
  session: RuntimeSessionRef;
  onUse: () => void;
}) {
  return (
    <div className="rounded-lg border border-blade-border/60 bg-blade-bg/60 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-blade-secondary truncate">{session.title}</div>
          <div className="text-2xs text-blade-muted mt-1 truncate">
            {session.runtime_id} · {relativeTime(session.last_active_at)}
            {session.cwd ? ` · ${session.cwd}` : ""}
          </div>
        </div>
        <button
          onClick={onUse}
          className="text-2xs px-2 py-1 rounded-md bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
        >
          use
        </button>
      </div>
    </div>
  );
}

export function OperatorCenter({
  onBack,
  onSendToChat,
  defaultTab = "mission",
  runtimeCenter,
}: Props) {
  const runtimes = runtimeCenter ?? useRuntimes();
  const [tab, setTab] = useState<OperatorTab>(defaultTab);
  const [selectedRuntimeId, setSelectedRuntimeId] = useState("blade-native");
  const [goal, setGoal] = useState("");
  const [cwd, setCwd] = useState("");
  const [operatorType, setOperatorType] = useState<"general_operator" | "desktop_operator">("general_operator");
  const [preferredSubstrate, setPreferredSubstrate] = useState("");
  const [resumeSessionId, setResumeSessionId] = useState("");
  const [routeRecommendation, setRouteRecommendation] = useState<RuntimeRouteRecommendation | null>(null);
  const [mission, setMission] = useState<OperatorMission | null>(null);
  const [missionExecution, setMissionExecution] = useState<Record<string, string>>({});
  const [autoChainMission, setAutoChainMission] = useState(true);
  const [handoffSourceTaskId, setHandoffSourceTaskId] = useState<string | null>(null);
  const [handoffNote, setHandoffNote] = useState("");
  const [engagementTitle, setEngagementTitle] = useState("");
  const [engagementOwner, setEngagementOwner] = useState("");
  const [engagementContact, setEngagementContact] = useState("");
  const [engagementScope, setEngagementScope] = useState("");
  const [engagementAssetKind, setEngagementAssetKind] = useState("domain");
  const [engagementVerificationMethod, setEngagementVerificationMethod] = useState("dns_txt");
  const [engagementProof, setEngagementProof] = useState("");
  const [tavilyApiKey, setTavilyApiKey] = useState("");
  const [firecrawlApiKey, setFirecrawlApiKey] = useState("");
  const [firecrawlApiUrl, setFirecrawlApiUrl] = useState("");

  // Mission library state
  const [librarySpecs, setLibrarySpecs] = useState<MissionSpec[]>([]);
  const [libraryFilter, setLibraryFilter] = useState("");
  const [composingSpec, setComposingSpec] = useState<MissionSpec | null>(null);
  const [composerVars, setComposerVars] = useState<Record<string, string>>({});

  const selectedRuntime =
    runtimes.runtimes.find((runtime) => runtime.id === selectedRuntimeId) || runtimes.runtimes[0] || null;
  const latestSecurityEngagement = runtimes.securityEngagements[0] || null;
  const verifiedSecurityEngagement = runtimes.securityEngagements.find((engagement) => engagement.status === "verified") || null;

  useEffect(() => {
    void (async () => {
      const [nextTavily, nextFirecrawlKey, nextFirecrawlUrl] = await Promise.all([
        invoke<string | null>("db_get_setting", { key: "web.tavily_api_key" }).catch(() => null),
        invoke<string | null>("db_get_setting", { key: "web.firecrawl_api_key" }).catch(() => null),
        invoke<string | null>("db_get_setting", { key: "web.firecrawl_api_url" }).catch(() => null),
      ]);
      setTavilyApiKey(nextTavily || "");
      setFirecrawlApiKey(nextFirecrawlKey || "");
      setFirecrawlApiUrl(nextFirecrawlUrl || "");
    })();
  }, []);

  // Load mission library — seed built-ins on first run
  useEffect(() => {
    void (async () => {
      try {
        const saved = await listMissionSpecs();
        const savedIds = new Set(saved.map((s) => s.id));
        // Seed built-in templates if they haven't been saved yet
        for (const t of BUILT_IN_TEMPLATES) {
          if (!savedIds.has(t.id)) {
            await saveMissionSpec(t).catch(() => {});
          }
        }
        setLibrarySpecs(await listMissionSpecs());
      } catch {
        // If we can't reach the backend (e.g. during dev), fall back to in-memory templates
        setLibrarySpecs(BUILT_IN_TEMPLATES);
      }
    })();
  }, []);

  const resumableSessions = useMemo(
    () =>
      runtimes.runtimes
        .flatMap((runtime) => runtime.sessions)
        .sort((a, b) => b.last_active_at - a.last_active_at)
        .slice(0, 12),
    [runtimes.runtimes]
  );

  const handleRecommendRoute = async (nextGoal?: string) => {
    const targetGoal = (nextGoal ?? goal).trim();
    if (!targetGoal) return;
    const recommendation = await runtimes.recommendRoute(targetGoal);
    if (!recommendation) return;
    setRouteRecommendation(recommendation);
    setSelectedRuntimeId(recommendation.runtime_id);
    setOperatorType(
      recommendation.operator_type === "desktop_operator" ? "desktop_operator" : "general_operator"
    );
    setPreferredSubstrate(recommendation.preferred_substrate || "");
  };

  const handleDesignMission = async (nextGoal?: string) => {
    const targetGoal = (nextGoal ?? goal).trim();
    if (!targetGoal) return;
    const nextMission = await runtimes.designMission(targetGoal);
    if (!nextMission) return;
    await runtimes.saveMission(nextMission, autoChainMission);
    await runtimes.saveCompanyObject({
      kind: "goal",
      title: targetGoal.length > 80 ? `${targetGoal.slice(0, 77)}...` : targetGoal,
      summary: nextMission.summary,
      status: "active",
      linkedMissionId: nextMission.id,
    });
    setMission(nextMission);
    setMissionExecution({});
    if (nextMission.stages[0]) {
      const firstStage = nextMission.stages[0];
      setSelectedRuntimeId(firstStage.runtime.runtime_id);
      setOperatorType(
        firstStage.runtime.operator_type === "desktop_operator" ? "desktop_operator" : "general_operator"
      );
      setPreferredSubstrate(firstStage.runtime.preferred_substrate || "");
    }
  };

  const handleStart = async () => {
    if (!selectedRuntime || !goal.trim()) return;
    if (resumeSessionId.trim()) {
      await runtimes.resumeSession(selectedRuntime.id, resumeSessionId.trim(), goal, {
        cwd: cwd.trim() || null,
        operatorType: selectedRuntime.id === "blade-native" ? operatorType : null,
        preferredSubstrate: preferredSubstrate.trim() || null,
        securityEngagementId: looksLikeSecurityGoal(goal) ? verifiedSecurityEngagement?.id || null : null,
        parentTaskId: handoffSourceTaskId,
        handoffNote: handoffNote.trim() || null,
      });
      setHandoffSourceTaskId(null);
      setHandoffNote("");
      return;
    }
    await runtimes.startTask(selectedRuntime.id, goal, {
      cwd: cwd.trim() || null,
      operatorType: selectedRuntime.id === "blade-native" ? operatorType : null,
      preferredSubstrate: preferredSubstrate.trim() || null,
      securityEngagementId: looksLikeSecurityGoal(goal) ? verifiedSecurityEngagement?.id || null : null,
      parentTaskId: handoffSourceTaskId,
      handoffNote: handoffNote.trim() || null,
    });
    setHandoffSourceTaskId(null);
    setHandoffNote("");
  };

  const handleCreateEngagement = async () => {
    const title = engagementTitle.trim() || `Security engagement for ${engagementScope.trim() || "owned asset"}`;
    const created = await runtimes.createSecurityEngagement({
      title,
      ownerName: engagementOwner.trim() || "Owner not specified",
      contact: engagementContact.trim() || "Contact not specified",
      scope: engagementScope.trim() || goal.trim() || "Scope pending",
      assetKind: engagementAssetKind,
      verificationMethod: engagementVerificationMethod,
    });
    if (!created) return;
    setEngagementTitle(created.title);
    setEngagementProof(created.challenge_token);
  };

  const handleVerifyEngagement = async () => {
    if (!latestSecurityEngagement) return;
    await runtimes.verifySecurityEngagement(
      latestSecurityEngagement.id,
      engagementProof.trim() || latestSecurityEngagement.challenge_token
    );
  };

  const handleSaveWebIntelligence = async () => {
    await Promise.all([
      invoke("db_set_setting", { key: "web.tavily_api_key", value: tavilyApiKey.trim() }),
      invoke("db_set_setting", { key: "web.firecrawl_api_key", value: firecrawlApiKey.trim() }),
      invoke("db_set_setting", { key: "web.firecrawl_api_url", value: firecrawlApiUrl.trim() }),
    ]);
    await runtimes.refresh();
  };

  const openInstallGuide = async () => {
    if (!selectedRuntime) return;
    const requirement = await runtimes.prepareInstall(selectedRuntime.id);
    if (!requirement) return;
    const details = [
      requirement.title,
      requirement.message,
      requirement.command ? `Command: ${requirement.command}` : null,
      requirement.url ? `Link: ${requirement.url}` : null,
    ]
      .filter(Boolean)
      .join("\n\n");
    onSendToChat(details);
  };

  const prepareHandoff = async (task: RuntimeTaskState) => {
    const nextHandoffNote = buildHandoffNote(task);
    setGoal(task.goal);
    setResumeSessionId("");
    setCwd(task.session?.cwd || "");
    setHandoffSourceTaskId(task.id);
    setHandoffNote(nextHandoffNote);
    await handleRecommendRoute(`${task.goal}\n\n${nextHandoffNote}`);
    await handleDesignMission(`${task.goal}\n\n${nextHandoffNote}`);
  };

  const missionTaskByStageId = (stageId: string) =>
    runtimes.tasks.find((task) => missionExecution[stageId] && task.id === missionExecution[stageId]) || null;

  const launchMissionStage = async (stageId: string) => {
    if (!mission) return;
    const plan = await runtimes.planNextMissionStage(mission);
    if (!plan || plan.stage.id !== stageId) return;
    const graph = await runtimes.continueMission(mission);
    if (graph) {
      setMissionExecution((prev) => ({ ...prev, [graph.stage_id || stageId]: graph.id }));
    }
  };

  const launchMission = async () => {
    if (!mission) return;
    const result = await runtimes.runMission(mission, autoChainMission ? 8 : 1);
    if (!result) return;
    if (result.launched.length > 0) {
      setMissionExecution((prev) => {
        const next = { ...prev };
        for (const graph of result.launched) {
          if (graph.stage_id) {
            next[graph.stage_id] = graph.id;
          }
        }
        return next;
      });
    }
  };

  const stageStatus = (stageId: string) => {
    const task = missionTaskByStageId(stageId);
    if (!task) return "pending";
    return task.status;
  };

  useEffect(() => {
    if (!mission || !autoChainMission) return;
    void (async () => {
      const plan = await runtimes.planNextMissionStage(mission);
      if (!plan || plan.stage.depends_on.length === 0) return;
      const result = await runtimes.runMission(mission, 1);
      if (result?.launched.length) {
        setMissionExecution((prev) => {
          const next = { ...prev };
          for (const graph of result.launched) {
            if (graph.stage_id) {
              next[graph.stage_id] = graph.id;
            }
          }
          return next;
        });
      }
    })();
  }, [mission, missionExecution, runtimes.tasks, autoChainMission]);

  return (
    <div className="flex flex-col h-full bg-[#09090b]">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#1f1f1f] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-[#666] hover:text-[#e5e5e5] text-xs transition-colors">
            ← back
          </button>
          <div>
            <h2 className="text-sm font-semibold text-[#e5e5e5]">Operators</h2>
            <p className="text-xs text-[#666] mt-0.5">
              One control plane for Blade native execution, commercial copilots, and open-source runtimes.
            </p>
          </div>
        </div>
        <button
          onClick={runtimes.refresh}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-[#666] hover:text-[#e5e5e5] hover:bg-[#1f1f1f] transition-colors"
          title="Refresh runtimes"
        >
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <path d="M13.5 8A5.5 5.5 0 112.5 8" />
            <path d="M13.5 4v4h-4" />
          </svg>
        </button>
      </div>

      <div className="px-4 pt-3 flex items-center gap-2 border-b border-[#1f1f1f]">
        {[
          { id: "mission", label: "Mission control" },
          { id: "library", label: "Mission library" },
          { id: "blade", label: "Blade native" },
          { id: "managed", label: "Claude SDK" },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setTab(item.id as OperatorTab)}
            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
              tab === item.id
                ? "bg-[#16172a] text-[#c8cbff] border border-[#6366f1]/30"
                : "text-[#666] hover:text-[#e5e5e5] hover:bg-[#111]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {runtimes.error ? (
        <div className="mx-4 mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <div className="flex items-center justify-between gap-3">
            <span>{runtimes.error}</span>
            <button onClick={runtimes.dismissError} className="text-red-100/80 hover:text-white transition-colors">
              dismiss
            </button>
          </div>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {tab === "mission" ? (
          <div className="p-4 space-y-4">
            <section className="rounded-2xl border border-blade-border bg-blade-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-blade-text font-medium">Runtime registry</div>
                  <div className="text-xs text-blade-muted mt-1">
                    Installed tools first. Blade-native, Claude, Codex, and GitHub-native runtimes all show up here with the same session model.
                  </div>
                </div>
                <button
                  onClick={() => {
                    setSelectedRuntimeId("blade-native");
                    setOperatorType("desktop_operator");
                  }}
                  className="text-2xs px-3 py-1.5 rounded-lg bg-[#16172a] text-[#c8cbff] border border-[#6366f1]/20"
                >
                  desktop quickstart
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                {runtimes.runtimes.map((runtime) => (
                  <RuntimeCard
                    key={runtime.id}
                    runtime={runtime}
                    selected={selectedRuntimeId === runtime.id}
                    onSelect={() => setSelectedRuntimeId(runtime.id)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-blade-border bg-blade-surface p-4">
              <div className="text-sm text-blade-text font-medium">Launch task</div>
              <div className="text-xs text-blade-muted mt-1">
                Tell Blade the goal. Blade chooses the runtime lane, but you can override it here while we harden the control plane.
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1.1fr,0.9fr] gap-4 mt-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Goal</label>
                    <textarea
                      value={goal}
                      onChange={(event) => {
                        setGoal(event.target.value);
                        setRouteRecommendation(null);
                      }}
                      rows={4}
                      placeholder="Fix this repo, research a topic, drive the browser, continue a Claude session..."
                      className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-3 text-sm text-blade-text outline-none focus:border-[#6366f1]/40 resize-none"
                    />
                  </div>
                  {looksLikeSecurityGoal(goal) ? (
                    <div
                      className={`rounded-xl border px-3 py-2 text-2xs ${
                        verifiedSecurityEngagement
                          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                          : "border-amber-500/20 bg-amber-500/10 text-amber-100"
                      }`}
                    >
                      {verifiedSecurityEngagement
                        ? `Verified security engagement active: ${verifiedSecurityEngagement.title} · ${verifiedSecurityEngagement.scope}`
                        : "Security-style work should stay scoped to a verified engagement. Create one below before treating Blade like a real assessment operator."}
                    </div>
                  ) : null}
                  {handoffSourceTaskId ? (
                    <div className="rounded-xl border border-[#6366f1]/20 bg-[#16172a] px-3 py-2 text-2xs text-[#c8cbff]">
                      Handoff ready from task {handoffSourceTaskId.slice(0, 8)}
                      <button
                        onClick={() => {
                          setHandoffSourceTaskId(null);
                          setHandoffNote("");
                        }}
                        className="ml-2 text-[#c8cbff]/70 hover:text-white transition-colors"
                      >
                        clear
                      </button>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Working dir</label>
                      <input
                        value={cwd}
                        onChange={(event) => setCwd(event.target.value)}
                        placeholder="/path/to/workspace"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                    </div>
                    <div>
                      <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Resume session</label>
                      <input
                        value={resumeSessionId}
                        onChange={(event) => setResumeSessionId(event.target.value)}
                        placeholder="optional session id"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Selected runtime</label>
                      <div className="rounded-xl border border-blade-border bg-[#0d0d10] px-3 py-3">
                        <div className="text-sm text-blade-secondary">{selectedRuntime?.name ?? "No runtime selected"}</div>
                        <div className="text-2xs text-blade-muted mt-1">
                          {selectedRuntime
                            ? `${selectedRuntime.source} · ${statusLabel(selectedRuntime)}`
                            : "Choose a runtime above"}
                        </div>
                        <div className="text-2xs text-blade-muted mt-1">
                          {selectedRuntime?.capabilities.slice(0, 2).map((capability) => capability.label).join(" · ") || ""}
                        </div>
                        {selectedRuntime?.server_url ? (
                          <div className="text-2xs text-emerald-300/80 mt-1 font-mono">
                            warm server · {selectedRuntime.server_url}
                          </div>
                        ) : null}
                      </div>
                    </div>

                  {selectedRuntime?.id === "blade-native" ? (
                    <>
                      <div>
                        <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Blade operator</label>
                        <select
                          value={operatorType}
                          onChange={(event) => setOperatorType(event.target.value as "general_operator" | "desktop_operator")}
                          className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                        >
                          <option value="general_operator">General operator</option>
                          <option value="desktop_operator">Desktop operator</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">Preferred substrate</label>
                        <select
                          value={preferredSubstrate}
                          onChange={(event) => setPreferredSubstrate(event.target.value)}
                          className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                        >
                          <option value="">Auto</option>
                          <option value="browser-native">Browser native</option>
                          <option value="windows-native">Windows native</option>
                          <option value="visual-fallback">Visual fallback</option>
                        </select>
                      </div>
                    </>
                  ) : null}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      onClick={() => void handleDesignMission()}
                      disabled={!goal.trim()}
                      className="text-xs px-3 py-2 rounded-xl bg-[#16172a] text-[#c8cbff] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Design mission
                    </button>
                    <button
                      onClick={() => void handleRecommendRoute()}
                      disabled={!goal.trim()}
                      className="text-xs px-3 py-2 rounded-xl bg-blade-surface-hover text-blade-secondary hover:text-blade-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Auto route
                    </button>
                    <button
                      onClick={handleStart}
                      disabled={!selectedRuntime || !goal.trim()}
                      className="text-xs px-3 py-2 rounded-xl bg-[#6366f1] text-white disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {resumeSessionId.trim() ? "Resume task" : "Start task"}
                    </button>
                    {selectedRuntime?.install_requirement ? (
                      <button
                        onClick={openInstallGuide}
                        className="text-xs px-3 py-2 rounded-xl bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
                      >
                        Open setup guide
                      </button>
                    ) : null}
                    {selectedRuntime?.id === "opencode-cli" ? (
                      selectedRuntime.server_url ? (
                        <button
                          onClick={() => void runtimes.stopServer(selectedRuntime.id)}
                          className="text-xs px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 transition-colors"
                        >
                          Stop warm server
                        </button>
                      ) : (
                        <button
                          onClick={() => void runtimes.startServer(selectedRuntime.id)}
                          disabled={!selectedRuntime.installed}
                          className="text-xs px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Start warm server
                        </button>
                      )
                    ) : null}
                    <button
                      onClick={() => {
                        setGoal("");
                        setCwd("");
                        setResumeSessionId("");
                        setPreferredSubstrate("");
                        setOperatorType("general_operator");
                        setRouteRecommendation(null);
                        setMission(null);
                        setMissionExecution({});
                        setHandoffSourceTaskId(null);
                        setHandoffNote("");
                      }}
                      className="text-xs px-3 py-2 rounded-xl bg-transparent border border-blade-border text-blade-muted hover:text-blade-secondary transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  {mission ? (
                    <label className="flex items-center gap-2 text-2xs text-blade-muted">
                      <input
                        type="checkbox"
                        checked={autoChainMission}
                        onChange={(event) => setAutoChainMission(event.target.checked)}
                        className="rounded border-blade-border bg-[#0d0d10]"
                      />
                      Auto-chain mission stages when dependencies complete
                    </label>
                  ) : null}
                  {routeRecommendation ? (
                    <div className="rounded-xl border border-blade-border bg-[#0d0d10] px-3 py-3">
                      <div className="text-xs text-blade-secondary">
                        Recommended: {routeRecommendation.runtime_id}
                        {routeRecommendation.preferred_substrate ? ` · ${routeRecommendation.preferred_substrate}` : ""}
                      </div>
                      <div className="mt-1 text-2xs text-blade-muted">
                        {routeRecommendation.rationale}
                      </div>
                      <div className="mt-1 text-2xs text-blade-muted/70">
                        Confidence {(routeRecommendation.confidence * 100).toFixed(0)}%
                      </div>
                      {routeRecommendation.prefers_warm_runtime ? (
                        <div className="mt-1 text-2xs text-emerald-300/80">
                          Blade is preferring a warm runtime here so it can reuse live state instead of cold-starting.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {mission ? (
                    <div className="rounded-xl border border-blade-border bg-[#0d0d10] px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-blade-secondary">Mission blueprint</div>
                          <div className="mt-1 text-2xs text-blade-muted">{mission.summary}</div>
                        </div>
                        <button
                          onClick={() => void launchMission()}
                          disabled={mission.stages.every((stage) => missionExecution[stage.id])}
                          className="text-2xs px-2.5 py-1.5 rounded-lg bg-[#16172a] text-[#c8cbff] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          Run mission
                        </button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {mission.stages.map((stage) => {
                          const stageTask = missionTaskByStageId(stage.id);
                          const stageArtifacts = stageTask ? prominentArtifacts(stageTask.artifacts, 2) : [];
                          return (
                          <div key={stage.id} className="rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-2xs text-blade-secondary">{stage.title}</div>
                                <div className="mt-1 text-2xs text-blade-muted">
                                  {stage.runtime.runtime_id}
                                  {stage.runtime.preferred_substrate ? ` · ${stage.runtime.preferred_substrate}` : ""}
                                  {` · ${stageStatus(stage.id)}`}
                                </div>
                                {stage.runtime.prefers_warm_runtime ? (
                                  <div className="mt-1 text-2xs text-emerald-300/80">
                                    Warm runtime reuse
                                  </div>
                                ) : null}
                                {stageStatus(stage.id) === "pending" ? (
                                  <div className="mt-1 text-2xs text-sky-300/80">
                                    Kernel-planned stage
                                  </div>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    setGoal(stage.goal);
                                    setSelectedRuntimeId(stage.runtime.runtime_id);
                                    setOperatorType(
                                      stage.runtime.operator_type === "desktop_operator" ? "desktop_operator" : "general_operator"
                                    );
                                    setPreferredSubstrate(stage.runtime.preferred_substrate || "");
                                  }}
                                  className="text-2xs px-2 py-1 rounded-md bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
                                >
                                  use
                                </button>
                                <button
                                  onClick={() => void launchMissionStage(stage.id)}
                                  disabled={stage.depends_on.some((dependencyId) => !missionTaskByStageId(dependencyId))}
                                  className="text-2xs px-2 py-1 rounded-md bg-[#16172a] text-[#c8cbff] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  run
                                </button>
                              </div>
                            </div>
                            <div className="mt-2 text-2xs text-blade-muted whitespace-pre-wrap line-clamp-3">
                              {stage.goal}
                            </div>
                            {stageTask?.summary ? (
                              <div className="mt-2 rounded-md border border-white/5 bg-black/20 px-2 py-1.5 text-2xs text-blade-secondary whitespace-pre-wrap line-clamp-4">
                                {stageTask.summary}
                              </div>
                            ) : null}
                            {stageArtifacts.length > 0 ? (
                              <div className="mt-2 space-y-1.5">
                                {stageArtifacts.map((artifact) => (
                                  <div
                                    key={artifact.id}
                                    className="rounded-md border border-emerald-500/10 bg-emerald-500/5 px-2 py-1.5 text-2xs text-emerald-100"
                                  >
                                    <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/80">
                                      {artifact.label} · {artifact.kind}
                                    </div>
                                    <div className="mt-1 text-2xs text-emerald-50/90 whitespace-pre-wrap line-clamp-3">
                                      {compactArtifactValue(artifact.value, 220)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {stage.depends_on.length > 0 ? (
                              <div className="mt-2 text-2xs text-blade-muted/70">
                                Depends on {stage.depends_on.join(", ")}
                              </div>
                            ) : null}
                          </div>
                        )})}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-[0.95fr,1.05fr] gap-4">
              <div className="rounded-2xl border border-blade-border bg-blade-surface p-4">
                <div className="mb-4">
                  <div className="mb-4">
                    <div className="text-sm text-blade-text font-medium">Web intelligence</div>
                    <div className="text-xs text-blade-muted mt-1">
                      Configure Tavily and Firecrawl once so Blade can route research, crawl, and extract missions through them.
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        value={tavilyApiKey}
                        onChange={(event) => setTavilyApiKey(event.target.value)}
                        placeholder="Tavily API key"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                      <input
                        value={firecrawlApiKey}
                        onChange={(event) => setFirecrawlApiKey(event.target.value)}
                        placeholder="Firecrawl API key"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                      <input
                        value={firecrawlApiUrl}
                        onChange={(event) => setFirecrawlApiUrl(event.target.value)}
                        placeholder="Firecrawl API URL (optional for self-hosting)"
                        className="md:col-span-2 w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleSaveWebIntelligence()}
                        className="text-2xs px-3 py-1.5 rounded-lg bg-[#16172a] text-[#c8cbff] hover:text-white transition-colors"
                      >
                        Save web intelligence
                      </button>
                      <span className="inline-flex items-center rounded-full border border-blade-border bg-blade-surface/70 px-2.5 py-1 text-2xs text-blade-muted">
                        Tavily {runtimes.runtimes.find((runtime) => runtime.id === "tavily-backend")?.authenticated ? "ready" : "not connected"}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-blade-border bg-blade-surface/70 px-2.5 py-1 text-2xs text-blade-muted">
                        Firecrawl {runtimes.runtimes.find((runtime) => runtime.id === "firecrawl-backend")?.authenticated ? "ready" : "not connected"}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="text-sm text-blade-text font-medium">Capability blueprints</div>
                    <div className="text-xs text-blade-muted mt-1">
                      Upgrade paths Blade can design and execute, from WSL and OBS to Tavily, Firecrawl, and self-authored tool packs.
                    </div>
                    <div className="mt-3 space-y-2 max-h-[15rem] overflow-y-auto">
                      {runtimes.capabilityBlueprints.map((blueprint) => (
                        <div
                          key={blueprint.id}
                          className="rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-2xs text-blade-secondary">{blueprint.title}</div>
                              <div className="mt-1 text-2xs text-blade-muted line-clamp-2">{blueprint.summary}</div>
                            </div>
                            <span className={`text-[10px] px-2 py-1 rounded-full border ${capabilityTone(blueprint.category)}`}>
                              {blueprint.category}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              onClick={() => {
                                setGoal(blueprint.goal_template);
                                if (blueprint.runtime_hint) {
                                  setSelectedRuntimeId(blueprint.runtime_hint);
                                }
                              }}
                              className="text-2xs px-2.5 py-1 rounded-lg bg-[#16172a] text-[#c8cbff] hover:text-white transition-colors"
                            >
                              Load into mission
                            </button>
                            <button
                              onClick={() => {
                                setGoal(blueprint.goal_template);
                                if (blueprint.runtime_hint) {
                                  setSelectedRuntimeId(blueprint.runtime_hint);
                                }
                                void handleDesignMission(blueprint.goal_template);
                              }}
                              className="text-2xs px-2.5 py-1 rounded-lg bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
                            >
                              Design now
                            </button>
                          </div>
                          {blueprint.install_command ? (
                            <div className="mt-2 text-2xs text-blade-muted font-mono break-all">
                              {blueprint.install_command}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="text-sm text-blade-text font-medium">Installed capability packs</div>
                    <div className="text-xs text-blade-muted mt-1">
                      Blade plugins are the beginning of a package system. These are the local packs Blade can toggle and call into.
                    </div>
                    <div className="mt-3 space-y-2 max-h-[12rem] overflow-y-auto">
                      {runtimes.installedPlugins.length > 0 ? (
                        runtimes.installedPlugins.map((plugin) => (
                          <div
                            key={plugin.manifest.name}
                            className="rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-2xs text-blade-secondary">{plugin.manifest.name}</div>
                                <div className="mt-1 text-2xs text-blade-muted line-clamp-2">
                                  {plugin.manifest.description}
                                </div>
                              </div>
                              <button
                                onClick={() => void runtimes.togglePlugin(plugin.manifest.name, !plugin.enabled)}
                                className={`text-2xs px-2 py-1 rounded-lg transition-colors ${
                                  plugin.enabled
                                    ? "bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20"
                                    : "bg-blade-surface-hover text-blade-muted hover:text-blade-secondary"
                                }`}
                              >
                                {plugin.enabled ? "enabled" : "disabled"}
                              </button>
                            </div>
                            <div className="mt-1 text-2xs text-blade-muted/70">
                              {plugin.manifest.commands.length} commands · {plugin.path}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-blade-muted">No capability packs installed yet.</div>
                      )}
                    </div>
                    {runtimes.pluginCommands.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2">
                        <div className="text-2xs text-blade-secondary">Pack commands</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {runtimes.pluginCommands.slice(0, 10).map((command) => (
                            <span
                              key={`${command.plugin}-${command.name}`}
                              className="inline-flex items-center rounded-full border border-blade-border bg-blade-surface/70 px-2.5 py-1 text-2xs text-blade-muted"
                            >
                              {command.plugin} · {command.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="mb-4">
                    <div className="text-sm text-blade-text font-medium">Security engagements</div>
                    <div className="text-xs text-blade-muted mt-1">
                      Proof-first guardrails for owned-asset security work. Blade can be unusually capable here, but only inside a verified scope.
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        value={engagementTitle}
                        onChange={(event) => setEngagementTitle(event.target.value)}
                        placeholder="Engagement title"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                      <input
                        value={engagementOwner}
                        onChange={(event) => setEngagementOwner(event.target.value)}
                        placeholder="Owner / company"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                      <input
                        value={engagementContact}
                        onChange={(event) => setEngagementContact(event.target.value)}
                        placeholder="Contact"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                      <select
                        value={engagementAssetKind}
                        onChange={(event) => setEngagementAssetKind(event.target.value)}
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      >
                        <option value="domain">Domain</option>
                        <option value="repository">Repository</option>
                        <option value="host">Host / machine</option>
                        <option value="application">Application</option>
                      </select>
                      <textarea
                        value={engagementScope}
                        onChange={(event) => setEngagementScope(event.target.value)}
                        rows={3}
                        placeholder="Scope: domains, repos, hosts, constraints, dates"
                        className="md:col-span-2 w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-3 text-xs text-blade-text outline-none focus:border-[#6366f1]/40 resize-none"
                      />
                      <select
                        value={engagementVerificationMethod}
                        onChange={(event) => setEngagementVerificationMethod(event.target.value)}
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      >
                        <option value="dns_txt">DNS TXT challenge</option>
                        <option value="repo_file">Repo proof file</option>
                        <option value="host_file">Host proof file</option>
                        <option value="manual_attestation">Manual attestation</option>
                      </select>
                      <input
                        value={engagementProof}
                        onChange={(event) => setEngagementProof(event.target.value)}
                        placeholder="Proof value or attestation note"
                        className="w-full rounded-xl bg-[#0d0d10] border border-blade-border px-3 py-2 text-xs text-blade-text outline-none focus:border-[#6366f1]/40"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => void handleCreateEngagement()}
                        className="text-2xs px-3 py-1.5 rounded-lg bg-[#16172a] text-[#c8cbff] hover:text-white transition-colors"
                      >
                        Create engagement
                      </button>
                      <button
                        onClick={() => void handleVerifyEngagement()}
                        disabled={!latestSecurityEngagement}
                        className="text-2xs px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Mark verified
                      </button>
                    </div>
                    {latestSecurityEngagement ? (
                      <div className="mt-3 rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2">
                        <div className="text-2xs text-blade-secondary">{latestSecurityEngagement.title}</div>
                        <div className="mt-1 text-2xs text-blade-muted">
                          {latestSecurityEngagement.asset_kind} · {latestSecurityEngagement.status}
                          {latestSecurityEngagement.verified_at ? ` · verified ${relativeTime(latestSecurityEngagement.verified_at)}` : ""}
                        </div>
                        <div className="mt-2 text-2xs text-blade-muted whitespace-pre-wrap">
                          {latestSecurityEngagement.proof_instructions}
                        </div>
                        <div className="mt-2 text-2xs text-amber-100/80 font-mono break-all">
                          {latestSecurityEngagement.challenge_token}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 space-y-2 max-h-[10rem] overflow-y-auto">
                      {runtimes.securityEngagements.length > 0 ? (
                        runtimes.securityEngagements.slice(0, 6).map((engagement) => (
                          <div
                            key={engagement.id}
                            className="rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2"
                          >
                            <div className="text-2xs text-blade-secondary">{engagement.title}</div>
                            <div className="mt-1 text-2xs text-blade-muted">
                              {engagement.asset_kind} · {engagement.status} · {engagement.verification_method}
                            </div>
                            <div className="mt-1 text-2xs text-blade-muted/80 line-clamp-2">{engagement.scope}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-blade-muted">No security engagements yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="mb-4">
                    <div className="text-sm text-blade-text font-medium">Company memory</div>
                    <div className="text-xs text-blade-muted mt-1">
                      Early operating objects for goals, projects, KPIs, decisions, and SOPs.
                    </div>
                    <div className="mt-3 space-y-2 max-h-[12rem] overflow-y-auto">
                      {runtimes.companyObjects.length > 0 ? (
                        runtimes.companyObjects.slice(0, 8).map((object) => (
                          <div
                            key={object.id}
                            className="rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2"
                          >
                            <div className="text-2xs text-blade-secondary">{object.title}</div>
                            <div className="mt-1 text-2xs text-blade-muted">
                              {object.kind} · {object.status}
                              {object.linked_mission_id ? ` · linked mission` : ""}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-blade-muted">No company objects yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="text-sm text-blade-text font-medium">Saved missions</div>
                  <div className="text-xs text-blade-muted mt-1">
                    Backend mission objects that survive beyond the current launch form.
                  </div>
                  <div className="mt-3 space-y-2 max-h-[12rem] overflow-y-auto">
                    {runtimes.missions.length > 0 ? (
                      runtimes.missions.slice(0, 8).map((stored) => (
                        <button
                          key={stored.mission.id}
                          onClick={() => {
                            setMission(stored.mission);
                            setGoal(stored.mission.goal);
                          }}
                          className="w-full text-left rounded-lg border border-blade-border/60 bg-[#0d0d10] px-3 py-2 hover:border-blade-accent/20 transition-colors"
                        >
                          <div className="text-2xs text-blade-secondary">{stored.mission.goal}</div>
                          <div className="mt-1 text-2xs text-blade-muted">
                            {stored.status}
                            {stored.next_stage_id ? ` · next ${stored.next_stage_id}` : ""}
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="text-xs text-blade-muted">No saved missions yet.</div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-blade-text font-medium">Resumable sessions</div>
                    <div className="text-xs text-blade-muted mt-1">
                      Imported from installed runtimes instead of making you re-explain context every time.
                    </div>
                  </div>
                  {selectedRuntime ? (
                    <button
                      onClick={() => void runtimes.refreshSessions(selectedRuntime.id)}
                      className="text-2xs px-2.5 py-1 rounded-lg bg-blade-surface-hover text-blade-muted hover:text-blade-secondary transition-colors"
                    >
                      refresh
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 space-y-2 max-h-[24rem] overflow-y-auto">
                  {resumableSessions.length > 0 ? (
                    resumableSessions.map((session) => (
                      <SessionRow
                        key={`${session.runtime_id}-${session.session_id}`}
                        session={session}
                        onUse={() => {
                          setSelectedRuntimeId(session.runtime_id);
                          setResumeSessionId(session.session_id);
                          if (!cwd && session.cwd) setCwd(session.cwd);
                        }}
                      />
                    ))
                  ) : (
                    <div className="text-xs text-blade-muted">No imported sessions yet.</div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-blade-border bg-blade-surface p-4">
                <div className="text-sm text-blade-text font-medium">Live task graphs</div>
                <div className="text-xs text-blade-muted mt-1">
                  Unified status for work started from Blade, Claude, or Codex through the operator kernel.
                </div>
                <div className="mt-4 space-y-3 max-h-[24rem] overflow-y-auto">
                  {runtimes.tasks.length > 0 ? (
                    runtimes.tasks.map((task) => {
                      const latestMessage = [...task.messages].reverse().find((message) => message.role === "assistant" || message.role === "tool");
                      const taskArtifacts = prominentArtifacts(task.artifacts, 3);
                      return (
                        <div key={task.id} className="rounded-xl border border-blade-border/60 bg-[#0d0d10] p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-xs text-blade-secondary truncate">{task.goal}</div>
                              <div className="text-2xs text-blade-muted mt-1">
                                {task.runtimeId} · {task.status}
                                {task.sessionId ? ` · ${task.sessionId.slice(0, 12)}` : ""}
                                {task.mission_id ? ` · mission ${task.mission_id.slice(0, 8)}` : ""}
                                {task.stage_id ? ` · ${task.stage_id}` : ""}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              {task.status === "running" || task.status === "starting" ? (
                                <button
                                  onClick={() => void runtimes.stopTask(task.id)}
                                  className="text-2xs px-2 py-1 rounded-md bg-red-500/10 text-red-200 hover:bg-red-500/20 transition-colors"
                                >
                                  stop
                                </button>
                              ) : null}
                              {(task.summary || latestMessage?.content) ? (
                                <button
                                  onClick={() => onSendToChat(task.summary || latestMessage?.content || "")}
                                  className="text-2xs px-2 py-1 rounded-md bg-blade-surface-hover text-blade-secondary hover:text-blade-text transition-colors"
                                >
                                  to chat
                                </button>
                              ) : null}
                              <button
                                onClick={() => void prepareHandoff(task)}
                                className="text-2xs px-2 py-1 rounded-md bg-[#16172a] text-[#c8cbff] hover:text-white transition-colors"
                              >
                                handoff
                              </button>
                            </div>
                          </div>
                          {task.checkpoints.length > 0 ? (
                            <div className="mt-3 space-y-1.5">
                              {task.checkpoints.slice(-3).map((checkpoint) => (
                                <div key={checkpoint.id} className="text-2xs text-blade-muted">
                                  <span className="text-blade-secondary">{checkpoint.title}</span>
                                  {checkpoint.detail ? ` · ${checkpoint.detail}` : ""}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {latestMessage?.content ? (
                            <div className="mt-3 rounded-lg bg-black/20 border border-white/5 px-3 py-2 text-2xs text-blade-secondary whitespace-pre-wrap">
                              {latestMessage.content}
                            </div>
                          ) : null}
                          {taskArtifacts.length > 0 ? (
                            <div className="mt-3 space-y-2">
                              {taskArtifacts.map((artifact) => (
                                <div
                                  key={artifact.id}
                                  className="rounded-lg border border-sky-500/10 bg-sky-500/5 px-3 py-2 text-2xs"
                                >
                                  <div className="text-[10px] uppercase tracking-[0.16em] text-sky-300/80">
                                    {artifact.label} · {artifact.kind}
                                  </div>
                                  <div className="mt-1 text-sky-50/90 whitespace-pre-wrap">
                                    {compactArtifactValue(artifact.value, 260)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-xs text-blade-muted">No live tasks yet. Start one above.</div>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : tab === "library" ? (
          <MissionLibrary
            specs={librarySpecs}
            filter={libraryFilter}
            onFilterChange={setLibraryFilter}
            composingSpec={composingSpec}
            composerVars={composerVars}
            onComposerVarChange={(key, value) => setComposerVars((v) => ({ ...v, [key]: value }))}
            onSelectSpec={(spec) => {
              setComposingSpec(spec);
              setComposerVars({});
            }}
            onCancelCompose={() => setComposingSpec(null)}
            onDeleteSpec={async (id) => {
              await deleteMissionSpec(id);
              setLibrarySpecs(await listMissionSpecs());
            }}
            onLaunch={async () => {
              if (!composingSpec) return;
              const missing = missingVars(composingSpec, composerVars);
              if (missing.length > 0) return;
              const om = specToOperatorMission(composingSpec, composerVars);
              await runtimes.saveMission(om, true);
              setMission(om);
              setMissionExecution({});
              setComposingSpec(null);
              setTab("mission");
            }}
          />
        ) : tab === "blade" ? (
          <AgentManager />
        ) : (
          <ManagedAgentPanel onBack={() => setTab("mission")} onSendToChat={onSendToChat} />
        )}
      </div>
    </div>
  );
}

// ── Mission Library Component ─────────────────────────────────────────────────

const TAG_COLORS: Record<string, string> = {
  research: "text-emerald-300 border-emerald-500/20 bg-emerald-500/10",
  writing: "text-sky-300 border-sky-500/20 bg-sky-500/10",
  code: "text-violet-300 border-violet-500/20 bg-violet-500/10",
  engineering: "text-violet-300 border-violet-500/20 bg-violet-500/10",
  debugging: "text-orange-300 border-orange-500/20 bg-orange-500/10",
  web: "text-pink-300 border-pink-500/20 bg-pink-500/10",
  data: "text-cyan-300 border-cyan-500/20 bg-cyan-500/10",
  strategy: "text-amber-300 border-amber-500/20 bg-amber-500/10",
  content: "text-rose-300 border-rose-500/20 bg-rose-500/10",
  productivity: "text-teal-300 border-teal-500/20 bg-teal-500/10",
  learning: "text-indigo-300 border-indigo-500/20 bg-indigo-500/10",
  monitoring: "text-yellow-300 border-yellow-500/20 bg-yellow-500/10",
  system: "text-slate-300 border-slate-500/20 bg-slate-500/10",
  news: "text-fuchsia-300 border-fuchsia-500/20 bg-fuchsia-500/10",
  marketing: "text-red-300 border-red-500/20 bg-red-500/10",
  thinking: "text-lime-300 border-lime-500/20 bg-lime-500/10",
};

function tagColor(tag: string) {
  return TAG_COLORS[tag] ?? "text-blade-secondary border-blade-border bg-blade-surface";
}

function MissionLibrary({
  specs,
  filter,
  onFilterChange,
  composingSpec,
  composerVars,
  onComposerVarChange,
  onSelectSpec,
  onCancelCompose,
  onDeleteSpec,
  onLaunch,
}: {
  specs: MissionSpec[];
  filter: string;
  onFilterChange: (v: string) => void;
  composingSpec: MissionSpec | null;
  composerVars: Record<string, string>;
  onComposerVarChange: (key: string, value: string) => void;
  onSelectSpec: (spec: MissionSpec) => void;
  onCancelCompose: () => void;
  onDeleteSpec: (id: string) => void;
  onLaunch: () => void;
}) {
  const lf = filter.toLowerCase();
  const filtered = specs.filter(
    (s) =>
      !lf ||
      s.title.toLowerCase().includes(lf) ||
      s.description.toLowerCase().includes(lf) ||
      s.tags.some((t) => t.includes(lf))
  );

  if (composingSpec) {
    const missing = missingVars(composingSpec, composerVars);
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={onCancelCompose} className="text-xs text-blade-muted hover:text-blade-text transition-colors">
            ← library
          </button>
          <div>
            <div className="text-sm font-medium text-blade-text">{composingSpec.title}</div>
            <div className="text-xs text-blade-muted mt-0.5">{composingSpec.description.replace(/\{\{[^}]+\}\}/g, "…")}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-blade-border bg-blade-surface p-4 space-y-3">
          <div className="text-xs text-blade-muted mb-1">Fill in the variables to generate this mission.</div>
          {composingSpec.inputVars.map((varName) => (
            <div key={varName}>
              <label className="block text-2xs uppercase tracking-[0.18em] text-blade-muted mb-1">{varName.replace(/_/g, " ")}</label>
              <input
                type="text"
                value={composerVars[varName] ?? ""}
                onChange={(e) => onComposerVarChange(varName, e.target.value)}
                placeholder={`Enter ${varName.replace(/_/g, " ")}…`}
                className="w-full text-sm bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-blade-text placeholder:text-blade-muted outline-none focus:border-blade-accent/50"
              />
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-blade-border bg-blade-surface p-4 space-y-2">
          <div className="text-xs text-blade-muted mb-2">Mission stages</div>
          {composingSpec.stages.map((stage, idx) => (
            <div key={stage.id} className="flex items-start gap-3 rounded-lg border border-blade-border/60 bg-blade-bg/60 px-3 py-2">
              <div className="w-5 h-5 rounded-full bg-blade-accent/15 border border-blade-accent/20 text-blade-accent text-2xs flex items-center justify-center flex-shrink-0 mt-0.5">
                {idx + 1}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-blade-text font-medium">{stage.title}</div>
                <div className="text-2xs text-blade-muted mt-0.5 line-clamp-2">
                  {stage.goalTemplate.replace(/\{\{(\w+)\}\}/g, (_, k) => composerVars[k] ? `[${composerVars[k]}]` : `{{${k}}}`)}
                </div>
                {stage.runtimeHint ? (
                  <div className="text-2xs text-blade-accent/70 mt-1">via {stage.runtimeHint}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onLaunch}
          disabled={missing.length > 0}
          className={`w-full py-2 rounded-xl text-sm font-medium transition-colors ${
            missing.length === 0
              ? "bg-blade-accent text-white hover:bg-blade-accent/90"
              : "bg-blade-surface text-blade-muted border border-blade-border cursor-not-allowed"
          }`}
        >
          {missing.length > 0 ? `Fill in: ${missing.join(", ")}` : "Launch mission →"}
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="relative">
        <input
          type="text"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Search missions…"
          className="w-full text-sm bg-blade-surface border border-blade-border rounded-xl px-3 py-2 pl-8 text-blade-text placeholder:text-blade-muted outline-none focus:border-blade-accent/50"
        />
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blade-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" strokeWidth={2} />
          <path d="M21 21l-4.35-4.35" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-8 text-sm text-blade-muted">No missions match "{filter}"</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((spec) => (
            <button
              key={spec.id}
              onClick={() => onSelectSpec(spec)}
              className="text-left rounded-2xl border border-blade-border bg-blade-surface hover:border-blade-accent/30 hover:bg-blade-accent-muted p-4 transition-colors group"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-blade-text group-hover:text-blade-accent transition-colors">
                  {spec.title}
                </div>
                {!spec.builtIn ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteSpec(spec.id); }}
                    className="text-blade-muted hover:text-red-400 transition-colors flex-shrink-0"
                    title="Delete mission"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path d="M18 6L6 18M6 6l12 12" strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  </button>
                ) : null}
              </div>
              <div className="text-xs text-blade-muted mt-1.5 line-clamp-2">
                {spec.description.replace(/\{\{[^}]+\}\}/g, "…")}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {spec.tags.map((tag) => (
                  <span key={tag} className={`text-2xs px-1.5 py-0.5 rounded-md border ${tagColor(tag)}`}>
                    {tag}
                  </span>
                ))}
                <span className="text-2xs px-1.5 py-0.5 rounded-md border border-blade-border/60 text-blade-muted/60">
                  {spec.stages.length} stage{spec.stages.length !== 1 ? "s" : ""}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default OperatorCenter;
