// ---- 03 scene: the board in three.js -----------------------------------------------------------
THREE.ColorManagement.enabled = false; // colours below are used as written
const canvas = document.getElementById("gl");
const stageEl = document.getElementById("stage");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
const BG = new THREE.Color(0x0d1511);
scene.background = BG;
const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 4000);
const TILT = 0.4; // radians from straight down

try {
  await Promise.race([
    Promise.all([document.fonts.load('600 40px "JetBrains Mono"'), document.fonts.load('400 40px "Silkscreen"'), document.fonts.load('700 40px "Atkinson Hyperlegible"')]),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
} catch {
  /* fallback fonts are fine */
}
const MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
const BODY = '"Atkinson Hyperlegible", system-ui, sans-serif';
const DISPLAY = '"Silkscreen", "Courier New", monospace';

// ---- the hex glyph atlas: 256 two-digit numbers -----------------------------------------------
const atlas = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `600 36px ${MONO}`;
  for (let v = 0; v < 256; v++) g.fillText(hex(v), (v & 15) * 64 + 32, (v >> 4) * 64 + 34);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
})();

// ---- the byte cube material -------------------------------------------------------------------
const UNI = { uTime: { value: 0 }, uAtlas: { value: atlas }, uGog: { value: 0 } };
const cubeMat = new THREE.ShaderMaterial({
  uniforms: UNI,
  vertexShader: /* glsl */ `
    attribute float aVal; attribute vec3 aCol; attribute vec2 aT; attribute float aFlag;
    uniform float uTime;
    varying vec2 vL; varying vec3 vN; varying float vVal; varying vec3 vCol; varying float vHeat; varying float vLook; varying float vFlag;
    void main(){
      vL = position.xz / vec2(0.86, 0.86) + 0.5; vN = normal; vVal = aVal; vCol = aCol; vFlag = aFlag;
      float dt = uTime - aT.x; vHeat = dt >= 0.0 ? exp(-dt * 1.4) : 0.0;
      float dl = uTime - aT.y; vLook = (dl >= 0.0 && dl < 1.4) ? sin(min(dl / 1.4, 1.0) * 3.14159) : 0.0;
      vec3 p = position;
      p.y += (p.y > 0.0 ? 1.0 : 0.0) * (vHeat * 0.35 + vLook * 0.5);
      gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uAtlas; uniform float uGog;
    varying vec2 vL; varying vec3 vN; varying float vVal; varying vec3 vCol; varying float vHeat; varying float vLook; varying float vFlag;
    void main(){
      float known = mod(vFlag, 2.0);
      float flyer = step(3.5, mod(vFlag, 8.0));
      float focus = step(1.5, mod(vFlag, 4.0));
      float dim = step(7.5, mod(vFlag, 16.0));
      vec3 base = vCol;
      vec3 c;
      if (vN.y > 0.5) {
        vec2 cell = vec2(mod(vVal, 16.0), floor(vVal / 16.0));
        vec2 uv = vec2((cell.x + clamp(vL.x, 0.04, 0.96)) / 16.0, 1.0 - (cell.y + clamp(vL.y, 0.04, 0.96)) / 16.0);
        float g = texture2D(uAtlas, uv).a;
        float zero = vVal < 0.5 ? 0.55 : 1.0;
        vec3 bg = base * (0.2 + 0.12 * focus) + vec3(1.0, 0.82, 0.35) * vHeat * 0.55 + vec3(1.0) * vLook * 0.35;
        vec3 fg = mix(base * 1.15, vec3(1.0), 0.25 + 0.5 * vHeat);
        if (flyer > 0.5) { bg = base * 0.55 + 0.18; fg = vec3(1.0); }
        c = mix(bg, fg, g * known * zero * (1.0 - uGog * 0.0));
        // unknown ROM bytes: a faint dot pattern
        if (known < 0.5) { vec2 q = fract(vL * 2.0) - 0.5; c = base * 0.08 + base * 0.12 * step(length(q), 0.12); }
        float edge = max(abs(vL.x - 0.5), abs(vL.y - 0.5));
        c *= 1.0 - smoothstep(0.42, 0.5, edge) * 0.35;
      } else {
        float side = abs(vN.x) > 0.5 ? 0.42 : 0.3;
        c = base * side * (known > 0.5 ? 1.0 : 0.35) + vec3(1.0, 0.82, 0.35) * vHeat * 0.3;
      }
      if (dim > 0.5) c *= 0.4;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const CUBE_GEO = new THREE.BoxGeometry(0.86, 0.32, 0.86);
CUBE_GEO.translate(0, 0.16, 0);

/** An instanced set of byte cubes. cells: [{k, x, z}] in the mesh's local space. */
function makeCubeSet(cells) {
  const n = cells.length;
  const geo = CUBE_GEO.clone();
  const aVal = new Float32Array(n);
  const aCol = new Float32Array(n * 3);
  const aT = new Float32Array(n * 2).fill(-1e5);
  const aFlag = new Float32Array(n);
  geo.setAttribute("aVal", new THREE.InstancedBufferAttribute(aVal, 1));
  geo.setAttribute("aCol", new THREE.InstancedBufferAttribute(aCol, 3));
  geo.setAttribute("aT", new THREE.InstancedBufferAttribute(aT, 2));
  geo.setAttribute("aFlag", new THREE.InstancedBufferAttribute(aFlag, 1));
  const mesh = new THREE.InstancedMesh(geo, cubeMat, Math.max(n, 1));
  mesh.count = n;
  mesh.frustumCulled = false;
  const m4 = new THREE.Matrix4();
  cells.forEach((c, i) => {
    m4.makeTranslation(c.x, 0, c.z);
    mesh.setMatrixAt(i, m4);
    aCol.set(c.col, i * 3);
  });
  mesh.instanceMatrix.needsUpdate = true;
  const set = { mesh, cells, aVal, aT, aFlag, dirty: false, tDirty: false };
  mesh.userData.set = set;
  return set;
}

// ---- labels -----------------------------------------------------------------------------------
const PX = 40; // canvas pixels per world unit for text
function textTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * PX);
  c.height = Math.ceil(h * PX);
  const g = c.getContext("2d");
  draw(g, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  return { t, c, g };
}
/** A flat label lying on the board, its top-left corner at the origin. */
function flatLabel(text, opts = {}) {
  const size = opts.size ?? 1.3;
  const font = opts.font ?? `600 ${size * PX * 0.8}px ${MONO}`;
  const sub = opts.sub;
  const subFont = `400 ${size * PX * 0.62}px ${MONO}`;
  const m = document.createElement("canvas").getContext("2d");
  m.font = font;
  let wpx = m.measureText(text).width;
  if (sub) {
    m.font = subFont;
    wpx += m.measureText(sub).width + size * PX * 0.7;
  }
  const w = wpx / PX + 0.4;
  const h = size;
  const { t } = textTexture(w, h, (g, W, H) => {
    g.font = font;
    g.textBaseline = "middle";
    g.fillStyle = opts.color ?? "#e7efe4";
    g.fillText(text, 4, H / 2 + 1);
    if (sub) {
      const x = 4 + g.measureText(text).width + size * PX * 0.7;
      g.font = subFont;
      g.fillStyle = opts.subColor ?? "#93a69a";
      g.fillText(sub, x, H / 2 + 1);
    }
  });
  const geo = new THREE.PlaneGeometry(w, h);
  geo.rotateX(-Math.PI / 2);
  geo.translate(w / 2, 0, h / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  mesh.userData.w = w;
  return mesh;
}
/** A label whose text changes (drawn into a fixed-size canvas). */
function dynLabel(w, h, draw) {
  const { t, c, g } = textTexture(w, h, () => {});
  const geo = new THREE.PlaneGeometry(w, h);
  geo.rotateX(-Math.PI / 2);
  geo.translate(w / 2, 0, h / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  let last = "";
  const set = (...args) => {
    const key = JSON.stringify(args);
    if (key === last) return;
    last = key;
    g.clearRect(0, 0, c.width, c.height);
    draw(g, c.width, c.height, ...args);
    t.needsUpdate = true;
  };
  return { mesh, set, canvas: c, g, tex: t };
}
const rgb = (c, k = 1) => new THREE.Color(c[0] * k, c[1] * k, c[2] * k);
function plate(w, h, color, y = -0.06, thick = 0.12) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, thick, h), new THREE.MeshBasicMaterial({ color }));
  m.position.set(w / 2, y - thick / 2, h / 2);
  return m;
}
/** a thin outline rectangle on the board */
function outline(w, h, color, y = 0.02) {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, y, 0), new THREE.Vector3(w, y, 0), new THREE.Vector3(w, y, h), new THREE.Vector3(0, y, h), new THREE.Vector3(0, y, 0)]);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 }));
}
/** A chip: a dark box with a name printed on it, plus pins. */
function chip(w, h, name, color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, h), [
    new THREE.MeshBasicMaterial({ color: 0x1a221e }),
    new THREE.MeshBasicMaterial({ color: 0x1a221e }),
    new THREE.MeshBasicMaterial({ color: 0x232e28 }),
    new THREE.MeshBasicMaterial({ color: 0x111714 }),
    new THREE.MeshBasicMaterial({ color: 0x151c18 }),
    new THREE.MeshBasicMaterial({ color: 0x151c18 }),
  ]);
  body.position.set(w / 2, 0.6, h / 2);
  g.add(body);
  const pinMat = new THREE.MeshBasicMaterial({ color: rgb(color, 0.6) });
  for (let i = 0; i < Math.floor(w / 1.2); i++)
    for (const z of [-0.3, h + 0.3]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.6), pinMat);
      p.position.set(0.9 + i * 1.2, 0.1, z);
      g.add(p);
    }
  const face = dynLabel(w - 1, h - 1, (c, W, H, l1, l2) => {
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = `rgb(${color.map((v) => v * 255).join(",")})`;
    c.font = `400 ${Math.min(H * 0.3, 44)}px ${DISPLAY}`;
    c.fillText(l1, W / 2, l2 ? H * 0.34 : H / 2);
    if (l2) {
      c.fillStyle = "#e7efe4";
      c.font = `600 ${Math.min(H * 0.26, 40)}px ${MONO}`;
      c.fillText(l2, W / 2, H * 0.7);
    }
  });
  face.mesh.position.set(0.5, 1.22, 0.5);
  face.set(name, "");
  g.add(face.mesh);
  g.userData.face = face;
  return g;
}

// ---- building the board -----------------------------------------------------------------------
const board = new THREE.Group();
scene.add(board);
const INST = new Map(); // key -> { set, i, drawer }
const CUBESETS = [];
const DRAWERS = new Map(); // bank -> { group, set, w, h }
const RACKSLOT = new Map(); // bank -> {x, z} world centre of its slot
let mbcChip;
let cpuChip;
let ppuChip;
let bayLabel;
let lcd;
let scope;
const GOG = []; // goggle layers

function initialValue(k) {
  if (isRomKey(k)) return ROM[k - 0x10000];
  return RAM0[k - 0x8000];
}
function knownFlag(k) {
  return isRomKey(k) ? ROMKNOWN[k - 0x10000] : 1;
}

function buildBoard() {
  while (board.children.length) board.remove(board.children[0]);
  INST.clear();
  CUBESETS.length = 0;
  DRAWERS.clear();
  GOG.length = 0;
  // zones
  for (const z of ZONES) {
    const g = new THREE.Group();
    g.position.set(z.x, 0, z.z);
    g.add(plate(z.w + 4, z.h + 4, rgb(z.color, 0.07), -0.12, 0.3));
    g.add(outline(z.w + 4, z.h + 4, rgb(z.color, 0.35), -0.1));
    const l = flatLabel(z.title.toUpperCase(), { size: 2.2, font: `400 ${2.2 * PX * 0.78}px ${DISPLAY}`, color: `rgb(${z.color.map((v) => v * 255).join(",")})`, sub: z.sub });
    l.position.set(2, 0.01, 1.2);
    g.add(l);
    board.add(g);
  }
  // panels with fixed positions (RAM and bank 0)
  const fixed = [];
  const addPanelDecor = (parent, p, x, z) => {
    const pl = plate(p.w + 0.6, p.h - LABEL_H + 0.6, rgb(p.color, 0.13), -0.02, 0.08);
    pl.position.x += x - 0.3;
    pl.position.z += z + LABEL_H - 0.3;
    parent.add(pl);
    const l = flatLabel(p.title, { size: 1.25, sub: p.sub });
    l.position.set(x - 0.3, 0.01, z + 0.5);
    parent.add(l);
  };
  for (const p of PANELS) {
    if (p.drawer !== undefined) continue;
    addPanelDecor(board, p, p.x, p.z);
    for (const c of p.cells) fixed.push({ k: c.k, x: p.x + c.lx, z: p.z + c.lz, col: p.color });
  }
  const fset = makeCubeSet(fixed.filter((c) => !INST.has(c.k) && (INST.set(c.k, { i: -1 }), true)));
  fset.cells.forEach((c, i) => INST.set(c.k, { set: fset, i }));
  CUBESETS.push(fset);
  board.add(fset.mesh);
  // the rack
  const R = SPECIAL.rack;
  const rl = flatLabel("Cartridge ROM: 64 banks of 16 KB", { size: 1.25 });
  rl.position.set(R.x, 0.01, R.z + 0.5);
  board.add(rl);
  const rackTex = dynLabel(R.w, R.h - LABEL_H, (g, W, H, used) => {
    for (let b = 0; b < 64; b++) {
      const x = (b % 8) * (W / 8);
      const y = Math.floor(b / 8) * (H / 8);
      const u = used.includes(b);
      g.fillStyle = u ? "#3b2c17" : "#1c2520";
      g.fillRect(x + 4, y + 4, W / 8 - 8, H / 8 - 8);
      g.fillStyle = u ? "#e3a85c" : "#5c6b62";
      g.font = `600 ${H / 8 * 0.42}px ${MONO}`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(`$${hex(b)}`, x + W / 16, y + H / 16 + 2);
    }
  });
  rackTex.mesh.position.set(R.x, 0.05, R.z + LABEL_H);
  board.add(rackTex.mesh);
  rackTex.set([0, ...DRAWER_BANKS]);
  for (let b = 0; b < 64; b++) RACKSLOT.set(b, { x: R.x + (b % 8) * (R.w / 8) + R.w / 16, z: R.z + LABEL_H + Math.floor(b / 8) * ((R.h - LABEL_H) / 8) + (R.h - LABEL_H) / 16 });
  // MBC chip
  const Mb = SPECIAL.mbc;
  mbcChip = chip(Mb.w, Mb.h - LABEL_H, "MBC3", COL.rom);
  mbcChip.position.set(Mb.x, 0, Mb.z + LABEL_H);
  board.add(mbcChip);
  const ml = flatLabel("Bank switch", { size: 1.25, sub: "write to $2000" });
  ml.position.set(Mb.x, 0.01, Mb.z + 0.5);
  board.add(ml);
  // bank 0 bay
  const B0 = SPECIAL.bay0;
  const b0g = new THREE.Group();
  b0g.position.set(B0.x, 0, B0.z);
  b0g.add(outline(B0.w, B0.h - LABEL_H, rgb(COL.rom, 0.5)));
  const b0l = flatLabel("Bank 0", { size: 1.25, sub: "$0000–$3FFF, always there", color: "#e3a85c" });
  b0l.position.set(0, 0.01, 0.5);
  b0g.add(b0l);
  board.add(b0g);
  for (const p of BANKS.get(0) || []) addPanelDecor(board, p, p.x, p.z);
  // window bay
  const BY = SPECIAL.bay;
  const byg = new THREE.Group();
  byg.position.set(BY.x, 0, BY.z);
  byg.add(outline(BY.w, BY.h - LABEL_H, rgb(COL.rom, 0.5)));
  bayLabel = dynLabel(BY.w, 1.3, (g, W, H, bank) => {
    g.textBaseline = "middle";
    g.font = `600 ${H * 0.8}px ${MONO}`;
    g.fillStyle = "#e3a85c";
    g.fillText("Window", 4, H / 2);
    const x = g.measureText("Window").width + 24;
    g.font = `400 ${H * 0.62}px ${MONO}`;
    g.fillStyle = "#93a69a";
    g.fillText(`$4000–$7FFF shows bank ${bank}`, x, H / 2);
  });
  bayLabel.mesh.position.set(0, 0.01, 0.5);
  byg.add(bayLabel.mesh);
  board.add(byg);
  // drawers: every bank the tour uses, plus any bank switched to
  const banksSeen = new Set([...DRAWER_BANKS, M.bank]);
  for (const e of EV) if (e.t === "bank" && e.b !== 0) banksSeen.add(e.b);
  const initialBank = RAM0[0xffb8 - 0x8000] || 1;
  banksSeen.add(initialBank);
  for (const bank of banksSeen) {
    const g = new THREE.Group();
    const inner = new THREE.Group();
    g.add(inner);
    const box = DRAWER_BOX.get(bank) || { z0: BY.h - 8, h: 6 };
    const tray = plate(BY.w - 1, box.h, rgb(COL.rom, 0.11), -0.04, 0.1);
    tray.position.x += 0.5;
    tray.position.z += box.z0;
    inner.add(tray);
    const trayLine = outline(BY.w - 1, box.h, rgb(COL.rom, 0.45), 0.0);
    trayLine.position.set(0.5, 0, box.z0);
    inner.add(trayLine);
    const ps = BANKS.get(bank) || [];
    const tl = flatLabel(`Bank $${hex(bank)}`, { size: 1.2, color: "#e3a85c", sub: ps.length ? "" : "code for Red's house; the tour doesn't need its bytes" });
    tl.position.set(1, 0.02, box.z0 - 1.5);
    inner.add(tl);
    const cells = [];
    for (const p of ps) {
      addPanelDecor(inner, p, p.dx, p.dz);
      for (const c of p.cells) cells.push({ k: c.k, x: p.dx + c.lx, z: p.dz + c.lz, col: p.color });
    }
    const set = makeCubeSet(cells);
    cells.forEach((c, i) => INST.set(c.k, { set, i, drawer: bank }));
    CUBESETS.push(set);
    inner.add(set.mesh);
    g.position.set(BY.x, 0, BY.z);
    board.add(g);
    g.visible = false;
    DRAWERS.set(bank, { group: g, inner, set, w: BY.w, h: BY.h });
  }
  // CPU
  const C = SPECIAL.cpu;
  cpuChip = chip(C.w, C.h - LABEL_H, "CPU", COL.io);
  cpuChip.position.set(C.x, 0, C.z + LABEL_H);
  board.add(cpuChip);
  const cl = flatLabel("CPU", { size: 1.25, sub: "register A carries each byte" });
  cl.position.set(C.x, 0.01, C.z + 0.5);
  board.add(cl);
  // graphics chip
  const P = SPECIAL.ppu;
  ppuChip = chip(P.w, P.h - LABEL_H, "PPU", COL.oam);
  ppuChip.position.set(P.x, 0, P.z + LABEL_H);
  board.add(ppuChip);
  const pl = flatLabel("Graphics chip", { size: 1.25 });
  pl.position.set(P.x, 0.01, P.z + 0.5);
  board.add(pl);
  // the LCD
  const L = SPECIAL.lcd;
  const lg = new THREE.Group();
  lg.position.set(L.x, 0, L.z + LABEL_H);
  const bez = new THREE.Mesh(new THREE.BoxGeometry(L.w, 0.8, L.h - LABEL_H), new THREE.MeshBasicMaterial({ color: 0x2b3330 }));
  bez.position.set(L.w / 2, 0.4, (L.h - LABEL_H) / 2);
  lg.add(bez);
  const lcdData = new Uint8Array(160 * 144 * 4);
  const lcdTex = new THREE.DataTexture(lcdData, 160, 144, THREE.RGBAFormat);
  lcdTex.magFilter = THREE.NearestFilter;
  lcdTex.minFilter = THREE.LinearFilter;
  lcdTex.flipY = true;
  lcdTex.needsUpdate = true;
  const sw = L.w - 2;
  const sh = (sw * 144) / 160;
  const sg = new THREE.PlaneGeometry(sw, sh);
  sg.rotateX(-Math.PI / 2);
  sg.translate(sw / 2, 0, sh / 2);
  const screen = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: lcdTex }));
  screen.position.set(1, 0.82, 1);
  lg.add(screen);
  board.add(lg);
  const ll = flatLabel("LCD", { size: 1.25, sub: "160 × 144" });
  ll.position.set(L.x, 0.01, L.z + 0.5);
  board.add(ll);
  lcd = { data: lcdData, tex: lcdTex, x: L.x + 1, z: L.z + LABEL_H + 1, w: sw, h: sh, mesh: screen };
  // the scope (frame timeline and pixel decoder in level 8)
  const SC = SPECIAL.scope;
  scope = dynLabel(SC.w, SC.h - LABEL_H, () => {});
  scope.mesh.position.set(SC.x, 0.05, SC.z + LABEL_H);
  board.add(scope.mesh);
  const scl = flatLabel("Scope", { size: 1.25, sub: "what the chip is doing" });
  scl.position.set(SC.x, 0.01, SC.z + 0.5);
  board.add(scl);
  scope.mesh.visible = false;
  // goggles: decoded pictures over every tile tablet
  for (const set of CUBESETS) buildGoggles(set);
}

// Goggles: for each group of tablets, a quad per tile drawing its 8×8 picture from the bytes.
const SHADES = [
  [0.85, 0.93, 0.7],
  [0.55, 0.69, 0.42],
  [0.28, 0.4, 0.28],
  [0.09, 0.15, 0.11],
];
function buildGoggles(set) {
  const tiles = [];
  const seen = new Set();
  for (const c of set.cells) {
    const cell = CELL.get(c.k);
    if (!cell || cell.panel.kind !== "tablet") continue;
    const p = cell.panel;
    const idx = p.keys.indexOf(c.k) + (p.offset || 0);
    const base = c.k - (idx % 16);
    if (seen.has(base)) continue;
    seen.add(base);
    // the tablet's top-left cube centre is at (lx - col, lz - row)
    const b = idx % 16;
    tiles.push({ base, x: c.x - (b & 3) - 0.5, z: c.z - (b >> 2) - 0.5 });
  }
  if (!tiles.length) return;
  const per = 32;
  const rows = Math.ceil(tiles.length / per);
  const data = new Uint8Array(per * 8 * rows * 8 * 4);
  const tex = new THREE.DataTexture(data, per * 8, rows * 8, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  const geo = new THREE.PlaneGeometry(4, 4);
  geo.rotateX(-Math.PI / 2);
  geo.translate(2, 0, 2);
  const uvs = geo.attributes.uv;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const group = new THREE.Group();
  const meshes = [];
  tiles.forEach((t, i) => {
    const g = geo.clone();
    const u0 = (i % per) / per;
    const v0 = Math.floor(i / per) / rows;
    const uv = g.attributes.uv;
    for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uvs.getX(j) / per, 1 - (v0 + (1 - uvs.getY(j)) / rows));
    const m = new THREE.Mesh(g, mat);
    m.position.set(t.x, 0.75, t.z);
    group.add(m);
    meshes.push(m);
  });
  tex.flipY = false;
  group.visible = false;
  set.mesh.parent.add(group);
  GOG.push({ set, tiles, data, tex, per, rows, group, dirty: true });
}
function refreshGoggles(read) {
  for (const L of GOG) {
    L.group.visible = UNI.uGog.value > 0.5;
    if (!L.group.visible || !L.dirty) continue;
    L.dirty = false;
    L.tiles.forEach((t, i) => {
      const ox = (i % L.per) * 8;
      const oy = Math.floor(i / L.per) * 8;
      for (let r = 0; r < 8; r++) {
        const lo = read(t.base + r * 2);
        const hi = read(t.base + r * 2 + 1);
        for (let x = 0; x < 8; x++) {
          const ci = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
          const o = ((oy + r) * L.per * 8 + ox + x) * 4;
          const s = SHADES[ci];
          L.data[o] = s[0] * 255;
          L.data[o + 1] = s[1] * 255;
          L.data[o + 2] = s[2] * 255;
          L.data[o + 3] = 255;
        }
      }
    });
    L.tex.needsUpdate = true;
  }
}

// ---- things that fly --------------------------------------------------------------------------
const FLY_MAX = 1600;
const flyers = makeCubeSet(Array.from({ length: FLY_MAX }, () => ({ k: 0, x: 0, z: 0, col: [1, 1, 1] })));
flyers.mesh.count = 0;
scene.add(flyers.mesh);
const SLAB_MAX = 700;
const slabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.6, depthWrite: false }), SLAB_MAX);
slabs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SLAB_MAX * 3), 3);
slabs.count = 0;
slabs.frustumCulled = false;
scene.add(slabs);
const TRAILS = Array.from({ length: 10 }, () => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(25 * 3), 3));
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf4c650, transparent: true, opacity: 0.55 }));
  l.frustumCulled = false;
  l.visible = false;
  scene.add(l);
  return l;
});
function ringMesh(color) {
  const g = new THREE.RingGeometry(0.62, 0.8, 4, 1, Math.PI / 4);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false }));
  m.renderOrder = 5;
  m.visible = false;
  scene.add(m);
  return m;
}
const ringHL = ringMesh(0xe3a85c);
const ringDE = ringMesh(0xf4c650);
const ringSel = ringMesh(0xffffff);
const frameMarks = []; // outline rectangles a beat can show (e.g. the 6×5 view)
function markRect(x, z, w, h, color = 0xf4c650) {
  const l = outline(w, h, color, 0.45);
  l.material.depthTest = false;
  l.renderOrder = 6;
  l.position.set(x, 0, z);
  scene.add(l);
  frameMarks.push(l);
  return l;
}
function clearMarks() {
  for (const m of frameMarks) scene.remove(m);
  frameMarks.length = 0;
}
