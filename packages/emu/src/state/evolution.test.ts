import { describe, expect, it } from "vitest";
import { EvolutionReader, evolutionShown } from "./evolution.ts";

const BLANK = 0x7f;
const at = (x: number, y: number) => y * 20 + x;

/** The evolution screen: the flipped picture at (7, 2), columns right to left, from tile `first`. */
function evolutionScreen(first: number, flipped = true): Uint8Array {
  const tileMap = new Uint8Array(360).fill(BLANK);
  for (let n = 0; n < 49; n++) {
    const col = Math.floor(n / 7);
    tileMap[at(7 + (flipped ? 6 - col : col), 2 + (n % 7))] = first + n;
  }
  return tileMap;
}

describe("evolutionShown", () => {
  it("tells the old picture from the new", () => {
    expect(evolutionShown(evolutionScreen(0))).toBe("old");
    expect(evolutionShown(evolutionScreen(0x31))).toBe("new");
  });

  it("ignores the text box below, but nothing else on the cleared rows", () => {
    const withBox = evolutionScreen(0);
    withBox.fill(0x7a, at(0, 12), at(20, 12));
    expect(evolutionShown(withBox)).toBe("old");
    const stray = evolutionScreen(0);
    stray[at(0, 0)] = 0x80;
    expect(evolutionShown(stray)).toBeNull();
  });

  it("isn't a picture drawn the right way round, or a blank screen", () => {
    expect(evolutionShown(evolutionScreen(0, false))).toBeNull();
    expect(evolutionShown(new Uint8Array(360).fill(BLANK))).toBeNull();
  });
});

describe("EvolutionReader", () => {
  it("latches the species and shows the silhouette once the pictures swap", () => {
    const reader = new EvolutionReader();
    const picTiles = new Uint8Array(98 * 16).fill(0xff);
    const read = (first: number, evoSpecies: number[]) => reader.read({ tileMap: evolutionScreen(first), picTiles, evoSpecies: new Uint8Array(evoSpecies) })!;
    const first = read(0, [0xb1, 0xb3]);
    expect(first).toMatchObject({ showing: "old", species: 0xb1, silhouette: false });
    expect(first.pixels.every((p) => p === 3)).toBe(true);
    // The union moves on; the species stay.
    expect(read(0x31, [0, 0])).toMatchObject({ showing: "new", species: 0xb3, silhouette: true });
    for (let i = 0; i < 60; i++) read(0x31, [0, 0]);
    expect(read(0x31, [0, 0])).toMatchObject({ species: 0xb3, silhouette: false });
    expect(reader.read({ tileMap: new Uint8Array(360).fill(BLANK), picTiles, evoSpecies: new Uint8Array(2) })).toBeNull();
  });
});
