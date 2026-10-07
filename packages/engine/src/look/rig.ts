import * as THREE from "three/webgpu";
import type { createSky } from "../sky.ts";
import type { LookParams } from "./params.ts";

// The lighting rig: a shadow-casting directional sun plus a hemisphere sky light, both driven
// by the time of day. Phase 0 is morning (sun low in the east), 1 is late afternoon (low in
// the west); it never reaches night (D9).

const DEG = Math.PI / 180;

/** World-space unit vector pointing at the sun. North is −Z, east is +X. */
export function sunDirection(sun: LookParams["sun"], phase: number, out = new THREE.Vector3()) {
  const azimuth = (sun.heading - sun.swing * (1 - 2 * phase)) * DEG;
  const elevation = (sun.lowElevation + (sun.highElevation - sun.lowElevation) * Math.sin(Math.PI * phase)) * DEG;
  return out.set(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), -Math.cos(azimuth) * Math.cos(elevation));
}

/** Morning → midday → afternoon colour for a phase. */
function threeWay(a: THREE.Color, b: THREE.Color, c: THREE.Color, phase: number, out: THREE.Color) {
  return phase < 0.5 ? out.lerpColors(a, b, phase * 2) : out.lerpColors(b, c, (phase - 0.5) * 2);
}

export function createRig(scene: THREE.Scene, sky: ReturnType<typeof createSky>) {
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
  scene.add(hemi);

  const tmp = { a: new THREE.Color(), b: new THREE.Color(), c: new THREE.Color() };
  const dir = new THREE.Vector3();
  const fogColor = new THREE.Color();

  return {
    sun,
    hemi,
    fogColor,
    sunDirection: dir,
    /** Applies the look for this frame. `target` is what the shadow frustum stays centred on. */
    update(p: LookParams, phase: number, target: THREE.Vector3) {
      sunDirection(p.sun, phase, dir);

      sun.intensity = p.sun.intensity;
      threeWay(tmp.a.set(p.sun.morningColor), tmp.b.set(p.sun.middayColor), tmp.c.set(p.sun.afternoonColor), phase, sun.color);
      sun.target.position.copy(target);
      sun.position.copy(target).addScaledVector(dir, 80);

      const s = sun.shadow;
      const cam = s.camera;
      if (cam.right !== p.shadows.extent) {
        cam.left = cam.bottom = -p.shadows.extent;
        cam.right = cam.top = p.shadows.extent;
        cam.updateProjectionMatrix();
      }
      s.bias = p.shadows.bias;
      s.normalBias = p.shadows.normalBias;
      s.radius = p.shadows.softness;

      sky.zenith.lerpColors(tmp.a.set(p.sky.zenithMorning), tmp.b.set(p.sky.zenithAfternoon), phase);
      sky.horizon.lerpColors(tmp.a.set(p.sky.horizonMorning), tmp.b.set(p.sky.horizonAfternoon), phase);
      sky.sunColor.copy(sun.color);
      sky.sunDirection.copy(dir);
      sky.discSize.value = p.sky.sunDiscSize;
      sky.discIntensity.value = p.sky.sunDiscIntensity;

      hemi.intensity = p.sky.skyLight;
      hemi.color.copy(sky.zenith).lerp(sky.horizon, 0.35);
      hemi.groundColor.set(p.sky.groundColor);

      fogColor.set(p.fog.color).lerp(sky.horizon, p.fog.skyTint);
    },
    /** Shadow map size changes need the old map released. */
    setShadowMapSize(size: number) {
      if (sun.shadow.mapSize.x === size) return;
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    },
  };
}
