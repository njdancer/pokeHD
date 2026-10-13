import { LABELS, type MapData } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { meshHeightfield } from "./heightfield.ts";
import { findExits } from "./interior.ts";
import type { Region } from "./region.ts";

const flat = { origin: [0, 0, 0], ax: [1, 0, 0], ay: [0, 0, 1], ah: [0, 1, 0], uv: () => [0, 0] as const } as const;

describe("floor slab edges", () => {
  it("puts the walls round the outline last, after the tops and inner steps", () => {
    // A floor row with a raised counter in the middle: 1 top run per height, 2 inner walls, and
    // the outline (front, back and both ends) dropping to the base.
    const m = meshHeightfield({ ...flat, width: 3, height: 1, heights: new Float32Array([0, 0.4, 0]), base: -1, splitEdges: true });
    expect(m.edgeStart).toBeDefined();
    expect(m.edgeStart! / 6).toBe(3 + 2);
    expect((m.indices.length - m.edgeStart!) / 6).toBe(3 + 3 + 2);
    // Every outline wall reaches down to the base.
    const lows = new Set<number>();
    for (let t = m.edgeStart!; t < m.indices.length; t += 6) {
      const ys = [0, 1, 2, 4].map((k) => m.positions[m.indices[t + k]! * 3 + 1]!);
      lows.add(Math.min(...ys));
    }
    expect([...lows]).toEqual([-1]);
  });

  it("leaves the index order alone without splitEdges", () => {
    const m = meshHeightfield({ ...flat, width: 3, height: 1, heights: new Float32Array([0, 0.4, 0]), base: -1 });
    expect(m.edgeStart).toBeUndefined();
  });
});

/**
 * Museum 1F as far as exits go: 10×4 blocks of floor but for the stairs up at step (7,7), with
 * the map's warps (vendor/pokered/data/maps/objects/Museum1F.asm), in a margin of one block.
 */
function museum(): Region {
  const margin = 4;
  const w = 40 + margin * 2;
  const h = 16 + margin * 2;
  const labels = new Uint8Array(w * h).fill(LABELS.indexOf("floor"));
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) labels[(margin + 14 + dy) * w + margin + 14 + dx] = LABELS.indexOf("stairs");
  const warps = [[10, 7], [11, 7], [16, 7], [17, 7], [7, 7]].map(([x, y], i) => ({ x: x!, y: y!, to: i < 4 ? ("last" as const) : 53, toWarp: 0 }));
  const map = { id: 52, name: "MUSEUM_1F", widthBlocks: 10, heightBlocks: 4, warps } as unknown as MapData;
  return {
    widthTiles: w, heightTiles: h, labels, present: new Uint8Array(w * h).fill(1),
    maps: [{ map, x: margin, y: margin }], rootX: margin, rootY: margin,
  } as unknown as Region;
}

describe("exits (QA #22)", () => {
  /** Exits in map steps: [first x, last x, y]. */
  const steps = (region: Region) =>
    findExits(region).map((e) => [(e.x0 - region.rootX) / 2, (e.x1 - region.rootX) / 2 - 1, (e.y - region.rootY) / 2 - 1]);

  it("finds Museum 1F's two doormats as two doorways, not the stairs beside them", () => {
    expect(steps(museum())).toEqual([[10, 11, 7], [16, 17, 7]]);
  });

  it("ignores warps above the bottom row", () => {
    const region = museum();
    for (const w of region.maps[0]!.map.warps) w.y = 3;
    expect(findExits(region)).toEqual([]);
  });
});
