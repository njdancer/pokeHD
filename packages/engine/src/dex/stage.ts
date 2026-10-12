// The modelled Pokédex on its own transparent canvas over the game (p2-dex), posed by motion.ts:
// the stage only draws a pose it's given and says where the screen landed, so the client keeps
// time and the page in step with it. The same camera, lights and holder as Nick's tuner
// (dashboard/dex-motion.html), so what he tuned there is what plays here.
//
// It renders on demand: a frame per `render` call, none while nothing moves.
import * as THREE from "three/webgpu";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { webgpuViewsWork } from "../webgpu-probe.ts";
import { loadDexModel, type DexModel, type ScreenShape } from "./model.ts";
import type { DexFrame, DexMeasure, DexPose } from "./motion.ts";

/** Screen corners in CSS pixels: top-left, top-right, bottom-right, bottom-left (as modelled). */
export type StageQuad = [x: number, y: number][];

export interface DexStage {
  /** The model's sizes, for motion.ts. They change with `reshape`. */
  readonly measure: DexMeasure;
  /** The view for motion.ts (without `fit`, which is the caller's). */
  readonly frame: DexFrame;
  reshape(shape: ScreenShape): void;
  /** The canvas's size in CSS pixels. */
  resize(width: number, height: number): void;
  /** Draws `pose` and returns where the screen's corners are on the canvas. */
  render(pose: DexPose): StageQuad;
  /** The model's materials, for the lights' glow. */
  material(name: string): THREE.MeshStandardMaterial | undefined;
  dispose(): void;
}

const FOV = 24;
const DIST = 200;

export async function createDexStage(canvas: HTMLCanvasElement, options: { model: string; shape: ScreenShape }): Promise<DexStage> {
  // WebGL2 where WebGPU is missing or its texture views are broken (as the engine decides).
  const forceWebGL = new URLSearchParams(location.search).has("webgl") || !(await webgpuViewsWork());
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL });
  await renderer.init();
  let model: DexModel;
  try {
    model = await loadDexModel(options.model);
  } catch (e) {
    renderer.dispose();
    throw e;
  }
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
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xfff4e2, 0x5a4636, 0.7));
  const key = new THREE.DirectionalLight(0xfff0d8, 2.4);
  key.position.set(-6, 9, 12);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd8ff, 1.2);
  rim.position.set(8, 4, -6);
  scene.add(rim);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 2000);
  camera.position.set(0, 0, DIST);

  // holder (on the path: position, scale, rotation) > wrap (the pinned point back to the origin) > model.
  const holder = new THREE.Group();
  const wrap = new THREE.Group();
  wrap.add(model.root);
  holder.add(wrap);
  scene.add(holder);

  const frame: DexFrame = { width: 1, height: 1, unitsPerPixel: 1 };
  const measure: DexMeasure = { shut: { w: 1, h: 1, centre: [0, 0, 0] }, screen: { w: 1, h: 1, centre: [0, 0, 0] } };
  const corner = new THREE.Vector3();
  const toRoot = new THREE.Matrix4();
  /** The screen's corners in the model root's space (the holder at rest). */
  const inRoot = [0, 1, 2, 3].map(() => new THREE.Vector3());
  const remeasure = () => {
    holder.position.set(0, 0, 0);
    holder.rotation.set(0, 0, 0);
    holder.scale.setScalar(1);
    wrap.position.set(0, 0, 0);
    scene.updateMatrixWorld(true);
    const s = model.shut, c = s.getCenter(new THREE.Vector3());
    measure.shut = { w: s.max.x - s.min.x, h: s.max.y - s.min.y, centre: [c.x, c.y, c.z] };
    toRoot.copy(model.root.matrixWorld).invert();
    model.screenCorners.forEach((p, i) => inRoot[i]!.copy(p).applyMatrix4(model.screenSpace.matrixWorld).applyMatrix4(toRoot));
    const mid = inRoot.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(0.25);
    measure.screen = { w: inRoot[0]!.distanceTo(inRoot[1]!), h: inRoot[0]!.distanceTo(inRoot[3]!), centre: [mid.x, mid.y, mid.z] };
  };
  model.reshape(options.shape);
  remeasure();

  return {
    measure,
    frame,
    reshape(shape) {
      const s = model.shape;
      if (s.aspect === shape.aspect && s.radius === shape.radius) return;
      model.reshape(shape);
      remeasure();
    },
    resize(width, height) {
      width = Math.max(1, Math.round(width));
      height = Math.max(1, Math.round(height));
      if (width === frame.width && height === frame.height) return;
      frame.width = width;
      frame.height = height;
      frame.unitsPerPixel = (2 * DIST * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / height;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    render(pose) {
      wrap.position.set(-pose.pivot[0], -pose.pivot[1], -pose.pivot[2]);
      holder.position.set(pose.position[0], pose.position[1], 0);
      holder.scale.setScalar(pose.scale);
      holder.rotation.set(pose.rotation[0], pose.rotation[1], pose.rotation[2]);
      model.setOpen(pose.cover);
      scene.updateMatrixWorld(true);
      void renderer.render(scene, camera);
      return inRoot.map((p) => {
        corner.copy(p).applyMatrix4(model.root.matrixWorld).project(camera);
        return [((corner.x + 1) / 2) * frame.width, ((1 - corner.y) / 2) * frame.height] as [number, number];
      });
    },
    material: (name) => model.material(name),
    dispose() {
      model.dispose();
      scene.environment?.dispose();
      renderer.dispose();
    },
  };
}
