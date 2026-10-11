// /tools/relief: paint which way every pixel faces (its normal), and see the 3D shape that makes.
// Training material only: the game never reads these edits. They're saved to this device and to
// Nick's account, and exported for local processing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  battlePalette,
  blockLabels,
  dexEntries,
  dexPicture,
  MAP_NAMES,
  overworldPalette,
  parseWorld,
  type Label,
  type Tileset,
  type WorldData,
} from "@pokehd/rom";
import { fetchDevRom } from "../../dev-rom.ts";
import { loadStoredRom } from "../../rom-store.ts";
import { me } from "../../room/account.ts";
import {
  domeNormals, emptyDoc, FRONT, GROUND_LABELS, hip, normalColour, normalise, seedNormal, slope, TOP,
  type Normal,
} from "./normals.ts";
import { parseReliefLink, type ReliefLinkOptions } from "./link.ts";
import { decodeLayer, loadPixels, overlayPrediction, pickLayer, tilesFromPrediction, type PickedLayer } from "./prefill.ts";
import { mapRelief, pictureRelief, type Mesh } from "./shape.ts";
import { download, EditStore, loadLocal, loadRemote, newer, saveLocal, saveRemote } from "./store.ts";
import "./relief.css";

type Rgb = readonly [number, number, number];
type Subject = { kind: "map"; map: number; bx: number; by: number; bw: number; bh: number } | { kind: "pic"; dex: number };
type BrushMode = "pixel" | "row" | "fill" | "pick";

interface Region {
  width: number;
  height: number;
  shade(x: number, y: number): number;
  colour(x: number, y: number): Rgb;
  inside(x: number, y: number): boolean;
  normal(x: number, y: number): Normal;
  /** Writes a normal; returns an undo step. */
  set(x: number, y: number, n: Normal): void;
  ground(x: number, y: number): boolean;
}

const rgbOf = (c: number): Rgb => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const AREA_SIZES = ["2x2", "3x2", "4x3", "6x4"];

/** Outside a picture = colour-0 pixels joined to the border (white inside the sprite, like eyes, stays inside). */
function pictureOutside(pixels: ArrayLike<number>, w: number, h: number): Uint8Array {
  const outside = new Uint8Array(w * h), q: number[] = [];
  for (let i = 0; i < w * h; i++) { const x = i % w, y = (i / w) | 0; if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && pixels[i] === 0) { outside[i] = 1; q.push(i); } }
  for (let k = 0; k < q.length; k++) { const i = q[k]!, x = i % w, y = (i / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const nx = x + dx, ny = y + dy, j = ny * w + nx;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && !outside[j] && pixels[j] === 0) { outside[j] = 1; q.push(j); } } }
  return outside;
}

/** The subject a link asks for, clamped to the map; `moved` when clamping changed the area. */
function linkedSubject(link: ReliefLinkOptions, world: WorldData, dexCount: number): { subject: Subject; moved: boolean } | null {
  if (link.map) {
    const i = MAP_NAMES.indexOf(link.map), map = i >= 0 ? world.maps[i] : undefined;
    if (!map) return null;
    const [x, y, w, h] = link.area ?? [0, 0, 4, 3];
    const bw = Math.max(1, Math.min(8, map.widthBlocks, w)), bh = Math.max(1, Math.min(8, map.heightBlocks, h));
    const bx = Math.max(0, Math.min(map.widthBlocks - bw, x)), by = Math.max(0, Math.min(map.heightBlocks - bh, y));
    return { subject: { kind: "map", map: i, bx, by, bw, bh }, moved: bx !== x || by !== y || bw !== w || bh !== h };
  }
  if (link.dex !== undefined && link.dex >= 1 && link.dex <= dexCount) return { subject: { kind: "pic", dex: link.dex }, moved: false };
  return null;
}

type Fetched = { layer: PickedLayer; width: number; height: number; rgba: Uint8ClampedArray };

export function ReliefEditor() {
  const [rom, setRom] = useState<Uint8Array | null | undefined>(undefined);
  useEffect(() => {
    void (async () => setRom((await loadStoredRom()) ?? (await fetchDevRom())))();
  }, []);
  if (rom === undefined) return <div className="relief-msg">Loading your cartridge…</div>;
  if (!rom) return <div className="relief-msg">Load your cartridge in the game first, then come back to this page.</div>;
  return <Editor rom={rom} />;
}

function Editor({ rom }: { rom: Uint8Array }) {
  const world = useMemo<WorldData>(() => parseWorld(rom), [rom]);
  const dex = useMemo(() => dexEntries(rom), [rom]);
  // The edits, mutated in place as Nick paints; `version` re-renders. "TILESET:id" → 64 normals; dex → normals.
  const [store] = useState(() => new EditStore(loadLocal() ?? emptyDoc()));
  const [version, setVersion] = useState(0);
  const bump = () => setVersion((v) => v + 1);
  const [admin, setAdmin] = useState(false);
  const [saved, setSaved] = useState("Saved on this device");
  // A link (e.g. from the relief lab) can choose the subject and prefill it from a prediction.
  const [link] = useState(() => parseReliefLink(location.search));
  const [linked] = useState(() => linkedSubject(link, world, dex.length));
  const [subject, setSubject] = useState<Subject>(linked?.subject ?? { kind: "map", map: MAP_NAMES.indexOf("PALLET_TOWN"), bx: 1, by: 1, bw: 4, bh: 3 });
  const synced = useRef<Promise<void>>(Promise.resolve());
  const [prefilled, setPrefilled] = useState("");
  const [mode, setMode] = useState<BrushMode>("pixel");
  const [brush, setBrush] = useState<Normal>(FRONT);
  const [pitch, setPitch] = useState(30);
  const [overlay, setOverlay] = useState(true);
  const [sides, setSides] = useState(true);
  const [mirror, setMirror] = useState(true);
  const [spin, setSpin] = useState(true);
  const [showMap, setShowMap] = useState(false);
  const undo = useRef<(() => void)[]>([]);

  // Sign-in decides whether the account copy is used.
  useEffect(() => {
    synced.current = (async () => {
      const account = await me().catch(() => null);
      if (!account?.admin) return;
      setAdmin(true);
      const remote = await loadRemote();
      store.replace(newer(store.doc, remote));
      setSaved("Synced with your account"); bump();
    })();
  }, [store]);

  // ---- Tiles and pictures as editable arrays ----
  const tileArray = useCallback((ts: Tileset, t: number, label: Label | undefined): Normal[] => store.tile(ts.name, t, () => seedNormal(label, pitch)), [store, pitch]);

  const region = useMemo<Region>(() => {
    void version;
    if (subject.kind === "map") {
      const map = world.maps[subject.map]!;
      const ts = world.tilesets[map.tileset]!;
      const labels = blockLabels(ts);
      const pal = world.sgbPalettes[overworldPalette(map.id, map.tileset)]!.map(rgbOf);
      const at = (x: number, y: number) => {
        const bx = subject.bx + Math.floor(x / 32), by = subject.by + Math.floor(y / 32);
        const b = bx >= 0 && by >= 0 && bx < map.widthBlocks && by < map.heightBlocks ? map.blocks[by * map.widthBlocks + bx]! : map.borderBlock;
        const pos = ((y % 32) >> 3) * 4 + ((x % 32) >> 3);
        return { t: ts.blocks[b * 16 + pos]!, label: labels[b]?.[pos], p: (y % 8) * 8 + (x % 8) };
      };
      return {
        width: subject.bw * 32, height: subject.bh * 32,
        shade: (x, y) => { const a = at(x, y); return ts.tiles[a.t * 64 + a.p]!; },
        colour: (x, y) => { const a = at(x, y); return pal[ts.tiles[a.t * 64 + a.p]!]!; },
        inside: () => true,
        normal: (x, y) => { const a = at(x, y); return tileArray(ts, a.t, a.label)[a.p]!; },
        set: (x, y, n) => { const a = at(x, y); tileArray(ts, a.t, a.label)[a.p] = n; },
        ground: (x, y) => { const a = at(x, y); return !!a.label && GROUND_LABELS.has(a.label) && tileArray(ts, a.t, a.label)[a.p]![1] > 0.9; },
      };
    }
    const entry = dex[subject.dex - 1]!;
    const pic = dexPicture(rom, entry.picture), w = pic.width * 8, h = pic.height * 8;
    const pal = world.sgbPalettes[battlePalette(rom, entry.species)]!.map(rgbOf);
    const outside = pictureOutside(pic.pixels, w, h);
    const inside = (x: number, y: number) => !outside[y * w + x];
    const arr = store.pic(subject.dex, w, h, () => domeNormals(w, h, inside));
    const a = arr;
    return {
      width: w, height: h,
      shade: (x, y) => pic.pixels[y * w + x]!,
      colour: (x, y) => (inside(x, y) ? pal[pic.pixels[y * w + x]!]! : [255, 255, 255]),
      inside, normal: (x, y) => a[y * w + x]!, set: (x, y, n) => { a[y * w + x] = n; }, ground: () => false,
    };
  }, [subject, world, dex, rom, tileArray, store, version]);

  // ---- Prefill from a lab prediction (?seed=<manifest>&sample=<id>&layer=<name>) ----
  const fetchPrediction = useCallback(async (): Promise<Fetched | string> => {
    const { seed, sample, layer } = link;
    if (!seed || !sample || !layer) return "the link needs a sample and a layer";
    if (!linked) return "the link doesn't name a map or Pokémon the editor knows";
    if (seed.split("/").some((s) => !s || s === "." || s === "..")) return "the manifest path isn't valid";
    const res = await fetch(`/api/admin/lab/${seed}`).catch(() => null);
    if (!res?.ok) return `couldn't load ${seed}${res ? ` (${res.status})` : ""}`;
    const picked = pickLayer(await res.json().catch(() => null), seed, sample, layer);
    if (typeof picked === "string") return picked;
    const px = await loadPixels(`/api/admin/lab/${picked.file}`).catch(() => null);
    return px ? { layer: picked, ...px } : `couldn't load ${picked.file}`;
  }, [link, linked]);
  /** Fills what hasn't been painted; returns the banner. */
  const applyPrediction = useCallback((fetched: Fetched | string): string => {
    if (typeof fetched === "string" || !linked) return `Couldn't prefill: ${typeof fetched === "string" ? fetched : "nothing to fill"}`;
    const { layer, width, height, rgba } = fetched, from = `${layer.label} of ${layer.title}`;
    const pred = decodeLayer(layer.encoding, rgba, pitch);
    if (!pred) return `${from} is ${layer.encoding}, which can't prefill directions`;
    const s = linked.subject;
    if (s.kind === "map") {
      if (linked.moved) return `Couldn't prefill: the area was moved to fit the map, so ${from} doesn't line up`;
      if (width !== s.bw * 32 || height !== s.bh * 32) return `Couldn't prefill: ${from} is ${width}×${height}, the area is ${s.bw * 32}×${s.bh * 32}`;
      const map = world.maps[s.map]!, ts = world.tilesets[map.tileset]!, labels = blockLabels(ts), labelOf = new Map<number, Label | undefined>();
      const tiles = tilesFromPrediction(width, height, pred, (tx, ty) => {
        const b = map.blocks[(s.by + (ty >> 2)) * map.widthBlocks + s.bx + (tx >> 2)]!, pos = (ty & 3) * 4 + (tx & 3), t = ts.blocks[b * 16 + pos]!;
        if (!labelOf.has(t)) labelOf.set(t, labels[b]?.[pos]);
        return t;
      }, (t) => store.doc.tiles[ts.name]?.[String(t)] !== undefined);
      for (const [t, px] of tiles) overlayPrediction(tileArray(ts, t, labelOf.get(t)), px);
      return `Prefilled from ${from}; tiles you'd already painted were kept`;
    }
    const entry = dex[s.dex - 1]!, pic = dexPicture(rom, entry.picture), w = pic.width * 8, h = pic.height * 8;
    if (store.doc.pics[`mon:${s.dex}`]) return `Not prefilled from ${from}: you'd already painted this picture, so it was kept`;
    if (width !== w || height !== h) return `Couldn't prefill: ${from} is ${width}×${height}, the picture is ${w}×${h}`;
    const outside = pictureOutside(pic.pixels, w, h);
    overlayPrediction(store.pic(s.dex, w, h, () => domeNormals(w, h, (x, y) => !outside[y * w + x])), pred);
    return `Prefilled from ${from}`;
  }, [linked, pitch, world, dex, rom, store, tileArray]);
  // Once on open, after the account copy is in (the sync above), so tiles already painted there are kept.
  const prefillOnce = useRef({ fetchPrediction, applyPrediction });
  useEffect(() => {
    if (!link.seed) return;
    let live = true;
    void (async () => {
      const [fetched] = await Promise.all([prefillOnce.current.fetchPrediction(), synced.current]);
      if (!live) return;
      setPrefilled(prefillOnce.current.applyPrediction(fetched)); bump();
    })();
    return () => { live = false; };
  }, [link]);

  // ---- Saving ----
  const saveTimer = useRef<number>(0);
  const persist = useCallback(() => {
    clearTimeout(saveTimer.current);
    setSaved("Saving…");
    saveTimer.current = window.setTimeout(async () => {
      const d = store.flush();
      saveLocal(d);
      if (admin) setSaved((await saveRemote(d)) ? `Saved to your account, ${new Date().toLocaleTimeString()}` : "Saved on this device (couldn't reach your account)");
      else setSaved(`Saved on this device, ${new Date().toLocaleTimeString()}`);
    }, 800);
  }, [admin, store]);

  // ---- Painting ----
  const brushFor = (n: Normal) => normalise(n);
  const paint = useCallback((x: number, y: number) => {
    if (x < 0 || y < 0 || x >= region.width || y >= region.height) return;
    if (mode === "pick") { setBrush(region.normal(x, y)); setMode("pixel"); return; }
    const targets: [number, number][] = [];
    if (mode === "pixel") targets.push([x, y]);
    else if (mode === "row") for (let i = 0; i < region.width; i++) targets.push([i, y]);
    else { // fill: touching pixels with the same shade
      const s = region.shade(x, y), seen = new Set<number>(), q: [number, number][] = [[x, y]];
      while (q.length) { const [cx, cy] = q.pop()!; const k = cy * region.width + cx;
        if (cx < 0 || cy < 0 || cx >= region.width || cy >= region.height || seen.has(k) || region.shade(cx, cy) !== s || !region.inside(cx, cy)) continue;
        seen.add(k); targets.push([cx, cy]); q.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]); }
    }
    const before = targets.map(([tx, ty]) => [tx, ty, region.normal(tx, ty)] as const);
    const r = region;
    undo.current.push(() => { for (const [tx, ty, n] of before) r.set(tx, ty, n); });
    if (undo.current.length > 200) undo.current.shift();
    for (const [tx, ty] of targets) if (region.inside(tx, ty)) region.set(tx, ty, brushFor(brush));
    bump(); persist();
  }, [region, mode, brush, persist]);

  // ---- 2D canvas ----
  const c2d = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = c2d.current; if (!c) return;
    c.width = region.width; c.height = region.height;
    const g = c.getContext("2d")!, im = g.createImageData(region.width, region.height);
    for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
      let [r, gg, b] = region.colour(x, y);
      if (overlay && region.inside(x, y)) { const n = normalColour(region.normal(x, y)); r = (r + n[0]) / 2; gg = (gg + n[1]) / 2; b = (b + n[2]) / 2; }
      im.data.set([r, gg, b, 255], (y * region.width + x) * 4);
    }
    g.putImageData(im, 0, 0);
  }, [region, overlay, version]);
  const painting = useRef(false), lastPx = useRef("");
  const toPixel = (e: React.PointerEvent) => {
    const r = c2d.current!.getBoundingClientRect(), scale = Math.min(r.width / region.width, r.height / region.height);
    const ox = r.left + (r.width - region.width * scale) / 2, oy = r.top + (r.height - region.height * scale) / 2;
    return [Math.floor((e.clientX - ox) / scale), Math.floor((e.clientY - oy) / scale)] as const;
  };
  const onDown = (e: React.PointerEvent) => { painting.current = true; (e.target as Element).setPointerCapture(e.pointerId); const [x, y] = toPixel(e); lastPx.current = `${x},${y}`; paint(x, y); };
  const onMove = (e: React.PointerEvent) => { if (!painting.current || mode === "fill" || mode === "pick") return; const [x, y] = toPixel(e); const k = `${x},${y}`; if (k !== lastPx.current) { lastPx.current = k; paint(x, y); } };
  const onUp = () => { painting.current = false; };

  // ---- 3D view ----
  const framed = useRef("");
  const spinRef = useRef(spin);
  useEffect(() => { spinRef.current = spin; }, [spin]);
  const c3d = useRef<HTMLCanvasElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; mesh?: THREE.Mesh; light: THREE.DirectionalLight } | null>(null);
  useEffect(() => {
    const canvas = c3d.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x141912);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 4000);
    const controls = new OrbitControls(camera, canvas); controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const light = new THREE.DirectionalLight(0xffffff, 1.1); scene.add(light);
    three.current = { renderer, scene, camera, controls, light };
    framed.current = ""; // a fresh camera needs framing again (also after a StrictMode remount)
    const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    let raf = 0, t = 0, last = performance.now();
    const loop = (now: number) => { t += spinRef.current ? (now - last) / 1000 : 0; last = now;
      const r = 300; light.position.set(Math.cos(t * 0.6) * r, 220 + Math.sin(t * 0.6) * 80, 260); controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); three.current = null; };
  }, []);
  useEffect(() => {
    const t = three.current; if (!t) return;
    const m: Mesh = subject.kind === "map"
      ? mapRelief({ width: region.width, height: region.height, normal: region.normal, colour: region.colour, ground: region.ground }, { sides, mirror })
      : pictureRelief({ width: region.width, height: region.height, inside: region.inside, normal: region.normal, colour: region.colour }, 1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(m.positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(m.normals, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(m.colours, 3));
    if (t.mesh) { t.scene.remove(t.mesh); t.mesh.geometry.dispose(); }
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    if (subject.kind === "map") mesh.position.set(-region.width / 2, 0, region.height / 2);
    t.scene.add(mesh); t.mesh = mesh;
    const key = JSON.stringify(subject);
    if (framed.current !== key) { // re-frame only when the subject changes, not on every stroke
      framed.current = key;
      // Fit the whole shape: look along the Game Boy's direction (from the front, above) for maps.
      geo.computeBoundingSphere();
      const sphere = geo.boundingSphere!, centre = sphere.center.clone().add(mesh.position);
      const dir = subject.kind === "map" ? new THREE.Vector3(0, 0.75, 0.66).normalize() : new THREE.Vector3(0.2, 0.05, 1).normalize();
      const dist = sphere.radius / Math.sin((t.camera.fov * Math.PI) / 360) * 0.95;
      t.camera.position.copy(centre).addScaledVector(dir, dist); t.controls.target.copy(centre);
      t.camera.near = dist / 50; t.camera.far = dist * 10; t.camera.updateProjectionMatrix();
      t.controls.update();
    }
  }, [region, sides, mirror, subject, version]);

  // ---- Map overview (tap to choose the area) ----
  const cMap = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (subject.kind !== "map") return;
    const c = cMap.current; if (!c) return;
    const map = world.maps[subject.map]!, ts = world.tilesets[map.tileset]!;
    const W = map.widthBlocks * 32, H = map.heightBlocks * 32; c.width = W; c.height = H;
    const g = c.getContext("2d")!, im = g.createImageData(W, H), shades = [232, 160, 88, 24];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const b = map.blocks[(y >> 5) * map.widthBlocks + (x >> 5)]!, t = ts.blocks[b * 16 + ((y & 31) >> 3) * 4 + ((x & 31) >> 3)]!, v = shades[ts.tiles[t * 64 + (y & 7) * 8 + (x & 7)]!]!;
      im.data.set([v, v, v, 255], (y * W + x) * 4);
    }
    g.putImageData(im, 0, 0);
    g.strokeStyle = "#ff2d75"; g.lineWidth = 3; g.strokeRect(subject.bx * 32 + 1.5, subject.by * 32 + 1.5, subject.bw * 32 - 3, subject.bh * 32 - 3);
  }, [subject, world, showMap]);
  const pickArea = (e: React.PointerEvent) => {
    if (subject.kind !== "map") return;
    const map = world.maps[subject.map]!, r = cMap.current!.getBoundingClientRect();
    // The canvas is letterboxed (object-fit: contain), so map the tap through the drawn area.
    const W = map.widthBlocks * 32, H = map.heightBlocks * 32, k = Math.min(r.width / W, r.height / H);
    const px = (e.clientX - r.left - (r.width - W * k) / 2) / k, py = (e.clientY - r.top - (r.height - H * k) / 2) / k;
    const bx = Math.floor(px / 32 - subject.bw / 2 + 0.5), by = Math.floor(py / 32 - subject.bh / 2 + 0.5);
    setSubject({ ...subject, bx: Math.max(0, Math.min(map.widthBlocks - subject.bw, bx)), by: Math.max(0, Math.min(map.heightBlocks - subject.bh, by)) });
  };

  // ---- Direction wheel ----
  const cWheel = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cWheel.current; if (!c) return;
    const S = 96; c.width = c.height = S; const g = c.getContext("2d")!, im = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x / S) * 2 - 1, v = 1 - (y / S) * 2, d = u * u + v * v;
      if (d > 1) continue;
      const n = normalColour([u, v, Math.sqrt(1 - d)]); im.data.set([...n, 255], (y * S + x) * 4);
    }
    g.putImageData(im, 0, 0);
    const bx = (brush[0] + 1) / 2 * S, by = (1 - brush[1]) / 2 * S;
    g.strokeStyle = "#000"; g.lineWidth = 2; g.beginPath(); g.arc(bx, by, 6, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = "#fff"; g.beginPath(); g.arc(bx, by, 8, 0, Math.PI * 2); g.stroke();
  }, [brush]);
  const pickWheel = (e: React.PointerEvent) => {
    const r = cWheel.current!.getBoundingClientRect();
    let u = ((e.clientX - r.left) / r.width) * 2 - 1, v = 1 - ((e.clientY - r.top) / r.height) * 2; const d = Math.hypot(u, v);
    if (d > 1) { u /= d; v /= d; }
    setBrush(normalise([u, v, Math.sqrt(Math.max(0, 1 - u * u - v * v))]));
    if (mode === "pick") setMode("pixel");
  };

  const presets: [string, Normal][] = [["Top", TOP], ["Front", FRONT], [`Slope ${pitch}°`, slope(pitch)], ["Hip ◀", hip(-1, pitch)], ["Hip ▶", hip(1, pitch)]];
  const same = (a: Normal, b: Normal) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.02;
  const mapList = useMemo(() => world.maps.map((m, i) => (m ? { i, name: m.name } : null)).filter(Boolean) as { i: number; name: string }[], [world]);

  return (
    <div className="relief">
      <section className="relief-left">
        <header className="relief-bar">
          <select aria-label="What to edit" value={subject.kind === "map" ? `map:${subject.map}` : `mon:${subject.dex}`}
            onChange={(e) => { const [k, v] = e.target.value.split(":"); setSubject(k === "map" ? { kind: "map", map: Number(v), bx: 0, by: 0, bw: subject.kind === "map" ? subject.bw : 4, bh: subject.kind === "map" ? subject.bh : 3 } : { kind: "pic", dex: Number(v) }); }}>
            <optgroup label="Maps">{mapList.map((m) => <option key={m.i} value={`map:${m.i}`}>{m.name}</option>)}</optgroup>
            <optgroup label="Pokémon">{dex.map((d) => <option key={d.dex} value={`mon:${d.dex}`}>#{d.dex} {d.name}</option>)}</optgroup>
          </select>
          {subject.kind === "map" && <button type="button" aria-pressed={showMap} onClick={() => setShowMap(!showMap)}>Area</button>}
          {subject.kind === "map" && (
            <select aria-label="Area size" value={`${subject.bw}x${subject.bh}`} onChange={(e) => { const [bw, bh] = e.target.value.split("x").map(Number) as [number, number]; setSubject({ ...subject, bw, bh }); }}>
              {(AREA_SIZES.includes(`${subject.bw}x${subject.bh}`) ? AREA_SIZES : [...AREA_SIZES, `${subject.bw}x${subject.bh}`]).map((s) => <option key={s} value={s}>{s.replace("x", " × ")} blocks</option>)}
            </select>
          )}
          <span className="relief-saved">{saved}</span>
          {prefilled && <span role="status" style={{ flexBasis: "100%", color: "var(--r-on)", fontSize: 12 }}>{prefilled}</span>}
        </header>
        <div className="relief-tools">
          <div className="relief-group" role="group" aria-label="Direction">
            {presets.map(([l, n]) => <button type="button" key={l} aria-pressed={same(brush, n) && mode !== "pick"} onClick={() => { setBrush(n); if (mode === "pick") setMode("pixel"); }}>{l}</button>)}
            <canvas ref={cWheel} className="relief-wheel" onPointerDown={pickWheel} aria-label="Direction wheel: tap to pick any direction" />
          </div>
          <div className="relief-group" role="group" aria-label="Brush">
            {(["pixel", "row", "fill", "pick"] as const).map((m) => <button type="button" key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{{ pixel: "Pixel", row: "Row", fill: "Fill shade", pick: "Pick" }[m]}</button>)}
            <button type="button" onClick={() => { undo.current.pop()?.(); bump(); persist(); }}>Undo</button>
          </div>
          <div className="relief-group">
            <label>Pitch <input type="range" min={5} max={75} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} /></label>
            <label><input type="checkbox" checked={overlay} onChange={(e) => setOverlay(e.target.checked)} /> Show directions</label>
          </div>
        </div>
        <div className="relief-canvas">
          <canvas ref={c2d} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} aria-label="Pixels: drag to paint directions" />
        </div>
        {subject.kind === "map" && showMap && (
          <div className="relief-pop">
            <p>Tap where to edit.</p>
            <canvas ref={cMap} className="relief-map" onPointerDown={(e) => { pickArea(e); setShowMap(false); }} aria-label="Map: tap to choose the area to edit" />
          </div>
        )}
      </section>
      <section className="relief-right">
        <canvas ref={c3d} className="relief-3d" aria-label="3D preview: drag to turn" />
        <div className="relief-bar relief-bar-3d">
          {subject.kind === "map" && <label><input type="checkbox" checked={sides} onChange={(e) => setSides(e.target.checked)} /> Sides</label>}
          {subject.kind === "map" && <label><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> Mirror roofs</label>}
          <label><input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} /> Moving light</label>
          <button type="button" onClick={() => download(store.doc)}>Export</button>
          {!admin && <a href="/login">Sign in to sync</a>}
        </div>
      </section>
    </div>
  );
}
