// src/features/onboarding/providers.ts — 6-provider registry for the onboarding picker.
//
// Anthropic is index 0 = default-selected per docs/design/onboarding-01-provider.html.
// The `ProviderId` literal union is sourced from src/types/provider.ts so both the
// Rust wrappers (getAllProviderKeys, storeProviderKey, switchProvider) and the UI
// picker share the same identifier type.
//
// Adding a new provider requires editing BOTH this array AND src/types/provider.ts
// (ProviderId union) AND the Rust list at src-tauri/src/config.rs:606. There is no
// codegen; drift is caught in PR review + the Plan 02-01 truth check.
//
// @see .planning/phases/02-onboarding-shell/02-PATTERNS.md §11
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-47
// @see docs/design/onboarding-01-provider.html (provider identity gradients + taglines)

import type { ProviderId } from '@/types/provider';

export interface ProviderDef {
  id: ProviderId;
  name: string;
  /** Default model id to preselect when this provider is chosen. User can
   *  override in the API Key Entry step's model dropdown (Plan 02-04). */
  defaultModel: string;
  /** One-line pitch shown under the provider name in the picker card. */
  tagline: string;
  /** External URL the "Get key" link opens in the API Key Entry step. Empty
   *  string for providers that don't require a key (Ollama). */
  keyUrl: string;
  /** False for local / keyless providers (Ollama). Controls whether Step 2
   *  renders the API key input and "Test connection" gate. */
  needsKey: boolean;
  /** 2-stop CSS gradient for the provider logo chip (from/to hex colours). */
  gradient: [string, string];
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    tagline: 'Claude, strong reasoning',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    needsKey: true,
    gradient: ['#c96442', '#f0a97e'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    tagline: 'GPT-4o mini, reliable',
    keyUrl: 'https://platform.openai.com/api-keys',
    needsKey: true,
    gradient: ['#0f8a60', '#10b27a'],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    tagline: 'One key, 200+ models',
    keyUrl: 'https://openrouter.ai/settings/keys',
    needsKey: true,
    gradient: ['#5b5fe8', '#8b6fff'],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    tagline: 'Free tier, fast',
    keyUrl: 'https://aistudio.google.com/apikey',
    needsKey: true,
    gradient: ['#4285f4', '#34a0f5'],
  },
  {
    id: 'groq',
    name: 'Groq',
    defaultModel: 'llama-3.3-70b-versatile',
    tagline: 'Free tier, fastest',
    keyUrl: 'https://console.groq.com/keys',
    needsKey: true,
    gradient: ['#f55036', '#ff7a50'],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    defaultModel: 'llama3.2',
    tagline: 'Local, offline',
    keyUrl: '',
    needsKey: false,
    gradient: ['#2c2c2c', '#555555'],
  },
];

/** Default-selected provider on first boot of the onboarding picker. */
export const DEFAULT_PROVIDER: ProviderDef = PROVIDERS[0];
