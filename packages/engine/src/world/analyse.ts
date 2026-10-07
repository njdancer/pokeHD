import type { Label } from "@pokehd/rom";
import { labelAt, type Region } from "./region.ts";

// Finds the things styles turn into geometry: buildings, trees and small props. Everything is
// in region tiles (8 px); a step is 2×2 tiles.

export const BUILDING_LABELS: ReadonlySet<Label> = new Set(["roof", "wall", "window", "door", "lettering"]);
const FACADE_LABELS: ReadonlySet<Label> = new Set(["wall", "window", "door", "lettering"]);
export const PROP_LABELS: ReadonlySet<Label> = new Set(["fence", "sign"]);

export interface Building {
  /** Bounding box in tiles, inclusive-exclusive. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /**
   * Rows at the bottom of the box drawn as the front wall; the rows above are roof. The Game
   * Boy draws buildings as a roof seen from above with the front wall below it, so the box is
   * both the footprint and, read bottom-up, the elevation.
   */
  facadeRows: number;
}

/** 4-connected groups of building tiles, as bounding boxes. */
export function findBuildings(region: Region): Building[] {
  const { widthTiles: w, heightTiles: h } = region;
  const seen = new Uint8Array(w * h);
  const out: Building[] = [];
  const isBuilding = (x: number, y: number) => BUILDING_LABELS.has(labelAt(region, x, y)!);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !isBuilding(x, y)) continue;
      let x0 = x, y0 = y, x1 = x + 1, y1 = y + 1;
      const stack = [[x, y] as const];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        x0 = Math.min(x0, cx); y0 = Math.min(y0, cy);
        x1 = Math.max(x1, cx + 1); y1 = Math.max(y1, cy + 1);
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || seen[ny * w + nx] || !isBuilding(nx, ny)) continue;
          seen[ny * w + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      // Facade: bottom rows where at least half the tiles are wall-like.
      let facadeRows = 0;
      for (let row = y1 - 1; row >= y0; row--) {
        let n = 0;
        for (let col = x0; col < x1; col++) if (FACADE_LABELS.has(labelAt(region, col, row)!)) n++;
        if (n * 2 < x1 - x0) break;
        facadeRows++;
      }
      out.push({ x0, y0, x1, y1, facadeRows: Math.max(1, Math.min(facadeRows, y1 - y0 - 1)) });
    }
  }
  return out;
}

export interface StepProp {
  /** Step coordinates (2×2 tiles). */
  sx: number;
  sy: number;
  label: Label;
}

/** Steps whose four tiles are all trees. */
export function findTrees(region: Region): StepProp[] {
  return stepsWhere(region, (labels) => (labels.every((l) => l === "tree") ? "tree" : undefined));
}

/** Steps that are mostly fence or sign. */
export function findProps(region: Region): StepProp[] {
  return stepsWhere(region, (labels) => {
    const props = labels.filter((l): l is Label => l !== undefined && PROP_LABELS.has(l));
    return props.length >= 2 ? (props.includes("sign") ? "sign" : "fence") : undefined;
  });
}

function stepsWhere(region: Region, pick: (labels: (Label | undefined)[]) => Label | undefined): StepProp[] {
  const out: StepProp[] = [];
  for (let sy = 0; sy < region.heightTiles / 2; sy++) {
    for (let sx = 0; sx < region.widthTiles / 2; sx++) {
      const labels = [0, 1, 2, 3].map((i) => labelAt(region, sx * 2 + (i & 1), sy * 2 + (i >> 1)));
      const label = pick(labels);
      if (label) out.push({ sx, sy, label });
    }
  }
  return out;
}

/** Tiles with any of these labels, as tile coordinates. */
export function tilesWith(region: Region, labels: ReadonlySet<Label>): { tx: number; ty: number; label: Label }[] {
  const out: { tx: number; ty: number; label: Label }[] = [];
  for (let ty = 0; ty < region.heightTiles; ty++) {
    for (let tx = 0; tx < region.widthTiles; tx++) {
      const label = labelAt(region, tx, ty);
      if (label && labels.has(label)) out.push({ tx, ty, label });
    }
  }
  return out;
}
