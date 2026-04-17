import { platform } from "@tauri-apps/plugin-os";

export type Platform = "macos" | "windows" | "linux" | "ios" | "android" | "unknown";

let cached: Platform | null = null;

/**
 * Detects the OS via Tauri's os plugin and writes it to <html data-platform="...">
 * so CSS can branch on :root[data-platform="macos"|"windows"|"linux"].
 * Safe to call multiple times — memoised.
 */
export async function initPlatform(): Promise<Platform> {
  if (cached) return cached;
  try {
    const p = await platform();
    cached = normalise(p);
  } catch {
    cached = "unknown";
  }
  document.documentElement.dataset.platform = cached;
  return cached;
}

export function getPlatform(): Platform {
  return cached ?? "unknown";
}

function normalise(p: string): Platform {
  switch (p) {
    case "macos":
    case "windows":
    case "linux":
    case "ios":
    case "android":
      return p;
    default:
      return "unknown";
  }
}
