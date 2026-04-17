import { invoke } from "@tauri-apps/api/core";

export interface DbTemplate {
  id: string;
  name: string;
  content: string;
  variables: string[];
  category: string;
  icon: string;
  created_at: number;
  updated_at: number;
  usage_count: number;
  is_builtin: boolean;
}

export const TemplateDB = {
  async list(): Promise<DbTemplate[]> {
    return invoke("db_list_templates");
  },

  async add(template: {
    name: string;
    content: string;
    variables: string[];
    category: string;
    icon: string;
  }): Promise<{ id: string }> {
    return invoke("db_add_template", { template });
  },

  async delete(id: string): Promise<void> {
    return invoke("db_delete_template", { id });
  },

  async incrementUsage(id: string): Promise<void> {
    return invoke("db_increment_template_usage", { id });
  },
};
