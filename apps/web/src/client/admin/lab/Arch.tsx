// The model's architecture as a picture (runlog.describe_model()): each block's output shape and
// parameter count, drawn as a U-Net "U" with its skip connections, block heights scaled by size.
interface Node { id: string; type?: string; out?: number[]; params?: number; layers?: string[] }

export function Arch({ arch }: { arch: Record<string, unknown> }) {
  const nodes = (Array.isArray(arch.nodes) ? arch.nodes : []) as Node[];
  const skips = (Array.isArray(arch.skips) ? arch.skips : []) as [string, string][];
  const params = typeof arch.params === "number" ? arch.params : nodes.reduce((a, n) => a + (n.params ?? 0), 0);
  const bytes = typeof arch.bytes_fp16 === "number" ? arch.bytes_fp16 : params * 2;
  if (!nodes.length) return <pre className="small">{JSON.stringify(arch, null, 1)}</pre>;
  // Depth in the U from the spatial size: smaller pictures sit lower.
  const sizes = nodes.map((n) => (n.out && n.out.length >= 3 ? n.out[n.out.length - 1]! : 0));
  const maxSize = Math.max(...sizes, 1);
  const level = (i: number) => (sizes[i] ? Math.round(Math.log2(maxSize / sizes[i]!)) : 0);
  const levels = Math.max(...nodes.map((_, i) => level(i)), 1);
  const maxCh = Math.max(...nodes.map((n) => n.out?.[0] ?? 1), 1);
  const W = Math.max(560, nodes.length * 84), H = 90 + levels * 56, colW = W / nodes.length;
  const pos = (i: number) => ({ x: colW * (i + 0.5), y: 40 + level(i) * 56 });
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  return (
    <div className="lab-arch">
      <p className="small">
        <b>{params.toLocaleString()}</b> parameters, about <b>{(bytes / 1e6).toFixed(1)} MB</b> as 16-bit weights.
        {Array.isArray(arch.input) && <> Input {(arch.input as number[]).join("×")}.</>} Blocks lower down see a smaller, more zoomed-out picture; the arcs carry fine detail across.
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Model architecture">
        {skips.map(([a, b]) => {
          const i = idx.get(a), j = idx.get(b);
          if (i == null || j == null) return null;
          const p = pos(i), q = pos(j), top = Math.min(p.y, q.y) - 26;
          return <path key={a + b} d={`M${p.x},${p.y - 14} C${p.x},${top} ${q.x},${top} ${q.x},${q.y - 14}`} className="skip" />;
        })}
        {nodes.slice(1).map((_, k) => { const p = pos(k), q = pos(k + 1); return <line key={k} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="flow" />; })}
        {nodes.map((n, i) => {
          const p = pos(i), ch = n.out?.[0] ?? 1, h = 12 + (ch / maxCh) * 20, w = Math.min(colW - 10, 64);
          return (
            <g key={n.id}>
              <title>{`${n.id} (${n.type ?? ""}): out ${n.out?.join("×") ?? "?"}, ${n.params?.toLocaleString() ?? "?"} params${n.layers ? `\n${n.layers.join(", ")}` : ""}`}</title>
              <rect x={p.x - w / 2} y={p.y - h / 2} width={w} height={h} rx={4} className="block" />
              <text x={p.x} y={p.y + 4} textAnchor="middle" className="name">{n.id}</text>
              <text x={p.x} y={p.y + h / 2 + 13} textAnchor="middle" className="tick">{n.out?.join("×")}</text>
              <text x={p.x} y={p.y + h / 2 + 25} textAnchor="middle" className="tick">{n.params != null ? `${n.params >= 1000 ? `${Math.round(n.params / 1000)}k` : n.params}` : ""}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
