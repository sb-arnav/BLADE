// src/features/onboarding/ApiKeyEntry.tsx — Step 2 (ONBD-03).
//
// Masked input + Test button. Success sequence (D-50):
//   1. testProvider({provider, apiKey, model}) — validate
//   2. storeProviderKey(provider, apiKey)      — write to keyring
//   3. switchProvider(provider, model)         — flip active + load from keyring
//   4. advance to 'scan' step
//
// Failure: show error inline + toast. Keep user on this step.
//
// @see docs/design/onboarding-02-apikey.html
// @see .planning/phases/02-onboarding-shell/02-CONTEXT.md §D-50

import { useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button, Input } from '@/design-system/primitives';
import { Steps } from './Steps';
import { PROVIDERS } from './providers';
import { testProvider, storeProviderKey, switchProvider, TauriError } from '@/lib/tauri';
import { useToast } from '@/lib/context';
import type { useOnboardingState } from './useOnboardingState';

type State = ReturnType<typeof useOnboardingState>;

interface Props {
  state: State['state'];
  setApiKey: State['setApiKey'];
  setStep: State['setStep'];
  beginTest: State['beginTest'];
  endTestOk: State['endTestOk'];
  endTestErr: State['endTestErr'];
}

export function ApiKeyEntry({
  state,
  setApiKey,
  setStep,
  beginTest,
  endTestOk,
  endTestErr,
}: Props) {
  const provider = PROVIDERS.find((p) => p.id === state.providerId) ?? PROVIDERS[0];
  const { show } = useToast();
  const [reveal, setReveal] = useState(false);

  async function handleTest() {
    if (!state.apiKey.trim() && provider.needsKey) {
      endTestErr('API key required');
      return;
    }
    beginTest();
    try {
      const msg = await testProvider({
        provider: provider.id,
        apiKey: state.apiKey,
        model: provider.defaultModel,
      });
      // Persist + switch, in sequence (D-50 composition)
      await storeProviderKey(provider.id, state.apiKey);
      await switchProvider(provider.id, provider.defaultModel);
      endTestOk(msg);
      show({ type: 'success', title: 'Connection OK', message: msg });
      setStep('persona');
    } catch (e) {
      const err = e instanceof TauriError ? e.rustMessage : String(e);
      endTestErr(err);
      show({ type: 'error', title: 'Provider test failed', message: err });
    }
  }

  return (
    <section className="onb glass glass-1" aria-labelledby="onb-apikey-title">
      <Steps current="apikey" />
      <h1 id="onb-apikey-title" className="title">
        Paste your {provider.name} key.
      </h1>
      <p className="subtitle">
        {provider.needsKey ? (
          <>
            We store it in your OS keyring. Nothing leaves your machine.{' '}
            <a
              href={provider.keyUrl}
              onClick={(e) => {
                // Tauri webview won't open <a target="_blank"> natively — bounce
                // through tauri-plugin-opener so the OS handles the URL.
                e.preventDefault();
                openUrl(provider.keyUrl).catch(() => {
                  /* noop — opener not initialised yet (pre-plugin register) */
                });
              }}
            >
              Get a key →
            </a>
          </>
        ) : (
          <>{provider.name} runs locally — no key needed. Click Test to verify the install.</>
        )}
      </p>

      <div className="onb-field">
        <label htmlFor="onb-api-key" className="onb-label">
          API key
        </label>
        <div className="onb-key-row">
          <Input
            id="onb-api-key"
            type={reveal ? 'text' : 'password'}
            value={state.apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={provider.keyPlaceholder}
            mono
            autoComplete="off"
            spellCheck={false}
            disabled={state.testing}
          />
          <Button
            variant="ghost"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? 'Hide key' : 'Show key'}
          >
            {reveal ? 'Hide' : 'Show'}
          </Button>
        </div>
      </div>

      {state.testError && (
        <div className="onb-error" role="alert">
          {state.testError}
        </div>
      )}
      {state.testResult && !state.testError && (
        <div className="onb-ok" role="status">
          {state.testResult}
        </div>
      )}

      <div className="onb-footer">
        <Button variant="ghost" onClick={() => setStep('provider')}>
          ← Back
        </Button>
        <Button variant="primary" onClick={handleTest} disabled={state.testing}>
          {state.testing ? 'Testing…' : 'Test & continue →'}
        </Button>
      </div>
    </section>
  );
}
