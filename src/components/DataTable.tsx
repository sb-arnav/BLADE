import { useState, useMemo, useCallback } from "react";

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  columns: string[];
  rows: string[][];
  sortable?: boolean;
  searchable?: boolean;
  title?: string;
  pageSize?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function isNumeric(v: string): boolean {
  return /^-?[\d,.]+%?$/.test(v.trim());
}

function parseNum(v: string): number {
  return parseFloat(v.replace(/,/g, "").replace(/%$/, ""));
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function exportCSV(columns: string[], rows: string[][]): string {
  const escape = (s: string) => (s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s);
  const header = columns.map(escape).join(",");
  const body = rows.map((row) => row.map(escape).join(","));
  return [header, ...body].join("\n");
}

// ── Sort indicator ──────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: "asc" | "desc" | null }) {
  if (!dir) {
    return (
      <svg width={12} height={12} viewBox="0 0 12 12" className="ml-1 inline opacity-30">
        <path d="M6 2l3 4H3z" fill="currentColor" />
        <path d="M6 10l3-4H3z" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" className="ml-1 inline">
      {dir === "asc" ? (
        <path d="M6 2l3 4H3z" fill="currentColor" />
      ) : (
        <path d="M6 10l3-4H3z" fill="currentColor" />
      )}
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function DataTable({
  columns,
  rows,
  sortable = true,
  searchable = true,
  title,
  pageSize = 50,
}: Props) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  // Detect which columns are numeric for right-alignment and numeric sort
  const numericCols = useMemo(() => {
    return columns.map((_, ci) => {
      let numCount = 0;
      for (const row of rows) {
        if (ci < row.length && isNumeric(row[ci])) numCount++;
      }
      return numCount > rows.length * 0.5;
    });
  }, [columns, rows]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(q)));
  }, [rows, search]);

  // Sort
  const sorted = useMemo(() => {
    if (sortCol === null) return filtered;
    const col = sortCol;
    const isNum = numericCols[col];
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[col] ?? "";
      const bv = b[col] ?? "";
      let cmp: number;
      if (isNum) {
        cmp = parseNum(av) - parseNum(bv);
      } else {
        cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortCol, sortDir, numericCols]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated = useMemo(() => {
    const start = page * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // Reset page on search change
  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPage(0);
  }, []);

  // Toggle sort
  const handleSort = useCallback(
    (colIdx: number) => {
      if (!sortable) return;
      if (sortCol === colIdx) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortCol(colIdx);
        setSortDir("asc");
      }
    },
    [sortable, sortCol],
  );

  // Copy helpers
  const handleCopyRow = useCallback(
    (rowIdx: number) => {
      const row = paginated[rowIdx];
      if (row) copyToClipboard(row.join("\t"));
    },
    [paginated],
  );

  const handleCopyColumn = useCallback(
    (colIdx: number) => {
      const vals = sorted.map((r) => r[colIdx] ?? "");
      copyToClipboard(vals.join("\n"));
    },
    [sorted],
  );

  const handleExportCSV = useCallback(() => {
    const csv = exportCSV(columns, sorted);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title ?? "data").replace(/\s+/g, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [columns, sorted, title]);

  const btnClass =
    "rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-[#a0a0b0] hover:bg-white/[0.06] hover:text-[#e2e2e8] transition-colors";

  return (
    <div className="w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#12121a]">
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <div className="flex items-center gap-3">
          {title && <h3 className="text-sm font-medium text-[#e2e2e8]">{title}</h3>}
          <span className="text-[11px] text-[#707080]">
            {sorted.length} row{sorted.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {searchable && (
            <input
              type="text"
              placeholder="Filter\u2026"
              value={search}
              onChange={handleSearch}
              className="h-7 w-44 rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-xs text-[#e2e2e8] placeholder-[#505060] outline-none focus:border-[#6366f1]/50"
            />
          )}
          <button className={btnClass} onClick={handleExportCSV} title="Download CSV">
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-[#16161e]">
            <tr className="border-b border-white/10">
              <th className="w-10 px-3 py-2 text-center font-medium text-[#505060]">#</th>
              {columns.map((col, ci) => (
                <th
                  key={ci}
                  className={`group/th px-3 py-2 font-medium text-[#a0a0b0] ${sortable ? "cursor-pointer select-none hover:text-[#e2e2e8]" : ""} ${numericCols[ci] ? "text-right" : "text-left"}`}
                  onClick={() => handleSort(ci)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    handleCopyColumn(ci);
                  }}
                  title={sortable ? "Click to sort, right-click to copy column" : "Right-click to copy column"}
                >
                  {col}
                  {sortable && <SortIcon dir={sortCol === ci ? sortDir : null} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-[#505060]">
                  No matching rows
                </td>
              </tr>
            )}
            {paginated.map((row, ri) => {
              const absIdx = page * pageSize + ri;
              const isSelected = selectedRow === absIdx;
              return (
                <tr
                  key={ri}
                  className={`border-b border-white/[0.03] transition-colors ${
                    isSelected
                      ? "bg-[#6366f1]/10"
                      : ri % 2 === 0
                        ? "bg-white/[0.01]"
                        : "bg-transparent"
                  } hover:bg-white/[0.04]`}
                  onClick={() => setSelectedRow(isSelected ? null : absIdx)}
                  onDoubleClick={() => handleCopyRow(ri)}
                  title="Click to select, double-click to copy row"
                >
                  <td className="px-3 py-1.5 text-center font-mono text-[10px] text-[#505060]">
                    {absIdx + 1}
                  </td>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-1.5 ${numericCols[ci] ? "text-right font-mono" : ""} text-[#e2e2e8]`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2">
          <span className="text-[11px] text-[#707080]">
            Page {page + 1} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button
              className={`${btnClass} ${page === 0 ? "pointer-events-none opacity-30" : ""}`}
              onClick={() => setPage(0)}
              disabled={page === 0}
            >
              First
            </button>
            <button
              className={`${btnClass} ${page === 0 ? "pointer-events-none opacity-30" : ""}`}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              Prev
            </button>
            <button
              className={`${btnClass} ${page >= totalPages - 1 ? "pointer-events-none opacity-30" : ""}`}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next
            </button>
            <button
              className={`${btnClass} ${page >= totalPages - 1 ? "pointer-events-none opacity-30" : ""}`}
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
            >
              Last
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
