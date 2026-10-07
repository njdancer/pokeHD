import * as THREE from "three/webgpu";
import { abs, float, length, mix, pass, renderOutput, screenUV, smoothstep, texture3D, uniform, vec4 } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { dof } from "three/addons/tsl/display/DepthOfFieldNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { lut3D } from "three/addons/tsl/display/Lut3DNode.js";
import { smaa } from "three/addons/tsl/display/SMAANode.js";
import { bakeLut, LUT_SIZE } from "./grade.ts";
import type { LookParams, ToneMappingName } from "./params.ts";

// Post-processing chain, in order:
//   scene → AO → depth of field → tilt-shift band → bloom → tone map → LUT grade
//   → vignette → wrap fade → FXAA/SMAA
// No MSAA: AO and depth of field need a single-sample depth buffer to read.
// Values that only change uniforms update every frame for free; toggling an effect or changing
// a resource size rebuilds the graph (see STRUCTURAL in params.ts), so disabled effects cost
// nothing.

const TONE_MAPPING: Record<ToneMappingName, THREE.ToneMapping> = {
  agx: THREE.AgXToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  neutral: THREE.NeutralToneMapping,
  reinhard: THREE.ReinhardToneMapping,
};

type Disposable = { dispose(): void };
type Vec4 = THREE.Node<"vec4">;
// The TSL typings don't model every effect node as a vec4; they all are at runtime.
const v4 = (node: unknown) => node as Vec4;

export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputColorTransform = false; // we tone map and encode ourselves, before the LUT

  const u = {
    aoIntensity: uniform(0),
    focus: uniform(10),
    focalLength: uniform(10),
    bokehScale: uniform(1),
    tiltCenter: uniform(0.5),
    tiltWidth: uniform(0.1),
    tiltFeather: uniform(0.3),
    lutIntensity: uniform(1),
    vignetteIntensity: uniform(0),
    vignetteRadius: uniform(0.8),
    vignetteSmoothness: uniform(0.5),
    fade: uniform(0),
  };

  const lutData = new Uint8Array(LUT_SIZE ** 3 * 4);
  const lut = new THREE.Data3DTexture(lutData, LUT_SIZE, LUT_SIZE, LUT_SIZE);
  lut.format = THREE.RGBAFormat;
  lut.type = THREE.UnsignedByteType;
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
  lut.unpackAlignment = 1;
  let lutKey = "";

  let owned: Disposable[] = [];
  let scenePass: ReturnType<typeof pass> | undefined;
  let aoNode: ReturnType<typeof ao> | undefined;
  let bloomNode: ReturnType<typeof bloom> | undefined;

  function build(p: LookParams) {
    for (const d of owned) d.dispose();
    owned = [];
    aoNode = bloomNode = undefined;

    scenePass = pass(scene, camera, { samples: 0 });
    owned.push(scenePass);
    let out: Vec4 = scenePass.getTextureNode("output");

    if (p.ao.enabled) {
      aoNode = ao(scenePass.getTextureNode("depth"), null as never, camera);
      aoNode.resolutionScale = p.ao.resolution;
      owned.push(aoNode);
      const occlusion = mix(float(1), aoNode.getTextureNode().r, u.aoIntensity);
      out = vec4(out.rgb.mul(occlusion), out.a);
    }
    if (p.dof.enabled) {
      const node = dof(out, scenePass.getViewZNode(), u.focus, u.focalLength, u.bokehScale);
      owned.push(node);
      out = v4(node);
    }
    if (p.tiltShift.enabled) {
      const blurred = gaussianBlur(out, null, p.tiltShift.blur, { resolutionScale: 0.5 });
      owned.push(blurred);
      // screenUV.y runs top-down; the panel's centre runs bottom-up.
      const fromBand = abs(float(1).sub(screenUV.y).sub(u.tiltCenter));
      const mask = smoothstep(u.tiltWidth, u.tiltWidth.add(u.tiltFeather), fromBand);
      out = mix(out, v4(blurred), mask);
    }
    if (p.bloom.enabled) {
      bloomNode = bloom(out);
      owned.push(bloomNode);
      out = vec4(out.rgb.add(bloomNode.rgb), out.a);
    }
    out = v4(renderOutput(out, TONE_MAPPING[p.grade.toneMapping], THREE.SRGBColorSpace));
    out = v4(lut3D(out, texture3D(lut), LUT_SIZE, u.lutIntensity));
    if (p.vignette.enabled) {
      const d = length(screenUV.sub(0.5)).mul(Math.SQRT2);
      const v = smoothstep(u.vignetteRadius.sub(u.vignetteSmoothness), u.vignetteRadius, d);
      out = vec4(out.rgb.mul(float(1).sub(v.mul(u.vignetteIntensity))), out.a);
    }
    out = vec4(out.rgb.mul(float(1).sub(u.fade)), out.a); // day-wrap fade to black
    if (p.render.antialias === "fxaa") out = v4(fxaa(out));
    if (p.render.antialias === "smaa") {
      const node = smaa(out);
      owned.push(node);
      out = v4(node);
    }

    pipeline.outputNode = out;
    pipeline.needsUpdate = true;
  }

  return {
    pipeline,
    build,
    /** Per-frame uniform updates. `focusDistance` is the camera-to-target distance; `fade` 1 is black. */
    update(p: LookParams, focusDistance: number, fade: number) {
      u.fade.value = fade;
      renderer.toneMappingExposure = p.grade.exposure;
      u.aoIntensity.value = p.ao.intensity;
      if (aoNode) {
        aoNode.radius.value = p.ao.radius;
        aoNode.thickness.value = p.ao.thickness;
        aoNode.distanceExponent.value = p.ao.distanceExponent;
      }
      u.focus.value = focusDistance + p.dof.focusOffset;
      u.focalLength.value = p.dof.focalLength;
      u.bokehScale.value = p.dof.bokehScale;
      u.tiltCenter.value = p.tiltShift.center;
      u.tiltWidth.value = p.tiltShift.width;
      u.tiltFeather.value = p.tiltShift.feather;
      if (bloomNode) {
        bloomNode.strength.value = p.bloom.strength;
        bloomNode.radius.value = p.bloom.radius;
        bloomNode.threshold.value = p.bloom.threshold;
      }
      u.lutIntensity.value = p.grade.lutIntensity;
      u.vignetteIntensity.value = p.vignette.intensity;
      u.vignetteRadius.value = p.vignette.radius;
      u.vignetteSmoothness.value = p.vignette.smoothness;

      const key = JSON.stringify(p.grade);
      if (key !== lutKey) {
        lutKey = key;
        bakeLut(p.grade, LUT_SIZE, lutData);
        lut.needsUpdate = true;
      }
    },
    render() {
      pipeline.render();
    },
    /**
     * Compiles `object`'s shaders for the scene pass, without drawing it, so adding it to the
     * scene later doesn't stall a frame (WebGL2 compiles shaders synchronously on first draw).
     * Mirrors PassNode.compileAsync, which compiles the whole scene: the pipelines must be
     * built against the pass's render target and MRT, or the first draw builds them again.
     */
    compile(object: THREE.Object3D): Promise<void> {
      if (!scenePass) return Promise.resolve();
      const target = renderer.getRenderTarget();
      const mrt = renderer.getMRT();
      renderer.setRenderTarget(scenePass.renderTarget);
      renderer.setMRT(scenePass.getMRT());
      // compileAsync captures the render context before its first await; restore at once.
      const done = renderer.compileAsync(object, camera, scene);
      renderer.setRenderTarget(target);
      renderer.setMRT(mrt);
      return done;
    },
    dispose() {
      for (const d of owned) d.dispose();
      lut.dispose();
      pipeline.dispose();
    },
  };
}
