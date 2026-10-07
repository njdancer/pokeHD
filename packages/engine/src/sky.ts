import * as THREE from "three/webgpu";
import { color, mix, normalize, positionWorld, smoothstep, uniform } from "three/tsl";

// Placeholder backdrop: a daytime sky dome drifting between morning and late afternoon.
// It proves the WebGPU/TSL pipeline end to end; the real world renderer replaces it.
export function createSky(scene: THREE.Scene) {
  const dayPhase = uniform(0); // 0 = morning, 1 = late afternoon
  const height = smoothstep(-0.1, 0.8, normalize(positionWorld).y);
  const zenith = mix(color(0x5d8fd6), color(0x4a76c4), dayPhase);
  const horizon = mix(color(0xf3d9b8), color(0xf5b97a), dayPhase);
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
  material.colorNode = mix(horizon, zenith, height);
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), material));
  return {
    update(seconds: number) {
      // Morning → afternoon → morning roughly every four minutes.
      dayPhase.value = 0.5 - 0.5 * Math.cos((seconds / 240) * Math.PI * 2);
    },
  };
}
