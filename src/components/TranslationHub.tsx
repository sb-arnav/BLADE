import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useTranslation,
  getLanguageByCode,
  SUPPORTED_LANGUAGES,
  TranslationEntry,
} from "../hooks/useTranslation";

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// ── Language Selector ──────────────────────────────────────────────────

function LanguageSelector({
  value,
  onChange,
  label,
  allowDetect,
}: {
  value: string;
  onChange: (code: string) => void;
  label: string;
  allowDetect?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return SUPPORTED_LANGUAGES;
    const q = search.toLowerCase();
    return SUPPORTED_LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    );
  }, [search]);

  const selected = getLanguageByCode(value);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <label className="text-[10px] uppercase tracking-wider text-white/40 mb-1 block">
        {label}
      </label>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 hover:border-white/20 transition-colors w-full text-left min-w-[180px]"
      >
        {value === "auto" ? (
          <span className="text-sm text-white/60">Auto Detect</span>
        ) : (
          <>
            <span className="text-base">{selected?.flag}</span>
            <span className="text-sm text-white/90">{selected?.name}</span>
            <span className="text-xs text-white/40 ml-auto">{selected?.nativeName}</span>
          </>
        )}
        <span className="text-white/30 ml-auto text-xs">▾</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-[#1a1a2e] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search languages…"
              className="w-full px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/25"
            />
          </div>
          <div className="max-h-60 overflow-y-auto">
            {allowDetect && (
              <button
                onClick={() => { onChange("auto"); setOpen(false); setSearch(""); }}
                className={`flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-white/5 transition-colors ${value === "auto" ? "bg-white/10" : ""}`}
              >
                <span className="text-base">🔍</span>
                <span className="text-sm text-white/80">Auto Detect</span>
              </button>
            )}
            {filtered.map((lang) => (
              <button
                key={lang.code}
                onClick={() => { onChange(lang.code); setOpen(false); setSearch(""); }}
                className={`flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-white/5 transition-colors ${lang.code === value ? "bg-white/10" : ""}`}
              >
                <span className="text-base">{lang.flag}</span>
                <span className="text-sm text-white/90">{lang.name}</span>
                <span className="text-xs text-white/40 ml-auto">{lang.nativeName}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-white/30 text-sm">
                No languages found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────

export default function TranslationHub({ onBack, onSendToChat }: Props) {
  const {
    translations,
    translate,
    translateBatch,
    detectLanguage,
    addToHistory,
    toggleFavorite,
    deleteEntry,
    clearHistory,
    recentLanguages,
  } = useTranslation();

  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("es");
  const [sourceText, setSourceText] = useState("");
  const [translatedText, setTranslatedText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "favorites">("all");
  const [historySearch, setHistorySearch] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filtered history
  const filteredHistory = useMemo(() => {
    let list = historyFilter === "favorites"
      ? translations.filter((t) => t.isFavorite)
      : translations;
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      list = list.filter(
        (t) =>
          t.sourceText.toLowerCase().includes(q) ||
          t.translatedText.toLowerCase().includes(q),
      );
    }
    return list;
  }, [translations, historyFilter, historySearch]);

  // Swap languages
  const swapLanguages = useCallback(() => {
    if (sourceLang === "auto") return;
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setSourceText(translatedText);
    setTranslatedText(sourceText);
  }, [sourceLang, targetLang, sourceText, translatedText]);

  // Translate handler
  const handleTranslate = useCallback(() => {
    if (!sourceText.trim() || isTranslating) return;
    setIsTranslating(true);

    const effectiveFrom = sourceLang === "auto" ? "en" : sourceLang;

    if (batchMode) {
      const lines = sourceText.split("\n").filter((l) => l.trim());
      const prompt = translateBatch(lines, effectiveFrom, targetLang);
      onSendToChat(prompt);
      // Simulate translation result for UI — in real usage the AI response
      // would be captured and displayed via the chat integration
      const placeholder = lines.map((l) => `[${getLanguageByCode(targetLang)?.name}] ${l}`).join("\n");
      setTranslatedText(placeholder);
      addToHistory({
        sourceText: sourceText.trim(),
        translatedText: placeholder,
        sourceLang: effectiveFrom,
        targetLang,
        model: "claude",
      });
    } else {
      const prompt = translate(sourceText.trim(), effectiveFrom, targetLang);
      onSendToChat(prompt);
      const placeholder = `Translating to ${getLanguageByCode(targetLang)?.name}…`;
      setTranslatedText(placeholder);
      addToHistory({
        sourceText: sourceText.trim(),
        translatedText: placeholder,
        sourceLang: effectiveFrom,
        targetLang,
        model: "claude",
      });
    }

    setIsTranslating(false);
  }, [sourceText, sourceLang, targetLang, batchMode, isTranslating, translate, translateBatch, addToHistory, onSendToChat]);

  // Detect language handler
  const handleDetect = useCallback(() => {
    if (!sourceText.trim()) return;
    const prompt = detectLanguage(sourceText.trim());
    onSendToChat(prompt);
  }, [sourceText, detectLanguage, onSendToChat]);

  // Copy to clipboard
  const copyTranslation = useCallback(() => {
    if (translatedText) {
      navigator.clipboard.writeText(translatedText);
    }
  }, [translatedText]);

  // Text-to-speech
  const speakText = useCallback((text: string, lang: string) => {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }, []);

  // Load a history entry
  const loadEntry = useCallback((entry: TranslationEntry) => {
    setSourceLang(entry.sourceLang);
    setTargetLang(entry.targetLang);
    setSourceText(entry.sourceText);
    setTranslatedText(entry.translatedText);
  }, []);

  // Apply a recent pair
  const applyPair = useCallback((from: string, to: string) => {
    setSourceLang(from);
    setTargetLang(to);
  }, []);

  // Character count
  const charCount = sourceText.length;

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[#0e0e1a] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-white/5 transition-colors text-white/50 hover:text-white/80"
          title="Back"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <span className="text-lg">🌐</span>
          <h1 className="text-base font-semibold tracking-tight">Translation Hub</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setBatchMode(!batchMode)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              batchMode
                ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                : "bg-white/5 text-white/50 border border-white/10 hover:text-white/70"
            }`}
          >
            {batchMode ? "Batch ON" : "Batch"}
          </button>
          <button
            onClick={() => {
              if (translations.length > 0 && confirm("Clear all translation history?")) {
                clearHistory();
              }
            }}
            className="px-3 py-1 rounded-lg text-xs text-white/40 hover:text-red-400 bg-white/5 border border-white/10 transition-colors"
          >
            Clear History
          </button>
        </div>
      </div>

      {/* Recent Pairs */}
      {recentLanguages.length > 0 && (
        <div className="flex items-center gap-2 px-5 py-2 border-b border-white/5 shrink-0 overflow-x-auto">
          <span className="text-[10px] uppercase tracking-wider text-white/30 shrink-0">
            Recent:
          </span>
          {recentLanguages.map((pair, i) => {
            const from = getLanguageByCode(pair.from);
            const to = getLanguageByCode(pair.to);
            return (
              <button
                key={i}
                onClick={() => applyPair(pair.from, pair.to)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-white/60 hover:text-white/90 hover:border-white/20 transition-colors shrink-0"
              >
                <span>{from?.flag}</span>
                <span>{from?.code?.toUpperCase()}</span>
                <span className="text-white/20">→</span>
                <span>{to?.flag}</span>
                <span>{to?.code?.toUpperCase()}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Translation Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-5">
          {/* Two-panel layout */}
          <div className="grid grid-cols-[1fr,auto,1fr] gap-3 items-start">
            {/* Source Panel */}
            <div className="flex flex-col gap-2">
              <div className="flex items-end gap-2">
                <LanguageSelector
                  value={sourceLang}
                  onChange={setSourceLang}
                  label="From"
                  allowDetect
                />
                {sourceLang === "auto" && sourceText.trim() && (
                  <button
                    onClick={handleDetect}
                    className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
                  >
                    Detect Language
                  </button>
                )}
              </div>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder={batchMode ? "Enter text (one item per line for batch mode)…" : "Enter text to translate…"}
                  rows={8}
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/20 resize-none font-mono leading-relaxed"
                />
                <div className="absolute bottom-2 right-3 flex items-center gap-2">
                  <span className="text-[10px] text-white/25">{charCount} chars</span>
                  {sourceText && (
                    <button
                      onClick={() => speakText(sourceText, sourceLang === "auto" ? "en" : sourceLang)}
                      className="text-white/25 hover:text-white/60 transition-colors text-xs"
                      title="Listen"
                    >
                      🔊
                    </button>
                  )}
                  {sourceText && (
                    <button
                      onClick={() => { setSourceText(""); setTranslatedText(""); }}
                      className="text-white/25 hover:text-white/60 transition-colors text-xs"
                      title="Clear"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Swap Button */}
            <div className="flex flex-col items-center justify-center pt-8">
              <button
                onClick={swapLanguages}
                disabled={sourceLang === "auto"}
                className={`p-2.5 rounded-full border transition-colors ${
                  sourceLang === "auto"
                    ? "border-white/5 text-white/15 cursor-not-allowed"
                    : "border-white/10 text-white/40 hover:text-white/80 hover:border-white/25 hover:bg-white/5"
                }`}
                title="Swap languages"
              >
                ↔
              </button>
            </div>

            {/* Target Panel */}
            <div className="flex flex-col gap-2">
              <LanguageSelector
                value={targetLang}
                onChange={setTargetLang}
                label="To"
              />
              <div className="relative">
                <textarea
                  value={translatedText}
                  readOnly
                  placeholder="Translation will appear here…"
                  rows={8}
                  className="w-full px-4 py-3 rounded-xl bg-white/[0.03] border border-white/10 text-sm text-white/80 placeholder:text-white/20 outline-none resize-none font-mono leading-relaxed"
                />
                <div className="absolute bottom-2 right-3 flex items-center gap-2">
                  {translatedText && (
                    <>
                      <button
                        onClick={copyTranslation}
                        className="text-white/25 hover:text-white/60 transition-colors text-xs"
                        title="Copy"
                      >
                        📋
                      </button>
                      <button
                        onClick={() => speakText(translatedText, targetLang)}
                        className="text-white/25 hover:text-white/60 transition-colors text-xs"
                        title="Listen"
                      >
                        🔊
                      </button>
                      <button
                        onClick={() => onSendToChat(translatedText)}
                        className="text-white/25 hover:text-white/60 transition-colors text-xs"
                        title="Send to Chat"
                      >
                        💬
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Translate Button */}
          <div className="flex items-center justify-center gap-3 mt-4">
            <button
              onClick={handleTranslate}
              disabled={!sourceText.trim() || isTranslating}
              className={`px-8 py-2.5 rounded-xl text-sm font-medium transition-all ${
                sourceText.trim() && !isTranslating
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 hover:scale-[1.02] active:scale-[0.98]"
                  : "bg-white/5 text-white/20 border border-white/5 cursor-not-allowed"
              }`}
            >
              {isTranslating ? "Translating…" : batchMode ? "Translate Batch" : "Translate"}
            </button>
          </div>

          {/* Batch mode hint */}
          {batchMode && (
            <p className="text-center text-[11px] text-white/25 mt-2">
              Each line will be translated separately. Useful for lists, menus, or UI strings.
            </p>
          )}

          {/* ── History Section ──────────────────────────────────────── */}
          <div className="mt-8 border-t border-white/5 pt-5">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-white/70">History</h2>
              <div className="flex items-center gap-1 ml-auto">
                <button
                  onClick={() => setHistoryFilter("all")}
                  className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                    historyFilter === "all"
                      ? "bg-white/10 text-white/80"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setHistoryFilter("favorites")}
                  className={`px-2.5 py-1 rounded-md text-[11px] transition-colors ${
                    historyFilter === "favorites"
                      ? "bg-yellow-500/15 text-yellow-400"
                      : "text-white/30 hover:text-white/50"
                  }`}
                >
                  ★ Favorites
                </button>
              </div>
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search history…"
                className="px-3 py-1 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-white/25 outline-none focus:border-white/20 w-48"
              />
            </div>

            {filteredHistory.length === 0 ? (
              <div className="text-center py-10 text-white/20 text-sm">
                {translations.length === 0
                  ? "No translations yet. Start translating above!"
                  : "No matching translations found."}
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
                {filteredHistory.map((entry) => {
                  const fromLang = getLanguageByCode(entry.sourceLang);
                  const toLang = getLanguageByCode(entry.targetLang);
                  return (
                    <div
                      key={entry.id}
                      className="group flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors cursor-pointer"
                      onClick={() => loadEntry(entry)}
                    >
                      <div className="flex flex-col items-center gap-0.5 pt-0.5 shrink-0">
                        <span className="text-xs">{fromLang?.flag}</span>
                        <span className="text-[9px] text-white/20">↓</span>
                        <span className="text-xs">{toLang?.flag}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/60 truncate">
                          {truncate(entry.sourceText, 80)}
                        </p>
                        <p className="text-xs text-white/40 truncate mt-0.5">
                          {truncate(entry.translatedText, 80)}
                        </p>
                        <span className="text-[10px] text-white/20 mt-1 block">
                          {timeAgo(entry.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFavorite(entry.id);
                          }}
                          className={`p-1 rounded text-xs transition-colors ${
                            entry.isFavorite
                              ? "text-yellow-400"
                              : "text-white/20 hover:text-yellow-400"
                          }`}
                          title={entry.isFavorite ? "Unfavorite" : "Favorite"}
                        >
                          {entry.isFavorite ? "★" : "☆"}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(entry.translatedText);
                          }}
                          className="p-1 rounded text-xs text-white/20 hover:text-white/60 transition-colors"
                          title="Copy translation"
                        >
                          📋
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSendToChat(entry.translatedText);
                          }}
                          className="p-1 rounded text-xs text-white/20 hover:text-white/60 transition-colors"
                          title="Send to Chat"
                        >
                          💬
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteEntry(entry.id);
                          }}
                          className="p-1 rounded text-xs text-white/20 hover:text-red-400 transition-colors"
                          title="Delete"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
