import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface TranslationEntry {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string;
  targetLang: string;
  model: string;
  timestamp: number;
  isFavorite: boolean;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
  flag: string;
}

export interface LanguagePair {
  from: string;
  to: string;
  usedAt: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-translations";
const PAIRS_KEY = "blade-translation-pairs";
const MAX_HISTORY = 200;
const MAX_RECENT_PAIRS = 8;

export const SUPPORTED_LANGUAGES: Language[] = [
  { code: "en", name: "English", nativeName: "English", flag: "🇬🇧" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
  { code: "it", name: "Italian", nativeName: "Italiano", flag: "🇮🇹" },
  { code: "pt", name: "Portuguese", nativeName: "Português", flag: "🇧🇷" },
  { code: "ru", name: "Russian", nativeName: "Русский", flag: "🇷🇺" },
  { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文", flag: "🇨🇳" },
  { code: "zh-TW", name: "Chinese (Traditional)", nativeName: "繁體中文", flag: "🇹🇼" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "ar", name: "Arabic", nativeName: "العربية", flag: "🇸🇦" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", flag: "🇮🇳" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা", flag: "🇧🇩" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe", flag: "🇹🇷" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt", flag: "🇻🇳" },
  { code: "th", name: "Thai", nativeName: "ไทย", flag: "🇹🇭" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ms", name: "Malay", nativeName: "Bahasa Melayu", flag: "🇲🇾" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", flag: "🇳🇱" },
  { code: "pl", name: "Polish", nativeName: "Polski", flag: "🇵🇱" },
  { code: "cs", name: "Czech", nativeName: "Čeština", flag: "🇨🇿" },
  { code: "sv", name: "Swedish", nativeName: "Svenska", flag: "🇸🇪" },
  { code: "no", name: "Norwegian", nativeName: "Norsk", flag: "🇳🇴" },
  { code: "da", name: "Danish", nativeName: "Dansk", flag: "🇩🇰" },
  { code: "fi", name: "Finnish", nativeName: "Suomi", flag: "🇫🇮" },
  { code: "el", name: "Greek", nativeName: "Ελληνικά", flag: "🇬🇷" },
  { code: "he", name: "Hebrew", nativeName: "עברית", flag: "🇮🇱" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська", flag: "🇺🇦" },
  { code: "ro", name: "Romanian", nativeName: "Română", flag: "🇷🇴" },
];

// ── Helpers ────────────────────────────────────────────────────────────

function generateId(): string {
  return `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadHistory(): TranslationEntry[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistHistory(entries: TranslationEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function loadRecentPairs(): LanguagePair[] {
  try {
    return JSON.parse(localStorage.getItem(PAIRS_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistPairs(pairs: LanguagePair[]) {
  localStorage.setItem(PAIRS_KEY, JSON.stringify(pairs));
}

export function getLanguageByCode(code: string): Language | undefined {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code);
}

// ── AI prompt builders ─────────────────────────────────────────────────

function buildTranslatePrompt(text: string, fromLang: string, toLang: string): string {
  const from = getLanguageByCode(fromLang);
  const to = getLanguageByCode(toLang);
  return (
    `Translate the following text from ${from?.name ?? fromLang} to ${to?.name ?? toLang}. ` +
    `Return ONLY the translated text, no commentary, no explanation, no quotes.\n\n` +
    `---\n${text}\n---`
  );
}

function buildDetectPrompt(text: string): string {
  const codeList = SUPPORTED_LANGUAGES.map((l) => l.code).join(", ");
  return (
    `Detect the language of the following text. Respond with ONLY the ISO language code ` +
    `from this list: ${codeList}. No explanation.\n\n---\n${text}\n---`
  );
}

function buildBatchTranslatePrompt(lines: string[], fromLang: string, toLang: string): string {
  const from = getLanguageByCode(fromLang);
  const to = getLanguageByCode(toLang);
  const numbered = lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  return (
    `Translate each numbered line below from ${from?.name ?? fromLang} to ${to?.name ?? toLang}. ` +
    `Return ONLY the translated lines in the same numbered format. No extra commentary.\n\n` +
    `${numbered}`
  );
}

function buildConversationTranslatePrompt(
  messages: { role: string; content: string }[],
  toLang: string,
): string {
  const to = getLanguageByCode(toLang);
  const formatted = messages
    .map((m, i) => `[${i + 1}] ${m.role}: ${m.content}`)
    .join("\n\n");
  return (
    `Translate this entire conversation to ${to?.name ?? toLang}. ` +
    `Preserve the numbered format [N] role: translated text. ` +
    `Translate ONLY the content, keep the role labels in English.\n\n${formatted}`
  );
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useTranslation() {
  const [translations, setTranslations] = useState<TranslationEntry[]>(loadHistory);
  const [recentPairs, setRecentPairs] = useState<LanguagePair[]>(loadRecentPairs);

  // Persist on every change
  useEffect(() => {
    persistHistory(translations);
  }, [translations]);

  useEffect(() => {
    persistPairs(recentPairs);
  }, [recentPairs]);

  // Track a language pair usage
  const trackPair = useCallback((from: string, to: string) => {
    setRecentPairs((prev) => {
      const filtered = prev.filter((p) => !(p.from === from && p.to === to));
      const updated = [{ from, to, usedAt: Date.now() }, ...filtered];
      return updated.slice(0, MAX_RECENT_PAIRS);
    });
  }, []);

  // Translate text — returns the prompt string for the AI.
  // The component sends this to the chat and stores the result.
  const translate = useCallback(
    (text: string, fromLang: string, toLang: string): string => {
      trackPair(fromLang, toLang);
      return buildTranslatePrompt(text, fromLang, toLang);
    },
    [trackPair],
  );

  // Build a detect-language prompt
  const detectLanguage = useCallback((text: string): string => {
    return buildDetectPrompt(text);
  }, []);

  // Build a batch translate prompt
  const translateBatch = useCallback(
    (lines: string[], fromLang: string, toLang: string): string => {
      trackPair(fromLang, toLang);
      return buildBatchTranslatePrompt(lines, fromLang, toLang);
    },
    [trackPair],
  );

  // Build a conversation translate prompt
  const translateConversation = useCallback(
    (messages: { role: string; content: string }[], toLang: string): string => {
      return buildConversationTranslatePrompt(messages, toLang);
    },
    [],
  );

  // Add a completed translation to history
  const addToHistory = useCallback(
    (entry: Omit<TranslationEntry, "id" | "timestamp" | "isFavorite">) => {
      const newEntry: TranslationEntry = {
        ...entry,
        id: generateId(),
        timestamp: Date.now(),
        isFavorite: false,
      };
      setTranslations((prev) => [newEntry, ...prev].slice(0, MAX_HISTORY));
      return newEntry;
    },
    [],
  );

  // Toggle favorite
  const toggleFavorite = useCallback((id: string) => {
    setTranslations((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isFavorite: !t.isFavorite } : t)),
    );
  }, []);

  // Delete a single entry
  const deleteEntry = useCallback((id: string) => {
    setTranslations((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Clear all history
  const clearHistory = useCallback(() => {
    setTranslations([]);
  }, []);

  // Get history filtered/sorted
  const getHistory = useCallback(
    (opts?: { favoritesOnly?: boolean; lang?: string }) => {
      let filtered = translations;
      if (opts?.favoritesOnly) {
        filtered = filtered.filter((t) => t.isFavorite);
      }
      if (opts?.lang) {
        filtered = filtered.filter(
          (t) => t.sourceLang === opts.lang || t.targetLang === opts.lang,
        );
      }
      return filtered;
    },
    [translations],
  );

  // Recent language pairs for quick access
  const recentLanguages = useMemo(() => recentPairs, [recentPairs]);

  return {
    translations,
    translate,
    translateBatch,
    translateConversation,
    detectLanguage,
    addToHistory,
    getHistory,
    toggleFavorite,
    deleteEntry,
    clearHistory,
    supportedLanguages: SUPPORTED_LANGUAGES,
    recentLanguages,
  };
}
