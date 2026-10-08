import { describe, expect, it } from "vitest";
import { createGovernor, RUNGS } from "./governor.ts";

const VSYNC = 1000 / 60;

/**
 * Runs `seconds` of a 60 Hz display whose GPU needs `workMs(rung)` per frame; frames that miss
 * vsync wait for the next one. Returns the rung at each frame.
 */
function run(governor: ReturnType<typeof createGovernor>, seconds: number, workMs: (rung: number) => number, start = 0) {
  let now = start;
  const rungs: number[] = [];
  while (now < start + seconds) {
    const interval = Math.max(1, Math.ceil(workMs(governor.rung) / VSYNC - 1e-9)) * VSYNC;
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
});
