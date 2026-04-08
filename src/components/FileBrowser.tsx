import { useEffect, useRef, useState } from "react";
import { useFileTree, getFileIcon, getFileColor, formatFileSize, detectLanguage, FileNode } from "../hooks/useFileTree";
import hljs from "highlight.js/lib/core";

interface Props {
  onBack: () => void;
  onSendToChat: (content: string, filename: string) => void;
}

function Breadcrumb({ path, onNavigate }: { path: string; onNavigate: (p: string) => void }) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);

  return (
    <div className="flex items-center gap-1 text-2xs overflow-x-auto whitespace-nowrap">
      <button
        onClick={() => onNavigate("/")}
        className="text-blade-muted hover:text-blade-secondary transition-colors"
      >
        /
      </button>
      {parts.map((part, i) => {
        const fullPath = "/" + parts.slice(0, i + 1).join("/");
        return (
          <span key={fullPath} className="flex items-center gap-1">
            <span className="text-blade-muted/30">/</span>
            <button
              onClick={() => onNavigate(fullPath)}
              className={`transition-colors ${
                i === parts.length - 1
                  ? "text-blade-secondary font-medium"
                  : "text-blade-muted hover:text-blade-secondary"
              }`}
            >
              {part}
            </button>
          </span>
        );
      })}
    </div>
  );
}

function FileEntry({
  node,
  onClick,
  isSelected,
}: {
  node: FileNode;
  onClick: () => void;
  isSelected: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-2 px-2 py-1 rounded-md transition-colors text-xs ${
        isSelected
          ? "bg-blade-accent-muted text-blade-text"
          : "text-blade-secondary hover:bg-blade-surface-hover hover:text-blade-text"
      }`}
    >
      <span className="text-xs shrink-0">{getFileIcon(node)}</span>
      <span className={`truncate ${node.is_dir ? "font-medium" : getFileColor(node.name)}`}>
        {node.name}{node.is_dir ? "/" : ""}
      </span>
      {!node.is_dir && (
        <span className="ml-auto text-2xs text-blade-muted/40 shrink-0">
          {formatFileSize(node.size)}
        </span>
      )}
    </button>
  );
}

function CodePreview({ content, filename }: { content: string; filename: string }) {
  const codeRef = useRef<HTMLPreElement>(null);
  const lang = detectLanguage(filename);
  const lines = content.split("\n");

  useEffect(() => {
    if (!codeRef.current || !lang) return;
    try {
      if (hljs.getLanguage(lang)) {
        const result = hljs.highlight(content, { language: lang });
        codeRef.current.innerHTML = result.value;
      }
    } catch {
      // fallback to plain text
    }
  }, [content, lang]);

  return (
    <div className="flex text-[0.75rem] leading-relaxed font-mono overflow-auto">
      <div className="select-none text-right pr-4 py-3 text-blade-muted/20 shrink-0 sticky left-0 bg-[#0c0c0f]">
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre ref={codeRef} className="py-3 pr-4 flex-1 text-blade-text/80">
        {content}
      </pre>
    </div>
  );
}

export function FileBrowser({ onBack, onSendToChat }: Props) {
  const { state, navigate, selectFile, goUp, refresh } = useFileTree();
  const [initialized, setInitialized] = useState(false);

  // Navigate to home on mount
  useEffect(() => {
    if (!initialized) {
      const home = import.meta.env.DEV ? "C:/Users" : "~";
      navigate(home);
      setInitialized(true);
    }
  }, [initialized, navigate]);

  const selectedFile = state.entries.find((e) => e.path === state.selectedPath);

  const handleSendToAI = () => {
    if (state.fileContent && selectedFile) {
      onSendToChat(state.fileContent, selectedFile.name);
    }
  };

  return (
    <div className="h-full flex flex-col bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-blade-border/50 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-secondary text-xs transition-colors shrink-0"
          >
            ← back
          </button>
          <span className="text-xs text-blade-secondary font-medium shrink-0">Files</span>
          <Breadcrumb path={state.root} onNavigate={navigate} />
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={goUp}
            className="w-7 h-7 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors text-xs"
            title="Go up"
          >
            ↑
          </button>
          <button
            onClick={refresh}
            className="w-7 h-7 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors text-xs"
            title="Refresh"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* File tree */}
        <div className="w-64 border-r border-blade-border/30 overflow-y-auto px-1 py-2 shrink-0">
          {state.dirLoading ? (
            <div className="flex items-center justify-center h-20">
              <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
            </div>
          ) : state.error ? (
            <div className="px-2 py-4 text-2xs text-red-400">{state.error}</div>
          ) : state.entries.length === 0 ? (
            <div className="px-2 py-4 text-2xs text-blade-muted/40 text-center">Empty directory</div>
          ) : (
            state.entries.map((node) => (
              <FileEntry
                key={node.path}
                node={node}
                isSelected={node.path === state.selectedPath}
                onClick={() => {
                  if (node.is_dir) navigate(node.path);
                  else selectFile(node.path, node.name);
                }}
              />
            ))
          )}
        </div>

        {/* Preview */}
        <div className="flex-1 flex flex-col min-w-0">
          {state.selectedPath && selectedFile ? (
            <>
              {/* File info header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-blade-border/30 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs">{getFileIcon(selectedFile)}</span>
                  <span className={`text-xs font-medium truncate ${getFileColor(selectedFile.name)}`}>
                    {selectedFile.name}
                  </span>
                  <span className="text-2xs text-blade-muted/40">
                    {formatFileSize(selectedFile.size)}
                  </span>
                </div>
                <button
                  onClick={handleSendToAI}
                  className="text-2xs px-2 py-0.5 rounded-md bg-blade-accent/10 text-blade-accent hover:bg-blade-accent/20 transition-colors shrink-0"
                >
                  Send to AI
                </button>
              </div>

              {/* File content */}
              <div className="flex-1 overflow-auto bg-[#0c0c0f]">
                {state.fileLoading ? (
                  <div className="flex items-center justify-center h-20">
                    <div className="w-1.5 h-1.5 rounded-full bg-blade-accent animate-pulse" />
                  </div>
                ) : state.fileContent ? (
                  <CodePreview content={state.fileContent} filename={selectedFile.name} />
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl mb-2">📂</div>
                <p className="text-xs text-blade-muted">Select a file to preview</p>
                <p className="text-2xs text-blade-muted/40 mt-1">Click files in the tree on the left</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-blade-border/20 text-2xs text-blade-muted/40 shrink-0">
        <span>
          {state.entries.filter((e) => !e.is_dir).length} files, {state.entries.filter((e) => e.is_dir).length} folders
        </span>
        {state.selectedPath && (
          <span className="truncate ml-4">{state.selectedPath}</span>
        )}
      </div>
    </div>
  );
}
