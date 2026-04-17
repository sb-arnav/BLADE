import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvas, CanvasNode as CanvasNodeType, CanvasEdge } from "../hooks/useCanvas";
import CanvasNodeComponent from "./CanvasNode";

// ── Props ─────────────────────────────────────────────────────────────────────

interface CanvasProps {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── SVG Arrow Marker ID ───────────────────────────────────────────────────────

const ARROW_MARKER_ID = "canvas-arrowhead";

// ── Minimap Constants ─────────────────────────────────────────────────────────

const MINIMAP_WIDTH = 160;
const MINIMAP_HEIGHT = 110;
const MINIMAP_PADDING = 20;

// ── Component ─────────────────────────────────────────────────────────────────

export default function Canvas({ onBack, onSendToChat }: CanvasProps) {
  const {
    state,
    addNode,
    updateNode,
    deleteNode,
    moveNode,
    resizeNode,
    selectNode,
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
  } = useCanvas();

  const canvasRef = useRef<HTMLDivElement>(null);
  const panRef = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [connectLine, setConnectLine] = useState<{ x: number; y: number } | null>(null);
  const [aiPromptNodeId, setAiPromptNodeId] = useState<string | null>(null);
  const [aiPromptText, setAiPromptText] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);

  const { nodes, edges, selectedNodeId, viewport } = state;

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Space for pan mode
      if (e.code === "Space" && !e.repeat && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        setSpaceHeld(true);
        setPanning(true);
      }

      // Delete selected node
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId && !(e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        deleteNode(selectedNodeId);
      }

      // Ctrl+Z / Ctrl+Y for undo/redo
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        }
        if (e.key === "y" || (e.key === "z" && e.shiftKey)) {
          e.preventDefault();
          redo();
        }
        // Ctrl+D to duplicate
        if (e.key === "d" && selectedNodeId) {
          e.preventDefault();
          duplicateNode(selectedNodeId);
        }
      }

      // Escape to deselect or cancel connecting
      if (e.key === "Escape") {
        if (connectingFrom) {
          setConnectingFrom(null);
          setConnectLine(null);
        } else if (aiPromptNodeId) {
          setAiPromptNodeId(null);
          setAiPromptText("");
        } else {
          selectNode(null);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        setSpaceHeld(false);
        setPanning(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedNodeId, connectingFrom, aiPromptNodeId, deleteNode, undo, redo, selectNode, setPanning, duplicateNode]);

  // ── Mouse wheel zoom ──────────────────────────────────────────────────────

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      zoom(delta, cx, cy);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [zoom]);

  // ── Pan via mouse ─────────────────────────────────────────────────────────

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Click on empty area deselects
      if (e.target === canvasRef.current || (e.target as HTMLElement).dataset.canvasBg === "true") {
        selectNode(null);
      }

      // Complete connection on empty canvas click
      if (connectingFrom) {
        setConnectingFrom(null);
        setConnectLine(null);
        return;
      }

      // Middle mouse button or space+left click for panning
      if (e.button === 1 || (e.button === 0 && spaceHeld)) {
        e.preventDefault();
        setPanning(true);
        panRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          vpX: viewport.x,
          vpY: viewport.y,
        };

        const handleMouseMove = (ev: MouseEvent) => {
          if (!panRef.current) return;
          const dx = ev.clientX - panRef.current.startX;
          const dy = ev.clientY - panRef.current.startY;
          pan(dx - (viewport.x - panRef.current.vpX), dy - (viewport.y - panRef.current.vpY));
        };

        const handleMouseUp = () => {
          panRef.current = null;
          setPanning(false);
          window.removeEventListener("mousemove", handleMouseMove);
          window.removeEventListener("mouseup", handleMouseUp);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
      }
    },
    [spaceHeld, connectingFrom, viewport.x, viewport.y, pan, setPanning, selectNode]
  );

  // ── Track connecting line ─────────────────────────────────────────────────

  useEffect(() => {
    if (!connectingFrom) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      setConnectLine({
        x: (e.clientX - rect.left - viewport.x) / viewport.zoom,
        y: (e.clientY - rect.top - viewport.y) / viewport.zoom,
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [connectingFrom, viewport]);

  // ── Handle node connection ────────────────────────────────────────────────

  const handleNodeConnect = useCallback(
    (fromId: string) => {
      if (connectingFrom) {
        // Second click: complete edge
        if (connectingFrom !== fromId) {
          addEdge(connectingFrom, fromId, "arrow");
        }
        setConnectingFrom(null);
        setConnectLine(null);
      } else {
        // First click: start connection
        setConnectingFrom(fromId);
      }
    },
    [connectingFrom, addEdge]
  );

  // ── Handle node select (also completes connections) ───────────────────────

  const handleNodeSelect = useCallback(
    (id: string) => {
      if (connectingFrom && connectingFrom !== id) {
        addEdge(connectingFrom, id, "arrow");
        setConnectingFrom(null);
        setConnectLine(null);
      }
      selectNode(id);
    },
    [connectingFrom, addEdge, selectNode]
  );

  // ── Add node in center of viewport ────────────────────────────────────────

  const addNodeAtCenter = useCallback(
    (type: CanvasNodeType["type"]) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = (rect.width / 2 - viewport.x) / viewport.zoom;
      const cy = (rect.height / 2 - viewport.y) / viewport.zoom;
      const node = addNode(type, cx - 100, cy - 75);

      if (type === "sticky" || type === "text" || type === "code") {
        // Node is added, user can double-click to edit
      }

      return node;
    },
    [viewport, addNode]
  );

  // ── AI prompt node ────────────────────────────────────────────────────────

  const handleAddAiPrompt = useCallback(() => {
    const node = addNodeAtCenter("sticky");
    if (node) {
      setAiPromptNodeId(node.id);
      setAiPromptText("");
      setTimeout(() => aiInputRef.current?.focus(), 100);
    }
  }, [addNodeAtCenter]);

  const handleAiSubmit = useCallback(() => {
    if (!aiPromptNodeId || !aiPromptText.trim()) return;

    // Update the prompt node with the question
    updateNode(aiPromptNodeId, { content: aiPromptText.trim() });

    // Find the prompt node for positioning
    const promptNode = state.nodes.find((n) => n.id === aiPromptNodeId);
    const aiX = promptNode ? promptNode.x + promptNode.width + 60 : 400;
    const aiY = promptNode ? promptNode.y : 200;

    // Create AI response node
    const responseNode = addNode("ai-response", aiX, aiY, "Thinking...");

    // Connect prompt to response
    addEdge(aiPromptNodeId, responseNode.id, "arrow");

    // Send to chat for AI processing
    onSendToChat(aiPromptText.trim());

    setAiPromptNodeId(null);
    setAiPromptText("");
  }, [aiPromptNodeId, aiPromptText, state.nodes, updateNode, addNode, addEdge, onSendToChat]);

  // ── Export handler ────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const md = exportAsMarkdown();
    navigator.clipboard.writeText(md).catch(() => {});
    onSendToChat(md);
  }, [exportAsMarkdown, onSendToChat]);

  // ── Clear handler ─────────────────────────────────────────────────────────

  const handleClear = useCallback(() => {
    if (showClearConfirm) {
      clear();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
      setTimeout(() => setShowClearConfirm(false), 3000);
    }
  }, [showClearConfirm, clear]);

  // ── Get edge endpoints ────────────────────────────────────────────────────

  const getNodeCenter = useCallback(
    (nodeId: string): { x: number; y: number } | null => {
      const n = nodes.find((node) => node.id === nodeId);
      if (!n) return null;
      return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
    },
    [nodes]
  );

  const getEdgePoints = useCallback(
    (edge: CanvasEdge): { x1: number; y1: number; x2: number; y2: number } | null => {
      const fromNode = nodes.find((n) => n.id === edge.from);
      const toNode = nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) return null;

      // From right edge center to left edge center
      return {
        x1: fromNode.x + fromNode.width,
        y1: fromNode.y + fromNode.height / 2,
        x2: toNode.x,
        y2: toNode.y + toNode.height / 2,
      };
    },
    [nodes]
  );

  // ── Minimap data ──────────────────────────────────────────────────────────

  const minimapData = useMemo(() => {
    if (nodes.length === 0) return null;

    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxX = Math.max(...nodes.map((n) => n.x + n.width));
    const maxY = Math.max(...nodes.map((n) => n.y + n.height));

    const contentW = maxX - minX || 1;
    const contentH = maxY - minY || 1;
    const scale = Math.min(
      (MINIMAP_WIDTH - MINIMAP_PADDING) / contentW,
      (MINIMAP_HEIGHT - MINIMAP_PADDING) / contentH
    );

    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const vpW = canvasRect ? canvasRect.width / viewport.zoom : 800;
    const vpH = canvasRect ? canvasRect.height / viewport.zoom : 600;

    const vpLeft = -viewport.x / viewport.zoom;
    const vpTop = -viewport.y / viewport.zoom;

    return {
      nodes: nodes.map((n) => ({
        x: (n.x - minX) * scale + MINIMAP_PADDING / 2,
        y: (n.y - minY) * scale + MINIMAP_PADDING / 2,
        w: n.width * scale,
        h: n.height * scale,
        color: n.type === "sticky" ? n.color : n.type === "ai-response" ? "#6366f1" : "#3f3f46",
        id: n.id,
      })),
      viewport: {
        x: (vpLeft - minX) * scale + MINIMAP_PADDING / 2,
        y: (vpTop - minY) * scale + MINIMAP_PADDING / 2,
        w: vpW * scale,
        h: vpH * scale,
      },
    };
  }, [nodes, viewport]);

  // ── Zoom percentage ───────────────────────────────────────────────────────

  const zoomPercent = Math.round(viewport.zoom * 100);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-blade-bg flex flex-col z-50">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="h-12 border-b border-blade-border flex items-center justify-between px-4 bg-blade-surface shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-secondary hover:text-blade-text transition-colors flex items-center gap-1.5 text-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>
          <div className="w-px h-5 bg-blade-border" />
          <h1 className="text-sm font-medium text-blade-text flex items-center gap-2">
            <svg className="w-4 h-4 text-blade-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            Canvas
          </h1>
          <span className="text-2xs text-blade-muted">
            {nodes.length} node{nodes.length !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <button
            onClick={undo}
            className="p-1.5 text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover rounded transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
            </svg>
          </button>
          <button
            onClick={redo}
            className="p-1.5 text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover rounded transition-colors"
            title="Redo (Ctrl+Y)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a5 5 0 00-5 5v2M21 10l-4-4M21 10l-4 4" />
            </svg>
          </button>

          <div className="w-px h-5 bg-blade-border" />

          {/* Zoom controls */}
          <button
            onClick={() => setZoom(viewport.zoom / 1.2)}
            className="p-1.5 text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover rounded transition-colors"
            title="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          <button
            onClick={resetViewport}
            className="text-xs text-blade-secondary hover:text-blade-text px-2 py-1 hover:bg-blade-surface-hover rounded transition-colors min-w-[48px] text-center"
            title="Reset zoom"
          >
            {zoomPercent}%
          </button>
          <button
            onClick={() => setZoom(viewport.zoom * 1.2)}
            className="p-1.5 text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover rounded transition-colors"
            title="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (rect) fitView(rect.width, rect.height);
            }}
            className="p-1.5 text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover rounded transition-colors"
            title="Fit to view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>

          <div className="w-px h-5 bg-blade-border" />

          {/* Export */}
          <button
            onClick={handleExport}
            className="text-xs text-blade-secondary hover:text-blade-text px-2.5 py-1.5 hover:bg-blade-surface-hover rounded transition-colors"
          >
            Export
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            className={`text-xs px-2.5 py-1.5 rounded transition-colors ${
              showClearConfirm
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
                : "text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover"
            }`}
          >
            {showClearConfirm ? "Confirm Clear" : "Clear"}
          </button>
        </div>
      </div>

      {/* ── Canvas Area ────────────────────────────────────────────────────── */}
      <div
        ref={canvasRef}
        className={`flex-1 relative overflow-hidden ${
          spaceHeld || state.isPanning ? "cursor-grab active:cursor-grabbing" : connectingFrom ? "cursor-crosshair" : "cursor-default"
        }`}
        onMouseDown={handleCanvasMouseDown}
        style={{ backgroundColor: "#09090b" }}
      >
        {/* ── Grid background ──────────────────────────────────────────────── */}
        <div
          className="absolute inset-0 pointer-events-none"
          data-canvas-bg="true"
          style={{
            backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)`,
            backgroundSize: `${20 * viewport.zoom}px ${20 * viewport.zoom}px`,
            backgroundPosition: `${viewport.x % (20 * viewport.zoom)}px ${viewport.y % (20 * viewport.zoom)}px`,
          }}
        />

        {/* ── Transform container ──────────────────────────────────────────── */}
        <div
          className="absolute"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {/* ── SVG Edges Layer ─────────────────────────────────────────────── */}
          <svg
            className="absolute top-0 left-0 pointer-events-none"
            style={{ overflow: "visible", width: 1, height: 1 }}
          >
            <defs>
              <marker
                id={ARROW_MARKER_ID}
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#6366f1" />
              </marker>
            </defs>

            {edges.map((edge) => {
              const pts = getEdgePoints(edge);
              if (!pts) return null;

              return (
                <g key={edge.id}>
                  <line
                    x1={pts.x1}
                    y1={pts.y1}
                    x2={pts.x2}
                    y2={pts.y2}
                    stroke="#6366f1"
                    strokeWidth={2}
                    strokeDasharray={edge.style === "dashed" ? "6 4" : undefined}
                    markerEnd={
                      edge.style === "arrow" ? `url(#${ARROW_MARKER_ID})` : undefined
                    }
                    opacity={0.7}
                  />
                  {/* Clickable hit area for edge deletion */}
                  <line
                    x1={pts.x1}
                    y1={pts.y1}
                    x2={pts.x2}
                    y2={pts.y2}
                    stroke="transparent"
                    strokeWidth={12}
                    className="pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteEdge(edge.id);
                    }}
                  />
                  {edge.label && (
                    <text
                      x={(pts.x1 + pts.x2) / 2}
                      y={(pts.y1 + pts.y2) / 2 - 8}
                      fill="#a1a1aa"
                      fontSize={11}
                      textAnchor="middle"
                      className="pointer-events-none"
                    >
                      {edge.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Connecting line preview */}
            {connectingFrom && connectLine && (() => {
              const fromCenter = getNodeCenter(connectingFrom);
              if (!fromCenter) return null;
              const fromNode = nodes.find((n) => n.id === connectingFrom);
              if (!fromNode) return null;
              return (
                <line
                  x1={fromNode.x + fromNode.width}
                  y1={fromNode.y + fromNode.height / 2}
                  x2={connectLine.x}
                  y2={connectLine.y}
                  stroke="#6366f1"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  opacity={0.5}
                />
              );
            })()}
          </svg>

          {/* ── Nodes ──────────────────────────────────────────────────────── */}
          {nodes.map((node) => (
            <CanvasNodeComponent
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              zoom={viewport.zoom}
              onSelect={handleNodeSelect}
              onMove={moveNode}
              onResize={resizeNode}
              onUpdate={(id, updates) => updateNode(id, updates)}
              onDelete={deleteNode}
              onConnect={handleNodeConnect}
              onDragStart={() => setDragging(true)}
              onDragEnd={() => setDragging(false)}
            />
          ))}
        </div>

        {/* ── AI Prompt Modal ──────────────────────────────────────────────── */}
        {aiPromptNodeId && (
          <div className="absolute inset-0 flex items-center justify-center z-50 bg-black/40">
            <div className="bg-blade-surface border border-blade-border rounded-xl p-5 w-[420px] shadow-2xl animate-fade-in">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-blade-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <h3 className="text-sm font-medium text-blade-text">AI Brainstorm</h3>
              </div>
              <textarea
                ref={aiInputRef}
                value={aiPromptText}
                onChange={(e) => setAiPromptText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    handleAiSubmit();
                  }
                  if (e.key === "Escape") {
                    setAiPromptNodeId(null);
                    setAiPromptText("");
                  }
                }}
                placeholder="Ask AI anything... e.g. 'Generate 5 marketing strategies for a SaaS product'"
                className="w-full h-24 bg-blade-bg border border-blade-border rounded-lg p-3 text-sm text-blade-text placeholder-blade-muted resize-none outline-none focus:border-blade-accent transition-colors"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-2xs text-blade-muted">Ctrl+Enter to send</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setAiPromptNodeId(null);
                      setAiPromptText("");
                    }}
                    className="px-3 py-1.5 text-xs text-blade-secondary hover:text-blade-text rounded-lg hover:bg-blade-surface-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAiSubmit}
                    disabled={!aiPromptText.trim()}
                    className="px-3 py-1.5 text-xs bg-blade-accent text-white rounded-lg hover:bg-blade-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Generate
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Minimap ──────────────────────────────────────────────────────── */}
        {minimapData && (
          <div
            className="absolute bottom-16 right-4 border border-blade-border rounded-lg bg-blade-surface/80 backdrop-blur-sm overflow-hidden"
            style={{ width: MINIMAP_WIDTH, height: MINIMAP_HEIGHT }}
          >
            <svg width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT}>
              {/* Viewport rectangle */}
              <rect
                x={minimapData.viewport.x}
                y={minimapData.viewport.y}
                width={minimapData.viewport.w}
                height={minimapData.viewport.h}
                fill="rgba(99, 102, 241, 0.08)"
                stroke="rgba(99, 102, 241, 0.4)"
                strokeWidth={1}
                rx={2}
              />
              {/* Node rectangles */}
              {minimapData.nodes.map((mn) => (
                <rect
                  key={mn.id}
                  x={mn.x}
                  y={mn.y}
                  width={Math.max(mn.w, 3)}
                  height={Math.max(mn.h, 2)}
                  fill={mn.color}
                  rx={1}
                  opacity={0.8}
                />
              ))}
            </svg>
          </div>
        )}

        {/* ── Connection hint ──────────────────────────────────────────────── */}
        {connectingFrom && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-blade-accent/20 text-blade-accent text-xs px-3 py-1.5 rounded-full border border-blade-accent/30 animate-fade-in">
            Click a node to connect, or press Escape to cancel
          </div>
        )}
      </div>

      {/* ── Bottom Toolbar ─────────────────────────────────────────────────── */}
      <div className="h-14 border-t border-blade-border bg-blade-surface flex items-center justify-center gap-2 px-4 shrink-0">
        <ToolbarButton
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          }
          label="Sticky Note"
          shortcut="S"
          color="#fbbf24"
          onClick={() => addNodeAtCenter("sticky")}
        />
        <ToolbarButton
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          }
          label="Text"
          shortcut="T"
          onClick={() => addNodeAtCenter("text")}
        />
        <ToolbarButton
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
          }
          label="Code"
          shortcut="C"
          onClick={() => addNodeAtCenter("code")}
        />

        <div className="w-px h-6 bg-blade-border mx-1" />

        <ToolbarButton
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          }
          label="AI Prompt"
          shortcut="A"
          accent
          onClick={handleAddAiPrompt}
        />

        {/* Right-side info */}
        <div className="absolute right-4 flex items-center gap-3 text-2xs text-blade-muted">
          <span>Scroll to zoom</span>
          <span className="text-blade-border">|</span>
          <span>Space+drag to pan</span>
          <span className="text-blade-border">|</span>
          <span>Del to remove</span>
        </div>
      </div>
    </div>
  );
}

// ── Toolbar Button ────────────────────────────────────────────────────────────

function ToolbarButton({
  icon,
  label,
  shortcut,
  color,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  color?: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
        accent
          ? "bg-blade-accent/15 text-blade-accent hover:bg-blade-accent/25 border border-blade-accent/30"
          : "text-blade-secondary hover:text-blade-text hover:bg-blade-surface-hover"
      }`}
      title={`${label}${shortcut ? ` (${shortcut})` : ""}`}
    >
      {color && (
        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
      )}
      {!color && icon}
      <span>{label}</span>
      {shortcut && (
        <kbd className="text-2xs text-blade-muted bg-blade-bg/50 px-1 py-0.5 rounded">
          {shortcut}
        </kbd>
      )}
    </button>
  );
}
