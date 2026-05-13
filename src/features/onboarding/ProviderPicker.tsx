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
// v1.5.1 — when a paste already includes an api_key, skip the apikey step
// and route directly to scan. (Bug Arnav reported: pasted curl was being
// detected but onboarding still asked for a key.)
import { storeProviderKey, switchProvider } from '@/lib/tauri';
import { useToast } from '@/lib/context';

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
  const { show } = useToast();

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
        onSuccess={async (parsed) => {
          const knownProvider =
            parsed.provider_guess !== 'custom' &&
            KNOWN_PROVIDER_IDS.has(parsed.provider_guess as ProviderId);

          if (knownProvider && parsed.model) {
            setProvider(parsed.provider_guess as ProviderId, parsed.model);
          }

          // v1.5.1 — if the paste already extracted a real api_key (from a
          // curl Authorization header or python OpenAI() call), persist it
          // now and skip the apikey step. Hitting Continue should NOT ask
          // the user for a key they already pasted.
          if (knownProvider && parsed.model && parsed.api_key) {
            try {
              await storeProviderKey(parsed.provider_guess as ProviderId, parsed.api_key);
              await switchProvider(parsed.provider_guess as ProviderId, parsed.model);
              show({ type: 'success', title: 'Provider set', message: `${parsed.provider_guess} · ${parsed.model}` });
              setStep('persona');
              return;
            } catch (e) {
              show({
                type: 'error',
                title: 'Could not save provider',
                message: e instanceof Error ? e.message : String(e),
              });
              // fall through to apikey step so the user can re-enter manually
            }
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
