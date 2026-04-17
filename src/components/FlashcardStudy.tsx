import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useFlashcards,
  Flashcard,
  ReviewRating,
  getNextReviewLabel,
} from "../hooks/useFlashcards";

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (prompt: string) => void;
}

type View = "decks" | "study" | "editor" | "generate";

// ── Icon components ────────────────────────────────────────────────────

function DeckIcon({ icon, className = "w-5 h-5" }: { icon: string; className?: string }) {
  const icons: Record<string, React.ReactNode> = {
    brain: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
        <path d="M9 22h6M10 17v5M14 17v5" />
      </svg>
    ),
    book: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
    code: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    flask: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 3h6M10 3v7.4a2 2 0 01-.5 1.3L4 19a1 1 0 00.8 1.6h14.4a1 1 0 00.8-1.6l-5.5-7.3a2 2 0 01-.5-1.3V3" />
      </svg>
    ),
    globe: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
      </svg>
    ),
    music: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
      </svg>
    ),
    math: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    language: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 8l6 10M4 14h8M2 5h12M7 2h1M11.5 22l3.5-10 3.5 10M15 19h4" />
      </svg>
    ),
    star: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ),
    lightning: (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  };
  return <>{icons[icon] ?? icons.brain}</>;
}

// ── Helpers ────────────────────────────────────────────────────────────

function formatRelative(ts: number | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Main component ─────────────────────────────────────────────────────

export default function FlashcardStudy({ onBack, onSendToChat }: Props) {
  const fc = useFlashcards();
  const [view, setView] = useState<View>("decks");
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);

  // Generate modal state
  const [showGenerate, setShowGenerate] = useState(false);
  const [genDeckId, setGenDeckId] = useState<string | null>(null);
  const [genTopic, setGenTopic] = useState("");
  const [genCount, setGenCount] = useState(10);
  const [genLoading, setGenLoading] = useState(false);

  // New deck modal
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [newDeckName, setNewDeckName] = useState("");
  const [newDeckDesc, setNewDeckDesc] = useState("");

  // Editor state
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editDeckId, setEditDeckId] = useState("");

  const cardRef = useRef<HTMLDivElement>(null);

  // ── Keyboard shortcuts ────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (view !== "study" || !fc.session) return;
      const current = fc.session.cards[fc.session.currentIndex];
      if (!current) return;

      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
      if (flipped) {
        if (e.key === "1") { fc.reviewCard(current.id, "again"); setFlipped(false); }
        if (e.key === "2") { fc.reviewCard(current.id, "hard"); setFlipped(false); }
        if (e.key === "3") { fc.reviewCard(current.id, "good"); setFlipped(false); }
        if (e.key === "4") { fc.reviewCard(current.id, "easy"); setFlipped(false); }
      }
      if (e.key === "ArrowRight" && !flipped) {
        fc.skipCard();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [view, fc.session, flipped, fc.reviewCard, fc.skipCard]);

  // ── Actions ───────────────────────────────────────────────────────

  const handleStartStudy = useCallback(
    (deckId: string) => {
      const s = fc.startReview(deckId);
      if (s) {
        setActiveDeckId(deckId);
        setView("study");
        setFlipped(false);
      }
    },
    [fc],
  );

  const handleReview = useCallback(
    (rating: ReviewRating) => {
      if (!fc.session) return;
      const current = fc.session.cards[fc.session.currentIndex];
      if (!current) return;
      fc.reviewCard(current.id, rating);
      setFlipped(false);
    },
    [fc],
  );

  const handleCreateDeck = useCallback(() => {
    if (!newDeckName.trim()) return;
    fc.createDeck(newDeckName.trim(), newDeckDesc.trim());
    setNewDeckName("");
    setNewDeckDesc("");
    setShowNewDeck(false);
  }, [fc, newDeckName, newDeckDesc]);

  const handleOpenEditor = useCallback(
    (card?: Flashcard) => {
      if (card) {
        setEditingCard(card);
        setEditFront(card.front);
        setEditBack(card.back);
        setEditTags(card.tags.join(", "));
        setEditDeckId(card.deckId);
      } else {
        setEditingCard(null);
        setEditFront("");
        setEditBack("");
        setEditTags("");
        setEditDeckId(activeDeckId ?? fc.decks[0]?.id ?? "");
      }
      setView("editor");
    },
    [activeDeckId, fc.decks],
  );

  const handleSaveCard = useCallback(() => {
    if (!editFront.trim() || !editBack.trim() || !editDeckId) return;
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (editingCard) {
      fc.updateCard(editingCard.id, {
        front: editFront.trim(),
        back: editBack.trim(),
        tags,
        deckId: editDeckId,
      });
    } else {
      fc.addCard(editDeckId, editFront.trim(), editBack.trim(), tags);
    }
    setView("decks");
  }, [editingCard, editFront, editBack, editTags, editDeckId, fc]);

  const handleGenerate = useCallback(() => {
    if (!genDeckId || !genTopic.trim()) return;
    setGenLoading(true);
    const count = genCount;
    const topic = genTopic.trim();
    // Send prompt to chat for AI generation
    const prompt = `Generate exactly ${count} flashcards about "${topic}". Return a JSON array where each element has "front" (question/term), "back" (answer/definition), and "tags" (string array). Make cards progressively harder. Only return the JSON array, no other text.`;
    onSendToChat(prompt);
    setGenLoading(false);
    setShowGenerate(false);
    setGenTopic("");
  }, [genDeckId, genTopic, genCount, onSendToChat]);

  const handleImportFromChat = useCallback(() => {
    const prompt =
      "Extract key question-and-answer pairs from our conversation so far. Return a JSON array where each element has \"front\" (the question), \"back\" (the answer), and \"tags\" (string array). Only return the JSON array.";
    onSendToChat(prompt);
  }, [onSendToChat]);

  const stats = useMemo(() => fc.getStats(), [fc.getStats]);

  // ── Current study card ────────────────────────────────────────────

  const currentCard =
    fc.session && fc.session.currentIndex < fc.session.cards.length
      ? fc.session.cards[fc.session.currentIndex]
      : null;

  const sessionComplete = fc.session && fc.session.currentIndex >= fc.session.cards.length;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-blade-bg text-white">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.07)]/60">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (view === "study" || view === "editor" || view === "generate") {
                if (fc.session) fc.endSession();
                setView("decks");
              } else {
                onBack();
              }
            }}
            className="p-1.5 rounded-md hover:bg-[rgba(255,255,255,0.04)] transition-colors text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)]"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-sm font-semibold tracking-tight">
            {view === "decks" && "Flashcards"}
            {view === "study" && (fc.decks.find((d) => d.id === activeDeckId)?.name ?? "Study")}
            {view === "editor" && (editingCard ? "Edit Card" : "New Card")}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          {view === "decks" && (
            <>
              <button
                onClick={handleImportFromChat}
                className="px-2.5 py-1.5 text-xs rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] transition-colors text-[rgba(255,255,255,0.7)]"
              >
                Import from Chat
              </button>
              <button
                onClick={() => handleOpenEditor()}
                className="px-2.5 py-1.5 text-xs rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] transition-colors text-[rgba(255,255,255,0.7)]"
              >
                + Card
              </button>
              <button
                onClick={() => setShowNewDeck(true)}
                className="px-2.5 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 transition-colors text-white"
              >
                + Deck
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {/* ── Stats bar ──────────────────────────────────────────────── */}
        {view === "decks" && (
          <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.07)]/40 flex items-center gap-6 text-xs text-[rgba(255,255,255,0.4)]">
            <span>
              <span className="text-[rgba(255,255,255,0.7)] font-medium">{stats.totalCards}</span> cards
            </span>
            <span>
              <span className="text-amber-400 font-medium">{stats.dueToday}</span> due
            </span>
            <span>
              <span className="text-emerald-400 font-medium">{stats.masteredCards}</span> mastered
            </span>
            <span>
              <span className="text-[rgba(255,255,255,0.7)] font-medium">{stats.averageAccuracy}%</span> accuracy
            </span>
            {stats.streakDays > 0 && (
              <span>
                <span className="text-orange-400 font-medium">{stats.streakDays}</span> day streak
              </span>
            )}
          </div>
        )}

        {/* ── Deck browser ───────────────────────────────────────────── */}
        {view === "decks" && (
          <div className="p-4">
            {fc.decks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[rgba(255,255,255,0.4)]">
                <svg viewBox="0 0 24 24" className="w-12 h-12 mb-3 text-[rgba(255,255,255,0.2)]" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M3 9h18M9 3v18" />
                </svg>
                <p className="text-sm mb-1">No flashcard decks yet</p>
                <p className="text-xs text-[rgba(255,255,255,0.3)]">Create a deck to start studying</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fc.decks.map((deck) => (
                  <div
                    key={deck.id}
                    className="bg-blade-bg border border-[rgba(255,255,255,0.07)]/60 rounded-lg p-4 hover:border-[rgba(255,255,255,0.1)] transition-colors group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-md bg-[rgba(255,255,255,0.04)] flex items-center justify-center text-[rgba(255,255,255,0.5)] group-hover:text-blue-400 transition-colors">
                          <DeckIcon icon={deck.icon} className="w-4 h-4" />
                        </div>
                        <div>
                          <h3 className="text-sm font-medium text-[rgba(255,255,255,0.85)]">{deck.name}</h3>
                          {deck.description && (
                            <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5 line-clamp-1">{deck.description}</p>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => fc.deleteDeck(deck.id)}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] hover:text-red-400 transition-all"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                        </svg>
                      </button>
                    </div>

                    <div className="flex items-center gap-4 mb-3 text-xs text-[rgba(255,255,255,0.4)]">
                      <span>{deck.cardCount} cards</span>
                      <span className="text-amber-400/80">{deck.dueCount} due</span>
                      <span className="text-emerald-400/80">{deck.masteredCount} mastered</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                        Studied {formatRelative(deck.lastStudied)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setGenDeckId(deck.id);
                            setShowGenerate(true);
                          }}
                          className="px-2 py-1 text-[10px] rounded bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] transition-colors"
                        >
                          AI Generate
                        </button>
                        <button
                          onClick={() => handleStartStudy(deck.id)}
                          disabled={deck.dueCount === 0}
                          className="px-2.5 py-1 text-[10px] rounded bg-blue-600 hover:bg-blue-500 disabled:bg-[rgba(255,255,255,0.04)] disabled:text-[rgba(255,255,255,0.3)] text-white font-medium transition-colors"
                        >
                          Study Now{deck.dueCount > 0 ? ` (${deck.dueCount})` : ""}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Study session ──────────────────────────────────────────── */}
        {view === "study" && fc.session && !sessionComplete && currentCard && (
          <div className="flex flex-col items-center px-4 py-6 h-full">
            {/* Progress bar */}
            <div className="w-full max-w-xl mb-6">
              <div className="flex items-center justify-between mb-2 text-xs text-[rgba(255,255,255,0.4)]">
                <span>
                  Card {fc.session.currentIndex + 1} of {fc.session.cards.length}
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-emerald-400">{fc.session.correct} correct</span>
                  <span className="text-red-400">{fc.session.incorrect} incorrect</span>
                  <span className="text-[rgba(255,255,255,0.4)]">{fc.session.skipped} skipped</span>
                </div>
              </div>
              <div className="w-full h-1.5 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{
                    width: `${((fc.session.currentIndex) / fc.session.cards.length) * 100}%`,
                  }}
                />
              </div>
            </div>

            {/* Flashcard */}
            <div
              ref={cardRef}
              onClick={() => setFlipped((f) => !f)}
              className="w-full max-w-xl cursor-pointer select-none perspective-1000"
            >
              <div
                className={`relative w-full min-h-[280px] transition-transform duration-500 transform-style-3d ${
                  flipped ? "[transform:rotateY(180deg)]" : ""
                }`}
              >
                {/* Front */}
                <div className="absolute inset-0 backface-hidden bg-blade-bg border border-[rgba(255,255,255,0.07)]/60 rounded-xl p-8 flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)] mb-4">Question</span>
                  <p className="text-xl text-center font-medium text-white leading-relaxed">
                    {currentCard.front}
                  </p>
                  <span className="mt-6 text-[10px] text-[rgba(255,255,255,0.3)]">
                    Click or press Space to flip
                  </span>
                </div>

                {/* Back */}
                <div className="absolute inset-0 backface-hidden [transform:rotateY(180deg)] bg-blade-bg border border-blue-800/40 rounded-xl p-8 flex flex-col items-center justify-center">
                  <span className="text-[10px] uppercase tracking-widest text-blue-400/60 mb-4">Answer</span>
                  <p className="text-lg text-center text-[rgba(255,255,255,0.85)] leading-relaxed whitespace-pre-wrap">
                    {currentCard.back}
                  </p>
                </div>
              </div>
            </div>

            {/* Review buttons */}
            {flipped && (
              <div className="flex items-center gap-2 mt-6 w-full max-w-xl">
                {(["again", "hard", "good", "easy"] as ReviewRating[]).map((rating, i) => {
                  const colors: Record<ReviewRating, string> = {
                    again: "bg-red-900/40 hover:bg-red-900/60 text-red-300 border-red-800/40",
                    hard: "bg-orange-900/30 hover:bg-orange-900/50 text-orange-300 border-orange-800/40",
                    good: "bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-300 border-emerald-800/40",
                    easy: "bg-blue-900/30 hover:bg-blue-900/50 text-blue-300 border-blue-800/40",
                  };
                  const labels: Record<ReviewRating, string> = {
                    again: "Again",
                    hard: "Hard",
                    good: "Good",
                    easy: "Easy",
                  };
                  return (
                    <button
                      key={rating}
                      onClick={() => handleReview(rating)}
                      className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-colors ${colors[rating]}`}
                    >
                      <div>{labels[rating]}</div>
                      <div className="text-[10px] opacity-60 mt-0.5">
                        {getNextReviewLabel(currentCard.interval, rating)}
                      </div>
                      <div className="text-[10px] opacity-40 mt-0.5">[{i + 1}]</div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Card tags */}
            {currentCard.tags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-4">
                {currentCard.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.04)] text-[10px] text-[rgba(255,255,255,0.4)]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Edit card link */}
            <button
              onClick={() => handleOpenEditor(currentCard)}
              className="mt-3 text-[10px] text-[rgba(255,255,255,0.3)] hover:text-[rgba(255,255,255,0.5)] transition-colors"
            >
              Edit this card
            </button>
          </div>
        )}

        {/* ── Session complete ───────────────────────────────────────── */}
        {view === "study" && fc.session && sessionComplete && (
          <div className="flex flex-col items-center justify-center px-4 py-16">
            <div className="w-16 h-16 rounded-full bg-emerald-900/30 border border-emerald-800/40 flex items-center justify-center mb-4">
              <svg viewBox="0 0 24 24" className="w-8 h-8 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-white mb-1">Session Complete!</h2>
            <p className="text-sm text-[rgba(255,255,255,0.4)] mb-6">
              Great work studying{" "}
              {fc.decks.find((d) => d.id === activeDeckId)?.name ?? "this deck"}.
            </p>

            <div className="grid grid-cols-3 gap-4 mb-8 w-full max-w-sm">
              <div className="bg-blade-bg border border-[rgba(255,255,255,0.07)]/60 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-400">{fc.session.correct}</div>
                <div className="text-[10px] text-[rgba(255,255,255,0.4)] mt-1">Correct</div>
              </div>
              <div className="bg-blade-bg border border-[rgba(255,255,255,0.07)]/60 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-red-400">{fc.session.incorrect}</div>
                <div className="text-[10px] text-[rgba(255,255,255,0.4)] mt-1">Incorrect</div>
              </div>
              <div className="bg-blade-bg border border-[rgba(255,255,255,0.07)]/60 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-[rgba(255,255,255,0.7)]">
                  {formatDuration(Date.now() - fc.session.startedAt)}
                </div>
                <div className="text-[10px] text-[rgba(255,255,255,0.4)] mt-1">Time</div>
              </div>
            </div>

            {fc.session.correct + fc.session.incorrect > 0 && (
              <div className="mb-6 w-full max-w-sm">
                <div className="flex items-center justify-between text-xs text-[rgba(255,255,255,0.4)] mb-1">
                  <span>Score</span>
                  <span>
                    {Math.round(
                      (fc.session.correct / (fc.session.correct + fc.session.incorrect)) * 100,
                    )}
                    %
                  </span>
                </div>
                <div className="w-full h-2 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full"
                    style={{
                      width: `${(fc.session.correct / (fc.session.correct + fc.session.incorrect)) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  fc.endSession();
                  setView("decks");
                }}
                className="px-4 py-2 text-sm rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
              >
                Back to Decks
              </button>
              <button
                onClick={() => {
                  fc.endSession();
                  if (activeDeckId) handleStartStudy(activeDeckId);
                }}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors"
              >
                Study Again
              </button>
            </div>
          </div>
        )}

        {/* ── Card editor ────────────────────────────────────────────── */}
        {view === "editor" && (
          <div className="p-4 max-w-xl mx-auto">
            <div className="space-y-4">
              {/* Deck selector */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Deck</label>
                <select
                  value={editDeckId}
                  onChange={(e) => setEditDeckId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded-md text-[rgba(255,255,255,0.85)] focus:outline-none focus:border-[rgba(255,255,255,0.15)]"
                >
                  <option value="">Select deck...</option>
                  {fc.decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Front */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Front (Question / Term)</label>
                <textarea
                  value={editFront}
                  onChange={(e) => setEditFront(e.target.value)}
                  rows={3}
                  placeholder="Enter the question or term..."
                  className="w-full px-3 py-2 text-sm bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded-md text-[rgba(255,255,255,0.85)] placeholder-zinc-600 focus:outline-none focus:border-[rgba(255,255,255,0.15)] resize-none"
                />
              </div>

              {/* Back */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Back (Answer / Definition)</label>
                <textarea
                  value={editBack}
                  onChange={(e) => setEditBack(e.target.value)}
                  rows={4}
                  placeholder="Enter the answer or definition..."
                  className="w-full px-3 py-2 text-sm bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded-md text-[rgba(255,255,255,0.85)] placeholder-zinc-600 focus:outline-none focus:border-[rgba(255,255,255,0.15)] resize-none"
                />
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1.5">Tags (comma separated)</label>
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="e.g. react, hooks, basics"
                  className="w-full px-3 py-2 text-sm bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded-md text-[rgba(255,255,255,0.85)] placeholder-zinc-600 focus:outline-none focus:border-[rgba(255,255,255,0.15)]"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  {editingCard && (
                    <button
                      onClick={() => {
                        fc.deleteCard(editingCard.id);
                        setView("decks");
                      }}
                      className="px-3 py-1.5 text-xs rounded-md text-red-400 hover:bg-red-900/20 transition-colors"
                    >
                      Delete Card
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setView("decks")}
                    className="px-3 py-1.5 text-xs rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveCard}
                    disabled={!editFront.trim() || !editBack.trim() || !editDeckId}
                    className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-[rgba(255,255,255,0.04)] disabled:text-[rgba(255,255,255,0.3)] text-white transition-colors"
                  >
                    {editingCard ? "Save Changes" : "Add Card"}
                  </button>
                </div>
              </div>
            </div>

            {/* Preview */}
            {(editFront.trim() || editBack.trim()) && (
              <div className="mt-6 border-t border-[rgba(255,255,255,0.07)]/40 pt-4">
                <p className="text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)] mb-3">Preview</p>
                <div className="bg-blade-bg border border-[rgba(255,255,255,0.07)]/60 rounded-xl p-6 text-center">
                  <p className="text-lg font-medium text-white mb-4">
                    {editFront || "Front side"}
                  </p>
                  <div className="w-12 h-px bg-[rgba(255,255,255,0.04)] mx-auto mb-4" />
                  <p className="text-sm text-[rgba(255,255,255,0.5)]">{editBack || "Back side"}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── New Deck Modal ───────────────────────────────────────────── */}
      {showNewDeck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded-xl p-5 w-full max-w-sm mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.85)] mb-4">Create New Deck</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1">Name</label>
                <input
                  value={newDeckName}
                  onChange={(e) => setNewDeckName(e.target.value)}
                  placeholder="e.g. JavaScript Fundamentals"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleCreateDeck()}
                  className="w-full px-3 py-2 text-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md text-[rgba(255,255,255,0.85)] placeholder-zinc-600 focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1">Description (optional)</label>
                <input
                  value={newDeckDesc}
                  onChange={(e) => setNewDeckDesc(e.target.value)}
                  placeholder="What is this deck about?"
                  className="w-full px-3 py-2 text-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md text-[rgba(255,255,255,0.85)] placeholder-zinc-600 focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowNewDeck(false)}
                className="px-3 py-1.5 text-xs rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateDeck}
                disabled={!newDeckName.trim()}
                className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-[rgba(255,255,255,0.04)] disabled:text-[rgba(255,255,255,0.3)] text-white transition-colors"
              >
                Create Deck
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Generate Modal ───────────────────────────────────────────── */}
      {showGenerate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-blade-bg border border-[rgba(255,255,255,0.07)] rounded-xl p-5 w-full max-w-md mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.85)] mb-1">AI Generate Flashcards</h3>
            <p className="text-xs text-[rgba(255,255,255,0.4)] mb-4">
              Enter a topic and the AI will create flashcards for you.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1">Topic</label>
                <input
                  value={genTopic}
                  onChange={(e) => setGenTopic(e.target.value)}
                  placeholder="e.g. React hooks, Photosynthesis, WW2 battles"
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
                  className="w-full px-3 py-2 text-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md text-[rgba(255,255,255,0.85)] placeholder-zinc-600 focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
                />
              </div>
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1">
                  Number of cards: <span className="text-[rgba(255,255,255,0.7)] font-medium">{genCount}</span>
                </label>
                <input
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  value={genCount}
                  onChange={(e) => setGenCount(Number(e.target.value))}
                  className="w-full accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">
                  <span>5</span>
                  <span>50</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[rgba(255,255,255,0.4)] mb-1">Deck</label>
                <select
                  value={genDeckId ?? ""}
                  onChange={(e) => setGenDeckId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-md text-[rgba(255,255,255,0.85)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
                >
                  {fc.decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setShowGenerate(false);
                  setGenTopic("");
                }}
                className="px-3 py-1.5 text-xs rounded-md bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!genTopic.trim() || genLoading}
                className="px-3 py-1.5 text-xs rounded-md bg-blue-600 hover:bg-blue-500 disabled:bg-[rgba(255,255,255,0.04)] disabled:text-[rgba(255,255,255,0.3)] text-white transition-colors flex items-center gap-1.5"
              >
                {genLoading ? (
                  <>
                    <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
                      <path d="M12 2a10 10 0 019.95 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    Generating...
                  </>
                ) : (
                  "Generate & Send to Chat"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
