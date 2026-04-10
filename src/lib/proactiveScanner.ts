// src/lib/proactiveScanner.ts
// Phase 2: Proactive OS logic observing clipboard loops and emitting analytical events.

import { Logger } from "./logger";

export interface ScanResult {
  confidence: number;
  type: "stacktrace" | "json" | "code_snippet" | "url_list" | "unknown";
  content: string;
}

export class ProactiveScanner {
  // Common heuristic definitions mapping regexes to context types
  private static heuristics = [
    {
      type: "stacktrace",
      regex: /((?:Error|Exception):.*[\s\S]*?(?:at .*?(?:\(.*?:.*?\)|\[.*?\]).*?[\s\S]*)+)/m,
      minLines: 3,
      threshold: 0.8
    },
    {
      type: "json",
      regex: /^\s*({[\s\S]*}|\[[\s\S]*\])\s*$/,
      minLines: 1,
      threshold: 0.9
    },
    {
      type: "code_snippet",
      regex: /(?:def|class|function|interface|const|let|var|public|private)\s+\w+/,
      minLines: 2,
      threshold: 0.6
    }
  ] as const;

  /**
   * Scans an incoming string (from clipboard or screen OCR) and returns a structured
   * result if it believes it contains something actionable for the AI.
   */
  public static analyzeText(text: string): ScanResult {
    // Early exit for massive payloads to prevent regex blocking
    if (!text || text.length > 50000 || text.length < 10) {
      return { confidence: 0, type: "unknown", content: text };
    }

    const linesCount = text.split('\n').length;
    let highestConfidence = 0;
    let determinedType: ScanResult["type"] = "unknown";

    for (const rule of this.heuristics) {
      if (linesCount < rule.minLines) continue;

      const match = rule.regex.exec(text);
      if (match) {
        // Boost confidence based on how much of the block matches the rule
        const matchRatio = match[0].length / text.length;
        const confidenceScore = Math.min(1.0, rule.threshold + (matchRatio * 0.2));
        
        if (confidenceScore > highestConfidence) {
          highestConfidence = confidenceScore;
          determinedType = rule.type as ScanResult["type"];
        }
      }
    }

    if (highestConfidence > 0) {
      Logger.info(`ProactiveScanner detected [${determinedType}] with ${(highestConfidence * 100).toFixed(1)}% confidence`);
    }

    return {
      confidence: highestConfidence,
      type: determinedType,
      content: text
    };
  }

  /**
   * Given a scan result, decides whether we should actively interrupt the user with an overlay.
   */
  public static shouldTriggerOverlay(result: ScanResult): boolean {
    if (result.type === "stacktrace" && result.confidence > 0.85) return true;
    if (result.type === "json" && result.confidence > 0.95 && result.content.length > 500) return true;
    
    return false;
  }
}
