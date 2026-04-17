import { useState, useCallback, useMemo } from "react";

/**
 * Knowledge Graph — Rowboat-inspired compounding memory.
 * Builds relationships between entities (people, projects, decisions,
 * tools, concepts) that the AI can reference in future conversations.
 *
 * Unlike flat knowledge entries, the graph tracks CONNECTIONS:
 * - "Arnav works on Blade"
 * - "Blade uses Tauri"
 * - "Tauri competes with Electron"
 *
 * These connections let the AI reason about context naturally.
 */

export interface GraphNode {
  id: string;
  type: "person" | "project" | "decision" | "tool" | "concept" | "company" | "event" | "goal";
  label: string;
  description: string;
  properties: Record<string, string>;
  createdAt: number;
  updatedAt: number;
  mentionCount: number;
  lastMentioned: number;
}

export interface GraphEdge {
  id: string;
  from: string; // node id
  to: string;   // node id
  relation: string; // "works_on" | "uses" | "competes_with" | "decided" | "owns" | "related_to" | "depends_on" | "created" | "part_of"
  weight: number; // 0-1, strength of relationship
  context: string; // sentence describing the relationship
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeGraphState {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const STORAGE_KEY = "blade-knowledge-graph";

const NODE_ICONS: Record<GraphNode["type"], string> = {
  person: "👤",
  project: "📁",
  decision: "🔀",
  tool: "🔧",
  concept: "💡",
  company: "🏢",
  event: "📅",
  goal: "🎯",
};

const NODE_COLORS: Record<GraphNode["type"], string> = {
  person: "#60a5fa",
  project: "#34d399",
  decision: "#f59e0b",
  tool: "#a78bfa",
  concept: "#f472b6",
  company: "#06b6d4",
  event: "#fb923c",
  goal: "#4ade80",
};

function loadGraph(): KnowledgeGraphState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { nodes: [], edges: [] };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function saveGraph(state: KnowledgeGraphState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Extract entities from text using pattern matching.
 * In production, this would use NER from the AI model.
 */
function extractEntities(text: string): Array<{ type: GraphNode["type"]; label: string }> {
  const entities: Array<{ type: GraphNode["type"]; label: string }> = [];
  const lower = text.toLowerCase();

  // Tech/tool detection
  const tools = [
    "react", "vue", "angular", "svelte", "next.js", "nuxt", "remix",
    "typescript", "javascript", "python", "rust", "go", "java",
    "tauri", "electron", "docker", "kubernetes", "git", "github",
    "postgres", "mysql", "sqlite", "redis", "mongodb",
    "aws", "gcp", "azure", "vercel", "netlify", "cloudflare",
    "figma", "notion", "slack", "discord", "linear", "jira",
    "openai", "anthropic", "claude", "gpt", "gemini", "ollama",
    "node", "deno", "bun", "npm", "yarn", "pnpm",
    "vite", "webpack", "esbuild", "turbopack",
    "tailwind", "css", "sass", "styled-components",
  ];
  for (const tool of tools) {
    if (lower.includes(tool)) {
      entities.push({ type: "tool", label: tool.charAt(0).toUpperCase() + tool.slice(1) });
    }
  }

  // Company detection
  const companies = [
    "google", "apple", "microsoft", "amazon", "meta", "facebook",
    "anthropic", "openai", "stripe", "shopify", "vercel",
    "netflix", "spotify", "uber", "airbnb", "tesla",
  ];
  for (const company of companies) {
    if (lower.includes(company)) {
      entities.push({ type: "company", label: company.charAt(0).toUpperCase() + company.slice(1) });
    }
  }

  // Concept detection
  const concepts = [
    "api", "database", "authentication", "authorization", "caching",
    "deployment", "ci/cd", "testing", "monitoring", "security",
    "performance", "scalability", "microservices", "serverless",
    "machine learning", "deep learning", "neural network",
    "mcp", "agent", "rag", "embedding", "vector",
  ];
  for (const concept of concepts) {
    if (lower.includes(concept)) {
      entities.push({ type: "concept", label: concept.charAt(0).toUpperCase() + concept.slice(1) });
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return entities.filter((e) => {
    const key = `${e.type}:${e.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useKnowledgeGraph() {
  const [state, setState] = useState<KnowledgeGraphState>(loadGraph);

  const addNode = useCallback((node: Omit<GraphNode, "id" | "createdAt" | "updatedAt" | "mentionCount" | "lastMentioned">) => {
    setState((prev) => {
      // Check if node with same label+type exists
      const existing = prev.nodes.find((n) => n.label.toLowerCase() === node.label.toLowerCase() && n.type === node.type);
      if (existing) {
        const updated = {
          ...prev,
          nodes: prev.nodes.map((n) =>
            n.id === existing.id
              ? { ...n, mentionCount: n.mentionCount + 1, lastMentioned: Date.now(), updatedAt: Date.now(), description: node.description || n.description }
              : n,
          ),
        };
        saveGraph(updated);
        return updated;
      }

      const newNode: GraphNode = {
        ...node,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        mentionCount: 1,
        lastMentioned: Date.now(),
      };
      const updated = { ...prev, nodes: [...prev.nodes, newNode] };
      saveGraph(updated);
      return updated;
    });
  }, []);

  const addEdge = useCallback((edge: Omit<GraphEdge, "id" | "createdAt" | "updatedAt">) => {
    setState((prev) => {
      // Check for existing edge
      const existing = prev.edges.find((e) => e.from === edge.from && e.to === edge.to && e.relation === edge.relation);
      if (existing) {
        const updated = {
          ...prev,
          edges: prev.edges.map((e) =>
            e.id === existing.id
              ? { ...e, weight: Math.min(1, e.weight + 0.1), updatedAt: Date.now() }
              : e,
          ),
        };
        saveGraph(updated);
        return updated;
      }

      const newEdge: GraphEdge = {
        ...edge,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const updated = { ...prev, edges: [...prev.edges, newEdge] };
      saveGraph(updated);
      return updated;
    });
  }, []);

  const removeNode = useCallback((id: string) => {
    setState((prev) => {
      const updated = {
        nodes: prev.nodes.filter((n) => n.id !== id),
        edges: prev.edges.filter((e) => e.from !== id && e.to !== id),
      };
      saveGraph(updated);
      return updated;
    });
  }, []);

  const removeEdge = useCallback((id: string) => {
    setState((prev) => {
      const updated = { ...prev, edges: prev.edges.filter((e) => e.id !== id) };
      saveGraph(updated);
      return updated;
    });
  }, []);

  const ingestFromConversation = useCallback((messages: Array<{ role: string; content: string }>) => {
    const allText = messages.map((m) => m.content).join(" ");
    const entities = extractEntities(allText);

    for (const entity of entities) {
      addNode({
        type: entity.type,
        label: entity.label,
        description: "",
        properties: {},
      });
    }

    // Create edges between co-occurring entities
    for (let i = 0; i < entities.length; i++) {
      for (let j = i + 1; j < entities.length; j++) {
        // Only link if they appear in the same message
        const cooccur = messages.some((m) => {
          const lower = m.content.toLowerCase();
          return lower.includes(entities[i].label.toLowerCase()) && lower.includes(entities[j].label.toLowerCase());
        });
        if (cooccur) {
          setState((prev) => {
            const fromNode = prev.nodes.find((n) => n.label.toLowerCase() === entities[i].label.toLowerCase());
            const toNode = prev.nodes.find((n) => n.label.toLowerCase() === entities[j].label.toLowerCase());
            if (fromNode && toNode) {
              addEdge({
                from: fromNode.id,
                to: toNode.id,
                relation: "related_to",
                weight: 0.3,
                context: `Discussed together`,
              });
            }
            return prev;
          });
        }
      }
    }
  }, [addNode, addEdge]);

  const getNeighbors = useCallback((nodeId: string): GraphNode[] => {
    const neighborIds = new Set<string>();
    for (const edge of state.edges) {
      if (edge.from === nodeId) neighborIds.add(edge.to);
      if (edge.to === nodeId) neighborIds.add(edge.from);
    }
    return state.nodes.filter((n) => neighborIds.has(n.id));
  }, [state]);

  const getContextForPrompt = useCallback((query: string): string => {
    const lower = query.toLowerCase();
    const relevantNodes = state.nodes.filter((n) =>
      lower.includes(n.label.toLowerCase()) || n.description.toLowerCase().includes(lower),
    );

    if (relevantNodes.length === 0) return "";

    const lines: string[] = ["[Knowledge Graph Context]"];
    for (const node of relevantNodes.slice(0, 5)) {
      lines.push(`- ${NODE_ICONS[node.type]} ${node.label} (${node.type}): ${node.description || "no description"}`);
      const neighbors = getNeighbors(node.id);
      for (const neighbor of neighbors.slice(0, 3)) {
        const edge = state.edges.find((e) =>
          (e.from === node.id && e.to === neighbor.id) || (e.from === neighbor.id && e.to === node.id),
        );
        lines.push(`  → ${edge?.relation || "related to"} ${neighbor.label}`);
      }
    }
    return lines.join("\n");
  }, [state, getNeighbors]);

  const stats = useMemo(() => ({
    totalNodes: state.nodes.length,
    totalEdges: state.edges.length,
    nodesByType: Object.fromEntries(
      (["person", "project", "decision", "tool", "concept", "company", "event", "goal"] as const).map((type) => [
        type,
        state.nodes.filter((n) => n.type === type).length,
      ]),
    ),
    mostConnected: [...state.nodes]
      .sort((a, b) => {
        const aEdges = state.edges.filter((e) => e.from === a.id || e.to === a.id).length;
        const bEdges = state.edges.filter((e) => e.from === b.id || e.to === b.id).length;
        return bEdges - aEdges;
      })
      .slice(0, 5),
    mostMentioned: [...state.nodes].sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 5),
  }), [state]);

  const clear = useCallback(() => {
    setState({ nodes: [], edges: [] });
    saveGraph({ nodes: [], edges: [] });
  }, []);

  return {
    nodes: state.nodes,
    edges: state.edges,
    addNode,
    addEdge,
    removeNode,
    removeEdge,
    ingestFromConversation,
    getNeighbors,
    getContextForPrompt,
    stats,
    clear,
    nodeIcons: NODE_ICONS,
    nodeColors: NODE_COLORS,
  };
}
