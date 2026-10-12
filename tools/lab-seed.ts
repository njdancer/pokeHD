// Builds a DEMO relief-lab tree (docs/relief-ml/LAB-CONTRACT.md) for developing the /admin/lab
// dashboard without the trainer. The runs mirror the real history in docs/relief-ml/HANDOFF.md
// (section 3); blanks there are filled with plausible numbers. Every image is drawn here,
// procedurally: small Game-Boy-looking scenes in 4 grey shades. No ROM data is read or written.
// Deterministic (seeded PRNG), so re-running gives the same bytes.
//
// Usage:
//   node tools/lab-seed.ts --out <dir>                               write the tree to a folder
//   node tools/lab-seed.ts --url http://localhost:5173 [--token-file <path>]   PUT it to the lab API
// The token comes from $POKEHD_ADMIN_TOKEN, else --token-file, else ~/.config/pokehd/admin-token.
// It is never printed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const outDir = arg("--out");
const baseUrl = arg("--url");
if (!outDir && !baseUrl) {
  console.error("usage: node tools/lab-seed.ts --out <dir> | --url <origin> [--token-file <path>]");
  process.exit(2);
}

// ---------- seeded randomness ----------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261011);
const rnd = (a: number, b: number): number => a + (b - a) * rand();
const rint = (a: number, b: number): number => Math.floor(rnd(a, b + 1));
const gauss = (): number => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const r4 = (x: number): number => Number(x.toFixed(4));
const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

// ---------- PNG by hand ----------
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = (CRC[(c ^ b) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
/** 8-bit PNG: 1 channel grey, 3 RGB, 4 RGBA. */
function png(w: number, h: number, ch: 1 | 3 | 4, px: Uint8Array): Buffer {
  const ihdr = Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 8, ch === 1 ? 0 : ch === 3 ? 2 : 6, 0, 0, 0]);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  const stride = w * ch;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]);
}

// ---------- the file tree (paths under lab/) ----------
const files = new Map<string, Uint8Array>();
const put = (p: string, d: Uint8Array | string): void => void files.set(p, typeof d === "string" ? Buffer.from(d) : d);
const putJson = (p: string, o: unknown): void => put(p, JSON.stringify(o, null, 2) + "\n");

// ---------- shared pixel helpers ----------
const SHADE = [255, 170, 85, 0];
const FACES = ["TOP", "FRONT", "SLOPE", "HIP◀", "HIP▶"];
/** Face normals in the contract's frame: x right, y up, z to the viewer. */
const FACE_N: [number, number, number][] = [[0, 1, 0], [0, 0, 1], [0, 0.707, 0.707], [-0.6, 0.6, 0.53], [0.6, 0.6, 0.53]];
const FACE_RGB = [[240, 200, 80], [80, 140, 230], [200, 90, 80], [120, 200, 120], [170, 110, 210]];

function heat(v: number): [number, number, number] {
  const t = clamp(v, 0, 1);
  return [Math.round(clamp(t * 2, 0, 1) * 255), Math.round(clamp(t * 2 - 1, 0, 1) * 255), Math.round(20 + t * 30)];
}
function rgbFromShades(shade: Uint8Array): Uint8Array {
  const out = new Uint8Array(shade.length * 3);
  shade.forEach((s, i) => out.fill(SHADE[s] as number, i * 3, i * 3 + 3));
  return out;
}
function normalsPng(w: number, h: number, n: Float32Array, alpha: (i: number) => boolean): Buffer {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(clamp((n[i * 3 + k] as number) * 127.5 + 127.5, 0, 255));
    px[i * 4 + 3] = alpha(i) ? 255 : 0;
  }
  return png(w, h, 4, px);
}
function noisyNormals(n: Float32Array, sd: number): Float32Array {
  const out = new Float32Array(n.length);
  for (let i = 0; i < n.length; i += 3) {
    const a = (n[i] as number) + gauss() * sd, b = (n[i + 1] as number) + gauss() * sd, c = Math.abs((n[i + 2] as number) + gauss() * sd);
    const l = Math.hypot(a, b, c) || 1;
    out[i] = a / l; out[i + 1] = b / l; out[i + 2] = c / l;
  }
  return out;
}
/** Mean angle in degrees between two normal buffers, plus an error heatmap (45° = brightest). */
function angleErr(w: number, h: number, a: Float32Array, b: Float32Array, live: (i: number) => boolean): { deg: number; png: Buffer } {
  const px = new Uint8Array(w * h * 3);
  let sum = 0, n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!live(i)) continue;
    const dot = (a[i * 3] as number) * (b[i * 3] as number) + (a[i * 3 + 1] as number) * (b[i * 3 + 1] as number) + (a[i * 3 + 2] as number) * (b[i * 3 + 2] as number);
    const deg = (Math.acos(clamp(dot, -1, 1)) * 180) / Math.PI;
    sum += deg; n++;
    px.set(heat(deg / 45), i * 3);
  }
  return { deg: n ? sum / n : 0, png: png(w, h, 3, px) };
}

// ---------- map view: three-quarter scenes ----------
type Obj = { kind: string; x: number; y: number; w: number; top: number; front: number };
type MapScene = { w: number; h: number; shade: Uint8Array; face: Uint8Array; objs: Obj[] };

function mapScene(style: "town" | "room" | "furniture", w = 128, h = 96): MapScene {
  const shade = new Uint8Array(w * h), face = new Uint8Array(w * h), objs: Obj[] = [];
  const set = (x: number, y: number, s: number, f?: number): void => {
    if (x >= 0 && y >= 0 && x < w && y < h) { shade[y * w + x] = s; if (f !== undefined) face[y * w + x] = f; }
  };
  const rect = (x: number, y: number, rw: number, rh: number, s: number, f: number): void => { for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) set(x + i, y + j, s, f); };
  const outline = (x: number, y: number, rw: number, rh: number): void => {
    for (let i = 0; i < rw; i++) { set(x + i, y, 3); set(x + i, y + rh - 1, 3); }
    for (let j = 0; j < rh; j++) { set(x, y + j, 3); set(x + rw - 1, y + j, 3); }
  };
  const box = (kind: string, x: number, y: number, bw: number, top: number, front: number, topShade = 0): void => {
    rect(x, y, bw, top, topShade, 0);
    rect(x, y + top, bw, front, 2, 1);
    for (let i = 2; i < bw - 2; i += 4) for (let j = y + top + 1; j < y + top + front - 1; j++) set(x + i, j, 3); // drawers, slats
    outline(x, y, bw, top + front);
    for (let i = 0; i < bw; i++) set(x + i, y + top, 3);
    objs.push({ kind, x, y, w: bw, top, front });
  };
  const house = (x: number, y: number, hw: number, roof: number, wall: number): void => {
    for (let r = 0; r < roof; r++) {
      const hip = Math.round((roof - r) * 0.6);
      for (let c = 0; c < hw; c++) {
        const f = c < hip ? 3 : c >= hw - hip ? 4 : 2;
        set(x + c, y + r, f === 3 ? 1 : f === 4 ? 2 : r % 3 === 2 ? 3 : 2, f);
      }
    }
    rect(x + 1, y + roof, hw - 2, wall, 0, 1);
    rect(x + 4, y + roof + 3, 5, 4, 2, 1);
    rect(x + hw - 9, y + roof + 3, 5, 4, 2, 1);
    rect(x + (hw >> 1) - 3, y + roof + wall - 8, 6, 8, 3, 1);
    outline(x, y, hw, roof);
    outline(x + 1, y + roof, hw - 2, wall);
    objs.push({ kind: "house", x, y, w: hw, top: roof, front: wall });
  };
  const bush = (cx: number, cy: number, r: number): void => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const d = Math.hypot(i, j);
      if (d > r) continue;
      set(cx + i, cy + j, d > r - 1 ? 3 : i + j < -r / 2 ? 0 : (i + j) & 1 ? 2 : 1, j < 0 ? 0 : 1);
    }
    objs.push({ kind: "bush", x: cx - r, y: cy - r, w: 2 * r + 1, top: r, front: r + 1 });
  };

  if (style === "town") {
    for (let i = 0; i < w * h; i++) shade[i] = (i % w) % 7 === (Math.floor(i / w) * 3) % 7 && rand() < 0.6 ? 1 : 0;
    rect(0, 70 + rint(0, 8), w, 6, 1, 0); // a path
    let x = rint(2, 10);
    while (x < w - 36) {
      const hw = rint(30, 40);
      house(x, rint(4, 14), hw, rint(12, 16), rint(14, 18));
      x += hw + rint(6, 14);
    }
    for (let k = rint(2, 4); k > 0; k--) bush(rint(8, w - 8), rint(56, 88), rint(4, 6));
    const fy = rint(48, 54);
    for (let fx = rint(0, 10); fx < w - 6; fx += 8) box("fence", fx, fy, 4, 2, 5);
  } else {
    rect(0, 0, w, 24, 1, 1); // back wall
    for (let i = 0; i < w; i += 6) rect(i, 2, 1, 20, 2, 1);
    for (let i = 0; i < w; i++) set(i, 23, 3);
    for (let j = 24; j < h; j++) for (let i = 0; i < w; i++) set(i, j, i % 16 === 0 || j % 16 === 8 ? 1 : 0, 0);
    box("shelf", rint(4, 20), 6, rint(24, 32), 4, 18, 1);
    box("tv", rint(70, 90), 14, 16, 4, 12, 1);
    const tables = style === "furniture" ? 2 : 1;
    for (let t = 0; t < tables; t++) {
      const tx = 14 + t * 56 + rint(0, 8), ty = rint(44, 56);
      box("table", tx, ty, rint(28, 36), rint(10, 14), 4);
      box("chair", tx - 10, ty + 4, 8, 4, 5);
      if (style === "furniture") box("chair", tx + 32 + rint(2, 6), ty + 4, 8, 4, 5);
    }
    if (style === "furniture") box("counter", rint(40, 60), 26, 40, 6, 8);
  }
  return { w, h, shade, face, objs };
}

/** Truth faces with the mistakes a weak model makes: flat objects, chair tops read as fronts, hips as slopes, ragged edges. */
function predictFaces(sc: MapScene, quality: number, chairBias: number, flat = 0): Uint8Array {
  const { w, h } = sc, p = sc.face.slice();
  const region = (o: Obj, y0: number, y1: number, f: number): void => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, o.x); x < Math.min(w, o.x + o.w); x++) p[y * w + x] = f;
  };
  for (const o of sc.objs) {
    if (rand() < flat) region(o, o.y, o.y + o.top + o.front, 0);
    else if (o.kind === "chair" && rand() < chairBias) region(o, o.y, o.y + o.top, 1);
    else if ((o.kind === "table" || o.kind === "shelf") && rand() < (1 - quality) * 0.9) region(o, o.y + (o.top >> 1), o.y + o.top, 1);
    else if (o.kind === "house" && rand() < 1 - quality) {
      for (let y = o.y; y < o.y + o.top; y++) for (let x = o.x; x < o.x + o.w; x++) if ((p[y * w + x] as number) >= 3) p[y * w + x] = 2;
    }
  }
  const src = p.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    for (const j of [i - 1, i + 1, i - w, i + w]) if (src[j] !== src[i] && rand() < (1 - quality) * 0.45) p[i] = src[j] as number;
  }
  return p;
}
function facesToNormals(f: Uint8Array): Float32Array {
  const n = new Float32Array(f.length * 3);
  f.forEach((k, i) => n.set(FACE_N[k] ?? [0, 0, 1], i * 3));
  return n;
}
function facesRgb(f: Uint8Array): Uint8Array {
  const out = new Uint8Array(f.length * 3);
  f.forEach((k, i) => out.set(FACE_RGB[k] ?? [40, 40, 40], i * 3));
  return out;
}

type Item = { id: string; title: string; width: number; height: number; files: Record<string, string>; scores?: Record<string, number>; tags?: string[] };
type MapMode = "faces" | "normals" | "data";
const strip = ({ pred: _p, sc: _s, ...it }: Item & { pred?: unknown; sc?: unknown }): Item => it;

/** Writes one map-view sample's layers under `<dir>/<set>/<i>/` and returns its manifest item. */
function mapItem(dir: string, set: string, i: number, id: string, title: string, sc: MapScene, mode: MapMode, q = 0.8, chair = 0.5, flat = 0): Item & { pred?: Uint8Array; sc?: MapScene } {
  const { w, h } = sc, rel = `${set}/${i}`, f = (n: string): string => `${rel}/${n}`;
  const item: Item & { pred?: Uint8Array; sc?: MapScene } = { id, title, width: w, height: h, files: { input: f("input.png") }, tags: sc.objs.some((o) => o.kind === "chair") ? ["chairs"] : [] };
  put(`${dir}/${f("input.png")}`, png(w, h, 3, rgbFromShades(sc.shade)));
  const truthN = facesToNormals(sc.face);
  if (mode === "data") {
    put(`${dir}/${f("truth.png")}`, png(w, h, 1, sc.face));
    put(`${dir}/${f("normals.png")}`, normalsPng(w, h, truthN, () => true));
    Object.assign(item.files, { truth: f("truth.png"), normals: f("normals.png") });
    return item;
  }
  const pred = predictFaces(sc, q, chair, flat);
  const predN = noisyNormals(facesToNormals(pred), (1 - q) * 0.25);
  if (mode === "normals") {
    put(`${dir}/${f("truth.png")}`, normalsPng(w, h, truthN, () => true));
    put(`${dir}/${f("pred.png")}`, normalsPng(w, h, predN, () => true));
    const e = angleErr(w, h, truthN, predN, () => true);
    put(`${dir}/${f("err.png")}`, e.png);
    Object.assign(item.files, { truth: f("truth.png"), pred: f("pred.png"), err: f("err.png") });
    item.scores = { angle_err: r4(e.deg) };
    return item;
  }
  const err = new Uint8Array(w * h * 3);
  let ok = 0;
  for (let k = 0; k < w * h; k++) {
    const wrong = pred[k] !== sc.face[k];
    if (!wrong) ok++;
    err.set(heat(wrong ? 0.9 : 0.04), k * 3);
  }
  put(`${dir}/${f("truth.png")}`, png(w, h, 1, sc.face));
  put(`${dir}/${f("pred.png")}`, png(w, h, 1, pred));
  put(`${dir}/${f("normals.png")}`, normalsPng(w, h, predN, () => true));
  put(`${dir}/${f("err.png")}`, png(w, h, 3, err));
  Object.assign(item.files, { truth: f("truth.png"), pred: f("pred.png"), normals: f("normals.png"), err: f("err.png") });
  item.scores = { acc: r4(ok / (w * h)) };
  item.pred = pred;
  item.sc = sc;
  return item;
}

// ---------- pic view: front-on creatures made of ellipsoids ----------
type Pic = { w: number; h: number; shade: Uint8Array; n: Float32Array; z: Float32Array; mask: Uint8Array };

function creature(posed: boolean, w = 56, h = 56): Pic {
  const cx = w / 2 + rnd(-3, 3), headBack = posed ? rnd(8, 14) : rnd(0, 3);
  type Part = [x: number, y: number, z: number, rx: number, ry: number, rz: number, white: boolean];
  const parts: Part[] = [
    [cx, 35, 0, rnd(13, 17), rnd(12, 15), 11, false], // body
    [cx + rnd(-2, 2), 20 - (posed ? 2 : 0), -headBack, rnd(10, 13), rnd(9, 11), 9, false], // head, behind the belly
    [cx - 6, 10, -headBack - 2, 3, 5, 3, false], [cx + 6, 10, -headBack - 2, 3, 5, 3, false], // ears
    [cx - 8, 48, 5, 5, 4, 5, false], [cx + 8, 48, 5, 5, 4, 5, false], // feet, in front
  ];
  if (rand() < 0.7) parts.push([cx, 38, 6, rnd(7, 10), rnd(7, 9), 6, true]); // flat-white belly
  const n = new Float32Array(w * h * 3), z = new Float32Array(w * h).fill(-Infinity), white = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (const [px, py, pz, rx, ry, rz, wh] of parts) {
    const dx = (x + 0.5 - px) / rx, dy = (y + 0.5 - py) / ry, q = 1 - dx * dx - dy * dy;
    if (q <= 0) continue;
    const i = y * w + x, zz = pz + rz * Math.sqrt(q);
    if (zz <= (z[i] as number)) continue;
    z[i] = zz;
    const nx = dx / rx, ny = -dy / ry, nz = Math.sqrt(q) / rz, l = Math.hypot(nx, ny, nz);
    n[i * 3] = nx / l; n[i * 3 + 1] = ny / l; n[i * 3 + 2] = nz / l;
    white[i] = wh ? 1 : 0;
  }
  const mask = new Uint8Array(w * h), shade = new Uint8Array(w * h);
  const L = [-0.45, 0.55, 0.7];
  for (let i = 0; i < w * h; i++) {
    if (!Number.isFinite(z[i])) { z[i] = NaN; continue; }
    mask[i] = 1;
    const lit = 0.35 + 0.65 * Math.max(0, (n[i * 3] as number) * L[0]! + (n[i * 3 + 1] as number) * L[1]! + (n[i * 3 + 2] as number) * L[2]!);
    shade[i] = white[i] ? 0 : lit > 0.85 ? 0 : lit > 0.65 ? 1 : lit > 0.45 ? 2 : 3;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    if (nb.some(([a, b]) => a! < 0 || b! < 0 || a! >= w || b! >= h || !mask[b! * w + a!] || (z[b! * w + a!] as number) > (z[i] as number) + 2.5)) shade[i] = 3;
  }
  return { w, h, shade, n, z, mask };
}
function f32(a: Float32Array): Buffer {
  const b = Buffer.alloc(a.length * 4);
  a.forEach((v, i) => b.writeFloatLE(v, i * 4));
  return b;
}
/** The "pillow" a normals-only height field gives: depth grows with distance from the outline. */
function pillow(p: Pic): Float32Array {
  const { w, h } = p, d = new Float32Array(w * h).fill(NaN);
  let frontier: number[] = [];
  for (let i = 0; i < w * h; i++) if (p.mask[i]) { const x = i % w, y = (i / w) | 0; if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || [i - 1, i + 1, i - w, i + w].some((j) => !p.mask[j])) { d[i] = 1; frontier.push(i); } }
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) for (const j of [i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < w * h && p.mask[j] && Number.isNaN(d[j])) { d[j] = (d[i] as number) + 1; next.push(j); }
    frontier = next;
  }
  return d.map((v) => (Number.isNaN(v) ? NaN : Math.sqrt(v) * 3.2));
}
function picItem(dir: string, set: string, i: number, id: string, title: string, p: Pic, angleSd: number, depth: "none" | "pillow" | "layered", truth = false): Item {
  const { w, h } = p, f = (n: string): string => `${set}/${i}/${n}`;
  const item: Item = { id, title, width: w, height: h, files: { input: f("input.png") } };
  put(`${dir}/${f("input.png")}`, png(w, h, 3, rgbFromShades(p.shade)));
  const live = (k: number): boolean => p.mask[k] === 1;
  if (truth) {
    put(`${dir}/${f("normals.png")}`, normalsPng(w, h, p.n, live));
    put(`${dir}/${f("depth.f32")}`, f32(p.z));
    put(`${dir}/${f("mask.png")}`, png(w, h, 1, p.mask));
    Object.assign(item.files, { normals: f("normals.png"), depth: f("depth.f32"), mask: f("mask.png") });
    return item;
  }
  const pn = noisyNormals(p.n, angleSd);
  put(`${dir}/${f("pred.png")}`, normalsPng(w, h, pn, live));
  const e = angleErr(w, h, p.n, pn, live);
  put(`${dir}/${f("err.png")}`, e.png);
  Object.assign(item.files, { pred: f("pred.png"), err: f("err.png") });
  item.scores = { angle_err: r4(e.deg) };
  if (depth !== "none") {
    const d = depth === "pillow" ? pillow(p) : p.z.map((v) => (Number.isNaN(v) ? NaN : v + gauss() * 0.5));
    put(`${dir}/${f("depth.f32")}`, f32(d));
    item.files.depth = f("depth.f32");
    let s = 0, c = 0, mt = 0, md = 0;
    p.z.forEach((v, k) => { if (!Number.isNaN(v)) { mt += v; md += d[k] as number; c++; } });
    p.z.forEach((v, k) => { if (!Number.isNaN(v)) s += Math.abs(v - mt / c - ((d[k] as number) - md / c)); });
    item.scores.depth_err = r4(s / c);
  }
  return item;
}

// ---------- the runs (docs/relief-ml/HANDOFF.md section 3) ----------
type Spec = {
  name: string; task: "normals" | "faces" | "depth"; title: string; at: string; parent?: string; datasets: string[];
  width: number; epochs: number; changes: string[]; why: string; findings: string[]; summary: Record<string, number | null>;
  cfg?: Record<string, unknown>; q: number; chair?: number; flat?: number; depth?: "pillow" | "layered"; posed?: boolean;
  test?: { cls: number[]; chair: number }; real?: { circular: boolean }; running?: number;
};
const SPECS: Spec[] = [
  { name: "pilot", task: "normals", title: "Pilot: hand-picked styles, 1k scenes", at: "2026-10-10T01:30", datasets: ["pilot-1k"], width: 24, epochs: 12, q: 0.4, flat: 0.75,
    changes: ["First run"], why: "Does a small U-Net learn any shape from 4-shade synthetic art?", findings: ["Reads everything as flat ground", "Real maps 0.48, barely above the shade-only oracle (0.47)"], summary: { angle_err: 25, real_bal: 0.48, val_loss: 0.41 } },
  { name: "map-v2", task: "normals", title: "Calibrated styles, 6k scenes", at: "2026-10-10T03:10", parent: "pilot", datasets: ["maps-6k"], width: 24, epochs: 16, q: 0.55, cfg: { scenes: 6000, style: "calibrated" },
    changes: ["Renderer fitted to 22 real maps (soft wrapped light, high ambient)", "1k → 6k scenes"], why: "The calibration showed fronts as bright as tops; match that.", findings: ["Walls 1% → 40%", "Trees become domes, fences become posts", "Dithered grass reads as bumps"], summary: { angle_err: 9.7, real_bal: 0.48, val_loss: 0.19 } },
  { name: "map-v3", task: "normals", title: "+ game-like ground textures", at: "2026-10-10T04:40", parent: "map-v2", datasets: ["maps-6k"], width: 24, epochs: 16, q: 0.55, cfg: { ground_textures: true },
    changes: ["+ grass, path and floor textures like the game's"], why: "Stop dithered grass reading as bumps.", findings: ["Ground fixed (77%)", "Room back walls now read as floor"], summary: { angle_err: 8.8, real_bal: 0.46, val_loss: 0.17 } },
  { name: "map-v5", task: "normals", title: "+ indoor rooms, 12k scenes", at: "2026-10-10T06:20", parent: "map-v3", datasets: ["maps-12k", "rooms-3k"], width: 24, epochs: 16, q: 0.6, cfg: { scenes: 12000, ROOM_SHARE: 0.25 },
    changes: ["+ rooms with back walls and furniture (25%)", "6k → 12k scenes"], why: "Teach back walls as walls.", findings: ["Each data fix trades one class for another"], summary: { angle_err: 7.3, real_bal: 0.49, val_loss: 0.15 } },
  { name: "map-v6", task: "normals", title: "Same data, width 40", at: "2026-10-10T08:30", parent: "map-v5", datasets: ["maps-12k", "rooms-3k", "testset"], width: 40, epochs: 20, q: 0.72, chair: 0.65,
    changes: ["Width 24 → 40"], why: "Maybe the model is too small, not the data too poor.", findings: ["First clear win over shade alone: 0.57", "Capacity was the limit"], summary: { angle_err: 6.6, real_bal: 0.57, test_acc: 0.725, obj_mean: 0.65, val_loss: 0.13 },
    test: { cls: [0.82, 0.66, 0.6, 0.5, 0.5], chair: 0.38 } },
  { name: "map-v7", task: "normals", title: "Width 64", at: "2026-10-10T10:40", parent: "map-v6", datasets: ["maps-12k", "rooms-3k"], width: 64, epochs: 20, q: 0.62,
    changes: ["Width 40 → 64"], why: "If 40 helped, does 64 help more?", findings: ["Overfits the synthetic style: real maps 0.50", "Width 40 is the sweet spot on this data"], summary: { angle_err: 6.3, real_bal: 0.5, val_loss: 0.12 } },
  { name: "front-v2", task: "depth", title: "Creatures, normals only", at: "2026-10-10T12:10", datasets: ["creatures-4k"], width: 24, epochs: 16, q: 0.5,
    changes: ["Front view, creatures"], why: "Do pictures get plausible relief from synthetic creatures?", findings: ["Puffy, plausible reliefs", "White parts drop out"], summary: { angle_err: 11.4, val_loss: 0.22 } },
  { name: "front-v3", task: "depth", title: "+ flat-white parts, occupancy", at: "2026-10-10T13:30", parent: "front-v2", datasets: ["creatures-4k"], width: 40, epochs: 18, q: 0.6, cfg: { WHITE_SHARE: 0.4, occupancy: true },
    changes: ["+ flat-white parts (40%)", "+ occupancy channel", "Width 24 → 40"], why: "Give white bellies a surface.", findings: ["White bellies get normals", "Occupancy leaves holes: replaced by a flood-fill silhouette"], summary: { angle_err: 8.7, val_loss: 0.18 } },
  { name: "front-v4", task: "depth", title: "+ depth output", at: "2026-10-10T15:00", parent: "front-v3", datasets: ["creatures-4k"], width: 40, epochs: 18, q: 0.6, depth: "pillow", cfg: { occupancy: false, depth_loss: 0.1 },
    changes: ["+ depth channel (mean-removed L1 ×0.1)", "Occupancy off, flood-fill silhouette"], why: "A height field from normals can't put a head behind a body.", findings: ["Silhouette clean", "Depth is a pillow: no part layering"], summary: { angle_err: 9.1, depth_err: 0.85, val_loss: 0.2 } },
  { name: "faces-v1b", task: "faces", title: "Five faces + rule-labelled real maps", at: "2026-10-10T16:40", parent: "map-v6", datasets: ["maps-12k", "rooms-3k", "real-maps", "testset"], width: 40, epochs: 24, q: 0.82, chair: 0.65, cfg: { head: "faces", rule_labels: 1 },
    changes: ["Normals head → 5-face classifier", "+ real maps labelled by the plan rule"], why: "Clean boxes and roofs in 3D instead of soft normals.", findings: ["Houses become boxes with roofs", "Test set 82.5%, but chairs stay 36% (copies the rule)", "Real maps 0.98 is circular"], summary: { angle_err: 7.6, real_bal: 0.98, test_acc: 0.825, obj_mean: 0.65, val_loss: 0.11 },
    test: { cls: [0.91, 0.8, 0.7, 0.62, 0.6], chair: 0.36 }, real: { circular: true } },
  { name: "front-v5", task: "depth", title: "+ 4,000 posed creatures", at: "2026-10-10T18:30", parent: "front-v4", datasets: ["creatures-4k", "posed-4k"], width: 40, epochs: 18, q: 0.62, depth: "layered", posed: true, cfg: { POSED_SHARE: 0.5 },
    changes: ["+ posed creatures: parts at clearly different depths (50%)"], why: "The pillow needs examples of real layering.", findings: ["Layering works: heads 2–11px behind, bellies and feet 4–7px in front"], summary: { angle_err: 9.6, depth_err: 0.92, val_loss: 0.21 } },
  { name: "faces-v2b", task: "faces", title: "Furniture rule labels at 15%", at: "2026-10-10T20:10", parent: "faces-v1b", datasets: ["maps-12k", "rooms-3k", "real-maps", "testset"], width: 40, epochs: 24, q: 0.68, chair: 0.6, cfg: { furniture_label_weight: 0.15 },
    changes: ["Furniture rule labels down-weighted to 15%"], why: "Keep the rule's help without its chair mistake.", findings: ["Test set 68%: worse"], summary: { angle_err: 7.5, real_bal: 0.98, test_acc: 0.68, obj_mean: 0.57, val_loss: 0.12 },
    test: { cls: [0.8, 0.58, 0.62, 0.55, 0.55], chair: 0.4 }, real: { circular: true } },
  { name: "faces-v0", task: "faces", title: "No tile labels at all", at: "2026-10-10T22:00", parent: "faces-v1b", datasets: ["maps-12k", "rooms-3k", "testset"], width: 40, epochs: 24, q: 0.62, chair: 0.2, cfg: { rule_labels: 0, furniture_label_weight: 0 },
    changes: ["Rule labels off"], why: "An honest real-map score, and does the model fix chairs by itself?", findings: ["Chairs 36% → 55%", "Tables and shelves worse: synthetic scenes don't teach furniture", "Real maps 0.50 (honest)"], summary: { angle_err: 7.6, real_bal: 0.5, test_acc: 0.65, obj_mean: 0.6, val_loss: 0.13 },
    test: { cls: [0.74, 0.56, 0.6, 0.52, 0.5], chair: 0.55 }, real: { circular: false } },
  { name: "faces-v3", task: "faces", title: "+ 3,000 furniture rooms, furniture labels off", at: "2026-10-11T04:50", parent: "faces-v0", datasets: ["maps-12k", "rooms-3k", "furniture-3k", "testset"], width: 40, epochs: 24, q: 0.7, running: 14, cfg: { FURNITURE_SHARE: 0.25, rule_labels: 1, furniture_label_weight: 0 },
    changes: ["+ 3,000 game-style furniture rooms", "Rule labels back on except furniture"], why: "Keep tables and shelves high while chairs stay fixed.", findings: [], summary: { val_loss: 0.14, angle_err: 8.1, test_acc: null } },
];
const stamp = (at: string): string => at.slice(0, 10).replaceAll("-", "") + "-" + at.slice(11, 16).replace(":", "");
const runId = (name: string): string => { const s = SPECS.find((x) => x.name === name)!; return `${stamp(s.at)}-${s.name}`; };
const iso = (t: number): string => new Date(t).toISOString().replace(".000Z", "Z");
const NOW = Date.parse("2026-10-11T05:42:00Z");

function archFor(c: number, outCh: number): Record<string, unknown> {
  const w = [c, Math.round((c * 5) / 3), Math.round((c * 8) / 3), c * 4];
  const conv = (i: number, o: number): number => i * o * 9 + o, dbl = (i: number, o: number): number => conv(i, o) + conv(o, o);
  const nodes = [
    { id: "e1", op: "conv3x3×2", out: [w[0], 48, 48], params: dbl(4, w[0]!) },
    { id: "e2", op: "pool + conv3x3×2", out: [w[1], 24, 24], params: dbl(w[0]!, w[1]!) },
    { id: "e3", op: "pool + conv3x3×2", out: [w[2], 12, 12], params: dbl(w[1]!, w[2]!) },
    { id: "mid", op: "pool + conv3x3×2", out: [w[3], 6, 6], params: dbl(w[2]!, w[3]!) },
    { id: "d3", op: "up + cat + conv3x3×2", out: [w[2], 12, 12], params: dbl(w[3]! + w[2]!, w[2]!) },
    { id: "d2", op: "up + cat + conv3x3×2", out: [w[1], 24, 24], params: dbl(w[2]! + w[1]!, w[1]!) },
    { id: "d1", op: "up + cat + conv3x3×2", out: [w[0], 48, 48], params: dbl(w[1]! + w[0]!, w[0]!) },
    { id: "head", op: "conv1x1", out: [outCh, 48, 48], params: w[0]! * outCh + outCh },
  ];
  const params = nodes.reduce((s, n) => s + n.params, 0);
  return { params, bytes_fp16: params * 2, input: [4, 48, 48], nodes, skips: [["e1", "d1"], ["e2", "d2"], ["e3", "d3"]] };
}
const OUT_CH = { normals: 3, faces: 5, depth: 4 };

function configFor(s: Spec): Record<string, unknown> {
  const parent = s.parent ? SPECS.find((x) => x.name === s.parent) : undefined;
  const base = parent ? configFor(parent) : { lr: 0.002, crop: 48, batch: 32, optimizer: "AdamW, one-cycle", scenes: 1000, style: "hand-picked",
    losses: { normals: "1-cos, object ×4", faces: "cross-entropy", occupancy: "BCE ×0.5", depth: "mean-removed L1 ×0.1" }, ROOM_SHARE: 0, FURNITURE_SHARE: 0, WHITE_SHARE: 0, POSED_SHARE: 0 };
  return { ...base, ...s.cfg, width: s.width, epochs: s.epochs };
}

/** A per-class confusion matrix whose rows match the given accuracies; mistakes go mostly to related faces. */
function confusion(acc: number[]): number[][] {
  const N = [4200, 2600, 900, 300, 300];
  return acc.map((a, t) => {
    const wt: number[] = acc.map((_, p) => (p === t ? 0 : t <= 1 && p <= 1 ? 4 : t >= 2 && p >= 2 ? 2 : 1));
    const tot = wt.reduce((x, y) => x + y, 0), wrong = N[t]! * (1 - a);
    return wt.map((x, p) => (p === t ? Math.round(N[t]! * a) : Math.round((wrong * x) / tot)));
  });
}
const TEST_OBJECTS: [string, string, string, string][] = [
  ["reds-shelf", "Red's house, bookshelf", "REDS_HOUSE_1F", "0,0,2,2"], ["reds-tv", "Red's house, TV", "REDS_HOUSE_1F", "3,0,1,2"],
  ["reds-table", "Red's house, table", "REDS_HOUSE_1F", "1,2,2,2"], ["reds-chair-1", "Red's house, chair", "REDS_HOUSE_1F", "2,4,2,2"],
  ["reds-chair-2", "Red's house, chair (right)", "REDS_HOUSE_1F", "3,3,1,1"], ["oak-shelf-l", "Oak's lab, left shelves", "OAKS_LAB", "0,0,2,2"],
  ["oak-shelf-r", "Oak's lab, right shelves", "OAKS_LAB", "3,0,2,2"], ["oak-table", "Oak's lab, table", "OAKS_LAB", "1,4,2,1"],
  ["oak-balls", "Oak's lab, Poké Ball table", "OAKS_LAB", "3,1,2,1"], ["oak-pc", "Oak's lab, computer", "OAKS_LAB", "0,1,1,1"],
  ["center-counter", "Pokécenter, counter", "VIRIDIAN_POKECENTER", "1,1,5,1"], ["center-bench", "Pokécenter, bench", "VIRIDIAN_POKECENTER", "0,4,1,2"],
  ["center-pc", "Pokécenter, PC", "VIRIDIAN_POKECENTER", "6,1,1,1"],
];
const REAL_MAPS = ["PALLET_TOWN", "VIRIDIAN_CITY", "PEWTER_CITY", "CERULEAN_CITY", "REDS_HOUSE_1F", "BLUES_HOUSE", "OAKS_LAB", "VIRIDIAN_MART"];

type MetricRow = { ts: string; step: number; epoch: number; split: string; metrics: Record<string, number | null> };
function metricsFor(s: Spec, start: number, epochSecs: number): MetricRow[] {
  const rows: MetricRow[] = [], spe = 60, total = s.epochs * spe, last = s.running ?? s.epochs, peak = 0.002;
  const fin = s.summary, ang = (fin.angle_err as number | null) ?? 8, vl = (fin.val_loss as number | null) ?? 0.15;
  const cls = s.test?.cls ?? [0.9, 0.82, 0.74, 0.66, 0.64];
  for (let ep = 1; ep <= last; ep++) {
    for (let k = 15; k <= spe; k += 15) {
      const step = (ep - 1) * spe + k, t = step / total;
      const lr = t < 0.3 ? peak * (0.04 + 0.96 * (t / 0.3)) : peak * 0.5 * (1 + Math.cos((Math.PI * (t - 0.3)) / 0.7));
      rows.push({ ts: iso(start + (step / spe) * epochSecs * 1000), step, epoch: ep, split: "train", metrics: { loss: r4(vl * 0.85 * (1 + 3 * Math.exp(-5 * t)) * (1 + gauss() * 0.06)), lr: Number(lr.toPrecision(4)) } });
    }
    const t = ep / s.epochs, decay = Math.exp(-4 * t) - Math.exp(-4), wob = (): number => 1 + gauss() * 0.02;
    const m: Record<string, number | null> = { val_loss: r4(vl * (1 + 2.2 * decay) * wob()), angle_err: r4(ang * (1 + 1.6 * decay) * wob()) };
    if (s.task === "normals" && fin.real_bal != null) m.real_bal = r4(clamp((fin.real_bal as number) - 0.12 * decay + gauss() * 0.01, 0, 1));
    if (s.task === "faces") {
      cls.forEach((a, c) => { m[`acc/${FACES[c]}`] = r4(clamp(Math.min(0.97, a + 0.1) - 0.3 * decay + gauss() * 0.01, 0, 1)); });
      m.acc = r4(FACES.reduce((x, f) => x + (m[`acc/${f}`] as number), 0) / 5);
    }
    if (s.depth) m.depth_err = r4(((fin.depth_err as number) ?? 0.9) * (1 + 1.5 * decay) * wob());
    rows.push({ ts: iso(start + ep * epochSecs * 1000), step: ep * spe, epoch: ep, split: "val", metrics: m });
  }
  return rows;
}

// ---------- write the runs ----------
const index = { runs: [] as Record<string, unknown>[] };
for (const s of SPECS) {
  const id = runId(s.name), dir = `runs/${id}`, start = Date.parse(s.at + ":00Z");
  const epochSecs = s.task === "faces" ? 220 : s.task === "depth" ? 95 : 140;
  const trainEnd = start + s.epochs * epochSecs * 1000, done = start + s.epochs * epochSecs * 1000 + 25 * 60_000;
  const running = s.running !== undefined, updated = running ? NOW : done;
  const evals: string[] = [], images: { path: string; caption: string; kind: string }[] = [];

  if (s.task === "depth") {
    const items = Array.from({ length: 6 }, (_, i) => {
      const posed = s.posed && i % 2 === 1, ds = posed ? "posed-4k" : "creatures-4k";
      return picItem(`${dir}/preds`, "pics", i, `synth:${ds}:${100 + i * 37}`, posed ? `Posed creature ${i + 1}` : `Creature ${i + 1}`, creature(!!posed), ((s.summary.angle_err as number) / 57) * 0.9, s.depth ?? "none");
    });
    putJson(`${dir}/preds/pics.json`, { schema: 1, title: "Synthetic creatures (held out)", view: "pic", layers: {
      input: { label: "Game-style art", encoding: "rgb" }, pred: { label: "Predicted normals", encoding: "normals" },
      ...(s.depth ? { depth: { label: "Predicted depth", encoding: "depth" } } : {}), err: { label: "Normal error", encoding: "error" } }, items });
  } else if (!running) {
    const style = s.name === "pilot" ? "town" : "room";
    const items = Array.from({ length: 6 }, (_, i) => mapItem(`${dir}/preds`, "synthetic-val", i, `synth:${s.datasets[0]}:${i * 53 + 7}`, `Synthetic ${i % 2 ? "room" : "town"} ${i + 1}`, mapScene(i % 2 || style === "room" && i % 3 === 0 ? "room" : "town"), "normals", s.q, s.chair ?? 0.6, s.flat));
    putJson(`${dir}/preds/synthetic-val.json`, { schema: 1, title: "Synthetic validation scenes", view: "map", layers: {
      input: { label: "Game-style art", encoding: "rgb" }, truth: { label: "True normals", encoding: "normals", truth: true },
      pred: { label: "Predicted normals", encoding: "normals" }, err: { label: "Angle error", encoding: "error" } }, items: items.map(strip) });
  }

  const faceLayers = { input: { label: "Game art", encoding: "rgb" }, truth: { label: "Hand-made faces", encoding: "faces", truth: true },
    pred: { label: "Prediction", encoding: "faces" }, normals: { label: "Prediction as normals", encoding: "normals" }, err: { label: "Disagreement", encoding: "error" } };
  if (s.test && !running) {
    // The images are synthetic; the first two items carry real map ids anyway so "open in editor" can be exercised.
    const ids = ["map:REDS_HOUSE_1F:2,4,2,2", "map:OAKS_LAB:0,0,5,3"];
    const items = Array.from({ length: 8 }, (_, i) => mapItem(`${dir}/preds`, "testset", i, ids[i] ?? `synth:testset:${i}`, i < 2 ? (i ? "Oak's lab, back wall and shelves" : "Red's house, table and chairs") : `Furniture room ${i - 1}`, mapScene("furniture"), "faces", s.q, s.chair ?? 0.5));
    const first = items[0]!;
    putJson(`${dir}/preds/testset.json`, { schema: 1, title: "Hand-made test set", view: "map", layers: faceLayers, items: items.map(strip) });
    // A side-by-side for the run card: input | truth | prediction, 2× up.
    const W = first.width, H = first.height, inp = rgbFromShades(first.sc!.shade), truth = facesRgb(first.sc!.face), pr = facesRgb(first.pred!);
    const cmp = new Uint8Array(W * 3 * 2 * H * 2 * 3);
    for (let y = 0; y < H * 2; y++) for (let x = 0; x < W * 3 * 2; x++) {
      const panel = Math.floor(x / (W * 2)), sx = (x % (W * 2)) >> 1, k = ((y >> 1) * W + sx) * 3;
      cmp.set((panel === 0 ? inp : panel === 1 ? truth : pr).subarray(k, k + 3), (y * W * 6 + x) * 3);
    }
    put(`${dir}/images/compare.png`, png(W * 6, H * 2, 3, cmp));
    images.push({ path: "images/compare.png", caption: "Test item: art, hand-made faces, prediction", kind: "compare" });
    const acc = s.summary.test_acc as number, om = s.summary.obj_mean as number;
    putJson(`${dir}/evals/testset.json`, { schema: 1, name: "testset", title: "Hand-made test set", split: "testset", circular: false,
      overall: { acc, obj_mean: om }, perClass: { acc: Object.fromEntries(FACES.map((f, c) => [f, s.test!.cls[c]])) },
      confusion: { labels: FACES, matrix: confusion(s.test.cls) },
      perObject: TEST_OBJECTS.map(([oid, title, map, area]) => ({ id: oid, title, sample: `map:${map}:${area}`,
        scores: { acc: r4(oid.includes("chair") ? s.test!.chair + rnd(-0.03, 0.03) : clamp(om + rnd(-0.15, 0.2) - (s.name === "faces-v0" && /table|shelf|counter/.test(oid) ? 0.15 : 0), 0, 1)) } })),
      preds: ["preds/testset.json"] });
    evals.push("testset");
  }
  if (s.real && !running) {
    const ids = ["map:PALLET_TOWN:2,3,4,3", "map:VIRIDIAN_CITY:6,4,4,3"];
    const items = Array.from({ length: 6 }, (_, i) => mapItem(`${dir}/preds`, "real-maps", i, ids[i] ?? `synth:real-maps:${i}`, i < 2 ? (i ? "Viridian City, mart" : "Pallet Town, Red's house") : `Town ${i - 1}`, mapScene("town"), "faces", s.q, s.chair ?? 0.5));
    putJson(`${dir}/preds/real-maps.json`, { schema: 1, title: "Real maps (rule labels)", view: "map", layers: { ...faceLayers, truth: { label: "Rule labels", encoding: "faces", truth: true } }, items: items.map(strip) });
    const bal = s.summary.real_bal as number, cls = [0, 1, 2, 3, 4].map((c) => r4(clamp(bal + (c === 0 ? 0.08 : c === 1 ? -0.04 : rnd(-0.1, 0.02)), 0, 1)));
    putJson(`${dir}/evals/real-maps.json`, { schema: 1, name: "real-maps", title: "22 real maps, graded by the plan rule", split: "real-maps", circular: s.real.circular,
      overall: { bal_acc: bal, acc: r4(clamp(bal + 0.03, 0, 1)) }, perClass: { acc: Object.fromEntries(FACES.map((f, c) => [f, cls[c]])) },
      confusion: { labels: FACES, matrix: confusion(cls) },
      perObject: REAL_MAPS.map((m) => ({ id: m.toLowerCase(), title: m, sample: `map:${m}`, scores: { bal_acc: r4(clamp(bal + rnd(-0.12, 0.08), 0, 1)) } })),
      preds: ["preds/real-maps.json"] });
    evals.push("real-maps");
  }

  const stage = (name: string, st: string, status: string, a: number, b?: number): Record<string, unknown> => ({ name, stage: st, status, started: iso(a), ...(b ? { finished: iso(b) } : {}) });
  const stages = running
    ? [{ name: "train", stage: "train", status: "running", started: iso(start), progress: { done: s.running, total: s.epochs, unit: "epoch", eta: iso(start + s.epochs * epochSecs * 1000) } },
       { name: "eval", stage: "eval", status: "queued" }, { name: "render3d", stage: "3d", status: "queued" }]
    : [stage("train", "train", "done", start, trainEnd), stage("eval", "eval", "done", trainEnd, trainEnd + 15 * 60_000), stage("render3d", "3d", "done", trainEnd + 15 * 60_000, done)];
  const parent = s.parent ? runId(s.parent) : null;
  const run = {
    schema: 1, id, task: s.task, name: s.name, title: s.title, status: running ? "running" : "done",
    created: iso(start - 60_000), started: iso(start), updated: iso(updated), ...(running ? {} : { finished: iso(done) }), host: s.name.startsWith("faces-v3") ? "nick-mbp" : "cloud-4cpu",
    parent, changes: s.changes, why: s.why, datasets: s.datasets, config: configFor(s), arch: archFor(s.width, OUT_CH[s.task]), stages,
    ...(s.task === "faces" ? { classes: FACES } : {}), summary: s.summary, evals, images, findings: s.findings,
  };
  putJson(`${dir}/run.json`, run);
  put(`${dir}/metrics.jsonl`, metricsFor(s, start, epochSecs).map((r) => JSON.stringify(r)).join("\n") + "\n");
  index.runs.push({ id, task: s.task, status: run.status, title: s.title, name: s.name, parent, datasets: s.datasets, started: run.started, updated: run.updated, summary: s.summary });
}

// ---------- datasets ----------
const DATASETS: { id: string; title: string; kind: string; view: "map" | "pic"; counts: Record<string, number>; at: string; parent?: string; cfg: Record<string, unknown>; style?: "town" | "room" | "furniture"; posed?: boolean }[] = [
  { id: "pilot-1k", title: "1,000 hand-styled map scenes", kind: "synthetic", view: "map", counts: { "map scenes": 1000 }, at: "2026-10-10T01:00", cfg: { style: "hand-picked" } },
  { id: "maps-6k", title: "6,000 calibrated map scenes", kind: "synthetic", view: "map", counts: { "map scenes": 6000 }, at: "2026-10-10T02:40", parent: "pilot-1k", cfg: { style: "calibrated", dither: 0.3, outlines: true } },
  { id: "maps-12k", title: "12,000 map scenes with game-like ground", kind: "synthetic", view: "map", counts: { "map scenes": 12000 }, at: "2026-10-10T05:30", parent: "maps-6k", cfg: { style: "calibrated", ground_textures: true }, style: "town" },
  { id: "rooms-3k", title: "3,000 indoor rooms", kind: "synthetic", view: "map", counts: { rooms: 3000 }, at: "2026-10-10T05:50", cfg: { back_wall: true, hangings: true } },
  { id: "furniture-3k", title: "3,000 game-style furniture rooms", kind: "synthetic", view: "map", counts: { rooms: 3000, tables: 4100, chairs: 7900, counters: 1200 }, at: "2026-10-11T03:30", parent: "rooms-3k", cfg: { table_top: "big", table_front: "short" }, style: "furniture" },
  { id: "creatures-4k", title: "4,000 creatures, front view", kind: "synthetic", view: "pic", counts: { creatures: 4000 }, at: "2026-10-10T11:40", cfg: { WHITE_SHARE: 0.4 } },
  { id: "posed-4k", title: "4,000 posed creatures", kind: "synthetic", view: "pic", counts: { "posed creatures": 4000 }, at: "2026-10-10T17:40", parent: "creatures-4k", cfg: { head_back_px: [8, 14], lean: true }, posed: true },
  { id: "real-maps", title: "22 real maps, rule-labelled", kind: "rom", view: "map", counts: { maps: 22 }, at: "2026-10-10T02:00", cfg: { labels: "normals.ts seedNormal" } },
  { id: "testset", title: "Hand-made test set (13 objects)", kind: "handmade", view: "map", counts: { objects: 13, maps: 3 }, at: "2026-10-11T00:30", cfg: { source: "drawn by eye from map images" } },
];
for (const d of DATASETS) {
  const dir = `datasets/${d.id}`, t = Date.parse(d.at + ":00Z");
  let samples: string[] = [];
  if (d.style || d.posed) {
    const items = Array.from({ length: 8 }, (_, i) => d.view === "pic"
      ? picItem(dir, "samples", i, `synth:${d.id}:${i}`, `Sample ${i}`, creature(!!d.posed), 0, "none", true)
      : mapItem(dir, "samples", i, `synth:${d.id}:${i}`, `Sample ${i}`, mapScene(d.style!), "data"));
    const layers = d.view === "pic"
      ? { input: { label: "Rendered art", encoding: "rgb" }, normals: { label: "True normals", encoding: "normals", truth: true }, depth: { label: "True depth", encoding: "depth", truth: true }, mask: { label: "Mask", encoding: "mask", truth: true } }
      : { input: { label: "Rendered art", encoding: "rgb" }, truth: { label: "True faces", encoding: "faces", truth: true }, normals: { label: "True normals", encoding: "normals", truth: true } };
    putJson(`${dir}/samples.json`, { schema: 1, title: d.title, view: d.view, layers, items });
    samples = ["samples.json"];
  }
  putJson(`${dir}/dataset.json`, { schema: 1, id: d.id, title: d.title, kind: d.kind, view: d.view, status: "done", created: iso(t), updated: iso(t + 40 * 60_000),
    config: d.cfg, counts: d.counts, parent: d.parent ?? null, samples });
}

// ---------- index, events, a flag ----------
const metricDefs: Record<string, Record<string, unknown>> = {
  loss: { label: "Training loss", better: "lower", group: "loss", help: "How wrong the model is on the batch it's learning from right now. It should fall and flatten." },
  val_loss: { label: "Validation loss", better: "lower", group: "loss", help: "The same measure on scenes it never trains on. If this rises while training loss falls, it's memorising." },
  lr: { label: "Learning rate", group: "lr", help: "How big each learning step is. It ramps up, then glides down (one-cycle)." },
  angle_err: { label: "Normal error", unit: "°", better: "lower", group: "angle", help: "Average angle between the predicted and true surface direction on synthetic scenes." },
  test_acc: { label: "Hand-made test set", unit: "%", better: "higher", primary: true, group: "accuracy", help: "Share of pixels whose face matches the hand-made boxes. Our only independent truth." },
  obj_mean: { label: "Test set, per object", unit: "%", better: "higher", group: "accuracy", help: "The test score averaged per object, so one big shelf can't hide a wrong chair." },
  real_bal: { label: "Real maps (balanced)", better: "higher", group: "accuracy", help: "Accuracy on 22 real maps against the rule labels, each class weighted equally. Circular if the model trained on those labels." },
  bal_acc: { label: "Balanced accuracy", better: "higher", group: "accuracy", help: "Accuracy with each class counted equally, so rare faces matter as much as floor." },
  acc: { label: "Accuracy", unit: "%", better: "higher", group: "accuracy", help: "Share of pixels given the right face." },
  depth_err: { label: "Depth error", unit: "px", better: "lower", group: "depth", help: "How far, in pixels, the predicted depth is from the truth after lining up their averages." },
};
for (const f of FACES) metricDefs[`acc/${f}`] = { label: `Accuracy: ${f}`, unit: "%", better: "higher", group: "per class", help: `Share of ${f} pixels given the right face.` };

const v3 = runId("faces-v3");
putJson("index.json", {
  schema: 1, updated: iso(NOW), runs: index.runs,
  datasets: DATASETS.map((d) => ({ id: d.id, title: d.title, kind: d.kind, status: "done", updated: iso(Date.parse(d.at + ":00Z") + 40 * 60_000) })),
  best: { normals: runId("map-v6"), faces: runId("faces-v1b"), depth: runId("front-v5") },
  ops: { doing: "Training faces-v3 (epoch 14 of 24)", why: "Testing whether game-style furniture rooms can replace the furniture rule labels: tables high, chairs fixed.",
    next: ["Score faces-v3 on the hand-made test set", "Sample tiles per label and have Nick confirm them", "Extend the test set with Nick's relief-editor paintings"],
    runs: [v3], lastImproved: { normals: "2026-10-10T09:40:00Z", faces: "2026-10-10T18:20:00Z", depth: "2026-10-10T20:10:00Z" }, updated: iso(NOW) },
  metrics: metricDefs,
});

const ev = (ts: string, kind: string, title: string, body: string, extra: Record<string, unknown> = {}): string => JSON.stringify({ ts: ts + ":00Z", kind, title, body, ...extra });
const firstPred = (name: string, set: string, layer: string): string => `runs/${runId(name)}/preds/${set}/0/${layer}`;
put("events.jsonl", [
  ev("2026-10-10T02:40", "finding", "The pilot sees everything as flat ground", "On real maps it scores 0.48, about what you'd get by guessing from each pixel's shade alone (0.47).\n\nThe hand-picked styles don't look enough like the game.", { runs: [runId("pilot")], tags: ["maps"] }),
  ev("2026-10-10T03:00", "decision", "Calibrate the renderer against real maps first", "We measured which shades the game uses for tops, fronts and roofs on 22 labelled maps, and fitted our renderer to match.\n\n- The game's light is soft and mostly ambient\n- Fronts are as bright as tops\n- **Outlines and layout carry the shape, not shading**", { runs: [runId("map-v2")], tags: ["calibration"] }),
  ev("2026-10-10T09:40", "milestone", "map-v6 beats shade-alone guessing", "Same data as map-v5, but a wider model (width 40): real maps 0.57 against 0.47 for shade alone. The model was too small, not the data too poor.", { runs: [runId("map-v6")], images: [{ path: firstPred("map-v6", "synthetic-val", "pred.png"), caption: "map-v6 normals on a synthetic town" }] }),
  ev("2026-10-10T11:50", "finding", "Wider is worse: width 64 learns our synthetic style", "map-v7 does better on synthetic scenes (6.3°) but worse on real maps (0.50). Bigger models need more varied data, not more of the same.", { runs: [runId("map-v7"), runId("map-v6")] }),
  ev("2026-10-10T15:40", "decision", "Silhouettes by flood fill, not a learned channel", "White pixels connected to the frame edge are background; everything else gets a surface. The learned occupancy channel left holes in white bellies.", { runs: [runId("front-v3"), runId("front-v4")], tags: ["pictures"] }),
  ev("2026-10-10T17:50", "finding", "faces-v1b's 98% on real maps doesn't count", "It's graded by the same rule labels it trained on, so it's **circular**. On the hand-made test set it scores 82.5%, the best so far, but chairs stay at 36% because the rule calls chair seats fronts.", { runs: [runId("faces-v1b")], images: [{ path: `runs/${runId("faces-v1b")}/images/compare.png`, caption: "Art, hand-made faces, prediction" }] }),
  ev("2026-10-10T20:10", "milestone", "Pictures get layers: heads sit behind bellies", "front-v5 trained on posed creatures puts heads 2–11px behind the body and bellies and feet 4–7px in front. front-v4 made a pillow.", { runs: [runId("front-v5"), runId("front-v4")], images: [{ path: firstPred("front-v5", "pics", "pred.png"), caption: "front-v5 normals" }] }),
  ev("2026-10-11T01:22", "question", "Are the tile labels right?", "Nick: many tile labels are wrong and have never been checked. How should we validate them before trusting any score built on them?\n\n- Sample tiles per label\n- Confirm or correct them in the relief editor\n- Decide per label: keep, fix or drop", { tags: ["labels"] }),
  ev("2026-10-11T02:30", "finding", "Without tile labels, chairs go from 36% to 55%", "But tables and shelves get worse, because our synthetic scenes don't teach furniture. Test set 65% overall, real maps 0.50 (an honest score this time).", { runs: [runId("faces-v0"), runId("faces-v1b")], images: [{ path: `runs/${runId("faces-v0")}/images/compare.png`, caption: "faces-v0 on Red's house" }] }),
  ev("2026-10-11T04:45", "decision", "faces-v3: furniture rooms in, furniture labels out", "3,000 game-style furniture rooms (big table tops, short fronts, chairs) replace the furniture rule labels. If tables stay high and chairs stay fixed, we drop the furniture labels altogether.", { runs: [v3], tags: ["faces"] }),
  ev("2026-10-11T05:42", "status", "faces-v3 at epoch 14 of 24", "About 220 s an epoch; scoring on the test set follows.", { runs: [v3] }),
].join("\n") + "\n");

putJson("flags/20261011-071502-chair.json", { schema: 1, id: "20261011-071502-chair", created: "2026-10-11T05:15:02Z", kind: "wrong-label", status: "open",
  note: "Chair seat reads as FRONT, it's a top.", run: runId("faces-v1b"),
  sample: { manifest: `runs/${runId("faces-v1b")}/preds/testset.json`, id: "map:REDS_HOUSE_1F:2,4,2,2", layer: "pred" }, box: [12, 30, 8, 4] });

// ---------- output ----------
let bytes = 0;
for (const d of files.values()) bytes += d.length;
if (outDir) {
  for (const [p, d] of files) { const f = join(outDir, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, d); }
  console.log(`wrote ${files.size} files (${(bytes / 1024).toFixed(0)} KiB) to ${outDir}`);
}
if (baseUrl) {
  let token = process.env.POKEHD_ADMIN_TOKEN?.trim();
  if (!token) token = readFileSync(arg("--token-file") ?? join(homedir(), ".config/pokehd/admin-token"), "utf8").trim();
  const TYPES: Record<string, string> = { json: "application/json", jsonl: "application/x-ndjson", png: "image/png", f32: "application/octet-stream" };
  const send = async (p: string): Promise<void> => {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/admin/lab/${p}`, { method: "PUT", body: new Uint8Array(files.get(p)!),
      headers: { authorization: `Bearer ${token}`, "content-type": TYPES[p.slice(p.lastIndexOf(".") + 1)] ?? "application/octet-stream" } });
    if (!res.ok) throw new Error(`PUT ${p}: HTTP ${res.status}`);
  };
  // index.json last, so the dashboard never lists a run whose files aren't there yet.
  const queue = [...files.keys()].filter((p) => p !== "index.json");
  await Promise.all(Array.from({ length: 6 }, async () => { for (let p = queue.shift(); p; p = queue.shift()) await send(p); }));
  await send("index.json");
  console.log(`uploaded ${files.size} files (${(bytes / 1024).toFixed(0)} KiB) to ${baseUrl}`);
}
