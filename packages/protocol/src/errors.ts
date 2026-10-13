// Crash reports: what a browser sends `POST /api/errors` when something goes wrong on it, so
// errors on Nick's (and his son's) phone can be read later at /admin/errors. Long text is cut
// rather than refused: a report that arrives trimmed beats one that's dropped.
import * as v from "valibot";

/**
 * - `error`: an uncaught exception (window `error`).
 * - `rejection`: an unhandled promise rejection.
 * - `react`: React unmounted the page (or an error boundary caught a render error).
 * - `gpu`: a WebGPU validation or out-of-memory error nobody captured.
 * - `gpu-lost`: the GPU device or WebGL context was lost.
 * - `emulator`: the emulator's worker failed.
 */
export const ERROR_KINDS = ["error", "rejection", "react", "gpu", "gpu-lost", "emulator"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** A string cut to at most `max` characters. */
const text = (max: number) => v.pipe(v.string(), v.transform((s) => s.slice(0, max)));

/** The browser and machine a report came from; perf reports (perf.ts) send the same. */
export const DeviceSchema = v.object({
  ua: text(400),
  /** CSS pixels, `widthxheight`. */
  screen: text(40),
  dpr: v.number(),
  /** Running as an installed home-screen app. */
  standalone: v.boolean(),
  /** `webgpu` or `webgl`, once the engine has a renderer. */
  renderer: v.optional(text(20)),
  /** The GPU adapter's vendor and architecture, where the browser says. */
  gpu: v.optional(text(200)),
  /** Approximate RAM in GB (Chromium only). */
  memory: v.optional(v.number()),
  /** Logical CPU cores (navigator.hardwareConcurrency). */
  cores: v.optional(v.number()),
  /** Touch points (navigator.maxTouchPoints): an iPad says it's a Mac, but a Mac has none. */
  touch: v.optional(v.number()),
});
export type Device = v.InferOutput<typeof DeviceSchema>;

export const ErrorReportSchema = v.object({
  kind: v.picklist(ERROR_KINDS),
  message: text(2000),
  stack: v.optional(text(8000)),
  /** React's component stack, for `react` reports. */
  componentStack: v.optional(text(4000)),
  /** Path and query of the page. */
  page: text(500),
  /** The build that was running: short commit and build date. */
  build: text(64),
  /** One per page load, so reports from the same visit group together. */
  visit: v.pipe(v.string(), v.regex(/^[0-9a-z]{8,32}$/)),
  /** Milliseconds since the page loaded. */
  uptime: v.number(),
  /** The last few console warnings and errors before this one, oldest first. */
  log: v.optional(v.pipe(v.array(text(500)), v.transform((lines) => lines.slice(-20)))),
  device: DeviceSchema,
});
export type ErrorReport = v.InferOutput<typeof ErrorReportSchema>;

/** A report from JSON, or null if it isn't one. */
export function parseErrorReport(json: unknown): ErrorReport | null {
  const parsed = v.safeParse(ErrorReportSchema, json);
  return parsed.success ? parsed.output : null;
}

/** The biggest report body the Worker reads. */
export const ERROR_REPORT_MAX_BYTES = 32 * 1024;
