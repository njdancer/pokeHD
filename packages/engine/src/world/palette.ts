import { LABELS, type Label } from "@pokehd/rom";
import { NO_LABEL, type Region } from "./region.ts";

// Placeholder colour: one four-shade ramp per label, lightest first (DMG shade 0 → 3). The real
// colour comes from the ROM's SGB palettes (p1-colour, D11); until then this keeps the styles
// comparable. Ramps are hue-shifted rather than plain tints so shading reads warm and cool.
export type Ramp = readonly [number, number, number, number];

export const LABEL_RAMPS: Record<Label, Ramp> = {
  ground: [0xf4e6bd, 0xdcc28c, 0xa98d5c, 0x4b3b2a],
  lawn: [0xc4e48e, 0x8dc762, 0x4f8d40, 0x1e3a26],
  "tall-grass": [0xb2dc78, 0x6cb04a, 0x387838, 0x15301f],
  flower: [0xfff6ee, 0xf28ba0, 0xbf4a62, 0x3a1e2a],
  tree: [0xc0e494, 0x5fa64c, 0x2d6a3a, 0x0f261c],
  cliff: [0xece0c4, 0xbba383, 0x7b6552, 0x30271f],
  ledge: [0xd8e8a8, 0x9cbf6c, 0x5f7f44, 0x2a3424],
  stairs: [0xece0c4, 0xbba383, 0x7b6552, 0x30271f],
  water: [0xc8ecff, 0x6cb6ea, 0x2f74b8, 0x12305a],
  shore: [0xf4e6bd, 0xcdb487, 0x8f7552, 0x3a2c22],
  bridge: [0xf0d8ae, 0xb8875a, 0x7a5236, 0x2a1a10],
  roof: [0xffd9c8, 0xe2664f, 0x9c3934, 0x2c1418],
  wall: [0xfbf6ea, 0xdacfb8, 0x9b8d78, 0x2c2620],
  window: [0xe4f6ff, 0x8cbcdc, 0x4b6b8c, 0x1a2430],
  door: [0xf2d9b2, 0xab7a4c, 0x6b4529, 0x23170e],
  lettering: [0xfbf6ea, 0xd2c6ae, 0x8a7a64, 0x2c2620],
  fence: [0xffffff, 0xd2cac2, 0x8b8079, 0x2a2420],
  sign: [0xf2d9b2, 0xab7a4c, 0x6b4529, 0x23170e],
  cave: [0xbba383, 0x7b6552, 0x4a3a30, 0x1c1612],
  unused: [0xff00ff, 0xcc00cc, 0x990099, 0x330033],
};
/** The DMG's own greens, for maps nothing has labelled yet (interiors, for now). */
export const DMG_RAMP: Ramp = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];
const UNLABELLED: Ramp = [0xff00ff, 0xcc00cc, 0x990099, 0x330033];

export function rampFor(labelIndex: number): Ramp {
  return labelIndex === NO_LABEL ? UNLABELLED : LABEL_RAMPS[LABELS[labelIndex]!];
}

/** RGBA, `widthTiles * 8` × `heightTiles * 8`, rows top-down. */
export interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}

/**
 * The whole region coloured by label. With `fillTile`, tiles whose label is in `replace` are drawn
 * as the fill tile instead, so the ground under trees and props isn't a flat picture of them.
 */
export function colourRegion(
  region: Region,
  opts: { replace?: ReadonlySet<Label>; fillTile?: number; fillLabel?: Label; ramp?: Ramp } = {},
): Image {
  const width = region.widthTiles * 8;
  const height = region.heightTiles * 8;
  const data = new Uint8Array(width * height * 4);
  const replace = new Set([...(opts.replace ?? [])].map((l) => LABELS.indexOf(l)));
  const fillRamp = LABEL_RAMPS[opts.fillLabel ?? "lawn"];
  for (let ty = 0; ty < region.heightTiles; ty++) {
    for (let tx = 0; tx < region.widthTiles; tx++) {
      const label = region.labels[ty * region.widthTiles + tx]!;
      const swap = replace.has(label) && opts.fillTile !== undefined;
      const ramp = opts.ramp ?? (swap ? fillRamp : rampFor(label));
      for (let p = 0; p < 64; p++) {
        const x = tx * 8 + (p & 7);
        const y = ty * 8 + (p >> 3);
        const shade = swap ? region.tileset.tiles[opts.fillTile! * 64 + p]! : region.shades[y * width + x]!;
        const hex = ramp[shade]!;
        const i = (y * width + x) * 4;
        data[i] = hex >> 16;
        data[i + 1] = (hex >> 8) & 255;
        data[i + 2] = hex & 255;
        data[i + 3] = 255;
      }
    }
  }
  return { width, height, data };
}

/** The most common tile with this label in the region (the pattern to fill under props with). */
export function commonTile(region: Region, label: Label): number | undefined {
  const index = LABELS.indexOf(label);
  const counts = new Map<number, number>();
  region.labels.forEach((l, i) => {
    if (l === index) counts.set(region.tiles[i]!, (counts.get(region.tiles[i]!) ?? 0) + 1);
  });
  let best: number | undefined;
  for (const [tile, n] of counts) if (best === undefined || n > counts.get(best)!) best = tile;
  return best;
}
