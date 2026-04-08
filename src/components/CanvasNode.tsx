import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode as CanvasNodeType } from "../hooks/useCanvas";

// ── Constants ─────────────────────────────────────────────────────────────────

const STICKY_COLORS = ["#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"];

const MIN_WIDTH = 100;
const MIN_HEIGHT = 60;

// ── Props ─────────────────────────────────────────────────────────────────────

interface CanvasNodeProps {
  node: CanvasNodeType;
  isSelected: boolean;
  zoom: number;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onUpdate: (id: string, updates: Partial<Pick<CanvasNodeType, "content" | "color" | "locked">>) => void;
  onDelete: (id: string) => void;
  onConnect: (fromId: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CanvasNode({
  node,
  isSelected,
  zoom,
  onSelect,
  onMove,
  onResize,
  onUpdate,
  onDelete,
  onConnect,
  onDragStart,
  onDragEnd,
}: CanvasNodeProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(node.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; nodeX: number; nodeY: number } | null>(null);
  const resizeRef = useRef<{ startX: number; startY: number; nodeW: number; nodeH: number } | null>(null);

  // Sync edit content when node content changes externally
  useEffect(() => {
    if (!isEditing) setEditContent(node.content);
  }, [node.content, isEditing]);

  // Focus textarea when editing starts
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length
      );
    }
  }, [isEditing]);

  // ── Drag handling ─────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (node.locked || e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      onSelect(node.id);
      onDragStart();

      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = (ev.clientX - dragRef.current.startX) / zoom;
        const dy = (ev.clientY - dragRef.current.startY) / zoom;
        onMove(node.id, dragRef.current.nodeX + dx, dragRef.current.nodeY + dy);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        onDragEnd();
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [node.id, node.x, node.y, node.locked, zoom, onSelect, onMove, onDragStart, onDragEnd]
  );

  // ── Resize handling ───────────────────────────────────────────────────────

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (node.locked) return;
      e.stopPropagation();
      e.preventDefault();

      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        nodeW: node.width,
        nodeH: node.height,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const dw = (ev.clientX - resizeRef.current.startX) / zoom;
        const dh = (ev.clientY - resizeRef.current.startY) / zoom;
        onResize(
          node.id,
          Math.max(MIN_WIDTH, resizeRef.current.nodeW + dw),
          Math.max(MIN_HEIGHT, resizeRef.current.nodeH + dh)
        );
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [node.id, node.width, node.height, node.locked, zoom, onResize]
  );

  // ── Connection port ───────────────────────────────────────────────────────

  const handleConnectStart = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onConnect(node.id);
    },
    [node.id, onConnect]
  );

  // ── Editing ───────────────────────────────────────────────────────────────

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.locked || node.type === "ai-response" || node.type === "image") return;
      setIsEditing(true);
    },
    [node.locked, node.type]
  );

  const commitEdit = useCallback(() => {
    setIsEditing(false);
    if (editContent !== node.content) {
      onUpdate(node.id, { content: editContent });
    }
  }, [editContent, node.content, node.id, onUpdate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditContent(node.content);
        setIsEditing(false);
      }
      // Allow Tab for code nodes
      if (e.key === "Tab" && node.type === "code") {
        e.preventDefault();
        const ta = textareaRef.current;
        if (ta) {
          const start = ta.selectionStart;
          const end = ta.selectionEnd;
          const val = ta.value;
          setEditContent(val.substring(0, start) + "  " + val.substring(end));
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start + 2;
          });
        }
      }
    },
    [node.content, node.type]
  );

  // ── Styles based on node type ─────────────────────────────────────────────

  const getNodeClasses = (): string => {
    const base = "absolute group select-none transition-shadow duration-150";
    const selected = isSelected ? "ring-2 ring-blade-accent shadow-lg shadow-blade-accent/20" : "";
    const hover = !isSelected && isHovered ? "ring-1 ring-blade-border-hover" : "";

    switch (node.type) {
      case "sticky":
        return `${base} ${selected} ${hover} rounded-xl`;
      case "text":
        return `${base} ${selected} ${hover} rounded-lg border border-blade-border`;
      case "code":
        return `${base} ${selected} ${hover} rounded-lg border border-blade-border`;
      case "ai-response":
        return `${base} ${selected} ${hover} rounded-lg border-l-[3px] border border-blade-border`;
      case "image":
        return `${base} ${selected} ${hover} rounded-lg border border-blade-border overflow-hidden`;
      default:
        return `${base} ${selected} ${hover} rounded-lg`;
    }
  };

  const getBackgroundStyle = (): React.CSSProperties => {
    switch (node.type) {
      case "sticky":
        return { backgroundColor: node.color, color: "#1a1a1a" };
      case "text":
        return { backgroundColor: "#0f0f12", color: "#ececef" };
      case "code":
        return { backgroundColor: "#0c0c0f", color: "#ececef" };
      case "ai-response":
        return { backgroundColor: "#0f0f12", color: "#ececef", borderLeftColor: "#6366f1" };
      case "image":
        return { backgroundColor: "#0f0f12" };
      default:
        return { backgroundColor: "#0f0f12", color: "#ececef" };
    }
  };

  // ── Render content based on type ──────────────────────────────────────────

  const renderContent = () => {
    if (isEditing) {
      return (
        <textarea
          ref={textareaRef}
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className={`w-full h-full resize-none border-none outline-none bg-transparent p-2 text-sm leading-relaxed ${
            node.type === "code" ? "font-mono text-xs" : ""
          } ${node.type === "sticky" ? "text-gray-900 placeholder-gray-600" : "text-blade-text placeholder-blade-muted"}`}
          placeholder={
            node.type === "sticky"
              ? "Type your idea..."
              : node.type === "code"
                ? "// Write code here..."
                : "Start typing..."
          }
          spellCheck={node.type !== "code"}
        />
      );
    }

    switch (node.type) {
      case "sticky":
        return (
          <div className="p-3 text-sm leading-relaxed text-gray-900 whitespace-pre-wrap break-words h-full overflow-auto">
            {node.content || (
              <span className="text-gray-500 italic">Double-click to edit...</span>
            )}
          </div>
        );

      case "text":
        return (
          <div className="p-3 text-sm leading-relaxed text-blade-text whitespace-pre-wrap break-words h-full overflow-auto">
            {node.content || (
              <span className="text-blade-muted italic">Double-click to edit...</span>
            )}
          </div>
        );

      case "code":
        return (
          <pre className="p-3 text-xs font-mono leading-relaxed text-blade-text whitespace-pre overflow-auto h-full">
            <code>{node.content || "// Double-click to edit..."}</code>
          </pre>
        );

      case "ai-response":
        return (
          <div className="p-3 text-sm leading-relaxed text-blade-text whitespace-pre-wrap break-words h-full overflow-auto">
            <div className="flex items-center gap-1.5 mb-2 text-blade-accent text-xs font-medium">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zm1 11H9v-2h2v2zm0-4H9V5h2v4z" />
              </svg>
              AI Response
            </div>
            {node.content || (
              <span className="text-blade-muted italic">Generating...</span>
            )}
          </div>
        );

      case "image":
        return node.content ? (
          <img
            src={node.content}
            alt="Canvas image"
            className="w-full h-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-blade-muted text-sm">
            No image
          </div>
        );

      default:
        return null;
    }
  };

  // ── Main render ───────────────────────────────────────────────────────────

  return (
    <div
      className={getNodeClasses()}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
        ...getBackgroundStyle(),
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(node.id);
      }}
      onDoubleClick={handleDoubleClick}
    >
      {/* ── Drag handle (top bar) ────────────────────────────────────────── */}
      <div
        className={`absolute top-0 left-0 right-0 h-6 cursor-grab active:cursor-grabbing flex items-center justify-between px-2 ${
          node.type === "sticky" ? "rounded-t-xl" : "rounded-t-lg"
        } ${node.locked ? "cursor-not-allowed" : ""}`}
        onMouseDown={handleDragStart}
      >
        {/* Drag dots indicator */}
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-40 transition-opacity">
          <div className={`w-1 h-1 rounded-full ${node.type === "sticky" ? "bg-gray-700" : "bg-blade-muted"}`} />
          <div className={`w-1 h-1 rounded-full ${node.type === "sticky" ? "bg-gray-700" : "bg-blade-muted"}`} />
          <div className={`w-1 h-1 rounded-full ${node.type === "sticky" ? "bg-gray-700" : "bg-blade-muted"}`} />
        </div>

        {/* Lock indicator */}
        {node.locked && (
          <svg className={`w-3 h-3 ${node.type === "sticky" ? "text-gray-600" : "text-blade-muted"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        )}
      </div>

      {/* ── Delete button (top-right, on hover) ──────────────────────────── */}
      {(isHovered || isSelected) && !node.locked && (
        <button
          className={`absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs z-10 transition-all ${
            node.type === "sticky"
              ? "bg-gray-800 text-white hover:bg-red-500"
              : "bg-blade-surface-hover text-blade-secondary hover:bg-red-500 hover:text-white"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(node.id);
          }}
        >
          &times;
        </button>
      )}

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="pt-6 h-full overflow-hidden">{renderContent()}</div>

      {/* ── Color dots for sticky notes ──────────────────────────────────── */}
      {node.type === "sticky" && (isHovered || isSelected) && (
        <div className="absolute bottom-2 left-2 flex gap-1.5 z-10">
          {STICKY_COLORS.map((color) => (
            <button
              key={color}
              className={`w-4 h-4 rounded-full border-2 transition-transform hover:scale-125 ${
                node.color === color ? "border-gray-800 scale-110" : "border-transparent"
              }`}
              style={{ backgroundColor: color }}
              onClick={(e) => {
                e.stopPropagation();
                onUpdate(node.id, { color });
              }}
            />
          ))}
        </div>
      )}

      {/* ── Connection port (right edge) ─────────────────────────────────── */}
      {(isHovered || isSelected) && (
        <div
          className="absolute top-1/2 -right-3 w-6 h-6 -translate-y-1/2 flex items-center justify-center cursor-crosshair z-10"
          onMouseDown={handleConnectStart}
        >
          <div className="w-3 h-3 rounded-full bg-blade-accent border-2 border-blade-bg hover:scale-125 transition-transform" />
        </div>
      )}

      {/* ── Resize handle (bottom-right corner) ──────────────────────────── */}
      {!node.locked && (isHovered || isSelected) && (
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
          onMouseDown={handleResizeStart}
        >
          <svg
            className={`w-4 h-4 ${node.type === "sticky" ? "text-gray-600" : "text-blade-muted"}`}
            viewBox="0 0 16 16"
            fill="currentColor"
          >
            <path d="M14 14H12V12H14V14ZM14 10H12V8H14V10ZM10 14H8V12H10V14Z" />
          </svg>
        </div>
      )}
    </div>
  );
}
