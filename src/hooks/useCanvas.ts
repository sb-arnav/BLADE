import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  type: "sticky" | "text" | "image" | "code" | "ai-response";
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  color: string;
  zIndex: number;
  locked: boolean;
  createdAt: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  style: "solid" | "dashed" | "arrow";
}

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  viewport: CanvasViewport;
  isDragging: boolean;
  isPanning: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-canvas";
const MAX_HISTORY = 50;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4.0;

const STICKY_COLORS = ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"];

const DEFAULT_SIZES: Record<CanvasNode["type"], { width: number; height: number }> = {
  sticky: { width: 200, height: 150 },
  text: { width: 300, height: 200 },
  code: { width: 400, height: 250 },
  image: { width: 300, height: 250 },
  "ai-response": { width: 350, height: 250 },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function generateEdgeId(): string {
  return `e_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function createInitialState(): CanvasState {
  return {
    nodes: [],
    edges: [],
    selectedNodeId: null,
    viewport: { x: 0, y: 0, zoom: 1 },
    isDragging: false,
    isPanning: false,
  };
}

function loadState(): CanvasState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CanvasState;
      // Reset transient flags
      parsed.isDragging = false;
      parsed.isPanning = false;
      parsed.selectedNodeId = null;
      return parsed;
    }
  } catch {
    // corrupted — start fresh
  }
  return createInitialState();
}

function saveState(state: CanvasState): void {
  try {
    const toSave: CanvasState = {
      ...state,
      isDragging: false,
      isPanning: false,
      selectedNodeId: null,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // storage full — silently ignore
  }
}

function nextZIndex(nodes: CanvasNode[]): number {
  if (nodes.length === 0) return 1;
  return Math.max(...nodes.map((n) => n.zIndex)) + 1;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCanvas() {
  const [state, setState] = useState<CanvasState>(loadState);

  // Undo / redo stacks — store serialised snapshots of nodes + edges
  const historyRef = useRef<{ nodes: CanvasNode[]; edges: CanvasEdge[] }[]>([]);
  const futureRef = useRef<{ nodes: CanvasNode[]; edges: CanvasEdge[] }[]>([]);
  const stickyColorIndexRef = useRef(0);

  // Persist on every meaningful change
  useEffect(() => {
    saveState(state);
  }, [state]);

  // ── History helpers ───────────────────────────────────────────────────────

  const pushHistory = useCallback((current: CanvasState) => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: structuredClone(current.nodes), edges: structuredClone(current.edges) },
    ];
    futureRef.current = [];
  }, []);

  const undo = useCallback(() => {
    setState((prev) => {
      if (historyRef.current.length === 0) return prev;
      const snapshot = historyRef.current.pop()!;
      futureRef.current.push({
        nodes: structuredClone(prev.nodes),
        edges: structuredClone(prev.edges),
      });
      return { ...prev, nodes: snapshot.nodes, edges: snapshot.edges, selectedNodeId: null };
    });
  }, []);

  const redo = useCallback(() => {
    setState((prev) => {
      if (futureRef.current.length === 0) return prev;
      const snapshot = futureRef.current.pop()!;
      historyRef.current.push({
        nodes: structuredClone(prev.nodes),
        edges: structuredClone(prev.edges),
      });
      return { ...prev, nodes: snapshot.nodes, edges: snapshot.edges, selectedNodeId: null };
    });
  }, []);

  // ── Node operations ───────────────────────────────────────────────────────

  const addNode = useCallback(
    (type: CanvasNode["type"], x: number, y: number, content?: string): CanvasNode => {
      const size = DEFAULT_SIZES[type];
      const color =
        type === "sticky"
          ? STICKY_COLORS[stickyColorIndexRef.current++ % STICKY_COLORS.length]
          : type === "code"
            ? "#0c0c0f"
            : type === "ai-response"
              ? "#6366f1"
              : "#ffffff";

      const node: CanvasNode = {
        id: generateId(),
        type,
        x,
        y,
        width: size.width,
        height: size.height,
        content: content ?? "",
        color,
        zIndex: 0,
        locked: false,
        createdAt: Date.now(),
      };

      setState((prev) => {
        pushHistory(prev);
        node.zIndex = nextZIndex(prev.nodes);
        return { ...prev, nodes: [...prev.nodes, node], selectedNodeId: node.id };
      });

      return node;
    },
    [pushHistory]
  );

  const updateNode = useCallback(
    (id: string, updates: Partial<Pick<CanvasNode, "content" | "color" | "locked" | "width" | "height">>) => {
      setState((prev) => {
        pushHistory(prev);
        return {
          ...prev,
          nodes: prev.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n)),
        };
      });
    },
    [pushHistory]
  );

  const deleteNode = useCallback(
    (id: string) => {
      setState((prev) => {
        pushHistory(prev);
        return {
          ...prev,
          nodes: prev.nodes.filter((n) => n.id !== id),
          edges: prev.edges.filter((e) => e.from !== id && e.to !== id),
          selectedNodeId: prev.selectedNodeId === id ? null : prev.selectedNodeId,
        };
      });
    },
    [pushHistory]
  );

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === id && !n.locked ? { ...n, x, y, zIndex: nextZIndex(prev.nodes) } : n
      ),
    }));
  }, []);

  const resizeNode = useCallback((id: string, width: number, height: number) => {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === id && !n.locked
          ? { ...n, width: Math.max(100, width), height: Math.max(60, height) }
          : n
      ),
    }));
  }, []);

  const selectNode = useCallback((id: string | null) => {
    setState((prev) => {
      if (id && id !== prev.selectedNodeId) {
        return {
          ...prev,
          selectedNodeId: id,
          nodes: prev.nodes.map((n) =>
            n.id === id ? { ...n, zIndex: nextZIndex(prev.nodes) } : n
          ),
        };
      }
      return { ...prev, selectedNodeId: id };
    });
  }, []);

  const bringToFront = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === id ? { ...n, zIndex: nextZIndex(prev.nodes) } : n
      ),
    }));
  }, []);

  // ── Edge operations ───────────────────────────────────────────────────────

  const addEdge = useCallback(
    (from: string, to: string, style: CanvasEdge["style"] = "arrow", label?: string) => {
      setState((prev) => {
        // Prevent duplicate edges
        if (prev.edges.some((e) => e.from === from && e.to === to)) return prev;
        // Prevent self-edges
        if (from === to) return prev;
        pushHistory(prev);
        const edge: CanvasEdge = { id: generateEdgeId(), from, to, style, label };
        return { ...prev, edges: [...prev.edges, edge] };
      });
    },
    [pushHistory]
  );

  const deleteEdge = useCallback(
    (id: string) => {
      setState((prev) => {
        pushHistory(prev);
        return { ...prev, edges: prev.edges.filter((e) => e.id !== id) };
      });
    },
    [pushHistory]
  );

  // ── Viewport ──────────────────────────────────────────────────────────────

  const pan = useCallback((dx: number, dy: number) => {
    setState((prev) => ({
      ...prev,
      viewport: {
        ...prev.viewport,
        x: prev.viewport.x + dx,
        y: prev.viewport.y + dy,
      },
    }));
  }, []);

  const zoom = useCallback((delta: number, centerX: number, centerY: number) => {
    setState((prev) => {
      const oldZoom = prev.viewport.zoom;
      const newZoom = clamp(oldZoom * (1 + delta), MIN_ZOOM, MAX_ZOOM);
      const ratio = newZoom / oldZoom;

      // Zoom towards the pointer position
      const newX = centerX - (centerX - prev.viewport.x) * ratio;
      const newY = centerY - (centerY - prev.viewport.y) * ratio;

      return {
        ...prev,
        viewport: { x: newX, y: newY, zoom: newZoom },
      };
    });
  }, []);

  const setZoom = useCallback((newZoom: number) => {
    setState((prev) => ({
      ...prev,
      viewport: { ...prev.viewport, zoom: clamp(newZoom, MIN_ZOOM, MAX_ZOOM) },
    }));
  }, []);

  const resetViewport = useCallback(() => {
    setState((prev) => ({
      ...prev,
      viewport: { x: 0, y: 0, zoom: 1 },
    }));
  }, []);

  const setDragging = useCallback((isDragging: boolean) => {
    setState((prev) => ({ ...prev, isDragging }));
  }, []);

  const setPanning = useCallback((isPanning: boolean) => {
    setState((prev) => ({ ...prev, isPanning }));
  }, []);

  // ── Export ────────────────────────────────────────────────────────────────

  const exportAsMarkdown = useCallback((): string => {
    const current = state;
    if (current.nodes.length === 0) return "# Empty Canvas\n\nNo nodes yet.";

    const lines: string[] = ["# Canvas Export", ""];

    // Build adjacency map
    const childMap = new Map<string, { node: CanvasNode; label?: string }[]>();
    const nodeMap = new Map<string, CanvasNode>();
    for (const n of current.nodes) nodeMap.set(n.id, n);

    for (const e of current.edges) {
      const target = nodeMap.get(e.to);
      if (!target) continue;
      const list = childMap.get(e.from) ?? [];
      list.push({ node: target, label: e.label });
      childMap.set(e.from, list);
    }

    // Find root nodes (no incoming edges)
    const hasIncoming = new Set(current.edges.map((e) => e.to));
    const roots = current.nodes.filter((n) => !hasIncoming.has(n.id));
    const rest = current.nodes.filter((n) => hasIncoming.has(n.id));

    const renderNode = (node: CanvasNode, indent: number) => {
      const prefix = indent === 0 ? "## " : "  ".repeat(indent) + "- ";
      const typeTag = node.type !== "sticky" ? `[${node.type}] ` : "";
      const contentPreview = node.content.split("\n")[0].slice(0, 120) || "(empty)";
      lines.push(`${prefix}${typeTag}${contentPreview}`);

      if (node.content.split("\n").length > 1 && indent === 0) {
        lines.push("");
        if (node.type === "code") {
          lines.push("```");
          lines.push(node.content);
          lines.push("```");
        } else {
          lines.push(node.content);
        }
        lines.push("");
      }

      const children = childMap.get(node.id) ?? [];
      for (const child of children) {
        if (child.label) {
          lines.push(`${"  ".repeat(indent + 1)}*(${child.label})*`);
        }
        renderNode(child.node, indent + 1);
      }
    };

    for (const root of roots) renderNode(root, 0);

    if (rest.length > 0) {
      const renderedIds = new Set<string>();
      const collectRendered = (id: string) => {
        renderedIds.add(id);
        for (const child of childMap.get(id) ?? []) collectRendered(child.node.id);
      };
      for (const root of roots) collectRendered(root.id);

      const unrendered = rest.filter((n) => !renderedIds.has(n.id));
      if (unrendered.length > 0) {
        lines.push("", "## Other Nodes", "");
        for (const node of unrendered) renderNode(node, 1);
      }
    }

    return lines.join("\n");
  }, [state]);

  // ── Clear ─────────────────────────────────────────────────────────────────

  const clear = useCallback(() => {
    setState((prev) => {
      pushHistory(prev);
      return { ...prev, nodes: [], edges: [], selectedNodeId: null };
    });
  }, [pushHistory]);

  // ── Fit view ──────────────────────────────────────────────────────────────

  const fitView = useCallback((containerWidth: number, containerHeight: number) => {
    setState((prev) => {
      if (prev.nodes.length === 0) return { ...prev, viewport: { x: 0, y: 0, zoom: 1 } };

      const minX = Math.min(...prev.nodes.map((n) => n.x));
      const minY = Math.min(...prev.nodes.map((n) => n.y));
      const maxX = Math.max(...prev.nodes.map((n) => n.x + n.width));
      const maxY = Math.max(...prev.nodes.map((n) => n.y + n.height));

      const contentWidth = maxX - minX + 100;
      const contentHeight = maxY - minY + 100;

      const newZoom = clamp(
        Math.min(containerWidth / contentWidth, containerHeight / contentHeight),
        MIN_ZOOM,
        MAX_ZOOM
      );

      const newX = (containerWidth - contentWidth * newZoom) / 2 - minX * newZoom + 50 * newZoom;
      const newY = (containerHeight - contentHeight * newZoom) / 2 - minY * newZoom + 50 * newZoom;

      return { ...prev, viewport: { x: newX, y: newY, zoom: newZoom } };
    });
  }, []);

  // ── Duplicate node ────────────────────────────────────────────────────────

  const duplicateNode = useCallback(
    (id: string) => {
      setState((prev) => {
        const source = prev.nodes.find((n) => n.id === id);
        if (!source) return prev;
        pushHistory(prev);
        const dup: CanvasNode = {
          ...structuredClone(source),
          id: generateId(),
          x: source.x + 30,
          y: source.y + 30,
          zIndex: nextZIndex(prev.nodes),
          createdAt: Date.now(),
        };
        return { ...prev, nodes: [...prev.nodes, dup], selectedNodeId: dup.id };
      });
    },
    [pushHistory]
  );

  return {
    state,
    addNode,
    updateNode,
    deleteNode,
    moveNode,
    resizeNode,
    selectNode,
    bringToFront,
    addEdge,
    deleteEdge,
    pan,
    zoom,
    setZoom,
    resetViewport,
    setDragging,
    setPanning,
    undo,
    redo,
    exportAsMarkdown,
    clear,
    fitView,
    duplicateNode,
    canUndo: historyRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
  };
}
