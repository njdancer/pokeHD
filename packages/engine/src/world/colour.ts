// Colour maths for p1-colour: OKLab/OKLCh conversions and hue-shifted ramps, so a single
// Super Game Boy colour can grow into a four-shade ramp that shades warm and cool.

export interface Lch {
  /** Lightness, 0–1. */
  l: number;
  /** Chroma, 0 to about 0.37. */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

export function hexToLch(hex: number): Lch {
  const r = toLinear(((hex >> 16) & 255) / 255);
  const g = toLinear(((hex >> 8) & 255) / 255);
  const b = toLinear((hex & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h };
}

function lchToLinear({ l: L, c, h }: Lch): [number, number, number] {
  const A = c * Math.cos((h * Math.PI) / 180);
  const B = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Back to 0xRRGGBB, giving up chroma (not lightness or hue) to stay inside sRGB. */
export function lchToHex(lch: Lch): number {
  let rgb = lchToLinear(lch);
  const inGamut = (v: number[]) => v.every((x) => x >= -1e-4 && x <= 1 + 1e-4);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = lch.c;
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchToLinear({ ...lch, c: mid }))) lo = mid;
      else hi = mid;
    }
    rgb = lchToLinear({ ...lch, c: lo });
  }
  const [r, g, b] = rgb.map((v) => Math.round(toSrgb(Math.min(Math.max(v, 0), 1)) * 255));
  return (r! << 16) | (g! << 8) | b!;
}

/** Moves hue `h` up to `by` degrees toward `target` along the shorter way round. */
export function shiftHue(h: number, target: number, by: number): number {
  const d = ((target - h + 540) % 360) - 180;
  const out = h + Math.sign(d) * Math.min(Math.abs(d), by);
  return (out + 360) % 360;
}

/** Highlights lean toward yellow, shadows toward blue-violet: the usual pixel-art hue shift. */
export const WARM_HUE = 85;
export const COOL_HUE = 275;

/** One shade of a ramp: lightness, chroma, and how far its hue leans warm (+) or cool (−). */
export interface RampStep {
  l: number;
  c: number;
  lean: number;
}

/** A four-shade ramp around one hue, lightest first. */
export function hueRamp(hue: number, steps: readonly [RampStep, RampStep, RampStep, RampStep]) {
  return steps.map(({ l, c, lean }) =>
    lchToHex({ l, c, h: lean >= 0 ? shiftHue(hue, WARM_HUE, lean) : shiftHue(hue, COOL_HUE, -lean) }),
  ) as unknown as readonly [number, number, number, number];
}
