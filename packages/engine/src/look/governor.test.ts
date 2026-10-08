import { describe, expect, it } from "vitest";
import { createGovernor, RUNGS } from "./governor.ts";

const VSYNC = 1000 / 60;

/**
 * Runs `seconds` of a 60 Hz display whose GPU needs `workMs(rung)` per frame; frames that miss
 * vsync wait for the next one. Returns the rung at each frame.
 */
function run(governor: ReturnType<typeof createGovernor>, seconds: number, workMs: (rung: number) => number, start = 0, vsync = VSYNC) {
  let now = start;
  const rungs: number[] = [];
  while (now < start + seconds) {
    const interval = Math.max(1, Math.ceil(workMs(governor.rung) / vsync - 1e-9)) * vsync;
    now += interval / 1000;
    governor.sample(interval, now);
    rungs.push(governor.rung);
  }
  return { rungs, end: now };
}

/** GPU work that scales with pixels (scale²), with depth of field a fixed share of it. */
const gpu = (fullMs: number) => (rung: number) => {
  const { scale, dof } = RUNGS[rung]!;
  return fullMs * scale * scale * (dof ? 1 : 0.65);
};

describe("createGovernor", () => {
  it("leaves a fast device at full resolution", () => {
    const g = createGovernor();
    run(g, 30, gpu(10));
    expect(g.rung).toBe(0);
  });

  it("steps down until frames fit, and mostly stays there", () => {
    const g = createGovernor();
    // 30 ms at full size fits 16.7 ms at scale 0.7 (rung 3).
    const { rungs } = run(g, 120, gpu(30));
    const lastMinute = rungs.slice(-3600);
    const atFit = lastMinute.filter((r) => r === 3).length / lastMinute.length;
    expect(atFit).toBeGreaterThan(0.9);
    expect(Math.min(...lastMinute)).toBeGreaterThanOrEqual(2); // probes one rung up at most
  });

  it("drops depth of field only when the lowest scale isn't enough", () => {
    const g = createGovernor();
    run(g, 30, gpu(80)); // 80 × 0.25 = 20 ms at half size; 13 ms without DoF
    expect(g.rung).toBe(RUNGS.length - 1);
  });

  it("gives resolution back when the scene gets cheaper", () => {
    const g = createGovernor();
    const heavy = run(g, 30, gpu(30));
    expect(g.rung).toBeGreaterThan(0);
    run(g, 30, gpu(8), heavy.end);
    expect(g.rung).toBe(0);
  });

  it("undoes a descent that buys nothing (a 30 fps cap) and holds full resolution", () => {
    const g = createGovernor();
    const capped = () => 2 * VSYNC; // Low Power Mode: every frame takes two vsyncs
    const { rungs } = run(g, 300, capped);
    expect(g.rung).toBe(0);
    // It tries again after 30 s, then 60, then 120: mostly at full resolution.
    expect(rungs.filter((r) => r === 0).length / rungs.length).toBeGreaterThan(0.85);
  });

  it("ignores stalls", () => {
    const g = createGovernor();
    let now = 0;
    for (let i = 0; i < 600; i++) {
      now += VSYNC / 1000;
      g.sample(i % 60 === 0 ? 400 : VSYNC, now);
    }
    expect(g.rung).toBe(0);
  });

  it("settles below a rung it keeps failing instead of flickering (120 Hz display)", () => {
    // Work hovers around the 60 fps budget at full size: some windows pass, most don't.
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const g = createGovernor();
    const work = (r: number) => gpu(17)(r) * (0.85 + rand() * 0.3);
    const first = run(g, 60, work, 0, 1000 / 120);
    const { rungs } = run(g, 120, work, first.end, 1000 / 120);
    const changes = rungs.filter((r, i) => i > 0 && r !== rungs[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(4); // by now, a probe up a minute at most, and its return
  });

  it("doesn't take a startup full of stalls for the steady frame rate", () => {
    const g = createGovernor();
    // Five seconds of shader compiles: mostly 150-400 ms frames, a few 60 ms ones.
    let now = 0;
    for (let i = 0; now < 5; i++) {
      const ms = i % 4 === 0 ? 60 : 150 + (i % 3) * 120;
      now += ms / 1000;
      g.sample(ms, now);
    }
    // Then a steady 30 ms at full size: stepping down must stick, not be undone as fruitless.
    run(g, 40, gpu(30), now);
    expect(g.rung).toBeGreaterThanOrEqual(2);
    expect(g.rung).toBeLessThanOrEqual(4);
  });

  it("doesn't blur a CPU-bound page: a smaller image wouldn't help", () => {
    const g = createGovernor();
    let now = 0;
    for (let i = 0; i < 1800; i++) {
      now += (2 * VSYNC) / 1000;
      g.sample(2 * VSYNC, now, 22); // 22 ms of main-thread work a frame
    }
    expect(g.rung).toBe(0);
  });
});
