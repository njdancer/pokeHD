// Turns painted normals into a mesh for the relief editor's 3D view. Pure data in, triangle arrays
// out, so it's testable without a browser.
//
// Maps use the Game Boy's three-quarter view: moving one pixel up the screen means moving up, or
// back, or a mix of both (dh + dz = 1), so the original pixels always line up when seen from the
// game's camera. Each column is walked from the bottom. A pixel's normal decides its mix:
// facing the viewer goes up, facing the sky goes back, a slope goes some of each. Ground pixels stay
// where they'd be on a flat map, so a tall object leaves a hidden gap behind it rather than dragging
// everything behind it forwards. Pixels that lean
// sideways (hips) take their height from the column next to them, working outwards.
//
// Pictures (Pokémon, trainers) are seen straight on, so instead a height is solved for every pixel
// whose slopes match the painted normals, with the silhouette's edge at zero.
import type { Normal } from "../../../apps/web/src/client/tools/relief/normals.ts";

export interface Mesh {
  positions: number[];
  normals: number[];
  colours: number[];
}

type Rgb = readonly [number, number, number];

function mesh(): Mesh & { quad(a: number[], b: number[], c: number[], d: number[], n: Normal | number[], rgb: Rgb): void } {
  const m = { positions: [] as number[], normals: [] as number[], colours: [] as number[],
    quad(a: number[], b: number[], c: number[], d: number[], n: Normal | number[], rgb: Rgb) {
      for (const p of [a, b, c, a, c, d]) { m.positions.push(p[0]!, p[1]!, p[2]!); m.normals.push(n[0]!, n[1]!, n[2]!); m.colours.push(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255); }
    } };
  return m;
}

export interface MapRegion {
  width: number;
  height: number;
  normal(x: number, y: number): Normal;
  colour(x: number, y: number): Rgb;
  /** Ground-level pixels (paths, floors, grass): walking a column drops back to height 0 on them. */
  ground(x: number, y: number): boolean;
}

export interface MapOptions {
  /** Close the shape under each column with side walls. */
  sides: boolean;
  /** Copy each roof slope behind its ridge, so roofs come out gabled instead of half a roof. */
  mirror: boolean;
  /** PROTOTYPE: rebuild each roof (connected slope and hip pixels) as one solid shape. */
  roofs?: boolean;
}

interface Seg {
  x: number; z0: number; z1: number;
  hl0: number; hl1: number; hr0: number; hr1: number;
  rgb: Rgb; lean: number; // height change per pixel to the right (hips), 0 for most pixels
}

const SLOPE = (n: Normal) => n[1] > 0.05 && n[2] > 0.05 && Math.abs(n[0]) < 0.05;

/** Builds the three-quarter-view relief for a map region. Units: one pixel; y up, z towards the viewer. */
export function mapRelief(r: MapRegion, opts: MapOptions): Mesh {
  const cols: Seg[][] = [];
  for (let x = 0; x < r.width; x++) {
    const segs: Seg[] = []; cols.push(segs);
    let h = 0, z = 0;
    let run: Seg[] = [];
    const push = (dh: number, dz: number, rgb: Rgb, lean: number) => {
      const s: Seg = { x, z0: z, z1: z + dz, hl0: h, hl1: h + dh, hr0: h, hr1: h + dh, rgb, lean };
      h += dh; z += dz; segs.push(s); return s;
    };
    const closeRun = () => {
      // The hidden back of a roof: the same slope, mirrored, coming back down behind the ridge.
      if (opts.mirror) for (const s of [...run].reverse()) push(-(s.hl1 - s.hl0), s.z1 - s.z0, s.rgb.map((v) => v * 0.85) as unknown as Rgb, 0);
      run = [];
    };
    for (let y = r.height - 1; y >= 0; y--) {
      const n = r.normal(x, y), rgb = r.colour(x, y);
      if (r.ground(x, y)) {
        if (run.length) closeRun();
        if (h > 0) { segs.push({ x, z0: z, z1: z, hl0: h, hl1: 0, hr0: h, hr1: 0, rgb, lean: 0 }); h = 0; } // back wall down to the ground
        // Ground keeps its natural place: as far back as its row is up the screen. Whatever stood in
        // front of it hides the gap between that object's back and here; it never pulls the ground forward.
        z = Math.max(z, r.height - 1 - y);
      }
      const ny = Math.max(0, n[1]), nz = Math.max(0, n[2]), sum = ny + nz;
      const dh = sum < 1e-3 ? 1 : nz / sum, dz = sum < 1e-3 ? 0 : ny / sum;
      const lean = ny > 0.05 && Math.abs(n[0]) > 0.05 ? -n[0] / ny : 0;
      const s = push(dh, dz, rgb, lean);
      if (SLOPE(n)) run.push(s); else if (run.length && !r.ground(x, y)) run = [];
    }
    if (run.length) closeRun();
  }
  // Hips: a pixel that leans takes the height of the column on its uphill side, then drops by its
  // lean across its own width. Work from the uphill side outwards so neighbours are settled first.
  const edgeAt = (x: number, z: number, side: "l" | "r"): number | null => {
    if (x < 0 || x >= r.width) return null;
    let best: number | null = null;
    for (const g of cols[x]!) {
      if (z < g.z0 - 1e-6 || z > g.z1 + 1e-6 || g.z1 === g.z0) continue;
      const t = (z - g.z0) / (g.z1 - g.z0), a = side === "l" ? [g.hl0, g.hl1] : [g.hr0, g.hr1];
      const v = a[0]! + (a[1]! - a[0]!) * t;
      if (best === null || v > best) best = v;
    }
    return best;
  };
  for (let x = r.width - 1; x >= 0; x--) for (const g of cols[x]!) if (g.lean > 0) { // rises to the right: uphill is x + 1
    const a = edgeAt(x + 1, g.z0, "l"), b = edgeAt(x + 1, g.z1, "l");
    if (a === null || b === null) continue;
    g.hr0 = a; g.hr1 = b; g.hl0 = Math.max(0, a - g.lean); g.hl1 = Math.max(0, b - g.lean);
  }
  for (let x = 0; x < r.width; x++) for (const g of cols[x]!) if (g.lean < 0) { // rises to the left
    const a = edgeAt(x - 1, g.z0, "r"), b = edgeAt(x - 1, g.z1, "r");
    if (a === null || b === null) continue;
    g.hl0 = a; g.hl1 = b; g.hr0 = Math.max(0, a + g.lean); g.hr1 = Math.max(0, b + g.lean);
  }
  if (opts.roofs) roofs(r, cols);
  const m = mesh();
  for (const segs of cols) for (const g of segs) {
    const { x, z0, z1, rgb } = g;
    const A = [x, g.hl0, -z0], B = [x + 1, g.hr0, -z0], C = [x + 1, g.hr1, -z1], D = [x, g.hl1, -z1];
    const vertical = z0 === z1;
    const n = vertical ? [0, 0, g.hl1 >= g.hl0 ? 1 : -1] : faceNormal(A, B, D);
    m.quad(A, B, C, D, n, rgb);
    if (opts.sides && !vertical) {
      const dark = rgb.map((v) => v * 0.78) as unknown as Rgb;
      if (g.hl0 > 0 || g.hl1 > 0) m.quad([x, 0, -z0], [x, 0, -z1], [x, g.hl1, -z1], [x, g.hl0, -z0], [-1, 0, 0], dark);
      if (g.hr0 > 0 || g.hr1 > 0) m.quad([x + 1, 0, -z0], [x + 1, 0, -z1], [x + 1, g.hr1, -z1], [x + 1, g.hr0, -z0], [1, 0, 0], dark);
    }
  }
  return m;
}

function faceNormal(a: number[], b: number[], d: number[]): number[] {
  const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
  const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
  const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  const out = n.map((k) => k / l);
  return out[1]! < 0 ? out.map((k) => -k) : out;
}

export interface Picture {
  width: number;
  height: number;
  inside(x: number, y: number): boolean;
  normal(x: number, y: number): Normal;
  colour(x: number, y: number): Rgb;
}

/** Height per pixel whose slopes match the normals (Gauss–Seidel on the Poisson equation), 0 outside. */
export function pictureHeights(p: Picture, iterations = 400): Float32Array {
  const { width: w, height: h } = p, z = new Float32Array(w * h);
  // Target slopes. Picture y runs down; a normal's y is up.
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = p.normal(x, y), nz = Math.max(0.2, n[2]);
    gx[y * w + x] = -n[0] / nz; gy[y * w + x] = n[1] / nz;
  }
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && p.inside(x, y);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!p.inside(x, y)) continue;
      const i = y * w + x;
      let sum = 0;
      // Each neighbour suggests a height: its own, plus the slope between us.
      sum += (inside(x - 1, y) ? z[i - 1]! : 0) + (gx[i]! + (inside(x - 1, y) ? gx[i - 1]! : gx[i]!)) / 2;
      sum += (inside(x + 1, y) ? z[i + 1]! : 0) - (gx[i]! + (inside(x + 1, y) ? gx[i + 1]! : gx[i]!)) / 2;
      sum += (inside(x, y - 1) ? z[i - w]! : 0) + (gy[i]! + (inside(x, y - 1) ? gy[i - w]! : gy[i]!)) / 2;
      sum += (inside(x, y + 1) ? z[i + w]! : 0) - (gy[i]! + (inside(x, y + 1) ? gy[i + w]! : gy[i]!)) / 2;
      z[i] = Math.max(0, sum / 4);
    }
  }
  return z;
}

/** A smooth relief for a picture, facing +z, centred on the origin. `depth` scales the heights. */
export function pictureRelief(p: Picture, depth = 1): Mesh {
  const z = pictureHeights(p);
  const { width: w, height: h } = p, m = mesh();
  // Corner heights: the average of the pixels around each corner that are inside.
  const corner = (cx: number, cy: number) => {
    let s = 0, n = 0;
    for (const [x, y] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]] as const) if (x >= 0 && y >= 0 && x < w && y < h && p.inside(x, y)) { s += z[y * w + x]!; n++; }
    return n === 4 ? (s / n) * depth : n ? (s / n) * depth * 0.5 : 0;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!p.inside(x, y)) continue;
    const X = x - w / 2, Y = h / 2 - y;
    // Shaded with the painted normal itself, so every pixel catches light the way it was painted.
    m.quad([X, Y - 1, corner(x, y + 1)], [X + 1, Y - 1, corner(x + 1, y + 1)], [X + 1, Y, corner(x + 1, y)], [X, Y, corner(x, y)], p.normal(x, y), p.colour(x, y));
  }
  return m;
}


/**
 * PROTOTYPE (relief ML, 2026-10-12). A roof is a connected patch of slope and hip pixels. It is rebuilt
 * as one solid: the lowest of four 45° planes over the ground: the front pitch (rises going back), the
 * back pitch (its mirror behind the ridge), and the two hip ends (rise going inwards from the left and
 * right edges). Each pixel is then placed where the game camera's ray through it meets that solid
 * (screen row = height + depth), so the sprite still lines up exactly, and the hidden back pitch and
 * hip backs are added behind it.
 */
function roofs(r: MapRegion, cols: Seg[][]) {
  const W = r.width, H = r.height;
  const isRoof = (x: number, y: number) => {
    if (r.ground(x, y)) return false;
    const n = r.normal(x, y);
    return SLOPE(n) || (n[1] > 0.05 && Math.abs(n[0]) > 0.05);
  };
  const seen = new Uint8Array(W * H);
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    if (seen[y0 * W + x0] || !isRoof(x0, y0)) continue;
    const px: [number, number][] = []; const stack: [number, number][] = [[x0, y0]]; seen[y0 * W + x0] = 1;
    while (stack.length) {
      const [x, y] = stack.pop()!; px.push([x, y]);
      for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const)
        if (a >= 0 && a < W && b >= 0 && b < H && !seen[b * W + a] && isRoof(a, b)) { seen[b * W + a] = 1; stack.push([a, b]); }
    }
    if (px.length < 4) continue;
    // Per column: the roof's pixel rows (bottom to top) and where the walk put its lowest pixel (the eave).
    const byCol = new Map<number, number[]>();
    for (const [x, y] of px) (byCol.get(x) ?? byCol.set(x, []).get(x)!).push(y);
    const eaves: { x: number; h: number; z: number; rows: number[] }[] = [];
    for (const [x, ys] of byCol) {
      ys.sort((a, b) => b - a);
      const segs = cols[x]!, rowsFromBottom = H - 1 - ys[0]!;
      // the walk pushes one seg per pixel row from the bottom (plus vertical back walls); find the eave seg
      let k = -1, i = 0;
      for (const g of segs) { if (g.z0 === g.z1 && g.hl1 < g.hl0) continue; if (i === rowsFromBottom) { k = segs.indexOf(g); break; } i++; }
      if (k < 0) continue;
      eaves.push({ x, h: segs[k]!.hl0, z: segs[k]!.z0, rows: ys });
    }
    if (!eaves.length) continue;
    const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
    const he = med(eaves.map((e) => e.h)), ze = med(eaves.map((e) => e.z));
    const xa = Math.min(...eaves.map((e) => e.x)), xb = Math.max(...eaves.map((e) => e.x)) + 1;
    // Ridge: half the tallest column of slope pixels (each slope pixel rises half a pixel).
    let slopeRows = 0;
    for (const e of eaves) slopeRows = Math.max(slopeRows, e.rows.filter((y) => SLOPE(r.normal(e.x, y))).length);
    const rise = slopeRows / 2, R = he + rise, zr = ze + rise, zb = zr + rise;
    const roofH = (x: number, z: number) => Math.max(he - 1e-6, Math.min(he + (z - ze), R - (z - zr), he + (x - xa), he + (xb - x)));
    // Where the camera ray for screen row s (= height + depth) meets the roof, in column edge x.
    const hit = (x: number, s: number): [number, number] => {
      let lo = ze, hi = zb;
      if (roofH(x, lo) + lo >= s) return [lo, roofH(x, lo)];
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (roofH(x, mid) + mid >= s) hi = mid; else lo = mid; }
      return [hi, roofH(x, hi)];
    };
    for (const e of eaves) {
      const segs = cols[e.x]!, s0 = he + ze;
      // Replace this column's roof pixels: keep everything below the eave, rebuild the roof, then the walk above.
      const keep = segs.filter((g) => g.z1 <= ze + 1e-6 && Math.max(g.hl0, g.hl1, g.hr0, g.hr1) <= he + 1e-6);
      const above = segs.filter((g) => !keep.includes(g) && g.z0 >= zb - 1e-6);
      const rgbOf = (y: number) => r.colour(e.x, y);
      const out: Seg[] = [...keep];
      const ys = e.rows; let lastZ = ze;
      ys.forEach((y, k) => {
        const sA = s0 + k, sB = s0 + k + 1;
        const [zl0, hl0] = hit(e.x, sA), [zl1, hl1] = hit(e.x, sB);
        const [zr0, hr0] = hit(e.x + 1, sA), [zr1, hr1] = hit(e.x + 1, sB);
        // one quad per pixel; depth from the column's middle so left and right edges stay on the same pixel row
        const z0 = (zl0 + zr0) / 2, z1 = (zl1 + zr1) / 2;
        out.push({ x: e.x, z0, z1, hl0, hl1, hr0, hr1, rgb: rgbOf(y), lean: 0 });
        lastZ = z1;
      });
      // Hidden back: from the last visible point back to the rear eave, following the roof.
      const steps = Math.max(1, Math.ceil(zb - lastZ));
      const dark = rgbOf(ys[ys.length - 1]!).map((v) => v * 0.85) as unknown as Rgb;
      for (let i = 0; i < steps; i++) {
        const z0 = lastZ + (zb - lastZ) * i / steps, z1 = lastZ + (zb - lastZ) * (i + 1) / steps;
        out.push({ x: e.x, z0, z1, hl0: roofH(e.x, z0), hl1: roofH(e.x, z1), hr0: roofH(e.x + 1, z0), hr1: roofH(e.x + 1, z1), rgb: dark, lean: 0 });
      }
      cols[e.x] = [...out, ...above];
    }
  }
}
