import type { Message } from "../types";

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const month = date.toLocaleString("en-US", { month: "short" });
  const day = date.getDate();
  const time = date.toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${month} ${day}, ${time}`;
}

function formatMessageContent(message: Message): string {
  let content = message.content;
  if (message.image_base64) {
    content = "[screenshot attached]\n" + content;
  }
  return content;
}

export function formatConversation(messages: Message[], title?: string): string {
  const heading = `# ${title || "Conversation"}`;

  const blocks = messages.map((message) => {
    const speaker = message.role === "user" ? "**You**" : "**Blade**";
    const time = formatTimestamp(message.timestamp);
    const content = formatMessageContent(message);
    return `${speaker} — ${time}\n${content}`;
  });

  return heading + "\n\n" + blocks.join("\n\n---\n\n") + "\n";
}

export async function copyConversation(
  messages: Message[],
  title?: string,
): Promise<void> {
  const text = formatConversation(messages, title);
  await navigator.clipboard.writeText(text);
}
