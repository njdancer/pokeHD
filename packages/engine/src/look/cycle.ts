import { LOOK_SCHEMA, STRUCTURAL, type LookParams } from "./params.ts";

// A day cycle blends three looks across the time of day: morning (phase 0), midday (0.5) and
// evening (1), then leans the result toward a fourth, dusk, by `time.dusk` (D40). Continuous
// values (numbers, colours) interpolate every frame. Switches, tone mapping and anything else
// that rebuilds the pipeline can't blend, so they come from the midday look. Time, camera and
// render settings stay live: time drives the blend, and the camera and render settings aren't
// part of a look.

export interface DayCycle {
  morning: LookParams;
  midday: LookParams;
  evening: LookParams;
  /** After the evening: no sun, low warm light. Its morning and evening colours should match. */
  dusk: LookParams;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function lerpHex(a: string, b: string, t: number): string {
  const pa = Number.parseInt(a.slice(1, 7), 16);
  const pb = Number.parseInt(b.slice(1, 7), 16);
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (pa >> shift) & 255;
    const cb = (pb >> shift) & 255;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return `#${out.toString(16).padStart(6, "0")}`;
}

const LIVE = new Set(["time", "camera", "render"]);

/**
 * Writes `a` blended toward `b` by `t` into `out`, leaving the live groups untouched. Pipeline
 * switches come from `fixed`.
 */
export function blendLooks(a: LookParams, b: LookParams, t: number, fixed: LookParams, out: LookParams): LookParams {
  for (const [group, fields] of Object.entries(LOOK_SCHEMA)) {
    if (LIVE.has(group)) continue;
    const g = group as keyof LookParams;
    const va = a[g] as unknown as Record<string, unknown>;
    const vb = b[g] as unknown as Record<string, unknown>;
    const vf = fixed[g] as unknown as Record<string, unknown>;
    const dst = out[g] as unknown as Record<string, unknown>;
    for (const [key, spec] of Object.entries(fields)) {
      if (STRUCTURAL.has(`${group}.${key}`)) dst[key] = vf[key];
      // This form lands exactly on b at t = 1, so full dusk is the same whatever the phase.
      else if (spec.kind === "number") dst[key] = (va[key] as number) * (1 - t) + (vb[key] as number) * t;
      else if (spec.kind === "color") dst[key] = lerpHex(va[key] as string, vb[key] as string, t);
      else dst[key] = vf[key];
    }
  }
  return out;
}

/** Writes the blended look for `phase` and `dusk` into `out`, leaving the live groups untouched. */
export function blendCycle(cycle: DayCycle, phase: number, dusk: number, out: LookParams): LookParams {
  const [a, b, t] =
    phase < 0.5 ? [cycle.morning, cycle.midday, smooth(phase * 2)] : [cycle.midday, cycle.evening, smooth((phase - 0.5) * 2)];
  blendLooks(a, b, t, cycle.midday, out);
  if (dusk > 0) blendLooks(out, cycle.dusk, smooth(Math.min(dusk, 1)), cycle.midday, out);
  return out;
}
