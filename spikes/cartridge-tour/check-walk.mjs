// Compares what the model shows frame by frame (scroll, palettes, BG map, tiles, Red's OAM, and the
// rendered picture) with the recorded game, as sequences of distinct states.
import { readFileSync, writeFileSync } from "node:fs";
import { Machine, renderFrame } from "./src/model.js";

const [traceDir, symsPath] = process.argv.slice(2);
const ROM = readFileSync(new URL("../../rom/pokeblue.gb", import.meta.url));
const syms = JSON.parse(readFileSync(symsPath, "utf8"));
const S = {};
for (const [k, v] of Object.entries(syms)) {
  const [b, a] = v.split(":").map((x) => parseInt(x, 16));
  S[k] = a < 0x4000 || a >= 0x8000 ? a : (b << 16) | a;
}
const events = JSON.parse(readFileSync(`${traceDir}/events.json`, "utf8"));
const frames = JSON.parse(readFileSync(`${traceDir}/frames.json`, "utf8"));
const at = (name) => events.find((e) => e.name === name && e.mem && e.frame >= 400 && e.map === 0);
const mem = (e) => Buffer.from(e.mem, "base64");
const ram = new Uint8Array(mem(at("LoadMapData")));
ram.set(mem(at("LoadTextBoxTilePatterns")).subarray(0, 0x2000), 0);
const m = new Machine({ rom: (o) => ROM[o], ram, S });
const modelStates = [];
const key = (get, pix) => {
  const parts = [get(0xff43), get(0xff42), get(0xff47), get(0xff48)];
  let bg = ""; for (let a = 0x9800; a < 0x9c00; a++) bg += String.fromCharCode(get(a));
  let tiles = 0; for (let a = 0x8000; a < 0x9800; a++) tiles = (tiles * 31 + get(a)) >>> 0;
  let oam = ""; for (let a = 0xfe00; a < 0xfe10; a++) oam += get(a).toString(16).padStart(2, "0");
  return { k: parts.join(",") + "|" + tiles + "|" + oam + "|" + bg, parts, oam, pix };
};
m.onFrameDrawn = () => { if (m.mem[0xff47] === 0xe4) modelStates.push({ ...key((a) => m.mem[a], renderFrame(m.mem)), frame: m.frame }); };
m.LoadMapData();
m.enterMap();
m.step("down", true);
m.idle(68);
for (const [d, idle] of [["right", 2], ["right", 2], ["right", 3], ["up", 2], ["up", 2], ["up", 2]]) { m.step(d); m.idle(idle); }
const realStates = [];
for (const f of frames) {
  const b = Buffer.from(f.mem, "base64");
  if (b[0x7f47] !== 0xe4 || f.frame < 470) continue;
  const rgba = Buffer.from(f.pixels, "base64");
  const pix = new Uint8Array(160 * 144);
  for (let i = 0; i < pix.length; i++) { const v = rgba[i * 4]; pix[i] = v > 200 ? 0 : v > 120 ? 1 : v > 60 ? 2 : 3; }
  realStates.push({ ...key((a) => b[a - 0x8000], pix), frame: f.frame });
}
const dedupe = (xs) => xs.filter((x, i) => i === 0 || x.k !== xs[i - 1].k);
const M = dedupe(modelStates), R = dedupe(realStates);
console.log("distinct states: model", M.length, "real", R.length);
let i = 0, j = 0, ok = 0;
while (i < M.length && j < R.length) {
  if (M[i].k === R[j].k) { ok++; i++; j++; continue; }
  console.log(`first difference at model #${i} / real #${j} (frame ${R[j].frame})`);
  console.log("  model", M[i].parts, M[i].oam, "\n  real ", R[j].parts, R[j].oam);
  const bgM = M[i].k.split("|")[3], bgR = R[j].k.split("|")[3];
  const d = []; for (let a = 0; a < 1024; a++) if (bgM[a] !== bgR[a]) d.push((0x9800 + a).toString(16));
  console.log("  bg diffs", d.length, d.slice(0, 10).join(" "), "tiles", M[i].k.split("|")[1], R[j].k.split("|")[1]);
  break;
}
console.log(`matched ${ok} states in order`);
// pixel check on the last state of each
const px = (a, b) => { let n = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) n++; return n; };
console.log("pixels differing on the matched states:", M.slice(0, ok).map((s, k) => px(s.pix, R[k].pix)).filter(Boolean).length ? M.slice(0, ok).map((s, k) => px(s.pix, R[k].pix)).join(",") : "none");
if (process.env.DUMP) {
  const show = (s) => `${s.parts.join(",")} ${s.oam.slice(0, 8)} bg${[...s.k.split("|")[3]].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 1000} t${s.k.split("|")[1] % 1000}`;
  for (let k = +process.env.DUMP; k < +process.env.DUMP + 14; k++) console.log(k, "M", M[k] ? show(M[k]) + " f" + M[k].frame : "-", "| R", R[k] ? show(R[k]) + " f" + R[k].frame : "-");
}
if (process.env.PNG) {
  const { deflateSync } = await import("node:zlib");
  const png = (pix, w, h, path) => {
    const shades = [255, 170, 85, 0];
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = shades[pix[y * w + x]]; raw.fill(v, y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3); }
    const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
    const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
  };
  for (const k of process.env.PNG.split(",").map(Number)) {
    const both = new Uint8Array(330 * 144);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { both[y * 330 + x] = M[k].pix[y * 160 + x]; both[y * 330 + 170 + x] = R[k].pix[y * 160 + x]; }
    png(both, 330, 144, `${process.env.OUTDIR}/cmp-${k}.png`);
  }
}
