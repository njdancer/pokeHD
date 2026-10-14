import * as THREE from "three/webgpu";
import { screenUV, texture } from "three/tsl";

// The sun's shadow map in two layers (D35). The town's own shadows (buildings, trees, terrain:
// hundreds of thousands of triangles and half the frame's draw calls) only change when the sun
// steps, the shadow frustum moves or the scene changes, so they're drawn into a cached depth
// map then and redrawn into the live map every frame by one full-screen triangle that writes the
// cached depths (a draw, not a texture copy: iPhone's WebGPU lost the whole world when the
// first version copied depth textures). Only the casters that move every frame
// (sprites: the player, NPCs, friends, battle pictures, marked with `markMovingShadow`) are
// drawn on top each frame. A caster that moves but isn't marked keeps a stale shadow until the
// next refresh, at most a third of a second away.

const MOVING = "movingShadow";

/** Marks an object whose shadow has to be redrawn every frame (it moves on its own). */
export function markMovingShadow(o: THREE.Object3D) {
  o.userData[MOVING] = true;
}

export const castsMovingShadow = (o: THREE.Object3D) => o.userData[MOVING] === true;

// The parts of three.js's ShadowNode this relies on; its type declarations leave them out.
interface ShadowNodeInternals {
  shadow: THREE.LightShadow;
  shadowMap: THREE.RenderTarget;
  light: THREE.Light;
  renderShadow(frame: { renderer: THREE.WebGPURenderer; scene: THREE.Scene }): void;
}
type RenderObject = Parameters<THREE.WebGPURenderer["setRenderObjectFunction"]>[0] & {};

export interface CachedShadow {
  /** Redraws the cached static shadows on the next frame. */
  invalidate(): void;
  /** True once the cache gave up and shadows are drawn every frame instead. */
  readonly failed: boolean;
  dispose(): void;
}

/** Installs the two-layer shadow map on `light`. */
export function installCachedShadow(light: THREE.DirectionalLight): CachedShadow {
  let stale = true;
  /** Set if the cache ever throws; every shadow is then drawn every frame, as three.js does. */
  let failed = false;
  const cache = new THREE.RenderTarget(1, 1);
  // The same depth format as three.js gives the live map (depth24plus on WebGPU). Both of the
  // first two versions made the maps 32-bit float, and both blanked the world on iPhone.
  cache.depthTexture = new THREE.DepthTexture(1, 1);
  // Writes the cached depths into whatever target is bound, ignoring what's there.
  const restore = new THREE.NodeMaterial();
  restore.depthNode = texture(cache.depthTexture, screenUV).r;
  restore.depthFunc = THREE.AlwaysDepth;
  restore.colorWrite = false;
  const quad = new THREE.QuadMesh(restore);

  const Base = THREE.ShadowNode as unknown as new (light: THREE.Light, shadow: THREE.LightShadow) => ShadowNodeInternals;
  class CachedShadowNode extends Base {
    override renderShadow(frame: { renderer: THREE.WebGPURenderer; scene: THREE.Scene }) {
      const { shadow, shadowMap, light } = this;
      const { renderer, scene } = frame;
      shadow.updateMatrices(light);
      const { width, height } = shadow.mapSize;
      shadowMap.setSize(width, height, shadowMap.depth);
      if (cache.width !== width || cache.height !== height) {
        cache.setSize(width, height);
        stale = true;
      }
      if (failed) return super.renderShadow(frame);
      watchGpuErrors(renderer);
      const shadowObjects = renderer.getRenderObjectFunction() as RenderObject;
      const only = (moving: boolean) =>
        renderer.setRenderObjectFunction(((object: THREE.Object3D, ...rest: unknown[]) => {
          if (castsMovingShadow(object) === moving) (shadowObjects as (...a: unknown[]) => void)(object, ...rest);
        }) as RenderObject);
      try {
        if (stale) {
          only(false);
          renderer.setRenderTarget(cache);
          renderer.render(scene, shadow.camera);
          stale = false;
        }
        renderer.setRenderObjectFunction(null);
        renderer.setRenderTarget(shadowMap);
        quad.render(renderer);
        only(true);
        renderer.autoClear = false; // keep the restored static shadows (three restores this after)
        renderer.render(scene, shadow.camera);
      } catch (e) {
        fail(e);
      } finally {
        // Never leave the filter on: the main pass would draw only some objects.
        renderer.setRenderObjectFunction(shadowObjects);
      }
      if (failed) super.renderShadow(frame);
    }
  }

  /**
   * WebGPU reports most failures later, as events, rather than throwing, so a cache that draws
   * nothing would never notice. Any uncaught GPU error while the cache is on turns it off: at
   * worst that loses the speed-up, never the frame.
   */
  let watching: object | undefined;
  function watchGpuErrors(renderer: THREE.WebGPURenderer) {
    // Per device: a lost device is replaced by a new one (QA bug #74).
    const device = (renderer.backend as { device?: EventTarget }).device;
    if (!device || watching === device) return;
    watching = device;
    device.addEventListener("uncapturederror", (e) => fail((e as Event & { error?: { message?: string } }).error?.message));
  }

  function fail(why: unknown) {
    if (failed) return;
    // Draw every shadow every frame from now on, rather than lose the frame.
    console.warn("[pokeHD] cached shadows failed; drawing them every frame", why);
    failed = true;
  }

  const node = new CachedShadowNode(light, light.shadow);
  (light.shadow as unknown as { shadowNode: unknown }).shadowNode = node;
  return {
    invalidate() {
      stale = true;
    },
    get failed() {
      return failed;
    },
    dispose() {
      cache.dispose();
      restore.dispose();
    },
  };
}
