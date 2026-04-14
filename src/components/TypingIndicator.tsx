const keyframes = `
@keyframes dot-bounce {
  0%, 60%, 100% { transform: scale(1); opacity: 0.4; }
  30% { transform: scale(1.8); opacity: 1; }
}
`;

/** Map a tool_name to a human-readable status string. */
function toolStatusLabel(toolName: string): string {
  const n = toolName.toLowerCase();
  if (n.includes("bash") || n.includes("shell") || n.includes("exec") || n.includes("run")) return "Running command...";
  if (n.includes("screenshot") || n.includes("screen") || n.includes("capture")) return "Taking screenshot...";
  if (n.includes("search") || n.includes("grep") || n.includes("find") || n.includes("glob")) return "Searching files...";
  if (n.includes("read") || n.includes("file") || n.includes("open")) return "Reading file...";
  if (n.includes("write") || n.includes("edit") || n.includes("patch")) return "Writing file...";
  if (n.includes("web") || n.includes("fetch") || n.includes("http") || n.includes("browse")) return "Fetching web page...";
  if (n.includes("memory") || n.includes("brain") || n.includes("recall")) return "Searching memory...";
  if (n.includes("git")) return "Running git...";
  if (n.includes("sql") || n.includes("db") || n.includes("database")) return "Querying database...";
  if (n.includes("timeline")) return "Scanning timeline...";
  return `Running ${toolName.replace(/^blade_/, "").replace(/_/g, " ")}...`;
}

interface Props {
  visible: boolean;
  /** If provided, shows tool-specific status instead of "Thinking..." */
  activeToolName?: string | null;
}

export default function TypingIndicator({ visible, activeToolName }: Props) {
  if (!visible) return null;

  const label = activeToolName ? toolStatusLabel(activeToolName) : "Thinking...";

  return (
    <>
      <style>{keyframes}</style>
      <div className="pl-3 border-l-2 border-blade-accent/30 animate-fade-in flex items-center gap-2 h-7">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1 h-1 rounded-full bg-blade-accent"
              style={{
                animation: `dot-bounce 1.2s ${i * 0.15}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
        <span className="text-2xs text-blade-muted/60 font-mono">{label}</span>
      </div>
    </>
  );
}
