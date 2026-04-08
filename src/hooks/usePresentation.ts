import { useCallback, useEffect, useMemo, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────────

export interface Slide {
  id: string;
  type:
    | "title"
    | "content"
    | "bullets"
    | "image"
    | "code"
    | "quote"
    | "comparison"
    | "timeline"
    | "stats";
  title: string;
  content: string;
  bullets?: string[];
  code?: { language: string; code: string };
  stats?: Array<{ label: string; value: string; change?: string }>;
  comparison?: {
    left: { title: string; points: string[] };
    right: { title: string; points: string[] };
  };
  timeline?: Array<{ label: string; description: string }>;
  notes: string;
  backgroundColor: string;
  order: number;
}

export interface Presentation {
  id: string;
  title: string;
  author: string;
  theme: "dark" | "light" | "blade" | "minimal";
  slides: Slide[];
  createdAt: number;
  updatedAt: number;
}

export interface PresentationStats {
  totalPresentations: number;
  totalSlides: number;
  byTheme: Record<string, number>;
  bySlideType: Record<string, number>;
  avgSlidesPerDeck: number;
}

// ── Constants ──────────────────────────────────────────────────────────

const STORAGE_KEY = "blade-presentations";

export const THEME_COLORS: Record<
  Presentation["theme"],
  { bg: string; text: string; accent: string; surface: string }
> = {
  dark: {
    bg: "#0f0f14",
    text: "#e4e4e7",
    accent: "#6366f1",
    surface: "#1a1a24",
  },
  light: {
    bg: "#ffffff",
    text: "#18181b",
    accent: "#4f46e5",
    surface: "#f4f4f5",
  },
  blade: {
    bg: "#0c0a1a",
    text: "#e0e7ff",
    accent: "#818cf8",
    surface: "#1e1b4b",
  },
  minimal: {
    bg: "#fafafa",
    text: "#27272a",
    accent: "#71717a",
    surface: "#e4e4e7",
  },
};

const SLIDE_TYPE_LABELS: Record<Slide["type"], string> = {
  title: "Title Slide",
  content: "Content",
  bullets: "Bullet List",
  image: "Image",
  code: "Code Block",
  quote: "Quote",
  comparison: "Comparison",
  timeline: "Timeline",
  stats: "Statistics",
};

export { SLIDE_TYPE_LABELS };

// ── Helpers ────────────────────────────────────────────────────────────

function generateId(): string {
  return `pres_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function slideId(): string {
  return `sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadPresentations(): Presentation[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistPresentations(presentations: Presentation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presentations));
}

function makeSlide(
  type: Slide["type"],
  order: number,
  overrides?: Partial<Slide>,
): Slide {
  return {
    id: slideId(),
    type,
    title: "",
    content: "",
    notes: "",
    backgroundColor: "",
    order,
    ...overrides,
  };
}

// ── AI prompt builders ─────────────────────────────────────────────────

function buildGeneratePrompt(topic: string, slideCount: number): string {
  return (
    `Generate a presentation deck about "${topic}" with exactly ${slideCount} slides.\n\n` +
    `Return ONLY a JSON array (no markdown fences) where each element has:\n` +
    `- "type": one of "title", "content", "bullets", "code", "quote", "comparison", "timeline", "stats"\n` +
    `- "title": slide title\n` +
    `- "content": body text (2-3 sentences for content slides, subtitle for title slide)\n` +
    `- "bullets": array of strings (only for type "bullets", 3-6 items)\n` +
    `- "code": { "language": string, "code": string } (only for type "code")\n` +
    `- "stats": [{ "label": string, "value": string, "change": string }] (only for type "stats", 3-4 items)\n` +
    `- "comparison": { "left": { "title": string, "points": string[] }, "right": { "title": string, "points": string[] } } (only for type "comparison")\n` +
    `- "timeline": [{ "label": string, "description": string }] (only for type "timeline", 3-5 items)\n` +
    `- "notes": speaker notes (1-2 sentences)\n\n` +
    `Slide 1 must be type "title". Use a variety of slide types. Make it professional and insightful.`
  );
}

function parseGeneratedSlides(response: string): Partial<Slide>[] | null {
  try {
    // Strip markdown code fences if present
    let cleaned = response.trim();
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
    }
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Export builders ────────────────────────────────────────────────────

function buildMarkdownExport(pres: Presentation): string {
  const lines: string[] = [`# ${pres.title}`, `**Author:** ${pres.author}`, ""];
  for (let i = 0; i < pres.slides.length; i++) {
    const slide = pres.slides[i];
    if (i > 0) lines.push("---", "");
    lines.push(`## ${slide.title || `Slide ${i + 1}`}`, "");

    switch (slide.type) {
      case "bullets":
        if (slide.bullets) {
          slide.bullets.forEach((b) => lines.push(`- ${b}`));
        }
        break;
      case "code":
        if (slide.code) {
          lines.push(`\`\`\`${slide.code.language}`, slide.code.code, "```");
        }
        break;
      case "quote":
        lines.push(`> ${slide.content}`);
        break;
      case "stats":
        if (slide.stats) {
          slide.stats.forEach((s) => {
            const change = s.change ? ` (${s.change})` : "";
            lines.push(`- **${s.label}:** ${s.value}${change}`);
          });
        }
        break;
      case "comparison":
        if (slide.comparison) {
          lines.push(`### ${slide.comparison.left.title}`);
          slide.comparison.left.points.forEach((p) => lines.push(`- ${p}`));
          lines.push("", `### ${slide.comparison.right.title}`);
          slide.comparison.right.points.forEach((p) => lines.push(`- ${p}`));
        }
        break;
      case "timeline":
        if (slide.timeline) {
          slide.timeline.forEach((t) => lines.push(`- **${t.label}:** ${t.description}`));
        }
        break;
      default:
        if (slide.content) lines.push(slide.content);
    }

    if (slide.notes) {
      lines.push("", `> *Speaker notes: ${slide.notes}*`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildHtmlExport(pres: Presentation): string {
  const theme = THEME_COLORS[pres.theme];
  const slideHtmls = pres.slides
    .map((slide, idx) => {
      let inner = "";
      switch (slide.type) {
        case "title":
          inner = `<h1 style="font-size:2.8em;margin-bottom:0.3em">${escHtml(slide.title)}</h1><p style="font-size:1.3em;opacity:0.7">${escHtml(slide.content)}</p>`;
          break;
        case "content":
          inner = `<h2 style="font-size:2em;margin-bottom:0.5em">${escHtml(slide.title)}</h2><p style="font-size:1.1em;line-height:1.7">${escHtml(slide.content)}</p>`;
          break;
        case "bullets":
          inner = `<h2 style="font-size:2em;margin-bottom:0.5em">${escHtml(slide.title)}</h2><ul style="font-size:1.1em;line-height:2">${(slide.bullets || []).map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>`;
          break;
        case "code":
          inner = `<h2 style="font-size:2em;margin-bottom:0.5em">${escHtml(slide.title)}</h2><pre style="background:${theme.surface};padding:1.5em;border-radius:12px;font-size:0.9em;overflow-x:auto"><code>${escHtml(slide.code?.code || "")}</code></pre>`;
          break;
        case "quote":
          inner = `<blockquote style="font-size:1.8em;font-style:italic;border-left:4px solid ${theme.accent};padding-left:1em;margin:0">${escHtml(slide.content)}</blockquote><p style="opacity:0.6;margin-top:1em">${escHtml(slide.title)}</p>`;
          break;
        case "stats":
          inner = `<h2 style="font-size:2em;margin-bottom:0.8em">${escHtml(slide.title)}</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1.2em">${(slide.stats || []).map((s) => `<div style="background:${theme.surface};padding:1.2em;border-radius:12px;text-align:center"><div style="font-size:2em;font-weight:700;color:${theme.accent}">${escHtml(s.value)}</div><div style="opacity:0.7;margin-top:0.3em">${escHtml(s.label)}</div>${s.change ? `<div style="font-size:0.85em;color:#22c55e;margin-top:0.2em">${escHtml(s.change)}</div>` : ""}</div>`).join("")}</div>`;
          break;
        case "comparison":
          if (slide.comparison) {
            const left = slide.comparison.left;
            const right = slide.comparison.right;
            inner = `<h2 style="font-size:2em;margin-bottom:0.8em">${escHtml(slide.title)}</h2><div style="display:grid;grid-template-columns:1fr 1fr;gap:2em"><div style="background:${theme.surface};padding:1.2em;border-radius:12px"><h3 style="color:${theme.accent}">${escHtml(left.title)}</h3><ul>${left.points.map((p) => `<li>${escHtml(p)}</li>`).join("")}</ul></div><div style="background:${theme.surface};padding:1.2em;border-radius:12px"><h3 style="color:${theme.accent}">${escHtml(right.title)}</h3><ul>${right.points.map((p) => `<li>${escHtml(p)}</li>`).join("")}</ul></div></div>`;
          }
          break;
        case "timeline":
          inner = `<h2 style="font-size:2em;margin-bottom:0.8em">${escHtml(slide.title)}</h2><div style="border-left:3px solid ${theme.accent};padding-left:1.5em">${(slide.timeline || []).map((t) => `<div style="margin-bottom:1.2em"><div style="font-weight:700;color:${theme.accent}">${escHtml(t.label)}</div><div style="opacity:0.8">${escHtml(t.description)}</div></div>`).join("")}</div>`;
          break;
        default:
          inner = `<h2>${escHtml(slide.title)}</h2><p>${escHtml(slide.content)}</p>`;
      }
      const bg = slide.backgroundColor || theme.bg;
      return `<div class="slide" id="slide-${idx}" style="background:${bg};display:${idx === 0 ? "flex" : "none"};flex-direction:column;justify-content:center;align-items:center;padding:4em;text-align:center;min-height:100vh">${inner}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(pres.title)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;color:${theme.text};background:${theme.bg};overflow:hidden}
.slide{width:100vw;height:100vh;transition:opacity 0.3s ease}
ul{list-style:disc;text-align:left;display:inline-block}
li{margin-bottom:0.4em}
#controls{position:fixed;bottom:1.5em;left:50%;transform:translateX(-50%);display:flex;gap:0.8em;align-items:center;
background:rgba(0,0,0,0.5);padding:0.5em 1.2em;border-radius:999px;color:#fff;font-size:0.85em;z-index:10}
#controls button{background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;padding:0.3em 0.8em;border-radius:6px;cursor:pointer}
#controls button:hover{background:rgba(255,255,255,0.15)}
</style></head><body>
${slideHtmls}
<div id="controls"><button onclick="prev()">\u2190 Prev</button><span id="counter">1 / ${pres.slides.length}</span><button onclick="next()">Next \u2192</button></div>
<script>
let cur=0;const total=${pres.slides.length};
function show(i){document.querySelectorAll('.slide').forEach((s,idx)=>{s.style.display=idx===i?'flex':'none'});document.getElementById('counter').textContent=(i+1)+' / '+total}
function next(){if(cur<total-1){cur++;show(cur)}}
function prev(){if(cur>0){cur--;show(cur)}}
document.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key===' ')next();if(e.key==='ArrowLeft')prev();if(e.key==='Escape')document.exitFullscreen?.()});
</script></body></html>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Hook ───────────────────────────────────────────────────────────────

export function usePresentation() {
  const [presentations, setPresentations] = useState<Presentation[]>(loadPresentations);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Persist on change
  useEffect(() => {
    persistPresentations(presentations);
  }, [presentations]);

  // Active presentation derived
  const active = useMemo(
    () => presentations.find((p) => p.id === activeId) ?? null,
    [presentations, activeId],
  );

  // ── Presentation CRUD ────────────────────────────────────────────────

  const createPresentation = useCallback(
    (title: string, author: string, theme: Presentation["theme"] = "dark") => {
      const now = Date.now();
      const pres: Presentation = {
        id: generateId(),
        title,
        author,
        theme,
        slides: [
          makeSlide("title", 0, { title, content: `By ${author}` }),
        ],
        createdAt: now,
        updatedAt: now,
      };
      setPresentations((prev) => [pres, ...prev]);
      setActiveId(pres.id);
      return pres;
    },
    [],
  );

  const deletePresentation = useCallback(
    (id: string) => {
      setPresentations((prev) => prev.filter((p) => p.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  const setActive = useCallback((id: string | null) => {
    setActiveId(id);
  }, []);

  const updatePresentation = useCallback(
    (id: string, changes: Partial<Pick<Presentation, "title" | "author" | "theme">>) => {
      setPresentations((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, ...changes, updatedAt: Date.now() } : p,
        ),
      );
    },
    [],
  );

  // ── Slide CRUD ───────────────────────────────────────────────────────

  const addSlide = useCallback(
    (presId: string, type: Slide["type"], atIndex?: number) => {
      const newSlide = makeSlide(type, 0);
      setPresentations((prev) =>
        prev.map((p) => {
          if (p.id !== presId) return p;
          const slides = [...p.slides];
          const insertAt = atIndex !== undefined ? atIndex : slides.length;
          slides.splice(insertAt, 0, newSlide);
          // Re-number order
          slides.forEach((s, i) => (s.order = i));
          return { ...p, slides, updatedAt: Date.now() };
        }),
      );
      return newSlide;
    },
    [],
  );

  const updateSlide = useCallback(
    (presId: string, slideId: string, changes: Partial<Slide>) => {
      setPresentations((prev) =>
        prev.map((p) => {
          if (p.id !== presId) return p;
          const slides = p.slides.map((s) =>
            s.id === slideId ? { ...s, ...changes } : s,
          );
          return { ...p, slides, updatedAt: Date.now() };
        }),
      );
    },
    [],
  );

  const deleteSlide = useCallback(
    (presId: string, slideId: string) => {
      setPresentations((prev) =>
        prev.map((p) => {
          if (p.id !== presId) return p;
          const slides = p.slides.filter((s) => s.id !== slideId);
          slides.forEach((s, i) => (s.order = i));
          return { ...p, slides, updatedAt: Date.now() };
        }),
      );
    },
    [],
  );

  const reorderSlides = useCallback(
    (presId: string, fromIndex: number, toIndex: number) => {
      setPresentations((prev) =>
        prev.map((p) => {
          if (p.id !== presId) return p;
          const slides = [...p.slides];
          const [moved] = slides.splice(fromIndex, 1);
          slides.splice(toIndex, 0, moved);
          slides.forEach((s, i) => (s.order = i));
          return { ...p, slides, updatedAt: Date.now() };
        }),
      );
    },
    [],
  );

  const duplicateSlide = useCallback(
    (presId: string, slideId: string) => {
      setPresentations((prev) =>
        prev.map((p) => {
          if (p.id !== presId) return p;
          const idx = p.slides.findIndex((s) => s.id === slideId);
          if (idx === -1) return p;
          const original = p.slides[idx];
          const copy: Slide = {
            ...JSON.parse(JSON.stringify(original)),
            id: `sl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          };
          const slides = [...p.slides];
          slides.splice(idx + 1, 0, copy);
          slides.forEach((s, i) => (s.order = i));
          return { ...p, slides, updatedAt: Date.now() };
        }),
      );
    },
    [],
  );

  // ── AI generation ────────────────────────────────────────────────────

  const generateFromPrompt = useCallback(
    (topic: string, slideCount: number = 8): string => {
      return buildGeneratePrompt(topic, slideCount);
    },
    [],
  );

  const applyGeneratedSlides = useCallback(
    (presId: string, aiResponse: string): boolean => {
      const parsed = parseGeneratedSlides(aiResponse);
      if (!parsed) return false;

      setPresentations((prev) =>
        prev.map((p) => {
          if (p.id !== presId) return p;
          const slides: Slide[] = parsed.map((raw, i) =>
            makeSlide((raw.type as Slide["type"]) || "content", i, {
              title: raw.title || "",
              content: raw.content || "",
              bullets: raw.bullets,
              code: raw.code,
              stats: raw.stats,
              comparison: raw.comparison,
              timeline: raw.timeline,
              notes: raw.notes || "",
            }),
          );
          const title = slides[0]?.title || p.title;
          return { ...p, slides, title, updatedAt: Date.now() };
        }),
      );
      return true;
    },
    [],
  );

  // ── Export ───────────────────────────────────────────────────────────

  const exportAsMarkdown = useCallback(() => {
    if (!active) return;
    const md = buildMarkdownExport(active);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  const exportAsHtml = useCallback(() => {
    if (!active) return;
    const html = buildHtmlExport(active);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${active.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [active]);

  // ── Stats ────────────────────────────────────────────────────────────

  const stats: PresentationStats = useMemo(() => {
    const byTheme: Record<string, number> = {};
    const bySlideType: Record<string, number> = {};
    let totalSlides = 0;

    for (const p of presentations) {
      byTheme[p.theme] = (byTheme[p.theme] ?? 0) + 1;
      totalSlides += p.slides.length;
      for (const s of p.slides) {
        bySlideType[s.type] = (bySlideType[s.type] ?? 0) + 1;
      }
    }

    return {
      totalPresentations: presentations.length,
      totalSlides,
      byTheme,
      bySlideType,
      avgSlidesPerDeck:
        presentations.length > 0
          ? Math.round(totalSlides / presentations.length)
          : 0,
    };
  }, [presentations]);

  return {
    presentations,
    active,
    createPresentation,
    deletePresentation,
    updatePresentation,
    setActive,
    addSlide,
    updateSlide,
    deleteSlide,
    reorderSlides,
    duplicateSlide,
    generateFromPrompt,
    applyGeneratedSlides,
    exportAsMarkdown,
    exportAsHtml,
    stats,
  };
}
