import { describe, expect, it } from "vitest";
import { blendCycle } from "./cycle.ts";
import { bakeLut, gradeColor, LUT_SIZE } from "./grade.ts";
import { LOOK_SCHEMA, mergeLook } from "./params.ts";
import { BUILT_IN_PRESETS, DEFAULT_LOOK } from "./presets.ts";
import { sunDirection } from "./rig.ts";

const neutral = {
  ...DEFAULT_LOOK.grade,
  contrast: 1, saturation: 1, temperature: 0, tint: 0, lift: 0, gamma: 1, gain: 1, splitToneAmount: 0,
};

describe("colour grade", () => {
  it("is the identity when every control is neutral", () => {
    for (const c of [[0, 0, 0], [1, 1, 1], [0.2, 0.5, 0.8]] as const) {
      const out = gradeColor(neutral, [...c]);
      out.forEach((v, i) => expect(v).toBeCloseTo(c[i]!, 6));
    }
  });

  it("bakes a LUT whose corners match the grade", () => {
    const lut = bakeLut(neutral);
    expect(lut.length).toBe(LUT_SIZE ** 3 * 4);
    expect([...lut.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...lut.subarray(lut.length - 4)]).toEqual([255, 255, 255, 255]);
  });

  it("warms with positive temperature", () => {
    const [r, , b] = gradeColor({ ...neutral, temperature: 0.5 }, [0.5, 0.5, 0.5]);
    expect(r).toBeGreaterThan(b);
  });
});

describe("time of day", () => {
  it("rises in the east, peaks at midday and sets towards the west, never below the horizon", () => {
    const morning = sunDirection(DEFAULT_LOOK.sun, 0);
    const midday = sunDirection(DEFAULT_LOOK.sun, 0.5);
    const afternoon = sunDirection(DEFAULT_LOOK.sun, 1);
    expect(morning.x).toBeGreaterThan(0);
    expect(afternoon.x).toBeLessThan(0);
    expect(midday.y).toBeGreaterThan(morning.y);
    for (let p = 0; p <= 1; p += 0.05) expect(sunDirection(DEFAULT_LOOK.sun, p).y).toBeGreaterThan(0);
  });
});

describe("presets", () => {
  it("cover every schema field with a value of the right type", () => {
    for (const preset of [DEFAULT_LOOK, ...Object.values(BUILT_IN_PRESETS)]) {
      for (const [group, fields] of Object.entries(LOOK_SCHEMA)) {
        const values = (preset as unknown as Record<string, Record<string, unknown>>)[group]!;
        for (const [key, spec] of Object.entries(fields)) {
          const v = values[key];
          if (spec.kind === "number") expect(typeof v, `${group}.${key}`).toBe("number");
          if (spec.kind === "boolean") expect(typeof v, `${group}.${key}`).toBe("boolean");
          if (spec.kind === "color") expect(v, `${group}.${key}`).toMatch(/^#[0-9a-f]{6}$/i);
          if (spec.kind === "options") expect(Object.values(spec.options), `${group}.${key}`).toContain(v);
        }
      }
    }
  });

  it("round-trips through JSON and ignores junk", () => {
    const json = JSON.parse(JSON.stringify(BUILT_IN_PRESETS["Golden hour"]));
    expect(mergeLook(DEFAULT_LOOK, json)).toEqual(BUILT_IN_PRESETS["Golden hour"]);
    const merged = mergeLook(DEFAULT_LOOK, { bloom: { strength: "lots", bogus: 1 }, nope: {} });
    expect(merged).toEqual(DEFAULT_LOOK);
  });
});

describe("day cycle", () => {
  const cycle = { morning: BUILT_IN_PRESETS["Golden hour"]!, midday: BUILT_IN_PRESETS["Diorama"]!, afternoon: BUILT_IN_PRESETS["Storybook"]! };

  it("hits each look exactly at its keyframe and keeps time and camera live", () => {
    const live = structuredClone(DEFAULT_LOOK);
    live.camera.yaw = 42;
    expect(blendCycle(cycle, 0, live).grade.exposure).toBeCloseTo(cycle.morning.grade.exposure);
    expect(blendCycle(cycle, 0.5, live).fog.color).toBe(cycle.midday.fog.color);
    expect(blendCycle(cycle, 1, live).grade.lift).toBeCloseTo(cycle.afternoon.grade.lift);
    expect(live.camera.yaw).toBe(42);
    expect(live.time).toEqual(DEFAULT_LOOK.time);
  });

  it("takes pipeline switches from midday and blends numbers in between", () => {
    const out = blendCycle(cycle, 0.25, structuredClone(DEFAULT_LOOK));
    expect(out.tiltShift.blur).toBe(cycle.midday.tiltShift.blur);
    const [lo, hi] = [cycle.morning.grade.exposure, cycle.midday.grade.exposure].sort((x, y) => x - y);
    expect(out.grade.exposure).toBeGreaterThan(lo!);
    expect(out.grade.exposure).toBeLessThan(hi!);
  });
});
