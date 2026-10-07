// three.js's WebGPU backend passes `swizzle` on every texture view. Browsers whose WebGPU predates
// that member reject the descriptor with a TypeError on every frame (seen in Chromium 141), so
// the scene never draws. Probe for it on a throwaway device, so the engine can pick WebGL2 instead.

interface ProbeTexture {
  createView(descriptor: object): unknown;
  destroy(): void;
}
interface ProbeDevice {
  createTexture(descriptor: object): ProbeTexture;
  destroy(): void;
}
interface ProbeGpu {
  requestAdapter(): Promise<{ requestDevice(): Promise<ProbeDevice> } | null>;
}

/** TEXTURE_BINDING usage flag (GPUTextureUsage.TEXTURE_BINDING). */
const TEXTURE_BINDING = 0x04;

/**
 * False when WebGPU is there but can't take the texture views three.js makes. True otherwise,
 * including when there's no WebGPU at all (three.js falls back to WebGL2 by itself then).
 */
export async function webgpuViewsWork(): Promise<boolean> {
  const gpu = (navigator as { gpu?: ProbeGpu }).gpu;
  if (!gpu) return true;
  let device: ProbeDevice | undefined;
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return true;
    device = await adapter.requestDevice();
    const texture = device.createTexture({ size: [1, 1], format: "rgba8unorm", usage: TEXTURE_BINDING });
    texture.createView({ swizzle: "rgba" });
    texture.destroy();
    return true;
  } catch (e) {
    console.warn("[pokeHD] this browser's WebGPU can't run three.js's texture views; using WebGL2", e);
    return false;
  } finally {
    device?.destroy();
  }
}
