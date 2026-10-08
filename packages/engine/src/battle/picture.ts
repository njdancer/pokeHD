import * as THREE from "three/webgpu";
import type { Ramp } from "../world/palette.ts";

// The Game Boy's battle pictures and move sprites as textures. Pictures arrive as colour numbers
// (before rBGP), so the game's palette effects (fades, flashes, inversions) carry over; their
// background is colour 0 reachable from the edge, which becomes transparent.

/** Where no picture tile is drawn (`NOT_DRAWN` in packages/emu). */
const NOT_DRAWN = 0xff;

/** The shade (0 lightest … 3 darkest) a palette register gives colour `c`. */
export const shade = (register: number, c: number) => (register >> (c * 2)) & 3;

/**
 * Marks the picture's background: colour 0 (and undrawn pixels) connected to the edge. Inside
 * the outline, colour 0 is white the Pokémon is drawn with (eyes, highlights) and stays.
 */
export function backgroundMask(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const stack: number[] = [];
  const open = (i: number) => !mask[i] && (pixels[i] === 0 || pixels[i] === NOT_DRAWN);
  for (let x = 0; x < width; x++) stack.push(x, (height - 1) * width + x);
  for (let y = 0; y < height; y++) stack.push(y * width, y * width + width - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (!open(i)) continue;
    mask[i] = 1;
    const x = i % width;
    if (x > 0) stack.push(i - 1);
    if (x < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < (height - 1) * width) stack.push(i + width);
  }
  return mask;
}

/** A crisp RGBA texture, rows bottom-up as three.js expects. */
export function pixelTexture(width: number, height: number): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(width * height * 4), width, height);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Paints colour numbers into `tex` through a palette register and a ramp. `transparent` marks
 * pixels to leave clear (a background mask, or colour 0 for sprites).
 */
export function paint(
  tex: THREE.DataTexture,
  pixels: Uint8Array,
  register: number,
  ramp: Ramp,
  transparent: (i: number) => boolean,
): void {
  const { width, height } = tex.image as { width: number; height: number };
  const data = tex.image.data as Uint8Array;
  data.fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const c = pixels[i]!;
      if (c === NOT_DRAWN || transparent(i)) continue;
      const hex = ramp[shade(register, c)]!;
      data.set([hex >> 16, (hex >> 8) & 255, hex & 255, 255], ((height - 1 - y) * width + x) * 4);
    }
  }
  tex.needsUpdate = true;
}
