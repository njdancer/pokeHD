// ---- 06 level 8: the graphics chip draws a frame ----------------------------------------------
function addLevel(L) {
  LEVELS.push(L);
  L.beats.forEach((b, j) => {
    b.level = L.n;
    b.num = `${L.n}.${j + 1}`;
    if (b.i0 === undefined) b.i0 = b.i1 = EV_LOADED;
    BEATS.push(b);
  });
}

const L8 = { n: 160 * 144, fr: null, mode: "", st: {}, lastDraw: 0, key: "" };
function l8Setup() {
  stateAt(EV_LOADED);
  L8.fr = renderFrame(DS.mem);
  const m = DS.mem;
  const scx = m[0xff43];
  const scy = m[0xff42];
  // the first pixel
  const by = scy & 255;
  const bx = scx & 255;
  const mapAddr = 0x9800 + (by >> 3) * 32 + (bx >> 3);
  const tile = m[mapAddr];
  const tileAddr = 0x9000 + ((tile << 24) >> 24) * 16;
  const row = by & 7;
  const lo = m[tileAddr + row * 2];
  const hi = m[tileAddr + row * 2 + 1];
  const bit = 7 - (bx & 7);
  const ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
  const bgp = m[0xff47];
  L8.bg = { x: 0, y: 0, scx, scy, mapAddr, tile, tileAddr, row, lo, hi, bit, ci, pal: bgp, shade: (bgp >> (ci * 2)) & 3 };
  // the first sprite pixel in raster order that is not see-through
  let best = null;
  for (let i = 0; i < 40; i++) {
    const Y = m[0xfe00 + i * 4] - 16;
    const X = m[0xfe00 + i * 4 + 1] - 8;
    const t = m[0xfe00 + i * 4 + 2];
    const f = m[0xfe00 + i * 4 + 3];
    if (Y < 0 || Y >= 144 || X < 0 || X >= 160) continue;
    for (let r = 0; r < 8 && !best?.done; r++) {
      const rr = f & 0x40 ? 7 - r : r;
      const lo2 = m[0x8000 + t * 16 + rr * 2];
      const hi2 = m[0x8000 + t * 16 + rr * 2 + 1];
      for (let px = 0; px < 8; px++) {
        const b2 = f & 0x20 ? px : 7 - px;
        const c2 = ((lo2 >> b2) & 1) | (((hi2 >> b2) & 1) << 1);
        if (!c2) continue;
        const pos = (Y + r) * 160 + X + px;
        if (!best || pos < best.pos) best = { i, Y, X, t, f, r: rr, px, lo: lo2, hi: hi2, bit: b2, ci: c2, pos, y: Y + r, x: X + px, pal: m[0xff48 + ((f >> 4) & 1)] };
        break;
      }
    }
  }
  if (best) best.shade = (best.pal >> (best.ci * 2)) & 3;
  L8.sp = best;
  lcdOverride = (data) => {
    const fr = L8.fr;
    for (let i = 0; i < 160 * 144; i++) {
      const s = SHADES[fr[i]];
      const k = i < L8.n ? 1 : 0.22;
      const cur = i === L8.n - 1 && L8.cursor ? 1 : 0;
      data[i * 4] = cur ? 255 : s[0] * 255 * k;
      data[i * 4 + 1] = cur ? 200 : s[1] * 255 * k;
      data[i * 4 + 2] = cur ? 80 : s[2] * 255 * k;
      data[i * 4 + 3] = 255;
    }
  };
  if (scope) scope.mesh.visible = true;
}
function l8Stop() {
  lcdOverride = null;
  if (scope) scope.mesh.visible = false;
  lcdDirty = true;
  hud.ly = null;
}

// ---- the scope: a frame timeline, or the pixel decoder -----------------------------------------
const MODECOL = { 2: "#f2809e", 3: "#ad92f2", 0: "#3a4a40", 1: "#b9dc4c" };
function drawScope(force) {
  const now = performance.now();
  const key = JSON.stringify([L8.mode, L8.st]);
  if (!force && (key === L8.key || now - L8.lastDraw < 60)) return;
  L8.key = key;
  L8.lastDraw = now;
  scope.tex.needsUpdate = true;
  const g = scope.g;
  const W = scope.canvas.width;
  const H = scope.canvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = "#101a15";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = "#2a3d32";
  g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  const st = L8.st;
  const T = (txt, x, y, size, col = "#e7efe4", font = MONO, w = 600) => {
    g.font = `${w} ${size}px ${font}`;
    g.fillStyle = col;
    g.fillText(txt, x, y);
  };
  g.textBaseline = "top";
  if (L8.mode === "timeline") {
    T("One frame: 154 lines × 456 dots", 30, 24, 40);
    const x0 = 60;
    const y0 = 100;
    const w = W - 120;
    const h = H - 220;
    for (let ly = 0; ly < 154; ly++) {
      const y = y0 + (ly / 154) * h;
      const hh = h / 154 + 0.5;
      if (ly >= 144) {
        g.fillStyle = MODECOL[1];
        g.fillRect(x0, y, w, hh);
        continue;
      }
      g.fillStyle = MODECOL[2];
      g.fillRect(x0, y, (80 / 456) * w, hh);
      g.fillStyle = MODECOL[3];
      g.fillRect(x0 + (80 / 456) * w, y, (172 / 456) * w, hh);
      g.fillStyle = MODECOL[0];
      g.fillRect(x0 + (252 / 456) * w, y, (204 / 456) * w, hh);
    }
    if (st.ly !== undefined) {
      const y = y0 + ((st.ly + 0.5) / 154) * h;
      g.fillStyle = "#f4c650";
      g.fillRect(x0 - 40, y - 3, w + 80, 6);
      T(`LY ${st.ly}`, x0 + w - 150, Math.min(y + 8, y0 + h - 40), 32, "#f4c650");
    }
    const ly = H - 100;
    [
      [2, "mode 2: OAM scan"],
      [3, "mode 3: drawing"],
      [0, "mode 0: rest"],
      [1, "VBlank (lines 144–153)"],
    ].forEach(([m, t], i) => {
      const x = 30 + (i % 2) * (W / 2);
      const y = ly + Math.floor(i / 2) * 42;
      g.fillStyle = MODECOL[m];
      g.fillRect(x, y + 6, 26, 26);
      T(t, x + 40, y, 30, "#c9d6cd", MONO, 400);
    });
    return;
  }
  if (L8.mode === "oam") {
    T(`Line ${st.line}: the scanner checks 40 cards`, 30, 24, 40);
    const cw = (W - 60) / 8;
    for (let i = 0; i < 40; i++) {
      const x = 30 + (i % 8) * cw;
      const y = 100 + Math.floor(i / 8) * 120;
      const Y = DS.mem[0xfe00 + i * 4];
      const kept = st.kept?.includes(i);
      const done = i < (st.upto ?? 0);
      g.fillStyle = kept ? "#f2809e" : done ? "#24302a" : "#1a2420";
      g.fillRect(x + 4, y, cw - 8, 100);
      T(`#${i}`, x + 14, y + 10, 26, kept ? "#10200f" : "#93a69a", MONO, 400);
      T(`Y $${hex(Y)}`, x + 14, y + 50, 30, kept ? "#10200f" : done ? "#c9d6cd" : "#5c6b62");
    }
    T(st.upto >= 40 ? `${st.kept.length} card${st.kept.length === 1 ? "" : "s"} cover line ${st.line}${st.kept.length ? "" : ", so no sprites here"}` : "Y − 16 ≤ line < Y − 8 ?", 30, H - 80, 36, "#f4c650");
    return;
  }
  if (L8.mode === "decode" || L8.mode === "sdecode") {
    const sp = L8.mode === "sdecode";
    const d = sp ? L8.sp : L8.bg;
    const stage = st.stage ?? 0;
    let y = 24;
    T(sp ? `Sprite pixel (${d.x}, ${d.y})` : `Pixel (${d.x}, ${d.y})`, 30, y, 42);
    y += 70;
    if (stage >= 1) {
      if (sp) T(`OAM card ${d.i}: Y $${hex(d.Y + 16)}  X $${hex(d.X + 8)}  tile $${hex(d.t)}  flags $${hex(d.f)}`, 30, y, 30, "#f2809e");
      else T(`BG map $${hex(d.mapAddr, 4)} → tile $${hex(d.tile)}`, 30, y, 34, "#ad92f2");
      y += 56;
      if (!sp) T(`(LY + SCY) ÷ 8 = ${(d.y + d.scy) >> 3},  (x + SCX) ÷ 8 = ${(d.x + d.scx) >> 3}`, 30, y, 26, "#93a69a", MONO, 400);
      else T(`row ${d.r} of the tile, column ${d.px}`, 30, y, 26, "#93a69a", MONO, 400);
      y += 56;
    }
    if (stage >= 2) {
      const base = sp ? 0x8000 + d.t * 16 : d.tileAddr;
      T(sp ? `tile at $8000 + $${hex(d.t)} × 16 = $${hex(base, 4)}` : `tile at $9000 + $${hex(d.tile)} × 16 = $${hex(base, 4)}`, 30, y, 28, "#ad92f2", MONO, 400);
      y += 50;
      const bw = 64;
      const x0 = 250;
      [
        ["low", d.lo],
        ["high", d.hi],
      ].forEach(([nm, v], r) => {
        T(`${nm} $${hex(v)}`, 30, y + r * 76 + 16, 30, "#c9d6cd");
        for (let b = 7; b >= 0; b--) {
          const x = x0 + (7 - b) * bw;
          const on = (v >> b) & 1;
          const hl = stage >= 3 && b === d.bit;
          g.fillStyle = hl ? "#f4c650" : on ? "#3b4a42" : "#1a2420";
          g.fillRect(x, y + r * 76, bw - 8, 66);
          T(String(on), x + 18, y + r * 76 + 14, 36, hl ? "#231a02" : "#e7efe4");
        }
      });
      y += 170;
    }
    if (stage >= 3) {
      T(`bit ${d.bit}: high ${(d.hi >> d.bit) & 1}, low ${(d.lo >> d.bit) & 1} → colour number ${d.ci}`, 30, y, 30, "#f4c650");
      y += 60;
    }
    if (stage >= 4) {
      T(`${sp ? "OBP0" : "BGP"} = $${hex(d.pal)} = ${[3, 2, 1, 0].map((c) => (d.pal >> (c * 2)) & 3).join(" ")} (colours 3 2 1 0)`, 30, y, 28, "#b9dc4c");
      y += 52;
      for (let c = 0; c < 4; c++) {
        const s = SHADES[(d.pal >> (c * 2)) & 3];
        const x = 30 + c * 130;
        g.fillStyle = `rgb(${s.map((v) => v * 255).join(",")})`;
        g.fillRect(x, y, 110, 70);
        if (c === d.ci) {
          g.strokeStyle = "#f4c650";
          g.lineWidth = 8;
          g.strokeRect(x - 4, y - 4, 118, 78);
        }
        T(`${c}${sp && c === 0 ? " (clear)" : ""}`, x + 6, y + 78, 24, "#93a69a", MONO, 400);
      }
      T(`→ shade ${d.shade}`, 580, y + 16, 34, "#e7efe4");
    }
    return;
  }
  if (L8.mode === "vblank") {
    T("VBlank: the game's turn", 30, 24, 40, "#b9dc4c");
    const lines = [
      ["hSCX, hSCY → SCX, SCY", "the scroll for the next frame"],
      ["RedrawRowOrColumn", "a new edge into the BG map"],
      ["UpdateMovingBgTiles", "water and flowers move"],
      ["hDMARoutine", "shadow OAM → OAM"],
      ["PrepareOAMData", "next frame's sprite cards"],
    ];
    lines.forEach(([a, b], i) => {
      const on = i < (st.upto ?? 5);
      T(`${on ? "✓" : "·"} ${a}`, 30, 100 + i * 110, 34, on ? "#e7efe4" : "#5c6b62");
      T(b, 80, 146 + i * 110, 26, "#93a69a", MONO, 400);
    });
  }
}
// (drawScope's callers flag the texture for upload)

const SCOPE_POS = () => specialPos("scope", new THREE.Vector3());
function flyOp(fromKey, v, t, dur = 1.0, color) {
  return { kind: "fly", from: fromKey, v, t, land: t + dur, color };
}

const l8common = { shot: ["lcd", "scope", "ppu"], dim: true };
addLevel({
  n: 8,
  title: "The graphics chip draws a frame",
  blurb: "Watch numbers become pixels, one line at a time.",
  beats: [
    {
      ...l8common,
      cap: "The chip draws 154 lines, 60 times a second. The last 10 lines are a rest called VBlank.",
      det: "Each line takes 456 dots (clock ticks). For lines 0–143 the chip first scans OAM for sprites (mode 2), then draws 160 pixels (mode 3), then rests (mode 0). Lines 144–153 are VBlank: the only time the game can safely touch video RAM and OAM while the screen is on. LY ($FF44) says which line is being drawn.",
      special: {
        dur: 7,
        start() {
          l8Setup();
          L8.mode = "timeline";
          L8.cursor = false;
        },
        update(t) {
          const ly = Math.min(153, Math.floor((t / 6.2) * 154));
          L8.st = { ly };
          hud.ly = String(ly);
          L8.n = Math.min(144, ly) * 160;
        },
        stop: l8Stop,
      },
    },
    {
      ...l8common,
      cap: "Line 0 starts with an OAM scan: which sprite cards cover this line? At most 10.",
      det: "In mode 2 the chip reads each card's Y. A card covers line LY when Y − 16 ≤ LY < Y − 8 (sprites are 8 pixels tall here). OAM is locked to the CPU while this happens.",
      focus: range(0xfe00, 160).filter((a) => a % 4 === 0),
      special: {
        dur: 5.5,
        start() {
          l8Setup();
          L8.mode = "oam";
          L8.n = 0;
        },
        update(t) {
          const upto = Math.min(40, Math.floor((t / 4) * 40));
          const kept = [];
          for (let i = 0; i < Math.min(upto, 40); i++) {
            const y = DS.mem[0xfe00 + i * 4] - 16;
            if (0 >= y && 0 < y + 8) kept.push(i);
          }
          L8.st = { line: 0, upto, kept };
          hud.ly = "0";
        },
        stop: l8Stop,
      },
      synth: () => range(0, 40).map((i) => ({ kind: "look", key: 0xfe00 + i * 4, v: DS.mem[0xfe00 + i * 4], note: `card ${i}'s Y`, t: (i / 40) * 4 })),
    },
    {
      ...l8common,
      cap: "Pixel (0, 0): which tile is here? Look it up in the background map.",
      det: "", // filled in below
      special: {
        dur: 4,
        start() {
          l8Setup();
          L8.mode = "decode";
          L8.n = 0;
          L8.cursor = true;
        },
        update(t) {
          L8.st = { stage: t > 1.6 ? 1 : 0 };
          hud.ly = "0";
        },
        stop: l8Stop,
      },
      synth: () => [{ kind: "look", key: L8.bg.mapAddr, v: L8.bg.tile, note: "the BG map cell under pixel (0, 0)", t: 0.3 }, flyOp(L8.bg.mapAddr, L8.bg.tile, 0.6)],
    },
    {
      ...l8common,
      cap: "Find that tile's two bytes for this row of pixels.",
      det: "",
      special: {
        dur: 4,
        start() {
          l8Setup();
          L8.mode = "decode";
          L8.n = 0;
          L8.cursor = true;
        },
        update(t) {
          L8.st = { stage: t > 1.8 ? 2 : 1 };
          hud.ly = "0";
        },
        stop: l8Stop,
      },
      synth: () => {
        const a = L8.bg.tileAddr + L8.bg.row * 2;
        return [
          { kind: "look", key: a, v: L8.bg.lo, note: "low bit-plane", t: 0.3 },
          { kind: "look", key: a + 1, v: L8.bg.hi, note: "high bit-plane", t: 0.5 },
          flyOp(a, L8.bg.lo, 0.7),
          flyOp(a + 1, L8.bg.hi, 0.85),
        ];
      },
    },
    {
      ...l8common,
      cap: "One bit from each byte makes a colour number, 0 to 3.",
      det: "The leftmost pixel uses bit 7 of both bytes; the next pixel bit 6, and so on. The high byte's bit is the colour number's high bit.",
      special: {
        dur: 4,
        start() {
          l8Setup();
          L8.mode = "decode";
          L8.n = 0;
          L8.cursor = true;
        },
        update(t) {
          L8.st = { stage: t > 1.2 ? 3 : 2 };
          hud.ly = "0";
        },
        stop: l8Stop,
      },
    },
    {
      ...l8common,
      cap: "The palette turns the colour number into a shade. That's the first pixel.",
      det: "BGP holds 4 two-bit shades, one per colour number: colour 0 in bits 0–1, colour 3 in bits 6–7. $E4 is 3 2 1 0, the plain mapping.",
      special: {
        dur: 4.5,
        start() {
          l8Setup();
          L8.mode = "decode";
          L8.n = 0;
          L8.cursor = true;
        },
        update(t) {
          L8.st = { stage: t > 1 ? 4 : 3 };
          L8.n = t > 2.6 ? 1 : 0;
          hud.ly = "0";
        },
        stop: l8Stop,
      },
      synth: () => [{ kind: "look", key: 0xff47, v: L8.bg.pal, note: "BGP", t: 0.4 }, flyOp(0xff47, L8.bg.pal, 0.6)],
    },
    {
      ...l8common,
      cap: "The rest of the line goes the same way. Sprites work like tiles, but colour 0 is see-through.",
      det: "", // filled in below
      special: {
        dur: 8,
        start() {
          l8Setup();
          L8.mode = "decode";
          L8.n = 1;
          L8.cursor = true;
        },
        update(t) {
          const sp = L8.sp;
          if (t < 2) {
            L8.n = 1 + Math.floor((t / 2) * 159);
            L8.mode = "decode";
            L8.st = { stage: 4 };
            hud.ly = "0";
          } else if (t < 3.5 || !sp) {
            const target = sp ? sp.pos : 160 * 144;
            L8.n = 160 + Math.floor(((t - 2) / 1.5) * (target - 160));
            L8.mode = "decode";
            L8.st = { stage: 4 };
            hud.ly = String(Math.floor(L8.n / 160));
          } else {
            L8.n = sp.pos + (t > 6.5 ? 1 : 0);
            L8.mode = "sdecode";
            L8.st = { stage: Math.min(4, 1 + Math.floor((t - 3.5) / 0.75)) };
            hud.ly = String(sp.y);
          }
        },
        stop: l8Stop,
      },
      synth: () => {
        const sp = L8.sp;
        if (!sp) return [];
        const card = 0xfe00 + sp.i * 4;
        return [
          { kind: "look", key: card, v: DS.mem[card], note: "Y", t: 3.6 },
          { kind: "look", key: card + 1, v: DS.mem[card + 1], note: "X", t: 3.75 },
          { kind: "look", key: card + 2, v: DS.mem[card + 2], note: "tile", t: 3.9 },
          { kind: "look", key: card + 3, v: DS.mem[card + 3], note: "flags", t: 4.05 },
          flyOp(card + 2, sp.t, 4.1),
          { kind: "look", key: 0x8000 + sp.t * 16 + sp.r * 2, v: sp.lo, note: "low", t: 4.6 },
          { kind: "look", key: 0x8000 + sp.t * 16 + sp.r * 2 + 1, v: sp.hi, note: "high", t: 4.7 },
          flyOp(0x8000 + sp.t * 16 + sp.r * 2, sp.lo, 4.8),
          flyOp(0x8000 + sp.t * 16 + sp.r * 2 + 1, sp.hi, 4.9),
          { kind: "look", key: 0xff48, v: sp.pal, note: "OBP0", t: 5.8 },
          flyOp(0xff48, sp.pal, 5.9),
        ];
      },
    },
    {
      ...l8common,
      cap: "Then lines 1 to 143, and VBlank: the game's moment to change what the chip reads next.",
      det: `During VBlank the game's ${at("VBlank")} handler copies the scroll registers, draws any new edge into the BG map, animates the water, starts the OAM DMA and prepares the next sprite cards. Then line 0 starts again, 60 times a second.`,
      special: {
        dur: 7,
        start() {
          l8Setup();
          L8.mode = "decode";
          L8.n = L8.sp ? L8.sp.pos + 1 : 160;
          L8.cursor = false;
        },
        update(t) {
          const n0 = L8.sp ? L8.sp.pos + 1 : 160;
          if (t < 2.5) {
            L8.n = n0 + Math.floor((t / 2.5) * (160 * 144 - n0));
            hud.ly = String(Math.min(143, Math.floor(L8.n / 160)));
            L8.mode = "timeline";
            L8.st = { ly: Math.min(143, Math.floor(L8.n / 160)) };
          } else {
            L8.n = 160 * 144;
            L8.mode = "vblank";
            const ly = 144 + Math.min(9, Math.floor((t - 2.5) * 2.4));
            L8.st = { upto: Math.min(5, Math.floor((t - 2.5) / 0.7) + 1) };
            hud.ly = String(ly);
          }
        },
        stop: l8Stop,
      },
      reward: "goggles",
    },
  ],
});
// fill the decode captions with the real numbers
{
  l8Setup();
  const d = L8.bg;
  const L = LEVELS[LEVELS.length - 1].beats;
  L[2].det = `SCX = ${d.scx} and SCY = ${d.scy} here (Red has just stepped down 16 pixels). Row (0 + SCY) ÷ 8 = ${(d.scy) >> 3}, column (0 + SCX) ÷ 8 = ${d.scx >> 3}: BG map cell $${hex(d.mapAddr, 4)} holds tile $${hex(d.tile)}.`;
  L[3].det = `LCDC bit 4 is 0, so tile $${hex(d.tile)} is at $9000 + $${hex(d.tile)} × 16 = $${hex(d.tileAddr, 4)}. Pixel row ${d.row} is bytes $${hex(d.tileAddr + d.row * 2, 4)} ($${hex(d.lo)}) and $${hex(d.tileAddr + d.row * 2 + 1, 4)} ($${hex(d.hi)}).`;
  const sp = L8.sp;
  if (sp)
    L[6].det = `The first sprite pixel is (${sp.x}, ${sp.y}), from OAM card ${sp.i} (Red${sp.i < 4 ? "" : "?"}). Its Y − 16 and X − 8 give the position; its tile is at $8000 + $${hex(sp.t)} × 16 (sprites always count from $8000); flags choose flips, palette and priority. Colour ${sp.ci} → OBP0 $${hex(sp.pal)} → shade ${sp.shade}.`;
  L8.n = 160 * 144;
  lcdOverride = null;
  stateAt(0);
}
