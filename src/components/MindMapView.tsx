import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMindMap, MindMapNode, NODE_COLORS, SIZE_RADIUS } from "../hooks/useMindMap";

// ── Props ─────────────────────────────────────────────────────────────────────

interface MindMapViewProps {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3.0;
const MINIMAP_W = 160;
const MINIMAP_H = 110;
const EDGE_CURVE = 0.4;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function nodeRadius(size: MindMapNode["size"]): number {
  return SIZE_RADIUS[size];
}

function nodeDimensions(node: MindMapNode): { w: number; h: number } {
  const r = nodeRadius(node.size);
  if (node.shape === "circle") return { w: r * 2, h: r * 2 };
  if (node.shape === "rectangle") return { w: r * 2.4, h: r * 1.4 };
  return { w: r * 2.2, h: r * 1.6 }; // rounded
}

function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = x2 - x1;
  const cx1 = x1 + dx * EDGE_CURVE;
  const cy1 = y1;
  const cx2 = x2 - dx * EDGE_CURVE;
  const cy2 = y2;
  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MindMapView({ onBack, onSendToChat }: MindMapViewProps) {
  const {
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
  } = useMindMap();

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Local state ─────────────────────────────────────────────────────────

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleText, setTitleText] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [layoutMode, setLayoutMode] = useState<"radial" | "top-down">("radial");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  // Drag state
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const selectedNode = activeMap?.nodes.find((n) => n.id === selectedId) ?? null;
  const nodeMap = useMemo(() => {
    if (!activeMap) return new Map<string, MindMapNode>();
    return new Map(activeMap.nodes.map((n) => [n.id, n]));
  }, [activeMap]);

  // ── Sync title editing ────────────────────────────────────────────────────

  useEffect(() => {
    if (activeMap && editingTitle) setTitleText(activeMap.title);
  }, [editingTitle, activeMap]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target;
      const isInput = t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;

      if (e.code === "Space" && !e.repeat && !isInput) {
        e.preventDefault();
        setSpaceHeld(true);
      }

      if (e.key === "Escape") {
        if (editingId) {
          setEditingId(null);
        } else if (showGenerateModal) {
          setShowGenerateModal(false);
        } else if (showNoteEditor) {
          setShowNoteEditor(false);
        } else {
          setSelectedId(null);
          setShowColorPicker(false);
        }
        return;
      }

      if (isInput) return;

      // Ctrl+Z / Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
      }

      if (!activeMap || !selectedId) return;

      // Tab — add sibling
      if (e.key === "Tab") {
        e.preventDefault();
        const node = nodeMap.get(selectedId);
        if (node?.parentId) {
          const newId = addNode(node.parentId, "New sibling");
          if (newId) {
            setSelectedId(newId);
            setEditingId(newId);
            setEditText("New sibling");
          }
        }
      }

      // Enter — add child
      if (e.key === "Enter") {
        e.preventDefault();
        const newId = addNode(selectedId, "New idea");
        if (newId) {
          setSelectedId(newId);
          setEditingId(newId);
          setEditText("New idea");
        }
      }

      // Delete
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const node = nodeMap.get(selectedId);
        if (node?.parentId) {
          setSelectedId(node.parentId);
          deleteNode(selectedId);
        }
      }

      // Space to collapse (only when not panning)
      if (e.code === "Space" && !spaceHeld) {
        toggleCollapse(selectedId);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [editingId, selectedId, activeMap, nodeMap, spaceHeld, showGenerateModal, showNoteEditor, undo, redo, addNode, deleteNode, toggleCollapse]);

  // ── Mouse wheel zoom ──────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      setZoom((prev) => clamp(prev + delta * prev, MIN_ZOOM, MAX_ZOOM));
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Pan handlers ──────────────────────────────────────────────────────────

  const handleBgMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === svgRef.current || (e.target as SVGElement).dataset.bg === "true") {
        setSelectedId(null);
        setShowColorPicker(false);
      }

      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        e.preventDefault();
        setIsPanning(true);
        panRef.current = { sx: e.clientX, sy: e.clientY, px: panX, py: panY };

        const onMove = (ev: MouseEvent) => {
          if (!panRef.current) return;
          setPanX(panRef.current.px + (ev.clientX - panRef.current.sx));
          setPanY(panRef.current.py + (ev.clientY - panRef.current.sy));
        };

        const onUp = () => {
          panRef.current = null;
          setIsPanning(false);
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };

        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }
    },
    [spaceHeld, panX, panY],
  );

  // ── Node drag handlers ────────────────────────────────────────────────────

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      if (spaceHeld || e.button !== 0) return;
      e.stopPropagation();
      setSelectedId(nodeId);

      const node = nodeMap.get(nodeId);
      if (!node) return;

      dragRef.current = {
        nodeId,
        startX: e.clientX,
        startY: e.clientY,
        origX: node.x,
        origY: node.y,
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = (ev.clientX - dragRef.current.startX) / zoom;
        const dy = (ev.clientY - dragRef.current.startY) / zoom;
        moveNode(dragRef.current.nodeId, dragRef.current.origX + dx, dragRef.current.origY + dy);
      };

      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [spaceHeld, nodeMap, zoom, moveNode],
  );

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      const node = nodeMap.get(nodeId);
      if (!node) return;
      setEditingId(nodeId);
      setEditText(node.text);
    },
    [nodeMap],
  );

  const commitEdit = useCallback(() => {
    if (editingId && editText.trim()) {
      updateNode(editingId, { text: editText.trim() });
    }
    setEditingId(null);
  }, [editingId, editText, updateNode]);

  // ── Collect visible edges ─────────────────────────────────────────────────

  const visibleEdges = useMemo(() => {
    if (!activeMap) return [];
    const edges: { from: MindMapNode; to: MindMapNode }[] = [];
    const collapsedSet = new Set<string>();

    function markCollapsed(id: string): void {
      collapsedSet.add(id);
      const node = nodeMap.get(id);
      if (node) node.children.forEach(markCollapsed);
    }

    for (const node of activeMap.nodes) {
      if (node.collapsed) node.children.forEach(markCollapsed);
    }

    for (const node of activeMap.nodes) {
      if (collapsedSet.has(node.id)) continue;
      for (const childId of node.children) {
        if (collapsedSet.has(childId)) continue;
        const child = nodeMap.get(childId);
        if (child) edges.push({ from: node, to: child });
      }
    }
    return edges;
  }, [activeMap, nodeMap]);

  const visibleNodes = useMemo(() => {
    if (!activeMap) return [];
    const collapsedSet = new Set<string>();

    function markCollapsed(id: string): void {
      collapsedSet.add(id);
      const node = nodeMap.get(id);
      if (node) node.children.forEach(markCollapsed);
    }

    for (const node of activeMap.nodes) {
      if (node.collapsed) node.children.forEach(markCollapsed);
    }

    return activeMap.nodes.filter((n) => !collapsedSet.has(n.id));
  }, [activeMap, nodeMap]);

  // ── Minimap bounds ────────────────────────────────────────────────────────

  const bounds = useMemo(() => {
    if (visibleNodes.length === 0) return { minX: -200, minY: -200, maxX: 200, maxY: 200 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of visibleNodes) {
      const { w, h } = nodeDimensions(n);
      minX = Math.min(minX, n.x - w / 2);
      maxX = Math.max(maxX, n.x + w / 2);
      minY = Math.min(minY, n.y - h / 2);
      maxY = Math.max(maxY, n.y + h / 2);
    }
    const pad = 80;
    return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  }, [visibleNodes]);

  // ── Render node shape ─────────────────────────────────────────────────────

  const renderNodeShape = useCallback(
    (node: MindMapNode) => {
      const { w, h } = nodeDimensions(node);
      const isRoot = activeMap ? node.id === activeMap.rootId : false;
      const isSelected = node.id === selectedId;
      const fill = node.color + "22";
      const stroke = node.color;
      const strokeW = isSelected ? 3 : isRoot ? 2.5 : 1.5;
      const glow = isSelected ? `0 0 16px ${node.color}88` : "none";

      const common = {
        fill,
        stroke,
        strokeWidth: strokeW,
        style: { filter: isSelected ? `drop-shadow(${glow})` : undefined },
      };

      if (node.shape === "circle") {
        return <ellipse cx={0} cy={0} rx={w / 2} ry={h / 2} {...common} />;
      }
      if (node.shape === "rectangle") {
        return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={4} ry={4} {...common} />;
      }
      // rounded
      return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} ry={h / 2} {...common} />;
    },
    [activeMap, selectedId],
  );

  // ── Generate modal ────────────────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    if (!generatePrompt.trim()) return;
    generateFromPrompt(generatePrompt.trim());
    setGeneratePrompt("");
    setShowGenerateModal(false);
  }, [generatePrompt, generateFromPrompt]);

  // ── Toolbar actions ───────────────────────────────────────────────────────

  const handleAddChild = useCallback(() => {
    if (!selectedId) return;
    const newId = addNode(selectedId, "New idea");
    if (newId) {
      setSelectedId(newId);
      setEditingId(newId);
      setEditText("New idea");
    }
  }, [selectedId, addNode]);

  const handleExpandAI = useCallback(() => {
    if (!selectedId) return;
    expandNode(selectedId);
    autoLayout(layoutMode);
  }, [selectedId, expandNode, autoLayout, layoutMode]);

  const handleOpenNotes = useCallback(() => {
    if (!selectedNode) return;
    setNoteText(selectedNode.notes);
    setShowNoteEditor(true);
  }, [selectedNode]);

  const handleSaveNote = useCallback(() => {
    if (selectedId) updateNode(selectedId, { notes: noteText });
    setShowNoteEditor(false);
  }, [selectedId, noteText, updateNode]);

  const handleExportMd = useCallback(() => {
    const md = exportAsMarkdown();
    onSendToChat(md);
  }, [exportAsMarkdown, onSendToChat]);

  const handleExportJson = useCallback(() => {
    const json = exportAsJson();
    navigator.clipboard.writeText(json).catch(() => {});
  }, [exportAsJson]);

  const handleAutoLayout = useCallback(() => {
    autoLayout(layoutMode);
  }, [autoLayout, layoutMode]);

  const handleToggleLayout = useCallback(() => {
    const next = layoutMode === "radial" ? "top-down" : "radial";
    setLayoutMode(next);
    autoLayout(next);
  }, [layoutMode, autoLayout]);

  const handleZoomIn = useCallback(() => setZoom((z) => clamp(z + 0.15, MIN_ZOOM, MAX_ZOOM)), []);
  const handleZoomOut = useCallback(() => setZoom((z) => clamp(z - 0.15, MIN_ZOOM, MAX_ZOOM)), []);
  const handleZoomReset = useCallback(() => { setZoom(1); setPanX(0); setPanY(0); }, []);

  // ── Sidebar ───────────────────────────────────────────────────────────────

  const handleNewMap = useCallback(() => {
    createMap("Untitled Map");
  }, [createMap]);

  const handleTitleCommit = useCallback(() => {
    if (!activeMap) return;
    if (titleText.trim() && titleText.trim() !== activeMap.title) {
      updateNode(activeMap.rootId, { text: titleText.trim() });
    }
    setEditingTitle(false);
  }, [activeMap, titleText, updateNode]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-[#09090b] text-white select-none overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      {showSidebar && (
        <div className="w-56 flex-shrink-0 border-r border-[rgba(255,255,255,0.07)] bg-[#09090b] flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[rgba(255,255,255,0.07)]">
            <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider">Mind Maps</span>
            <button
              onClick={handleNewMap}
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] transition-colors text-lg leading-none"
              title="New map"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
            {maps.map((m) => (
              <div
                key={m.id}
                className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  m.id === activeMap?.id ? "bg-[rgba(255,255,255,0.04)] text-white" : "text-[rgba(255,255,255,0.5)] hover:bg-[rgba(255,255,255,0.04)]/50 hover:text-[rgba(255,255,255,0.85)]"
                }`}
                onClick={() => setActiveMap(m.id)}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" strokeWidth="2" />
                  <path strokeWidth="2" d="M12 2v4m0 12v4M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
                </svg>
                <span className="text-xs truncate flex-1">{m.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteMap(m.id); }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center text-[rgba(255,255,255,0.4)] hover:text-red-400 transition-all text-[10px]"
                  title="Delete map"
                >
                  x
                </button>
              </div>
            ))}
            {maps.length === 0 && (
              <div className="text-xs text-[rgba(255,255,255,0.3)] px-2 py-4 text-center">No maps yet. Create one or generate with AI.</div>
            )}
          </div>
        </div>
      )}

      {/* ── Main area ──────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[rgba(255,255,255,0.07)] bg-[#09090b]">
          <button onClick={onBack} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] transition-colors text-xs px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.04)]" title="Back">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <button onClick={() => setShowSidebar((s) => !s)} className="text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] transition-colors px-1" title="Toggle sidebar">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M4 6h16M4 12h10M4 18h16" /></svg>
          </button>

          <div className="mx-2 h-4 w-px bg-[rgba(255,255,255,0.07)]" />

          {/* Title */}
          {editingTitle ? (
            <input
              autoFocus
              className="bg-transparent text-sm font-medium text-white border-b border-indigo-500 outline-none px-1 w-48"
              value={titleText}
              onChange={(e) => setTitleText(e.target.value)}
              onBlur={handleTitleCommit}
              onKeyDown={(e) => { if (e.key === "Enter") handleTitleCommit(); if (e.key === "Escape") setEditingTitle(false); }}
            />
          ) : (
            <span
              className="text-sm font-medium text-[rgba(255,255,255,0.85)] cursor-pointer hover:text-white truncate max-w-[200px]"
              onDoubleClick={() => { if (activeMap) setEditingTitle(true); }}
              title="Double-click to rename"
            >
              {activeMap?.title ?? "No map selected"}
            </span>
          )}

          <div className="flex-1" />

          {/* Zoom controls */}
          <div className="flex items-center gap-0.5">
            <button onClick={handleZoomOut} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] px-1.5 py-0.5 text-xs rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors">-</button>
            <button onClick={handleZoomReset} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] px-1.5 py-0.5 text-xs rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors min-w-[40px] text-center">
              {Math.round(zoom * 100)}%
            </button>
            <button onClick={handleZoomIn} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] px-1.5 py-0.5 text-xs rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors">+</button>
          </div>

          <div className="mx-1 h-4 w-px bg-[rgba(255,255,255,0.07)]" />

          {/* Layout toggle */}
          <button onClick={handleToggleLayout} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] text-xs px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors" title={`Layout: ${layoutMode}`}>
            {layoutMode === "radial" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2" strokeWidth="2" /><circle cx="12" cy="12" r="8" strokeWidth="1.5" strokeDasharray="3 3" /></svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M12 3v6m0 6v6M6 9h12M3 15h6m6 0h6" /></svg>
            )}
          </button>
          <button onClick={handleAutoLayout} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] text-xs px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors" title="Auto-layout">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" /></svg>
          </button>

          <div className="mx-1 h-4 w-px bg-[rgba(255,255,255,0.07)]" />

          {/* Export */}
          <button onClick={handleExportMd} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] text-xs px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors" title="Send to chat as markdown">
            MD
          </button>
          <button onClick={handleExportJson} className="text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] text-xs px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.04)] transition-colors" title="Copy JSON to clipboard">
            JSON
          </button>

          <div className="mx-1 h-4 w-px bg-[rgba(255,255,255,0.07)]" />

          {/* Generate */}
          <button
            onClick={() => setShowGenerateModal(true)}
            className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            Generate Map
          </button>
        </div>

        {/* ── Canvas ─────────────────────────────────────────────────────── */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          style={{ cursor: spaceHeld || isPanning ? "grabbing" : "default" }}
        >
          {activeMap ? (
            <>
              <svg
                ref={svgRef}
                className="w-full h-full"
                onMouseDown={handleBgMouseDown}
              >
                {/* Background grid */}
                <defs>
                  <pattern id="mm-grid" width={40 * zoom} height={40 * zoom} patternUnits="userSpaceOnUse" x={panX % (40 * zoom)} y={panY % (40 * zoom)}>
                    <circle cx={1} cy={1} r={0.8} fill="#ffffff08" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#mm-grid)" data-bg="true" />

                {/* Transform group */}
                <g transform={`translate(${panX + (containerRef.current?.clientWidth ?? 0) / 2}, ${panY + (containerRef.current?.clientHeight ?? 0) / 2}) scale(${zoom})`}>
                  {/* Edges */}
                  {visibleEdges.map(({ from, to }) => (
                    <path
                      key={`${from.id}-${to.id}`}
                      d={curvedPath(from.x, from.y, to.x, to.y)}
                      fill="none"
                      stroke={from.color + "66"}
                      strokeWidth={1.5}
                      className="transition-all duration-300"
                    />
                  ))}

                  {/* Nodes */}
                  {visibleNodes.map((node) => {
                    const isEditing = editingId === node.id;
                    const { w } = nodeDimensions(node);
                    const fontSize = node.size === "large" ? 14 : node.size === "medium" ? 12 : 10;
                    const hasChildren = node.children.length > 0;
                    const isRoot = node.id === activeMap.rootId;

                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                        onDoubleClick={() => handleNodeDoubleClick(node.id)}
                        className="cursor-pointer"
                        style={{ transition: dragRef.current?.nodeId === node.id ? "none" : "transform 0.3s ease" }}
                      >
                        {renderNodeShape(node)}

                        {/* Collapse indicator */}
                        {hasChildren && node.collapsed && (
                          <circle cx={w / 2 - 4} cy={-nodeRadius(node.size) + 4} r={5} fill={node.color} stroke="#0e0e10" strokeWidth={1}>
                            <title>{node.children.length} hidden children</title>
                          </circle>
                        )}

                        {/* Icon */}
                        {node.icon && (
                          <text x={0} y={-fontSize} textAnchor="middle" fontSize={14} className="select-none pointer-events-none">
                            {node.icon}
                          </text>
                        )}

                        {/* Text or edit input */}
                        {isEditing ? (
                          <foreignObject x={-w / 2 + 4} y={-fontSize} width={w - 8} height={fontSize * 2.5}>
                            <input
                              autoFocus
                              className="w-full bg-transparent text-white text-center outline-none border-b border-indigo-500"
                              style={{ fontSize }}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
                            />
                          </foreignObject>
                        ) : (
                          <text
                            x={0}
                            y={node.icon ? fontSize * 0.6 : fontSize * 0.35}
                            textAnchor="middle"
                            fontSize={fontSize}
                            fontWeight={isRoot ? 600 : 400}
                            fill="#e4e4e7"
                            className="select-none pointer-events-none"
                          >
                            {node.text.length > 24 ? node.text.slice(0, 22) + "..." : node.text}
                          </text>
                        )}

                        {/* Notes indicator */}
                        {node.notes && !isEditing && (
                          <circle cx={w / 2 - 8} cy={nodeRadius(node.size) - 8} r={3} fill="#fbbf24" opacity={0.7} />
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>

              {/* ── Minimap ──────────────────────────────────────────────── */}
              <div
                className="absolute bottom-3 right-3 rounded border border-[rgba(255,255,255,0.1)] bg-[#111114cc] backdrop-blur-sm overflow-hidden"
                style={{ width: MINIMAP_W, height: MINIMAP_H }}
              >
                <svg width={MINIMAP_W} height={MINIMAP_H}>
                  <rect width={MINIMAP_W} height={MINIMAP_H} fill="#0e0e10" />
                  {visibleNodes.map((node) => {
                    const bw = bounds.maxX - bounds.minX || 1;
                    const bh = bounds.maxY - bounds.minY || 1;
                    const nx = ((node.x - bounds.minX) / bw) * (MINIMAP_W - 8) + 4;
                    const ny = ((node.y - bounds.minY) / bh) * (MINIMAP_H - 8) + 4;
                    return (
                      <circle
                        key={node.id}
                        cx={nx}
                        cy={ny}
                        r={node.id === activeMap.rootId ? 3 : 1.5}
                        fill={node.color}
                        opacity={0.8}
                      />
                    );
                  })}
                  {visibleEdges.map(({ from, to }) => {
                    const bw = bounds.maxX - bounds.minX || 1;
                    const bh = bounds.maxY - bounds.minY || 1;
                    const x1 = ((from.x - bounds.minX) / bw) * (MINIMAP_W - 8) + 4;
                    const y1 = ((from.y - bounds.minY) / bh) * (MINIMAP_H - 8) + 4;
                    const x2 = ((to.x - bounds.minX) / bw) * (MINIMAP_W - 8) + 4;
                    const y2 = ((to.y - bounds.minY) / bh) * (MINIMAP_H - 8) + 4;
                    return (
                      <line
                        key={`mm-${from.id}-${to.id}`}
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke={from.color + "44"}
                        strokeWidth={0.5}
                      />
                    );
                  })}
                </svg>
              </div>

              {/* ── Node toolbar (on selection) ──────────────────────────── */}
              {selectedNode && !editingId && (
                <div
                  className="absolute flex items-center gap-1 px-2 py-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#18181bee] backdrop-blur-sm shadow-xl transition-all duration-200"
                  style={{
                    left: (selectedNode.x * zoom) + panX + (containerRef.current?.clientWidth ?? 0) / 2,
                    top: (selectedNode.y * zoom) + panY + (containerRef.current?.clientHeight ?? 0) / 2 - nodeRadius(selectedNode.size) * zoom - 48,
                    transform: "translateX(-50%)",
                    zIndex: 50,
                  }}
                >
                  <ToolbarBtn title="Edit text" onClick={() => handleNodeDoubleClick(selectedId!)}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path strokeWidth="2" d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </ToolbarBtn>
                  <ToolbarBtn title="Add child" onClick={handleAddChild}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M12 5v14m-7-7h14" /></svg>
                  </ToolbarBtn>
                  <ToolbarBtn title="Expand with AI" onClick={handleExpandAI}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                  </ToolbarBtn>
                  <ToolbarBtn title="Color" onClick={() => setShowColorPicker((s) => !s)}>
                    <div className="w-3 h-3 rounded-full border border-[rgba(255,255,255,0.2)]" style={{ backgroundColor: selectedNode.color }} />
                  </ToolbarBtn>
                  <ToolbarBtn title="Notes" onClick={handleOpenNotes}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </ToolbarBtn>
                  {selectedNode.children.length > 0 && (
                    <ToolbarBtn title={selectedNode.collapsed ? "Expand" : "Collapse"} onClick={() => toggleCollapse(selectedId!)}>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {selectedNode.collapsed
                          ? <path strokeWidth="2" d="M19 9l-7 7-7-7" />
                          : <path strokeWidth="2" d="M5 15l7-7 7 7" />}
                      </svg>
                    </ToolbarBtn>
                  )}
                  {selectedNode.parentId && (
                    <ToolbarBtn title="Delete" onClick={() => { deleteNode(selectedId!); setSelectedId(selectedNode.parentId); }}>
                      <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </ToolbarBtn>
                  )}
                </div>
              )}

              {/* ── Color picker popup ───────────────────────────────────── */}
              {showColorPicker && selectedId && (
                <div
                  className="absolute z-50 flex gap-1.5 p-2 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] shadow-xl"
                  style={{
                    left: (selectedNode!.x * zoom) + panX + (containerRef.current?.clientWidth ?? 0) / 2,
                    top: (selectedNode!.y * zoom) + panY + (containerRef.current?.clientHeight ?? 0) / 2 - nodeRadius(selectedNode!.size) * zoom - 88,
                    transform: "translateX(-50%)",
                  }}
                >
                  {NODE_COLORS.map((c) => (
                    <button
                      key={c}
                      className={`w-5 h-5 rounded-full border-2 transition-transform hover:scale-125 ${c === selectedNode?.color ? "border-white" : "border-transparent"}`}
                      style={{ backgroundColor: c }}
                      onClick={() => { updateNode(selectedId, { color: c }); setShowColorPicker(false); }}
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            /* ── Empty state ──────────────────────────────────────────── */
            <div className="flex-1 flex items-center justify-center h-full">
              <div className="text-center space-y-4">
                <svg className="w-16 h-16 mx-auto text-[rgba(255,255,255,0.2)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="3" strokeWidth="1.5" />
                  <path strokeWidth="1.5" d="M12 2v4m0 12v4M2 12h4m12 0h4" />
                  <circle cx="12" cy="12" r="9" strokeWidth="1" strokeDasharray="4 4" />
                </svg>
                <p className="text-[rgba(255,255,255,0.4)] text-sm">No mind map selected</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={handleNewMap} className="text-xs px-3 py-1.5 rounded bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.7)] transition-colors">
                    New Map
                  </button>
                  <button onClick={() => setShowGenerateModal(true)} className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                    Generate with AI
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Generate Map Modal ────────────────────────────────────────────── */}
      {showGenerateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowGenerateModal(false)}>
          <div className="w-[420px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.85)] mb-3">Generate Mind Map with AI</h3>
            <p className="text-xs text-[rgba(255,255,255,0.4)] mb-3">Describe a topic or idea and AI will create a structured mind map for you.</p>
            <textarea
              autoFocus
              className="w-full h-24 rounded-lg bg-[#09090b] border border-[rgba(255,255,255,0.1)] text-sm text-[rgba(255,255,255,0.85)] p-3 outline-none focus:border-indigo-500 resize-none placeholder-zinc-600"
              placeholder="e.g. Machine learning fundamentals and applications..."
              value={generatePrompt}
              onChange={(e) => setGeneratePrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleGenerate(); }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowGenerateModal(false)} className="text-xs px-3 py-1.5 rounded bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.5)] transition-colors">
                Cancel
              </button>
              <button onClick={handleGenerate} disabled={!generatePrompt.trim()} className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors">
                Generate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Note Editor Modal ─────────────────────────────────────────────── */}
      {showNoteEditor && selectedNode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowNoteEditor(false)}>
          <div className="w-[400px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.85)] mb-1">Notes: {selectedNode.text}</h3>
            <textarea
              autoFocus
              className="w-full h-32 mt-2 rounded-lg bg-[#09090b] border border-[rgba(255,255,255,0.1)] text-sm text-[rgba(255,255,255,0.85)] p-3 outline-none focus:border-indigo-500 resize-none placeholder-zinc-600"
              placeholder="Add notes about this topic..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => setShowNoteEditor(false)} className="text-xs px-3 py-1.5 rounded bg-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.5)] transition-colors">
                Cancel
              </button>
              <button onClick={handleSaveNote} className="text-xs px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Toolbar Button ──────────────────────────────────────────────────────────

function ToolbarBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-7 h-7 flex items-center justify-center rounded hover:bg-[rgba(255,255,255,0.07)] text-[rgba(255,255,255,0.5)] hover:text-[rgba(255,255,255,0.85)] transition-colors"
    >
      {children}
    </button>
  );
}
