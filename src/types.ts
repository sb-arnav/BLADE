export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image_base64?: string;
  timestamp: number;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface BladeConfig {
  provider: string;
  api_key: string;
  model: string;
  onboarded: boolean;
  mcp_servers: McpServerConfig[];
  token_efficient?: boolean;
  user_name?: string;
  work_mode?: string;
  response_style?: string;
  blade_email?: string;
  base_url?: string;
  god_mode?: boolean;
  god_mode_tier?: string; // "normal" | "intermediate" | "extreme"
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

export interface StoredConversation extends ConversationSummary {
  messages: Message[];
}

export interface McpTool {
  name: string;
  qualified_name: string;
  description: string;
  input_schema: unknown;
  server_name: string;
}

export interface ToolExecution {
  id: string;
  tool_name: string;
  risk: ToolPermission;
  status: "executing" | "completed";
  is_error?: boolean;
  started_at: number;
  completed_at?: number;
}

export type ToolPermission = "Auto" | "Ask" | "Blocked";

export interface ToolApprovalRequest {
  approval_id: string;
  name: string;
  arguments: string;
  risk: ToolPermission;
}

export interface ImportedMcpServer {
  name: string;
  command: string;
  args: string[];
  source: string;
}

export interface RuntimeCapability {
  id: string;
  label: string;
  description: string;
}

export interface RuntimeSessionRef {
  runtime_id: string;
  session_id: string;
  cwd?: string | null;
  title: string;
  resumable: boolean;
  last_active_at: number;
}

export interface InstallRequirement {
  runtime_id: string;
  kind: string;
  title: string;
  message: string;
  command?: string | null;
  url?: string | null;
}

export interface RuntimeDescriptor {
  id: string;
  name: string;
  source: string;
  installed: boolean;
  authenticated: boolean;
  version?: string | null;
  capabilities: RuntimeCapability[];
  platforms: string[];
  sessions: RuntimeSessionRef[];
  active_tasks: number;
  server_url?: string | null;
  install_requirement?: InstallRequirement | null;
}

export interface TaskCheckpoint {
  id: string;
  title: string;
  detail: string;
  status: string;
  timestamp: number;
}

export interface TaskArtifact {
  id: string;
  label: string;
  kind: string;
  value: string;
}

export interface TaskGraph {
  id: string;
  goal: string;
  operator_type: string;
  preferred_runtime?: string | null;
  preferred_substrate?: string | null;
  security_engagement_id?: string | null;
  mission_id?: string | null;
  stage_id?: string | null;
  parent_task_id?: string | null;
  handoff_note?: string | null;
  checkpoints: TaskCheckpoint[];
  artifacts: TaskArtifact[];
  approvals: string[];
  status: string;
  session?: RuntimeSessionRef | null;
}

export interface RuntimeRouteRecommendation {
  runtime_id: string;
  operator_type: string;
  preferred_substrate?: string | null;
  rationale: string;
  confidence: number;
  prefers_warm_runtime: boolean;
}

export interface MissionStage {
  id: string;
  title: string;
  goal: string;
  depends_on: string[];
  runtime: RuntimeRouteRecommendation;
}

export interface OperatorMission {
  id: string;
  goal: string;
  summary: string;
  stages: MissionStage[];
}

export interface PlannedMissionStage {
  stage: MissionStage;
  parent_task_id?: string | null;
  handoff_note?: string | null;
  resume_session_id?: string | null;
}

export interface MissionRunResult {
  launched: TaskGraph[];
  blocked: boolean;
  completed: boolean;
  next_stage_id?: string | null;
}

export interface StoredMission {
  mission: OperatorMission;
  status: string;
  last_run_at?: number | null;
  next_stage_id?: string | null;
  auto_run: boolean;
}

export interface CompanyObject {
  id: string;
  kind: string;
  title: string;
  summary: string;
  status: string;
  owner?: string | null;
  linked_mission_id?: string | null;
  created_at: number;
  updated_at: number;
}

export interface SecurityEngagement {
  id: string;
  title: string;
  owner_name: string;
  contact: string;
  scope: string;
  asset_kind: string;
  verification_method: string;
  challenge_token: string;
  proof_instructions: string;
  proof_value?: string | null;
  status: string;
  verified_at?: number | null;
  created_at: number;
  updated_at: number;
}

export interface CapabilityBlueprint {
  id: string;
  title: string;
  category: string;
  summary: string;
  goal_template: string;
  runtime_hint?: string | null;
  install_command?: string | null;
  source_url?: string | null;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  permissions: string[];
  commands: Array<{ name: string; description: string; handler: string }>;
  ui_slots: Array<{ slot: string; component: string }>;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  path: string;
  enabled: boolean;
}

export interface PluginCommandInfo {
  plugin: string;
  name: string;
  description: string;
}

export interface RuntimeMessageEvent {
  taskId: string;
  runtimeId: string;
  sessionId?: string | null;
  type: string;
  role: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStateChangedEvent {
  taskId: string;
  runtimeId: string;
  status: string;
  sessionId?: string | null;
  error?: string | null;
  timestamp: number;
}

export interface TaskCheckpointEvent {
  taskId: string;
  runtimeId: string;
  checkpoint: TaskCheckpoint;
}

export interface TaskDoneEvent {
  taskId: string;
  runtimeId: string;
  status: string;
  sessionId?: string | null;
  summary?: string | null;
  error?: string | null;
  timestamp: number;
}

export interface ServerStatus {
  name: string;
  running: boolean;
}

// ── Agent System ───────────────────────────────────────────────────────────────

export interface AgentStep {
  id: string;
  description: string;
  tool_name: string | null;
  tool_args: unknown | null;
  status: "Pending" | "Running" | "Completed" | "Failed" | "Skipped";
  result: string | null;
  started_at: number | null;
  completed_at: number | null;
}

export interface Agent {
  id: string;
  goal: string;
  status: "Planning" | "Executing" | "WaitingApproval" | "Paused" | "Completed" | "Failed";
  steps: AgentStep[];
  current_step: number;
  context?: Record<string, string>;
  created_at: number;
  updated_at: number;
  error: string | null;
}

export interface DiscoveryReport {
  user_identity: {
    name: string | null;
    email: string | null;
    github_username: string | null;
  } | null;
  ai_tools: { name: string; config_path: string; details: Record<string, string> }[];
  projects: { name: string; path: string; stack: string[]; description: string | null }[];
  dev_environment: {
    languages: string[];
    package_managers: string[];
    editors: string[];
    shell: string | null;
  };
  installed_tools: string[];
  claude_memories: string[];
}

// ── Brain (Character Bible) ────────────────────────────────────────────────────

export interface BrainPreference {
  id: string;
  text: string;
  confidence: number;
  source: "feedback" | "manual";
  updated_at: number;
}

export interface BrainStyleTag {
  id: string;
  tag: string;
}

export interface BrainNode {
  id: string;
  label: string;
  kind: "person" | "project" | "tool" | "concept" | "company" | "url";
  summary: string;
  mention_count: number;
  last_seen_at: number;
}

export interface BrainEdge {
  id: string;
  from_id: string;
  to_id: string;
  label: string;
  weight: number;
}

export interface BrainSkill {
  id: string;
  name: string;
  trigger_pattern: string;
  prompt_modifier: string;
  tools_json: string;
  usage_count: number;
  active: boolean;
  created_at: number;
}

export interface BrainMemory {
  id: string;
  text: string;
  source_conversation_id: string;
  entities_json: string;
  confidence: number;
  created_at: number;
  expires_at?: number | null;
}

export interface BrainReaction {
  id: string;
  message_id: string;
  polarity: number; // 1 = thumbs up, -1 = thumbs down
  content: string;
  context_json: string;
  created_at: number;
}

// ── Mission DSL ───────────────────────────────────────────────────────────────

export interface MissionStageSpec {
  id: string;
  title: string;
  goalTemplate: string;
  dependsOn: string[];
  runtimeHint: string;
  loopUntil?: string;
  approvalGate?: boolean;
  injectBrain?: boolean;
  maxIterations?: number;
}

export interface MissionSpec {
  id: string;
  title: string;
  description: string;
  tags: string[];
  builtIn: boolean;
  inputVars: string[];
  stages: MissionStageSpec[];
  createdAt: string;
  lastRunAt?: string;
  schedule?: string;
}

// ── Capability Reports ────────────────────────────────────────────────────────

export type ReportCategory = "capability_gap" | "missing_tool" | "runtime_error" | "failed_mission" | "user_friction";
export type ReportSeverity = "low" | "medium" | "high" | "critical";
export type ReportStatus = "open" | "investigating" | "resolved" | "wont_fix";

export interface CapabilityReport {
  id: string;
  category: ReportCategory;
  title: string;
  description: string;
  user_request: string;
  blade_response: string;
  suggested_fix: string;
  severity: ReportSeverity;
  status: ReportStatus;
  reported_at: number;
  resolved_at?: number | null;
}
