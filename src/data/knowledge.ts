import { invoke } from "@tauri-apps/api/core";

export interface DbKnowledgeEntry {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: "auto" | "manual" | "pinned";
  conversation_id?: string;
  created_at: number;
  updated_at: number;
}

export const KnowledgeDB = {
  async list(): Promise<DbKnowledgeEntry[]> {
    return invoke("db_list_knowledge");
  },

  async get(id: string): Promise<DbKnowledgeEntry> {
    return invoke("db_get_knowledge", { id });
  },

  async add(entry: Omit<DbKnowledgeEntry, "id" | "created_at" | "updated_at">): Promise<DbKnowledgeEntry> {
    return invoke("db_add_knowledge", { entry });
  },

  async update(entry: DbKnowledgeEntry): Promise<void> {
    return invoke("db_update_knowledge", { entry });
  },

  async delete(id: string): Promise<void> {
    return invoke("db_delete_knowledge", { id });
  },

  async search(query: string): Promise<DbKnowledgeEntry[]> {
    return invoke("db_search_knowledge", { query });
  },

  async getByTag(tag: string): Promise<DbKnowledgeEntry[]> {
    return invoke("db_knowledge_by_tag", { tag });
  },

  async getTags(): Promise<Array<{ tag: string; count: number }>> {
    return invoke("db_knowledge_tags");
  },

  async getStats(): Promise<{ total: number; totalTags: number; recentCount: number }> {
    return invoke("db_knowledge_stats");
  },
};
