export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
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
