// Checks the model against the real game recorded by trace.ts: every byte the model writes must
// match what the game had at the next routine boundary.
import { readFileSync } from "node:fs";
import { Machine } from "./src/model.js";

const [traceDir, symsPath] = process.argv.slice(2);
const ROM = readFileSync(new URL("../../rom/pokeblue.gb", import.meta.url));
const syms = JSON.parse(readFileSync(symsPath, "utf8"));
const S = {};
for (const [k, v] of Object.entries(syms)) {
  const [b, a] = v.split(":").map((x) => parseInt(x, 16));
  S[k] = a < 0x4000 || a >= 0x8000 ? a : (b << 16) | a;
}
const events = JSON.parse(readFileSync(`${traceDir}/events.json`, "utf8"));
const at = (name, after = 0) => events.find((e) => e.name === name && e.mem && e.frame >= after && e.map === 0);
const mem = (e) => Buffer.from(e.mem, "base64");
const start = at("LoadMapData", 400);
const ram = new Uint8Array(mem(start));
ram.set(mem(at("LoadTextBoxTilePatterns", 400)).subarray(0, 0x2000), 0); // VRAM, read while the LCD was off
const m = new Machine({ rom: (o) => ROM[o], ram, S });
const hooks = ["LoadMapHeader", "InitMapSprites", "LoadTileBlockMap", "LoadNorthSouthConnectionsTileMap", "LoadTilesetTilePatternData", "LoadCurrentMapView", "EnableLCD", "LoadPlayerSpriteGraphics"];
const seen = {};
const written = new Set();
let bad = 0;
const hex = (n, w = 4) => n.toString(16).toUpperCase().padStart(w, "0");
const compare = (label, e) => {
  const real = mem(e);
  const lcdOn = real[0x7f40] & 0x80;
  const wrong = [];
  for (const a of written) {
    if (a >= 0x8000 && a < 0xa000 && lcdOn) continue;
    if (m.mem[a] !== real[a - 0x8000]) wrong.push(a);
  }
  if (m.bank !== e.bank) console.log(`  ${label}: bank model ${hex(m.bank, 2)} real ${hex(e.bank, 2)}`);
  if (wrong.length) {
    bad += wrong.length;
    console.log(`✗ ${label}: ${wrong.length} wrong, e.g. ` + wrong.slice(0, 8).map((a) => `${hex(a)} model ${hex(m.mem[a], 2)} real ${hex(real[a - 0x8000], 2)}`).join("; "));
  } else console.log(`✓ ${label}: ${written.size} written bytes match`);
};
const origW = m.w.bind(m);
m.w = (a, v, p, s) => { written.add(a & 0xffff); origW(a, v, p, s); };
m.onCall = (name) => {
  if (!hooks.includes(name)) return;
  seen[name] = (seen[name] ?? 0) + 1;
  const e = events.filter((x) => x.name === name && x.mem && x.map === 0 && x.frame >= 400)[seen[name] - 1];
  if (e) compare(`${name}#${seen[name]}`, e);
};
m.LoadMapData();
console.log("events", m.events.length, "provs", m.provs.length, "rom bytes read", m.romReads.size, bad ? `MISMATCHES ${bad}` : "ALL OK");
