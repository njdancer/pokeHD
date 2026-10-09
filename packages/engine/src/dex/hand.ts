// The hand holding the Pokédex (p2-dex), drawn as pixel art by code: Ash's fingerless glove from
// below, thumb up on the device's face, fingers curled under it. Nick picked the look from
// image-model mock-ups; the game ships only the ROM plus code (no drawn assets), so this redraws
// that look from a few shapes.

export interface HandSprite {
  width: number;
  height: number;
  /** RGBA, row by row from the top: the thumb, drawn in front of the device. */
  front: Uint8ClampedArray;
  /** RGBA: the rest of the hand and the sleeve, drawn behind it. */
  back: Uint8ClampedArray;
  /** The row the device's bottom edge sits on. */
  edge: number;
  /** The thumb's column, for lining it up on the device's face. */
  thumb: number;
}

type RGB = readonly [number, number, number];
/** Each material's tones: shadow, mid, light. */
const GLOVE: RGB[] = [[25, 58, 78], [40, 73, 70], [48, 84, 78]];
const SKIN: RGB[] = [[214, 150, 116], [250, 197, 161], [255, 222, 196]];
const SLEEVE: RGB[] = [[25, 52, 84], [38, 78, 114], [58, 104, 146]];
const OUTLINE: RGB = [3, 4, 10];
const CREASE: RGB = [29, 38, 58];

const W = 56;
const H = 50;
const EDGE = 20;

/** Light from the top left, as a unit vector (y down). */
const LX = -0.6;
const LY = -0.8;

interface Shape {
  /** How far inside (≥ 0) and how lit (−1 … 1) a pixel centre is, or null outside. */
  at(x: number, y: number): { lit: number } | null;
  tones(x: number, y: number): RGB[];
  front?: boolean;
}

/** A capsule from a to b, its radius tapering from ra to rb. */
function capsule(a: [number, number], b: [number, number], ra: number, rb: number, tones: (x: number, y: number) => RGB[], front = false): Shape {
  const [ax, ay] = a;
  const dx = b[0] - ax;
  const dy = b[1] - ay;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  return {
    front,
    tones,
    at(x, y) {
      const t = Math.max(0, Math.min(len, (x - ax) * ux + (y - ay) * uy));
      const qx = x - (ax + ux * t);
      const qy = y - (ay + uy * t);
      const r = ra + (rb - ra) * (t / len);
      const d = Math.hypot(qx, qy);
      return d > r ? null : { lit: (qx * LX + qy * LY) / r };
    },
  };
}

function ellipse(cx: number, cy: number, rx: number, ry: number, tones: RGB[]): Shape {
  return {
    tones: () => tones,
    at(x, y) {
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const d = Math.hypot(nx, ny);
      // Flat in the middle, rounding off towards the rim.
      return d > 1 ? null : { lit: (nx * LX + ny * LY) * Math.min(1, d * 1.6) };
    },
  };
}

/** Draws the hand. Pure, so it can run anywhere and be checked in tests. */
export function drawDexHand(): HandSprite {
  // Earlier shapes are on top.
  const shapes: Shape[] = [
    // The thumb, bare from its last joint.
    capsule([20.5, 21], [24, 3.5], 4.6, 3.6, (_x, y) => (y < 9 ? SKIN : GLOVE), true),
    // Two fingers curled under the device, their tips bare past the glove.
    capsule([36, 24.5], [52, 24.5], 3.4, 3.1, (x) => (x > 43 ? SKIN : GLOVE)),
    capsule([37, 31], [50.5, 31], 3.2, 2.9, (x) => (x > 45 ? SKIN : GLOVE)),
    // The back of the hand, and the sleeve it comes out of.
    ellipse(29, 30, 14.5, 12, GLOVE),
    capsule([14, 43], [22, 34], 7, 7.5, () => GLOVE),
    capsule([-2, 56], [9, 46], 8, 8, () => SLEEVE),
  ];
  const owner = new Int8Array(W * H).fill(-1);
  const colour: RGB[] = new Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i]!;
        const hit = s.at(x + 0.5, y + 0.5);
        if (!hit) continue;
        const tones = s.tones(x + 0.5, y + 0.5);
        colour[y * W + x] = tones[hit.lit > 0.35 ? 2 : hit.lit < -0.45 ? 0 : 1]!;
        owner[y * W + x] = i;
        break;
      }
    }
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && owner[y * W + x]! >= 0;
  // Creases where one shape lies over another (the fingers over the hand, the hand over the
  // sleeve), drawn on the lower shape's side.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = owner[y * W + x]!;
      if (o < 0) continue;
      for (const [nx, ny] of [[x - 1, y], [x, y - 1], [x + 1, y], [x, y + 1]] as const) {
        if (!inside(nx, ny)) continue;
        const n = owner[ny * W + nx]!;
        if (n < o && !shapes[n]!.front) {
          colour[y * W + x] = shapes[o]!.tones(x, y) === SLEEVE ? OUTLINE : CREASE;
          break;
        }
      }
    }
  }
  const front = new Uint8ClampedArray(W * H * 4);
  const back = new Uint8ClampedArray(W * H * 4);
  const put = (layer: Uint8ClampedArray, i: number, [r, g, b]: RGB) => layer.set([r, g, b, 255], i * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = owner[i]!;
      if (o >= 0) {
        put(shapes[o]!.front ? front : back, i, colour[i]!);
        continue;
      }
      // A one-pixel outline round each layer.
      const near = ([[x - 1, y], [x, y - 1], [x + 1, y], [x, y + 1]] as const).filter(([nx, ny]) => inside(nx, ny));
      if (!near.length) continue;
      const toFront = near.some(([nx, ny]) => shapes[owner[ny * W + nx]!]!.front);
      put(toFront ? front : back, i, OUTLINE);
    }
  }
  return { width: W, height: H, front, back, edge: EDGE, thumb: 23 };
}
