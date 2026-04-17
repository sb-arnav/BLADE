import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Types ───────────────────────────────────────────────────────────

export type PathCategory =
  | "programming"
  | "devops"
  | "design"
  | "data"
  | "ai"
  | "business"
  | "custom";

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  category: PathCategory;
  icon: string;
  modules: LearningModule[];
  progress: number; // 0-100
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface LearningModule {
  id: string;
  title: string;
  type: "lesson" | "exercise" | "quiz" | "project";
  content: string; // prompt to generate lesson content
  completed: boolean;
  score: number | null; // for quizzes
  notes: string;
  completedAt: number | null;
}

export interface LearningStats {
  totalPaths: number;
  completedPaths: number;
  totalModules: number;
  completedModules: number;
  averageQuizScore: number;
  streakDays: number;
  totalTimeEstimate: string;
}

// ── Storage ─────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-learning";

function loadFromStorage(): LearningPath[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(paths: LearningPath[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
}

// ── Helpers ─────────────────────────────────────────────────────────

function makeModule(
  title: string,
  type: LearningModule["type"],
  content: string
): LearningModule {
  return {
    id: crypto.randomUUID(),
    title,
    type,
    content,
    completed: false,
    score: null,
    notes: "",
    completedAt: null,
  };
}

function makePath(
  title: string,
  description: string,
  category: PathCategory,
  icon: string,
  modules: LearningModule[]
): LearningPath {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    title,
    description,
    category,
    icon,
    modules,
    progress: 0,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function calcProgress(modules: LearningModule[]): number {
  if (modules.length === 0) return 0;
  const done = modules.filter((m) => m.completed).length;
  return Math.round((done / modules.length) * 100);
}

// ── Built-in learning paths ─────────────────────────────────────────

function getBuiltInPaths(): LearningPath[] {
  return [
    makePath(
      "TypeScript Mastery",
      "Master TypeScript from basic types to advanced generic patterns and utility types.",
      "programming",
      "🔷",
      [
        makeModule("Type System Foundations", "lesson", "Teach TypeScript type system fundamentals: primitive types, union types, intersection types, literal types, and type narrowing with practical examples."),
        makeModule("Interfaces & Type Aliases", "lesson", "Explain TypeScript interfaces vs type aliases, declaration merging, extending interfaces, and when to use each with real-world patterns."),
        makeModule("Generics Deep Dive", "lesson", "Teach TypeScript generics: generic functions, generic classes, constraints, default type parameters, and conditional types with progressively complex examples."),
        makeModule("Utility Types Workshop", "exercise", "Create exercises for TypeScript built-in utility types: Partial, Required, Pick, Omit, Record, Exclude, Extract, ReturnType, Parameters. Provide problems where the user must construct the correct type."),
        makeModule("Advanced Type Challenges", "quiz", "Generate 5 multiple-choice questions testing advanced TypeScript concepts: mapped types, template literal types, infer keyword, recursive types, and discriminated unions."),
        makeModule("Type-Safe API Layer", "project", "Guide building a fully type-safe API client with TypeScript: typed fetch wrapper, response validation with Zod, generic request/response types, and error handling types."),
      ]
    ),
    makePath(
      "Rust for JS Developers",
      "Learn Rust through the lens of JavaScript — ownership, lifetimes, traits, and async.",
      "programming",
      "🦀",
      [
        makeModule("Ownership & Borrowing", "lesson", "Explain Rust ownership, borrowing, and move semantics to a JavaScript developer. Compare to JS garbage collection. Use analogies and concrete code examples."),
        makeModule("Structs, Enums & Pattern Matching", "lesson", "Teach Rust structs, enums, impl blocks, and pattern matching. Compare to JS objects and switch statements. Show how enums replace null/undefined."),
        makeModule("Lifetimes Explained", "lesson", "Explain Rust lifetimes to a JS developer: why they exist, lifetime annotations, lifetime elision rules, and common patterns. Use diagrams and analogies."),
        makeModule("Traits & Generics", "lesson", "Teach Rust traits and generics: trait definitions, implementations, trait bounds, associated types, and dynamic dispatch. Compare to TypeScript interfaces."),
        makeModule("Error Handling", "exercise", "Create exercises on Rust error handling: Result, Option, the ? operator, custom error types, and thiserror/anyhow. User must fix broken code and implement error types."),
        makeModule("Async Rust & Tokio", "lesson", "Teach async Rust with Tokio: futures, async/await, spawning tasks, channels, and select!. Compare to JS Promises and async/await."),
        makeModule("Rust Knowledge Check", "quiz", "Generate 5 multiple-choice questions on Rust fundamentals: ownership rules, borrowing rules, lifetime annotations, trait objects, and error handling patterns."),
        makeModule("CLI Tool Project", "project", "Guide building a command-line tool in Rust: argument parsing with clap, file I/O, error handling, JSON serialization with serde, and publishing to crates.io."),
      ]
    ),
    makePath(
      "React Advanced Patterns",
      "Level up your React skills with advanced hooks, context, performance, and testing.",
      "programming",
      "⚛️",
      [
        makeModule("Custom Hooks Mastery", "lesson", "Teach advanced custom React hooks: composing hooks, hook factories, hooks with generics, and real-world patterns like useAsync, useDebounce, useMediaQuery."),
        makeModule("Context & State Architecture", "lesson", "Teach React Context patterns: context composition, splitting state/dispatch contexts, context selectors, and when to reach for external state management."),
        makeModule("Performance Optimization", "lesson", "Teach React performance: React.memo, useMemo, useCallback, virtualization, code splitting with lazy/Suspense, and profiling with React DevTools."),
        makeModule("Render Props & Compound Components", "exercise", "Create exercises implementing: render props pattern, compound components with context, headless components, and polymorphic components with TypeScript."),
        makeModule("React Patterns Quiz", "quiz", "Generate 5 multiple-choice questions on: reconciliation algorithm, hooks rules and internals, concurrent features, Suspense boundaries, and error boundaries."),
        makeModule("Testing React Components", "lesson", "Teach React testing: unit testing with Vitest, component testing with Testing Library, mocking hooks and APIs, integration tests, and accessibility testing."),
        makeModule("Design System Project", "project", "Guide building a React design system: theme provider, polymorphic components, accessible form controls, compound select component, and Storybook documentation."),
      ]
    ),
    makePath(
      "System Design",
      "Learn to design scalable systems — databases, caching, microservices, and more.",
      "programming",
      "🏗️",
      [
        makeModule("Scalability Fundamentals", "lesson", "Teach system design scalability: vertical vs horizontal scaling, load balancing strategies, stateless services, CDNs, and capacity estimation."),
        makeModule("Database Design & Selection", "lesson", "Teach database design: SQL vs NoSQL trade-offs, data modeling, indexing strategies, sharding, replication, and when to choose which database type."),
        makeModule("Caching Strategies", "lesson", "Teach caching: cache-aside, write-through, write-behind, cache invalidation, Redis patterns, CDN caching, and browser caching strategies."),
        makeModule("Message Queues & Event-Driven Architecture", "lesson", "Teach message queues and event-driven design: Kafka vs RabbitMQ, event sourcing, CQRS, saga pattern, and eventual consistency."),
        makeModule("Microservices Patterns", "exercise", "Create exercises on microservices: decomposing a monolith, API gateway design, service discovery, circuit breaker pattern, and distributed tracing."),
        makeModule("System Design Quiz", "quiz", "Generate 5 multiple-choice questions on: CAP theorem, consistency models, load balancing algorithms, database isolation levels, and rate limiting."),
        makeModule("Design a URL Shortener", "project", "Guide designing a complete URL shortener system: requirements gathering, API design, database schema, encoding algorithm, caching layer, and analytics."),
      ]
    ),
    makePath(
      "DevOps Essentials",
      "Master Docker, CI/CD, monitoring, and infrastructure as code.",
      "devops",
      "🐳",
      [
        makeModule("Docker Fundamentals", "lesson", "Teach Docker: containers vs VMs, Dockerfile best practices, multi-stage builds, docker-compose, networking, volumes, and security hardening."),
        makeModule("CI/CD Pipelines", "lesson", "Teach CI/CD: GitHub Actions workflows, automated testing, build optimization, deployment strategies (blue-green, canary, rolling), and secrets management."),
        makeModule("Infrastructure as Code", "lesson", "Teach IaC: Terraform basics, resource provisioning, state management, modules, and comparing Terraform vs Pulumi vs CloudFormation."),
        makeModule("Monitoring & Observability", "lesson", "Teach observability: metrics with Prometheus, dashboards with Grafana, logging with ELK stack, distributed tracing, alerting strategies, and SLIs/SLOs/SLAs."),
        makeModule("Container Orchestration", "exercise", "Create exercises on Kubernetes: pods, deployments, services, ingress, ConfigMaps, Secrets, health checks, and scaling strategies."),
        makeModule("DevOps Knowledge Check", "quiz", "Generate 5 multiple-choice questions on: Docker networking, CI/CD best practices, Terraform state, Kubernetes architecture, and monitoring fundamentals."),
      ]
    ),
    makePath(
      "AI/ML Foundations",
      "Understand neural networks, transformers, fine-tuning, and RAG pipelines.",
      "ai",
      "🧠",
      [
        makeModule("Neural Network Basics", "lesson", "Teach neural networks from scratch: perceptrons, activation functions, backpropagation, gradient descent, loss functions, and overfitting with intuitive explanations."),
        makeModule("Transformer Architecture", "lesson", "Teach the transformer architecture: attention mechanism, self-attention, multi-head attention, positional encoding, encoder-decoder structure, and why transformers replaced RNNs."),
        makeModule("LLM Concepts & Prompting", "lesson", "Teach LLM fundamentals: tokenization, temperature, top-p sampling, context windows, prompt engineering techniques, chain-of-thought, and few-shot learning."),
        makeModule("Fine-Tuning & Training", "lesson", "Teach fine-tuning: LoRA, QLoRA, full fine-tuning trade-offs, dataset preparation, evaluation metrics, RLHF, and DPO alignment techniques."),
        makeModule("RAG Pipeline Design", "exercise", "Create exercises on building RAG: document chunking strategies, embedding models, vector databases, retrieval strategies, re-ranking, and evaluation."),
        makeModule("AI/ML Quiz", "quiz", "Generate 5 multiple-choice questions on: backpropagation, attention mechanism, tokenization, fine-tuning methods, and RAG architecture components."),
        makeModule("Build a RAG Chatbot", "project", "Guide building a RAG chatbot: document ingestion, chunking with overlap, embedding with OpenAI, Pinecone vector store, retrieval chain, and evaluation."),
      ]
    ),
    makePath(
      "Security Fundamentals",
      "Learn OWASP top 10, encryption, authentication, and penetration testing basics.",
      "programming",
      "🔒",
      [
        makeModule("OWASP Top 10", "lesson", "Teach the OWASP Top 10 vulnerabilities: injection, broken auth, XSS, insecure deserialization, SSRF, and more — with code examples showing vulnerable vs secure patterns."),
        makeModule("Cryptography Essentials", "lesson", "Teach practical cryptography: symmetric vs asymmetric encryption, hashing, digital signatures, TLS/SSL, certificates, and common pitfalls developers make."),
        makeModule("Authentication & Authorization", "lesson", "Teach auth: session-based vs token-based, JWT deep dive, OAuth 2.0 flows, PKCE, RBAC vs ABAC, and secure password storage with bcrypt/argon2."),
        makeModule("Secure Coding Practices", "exercise", "Create exercises on secure coding: input validation, parameterized queries, CSRF tokens, Content Security Policy, CORS configuration, and secure headers."),
        makeModule("Security Quiz", "quiz", "Generate 5 multiple-choice questions on: XSS types, SQL injection prevention, JWT vulnerabilities, encryption algorithms, and OAuth 2.0 grant types."),
        makeModule("Penetration Testing Intro", "lesson", "Teach penetration testing basics: reconnaissance, vulnerability scanning, exploitation, reporting, and ethical hacking tools (Burp Suite, OWASP ZAP, nmap)."),
      ]
    ),
    makePath(
      "SQL Deep Dive",
      "Master SQL queries, optimization, indexing, and advanced window functions.",
      "data",
      "🗃️",
      [
        makeModule("Query Fundamentals", "lesson", "Teach SQL query fundamentals: SELECT, JOIN types (INNER, LEFT, RIGHT, FULL, CROSS), subqueries, CTEs, UNION, and CASE expressions with practical examples."),
        makeModule("Aggregation & Grouping", "lesson", "Teach SQL aggregation: GROUP BY, HAVING, aggregate functions, ROLLUP, CUBE, GROUPING SETS, and pivot techniques with real data scenarios."),
        makeModule("Indexing & Query Plans", "lesson", "Teach SQL indexing: B-tree indexes, hash indexes, composite indexes, covering indexes, partial indexes, EXPLAIN ANALYZE, and query plan interpretation."),
        makeModule("Window Functions", "lesson", "Teach SQL window functions: ROW_NUMBER, RANK, DENSE_RANK, NTILE, LAG, LEAD, FIRST_VALUE, LAST_VALUE, running totals, moving averages, and frame specifications."),
        makeModule("Query Optimization", "exercise", "Create exercises on SQL optimization: rewriting slow queries, index selection, avoiding N+1, batch operations, materialized views, and partitioning strategies."),
        makeModule("SQL Knowledge Check", "quiz", "Generate 5 multiple-choice questions on: JOIN behavior with NULLs, window function frames, index selection, transaction isolation levels, and query optimization."),
        makeModule("Analytics Dashboard Queries", "project", "Guide building SQL queries for an analytics dashboard: user retention cohorts, funnel analysis, revenue metrics, time-series aggregation, and percentile calculations."),
      ]
    ),
  ];
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useLearning() {
  const [paths, setPaths] = useState<LearningPath[]>(() => {
    const stored = loadFromStorage();
    if (stored.length > 0) return stored;
    return getBuiltInPaths();
  });
  const [activePathId, setActivePathId] = useState<string | null>(null);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const pathsRef = useRef(paths);

  useEffect(() => {
    pathsRef.current = paths;
  }, [paths]);

  // Persist on change
  useEffect(() => {
    saveToStorage(paths);
  }, [paths]);

  // Cross-tab sync
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setPaths(loadFromStorage());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const activePath = useMemo(
    () => paths.find((p) => p.id === activePathId) ?? null,
    [paths, activePathId]
  );

  const activeModule = useMemo(() => {
    if (!activePath || !activeModuleId) return null;
    return activePath.modules.find((m) => m.id === activeModuleId) ?? null;
  }, [activePath, activeModuleId]);

  const createPath = useCallback(
    (
      title: string,
      description: string,
      category: PathCategory,
      icon: string,
      modules: Array<{ title: string; type: LearningModule["type"]; content: string }>
    ): LearningPath => {
      const path = makePath(
        title,
        description,
        category,
        icon,
        modules.map((m) => makeModule(m.title, m.type, m.content))
      );
      setPaths((prev) => [...prev, path]);
      return path;
    },
    []
  );

  const deletePath = useCallback(
    (pathId: string) => {
      setPaths((prev) => prev.filter((p) => p.id !== pathId));
      if (activePathId === pathId) {
        setActivePathId(null);
        setActiveModuleId(null);
      }
    },
    [activePathId]
  );

  const startModule = useCallback(
    (pathId: string, moduleId: string) => {
      setActivePathId(pathId);
      setActiveModuleId(moduleId);
    },
    []
  );

  const completeModule = useCallback(
    (moduleId: string, score?: number) => {
      setPaths((prev) =>
        prev.map((path) => {
          const moduleIdx = path.modules.findIndex((m) => m.id === moduleId);
          if (moduleIdx === -1) return path;

          const updatedModules = path.modules.map((m) => {
            if (m.id !== moduleId) return m;
            return {
              ...m,
              completed: true,
              score: score ?? m.score,
              completedAt: Date.now(),
            };
          });

          const progress = calcProgress(updatedModules);
          const allDone = updatedModules.every((m) => m.completed);

          return {
            ...path,
            modules: updatedModules,
            progress,
            updatedAt: Date.now(),
            completedAt: allDone ? Date.now() : path.completedAt,
          };
        })
      );
    },
    []
  );

  const updateModuleNotes = useCallback(
    (moduleId: string, notes: string) => {
      setPaths((prev) =>
        prev.map((path) => {
          const hasModule = path.modules.some((m) => m.id === moduleId);
          if (!hasModule) return path;
          return {
            ...path,
            modules: path.modules.map((m) =>
              m.id === moduleId ? { ...m, notes } : m
            ),
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  const generateLesson = useCallback(
    (moduleId: string): string => {
      for (const path of pathsRef.current) {
        const mod = path.modules.find((m) => m.id === moduleId);
        if (mod) {
          return `You are an expert tutor. Generate an interactive lesson for the topic: "${mod.title}" in the learning path "${path.title}".\n\nInstructions for the lesson:\n${mod.content}\n\nFormat the lesson with:\n- Clear section headings\n- Code examples where appropriate\n- Key takeaways at the end\n- A brief check-your-understanding question at the end`;
        }
      }
      return "";
    },
    []
  );

  const submitQuiz = useCallback(
    (moduleId: string, answers: string[]): string => {
      for (const path of pathsRef.current) {
        const mod = path.modules.find((m) => m.id === moduleId);
        if (mod) {
          return `You are a quiz evaluator. The quiz topic is "${mod.title}" from the learning path "${path.title}".\n\nThe student submitted these answers:\n${answers.map((a, i) => `Q${i + 1}: ${a}`).join("\n")}\n\nOriginal quiz prompt: ${mod.content}\n\nEvaluate each answer. Provide:\n1. Score out of ${answers.length} (as a percentage)\n2. For each question: whether correct/incorrect and brief explanation\n3. Areas to review if any answers were wrong`;
        }
      }
      return "";
    },
    []
  );

  const getProgress = useCallback(
    (pathId: string): { completed: number; total: number; percent: number } => {
      const path = pathsRef.current.find((p) => p.id === pathId);
      if (!path) return { completed: 0, total: 0, percent: 0 };
      const completed = path.modules.filter((m) => m.completed).length;
      return {
        completed,
        total: path.modules.length,
        percent: calcProgress(path.modules),
      };
    },
    []
  );

  const resetPath = useCallback(
    (pathId: string) => {
      setPaths((prev) =>
        prev.map((path) => {
          if (path.id !== pathId) return path;
          return {
            ...path,
            modules: path.modules.map((m) => ({
              ...m,
              completed: false,
              score: null,
              notes: "",
              completedAt: null,
            })),
            progress: 0,
            completedAt: null,
            updatedAt: Date.now(),
          };
        })
      );
    },
    []
  );

  const stats = useMemo((): LearningStats => {
    const completedPaths = paths.filter((p) => p.completedAt !== null).length;
    const allModules = paths.flatMap((p) => p.modules);
    const completedModules = allModules.filter((m) => m.completed).length;
    const quizScores = allModules
      .filter((m) => m.type === "quiz" && m.score !== null)
      .map((m) => m.score!);
    const averageQuizScore =
      quizScores.length > 0
        ? Math.round(quizScores.reduce((a, b) => a + b, 0) / quizScores.length)
        : 0;

    // Streak: count consecutive days with completions going backwards from today
    const completionDates = new Set(
      allModules
        .filter((m) => m.completedAt)
        .map((m) => new Date(m.completedAt!).toDateString())
    );
    let streakDays = 0;
    const day = new Date();
    while (completionDates.has(day.toDateString())) {
      streakDays++;
      day.setDate(day.getDate() - 1);
    }

    const totalModuleCount = allModules.length;
    const hours = Math.ceil(totalModuleCount * 0.5);

    return {
      totalPaths: paths.length,
      completedPaths,
      totalModules: totalModuleCount,
      completedModules,
      averageQuizScore,
      streakDays,
      totalTimeEstimate: `~${hours}h`,
    };
  }, [paths]);

  return {
    paths,
    activePath,
    activeModule,
    activePathId,
    activeModuleId,
    createPath,
    deletePath,
    startModule,
    completeModule,
    updateModuleNotes,
    generateLesson,
    submitQuiz,
    getProgress,
    resetPath,
    stats,
    setActivePathId,
    setActiveModuleId,
  };
}
