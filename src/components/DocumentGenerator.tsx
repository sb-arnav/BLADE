import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  useDocGenerator,
  DocumentTemplate,
  GeneratedDocument,
  DocumentField,
} from "../hooks/useDocGenerator";

/* ── Types ──────────────────────────────────────────────────────── */

interface Props {
  onBack: () => void;
}

type View = "templates" | "form" | "result";

/* ── Helpers ────────────────────────────────────────────────────── */

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-muted hover:text-blade-secondary hover:border-blade-secondary/40 transition-colors"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

/* ── Field Renderer ─────────────────────────────────────────────── */

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: DocumentField;
  value: string;
  onChange: (val: string) => void;
}) {
  const baseClass =
    "w-full rounded-lg bg-blade-surface border border-blade-border px-3 py-2 text-sm text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/50 focus:ring-1 focus:ring-blade-accent/20 transition-colors";

  if (field.type === "textarea") {
    return (
      <div>
        <label className="block text-xs text-blade-secondary mb-1.5">
          {field.label}
          {field.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={`${baseClass} resize-y min-h-[80px]`}
        />
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <div>
        <label className="block text-xs text-blade-secondary mb-1.5">
          {field.label}
          {field.required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
        >
          <option value="">Select...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="block text-xs text-blade-secondary mb-1.5">
        {field.label}
        {field.required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={field.placeholder}
        className={baseClass}
      />
    </div>
  );
}

/* ── Template Card ──────────────────────────────────────────────── */

function TemplateCard({
  template,
  onClick,
}: {
  template: DocumentTemplate;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-2 p-4 rounded-xl bg-blade-surface border border-blade-border hover:border-blade-accent/40 hover:bg-blade-surface/80 transition-all text-left group"
    >
      <span className="text-2xl">{template.icon}</span>
      <div>
        <h3 className="text-sm font-medium text-blade-text group-hover:text-blade-accent transition-colors">
          {template.name}
        </h3>
        <p className="text-xs text-blade-muted mt-0.5 line-clamp-2">
          {template.description}
        </p>
      </div>
      <span className="text-2xs text-blade-muted/60">
        {template.fields.length} field{template.fields.length !== 1 ? "s" : ""}
      </span>
    </button>
  );
}

/* ── Sidebar Document Item ──────────────────────────────────────── */

function SidebarItem({
  doc,
  active,
  templateName,
  onClick,
  onDelete,
}: {
  doc: GeneratedDocument;
  active: boolean;
  templateName: string;
  onClick: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-start gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
        active
          ? "bg-blade-accent/10 border border-blade-accent/30"
          : "hover:bg-blade-surface/80 border border-transparent"
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-blade-text truncate">
          {doc.title}
        </p>
        <p className="text-2xs text-blade-muted truncate">
          {templateName} &middot; {formatDate(doc.createdAt)}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="opacity-0 group-hover:opacity-100 text-blade-muted hover:text-red-400 transition-all text-xs p-0.5 shrink-0"
        title="Delete"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      </button>
    </div>
  );
}

/* ── Loading Dots ───────────────────────────────────────────────── */

function LoadingDots() {
  return (
    <span className="inline-flex gap-1 ml-1">
      <span className="w-1.5 h-1.5 bg-blade-accent rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-1.5 h-1.5 bg-blade-accent rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-1.5 h-1.5 bg-blade-accent rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </span>
  );
}

/* ── Main Component ─────────────────────────────────────────────── */

export default function DocumentGenerator({ onBack }: Props) {
  const {
    templates,
    documents,
    generating,
    streamContent,
    generate,
    deleteDocument,
    exportAsMarkdown,
    exportAsHtml,
  } = useDocGenerator();

  const [view, setView] = useState<View>("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const resultRef = useRef<HTMLDivElement>(null);

  // Get active document
  const activeDoc = useMemo(
    () => documents.find((d) => d.id === activeDocId) ?? null,
    [documents, activeDocId]
  );

  // Template name lookup
  const templateNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of templates) {
      map[t.id] = t.name;
    }
    return map;
  }, [templates]);

  // Filtered sidebar documents
  const filteredDocs = useMemo(() => {
    if (!sidebarSearch.trim()) return documents;
    const q = sidebarSearch.toLowerCase();
    return documents.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        (templateNameMap[d.templateId] ?? "").toLowerCase().includes(q)
    );
  }, [documents, sidebarSearch, templateNameMap]);

  // Auto-scroll result view during streaming
  useEffect(() => {
    if (generating && resultRef.current) {
      resultRef.current.scrollTop = resultRef.current.scrollHeight;
    }
  }, [streamContent, generating]);

  /* ── Handlers ───────────────────────────────────────────────── */

  const handleSelectTemplate = useCallback((template: DocumentTemplate) => {
    setSelectedTemplate(template);
    setInputs({});
    setError(null);
    setView("form");
  }, []);

  const handleFieldChange = useCallback((name: string, value: string) => {
    setInputs((prev) => ({ ...prev, [name]: value }));
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!selectedTemplate) return;

    // Validate required fields
    const missing = selectedTemplate.fields
      .filter((f) => f.required && !inputs[f.name]?.trim())
      .map((f) => f.label);

    if (missing.length > 0) {
      setError(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    setError(null);
    setView("result");

    try {
      const doc = await generate(selectedTemplate.id, inputs);
      if (doc) {
        setActiveDocId(doc.id);
      }
    } catch (err) {
      setError(typeof err === "string" ? err : String(err));
    }
  }, [selectedTemplate, inputs, generate]);

  const handleExportMd = useCallback(() => {
    if (!activeDocId) return;
    const md = exportAsMarkdown(activeDocId);
    if (!md) return;
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDoc?.title ?? "document"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDocId, activeDoc, exportAsMarkdown]);

  const handleExportHtml = useCallback(() => {
    if (!activeDocId) return;
    const html = exportAsHtml(activeDocId);
    if (!html) return;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activeDoc?.title ?? "document"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeDocId, activeDoc, exportAsHtml]);

  const handleNewDocument = useCallback(() => {
    setView("templates");
    setSelectedTemplate(null);
    setInputs({});
    setActiveDocId(null);
    setError(null);
  }, []);

  const handleViewDoc = useCallback(
    (doc: GeneratedDocument) => {
      setActiveDocId(doc.id);
      const template = templates.find((t) => t.id === doc.templateId) ?? null;
      setSelectedTemplate(template);
      setInputs(doc.inputs);
      setView("result");
    },
    [templates]
  );

  const handleDeleteDoc = useCallback(
    (id: string) => {
      deleteDocument(id);
      if (activeDocId === id) {
        setActiveDocId(null);
        setView("templates");
      }
    },
    [deleteDocument, activeDocId]
  );

  // Keyboard: Escape to go back
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view === "result") {
          handleNewDocument();
        } else if (view === "form") {
          setView("templates");
        } else {
          onBack();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, onBack, handleNewDocument]);

  /* ── Render: Template Picker ────────────────────────────────── */

  const renderTemplates = () => (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-blade-text">
          Document Generator
        </h2>
        <p className="text-sm text-blade-muted mt-1">
          Choose a template to generate a professional document with AI.
        </p>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onClick={() => handleSelectTemplate(template)}
          />
        ))}
      </div>
    </div>
  );

  /* ── Render: Input Form ─────────────────────────────────────── */

  const renderForm = () => {
    if (!selectedTemplate) return null;

    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => setView("templates")}
              className="text-blade-muted hover:text-blade-secondary transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="text-2xl">{selectedTemplate.icon}</span>
            <div>
              <h2 className="text-lg font-semibold text-blade-text">
                {selectedTemplate.name}
              </h2>
              <p className="text-xs text-blade-muted">
                {selectedTemplate.description}
              </p>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            {selectedTemplate.fields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={inputs[field.name] ?? ""}
                onChange={(val) => handleFieldChange(field.name, val)}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="px-5 py-2 rounded-lg bg-blade-accent text-white text-sm font-medium hover:bg-blade-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generating ? (
                <span className="flex items-center gap-2">
                  Generating <LoadingDots />
                </span>
              ) : (
                "Generate Document"
              )}
            </button>
            <button
              onClick={() => setView("templates")}
              className="px-4 py-2 rounded-lg border border-blade-border text-sm text-blade-muted hover:text-blade-secondary hover:border-blade-secondary/40 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  };

  /* ── Render: Result View ────────────────────────────────────── */

  const renderResult = () => {
    const displayContent = generating ? streamContent : (activeDoc?.content ?? "");
    const docTitle = activeDoc?.title ?? selectedTemplate?.name ?? "Document";

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-blade-border bg-blade-surface/30">
          <div className="flex items-center gap-3">
            <button
              onClick={handleNewDocument}
              className="text-blade-muted hover:text-blade-secondary transition-colors"
              title="Back to templates"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <h3 className="text-sm font-medium text-blade-text truncate max-w-[300px]">
              {docTitle}
            </h3>
            {generating && (
              <span className="flex items-center text-xs text-blade-accent">
                Generating <LoadingDots />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!generating && displayContent && (
              <>
                <CopyButton text={displayContent} label="Copy" />
                <button
                  onClick={handleExportMd}
                  className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-muted hover:text-blade-secondary hover:border-blade-secondary/40 transition-colors"
                >
                  Export MD
                </button>
                <button
                  onClick={handleExportHtml}
                  className="px-3 py-1.5 rounded-lg bg-blade-surface border border-blade-border text-xs text-blade-muted hover:text-blade-secondary hover:border-blade-secondary/40 transition-colors"
                >
                  Export HTML
                </button>
              </>
            )}
            <button
              onClick={handleNewDocument}
              className="px-3 py-1.5 rounded-lg bg-blade-accent/10 border border-blade-accent/30 text-xs text-blade-accent hover:bg-blade-accent/20 transition-colors"
            >
              New Document
            </button>
            <button
              onClick={onBack}
              className="px-3 py-1.5 rounded-lg border border-blade-border text-xs text-blade-muted hover:text-blade-secondary hover:border-blade-secondary/40 transition-colors"
            >
              Back
            </button>
          </div>
        </div>

        {/* Content */}
        <div ref={resultRef} className="flex-1 overflow-y-auto p-6">
          {displayContent ? (
            <div className="max-w-3xl mx-auto">
              <div className="message-markdown text-sm text-blade-text/90 leading-relaxed">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code({ className: cn, children, ...rest }) {
                      const isInline =
                        !cn &&
                        typeof children === "string" &&
                        !children.includes("\n");
                      if (isInline) {
                        return (
                          <code
                            className="bg-blade-surface px-1.5 py-0.5 rounded text-xs text-blade-accent"
                            {...rest}
                          >
                            {children}
                          </code>
                        );
                      }
                      return (
                        <pre className="bg-[#0c0c0f] border border-blade-border rounded-lg p-4 overflow-x-auto my-3">
                          <code className={cn} {...rest}>
                            {children}
                          </code>
                        </pre>
                      );
                    },
                    pre({ children }) {
                      return <>{children}</>;
                    },
                    table({ children }) {
                      return (
                        <div className="overflow-x-auto my-3">
                          <table className="w-full border-collapse text-sm">
                            {children}
                          </table>
                        </div>
                      );
                    },
                    th({ children }) {
                      return (
                        <th className="border border-blade-border bg-blade-surface/50 px-3 py-2 text-left text-xs font-medium text-blade-secondary">
                          {children}
                        </th>
                      );
                    },
                    td({ children }) {
                      return (
                        <td className="border border-blade-border px-3 py-2 text-xs text-blade-text/80">
                          {children}
                        </td>
                      );
                    },
                  }}
                >
                  {displayContent}
                </ReactMarkdown>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-3xl mb-3 opacity-30">
                  {selectedTemplate?.icon ?? "\uD83D\uDCC4"}
                </div>
                <p className="text-sm text-blade-muted">
                  {generating
                    ? "Starting generation..."
                    : "No content to display"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="px-6 py-3 border-t border-red-500/30 bg-red-500/5">
            <p className="text-xs text-red-400">{error}</p>
          </div>
        )}
      </div>
    );
  };

  /* ── Main Layout ────────────────────────────────────────────── */

  return (
    <div className="flex h-full bg-blade-bg text-blade-text">
      {/* Sidebar */}
      <div className="w-56 border-r border-blade-border bg-blade-surface/20 flex flex-col shrink-0">
        {/* Sidebar Header */}
        <div className="px-3 pt-4 pb-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-blade-secondary uppercase tracking-wider">
              Documents
            </h3>
            <button
              onClick={handleNewDocument}
              className="text-blade-muted hover:text-blade-accent transition-colors"
              title="New document"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <input
            type="text"
            value={sidebarSearch}
            onChange={(e) => setSidebarSearch(e.target.value)}
            placeholder="Search documents..."
            className="w-full px-2.5 py-1.5 rounded-md bg-blade-surface border border-blade-border text-xs text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-blade-accent/40 transition-colors"
          />
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
          {filteredDocs.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-2xs text-blade-muted/60">
                {sidebarSearch ? "No matching documents" : "No documents yet"}
              </p>
            </div>
          ) : (
            filteredDocs.map((doc) => (
              <SidebarItem
                key={doc.id}
                doc={doc}
                active={doc.id === activeDocId}
                templateName={templateNameMap[doc.templateId] ?? "Document"}
                onClick={() => handleViewDoc(doc)}
                onDelete={() => handleDeleteDoc(doc.id)}
              />
            ))
          )}
        </div>

        {/* Sidebar Footer */}
        <div className="px-3 py-3 border-t border-blade-border">
          <button
            onClick={onBack}
            className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs text-blade-muted hover:text-blade-secondary hover:bg-blade-surface transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Chat
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {view === "templates" && renderTemplates()}
        {view === "form" && renderForm()}
        {view === "result" && renderResult()}
      </div>
    </div>
  );
}
