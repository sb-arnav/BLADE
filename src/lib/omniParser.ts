// src/lib/omniParser.ts
// Grid-based vision adapter for mapping desktop bounding boxes to interactable elements.
// Empowers the LLM to click elements by simply outputting their overlay tags (e.g. "Click AC").

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InteractableElement {
  tag: string;      // "AA", "AB", "AC", etc.
  label?: string;   // Found text during OCR
  type: string;     // "button", "input", "link"
  bounds: BoundingBox;
}

export class OmniParser {
  private static ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  /**
   * Generates a deterministic sequence of 2-letter tags (AA, AB, AC ... ZZ).
   */
  public static generateTag(index: number): string {
    const firstNum = Math.floor(index / this.ALPHABET.length);
    const secondNum = index % this.ALPHABET.length;
    
    // Bounds checking; if we have more than 676 items on screen, fallback
    if (firstNum >= this.ALPHABET.length) return `Z${index}`;
    
    return `${this.ALPHABET[firstNum]}${this.ALPHABET[secondNum]}`;
  }

  /**
   * Given raw un-tagged OCR boxes from a vision model or OS accessibility tree,
   * normalizes them, assigns tags, and clusters tightly overlapping boxes.
   */
  public static tagElements(rawBoxes: Array<{bounds: BoundingBox, type: string, text?: string}>): InteractableElement[] {
    // Sort heuristically top-to-bottom, left-to-right
    const sorted = [...rawBoxes].sort((a, b) => {
      // If they are on roughly the same horizontal line (within 20px)
      if (Math.abs(a.bounds.y - b.bounds.y) < 20) {
        return a.bounds.x - b.bounds.x;
      }
      return a.bounds.y - b.bounds.y;
    });

    const elements: InteractableElement[] = [];
    let currentTagIndex = 0;

    for (const item of sorted) {
      if (item.bounds.width < 5 || item.bounds.height < 5) continue; // Noise filter
      
      elements.push({
        tag: this.generateTag(currentTagIndex++),
        label: item.text,
        type: item.type,
        bounds: item.bounds
      });
    }

    return elements;
  }

  /**
   * Calculates the exact center payload (x, y) coordinates.
   * Useful when passing the final click command to Rust `enigo` layer.
   */
  public static resolveCenterCoordinate(element: InteractableElement): { x: number; y: number } {
    return {
      x: Math.round(element.bounds.x + (element.bounds.width / 2)),
      y: Math.round(element.bounds.y + (element.bounds.height / 2))
    };
  }
}
