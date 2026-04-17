import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DBColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface DBTable {
  name: string;
  rowCount: number;
  columns: DBColumn[];
}

export interface QueryResult {
  id: string;
  sql: string;
  columns: string[];
  rows: string[][];
  rowCount: number;
  executionTime: number;
  error: string | null;
  timestamp: number;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  description: string;
  createdAt: number;
  usageCount: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const HISTORY_KEY = "blade-db-query-history";
const SAVED_KEY = "blade-db-saved-queries";
const MAX_HISTORY = 50;

// ── Storage helpers ─────────────────────────────────────────────────────────

function loadHistory(): QueryResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(items: QueryResult[]): void {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)));
}

function loadSavedQueries(): SavedQuery[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSavedQueries(items: SavedQuery[]): void {
  localStorage.setItem(SAVED_KEY, JSON.stringify(items));
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ── Parse PRAGMA table_info rows ────────────────────────────────────────────

function parsePragmaColumns(rows: string[][]): DBColumn[] {
  return rows.map((row) => ({
    name: row[1] ?? "",
    type: row[2] ?? "TEXT",
    nullable: row[3] !== "1",
    primaryKey: row[5] === "1",
  }));
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDatabaseExplorer() {
  const [tables, setTables] = useState<DBTable[]>([]);
  const [queryHistory, setQueryHistory] = useState<QueryResult[]>(loadHistory);
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(loadSavedQueries);
  const [loading, setLoading] = useState(false);
  // ── Execute raw SQL via Tauri ───────────────────────────────────────────

  const executeRawSQL = useCallback(
    async (sql: string): Promise<{ columns: string[]; rows: string[][] }> => {
      try {
        const result = await invoke<{ columns: string[]; rows: string[][] }>(
          "db_execute_raw_sql",
          { sql }
        );
        return result;
      } catch (err: unknown) {
        throw new Error(typeof err === "string" ? err : String(err));
      }
    },
    []
  );

  // ── Get all tables with schema info ─────────────────────────────────────

  const getTables = useCallback(async () => {
    setLoading(true);
    try {
      const masterResult = await executeRawSQL(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      );

      const tableList: DBTable[] = [];

      for (const row of masterResult.rows) {
        const tableName = row[0];
        if (!tableName) continue;

        // Get column info
        const pragmaResult = await executeRawSQL(
          `PRAGMA table_info("${tableName}")`
        );
        const columns = parsePragmaColumns(pragmaResult.rows);

        // Get row count
        const countResult = await executeRawSQL(
          `SELECT COUNT(*) FROM "${tableName}"`
        );
        const rowCount = parseInt(countResult.rows[0]?.[0] ?? "0", 10);

        tableList.push({ name: tableName, rowCount, columns });
      }

      setTables(tableList);
      return tableList;
    } catch (err) {
      console.error("Failed to fetch tables:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [executeRawSQL]);

  // ── Execute a user query ────────────────────────────────────────────────

  const executeQuery = useCallback(
    async (sql: string): Promise<QueryResult> => {
      const trimmed = sql.trim();
      const start = performance.now();
      let result: QueryResult;

      try {
        const data = await executeRawSQL(trimmed);
        const elapsed = Math.round(performance.now() - start);

        result = {
          id: uid(),
          sql: trimmed,
          columns: data.columns,
          rows: data.rows,
          rowCount: data.rows.length,
          executionTime: elapsed,
          error: null,
          timestamp: Date.now(),
        };
      } catch (err: unknown) {
        const elapsed = Math.round(performance.now() - start);
        result = {
          id: uid(),
          sql: trimmed,
          columns: [],
          rows: [],
          rowCount: 0,
          executionTime: elapsed,
          error: err instanceof Error ? err.message : String(err),
          timestamp: Date.now(),
        };
      }

      setQueryHistory((prev) => {
        const updated = [result, ...prev].slice(0, MAX_HISTORY);
        saveHistory(updated);
        return updated;
      });

      return result;
    },
    [executeRawSQL]
  );

  // ── Paginated table browse ──────────────────────────────────────────────

  const getTableData = useCallback(
    async (
      tableName: string,
      limit: number = 50,
      offset: number = 0
    ): Promise<QueryResult> => {
      const sql = `SELECT * FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`;
      return executeQuery(sql);
    },
    [executeQuery]
  );

  // ── AI-generated SQL from natural language ──────────────────────────────

  const generateQueryFromPrompt = useCallback(
    async (description: string): Promise<string> => {
      // Build schema context for the AI
      const schemaLines = tables
        .map((t) => {
          const cols = t.columns
            .map(
              (c) =>
                `${c.name} ${c.type}${c.primaryKey ? " PK" : ""}${!c.nullable ? " NOT NULL" : ""}`
            )
            .join(", ");
          return `  ${t.name}(${cols}) — ${t.rowCount} rows`;
        })
        .join("\n");

      const prompt = `Given this SQLite schema:\n${schemaLines}\n\nWrite a single SQL query for: "${description}"\n\nReturn ONLY the SQL, no explanation.`;

      try {
        const result = await invoke<string>("send_message_stream", {
          provider: "auto",
          model: "auto",
          messages: [
            { role: "system", content: "You are a SQL expert. Return only valid SQLite SQL. No markdown, no explanation." },
            { role: "user", content: prompt },
          ],
          conversationId: `db-explorer-${Date.now()}`,
          systemPrompt: "",
          extraContext: "",
        });

        // Clean up: strip markdown fences if any
        let sql = result.trim();
        if (sql.startsWith("```")) {
          sql = sql.replace(/^```(?:sql)?\n?/, "").replace(/\n?```$/, "");
        }
        return sql.trim();
      } catch {
        return `-- AI generation failed. Try writing the query manually.\nSELECT * FROM ${tables[0]?.name ?? "table_name"} LIMIT 10;`;
      }
    },
    [tables]
  );

  // ── Save / delete queries ───────────────────────────────────────────────

  const saveQuery = useCallback(
    (name: string, sql: string, description: string = "") => {
      setSavedQueries((prev) => {
        const entry: SavedQuery = {
          id: uid(),
          name,
          sql,
          description,
          createdAt: Date.now(),
          usageCount: 0,
        };
        const updated = [entry, ...prev];
        saveSavedQueries(updated);
        return updated;
      });
    },
    []
  );

  const deleteSavedQuery = useCallback((id: string) => {
    setSavedQueries((prev) => {
      const updated = prev.filter((q) => q.id !== id);
      saveSavedQueries(updated);
      return updated;
    });
  }, []);

  // ── Export a result to CSV or JSON ──────────────────────────────────────

  const exportResult = useCallback(
    (resultId: string, format: "csv" | "json"): string | null => {
      const result = queryHistory.find((r) => r.id === resultId);
      if (!result || result.error) return null;

      if (format === "json") {
        const objects = result.rows.map((row) => {
          const obj: Record<string, string> = {};
          result.columns.forEach((col, i) => {
            obj[col] = row[i] ?? "";
          });
          return obj;
        });
        return JSON.stringify(objects, null, 2);
      }

      // CSV
      const escape = (v: string) =>
        v.includes(",") || v.includes('"') || v.includes("\n")
          ? `"${v.replace(/"/g, '""')}"`
          : v;
      const header = result.columns.map(escape).join(",");
      const rows = result.rows.map((r) => r.map(escape).join(","));
      return [header, ...rows].join("\n");
    },
    [queryHistory]
  );

  return {
    tables,
    queryHistory,
    savedQueries,
    loading,
    executeQuery,
    saveQuery,
    deleteSavedQuery,
    getTables,
    getTableData,
    generateQueryFromPrompt,
    exportResult,
  };
}
