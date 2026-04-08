import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: "auto" | "manual" | "pinned";
  conversationId?: string;
  createdAt: number;
  updatedAt: number;
}

interface KnowledgeStats {
  totalEntries: number;
  totalTags: number;
  recentlyAdded: number;
}

interface TagCount {
  tag: string;
  count: number;
}

const STORAGE_KEY = "blade-knowledge";

// ── Auto-tag detection dictionaries ──────────────────────────────────

const LANGUAGES = [
  "JavaScript", "TypeScript", "Python", "Rust", "Go", "Java", "C", "C++",
  "C#", "Ruby", "PHP", "Swift", "Kotlin", "Dart", "Scala", "Elixir",
  "Haskell", "Lua", "Perl", "R", "SQL", "HTML", "CSS", "SCSS", "Sass",
  "Shell", "Bash", "PowerShell", "Zig", "OCaml", "Clojure", "Julia",
  "WASM", "WebAssembly", "GraphQL", "YAML", "JSON", "TOML", "Markdown",
];

const FRAMEWORKS = [
  "React", "Vue", "Angular", "Svelte", "Next.js", "Nuxt", "Remix",
  "Astro", "SolidJS", "Preact", "Django", "Flask", "FastAPI", "Express",
  "Nest.js", "Spring", "Rails", "Laravel", "Gin", "Actix", "Axum",
  "Rocket", "Tokio", "Tauri", "Electron", "React Native", "Flutter",
  "SwiftUI", "Jetpack Compose", "Tailwind", "Bootstrap", "Material UI",
  "Chakra UI", "Prisma", "Drizzle", "Mongoose", "SQLAlchemy",
  "TensorFlow", "PyTorch", "LangChain", "Vite", "Webpack", "esbuild",
  "Turbopack", "SWC",
];

const TOOLS = [
  "Docker", "Kubernetes", "Git", "GitHub", "GitLab", "AWS", "Azure",
  "GCP", "Vercel", "Netlify", "Cloudflare", "Supabase", "Firebase",
  "Redis", "PostgreSQL", "MySQL", "MongoDB", "SQLite", "Elasticsearch",
  "Kafka", "RabbitMQ", "Nginx", "Terraform", "Ansible", "Jenkins",
  "CircleCI", "npm", "yarn", "pnpm", "Bun", "Deno", "Node.js",
  "Homebrew", "Linux", "macOS", "Windows", "VS Code", "Neovim", "Vim",
  "Figma", "Postman", "Grafana", "Prometheus", "Sentry", "Datadog",
  "Stripe", "Auth0", "Clerk", "S3", "Lambda", "EC2", "CloudFront",
];

const CONCEPTS = [
  "API", "REST", "gRPC", "WebSocket", "OAuth", "JWT", "auth",
  "authentication", "authorization", "database", "cache", "queue",
  "microservice", "monolith", "serverless", "CI/CD", "testing",
  "unit test", "integration test", "e2e", "deployment", "migration",
  "refactor", "performance", "optimization", "security", "encryption",
  "hashing", "middleware", "proxy", "load balancer", "CDN", "SSR", "SSG",
  "ISR", "CSR", "hydration", "state management", "dependency injection",
  "singleton", "factory", "observer", "pub/sub", "event-driven",
  "functional programming", "OOP", "concurrency", "async", "promise",
  "stream", "iterator", "generator", "type system", "generics",
  "polymorphism", "inheritance", "composition", "monorepo", "design system",
  "accessibility", "a11y", "i18n", "localization", "SEO", "analytics",
  "logging", "monitoring", "debugging", "profiling", "memory leak",
  "race condition", "deadlock", "CORS", "CSP", "XSS", "CSRF",
  "rate limiting", "pagination", "cursor", "webhook", "cron",
  "environment variable", "secret management", "IaC",
];

function buildTagSet(): Map<string, string> {
  const map = new Map<string, string>();
  for (const lang of LANGUAGES) map.set(lang.toLowerCase(), lang);
  for (const fw of FRAMEWORKS) map.set(fw.toLowerCase(), fw);
  for (const tool of TOOLS) map.set(tool.toLowerCase(), tool);
  for (const concept of CONCEPTS) map.set(concept.toLowerCase(), concept);
  return map;
}

const TAG_LOOKUP = buildTagSet();

function extractAutoTags(title: string, content: string): string[] {
  const combined = `${title} ${content}`.toLowerCase();
  const found: string[] = [];

  for (const [key, canonical] of TAG_LOOKUP) {
    // Word-boundary check: make sure the match isn't a substring of a larger word
    // For short keys (<=2 chars like "C", "R") require exact word boundary
    if (key.length <= 2) {
      const regex = new RegExp(`\\b${escapeRegex(key)}\\b`, "i");
      if (regex.test(combined)) {
        found.push(canonical);
      }
    } else {
      if (combined.includes(key)) {
        found.push(canonical);
      }
    }
  }

  return found;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Persistence helpers ──────────────────────────────────────────────

function loadFromStorage(): KnowledgeEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: KnowledgeEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ── Search scoring ───────────────────────────────────────────────────

function scoreEntry(entry: KnowledgeEntry, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  const terms = q.split(/\s+/).filter(Boolean);
  let score = 0;

  const titleLower = entry.title.toLowerCase();
  const contentLower = entry.content.toLowerCase();
  const tagsLower = entry.tags.map((t) => t.toLowerCase());

  for (const term of terms) {
    // Title match: highest weight
    if (titleLower.includes(term)) {
      score += 100;
      // Bonus for exact title match
      if (titleLower === q) score += 200;
      // Bonus for title starting with query
      if (titleLower.startsWith(term)) score += 50;
    }

    // Tag match: second highest
    for (const tag of tagsLower) {
      if (tag === term) {
        score += 80;
      } else if (tag.includes(term)) {
        score += 40;
      }
    }

    // Content match: lower weight
    if (contentLower.includes(term)) {
      score += 20;
      // Bonus for multiple occurrences (up to 5)
      const occurrences = contentLower.split(term).length - 1;
      score += Math.min(occurrences, 5) * 3;
    }
  }

  // Recency bonus: entries updated in the last 7 days get a small boost
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (entry.updatedAt > weekAgo) {
    score += 5;
  }

  return score;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useKnowledgeBase() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>(() => loadFromStorage());
  const entriesRef = useRef(entries);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  // Persist on every change
  useEffect(() => {
    saveToStorage(entries);
  }, [entries]);

  // Listen for cross-tab / external changes
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        const next = loadFromStorage();
        setEntries(next);
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const addEntry = useCallback(
    (
      partial: Omit<KnowledgeEntry, "id" | "createdAt" | "updatedAt" | "tags"> & {
        tags?: string[];
      }
    ): KnowledgeEntry => {
      const now = Date.now();
      const autoTags = extractAutoTags(partial.title, partial.content);
      const manualTags = (partial.tags ?? []).map((t) => t.trim()).filter(Boolean);

      // Deduplicate tags, preserving manual first
      const tagSet = new Set<string>();
      const finalTags: string[] = [];
      for (const tag of [...manualTags, ...autoTags]) {
        const lower = tag.toLowerCase();
        if (!tagSet.has(lower)) {
          tagSet.add(lower);
          finalTags.push(tag);
        }
      }

      const entry: KnowledgeEntry = {
        id: crypto.randomUUID(),
        title: partial.title,
        content: partial.content,
        tags: finalTags,
        source: partial.source,
        conversationId: partial.conversationId,
        createdAt: now,
        updatedAt: now,
      };

      setEntries((prev) => [entry, ...prev]);
      return entry;
    },
    []
  );

  const updateEntry = useCallback(
    (
      id: string,
      updates: Partial<Pick<KnowledgeEntry, "title" | "content" | "tags" | "source">>
    ) => {
      setEntries((prev) =>
        prev.map((entry) => {
          if (entry.id !== id) return entry;

          const nextTitle = updates.title ?? entry.title;
          const nextContent = updates.content ?? entry.content;

          // Re-extract auto-tags when content or title changes
          let nextTags = updates.tags ?? entry.tags;
          if (updates.title !== undefined || updates.content !== undefined) {
            const autoTags = extractAutoTags(nextTitle, nextContent);
            const manualTags = (updates.tags ?? entry.tags).map((t) => t.trim()).filter(Boolean);
            const tagSet = new Set<string>();
            const finalTags: string[] = [];
            for (const tag of [...manualTags, ...autoTags]) {
              const lower = tag.toLowerCase();
              if (!tagSet.has(lower)) {
                tagSet.add(lower);
                finalTags.push(tag);
              }
            }
            nextTags = finalTags;
          }

          return {
            ...entry,
            ...updates,
            tags: nextTags,
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  const deleteEntry = useCallback((id: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const searchEntries = useCallback(
    (query: string): KnowledgeEntry[] => {
      const q = query.trim();
      if (!q) return entriesRef.current;

      return entriesRef.current
        .map((entry) => ({ entry, score: scoreEntry(entry, q) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ entry }) => entry);
    },
    []
  );

  const getTags = useCallback((): TagCount[] => {
    const counts = new Map<string, number>();
    for (const entry of entriesRef.current) {
      for (const tag of entry.tags) {
        const lower = tag.toLowerCase();
        counts.set(lower, (counts.get(lower) ?? 0) + 1);
      }
    }

    // Build sorted array (most frequent first), preserving original casing
    const tagCasing = new Map<string, string>();
    for (const entry of entriesRef.current) {
      for (const tag of entry.tags) {
        const lower = tag.toLowerCase();
        if (!tagCasing.has(lower)) tagCasing.set(lower, tag);
      }
    }

    return Array.from(counts.entries())
      .map(([lower, count]) => ({ tag: tagCasing.get(lower) ?? lower, count }))
      .sort((a, b) => b.count - a.count);
  }, []);

  const getByTag = useCallback(
    (tag: string): KnowledgeEntry[] => {
      const lower = tag.toLowerCase();
      return entriesRef.current.filter((entry) =>
        entry.tags.some((t) => t.toLowerCase() === lower)
      );
    },
    []
  );

  const stats = useMemo((): KnowledgeStats => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const uniqueTags = new Set<string>();
    let recentlyAdded = 0;

    for (const entry of entries) {
      for (const tag of entry.tags) {
        uniqueTags.add(tag.toLowerCase());
      }
      if (entry.createdAt > weekAgo) {
        recentlyAdded++;
      }
    }

    return {
      totalEntries: entries.length,
      totalTags: uniqueTags.size,
      recentlyAdded,
    };
  }, [entries]);

  return {
    entries,
    addEntry,
    updateEntry,
    deleteEntry,
    searchEntries,
    getTags,
    getByTag,
    stats,
  };
}
