// src/features/onboarding/ProviderPicker.tsx — Step 1 (ONBD-02).
//
// Renders the 6 providers from PROVIDERS; selection drives useOnboardingState.
// On Continue click, advances the state machine to 'apikey'.
//
// @see docs/design/onboarding-01-provider.html (visual reference)
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-47

import { PROVIDERS, type ProviderDef } from './providers';
import { Button } from '@/design-system/primitives';
import { Steps } from './Steps';
import type { useOnboardingState } from './useOnboardingState';
import type { ProviderId } from '@/types/provider';
// Phase 11 D-56: paste-any-config card rendered beneath the 6 cards.
// The 6 cards themselves remain unchanged — this is an ADD, not a replace.
import { ProviderPasteForm } from '@/features/providers';

type State = ReturnType<typeof useOnboardingState>;

interface Props {
  state: State['state'];
  setProvider: State['setProvider'];
  setStep: State['setStep'];
}

/** Known ProviderId set — narrows the ParsedProviderConfig.provider_guess
 *  union ('custom' | ...) back to the 6 onboarding ProviderId values so
 *  setProvider() accepts the result. */
const KNOWN_PROVIDER_IDS: ReadonlySet<ProviderId> = new Set<ProviderId>([
  'anthropic',
  'openai',
  'openrouter',
  'gemini',
  'groq',
  'ollama',
]);

export function ProviderPicker({ state, setProvider, setStep }: Props) {
  const selected = PROVIDERS.find((p) => p.id === state.providerId) ?? PROVIDERS[0];

  return (
    <section className="onb glass glass-1" aria-labelledby="onb-provider-title">
      <Steps current="provider" />
      <div className="brand" aria-hidden="true">
        <div className="brand-mark">B</div>
        <div className="brand-text">
          <div className="name">BLADE</div>
          <div className="tag">Skin rebuild · v1</div>
        </div>
      </div>
      <h1 id="onb-provider-title" className="title">
        Pick a provider.
      </h1>
      <p className="subtitle">
        Choose who powers BLADE's chat. You can switch anytime from Settings.
      </p>

      <div className="providers" role="radiogroup" aria-label="AI providers">
        {PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            selected={p.id === selected.id}
            onSelect={() => setProvider(p.id, p.defaultModel)}
          />
        ))}
      </div>

      {/* Phase 11 D-56 — divider + paste card below the 6-card grid. The 6
          cards above must remain the primary affordance; paste is the
          "or" alternative for custom endpoints (NVIDIA NIM, DeepSeek,
          self-hosted vLLM, OpenRouter w/ specific model). */}
      <div className="onb-divider" aria-hidden="true">
        <span className="t-small">or</span>
      </div>
      <ProviderPasteForm
        onSuccess={(parsed) => {
          // Only advance the onboarding machine if the paste resolved to
          // one of the 6 known ProviderId values. Custom base_url pastes
          // pre-populate the provider via the fallback path below.
          if (
            parsed.provider_guess !== 'custom' &&
            KNOWN_PROVIDER_IDS.has(parsed.provider_guess as ProviderId) &&
            parsed.model
          ) {
            setProvider(parsed.provider_guess as ProviderId, parsed.model);
          }
          setStep('apikey');
        }}
      />

      <div className="onb-footer">
        <Button variant="primary" onClick={() => setStep('apikey')}>
          Continue →
        </Button>
      </div>
    </section>
  );
}

function ProviderCard({
  p,
  selected,
  onSelect,
}: {
  p: ProviderDef;
  selected: boolean;
  onSelect: () => void;
}) {
  const parts = p.defaultModel.split('/');
  const modelSuffix = parts[parts.length - 1] ?? p.defaultModel;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`provider ${selected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span
        className="p-logo"
        style={{ background: `linear-gradient(135deg, ${p.gradient[0]}, ${p.gradient[1]})` }}
        aria-hidden="true"
      >
        {p.name.charAt(0)}
      </span>
      <span className="p-info">
        <span className="p-name">{p.name}</span>
        <span className="p-meta">
          {p.tagline} · {modelSuffix}
        </span>
      </span>
    </button>
  );
}
