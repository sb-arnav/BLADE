import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  useDatabaseExplorer,
  type DBTable,
  type QueryResult,
} from "../hooks/useDatabaseExplorer";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  onBack: () => void;
  onSendToChat: (text: string) => void;
}

// ── SQL keyword highlighting ────────────────────────────────────────────────

const SQL_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "IS", "NULL",
  "LIKE", "BETWEEN", "JOIN", "INNER", "LEFT", "RIGHT", "OUTER", "ON",
  "GROUP", "BY", "ORDER", "ASC", "DESC", "LIMIT", "OFFSET", "INSERT",
  "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "DROP",
  "ALTER", "INDEX", "UNIQUE", "PRIMARY", "KEY", "FOREIGN", "REFERENCES",
  "AS", "DISTINCT", "COUNT", "SUM", "AVG", "MIN", "MAX", "HAVING",
  "UNION", "ALL", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END",
  "CAST", "COALESCE", "IFNULL", "REPLACE", "PRAGMA", "EXPLAIN",
]);

function highlightSQL(sql: string): React.ReactNode[] {
  const tokens = sql.split(/(\s+|[(),;*])/g);
  return tokens.map((token, i) => {
    const upper = token.toUpperCase();
    if (SQL_KEYWORDS.has(upper)) {
      return (
        <span key={i} className="text-purple-400 font-semibold">
          {token}
        </span>
      );
    }
    if (/^'[^']*'$/.test(token) || /^"[^"]*"$/.test(token)) {
      return (
        <span key={i} className="text-emerald-400">
          {token}
        </span>
      );
    }
    if (/^\d+$/.test(token)) {
      return (
        <span key={i} className="text-amber-400">
          {token}
        </span>
      );
    }
    if (token === "*") {
      return (
        <span key={i} className="text-rose-400">
          {token}
        </span>
      );
    }
    return <span key={i}>{token}</span>;
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ── Column sort state ───────────────────────────────────────────────────────

type SortDir = "asc" | "desc" | null;

interface SortState {
  column: number;
  dir: SortDir;
}

// ── Sub-components ──────────────────────────────────────────────────────────

function PKBadge() {
  return (
    <span className="ml-1 px-1 py-0.5 text-[9px] font-bold rounded bg-amber-500/20 text-amber-400 leading-none">
      PK
    </span>
  );
}

function TableItem({
  table,
  expanded,
  onToggle,
  onBrowse,
  onCount,
  onDescribe,
}: {
  table: DBTable;
  expanded: boolean;
  onToggle: () => void;
  onBrowse: () => void;
  onCount: () => void;
  onDescribe: () => void;
}) {
  return (
    <div className="border-b border-blade-border/50 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blade-surface/80 transition-colors"
      >
        <span className="text-[10px] text-blade-muted transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "none" }}>
          {"\u25B6"}
        </span>
        <span className="text-xs font-medium text-blade-text truncate flex-1">
          {table.name}
        </span>
        <span className="text-[10px] text-blade-muted tabular-nums">
          {table.rowCount.toLocaleString()}
        </span>
      </button>

      {expanded && (
        <div className="pb-2 px-3">
          {/* Quick actions */}
          <div className="flex gap-1 mb-2 px-2">
            <button
              onClick={onBrowse}
              className="text-[10px] px-1.5 py-0.5 rounded bg-blade-surface border border-blade-border text-blade-muted hover:text-blade-text hover:border-accent transition-colors"
            >
              Browse
            </button>
            <button
              onClick={onCount}
              className="text-[10px] px-1.5 py-0.5 rounded bg-blade-surface border border-blade-border text-blade-muted hover:text-blade-text hover:border-accent transition-colors"
            >
              Count
            </button>
            <button
              onClick={onDescribe}
              className="text-[10px] px-1.5 py-0.5 rounded bg-blade-surface border border-blade-border text-blade-muted hover:text-blade-text hover:border-accent transition-colors"
            >
              Describe
            </button>
          </div>

          {/* Columns */}
          <div className="space-y-0.5 px-2">
            {table.columns.map((col) => (
              <div key={col.name} className="flex items-center text-[11px] font-mono">
                <span className="text-blade-text truncate flex-1">
                  {col.name}
                  {col.primaryKey && <PKBadge />}
                </span>
                <span className="text-blade-muted ml-2 shrink-0 text-[10px]">
                  {col.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ResultTable({
  result,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
}: {
  result: QueryResult;
  sort: SortState;
  onSort: (col: number) => void;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(result.rows.length / pageSize));

  const sortedRows = useMemo(() => {
    if (sort.dir === null) return result.rows;
    const sorted = [...result.rows].sort((a, b) => {
      const va = a[sort.column] ?? "";
      const vb = b[sort.column] ?? "";
      // Try numeric comparison
      const na = parseFloat(va);
      const nb = parseFloat(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        return sort.dir === "asc" ? na - nb : nb - na;
      }
      return sort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    return sorted;
  }, [result.rows, sort]);

  const pagedRows = sortedRows.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-blade-bg">
              {result.columns.map((col, i) => (
                <th
                  key={i}
                  onClick={() => onSort(i)}
                  className="text-left px-3 py-1.5 font-semibold text-blade-muted border-b border-blade-border cursor-pointer hover:text-blade-text select-none whitespace-nowrap"
                >
                  {col}
                  {sort.column === i && sort.dir === "asc" && " \u2191"}
                  {sort.column === i && sort.dir === "desc" && " \u2193"}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((row, ri) => (
              <tr
                key={ri}
                className="border-b border-blade-border/30 hover:bg-blade-surface/50 transition-colors"
              >
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-1 text-blade-text font-mono max-w-[300px] truncate whitespace-nowrap"
                    title={cell}
                  >
                    {cell === "" || cell === null ? (
                      <span className="text-blade-muted italic">NULL</span>
                    ) : (
                      truncate(cell, 120)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-blade-border bg-blade-bg/80 text-[11px] text-blade-muted">
          <span>
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, result.rows.length)} of {result.rows.length}
          </span>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => onPageChange(page - 1)}
              className="px-2 py-0.5 rounded border border-blade-border disabled:opacity-30 hover:bg-blade-surface transition-colors"
            >
              Prev
            </button>
            <span className="px-2 py-0.5">
              {page + 1} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => onPageChange(page + 1)}
              className="px-2 py-0.5 rounded border border-blade-border disabled:opacity-30 hover:bg-blade-surface transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function DatabaseExplorer({ onBack, onSendToChat }: Props) {
  const {
    tables,
    queryHistory,
    savedQueries,
    loading,
    executeQuery,
    saveQuery,
    deleteSavedQuery,
    getTables,
    generateQueryFromPrompt,
    exportResult,
  } = useDatabaseExplorer();

  // ── Local state ───────────────────────────────────────────────────────

  const [sql, setSql] = useState("SELECT name FROM sqlite_master WHERE type='table';");
  const [aiPrompt, setAiPrompt] = useState("");
  const [currentResult, setCurrentResult] = useState<QueryResult | null>(null);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [showAiInput, setShowAiInput] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [executing, setExecuting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sort, setSort] = useState<SortState>({ column: 0, dir: null });
  const [page, setPage] = useState(0);
  const [schemaFilter, setSchemaFilter] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const PAGE_SIZE = 100;

  // ── Load tables on mount ──────────────────────────────────────────────

  useEffect(() => {
    getTables();
  }, [getTables]);

  // ── Filtered tables ───────────────────────────────────────────────────

  const filteredTables = useMemo(() => {
    if (!schemaFilter) return tables;
    const lower = schemaFilter.toLowerCase();
    return tables.filter((t) => t.name.toLowerCase().includes(lower));
  }, [tables, schemaFilter]);

  // ── Run query ─────────────────────────────────────────────────────────

  const handleRunQuery = useCallback(async () => {
    if (!sql.trim() || executing) return;
    setExecuting(true);
    setSort({ column: 0, dir: null });
    setPage(0);
    try {
      const result = await executeQuery(sql);
      setCurrentResult(result);
    } finally {
      setExecuting(false);
    }
  }, [sql, executing, executeQuery]);

  // ── AI generate ───────────────────────────────────────────────────────

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim() || generating) return;
    setGenerating(true);
    try {
      const generated = await generateQueryFromPrompt(aiPrompt);
      setSql(generated);
      setShowAiInput(false);
      setAiPrompt("");
      // Auto-run the generated query
      setExecuting(true);
      setSort({ column: 0, dir: null });
      setPage(0);
      const result = await executeQuery(generated);
      setCurrentResult(result);
    } finally {
      setGenerating(false);
      setExecuting(false);
    }
  }, [aiPrompt, generating, generateQueryFromPrompt, executeQuery]);

  // ── Table quick actions ───────────────────────────────────────────────

  const handleBrowseTable = useCallback(
    (name: string) => {
      const q = `SELECT * FROM "${name}" LIMIT 50`;
      setSql(q);
      textareaRef.current?.focus();
    },
    []
  );

  const handleCountTable = useCallback(
    async (name: string) => {
      const q = `SELECT COUNT(*) AS total FROM "${name}"`;
      setSql(q);
      setExecuting(true);
      try {
        const result = await executeQuery(q);
        setCurrentResult(result);
      } finally {
        setExecuting(false);
      }
    },
    [executeQuery]
  );

  const handleDescribeTable = useCallback(
    async (name: string) => {
      const q = `PRAGMA table_info("${name}")`;
      setSql(q);
      setExecuting(true);
      try {
        const result = await executeQuery(q);
        setCurrentResult(result);
      } finally {
        setExecuting(false);
      }
    },
    [executeQuery]
  );

  // ── Sort handler ──────────────────────────────────────────────────────

  const handleSort = useCallback(
    (col: number) => {
      setSort((prev) => {
        if (prev.column !== col) return { column: col, dir: "asc" };
        if (prev.dir === "asc") return { column: col, dir: "desc" };
        if (prev.dir === "desc") return { column: col, dir: null };
        return { column: col, dir: "asc" };
      });
    },
    []
  );

  // ── Export ────────────────────────────────────────────────────────────

  const handleExport = useCallback(
    (format: "csv" | "json") => {
      if (!currentResult) return;
      const data = exportResult(currentResult.id, format);
      if (!data) return;

      const blob = new Blob([data], {
        type: format === "csv" ? "text/csv" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `query-result-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [currentResult, exportResult]
  );

  // ── Save query dialog ────────────────────────────────────────────────

  const handleSave = useCallback(() => {
    if (!saveName.trim()) return;
    saveQuery(saveName, sql, saveDesc);
    setSaveDialogOpen(false);
    setSaveName("");
    setSaveDesc("");
  }, [saveName, saveDesc, sql, saveQuery]);

  // ── Keyboard shortcut ────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleRunQuery();
      }
    },
    [handleRunQuery]
  );

  // ── Send to chat ─────────────────────────────────────────────────────

  const handleSendToChat = useCallback(() => {
    if (!currentResult) return;
    const summary = currentResult.error
      ? `SQL Error: ${currentResult.error}\nQuery: ${currentResult.sql}`
      : `Query: ${currentResult.sql}\nRows: ${currentResult.rowCount} | Time: ${currentResult.executionTime}ms\n\nFirst 5 rows:\n${currentResult.rows
          .slice(0, 5)
          .map((r) => r.join(" | "))
          .join("\n")}`;
    onSendToChat(summary);
  }, [currentResult, onSendToChat]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-blade-bg text-blade-text">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-blade-border bg-blade-surface/50 shrink-0">
        <button
          onClick={onBack}
          className="text-blade-muted hover:text-blade-text transition-colors text-sm"
        >
          {"\u2190"} Back
        </button>
        <div className="w-px h-4 bg-blade-border" />
        <h1 className="text-sm font-semibold tracking-tight flex items-center gap-2">
          <span className="text-accent">{"{ }"}</span> Database Explorer
        </h1>
        <div className="flex-1" />
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            showHistory
              ? "bg-accent/20 border-accent text-accent"
              : "border-blade-border text-blade-muted hover:text-blade-text"
          }`}
        >
          History
        </button>
        <button
          onClick={() => setShowSaved(!showSaved)}
          className={`text-xs px-2 py-1 rounded border transition-colors ${
            showSaved
              ? "bg-accent/20 border-accent text-accent"
              : "border-blade-border text-blade-muted hover:text-blade-text"
          }`}
        >
          Saved
        </button>
        <button
          onClick={() => getTables()}
          className="text-xs px-2 py-1 rounded border border-blade-border text-blade-muted hover:text-blade-text transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* ── Schema sidebar ─────────────────────────────────────────────── */}
        <div className="w-56 shrink-0 border-r border-blade-border flex flex-col bg-blade-bg">
          <div className="px-3 py-2 border-b border-blade-border">
            <div className="text-[10px] uppercase tracking-wider text-blade-muted font-semibold mb-1.5">
              Tables ({tables.length})
            </div>
            <input
              type="text"
              value={schemaFilter}
              onChange={(e) => setSchemaFilter(e.target.value)}
              placeholder="Filter tables..."
              className="w-full text-xs px-2 py-1 rounded bg-blade-surface border border-blade-border text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-accent"
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && tables.length === 0 ? (
              <div className="px-3 py-4 text-xs text-blade-muted text-center">
                Loading schema...
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="px-3 py-4 text-xs text-blade-muted text-center">
                No tables found
              </div>
            ) : (
              filteredTables.map((table) => (
                <TableItem
                  key={table.name}
                  table={table}
                  expanded={expandedTable === table.name}
                  onToggle={() =>
                    setExpandedTable(
                      expandedTable === table.name ? null : table.name
                    )
                  }
                  onBrowse={() => handleBrowseTable(table.name)}
                  onCount={() => handleCountTable(table.name)}
                  onDescribe={() => handleDescribeTable(table.name)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Main area (editor + results) ───────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Query editor */}
          <div className="border-b border-blade-border bg-blade-surface/30 shrink-0">
            {/* Toolbar */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-blade-border/50">
              <button
                onClick={handleRunQuery}
                disabled={executing || !sql.trim()}
                className="flex items-center gap-1.5 text-xs px-3 py-1 rounded bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                {executing ? (
                  <>
                    <span className="animate-spin text-[10px]">{"\u25CB"}</span> Running...
                  </>
                ) : (
                  <>
                    {"\u25B6"} Run
                  </>
                )}
              </button>
              <span className="text-[10px] text-blade-muted">Ctrl+Enter</span>
              <div className="w-px h-4 bg-blade-border" />
              <button
                onClick={() => setShowAiInput(!showAiInput)}
                className={`text-xs px-2 py-1 rounded border transition-colors ${
                  showAiInput
                    ? "bg-purple-500/20 border-purple-500 text-purple-400"
                    : "border-blade-border text-blade-muted hover:text-blade-text"
                }`}
              >
                AI Generate
              </button>
              <button
                onClick={() => setSaveDialogOpen(true)}
                disabled={!sql.trim()}
                className="text-xs px-2 py-1 rounded border border-blade-border text-blade-muted hover:text-amber-400 hover:border-amber-400/50 disabled:opacity-30 transition-colors"
              >
                {"\u2606"} Save
              </button>
              <div className="flex-1" />
              {currentResult && !currentResult.error && (
                <>
                  <button
                    onClick={() => handleExport("csv")}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-blade-border text-blade-muted hover:text-blade-text transition-colors"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={() => handleExport("json")}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-blade-border text-blade-muted hover:text-blade-text transition-colors"
                  >
                    Export JSON
                  </button>
                  <button
                    onClick={handleSendToChat}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-blade-border text-blade-muted hover:text-accent hover:border-accent/50 transition-colors"
                  >
                    Send to Chat
                  </button>
                </>
              )}
            </div>

            {/* AI input */}
            {showAiInput && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-blade-border/50 bg-purple-500/5">
                <span className="text-[10px] text-purple-400 font-medium shrink-0">
                  Ask AI:
                </span>
                <input
                  type="text"
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAiGenerate();
                    if (e.key === "Escape") setShowAiInput(false);
                  }}
                  placeholder="Describe your query in plain English..."
                  className="flex-1 text-xs px-2 py-1 rounded bg-blade-surface border border-blade-border text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-purple-500"
                  autoFocus
                />
                <button
                  onClick={handleAiGenerate}
                  disabled={generating || !aiPrompt.trim()}
                  className="text-xs px-3 py-1 rounded bg-purple-500 text-white font-medium hover:bg-purple-500/90 disabled:opacity-40 transition-colors"
                >
                  {generating ? "Generating..." : "Generate & Run"}
                </button>
              </div>
            )}

            {/* SQL textarea with overlay highlights */}
            <div className="relative">
              <div
                className="absolute inset-0 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap pointer-events-none overflow-hidden text-transparent"
                aria-hidden="true"
              >
                {highlightSQL(sql)}
              </div>
              <textarea
                ref={textareaRef}
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={5}
                spellCheck={false}
                className="w-full px-3 py-2 font-mono text-xs leading-relaxed bg-transparent text-blade-text/90 caret-accent resize-none focus:outline-none"
                placeholder="Enter SQL query..."
              />
            </div>
          </div>

          {/* Results panel */}
          <div className="flex-1 flex flex-col min-h-0">
            {currentResult ? (
              currentResult.error ? (
                /* Error display */
                <div className="p-4 space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
                    <span className="text-red-400 text-sm mt-0.5">{"\u2716"}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-red-400 mb-1">
                        Query Error
                      </div>
                      <pre className="text-xs text-red-300/80 font-mono whitespace-pre-wrap break-all">
                        {currentResult.error}
                      </pre>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-blade-muted">
                      Execution time: {currentResult.executionTime}ms
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() =>
                        onSendToChat(
                          `Fix this SQL error:\n\nQuery: ${currentResult.sql}\n\nError: ${currentResult.error}`
                        )
                      }
                      className="text-[10px] px-2 py-1 rounded border border-blade-border text-blade-muted hover:text-accent hover:border-accent/50 transition-colors"
                    >
                      Ask AI to fix
                    </button>
                  </div>
                </div>
              ) : (
                /* Success: data table */
                <div className="flex flex-col h-full">
                  {/* Result stats bar */}
                  <div className="flex items-center gap-3 px-3 py-1.5 border-b border-blade-border bg-blade-surface/30 text-[11px] text-blade-muted shrink-0">
                    <span className="text-emerald-400">{"\u2714"}</span>
                    <span>
                      {currentResult.rowCount.toLocaleString()} row{currentResult.rowCount !== 1 ? "s" : ""}
                    </span>
                    <span className="text-blade-border">|</span>
                    <span>
                      {currentResult.columns.length} column{currentResult.columns.length !== 1 ? "s" : ""}
                    </span>
                    <span className="text-blade-border">|</span>
                    <span>{currentResult.executionTime}ms</span>
                  </div>

                  {currentResult.rows.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-xs text-blade-muted">
                      Query returned no rows
                    </div>
                  ) : (
                    <ResultTable
                      result={currentResult}
                      sort={sort}
                      onSort={handleSort}
                      page={page}
                      pageSize={PAGE_SIZE}
                      onPageChange={setPage}
                    />
                  )}
                </div>
              )
            ) : (
              /* Empty state */
              <div className="flex-1 flex flex-col items-center justify-center gap-3 text-blade-muted">
                <div className="text-3xl opacity-30">{"{ }"}</div>
                <div className="text-xs">
                  Write a query or click a table to get started
                </div>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => setShowAiInput(true)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors"
                  >
                    Ask AI a question
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── History sidebar ────────────────────────────────────────────── */}
        {showHistory && (
          <div className="w-64 shrink-0 border-l border-blade-border flex flex-col bg-blade-bg">
            <div className="px-3 py-2 border-b border-blade-border flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-blade-muted font-semibold">
                Query History
              </span>
              <button
                onClick={() => setShowHistory(false)}
                className="text-blade-muted hover:text-blade-text text-xs"
              >
                {"\u2715"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {queryHistory.length === 0 ? (
                <div className="px-3 py-4 text-xs text-blade-muted text-center">
                  No queries yet
                </div>
              ) : (
                queryHistory.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => {
                      setSql(entry.sql);
                      textareaRef.current?.focus();
                    }}
                    className="w-full text-left px-3 py-2 border-b border-blade-border/30 hover:bg-blade-surface/50 transition-colors group"
                  >
                    <div className="font-mono text-[10px] text-blade-text truncate group-hover:text-accent transition-colors">
                      {truncate(entry.sql, 60)}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[9px] text-blade-muted">
                      <span>{timeAgo(entry.timestamp)}</span>
                      <span>{entry.executionTime}ms</span>
                      {entry.error ? (
                        <span className="text-red-400">Error</span>
                      ) : (
                        <span className="text-emerald-400/70">
                          {entry.rowCount} rows
                        </span>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* ── Saved queries sidebar ──────────────────────────────────────── */}
        {showSaved && (
          <div className="w-64 shrink-0 border-l border-blade-border flex flex-col bg-blade-bg">
            <div className="px-3 py-2 border-b border-blade-border flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-blade-muted font-semibold">
                Saved Queries
              </span>
              <button
                onClick={() => setShowSaved(false)}
                className="text-blade-muted hover:text-blade-text text-xs"
              >
                {"\u2715"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {savedQueries.length === 0 ? (
                <div className="px-3 py-4 text-xs text-blade-muted text-center">
                  No saved queries yet. Star a query to save it.
                </div>
              ) : (
                savedQueries.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-3 py-2 border-b border-blade-border/30 hover:bg-blade-surface/50 transition-colors group"
                  >
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setSql(entry.sql);
                          textareaRef.current?.focus();
                        }}
                        className="flex-1 text-left min-w-0"
                      >
                        <div className="text-xs font-medium text-blade-text truncate group-hover:text-accent transition-colors">
                          {entry.name}
                        </div>
                        {entry.description && (
                          <div className="text-[10px] text-blade-muted truncate mt-0.5">
                            {entry.description}
                          </div>
                        )}
                        <div className="font-mono text-[9px] text-blade-muted/70 truncate mt-0.5">
                          {truncate(entry.sql, 50)}
                        </div>
                      </button>
                      <button
                        onClick={() => deleteSavedQuery(entry.id)}
                        className="text-blade-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs shrink-0 p-1"
                      >
                        {"\u2715"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Save query dialog ──────────────────────────────────────────── */}
      {saveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-blade-surface border border-blade-border rounded-2xl shadow-2xl w-[380px] p-5">
            <h2 className="text-sm font-semibold text-blade-text mb-4">
              Save Query
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-blade-muted font-semibold block mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="e.g., Active users this week"
                  className="w-full text-xs px-3 py-2 rounded-lg bg-blade-bg border border-blade-border text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-accent"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSave();
                    if (e.key === "Escape") setSaveDialogOpen(false);
                  }}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-blade-muted font-semibold block mb-1">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={saveDesc}
                  onChange={(e) => setSaveDesc(e.target.value)}
                  placeholder="Brief description..."
                  className="w-full text-xs px-3 py-2 rounded-lg bg-blade-bg border border-blade-border text-blade-text placeholder:text-blade-muted/50 focus:outline-none focus:border-accent"
                />
              </div>
              <div className="p-2 rounded-lg bg-blade-bg border border-blade-border">
                <pre className="text-[10px] font-mono text-blade-muted truncate">
                  {truncate(sql, 100)}
                </pre>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setSaveDialogOpen(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-blade-border text-blade-muted hover:text-blade-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!saveName.trim()}
                className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-40 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
