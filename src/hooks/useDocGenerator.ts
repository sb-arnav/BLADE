import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/* ── Types ──────────────────────────────────────────────────────── */

export interface DocumentField {
  name: string;
  label: string;
  type: "text" | "textarea" | "select";
  options?: string[];
  placeholder?: string;
  required?: boolean;
}

export interface DocumentTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  fields: DocumentField[];
  systemPrompt: string;
}

export interface GeneratedDocument {
  id: string;
  templateId: string;
  title: string;
  content: string; // markdown
  createdAt: number;
  inputs: Record<string, string>;
}

/* ── Storage ────────────────────────────────────────────────────── */

const STORAGE_KEY = "blade-documents";

function loadDocuments(): GeneratedDocument[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore corrupt data
  }
  return [];
}

function saveDocuments(docs: GeneratedDocument[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

/* ── Built-in Templates ─────────────────────────────────────────── */

const BUILTIN_TEMPLATES: DocumentTemplate[] = [
  {
    id: "doc-resume",
    name: "Resume",
    icon: "\uD83D\uDCCB",
    description: "Generate a professional resume from your details",
    fields: [
      { name: "name", label: "Full Name", type: "text", placeholder: "John Doe", required: true },
      { name: "title", label: "Job Title", type: "text", placeholder: "Senior Software Engineer", required: true },
      { name: "experience", label: "Work Experience", type: "textarea", placeholder: "List your roles, companies, dates, and key achievements...", required: true },
      { name: "skills", label: "Skills", type: "textarea", placeholder: "TypeScript, React, Node.js, AWS...", required: true },
      { name: "education", label: "Education", type: "textarea", placeholder: "Degree, university, graduation year...", required: true },
    ],
    systemPrompt: "You are a professional resume writer. Generate a polished, ATS-friendly resume in Markdown format. Use clear sections with headers (Summary, Experience, Skills, Education). Keep it concise and impactful. Use bullet points for achievements. Include metrics where possible.",
  },
  {
    id: "doc-cover-letter",
    name: "Cover Letter",
    icon: "\u2709\uFE0F",
    description: "Craft a compelling cover letter for a job application",
    fields: [
      { name: "company", label: "Company Name", type: "text", placeholder: "Acme Corp", required: true },
      { name: "position", label: "Position", type: "text", placeholder: "Frontend Developer", required: true },
      { name: "background", label: "Your Background", type: "textarea", placeholder: "Brief summary of your experience and strengths...", required: true },
      { name: "whyThisRole", label: "Why This Role?", type: "textarea", placeholder: "What excites you about this position and company..." },
    ],
    systemPrompt: "You are an expert career coach. Write a compelling, personalized cover letter in Markdown. It should be 3-4 paragraphs, professional yet authentic. Open with a strong hook, connect the candidate's background to the role, and close with enthusiasm.",
  },
  {
    id: "doc-blog-post",
    name: "Blog Post",
    icon: "\u270D\uFE0F",
    description: "Write an engaging blog post on any topic",
    fields: [
      { name: "topic", label: "Topic", type: "text", placeholder: "The Future of AI in Healthcare", required: true },
      { name: "tone", label: "Tone", type: "select", options: ["Professional", "Casual", "Technical", "Conversational", "Academic"], required: true },
      { name: "targetAudience", label: "Target Audience", type: "text", placeholder: "Software developers, general public..." },
      { name: "keyPoints", label: "Key Points", type: "textarea", placeholder: "Main ideas to cover in the post..." },
    ],
    systemPrompt: "You are a skilled content writer. Generate a well-structured blog post in Markdown. Include a compelling title (H1), an engaging introduction, clearly organized sections with subheadings (H2/H3), and a strong conclusion. Use paragraphs, bullet points, and emphasis where appropriate.",
  },
  {
    id: "doc-tech-spec",
    name: "Technical Spec",
    icon: "\uD83D\uDEE0\uFE0F",
    description: "Draft a technical specification document",
    fields: [
      { name: "featureName", label: "Feature Name", type: "text", placeholder: "User Authentication System", required: true },
      { name: "problem", label: "Problem Statement", type: "textarea", placeholder: "What problem does this solve?", required: true },
      { name: "proposedSolution", label: "Proposed Solution", type: "textarea", placeholder: "High-level approach and architecture...", required: true },
      { name: "requirements", label: "Requirements", type: "textarea", placeholder: "Functional and non-functional requirements..." },
    ],
    systemPrompt: "You are a senior software architect. Generate a detailed technical specification in Markdown. Include sections: Overview, Problem Statement, Proposed Solution, Technical Architecture, API Design (if applicable), Data Model, Requirements, Timeline Estimate, Open Questions. Use tables, code blocks, and diagrams descriptions where helpful.",
  },
  {
    id: "doc-meeting-notes",
    name: "Meeting Notes",
    icon: "\uD83D\uDDD3\uFE0F",
    description: "Organize raw meeting notes into structured minutes",
    fields: [
      { name: "meetingTopic", label: "Meeting Topic", type: "text", placeholder: "Q2 Planning Review", required: true },
      { name: "attendees", label: "Attendees", type: "text", placeholder: "Alice, Bob, Charlie..." },
      { name: "rawNotes", label: "Raw Notes", type: "textarea", placeholder: "Paste your unstructured notes here...", required: true },
    ],
    systemPrompt: "You are an executive assistant skilled at organizing meeting notes. Transform raw notes into well-structured meeting minutes in Markdown. Include: Meeting Title, Date, Attendees, Agenda Items, Discussion Summary, Action Items (with owners and deadlines), and Key Decisions. Be concise but comprehensive.",
  },
  {
    id: "doc-email-draft",
    name: "Email Draft",
    icon: "\uD83D\uDCE7",
    description: "Compose a professional email",
    fields: [
      { name: "recipient", label: "Recipient", type: "text", placeholder: "Hiring Manager, Client, Team...", required: true },
      { name: "purpose", label: "Purpose", type: "text", placeholder: "Follow up on proposal, request meeting...", required: true },
      { name: "keyPoints", label: "Key Points", type: "textarea", placeholder: "Main points to communicate..." },
      { name: "tone", label: "Tone", type: "select", options: ["Formal", "Friendly", "Urgent", "Diplomatic", "Casual"] },
    ],
    systemPrompt: "You are a professional communication expert. Draft a clear, well-structured email in Markdown format. Include a subject line (as H1), greeting, body paragraphs, and a professional sign-off. Match the requested tone. Keep it concise and action-oriented.",
  },
  {
    id: "doc-project-proposal",
    name: "Project Proposal",
    icon: "\uD83D\uDE80",
    description: "Create a persuasive project proposal",
    fields: [
      { name: "projectName", label: "Project Name", type: "text", placeholder: "Cloud Migration Initiative", required: true },
      { name: "objective", label: "Objective", type: "textarea", placeholder: "What does this project aim to achieve?", required: true },
      { name: "timeline", label: "Timeline", type: "text", placeholder: "3 months, Q3 2026..." },
      { name: "budget", label: "Budget", type: "text", placeholder: "$50,000, TBD..." },
      { name: "team", label: "Team", type: "textarea", placeholder: "Team members and their roles..." },
    ],
    systemPrompt: "You are a senior project manager. Generate a professional project proposal in Markdown. Include sections: Executive Summary, Objectives, Scope, Timeline & Milestones (use a table), Budget Breakdown (use a table), Team & Roles, Risk Assessment, Success Metrics, and Next Steps. Be persuasive and data-oriented.",
  },
  {
    id: "doc-changelog",
    name: "Changelog",
    icon: "\uD83D\uDCDD",
    description: "Generate a structured changelog entry",
    fields: [
      { name: "version", label: "Version", type: "text", placeholder: "v2.4.0", required: true },
      { name: "date", label: "Release Date", type: "text", placeholder: "2026-04-08" },
      { name: "changesSummary", label: "Changes Summary", type: "textarea", placeholder: "List all changes, new features, fixes, breaking changes...", required: true },
    ],
    systemPrompt: "You are a developer relations specialist. Generate a well-formatted changelog entry in Markdown following the Keep a Changelog convention. Categorize changes under: Added, Changed, Deprecated, Removed, Fixed, Security. Use bullet points. Be specific about what changed and why. Include any migration notes for breaking changes.",
  },
];

/* ── Markdown to HTML conversion ────────────────────────────────── */

function markdownToHtml(md: string): string {
  let html = md;
  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code class=\"language-$1\">$2</code></pre>");
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  // Line breaks into paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;
  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#e0e0e0;background:#0c0c0f}h1,h2,h3{margin-top:1.5em}code{background:#1a1a2e;padding:0.2em 0.4em;border-radius:4px;font-size:0.9em}pre{background:#1a1a2e;padding:1rem;border-radius:8px;overflow-x:auto}li{margin:0.25em 0}table{border-collapse:collapse;width:100%}th,td{border:1px solid #333;padding:0.5rem;text-align:left}</style></head><body>${html}</body></html>`;
}

/* ── Hook ───────────────────────────────────────────────────────── */

function generateId(): string {
  return "doc-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function useDocGenerator() {
  const [documents, setDocuments] = useState<GeneratedDocument[]>(loadDocuments);
  const [generating, setGenerating] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const streamBuffer = useRef("");

  const templates: DocumentTemplate[] = useMemo(() => BUILTIN_TEMPLATES, []);

  // Listen to streaming tokens for document generation
  useEffect(() => {
    let active = true;

    const unlistenToken = listen<string>("chat_token", (event) => {
      if (!active || !streamBuffer.current && !generating) return;
      streamBuffer.current += event.payload;
      setStreamContent(streamBuffer.current);
    });

    const unlistenDone = listen("chat_done", () => {
      if (!active) return;
      setGenerating(false);
    });

    return () => {
      active = false;
      unlistenToken.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, [generating]);

  const generate = useCallback(
    async (templateId: string, inputs: Record<string, string>): Promise<GeneratedDocument | null> => {
      const template = BUILTIN_TEMPLATES.find((t) => t.id === templateId);
      if (!template) return null;

      // Build the user message from inputs
      const inputText = template.fields
        .filter((f) => inputs[f.name]?.trim())
        .map((f) => `**${f.label}:** ${inputs[f.name].trim()}`)
        .join("\n\n");

      streamBuffer.current = "";
      setStreamContent("");
      setGenerating(true);

      try {
        await invoke("send_message_stream", {
          messages: [
            { role: "user", content: `${template.systemPrompt}\n\n---\n\nPlease generate the document using the following information:\n\n${inputText}` },
          ],
        });

        const content = streamBuffer.current;
        const doc: GeneratedDocument = {
          id: generateId(),
          templateId,
          title: inputs[template.fields[0]?.name] || template.name,
          content,
          createdAt: Date.now(),
          inputs,
        };

        setDocuments((prev) => {
          const next = [doc, ...prev];
          saveDocuments(next);
          return next;
        });

        streamBuffer.current = "";
        return doc;
      } catch (err) {
        setGenerating(false);
        streamBuffer.current = "";
        throw err;
      }
    },
    []
  );

  const deleteDocument = useCallback((id: string) => {
    setDocuments((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDocuments(next);
      return next;
    });
  }, []);

  const exportAsMarkdown = useCallback(
    (id: string): string | null => {
      const doc = documents.find((d) => d.id === id);
      return doc?.content ?? null;
    },
    [documents]
  );

  const exportAsHtml = useCallback(
    (id: string): string | null => {
      const doc = documents.find((d) => d.id === id);
      if (!doc) return null;
      return markdownToHtml(doc.content);
    },
    [documents]
  );

  return {
    templates,
    documents,
    generating,
    streamContent,
    generate,
    deleteDocument,
    exportAsMarkdown,
    exportAsHtml,
  };
}
