const FOOTER = "\n\n— shared from Blade";

const FENCED_CODE_RE = /```(\w*)\n([\s\S]*?)```/g;

export function extractCodeBlocks(content: string): { language: string; code: string }[] {
  const blocks: { language: string; code: string }[] = [];
  let match: RegExpExecArray | null;

  while ((match = FENCED_CODE_RE.exec(content)) !== null) {
    blocks.push({
      language: match[1] || "",
      code: match[2].trimEnd(),
    });
  }

  FENCED_CODE_RE.lastIndex = 0;
  return blocks;
}

export function formatSnippet(content: string, role: "user" | "assistant"): string {
  const codeBlocks = extractCodeBlocks(content);

  if (codeBlocks.length > 0) {
    const block = codeBlocks[0];
    const tag = block.language ? block.language : "";
    return "```" + tag + "\n" + block.code + "\n```" + FOOTER;
  }

  const speaker = role === "user" ? "You" : "Blade";
  return `**${speaker}**: ${content}` + FOOTER;
}

export async function shareToClipboard(
  content: string,
  role: "user" | "assistant",
): Promise<void> {
  const formatted = formatSnippet(content, role);
  await navigator.clipboard.writeText(formatted);
}
