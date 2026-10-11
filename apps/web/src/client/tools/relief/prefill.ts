// Prefilling the relief editor from a relief lab prediction (docs/relief-ml/LAB-CONTRACT.md): the
// dashboard links here with a sample manifest, a sample and a layer; its pixels become a first guess
// for whatever Nick hasn't painted yet.
import type { LabEncoding, LabSampleSet } from "@pokehd/protocol";
import { FRONT, hip, normalise, slope, TOP, type Normal } from "./normals.ts";

/** One pixel's prediction, or null where the layer says there's no surface. */
export type Prediction = (Normal | null)[];

export interface PickedLayer { file: string; encoding: LabEncoding; label: string; title: string }

/**
 * Finds `sample`'s file for `layer` in a manifest fetched from `manifestPath` (a path under `lab/`).
 * The file path comes back relative to `lab/`. Returns a reason string when it isn't there.
 */
export function pickLayer(manifest: unknown, manifestPath: string, sample: string, layer: string): PickedLayer | string {
  const m = manifest as Partial<LabSampleSet> | null;
  if (!m || typeof m !== "object" || m.schema !== 1 || !Array.isArray(m.items) || !m.layers) return "the manifest isn't one the editor can read";
  const def = m.layers[layer];
  if (!def) return `the manifest has no layer "${layer}"`;
  const item = m.items.find((i) => i.id === sample);
  if (!item) return `the manifest has no sample "${sample}"`;
  const rel = item.files?.[layer];
  if (!rel) return `sample "${sample}" has no ${def.label} file`;
  const dir = manifestPath.includes("/") ? manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1) : "";
  return { file: dir + rel, encoding: def.encoding, label: def.label, title: m.title ?? manifestPath };
}

/** Pixels (RGBA, as from getImageData) → normals, for the encodings that are directions; null for the rest. */
export function decodeLayer(encoding: LabEncoding, rgba: ArrayLike<number>, pitch: number): Prediction | null {
  const n = rgba.length >> 2, out: Prediction = [];
  if (encoding === "faces") {
    // 0 TOP, 1 FRONT, 2 SLOPE, 3 HIP◀, 4 HIP▶; anything else (255) is no surface.
    const faces: Normal[] = [TOP, FRONT, slope(pitch), hip(-1, pitch), hip(1, pitch)];
    for (let i = 0; i < n; i++) out.push(faces[rgba[i * 4]!] ?? null);
    return out;
  }
  if (encoding === "normals") {
    for (let i = 0; i < n; i++) {
      if (rgba[i * 4 + 3] === 0) { out.push(null); continue; }
      const c = (k: number) => (rgba[i * 4 + k]! - 127.5) / 127.5;
      out.push(normalise([c(0), c(1), c(2)]));
    }
    return out;
  }
  return null;
}

/**
 * A map area's prediction split into tiles: tile id → its 64 pixels (row-major), taken from the
 * first place (reading order) the tile appears. Tiles `skip` says no to are left out.
 */
export function tilesFromPrediction(width: number, height: number, pred: Prediction, tileAt: (tx: number, ty: number) => number, skip: (t: number) => boolean): Map<number, Prediction> {
  const out = new Map<number, Prediction>();
  for (let ty = 0; ty < height >> 3; ty++) for (let tx = 0; tx < width >> 3; tx++) {
    const t = tileAt(tx, ty);
    if (out.has(t) || skip(t)) continue;
    const px: Prediction = [];
    for (let p = 0; p < 64; p++) px.push(pred[(ty * 8 + (p >> 3)) * width + tx * 8 + (p & 7)] ?? null);
    out.set(t, px);
  }
  return out;
}

/** Copies the predicted pixels over `into`, leaving the rest as they were. */
export function overlayPrediction(into: Normal[], pred: Prediction) {
  pred.forEach((n, i) => { if (n && i < into.length) into[i] = n; });
}

/** Fetches a PNG and returns its exact pixels (no colour conversion). Browser only. */
export async function loadPixels(url: string): Promise<{ width: number; height: number; rgba: Uint8ClampedArray }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
  const { width, height } = bmp;
  const c = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : Object.assign(document.createElement("canvas"), { width, height });
  const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return { width, height, rgba: g.getImageData(0, 0, width, height, { colorSpace: "srgb" }).data };
}
