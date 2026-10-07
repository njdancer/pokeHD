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
function normTint(hex: string): RGB {
  const [r, g, b] = hexToRgb(hex);
  const l = Math.max(luma(r, g, b), 1e-3);
  return [r / l, g / l, b / l];
}

/** Applies the grade to one display-referred colour. Exposed for tests. */
export function gradeColor(g: Grade, input: RGB): RGB {
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
  return [clamp01(r), clamp01(gr), clamp01(b)];
}

/** Bakes the grade into RGBA8 texels, red fastest, then green, then blue (3D texture order). */
export function bakeLut(g: Grade, size = LUT_SIZE, out = new Uint8Array(size * size * size * 4)) {
  const max = size - 1;
  let i = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [r, gr, b] = gradeColor(g, [x / max, y / max, z / max]);
        out[i++] = Math.round(r * 255);
        out[i++] = Math.round(gr * 255);
        out[i++] = Math.round(b * 255);
        out[i++] = 255;
      }
    }
  }
  return out;
}
