import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "email"
  | "select"
  | "multiselect"
  | "checkbox"
  | "radio"
  | "date"
  | "rating"
  | "scale"
  | "file";

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  placeholder: string;
  required: boolean;
  options?: string[];
  validation?: FieldValidation;
  defaultValue?: string;
  order: number;
  section?: string;
}

export interface FormSubmission {
  id: string;
  formId: string;
  data: Record<string, string | string[] | number | boolean>;
  submittedAt: number;
}

export interface Form {
  id: string;
  title: string;
  description: string;
  fields: FormField[];
  theme: "default" | "minimal" | "card";
  submissions: FormSubmission[];
  createdAt: number;
  updatedAt: number;
  published: boolean;
}

export interface FormAnalytics {
  totalSubmissions: number;
  completionRate: number;
  fieldStats: Record<
    string,
    {
      label: string;
      type: FieldType;
      answered: number;
      skipped: number;
      topAnswers: { value: string; count: number }[];
      average?: number;
    }
  >;
  submissionsOverTime: { date: string; count: number }[];
}

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-forms";
const MAX_FORMS = 200;

// ── Helpers ────────────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function load(): Form[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(forms: Form[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(forms));
}

function defaultField(type: FieldType, order: number): FormField {
  const base: FormField = {
    id: generateId("fld"),
    type,
    label: "",
    placeholder: "",
    required: false,
    order,
  };
  if (type === "select" || type === "multiselect" || type === "radio") {
    base.options = ["Option 1", "Option 2"];
  }
  if (type === "rating") {
    base.validation = { min: 1, max: 5 };
  }
  if (type === "scale") {
    base.validation = { min: 1, max: 10 };
  }
  return base;
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

// ── AI Field Generation ───────────────────────────────────────────────

function inferFieldsFromPrompt(description: string): FormField[] {
  const lower = description.toLowerCase();
  const fields: FormField[] = [];
  let order = 0;

  const push = (type: FieldType, label: string, opts?: Partial<FormField>) => {
    fields.push({ ...defaultField(type, order++), label, placeholder: `Enter ${label.toLowerCase()}`, ...opts });
  };

  // Name patterns
  if (/\bname\b/.test(lower) || /\bcontact\b/.test(lower) || /\bregistration\b/.test(lower) || /\bsign\s*up\b/.test(lower)) {
    push("text", "Full Name", { required: true, placeholder: "John Doe" });
  }

  // Email patterns
  if (/\bemail\b/.test(lower) || /\bcontact\b/.test(lower) || /\bregistration\b/.test(lower) || /\bsign\s*up\b/.test(lower) || /\bnewsletter\b/.test(lower)) {
    push("email", "Email Address", { required: true, placeholder: "you@example.com" });
  }

  // Phone
  if (/\bphone\b/.test(lower) || /\bcall\b/.test(lower) || /\bcontact\b/.test(lower)) {
    push("text", "Phone Number", { placeholder: "+1 (555) 000-0000", validation: { pattern: "^[\\+]?[0-9\\s\\-\\(\\)]+$", message: "Enter a valid phone number" } });
  }

  // Company / organization
  if (/\bcompany\b/.test(lower) || /\borg(anization)?\b/.test(lower) || /\bbusiness\b/.test(lower)) {
    push("text", "Company / Organization");
  }

  // Role / job title
  if (/\brole\b/.test(lower) || /\bjob\b/.test(lower) || /\bposition\b/.test(lower) || /\btitle\b/.test(lower)) {
    push("text", "Job Title");
  }

  // Date of birth or event date
  if (/\bdate of birth\b/.test(lower) || /\bbirthday\b/.test(lower) || /\bdob\b/.test(lower)) {
    push("date", "Date of Birth");
  } else if (/\bdate\b/.test(lower) || /\bwhen\b/.test(lower) || /\bschedule\b/.test(lower)) {
    push("date", "Preferred Date");
  }

  // Age
  if (/\bage\b/.test(lower)) {
    push("number", "Age", { validation: { min: 1, max: 150 } });
  }

  // Rating / satisfaction
  if (/\brat(e|ing)\b/.test(lower) || /\bsatisf(action|ied)\b/.test(lower) || /\bfeedback\b/.test(lower) || /\bsurvey\b/.test(lower)) {
    push("rating", "Overall Rating", { validation: { min: 1, max: 5 } });
  }

  // NPS / scale
  if (/\bnps\b/.test(lower) || /\brecommend\b/.test(lower) || /\blikelihood\b/.test(lower)) {
    push("scale", "How likely are you to recommend us?", { validation: { min: 0, max: 10 } });
  }

  // Experience level
  if (/\bexperience\b/.test(lower) || /\bskill\b/.test(lower)) {
    push("select", "Experience Level", { options: ["Beginner", "Intermediate", "Advanced", "Expert"] });
  }

  // Multiple choice / preference
  if (/\bprefer(ence|red)?\b/.test(lower) || /\bchoose\b/.test(lower) || /\bselect\b/.test(lower)) {
    push("select", "Preference", { options: ["Option A", "Option B", "Option C"] });
  }

  // Topics / interests (multi-select)
  if (/\btopic\b/.test(lower) || /\binterest\b/.test(lower) || /\bhobb(y|ies)\b/.test(lower)) {
    push("multiselect", "Topics of Interest", { options: ["Technology", "Science", "Art", "Music", "Sports", "Travel", "Food"] });
  }

  // Newsletter / subscribe (checkbox)
  if (/\bnewsletter\b/.test(lower) || /\bsubscri(be|ption)\b/.test(lower) || /\bopt[\s-]?in\b/.test(lower)) {
    push("checkbox", "Subscribe to newsletter");
  }

  // Terms / agreement
  if (/\bterms\b/.test(lower) || /\bagree\b/.test(lower) || /\bconsent\b/.test(lower)) {
    push("checkbox", "I agree to the terms and conditions", { required: true });
  }

  // File upload
  if (/\bupload\b/.test(lower) || /\battach\b/.test(lower) || /\bfile\b/.test(lower) || /\bresume\b/.test(lower) || /\bcv\b/.test(lower)) {
    push("file", "Upload File");
  }

  // Address
  if (/\baddress\b/.test(lower) || /\blocation\b/.test(lower)) {
    push("textarea", "Address", { placeholder: "Street, City, State, ZIP" });
  }

  // Comments / message / description / notes / additional
  if (/\bcomment\b/.test(lower) || /\bmessage\b/.test(lower) || /\bdescription\b/.test(lower) || /\bnotes?\b/.test(lower) || /\bfeedback\b/.test(lower) || /\badditional\b/.test(lower)) {
    push("textarea", "Additional Comments", { placeholder: "Anything else you'd like to share..." });
  }

  // Gender / radio
  if (/\bgender\b/.test(lower)) {
    push("radio", "Gender", { options: ["Male", "Female", "Non-binary", "Prefer not to say"] });
  }

  // Fallback: if nothing matched, provide basic fields
  if (fields.length === 0) {
    push("text", "Name", { required: true });
    push("email", "Email", { required: true });
    push("textarea", "Your Response", { placeholder: "Type your answer here..." });
  }

  return fields;
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useFormBuilder() {
  const [forms, setForms] = useState<Form[]>(load);
  const [activeFormId, setActiveFormId] = useState<string | null>(null);

  // Persist on change
  useEffect(() => {
    save(forms);
  }, [forms]);

  const activeForm = useMemo(
    () => forms.find((f) => f.id === activeFormId) ?? null,
    [forms, activeFormId],
  );

  // ── Form CRUD ──────────────────────────────────────────────────────

  const createForm = useCallback((title: string, description = ""): Form => {
    const now = Date.now();
    const form: Form = {
      id: generateId("frm"),
      title: title || "Untitled Form",
      description,
      fields: [],
      theme: "default",
      submissions: [],
      createdAt: now,
      updatedAt: now,
      published: false,
    };
    setForms((prev) => {
      const next = [form, ...prev];
      if (next.length > MAX_FORMS) next.pop();
      return next;
    });
    setActiveFormId(form.id);
    return form;
  }, []);

  const updateForm = useCallback((id: string, patch: Partial<Omit<Form, "id" | "createdAt">>) => {
    setForms((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: Date.now() } : f)),
    );
  }, []);

  const deleteForm = useCallback((id: string) => {
    setForms((prev) => prev.filter((f) => f.id !== id));
    setActiveFormId((cur) => (cur === id ? null : cur));
  }, []);

  const duplicateForm = useCallback((id: string): Form | null => {
    const source = forms.find((f) => f.id === id);
    if (!source) return null;
    const now = Date.now();
    const dup: Form = {
      ...structuredClone(source),
      id: generateId("frm"),
      title: `${source.title} (copy)`,
      submissions: [],
      createdAt: now,
      updatedAt: now,
      published: false,
    };
    dup.fields = dup.fields.map((fld) => ({ ...fld, id: generateId("fld") }));
    setForms((prev) => [dup, ...prev]);
    setActiveFormId(dup.id);
    return dup;
  }, [forms]);

  // ── Field CRUD ─────────────────────────────────────────────────────

  const addField = useCallback((formId: string, type: FieldType): FormField | null => {
    let field: FormField | null = null;
    setForms((prev) =>
      prev.map((f) => {
        if (f.id !== formId) return f;
        field = defaultField(type, f.fields.length);
        field.label = `${type.charAt(0).toUpperCase() + type.slice(1)} Field`;
        return { ...f, fields: [...f.fields, field], updatedAt: Date.now() };
      }),
    );
    return field;
  }, []);

  const updateField = useCallback((formId: string, fieldId: string, patch: Partial<Omit<FormField, "id">>) => {
    setForms((prev) =>
      prev.map((f) => {
        if (f.id !== formId) return f;
        return {
          ...f,
          fields: f.fields.map((fld) => (fld.id === fieldId ? { ...fld, ...patch } : fld)),
          updatedAt: Date.now(),
        };
      }),
    );
  }, []);

  const deleteField = useCallback((formId: string, fieldId: string) => {
    setForms((prev) =>
      prev.map((f) => {
        if (f.id !== formId) return f;
        const filtered = f.fields.filter((fld) => fld.id !== fieldId);
        return { ...f, fields: filtered.map((fld, i) => ({ ...fld, order: i })), updatedAt: Date.now() };
      }),
    );
  }, []);

  const reorderFields = useCallback((formId: string, fromIndex: number, toIndex: number) => {
    setForms((prev) =>
      prev.map((f) => {
        if (f.id !== formId) return f;
        const next = [...f.fields];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return { ...f, fields: next.map((fld, i) => ({ ...fld, order: i })), updatedAt: Date.now() };
      }),
    );
  }, []);

  // ── Submissions ────────────────────────────────────────────────────

  const addSubmission = useCallback((formId: string, data: FormSubmission["data"]) => {
    const sub: FormSubmission = {
      id: generateId("sub"),
      formId,
      data,
      submittedAt: Date.now(),
    };
    setForms((prev) =>
      prev.map((f) => (f.id === formId ? { ...f, submissions: [...f.submissions, sub], updatedAt: Date.now() } : f)),
    );
    return sub;
  }, []);

  // ── AI Generate ────────────────────────────────────────────────────

  const generateFromPrompt = useCallback((formId: string, description: string) => {
    const generated = inferFieldsFromPrompt(description);
    setForms((prev) =>
      prev.map((f) => {
        if (f.id !== formId) return f;
        const startOrder = f.fields.length;
        const newFields = generated.map((fld, i) => ({ ...fld, order: startOrder + i }));
        return { ...f, fields: [...f.fields, ...newFields], updatedAt: Date.now() };
      }),
    );
    return generated;
  }, []);

  // ── Export ─────────────────────────────────────────────────────────

  const exportResponses = useCallback((formId: string): string => {
    const form = forms.find((f) => f.id === formId);
    if (!form || form.submissions.length === 0) return "";

    const headers = form.fields.map((f) => f.label);
    const rows = form.submissions.map((sub) =>
      form.fields.map((f) => {
        const val = sub.data[f.id];
        if (val === undefined || val === null) return "";
        if (Array.isArray(val)) return val.join("; ");
        return String(val);
      }),
    );

    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [
      ["Submission ID", "Submitted At", ...headers].map(escape).join(","),
      ...form.submissions.map((sub, i) =>
        [sub.id, new Date(sub.submittedAt).toISOString(), ...rows[i]].map((v) => escape(String(v))).join(","),
      ),
    ].join("\n");

    return csv;
  }, [forms]);

  // ── Analytics ──────────────────────────────────────────────────────

  const getAnalytics = useCallback((formId: string): FormAnalytics | null => {
    const form = forms.find((f) => f.id === formId);
    if (!form) return null;

    const total = form.submissions.length;
    const fieldStats: FormAnalytics["fieldStats"] = {};

    for (const field of form.fields) {
      const answered = form.submissions.filter((s) => {
        const v = s.data[field.id];
        return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
      }).length;

      const valueCounts: Record<string, number> = {};
      let numericSum = 0;
      let numericCount = 0;

      for (const sub of form.submissions) {
        const v = sub.data[field.id];
        if (v === undefined || v === null) continue;
        const vals = Array.isArray(v) ? v : [v];
        for (const val of vals) {
          const sv = String(val);
          valueCounts[sv] = (valueCounts[sv] || 0) + 1;
          const n = Number(val);
          if (!isNaN(n)) {
            numericSum += n;
            numericCount++;
          }
        }
      }

      const topAnswers = Object.entries(valueCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));

      fieldStats[field.id] = {
        label: field.label,
        type: field.type,
        answered,
        skipped: total - answered,
        topAnswers,
        ...(numericCount > 0 ? { average: Math.round((numericSum / numericCount) * 100) / 100 } : {}),
      };
    }

    // Submissions over time
    const byDate: Record<string, number> = {};
    for (const sub of form.submissions) {
      const d = formatDate(sub.submittedAt);
      byDate[d] = (byDate[d] || 0) + 1;
    }
    const submissionsOverTime = Object.entries(byDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    // Completion rate: submissions where all required fields are filled
    const requiredFields = form.fields.filter((f) => f.required);
    const complete = form.submissions.filter((sub) =>
      requiredFields.every((rf) => {
        const v = sub.data[rf.id];
        return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
      }),
    ).length;

    return {
      totalSubmissions: total,
      completionRate: total > 0 ? Math.round((complete / total) * 100) : 0,
      fieldStats,
      submissionsOverTime,
    };
  }, [forms]);

  return {
    forms,
    activeForm,
    activeFormId,
    setActiveFormId,
    createForm,
    updateForm,
    deleteForm,
    addField,
    updateField,
    deleteField,
    reorderFields,
    addSubmission,
    generateFromPrompt,
    exportResponses,
    getAnalytics,
    duplicateForm,
  };
}
