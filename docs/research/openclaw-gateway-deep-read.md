# OpenClaw — Gateway & Agent Loop Deep Read
Source: /tmp/research/openclaw/src/ (TypeScript)
Date: 2026-04-15

---

## Architecture

Entry: `entry.ts` + `index.ts` → `gateway/server.impl.ts`
- Model catalog, session management, auth, plugin systems all boot here

---

## WebSocket Message Flow

File: `gateway/server/ws-connection/message-handler.ts`

1. Client connects with auth, device identity, canvas capability tokens
2. Messages parsed against `validateRequestFrame` schema (protocol version, type, method, id)
3. Routed through `handleGatewayRequest` dispatcher in `gateway/server-methods.ts`
4. Rate limiting per method (3 per 60s for config.apply, config.patch, update.run)
5. Authorization via scope validation and role policies

---

## Chat → LLM Execution Path

File: `gateway/server-chat.ts`

```
Client message → ChatRunRegistry (dedup) → session transcript loaded
  → runEmbeddedPiAgent (run.ts)
  → runEmbeddedAttempt (run/attempt.ts) — 2,600+ lines
  → activeSession.prompt(effectivePrompt, {images})  ← line 2066-2070
  → LLM via streamFn middleware chain
```

### StreamFn Middleware Pipeline (lines 1090-1359):
1. Base stream function: `resolveEmbeddedAgentBaseStreamFn()`
2. Provider stream: `registerProviderStreamForModel()`
3. Text transforms: `wrapStreamFnTextTransforms()`
4. Sanitization: `wrapStreamFnSanitizeMalformedToolCalls()`
5. Tool call trimming: `wrapStreamFnTrimToolCallNames()`
6. Arg repair: `wrapStreamFnRepairMalformedToolCallArguments()` (Anthropic)
7. XAI decode: `wrapStreamFnDecodeXaiToolCallArguments()`
8. Anthropic logging: `anthropicPayloadLogger.wrapStreamFn()`
9. Stop reason recovery: `wrapStreamFnHandleSensitiveStopReason()`
10. Idle timeout: `streamWithIdleTimeout()`
11. Google prompt cache: `prepareGooglePromptCacheStreamFn()`

---

## LLM Providers

**Anthropic** (`agents/anthropic-transport-stream.ts`):
- `@anthropic-ai/sdk` Messages API streaming
- Adaptive thinking: `effort` param (low/medium/high/max)
- Cache management via `cache_control` blocks

**OpenAI** (`agents/openai-transport-stream.ts`):
- Dual: completions + responses APIs
- Reasoning effort: low/medium/high
- Cost multiplier: flex=0.5x, priority=2x, default=1x

---

## Session & Context

```typescript
// Rolling session state
ACTIVE_EMBEDDED_RUNS: Map<sessionId, EmbeddedPiQueueHandle>
Handle: { queueMessage, isStreaming, isCompacting, cancel, abort }

// Auto-compaction triggers:
- Token ratio > 0.65 prompt tokens → compaction before retry
- Up to 3 compaction attempts with tool result truncation fallback
```

---

## Error Handling & Failover

`FailoverError` types: model_not_found, rate_limit, overloaded, auth_*
- Auth profile rotation: profiles tried in order before switching models
- Rate limit backoff: `overloadFailoverBackoffMs` before rotation
- Token overflow: detect and compact, up to 3 attempts

---

## Real-Time Event Emission

```typescript
onPartialReply(text)          // streaming chunks
onAssistantMessageStart()     // new turn
onBlockReply(text)            // coalesced
onBlockReplyFlush()           // flushed to client
onReasoningStream(text)       // thinking (Claude 3.5+)
onReasoningEnd(usage)         // thinking done
onToolResult(result)          // tool execution result
onAgentEvent(event)           // lifecycle events
```

---

## Media Understanding

File: `media-understanding/audio-transcription-runner.ts`

```typescript
runAudioTranscription({ctx, cfg, attachments, providers})
  → capability-based: runCapability("audio", ...)
  → cache cleanup on completion
```

Media store: 5MB max, 2-minute TTL, `{original}---{uuid}.{ext}`

---

## Tool Execution

File: `gateway/tools-invoke-http.ts`

```
HTTP /tools/invoke →
  runBeforeToolCallHook() → gate
  resolveGatewayScopedTools() → filter by owner/scope
  ToolInputError (400) | ToolAuthorizationError (403) | runtime (500)
```

---

## Key Integration Patterns for BLADE

1. **Session-anchored**: session file = persistent message store, context engine manages tokens
2. **Subscription pattern**: real-time events via `onPartialReply`, `onToolResult`, etc.
3. **Failover logic**: classify errors → rotate auth profiles → switch models
4. **StreamFn wrapping**: middleware chain around SDK streams for sanitization + recovery
5. **Tool before-call hooks**: gate execution before any tool runs
6. **Auto-compaction**: token budget enforcement with ratio detection

---

## Animation System (from macOS client — TalkOverlayView.swift)

Already documented in `openclaw-deep-read.md`. Key values:
- Orb scale listening: `1 + (level * 0.12)` — breathes with voice
- Orb scale speaking: `1 + 0.06 * sin(t * 6)` — 6Hz sine pulse
- 3 expanding rings staggered by `0.28` cycle offset
- Thinking: two counter-rotating arcs (+42°/s, -35°/s)
- Audio RMS → dB: `(db + 50) / 50` clamped 0..1
- Smoothing: `0.45 * prev + 0.55 * new`
- UI throttled to 12fps (83ms)
