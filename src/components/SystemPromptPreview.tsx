import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface McpTool {
  name: string;
  qualified_name: string;
  description: string;
  input_schema: unknown;
  server_name: string;
}

interface SystemPromptPreviewProps {
  open: boolean;
  onClose: () => void;
}

export default function SystemPromptPreview({ open, onClose }: SystemPromptPreviewProps) {
  const [persona, setPersona] = useState<string | null>(null);
  const [context, setContext] = useState<string | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    Promise.all([
      invoke<string>("get_persona").catch(() => ""),
      invoke<string>("get_context").catch(() => ""),
      invoke<McpTool[]>("mcp_get_tools").catch(() => [] as McpTool[]),
    ]).then(([p, c, tools]) => {
      setPersona(p || "");
      setContext(c || "");
      setToolCount(tools.length);
      setLoading(false);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [
    {
      label: "Identity",
      content: "You are Blade, a personal AI assistant...",
    },
    {
      label: "Persona",
      content: persona ? persona : "(no persona set)",
    },
    {
      label: "Context",
      content: context ? context : "(no context set)",
    },
    {
      label: "Tools",
      content:
        toolCount !== null && toolCount > 0
          ? `${toolCount} MCP tools available`
          : "No tools configured",
    },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="max-w-lg w-full max-h-[80vh] overflow-y-auto bg-blade-surface border border-blade-border rounded-2xl p-5 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold mb-4">System Prompt Preview</h2>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs text-blade-muted">Loading...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sections.map(({ label, content }) => (
              <div key={label}>
                <span className="text-2xs uppercase tracking-wider text-blade-muted">
                  {label}
                </span>
                <div className="mt-1 bg-blade-bg rounded-lg p-3 font-mono text-xs text-blade-secondary whitespace-pre-wrap">
                  {content}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
