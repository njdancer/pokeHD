// Sample layers (LAB-CONTRACT "Layer encodings") decoded to numbers and to pictures, plus the 3D
// built from them. Pure functions over pixel arrays; the browser-only PNG decode is `readPixels`.
import { LAB_FACES, type LabEncoding } from "@pokehd/protocol";
import { FRONT, hip, normalColour, normalise, slope, TOP, type Normal } from "../../tools/relief/normals.ts";
import type { Mesh } from "../../tools/relief/shape.ts";

/** A decoded layer: RGBA pixels as stored, plus float data for `.f32` depth. */
export interface Pixels {
  width: number;
  height: number;
  rgba?: Uint8ClampedArray;
  f32?: Float32Array;
}

/** The faces' directions, at the relief plan's 45° for slopes and hips. */
export const FACE_NORMALS: Normal[] = [TOP, FRONT, slope(45), hip(-1, 45), hip(1, 45)];
export const faceName = (v: number) => LAB_FACES[v] ?? (v === 255 ? "none" : `?${v}`);

/** The value at a pixel, in words, for the hover readout. */
export function describe(p: Pixels, enc: LabEncoding, x: number, y: number): string {
  const i = y * p.width + x;
  if (enc === "depth") { const d = p.f32?.[i]; return d == null || Number.isNaN(d) ? "no surface" : `depth ${d.toFixed(1)} px`; }
  const px = p.rgba;
  if (!px) return "";
  const [r, g, b, a] = [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3]!];
  switch (enc) {
    case "faces": return faceName(r);
    case "normals": return a === 0 ? "no surface" : `(${[r, g, b].map((v) => ((v - 127.5) / 127.5).toFixed(2)).join(", ")})`;
    case "shades": return `shade ${[255, 170, 85, 0].indexOf(r) >= 0 ? [255, 170, 85, 0].indexOf(r) : r}`;
    case "mask": return ["background", "object", "ground"][r] ?? String(r);
    case "error": return `error ${Math.round((Math.max(r, g, b) / 255) * 100)}%`;
    default: return `rgb(${r}, ${g}, ${b})`;
  }
}

/** The direction a pixel faces, from a `faces` or `normals` layer, or null for none. */
export function normalAt(p: Pixels, enc: LabEncoding, i: number): Normal | null {
  const px = p.rgba;
  if (!px) return null;
  if (enc === "faces") return FACE_NORMALS[px[i * 4]!] ?? null;
  if (enc === "normals") {
    if (px[i * 4 + 3] === 0) return null;
    return normalise([(px[i * 4]! - 127.5) / 127.5, (px[i * 4 + 1]! - 127.5) / 127.5, (px[i * 4 + 2]! - 127.5) / 127.5]);
  }
  return null;
}

/** Depth range of a `.f32` layer, ignoring NaN. */
export function depthRange(f: Float32Array): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const d of f) if (!Number.isNaN(d)) { lo = Math.min(lo, d); hi = Math.max(hi, d); }
  return Number.isFinite(lo) ? [lo, hi] : [0, 1];
}

/**
 * A layer as a picture to show: faces and normals in the relief editor's normal colours (top
 * reads green, front blue), depth as near-bright/far-dark blue, masks in fixed colours.
 */
export function toImage(p: Pixels, enc: LabEncoding): Uint8ClampedArray<ArrayBuffer> {
  const n = p.width * p.height, out = new Uint8ClampedArray(n * 4);
  const px = p.rgba;
  if (enc === "depth" && p.f32) {
    const [lo, hi] = depthRange(p.f32);
    for (let i = 0; i < n; i++) {
      const d = p.f32[i]!;
      if (Number.isNaN(d)) { out.set([20, 24, 30, 255], i * 4); continue; }
      const t = hi > lo ? (d - lo) / (hi - lo) : 0.5;
      out.set([Math.round(28 + t * 160), Math.round(66 + t * 150), Math.round(130 + t * 125), 255], i * 4);
    }
    return out;
  }
  if (!px) return out;
  for (let i = 0; i < n; i++) {
    const v = px[i * 4]!;
    if (enc === "faces") {
      const nn = FACE_NORMALS[v];
      out.set(nn ? [...normalColour(nn), 255] : [20, 24, 30, 255], i * 4);
    } else if (enc === "normals") {
      out.set(px[i * 4 + 3] === 0 ? [20, 24, 30, 255] : [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, 255], i * 4);
    } else if (enc === "mask") {
      out.set(([[20, 24, 30], [230, 200, 90], [90, 160, 90]][v] ?? [255, 0, 255]).concat(255), i * 4);
    } else {
      out.set([px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3] === 0 ? 0 : 255], i * 4);
    }
  }
  return out;
}

/**
 * Where two face or normal layers disagree: 0 agree, 1 disagree, NaN where either has none.
 * Normals disagree beyond `degrees`.
 */
export function disagreement(a: Pixels, encA: LabEncoding, b: Pixels, encB: LabEncoding, degrees = 20): Float32Array {
  const n = a.width * a.height, out = new Float32Array(n), cos = Math.cos((degrees * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    if (encA === "faces" && encB === "faces") {
      const va = a.rgba![i * 4]!, vb = b.rgba![i * 4]!;
      out[i] = va === 255 || vb === 255 ? NaN : va === vb ? 0 : 1;
      continue;
    }
    const na = normalAt(a, encA, i), nb = normalAt(b, encB, i);
    out[i] = !na || !nb ? NaN : na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2] >= cos ? 0 : 1;
  }
  return out;
}

/** Per-face pixel counts and agreement between a truth and a prediction faces layer. */
export function faceAgreement(truth: Pixels, pred: Pixels): { face: string; pixels: number; right: number }[] {
  const rows = LAB_FACES.map((face) => ({ face: face as string, pixels: 0, right: 0 }));
  const t = truth.rgba!, p = pred.rgba!;
  for (let i = 0; i < truth.width * truth.height; i++) {
    const r = rows[t[i * 4]!];
    if (!r) continue;
    r.pixels++;
    if (p[i * 4] === t[i * 4]) r.right++;
  }
  return rows;
}

/**
 * Ground pixels for the map 3D when the sample has no mask: a top-facing pixel is ground when the
 * pixel below it is ground too (or it's the bottom row), so a table top above its front stays
 * raised. An estimate: floor seen just behind a raised object is lifted with it.
 */
export function groundFromNormals(width: number, height: number, normal: (x: number, y: number) => Normal | null): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) for (let y = height - 1; y >= 0; y--) {
    const n = normal(x, y);
    const top = !!n && n[1] > 0.9;
    g[y * width + x] = top && (y === height - 1 || g[(y + 1) * width + x] === 1) ? 1 : 0;
  }
  return g;
}

/**
 * A picture's mesh from per-pixel depth (pixels towards the viewer): one quad per pixel, its corners
 * shared with neighbours at a similar depth and torn where depth jumps more than `tear` pixels, so
 * a head can sit behind a belly. Shaded by `normal` when given, else by the depth's own slope.
 */
export function depthMesh(width: number, height: number, depth: Float32Array, colour: (x: number, y: number) => readonly [number, number, number], normal?: (x: number, y: number) => Normal | null, tear = 2.5): Mesh {
  const m: Mesh = { positions: [], normals: [], colours: [] };
  const d = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? NaN : depth[y * width + x]!);
  // A corner's depth for pixel (x, y): the mean of the pixels around it within `tear` of this one.
  const corner = (x: number, y: number, cx: number, cy: number) => {
    const own = d(x, y);
    let s = 0, n = 0;
    for (const [px, py] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as const) {
      const v = d(px, py);
      if (!Number.isNaN(v) && Math.abs(v - own) <= tear) { s += v; n++; }
    }
    return n ? s / n : own;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const own = d(x, y);
    if (Number.isNaN(own)) continue;
    const X = x - width / 2, Y = height / 2 - y;
    const a = [X, Y - 1, corner(x, y, x, y + 1)], b = [X + 1, Y - 1, corner(x, y, x + 1, y + 1)], c = [X + 1, Y, corner(x, y, x + 1, y)], e = [X, Y, corner(x, y, x, y)];
    let n = normal?.(x, y) ?? null;
    if (!n) {
      const dx = (b[2]! + c[2]! - a[2]! - e[2]!) / 2, dy = (e[2]! + c[2]! - a[2]! - b[2]!) / 2;
      n = normalise([-dx, -dy, 1]);
    }
    const rgb = colour(x, y);
    for (const p of [a, b, c, a, c, e]) { m.positions.push(p[0]!, p[1]!, p[2]!); m.normals.push(n[0], n[1], n[2]); m.colours.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); }
  }
  return m;
}

/** Decodes a PNG (or other image) to RGBA without colour management, so values stay exact. */
export async function readPixels(bytes: ArrayBuffer, type = "image/png"): Promise<Pixels> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  const data = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
  bitmap.close();
  return { width: canvas.width, height: canvas.height, rgba: data };
}

export async function decodeLayer(bytes: ArrayBuffer, enc: LabEncoding, width: number, height: number, path: string): Promise<Pixels> {
  if (enc === "depth" || path.endsWith(".f32")) {
    const f32 = new Float32Array(bytes.slice(0, Math.floor(bytes.byteLength / 4) * 4));
    return { width, height, f32 };
  }
  return readPixels(bytes, path.endsWith(".webp") ? "image/webp" : path.endsWith(".jpg") ? "image/jpeg" : "image/png");
}
