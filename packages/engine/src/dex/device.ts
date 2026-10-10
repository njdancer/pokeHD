// The HD Pokédex as a device the player holds up to the screen (p2-dex): the modelled one (model.ts)
// when it loads, else a red handheld modelled
// here from simple shapes (no outside models), after the anime's: a big blue lens and three
// little lights on a top band, a cover with a stepped edge that swings open like a book, a screen,
// a d-pad and buttons. It rises from the bottom of the screen, tips upright and opens; once open
// it faces the camera squarely, so the page shown on its screen (DOM, placed over the screen by
// `onScreen`) reads flat and sharp.
//
// It draws on its own transparent canvas over the game, with its own small renderer, so the
// world's post-processing doesn't touch it.
import * as THREE from "three/webgpu";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { loadDexModel, type DexModel } from "./model.ts";

/** Screen corners in CSS pixels: top-left, top-right, bottom-right, bottom-left. */
export type ScreenQuad = [x: number, y: number][];

export interface DexDeviceOptions {
  /** Called each frame the device moves, with where its screen is on the page. */
  onScreen(quad: ScreenQuad, open: number, settled: boolean): void;
  /** The body colour (the anime's red). */
  colour?: number;
  /**
   * The modelled device (a GLB from assets-src/dex). Once it's open the camera pushes in until
   * its screen nearly fills the view. Without one, or if it won't load, the simple built one.
   */
  model?: string;
}

export interface DexDevice {
  /** Raises the device and opens it; resolves once it's open. `instantly` skips the animation. */
  open(instantly?: boolean): Promise<void>;
  /** Closes the cover and lowers it; resolves once it's gone. */
  close(): Promise<void>;
  /** 0 hidden … 1 open: how far through raising and opening it is. */
  readonly progress: number;
  /** The screen's size and shape: width over height. */
  readonly screenAspect: number;
  /** Renders one frame now (for screenshots). */
  render(): Promise<void>;
  dispose(): void;
}

// Sizes in centimetres, roughly a real handheld's: 9 × 14, about 1.6 deep with the cover shut.
const W = 9;
const H = 14;
const R = 0.9;
const BODY_DEPTH = 1.1;
const COVER_DEPTH = 0.45;
/** The screen, centred across, a little below the middle. */
const SCREEN = { x: 0, y: -0.75, w: 7.3, h: 7.6 };
const SCREEN_Z = 0.06;
/** The cover's stepped top edge: low under the lens on the left, high under the lights. */
const STEP = { low: 3.55, high: 4.55, from: -1.1, to: 0.0 };

const RAISE_S = 0.5;
const OPEN_S = 0.42;
const PUSH_S = 0.5;
/** How far open (0–1 of its CoverOpen action) the model's cover is while it's raised. */
const AJAR = 0.3;

function roundedRect(x: number, y: number, w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** The cover's outline in its own space (hinge at x = 0): rounded below, stepped on top. */
function coverShape(): THREE.Shape {
  const s = new THREE.Shape();
  const left = 0;
  const right = W;
  const bottom = -H / 2;
  const r = R;
  const lo = STEP.low;
  const hi = STEP.high;
  const from = STEP.from + W / 2;
  const to = STEP.to + W / 2;
  s.moveTo(left, bottom + r);
  s.quadraticCurveTo(left, bottom, left + r, bottom);
  s.lineTo(right - r, bottom);
  s.quadraticCurveTo(right, bottom, right, bottom + r);
  s.lineTo(right, hi - 0.35);
  s.quadraticCurveTo(right, hi, right - 0.35, hi);
  s.lineTo(to + 0.2, hi);
  s.quadraticCurveTo(to, hi, to - 0.1, hi - 0.1);
  s.lineTo(from + 0.1, lo + 0.1);
  s.quadraticCurveTo(from, lo, from - 0.2, lo);
  s.lineTo(left + 0.35, lo);
  s.quadraticCurveTo(left, lo, left, lo - 0.35);
  s.lineTo(left, bottom + r);
  return s;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export async function createDexDevice(canvas: HTMLCanvasElement, options: DexDeviceOptions): Promise<DexDevice> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.3;
  room.dispose();

  const camera = new THREE.PerspectiveCamera(24, 1, 1, 400);
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x5a4636, 0.7));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
  key.position.set(-6, 9, 12);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2);
  rim.position.set(8, 4, -6);
  scene.add(rim);

  const red = new THREE.MeshPhysicalMaterial({ color: options.colour ?? 0xd8283a, roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 });
  const redDark = new THREE.MeshStandardMaterial({ color: 0xa31a2a, roughness: 0.55 });
  const black = new THREE.MeshStandardMaterial({ color: 0x1d1d24, roughness: 0.5 });
  const bezel = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ec, roughness: 0.3 });
  const blueKey = new THREE.MeshPhysicalMaterial({ color: 0x3b8ee0, roughness: 0.3, clearcoat: 0.8 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0x3fb6ff, roughness: 0.05, metalness: 0, clearcoat: 1, transmission: 0, emissive: 0x0a4fa8, emissiveIntensity: 0.6 });
  const screenMat = new THREE.MeshBasicMaterial({ color: 0xd2ecd6 });
  const lights = [0xff4040, 0xffd23a, 0x4ee86a].map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.25 }));

  const device = new THREE.Group();
  scene.add(device);
  const base = new THREE.Group();
  device.add(base);

  const extrude = (shape: THREE.Shape, depth: number, bevel: number) =>
    new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10 });
  const body = new THREE.Mesh(extrude(roundedRect(-W / 2, -H / 2, W, H, R), BODY_DEPTH, 0.14), red);
  // Bevels grow the shape both ways: put its front face at z = 0.
  body.position.z = -BODY_DEPTH - 0.14;
  base.add(body);

  // The top band: lens in a white ring, and three lights.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.2, 16, 48), white);
  ring.position.set(-2.65, 5.05, 0.12);
  base.add(ring);
  const lensMesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), lens);
  lensMesh.rotation.x = Math.PI / 2;
  lensMesh.scale.set(1, 0.42, 1);
  lensMesh.position.set(-2.65, 5.05, 0.08);
  base.add(lensMesh);
  lights.forEach((m, i) => {
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 12), m);
    led.scale.z = 0.5;
    led.position.set(-0.35 + i * 0.95, 5.55, 0.1);
    base.add(led);
  });
  // A seam across the band, where the cover's stepped edge sits when shut.
  const bandLine = new THREE.Mesh(new THREE.BoxGeometry(W * 0.86, 0.06, 0.04), redDark);
  bandLine.position.set(0, 6.4, 0.02);
  base.add(bandLine);

  // The screen in its bezel.
  const bezelMesh = new THREE.Mesh(extrude(roundedRect(SCREEN.x - SCREEN.w / 2 - 0.3, SCREEN.y - SCREEN.h / 2 - 0.3, SCREEN.w + 0.6, SCREEN.h + 0.6, 0.45), 0.02, 0.03), bezel);
  bezelMesh.position.z = 0.0;
  base.add(bezelMesh);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screenMat);
  screen.position.set(SCREEN.x, SCREEN.y, SCREEN_Z);
  base.add(screen);

  // Below the screen: a d-pad, two buttons and a speaker grille.
  const padY = -5.85;
  for (const [w, h] of [[1.5, 0.5], [0.5, 1.5]] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.3), black);
    arm.position.set(-2.85, padY, 0.1);
    base.add(arm);
  }
  for (const [x, y] of [[2.2, padY + 0.15], [3.2, padY - 0.3]] as const) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.25, 24), blueKey);
    b.rotation.x = Math.PI / 2;
    b.position.set(x, y, 0.1);
    base.add(b);
  }
  for (let i = 0; i < 4; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.09, 0.05), redDark);
    slit.position.set(-0.1, padY + 0.35 - i * 0.24, 0.02);
    base.add(slit);
  }

  // The cover, hinged on the left edge. Its inside is laid out like the anime's: a little
  // readout up top, a block of blue keys, a pair of white keys and a light, and a grille.
  const hinge = new THREE.Group();
  hinge.position.set(-W / 2, 0, 0.12);
  base.add(hinge);
  const cover = new THREE.Mesh(extrude(coverShape(), COVER_DEPTH, 0.1), red);
  hinge.add(cover);
  // Turned to face out of the cover's inside: x runs from the hinge (0) to the far edge (-W).
  const inside = new THREE.Group();
  inside.position.z = -0.1;
  inside.rotation.y = Math.PI;
  hinge.add(inside);
  const mid = -W / 2;
  const panel = new THREE.Mesh(extrude(roundedRect(mid - 3.85, -6.35, 7.7, 9.45, 0.55), 0.01, 0.04), redDark);
  inside.add(panel);
  const readoutBezel = new THREE.Mesh(extrude(roundedRect(mid - 3.2, 0.55, 6.4, 2.1, 0.3), 0.02, 0.04), bezel);
  readoutBezel.position.z = 0.04;
  inside.add(readoutBezel);
  const readoutMat = new THREE.MeshStandardMaterial({ color: 0x0f2a24, emissive: 0x1e7a5c, emissiveIntensity: 0.45, roughness: 0.15 });
  const readout = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 1.6), readoutMat);
  readout.position.set(mid, 1.6, 0.11);
  inside.add(readout);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x8ff0c4 });
  for (const [w, y] of [[3.6, 2.0], [4.6, 1.6], [2.4, 1.2]] as const) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.1), glowMat);
    line.position.set(mid - 2.5 + w / 2, y, 0.115);
    inside.add(line);
  }
  const keyShape = new RoundedBoxGeometry(1.15, 0.8, 0.22, 3, 0.12);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 5; col++) {
      const k = new THREE.Mesh(keyShape, blueKey);
      k.position.set(mid + (col - 2) * 1.35, -0.7 - row * 1.05, 0.08);
      inside.add(k);
    }
  }
  const pill = new RoundedBoxGeometry(1.7, 0.42, 0.18, 3, 0.2);
  for (const x of [mid - 2.4, mid - 0.4]) {
    const k = new THREE.Mesh(pill, white);
    k.position.set(x, -3.45, 0.06);
    inside.add(k);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 12), lights[1]!);
  lamp.scale.z = 0.5;
  lamp.position.set(mid + 2.2, -3.45, 0.06);
  inside.add(lamp);
  for (let i = 0; i < 4; i++) {
    const slit = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.09, 0.05), black);
    slit.position.set(mid, -4.7 - i * 0.32, 0.04);
    inside.add(slit);
  }
  const hingeBar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, H * 0.8, 16), redDark);
  hingeBar.position.set(-W / 2 - 0.05, 0, 0.1);
  base.add(hingeBar);

  // The modelled device in place of the built one, centred as it is open.
  const model: DexModel | null = options.model
    ? await loadDexModel(options.model).catch((e: unknown) => {
        console.warn("[pokeHD] Pokédex model failed; using the simple one", e);
        return null;
      })
    : null;
  const shutCentre = new THREE.Vector3();
  if (model) {
    base.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    base.clear();
    base.add(model.root);
    model.root.position.copy(model.opened.getCenter(new THREE.Vector3())).negate();
    model.shut.getCenter(shutCentre).add(model.root.position);
  }
  const frameW = model ? model.opened.max.x - model.opened.min.x : W;
  const frameH = model ? model.opened.max.y - model.opened.min.y : H;

  // Framing: the open device's body fills the view's height (or width, on a narrow screen).
  let width = 1;
  let height = 1;
  const frame = () => {
    width = canvas.clientWidth || innerWidth;
    height = canvas.clientHeight || innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fitH = (frameH * 1.06) / (2 * tan);
    // On a narrow (phone) screen the screen itself fills the width and the body's sides go past
    // the edges, so the page is as big as it can be. The model's camera pushes in to its screen
    // anyway, so it starts with the whole device in view.
    const fitW = model ? (frameW * 1.08) / (2 * tan * camera.aspect) : Math.min(W * 1.08, SCREEN.w * 1.04 + (camera.aspect - 0.45) * 8) / (2 * tan * camera.aspect);
    far = Math.max(fitH, fitW) + 1;
    camera.updateProjectionMatrix();
  };
  let far = 0;
  frame();
  const resize = new ResizeObserver(frame);
  resize.observe(canvas);

  // 0–1 raises it, 1–2 opens the cover, 2–3 pushes in to the model's screen.
  const end = model ? 3 : 2;
  let phase = 0;
  let target = 0;
  let last = performance.now();
  let raf = 0;
  let settle: (() => void) | null = null;
  const corners = model ? model.screenCorners : [
    new THREE.Vector3(SCREEN.x - SCREEN.w / 2, SCREEN.y + SCREEN.h / 2, SCREEN_Z),
    new THREE.Vector3(SCREEN.x + SCREEN.w / 2, SCREEN.y + SCREEN.h / 2, SCREEN_Z),
    new THREE.Vector3(SCREEN.x + SCREEN.w / 2, SCREEN.y - SCREEN.h / 2, SCREEN_Z),
    new THREE.Vector3(SCREEN.x - SCREEN.w / 2, SCREEN.y - SCREEN.h / 2, SCREEN_Z),
  ];
  const v = new THREE.Vector3();
  const look = new THREE.Vector3();
  const screenAt = new THREE.Vector3();
  const tan = () => Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

  const pose = (now: number) => {
    const raise = easeOut(clamp01(phase));
    const open = easeInOut(clamp01(phase - 1));
    device.position.y = (1 - raise) * -frameH * 1.25;
    device.rotation.x = (1 - raise) * -0.75;
    device.rotation.z = (1 - raise) * 0.18;
    // While opening, the device turns a little to show the cover swinging, then squares up.
    device.rotation.y = Math.sin(open * Math.PI) * 0.12;
    // Not quite flat: it falls back a little, so it reads as a cover rather than a second screen.
    hinge.rotation.y = -open * Math.PI * 0.84;
    if (model) {
      // Never quite shut: it comes up with the cover already ajar, the thumb in the gap.
      model.setOpen(AJAR + (1 - AJAR) * open);
      // Shut, the device is just its body: keep that centred until it opens.
      device.position.x = -shutCentre.x * (1 - open);
    }
    lights.forEach((m, i) => (m.emissiveIntensity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 260 - i * 1.2)) * open));
    device.updateMatrixWorld(true);
    const space = model ? model.screenSpace : base;
    // The camera: back far enough for the whole device, then (the model) in to its screen until
    // it nearly fills the view: by height on a wide window, by width on a phone.
    const push = model ? easeInOut(clamp01(phase - 2)) : 0;
    camera.position.set(0, 0, far);
    look.set(0, 0, 0);
    if (push > 0) {
      screenAt.set(0, 0, 0);
      for (const c of corners) screenAt.add(v.copy(c).applyMatrix4(space.matrixWorld));
      screenAt.multiplyScalar(1 / corners.length);
      const sw = v.copy(corners[1]!).applyMatrix4(space.matrixWorld).distanceTo(look.copy(corners[0]!).applyMatrix4(space.matrixWorld));
      const sh = v.copy(corners[3]!).applyMatrix4(space.matrixWorld).distanceTo(look.copy(corners[0]!).applyMatrix4(space.matrixWorld));
      const near = Math.max((sh * 1.05) / (2 * tan()), (sw * 1.03) / (2 * tan() * camera.aspect));
      look.set(0, 0, 0).lerp(screenAt, push);
      camera.position.set(look.x, look.y, THREE.MathUtils.lerp(far, screenAt.z + near, push));
    }
    camera.lookAt(look);
    camera.updateMatrixWorld();
    const quad: ScreenQuad = corners.map((c) => {
      v.copy(c).applyMatrix4(space.matrixWorld).project(camera);
      return [((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height];
    });
    options.onScreen(quad, clamp01(phase - 1), phase === end);
  };

  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (phase !== target) {
      const rate = phase < 1 || (target < 1 && phase <= 1) ? 1 / RAISE_S : phase > 2 || (target > 2 && phase >= 2) ? 1 / PUSH_S : 1 / OPEN_S;
      phase = target > phase ? Math.min(target, phase + dt * rate) : Math.max(target, phase - dt * rate);
      if (phase === target) settle?.();
    }
    pose(now);
    void renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  const go = (to: number) =>
    new Promise<void>((resolve) => {
      target = to;
      if (phase === to) {
        if (!raf) tick();
        return resolve();
      }
      settle = () => {
        settle = null;
        resolve();
      };
      if (!raf) {
        last = performance.now();
        tick();
      }
    });

  return {
    open(instantly = false) {
      if (instantly) phase = end;
      return go(end);
    },
    async close() {
      await go(0);
      cancelAnimationFrame(raf);
      raf = 0;
      void renderer.render(new THREE.Scene(), camera);
    },
    get progress() {
      return phase / end;
    },
    screenAspect: model ? model.screenCorners[0]!.distanceTo(model.screenCorners[1]!) / model.screenCorners[0]!.distanceTo(model.screenCorners[3]!) : SCREEN.w / SCREEN.h,
    async render() {
      pose(performance.now());
      await renderer.renderAsync(scene, camera);
    },
    dispose() {
      cancelAnimationFrame(raf);
      resize.disconnect();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      });
      model?.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

/**
 * The CSS `matrix3d` that maps a `width`×`height` box onto `quad` (a projective transform), for
 * laying the page over the device's screen.
 */
export function quadTransform(width: number, height: number, quad: ScreenQuad): string {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad as [[number, number], [number, number], [number, number], [number, number]];
  // Square to quad (Heckbert), then scale the unit square down from the box.
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  // Column-major, with the box's own units scaled to the unit square.
  const m = [a / width, d / width, 0, g / width, b / height, e / height, 0, h / height, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((n) => +n.toFixed(8)).join(",")})`;
}
