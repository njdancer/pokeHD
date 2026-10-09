import * as THREE from "three/webgpu";

// The sun's shadow map in two layers (D35). The town's own shadows (buildings, trees, terrain:
// hundreds of thousands of triangles and half the frame's draw calls) only change when the sun
// steps, the shadow frustum moves or the scene changes, so they're drawn into a cached depth
// map then and copied into the live map every frame. Only the casters that move every frame
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
  setupRenderTarget(shadow: THREE.LightShadow, builder: unknown): { shadowMap: THREE.RenderTarget; depthTexture: THREE.DepthTexture };
}
type RenderObject = Parameters<THREE.WebGPURenderer["setRenderObjectFunction"]>[0] & {};

export interface CachedShadow {
  /** Redraws the cached static shadows on the next frame. */
  invalidate(): void;
  dispose(): void;
}

/** Installs the two-layer shadow map on `light`. */
export function installCachedShadow(light: THREE.DirectionalLight): CachedShadow {
  let stale = true;
  /** WebGL can only copy into a depth texture it has already rendered to. */
  let primed = false;
  /** Set if the cache ever throws; every shadow is then drawn every frame, as three.js does. */
  let failed = false;
  const cache = new THREE.RenderTarget(1, 1);
  cache.depthTexture = new THREE.DepthTexture(1, 1, THREE.FloatType);

  const Base = THREE.ShadowNode as unknown as new (light: THREE.Light, shadow: THREE.LightShadow) => ShadowNodeInternals;
  class CachedShadowNode extends Base {
    override setupRenderTarget(shadow: THREE.LightShadow, builder: unknown) {
      const out = super.setupRenderTarget(shadow, builder);
      // depth32float: WebGPU can't copy depth24plus, the default.
      out.depthTexture.type = THREE.FloatType;
      return out;
    }

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
      const shadowObjects = renderer.getRenderObjectFunction() as RenderObject;
      const only = (moving: boolean) =>
        renderer.setRenderObjectFunction(((object: THREE.Object3D, ...rest: unknown[]) => {
          if (castsMovingShadow(object) === moving) (shadowObjects as (...a: unknown[]) => void)(object, ...rest);
        }) as RenderObject);
      try {
        if (!primed) {
          renderer.setRenderTarget(shadowMap);
          renderer.clear();
          primed = true;
        }
        if (stale) {
          only(false);
          renderer.setRenderTarget(cache);
          renderer.render(scene, shadow.camera);
          stale = false;
        }
        renderer.copyTextureToTexture(cache.depthTexture!, shadowMap.depthTexture!);
        only(true);
        renderer.setRenderTarget(shadowMap);
        renderer.autoClear = false; // keep the copied static shadows (three restores this after)
        renderer.render(scene, shadow.camera);
      } catch (e) {
        // Draw every shadow every frame from now on, rather than lose the frame.
        console.warn("[pokeHD] cached shadows failed; drawing them every frame", e);
        failed = true;
      } finally {
        // Never leave the filter on: the main pass would draw only some objects.
        renderer.setRenderObjectFunction(shadowObjects);
      }
      if (failed) super.renderShadow(frame);
    }
  }

  const node = new CachedShadowNode(light, light.shadow);
  (light.shadow as unknown as { shadowNode: unknown }).shadowNode = node;
  return {
    invalidate() {
      stale = true;
    },
    dispose() {
      cache.dispose();
    },
  };
}
