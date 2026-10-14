import { MAP_NAMES, parseWorld, type MapId } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { buildRegion } from "./region.ts";
import { hasTerraces, stepLevel, terraces } from "./terraces.ts";

// The engine is typed for the browser, without Node's types: fs comes in untyped.
const { existsSync, readFileSync }: { existsSync(p: URL): boolean; readFileSync(p: URL): Uint8Array } = await import(
  "node:fs" as string
);
const ROM_PATH = new URL("../../../../rom/pokeblue.gb", import.meta.url);
const romAvailable = existsSync(ROM_PATH);

describe.skipIf(!romAvailable)("cave terraces", () => {
  const world = romAvailable ? parseWorld(new Uint8Array(readFileSync(ROM_PATH))) : null!;
  const cave = (name: string) => {
    const region = buildRegion(world, MAP_NAMES.indexOf(name) as MapId, { marginBlocks: 0 });
    const t = terraces(region);
    return { region, t, at: (sx: number, sy: number) => stepLevel(t, region, 0, 0, sx, sy) };
  };

  it("reads only caves as terraces", () => {
    expect(hasTerraces(buildRegion(world, MAP_NAMES.indexOf("PALLET_TOWN") as MapId))).toBe(false);
    expect(hasTerraces(cave("MT_MOON_1F").region)).toBe(true);
  });

  it("raises Mt Moon 1F's light rock strips above the floor you walk on, as solid blocks (QA: 'raised strips')", () => {
    const { t, region, at } = cave("MT_MOON_1F");
    expect(at(14, 33)).toBe(0); // the entrance corridor
    expect(at(19, 8)).toBe(1); // a light strip in the middle of the floor
    // The strip's light floor (0x05) and its rock rim stand at the same height: no sunken middle.
    const row = 18 * region.widthTiles;
    expect([36, 37, 38, 39].map((x) => t.levels[row + x])).toEqual([1, 1, 1, 1]);
  });

  it("steps Mt Moon B2F down its stone steps, from the upper floor to the lower", () => {
    const { at } = cave("MT_MOON_B2F");
    const upper = at(3, 4);
    const steps = at(3, 5);
    const lower = at(3, 6);
    expect(upper).toBe(lower + 1);
    expect(steps).toBeGreaterThan(lower);
    expect(steps).toBeLessThan(upper);
  });
});
