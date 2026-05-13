// src/lib/tauri/onboarding.ts
//
// Phase 46 — agentic hunt onboarding Tauri wrappers.
//
// Two commands wire Hunt.tsx to src-tauri/src/onboarding/hunt.rs:
//   - startHunt → start_hunt_cmd. Runs pre-scan, emits Message #1 via
//     BLADE_HUNT_LINE, then spawns the LLM hunt loop on a background task.
//     Returns the InitialContext synchronously so Hunt.tsx can render
//     machine details immediately.
//   - cancelHunt → cancel_hunt. Idempotent. Flips a static atomic so the
//     next tool-call iteration of the hunt loop breaks out.
//
// @see src-tauri/src/onboarding/hunt.rs

import { invokeTyped } from './_base';

export interface HuntInitialContext {
  agents: {
    claude: string | null;
    cursor: string | null;
    ollama: string | null;
    gh: string | null;
    aider: string | null;
    codex: string | null;
    goose: string | null;
  };
  env_keys: {
    anthropic: boolean;
    openai: boolean;
    groq: boolean;
    gemini: boolean;
    xai: boolean;
    openrouter: boolean;
  };
  keyring_keys: {
    anthropic: boolean;
    openai: boolean;
    groq: boolean;
    gemini: boolean;
    xai: boolean;
    openrouter: boolean;
  };
  ollama_running: boolean;
  os: string;
  arch: string;
  default_browser: string;
  mic_permission: string;
  elapsed_ms: number;
}

/** @see src-tauri/src/onboarding/hunt.rs `start_hunt_cmd` */
export function startHunt(): Promise<HuntInitialContext> {
  return invokeTyped<HuntInitialContext>('start_hunt_cmd');
}

/** @see src-tauri/src/onboarding/hunt.rs `cancel_hunt` */
export function cancelHunt(): Promise<void> {
  return invokeTyped<void>('cancel_hunt');
}

/**
 * Phase 49 (HUNT-05-ADV) — post the user's answer to a `hunt_question`
 * chat-line. Wakes the parked hunt task so it can re-prompt the LLM with the
 * answer as seed input.
 *
 * @see src-tauri/src/onboarding/hunt.rs `hunt_post_user_answer`
 */
export function huntPostUserAnswer(answer: string): Promise<void> {
  return invokeTyped<void, { answer: string }>('hunt_post_user_answer', { answer });
}

/**
 * Phase 49 (HUNT-COST-CHAT) — acknowledge the cost block and grant another
 * budget bucket so the hunt loop can continue.
 *
 * @see src-tauri/src/onboarding/hunt.rs `hunt_continue_after_cost_block`
 */
export function huntContinueAfterCostBlock(): Promise<void> {
  return invokeTyped<void>('hunt_continue_after_cost_block');
}

/**
 * Phase 49 (HUNT-COST-CHAT) — symmetric to `huntContinueAfterCostBlock` for
 * the tool_forge cost-tracked session.
 *
 * @see src-tauri/src/tool_forge.rs `forge_continue_after_cost_block`
 */
export function forgeContinueAfterCostBlock(): Promise<void> {
  return invokeTyped<void>('forge_continue_after_cost_block');
}
