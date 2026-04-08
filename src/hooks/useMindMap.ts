import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MindMapNode {
  id: string;
  text: string;
  x: number;
  y: number;
  color: string;
  size: "small" | "medium" | "large";
  shape: "circle" | "rectangle" | "rounded";
  children: string[];
  parentId: string | null;
  collapsed: boolean;
  notes: string;
  icon?: string;
}

export interface MindMap {
  id: string;
  title: string;
  nodes: MindMapNode[];
  rootId: string;
  createdAt: number;
  updatedAt: number;
  zoom: number;
  panX: number;
  panY: number;
}

interface MindMapSnapshot {
  nodes: MindMapNode[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-mindmaps";
const MAX_HISTORY = 30;

const NODE_COLORS = [
  "#6366f1", // indigo
  "#22d3ee", // cyan
  "#f59e0b", // amber
  "#ef4444", // red
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
];

const SIZE_RADIUS: Record<MindMapNode["size"], number> = {
  small: 40,
  medium: 56,
  large: 74,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return `mm_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function pickColor(index: number): string {
  return NODE_COLORS[index % NODE_COLORS.length];
}

function loadMaps(): MindMap[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as MindMap[];
  } catch {
    // corrupted — start fresh
  }
  return [];
}

function saveMaps(maps: MindMap[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(maps));
  } catch {
    // storage full — silently ignore
  }
}

function createRootNode(text: string): MindMapNode {
  return {
    id: generateId(),
    text,
    x: 0,
    y: 0,
    color: NODE_COLORS[0],
    size: "large",
    shape: "circle",
    children: [],
    parentId: null,
    collapsed: false,
    notes: "",
  };
}

// ── Layout algorithms ─────────────────────────────────────────────────────────

function layoutTopDown(
  nodes: MindMapNode[],
  rootId: string,
  hSpacing = 180,
  vSpacing = 120,
): MindMapNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]));
  const updated = new Map<string, MindMapNode>();

  function subtreeWidth(id: string): number {
    const node = nodeMap.get(id);
    if (!node) return 0;
    const visibleChildren = node.collapsed ? [] : node.children.filter((c) => nodeMap.has(c));
    if (visibleChildren.length === 0) return hSpacing;
    return visibleChildren.reduce((sum, cid) => sum + subtreeWidth(cid), 0);
  }

  function layout(id: string, x: number, y: number, depth: number): void {
    const node = nodeMap.get(id);
    if (!node) return;
    const positioned = { ...node, x, y };
    updated.set(id, positioned);

    const visibleChildren = node.collapsed ? [] : node.children.filter((c) => nodeMap.has(c));
    if (visibleChildren.length === 0) return;

    const totalWidth = visibleChildren.reduce((sum, cid) => sum + subtreeWidth(cid), 0);
    let cx = x - totalWidth / 2;
    for (const cid of visibleChildren) {
      const w = subtreeWidth(cid);
      layout(cid, cx + w / 2, y + vSpacing, depth + 1);
      cx += w;
    }
  }

  layout(rootId, 0, 0, 0);
  return nodes.map((n) => updated.get(n.id) ?? n);
}

function layoutRadial(
  nodes: MindMapNode[],
  rootId: string,
  baseRadius = 200,
  radiusStep = 160,
): MindMapNode[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, { ...n }]));
  const updated = new Map<string, MindMapNode>();

  function leafCount(id: string): number {
    const node = nodeMap.get(id);
    if (!node) return 0;
    const visibleChildren = node.collapsed ? [] : node.children.filter((c) => nodeMap.has(c));
    if (visibleChildren.length === 0) return 1;
    return visibleChildren.reduce((sum, cid) => sum + leafCount(cid), 0);
  }

  function layout(
    id: string,
    cx: number,
    cy: number,
    startAngle: number,
    endAngle: number,
    depth: number,
  ): void {
    const node = nodeMap.get(id);
    if (!node) return;

    let x: number, y: number;
    if (depth === 0) {
      x = cx;
      y = cy;
    } else {
      const angle = (startAngle + endAngle) / 2;
      const r = baseRadius + radiusStep * (depth - 1);
      x = cx + r * Math.cos(angle);
      y = cy + r * Math.sin(angle);
    }

    updated.set(id, { ...node, x, y });

    const visibleChildren = node.collapsed ? [] : node.children.filter((c) => nodeMap.has(c));
    if (visibleChildren.length === 0) return;

    const totalLeaves = visibleChildren.reduce((sum, cid) => sum + leafCount(cid), 0);
    let currentAngle = startAngle;

    for (const cid of visibleChildren) {
      const fraction = leafCount(cid) / totalLeaves;
      const sweep = (endAngle - startAngle) * fraction;
      layout(cid, cx, cy, currentAngle, currentAngle + sweep, depth + 1);
      currentAngle += sweep;
    }
  }

  layout(rootId, 0, 0, 0, 2 * Math.PI, 0);
  return nodes.map((n) => updated.get(n.id) ?? n);
}

// ── AI simulation helpers ─────────────────────────────────────────────────────

function simulateGenerateMap(prompt: string): MindMapNode[] {
  const rootId = generateId();
  const topics = [
    "Key Concepts",
    "Applications",
    "Challenges",
    "Future Trends",
    "Related Fields",
  ];
  const subTopics: Record<string, string[]> = {
    "Key Concepts": ["Fundamentals", "Core Theory", "Principles"],
    Applications: ["Industry", "Research", "Education"],
    Challenges: ["Technical", "Ethical", "Scalability"],
    "Future Trends": ["Innovation", "Adoption", "Breakthroughs"],
    "Related Fields": ["Cross-Domain", "Supporting Tech", "Standards"],
  };

  const root: MindMapNode = {
    id: rootId,
    text: prompt.slice(0, 60) || "New Topic",
    x: 0,
    y: 0,
    color: NODE_COLORS[0],
    size: "large",
    shape: "circle",
    children: [],
    parentId: null,
    collapsed: false,
    notes: `Generated from: "${prompt}"`,
  };

  const allNodes: MindMapNode[] = [root];
  let colorIdx = 1;

  for (const topic of topics) {
    const branchId = generateId();
    const branchColor = pickColor(colorIdx++);
    const branchNode: MindMapNode = {
      id: branchId,
      text: topic,
      x: 0,
      y: 0,
      color: branchColor,
      size: "medium",
      shape: "rounded",
      children: [],
      parentId: rootId,
      collapsed: false,
      notes: "",
    };

    root.children.push(branchId);
    allNodes.push(branchNode);

    const subs = subTopics[topic] ?? [];
    for (const sub of subs) {
      const leafId = generateId();
      const leafNode: MindMapNode = {
        id: leafId,
        text: sub,
        x: 0,
        y: 0,
        color: branchColor,
        size: "small",
        shape: "rectangle",
        children: [],
        parentId: branchId,
        collapsed: false,
        notes: "",
      };
      branchNode.children.push(leafId);
      allNodes.push(leafNode);
    }
  }

  return layoutRadial(allNodes, rootId);
}

function simulateExpandNode(
  existingNodes: MindMapNode[],
  nodeId: string,
): MindMapNode[] {
  const node = existingNodes.find((n) => n.id === nodeId);
  if (!node) return existingNodes;

  const expansions = ["Aspect A", "Aspect B", "Aspect C"];
  const newChildren: MindMapNode[] = [];

  for (let i = 0; i < expansions.length; i++) {
    const childId = generateId();
    newChildren.push({
      id: childId,
      text: `${node.text} — ${expansions[i]}`,
      x: node.x + (i - 1) * 160,
      y: node.y + 120,
      color: node.color,
      size: "small",
      shape: "rectangle",
      children: [],
      parentId: nodeId,
      collapsed: false,
      notes: "",
    });
  }

  const updatedNodes = existingNodes.map((n) =>
    n.id === nodeId
      ? { ...n, children: [...n.children, ...newChildren.map((c) => c.id)], collapsed: false }
      : n,
  );

  return [...updatedNodes, ...newChildren];
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function toMarkdown(nodes: MindMapNode[], rootId: string): string {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const lines: string[] = [];

  function walk(id: string, depth: number): void {
    const node = nodeMap.get(id);
    if (!node) return;
    const indent = "  ".repeat(depth);
    const bullet = depth === 0 ? "#" : "-";
    const prefix = depth === 0 ? `${bullet} ` : `${indent}${bullet} `;
    lines.push(`${prefix}${node.text}`);
    if (node.notes) {
      lines.push(`${indent}  > ${node.notes}`);
    }
    for (const childId of node.children) {
      walk(childId, depth + 1);
    }
  }

  walk(rootId, 0);
  return lines.join("\n");
}

function toJson(map: MindMap): string {
  return JSON.stringify(map, null, 2);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMindMap() {
  const [maps, setMaps] = useState<MindMap[]>(loadMaps);
  const [activeMapId, setActiveMapId] = useState<string | null>(() => {
    const loaded = loadMaps();
    return loaded.length > 0 ? loaded[0].id : null;
  });

  const historyRef = useRef<MindMapSnapshot[]>([]);
  const futureRef = useRef<MindMapSnapshot[]>([]);

  // Persist on change
  useEffect(() => {
    saveMaps(maps);
  }, [maps]);

  const activeMap = maps.find((m) => m.id === activeMapId) ?? null;

  // ── History helpers ───────────────────────────────────────────────────────

  const pushHistory = useCallback(() => {
    if (!activeMap) return;
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: structuredClone(activeMap.nodes) },
    ];
    futureRef.current = [];
  }, [activeMap]);

  const updateActiveMap = useCallback(
    (updater: (map: MindMap) => MindMap) => {
      setMaps((prev) =>
        prev.map((m) => {
          if (m.id !== activeMapId) return m;
          return updater({ ...m, updatedAt: Date.now() });
        }),
      );
    },
    [activeMapId],
  );

  // ── Map CRUD ──────────────────────────────────────────────────────────────

  const createMap = useCallback((title: string) => {
    const root = createRootNode(title);
    const newMap: MindMap = {
      id: generateId(),
      title,
      nodes: [root],
      rootId: root.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      zoom: 1,
      panX: 0,
      panY: 0,
    };
    setMaps((prev) => [newMap, ...prev]);
    setActiveMapId(newMap.id);
    historyRef.current = [];
    futureRef.current = [];
    return newMap.id;
  }, []);

  const deleteMap = useCallback(
    (mapId: string) => {
      setMaps((prev) => prev.filter((m) => m.id !== mapId));
      if (activeMapId === mapId) {
        setMaps((prev) => {
          setActiveMapId(prev.length > 0 ? prev[0].id : null);
          return prev;
        });
      }
    },
    [activeMapId],
  );

  const setActiveMap = useCallback((mapId: string) => {
    setActiveMapId(mapId);
    historyRef.current = [];
    futureRef.current = [];
  }, []);

  // ── Node operations ───────────────────────────────────────────────────────

  const addNode = useCallback(
    (parentId: string, text: string, shape?: MindMapNode["shape"]) => {
      if (!activeMap) return null;
      pushHistory();
      const parent = activeMap.nodes.find((n) => n.id === parentId);
      if (!parent) return null;

      const depth = getDepth(activeMap.nodes, parentId);
      const nodeId = generateId();
      const newNode: MindMapNode = {
        id: nodeId,
        text,
        x: parent.x + 160,
        y: parent.y + (parent.children.length * 60 - 30),
        color: parent.color,
        size: depth >= 2 ? "small" : "medium",
        shape: shape ?? (depth >= 2 ? "rectangle" : "rounded"),
        children: [],
        parentId,
        collapsed: false,
        notes: "",
      };

      updateActiveMap((map) => ({
        ...map,
        nodes: [
          ...map.nodes.map((n) =>
            n.id === parentId ? { ...n, children: [...n.children, nodeId] } : n,
          ),
          newNode,
        ],
      }));

      return nodeId;
    },
    [activeMap, pushHistory, updateActiveMap],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: Partial<Pick<MindMapNode, "text" | "color" | "size" | "shape" | "notes" | "icon">>) => {
      pushHistory();
      updateActiveMap((map) => ({
        ...map,
        nodes: map.nodes.map((n) => (n.id === nodeId ? { ...n, ...updates } : n)),
      }));
    },
    [pushHistory, updateActiveMap],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      if (!activeMap) return;
      if (nodeId === activeMap.rootId) return; // Can't delete root
      pushHistory();

      // Collect node and all descendants
      const toRemove = new Set<string>();
      function collectDescendants(id: string): void {
        toRemove.add(id);
        const node = activeMap!.nodes.find((n) => n.id === id);
        if (node) node.children.forEach(collectDescendants);
      }
      collectDescendants(nodeId);

      updateActiveMap((map) => ({
        ...map,
        nodes: map.nodes
          .filter((n) => !toRemove.has(n.id))
          .map((n) => ({
            ...n,
            children: n.children.filter((c) => !toRemove.has(c)),
          })),
      }));
    },
    [activeMap, pushHistory, updateActiveMap],
  );

  const moveNode = useCallback(
    (nodeId: string, x: number, y: number) => {
      updateActiveMap((map) => ({
        ...map,
        nodes: map.nodes.map((n) => (n.id === nodeId ? { ...n, x, y } : n)),
      }));
    },
    [updateActiveMap],
  );

  const toggleCollapse = useCallback(
    (nodeId: string) => {
      pushHistory();
      updateActiveMap((map) => ({
        ...map,
        nodes: map.nodes.map((n) =>
          n.id === nodeId ? { ...n, collapsed: !n.collapsed } : n,
        ),
      }));
    },
    [pushHistory, updateActiveMap],
  );

  // ── AI operations ─────────────────────────────────────────────────────────

  const generateFromPrompt = useCallback(
    (prompt: string) => {
      const nodes = simulateGenerateMap(prompt);
      const rootNode = nodes.find((n) => n.parentId === null)!;
      const newMap: MindMap = {
        id: generateId(),
        title: prompt.slice(0, 50) || "AI Generated Map",
        nodes,
        rootId: rootNode.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        zoom: 1,
        panX: 0,
        panY: 0,
      };
      setMaps((prev) => [newMap, ...prev]);
      setActiveMapId(newMap.id);
      historyRef.current = [];
      futureRef.current = [];
      return newMap.id;
    },
    [],
  );

  const expandNode = useCallback(
    (nodeId: string) => {
      if (!activeMap) return;
      pushHistory();
      const expanded = simulateExpandNode(activeMap.nodes, nodeId);
      updateActiveMap((map) => ({ ...map, nodes: expanded }));
    },
    [activeMap, pushHistory, updateActiveMap],
  );

  // ── Layout ────────────────────────────────────────────────────────────────

  const autoLayout = useCallback(
    (mode: "top-down" | "radial" = "radial") => {
      if (!activeMap) return;
      pushHistory();
      const arranged =
        mode === "top-down"
          ? layoutTopDown(activeMap.nodes, activeMap.rootId)
          : layoutRadial(activeMap.nodes, activeMap.rootId);
      updateActiveMap((map) => ({ ...map, nodes: arranged }));
    },
    [activeMap, pushHistory, updateActiveMap],
  );

  // ── Export ────────────────────────────────────────────────────────────────

  const exportAsMarkdown = useCallback((): string => {
    if (!activeMap) return "";
    return toMarkdown(activeMap.nodes, activeMap.rootId);
  }, [activeMap]);

  const exportAsJson = useCallback((): string => {
    if (!activeMap) return "{}";
    return toJson(activeMap);
  }, [activeMap]);

  // ── Undo / Redo ───────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    if (historyRef.current.length === 0 || !activeMap) return;
    const snapshot = historyRef.current.pop()!;
    futureRef.current.push({ nodes: structuredClone(activeMap.nodes) });
    updateActiveMap((map) => ({ ...map, nodes: snapshot.nodes }));
  }, [activeMap, updateActiveMap]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0 || !activeMap) return;
    const snapshot = futureRef.current.pop()!;
    historyRef.current.push({ nodes: structuredClone(activeMap.nodes) });
    updateActiveMap((map) => ({ ...map, nodes: snapshot.nodes }));
  }, [activeMap, updateActiveMap]);

  return {
    maps,
    activeMap,
    createMap,
    deleteMap,
    addNode,
    updateNode,
    deleteNode,
    moveNode,
    toggleCollapse,
    setActiveMap,
    generateFromPrompt,
    expandNode,
    exportAsMarkdown,
    exportAsJson,
    autoLayout,
    undo,
    redo,
  };
}

// ── Utilities (exported for component use) ──────────────────────────────────

export { NODE_COLORS, SIZE_RADIUS };

function getDepth(nodes: MindMapNode[], nodeId: string): number {
  let depth = 0;
  let current = nodes.find((n) => n.id === nodeId);
  while (current?.parentId) {
    depth++;
    current = nodes.find((n) => n.id === current!.parentId);
  }
  return depth;
}
