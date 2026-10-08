import type { LookParams } from "./params.ts";

// The colour grade is baked into a 3D LUT on the CPU whenever a grade parameter changes, and
// applied on the GPU after tone mapping (display-referred values). Baking keeps the per-pixel
// cost to one texture lookup however many grading controls we add, and a loaded `.cube` file
// could later replace or stack with it.

export const LUT_SIZE = 32;

export type Grade = LookParams["grade"];
type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const v = Number.parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Luminance-normalised tint, so tinting shifts hue without brightening or darkening. */
export function normTint(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex);
  const l = Math.max(luma(r, g, b), 1e-3);
  return [r / l, g / l, b / l];
}

/** A place tint that changes nothing. */
export const NEUTRAL_TINT: Readonly<RGB> = [1, 1, 1];

/**
 * Applies the grade to one display-referred colour. Exposed for tests. `place` is the place's
 * colour as a `normTint`, leaned toward by `g.placeTint` in the midtones.
 */
export function gradeColor(g: Grade, input: RGB, place: Readonly<RGB> = NEUTRAL_TINT): RGB {
  let [r, gr, b] = input;
  // White balance as channel gains.
  r *= 1 + 0.12 * g.temperature;
  b *= 1 - 0.12 * g.temperature;
  gr *= 1 - 0.08 * g.tint;
  // Lift / gamma / gain.
  const lgg = (v: number) => Math.pow(Math.max(g.gain * (v + g.lift * (1 - v)), 0), 1 / g.gamma);
  r = lgg(r);
  gr = lgg(gr);
  b = lgg(b);
  // Contrast about mid grey.
  r = (r - 0.5) * g.contrast + 0.5;
  gr = (gr - 0.5) * g.contrast + 0.5;
  b = (b - 0.5) * g.contrast + 0.5;
  // Saturation.
  const l = luma(r, gr, b);
  r = l + (r - l) * g.saturation;
  gr = l + (gr - l) * g.saturation;
  b = l + (b - l) * g.saturation;
  // Split toning: cool shadows, warm highlights (or whatever the tints say).
  if (g.splitToneAmount > 0) {
    const s = normTint(g.shadowTint);
    const h = normTint(g.highlightTint);
    const lc = clamp01(l);
    const ws = g.splitToneAmount * (1 - lc) * (1 - lc);
    const wh = g.splitToneAmount * lc * lc;
    r *= 1 + ws * (s[0] - 1) + wh * (h[0] - 1);
    gr *= 1 + ws * (s[1] - 1) + wh * (h[1] - 1);
    b *= 1 + ws * (s[2] - 1) + wh * (h[2] - 1);
  }
  // The place's own colour, strongest in the midtones so whites and blacks stay put.
  if (g.placeTint > 0) {
    const lc = clamp01(l);
    const w = g.placeTint * 4 * lc * (1 - lc);
    r *= 1 + w * (place[0] - 1);
    gr *= 1 + w * (place[1] - 1);
    b *= 1 + w * (place[2] - 1);
  }
  return [clamp01(r), clamp01(gr), clamp01(b)];
}

/**
 * Bakes the grade into RGBA8 texels, red fastest, then green, then blue (3D texture order).
 * Same arithmetic as `gradeColor`, arranged for speed: the per-channel steps (white balance,
 * lift/gamma/gain, contrast) are tabulated once per axis, and the tints parsed once per bake.
 */
export function bakeLut(g: Grade, size = LUT_SIZE, out = new Uint8Array(size * size * size * 4), place: Readonly<RGB> = NEUTRAL_TINT) {
  const max = size - 1;
  const lgg = (v: number) => Math.pow(Math.max(g.gain * (v + g.lift * (1 - v)), 0), 1 / g.gamma);
  const axis = (gain: number) =>
    Float64Array.from({ length: size }, (_, i) => (lgg((i / max) * gain) - 0.5) * g.contrast + 0.5);
  const R = axis(1 + 0.12 * g.temperature);
  const G = axis(1 - 0.08 * g.tint);
  const B = axis(1 - 0.12 * g.temperature);
  const split = g.splitToneAmount > 0;
  const st = split ? normTint(g.shadowTint) : NEUTRAL_TINT;
  const ht = split ? normTint(g.highlightTint) : NEUTRAL_TINT;
  const sat = g.saturation;
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let r = R[x]!, gr = G[y]!, b = B[z]!;
        const l = luma(r, gr, b);
        r = l + (r - l) * sat;
        gr = l + (gr - l) * sat;
        b = l + (b - l) * sat;
        const lc = clamp01(l);
        if (split) {
          const ws = g.splitToneAmount * (1 - lc) * (1 - lc);
          const wh = g.splitToneAmount * lc * lc;
          r *= 1 + ws * (st[0] - 1) + wh * (ht[0] - 1);
          gr *= 1 + ws * (st[1] - 1) + wh * (ht[1] - 1);
          b *= 1 + ws * (st[2] - 1) + wh * (ht[2] - 1);
        }
        if (g.placeTint > 0) {
          const w = g.placeTint * 4 * lc * (1 - lc);
          r *= 1 + w * (place[0] - 1);
          gr *= 1 + w * (place[1] - 1);
          b *= 1 + w * (place[2] - 1);
        }
        out[i++] = Math.round(clamp01(r) * 255);
        out[i++] = Math.round(clamp01(gr) * 255);
        out[i++] = Math.round(clamp01(b) * 255);
        out[i++] = 255;
      }
    }
  }
  return out;
}
