// The Pokédex's open animation as Nick tuned it (dashboard/dex-motion.html, p2-dex): the closed
// dex sits upright in the top-right corner as the menu button; tapping it flies it along a bezier
// path to the middle while it grows, untilts, rolls to the way the phone is held and opens its
// cover, each on its own track (delay, duration and cubic-bezier curve). Turning the phone rolls
// the open dex ±90° so its screen goes wide, and the page on it swaps layouts as it turns.
//
// Pure maths, no Three.js: give it the tuned values, the time and the frame, get back a pose. The
// tuner runs the same sums, so what Nick tunes there is what this plays.

export type Curve = [x1: number, y1: number, x2: number, y2: number];
export interface Track {
  delay: number;
  duration: number;
  curve: Curve;
}
export type TrackId = "pressIn" | "pressOut" | "dim" | "blur" | "move" | "scale" | "turn" | "open" | "page";
export interface OpenPose {
  /** How much of the frame the open screen fills, on its tighter side. */
  fill: number;
  /** CSS pixels the open dex sits below the middle. */
  offsetY: number;
}
/** The motion path from the button (0, 0) to the middle (1, 1): each control point a fraction across and down. */
export interface MotionPath {
  c1: [number, number];
  c2: [number, number];
}
export interface DexMotion {
  version: 4;
  tracks: Record<Exclude<TrackId, "pressIn" | "dim" | "blur" | "turn">, Track> & {
    pressIn: Track & { depth: number };
    dim: Track & { amount: number };
    blur: Track & { amount: number };
    turn: Track & { swing: number };
  };
  /** The closed dex (the menu button): its width in CSS pixels, inset from the top-right, tilt in degrees. */
  closed: { width: number; top: number; right: number; tiltX: number; tiltY: number; tiltZ: number };
  /** Portrait's open pose and path. */
  open: OpenPose;
  path: MotionPath;
  close: { speed: number };
  /** Landscape's. */
  landscape: { open: OpenPose; path: MotionPath };
  /** Turning the phone: how long the dex takes to roll over, and its curve. */
  rotate: { duration: number; curve: Curve };
  alerts: Record<string, number | Curve>;
}

/** Nick's tuned values as of 2026-10-11 (dashboard/dex-motion-values.json; a test keeps them equal). */
export const DEX_MOTION: DexMotion = {
  version: 4,
  tracks: {
    pressIn: { delay: 0, duration: 30, curve: [0.2, 0.8, 0.3, 1], depth: 0.1 },
    pressOut: { delay: 50, duration: 50, curve: [0.5, 0, 0.75, 0] },
    dim: { delay: 100, duration: 420, curve: [0.4, 0, 0.2, 1], amount: 0.1 },
    blur: { delay: 100, duration: 480, curve: [0.4, 0, 0.2, 1], amount: 6 },
    move: { delay: 50, duration: 660, curve: [0.113, 0.891, 0.724, 0.334] },
    scale: { delay: 100, duration: 640, curve: [0.2, 0.8, 0.3, 1] },
    turn: { delay: 30, duration: 600, curve: [0.25, 1.1, 0.4, 1], swing: 12 },
    open: { delay: 100, duration: 420, curve: [0, 1.063, 0.29, 0.639] },
    page: { delay: 50, duration: 218, curve: [0.06, 1.112, 0.3, 1] },
  },
  closed: { width: 40, top: 28, right: 23, tiltX: -2, tiltY: -31, tiltZ: 5 },
  open: { fill: 0.94, offsetY: 0 },
  path: { c1: [2.006, 0.424], c2: [1.184, 0.819] },
  close: { speed: 1.4 },
  landscape: { open: { fill: 0.94, offsetY: 0 }, path: { c1: [2.006, 0.424], c2: [1.184, 0.819] } },
  rotate: { duration: 480, curve: [0.3, 0, 0.15, 1] },
  alerts: {
    lights: 1, toast: 1, blinkMs: 1000, glow: 12,
    lid: 0.23, lidMs: 220, lidCurve: [0.3, 0, 0.2, 1],
    toastMs: 380, toastCurve: [0.2, 1.1, 0.3, 1],
    height: 36, font: 14, padX: 10, icon: 21, radius: 8, tuck: 20, offsetY: 5, stack: 6,
  },
};

const clone = <T>(o: T): T => structuredClone(o);
function merge(base: Record<string, unknown>, over: unknown): void {
  if (!over || typeof over !== "object") return;
  const o = over as Record<string, unknown>;
  for (const k of Object.keys(base)) {
    const b = base[k], v = o[k];
    if (v === undefined) continue;
    if (Array.isArray(b)) {
      if (Array.isArray(v) && v.length === b.length && v.every(Number.isFinite)) base[k] = v.slice();
    } else if (b && typeof b === "object") merge(b as Record<string, unknown>, v);
    else if (typeof b === "number" && Number.isFinite(v)) base[k] = v;
  }
}

/** Values from the tuner (any version; JSON text or parsed) over the defaults. Unknown keys are dropped. */
export function loadDexMotion(raw: unknown): DexMotion {
  const out = clone(DEX_MOTION);
  let r: unknown = raw;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return out;
    }
  }
  if (!r || typeof r !== "object") return out;
  const v = clone(r) as {
    tracks?: { move?: unknown; moveX?: unknown; press?: Track & { depth: number }; pressIn?: unknown; pressOut?: unknown };
    landscape?: unknown;
    open?: unknown;
    path?: unknown;
  };
  // Version 2's separate x and y speeds; version 1's single press.
  if (v.tracks?.moveX) v.tracks.move ??= v.tracks.moveX;
  if (v.tracks?.press) {
    const p = v.tracks.press, half = Math.round(p.duration / 2);
    v.tracks.pressIn ??= { delay: p.delay, duration: half, curve: p.curve, depth: p.depth };
    v.tracks.pressOut ??= { delay: p.delay + half, duration: p.duration - half, curve: p.curve };
  }
  // Before version 4 there was only portrait: landscape starts as a copy of it.
  v.landscape ??= { open: v.open, path: v.path };
  merge(out as unknown as Record<string, unknown>, v);
  return out;
}

/** CSS's cubic-bezier(x1, y1, x2, y2) as a function of 0–1 progress (clamped at the ends). */
export function cubicBezier([x1, y1, x2, y2]: Curve): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) return sy(t);
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

/** A track's raw 0–1 progress at `ms`, and its eased value (which may overshoot). */
export function trackAt(track: Track, ms: number): { u: number; e: number } {
  const u = track.duration <= 0 ? (ms >= track.delay ? 1 : 0) : Math.min(1, Math.max(0, (ms - track.delay) / track.duration));
  return { u, e: cubicBezier(track.curve)(u) };
}

/** How long opening takes (ms); closing plays it backwards `close.speed` times faster. */
export function motionLength(m: DexMotion): number {
  return Math.max(...Object.values(m.tracks).map((t) => t.delay + t.duration));
}

/** One axis of a cubic bezier from 0 to 1 with control values a and b. */
const bez1 = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;

/**
 * The bezier parameter at fraction `e` of the path's length, so the Move curve is speed along the
 * path however the handles bend it. `dx` and `dy` are the path's span (any one unit). Past either
 * end (an overshooting curve) it carries on at the end's rate.
 */
export function pathParam(path: MotionPath, e: number, dx: number, dy: number): number {
  const N = 128;
  dx = Math.abs(dx);
  dy = Math.abs(dy);
  const len = [0];
  let px = 0, py = 0;
  for (let i = 1; i <= N; i++) {
    const u = i / N, x = bez1(path.c1[0], path.c2[0], u) * dx, y = bez1(path.c1[1], path.c2[1], u) * dy;
    len.push(len[i - 1]! + Math.hypot(x - px, y - py));
    px = x;
    py = y;
  }
  const L = len[N]!;
  if (!(L > 0)) return e;
  if (e <= 0 || e >= 1) {
    const i = e <= 0 ? 0 : N - 1, seg = (len[i + 1]! - len[i]!) / L, rate = seg > 0 ? 1 / N / seg : 1;
    return e <= 0 ? e * rate : 1 + (e - 1) * rate;
  }
  const want = e * L;
  let lo = 0, hi = N;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (len[m]! < want) lo = m;
    else hi = m;
  }
  return (lo + (want - len[lo]!) / (len[hi]! - len[lo]! || 1)) / N;
}

/** How the phone is held: the angle the open dex lies at, degrees anticlockwise on screen. */
export type Held = 0 | 90 | -90;

/**
 * The held angle for a frame `width`×`height` CSS pixels: upright when it's tall, else from the
 * screen's orientation angle (`screen.orientation.angle`: 90 turned anticlockwise, 270 clockwise).
 */
export function heldAngle(width: number, height: number, screenAngle?: number | null): Held {
  if (width <= height) return 0;
  return screenAngle === 270 || screenAngle === -90 ? -90 : 90;
}

/**
 * The roll between orientations: `to(angle, now)` starts it from wherever it is (even mid-roll),
 * `at(now)` is the angle the dex is at.
 */
export class DexRoll {
  from = 0;
  target: Held = 0;
  start = -Infinity;
  private readonly motion: () => DexMotion;
  constructor(motion: () => DexMotion) {
    this.motion = motion;
  }
  at(now: number): number {
    const { duration, curve } = this.motion().rotate;
    const u = duration <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.start) / duration));
    return this.from + (this.target - this.from) * cubicBezier(curve)(u);
  }
  to(angle: Held, now: number): void {
    if (angle === this.target) return;
    this.from = this.at(now);
    this.target = angle;
    this.start = now;
  }
  /**
   * How far through the swap from the old page layout to the new one (0–1): over the middle half
   * of the roll, so neither layout sits on its side for long. 1 when not rolling.
   */
  swap(now: number): number {
    if (this.from === this.target) return 1;
    const t = Math.min(1, Math.max(0, ((this.at(now) - this.from) / (this.target - this.from) - 0.25) / 0.5));
    return t * t * (3 - 2 * t);
  }
}

/** The model's sizes, in its own units: the shut body's box, and the screen's (open). */
export interface DexMeasure {
  shut: { w: number; h: number; centre: [x: number, y: number, z: number] };
  screen: { w: number; h: number; centre: [x: number, y: number, z: number] };
}
/** The view: its size in CSS pixels and the world units per CSS pixel on the dex's plane (z = 0). */
export interface DexFrame {
  width: number;
  height: number;
  unitsPerPixel: number;
}
export interface DexPose {
  /** The model point pinned to the path (negate it for the model's offset in its holder). */
  pivot: [x: number, y: number, z: number];
  /** The holder's position on the z = 0 plane, world units, y up, from the frame's middle. */
  position: [x: number, y: number];
  scale: number;
  /** Euler XYZ, radians. */
  rotation: [x: number, y: number, z: number];
  /** The cover: 0 shut … 1 open. */
  cover: number;
  /** The world behind: dim 0–1, blur in CSS pixels. */
  dim: number;
  blur: number;
  /** The page on the screen, 0–1. */
  page: number;
  /** 1 while it's shut in the corner (news shows), falling to 0 as it starts to move. */
  shut: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** The closed dex's box in CSS pixels (top-right of the frame, upright whatever the orientation). */
export function buttonRect(m: DexMotion, frame: DexFrame, measure: DexMeasure): { x: number; y: number; w: number; h: number } {
  const w = m.closed.width, h = w * (measure.shut.h / measure.shut.w);
  return { x: frame.width - m.closed.right - w, y: m.closed.top, w, h };
}

/** The open dex's scale with it rolled to `angle` degrees: its screen fills the frame. */
export function openScale(m: DexMotion, frame: DexFrame, measure: DexMeasure, angle: number, held: Held): number {
  const k = frame.unitsPerPixel, c = Math.abs(Math.cos(rad(angle))), s = Math.abs(Math.sin(rad(angle)));
  const { w: sw, h: sh } = measure.screen;
  const w = c * sw + s * sh, h = s * sw + c * sh;
  return (held ? m.landscape : m).open.fill * Math.min((frame.width * k) / w, (frame.height * k) / h);
}

/**
 * The pose `ms` into opening, held at `held` with the dex rolled to `angle` (from a DexRoll; equal
 * to `held` once it has settled). Closing is the same at falling `ms`.
 */
export function dexPose(m: DexMotion, ms: number, frame: DexFrame, measure: DexMeasure, held: Held, angle: number = held): DexPose {
  const T = m.tracks, O = held ? m.landscape : m, k = frame.unitsPerPixel;
  const b = buttonRect(m, frame, measure);
  const x0 = (b.x + b.w / 2 - frame.width / 2) * k, y0 = (frame.height / 2 - b.y - b.h / 2) * k;
  const x1 = 0, y1 = -O.open.offsetY * k;
  const s0 = (b.w * k) / measure.shut.w;
  const s1 = openScale(m, frame, measure, angle, held);
  const pressIn = trackAt(T.pressIn, ms), pressOut = trackAt(T.pressOut, ms), move = trackAt(T.move, ms), scale = trackAt(T.scale, ms);
  const turn = trackAt(T.turn, ms), open = trackAt(T.open, ms), page = trackAt(T.page, ms), dim = trackAt(T.dim, ms), blur = trackAt(T.blur, ms);
  const sc = Math.min(1, Math.max(0, scale.e));
  const { centre: a } = measure.shut, { centre: z } = measure.screen;
  const ps = pathParam(O.path, move.e, x1 - x0, y1 - y0);
  const r = 1 - turn.e;
  return {
    pivot: [a[0] + (z[0] - a[0]) * sc, a[1] + (z[1] - a[1]) * sc, a[2] + (z[2] - a[2]) * sc],
    position: [x0 + (x1 - x0) * bez1(O.path.c1[0], O.path.c2[0], ps), y0 + (y1 - y0) * bez1(O.path.c1[1], O.path.c2[1], ps)],
    scale: s0 * Math.pow(s1 / s0, scale.e) * (1 - T.pressIn.depth * (pressIn.e - pressOut.e)),
    // Turn untilts it and rolls it from upright (the button) to the way the phone is held.
    rotation: [rad(m.closed.tiltX) * r, rad(m.closed.tiltY) * r + rad(T.turn.swing) * Math.sin(Math.PI * turn.u), rad(m.closed.tiltZ) * r + rad(angle) * turn.e],
    cover: Math.min(1, Math.max(0, open.e)),
    dim: T.dim.amount * Math.min(1, Math.max(0, dim.e)),
    blur: T.blur.amount * Math.max(0, blur.e),
    page: Math.min(1, Math.max(0, page.e)),
    shut: Math.max(0, 1 - Math.max(move.e, scale.e) * 4),
  };
}

/**
 * The screen's corners (top-left, top-right, bottom-right, bottom-left, as the model has them)
 * reordered so a page laid out for `held` has its top up: each quarter turn anticlockwise moves
 * the page's top-left one corner on.
 */
export function pageCorners<T>(corners: readonly T[], held: Held): T[] {
  const turns = (((held / 90) % 4) + 4) % 4;
  return [0, 1, 2, 3].map((i) => corners[(i + turns) % 4]!);
}

/** A page's layout size in CSS pixels for `held` once open: the screen's, turned with it. */
export function pageSize(m: DexMotion, frame: DexFrame, measure: DexMeasure, held: Held): { width: number; height: number } {
  const s = openScale(m, frame, measure, held, held) / frame.unitsPerPixel;
  const w = Math.round(measure.screen.w * s), h = Math.round(measure.screen.h * s);
  return held ? { width: h, height: w } : { width: w, height: h };
}
