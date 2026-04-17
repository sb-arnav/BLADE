import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  deckId: string;
  tags: string[];
  difficulty: number;
  interval: number;
  nextReview: number;
  reviewCount: number;
  correctCount: number;
  lastReviewed: number | null;
  createdAt: number;
  source: "manual" | "ai" | "conversation";
}

export interface FlashcardDeck {
  id: string;
  name: string;
  icon: string;
  description: string;
  cardCount: number;
  dueCount: number;
  masteredCount: number;
  createdAt: number;
  lastStudied: number | null;
}

export interface ReviewSession {
  deckId: string;
  cards: Flashcard[];
  currentIndex: number;
  correct: number;
  incorrect: number;
  skipped: number;
  startedAt: number;
}

export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface FlashcardStats {
  totalCards: number;
  totalDecks: number;
  dueToday: number;
  masteredCards: number;
  averageAccuracy: number;
  totalReviews: number;
  streakDays: number;
  reviewsByDay: { date: string; count: number }[];
}

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-flashcards";
const MASTERED_INTERVAL = 21; // days
const DAY_MS = 86_400_000;

const DEFAULT_DECK_ICONS = [
  "brain", "book", "code", "flask", "globe",
  "music", "math", "language", "star", "lightning",
];

// ── SM-2 Algorithm ─────────────────────────────────────────────────────

function sm2(card: Flashcard, rating: ReviewRating): Partial<Flashcard> {
  const now = Date.now();
  let { difficulty, interval, reviewCount, correctCount } = card;

  reviewCount += 1;

  switch (rating) {
    case "easy":
      interval = Math.max(1, interval) * 2.5;
      difficulty = Math.max(0.1, difficulty - 0.15);
      correctCount += 1;
      break;
    case "good":
      interval = Math.max(1, interval) * 2.0;
      difficulty = Math.max(0.1, difficulty - 0.05);
      correctCount += 1;
      break;
    case "hard":
      interval = Math.max(1, interval) * 1.2;
      difficulty = Math.min(1.0, difficulty + 0.15);
      break;
    case "again":
      interval = 1;
      difficulty = Math.min(1.0, difficulty + 0.3);
      break;
  }

  interval = Math.round(interval * 100) / 100;

  return {
    difficulty,
    interval,
    reviewCount,
    correctCount,
    lastReviewed: now,
    nextReview: now + interval * DAY_MS,
  };
}

function getNextReviewLabel(interval: number, rating: ReviewRating): string {
  let next: number;
  switch (rating) {
    case "easy": next = Math.max(1, interval) * 2.5; break;
    case "good": next = Math.max(1, interval) * 2.0; break;
    case "hard": next = Math.max(1, interval) * 1.2; break;
    case "again": next = 1; break;
  }
  next = Math.round(next);
  if (next < 1) return "< 1 day";
  if (next === 1) return "1 day";
  if (next < 30) return `${next} days`;
  if (next < 365) return `${Math.round(next / 30)} mo`;
  return `${(next / 365).toFixed(1)} yr`;
}

// ── Persistence helpers ────────────────────────────────────────────────

interface StoredData {
  decks: FlashcardDeck[];
  cards: Flashcard[];
  lastStudyDate: string | null;
  streakDays: number;
}

function loadData(): StoredData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore corrupt data */ }
  return { decks: [], cards: [], lastStudyDate: null, streakDays: 0 };
}

function saveData(data: StoredData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* storage full */ }
}

// ── ID helper ──────────────────────────────────────────────────────────

function uid(): string {
  return `fc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useFlashcards() {
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [streakDays, setStreakDays] = useState(0);
  const [lastStudyDate, setLastStudyDate] = useState<string | null>(null);
  const initRef = useRef(false);

  // Load from storage on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const data = loadData();
    setDecks(data.decks);
    setCards(data.cards);
    setStreakDays(data.streakDays);
    setLastStudyDate(data.lastStudyDate);
  }, []);

  // Persist whenever state changes
  useEffect(() => {
    if (!initRef.current) return;
    saveData({ decks, cards, lastStudyDate, streakDays });
  }, [decks, cards, lastStudyDate, streakDays]);

  // ── Deck helpers ────────────────────────────────────────────────────

  const recomputeDeckCounts = useCallback(
    (allCards: Flashcard[], allDecks: FlashcardDeck[]): FlashcardDeck[] => {
      const now = Date.now();
      return allDecks.map((d) => {
        const deckCards = allCards.filter((c) => c.deckId === d.id);
        return {
          ...d,
          cardCount: deckCards.length,
          dueCount: deckCards.filter((c) => c.nextReview <= now).length,
          masteredCount: deckCards.filter((c) => c.interval > MASTERED_INTERVAL).length,
        };
      });
    },
    [],
  );

  // ── Deck CRUD ───────────────────────────────────────────────────────

  const createDeck = useCallback(
    (name: string, description = "", icon?: string) => {
      const deck: FlashcardDeck = {
        id: uid(),
        name,
        icon: icon ?? DEFAULT_DECK_ICONS[Math.floor(Math.random() * DEFAULT_DECK_ICONS.length)],
        description,
        cardCount: 0,
        dueCount: 0,
        masteredCount: 0,
        createdAt: Date.now(),
        lastStudied: null,
      };
      setDecks((prev) => [...prev, deck]);
      return deck;
    },
    [],
  );

  const deleteDeck = useCallback((deckId: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    setCards((prev) => prev.filter((c) => c.deckId !== deckId));
  }, []);

  // ── Card CRUD ───────────────────────────────────────────────────────

  const addCard = useCallback(
    (
      deckId: string,
      front: string,
      back: string,
      tags: string[] = [],
      source: Flashcard["source"] = "manual",
    ) => {
      const card: Flashcard = {
        id: uid(),
        front,
        back,
        deckId,
        tags,
        difficulty: 0.5,
        interval: 0,
        nextReview: Date.now(),
        reviewCount: 0,
        correctCount: 0,
        lastReviewed: null,
        createdAt: Date.now(),
        source,
      };
      setCards((prev) => {
        const next = [...prev, card];
        setDecks((d) => recomputeDeckCounts(next, d));
        return next;
      });
      return card;
    },
    [recomputeDeckCounts],
  );

  const addCards = useCallback(
    (
      deckId: string,
      items: { front: string; back: string; tags?: string[] }[],
      source: Flashcard["source"] = "ai",
    ) => {
      const newCards: Flashcard[] = items.map((item) => ({
        id: uid(),
        front: item.front,
        back: item.back,
        deckId,
        tags: item.tags ?? [],
        difficulty: 0.5,
        interval: 0,
        nextReview: Date.now(),
        reviewCount: 0,
        correctCount: 0,
        lastReviewed: null,
        createdAt: Date.now(),
        source,
      }));
      setCards((prev) => {
        const next = [...prev, ...newCards];
        setDecks((d) => recomputeDeckCounts(next, d));
        return next;
      });
      return newCards;
    },
    [recomputeDeckCounts],
  );

  const updateCard = useCallback(
    (cardId: string, updates: Partial<Pick<Flashcard, "front" | "back" | "tags" | "deckId">>) => {
      setCards((prev) => {
        const next = prev.map((c) => (c.id === cardId ? { ...c, ...updates } : c));
        setDecks((d) => recomputeDeckCounts(next, d));
        return next;
      });
    },
    [recomputeDeckCounts],
  );

  const deleteCard = useCallback(
    (cardId: string) => {
      setCards((prev) => {
        const next = prev.filter((c) => c.id !== cardId);
        setDecks((d) => recomputeDeckCounts(next, d));
        return next;
      });
    },
    [recomputeDeckCounts],
  );

  // ── Review ──────────────────────────────────────────────────────────

  const getDueCards = useCallback(
    (deckId: string): Flashcard[] => {
      const now = Date.now();
      return cards
        .filter((c) => c.deckId === deckId && c.nextReview <= now)
        .sort((a, b) => a.nextReview - b.nextReview);
    },
    [cards],
  );

  const startReview = useCallback(
    (deckId: string, limit = 20): ReviewSession | null => {
      const due = getDueCards(deckId);
      if (due.length === 0) return null;
      const sessionCards = due.slice(0, limit);
      const s: ReviewSession = {
        deckId,
        cards: sessionCards,
        currentIndex: 0,
        correct: 0,
        incorrect: 0,
        skipped: 0,
        startedAt: Date.now(),
      };
      setSession(s);

      // Update streak
      const today = new Date().toISOString().slice(0, 10);
      setLastStudyDate((prev) => {
        if (prev === today) return prev;
        const yesterday = new Date(Date.now() - DAY_MS).toISOString().slice(0, 10);
        if (prev === yesterday) {
          setStreakDays((s) => s + 1);
        } else {
          setStreakDays(1);
        }
        return today;
      });

      // Update deck lastStudied
      setDecks((prev) =>
        prev.map((d) => (d.id === deckId ? { ...d, lastStudied: Date.now() } : d)),
      );

      return s;
    },
    [getDueCards],
  );

  const reviewCard = useCallback(
    (cardId: string, rating: ReviewRating) => {
      setCards((prev) => {
        const next = prev.map((c) => {
          if (c.id !== cardId) return c;
          return { ...c, ...sm2(c, rating) };
        });
        setDecks((d) => recomputeDeckCounts(next, d));
        return next;
      });

      setSession((prev) => {
        if (!prev) return null;
        const isCorrect = rating === "good" || rating === "easy";
        const isSkipped = false;
        return {
          ...prev,
          currentIndex: prev.currentIndex + 1,
          correct: prev.correct + (isCorrect ? 1 : 0),
          incorrect: prev.incorrect + (!isCorrect && !isSkipped ? 1 : 0),
          skipped: prev.skipped + (isSkipped ? 1 : 0),
        };
      });
    },
    [recomputeDeckCounts],
  );

  const skipCard = useCallback(() => {
    setSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        currentIndex: prev.currentIndex + 1,
        skipped: prev.skipped + 1,
      };
    });
  }, []);

  const endSession = useCallback(() => {
    setSession(null);
  }, []);

  // ── AI Generation ───────────────────────────────────────────────────

  const generateFromTopic = useCallback(
    async (
      _deckId: string,
      topic: string,
      count: number = 10,
    ): Promise<{ front: string; back: string; tags: string[] }[]> => {
      // Build a prompt that asks the AI to produce JSON flashcards.
      // The caller should pipe this into the chat/AI system.
      // Here we return a structured prompt + placeholder for preview.
      const prompt = [
        `Generate exactly ${count} flashcards about "${topic}".`,
        `Return a JSON array where each element has "front" (question/term), "back" (answer/definition), and "tags" (string array).`,
        `Make cards progressively harder. Cover key concepts, definitions, examples, and edge cases.`,
        `Only return the JSON array, no other text.`,
      ].join(" ");

      // In a real integration this calls the AI model; for now return the prompt
      // so the UI can send it to the chat system.
      return [{ front: prompt, back: "__prompt__", tags: ["__generate__"] }];
    },
    [],
  );

  const generateFromConversation = useCallback(
    (
      messages: { role: string; content: string }[],
    ): { front: string; back: string; tags: string[] }[] => {
      // Extract Q&A pairs heuristically from conversation messages
      const pairs: { front: string; back: string; tags: string[] }[] = [];
      for (let i = 0; i < messages.length - 1; i++) {
        const msg = messages[i];
        const next = messages[i + 1];
        if (
          msg.role === "user" &&
          next.role === "assistant" &&
          msg.content.length > 10 &&
          msg.content.length < 500 &&
          next.content.length > 20
        ) {
          const front = msg.content.trim();
          // Truncate long answers to a reasonable flashcard size
          let back = next.content.trim();
          if (back.length > 600) {
            back = back.slice(0, 597) + "...";
          }
          pairs.push({ front, back, tags: ["conversation"] });
        }
      }
      return pairs;
    },
    [],
  );

  // ── Import / Export ─────────────────────────────────────────────────

  const importCards = useCallback(
    (deckId: string, data: { front: string; back: string; tags?: string[] }[]) => {
      return addCards(deckId, data, "manual");
    },
    [addCards],
  );

  const exportDeck = useCallback(
    (deckId: string): string => {
      const deck = decks.find((d) => d.id === deckId);
      const deckCards = cards.filter((c) => c.deckId === deckId);
      return JSON.stringify({ deck, cards: deckCards }, null, 2);
    },
    [decks, cards],
  );

  // ── Stats ───────────────────────────────────────────────────────────

  const getStats = useCallback((): FlashcardStats => {
    const now = Date.now();
    const totalReviews = cards.reduce((s, c) => s + c.reviewCount, 0);
    const totalCorrect = cards.reduce((s, c) => s + c.correctCount, 0);
    const mastered = cards.filter((c) => c.interval > MASTERED_INTERVAL).length;

    // Reviews by day (last 14 days)
    const reviewsByDay: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * DAY_MS);
      const dateStr = d.toISOString().slice(0, 10);
      const dayStart = new Date(dateStr).getTime();
      const dayEnd = dayStart + DAY_MS;
      const count = cards.filter(
        (c) => c.lastReviewed && c.lastReviewed >= dayStart && c.lastReviewed < dayEnd,
      ).length;
      reviewsByDay.push({ date: dateStr, count });
    }

    return {
      totalCards: cards.length,
      totalDecks: decks.length,
      dueToday: cards.filter((c) => c.nextReview <= now).length,
      masteredCards: mastered,
      averageAccuracy: totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0,
      totalReviews,
      streakDays,
      reviewsByDay,
    };
  }, [cards, decks, streakDays]);

  // ── Computed ────────────────────────────────────────────────────────

  const computedDecks = useMemo(() => {
    const now = Date.now();
    return decks.map((d) => {
      const dc = cards.filter((c) => c.deckId === d.id);
      return {
        ...d,
        cardCount: dc.length,
        dueCount: dc.filter((c) => c.nextReview <= now).length,
        masteredCount: dc.filter((c) => c.interval > MASTERED_INTERVAL).length,
      };
    });
  }, [decks, cards]);

  return {
    decks: computedDecks,
    cards,
    session,
    createDeck,
    deleteDeck,
    addCard,
    addCards,
    updateCard,
    deleteCard,
    startReview,
    reviewCard,
    skipCard,
    endSession,
    getDueCards,
    generateFromTopic,
    generateFromConversation,
    importCards,
    exportDeck,
    getStats,
    getNextReviewLabel,
  };
}

export { getNextReviewLabel };
