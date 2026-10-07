import * as THREE from "three/webgpu";
import { fog, rangeFogFactor, uniform } from "three/tsl";
import { createSky } from "./sky.ts";
import { mergeLook, STRUCTURAL, type LookParams } from "./look/params.ts";
import { DEFAULT_LOOK } from "./look/presets.ts";
import { createPlaceholder } from "./look/placeholder.ts";
import { createPost } from "./look/post.ts";
import { createRig } from "./look/rig.ts";

export type { LookParams } from "./look/params.ts";
export { BUILT_IN_PRESETS, DEFAULT_LOOK } from "./look/presets.ts";

export interface LookController {
  /** The live parameters. Edit in place, then call `changed(path)`. */
  readonly params: LookParams;
  /** Replaces every parameter (loading a preset). Unknown or missing fields fall back. */
  set(next: unknown): void;
  /** Call after editing `params` in place; `path` is e.g. "bloom.strength". */
  changed(path?: string): void;
}

export interface EngineStats {
  /** CPU time spent building and submitting the last frame, ms. */
  cpuMs: number;
  width: number;
  height: number;
}

export interface Engine {
  backend: "WebGPU" | "WebGL2";
  look: LookController;
  stats: EngineStats;
  /** Pins the drawing buffer to an exact size (e.g. 2560×1440 for perf checks); null follows the canvas. */
  setFixedSize(size: { width: number; height: number } | null): void;
  /** Renders one frame and returns it as a PNG. */
  capture(): Promise<Blob>;
  dispose(): void;
}

export interface EngineOptions {
  /** Mounts the look-dev panel. Defaults to `?lookdev` being in the page URL. */
  lookdev?: boolean;
}

/** Owns the canvas and the frame loop. Framework-agnostic: React only mounts it. */
export async function createEngine(canvas: HTMLCanvasElement, options: EngineOptions = {}): Promise<Engine> {
  const lookdev = options.lookdev ?? new URLSearchParams(location.search).has("lookdev");
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF honours shadow.radius for softness

  const params = structuredClone(DEFAULT_LOOK);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.camera.fov, 1, 0.5, 1200);
  const sky = createSky(scene);
  const rig = createRig(scene, sky);
  const world = createPlaceholder();
  scene.add(world.root);
  const post = createPost(renderer, scene, camera);

  const fogNear = uniform(30);
  const fogFar = uniform(100);
  const fogColor = uniform(rig.fogColor);

  let fixedSize: { width: number; height: number } | null = null;
  const stats: EngineStats = { cpuMs: 0, width: 0, height: 0 };
  const resize = () => {
    if (fixedSize) {
      renderer.setPixelRatio(1);
      renderer.setSize(fixedSize.width, fixedSize.height, false);
    } else {
      renderer.setPixelRatio(Math.min(devicePixelRatio, params.render.maxPixelRatio));
      renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    }
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    stats.width = size.x;
    stats.height = size.y;
    camera.aspect = size.x / size.y;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  // Structural changes rebuild materials or the post graph; batch a slider drag into one.
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  const rebuild = () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = undefined;
    rig.setShadowMapSize(params.shadows.mapSize);
    rig.sun.castShadow = params.shadows.enabled;
    scene.fogNode = params.fog.enabled ? fog(fogColor, rangeFogFactor(fogNear, fogFar)) : null;
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.material as THREE.Material).needsUpdate = true;
    });
    post.build(params);
    resize();
  };
  rebuild();

  // Time of day: an angle that advances while drifting, so drift resumes from the current phase.
  let dayAngle = Math.acos(1 - 2 * params.time.phase);
  const syncDayAngle = () => {
    const a = Math.acos(1 - 2 * params.time.phase);
    dayAngle = dayAngle > Math.PI ? Math.PI * 2 - a : a; // keep heading the same way
  };
  const look: LookController = {
    params,
    set(next) {
      // Copy into the existing group objects: the panel holds references to them.
      const merged = mergeLook(DEFAULT_LOOK, next);
      for (const group of Object.keys(merged) as (keyof LookParams)[]) Object.assign(params[group], merged[group]);
      syncDayAngle();
      rebuild();
    },
    changed(path) {
      if (path === "time.phase") syncDayAngle();
      if (path === "render.maxPixelRatio") resize();
      if (path === undefined || STRUCTURAL.has(path)) {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuild, 120);
      }
    },
  };

  const timer = new THREE.Timer();
  let elapsed = 0;
  const frameHooks: { before?: () => void; after?: () => void } = {};

  const renderFrame = (dt: number) => {
    if (stats.width === 0 || stats.height === 0) return; // not laid out yet
    const t0 = performance.now();
    if (params.time.animate) elapsed += dt;
    const p = params;

    if (p.time.drift) {
      dayAngle = (dayAngle + (dt / p.time.cycleSeconds) * Math.PI * 2) % (Math.PI * 2);
      p.time.phase = 0.5 - 0.5 * Math.cos(dayAngle);
    }
    if (p.camera.orbit) p.camera.yaw = ((p.camera.yaw + dt * 8 + 180) % 360) - 180;

    world.update(elapsed, camera, rig.sunDirection, p.shadows.spriteShadows);
    const pitch = p.camera.pitch * (Math.PI / 180);
    const yaw = p.camera.yaw * (Math.PI / 180);
    camera.position
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(p.camera.distance)
      .add(world.target);
    camera.lookAt(world.target);
    if (camera.fov !== p.camera.fov) {
      camera.fov = p.camera.fov;
      camera.updateProjectionMatrix();
    }

    rig.update(p, p.time.phase, world.target);
    sky.follow(camera);
    fogNear.value = p.fog.near;
    fogFar.value = p.fog.far;
    post.update(p, camera.position.distanceTo(world.target));
    post.render();
    stats.cpuMs = performance.now() - t0;

  };

  renderer.setAnimationLoop((t) => {
    timer.update(t);
    frameHooks.before?.();
    // The first delta can be negative (rAF time vs. the timer's clock); clamp long stalls too.
    renderFrame(Math.min(Math.max(timer.getDelta(), 0), 0.1));
    frameHooks.after?.();
  });

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  let disposePanel: (() => void) | undefined;

  const engine: Engine = {
    backend: isWebGPU ? "WebGPU" : "WebGL2",
    look,
    stats,
    setFixedSize(size) {
      fixedSize = size;
      resize();
    },
    capture() {
      // A WebGPU canvas can only be read in the same task that rendered it.
      renderFrame(0);
      return new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("capture failed"))), "image/png"),
      );
    },
    dispose() {
      renderer.setAnimationLoop(null);
      clearTimeout(rebuildTimer);
      disposePanel?.();
      observer.disconnect();
      post.dispose();
      renderer.dispose();
    },
  };

  if (lookdev) {
    const { mountLookdevPanel } = await import("./lookdev/panel.ts");
    disposePanel = mountLookdevPanel(engine, frameHooks);
  }
  return engine;
}
