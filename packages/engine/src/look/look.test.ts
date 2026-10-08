import { describe, expect, it } from "vitest";
import { createDayClock, stepDay, wrapNow, WRAP_FADE_SECONDS } from "./clock.ts";
import { blendCycle } from "./cycle.ts";
import { bakeLut, gradeColor, LUT_SIZE, normTint } from "./grade.ts";
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

  it("bakes exactly what gradeColor gives, texel for texel", () => {
    const place = normTint("#ade75a");
    for (const preset of Object.values(BUILT_IN_PRESETS)) {
      const lut = bakeLut(preset.grade, 8, undefined, place);
      let i = 0;
      for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const want = gradeColor(preset.grade, [x / 7, y / 7, z / 7], place).map((v) => Math.round(v * 255));
        expect([...lut.subarray(i, i + 3)]).toEqual(want);
        i += 4;
      }
    }
  });

  it("leans midtones toward the place's colour and leaves black and white alone", () => {
    const green = normTint("#ade75a");
    const [r, g, b] = gradeColor({ ...neutral, placeTint: 0.5 }, [0.5, 0.5, 0.5], green);
    expect(g).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(b);
    expect(gradeColor({ ...neutral, placeTint: 0.5 }, [1, 1, 1], green)).toEqual([1, 1, 1]);
    expect(gradeColor({ ...neutral, placeTint: 0.5 }, [0, 0, 0], green)).toEqual([0, 0, 0]);
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
    const evening = sunDirection(DEFAULT_LOOK.sun, 1);
    expect(morning.x).toBeGreaterThan(0);
    expect(evening.x).toBeLessThan(0);
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
  const cycle = { morning: BUILT_IN_PRESETS["Golden hour"]!, midday: BUILT_IN_PRESETS["Diorama"]!, evening: BUILT_IN_PRESETS["Storybook"]! };

  it("hits each look exactly at its keyframe and keeps time and camera live", () => {
    const live = structuredClone(DEFAULT_LOOK);
    live.camera.yaw = 42;
    expect(blendCycle(cycle, 0, live).grade.exposure).toBeCloseTo(cycle.morning.grade.exposure);
    expect(blendCycle(cycle, 0.5, live).fog.color).toBe(cycle.midday.fog.color);
    expect(blendCycle(cycle, 1, live).grade.lift).toBeCloseTo(cycle.evening.grade.lift);
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

describe("day clock", () => {
  const time = () => ({ ...DEFAULT_LOOK.time, phase: 0, drift: true, cycleSeconds: 10, eveningHold: 2 });

  it("only runs forwards, holds the evening, then wraps to morning behind a fade", () => {
    const t = time();
    const clock = createDayClock(t);
    const phases: number[] = [];
    for (let i = 0; i < 100; i++) {
      stepDay(t, clock, 0.1);
      phases.push(t.phase);
    }
    expect(phases[99]).toBe(1); // 10 s of day
    for (let i = 1; i < phases.length; i++) expect(phases[i]!).toBeGreaterThanOrEqual(phases[i - 1]!);
    for (let i = 0; i < 20; i++) stepDay(t, clock, 0.1); // evening hold
    expect(t.phase).toBe(1);
    expect(clock.fading).toBe(1);
    for (let s = 0; s < WRAP_FADE_SECONDS; s += 0.1) stepDay(t, clock, 0.1);
    stepDay(t, clock, 0.1);
    expect(t.phase).toBe(0); // wrapped while black
    expect(clock.fade).toBeGreaterThan(0.5);
    for (let s = 0; s < WRAP_FADE_SECONDS + 0.2; s += 0.1) stepDay(t, clock, 0.1);
    expect(clock.fade).toBe(0);
  });

  it("wraps instantly when the screen is already black", () => {
    const t = { ...time(), phase: 0.9 };
    const clock = createDayClock(t);
    wrapNow(t, clock, true);
    expect(t.phase).toBe(0);
    expect(clock.fade).toBe(0);
  });

  it("puts the evening sun low in the west for long shadows", () => {
    const dir = sunDirection(DEFAULT_LOOK.sun, 1);
    expect(Math.asin(dir.y) * (180 / Math.PI)).toBeLessThan(12);
    expect(dir.x).toBeLessThan(-0.5);
  });
});
