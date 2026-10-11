// ROM test for where the map puts the player indoors: at the door of the building they're in,
// through any floors in between. Skips without the dev ROM.
import { existsSync, readFileSync } from "node:fs";
import { MAP_NAMES, parseWorld } from "@pokehd/rom";
import { describe, expect, it } from "vitest";
import { outdoorSpot } from "./live.ts";

const ROM_PATH = new URL("../../../../../rom/pokeblue.gb", import.meta.url);
const id = (name: string) => MAP_NAMES.indexOf(name);

describe.skipIf(!existsSync(ROM_PATH))("outdoorSpot", () => {
  const world = () => parseWorld(new Uint8Array(readFileSync(ROM_PATH)));

  it("finds the door outside, through the floors in between", () => {
    const w = world();
    expect(outdoorSpot(w, id("REDS_HOUSE_1F"))?.map).toBe(id("PALLET_TOWN"));
    expect(outdoorSpot(w, id("REDS_HOUSE_2F"))?.map).toBe(id("PALLET_TOWN"));
    expect(outdoorSpot(w, id("VIRIDIAN_POKECENTER"))?.map).toBe(id("VIRIDIAN_CITY"));
  });

  it("puts every interior somewhere outdoors but the link rooms and unused copies", () => {
    const w = world();
    const lost = w.maps.filter((m) => m && m.id >= id("REDS_HOUSE_1F") && !outdoorSpot(w, m.id)).map((m) => MAP_NAMES[m!.id]);
    // The link rooms are reached by the cable, not a door: the map falls back to the last place outdoors.
    expect(lost).toEqual(["CERULEAN_TRASHED_HOUSE_COPY", "UNDERGROUND_PATH_ROUTE_6_COPY", "UNDERGROUND_PATH_ROUTE_7_COPY", "CINNABAR_MART_COPY", "TRADE_CENTER", "COLOSSEUM"]);
  });
});
