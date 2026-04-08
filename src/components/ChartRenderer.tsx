import { useState, useMemo, useRef, useCallback } from "react";
import type { ChartData } from "../hooks/useDataViz";
import { useDataViz } from "../hooks/useDataViz";

// ── Constants ────────────────────────────────────────────────────────────────

const PALETTE = [
  "#6366f1", "#22d3ee", "#f59e0b", "#ef4444",
  "#10b981", "#8b5cf6", "#ec4899", "#14b8a6",
];

const MARGIN = { top: 40, right: 20, bottom: 50, left: 60 };

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  data: ChartData;
  height?: number;
  interactive?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function dsColor(ds: { color?: string }, idx: number): string {
  return ds.color || PALETTE[idx % PALETTE.length];
}

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

function tickValues(max: number, count: number): number[] {
  const step = max / count;
  return Array.from({ length: count + 1 }, (_, i) => +(i * step).toPrecision(4));
}

function formatVal(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

export function ChartTooltip({
  x,
  y,
  label,
  value,
  color,
}: {
  x: number;
  y: number;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="pointer-events-none absolute z-50 rounded-md border border-white/10 bg-[#1a1a24] px-3 py-1.5 text-xs shadow-xl"
      style={{ left: x + 12, top: y - 30 }}
    >
      <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      <span className="text-[#a0a0b0]">{label}:</span>{" "}
      <span className="font-semibold text-[#e2e2e8]">{value}</span>
    </div>
  );
}

// ── Bar Chart ────────────────────────────────────────────────────────────────

function BarChart({
  data,
  width,
  height,
  interactive,
}: {
  data: ChartData;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const [hover, setHover] = useState<{ di: number; i: number; x: number; y: number } | null>(null);

  const allVals = data.datasets.flatMap((d) => d.data);
  const ceil = niceMax(Math.max(...allVals, 1));
  const ticks = tickValues(ceil, 5);

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const groupW = plotW / data.labels.length;
  const barW = Math.max(4, groupW / (data.datasets.length + 1) - 2);

  return (
    <svg width={width} height={height} className="select-none">
      {/* Y-axis grid & labels */}
      {ticks.map((t) => {
        const y = MARGIN.top + plotH - (t / ceil) * plotH;
        return (
          <g key={t}>
            <line
              x1={MARGIN.left}
              y1={y}
              x2={width - MARGIN.right}
              y2={y}
              stroke="#ffffff08"
            />
            <text x={MARGIN.left - 8} y={y + 4} textAnchor="end" fill="#707080" fontSize={11}>
              {formatVal(t)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {data.datasets.map((ds, di) =>
        ds.data.map((val, i) => {
          const barH = (val / ceil) * plotH;
          const x = MARGIN.left + i * groupW + di * (barW + 2) + (groupW - data.datasets.length * (barW + 2)) / 2;
          const y = MARGIN.top + plotH - barH;
          const isHovered = hover?.di === di && hover.i === i;
          return (
            <rect
              key={`${di}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(barH, 0)}
              rx={2}
              fill={dsColor(ds, di)}
              opacity={isHovered ? 1 : 0.85}
              className={interactive ? "cursor-pointer transition-opacity" : ""}
              onMouseEnter={interactive ? (e) => setHover({ di, i, x: e.clientX, y: e.clientY }) : undefined}
              onMouseLeave={interactive ? () => setHover(null) : undefined}
            />
          );
        }),
      )}

      {/* X-axis labels */}
      {data.labels.map((label, i) => {
        const x = MARGIN.left + i * groupW + groupW / 2;
        return (
          <text
            key={i}
            x={x}
            y={height - MARGIN.bottom + 18}
            textAnchor="middle"
            fill="#707080"
            fontSize={11}
          >
            {label.length > 12 ? label.slice(0, 11) + "\u2026" : label}
          </text>
        );
      })}

      {/* Axis labels */}
      {data.options?.yLabel && (
        <text
          x={14}
          y={MARGIN.top + plotH / 2}
          textAnchor="middle"
          fill="#707080"
          fontSize={11}
          transform={`rotate(-90, 14, ${MARGIN.top + plotH / 2})`}
        >
          {data.options.yLabel}
        </text>
      )}
      {data.options?.xLabel && (
        <text
          x={MARGIN.left + plotW / 2}
          y={height - 6}
          textAnchor="middle"
          fill="#707080"
          fontSize={11}
        >
          {data.options.xLabel}
        </text>
      )}

      {/* Hover overlay rendered in parent via portal */}
      {hover && (
        <text
          x={MARGIN.left + hover.i * groupW + groupW / 2}
          y={MARGIN.top + plotH - (data.datasets[hover.di].data[hover.i] / ceil) * plotH - 6}
          textAnchor="middle"
          fill="#e2e2e8"
          fontSize={11}
          fontWeight={600}
        >
          {formatVal(data.datasets[hover.di].data[hover.i])}
        </text>
      )}
    </svg>
  );
}

// ── Line Chart ──────────────────────────────────────────────────────────────

function LineChart({
  data,
  width,
  height,
  interactive,
}: {
  data: ChartData;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const allVals = data.datasets.flatMap((d) => d.data);
  const ceil = niceMax(Math.max(...allVals, 1));
  const ticks = tickValues(ceil, 5);

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  function px(i: number): number {
    return MARGIN.left + (i / Math.max(data.labels.length - 1, 1)) * plotW;
  }
  function py(v: number): number {
    return MARGIN.top + plotH - (v / ceil) * plotH;
  }

  return (
    <svg width={width} height={height} className="select-none">
      {/* Grid */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={MARGIN.left} y1={py(t)} x2={width - MARGIN.right} y2={py(t)} stroke="#ffffff08" />
          <text x={MARGIN.left - 8} y={py(t) + 4} textAnchor="end" fill="#707080" fontSize={11}>
            {formatVal(t)}
          </text>
        </g>
      ))}

      {/* Lines & dots */}
      {data.datasets.map((ds, di) => {
        const color = dsColor(ds, di);
        const points = ds.data.map((v, i) => `${px(i)},${py(v)}`).join(" ");
        return (
          <g key={di}>
            <polyline fill="none" stroke={color} strokeWidth={2} points={points} strokeLinejoin="round" />
            {/* Area fill */}
            <polygon
              points={`${px(0)},${py(0)} ${points} ${px(ds.data.length - 1)},${py(0)}`}
              fill={color}
              opacity={0.08}
            />
            {ds.data.map((v, i) => (
              <circle
                key={i}
                cx={px(i)}
                cy={py(v)}
                r={hoverIdx === i ? 5 : 3}
                fill={color}
                stroke="#0f0f14"
                strokeWidth={2}
                className={interactive ? "cursor-pointer transition-all" : ""}
                onMouseEnter={interactive ? () => setHoverIdx(i) : undefined}
                onMouseLeave={interactive ? () => setHoverIdx(null) : undefined}
              />
            ))}
          </g>
        );
      })}

      {/* Hover value */}
      {hoverIdx !== null && (
        <g>
          <line x1={px(hoverIdx)} y1={MARGIN.top} x2={px(hoverIdx)} y2={MARGIN.top + plotH} stroke="#ffffff20" strokeDasharray="4" />
          {data.datasets.map((ds, di) => (
            <text
              key={di}
              x={px(hoverIdx)}
              y={py(ds.data[hoverIdx]) - 10}
              textAnchor="middle"
              fill={dsColor(ds, di)}
              fontSize={11}
              fontWeight={600}
            >
              {formatVal(ds.data[hoverIdx])}
            </text>
          ))}
        </g>
      )}

      {/* X labels */}
      {data.labels.map((label, i) => (
        <text key={i} x={px(i)} y={height - MARGIN.bottom + 18} textAnchor="middle" fill="#707080" fontSize={11}>
          {label.length > 10 ? label.slice(0, 9) + "\u2026" : label}
        </text>
      ))}

      {data.options?.yLabel && (
        <text x={14} y={MARGIN.top + plotH / 2} textAnchor="middle" fill="#707080" fontSize={11} transform={`rotate(-90, 14, ${MARGIN.top + plotH / 2})`}>
          {data.options.yLabel}
        </text>
      )}
      {data.options?.xLabel && (
        <text x={MARGIN.left + plotW / 2} y={height - 6} textAnchor="middle" fill="#707080" fontSize={11}>
          {data.options.xLabel}
        </text>
      )}
    </svg>
  );
}

// ── Pie Chart ───────────────────────────────────────────────────────────────

function PieChart({
  data,
  width,
  height,
  interactive,
}: {
  data: ChartData;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const values = data.datasets[0]?.data ?? [];
  const total = values.reduce((s, v) => s + v, 0) || 1;
  const cx = width / 2 - 60;
  const cy = height / 2;
  const r = Math.min(cx - 20, cy - 20, 140);

  const slices = useMemo(() => {
    let cumAngle = -Math.PI / 2;
    return values.map((val, i) => {
      const angle = (val / total) * Math.PI * 2;
      const startAngle = cumAngle;
      cumAngle += angle;
      const endAngle = cumAngle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const midAngle = startAngle + angle / 2;
      const labelR = r * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      const pct = ((val / total) * 100).toFixed(1);

      return {
        path: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`,
        color: PALETTE[i % PALETTE.length],
        lx,
        ly,
        pct,
        label: data.labels[i] ?? "",
      };
    });
  }, [values, total, cx, cy, r, data.labels]);

  return (
    <svg width={width} height={height} className="select-none">
      {slices.map((s, i) => (
        <g key={i}>
          <path
            d={s.path}
            fill={s.color}
            opacity={hoverIdx === i ? 1 : 0.85}
            stroke="#0f0f14"
            strokeWidth={2}
            className={interactive ? "cursor-pointer transition-opacity" : ""}
            onMouseEnter={interactive ? () => setHoverIdx(i) : undefined}
            onMouseLeave={interactive ? () => setHoverIdx(null) : undefined}
          />
          {parseFloat(s.pct) > 5 && (
            <text x={s.lx} y={s.ly} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={11} fontWeight={600}>
              {s.pct}%
            </text>
          )}
        </g>
      ))}

      {/* Legend */}
      {slices.map((s, i) => (
        <g key={`leg-${i}`} transform={`translate(${width - 110}, ${30 + i * 20})`}>
          <rect width={10} height={10} rx={2} fill={s.color} />
          <text x={16} y={9} fill="#a0a0b0" fontSize={11}>
            {s.label.length > 12 ? s.label.slice(0, 11) + "\u2026" : s.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ── Scatter Plot ─────────────────────────────────────────────────────────────

function ScatterPlot({
  data,
  width,
  height,
  interactive,
}: {
  data: ChartData;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Use pairs: datasets[0] = x, datasets[1] = y (or just datasets[0] as y with index as x)
  const xVals = data.datasets.length > 1 ? data.datasets[0].data : data.datasets[0]?.data.map((_, i) => i) ?? [];
  const yVals = data.datasets.length > 1 ? data.datasets[1].data : data.datasets[0]?.data ?? [];

  const xMax = niceMax(Math.max(...xVals, 1));
  const yMax = niceMax(Math.max(...yVals, 1));

  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;

  function px(v: number) { return MARGIN.left + (v / xMax) * plotW; }
  function py(v: number) { return MARGIN.top + plotH - (v / yMax) * plotH; }

  return (
    <svg width={width} height={height} className="select-none">
      {tickValues(yMax, 5).map((t) => (
        <g key={t}>
          <line x1={MARGIN.left} y1={py(t)} x2={width - MARGIN.right} y2={py(t)} stroke="#ffffff08" />
          <text x={MARGIN.left - 8} y={py(t) + 4} textAnchor="end" fill="#707080" fontSize={11}>{formatVal(t)}</text>
        </g>
      ))}
      {tickValues(xMax, 5).map((t) => (
        <text key={`x-${t}`} x={px(t)} y={height - MARGIN.bottom + 18} textAnchor="middle" fill="#707080" fontSize={11}>
          {formatVal(t)}
        </text>
      ))}

      {xVals.map((xv, i) => {
        const yv = yVals[i] ?? 0;
        const isH = hoverIdx === i;
        return (
          <circle
            key={i}
            cx={px(xv)}
            cy={py(yv)}
            r={isH ? 6 : 4}
            fill={PALETTE[0]}
            opacity={isH ? 1 : 0.7}
            stroke="#0f0f14"
            strokeWidth={1.5}
            className={interactive ? "cursor-pointer transition-all" : ""}
            onMouseEnter={interactive ? () => setHoverIdx(i) : undefined}
            onMouseLeave={interactive ? () => setHoverIdx(null) : undefined}
          />
        );
      })}

      {hoverIdx !== null && (
        <text x={px(xVals[hoverIdx])} y={py(yVals[hoverIdx]) - 10} textAnchor="middle" fill="#e2e2e8" fontSize={11} fontWeight={600}>
          ({formatVal(xVals[hoverIdx])}, {formatVal(yVals[hoverIdx])})
        </text>
      )}

      {data.options?.xLabel && (
        <text x={MARGIN.left + plotW / 2} y={height - 6} textAnchor="middle" fill="#707080" fontSize={11}>{data.options.xLabel}</text>
      )}
      {data.options?.yLabel && (
        <text x={14} y={MARGIN.top + plotH / 2} textAnchor="middle" fill="#707080" fontSize={11} transform={`rotate(-90, 14, ${MARGIN.top + plotH / 2})`}>{data.options.yLabel}</text>
      )}
    </svg>
  );
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

function Heatmap({
  data,
  width,
  height,
  interactive,
}: {
  data: ChartData;
  width: number;
  height: number;
  interactive: boolean;
}) {
  const [hoverCell, setHoverCell] = useState<{ r: number; c: number } | null>(null);

  const rows = data.datasets;
  const cols = data.labels;
  const allVals = rows.flatMap((r) => r.data);
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal || 1;

  const cellW = Math.min(60, (width - MARGIN.left - 20) / cols.length);
  const cellH = Math.min(36, (height - MARGIN.top - 20) / rows.length);

  function intensity(v: number): string {
    const t = (v - minVal) / range;
    const r = Math.round(99 + t * 0);
    const g = Math.round(102 + t * (99 - 102));
    const b = Math.round(241 - t * (241 - 241));
    const a = 0.2 + t * 0.8;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  return (
    <svg width={width} height={height} className="select-none">
      {/* Column labels */}
      {cols.map((col, ci) => (
        <text
          key={ci}
          x={MARGIN.left + ci * cellW + cellW / 2}
          y={MARGIN.top - 8}
          textAnchor="middle"
          fill="#707080"
          fontSize={10}
        >
          {col.length > 8 ? col.slice(0, 7) + "\u2026" : col}
        </text>
      ))}

      {/* Rows */}
      {rows.map((row, ri) => (
        <g key={ri}>
          <text
            x={MARGIN.left - 8}
            y={MARGIN.top + ri * cellH + cellH / 2 + 4}
            textAnchor="end"
            fill="#707080"
            fontSize={10}
          >
            {row.label.length > 10 ? row.label.slice(0, 9) + "\u2026" : row.label}
          </text>
          {row.data.map((val, ci) => {
            const isH = hoverCell?.r === ri && hoverCell.c === ci;
            return (
              <g key={ci}>
                <rect
                  x={MARGIN.left + ci * cellW}
                  y={MARGIN.top + ri * cellH}
                  width={cellW - 1}
                  height={cellH - 1}
                  rx={3}
                  fill={intensity(val)}
                  stroke={isH ? "#e2e2e8" : "transparent"}
                  strokeWidth={isH ? 1.5 : 0}
                  className={interactive ? "cursor-pointer" : ""}
                  onMouseEnter={interactive ? () => setHoverCell({ r: ri, c: ci }) : undefined}
                  onMouseLeave={interactive ? () => setHoverCell(null) : undefined}
                />
                {cellW > 28 && (
                  <text
                    x={MARGIN.left + ci * cellW + cellW / 2 - 0.5}
                    y={MARGIN.top + ri * cellH + cellH / 2 + 4}
                    textAnchor="middle"
                    fill="#e2e2e8"
                    fontSize={10}
                  >
                    {formatVal(val)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

// ── Inline Table (simple — full table is DataTable) ─────────────────────────

function InlineTable({ data }: { data: ChartData }) {
  const headers = data.labels;
  const rows = data.datasets;

  return (
    <div className="overflow-auto rounded-lg border border-white/5">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.03]">
            <th className="px-3 py-2 font-medium text-[#a0a0b0]">#</th>
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 font-medium text-[#a0a0b0]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? "bg-white/[0.01]" : ""}>
              <td className="px-3 py-1.5 font-mono text-[#707080]">{ri + 1}</td>
              {row.data.map((val, ci) => (
                <td key={ci} className="px-3 py-1.5 font-mono text-[#e2e2e8]">{formatVal(val)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Legend ───────────────────────────────────────────────────────────────────

function Legend({ datasets }: { datasets: ChartData["datasets"] }) {
  if (datasets.length <= 1) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-3 px-2">
      {datasets.map((ds, i) => (
        <div key={i} className="flex items-center gap-1.5 text-xs text-[#a0a0b0]">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: dsColor(ds, i) }} />
          {ds.label}
        </div>
      ))}
    </div>
  );
}

// ── Export Controls ──────────────────────────────────────────────────────────

function ExportControls({ data }: { data: ChartData }) {
  const { exportChart } = useDataViz();

  const handleCSV = useCallback(() => {
    const csv = exportChart(data, "csv");
    copyToClipboard(csv);
  }, [data, exportChart]);

  const handleJSON = useCallback(() => {
    const json = exportChart(data, "json");
    copyToClipboard(json);
  }, [data, exportChart]);

  const handleSVG = useCallback(() => {
    const svg = exportChart(data, "svg");
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${data.title.replace(/\s+/g, "_").toLowerCase()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data, exportChart]);

  const btnClass =
    "rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[11px] text-[#a0a0b0] hover:bg-white/[0.06] hover:text-[#e2e2e8] transition-colors";

  return (
    <div className="flex gap-2">
      <button className={btnClass} onClick={handleCSV} title="Copy as CSV">
        CSV
      </button>
      <button className={btnClass} onClick={handleJSON} title="Copy as JSON">
        JSON
      </button>
      <button className={btnClass} onClick={handleSVG} title="Download SVG">
        SVG
      </button>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function ChartRenderer({ data, height = 320, interactive = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(560);

  // Observe container width for responsive sizing
  const measuredRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      (containerRef as React.MutableRefObject<HTMLDivElement>).current = node;
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setContainerWidth(entry.contentRect.width);
        }
      });
      ro.observe(node);
      return () => ro.disconnect();
    },
    [],
  );

  const chartWidth = Math.max(containerWidth, 300);

  return (
    <div
      ref={measuredRef}
      className="group relative w-full overflow-hidden rounded-xl border border-white/[0.06] bg-[#12121a]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
        <h3 className="text-sm font-medium text-[#e2e2e8]">{data.title}</h3>
        <div className="flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <ExportControls data={data} />
        </div>
      </div>

      {/* Chart body */}
      <div className="p-3">
        {data.type === "bar" && (
          <BarChart data={data} width={chartWidth} height={height} interactive={interactive} />
        )}
        {data.type === "line" && (
          <LineChart data={data} width={chartWidth} height={height} interactive={interactive} />
        )}
        {data.type === "pie" && (
          <PieChart data={data} width={chartWidth} height={height} interactive={interactive} />
        )}
        {data.type === "scatter" && (
          <ScatterPlot data={data} width={chartWidth} height={height} interactive={interactive} />
        )}
        {data.type === "heatmap" && (
          <Heatmap data={data} width={chartWidth} height={height} interactive={interactive} />
        )}
        {data.type === "table" && <InlineTable data={data} />}

        {data.type !== "table" && <Legend datasets={data.datasets} />}
      </div>
    </div>
  );
}
