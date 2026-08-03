/**
 * Charts, drawn as plain SVG.
 *
 * No charting library: these are two simple forms, and a dependency would add
 * weight to an installer that already carries a browser engine.
 *
 * Conventions applied throughout, because they are what make a chart readable
 * rather than merely present:
 *   - thin marks with rounded ends at the data end, anchored to the baseline
 *   - a 2px gap of surface between adjacent bars so they read as separate
 *   - direct labels rather than a number on every gridline
 *   - recessive axes and grid; the data is the darkest thing on screen
 *   - a hover tooltip on every mark
 */

import { useState } from "react";
import { money } from "./api";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

/**
 * Short axis label. Takes cents, reads in shillings.
 *
 * Shop days run into millions, and "3000k" makes a reader do arithmetic to
 * work out what they are looking at.
 */
function axisTick(cents: number): string {
  const shillings = cents / 100;
  if (shillings === 0) return "0";
  if (shillings >= 1_000_000) {
    const m = shillings / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (shillings >= 1_000) return `${Math.round(shillings / 1_000)}k`;
  return String(Math.round(shillings));
}

/** Rounded only at the data end; the baseline end stays square. */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const radius = Math.min(r, w / 2, h);
  if (h <= 0) return "";
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + radius}`,
    `Q ${x} ${y} ${x + radius} ${y}`,
    `L ${x + w - radius} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + radius}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

interface TrendPoint { date: string; gross: number; transactions: number }

/**
 * Takings per day.
 *
 * A bar rather than a line: these are discrete trading days being compared,
 * not a continuous quantity sampled over time.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (!data.length) return <p className="chart-empty">No sales in this period.</p>;

  const W = 720, H = 190;
  const pad = { top: 14, right: 8, bottom: 26, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const max = Math.max(...data.map(d => d.gross), 1);
  // Round the axis top up to something a person would choose.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;

  const slot = plotW / data.length;
  const barW = Math.max(2, slot - 2); // the 2px surface gap

  const y = (v: number) => pad.top + plotH - (v / top) * plotH;
  const gridValues = [0, 0.5, 1].map(f => top * f);

  return (
    <div style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img"
           aria-label="Takings per day for the period shown">
        {gridValues.map(v => (
          <g key={v}>
            <line className="grid-line" x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} />
            <text className="tick" x={pad.left - 8} y={y(v) + 3} textAnchor="end">
              {axisTick(v)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const h = Math.max(0, plotH - (y(d.gross) - pad.top));
          const x = pad.left + i * slot + 1;
          return (
            <path key={d.date} className="bar"
                  d={barPath(x, y(d.gross), barW, h)}
                  fill={SERIES[0]}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)} />
          );
        })}

        <line className="axis-line" x1={pad.left} x2={W - pad.right}
              y1={pad.top + plotH} y2={pad.top + plotH} />

        {/* Only the ends and the peak are labelled — a date under every bar
            would be unreadable at this width. */}
        {data.map((d, i) => {
          const isEnd = i === 0 || i === data.length - 1;
          const isPeak = d.gross === max;
          if (!isEnd && !isPeak) return null;
          return (
            <text key={`t-${d.date}`} className="tick"
                  x={pad.left + i * slot + barW / 2} y={H - 8}
                  textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>
              {d.date.slice(5)}
            </text>
          );
        })}
      </svg>

      {hover !== null && (
        <div style={{
          position: "absolute", top: 0,
          left: `${((pad.left + hover * slot + barW / 2) / W) * 100}%`,
          transform: "translateX(-50%)",
          background: "var(--ink)", color: "#fff", fontSize: "0.74rem",
          padding: "0.3rem 0.5rem", borderRadius: 3, whiteSpace: "nowrap",
          pointerEvents: "none",
        }}>
          {data[hover]!.date} · {money(data[hover]!.gross)} · {data[hover]!.transactions} receipts
        </div>
      )}
    </div>
  );
}

interface MixSlice { method: string; transactions: number; total: number }

/**
 * How the takings were tendered.
 *
 * Horizontal bars, not a pie: comparing lengths against a shared baseline is
 * something people do accurately, comparing angles is not. Every bar carries
 * its own value, which is also what lets the lighter series colour be used
 * against a white surface.
 */
export function PaymentMixChart({ data }: { data: MixSlice[] }) {
  if (!data.length) return <p className="chart-empty">Nothing taken on this day.</p>;

  const rows = data.slice(0, 8);
  const max = Math.max(...rows.map(r => r.total), 1);
  const rowH = 26, labelW = 132, valueW = 92;

  return (
    <svg className="chart" viewBox={`0 0 720 ${rows.length * rowH + 6}`} role="img"
         aria-label="Takings by payment method">
      {rows.map((r, i) => {
        const yTop = i * rowH + 4;
        const barH = rowH - 12;
        const full = 720 - labelW - valueW;
        const w = Math.max(2, (r.total / max) * full);
        return (
          <g key={r.method}>
            <text className="bar-label" x={0} y={yTop + barH - 1} fill="var(--ink)">
              {r.method.length > 18 ? `${r.method.slice(0, 17)}…` : r.method}
            </text>
            <path className="bar" d={barPath(labelW, yTop, w, barH, 3)} fill={SERIES[0]} />
            <text className="bar-label" x={labelW + w + 8} y={yTop + barH - 1}>
              {money(r.total)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Stock level against its reorder point.
 *
 * Two series, so a legend is required. Colour alone never carries the
 * message: each bar is labelled with its own number.
 */
export function StockChart({ data }: {
  data: Array<{ code: string; description: string; onHand: number; reorder: number }>;
}) {
  if (!data.length) return <p className="chart-empty">Nothing at or below its reorder level.</p>;

  const rows = data.slice(0, 8);
  const max = Math.max(...rows.flatMap(r => [r.onHand, r.reorder]), 1);
  const rowH = 30, labelW = 190, valueW = 60;
  const full = 720 - labelW - valueW;

  return (
    <>
      <div className="legend">
        <span className="key">
          <span className="swatch" style={{ background: SERIES[0] }} />On hand
        </span>
        <span className="key">
          <span className="swatch" style={{ background: SERIES[1] }} />Reorder level
        </span>
      </div>
      <svg className="chart" viewBox={`0 0 720 ${rows.length * rowH + 6}`} role="img"
           aria-label="Stock on hand against reorder level">
        {rows.map((r, i) => {
          const yTop = i * rowH + 3;
          const barH = 8;
          const onW = Math.max(2, (r.onHand / max) * full);
          const reW = Math.max(2, (r.reorder / max) * full);
          return (
            <g key={r.code}>
              <text className="bar-label" x={0} y={yTop + 9} fill="var(--ink)">
                {r.description.length > 26 ? `${r.description.slice(0, 25)}…` : r.description}
              </text>
              <path d={barPath(labelW, yTop, onW, barH, 3)} fill={SERIES[0]} />
              {/* 2px gap keeps the two marks from reading as one. */}
              <path d={barPath(labelW, yTop + barH + 2, reW, barH, 3)} fill={SERIES[1]} />
              <text className="bar-label" x={labelW + Math.max(onW, reW) + 8} y={yTop + 13}>
                {r.onHand} / {r.reorder}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
