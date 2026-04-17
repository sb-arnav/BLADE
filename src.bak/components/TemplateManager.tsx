import { useEffect, useState, useMemo } from "react";
import {
  useTemplates,
  extractVariables,
  fillTemplate,
  PromptTemplate,
  TemplateCategory,
} from "../hooks/useTemplates";

interface Props {
  open: boolean;
  onClose: () => void;
  onUseTemplate: (filledContent: string) => void;
}

type Tab = "all" | TemplateCategory;
type View = "browse" | "fill" | "create" | "edit";

const TAB_LIST: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "coding", label: "Coding" },
  { id: "writing", label: "Writing" },
  { id: "analysis", label: "Analysis" },
  { id: "custom", label: "Custom" },
];

const ICON_CHOICES = [
  "\uD83D\uDCDD", "\u2728", "\uD83D\uDE80", "\uD83D\uDD27", "\uD83D\uDCA1",
  "\uD83D\uDD0D", "\uD83C\uDFAF", "\u26A1", "\uD83D\uDCAC", "\uD83C\uDF1F",
  "\uD83D\uDCCB", "\uD83D\uDCC8", "\uD83E\uDDE0", "\uD83D\uDD25", "\uD83C\uDF10",
  "\uD83D\uDCE7", "\uD83D\uDC1B", "\u2705", "\u267B\uFE0F", "\u270F\uFE0F",
];

const CATEGORY_OPTIONS: { value: TemplateCategory; label: string }[] = [
  { value: "coding", label: "Coding" },
  { value: "writing", label: "Writing" },
  { value: "analysis", label: "Analysis" },
  { value: "custom", label: "Custom" },
];

export default function TemplateManager({ open, onClose, onUseTemplate }: Props) {
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    incrementUsage,
    searchTemplates,
  } = useTemplates();

  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("browse");
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});

  // Create / edit form state
  const [formName, setFormName] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formCategory, setFormCategory] = useState<TemplateCategory>("custom");
  const [formIcon, setFormIcon] = useState("\uD83D\uDCDD");
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setView("browse");
      setSelectedTemplate(null);
      setVariableValues({});
      setQuery("");
      setTab("all");
      resetForm();
    }
  }, [open]);

  // Escape key to close or go back
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (view !== "browse") {
          setView("browse");
          setSelectedTemplate(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, view, onClose]);

  const filtered = useMemo(() => {
    let results = query ? searchTemplates(query) : templates;
    if (tab !== "all") {
      results = results.filter((t) => t.category === tab);
    }
    return results;
  }, [templates, query, tab, searchTemplates]);

  function resetForm() {
    setFormName("");
    setFormContent("");
    setFormCategory("custom");
    setFormIcon("\uD83D\uDCDD");
    setShowIconPicker(false);
    setEditingId(null);
  }

  function handleSelectTemplate(template: PromptTemplate) {
    setSelectedTemplate(template);
    const vars: Record<string, string> = {};
    template.variables.forEach((v) => {
      vars[v] = "";
    });
    setVariableValues(vars);
    setView("fill");
  }

  function handleUseTemplate() {
    if (!selectedTemplate) return;
    const filled = fillTemplate(selectedTemplate.content, variableValues);
    incrementUsage(selectedTemplate.id);
    onUseTemplate(filled);
    onClose();
  }

  function handleCreateSubmit() {
    if (!formName.trim() || !formContent.trim()) return;
    if (editingId) {
      updateTemplate(editingId, {
        name: formName,
        content: formContent,
        category: formCategory,
        icon: formIcon,
      });
    } else {
      addTemplate(formName.trim(), formContent.trim(), formCategory, formIcon);
    }
    resetForm();
    setView("browse");
  }

  function handleEdit(template: PromptTemplate) {
    setEditingId(template.id);
    setFormName(template.name);
    setFormContent(template.content);
    setFormCategory(template.category as TemplateCategory);
    setFormIcon(template.icon);
    setView("edit");
  }

  function handleDelete(template: PromptTemplate) {
    deleteTemplate(template.id);
    if (selectedTemplate?.id === template.id) {
      setSelectedTemplate(null);
      setView("browse");
    }
  }

  function truncate(text: string, max: number): string {
    if (text.length <= max) return text;
    return text.slice(0, max) + "...";
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] bg-blade-surface border border-blade-border rounded-2xl shadow-2xl overflow-hidden animate-fade-in flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            {view !== "browse" && (
              <button
                onClick={() => {
                  setView("browse");
                  setSelectedTemplate(null);
                  resetForm();
                }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 19l-7-7 7-7" />
                </svg>
              </button>
            )}
            <h2 className="text-sm font-semibold text-blade-text">
              {view === "browse" && "Prompt Templates"}
              {view === "fill" && selectedTemplate?.name}
              {view === "create" && "Create Template"}
              {view === "edit" && "Edit Template"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {view === "browse" && (
              <button
                onClick={() => {
                  resetForm();
                  setView("create");
                }}
                className="text-2xs px-2.5 py-1 rounded-md bg-blade-accent-muted text-blade-accent hover:bg-blade-accent/20 transition-colors font-medium"
              >
                + Create
              </button>
            )}
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-md flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Browse View */}
        {view === "browse" && (
          <>
            {/* Search */}
            <div className="px-5 pb-2 shrink-0">
              <div className="relative">
                <svg
                  viewBox="0 0 24 24"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blade-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search templates..."
                  className="w-full bg-blade-bg border border-blade-border rounded-lg pl-8 pr-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                  autoFocus
                />
              </div>
            </div>

            {/* Category Tabs */}
            <div className="flex gap-1 px-5 pb-2 shrink-0">
              {TAB_LIST.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`text-2xs px-2.5 py-1 rounded-md transition-colors font-medium ${
                    tab === t.id
                      ? "bg-blade-accent-muted text-blade-text"
                      : "text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Template Grid */}
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-blade-muted">
                  <span className="text-2xl mb-2">
                    {query ? "\uD83D\uDD0D" : "\uD83D\uDCDD"}
                  </span>
                  <p className="text-xs">
                    {query ? "No templates match your search" : "No templates in this category"}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="group relative text-left p-3 rounded-xl border border-blade-border hover:border-blade-accent/30 bg-blade-bg/50 hover:bg-blade-bg transition-all"
                    >
                      <div className="flex items-start justify-between mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-base shrink-0">{template.icon}</span>
                          <span className="text-xs font-medium text-blade-text truncate">
                            {template.name}
                          </span>
                        </div>
                        {!template.id.startsWith("builtin-") && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(template);
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover"
                              title="Edit"
                            >
                              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDelete(template);
                              }}
                              className="w-5 h-5 rounded flex items-center justify-center text-blade-muted hover:text-red-400 hover:bg-red-400/10"
                              title="Delete"
                            >
                              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                      <p className="text-2xs text-blade-muted leading-relaxed line-clamp-2">
                        {truncate(template.content.replace(/\{\{(\w+)\}\}/g, "[$1]"), 80)}
                      </p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-2xs text-blade-muted/60 capitalize">
                          {template.category}
                        </span>
                        {template.usageCount > 0 && (
                          <span className="text-2xs text-blade-muted/60">
                            {template.usageCount} use{template.usageCount !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Fill Variables View */}
        {view === "fill" && selectedTemplate && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            {/* Template preview */}
            <div className="mb-4 p-3 rounded-xl bg-blade-bg/50 border border-blade-border">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">{selectedTemplate.icon}</span>
                <span className="text-xs font-medium text-blade-text">
                  {selectedTemplate.name}
                </span>
                <span className="text-2xs text-blade-muted/60 capitalize ml-auto">
                  {selectedTemplate.category}
                </span>
              </div>
              <p className="text-2xs text-blade-muted leading-relaxed whitespace-pre-wrap">
                {selectedTemplate.content.replace(
                  /\{\{(\w+)\}\}/g,
                  (_, key) =>
                    variableValues[key]
                      ? variableValues[key]
                      : `[${key}]`
                )}
              </p>
            </div>

            {/* Variable inputs */}
            {selectedTemplate.variables.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-2xs font-semibold text-blade-secondary uppercase tracking-wider">
                  Fill in variables
                </h3>
                {selectedTemplate.variables.map((varName) => (
                  <div key={varName}>
                    <label className="block text-2xs text-blade-muted mb-1 capitalize">
                      {varName}
                    </label>
                    {selectedTemplate.content.includes(`\n\n{{${varName}}}`) ||
                    varName === "code" ||
                    varName === "text" ||
                    varName === "error" ||
                    varName === "options" ||
                    varName === "prompt" ? (
                      <textarea
                        value={variableValues[varName] ?? ""}
                        onChange={(e) =>
                          setVariableValues((prev) => ({
                            ...prev,
                            [varName]: e.target.value,
                          }))
                        }
                        rows={4}
                        className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors resize-y font-mono"
                        placeholder={`Enter ${varName}...`}
                        autoFocus={selectedTemplate.variables[0] === varName}
                      />
                    ) : (
                      <input
                        type="text"
                        value={variableValues[varName] ?? ""}
                        onChange={(e) =>
                          setVariableValues((prev) => ({
                            ...prev,
                            [varName]: e.target.value,
                          }))
                        }
                        className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                        placeholder={`Enter ${varName}...`}
                        autoFocus={selectedTemplate.variables[0] === varName}
                      />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-2xs text-blade-muted">
                This template has no variables. It will be used as-is.
              </p>
            )}

            {/* Use Template Button */}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setView("browse");
                  setSelectedTemplate(null);
                }}
                className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUseTemplate}
                className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors"
              >
                Use Template
              </button>
            </div>
          </div>
        )}

        {/* Create / Edit View */}
        {(view === "create" || view === "edit") && (
          <div className="flex-1 overflow-y-auto px-5 pb-4">
            <div className="space-y-3">
              {/* Icon + Name Row */}
              <div className="flex items-start gap-2">
                <div className="relative">
                  <button
                    onClick={() => setShowIconPicker((v) => !v)}
                    className="w-9 h-9 rounded-lg bg-blade-bg border border-blade-border flex items-center justify-center text-lg hover:border-blade-accent/40 transition-colors"
                    title="Pick icon"
                  >
                    {formIcon}
                  </button>
                  {showIconPicker && (
                    <div className="absolute top-full left-0 mt-1 z-10 bg-blade-surface border border-blade-border rounded-xl p-2 shadow-xl grid grid-cols-5 gap-1 w-44">
                      {ICON_CHOICES.map((icon) => (
                        <button
                          key={icon}
                          onClick={() => {
                            setFormIcon(icon);
                            setShowIconPicker(false);
                          }}
                          className={`w-7 h-7 rounded-md flex items-center justify-center text-sm hover:bg-blade-surface-hover transition-colors ${
                            formIcon === icon ? "bg-blade-accent-muted ring-1 ring-blade-accent/40" : ""
                          }`}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <label className="block text-2xs text-blade-muted mb-1">Name</label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="Template name..."
                    className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-1.5 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors"
                    autoFocus
                  />
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1">Category</label>
                <div className="flex gap-1.5">
                  {CATEGORY_OPTIONS.map((cat) => (
                    <button
                      key={cat.value}
                      onClick={() => setFormCategory(cat.value)}
                      className={`text-2xs px-2.5 py-1 rounded-md transition-colors font-medium ${
                        formCategory === cat.value
                          ? "bg-blade-accent-muted text-blade-text"
                          : "text-blade-muted hover:text-blade-secondary bg-blade-bg border border-blade-border hover:border-blade-accent/30"
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Content */}
              <div>
                <label className="block text-2xs text-blade-muted mb-1">
                  Content{" "}
                  <span className="text-blade-muted/60">
                    (use {"{{variable}}"} for placeholders)
                  </span>
                </label>
                <textarea
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  rows={6}
                  placeholder={"Analyze this {{language}} code for {{aspect}}:\n\n{{code}}"}
                  className="w-full bg-blade-bg border border-blade-border rounded-lg px-3 py-2 text-xs text-blade-text outline-none placeholder:text-blade-muted focus:border-blade-accent/40 transition-colors resize-y font-mono leading-relaxed"
                />
              </div>

              {/* Detected Variables Preview */}
              {formContent && extractVariables(formContent).length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-2xs text-blade-muted">Variables:</span>
                  {extractVariables(formContent).map((v) => (
                    <span
                      key={v}
                      className="text-2xs px-1.5 py-0.5 rounded bg-blade-accent-muted text-blade-accent font-mono"
                    >
                      {v}
                    </span>
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    resetForm();
                    setView("browse");
                  }}
                  className="text-xs px-3 py-1.5 rounded-lg text-blade-muted hover:text-blade-secondary hover:bg-blade-surface-hover transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateSubmit}
                  disabled={!formName.trim() || !formContent.trim()}
                  className="text-xs px-4 py-1.5 rounded-lg bg-blade-accent text-white font-medium hover:bg-blade-accent/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {editingId ? "Save Changes" : "Create Template"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
