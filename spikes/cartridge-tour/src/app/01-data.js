// ---- 01 data: the embedded bytes, symbols, names and the model run -----------------------------
/* global THREE, Machine, renderFrame, PROV_INIT */
const D = window.TOUR_DATA;
const S = D.S;
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ROM: only the bytes this tour reads (plus a few whole tables) are embedded.
const ROM = new Uint8Array(0x100000);
const ROMKNOWN = new Uint8Array(0x100000);
for (const r of D.rom) {
  const d = b64(r.d);
  ROM.set(d, r.o);
  ROMKNOWN.fill(1, r.o, r.o + d.length);
}
const RAM0 = b64(D.ram); // $8000-$FFFF when LoadMapData starts

// keys: a RAM address ($8000-$FFFF) or 0x10000 + ROM offset (the model's source codes)
const isRomKey = (k) => k >= 0x10000;
const romKey = (bank, addr) => 0x10000 + (addr < 0x4000 ? addr : bank * 0x4000 + (addr - 0x4000));
const keyBank = (k) => (k - 0x10000) >> 14;
const keyAddr = (k) => {
  const o = k - 0x10000;
  return o < 0x4000 ? o : 0x4000 + (o & 0x3fff);
};

const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, "0");
const h2 = (v) => `$${hex(v)}`;
const h4 = (v) => `$${hex(v, 4)}`;
const ba = (bank, addr) => `${hex(bank)}:${hex(addr, 4)}`;

// labels: RAM labels by address, ROM labels by 0x100000 + offset
const ramLabels = [];
const romLabels = [];
for (const [k, n] of D.labels) {
  if (k >= 0x100000) romLabels.push([k - 0x100000, n]);
  else ramLabels.push([k, n]);
}
const byKey = (a, b) => a[0] - b[0] || (a[1].includes(".") ? 1 : 0) - (b[1].includes(".") ? 1 : 0) || (/End$/.test(a[1]) ? 1 : 0) - (/End$/.test(b[1]) ? 1 : 0);
ramLabels.sort(byKey);
romLabels.sort(byKey);
function labelAt(list, x, topOnly = false) {
  let lo = 0;
  let hi = list.length - 1;
  let best = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (list[m][0] <= x) {
      best = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  // the first (preferred) label at that address, skipping local labels if asked
  while (best >= 0) {
    const a = list[best][0];
    let i = best;
    while (i > 0 && list[i - 1][0] === a) i--;
    let pick = -1;
    for (let j = i; j < list.length && list[j][0] === a; j++) {
      const n = list[j][1];
      if (topOnly && n.includes(".")) continue;
      if (/End$/.test(n) && pick >= 0) continue;
      pick = j;
      if (!/End$/.test(n)) break;
    }
    if (pick >= 0) return list[pick];
    best = i - 1;
  }
  return null;
}
/** "wTileMap+$05" style name for a key */
function nameOf(k, topOnly = false) {
  if (isRomKey(k)) {
    const o = k - 0x10000;
    const l = labelAt(romLabels, o, topOnly);
    if (!l || o - l[0] > 0x800 || l[0] >> 14 !== o >> 14) return "";
    return o === l[0] ? l[1] : `${l[1]}+${h2(o - l[0]).length > 3 ? h4(o - l[0]) : h2(o - l[0])}`;
  }
  if (k >= 0xfe00 && k < 0xfea0) return `OAM+${h2(k - 0xfe00)}`;
  if (k >= 0x8000 && k < 0x9800) return `tile ${h2(((k - (k >= 0x9000 ? 0x9000 : 0x8000)) >> 4) & 0xff)}${k >= 0x9000 ? " (BG)" : ""}, byte ${(k & 15)}`;
  if (k >= 0x9800 && k < 0x9c00) return `BG map row ${(k - 0x9800) >> 5}, col ${(k - 0x9800) & 31}`;
  const io = { 0xff40: "rLCDC", 0xff42: "rSCY", 0xff43: "rSCX", 0xff44: "rLY", 0xff47: "rBGP", 0xff48: "rOBP0", 0xff49: "rOBP1" }[k];
  if (io) return io;
  // the structures drawn as named panels go by the panel's name (some addresses have union labels)
  const cell = typeof CELL !== "undefined" ? CELL.get(k) : null;
  if (cell && !cell.panel.vars && cell.panel.group === "ram" && /^w/.test(cell.panel.title)) {
    const off = k - cell.panel.keys[0];
    return off ? `${cell.panel.title}+${off > 255 ? h4(off) : h2(off)}` : cell.panel.title;
  }
  const l = labelAt(ramLabels, k, topOnly);
  if (!l || k - l[0] > 0x600) return "";
  return k === l[0] ? l[1] : `${l[1]}+${k - l[0] > 255 ? h4(k - l[0]) : h2(k - l[0])}`;
}
/** "ROM 06:42A1" or "$C3A0" */
function addrOf(k) {
  if (isRomKey(k)) return `ROM ${ba(keyBank(k), keyAddr(k))}`;
  return h4(k);
}
const symAddr = (name) => {
  const v = D.fnAddr[name];
  return v ? v.toUpperCase() : "";
};
const symRomKey = (name) => {
  const v = S[name];
  return romKey(v >>> 16, v & 0xffff);
};
const sa = (name) => `<code>${name}</code> (${symAddr(name) || h4(S[name] & 0xffff)})`;

// ---- run the model once, the whole way through the loading and the door step ------------------
const M = new Machine({ rom: (o) => ROM[o], ram: RAM0, S });
const EV = M.events;
const markAt = {}; // first index of each beat marker
const onBeat = () => {
  const e = EV[EV.length - 1];
  if (e.t === "beat" && markAt[e.id] === undefined) markAt[e.id] = EV.length - 1;
};
const origBeat = M.beat.bind(M);
M.beat = (id) => {
  origBeat(id);
  onBeat();
};
M.LoadMapData();
M.beat("enter-map-x");
M.enterMap();
M.beat("door-step");
M.step("down", true);
M.beat("door-done");
// the map header has no label of its own in the symbol file; name it like the disassembly does
if (M.headerAddr) {
  romLabels.push([M.headerAddr.bank * 0x4000 + (M.headerAddr.addr - 0x4000), "PalletTown_h"]);
  romLabels.sort(byKey);
}
const EV_LOADED = EV.length; // events up to here are levels 2-7

/** index of the n-th event matching pred at or after `from` */
function findEv(pred, from = 0, n = 1) {
  for (let i = from; i < EV.length; i++) if (pred(EV[i]) && --n === 0) return i;
  return -1;
}
const findCall = (fn, from = 0, n = 1) => findEv((e) => e.t === "call" && e.fn === fn, from, n);

// Every RAM address the tour can touch, from a throwaway run with a long walk.
const TOUCHED = new Set();
{
  const m = new Machine({ rom: (o) => ROM[o], ram: RAM0, S });
  m.LoadMapData();
  m.enterMap();
  m.step("down", true);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  const dirs = ["right", "right", "right", "up", "up", "up"];
  for (let i = 0; i < 160; i++) {
    const d = i < dirs.length ? dirs[i] : ["up", "down", "left", "right"][Math.floor(rnd() * 4)];
    const y = m.mem[S.wYCoord];
    const x = m.mem[S.wXCoord];
    if ((d === "up" && y <= 2) || (d === "down" && y >= 17) || (d === "left" && x <= 0) || (d === "right" && x >= 19)) continue;
    m.step(d);
  }
  for (const e of m.events) {
    if (e.t === "w") TOUCHED.add(e.a);
    if ((e.t === "w" || e.t === "look") && e.s >= 0 && e.s < 0x10000) TOUCHED.add(e.s);
  }
  for (const p of m.provs) if (p.k === "cp" && p.s < 0x10000) TOUCHED.add(p.s);
}
for (const n of ["wCurMap", "wYCoord", "wXCoord", "wOnSGB", "wToggleableObjectFlags", "wToggleableObjectList", "wCurMapWidth", "wCurMapHeight"]) TOUCHED.add(S[n]);
for (let a = 0xff40; a < 0xff4c; a++) TOUCHED.add(a);
