import { invoke } from "@tauri-apps/api/core";

export interface DbConversation {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  pinned: boolean;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  image_base64?: string;
  timestamp: number;
}

export interface DbConversationWithMessages {
  conversation: DbConversation;
  messages: DbMessage[];
}

export interface DbSearchResult {
  message_id: string;
  conversation_id: string;
  role: string;
  content: string;
  timestamp: number;
  rank: number;
}

export const ConversationDB = {
  async list(): Promise<DbConversation[]> {
    return invoke<DbConversation[]>("db_list_conversations");
  },

  async get(id: string): Promise<DbConversationWithMessages> {
    return invoke<DbConversationWithMessages>("db_get_conversation", { id });
  },

  async save(id: string, title: string, messages: DbMessage[]): Promise<DbConversation> {
    return invoke<DbConversation>("db_save_conversation", { id, title, messages });
  },

  async delete(id: string): Promise<void> {
    return invoke("db_delete_conversation", { id });
  },

  async search(query: string): Promise<DbSearchResult[]> {
    return invoke("db_search_messages", { query });
  },

  async pin(id: string, pinned: boolean): Promise<void> {
    return invoke("db_pin_conversation", { id, pinned });
  },

  async rename(id: string, title: string): Promise<void> {
    return invoke("db_rename_conversation", { id, title });
  },

  async getStats(): Promise<{ total: number; totalMessages: number; oldestTimestamp: number }> {
    return invoke("db_conversation_stats");
  },
};
