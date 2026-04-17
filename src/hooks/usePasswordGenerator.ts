import { useState, useCallback } from "react";

/**
 * Secure password generator — built into Blade for quick access.
 */

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  customExclude: string;
}

export interface GeneratedPassword {
  id: string;
  password: string;
  strength: "weak" | "fair" | "good" | "strong" | "very-strong";
  entropy: number;
  options: PasswordOptions;
  timestamp: number;
  label: string;
  copied: boolean;
}

const CHARS = {
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  numbers: "0123456789",
  symbols: "!@#$%^&*()_+-=[]{}|;:,.<>?",
  ambiguous: "0OIl1",
};

function calculateEntropy(password: string): number {
  const charsetSize = new Set(password).size;
  return Math.round(password.length * Math.log2(Math.max(charsetSize, 2)));
}

function getStrength(entropy: number): GeneratedPassword["strength"] {
  if (entropy < 28) return "weak";
  if (entropy < 36) return "fair";
  if (entropy < 60) return "good";
  if (entropy < 128) return "strong";
  return "very-strong";
}

function generatePassword(options: PasswordOptions): string {
  let charset = "";
  if (options.uppercase) charset += CHARS.uppercase;
  if (options.lowercase) charset += CHARS.lowercase;
  if (options.numbers) charset += CHARS.numbers;
  if (options.symbols) charset += CHARS.symbols;

  if (!charset) charset = CHARS.lowercase + CHARS.numbers;

  if (options.excludeAmbiguous) {
    for (const char of CHARS.ambiguous) {
      charset = charset.replace(char, "");
    }
  }

  if (options.customExclude) {
    for (const char of options.customExclude) {
      charset = charset.split(char).join("");
    }
  }

  const array = new Uint32Array(options.length);
  crypto.getRandomValues(array);
  return Array.from(array, (v) => charset[v % charset.length]).join("");
}

function generatePassphrase(wordCount: number): string {
  const words = [
    "blade", "quantum", "falcon", "nebula", "cipher", "vortex", "prism", "zenith",
    "echo", "flux", "nova", "pulse", "spark", "drift", "storm", "forge",
    "crown", "atlas", "raven", "lunar", "solar", "amber", "coral", "ivory",
    "onyx", "ruby", "jade", "opal", "pearl", "slate", "steel", "frost",
    "blaze", "swift", "brave", "sharp", "bold", "keen", "vast", "deep",
    "pixel", "delta", "sigma", "omega", "alpha", "gamma", "theta", "kappa",
  ];
  const array = new Uint32Array(wordCount);
  crypto.getRandomValues(array);
  const selected = Array.from(array, (v) => words[v % words.length]);

  // Capitalize first letter of each word and add a random number
  const numArray = new Uint32Array(1);
  crypto.getRandomValues(numArray);
  const num = numArray[0] % 1000;

  return selected.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("-") + num;
}

const DEFAULT_OPTIONS: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: true,
  customExclude: "",
};

const STORAGE_KEY = "blade-password-history";
const MAX_HISTORY = 50;

function loadHistory(): GeneratedPassword[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

function saveHistory(history: GeneratedPassword[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
}

export function usePasswordGenerator() {
  const [options, setOptions] = useState<PasswordOptions>(DEFAULT_OPTIONS);
  const [history, setHistory] = useState<GeneratedPassword[]>(loadHistory);
  const [current, setCurrent] = useState<GeneratedPassword | null>(null);

  const generate = useCallback((label = "") => {
    const password = generatePassword(options);
    const entropy = calculateEntropy(password);
    const entry: GeneratedPassword = {
      id: crypto.randomUUID(),
      password,
      strength: getStrength(entropy),
      entropy,
      options: { ...options },
      timestamp: Date.now(),
      label,
      copied: false,
    };
    setCurrent(entry);
    setHistory((prev) => {
      const next = [...prev, entry].slice(-MAX_HISTORY);
      saveHistory(next);
      return next;
    });
    return entry;
  }, [options]);

  const generatePhrase = useCallback((wordCount = 4, label = "") => {
    const password = generatePassphrase(wordCount);
    const entropy = calculateEntropy(password);
    const entry: GeneratedPassword = {
      id: crypto.randomUUID(),
      password,
      strength: getStrength(entropy),
      entropy,
      options: { ...options, length: password.length },
      timestamp: Date.now(),
      label,
      copied: false,
    };
    setCurrent(entry);
    setHistory((prev) => {
      const next = [...prev, entry].slice(-MAX_HISTORY);
      saveHistory(next);
      return next;
    });
    return entry;
  }, [options]);

  const copyPassword = useCallback(async (id: string) => {
    const entry = history.find((e) => e.id === id) || current;
    if (!entry) return;
    await navigator.clipboard.writeText(entry.password);
    if (current?.id === id) setCurrent({ ...current, copied: true });
  }, [history, current]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const updateOptions = useCallback((updates: Partial<PasswordOptions>) => {
    setOptions((prev) => ({ ...prev, ...updates }));
  }, []);

  return {
    options,
    updateOptions,
    current,
    history,
    generate,
    generatePhrase,
    copyPassword,
    clearHistory,
  };
}
