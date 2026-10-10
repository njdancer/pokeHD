import { describe, expect, it } from "vitest";
import { domeNormals, FRONT, hip, slope, TOP, type Normal } from "./normals.ts";
import { mapRelief, pictureHeights, type MapRegion } from "./shape.ts";

/** A one-column region, rows given top to bottom; "g" is ground, "f" front, "t" top, "s" 45° slope. */
function column(rows: string): MapRegion {
  const n: Record<string, Normal> = { g: TOP, f: FRONT, t: TOP, s: slope(45) };
  return { width: 1, height: rows.length, normal: (_x, y) => n[rows[y]!]!, colour: () => [128, 128, 128], ground: (_x, y) => rows[y] === "g" };
}
/** Highest point of the mesh, and how far back (−z) it reaches. */
function extent(region: MapRegion, mirror = false) {
  const { positions } = mapRelief(region, { sides: false, mirror });
  let top = 0, back = 0;
  for (let i = 0; i < positions.length; i += 3) { top = Math.max(top, positions[i + 1]!); back = Math.max(back, -positions[i + 2]!); }
  return { top, back };
}

describe("mapRelief", () => {
  it("stacks front pixels up and top pixels back", () => {
    // From the bottom: 2 ground, 4 front (a wall 4 high), then 3 top (its lid, 3 deep).
    expect(extent(column("tttffffgg"))).toEqual({ top: 4, back: 5 });
  });

  it("splits a 45° slope evenly between up and back", () => {
    expect(extent(column("ssffgg"))).toEqual({ top: 3, back: 3 });
  });

  it("mirrors a roof behind its ridge and drops back to the ground after it", () => {
    // Wall 2, roof 2 slope pixels (+1 up, +1 back), mirrored (+1 back, back down), then ground again.
    const { top, back } = extent(column("gssffgg"), true);
    expect(top).toBeCloseTo(3);
    // The ground behind it stays at its natural depth (row 6 of 7 up the screen), not 2 + 1 + 1 + 1.
    expect(back).toBeCloseTo(7);
  });

  it("leaves ground behind a tall object at its natural depth", () => {
    // A 3-high counter at the bottom, floor behind it, then a shelf standing on that floor.
    const region = column("ffffggggfff");
    const { positions } = mapRelief(region, { sides: false, mirror: false });
    // The shelf's base stands 7 rows up the screen, so it sits 7 back, not 7 − 3 = 4.
    let shelfZ = Infinity;
    for (let i = 0; i < positions.length; i += 3) if (positions[i + 1]! > 0.5 && -positions[i + 2]! > 0.5) shelfZ = Math.min(shelfZ, -positions[i + 2]!);
    expect(shelfZ).toBeCloseTo(7);
  });

  it("lowers a hip pixel by its lean, from the column it leans against", () => {
    // Two columns: the right one is a plain 3-high wall with a top; the left one is a hip leaning left.
    const left: Normal = hip(-1, 45);
    const region: MapRegion = {
      width: 2, height: 4,
      normal: (x, y) => (y === 0 ? (x === 0 ? left : TOP) : FRONT),
      colour: () => [0, 0, 0], ground: () => false,
    };
    const { positions } = mapRelief(region, { sides: false, mirror: false });
    // The hip's far-left edge sits one pixel (tan 45°) below the wall top it leans against.
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i < positions.length; i += 3) if (positions[i] === 0 && positions[i + 2]! < -0.5) { xs.push(positions[i]!); ys.push(positions[i + 1]!); }
    expect(Math.min(...ys)).toBeCloseTo(2);
  });
});

describe("pictureHeights", () => {
  const disc = (x: number, y: number) => Math.hypot(x - 7.5, y - 7.5) < 6;
  it("is flat for normals that all face the viewer", () => {
    const z = pictureHeights({ width: 16, height: 16, inside: disc, normal: () => FRONT, colour: () => [0, 0, 0] });
    expect(Math.max(...z)).toBeCloseTo(0);
  });
  it("bulges in the middle for a dome", () => {
    const n = domeNormals(16, 16, disc);
    const z = pictureHeights({ width: 16, height: 16, inside: disc, normal: (x, y) => n[y * 16 + x]!, colour: () => [0, 0, 0] });
    expect(z[8 * 16 + 8]!).toBeGreaterThan(z[8 * 16 + 3]! + 1);
  });
});
