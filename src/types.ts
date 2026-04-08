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

export interface ServerStatus {
  name: string;
  running: boolean;
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
