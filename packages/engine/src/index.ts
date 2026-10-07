import * as THREE from "three/webgpu";
import { createSky } from "./sky.ts";

export interface Engine {
  backend: "WebGPU" | "WebGL2";
  dispose(): void;
}

/** Owns the canvas and the frame loop. Framework-agnostic: React only mounts it. */
export async function createEngine(canvas: HTMLCanvasElement): Promise<Engine> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  camera.position.set(0, 2, 0);
  const sky = createSky(scene);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((t) => {
    timer.update(t);
    const s = timer.getElapsed();
    camera.lookAt(Math.cos(s * 0.02) * 10, 2.5, Math.sin(s * 0.02) * 10);
    sky.update(s);
    renderer.render(scene, camera);
  });

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  return {
    backend: isWebGPU ? "WebGPU" : "WebGL2",
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      renderer.dispose();
    },
  };
}
