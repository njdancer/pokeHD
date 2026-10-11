import { describe, expect, it } from "vitest";
import snapshot from "../../../../dashboard/dex-motion-values.json" with { type: "json" };
import { cubicBezier, DEX_MOTION, DexRoll, dexPose, fitBox, heldAngle, MAX_SCREEN, loadDexMotion, motionLength, pageCorners, pageSize, type DexFrame, type DexMeasure } from "./motion.ts";

// Roughly the GLB's: a 9 × 14 body, a 7.3 × 7.6 screen a little below its middle.
const measure: DexMeasure = { shut: { w: 9, h: 14, centre: [0, 0, 0] }, screen: { w: 7.3, h: 7.6, centre: [0, -0.75, 0.1] } };
const portrait: DexFrame = { width: 390, height: 844, unitsPerPixel: 0.1 };
const wide: DexFrame = { width: 844, height: 390, unitsPerPixel: 0.1 };
const deg = (r: number) => (r * 180) / Math.PI;

describe("tuned values", () => {
  it("match the tuner's snapshot in dashboard/dex-motion-values.json", () => {
    expect(DEX_MOTION).toEqual(snapshot);
  });

  it("load from older versions, with landscape starting as portrait's", () => {
    const v3 = { version: 3, path: { c1: [0.1, 0.2], c2: [0.3, 0.4] }, open: { fill: 0.8, offsetY: 12 }, tracks: { move: { delay: 7, duration: 100, curve: [0, 0, 1, 1] } } };
    const m = loadDexMotion(JSON.stringify(v3));
    expect(m.landscape).toEqual({ path: v3.path, open: v3.open });
    expect(m.tracks.move.delay).toBe(7);
    expect(m.rotate).toEqual(DEX_MOTION.rotate);
    expect(loadDexMotion("not json")).toEqual(DEX_MOTION);
  });

  it("ignore junk", () => {
    const m = loadDexMotion({ closed: { width: "big", top: Infinity }, path: { c1: [1] } });
    expect(m.closed).toEqual(DEX_MOTION.closed);
    expect(m.path).toEqual(DEX_MOTION.path);
  });
});

describe("cubicBezier", () => {
  it("is linear for (0, 0, 1, 1) and clamps outside 0–1", () => {
    const f = cubicBezier([0, 0, 1, 1]);
    expect(f(0.3)).toBeCloseTo(0.3, 5);
    expect(f(-1)).toBe(0);
    expect(f(2)).toBe(1);
  });
  it("matches CSS ease at the middle", () => expect(cubicBezier([0.25, 0.1, 0.25, 1])(0.5)).toBeCloseTo(0.8024, 3));
});

describe("heldAngle", () => {
  it("is upright when tall, and follows the screen angle when wide", () => {
    expect(heldAngle(390, 844, 90)).toBe(0);
    expect(heldAngle(844, 390, 90)).toBe(90);
    expect(heldAngle(844, 390, 270)).toBe(-90);
    expect(heldAngle(844, 390, null)).toBe(90);
  });
});

describe("dexPose", () => {
  it("starts as the upright button in the top-right corner", () => {
    for (const [frame, held] of [[portrait, 0], [wide, 90], [wide, -90]] as const) {
      const p = dexPose(DEX_MOTION, 0, frame, measure, held);
      const { width, top, right, tiltZ } = DEX_MOTION.closed;
      expect(p.position[0] / frame.unitsPerPixel).toBeCloseTo(frame.width / 2 - right - width / 2, 6);
      expect(p.position[1] / frame.unitsPerPixel).toBeCloseTo(frame.height / 2 - top - (width * 14) / 9 / 2, 6);
      expect(deg(p.rotation[2])).toBeCloseTo(tiltZ, 6);
      expect(p.scale * measure.shut.w).toBeCloseTo(width * frame.unitsPerPixel, 6);
      expect(p.shut).toBe(1);
      expect(p.cover).toBe(0);
    }
  });

  it("ends in the middle, square on, rolled to the way the phone is held, its screen filling the frame", () => {
    const end = motionLength(DEX_MOTION);
    const up = dexPose(DEX_MOTION, end, portrait, measure, 0);
    expect(up.position.map(Math.abs)).toEqual([0, 0]);
    for (const r of up.rotation) expect(r).toBeCloseTo(0, 9);
    expect(up.scale * measure.screen.w).toBeCloseTo(DEX_MOTION.open.fill * portrait.width * portrait.unitsPerPixel, 6);
    expect(up.cover).toBe(1);
    expect(up.page).toBe(1);
    for (const held of [90, -90] as const) {
      const p = dexPose(DEX_MOTION, end, wide, measure, held);
      expect(deg(p.rotation[2])).toBeCloseTo(held, 6);
      // Lying on its side, its screen's width runs up the frame's height.
      expect(p.scale * measure.screen.w).toBeCloseTo(DEX_MOTION.landscape.open.fill * wide.height * wide.unitsPerPixel, 6);
    }
  });

  it("rolls with the angle it's given while turning", () => {
    const end = motionLength(DEX_MOTION);
    expect(deg(dexPose(DEX_MOTION, end, wide, measure, 90, 30).rotation[2])).toBeCloseTo(30, 6);
  });
});

describe("DexRoll", () => {
  it("rolls to the new angle over the tuned duration, and from mid-roll when turned again", () => {
    const roll = new DexRoll(() => DEX_MOTION);
    const d = DEX_MOTION.rotate.duration;
    roll.to(90, 1000);
    expect(roll.at(1000)).toBe(0);
    expect(roll.at(1000 + d / 2)).toBeGreaterThan(0);
    expect(roll.at(1000 + d / 2)).toBeLessThan(90);
    expect(roll.swap(1000)).toBe(0);
    expect(roll.at(1000 + d)).toBe(90);
    expect(roll.swap(1000 + d)).toBe(1);
    roll.to(0, 1000 + d / 2);
    expect(roll.from).toBeGreaterThan(0);
    expect(roll.from).toBeLessThan(90);
    expect(roll.at(1000 + d * 1.5)).toBe(0);
  });
});

describe("pages", () => {
  it("turn the screen's corners so the page's top is up", () => {
    const c = ["tl", "tr", "br", "bl"];
    expect(pageCorners(c, 0)).toEqual(c);
    // Rolled anticlockwise, the model's top-right corner is at the top-left.
    expect(pageCorners(c, 90)).toEqual(["tr", "br", "bl", "tl"]);
    expect(pageCorners(c, -90)).toEqual(["bl", "tl", "tr", "br"]);
  });
  it("lay out wide when the phone is", () => {
    const p = pageSize(DEX_MOTION, portrait, measure, 0), l = pageSize(DEX_MOTION, wide, measure, 90);
    expect(p.width).toBeLessThan(p.height);
    expect(l.width).toBeGreaterThan(l.height);
    // Its screen's width runs up the frame's height, filling it.
    expect(l.height).toBe(Math.round(DEX_MOTION.landscape.open.fill * wide.height));
  });
});

describe("fitBox", () => {
  it("is a phone's safe area, centred between its insets", () => {
    const b = fitBox(390, 844, 0, { top: 47, right: 0, bottom: 34, left: 0 });
    expect(b).toMatchObject({ width: 390, height: 763, x: 0, y: 6.5, portrait: { width: 390, height: 763 } });
  });
  it("never grows past the largest iPhone, upright or on its side", () => {
    expect(fitBox(2560, 1440, 90)).toMatchObject({ width: MAX_SCREEN.height, height: MAX_SCREEN.width, portrait: MAX_SCREEN });
    expect(fitBox(1000, 1400, 0)).toMatchObject({ width: MAX_SCREEN.width, height: MAX_SCREEN.height });
  });
  it("keeps a phone-sized dex on a big display", () => {
    const frame: DexFrame = { width: 2560, height: 1440, unitsPerPixel: 0.1 };
    const s = pageSize(DEX_MOTION, { ...frame, fit: fitBox(2560, 1440, 90) }, measure, 90);
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(MAX_SCREEN.height);
  });
});
