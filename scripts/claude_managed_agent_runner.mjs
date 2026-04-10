import { query } from "@anthropic-ai/claude-agent-sdk";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function renderAssistantContent(message) {
  const content = Array.isArray(message?.content) ? message.content : [];
  const text = content
    .filter((item) => item?.type === "text" && typeof item.text === "string")
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || "Claude produced a non-text assistant message.";
}

function toolMetadata(message) {
  if (message.type === "tool_use_summary") {
    return {
      toolName: "AgentTool",
      subtype: message.type,
      sessionId: message.session_id,
    };
  }

  if (message.type === "result") {
    return {
      sessionId: message.session_id,
      costUsd: message.total_cost_usd ?? 0,
      durationMs: message.duration_ms ?? 0,
      subtype: message.subtype,
    };
  }

  if (message.type === "system") {
    return {
      sessionId: message.session_id,
      subtype: message.subtype,
    };
  }

  return {
    sessionId: message.session_id,
    subtype: message.type,
  };
}

async function main() {
  const encoded = process.argv[2];
  if (!encoded) {
    throw new Error("Missing managed agent payload.");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const mcpServers = parseJson(payload.mcpServers, undefined);
  const subagents = parseJson(payload.subagents, undefined);

  const options = {
    cwd: payload.workingDirectory || process.cwd(),
    allowedTools: Array.isArray(payload.tools) ? payload.tools : [],
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    permissionMode:
      payload.permissionMode === "full"
        ? "bypassPermissions"
        : payload.permissionMode || "default",
    maxTurns: Number(payload.maxTurns || 20),
    resume: payload.sessionId || undefined,
    mcpServers,
    agents: subagents,
    executable: "node",
    env: {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: "blade/0.1.0",
    },
    includePartialMessages: false,
    includeHookEvents: false,
    agentProgressSummaries: true,
  };

  for await (const message of query({ prompt: payload.prompt, options })) {
    if (message.type === "assistant") {
      emit({
        type: "message",
        payload: {
          id: message.uuid,
          type: "assistant",
          content: renderAssistantContent(message.message),
          timestamp: Date.now(),
          metadata: toolMetadata(message),
        },
      });
      continue;
    }

    if (message.type === "tool_use_summary") {
      emit({
        type: "message",
        payload: {
          id: message.uuid,
          type: "tool_use",
          content: message.summary,
          timestamp: Date.now(),
          metadata: toolMetadata(message),
        },
      });
      continue;
    }

    if (message.type === "result") {
      const resultText =
        message.subtype === "success"
          ? message.result || "Managed agent completed."
          : (message.errors || []).join("\n") || "Managed agent failed.";
      emit({
        type: "message",
        payload: {
          id: message.uuid,
          type: message.subtype === "success" ? "result" : "error",
          content: resultText,
          timestamp: Date.now(),
          metadata: toolMetadata(message),
        },
      });
      emit({
        type: "done",
        payload: {
          sessionId: message.session_id,
          costUsd: message.total_cost_usd ?? 0,
          isError: message.is_error ?? false,
        },
      });
      continue;
    }

    if (message.type === "system") {
      emit({
        type: "message",
        payload: {
          id: message.uuid,
          type: "system",
          content:
            message.subtype === "init"
              ? `Claude agent ready in ${message.cwd}`
              : `Claude system event: ${message.subtype}`,
          timestamp: Date.now(),
          metadata: toolMetadata(message),
        },
      });
      continue;
    }

    if (message.type === "auth_status") {
      emit({
        type: "message",
        payload: {
          id: message.uuid,
          type: message.error ? "error" : "system",
          content: message.error || message.output?.join("\n") || "Claude auth status updated.",
          timestamp: Date.now(),
          metadata: toolMetadata(message),
        },
      });
    }
  }
}

main().catch((error) => {
  emit({
    type: "error",
    payload: {
      message: error instanceof Error ? error.message : String(error),
    },
  });
  process.exit(1);
});
