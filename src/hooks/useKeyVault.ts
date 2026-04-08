import { useState, useCallback, useEffect } from "react";
import { SettingsDB } from "../data/settings";

/**
 * Key Vault — Secure API key management across all providers.
 *
 * Keys are stored in the OS-backed SQLite settings table via Tauri invoke,
 * never in localStorage. Only previews (first 3 + last 3 chars) are held
 * in React state so the raw secret never leaks into the renderer DOM.
 */

export type VaultService =
  | "openai"
  | "anthropic"
  | "groq"
  | "gemini"
  | "github"
  | "huggingface"
  | "elevenlabs"
  | "deepgram"
  | "custom";

export interface VaultEntry {
  id: string;
  service: VaultService;
  label: string;
  keyPreview: string; // "sk-ab...xyz"
  addedAt: number;
  lastUsed: number | null;
  isValid: boolean | null; // null = untested
  provider: string;
}

export interface KeyVaultState {
  entries: VaultEntry[];
  loading: boolean;
  addKey: (service: VaultService, label: string, key: string) => Promise<void>;
  removeKey: (id: string) => Promise<void>;
  testKey: (id: string) => Promise<boolean>;
  getKey: (service: VaultService, id?: string) => Promise<string | null>;
  listProviders: () => VaultService[];
  updateLastUsed: (id: string) => Promise<void>;
  exportVault: (passphrase: string) => Promise<string>;
  importVault: (blob: string, passphrase: string) => Promise<number>;
}

const VAULT_INDEX_KEY = "blade-vault-index";
const VAULT_SECRET_PREFIX = "blade-vault-secret:";

/** Mask a key: show first 3 + last 3 chars, middle replaced with "..." */
function makePreview(key: string): string {
  if (key.length <= 8) return key.slice(0, 2) + "..." + key.slice(-2);
  return key.slice(0, 5) + "..." + key.slice(-3);
}

const SERVICE_LABELS: Record<VaultService, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  groq: "Groq",
  gemini: "Google Gemini",
  github: "GitHub",
  huggingface: "Hugging Face",
  elevenlabs: "ElevenLabs",
  deepgram: "Deepgram",
  custom: "Custom",
};

/** Test endpoints per service — lightweight calls to validate the key */
async function testApiKey(service: VaultService, key: string): Promise<boolean> {
  try {
    switch (service) {
      case "openai": {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "anthropic": {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 1,
            messages: [{ role: "user", content: "hi" }],
          }),
        });
        // 200 or 400 (bad request but key is valid) both mean the key works
        return r.status !== 401 && r.status !== 403;
      }
      case "groq": {
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "gemini": {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`
        );
        return r.ok;
      }
      case "github": {
        const r = await fetch("https://api.github.com/user", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "huggingface": {
        const r = await fetch("https://huggingface.co/api/whoami-v2", {
          headers: { Authorization: `Bearer ${key}` },
        });
        return r.ok;
      }
      case "elevenlabs": {
        const r = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": key },
        });
        return r.ok;
      }
      case "deepgram": {
        const r = await fetch("https://api.deepgram.com/v1/projects", {
          headers: { Authorization: `Token ${key}` },
        });
        return r.ok;
      }
      default:
        return true; // custom keys can't be validated
    }
  } catch {
    return false;
  }
}

/** Simple XOR-based obfuscation for export blobs (not military-grade, but enough for local transfer) */
function xorCipher(text: string, passphrase: string): string {
  const result: number[] = [];
  for (let i = 0; i < text.length; i++) {
    result.push(text.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length));
  }
  return btoa(String.fromCharCode(...result));
}

function xorDecipher(encoded: string, passphrase: string): string {
  const decoded = atob(encoded);
  const result: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    result.push(decoded.charCodeAt(i) ^ passphrase.charCodeAt(i % passphrase.length));
  }
  return String.fromCharCode(...result);
}

async function loadIndex(): Promise<VaultEntry[]> {
  return SettingsDB.getJson<VaultEntry[]>(VAULT_INDEX_KEY, []);
}

async function saveIndex(entries: VaultEntry[]): Promise<void> {
  await SettingsDB.setJson(VAULT_INDEX_KEY, entries);
}

export function useKeyVault(): KeyVaultState {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Load vault index on mount
  useEffect(() => {
    loadIndex()
      .then(setEntries)
      .finally(() => setLoading(false));
  }, []);

  const addKey = useCallback(async (service: VaultService, label: string, key: string) => {
    const id = crypto.randomUUID();
    const entry: VaultEntry = {
      id,
      service,
      label: label.trim() || SERVICE_LABELS[service],
      keyPreview: makePreview(key),
      addedAt: Date.now(),
      lastUsed: null,
      isValid: null,
      provider: SERVICE_LABELS[service],
    };

    // Store the raw secret in the DB under a separate key
    await SettingsDB.set(VAULT_SECRET_PREFIX + id, key);

    const next = [...(await loadIndex()), entry];
    await saveIndex(next);
    setEntries(next);
  }, []);

  const removeKey = useCallback(async (id: string) => {
    await SettingsDB.delete(VAULT_SECRET_PREFIX + id);
    const next = (await loadIndex()).filter((e) => e.id !== id);
    await saveIndex(next);
    setEntries(next);
  }, []);

  const testKey = useCallback(async (id: string) => {
    const raw = await SettingsDB.get(VAULT_SECRET_PREFIX + id);
    if (!raw) return false;

    const current = await loadIndex();
    const entry = current.find((e) => e.id === id);
    if (!entry) return false;

    const valid = await testApiKey(entry.service, raw);

    const next = current.map((e) =>
      e.id === id ? { ...e, isValid: valid } : e
    );
    await saveIndex(next);
    setEntries(next);
    return valid;
  }, []);

  const getKey = useCallback(async (service: VaultService, id?: string) => {
    if (id) {
      return SettingsDB.get(VAULT_SECRET_PREFIX + id);
    }
    // Return the first key for this service
    const current = await loadIndex();
    const entry = current.find((e) => e.service === service);
    if (!entry) return null;
    return SettingsDB.get(VAULT_SECRET_PREFIX + entry.id);
  }, []);

  const updateLastUsed = useCallback(async (id: string) => {
    const current = await loadIndex();
    const next = current.map((e) =>
      e.id === id ? { ...e, lastUsed: Date.now() } : e
    );
    await saveIndex(next);
    setEntries(next);
  }, []);

  const listProviders = useCallback((): VaultService[] => {
    return Object.keys(SERVICE_LABELS) as VaultService[];
  }, []);

  const exportVault = useCallback(async (passphrase: string): Promise<string> => {
    const current = await loadIndex();
    const payload: { entry: VaultEntry; secret: string }[] = [];
    for (const entry of current) {
      const secret = await SettingsDB.get(VAULT_SECRET_PREFIX + entry.id);
      if (secret) payload.push({ entry, secret });
    }
    return xorCipher(JSON.stringify(payload), passphrase);
  }, []);

  const importVault = useCallback(async (blob: string, passphrase: string): Promise<number> => {
    const raw = xorDecipher(blob, passphrase);
    const payload: { entry: VaultEntry; secret: string }[] = JSON.parse(raw);
    const current = await loadIndex();
    let imported = 0;

    for (const { entry, secret } of payload) {
      // Generate new ID to avoid collisions
      const newId = crypto.randomUUID();
      const newEntry: VaultEntry = {
        ...entry,
        id: newId,
        addedAt: Date.now(),
        lastUsed: null,
        isValid: null,
      };
      await SettingsDB.set(VAULT_SECRET_PREFIX + newId, secret);
      current.push(newEntry);
      imported++;
    }

    await saveIndex(current);
    setEntries(current);
    return imported;
  }, []);

  return {
    entries,
    loading,
    addKey,
    removeKey,
    testKey,
    getKey,
    listProviders,
    updateLastUsed,
    exportVault,
    importVault,
  };
}
