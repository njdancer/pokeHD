// Crash reporting: errors on players' devices go to `POST /api/errors`, and Nick reads them at
// /admin/errors. Catches uncaught exceptions, unhandled rejections, WebGPU errors and lost GPUs;
// React's and the emulator's failures are reported by their owners through reportError.
import type { ErrorKind, ErrorReport } from "@pokehd/protocol";

declare const __POKEHD_BUILD__: string;

/** The most reports one page load sends: a loop that throws every frame stops here. */
const MAX_SENT = 25;
/** Reports that couldn't be sent (offline, or the page closed first), retried on the next load. */
const OUTBOX_KEY = "pokehd-error-outbox";
const OUTBOX_MAX = 10;

const visit = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 16);
const loadedAt = performance.now();
/** Recent console warnings and errors, sent with each report for context. */
const log: string[] = [];
const seen = new Set<string>();
let sent = 0;
let renderer: string | undefined;
let gpu: string | undefined;

/** Reports `error`. The same message is sent once per page load. */
export function reportError(kind: ErrorKind, error: unknown, extra: { componentStack?: string } = {}): void {
  try {
    const { message, stack } = describe(error);
    const key = `${kind}|${message}`;
    if (seen.has(key) || sent >= MAX_SENT) return;
    seen.add(key);
    sent++;
    const report: ErrorReport = {
      kind,
      message,
      ...(stack ? { stack } : {}),
      ...(extra.componentStack ? { componentStack: extra.componentStack } : {}),
      page: location.pathname + location.search,
      build: typeof __POKEHD_BUILD__ === "string" ? __POKEHD_BUILD__ : "dev",
      visit,
      uptime: Math.round(performance.now() - loadedAt),
      log: log.slice(),
      device: device(),
    };
    void send(report);
  } catch {
    // Reporting must never be the thing that breaks the page.
  }
}

/** Tells reports which renderer the engine picked. */
export function noteRenderer(name: "webgpu" | "webgl"): void {
  renderer = name;
}

/** Starts listening for errors. Call once, before anything else runs. */
export function installErrorReporting(): void {
  addEventListener("error", (event) => {
    // Resource load failures (an <img> 404) arrive here too, with no error: not crashes.
    if (!(event instanceof ErrorEvent)) return;
    reportError("error", event.error ?? `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
  });
  addEventListener("unhandledrejection", (event) => reportError("rejection", event.reason));
  // WebGL contexts are lost on their canvas; capture sees it on the way down.
  addEventListener("webglcontextlost", () => reportError("gpu-lost", "WebGL context lost"), true);
  watchWebGPU();
  keepConsole("warn");
  keepConsole("error");
  void flushOutbox();
}

/** Every WebGPU device the page makes reports its uncaptured errors and its loss. */
function watchWebGPU(): void {
  if (typeof GPUAdapter === "undefined") return;
  const requestDevice = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (this: GPUAdapter, descriptor?: GPUDeviceDescriptor) {
    const device = await requestDevice.call(this, descriptor);
    try {
      const info = this.info;
      gpu = [info.vendor, info.architecture, info.device, info.description].filter(Boolean).join(" ");
      device.addEventListener("uncapturederror", (event) => {
        const error = (event as GPUUncapturedErrorEvent).error;
        reportError("gpu", `${error.constructor.name}: ${error.message}`);
      });
      void device.lost.then((lost) => {
        if (lost.reason !== "destroyed") reportError("gpu-lost", `GPU device lost (${lost.reason}): ${lost.message}`);
      });
    } catch {
      // Watching is best-effort; the device is fine either way.
    }
    return device;
  };
}

function keepConsole(level: "warn" | "error"): void {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    try {
      log.push(`${level}: ${args.map((a) => describe(a).message).join(" ")}`.slice(0, 500));
      if (log.length > 20) log.shift();
    } catch {
      // Ignore: logging still goes ahead.
    }
    original(...args);
  };
}

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    const message = error.name && !error.message.startsWith(error.name) ? `${error.name}: ${error.message}` : error.message;
    return { message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  if (typeof error === "string") return { message: error };
  try {
    return { message: JSON.stringify(error) ?? String(error) };
  } catch {
    return { message: String(error) };
  }
}

function device(): ErrorReport["device"] {
  const nav = navigator as Navigator & { standalone?: boolean; deviceMemory?: number };
  return {
    ua: nav.userAgent,
    screen: `${screen.width}x${screen.height}`,
    dpr: devicePixelRatio,
    standalone: nav.standalone === true || matchMedia("(display-mode: standalone)").matches,
    ...(renderer ? { renderer } : {}),
    ...(gpu ? { gpu } : {}),
    ...(nav.deviceMemory ? { memory: nav.deviceMemory } : {}),
  };
}

async function send(report: ErrorReport): Promise<void> {
  const outbox = readOutbox();
  outbox.push(report);
  writeOutbox(outbox.slice(-OUTBOX_MAX));
  if (await post(report)) writeOutbox(readOutbox().filter((r) => !sameReport(r, report)));
}

async function flushOutbox(): Promise<void> {
  const waiting = readOutbox();
  if (!waiting.length) return;
  writeOutbox([]);
  const failed: ErrorReport[] = [];
  for (const report of waiting) if (!(await post(report))) failed.push(report);
  if (failed.length) writeOutbox([...failed, ...readOutbox()].slice(-OUTBOX_MAX));
}

async function post(report: ErrorReport): Promise<boolean> {
  try {
    // keepalive lets it finish if the page is closing; text/plain keeps it a simple request.
    const response = await fetch("/api/errors", {
      method: "POST",
      body: JSON.stringify(report),
      headers: { "content-type": "text/plain" },
      keepalive: true,
    });
    // A 4xx means the report itself was refused: retrying wouldn't help.
    return response.status < 500;
  } catch {
    return false;
  }
}

const sameReport = (a: ErrorReport, b: ErrorReport) => a.visit === b.visit && a.uptime === b.uptime && a.message === b.message;

function readOutbox(): ErrorReport[] {
  try {
    const stored = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? (stored as ErrorReport[]) : [];
  } catch {
    return [];
  }
}

function writeOutbox(reports: ErrorReport[]): void {
  try {
    if (reports.length) localStorage.setItem(OUTBOX_KEY, JSON.stringify(reports));
    else localStorage.removeItem(OUTBOX_KEY);
  } catch {
    // Storage full or blocked: the report goes once, or not at all.
  }
}
