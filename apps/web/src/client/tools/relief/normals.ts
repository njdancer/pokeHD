// Hand-painted surface directions (normals) for the relief editor (/tools/relief).
//
// Training material only: the game never reads these. They're saved to Nick's account for the
// editor and exported for local processing (training the small runtime model). See D38 in
// docs/DECISIONS.md.
//
// A normal is a direction in world space: x to the right, y up, z towards the viewer (south).
// Top of a table is (0, 1, 0); the front of a shelf is (0, 0, 1).
import type { Label } from "@pokehd/rom";

export type Normal = readonly [number, number, number];

export const TOP: Normal = [0, 1, 0];
export const FRONT: Normal = [0, 0, 1];

/** A roof-like slope, rising away from the viewer at `degrees`. */
export function slope(degrees: number): Normal {
  const a = (degrees * Math.PI) / 180;
  return [0, Math.cos(a), Math.sin(a)];
}

/** A hip: a roof end that slopes down towards the left (`side` -1) or right (+1) at `degrees`. */
export function hip(side: -1 | 1, degrees: number): Normal {
  const a = (degrees * Math.PI) / 180;
  return [side * Math.sin(a), Math.cos(a), 0];
}

export function normalise(n: Normal): Normal {
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/** Labels whose tiles lie flat on the ground. Walking up a column resets to ground level on these. */
export const GROUND_LABELS: ReadonlySet<Label> = new Set<Label>([
  "ground", "lawn", "tall-grass", "flower", "water", "shore", "bridge", "floor", "void", "unused",
]);

/** A first guess from our labels, so painting starts from something close. */
export function seedNormal(label: Label | undefined, roofDegrees = 45): Normal {
  if (!label) return FRONT;
  if (GROUND_LABELS.has(label) || label === "table" || label === "counter") return TOP;
  if (label === "roof" || label === "stairs") return slope(roofDegrees);
  return FRONT;
}

/** One Pokémon or trainer picture's normals: a dome from its silhouette, so it starts puffy. */
export function domeNormals(width: number, height: number, inside: (x: number, y: number) => boolean): Normal[] {
  // Distance to the outside (4-neighbour BFS), then height = sqrt(distance).
  const dist = new Float32Array(width * height).fill(Infinity);
  const queue: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x, y)) { dist[y * width + x] = 0; queue.push(y * width + x); }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!, x = i % width, y = (i / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (dist[j]! > dist[i]! + 1) { dist[j] = dist[i]! + 1; queue.push(j); }
    }
  }
  for (let i = 0; i < dist.length; i++) if (dist[i] === Infinity) dist[i] = Math.max(width, height);
  const z = (x: number, y: number) => {
    x = Math.max(0, Math.min(width - 1, x)); y = Math.max(0, Math.min(height - 1, y));
    return Math.sqrt(dist[y * width + x]!) * 2;
  };
  const out: Normal[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x, y)) { out.push(FRONT); continue; }
    const dzdx = (z(x + 1, y) - z(x - 1, y)) / 2, dzdy = (z(x, y + 1) - z(x, y - 1)) / 2;
    // Picture y runs down; world y runs up, so the y slope flips.
    out.push(normalise([-dzdx, dzdy, 1]));
  }
  return out;
}

// Storage: three signed bytes per pixel (×127), base64.
export function encode(normals: readonly Normal[]): string {
  const bytes = new Uint8Array(normals.length * 3);
  normals.forEach((n, i) => { for (let k = 0; k < 3; k++) bytes[i * 3 + k] = Math.round(Math.max(-1, Math.min(1, n[k]!)) * 127) & 0xff; });
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function decode(text: string): Normal[] {
  const s = atob(text), out: Normal[] = [];
  const v = (i: number) => ((s.charCodeAt(i) << 24) >> 24) / 127;
  for (let i = 0; i + 2 < s.length; i += 3) out.push(normalise([v(i), v(i + 1), v(i + 2)]));
  return out;
}

/** What the editor saves: only what's been painted. Keys are tileset names and picture names. */
export interface ReliefDoc {
  version: 1;
  /** Tileset name → tile ID → 64 normals (row-major), base64. */
  tiles: Record<string, Record<string, string>>;
  /** Picture key (e.g. "mon:25", "trainer:BrockPic") → its normals, base64. */
  pics: Record<string, { width: number; height: number; normals: string }>;
  updatedAt?: string;
}

export const emptyDoc = (): ReliefDoc => ({ version: 1, tiles: {}, pics: {} });

/** Normal-map colour for showing a normal: RGB = xyz × ½ + ½, so top reads green and front reads blue. */
export function normalColour(n: Normal): [number, number, number] {
  return [Math.round((n[0] * 0.5 + 0.5) * 255), Math.round((n[1] * 0.5 + 0.5) * 255), Math.round((n[2] * 0.5 + 0.5) * 255)];
}
