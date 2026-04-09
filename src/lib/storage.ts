/**
 * Storage abstraction for Blade.
 * Wraps localStorage with type safety, compression, and migration support.
 * Will be replaced with SQLite backend when fully wired.
 */

// ── Type-safe localStorage wrapper ──────────────────────────────────────

export function getItem<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(`blade:${key}`);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

export function setItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`blade:${key}`, JSON.stringify(value));
  } catch (e) {
    // Storage might be full — try to clear old data
    console.warn("[Blade] Storage write failed:", e);
    pruneOldData();
    try {
      localStorage.setItem(`blade:${key}`, JSON.stringify(value));
    } catch {
      console.error("[Blade] Storage write failed after pruning");
    }
  }
}

export function removeItem(key: string): void {
  localStorage.removeItem(`blade:${key}`);
}

export function hasItem(key: string): boolean {
  return localStorage.getItem(`blade:${key}`) !== null;
}

// ── Storage stats ───────────────────────────────────────────────────────

export interface StorageStats {
  totalKeys: number;
  bladeKeys: number;
  totalSize: number;     // bytes
  bladSize: number;      // bytes
  largestKey: { key: string; size: number } | null;
  estimatedCapacity: number; // bytes (usually 5-10MB)
  usagePercent: number;
}

export function getStorageStats(): StorageStats {
  let totalSize = 0;
  let bladeSize = 0;
  let bladeKeys = 0;
  let largest: { key: string; size: number } | null = null;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key) || "";
    const size = (key.length + value.length) * 2; // UTF-16 = 2 bytes per char
    totalSize += size;

    if (key.startsWith("blade")) {
      bladeSize += size;
      bladeKeys++;
    }

    if (!largest || size > largest.size) {
      largest = { key, size };
    }
  }

  const estimatedCapacity = 5 * 1024 * 1024; // 5MB typical

  return {
    totalKeys: localStorage.length,
    bladeKeys,
    totalSize,
    bladSize: bladeSize,
    largestKey: largest,
    estimatedCapacity,
    usagePercent: Math.round((totalSize / estimatedCapacity) * 100),
  };
}

// ── Pruning / cleanup ───────────────────────────────────────────────────

/**
 * Remove old/large data to free space.
 * Targets: analytics events, old history, expired data.
 */
export function pruneOldData(): number {
  let freed = 0;
  const keysToCheck = [
    "blade-analytics",
    "blade-activity",
    "blade-command-history",
    "blade-clipboard-history",
    "blade-prompt-history",
    "blade-calc-history",
    "blade-json-history",
  ];

  for (const key of keysToCheck) {
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const size = raw.length * 2;

    if (size > 500000) { // > 500KB
      try {
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 50) {
          const trimmed = data.slice(-50);
          const newRaw = JSON.stringify(trimmed);
          localStorage.setItem(key, newRaw);
          freed += size - newRaw.length * 2;
        }
      } catch { /* skip */ }
    }
  }

  return freed;
}

/**
 * Export all Blade data as a JSON blob
 */
export function exportAllData(): string {
  const data: Record<string, unknown> = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith("blade")) continue;
    try {
      data[key] = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      data[key] = localStorage.getItem(key);
    }
  }

  return JSON.stringify(data, null, 2);
}

/**
 * Import Blade data from a JSON blob (merge, don't overwrite)
 */
export function importData(jsonString: string): { imported: number; errors: number } {
  let imported = 0;
  let errors = 0;

  try {
    const data = JSON.parse(jsonString) as Record<string, unknown>;
    for (const [key, value] of Object.entries(data)) {
      if (!key.startsWith("blade")) { errors++; continue; }
      try {
        localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
        imported++;
      } catch {
        errors++;
      }
    }
  } catch {
    errors++;
  }

  return { imported, errors };
}

/**
 * Clear ALL Blade data (nuclear option)
 */
export function clearAllBladeData(): number {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("blade")) keysToRemove.push(key);
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }

  return keysToRemove.length;
}

// ── Migration system ────────────────────────────────────────────────────

export interface Migration {
  version: number;
  name: string;
  migrate: () => void;
}

const MIGRATION_KEY = "blade:schema-version";

export function runMigrations(migrations: Migration[]): void {
  const currentVersion = parseInt(localStorage.getItem(MIGRATION_KEY) || "0", 10);
  const pending = migrations.filter((m) => m.version > currentVersion).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    try {
      console.log(`[Blade] Running migration v${migration.version}: ${migration.name}`);
      migration.migrate();
      localStorage.setItem(MIGRATION_KEY, String(migration.version));
    } catch (e) {
      console.error(`[Blade] Migration v${migration.version} failed:`, e);
      break;
    }
  }
}

// ── Versioned storage (for data that needs migration) ───────────────────

export interface VersionedData<T> {
  version: number;
  data: T;
  updatedAt: number;
}

export function getVersioned<T>(key: string, version: number, defaultValue: T, migrate?: (oldData: unknown, oldVersion: number) => T): T {
  try {
    const raw = localStorage.getItem(`blade:${key}`);
    if (!raw) return defaultValue;

    const parsed = JSON.parse(raw) as VersionedData<T>;

    if (parsed.version === version) return parsed.data;

    // Need migration
    if (migrate && parsed.version < version) {
      const migrated = migrate(parsed.data, parsed.version);
      setVersioned(key, version, migrated);
      return migrated;
    }

    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function setVersioned<T>(key: string, version: number, data: T): void {
  const wrapper: VersionedData<T> = {
    version,
    data,
    updatedAt: Date.now(),
  };
  setItem(key, wrapper);
}

// ── Debounced storage (for frequent writes) ─────────────────────────────

const debouncedTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export function setItemDebounced<T>(key: string, value: T, delayMs = 1000): void {
  if (debouncedTimers[key]) clearTimeout(debouncedTimers[key]);
  debouncedTimers[key] = setTimeout(() => {
    setItem(key, value);
    delete debouncedTimers[key];
  }, delayMs);
}

// ── Encrypted storage (for sensitive data) ──────────────────────────────

/**
 * Simple XOR encryption for localStorage values.
 * NOT cryptographically secure — use OS keychain for real secrets.
 * This is just obfuscation to prevent casual reading.
 */
export function setEncrypted(key: string, value: string, passphrase: string): void {
  const encrypted = xorEncrypt(value, passphrase);
  localStorage.setItem(`blade:enc:${key}`, encrypted);
}

export function getEncrypted(key: string, passphrase: string): string | null {
  const encrypted = localStorage.getItem(`blade:enc:${key}`);
  if (!encrypted) return null;
  try {
    return xorEncrypt(encrypted, passphrase);
  } catch {
    return null;
  }
}

function xorEncrypt(text: string, key: string): string {
  return Array.from(text)
    .map((char, i) => String.fromCharCode(char.charCodeAt(0) ^ key.charCodeAt(i % key.length)))
    .join("");
}
