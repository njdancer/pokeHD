// Links into the relief editor (/tools/relief), e.g. from the relief lab dashboard. Kept free of
// heavy imports so the dashboard can build them without pulling in the editor.

export interface ReliefLinkOptions {
  /** A map by its name in MAP_NAMES, with an area in 32-pixel blocks: [bx, by, bw, bh]. */
  map?: string;
  area?: [number, number, number, number];
  /** A Pokémon picture by dex number. */
  dex?: number;
  /** Prefill from a lab prediction: manifest path under `lab/`, sample id and layer name. */
  seed?: string;
  sample?: string;
  layer?: string;
}

export function reliefLink(opts: ReliefLinkOptions): string {
  const q = new URLSearchParams();
  if (opts.map) { q.set("map", opts.map); if (opts.area) q.set("area", opts.area.join(",")); }
  else if (opts.dex !== undefined) q.set("dex", String(opts.dex));
  if (opts.seed) { q.set("seed", opts.seed); if (opts.sample) q.set("sample", opts.sample); if (opts.layer) q.set("layer", opts.layer); }
  const s = q.toString();
  return s ? `/tools/relief?${s}` : "/tools/relief";
}

/** The other way: what a link asks for. Malformed parts are dropped. */
export function parseReliefLink(search: string): ReliefLinkOptions {
  const q = new URLSearchParams(search), out: ReliefLinkOptions = {};
  const map = q.get("map"), area = q.get("area")?.split(",").map(Number), dex = Number(q.get("dex"));
  if (map) { out.map = map; if (area?.length === 4 && area.every(Number.isInteger)) out.area = area as [number, number, number, number]; }
  else if (q.has("dex") && Number.isInteger(dex)) out.dex = dex;
  for (const k of ["seed", "sample", "layer"] as const) { const v = q.get(k); if (v) out[k] = v; }
  return out;
}
