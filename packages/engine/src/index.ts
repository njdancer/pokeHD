import * as THREE from "three/webgpu";
import { fog, rangeFogFactor, uniform } from "three/tsl";
import { sceneTime } from "./scene-time.ts";
import { createSky } from "./sky.ts";
import { createDayClock, stepDay, wrapNow } from "./look/clock.ts";
import { blendCycle, type DayCycle } from "./look/cycle.ts";
import { mergeLook, STRUCTURAL, type LookParams } from "./look/params.ts";
import { DEFAULT_CYCLE, DEFAULT_LOOK } from "./look/presets.ts";
import { createPlaceholder } from "./look/placeholder.ts";
import { NEUTRAL_TINT, normTint } from "./look/grade.ts";
import { createPost } from "./look/post.ts";
import { defaultQuality, QUALITY_PATCHES, type Quality } from "./look/quality.ts";
import { createGovernor, RUNGS } from "./look/governor.ts";
import { createRig } from "./look/rig.ts";
import { webgpuViewsWork } from "./webgpu-probe.ts";

export type { DayCycle } from "./look/cycle.ts";
export type { LookParams } from "./look/params.ts";
export { QUALITY_PATCHES, type Quality } from "./look/quality.ts";
export { BUILT_IN_PRESETS, DEFAULT_CYCLE, DEFAULT_LOOK } from "./look/presets.ts";

export interface LookController {
  /** The live parameters. Edit in place, then call `changed(path)`. */
  readonly params: LookParams;
  /** Replaces every parameter (loading a preset). Unknown or missing fields fall back. */
  set(next: unknown): void;
  /** Call after editing `params` in place; `path` is e.g. "bloom.strength". */
  changed(path?: string): void;
  /**
   * Blends three looks across the day (morning, midday, evening), overwriting `params`
   * every frame except time, camera and render. Null returns to editing `params` directly.
   */
  setCycle(cycle: DayCycle | null): void;
  readonly cycle: DayCycle | null;
  /**
   * Jumps the clock to morning. Pass `instant` when the screen is already black (an in-game
   * warp fade); otherwise the engine fades out and back in around the jump.
   */
  wrapToMorning(instant?: boolean): void;
}

/** What the engine renders and frames: the placeholder by default, or a world from `./world`. */
export interface WorldContent {
  root: THREE.Object3D;
  /** Point the camera and the DoF focus follow. */
  target: THREE.Vector3;
  update(seconds: number, camera: THREE.Camera, sunDirection: THREE.Vector3, spriteShadows: boolean): void;
  /**
   * The colour of the place on screen ("#rrggbb"), which the grade leans toward by
   * `grade.placeTint`; null or absent is neutral. The engine eases between places.
   */
  readonly placeTint?: string | null;
  /**
   * Called with the renderer's shader precompiler once this content is rendered (null when it no
   * longer is). Content that adds objects while running can compile them first, off the frame.
   */
  setCompiler?(compile: ((object: THREE.Object3D) => Promise<void>) | null): void;
  /** A framing that overrides the look's camera while set (a battle). */
  readonly view?: CameraView | null;
}

/** Camera framing: degrees, world units. */
export interface CameraView {
  pitch: number;
  yaw: number;
  distance: number;
  fov: number;
}

export interface EngineStats {
  /** CPU time spent building and submitting the last frame, ms. */
  cpuMs: number;
  /** Of that, the world's own update (live chunk builds happen here), ms. */
  updateMs: number;
  /** Of that, rendering and post-processing (pipeline compiles and uploads land here), ms. */
  renderMs: number;
  /** Dynamic resolution: the render scale (1 is full), and whether depth of field is on. */
  scale: number;
  dof: boolean;
  width: number;
  height: number;
}

export interface BenchResult {
  /** Wall time per frame until the GPU finished: the frame's real cost when GPU-bound, ms. */
  frameMs: number;
  /** CPU time per frame to build and submit it, ms. */
  cpuMs: number;
  /** Render passes (scene, shadow and post-processing passes) in one frame. */
  passes: number;
  drawCalls: number;
  triangles: number;
}

export interface Engine {
  backend: "WebGPU" | "WebGL2";
  look: LookController;
  /** The quality tier laid over every look; see `QUALITY_PATCHES`. */
  readonly quality: Quality;
  setQuality(quality: Quality): void;
  stats: EngineStats;
  /** Pins the drawing buffer to an exact size (e.g. 2560×1440 for perf checks); null follows the canvas. */
  setFixedSize(size: { width: number; height: number } | null): void;
  /** Swaps what's rendered. The caller owns (and disposes) the old content. */
  setWorld(world: WorldContent): void;
  /** Renders one frame and returns it as a PNG. */
  capture(): Promise<Blob>;
  /**
   * Renders `frames` frames back to back, then waits for the GPU to finish them, so the cost
   * isn't hidden by vsync (the /dev/bench page). Time stands still while it runs.
   */
  benchmark(frames: number): Promise<BenchResult>;
  dispose(): void;
}

export interface EngineOptions {
  /** Mounts the look-dev panel. Defaults to `?lookdev` being in the page URL. */
  lookdev?: boolean;
  /** Forces the WebGL2 backend. Defaults to `?webgl` being in the page URL. */
  forceWebGL?: boolean;
  /** Content to render instead of the look-dev placeholder. */
  world?: WorldContent;
  /** Defaults to `?quality=`, else mobile on touch-only devices. */
  quality?: Quality;
  /**
   * Lowers the render resolution (and, last, depth of field) while frames miss 60 fps, and raises
   * it again when they don't. Defaults to on unless the page URL has `?dynres=0`.
   */
  dynamicResolution?: boolean;
}

// The newest engine created on a canvas owns it. React StrictMode mounts, unmounts and
// remounts, so a throwaway engine can still be initialising when its successor starts on the
// same canvas. A superseded engine never renders and leaves the shared GPU context alone:
// disposing a WebGL2 renderer calls loseContext(), which would kill its successor too.
const canvasOwner = new WeakMap<HTMLCanvasElement, symbol>();
/** Time constant for easing the grade between places, seconds. */
const PLACE_TINT_SECONDS = 0.6;

/** Owns the canvas and the frame loop. Framework-agnostic: React only mounts it. */
export async function createEngine(canvas: HTMLCanvasElement, options: EngineOptions = {}): Promise<Engine> {
  const token = Symbol("engine");
  canvasOwner.set(canvas, token);
  const superseded = () => canvasOwner.get(canvas) !== token;
  const query = new URLSearchParams(location.search);
  const lookdev = options.lookdev ?? query.has("lookdev");
  const forceWebGL = options.forceWebGL ?? (query.has("webgl") || !(await webgpuViewsWork()));
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL });
  await renderer.init();
  // three.js puts a small InstancedMesh's matrices in a uniform array sized by its instance count
  // and named after the buffer, so every one gets its own shader: dozens per map chunk, each
  // compiled on first draw (seconds of stalls in WebGL2). With no uniform-buffer room they all use
  // instanced attributes and share their shaders.
  const capabilities = (renderer.backend as unknown as { capabilities: { getUniformBufferLimit(): number } }).capabilities;
  capabilities.getUniformBufferLimit = () => 0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // PCF honours shadow.radius for softness

  const params = structuredClone(DEFAULT_LOOK);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.camera.fov, 1, 0.5, 1200);
  const sky = createSky(scene);
  const rig = createRig(scene, sky);
  let world: WorldContent = options.world ?? createPlaceholder();
  scene.add(world.root);
  const post = createPost(renderer, scene, camera);
  const compile = (object: THREE.Object3D) => post.compile(object);
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  const warmup = nonBlockingShaders(renderer, scene, canvas, !isWebGPU);

  const fogNear = uniform(30);
  const fogFar = uniform(100);
  const fogColor = uniform(rig.fogColor);

  let fixedSize: { width: number; height: number } | null = null;
  const stats: EngineStats = { cpuMs: 0, updateMs: 0, renderMs: 0, scale: 1, dof: true, width: 0, height: 0 };
  const governor = (options.dynamicResolution ?? query.get("dynres") !== "0") ? createGovernor() : null;
  let rung = RUNGS[0]!;
  const resize = () => {
    if (fixedSize) {
      renderer.setPixelRatio(1);
      renderer.setSize(fixedSize.width, fixedSize.height, false);
    } else {
      renderer.setPixelRatio(Math.min(devicePixelRatio, params.render.maxPixelRatio) * rung.scale);
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
  world.setCompiler?.(compile);

  const clock = createDayClock(params.time);
  let quality = options.quality ?? defaultQuality();
  /** The look as loaded, before the quality patch: what setQuality re-applies to. */
  let source: { cycle: DayCycle } | { look: unknown } = { cycle: DEFAULT_CYCLE };
  const tiered = (look: unknown) => {
    const out = mergeLook(mergeLook(DEFAULT_LOOK, look), QUALITY_PATCHES[quality]);
    if (!rung.dof) out.dof.enabled = false;
    return out;
  };
  /** Lays the quality tier and the governor's rung over the loaded look again. */
  const reapply = () => {
    Object.assign(params.render, tiered({ render: DEFAULT_LOOK.render }).render);
    if ("cycle" in source) look.setCycle(source.cycle);
    else look.set({ ...(source.look as object), time: params.time, camera: params.camera });
  };
  let cycle: DayCycle | null = null;
  const look: LookController = {
    params,
    get cycle() {
      return cycle;
    },
    wrapToMorning(instant = false) {
      wrapNow(params.time, clock, instant);
    },
    setCycle(next) {
      source = next ? { cycle: next } : { look: structuredClone(params) };
      cycle = next && { morning: tiered(next.morning), midday: tiered(next.midday), evening: tiered(next.evening) };
      if (cycle) blendCycle(cycle, params.time.phase, params);
      rebuild();
    },
    set(next) {
      source = { look: next };
      // Copy into the existing group objects: the panel holds references to them.
      const merged = tiered(next);
      cycle = null;
      for (const group of Object.keys(merged) as (keyof LookParams)[]) Object.assign(params[group], merged[group]);
      rebuild();
    },
    changed(path) {
      if (path === "render.maxPixelRatio") resize();
      if (path === undefined || STRUCTURAL.has(path)) {
        clearTimeout(rebuildTimer);
        rebuildTimer = setTimeout(rebuild, 120);
      }
    },
  };

  Object.assign(params.render, tiered({ render: DEFAULT_LOOK.render }).render);
  look.setCycle(DEFAULT_CYCLE);

  const placeTint: [number, number, number] = [...NEUTRAL_TINT];
  const timer = new THREE.Timer();
  let elapsed = 0;
  const frameHooks: { before?: () => void; after?: () => void } = {};

  /** Renders a frame, unless the canvas isn't laid out yet; says whether it did. */
  const renderFrame = (dt: number): boolean => {
    if (stats.width === 0 || stats.height === 0) return false; // not laid out yet
    const t0 = performance.now();
    if (params.time.animate) elapsed += dt;
    sceneTime.value = elapsed;
    const p = params;

    stepDay(p.time, clock, dt);
    if (cycle) blendCycle(cycle, p.time.phase, p);
    if (p.camera.orbit) p.camera.yaw = ((p.camera.yaw + dt * 8 + 180) % 360) - 180;

    world.update(elapsed, camera, rig.sunDirection, p.shadows.spriteShadows);
    stats.updateMs = performance.now() - t0;
    const framing = world.view ?? p.camera;
    const pitch = framing.pitch * (Math.PI / 180);
    const yaw = framing.yaw * (Math.PI / 180);
    camera.position
      .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(framing.distance)
      .add(world.target);
    camera.lookAt(world.target);
    if (camera.fov !== framing.fov) {
      camera.fov = framing.fov;
      camera.updateProjectionMatrix();
    }

    rig.update(p, p.time.phase, world.target);
    sky.follow(camera);
    fogNear.value = p.fog.near;
    fogFar.value = p.fog.far;
    // Ease toward the place's tint, so walking into a town shifts the grade over a second or so.
    const want = world.placeTint ? normTint(world.placeTint) : NEUTRAL_TINT;
    const k = 1 - Math.exp(-dt / PLACE_TINT_SECONDS);
    for (let i = 0; i < 3; i++) placeTint[i]! += (want[i]! - placeTint[i]!) * k;
    post.update(p, camera.position.distanceTo(world.target), clock.fade, placeTint);
    const tRender = performance.now();
    post.render();
    stats.renderMs = performance.now() - tRender;
    stats.cpuMs = performance.now() - t0;
    return true;

  };

  renderer.setAnimationLoop((t) => {
    if (superseded()) return renderer.setAnimationLoop(null);
    timer.update(t);
    const delta = timer.getDelta();
    // The raw interval, vsync and all, is what the governor judges.
    const changed = governor && !fixedSize ? governor.sample(delta * 1000, t / 1000) : null;
    if (changed !== null) {
      const next = RUNGS[changed]!;
      const dofChanged = next.dof !== rung.dof;
      rung = next;
      stats.scale = rung.scale;
      stats.dof = rung.dof;
      if (dofChanged) reapply();
      else resize();
    }
    frameHooks.before?.();
    // The first delta can be negative (rAF time vs. the timer's clock); clamp long stalls too.
    warmup.beforeFrame();
    const rendered = renderFrame(Math.min(Math.max(delta, 0), 0.1));
    warmup.afterFrame(rendered);
    frameHooks.after?.();
  });

  /** Resolves once the GPU has finished everything submitted so far. */
  const gpuIdle = async () => {
    const backend = renderer.backend as unknown as { device?: { queue: { onSubmittedWorkDone(): Promise<void> } }; gl?: WebGL2RenderingContext };
    if (isWebGPU) return backend.device!.queue.onSubmittedWorkDone();
    // WebGL2: a fence, polled between tasks (browsers only update sync status then).
    const gl = backend.gl!;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 0));
    gl.deleteSync(sync);
  };
  let disposePanel: (() => void) | undefined;

  const engine: Engine = {
    backend: isWebGPU ? "WebGPU" : "WebGL2",
    look,
    stats,
    get quality() {
      return quality;
    },
    setQuality(next) {
      quality = next;
      reapply();
    },
    setWorld(next) {
      scene.remove(world.root);
      world.setCompiler?.(null);
      world = next;
      scene.add(world.root);
      world.setCompiler?.(compile);
    },
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
    async benchmark(frames) {
      await gpuIdle();
      const t0 = performance.now();
      // Passes render once per node frame, which only the animation loop advances; step it here
      // too, or every frame after the first would skip the scene and post-processing.
      const nodeFrame = (renderer as unknown as { _nodes: { nodeFrame: { update(): void; frameId: number } } })._nodes.nodeFrame;
      for (let i = 0; i < frames; i++) {
        nodeFrame.update();
        (renderer.info as { frame: number }).frame = nodeFrame.frameId;
        if (i === frames - 1) renderer.info.reset();
        renderFrame(0);
      }
      const cpuMs = (performance.now() - t0) / frames;
      await gpuIdle();
      const frameMs = (performance.now() - t0) / frames;
      const { frameCalls, drawCalls, triangles } = renderer.info.render;
      return { frameMs, cpuMs, passes: frameCalls, drawCalls, triangles };
    },
    dispose() {
      world.setCompiler?.(null);
      renderer.setAnimationLoop(null);
      clearTimeout(rebuildTimer);
      disposePanel?.();
      observer.disconnect();
      if (superseded()) return;
      canvasOwner.delete(canvas);
      post.dispose();
      renderer.dispose();
    },
  };

  if (lookdev && !superseded()) {
    const { mountLookdevPanel } = await import("./lookdev/panel.ts");
    disposePanel = mountLookdevPanel(engine, frameHooks);
  }
  return engine;
}

type Pipelines = { getForRender(renderObject: unknown, promises?: Promise<void>[] | null): unknown; updateForRender(renderObject: unknown): void };

/**
 * Shaders compile the first time something draws with them. WebGL2 links each program on the
 * main thread, so the first frame (dozens of programs for the scene, shadows and post-processing)
 * froze the page for seconds; WebGPU stalls the GPU instead, and only for what wasn't
 * precompiled (a new map chunk's shadow pass, say). This asks for pipelines the way
 * `compileAsync` does: a draw whose pipeline isn't ready is skipped instead of waited for, so an
 * object in `scene` can turn up a frame or two late. (WebGL2 needs KHR_parallel_shader_compile
 * for that; without it a link still blocks.) Post-processing passes are the exception, since one
 * that skipped its draw would flash: with `hideUntilReady` (WebGL2's first frame) the canvas
 * stays hidden until every pass has drawn, and otherwise a pass waits for its pipeline as before.
 */
function nonBlockingShaders(renderer: THREE.WebGPURenderer, scene: THREE.Scene, canvas: HTMLCanvasElement, hideUntilReady: boolean) {
  const pipelines = (renderer as unknown as { _pipelines: Pipelines })._pipelines;
  let warm = !hideUntilReady;
  /** Post-processing programs still linking, and ones this frame started. */
  let linking = 0;
  let started = 0;
  pipelines.updateForRender = (renderObject) => {
    const inScene = (renderObject as { scene: unknown }).scene === scene;
    if (warm && !inScene) return void pipelines.getForRender(renderObject);
    const promises: Promise<void>[] = [];
    pipelines.getForRender(renderObject, promises);
    if (inScene) return;
    for (const p of promises) {
      linking++;
      started++;
      void p.then(() => linking--);
    }
  };
  if (!warm) canvas.style.visibility = "hidden";
  let complete = false;
  return {
    beforeFrame() {
      complete = linking === 0;
      started = 0;
    },
    afterFrame(rendered: boolean) {
      if (warm || !rendered || !complete || started > 0) return;
      warm = true;
      canvas.style.visibility = "";
    },
  };
}
