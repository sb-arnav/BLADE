import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
}

export interface FileTreeState {
  root: string;
  entries: FileNode[];
  selectedPath: string | null;
  fileContent: string | null;
  fileLoading: boolean;
  dirLoading: boolean;
  error: string | null;
}

const EXT_COLORS: Record<string, string> = {
  ".ts": "text-blue-400", ".tsx": "text-blue-400",
  ".js": "text-yellow-400", ".jsx": "text-yellow-400",
  ".rs": "text-orange-400",
  ".py": "text-green-400",
  ".json": "text-amber-300",
  ".md": "text-violet-400",
  ".css": "text-pink-400", ".scss": "text-pink-400",
  ".html": "text-red-400",
  ".toml": "text-amber-400",
  ".yaml": "text-emerald-400", ".yml": "text-emerald-400",
  ".sql": "text-cyan-400",
  ".sh": "text-lime-400",
};

export function getFileColor(name: string): string {
  const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
  return EXT_COLORS[ext] || "text-blade-secondary";
}

export function getFileIcon(node: FileNode): string {
  if (node.is_dir) return "📁";
  const ext = node.name.includes(".") ? "." + node.name.split(".").pop()!.toLowerCase() : "";
  const icons: Record<string, string> = {
    ".ts": "📘", ".tsx": "📘", ".js": "📒", ".jsx": "📒",
    ".rs": "🦀", ".py": "🐍", ".json": "📋", ".md": "📝",
    ".css": "🎨", ".html": "🌐", ".toml": "⚙️", ".sql": "🗃️",
    ".png": "🖼️", ".jpg": "🖼️", ".svg": "🖼️", ".gif": "🖼️",
    ".sh": "⚡", ".yml": "📐", ".yaml": "📐",
  };
  return icons[ext] || "📄";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function detectLanguage(filename: string): string {
  const ext = filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", py: "python", json: "json", md: "markdown",
    css: "css", html: "xml", sql: "sql", sh: "bash",
    yaml: "yaml", yml: "yaml", toml: "toml", go: "go",
  };
  return map[ext] || "";
}

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp",
  ".mp3", ".mp4", ".wav", ".ogg", ".avi", ".mov",
  ".zip", ".tar", ".gz", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".otf",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
]);

export function isBinaryFile(name: string): boolean {
  const ext = name.includes(".") ? "." + name.split(".").pop()!.toLowerCase() : "";
  return BINARY_EXTENSIONS.has(ext);
}

export function useFileTree(initialPath?: string) {
  const [state, setState] = useState<FileTreeState>({
    root: initialPath || "",
    entries: [],
    selectedPath: null,
    fileContent: null,
    fileLoading: false,
    dirLoading: false,
    error: null,
  });

  const navigate = useCallback(async (path: string) => {
    setState((prev) => ({ ...prev, dirLoading: true, error: null }));
    try {
      const entries = await invoke<FileNode[]>("file_list", { path });
      // Sort: dirs first, then alphabetical
      entries.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setState((prev) => ({
        ...prev,
        root: path,
        entries,
        dirLoading: false,
        selectedPath: null,
        fileContent: null,
      }));
    } catch (e) {
      setState((prev) => ({ ...prev, dirLoading: false, error: String(e) }));
    }
  }, []);

  const selectFile = useCallback(async (path: string, name: string) => {
    if (isBinaryFile(name)) {
      setState((prev) => ({
        ...prev,
        selectedPath: path,
        fileContent: "[Binary file — cannot preview]",
      }));
      return;
    }

    setState((prev) => ({ ...prev, selectedPath: path, fileLoading: true }));
    try {
      const content = await invoke<string>("file_read", { path });
      if (content.length > 1024 * 1024) {
        setState((prev) => ({
          ...prev,
          fileContent: "[File too large to preview (>1MB)]",
          fileLoading: false,
        }));
      } else {
        setState((prev) => ({ ...prev, fileContent: content, fileLoading: false }));
      }
    } catch (e) {
      setState((prev) => ({
        ...prev,
        fileContent: `Error: ${e}`,
        fileLoading: false,
      }));
    }
  }, []);

  const goUp = useCallback(() => {
    const parts = state.root.replace(/\\/g, "/").split("/");
    if (parts.length > 1) {
      parts.pop();
      navigate(parts.join("/") || "/");
    }
  }, [state.root, navigate]);

  const refresh = useCallback(() => {
    if (state.root) navigate(state.root);
  }, [state.root, navigate]);

  return { state, navigate, selectFile, goUp, refresh };
}
