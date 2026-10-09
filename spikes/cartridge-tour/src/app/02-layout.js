// ---- 02 layout: which bytes sit where on the board --------------------------------------------
// A panel is one named run of bytes drawn as a grid of cubes. Tile graphics and blocks are drawn
// as 4×4 tablets (a tile's 16 bytes, two per pixel row; a block's 16 tile numbers).
const TAB = 4.4; // tablet pitch
const LABEL_H = 2.4; // room for a panel's name above it
const PANELS = [];
const CELL = new Map(); // key -> { panel, lx, lz } (panel-local position)

const COL = {
  rom: [0.89, 0.66, 0.36],
  wram: [0.37, 0.78, 0.72],
  vram: [0.68, 0.57, 0.95],
  oam: [0.95, 0.5, 0.62],
  io: [0.73, 0.86, 0.3],
  hram: [0.73, 0.86, 0.3],
};

function makePanel(p) {
  // p: { id, title, sub, keys, kind: 'grid'|'tablet', cols|tpr, color, group, offset }
  p.cells = [];
  const off = p.offset || 0;
  let w = 0;
  let h = 0;
  p.keys.forEach((k, i) => {
    const j = i + off;
    let lx;
    let lz;
    if (p.kind === "tablet") {
      const t = Math.floor(j / 16);
      const b = j % 16;
      lx = (t % p.tpr) * TAB + (b & 3) + 0.5;
      lz = Math.floor(t / p.tpr) * TAB + (b >> 2) + 0.5;
    } else {
      lx = (j % p.cols) + 0.5;
      lz = Math.floor(j / p.cols) + 0.5;
    }
    w = Math.max(w, lx + 0.5);
    h = Math.max(h, lz + 0.5);
    p.cells.push({ k, lx, lz: lz + LABEL_H });
    if (!CELL.has(k)) CELL.set(k, { panel: p, lx, lz: lz + LABEL_H });
  });
  p.w = Math.max(w, 6);
  p.h = h + LABEL_H;
  PANELS.push(p);
  return p;
}
const range = (a, n) => Array.from({ length: n }, (_, i) => a + i);

// ---- ROM panels, per bank ---------------------------------------------------------------------
const GFX_RE = /(GFX|Sprite|Tile\d|Graphics)$/;
const BANKS = new Map(); // bank -> [panels]
{
  // split the embedded ranges at top-level labels, merging pieces that belong to the same label
  const pieces = [];
  for (const r of D.rom) {
    const len = b64(r.d).length;
    let start = r.o;
    const end = r.o + len;
    const cuts = romLabels.filter(([o, n]) => o > r.o && o < end && !n.includes(".") && !/End$/.test(n)).map(([o]) => o);
    for (const c of [...new Set(cuts), end]) {
      if (c > start) pieces.push([start, c]);
      start = c;
    }
  }
  const byLabel = new Map();
  for (const [a, b] of pieces) {
    const l = labelAt(romLabels, a, true);
    const key = l && l[0] >> 14 === a >> 14 && a - l[0] < 0x200 ? `${l[1]}@${l[0]}` : `@${a}`;
    if (!byLabel.has(key)) byLabel.set(key, { l, a, b });
    else {
      const x = byLabel.get(key);
      x.a = Math.min(x.a, a);
      x.b = Math.max(x.b, b);
    }
  }
  for (const { l, a, b } of [...byLabel.values()].sort((x, y) => x.a - y.a)) {
    const bank = a >> 14;
    const name = l ? l[1] : "";
    const base = l ? l[0] : a;
    const gfx = GFX_RE.test(name) || name === "Overworld_Block";
    const isBlocks = /_Blocks$/.test(name);
    let start = a;
    if (gfx) start = base + Math.floor((a - base) / 16) * 16;
    const n = b - start;
    const keys = range(0x10000 + start, n);
    const addr = start < 0x4000 ? start : 0x4000 + (start & 0x3fff);
    const p = makePanel({
      id: `rom-${start}`,
      title: start === 0x134 ? "Cartridge header" : name ? (start === base ? name : nameOf(0x10000 + start, true)) : "ROM",
      sub: `${ba(bank, addr)}–${hex(addr + n - 1, 4)}`,
      keys,
      kind: gfx ? "tablet" : "grid",
      tpr: /Sprite$/.test(name) ? 8 : 16,
      cols: isBlocks ? 10 : name === "SpriteSheetPointerTable" ? 16 : name === "Tilesets" ? 12 : name === "MapHeaderPointers" ? 16 : Math.min(16, n),
      color: COL.rom,
      group: bank,
    });
    if (!BANKS.has(bank)) BANKS.set(bank, []);
    BANKS.get(bank).push(p);
  }
}

// ---- RAM panels -------------------------------------------------------------------------------
const RAMP = {};
function ramPanel(id, title, a, n, cols, color, extra = {}) {
  RAMP[id] = makePanel({ id, title, sub: `${h4(a)}–${h4(a + n - 1)}`, keys: range(a, n), kind: "grid", cols, color, group: "ram", ...extra });
  return RAMP[id];
}
// work RAM structures, at their natural widths
ramPanel("ovw", "wOverworldMap", S.wOverworldMap, S.wOverworldMapEnd - S.wOverworldMap, 16, COL.wram, { zone: "wram" });
ramPanel("surr", "wSurroundingTiles", S.wSurroundingTiles, 24 * 20, 24, COL.wram, { zone: "wram" });
ramPanel("tilemap", "wTileMap", S.wTileMap, 20 * 18, 20, COL.wram, { zone: "wram" });
ramPanel("ss1", "Sprite state 1", 0xc100, 0x100, 16, COL.wram, { zone: "wram" });
ramPanel("ss2", "Sprite state 2", 0xc200, 0x100, 16, COL.wram, { zone: "wram" });
ramPanel("soam", "wShadowOAM", 0xc300, 0xa0, 16, COL.wram, { zone: "wram" });
ramPanel("redraw", "wRedrawRowOrColumnSrcTiles", S.wRedrawRowOrColumnSrcTiles, 40, 20, COL.wram, { zone: "wram" });
// the other WRAM bytes the tour touches, in 16-byte rows aligned to their addresses
{
  const rows = [...new Set([...TOUCHED].filter((a) => a >= 0xc000 && a < 0xe000 && !CELL.has(a)).map((a) => a & 0xfff0))].sort((a, b) => a - b);
  const runs = [];
  for (const r of rows) {
    const last = runs[runs.length - 1];
    if (last && r - last[1] <= 0x20) last[1] = r;
    else runs.push([r, r]);
  }
  for (const [a, b] of runs) {
    const n = b + 16 - a;
    const l = labelAt(ramLabels, a + (n > 16 ? 0 : 0), true);
    ramPanel(`var-${a}`, l ? nameOf(a, true).replace(/\+.*/, "") + (l[0] === a ? "" : "…") : "Variables", a, n, 16, COL.wram, { zone: "wram", vars: true });
  }
}
// video RAM
RAMP.tiles = makePanel({ id: "tiles", title: "Tile data", sub: "$8000–$97FF", keys: range(0x8000, 0x1800), kind: "tablet", tpr: 16, color: COL.vram, group: "ram", zone: "vram" });
ramPanel("bgmap", "BG map", 0x9800, 0x400, 32, COL.vram, { zone: "vram" });
ramPanel("oam", "OAM", 0xfe00, 0xa0, 16, COL.oam, { zone: "out" });
ramPanel("io", "LCD registers", 0xff40, 16, 16, COL.io, { zone: "out" });
{
  const rows = [...new Set([...TOUCHED].filter((a) => a >= 0xff80 && a < 0xffff).map((a) => a & 0xfff0))].sort((a, b) => a - b);
  const a = rows[0];
  const b = rows[rows.length - 1] + 16;
  ramPanel("hram", "High RAM", a, b - a, 16, COL.hram, { zone: "cpu" });
}

// ---- placing everything: zones, packed with a skyline -----------------------------------------
function skyline(items, maxW, gap) {
  let sky = [{ x: 0, w: maxW, y: 0 }];
  let W = 0;
  let H = 0;
  for (const it of items) {
    const w = it.w + gap;
    let best = null;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + it.w > maxW + 0.01 && x > 0) continue;
      let y = 0;
      for (const s of sky) if (s.x < x + w && s.x + s.w > x) y = Math.max(y, s.y);
      if (!best || y < best.y - 0.01 || (Math.abs(y - best.y) < 0.01 && x < best.x)) best = { x, y };
    }
    it.x = best.x;
    it.z = best.y;
    W = Math.max(W, it.x + it.w);
    H = Math.max(H, it.z + it.h);
    // raise the skyline over [x, x+w)
    const ny = best.y + it.h + gap;
    const next = [];
    for (const s of sky) {
      const a = s.x;
      const b = s.x + s.w;
      const c = best.x;
      const d = best.x + w;
      if (b <= c || a >= d) next.push(s);
      else {
        if (a < c) next.push({ x: a, w: c - a, y: s.y });
        if (b > d) next.push({ x: d, w: b - d, y: s.y });
      }
    }
    next.push({ x: best.x, w, y: ny });
    sky = next.sort((p, q) => p.x - q.x);
  }
  return { w: W, h: H };
}

const ZW = 76; // a zone's width
const SPECIAL = {}; // rack, mbc, bay0, bay, cpu, ppu, lcd, scope: {x, z, w, h}
const ZONES = [];
let LAYOUT_MODE = "";

function layoutBoard(landscape) {
  LAYOUT_MODE = landscape ? "landscape" : "portrait";
  // the ROM zone: rack + MBC on top, bank 0's bay, the window bay sized for the biggest drawer
  const rack = { id: "rack", w: 8 * 3.4, h: 8 * 2.1 + LABEL_H };
  const mbc = { id: "mbc", w: 10, h: 7 + LABEL_H };
  const bank0 = BANKS.get(0) || [];
  const b0 = skyline(bank0.map((p) => ({ p, w: p.w, h: p.h })), 34, 2.4);
  const bay0 = { id: "bay0", w: Math.max(b0.w, 30) + 3, h: b0.h + 3 + LABEL_H };
  // each other bank's drawer contents
  let bayW = 30;
  let bayH = 10;
  const drawerPack = new Map();
  for (const [bank, ps] of BANKS) {
    if (bank === 0) continue;
    const items = ps.map((p) => ({ p, w: p.w, h: p.h }));
    const sz = skyline(items, ZW - 3, 2.4);
    drawerPack.set(bank, { items, ...sz });
    bayW = Math.max(bayW, sz.w);
    bayH = Math.max(bayH, sz.h);
  }
  const bay = { id: "bay", w: Math.min(ZW, bayW + 3), h: bayH + 3 + LABEL_H };
  // the window bay first, its drawers sitting at its bottom edge, right above the rack and bank 0,
  // so small drawers end up close to the CPU and work RAM below
  const romItems = [bay, rack, bay0, mbc];
  const romSz = skyline(romItems, ZW, 3);
  // place bank 0's panels inside its bay
  const b0items = bank0.map((p) => ({ p, w: p.w, h: p.h }));
  skyline(b0items, 34, 2.4);
  ZONES.length = 0;
  const zone = (id, title, sub, color, items, size) => {
    const z = { id, title, sub, color, items, w: Math.max(size.w, 20), h: size.h + LABEL_H + 2 };
    ZONES.push(z);
    return z;
  };
  const zr = zone("rom", "Cartridge", "ROM, seen through $0000–$7FFF", COL.rom, romItems, romSz);
  // CPU zone: core, I/O, HRAM
  const cpu = { id: "cpu", w: 12, h: 9 + LABEL_H };
  const cpuItems = [cpu, { p: RAMP.hram, w: RAMP.hram.w, h: RAMP.hram.h }];
  const zc = zone("cpu", "CPU", "register A, high RAM $FF80", COL.io, cpuItems, skyline(cpuItems, ZW, 3));
  // WRAM
  const wItems = PANELS.filter((p) => p.vars).map((p) => ({ p, w: p.w, h: p.h }));
  wItems.push(...["ss1", "ss2", "soam", "ovw", "surr", "tilemap", "redraw"].map((id) => ({ p: RAMP[id], w: RAMP[id].w, h: RAMP[id].h })));
  const zw = zone("wram", "Work RAM", "$C000–$DFFF", COL.wram, wItems, skyline(wItems, ZW, 2.6));
  // VRAM
  const vItems = [{ p: RAMP.bgmap, w: RAMP.bgmap.w, h: RAMP.bgmap.h }, { p: RAMP.tiles, w: RAMP.tiles.w, h: RAMP.tiles.h }];
  const zv = zone("vram", "Video RAM", "$8000–$9FFF", COL.vram, vItems, skyline(vItems, ZW, 3));
  // OAM, the graphics chip and the screen
  const lcd = { id: "lcd", w: 33, h: 30 + LABEL_H };
  const ppu = { id: "ppu", w: 14, h: 9 + LABEL_H };
  const scope = { id: "scope", w: 26, h: 22 + LABEL_H };
  const oItems = [lcd, ppu, { p: RAMP.io, w: RAMP.io.w, h: RAMP.io.h }, { p: RAMP.oam, w: RAMP.oam.w, h: RAMP.oam.h }, scope];
  const zo = zone("out", "Graphics chip and screen", "its registers $FF40, OAM $FE00, the LCD", COL.oam, oItems, skyline(oItems, ZW, 3));
  // zones: stacked in portrait, three across in landscape. The graphics chip sits between work
  // RAM and video RAM, so a step's tile map, the screen and the BG map are close together.
  const zitems = [zr, zc, zw, zo, zv].map((z) => ({ zone: z, w: z.w + 4, h: z.h + 4 }));
  skyline(zitems, landscape ? (ZW + 4) * 3 + 12 : ZW + 4, 5);
  let bw = 0;
  let bh = 0;
  for (const zi of zitems) {
    const z = zi.zone;
    z.x = zi.x;
    z.z = zi.z;
    bw = Math.max(bw, z.x + zi.w);
    bh = Math.max(bh, z.z + zi.h);
  }
  // absolute positions: zone origin + 2 (frame) + label
  const place = (z, it) => {
    const x = z.x + 2 + it.x;
    const zz = z.z + 2 + LABEL_H + 1 + it.z;
    if (it.p) {
      it.p.x = x;
      it.p.z = zz;
    } else SPECIAL[it.id] = { x, z: zz, w: it.w, h: it.h };
  };
  for (const z of ZONES) for (const it of z.items) place(z, it);
  for (const it of b0items) {
    it.p.x = SPECIAL.bay0.x + 1.5 + it.x;
    it.p.z = SPECIAL.bay0.z + LABEL_H + 1.5 + it.z;
  }
  // a drawer's panels sit at these offsets from the window bay's content origin
  for (const [bank, dp] of drawerPack) {
    const off = bayH - dp.h;
    DRAWER_BOX.set(bank, { z0: LABEL_H + off, h: dp.h + 3 });
    for (const it of dp.items) {
      it.p.dx = 1.5 + it.x;
      it.p.dz = LABEL_H + 1.5 + off + it.z;
      it.p.drawer = bank;
    }
  }
  BOARD.w = bw;
  BOARD.h = bh;
}
const BOARD = { w: 0, h: 0 };
const DRAWER_BOX = new Map(); // bank -> the tray's z offset and height inside the bay
const DRAWER_BANKS = [...BANKS.keys()].filter((b) => b !== 0);
