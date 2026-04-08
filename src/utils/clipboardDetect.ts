export interface ClipboardAction {
  label: string;
  prompt: string;
}

export interface ClipboardDetection {
  type: "code" | "error" | "url" | "json" | "command" | "text";
  language?: string;
  actions: ClipboardAction[];
  preview: string;
}

function makePreview(text: string): string {
  const firstLine = text.split("\n")[0];
  if (firstLine.length > 60) {
    return firstLine.slice(0, 60) + "...";
  }
  if (text.includes("\n")) {
    return firstLine + "...";
  }
  return firstLine;
}

function isURL(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
}

function isJSON(text: string): boolean {
  try {
    JSON.parse(text.trim());
    return true;
  } catch {
    return false;
  }
}

const ERROR_PATTERNS = [
  "Error:",
  "Exception",
  "Traceback",
  "at line",
  "panic",
  "FAILED",
];

function isError(text: string): boolean {
  return ERROR_PATTERNS.some((pattern) => text.includes(pattern));
}

const COMMAND_PREFIXES = [
  "$",
  ">",
  "sudo",
  "npm",
  "pip",
  "cargo",
  "git",
  "docker",
  "kubectl",
];

function isCommand(text: string): boolean {
  const trimmed = text.trim();
  const firstToken = trimmed.split(/\s/)[0];
  if (COMMAND_PREFIXES.includes(firstToken)) {
    return true;
  }
  if (
    trimmed.includes("|") &&
    trimmed.split("|").every((seg) => seg.trim().length > 0)
  ) {
    return true;
  }
  return false;
}

const CODE_PATTERNS = [
  /\bfunction\s/,
  /\bdef\s/,
  /\bclass\s/,
  /\bimport\s/,
  /\bconst\s/,
  /\blet\s/,
  /\bvar\s/,
  /\bfn\s/,
  /\bpub\s/,
  /=>/,
  /->/,
  /[{}]/,
];

const LANGUAGE_HINTS: Record<string, RegExp[]> = {
  javascript: [/\bconst\s/, /\blet\s/, /\bvar\s/, /=>/, /\bfunction\s/],
  typescript: [/:\s*(string|number|boolean|void)\b/, /\binterface\s/, /\btype\s/],
  python: [/\bdef\s/, /\bimport\s/, /:\s*$/, /\bself\b/],
  rust: [/\bfn\s/, /\bpub\s/, /\blet\s+mut\b/, /->/, /\bimpl\s/],
  java: [/\bpublic\s/, /\bprivate\s/, /\bclass\s/, /\bvoid\s/],
  go: [/\bfunc\s/, /\bpackage\s/, /\bgo\s/, /:=\s/],
};

function detectLanguage(text: string): string | undefined {
  let best: string | undefined;
  let bestScore = 0;

  for (const [lang, patterns] of Object.entries(LANGUAGE_HINTS)) {
    const score = patterns.filter((p) => p.test(text)).length;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  }

  return best;
}

function isCode(text: string): boolean {
  const matches = CODE_PATTERNS.filter((p) => p.test(text)).length;
  return matches >= 2;
}

export function detectClipboardType(text: string): ClipboardDetection {
  const preview = makePreview(text);

  if (isURL(text)) {
    return {
      type: "url",
      actions: [
        { label: "Summarize page", prompt: `Summarize this page: ${text.trim()}` },
        { label: "What is this?", prompt: `What is this URL? ${text.trim()}` },
      ],
      preview,
    };
  }

  if (isJSON(text)) {
    return {
      type: "json",
      actions: [
        { label: "Explain structure", prompt: `Explain the structure of this JSON:\n${text}` },
        { label: "Find issues", prompt: `Find any issues in this JSON:\n${text}` },
      ],
      preview,
    };
  }

  if (isError(text)) {
    return {
      type: "error",
      actions: [
        { label: "Debug this", prompt: `Debug this error:\n${text}` },
        { label: "Explain error", prompt: `Explain this error:\n${text}` },
        { label: "Suggest fix", prompt: `Suggest a fix for this error:\n${text}` },
      ],
      preview,
    };
  }

  if (isCommand(text)) {
    return {
      type: "command",
      actions: [
        { label: "Explain command", prompt: `Explain this command:\n${text}` },
        { label: "Is this safe?", prompt: `Is this command safe to run?\n${text}` },
      ],
      preview,
    };
  }

  if (isCode(text)) {
    const language = detectLanguage(text);
    return {
      type: "code",
      language,
      actions: [
        { label: "Explain code", prompt: `Explain this code:\n${text}` },
        { label: "Review code", prompt: `Review this code for issues:\n${text}` },
        { label: "Optimize", prompt: `Optimize this code:\n${text}` },
      ],
      preview,
    };
  }

  return {
    type: "text",
    actions: [
      { label: "Explain", prompt: `Explain this:\n${text}` },
      { label: "Summarize", prompt: `Summarize this:\n${text}` },
      { label: "Rewrite", prompt: `Rewrite this:\n${text}` },
    ],
    preview,
  };
}
