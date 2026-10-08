import { describe, expect, it } from "vitest";
import { hexToLch, lchToHex, shiftHue } from "./colour.ts";
import { fakeWorld } from "./fake-world.ts";
import { LABEL_RAMPS } from "./palette.ts";
import { paletteColours, placeColours, playerRamp } from "./place.ts";

const hue = (hex: number) => hexToLch(hex).h;
const near = (a: number, b: number, by: number) => Math.abs(((a - b + 540) % 360) - 180) <= by;

describe("colour maths", () => {
  it("round-trips sRGB through OKLCh", () => {
    for (const hex of [0xffefff, 0xade75a, 0xd65231, 0x181010, 0x8ca5f7]) expect(lchToHex(hexToLch(hex))).toBe(hex);
  });

  it("shifts hue the short way round", () => {
    expect(shiftHue(350, 20, 10)).toBe(0);
    expect(shiftHue(100, 85, 30)).toBe(85);
  });
});

describe("place colours", () => {
  const world = fakeWorld();

  it("roofs and people take the town colour, lightest to darkest", () => {
    const route = paletteColours(world.sgbPalettes, 0);
    expect(route.tint).toBe("#ade75a");
    const roof = route.ramps.roof!;
    expect(near(hue(roof[1]), hue(0xade75a), 5)).toBe(true);
    const lightness = roof.map((h) => hexToLch(h).l);
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
    expect(near(hue(route.people[1]), hue(0xade75a), 5)).toBe(true);
  });

  it("leaves a near-grey town neutral, but dresses its people in the palette's blue", () => {
    const pallet = paletteColours(world.sgbPalettes, 1);
    expect(pallet.tint).toBeNull();
    expect(pallet.ramps.roof).toBeUndefined();
    expect(near(hue(pallet.people[1]), hue(0xa5d6ff), 5)).toBe(true);
    expect(hexToLch(pallet.people[1]).c).toBeGreaterThan(0.08);
  });

  it("follows SetPal_Overworld per map", () => {
    expect(placeColours(world, 0).palette).toBe(1); // map 0 is Pallet Town's slot
    expect(placeColours(world, 2).palette).toBe(3);
  });

  it("dresses the player in red", () => {
    // RGB 31,29,31, 31,20,10, 26,10,06, 03,02,02 ; PAL_REDMON
    world.sgbPalettes[0x12] = [0xffefff, 0xffa552, 0xd65231, 0x181010];
    const red = playerRamp(world);
    expect(near(hue(red[1]), 30, 25)).toBe(true);
    expect(hexToLch(red[1]).c).toBeGreaterThan(0.12);
  });

  it("keeps the base ramps for everything else", () => {
    expect(paletteColours(world.sgbPalettes, 0).ramps).not.toHaveProperty("lawn");
    expect(LABEL_RAMPS.lawn).toHaveLength(4);
  });
});
