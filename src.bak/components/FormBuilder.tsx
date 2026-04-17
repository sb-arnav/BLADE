import { useCallback, useMemo, useState } from "react";
import {
  useFormBuilder,
  Form,
  FormField,
  FieldType,
  FormAnalytics,
} from "../hooks/useFormBuilder";

// ── Constants ──────────────────────────────────────────────────────────

const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  text: "\u2139",        // info
  textarea: "\u2261",    // triple bar
  number: "#",
  email: "@",
  select: "\u25BE",      // down triangle
  multiselect: "\u2610", // ballot box
  checkbox: "\u2611",    // checked ballot
  radio: "\u25C9",       // circle dot
  date: "\u29D6",        // hourglass
  rating: "\u2605",      // star
  scale: "\u2194",       // left-right arrow
  file: "\u21A5",        // up arrow from bar
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Short Text",
  textarea: "Long Text",
  number: "Number",
  email: "Email",
  select: "Dropdown",
  multiselect: "Multi Select",
  checkbox: "Checkbox",
  radio: "Radio Group",
  date: "Date",
  rating: "Rating",
  scale: "Scale",
  file: "File Upload",
};

const ALL_FIELD_TYPES: FieldType[] = [
  "text", "textarea", "number", "email",
  "select", "multiselect", "checkbox", "radio",
  "date", "rating", "scale", "file",
];

const THEME_LABELS: Record<Form["theme"], string> = {
  default: "Default",
  minimal: "Minimal",
  card: "Card",
};

type View = "list" | "builder" | "preview" | "submissions" | "analytics";

// ── Props ──────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ──────────────────────────────────────────────────────────

export default function FormBuilder({ onBack, onSendToChat }: Props) {
  const fb = useFormBuilder();
  const [view, setView] = useState<View>("list");
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [previewData, setPreviewData] = useState<Record<string, any>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const editingField = useMemo(
    () => fb.activeForm?.fields.find((f) => f.id === editingFieldId) ?? null,
    [fb.activeForm, editingFieldId],
  );

  const filteredForms = useMemo(() => {
    if (!searchQuery.trim()) return fb.forms;
    const q = searchQuery.toLowerCase();
    return fb.forms.filter(
      (f) => f.title.toLowerCase().includes(q) || f.description.toLowerCase().includes(q),
    );
  }, [fb.forms, searchQuery]);

  const analytics: FormAnalytics | null = useMemo(
    () => (fb.activeForm ? fb.getAnalytics(fb.activeForm.id) : null),
    [fb.activeForm, fb.getAnalytics],
  );

  // ── Handlers ─────────────────────────────────────────────────────

  const openForm = useCallback(
    (id: string) => {
      fb.setActiveFormId(id);
      setView("builder");
      setEditingFieldId(null);
    },
    [fb],
  );

  const handleCreateForm = useCallback(() => {
    fb.createForm("Untitled Form", "");
    setView("builder");
  }, [fb]);

  const handleAddField = useCallback(
    (type: FieldType) => {
      if (!fb.activeForm) return;
      const field = fb.addField(fb.activeForm.id, type);
      if (field) setEditingFieldId(field.id);
      setShowTypePicker(false);
    },
    [fb],
  );

  const handleAiGenerate = useCallback(() => {
    if (!fb.activeForm || !aiPrompt.trim()) return;
    fb.generateFromPrompt(fb.activeForm.id, aiPrompt);
    setShowAiPanel(false);
    setAiPrompt("");
  }, [fb, aiPrompt]);

  const handlePreviewSubmit = useCallback(() => {
    if (!fb.activeForm) return;
    fb.addSubmission(fb.activeForm.id, previewData);
    setPreviewData({});
  }, [fb, previewData]);

  const handleExport = useCallback(() => {
    if (!fb.activeForm) return;
    const csv = fb.exportResponses(fb.activeForm.id);
    if (csv) downloadCSV(csv, `${fb.activeForm.title.replace(/\s+/g, "_")}_responses.csv`);
  }, [fb]);

  const handleDragStart = useCallback((index: number) => setDragIndex(index), []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index || !fb.activeForm) return;
    fb.reorderFields(fb.activeForm.id, dragIndex, index);
    setDragIndex(index);
  }, [dragIndex, fb]);

  const handleDragEnd = useCallback(() => setDragIndex(null), []);

  // ── Render: Form List ────────────────────────────────────────────

  const renderList = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="text-white/50 hover:text-white transition">
            \u2190
          </button>
          <h2 className="text-sm font-semibold text-white">Form Builder</h2>
          <span className="text-[10px] text-white/30 bg-white/5 px-1.5 py-0.5 rounded">
            {fb.forms.length}
          </span>
        </div>
        <button
          onClick={handleCreateForm}
          className="text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 px-3 py-1.5 rounded-md transition"
        >
          + New Form
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <input
          type="text"
          placeholder="Search forms..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-blue-500/50"
        />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filteredForms.length === 0 && (
          <div className="text-center text-white/30 text-xs mt-16">
            {searchQuery ? "No forms match your search" : "No forms yet. Create one to get started."}
          </div>
        )}
        {filteredForms.map((form) => (
          <button
            key={form.id}
            onClick={() => openForm(form.id)}
            className="w-full text-left bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] rounded-lg p-3 transition group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-white truncate">{form.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${form.published ? "bg-green-500/20 text-green-400" : "bg-white/5 text-white/30"}`}>
                {form.published ? "Published" : "Draft"}
              </span>
            </div>
            {form.description && (
              <p className="text-[10px] text-white/40 truncate mb-1">{form.description}</p>
            )}
            <div className="flex items-center gap-3 text-[10px] text-white/30">
              <span>{form.fields.length} fields</span>
              <span>{form.submissions.length} responses</span>
              <span>{timeAgo(form.updatedAt)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  // ── Render: Builder ──────────────────────────────────────────────

  const renderBuilder = () => {
    const form = fb.activeForm;
    if (!form) return null;

    return (
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setView("list"); fb.setActiveFormId(null); }}
              className="text-white/50 hover:text-white transition text-sm"
            >
              \u2190
            </button>
            <span className="text-xs font-semibold text-white truncate max-w-[160px]">{form.title}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-[10px] px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition"
            >
              \u2699 Settings
            </button>
            <button
              onClick={() => setView("preview")}
              className="text-[10px] px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition"
            >
              \u25B6 Preview
            </button>
            <button
              onClick={() => setView("submissions")}
              className="text-[10px] px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition"
            >
              \u2709 Responses ({form.submissions.length})
            </button>
            <button
              onClick={() => setView("analytics")}
              className="text-[10px] px-2 py-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition"
            >
              \u2191 Analytics
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02] space-y-2">
            <input
              value={form.title}
              onChange={(e) => fb.updateForm(form.id, { title: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500/50"
              placeholder="Form title"
            />
            <input
              value={form.description}
              onChange={(e) => fb.updateForm(form.id, { description: e.target.value })}
              className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none focus:border-blue-500/50"
              placeholder="Form description"
            />
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/40">Theme:</span>
              {(["default", "minimal", "card"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => fb.updateForm(form.id, { theme: t })}
                  className={`text-[10px] px-2 py-0.5 rounded transition ${form.theme === t ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-white/40 hover:text-white/60"}`}
                >
                  {THEME_LABELS[t]}
                </button>
              ))}
              <div className="flex-1" />
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) => fb.updateForm(form.id, { published: e.target.checked })}
                  className="accent-blue-500"
                />
                <span className="text-[10px] text-white/50">Published</span>
              </label>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => { fb.duplicateForm(form.id); }}
                className="text-[10px] px-2 py-1 rounded bg-white/5 text-white/50 hover:text-white transition"
              >
                Duplicate
              </button>
              <button
                onClick={() => {
                  onSendToChat(`Form: ${form.title}\n${form.fields.map((f) => `- ${f.label} (${f.type}${f.required ? ", required" : ""})`).join("\n")}`);
                }}
                className="text-[10px] px-2 py-1 rounded bg-white/5 text-white/50 hover:text-white transition"
              >
                Send to Chat
              </button>
              <div className="flex-1" />
              <button
                onClick={() => { fb.deleteForm(form.id); setView("list"); }}
                className="text-[10px] px-2 py-1 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
              >
                Delete Form
              </button>
            </div>
          </div>
        )}

        {/* Main builder area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Field list */}
          <div className="w-1/2 border-r border-white/10 flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
              <span className="text-[10px] text-white/40 uppercase tracking-wider">Fields ({form.fields.length})</span>
              <div className="flex gap-1">
                <button
                  onClick={() => setShowAiPanel(!showAiPanel)}
                  className="text-[10px] px-2 py-0.5 rounded bg-purple-500/15 text-purple-400 hover:bg-purple-500/25 transition"
                >
                  \u2728 AI Generate
                </button>
                <button
                  onClick={() => setShowTypePicker(!showTypePicker)}
                  className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 transition"
                >
                  + Add Field
                </button>
              </div>
            </div>

            {/* AI prompt panel */}
            {showAiPanel && (
              <div className="px-3 py-2 border-b border-white/5 bg-purple-500/[0.03]">
                <p className="text-[10px] text-purple-300/60 mb-1.5">Describe your form and AI will generate fields</p>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Customer feedback survey with rating, satisfaction, and comments..."
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-purple-500/50 resize-none h-16"
                />
                <div className="flex justify-end gap-1 mt-1.5">
                  <button
                    onClick={() => setShowAiPanel(false)}
                    className="text-[10px] px-2 py-0.5 text-white/40 hover:text-white/60 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAiGenerate}
                    disabled={!aiPrompt.trim()}
                    className="text-[10px] px-3 py-0.5 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition disabled:opacity-30"
                  >
                    Generate Fields
                  </button>
                </div>
              </div>
            )}

            {/* Type picker grid */}
            {showTypePicker && (
              <div className="px-3 py-2 border-b border-white/5 bg-blue-500/[0.02]">
                <div className="grid grid-cols-4 gap-1">
                  {ALL_FIELD_TYPES.map((type) => (
                    <button
                      key={type}
                      onClick={() => handleAddField(type)}
                      className="flex flex-col items-center gap-0.5 p-1.5 rounded bg-white/[0.03] hover:bg-white/[0.08] transition border border-transparent hover:border-blue-500/30"
                    >
                      <span className="text-sm">{FIELD_TYPE_ICONS[type]}</span>
                      <span className="text-[9px] text-white/50">{FIELD_TYPE_LABELS[type]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Field list */}
            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
              {form.fields.length === 0 && (
                <div className="text-center text-white/20 text-[10px] mt-10">
                  No fields yet. Add a field or use AI to generate them.
                </div>
              )}
              {form.fields.map((field, i) => (
                <div
                  key={field.id}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onClick={() => setEditingFieldId(field.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition group ${editingFieldId === field.id ? "bg-blue-500/10 border border-blue-500/30" : "hover:bg-white/[0.04] border border-transparent"}`}
                >
                  <span className="text-white/20 cursor-grab text-[10px] group-hover:text-white/40">\u2261</span>
                  <span className="text-[11px] w-4 text-center shrink-0">{FIELD_TYPE_ICONS[field.type]}</span>
                  <span className="text-xs text-white/80 truncate flex-1">{field.label || "Untitled"}</span>
                  {field.required && <span className="text-[9px] text-red-400">*</span>}
                  <span className="text-[9px] text-white/20">{FIELD_TYPE_LABELS[field.type]}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); fb.deleteField(form.id, field.id); if (editingFieldId === field.id) setEditingFieldId(null); }}
                    className="text-white/10 hover:text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition"
                  >
                    \u2715
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Field editor */}
          <div className="w-1/2 overflow-y-auto">
            {editingField ? (
              <div className="p-4 space-y-3">
                <h3 className="text-xs font-semibold text-white/70 flex items-center gap-1.5">
                  <span>{FIELD_TYPE_ICONS[editingField.type]}</span>
                  Edit Field
                </h3>

                {/* Type */}
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">Field Type</label>
                  <select
                    value={editingField.type}
                    onChange={(e) => fb.updateField(form.id, editingField.id, { type: e.target.value as FieldType })}
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500/50"
                  >
                    {ALL_FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>

                {/* Label */}
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">Label</label>
                  <input
                    value={editingField.label}
                    onChange={(e) => fb.updateField(form.id, editingField.id, { label: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none focus:border-blue-500/50"
                    placeholder="Field label"
                  />
                </div>

                {/* Placeholder */}
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">Placeholder</label>
                  <input
                    value={editingField.placeholder}
                    onChange={(e) => fb.updateField(form.id, editingField.id, { placeholder: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none focus:border-blue-500/50"
                    placeholder="Placeholder text"
                  />
                </div>

                {/* Section */}
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">Section (optional)</label>
                  <input
                    value={editingField.section ?? ""}
                    onChange={(e) => fb.updateField(form.id, editingField.id, { section: e.target.value || undefined })}
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none focus:border-blue-500/50"
                    placeholder="Group fields under a section heading"
                  />
                </div>

                {/* Default Value */}
                <div>
                  <label className="text-[10px] text-white/40 block mb-1">Default Value</label>
                  <input
                    value={editingField.defaultValue ?? ""}
                    onChange={(e) => fb.updateField(form.id, editingField.id, { defaultValue: e.target.value || undefined })}
                    className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none focus:border-blue-500/50"
                    placeholder="Default value"
                  />
                </div>

                {/* Required toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingField.required}
                    onChange={(e) => fb.updateField(form.id, editingField.id, { required: e.target.checked })}
                    className="accent-blue-500"
                  />
                  <span className="text-[10px] text-white/50">Required field</span>
                </label>

                {/* Options (for select, multiselect, radio) */}
                {(editingField.type === "select" || editingField.type === "multiselect" || editingField.type === "radio") && (
                  <div>
                    <label className="text-[10px] text-white/40 block mb-1">Options (one per line)</label>
                    <textarea
                      value={(editingField.options ?? []).join("\n")}
                      onChange={(e) => fb.updateField(form.id, editingField.id, { options: e.target.value.split("\n") })}
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white/70 outline-none focus:border-blue-500/50 resize-none h-20"
                      placeholder={"Option 1\nOption 2\nOption 3"}
                    />
                  </div>
                )}

                {/* Validation */}
                <div className="space-y-2">
                  <span className="text-[10px] text-white/40 block">Validation</span>
                  {(editingField.type === "number" || editingField.type === "rating" || editingField.type === "scale" || editingField.type === "text" || editingField.type === "textarea") && (
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[9px] text-white/30 block mb-0.5">Min</label>
                        <input
                          type="number"
                          value={editingField.validation?.min ?? ""}
                          onChange={(e) => fb.updateField(form.id, editingField.id, {
                            validation: { ...editingField.validation, min: e.target.value ? Number(e.target.value) : undefined },
                          })}
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[9px] text-white/30 block mb-0.5">Max</label>
                        <input
                          type="number"
                          value={editingField.validation?.max ?? ""}
                          onChange={(e) => fb.updateField(form.id, editingField.id, {
                            validation: { ...editingField.validation, max: e.target.value ? Number(e.target.value) : undefined },
                          })}
                          className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none"
                        />
                      </div>
                    </div>
                  )}
                  {(editingField.type === "text" || editingField.type === "email") && (
                    <div>
                      <label className="text-[9px] text-white/30 block mb-0.5">Pattern (regex)</label>
                      <input
                        value={editingField.validation?.pattern ?? ""}
                        onChange={(e) => fb.updateField(form.id, editingField.id, {
                          validation: { ...editingField.validation, pattern: e.target.value || undefined },
                        })}
                        className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none font-mono"
                        placeholder="^[A-Z].*"
                      />
                    </div>
                  )}
                  <div>
                    <label className="text-[9px] text-white/30 block mb-0.5">Error Message</label>
                    <input
                      value={editingField.validation?.message ?? ""}
                      onChange={(e) => fb.updateField(form.id, editingField.id, {
                        validation: { ...editingField.validation, message: e.target.value || undefined },
                      })}
                      className="w-full bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/70 outline-none"
                      placeholder="Custom error message"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-white/20 text-xs">
                Select a field to edit its properties
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Preview ──────────────────────────────────────────────

  const renderPreviewField = (field: FormField) => {
    const val = previewData[field.id];
    const update = (v: any) => setPreviewData((p) => ({ ...p, [field.id]: v }));

    const themeClass = fb.activeForm?.theme === "card"
      ? "bg-white/[0.03] border border-white/[0.06] rounded-lg p-3"
      : fb.activeForm?.theme === "minimal"
        ? "border-b border-white/5 pb-3"
        : "";

    return (
      <div key={field.id} className={`space-y-1 ${themeClass}`}>
        <label className="text-xs text-white/70 block">
          {field.label || "Untitled"} {field.required && <span className="text-red-400">*</span>}
        </label>

        {field.type === "text" && (
          <input
            value={val ?? field.defaultValue ?? ""}
            onChange={(e) => update(e.target.value)}
            placeholder={field.placeholder}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500/50"
          />
        )}

        {field.type === "textarea" && (
          <textarea
            value={val ?? field.defaultValue ?? ""}
            onChange={(e) => update(e.target.value)}
            placeholder={field.placeholder}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500/50 resize-none h-20"
          />
        )}

        {field.type === "number" && (
          <input
            type="number"
            value={val ?? field.defaultValue ?? ""}
            onChange={(e) => update(Number(e.target.value))}
            placeholder={field.placeholder}
            min={field.validation?.min}
            max={field.validation?.max}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500/50"
          />
        )}

        {field.type === "email" && (
          <input
            type="email"
            value={val ?? field.defaultValue ?? ""}
            onChange={(e) => update(e.target.value)}
            placeholder={field.placeholder || "you@example.com"}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-blue-500/50"
          />
        )}

        {field.type === "select" && (
          <select
            value={val ?? field.defaultValue ?? ""}
            onChange={(e) => update(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
          >
            <option value="">{field.placeholder || "Select..."}</option>
            {(field.options ?? []).filter(Boolean).map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        )}

        {field.type === "multiselect" && (
          <div className="flex flex-wrap gap-1.5">
            {(field.options ?? []).filter(Boolean).map((opt) => {
              const selected = Array.isArray(val) && val.includes(opt);
              return (
                <button
                  key={opt}
                  onClick={() => {
                    const arr = Array.isArray(val) ? [...val] : [];
                    update(selected ? arr.filter((v) => v !== opt) : [...arr, opt]);
                  }}
                  className={`text-[10px] px-2 py-1 rounded-full border transition ${selected ? "bg-blue-500/20 border-blue-500/40 text-blue-400" : "border-white/10 text-white/40 hover:text-white/60"}`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        )}

        {field.type === "checkbox" && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={!!val}
              onChange={(e) => update(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="text-xs text-white/50">{field.placeholder || "Yes"}</span>
          </label>
        )}

        {field.type === "radio" && (
          <div className="space-y-1">
            {(field.options ?? []).filter(Boolean).map((opt) => (
              <label key={opt} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name={field.id}
                  checked={val === opt}
                  onChange={() => update(opt)}
                  className="accent-blue-500"
                />
                <span className="text-xs text-white/50">{opt}</span>
              </label>
            ))}
          </div>
        )}

        {field.type === "date" && (
          <input
            type="date"
            value={val ?? field.defaultValue ?? ""}
            onChange={(e) => update(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white outline-none focus:border-blue-500/50"
          />
        )}

        {field.type === "rating" && (
          <div className="flex gap-1">
            {Array.from({ length: field.validation?.max ?? 5 }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => update(n)}
                className={`text-lg transition ${n <= (val ?? 0) ? "text-yellow-400" : "text-white/15 hover:text-yellow-400/50"}`}
              >
                \u2605
              </button>
            ))}
            {val && <span className="text-[10px] text-white/30 ml-1 self-center">{val}/{field.validation?.max ?? 5}</span>}
          </div>
        )}

        {field.type === "scale" && (
          <div className="space-y-1">
            <input
              type="range"
              min={field.validation?.min ?? 1}
              max={field.validation?.max ?? 10}
              value={val ?? field.validation?.min ?? 1}
              onChange={(e) => update(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-[9px] text-white/30">
              <span>{field.validation?.min ?? 1}</span>
              <span className="text-white/50 font-medium">{val ?? field.validation?.min ?? 1}</span>
              <span>{field.validation?.max ?? 10}</span>
            </div>
          </div>
        )}

        {field.type === "file" && (
          <div className="border border-dashed border-white/10 rounded-lg p-3 text-center">
            <span className="text-[10px] text-white/30">\u21A5 Click or drag to upload</span>
          </div>
        )}
      </div>
    );
  };

  const renderPreview = () => {
    const form = fb.activeForm;
    if (!form) return null;

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => setView("builder")} className="text-white/50 hover:text-white transition text-sm">\u2190</button>
            <span className="text-xs font-semibold text-white">Preview</span>
          </div>
          <button
            onClick={() => { setPreviewData({}); }}
            className="text-[10px] px-2 py-1 text-white/40 hover:text-white/60 transition"
          >
            Reset
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="max-w-md mx-auto space-y-4">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-white">{form.title}</h2>
              {form.description && <p className="text-[11px] text-white/40 mt-1">{form.description}</p>}
            </div>
            {form.fields
              .slice()
              .sort((a, b) => a.order - b.order)
              .map(renderPreviewField)}

            {form.fields.length > 0 && (
              <button
                onClick={handlePreviewSubmit}
                className="w-full bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 py-2 rounded-md text-xs font-medium transition"
              >
                Submit
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Submissions ──────────────────────────────────────────

  const renderSubmissions = () => {
    const form = fb.activeForm;
    if (!form) return null;

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => setView("builder")} className="text-white/50 hover:text-white transition text-sm">\u2190</button>
            <span className="text-xs font-semibold text-white">Responses ({form.submissions.length})</span>
          </div>
          <button
            onClick={handleExport}
            disabled={form.submissions.length === 0}
            className="text-[10px] px-3 py-1 rounded bg-green-500/15 text-green-400 hover:bg-green-500/25 transition disabled:opacity-30"
          >
            Export CSV
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {form.submissions.length === 0 ? (
            <div className="text-center text-white/20 text-xs mt-16">
              No submissions yet. Preview the form to submit test data.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left text-[10px] text-white/40 px-3 py-2 font-medium">#</th>
                  {form.fields.slice(0, 6).map((field) => (
                    <th key={field.id} className="text-left text-[10px] text-white/40 px-3 py-2 font-medium truncate max-w-[120px]">
                      {field.label}
                    </th>
                  ))}
                  <th className="text-left text-[10px] text-white/40 px-3 py-2 font-medium">Time</th>
                </tr>
              </thead>
              <tbody>
                {form.submissions
                  .slice()
                  .reverse()
                  .map((sub, i) => (
                    <tr key={sub.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-white/30">{form.submissions.length - i}</td>
                      {form.fields.slice(0, 6).map((field) => {
                        const v = sub.data[field.id];
                        const display = v === undefined ? "\u2014" : Array.isArray(v) ? v.join(", ") : String(v);
                        return (
                          <td key={field.id} className="px-3 py-2 text-white/60 truncate max-w-[120px]">
                            {display}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-white/30">{timeAgo(sub.submittedAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  };

  // ── Render: Analytics ────────────────────────────────────────────

  const renderAnalytics = () => {
    const form = fb.activeForm;
    if (!form || !analytics) return null;

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <button onClick={() => setView("builder")} className="text-white/50 hover:text-white transition text-sm">\u2190</button>
            <span className="text-xs font-semibold text-white">Analytics</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Overview cards */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-white">{analytics.totalSubmissions}</div>
              <div className="text-[10px] text-white/40">Total Responses</div>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-green-400">{analytics.completionRate}%</div>
              <div className="text-[10px] text-white/40">Completion Rate</div>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-blue-400">{form.fields.length}</div>
              <div className="text-[10px] text-white/40">Fields</div>
            </div>
          </div>

          {/* Submissions over time */}
          {analytics.submissionsOverTime.length > 0 && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
              <h4 className="text-[10px] text-white/40 uppercase tracking-wider mb-2">Submissions Over Time</h4>
              <div className="flex items-end gap-1 h-16">
                {analytics.submissionsOverTime.map((point) => {
                  const maxCount = Math.max(...analytics.submissionsOverTime.map((p) => p.count));
                  const height = maxCount > 0 ? (point.count / maxCount) * 100 : 0;
                  return (
                    <div key={point.date} className="flex-1 flex flex-col items-center gap-0.5">
                      <span className="text-[8px] text-white/30">{point.count}</span>
                      <div
                        className="w-full bg-blue-500/30 rounded-t min-h-[2px]"
                        style={{ height: `${height}%` }}
                      />
                      <span className="text-[7px] text-white/20 truncate w-full text-center">{point.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Per-field stats */}
          <div className="space-y-2">
            <h4 className="text-[10px] text-white/40 uppercase tracking-wider">Per-Field Breakdown</h4>
            {Object.values(analytics.fieldStats).map((stat) => (
              <div key={stat.label} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-white/70 font-medium">{stat.label}</span>
                  <span className="text-[9px] text-white/30">{FIELD_TYPE_LABELS[stat.type]}</span>
                </div>

                <div className="flex gap-3 text-[10px] text-white/40 mb-2">
                  <span>{stat.answered} answered</span>
                  <span>{stat.skipped} skipped</span>
                  {stat.average !== undefined && <span>Avg: {stat.average}</span>}
                </div>

                {/* Completion bar */}
                <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-blue-500/50 rounded-full transition-all"
                    style={{ width: `${analytics.totalSubmissions > 0 ? (stat.answered / analytics.totalSubmissions) * 100 : 0}%` }}
                  />
                </div>

                {/* Top answers */}
                {stat.topAnswers.length > 0 && (
                  <div className="space-y-0.5">
                    {stat.topAnswers.map((ans) => (
                      <div key={ans.value} className="flex items-center gap-2">
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500/40 rounded-full"
                            style={{ width: `${analytics.totalSubmissions > 0 ? (ans.count / analytics.totalSubmissions) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="text-[9px] text-white/40 truncate max-w-[80px]">{ans.value}</span>
                        <span className="text-[9px] text-white/25">{ans.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {analytics.totalSubmissions === 0 && (
            <div className="text-center text-white/20 text-xs mt-8">
              No submissions yet. Analytics will appear once responses come in.
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Main render ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)] text-white">
      {view === "list" && renderList()}
      {view === "builder" && renderBuilder()}
      {view === "preview" && renderPreview()}
      {view === "submissions" && renderSubmissions()}
      {view === "analytics" && renderAnalytics()}
    </div>
  );
}
