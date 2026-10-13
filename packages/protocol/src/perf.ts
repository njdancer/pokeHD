// Performance telemetry: what a browser sends `POST /api/perf` about how smoothly the game ran on
// it, one window of play at a time, so Nick can see how the old iPad copes at /admin/perf.
// Only time the page is visible counts. Like crash reports, long text is cut rather than refused.
import * as v from "valibot";
import { DeviceSchema } from "./errors.ts";

/** A string cut to at most `max` characters. */
const text = (max: number) => v.pipe(v.string(), v.transform((s) => s.slice(0, max)));
/** A share of the window, 0 to 1. */
const share = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

/** A display frame slower than this missed 60 fps: 1.25 × 16.7 ms, so vsync jitter doesn't count. */
export const MISSED_FRAME_MS = 1.25 * (1000 / 60);
/** A display frame slower than this is a stall: the page froze long enough to notice. */
export const STALL_MS = 100;

export const PerfReportSchema = v.object({
  /** One per page load, the same as its crash reports'. */
  visit: v.pipe(v.string(), v.regex(/^[0-9a-z]{8,32}$/)),
  build: text(64),
  page: text(500),
  /** Milliseconds since the page loaded, when the window closed. */
  uptime: v.number(),
  device: DeviceSchema,
  /** The 3D renderer, or `none` when the HD view couldn't start (the emulator still runs). */
  backend: v.picklist(["webgpu", "webgl", "none"]),
  /** The engine's quality tier (`full` or `mobile`), once it has one. */
  quality: v.optional(text(20)),
  /** Visible seconds the window covers. */
  seconds: v.number(),
  /** Display frames in it, and their mean rate. */
  frames: v.number(),
  fps: v.number(),
  /** Time between display frames: median, 95th percentile and worst, ms. */
  p50Ms: v.number(),
  p95Ms: v.number(),
  worstMs: v.number(),
  /** Share of frames that missed 60 fps (over MISSED_FRAME_MS). */
  missed: share,
  /** Frames over STALL_MS. */
  stalls: v.number(),
  /** Game Boy frames emulated per second: the real one runs at 59.7, and below that the game itself is slow. */
  emuFps: v.number(),
  /** The engine's CPU time per frame (median), its mean render scale, the share of time with depth of field on and the 3D frames it drew per second. Absent with no renderer. */
  cpuMs: v.optional(v.number()),
  scale: v.optional(v.number()),
  dof: v.optional(share),
  drawn: v.optional(v.number()),
  /** Share of the window in each of the game's modes; `other` is the title, intro and loading. `menu` is the Pokédex menu or a question sheet being up, on top of whichever mode. */
  modes: v.object({ overworld: share, dialog: share, battle: share, other: share, menu: share }),
  /** The map the player was on last, if they were in the world. */
  map: v.optional(v.number()),
});
export type PerfReport = v.InferOutput<typeof PerfReportSchema>;

/** A report from JSON, or null if it isn't one. */
export function parsePerfReport(json: unknown): PerfReport | null {
  const parsed = v.safeParse(PerfReportSchema, json);
  return parsed.success ? parsed.output : null;
}

/** The biggest perf report body the Worker reads. */
export const PERF_REPORT_MAX_BYTES = 8 * 1024;

/** What kind of device a user agent is, in a word: "iPad", "iPhone", "Mac", "Android" and so on. */
export function deviceLabel(ua: string, touch = 0): string {
  if (/iPhone/.test(ua)) return "iPhone";
  // iPadOS asks for desktop sites with a Mac user agent; only its touch points give it away.
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  return "another device";
}
