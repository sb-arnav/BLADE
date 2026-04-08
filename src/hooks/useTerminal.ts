import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TerminalLine {
  id: string;
  type: "input" | "output" | "error" | "system";
  content: string;
  timestamp: number;
}

const MAX_LINES = 500;

export function useTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: "welcome", type: "system", content: "Blade Terminal — Type commands or ? for AI assistance", timestamp: Date.now() },
  ]);
  const [cwd, setCwd] = useState("~");
  const [isRunning, setIsRunning] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const idCounter = useRef(0);

  const nextId = () => `line-${++idCounter.current}`;

  const addLine = useCallback((type: TerminalLine["type"], content: string) => {
    setLines((prev) => {
      const next = [...prev, { id: nextId(), type, content, timestamp: Date.now() }];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  const execute = useCallback(async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    setHistory((prev) => [...prev.slice(-99), trimmed]);
    setHistoryIndex(-1);
    addLine("input", trimmed);
    setIsRunning(true);

    try {
      // Built-in commands
      if (trimmed === "clear") {
        setLines([]);
        setIsRunning(false);
        return;
      }

      if (trimmed === "pwd") {
        addLine("output", cwd);
        setIsRunning(false);
        return;
      }

      if (trimmed.startsWith("cd ")) {
        const dir = trimmed.slice(3).trim();
        const exists = await invoke<boolean>("file_exists", { path: dir }).catch(() => false);
        if (exists) {
          setCwd(dir);
          addLine("system", `Changed directory to ${dir}`);
        } else {
          addLine("error", `Directory not found: ${dir}`);
        }
        setIsRunning(false);
        return;
      }

      if (trimmed === "ls" || trimmed.startsWith("ls ")) {
        const path = trimmed === "ls" ? cwd : trimmed.slice(3).trim() || cwd;
        try {
          const entries = await invoke<Array<{ name: string; is_dir: boolean; size: number }>>("file_list", { path });
          const dirs = entries.filter((e) => e.is_dir).map((e) => `📁 ${e.name}/`);
          const files = entries.filter((e) => !e.is_dir).map((e) => `   ${e.name}  (${formatSize(e.size)})`);
          addLine("output", [...dirs, ...files].join("\n") || "(empty)");
        } catch (e) {
          addLine("error", String(e));
        }
        setIsRunning(false);
        return;
      }

      if (trimmed.startsWith("cat ")) {
        const path = trimmed.slice(4).trim();
        try {
          const content = await invoke<string>("file_read", { path });
          addLine("output", content);
        } catch (e) {
          addLine("error", String(e));
        }
        setIsRunning(false);
        return;
      }

      if (trimmed.startsWith("mkdir ")) {
        const path = trimmed.slice(6).trim();
        try {
          await invoke("file_mkdir", { path });
          addLine("system", `Created directory: ${path}`);
        } catch (e) {
          addLine("error", String(e));
        }
        setIsRunning(false);
        return;
      }

      if (trimmed === "help") {
        addLine("system", [
          "Built-in commands:",
          "  ls [path]     — List files",
          "  cd <path>     — Change directory",
          "  cat <file>    — Read file",
          "  mkdir <path>  — Create directory",
          "  pwd           — Print working directory",
          "  clear         — Clear terminal",
          "  help          — Show this help",
          "  ?<query>      — Ask AI for help",
        ].join("\n"));
        setIsRunning(false);
        return;
      }

      // Unknown command
      addLine("error", `Unknown command: ${trimmed.split(" ")[0]}. Type 'help' for commands.`);
    } catch (e) {
      addLine("error", String(e));
    }
    setIsRunning(false);
  }, [cwd, addLine]);

  const clear = useCallback(() => setLines([]), []);

  const historyUp = useCallback(() => {
    if (history.length === 0) return "";
    const newIdx = historyIndex < history.length - 1 ? historyIndex + 1 : historyIndex;
    setHistoryIndex(newIdx);
    return history[history.length - 1 - newIdx] || "";
  }, [history, historyIndex]);

  const historyDown = useCallback(() => {
    if (historyIndex <= 0) {
      setHistoryIndex(-1);
      return "";
    }
    const newIdx = historyIndex - 1;
    setHistoryIndex(newIdx);
    return history[history.length - 1 - newIdx] || "";
  }, [history, historyIndex]);

  return { lines, cwd, isRunning, execute, clear, history, historyUp, historyDown };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}
