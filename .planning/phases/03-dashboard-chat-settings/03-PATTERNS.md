# Phase 3 Patterns — Recurring Recipes

**Mapped:** 2026-04-18
**Scope:** Code recipes Phase 3 implementers MUST follow verbatim (or cite a deviation in their commit message).

---

## 1. Rust WIRE emit recipe (commands.rs)

WIRE-03 / WIRE-06 emits land inside `send_message_stream` (`commands.rs:559+`).

```rust
// Near top of send_message_stream, after the rough_tokens block (~line 618-637):
let context_window: usize = match (config.provider.as_str(), config.model.as_str()) {
    ("anthropic", _) => 200_000,
    ("openai", _)    => 128_000,
    ("gemini", _)    => 1_000_000,
    ("groq", _)      => 131_072,
    ("ollama", _)    => 8_192,
    _                => 32_768,
};
let ratio = (rough_tokens as f64 / context_window as f64).min(1.0);
let _ = app.emit_to("main", "blade_token_ratio", serde_json::json!({
    "ratio": ratio,
    "tokens_used": rough_tokens,
    "context_window": context_window,
}));

// At the start of every assistant turn, emit a message_start:
let message_id = uuid::Uuid::new_v4().to_string();
let _ = app.emit_to("main", "blade_message_start", serde_json::json!({
    "message_id": &message_id,
    "role": "assistant",
}));
// (message_id is captured into a local variable so subsequent thinking_chunk emits tag the same id)
```

For WIRE-01 (`quickask_submit`):
```rust
#[tauri::command]
pub async fn quickask_submit(
    app: tauri::AppHandle,
    query: String,
    mode: String,        // "text" | "voice"
    source_window: String, // typically "quickask"
) -> Result<(), String> {
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().timestamp_millis();
    log::info!("[quickask] submit from {} mode={} query_len={}", source_window, mode, query.len());

    // Phase 3 stub: emit the bridge event with empty response.
    // Phase 4 will add the provider call + history persistence here.
    let _ = app.emit_to("main", "blade_quickask_bridged", serde_json::json!({
        "query": query,
        "response": "",
        "conversation_id": conversation_id,
        "mode": mode,
        "timestamp": timestamp,
    }));
    Ok(())
}
```

Register in `lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    commands::send_message_stream,
    commands::cancel_chat,
    commands::quickask_submit,   // WIRE-01 stub — Phase 3
    // ... existing entries ...
])
```

For WIRE-02 (homeostasis.rs:424):
```rust
// EXISTING (keep — legacy listeners on HUD + body still subscribe):
let _ = app.emit("homeostasis_update", serde_json::json!({ /* ...10 fields... */ }));
// ADDED — parallel emit under the new canonical name:
let _ = app.emit("hormone_update", serde_json::json!({ /* same 10 fields */ }));
```

For WIRE-04 (providers/anthropic.rs:344):
```rust
// EXISTING (keep — legacy):
let _ = app.emit_to("main", "chat_thinking", chunk.clone());
// ADDED — new tagged emit consumed by chat thinking section:
let _ = app.emit_to("main", "blade_thinking_chunk", serde_json::json!({
    "chunk": chunk,
    "message_id": current_message_id, // threaded from send_message_stream
}));
```

For WIRE-05 (agents/executor.rs): VERIFICATION ONLY. Each existing `blade_agent_event` emit must use `app.emit_to("main", "blade_agent_event", ...)` per Phase 1 D-14. Plan 03-01 Task 4 greps `agents/executor.rs` for `app.emit\(.*blade_agent_event` (without `_to`) and fails if any match.

---

## 2. Wrapper recipe — same as Phase 2 §1

Every new wrapper in `src/lib/tauri/*.ts`:
```ts
/** @see src-tauri/src/<module>.rs:<line> `<rust signature verbatim>` */
export function fnName(args): Promise<TReturn> {
  return invokeTyped<TReturn, { snake_case_keys }>('rust_command_name', { ... });
}
```

Phase 3 new wrapper modules:
- `src/lib/tauri/perception.ts` — `perceptionGetLatest`, `perceptionUpdate`
- `src/lib/tauri/homeostasis.ts` — `homeostasisGet`, `homeostasisGetDirective`, `homeostasisGetCircadian`
- `src/lib/tauri/iot.ts` — Home Assistant + Spotify wrappers (read iot_bridge.rs and lib.rs:448-708 for exact registered names)
- Extends `src/lib/tauri/chat.ts` — `respondToolApproval`, `historyListConversations`, `historyLoadConversation`, `historyDeleteConversation`, `quickaskSubmit`
- Extends `src/lib/tauri/config.ts` — `getTaskRouting`, `setTaskRouting`, `saveConfigField`, `resetOnboarding`, `debugConfig`

Snippets:
```ts
/** @see src-tauri/src/perception_fusion.rs:607 `pub fn perception_get_latest() -> Option<PerceptionState>` */
export function perceptionGetLatest(): Promise<PerceptionState | null> {
  return invokeTyped<PerceptionState | null>('perception_get_latest');
}

/** @see src-tauri/src/commands.rs:2171 `pub async fn respond_tool_approval(approvals, approval_id: String, approved: bool) -> Result<(), String>` */
export function respondToolApproval(args: { approvalId: string; approved: boolean }): Promise<void> {
  return invokeTyped<void, { approval_id: string; approved: boolean }>(
    'respond_tool_approval',
    { approval_id: args.approvalId, approved: args.approved },
  );
}

/** @see src-tauri/src/commands.rs:1934 `pub fn reset_onboarding() -> Result<(), String>` */
export function resetOnboarding(): Promise<void> {
  return invokeTyped<void>('reset_onboarding');
}

/** @see src-tauri/src/config.rs:713 `pub fn get_task_routing() -> TaskRouting` */
export function getTaskRouting(): Promise<TaskRouting> {
  return invokeTyped<TaskRouting>('get_task_routing');
}
```

DTO type for PerceptionState lives at `src/types/perception.ts` (NEW). HormoneState at `src/types/hormones.ts` (NEW). TaskRouting at `src/types/routing.ts` (NEW). All shapes mirror their Rust struct verbatim (snake_case fields).

---

## 3. `useChat` Context skeleton (D-67)

```tsx
// src/features/chat/useChat.tsx
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type {
  ChatTokenPayload, ChatRoutingPayload, BladeMessageStartPayload,
  BladeThinkingChunkPayload, BladeTokenRatioPayload, ToolApprovalNeededPayload,
} from '@/lib/events';
import { sendMessageStream, cancelChat, respondToolApproval } from '@/lib/tauri';
import type { ChatMessage } from '@/types/messages';

export interface ChatStreamMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  createdAt: number;
}

interface ChatStateValue {
  messages: ChatStreamMessage[];
  status: 'idle' | 'streaming' | 'thinking' | 'awaiting_tool' | 'error';
  streamingContent: string;       // committed from buffer each frame
  thinkingContent: string;        // committed from buffer each frame
  currentMessageId: string | null;
  toolApprovalRequest: ToolApprovalNeededPayload | null;
  tokenRatio: { ratio: number; used: number; window: number } | null;
  routing: ChatRoutingPayload | null;
  send: (text: string) => Promise<void>;
  cancel: () => Promise<void>;
  approveTool: (approvalId: string) => Promise<void>;
  denyTool: (approvalId: string) => Promise<void>;
}

const Ctx = createContext<ChatStateValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ChatStreamMessage[]>([]);
  const [status, setStatus] = useState<ChatStateValue['status']>('idle');
  const [streamingContent, setStreamingContent] = useState('');
  const [thinkingContent, setThinkingContent] = useState('');
  const [currentMessageId, setCurrentMessageId] = useState<string | null>(null);
  const [toolApprovalRequest, setToolApprovalRequest] = useState<ToolApprovalNeededPayload | null>(null);
  const [tokenRatio, setTokenRatio] = useState<ChatStateValue['tokenRatio']>(null);
  const [routing, setRouting] = useState<ChatRoutingPayload | null>(null);

  // ── rAF-flushed buffers (D-68) ─────────────────────────────────────────────
  const tokenBufRef = useRef('');
  const thinkBufRef = useRef('');
  const rafScheduledRef = useRef(false);

  const scheduleFlush = useCallback(() => {
    if (rafScheduledRef.current) return;
    rafScheduledRef.current = true;
    requestAnimationFrame(() => {
      rafScheduledRef.current = false;
      if (tokenBufRef.current) {
        const chunk = tokenBufRef.current;
        tokenBufRef.current = '';
        setStreamingContent((s) => s + chunk);
      }
      if (thinkBufRef.current) {
        const chunk = thinkBufRef.current;
        thinkBufRef.current = '';
        setThinkingContent((s) => s + chunk);
      }
    });
  }, []);

  // ── Event subscriptions ────────────────────────────────────────────────────
  useTauriEvent<BladeMessageStartPayload>(BLADE_EVENTS.BLADE_MESSAGE_START, (e) => {
    setCurrentMessageId(e.payload.message_id);
    setStreamingContent('');
    setThinkingContent('');
    setStatus('streaming');
  });

  useTauriEvent<ChatTokenPayload>(BLADE_EVENTS.CHAT_TOKEN, (e) => {
    tokenBufRef.current += e.payload;
    scheduleFlush();
  });

  useTauriEvent<BladeThinkingChunkPayload>(BLADE_EVENTS.BLADE_THINKING_CHUNK, (e) => {
    thinkBufRef.current += e.payload.chunk;
    scheduleFlush();
    setStatus('thinking');
  });

  useTauriEvent<null>(BLADE_EVENTS.CHAT_DONE, () => {
    // Flush remaining buffers synchronously
    const finalContent = streamingContent + tokenBufRef.current;
    const finalThinking = thinkingContent + thinkBufRef.current;
    tokenBufRef.current = '';
    thinkBufRef.current = '';

    if (currentMessageId) {
      setMessages((prev) => [
        ...prev,
        { id: currentMessageId, role: 'assistant', content: finalContent, thinking: finalThinking || undefined, createdAt: Date.now() },
      ]);
    }
    setStreamingContent('');
    setThinkingContent('');
    setCurrentMessageId(null);
    setStatus('idle');
  });

  useTauriEvent<BladeTokenRatioPayload>(BLADE_EVENTS.BLADE_TOKEN_RATIO, (e) => {
    setTokenRatio({ ratio: e.payload.ratio, used: e.payload.tokens_used, window: e.payload.context_window });
  });

  useTauriEvent<ChatRoutingPayload>(BLADE_EVENTS.CHAT_ROUTING, (e) => {
    setRouting(e.payload);
  });

  useTauriEvent<ToolApprovalNeededPayload>(BLADE_EVENTS.TOOL_APPROVAL_NEEDED, (e) => {
    setToolApprovalRequest(e.payload);
    setStatus('awaiting_tool');
  });

  // ── API ──────────────────────────────────────────────────────────────────
  const send = useCallback(async (text: string) => {
    const userMsg: ChatStreamMessage = { id: crypto.randomUUID(), role: 'user', content: text, createdAt: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setStatus('streaming');
    const wireMsgs: ChatMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.content,
      image_base64: null,
    }));
    try {
      await sendMessageStream(wireMsgs);
    } catch (e) {
      setStatus('error');
      console.error('[chat] send failed', e);
    }
  }, [messages]);

  const cancel = useCallback(async () => {
    await cancelChat();
    setStatus('idle');
  }, []);

  const approveTool = useCallback(async (approvalId: string) => {
    await respondToolApproval({ approvalId, approved: true });
    setToolApprovalRequest(null);
  }, []);
  const denyTool = useCallback(async (approvalId: string) => {
    await respondToolApproval({ approvalId, approved: false });
    setToolApprovalRequest(null);
  }, []);

  return (
    <Ctx.Provider
      value={{
        messages, status, streamingContent, thinkingContent, currentMessageId,
        toolApprovalRequest, tokenRatio, routing,
        send, cancel, approveTool, denyTool,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useChatCtx() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChatCtx must be inside <ChatProvider>');
  return v;
}
```

Mounted only inside the chat route (not MainShell) so unmount is clean on navigate-away.

---

## 4. Tool approval Dialog (D-71) — 500ms countdown ring

```tsx
// src/features/chat/ToolApprovalDialog.tsx
import { useEffect, useState } from 'react';
import { Dialog, Button } from '@/design-system/primitives';
import { useChatCtx } from './useChat';

export function ToolApprovalDialog() {
  const { toolApprovalRequest: req, approveTool, denyTool } = useChatCtx();
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!req) { setUnlocked(false); return; }
    const t = setTimeout(() => setUnlocked(true), 500);
    return () => clearTimeout(t);
  }, [req?.request_id]);

  if (!req) return null;
  return (
    <Dialog open onClose={() => denyTool(req.request_id)} ariaLabel="Tool approval request">
      <h3>Approve tool: {req.tool_name}</h3>
      <pre className="tool-approval-args">{JSON.stringify(req.args, null, 2)}</pre>
      <p className="tool-approval-context">{req.context}</p>
      <div className="tool-approval-actions">
        <Button
          variant="secondary"
          onClick={() => denyTool(req.request_id)}
          disabled={!unlocked}
          data-countdown={!unlocked ? 'on' : 'off'}
        >Deny</Button>
        <Button
          variant="primary"
          onClick={() => approveTool(req.request_id)}
          disabled={!unlocked}
          data-countdown={!unlocked ? 'on' : 'off'}
        >Approve</Button>
      </div>
    </Dialog>
  );
}
```

CSS in `chat.css`:
```css
.tool-approval-actions [data-countdown="on"] {
  position: relative;
  overflow: hidden;
}
.tool-approval-actions [data-countdown="on"]::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(90deg, rgba(255,255,255,0.16) 100%, transparent 0);
  transform-origin: left;
  animation: countdownFill 500ms linear forwards;
  pointer-events: none;
}
@keyframes countdownFill {
  from { transform: scaleX(1); }
  to   { transform: scaleX(0); }
}
```

---

## 5. Reasoning thinking section (D-72)

```tsx
function MessageBubble({ msg }: { msg: ChatStreamMessage }) {
  return (
    <div className={`chat-bubble chat-bubble-${msg.role}`}>
      {msg.thinking ? (
        <details className="chat-thinking-details">
          <summary>Thinking</summary>
          <div className="chat-thinking">{msg.thinking}</div>
        </details>
      ) : null}
      <div className="chat-content">{msg.content}</div>
    </div>
  );
}
```

While streaming, render a "live" bubble (not in `messages` yet) using `streamingContent` + `thinkingContent` from context:
```tsx
{(currentMessageId && (streamingContent || thinkingContent)) && (
  <div className="chat-bubble chat-bubble-assistant chat-bubble-streaming">
    {thinkingContent ? (
      <details className="chat-thinking-details" open>
        <summary>Thinking</summary>
        <div className="chat-thinking">{thinkingContent}</div>
      </details>
    ) : null}
    <div className="chat-content">{streamingContent}</div>
  </div>
)}
```

---

## 6. Compacting indicator (D-73)

```tsx
function CompactingIndicator() {
  const { tokenRatio, status } = useChatCtx();
  if (!tokenRatio || tokenRatio.ratio <= 0.65 || status === 'idle') return null;
  return (
    <div className="chat-compacting" role="status" aria-live="polite">
      Compacting… {Math.round(tokenRatio.ratio * 100)}%
    </div>
  );
}
```

CSS:
```css
.chat-compacting {
  position: absolute; top: 12px; right: 16px;
  padding: 4px 10px; border-radius: var(--r-pill);
  background: rgba(255, 210, 166, 0.18);
  border: 1px solid rgba(255, 210, 166, 0.32);
  color: rgba(255, 210, 166, 0.95);
  font-size: 12px;
  animation: compactPulse 1.6s ease-in-out infinite;
}
@keyframes compactPulse {
  0%,100% { opacity: 0.85; }
  50%     { opacity: 1.00; }
}
```

---

## 7. PerceptionState consumer (D-74)

```tsx
// src/features/dashboard/RightNowHero.tsx
import { useEffect, useState } from 'react';
import { perceptionGetLatest, perceptionUpdate } from '@/lib/tauri/perception';
import type { PerceptionState } from '@/types/perception';

export function RightNowHero() {
  const [state, setState] = useState<PerceptionState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let latest = await perceptionGetLatest();
      if (!latest) latest = await perceptionUpdate();
      if (!cancelled) {
        setState(latest);
        // P-01 / D-77: dashboard first-paint mark
        try { performance.mark('dashboard-paint'); } catch {}
      }
    })();
    const t = setInterval(async () => {
      const next = await perceptionUpdate();
      if (!cancelled) setState(next);
    }, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (!state) return <div className="hero-loading">Reading the room…</div>;

  return (
    <section className="dash-hero">
      <header className="dash-hero-head">
        <h2>{state.active_app || 'No active app'}</h2>
        <span className={`dash-hero-state state-${state.user_state}`}>{state.user_state}</span>
      </header>
      <p className="dash-hero-title">{state.active_title || '\u00A0'}</p>
      <ul className="dash-hero-chips">
        <li>RAM {state.ram_used_gb.toFixed(1)} GB</li>
        <li>Disk free {state.disk_free_gb.toFixed(1)} GB</li>
        <li>Top: {state.top_cpu_process || '—'}</li>
      </ul>
      {state.visible_errors.length > 0 ? (
        <details className="dash-hero-errors">
          <summary>{state.visible_errors.length} visible errors</summary>
          <ul>{state.visible_errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}
```

`PerceptionState` type at `src/types/perception.ts` mirrors `src-tauri/src/perception_fusion.rs:19-33` verbatim (snake_case fields).

---

## 8. AmbientStrip (D-75) — HORMONE_UPDATE consumer

```tsx
// src/features/dashboard/AmbientStrip.tsx
import { useEffect, useState } from 'react';
import { BLADE_EVENTS, useTauriEvent } from '@/lib/events';
import type { HormoneUpdatePayload } from '@/lib/events';
import { homeostasisGet } from '@/lib/tauri/homeostasis';
import { HormoneChip } from './hormoneChip';

const SHOWN_KEYS: (keyof HormoneUpdatePayload)[] = ['arousal', 'energy_mode', 'exploration', 'urgency', 'trust'];

export function AmbientStrip() {
  const [state, setState] = useState<HormoneUpdatePayload | null>(null);
  useEffect(() => { homeostasisGet().then(setState).catch(() => {}); }, []);
  useTauriEvent<HormoneUpdatePayload>(BLADE_EVENTS.HORMONE_UPDATE, (e) => setState(e.payload));

  if (!state) return <div className="ambient-strip ambient-strip-empty">Reading hormones…</div>;
  const dominant = SHOWN_KEYS.reduce((a, b) => (state[a] >= state[b] ? a : b));

  return (
    <section className="ambient-strip" aria-label="Ambient hormone state">
      <HormoneChip name={String(dominant)} value={state[dominant]} dominant />
      {SHOWN_KEYS.filter((k) => k !== dominant).map((k) => (
        <HormoneChip key={String(k)} name={String(k)} value={state[k]} />
      ))}
    </section>
  );
}
```

---

## 9. SettingsShell tab router (D-79)

```tsx
// src/features/settings/SettingsShell.tsx
import { Suspense, lazy } from 'react';
import { useRouterCtx } from '@/windows/main/useRouter';
import { GlassSpinner } from '@/design-system/primitives';

const PANES = {
  'settings':              lazy(() => import('./panes/ProvidersPane').then(m => ({ default: m.ProvidersPane }))),
  'settings-providers':    lazy(() => import('./panes/ProvidersPane').then(m => ({ default: m.ProvidersPane }))),
  'settings-models':       lazy(() => import('./panes/ModelsPane').then(m => ({ default: m.ModelsPane }))),
  'settings-routing':      lazy(() => import('./panes/RoutingPane').then(m => ({ default: m.RoutingPane }))),
  'settings-voice':        lazy(() => import('./panes/VoicePane').then(m => ({ default: m.VoicePane }))),
  'settings-personality':  lazy(() => import('./panes/PersonalityPane').then(m => ({ default: m.PersonalityPane }))),
  'settings-appearance':   lazy(() => import('./panes/AppearancePane').then(m => ({ default: m.AppearancePane }))),
  'settings-iot':          lazy(() => import('./panes/IoTPane').then(m => ({ default: m.IoTPane }))),
  'settings-privacy':      lazy(() => import('./panes/PrivacyPane').then(m => ({ default: m.PrivacyPane }))),
  'settings-diagnostics':  lazy(() => import('./panes/DiagnosticsEntryPane').then(m => ({ default: m.DiagnosticsEntryPane }))),
  'settings-about':        lazy(() => import('./panes/AboutPane').then(m => ({ default: m.AboutPane }))),
} as const;

const TABS: { id: keyof typeof PANES; label: string }[] = [
  { id: 'settings-providers',   label: 'Providers' },
  { id: 'settings-models',      label: 'Models' },
  { id: 'settings-routing',     label: 'Routing' },
  { id: 'settings-voice',       label: 'Voice' },
  { id: 'settings-personality', label: 'Personality' },
  { id: 'settings-appearance',  label: 'Appearance' },
  { id: 'settings-iot',         label: 'IoT' },
  { id: 'settings-privacy',     label: 'Privacy' },
  { id: 'settings-diagnostics', label: 'Diagnostics' },
  { id: 'settings-about',       label: 'About' },
];

export function SettingsShell() {
  const { routeId, openRoute } = useRouterCtx();
  const activeId = (routeId === 'settings' ? 'settings-providers' : routeId) as keyof typeof PANES;
  const Pane = PANES[activeId] ?? PANES['settings-providers'];

  return (
    <div className="settings-shell">
      <nav className="settings-tabs" aria-label="Settings sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`settings-tab ${activeId === t.id ? 'is-active' : ''}`}
            onClick={() => openRoute(t.id)}
            aria-current={activeId === t.id ? 'page' : undefined}
          >{t.label}</button>
        ))}
      </nav>
      <div className="settings-pane">
        <Suspense fallback={<GlassSpinner size={28} />}>
          <Pane />
        </Suspense>
      </div>
    </div>
  );
}
```

`src/features/settings/index.tsx` exports `routes: RouteDefinition[]` mapping each of the 11 ids (parent `settings` + 10 child) to `SettingsShell` as their `component`.

---

## 10. ProvidersPane skeleton (D-81) — uses onboarding registry

```tsx
// src/features/settings/panes/ProvidersPane.tsx
import { useEffect, useState } from 'react';
import { Button, Card, Input, Pill } from '@/design-system/primitives';
import { PROVIDERS } from '@/features/onboarding/providers';
import { getAllProviderKeys, storeProviderKey, switchProvider, testProvider } from '@/lib/tauri';
import { useToast } from '@/lib/context';
import type { ProviderKeyList } from '@/types/provider';

export function ProvidersPane() {
  const { show } = useToast();
  const [keys, setKeys] = useState<ProviderKeyList | null>(null);
  const [pending, setPending] = useState<Record<string, string>>({});
  const refresh = () => getAllProviderKeys().then(setKeys).catch(() => {});
  useEffect(() => { refresh(); }, []);

  if (!keys) return null;
  return (
    <div className="settings-grid">
      {PROVIDERS.map((p) => {
        const stored = keys.providers.find(x => x.provider === p.id);
        return (
          <Card key={p.id}>
            <h3>{p.name}</h3>
            <p className="provider-tagline">{p.tagline}</p>
            {stored?.has_key ? <Pill>Key stored: {stored.masked}</Pill> : <Pill variant="warn">No key</Pill>}
            <Input
              type="password"
              value={pending[p.id] ?? ''}
              onChange={(v) => setPending(s => ({ ...s, [p.id]: v }))}
              placeholder={p.needsKey ? 'sk-...' : 'No key needed'}
              disabled={!p.needsKey}
            />
            <div className="settings-actions">
              <Button
                variant="secondary"
                disabled={!p.needsKey || !pending[p.id]}
                onClick={async () => {
                  try {
                    const r = await testProvider({ provider: p.id, apiKey: pending[p.id], model: p.defaultModel });
                    show({ type: 'success', title: 'Provider OK', message: r });
                  } catch (e) { show({ type: 'error', title: 'Test failed', message: String(e) }); }
                }}
              >Test</Button>
              <Button
                variant="primary"
                disabled={!p.needsKey || !pending[p.id]}
                onClick={async () => {
                  try {
                    await storeProviderKey(p.id, pending[p.id]);
                    await switchProvider(p.id, p.defaultModel);
                    setPending(s => ({ ...s, [p.id]: '' }));
                    refresh();
                    show({ type: 'success', title: 'Saved', message: `${p.name} key stored.` });
                  } catch (e) { show({ type: 'error', title: 'Save failed', message: String(e) }); }
                }}
              >Save & switch</Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
```

Other panes (Models / Routing / Voice / Personality / Appearance / IoT / Privacy / Diagnostics / About) follow the same shape: top-level `Card`, inputs/toggles bound to local state, "Save" button calls the typed wrapper, toast on success/error.

---

## 11. Streaming-perf Playwright recipe (D-91)

```ts
// tests/e2e/chat-stream.spec.ts
import { test, expect } from '@playwright/test';

test('chat stream commits ≤60× during 50 tok/sec for 1s', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).openRoute?.('chat'));
  // Inject a render counter shim
  await page.evaluate(() => {
    (window as any).__RENDER_COUNT__ = 0;
    const original = (window as any).requestAnimationFrame;
    (window as any).requestAnimationFrame = (cb: any) => original((t: number) => { (window as any).__RENDER_COUNT__++; cb(t); });
  });
  // Dispatch 50 synthetic chat_token events at ~20ms intervals
  for (let i = 0; i < 50; i++) {
    await page.evaluate((tok) => (window as any).__TAURI_EMIT__?.('chat_token', tok), `tok-${i}`);
    await page.waitForTimeout(20);
  }
  const rafCount = await page.evaluate(() => (window as any).__RENDER_COUNT__);
  expect(rafCount).toBeLessThanOrEqual(60);
});
```

Note: `__TAURI_EMIT__` is a test-only hook injected by the Phase 1 harness (Plan 01-09 listener-leak spec uses the same path). If the harness doesn't support synthetic emits, the spec falls back to dispatching a `CustomEvent('blade-test-emit', { detail: { name, payload } })` with a small bridge inside `useTauriEvent` gated on `import.meta.env.DEV`.

---

## 12. Tool approval Playwright recipe

```ts
// tests/e2e/chat-tool-approval.spec.ts
test('tool approval dialog enforces 500ms delay', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).openRoute?.('chat'));
  await page.evaluate(() => (window as any).__TAURI_EMIT__?.('tool_approval_needed', {
    tool_name: 'shell_exec', args: { cmd: 'ls' }, context: 'list current dir', request_id: 'req-1',
  }));
  const approve = page.getByRole('button', { name: /^approve$/i });
  await expect(approve).toBeDisabled();
  await page.waitForTimeout(550);
  await expect(approve).toBeEnabled();
  await approve.click();
  // Verify respond_tool_approval invoked
  const calls = await page.evaluate(() => (window as any).__TAURI_INVOKE_CALLS__ ?? []);
  expect(calls.some((c: any) => c.cmd === 'respond_tool_approval' && c.args?.approval_id === 'req-1' && c.args?.approved === true)).toBe(true);
});
```

---

## 13. Dashboard paint Playwright recipe

```ts
// tests/e2e/dashboard-paint.spec.ts
test('dashboard first paint < 400ms (headless budget)', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).openRoute?.('dashboard'));
  // Wait for the perception fetch + first paint
  await page.waitForFunction(() => performance.getEntriesByName('dashboard-paint').length > 0, null, { timeout: 5000 });
  const ms = await page.evaluate(() => {
    const boot = performance.getEntriesByName('boot')[0];
    const paint = performance.getEntriesByName('dashboard-paint')[0];
    return paint.startTime - boot.startTime;
  });
  expect(ms).toBeLessThan(400); // 200ms metal, 2× headless budget
});
```

---

## 14. Settings-provider Playwright recipe

```ts
// tests/e2e/settings-provider.spec.ts
test('save groq key persists', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => (window as any).openRoute?.('settings-providers'));
  // Mock test_provider + store_provider_key + get_all_provider_keys
  await page.evaluate(() => {
    (window as any).__TAURI_INVOKE_HOOK__ = (cmd: string, _args: any) => {
      if (cmd === 'test_provider') return Promise.resolve('OK');
      if (cmd === 'store_provider_key') return Promise.resolve(undefined);
      if (cmd === 'switch_provider') return Promise.resolve({});
      if (cmd === 'get_all_provider_keys') return Promise.resolve({
        providers: [{ provider: 'groq', has_key: true, masked: 'gsk_***1234', is_active: true }],
        active_provider: 'groq · llama-3.3-70b-versatile',
      });
    };
  });
  const groqCard = page.getByRole('article').filter({ hasText: 'Groq' });
  await groqCard.locator('input').fill('gsk_test_1234');
  await groqCard.getByRole('button', { name: /save/i }).click();
  await expect(groqCard.getByText(/Key stored: gsk_/)).toBeVisible();
});
```

---

*Patterns finalized: 2026-04-18*
