import { useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChartDataset {
  label: string;
  data: number[];
  color?: string;
}

export interface ChartData {
  type: "bar" | "line" | "pie" | "scatter" | "heatmap" | "table";
  title: string;
  labels: string[];
  datasets: ChartDataset[];
  options?: {
    xLabel?: string;
    yLabel?: string;
    stacked?: boolean;
    percentage?: boolean;
    horizontal?: boolean;
  };
}

type ExportFormat = "csv" | "json" | "svg";

// ── Palette ───────────────────────────────────────────────────────────────────

const PALETTE = [
  "#6366f1", "#22d3ee", "#f59e0b", "#ef4444",
  "#10b981", "#8b5cf6", "#ec4899", "#14b8a6",
];

// ── Detection patterns ──────────────────────────────────────────────────────

const TABLE_RE = /\|(.+)\|\s*\n\|[-\s|:]+\|\s*\n((?:\|.+\|\s*\n?)+)/g;
const NUM_LIST_RE = /^[\s]*[-*]\s*(.+?):\s*([\d,.]+%?)$/gm;
const TIME_SERIES_RE =
  /^[\s]*[-*]\s*((?:\d{4}[-/]\d{2}(?:[-/]\d{2})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{2,4}|Q[1-4]\s+\d{4}))[\s:–-]+([\d,.]+)/gim;
const PERCENT_RE = /^[\s]*[-*]\s*(.+?):\s*([\d.]+)\s*%/gm;
void 0; // COMPARISON_RE reserved for future multi-column detection

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, "").replace(/%$/, ""));
}

function extractTableData(
  md: string,
): { headers: string[]; rows: string[][] } | null {
  TABLE_RE.lastIndex = 0;
  const m = TABLE_RE.exec(md);
  if (!m) return null;
  const headers = m[1]
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);
  const bodyLines = m[2].trim().split("\n");
  const rows = bodyLines.map((line) =>
    line
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean),
  );
  return { headers, rows };
}

function isNumericColumn(rows: string[][], colIdx: number): boolean {
  let numCount = 0;
  for (const row of rows) {
    if (colIdx < row.length && /^[\d,.]+%?$/.test(row[colIdx].trim())) {
      numCount++;
    }
  }
  return numCount > rows.length * 0.6;
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useDataViz() {
  /**
   * Scan markdown for data patterns and return suggested ChartData objects.
   */
  const parseChartFromMarkdown = useCallback(
    (markdown: string): ChartData[] => {
      const charts: ChartData[] = [];

      // 1. Markdown tables
      const table = extractTableData(markdown);
      if (table && table.rows.length > 0) {
        const numCols = table.headers
          .map((_, i) => i)
          .filter((i) => isNumericColumn(table.rows, i));
        const labelCol = numCols.length > 0 ? 0 : -1;

        if (numCols.length > 0 && labelCol >= 0) {
          const labels = table.rows.map((r) => r[labelCol] ?? "");
          const datasets: ChartDataset[] = numCols
            .filter((i) => i !== labelCol)
            .map((colIdx, di) => ({
              label: table.headers[colIdx],
              data: table.rows.map((r) => parseNum(r[colIdx] ?? "0")),
              color: PALETTE[di % PALETTE.length],
            }));

          charts.push({
            type: datasets.length > 1 ? "bar" : "bar",
            title: "Data",
            labels,
            datasets,
            options: { stacked: false },
          });
        }

        // Always add a raw table chart
        charts.push({
          type: "table",
          title: "Table",
          labels: table.headers,
          datasets: table.rows.map((row, i) => ({
            label: `Row ${i + 1}`,
            data: row.map((c) => (isNaN(parseFloat(c)) ? 0 : parseFloat(c))),
          })),
        });
      }

      // 2. Percentage breakdowns → pie chart
      PERCENT_RE.lastIndex = 0;
      const pctMatches: { label: string; value: number }[] = [];
      let pm;
      while ((pm = PERCENT_RE.exec(markdown))) {
        pctMatches.push({ label: pm[1].trim(), value: parseNum(pm[2]) });
      }
      if (pctMatches.length >= 2) {
        charts.push({
          type: "pie",
          title: "Distribution",
          labels: pctMatches.map((p) => p.label),
          datasets: [
            {
              label: "Percentage",
              data: pctMatches.map((p) => p.value),
            },
          ],
          options: { percentage: true },
        });
      }

      // 3. Time series → line chart
      TIME_SERIES_RE.lastIndex = 0;
      const tsMatches: { label: string; value: number }[] = [];
      let tm;
      while ((tm = TIME_SERIES_RE.exec(markdown))) {
        tsMatches.push({ label: tm[1].trim(), value: parseNum(tm[2]) });
      }
      if (tsMatches.length >= 3) {
        charts.push({
          type: "line",
          title: "Trend",
          labels: tsMatches.map((t) => t.label),
          datasets: [
            {
              label: "Value",
              data: tsMatches.map((t) => t.value),
              color: PALETTE[0],
            },
          ],
          options: { xLabel: "Time", yLabel: "Value" },
        });
      }

      // 4. Generic numbered lists → bar chart
      if (pctMatches.length === 0 && tsMatches.length === 0) {
        NUM_LIST_RE.lastIndex = 0;
        const nlMatches: { label: string; value: number }[] = [];
        let nm;
        while ((nm = NUM_LIST_RE.exec(markdown))) {
          nlMatches.push({ label: nm[1].trim(), value: parseNum(nm[2]) });
        }
        if (nlMatches.length >= 2) {
          charts.push({
            type: "bar",
            title: "Values",
            labels: nlMatches.map((n) => n.label),
            datasets: [
              {
                label: "Value",
                data: nlMatches.map((n) => n.value),
                color: PALETTE[0],
              },
            ],
          });
        }
      }

      return charts;
    },
    [],
  );

  /**
   * Build a ChartData object from a type and raw text content.
   */
  const createChart = useCallback(
    (type: ChartData["type"], rawData: string): ChartData => {
      const lines = rawData
        .trim()
        .split("\n")
        .filter((l) => l.trim());

      const labels: string[] = [];
      const values: number[] = [];

      for (const line of lines) {
        const parts = line.split(/[,\t|]+/).map((s) => s.trim());
        if (parts.length >= 2) {
          labels.push(parts[0]);
          values.push(parseNum(parts[1]));
        }
      }

      return {
        type,
        title: type.charAt(0).toUpperCase() + type.slice(1) + " Chart",
        labels,
        datasets: [
          { label: "Data", data: values, color: PALETTE[0] },
        ],
      };
    },
    [],
  );

  /**
   * Export chart data in the requested format.
   */
  const exportChart = useCallback(
    (data: ChartData, format: ExportFormat): string => {
      if (format === "json") {
        return JSON.stringify(data, null, 2);
      }

      if (format === "csv") {
        const header = [
          "Label",
          ...data.datasets.map((ds) => ds.label),
        ].join(",");
        const rows = data.labels.map((label, i) => {
          const vals = data.datasets.map((ds) => ds.data[i] ?? "");
          return [label, ...vals].join(",");
        });
        return [header, ...rows].join("\n");
      }

      // SVG stub — the ChartRenderer produces actual SVG
      if (format === "svg") {
        const width = 600;
        const height = 400;
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`;
        svg += `<rect width="${width}" height="${height}" fill="#0f0f14"/>`;
        svg += `<text x="20" y="30" fill="#e2e2e8" font-size="16">${data.title}</text>`;
        const maxVal = Math.max(...data.datasets.flatMap((d) => d.data), 1);
        const barW = Math.max(
          8,
          (width - 80) / (data.labels.length * data.datasets.length) - 4,
        );
        data.datasets.forEach((ds, di) => {
          ds.data.forEach((val, i) => {
            const barH = (val / maxVal) * (height - 80);
            const x =
              40 +
              i * ((width - 80) / data.labels.length) +
              di * (barW + 2);
            const y = height - 40 - barH;
            svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${ds.color || PALETTE[di % PALETTE.length]}" rx="2"/>`;
          });
        });
        svg += `</svg>`;
        return svg;
      }

      return "";
    },
    [],
  );

  return { parseChartFromMarkdown, createChart, exportChart };
}
