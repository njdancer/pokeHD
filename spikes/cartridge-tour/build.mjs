// Builds the tour page: runs the model in Node on the real ROM to find every ROM byte the tour
// touches, and embeds only those (plus a few whole tables shown for context) together with the RAM
// as it was when Red stepped out of his house (from the SameBoy recording). The output holds ROM
// bytes, so it goes to out/ (gitignored) and is published only as a private artifact.
//   node build.mjs <trace dir> <syms.json>
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Machine } from "./src/model.js";

const [traceDir, symsPath] = process.argv.slice(2);
const here = (p) => new URL(p, import.meta.url);
const ROM = readFileSync(here("../../rom/pokeblue.gb"));
const syms = JSON.parse(readFileSync(symsPath, "utf8"));
const S = {};
for (const [k, v] of Object.entries(syms)) {
  const [b, a] = v.split(":").map((x) => parseInt(x, 16));
  S[k] = a < 0x4000 || a >= 0x8000 ? a : (b << 16) | a;
}
S.FIRST_STILL_SPRITE = 0x3d;
const romOffOf = (name) => {
  const v = syms[name];
  const [b, a] = v.split(":").map((x) => parseInt(x, 16));
  return a < 0x4000 ? a : b * 0x4000 + (a - 0x4000);
};

// RAM when LoadMapData starts (VRAM from the first moment the screen was off)
const events = JSON.parse(readFileSync(`${traceDir}/events.json`, "utf8"));
const at = (name) => events.find((e) => e.name === name && e.mem && e.frame >= 400 && e.map === 0);
const mem = (e) => Buffer.from(e.mem, "base64");
const ram = new Uint8Array(mem(at("LoadMapData")));
ram.set(mem(at("LoadTextBoxTilePatterns")).subarray(0, 0x2000), 0);

// Run the tour's script plus random walks to collect every ROM byte the page can read.
const reads = new Set();
const writes = new Set();
const looks = new Set();
const runScript = (walks) => {
  const m = new Machine({ rom: (o) => ROM[o], ram, S });
  const w = m.w.bind(m);
  m.w = (a, v, p, s) => { writes.add(a & 0xffff); w(a, v, p, s); };
  m.LoadMapData();
  m.enterMap();
  m.step("down", true);
  m.idle(1);
  for (const d of ["right", "right", "right", "up", "up", "up"]) { m.step(d); m.idle(1); }
  let seed = walks;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  for (let i = 0; i < walks * 60; i++) {
    const d = ["up", "down", "left", "right"][Math.floor(rnd() * 4)];
    const y = m.mem[S.wYCoord], x = m.mem[S.wXCoord];
    if ((d === "up" && y <= 2) || (d === "down" && y >= 17) || (d === "left" && x <= 0) || (d === "right" && x >= 19)) continue;
    m.step(d);
  }
  for (const e of m.events) if (e.t === "look" && e.s < 0x10000) looks.add(e.s);
  for (const o of m.romReads) reads.add(o);
  return m;
};
for (let k = 1; k <= 6; k++) runScript(k);

// ROM shown for context, beyond what is read
const extra = [
  ["MapHeaderPointers", 16], ["MapHeaderBanks", 16], ["Tilesets", 36], ["Overworld_Block", 0x800],
  ["Route1_Blocks", 180], ["Overworld_GFX", 0x600], ["SpriteFacingAndAnimationTable", 0x80],
];
for (const [n, len] of extra) for (let i = 0; i < len; i++) reads.add(romOffOf(n) + i);
for (let i = 0x134; i < 0x150; i++) reads.add(i); // the cartridge header

// group into ranges (gaps of up to 8 bytes are filled so tables stay whole)
const sorted = [...reads].sort((a, b) => a - b);
const ranges = [];
for (const o of sorted) {
  const r = ranges[ranges.length - 1];
  if (r && o - r[1] <= 8 && (o >> 14) === (r[0] >> 14)) r[1] = o + 1;
  else ranges.push([o, o + 1]);
}
const romRanges = ranges.map(([a, b]) => ({ o: a, d: Buffer.from(ROM.subarray(a, b)).toString("base64") }));

// labels: ROM labels inside the embedded ranges, all RAM labels
const labels = [];
for (const [k, v] of Object.entries(syms)) {
  const [b, a] = v.split(":").map((x) => parseInt(x, 16));
  if (a >= 0x8000) { labels.push([a, k]); continue; }
  const o = a < 0x4000 ? a : b * 0x4000 + (a - 0x4000);
  if (ranges.some(([x, y]) => o >= x - 0x200 && o < y)) labels.push([0x100000 + o, k]);
}
// symbols the model needs
// every quoted name in the model and the app that is a symbol
const need = new Set();
for (const f of ["src/model.js", ...readdirSync(here("src/app")).map((f) => `src/app/${f}`)])
  for (const m of readFileSync(here(f), "utf8").matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)) if (syms[m[1]]) need.add(m[1]);
for (const n of ["wYCoord", "wXCoord", "wCurMap", "PalletTown_Blocks", "Route1_Blocks", "Route21_Blocks", "Overworld_GFX", "Overworld_Block",
  "Overworld_Coll", "MapHeaderPointers", "MapHeaderBanks", "Tilesets", "RedSprite", "TextBoxGraphics", "PalletTown_Object", "LoadMapData",
  "LoadMapHeader", "LoadTileBlockMap", "LoadCurrentMapView", "DrawTileBlock", "VBlank", "AdvancePlayerSprite", "InitMapSprites",
  "LoadTilesetTilePatternData", "PrepareOAMData", "RedrawRowOrColumn", "CopyData", "FarCopyData2", "EnableLCD", "DisableLCD",
  "LoadPlayerSpriteGraphics", "CollisionCheckOnLand", "UpdateSprites", "LoadGBPal", "OverworldLoop", "hDMARoutine", "SwitchToMapRomBank",
  "LoadTextBoxTilePatterns", "LoadDestinationWarpPosition", "LoadTilesetHeader", "CopyVideoData", "LoadNorthSouthConnectionsTileMap",
  "UpdateMovingBgTiles", "MarkTownVisitedAndLoadToggleableObjects", "LoadMapSpriteTilePatterns", "InitOutsideMapSprites",
  "ScheduleEastColumnRedraw", "ScheduleWestColumnRedraw", "ScheduleNorthRowRedraw", "ScheduleSouthRowRedraw", "EnterMap",
  "CopyToRedrawRowOrColumnSrcTiles", "ScheduleColumnRedrawHelper", "CopyMapConnectionHeader", "LoadWalkingPlayerSpriteGraphics",
  "RunPaletteCommand", "VBlankCopy", "wMapViewVRAMPointer", "wTileMap", "wSurroundingTiles", "wOverworldMap", "wOverworldMapEnd",
  "wRedrawRowOrColumnSrcTiles", "wShadowOAM", "wCurrentTileBlockMapViewPointer", "wTileInFrontOfPlayer"]) need.add(n);
const Sout = { FIRST_STILL_SPRITE: 0x3d };
const fnAddr = {};
for (const n of need) if (S[n] !== undefined) { Sout[n] = S[n]; fnAddr[n] = syms[n]; }
for (const [k, v] of Object.entries(syms)) if (/^[A-Z]/.test(k) && !k.includes(".")) fnAddr[k] = v; // routine names for the HUD
const data = {
  rom: romRanges,
  ram: Buffer.from(ram).toString("base64"),
  S: Sout,
  labels,
  writes: [...writes].sort((a, b) => a - b),
  looks: [...looks],
  fnAddr: Object.fromEntries(Object.entries(fnAddr).filter(([k]) => labels.some((l) => l[1] === k) || need.has(k) || /^(Load|Draw|Update|Schedule|Copy|Init|Enable|Disable|Prepare|Redraw|Advance|Collision|Switch|VBlank|Enter|Overworld|Run|Mark|h?DMA|Far)/.test(k))),
};
mkdirSync(here("out"), { recursive: true });
const json = JSON.stringify(data);
writeFileSync(here("out/data.json"), json);
console.log("rom ranges", ranges.length, "rom bytes", ranges.reduce((n, [a, b]) => n + b - a, 0), "labels", labels.length, "json", json.length);

// assemble the page
const model = readFileSync(here("src/model.js"), "utf8").replace(/^export /gm, "");
const app = `(async () => {\n${readdirSync(here("src/app")).sort().map((f) => readFileSync(here(`src/app/${f}`), "utf8")).join("\n")}\n})();`;
const shell = readFileSync(here("src/shell.html"), "utf8");
const page = shell
  .replace("/*DATA*/", () => `window.TOUR_DATA = ${json};`)
  .replace("/*MODEL*/", () => model)
  .replace("/*APP*/", () => app);
writeFileSync(here("out/index.html"), page);
// for local testing: the same page inside the skeleton the artifact host adds
writeFileSync(here("out/preview.html"), `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>${page}</body></html>`);
console.log("page", page.length);
