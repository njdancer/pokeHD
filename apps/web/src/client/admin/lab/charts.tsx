// Small SVG charts for the lab, no chart library: line charts with a hover crosshair, sparklines,
// per-class bars and confusion matrices. Colours are the lab's validated categorical palette
// (--s1…--s6 in lab.css), assigned in fixed order and following the series, never its rank.
import { useMemo, useRef, useState, type ReactNode } from "react";

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)", "var(--s6)"];

export interface Line {
  key: string;
  label: string;
  points: { x: number; y: number }[];
  colour: string;
  dashed?: boolean;
}

/** Exponential moving average, for noisy training loss. `k` 0 = raw, 0.99 = very smooth. */
export function smooth(points: { x: number; y: number }[], k: number) {
  if (k <= 0 || points.length < 3) return points;
  let m = points[0]!.y, debias = 0;
  return points.map((p, i) => {
    m = k * m + (1 - k) * p.y;
    debias = 1 - k ** (i + 1);
    return { x: p.x, y: m / debias };
  });
}

function ticks(lo: number, hi: number, n = 4): number[] {
  if (!(hi > lo)) return [lo];
  const step0 = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const short = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(a >= 10 ? 1 : 2);
  if (a >= 0.001) return v.toPrecision(2);
  return v.toExponential(0);
};

/**
 * A line chart over steps. Hover (or touch) shows a crosshair and every series' value at that
 * step. `log` plots y on a log scale (for losses that fall by orders of magnitude).
 */
export function LineChart({ lines, height = 180, log = false, xLabel = "step", yFormat = short, marks = [] }: {
  lines: Line[];
  height?: number;
  log?: boolean;
  xLabel?: string;
  yFormat?: (v: number) => string;
  /** Vertical markers, e.g. epochs or the best step. */
  marks?: { x: number; label: string }[];
}) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = height, L = 44, R = 10, T = 8, B = 22;
  const usable = lines.filter((l) => l.points.length);
  const { x0, x1, y0, y1 } = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const l of usable) for (const p of l.points) {
      if (log && p.y <= 0) continue;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    if (!Number.isFinite(x0)) return { x0: 0, x1: 1, y0: 0, y1: 1 };
    if (x1 === x0) x1 = x0 + 1;
    if (log) { y0 = Math.log10(y0); y1 = Math.log10(y1); }
    const pad = (y1 - y0) * 0.06 || Math.abs(y1) * 0.1 || 1;
    return { x0, x1, y0: y0 - pad, y1: y1 + pad };
  }, [usable, log]);
  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const sy = (y: number) => T + (1 - ((log ? Math.log10(Math.max(y, 1e-12)) : y) - y0) / (y1 - y0)) * (H - T - B);
  const yt = log ? ticks(Math.floor(y0), Math.ceil(y1), 4).filter((v) => Number.isInteger(v) && v >= y0 && v <= y1) : ticks(y0, y1);
  const xt = ticks(x0, x1, 5);

  const at = (x: number) => usable.map((l) => {
    let best = l.points[0]!, d = Infinity;
    for (const p of l.points) { const dd = Math.abs(p.x - x); if (dd < d) { d = dd; best = p; } }
    return { l, p: best };
  });
  const move = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const x = x0 + ((clientX - r.left) / r.width * W - L) / (W - L - R) * (x1 - x0);
    setHover(Math.max(x0, Math.min(x1, x)));
  };
  const hits = hover == null ? [] : at(hover);
  const hx = hits.length ? hits.reduce((a, h) => (Math.abs(h.p.x - hover!) < Math.abs(a - hover!) ? h.p.x : a), hits[0]!.p.x) : 0;

  if (!usable.length) return <div className="lab-empty" style={{ height }}>No data yet</div>;
  return (
    <div className="lab-chart">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Chart of ${usable.map((l) => l.label).join(", ")}`}
        onPointerMove={(e) => move(e.clientX)} onPointerDown={(e) => move(e.clientX)} onPointerLeave={() => setHover(null)}>
        {yt.map((v) => {
          const y = log ? T + (1 - (v - y0) / (y1 - y0)) * (H - T - B) : sy(v);
          return <g key={v}><line x1={L} x2={W - R} y1={y} y2={y} className="grid" /><text x={L - 6} y={y + 3} className="tick" textAnchor="end">{log ? short(10 ** v) : yFormat(v)}</text></g>;
        })}
        {xt.map((v) => <text key={v} x={sx(v)} y={H - 6} className="tick" textAnchor="middle">{short(v)}</text>)}
        <text x={W - R} y={H - 6} className="tick" textAnchor="end" opacity={0.7}>{xLabel}</text>
        {marks.map((m) => <g key={m.label + m.x}><line x1={sx(m.x)} x2={sx(m.x)} y1={T} y2={H - B} className="mark" /><text x={sx(m.x) + 3} y={T + 9} className="tick">{m.label}</text></g>)}
        {usable.map((l) => (
          <polyline key={l.key} fill="none" stroke={l.colour} strokeWidth={2} strokeDasharray={l.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round"
            points={l.points.filter((p) => !log || p.y > 0).map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")} />
        ))}
        {/* Few points: mark each one (a single point draws no line); many: mark only the latest. */}
        {usable.map((l) => (l.points.length <= 12 ? l.points : l.points.slice(-1)).map((p, i) => <circle key={`${l.key}-${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3} fill={l.colour} />))}
        {hover != null && (
          <g>
            <line x1={sx(hx)} x2={sx(hx)} y1={T} y2={H - B} className="cross" />
            {hits.map(({ l, p }) => <circle key={l.key} cx={sx(p.x)} cy={sy(p.y)} r={4} fill={l.colour} stroke="var(--panel)" strokeWidth={2} />)}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="lab-tip" style={{ left: `${Math.min(70, (sx(hx) / W) * 100)}%` }}>
          <div className="muted">{xLabel} {short(hx)}</div>
          {hits.map(({ l, p }) => <div key={l.key}><i style={{ background: l.colour }} className={l.dashed ? "dash" : ""} />{l.label} <b>{yFormat(p.y)}</b></div>)}
        </div>
      )}
      {usable.length > 1 && (
        <div className="lab-legend">
          {usable.map((l) => <span key={l.key}><i style={{ background: l.colour }} className={l.dashed ? "dash" : ""} />{l.label}</span>)}
        </div>
      )}
    </div>
  );
}

export function Sparkline({ points, colour = "var(--s1)", width = 90, height = 22 }: { points: { x: number; y: number }[]; colour?: string; width?: number; height?: number }) {
  if (points.length < 2) return <svg width={width} height={height} aria-hidden />;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const sx = (x: number) => 1 + ((x - x0) / (x1 - x0 || 1)) * (width - 2), sy = (y: number) => 2 + (1 - (y - y0) / (y1 - y0 || 1)) * (height - 4);
  return (
    <svg width={width} height={height} aria-hidden className="lab-spark">
      <polyline fill="none" stroke={colour} strokeWidth={1.5} points={points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")} />
    </svg>
  );
}

/**
 * Per-class values as horizontal bars, one row per class, with one bar per compared source
 * (runs or evals) in series colours.
 */
export function ClassBars({ classes, sources, max = 1, format = (v: number) => `${(v * 100).toFixed(0)}%` }: {
  classes: string[];
  sources: { label: string; colour: string; values: Record<string, number | null> }[];
  max?: number;
  format?: (v: number) => string;
}) {
  return (
    <div className="lab-bars">
      {classes.map((c) => (
        <div key={c} className="row">
          <span className="cls">{c}</span>
          <div className="bars">
            {sources.map((s) => {
              const v = s.values[c];
              return (
                <div key={s.label} className="bar" title={`${s.label}: ${c} ${v == null ? "–" : format(v)}`}>
                  <span style={{ width: `${v == null ? 0 : Math.max(0, Math.min(1, v / max)) * 100}%`, background: s.colour }} />
                  <em>{v == null ? "–" : format(v)}</em>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {sources.length > 1 && <div className="lab-legend">{sources.map((s) => <span key={s.label}><i style={{ background: s.colour }} />{s.label}</span>)}</div>}
    </div>
  );
}

/**
 * A confusion matrix: rows are the truth, columns the prediction. Each row is shaded by its own
 * share (so small classes still read), and the diagonal is outlined: off-diagonal heat is error.
 */
export function Confusion({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const rowSums = matrix.map((r) => r.reduce((a, b) => a + b, 0));
  const share = (i: number, j: number) => (rowSums[i] ? matrix[i]![j]! / rowSums[i]! : 0);
  const n = labels.length;
  return (
    <div className="lab-confusion">
      <table>
        <thead>
          <tr><th className="corner">truth ↓ · predicted →</th>{labels.map((l) => <th key={l}>{l}</th>)}<th>right</th></tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <th>{l}</th>
              {labels.map((_, j) => {
                const s = share(i, j);
                return (
                  <td key={j} className={i === j ? "diag" : ""} onPointerEnter={() => setHover([i, j])} onPointerLeave={() => setHover(null)}
                    style={{ background: `color-mix(in oklab, ${i === j ? "var(--s3)" : "var(--s2)"} ${Math.round(s * 100)}%, var(--panel))` }}>
                    {s >= 0.005 ? `${Math.round(s * 100)}` : ""}
                  </td>
                );
              })}
              <td className="sum">{rowSums[i] ? `${Math.round(share(i, i) * 100)}%` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        {hover
          ? `${Math.round(share(hover[0], hover[1]) * 100)}% of ${labels[hover[0]]} pixels (${matrix[hover[0]]![hover[1]]!.toLocaleString()}) were predicted ${labels[hover[1]]}.`
          : `Each row is one true class, split by what the model said. Green diagonal = right; orange = mistakes. ${n} classes.`}
      </p>
    </div>
  );
}

/** A labelled number with an optional change against a baseline, coloured by whether it's better. */
export function Stat({ label, value, delta, better, help, children }: {
  label: string;
  value: string;
  delta?: number | null;
  better?: "lower" | "higher";
  help?: string;
  children?: ReactNode;
}) {
  const good = delta == null || !better || delta === 0 ? null : (delta > 0) === (better === "higher");
  return (
    <div className="lab-stat" title={help}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {delta != null && Number.isFinite(delta) && delta !== 0 && (
        <span className={`delta ${good == null ? "" : good ? "good" : "bad"}`}>{delta > 0 ? "▲" : "▼"} {delta > 0 ? "+" : ""}{Math.abs(delta) < 1 ? delta.toPrecision(2) : delta.toFixed(1)}</span>
      )}
      {children}
    </div>
  );
}
