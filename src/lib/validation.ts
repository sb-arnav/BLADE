/**
 * Validation library for Blade using Zod.
 * Schemas for all major data types in the app.
 */

import { z } from "zod";

// ── Message & Conversation ─────────────────────────────────────────────

export const MessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  image_base64: z.string().optional(),
  timestamp: z.number(),
});

export const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(200),
  created_at: z.number(),
  updated_at: z.number(),
  message_count: z.number().int().min(0),
  pinned: z.boolean(),
});

// ── Config ──────────────────────────────────────────────────────────────

export const BladeConfigSchema = z.object({
  provider: z.enum(["gemini", "groq", "openai", "anthropic", "ollama"]),
  api_key: z.string(),
  model: z.string().min(1),
  onboarded: z.boolean(),
  mcp_servers: z.array(z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    args: z.array(z.string()),
    env: z.record(z.string()).optional(),
  })),
});

// ── Knowledge ───────────────────────────────────────────────────────────

export const KnowledgeEntrySchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(500),
  content: z.string().min(1),
  tags: z.array(z.string()),
  source: z.enum(["auto", "manual", "pinned"]),
  conversation_id: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});

// ── Template ────────────────────────────────────────────────────────────

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  variables: z.array(z.string()),
  category: z.string(),
  icon: z.string().max(4),
  created_at: z.number(),
  updated_at: z.number(),
  usage_count: z.number().int().min(0),
  is_builtin: z.boolean(),
});

// ── Workflow ─────────────────────────────────────────────────────────────

export const WorkflowStepSchema = z.object({
  id: z.string(),
  type: z.enum(["prompt", "condition", "transform", "output", "loop", "mcp_tool"]),
  config: z.record(z.unknown()),
  label: z.string(),
  order: z.number().int(),
});

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  description: z.string(),
  icon: z.string(),
  steps: z.array(WorkflowStepSchema),
  created_at: z.number(),
  updated_at: z.number(),
  run_count: z.number().int().min(0),
  is_builtin: z.boolean(),
});

// ── Agent ────────────────────────────────────────────────────────────────

export const AgentStepSchema = z.object({
  id: z.string(),
  description: z.string(),
  tool_name: z.string().nullable(),
  tool_args: z.unknown().nullable(),
  status: z.enum(["Pending", "Running", "Completed", "Failed", "Skipped"]),
  result: z.string().nullable(),
  started_at: z.number().nullable(),
  completed_at: z.number().nullable(),
});

export const AgentSchema = z.object({
  id: z.string(),
  goal: z.string().min(1),
  status: z.enum(["Planning", "Executing", "WaitingApproval", "Paused", "Completed", "Failed"]),
  steps: z.array(AgentStepSchema),
  current_step: z.number().int().min(0),
  created_at: z.number(),
  updated_at: z.number(),
  error: z.string().nullable(),
});

// ── MCP ─────────────────────────────────────────────────────────────────

export const McpToolSchema = z.object({
  name: z.string(),
  qualified_name: z.string(),
  description: z.string(),
  input_schema: z.unknown(),
  server_name: z.string(),
});

export const ToolApprovalSchema = z.object({
  approval_id: z.string(),
  name: z.string(),
  arguments: z.string(),
  risk: z.enum(["Auto", "Ask", "Blocked"]),
});

// ── Form ────────────────────────────────────────────────────────────────

export const FormFieldSchema = z.object({
  id: z.string(),
  type: z.enum(["text", "textarea", "number", "email", "select", "multiselect", "checkbox", "radio", "date", "rating", "scale", "file"]),
  label: z.string().min(1),
  placeholder: z.string(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
    message: z.string().optional(),
  }).optional(),
  defaultValue: z.string().optional(),
  order: z.number().int(),
  section: z.string().optional(),
});

// ── Finance ─────────────────────────────────────────────────────────────

export const TransactionSchema = z.object({
  id: z.string(),
  type: z.enum(["income", "expense", "subscription", "ai-cost"]),
  amount: z.number().positive(),
  currency: z.string().length(3),
  category: z.string(),
  description: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recurring: z.boolean(),
  recurringPeriod: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  tags: z.array(z.string()),
  createdAt: z.number(),
});

export const InvoiceSchema = z.object({
  id: z.string(),
  number: z.string().min(1),
  client: z.string().min(1),
  items: z.array(z.object({
    description: z.string(),
    quantity: z.number().positive(),
    rate: z.number().min(0),
    amount: z.number().min(0),
  })),
  subtotal: z.number().min(0),
  tax: z.number().min(0),
  total: z.number().min(0),
  status: z.enum(["draft", "sent", "paid", "overdue"]),
  dueDate: z.string(),
  createdAt: z.number(),
  paidAt: z.number().nullable(),
  notes: z.string(),
});

// ── API Playground ──────────────────────────────────────────────────────

export const APIRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().url(),
  headers: z.record(z.string()),
  body: z.string(),
  bodyType: z.enum(["json", "form", "text", "none"]),
  auth: z.object({
    type: z.enum(["none", "bearer", "basic", "api-key"]),
    token: z.string().optional(),
    username: z.string().optional(),
    password: z.string().optional(),
    keyName: z.string().optional(),
    keyValue: z.string().optional(),
    keyLocation: z.enum(["header", "query"]).optional(),
  }),
  queryParams: z.array(z.object({
    key: z.string(),
    value: z.string(),
    enabled: z.boolean(),
  })),
});

// ── Settings ────────────────────────────────────────────────────────────

export const ThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  colors: z.object({
    bg: z.string(),
    surface: z.string(),
    surfaceHover: z.string(),
    border: z.string(),
    borderHover: z.string(),
    accent: z.string(),
    accentHover: z.string(),
    accentMuted: z.string(),
    text: z.string(),
    secondary: z.string(),
    muted: z.string(),
  }),
  isDark: z.boolean(),
});

export const SyncConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["none", "gdrive", "dropbox", "custom"]),
  lastSync: z.number().nullable(),
  syncConversations: z.boolean(),
  syncSettings: z.boolean(),
  syncKnowledge: z.boolean(),
  syncTemplates: z.boolean(),
});

// ── Utility validators ──────────────────────────────────────────────────

export function validateEmail(email: string): boolean {
  return z.string().email().safeParse(email).success;
}

export function validateUrl(url: string): boolean {
  return z.string().url().safeParse(url).success;
}

export function validateJSON(json: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(json);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

export function validateHexColor(color: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(color);
}

export function validateCronExpression(cron: string): boolean {
  const parts = cron.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 7;
}

export function validateSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(version);
}

// ── Safe parsers (return null on failure instead of throwing) ────────────

export function safeParse<T>(schema: z.ZodType<T>, data: unknown): T | null {
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

export function safeParseWithErrors<T>(schema: z.ZodType<T>, data: unknown): {
  data: T | null;
  errors: string[];
} {
  const result = schema.safeParse(data);
  if (result.success) return { data: result.data, errors: [] };
  return {
    data: null,
    errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`),
  };
}
