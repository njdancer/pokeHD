// ---- 04 engine: display state, beat schedules, playback, camera, HUD ---------------------------
const INITIAL_BANK = RAM0[0xffb8 - 0x8000] || 1;

// the state the board shows (the model ran ahead; this replays its events)
const DS = {
  mem: new Uint8Array(0x10000),
  prov: new Int32Array(0x10000).fill(-1),
  bank: INITIAL_BANK,
  fns: [],
  HL: -1,
  DE: -1,
  A: -1,
  ev: 0,
};
DS.mem.set(RAM0, 0x8000);
const PROV_ADDR = new Int32Array(M.provs.length + 400000).fill(-1); // prov id -> address it was written to
const PROV_VAL = new Int16Array(M.provs.length + 400000).fill(-1);
const SNAP = new Map(); // event index -> snapshot
function snapState() {
  return { mem: DS.mem.slice(), prov: DS.prov.slice(), bank: DS.bank, fns: DS.fns.slice(), HL: DS.HL, DE: DS.DE, A: DS.A, ev: DS.ev };
}
function loadSnap(s) {
  DS.mem.set(s.mem);
  DS.prov.set(s.prov);
  DS.bank = s.bank;
  DS.fns = s.fns.slice();
  DS.HL = s.HL;
  DS.DE = s.DE;
  DS.A = s.A;
  DS.ev = s.ev;
}
SNAP.set(0, snapState());
function applyEvent(e) {
  switch (e.t) {
    case "w":
      DS.mem[e.a] = e.v;
      DS.prov[e.a] = e.p;
      DS.A = e.v;
      if (e.p >= 0 && e.p < PROV_ADDR.length) {
        PROV_ADDR[e.p] = e.a;
        PROV_VAL[e.p] = e.v;
      }
      break;
    case "bank":
      DS.bank = e.b;
      break;
    case "call":
      DS.fns.push(e.fn);
      break;
    case "ret":
      DS.fns.pop();
      break;
    case "reg":
      DS[e.r] = e.v;
      break;
  }
}
/** Put the display state at event index i (from the nearest snapshot). */
function stateAt(i) {
  if (SNAP.has(i)) return loadSnap(SNAP.get(i));
  let best = 0;
  for (const k of SNAP.keys()) if (k <= i && k > best) best = k;
  loadSnap(SNAP.get(best));
  for (let j = best; j < i; j++) applyEvent(EV[j]);
  DS.ev = i;
  SNAP.set(i, snapState());
}
// provenance values are needed for every event, so fill them in once
for (const e of EV) if (e.t === "w" && e.p >= 0) {
  PROV_ADDR[e.p] = e.a;
  PROV_VAL[e.p] = e.v;
}

// ---- cells: world positions and attribute updates ---------------------------------------------
const _v = new THREE.Vector3();
function bayPose() {
  return { x: SPECIAL.bay.x, y: 0, z: SPECIAL.bay.z, s: 1 };
}
function rackPose(bank) {
  const r = RACKSLOT.get(bank) || RACKSLOT.get(0);
  const d = DRAWERS.get(bank);
  const s = 0.035;
  return { x: r.x - (d ? d.w * s : 0) / 2, y: 0.3, z: r.z - (d ? d.h * s : 0) / 2, s };
}
let BANKOPS = []; // the current beat's bank switches
let BEAT_BANK0 = INITIAL_BANK;
/** where a drawer is at time t: {x,y,z,s,vis} */
function drawerPose(bank, t) {
  let cur = BEAT_BANK0;
  let op = null;
  for (const o of BANKOPS) {
    if (o.t > t) break;
    op = o;
    cur = o.b;
  }
  const bay = bayPose();
  const rack = rackPose(bank);
  if (op && t - op.t < op.anim && op.b !== op.old && (bank === op.b || bank === op.old)) {
    let p = (t - op.t) / op.anim;
    p = p * p * (3 - 2 * p);
    const into = bank === op.b;
    const a = into ? rack : bay;
    const b = into ? bay : rack;
    const lift = Math.sin(Math.PI * p) * 6;
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p + lift, z: a.z + (b.z - a.z) * p, s: Math.exp(Math.log(a.s) + (Math.log(b.s) - Math.log(a.s)) * p), vis: true };
  }
  if (bank === cur) return { ...bay, vis: true };
  return { ...rack, vis: false };
}
function cellPos(k, t = TAU, out = new THREE.Vector3()) {
  const c = INST.get(k);
  if (!c) return null;
  const m = c.set.cells[c.i];
  if (c.drawer !== undefined) {
    const p = drawerPose(c.drawer, t);
    return out.set(p.x + m.x * p.s, p.y + 0.3, p.z + m.z * p.s);
  }
  return out.set(m.x, 0.3, m.z);
}
function specialPos(id, out = new THREE.Vector3()) {
  const s = SPECIAL[id];
  return out.set(s.x + s.w / 2, 1.4, s.z + LABEL_H + (s.h - LABEL_H) / 2);
}
const CPU_POS = () => specialPos("cpu");
function cellVal(k) {
  return isRomKey(k) ? ROM[k - 0x10000] : DS.mem[k];
}
function cellValAt(k) {
  return isRomKey(k) ? ROM[k - 0x10000] : DS.mem[k];
}
function setCell(k, v, t) {
  const c = INST.get(k);
  if (!c) return;
  c.set.aVal[c.i] = v;
  if (t !== undefined) {
    c.set.aT[c.i * 2] = t;
    c.set.tDirty = true;
  }
  c.set.dirty = true;
}
function lookCell(k, t) {
  const c = INST.get(k);
  if (!c) return;
  c.set.aT[c.i * 2 + 1] = t;
  c.set.tDirty = true;
}
let FOCUS = new Set();
let DIM = false;
function refreshAllCells() {
  for (const set of CUBESETS) {
    set.cells.forEach((c, i) => {
      set.aVal[i] = cellVal(c.k);
      set.aT[i * 2] = -1e5;
      set.aT[i * 2 + 1] = -1e5;
      set.aFlag[i] = knownFlag(c.k) | (FOCUS.has(c.k) ? 2 : 0) | (DIM && !FOCUS.has(c.k) ? 8 : 0);
    });
    set.dirty = set.tDirty = true;
    set.fDirty = true;
  }
  for (const L of GOG) L.dirty = true;
  lcdDirty = true;
}
function flushCells() {
  for (const set of CUBESETS) {
    const g = set.mesh.geometry;
    if (set.dirty) g.attributes.aVal.needsUpdate = true;
    if (set.tDirty) g.attributes.aT.needsUpdate = true;
    if (set.fDirty) g.attributes.aFlag.needsUpdate = true;
    set.dirty = set.tDirty = set.fDirty = false;
  }
}

// ---- the LCD ----------------------------------------------------------------------------------
let lcdDirty = true;
let lcdOverride = null; // level 8 draws its own
const LCD_OFF = [0.62, 0.66, 0.5];
function drawLCD() {
  if (lcdOverride) {
    lcdOverride(lcd.data);
    lcd.tex.needsUpdate = true;
    return;
  }
  if (!lcdDirty) return;
  lcdDirty = false;
  const on = DS.mem[0xff40] & 0x80;
  const px = renderFrame(DS.mem);
  for (let i = 0; i < 160 * 144; i++) {
    const s = on ? SHADES[px[i]] : LCD_OFF;
    lcd.data[i * 4] = s[0] * 255;
    lcd.data[i * 4 + 1] = s[1] * 255;
    lcd.data[i * 4 + 2] = s[2] * 255;
    lcd.data[i * 4 + 3] = 255;
  }
  lcd.tex.needsUpdate = true;
}

// ---- schedules --------------------------------------------------------------------------------
function groupOf(k) {
  const c = CELL.get(k);
  if (!c) return "none";
  const p = c.panel;
  if (p.kind === "tablet") {
    const idx = p.keys.indexOf(k) + (p.offset || 0);
    return `${p.id}:t${Math.floor(idx / 16)}`;
  }
  return `${p.id}:r${Math.floor(c.lz)}`;
}
/**
 * Turn events [i0, i1) into timed ops. pace: { slow, budget, frame, bankFast }
 * The first `slow` byte copies go one at a time; after that, runs of neighbouring bytes fly
 * together and the rest fits in about `budget` seconds.
 */
function buildOps(i0, i1, pace = {}) {
  const slowN = pace.slow ?? 4;
  const budget = pace.budget ?? 3.5;
  const raw = [];
  let writes = 0;
  for (let i = i0; i < i1; i++) {
    const e = EV[i];
    if (e.t === "w") {
      const fast = writes >= slowN;
      writes++;
      const prev = raw[raw.length - 1];
      const pl = prev?.last;
      const note = e.s < 0 && e.p >= 0 ? M.provs[e.p]?.note : null;
      if (
        fast &&
        prev &&
        prev.kind === "w" &&
        prev.fast &&
        prev.writes.length < 40 &&
        prev.f === e.f &&
        // a run: neighbouring bytes to neighbouring bytes (or one byte repeated, like a fill)
        ((pl.a + 1 === e.a && e.s >= 0 && (pl.s + 1 === e.s || pl.s === e.s) && groupOf(e.a) === groupOf(pl.a) && (pl.s === e.s || groupOf(e.s) === groupOf(pl.s))) ||
          // or the CPU setting a batch of bytes for the same reason (zeroing a table)
          (e.s < 0 && pl.s < 0 && ((note && note === prev.note) || (pl.a + 1 === e.a && groupOf(e.a) === groupOf(pl.a)))))
      ) {
        prev.writes.push(e);
        prev.last = e;
        continue;
      }
      raw.push({ kind: "w", writes: [e], last: e, f: e.f, fast, i, note });
    } else if (e.t === "bank") raw.push({ kind: "bank", b: e.b, old: e.old, fast: writes > slowN, i });
    else if (e.t === "look") raw.push({ kind: "look", key: e.s, v: e.v, note: e.note, fast: writes > slowN, i });
    else if (e.t === "frame") raw.push({ kind: "frame", n: e.n, fast: writes > slowN, i });
    else raw.push({ kind: e.t, e, fast: writes > slowN, i });
  }
  const nFastW = raw.filter((o) => o.kind === "w" && o.fast).length;
  const nFastLook = raw.filter((o) => o.kind === "look" && o.fast).length;
  const gapW = Math.min(0.3, Math.max(0.004, (budget - nFastLook * 0.02) / Math.max(1, nFastW)));
  let t = 0.35;
  let lastLand = 0;
  let tFast = Infinity;
  let slowJ = 0;
  for (const o of raw) {
    o.t = t;
    if (o.fast && tFast === Infinity && o.kind === "w") tFast = t;
    switch (o.kind) {
      case "w": {
        const dur = o.fast ? Math.min(0.75, 0.35 + gapW * 4) : 1.05;
        o.land = Math.max(t + dur, lastLand);
        lastLand = o.land;
        // the first bytes go slowly, then each slow one a little quicker
        t += o.fast ? gapW : Math.max(0.28, 0.8 * 0.86 ** slowJ++);
        break;
      }
      case "bank": {
        const g = o.fast ? (pace.bankFast ?? 0.12) : 1.1;
        o.anim = g * 0.85;
        t += g;
        break;
      }
      case "look":
        t += o.fast ? Math.min(0.12, gapW * 2 + 0.01) : 0.9;
        break;
      case "frame":
        t += o.fast ? (pace.frame ?? 0.03) : 0.25;
        break;
      default:
        break;
    }
    // a write must land before anything that reads the same byte starts flying, so a later op
    // never starts before the landing of a write it depends on (keeps chains in order)
  }
  const end = Math.max(t, lastLand) + 0.4;
  return { ops: raw, dur: end, tFast };
}

// ---- playback ---------------------------------------------------------------------------------
let TAU = 0; // time within the current beat (seconds at 1×)
let PLAY = null; // { beat, ops, dur, tFast, startCur, landCur, i0, i1 }
let SPEED = 1;
let PAUSED = false;
const hud = { fn: "", bank: INITIAL_BANK, HL: -1, DE: -1, A: -1, last: null, ly: null, count: 0, changed: {} };

function beginPlay(beat) {
  clearMarks();
  beatRects(beat);
  const i0 = beat.i0 ?? DS.ev;
  stateAt(i0);
  const sched = beat.i1 > i0 ? buildOps(i0, beat.i1, beat.pace) : { ops: [], dur: 0, tFast: Infinity };
  if (beat.looks) beat.looks.forEach(([k, note], j) => sched.ops.push({ kind: "look", key: k, v: cellValAt(k), note, t: 0.6 + j * (beat.lookGap ?? 1.2) }));
  if (beat.synth) sched.ops.push(...beat.synth());
  if (beat.looks || beat.synth) {
    sched.ops.sort((a, b) => a.t - b.t);
    for (const o of sched.ops) sched.dur = Math.max(sched.dur, (o.land ?? o.t + (o.anim ?? 0)) + 1.2);
  }
  const extra = beat.special ? beat.special.build?.(sched) : null;
  const dur = Math.max(sched.dur, beat.special?.dur ?? 0, beat.minDur ?? 2.5);
  BANKOPS = sched.ops.filter((o) => o.kind === "bank");
  BEAT_BANK0 = beat.bankView ?? DS.bank;
  PLAY = { beat, ops: sched.ops, dur, tFast: sched.tFast, startCur: 0, landCur: 0, i0, i1: beat.i1 ?? i0, snap: SNAP.get(i0), extra };
  // focus: every byte this beat reads or writes
  FOCUS = new Set(beat.focus || []);
  for (const o of sched.ops) {
    if (o.kind === "w") for (const e of o.writes) {
      FOCUS.add(e.a);
      if (e.s >= 0) FOCUS.add(e.s);
    }
    if (o.kind === "look") FOCUS.add(o.key);
  }
  DIM = beat.dim ?? FOCUS.size > 0;
  hud.fn = DS.fns[DS.fns.length - 1] || beat.fn || "";
  hud.bank = DS.bank;
  hud.HL = DS.HL;
  hud.DE = DS.DE;
  hud.A = DS.A;
  hud.last = null;
  hud.count = 0;
  hud.ly = null;
  TAU = 0;
  refreshAllCells();
  computeShots();
  userCam = false;
  beat.special?.start?.();
}
/** Rewind to the start of the current beat (state and cells). */
function rewind() {
  loadSnap(PLAY.snap);
  PLAY.startCur = 0;
  PLAY.landCur = 0;
  hud.fn = DS.fns[DS.fns.length - 1] || PLAY.beat.fn || "";
  hud.bank = DS.bank;
  hud.HL = DS.HL;
  hud.DE = DS.DE;
  hud.A = DS.A;
  hud.last = null;
  hud.count = 0;
  refreshAllCells();
}
function seek(t) {
  if (!PLAY) return;
  t = Math.max(0, Math.min(t, PLAY.dur));
  if (t < TAU - 1e-6) rewind();
  TAU = t;
  const ops = PLAY.ops;
  while (PLAY.startCur < ops.length && ops[PLAY.startCur].t <= TAU) {
    const o = ops[PLAY.startCur++];
    switch (o.kind) {
      case "call":
        DS.fns.push(o.e.fn);
        hud.fn = o.e.fn;
        break;
      case "ret":
        DS.fns.pop();
        hud.fn = DS.fns[DS.fns.length - 1] || "";
        break;
      case "reg":
        hud[o.e.r] = o.e.v;
        DS[o.e.r] = o.e.v;
        hud.changed[o.e.r] = TAU;
        break;
      case "bank":
        hud.bank = o.b;
        hud.changed.bank = TAU;
        hud.last = o;
        break;
      case "look":
        lookCell(o.key, o.t);
        hud.last = o;
        break;
      case "w":
        hud.last = o;
        hud.count += o.writes.length;
        hud.A = o.writes[o.writes.length - 1].v;
        hud.changed.A = TAU;
        break;
      default:
        break;
    }
  }
  while (PLAY.landCur < ops.length && (ops[PLAY.landCur].kind !== "w" || ops[PLAY.landCur].land <= TAU) && PLAY.landCur < PLAY.startCur) {
    const o = ops[PLAY.landCur++];
    if (o.kind === "bank") DS.bank = o.b;
    if (o.kind !== "w") continue;
    for (const e of o.writes) {
      applyEvent(e);
      setCell(e.a, e.v, o.land);
      if (e.a >= 0x8000 && e.a < 0x9800) for (const L of GOG) L.dirty = true;
      if ((e.a >= 0x8000 && e.a < 0xa000) || e.a >= 0xfe00) lcdDirty = true;
    }
  }
  if (TAU >= PLAY.dur - 1e-6 && PLAY.landCur >= ops.length) {
    // the beat is complete: remember the state at its end
    DS.ev = PLAY.i1;
    if (!SNAP.has(PLAY.i1)) SNAP.set(PLAY.i1, snapState());
  }
}
/** Jump to the end of the beat (all writes applied). */
function finishBeat() {
  seek(PLAY.dur);
}

// ---- drawing what flies -----------------------------------------------------------------------
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
function srcPos(e, t, out) {
  if (e.s >= 0 && INST.has(e.s)) return cellPos(e.s, t, out);
  return out.copy(CPU_POS());
}
function colourOfKey(k) {
  const c = CELL.get(k);
  return c ? c.panel.color : COL.io;
}
function arc(a, b, p, out) {
  const d = a.distanceTo(b);
  const hgt = Math.min(4 + d * 0.22, 26, cam.d * 0.18);
  out.lerpVectors(a, b, p);
  out.y += Math.sin(Math.PI * p) * hgt;
  return out;
}
function drawFlights() {
  let nf = 0;
  let ns = 0;
  let nt = 0;
  ringHL.visible = false;
  ringDE.visible = false;
  const ops = PLAY ? PLAY.ops : [];
  // ops are sorted by start; flights last at most ~1.1 s plus queueing
  let lo = 0;
  let hi = PLAY ? PLAY.startCur : 0;
  for (let i = hi - 1; i >= 0; i--) {
    const o = ops[i];
    if (o.kind === "fly") {
      if (TAU >= o.land || nf >= FLY_MAX) continue;
      const p = Math.max(0, (TAU - o.t) / (o.land - o.t));
      const a = cellPos(o.from, o.t, new THREE.Vector3());
      if (!a) continue;
      const pos = arc(a, SCOPE_POS(), p, new THREE.Vector3());
      const sc = 1 + Math.sin(Math.PI * p) * 0.9;
      _m.compose(pos, _q.identity(), _s.set(sc, sc, sc));
      flyers.mesh.setMatrixAt(nf, _m);
      flyers.aVal[nf] = o.v;
      const col = colourOfKey(o.from);
      flyers.mesh.geometry.attributes.aCol.setXYZ(nf, col[0], col[1], col[2]);
      flyers.aFlag[nf] = 1 | 4;
      nf++;
      continue;
    }
    if (o.kind !== "w") continue;
    if (o.land < TAU - 0.001) {
      if (TAU - o.t > 6) {
        lo = i;
        break;
      }
      continue;
    }
    const p = Math.min(1, Math.max(0, (TAU - o.t) / (o.land - o.t)));
    const e0 = o.writes[0];
    const e1 = o.writes[o.writes.length - 1];
    if (o.writes.length > 1) {
      if (ns >= SLAB_MAX) continue;
      // a slab: the run's bytes travelling together
      const a0 = srcPos(e0, o.t, new THREE.Vector3());
      const a1 = srcPos(e1, o.t, new THREE.Vector3());
      let b0 = cellPos(e0.a, TAU, new THREE.Vector3());
      let b1 = cellPos(e1.a, TAU, new THREE.Vector3());
      if (!b0 || !b1) continue;
      if (e0.s < 0 || e0.s === e1.s) {
        // a batch from the CPU (or one byte repeated): the slab spreads over all its destinations
        const mn = b0.clone().min(b1);
        const mx = b0.clone().max(b1);
        for (const e of o.writes) {
          const q = cellPos(e.a, TAU, _b);
          if (q) {
            mn.min(q);
            mx.max(q);
          }
        }
        b0 = mn;
        b1 = mx;
      }
      const ca = a0.clone().add(a1).multiplyScalar(0.5);
      const cb = b0.clone().add(b1).multiplyScalar(0.5);
      arc(ca, cb, p, _a);
      const sa = new THREE.Vector3(Math.abs(a1.x - a0.x) + 0.9, 0.5, Math.abs(a1.z - a0.z) + 0.9);
      if (e0.s < 0) sa.set(0.9, 0.5, 0.9);
      const sb = new THREE.Vector3(Math.abs(b1.x - b0.x) + 0.9, 0.5, Math.abs(b1.z - b0.z) + 0.9);
      _s.lerpVectors(sa, sb, p);
      _m.compose(_a, _q.identity(), _s);
      slabs.setMatrixAt(ns, _m);
      const col = e0.s >= 0 ? colourOfKey(e0.s) : COL.io;
      slabs.instanceColor.setXYZ(ns, col[0] * 0.9 + 0.1, col[1] * 0.9 + 0.1, col[2] * 0.9 + 0.1);
      ns++;
    } else {
      if (nf >= FLY_MAX) continue;
      const a = srcPos(e0, o.t, _a);
      const b = cellPos(e0.a, TAU, _b);
      if (!b) continue;
      const pos = arc(a.clone(), b, p, new THREE.Vector3());
      const sc = 1 + Math.sin(Math.PI * p) * (o.fast ? 0.2 : 0.7);
      _m.compose(pos, _q.identity(), _s.set(sc, sc, sc));
      flyers.mesh.setMatrixAt(nf, _m);
      flyers.aVal[nf] = e0.v;
      const col = e0.s >= 0 ? colourOfKey(e0.s) : COL.io;
      flyers.mesh.geometry.attributes.aCol.setXYZ(nf, col[0], col[1], col[2]);
      flyers.aFlag[nf] = 1 | 4;
      flyers.aT[nf * 2] = -1e5;
      flyers.aT[nf * 2 + 1] = -1e5;
      nf++;
      if (!o.fast && nt < TRAILS.length) {
        const L = TRAILS[nt++];
        const arr = L.geometry.attributes.position.array;
        const A = srcPos(e0, o.t, new THREE.Vector3());
        for (let j = 0; j <= 24; j++) {
          arc(A, b, j / 24, _s);
          arr[j * 3] = _s.x;
          arr[j * 3 + 1] = _s.y;
          arr[j * 3 + 2] = _s.z;
        }
        L.geometry.attributes.position.needsUpdate = true;
        L.material.opacity = 0.6 * Math.sin(Math.PI * Math.min(1, p * 1.2));
        L.visible = true;
      }
    }
  }
  void lo;
  for (let j = nt; j < TRAILS.length; j++) TRAILS[j].visible = false;
  flyers.mesh.count = nf;
  flyers.mesh.instanceMatrix.needsUpdate = true;
  const fg = flyers.mesh.geometry.attributes;
  fg.aVal.needsUpdate = fg.aCol.needsUpdate = fg.aFlag.needsUpdate = fg.aT.needsUpdate = true;
  slabs.count = ns;
  slabs.instanceMatrix.needsUpdate = true;
  slabs.instanceColor.needsUpdate = true;
  // the pointer rings: on the source and destination of the latest copy
  const L = hud.last;
  if (L && L.kind === "w" && TAU - L.t < (L.fast ? 0.6 : 2.2)) {
    const e = L.writes[0];
    if (e.s >= 0 && INST.has(e.s)) {
      cellPos(e.s, TAU, ringHL.position);
      ringHL.position.y = 0.5;
      ringHL.visible = true;
    }
    if (cellPos(e.a, TAU, ringDE.position)) {
      ringDE.position.y = 0.5;
      ringDE.visible = true;
    }
  } else if (L && L.kind === "look" && TAU - L.t < 1.6 && INST.has(L.key)) {
    cellPos(L.key, TAU, ringHL.position);
    ringHL.position.y = 0.5;
    ringHL.visible = true;
  }
}
function drawDrawers() {
  for (const [bank, d] of DRAWERS) {
    const p = drawerPose(bank, TAU);
    d.group.visible = p.vis;
    d.group.position.set(p.x, p.y, p.z);
    d.group.scale.setScalar(p.s);
  }
  const b = hud.bank;
  bayLabel.set(`$${hex(b)}`);
  mbcChip.userData.face.set("MBC3", `bank $${hex(b)}`);
  cpuChip.userData.face.set("CPU", hud.A >= 0 ? `A = $${hex(hud.A)}` : "A = –");
}

// ---- the camera -------------------------------------------------------------------------------
let userCam = false;
const cam = { tx: 0, tz: 0, d: 200, gx: 0, gz: 0, gd: 200 };
let SHOT_A = null;
let SHOT_B = null;
function boxOfKeys(keys, extra = []) {
  const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
  const add = (x, z, r = 0.6) => {
    b.x0 = Math.min(b.x0, x - r);
    b.x1 = Math.max(b.x1, x + r);
    b.z0 = Math.min(b.z0, z - r);
    b.z1 = Math.max(b.z1, z + r);
  };
  for (const k of keys) {
    const c = INST.get(k);
    if (!c) continue;
    const m = c.set.cells[c.i];
    if (c.drawer !== undefined) add(SPECIAL.bay.x + m.x, SPECIAL.bay.z + m.z);
    else add(m.x, m.z);
  }
  for (const id of extra) {
    if (id === "board") {
      add(0, 0, 0);
      add(BOARD.w, BOARD.h, 0);
      continue;
    }
    if (typeof id === "object") {
      add(id.x, id.z, 0);
      add(id.x + id.w, id.z + id.h, 0);
      continue;
    }
    const s = SPECIAL[id] || ZONES.find((z) => z.id === id);
    if (!s) continue;
    add(s.x, s.z, 0);
    add(s.x + s.w + (s.items ? 4 : 0), s.z + s.h + (s.items ? 4 : 0), 0);
  }
  return b.x0 === Infinity ? null : b;
}
function computeShots() {
  const beat = PLAY.beat;
  const slowKeys = [];
  const allKeys = [];
  const extra = new Set(beat.shot || []);
  const fastExtra = new Set();
  if (beat.bankView !== undefined) {
    const box = DRAWER_BOX.get(beat.bankView);
    if (box) extra.add({ x: SPECIAL.bay.x, z: SPECIAL.bay.z + box.z0 - 2, w: SPECIAL.bay.w, h: box.h + 2 });
  }
  for (const o of PLAY.ops) {
    if (o.kind === "w")
      for (const e of o.writes) {
        (o.fast ? allKeys : slowKeys).push(e.a);
        if (e.s >= 0) (o.fast ? allKeys : slowKeys).push(e.s);
        else extra.add("cpu");
      }
    if (o.kind === "look") (o.fast ? allKeys : slowKeys).push(o.key);
    if (o.kind === "bank" && o.b !== 0) {
      // the drawer's tray in the window; the rack too once things speed up
      const box = DRAWER_BOX.get(o.b) || { z0: SPECIAL.bay.h - 8, h: 6 };
      const tray = { x: SPECIAL.bay.x, z: SPECIAL.bay.z + box.z0 - 2, w: SPECIAL.bay.w, h: box.h + 2 };
      (o.fast ? fastExtra : extra).add(tray);
      fastExtra.add("rack");
    }
  }
  const ex = [...extra];
  if (beat.shotOnly) {
    SHOT_A = SHOT_B = boxOfKeys(beat.focus || [], beat.shotOnly);
    return;
  }
  SHOT_B = boxOfKeys([...slowKeys, ...allKeys, ...(beat.focus || [])], [...ex, ...fastExtra]);
  SHOT_A = slowKeys.length ? boxOfKeys([...slowKeys, ...(beat.focus || [])], ex) : SHOT_B;
  if (!SHOT_B) SHOT_A = SHOT_B = boxOfKeys([], ["board"]);
}
const _cam = new THREE.PerspectiveCamera();
function fitBox(b) {
  // a tiny focus (one or two bytes) still gets enough board around it to read
  const MINW = camera.aspect > 1 ? 60 : 34;
  const MIND = camera.aspect > 1 ? 34 : 22;
  if (b.x1 - b.x0 < MINW) {
    const c = (b.x0 + b.x1) / 2;
    b = { ...b, x0: c - MINW / 2, x1: c + MINW / 2 };
  }
  if (b.z1 - b.z0 < MIND) {
    const c = (b.z0 + b.z1) / 2;
    b = { ...b, z0: c - MIND / 2, z1: c + MIND / 2 };
  }
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const pts = [];
  for (const x of [b.x0, b.x1]) for (const z of [b.z0, b.z1]) for (const y of [0, 1.5]) pts.push(new THREE.Vector3(x, y, z));
  _cam.fov = camera.fov;
  _cam.aspect = camera.aspect;
  _cam.near = 0.5;
  _cam.far = 5000;
  _cam.updateProjectionMatrix();
  const ok = (d) => {
    _cam.position.set(cx, d * Math.cos(TILT), cz + d * Math.sin(TILT));
    _cam.lookAt(cx, 0, cz);
    _cam.updateMatrixWorld();
    for (const p of pts) {
      const q = p.clone().project(_cam);
      if (Math.abs(q.x) > 0.9 || Math.abs(q.y) > 0.86 || q.z > 1) return false;
    }
    return true;
  };
  let lo = 4;
  let hi = 3000;
  for (let i = 0; i < 26; i++) {
    const m = (lo + hi) / 2;
    if (ok(m)) hi = m;
    else lo = m;
  }
  // re-centre: the projected box can sit off-centre because of the tilt
  _cam.position.set(cx, hi * Math.cos(TILT), cz + hi * Math.sin(TILT));
  _cam.lookAt(cx, 0, cz);
  _cam.updateMatrixWorld();
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    const q = p.clone().project(_cam);
    y0 = Math.min(y0, q.y);
    y1 = Math.max(y1, q.y);
  }
  const off = ((y0 + y1) / 2) * (b.z1 - b.z0) * 0.5;
  return { x: cx, z: cz - off, d: Math.max(hi, 26) };
}
function updateCamera(dt) {
  if (!userCam && PLAY) {
    const shot = TAU < PLAY.tFast ? SHOT_A : SHOT_B;
    const f = shot ? fitBox(shot) : { x: BOARD.w / 2, z: BOARD.h / 2, d: 300 };
    cam.gx = f.x;
    cam.gz = f.z;
    cam.gd = f.d;
  }
  const k = 1 - Math.exp(-dt * (userCam ? 14 : 2.6));
  cam.tx += (cam.gx - cam.tx) * k;
  cam.tz += (cam.gz - cam.tz) * k;
  cam.d += (cam.gd - cam.d) * k;
  camera.position.set(cam.tx, cam.d * Math.cos(TILT), cam.tz + cam.d * Math.sin(TILT));
  camera.lookAt(cam.tx, 0, cam.tz);
}

// ---- the HUD ----------------------------------------------------------------------------------
const regsEl = document.getElementById("regs");
let hudKey = "";
function drawHUD() {
  const fn = hud.fn || "";
  const pc = fn ? symAddr(fn) : "";
  const m = DS.mem;
  const on = m[0xff40] & 0x80;
  const ly = hud.ly ?? (!on ? "–" : DS.fns.includes("VBlank") ? "144" : "–");
  const chg = (r) => (hud.changed[r] !== undefined && TAU - hud.changed[r] < 0.7 ? " chg" : "");
  const parts = [
    `<span class="bank${chg("bank")}">Bank <b>$${hex(hud.bank)}</b></span>`,
    `<span class="fn">${fn ? `<b>${fn}</b> ${pc}` : "<b>–</b>"}</span>`,
    `<span class="${chg("A").trim()}">A <b>${hud.A >= 0 ? "$" + hex(hud.A) : "–"}</b></span>`,
    `<span class="${chg("HL").trim()}">HL <b>${hud.HL >= 0 ? "$" + hex(hud.HL, 4) : "–"}</b></span>`,
    `<span class="${chg("DE").trim()}">DE <b>${hud.DE >= 0 ? "$" + hex(hud.DE, 4) : "–"}</b></span>`,
    `<span>LCDC <b>$${hex(m[0xff40])}</b></span>`,
    `<span>SCX <b>${m[0xff43]}</b> SCY <b>${m[0xff42]}</b></span>`,
    `<span>LY <b>${ly}</b></span>`,
    `<span>BGP <b>$${hex(m[0xff47])}</b></span>`,
    `<span>OBP0 <b>$${hex(m[0xff48])}</b></span>`,
  ].join("");
  if (parts !== hudKey) {
    regsEl.innerHTML = parts;
    hudKey = parts;
  }
}

// ---- callouts: the CPU's hands, as readable tags on the board ---------------------------------
const tagHL = document.createElement("div");
const tagDE = document.createElement("div");
for (const [el, c] of [
  [tagHL, "var(--rom)"],
  [tagDE, "var(--accent)"],
]) {
  el.className = "tag";
  el.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;font:600 12px/1.25 var(--f-mono);color:#0d1511;background:${c};padding:3px 7px;border-radius:6px;white-space:nowrap;transform:translate(-50%,-140%);box-shadow:0 2px 8px #0008;max-width:70vw;overflow:hidden;text-overflow:ellipsis`;
  el.hidden = true;
  stageEl.appendChild(el);
}
function placeTag(el, pos, html) {
  const q = pos.clone().project(camera);
  if (q.z > 1) {
    el.hidden = true;
    return;
  }
  const W = stageEl.clientWidth;
  const H = stageEl.clientHeight;
  let x = (q.x * 0.5 + 0.5) * W;
  let y = (-q.y * 0.5 + 0.5) * H;
  if (el.innerHTML !== html) el.innerHTML = html;
  el.hidden = false;
  const hw = Math.min(el.offsetWidth, W - 8) / 2;
  x = Math.max(hw + 4, Math.min(W - hw - 4, x));
  y = Math.max(40, Math.min(H - 8, y));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}
const tagAddr = (k) => (isRomKey(k) ? ba(keyBank(k), keyAddr(k)) : h4(k));
function shortName(k) {
  const n = nameOf(k);
  return n ? ` ${n}` : "";
}
function drawTags() {
  const L = hud.last;
  tagHL.hidden = tagDE.hidden = true;
  if (!PLAY || !L) return;
  const age = TAU - L.t;
  if (L.kind === "w" && age < (L.fast ? 0.8 : 2.4)) {
    const e = L.writes[0];
    const n = L.writes.length;
    const val = n > 1 ? `${n} bytes` : `$${hex(e.v)}`;
    const p = e.s >= 0 && INST.has(e.s) ? cellPos(e.s, TAU, new THREE.Vector3()) : CPU_POS();
    placeTag(tagHL, p, e.s >= 0 ? `${val} ← ${tagAddr(e.s)}${shortName(e.s)}` : `CPU sets ${val}`);
    const d = cellPos(e.a, TAU, new THREE.Vector3());
    if (d) placeTag(tagDE, d, `→ ${tagAddr(e.a)}${shortName(e.a)}${hud.count > 8 ? ` · ${hud.count} done` : ""}`);
  } else if (L.kind === "look" && age < 2 && INST.has(L.key)) {
    placeTag(tagHL, cellPos(L.key, TAU, new THREE.Vector3()), `reads $${hex(L.v)} at ${tagAddr(L.key)}${L.note ? ` · ${L.note}` : shortName(L.key)}`);
  }
}
