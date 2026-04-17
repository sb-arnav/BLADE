import { useCallback, useRef, useState } from "react";

/**
 * Voice command detection — listens for wake words and commands
 * in transcribed voice input. Extends the basic voice transcription
 * with command parsing.
 */

export interface VoiceCommand {
  trigger: string;          // "blade" | "hey blade" | "ok blade"
  action: string;           // parsed action
  args: string;             // remaining text after command
  confidence: number;       // 0-1
}

const WAKE_WORDS = ["blade", "hey blade", "ok blade", "yo blade"];

const COMMAND_PATTERNS: Array<{ pattern: RegExp; action: string }> = [
  { pattern: /^(search|find|look up)\s+(.+)/i, action: "search" },
  { pattern: /^(open|go to|navigate to)\s+(settings|chat|terminal|files|analytics|knowledge|agents)/i, action: "navigate" },
  { pattern: /^(new|create|start)\s+(conversation|convo|chat)/i, action: "new_conversation" },
  { pattern: /^(clear|reset|wipe)\s+(chat|conversation|messages)/i, action: "clear" },
  { pattern: /^(screenshot|capture|screen)\s*(.*)/i, action: "screenshot" },
  { pattern: /^(read|what('s| is))\s+(on|on my)\s+screen/i, action: "screenshot" },
  { pattern: /^(focus|zen|minimal)\s*(mode)?/i, action: "focus_mode" },
  { pattern: /^(stop|cancel|quit|abort)/i, action: "stop" },
  { pattern: /^(help|what can you do|commands)/i, action: "help" },
  { pattern: /^(mute|unmute|toggle)\s+(sound|audio|voice|tts)/i, action: "toggle_tts" },
  { pattern: /^(type|write|input)\s+(.+)/i, action: "type_text" },
  { pattern: /^(summarize|sum up)\s+(this|the)?\s*(conversation|chat)/i, action: "summarize" },
  { pattern: /^(export|save|download)\s+(this|the)?\s*(conversation|chat)/i, action: "export" },
];

function detectWakeWord(text: string): { found: boolean; remainder: string } {
  const lower = text.toLowerCase().trim();
  for (const wake of WAKE_WORDS) {
    if (lower.startsWith(wake)) {
      const remainder = text.slice(wake.length).trim();
      // Remove common separators
      const cleaned = remainder.replace(/^[,.\s]+/, "").trim();
      return { found: true, remainder: cleaned };
    }
  }
  return { found: false, remainder: text };
}

function parseCommand(text: string): VoiceCommand | null {
  const { found, remainder } = detectWakeWord(text);

  // If no wake word, treat entire text as a message (not a command)
  if (!found) return null;

  // Try to match against known commands
  for (const { pattern, action } of COMMAND_PATTERNS) {
    const match = remainder.match(pattern);
    if (match) {
      return {
        trigger: text.slice(0, text.length - remainder.length).trim(),
        action,
        args: match[match.length - 1] || "",
        confidence: 0.9,
      };
    }
  }

  // Wake word found but no known command — treat as a question to Blade
  if (remainder.length > 2) {
    return {
      trigger: text.slice(0, text.length - remainder.length).trim(),
      action: "ask",
      args: remainder,
      confidence: 0.7,
    };
  }

  return null;
}

export function useVoiceCommands() {
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [listening, setListening] = useState(false);
  const callbackRef = useRef<((cmd: VoiceCommand) => void) | null>(null);

  const processTranscription = useCallback((text: string): VoiceCommand | null => {
    const command = parseCommand(text);
    if (command) {
      setLastCommand(command);
      callbackRef.current?.(command);
    }
    return command;
  }, []);

  const onCommand = useCallback((callback: (cmd: VoiceCommand) => void) => {
    callbackRef.current = callback;
  }, []);

  const startListening = useCallback(() => setListening(true), []);
  const stopListening = useCallback(() => setListening(false), []);

  return {
    processTranscription,
    lastCommand,
    listening,
    startListening,
    stopListening,
    onCommand,
    parseCommand,
  };
}

// Export for testing
export { parseCommand, detectWakeWord };
