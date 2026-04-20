// src/features/providers/ProviderPasteForm.tsx — Phase 11 Plan 11-03.
//
// Shared paste card consumed verbatim by:
//   1. Onboarding ProviderPicker (D-56 — beneath the 6-card grid)
//   2. Settings ProvidersPane (D-57 — top of the pane)
//
// The component is STATE-MACHINE-driven per UI-SPEC Surface D (6 states):
//   idle         → textarea visible, CTA disabled until input
//   parsing      → spinner + "Detecting provider…"
//   parse-error  → .onb-error panel with error copy
//   probing      → provider badge + spinner + "Probing {provider} capabilities…"
//   probe-success→ provider badge + CapabilityPillStrip + advance CTA
//   probe-error  → .onb-error panel (or .onb-ok for 429) — see Error states table
//
// SECURITY CONTRACT:
//   - Paste textarea content lives only in React local state (never
//     localStorage/sessionStorage) — T-11-13 mitigation.
//   - Error messages render via errMessage() which unwraps TauriError
//     without re-echoing the full paste input — T-11-14 mitigation.
//   - After successful parse+probe, the api_key passes through
//     onSuccess(parsed, record) to the consumer. It's the consumer's
//     responsibility to move the key into the keyring (storeProviderKey).
//
// PROPS CONTRACT (LOCKED):
//   { onSuccess?, defaultValue? }
// No textareaRef prop. Consumers that need to focus the textarea (e.g.
// ProvidersPane for the Plan 11-05 routeHint scroll-focus) MUST wrap this
// component in a ref'd <div> and query-descendant the textarea by its
// aria-label: `Provider config paste input`.
//
// All user-facing copy is locked verbatim to UI-SPEC Copywriting Contract.
// Deviations require re-opening the spec.
//
// @see .planning/phases/11-smart-provider-setup/11-UI-SPEC.md
//      Surface A, Surface D, Copywriting Contract
// @see .planning/phases/11-smart-provider-setup/11-PATTERNS.md §7
// @see src/features/settings/panes/ProvidersPane.tsx:36-39 (errMessage)

import { useState } from 'react';
import {
  Button,
  Card,
  GlassSpinner,
  Pill,
} from '@/design-system/primitives';
import {
  parseProviderPaste,
  probeProviderCapabilities,
  TauriError,
} from '@/lib/tauri';
import type {
  ParsedProviderConfig,
  ProviderCapabilityRecord,
} from '@/types/provider';
import { CapabilityPillStrip } from './CapabilityPillStrip';

import './providers.css';

export interface ProviderPasteFormProps {
  /** Called once parse+probe both succeed. The consumer typically:
   *  (onboarding) advances the onboarding state machine to 'apikey'
   *  (settings)   stores the key in the OS keyring via storeProviderKey
   *               and reloads the config. */
  onSuccess?: (
    parsed: ParsedProviderConfig,
    record: ProviderCapabilityRecord,
  ) => void;
  /** Optional — pre-fill the textarea (useful for deep-links from CapabilityGap). */
  defaultValue?: string;
}

/** Matches the helper in ProvidersPane.tsx:36-39 verbatim (D-81 / D-83). */
function errMessage(e: unknown): string {
  if (e instanceof TauriError) return e.rustMessage || e.message;
  return String(e);
}

type Busy = 'parsing' | 'probing' | null;

/** Three sample snippets shown behind the "See examples" disclosure. */
const SAMPLES: Array<{ label: string; body: string }> = [
  {
    label: 'OpenAI cURL',
    body:
      `curl https://api.openai.com/v1/chat/completions \\\n` +
      `  -H "Authorization: Bearer sk-proj-..." \\\n` +
      `  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'`,
  },
  {
    label: 'JSON config',
    body:
      `{\n  "provider": "anthropic",\n  "base_url": "https://api.anthropic.com/v1",\n  "api_key": "sk-ant-...",\n  "model": "claude-sonnet-4-20250514"\n}`,
  },
  {
    label: 'Python SDK',
    body:
      `from openai import OpenAI\n` +
      `client = OpenAI(api_key="sk-proj-...", base_url="https://api.groq.com/openai/v1")\n` +
      `resp = client.chat.completions.create(model="llama-3.3-70b-versatile", ...)`,
  },
];

export function ProviderPasteForm({
  onSuccess,
  defaultValue,
}: ProviderPasteFormProps) {
  const [input, setInput] = useState<string>(defaultValue ?? '');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  // `okMessage` carries the 429-"key-works-but-rate-limited" success path
  // per UI-SPEC Error states table — rendered in .onb-ok panel.
  const [okMessage, setOkMessage] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedProviderConfig | null>(null);
  const [caps, setCaps] = useState<ProviderCapabilityRecord | null>(null);
  const [examplesOpen, setExamplesOpen] = useState<boolean>(false);

  // Button label derived from state (UI-SPEC Copywriting Contract).
  let buttonLabel: string;
  if (busy === 'parsing') {
    buttonLabel = 'Detecting provider…';
  } else if (busy === 'probing') {
    buttonLabel = 'Probing…';
  } else if (caps) {
    buttonLabel = 'Continue with this provider →';
  } else {
    buttonLabel = 'Detect & probe';
  }

  const handleDetect = async () => {
    // Reset error + probe results (keep `parsed` until overwritten so
    // the parse-success badge stays visible during probe).
    setError(null);
    setOkMessage(null);
    setParsed(null);
    setCaps(null);
    setBusy('parsing');
    try {
      const parsedCfg = await parseProviderPaste(input);
      setParsed(parsedCfg);
      if (!parsedCfg.api_key) {
        setError(
          'We found the provider and model but no API key in your snippet. Paste a full cURL or add the key manually below.',
        );
        setBusy(null);
        return;
      }
      if (!parsedCfg.model) {
        setError(
          'Parsed config missing model name. Paste the full snippet or add model manually.',
        );
        setBusy(null);
        return;
      }
      setBusy('probing');
      const record = await probeProviderCapabilities({
        provider: parsedCfg.provider_guess,
        apiKey: parsedCfg.api_key,
        model: parsedCfg.model,
        baseUrl: parsedCfg.base_url ?? undefined,
      });
      setCaps(record);
      // Rust surfaces RateLimitedButValid as a successful return — treat
      // it as the "key works" soft success per UI-SPEC Error states table.
      if (record.probe_status === 'RateLimitedButValid') {
        setOkMessage(
          'Key works — rate limited during probe. Capabilities inferred from provider defaults.',
        );
      }
      onSuccess?.(parsedCfg, record);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const isButtonDisabled = !input.trim() || busy !== null;

  // Parsed summary — masked key (shows last 4 only).
  const maskedKey = parsed?.api_key
    ? `••••••••${parsed.api_key.slice(-4)}`
    : null;

  return (
    <Card
      tier={1}
      padding="lg"
      className="list-entrance"
      data-testid="provider-paste-form"
    >
      <div className="paste-form">
        <h3 className="t-h3 paste-form__heading">Paste any config</h3>
        <p className="t-body paste-form__subhead" id="paste-helper-text">
          cURL, JSON config, or Python SDK snippet. We&apos;ll detect the provider and
          probe for capabilities.
        </p>

        <textarea
          className="input mono paste-form__textarea"
          rows={6}
          placeholder="Paste a cURL, JSON config, or Python SDK snippet…"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          data-1p-ignore="true"
          aria-label="Provider config paste input"
          aria-describedby="paste-helper-text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy !== null}
        />

        <div className="paste-form__actions">
          <Button
            variant="primary"
            onClick={handleDetect}
            disabled={isButtonDisabled}
            aria-busy={busy !== null}
          >
            {busy !== null ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)' }}>
                <GlassSpinner size={16} />
                {buttonLabel}
              </span>
            ) : (
              buttonLabel
            )}
          </Button>

          <button
            type="button"
            className="t-small paste-form__examples-link"
            onClick={() => setExamplesOpen((o) => !o)}
            aria-expanded={examplesOpen}
          >
            See examples
          </button>
        </div>

        {examplesOpen ? (
          <div className="paste-form__examples-panel" data-testid="paste-examples">
            {SAMPLES.map((s) => (
              <div key={s.label}>
                <div className="t-small" style={{ color: 'var(--t-3)', marginBottom: 'var(--s-1)' }}>
                  {s.label}
                </div>
                <pre
                  className="t-mono"
                  style={{
                    margin: 0,
                    padding: 'var(--s-2)',
                    background: 'var(--g-fill-weak)',
                    borderRadius: 6,
                    overflow: 'auto',
                    color: 'var(--t-2)',
                  }}
                >
                  {s.body}
                </pre>
              </div>
            ))}
          </div>
        ) : null}

        {/* Live region for screen readers — announces parse/probe progress. */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="paste-form__sr-only"
        >
          {busy === 'parsing' && 'Detecting provider…'}
          {busy === 'probing' && parsed && `Probing ${parsed.provider_guess} capabilities.`}
          {caps && !busy && `Probe complete for ${caps.provider} ${caps.model}.`}
          {error && `Error: ${error}`}
        </div>

        {/* Provider badge — rendered once parsed is set. */}
        {parsed ? (
          <div
            className="paste-form__badge"
            role="status"
            aria-label={`Detected provider: ${parsed.provider_guess}${parsed.model ? ` ${parsed.model}` : ''}`}
          >
            <div className="paste-form__badge-row">
              <Pill tone="pro" dot>
                {parsed.provider_guess}
              </Pill>
              {parsed.model ? (
                <span className="t-mono t-small" style={{ color: 'var(--t-2)' }}>
                  {parsed.model}
                </span>
              ) : null}
            </div>
            {parsed.base_url ? (
              <div
                className="t-mono t-small paste-form__badge-url"
                title={parsed.base_url}
              >
                {parsed.base_url}
              </div>
            ) : null}
            {maskedKey ? (
              <div className="t-small" style={{ color: 'var(--t-2)' }}>
                Key detected: {maskedKey}
              </div>
            ) : null}

            {/* Probing spinner — sits below the badge while probe is in flight. */}
            {busy === 'probing' ? (
              <div className="paste-form__status t-small">
                <GlassSpinner size={16} />
                <span>Probing {parsed.provider_guess} capabilities…</span>
              </div>
            ) : null}

            {/* Capability pill strip — rendered after a successful probe. */}
            {caps ? (
              <div className="paste-form__pill-strip">
                <CapabilityPillStrip provider={caps.provider} record={caps} />
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Error panel — inherits .onb-error styling from onboarding.css. */}
        {error ? (
          <div className="onb-error" role="alert">
            {error}
          </div>
        ) : null}

        {/* Soft-success panel — 429 means the key works. */}
        {okMessage ? (
          <div className="onb-ok" role="status">
            {okMessage}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
