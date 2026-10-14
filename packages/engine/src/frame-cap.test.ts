import { describe, expect, it } from "vitest";
import { createFrameCap } from "./frame-cap.ts";

/** Ticks a display at `hz` for one second, drawing whenever the cap allows; returns the draws. */
function drawsPerSecond(hz: number, maxFps: number, jitterMs = 0) {
  const cap = createFrameCap(maxFps);
  let draws = 0;
  for (let i = 0; i < hz; i++) {
    const t = (i * 1000) / hz + (i % 2 ? jitterMs : -jitterMs);
    if (cap.allows(t)) {
      cap.drew(t);
      draws++;
    }
  }
  return draws;
}

describe("frame cap", () => {
  it("draws every other tick at 60 fps on a 120 Hz display", () => {
    expect(drawsPerSecond(120, 60)).toBe(60);
  });

  it("tolerates vsync jitter", () => {
    expect(drawsPerSecond(120, 60, 0.4)).toBe(60);
    expect(drawsPerSecond(60, 60, 0.4)).toBe(60);
  });

  it("averages the cap on a display whose ticks don't divide it", () => {
    const draws = drawsPerSecond(144, 60);
    expect(draws).toBeGreaterThanOrEqual(58);
    expect(draws).toBeLessThanOrEqual(61);
  });

  it("never draws faster than the display", () => {
    expect(drawsPerSecond(60, 120)).toBe(60);
  });

  it("doesn't burst to catch up after an idle spell", () => {
    const cap = createFrameCap(60);
    cap.drew(0);
    expect(cap.allows(1000)).toBe(true);
    cap.drew(1000);
    expect(cap.allows(1000 + 1000 / 120)).toBe(false);
    expect(cap.allows(1000 + 1000 / 60)).toBe(true);
  });
});
