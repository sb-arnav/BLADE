// src/features/providers/CapabilityGap.tsx — Phase 11 Plan 11-05 (D-54).
//
// Empty-state surface for views that require a capability the user's
// currently-configured providers don't have. Composition:
//   • <EmptyState> — headline, body, "Add a provider" CTA → openAddFlow()
//   • Secondary link — "Learn which models support X" → openUrl() (OS browser)
//
// Copy is LOCKED verbatim to UI-SPEC §Copywriting Contract §CapabilityGap copy.
// The 8 Playwright specs (tests/e2e/capability-gap-*.spec.ts) assert each
// headline string appears in the rendered surface. Touching these strings
// without updating UI-SPEC AND the specs breaks the gate.
//
// testId shape: `capability-gap-{capability}` — consumers don't need to pass
// a testId override; the Playwright locator depends on this convention.
//
// @see src/features/providers/useCapability.ts
// @see src/design-system/primitives/EmptyState.tsx
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md §Surface C
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md §Copywriting Contract

import { EmptyState } from '@/design-system/primitives';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useCapability } from './useCapability';
import type { Capability } from './CAPABILITY_SURFACES';

interface CapabilityCopy {
  headline: string;
  body: string;
  cta: string;
  linkText: string;
  linkHref: string;
}

const COPY: Record<Capability, CapabilityCopy> = {
  vision: {
    headline: 'Needs a vision-capable model',
    body: "This view analyzes what's on screen. Add a provider like Anthropic, OpenAI, or Gemini that can read images.",
    cta: 'Add a provider',
    linkText: 'Learn which models support vision ↗',
    linkHref: 'https://docs.blade.ai/providers/vision',
  },
  audio: {
    headline: 'Needs an audio-capable model',
    body: 'This view transcribes or generates speech. Add a provider that supports audio (OpenAI gpt-4o-audio, ElevenLabs, Cartesia).',
    cta: 'Add a provider',
    linkText: 'Learn which models support audio ↗',
    linkHref: 'https://docs.blade.ai/providers/audio',
  },
  long_context: {
    headline: 'Needs a long-context model',
    body: "This input is too long for the current provider's context window. Add a provider with 100k+ context (Claude, Gemini 1.5, GPT-4-turbo).",
    cta: 'Add a provider',
    linkText: 'Learn which models support long context ↗',
    linkHref: 'https://docs.blade.ai/providers/long-context',
  },
  tools: {
    headline: 'Needs a tool-calling model',
    body: 'This feature uses tools to take actions. Add a provider that supports function calling (Claude, GPT-4, Gemini, most Llama 3.3+).',
    cta: 'Add a provider',
    linkText: 'Learn which models support tools ↗',
    linkHref: 'https://docs.blade.ai/providers/tools',
  },
};

export interface CapabilityGapProps {
  /** Which capability is missing. Drives headline + body + link target. */
  capability: Capability;
  /** Optional eyebrow (surface context like "Screen Timeline"). */
  surfaceLabel?: string;
}

/** Empty-state card shown in surfaces that require a currently-missing capability. */
export function CapabilityGap({ capability, surfaceLabel }: CapabilityGapProps) {
  const { openAddFlow } = useCapability(capability);
  const copy = COPY[capability];
  return (
    <div data-testid={`capability-gap-${capability}`}>
      {surfaceLabel && (
        <div
          className="t-small"
          style={{
            color: 'var(--t-3)',
            marginBottom: 'var(--s-2)',
            textAlign: 'center',
          }}
        >
          {surfaceLabel}
        </div>
      )}
      <EmptyState
        label={copy.headline}
        description={copy.body}
        actionLabel={copy.cta}
        onAction={openAddFlow}
        testId={`capability-gap-empty-${capability}`}
      />
      <div style={{ marginTop: 'var(--s-3)', textAlign: 'center' }}>
        <a
          href={copy.linkHref}
          onClick={(e) => {
            e.preventDefault();
            openUrl(copy.linkHref).catch(() => {
              /* opener plugin failure is non-fatal; swallow */
            });
          }}
          className="settings-link"
          data-testid={`capability-gap-link-${capability}`}
        >
          {copy.linkText}
        </a>
      </div>
    </div>
  );
}
