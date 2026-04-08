import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { useTerminal, TerminalLine } from "../hooks/useTerminal";

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

function LineContent({ line }: { line: TerminalLine }) {
  const colors: Record<TerminalLine["type"], string> = {
    input: "text-emerald-400",
    output: "text-blade-text/90",
    error: "text-red-400",
    system: "text-blade-muted italic",
  };

  return (
    <div className={`${colors[line.type]} whitespace-pre-wrap break-all`}>
      {line.type === "input" && <span className="text-emerald-600 select-none">$ </span>}
      {line.content}
    </div>
  );
}

export function Terminal({ onBack, onSendToChat }: Props) {
  const { lines, cwd, isRunning, execute, clear, historyUp, historyDown } = useTerminal();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      execute(input);
      setInput("");
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setInput(historyUp());
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setInput(historyDown());
    }
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      clear();
    }
  };

  const handleSendLastOutput = () => {
    const lastOutput = [...lines].reverse().find((l) => l.type === "output" || l.type === "error");
    if (lastOutput) {
      onSendToChat(`Analyze this terminal output:\n\n\`\`\`\n${lastOutput.content}\n\`\`\``);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0c0c0f] text-blade-text font-mono">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-blade-border/30 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-blade-muted hover:text-blade-secondary text-xs transition-colors"
          >
            ← back
          </button>
          <span className="text-xs text-blade-secondary font-medium">Terminal</span>
          <span className="text-2xs text-blade-muted/50 font-mono">{cwd}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSendLastOutput}
            className="text-2xs text-blade-muted hover:text-blade-accent transition-colors px-2 py-0.5 rounded"
            title="Send last output to AI"
          >
            → AI
          </button>
          <button
            onClick={clear}
            className="text-2xs text-blade-muted hover:text-blade-secondary transition-colors px-2 py-0.5 rounded"
          >
            clear
          </button>
        </div>
      </div>

      {/* Output */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 text-[0.8rem] leading-relaxed"
        onClick={() => inputRef.current?.focus()}
      >
        {lines.map((line) => (
          <LineContent key={line.id} line={line} />
        ))}

        {/* Input line */}
        <div className="flex items-center gap-0">
          <span className="text-emerald-600 select-none shrink-0">
            {isRunning ? (
              <span className="text-blade-accent animate-pulse">● </span>
            ) : (
              "$ "
            )}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            className="flex-1 bg-transparent outline-none text-blade-text caret-emerald-400 disabled:opacity-50"
            autoFocus
            spellCheck={false}
          />
        </div>
        <div ref={bottomRef} />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 border-t border-blade-border/20 text-2xs text-blade-muted/40 shrink-0">
        <span>{lines.filter((l) => l.type === "input").length} commands</span>
        <div className="flex items-center gap-3">
          <span>Ctrl+L clear</span>
          <span>↑↓ history</span>
          <span>? AI help</span>
        </div>
      </div>
    </div>
  );
}
