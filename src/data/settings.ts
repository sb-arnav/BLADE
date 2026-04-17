import { invoke } from "@tauri-apps/api/core";

export const SettingsDB = {
  async get(key: string): Promise<string | null> {
    return invoke("db_get_setting", { key });
  },

  async set(key: string, value: string): Promise<void> {
    return invoke("db_set_setting", { key, value });
  },

  async getJson<T>(key: string, defaultValue: T): Promise<T> {
    const raw = await this.get(key);
    if (raw === null) return defaultValue;
    try {
      return JSON.parse(raw);
    } catch {
      return defaultValue;
    }
  },

  async setJson<T>(key: string, value: T): Promise<void> {
    return this.set(key, JSON.stringify(value));
  },

  async getAll(): Promise<Record<string, string>> {
    return invoke("db_get_all_settings");
  },

  async delete(key: string): Promise<void> {
    return invoke("db_delete_setting", { key });
  },
};
