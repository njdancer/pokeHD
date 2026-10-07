import * as THREE from "three/webgpu";
import { cameraPosition, dot, max, mix, normalize, positionWorld, pow, smoothstep, uniform } from "three/tsl";

// Stylised daytime sky: a horizon-to-zenith gradient plus a sun disc with a soft halo that
// feeds the bloom. The look-dev rig drives every uniform from the time of day.
export function createSky(scene: THREE.Scene) {
  const zenith = uniform(new THREE.Color(0x5d8fd6));
  const horizon = uniform(new THREE.Color(0xf3d9b8));
  const sunColor = uniform(new THREE.Color(0xffffff));
  const sunDirection = uniform(new THREE.Vector3(0, 1, 0));
  const discSize = uniform(1); // degrees, roughly
  const discIntensity = uniform(10);

  const dir = normalize(positionWorld.sub(cameraPosition));
  const height = smoothstep(-0.05, 0.7, dir.y);
  const cosAngle = dot(dir, sunDirection);
  const discCos = discSize.mul(Math.PI / 180).cos();
  const disc = smoothstep(discCos.sub(0.00004), discCos, cosAngle);
  const halo = pow(max(cosAngle, 0), 64).mul(0.25);

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  material.colorNode = mix(horizon, zenith, height).add(sunColor.mul(disc.mul(discIntensity).add(halo)));
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  scene.add(mesh);

  return {
    zenith: zenith.value,
    horizon: horizon.value,
    sunColor: sunColor.value,
    sunDirection: sunDirection.value,
    discSize,
    discIntensity,
    /** Keeps the dome centred on the camera so it never clips. */
    follow(camera: THREE.Camera) {
      mesh.position.copy(camera.position);
    },
  };
}
