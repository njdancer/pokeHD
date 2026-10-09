// ---- 08 UI: dialog, controls, inspect, level select, input, the frame loop ---------------------
const $ = (id) => document.getElementById(id);
const capEl = $("caption");
const detEl = $("details");
const nextEl = $("next");
const scrubEl = $("scrub");
const speedEl = $("speed");
const moreEl = $("more");
const sheetEl = $("sheet");
const toastEl = $("toast");
const levelsEl = $("levels");
const dpadEl = $("dpad");
const goggEl = $("goggles");

// progress, remembered in this browser only
const PROG = (() => {
  try {
    return JSON.parse(localStorage.getItem("c2s-progress") || "{}");
  } catch {
    return {};
  }
})();
PROG.seen ??= {};
PROG.solved ??= {};
const saveProg = () => {
  try {
    localStorage.setItem("c2s-progress", JSON.stringify(PROG));
  } catch {
    /* private mode: progress just isn't kept */
  }
};

let CUR = -1;
let solved = false;
let toastTimer = 0;
function toast(html, ms = 2600) {
  toastEl.innerHTML = html;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

function levelOf(b) {
  return LEVELS.find((L) => L.n === b.level);
}
function goBeat(idx, opts = {}) {
  idx = Math.max(0, Math.min(BEATS.length - 1, idx));
  const prev = BEATS[CUR];
  prev?.special?.stop?.();
  CUR = idx;
  lastEndedBeat = -1;
  const b = BEATS[idx];
  const L = levelOf(b);
  solved = false;
  closeSheet();
  beginPlay(b);
  const lb = L.beats;
  $("lvl").textContent = `${L.n} · ${L.title}`;
  $("beatno").textContent = `${lb.indexOf(b) + 1}/${lb.length}`;
  if (b.challenge) {
    capEl.innerHTML = `<em>Challenge.</em> ${b.challenge.prompt}`;
    detEl.innerHTML = "Tap a cube on the board. You can skip this.";
  } else {
    capEl.innerHTML = b.cap;
    detEl.innerHTML = b.det || "";
  }
  moreEl.hidden = !b.det && !b.challenge;
  dpadEl.hidden = !b.free;
  nextEl.textContent = b.challenge ? "Skip ▶" : b.free ? "Done ▶" : "Next ▶";
  PROG.seen[L.n] = Math.max(PROG.seen[L.n] ?? -1, lb.indexOf(b));
  PROG.last = idx;
  saveProg();
  if (opts.end) finishBeat();
}
function advance() {
  if (!PLAY) return;
  if (TAU < PLAY.dur - 0.05) {
    finishBeat();
    return;
  }
  const b = BEATS[CUR];
  if (b.free) {
    showLevels();
    return;
  }
  if (CUR + 1 >= BEATS.length) return showLevels();
  goBeat(CUR + 1);
}
function back() {
  if (TAU > 1.2 && !BEATS[CUR].free) return goBeat(CUR);
  goBeat(CUR - 1, { end: true });
}

nextEl.onclick = advance;
$("prev").onclick = back;
$("replay").onclick = () => goBeat(CUR);
const SPEEDS = [1, 4, 0.25];
speedEl.onclick = () => {
  SPEED = SPEEDS[(SPEEDS.indexOf(SPEED) + 1) % SPEEDS.length];
  speedEl.textContent = SPEED === 0.25 ? "¼×" : `${SPEED}×`;
};
moreEl.onclick = () => {
  detEl.hidden = !detEl.hidden;
  moreEl.setAttribute("aria-expanded", String(!detEl.hidden));
  onResize();
};
let scrubbing = false;
scrubEl.addEventListener("input", () => {
  scrubbing = true;
  if (PLAY) seek((scrubEl.value / 1000) * PLAY.dur);
});
scrubEl.addEventListener("change", () => (scrubbing = false));
goggEl.onclick = () => {
  UNI.uGog.value = UNI.uGog.value > 0.5 ? 0 : 1;
  goggEl.setAttribute("aria-pressed", String(UNI.uGog.value > 0.5));
  for (const L of GOG) L.dirty = true;
};
function unlockGoggles(announce) {
  PROG.goggles = true;
  saveProg();
  goggEl.disabled = false;
  goggEl.title = "Show what each tile's bytes draw";
  if (announce) toast("Pixel goggles unlocked. Tap <b>Pixel goggles</b> to see what the tile bytes draw.", 4000);
}
if (PROG.goggles) unlockGoggles(false);

// ---- level select -----------------------------------------------------------------------------
function showLevels() {
  BEATS[CUR]?.special?.stop?.();
  const grid = $("levelgrid");
  grid.innerHTML = "";
  for (const L of LEVELS) {
    const seen = (PROG.seen[L.n] ?? -1) + 1;
    const done = seen >= L.beats.length;
    const btn = document.createElement("button");
    btn.className = `lcard${done ? " done" : ""}`;
    btn.innerHTML = `<span class="n"><span>Level ${L.n}</span><b>${done ? "✓ done" : seen ? `${seen}/${L.beats.length}` : ""}</b></span><span class="t">${L.title}</span><span class="s">${L.blurb}</span><span class="bar"><i style="width:${Math.min(100, (seen / L.beats.length) * 100)}%"></i></span>`;
    btn.onclick = () => {
      levelsEl.hidden = true;
      goBeat(BEATS.indexOf(L.beats[0]));
    };
    grid.appendChild(btn);
  }
  levelsEl.hidden = false;
}
$("menu").onclick = showLevels;

// ---- inspect ----------------------------------------------------------------------------------
function closeSheet() {
  sheetEl.hidden = true;
  ringSel.visible = false;
  onResize();
}
function locHTML(k) {
  const n = nameOf(k);
  const cls = isRomKey(k) ? "src" : k < 0xa000 ? "vram" : "ram";
  return `<span class="${cls}">${addrOf(k)}</span>${n ? ` <code>${n}</code>` : ""}`;
}
function provOf(id) {
  if (id === undefined || id < 0) return null;
  const P = M.provs[id];
  if (!P) return null;
  if (P.k === "rom") return { k: 0x10000 + P.o, v: ROM[P.o] };
  return { k: PROV_ADDR[id], v: PROV_VAL[id] };
}
/** Where a byte's value first came from: the ROM byte, or the code that set it. */
function originOf(id) {
  let fn = "";
  for (let g = 0; g < 16 && id >= 0; g++) {
    const P = M.provs[id];
    if (!P) return null;
    if (P.k === "rom") return { k: 0x10000 + P.o, fn };
    if (P.k === "set") return null;
    fn = P.fn;
    if (P.s >= 0x10000) return { k: P.s, fn };
    id = P.from;
  }
  return null;
}
function chainHTML(k) {
  const items = [];
  let p = isRomKey(k) ? -2 : DS.prov[k];
  let cur = k;
  for (let guard = 0; guard < 16; guard++) {
    if (p === -2) {
      const o = cur - 0x10000;
      items.push(`<li>${locHTML(cur)} = <b>$${hex(ROM[o])}</b><div class="why">a byte of the cartridge: bank $${hex(o >> 14)}, file offset $${hex(o, 5)}. This is where it starts.</div></li>`);
      break;
    }
    if (p === -1) {
      items.push(`<li>${locHTML(cur)} = <b>$${hex(cur >= 0x8000 ? RAM0[cur - 0x8000] : 0)}</b><div class="why">already there when Pallet Town started loading (left over from Red's house, or set long before).</div></li>`);
      break;
    }
    const P = M.provs[p];
    if (P.k === "rom") {
      cur = 0x10000 + P.o;
      p = -2;
      continue;
    }
    if (P.k === "cp") {
      let why = `copied from ${locHTML(P.s)} by <code>${P.fn}</code>`;
      const via = provOf(P.via);
      if (via) {
        why += `, chosen by the byte $${hex(via.v)} at ${locHTML(via.k)}`;
        const o = originOf(P.via);
        if (o) why += ` (which came from ${locHTML(o.k)}${o.fn ? `, copied there by <code>${o.fn}</code>` : ""})`;
      }
      items.push(`<li>${locHTML(cur)} = <b>$${hex(PROV_VAL[p])}</b><div class="why">${why}</div></li>`);
      cur = P.s;
      p = P.s >= 0x10000 ? -2 : P.from;
      continue;
    }
    // set: worked out by the code
    const deps = (P.deps || []).map(provOf).filter(Boolean);
    const dh = deps.length ? `, from ${deps.map((d) => `$${hex(d.v)} at ${locHTML(d.k)}`).join(" and ")}` : "";
    items.push(`<li>${locHTML(cur)} = <b>$${hex(PROV_VAL[p])}</b><div class="why">set by <code>${P.fn || "the CPU"}</code>: ${P.note}${dh}</div></li>`);
    break;
  }
  return `<ol>${items.join("")}</ol>`;
}
function inspect(k) {
  const v = cellValAt(k);
  const n = nameOf(k);
  sheetEl.innerHTML = `<div class="head"><h3>${addrOf(k)}${n ? ` · ${n}` : ""} = $${hex(v)} <span class="why">(${v})</span></h3><button class="hbtn" id="sheetx" aria-label="Close">✕</button></div><div class="why">Where this byte came from, newest first:</div>${chainHTML(k)}`;
  sheetEl.hidden = false;
  $("sheetx").onclick = closeSheet;
  const p = cellPos(k);
  if (p) {
    ringSel.position.copy(p);
    ringSel.position.y = 0.55;
    ringSel.visible = true;
  }
  onResize();
}
function inspectPixel(x, y) {
  const m = DS.mem;
  if (!(m[0xff40] & 0x80)) {
    toast("The screen is off right now.");
    return;
  }
  const by = (y + m[0xff42]) & 255;
  const bx = (x + m[0xff43]) & 255;
  const cell = 0x9800 + (by >> 3) * 32 + (bx >> 3);
  const tile = m[cell];
  const ta = 0x9000 + ((tile << 24) >> 24) * 16 + (by & 7) * 2;
  inspect(cell);
  sheetEl.querySelector("h3").insertAdjacentHTML("beforebegin", `<div class="why">Screen pixel (${x}, ${y}) shows background map cell ${h4(cell)}: tile $${hex(tile)}, whose row ${by & 7} is the bytes at ${h4(ta)}.</div>`);
}

// ---- challenges -------------------------------------------------------------------------------
function tryAnswer(k) {
  const c = BEATS[CUR].challenge;
  if (c.test(k)) {
    solved = true;
    PROG.solved[BEATS[CUR].num] = true;
    saveProg();
    capEl.innerHTML = `<em>✓</em> ${c.yes}`;
    nextEl.textContent = "Next ▶";
    toast("✓ Correct", 1500);
    const p = cellPos(k);
    if (p) {
      ringSel.position.copy(p);
      ringSel.position.y = 0.55;
      ringSel.visible = true;
    }
  } else {
    const n = nameOf(k);
    toast(`Not that one: ${addrOf(k)}${n ? ` (${n})` : ""}. ${c.hint}`, 4200);
  }
}

// ---- free play --------------------------------------------------------------------------------
function walk(dir) {
  const b = BEATS[CUR];
  if (!b?.free) return;
  const y = M.mem[S.wYCoord];
  const x = M.mem[S.wXCoord];
  if (dir === "up" && y <= 2) return toast("In the real game, Professor Oak stops you here: it's not safe to walk into the grass without a partner.", 4000);
  if ((dir === "down" && y >= 17) || (dir === "left" && x <= 0) || (dir === "right" && x >= 19)) return toast("That's the edge of the town.");
  const nb = stepBeats(dir, { free: true, cap: `You pressed ${dir}.`, det: undefined });
  const L = LEVELS[LEVELS.length - 1];
  for (const x2 of nb) {
    x2.level = L.n;
    x2.num = `${L.n}.${L.beats.length + 1}`;
    x2.pace = { slow: 0, budget: 1.6, frame: 0.07, bankFast: 0.03 };
    L.beats.push(x2);
    BEATS.push(x2);
  }
  goBeat(BEATS.indexOf(nb[0]));
}
dpadEl.addEventListener("click", (e) => {
  const d = e.target.closest("button")?.dataset.d;
  if (d) walk(d);
});

// ---- input on the board -----------------------------------------------------------------------
const ray = new THREE.Raycaster();
const ptr = new Map();
let gesture = null;
function pickAt(cx, cy) {
  const r = canvas.getBoundingClientRect();
  const v = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(v, camera);
  const meshes = CUBESETS.map((s) => s.mesh).filter((m) => {
    let o = m;
    while (o) {
      if (!o.visible) return false;
      o = o.parent;
    }
    return true;
  });
  const hits = ray.intersectObjects([...meshes, lcd.mesh], false);
  if (!hits.length) return null;
  const h = hits[0];
  if (h.object === lcd.mesh) {
    const u = h.uv;
    return { pixel: [Math.min(159, Math.floor(u.x * 160)), Math.min(143, Math.floor((1 - u.y) * 144))] };
  }
  const set = h.object.userData.set;
  return { key: set.cells[h.instanceId].k };
}
function onTap(cx, cy) {
  const hit = pickAt(cx, cy);
  const b = BEATS[CUR];
  if (hit?.key !== undefined) {
    if (b.challenge && !solved) return tryAnswer(hit.key);
    return inspect(hit.key);
  }
  if (hit?.pixel) return inspectPixel(...hit.pixel);
  if (!sheetEl.hidden) return closeSheet();
  if (b.challenge && !solved) return;
  advance();
}
canvas.addEventListener("pointerdown", (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    /* synthetic or already-released pointer */
  }
  ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  if (ptr.size === 2) {
    const [a, b] = [...ptr.values()];
    gesture = { pinch: Math.hypot(a.x - b.x, a.y - b.y), d: cam.gd };
  } else gesture = { moved: false };
});
canvas.addEventListener("pointermove", (e) => {
  const p = ptr.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x;
  const dy = e.clientY - p.y;
  p.x = e.clientX;
  p.y = e.clientY;
  if (ptr.size === 2 && gesture?.pinch) {
    const [a, b] = [...ptr.values()];
    const dd = Math.hypot(a.x - b.x, a.y - b.y);
    userCam = true;
    cam.gd = Math.max(8, Math.min(1500, (gesture.d * gesture.pinch) / Math.max(dd, 1)));
    gesture.moved = true;
    return;
  }
  if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 7) gesture.moved = true;
  if (gesture?.moved) {
    userCam = true;
    const upp = (2 * cam.d * Math.tan((camera.fov * Math.PI) / 360)) / canvas.clientHeight;
    cam.gx -= dx * upp;
    cam.gz -= (dy * upp) / Math.cos(TILT);
  }
});
const endPtr = (e) => {
  const p = ptr.get(e.pointerId);
  ptr.delete(e.pointerId);
  if (!p) return;
  if (ptr.size === 0 && gesture && !gesture.moved && !gesture.pinch && performance.now() - p.t0 < 500) onTap(e.clientX, e.clientY);
  if (ptr.size === 0) gesture = null;
};
canvas.addEventListener("pointerup", endPtr);
canvas.addEventListener("pointercancel", (e) => {
  ptr.delete(e.pointerId);
  gesture = null;
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    userCam = true;
    cam.gd = Math.max(8, Math.min(1500, cam.gd * Math.exp(e.deltaY * 0.0012)));
  },
  { passive: false },
);
window.addEventListener("keydown", (e) => {
  if (!levelsEl.hidden) return;
  const b = BEATS[CUR];
  const arrows = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
  if (b?.free && arrows[e.key]) {
    e.preventDefault();
    return walk(arrows[e.key]);
  }
  if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
    if (e.target.tagName === "BUTTON" && e.key !== "ArrowRight") return;
    e.preventDefault();
    advance();
  } else if (e.key === "ArrowLeft") back();
  else if (e.key === "r") goBeat(CUR);
  else if (e.key === "Escape") closeSheet();
});

// ---- size and orientation ---------------------------------------------------------------------
function onResize() {
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  const mode = w > h * 1.15 ? "landscape" : "portrait";
  if (mode !== LAYOUT_MODE) {
    layoutBoard(mode === "landscape");
    buildBoard();
    if (CUR >= 0) {
      const t = TAU;
      beginPlay(BEATS[CUR]);
      seek(t);
    }
  }
}
new ResizeObserver(onResize).observe(stageEl);

// ---- the frame loop ---------------------------------------------------------------------------
let lastT = performance.now();
let lastEndedBeat = -1;
function frame(now) {
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  if (PLAY) {
    if (!scrubbing && TAU < PLAY.dur) seek(TAU + dt * SPEED);
    PLAY.beat.special?.update?.(TAU);
    if (PLAY.beat.special) drawScope();
    if (!scrubbing) scrubEl.value = String(Math.round((TAU / PLAY.dur) * 1000));
    const ended = TAU >= PLAY.dur - 0.01;
    nextEl.classList.toggle("ready", ended);
    if (ended && lastEndedBeat !== CUR) {
      lastEndedBeat = CUR;
      const b = BEATS[CUR];
      if (b.reward === "goggles" && !PROG.goggles) unlockGoggles(true);
      if (b.after === "route1") {
        const e = EV.slice(b.i0, b.i1).find((x) => x.t === "w" && x.f === "RedrawRowOrColumn" && x.a >= 0x9800 && x.a < 0x9c00);
        if (e) inspect(e.a);
      }
    }
    if (!ended && lastEndedBeat === CUR && TAU < 0.05) lastEndedBeat = -1;
  }
  UNI.uTime.value = TAU;
  drawDrawers();
  drawFlights();
  flushCells();
  refreshGoggles(cellValAt);
  drawLCD();
  updateCamera(dt);
  drawHUD();
  drawTags();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---- boot -------------------------------------------------------------------------------------
onResize();
if (!LAYOUT_MODE) {
  layoutBoard(stageEl.clientWidth > stageEl.clientHeight * 1.15);
  buildBoard();
}
$("loading").hidden = true;
goBeat(0);
cam.tx = cam.gx;
cam.tz = cam.gz;
cam.d = cam.gd * 1.4;
requestAnimationFrame(frame);
if (location.hash.startsWith("#b")) {
  const n = location.hash.slice(2).replace("-", ".");
  const i = BEATS.findIndex((b) => b.num === n);
  if (i >= 0) goBeat(i);
} else showLevels();
window.__inspect = inspect;
window.__tour = { cellPos, slabs, flyers, scene, camera, renderer, goBeat, seek, BEATS, finishBeat, BOARD, SPECIAL, ZONES, PANELS, fitBox, boxOfKeys, get TAU() { return TAU; }, get PLAY() { return PLAY; }, cam, LEVELS };
