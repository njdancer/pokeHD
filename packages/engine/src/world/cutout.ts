import type { Image } from "./palette.ts";
import type { Region } from "./region.ts";
import type { StepProp } from "./analyse.ts";

/**
 * Clears the background around each prop: background pixels connected to the step's edge become
 * transparent. Flooding from the edge (rather than clearing every shade-0 pixel) keeps light
 * pixels inside an outline, like the highlights in a tree's canopy.
 *
 * Background is shade 0, plus lone shade-1 dots: the FOREST tileset draws its small trees on a
 * dithered floor, shade-1 dots in a checkerboard with shade 0. The shade-0 pixels there touch
 * only diagonally, so a shade-0-only flood stops at the step's edge and the whole dither stayed
 * opaque. As a voxel prop that is a full-width slab per pixel row, and a column of small trees
 * reads as tall grass you could walk into (QA bug #16). A dot counts as background only when all
 * its neighbours in the step are shade 0, so the flood can't slip through an outline's light
 * pixels into a canopy.
 */
export function cutOut(image: Image, region: Region, props: StepProp[]): Image {
  const data = image.data.slice();
  const width = image.width;
  for (const { sx, sy } of props) {
    const ox = sx * 16;
    const oy = sy * 16;
    const shade = (x: number, y: number) => region.shades[(oy + y) * width + ox + x]!;
    const dark = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && shade(x, y) !== 0;
    const background = (x: number, y: number) =>
      shade(x, y) === 0 || (shade(x, y) === 1 && !dark(x - 1, y) && !dark(x + 1, y) && !dark(x, y - 1) && !dark(x, y + 1));
    const clear = new Uint8Array(256);
    const stack: number[] = [];
    for (let i = 0; i < 16; i++) stack.push(i, 240 + i, i * 16, i * 16 + 15);
    while (stack.length) {
      const p = stack.pop()!;
      if (clear[p]) continue;
      const x = p & 15;
      const y = p >> 4;
      if (!background(x, y)) continue;
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
