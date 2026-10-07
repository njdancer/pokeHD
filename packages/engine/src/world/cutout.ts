import type { Image } from "./palette.ts";
import type { Region } from "./region.ts";
import type { StepProp } from "./analyse.ts";

/**
 * Clears the background around each prop: shade-0 pixels connected to the step's edge become
 * transparent. Flooding from the edge (rather than clearing every shade-0 pixel) keeps light
 * pixels inside an outline, like the highlights in a tree's canopy.
 */
export function cutOut(image: Image, region: Region, props: StepProp[]): Image {
  const data = image.data.slice();
  const width = image.width;
  for (const { sx, sy } of props) {
    const ox = sx * 16;
    const oy = sy * 16;
    const clear = new Uint8Array(256);
    const stack: number[] = [];
    for (let i = 0; i < 16; i++) stack.push(i, 240 + i, i * 16, i * 16 + 15);
    while (stack.length) {
      const p = stack.pop()!;
      if (clear[p]) continue;
      const x = p & 15;
      const y = p >> 4;
      if (region.shades[(oy + y) * width + ox + x] !== 0) continue;
      clear[p] = 1;
      if (x > 0) stack.push(p - 1);
      if (x < 15) stack.push(p + 1);
      if (y > 0) stack.push(p - 16);
      if (y < 15) stack.push(p + 16);
    }
    clear.forEach((c, p) => {
      if (c) data[((oy + (p >> 4)) * width + ox + (p & 15)) * 4 + 3] = 0;
    });
  }
  return { width, height: image.height, data };
}
