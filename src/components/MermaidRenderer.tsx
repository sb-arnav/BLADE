import { memo, useCallback, useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import mermaid from "mermaid";

/* ── Types ────────────────────────────────────────────────────────── */

interface MermaidRendererProps {
  code: string;
  className?: string;
}

type DiagramType =
  | "flowchart"
  | "sequence"
  | "gantt"
  | "class"
  | "state"
  | "er"
  | "journey"
  | "pie"
  | "quadrant"
  | "requirement"
  | "gitgraph"
  | "mindmap"
  | "timeline"
  | "unknown";

/* ── Mermaid init (once) ──────────────────────────────────────────── */

let mermaidInitialized = false;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  mermaidInitialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    darkMode: true,
    themeVariables: {
      background: "transparent",
      primaryColor: "#6366f1",
      primaryTextColor: "#e2e8f0",
      primaryBorderColor: "#818cf8",
      secondaryColor: "#1e1b4b",
      secondaryTextColor: "#c7d2fe",
      secondaryBorderColor: "#4f46e5",
      tertiaryColor: "#0f172a",
      tertiaryTextColor: "#94a3b8",
      lineColor: "#818cf8",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontSize: "14px",
      noteBkgColor: "#1e1b4b",
      noteTextColor: "#c7d2fe",
      noteBorderColor: "#4f46e5",
      actorTextColor: "#e2e8f0",
      actorBkg: "#312e81",
      actorBorder: "#818cf8",
      signalColor: "#c7d2fe",
      labelBoxBkgColor: "#1e1b4b",
      labelTextColor: "#e2e8f0",
    },
    flowchart: { curve: "basis", htmlLabels: true },
    sequence: { mirrorActors: false },
  });
}

/* ── Helpers ───────────────────────────────────────────────────────── */

let renderCounter = 0;

function detectDiagramType(code: string): DiagramType {
  const first = code.trimStart().split(/[\s\n{;]/)[0].toLowerCase();
  const map: Record<string, DiagramType> = {
    graph: "flowchart",
    flowchart: "flowchart",
    sequencediagram: "sequence",
    gantt: "gantt",
    classdiagram: "class",
    statediagram: "state",
    "statediagram-v2": "state",
    erdiagram: "er",
    journey: "journey",
    pie: "pie",
    quadrantchart: "quadrant",
    requirementdiagram: "requirement",
    gitgraph: "gitgraph",
    mindmap: "mindmap",
    timeline: "timeline",
  };
  return map[first] ?? "unknown";
}

/**
 * Extract all ```mermaid fenced code blocks from a markdown string.
 */
export function extractMermaidBlocks(markdown: string): string[] {
  const results: string[] = [];
  const regex = /```mermaid\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const block = match[1].trim();
    if (block.length > 0) results.push(block);
  }
  return results;
}

/* ── Copy button (mirrors MarkdownPreview pattern) ────────────────── */

function ActionButton({
  onClick,
  label,
  activeLabel,
}: {
  onClick: () => void;
  label: string;
  activeLabel?: string;
}) {
  const [active, setActive] = useState(false);

  const handleClick = useCallback(() => {
    onClick();
    if (activeLabel) {
      setActive(true);
      setTimeout(() => setActive(false), 1500);
    }
  }, [onClick, activeLabel]);

  return (
    <button
      onClick={handleClick}
      className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors font-mono px-1.5 py-0.5 rounded hover:bg-white/5"
    >
      {active ? activeLabel : label}
    </button>
  );
}

/* ── Main component ───────────────────────────────────────────────── */

function MermaidRendererInner({ code, className }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomed, setZoomed] = useState(false);

  const diagramType = detectDiagramType(code);

  /* Render mermaid diagram */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSvg("");

    ensureMermaidInit();

    const id = `blade-mermaid-${++renderCounter}`;

    (async () => {
      try {
        const { svg: rendered } = await mermaid.render(id, code.trim());
        if (!cancelled) {
          setSvg(rendered);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
        /* mermaid.render inserts a temp element on failure — clean it up */
        const zombie = document.getElementById("d" + id);
        zombie?.remove();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  /* Copy SVG to clipboard */
  const copySvg = useCallback(() => {
    if (svg) navigator.clipboard.writeText(svg);
  }, [svg]);

  /* Copy source code to clipboard */
  const copyCode = useCallback(() => {
    navigator.clipboard.writeText(code);
  }, [code]);

  /* Download SVG file */
  const downloadSvg = useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blade-${diagramType}-diagram.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [svg, diagramType]);

  /* Toggle zoom */
  const toggleZoom = useCallback(() => setZoomed((z) => !z), []);

  /* ── Loading state ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-white/5 bg-blade-surface p-8 ${className ?? ""}`}
      >
        <div className="flex items-center gap-2 text-blade-muted text-sm">
          <svg
            className="animate-spin h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
          Rendering {diagramType !== "unknown" ? diagramType : ""} diagram…
        </div>
      </div>
    );
  }

  /* ── Error state — show raw code as fallback ────────────────────── */
  if (error) {
    return (
      <div className={`rounded-lg border border-red-500/20 bg-blade-surface overflow-hidden ${className ?? ""}`}>
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
          <span className="text-2xs text-red-400 font-mono">
            mermaid error
          </span>
          <ActionButton onClick={copyCode} label="copy code" activeLabel="copied" />
        </div>
        <div className="p-3 text-xs text-red-300/70 font-mono leading-relaxed">
          {error}
        </div>
        <pre className="px-3 pb-3 text-xs text-blade-muted font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">
          {code}
        </pre>
      </div>
    );
  }

  /* ── Success — interactive SVG ──────────────────────────────────── */
  return (
    <div
      className={`group relative rounded-lg border border-white/5 bg-blade-surface overflow-hidden ${className ?? ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5 opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-2xs text-blade-muted font-mono">
          {diagramType !== "unknown" ? diagramType : "mermaid"}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton onClick={copySvg} label="copy svg" activeLabel="copied" />
          <ActionButton onClick={copyCode} label="copy code" activeLabel="copied" />
          <ActionButton onClick={downloadSvg} label="download" activeLabel="saved" />
          <ActionButton
            onClick={toggleZoom}
            label={zoomed ? "fit" : "zoom"}
          />
        </div>
      </div>

      {/* Diagram */}
      <div
        ref={containerRef}
        onClick={toggleZoom}
        className={`flex items-center justify-center p-4 cursor-zoom-in transition-all duration-200 ${
          zoomed
            ? "overflow-auto max-h-[80vh] cursor-zoom-out"
            : "overflow-hidden max-h-96"
        }`}
        // Sanitized with DOMPurify to prevent XSS from user-controlled diagram content
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"] }) }}
      />
    </div>
  );
}

const MermaidRenderer = memo(MermaidRendererInner);
export default MermaidRenderer;
